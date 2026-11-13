import { test, expect } from '@playwright/test';
import { alsMedewerker, laadDemo, staat } from './helpers';

test('medewerker: rooster, verlof aanvragen, wens en dienst aanbieden', async ({ page }) => {
  await laadDemo(page);
  const mid = await alsMedewerker(page, 'Utrecht');
  await page.goto('/mijn-rooster');
  await expect(page.getByText('Volgende dienst')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
  // bij een dienst met een regelplek: hoeveel plekken er die dag zijn en waarom
  await page.getByRole('button', { name: /^Uitleg plekken / }).first().click();
  await expect(page.getByRole('dialog').getByText('Hoe vaak valt elke plek?')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Sluiten' }).click();

  await page.goto('/verlof');
  // voorkeuren: weekpatroon aanpassen, opslaan en indienen in de lopende ronde
  await page.getByRole('button', { name: /^woensdag:/ }).click();
  await page.getByRole('button', { name: 'Voorkeuren opslaan' }).click();
  await expect(page.getByText('Voorkeuren opgeslagen.')).toBeVisible();
  expect(await staat<string>(page, `(s) => s.profielen['${mid}']?.bijgewerkt ?? ''`)).not.toBe('');
  await page.getByRole('button', { name: /Voorkeuren indienen|Opnieuw indienen/ }).click();
  await expect(page.getByText(/Je voorkeuren zijn ingediend/)).toBeVisible();

  // wens per datum: een dag kiezen, de wens kiezen, wijzigen en weer weghalen
  const wensen = `(s) => s.wensen.filter((w) => w.medewerkerId === '${mid}').map((w) => w.datum + ' ' + w.soort)`;
  const voor = await staat<string[]>(page, wensen);
  await page.getByRole('combobox', { name: 'Maand' }).selectOption({ index: 2 });
  const dag = page.locator('button[data-dag]:not([disabled])').nth(3);
  await dag.click();
  await page.getByRole('menuitem', { name: 'Wil graag werken' }).click();
  const na = await staat<string[]>(page, wensen);
  expect(na.length).toBe(voor.length + 1);
  const nieuw = na.find((w) => !voor.includes(w))!;
  expect(nieuw).toMatch(/ werken$/);
  await dag.click();
  await page.getByRole('menuitem', { name: 'Liever ochtend' }).click();
  expect(await staat<string[]>(page, wensen)).toContain(nieuw.replace(/ werken$/, ' ochtend'));
  // die dag al ander werk: een overige dienst van 4 uur
  await dag.click();
  await page.getByRole('menuitem', { name: 'Overige dienst (4 uur)' }).click();
  expect(await staat<string[]>(page, wensen)).toContain(nieuw.replace(/ werken$/, ' overig4'));
  await dag.click();
  await page.getByRole('menuitem', { name: 'Wens weghalen' }).click();
  expect(await staat<string[]>(page, wensen)).toEqual(voor);

  // bij de dag staat wat het team heeft opgegeven: alleen aantallen
  await dag.click();
  await expect(page.getByTestId('team-stand')).toContainText('Je team:');
  await page.keyboard.press('Escape');

  // standaard overnemen: de vaste voorkeuren in één week, alleen op dagen zonder wens; daarna één dag aanpassen
  const week = page.locator('button[data-week]:not([disabled])').nth(2);
  const maandag = (await week.getAttribute('data-week'))!;
  const dagen = Array.from({ length: 7 }, (_, j) => new Date(Date.parse(maandag + 'T12:00:00Z') + j * 864e5).toISOString().slice(0, 10));
  const inWeek = `(s) => s.wensen.filter((w) => w.medewerkerId === '${mid}' && ${JSON.stringify(dagen)}.includes(w.datum)).map((w) => w.datum + ' ' + w.soort).sort()`;
  const al = await staat<string[]>(page, inWeek);
  const vrijeDagen = await staat<number>(page, `(s) => ${JSON.stringify(dagen)}.filter((d) => !s.verlof.some((v) => v.medewerkerId === '${mid}' && ['aangevraagd', 'goedgekeurd'].includes(v.status) && v.van <= d && v.tot >= d)).length`);
  await week.click();
  await page.getByRole('menuitem', { name: /Standaard overnemen/ }).click();
  const gevuld = await staat<string[]>(page, inWeek);
  expect(gevuld.length).toBe(vrijeDagen);
  // wat er al stond, blijft staan
  for (const w of al) expect(gevuld).toContain(w);
  // nog een keer: er verandert niets
  await week.click();
  await page.getByRole('menuitem', { name: /Standaard overnemen/ }).click();
  expect(await staat<string[]>(page, inWeek)).toEqual(gevuld);
  await week.click();
  await page.getByRole('menuitem', { name: /Week leegmaken/ }).click();
  expect(await staat<string[]>(page, inWeek)).toEqual([]);

  const open = await staat<number>(page, `(s) => s.verlof.filter((v) => v.medewerkerId === '${mid}' && v.status === 'aangevraagd').length`);
  await page.getByRole('radio', { name: /^Verlof/ }).click();
  // ver genoeg vooruit om niet te overlappen met verlof uit de demo
  const van = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10), tot = new Date(Date.now() + 123 * 864e5).toISOString().slice(0, 10);
  await page.getByLabel('Van').fill(van);
  await page.getByLabel('Tot en met').fill(tot);
  await page.getByRole('button', { name: 'Aanvraag versturen' }).click();
  await expect(page.getByText('Je aanvraag is verstuurd')).toBeVisible();
  expect(await staat<number>(page, `(s) => s.verlof.filter((v) => v.medewerkerId === '${mid}' && v.status === 'aangevraagd').length`)).toBe(open + 1);


  await page.goto('/ruilen');
  await page.getByRole('button', { name: 'Aanbieden of ruilen' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Aanbieden' }).click();
  await expect(page.getByText("Je dienst staat in het aanbod")).toBeVisible();
  expect(await staat<number>(page, `(s) => s.ruil.filter((r) => r.aanbiederId === '${mid}' && r.status === 'open' && r.soort !== 'verlof').length`)).toBeGreaterThanOrEqual(1);
  // verlof ruilen staat op dezelfde pagina
  await expect(page.getByRole('heading', { name: 'Verlof ruilen' })).toBeVisible();
});

test('medewerker: verlofjaar en verlof aanvragen vanuit de kalender, via het menu', async ({ page, isMobile }) => {
  await laadDemo(page);
  const mid = await alsMedewerker(page, 'Utrecht');
  await page.goto('/mijn-rooster');
  if (isMobile) await page.getByRole('button', { name: 'Menu openen' }).click();
  await page.getByRole('navigation', { name: 'Onderdelen' }).getByRole('link', { name: 'Jaarplanning verlof' }).click();
  await expect(page.getByRole('heading', { name: 'Mijn verlofjaar' })).toBeVisible();
  await expect(page.getByText('Volgend verlof', { exact: true })).toBeVisible();
  // geen verlofrecht of saldo: dat staat in de personeelsadministratie
  await expect(page.getByText(/Verlofrecht|Nog te plannen/)).toHaveCount(0);
  // urenregistratie zit niet meer in de app
  await expect(page.getByRole('link', { name: /^Uren/ })).toHaveCount(0);
  const leeg = page.getByRole('button', { name: /, week 5[01]: geen verlof/ }).first();
  await leeg.click();
  const voor = await staat<number>(page, `(s) => s.verlof.filter((v) => v.medewerkerId === '${mid}' && v.status === 'aangevraagd').length`);
  await page.getByRole('dialog').getByRole('button', { name: 'Aanvragen' }).click();
  // week 50 en 51 staan al in het goedgekeurde, gepubliceerde rooster: vrij nemen kan dan alleen via een ruil
  await expect(page.getByText(/Het rooster is al goedgekeurd en je staat ingeroosterd op .* via een ruil/)).toBeVisible();
  expect(await staat<number>(page, `(s) => s.verlof.filter((v) => v.medewerkerId === '${mid}' && v.status === 'aangevraagd').length`)).toBe(voor);
});

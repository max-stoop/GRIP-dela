import { test, expect } from '@playwright/test';
import { alsMedewerker, laadDemo, staat } from './helpers';

test('NBD: een losse module, niet bij de regio\'s; rooster maken met Erlang C en een dienst met pauze', async ({ page }) => {
  const fouten: string[] = [];
  page.on('pageerror', (e) => fouten.push(`${page.url()}: ${e.message}`));
  await laadDemo(page);
  // het dashboard telt alleen de regio's
  // (Utrecht kan er vaker staan, bijvoorbeeld ook bij wat op goedkeuring wacht)
  await expect(page.getByRole('row', { name: /Utrecht/ }).first()).toBeVisible();
  await expect(page.getByRole('row', { name: /NBD/ })).toHaveCount(0);

  // bij de regio's staat de NBD nergens: niet in de werkregio, niet in de keuze op het rooster
  const zijbalk = page.getByRole('complementary', { name: 'Navigatie' });
  await expect(zijbalk.locator('select option', { hasText: 'NBD' })).toHaveCount(0);
  await page.goto('/rooster?regio=Utrecht');
  await expect(page.getByRole('heading', { name: /Rooster Utrecht/ })).toBeVisible();
  await expect(page.locator('main select option', { hasText: 'NBD' })).toHaveCount(0);
  // een oude link naar het NBD-rooster gaat naar de module
  await page.goto('/rooster?regio=NBD');
  await expect(page).toHaveURL(/\/nbd\/rooster/);

  // met de schakelaar naar de module van de NBD: een eigen menu, open van 7:00 tot 22:30
  await page.goto('/dashboard');
  await zijbalk.getByRole('link', { name: 'NBD' }).click();
  await expect(page).toHaveURL(/\/nbd$/);
  await expect(page.getByRole('heading', { name: /Overzicht NBD/ })).toBeVisible();
  await expect(zijbalk.getByText('elke dag open van 7:00 tot 22:30')).toBeVisible();
  for (const naam of ['Rooster', 'Bijsturen', 'Voorkeuren per uur', 'Verlof', 'Jaarplanning verlof', 'Ruilen', 'Capaciteit en Erlang']) await expect(zijbalk.getByRole('link', { name: naam, exact: true })).toBeVisible();
  await expect(zijbalk.getByRole('link', { name: 'Voorspelling' })).toHaveCount(0);
  await zijbalk.getByRole('link', { name: 'Rooster', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Rooster NBD/ })).toBeVisible();
  await expect(page.locator('tfoot th', { hasText: 'Nodig (uur)' })).toBeVisible();
  await expect(page.locator('tfoot th', { hasText: 'Service level %' })).toBeVisible();
  const team = await staat<number>(page, `(s) => s.medewerkers.filter((m) => m.regio === 'NBD').length`);
  expect(team).toBeGreaterThan(12);

  // twee maanden verder (in de maak): leegmaken en opnieuw laten maken
  await page.getByRole('button', { name: 'Volgende maand' }).click();
  await page.getByRole('button', { name: 'Volgende maand' }).click();
  await page.getByRole('button', { name: 'Leegmaken' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Leegmaken' }).click();
  await expect(page.getByText(/gewist\. Verlof en ziekte bleven staan/)).toBeVisible();
  await page.getByRole('button', { name: 'Rooster maken', exact: true }).click();
  const plan = page.getByRole('dialog').filter({ hasText: 'NBD-rooster maken' });
  await plan.getByRole('button', { name: 'Rooster maken' }).click();
  await expect(plan.getByText('geen overtredingen')).toBeVisible({ timeout: 30_000 });
  await plan.getByRole('button', { name: 'Toepassen' }).click();
  await expect(plan).toHaveCount(0);
  // elke dienst heeft tijden, 3 tot 9 uur werk, en bij meer dan 5,5 uur een pauze van 30 minuten
  const diensten = await staat<{ start: number; eind: number; pauze?: number }[]>(page, `(s) => Object.entries(s.rooster.NBD).flatMap(([mid, rij]) => Object.entries(rij).filter(([, c]) => c === 'N').map(([d]) => s.tijden.NBD[mid][d]))`);
  expect(diensten.length).toBeGreaterThan(200);
  for (const x of diensten) {
    const werk = x.eind - x.start - (x.pauze ?? 0) / 60;
    expect(werk).toBeGreaterThanOrEqual(3);
    expect(werk).toBeLessThanOrEqual(9);
    if (werk > 5.5) expect(x.pauze).toBeGreaterThanOrEqual(30);
  }

  // zelf een dienst zetten: zonder pauze mag het niet, met pauze wel
  const cel = page.locator('td.s:not(.verleden)').first();
  await cel.click();
  const venster = page.getByRole('dialog');
  await venster.getByRole('radio', { name: 'In lijn', exact: true }).click();
  await venster.getByLabel('Begin').selectOption({ label: '9:00' });
  await venster.getByLabel('Eind').selectOption({ label: '17:30' });
  await venster.getByRole('combobox', { name: /^Pauze Telt niet/ }).selectOption({ label: 'geen' });
  await expect(venster.getByText(/hoort een pauze van minstens 30 minuten/)).toBeVisible();
  await expect(venster.getByRole('button', { name: 'Bewaren' })).toBeDisabled();
  await venster.getByRole('combobox', { name: /^Pauze Telt niet/ }).selectOption({ label: '30 minuten' });
  await expect(venster.locator('b', { hasText: /^8 uur$/ })).toBeVisible();
  await venster.getByRole('button', { name: 'Bewaren' }).click();
  await expect(cel).toContainText('9:00');
  await expect(cel).toContainText('17:30');

  // capaciteit en Erlang, zoals de capaciteitsplanning: een gewone week is 663,5 uur aan de telefoon
  await page.goto('/nbd/capaciteit');
  await expect(page.getByRole('heading', { name: /Capaciteit en Erlang/ })).toBeVisible();
  await expect(page.getByRole('list', { name: 'De keten' })).toContainText('663,5');
  await expect(page.getByRole('list', { name: 'De keten' })).toContainText('1.703');
  await expect(page.getByRole('heading', { name: /Capaciteit per week in/ })).toBeVisible();
  // de capaciteit van de regio's gaat niet over de NBD
  await page.goto('/capaciteit');
  await expect(page.getByRole('heading', { name: /Capaciteit en formatie/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'NBD' })).toHaveCount(0);
  expect(fouten).toEqual([]);
});

test('NBD-medewerker: eigen rooster met tijden en pauze, voorkeuren per uur, en een dienst aanbieden', async ({ page }) => {
  await laadDemo(page);
  const mid = await alsMedewerker(page, 'NBD');
  await page.goto('/mijn-rooster');
  await expect(page.getByText('Volgende dienst')).toBeVisible();
  await expect(page.getByText(/\d+:\d\d–\d+:\d\d, (pauze \d+:\d\d–\d+:\d\d|geen pauze)/).first()).toBeVisible();

  // voorkeuren per uur: maandag graag de avond, zondag kan niet
  await page.goto('/verlof');
  await expect(page.getByRole('heading', { name: 'Mijn voorkeuren per uur' })).toBeVisible();
  await page.getByLabel('maandag snel invullen').selectOption('Avond');
  await page.getByLabel('zondag snel invullen').selectOption('niet');
  await page.getByRole('button', { name: 'Voorkeuren opslaan' }).click();
  await expect(page.getByText('Voorkeuren opgeslagen.')).toBeVisible();
  // tijdvakken 7:00 ... 22:00: de avond (17:00-22:30) is de laatste zes
  expect(await staat<string>(page, `(s) => s.profielen['${mid}'].uren.even[1]`)).toBe('..........gggggg');
  // even en oneven weken kunnen verschillen; zonder dat onderscheid geldt het voor beide
  const apart = await staat<boolean>(page, `(s) => JSON.stringify(s.profielen['${mid}'].uren.even) !== JSON.stringify(s.profielen['${mid}'].uren.oneven)`);
  expect(await staat<string>(page, `(s) => s.profielen['${mid}'].uren.even[0]`)).toBe('nnnnnnnnnnnnnnnn');
  if (!apart) expect(await staat<string>(page, `(s) => s.profielen['${mid}'].uren.oneven[0]`)).toBe('nnnnnnnnnnnnnnnn');
  // het menu van een medewerker van de NBD: geen roosterbeleid van de regio's
  await expect(page.getByRole('complementary', { name: 'Navigatie' }).getByRole('link', { name: 'Roosterbeleid' })).toHaveCount(0);

  // aanbieden: de tijden gaan mee
  await page.goto('/ruilen');
  await expect(page.getByText(/In lijn, \d+:\d\d–\d+:\d\d/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Aanbieden of ruilen' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Aanbieden' }).click();
  await expect(page.getByText('Je dienst staat in het aanbod')).toBeVisible();
  expect(await staat<string>(page, `(s) => s.ruil.find((r) => r.aanbiederId === '${mid}' && r.status === 'open').dienst`)).toBe('N');
});

test('NBD bijsturen: zoals bij de regio\'s, met de keten, uren per dag en acties die de dienst met tijden verwerken', async ({ page }) => {
  await laadDemo(page);
  await page.goto('/bijsturen?regio=NBD');
  await expect(page).toHaveURL(/\/nbd\/bijsturen/);
  await expect(page.getByRole('heading', { name: /Bijsturen NBD/ })).toBeVisible();
  await expect(page.getByRole('list', { name: 'De keten' })).toContainText('Bijvoorspellen');
  await expect(page.getByRole('heading', { name: 'Uren aan de telefoon per dag' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Wat er te doen is' })).toBeVisible();

  // iemand met een dienst over twee dagen meldt zich ziek: dat geeft een tekort
  const d = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  const mid = await staat<string>(page, `(s) => Object.entries(s.rooster.NBD).find(([, r]) => r['${d}'] === 'N')[0]`);
  await page.getByRole('button', { name: 'Ziekmelding' }).click();
  const dialoog = page.getByRole('dialog');
  await dialoog.getByRole('combobox').first().selectOption(mid);
  await dialoog.getByLabel('Vanaf').fill(d);
  await dialoog.getByLabel('Tot en met (verwacht)').fill(d);
  await dialoog.getByRole('button', { name: /Ziek melden/ }).click();
  await expect.poll(() => staat<string>(page, `(s) => s.rooster.NBD['${mid}']['${d}']`)).toBe('Z');

  // de dag met het tekort, met acties in de volgorde van het stroomschema
  const kaart = page.locator('div.box', { hasText: 'uur tekort' }).filter({ has: page.getByRole('button', { name: 'Toepassen' }) }).first();
  await expect(kaart).toBeVisible();
  await kaart.getByRole('button', { name: 'Dagbeeld' }).click();
  await expect(kaart.getByRole('figure')).toBeVisible();
  const tijden = `(s) => JSON.stringify(s.tijden.NBD)`;
  const tijdenVoor = await staat<string>(page, tijden);
  const logVoor = await staat<number>(page, `(s) => s.activiteit.filter((a) => a.regio === 'NBD' && a.soort === 'bijsturen').length`);
  await kaart.getByRole('button', { name: 'Toepassen' }).first().click();
  await expect(page.getByText('Bijgestuurd. Het rooster is aangepast')).toBeVisible();
  // de tijden zijn aangepast (pauze verschoven, verlengd of een dienst erbij), en elke dienst heeft tijden
  expect(await staat<string>(page, tijden)).not.toBe(tijdenVoor);
  expect(await staat<number>(page, `(s) => s.activiteit.filter((a) => a.regio === 'NBD' && a.soort === 'bijsturen').length`)).toBeGreaterThan(logVoor);
  // ZZP'ers en externen staan voorlopig niet in het rooster: bijsturen stelt ze ook niet voor
  await expect(page.getByText('(extern) inzetten')).toHaveCount(0);
  await expect(page.getByText('Zet een externe kracht in')).toHaveCount(0);
  expect(await staat<number>(page, `(s) => s.medewerkers.filter((m) => m.extern).length`)).toBe(0);
  // elke dienst in de lijn heeft tijden
  expect(await staat<number>(page, `(s) => Object.entries(s.rooster.NBD).filter(([m, r]) => Object.entries(r).some(([dd, c]) => c === 'N' && !s.tijden.NBD[m]?.[dd])).length`)).toBe(0);
});

test('NBD-module: team met maximale inzet, voorkeuren per uur tegenover de behoefte, verlof, jaarplanning en ruilen', async ({ page }) => {
  const fouten: string[] = [];
  page.on('pageerror', (e) => fouten.push(`${page.url()}: ${e.message}`));
  await laadDemo(page);

  // het team: maximale inzet bij een variabel rooster
  await page.goto('/team?regio=NBD');
  await expect(page).toHaveURL(/\/nbd\/team/);
  await expect(page.getByRole('heading', { name: /Team NBD/ })).toBeVisible();
  const mid = await staat<string>(page, `(s) => s.medewerkers.find((m) => m.regio === 'NBD' && !m.extern && m.actief).id`);
  const naam = await staat<string>(page, `(s) => s.medewerkers.find((m) => m.id === '${mid}').naam`);
  await page.getByRole('row', { name: new RegExp(naam) }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Bewerken' }).click();
  const mw = page.getByRole('dialog').filter({ hasText: 'bewerken' });
  await mw.getByRole('spinbutton', { name: 'Maximale inzet per week (uur)' }).fill('34');
  await mw.getByRole('button', { name: 'Opslaan' }).click();
  await expect.poll(() => staat<number>(page, `(s) => s.medewerkers.find((m) => m.id === '${mid}').maxUren`)).toBe(34);

  // voorkeuren per uur van het team en de wens tegenover de behoefte
  await page.goto('/nbd/voorkeuren');
  await expect(page.getByRole('heading', { name: /Voorkeuren per uur/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Wens tegenover de behoefte' })).toBeVisible();
  await page.getByRole('button', { name: `Voorkeuren van ${naam} bewerken` }).click();
  const editor = page.getByRole('dialog');
  await editor.getByRole('radio', { name: 'Kan niet' }).click();
  await editor.getByRole('button', { name: 'woensdag 7:00–8:00: Graag' }).or(editor.getByRole('button', { name: 'woensdag 7:00–8:00: Geen voorkeur' })).first().click();
  await editor.getByRole('button', { name: 'Voorkeuren opslaan' }).click();
  await expect(page.getByText('Voorkeuren opgeslagen.')).toBeVisible();
  expect(await staat<string>(page, `(s) => s.profielen['${mid}'].uren.even[3][0]`)).toBe('n');

  // verlof, jaarplanning en ruilen van de NBD
  await page.goto('/nbd/verlof');
  await expect(page.getByRole('heading', { name: /Verlof NBD/ })).toBeVisible();
  await page.goto('/nbd/jaarplanning');
  await expect(page.getByRole('heading', { name: /Jaarplanning NBD/ })).toBeVisible();
  await expect(page.getByText(/netto uren beschikbaar min 92%/)).toBeVisible();
  await page.goto('/nbd/ruilen');
  await expect(page.getByRole('heading', { name: /Ruilen NBD/ })).toBeVisible();
  // bij de regio's geen NBD meer in verlof en ruilen
  await page.goto('/verlof');
  await expect(page.locator('main select option', { hasText: 'NBD' })).toHaveCount(0);
  await page.goto('/ruilen');
  await expect(page.locator('main select option', { hasText: 'NBD' })).toHaveCount(0);
  expect(fouten).toEqual([]);
});

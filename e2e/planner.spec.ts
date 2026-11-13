import { test, expect } from '@playwright/test';
import { alsRol, laadDemo, staat, type Grip } from './helpers';

test('welkomstscherm, demo en dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Regelplekken, van voorspelling tot rooster/ })).toBeVisible();
  await laadDemo(page);
  await expect(page.getByRole('heading', { name: /^Regio's · rooster / })).toBeVisible();
  // per regio de komende vier maanden; een vakje opent het rooster van die maand
  const perMaand = page.locator('section', { has: page.getByRole('heading', { name: 'Roosters per maand' }) });
  await expect(perMaand.getByRole('row', { name: /Utrecht/ })).toBeVisible();
  // een andere maand kiezen: cijfer, toets en vaststelling gaan dan over dat rooster
  const tweede = page.getByRole('radiogroup', { name: 'Maand van het rooster' }).getByRole('radio').nth(1);
  const naam = (await tweede.innerText()).toLowerCase();
  await tweede.click();
  await expect(page.getByRole('heading', { name: new RegExp(`^Regio's · rooster ${naam} `) })).toBeVisible();
  expect(await staat<number>(page, '(s) => s.runs.length')).toBe(16);
  await perMaand.getByRole('row', { name: /Utrecht/ }).getByRole('link').nth(1).click();
  await expect(page).toHaveURL(/rooster\?regio=Utrecht&maand=\d{4}-\d{2}/);
  await expect(page.getByRole('list', { name: 'Vaststelling per maand' })).toContainText('cijfer');
});

test('dashboard: de drukte 30, 60, 90 of 150 dagen vooruit; voorbij de voorspelling de vastgestelde regelplekken', async ({ page }) => {
  await page.goto('/');
  await laadDemo(page);
  const keuze = page.getByRole('radiogroup', { name: 'Dagen vooruit' });
  await expect(page.getByRole('heading', { name: 'Landelijke drukte, komende 60 dagen' })).toBeVisible();
  await expect(keuze.getByRole('radio', { name: '60' })).toHaveAttribute('aria-checked', 'true');
  const norm = page.getByText('Verder vooruit: vastgestelde regelplekken');
  await keuze.getByRole('radio', { name: '150' }).click();
  await expect(page.getByRole('heading', { name: 'Landelijke drukte, komende 150 dagen' })).toBeVisible();
  await expect(norm).toBeVisible();
  await keuze.getByRole('radio', { name: '30' }).click();
  await expect(page.getByRole('heading', { name: 'Landelijke drukte, komende 30 dagen' })).toBeVisible();
  await expect(norm).toBeHidden();
  // de keuze blijft bewaard in deze browser
  await keuze.getByRole('radio', { name: '90' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Landelijke drukte, komende 90 dagen' })).toBeVisible();
});

test('zonder gegevens: het menu staat er, elke pagina opent, en na een eerste medewerker is het welkom weg', async ({ page }) => {
  const fouten: string[] = [];
  page.on('pageerror', (e) => fouten.push(`${page.url()}: ${e.message}`));
  const welkom = page.getByRole('heading', { name: /Regelplekken, van voorspelling tot rooster/ });
  const paginas = ['/voorspelling', '/rooster', '/bijsturen', '/verdeling', '/team', '/verlof', '/jaarplanning', '/ruilen', '/capaciteit', '/beleid', '/model', '/instellingen'];

  for (const pad of ['/', '/dashboard']) {
    await page.goto(pad);
    await expect(welkom).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Onderdelen' })).toBeVisible();
  }
  for (const pad of paginas) {
    await page.goto(pad);
    await expect(page.locator('main').getByRole('heading').first()).toBeVisible();
    await expect(welkom).toHaveCount(0);
  }

  // zonder meldingen rekent de voorspelling met de vastgestelde regelplekken, en de 1B met het hele cluster
  await page.goto('/voorspelling');
  await expect(page.getByText('Vastgestelde regelplekken').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /Te borgen in week \d+/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /kans dat een 1B valt/ })).toBeVisible();
  // waarom zoveel plekken: per plek eigen regio of cluster
  await expect(page.getByRole('heading', { name: /^Waarom \d+ plekken in / })).toBeVisible();
  await expect(page.getByText('Hoe vaak valt elke plek?')).toBeVisible();
  await page.goto('/capaciteit');
  await expect(page.getByRole('heading', { name: 'Kans dat een 1B valt' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Oost/ }).first()).toBeVisible();

  // via het menu naar Team en de eerste medewerker toevoegen
  await page.goto('/dashboard');
  await page.getByRole('navigation', { name: 'Onderdelen' }).getByRole('link', { name: 'Team' }).click();
  await page.getByRole('button', { name: 'Medewerker toevoegen' }).click();
  await page.getByLabel('Naam').fill('Eerste Medewerker');
  await page.getByRole('dialog').getByRole('button', { name: 'Toevoegen' }).click();
  await expect(page.getByText('Eerste Medewerker').first()).toBeVisible();
  await page.evaluate(() => (window as unknown as { __grip: Grip }).__grip.bewaarNu());

  // nu met een team maar zonder meldingen
  for (const pad of ['/dashboard', ...paginas]) {
    await page.goto(pad);
    await expect(page.locator('main').getByRole('heading').first()).toBeVisible();
    await expect(welkom).toHaveCount(0);
  }
  expect(fouten).toEqual([]);
});

test('voorspelling: grafiek, dagdetail, heatmap en roosterbasis', async ({ page }) => {
  await laadDemo(page);
  await page.getByRole('link', { name: 'Voorspelling' }).first().click();
  await expect(page.getByRole('heading', { name: 'Komende 61 dagen' })).toBeVisible();
  await expect(page.getByText('Ontwikkeling van deze dag')).toBeVisible();
  // morgen per cluster en regio, met hoe goed de voorspelling voor morgen het afgelopen halfjaar was
  const morgen = page.locator('section', { has: page.getByRole('heading', { name: /^Morgen, / }) });
  await expect(morgen.getByRole('cell', { name: /^Cluster / }).first()).toBeVisible();
  await expect(morgen.getByRole('cell', { name: /^±\d/ }).first()).toBeVisible({ timeout: 60_000 });
  await expect(morgen.getByText(/^Per regio zat de voorspelling voor morgen/)).toBeVisible();
  // per factor de berekening: tikken of met de muis erop
  const dag = page.locator('.box', { has: page.getByText('basismodel', { exact: true }) }).first();
  // de bandbreedte van de dag, met uitleg en terugblik
  const bandKnop = dag.getByRole('button', { name: /^Waarschijnlijk \d+ tot \d+ meldingen/ });
  await bandKnop.click();
  await expect(bandKnop).toHaveAttribute('aria-expanded', 'true');
  await expect(dag.getByRole('note')).toContainText('op 8 van de 10 van zulke dagen ligt het tussen');
  await expect(dag.getByRole('note')).toContainText('De band gaat ervan uit dat de verwachting klopt.');
  await bandKnop.click();
  await expect(dag.getByRole('note')).toHaveCount(0);
  await dag.locator('button[aria-expanded]').nth(1).click();
  await expect(dag.getByRole('note')).toContainText('Samen: ');
  await expect(dag.getByText(/^Samen: .* \(basismodel\) × /)).toBeVisible();
  await expect(page.getByText(/Komende 7 dagen verwachten we/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Zo komt de voorspelling tot stand' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hoeveel meldingen kunnen het worden?' })).toBeVisible();
  // waarom zoveel plekken, met de 1B voor de eigen of een andere regio; één regiokeuze voor beide uitleggen
  const waarom = page.locator('section', { has: page.getByRole('heading', { name: /^Waarom \d+ plekken in / }) });
  await expect(waarom.getByText(/voor een andere regio/).first()).toBeVisible();
  await waarom.getByRole('combobox', { name: 'Regio voor de uitleg' }).selectOption('Utrecht');
  await expect(page.getByRole('heading', { name: /^Waarom \d+ plekken in Utrecht\?$/ })).toBeVisible();
  await expect(page.locator('section', { has: page.getByRole('heading', { name: 'Zo komt de voorspelling tot stand' }) }).getByRole('combobox', { name: 'Regio voor de uitleg' })).toHaveValue('Utrecht');
  await expect(page.getByRole('heading', { name: 'Nauwkeurigheid per afstand' })).toBeVisible();
  await expect(page.locator('table.hm')).toBeVisible();
  await page.getByRole('button', { name: 'Vastleggen als roosterbasis' }).click();
  await expect(page.getByRole('button', { name: 'Is roosterbasis' })).toBeDisabled();
  await page.locator('table.hm').getByRole('link', { name: 'Haaglanden' }).click();
  await expect(page).toHaveURL(/rooster\?regio=Haaglanden/);
});

test('rooster: lege vakjes aanvullen, toetsenbord, ongedaan maken en publiceren', async ({ page }) => {
  await laadDemo(page);
  // Noord-Oost heeft in de demo nog lege weken aan het eind
  await page.goto('/rooster?regio=Noord-Oost');
  await expect(page.getByRole('heading', { name: /Rooster Noord-Oost/ })).toBeVisible();
  const voor = await staat<number>(page, `(s) => Object.values(s.rooster['Noord-Oost']).reduce((a, r) => a + Object.keys(r).length, 0)`);
  await page.getByRole('button', { name: 'Rooster maken', exact: true }).click();
  await page.getByRole('button', { name: 'Voorstel maken' }).click();
  await expect(page.getByText(/Groen is beter dan nu/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Voorstel toepassen' }).click();
  await expect(page.getByText(/Rooster gemaakt/)).toBeVisible();
  const na = await staat<number>(page, `(s) => Object.values(s.rooster['Noord-Oost']).reduce((a, r) => a + Object.keys(r).length, 0)`);
  expect(na).toBeGreaterThan(voor);

  // eerste cel van morgen kiezen en met het toetsenbord een B zetten
  const cel = page.locator('td.s:not(.verleden)').nth(1);
  await cel.click();
  await page.keyboard.press('b');
  await expect(cel).toHaveText('1B');
  await page.keyboard.press('Control+z');
  await expect(cel).not.toHaveText('1B');

  // vaststellen per maand: de maanden ervoor zijn vastgesteld en gepubliceerd; voor deze maand geeft de planner een
  // advies en biedt aan, de regiomanager keurt goed, daarna publiceren (§ 5.1)
  await expect(page.getByText(/Nog geen advies\. Bij elk maandrooster/)).toBeVisible();
  const eerder = await staat<string>(page, `(s) => s.publicaties['Noord-Oost'].tot`);
  const publiceren = page.getByRole('button', { name: /\d{4} publiceren$/ });
  await expect(publiceren).toBeDisabled();
  // het advies geeft de planner (of de beheerder); hier als planner, die niet zelf goedkeurt
  await expect(page.getByRole('button', { name: 'Advies geven en aanbieden' })).toBeVisible();
  await page.evaluate(() => (window as unknown as { __grip: Grip }).__grip.bewaarNu());
  await alsRol(page, 'planner');
  await page.reload();
  await page.getByRole('button', { name: 'Advies geven en aanbieden' }).click();
  const venster = page.getByRole('dialog');
  await expect(venster.getByText('Voorstel van GRIP:')).toBeVisible();
  // oranje zonder toelichting kan niet
  await venster.getByRole('radio', { name: /Oranje/ }).click();
  await expect(venster.getByRole('button', { name: 'Advies geven en aanbieden' })).toBeDisabled();
  await venster.getByLabel(/Toelichting voor de regiomanager/).fill('Dinsdag is krap, de 1B is de achtervang.');
  await venster.getByRole('button', { name: 'Advies geven en aanbieden' }).click();
  await expect(page.getByText(/Advies oranje gegeven/)).toBeVisible();
  expect(await staat<string>(page, `(s) => Object.values(s.goedkeuringen['Noord-Oost']).find((g) => g.status === 'ter_goedkeuring').advies.kleur`)).toBe('oranje');
  // de planner keurt niet goed; dat doet de regiomanager
  await expect(page.getByRole('button', { name: 'Goedkeuren', exact: true })).toHaveCount(0);
  await expect(page.getByText('Goedkeuren doet de regiomanager (§ 5.1).')).toBeVisible();
  await page.getByRole('button', { name: 'Bekijk als regiomanager' }).click();
  await page.getByRole('button', { name: 'Goedkeuren', exact: true }).click();
  await expect(page.getByText(/goedgekeurd\. Het kan nu worden gepubliceerd/)).toBeVisible();
  await publiceren.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publiceren' }).click();
  await expect(page.getByText('Rooster gepubliceerd')).toBeVisible();
  // de geschiedenis van de maand: advies en goedkeuring
  await page.getByText(/^Geschiedenis van/).click();
  await expect(page.getByText(/Advies oranje van/)).toBeVisible();
  expect(await staat<string>(page, `(s) => s.publicaties['Noord-Oost'].tot`) > eerder).toBe(true);
});

test('rooster downloaden in het eigen jaarroosterformat, zonder namen', async ({ page }) => {
  await laadDemo(page);
  await page.goto('/rooster?regio=Amsterdam');
  await expect(page.getByRole('heading', { name: /Rooster Amsterdam/ })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Jaarrooster downloaden' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^\d{4}_Jaarrooster_NW\.xlsx$/);
  const pad = await download.path();
  const data = (await import('fs')).readFileSync(pad!);
  expect(data.subarray(0, 2).toString()).toBe('PK');
  expect(data.length).toBeGreaterThan(50_000);
  // uitpakken en nagaan: de bladen van het cluster, de eigen opbouw, en geen namen uit het team
  const { inflateRawSync } = await import('zlib');
  const delen: string[] = [];
  for (let p = 0; data.readUInt32LE(p) === 0x04034b50;) {
    const methode = data.readUInt16LE(p + 8), grootte = data.readUInt32LE(p + 18), nl = data.readUInt16LE(p + 26);
    const inhoud = data.subarray(p + 30 + nl, p + 30 + nl + grootte);
    delen.push((methode === 8 ? inflateRawSync(inhoud) : inhoud).toString('utf8'));
    p += 30 + nl + grootte;
  }
  const tekst = delen.join('\n');
  for (const blad of ['NHN', 'NHM', 'AMS', 'SR', 'AMS uren']) expect(tekst).toContain(`<sheet name="${blad}"`);
  expect(tekst).toContain('regelplekken gepland cluster');
  expect(tekst).toContain('Feestdagenteller');
  const namen = await staat<string[]>(page, `(s) => s.medewerkers.filter((m) => m.regio === 'Amsterdam').map((m) => m.naam)`);
  expect(namen.length).toBeGreaterThan(3);
  for (const n of namen) expect(tekst.includes(`>${n}<`)).toBe(false);
  expect(tekst).toContain('>AMS 01<');
});

test('rooster: medewerker toevoegen', async ({ page }) => {
  await laadDemo(page);
  await page.goto('/rooster?regio=Breda');
  // per dag de kans dat een 1B valt, voor het hele cluster
  const kans = page.locator('tfoot tr', { hasText: 'Kans 1B valt' });
  await expect(kans).toBeVisible();
  await expect(kans.locator('td[title*="eerst naar een vrije plek"]').first()).toBeVisible();
  // klik op een dag: de uitleg per plek
  await kans.getByRole('button', { name: /^Uitleg 1B / }).first().click();
  await expect(page.getByRole('dialog').getByText('Hoe vaak valt elke plek?')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Sluiten' }).click();
  await page.getByRole('button', { name: 'Medewerker toevoegen' }).click();
  await page.getByLabel('Naam').fill('Test Medewerker');
  await page.getByRole('dialog').getByRole('button', { name: 'Toevoegen' }).click();
  await expect(page.locator('tbody th.nm', { hasText: 'Test Medewerker' })).toBeVisible();
});

test('rooster: uitvaartverzorgers boven, uitvaartleiders onder, en namen schuiven', async ({ page }) => {
  await laadDemo(page);
  await page.goto('/rooster?regio=Amsterdam');
  await expect(page.getByRole('heading', { name: /Rooster Amsterdam/ })).toBeVisible();
  const rijen = page.locator('table.rs tbody th.nm');
  const functies = await rijen.evaluateAll((th) => th.map((x) => (x.textContent?.includes('uitvaartleider') ? 'UL' : 'UV')));
  const eersteUL = functies.indexOf('UL');
  expect(eersteUL).toBeGreaterThan(0);
  expect(functies.slice(eersteUL).every((f) => f === 'UL')).toBe(true);
  const namen = () => rijen.locator('span.truncate').allTextContents();
  const voor = await namen();
  // de bovenste kan niet omhoog, de laatste uitvaartverzorger niet onder de uitvaartleiders
  await expect(page.getByRole('button', { name: `${voor[0]} omhoog` })).toBeHidden();
  await expect(page.getByRole('button', { name: `${voor[eersteUL - 1]} omlaag` })).toBeHidden();
  await page.getByRole('button', { name: `${voor[0]} omlaag` }).click();
  const na = [voor[1], voor[0], ...voor.slice(2)];
  await expect.poll(namen).toEqual(na);
  // de enige uitvaartleider van Amsterdam blijft onderaan
  expect(functies.length - eersteUL).toBe(1);
  await expect(page.getByRole('button', { name: `${voor[eersteUL]} omhoog` })).toBeHidden();
  // de volgorde blijft bewaard
  await page.evaluate(() => (window as unknown as { __grip: Grip }).__grip.bewaarNu());
  await page.reload();
  await expect(page.getByRole('heading', { name: /Rooster Amsterdam/ })).toBeVisible();
  await expect.poll(namen).toEqual(na);
});

test('rooster: het cluster per regio onder elkaar, met onderaan wat het cluster zou moeten hebben', async ({ page }) => {
  await laadDemo(page);
  await page.goto('/rooster?regio=Amsterdam');
  await expect(page.getByRole('heading', { name: /Rooster Amsterdam/ })).toBeVisible();
  // onder het rooster van de regio staat het cluster al: gepland, afgesproken en de Dg's, met wat de regio moet
  const grid = page.locator('table.rs:not(.cl)');
  for (const rij of ['Regelplekken gepland', 'Afgesproken', 'Dg gepland', 'Cluster gepland', 'Cluster afgesproken', 'Cluster Dg']) await expect(grid.locator('tfoot th', { hasText: rij }).first()).toBeVisible();
  await expect(grid.locator('tfoot th', { hasText: 'Dg gepland' })).toContainText('moet 2');
  await expect(grid.locator('tfoot th', { hasText: 'Cluster Dg' })).toContainText('moet 8');
  const voetRij = (rij: string) => grid.locator('tfoot tr', { has: page.locator('th', { hasText: rij }) }).locator('td').allTextContents();
  const clusterOnderRooster = await voetRij('Cluster gepland');
  const clusterAfgesproken = await voetRij('Cluster afgesproken');
  await page.getByRole('radio', { name: 'Cluster Noordwest' }).click();
  const tabel = page.getByRole('table', { name: /Cluster Noordwest/ });
  await expect(tabel).toBeVisible();
  const regios = await tabel.locator('tbody th.nm span.truncate').allTextContents();
  expect(regios).toEqual(['Amsterdam', 'Noord-Holland', 'Noord-Holland Midden', 'Spaarne-Rijnland']);
  for (const rij of ['Cluster gepland', 'Afgesproken', 'Verschil', 'Dg gepland', 'Kans 1B valt']) await expect(tabel.locator('tfoot th', { hasText: rij })).toBeVisible();
  // het clustertotaal is de som van de regio's, het verschil is gepland min afgesproken
  const getallen = (rij: string) => tabel.locator('tfoot tr', { has: page.locator('th', { hasText: rij }) }).locator('td').allTextContents();
  const perRegio = await Promise.all(regios.map((_, i) => tabel.locator('tbody tr').nth(i).locator('td').allTextContents()));
  const totaal = (await getallen('Cluster gepland')).map(Number);
  // dezelfde getallen als onder het rooster van de regio
  expect(totaal.map(String)).toEqual(clusterOnderRooster);
  expect(await getallen('Afgesproken')).toEqual(clusterAfgesproken);
  expect(totaal).toEqual(perRegio[0].map((_, i) => perRegio.reduce((a, r) => a + Number(r[i]), 0)));
  const afgesproken = (await getallen('Afgesproken')).map(Number);
  const verschil = await getallen('Verschil');
  expect(verschil.map((v) => Number(v.replace('−', '-')))).toEqual(totaal.map((t, i) => t - afgesproken[i]));
  // het rooster van de regio staat niet in de weg: geen dienstkeuze en geen rooster maken
  await expect(page.getByRole('radiogroup', { name: 'Dienst kiezen' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Rooster maken', exact: true })).toBeHidden();
  // klik op een regio: het rooster van die regio
  await tabel.getByRole('button', { name: /Noord-Holland Midden/ }).click();
  await expect(page.getByRole('heading', { name: /Rooster Noord-Holland Midden/ })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Dienst kiezen' })).toBeVisible();
});

test('verlof goedkeuren zet V in het rooster (regiomanager)', async ({ page }) => {
  await laadDemo(page);
  // de planner ziet de aanvraag met het advies, maar besluit niet
  await alsRol(page, 'planner');
  await page.goto('/verlof');
  await expect(page.getByText(/Het besluit doet de regiomanager/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Goedkeuren' })).toHaveCount(0);
  await alsRol(page, 'regiomanager');
  await page.goto('/verlof');
  const eerste = page.locator('.box').filter({ has: page.getByRole('button', { name: 'Goedkeuren' }) }).first();
  await expect(eerste).toBeVisible();
  const aantal = await page.getByRole('button', { name: 'Goedkeuren' }).count();
  await eerste.getByRole('button', { name: 'Goedkeuren' }).click();
  await expect(page.getByText('Verlof goedgekeurd')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Goedkeuren' })).toHaveCount(aantal - 1);
  const ok = await staat<boolean>(page, `(s) => { const v = s.verlof.find((x) => x.status === 'goedgekeurd' && x.beoordeelaar !== 'demo'); return !!v && s.rooster[v.regio][v.medewerkerId][v.van] === 'V'; }`);
  expect(ok).toBe(true);
});

test('zo ingesteld keurt ook de planner verlof goed', async ({ page }) => {
  await laadDemo(page);
  // de beheerder zet het aan onder Instellingen
  await page.goto('/instellingen');
  const vink = page.getByLabel(/Ook de planner besluit over verlof/);
  await expect(vink).not.toBeChecked();
  await vink.check();
  await page.getByRole('button', { name: 'Opslaan' }).first().click();
  await expect(page.getByText(/Beleid opgeslagen/)).toBeVisible();
  // in de rechten staat het er nu bij
  await expect(page.getByText(/zo ingesteld besluit de planner ook over verlof/)).toBeVisible();
  await page.evaluate(() => (window as unknown as { __grip: Grip }).__grip.bewaarNu());
  await alsRol(page, 'planner');
  await page.goto('/verlof');
  const eerste = page.locator('.box').filter({ has: page.getByRole('button', { name: 'Goedkeuren' }) }).first();
  await expect(eerste).toBeVisible();
  await eerste.getByRole('button', { name: 'Goedkeuren' }).click();
  await expect(page.getByText('Verlof goedgekeurd')).toBeVisible();
});

test('ruil goedkeuren verwerkt de dienst', async ({ page }) => {
  await laadDemo(page);
  await page.goto('/ruilen');
  await expect(page.getByRole('button', { name: 'Goedkeuren' }).first()).toBeVisible();
  const r = await staat<{ id: string; regio: string; datum: string; ontvangerId: string; dienst: string }>(page, `(s) => s.ruil.find((x) => x.status === 'wacht_planner')`);
  await page.getByRole('button', { name: 'Goedkeuren' }).first().click();
  await expect(page.getByText('Ruil goedgekeurd')).toBeVisible();
  const dienst = await staat<string>(page, `(s) => s.rooster['${r.regio}']['${r.ontvangerId}']['${r.datum}']`);
  expect(dienst).toBe(r.dienst);
});

test('meldingen uploaden maakt een nieuwe run', async ({ page }) => {
  await laadDemo(page);
  await page.goto('/model');
  const regels = ['datum;regio;aantal'];
  for (let i = 0; i < 800; i++) {
    const d = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
    for (const r of ['Utrecht', 'Rotterdam']) regels.push(`${d};${r};${3 + ((i * 7 + r.length) % 5)}`);
  }
  await page.locator('input[type=file]').setInputFiles({ name: 'meldingen.csv', mimeType: 'text/csv', buffer: Buffer.from(regels.join('\n')) });
  await expect(page.getByRole('dialog')).toContainText('1.600');
  await page.getByRole('button', { name: 'Inlezen en voorspellen' }).click();
  await expect(page.getByText('Historie ingelezen')).toBeVisible({ timeout: 30_000 });
  expect(await staat<boolean>(page, '(s) => s.demo')).toBe(false);
  expect(await staat<string>(page, '(s) => s.runs[0].soort')).toBe('na upload');
  // daarna alleen de laatste dagen (de historie liep t/m 10 maart 2026): dat vult aan, de rest blijft
  await page.locator('input[type=file]').setInputFiles({ name: 'erbij.csv', mimeType: 'text/csv', buffer: Buffer.from('datum;regio;aantal\n2026-03-11;Utrecht;9\n2026-03-12;Utrecht;8\n2026-03-10;Utrecht;1') });
  const dialoog = page.getByRole('dialog');
  await expect(dialoog).toContainText('2 nieuwe regio-dagen, 1 bijgewerkt');
  await expect(dialoog).toContainText('1.599 regio-dagen met meldingen staan er niet in en verdwijnen dan');
  await page.getByRole('button', { name: 'Aanvullen en voorspellen' }).click();
  await expect(page.getByText('Meldingen aangevuld')).toBeVisible({ timeout: 30_000 });
  expect(await staat<number>(page, '(s) => s.meldingen.n')).toBe(802);
  expect(await staat<(number | null)[]>(page, '(s) => [s.meldingen.regios.Utrecht[0], s.meldingen.regios.Utrecht[799], s.meldingen.regios.Utrecht[801], s.meldingen.regios.Rotterdam[799], s.meldingen.regios.Rotterdam[801]]')).toEqual([5, 1, 8, 3 + ((799 * 7 + 9) % 5), null]);
});

test('dashboard: de regiomanager ziet het cluster van de werkregio, of links Landelijk; de beheerder het hele land', async ({ page }) => {
  await laadDemo(page);
  const kop = (naam: string) => page.getByRole('heading', { name: `${naam}, komende 60 dagen` });
  const werkregio = page.getByRole('combobox', { name: 'Werkregio' });
  const regioTabel = page.locator('section', { has: page.getByRole('heading', { name: /^Regio's · rooster / }) });
  // de beheerder: altijd landelijk, zonder keuze voor Landelijk
  await expect(kop('Landelijke drukte')).toBeVisible();
  await expect(werkregio.locator('option', { hasText: 'Landelijk' })).toHaveCount(0);
  // als regiomanager met werkregio Friesland: alleen cluster Noord
  await alsRol(page, 'regiomanager');
  await page.reload();
  await werkregio.selectOption('Friesland');
  await expect(kop('Drukte in cluster Noord')).toBeVisible();
  await expect(page.getByText('Je ziet cluster Noord; kies links Landelijk voor het hele land.')).toBeVisible();
  await expect(regioTabel.getByRole('row', { name: /Groningen/ })).toBeVisible();
  await expect(regioTabel.getByRole('row', { name: /Utrecht/ })).toHaveCount(0);
  // een regio in een ander cluster
  await werkregio.selectOption('Utrecht');
  await expect(kop('Drukte in cluster Oost')).toBeVisible();
  await expect(regioTabel.getByRole('row', { name: /Friesland/ })).toHaveCount(0);
  // links Landelijk: het hele land, ook na opnieuw laden; de werkregio blijft voor de pagina's per regio
  await werkregio.selectOption('Landelijk');
  await expect(kop('Landelijke drukte')).toBeVisible();
  await page.reload();
  await expect(kop('Landelijke drukte')).toBeVisible();
  await expect(werkregio).toHaveValue('landelijk');
  await page.goto('/rooster');
  await expect(page.locator('main').getByRole('combobox', { name: 'Regio', exact: true })).toHaveValue('Utrecht');
});

test('vastgestelde regelplekken: van de voorspelling naar de uitleg, en opnieuw berekenen uit de eigen meldingen', async ({ page }) => {
  await laadDemo(page);
  // vanuit de grafiek op het dashboard naar de uitleg
  await page.getByRole('radiogroup', { name: 'Dagen vooruit' }).getByRole('radio', { name: '150' }).click();
  await page.getByRole('link', { name: 'Verder vooruit: vastgestelde regelplekken' }).click();
  await expect(page).toHaveURL(/\/capaciteit$/);
  await expect(page.getByText('Na de voorspelling van 61 dagen rekent ook het rooster hiermee.')).toBeVisible();
  // opnieuw berekenen bij Bronnen en model: eerst zien wat er verandert, dan overnemen
  await page.getByRole('link', { name: 'Opnieuw berekenen' }).click();
  await expect(page).toHaveURL(/\/model#vastgesteld$/);
  const sectie = page.locator('#vastgesteld');
  await expect(sectie).toContainText('Bron: Nieuwe vastgestelde regelplekken 2027.');
  await sectie.getByRole('button', { name: 'Opnieuw berekenen' }).click();
  const dialoog = page.getByRole('dialog');
  await expect(dialoog).toContainText('Volume per regio');
  await expect(dialoog.getByRole('row', { name: /Utrecht/ })).toBeVisible();
  const voor = await staat<number>(page, '(s) => s.normen.regios.Utrecht.correctie');
  await dialoog.getByRole('button', { name: 'Overnemen' }).click();
  await expect(page.getByText('De vastgestelde regelplekken zijn opnieuw berekend en overgenomen.')).toBeVisible();
  await expect(sectie).toContainText('herberekend uit de eigen meldingen t/m');
  expect(await staat<number>(page, '(s) => s.normen.regios.Utrecht.correctie')).not.toBe(voor);
  // de nieuwe correctie staat bij Instellingen
  const na = await staat<number>(page, '(s) => s.normen.regios.Utrecht.correctie');
  await sectie.getByRole('link', { name: 'Aanpassen bij Instellingen' }).click();
  await expect(page).toHaveURL(/\/instellingen#normen$/);
  await expect(page.getByRole('textbox', { name: 'Correctie Utrecht' })).toHaveValue(String(na));
  await page.getByRole('button', { name: 'Terug naar de standaard' }).click();
  await expect(page.getByRole('textbox', { name: 'Correctie Utrecht' })).toHaveValue('1');
});

test('rooster maken uit voorkeuren: één voorstel, een andere verdeling, en de analyse', async ({ page }) => {
  await laadDemo(page);
  await page.goto('/rooster?regio=Utrecht');
  await expect(page.getByText(/Voorkeurenronde/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Rooster maken uit voorkeuren' }).click();
  await expect(page.getByRole('dialog').getByRole('radio', { name: 'Opnieuw plannen' })).toHaveAttribute('aria-checked', 'true');
  const dialoog = page.getByRole('dialog');
  // één voorstel volgens het beleid; de weging van voorkeuren staat standaard in het midden
  await expect(dialoog.getByRole('radio', { name: 'Volgens beleid' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Voorstel maken' }).click();
  await expect(dialoog.getByText('Medewerkertevredenheid')).toBeVisible({ timeout: 30_000 });
  await expect(dialoog.getByRole('columnheader', { name: 'Voorstel', exact: true })).toBeVisible();
  // eerst kijken wat nodig is, en in het overzicht: de klanten zonder hulp van het cluster en hoe vaak de 1B valt
  await expect(dialoog.getByTestId('werk-bezetting')).toContainText('Eerst uitrekenen hoeveel uur werk benodigd is');
  // de klanten: hoeveel meldingen binnen 24 uur een gesprek krijgen, in de eigen regio en met hulp van het cluster
  await expect(dialoog.getByText('Nabestaanden: hoeveel meldingen krijgen binnen 24 uur een regelgesprek')).toBeVisible();
  await expect(dialoog.getByText('Met hulp van het cluster')).toBeVisible();
  await expect(dialoog.getByText('Samen binnen 24 uur')).toBeVisible();
  // dagen tegenover meldingen: het aandeel dagen met genoeg plekken (eigen regio en cluster) staat er apart bij
  await expect(dialoog.getByText('Dagen met genoeg plekken, eigen regio (kans)')).toBeVisible();
  await expect(dialoog.getByText('Dagen met genoeg plekken, in het cluster (kans)')).toBeVisible();
  await expect(dialoog.getByText('De 1B valt, kans per dag')).toBeVisible();
  await expect(dialoog.getByText('… voor een melding uit de eigen regio')).toBeVisible();
  await expect(dialoog.getByText('Beschikbaarheidsdiensten (1B) per medewerker')).toBeVisible();
  await expect(dialoog.getByText('Harde overtredingen (ATW, CAO)').locator('xpath=..').locator('td').last()).toHaveText('0');
  // een andere verdeling: een ander rooster, nog steeds zonder overtredingen
  await dialoog.getByRole('button', { name: 'Andere verdeling' }).click();
  await expect(dialoog.getByRole('columnheader', { name: 'Voorstel (verdeling 2)' })).toBeVisible({ timeout: 30_000 });
  await expect(dialoog.getByText('Harde overtredingen (ATW, CAO)').locator('xpath=..').locator('td').last()).toHaveText('0');
  // en het voorstel legt uit waar het rekening mee houdt
  await dialoog.getByText('Waar houdt het voorstel rekening mee?').click();
  await expect(dialoog.getByText(/De regelplekken van de hele periode, de weekenden eerst/)).toBeVisible();
  await page.getByRole('button', { name: 'Voorstel toepassen' }).click();
  await expect(page.getByText(/Rooster gemaakt/)).toBeVisible();
  // geen dienst op een "kan niet"-dag
  const fout = await staat<number>(page, `(s) => {
    let n = 0;
    for (const m of s.medewerkers.filter((x) => x.regio === 'Utrecht')) {
      const p = s.profielen[m.id]; if (!p) continue;
      for (const [d, c] of Object.entries(s.rooster.Utrecht[m.id] ?? {})) {
        if (d < '${new Date().toISOString().slice(0, 10)}' || c === 'V') continue;
        // een wens om die datum te werken gaat voor de vaste voorkeur van de weekdag
        const wens = s.wensen.find((w) => w.medewerkerId === m.id && w.datum === d);
        if (wens && wens.soort !== 'vrij') continue;
        const wd = new Date(d + 'T12:00:00Z').getUTCDay();
        if (p.dagen[wd] !== 'niet') continue;
        // "kan niet" heeft een maximum aantal werkdagen per maand naar contract; daarboven weegt het als "liever niet"
        const max = m.contract >= 40 ? 2 : m.contract >= 36 ? 3 : m.contract >= 32 ? 5 : m.contract >= 28 ? 6 : 8;
        const eerder = Array.from({ length: Number(d.slice(8, 10)) }, (_, k) => d.slice(0, 8) + String(k + 1).padStart(2, '0'))
          .filter((x) => { const w = new Date(x + 'T12:00:00Z').getUTCDay(); return w % 6 !== 0 && p.dagen[w] === 'niet'; }).length;
        if (wd % 6 === 0 || eerder <= max) n++;
      }
    }
    return n;
  }`);
  expect(fout).toBe(0);
  await page.getByRole('radio', { name: /Analyse/ }).click();
  for (const p of ['Continuïteit', 'Efficiency', 'Medewerkers', 'Klanten']) await expect(page.getByRole('heading', { name: p, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tevredenheid per medewerker' })).toBeVisible();
});

test('voorkeurenronde openen voor een regio', async ({ page }) => {
  await laadDemo(page);
  await page.goto('/verlof?tab=voorkeuren');
  await page.locator('main').getByRole('combobox').first().selectOption('Breda');
  await page.getByRole('button', { name: 'Ronde openen' }).click();
  await expect(page.getByText(/Voorkeurenronde geopend/)).toBeVisible();
  expect(await staat<number>(page, `(s) => s.rondes.filter((r) => r.regio === 'Breda' && r.status === 'open').length`)).toBe(1);
  await expect(page.getByRole('link', { name: 'Rooster maken uit voorkeuren' })).toBeVisible();
});

test('dashboard laat de keten zien: voorspellen, rooster, bijsturen, verdelen', async ({ page }) => {
  await laadDemo(page);
  const keten = page.getByRole('list', { name: 'De keten' });
  for (const stap of ['Voorspellen', 'Rooster', 'Bijvoorspellen en bijsturen', 'Verdelen']) await expect(keten.getByRole('link', { name: new RegExp(stap) })).toBeVisible();
  await expect(page.getByText('Gemiddeld roostercijfer')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Per cluster' })).toBeVisible();
});

test('bijsturen: actie toepassen en ziekmelding', async ({ page }) => {
  await laadDemo(page);
  await page.goto('/bijsturen?regio=Utrecht');
  await expect(page.getByRole('heading', { name: /Bijsturen/ }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Wat er te doen is' })).toBeVisible();
  const toepassen = page.getByRole('button', { name: 'Toepassen' });
  if (await toepassen.count()) {
    await toepassen.first().click();
    await expect(page.getByText(/Bijgestuurd|Genoteerd/).first()).toBeVisible();
    expect(await staat<number>(page, `(s) => s.activiteit.filter((a) => a.soort === 'bijsturen').length`)).toBeGreaterThan(0);
  }
  const voor = await staat<number>(page, '(s) => s.ziekmeldingen.length');
  await page.getByRole('button', { name: 'Ziekmelding' }).click();
  const dialoog = page.getByRole('dialog');
  await dialoog.getByRole('combobox').first().selectOption({ index: 1 });
  await dialoog.getByRole('button', { name: /Ziek melden/ }).click();
  await expect.poll(() => staat<number>(page, '(s) => s.ziekmeldingen.length')).toBe(voor + 1);
});

test('beleid en capaciteit: regels met status en de keten uit de vastgestelde regelplekken', async ({ page }) => {
  await laadDemo(page);
  await page.goto('/beleid');
  await expect(page.getByRole('heading', { name: 'Wijzigingen voor 2027' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Origineel/ })).toHaveCount(0);
  await expect(page.getByText(/in orde/).first()).toBeVisible();
  await page.goto('/capaciteit');
  await expect(page.getByText('Te borgen uren per week')).toBeVisible();
  await expect(page.getByRole('row', { name: /Totaal/ })).toContainText('40.725');
});

test('vakantieronde: advies per aanvraag en besluit', async ({ page }) => {
  await laadDemo(page);
  await page.goto('/verlof?tab=vakantie');
  await expect(page.getByText(/Zomervakantie 2027/).first()).toBeVisible();
  await expect(page.getByText(/Past|Past krap|Past niet/).first()).toBeVisible();
});

test('verlof ruilen: collega gaat akkoord, regiomanager keurt goed', async ({ page }) => {
  await laadDemo(page);
  const r = await staat<{ id: string; ontvangerId: string; verlofId: string; tegenVerlofId: string; datum: string; tegenDatum: string }>(page, `(s) => s.ruil.find((x) => x.soort === 'verlof' && x.status === 'open')`);
  expect(r).toBeTruthy();
  await page.evaluate((mid) => localStorage.setItem('grip-bekijk-als', JSON.stringify({ rol: 'medewerker', medewerkerId: mid })), r.ontvangerId);
  await page.goto('/ruilen');
  const verzoek = page.locator('li').filter({ hasText: 'ruilt verlof' }).first();
  await expect(verzoek).toBeVisible();
  await verzoek.getByRole('button', { name: 'Akkoord' }).click();
  await expect.poll(() => staat<string>(page, `(s) => s.ruil.find((x) => x.id === '${r.id}').status`)).toBe('wacht_planner');
  await page.evaluate(() => (window as unknown as { __grip: Grip }).__grip.bewaarNu());

  // over verlof besluit de regiomanager
  await alsRol(page, 'regiomanager');
  await page.goto('/ruilen');
  const kaart = page.locator('.box').filter({ hasText: 'ruilt verlof' }).first();
  await expect(kaart).toContainText('De bezetting per dag blijft gelijk');
  await kaart.getByRole('button', { name: 'Goedkeuren' }).click();
  await expect(page.getByText('Ruil goedgekeurd')).toBeVisible();
  expect(await staat<string>(page, `(s) => s.verlof.find((v) => v.id === '${r.verlofId}').van`)).toBe(r.tegenDatum);
  expect(await staat<string>(page, `(s) => s.verlof.find((v) => v.id === '${r.tegenVerlofId}').van`)).toBe(r.datum);
});

test('zijbalk en zoeken: met Ctrl+K naar het rooster van een regio, en de werkregio gaat mee', async ({ page }) => {
  await laadDemo(page);
  await page.getByRole('navigation', { name: 'Onderdelen' }).getByRole('link', { name: 'Capaciteit' }).click();
  await expect(page).toHaveURL(/\/capaciteit/);
  await page.keyboard.press('Control+k');
  const zoek = page.getByRole('dialog', { name: 'Zoeken' });
  await zoek.getByRole('combobox').fill('rooster utrecht');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/rooster\?regio=Utrecht/);
  await expect(page.getByLabel('Werkregio')).toHaveValue('Utrecht');
  // de werkregio geldt daarna ook op andere pagina's
  await page.getByRole('navigation', { name: 'Onderdelen' }).getByRole('link', { name: 'Team' }).click();
  await expect(page.getByRole('heading', { name: /Team Utrecht/ })).toBeVisible();
  // zoeken in het beleid
  await page.keyboard.press('/');
  await page.getByRole('dialog', { name: 'Zoeken' }).getByRole('combobox').fill('dagsturing');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/beleid#p-3\.9/);
});

test('team: details per medewerker; ZZP\'ers staan voorlopig niet in het rooster', async ({ page }) => {
  await laadDemo(page);
  await page.goto('/team?regio=Utrecht');
  await expect(page.getByText('Weekenden dit jaar')).toBeVisible();
  await page.locator('tbody tr').first().click();
  const detail = page.getByRole('dialog');
  await expect(detail.getByText('Meeste 1B in 28 dagen')).toBeVisible();
  await detail.getByRole('button', { name: 'Sluiten' }).last().click();
  // geen externen in de demo, geen knop om ze toe te voegen en geen keuze in het formulier
  expect(await staat<number>(page, '(s) => s.medewerkers.filter((m) => m.extern).length')).toBe(0);
  await expect(page.getByRole('button', { name: 'Externe kracht toevoegen' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: "Externen en ZZP'ers" })).toHaveCount(0);
  await page.getByRole('button', { name: 'Medewerker toevoegen' }).click();
  await expect(page.getByRole('dialog').getByText("Externe kracht of ZZP'er")).toHaveCount(0);
});

test('bijsturen: diensttijden vastleggen binnen de ATW-termijn', async ({ page }) => {
  await laadDemo(page);
  await page.goto('/bijsturen?regio=Utrecht');
  await expect(page.getByRole('heading', { name: 'Diensttijden vastleggen' })).toBeVisible();
  const knop = page.getByRole('button', { name: 'Tijden vastleggen' });
  if (await knop.count()) {
    const voor = await knop.count();
    await knop.first().click();
    await page.getByLabel('Begintijd').first().fill('10:00');
    await page.getByLabel('Eindtijd').first().fill('18:00');
    await page.getByRole('button', { name: 'Vastleggen' }).first().click();
    await expect(page.getByText(/Tijden .* vastgelegd: 10:00–18:00/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tijden vastleggen' })).toHaveCount(voor - 1);
  }
});

test('jaarplanning: verlof plannen vanuit de jaarkalender, zonder verlofrecht of saldo', async ({ page }) => {
  await laadDemo(page);
  await alsRol(page, 'regiomanager');
  await page.goto('/jaarplanning?regio=Utrecht');
  await expect(page.getByRole('heading', { name: /Jaarplanning/ })).toBeVisible();
  await expect(page.getByRole('table', { name: /Jaarkalender verlof Utrecht/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Vakantieproces/ })).toBeVisible();
  // een lege week in december inplannen en direct goedkeuren
  const leeg = page.getByRole('button', { name: /, week 50: geen verlof/ }).first();
  const naam = ((await leeg.getAttribute('aria-label')) ?? '').split(',')[0];
  const voor = await staat<number>(page, `(s) => s.verlof.filter((v) => v.status === 'goedgekeurd').length`);
  await leeg.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Plannen en goedkeuren' }).click();
  await expect(page.getByText('Verlof gepland en goedgekeurd.')).toBeVisible();
  expect(await staat<number>(page, `(s) => s.verlof.filter((v) => v.status === 'goedgekeurd').length`)).toBe(voor + 1);
  await expect(page.getByRole('button', { name: `${naam}, week 50: hele week verlof, goedgekeurd` })).toBeVisible();
  // verlofrecht en saldo staan niet in GRIP; wel of de vakanties eerlijk verdeeld zijn
  await expect(page.getByRole('heading', { name: 'Vakanties eerlijk verdeeld' })).toBeVisible();
  await expect(page.getByText(/Verlofrecht|Nog te plannen|Opgenomen/)).toHaveCount(0);
  // naar volgend jaar
  await page.getByRole('button', { name: 'Volgend jaar' }).click();
  await expect(page).toHaveURL(/jaar=\d{4}/);
  // de oude tab verlofruimte gaat naar de jaarplanning
  await page.goto('/verlof?tab=planning');
  await expect(page).toHaveURL(/\/jaarplanning/);
});

test('rollen: de regiomanager ziet wat er op goedkeuring wacht; de rechten staan onder Instellingen', async ({ page }) => {
  await laadDemo(page);
  await page.goto('/instellingen');
  await expect(page.getByRole('heading', { name: 'Rollen en rechten' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Rooster goedkeuren of afkeuren/ })).toBeVisible();
  // via het menu als regiomanager meekijken
  await page.goto('/dashboard');
  await page.getByRole('button', { name: /Lokale gebruiker/ }).click();
  await page.getByRole('radio', { name: 'Regiomanager' }).click();
  await expect(page.getByText('Je bekijkt de app als regiomanager')).toBeVisible();
  await expect(page.getByText(/wachten? op jouw (goedkeuring|besluit)/).first()).toBeVisible();
  // de regiomanager richt de app niet in
  await expect(page.getByRole('navigation', { name: 'Onderdelen' }).getByRole('link', { name: 'Instellingen' })).toHaveCount(0);
});

test('verdeling: slim tegenover dichtstbij, met uitleg per melding en eigen gewichten', async ({ page }) => {
  await laadDemo(page);
  await page.getByRole('navigation', { name: 'Onderdelen' }).getByRole('link', { name: 'Verdelen' }).click();
  await page.getByRole('radio', { name: 'Simulatie' }).click();
  await expect(page).toHaveURL(/weergave=simulatie/);
  await expect(page.getByRole('heading', { name: 'Slim tegenover dichtstbij' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('row', { name: /^Ingepland/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ruimte per cluster na de verdeling' })).toBeVisible();
  // uitleg bij een melding
  await page.getByRole('button', { name: 'Uitleg bij M001' }).click();
  await expect(page.getByLabel('Kosten van deze toewijzing')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Uitleg bij M001' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText(/rijden (van huis|na )/).first()).toBeVisible();
  // een gewicht aanpassen en opnieuw verdelen
  const knop = page.getByRole('button', { name: 'Opnieuw verdelen', exact: true });
  await expect(knop).toBeDisabled();
  // een leeg vak tijdens het typen kan; toepassen pas met een getal
  await page.getByLabel('1B inzetten').fill('');
  await expect(knop).toBeDisabled();
  await page.getByLabel('1B inzetten').fill('500');
  await knop.click();
  await expect(knop).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('grip-verdeling-gewichten') ?? '{}').inzet1B)).toBe(500);
  // andere meldingen
  const eerste = page.getByRole('row', { name: /^Uitleg bij M001 / });
  const voor = await eerste.innerText();
  await page.getByRole('button', { name: 'Andere meldingen' }).click();
  await expect(eerste).not.toHaveText(voor, { timeout: 30_000 });
});

test('verdelen: meldingen van de dag invoeren, in één keer verdelen, de kans op de 1B en doorgeven', async ({ page }) => {
  await laadDemo(page);
  await page.getByRole('navigation', { name: 'Onderdelen' }).getByRole('link', { name: 'Verdelen' }).click();
  await expect(page.getByRole('heading', { name: /Meldingen\s*verdelen/ })).toBeVisible();
  // bovenaan de uitleg: de volgorde van plekken
  await expect(page.getByRole('list', { name: 'Volgorde van plekken' })).toContainText('Tweede gesprek van een 2');
  const datum = await page.getByLabel('Dag', { exact: true }).inputValue();
  // een melding: postcode, de regio volgt uit de postcode
  await page.getByLabel('Postcode', { exact: true }).fill('3512');
  await expect(page.locator('main').getByRole('combobox', { name: 'Regio', exact: true })).toContainText('Utrecht (op postcode)');
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click();
  await expect(page.getByText('Melding M1 toegevoegd')).toBeVisible();
  // een lijst plakken, met een afgesproken tijd
  await page.getByText('Een lijst plakken').click();
  await page.getByLabel('Lijst met postcodes').fill('3523\n3583 AB 13:00\n1012');
  await page.getByRole('button', { name: 'Lijst toevoegen' }).click();
  await expect(page.getByText('3 meldingen toegevoegd')).toBeVisible();
  expect(await staat<{ postcode: string; regio: string; tijd?: number }[]>(page, `(s) => s.verdelingen['${datum}'].meldingen`)).toEqual([
    { id: 'M1', postcode: '3512', regio: 'Utrecht' }, { id: 'M2', postcode: '3523', regio: 'Utrecht' }, { id: 'M3', postcode: '3583', regio: 'Utrecht', tijd: 780 }, { id: 'M4', postcode: '1012', regio: 'Amsterdam' },
  ].map((m) => expect.objectContaining(m)));

  // alles in één keer verdelen
  await page.getByRole('button', { name: 'Verdelen', exact: true }).click();
  await expect(page.getByText('Verdeeld', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  const toewijzingen = await staat<{ meldingId: string; start: number }[]>(page, `(s) => s.verdelingen['${datum}'].toewijzingen`);
  expect(toewijzingen).toHaveLength(4);
  for (const t of toewijzingen) expect(t.meldingId === 'M3' ? [780] : [600, 780]).toContain(t.start);
  // per melding de stap, en de telling per stap
  await expect(page.getByLabel('Verdeeld per stap')).toContainText('1. Eigen regio');
  await expect(page.getByRole('row', { name: /^Uitleg bij M1 / })).toContainText(/\d\. (Eigen regio|Elders in het cluster|Tweede gesprek van een 2|1B)/);
  // de kans dat de 1B nog valt, met de uitleg
  await expect(page.getByRole('heading', { name: 'Kans dat de 1B nog valt' })).toBeVisible();
  const oost = page.getByLabel('Kans 1B Oost');
  await expect(oost).toContainText('volgens het rooster');
  await expect(oost).toContainText(/Na 07:00 verwachten we nog/);
  // uitleg bij een melding
  await page.getByRole('button', { name: 'Uitleg bij M1' }).click();
  await expect(page.getByLabel('Kosten van deze toewijzing')).toBeVisible();

  // doorgeven: blijft staan
  await page.getByRole('button', { name: 'Doorgeven' }).click();
  await expect(page.getByText('Doorgegeven', { exact: true })).toHaveCount(4);
  expect(await staat<boolean>(page, `(s) => s.verdelingen['${datum}'].toewijzingen.every((t) => t.vast)`)).toBe(true);
  // een doorgegeven melding verwijder je pas na vrijgeven
  await expect(page.getByRole('button', { name: 'Verwijder M2' })).toBeDisabled();

  // een woonplaats invullen: bewaard bij de medewerker, alleen de 4 cijfers
  await page.getByText(/uitvaartverzorgers · 0 met postcode/).click();
  const woon = page.locator('details', { hasText: 'met postcode' });
  await woon.getByRole('textbox').first().fill('3511 AB');
  await woon.getByRole('button', { name: 'Woonplaatsen bewaren' }).click();
  await expect(page.getByText(/uitvaartverzorgers · 1 met postcode/)).toBeVisible();
  expect(await staat<string[]>(page, '(s) => s.medewerkers.filter((m) => m.postcode).map((m) => m.postcode)')).toEqual(['3511']);

  // na opnieuw openen: dezelfde verdeling, met de uitleg en de kans erbij
  await page.evaluate(() => (window as unknown as { __grip: Grip }).__grip.bewaarNu());
  await page.reload();
  await expect(page.getByText('Doorgegeven', { exact: true })).toHaveCount(4, { timeout: 30_000 });
  await expect(page.getByLabel('Kans 1B Oost')).toBeVisible({ timeout: 30_000 });
  expect(await staat<{ slotId: string }[]>(page, `(s) => s.verdelingen['${datum}'].toewijzingen`)).toEqual(toewijzingen.map((t) => expect.objectContaining({ meldingId: t.meldingId })));
});

test('verdeling: met een (nagebootste) live aanbieder, zonder kosten', async ({ page }) => {
  let gevraagd = 0;
  await page.context().route('**/api/reistijd', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { aanbieder: 'tomtom' } });
    const body = req.postDataJSON() as { paren: unknown[] };
    gevraagd += body.paren.length;
    return route.fulfill({ json: { aanbieder: 'tomtom', minuten: body.paren.map(() => 22) } });
  });
  await laadDemo(page);
  await page.goto('/verdeling?weergave=simulatie');
  await expect(page.getByRole('heading', { name: 'Slim tegenover dichtstbij' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('radio', { name: 'Live verkeer' }).click();
  await expect(page.getByText(/reistijden met live verkeer/)).toBeVisible({ timeout: 30_000 });
  expect(gevraagd).toBeGreaterThan(100);
  // terug naar de schatting
  await page.getByRole('radio', { name: 'Schatting', exact: true }).click();
  await expect(page.getByText(/reistijden met live verkeer/)).toHaveCount(0, { timeout: 30_000 });
});

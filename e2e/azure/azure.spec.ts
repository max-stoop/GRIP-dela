import { expect, test, type Page } from '@playwright/test';

/** Elke aanvraag aan de database die mislukt, voor de controle aan het eind van een test. */
function dbFouten(page: Page): string[] {
  const fouten: string[] = [];
  page.on('response', async (r) => { if (r.url().endsWith('/api/db') && r.status() >= 400) fouten.push(`${r.status()} ${await r.text().catch(() => '')}`); });
  return fouten;
}

const cellen = (page: Page) => page.evaluate(() => {
  const s = (window as unknown as { __grip: { getState: () => { rooster: Record<string, Record<string, Record<string, string>>> } } }).__grip.getState();
  return Object.values(s.rooster.Utrecht ?? {}).reduce((a, r) => a + Object.keys(r).length, 0);
});

async function inloggen(page: Page, email: string) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', { name: 'Inloggen met je werkaccount' }).click();
  await page.getByLabel('E-mailadres').fill(email);
  await page.getByRole('button', { name: 'Inloggen' }).click();
}

test('inloggen met het werkaccount en weer uitloggen', async ({ page }) => {
  await inloggen(page, 'Beheer@Voorbeeld.nl');
  await expect(page.getByRole('heading', { name: 'Nog geen gegevens' })).toBeVisible();
  await page.getByRole('button', { name: /Bea Beheer/ }).click();
  await page.getByRole('button', { name: 'Uitloggen' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
});

test('een werkaccount dat niet in GRIP staat, komt er niet in', async ({ page, baseURL }) => {
  await inloggen(page, 'onbekend@voorbeeld.nl');
  await expect(page.getByRole('heading', { name: 'Geen toegang' })).toBeVisible();
  const r = await page.request.post('/api/db', { data: { op: 'lees', tabel: 'rp_medewerker' }, headers: { origin: baseURL! } });
  expect(r.status()).toBe(200);
  expect((await r.json()).uit).toEqual([]);
});

test('wat de een bewaart, ziet een collega meteen, zonder te vernieuwen', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await inloggen(a, 'beheer@voorbeeld.nl');
  await inloggen(b, 'plan@voorbeeld.nl');
  await a.goto('/team?regio=Utrecht');
  await b.goto('/team?regio=Utrecht');
  await expect(b.getByRole('button', { name: 'Medewerker toevoegen' })).toBeVisible();
  await a.getByRole('button', { name: 'Medewerker toevoegen' }).click();
  await a.getByLabel('Naam').fill('Lotte Live');
  await a.getByRole('dialog').getByRole('button', { name: 'Toevoegen' }).click();
  await a.evaluate(() => (window as unknown as { __grip: { bewaarNu: () => Promise<void> } }).__grip.bewaarNu());
  await expect(b.getByText('Lotte Live').first()).toBeVisible({ timeout: 15_000 });
  // en na vernieuwen staat het er nog: het komt uit de database
  await a.reload();
  await expect(a.getByText('Lotte Live').first()).toBeVisible();
});

test('een rooster maken: het gaat in één keer naar de database en komt na vernieuwen terug', async ({ page }) => {
  const fouten = dbFouten(page);
  await inloggen(page, 'plan@voorbeeld.nl');
  await page.goto('/rooster?regio=Utrecht');
  for (const [naam, email] of [['Ruud Rooster', ''], ['Sanne Shift', ''], ['Tom Tijd', 'mw@voorbeeld.nl']]) {
    await page.getByRole('button', { name: 'Medewerker toevoegen' }).click();
    await page.getByLabel('Naam').fill(naam);
    if (email) await page.getByLabel('E-mailadres').fill(email);
    await page.getByRole('dialog').getByRole('button', { name: 'Toevoegen' }).click();
    await expect(page.locator('tbody th.nm', { hasText: naam })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Rooster maken', exact: true }).click();
  await page.getByRole('button', { name: 'Voorstel maken' }).click();
  await expect(page.getByText(/Groen is beter dan nu/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Voorstel toepassen' }).click();
  await expect(page.getByText(/Rooster gemaakt/)).toBeVisible();
  await page.evaluate(() => (window as unknown as { __grip: { bewaarNu: () => Promise<void> } }).__grip.bewaarNu());
  const voor = await cellen(page);
  expect(voor).toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator('tbody th.nm', { hasText: 'Tom Tijd' })).toBeVisible();
  expect(await cellen(page)).toBe(voor);
  expect(fouten).toEqual([]);
});

test('een medewerker logt in en ziet het eigen rooster, niet dat van anderen', async ({ page, baseURL }) => {
  const fouten = dbFouten(page);
  await inloggen(page, 'mw@voorbeeld.nl');
  await expect(page).toHaveURL(/mijn-rooster/);
  await expect(page.getByRole('button', { name: /Mia Medewerker/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nog niet gekoppeld' })).toHaveCount(0);
  const r = await page.request.post('/api/db', { data: { op: 'lees', tabel: 'rp_medewerker', opties: { kolommen: 'naam, email' } }, headers: { origin: baseURL! } });
  expect((await r.json()).uit).toEqual([{ naam: 'Tom Tijd', email: 'mw@voorbeeld.nl' }]);
  await page.goto('/rooster?regio=Utrecht');
  await expect(page.getByText('Deze pagina is niet beschikbaar voor jouw rol.')).toBeVisible();
  expect(fouten).toEqual([]);
});

test('wensen per datum: kiezen, wijzigen en weghalen, ook door een planner die meekijkt als medewerker', async ({ browser }) => {
  for (const [email, naam] of [['mw@voorbeeld.nl', 'Mia Medewerker'], ['plan@voorbeeld.nl', 'Piet Plan']]) {
    const page = await (await browser.newContext()).newPage();
    const fouten = dbFouten(page);
    await inloggen(page, email);
    if (email === 'plan@voorbeeld.nl') {
      await page.getByRole('button', { name: new RegExp(naam) }).click();
      await page.getByRole('radio', { name: 'Medewerker' }).click();
      await page.getByLabel('Medewerker', { exact: true }).selectOption({ label: 'Tom Tijd · Utrecht' });
    }
    await page.goto('/verlof');
    const bewaar = () => page.evaluate(() => (window as unknown as { __grip: { bewaarNu: () => Promise<void> } }).__grip.bewaarNu());
    const inDb = async () => {
      await bewaar();
      const r = await page.request.post('/api/db', { data: { op: 'lees', tabel: 'rp_wens', opties: { kolommen: 'soort' } }, headers: { origin: new URL(page.url()).origin } });
      return ((await r.json()).uit as { soort: string }[]).map((w) => w.soort);
    };
    const dag = page.locator('button[data-dag]:not([disabled])').nth(4);
    await dag.click();
    await page.getByRole('menuitem', { name: 'Wil graag werken' }).click();
    expect(await inDb()).toEqual(['werken']);
    await dag.click();
    await page.getByRole('menuitem', { name: 'Liever ochtend' }).click();
    expect(await inDb()).toEqual(['ochtend']);
    await dag.click();
    await page.getByRole('menuitem', { name: 'Wens weghalen' }).click();
    expect(await inDb()).toEqual([]);
    expect(fouten).toEqual([]);
    await page.context().close();
  }
});

test('teamwensen: een medewerker ziet per dag hoeveel collega\'s wat hebben opgegeven, en neemt de standaard over in een week', async ({ page }) => {
  // twee collega's in Utrecht met een wens over drie weken, en een collega in een andere regio (telt niet mee)
  const { Client } = await import('pg');
  const c = new Client({ connectionString: process.env.GRIP_E2E_DATABASE });
  await c.connect();
  const dag = new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10);
  try {
    await c.query(`insert into rp_medewerker (regio, naam, contract) values ('Utrecht', 'Wens Collega A', 32), ('Utrecht', 'Wens Collega B', 24), ('Amsterdam', 'Wens Collega C', 32) on conflict do nothing`);
    await c.query(`insert into rp_wens (medewerker_id, regio, datum, soort, opmerking)
      select m.id, m.regio, $1::date, case m.naam when 'Wens Collega A' then 'ochtend' else 'vrij' end, 'alleen voor de planner' from rp_medewerker m where m.naam like 'Wens Collega %'
      on conflict (medewerker_id, datum) do update set soort = excluded.soort`, [dag]);
  } finally {
    await c.end();
  }
  const fouten = dbFouten(page);
  await inloggen(page, 'mw@voorbeeld.nl');
  await page.goto('/verlof');
  await page.getByRole('combobox', { name: 'Maand' }).selectOption(dag.slice(0, 7));
  await page.locator(`button[data-dag="${dag}"]`).click();
  await expect(page.getByTestId('team-stand')).toContainText('1 wil werken, 1 liever vrij');
  await page.keyboard.press('Escape');
  // de medewerker leest zelf geen wensen van collega's: alleen de aantallen
  const state = await page.evaluate(() => {
    const s = (window as unknown as { __grip: { getState: () => { wensen: { opmerking?: string }[]; wensenTeam: Record<string, unknown> | null } } }).__grip.getState();
    return { wensen: s.wensen.length, team: s.wensenTeam };
  });
  expect(state).toEqual({ wensen: 0, team: { [dag]: { werken: 1, vrij: 1, neutraal: 0, overig: 0 } } });
  const r = await page.request.post('/api/db', { data: { op: 'lees', tabel: 'rp_wens', opties: { kolommen: 'opmerking' } }, headers: { origin: new URL(page.url()).origin } });
  expect((await r.json()).uit).toEqual([]);

  // standaard overnemen in die week: zeven wensen in de database, en weer weg
  const telDb = async () => {
    await page.evaluate(() => (window as unknown as { __grip: { bewaarNu: () => Promise<void> } }).__grip.bewaarNu());
    const x = await page.request.post('/api/db', { data: { op: 'lees', tabel: 'rp_wens', opties: { kolommen: 'soort' } }, headers: { origin: new URL(page.url()).origin } });
    return ((await x.json()).uit as unknown[]).length;
  };
  const week = page.locator('button[data-week]:not([disabled])').last();
  await week.click();
  await page.getByRole('menuitem', { name: /Standaard overnemen/ }).click();
  await expect(page.getByText(/Je vaste voorkeuren staan in week \d+: 7 dagen ingevuld/)).toBeVisible();
  expect(await telDb()).toBe(7);
  await week.click();
  await page.getByRole('menuitem', { name: /Week leegmaken/ }).click();
  expect(await telDb()).toBe(0);
  expect(fouten).toEqual([]);
});

test('een gebruiker toevoegen: die logt daarna in met het werkaccount', async ({ browser }) => {
  const beheer = await (await browser.newContext()).newPage();
  await inloggen(beheer, 'beheer@voorbeeld.nl');
  await beheer.goto('/instellingen');
  await beheer.getByRole('button', { name: 'Gebruiker toevoegen' }).click();
  const d = beheer.getByRole('dialog');
  await d.getByLabel('Naam').fill('Nina Nieuw');
  await d.getByLabel('E-mailadres (werk)').fill('nina@voorbeeld.nl');
  await d.getByRole('button', { name: 'Toevoegen' }).click();
  await expect(beheer.getByText('Microsoft stuurt nina@voorbeeld.nl een uitnodiging per e-mail.', { exact: false })).toBeVisible();
  const rij = beheer.getByRole('row', { name: /Nina Nieuw/ });
  await expect(rij.getByText('nog niet ingelogd')).toBeVisible();
  await rij.getByRole('button', { name: 'Uitnodiging opnieuw sturen naar Nina Nieuw' }).click();
  await expect(beheer.getByText('Microsoft stuurt nina@voorbeeld.nl een uitnodiging per e-mail.', { exact: false }).last()).toBeVisible();
  await expect(beheer.getByRole('button', { name: /Tijdelijk wachtwoord/ })).toHaveCount(0);

  const nina = await (await browser.newContext()).newPage();
  await inloggen(nina, 'nina@voorbeeld.nl');
  await expect(nina.getByRole('heading', { name: 'Geen toegang' })).toHaveCount(0);
  await expect(nina.getByRole('button', { name: /Nina Nieuw/ })).toBeVisible();
  await beheer.reload();
  await expect(beheer.getByRole('row', { name: /Nina Nieuw/ }).getByText('heeft ingelogd')).toBeVisible();
});

test('een nieuwe database: het werkaccount uit GRIP_BEHEERDER wordt bij de eerste keer beheerder', async ({ page }) => {
  await inloggen(page, 'eerste@voorbeeld.nl');
  await expect(page.getByRole('button', { name: /eerste.*Beheerder/ })).toBeVisible();
  await page.goto('/instellingen');
  await expect(page.getByRole('row', { name: /eerste@voorbeeld\.nl/ }).getByText('heeft ingelogd')).toBeVisible();
});

test('een regiomanager zonder regio\'s komt er niet in en krijgt niets uit de database of live', async ({ page, baseURL }) => {
  await inloggen(page, 'rmleeg@voorbeeld.nl');
  await expect(page.getByRole('heading', { name: 'Geen toegang' })).toBeVisible();
  await expect(page.getByText(/geen regio.s aan je account gekoppeld/)).toBeVisible();
  await page.screenshot({ path: 'test-results/schermen/regiomanager-zonder-regios.png' });
  const r = await page.request.post('/api/db', { data: { op: 'lees', tabel: 'rp_medewerker' }, headers: { origin: baseURL! } });
  expect((await r.json()).uit).toEqual([]);
  expect((await page.request.get('/api/live')).status()).toBe(403);
});

test('gebruikersbeheer: een regiomanager kiest regio\'s; zonder regio\'s bewaart het niet', async ({ page }) => {
  await inloggen(page, 'beheer@voorbeeld.nl');
  await page.goto('/instellingen');
  // in de lijst: wie geen regio's heeft, staat er in het rood bij
  await expect(page.getByRole('row', { name: /Rik Zonder Regio/ }).getByText(/geen regio.s: geen toegang/)).toBeVisible();
  await page.getByRole('button', { name: 'Gebruiker toevoegen' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Naam').fill('Rosa Regio');
  await d.getByLabel('E-mailadres (werk)').fill('rosa@voorbeeld.nl');
  await d.getByLabel('Rol').selectOption({ label: 'Regiomanager' });
  await expect(d.getByRole('checkbox', { name: /Alle regio/ })).not.toBeChecked();
  // de NBD is een eigen module: niet tussen de regio's, maar apart
  await expect(d.getByRole('checkbox', { name: /NBD/ })).toHaveCount(1);
  await expect(d.getByRole('group', { name: 'Regio\'s' }).getByRole('checkbox', { name: /NBD/ })).toHaveCount(0);
  await expect(d.getByRole('group', { name: 'Nabestaandendesk' }).getByRole('checkbox', { name: 'Ook de nabestaandendesk (NBD)' })).toBeVisible();
  await expect(d.getByText(/Kies minstens één regio/)).toBeVisible();
  await page.screenshot({ path: 'test-results/schermen/gebruiker-regiomanager.png' });
  await d.getByRole('button', { name: 'Toevoegen' }).click();
  await expect(d.getByRole('alert')).toContainText('regiomanager');
  await d.getByRole('checkbox', { name: 'Utrecht' }).check();
  await d.getByRole('button', { name: 'Toevoegen' }).click();
  await expect(page.getByRole('row', { name: /Rosa Regio/ }).getByText('Utrecht')).toBeVisible();
});

test('vier ogen: wie het advies gaf, keurt niet zelf goed; de regiomanager wel', async ({ browser }) => {
  const beheer = await (await browser.newContext()).newPage();
  const fouten = dbFouten(beheer);
  await inloggen(beheer, 'beheer@voorbeeld.nl');
  await beheer.goto('/rooster?regio=Utrecht');
  await beheer.getByRole('button', { name: 'Advies geven en aanbieden' }).click();
  const d = beheer.getByRole('dialog');
  await d.getByRole('radio', { name: /Oranje/ }).click();
  await d.getByRole('textbox').fill('Krap team, drie mensen voor de hele maand');
  await d.getByRole('button', { name: 'Advies geven en aanbieden' }).click();
  await expect(beheer.getByText('Je gaf zelf het advies voor deze maand. Een ander keurt goed of af (vier ogen, § 5.1).')).toBeVisible();
  await expect(beheer.getByRole('button', { name: 'Goedkeuren', exact: true })).toBeDisabled();
  await expect(beheer.getByRole('button', { name: 'Afkeuren', exact: true })).toBeDisabled();
  await beheer.evaluate(() => (window as unknown as { __grip: { bewaarNu: () => Promise<void> } }).__grip.bewaarNu());
  await beheer.screenshot({ path: 'test-results/schermen/vier-ogen.png', fullPage: true });
  expect(fouten).toEqual([]);

  const rm = await (await browser.newContext()).newPage();
  const foutenRm = dbFouten(rm);
  await inloggen(rm, 'rm@voorbeeld.nl');
  await rm.goto('/rooster?regio=Utrecht');
  const goed = rm.getByRole('button', { name: 'Goedkeuren', exact: true });
  await expect(goed).toBeEnabled();
  await goed.click();
  await expect(rm.getByText(/Vastgesteld door Rob Regiomanager/)).toBeVisible();
  await rm.evaluate(() => (window as unknown as { __grip: { bewaarNu: () => Promise<void> } }).__grip.bewaarNu());
  await rm.reload();
  await expect(rm.getByText(/Vastgesteld door Rob Regiomanager/)).toBeVisible();
  expect(foutenRm).toEqual([]);
});

test('de server-routes zonder sessie, van een andere site of zonder sleutel', async ({ request, baseURL }) => {
  expect((await request.post('/api/db', { data: { op: 'schemaVersie' }, headers: { origin: baseURL! } })).status()).toBe(401);
  expect((await request.post('/api/db', { data: { op: 'schemaVersie' }, headers: { origin: 'https://kwaad.example.com' } })).status()).toBe(403);
  expect((await request.get('/api/live')).status()).toBe(401);
  expect((await request.get('/api/taken/dagelijks')).status()).toBe(401);
  expect((await request.get('/api/gebruikers')).status()).toBe(401);
});

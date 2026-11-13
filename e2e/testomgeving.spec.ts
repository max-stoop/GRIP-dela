import { test, expect, type Page } from '@playwright/test';
import { alsMedewerker, laadDemo, staat } from './helpers';

function volgendeMaand(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Diensten in de lijn bij de NBD in een maand, in de app nu. */
const nbdDiensten = (page: Page, maand: string) => staat<number>(page, `(s) => Object.values(s.rooster.NBD ?? {}).flatMap((r) => Object.entries(r)).filter(([d, c]) => d.startsWith('${maand}') && c === 'N').length`);

/** Hetzelfde, maar uit de echte opslag in de browser (niet die van de test). */
const echtOpgeslagen = (page: Page, maand: string) => page.evaluate((m) => new Promise<number>((klaar, fout) => {
  const req = indexedDB.open('grip-regelplekken');
  req.onerror = () => fout(req.error);
  req.onsuccess = () => {
    const get = req.result.transaction('kv', 'readonly').objectStore('kv').get('core');
    get.onsuccess = () => {
      const rooster = (get.result?.rooster?.NBD ?? {}) as Record<string, Record<string, string>>;
      klaar(Object.values(rooster).flatMap((r) => Object.entries(r)).filter(([d, c]) => d.startsWith(m) && c === 'N').length);
    };
  };
}), maand);

test('testomgeving: rechtsboven starten, alles uitproberen, niets aan de echte gegevens; terug naar echt gooit de test weg', async ({ page }) => {
  await laadDemo(page);
  const maand = volgendeMaand();
  await page.goto(`/nbd/rooster?maand=${maand}`);
  await expect(page.locator('td.s.nbd').first()).toBeVisible();
  const echt = await nbdDiensten(page, maand);
  expect(echt).toBeGreaterThan(100);

  // starten
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Starten' }).click();
  const balk = page.locator('.testbalk');
  await expect(balk).toContainText('Testomgeving.');
  await expect(page.getByRole('button', { name: 'Test', exact: true })).toHaveCount(0);

  // in de test: het NBD-rooster leegmaken
  await page.getByRole('button', { name: 'Leegmaken' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Leegmaken' }).click();
  await expect(page.getByText(/gewist\. Verlof en ziekte bleven staan/)).toBeVisible();
  expect(await nbdDiensten(page, maand)).toBe(0);
  // de echte opslag is niet veranderd
  await expect.poll(() => echtOpgeslagen(page, maand)).toBe(echt);

  // na vernieuwen nog steeds in de test, met wat er in de test is gedaan
  await page.evaluate(() => (window as unknown as { __grip: { bewaarNu: () => Promise<void> } }).__grip.bewaarNu());
  await page.reload();
  await expect(balk).toContainText('Testomgeving.');
  await expect(page.getByRole('heading', { name: /Rooster NBD/ })).toBeVisible();
  expect(await nbdDiensten(page, maand)).toBe(0);

  // ook als medewerker te bekijken, en in de regio's werkt het net zo
  await alsMedewerker(page, 'NBD');
  await page.goto('/mijn-rooster');
  await expect(balk).toContainText('Testomgeving.');
  await page.evaluate(() => localStorage.removeItem('grip-bekijk-als'));

  // opnieuw beginnen: weer een kopie van de echte gegevens
  await page.goto(`/nbd/rooster?maand=${maand}`);
  await balk.getByRole('button', { name: 'Opnieuw beginnen' }).click();
  await expect(page.getByText('Opnieuw begonnen met een kopie van de echte gegevens.')).toBeVisible();
  expect(await nbdDiensten(page, maand)).toBe(echt);

  // terug naar echt
  await page.getByRole('button', { name: 'Leegmaken' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Leegmaken' }).click();
  expect(await nbdDiensten(page, maand)).toBe(0);
  await balk.getByRole('button', { name: 'Terug naar echt' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Terug naar echt' }).click();
  await expect(page.getByText('Terug bij de echte gegevens. De test is weggegooid.')).toBeVisible();
  await expect(balk).toHaveCount(0);
  await expect.poll(() => nbdDiensten(page, maand)).toBe(echt);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Test', exact: true })).toBeVisible();
  expect(await nbdDiensten(page, maand)).toBe(echt);
});

test('testomgeving zonder gegevens: de demo laden in de test laat de echte opslag leeg', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Demo laden' })).toBeVisible();
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Starten' }).click();
  await page.locator('.testbalk').getByRole('button', { name: 'Demo laden' }).click();
  await expect(page.getByText(/Demo geladen in de testomgeving/)).toBeVisible({ timeout: 90_000 });
  expect(await staat<number>(page, '(s) => s.medewerkers.length')).toBeGreaterThan(100);
  const echt = await page.evaluate(() => new Promise<number>((klaar) => {
    const req = indexedDB.open('grip-regelplekken');
    req.onsuccess = () => {
      const get = req.result.transaction('kv', 'readonly').objectStore('kv').get('core');
      get.onsuccess = () => klaar(get.result?.medewerkers?.length ?? 0);
    };
  }));
  expect(echt).toBe(0);
});

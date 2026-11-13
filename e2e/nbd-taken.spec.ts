import { test, expect } from '@playwright/test';
import { laadDemo, staat } from './helpers';

type Taak = { soort: string; van: number; tot: number };

/** De volgende maand ('JJJJ-MM'): die heeft in de demo een rooster dat nog niet vastligt. */
function volgendeMaand(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

test('NBD: alleen in lijn, verlof of vrij; een taak in een dienst zetten', async ({ page }) => {
  await laadDemo(page);
  await page.goto(`/nbd/rooster?maand=${volgendeMaand()}`);
  await expect(page.locator('td.s.nbd:not(.verleden)').first()).toBeVisible();
  await page.locator('td.s.nbd:not(.verleden)').first().click();
  const venster = page.getByRole('dialog');
  // geen diensten van de regio's (1, 1M, 2, Dg) en geen overige diensten
  await expect(venster.getByRole('radio')).toHaveText(['In lijn', 'Verlof', 'Vrij']);
  // een training erbij
  const voor = await venster.getByRole('button', { name: 'Training weghalen' }).count();
  await venster.getByRole('button', { name: 'Training', exact: true }).click();
  await expect(venster.getByRole('button', { name: 'Training weghalen' })).toHaveCount(voor + 1);
  await venster.getByRole('button', { name: 'Bewaren' }).click();
  await expect(venster).toHaveCount(0);
  const n = await staat<number>(page, `(s) => Object.values(s.tijden.NBD).flatMap((r) => Object.values(r)).filter((t) => t.taken?.some((k) => k.soort === 'training')).length`);
  expect(n).toBeGreaterThan(0);
});

test('NBD: training, klachten en de maandstart inplannen op de rustigste momenten', async ({ page }) => {
  await laadDemo(page);
  const maand = volgendeMaand();
  await page.goto(`/nbd/rooster?maand=${maand}`);
  await expect(page.locator('td.s.nbd:not(.verleden)').first()).toBeVisible();
  const takenIn = (soort: string) => staat<number>(page, `(s) => Object.values(s.tijden.NBD).flatMap((r) => Object.entries(r)).filter(([d]) => d.startsWith('${maand}')).flatMap(([, t]) => t.taken ?? []).filter((k) => k.soort === '${soort}').length`);

  // eerst alles weghalen wat de demo al had, dan opnieuw inplannen
  const taken = page.getByRole('dialog').filter({ hasText: 'Taken inplannen' });
  const openTaken = async () => {
    await page.getByRole('button', { name: 'Taken' }).click();
    await expect(taken).toBeVisible();
  };
  await openTaken();
  await expect(taken.getByText('Uur training erbij')).toBeVisible();
  for (const knop of ['Training weghalen', 'Klachten weghalen']) {
    if (await taken.getByRole('button', { name: knop }).count()) {
      await taken.getByRole('button', { name: knop }).click();
      await expect(taken).toHaveCount(0);
      await openTaken();
    }
  }
  expect(await takenIn('training')).toBe(0);
  expect(await takenIn('klachten')).toBe(0);
  await taken.getByRole('checkbox', { name: 'Klachten', exact: true }).check();
  await taken.getByLabel('Uur per week (team)').fill('6');
  await expect(taken.getByText('Uur training erbij')).toBeVisible();
  await taken.getByRole('button', { name: 'Inplannen' }).click();
  await expect(page.getByText(/ingepland\. Ongedaan maken kan\./)).toBeVisible();
  expect(await takenIn('training')).toBeGreaterThan(40);
  expect(await takenIn('klachten')).toBeGreaterThan(15);
  // in het rooster: de letters T en K in de vakjes
  await expect(page.locator('td.s .taken', { hasText: 'T' }).first()).toBeVisible();
  // alle taken passen in hun dienst
  const fout = await staat<number>(page, `(s) => Object.values(s.tijden.NBD).flatMap((r) => Object.values(r)).filter((t) => (t.taken ?? []).some((k) => k.van < t.start || k.tot > t.eind)).length`);
  expect(fout).toBe(0);

  // de maandstart: zoek de beste tijd in drie groepen
  await openTaken();
  await taken.getByRole('radio', { name: 'Maandstart' }).click();
  await expect(taken.getByRole('button', { name: 'Zoek beste tijd' })).toBeVisible();
  if (await taken.getByRole('button', { name: 'Maandstart weghalen' }).count()) {
    await taken.getByRole('button', { name: 'Maandstart weghalen' }).click();
    await expect(taken).toHaveCount(0);
    await openTaken();
    await taken.getByRole('radio', { name: 'Maandstart' }).click();
  }
  await taken.getByRole('button', { name: 'Zoek beste tijd' }).click();
  await expect(taken.getByText(/^Groep 1: /)).toBeVisible();
  await expect(taken.getByText(/^Groep 3: /)).toBeVisible();
  await taken.getByRole('button', { name: 'Maandstart inplannen' }).click();
  await expect(page.getByText(/maandstart in 3 groepen ingepland/i)).toBeVisible();
  const leden = await staat<Taak[]>(page, `(s) => Object.values(s.tijden.NBD).flatMap((r) => Object.entries(r)).filter(([d]) => d.startsWith('${maand}')).flatMap(([, t]) => t.taken ?? []).filter((k) => k.soort === 'maandstart')`);
  expect(leden.length).toBeGreaterThan(20);
  expect(new Set(leden.map((k) => `${k.van}-${k.tot}`)).size).toBeLessThanOrEqual(3);
  // ongedaan maken haalt de maandstart weer weg
  await page.getByRole('button', { name: 'Ongedaan maken' }).click();
  expect(await takenIn('maandstart')).toBe(0);
});

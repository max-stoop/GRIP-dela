import { test, expect, type Page } from '@playwright/test';
import { alsMedewerker, laadDemo, staat } from './helpers';

/** Doet alsof de app gegevens van collega's bijleest: dezelfde inhoud, nieuwe objecten. */
const bijlezen = (page: Page) => page.evaluate(() => (window as unknown as { __grip: { bijlezenNabootsen: () => void } }).__grip.bijlezenNabootsen());

test('voorkeuren blijven staan tot je opslaat, ook als de app gegevens van collega\'s bijleest', async ({ page }) => {
  await laadDemo(page);
  const mid = await alsMedewerker(page, 'Utrecht');
  await page.goto('/verlof');
  await expect(page.getByRole('heading', { name: 'Mijn vaste voorkeuren' })).toBeVisible();
  // een keuze maken en de weekdag omzetten
  const dienst = page.getByRole('radiogroup', { name: 'Regeldienst' });
  const andere = (await dienst.getByRole('radio', { name: 'Middag' }).getAttribute('aria-checked')) === 'true' ? 'Ochtend' : 'Middag';
  await dienst.getByRole('radio', { name: andere }).click();
  const maandag = page.getByRole('button', { name: /^maandag: / });
  const voor = await maandag.getAttribute('aria-label');
  await maandag.click();
  const na = await maandag.getAttribute('aria-label');
  expect(na).not.toBe(voor);
  // de app leest bij: de keuzes blijven staan
  await bijlezen(page);
  await page.waitForTimeout(300);
  await expect(dienst.getByRole('radio', { name: andere })).toHaveAttribute('aria-checked', 'true');
  await expect(maandag).toHaveAttribute('aria-label', na!);
  await page.getByRole('button', { name: 'Voorkeuren opslaan' }).click();
  await expect(page.getByText('Voorkeuren opgeslagen.')).toBeVisible();
  expect(await staat<string>(page, `(s) => s.profielen['${mid}'].dienst`)).toBe(andere === 'Middag' ? 'middag' : 'ochtend');
  // na opslaan staat er niets meer open
  await expect(page.getByRole('button', { name: 'Voorkeuren opslaan' })).toBeDisabled();
});

test('voorkeuren per uur (NBD) blijven staan tot je opslaat, ook na bijlezen', async ({ page }) => {
  await laadDemo(page);
  const mid = await alsMedewerker(page, 'NBD');
  await page.goto('/verlof');
  await expect(page.getByRole('heading', { name: 'Mijn voorkeuren per uur' })).toBeVisible();
  // dinsdag omzetten naar iets anders dan nu: hele dag kan niet, of (als dat al zo is) hele dag graag
  const nu = await staat<string>(page, `(s) => s.profielen['${mid}']?.uren?.even[2] ?? ''`);
  const [keuze, label, patroon] = nu === 'n'.repeat(16) ? ['heel', 'Graag', 'g'.repeat(16)] : ['niet', 'Kan niet', 'n'.repeat(16)];
  await page.getByLabel('dinsdag snel invullen').selectOption(keuze);
  await expect(page.getByRole('button', { name: `dinsdag 7:00–8:00: ${label}` })).toBeVisible();
  await bijlezen(page);
  await page.waitForTimeout(300);
  await expect(page.getByRole('button', { name: `dinsdag 7:00–8:00: ${label}` })).toBeVisible();
  await page.getByRole('button', { name: 'Voorkeuren opslaan' }).click();
  await expect(page.getByText('Voorkeuren opgeslagen.')).toBeVisible();
  expect(await staat<string>(page, `(s) => s.profielen['${mid}'].uren.even[2]`)).toBe(patroon);
});

test('een NBD-dienst bewerken: de invoer blijft staan als de app bijleest', async ({ page }) => {
  await laadDemo(page);
  await page.goto('/nbd/rooster');
  await expect(page.getByRole('heading', { name: /Rooster NBD/ })).toBeVisible();
  await page.getByRole('button', { name: 'Volgende maand' }).click();
  await page.locator('td.s:not(.verleden)').first().click();
  const venster = page.getByRole('dialog');
  await venster.getByRole('radio', { name: 'In lijn', exact: true }).click();
  await venster.getByLabel('Begin').selectOption({ label: '10:15' });
  await bijlezen(page);
  await page.waitForTimeout(300);
  await expect(venster.getByLabel('Begin')).toHaveValue('10.25');
});

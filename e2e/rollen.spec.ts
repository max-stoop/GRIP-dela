import { test, expect } from '@playwright/test';
import { alsMedewerker, alsRol, laadDemo } from './helpers';

/** Pagina's die alleen voor planners, regiomanagers en de beheerder zijn. */
const PLANNER = ['/dashboard', '/voorspelling', '/rooster', '/bijsturen', '/verdeling', '/team', '/capaciteit', '/model', '/instellingen',
  '/nbd', '/nbd/rooster', '/nbd/bijsturen', '/nbd/team', '/nbd/voorkeuren', '/nbd/verlof', '/nbd/jaarplanning', '/nbd/ruilen', '/nbd/capaciteit'];

for (const regio of ['Utrecht', 'NBD']) {
  test(`een medewerker (${regio}) komt niet bij de schermen van de planner`, async ({ page }) => {
    await laadDemo(page);
    await alsMedewerker(page, regio);
    for (const pad of PLANNER) {
      await page.goto(pad);
      await expect(page.getByRole('heading', { name: 'Geen toegang' }), pad).toBeVisible();
    }
    // het menu toont alleen de eigen onderdelen
    await page.goto('/mijn-rooster');
    await expect(page.getByText('Volgende dienst')).toBeVisible();
    for (const naam of ['Dashboard', 'Bijsturen', 'Team', 'Capaciteit', 'Instellingen', 'Overzicht']) await expect(page.getByRole('link', { name: naam, exact: true })).toHaveCount(0);
  });
}

test('een planner komt niet bij bronnen, model en instellingen (alleen de beheerder)', async ({ page }) => {
  await laadDemo(page);
  await alsRol(page, 'planner');
  for (const pad of ['/model', '/instellingen']) {
    await page.goto(pad);
    await expect(page.getByRole('heading', { name: 'Geen toegang' }), pad).toBeVisible();
  }
  await page.goto('/nbd/rooster');
  await expect(page.getByRole('heading', { name: /Rooster NBD/ })).toBeVisible();
});

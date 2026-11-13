import { test, expect } from '@playwright/test';

/**
 * Rooktest na elke uitrol, tegen de echte omgeving (GRIP_ADRES). Zonder in te loggen en zonder gegevens te wijzigen:
 * draait de goede versie, antwoordt de database, staat het inloggen klaar en is alles achter het inloggen dicht.
 */
const versie = process.env.GRIP_VERSIE;

test('de app is gezond en de database antwoordt', async ({ request }) => {
  const r = await request.get('/api/gezond');
  expect(r.status()).toBe(200);
  expect(await r.json()).toMatchObject({ gezond: true, database: 'ok' });
});

test('de nieuwe versie draait', async ({ request }) => {
  test.skip(!versie, 'GRIP_VERSIE niet gezet');
  expect((await (await request.get('/api/versie')).json()).versie).toBe(versie);
});

test('inloggen gaat via Microsoft', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  const knop = page.getByRole('link', { name: /Inloggen met je werkaccount/ });
  await expect(knop).toBeVisible();
  expect(await knop.getAttribute('href')).toBe('/auth/entra');
});

test('zonder inloggen geen gegevens', async ({ request }) => {
  for (const pad of ['/api/db', '/api/gebruikers', '/api/live', '/api/ai/rooster']) {
    const r = await request.get(pad, { maxRedirects: 0 });
    expect(r.status(), pad).toBeGreaterThanOrEqual(400);
  }
  const taak = await request.get('/api/taken/dagelijks');
  expect([401, 503]).toContain(taak.status());
});

test('de beveiligingsheaders staan aan', async ({ request }) => {
  const r = await request.get('/login');
  const h = r.headers();
  expect(h['strict-transport-security']).toContain('max-age=');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-content-type-options']).toBe('nosniff');
});

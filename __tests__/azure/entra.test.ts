// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CLIENT_ID, CLIENT_SECRET, startNepEntra, TENANT } from '../../e2e/azure/nep-entra.mjs';

type Nep = { issuer: string; oidVan: (e: string) => string; stop: () => Promise<void> };
let nep: Nep, vreemd: Nep;

beforeAll(async () => {
  nep = await startNepEntra();
  vreemd = await startNepEntra(0, { tenant: '99999999-2222-3333-4444-555555555555' });
  Object.assign(process.env, {
    ENTRA_TENANT_ID: TENANT, ENTRA_CLIENT_ID: CLIENT_ID, ENTRA_CLIENT_SECRET: CLIENT_SECRET, ENTRA_ISSUER: nep.issuer,
    SESSIE_GEHEIM: 'een-geheim-van-minstens-tweeendertig-tekens', GRIP_URL: 'http://localhost:3100',
  });
});
afterAll(async () => { await nep.stop(); await vreemd.stop(); });

/** Wat de browser doet: naar de accountkiezer, een account kiezen, terug naar de app met code en state. */
async function kies(naar: URL, email: string, issuer = nep.issuer): Promise<string> {
  const kiezer = new URL(`${issuer}/kies`);
  naar.searchParams.forEach((v, k) => kiezer.searchParams.set(k, v));
  kiezer.searchParams.set('login', email);
  const r = await fetch(kiezer, { redirect: 'manual' });
  return new URL(r.headers.get('location')!).search;
}

describe('inloggen met het werkaccount', () => {
  it('begint altijd op het eigen adres, ook wie via het Azure-adres binnenkomt', async () => {
    const { naarEigenAdres } = await import('@/lib/auth/entra');
    const via = (host: string, extra: Record<string, string> = {}) => new Request('http://0.0.0.0:8080/auth/entra?volgende=%2Frooster', { headers: { host, ...extra } });
    expect(naarEigenAdres(via('localhost:3100'))).toBeNull();
    expect(naarEigenAdres(via('grip-abc.azurewebsites.net'))?.toString()).toBe('http://localhost:3100/auth/entra?volgende=%2Frooster');
    expect(naarEigenAdres(via('grip-abc.azurewebsites.net', { 'x-forwarded-host': 'localhost:3100' }))).toBeNull();
  });

  it('code flow met PKCE: het account komt terug met oid, tenant en e-mailadres', async () => {
    const { startInloggen, rondInloggenAf, leesWerkaccount } = await import('@/lib/auth/entra');
    const { naar, cookie } = await startInloggen('/rooster');
    expect(naar.searchParams.get('code_challenge_method')).toBe('S256');
    expect(naar.searchParams.get('redirect_uri')).toBe('http://localhost:3100/auth/entra/callback');
    const uit = await rondInloggenAf(await kies(naar, 'Planner@Voorbeeld.nl'), cookie);
    expect(uit?.volgende).toBe('/rooster');
    expect(uit?.account).toMatchObject({ oid: nep.oidVan('planner@voorbeeld.nl'), tid: TENANT, email: 'planner@voorbeeld.nl' });
    expect(await leesWerkaccount(uit!.cookie)).toMatchObject({ email: 'planner@voorbeeld.nl' });
  });

  it('zonder het logincookie, met een andere state of een tweede keer dezelfde code: niet ingelogd', async () => {
    const { startInloggen, rondInloggenAf } = await import('@/lib/auth/entra');
    const a = await startInloggen('/');
    const terug = await kies(a.naar, 'a@voorbeeld.nl');
    expect(await rondInloggenAf(terug, undefined)).toBeNull();
    const b = await startInloggen('/');
    expect(await rondInloggenAf(terug, b.cookie)).toBeNull();
    expect(await rondInloggenAf(terug, a.cookie)).not.toBeNull();
    expect(await rondInloggenAf(terug, a.cookie)).toBeNull();
  });

  it('een account uit een andere tenant komt er niet in', async () => {
    process.env.ENTRA_ISSUER = vreemd.issuer;
    vi.resetModules();
    const { startInloggen, rondInloggenAf } = await import('@/lib/auth/entra');
    const { naar, cookie } = await startInloggen('/');
    expect(await rondInloggenAf(await kies(naar, 'x@elders.nl', vreemd.issuer), cookie)).toBeNull();
    process.env.ENTRA_ISSUER = nep.issuer;
  });
});

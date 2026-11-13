// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import { limiet, toegang, wisLimieten, zonderLoginToegestaan } from '@/lib/api/toegang';
import { vanDezeSite } from '@/lib/api/herkomst';

const verzoek = (ip = '10.0.0.1') => new Request('http://localhost/api/ai/rooster', { headers: { 'x-forwarded-for': ip } });

describe('toegang tot de server-routes', () => {
  afterEach(() => { vi.unstubAllEnvs(); wisLimieten(); });

  it('lokale modus: tijdens ontwikkelen open, op een productieserver alleen met ZONDER_LOGIN=1', async () => {
    vi.stubEnv('NEXT_PUBLIC_GRIP_PLATFORM', '');
    vi.stubEnv('NODE_ENV', 'development');
    expect(await toegang(verzoek())).toEqual({ ok: true, sleutel: 'ip:10.0.0.1' });
    vi.stubEnv('NODE_ENV', 'production');
    expect(zonderLoginToegestaan()).toBe(false);
    expect(await toegang(verzoek())).toMatchObject({ ok: false, status: 401 });
    vi.stubEnv('ZONDER_LOGIN', '1');
    expect((await toegang(verzoek())).ok).toBe(true);
  });

  it('limiet per sleutel binnen een tijdvenster', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(limiet('a', 3, 60_000, t0 + i)).toBe(0);
    expect(limiet('a', 3, 60_000, t0 + 10)).toBeGreaterThan(0);
    expect(limiet('b', 3, 60_000, t0 + 10)).toBe(0);
    // na het venster mag het weer
    expect(limiet('a', 3, 60_000, t0 + 60_001)).toBe(0);
  });

  it('iets wijzigen alleen vanaf deze site: een andere website kan geen aanvraag met jouw inlog laten sturen', async () => {
    const post = (origin?: string, host = 'grip.example.nl') => new Request('https://grip.example.nl/api/bronnen', {
      method: 'POST', headers: { host, ...(origin ? { origin } : {}), 'x-forwarded-for': '10.0.0.2' },
    });
    expect(vanDezeSite(post('https://grip.example.nl'))).toBe(true);
    expect(vanDezeSite(post())).toBe(true);
    expect(vanDezeSite(post('https://kwaad.example.com'))).toBe(false);
    expect(vanDezeSite(post('null'))).toBe(false);
    expect(vanDezeSite(post('http://localhost:3000', 'localhost:3000'))).toBe(true);
    expect(vanDezeSite(new Request('https://grip.example.nl/api/reistijd', { headers: { origin: 'https://kwaad.example.com' } }))).toBe(true);
    // achter een doorgeefluik: de server ziet het Azure-adres, de browser het eigen adres uit GRIP_URL
    const doorgegeven = (origin: string) => post(origin, 'grip-abc.azurewebsites.net');
    expect(vanDezeSite(doorgegeven('https://grip.example.nl'))).toBe(false);
    vi.stubEnv('GRIP_URL', 'https://grip.example.nl');
    expect(vanDezeSite(doorgegeven('https://grip.example.nl'))).toBe(true);
    expect(vanDezeSite(doorgegeven('https://kwaad.example.com'))).toBe(false);
    expect(vanDezeSite(doorgegeven('http://grip.example.nl'))).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_GRIP_PLATFORM', '');
    vi.stubEnv('NODE_ENV', 'development');
    expect(await toegang(post('https://kwaad.example.com'))).toMatchObject({ ok: false, status: 403 });
  });
});

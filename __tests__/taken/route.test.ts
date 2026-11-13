// @vitest-environment node
/** De route van de dagelijkse voorspelling: alleen met de geheime sleutel van de geplande taak. */
import { describe, it, expect, afterEach, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

const vraag = (auth?: string) => new Request('http://localhost/api/taken/dagelijks', { headers: auth ? { authorization: auth } : {} });

describe('/api/taken/dagelijks', () => {
  it('zonder ingestelde sleutel gebeurt er niets', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const { GET } = await import('@/app/api/taken/dagelijks/route');
    expect((await GET(vraag('Bearer iets'))).status).toBe(503);
  });

  it('met een andere sleutel, of zonder, geen toegang', async () => {
    vi.stubEnv('CRON_SECRET', 'geheim-van-de-taak');
    const { GET } = await import('@/app/api/taken/dagelijks/route');
    expect((await GET(vraag())).status).toBe(401);
    expect((await GET(vraag('Bearer fout'))).status).toBe(401);
  });

  it('met de juiste sleutel maar zonder database: niet ingesteld', async () => {
    vi.stubEnv('CRON_SECRET', 'geheim-van-de-taak');
    const { GET } = await import('@/app/api/taken/dagelijks/route');
    expect((await GET(vraag('Bearer geheim-van-de-taak'))).status).toBe(503);
  });
});

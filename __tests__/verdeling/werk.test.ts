// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { rekenVerdeling, LIVE_K, type Opdracht } from '@/lib/verdeling/werk';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { REGIONS } from '@/lib/model/config';

const basis: Opdracht = { datum: '2026-10-13', normen: NORM_STANDAARD, medewerkers: [], rooster: {}, postcodes: {}, drukte: 1, seed: 2, parameters: {}, bron: 'tabel' };

describe('de verdeling in de achtergrond', () => {
  const echteFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = echteFetch; });

  it('geeft gewone data terug, met uitleg bij elke toewijzing', async () => {
    const r = await rekenVerdeling(basis);
    expect(() => structuredClone(r)).not.toThrow();
    expect(r.verwachting).toBe('norm');
    expect(r.slim.uitkomst.toewijzingen.length).toBeGreaterThan(20);
    for (const t of r.slim.uitkomst.toewijzingen) expect(r.uitleg[t.meldingId]?.kop, t.meldingId).toBeTruthy();
    expect(r.plekken).toBe(r.personen.reduce((s, p) => s + p.slots.length, 0));
    expect(r.reistijd).toMatchObject({ bron: 'tabel', live: 0 });
  }, 30_000);

  it('rekent met de voorspelling als die er is: meer verwacht, meer meldingen', async () => {
    const hoog = Object.fromEntries(REGIONS.map((r) => [r, 12]));
    const r = await rekenVerdeling({ ...basis, lam: hoog });
    expect(r.verwachting).toBe('voorspelling');
    const n = await rekenVerdeling(basis);
    expect(r.meldingen.length).toBeGreaterThan(n.meldingen.length);
  }, 30_000);

  it('live: haalt reistijden op via de eigen server en valt bij een fout terug op de schatting', async () => {
    let paren = 0;
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { paren: unknown[] };
      paren += body.paren.length;
      return new Response(JSON.stringify({ aanbieder: 'tomtom', minuten: body.paren.map(() => 25) }));
    }) as unknown as typeof fetch;
    const r = await rekenVerdeling({ ...basis, bron: 'live', datum: '2026-10-14' });
    expect(r.reistijd.bron).toBe('live');
    expect(r.reistijd.aanbieder).toBe('tomtom');
    expect(r.reistijd.live).toBe(paren);
    expect(paren).toBeGreaterThan(r.meldingen.length * LIVE_K * 0.5);
    // tweede keer dezelfde dag: alles staat al klaar, niets opnieuw opvragen
    const voor = paren;
    await rekenVerdeling({ ...basis, bron: 'live', datum: '2026-10-14' });
    expect(paren).toBe(voor);

    globalThis.fetch = (async () => new Response(JSON.stringify({ fout: 'Geen reistijdaanbieder ingesteld' }), { status: 503 })) as unknown as typeof fetch;
    const f = await rekenVerdeling({ ...basis, bron: 'live', datum: '2026-10-15' });
    expect(f.reistijd.fout).toMatch(/aanbieder/);
    expect(f.slim.uitkomst.toewijzingen.length).toBeGreaterThan(0);
  }, 60_000);
});

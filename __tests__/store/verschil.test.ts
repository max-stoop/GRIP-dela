import { describe, it, expect } from 'vitest';
import { verschil, vast } from '@/lib/store/db/verschil';
import { naarTijdstip, uitTijdstip } from '@/lib/store/db/tijd';
import { getState, vulAan } from '@/lib/store/store';
import { REGIONS } from '@/lib/model/config';
import { addDays, nowStamp } from '@/lib/dates';
import type { AppState } from '@/lib/store/types';
import type { Cellen } from '@/lib/rooster/types';
import { voegSamen } from '@/lib/import';

describe('wegschrijven als verschil', () => {
  it('tijdstempels gaan als tijdstip met tijdzone de database in en komen precies zo terug', () => {
    const nu = nowStamp();
    expect(uitTijdstip(naarTijdstip(nu))).toBe(nu);
    expect(naarTijdstip('')).toBeNull();
    expect(uitTijdstip(naarTijdstip('2026-03-29T02:30:00'))).toMatch(/^2026-03-29T0[23]:30:00$/); // zomertijd
  });

  it('de volgorde van sleutels in JSON telt niet als wijziging', () => {
    expect(vast({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(vast({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }));
    expect(vast({ a: 1, b: undefined })).toBe(vast({ a: 1 }));
  });

  it('bij een volle app (25 regio\'s, ruim 35.000 diensten) is één gewijzigde dienst snel gevonden', () => {
    const basis = vulAan({ ...getState(), geladen: true });
    const rooster: Record<string, Cellen> = {};
    for (const regio of REGIONS) {
      const c: Cellen = {};
      for (let m = 0; m < 17; m++) {
        const rij: Cellen[string] = {};
        for (let d = 0; d < 120; d++) if (d % 7 < 5 && (d + m) % 3) rij[addDays('2026-09-01', d)] = '1';
        c[`${regio}-${m}`] = rij;
      }
      rooster[regio] = c;
    }
    const a: AppState = { ...basis, rooster };
    verschil(basis, a, 'planner'); // eerste keer: alle rijen opbouwen
    const b: AppState = { ...a, rooster: { ...a.rooster, Utrecht: { ...a.rooster.Utrecht, 'Utrecht-3': { ...a.rooster.Utrecht['Utrecht-3'], '2026-09-02': '1M' } } } };
    const start = performance.now();
    const ops = verschil(a, b, 'planner');
    const ms = performance.now() - start;
    expect(ops).toEqual([{ tabel: 'rp_rooster', soort: 'upsert', rijen: [{ medewerker_id: 'Utrecht-3', datum: '2026-09-02', regio: 'Utrecht', dienst: '1M' }], nieuw: [false] }]);
    // alleen Utrecht wordt vergeleken; de andere 24 regio's zijn hetzelfde object
    expect(ms).toBeLessThan(150);
  });
});

describe('meldingen aanvullen in de database', () => {
  const basis = vulAan({ ...getState(), geladen: true });
  const oud: AppState = { ...basis, meldingen: { start: '2026-10-01', n: 3, regios: { Utrecht: [4, 5, 6], Rotterdam: [3, 3, 3] } } };
  const bestand = { start: '2026-10-03', n: 2, regios: { Utrecht: [7, 8] } };

  it('aanvullen schrijft alleen nieuwe en gewijzigde dagen weg en haalt niets weg', () => {
    const ops = verschil(oud, { ...oud, meldingen: voegSamen(oud.meldingen, bestand).data }, 'beheerder');
    expect(ops.filter((o) => o.soort === 'delete')).toEqual([]);
    const rijen = ops.flatMap((o) => (o.soort === 'upsert' && o.tabel === 'rp_meldingen' ? o.rijen : []));
    expect(rijen.map((r) => `${r.regio} ${r.datum} ${r.aantal}`).sort()).toEqual(['Utrecht 2026-10-03 7', 'Utrecht 2026-10-04 8']);
  });

  it('vervangen haalt weg wat niet in het bestand staat', () => {
    const ops = verschil(oud, { ...oud, meldingen: bestand }, 'beheerder');
    const weg = ops.flatMap((o) => (o.soort === 'delete' && o.tabel === 'rp_meldingen' ? o.sleutels : []));
    expect(weg).toHaveLength(5);
  });
});

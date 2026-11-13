import { describe, it, expect } from 'vitest';
import { clusterStand } from '@/lib/rooster/cluster';
import type { Medewerker } from '@/lib/rooster/types';

const b = (k: number | null, lam = 2) => (k == null ? null : { k, lam });
const mw = (id: string, regio: string): Medewerker => ({ id, regio, naam: id, contract: 32, voorkeur: 'O', weekendgroep: 0, functie: 'UV', actief: true });

describe('hoe het cluster plant', () => {
  const dates = ['2026-11-02', '2026-11-03', '2026-11-04'];
  const stand = clusterStand(dates, [
    // 1, 1M en 1B tellen als één plek, een 2 als twee, Dg en verlof niet
    { regio: 'A', team: [mw('a1', 'A'), mw('a2', 'A'), mw('a3', 'A')], cellen: { a1: { '2026-11-02': '1', '2026-11-03': '2', '2026-11-04': 'DG2' }, a2: { '2026-11-02': '1B', '2026-11-03': 'V' }, a3: { '2026-11-02': '1M', '2026-11-04': '1' } }, behoefte: () => b(3) },
    { regio: 'B', team: [mw('b1', 'B')], cellen: { b1: { '2026-11-02': '1', '2026-11-03': '1', '2026-11-04': '2' } }, behoefte: (d: string) => b(d === '2026-11-04' ? null : 1) },
    { regio: 'C', team: [], cellen: {}, behoefte: () => b(1) },
  ], { alphaCluster: 0.95, speling: false, minDG: 2 });

  it('per regio per dag de geplande plekken naast het afgesproken aantal', () => {
    const [a, b, c] = stand.regels;
    expect(a.gepland).toEqual([3, 2, 1]);
    expect(a.beschikbaar).toEqual([1, 0, 0]);
    expect([a.totaalGepland, a.totaalAfgesproken, a.tekort]).toEqual([6, 9, 2]);
    expect(b.afgesproken).toEqual([1, 1, null]);
    expect([b.totaalGepland, b.totaalAfgesproken, b.tekort]).toEqual([4, 2, 0]);
    expect([c.leeg, c.gepland, c.tekort]).toEqual([true, [0, 0, 0], 3]);
  });

  it('Dg-diensten per regio en voor het cluster, met wat er moet (niet op zondag)', () => {
    expect(stand.regels[0].dg).toEqual([0, 0, 1]);
    expect(stand.dg).toEqual([0, 0, 1]);
    expect(stand.dgMoet).toEqual([6, 6, 6]);
    const zondag = clusterStand(['2026-11-01'], [{ regio: 'A', team: [mw('a1', 'A')], cellen: {}, behoefte: () => b(1) }], { alphaCluster: 0.95, speling: true, minDG: 2 });
    expect(zondag.dgMoet).toEqual([0]);
  });

  it('wat het cluster moet: de regio\'s samen plus de speling voor de clusterdekking', () => {
    // vier regio's met elk 3 plekken bij 2,5 meldingen: samen 12 plekken, maar voor 95% bij 10 meldingen zijn er 15 nodig
    const vier = ['A', 'B', 'C', 'D'].map((r) => ({ regio: r, team: [mw(`${r}1`, r)], cellen: {}, behoefte: () => b(3, 2.5) }));
    const met = clusterStand(['2026-11-02'], vier, { alphaCluster: 0.95, speling: true, minDG: 2 });
    expect([met.speling[0], met.afgesproken[0]]).toEqual([3, 15]);
    const zonder = clusterStand(['2026-11-02'], vier, { alphaCluster: 0.95, speling: false, minDG: 2 });
    expect([zonder.speling[0], zonder.afgesproken[0]]).toEqual([0, 12]);
    // zonder afspraak in één regio: geen speling
    expect(stand.speling).toEqual([0, 0, 0]);
  });

  it('onderaan het cluster: gepland, afgesproken en het verschil', () => {
    expect(stand.gepland).toEqual([4, 3, 3]);
    expect(stand.afgesproken).toEqual([5, 5, 4]);
    expect(stand.verschil).toEqual([-1, -2, -1]);
    expect(stand.tekort).toBe(3);
  });
});

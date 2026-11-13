import { describe, it, expect } from 'vitest';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { clusterDag, kans1B, kans1BJaar, normRegioDag, poissonVerdeling, spelingOpDag, uitvalVerdeling } from '@/lib/capaciteit/beschikbaarheid';
import { poissonCdf } from '@/lib/model/poisson';
import { plekkenNormWeek, regiosVanCluster } from '@/lib/capaciteit/norm';

const n = NORM_STANDAARD;

describe('kans dat een 1B valt', () => {
  it('de Poisson-verdeling klopt met de cumulatieve kans en telt op tot 1', () => {
    for (const lam of [0.4, 4.6, 21.5, 60]) {
      const p = poissonVerdeling(lam);
      expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
      const k = Math.round(lam);
      expect(p.slice(0, k + 1).reduce((a, b) => a + b, 0)).toBeCloseTo(poissonCdf(k, lam), 8);
    }
  });

  it('zonder uitval valt de 1B als er meer meldingen zijn dan reguliere plekken', () => {
    const k = kans1B({ lam: 4.6, diensten: [1, 1, 1, 1, 1], beschikbaar: 1, uitval: 0 });
    expect(k.minstensEen).toBeCloseTo(1 - poissonCdf(5, 4.6), 10);
    expect(k.gemiddeld).toBeCloseTo(k.minstensEen, 10);
    expect(k.tekort).toBeCloseTo(1 - poissonCdf(6, 4.6), 10);
  });

  it('wie met een 2 uitvalt, laat twee plekken leeg', () => {
    const u = uitvalVerdeling([1, 2], 0.1);
    expect(u).toHaveLength(4);
    expect(u[0]).toBeCloseTo(0.81);
    expect(u[1]).toBeCloseTo(0.09);
    expect(u[2]).toBeCloseTo(0.09);
    expect(u[3]).toBeCloseTo(0.01);
    expect(kans1B({ lam: 3, diensten: [1, 2, 1], beschikbaar: 1, uitval: 0.1 }).uitval).toBeCloseTo(0.4);
  });

  it('ziekte maakt de kans groter, en de tweede 1B valt minder vaak dan de eerste', () => {
    const zonder = kans1B({ lam: 20, diensten: Array(24).fill(1), beschikbaar: 4, uitval: 0 });
    const met = kans1B({ lam: 20, diensten: Array(24).fill(1), beschikbaar: 4, uitval: 0.085 });
    expect(met.minstensEen).toBeGreaterThan(zonder.minstensEen);
    for (let j = 1; j < met.perPlek.length; j++) expect(met.perPlek[j]).toBeLessThan(met.perPlek[j - 1]);
    expect(met.perPlek[0]).toBeCloseTo(met.minstensEen, 12);
    expect(met.gemiddeld).toBeLessThan(met.minstensEen);
  });

  it('cluster eerst: de 1B valt minder vaak dan als elke regio alles zelf moet opvangen', () => {
    const regios = regiosVanCluster(n, 'O');
    const dag = regios.map((r) => normRegioDag(n, r, 6, 1)!);
    // een regio op zichzelf: de 1B valt zodra de meldingen de reguliere plekken (80% min de 1B) overschrijden
    const u = dag.find((d) => d.regio === 'Utrecht')!;
    expect(u.diensten.length + u.beschikbaar).toBe(plekkenNormWeek(n, 'Utrecht', 6, 1));
    const c = clusterDag(dag, n.uitval, spelingOpDag(n, 'O', 6, 1));
    expect(c.cluster.beschikbaar).toBe(regios.length * n.beschikbaarPerDag);
    for (const r of c.regios) expect(c.cluster.gemiddeld).toBeLessThan(r.alleen);
    expect(c.regios.find((r) => r.regio === 'Utrecht')!.alleen).toBeGreaterThan(c.cluster.minstensEen);
  });

  it('ziekte telt standaard niet mee', () => {
    expect(n.uitval).toBe(0);
    const k = kans1B({ lam: 20, diensten: Array(24).fill(1), beschikbaar: 4, uitval: n.uitval });
    expect(k.uitval).toBe(0);
  });

  it('over het jaar: per cluster een kans tussen 0 en de kans per regio, hoger met ziekte', () => {
    for (const cl of ['N', 'NW', 'O', 'W', 'ZO', 'ZW']) {
      const j = kans1BJaar(n, cl);
      expect(j.gemiddeld).toBeGreaterThan(0.05);
      expect(j.gemiddeld).toBeLessThan(0.3);
      expect(j.minstensEen).toBeGreaterThan(j.gemiddeld);
      for (const r of j.regios) expect(r.alleen).toBeGreaterThan(j.gemiddeld);
      expect(kans1BJaar(n, cl, 0.03).gemiddeld).toBeGreaterThan(j.gemiddeld);
    }
  });
});

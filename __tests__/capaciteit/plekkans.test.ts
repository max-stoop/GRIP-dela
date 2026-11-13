import { describe, it, expect } from 'vitest';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { convolutie, kans1B, poissonVerdeling, uitvalVerdeling, type RegioDag } from '@/lib/capaciteit/beschikbaarheid';
import { berekenPlekKansen, clusterVoorspeld, plekKansen, procenten } from '@/lib/capaciteit/plekkans';
import { poissonCdf, poissonQuantile } from '@/lib/model/poisson';
import { regiosVanCluster } from '@/lib/capaciteit/norm';
import { kans1BPerDag } from '@/lib/rooster/kans1b';

const regio = (naam: string, lam: number, regulier: number, beschikbaar = 1): RegioDag => ({ regio: naam, lam, diensten: Array.from({ length: regulier }, () => 1), beschikbaar, bron: 'norm' });

describe('per plek: valt hij voor de eigen regio of voor het cluster', () => {
  it('een regio alleen: elke plek alleen voor eigen meldingen, de 1B zodra de vaste plekken vol zijn', () => {
    const c = plekKansen([regio('A', 5.2, 6)], 0);
    const a = c.regios[0];
    expect(a.plekken.map((p) => p.soort)).toEqual(['regulier', 'regulier', 'regulier', 'regulier', 'regulier', 'regulier', '1B']);
    for (const p of a.plekken.slice(0, 6)) {
      expect(p.eigen).toBeCloseTo(1 - poissonCdf(p.nr - 1, 5.2), 10);
      expect(p.cluster).toBe(0);
    }
    const b = a.plekken[6];
    expect(b.cluster).toBe(0);
    expect(b.eigen).toBeCloseTo(1 - poissonCdf(6, 5.2), 10);
    expect(a.genoeg).toBeCloseTo(poissonCdf(7, 5.2), 10);
    expect(a.genoegZonder1B).toBeCloseTo(poissonCdf(6, 5.2), 10);
    expect(a.helpt).toBe(0);
    expect(a.geholpen).toBe(0);
    expect(c.genoeg).toBeCloseTo(poissonCdf(7, 5.2), 10);
  });

  it('dezelfde invoer geeft steeds dezelfde uitkomst', () => {
    const dag = [regio('A', 5, 6), regio('B', 3, 4), regio('C', 7, 8)];
    expect(berekenPlekKansen(dag, 0, 1, 5000)).toEqual(berekenPlekKansen(dag, 0, 1, 5000));
    // opnieuw gevraagd: dezelfde uitkomst zonder opnieuw te rekenen
    expect(plekKansen(dag, 0, 1)).toBe(plekKansen(dag.map((d) => ({ ...d })), 0, 1));
  });

  it('een rustige regio helpt een drukke: zijn laatste plekken en zijn 1B vallen vaak voor de ander', () => {
    const c = plekKansen([regio('Druk', 8, 5), regio('Rustig', 2, 6)], 0);
    const druk = c.regios[0], rustig = c.regios[1];
    expect(rustig.helpt).toBeGreaterThan(1);
    expect(druk.geholpen).toBeCloseTo(rustig.helpt, 10);
    const laatste = rustig.plekken[5];
    expect(laatste.cluster).toBeGreaterThan(laatste.eigen);
    const b = rustig.plekken[6];
    expect(b.soort).toBe('1B');
    expect(b.cluster).toBeGreaterThan(b.eigen);
    // de drukke regio zet zijn eigen 1B eerst in
    expect(druk.plekken[5].eigen).toBeGreaterThan(druk.plekken[5].cluster);
    // het cluster samen heeft vaker genoeg dan de drukke regio alleen
    expect(c.genoeg).toBeGreaterThan(druk.genoeg);
  });

  it('alle 1B\'s samen vallen precies zo vaak als de clusterberekening zegt; een plek valt nooit vaker dan de vorige', () => {
    const n = NORM_STANDAARD;
    for (const cl of ['O', 'N', 'W']) {
      const dag = kans1BPerDag({ normen: n, cluster: cl, regios: regiosVanCluster(n, cl), dates: ['2026-01-13'], lam: () => null, rooster: () => null })[0]!;
      for (const uitval of [0, 0.085]) {
        const c = plekKansen(dag.dagen, uitval, dag.speling);
        const k = kans1B({ lam: dag.cluster.lam, diensten: [...dag.dagen.flatMap((d) => d.diensten), ...Array(dag.speling).fill(1)], beschikbaar: dag.cluster.beschikbaar, uitval });
        const som = c.regios.reduce((a, r) => a + r.plekken.filter((p) => p.soort === '1B').reduce((s, p) => s + p.valt, 0), 0);
        expect(som).toBeCloseTo(k.gemiddeld * k.beschikbaar, 10);
        expect(c.genoegZonder1B).toBeCloseTo(1 - k.minstensEen, 10);
        // wat de regio's uithelpen, is wat er bij anderen geplaatst wordt (plus de clusterspeling)
        const helpt = c.regios.reduce((a, r) => a + r.helpt, 0), geholpen = c.regios.reduce((a, r) => a + r.geholpen, 0);
        expect(helpt).toBeLessThanOrEqual(geholpen + 1e-9);
        for (const r of c.regios) {
          const regulier = r.plekken.filter((p) => p.soort === 'regulier');
          for (let j = 1; j < regulier.length; j++) expect(regulier[j].valt).toBeLessThanOrEqual(regulier[j - 1].valt + 0.006);
          for (const p of r.plekken) {
            expect(p.valt).toBeLessThanOrEqual(1);
            expect(p.valt).toBeCloseTo(p.eigen + p.cluster, 12);
          }
          // de 1B valt minder vaak dan als de regio alles zelf moest opvangen
          const b = r.plekken.find((p) => p.soort === '1B')!;
          expect(b.valt).toBeLessThan(1 - r.genoegZonder1B);
        }
      }
    }
  });

  it('met ziekte telt de uitval als extra werk voor de eigen plekken', () => {
    const d = regio('A', 4, 5);
    d.diensten = [1, 2, 1, 1];
    const c = plekKansen([d], 0.1);
    const v = convolutie(poissonVerdeling(4), uitvalVerdeling(d.diensten, 0.1));
    const vanaf = (x: number) => v.slice(x).reduce((a, b) => a + b, 0);
    for (const p of c.regios[0].plekken.filter((x) => x.soort === 'regulier')) expect(p.eigen).toBeCloseTo(vanaf(p.nr), 10);
    expect(c.regios[0].regulier).toBe(5);
  });

  it('clusterspeling vangt meldingen op: de 1B\'s vallen minder vaak', () => {
    const dag = [regio('A', 5, 6), regio('B', 6, 7), regio('C', 4, 5)];
    const zonder = plekKansen(dag, 0, 0), met = plekKansen(dag, 0, 3);
    expect(met.regulier).toBe(zonder.regulier + 3);
    expect(met.speling).toBe(3);
    for (let i = 0; i < dag.length; i++) {
      const b0 = zonder.regios[i].plekken.at(-1)!, b1 = met.regios[i].plekken.at(-1)!;
      expect(b1.valt).toBeLessThan(b0.valt);
    }
    expect(met.genoegZonder1B).toBeGreaterThan(zonder.genoegZonder1B);
  });
});

describe('een cluster volgens een voorspelling', () => {
  it('per regio de plekken op 80% met de 1B als laatste plek, en speling tot 95% in het cluster', () => {
    const lam: Record<string, number> = { A: 4.6, B: 6.1, C: 2.2 };
    const c = clusterVoorspeld(['A', 'B', 'C'], (r) => lam[r], { alphaRegio: 0.8, alphaCluster: 0.95, beschikbaarPerDag: 1, speling: true })!;
    for (const d of c.dagen) {
      expect(d.diensten.length + d.beschikbaar).toBe(poissonQuantile(0.8, lam[d.regio]));
      expect(d.beschikbaar).toBe(1);
      expect(d.bron).toBe('voorspelling');
    }
    const totaal = c.dagen.reduce((a, d) => a + d.diensten.length + d.beschikbaar, 0);
    expect(c.speling).toBe(Math.max(0, poissonQuantile(0.95, 4.6 + 6.1 + 2.2) - totaal));
    expect(clusterVoorspeld(['A', 'B', 'C'], (r) => lam[r], { alphaRegio: 0.8, alphaCluster: 0.95, beschikbaarPerDag: 1, speling: false })!.speling).toBe(0);
    expect(clusterVoorspeld(['A', 'X'], (r) => lam[r], { alphaRegio: 0.8, alphaCluster: 0.95, beschikbaarPerDag: 1, speling: true })).toBeNull();
  });
});

describe('procenten die optellen', () => {
  it('eigen plus cluster is het afgeronde totaal', () => {
    expect(procenten({ valt: 0.988, eigen: 0.966, cluster: 0.022 })).toEqual({ valt: '99%', eigen: '97%', cluster: '2%' });
    expect(procenten({ valt: 0.117, eigen: 0.074, cluster: 0.043 })).toEqual({ valt: '12%', eigen: '8%', cluster: '4%' });
    expect(procenten({ valt: 0.5, eigen: 0.38, cluster: 0.12 })).toEqual({ valt: '50%', eigen: '38%', cluster: '12%' });
    for (let i = 0; i < 200; i++) {
      const e = (i * 0.0037) % 0.9, c = (i * 0.0021) % 0.1;
      const t = procenten({ valt: e + c, eigen: e, cluster: c });
      expect(parseInt(t.eigen) + parseInt(t.cluster)).toBe(parseInt(t.valt));
    }
  });
});

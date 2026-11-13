import { describe, it, expect } from 'vitest';
import { gemiddeldOver, inzicht, poissonAfwijking, schommelTekst, terugtestMorgen } from '@/lib/model/terugtest';
import { kwantielMetSchommeling, poissonQuantile } from '@/lib/model/poisson';
import { poissonPmf } from '@/lib/model/betrouwbaarheid';
import { CLUSTERS, REGIONS } from '@/lib/model/config';
import { toDay, weekdayMon } from '@/lib/dates';
import type { ModelInput } from '@/lib/model/types';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
function poisson(r: () => number, lam: number) {
  const L = Math.exp(-lam);
  let k = 0, p = 1;
  do { k++; p *= r(); } while (p > L);
  return k - 1;
}

/** Nagemaakte meldingen: seizoen en weekdag, verder puur toeval (Poisson). */
function invoer(dagen: number): ModelInput {
  const r = rng(7), start = '2025-01-01', s = toDay(start);
  const regios: Record<string, (number | null)[]> = {};
  REGIONS.forEach((regio, i) => {
    regios[regio] = Array.from({ length: dagen }, (_, d) => {
      const lam = (3 + (i % 5)) * (1 + 0.15 * Math.cos((2 * Math.PI * d) / 365.25)) * (weekdayMon(s + d) >= 5 ? 0.9 : 1.03);
      return poisson(r, lam);
    });
  });
  return { meldingen: { start, n: dagen, regios }, extern: {}, handmatig: [], coef: {}, normaal: null };
}

describe('terugtest van de voorspelling voor morgen', () => {
  it('gemiddelde afwijking van Poisson klopt met de som', () => {
    for (const lam of [0.4, 3.5, 17.9, 107.8]) {
      let s = 0;
      for (let k = 0; k < lam + 15 * Math.sqrt(lam) + 20; k++) s += Math.abs(k - lam) * poissonPmf(k, lam);
      expect(poissonAfwijking(lam)).toBeCloseTo(s, 8);
    }
    expect(poissonAfwijking(0)).toBe(0);
  });

  it('bij puur toeval zit het model op het haalbare, per regio, cluster en landelijk', () => {
    const t = terugtestMorgen(invoer(640))!;
    expect(t).not.toBeNull();
    expect(t.tot).toBe('2026-10-02'); // de laatste dag met meldingen
    expect(toDay(t.tot) - toDay(t.van) + 1).toBe(182); // een halfjaar
    expect(Object.keys(t.regios)).toHaveLength(REGIONS.length);
    expect(Object.keys(t.clusters).sort()).toEqual(Object.keys(CLUSTERS).sort());
    for (const x of [...Object.values(t.regios), ...Object.values(t.clusters), t.landelijk!]) {
      expect(x.dagen).toBe(182);
      expect(x.ernaast / x.toeval).toBeGreaterThan(0.85);
      expect(x.ernaast / x.toeval).toBeLessThan(1.2);
      expect(Math.abs(x.binnen - x.binnenVerwacht)).toBeLessThan(0.1);
      expect(Math.abs(x.scheef)).toBeLessThan(0.08);
      // puur toeval: rond 1
      expect(x.schommeling).toBeGreaterThan(0.75);
      expect(x.schommeling).toBeLessThan(1.3);
    }
    // per cluster naar verhouding preciezer dan per regio
    const regio = gemiddeldOver(Object.values(t.regios))!, cluster = gemiddeldOver(Object.values(t.clusters))!;
    expect(cluster.ernaast / cluster.gem).toBeLessThan(regio.ernaast / regio.gem);
  });

  it('te weinig historie: geen terugtest', () => {
    expect(terugtestMorgen(invoer(140))).toBeNull();
    expect(terugtestMorgen({ ...invoer(10), meldingen: { start: '2025-01-01', n: 0, regios: {} } })).toBeNull();
  });

  it('zegt in gewone taal hoe dicht het bij het haalbare zit', () => {
    const [r, c] = inzicht({ gem: 4.3, ernaast: 1.6, toeval: 1.62 }, { gem: 18, ernaast: 3.6, toeval: 3.4 });
    expect(r).toBe('Per regio zat de voorspelling voor morgen het afgelopen halfjaar gemiddeld 1,6 meldingen ernaast, bij 4,3 per dag (±37%). Dat is zo goed als het kan: ook een perfecte voorspelling zit gemiddeld 1,6 ernaast, omdat het per dag voor een groot deel toeval is hoeveel meldingen er komen.');
    expect(c).toBe('Per cluster middelt het toeval uit: 3,6 ernaast bij 18,0 per dag (±20%). Daarom vangen de regio\'s in een cluster elkaar op.');
    expect(inzicht({ gem: 4, ernaast: 2, toeval: 1.6 }, null)[0]).toContain('het verschil is wat er nog te winnen valt');
    expect(inzicht(null, null)).toEqual([]);
  });
});

describe('eigen niveau per regio', () => {
  /** Zoals hierboven, maar Eindhoven groeit het laatste halfjaar met 30%. */
  function metGroei(): ModelInput {
    const i = invoer(640);
    const r = rng(11);
    const e = i.meldingen.regios.Eindhoven;
    for (let d = 640 - 180; d < 640; d++) e[d] = (e[d] ?? 0) + poisson(r, 0.3 * (3 + (REGIONS.indexOf('Eindhoven') % 5)));
    return i;
  }

  it('volgt een regio die groeit, zonder de rest van het land te verschuiven', () => {
    const t = terugtestMorgen(metGroei())!, zonder = terugtestMorgen({ ...metGroei(), coef: { niveau_regio: 0 } })!;
    expect(zonder.regios.Eindhoven.scheef).toBeGreaterThan(0.08);
    // de groei begint midden in de terugtest; het niveau over 16 weken loopt eerst nog bij
    expect(t.regios.Eindhoven.scheef).toBeLessThan(zonder.regios.Eindhoven.scheef * 0.7);
    expect(Math.abs(t.landelijk!.scheef - zonder.landelijk!.scheef)).toBeLessThan(0.01);
  });

  it('in de run: een plus voor de groeiende regio, rond nul voor de rest, en het ebt niet weg', async () => {
    const { runForecast } = await import('@/lib/model/forecast');
    const run = runForecast(metGroei(), { issue: '2026-10-03', soort: 'test', now: new Date('2026-10-03T06:00:00Z') });
    const ei = run.data.fac.Eindhoven.niveau_regio!;
    expect(ei[0]).toBeGreaterThan(0.05);
    expect(ei[60]).toBeCloseTo(ei[0], 10);
    for (const r of REGIONS.filter((x) => x !== 'Eindhoven')) expect(Math.abs(run.data.fac[r].niveau_regio?.[0] ?? 0)).toBeLessThan(0.06);
  });
});

describe('meer schommeling dan toeval', () => {
  it('hoogstens met de gemeten schommeling (negatief binomiaal, gelijk aan scipy)', () => {
    expect(kwantielMetSchommeling(0.9, 16.6, 1.29)).toBe(23);
    expect(kwantielMetSchommeling(0.9, 20.5, 1.24)).toBe(27);
    expect(kwantielMetSchommeling(0.9, 4, 1.5)).toBe(7);
    expect(kwantielMetSchommeling(0.9, 108, 1.4)).toBe(124);
    // zonder extra schommeling gewoon Poisson
    expect(kwantielMetSchommeling(0.9, 16.6, 1)).toBe(poissonQuantile(0.9, 16.6));
    expect(kwantielMetSchommeling(0.9, 16.6, 0.8)).toBe(poissonQuantile(0.9, 16.6));
  });

  it('noemt de onrustige clusters', () => {
    expect(schommelTekst([{ naam: 'Noord', schommeling: 1.05 }])).toBeNull();
    expect(schommelTekst([{ naam: 'Noord', schommeling: 1.05 }, { naam: 'West', schommeling: 1.3 }])).toBe('In cluster West schommelt het meer dan toeval: de regio\'s zijn daar vaker tegelijk druk of rustig. "Hoogstens" houdt daar rekening mee.');
    expect(schommelTekst([{ naam: 'Zuidoost', schommeling: 1.2 }, { naam: 'West', schommeling: 1.3 }, { naam: 'Noordwest', schommeling: 1.16 }])).toContain('In de clusters West, Zuidoost en Noordwest schommelt');
  });
});

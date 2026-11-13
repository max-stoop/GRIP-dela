/** Bewaarde runs naast wat er werkelijk is gemeld, per afstand tot de doeldatum. */
import { toDay, fromDay } from '../dates';
import { bandDekking, poissonBand } from './poisson';
import type { MeldingenData, RunData, RunMeta } from './types';

/** Stabiel in log-ruimte. */
export function poissonPmf(k: number, lam: number): number {
  if (k < 0) return 0;
  if (lam <= 0) return k === 0 ? 1 : 0;
  let lf = 0;
  for (let i = 2; i <= k; i++) lf += Math.log(i);
  return Math.exp(-lam + k * Math.log(lam) - lf);
}

/** De k-waarden waar vrijwel alle kans ligt. */
export function verdeling(lam: number): { k: number; p: number }[] {
  const max = Math.ceil(lam + 4.5 * Math.sqrt(Math.max(lam, 1)) + 2);
  const min = Math.max(0, Math.floor(lam - 4.5 * Math.sqrt(Math.max(lam, 1))));
  const out: { k: number; p: number }[] = [];
  for (let k = min; k <= max; k++) out.push({ k, p: poissonPmf(k, lam) });
  return out;
}

export interface Bucket {
  naam: string;
  van: number;
  tot: number;
  punten: number;
  /** Per dag, in meldingen, opgeteld over de regio's. */
  mae: number;
  /** Gemiddeld (werkelijk − verwacht) / verwacht. */
  bias: number;
  /** Regio-dagen binnen de 80%-band. */
  inBand: number;
  /** Minstens 80%, bij weinig meldingen meer (hele aantallen). */
  inBandVerwacht: number;
  regioDagen: number;
  /** Het totaal over de gekozen regio's binnen de 80%-band van het totaal (van punten). */
  binnenSom: number;
  binnenSomVerwacht: number;
}

export interface Punt {
  datum: string;
  werkelijk: number;
  verwacht: number;
  lo: number;
  hi: number;
  h: number;
}

export interface Betrouwbaarheid {
  buckets: Bucket[];
  /** Per dag de voorspelling die minstens minH dagen vooruit is gemaakt. */
  reeks: Punt[];
  dataEind: string | null;
}

const BUCKETS: [string, number, number][] = [
  ['1 tot 7 dagen', 1, 7],
  ['8 tot 16 dagen', 8, 16],
  ['17 tot 30 dagen', 17, 30],
  ['31 tot 61 dagen', 31, 61],
];

export function betrouwbaarheid(runs: { meta: RunMeta; data: RunData }[], m: MeldingenData | null, regios: string[], minH = 4, dagen = 42): Betrouwbaarheid {
  if (!m) return { buckets: [], reeks: [], dataEind: null };
  const start = toDay(m.start), eind = start + m.n - 1;
  const werkelijk = (r: string, d: number) => {
    const v = m.regios[r]?.[d - start];
    return v == null ? null : v;
  };
  const acc = BUCKETS.map(([naam, van, tot]) => ({ naam, van, tot, n: 0, abs: 0, rel: 0, inBand: 0, rd: 0, som: 0, dekRd: 0, dekSom: 0 }));
  const beste = new Map<number, { h: number; verwacht: number; werkelijk: number; regio: number[]; issue: number }>();
  for (const { meta, data } of runs) {
    const issue = toDay(meta.uitgegeven);
    const ri = regios.map((r) => data.regios.indexOf(r));
    data.dates.forEach((ds, di) => {
      const d = toDay(ds);
      if (d > eind || d < start) return;
      const h = d - issue;
      let w = 0, v = 0, ok = true;
      const lams: number[] = [];
      ri.forEach((j, x) => {
        if (j < 0) return;
        const real = werkelijk(regios[x], d);
        if (real == null) { ok = false; return; }
        const l = data.lam[j][di];
        w += real; v += l; lams.push(l);
        const b = acc.find((a) => h >= a.van && h <= a.tot);
        if (b) {
          b.rd++;
          b.dekRd += bandDekking(l);
          if (real >= poissonBand(0.1, l) && real <= poissonBand(0.9, l)) b.inBand++;
        }
      });
      if (!ok || !lams.length) return;
      const b = acc.find((a) => h >= a.van && h <= a.tot);
      if (b) {
        b.n++; b.abs += Math.abs(w - v); b.rel += v > 0 ? (w - v) / v : 0;
        b.dekSom += bandDekking(v);
        if (w >= poissonBand(0.1, v) && w <= poissonBand(0.9, v)) b.som++;
      }
      if (h >= minH) {
        const cur = beste.get(d);
        if (!cur || issue > cur.issue) beste.set(d, { h, verwacht: v, werkelijk: w, regio: lams, issue });
      }
    });
  }
  const reeks: Punt[] = [...beste.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-dagen)
    .map(([d, x]) => {
      // alleen de regio's die in de voorspelling zaten
      return { datum: fromDay(d), werkelijk: x.werkelijk, verwacht: x.verwacht, lo: poissonBand(0.1, x.verwacht), hi: poissonBand(0.9, x.verwacht), h: x.h };
    });
  return {
    buckets: acc.filter((a) => a.n > 0).map((a) => ({ naam: a.naam, van: a.van, tot: a.tot, punten: a.n, mae: a.abs / a.n, bias: a.rel / a.n, inBand: a.rd ? a.inBand / a.rd : 0, inBandVerwacht: a.rd ? a.dekRd / a.rd : 0.8, regioDagen: a.rd, binnenSom: a.som, binnenSomVerwacht: a.dekSom / a.n })),
    reeks,
    dataEind: fromDay(eind),
  };
}

export function bucketVoor(buckets: Bucket[], h: number): Bucket | null {
  return buckets.find((b) => h >= b.van && h <= b.tot) ?? null;
}

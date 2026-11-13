/**
 * Kans dat een 1B echt valt. Een melding gaat eerst naar een vrije reguliere plek in het hele cluster; pas als die
 * allemaal bezet zijn, valt er een 1B. Ziekte kan meetellen: wie uitvalt, laat zijn plekken leeg.
 *
 *   meldingen in het cluster   N ~ Poisson(som van de verwachtingen per regio)
 *   uitval                     U = plekken van wie uitvalt, iedere dienst met kans p
 *   tekort                     T = max(0, N + U - reguliere plekken)
 *
 * De j-de 1B valt als T >= j. Exact, door de verdelingen op te tellen (convolutie).
 */
import type { NormParameters } from './parameters';
import { WEKEN, lamNormWeek, plekkenNormWeek, regiosVanCluster, spelingTabel } from './norm';

/** Op 0..n, tot de staart verwaarloosbaar is. */
export function poissonVerdeling(lam: number): number[] {
  if (!(lam > 0)) return [1];
  const n = Math.ceil(lam + 12 * Math.sqrt(lam) + 25);
  const p = new Array<number>(n + 1);
  // vanaf de top rekenen houdt het nauwkeurig, ook bij een grote verwachting
  const top = Math.floor(lam);
  let logTop = -lam;
  for (let k = 1; k <= top; k++) logTop += Math.log(lam / k);
  p[top] = Math.exp(logTop);
  for (let k = top + 1; k <= n; k++) p[k] = (p[k - 1] * lam) / k;
  for (let k = top - 1; k >= 0; k--) p[k] = (p[k + 1] * (k + 1)) / lam;
  return p;
}

export function convolutie(a: number[], b: number[]): number[] {
  const c = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; j < b.length; j++) c[i + j] += a[i] * b[j];
  }
  return c;
}

/** Iedere dienst (met zijn aantal plekken) valt uit met kans p. */
export function uitvalVerdeling(diensten: number[], p: number): number[] {
  let v = [1];
  if (!(p > 0)) return v;
  for (const plekken of diensten) {
    if (plekken <= 0) continue;
    const d = new Array<number>(plekken + 1).fill(0);
    d[0] = 1 - p;
    d[plekken] += p;
    v = convolutie(v, d);
  }
  return v;
}

export interface Kans1B {
  lam: number;
  /** Zonder 1B. */
  regulier: number;
  beschikbaar: number;
  /** Door ziekte. */
  uitval: number;
  /** Alle reguliere plekken bezet. */
  minstensEen: number;
  perPlek: number[];
  /** Zonder 1B: de kans dat er een nodig was. */
  gemiddeld: number;
  /** Kans dat ook alle 1B's samen niet genoeg zijn. */
  tekort: number;
}

/** Voor een cluster of één regio; diensten is per reguliere dienst het aantal plekken (2 voor een 2). */
export function kans1B(o: { lam: number; diensten: number[]; beschikbaar: number; uitval: number }): Kans1B {
  const regulier = o.diensten.reduce((a, b) => a + Math.max(0, b), 0);
  const d = convolutie(poissonVerdeling(o.lam), uitvalVerdeling(o.diensten, o.uitval));
  // staart: P(N + U >= regulier + j)
  const vanaf = (x: number) => { let s = 0; for (let i = Math.max(0, x); i < d.length; i++) s += d[i]; return Math.min(1, s); };
  const perPlek = Array.from({ length: o.beschikbaar }, (_, j) => vanaf(regulier + j + 1));
  const minstensEen = vanaf(regulier + 1);
  return {
    lam: o.lam, regulier, beschikbaar: o.beschikbaar,
    uitval: o.diensten.reduce((a, b) => a + Math.max(0, b), 0) * o.uitval,
    minstensEen, perPlek,
    gemiddeld: o.beschikbaar ? perPlek.reduce((a, b) => a + b, 0) / o.beschikbaar : minstensEen,
    tekort: vanaf(regulier + o.beschikbaar + 1),
  };
}

export interface RegioDag {
  regio: string;
  lam: number;
  diensten: number[];
  beschikbaar: number;
  /** Uit het rooster, uit de vastgestelde regelplekken (nog geen rooster) of uit een voorspelling. */
  bron: 'rooster' | 'norm' | 'voorspelling';
}

export interface ClusterDag {
  cluster: Kans1B;
  /** Extra reguliere plekken uit de clusterspeling (vastgestelde regelplekken). */
  speling: number;
  /** Per regio: de kans dat de 1B zou vallen als de regio alles zelf moest opvangen. */
  regios: { regio: string; alleen: number; bron: RegioDag['bron'] }[];
  /** Voor de uitleg per plek (plekkans.ts). */
  dagen: RegioDag[];
}

/** Met ter vergelijking elke regio op zichzelf. */
export function clusterDag(regios: RegioDag[], uitval: number, speling = 0): ClusterDag {
  const diensten = [...regios.flatMap((r) => r.diensten), ...Array.from({ length: Math.max(0, speling) }, () => 1)];
  return {
    cluster: kans1B({ lam: regios.reduce((a, r) => a + r.lam, 0), diensten, beschikbaar: regios.reduce((a, r) => a + r.beschikbaar, 0), uitval }),
    speling,
    regios: regios.map((r) => ({ regio: r.regio, alleen: kans1B({ lam: r.lam, diensten: r.diensten, beschikbaar: r.beschikbaar, uitval }).minstensEen, bron: r.bron })),
    dagen: regios,
  };
}

/** De plekken op 80% min de 1B('s), als enkele diensten. */
export function normRegioDag(n: NormParameters, regio: string, week: number, dagMa: number, lam?: number): RegioDag | null {
  const k = plekkenNormWeek(n, regio, week, dagMa);
  const l = lam ?? lamNormWeek(n, regio, week, dagMa);
  if (k == null || l == null) return null;
  const beschikbaar = Math.min(k, n.beschikbaarPerDag);
  return { regio, lam: l, diensten: Array.from({ length: k - beschikbaar }, () => 1), beschikbaar, bron: 'norm' };
}

/** Normweek 1..52, maandag = 0: extra plekken voor de 95% in het cluster. */
export function spelingOpDag(n: NormParameters, cluster: string, week: number, dagMa: number): number {
  return spelingTabel(n, cluster)[week - 1]?.[dagMa] ?? 0;
}

interface Kans1BJaar {
  cluster: string;
  gemiddeld: number;
  minstensEen: number;
  beschikbaarPerDag: number;
  /** Week 1-9 en 49-52, en week 27-35. */
  winter: number;
  zomer: number;
  /** Als de regio alles zelf moest opvangen. */
  regios: { regio: string; alleen: number }[];
}

const cacheJaar = new WeakMap<NormParameters, Map<string, Kans1BJaar>>();

export function kans1BJaar(n: NormParameters, cluster: string, uitval = n.uitval): Kans1BJaar {
  let m = cacheJaar.get(n);
  if (!m) { m = new Map(); cacheJaar.set(n, m); }
  const sleutel = `${cluster}|${uitval}`;
  const al = m.get(sleutel);
  if (al) return al;
  const namen = regiosVanCluster(n, cluster);
  let gem = 0, een = 0, b = 0, win = 0, nWin = 0, zom = 0, nZom = 0;
  const alleen = namen.map(() => 0);
  for (let w = 1; w <= WEKEN; w++) {
    for (let d = 0; d < 7; d++) {
      const dag = namen.map((r) => normRegioDag(n, r, w, d)!);
      const c = clusterDag(dag, uitval, spelingOpDag(n, cluster, w, d));
      gem += c.cluster.gemiddeld; een += c.cluster.minstensEen; b += c.cluster.beschikbaar;
      c.regios.forEach((r, i) => { alleen[i] += r.alleen; });
      if (w <= 9 || w >= 49) { win += c.cluster.gemiddeld; nWin++; }
      if (w >= 27 && w <= 35) { zom += c.cluster.gemiddeld; nZom++; }
    }
  }
  const dagen = WEKEN * 7;
  const uit: Kans1BJaar = {
    cluster, gemiddeld: gem / dagen, minstensEen: een / dagen, beschikbaarPerDag: b / dagen,
    winter: nWin ? win / nWin : 0, zomer: nZom ? zom / nZom : 0,
    regios: namen.map((r, i) => ({ regio: r, alleen: alleen[i] / dagen })),
  };
  m.set(sleutel, uit);
  return uit;
}

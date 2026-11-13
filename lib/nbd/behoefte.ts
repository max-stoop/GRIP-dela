/**
 * De behoefte van de NBD per dag, tijdvak en kwartier, zoals de capaciteitsplanning NBD 2026: gesprekken in een
 * gewone week × de overlijdens van die dag ten opzichte van een gemiddelde dag × het NBD-volume ten opzichte van de
 * regio's, dan Erlang C per uur, naar boven afgerond op hele mensen.
 */
import type { NormParameters } from '../capaciteit/parameters';
import { lamNormWeek, normWeek, volumePerJaar, WEKEN } from '../capaciteit/norm';
import type { RunData } from '../model/types';
import type { BehoefteBron } from '../rooster/types';
import type { ToetsTegen } from '../store/afgeleid';
import { som } from '../store/afgeleid';
import { toDay, weekday, weekdayMon } from '../dates';
import { nodigErlang } from './erlang';
import { tijdvakken, uitvaartenPerJaar, type NbdParameters, type Uur } from './parameters';

const KWARTIER = 0.25;

export interface NbdKwartier {
  /** 7.25 = 7:15 */
  t: Uur;
  /** Die van het tijdvak, gelijk verdeeld over de kwartieren. */
  gesprekken: number;
  /** Erlang C, minstens de minimale bezetting. */
  nodig: number;
}

export interface NbdTijdvakBehoefte {
  van: Uur;
  tot: Uur;
  gesprekken: number;
  /** Erlang C per uur, naar boven afgerond. */
  nodig: number;
}

export interface NbdDag {
  datum: string;
  /** Ter uitleg. */
  uitvaarten: number;
  /** Ten opzichte van een gemiddelde dag op deze weekdag. */
  factor: number;
  gesprekken: number;
  bron: BehoefteBron;
  tijdvakken: NbdTijdvakBehoefte[];
  kwartieren: NbdKwartier[];
  /** Het laatste halfuur telt half. */
  uren: number;
  piek: number;
}

interface NbdBronnen {
  basis?: RunData | null;
  laatste?: RunData | null;
  norm: NormParameters;
}

/** [open, sluit) */
export function kwartierenOpen(p: Pick<NbdParameters, 'open' | 'sluit'>): Uur[] {
  const uit: Uur[] = [];
  for (let t = p.open; t < p.sluit - 1e-9; t += KWARTIER) uit.push(Math.round(t * 4) / 4);
  return uit;
}

/** Mag negatief of voorbij sluiten zijn. */
export function kwartierIndex(p: Pick<NbdParameters, 'open'>, t: Uur): number {
  return Math.round((t - p.open) * 4);
}

const volumeCache = new WeakMap<NormParameters, number>();
function normVolume(n: NormParameters): number {
  let v = volumeCache.get(n);
  if (v == null) {
    v = Object.keys(n.regios).reduce((a, r) => a + volumePerJaar(n, r), 0);
    volumeCache.set(n, v);
  }
  return v;
}

/** 1 met de startwaarden. */
export function schaal(p: NbdParameters, n: NormParameters): number {
  const v = normVolume(n);
  return v > 0 ? (uitvaartenPerJaar(p) * n.trend) / v : 0;
}

const gemiddeldCache = new WeakMap<NormParameters, number[]>();
/** Per weekdag (0 = maandag), volgens de vastgestelde regelplekken. */
function gemiddeldeDag(n: NormParameters): number[] {
  let g = gemiddeldCache.get(n);
  if (!g) {
    const regios = Object.keys(n.regios);
    g = Array.from({ length: 7 }, (_, dagMa) => {
      let s = 0;
      for (let w = 1; w <= WEKEN; w++) for (const r of regios) s += lamNormWeek(n, r, w, dagMa) ?? 0;
      return s / WEKEN;
    });
    gemiddeldCache.set(n, g);
  }
  return g;
}

/** Valt een dag buiten de gekozen voorspelling, dan de andere voorspelling, en anders de norm. */
export function uitvaartenOp(b: NbdBronnen, p: NbdParameters, datum: string, tegen: ToetsTegen = 'basis'): { uitvaarten: number; factor: number; bron: BehoefteBron } {
  const regios = Object.keys(b.norm.regios);
  const basis: [RunData | null | undefined, BehoefteBron] = [b.basis, 'basis'], laatste: [RunData | null | undefined, BehoefteBron] = [b.laatste, 'laatste'];
  const runs = tegen === 'norm' ? [] : tegen === 'basis' ? [basis, laatste] : [laatste, basis];
  const gem = gemiddeldeDag(b.norm)[weekdayMon(toDay(datum))];
  const f = schaal(p, b.norm);
  const uit = (l: number, bron: BehoefteBron) => ({ uitvaarten: l * f, factor: gem > 0 ? (l / gem) * f : f, bron });
  for (const [run, bron] of runs) {
    if (!run) continue;
    const l = som(run, regios, datum);
    if (l != null) return uit(l, bron);
  }
  const wk = normWeek(datum), dagMa = weekdayMon(toDay(datum));
  const l = regios.reduce((a, r) => a + (lamNormWeek(b.norm, r, wk, dagMa) ?? 0), 0);
  return uit(l, 'norm');
}

export function dagUitFactor(p: NbdParameters, datum: string, factor: number, uitvaarten: number, bron: BehoefteBron): NbdDag {
  const wd = weekday(toDay(datum));
  const rij = p.gesprekken[wd] ?? p.gesprekken[1];
  const vakken = tijdvakken(p).map((v, i) => {
    const g = Math.max(0, (rij[i] ?? 0) * factor);
    // zoals de capaciteitsplanning: Erlang C per uur (ook het laatste halfuur), naar boven afgerond
    return { van: v.van, tot: v.tot, gesprekken: g, nodig: Math.max(p.minBezetting, nodigErlang(g, p.aht, 3600, p.serviceLevel, p.wachttijd)) };
  });
  const kwartieren: NbdKwartier[] = [];
  for (const v of vakken) {
    const deel = KWARTIER / (v.tot - v.van);
    for (let t = v.van; t < v.tot - 1e-9; t += KWARTIER) kwartieren.push({ t: Math.round(t * 4) / 4, gesprekken: v.gesprekken * deel, nodig: v.nodig });
  }
  return {
    datum, uitvaarten, factor, bron,
    gesprekken: vakken.reduce((a, v) => a + v.gesprekken, 0),
    tijdvakken: vakken,
    kwartieren,
    uren: kwartieren.reduce((a, k) => a + k.nodig, 0) / 4,
    piek: vakken.reduce((a, v) => Math.max(a, v.nodig), 0),
  };
}

export function nbdBehoefte(b: NbdBronnen, p: NbdParameters, dates: string[], tegen: ToetsTegen = 'basis'): Record<string, NbdDag> {
  const uit: Record<string, NbdDag> = {};
  for (const d of dates) {
    const { uitvaarten, factor, bron } = uitvaartenOp(b, p, d, tegen);
    uit[d] = dagUitFactor(p, d, factor, uitvaarten, bron);
  }
  return uit;
}

/** Factor 1, voor de normweek en de vergelijking met de wensen. */
export function gewoneDag(p: NbdParameters, wd: number): NbdDag {
  // een willekeurige datum met deze weekdag (de datum telt verder niet mee)
  const datum = new Date(Date.UTC(2026, 0, 4 + wd)).toISOString().slice(0, 10);
  return dagUitFactor(p, datum, 1, 0, 'norm');
}

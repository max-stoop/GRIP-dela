/**
 * De keten uit "Nieuwe vastgestelde regelplekken 2027": volume uit de begroting → meldingen per regio per weekdag →
 * regelplekken (80%) → speling per cluster (95%) → te borgen uren → ruimte over.
 *
 *   meldingen = basisniveau(regio) × (1 + amplitude(regio) × (seizoensindex(week) − 1)) × dagindex(weekdag)
 *
 * Rekent precies zoals de Excel (zie norm.test.ts). Week 53 telt als week 52.
 */
import { isoWeek, toDay, weekdayMon } from '../dates';
import { poissonQuantile } from '../model/poisson';
import type { ClusterCode, NormParameters, NormRegio } from './parameters';

export const WEKEN = 52;

/** ISO-weeknummer; week 53 telt als 52. */
export function normWeek(datum: string): number {
  return Math.min(WEKEN, isoWeek(toDay(datum)));
}

/** 0..3, zoals de formatie in de Excel: week 1-13, 14-26, 27-39, 40-52. */
export function kwartaal(week: number): number {
  return Math.min(3, Math.floor((week - 1) / 13));
}

function normRegio(n: NormParameters, regio: string): NormRegio | null {
  return n.regios[regio] ?? null;
}

/** Natura plus het vrije-marktdeel van de overlijdens, met trend en correctie. */
export function volumePerJaar(n: NormParameters, regio: string): number {
  const r = normRegio(n, regio);
  if (!r) return 0;
  return (r.natura + r.cbs * r.vrijeMarkt) * n.trend * r.correctie;
}

function basisPerDag(n: NormParameters, regio: string): number {
  return volumePerJaar(n, regio) / n.dagenPerJaar;
}

interface Tabel {
  /** [week 0..51][dag ma..zo] */
  lam: number[][];
  /** [week][dag], op de dekkingsgraad per regio. */
  k: number[][];
}

const cache = new WeakMap<NormParameters, Map<string, Tabel>>();
const clusterCache = new WeakMap<NormParameters, Map<string, number[][]>>();

function tabel(n: NormParameters, regio: string): Tabel | null {
  const r = normRegio(n, regio);
  if (!r) return null;
  let m = cache.get(n);
  if (!m) { m = new Map(); cache.set(n, m); }
  let t = m.get(regio);
  if (!t) {
    const b = basisPerDag(n, regio);
    const lam = n.seizoen.slice(0, WEKEN).map((s) => n.dagIndex.map((di) => b * (1 + r.amplitude * (s - 1)) * di));
    t = { lam, k: lam.map((w) => w.map((l) => poissonQuantile(n.dekkingRegio, l))) };
    m.set(regio, t);
  }
  return t;
}

export function regiosVanCluster(n: NormParameters, cluster: ClusterCode | string): string[] {
  return Object.entries(n.regios).filter(([, r]) => r.cluster === cluster).map(([naam]) => naam);
}

/** week 1..52, dagMa 0 = maandag. */
export function lamNormWeek(n: NormParameters, regio: string, week: number, dagMa: number): number | null {
  const t = tabel(n, regio);
  return t ? t.lam[week - 1][dagMa] : null;
}

export function plekkenNormWeek(n: NormParameters, regio: string, week: number, dagMa: number): number | null {
  const t = tabel(n, regio);
  return t ? t.k[week - 1][dagMa] : null;
}

export function lamNorm(n: NormParameters, regio: string, datum: string): number | null {
  return lamNormWeek(n, regio, normWeek(datum), weekdayMon(toDay(datum)));
}

/** Inclusief de 1B. */
export function plekkenNorm(n: NormParameters, regio: string, datum: string): number | null {
  return plekkenNormWeek(n, regio, normWeek(datum), weekdayMon(toDay(datum)));
}

/** Wat het cluster nodig heeft voor 95% min de som van de regionale plekken; niet toegewezen aan een regio. */
export function spelingTabel(n: NormParameters, cluster: string): number[][] {
  let m = clusterCache.get(n);
  if (!m) { m = new Map(); clusterCache.set(n, m); }
  let t = m.get(cluster);
  if (!t) {
    const regios = regiosVanCluster(n, cluster).map((r) => tabel(n, r)!);
    t = Array.from({ length: WEKEN }, (_, w) => Array.from({ length: 7 }, (_, d) => {
      const lam = regios.reduce((s, r) => s + r.lam[w][d], 0);
      const k = regios.reduce((s, r) => s + r.k[w][d], 0);
      return Math.max(0, poissonQuantile(n.dekkingCluster, lam) - k);
    }));
    m.set(cluster, t);
  }
  return t;
}

interface BorgingWeek {
  week: number;
  /** Maandag t/m zondag. */
  plekken: number[];
  plekkenWeek: number;
  /** Plekken min 1B's. */
  regulier: number;
  beschikbaar: number;
  voorgangen: number;
  urenRegulier: number;
  urenBeschikbaar: number;
  urenVoorgangen: number;
  urenEigen: number;
  /** Naar rato van de meldingen. */
  urenSpeling: number;
  totaal: number;
}

/** Zoals tabblad Borging. */
export function borgingWeek(n: NormParameters, regio: string, week: number, metSpeling = true): BorgingWeek | null {
  const t = tabel(n, regio), r = normRegio(n, regio);
  if (!t || !r) return null;
  const w = week - 1;
  const plekken = t.k[w];
  const regulier = plekken.reduce((s, k) => s + Math.max(0, k - n.beschikbaarPerDag), 0);
  const beschikbaar = 7 * n.beschikbaarPerDag;
  const voorgangen = r.voorgangen * n.voorgangDagen;
  const urenRegulier = regulier * n.dienstUren;
  const urenBeschikbaar = beschikbaar * n.beschikbaarKans * n.dienstUren;
  const urenVoorgangen = voorgangen * n.voorgangUren;
  const urenEigen = urenRegulier + urenBeschikbaar + urenVoorgangen;
  let urenSpeling = 0;
  if (metSpeling) {
    const sp = spelingTabel(n, r.cluster)[w];
    const regios = regiosVanCluster(n, r.cluster).map((x) => tabel(n, x)!);
    for (let d = 0; d < 7; d++) {
      const lamC = regios.reduce((s, x) => s + x.lam[w][d], 0);
      if (lamC > 0) urenSpeling += (sp[d] * t.lam[w][d]) / lamC;
    }
    urenSpeling *= n.dienstUren;
  }
  return {
    week, plekken, plekkenWeek: plekken.reduce((a, b) => a + b, 0), regulier, beschikbaar, voorgangen,
    urenRegulier, urenBeschikbaar, urenVoorgangen, urenEigen, urenSpeling, totaal: urenEigen + urenSpeling,
  };
}

interface CapaciteitWeek {
  week: number;
  /** Contracturen van het team. */
  bezetting: number;
  verzuim: number;
  /** Gemiddeld over het jaar. */
  verlofNorm: number;
  borging: number;
  /** Na verzuim, verlof volgens norm en borging (zoals de Excel). */
  ruimte: number;
  ruimteMdw: number;
  ruimtePct: number;
  /** Bezetting min verzuim min borging. */
  verlofRuimte: number;
}

/** fte × uren per fte. */
function bezettingBegroting(n: NormParameters, regio: string, week: number): number {
  const r = normRegio(n, regio);
  return r ? r.fte[kwartaal(week)] * n.urenPerFte : 0;
}

/** bezetting is de som van de contracturen van het team; zonder waarde telt de begroting. */
export function capaciteitWeek(n: NormParameters, regio: string, week: number, opts: { bezetting?: number; metSpeling?: boolean } = {}): CapaciteitWeek | null {
  const b = borgingWeek(n, regio, week, opts.metSpeling ?? true);
  if (!b) return null;
  const bezetting = opts.bezetting ?? bezettingBegroting(n, regio, week);
  const verzuim = bezetting * n.verzuim;
  const verlofNorm = bezetting * n.verlof;
  const ruimte = bezetting - verzuim - verlofNorm - b.totaal;
  return {
    week, bezetting, verzuim, verlofNorm, borging: b.totaal, ruimte,
    ruimteMdw: ruimte / n.urenPerFte,
    ruimtePct: bezetting ? ruimte / bezetting : 0,
    verlofRuimte: bezetting - verzuim - b.totaal,
  };
}

export interface RegioJaar {
  regio: string;
  cluster: ClusterCode;
  volume: number;
  meldingenPerDag: number;
  amplitude: number;
  plekkenPerWeek: number;
  voorgangen: number;
  urenEigen: number;
  urenSpeling: number;
  borging: number;
  bezetting: number;
  verzuim: number;
  verlofNorm: number;
  ruimte: number;
  ruimteMdw: number;
  ruimtePct: number;
}

/** Gemiddeld over het jaar (tabblad Verbinding). */
export function regioJaar(n: NormParameters, regio: string, bezettingPerWeek?: (week: number) => number | undefined, metSpeling = true): RegioJaar | null {
  const r = normRegio(n, regio), t = tabel(n, regio);
  if (!r || !t) return null;
  let pl = 0, eigen = 0, sp = 0, borg = 0, bez = 0, vz = 0, vn = 0, ru = 0, lam = 0;
  for (let w = 1; w <= WEKEN; w++) {
    const b = borgingWeek(n, regio, w, metSpeling)!;
    const c = capaciteitWeek(n, regio, w, { bezetting: bezettingPerWeek?.(w), metSpeling })!;
    pl += b.plekkenWeek; eigen += b.urenEigen; sp += b.urenSpeling; borg += b.totaal;
    bez += c.bezetting; vz += c.verzuim; vn += c.verlofNorm; ru += c.ruimte;
    lam += t.lam[w - 1].reduce((a, x) => a + x, 0);
  }
  const W = WEKEN;
  return {
    regio, cluster: r.cluster, volume: volumePerJaar(n, regio), meldingenPerDag: lam / (W * 7), amplitude: r.amplitude,
    plekkenPerWeek: pl / W, voorgangen: r.voorgangen, urenEigen: eigen / W, urenSpeling: sp / W, borging: borg / W,
    bezetting: bez / W, verzuim: vz / W, verlofNorm: vn / W, ruimte: ru / W, ruimteMdw: ru / W / n.urenPerFte,
    ruimtePct: bez ? ru / bez : 0,
  };
}

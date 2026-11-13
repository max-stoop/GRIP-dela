/**
 * De vastgestelde regelplekken opnieuw berekenen uit de eigen meldingen, als voorstel. Wat de begroting vastlegt, blijft
 * staan. Het seizoen (vanaf twee jaar) is per dag de verhouding tot het jaar eromheen, per week gemiddeld en glad
 * gemaakt met drie golven; de correctie per regio laat de norm over 52 weken precies de meldingen geven.
 */
import { addDays, fromDay, toDay, weekdayMon } from '../dates';
import type { MeldingenData } from '../model/types';
import { lamNorm, normWeek, volumePerJaar, WEKEN } from './norm';
import type { NormParameters } from './parameters';

/** 52 hele weken. */
const PERIODE = 364;
/** Zoveel dagen met meldingen moet een regio in die periode hebben (de rest wordt naar rato aangevuld). */
const MIN_DAGEN = 300;
const GOLVEN = 3;

export interface NormRegioVoorstel {
  correctieOud: number;
  correctie: number;
  volumeOud: number;
  volume: number;
  /** Naar rato aangevuld bij een paar ontbrekende dagen. */
  meldingen: number;
}

export interface NormVoorstel {
  van: string;
  tot: string;
  /** null bij minder dan twee jaar historie. */
  seizoen: number[] | null;
  /** null bij minder dan een jaar historie. */
  dagIndex: number[] | null;
  regios: Record<string, NormRegioVoorstel>;
  /** Te weinig meldingen: die houden hun correctie. */
  zonder: string[];
}

const rond = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** null als te weinig regio's die dag een waarde hebben; anders naar rato aangevuld. */
function landelijk(m: MeldingenData, regios: string[]): (number | null)[] {
  const reeksen = regios.map((r) => m.regios[r]).filter((x): x is (number | null)[] => !!x);
  if (!reeksen.length) return [];
  return Array.from({ length: m.n }, (_, i) => {
    let s = 0, k = 0;
    for (const w of reeksen) if (w[i] != null) { s += w[i]!; k++; }
    return k >= 0.9 * reeksen.length ? (s * reeksen.length) / k : null;
  });
}

/** Uit hele weken aan het eind van de historie, hoogstens drie jaar. */
function weekdag(t: (number | null)[], start: number): number[] | null {
  const weken = Math.min(156, Math.floor(t.length / 7));
  if (weken < 52) return null;
  const som = new Array<number>(7).fill(0), n = new Array<number>(7).fill(0);
  for (let i = t.length - weken * 7; i < t.length; i++) {
    if (t[i] == null) continue;
    const d = weekdayMon(start + i);
    som[d] += t[i]!;
    n[d]++;
  }
  if (n.some((x) => x < 40)) return null;
  const gem = som.map((s, d) => s / n[d]);
  const alle = gem.reduce((a, b) => a + b, 0) / 7;
  return gem.map((g) => rond(g / alle, 3));
}

function seizoen(t: (number | null)[], start: number): number[] | null {
  const half = 182;
  if (t.length < 2 * PERIODE) return null;
  // voortschrijdend jaargemiddelde (alleen waar het hele jaar eromheen bekend is)
  const som = new Array<number>(WEKEN).fill(0), n = new Array<number>(WEKEN).fill(0);
  let s = 0, k = 0;
  for (let i = 0; i < Math.min(t.length, 2 * half); i++) if (t[i] != null) { s += t[i]!; k++; }
  for (let i = half; i + half < t.length; i++) {
    if (i > half) {
      const uit = t[i - half - 1], bij = t[i + half - 1];
      if (uit != null) { s -= uit; k--; }
      if (bij != null) { s += bij; k++; }
    }
    if (t[i] == null || k < 0.9 * 2 * half) continue;
    const w = normWeek(fromDay(start + i)) - 1;
    som[w] += t[i]! / (s / k);
    n[w]++;
  }
  if (n.some((x) => x < 7)) return null;
  const ruw = som.map((x, w) => x / n[w]);
  // glad: de eerste golven van de fourierreeks over een jaar van 52 weken
  const a0 = ruw.reduce((a, b) => a + b, 0) / WEKEN;
  const golven = Array.from({ length: GOLVEN }, (_, j) => {
    const f = (2 * Math.PI * (j + 1)) / WEKEN;
    return {
      f,
      a: (2 / WEKEN) * ruw.reduce((acc, v, w) => acc + v * Math.cos(f * w), 0),
      b: (2 / WEKEN) * ruw.reduce((acc, v, w) => acc + v * Math.sin(f * w), 0),
    };
  });
  return ruw.map((_, w) => rond((a0 + golven.reduce((acc, g) => acc + g.a * Math.cos(g.f * w) + g.b * Math.sin(g.f * w), 0)) / a0, 4));
}

/** null bij minder dan 52 weken meldingen. */
export function herberekenNorm(n: NormParameters, m: MeldingenData | null): NormVoorstel | null {
  if (!m || m.n < PERIODE) return null;
  const start = toDay(m.start);
  const regios = Object.keys(n.regios);
  let eind = m.n - 1;
  while (eind >= 0 && !regios.some((r) => m.regios[r]?.[eind] != null)) eind--;
  if (eind + 1 < PERIODE) return null;
  const t = landelijk(m, regios).slice(0, eind + 1);
  const nieuweSeizoen = seizoen(t, start);
  const nieuweDag = weekdag(t, start);
  const basis: NormParameters = { ...n, seizoen: nieuweSeizoen ?? n.seizoen, dagIndex: nieuweDag ?? n.dagIndex };
  const van = fromDay(start + eind - PERIODE + 1), tot = fromDay(start + eind);
  const dagen = Array.from({ length: PERIODE }, (_, i) => addDays(van, i));
  const uit: Record<string, NormRegioVoorstel> = {};
  const zonder: string[] = [];
  for (const r of regios) {
    const oud = n.regios[r];
    const w = m.regios[r];
    let som = 0, k = 0, verwacht = 0;
    dagen.forEach((d, i) => {
      const v = w?.[eind - PERIODE + 1 + i];
      if (v == null) return;
      som += v;
      k++;
      verwacht += lamNorm(basis, r, d) ?? 0;
    });
    if (k < MIN_DAGEN || verwacht <= 0) {
      zonder.push(r);
      uit[r] = { correctieOud: oud.correctie, correctie: oud.correctie, volumeOud: volumePerJaar(n, r), volume: volumePerJaar(n, r), meldingen: k ? (som * PERIODE) / k : 0 };
      continue;
    }
    // verwacht is gerekend over dezelfde dagen als de meldingen, dus de verhouding is zuiver
    const correctie = rond(oud.correctie * (som / verwacht), 3);
    const nieuw: NormParameters = { ...basis, regios: { ...basis.regios, [r]: { ...oud, correctie } } };
    uit[r] = { correctieOud: oud.correctie, correctie, volumeOud: volumePerJaar(n, r), volume: volumePerJaar(nieuw, r), meldingen: (som * PERIODE) / k };
  }
  return { van, tot, seizoen: nieuweSeizoen, dagIndex: nieuweDag, regios: uit, zonder };
}

export function pasVoorstelToe(n: NormParameters, v: NormVoorstel, bron: string): NormParameters {
  return {
    ...n,
    bron,
    seizoen: v.seizoen ?? n.seizoen,
    dagIndex: v.dagIndex ?? n.dagIndex,
    regios: Object.fromEntries(Object.entries(n.regios).map(([r, x]) => [r, { ...x, correctie: v.regios[r]?.correctie ?? x.correctie }])),
  };
}

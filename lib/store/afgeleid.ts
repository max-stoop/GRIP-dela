import { poissonQuantile } from '../model/poisson';
import type { MeldingenData, RunData } from '../model/types';
import { toDay, fromDay } from '../dates';
import type { Behoefte, BehoefteBron } from '../rooster/types';
import type { Verschuiving } from './types';
import type { NormParameters } from '../capaciteit/parameters';
import { lamNorm, plekkenNorm } from '../capaciteit/norm';
import type { FactorKey } from '../model/config';

interface Index {
  regio: Map<string, number>;
  datum: Map<string, number>;
}

const idx = new WeakMap<RunData, Index>();

function index(run: RunData): Index {
  let i = idx.get(run);
  if (!i) {
    i = { regio: new Map(run.regios.map((r, j) => [r, j])), datum: new Map(run.dates.map((d, j) => [d, j])) };
    idx.set(run, i);
  }
  return i;
}

export function lam(run: RunData, regio: string, datum: string): number | null {
  const i = index(run), r = i.regio.get(regio), d = i.datum.get(datum);
  return r == null || d == null ? null : run.lam[r][d];
}

export function lamBasis(run: RunData, regio: string, datum: string): number | null {
  const i = index(run), r = i.regio.get(regio), d = i.datum.get(datum);
  return r == null || d == null ? null : run.base[r][d];
}

export function som(run: RunData, regios: string[], datum: string, basis = false): number | null {
  let s = 0, n = 0;
  for (const r of regios) {
    const v = basis ? lamBasis(run, r, datum) : lam(run, r, datum);
    if (v != null) { s += v; n++; }
  }
  return n ? s : null;
}

export function plekken(run: RunData, regio: string, datum: string, alpha: number): number | null {
  const l = lam(run, regio, datum);
  return l == null ? null : poissonQuantile(alpha, l);
}

/** Log-schaal. */
export function factoren(run: RunData, regio: string, datum: string): Partial<Record<FactorKey, number>> {
  const d = index(run).datum.get(datum);
  const f = run.fac[regio];
  if (d == null || !f) return {};
  const out: Partial<Record<FactorKey, number>> = {};
  for (const [k, arr] of Object.entries(f)) if (arr && arr[d]) out[k as FactorKey] = arr[d];
  return out;
}

export type ToetsTegen = 'basis' | 'laatste' | 'norm';

export interface BehoefteBronnen {
  basis?: RunData | null;
  laatste?: RunData | null;
  /** Voor dagen die de nieuwere runs niet meer bevatten. */
  extra?: (RunData | null | undefined)[];
  /** Voor dagen zonder voorspelling, en ter vergelijking. */
  norm?: NormParameters | null;
  /** Afspraken in het cluster: zoveel plekken van de ene regio naar de andere. */
  verschuivingen?: Verschuiving[];
}

/** Bij "basis": roosterbasis, laatste run, oudere runs, norm. Bij "laatste" begint het bij de laatste run, bij "norm" alleen de norm. */
export function behoefteVoor(b: BehoefteBronnen, regio: string, dates: string[], opts: { alphaRegio: number; tegen?: ToetsTegen }): Behoefte {
  const tegen = opts.tegen ?? 'basis';
  const runs: [RunData | null | undefined, BehoefteBron][] = tegen === 'norm' ? [] : [
    ...(tegen === 'basis' ? [[b.basis, 'basis'] as [RunData | null | undefined, BehoefteBron]] : []),
    [b.laatste, 'laatste'],
    ...(b.extra ?? []).map((r) => [r, 'laatste'] as [RunData | null | undefined, BehoefteBron]),
  ];
  const out: Behoefte = {};
  for (const d of dates) {
    out[d] = null;
    const kNorm = b.norm ? plekkenNorm(b.norm, regio, d) : null;
    for (const [run, bron] of runs) {
      if (!run) continue;
      const l = lam(run, regio, d);
      if (l != null) {
        out[d] = { k: poissonQuantile(opts.alphaRegio, l), lam: l, bron, kNorm };
        break;
      }
    }
    if (!out[d] && b.norm && kNorm != null) {
      out[d] = { k: kNorm, lam: lamNorm(b.norm, regio, d)!, bron: 'norm', kNorm };
    }
    const dag = out[d];
    if (dag && b.verschuivingen?.length) {
      const v = verschovenOp(b.verschuivingen, regio, d);
      // nooit minder dan nul plekken
      const echt = Math.max(-dag.k, v);
      if (echt) out[d] = { ...dag, k: dag.k + echt, verschoven: echt };
    }
  }
  return out;
}

/** Plekken die een regio op een dag meer (positief) of minder (negatief) doet volgens de afspraken in het cluster. */
export function verschovenOp(lijst: Verschuiving[], regio: string, datum: string): number {
  let n = 0;
  for (const v of lijst) {
    if (datum < v.van || datum > v.tot) continue;
    if (v.naarRegio === regio) n += v.plekken;
    if (v.vanRegio === regio) n -= v.plekken;
  }
  return n;
}

export function meldingenEind(m: MeldingenData): string {
  return fromDay(toDay(m.start) + m.n - 1);
}

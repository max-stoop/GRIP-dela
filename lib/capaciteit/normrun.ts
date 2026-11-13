/** De vastgestelde regelplekken als voorspelling, zolang er geen eigen meldingen zijn. */
import { HORIZON_DAYS, REGIONS, type FactorKey } from '../model/config';
import type { Run } from '../model/types';
import { addDays } from '../dates';
import { lamNorm } from './norm';
import type { NormParameters } from './parameters';

export const NORM_RUN_ID = 'norm';

const cache = new WeakMap<NormParameters, Map<string, Run>>();

export function normRun(n: NormParameters, vandaag: string, dagen = HORIZON_DAYS): Run {
  let m = cache.get(n);
  if (!m) { m = new Map(); cache.set(n, m); }
  const sleutel = `${vandaag}|${dagen}`;
  const al = m.get(sleutel);
  if (al) return al;
  // zoals een gewone run: de verwachting begint de dag na uitgifte
  const dates = Array.from({ length: dagen }, (_, i) => addDays(vandaag, i + 1));
  const regios = REGIONS.filter((r) => n.regios[r]);
  const lam = regios.map((r) => dates.map((d) => lamNorm(n, r, d) ?? 0));
  const run: Run = {
    meta: {
      id: NORM_RUN_ID, soort: 'vastgestelde regelplekken', uitgegeven: vandaag, gemaakt: `${vandaag}T00:00:00`,
      info: { notes: [], mom7: 0, level28: 0, cbs: 0, covid: 0, flu: 0, data_end: null, coef: {} as Record<FactorKey, number> },
    },
    data: { id: NORM_RUN_ID, dates, regios, lam, base: lam, fac: {} },
  };
  m.set(sleutel, run);
  return run;
}

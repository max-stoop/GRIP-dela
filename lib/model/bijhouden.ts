/** Gedeeld door de app en de dagelijkse taak op de server. */
import { fromDay, nowStamp, toDay } from '../dates';
import type { ExternData, RunData, RunMeta } from './types';

export interface BronAntwoord {
  bron: string;
  reeksen: { sleutel: string; variabele: string; start: string; v: (number | null)[] }[];
  rijen: number;
  normaal?: number[];
}

/** Nieuwe waarden over de oude heen. */
export function voegExternToe(extern: ExternData, bron: string, res: BronAntwoord): ExternData {
  const out = { ...extern, [bron]: { ...(extern[bron] ?? {}) } };
  for (const r of res.reeksen) {
    const perVar = (out[bron][r.variabele] = { ...(out[bron][r.variabele] ?? {}) });
    const ser = (perVar[r.sleutel] = { ...(perVar[r.sleutel] ?? {}) });
    const s = toDay(r.start);
    r.v.forEach((v, i) => { if (v != null) ser[fromDay(s + i)] = v; });
  }
  return out;
}

/** Zoveel runs blijven bewaard; de roosterbasis altijd. */
const MAX_RUNS = 60;

export function runsBijwerken(runs: RunMeta[], nieuw: { meta: RunMeta; data: RunData }[], roosterbasis: string | null | undefined): { alle: RunMeta[]; weg: RunMeta[] } {
  let alle = [...nieuw.map((r) => r.meta), ...runs.filter((m) => !nieuw.some((r) => r.meta.id === m.id))];
  alle.sort((a, b) => (a.uitgegeven === b.uitgegeven ? b.gemaakt.localeCompare(a.gemaakt) : b.uitgegeven.localeCompare(a.uitgegeven)));
  const weg = alle.slice(MAX_RUNS).filter((m) => m.id !== roosterbasis);
  alle = alle.filter((m) => !weg.includes(m));
  return { alle, weg };
}

/** De datum en het tijdstip. */
export function uniekRunId(issue: string, runs: RunMeta[], nu = nowStamp()): string {
  const base = `${issue}_${nu.slice(11).replace(/:/g, '')}`;
  let id = base, i = 1;
  while (runs.some((r) => r.id === id)) id = `${base}-${++i}`;
  return id;
}

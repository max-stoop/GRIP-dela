/** Gedeelde hulpfuncties voor het ophalen van externe bronnen (alleen op de server). */
export interface Reeks {
  sleutel: string;
  variabele: string;
  start: string;
  v: (number | null)[];
}

export interface BronResultaat {
  bron: string;
  reeksen: Reeks[];
  /** Alleen bij klimaatnormalen: Fourier-coëfficiënten. */
  normaal?: number[];
  rijen: number;
}

export const BRONNEN = ['weer', 'lucht', 'seizoen', 'riool', 'cbs', 'normalen', 'weer_archief', 'lucht_archief'] as const;
export type BronNaam = (typeof BRONNEN)[number];

const UA = { 'User-Agent': 'GRIP-regelplekken/1.0', Accept: 'application/json, text/csv, */*' };

export async function haal(url: string, timeoutMs = 60_000): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: UA, signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} bij ${new URL(url).host}`);
    return r;
  } finally {
    clearTimeout(t);
  }
}

const dayOf = (iso: string) => Math.round(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / 86_400_000);
const isoOf = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

export function naarReeksen(rijen: [string, string, string, number | null][]): { reeksen: Reeks[]; rijen: number } {
  const groep = new Map<string, [number, number][]>();
  let n = 0;
  for (const [s, d, v, w] of rijen) {
    if (w == null || !Number.isFinite(w)) continue;
    const k = `${s}\u0000${v}`;
    let g = groep.get(k);
    if (!g) groep.set(k, (g = []));
    g.push([dayOf(d), w]);
    n++;
  }
  const reeksen: Reeks[] = [];
  for (const [k, pts] of groep) {
    const [sleutel, variabele] = k.split('\u0000');
    pts.sort((a, b) => a[0] - b[0]);
    const s = pts[0][0], e = pts[pts.length - 1][0];
    const v: (number | null)[] = new Array(e - s + 1).fill(null);
    for (const [d, w] of pts) v[d - s] = Math.round(w * 1000) / 1000;
    reeksen.push({ sleutel, variabele, start: isoOf(s), v });
  }
  return { reeksen, rijen: n };
}

/** RIVM rioolwater SARS-CoV-2, landelijk (sinds juli 2025 wekelijks bijgewerkt). */
import { haal, naarReeksen, type BronResultaat } from './common';

const URLS = [
  'https://data.rivm.nl/data/covid-19/COVID-19_rioolwaterdata_landelijk.csv',
  'https://data.rivm.nl/covid-19/COVID-19_rioolwaterdata_landelijk.csv',
];

function splitRegel(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === sep && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Leest de CSV: zoekt zelf de datum- en RNA-kolom en het scheidingsteken. */
export function parseRiool(text: string): [string, string, string, number | null][] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('Leeg bestand van RIVM');
  const sep = [';', ',', '\t'].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const head = splitRegel(lines[0], sep).map((h) => h.toLowerCase());
  const dc = head.findIndex((h) => h.includes('date') || h.includes('datum'));
  const vc = head.findIndex((h) => h.includes('rna'));
  if (dc < 0 || vc < 0) throw new Error('Kolommen voor datum en RNA niet gevonden in RIVM-bestand');
  const rijen: [string, string, string, number | null][] = [];
  for (const l of lines.slice(1)) {
    const c = splitRegel(l, sep);
    const d = c[dc]?.match(/(\d{4})-(\d{2})-(\d{2})/) ?? c[dc]?.match(/(\d{2})-(\d{2})-(\d{4})/);
    if (!d) continue;
    const iso = d[1].length === 4 ? `${d[1]}-${d[2]}-${d[3]}` : `${d[3]}-${d[2]}-${d[1]}`;
    const raw = c[vc]?.replace(/\s/g, '');
    if (!raw) continue;
    const v = Number(raw.includes(',') && !raw.includes('.') ? raw.replace(',', '.') : raw);
    if (Number.isFinite(v)) rijen.push(['NL', iso, 'covid_rna', v]);
  }
  if (!rijen.length) throw new Error('Geen bruikbare rijen in RIVM-bestand');
  return rijen;
}

export async function rioolwater(): Promise<BronResultaat> {
  let laatste: unknown = null;
  for (const u of URLS) {
    try {
      return { bron: 'riool', ...naarReeksen(parseRiool(await (await haal(u, 90_000)).text())) };
    } catch (e) {
      laatste = e;
    }
  }
  throw laatste instanceof Error ? laatste : new Error('RIVM niet bereikbaar');
}

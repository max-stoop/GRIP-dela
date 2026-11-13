/** Inlezen van de meldingenhistorie uit Excel of CSV: lang (datum, regio, aantal) of breed (per regio een kolom). */
import { REGIONS } from './model/config';
import { toDay, fromDay } from './dates';
import type { MeldingenData } from './model/types';

export interface ImportResultaat {
  data: MeldingenData;
  rijen: number;
  regios: number;
  van: string;
  tot: string;
  onbekend: string[];
  dubbel: number;
  /** Regio-dagen zonder rij (of met een lege cel) tussen de eerste en laatste dag van die regio: die tellen als 0. */
  nul: number;
}

const sleutel = (s: string) => s.toLowerCase().replace(/[/\-–]/g, '-').replace(/\s+/g, ' ').trim();
const REGIO_MAP = new Map(REGIONS.map((r) => [sleutel(r), r]));

export function herkenRegio(naam: string): string | null {
  return REGIO_MAP.get(sleutel(String(naam))) ?? null;
}

/** Datum uit Excel-getal, Date of tekst (2026-10-05, 5-10-2026, 5/10/2026). */
export function leesDatum(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // Excel-datums komen als middernacht UTC binnen; anders telt de lokale datum
    const utc = v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0;
    const [y, mo, d] = utc ? [v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()] : [v.getFullYear(), v.getMonth(), v.getDate()];
    return `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) return fromDay(Math.floor(v) - 25569);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function leesGetal(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Het scheidingsteken volgt uit de kopregel. */
export function leesCsv(tekst: string): Record<string, unknown>[] {
  const regels = tekst.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!regels.length) return [];
  const sep = [';', ',', '\t'].sort((a, b) => regels[0].split(b).length - regels[0].split(a).length)[0];
  // een scheidingsteken tussen aanhalingstekens hoort bij de waarde ("Noord-Holland; Midden"), "" is een aanhalingsteken
  const cel = (l: string) => {
    const uit: string[] = [];
    let cur = '', tussen = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') { if (tussen && l[i + 1] === '"') { cur += '"'; i++; } else tussen = !tussen; }
      else if (ch === sep && !tussen) { uit.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    uit.push(cur.trim());
    return uit;
  };
  const kop = cel(regels[0]);
  return regels.slice(1).map((l) => Object.fromEntries(cel(l).map((c, i) => [kop[i] ?? `kolom${i}`, c])));
}

export function rijenNaarMeldingen(rows: Record<string, unknown>[]): ImportResultaat {
  if (!rows.length) throw new Error('Het bestand bevat geen rijen.');
  const kolommen = Object.keys(rows[0]);
  const lc = new Map(kolommen.map((k) => [k.toLowerCase().trim(), k]));
  const punten: [string, string, number][] = [];
  const onbekend = new Set<string>();
  if (lc.has('datum') && lc.has('regio') && lc.has('aantal')) {
    for (const r of rows) {
      const d = leesDatum(r[lc.get('datum')!]), n = leesGetal(r[lc.get('aantal')!]), naam = String(r[lc.get('regio')!] ?? '').trim();
      if (!d || n == null || !naam) continue;
      const regio = herkenRegio(naam);
      if (!regio) { onbekend.add(naam); continue; }
      punten.push([d, regio, n]);
    }
  } else {
    const dcol = kolommen[0];
    const regioKol = kolommen.slice(1).map((k) => [k, herkenRegio(k)] as const);
    regioKol.filter(([, r]) => !r).forEach(([k]) => onbekend.add(k));
    for (const r of rows) {
      const d = leesDatum(r[dcol]);
      if (!d) continue;
      for (const [k, regio] of regioKol) {
        if (!regio) continue;
        const n = leesGetal(r[k]);
        if (n != null) punten.push([d, regio, n]);
      }
    }
  }
  if (!punten.length) throw new Error('Geen bruikbare rijen gevonden. Verwacht: kolommen datum, regio, aantal, of een datumkolom met per regio een kolom.');
  const van = punten.reduce((a, p) => (p[0] < a ? p[0] : a), punten[0][0]);
  const tot = punten.reduce((a, p) => (p[0] > a ? p[0] : a), punten[0][0]);
  const n = toDay(tot) - toDay(van) + 1;
  const regios: Record<string, (number | null)[]> = {};
  let dubbel = 0;
  for (const [d, r, v] of punten) {
    const a = (regios[r] ??= new Array<number | null>(n).fill(null));
    const i = toDay(d) - toDay(van);
    if (a[i] != null) dubbel++;
    a[i] = v;
  }
  // een export heeft vaak alleen dagen met meldingen: een dag zonder rij tussen de eerste en laatste dag van een regio is
  // 0, geen onbekende dag (anders schat het model te hoog). Voor de eerste en na de laatste dag blijft het onbekend.
  let nul = 0;
  for (const a of Object.values(regios)) {
    const eerste = a.findIndex((x) => x != null), laatste = a.length - 1 - [...a].reverse().findIndex((x) => x != null);
    for (let i = eerste; i >= 0 && i <= laatste; i++) if (a[i] == null) { a[i] = 0; nul++; }
  }
  return { data: { start: van, n, regios }, rijen: punten.length, regios: Object.keys(regios).length, van, tot, onbekend: [...onbekend].sort(), dubbel, nul };
}

/** Eerste rij = kop; lege cellen worden null. */
export function tabelNaarRijen(tabel: unknown[][]): Record<string, unknown>[] {
  if (!tabel.length) return [];
  const kop = tabel[0].map((k, i) => (k == null || k === '' ? `kolom${i}` : String(k)));
  return tabel.slice(1)
    .filter((r) => r.some((c) => c != null && c !== ''))
    .map((r) => Object.fromEntries(kop.map((k, i) => [k, r[i] ?? null])));
}

export async function leesBestand(file: File): Promise<ImportResultaat> {
  const naam = file.name.toLowerCase();
  if (naam.endsWith('.csv') || naam.endsWith('.txt')) return rijenNaarMeldingen(leesCsv(await file.text()));
  if (naam.endsWith('.xls')) throw new Error('Oude .xls-bestanden worden niet gelezen. Sla het bestand op als .xlsx of als CSV.');
  // read-excel-file leest alleen .xlsx en draait in een web worker
  const { readSheet } = await import('read-excel-file/browser');
  return rijenNaarMeldingen(tabelNaarRijen(await readSheet(file) as unknown[][]));
}

interface Samengevoegd {
  data: MeldingenData;
  nieuw: number;
  /** Het bestand telt. */
  gewijzigd: number;
  gelijk: number;
}

/** Waar het bestand een aantal heeft, telt dat; de rest blijft. Zo kun je elke dag alleen de laatste dagen inlezen. */
export function voegSamen(oud: MeldingenData | null, nieuw: MeldingenData): Samengevoegd {
  if (!oud || !oud.n) {
    const nieuwAantal = Object.values(nieuw.regios).reduce((a, w) => a + w.filter((v) => v != null).length, 0);
    return { data: nieuw, nieuw: nieuwAantal, gewijzigd: 0, gelijk: 0 };
  }
  const s = Math.min(toDay(oud.start), toDay(nieuw.start));
  const e = Math.max(toDay(oud.start) + oud.n - 1, toDay(nieuw.start) + nieuw.n - 1);
  const n = e - s + 1;
  const regios: Record<string, (number | null)[]> = {};
  let nieuwAantal = 0, gewijzigd = 0, gelijk = 0;
  for (const r of new Set([...Object.keys(oud.regios), ...Object.keys(nieuw.regios)])) {
    const uit = new Array<number | null>(n).fill(null);
    const o = oud.regios[r], oo = toDay(oud.start) - s;
    if (o) o.forEach((v, i) => { if (v != null) uit[oo + i] = v; });
    const w = nieuw.regios[r], no = toDay(nieuw.start) - s;
    if (w) w.forEach((v, i) => {
      if (v == null) return;
      const was = uit[no + i];
      if (was == null) nieuwAantal++;
      else if (was !== v) gewijzigd++;
      else gelijk++;
      uit[no + i] = v;
    });
    regios[r] = uit;
  }
  return { data: { start: fromDay(s), n, regios }, nieuw: nieuwAantal, gewijzigd, gelijk };
}

/** Regio-dagen met een aantal die niet in het nieuwe bestand staan. */
export function verdwijntBijVervangen(oud: MeldingenData | null, nieuw: MeldingenData): number {
  if (!oud) return 0;
  let weg = 0;
  for (const [r, w] of Object.entries(oud.regios)) {
    const nw = nieuw.regios[r], off = toDay(oud.start) - toDay(nieuw.start);
    w.forEach((v, i) => { if (v != null && (nw?.[off + i] ?? null) == null) weg++; });
  }
  return weg;
}

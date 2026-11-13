/**
 * Een jaarrooster uit Excel inlezen. Namen worden niet gelezen en niet bewaard: een rij is "rij 3, 32 uur".
 * Een blad heeft een cel "mw" met rechts "contract-uren", erboven een rij met "datum" en de dagnummers, en daaronder de
 * medewerkers tot "regelplekken gepland".
 */
import { addDays, fromDay, mondayOf, toDay, weekday, weekIndex } from './dates';
import type { DienstCode } from './rooster/types';

export type Cel = string | number | boolean | Date | null | undefined;

export interface JaarRij {
  /** Zo heet de rij in de app, zonder naam. */
  nr: number;
  contract: number;
  /** Klein geschreven, zonder spaties; '' als het vakje leeg is. */
  codes: string[];
}

export interface JaarBlad {
  blad: string;
  /** Uit de bladnaam, of null. */
  regio: string | null;
  /** Voorkeuren, uren of een oude versie: standaard niet importeren. */
  variant: boolean;
  dagen: string[];
  rijen: JaarRij[];
  /** Flex en hulprijen, zonder contracturen. */
  overgeslagen: number;
}

export const BLAD_REGIO: Record<string, string> = { AMS: 'Amsterdam', NHN: 'Noord-Holland', NHM: 'Noord-Holland Midden', SR: 'Spaarne-Rijnland' };

/** Wat hier niet staat, kies je bij het importeren (standaard vrij). RV en NB kunnen ook als wens "vrij" mee. */
export const CODE_STANDAARD: Record<string, DienstCode> = {
  '1': '1', '1m': '1M', m: '1M', '2': '2', '1b': '1B', bb: '1B', b: '1B',
  dg: 'DG2', dg2: 'DG2', dg1: 'DG1',
  o: 'O', or: 'OR', vms: 'VMS', ms: 'VMS', td: 'TD',
  v: 'V', v0: 'V', vo: 'V', vl: 'V', bv: 'V', vg: 'V', vp: 'V', va: 'V', zv: 'V',
  z: 'Z', ziek: 'Z',
  vrij: '-', '0': '-', x: '-', rv: '-', nb: '-', w: '-',
};

export const WENS_VRIJ = new Set(['rv', 'nb']);

const tekst = (v: Cel) => (v == null ? '' : v instanceof Date ? '' : String(v).trim());
const klein = (v: Cel) => tekst(v).toLowerCase().replace(/\s+/g, '');

function codeVan(v: Cel): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v).replace('.', ',');
  return klein(v);
}

function regioUitBlad(blad: string): { regio: string | null; variant: boolean } {
  const kaal = blad.trim();
  const variant = /\(|uren|voorkeur|oud|kopie|copy/i.test(kaal);
  const kern = kaal.replace(/\s*\(.*$/, '').trim().toUpperCase();
  if (BLAD_REGIO[kern]) return { regio: BLAD_REGIO[kern], variant };
  const vol = Object.values(BLAD_REGIO).find((r) => r.toLowerCase() === kaal.replace(/\s*\(.*$/, '').trim().toLowerCase());
  return { regio: vol ?? null, variant: variant || !vol };
}

/** Het jaar uit de bestandsnaam ("2026_Jaarrooster"), anders null. */
export function jaarUitNaam(naam: string): number | null {
  const m = naam.match(/(?:^|\D)(20\d{2})(?:\D|$)/);
  return m ? Number(m[1]) : null;
}

function startIsoJaar(jaar: number): string {
  const jan4 = toDay(`${jaar}-01-04`);
  return fromDay(mondayOf(jan4));
}

/** Echte datums, of dagnummers die vanaf de eerste dag doortellen. Klopt de reeks niet, dan null. */
export function leesDagen(rij: Cel[], jaar: number | null): string[] | null {
  // de dagen lopen door tot het eerste vakje dat geen dag is (daarna staan vaak totalen)
  const isDag = (v: Cel) => v instanceof Date || (typeof v === 'number' ? Number.isInteger(v) : /^\d{1,2}$/.test(tekst(v)));
  const eind = rij.findIndex((v) => !isDag(v));
  const waarden = eind < 0 ? [...rij] : rij.slice(0, eind);
  if (!waarden.length) return null;
  if (waarden[0] instanceof Date) {
    const d = waarden.map((v) => (v instanceof Date ? fromDay(Math.floor(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()) / 86_400_000)) : null));
    return d.every(Boolean) ? (d as string[]) : null;
  }
  const nrs = waarden.map((v) => (typeof v === 'number' ? v : Number(tekst(v))));
  if (nrs.some((n) => !Number.isInteger(n) || n < 1 || n > 31) || !jaar) return null;
  const opties = [startIsoJaar(jaar), `${jaar}-01-01`];
  for (const start of opties) {
    const dagen = nrs.map((_, i) => addDays(start, i));
    if (dagen.every((d, i) => Number(d.slice(8, 10)) === nrs[i])) return dagen;
  }
  return null;
}

export function leesJaarrooster(bladen: { sheet: string; data: Cel[][] }[], bestandsnaam: string): JaarBlad[] {
  const jaar = jaarUitNaam(bestandsnaam);
  const uit: JaarBlad[] = [];
  for (const { sheet, data } of bladen) {
    let r0 = -1, c0 = -1;
    for (let r = 0; r < Math.min(data.length, 60) && r0 < 0; r++) {
      const rij = data[r] ?? [];
      for (let c = 0; c < Math.min(rij.length, 10); c++) {
        if (klein(rij[c]) === 'mw' && /^contract/.test(klein(rij[c + 1]))) { r0 = r; c0 = c; break; }
      }
    }
    if (r0 < 0) continue;
    let dagen: string[] | null = null;
    for (let r = r0 - 1; r >= Math.max(0, r0 - 4) && !dagen; r--) {
      const rij = data[r] ?? [];
      if (klein(rij[c0 + 1]) === 'datum' || klein(rij[c0]) === 'datum') dagen = leesDagen(rij.slice(c0 + 2), jaar);
    }
    if (!dagen) continue;
    const rijen: JaarRij[] = [];
    let overgeslagen = 0, nr = 0;
    for (let r = r0 + 1; r < data.length; r++) {
      const rij = data[r] ?? [];
      // het eind van de medewerkers; de naamkolom wordt alleen hiervoor bekeken, nooit bewaard
      if (/^regelplekken/.test(klein(rij[c0]))) break;
      const k = rij[c0 + 1];
      const contract = typeof k === 'number' ? k : Number(tekst(k).replace(',', '.'));
      const codes = dagen.map((_, i) => codeVan(rij[c0 + 2 + i]));
      if (!codes.some(Boolean)) continue;
      if (!Number.isFinite(contract) || contract < 4 || contract > 40) { overgeslagen++; continue; }
      rijen.push({ nr: ++nr, contract: Math.round(contract * 2) / 2, codes });
    }
    if (!rijen.length) continue;
    const { regio, variant } = regioUitBlad(sheet);
    uit.push({ blad: sheet, regio, variant, dagen, rijen, overgeslagen });
  }
  return uit;
}

export function codesTellen(bladen: JaarBlad[]): Map<string, number> {
  const n = new Map<string, number>();
  for (const b of bladen) for (const r of b.rijen) for (const c of r.codes) if (c) n.set(c, (n.get(c) ?? 0) + 1);
  return new Map([...n.entries()].sort((a, b) => b[1] - a[1]));
}

/** Patronen schuiven wel eens: daarom telt hoe vaak iemand werkt, en de groep is die met de meeste gewerkte weekenden. */
export function weekendCadansUit(dagen: string[], diensten: DienstCode[]): { cadans: number; groep: number } {
  const gewerkt = new Set<number>(), alle = new Set<number>(), weg = new Set<number>();
  dagen.forEach((d, i) => {
    const n = toDay(d), wd = weekday(n);
    if (wd !== 0 && wd !== 6) return;
    const w = weekIndex(n), c = diensten[i];
    alle.add(w);
    if (c === 'V' || c === 'Z') weg.add(w);
    else if (c && c !== '-') gewerkt.add(w);
  });
  const weken = [...alle].filter((w) => !weg.has(w) || gewerkt.has(w));
  const n = [...gewerkt].length;
  if (!n || !weken.length) return { cadans: 2, groep: 0 };
  const cadans = Math.max(1, Math.min(4, Math.round(weken.length / n)));
  let groep = 0, max = -1;
  for (let g = 0; g < cadans; g++) {
    const raak = [...gewerkt].filter((w) => ((w % cadans) + cadans) % cadans === g).length;
    if (raak > max) { max = raak; groep = g; }
  }
  return { cadans, groep };
}

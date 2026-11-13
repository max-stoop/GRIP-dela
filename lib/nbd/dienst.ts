/** De pauze zit in de dienst maar telt niet als werktijd; een taak wel. In beide zit iemand niet aan de telefoon. */
import type { Taak, TaakSoort, Tijd } from '../rooster/types';
import { uurTekst } from '../rooster/tijden';
import type { NbdParameters, Uur } from './parameters';

export interface NbdDienst {
  start: Uur;
  eind: Uur;
  /** Minuten. */
  pauze: number;
  /** Ontbreekt = midden in de dienst. */
  pauzeStart?: Uur;
  taken?: Taak[];
}

type Dagdeel = 'ochtend' | 'middag' | 'avond';

export const DAGDEEL_LABEL: Record<Dagdeel, string> = { ochtend: 'Ochtend', middag: 'Middag', avond: 'Avond' };

const GRENZEN: [Dagdeel, Uur, Uur][] = [['ochtend', 0, 12], ['middag', 12, 17], ['avond', 17, 24]];

export const kwartier = (u: number) => Math.round(u * 4) / 4;

export function bruto(d: Pick<NbdDienst, 'start' | 'eind'>): number {
  return d.eind - d.start;
}

export function netto(d: NbdDienst): number {
  return bruto(d) - d.pauze / 60;
}

/** ATW: meer dan 5,5 uur werk 30 minuten, meer dan 10 uur 45 minuten. */
export function pauzeNodig(p: Pick<NbdParameters, 'pauzeNa' | 'pauzeMinuten'>, werktijd: number): number {
  if (werktijd > 10 + 1e-9) return Math.max(45, p.pauzeMinuten);
  return werktijd > p.pauzeNa + 1e-9 ? p.pauzeMinuten : 0;
}

/** Het opgegeven moment, anders zo veel mogelijk in het midden. */
export function pauzeBegin(d: NbdDienst): Uur | null {
  if (!d.pauze) return null;
  if (d.pauzeStart != null) return d.pauzeStart;
  return kwartier(d.start + (bruto(d) - d.pauze / 60) / 2);
}

/** De pauze komt er bovenop. */
export function maakDienst(p: Pick<NbdParameters, 'pauzeNa' | 'pauzeMinuten'>, start: Uur, werktijd: number, pauzeStart?: Uur): NbdDienst {
  const pauze = pauzeNodig(p, werktijd);
  const d: NbdDienst = { start: kwartier(start), eind: kwartier(start + werktijd + pauze / 60), pauze };
  if (pauze && pauzeStart != null) d.pauzeStart = kwartier(pauzeStart);
  return d;
}

function taakOp(d: Pick<NbdDienst, 'taken'>, t: Uur): Taak | null {
  return d.taken?.find((k) => t >= k.van - 1e-9 && t < k.tot - 1e-9) ?? null;
}

function inPauze(d: NbdDienst, t: Uur): boolean {
  const pb = pauzeBegin(d);
  return pb != null && t >= pb - 1e-9 && t < pb + d.pauze / 60 - 1e-9;
}

/** Niet in de pauze en niet in een taak. */
export function aanTelefoon(d: NbdDienst, t: Uur): boolean {
  if (t < d.start - 1e-9 || t >= d.eind - 1e-9) return false;
  return !inPauze(d, t) && !taakOp(d, t);
}

export function dagdeel(d: Pick<NbdDienst, 'start' | 'eind'>): Dagdeel {
  let beste: Dagdeel = 'ochtend', max = -1;
  for (const [naam, van, tot] of GRENZEN) {
    const overlap = Math.max(0, Math.min(d.eind, tot) - Math.max(d.start, van));
    if (overlap > max + 1e-9) { max = overlap; beste = naam; }
  }
  return beste;
}

export function dienstTekst(d: Pick<NbdDienst, 'start' | 'eind'>): string {
  return `${uurTekst(d.start)}–${uurTekst(d.eind)}`;
}

export function pauzeTekst(d: NbdDienst): string {
  const pb = pauzeBegin(d);
  return pb == null ? 'geen pauze' : `pauze ${uurTekst(pb)}–${uurTekst(pb + d.pauze / 60)}`;
}

export function uitTijd(t: Tijd | undefined | null): NbdDienst | null {
  if (!t || !(t.eind > t.start)) return null;
  const d: NbdDienst = { start: t.start, eind: t.eind, pauze: t.pauze ?? 0 };
  if (t.pauzeStart != null) d.pauzeStart = t.pauzeStart;
  if (t.taken?.length) d.taken = t.taken.map((k) => ({ ...k }));
  return d;
}

export function naarTijd(d: NbdDienst): Tijd {
  // zonder pauze geen pauzevelden en zonder taken geen lijst: zo is de vorm gelijk aan wat de database teruggeeft
  const t: Tijd = { start: d.start, eind: d.eind, code: 'N' };
  if (d.pauze) {
    t.pauze = d.pauze;
    if (d.pauzeStart != null) t.pauzeStart = d.pauzeStart;
  }
  if (d.taken?.length) t.taken = [...d.taken].sort((a, b) => a.van - b.van).map((k) => ({ ...k }));
  return t;
}

/** Bij een ruil of een nieuwe indeling horen de taken bij de vorige medewerker. */
export function zonderTaken(d: NbdDienst): NbdDienst {
  const { taken: _weg, ...rest } = d;
  return rest;
}

const EPS = 1e-9;

export const TAAK_LABEL: Record<TaakSoort, string> = { training: 'Training', klachten: 'Klachten', maandstart: 'Maandstart' };
export const TAAK_KORT: Record<TaakSoort, string> = { training: 'T', klachten: 'K', maandstart: 'M' };
export { TAAK_SOORTEN } from '../rooster/types';

export const taakUren = (k: Taak) => k.tot - k.van;
export const taakTekst = (k: Taak) => `${TAAK_LABEL[k.soort]} ${uurTekst(k.van)}–${uurTekst(k.tot)}`;

export function pastTaak(d: NbdDienst, k: Taak, behalve?: Taak): boolean {
  if (!(k.tot > k.van + EPS) || k.van < d.start - EPS || k.tot > d.eind + EPS) return false;
  for (let t = k.van; t < k.tot - EPS; t += 0.25) if (inPauze(d, t)) return false;
  return !(d.taken ?? []).some((x) => x !== behalve && k.van < x.tot - EPS && k.tot > x.van + EPS);
}

/** In gewone taal; leeg = goed. */
export function takenMeldingen(d: NbdDienst): string[] {
  const uit = new Set<string>();
  for (const k of d.taken ?? []) {
    if (!(k.tot > k.van + EPS)) uit.add(`${TAAK_LABEL[k.soort]}: het eind moet na het begin liggen.`);
    else if (k.van < d.start - EPS || k.tot > d.eind + EPS) uit.add(`${taakTekst(k)} valt buiten de dienst.`);
    else if (!pastTaak(d, k, k)) uit.add(`${taakTekst(k)} valt in de pauze of over een andere taak.`);
  }
  return [...uit];
}

/** Zo dicht mogelijk bij het midden, niet in het eerste of laatste uur; null als dat niet kan. */
export function pauzeBuitenTaken(x: NbdDienst): NbdDienst | null {
  if (!x.pauze) return x;
  const duur = x.pauze / 60, midden = x.start + (x.eind - x.start - duur) / 2;
  const opties: number[] = [];
  for (let t = x.start + 1; t + duur <= x.eind - 1 + EPS; t += 0.25) opties.push(Math.round(t * 4) / 4);
  opties.sort((a, b) => Math.abs(a - midden) - Math.abs(b - midden));
  for (const t of opties) {
    const y: NbdDienst = { ...x, pauzeStart: t };
    if ((y.taken ?? []).every((k) => pastTaak({ ...y, taken: (y.taken ?? []).filter((z) => z !== k) }, k))) return y;
  }
  return null;
}


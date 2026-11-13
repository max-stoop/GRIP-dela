/** Een maand is 'JJJJ-MM'. */
import { addDays, fmtD, isoRange, MAAND_LANG } from '../dates';

export type Maand = string;

export function maandVan(datum: string): Maand {
  return datum.slice(0, 7);
}

export function maandStart(m: Maand): string {
  return `${m}-01`;
}

export function maandEind(m: Maand): string {
  return addDays(maandStart(volgendeMaand(m)), -1);
}

export function maandDagen(m: Maand): string[] {
  return isoRange(maandStart(m), maandEind(m));
}

/** Negatief: eerder. */
export function volgendeMaand(m: Maand, n = 1): Maand {
  const [j, mm] = m.split('-').map(Number);
  const t = j * 12 + (mm - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** Datums of maanden. */
export function maandenTussen(van: string, tot: string): Maand[] {
  const uit: Maand[] = [];
  for (let m = maandVan(van), eind = maandVan(tot); m <= eind; m = volgendeMaand(m)) uit.push(m);
  return uit;
}

/** Het rooster van een maand staat maanden vóór die maand online: op 6 oktober met 2 maanden t/m 31 december. */
export function publicatieVereistTot(vandaag: string, maanden: number): string {
  return maandEind(volgendeMaand(maandVan(vandaag), maanden));
}

export function maandNaam(m: Maand, metJaar = true): string {
  const [j, mm] = m.split('-').map(Number);
  return metJaar ? `${MAAND_LANG[mm - 1]} ${j}` : MAAND_LANG[mm - 1];
}

export function isMaand(s: string | null | undefined): s is Maand {
  return !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/** Precies één kalendermaand heet naar die maand, anders de datums. */
export function periodeNaam(p: { van: string; tot: string }): string {
  const m = maandVan(p.van);
  return p.van === maandStart(m) && p.tot === maandEind(m) ? maandNaam(m) : `${fmtD(p.van)} t/m ${fmtD(p.tot)}`;
}

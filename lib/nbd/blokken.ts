/** Werkblokken op een doorlopende tijdlijn (uren sinds 1970), voor de rusttijden van de ATW. */
import { DIENSTEN } from '../rooster/diensten';
import type { Cellen, DienstCode, Tijden } from '../rooster/types';
import { mondayOf, toDay } from '../dates';
import { netto, uitTijd, type NbdDienst } from './dienst';
import type { NbdParameters } from './parameters';

export interface Blok {
  datum: string;
  /** Begin en eind in uren sinds 1970. */
  van: number;
  tot: number;
  /** Zonder pauze. */
  werk: number;
  code: DienstCode;
}

export const absoluut = (datum: string, uur: number) => toDay(datum) * 24 + uur;

/** Een NBD-dienst met tijden, of een overige dienst met de standaardtijden. */
export function blokOp(code: DienstCode, datum: string, dienst: NbdDienst | null): Blok | null {
  if (code === 'N') {
    if (!dienst) return null;
    return { datum, van: absoluut(datum, dienst.start), tot: absoluut(datum, dienst.eind), werk: netto(dienst), code };
  }
  const d = DIENSTEN[code];
  if (!d?.werk || d.start == null || d.eind == null) return null;
  return { datum, van: absoluut(datum, d.start), tot: absoluut(datum, d.eind), werk: d.uren, code };
}

/** null als er geen dienst N met tijden staat. */
export function nbdDienst(cellen: Cellen, tijden: Tijden | undefined, mid: string, datum: string): NbdDienst | null {
  if (cellen[mid]?.[datum] !== 'N') return null;
  const t = tijden?.[mid]?.[datum];
  return t && (t.code == null || t.code === 'N') ? uitTijd(t) : null;
}

export function blokkenVan(cellen: Cellen, tijden: Tijden | undefined, mid: string): Blok[] {
  const uit: Blok[] = [];
  for (const [datum, code] of Object.entries(cellen[mid] ?? {})) {
    const b = blokOp(code, datum, nbdDienst(cellen, tijden, mid, datum));
    if (b) uit.push(b);
  }
  return uit.sort((a, b) => a.van - b.van);
}

export const weekVan = (datum: string) => mondayOf(toDay(datum));

/** ATW: minstens één rust van weekRust uur, of in twee weken samen 72 uur in delen van minstens 32. True als er die week niet gewerkt wordt. */
export function weekrustOk(blokken: Blok[], maandag: number, p: Pick<NbdParameters, 'weekRust'>): boolean {
  const w0 = maandag * 24, w1 = w0 + 7 * 24;
  const inWeek = blokken.filter((b) => b.tot > w0 && b.van < w1);
  if (!inWeek.length) return true;
  const gaten = (van: number, tot: number) => {
    const g: number[] = [];
    // het gat vóór het eerste blok en na het laatste blok, tot ver buiten de periode (onbekend = vrij)
    const rel = blokken.filter((b) => b.tot > van - 14 * 24 && b.van < tot + 14 * 24);
    let vorig = -Infinity;
    for (const b of rel) {
      const gStart = vorig, gEind = b.van;
      if (gEind > van && gStart < tot) g.push(gEind - gStart);
      vorig = Math.max(vorig, b.tot);
    }
    if (vorig < tot) g.push(Infinity);
    return g;
  };
  const deze = gaten(w0, w1);
  if (deze.some((g) => g >= p.weekRust - 1e-9)) return true;
  const twee = gaten(w0 - 7 * 24, w1).filter((g) => g >= 32 - 1e-9);
  return twee.reduce((a, g) => a + g, 0) >= 72 - 1e-9;
}

export function werkInWeek(blokken: Blok[], maandag: number): number {
  return blokken.filter((b) => toDay(b.datum) >= maandag && toDay(b.datum) < maandag + 7).reduce((a, b) => a + b.werk, 0);
}

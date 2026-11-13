/** De ATW vraagt begin- en eindtijden 4 dagen vooraf (§ 1.2); bij Dg-diensten worden ze later vastgelegd. */
import { addDays, diffDays } from '../dates';
import { DIENSTEN } from './diensten';
import { cel, tijdVan } from './toets';
import type { Beleid, Cellen, DienstCode, Medewerker, Tijd, Tijden } from './types';

interface OpenTijd {
  medewerkerId: string;
  datum: string;
  code: DienstCode;
  uiterlijk: string;
  /** Al binnen de termijn. */
  teLaat: boolean;
}

/** Binnen vooruit dagen na de termijn (standaard een week). */
export function openTijden(team: Medewerker[], cellen: Cellen, tijden: Tijden | undefined, vandaag: string, beleid: Beleid, vooruit = 7): OpenTijd[] {
  const out: OpenTijd[] = [];
  const tot = addDays(vandaag, beleid.tijdenDagen + vooruit);
  for (const e of team) {
    if (!e.actief) continue;
    for (const [d, code] of Object.entries(cellen[e.id] ?? {})) {
      if (d < vandaag || d > tot) continue;
      const def = DIENSTEN[code];
      if (!def.werk || def.tijdenVast) continue;
      const t = tijden?.[e.id]?.[d];
      if (t && (!t.code || t.code === code)) continue;
      out.push({ medewerkerId: e.id, datum: d, code, uiterlijk: addDays(d, -beleid.tijdenDagen), teLaat: diffDays(d, vandaag) < beleid.tijdenDagen });
    }
  }
  return out.sort((a, b) => a.datum.localeCompare(b.datum));
}

/** Niet langer dan de ATW toestaat, en genoeg rust rond de dag ervoor en erna. */
export function tijdBevindingen(cellen: Cellen, tijden: Tijden | undefined, medewerkerId: string, datum: string, tijd: Tijd, beleid: Beleid): string[] {
  const out: string[] = [];
  if (!(tijd.eind > tijd.start)) out.push('De eindtijd moet na de begintijd liggen.');
  if (tijd.eind - tijd.start > beleid.maxDagUren) out.push(`Een dienst duurt maximaal ${beleid.maxDagUren} uur (ATW).`);
  if (tijd.start < 7 || tijd.eind > 22.5) out.push('Tussen 7:00 en 22:30 blijven (dagdienst).');
  const gister = addDays(datum, -1), morgen = addDays(datum, 1);
  const tg = DIENSTEN[cel(cellen, medewerkerId, gister)].werk ? tijdVan(cel(cellen, medewerkerId, gister), tijden?.[medewerkerId]?.[gister]) : null;
  const tm = DIENSTEN[cel(cellen, medewerkerId, morgen)].werk ? tijdVan(cel(cellen, medewerkerId, morgen), tijden?.[medewerkerId]?.[morgen]) : null;
  if (tg && 24 - tg.eind + tijd.start < beleid.minRustUren) out.push(`Minder dan ${beleid.minRustUren} uur rust na de dienst van gisteren (ATW).`);
  if (tm && 24 - tijd.eind + tm.start < beleid.minRustUren) out.push(`Minder dan ${beleid.minRustUren} uur rust voor de dienst van morgen (ATW).`);
  return out;
}

/** "9:30" uit 9.5 en omgekeerd. */
export function uurTekst(u: number): string {
  const h = Math.floor(u), m = Math.round((u - h) * 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function leesUur(x: string): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(x.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2] ?? 0);
  if (h > 24 || min > 59) return null;
  return h + min / 60;
}

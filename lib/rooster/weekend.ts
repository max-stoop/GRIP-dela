/**
 * Weekendgroepen in gewone woorden. GRIP rekent met doorlopende weken, zodat "om het weekend" ook rond de
 * jaarwisseling klopt. Na een jaar met week 53 (zoals 2026) wisselen even en oneven daardoor van groep; per jaar
 * zeggen we dus welke groep de even weken werkt.
 */
import { fmtD, fromDay, isoWeek, mondayOf, toDay, weekday, weekIndex, year } from '../dates';
import { weekendCadans, werktWeekend, type Medewerker } from './types';

type Groep = Pick<Medewerker, 'weekendCadans' | 'weekendgroep'>;
export type Pariteit = 'even' | 'oneven';

/** Het ISO-jaar van een datum: het jaar van de donderdag in die week. */
export function isoJaar(datum: string): number {
  return year(mondayOf(toDay(datum)) + 3);
}

export function heeftWeek53(jaar: number): boolean {
  return isoWeek(toDay(`${jaar}-12-28`)) === 53;
}

/** Binnen één ISO-jaar lopen het weeknummer en de doorlopende week gelijk op: één zaterdag zegt genoeg. */
function zaterdagIn(jaar: number): number {
  const n = toDay(`${jaar}-07-01`);
  return n + ((6 - weekday(n) + 7) % 7);
}

/** Om het weekend: werkt de groep in dat ISO-jaar de even of de oneven weken? Bij een andere cadans null. */
export function pariteitIn(m: Groep, jaar: number): Pariteit | null {
  if (weekendCadans(m) !== 2) return null;
  const za = zaterdagIn(jaar);
  return werktWeekend(m, weekIndex(za)) === (isoWeek(za) % 2 === 0) ? 'even' : 'oneven';
}

/** De groep (0 of 1) die om het weekend in dat ISO-jaar de even of de oneven weken werkt. */
export function groepVoorPariteit(p: Pariteit, jaar: number): number {
  return pariteitIn({ weekendCadans: 2, weekendgroep: 0 }, jaar) === p ? 0 : 1;
}

/** De eerstvolgende zaterdag (vanaf een datum) waarop de groep werkt. */
export function eersteWeekend(m: Groep, vanaf: string): string {
  let n = toDay(vanaf);
  n += (6 - weekday(n) + 7) % 7;
  for (let i = 0; i < weekendCadans(m) && !werktWeekend(m, weekIndex(n)); i++) n += 7;
  return fromDay(n);
}

/** "even weekenden" (in het jaar van de datum), "1 op 3 weekenden (B)" of "elk weekend". */
export function weekendNaam(m: Groep, datum: string): string {
  const c = weekendCadans(m);
  if (c === 1) return 'elk weekend';
  if (c === 2) return `${pariteitIn(m, isoJaar(datum))} weekenden`;
  return `1 op ${c} weekenden (${'ABCD'[((m.weekendgroep % c) + c) % c]})`;
}

/** Voor een keuzelijst: elke groep met wanneer die werkt. */
export function groepOpties(cadans: number, vandaag: string): { groep: number; naam: string }[] {
  const jaar = isoJaar(vandaag);
  return Array.from({ length: cadans }, (_, g) => {
    const m = { weekendCadans: cadans, weekendgroep: g };
    const za = eersteWeekend(m, vandaag);
    const eerst = `eerst ${fmtD(za)} (week ${isoWeek(toDay(za))})`;
    if (cadans !== 2) return { groep: g, naam: `Groep ${'ABCD'[g]} · ${eerst}` };
    const nu = pariteitIn(m, jaar)!, straks = pariteitIn(m, jaar + 1)!;
    const p = nu === 'even' ? 'Even weken' : 'Oneven weken';
    return { groep: g, naam: straks !== nu ? `${p} (in ${jaar + 1} ${straks}) · ${eerst}` : `${p} · ${eerst}` };
  });
}

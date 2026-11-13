/**
 * Wensen per datum als team: de vaste voorkeuren van de week overnemen in één week, en tellen wat de collega's in de
 * regio voor een dag hebben opgegeven. Zo ziet iedereen waar het knelt en kan het team onderling schuiven.
 */
import { weekday, toDay } from '../dates';
import { dagPatroon } from '../nbd/voorkeuren';
import { wensUitPatroon, type Voorkeurprofiel, type Wens, type WensSoort } from './types';

/** Zoveel collega's met een wens op één dag. */
export interface WensTelling { werken: number; vrij: number; neutraal: number; overig: number }

export const GEEN_TELLING: WensTelling = { werken: 0, vrij: 0, neutraal: 0, overig: 0 };

/** Een dagdeel (ochtend, middag, avond) is ook: wil die dag werken. Een overige dienst is ander werk: niet beschikbaar voor het rooster. */
export function wensGroep(soort: WensSoort): keyof WensTelling {
  return soort === 'vrij' ? 'vrij' : soort === 'neutraal' ? 'neutraal' : soort === 'overig8' || soort === 'overig4' ? 'overig' : 'werken';
}

/** Per datum het aantal wensen van deze medewerkers (de collega's, zonder de medewerker zelf). */
export function telWensen(wensen: Wens[], wie: ReadonlySet<string>, vanaf = ''): Record<string, WensTelling> {
  const uit: Record<string, WensTelling> = {};
  for (const w of wensen) {
    if (!wie.has(w.medewerkerId) || w.datum < vanaf) continue;
    (uit[w.datum] ??= { ...GEEN_TELLING })[wensGroep(w.soort)]++;
  }
  return uit;
}

/** De vaste voorkeur als wens voor één datum; bij de NBD uit de voorkeuren per uur als die er zijn. */
export function standaardWens(profiel: Voorkeurprofiel | undefined, datum: string): WensSoort {
  const uren = dagPatroon(profiel?.uren, datum);
  if (uren != null) return /^n+$/.test(uren) ? 'vrij' : uren.includes('g') ? 'werken' : 'neutraal';
  return wensUitPatroon(profiel?.dagen[weekday(toDay(datum))]);
}

/**
 * Wat "Standaard overnemen" in deze dagen zet: op elke dag zonder wens de vaste voorkeur van die weekdag. Een dag
 * waar al een wens staat, of die is overgeslagen (voorbij, verlof), blijft zoals hij is.
 */
export function standaardWensen(profiel: Voorkeurprofiel | undefined, dagen: string[], overslaan: ReadonlySet<string>): { datum: string; soort: WensSoort }[] {
  return dagen.filter((d) => !overslaan.has(d)).map((d) => ({ datum: d, soort: standaardWens(profiel, d) }));
}

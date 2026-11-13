import { uitNederlandseTijd } from '../dates';
import type { Dagtaak } from '../store/types';

const minutenTussen = (a: string, b: string) => (uitNederlandseTijd(b).getTime() - uitNederlandseTijd(a).getTime()) / 60_000;

/** Zoveel minuten na een poging waarbij een bron niet bereikbaar was, mag het opnieuw. */
export const OPNIEUW_NA_MINUTEN = 50;

/** Waarom de dagelijkse voorspelling nu niet hoeft te draaien, of null als hij moet. Ook in de browser te gebruiken. */
export function dagtaakOverslaan(d: Dagtaak | null, vandaag: string, nu: string, looptijd = 20): string | null {
  if (d?.datum === vandaag && d.status === 'geslaagd') return 'Vandaag al geslaagd';
  if (d?.datum === vandaag && d.status === 'beperkt') {
    // een bron was niet bereikbaar: na een tijdje opnieuw; alleen verouderde gegevens: vandaag niet nog eens
    if (d.opnieuwNa && uitNederlandseTijd(nu).getTime() >= Date.parse(d.opnieuwNa)) return null;
    return d.opnieuwNa ? 'Vandaag al gedaan; een bron was niet bereikbaar, straks nog een poging' : 'Vandaag al gedaan, met verouderde of ontbrekende bronnen';
  }
  if (d?.status === 'gestart' && minutenTussen(d.gestart, nu) < looptijd) return 'Loopt al';
  return null;
}

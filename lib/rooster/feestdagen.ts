/** Feestdagen per medewerker: gewerkt (of ingeroosterd), verlof, vrij, of nog geen rooster. */
import { DIENSTEN } from './diensten';
import type { Cellen, Medewerker } from './types';
import type { Verlof } from '../store/types';

export type FeestdagStand = { soort: 'gewerkt'; code: string } | { soort: 'verlof' } | { soort: 'vrij' } | { soort: 'leeg' };

export function feestdagStand(m: Pick<Medewerker, 'id'>, cellen: Cellen, verlof: Verlof[], datum: string): FeestdagStand {
  const c = cellen[m.id]?.[datum];
  if (c && DIENSTEN[c].werk) return { soort: 'gewerkt', code: c };
  if (c === 'V' || verlof.some((v) => v.medewerkerId === m.id && v.status === 'goedgekeurd' && v.van <= datum && v.tot >= datum)) return { soort: 'verlof' };
  return c ? { soort: 'vrij' } : { soort: 'leeg' };
}

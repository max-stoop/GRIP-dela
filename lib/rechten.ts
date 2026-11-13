/**
 * Wie mag wat (roosterbeleid § 5.1). De planner geeft bij elk rooster een advies; de regiomanager keurt goed en besluit
 * over verlof (zo ingesteld ook de planner). De beheerder kan alles, ook als achtervang. De RLS volgt dezelfde verdeling.
 */
import type { Rol } from './store/types';
import type { Beleid } from './rooster/types';

export type Recht =
  | 'rooster.maken'
  | 'rooster.advies'
  | 'rooster.goedkeuren'
  | 'rooster.publiceren'
  | 'verlof.invoeren'
  | 'verlof.besluiten'
  | 'ruil.besluiten'
  | 'bijsturen'
  | 'beheer';

export const RECHT_LABEL: Record<Recht, string> = {
  'rooster.maken': 'Rooster maken, wijzigen en toetsen',
  'rooster.advies': 'Advies geven (groen, oranje of rood) en het rooster ter goedkeuring aanbieden',
  'rooster.goedkeuren': 'Rooster goedkeuren of afkeuren',
  'rooster.publiceren': 'Goedgekeurd rooster publiceren',
  'verlof.invoeren': 'Verlof invoeren namens een medewerker (als aanvraag)',
  'verlof.besluiten': 'Verlof goedkeuren, afwijzen of intrekken, en besluiten in de vakantieronde',
  'ruil.besluiten': 'Ruilen goedkeuren',
  bijsturen: 'Bijsturen en ziekmeldingen',
  beheer: 'Normen, beleid, bronnen, schoolvakanties en back-up',
};

export const RECHT_BRON: Partial<Record<Recht, string>> = {
  'rooster.maken': '5.1',
  'rooster.advies': '5.1',
  'rooster.goedkeuren': '5.1',
  'verlof.besluiten': '4.1',
};

export const RECHTEN: Record<Rol, Recht[]> = {
  beheerder: ['rooster.maken', 'rooster.advies', 'rooster.goedkeuren', 'rooster.publiceren', 'verlof.invoeren', 'verlof.besluiten', 'ruil.besluiten', 'bijsturen', 'beheer'],
  regiomanager: ['rooster.maken', 'rooster.goedkeuren', 'rooster.publiceren', 'verlof.invoeren', 'verlof.besluiten', 'ruil.besluiten', 'bijsturen'],
  planner: ['rooster.maken', 'rooster.advies', 'rooster.publiceren', 'verlof.invoeren', 'ruil.besluiten', 'bijsturen'],
  medewerker: [],
};

/** Met het beleid erbij telt ook of de planner over verlof besluit. */
export function mag(rol: Rol, recht: Recht, beleid?: Pick<Beleid, 'plannerBesluitVerlof'>): boolean {
  return RECHTEN[rol].includes(recht) || (recht === 'verlof.besluiten' && rol === 'planner' && !!beleid?.plannerBesluitVerlof);
}

/** Wie over verlof besluit, voor in een zin: "de regiomanager", of zo ingesteld "de regiomanager of de planner". */
export function verlofBesluiter(beleid?: Pick<Beleid, 'plannerBesluitVerlof'>): string {
  return beleid?.plannerBesluitVerlof ? 'de regiomanager of de planner' : 'de regiomanager';
}

/** Rooster, bijsturen, team, verlof van het team. */
export function plant(rol: Rol): boolean {
  return rol !== 'medewerker';
}

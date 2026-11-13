/** Het advies van de planner (§ 5.1): GRIP stelt een kleur voor uit de toets; de planner kiest en licht oranje en rood toe. */
import { tekortStand, type Toets } from './toets';

export type AdviesKleur = 'groen' | 'oranje' | 'rood';

export const ADVIES: Record<AdviesKleur, { naam: string; kort: string; uitleg: string }> = {
  groen: {
    naam: 'Groen',
    kort: 'Goedkeuren',
    uitleg: 'Het rooster voldoet aan ATW, CAO en het roosterbeleid en dekt de afgesproken regelplekken. Goedkeuren zonder voorbehoud.',
  },
  oranje: {
    naam: 'Oranje',
    kort: 'Goedkeuren met aandachtspunten',
    uitleg: 'Het rooster kan door, maar de regiomanager moet ergens van weten: een krappe dag, een afwijking van het beleid of wensen die niet passen. De planner licht dat toe.',
  },
  rood: {
    naam: 'Rood',
    kort: 'Niet goedkeuren',
    uitleg: 'Het rooster is zo niet verantwoord: er zijn tekorten of risico’s die de planner binnen het team niet kan oplossen. De regiomanager moet ingrijpen, bijvoorbeeld met externen, verlof of formatie.',
  },
};

export const MIN_TOELICHTING = 10;

export interface Advies {
  kleur: AdviesKleur;
  toelichting?: string;
  /** Zodat zichtbaar is als de planner ervan afwijkt. */
  voorstel?: AdviesKleur;
  door: string;
  op: string;
}

export interface AdviesVoorstel {
  kleur: AdviesKleur;
  redenen: string[];
}

/**
 * Dagen voor vanaf tellen niet. Rood bij ATW of CAO, 2 of meer plekken tekort op een dag, 3 of meer dagen met tekort of
 * een cijfer onder de 6; oranje bij een of twee dagen tekort, punten uit beleid of teamafspraken, of onder de 7,5.
 */
export function adviesVoorstel(t: Pick<Toets, 'hard' | 'checks' | 'cijfer' | 'perDag'>, vanaf?: string): AdviesVoorstel {
  const rood: string[] = [], oranje: string[] = [];
  if (t.hard > 0) rood.push(`${t.hard} ${t.hard === 1 ? 'overtreding' : 'overtredingen'} van ATW of CAO`);
  const { tekort, groot } = tekortStand(t.perDag, vanaf);
  if (groot.length) rood.push(`${groot.length === 1 ? '1 dag' : `${groot.length} dagen`} met 2 of meer regelplekken te weinig`);
  else if (tekort.length >= 3) rood.push(`${tekort.length} dagen met minder regelplekken dan afgesproken`);
  else if (tekort.length) oranje.push(`${tekort.length === 1 ? '1 dag' : `${tekort.length} dagen`} met een regelplek te weinig`);
  if (t.cijfer < 6) rood.push(`cijfer ${String(t.cijfer).replace('.', ',')}`);
  else if (t.cijfer < 7.5) oranje.push(`cijfer ${String(t.cijfer).replace('.', ',')}`);
  const beleid = t.checks.filter((c) => c.niveau !== 'ATW en CAO' && c.id !== 'tekort' && c.items.length);
  if (beleid.length) oranje.push(`aandachtspunten: ${beleid.slice(0, 3).map((c) => c.naam.toLowerCase()).join('; ')}${beleid.length > 3 ? ` en ${beleid.length - 3} meer` : ''}`);
  if (rood.length) return { kleur: 'rood', redenen: [...rood, ...oranje] };
  if (oranje.length) return { kleur: 'oranje', redenen: oranje };
  return { kleur: 'groen', redenen: ['voldoet aan ATW, CAO en het beleid, en dekt de afgesproken plekken'] };
}

/** Een foutmelding, of null. */
export function adviesFout(kleur: AdviesKleur | null | undefined, toelichting: string | undefined): string | null {
  if (!kleur || !(kleur in ADVIES)) return 'Geef een advies: groen, oranje of rood';
  if (kleur !== 'groen' && (toelichting ?? '').trim().length < MIN_TOELICHTING) return `Licht een ${kleur} advies toe (minstens ${MIN_TOELICHTING} tekens)`;
  return null;
}

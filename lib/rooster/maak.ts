/**
 * Rooster maken: één voorstel. De roostermaker (voorstel.ts) kiest tussen gelijkwaardige kandidaten met een beetje
 * willekeur; hier draait hij een paar keer met een andere volgorde en wint het rooster dat het beste uit de toets
 * komt. "Andere verdeling" neemt de volgende reeks pogingen: een ander rooster dat net zo goed aan het beleid voldoet.
 */
import { fromDay, toDay, weekIndex, weekday } from '../dates';
import { DIENSTEN, afwezigVoorNorm } from './diensten';
import type { Behoefte, Beleid, Cellen, Medewerker } from './types';
import { pasToe } from './ruil';
import { toets, type Toets } from './toets';
import { voorstelMetUitleg, type Tekort, type VoorstelOpties, type Wijziging } from './voorstel';

/** Zoveel pogingen per voorstel. */
export const POGINGEN = 6;

export interface RoosterVoorstel {
  wijzigingen: Wijziging[];
  toets: Toets;
  /** Dagen waarop regelplekken leeg blijven, met de redenen. */
  tekorten: Tekort[];
  /** Diensten op dagen waarvoor verlof is aangevraagd (alleen als er niemand anders was). */
  opAanvraag: number;
  /** Uren boven het contract, per week opgeteld: alleen bij te weinig bezetting. */
  boven: number;
  zaadje: number;
}

export interface MaakOpties extends Omit<VoorstelOpties, 'seed'> {
  schoolvakantie?: (d: string) => boolean;
  /** 0 is het eerste voorstel; elke "andere verdeling" is één hoger. */
  ronde?: number;
  pogingen?: number;
}

/** Wat er in deze periode nodig is tegenover wat er is: eerst kijken, dan plannen. */
export interface WerkEnBezetting {
  /** Uren voor alle regelplekken en het minimum aan Dg-diensten. */
  nodig: number;
  /** Contracturen van het team in deze periode, min verlof en ziekte. */
  beschikbaar: number;
}

export function werkEnBezetting(o: { team: Medewerker[]; dates: string[]; cellen: Cellen; behoefte: Behoefte; beleid: Beleid }): WerkEnBezetting {
  let nodig = 0;
  for (const d of o.dates) {
    const k = o.behoefte[d]?.k ?? 0, b = Math.min(o.beleid.beschikbaarPerDag, k);
    // een regeldienst is 8 uur, de 1B telt voor 2; een Dg-dienst van 8 uur is twee voorgaansplekken
    nodig += (k - b) * DIENSTEN['1'].uren + b * DIENSTEN['1B'].uren;
    if (weekday(toDay(d)) !== 0) nodig += Math.max(o.beleid.minDG * DIENSTEN.DG2.uren, o.beleid.voorgangenPerDag * (DIENSTEN.DG2.uren / DIENSTEN.DG2.voorgangen));
  }
  let beschikbaar = 0;
  for (const m of o.team) {
    if (m.extern) continue;
    const weg = o.dates.filter((d) => afwezigVoorNorm(o.cellen[m.id]?.[d] ?? '-', weekday(toDay(d)) % 6 === 0)).length;
    beschikbaar += Math.max(0, (m.contract * o.dates.length) / 7 - (weg * m.contract) / 5);
  }
  return { nodig, beschikbaar };
}

/** Per medewerker per week de uren boven het contract, opgeteld. */
export function urenBovenContract(team: Medewerker[], dates: string[], cellen: Cellen): number {
  let boven = 0;
  for (const m of team) {
    if (m.extern) continue;
    const perWeek = new Map<number, number>();
    for (const d of dates) { const w = weekIndex(toDay(d)); perWeek.set(w, (perWeek.get(w) ?? 0) + DIENSTEN[cellen[m.id]?.[d] ?? '-'].uren); }
    for (const u of perWeek.values()) boven += Math.max(0, u - m.contract);
  }
  return boven;
}

/** Hoe vaak een medewerker zijn eigen melding kan voorgaan: na een 1, 1M of 2 werkt hij zoveel dagen later weer (regel of Dg). */
export function eigenMeldingVoorgaan(team: Medewerker[], dates: string[], cellen: Cellen, na: number): { kan: number; van: number } | null {
  if (na <= 0 || !dates.length) return null;
  const laatste = dates[dates.length - 1];
  const melding = (c: string | undefined) => c === '1' || c === '1M' || c === '2';
  let kan = 0, van = 0;
  for (const m of team) {
    if (m.extern) continue;
    for (const d of dates) {
      if (!melding(cellen[m.id]?.[d])) continue;
      const later = fromDay(toDay(d) + na);
      // de uitvaart is op een werkdag: valt de dag in het weekend of buiten de periode, dan telt hij niet mee
      if (later > laatste || weekday(toDay(later)) % 6 === 0) continue;
      van++;
      const c = cellen[m.id]?.[later];
      if (melding(c) || (c && DIENSTEN[c].categorie === 'dossier')) kan++;
    }
  }
  return van ? { kan, van } : null;
}

/** De Dg-diensten per dag: het kleinste en grootste aantal op werkdagen en op zaterdag, en het aantal dagen (ma-za) zonder. */
export function voorgangenPerDag(team: Medewerker[], dates: string[], cellen: Cellen): { min: number; max: number; zaterdag: { min: number; max: number } | null; zonder: number } | null {
  const tel = (d: string) => team.filter((m) => DIENSTEN[cellen[m.id]?.[d] ?? '-'].categorie === 'dossier').length;
  const werk = dates.filter((d) => weekday(toDay(d)) % 6 !== 0).map(tel), za = dates.filter((d) => weekday(toDay(d)) === 6).map(tel);
  if (!werk.length && !za.length) return null;
  return {
    min: werk.length ? Math.min(...werk) : 0, max: werk.length ? Math.max(...werk) : 0,
    zaterdag: za.length ? { min: Math.min(...za), max: Math.max(...za) } : null,
    zonder: [...werk, ...za].filter((x) => x === 0).length,
  };
}

/** Het kleinste en grootste aantal 1B's per uitvaartverzorger in deze periode. */
export function beschikbaarPerMedewerker(team: Medewerker[], dates: string[], cellen: Cellen): { min: number; max: number } | null {
  const n = team.filter((m) => !m.extern && (m.functie ?? 'UV') === 'UV').map((m) => dates.filter((d) => cellen[m.id]?.[d] === '1B').length);
  return n.length ? { min: Math.min(...n), max: Math.max(...n) } : null;
}

const som = (t: Tekort[]) => t.reduce((a, x) => a + x.tekort, 0);
const ergste = (t: Tekort[]) => t.reduce((a, x) => Math.max(a, x.tekort), 0);

/** Beter is: geen overtredingen, minder lege regelplekken (en die gespreid), dan het cijfer, dan de tevredenheid. */
function beter(a: RoosterVoorstel, b: RoosterVoorstel): boolean {
  const v = (x: RoosterVoorstel) => [x.toets.hard, som(x.tekorten), ergste(x.tekorten), x.opAanvraag, -x.toets.cijfer, -x.toets.sub.mw];
  const va = v(a), vb = v(b);
  for (let i = 0; i < va.length; i++) if (Math.abs(va[i] - vb[i]) > 1e-9) return va[i] < vb[i];
  return false;
}

export function maakRooster(o: MaakOpties): RoosterVoorstel {
  const { schoolvakantie, ronde = 0, pogingen = POGINGEN, ...opties } = o;
  let beste: RoosterVoorstel | null = null;
  for (let p = 0; p < Math.max(1, pogingen); p++) {
    const zaadje = 11 + ronde * pogingen + p;
    const v = voorstelMetUitleg({ ...opties, seed: zaadje });
    const na = pasToe(o.cellen, v.wijzigingen);
    const t = toets({ team: o.team, dates: o.dates, cellen: na, behoefte: o.behoefte, wensen: o.wensen, beleid: o.beleid, profielen: o.profielen, tijden: o.tijden, schoolvakantie });
    const opAanvraag = v.wijzigingen.filter(([mid, d, s]) => DIENSTEN[s].werk && (o.aanvragen ?? []).some((a) => a.medewerkerId === mid && a.van <= d && a.tot >= d)).length;
    const r: RoosterVoorstel = { wijzigingen: v.wijzigingen, toets: t, tekorten: v.tekorten, opAanvraag, boven: urenBovenContract(o.team, o.dates, na), zaadje };
    if (!beste || beter(r, beste)) beste = r;
  }
  return beste!;
}

/** Waar het voorstel rekening mee houdt, in de volgorde waarin het weegt. Voor het scherm en de handleiding. */
export const REKENT_MET: { kop: string; punten: string[] }[] = [
  {
    kop: 'Voorbereiding',
    punten: [
      'We plannen altijd het afgesproken aantal regelplekken: zoveel dat de regio op minstens 80% van de dagen alle meldingen zelf kan regelen. Nooit meer en nooit minder. Het gaat om plekken borgen, niet om plekken die daadwerkelijk vallen.',
      'Wat vaststaat, blijft staan: goedgekeurd verlof en ziekte, bij "lege vakjes aanvullen" ook alle bestaande diensten, en een overige dienst van 8 of 4 uur die een medewerker zelf opgaf. Diensten van de flexibele schil plant de planner zelf; ze tellen wel mee.',
      'Eerst uitrekenen hoeveel uur werk benodigd is: de uren voor alle regelplekken en het minimum aan Dg-diensten tegenover de contracturen van het team (verlof en ziekte eraf).',
    ],
  },
  {
    kop: 'Regels waar het rooster nooit van afwijkt',
    punten: [
      'De functie: een uitvaartleider doet geen regeldienst.',
      'Een weekdag die iemand niet kan, tenzij hij voor die datum zelf opgaf dat hij wil werken.',
      'Minimale rust tussen twee diensten en hoogstens zes diensten achter elkaar.',
      'Minstens 26 vrije weekenden per jaar (CAO) en hoogstens 3 regelplekken per weekend.',
      'Hoogstens 14 beschikbaarheidsdiensten (1B) per 28 dagen.',
      'Hoogstens twee keer een 2 per dag, met minstens twee enkele regeldiensten ernaast; wie de 2 niet kan, krijgt hem niet.',
      'Geen Dg-dienst op zondag, en per dag hoogstens het maximum aan voorgaansplekken.',
      'Over de periode hoogstens 15% boven contract (28 uur wordt hoogstens 32 uur).',
    ],
  },
  {
    kop: 'Alleen als er echt niemand anders is, in deze volgorde',
    punten: [
      'Inroosteren op een dag met de wens "liever vrij".',
      'Boven contract plannen, binnen de grens van 15%. Dat kan voor regelplekken en voor voorgaansplekken, ook voor de tweede Dg-plek van een dag.',
      'Inroosteren op een dag waarvoor verlof is aangevraagd dat nog niet is beoordeeld. Dat staat apart bij de uitkomst.',
      'Een weekenddienst buiten de eigen weekendbeurt. De weekendbeurt is een teamafspraak, geen wet.',
    ],
  },
  {
    kop: 'De volgorde van het plannen',
    punten: [
      'De regelplekken van de hele periode, de weekenden eerst. Laag voor laag: elke dag krijgt zijn eerste plek voordat een dag zijn tweede krijgt, zodat een tekort zich spreidt.',
      'Weekenden eerlijk over het jaar: wie dit jaar minder weekenden was ingeroosterd, gaat voor. Wie een weekend werkt, werkt bij voorkeur zaterdag en zondag.',
      'Elke dag een middagdienst (1M) en een beschikbaarheidsdienst (1B). In het weekend liever een 2; op werkdagen alleen als er anders een plek leeg blijft.',
      'De regelplekken staan er altijd: lukt het niet binnen de contracturen, dan boven contract tot de streefwaarde van 15%.',
      'Dan de voorgaansplekken (Dg-diensten): elke dag van maandag tot en met zaterdag minstens één, daarna tot het minimum per dag, en de rest zo gelijk mogelijk over de dagen tot het maximum per dag.',
      'Dan aanvullen tot de contracturen, telkens op de dag met de minste voorgaansplekken. Wat dan nog open staat wordt een korte Dg-dag van 4 uur. Is het maximum aan Dg-diensten op alle dagen gehaald, dan wordt er onder contract gepland.',
      'Zijn er meer mensen dan werk, dan krijgt iedereen ongeveer hetzelfde deel van zijn contract.',
    ],
  },
  {
    kop: 'Wie een dienst krijgt',
    punten: [
      'Wie het verst achterloopt op zijn uren: in die week, in de periode en uit de vier weken ervoor. We kijken naar wat er gepland is, niet naar wat er echt is gewerkt.',
      'Een eerlijk aandeel naar contract van regeldiensten, beschikbaarheidsdiensten en middagdiensten.',
      'De vaste voorkeur per weekdag en de wens per datum; een wens voor een datum gaat voor de vaste voorkeur.',
      'Meer voorkeuren is niet beter: wie meer dagen "graag" of "liever niet" opgeeft, verdeelt hetzelfde gewicht over meer dagen.',
      'Eigen melding voorgaan: zes dagen na een 1, 1M of 2 liefst weer een regeldienst of Dg-dienst, na een 2 liefst een DG2. Nooit op zaterdag of zondag.',
    ],
  },
  {
    kop: 'Tot slot',
    punten: [
      'Verbeteren zonder de dekking te raken: diensten op dezelfde dag gaan van de een naar de ander of worden geruild. Niemand komt daardoor verder onder zijn uren.',
      'Het voorstel wordt zes keer gemaakt; het rooster zonder overtredingen, met de minste lege plekken en het hoogste cijfer wint.',
      'Blijft er een regelplek leeg, dan staat erbij waarom.',
    ],
  },
];

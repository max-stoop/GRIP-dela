/**
 * Diensten volgens het roosterbeleid (§ 3.2-3.4). Een 1 telt 8 uur, een 2 10 uur, DG1 4, DG2 8 en een 1B gewogen 2 uur:
 * hij valt ongeveer 1 op de 4 keer, en dan is het een volle dienst.
 */
import type { DienstCode, Functie, WensSoort } from './types';

type Categorie = 'regel' | 'beschikbaar' | 'dossier' | 'overig' | 'afwezig' | 'vrij';

interface DienstDef {
  code: DienstCode;
  naam: string;
  categorie: Categorie;
  /** Voor het contract en de borging. */
  uren: number;
  /** Als de dienst volledig doorgaat, voor de ATW-dagduur. */
  urenMax: number;
  /** Inclusief de 1B. */
  plekken: number;
  /** DG1 = 1, DG2 = 2. */
  voorgangen: number;
  /** Bij Dg staan de tijden pas 4 dagen vooraf vast. */
  start?: number;
  eind?: number;
  tijdenVast: boolean;
  open?: string;
  /** Voor dagen achter elkaar, weekenden en vrij is vrij. */
  werk: boolean;
  /** Een uitvaartleider doet geen regelgesprekken. */
  alleenUV: boolean;
  /** Sneltoets in het rooster. */
  toets?: string;
  uitleg: string;
}

export const DIENSTEN: Record<DienstCode, DienstDef> = {
  '1': {
    code: '1', naam: 'Standaard regeldienst', categorie: 'regel', uren: 8, urenMax: 8, plekken: 1, voorgangen: 0,
    start: 9, eind: 17, tijdenVast: true, open: '10:00–13:00', werk: true, alleenUV: true, toets: '1',
    uitleg: 'Eén regelplek. Dienst 9:00 tot 17:00, open voor een regelgesprek van 10:00 tot 13:00.',
  },
  '1M': {
    code: '1M', naam: 'Middag/avonddienst', categorie: 'regel', uren: 8, urenMax: 8, plekken: 1, voorgangen: 0,
    start: 11, eind: 19, tijdenVast: true, open: '12:00–15:00', werk: true, alleenUV: true, toets: 'M',
    uitleg: 'Eén regelplek. Dienst 11:00 tot 19:00, open van 12:00 tot 15:00. Minimaal één per regio per dag.',
  },
  '2': {
    code: '2', naam: 'Twee regelplekken', categorie: 'regel', uren: 10, urenMax: 10, plekken: 2, voorgangen: 0,
    start: 9, eind: 19, tijdenVast: true, open: '10:00–10:30 en 14:30–15:00', werk: true, alleenUV: true, toets: '2',
    uitleg: 'Twee regelplekken, 9:00 tot 19:00. Maximaal twee per dag, en alleen als er nog minstens twee enkele regeldiensten staan.',
  },
  '1B': {
    code: '1B', naam: 'Beschikbaarheidsdienst', categorie: 'beschikbaar', uren: 2, urenMax: 8, plekken: 1, voorgangen: 0,
    start: 11, eind: 19, tijdenVast: true, open: '12:00–15:00, uiterlijk 14:00 bericht', werk: true, alleenUV: true, toets: 'B',
    uitleg: 'Telt als regelplek. Open van 12:00 tot 15:00, uiterlijk om 14:00 bericht. Alleen gewerkte tijd is werktijd; in de planning gewogen 2 uur. Maximaal 14 per 28 dagen (ATW).',
  },
  DG1: {
    code: 'DG1', naam: 'Dossiergebonden, kort', categorie: 'dossier', uren: 4, urenMax: 4, plekken: 0, voorgangen: 1,
    start: 9, eind: 13, tijdenVast: false, werk: true, alleenUV: false, toets: 'L',
    uitleg: 'Eén voorgang, ingeschat op 4 uur. Gebruikelijk voor een uitvaartleider. Tijden uiterlijk 4 dagen vooraf.',
  },
  DG2: {
    code: 'DG2', naam: 'Dossiergebonden', categorie: 'dossier', uren: 8, urenMax: 8, plekken: 0, voorgangen: 2,
    start: 9, eind: 17, tijdenVast: false, werk: true, alleenUV: false, toets: 'D',
    uitleg: 'Voorgaan, uitwerken en voorregelingen, ingeschat op 8 uur. Voorgaan heeft voorrang. Tijden uiterlijk 4 dagen vooraf.',
  },
  O: {
    code: 'O', naam: 'Overige dienst', categorie: 'overig', uren: 8, urenMax: 8, plekken: 0, voorgangen: 0,
    start: 9, eind: 17, tijdenVast: true, werk: true, alleenUV: false, toets: 'O',
    uitleg: 'Niet inzetbaar voor dossiergebonden werk: projectgroep, training en dergelijke.',
  },
  O4: {
    code: 'O4', naam: 'Overige dienst, kort', categorie: 'overig', uren: 4, urenMax: 4, plekken: 0, voorgangen: 0,
    start: 9, eind: 13, tijdenVast: true, werk: true, alleenUV: false, toets: 'O4',
    uitleg: 'Een halve dag ander werk (4 uur): een korte training of overleg. Niet inzetbaar voor dossiergebonden werk.',
  },
  OR: {
    code: 'OR', naam: 'Ondernemingsraad', categorie: 'overig', uren: 8, urenMax: 8, plekken: 0, voorgangen: 0,
    start: 9, eind: 17, tijdenVast: true, werk: true, alleenUV: false,
    uitleg: 'OR-werk. Niet inzetbaar voor dossiergebonden werk.',
  },
  VMS: {
    code: 'VMS', naam: 'VMS', categorie: 'overig', uren: 8, urenMax: 8, plekken: 0, voorgangen: 0,
    start: 9, eind: 17, tijdenVast: true, werk: true, alleenUV: false,
    uitleg: 'VMS-werkzaamheden. Niet inzetbaar voor dossiergebonden werk.',
  },
  TD: {
    code: 'TD', naam: 'Training of teamdag', categorie: 'overig', uren: 8, urenMax: 8, plekken: 0, voorgangen: 0,
    start: 9, eind: 17, tijdenVast: true, werk: true, alleenUV: false, toets: 'T',
    uitleg: 'Training, opleiding of teamdag. Niet inzetbaar voor dossiergebonden werk.',
  },
  V: {
    code: 'V', naam: 'Verlof', categorie: 'afwezig', uren: 0, urenMax: 0, plekken: 0, voorgangen: 0,
    tijdenVast: true, werk: false, alleenUV: false, toets: 'V', uitleg: 'Goedgekeurd verlof.',
  },
  Z: {
    code: 'Z', naam: 'Ziek', categorie: 'afwezig', uren: 0, urenMax: 0, plekken: 0, voorgangen: 0,
    tijdenVast: true, werk: false, alleenUV: false, toets: 'Z', uitleg: 'Ziek gemeld. De dienst moet worden opgevangen.',
  },
  N: {
    code: 'N', naam: 'In lijn', categorie: 'overig', uren: 0, urenMax: 0, plekken: 0, voorgangen: 0,
    tijdenVast: true, werk: true, alleenUV: false,
    uitleg: 'Aan de telefoon bij de nabestaandendesk, met eigen begin, eind en pauze; training, klachten en de maandstart staan als taak in de dienst. De pauze telt niet als werktijd, een taak wel.',
  },
  '-': {
    code: '-', naam: 'Vrij', categorie: 'vrij', uren: 0, urenMax: 0, plekken: 0, voorgangen: 0,
    tijdenVast: true, werk: false, alleenUV: false, toets: '0', uitleg: 'Niet ingeroosterd. Vrij is vrij.',
  },
};

export const PALET: DienstCode[] = ['1', '1M', '2', '1B', 'DG2', 'DG1', 'O', 'O4', 'TD', 'OR', 'VMS', 'V', 'Z', '-'];

export const TOETS_DIENST: Record<string, DienstCode> = Object.fromEntries(
  Object.values(DIENSTEN).filter((d) => d.toets).flatMap((d) => [[d.toets!.toLowerCase(), d.code], [d.toets!.toUpperCase(), d.code]]),
);

/** Een onbekende code is vrij ('-'). */
export function normaliseerDienst(c: string): DienstCode {
  return (c in DIENSTEN ? c : '-') as DienstCode;
}

export function dienstTijd(c: DienstCode): string {
  const d = DIENSTEN[c];
  if (d.start == null) return '';
  const t = `${d.start}:00–${d.eind}:00`;
  return d.tijdenVast ? t : `tijden volgen (indicatief ${t})`;
}

/**
 * Telt deze dag als afwezig voor de urennorm (contract / 5 eraf)? Verlof staat op elke dag van de periode, ook in het
 * weekend, maar telt alleen op maandag tot en met vrijdag: een week verlof is één week contract, niet 7/5. Ziekte staat
 * alleen op dagen met een dienst en telt dus altijd. Zoals de jaarplanning (werkdag verlof = contract / 5, ma t/m vr).
 */
export function afwezigVoorNorm(c: DienstCode, weekend: boolean): boolean {
  return c === 'Z' || (c === 'V' && !weekend);
}

/** De basis om ziekte op de dag op te vangen. */
export function isEnkel(c: DienstCode): boolean {
  return c === '1' || c === '1M';
}

export function magFunctie(functie: Functie | undefined, c: DienstCode): boolean {
  return !(DIENSTEN[c].alleenUV && functie === 'UL');
}

/** Eerst een DG2 (hele dag), ook voor een uitvaartleider; past die niet, dan een DG1. */
export function dossierVoor(_functie?: Functie): DienstCode {
  return 'DG2';
}

export const WENS_LABEL: Record<WensSoort, string> = {
  vrij: 'Liever vrij',
  ochtend: 'Liever ochtend',
  middag: 'Liever middag',
  avond: 'Liever avond',
  werken: 'Wil graag werken',
  neutraal: 'Geen voorkeur',
  overig8: 'Overige dienst (8 uur)',
  overig4: 'Overige dienst (4 uur)',
};

/** null: niet van toepassing, bijvoorbeeld ochtend en niet ingeroosterd. */
export function wensGehonoreerd(soort: WensSoort, dienst: DienstCode): boolean | null {
  const d = DIENSTEN[dienst];
  const werk = d.werk;
  switch (soort) {
    case 'vrij': return !werk;
    case 'werken': return werk;
    case 'ochtend': return werk ? !(d.start != null && d.start >= 11) : null;
    case 'middag': return werk ? d.start != null && d.start >= 11 : null;
    // avond bestaat alleen bij de NBD; die toetst met de echte tijden (lib/nbd/toets.ts)
    case 'avond': return werk ? d.start != null && d.start >= 15 : null;
    // geen voorkeur: er valt niets te honoreren
    case 'neutraal': return null;
    // de overige dienst die de medewerker opgaf, staat er (of er staat iets anders)
    case 'overig8': case 'overig4': return d.categorie === 'overig' ? true : werk ? false : null;
  }
}

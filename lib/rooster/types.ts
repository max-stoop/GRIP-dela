
/**
 * Diensten volgens het roosterbeleid:
 * 1 standaard regeldienst, 1M middag/avond, 2 twee regelplekken, 1B beschikbaarheidsdienst,
 * DG1 en DG2 dossiergebonden (1 of 2 voorgangen), O/O4/OR/VMS/TD overige diensten (O4 is een halve dag), V verlof, Z ziek.
 * N is een dienst van de nabestaandendesk (NBD), met eigen begin, eind en pauze.
 */
export type DienstCode = '-' | '1' | '1M' | '2' | '1B' | 'DG1' | 'DG2' | 'O' | 'O4' | 'OR' | 'VMS' | 'TD' | 'V' | 'Z' | 'N';

export type Voorkeur = 'O' | 'M';

/** Een uitvaartleider doet geen regelgesprekken. */
export type Functie = 'UV' | 'UL';

export const FUNCTIE_LABEL: Record<Functie, string> = { UV: 'Uitvaartverzorger', UL: 'Uitvaartleider' };

export interface Medewerker {
  id: string;
  regio: string;
  naam: string;
  /** Uren per week. */
  contract: number;
  voorkeur: Voorkeur;
  /** Welk weekend in de cadans: 0 = A, 1 = B, 2 = C, 3 = D. */
  weekendgroep: number;
  /** 1 = elk weekend, 2 = om het weekend (standaard), 3 = 1 op 3, 4 = 1 op 4. */
  weekendCadans?: number;
  functie?: Functie;
  /** De CAO-regel van 26 vrije weekenden geldt dan niet. */
  afstandsverklaring?: boolean;
  /** ZZP'er of externe kracht: niet in de formatie en niet in voorkeurenrondes (§ 3.7, § 3.9). */
  extern?: boolean;
  /** NBD, bij een variabel rooster; ontbreekt = het contract. */
  maxUren?: number;
  email?: string;
  actief: boolean;
  /** Een collega zoals een medewerker die ziet: zonder e-mailadres. */
  collega?: boolean;
  /** 1 = bovenaan; ontbreekt = op naam, onderaan de eigen groep. */
  volgorde?: number;
  /** PC4, voor de reistijd. */
  postcode?: string;
}

export function roosterGroep(m: Pick<Medewerker, 'functie' | 'extern'>): number {
  return m.extern ? 2 : m.functie === 'UL' ? 1 : 0;
}

export function opVolgorde(a: Medewerker, b: Medewerker): number {
  return roosterGroep(a) - roosterGroep(b) || (a.volgorde ?? Infinity) - (b.volgorde ?? Infinity) || a.naam.localeCompare(b.naam);
}

/** Van groot naar klein contract, binnen de uitvaartverzorgers en de uitvaartleiders. */
export function opContract(a: Medewerker, b: Medewerker): number {
  return roosterGroep(a) - roosterGroep(b) || b.contract - a.contract || a.naam.localeCompare(b.naam);
}

/** De nieuwe plek van iedereen, of null bovenaan of onderaan de groep. */
export function schuif(team: Medewerker[], id: string, richting: -1 | 1): Record<string, number> | null {
  const rij = [...team].sort(opVolgorde);
  const i = rij.findIndex((m) => m.id === id), j = i + richting;
  if (i < 0 || j < 0 || j >= rij.length || roosterGroep(rij[i]) !== roosterGroep(rij[j])) return null;
  [rij[i], rij[j]] = [rij[j], rij[i]];
  return Object.fromEntries(rij.map((m, k) => [m.id, k + 1]));
}

/** ZZP'ers en externen staan voorlopig niet in het rooster; met true plant en toont GRIP ze weer. */
export const ZZP_IN_ROOSTER = false;

export function weekendCadans(m: Pick<Medewerker, 'weekendCadans'>): number {
  const c = Math.round(m.weekendCadans ?? 2);
  return c >= 1 && c <= 4 ? c : 2;
}

/** `week` is een doorlopend weeknummer. */
export function werktWeekend(m: Pick<Medewerker, 'weekendCadans' | 'weekendgroep'>, week: number): boolean {
  const c = weekendCadans(m);
  return c === 1 || ((week % c) + c) % c === ((m.weekendgroep % c) + c) % c;
}

export const WEEKEND_CADANS_NAAM: Record<number, string> = { 1: 'Elk weekend', 2: 'Om het weekend', 3: '1 op 3 weekenden', 4: '1 op 4 weekenden' };

/** Kort: "weekend A", "1 op 3 (B)" of "elk weekend". */
export function weekendTekst(m: Pick<Medewerker, 'weekendCadans' | 'weekendgroep'>): string {
  const c = weekendCadans(m), g = 'ABCD'[((m.weekendgroep % c) + c) % c];
  return c === 1 ? 'elk weekend' : c === 2 ? `weekend ${g}` : `weekend 1 op ${c} (${g})`;
}

export function inRooster(m: Pick<Medewerker, 'actief' | 'extern'>): boolean {
  return m.actief && (ZZP_IN_ROOSTER || !m.extern);
}

/** medewerker-id → datum → dienst; ontbreekt = vrij. */
export type Cellen = Record<string, Record<string, DienstCode>>;

/** Tijdens een taak zit de NBD-medewerker niet aan de telefoon; het is wel werktijd. */
export type TaakSoort = 'training' | 'klachten' | 'maandstart';
export const TAAK_SOORTEN: TaakSoort[] = ['training', 'klachten', 'maandstart'];
export interface Taak {
  soort: TaakSoort;
  /** In uren (13.5 = 13:30), op een kwartier. */
  van: number;
  tot: number;
}

/** In uren (9.5 = 9:30). */
export interface Tijd {
  start: number;
  eind: number;
  /** Verandert de dienst, dan geldt weer de standaardtijd. */
  code?: DienstCode;
  /** Minuten; zit in de dienst maar telt niet als werktijd. */
  pauze?: number;
  /** Ontbreekt = midden in de dienst. */
  pauzeStart?: number;
  taken?: Taak[];
}

/** medewerker-id → datum → tijd; ontbreekt = de standaardtijd van de dienst. */
export type Tijden = Record<string, Record<string, Tijd>>;

/** Zo'n wens komt uit het jaarrooster dat de planner importeerde: een afspraak, geen losse wens. */
export const WENS_JAARROOSTER = 'uit het jaarrooster';

/** neutraal: uitdrukkelijk geen voorkeur voor die dag (iets anders dan niets ingevuld). */
export type WensSoort = 'vrij' | 'ochtend' | 'middag' | 'avond' | 'werken' | 'neutraal' | 'overig8' | 'overig4';

/** De medewerker heeft die dag al ander werk (training, overleg): de roostermaker zet er een overige dienst van 8 of 4 uur. */
export const WENS_OVERIG: Partial<Record<WensSoort, DienstCode>> = { overig8: 'O', overig4: 'O4' };

export interface Wens {
  id: string;
  medewerkerId: string;
  regio: string;
  datum: string;
  soort: WensSoort;
  opmerking?: string;
  gemaakt: string;
}

/** "niet" is een harde grens voor het voorstel. */
export type DagVoorkeur = 'graag' | 'neutraal' | 'liever_niet' | 'niet';

/**
 * De voorkeur voor één datum: een wens voor die dag gaat voor de vaste voorkeur van de weekdag. Wie die dag wil
 * werken (of een dagdeel kiest), kan die dag ook als de weekdag op "liever niet" of "kan niet" staat; "geen voorkeur"
 * zet de weekdag opzij. "Liever vrij" maakt een dag die niet kan niet zachter.
 */
export function dagVoorkeurOp(patroon: DagVoorkeur | undefined, wens?: WensSoort | null): DagVoorkeur {
  const p = patroon ?? 'neutraal';
  if (!wens) return p;
  if (wens === 'vrij') return p === 'graag' ? 'neutraal' : p;
  if (wens === 'neutraal') return 'neutraal';
  return p === 'graag' ? 'graag' : 'neutraal';
}

/**
 * Zoveel werkdagen per maand kan een medewerker "kan niet" opgeven, naar contract. Wat daarboven komt, weegt mee als
 * "liever niet". Voorlopige getallen: 40 uur 2, 36 uur 3, 32 uur 5; daaronder 6 (28 uur) en 8.
 */
export function maxKanNiet(contract: number): number {
  return contract >= 40 ? 2 : contract >= 36 ? 3 : contract >= 32 ? 5 : contract >= 28 ? 6 : 8;
}

/** Wat de vaste voorkeur van een weekdag als wens voor een datum is ("Standaard overnemen"). */
export function wensUitPatroon(patroon: DagVoorkeur | undefined): WensSoort {
  return patroon === 'graag' ? 'werken' : patroon === 'liever_niet' || patroon === 'niet' ? 'vrij' : 'neutraal';
}

export type TweeVoorkeur = 'graag' | 'neutraal' | 'liever_niet' | 'niet';

export interface Voorkeurprofiel {
  medewerkerId: string;
  /** 0 = zondag … 6 = zaterdag. */
  dagen: DagVoorkeur[];
  /** Avond alleen bij de NBD. */
  dienst: 'ochtend' | 'middag' | 'avond' | 'geen';
  /** 1B-diensten. */
  beschikbaarheid: 'graag' | 'neutraal' | 'liever_niet';
  /** null = geen voorkeur. */
  maxDagenPerWeek: number | null;
  /** Ontbreekt = maakt niet uit. "niet" zet alleen de planner of regiomanager. */
  twee?: TweeVoorkeur;
  /** De uren over meer dagen spreiden met korte Dg-dagen (DG1, 4 uur). Ontbreekt = maakt niet uit. */
  korteDagen?: 'graag' | 'liever_niet';
  /** Om het weekend: liever in de even of de oneven weken. */
  weekend?: 'even' | 'oneven';
  /** Regelplekken per gewerkt weekend: 3 (een 2 en een 1) betekent minder weekenden. */
  weekendPlekken?: 2 | 3;
  /** NBD, voor even en oneven weken. */
  uren?: UurVoorkeuren;
  opmerking?: string;
  bijgewerkt: string;
}

/**
 * NBD: per weekdag (0 = zondag) een teken per tijdvak van de desk (7:00-22:30): 'g' = graag, 'n' = kan niet,
 * '.' = geen voorkeur.
 */
export interface UurVoorkeuren {
  even: string[];
  oneven: string[];
}

export const LEEG_PROFIEL = (medewerkerId: string): Voorkeurprofiel => ({
  medewerkerId,
  dagen: ['neutraal', 'neutraal', 'neutraal', 'neutraal', 'neutraal', 'neutraal', 'neutraal'],
  dienst: 'geen',
  beschikbaarheid: 'neutraal',
  maxDagenPerWeek: null,
  bijgewerkt: '',
});

export interface Voorkeurronde {
  id: string;
  regio: string;
  van: string;
  tot: string;
  deadline: string;
  status: 'open' | 'gesloten';
  geopend: string;
  door: string;
  /** medewerker-id → moment van indienen. */
  ingediend: Record<string, string>;
}

/** In procenten: de vierledige doelstelling personeelsplanning. */
export interface Weging {
  continuiteit: number;
  efficiency: number;
  medewerker: number;
  klant: number;
}

/** Standaard volgens Roosterbeleid 1.3, met de wijzigingen van 2027. */
export interface Beleid {
  // regelplekken (§ 3.1)
  /** Dekkingsgraad per regio per dag: de vastgestelde regelplekken. */
  alphaRegio: number;
  /** Dekkingsgraad per cluster per dag. */
  alphaCluster: number;
  /** Tellen mee in de regelplekken. */
  beschikbaarPerDag: number;
  /** Nooit meer of minder dan de afgesproken regelplekken inplannen. */
  exactePlekken: boolean;
  minMiddag: number;
  /** Alle diensten samen; 0 = geen minimum. */
  minMedewerkers: number;
  /** Maximaal zoveel keer een 2 per dag... */
  maxTwee: number;
  /** ...en alleen als er dan nog minstens zoveel enkele regeldiensten (1 of 1M) staan, voor ziekte op de dag. */
  minEnkelBijTwee: number;
  /** Per uitvaartverzorger per weekend. */
  maxWeekendPlekken: number;
  /** In het weekend liever een 2 (binnen maxTwee en minEnkelBijTwee): dan werken er minder mensen in het weekend. */
  tweeInWeekend: boolean;
  /**
   * Zoveel "liever vrij"-wensen per vier weken zijn zo goed als zeker (alleen als er anders niemand is, wijkt de
   * roostermaker ervan af); wat daarboven komt, weegt mee als sterke voorkeur. 0 = geen grens.
   */
  wensenZeker: number;
  // dossiergebonden diensten (§ 3.3)
  minDG: number;
  /** Afwijkend per regio, bijvoorbeeld 3 in een regio met veel voorgangen. */
  dgPerRegio?: Record<string, number>;
  /** Het minimum aan voorgaansplekken per dag. Maandag t/m zaterdag; DG1 = 1, DG2 = 2. */
  voorgangenPerDag: number;
  /** Het maximum aan voorgaansplekken per dag (de streefwaarde): daarboven vult de roostermaker niet aan. */
  voorgangenMaxPerDag: number;
  /** Het aantal "kan niet"-dagen per maand heeft een maximum naar contract (maxKanNiet). */
  kanNietBegrensd: boolean;
  /** Op zaterdag minstens zoveel keer een DG2. 0 = geen eis. */
  zaterdagDG2: number;
  // uren
  maxContract: boolean;
  /**
   * De regelplekken staan er altijd, en elke dag (ma-za) minstens één voorgaansplek. Lukt dat niet binnen de
   * contracturen, dan mag de roostermaker iemand boven zijn contract plannen: over de periode gemiddeld hoogstens dit
   * percentage (15% is 28 uur die 32 uur wordt). 0 = nooit boven het contract.
   */
  bovenContractPct: number;
  /**
   * Wie een melding aanneemt (een 1, 1M of 2) werkt zoveel dagen later liefst weer (een 1 of een Dg-dienst): dan kan
   * hij de uitvaart van zijn eigen melding voorgaan. 0 = niet op letten.
   */
  voorgaanNaDagen: number;
  /** Uren die na de hele Dg-dagen nog open staan (een contract van 28 of 36 uur) aanvullen met een korte Dg-dag van 4 uur. */
  korteDagAanvullen: boolean;
  // ATW en CAO
  minRustUren: number;
  maxDagUren: number;
  /** Per 28 dagen per medewerker. */
  maxBeschikbaarPer28: number;
  /** Per kalenderjaar (CAO). */
  minVrijeWeekenden: number;
  /** Werkdagen en vrije dagen zoveel dagen vooruit vast (ATW). */
  vastDagen: number;
  /** Begin- en eindtijden zoveel dagen vooruit vast (ATW). */
  tijdenDagen: number;
  /** Het rooster van een maand staat zoveel maanden vóór het begin van die maand gepubliceerd (beleid: 2). */
  publicatieMaanden: number;
  // teamafspraken
  maxAchtereen: number;
  omHetWeekend: boolean;
  // capaciteit (vastgestelde regelplekken)
  verzuimNorm: number;
  verlofNorm: number;
  /** Clusterspeling meetellen in de te borgen uren. */
  clusterSpeling: boolean;
  /** Ruilen zonder overtredingen meteen doorvoeren, zonder goedkeuring van de planner. */
  ruilAutomatisch: boolean;
  /** Het rooster wordt pas gepubliceerd na goedkeuring door de regiomanager (§ 5.1). */
  goedkeuringVerplicht: boolean;
  /** Standaard besluit alleen de regiomanager over verlof (§ 4.1). De database leest dit ook (rp_besluit_verlof). */
  plannerBesluitVerlof: boolean;
  /** Geen planbare overige diensten (O, OR, VMS, TD) in schoolvakanties (§ 4.2). */
  geenOverigInVakantie: boolean;
  /** Het rooster voor juli en augustus zoveel maanden vooraf klaar (§ 4.2). */
  zomerVooruitMaanden: number;
  weging: Weging;
}

/** Een leeg rooster: één vaste waarde, zodat React-hooks niet bij elke render opnieuw rekenen. */
export const LEGE_CELLEN: Cellen = {};

export const STANDAARD_WEGING: Weging = { continuiteit: 35, efficiency: 20, medewerker: 25, klant: 20 };

export const STANDAARD_BELEID: Beleid = {
  alphaRegio: 0.8,
  alphaCluster: 0.95,
  beschikbaarPerDag: 1,
  exactePlekken: true,
  minMiddag: 1,
  minMedewerkers: 0,
  maxTwee: 2,
  minEnkelBijTwee: 2,
  maxWeekendPlekken: 3,
  tweeInWeekend: true,
  wensenZeker: 6,
  minDG: 2,
  voorgangenPerDag: 4,
  voorgangenMaxPerDag: 8,
  zaterdagDG2: 1,
  kanNietBegrensd: true,
  maxContract: true,
  bovenContractPct: 15,
  voorgaanNaDagen: 6,
  korteDagAanvullen: true,
  minRustUren: 12,
  maxDagUren: 12,
  maxBeschikbaarPer28: 14,
  minVrijeWeekenden: 26,
  vastDagen: 28,
  tijdenDagen: 4,
  publicatieMaanden: 2,
  maxAchtereen: 6,
  omHetWeekend: true,
  verzuimNorm: 0.085,
  verlofNorm: 0.129,
  clusterSpeling: true,
  ruilAutomatisch: false,
  goedkeuringVerplicht: true,
  plannerBesluitVerlof: false,
  geenOverigInVakantie: true,
  zomerVooruitMaanden: 4,
  weging: STANDAARD_WEGING,
};

/**
 * Het beleid zoals het voor één regio geldt: met het eigen minimum aan Dg-diensten, en met de voorgaansplekken per dag
 * uit de vastgestelde regelplekken van die regio (§ 3.3: "het aantal voorgangsdiensten per dag uit de vastgestelde
 * regelplekken"). Zonder normen geldt het landelijke getal uit het beleid.
 */
export function beleidVoor(b: Beleid, regio: string, normen?: { regios: Record<string, { voorgangen: number } | undefined> } | null): Beleid {
  const dg = b.dgPerRegio?.[regio];
  const vg = normen?.regios[regio]?.voorgangen;
  const uit = dg != null && dg !== b.minDG ? { ...b, minDG: dg } : b;
  return vg != null && Number.isFinite(vg) && vg !== uit.voorgangenPerDag ? { ...uit, voorgangenPerDag: vg } : uit;
}

export type BehoefteBron = 'basis' | 'laatste' | 'norm';

export const BEHOEFTE_BRON: Record<BehoefteBron, string> = {
  basis: 'roosterbasis',
  laatste: 'laatste voorspelling',
  norm: 'vastgestelde regelplekken',
};

export interface DagBehoefte {
  /** Op de dekkingsgraad, inclusief de 1B-dienst(en). */
  k: number;
  /** Verwachte meldingen. */
  lam: number;
  bron: BehoefteBron;
  /** De vastgestelde regelplekken, ter vergelijking. */
  kNorm?: number | null;
  /** Afgesproken in het cluster (zit al in k): meer plekken voor een andere regio, of minder (negatief). */
  verschoven?: number;
}

/** null = niets bekend voor die dag. */
export type Behoefte = Record<string, DagBehoefte | null>;

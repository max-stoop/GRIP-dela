/** Elke collectie is een tabel in de database (zie azure/database/grip.sql). */
import type { BronGebrek } from '../bronnen/actualiteit';
import type { FactorKey } from '../model/config';
import type { CoefSchatting, ExternData, HandmatigRij, Kalibratie, MeldingenData, RunMeta } from '../model/types';
import type { Beleid, Cellen, DienstCode, Medewerker, Tijden, Voorkeurprofiel, Voorkeurronde, Wens } from '../rooster/types';
import type { RuilToets } from '../rooster/ruil';
import type { WensTelling } from '../rooster/wensen';
import type { NormParameters } from '../capaciteit/parameters';
import type { Schoolvakantie } from '../capaciteit/verlof';
import type { Advies, AdviesKleur } from '../rooster/advies';
import type { NbdParameters } from '../nbd/parameters';
import type { DagVerdeling } from '../verdeling/dag';

export type Rol = 'beheerder' | 'regiomanager' | 'planner' | 'medewerker';

export const ROL_LABEL: Record<Rol, string> = {
  beheerder: 'Beheerder',
  regiomanager: 'Regiomanager',
  planner: 'Planner',
  medewerker: 'Medewerker',
};

/** Een planner en de beheerder plannen altijd landelijk. */
export function heeftAlleRegios(rol: Rol): boolean {
  return rol === 'beheerder' || rol === 'planner';
}

export interface BronStatus {
  bron: string;
  opgehaald: string;
  ok: boolean;
  melding: string;
  rijen: number;
}

export type VerlofSoort = 'vakantie' | 'adv' | 'bijzonder' | 'overig';
export type VerlofStatus = 'aangevraagd' | 'goedgekeurd' | 'afgewezen' | 'ingetrokken';

export const VERLOF_SOORT: Record<VerlofSoort, string> = {
  vakantie: 'Vakantie',
  adv: 'ADV / roostervrij',
  bijzonder: 'Bijzonder verlof',
  overig: 'Overig',
};

export interface Verlof {
  id: string;
  medewerkerId: string;
  regio: string;
  van: string;
  tot: string;
  soort: VerlofSoort;
  opmerking?: string;
  status: VerlofStatus;
  aangevraagd: string;
  beoordeeld?: string;
  beoordeelaar?: string;
  reden?: string;
  /** Diensten die bij goedkeuring zijn vervangen door V, zodat intrekken ze kan terugzetten. */
  vervangen?: Record<string, DienstCode>;
  rondeId?: string;
}

/** In een lopende ronde wordt in de ronde besloten; anders per aanvraag, zodat er geen blijft liggen. */
export function inLopendeRonde(v: Pick<Verlof, 'rondeId'>, rondes: Pick<Vakantieronde, 'id' | 'fase'>[]): boolean {
  return !!v.rondeId && rondes.some((r) => r.id === v.rondeId && r.fase !== 'besloten');
}

/** Roosterbeleid § 4. */
export type VakantieFase = 'planning' | 'analyse' | 'advies' | 'gesprek' | 'besloten';

export const VAKANTIE_FASE: Record<VakantieFase, { naam: string; wie: string; uitleg: string }> = {
  planning: { naam: 'Team maakt vakantieplanning', wie: 'Team', uitleg: 'Medewerkers vragen hun vakantie aan en zien per week hoeveel ruimte er is. Daarna gaan de aanvragen naar de analist.' },
  analyse: { naam: 'Analyse op clusterniveau', wie: 'Analist', uitleg: 'GRIP rekent per week de verlofruimte uit de vastgestelde regelplekken en geeft per aanvraag een advies. In schoolvakanties telt ook het cluster.' },
  advies: { naam: 'Advies aan cluster- en regiomanager', wie: 'Analist', uitleg: 'Het advies ligt klaar op cluster- en teamniveau.' },
  gesprek: { naam: 'Gesprek met het team', wie: 'Regiomanager', uitleg: 'Waar het niet past, zoekt de regiomanager met het team naar aanpassingen. Aanvragen kunnen nog wijzigen.' },
  besloten: { naam: 'Goedkeuring en afkeuring', wie: 'Regiomanager', uitleg: 'De aanvragen zijn goedgekeurd of afgekeurd en staan in het rooster.' },
};

export interface Vakantieronde {
  id: string;
  naam: string;
  /** Clustercode, of 'NL' voor het hele land. */
  cluster: string;
  van: string;
  tot: string;
  data: { aanvragen: string; analyse: string; advies: string; gesprek: string; besluit: string };
  fase: VakantieFase;
  gemaakt: string;
  door: string;
}

export interface Ziekmelding {
  id: string;
  medewerkerId: string;
  regio: string;
  van: string;
  /** Laatste dag; leeg = nog niet hersteld. */
  tot?: string;
  gemeld: string;
  door: string;
  /** Diensten die door Z zijn vervangen, zodat herstel ze kan terugzetten. */
  vervangen: Record<string, DienstCode>;
  /** Bezetting vóór de ziekmelding, zodat herstel niet dubbel inroostert. */
  voor?: Record<string, { plekken: number; dg: number }>;
  status: 'ziek' | 'hersteld';
}

export type RuilSoort = 'aanbieden' | 'ruilen' | 'verlof';
export type RuilStatus = 'open' | 'wacht_planner' | 'goedgekeurd' | 'afgewezen' | 'ingetrokken' | 'verlopen';

export interface Ruil {
  id: string;
  regio: string;
  soort: RuilSoort;
  aanbiederId: string;
  datum: string;
  dienst: DienstCode;
  /** Bij ruilen: met wie, en welke dienst van die collega terug. Bij aanbieden: wie het overneemt. */
  ontvangerId?: string;
  tegenDatum?: string;
  tegenDienst?: DienstCode;
  /** Bij verlof ruilen: het verlof van de aanbieder en dat van de collega. */
  verlofId?: string;
  tegenVerlofId?: string;
  /** Bij verlof ruilen: einde van beide periodes zoals ze bij het verzoek waren (datum en tegenDatum zijn het begin). */
  tot?: string;
  tegenTot?: string;
  opmerking?: string;
  status: RuilStatus;
  gemaakt: string;
  geaccepteerd?: string;
  beoordeeld?: string;
  beoordeelaar?: string;
  reden?: string;
  toets?: RuilToets;
}

export interface Publicatie {
  regio: string;
  op: string;
  door: string;
  van: string;
  tot: string;
  cellen: Cellen;
  /** Zodat medewerkers zien wat er veranderd is. */
  vorige?: { op: string; cellen: Cellen };
}

/**
 * Een afspraak in een cluster: in een periode doet de ene regio zoveel regelplekken minder en de andere zoveel meer,
 * bijvoorbeeld als de een te weinig en de ander te veel mensen heeft. De toets en Rooster maken rekenen ermee.
 */
export interface Verschuiving {
  id: string;
  vanRegio: string;
  naarRegio: string;
  van: string;
  tot: string;
  plekken: number;
  opmerking?: string;
  door: string;
  gemaakt: string;
}

export type ActiviteitSoort = 'verlof' | 'ruil' | 'rooster' | 'bijsturen' | 'ziek' | 'model' | 'bronnen' | 'team' | 'voorkeur' | 'ai' | 'tijden' | 'goedkeuring' | 'systeem';

/** rp_instelling 'dagtaak'. */
export interface Dagtaak {
  datum: string;
  /** beperkt: gemaakt, maar met verouderde of ontbrekende bronnen (zie gebreken). */
  status: 'gestart' | 'geslaagd' | 'beperkt' | 'mislukt';
  gestart: string;
  klaar?: string;
  melding?: string;
  run?: string;
  bronnen?: { ok: number; fout: number };
  gebreken?: BronGebrek[];
  waar: 'server' | 'browser';
  /**
   * Was een bron niet bereikbaar (beperkt), dan mag de taak vanaf dit moment (ISO, UTC) opnieuw: een storing om 6:00
   * houdt dan niet de hele dag een voorspelling zonder het nieuwe weer.
   */
  opnieuwNa?: string;
  /** Bewaartermijnen: hoeveel regels er per tabel zijn weggehaald, of waarom het niet lukte (alleen op de server). */
  opgeruimd?: Record<string, number> | string;
}

export interface Activiteit {
  id: string;
  moment: string;
  soort: ActiviteitSoort;
  tekst: string;
  regio?: string;
  /** Medewerker-id, voor de meldingen van medewerkers. */
  voor?: string;
  /** Voor alle medewerkers van de regio. */
  regioBreed?: boolean;
  door?: string;
}

export interface Coef extends CoefSchatting {
  bijgewerkt: string;
}

export type GoedkeuringStatus = 'ter_goedkeuring' | 'goedgekeurd' | 'afgekeurd';

export interface GoedkeuringStap {
  soort: 'advies' | 'goedgekeurd' | 'afgekeurd';
  op: string;
  door: string;
  kleur?: AdviesKleur;
  toelichting?: string;
  cijfer?: number;
  reden?: string;
}

/** Per regio per kalendermaand (§ 5.1). De geschiedenis bewaart elke stap, ook eerdere adviezen en afkeuringen. */
export interface Goedkeuring {
  regio: string;
  /** 'JJJJ-MM' */
  maand: string;
  status: GoedkeuringStatus;
  /** Bij het advies en bij de goedkeuring; alleen ter informatie. */
  versie: string;
  cijfer: number;
  hard: number;
  aangevraagd: string;
  door: string;
  beoordeeld?: string;
  beoordeelaar?: string;
  reden?: string;
  /** Verplicht voor goedkeuring. */
  advies?: Advies;
  geschiedenis: GoedkeuringStap[];
}

export interface AppState {
  geladen: boolean;
  demo: boolean;
  meldingen: MeldingenData | null;
  extern: ExternData;
  bronStatus: Record<string, BronStatus>;
  handmatig: HandmatigRij[];
  runs: RunMeta[];
  coef: Partial<Record<FactorKey, Coef>>;
  backtest: Kalibratie['backtest'] | null;
  normaal: number[] | null;
  roosterbasis: { runId: string; vastgelegd: string; door?: string } | null;
  beleid: Beleid;
  medewerkers: Medewerker[];
  rooster: Record<string, Cellen>;
  publicaties: Record<string, Publicatie>;
  verlof: Verlof[];
  wensen: Wens[];
  /**
   * Per datum hoeveel collega's in de eigen regio een wens hebben opgegeven, zoals de database het een medewerker
   * geeft (alleen aantallen). null: niet uit de database; wie alle wensen leest, telt ze zelf (lib/rooster/wensen.ts).
   */
  wensenTeam: Record<string, WensTelling> | null;
  profielen: Record<string, Voorkeurprofiel>;
  rondes: Voorkeurronde[];
  ruil: Ruil[];
  ziekmeldingen: Ziekmelding[];
  vakantierondes: Vakantieronde[];
  /** Regelplekken die een regio in een periode voor een andere regio in het cluster doet. */
  verschuivingen: Verschuiving[];
  /** De parameters van de jaarnorm. */
  normen: NormParameters;
  nbd: NbdParameters;
  schoolvakanties: Schoolvakantie[];
  /** Dg uiterlijk 4 dagen vooraf. */
  tijden: Record<string, Tijden>;
  /** Per regio per maand ('JJJJ-MM'). */
  goedkeuringen: Record<string, Record<string, Goedkeuring>>;
  activiteit: Activiteit[];
  laatsteAuto: string | null;
  dagtaak: Dagtaak | null;
  /** Per dag ('JJJJ-MM-DD'). */
  verdelingen: Record<string, DagVerdeling>;
}

export interface Taak {
  naam: string;
  sinds: string;
  stap?: string;
}

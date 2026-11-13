/** Tijden zijn minuten na middernacht van de plandag. Zie docs/ontwerp-verdeling.md. */

/** Het midden van het postcodegebied. */
export interface Punt {
  postcode: string;
  lat: number;
  lng: number;
  plaats?: string;
}

export type Dagdeel = 'ochtend' | 'middag';

/** Een ochtend of middag van een medewerker, voor één regelgesprek. */
export interface Slot {
  id: string;
  persoonId: string;
  dagdeel: Dagdeel;
  /** Vroegste en laatste begintijd. */
  van: number;
  tot: number;
  /** Een beschikbaarheidsdienst valt pas als het nodig is; een gewone regelplek staat er toch. */
  soort: 'regel' | '1B';
  /** Vaste begintijden; het gesprek begint op de eerste die haalbaar is, anders zo vroeg mogelijk. */
  tijden?: number[];
}

/** Een voorgang of een gesprek dat al is toegezegd. */
export interface Afspraak {
  id: string;
  start: number;
  eind: number;
  plek: Punt;
  soort: 'voorgang' | 'gesprek' | 'overig';
  omschrijving?: string;
}

export interface Persoon {
  id: string;
  naam: string;
  regio: string;
  cluster: string;
  /** Per week, voor de werkdruk naar rato. */
  contract: number;
  thuis: Punt;
  /** Vertrek van huis kan niet eerder; het laatste gesprek moet erbinnen af zijn. */
  dienstStart: number;
  dienstEind: number;
  slots: Slot[];
  afspraken: Afspraak[];
  /** Recente dossiers, gewogen naar hoe lang geleden (1 = gisteren). */
  belasting: number;
  /** Dagen direct voor de plandag met een regelgesprek. */
  reeks: number;
  /** Simulatie. */
  fictief?: boolean;
}

export interface Melding {
  id: string;
  plek: Punt;
  regio: string;
  cluster: string;
  /** ISO; bepaalt de 24-uursgrens. */
  ontvangen: string;
  /** 24 uur na ontvangst; ontbreekt = geen grens. */
  uiterlijk?: number;
  voorkeurDagdeel?: Dagdeel;
  /** Bijvoorbeeld op verzoek van de familie. */
  nietBij?: string[];
  /** Bijvoorbeeld een eerdere uitvaart in de familie. */
  liefstBij?: string;
  /** Toegezegd: blijft staan bij een nieuwe verdeling. */
  vast?: { slotId: string };
  /** Het gesprek begint precies dan, of de plek past niet. */
  tijd?: number;
}

/** Alle gewichten in minuten reistijd: hoeveel minuten extra rijden je ervoor over hebt. */
export interface Parameters {
  /** 1 = net zo zwaar als heen. */
  terugreis: number;
  /** Langste enkele reis; daarboven komt een plek niet in aanmerking. */
  maxReistijd: number;
  gesprekDuur: number;
  /** Voor parkeren en onvoorziene vertraging. */
  marge: number;
  /** Werkdruk: een extra dossier kost `werkdruk` x (2 x dossiers + 1) / fte² minuten. */
  werkdruk: number;
  /** Per dag achter elkaar met gesprekken, vanaf de derde dag. */
  reeks: number;
  buitenRegio: number;
  buitenCluster: number;
  /** Het tweede gesprek van een 2 liever pas als de eerste plekken vol zijn; 0 = geen verschil. */
  tweedeGesprek: number;
  /** Een gevallen 1B is niet meer de achtervang van de dag. */
  inzet1B: number;
  /** Een melding die later op de dag niet meer op tijd een plek krijgt. */
  tekort: number;
  /** Komt na de nachtverdeling binnen en kan nog een ochtendplek krijgen. */
  aandeelOchtend: number;
  /** Komt na de nachtverdeling binnen en kan alleen nog een middagplek krijgen. */
  aandeelMiddag: number;
  /** Middag in plaats van ochtend: de familie wacht langer. */
  klantMiddag: number;
  /** Afwijken van de voorkeur van de familie (dagdeel). */
  voorkeur: number;
  /** Bonus als het de gewenste persoon is. */
  liefstBij: number;
  /** Moet de planner oplossen. */
  geenPlek: number;
  /** De dichtstbijzijnde op de tabel. */
  kandidaten: number;
}

export const STANDAARD_PARAMETERS: Parameters = {
  terugreis: 0.5,
  maxReistijd: 75,
  gesprekDuur: 120,
  marge: 10,
  werkdruk: 3,
  reeks: 10,
  buitenRegio: 15,
  buitenCluster: 45,
  tweedeGesprek: 0,
  inzet1B: 60,
  tekort: 90,
  aandeelOchtend: 0.15,
  aandeelMiddag: 0.35,
  klantMiddag: 5,
  voorkeur: 30,
  liefstBij: 30,
  geenPlek: 1000,
  kandidaten: 30,
};

/** Minuten, bij vertrek op minuut `vertrek` van de plandag. */
export type ReistijdFn = (a: Punt, b: Punt, vertrek: number) => number;

/** Alles in minuten. */
export interface Kostenopbouw {
  /** Heen, door, en een deel van terug. */
  reis: number;
  werkdruk: number;
  reeks: number;
  regio: number;
  /** Bij de latere van de twee. */
  tweede: number;
  inzet1B: number;
  /** Deze plek is niet meer vrij voor meldingen later op de dag. */
  flexibiliteit: number;
  klant: number;
  totaal: number;
}

export interface Toewijzing {
  meldingId: string;
  persoonId: string;
  slotId: string;
  dagdeel: Dagdeel;
  /** Vroegst mogelijk binnen het tijdvak. */
  start: number;
  reistijd: number;
  vanaf: 'thuis' | 'gesprek' | 'voorgang' | 'afspraak';
  kosten: Kostenopbouw;
  vast?: boolean;
  /** Toegezegd, maar volgens het model past het niet meer; het blijft staan. */
  waarschuwing?: string;
  /** De toegezegde plek is er niet meer, bijvoorbeeld door ziekte. */
  herplaatst?: boolean;
}

export interface NietIngepland {
  meldingId: string;
  reden: string;
}

/** Per cluster, na de verdeling. */
export interface ClusterStand {
  cluster: string;
  vrijOchtend: number;
  vrijMiddag: number;
  /** Waarvan 1B. */
  vrij1B: number;
  verwachtOchtend: number;
  verwachtMiddag: number;
  /** Later op de dag, zonder plek. */
  verwachtTekort: number;
}

export interface Uitkomst {
  toewijzingen: Toewijzing[];
  nietIngepland: NietIngepland[];
  clusters: ClusterStand[];
  /** Minuten. */
  doel: number;
  /** Om te laten zien dat het klaar is. */
  verbeterd: number;
}

export interface Invoer {
  personen: Persoon[];
  meldingen: Melding[];
  /** Hele dag, voor de waarde van vrije plekken. */
  verwacht: Record<string, number>;
  parameters: Parameters;
}

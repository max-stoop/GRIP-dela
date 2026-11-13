import { NORM_STANDAARD } from '../capaciteit/parameters';

export const CLUSTERS: Record<string, string[]> = {
  N: ['Friesland', 'Groningen', 'Noord-Oost', 'Twente/Achterhoek', 'Veluwe-IJssel'],
  NW: ['Amsterdam', 'Noord-Holland', 'Noord-Holland Midden', 'Spaarne-Rijnland'],
  O: ['Arnhem', 'Midden Nederland', 'Nijmegen', 'Utrecht'],
  W: ['Haaglanden', 'Rotterdam', 'West Brabant/Zeeland', 'Zuid Holland Zuid'],
  ZO: ['Kempenland', 'Midden Limburg', 'Oost Brabant', 'Zuid Limburg'],
  ZW: ['Breda', 'Den Bosch', 'Eindhoven', 'Tilburg'],
};

export const CLUSTER_NAAM: Record<string, string> = {
  N: 'Noord', NW: 'Noordwest', O: 'Oost', W: 'West', ZO: 'Zuidoost', ZW: 'Zuidwest',
};

export const REGION_CLUSTER: Record<string, string> = Object.fromEntries(
  Object.entries(CLUSTERS).flatMap(([c, rs]) => rs.map((r) => [r, c])),
);

export const REGIONS: string[] = Object.keys(REGION_CLUSTER);

/** Benaderd, voor weer en luchtkwaliteit. */
export const COORDS: Record<string, [number, number]> = {
  Friesland: [53.1, 5.8], Groningen: [53.2, 6.6], 'Noord-Oost': [52.8, 6.5],
  'Twente/Achterhoek': [52.2, 6.6], 'Veluwe-IJssel': [52.4, 6.0],
  Amsterdam: [52.37, 4.9], 'Noord-Holland': [52.75, 4.85], 'Noord-Holland Midden': [52.55, 4.75],
  'Spaarne-Rijnland': [52.25, 4.55], Arnhem: [51.98, 5.9], 'Midden Nederland': [52.15, 5.4],
  Nijmegen: [51.84, 5.86], Utrecht: [52.09, 5.12], Haaglanden: [52.07, 4.3],
  Rotterdam: [51.92, 4.48], 'West Brabant/Zeeland': [51.5, 3.9], 'Zuid Holland Zuid': [51.8, 4.7],
  Kempenland: [51.35, 5.3], 'Midden Limburg': [51.25, 5.9], 'Oost Brabant': [51.6, 5.75],
  'Zuid Limburg': [50.88, 5.85], Breda: [51.59, 4.78], 'Den Bosch': [51.69, 5.3],
  Eindhoven: [51.44, 5.48], Tilburg: [51.56, 5.09],
};

export const DE_BILT: [number, number] = [52.1, 5.18];

/** Alleen voor demodata: volume per jaar / 365 uit de vastgestelde regelplekken. */
export const DEMO_LEVEL: Record<string, number> = Object.fromEntries(
  Object.entries(NORM_STANDAARD.regios).map(([r, x]) => [r, ((x.natura + x.cbs * x.vrijeMarkt) * x.correctie) / 365]),
);

/** Rooster twee maanden vooruit. */
export const HORIZON_DAYS = 61;
/** De weersverwachting reikt 16 dagen. */
export const SHORT_HORIZON = 16;
/** Zoveel dagen met meldingen heeft een regio minstens nodig voor een eigen seizoenmodel; anders de vastgestelde regelplekken. */
export const MIN_HISTORIE_DAGEN = 365;
/** Halfwaardetijd van de tijdsweging, uit eerdere terugtesten. */
export const DECAY_HALFLIFE_DAYS = 400;
/** Eigen niveau per regio: over zoveel dagen gemeten, en met zoveel meldingen gedempt richting het landelijke niveau. */
export const REGIO_NIVEAU_DAGEN = 112;
export const REGIO_NIVEAU_DEMPING = 60;
/** Fijnstof: jaargemiddelde NL in µg/m³; de factor is relatief hierop. */
export const PM25_BASE = 9.0;

export type FactorKey =
  | 'heat' | 'cold' | 'pm25' | 'ozone' | 'covid_ww' | 'flu_ili' | 'mom7'
  | 'level28' | 'seas_tw' | 'seas_ts' | 'cbs_exc' | 'niveau_regio';

interface Prior {
  prior: number;
  sd: number;
  eenheid: string;
  horizon: 'kort' | 'lang';
  label: string;
  bron: string;
  /** Waarom deze startwaarde: onderzoek of redenering, en wat het betekent in een voorbeeld. */
  waarom: string;
}

/** Log-schaal per eenheid, uit literatuur en eerdere analyse; kalibreren vervangt ze. De volgorde bepaalt de kolommen in de kalibratie. */
export const PRIORS: Record<FactorKey, Prior> = {
  heat: { prior: 0.02, sd: 0.01, eenheid: 'per graad boven 25 °C (warmste moment, gemiddeld over 3 dagen)', horizon: 'kort', label: 'Hitte', bron: 'Open-Meteo, per regio', waarom: 'Bij hitte overlijden binnen een paar dagen meer mensen, vooral ouderen. Tijdens hittegolven lag de sterfte in Nederland gemiddeld 12% hoger (Huynen e.a., 2001). 2% per graad boven 25 °C geeft bij gemiddeld 30 °C ongeveer +10%.' },
  cold: { prior: 0.01, sd: 0.006, eenheid: 'per graad onder 5 °C (daggemiddelde over 2 weken)', horizon: 'kort', label: 'Kou', bron: 'Open-Meteo, per regio', waarom: 'Kou werkt trager door, daarom het gemiddelde over twee weken. Tijdens koudegolven lag de sterfte in Nederland gemiddeld 13% hoger (Huynen e.a., 2001). De gewone winter zit al in het basismodel; dit vangt alleen echte kou op: bij gemiddeld −5 °C ongeveer +10%.' },
  pm25: { prior: 0.007, sd: 0.006, eenheid: 'per 10 µg/m³ fijnstof boven 9 (gemiddeld over 3 dagen)', horizon: 'kort', label: 'Fijnstof', bron: 'Open-Meteo', waarom: 'Onderzoek in 652 steden wereldwijd: 0,68% meer sterfte per 10 µg/m³ fijnstof (Liu e.a., 2019). Gerekend vanaf 9 µg/m³, het gewone Nederlandse niveau; schonere lucht geeft een klein min.' },
  ozone: { prior: 0.003, sd: 0.004, eenheid: 'per 10 µg/m³ ozon boven 100 (hoogste waarde van de dag)', horizon: 'kort', label: 'Ozon', bron: 'Open-Meteo', waarom: 'Onderzoek in 406 steden: ongeveer 0,2% meer sterfte per 10 µg/m³ ozon (Vicedo-Cabrera e.a., 2020). GRIP telt het alleen boven 100 µg/m³, bij zomersmog.' },
  covid_ww: { prior: 0.015, sd: 0.015, eenheid: 'per verdubbeling van het virus in het rioolwater t.o.v. het gewone niveau', horizon: 'kort', label: 'Rioolwater COVID', bron: 'RIVM', waarom: 'Een eigen inschatting: meer virus in het rioolwater gaat vooraf aan meer zieken en later meer sterfte. Bewust klein en met een ruime onzekerheid; de kalibratie laat zien hoeveel het echt doet.' },
  flu_ili: { prior: 0.03, sd: 0.02, eenheid: 'per 50 griepachtige consulten per 100.000 boven 50', horizon: 'kort', label: 'Griep', bron: 'Nivel, handmatig', waarom: 'Een stevige griepgolf geeft duidelijk meer sterfte. Bij 150 tot 200 griepachtige consulten per 100.000 (de epidemiegrens is ongeveer 50) geeft dit +6 tot +9%. Telt minder mee naarmate je verder vooruit kijkt.' },
  mom7: { prior: 0.4, sd: 0.15, eenheid: 'drukte afgelopen week t.o.v. normaal; telt minder mee naarmate je verder vooruit kijkt', horizon: 'kort', label: 'Drukte afgelopen week', bron: 'eigen meldingen', waarom: 'Was de afgelopen week drukker dan normaal, dan blijft het vaak nog even drukker. 0,40 betekent: 10% drukker in de afgelopen week geeft morgen ongeveer +4%, en dat ebt in een paar weken weg.' },
  level28: { prior: 0.5, sd: 0.2, eenheid: 'drukte afgelopen 4 weken t.o.v. normaal; telt minder mee naarmate je verder vooruit kijkt', horizon: 'lang', label: 'Niveau afgelopen 4 weken', bron: 'eigen meldingen', waarom: 'Hetzelfde over vier weken: een aanhoudend hoger of lager niveau. 0,50 betekent: 10% drukker over vier weken geeft ongeveer +5%, en dat ebt langzaam weg (over een paar maanden).' },
  seas_tw: { prior: -0.008, sd: 0.008, eenheid: 'per graad warmer dan normaal (nov t/m mrt)', horizon: 'lang', label: 'Seizoensverwachting winter', bron: 'Open-Meteo', waarom: 'Een zachte winter geeft minder sterfte, een strenge meer. Alleen verder dan 16 dagen vooruit, uit de seizoensverwachting: −0,8% per graad warmer dan normaal.' },
  seas_ts: { prior: 0.008, sd: 0.008, eenheid: 'per graad warmer dan normaal (jun t/m aug)', horizon: 'lang', label: 'Seizoensverwachting zomer', bron: 'Open-Meteo', waarom: 'Een warme zomer geeft iets meer sterfte: +0,8% per graad warmer dan normaal. Alleen verder dan 16 dagen vooruit, uit de seizoensverwachting.' },
  cbs_exc: { prior: 0.0, sd: 0.2, eenheid: 'sterfte afgelopen 4 weken t.o.v. dezelfde weken in de 3 jaar ervoor', horizon: 'lang', label: 'Landelijke sterfte CBS', bron: 'CBS', waarom: 'Begint op 0, omdat de landelijke sterfte van het CBS grotendeels hetzelfde meet als de eigen meldingen. Telt pas mee als de kalibratie op de eigen historie laat zien dat het iets toevoegt.' },
  niveau_regio: { prior: 1, sd: 0.3, eenheid: 'eigen niveau van de regio over 16 weken t.o.v. het landelijke niveau', horizon: 'lang', label: 'Niveau eigen regio', bron: 'eigen meldingen', waarom: 'Groeit of krimpt een regio (bijvoorbeeld door een ander marktaandeel), dan volgt het basismodel dat maar langzaam. Dit telt het eigen niveau van de regio over de laatste 16 weken mee, vergeleken met de rest van het land. Bij weinig meldingen telt het minder mee en schuift het naar het landelijke niveau. Het ebt niet weg: groei of krimp van een regio blijft meestal. Landelijk telt het op tot ongeveer nul.' },
};

export const FACTORS = Object.keys(PRIORS) as FactorKey[];

/** Dempingstijd in dagen voor signalen die met de horizon wegebben. */
export const DECAY: Record<'mom7' | 'level28' | 'cbs_exc' | 'covid_ww' | 'flu_ili', number> = {
  mom7: 21, level28: 45, cbs_exc: 45, covid_ww: 21, flu_ili: 21,
};

/** Factoren die als verhouding (niet als procent per eenheid) worden getoond. */
export const RATIO_FACTORS: FactorKey[] = ['mom7', 'level28', 'cbs_exc', 'niveau_regio'];

export function regionsInScope(scope: string): string[] {
  if (scope === 'NL') return REGIONS;
  if (scope.startsWith('C:')) return CLUSTERS[scope.slice(2)] ?? [];
  if (scope.startsWith('R:')) return [scope.slice(2)];
  return [];
}

export function scopeLabel(scope: string): string {
  if (scope === 'NL') return 'landelijk';
  if (scope.startsWith('C:')) return `cluster ${CLUSTER_NAAM[scope.slice(2)] ?? scope.slice(2)}`;
  return scope.slice(2);
}

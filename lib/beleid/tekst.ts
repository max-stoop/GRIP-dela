/** Roosterbeleid 1.3 met de wijzigingen voor 2027. Regels die GRIP controleert, verwijzen naar de toets (RegelId). */
import type { RegelId } from '../rooster/toets';

export type Blok =
  | { soort: 'p'; tekst: string }
  | { soort: 'lijst'; items: string[] }
  | { soort: 'regel'; tekst: string; regels: RegelId[]; gewijzigd?: string }
  | { soort: 'tabel'; kop: string[]; rijen: string[][]; noot?: string }
  | { soort: 'stappen'; stappen: string[] }
  | { soort: 'diensten' }
  | { soort: 'doelen' }
  | { soort: 'grip'; tekst: string };

interface Paragraaf {
  id: string;
  titel: string;
  blokken: Blok[];
}

interface Hoofdstuk {
  nr: number;
  titel: string;
  paragrafen: Paragraaf[];
}

export const BELEID_VERSIE = 'Roosterbeleid 1.3, met de wijzigingen voor 2027';

export const WIJZIGINGEN_2027: string[] = [
  'De clusterflex (beschikbaarheidsdienst per cluster voor de eerste 48 uur onvoorspelbare afwezigheid) vervalt.',
  'Een regio mag op een dag maximaal twee keer een 2 inplannen, mits er minstens twee keer een 1 (of 1M) overblijft, zodat ziekte op de dag kan worden opgevangen.',
  'Uren voor de planning en de borging: een 1 is 8 uur, een 2 is 10 uur, een DG1 4 uur, een DG2 8 uur en een 1B gewogen 2 uur (hij valt ongeveer 1 op de 4 keer).',
  'De regelplekken per regio komen uit de vastgestelde regelplekken 2027; de beschikbaarheidsdienst telt daarin mee als regelplek.',
  'De data in het vakantieproces zijn een advies; het proces zelf staat vast.',
];

export const DOELEN = [
  { naam: 'Continuïteit', kleur: 'var(--navy)', tekst: 'Onze personeelsplanning draagt in eerste instantie bij aan de continuïteit van onze dienstverlening. Daarbij houden we ons aan alle wettelijke normen.' },
  { naam: 'Efficiency', kleur: 'var(--teal)', tekst: 'Om kosten te beheersen, zorgen we ervoor dat een uitvaart wordt geregeld binnen de gestelde normen.' },
  { naam: 'Medewerkerstevredenheid', kleur: 'var(--plum)', tekst: 'Binnen deze kaders geven we de medewerkers zoveel mogelijk ruimte in het rooster, wat bijdraagt aan hun tevredenheid.' },
  { naam: 'Klanttevredenheid', kleur: 'var(--gold)', tekst: 'Zo kunnen we klanten, als ze dat willen, binnen 24 uur helpen. Vullen we alle componenten goed in, dan leidt dit ongetwijfeld tot tevreden klanten.' },
];

export const BELEID: Hoofdstuk[] = [
  {
    nr: 1,
    titel: 'Roosteren volgens ATW en CAO',
    paragrafen: [
      {
        id: '1.1',
        titel: 'Doel van de ATW',
        blokken: [
          { soort: 'p', tekst: 'Het doel van de arbeidstijdenwet (ATW) is zorgen voor de gezondheid en het welzijn van werknemers bij hun werk. De CAO is een aanvulling op de ATW. Kortom: wet- en regelgeving om de medewerkers te beschermen. De werkgever is ervoor verantwoordelijk dat medewerkers zich aan de ATW houden. Afwijkingen op de ATW zijn niet toegestaan. De regels van de ATW zijn daarom het uitgangspunt voor het maken van het rooster.' },
          { soort: 'grip', tekst: 'Een overtreding van ATW of CAO maakt het rooster in GRIP "Afgekeurd": het cijfer gaat dan nooit boven de 5,4. Dat geldt ook bij structureel te weinig regelplekken (een dag met 2 of meer te weinig, of 3 of meer dagen met een tekort). Voorstellen, ruilen, bijsturingen en AI-voorstellen met een nieuwe ATW-overtreding worden niet doorgevoerd.' },
        ],
      },
      {
        id: '1.2',
        titel: 'ATW en roosters maken',
        blokken: [
          { soort: 'p', tekst: 'De ATW geeft minimale termijnen voor het vaststellen van de roosters:' },
          { soort: 'lijst', items: ['28 dagen van tevoren moeten werkdagen en vrije dagen bekend zijn.', '4 dagen van tevoren moeten begin- en eindtijden van diensten bekend zijn.'] },
          { soort: 'p', tekst: 'Dit betekent dat alle werkzaamheden ingeroosterd moeten worden, niet alleen regelplekken. Binnen een werkdag (een dienst) worden alle uren gezien als werktijd. Vanuit de CAO betekent werktijd betaalde tijd.' },
          { soort: 'grip', tekst: 'Bij bijsturen binnen 28 dagen stelt GRIP een vrije dag alleen "in overleg" voor; binnen 4 dagen geldt dat ook voor andere begin- en eindtijden. Het dashboard laat zien tot wanneer het rooster gepubliceerd is.' },
          { soort: 'p', tekst: 'Bij onvoorspelbaar werk mag de werkgever maximaal 14 dagen in een periode van 28 dagen vragen tijd te reserveren voor werk, waarbij alleen de tijd die je uiteindelijk werkt als werktijd geldt. Dat zijn beschikbaarheidsdiensten. De loonschalen van de werkgever liggen op of boven de B-schalen van de CAO Uitvaartbranche, waarmee beschikbaarheidsdiensten in geld gecompenseerd zijn in het maandloon.' },
          { soort: 'regel', tekst: 'Maximaal 14 beschikbaarheidsdiensten per medewerker in elke periode van 28 dagen.', regels: ['beschikbaar28'] },
        ],
      },
      {
        id: '1.3',
        titel: 'ATW en dagsturen',
        blokken: [
          { soort: 'p', tekst: 'Door het werken met diensten met vaste begin- en eindtijden lijkt het niet mogelijk om op de dag zelf je agenda te bepalen. Dat kan nog steeds. De werkgever moet zorgen dat het werk waarvoor je ingeroosterd staat binnen de dienst gedaan kan worden, zoals regelgesprekken of voorgaan. Werk dat minder tijdsgebonden is, zoals het uitwerken van een uitvaart, mag je ook op een ander moment doen als je daar zelf voor kiest.' },
          { soort: 'p', tekst: 'De kaders vanuit de ATW:' },
          { soort: 'lijst', items: ['Vrij is vrij. Op een vrije dag werk je niet.', 'Een werkdag mag niet langer dan 12 uur duren.', 'Je moet 12 uur rust houden tussen twee diensten.', 'Achteraf worden de begin- en eindtijd van de gewerkte dienst geregistreerd.'] },
          { soort: 'regel', tekst: 'Minimaal 12 uur rust tussen twee diensten.', regels: ['rust'] },
          { soort: 'regel', tekst: 'Wekelijkse rust: niet meer dan 6 diensten achter elkaar.', regels: ['achtereen'] },
          { soort: 'grip', tekst: 'De langste dienst duurt 10 uur (een 2, 9:00 tot 19:00), dus een werkdag van meer dan 12 uur kan in het rooster niet voorkomen.' },
        ],
      },
      {
        id: '1.4',
        titel: 'Weekenden (CAO)',
        blokken: [
          { soort: 'p', tekst: 'De werknemer verricht per kalenderjaar minimaal 26 weekenden geen werkzaamheden. Voor maximaal 13 van deze 26 weekenden geldt dat in plaats van zaterdag en zondag ook zondag en maandag als weekend telt. Een medewerker kan een afstandsverklaring tekenen, waardoor deze bepaling niet geldt.' },
          { soort: 'regel', tekst: 'Minimaal 26 vrije weekenden per kalenderjaar (tenzij afstandsverklaring).', regels: ['weekenden26'] },
          { soort: 'grip', tekst: 'GRIP telt per kalenderjaar uit alle roosterdata de weekenden waarin op zaterdag of zondag is gewerkt; een weekend met zondag en maandag vrij telt hoogstens 13 keer als vrij weekend. Een afstandsverklaring zet je bij de medewerker in het rooster.' },
        ],
      },
    ],
  },
  {
    nr: 2,
    titel: 'Visie personeelsplanning',
    paragrafen: [
      {
        id: '2.1',
        titel: 'De vierledige doelstelling',
        blokken: [
          { soort: 'p', tekst: 'Het MT uitvaartverzorging heeft in mei 2023 de visie op personeelsplanning vastgesteld. De aanvullende roosterkaders zijn een uitwerking van deze visie.' },
          { soort: 'doelen' },
          { soort: 'grip', tekst: 'Het roostercijfer in GRIP is precies deze vier doelen: continuïteit (dekking en naleving), efficiency (binnen de normen, geen uren boven contract), medewerkerstevredenheid (wensen, voorkeuren, ritme, eerlijke verdeling) en klanttevredenheid (verwacht aandeel meldingen dat binnen 24 uur geholpen is). De weging stel je in onder Instellingen.' },
        ],
      },
    ],
  },
  {
    nr: 3,
    titel: 'Aanvullende roosterkaders',
    paragrafen: [
      {
        id: '3.1',
        titel: 'Het rooster en de regelplekken',
        blokken: [
          { soort: 'p', tekst: 'Als team ben je gezamenlijk verantwoordelijk voor het rooster in je regio. Het rooster wordt 2 maanden van tevoren gepubliceerd.' },
          { soort: 'p', tekst: 'Je plant voldoende regelplekken in om op 80% van de dagen in de eigen regio je regelgesprekken te kunnen doen. Het uitgangspunt is 1 regelplek per dag per uitvaartverzorger. Je kunt ervoor kiezen om op bepaalde dagen een uitvaartverzorger voor 2 regelplekken in te plannen, maar de standaard blijft 1. Zo houd je de mogelijkheid om op te schalen als er andere werkzaamheden zijn of iemand uitvalt, terwijl je de weekendbelasting zo laag mogelijk houdt.' },
          { soort: 'regel', tekst: 'Plan volgens het benodigde aantal regelplekken op de dag: nooit meer of minder dan de afgesproken regelplekken.', regels: ['tekort', 'teveel'] },
          { soort: 'regel', tekst: 'Maximaal twee keer een 2 per dag, en alleen als er dan nog minstens twee keer een 1 (of 1M) staat, zodat ziekte op de dag kan worden opgevangen.', regels: ['twee'], gewijzigd: 'Nieuw in 2027. Was: in het weekend voor één persoon.' },
          { soort: 'regel', tekst: 'Je krijgt als uitvaartverzorger maximaal 3 regelplekken in het weekend. Binnen dit kader houd je rekening met de verhouding tussen contracturen en weekendbelasting.', regels: ['weekendplekken'] },
          { soort: 'grip', tekst: 'De afgesproken regelplekken komen uit de vastgestelde regelplekken 2027 (Excel). Voor de komende twee maanden rekent GRIP met de roosterbasis, de voorspelling die bij het maken van het rooster is vastgelegd; daarna met de laatste voorspelling (bijsturen). De verdeling van weekenden, 1B en 2-diensten per contractuur telt mee in de medewerkerstevredenheid.' },
        ],
      },
      {
        id: '3.2',
        titel: 'Diensten voor regelplekken',
        blokken: [
          { soort: 'diensten' },
          { soort: 'regel', tekst: 'Er is minimaal 1 middag/avonddienst per regio per dag.', regels: ['middag'] },
          { soort: 'regel', tekst: 'Plan naast de standaard diensten ook minimaal 1 beschikbaarheidsdienst per dag. Die telt mee als regelplek.', regels: ['beschikbaar'] },
          { soort: 'p', tekst: 'Aanpassen van de tijden van het openstellen voor een regelplek (incidenteel of structureel) kan alleen in overleg met de RA of RM. Zelf voorgaan of andere werkgerelateerde activiteiten zijn hiervoor de meest zwaarwegende reden.' },
        ],
      },
      {
        id: '3.3',
        titel: 'Dossiergebonden diensten (Dg)',
        blokken: [
          { soort: 'p', tekst: 'Naast diensten voor regelplekken zijn er diensten voor overige dossiergebonden taken: voorgaan, uitwerken, voorregelingen en dergelijke. Als regio ben je verantwoordelijk voor de uitvaarten in je regio: je regelt ze én je gaat voor. Neem voorgaan daarom vooraf mee in het rooster, zodat het niet ten koste gaat van regelplekken.' },
          { soort: 'lijst', items: [
            'Het belangrijkste doel van de Dg-dienst is voldoende voorgaanplekken. Voorgaan heeft in de Dg-dienst voorrang.',
            'Een Dg-dag kan worden ingevuld door een uitvaartverzorger en/of een uitvaartleider.',
            'Dg-diensten worden 2 maanden vooraf ingepland op elke dag behalve zondag, zonder begin- en eindtijd. Minimaal 4 dagen vooraf komen de tijden in het rooster.',
            'Voor de contracturen ramen we de duur: een uitvaartleider 4 uur (DG1, 1 voorgang), een uitvaartverzorger 8 uur (DG2).',
          ] },
          { soort: 'regel', tekst: 'Minimaal twee Dg-diensten per regio per dag, behalve op zondag.', regels: ['dg', 'dgzondag'] },
          { soort: 'grip', tekst: 'Heeft een regio meer Dg-diensten nodig, bijvoorbeeld drie (zoals Nijmegen), dan zet de beheerder dat onder Instellingen > Beleid bij "Dg-diensten per regio". De toets, Rooster maken en Bijsturen rekenen dan voor die regio met dat aantal.' },
          { soort: 'regel', tekst: 'Voldoende voorgaanplekken: het aantal voorgangsdiensten per dag uit de vastgestelde regelplekken (standaard 4 van 4 uur). Een DG1 telt als 1, een DG2 als 2.', regels: ['voorgangen'] },
          { soort: 'regel', tekst: 'Een uitvaartleider doet geen regelgesprekken en staat dus alleen op Dg-diensten.', regels: ['functie'] },
        ],
      },
      {
        id: '3.4',
        titel: 'Overige diensten',
        blokken: [
          { soort: 'p', tekst: 'Zijn medewerkers niet inzetbaar voor dossiergebonden activiteiten (regeldienst of Dg-dag), dan worden ze "uitgepland" met een overige dienst. Denk aan projectgroep, trainingen, OR of VMS. Hiervoor zijn de codes O, VMS, TD en OR.' },
        ],
      },
      {
        id: '3.5',
        titel: 'Flexibiliteit en formatie',
        blokken: [
          { soort: 'p', tekst: 'Flexibiliteit is nodig om afwezige collega\'s op te vangen en vanwege het onvoorspelbare werkaanbod. De werkgever kan het werk niet afschalen als er minder collega\'s zijn: het hele jaar door is hetzelfde aantal diensten nodig. Omdat het werkaanbod onvoorspelbaar is, vraag je al veel flexibiliteit; het wordt te veel om het team ook nog alle afwezigheid te laten opvangen. De werkgever houdt daar rekening mee in de formatie.' },
          { soort: 'p', tekst: 'Heb je 80 uur werk, dan heb je niet genoeg aan 80 uur contracturen: medewerkers zijn soms ziek, met vakantie, op opleiding of in overleg. De werkgever kiest voor 85% formatie in de teams: medewerkers worden zoveel mogelijk op contracturen ingeroosterd, en afwezigheid wordt grotendeels opgevangen door externen of tijdelijk meeruren van collega\'s.' },
          { soort: 'grip', tekst: 'Onder Capaciteit staat per regio en per week: bezetting min verzuim (8,5%) min verlof volgens norm (12,9%) min de te borgen uren = ruimte over. Precies zoals de vastgestelde regelplekken 2027.' },
        ],
      },
      {
        id: '3.6',
        titel: 'Hoe een uitvaartverzorger of -leider wordt ingeroosterd',
        blokken: [
          { soort: 'p', tekst: 'Het aantal benodigde diensten per dag is leidend in het rooster. Per regio wordt berekend wat dit voor het team betekent, met de norm per uitvaart, het aantal medewerkers en de contractgroottes.' },
          { soort: 'regel', tekst: 'Medewerkers worden maximaal op contracturen ingepland.', regels: ['contract'] },
          { soort: 'regel', tekst: 'Team: niet twee weekenden achter elkaar (weekendgroepen). Dit is een teamafspraak, geen beleid; uit te zetten onder Instellingen.', regels: ['omhetweekend'] },
        ],
      },
      {
        id: '3.7',
        titel: 'Roosterproces',
        blokken: [
          { soort: 'stappen', stappen: [
            'Plan volgens het benodigde aantal regelplekken op de dag. Je plant nooit meer of minder dan de afgesproken regelplekken in.',
            'Het uitgangspunt is 1 regelplek per uitvaartverzorger per dag. Plan naast standaard diensten ook minimaal 1 middag/avonddienst en 1 beschikbaarheidsdienst.',
            'Plan elke dag minimaal 2 Dg-dagen als aanvulling op regelplekken (behalve zondag): administratie, voorgaan en ander dossiergebonden werk.',
            'Zorg voor voorwaartse rotatie in het rooster: eerst de regelplekken, dan de Dg-dagen inplannen.',
            'Medewerkers worden maximaal op contracturen ingepland.',
            'Zijn medewerkers ziek, met vakantie of op opleiding en zijn er geen andere opties, zet dan 2 maanden vooraf al een ZZP\'er in het rooster.',
          ] },
          { soort: 'grip', tekst: '"Rooster maken" in GRIP volgt deze volgorde letterlijk: middag/avonddienst, standaard regeldiensten, beschikbaarheidsdienst, zo nodig een 2, dan Dg-diensten tot de voorgangen gedekt zijn, en tot slot aanvullen tot contracturen. De clusterflex uit versie 1.3 vervalt.' },
        ],
      },
      {
        id: '3.8',
        titel: 'Zoeken naar werk',
        blokken: [
          { soort: 'p', tekst: 'Uitvaartverzorgers staan met een begin- en eindtijd op het rooster. Wil je werken, dan ziet de werkgever de ingeplande dienst van begin- tot eindtijd als werktijd. Heb je geen regelgesprek of voorgang, of daarnaast nog ruimte, doorloop dan deze stappen:' },
          { soort: 'stappen', stappen: [
            'Eigen werkzaamheden, zoals het uitwerken van een regelgesprek of administratie bijwerken.',
            'Vraag collega\'s of ze ondersteuning nodig hebben.',
            'Vraag de RA of er nog extra ondersteuning nodig is.',
            'LaBora bijwerken voor de regio.',
          ] },
        ],
      },
      {
        id: '3.9',
        titel: 'Dagsturing bij een tekort aan regelplekken',
        blokken: [
          { soort: 'p', tekst: 'Zijn er meer meldingen in de regio dan regelplekken ingepland, handel dan volgens dit stroomschema:' },
          { soort: 'stappen', stappen: [
            'Kijk naar het cluster of naar buurregio\'s: kunnen zij meldingen overnemen?',
            'Zo niet: kijk naar uitvaartverzorgers die op een Dg-dag staan en schaal deze in overleg op als dat kan. Dit kan ook een extra regeling op een regeldag zijn. Let op: vrij is vrij.',
            'Niet mogelijk? Zet een ZZP\'er in voor een meldplek.',
            'Geen ZZP\'ers inzetbaar? Verplaats de melding naar een volgende dag.',
          ] },
          { soort: 'grip', tekst: 'Onder Bijsturen vergelijkt GRIP het rooster met de laatste voorspelling en stelt per dag precies deze acties voor, getoetst op ATW en beleid. De stap "clusterflex inzetten" uit versie 1.3 vervalt.' },
        ],
      },
    ],
  },
  {
    nr: 4,
    titel: 'Verlof, vakanties en feestdagen',
    paragrafen: [
      {
        id: '4.1',
        titel: 'Proces vakantieplanning',
        blokken: [
          { soort: 'p', tekst: 'In de schoolvakanties kijken we niet alleen naar de regio, maar ook naar het cluster. Als regio ben je onderdeel van een groter geheel en mede verantwoordelijk dat zoveel mogelijk medewerkers in het cluster op hun gewenste moment op vakantie kunnen. Door op clusterniveau te kijken kun je ook externen een aantrekkelijk rooster bieden voor een langere periode.' },
          { soort: 'tabel', kop: ['Juni tot en met september', 'Oktober tot en met mei', 'Actie'], rijen: [
            ['3e week okt. t/m 17 nov.', '3e week mei t/m 17 jun.', 'Team maakt een verantwoorde vakantieplanning'],
            ['17 nov.', '17 jun.', 'Vakantieaanvragen binnen bij de analist'],
            ['4e week nov.', '4e week jun.', 'Analist maakt analyse en advies op clusterniveau'],
            ['1e week dec.', '1e week jul.', 'Analist geeft advies aan cluster- en regiomanager'],
            ['2e week dec.', '2e week jul.', 'Regiomanager in gesprek met het team over aanpassingen'],
            ['17 dec.', '17 jul.', 'Goedkeuring of afkeuring van vakantieaanvragen'],
            ['1e week mrt.', 'n.v.t.', 'Eerste versies rooster (alleen juli en augustus)'],
          ], noot: 'De data zijn een advies voor de clusters; het proces staat vast. In GRIP stel je de data per vakantieronde zelf in.' },
          { soort: 'grip', tekst: 'Onder Verlof en voorkeuren loopt dit proces als vakantieronde: aanvragen, analyse met advies per aanvraag, advies, gesprek en besluit. Het advies komt uit de verlofruimte per week (zie 4.3), in schoolvakanties ook op clusterniveau.' },
        ],
      },
      {
        id: '4.2',
        titel: 'Kaders',
        blokken: [
          { soort: 'lijst', items: [
            'In de schoolvakanties vinden geen planbare niet-dossiergebonden werkzaamheden plaats, met uitzondering van het opleiden van nieuwe medewerkers.',
            'Wie buiten de schoolvakanties op vakantie gaat, kan de extra uren die in de schoolvakanties worden gewerkt op een zelf gekozen moment buiten de schoolvakanties opnemen als vrije tijd (als alternatief voor uitbetalen).',
            'De roosters van juli en augustus worden tegelijk en eerder gemaakt: 4 maanden vooraf, na het vakantieproces.',
            'Naast externen kan een regio medewerkers die in de schoolvakantie op vakantie gaan, vragen om in de weken dat ze er wél zijn extra te werken, zodat zoveel mogelijk medewerkers op vakantie kunnen. Lukt dat niet, dan kunnen minder medewerkers of medewerkers minder lang op vakantie in de schoolvakantie.',
          ] },
        ],
      },
      {
        id: '4.3',
        titel: 'Verlofruimte (in GRIP)',
        blokken: [
          { soort: 'p', tekst: 'Hoeveel verlof er in een week kan, volgt uit de vastgestelde regelplekken. Per regio per week:' },
          { soort: 'lijst', items: [
            'Te borgen uren = (regelplekken min beschikbaarheidsdiensten) x 8 uur + beschikbaarheidsdiensten x 2 uur + voorgangsdiensten x 4 uur (6 dagen) + het aandeel in de clusterspeling.',
            'Verlofruimte = bezetting (contracturen van het team) min verzuim volgens norm (8,5%) min de te borgen uren.',
            'Goedgekeurd verlof gaat er eerst af. Een aanvraag past als er in alle weken genoeg ruimte over is; in schoolvakanties mag het cluster helpen.',
          ] },
          { soort: 'grip', tekst: 'Omdat de meldingen een seizoenspatroon hebben, is er in de zomer meer verlofruimte dan in de winter. Over het hele jaar komt de ruimte uit op ongeveer de verlofnorm van 12,9%.' },
        ],
      },
    ],
  },
  {
    nr: 5,
    titel: 'Taken en verantwoordelijkheden',
    paragrafen: [
      {
        id: '5.1',
        titel: 'Wie doet wat',
        blokken: [
          { soort: 'tabel', kop: ['Taak', 'Verantwoordelijk'], rijen: [
            ['Jaarlijks analyseren hoeveel regelplekken er per regio nodig zijn.', 'Tactisch planner'],
            ['Een jaar vooruit kijken naar knelpunten in de planning.', 'Tactisch planner'],
            ['Adviseren over formatieopbouw en externe inzet op landelijk, cluster- en teamniveau.', 'Tactisch planner'],
            ['Zorgen voor genoeg formatie om binnen budget te blijven en het rooster in te vullen.', 'Regiomanager'],
            ['Vakantieplanning en efficiënt inzetten van flexibiliteit.', 'Regiomanager'],
            ['Met het team het rooster maken (teamroosteren), als de regio daarvoor kiest.', 'Uitvaartverzorgers en -leiders'],
            ['Het rooster van de regio maken en bijhouden: diensten zetten, wensen en voorkeuren verwerken, ruilen en bijsturen.', 'Planner (regio)'],
            ['Toetsen van het rooster volgens het roosterbeleid, met een advies aan de regiomanager (groen, oranje of rood).', 'Planneradviseur'],
            ['Beheren van GRIP en de uitleg erin (de stukken "in GRIP" in dit beleid).', 'Planneradviseur'],
            ['Goedkeuren van het rooster.', 'Regiomanager'],
            ['Diensttijden in het gepubliceerde rooster aanpassen binnen de kaders.', 'Uitvaartverzorger of -leider'],
            ['Beschikbaarheid openzetten binnen de kaders.', 'Uitvaartverzorger of -leider'],
            ['Inplannen van regelgesprekken.', 'Regio-assistent (9:00 tot 16:00), NBD (7:30 tot 9:00, 16:00 tot 22:30 en weekend), DU planning (22:30 tot 7:30)'],
            ['Gewerkte begin- en eindtijden registreren.', 'Uitvaartverzorger of -leider'],
            ['Goedkeuren van geregistreerde uren.', 'Regiomanager'],
            ['Rapporteren over gewerkte uren en aantal uitvaarten (maandrapportage).', 'Business controller'],
          ], noot: 'Tactisch planner, planneradviseur en planner zijn rollen, geen losse functies. Voor elke regio is er minimaal één planner met voldoende kennis van beleid, systeem en team. Het toetsen van het rooster en het advies blijven bij de planneradviseur, ook als een regio zelf planners aanwijst: zo wordt elk rooster op dezelfde manier getoetst.' },
          { soort: 'grip', tekst: 'GRIP kent hiervoor de rollen planner en regiomanager. De rol planner is voor de planneradviseur: die maakt en toetst het rooster en geeft bij elk rooster verplicht een advies: groen (goedkeuren), oranje (goedkeuren met aandachtspunten, met toelichting) of rood (niet goedkeuren, met toelichting). Alleen de planner geeft dat advies; GRIP stelt een kleur voor uit de toets. Daarna keurt de regiomanager goed of af, met het advies ernaast; goedkeuren tegen een rood advies in vraagt een toelichting. Wat vastgesteld is, blijft vastgesteld: medewerkers kunnen daarna gewoon ruilen, en ziekte, verlof, bijsturen en aanpassingen vragen geen nieuw advies. Alleen een nieuwe periode gaat opnieuw langs planner en regiomanager. De regiomanager besluit ook over verlof: losse aanvragen, de vakantieronde en verlof ruilen. Daarna publiceert de planner. Het overzicht staat onder Instellingen, bij Rollen en rechten.' },
        ],
      },
    ],
  },
  {
    nr: 6,
    titel: 'Uitleg en voorbeelden',
    paragrafen: [
      {
        id: '6.1',
        titel: 'Dienst en beschikbaarheidsdienst',
        blokken: [
          { soort: 'p', tekst: 'Vanuit de ATW is er een plicht tot het maken van een rooster en het registreren van begin- en eindtijden. Met roosters creëer je meer voorspelbaarheid in een onvoorspelbare situatie, bijvoorbeeld in hoe je contracturen zich verhouden tot het ingeplande werk.' },
          { soort: 'lijst', items: ['Dienst: werktijd, betaald door de werkgever (onderdeel van je contracturen).', 'Beschikbaarheidsdienst: alleen werktijd als de werkgever je vraagt iets te doen.'] },
          { soort: 'p', tekst: 'Een dienst staat met een standaard begin- en eindtijd in het rooster en geldt als werktijd. Heb je een dienst maar geen regelgesprek of voorgang, dan besteed je de tijd zo goed mogelijk; de regiomanager of RA kan je ook vragen werk op te pakken. Je houdt eigen regie: de enige harde eis is de afgesproken openstelling voor regelplekken, omdat jouw beschikbaarheid de voorspelbaarheid van de roosters van je collega\'s bepaalt.' },
        ],
      },
      {
        id: '6.2',
        titel: 'Voorbeelden',
        blokken: [
          { soort: 'lijst', items: [
            'Standaard dienst 9:00 tot 17:00. Om 9:00 nog geen melding, je kiest ervoor nog even een boek te lezen. Om 11:00 een regelgesprek, daarna werk je tot 17:00. Je registreert 11:00 tot 17:00: een werkdag van 6 uur.',
            'Standaard dienst 9:00 tot 17:00. Om 9:00 geen melding; je vraagt de RM waar je kunt helpen, maar er is niets. Om 11:00 een regelgesprek, daarna tot 17:00. Je registreert 9:00 tot 17:00: je hebt actief naar werk gezocht, een werkdag van 8 uur.',
            'Dg-dienst 9:00 tot 17:00. Je gaat voor en werkt administratie bij tot 19:00. Je registreert 9:00 tot 19:00: een werkdag van 10 uur. De regiomanager ziet erop toe dat dit alleen gebeurt als het nodig is.',
            'Beschikbaarheidsdienst: je bent van 12:00 tot 19:00 beschikbaar. Je doet een regelgesprek van 14:00 tot 17:00 en registreert 3 uur werktijd. De rest is eigen tijd. Eigen werk afmaken mag alleen als het echt nodig is, zeker in het weekend vanwege de toeslag.',
          ] },
        ],
      },
    ],
  },
];

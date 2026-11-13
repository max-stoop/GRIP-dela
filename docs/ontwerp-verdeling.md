# Ontwerp: meldingen verdelen over de regelplekken

*Voorstel, oktober 2026. De rekenkern staat in `lib/verdeling/`. In GRIP staat onder **Verdelen** de eerste stap ervan (meldingen om 07:00 verdelen, § 13) en de simulatie van de nachtelijke verdeling.*

## In het kort

Elke nacht om 00:00 verdeelt GRIP alle bekende meldingen landelijk over de regelplekken van de dag. De verdeling kiest niet zomaar de dichtstbijzijnde uitvaartverzorger, maar de goedkoopste verdeling over de hele dag. Daarbij telt alles in **minuten reistijd**:

1. **Reistijd in de dagroute.** Een ochtendgesprek begint thuis. Een middaggesprek begint waar iemand daarvoor was: het ochtendgesprek of een voorgang. De helft van de terugreis telt mee.
2. **Werkdruk.** Wie de laatste dagen veel dossiers had (naar contract), krijgt een extra dossier minder snel. Dat weegt zwaarder naarmate het er meer zijn.
3. **Ruimte voor later.** Na 00:00 komen er nog meldingen binnen. Een middagplek kan die nog opvangen, een ochtendplek die leeg blijft meestal niet. Per cluster rekenen we exact uit hoeveel tekort later op de dag te verwachten is, met de Poissonverdeling uit de voorspelling. Daarom kiest de verdeling liever iemand om 10:00 die iets verder weg woont dan iemand om 12:00: die van 12:00 houden we vrij.
4. **Regio, cluster en 1B.** Eerst de eigen regio, dan het cluster. Een 1B valt alleen als niets anders past.
5. **De familie.** Liever de ochtend, en het dagdeel dat de familie wil.

Daarnaast gelden harde eisen: één gesprek per plek, binnen de openstelling, binnen 24 uur na de melding, een voorgang blijft haalbaar, binnen de dienst, een maximale reistijd, en niet bij wie de familie niet wil.

**Reistijd: eerst gratis.** De verdeling rekent met een eigen schatting over de weg, vanaf het midden van het postcodegebied (4077 gebieden). Waar water tussen twee plekken ligt, rijdt de schatting eromheen of eroverheen: via de Westerscheldetunnel, de Zeeuwse dammen en bruggen, de Moerdijkbruggen, de Afsluitdijk en de Houtribdijk, de pont bij Maassluis, en met de veerboot naar de Waddeneilanden (§ 5.1). Dat kost niets en er gaat niets naar buiten. Later kan er live verkeer bij, van Google Routes, TomTom of een eigen OSRM-server; dat is een kwestie van een instelling (§ 5.2).

**Rekenmethode.** Eerst invoegen met spijt, dan verbeteren door te verplaatsen, te ruilen en kleine groepjes samen opnieuw in te delen, en daarna verstoren en opnieuw opbouwen. Tot slot een melding zonder plek alsnog inpassen door een andere te laten opschuiven. De verdeling begint ook vanuit "dichtstbij" en neemt de beste van de twee, dus slim is nooit slechter. Een landelijke dag kost 0,5 tot 1 seconde rekentijd, in de achtergrond, zodat de pagina blijft reageren. Op kleine gevallen controleren we tegen alle mogelijke verdelingen: de verdeling vindt dan bijna altijd het optimum en zit er nooit ver naast. Elke toewijzing heeft een uitleg met de kosten per onderdeel en het alternatief.

**Effect** in de simulatie, gemiddeld over 12 landelijke dagen: per melding bijna 2 minuten meer rijden. Daar staat tegenover: een derde van het verwachte tekort later op de dag, een derde van de meldingen buiten de eigen regio, bijna niets meer buiten het cluster, en half zo veel gesprekken bij mensen met een hoge werkdruk (zie § 9).

---

## 1. Het vraagstuk

Een melding (een overlijden) vraagt om een regelgesprek bij de familie thuis, binnen 24 uur. Regelgesprekken worden gevoerd door uitvaartverzorgers (UV) in een regeldienst: een **1**, **1M**, **2** of **1B** (beschikbaarheidsdienst). Het rooster legt per regio en dag vast hoeveel plekken er zijn. Dat aantal volgt uit de vastgestelde regelplekken: 80% dekking per regio, 95% per cluster.

De verdeling bepaalt **wie welk gesprek doet, en in welk dagdeel**. Dat heeft invloed op:

- **reistijd en kosten**: tienduizenden kilometers per jaar;
- **werkdruk**: wie het dossier krijgt, heeft er de dagen erna werk aan (uitwerken, voorgaan);
- **continuïteit op de dag**: elke plek die 's nachts wordt gevuld, is er niet meer voor een melding die om 8:00 binnenkomt;
- **de familie**: liever snel, liever 's ochtends, soms een voorkeur.

Dichtstbij kiezen werkt goed voor reistijd, maar slecht voor de rest. Het stapelt dossiers bij wie centraal woont. Het gebruikt middagplekken terwijl een ochtendplek iets verder ook kon. En het leent plekken uit andere regio's of clusters die die regio later zelf nodig heeft.

## 2. Doelen en eisen

### Harde eisen (nooit overschreden)

| Eis | Hoe |
|---|---|
| Eén gesprek per plek | Een 2 heeft twee plekken (ochtend en middag), de andere diensten één. |
| Binnen de openstelling | Het gesprek **begint** in het tijdvak van de plek (zie § 3.1). |
| Binnen 24 uur | `uiterlijk` = moment van de melding + 24 uur. |
| Voorgang en afspraken blijven haalbaar | Een gesprek ervoor moet op tijd af zijn, inclusief reistijd en marge. |
| Binnen de dienst | Vertrek niet voor het begin; het laatste gesprek is af voor het eind van de dienst. |
| Maximale reistijd | Standaard 75 minuten voor één reis. |
| Niet bij | Bijvoorbeeld op verzoek van de familie. |
| Toegezegd blijft staan | Een gesprek dat al aan de familie is doorgegeven, verandert niet meer, ook niet als het volgens het model niet (meer) past: dan staat er een waarschuwing bij. Is de plek er niet meer (ziekte), dan krijgt de melding een nieuwe plek, en dat is te zien. |

### Zachte doelen (tegen elkaar afgewogen)

Alles wordt uitgedrukt in **minuten reistijd**: hoeveel minuten extra rijden heb je ervoor over? Dat is te begrijpen, uit te leggen ("dit kost 12 minuten extra rijden, maar spaart een middagplek") en in te stellen. De standaardwaarden staan in § 11. Een planner kan ze in de simulatie aanpassen.

## 3. Het model

### 3.1 Regelplekken uit het rooster

| Dienst | Dienst | Plek(ken): begin van het gesprek | Dagdeel |
|---|---|---|---|
| 1 | 9:00–17:00 | 10:00–13:00 | ochtend |
| 1M | 11:00–19:00 | 12:00–15:00 | middag |
| 2 | 9:00–19:00 | 10:00–10:30 en 14:30–15:00 | ochtend + middag |
| 1B | 11:00–19:00 | 12:00–15:00 | middag (1B) |

**Aanname:** de openstelling uit het roosterbeleid is het tijdvak waarin een gesprek *begint*. Bij de 2 kan het niet anders: een gesprek van 2 uur past niet in een half uur. Het gesprek duurt standaard 120 minuten (instelbaar).

### 3.2 De dagroute

Per persoon rekent de verdeling de hele dag door, met de vaste afspraken (voorgang) en de toegewezen gesprekken op volgorde in de tijd:

- **Vertrek**: thuis, niet voor het begin van de dienst. Na een voorgang vertrekt iemand vanaf de plek van de voorgang. Na een ochtendgesprek vertrekt iemand vanaf dat adres. Daarmee is de regel "voor een middagmelding kijken we naar de laatste activiteit" ingebouwd.
- **Net op tijd**: wie vroeg klaar is, vertrekt niet eerder dan nodig. Dat telt mee voor de spits en voor de live reistijd op dat moment.
- **Aankomst** = vertrek + reistijd + marge (10 minuten voor parkeren en onvoorzien). Het gesprek begint bij aankomst of bij het begin van het tijdvak, wat later is. Valt dat na het tijdvak of na de 24-uursgrens, dan kan het niet.
- **Volgorde rond een voorgang**: een gesprek kan voor of na een voorgang. Alle volgordes worden doorgerekend; de goedkoopste die haalbaar is, telt.
- **Terugreis**: de reis naar huis na het laatste gesprek telt voor de helft (instelbaar). Een gesprek ver van huis aan het eind van de dag kost zo iets meer dan een gesprek op de route terug.

De **reiskosten van een toewijzing** zijn het verschil tussen de dagroute met en zonder dat gesprek. Zo telt een tweede gesprek bij iemand met een 2 alleen het stukje omrijden.

### 3.3 Werkdruk

Een regelgesprek levert een dossier op, met werk in de dagen erna. Per persoon:

- `belasting` = recente dossiers, gewogen naar hoe lang geleden: gisteren telt 1, met een halfwaardetijd van 4 dagen;
- `fte` = contracturen / 36.

Een extra dossier kost `werkdruk × ((b + k)² − b²) / fte²` minuten, met `k` het aantal gesprekken vandaag. Het kwadraat zorgt ervoor dat het tweede extra dossier meer kost dan het eerste. Zo wordt werk gespreid zonder harde grens. Door de deling door fte² is een dossier voor iemand met 24 uur ruim twee keer zo zwaar als voor iemand met 36 uur.

*Voorbeeld* (werkdruk = 3): Anouk heeft 36 uur en 1 recent dossier; een gesprek kost 3 × (4 − 1) = 9 minuten. Bas heeft 36 uur en 4 recente dossiers; een gesprek kost 3 × (25 − 16) = 27 minuten. Bas krijgt het alleen als hij meer dan 18 minuten dichterbij is (inclusief de halve terugreis).

Daarnaast kost een gesprek op de derde dag op rij of later 10 minuten per dag in de reeks.

Zolang er geen historie van verdelingen is, schat GRIP de belasting uit het rooster: de regelplekken van de afgelopen twee weken × 80% bezetting (een 1B × 25%). Zodra de verdeling draait, komen de echte dossiers ervoor in de plaats.

### 3.4 Regio, cluster, 1B en de familie

| Wat | Kosten (standaard) | Waarom |
|---|---|---|
| Buiten de eigen regio | 15 min | Regio's borgen hun eigen plekken; hulp over de grens kan, als het echt beter is. |
| Buiten het eigen cluster | +45 min | Het cluster is de eenheid van de 95%-borging. |
| Een 1B inzetten | 60 min | De 1B valt dan (een volle dienst), en de achtervang van die dag is weg. |
| Middag i.p.v. ochtend | 5 min | De familie wacht langer. |
| Afwijken van de voorkeur | 30 min | Bijvoorbeeld de familie wil 's middags. |
| Liefst bij deze persoon | −30 min | Bijvoorbeeld een eerdere uitvaart in de familie. |

### 3.5 De waarde van een vrije plek

Dit onderdeel maakt het verschil met "dichtstbij". Na de nachtverdeling komen er nog meldingen binnen:

- `No ~ Poisson(λ × aandeelOchtend)`: meldingen die nog een **ochtendplek** kunnen krijgen (vroeg in de ochtend binnen);
- `Nm ~ Poisson(λ × aandeelMiddag)`: meldingen die alleen nog een **middagplek** kunnen krijgen.

Hier is `λ` de verwachting voor het cluster op de dag, uit de voorspelling of anders de norm. Standaard is `aandeelOchtend` = 15% en `aandeelMiddag` = 35%; de rest (50%) is om 00:00 al bekend. Dit is te kalibreren op de tijdstippen van echte meldingen.

De vroege meldingen nemen eerst een vrije ochtendplek, daarna een middagplek. De latere meldingen kunnen alleen een middagplek krijgen. Bij `Fo` vrije ochtend- en `Fm` vrije middagplekken is het verwachte tekort:

```
E[S](Fo, Fm) = Σ P(No = a) · P(Nm = b) · ( max(0, a − Fo − Fm) + max(0, b − max(0, Fm − max(0, a − Fo))) )
```

Dat is exact uit te rekenen; het kost een paar honderd optellingen. Een plek vullen kost dan:

```
flexibiliteit = prijs van een tekort × ( E[S] met één vrije plek minder − E[S] nu )
```

De prijs van een tekort is standaard 90 minuten: een melding die later geen plek meer vindt, kost de planner een oplossing, en vaak een 1B of een lange reis. Hoe hoog de kosten in absolute zin zijn, maakt niet uit: alle meldingen van de nacht krijgen toch een plek. Het gaat om het **verschil** tussen een ochtend- en een middagplek, en tussen clusters met veel en weinig ruimte.

**Rekenvoorbeeld** (cluster met λ = 22 op de dag; na 00:00 nog 3,3 meldingen voor de ochtend en 7,7 voor de middag te verwachten):

| Vrij ochtend / middag | Verwacht tekort | Ochtendplek vullen | Middagplek vullen | Verschil |
|---|---|---|---|---|
| 4 / 12 (ruim) | 0,17 | 7 min | 12 min | 5 min |
| 3 / 10 | 0,65 | 24 min | 32 min | 8 min |
| 2 / 8 | 1,92 | 55 min | 62 min | 7 min |
| 2 / 4 (krap) | 5,23 | 74 min | 88 min | 14 min |
| 0 / 8 | 3,28 | n.v.t. | 77 min | |

Op een rustige dag (veel vrij) kost een plek vullen bijna niets, en wint de kortste reis. Wordt het krap, dan wordt elke plek duur. Een middagplek kost dan altijd minstens zoveel als een ochtendplek: hij kan iedereen opvangen die een ochtendplek ook kan opvangen, en meer. Iemand voor de ochtend mag in het voorbeeld dus 7 tot 14 minuten verder weg wonen, plus 5 minuten voor de familie. Precies het gedrag dat we zoeken: *liever iemand om 10:00 die net iets verder is dan iemand om 12:00, want die van 12:00 kan later nog ingezet worden.*

Omdat de kosten per cluster gelden, trekt een krap cluster minder hulp weg uit een buurcluster dat zelf ook krap is. Dat sluit aan op de manier waarop de 1B-kans al wordt berekend (eerst het cluster vol, dan pas de 1B).

### 3.6 Het doel

```
totaal = Σ personen ( extra reistijd van de dagroute + werkdruk + reeks + Σ toewijzingen (regio + 1B + familie) )
       + Σ clusters ( prijs tekort × E[S](vrije ochtend, vrije middag) )
       + 1000 × meldingen zonder plek
```

## 4. De rekenmethode

Het probleem is een toewijzing met volgordeafhankelijke kosten: wat een middaggesprek kost, hangt af van het ochtendgesprek. Daar komen nog bij een niet-lineaire werkdruk, en een clusterterm die van alle plekken samen afhangt. Een exacte oplossing kan met een MIP-solver op een server (bijvoorbeeld OR-Tools of HiGHS). Maar dat is zwaarder in beheer, moeilijker uit te leggen, en voor ~50 tot 100 meldingen per nacht niet nodig. Het voorstel is een **heuristiek die deterministisch, snel en uitlegbaar is**, getoetst tegen het exacte optimum:

1. **Kandidaten.** Per melding de 30 mensen die het dichtst bij zijn (op de schatting, vanaf huis of een afspraak), binnen de maximale reistijd. Dat houdt de rest snel. Bij live reistijd zijn het de 10 dichtstbijzijnden, om het aantal betaalde reistijden te beperken.
2. **Invoegen met spijt** (*regret insertion*). Steeds de melding die het meest verliest als hij zijn beste plek mist: het verschil tussen de beste en de op een na beste plek. Een melding in een dun bezet gebied met maar één goede optie gaat zo voor op een melding in de stad met tien opties.
3. **Verbeteren** tot niets meer helpt:
   - *verplaatsen*: een melding naar een vrije plek;
   - *ruilen*: twee meldingen wisselen, ook de ochtend en middag van één persoon met een 2;
   - *herschikken*: een melding met één of twee meldingen in de buurt samen opnieuw indelen, over hun eigen plekken en de beste vrije plekken. Dat vindt wat één stap tegelijk niet vindt, zoals twee meldingen samen naar iemand met een 2.
4. **Verstoren en opnieuw opbouwen** (*iterated local search*). Telkens een melding met de meldingen in de buurt eruit halen, met wat ruis opnieuw invoegen en verbeteren. Alleen wat beter is, blijft staan. Met een vaste seed, dus dezelfde invoer geeft altijd dezelfde verdeling.
5. **Verdringen.** Heeft een melding dan nog geen plek, dan zoekt de verdeling een bezette plek waar hij wel past, en schuift de melding die er stond door naar een andere vrije plek. Zo krijgt bijvoorbeeld een melding met een vroege 24-uursgrens de enige ochtendplek in de buurt.
6. **Ook vanuit dichtstbij.** Dezelfde verbeterstappen worden ook vanaf de dichtstbij-verdeling gedaan. De goedkoopste van de twee wint, dus slim is nooit duurder dan dichtstbij.
7. **Toegezegd blijft staan.** Meldingen met `vast` worden eerst geplaatst en daarna niet meer verplaatst.

**Kwaliteit en snelheid** (tests in `__tests__/verdeling/`):

- Op 100 willekeurige kleine gevallen (5 mensen, 4 meldingen) is elke mogelijke verdeling doorgerekend. De verdeling vindt in minstens 95% het optimum en zit nooit meer dan 10% boven het optimum.
- Op 150 willekeurige gevallen met voorgangen, 24-uursgrenzen, wensen, toezeggingen en tegenstrijdige invoer wordt elke dagroute met een eigen, onafhankelijke berekening nagelopen:
  - niets dubbel;
  - elke harde eis gehaald;
  - toezeggingen gerespecteerd;
  - het bijgehouden doel gelijk aan opnieuw uitgerekend;
  - elke keer dezelfde uitkomst;
  - een melding zonder plek past echt nergens, ook niet door een ander te laten opschuiven.
- Een landelijke dag (~150 mensen, ~160 plekken, 50 tot 100 meldingen) kost 0,5 tot 1 seconde rekentijd, in een web worker (de pagina blijft reageren) of in een serverfunctie.
- Elke toewijzing is opgebouwd uit onderdelen (reistijd, werkdruk, reeks, regio/cluster, 1B, ruimte later, familie) en wordt vergeleken met de dichtstbijzijnde andere vrije plek: "die kost 80 min meer: reistijd +37, dagen achter elkaar +40, werkdruk +3".

## 5. Reistijd

### 5.1 Eerst gratis: de schatting over de weg

Zonder aanbieder rekent de verdeling met een eigen schatting. Die kost niets, is direct, en er gaan geen gegevens naar buiten:

- **Afstand:** van het midden van het ene postcodegebied (4 cijfers) naar het andere, hemelsbreed × 1,3 voor het omrijden.
- **Snelheid:** 25 km/u voor de eerste 3 km (de bebouwde kom), 55 km/u tot 15 km, daarna 95 km/u.
- **Vaste tijd en spits:** 5 minuten vaste tijd voor parkeren en lopen, en +15% in de spits (7:00–9:30 en 16:00–18:30).

Afgesteld op bekende ritten: Amsterdam–Utrecht ~45 minuten, Den Haag–Rotterdam ~33, Maastricht–Eindhoven ~70.

**Water** (`lib/verdeling/water.ts`). Nederland is geen vlak land: hemelsbreed gaat mis waar water tussen twee plekken ligt. De schatting kent daarom:

| Water | Oversteek of omweg |
|---|---|
| Westerschelde | Westerscheldetunnel, of om via Antwerpen (de veerpont Vlissingen–Breskens neemt geen auto's mee) |
| Oosterschelde, Keeten en Krammer | Zeelandbrug, Oosterscheldekering, Philipsdam; om via Bergen op Zoom |
| Grevelingen | Brouwersdam, Grevelingendam |
| Haringvliet, Hollands Diep, Biesbosch | Haringvlietdam, Haringvlietbrug, Moerdijkbruggen, om via Keizersveer |
| Nieuwe Waterweg | Pont Maassluis–Rozenburg (15 min), of om via de Beneluxtunnel |
| IJsselmeer en Markermeer | Afsluitdijk (32 km), Houtribdijk (26 km), om via de Ketelbrug en Lemmer |
| Waddenzee | Afsluitdijk; eilanden alleen met de veerboot (Texel 35 min, Ameland en Schiermonnikoog 75, Vlieland 120, Terschelling 150, inclusief wachten) |

Kruist de rechte lijn tussen twee plekken een water, dan zoekt de schatting de kortste route over de oversteken en omwegen. De lijnen zijn op ongeveer een kilometer nauwkeurig getekend en getoetst op alle 4077 postcodemiddens: geen woonkern ligt in een meer of aan de verkeerde kant. Voorbeelden van de schatting in de daluren:

| Rit | Hemelsbreed | Schatting |
|---|---|---|
| Middelburg – Terneuzen (tunnel) | 23 km | 37 min |
| Vlissingen – Breskens (tunnel) | 6 km | 50 min |
| Den Helder – Den Burg (veerboot) | 11 km | 54 min |
| Hoorn – Lelystad (Houtribdijk) | 29 km | 48 min |
| Hellevoetsluis – Middelharnis (Haringvlietdam) | 9 km | 33 min |
| Hoek van Holland – Brielle (pont) | 8 km | 44 min |
| Amsterdam – Utrecht (geen water) | 35 km | 45 min |

Een melding op Vlieland, Terschelling of Schiermonnikoog valt zo buiten de maximale reistijd: die krijgt geen plek en gaat naar de planner. Dat is in de praktijk ook zo; daar gelden eigen afspraken.

**Wat de schatting niet weet:** het verkeer van de dag (files, ongelukken, wegwerkzaamheden), en de precieze ligging binnen een postcodegebied. Met 4 cijfers scheelt dat een paar minuten. Voor het verdelen gaat het om het *verschil* tussen kandidaten, en dat is met de schatting meestal goed genoeg.

### 5.2 Later: live verkeer

Een aanbieder met een wegennet en verkeersmodel maakt de reistijd preciezer:

- **'s nachts** (om 00:00 voor dezelfde dag): het *verwachte* verkeer op het vertrekmoment, uit historische patronen; live verkeer bestaat dan nog niet;
- **overdag** (een nieuwe melding om 10:00 voor 12:00): het *actuele* verkeer.

Wanneer is dat de kosten waard? Leg tijdens het proefdraaien (§ 10) een paar honderd gereden reistijden naast de schatting. Wijkt de schatting meer dan 10 à 15% af, of kiest de verdeling daardoor merkbaar vaak een ander, dan loont live verkeer. Anders niet.

### 5.3 Aanbieders

| | Google Routes API | TomTom Matrix Routing v2 | Eigen OSRM-server |
|---|---|---|---|
| Verkeer | Verwacht en actueel (`TRAFFIC_AWARE` + `departureTime`) | Historisch vooruit, live voor nu (`departAt`, `traffic`) | Geen; wel het wegennet (OpenStreetMap) |
| Grootte per aanvraag | Tot 625 elementen (herkomst × bestemming) | Synchroon tot 100 cellen zonder beperkingen | Onbeperkt |
| Kosten | Per element; met verkeer duurder (Pro-SKU) | Per aanvraag/cel; ruime gratis laag | Alleen de server |
| Opslaan van uitkomsten | In principe niet toegestaan (servicevoorwaarden) | Volgens contract | Vrij |
| Persoonsgegevens | Coördinaten naar Google (VS); verwerkersovereenkomst nodig | Coördinaten naar TomTom (NL/EU) | Er gaat niets naar buiten |

Alle drie zijn ingebouwd in `lib/verdeling/aanbieders.ts`. Je kiest er een met omgevingsvariabelen op de server:

```
REISTIJD_AANBIEDER = google | tomtom | osrm
REISTIJD_SLEUTEL   = de API-sleutel (google, tomtom)
REISTIJD_URL       = het adres van de OSRM-server (osrm)
```

De sleutel blijft op de server. De browser vraagt reistijden op via `/api/reistijd`. Die route is alleen voor planners en hoger, heeft een limiet per gebruiker, accepteert alleen coördinaten binnen Nederland en hoogstens 1500 paren per aanvraag. Bij OSRM komt de spitsfactor van de schatting erbovenop.

**Advies:** begin gratis met de schatting (§ 5.1). Blijkt bij het proefdraaien dat live verkeer het verschil maakt, neem dan een proefmaand bij TomTom of Google. Weegt privacy zwaarder, dan geeft een eigen OSRM-server het echte wegennet zonder verkeer, en gaat er niets naar buiten. De keuze is een open beslissing (§ 10).

Of het live werken werkt, is zonder kosten getest: de end-to-end-test bootst een aanbieder na.

### 5.4 Zo weinig mogelijk opvragen

Een volle matrix (alle mensen × alle meldingen × tijden) is onnodig duur. Daarom in twee stappen:

1. Met de tabel per melding de **10 dichtstbijzijnde mensen** kiezen. Iemand op 80 km doet nooit mee, dus daar hoeft geen live reistijd voor opgevraagd te worden.
2. Alleen voor die paren de reizen opvragen die hun dag kan hebben: van huis of de voorgang naar de melding, van melding naar melding (bij een 2), en terug naar huis. Dat gebeurt per **tijdvak**: vertrek rond 9:00 (ochtend), 12:30 (middag) en 16:30 (eind van de dag). Elke aanvraag is één bestemming met een rij herkomsten, zodat er geen overbodige cellen worden betaald.

Voor een landelijke nacht met ~60 meldingen gaat het om ongeveer **1.000 tot 2.000 reistijden**. Overdag is het per nieuwe melding ongeveer **30**.

### 5.5 Terugval en kalibratie

Ontbreekt een live reistijd (de aanbieder is onbereikbaar, of het paar is niet opgevraagd), dan neemt de verdeling de schatting (§ 5.1). Zijn er live reistijden, dan wordt de schatting bijgesteld met de mediaan van live/schatting (tussen 0,7 en 1,5). Zo zijn live en terugval vergelijkbaar en trekt geen van beide stelselmatig voor. Op de pagina staat hoeveel reistijden live waren en met welke factor de rest is bijgesteld.

### 5.6 Kosten (indicatie)

Met de schatting: **nul**. Met een aanbieder, als orde van grootte (controleer de actuele prijslijst en de gratis laag):

- 30 nachten × ~1.500 reistijden + overdag ~30 × ~50 meldingen × 30 dagen ≈ **90.000 reistijden per maand**;
- Google (met verkeer): honderden euro's per maand; zonder verkeer ongeveer de helft;
- TomTom: doorgaans aanzienlijk lager;
- OSRM: een kleine server (enkele tientjes per maand), en NL-kaartdata eens per maand verversen.

Met K = 6 in plaats van 10 kandidaten zakt het aantal met ~40%, tegen een kleine kans dat de beste kandidaat buiten de live selectie valt (die rekent dan met de gekalibreerde schatting).

### 5.7 Cache

Binnen één verdeling worden reistijden in het geheugen bewaard (per paar en tijdvak). Of het mag om reistijden langer te bewaren, bijvoorbeeld een tabel `rp_reistijd` met PC4-paren per tijdvak, hangt af van de voorwaarden van de aanbieder. Bij Google mag het niet. Bij een eigen OSRM-server kan het wel, en dan wordt de matrix van alle PC4-paren die voorkomen vanzelf compleet.

## 6. Het proces over de dag

| Moment | Wat | Wie |
|---|---|---|
| **00:00** | Nachtverdeling: alle bekende meldingen, verwacht verkeer om 9:00/12:30/16:30. Uitkomst = concept. | Automatisch (cron) |
| **07:00** | Bijwerken: de meldingen van de nacht erbij. Wat al vaststaat, blijft staan. De planner kijkt het concept na en zet vast. | Planner |
| **Na vaststellen** | Medewerkers zien hun gesprekken in *Mijn rooster*; de familie krijgt de tijd door. | GRIP / planner |
| **Overdag** | Elke nieuwe melding wordt ingevoegd met actueel verkeer. Toegezegde gesprekken blijven staan, de rest mag schuiven. De planner bevestigt. | Planner, met voorstel |
| **Uiterlijk 14:00** | Valt een 1B, dan krijgt die direct bericht. | Automatisch |
| **Ziekte op de dag** | De plekken vervallen; de meldingen die daar stonden, gaan terug in de verdeling. | Planner |

**Tijdzone:** de Logic App in Azure plant in Nederlandse tijd (W. Europe Standard Time); zomer- en wintertijd gaan dan vanzelf goed.

**De planner houdt de regie.** Een toewijzing vastzetten of handmatig wijzigen kan altijd. De verdeling rekent eromheen en laat zien wat de wijziging kost.

## 7. Gegevens en koppelingen

| Gegeven | Bron | Nu in de simulatie |
|---|---|---|
| Regelplekken en diensttijden | Rooster in GRIP | **Echt** (waar er een rooster is), anders de vastgestelde regelplekken met de clusterspeling |
| Verwachting per cluster (λ) | Voorspelling / norm | **Echt** (norm) |
| Dagen op rij met een regeldienst | Rooster | **Echt** |
| Woonpostcode medewerkers | Profiel (nieuw) | Fictief, of ingevuld op de pagina (alleen in de browser) |
| Meldingen: postcode, regio, tijdstip, wensen | Meldkamer / dossiersysteem | Fictief (Poisson uit de norm) |
| Voorgangen: tijd en plaats | Dossiersysteem | Fictief (25% van de middagdiensten) |
| Recente dossiers | Historie van de verdeling | Uit het rooster (zie § 3.3) |

Het datamodel dat de app gebruikt, staat in `azure/database/grip.sql` (`rp_verdeling` en `rp_medewerker.postcode`): per dag de meldingen (alleen de postcode van 4 cijfers, de regio en eventueel een afgesproken tijd) en wie ze doet, plus de woonplaats van een medewerker als postcode van 4 cijfers. Voorgangen en een aparte historie per verdeling zijn nog niet nodig; die komen er pas als het proces daarom vraagt.

## 8. Privacy (AVG)

Een woonadres is een persoonsgegeven. Het voorstel:

- **Doel**: alleen voor het verdelen van regelgesprekken. Grondslag: gerechtvaardigd belang of uitvoering van de arbeidsovereenkomst. Leg dit vast in het verwerkingsregister, met een korte DPIA.
- **Zo weinig mogelijk**: standaard **4 cijfers** (PC4). Dat gebied is een paar km² groot, wat in de reistijd een paar minuten scheelt; de 6 cijfers zijn alleen nodig waar het echt uitmaakt (platteland), en dan met instemming.
- **Wie ziet het**: alleen planners en hoger in de eigen regio, via RLS op een aparte tabel. Collega's zien het niet. De medewerker ziet en wijzigt zijn of haar eigen postcode in het profiel.
- **Naar de aanbieder** gaan alleen de coördinaten van het midden van het postcodegebied, zonder naam, adres of melding. Er is een verwerkersovereenkomst nodig, en bij voorkeur een aanbieder in de EU of een eigen server.
- **Bewaren**: toewijzingen met de werkdruk 1 jaar (evaluatie), daarna geanonimiseerd. Een reistijdcache bevat geen persoonsgegevens (alleen PC4-paren).
- **De familie**: van een melding is alleen de postcode nodig; die staat al in het dossier.

## 9. Wat het oplevert (simulatie)

Gemiddeld over 12 landelijke dagen (dinsdag 13 oktober 2026), met fictieve meldingen en woonplaatsen, en de gratis schatting met water:

| Per dag | Slim (verwacht) | Dichtstbij | Slim (druk, +30%) | Dichtstbij |
|---|---|---|---|---|
| Meldingen om 00:00 | 58 | 58 | 75 | 75 |
| Gemiddelde reistijd | 24,1 min | 22,2 min | 24,2 min | 23,3 min |
| Middagplekken gebruikt | 15,9 | 26,3 | 21,3 | 33,5 |
| Buiten de eigen regio | 3,8 | 11,8 | 7,2 | 16,6 |
| Buiten het eigen cluster | 0,4 | 4,9 | 1,4 | 7,5 |
| Gesprek bij hoge werkdruk | 6,6 | 12,8 | 11,6 | 16,6 |
| Verwacht tekort later op de dag | 1,5 | 4,2 | 3,5 | 7,2 |
| Rekentijd | 0,6 s | | 0,8 s | |

Per melding is dat bijna 2 minuten meer rijden, voor een dag die later veel beter op te vangen is. Die winst is groter naarmate het drukker is. Gemiddeld 0,2 melding per dag krijgt bij allebei geen plek: een melding op een Waddeneiland zonder autoveer binnen de maximale reistijd. De echte winst blijkt pas na proefdraaien met echte gegevens (§ 10).

## 10. Fasering en open beslissingen

**Fasering**

1. **Nu: de simulatie in GRIP, met de gratis schatting.** Het model, de gewichten en de uitleg zijn te beoordelen met het echte rooster en fictieve meldingen. Kosten: nul.
2. **Proefdraaien (4 weken):**
   - woonpostcodes vastleggen;
   - meldingen dagelijks importeren (CSV of koppeling);
   - de verdeling 's nachts naast de handmatige planning laten meelopen, zonder dat iemand ernaar handelt;
   - vergelijken op reistijd, tekorten, 1B-inzet, werk per persoon en hoe vaak de planner het anders had gedaan, en de gewichten bijstellen;
   - een paar honderd gereden reistijden naast de schatting leggen: is live verkeer de kosten waard (§ 5.2)?
3. **Nachtrun:** via cron, en de planner stelt om 07:00 vast. Alleen als het proefdraaien dat laat zien, komt er een live aanbieder bij, met een verwerkersovereenkomst.
4. **Overdag en koppelingen:**
   - nieuwe meldingen direct invoegen;
   - voorgangen uit het dossiersysteem;
   - gesprekken in *Mijn rooster*;
   - de werkdruk uit echte dossiers.

**Open beslissingen**

- **Live reistijd, en zo ja welke aanbieder**: voorlopig niet (de gratis schatting). Na het proefdraaien: Google, TomTom of een eigen OSRM-server, met de kosten, de verwerkersovereenkomst en of reistijden bewaard mogen worden.
- **Postcode**: 4 of 6 cijfers, de grondslag, en wie het mag zien.
- **Moment van vaststellen**: om 00:00 automatisch, of om 07:00 door de planner, en wanneer de familie de tijd hoort.
- **Gewichten**: vooral de prijs van een tekort, werkdruk, buiten de regio en de 1B. Stel ze vast na het proefdraaien.
- **Bron van de meldingen** en hoe snel die in GRIP staan; dat bepaalt hoe goed de verdeling overdag werkt.
- **Openstelling**: klopt de aanname dat het tijdvak de begintijd van het gesprek is?
- **Mag een melding naar een ander cluster**, en zo ja, wie beslist dat (nu: mag, maar kost 60 minuten)?

## 11. Parameters

| Parameter | Standaard | Betekenis |
|---|---|---|
| `maxReistijd` | 75 min | Langste enkele reis naar een gesprek. |
| `gesprekDuur` | 120 min | Duur van een regelgesprek. |
| `marge` | 10 min | Per reis, voor parkeren en onvoorzien. |
| `terugreis` | 0,5 | Hoe zwaar de reis naar huis telt. |
| `werkdruk` | 3 | Een extra dossier kost `werkdruk × ((b+k)² − b²) / fte²`. |
| `reeks` | 10 min | Per dag op rij, vanaf de derde dag. |
| `buitenRegio` | 15 min | Iemand van buiten de regio. |
| `buitenCluster` | 45 min (verdelen: 400) | Bovenop buiten de regio. |
| `inzet1B` | 60 min (verdelen: 300) | Een 1B laten vallen. |
| `tekort` | 90 min | Prijs van een melding die later geen plek meer vindt. |
| `tweedeGesprek` | 0 min (verdelen: 150) | Het tweede gesprek van iemand met een 2. |
| `aandeelOchtend` | 15% (verdelen: 5% na 07:00) | Deel van de dag dat na 00:00 komt en nog een ochtendplek kan krijgen. |
| `aandeelMiddag` | 35% (verdelen: 10% na 07:00) | Deel dat alleen nog een middagplek kan krijgen. |
| `klantMiddag` | 5 min | Middag in plaats van ochtend. |
| `voorkeur` | 30 min | Afwijken van het dagdeel dat de familie wil. |
| `liefstBij` | 30 min | Bonus voor de gewenste persoon. |
| `geenPlek` | 1000 min | Een melding zonder plek. |
| `kandidaten` | 30 | Mensen per melding die worden doorgerekend, naast iedereen uit het eigen cluster (binnen de langste reis). |

## 12. Code

| Bestand | Wat |
|---|---|
| `lib/verdeling/types.ts` | Begrippen: punt, plek, afspraak, persoon, melding, parameters, uitkomst. |
| `lib/verdeling/optie.ts` | De waarde van een vrije plek: exact verwacht tekort per cluster. |
| `lib/verdeling/verdeel.ts` | Dagroute, kosten, invoegen, verbeteren, verstoren, verdringen; *dichtstbij* ter vergelijking; kengetallen. |
| `lib/verdeling/uitleg.ts` | Uitleg per toewijzing met het alternatief. |
| `lib/verdeling/geo.ts`, `pc4.json` | Postcodes, afstand en de schatting. |
| `lib/verdeling/water.ts` | Water, oversteken en eilanden in de schatting. |
| `lib/verdeling/reistijd.ts` | Live met terugval: tijdvakken, benodigde paren, kalibratie, ophalen via de server. |
| `lib/verdeling/aanbieders.ts` | Google Routes, TomTom, OSRM (alleen op de server). |
| `app/api/reistijd/route.ts` | De server-route met toegang, limiet en controle. |
| `lib/verdeling/invoer.ts` | Van rooster naar plekken; de landelijke simulatie. |
| `lib/verdeling/werk.ts`, `worker.ts`, `client.ts` | Een verdeling in de achtergrond (web worker), met uitleg. |
| `lib/verdeling/dag.ts` | Een echte dag verdelen: plekken en vaste tijden per dienst, invoer van de planner, werkdruk uit eerdere verdelingen, de kans dat de 1B nog valt. |
| `app/(app)/verdeling/page.tsx`, `components/verdeling/` | Verdelen (de dag) en Simulatie. |
| `__tests__/verdeling/` | Tests van model, optimum, invarianten (willekeurige gevallen), water, reistijd, aanbieders, route, achtergrond en simulatie. |

## 13. Nu in GRIP: meldingen verdelen om 07:00

De eerste stap, zonder voorgangen. Om 07:00 vult de planner van elke melding de postcode van de familie in (4 cijfers) en verdeelt alle meldingen van de dag in één keer. Dezelfde rekenkern als hierboven, met:

- **Plekken uit het rooster van die dag** en vaste begintijden:

  | Dienst | Tijdvak | Gesprek om |
  |---|---|---|
  | 1 | 10:00 tot 13:00 | 10:00 of 13:00 |
  | 1M | 12:00 tot 15:00 | 13:00 |
  | 2 | 10:00 tot 10:30 en 13:00 tot 15:00 | 10:00 en 13:00 |
  | 1B | 12:00 tot 15:00 | 13:00 |

  Is met de familie een andere tijd afgesproken (per half uur van 10:00 tot 15:00), dan moet die in het tijdvak van de plek vallen.
- **Woonplaats** als postcode van 4 cijfers bij de medewerker (`rp_medewerker.postcode`); zonder postcode begint de reis in het midden van de regio.
- **Werkdruk** uit de bewaarde verdelingen van de afgelopen 14 dagen (halfwaarde 4 dagen); voor een dag zonder verdeling geschat uit het rooster (een regelplek telt als 0,8 dossier, een 1B als 0,25).
- **Volgorde van plekken**:
  1. een eerste plek (een 1, een 1M, of het eerste gesprek van een 2) in de regio van de melding;
  2. een eerste plek elders in het cluster;
  3. het tweede gesprek van iemand met een 2;
  4. de 1B (eigen regio, dan cluster);
  5. een ander cluster.

  Dat zit in de kosten: het tweede gesprek kost 150 minuten (`tweedeGesprek`), de 1B 300 (`inzet1B`), een ander cluster 400 (`buitenCluster`). Elke stap kost zo meer dan de langste reis (75 minuten) plus de voorkeur voor de eigen regio in de stap ervoor, dus de volgorde geldt altijd. Binnen een stap wegen reistijd en werkdruk samen. Het tweede gesprek telt bij het latere gesprek van die persoon; een 2 met één gesprek om 13:00 is gewoon een eerste plek.
- **Ruimte voor later**: wat na 07:00 nog binnenkomt, standaard 5% van de verwachte meldingen van de dag op tijd voor 10:00 en 10% alleen nog voor 13:00 (instelbaar). De verwachting komt uit de laatste voorspelling (bijvoorspellen), anders uit de vastgestelde regelplekken.
- **Doorgeven** zet de gesprekken vast. Opnieuw verdelen (een melding die later binnenkomt, een andere tijd) laat ze staan; een gesprek vrijgeven kan altijd.

**Kans dat de 1B nog valt.** Per cluster tellen we de vrije plekken na de verdeling: alleen om 10:00 (de ochtendplek van een 2), om 10:00 of 13:00 (een 1 zonder gesprek), alleen om 13:00 (1M, de middagplek van een 2) en de vrije 1B's. Later komen er nog No meldingen die 10:00 halen en Nm die alleen 13:00 halen, beide Poisson. De late nemen eerst een plek die alleen om 13:00 kan, dan een die allebei kan; de vroege eerst een plek die alleen om 10:00 kan, dan wat over is. Zo krijgen zoveel mogelijk meldingen een gewone plek (een grootste koppeling). Wat overblijft, valt op een 1B. De kans dat dat minstens één keer gebeurt, staat naast de kans volgens het rooster (`lib/rooster/kans1b.ts`), die nog de hele dag moest afdekken. Na het verdelen is die kans daarom veel kleiner.

**Opslag**: `rp_verdeling`, per dag één JSON met de meldingen (id, PC4, regio, eventueel de tijd) en de toewijzingen (wie, welke plek, begintijd, reistijd, doorgegeven). Lezen en schrijven alleen de planningsrollen (RLS); live bij collega's. Geen adres en geen naam van de familie. Datamodel: `azure/database/grip.sql`.

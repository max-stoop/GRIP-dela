# Hoe GRIP werkt

Uitleg per onderdeel van GRIP: wat het doet, hoe het rekent en welke regels het toetst. Voor installeren, uitrollen en de techniek: zie de [README](../README.md).

## Inhoud

- [Onderdelen](#onderdelen)
- [Rollen, gebruikers en veilig opslaan](#rollen-gebruikers-en-veilig-opslaan)
- [Hoe de voorspelling werkt](#hoe-de-voorspelling-werkt)
- [Diensten volgens het roosterbeleid](#diensten-volgens-het-roosterbeleid)
- [Capaciteit en verlof](#capaciteit-en-verlof)
- [Vaststellen, publiceren en lopende zaken](#vaststellen-publiceren-en-lopende-zaken)
- [Bijsturen](#bijsturen)
- [Nabestaandendesk (NBD)](#nabestaandendesk-nbd)
- [Meldingen verdelen](#meldingen-verdelen)
- [AI-roosterassistent](#ai-roosterassistent)
- [Rooster maken uit voorkeuren](#rooster-maken-uit-voorkeuren)
- [Toets, cijfer en analyse](#toets-cijfer-en-analyse)
- [Wat de tests controleren](#wat-de-tests-controleren)

## Onderdelen

Navigatie via een inklapbare zijbalk, met de **werkregio** (die op elke pagina meegaat), tellers voor wat er open staat, en **zoeken met Ctrl+K of /**: naar pagina's, regio's, medewerkers, acties en elke paragraaf van het roosterbeleid. Op de telefoon klapt de zijbalk uit als lade.

**Testomgeving.** Rechtsboven staat voor planners, regiomanagers en de beheerder de knop **Test**: die geeft een kopie van alle gegevens (alle regio's en de NBD) om te zien hoe een rooster werkt. Alles in de test blijft in deze browser, in een eigen opslag; er gaat niets naar de gedeelde database en wijzigingen van collega's komen er niet in. Een gestreepte balk bovenaan laat zien dat je in de test werkt, met *Opnieuw beginnen* (weer een kopie van de echte gegevens), *Demo laden* (alle regio's en de NBD) en *Terug naar echt* (de test wordt weggegooid). Vernieuwen houdt de test, uitloggen vergeet hem. In de test werken het voorbeeldteam, de demo en de back-up zoals in de lokale modus; gebruikers beheren kan er niet.

| Onderdeel | Voor wie | Wat |
|---|---|---|
| **Dashboard** | planner, regiomanager, beheerder | Voor de beheerder en de planner het hele land; voor de regiomanager het cluster van de werkregio (links kiest die ook *Landelijk*). De keten in vier stappen (voorspellen, rooster, bijvoorspellen en bijsturen, verdelen), met *Actie nodig* bij een stap die nu iets vraagt; de **drukte** 30, 60, 90 of 150 dagen vooruit (voorbij de voorspelling van 61 dagen de vastgestelde regelplekken, in grijs; de keuze blijft bewaard in de browser); **Roosters per maand**: per regio de komende vier maanden met de vaststelling (advies nodig, bij de regiomanager, vastgesteld, afgekeurd), het roostercijfer en het advies van de planner, elk vakje opent dat rooster; een **maandkeuze** voor het gemiddelde roostercijfer met de vier doelen (continuïteit, efficiency, medewerkers, klanten) en de regiotabel; actiepunten (ziek, tekort, overtreding ATW/CAO, bijsturen, verlof, ruilen, vakantieronde, publicatie te kort, verlofruimte, roosters juli en augustus), een overzicht per cluster en per regio. De toets zegt *Voldoet*, *Voldoet, met aandachtspunten*, *Te weinig regelplekken* of *Overtreding ATW/CAO*; goed- en afkeuren doet alleen de regiomanager. |
| **Voorspelling** | planner, regiomanager, beheerder | Samenvatting in gewone taal; grafiek van 61 dagen met 80%-band, basismodel en roosterbasis; per dag de bijdrage van elke factor en hoe de verwachting verschoof over de runs; **waarom zoveel plekken** per regio en dag, met een eigen dagkeuze tot een jaar vooruit (na de 61 dagen volgens de vastgestelde regelplekken) (hoe vaak er genoeg is met één plek minder of meer, en per plek hoe vaak hij valt voor een melding uit de eigen regio of uit een andere regio in het cluster; de 1B voor de eigen of een andere regio); **uitleg in vier stappen** met de kansverdeling (wat vangen vaste plekken, 1B en het cluster op); heatmap per regio met clusterdekking; **hoe goed voorspellen we** (voorspeld tegenover werkelijk, nauwkeurigheid per afstand); begrippenlijst. Export naar Excel en PDF. |
| **Rooster** | planner, regiomanager, beheerder | We roosteren per kalendermaand: grid per regio per maand (vorige, volgende, deze maand), met vaste voorkeuren en wensen in de vakjes en per vakje welke regel het breekt (rood = ATW/CAO, oranje = beleid). Uitvaartverzorgers staan bovenaan, uitvaartleiders onderaan; met de pijltjes naast een naam schuift de planner iemand binnen die groep omhoog of omlaag (ook in de download). Onder het rooster van een regio staan steeds in beeld: regelplekken gepland en afgesproken, Dg gepland (en wat de regio moet), en voor het hele cluster gepland, afgesproken en de Dg's (en wat het cluster moet). **Cluster**: per regio van het cluster per dag de geplande regelplekken onder elkaar, met onderaan het clustertotaal, wat het cluster moet (de regio's samen plus de clusterspeling voor 95%), het verschil, de Dg's en de kans dat een 1B valt. Toetsen tegen de roosterbasis, de laatste voorspelling of de vastgestelde regelplekken. **Rooster maken**: aanvullen of opnieuw plannen uit de voorkeuren: één voorstel volgens het beleid, met een andere verdeling als je wilt. **Verbeteren**: eigen controle met acties en de AI-roosterassistent. **Analyse**: de vier doelen met details per medewerker. Klik in de voet op het aantal afgesproken plekken of de kans op een 1B van een dag voor de uitleg per plek. **Vaststellen per maand**: advies van de planner, goedkeuring door de regiomanager, met de geschiedenis van elke maand. Publiceren (elke maand 2 maanden vooraf), PDF en **jaarrooster downloaden** in het eigen format: per cluster één werkmap met per regio een rooster (NHN, NHM, AMS, SR …) en een urenblad, met de telregels, clusterregels, feestdagen- en weekendteller en de kleuren van de jaarroosters. Zonder namen: elke medewerker is een regel als AMS 01. |
| **NBD (nabestaandendesk)** | planner, regiomanager, beheerder; medewerkers van de NBD | Een losse module met een eigen menu (`/nbd`), open van 7:00 tot 22:30, die bij de regio's nergens staat. Rekent zoals de capaciteitsplanning NBD 2026 (gesprekken per uur, Erlang C per uur, capaciteit per week), beweegt mee met de overlijdens van de regio's, met voorkeuren per uur, maximale inzet, diensten met pauze, een toets op ATW en CAO, automatisch roosteren en bijsturen. Zie hieronder. |
| **Bijsturen** | planner, regiomanager, beheerder | Per dag gepland tegenover de roosterbasis en de laatste voorspelling, met acties volgens het stroomschema dagsturing: Dg opschalen, extra regeling (1 wordt 2), vrije collega inplannen (in overleg binnen 28 dagen), buurregio, verplaatsen; bij te veel een 2 terug naar 1 of een regeldienst naar Dg. Elke actie is vooraf getoetst. Ziekmeldingen en herstel, logboek. |
| **Verdelen** | planner, regiomanager, beheerder | De laatste stap van de keten: om 07:00 alle meldingen van de dag in één keer naar de juiste uitvaartverzorgers. Per melding alleen de postcode van de familie (4 cijfers), de regio volgt uit de postcode; één voor één of als geplakte lijst. Gesprekken om 10:00 of 13:00, of een afgesproken tijd. Een vaste volgorde van plekken: eerst een eerste plek (1, 1M, het eerste gesprek van een 2) in de eigen regio en dan in het cluster, dan het tweede gesprek van een 2, dan de 1B, en pas daarna een ander cluster; binnen elke stap reistijd (vanaf de woonplaats van de uitvaartverzorger) en werkdruk samen. Bovenaan de pagina staat dat in gewone taal. Per melding wie, wanneer, in welke stap en waarom; per cluster de **kans dat de 1B nog valt** na de verdeling, naast de kans volgens het rooster, met uitleg. **Doorgeven** zet de gesprekken vast; opnieuw verdelen (voor een melding die later binnenkomt) laat ze staan. Daarnaast de **Simulatie** met fictieve meldingen. Voorgangen plannen we hier (nog) niet. |
| **Team** | planner, regiomanager, beheerder | Per medewerker wat je in één maandrooster niet ziet: gewerkte weekenden dit kalenderjaar (max 26, § 1.4), meeste 1B in 28 dagen (max 14, § 1.2), uren tegenover contract, feestdagen, Dg-aandeel (rotatie), verlof en ziekte; met signalen en de spreiding over het team. Externen en ZZP'ers apart. |
| **Capaciteit** | planner, regiomanager, beheerder | De uitleg bij de vastgestelde regelplekken (vanuit de voorspelling door te klikken; na de 61 dagen van de voorspelling rekent ook het rooster hiermee) en de keten uit de vastgestelde regelplekken 2027: volume, meldingen per dag, regelplekken (80% per regio, inclusief 1B), te borgen uren (plekken, 1B, voorgangen, clusterspeling) en de ruimte na verzuim en verlof, per regio en per week. Bezetting uit de begroting of uit de teams in GRIP. |
| **Beleid** | iedereen | Het roosterbeleid in de app, met per regel hoe de gekozen regio er de komende acht weken voor staat, en de wijzigingen voor 2027. Elke bevinding in de app verwijst naar de paragraaf. |
| **Verlof en voorkeuren** | iedereen | Medewerkers vullen vooraf een vast weekpatroon in (graag, liever niet, kan niet), ochtend of middag, de dubbele dienst (2) en een maximum aantal dagen per week, zetten wensen per datum en vragen verlof aan, met direct een advies (past, krap, past in het cluster, past niet). Planners lopen de **vakantieronde** door (aanvragen, analyse, advies, gesprek, besluit), openen per maand een **voorkeurenronde** en beoordelen verlof met zicht op de dekking per dag. |
| **Jaarplanning verlof** | iedereen | Het hele kalenderjaar per regio in ISO-weken: per medewerker wanneer er verlof is (goedgekeurd of aangevraagd), per week de **verlofruimte** uit de vastgestelde regelplekken (genoeg, krap, te weinig), de schoolvakanties, feestdagen en de **mijlpalen van het vakantieproces** (§ 4.1 en § 4.2). Per medewerker de weken verlof in schoolvakanties, of er zomervakantie was (dit jaar en vorig jaar) en de open aanvragen. **Verlofrecht en verlofsaldo staan bewust niet in GRIP**: die verschillen per medewerker en lopen via de personeelsadministratie. Signalen: weken met meer verlof dan ruimte, zomervakanties die niet eerlijk over de jaren verdeeld zijn, en de rustigste weken om verlof te plannen. Klik op een week om verlof te plannen, goed te keuren of in te trekken. Medewerkers zien hun eigen verlofjaar (volgend verlof, open aanvragen) met de ruimte in het team en vragen vanuit de kalender aan. Daaronder de verlofruimte per week, per regio of per cluster. |
| **Ruilen** | iedereen | Dienst aanbieden, ruilen met een collega of overnemen, en **verlof ruilen**: twee collega's ruilen hun goedgekeurde verlofperiodes en nemen in beide periodes elkaars rooster over, zodat de bezetting gelijk blijft. Elke ruil wordt getoetst (ATW, CAO, beleid, uren, dekking) en daarna door de planner goedgekeurd. |
| **Mijn rooster** | medewerker | Volgende dienst, uren deze week, wat er in de laatste publicatie is veranderd, het rooster van deze en volgende maand (of verder als dat al gepubliceerd is) met bij een 1B de kans dat hij valt en per dag een infoteken met de plekken van die dag, de lopende voorkeurenronde, berichten en export naar de eigen agenda (.ics). |
| **Bronnen en model** | beheerder | Meldingenhistorie uploaden (Excel .xlsx of CSV; een bestand met alleen de laatste dagen vult aan, vervangen is een bewuste keuze), bronnen verversen, de **vastgestelde regelplekken opnieuw berekenen** uit de eigen meldingen (seizoen en weekdag vanaf twee en één jaar historie, per regio de correctie op het volume van de laatste 52 weken; eerst zien wat er verandert, dan overnemen; de begroting blijft staan), kalibreren en backtesten, griepsignaal invoeren, factoren en alle runs. |
| **Instellingen** | beheerder | Roosterbeleid per onderwerp (regelplekken, Dg, ATW en CAO, uren en capaciteit, teamafspraken), weging van de vier doelen, de **vastgestelde regelplekken** (parameters en per regio, met de correctie op het volume), **schoolvakanties** (ophalen bij rijksoverheid.nl of zelf invoeren), diensten, **rollen en rechten**, back-up en herstel. |

## Rollen, gebruikers en veilig opslaan

Rollen komen uit de bestaande kolom `users.rol`:

- `Planner` of `Beheerder` → **beheerder**: richt de app in (bronnen, model, normen, beleid, schoolvakanties, back-up) en ziet alles. Als achtervang kan de beheerder adviseren of goedkeuren, maar nooit allebei voor dezelfde maand (vier ogen).
- *Regio Manager* of clustermanager → **regiomanager**: alles wat de planner kan behalve het advies, plus het rooster goedkeuren of afkeuren en besluiten over verlof (losse aanvragen, de vakantieronde en verlof ruilen), binnen de eigen regio's.
- andere rollen met *Planner* of *Manager* → **planner**: voorspelling, rooster maken en toetsen, **het advies geven (groen, oranje of rood) en aanbieden**, publiceren, bijsturen, dienstruilen goedkeuren en verlof invoeren als aanvraag (zet de beheerder onder Instellingen *Ook de planner besluit over verlof* aan, dan besluit de planner ook over verlof, net als de regiomanager), altijd in **alle regio's** (een planner plant landelijk; `users.regios` telt niet). Alleen de planner geeft het advies.
- overige rollen → **medewerker**: eigen rooster, verlof aanvragen, voorkeuren, wensen en ruilen.

Zo blijven maken, adviseren en goedkeuren gescheiden, zoals § 5.1 van het beleid vraagt. De database legt vast met welk werkaccount het advies is gegeven en weigert dat hetzelfde account die maand goedkeurt of afkeurt, welke rol het ook heeft. De verdeling staat op één plek (`lib/rechten.ts`), is te zien onder Instellingen bij **Rollen en rechten**, en wordt in de database met RLS afgedwongen. Waar een knop ontbreekt, zegt de app wie het doet.

**Veilig opslaan.** Met de gedeelde database gaat elke opslagbeurt in één transactie: alles of niets (`rp_bewaar`), ook een grote import (in delen klaargezet, samen verwerkt). Elke rij heeft een versie en wordt bij het opslaan vergrendeld; heeft een collega dezelfde dienst, hetzelfde verlof of dezelfde verdeling intussen gewijzigd, ook op precies hetzelfde moment, dan wordt niets overschreven en zie je de nieuwste stand. Is de database niet bijgewerkt, dan bewaart de app niets. Een roostervoorstel en een actie bij Bijsturen worden vlak voor het toepassen gecontroleerd op wijzigingen sinds ze zijn berekend. De dagelijkse voorspelling draait elke ochtend op de server (`/api/taken/dagelijks`), met een status bij *Bronnen en model*: volledig geslaagd (alle bronnen actueel), geslaagd met verouderde of ontbrekende bronnen (welke staat erbij), of mislukt. Was een bron niet bereikbaar (een storing), dan probeert de taak het na een uur opnieuw, tot 12:00; de nieuwe voorspelling vervangt die van eerder die ochtend. Alleen verouderde gegevens (wel opgehaald) geven vandaag geen nieuwe poging. In de tabel van de bronnen staat per bron tot wanneer de gegevens lopen.

**Bewaartermijnen (AVG).** De dagelijkse taak op de server ruimt elke ochtend op wat langer staat dan nodig (`rp_opruimen` in `azure/database/grip.sql`): het logboek, wensen en afgehandelde ruilen na 400 dagen, ziekmeldingen 400 dagen na herstel, rooster, gepubliceerd rooster, diensttijden en verlof van vóór vorig kalenderjaar, de verdeling van meldingen (postcodes) na 90 dagen, en wie uit het team is zodra er geen rooster, verlof of ziekte meer van staat. Een lopende ziekmelding blijft. De termijnen zijn een voorstel om af te stemmen met de functionaris gegevensbescherming. Wat er is opgeruimd, staat in het logboek bij de dagelijkse voorspelling. Collega's zien elkaars e-mailadres en afstandsverklaring niet.

De beheerder beheert de gebruikers in de app (**Instellingen → Gebruikers**): toevoegen met het e-mailadres van het werkaccount, rol en regio's aanpassen (een planner en de beheerder hebben altijd alle regio's), weghalen. Een regiomanager heeft precies de regio's die je kiest; *Alle regio's* zet ze allemaal in de lijst. Zonder regio's heeft een regiomanager geen toegang (de database geeft dan ook niets); bij het inloggen staat dat erbij. Wie inlogt zonder rij in `users`, krijgt geen toegang. Een werkaccount koppelt bij de eerste keer inloggen op e-mailadres. Iemand van buiten de eigen Entra ID krijgt bij het toevoegen een uitnodiging van Microsoft per e-mail (als gast: alleen inloggen, geen rechten in Azure); bij wie nog niet ingelogd heeft, stuurt de envelop de uitnodiging opnieuw. Daarvoor heeft de app-registratie eenmalig de toepassingsmachtiging *User.Invite.All* nodig (zie `azure/README.md`); zonder die machtiging staat de gebruiker er wel in en zegt de melding dat de uitnodiging met de hand moet.

## Hoe de voorspelling werkt

Eén model, met per afstand tot de doeldatum andere informatie:

    log λ(dag | uitgiftedatum) = log λ_basis + Σ β · factor

Het basismodel is een Poisson-regressie per regio met Fourier-seizoen (K = 2), weekdag en feestdagen, en tijdsweging met een halfwaardetijd van 400 dagen. Feestdagen worden berekend (Pasen, Hemelvaart, Pinksteren, Koningsdag, Bevrijdingsdag in lustrumjaren), dus het model werkt ook na 2027. Een regio heeft minstens een jaar meldingen nodig voor een eigen seizoenmodel: met minder (bijvoorbeeld een nieuwe regio) staat die bij de run als notitie en rekenen rooster en bijsturen voor die regio met de vastgestelde regelplekken. Het landelijke niveau van de afgelopen week en vier weken telt alleen de regio's met een model, en alleen de dagen waarop een regio een aantal heeft.

| Factor | Bron | Gebruikt tot | Startwaarde |
|---|---|---|---|
| Niveau afgelopen 4 weken | eigen meldingen | 61 dagen, dempt (45 d) | 0,50 |
| Niveau eigen regio (16 weken, t.o.v. het land) | eigen meldingen | 61 dagen, dempt niet | 1 (gedempt met 60 meldingen naar het landelijke niveau) |
| Landelijke sterfte | CBS 70895ned | 61 dagen, dempt (45 d) | 0 |
| Seizoensverwachting temperatuur | ECMWF via Open-Meteo | dag 17 tot 61 | −0,8% per °C (winter), +0,8% (zomer) |
| Drukte afgelopen week | eigen meldingen | dempt (21 d) | 0,40 |
| Hitte | Open-Meteo, per regio | 16 dagen | +2% per °C boven 25 |
| Kou | Open-Meteo, per regio | 16 dagen | +1% per °C onder 5 (14 dagen) |
| Fijnstof en ozon | Open-Meteo CAMS | 5 dagen | +0,7% per 10 µg PM2.5 |
| Rioolwater COVID | RIVM | dempt (21 d) | +1,5% per verdubbeling |
| Griep | Nivel, handmatig | dempt (21 d) | +3% per 50 consulten |

Benodigde plekken per regio zijn het 80%-kwantiel van de Poisson-verdeling. De clusterdekking is de kans dat de plekken van een cluster samen genoeg zijn als regio's elkaar helpen; het doel is 95%. Beide niveaus zijn instelbaar.

Het eigen niveau per regio vangt groei of krimp van een regio op die het basismodel maar langzaam volgt. Het telt landelijk op tot ongeveer nul en zit daarom niet in de kalibratie (die schat op de landelijke reeks).

**Terugtest voor morgen.** Op de voorspellingspagina staat per cluster en regio wat we morgen verwachten, hoeveel het op 9 van de 10 dagen hoogstens wordt en de plekken. Daarnaast staat hoeveel de voorspelling voor morgen er het afgelopen halfjaar naast zat: opnieuw gerekend op de eigen historie, alsof het elke ochtend opnieuw was: meldingen t/m gisteren, hetzelfde model, en van de bronnen alleen wat die ochtend bekend was (weer en lucht t/m gisteren, rioolwater met een week publicatievertraging, geen seizoensverwachting). Gemeten weer van na die ochtend telt niet als "verwachting"; zo is de terugtest eerder iets te streng dan te gunstig. Ernaast staat wat een perfect model zou halen: dat zit per regio ongeveer even ver ernaast, omdat het per dag grotendeels toeval is hoeveel meldingen er komen. Schommelt een cluster meer dan toeval (de regio's zijn vaker tegelijk druk), dan rekent "hoogstens" met die gemeten schommeling (negatief binomiaal).

Elke run wordt bewaard (maximaal 60). De run waarop het rooster wordt gemaakt leg je vast als **roosterbasis**; het rooster wordt daar standaard tegen getoetst. **Kalibreren** schat de factoren op de eigen historie (startwaarden als prior) en backtest het laatste jaar op 4 en 45 dagen vooruit, met dezelfde regel: alleen wat op de dag van de voorspelling bekend was. De weersverwachtingen van toen zijn niet bewaard; hitte, fijnstof, ozon en de seizoensverwachting worden daarom niet geschat en houden hun startwaarde. De dagelijkse run (zoals de 06:00-taak van het prototype) draait in Azure elke ochtend op de server; in lokale modus bij het eerste gebruik van de dag.

Het rekenwerk draait in een web worker, zodat de pagina blijft reageren. De bronnen worden op de server opgehaald (`app/api/bronnen`), zodat er geen CORS-problemen zijn en de Open-Meteo-sleutel geheim blijft.

## Diensten volgens het roosterbeleid

| Code | Dienst | Tijd | Uren (planning) | Regelplekken | Voorgangen |
|---|---|---|---|---|---|
| 1 | Standaard regeldienst | 9–17 | 8 | 1 | |
| 1M | Middag/avonddienst | 11–19 | 8 | 1 | |
| 2 | Twee regelplekken | 9–19 | 10 | 2 | |
| **1B** | **Beschikbaarheidsdienst** | 11–19 | **2** (valt ongeveer 1 op de 4 keer; de Excel van 2027 rekende met 3 van de 8) | **1** | |
| DG1 | Dossiergebonden, kort | tijden 4 dagen vooraf | 4 | | 1 |
| DG2 | Dossiergebonden | tijden 4 dagen vooraf | 8 | | 2 |
| O, OR, VMS, TD | Overige diensten | 9–17 | 8 | | |
| O4 | Overige dienst, kort (halve dag) | 9–13 | 4 | | |
| V, Z | Verlof, ziek | | | | |

Een uitvaartleider (UL) doet geen regelgesprekken: alleen DG1, DG2 en overige diensten. Oude codes worden bij het laden omgezet: B wordt 1B, DG wordt DG2.

Nieuw in 2027 (in de app verwerkt):

- de clusterflex vervalt;
- een regio mag op een dag maximaal twee keer een 2 plannen, als er dan nog minstens twee enkele regeldiensten (1 of 1M) staan, zodat ziekte op de dag kan worden opgevangen;
- de 1B telt mee als regelplek; de uren zijn gewogen zoals hierboven;
- de regelplekken per regio komen uit de vastgestelde regelplekken 2027.

## Capaciteit en verlof

De berekening is precies die van de Excel *Nieuwe vastgestelde regelplekken 2027*; `__tests__/capaciteit/norm.test.ts` controleert alle 25 regio's × 52 weken.

    meldingen/dag  = (natura + cbs × vrije markt) × trend × correctie / 365 × (1 + amplitude × (seizoen − 1)) × weekdagindex
    regelplekken   = 80%-kwantiel van Poisson(meldingen)            (inclusief de 1B)
    clusterspeling = 95%-kwantiel van het cluster − som van de plekken, naar rato verdeeld
    te borgen uren = (plekken − 1B) × 8 + 1B × 2 + voorgangen × 6 dagen × 4 + speling
    ruimte         = bezetting (fte × 40, per kwartaal) − verzuim 8,5% − verlof 12,9% − te borgen uren
    verlofruimte   = bezetting − verzuim − te borgen uren

**Verlofruimte per week** is wat er na goedgekeurd verlof overblijft. Een aanvraag krijgt een advies:

**Na een goedgekeurd rooster gaat vrij nemen via een ruil.** Is het rooster goedgekeurd en gepubliceerd, dan kan een medewerker voor een dag waarop hij staat ingeroosterd geen verlof meer aanvragen: de app verwijst naar Ruilen (de dienst aanbieden of ruilen met een collega). De database bewaakt dat ook. Op een dag zonder dienst, of na de gepubliceerde periode, kan aanvragen gewoon. Wie plant kan verlof nog wel invoeren, bijvoorbeeld bij bijzonder verlof.

- *past*: in alle weken blijft er meer dan 8 uur over;
- *past krap*: het past, maar de ruimte is daarna bijna op;
- *past in het cluster*: in een schoolvakantie mag het cluster helpen;
- *past niet*.

Bij een vakantieronde gaat voor wie minder verlof in schoolvakanties had, daarna wie eerder aanvroeg. De data van de vakantieronde stel je per ronde in; het proces volgt § 4.1 van het beleid.

**Jaarplanning.** Per regio en per kalenderjaar (ISO-weken; 2026 heeft er 53):

    werkdag verlof    = contract / 5 uur (ma t/m vr)
    week vol / krap   = ruimte − goedgekeurd − aangevraagd < 0 / < 32 uur
    schoolvakantieweek = minstens 3 werkdagen verlof in een week van een schoolvakantie
    zomervakantie     = minstens een week (5 werkdagen) verlof in de zomervakantie

Verlofrecht en verlofsaldo rekent GRIP niet uit: die verschillen per medewerker (leeftijdsdagen, contractwijzigingen, meegenomen uren) en staan in de personeelsadministratie. De verlofnorm van 12,9% gebruikt GRIP alleen voor de capaciteit van het team, zoals in de Excel van de vastgestelde regelplekken.

**Cluster en feestdagen.** Onder de jaarkalender staat het cluster: per regio per week hoeveel mensen weg zijn, gekleurd naar de ruimte die er dan over is. Schoolvakanties staan met hun regio (noord, midden, zuid). Op de pagina Team staat per medewerker welke feestdagen hij werkte of ingeroosterd staat, met het totaal per jaar; dat aantal staat ook bij *Vakanties eerlijk verdeeld* in de jaarplanning.

De mijlpalen komen uit de vakantierondes in GRIP; waar geen ronde in de buurt ligt, staan de data die het beleid adviseert (17 juni en 17 juli voor oktober tot en met mei, 17 november en 17 december voor de zomer, en de roosters van juli en augustus 4 maanden vooraf). De standaard schoolvakanties lopen van de kerstvakantie 2025 tot en met de kerstvakantie 2027 en zijn indicatief; haal de officiële data op onder Instellingen.

## Vaststellen, publiceren en lopende zaken

We roosteren **per kalendermaand**. Elk maandrooster gaat in vier stappen naar de medewerkers (§ 5.1): de planner toetst, de planner geeft een **advies** en biedt aan, de regiomanager keurt goed (alleen die rol kan dat), daarna publiceren. Op de roosterpagina staat per maand waar die is (vastgesteld, bij de regiomanager, afgekeurd, advies nodig), met de geschiedenis van elk advies en besluit.

Het beleid vraagt het rooster van een maand **2 maanden vooraf** te publiceren: op 6 oktober staat het t/m december online. De termijn (in maanden) staat onder Instellingen. Publiceren sluit altijd aan op wat er al staat, zodat er geen gat in het gepubliceerde rooster zit; elke maand die erbij komt, moet vastgesteld zijn.

**Het advies is verplicht bij elk maandrooster** en alleen de planner geeft het:

| Advies | Betekent | Toelichting |
|---|---|---|
| Groen | Goedkeuren: voldoet aan ATW, CAO en beleid en dekt de afgesproken plekken | optioneel |
| Oranje | Goedkeuren met aandachtspunten: een krappe dag, een afwijking van het beleid, wensen die niet passen | verplicht |
| Rood | Niet goedkeuren: tekorten of risico's die de planner niet binnen het team kan oplossen | verplicht |

GRIP stelt een kleur voor uit de toets: rood bij overtredingen van ATW of CAO, 2 of meer plekken te weinig op een dag, 3 of meer dagen tekort of een cijfer onder de 6; oranje bij een of twee dagen tekort, punten uit het beleid of een cijfer onder de 7,5; anders groen. De planner kiest zelf; wijkt die af, dan ziet de regiomanager dat. Goedkeuren tegen een rood advies in kan, maar vraagt een toelichting; afkeuren ook. Bij de goedkeuring ziet de regiomanager ook het cijfer van de toets nu, als dat afwijkt van het cijfer bij het advies, en goedkeuren kan niet zolang het rooster een overtreding van ATW of CAO heeft. Wie het advies gaf, keurt niet zelf goed of af (vier ogen). In de database is het advies een verplichte kolom die alleen de planner kan zetten, staat de vaststelling per regio per maand (`rp_goedkeuring`), legt de database elke stap zelf vast (`rp_goedkeuring_stap`, niet te wijzigen) en kan publiceren verder vooruit alleen voor vastgestelde maanden.

**Vastgesteld blijft vastgesteld.** Na advies en goedkeuring kunnen medewerkers gewoon ruilen, en ziekte, verlof, bijsturen en eigen aanpassingen van de planner in een vastgestelde maand vragen geen nieuw advies of goedkeuring: de planner publiceert ze. Is het rooster na het advies maar vóór de goedkeuring nog aangepast, dan ziet de regiomanager dat, maar een nieuw advies is niet nodig. Elke nieuwe maand gaat één keer langs planner (advies) en regiomanager (goedkeuring); wordt die afgekeurd, dan blijven de maanden ervoor gewoon vastgesteld. Lopende zaken die de planner al beoordeelt (ziekte, goedgekeurd verlof, goedgekeurde ruilen en bijsturen) gaan meteen ook het gepubliceerde rooster in, zodat medewerkers ze zien. Advies en goedkeuring verplicht stellen of uitzetten kan onder Instellingen.

**Diensttijden.** De ATW vraagt dat begin- en eindtijden 4 dagen vooraf bekend zijn. Bij Dg-diensten leg je ze later vast: in Bijsturen (met de termijn per dienst) of door de medewerker zelf in Mijn rooster. Vastgelegde tijden tellen mee in de toets (12 uur rust, maximaal 12 uur per dienst), in Rooster maken en in de agenda-export; in het rooster zijn ze gestippeld onderstreept.

**Externen.** ZZP'ers en externen staan **voorlopig niet in het rooster**, in de regio's en bij de NBD: ze staan niet in de roosters, overzichten, ruilen en verlof, Bijsturen stelt ze niet voor en het teamscherm toont de keuze niet. Het kenmerk blijft bestaan; met `ZZP_IN_ROOSTER` in `lib/rooster/types.ts` gaat het weer aan. Dan telt een externe kracht mee in de dekking maar niet in de formatie of de medewerkertevredenheid, plant Rooster maken externen niet zelf in en stelt Bijsturen bij een tekort een vrije externe voor (§ 3.9).

## Bijsturen

Het rooster wordt gemaakt op de roosterbasis. Elke dag komt er een nieuwe voorspelling. De pagina Bijsturen zet per dag naast elkaar:

- wat er gepland is;
- wat de roosterbasis vroeg;
- wat de laatste voorspelling vraagt;
- wie er ziek is.

Daarbij staan acties in de volgorde van het stroomschema dagsturing (§ 3.9). Elke actie is vooraf getoetst met dezelfde ruiltoets. Binnen 28 dagen is vrij vrij: een vrije dag inzetten kan alleen in overleg. Binnen 4 dagen geldt dat ook voor andere begin- en eindtijden. Toepassen past het rooster aan, schrijft een regel in het logboek en stuurt de betrokkenen een bericht.

## Nabestaandendesk (NBD)

De nabestaandendesk neemt de gesprekken van het hele land aan, **elke dag van 7:00 tot 22:30**. Het is een **losse module** met een eigen menu onder `/nbd` (Overzicht, Rooster, Bijsturen, Team, Voorkeuren per uur, Verlof, Jaarplanning verlof, Ruilen, Capaciteit en Erlang). Wie bij de regio's en de NBD werkt, wisselt met de schakelaar bovenin de zijbalk; wie alleen bij de NBD hoort, komt meteen in de NBD. Bij de regio's staat de NBD nergens: niet in de werkregio, niet op de rooster-, bijsturen-, team-, verlof-, ruil-, jaarplannings- en capaciteitspagina's, en niet in het dashboard, de voorspelling, de verdeling en de regelplekken (een oude link met `?regio=NBD` gaat naar de pagina in de module). De rollen zijn dezelfde; een regiomanager of medewerker krijgt de NBD als regio bij Gebruikers, planners en de beheerder hebben hem altijd. Een medewerker van de NBD ziet zijn eigen rooster, verlof en voorkeuren per uur en ruilen, zonder het roosterbeleid van de regio's.

**Rekenwijze: zoals de capaciteitsplanning NBD 2026.**

    gesprekken in een gewone week, per weekdag en per uur (7:00-8:00 ... 21:00-22:00, 22:00-22:30), samen 1.703
      x de overlijdens van die dag / een gemiddelde dag op die weekdag         de correlatie met de regio's
        (roosterbasis, laatste voorspelling of het gemiddelde jaar uit de vastgestelde regelplekken)
      x het NBD-volume / het volume van de regio's                            1 met de startwaarden
      -> Erlang C per uur: 90% binnen 90 seconden, 700 seconden per gesprek, naar boven afgerond, minstens 2
      -> uren aan de telefoon per dag (het laatste halfuur telt half)

Een gewone week geeft zo precies de tabel *Benodigde uren* van de capaciteitsplanning: maandag 102,5 uur, dinsdag 97,5 ... zondag 82,5, samen **663,5 uur**. De NBD doet meer gesprekken per overlijden dan de regio's meldingen, maar beweegt mee met dezelfde overlijdens: drukker in de voorspelling (sterfte, griep, weer, seizoen) is meer gesprekken.

**Capaciteit per week (tabblad Capaciteit NBD 2026).** Bruto (de contracturen) min verlof, ziekte (5% van bruto) en overig verlof en langdurig verzuim (32 uur) geeft de beschikbare werkuren; min training (een half uur per medewerker), pauze (2% van bruto), afspraken (40), taken (40) en klachten geeft *netto beschikbaar*. Daartegenover *netto benodigd*: 92% van de Erlang-uren van die week. Het verschil (zonder het verlof zelf) is het verlof dat te geven is; de jaarplanning en het advies bij een aanvraag rekenen daarmee. Met een team van 935,2 contracturen en 40 medewerkers is netto beschikbaar 737,7 uur, net als in het rekenblad. Ook met de **maximale inzet**: bij een variabel rooster mag iemand meer uren dan het contract (standaard 4), in te stellen per medewerker.

**Voorkeuren per uur.** Elke medewerker geeft per weekdag en per uur aan: graag, kan niet of geen voorkeur, zo nodig apart voor even en oneven weken (zoals *Gap wens en benodigd*), snel in te vullen met een dienst (vroeg 7:00-15:30, dag 9:00-17:30, laat 14:00-22:30, avond 17:00-22:30). Rooster maken plant nooit op uren die niet kunnen en zoekt de graag-uren op. Bij *Voorkeuren per uur* ziet de planner per medewerker de graag-uren tegenover het contract, en per weekdag en uur hoeveel mensen er graag werken min hoeveel er nodig zijn.

**Uitproberen.** Met de knop *Test* rechtsboven werk je op een kopie in je eigen browser; daar (en in de lokale modus) kun je ook een voorbeeldteam neerzetten, met contracturen, maximale inzet en voorkeuren per uur. In de gedeelde database komt geen verzonnen team.

**Diensten.** Bij de NBD staat er in een vakje *in lijn* (code `N`), verlof of vrij; de diensten van de regio's (1, 1M, 2, Dg) horen er niet bij. Elke dienst heeft een begin, een eind en een pauze. De pauze telt niet als werktijd en is geen tijd aan de telefoon. Een dienst duurt 3 tot 9 uur werk; bij meer dan 5,5 uur werk hoort 30 minuten pauze (ATW), bij meer dan 10 uur 45.

**Training, klachten en de maandstart.** Dat zijn **taken in een dienst** (kolom `taken` in `rp_tijd`): tijdens een taak zit de medewerker niet aan de telefoon, maar het is wel werktijd. In het rooster staan ze als T, K en M in het vakje, in het dagbeeld in de balk, en de medewerker ziet ze bij de dienst in Mijn rooster. Met de knop **Taken** in het rooster:

- **Training en klachten**: training per medewerker per week (standaard het halve uur uit de capaciteitsplanning) en klachten in uren per week voor het team, in blokken van hoogstens een uur, binnen een venster (standaard 9:00 tot 17:00 op werkdagen) en eventueel alleen bij wie klachten behandelt. GRIP zet ze op de **rustigste momenten**: in de diensten die er staan, waar zonder die medewerker nog genoeg mensen aan de telefoon zitten volgens Erlang C, en verspreid over de dagen en de mensen. Je ziet vooraf wat het kost aan service level. Wat er al staat telt mee: opnieuw inplannen vult alleen aan; weghalen kan per soort. Rooster maken plant de training meteen mee.
- **Zoek beste tijd voor de maandstart**: in drie groepen (instelbaar), in de eerste week of twee weken van de maand, zo dat **iedereen één keer geweest is** met zo weinig mogelijk mensen te weinig aan de telefoon, groepen van ongeveer gelijke grootte en zo vroeg mogelijk in de maand. Wie op die momenten net niet werkt, krijgt een voorstel om de dienst te verschuiven (zelfde lengte en pauze, getoetst op ATW en CAO). Per groep zie je de dag, de tijd, wie erbij is en het service level van die dag ervoor en erna.

Taken gaan mee als een dienst verandert (zolang ze passen), maar niet bij een ruil: die horen bij de medewerker. De toets meldt een taak buiten de dienst, in de pauze of over een andere taak.

**Toets (ATW en CAO).** Hard: tijden bij elke dienst, de dienstlengte, de pauze, 11 uur rust tussen twee diensten, de wekelijkse rust (36 uur aaneengesloten, of 72 uur in twee weken in delen van minstens 32 uur), hoogstens 60 uur per week en de vrije weekenden uit de CAO. Let op: pauze in het eerste of laatste uur, buiten de openingstijden, meer dan 5 dagen achter elkaar, meer dan de maximale inzet of het contract, uren die niet kunnen, of een dag met een verlofaanvraag. Per dag het verwachte service level; het cijfer weegt continuïteit (dekking tegen Erlang), efficiency, medewerkers (wensen, voorkeuren per uur) en klanten (service level).

**Automatisch roosteren.** Per dag, van vroeg naar laat: waar Erlang meer mensen vraagt dan er staan, komt een dienst die het tekort zo lang mogelijk dekt. Wie hem krijgt, hangt af van de voorkeuren per uur (nooit op uren die niet kunnen; een dienst die eindigt waar de graag-uren eindigen), wensen, het maximum aantal dagen per week en hoe ver iemand achterloopt op de contracturen, altijd binnen de ATW en de CAO. Boven het contract (tot de maximale inzet) alleen als het tekort anders niet te dekken is. Daarna worden diensten ingekort waar te veel mensen staan, komt de pauze op het rustigste moment, en wordt aangevuld tot de contracturen op de drukste momenten (uit te zetten). Aanvullen laat bestaande diensten staan; opnieuw plannen maakt de periode opnieuw.

**Bijsturen, zoals bij de regio's.** De keten in vier stappen (voorspellen, rooster, bijvoorspellen, bijsturen), per dag de uren aan de telefoon: gepland tegenover wat Erlang C vraagt volgens de roosterbasis en volgens de laatste voorspelling, met het service level. Tekort is een dag onder het service level of met meer dan een uur te weinig; te veel is een dag waarop de bijvoorspelling minder vraagt en er minstens een korte dienst te veel staat. De acties volgen dezelfde gedachte als het stroomschema dagsturing, eerst wat het minst vraagt van de medewerkers:

| Situatie | Acties, in volgorde |
|---|---|
| Te weinig | 1. pauze of een taak (training, klachten) naar een rustiger moment in dezelfde dienst, 2. een dienst verlengen (aan het eind of het begin, binnen 9 uur werk, 11 uur rust en de maximale inzet; niet in uren die de medewerker niet kan, liefst in de graag-uren), 3. een vrije medewerker inplannen (niet bij een open verlofaanvraag), 4. een externe kracht inzetten (voorlopig niet), 5. terugbellen op een rustiger moment van de dag |
| Te veel | 1. een dienst inkorten (minstens 3 uur werk), 2. iemand vrij geven als de dekking zonder kan |

Elke actie is vooraf getoetst op de ATW en de CAO (een harde overtreding valt af, "let op" staat erbij), met het service level van de dag ervoor en erna. Binnen 28 dagen kan een vrije dag inzetten of iemand vrij geven alleen in overleg, binnen 4 dagen ook andere tijden. Per dag is het dagbeeld (dekking per kwartier en de diensten) uit te klappen.

**Verder zoals de regio's, maar in de eigen module:** vaststellen per maand (advies en goedkeuring, met de tijden in de vingerafdruk), publiceren, een voorkeurenronde, wensen (met de avond), verlof met de verlofruimte uit de capaciteitsplanning (de NBD hoort bij geen cluster en heeft geen vakantierondes), ziekte melden en herstel (de diensten komen terug met hun tijden), en ruilen: de tijden en de pauze gaan mee met de dienst, en de toets kijkt naar de ATW en de CAO van wie de dienst krijgt.

## Meldingen verdelen

**Verdelen** is de vierde stap van de keten: voorspellen, rooster, bijsturen (met bijvoorspellen), verdelen. Om 07:00 vult de planner van elke melding de postcode in en verdeelt alles in één keer (`lib/verdeling/dag.ts`):

- **Plekken uit het rooster van die dag**: een 1 heeft één gesprek om 10:00 of 13:00 (tijdvak 10:00 tot 13:00), een 1M en een 1B om 13:00 (12:00 tot 15:00), een 2 om 10:00 en om 13:00. Een afgesproken tijd moet in het tijdvak vallen.
- **Woonplaats** van de uitvaartverzorger als postcode (4 cijfers), bij de medewerker; zonder postcode begint de reis in het midden van de regio.
- **Volgorde van plekken**: eerst een eerste plek in de eigen regio, dan elders in het cluster, dan het tweede gesprek van een 2, dan de 1B, en pas daarna een ander cluster. Elke stap kost meer dan de langste reis in de stap ervoor (tweede gesprek 150, 1B 300, ander cluster 400 minuten), zodat de volgorde altijd geldt. Binnen een stap wegen reistijd en werkdruk samen, met de eigen regio als voorkeur (15 minuten).
- **Werkdruk** uit de bewaarde verdelingen van de afgelopen twee weken; voor een dag zonder verdeling een schatting uit het rooster.
- **Kans dat de 1B nog valt**: per cluster de vrije plekken na de verdeling (om 10:00, om 13:00, of allebei) tegenover wat na 07:00 nog binnenkomt (Poisson, standaard 5% van de verwachte meldingen van de dag op tijd voor 10:00 en 10% alleen nog voor 13:00, in te stellen).
- **Bewaard** in `rp_verdeling` (per dag één JSON, alleen PC4, regio en tijd; geen adres of naam) en live bij collega's.

Het ontwerp staat in [`ontwerp-verdeling.md`](ontwerp-verdeling.md). De rekenkern weegt:

- de reistijd in de dagroute (vanaf huis, of na een ochtendgesprek of voorgang vanaf die plek);
- de werkdruk (recente dossiers naar contract);
- de ruimte die later op de dag nodig is (exact verwacht tekort per cluster);
- regio, cluster, de 1B en de wens van de familie.

Alles telt in minuten reistijd. Het tabblad **Simulatie** onder Verdelen simuleert een nachtelijke verdeling (om 00:00) van een landelijke dag met het echte rooster en fictieve meldingen, en zet de slimme verdeling naast *dichtstbij*, met uitleg per melding en instelbare gewichten.

- **Reistijd** is standaard gratis: een schatting over de weg vanaf het midden van het postcodegebied (`lib/verdeling/pc4.json`, 4pp, MIT). Waar water tussen twee plekken ligt, rijdt de schatting om (`lib/verdeling/water.ts`): tunnels, dammen, bruggen en veerboten. Live verkeer kan erbij via Google Routes, TomTom of een eigen OSRM-server (`REISTIJD_AANBIEDER`, `REISTIJD_SLEUTEL`, `REISTIJD_URL`), via `app/api/reistijd`.
- **Rekenen** gebeurt in een web worker, zodat de pagina blijft reageren.
- **Datamodel**: `rp_verdeling` en `rp_medewerker.postcode` in `azure/database/grip.sql`.

## AI-roosterassistent

In het rooster opent **Verbeteren** twee onderdelen:

- **Eigen controle.** Werkt altijd. Toont de harde overtredingen en de dagen die niet kloppen, met de acties van Bijsturen.
- **AI-roosterassistent.** Stuurt het rooster naar een AI-model in Azure OpenAI (`app/api/ai/rooster`, sleutel op de server; alleen voor ingelogde planners, regiomanagers en beheerders, met een limiet van 20 vragen per uur per gebruiker en 200 in totaal):
  - Namen gaan niet mee; medewerkers heten M1, M2, enzovoort.
  - Het antwoord volgt een vast JSON-schema: een samenvatting, wat goed gaat, risico's met paragraaf, en concrete wijzigingen.
  - Elk voorstel gaat in de browser door de eigen toets. Voorstellen met een nieuwe ATW-overtreding kun je niet kiezen. Je ziet per voorstel en voor de gekozen set wat het cijfer wordt.

## Rooster maken uit voorkeuren

1. **Voorkeurenronde.** De planner opent een ronde voor een maand met een deadline (standaard de eerste maand na wat al gepubliceerd is). Medewerkers krijgen een bericht en vullen in:
   - een vast weekpatroon: graag, liever niet of kan niet;
   - ochtend of middag;
   - de dubbele dienst (2): graag, maakt niet uit of liever niet. *Kan niet* is een harde grens en zet alleen de planner of regiomanager (de database bewaakt dat);
   - korte Dg-dagen (DG1, 4 uur): wie zijn uren over meer dagen spreidt, bijvoorbeeld 32 uur in 5 dagen, krijgt bij het aanvullen DG1 in plaats van DG2;
   - even of oneven weekenden, en 2 of 3 regelplekken per weekend (3 is minder weekenden; in een gewerkt weekend krijgt die medewerker dan liefst de 2);
   - een maximum aantal dagen per week;
   - wensen per datum, per maand tot een jaar vooruit. Tik op een dag en kies de wens, of haal hem weg. De planner kan wensen in de eigen regio's ook wijzigen en weghalen, bijvoorbeeld als hij meekijkt als medewerker.
     - De wensen: wil graag werken, liever ochtend, liever middag, liever vrij of *geen voorkeur*. Geen voorkeur is iets anders dan niets invullen: je laat weten dat het voor die dag niet uitmaakt.
     - **Overige dienst (8 uur of 4 uur)**: heb je die dag al ander werk (training, overleg), dan geef je dat op. De roostermaker zet er dan een overige dienst (O, 8 uur) of een korte overige dienst (O4, 4 uur): die telt mee in je uren en er komt die dag niets anders bij. In het team tel je die dag als "heeft een overige dienst".
     - **Standaard overnemen**: tik op het weeknummer om je vaste weekpatroon in die week te zetten (graag wordt *wil graag werken*, liever niet en kan niet worden *liever vrij*, de rest *geen voorkeur*). Alleen lege dagen worden ingevuld; dagen in het verleden en met (aangevraagd) verlof blijven leeg. Daarna pas je alleen de dagen aan die deze week anders zijn. *Week leegmaken* haalt de wensen van die week weer weg.
     - **Je team**: bij elke dag staat hoeveel collega's in je regio al hebben opgegeven dat ze willen werken (ook een dagdeel), liever vrij zijn of geen voorkeur hebben, en hoeveel nog niets hebben ingevuld. Zo zie je waar het knelt en kan het team onderling schuiven. Een medewerker ziet alleen aantallen, geen namen en geen opmerkingen (`rp_wensen_team` in de database); ZZP'ers en wie uit dienst is tellen niet mee.
     - Een wens voor een datum gaat voor het weekpatroon van die weekdag: wie op een dag die normaal *liever niet* of *kan niet* is toch wil werken (of *geen voorkeur* kiest), kan die dag worden ingeroosterd. *Liever vrij* op een dag die niet kan, blijft *kan niet*.

   Daarna dienen ze in. De planner ziet wie al heeft ingediend.
> De actuele beschrijving van Rooster maken staat in `docs/Opzet-roosteren-GRIP.docx` (versie 12 november 2026). Waar de tekst hieronder daarvan afwijkt (de grens per week boven contract, het eigen maximum aantal dagen per week), geldt dat document.

2. **Rooster maken.** Lege vakjes aanvullen, of de hele maand opnieuw plannen. Je krijgt **één voorstel volgens het roosterbeleid** (`lib/rooster/voorstel.ts`, `lib/rooster/maak.ts`). In de volgorde waarin het weegt:
   - *Staat vast*: goedgekeurd verlof en ziekte; bij aanvullen ook alle bestaande diensten; diensten van ZZP'ers (die plant de planner zelf, ze tellen wel mee voor de dekking).
   - *Regels waar het voorstel nooit van afwijkt* (ATW, CAO, beleid):
     - de functie, en een weekdag die iemand niet kan (tenzij hij voor die datum zelf een wens opgaf om te werken);
     - minimale rust, maximaal 6 diensten achter elkaar en de weekuren tot het contract;
     - de weekendgroep, niet twee weekenden achter elkaar, maximaal 3 regelplekken per weekend en 26 vrije weekenden per jaar;
     - maximaal 14 keer 1B per 28 dagen;
     - nooit meer regelplekken dan afgesproken; hoogstens twee keer een 2 per dag, met minstens twee enkele regeldiensten; wie de 2 niet kan, krijgt hem niet.
   - *Alleen als er echt niemand anders is*: inroosteren tegen een wens "liever vrij" of boven iemands maximum aantal dagen per week in, en pas daarna op een dag waarvoor **verlof is aangevraagd** maar nog niet beoordeeld (dat staat apart bij de uitkomst).
   - *De volgorde van het werk*:
     1. eerst alle regelplekken van de hele periode (1M, 1 en de 1B), de weekenden eerst omdat daar de minste mensen kunnen. Laag voor laag: elke dag krijgt zijn eerste plek voordat een dag zijn tweede krijgt. Is er te weinig bezetting, dan spreidt het tekort zich over de dagen in plaats van op één dag (vrijdag) te vallen;
     2. in het weekend liever een 2: dezelfde regelplekken met minder mensen aan het werk (uit te zetten onder Instellingen). Op werkdagen een 2 alleen bij een tekort;
     3. dan de Dg-diensten tot het minimum en de voorgangen per dag (niet op zondag);
     4. **de regelplekken staan er altijd, en elke dag (ma-za) minstens één voorgaansplek.** Lukt dat niet binnen de contracturen, dan plant het voorstel iemand boven zijn contract: over de periode gemiddeld hoogstens 15% (28 uur wordt hoogstens 32 uur; in te stellen, 0 = nooit) en per week hoogstens één dienst extra. Blijft er dan nog een plek open, dan als laatste ook buiten de eigen weekendbeurt (een teamafspraak). Rust, vrije weekenden en het maximum aantal dagen achter elkaar blijven altijd gelden; wat daardoor of door de grens boven contract open blijft, staat met de reden bij de uitkomst. Is er genoeg bezetting, dan komt niemand boven zijn contract;
     5. pas daarna aanvullen tot de uren met Dg-diensten, telkens op de dag met de minste: gelijkmatig over de dagen, tot twee keer de voorgaansplekken. Wat dan nog open staat (een contract van 28 of 36 uur) wordt een korte Dg-dag van 4 uur, behalve bij wie dat liever niet heeft (uit te zetten onder Instellingen);
     6. de voorgaansplekken zo gelijk mogelijk over de dagen: binnen een week gaat een Dg-dienst van de dag met de meeste naar de dag met de minste, zolang dat het verschil kleiner maakt (op zaterdag kunnen alleen wie dat weekend werken);
     7. is er meer bezetting dan werk, dan haalt niemand zijn uren: Dg-diensten gaan dan van wie het grootste deel van zijn contract heeft naar wie het kleinste heeft, tot iedereen ongeveer hetzelfde deel heeft.
   - *Wie een dienst krijgt*:
     - wie het verst achterloopt op zijn uren: in die week, in de periode en **uit de vier weken ervoor** (wie toen te weinig kreeg, gaat nu voor; hoogstens 12 uur). Verlof en ziekte verlagen de uren die iemand hoort te maken;
     - **eigen melding voorgaan**: wie een melding aanneemt (een 1, 1M of 2) krijgt zes dagen later liefst weer een regeldienst of een Dg-dienst (in te stellen), zodat hij de uitvaart van zijn eigen melding kan voorgaan. Verschuiven en ruilen maakt dat niet ongedaan;
     - de beschikbaarheidsdienst (1B) evenredig naar contract: iedereen ongeveer evenveel (hoogstens één van het aandeel af). Ook regeldiensten en middagdiensten naar contract (wie middag liever heeft, krijgt er meer);
     - de vaste voorkeur per weekdag en de wens per datum; een wens voor een datum gaat voor de vaste voorkeur;
     - de voorkeur voor de 2, voor 2 of 3 regelplekken per weekend en voor korte dagen;
     - wensen "liever vrij": per vier weken zijn er 6 zo goed als zeker (in te stellen; een afspraak uit het geïmporteerde jaarrooster altijd). Wat daarboven komt, en een wens die alleen het vaste "liever niet" van die weekdag herhaalt, weegt mee als voorkeur. Zo krijgt wie het meest vraagt niet vanzelf alles.
   - *Verbeteren*: diensten overdragen en kruiselings ruilen op dezelfde dag. De dekking blijft gelijk, tevredenheid en eerlijkheid gaan omhoog; niemand komt daardoor verder onder zijn uren.
   - *De beste van zes pogingen*: de keuze tussen gelijkwaardige kandidaten heeft een beetje willekeur. Het voorstel wordt zes keer gemaakt; het rooster zonder overtredingen, met de minste lege regelplekken en het hoogste cijfer wint.
   - *De toets rekent mee*: uren boven contract zijn pas een afwijking boven die grens (meer dan één dienst extra in een week, of meer dan 15% over de periode).
   - *Nagelopen*: `__tests__/rooster/roosterregels.test.ts` loopt deze regels na op echte voorstellen in vijf regio's, met een volledig en een te klein team. De uitleg voor planners en de keuzes die nog open staan, staan in `docs/Opzet-roosteren-GRIP.docx`.
   - *Blijft er een regelplek leeg*, dan staat erbij waarom: per reden hoeveel collega's die dag niet konden (niet aan de beurt dit weekend, weekuren op, verlof, kan niet op deze weekdag, ...).
3. **Eén voorstel, met een andere verdeling als je wilt.** Bovenaan staat wat er nodig is tegenover de bezetting (te veel, krap of te weinig mensen). De uitkomst staat naast het rooster van nu, in blokken: het cijfer; de continuïteit (dagen met te weinig regelplekken, de 1B's per medewerker, en **hoe vaak de 1B valt**: de kans per dag, voor een melding uit de eigen regio of uit een andere regio in het cluster, en het verwachte aantal keer); het aandeel **dagen** met genoeg plekken in de eigen regio (beleid: 80%) en in het cluster (beleid: 95%); de klanten: **hoeveel meldingen binnen 24 uur een regelgesprek krijgen**, gesplitst in de eigen regio (een regelplek of de eigen 1B), met hulp van het cluster (een vrije plek of 1B elders; de andere regio's vangen eerst hun eigen meldingen op, dus alleen wat daar dan nog vrij is telt), samen, en wat niet binnen 24 uur lukt; en medewerkers en uren (tevredenheid, weekpatroon, wensen, uren onder en boven contract). *Andere verdeling* geeft een ander rooster dat net zo goed aan het beleid voldoet. Alleen als je daar reden voor hebt, laat je de voorkeuren van medewerkers lichter of zwaarder wegen; standaard is het beleid. Onder *Waar houdt het voorstel rekening mee?* staat de hele lijst. Na toepassen kan alles nog met de hand.
4. **Alleen de weekenden, maanden vooruit.** Regio's die de weekenden 3 tot 6 maanden vooruit plannen, vinken in Rooster maken *Alleen de weekenden* aan (met de knoppen *3 maanden* en *6 maanden*). Dan komen alleen zaterdag en zondag in het rooster, volgens de weekendgroepen, zonder aan te vullen tot contracturen. Plan je later de maand, dan blijven die weekenden staan.

**Weekendgroepen.** Iedereen heeft een weekendcadans (elk weekend, om het weekend, 1 op 3 of 1 op 4) en een groep; het voorstel plant iemand alleen in de weekenden van de eigen groep. Om het weekend heet de groep *even weken* of *oneven weken*. GRIP rekent met doorlopende weken, zodat het ook rond de jaarwisseling om het weekend blijft; na een jaar met week 53 (zoals 2026) wisselen even en oneven daardoor van groep, en dat staat erbij (*Even weken (in 2027 oneven)*). Bij 1 op 3 en 1 op 4 heten de groepen A tot en met D, met het eerstvolgende weekend erbij. Op de pagina Team staan de groepen met hun contracturen en wat de medewerkers zelf willen, en de weekenden van het hele jaar per medewerker: wat in het rooster staat, wat de groep nog laat verwachten, en per weekend hoeveel mensen er werken.

**Het rooster in beeld.** Met *Hele maand* neemt het rooster de volle breedte en passen de 31 dagen op een gewoon scherm; het zijpaneel (cijfer, vaststellen) staat dan eronder. De namen staan in de eigen volgorde of op contract (groot naar klein). Beide keuzes onthoudt de browser.

**Regelplekken verschuiven in het cluster.** Heeft de ene regio te weinig mensen en de andere te veel, dan legt de planner (met rechten in beide regio's) vast dat de een in een periode zoveel plekken minder doet en de ander zoveel meer (`rp_verschuiving`). Rooster, toets, Rooster maken, Bijsturen en het dashboard rekenen met de nieuwe aantallen; in het cluster blijft het totaal gelijk. Voor de dekking van de eigen meldingen telt de plek die de andere regio doet nog mee, en de extra plek bij de ontvanger niet, zodat geen van beide er onterecht slecht of te goed uitkomt. Boven het rooster staat de afspraak; in de regel *Regelplekken nodig* staat een plus of min.

## Toets, cijfer en analyse

| Regel | Niveau | Beleid |
|---|---|---|
| Minimaal 12 uur rust tussen diensten | ATW en CAO | § 1.3 |
| Maximaal 6 diensten achter elkaar (ook over de grens van de periode) | ATW en CAO | § 1.3 |
| Maximaal 14 beschikbaarheidsdiensten per 28 dagen | ATW en CAO | § 1.2 |
| Minimaal 26 vrije weekenden per kalenderjaar, tenzij afstandsverklaring; zondag en maandag vrij telt hoogstens 13 keer als vrij weekend | ATW en CAO | § 1.4 |
| Precies de afgesproken regelplekken: niet minder, niet meer | Roosterbeleid | § 3.1 |
| Minimaal één middag/avonddienst en één 1B per dag | Roosterbeleid | § 3.2 |
| Maximaal twee keer een 2 per dag, met nog twee enkele regeldiensten | Roosterbeleid | § 3.1 |
| Maximaal 3 regelplekken per persoon per weekend | Roosterbeleid | § 3.1 |
| Minimaal 2 Dg-diensten (per regio instelbaar, bijvoorbeeld 3) en 4 voorgaansplekken per dag, geen Dg op zondag | Roosterbeleid | § 3.3 |
| Uitvaartleiders alleen op Dg | Roosterbeleid | § 3.3 |
| Maximaal op contracturen | Roosterbeleid | § 3.6 |
| Een dienst duurt maximaal 12 uur (met vastgelegde tijden) | ATW en CAO | § 1.3 |
| Geen overige diensten (O, OR, VMS, TD) in schoolvakanties | Roosterbeleid | § 4.2 |
| Om het weekend werken | Teamafspraak | |

Het cijfer (1 tot 10) is een gewogen gemiddelde van de **vierledige doelstelling** (§ 2.1). De weging is instelbaar; standaard is het 35 / 20 / 25 / 20. Bij een harde overtreding (ATW of CAO) is het cijfer maximaal 5,4 en is het rooster afgekeurd. Hetzelfde bij structureel te weinig regelplekken (een dag met 2 of meer te weinig, of 3 of meer dagen met een tekort, zoals het advies rood): dan is de status *Te weinig regelplekken* en het cijfer maximaal 5,4.

- **Continuïteit.** Dekking (70%): per dag de kans dat alle meldingen terechtkunnen, tegen het doel van 80%. Naleving van het beleid (30%). De analyse toont de risicodagen.
- **Efficiency.** Binnen de normen:
  - niet meer plekken dan afgesproken;
  - niet meer dan één 1B per dag;
  - geen uren boven contract;
  - geen onbenutte uren terwijl er een tekort is.
- **Medewerkers.** Per medewerker een score uit:
  - wensen;
  - weekpatroon;
  - ochtend of middag;
  - uren tegenover contract (verlof en ziekte verlagen de norm);
  - een rustig ritme: geen losse werkdagen, geen lange reeksen, voorwaartse rotatie, het weekmaximum gerespecteerd.

  Plus een eerlijke verdeling van weekenden, 1B, 2-diensten en Dg-dagen (iedereen een vergelijkbaar deel regelplekken en Dg).
- **Klanten.** Het verwachte aandeel meldingen dat op de dag zelf en binnen 24 uur geholpen wordt. Wat niet past, schuift naar de volgende dag als daar plekken over zijn.

Ten opzichte van het prototype zijn drie fouten hersteld:

- **Terugtest.** Het prototype gebruikte in de kalibratie gemeten weer van na de voorspeldag als verwachting. GRIP rekent daar alleen met wat op die dag bekend was (zie *Hoe de voorspelling werkt*).
- **Weekenden.** De controle "om het weekend" en de weekendgroepen sprongen rond de jaarwisseling, omdat week 53 en week 1 allebei oneven zijn. De app rekent nu met doorlopende weken.
- **Aanloop.** Diensten vlak vóór de periode tellen nu mee voor het aantal dagen achter elkaar.

## Wat de tests controleren

De tests met twee gelijktijdige databaseverbindingen (`__tests__/database/gelijktijdig.test.ts`) hebben een Postgres-server nodig: zet `GRIP_TEST_PG` (bijvoorbeeld `postgres://postgres@localhost:5432/postgres`); zonder slaan ze zich lokaal over.

- **Azure.** `__tests__/azure/`: de SQL achter `/api/db` (alleen tabellen en functies uit de lijst, namen gecontroleerd, waarden als parameter), het verzegelde sessiecookie, inloggen met PKCE tegen een nagebootste Entra ID (andere tenant, andere state of een gebruikte code: niet ingelogd), en op Postgres het schema dat de app zelf neerzet, de RLS per werkaccount, de seintjes voor live bijwerken en de dagelijkse taak. Alle tests in `__tests__/database/` lopen via dezelfde SQL. In de browser (`e2e/azure/`): inloggen en uitloggen, een onbekend account, live bijwerken tussen twee collega's, een rooster bewaren en teruglezen, een medewerker, gebruikersbeheer en de eerste beheerder.
- **Inloggen en gebruikers.** `__tests__/lib/sessie.test.ts` (koppelen op e-mailadres, geen toegang zonder profiel, veilige links) en `__tests__/lib/gebruikers.test.ts` (rollen en regio's). `__tests__/store/verschil.test.ts`: tijdstempels, JSON-volgorde en de snelheid bij een volle app.
- **Model.** `__tests__/model/python-parity.test.ts` vergelijkt de TypeScript-port met het Python-prototype op dezelfde invoer: basismodel, factoren en runs. Kalibratie en backtest wijken bewust af van het prototype (dat keek vooruit met gemeten weer); de test eist dat een terugblik niet afhangt van weer, lucht of rioolwater dat op die dag nog niet bekend was.
- **Normen.** `__tests__/capaciteit/norm.test.ts` vergelijkt de berekening met de Excel van de vastgestelde regelplekken 2027, voor alle regio's en weken.
- **Database.** `__tests__/database/` voert het schema uit op Postgres (PGlite). `opslag.test.ts` doorloopt het hele pad van de app: alles wegschrijven als verschil en per rol teruglezen, een wijziging van de planner, de eigen stap van een medewerker in een ruil, de goedkeuring door de regiomanager met de geschiedenis, en de opslag zelf (wat de database weigert, wordt teruggedraaid). `schema.test.ts` controleert:
  - de dienstcodes;
  - de toegangsregels per rol, waaronder: alleen de planner geeft het advies (verplicht, met toelichting bij oranje en rood), alleen de regiomanager keurt het rooster en verlof goed;
  - de vaststelling per maand: een vastgestelde maand wijzigt of verdwijnt niet meer, de geschiedenis legt de database zelf vast, en publiceren verder vooruit kan alleen voor vastgestelde maanden;
  - verlof ruilen (van collega's alleen wie en wanneer);
  - vakantierondes per cluster;
  - ziekmeldingen;
  - normen en schoolvakanties.
- **Roosteren.** `__tests__/rooster/` controleert:
  - elke regel uit de tabel hierboven;
  - dat het voorstel precies de afgesproken plekken plant zonder harde overtredingen, en uitvaartleiders alleen op Dg zet;
  - dat bijsturen de acties in de volgorde van het stroomschema geeft;
  - dat "Medewerker eerst" het weekpatroon beter respecteert.
- **Verdeling van meldingen.** `__tests__/verdeling/` controleert:
  - het exacte verwachte tekort, en dat een middagplek minstens zo waardevol is als een ochtendplek;
  - de gedragsregels: liever iemand in de ochtend die iets verder weg is, werkdruk spreiden, eerst de eigen regio, een 1B als laatste;
  - de harde eisen (reistijd, niet bij, 24 uur, voorgang), en dat een middaggesprek begint waar iemand daarvoor was;
  - de kwaliteit tegen het exacte optimum: alle verdelingen van 100 kleine gevallen doorgerekend;
  - invarianten op 150 willekeurige gevallen, met een eigen controle van elke dagroute (`invarianten.test.ts`);
  - het water: geen woonkern in een meer of aan de verkeerde kant, oversteken over het water, en bekende ritten zoals Middelburg–Terneuzen en Den Helder–Texel (`water.test.ts`);
  - de reistijd: tabel, kalibratie, zomertijd, de aanbieders (Google, TomTom en OSRM, met nagebootste antwoorden) en de server-route;
  - de landelijke simulatie: plekken uit rooster en norm, en de snelheid;
  - een echte dag verdelen (`dag.test.ts`): de plekken en vaste tijden per dienst, een afgesproken tijd, werkdruk uit eerdere verdelingen, de volgorde van plekken (eerst het cluster, dan het tweede gesprek van een 2, dan de 1B, dan een ander cluster), doorgegeven gesprekken die blijven staan, en de kans dat de 1B nog valt (exact tegen de Poissonverdeling);
  - bewaren in de database (`__tests__/database/verdeling.test.ts`): planner wel, medewerker niet, alleen PC4.
- **Verlof en stromen.** `__tests__/capaciteit/verlof.test.ts` (verlofruimte en advies) en `__tests__/store/stroom.test.ts`:
  - verlof ruilen: periodes en roosterrijen wisselen, de bezetting blijft gelijk;
  - ziek en hersteld;
  - vakantieronde.
- **AI en server-routes.** `__tests__/ai/advies.test.ts` controleert dat er geen namen in de vraag staan en dat het antwoord wordt gecontroleerd; `__tests__/lib/toegang.test.ts` wie de server-routes mag gebruiken en de limieten.
- **Lopende zaken.** `__tests__/store/stroom.test.ts` (fouten uit de controle): lopend verlof intrekken laat het verleden staan, een ruil gaat niet door als de dienst intussen is gewijzigd of de dag voorbij is, een verwijderde medewerker telt niet meer mee, en herstel na ziekte zet een overgenomen dienst niet dubbel terug.
- **Opslag.** `__tests__/store/migreer.test.ts`: oude goedkeuringen per periode en de publicatietermijn in dagen worden omgezet naar maanden, en het logboek bewaart ruim een jaar.
- **Team en tijden.** `__tests__/rooster/team-tijden.test.ts` en `__tests__/store/stroom.test.ts`:
  - de teamcijfers;
  - diensttijden en hun kaders;
  - externen;
  - de eerlijke Dg-verdeling;
  - vaststellen per maand en publiceren zonder gat;
  - lopende zaken in het gepubliceerde rooster.
- **Rechten.** `schema.test.ts`: een medewerker leest alleen de eigen regel uit het team (collega's zonder e-mailadres via `rp_collegas()`), wijzigt geen team, rooster of instellingen, ziet diensttijden van collega's pas na publicatie en publicaties alleen van de eigen regio; bij de NBD zet alleen de planner diensttijden. In de browser (`e2e/rollen.spec.ts`): een medewerker (regio en NBD) komt op geen enkel scherm van de planner, een planner niet bij bronnen, model en instellingen.
- **Testomgeving.** `opslag.test.ts`: in de test gaat niets naar de database, en terug naar echt leest die weer; in de browser (`e2e/testomgeving.spec.ts`) de hele route met vernieuwen, opnieuw beginnen, de demo en terug naar echt, terwijl de echte opslag ongemoeid blijft.
- **NBD.** `__tests__/nbd/`:
  - Erlang C tegen bekende waarden, de oude GRIP en grote aantallen (`erlang.test.ts`);
  - de behoefte, de diensten met pauze, de toets (rust, dienstlengte, pauze, wekelijkse rust, 60 uur, vrije weekenden) en het automatisch rooster: geen ATW- of CAO-overtredingen, service level, verlof, kan-niet-dagen, wensen en het dagdeel (`rooster.test.ts`);
  - ruilen met de tijden erbij en de toets (`ruil.test.ts`), bijsturen: tekort en te veel tegenover de bijvoorspelling, de volgorde van de acties, overleg binnen 4 en 28 dagen, pauze en training verschuiven, geen verlenging door de rust of in uren die niet kunnen, geen extra werk bij een open verlofaanvraag (`bijsturen.test.ts`), en de demo (`demo.test.ts`);
  - taken in een dienst: niet aan de telefoon maar wel werktijd, binnen de dienst en buiten de pauze, training en klachten op de rustigste momenten (een half uur per week, binnen kantoortijd, aanvullen en weghalen, alleen bij wie klachten behandelt), en de maandstart in drie groepen met verschoven diensten (`taken.test.ts`); in de browser in lijn, verlof of vrij, een taak in een dienst en de hele route van Taken (`e2e/nbd-taken.spec.ts`);
  - de verlofruimte uit Erlang (`__tests__/capaciteit/verlof.test.ts`), de NBD bij gebruikers (`__tests__/lib/gebruikers.test.ts`), de opslag van tijden, pauze en instellingen (`__tests__/database/opslag.test.ts`) en het schema (`schema.test.ts`);
  - in de browser: de losse module (schakelaar, eigen menu, niets bij de regio's), het NBD-rooster maken, een dienst met pauze, de capaciteit (663,5 uur), de medewerker met tijden, voorkeuren per uur en aanbieden, bijsturen na een ziekmelding, en team, voorkeuren, verlof, jaarplanning en ruilen in de module (`e2e/nbd.spec.ts`).
- **Jaarplanning.** `__tests__/capaciteit/jaarplan.test.ts`:
  - ISO-weken en feestdagen;
  - verlof per week en per medewerker, de open aanvragen, en dat er geen verlofrecht of saldo in staat;
  - knelpunten en rustige weken;
  - zomervakantie dit jaar en vorig jaar;

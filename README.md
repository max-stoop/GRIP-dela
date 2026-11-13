# GRIP Regelplekken

GRIP is de planningsapp voor de regelplekken van de uitvaartverzorgers en de nabestaandendesk (NBD). Eén app voor de hele keten:

    voorspellen  →  roosteren  →  bijvoorspellen  →  bijsturen  →  verdelen
    (61 dagen)      (per maand,    (elke ochtend      (stroomschema     (meldingen naar de
                     2 maanden      een nieuwe run)    dagsturing)       juiste uitvaartverzorger)
                     vooraf)

* **Voorspellen.** Per regio hoeveel regelplekken er de komende 61 dagen nodig zijn, op basis van de eigen meldingen, sterfte, weer, luchtkwaliteit, rioolwater en griep.
* **Roosteren.** Een maandrooster maken uit de voorkeuren van medewerkers, dat de nodige plekken dekt en meteen getoetst wordt aan de ATW, de CAO en het roosterbeleid (versie 1.3, met de wijzigingen voor 2027).
* **Vaststellen.** De planner geeft een advies, de regiomanager keurt goed, daarna gaat het rooster naar de medewerkers.
* **Bijsturen.** Als de voorspelling verandert of iemand ziek wordt: acties volgens het stroomschema dagsturing, vooraf getoetst.
* **Verdelen.** Elke ochtend om 07:00 de meldingen van de dag naar de juiste uitvaartverzorgers, op reistijd en werkdruk.
* **Verlof en ruilen.** Verlof aanvragen en plannen op de ruimte die de vastgestelde regelplekken laten, vakantierondes, diensten en verlof ruilen.
* **Nabestaandendesk.** Een eigen module met capaciteit volgens Erlang C, diensten met pauze en automatisch roosteren.

Deze versie vervangt de vorige GRIP (maandrooster, NBD, UVD) volledig. Hoe elk onderdeel werkt en rekent, staat in **[docs/werking.md](docs/werking.md)**.

## Inhoud

- [Voor wie](#voor-wie)
- [Techniek](#techniek)
- [Lokaal starten](#lokaal-starten)
- [Instellingen](#instellingen)
- [Omgevingen en uitrol](#omgevingen-en-uitrol)
- [Testen](#testen)
- [Mappen](#mappen)

## Voor wie

| Rol | Wat die doet |
|---|---|
| **Medewerker** | Eigen rooster bekijken, voorkeuren en wensen invullen, verlof aanvragen, diensten ruilen. |
| **Planner** | Voorspelling, rooster maken en toetsen, advies geven, publiceren, bijsturen, meldingen verdelen. Plant landelijk. |
| **Regiomanager** | Wat de planner kan behalve het advies, plus roosters goedkeuren en besluiten over verlof in de eigen regio's. |
| **Beheerder** | Richt de app in: gebruikers, bronnen en model, beleid en normen, schoolvakanties, back-up. |

Maken, adviseren en goedkeuren blijven zo gescheiden (§ 5.1 van het beleid). De rechten staan op één plek (`lib/rechten.ts`) en de database dwingt ze af. Gebruikers beheert de beheerder in de app onder **Instellingen → Gebruikers**.

## Techniek

| Onderdeel | Keuze |
|---|---|
| App | Next.js (React, TypeScript), Node 22 |
| Inloggen | Microsoft Entra ID, met het werkaccount |
| Database | PostgreSQL 16, met de rechten per gebruiker in de database zelf (row level security) |
| Hosting | Azure: App Service, Azure Database for PostgreSQL en een Logic App voor de dagelijkse voorspelling; optioneel Azure OpenAI voor de AI-roosterassistent |
| Infrastructuur | Bicep: `infra/` voor de landing zone van DELA (OTAP, alles achter het netwerk), `azure/` voor de huidige omgeving (gripapp.nl) met een installatiescript |
| Uitrol | Azure DevOps (`azure-pipelines.yml`): controleren, security-scans en uitrol via dev, tst, acc naar prd. Voor de huidige omgeving GitHub Actions. |

Het rekenwerk (voorspelling, roosteren, verdelen) draait in de browser, in een web worker. De server haalt de externe bronnen op, bewaakt de toegang tot de database en houdt collega's live bij.

## Lokaal starten

Node 20 of nieuwer.

```bash
npm ci
npm run dev        # http://localhost:3000
```

Lokaal draait GRIP zonder inloggen en bewaart alles in de browser. Kies op het welkomstscherm **Demo laden** om alles te verkennen: 25 regio's met teams en roosters, voorspellingen, verlof, ruilverzoeken en de nabestaandendesk. Via het gebruikersmenu linksonder kijk je mee als regiomanager, planner of medewerker.

Met `npm run build:azure` bouw je de versie voor Azure: met inloggen en de gedeelde database. Hoe je die neerzet, staat in [azure/README.md](azure/README.md).

## Instellingen

Alle instellingen zijn omgevingsvariabelen. Voor Azure zet het installatiescript ze; de lijst met de Azure-variabelen (`DATABASE_URL`, `GRIP_URL`, `ENTRA_*`, `SESSIE_GEHEIM`, `GRIP_BEHEERDER`) staat in [azure/README.md](azure/README.md).

| Variabele | Waarvoor |
|---|---|
| `NEXT_PUBLIC_GRIP_PLATFORM` | `azure` bij het bouwen voor Azure (`npm run build:azure` zet hem). Zonder: lokaal. |
| `CRON_SECRET` | Lange willekeurige tekst waarmee de Logic App elke ochtend de voorspelling start (`/api/taken/dagelijks`). Zonder doet de beheerder het bij het openen van de app. |
| `OPENMETEO_API_KEY` | Optioneel: zakelijke sleutel voor de weergegevens. Zonder gebruikt de app de gratis servers, die alleen voor niet-commercieel gebruik zijn. |
| `AI_URL`, `AI_SLEUTEL`, `AI_MODEL` | Optioneel: de AI-roosterassistent in Azure OpenAI (endpoint, sleutel en naam van de deployment; zie [azure/README.md](azure/README.md)). Zonder werkt alleen de eigen controle. |
| `REISTIJD_AANBIEDER`, `REISTIJD_SLEUTEL`, `REISTIJD_URL` | Optioneel, kost geld: live reistijd bij het verdelen (`google`, `tomtom` of een eigen `osrm`-server). Zonder rekent de app met een gratis schatting. |
| `GRIP_DAGTAAK` | `intern`: de app start zelf elke ochtend na 06:00 de voorspelling (zonder Logic App). |
| `ZONDER_LOGIN` | Alleen lokaal: `1` staat de server-routes toe op een server zonder inloggen. Standaard uit. |

## Omgevingen en uitrol

### Naar DELA

GRIP verhuist naar de Azure landing zone van DELA, met vier omgevingen (dev, tst, acc, prd) in eigen abonnementen, alles achter het netwerk en uitrol via Azure DevOps.

* **Ontwerp**: [docs/solution-design.md](docs/solution-design.md): architectuur, netwerk, identiteit, gegevens, monitoring en de open punten.
* **Infrastructuur**: [infra/main.bicep](infra/main.bicep) met de waarden per omgeving in `infra/omgevingen/`.
* **Pipeline**: [azure-pipelines.yml](azure-pipelines.yml); inrichten in Azure DevOps: [pipelines/README.md](pipelines/README.md).
* **Bouwen**: `npm run build:dela` (zoals `build:azure`, maar GRIP nodigt zelf geen gasten uit: toegang loopt via de security group en Omada).

### Huidige omgeving (gripapp.nl)


| Omgeving | Waar | Gegevens | Hoe een wijziging er komt |
|---|---|---|---|
| Ontwikkeling | Lokaal (`npm run dev`) | In de browser | Direct. |
| Test | test.gripapp.nl | Eigen databaseserver (`grip_test`) | Elke push naar `main`, na lint, typecheck en alle unit-tests, ook op een echte Postgres (`.github/workflows/test.yml`). |
| Productie | gripapp.nl (www.gripapp.nl stuurt door) | Eigen database (`grip`) | Met de hand, na akkoord op test: *Actions > Naar productie > Run workflow* (`.github/workflows/productie.yml`). |

*Naar productie* zet precies de versie neer die op test draait: dezelfde commit, opnieuw gecontroleerd, en pas na de end-to-end-tests van de app zoals in Azure. Wat niet eerst op test heeft gestaan, komt zo niet op productie. Mislukt iets, dan blijft de vorige versie staan.

* **Gescheiden.** Test en productie delen geen gegevens en geen sessies: elk heeft een eigen databaseserver (met een eigen beheerderswachtwoord) en een eigen sessiegeheim. Een database is alleen bereikbaar vanaf de eigen app. Hetzelfde werkaccount logt op beide in, met de rol en de regio's die in die omgeving gelden. De beheerder geeft collega's apart toegang tot test.
* **Herkenbaar.** Op test staat bovenaan elke pagina *Testomgeving*. Welke versie waar draait, staat op `/api/versie` (de commit).
* **Database.** De app werkt het schema (`azure/database/`) zelf bij als hij start. Een wijziging daarin draait dus eerst op de testdatabase.
* **Dagelijkse taak.** Productie en test hebben elk een Logic App van 6:00 (tot 12:00 elk uur nog een poging als een bron niet bereikbaar was), met een eigen sleutel. Die maakt de voorspelling van de dag en ruimt op volgens de bewaartermijnen.
* **Terug naar een vorige versie.** Draai de wijziging terug op `main` (`git revert`). Die gaat dan als nieuwe versie via test naar productie.

Wat er in Azure staat en hoe je het neerzet (met het installatiescript of stap voor stap): [azure/README.md](azure/README.md).

## Testen

```bash
npm test              # unit-tests
npm run lint          # ESLint
npm run typecheck     # TypeScript
npm run build
npm run test:e2e      # end-to-end in een echte browser (desktop en mobiel)
npm run build:azure && npm run test:e2e:azure   # de app zoals in Azure (GRIP_TEST_PG nodig)
```

Een paar tests hebben een echte Postgres nodig: zet `GRIP_TEST_PG` (bijvoorbeeld `postgres://postgres@localhost:5432/postgres`); zonder slaan ze zich over.

Bij een pull request draait `.github/workflows/ci.yml` lint, typecheck, de unit-tests en de build; de end-to-end-tests ook elke maandag en met de hand. De belangrijkste controles:

* het voorspelmodel tegen het oorspronkelijke Python-prototype, op dezelfde invoer;
* de vastgestelde regelplekken tegen de Excel van 2027, voor alle regio's en weken;
* elke roosterregel uit het beleid, de ATW en de CAO;
* de rechten per rol in de database;
* inloggen met Entra ID, live bijwerken en gelijktijdig opslaan.

Per onderdeel wat de tests controleren: [docs/werking.md](docs/werking.md#wat-de-tests-controleren).

## Mappen

    app/(app)/               pagina's: dashboard, voorspelling, rooster, bijsturen, verdeling, team, verlof, jaarplanning, ruilen, capaciteit, beleid, mijn-rooster, model, instellingen
    app/api/reistijd/        live reistijden voor de verdeling (server, sleutel van de aanbieder)
    app/api/bronnen/         ophalen van Open-Meteo, RIVM, CBS en schoolvakanties (server)
    app/api/ai/rooster/      AI-roosterassistent (server)
    app/api/gebruikers/      gebruikersbeheer voor de beheerder (server)
    app/api/db, app/api/live Azure: de database met de rechten van wie is ingelogd, en live bijwerken (server-sent events)
    app/login, app/auth/     inloggen met het werkaccount (Entra ID) en uitloggen
    lib/platform.ts          lokaal of Azure
    lib/server/              Azure: Postgres (schema bijwerken, RLS per gebruiker), de SQL achter /api/db, live bijwerken, gebruikers
    lib/auth/                inloggen met Entra ID, het verzegelde sessiecookie, uitloggen
    azure/                   huidige omgeving (gripapp.nl): resources (main.bicep), installatiescript en het stappenplan
    infra/                   landing zone van DELA: Bicep (main.bicep, modules/) en de waarden per omgeving (omgevingen/)
    azure-pipelines.yml      Azure DevOps: controleren, security-scans en uitrol via OTAP (met pipelines/)
    lib/taken/               de dagelijkse voorspelling op de server, en de planner binnen de app (GRIP_DAGTAAK=intern)
    e2e/rook/                rooktest na elke uitrol, tegen de echte omgeving
    azure/database/          het datamodel (grip.sql: tabellen, RLS, triggers, functies), met basis.sql ervoor en live.sql erna
    lib/api/toegang.ts       wie de server-routes mag gebruiken, en de limieten
    components/              app-schil, ui, grafieken, roostergrid, panelen, verlofplanning, verbeteren
    lib/model/               voorspelmodel: basismodel (GLM), factoren, runs, kalibratie, betrouwbaarheid, demo, web worker
    lib/capaciteit/          vastgestelde regelplekken (parameters, norm), verlofruimte, schoolvakanties, verlofadvies en de jaarplanning
    lib/rooster/             diensten, analyse (vier doelen), toets en cijfer, voorstel (optimalisatie), ruiltoets, bijsturen, team, diensttijden, maanden (maand.ts)
    lib/werkregio.ts         de werkregio die over de pagina's meegaat
    lib/nbd/                 nabestaandendesk: parameters, Erlang C, behoefte per kwartier, diensten met pauze, ATW/CAO-toets, automatisch rooster, bijsturen, ruilen, demo
    components/nbd/          schermen van de NBD-module: overzicht, rooster, dagbeeld, dienst, taken, rooster maken, bijsturen, voorkeuren per uur, verlof, capaciteit
    app/(app)/nbd/           de routes van de NBD-module (/nbd, /nbd/rooster, /nbd/bijsturen, /nbd/team, /nbd/voorkeuren, /nbd/verlof, /nbd/jaarplanning, /nbd/ruilen, /nbd/capaciteit)
    lib/verdeling/           verdeling van meldingen: model, rekenkern, een dag verdelen (dag.ts), reistijd (live en tabel), simulatie; ontwerp in docs/ontwerp-verdeling.md
    lib/beleid/              het roosterbeleid als tekst, met de regels die GRIP toetst
    lib/ai/                  vraag, schema en systeemprompt voor de AI-roosterassistent
    lib/store/               opslag en acties, afgeleide cijfers
    lib/store/db/            de koppeling met de database: rijen en staat, het verschil, wegschrijven, lezen, live
    lib/sessie.ts            wie is ingelogd, met rol en regio's
    lib/bronnen/             parsers voor de externe bronnen
    lib/import.ts            meldingen inlezen uit Excel (.xlsx, read-excel-file) of CSV
    lib/export.ts            Excel (write-excel-file), afdrukken/PDF en agenda (.ics)
    lib/xlsx.ts              eigen Excel-schrijver: formules, kleurregels, samengevoegde cellen, vaste rijen
    lib/rooster/jaarExport.ts het jaarrooster in het eigen format (rooster- en urenbladen per regio, zonder namen)

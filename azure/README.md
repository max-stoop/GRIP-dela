# GRIP in Azure

GRIP draait in Azure met drie onderdelen (en optioneel een vierde) in één resourcegroep in Europa:

| Onderdeel | Azure | Wat het doet |
|---|---|---|
| De app | App Service (Linux, Node 22) | De website. Iedereen logt in met het werkaccount (Microsoft Entra ID). |
| De database | Azure Database for PostgreSQL Flexible Server 16 | Alle gegevens, met per gebruiker de rechten in de database zelf (row level security). De app zet het schema zelf neer en werkt het bij. |
| De dagelijkse taak | Logic App | Elke ochtend om 6:00 de bronnen verversen en een nieuwe voorspelling maken; was een bron niet bereikbaar, dan tot 12:00 elk uur nog een poging. Ook het opruimen volgens de bewaartermijnen. |
| De AI-roosterassistent (optioneel) | Azure OpenAI | Adviseert over een rooster; zie *De AI-roosterassistent* hieronder. |

Live bijwerken (wat een collega wijzigt, zie je meteen) zit in de app en de database zelf; daar is geen aparte dienst voor nodig.

## In één keer, met het installatiescript

`azure/installeer.sh` doet stap 1 tot en met 3 hieronder in één keer, in Azure Cloud Shell. Het verwacht `main.json` (de gecompileerde `main.bicep`) en `app.zip` (de inhoud van `.next-azure/standalone`) ernaast:

```bash
npm run build:azure
mkdir -p pakket && az bicep build --file azure/main.bicep --outfile pakket/main.json
(cd .next-azure/standalone && zip -qr ../../pakket/app.zip .)
cp azure/installeer.sh pakket/ && (cd pakket && zip -q ../grip-azure.zip *)
```

Upload `grip-azure.zip` in Cloud Shell en draai `unzip -o grip-azure.zip -d grip && bash grip/installeer.sh`. Het script:

* maakt de app-registratie, met het terugadres na inloggen;
* zet de resources neer in West-Europa, of in een andere Europese regio als het abonnement daar niet mag;
* zet de app erop en wacht tot die antwoordt;
* maakt wie het script draait de eerste beheerder.

Met `ADRES=gripapp.nl` krijgt de app een eigen domeinnaam:

* het script zet de app dan in B1, want de gratis versie kan geen eigen domeinnaam aan;
* het maakt een DNS-zone in Azure met de records die App Service nodig heeft (A naar de app, TXT `asuid` ter controle);
* het noemt de vier nameservers van Azure. Die zet je bij de registrar van het domein;
* zodra het domein naar Azure wijst, koppelt een volgende keer draaien het domein aan de app, met een gratis certificaat van App Service;
* `www.<ADRES>` komt op dezelfde app (een CNAME, met een eigen certificaat). De app stuurt het door naar `<ADRES>`, zodat het inloggen en de sessie bij één adres horen.

Het script onthoudt de domeinnaam en de testomgeving: nog een keer draaien kan daarna zonder `ADRES` en `TEST`.

Met `TEST=1` zet het er een testomgeving naast: een tweede app op hetzelfde App Service-plan, met een eigen databaseserver (eigen beheerder en wachtwoord, database `grip_test`), een eigen sessiegeheim en een eigen dagelijkse taak (voorspelling en opruimen, met een eigen sleutel). Test krijgt elke push naar `main`; door de eigen server kan een fout of lek op test nooit bij de gegevens van productie. Die komt op `test.<ADRES>` (een CNAME in dezelfde DNS-zone, met een eigen certificaat). Het terugadres na inloggen staat er voor beide in. Op het B1-plan kost de app niets extra; de tweede databaseserver (Burstable B1ms) wel, ongeveer zoveel als die van productie.

Een database is alleen bereikbaar voor de uitgaande IP-adressen van de eigen app (`azure/firewall.bicep`), niet voor de rest van Azure of internet. Een installatie van vóór deze wijziging had de regel *AlleenAzure* (0.0.0.0, elke dienst in Azure) en een testdatabase op de server van productie: draai het script dan één keer met `OPNIEUW=1`. Het zet de nieuwe regels en de testserver neer, haalt *AlleenAzure* weg zodra de nieuwe regels er staan, en noemt de regel om de oude `grip_test` op de productieserver weg te halen.

Met `GITHUB=eigenaar/repository` maakt het script ook een identiteit voor GitHub Actions: inloggen zonder wachtwoord (OIDC), alleen voor die repository op `main`, met alleen de rol *Website Contributor* op de apps. GitHub meldt zich aan als `repo:eigenaar/repository:…` of met vaste nummers, als `repo:eigenaar@123/repository@456:…`; het script vertrouwt beide. Die nummers haalt het uit de openbare API van GitHub. Bij een privérepository lukt dat niet: faalt het inloggen dan met `AADSTS700213`, voeg dan het subject uit die melding toe met de regel die het script noemt. Het noemt daarna de waarden voor `.github/workflows/test.yml` en `productie.yml`. Vanaf dan gaat elke push naar `main` naar test, en *Naar productie* zet die versie op productie (zie *Omgevingen* in de README van GRIP).

Zonder `ADRES` zet het de gratis versie van de app neer (F1). Die slaapt na 20 minuten zonder bezoek; overdag (6:00 tot 23:00) houdt een Logic App hem wakker. Hij heeft een dagquotum van 60 minuten rekentijd en 165 MB uitgaand verkeer; wie eroverheen gaat, ziet de app pas na middernacht (UTC) weer. Genoeg om te testen met een paar mensen. Altijd aan en zonder quotum: `OPNIEUW=1 GROOTTE=B1`.

`VOORAF=1` laat bij een bestaande installatie zien wat `OPNIEUW=1` in Azure zou veranderen (`az deployment group what-if`), zonder iets te veranderen: geen nieuwe geheimen, geen nieuw client secret, geen nieuwe resources.

Nog een keer draaien maakt een onderbroken installatie af. `app.zip` komt alleen op een app waar GRIP nog niet draait; een nieuwere versie van GitHub blijft zo staan. `NEERZETTEN=1` zet `app.zip` toch neer. Met `OPNIEUW=1`, of met iets nieuws zoals `TEST=1`, zet het ook de resources opnieuw neer, met nieuwe geheimen: wie ingelogd is, moet opnieuw inloggen. De gegevens blijven staan.

## Overstappen naar de versie met een eigen testserver

Voor een installatie van vóór de eigen testserver, de firewall per app en de dagelijkse taak op test. In deze volgorde:

1. **Naar `main`.** De nieuwe versie gaat vanzelf naar test. De app werkt het schema bij als hij start; daarna geldt daar dat een regiomanager zonder regio's geen toegang meer heeft.
2. **Regio's van regiomanagers.** Open op test en daarna op productie *Instellingen → Gebruikers*. Een regiomanager zonder regio's staat er in het rood bij (*geen regio's: geen toegang*). Kies de regio's, of *Alle regio's*. Op productie doe je dit vlak na *Naar productie*.
3. **Testgegevens bewaren (alleen als je ze nodig hebt).** De nieuwe testserver begint leeg. Zet een tijdelijke firewallregel voor je eigen adres op de server van productie, maak een kopie met `pg_dump` van de database `grip_test` (zoals onder *5. Gegevens overzetten naar een andere omgeving*, met `grip_test` als bron), en haal de regel daarna weg. Terugzetten doe je na stap 5, op dezelfde manier op de nieuwe testserver (ook daar met een tijdelijke firewallregel), nadat de testapp één keer is geopend.
4. **Eerst bekijken.** Bouw `main.json` opnieuw (`az bicep build`, zie boven; die stopt bij een fout in de template) en draai in Cloud Shell `VOORAF=1 bash grip/installeer.sh`. Je ziet wat er in Azure verandert: de nieuwe testserver, de firewallregels *App-0*, *App-1* …, de dagelijkse taak op test en de nieuwe geheimen.
5. **Neerzetten.** `OPNIEUW=1 bash grip/installeer.sh`. Wie ingelogd is, moet daarna opnieuw inloggen (nieuwe geheimen). Het script haalt de regel *AlleenAzure* weg zodra de nieuwe regels er staan, en noemt de regel om de oude `grip_test` op de server van productie weg te halen.
6. **Controleren.** Log in op test en productie. Op test staat bovenaan *Testomgeving*; onder *Bronnen en model* staat de volgende ochtend de dagelijkse taak, ook op test.

## 1. App-registratie in Entra ID

Eenmalig, door iemand met de rechten om apps te registreren.

1. Entra ID > App registrations > New registration.
   * Naam: GRIP.
   * Supported account types: *Accounts in this organizational directory only* (alleen de eigen organisatie).
   * Redirect URI: platform *Web*, adres volgt in stap 2 (`https://<app>.azurewebsites.net/auth/entra/callback`). Vul het in zodra stap 2 klaar is.
2. Noteer op de Overview-pagina de **Application (client) ID** en de **Directory (tenant) ID**.
3. Certificates & secrets > New client secret. Noteer de **waarde** (niet het ID). Zet een herinnering voor de vervaldatum.
4. Optioneel: Enterprise applications > GRIP > Properties > *Assignment required* op Yes, en onder Users and groups de groep die GRIP gebruikt. Dan kan alleen die groep inloggen. Wat iemand in GRIP mag (rol en regio's), regelt de beheerder in GRIP zelf.

API-rechten zijn niet nodig: GRIP vraagt alleen `openid`, `profile` en `email`.

## 2. Resources neerzetten

Met de Azure CLI (ook in Cloud Shell in de portal):

```bash
az group create --name grip --location westeurope

az deployment group create --resource-group grip --template-file azure/main.bicep --parameters \
  databaseWachtwoord="$(openssl rand -base64 30)" \
  entraTenantId=<tenant-id> entraClientId=<client-id> entraClientSecret=<secret-waarde> \
  sessieGeheim="$(openssl rand -base64 48)" cronGeheim="$(openssl rand -base64 48)" \
  eersteBeheerder=<e-mailadres van de beheerder> \
  aiUrl=<optioneel> aiSleutel=<optioneel> aiModel=<optioneel, samen voor de AI-roosterassistent>
```

De uitvoer geeft `appAdres`, `terugAdres` en `appNaam`. Zet `terugAdres` als Redirect URI in de app-registratie (stap 1).

Alle instellingen staan daarna als *Environment variables* bij de App Service:

| Variabele | Waarvoor |
|---|---|
| `DATABASE_URL` | De verbinding met de database. |
| `GRIP_URL` | Het adres van de app zoals de browser het kent. Met een eigen domein: dat domein, en ook de Redirect URI aanpassen. |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | Inloggen met het werkaccount. |
| `SESSIE_GEHEIM` | Versleutelt de sessie (12 uur geldig). Vervangen logt iedereen uit. |
| `CRON_SECRET` | Alleen de dagelijkse taak kent hem; de Logic App stuurt hem mee. |
| `GRIP_BEHEERDER` | Het werkaccount dat bij de eerste keer inloggen beheerder wordt (meer adressen met een komma ertussen). |
| `GRIP_OMGEVING` | Alleen op de testomgeving: `test`. Bovenaan elke pagina staat dan *Testomgeving*. |
| `AI_URL`, `AI_SLEUTEL`, `AI_MODEL` | Optioneel: de AI-roosterassistent in Azure OpenAI (zie hieronder). |
| `OPENMETEO_API_KEY`, `REISTIJD_*` | Optioneel, zoals in de README van GRIP. |

### De AI-roosterassistent (Azure OpenAI)

Optioneel. Zonder werkt in het rooster alleen de eigen controle.

**Met de Bicep** (`metAi=true`, of `AI=1` bij het installatiescript): er komt een Azure OpenAI-resource bij, met één model (standaard `gpt-4.1`, deployment `roosteradvies`, 50.000 tokens per minuut). De app krijgt `AI_URL`, `AI_SLEUTEL` en `AI_MODEL` vanzelf. De resource staat standaard in Zweden-Centraal (`aiLocatie`), omdat niet elk model in elke regio beschikbaar is; met *Data Zone Standard* worden de vragen alleen binnen de EU verwerkt. Model, versie en capaciteit zijn in te stellen (`aiModelNaam`, `aiModelVersie`, `aiCapaciteit`). Kies een model dat antwoorden volgens een JSON-schema ondersteunt (*structured outputs*). Lukt het neerzetten niet, dan is er meestal geen quotum voor dat model in die regio: vraag het aan in Azure AI Foundry onder *Quota*, of kies een andere regio of een ander model.

**Met een bestaande resource**: geef `aiUrl` (het endpoint, `https://<naam>.openai.azure.com`), `aiSleutel` en `aiModel` (de naam van de deployment) mee, of zet `AI_URL`, `AI_SLEUTEL` en `AI_MODEL` bij de App Service onder *Environment variables*.

GRIP stuurt geen namen mee: medewerkers heten in de vraag M1, M2, enzovoort.

## 3. De app erop zetten

**Met GitHub Actions** (zo draait gripapp.nl): `installeer.sh` met `GITHUB=eigenaar/repository` maakt de koppeling en noemt de waarden voor `.github/workflows/test.yml` en `productie.yml`. Elke push naar `main` wordt dan getest, gebouwd en op test neergezet; *Actions > Naar productie > Run workflow* zet dezelfde versie op productie.

**Met Azure DevOps**: voor de landing zone van DELA staat er een eigen pipeline en Bicep; zie [pipelines/README.md](../pipelines/README.md).

**Met de hand**, vanaf een computer met Node 22:

```bash
npm ci
npm run build:azure
cd .next-azure/standalone && zip -qr ../../grip.zip . && cd ../..
az webapp deploy --resource-group grip --name <appNaam> --src-path grip.zip --type zip
```

`npm run build:azure` bouwt de app met `NEXT_PUBLIC_GRIP_PLATFORM=azure`; dat ligt bij het bouwen vast.

## 4. Eerste keer inloggen

Open het `appAdres`. De eerste aanvraag zet het databaseschema neer (dat duurt een paar seconden). Log in met het werkaccount uit `eersteBeheerder`: dat wordt beheerder. Onder Instellingen > Gebruikers geef je collega's toegang met hun rol en regio's; het e-mailadres moet het adres zijn waarmee ze bij Microsoft inloggen. Bij hun eerste keer inloggen koppelt GRIP het werkaccount aan die regel.

Collega's van een andere organisatie kunnen alleen inloggen als gast in deze Entra ID. GRIP stuurt die uitnodiging zelf bij het toevoegen, als de app-registratie dat mag. Geef die machtiging eenmalig: *Entra ID > App-registraties > GRIP Regelplekken > API-machtigingen > Een machtiging toevoegen > Microsoft Graph > Toepassingsmachtigingen > User.Invite.All*, en daarna *Beheerderstoestemming verlenen*. Een gast krijgt daarmee alleen het inloggen, geen rechten op de resources in Azure. Zonder de machtiging nodig je gasten zelf uit (*Entra ID > Gebruikers > Externe gebruiker uitnodigen*).

## 5. Gegevens overzetten naar een andere omgeving

Bijvoorbeeld van een eigen Azure-abonnement naar dat van het werk. Zet GRIP eerst in de nieuwe omgeving neer en open de app daar één keer. Gebruik `psql` en `pg_dump` 16 of nieuwer, in Cloud Shell aanwezig. Doe het eerst met een kopie van de nieuwe database.

```bash
VAN='postgresql://gripbeheer:<wachtwoord>@<oude databaseServer>:5432/grip?sslmode=require'
NAAR='postgresql://gripbeheer:<wachtwoord>@<nieuwe databaseServer>:5432/grip?sslmode=require'

# leeg wat de nieuwe app bij het neerzetten van het schema invulde
psql "$NAAR" -c "truncate users, regios restart identity cascade"

# alles, in één transactie
pg_dump "$VAN" --data-only --table=public.regios --table=public.users --table='public.rp_*' --exclude-table=public.rp_bewaar_deel > grip-gegevens.sql
psql "$NAAR" -v ON_ERROR_STOP=1 --single-transaction -f grip-gegevens.sql

# de werkaccounts van de nieuwe organisatie koppelen bij de eerste keer inloggen opnieuw op e-mailadres
psql "$NAAR" -c "update users set auth_id = null"
```

Pas daarna in de nieuwe GRIP onder Instellingen > Gebruikers de e-mailadressen aan als die in de nieuwe organisatie anders zijn.

## Beheer

* **Logboek**: App Service > Log stream; de dagelijkse taak in de Logic App > Runs history, en in GRIP bij Bronnen en model.
* **Back-up**: de database bewaart 14 dagen; terugzetten naar een moment kan in de portal (Restore).
* **Client secret verloopt**: maak in de app-registratie een nieuwe en zet die in `ENTRA_CLIENT_SECRET`.
* **Eigen domein**: App Service > Custom domains, met een gratis certificaat. Pas `GRIP_URL` en de Redirect URI aan.
* **De database alleen in een eigen netwerk**: kan met VNet-integratie van de App Service (niet in de gratis versie F1) en een private endpoint op de database; dan vervallen de regels *App-0*, *App-1* … uit `firewall.bicep`.
* **Andere uitgaande adressen**: verandert de App Service van plan (bijvoorbeeld van F1 naar B1), dan krijgt hij andere uitgaande adressen. Draai het script dan met `OPNIEUW=1`, zodat de firewall van de database meegaat.

## Testen zonder Azure

`npm run build:azure` en daarna `GRIP_TEST_PG=postgres://… npm run test:e2e:azure`: de app zoals in Azure, met een lokale Postgres en een nagebootste Entra ID (`e2e/azure/nep-entra.mjs`).

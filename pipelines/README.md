# GRIP in Azure DevOps

De pipeline (`azure-pipelines.yml`) controleert elke wijziging en rolt via OTAP uit naar de landing zone van DELA:

    Controleren en bouwen  ─►  dev  ─►  tst  ─►  acc  ─►  prd
    (agent van Microsoft)      (agent in het VNet, met akkoord voor acc en prd)

| Stap | Wat |
|---|---|
| **Controleren** | Lint, typecheck, unit-tests (ook op een echte Postgres), end-to-end-tests in de browser (lokaal en zoals in Azure, met een nagebootste Entra ID), het pakket bouwen. |
| **Security** | Kwetsbare afhankelijkheden (`npm audit`, alles wat in productie draait, vanaf *high*), geheimen in de code en de hele geschiedenis (gitleaks), static code analysis (Semgrep: TypeScript, Node.js, React en de OWASP Top 10), de Bicep. De rapporten staan als SARIF bij de run (*CodeAnalysisLogs*). |
| **Per omgeving** | Eerst de infrastructuur (`infra/main.bicep` met `infra/omgevingen/<omgeving>.bicepparam`), dan de app, dan wachten tot de nieuwe versie draait (`/api/versie`), dan de rooktest (`e2e/rook`). |
| **tst** | Daarna ook een security-scan van de draaiende app (OWASP ZAP baseline); het rapport staat bij de run. |
| **prd** | Alleen vanaf `main`, en pas na akkoord. Elke omgeving krijgt precies hetzelfde pakket als de omgeving ervoor. |

Bij een pull request draait alleen *Controleren*. Bij een push naar `main` gaat de versie door tot en met productie; bij een handmatige run kies je hoe ver (*Uitrollen tot en met*).

## Eenmalig inrichten

1. **Service connections**: `grippapp-dev-we-scn`, `grippapp-tst-we-scn`, `grippapp-acc-we-scn`, `grippapp-prd-we-scn` (zijn er al). Ze hebben *Contributor* nodig op de resourcegroep van GRIP en het recht om rollen toe te wijzen op de Key Vault en Azure OpenAI (bijvoorbeeld *Role Based Access Control Administrator*, beperkt tot die rollen), plus *Network Contributor* op de subnets (om er private endpoints en de VNet-integratie in te zetten).
2. **Environments** (*Pipelines → Environments*): `grip-dev`, `grip-tst`, `grip-acc`, `grip-prd`. Bij `grip-acc` en `grip-prd` onder *Approvals and checks* wie akkoord geeft.
3. **Agent pool in het VNet**: de app, ook de endpoint waarmee de pipeline hem neerzet, is alleen van binnen het netwerk bereikbaar. Bijvoorbeeld een *Managed DevOps Pool* of eigen agents in een subnet van de landing zone, met Node 22, de Azure CLI, Docker (voor ZAP) en toegang tot npm. Zet de naam bij de parameter `uitrolPool` in `azure-pipelines.yml`.
4. **Variabelengroepen** (*Pipelines → Library*), één per omgeving: `grip-dev`, `grip-tst`, `grip-acc`, `grip-prd`. Bij voorkeur gekoppeld aan een Key Vault van het platform. Geheimen als *secret*.

| Variabele | Geheim | Wat |
|---|---|---|
| `RESOURCEGROEP` | | De resourcegroep van GRIP in dit abonnement. |
| `ENTRA_TENANT_ID` | | Directory (tenant) ID van DELA. |
| `ENTRA_CLIENT_ID` | | Application (client) ID van de app-registratie van deze omgeving. |
| `ENTRA_CLIENT_SECRET` | ja | Client secret van die app-registratie. |
| `SESSIE_GEHEIM` | ja | Minstens 32 willekeurige tekens (`openssl rand -base64 48`). Vervangen logt iedereen uit. |
| `DATABASE_WACHTWOORD` | ja | Wachtwoord van de databasebeheerder; minstens 8 tekens met hoofdletters, kleine letters en cijfers. |
| `GRIP_BEHEERDER` | | Het werkaccount dat bij de eerste keer inloggen beheerder wordt. |
| `MELDINGEN_AAN` | | Optioneel: e-mailadres voor meldingen uit de monitoring. |
| `LOG_ANALYTICS_ID` | | Optioneel: de centrale Log Analytics-werkruimte; zonder maakt GRIP een eigen. |

5. **Parameterbestanden**: vul in `infra/omgevingen/*.bicepparam` de namen van het VNet en de subnets in (bij `TODO`), en het interne adres (`publiekAdres`) zodra dat bekend is.
6. **App-registratie**: na de eerste uitrol staat het terugadres in de log van de stap *Infrastructuur* (`.../auth/entra/callback`); zet het als Redirect URI (platform *Web*) bij de app-registratie van die omgeving.

## Wat de app in Azure gebruikt

De Bicep zet alle instellingen zelf; geheimen staan in de Key Vault en de app leest ze met haar managed identity.

| Instelling | Waar het vandaan komt |
|---|---|
| `DATABASE_URL`, `ENTRA_CLIENT_SECRET`, `SESSIE_GEHEIM` | Key Vault-verwijzing |
| `GRIP_URL`, `GRIP_BEHEERDER`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID` | Bicep-parameters |
| `GRIP_OMGEVING` | `test` op dev, tst en acc (bovenaan elke pagina *Testomgeving*); leeg op prd |
| `GRIP_DAGTAAK=intern` | De app start zelf elke ochtend na 06:00 de voorspelling |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Application Insights |
| `AI_URL`, `AI_MODEL` | Alleen met `metAi = true`; inloggen met de managed identity, zonder sleutel |

// GRIP in Azure: de app (App Service, Linux, Node 22), de database (PostgreSQL Flexible Server 16) en elke ochtend de
// dagelijkse voorspelling (Logic App). Met metTest ook een testomgeving: een tweede app op hetzelfde plan, met een
// eigen databaseserver en een eigen beheerderswachtwoord, zodat test nooit bij de gegevens van productie kan. Alleen de
// eigen app komt bij een database (firewall.bicep). Met metAi ook Azure OpenAI voor de AI-roosterassistent. Het
// inloggen (de app-registratie in Entra ID) staat in azure/README.md.

@description('Korte naam; de resources heten daarnaar.')
param naam string = 'grip'

param locatie string = resourceGroup().location

@description('Grootte van de App Service: B1 om te beginnen, P0v3 voor meer snelheid, F1 gratis (slaapt als niemand hem gebruikt, en heeft een dagquotum).')
param appGrootte string = 'B1'

var gratis = appGrootte == 'F1'

param databaseBeheerder string = 'gripbeheer'

@secure()
param databaseWachtwoord string

@description('Wachtwoord van de beheerder van de databaseserver van test: een eigen server, dus nooit hetzelfde als productie. Alleen met metTest.')
@secure()
param databaseWachtwoordTest string = ''

@description('Directory (tenant) ID van de eigen organisatie.')
param entraTenantId string

@description('Application (client) ID van de app-registratie.')
param entraClientId string

@secure()
param entraClientSecret string

@description('Minstens 32 willekeurige tekens: versleutelt de sessie van wie is ingelogd.')
@secure()
param sessieGeheim string

@description('Minstens 32 willekeurige tekens: alleen de dagelijkse taak kent hem.')
@secure()
param cronGeheim string

@description('E-mailadres van de eerste beheerder; die logt in met het werkaccount en geeft daarna collega\'s toegang.')
param eersteBeheerder string

@description('Eigen domeinnaam zonder https://, zoals gripapp.nl. Leeg: het Azure-adres. Niet in de gratis versie (F1).')
param eigenAdres string = ''

@description('Ook een testomgeving (app en database), naast productie.')
param metTest bool = false

@description('Minstens 32 willekeurige tekens: de sessie op de testomgeving. Alleen met metTest.')
@secure()
param sessieGeheimTest string = ''

@description('Minstens 32 willekeurige tekens: de dagelijkse taak op de testomgeving. Alleen met metTest.')
@secure()
param cronGeheimTest string = ''

@description('AI-roosterassistent: ook een Azure OpenAI-resource met een model neerzetten. De app krijgt het adres en de sleutel dan vanzelf.')
param metAi bool = false

@description('Regio van de Azure OpenAI-resource; niet elk model is in elke regio beschikbaar.')
param aiLocatie string = 'swedencentral'

@description('Het model in Azure OpenAI, met de versie. Moet antwoorden volgens een JSON-schema ondersteunen (structured outputs).')
param aiModelNaam string = 'gpt-4.1'
param aiModelVersie string = '2025-04-14'

@description('Hoeveel het model mag verwerken, in duizenden tokens per minuut.')
param aiCapaciteit int = 50

@description('Zonder metAi: het adres van een bestaande Azure OpenAI-resource, zoals https://naam.openai.azure.com. Leeg: alleen de eigen controle.')
param aiUrl string = ''

@description('Zonder metAi: de sleutel van die resource.')
@secure()
param aiSleutel string = ''

@description('Zonder metAi: de naam van de modeldeployment in die resource.')
param aiModel string = ''

@secure()
param openmeteoSleutel string = ''

// met de regio erin: een nieuwe poging in een andere regio botst niet met een naam die Azure nog vasthoudt
var achtervoegsel = uniqueString(resourceGroup().id, locatie)

resource database 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: '${naam}-db-${achtervoegsel}'
  location: locatie
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '16'
    administratorLogin: databaseBeheerder
    administratorLoginPassword: databaseWachtwoord
    storage: { storageSizeGB: 32, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: 14, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    authConfig: { passwordAuth: 'Enabled', activeDirectoryAuth: 'Disabled' }
  }
}

resource gripDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: database
  name: 'grip'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${naam}-plan'
  location: locatie
  kind: 'linux'
  sku: { name: appGrootte }
  properties: { reserved: true }
}

var siteConfig = {
  linuxFxVersion: 'NODE|22-lts'
  appCommandLine: 'node server.js'
  // altijd aan: de live meldingen en de verbinding met de database blijven dan open (niet in de gratis versie)
  alwaysOn: !gratis
  ftpsState: 'Disabled'
  minTlsVersion: '1.2'
  http20Enabled: true
  healthCheckPath: gratis ? null : '/login'
}

resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: '${naam}-${achtervoegsel}'
  location: locatie
  kind: 'app,linux'
  properties: { serverFarmId: plan.id, httpsOnly: true, clientAffinityEnabled: false, siteConfig: siteConfig }
}

// De AI-roosterassistent: Azure OpenAI met één model. Data zone standard: de vragen worden alleen in de EU verwerkt.
resource ai 'Microsoft.CognitiveServices/accounts@2024-10-01' = if (metAi) {
  name: '${naam}-ai-${achtervoegsel}'
  location: aiLocatie
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: '${naam}-ai-${achtervoegsel}'
    publicNetworkAccess: 'Enabled'
  }
}

resource aiDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = if (metAi) {
  parent: ai
  name: 'roosteradvies'
  sku: { name: 'DataZoneStandard', capacity: aiCapaciteit }
  properties: {
    model: { format: 'OpenAI', name: aiModelNaam, version: aiModelVersie }
  }
}

var aiInstellingen = metAi ? {
  AI_URL: ai!.properties.endpoint
  // listKeys als functie: ai!.listKeys() laat oudere Bicep-versies (zoals 0.36) vastlopen
  #disable-next-line use-resource-symbol-reference
  AI_SLEUTEL: listKeys(ai.id, ai.apiVersion).key1
  AI_MODEL: aiDeployment!.name
} : {
  AI_URL: aiUrl
  AI_SLEUTEL: aiSleutel
  AI_MODEL: aiModel
}

// Alleen de uitgaande adressen van de app komen bij de database; andere diensten in Azure en de rest van internet niet.
module firewall 'firewall.bicep' = {
  name: 'firewall'
  params: { server: database.name, adressen: app.properties.possibleOutboundIpAddresses }
}

var appAdres = 'https://${app.properties.defaultHostName}'
// wat de browser gebruikt; de Logic Apps praten rechtstreeks met het Azure-adres
var publiekAdres = empty(eigenAdres) ? appAdres : 'https://${eigenAdres}'
var databaseServer = 'postgres://${databaseBeheerder}:${uriComponent(databaseWachtwoord)}@${database.properties.fullyQualifiedDomainName}:5432'

resource instellingen 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: app
  name: 'appsettings'
  properties: union(aiInstellingen, {
    DATABASE_URL: '${databaseServer}/grip?sslmode=verify-full'
    GRIP_URL: publiekAdres
    GRIP_BEHEERDER: eersteBeheerder
    ENTRA_TENANT_ID: entraTenantId
    ENTRA_CLIENT_ID: entraClientId
    ENTRA_CLIENT_SECRET: entraClientSecret
    SESSIE_GEHEIM: sessieGeheim
    CRON_SECRET: cronGeheim
    OPENMETEO_API_KEY: openmeteoSleutel
    HOSTNAME: '0.0.0.0'
    SCM_DO_BUILD_DURING_DEPLOYMENT: 'false'
  })
  dependsOn: [gripDatabase, firewall, aiDeployment]
}

// De testomgeving: dezelfde app, met een eigen databaseserver (eigen beheerder en wachtwoord), een eigen sessiegeheim en
// een eigen dagelijkse taak (voorspelling en opruimen volgens de bewaartermijnen, net als productie). Test krijgt elke
// push naar main; een fout of lek daar mag nooit bij de gegevens van productie komen. Bovenaan elke pagina staat dat het
// de testomgeving is.
resource databaseTest 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = if (metTest) {
  name: '${naam}-db-test-${achtervoegsel}'
  location: locatie
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '16'
    administratorLogin: databaseBeheerder
    administratorLoginPassword: databaseWachtwoordTest
    storage: { storageSizeGB: 32, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    authConfig: { passwordAuth: 'Enabled', activeDirectoryAuth: 'Disabled' }
  }
}

resource gripDatabaseTest 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = if (metTest) {
  parent: databaseTest
  name: 'grip_test'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

resource appTest 'Microsoft.Web/sites@2023-12-01' = if (metTest) {
  name: '${naam}-test-${achtervoegsel}'
  location: locatie
  kind: 'app,linux'
  properties: { serverFarmId: plan.id, httpsOnly: true, clientAffinityEnabled: false, siteConfig: siteConfig }
}

module firewallTest 'firewall.bicep' = if (metTest) {
  name: 'firewall-test'
  params: { server: metTest ? databaseTest!.name : '', adressen: metTest ? appTest!.properties.possibleOutboundIpAddresses : '' }
}

var testAdres = metTest ? 'https://${appTest!.properties.defaultHostName}' : ''
var databaseServerTest = metTest ? 'postgres://${databaseBeheerder}:${uriComponent(databaseWachtwoordTest)}@${databaseTest!.properties.fullyQualifiedDomainName}:5432' : ''
var publiekTestAdres = !metTest ? '' : empty(eigenAdres) ? testAdres : 'https://test.${eigenAdres}'

resource instellingenTest 'Microsoft.Web/sites/config@2023-12-01' = if (metTest) {
  parent: appTest
  name: 'appsettings'
  properties: union(aiInstellingen, {
    DATABASE_URL: '${databaseServerTest}/grip_test?sslmode=verify-full'
    GRIP_URL: publiekTestAdres
    GRIP_OMGEVING: 'test'
    GRIP_BEHEERDER: eersteBeheerder
    ENTRA_TENANT_ID: entraTenantId
    ENTRA_CLIENT_ID: entraClientId
    ENTRA_CLIENT_SECRET: entraClientSecret
    SESSIE_GEHEIM: sessieGeheimTest
    CRON_SECRET: cronGeheimTest
    OPENMETEO_API_KEY: openmeteoSleutel
    HOSTNAME: '0.0.0.0'
    SCM_DO_BUILD_DURING_DEPLOYMENT: 'false'
  })
  dependsOn: [gripDatabaseTest, firewallTest, aiDeployment]
}

// Elke ochtend om 6:00 Nederlandse tijd, en tot 12:00 elk uur: de app weet zelf of de taak al gedaan is. Was om 6:00
// een bron niet bereikbaar (een storing), dan probeert het uur erna het opnieuw, met een nieuwe voorspelling.
resource dagelijks 'Microsoft.Logic/workflows@2019-05-01' = {
  name: '${naam}-dagelijks'
  location: locatie
  properties: {
    state: 'Enabled'
    parameters: { geheim: { value: cronGeheim } }
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      contentVersion: '1.0.0.0'
      parameters: { geheim: { type: 'securestring' } }
      triggers: {
        elkeOchtend: {
          type: 'Recurrence'
          recurrence: { frequency: 'Day', interval: 1, timeZone: 'W. Europe Standard Time', schedule: { hours: range(6, 7), minutes: [0] } }
        }
      }
      actions: {
        voorspelling: {
          type: 'Http'
          inputs: {
            method: 'GET'
            uri: '${appAdres}/api/taken/dagelijks'
            headers: { Authorization: 'Bearer @{parameters(\'geheim\')}' }
            retryPolicy: { type: 'fixed', count: 2, interval: 'PT10M' }
          }
        }
      }
    }
  }
}

// De dagelijkse taak van de testomgeving, met een eigen sleutel: zo ruimt ook test op volgens de bewaartermijnen.
resource dagelijksTest 'Microsoft.Logic/workflows@2019-05-01' = if (metTest) {
  name: '${naam}-dagelijks-test'
  location: locatie
  properties: {
    state: 'Enabled'
    parameters: { geheim: { value: cronGeheimTest } }
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      contentVersion: '1.0.0.0'
      parameters: { geheim: { type: 'securestring' } }
      triggers: {
        elkeOchtend: {
          type: 'Recurrence'
          recurrence: { frequency: 'Day', interval: 1, timeZone: 'W. Europe Standard Time', schedule: { hours: range(6, 7), minutes: [0] } }
        }
      }
      actions: {
        voorspelling: {
          type: 'Http'
          inputs: {
            method: 'GET'
            uri: '${testAdres}/api/taken/dagelijks'
            headers: { Authorization: 'Bearer @{parameters(\'geheim\')}' }
            retryPolicy: { type: 'fixed', count: 2, interval: 'PT10M' }
          }
        }
      }
    }
  }
}

// De gratis versie valt na 20 minuten zonder bezoek in slaap en doet er dan een halve minuut over om te ontwaken.
// Overdag houdt een aanvraag per kwartier hem wakker.
resource wakker 'Microsoft.Logic/workflows@2019-05-01' = if (gratis) {
  name: '${naam}-wakker'
  location: locatie
  properties: {
    state: 'Enabled'
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      contentVersion: '1.0.0.0'
      triggers: {
        elkKwartier: {
          type: 'Recurrence'
          recurrence: {
            frequency: 'Day'
            interval: 1
            timeZone: 'W. Europe Standard Time'
            schedule: { hours: range(6, 17), minutes: [0, 15, 30, 45] }
          }
        }
      }
      actions: {
        wekken: {
          type: 'Http'
          inputs: { method: 'GET', uri: '${appAdres}/login', retryPolicy: { type: 'none' } }
        }
      }
    }
  }
}

output appAdres string = appAdres
output publiekAdres string = publiekAdres
output terugAdres string = '${publiekAdres}/auth/entra/callback'
output appNaam string = app.name
output databaseServer string = database.properties.fullyQualifiedDomainName
output databaseServerTest string = metTest ? databaseTest!.properties.fullyQualifiedDomainName : ''
output testAppNaam string = metTest ? appTest!.name : ''
output testAdres string = testAdres
output publiekTestAdres string = publiekTestAdres
output aiNaam string = metAi ? ai!.name : ''
output terugAdresTest string = metTest ? '${publiekTestAdres}/auth/entra/callback' : ''

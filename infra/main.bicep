// GRIP in de Azure landing zone van DELA: één omgeving (dev, tst, acc of prd) per abonnement.
//
// Alles staat in het netwerk van de landing zone, zonder publieke toegang:
// - de app (App Service, Linux, Node 22) met VNet-integratie voor het uitgaande verkeer en een private endpoint voor
//   het inkomende verkeer;
// - de database (PostgreSQL Flexible Server 16) alleen via een private endpoint;
// - de geheimen in een Key Vault, die de app leest met een eigen managed identity;
// - monitoring met Application Insights en Log Analytics, met meldingen bij fouten;
// - optioneel Azure OpenAI voor de AI-roosterassistent, ook via een private endpoint en zonder sleutel.
// De dagelijkse voorspelling plant de app zelf (GRIP_DAGTAAK=intern); een Logic App kan een afgesloten app niet bereiken.
// DNS, firewall en het VNet regelt DELA centraal. De waarden per omgeving staan in infra/omgevingen/*.bicepparam.

targetScope = 'resourceGroup'

@allowed(['dev', 'tst', 'acc', 'prd'])
param omgeving string

param locatie string = resourceGroup().location

@description('Begin van de namen, zoals gripapp; de namen volgen <naam>-<omgeving>-we-<soort>.')
param naam string = 'gripapp'

param tags object = {}

// ── Netwerk (van de landing zone) ──────────────────────────────────────────────────────────────────────────────────

@description('Resourcegroep van het VNet, zoals core-networking-gripapp-dev-we-rg.')
param vnetResourceGroep string

param vnetNaam string

@description('Subnet voor de VNet-integratie van de app (gedelegeerd aan Microsoft.Web/serverFarms).')
param subnetApp string

@description('Subnet voor de private endpoints.')
param subnetPrivateEndpoints string

@description('Alleen als de private DNS-zones hier gekoppeld moeten worden; bij DELA doet Azure Policy dat. Sleutels: sites, postgres, vault, openai.')
param dnsZones object = {}

// ── App ────────────────────────────────────────────────────────────────────────────────────────────────────────────

@description('Grootte van het App Service-plan. P0v3 of hoger; B1 kan ook voor dev.')
param appGrootte string = 'P0v3'

@description('Het adres waarop gebruikers GRIP openen, met https://. Leeg: het Azure-adres van de app.')
param publiekAdres string = ''

@description('E-mailadres(sen) van de eerste beheerder, met een komma ertussen.')
param eersteBeheerder string

@description('Directory (tenant) ID van DELA.')
param entraTenantId string

@description('Application (client) ID van de app-registratie van deze omgeving.')
param entraClientId string

@secure()
@description('Client secret van de app-registratie. Komt in de Key Vault.')
param entraClientSecret string

@secure()
@description('Minstens 32 willekeurige tekens: versleutelt de sessie. Komt in de Key Vault.')
param sessieGeheim string

@secure()
param openmeteoSleutel string = ''

// ── Database ───────────────────────────────────────────────────────────────────────────────────────────────────────

param databaseBeheerder string = 'gripbeheer'

@secure()
@description('Wachtwoord van de databasebeheerder. Komt (in DATABASE_URL) in de Key Vault.')
param databaseWachtwoord string

param databaseGrootte string = 'Standard_B1ms'
param databaseLaag string = 'Burstable'
param databaseOpslagGB int = 32

@description('Dagen dat de database terug te zetten is (7 tot 35).')
param backupDagen int = omgeving == 'prd' ? 35 : 7

param geoBackup bool = false

// ── Monitoring ─────────────────────────────────────────────────────────────────────────────────────────────────────

@description('Bestaande (centrale) Log Analytics-werkruimte. Leeg: GRIP maakt een eigen.')
param logAnalyticsId string = ''

@description('E-mailadres voor meldingen als de app fouten geeft of niet gezond is. Leeg: geen meldingen.')
param meldingenAan string = ''

// ── AI-roosterassistent ────────────────────────────────────────────────────────────────────────────────────────────

param metAi bool = false
param aiLocatie string = locatie
param aiModelNaam string = 'gpt-4.1'
param aiModelVersie string = '2025-04-14'

@description('Duizenden tokens per minuut.')
param aiCapaciteit int = 50

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

var basis = '${naam}-${omgeving}-we'
// sommige namen moeten wereldwijd uniek zijn
var uniek = take(uniqueString(subscription().id, resourceGroup().id), 5)
var alleTags = union({ applicatie: 'GRIP', omgeving: omgeving }, tags)
var subnetAppId = resourceId(vnetResourceGroep, 'Microsoft.Network/virtualNetworks/subnets', vnetNaam, subnetApp)
var subnetPeId = resourceId(vnetResourceGroep, 'Microsoft.Network/virtualNetworks/subnets', vnetNaam, subnetPrivateEndpoints)

// ── Identiteit van de app ──────────────────────────────────────────────────────────────────────────────────────────

resource identiteit 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${basis}-id'
  location: locatie
  tags: alleTags
}

// ── Monitoring ─────────────────────────────────────────────────────────────────────────────────────────────────────

resource werkruimte 'Microsoft.OperationalInsights/workspaces@2023-09-01' = if (empty(logAnalyticsId)) {
  name: '${basis}-log'
  location: locatie
  tags: alleTags
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: omgeving == 'prd' ? 90 : 30 }
}

var werkruimteId = empty(logAnalyticsId) ? werkruimte.id : logAnalyticsId

resource inzicht 'Microsoft.Insights/components@2020-02-02' = {
  name: '${basis}-appi'
  location: locatie
  tags: alleTags
  kind: 'web'
  properties: { Application_Type: 'Node.JS', WorkspaceResourceId: werkruimteId, DisableLocalAuth: false }
}

// ── Key Vault ──────────────────────────────────────────────────────────────────────────────────────────────────────

resource kluis 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: take('${naam}-${omgeving}-kv-${uniek}', 24)
  location: locatie
  tags: alleTags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: 'Disabled'
    networkAcls: { defaultAction: 'Deny', bypass: 'AzureServices' }
  }
}

var databaseServerNaam = '${basis}-psql-${uniek}'
var databaseUrl = 'postgres://${databaseBeheerder}:${uriComponent(databaseWachtwoord)}@${databaseServerNaam}.postgres.database.azure.com:5432/grip?sslmode=verify-full'

var geheimen = union({
  'database-url': databaseUrl
  'entra-client-secret': entraClientSecret
  'sessie-geheim': sessieGeheim
}, empty(openmeteoSleutel) ? {} : { 'openmeteo-sleutel': openmeteoSleutel })

// via Azure Resource Manager; daarvoor hoeft de pipeline niet in het netwerk
resource geheim 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = [for g in items(geheimen): {
  parent: kluis
  name: g.key
  properties: { value: g.value }
}]

// Key Vault Secrets User
resource magGeheimenLezen 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: kluis
  name: guid(kluis.id, identiteit.id, 'kv-secrets-user')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: identiteit.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

module kluisPe 'modules/private-endpoint.bicep' = {
  name: 'pe-kv'
  params: {
    naam: '${basis}-kv-pe'
    locatie: locatie
    subnetId: subnetPeId
    doelId: kluis.id
    groep: 'vault'
    dnsZoneId: dnsZones.?vault ?? ''
    tags: alleTags
  }
}

// ── Database ───────────────────────────────────────────────────────────────────────────────────────────────────────

resource database 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: databaseServerNaam
  location: locatie
  tags: alleTags
  sku: { name: databaseGrootte, tier: databaseLaag }
  properties: {
    version: '16'
    administratorLogin: databaseBeheerder
    administratorLoginPassword: databaseWachtwoord
    storage: { storageSizeGB: databaseOpslagGB, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: backupDagen, geoRedundantBackup: geoBackup ? 'Enabled' : 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    authConfig: { passwordAuth: 'Enabled', activeDirectoryAuth: 'Disabled' }
    network: { publicNetworkAccess: 'Disabled' }
  }
}

resource gripDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: database
  name: 'grip'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

module databasePe 'modules/private-endpoint.bicep' = {
  name: 'pe-psql'
  params: {
    naam: '${basis}-psql-pe'
    locatie: locatie
    subnetId: subnetPeId
    doelId: database.id
    groep: 'postgresqlServer'
    dnsZoneId: dnsZones.?postgres ?? ''
    tags: alleTags
  }
}

// ── AI-roosterassistent ────────────────────────────────────────────────────────────────────────────────────────────

resource ai 'Microsoft.CognitiveServices/accounts@2024-10-01' = if (metAi) {
  name: '${basis}-oai-${uniek}'
  location: aiLocatie
  tags: alleTags
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: '${basis}-oai-${uniek}'
    publicNetworkAccess: 'Disabled'
    // alleen met de managed identity, zonder sleutel
    disableLocalAuth: true
    networkAcls: { defaultAction: 'Deny' }
  }
}

resource aiModel 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = if (metAi) {
  parent: ai
  name: 'roosteradvies'
  // Data Zone Standard: de vragen worden alleen binnen de EU verwerkt
  sku: { name: 'DataZoneStandard', capacity: aiCapaciteit }
  properties: { model: { format: 'OpenAI', name: aiModelNaam, version: aiModelVersie } }
}

// Cognitive Services OpenAI User
resource magAiGebruiken 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (metAi) {
  scope: ai
  name: guid(resourceGroup().id, identiteit.id, 'openai-user')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
    principalId: identiteit.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

module aiPe 'modules/private-endpoint.bicep' = if (metAi) {
  name: 'pe-oai'
  params: {
    naam: '${basis}-oai-pe'
    locatie: locatie
    subnetId: subnetPeId
    doelId: ai.id
    groep: 'account'
    dnsZoneId: dnsZones.?openai ?? ''
    tags: alleTags
  }
}

// ── App ────────────────────────────────────────────────────────────────────────────────────────────────────────────

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${basis}-asp'
  location: locatie
  tags: alleTags
  kind: 'linux'
  sku: { name: appGrootte }
  properties: { reserved: true }
}

resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: '${basis}-app-${uniek}'
  location: locatie
  tags: alleTags
  kind: 'app,linux'
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identiteit.id}': {} } }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    publicNetworkAccess: 'Disabled'
    virtualNetworkSubnetId: subnetAppId
    keyVaultReferenceIdentity: identiteit.id
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      appCommandLine: 'node server.js'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      http20Enabled: true
      healthCheckPath: '/api/gezond'
      // al het uitgaande verkeer door het VNet, ook naar de bronnen op internet (via de firewall van DELA)
      vnetRouteAllEnabled: true
    }
  }
}

// geen publiceren met gebruikersnaam en wachtwoord; de pipeline logt in met Entra ID
resource geenFtp 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: app
  name: 'ftp'
  properties: { allow: false }
}

resource geenScmWachtwoord 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: app
  name: 'scm'
  properties: { allow: false }
}

module appPe 'modules/private-endpoint.bicep' = {
  name: 'pe-app'
  params: {
    naam: '${basis}-app-pe'
    locatie: locatie
    subnetId: subnetPeId
    doelId: app.id
    groep: 'sites'
    dnsZoneId: dnsZones.?sites ?? ''
    tags: alleTags
  }
}

var kluisRef = '@Microsoft.KeyVault(VaultName=${kluis.name};SecretName='
var adres = empty(publiekAdres) ? 'https://${app.properties.defaultHostName}' : publiekAdres

resource instellingen 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: app
  name: 'appsettings'
  properties: union({
    DATABASE_URL: '${kluisRef}database-url)'
    ENTRA_CLIENT_SECRET: '${kluisRef}entra-client-secret)'
    SESSIE_GEHEIM: '${kluisRef}sessie-geheim)'
    ENTRA_TENANT_ID: entraTenantId
    ENTRA_CLIENT_ID: entraClientId
    GRIP_URL: adres
    GRIP_BEHEERDER: eersteBeheerder
    // alleen productie zonder de balk 'Testomgeving'
    GRIP_OMGEVING: omgeving == 'prd' ? '' : 'test'
    GRIP_DAGTAAK: 'intern'
    AZURE_CLIENT_ID: identiteit.properties.clientId
    APPLICATIONINSIGHTS_CONNECTION_STRING: inzicht.properties.ConnectionString
    ApplicationInsightsAgent_EXTENSION_VERSION: '~3'
    HOSTNAME: '0.0.0.0'
    SCM_DO_BUILD_DURING_DEPLOYMENT: 'false'
  }, empty(openmeteoSleutel) ? {} : {
    OPENMETEO_API_KEY: '${kluisRef}openmeteo-sleutel)'
  }, metAi ? {
    AI_URL: ai!.properties.endpoint
    AI_MODEL: aiModel!.name
  } : {})
  dependsOn: [geheim, magGeheimenLezen, gripDatabase, kluisPe, databasePe]
}

// ── Logboeken en meldingen ─────────────────────────────────────────────────────────────────────────────────────────

resource appLogboek 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: app
  name: 'naar-log-analytics'
  properties: {
    workspaceId: werkruimteId
    logs: [
      { category: 'AppServiceHTTPLogs', enabled: true }
      { category: 'AppServiceConsoleLogs', enabled: true }
      { category: 'AppServicePlatformLogs', enabled: true }
    ]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}

resource databaseLogboek 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: database
  name: 'naar-log-analytics'
  properties: {
    workspaceId: werkruimteId
    logs: [{ categoryGroup: 'allLogs', enabled: true }]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}

resource kluisLogboek 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: kluis
  name: 'naar-log-analytics'
  properties: {
    workspaceId: werkruimteId
    logs: [{ categoryGroup: 'audit', enabled: true }]
  }
}

resource meldingGroep 'Microsoft.Insights/actionGroups@2023-01-01' = if (!empty(meldingenAan)) {
  name: '${basis}-ag'
  location: 'global'
  tags: alleTags
  properties: {
    groupShortName: take('grip${omgeving}', 12)
    enabled: true
    emailReceivers: [{ name: 'beheer', emailAddress: meldingenAan, useCommonAlertSchema: true }]
  }
}

var acties = empty(meldingenAan) ? [] : [{ actionGroupId: meldingGroep.id }]

resource meldingFouten 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${basis}-fouten'
  location: 'global'
  tags: alleTags
  properties: {
    description: 'GRIP geeft serverfouten (5xx).'
    severity: 2
    enabled: true
    scopes: [app.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [{ name: 'fouten', metricName: 'Http5xx', operator: 'GreaterThan', threshold: 5, timeAggregation: 'Total', criterionType: 'StaticThresholdCriterion' }]
    }
    actions: acties
  }
}

resource meldingGezond 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${basis}-gezond'
  location: 'global'
  tags: alleTags
  properties: {
    description: 'De gezondheidscheck van GRIP (/api/gezond) faalt: de app of de database antwoordt niet.'
    severity: 1
    enabled: true
    scopes: [app.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [{ name: 'gezond', metricName: 'HealthCheckStatus', operator: 'LessThan', threshold: 100, timeAggregation: 'Average', criterionType: 'StaticThresholdCriterion' }]
    }
    actions: acties
  }
}

// de dagelijkse voorspelling is mislukt (de app schrijft dat in het logboek)
resource meldingDagtaak 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: '${basis}-dagtaak'
  location: locatie
  tags: alleTags
  properties: {
    description: 'De dagelijkse voorspelling van GRIP is mislukt.'
    severity: 2
    enabled: true
    scopes: [werkruimteId]
    evaluationFrequency: 'PT1H'
    windowSize: 'PT1H'
    criteria: {
      allOf: [{
        query: 'AppServiceConsoleLogs | where _ResourceId =~ "${toLower(app.id)}" | where ResultDescription has "Dagelijkse taak" and (ResultDescription has "mislukt" or Level == "Error")'
        timeAggregation: 'Count'
        operator: 'GreaterThan'
        threshold: 0
        failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
      }]
    }
    actions: { actionGroups: empty(meldingenAan) ? [] : [meldingGroep.id] }
  }
  dependsOn: [appLogboek]
}

// ── Uitvoer ────────────────────────────────────────────────────────────────────────────────────────────────────────

output appNaam string = app.name
output appAdres string = adres
output terugAdres string = '${adres}/auth/entra/callback'
output kluisNaam string = kluis.name
output databaseServer string = database.properties.fullyQualifiedDomainName
output identiteitClientId string = identiteit.properties.clientId

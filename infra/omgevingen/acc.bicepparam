// GRIP acc in de landing zone van DELA. Geheimen komen uit de pipeline (variabelengroep grip-acc), nooit uit dit bestand.
using '../main.bicep'

param omgeving = 'acc'

// Netwerk: van Martijn / het platformteam. TODO: VNet- en subnetnamen invullen.
param vnetResourceGroep = 'core-networking-gripapp-acc-we-rg'
param vnetNaam = 'TODO-vnet-naam'
param subnetApp = 'TODO-subnet-app-integratie'
param subnetPrivateEndpoints = 'TODO-subnet-private-endpoints'

param appGrootte = 'P0v3'
// TODO: het interne adres, zoals https://grip-acc.dela.nl. Leeg: het Azure-adres.
param publiekAdres = ''

param entraTenantId = readEnvironmentVariable('ENTRA_TENANT_ID')
param entraClientId = readEnvironmentVariable('ENTRA_CLIENT_ID')
param entraClientSecret = readEnvironmentVariable('ENTRA_CLIENT_SECRET')
param sessieGeheim = readEnvironmentVariable('SESSIE_GEHEIM')
param databaseWachtwoord = readEnvironmentVariable('DATABASE_WACHTWOORD')
param eersteBeheerder = readEnvironmentVariable('GRIP_BEHEERDER')
param meldingenAan = readEnvironmentVariable('MELDINGEN_AAN', '')
param logAnalyticsId = readEnvironmentVariable('LOG_ANALYTICS_ID', '')

param metAi = false

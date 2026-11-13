// Alleen de eigen app komt bij de database: per uitgaand IP-adres van de App Service één regel. De vorige regel
// AlleenAzure (0.0.0.0) liet elke dienst in Azure toe, ook die van andere klanten.

@description('Naam van de PostgreSQL Flexible Server.')
param server string

@description('De mogelijke uitgaande IP-adressen van de App Service, met komma\'s gescheiden (possibleOutboundIpAddresses).')
param adressen string

resource database 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: server
}

// één tegelijk: de server weigert regels die tegelijk worden aangemaakt
@batchSize(1)
resource regels 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = [for (ip, i) in split(adressen, ','): {
  parent: database
  name: 'App-${i}'
  properties: { startIpAddress: trim(ip), endIpAddress: trim(ip) }
}]

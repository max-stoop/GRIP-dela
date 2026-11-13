// Een private endpoint in het subnet van de landing zone. De DNS-records regelt DELA centraal (Azure Policy);
// geef dnsZoneId alleen mee als de zone hier wel gekoppeld moet worden.
param naam string
param locatie string
param subnetId string
param doelId string
param groep string
param dnsZoneId string = ''
param tags object = {}

resource pe 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: naam
  location: locatie
  tags: tags
  properties: {
    subnet: { id: subnetId }
    privateLinkServiceConnections: [
      { name: naam, properties: { privateLinkServiceId: doelId, groupIds: [groep] } }
    ]
  }
}

resource dns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = if (!empty(dnsZoneId)) {
  parent: pe
  name: 'default'
  properties: { privateDnsZoneConfigs: [{ name: groep, properties: { privateDnsZoneId: dnsZoneId } }] }
}

#!/usr/bin/env bash
# GRIP in je eigen Azure, in één keer: de inlogkoppeling met Entra ID, de app, de database, de dagelijkse taak en, als
# je dat wilt, je eigen domeinnaam met certificaat.
#
# In Azure Cloud Shell (Bash), na het uploaden van grip-azure.zip:
#   unzip -o grip-azure.zip -d grip && ADRES=gripapp.nl bash grip/installeer.sh
#
# Nog een keer draaien maakt een onderbroken installatie af en koppelt de domeinnaam zodra die naar Azure wijst. De app
# uit app.zip komt alleen op een omgeving waar GRIP nog niet draait; nieuwe versies komen via GitHub (of met
# NEERZETTEN=1 uit app.zip). OPNIEUW=1 zet ook de resources opnieuw neer, met nieuwe geheimen; de gegevens blijven staan.
# VOORAF=1 laat bij een bestaande installatie eerst zien wat OPNIEUW=1 in Azure zou veranderen (what-if), zonder iets
# te veranderen: geen nieuwe geheimen, geen nieuwe resources.
# Instelbaar: ADRES (eigen domeinnaam; zonder: het Azure-adres), TEST=1 (ook een testomgeving, op test.ADRES), RG
# (resourcegroep, standaard grip), BEHEERDER (standaard wie is ingelogd), GROOTTE (F1 is gratis maar kan geen eigen
# domeinnaam aan; met ADRES standaard B1), LOCATIES (de regio's om te proberen), AI=1 (ook Azure OpenAI
# voor de AI-roosterassistent; AI_LOCATIE, standaard swedencentral), of AI_URL, AI_SLEUTEL en AI_MODEL van een
# bestaande Azure OpenAI-resource, GITHUB (eigenaar/repository: een push naar main zet de app daarna zelf op test, en 'Naar
# productie' op productie; zie .github/workflows).
set -euo pipefail
cd "$(dirname "$0")"

RG=${RG:-grip}
LOCATIES=${LOCATIES:-westeurope northeurope swedencentral germanywestcentral francecentral uksouth norwayeast switzerlandnorth polandcentral italynorth spaincentral ukwest}
APP_NAAM='GRIP Regelplekken'
ADRES=${ADRES:-}
ADRES=${ADRES#https://}
ADRES=${ADRES%/}
ADRES=${ADRES,,}
TEST=${TEST:-}
AI=${AI:-}
KLAAR=''
KLAAR_TEST=''

stap() { printf '\n== %s\n' "$*"; }
geheim() { openssl rand -base64 48 | tr -d '\n/+='; }
# een nieuwe app-registratie of domeinkoppeling is niet meteen overal bekend
probeer() { for i in 1 2 3 4 5 6; do "$@" && return 0; [[ $i == 6 ]] || sleep 10; done; return 1; }
uitvoer() { az deployment group show --resource-group "$RG" --name grip --query "properties.outputs.$1.value" -o tsv; }
stand() { az deployment group show --resource-group "$RG" --name grip --query properties.provisioningState -o tsv 2>/dev/null || true; }
client() { az ad app list --display-name "$APP_NAAM" --query "[0].appId" -o tsv; }
host_van() { uitvoer "$1" | sed 's#^https://##'; }

# Een nieuw abonnement mag de database niet in elke regio. Alleen overslaan als Azure dat zelf zegt; bij twijfel proberen.
database_mag() {
  local uit
  uit=$(az postgres flexible-server list-skus --location "$1" --only-show-errors \
    --query "[0].{beperkt: restricted, skus: supportedServerEditions[?name=='Burstable'].supportedServerSkus[].name | []}" -o json 2>/dev/null) || return 0
  [[ $(jq -r '.beperkt // ""' <<<"$uit") == Enabled ]] && return 1
  jq -e '(.skus // []) as $s | ($s | length) == 0 or ($s | index("Standard_B1ms")) != null' <<<"$uit" >/dev/null
}

# alleen vervangen wat anders is: een record dat even weg is, merkt wie de app op dat moment opent
zet_record() {
  local nu
  case $1 in
    a) nu=$(az network dns record-set a show -g "$RG" -z "$ADRES" -n "$2" --query "ARecords[0].ipv4Address || aRecords[0].ipv4Address" -o tsv 2>/dev/null || true) ;;
    cname) nu=$(az network dns record-set cname show -g "$RG" -z "$ADRES" -n "$2" --query "CNAMERecord.cname || cnameRecord.cname" -o tsv 2>/dev/null || true) ;;
    txt) nu=$(az network dns record-set txt show -g "$RG" -z "$ADRES" -n "$2" --query "TXTRecords[0].value[0] || txtRecords[0].value[0]" -o tsv 2>/dev/null || true) ;;
  esac
  [[ $nu == "$3" ]] && return 0
  case $1 in
    a)
      az network dns record-set a delete -g "$RG" -z "$ADRES" -n "$2" --yes --only-show-errors 2>/dev/null || true
      az network dns record-set a add-record -g "$RG" -z "$ADRES" -n "$2" --ipv4-address "$3" --only-show-errors >/dev/null ;;
    cname) az network dns record-set cname set-record -g "$RG" -z "$ADRES" -n "$2" --cname "$3" --only-show-errors >/dev/null ;;
    txt)
      az network dns record-set txt delete -g "$RG" -z "$ADRES" -n "$2" --yes --only-show-errors 2>/dev/null || true
      az network dns record-set txt add-record -g "$RG" -z "$ADRES" -n "$2" --value "$3" --only-show-errors >/dev/null ;;
  esac
}

certificaat() { az webapp config ssl show -g "$RG" --certificate-name "$1" --query thumbprint -o tsv 2>/dev/null || true; }

# Een eerdere installatie had de regel AlleenAzure (0.0.0.0): die liet elke dienst in Azure bij de database, ook van
# andere klanten. Nu staan er alleen regels voor de uitgaande adressen van de eigen app (firewall.bicep, App-0, App-1
# ...). De oude regel gaat pas weg als de nieuwe er staan; anders zou de app de database niet meer bereiken.
sluit_database() {
  local server
  server=$(uitvoer databaseServer)
  server=${server%%.*}
  [[ -n $server ]] || return 0
  local regels
  regels=$(az postgres flexible-server firewall-rule list -g "$RG" --name "$server" --query "[].name" -o tsv 2>/dev/null || true)
  if grep -qx 'AlleenAzure' <<<"$regels" && grep -q '^App-' <<<"$regels"; then
    stap "De database alleen nog open voor de eigen app"
    az postgres flexible-server firewall-rule delete -g "$RG" --name "$server" --rule-name AlleenAzure --yes --only-show-errors >/dev/null
  elif grep -qx 'AlleenAzure' <<<"$regels"; then
    echo "Let op: de database staat nog open voor heel Azure (regel AlleenAzure). Draai het script met OPNIEUW=1 om dat te sluiten."
  fi
  # de testomgeving heeft nu een eigen server; de oude testdatabase op de server van productie wordt niet meer gebruikt
  if [[ -n $TEST ]] && az postgres flexible-server db show -g "$RG" --server-name "$server" --database-name grip_test >/dev/null 2>&1; then
    echo "De oude testdatabase grip_test op de server van productie wordt niet meer gebruikt. Weghalen als je hem niet meer nodig hebt:"
    echo "  az postgres flexible-server db delete -g $RG --server-name $server --database-name grip_test --yes"
  fi
}

# De app <app> op <host> (gripapp.nl, of test.gripapp.nl als CNAME), met de records in Azure DNS en een gratis
# certificaat. Geeft 1 zolang de domeinnaam nog niet naar Azure wijst.
koppel() {
  local app=$1 host=$2 azure=$3 deel ip id duim
  deel=${host%"$ADRES"}
  deel=${deel%.}
  # een net gemaakte app is niet meteen overal in Azure bekend; het IP-adres staat al wel in de DNS
  ip=$(getent ahostsv4 "$azure" | awk 'NR==1 { print $1 }')
  id=$(probeer az webapp show -g "$RG" -n "$app" --query customDomainVerificationId -o tsv)
  [[ -n $ip && -n $id ]] || { echo "Het IP-adres of de controlecode van $app is nog niet bekend; draai het script over een paar minuten opnieuw."; exit 1; }
  if [[ -z $deel ]]; then
    zet_record a @ "$ip"
    zet_record txt asuid "$id"
  else
    zet_record cname "$deel" "$azure"
    zet_record txt "asuid.$deel" "$id"
  fi

  if [[ $(az webapp config hostname list --webapp-name "$app" -g "$RG" --query "[?name=='$host'].sslState | [0]" -o tsv 2>/dev/null || true) == SniEnabled ]]; then
    return 0
  fi
  [[ $(getent ahostsv4 "$host" | awk 'NR==1 { print $1 }') == "$ip" ]] || return 1

  stap "$host koppelen aan de app, met een gratis certificaat (een paar minuten)"
  probeer az webapp config hostname add --webapp-name "$app" -g "$RG" --hostname "$host" --only-show-errors >/dev/null
  # Azure maakt het certificaat op de achtergrond; dat kan tot een kwartier duren
  duim=$(certificaat "$host")
  if [[ -z $duim ]]; then
    az webapp config ssl create -g "$RG" -n "$app" --hostname "$host" --only-show-errors >/dev/null || true
    printf 'Wachten op het certificaat'
    for _ in $(seq 90); do
      duim=$(certificaat "$host")
      [[ -n $duim ]] && break
      printf '.'; sleep 10
    done
    printf '\n'
  fi
  [[ -n $duim ]] || { echo "Het certificaat voor $host is nog niet klaar. Draai het script over een kwartier nog een keer."; exit 1; }
  probeer az webapp config ssl bind -g "$RG" -n "$app" --certificate-thumbprint "$duim" --ssl-type SNI --only-show-errors >/dev/null
}

koppel_domein() {
  stap "De domeinnaam $ADRES in Azure DNS"
  az network dns zone create -g "$RG" -n "$ADRES" --only-show-errors >/dev/null
  if ! koppel "$(uitvoer appNaam)" "$ADRES" "$(host_van appAdres)"; then
    cat <<EOF

$ADRES wijst nog niet naar Azure. Ga naar de partij waar je $ADRES hebt gekocht en zet de nameservers op:
$(az network dns zone show -g "$RG" -n "$ADRES" --query nameServers -o tsv | sed 's/\.$//; s/^/  /')

Meestal is dat binnen een uur overal bekend, soms duurt het langer. Draai daarna dezelfde regel nog een keer;
dan koppelt het script $ADRES aan de app, met een certificaat.
EOF
    return 0
  fi
  KLAAR="https://$ADRES"
  # www.ADRES op dezelfde app, met een eigen certificaat; de app stuurt het door naar ADRES
  if ! koppel "$(uitvoer appNaam)" "www.$ADRES" "$(host_van appAdres)"; then
    echo "www.$ADRES is nog niet overal bekend. Draai het script over een paar minuten nog een keer."
  fi
  [[ -n $TEST ]] || return 0
  if koppel "$(uitvoer testAppNaam)" "test.$ADRES" "$(host_van testAdres)"; then
    KLAAR_TEST="https://test.$ADRES"
  else
    echo "test.$ADRES is nog niet overal bekend. Draai het script over een paar minuten nog een keer."
  fi
}

# Inloggen zonder wachtwoord (OIDC): Azure vertrouwt alleen GitHub Actions van deze repository op main, en alleen
# voor het neerzetten van deze ene app.
vertrouw() {
  local id=$1 naam=$2 subject=$3
  [[ -z $(az ad app federated-credential list --id "$id" --query "[?subject=='$subject'].name" -o tsv) ]] || return 0
  probeer az ad app federated-credential create --id "$id" --only-show-errors --parameters \
    "{\"name\": \"$naam\", \"issuer\": \"https://token.actions.githubusercontent.com\", \"subject\": \"$subject\", \"audiences\": [\"api://AzureADTokenExchange\"]}" >/dev/null
}

koppel_github() {
  local naam='GRIP uitrol vanuit GitHub' id sp app scope nummers
  stap "Automatisch neerzetten vanuit GitHub ($GITHUB, main)"
  id=$(az ad app list --display-name "$naam" --query "[0].appId" -o tsv)
  [[ -n $id ]] || id=$(az ad app create --display-name "$naam" --sign-in-audience AzureADMyOrg --query appId -o tsv --only-show-errors)
  az ad sp show --id "$id" >/dev/null 2>&1 || probeer az ad sp create --id "$id" --only-show-errors >/dev/null
  sp=$(probeer az ad sp show --id "$id" --query id -o tsv)
  vertrouw "$id" github-main "repo:$GITHUB:ref:refs/heads/main"
  # GitHub meldt zich ook aan met de vaste nummers van eigenaar en repository; bij een openbare repository staan die in de API
  nummers=$(curl -fsS "https://api.github.com/repos/$GITHUB" 2>/dev/null | jq -r '"\(.owner.login)@\(.owner.id)/\(.name)@\(.id)"' 2>/dev/null || true)
  if [[ $nummers == *@*/*@* ]]; then
    vertrouw "$id" github-main-id "repo:$nummers:ref:refs/heads/main"
  else
    echo "De nummers van $GITHUB zijn niet op te vragen. Faalt het inloggen in GitHub met AADSTS700213, voeg dan het subject uit die melding toe:"
    echo "  az ad app federated-credential create --id $id --parameters '{\"name\": \"github-main-id\", \"issuer\": \"https://token.actions.githubusercontent.com\", \"subject\": \"<subject uit de melding>\", \"audiences\": [\"api://AzureADTokenExchange\"]}'"
  fi
  for app in $(uitvoer appNaam) $(uitvoer testAppNaam); do
    scope=$(probeer az webapp show -g "$RG" -n "$app" --query id -o tsv)
    if [[ -z $(az role assignment list --assignee "$sp" --scope "$scope" --role 'Website Contributor' --query '[0].id' -o tsv) ]]; then
      probeer az role assignment create --assignee-object-id "$sp" --assignee-principal-type ServicePrincipal \
        --role 'Website Contributor' --scope "$scope" --only-show-errors >/dev/null
    fi
  done
  cat <<EOF

Zet deze waarden in .github/workflows/test.yml en productie.yml (onder env):
  AZURE_CLIENT_ID: $id
  AZURE_TENANT_ID: $(az account show --query tenantId -o tsv)
  AZURE_SUBSCRIPTION_ID: $(az account show --query id -o tsv)
  RESOURCEGROEP: $RG
  APP: $(uitvoer appNaam)
  TEST_APP: $(uitvoer testAppNaam)
EOF
}

# app.zip alleen waar GRIP nog niet draait: een nieuwere versie van GitHub wordt zo niet overschreven
zet_neer() {
  local app=$1 adres=$2
  if [[ ${NEERZETTEN:-} == 1 ]] || ! curl -fsS -o /dev/null "$adres/api/versie"; then
    stap "De app neerzetten op $app"
    az webapp deploy --resource-group "$RG" --name "$app" --src-path app.zip --type zip --only-show-errors >/dev/null
  fi
  printf 'Wachten tot %s antwoordt' "$adres"
  for _ in $(seq 60); do
    if curl -fsS -o /dev/null "$adres/login"; then printf '\n'; return 0; fi
    printf '.'; sleep 5
  done
  printf '\nDe app antwoordt nog niet. Kijk in de portal bij de App Service onder Log stream.\n'
  return 1
}

afmaken() {
  stap "Het terugadres na inloggen"
  local terug=("$(uitvoer terugAdres)")
  if [[ -n $TEST ]]; then terug+=("$(uitvoer terugAdresTest)"); fi
  probeer az ad app update --id "$(client)" --web-redirect-uris "${terug[@]}" --only-show-errors

  sluit_database
  zet_neer "$(uitvoer appNaam)" "$(uitvoer appAdres)" || return 1
  if [[ -n $TEST ]]; then zet_neer "$(uitvoer testAppNaam)" "$(uitvoer testAdres)" || return 1; fi
  if [[ -n $ADRES ]]; then
    koppel_domein
  else
    KLAAR=$(uitvoer appAdres)
    if [[ -n $TEST ]]; then KLAAR_TEST=$(uitvoer testAdres); fi
  fi
  if [[ -n ${GITHUB:-} ]]; then koppel_github; fi
  if [[ -n $KLAAR ]]; then
    printf '\nKlaar: %s\n' "$KLAAR"
    if [[ -n $KLAAR_TEST ]]; then printf 'Testomgeving: %s (met een eigen database)\n' "$KLAAR_TEST"; fi
    cat <<EOF
Log daar in met je Microsoft-account. De eerste keer zet de app de database klaar; dat duurt een paar seconden.
Collega's geef je toegang onder Instellingen > Gebruikers. Wie van een andere organisatie komt, krijgt dan een
uitnodiging van Microsoft, als de app-registratie de machtiging User.Invite.All heeft (zie azure/README.md).
EOF
  fi
}

[[ -f app.zip && -f main.json ]] || { echo "app.zip en main.json moeten naast dit script staan."; exit 1; }
az account show >/dev/null 2>&1 || { echo "Eerst inloggen: az login"; exit 1; }

if [[ $(az group show --name "$RG" --query properties.provisioningState -o tsv 2>/dev/null) == Deleting ]]; then
  echo "Wachten tot een vorige poging is opgeruimd"
  az group wait --deleted --name "$RG"
fi
BESTAAND=$(az group show --name "$RG" --query location -o tsv 2>/dev/null || true)
if [[ -n "$BESTAAND" ]]; then
  # na een onderbroken Cloud Shell loopt de installatie in Azure gewoon door
  while [[ $(stand) =~ ^(Accepted|Running|Deploying)$ ]]; do echo "De vorige installatie loopt nog"; sleep 20; done
  if [[ $(stand) == Succeeded ]]; then
    VORIG=$(uitvoer publiekAdres 2>/dev/null || true)
    VORIG=${VORIG#https://}
    if [[ $VORIG == *.azurewebsites.net ]]; then VORIG=''; fi
    VORIG_TEST=$(uitvoer testAppNaam 2>/dev/null || true)
    VORIG_AI=$(uitvoer aiNaam 2>/dev/null || true)
    # de domeinnaam en de testomgeving van de vorige keer blijven; iets nieuws vraagt de resources opnieuw
    ADRES=${ADRES:-$VORIG}
    if [[ -n $VORIG_TEST ]]; then TEST=1; fi
    if [[ -n $VORIG_AI ]]; then AI=1; fi
    if [[ "${OPNIEUW:-}" != 1 && "${VOORAF:-}" != 1 && $ADRES == "$VORIG" && ( -z $TEST || -n $VORIG_TEST ) && ( -z $AI || -n $VORIG_AI ) ]]; then afmaken; exit; fi
  fi
  LOCATIES=$BESTAAND
fi

GROOTTE=${GROOTTE:-$([[ -n $ADRES ]] && echo B1 || echo F1)}
if [[ -n $ADRES && $GROOTTE == F1 ]]; then echo "De gratis versie (F1) kan geen eigen domeinnaam aan; gebruik GROOTTE=B1."; exit 1; fi

ACCOUNT=$(az account show --query user.name -o tsv)
# een persoonlijk Microsoft-account heet hier live.com#naam@voorbeeld.nl; in het inlogbewijs staat alleen het adres
BEHEERDER=${BEHEERDER:-${ACCOUNT##*#}}
TENANT=$(az account show --query tenantId -o tsv)
echo "Beheerder: $BEHEERDER (logt in met dit account en geeft daarna collega's toegang)"

stap "Diensten aanzetten in het abonnement"
for p in Microsoft.Web Microsoft.DBforPostgreSQL Microsoft.Logic Microsoft.Network $([[ -n $AI ]] && echo Microsoft.CognitiveServices); do
  az provider register --namespace "$p" --wait --only-show-errors
done

stap "Inloggen met het werkaccount: de app-registratie in Entra ID"
CLIENT=$(client)
if [[ ${VOORAF:-} == 1 && ( -z "$BESTAAND" || -z "$CLIENT" ) ]]; then echo "VOORAF=1 werkt alleen op een bestaande installatie."; exit 1; fi
if [[ -z "$CLIENT" ]]; then
  CLIENT=$(az ad app create --display-name "$APP_NAAM" --sign-in-audience AzureADMyOrg --query appId -o tsv --only-show-errors)
fi
if [[ ${VOORAF:-} == 1 ]]; then
  # alleen bekijken: geen nieuw client secret (dat zou het inloggen op de draaiende app breken)
  CLIENT_GEHEIM='wordt-bij-het-neerzetten-vernieuwd'
else
  az ad sp show --id "$CLIENT" >/dev/null 2>&1 || probeer az ad sp create --id "$CLIENT" --only-show-errors >/dev/null
  CLIENT_GEHEIM=$(probeer az ad app credential reset --id "$CLIENT" --display-name grip --years 2 --query password -o tsv --only-show-errors)
fi

PARAMETERS=(
  appGrootte="$GROOTTE" databaseWachtwoord="$(openssl rand -base64 24 | tr -d '\n/+=')Aa1-"
  entraTenantId="$TENANT" entraClientId="$CLIENT" entraClientSecret="$CLIENT_GEHEIM"
  sessieGeheim="$(geheim)" cronGeheim="$(geheim)" eersteBeheerder="$BEHEERDER"
)
if [[ -n $ADRES ]]; then PARAMETERS+=(eigenAdres="$ADRES"); fi
if [[ -n $TEST ]]; then PARAMETERS+=(metTest=true sessieGeheimTest="$(geheim)" cronGeheimTest="$(geheim)" databaseWachtwoordTest="$(openssl rand -base64 24 | tr -d '\n/+=')Aa1-"); fi
if [[ -n $AI ]]; then
  PARAMETERS+=(metAi=true aiLocatie="${AI_LOCATIE:-swedencentral}")
elif [[ -n "${AI_SLEUTEL:-}" ]]; then
  PARAMETERS+=(aiUrl="${AI_URL:-}" aiSleutel="$AI_SLEUTEL" aiModel="${AI_MODEL:-}")
fi

if [[ ${VOORAF:-} == 1 ]]; then
  stap "Wat OPNIEUW=1 in Azure zou veranderen (er verandert nu niets)"
  echo "Wachtwoorden, geheimen en het client secret worden bij OPNIEUW=1 altijd vernieuwd; die staan hieronder ook als wijziging."
  az deployment group what-if --resource-group "$RG" --template-file main.json --only-show-errors \
    --parameters locatie="$BESTAAND" "${PARAMETERS[@]}"
  exit 0
fi

GELUKT=''
for L in $LOCATIES; do
  if [[ -z "$BESTAAND" ]] && ! database_mag "$L"; then echo "$L: de database mag hier niet voor dit abonnement; volgende regio."; continue; fi
  stap "Resources neerzetten in $L (de database duurt een paar minuten)"
  az group create --name "$RG" --location "$L" --only-show-errors >/dev/null
  if az deployment group create --resource-group "$RG" --name grip --template-file main.json --only-show-errors \
      --output none --parameters locatie="$L" "${PARAMETERS[@]}" 2>fout.txt; then
    GELUKT=$L
    break
  fi
  cat fout.txt
  # een nieuw abonnement mag niet overal alles: dan een andere regio, anders stoppen
  if [[ -n "$BESTAAND" ]] || ! grep -qiE 'restrict|quota|not available|notavailable|capacity|location' fout.txt; then exit 1; fi
  echo "Niet toegestaan in $L; de resources daar weghalen en de volgende regio proberen."
  az group delete --name "$RG" --yes --only-show-errors
done
rm -f fout.txt
if [[ -z "$GELUKT" ]]; then
  echo "In geen van de regio's gelukt ($LOCATIES)."
  echo "Stuur de meldingen hierboven door; vaak geeft Azure een regio vrij via een (gratis) supportaanvraag."
  exit 1
fi

afmaken

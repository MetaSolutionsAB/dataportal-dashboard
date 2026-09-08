# Dataportal-dashboard

Driftstatus för Sveriges dataportal: skördarprocessen, skördning av de
största katalogerna (via det publika EntryStore-API:et) samt status för
exporterna (`all.rdf`, `nsip.rdf`, `hvd.rdf`).

Lösningen består av två delar:

1. **`bin/generate.js`** – ett Node.js-skript som körs via crontab (t.ex. varje
   timme). Det hämtar data från API:et med `@entryscape/entrystore-js`, läser
   exporter/statistik från disk enligt konfigurationen och skriver
   `public/status.json`.
2. **`public/`** – en statisk webbsida som läser `status.json` och renderar
   dashboarden. Kan serveras av valfri webbserver.

## Kom igång

```bash
npm install
cp config.example.json config.json   # anpassa sökvägar och kataloger
npm run generate                     # skriver public/status.json
npm run serve                        # http://localhost:8080/
```

`npm run generate:example` kör mot exempelkonfigurationen med testfilerna i
`examples/` och fungerar direkt utan ändringar.

## Vad som samlas in

| Del | Källa | Innehåll |
|-----|-------|----------|
| Skördarprocessen | URL, i realtid | Harvesterns egen `status.json`, hämtad direkt av webbsidan från `harvest.statusUrl` (se nedan). Visar senaste livstecken, starttid, antal skördade i senaste omgången och om stoppsignal tagits emot |
| Skördning | API | Per katalog: senaste `pipelineResult` (status Success/Failed, nya/uppdaterade/borttagna, valideringsfel) och antal datamängder i kontexten |
| Exporter | Disk | Finns filen, när genererades den, storlek, ålder mot `maxAgeHours` |
| Statistik | Disk | Valfria JSON- eller textfiler som visas rakt av |

Statusvärden: `ok`, `stale` (för gammal), `failed`, `stopped` (skördaren har
fått stoppsignal), `missing` (fil saknas) och `unknown`.

## Konfiguration

Alla sökvägar tolkas relativt konfigurationsfilens katalog om de inte är
absoluta. Se `config.example.json` för ett komplett exempel.

```jsonc
{
  "entrystore": { "baseURI": "https://admin.dataportal.se/store/", "timeoutMs": 30000 },
  "datasets": { "rdfType": "dcat:Dataset", "recentHours": 24 },   // används för kolumnerna per katalog
  "harvest": {
    "maxAgeHours": 26,               // äldre lyckad körning => stale
    "statusUrl": "https://harvester.example.se/status.json",  // harvesterns statusfil, läses av webbsidan
    "statusMaxAgeMinutes": 90,       // äldre livstecken => stale
    "catalogs": [
      { "id": "lantmateriet", "contextId": "778" },
      { "id": "snd", "contextId": "818", "name": "Valfritt eget namn", "maxAgeHours": 50 }
    ]
  },
  "exports": {
    "maxAgeHours": 26,
    "files": [
      { "name": "all.rdf", "path": "/srv/exports/all.rdf", "url": "https://.../all.rdf", "minSizeBytes": 1024 }
    ]
  },
  "statistics": { "files": [ { "name": "Skördningsstatistik", "path": "/srv/stats/harvest.json", "type": "json" } ] },
  "output": "public/status.json"
}
```

### Kataloger (`harvest.catalogs`)

- `contextId` (obligatoriskt) – kontext-id i EntryStore. Namn hämtas från
  katalogposten om `name` inte anges.
- `maxAgeHours` (valfritt) – egen gräns för när en lyckad körning räknas som
  för gammal, i stället för den globala under `harvest`.

Statusen härleds från senaste `pipelineResult` i kontexten: `Failed` ger
`failed`, en lyckad körning äldre än `maxAgeHours` ger `stale`.

## Harvesterns statusfil (realtid)

Harvestern skriver löpande en egen `status.json` med fälten `date` (senaste
livstecken), `startedAt`, `latestHarvestCount` och `stopSignalRecieved`. Den
läses **inte** av generatorn utan direkt av webbsidan, en gång i minuten, så
att dashboarden visar processens tillstånd i realtid.

Var filen finns anges som en URL i `harvest.statusUrl`, normalt en absolut URL
till den plats där harvestern publicerar filen. Generatorn skriver bara URL:en
och gränsen `statusMaxAgeMinutes` in i `status.json`; webbsidan gör själva
hämtningen. Lämnas `statusUrl` tom visas ingen processtatus.

Ligger filen på en annan origin än dashboarden måste den servern svara med
`Access-Control-Allow-Origin` som tillåter dashboardens origin, annars stoppar
webbläsaren hämtningen. Relativa URL:er fungerar också; exempelkonfigurationen
använder `harvester-status.json`, som i repot är en symbolisk länk från
`public/` till exempelfilen i `examples/stats/` så att `npm run serve` fungerar
utan ändringar.

Ett livstecken äldre än `statusMaxAgeMinutes` ger status "Inget livstecken",
och `stopSignalRecieved: true` ger "Stoppad".

## Crontab

Se `crontab.example`:

```
15 * * * *  cd /opt/dataportal-dashboard && /usr/bin/node bin/generate.js --config /etc/dataportal-dashboard/config.json >> /var/log/dataportal-dashboard.log 2>&1
```

Skriptet skriver alltid en `status.json` (atomiskt via temporär fil) även om
enskilda delar misslyckas; felen listas i fältet `errors` och visas överst i
dashboarden. Avslutskoden är 1 om något fel uppstod.

## Webbsidan

`public/index.html`, `style.css` och `app.js` är rena statiska filer utan
byggsteg eller beroenden. Sidan laddar om `status.json` var femte minut och
varnar om filen är äldre än två timmar (dvs. om cron-jobbet slutat köra).
Ljust och mörkt tema följer systeminställningen.

## Kommandoradsflaggor

```
node bin/generate.js [--config fil] [--output fil] [--pretty]
```

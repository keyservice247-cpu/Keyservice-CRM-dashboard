# Tests — verplicht vóór elke deploy (zie de TESTREGEL in CLAUDE.md)

Deze tests draaien tegen een LOKALE server met een VERSE test-database, nooit tegen
productie. Ze gebruiken de demo-login `admin@keyservice.nl` / `admin123`.

## Backend / scenario-regressie (de 10 lead-instroom-wetten + facturen)
```bash
DATA_DIR=/tmp/crmtest INGEST_TOKEN=test123 SESSION_SECRET=test PORT=3113 node server/index.js &
node test/scenarios.mjs      # 50 assertions: matching, dedup, e-mailreacties, multipart, bijlages
node test/factuur-test.mjs   # kortingen, PDF, kopie, dueAt, instellingen  (draai op PORT=3117)
```
Poorten in de scripts (3113/3117) moeten overeenkomen met de gestarte server.

## Frontend / headless-browser-smoketest (VERPLICHT bij elke public/-wijziging)
Logt in met een echte Chromium en opent de schermen (factuur/offerte-editor,
instellingen); faalt bij ELKE JS-console-fout. Dit vangt een ReferenceError in het
scherm die server-tests NIET zien.
```bash
# eenmalig: npm i -D playwright-core   (of: npm i playwright-core in de scratchpad)
DATA_DIR=/tmp/crmbrtest INGEST_TOKEN=test123 SESSION_SECRET=test PORT=3122 node server/index.js &
node test/browser-test.mjs
```
Chromium staat op `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (pad in het
script; pas aan als de omgeving een andere build heeft).

## Regel
- Een gefaalde assertie door VEROUDERDE testdata → corrigeer de test, niet de regel.
- Nieuwe functie → voeg er een assertie voor toe, zodat de regressie meegroeit.

# Koppelingen & wat jij moet doen

Dit document legt uit hoe je het dashboard echt laat draaien met je e-mail, WhatsApp en de AI. Het is geschreven om te volgen zónder dat je programmeur bent — maar voor een paar stappen heb je waarschijnlijk eenmalig hulp nodig (dat staat erbij).

> **Het basisidee:** alles wat binnenkomt (e-mail, WhatsApp) wordt door een klein "doorgeefluik" naar het dashboard gestuurd via een webadres (webhook). Het dashboard laat de AI er een categorie aan hangen en zet het in de **Inbox** ter controle.

De twee ontvangstadressen van het dashboard zijn:

| Kanaal | Adres (webhook) |
|--------|-----------------|
| E-mail | `https://JOUW-DASHBOARD/api/ingest/email` |
| WhatsApp | `https://JOUW-DASHBOARD/api/ingest/whatsapp` |

Elke aanroep moet het geheime token meesturen dat je in `.env` bij `INGEST_TOKEN` hebt gezet, als HTTP-header `x-ingest-token`.

---

## Wat ik (Claude) van jou nodig heb

Om de koppelingen écht live te zetten, heb ik het volgende van jou nodig. Stuur het me of zet het zelf in `.env`:

1. **Een plek waar het dashboard draait** met een vast internetadres (zie *Hosting* onderaan). WhatsApp/e-maildiensten kunnen alleen naar een publiek adres sturen, niet naar `localhost`.
2. **Voor e-mail:** toegang tot de instellingen van je TransIP-mailbox (de inloggegevens / het wachtwoord van het mailadres waar offerteaanvragen binnenkomen). **Deel wachtwoorden nooit in platte tekst in een chat** — zet ze zelf in `.env` of gebruik een wachtwoordkluis.
3. **Voor WhatsApp:** een keuze uit de opties hieronder (Business API of een koppelaar zoals een groeps-bot). Dit bepaalt of je een Meta-/Twilio-account nodig hebt.
4. **Voor de AI:** een Claude API-sleutel van https://console.anthropic.com (begint met `sk-ant-...`).

---

## 1. E-mail koppelen (TransIP)

Je offerteaanvragen komen via je website binnen in een TransIP-mailbox. Er zijn twee manieren om die in het dashboard te krijgen:

### Optie A — Doorsturen via een "e-mail-naar-webhook" dienst (makkelijkst)
Diensten zoals **Zapier**, **Make.com** of **n8n** kunnen je mailbox in de gaten houden (via IMAP) en elke nieuwe mail doorzetten naar het dashboard.

1. Maak in Zapier/Make een scenario: *Trigger = nieuwe e-mail (IMAP)*, met je TransIP-gegevens:
   - IMAP-server: `imap.transip.email` (controleer dit in je TransIP-webmailinstellingen)
   - Poort: `993` (SSL)
   - Gebruikersnaam: je volledige e-mailadres
   - Wachtwoord: je mailboxwachtwoord
2. *Actie = Webhook (POST)* naar `https://JOUW-DASHBOARD/api/ingest/email`
   - Header: `x-ingest-token: <jouw INGEST_TOKEN>`
   - Body (JSON):
     ```json
     {
       "from": "{{afzender}}",
       "subject": "{{onderwerp}}",
       "body": "{{platte tekst van de mail}}"
     }
     ```

### Optie B — Een klein IMAP-script dat ik voor je kan schrijven
Ik kan een klein scriptje toevoegen (`server/connectors/email-imap.js`) dat zelf periodiek je TransIP-mailbox checkt en nieuwe mails naar de verwerking stuurt. Dan heb je geen Zapier nodig. Geef me de IMAP-gegevens (of zet ze in `.env`) en ik bouw het.

### Even testen zonder echte mail
```bash
curl -X POST https://JOUW-DASHBOARD/api/ingest/email \
  -H "x-ingest-token: JOUW_TOKEN" -H "content-type: application/json" \
  -d '{"from":"Jan <jan@example.nl>","subject":"Offerte aanvraag","body":"Wat kost een nieuw cilinderslot?"}'
```

---

## 2. WhatsApp koppelen

Je gebruikt WhatsApp op twee manieren: **1-op-1 berichten** én **één zeer actieve groep**. Dat zijn technisch twee verschillende dingen — lees dit goed.

### 2a. 1-op-1 berichten → officiële WhatsApp Business API (aanbevolen, betrouwbaar)
Dit is de nette, toegestane manier voor berichten naar jouw zakelijke nummer.

1. Kies een aanbieder: **Meta (WhatsApp Cloud API)** direct, of via **Twilio** / **360dialog** (eenvoudiger op te zetten).
2. Je krijgt een zakelijk WhatsApp-nummer / Business-account (eenmalige verificatie nodig).
3. Stel in het dashboard van die aanbieder een **inkomende webhook** in die naar
   `https://JOUW-DASHBOARD/api/ingest/whatsapp` wijst, met de header `x-ingest-token`.
4. Stuur per bericht JSON zoals:
   ```json
   { "from": "31612345678", "name": "Klantnaam", "body": "berichttekst" }
   ```
   (De exacte vorm verschilt per aanbieder; ik kan een kleine "vertaler" toevoegen die het formaat van Twilio/Meta omzet naar dit formaat — laat me weten welke aanbieder je kiest.)

### 2b. De actieve WhatsApp-groep → let op: dit kan de officiële API NIET
> **Belangrijk om te weten:** de officiële WhatsApp Business API kan **geen groepsberichten** lezen of ontvangen. Dat is een bewuste beperking van Meta. Voor jouw "zeer actieve groep" heb je dus een andere aanpak nodig. De opties, met eerlijke voor- en nadelen:

| Optie | Hoe | Voordeel | Nadeel / risico |
|-------|-----|----------|------------------|
| **1. Onofficiële groeps-bot** (bv. een gekoppeld toestel via een bibliotheek zoals `whatsapp-web.js` / Baileys) | Een telefoon/sessie blijft ingelogd en stuurt elk groepsbericht door naar de webhook | Werkt mét groepen, geen kosten per bericht | Tegen WhatsApp's voorwaarden → kans op blokkade van het nummer. Gebruik een **apart nummer**, geen hoofdnummer. |
| **2. Handmatig doorzetten** | Assistente plakt belangrijke groepsberichten in *Inbox → Testbericht simuleren* | Veilig, simpel, nul techniek | Kost handwerk |
| **3. Workflow uit de groep halen** | Vraag klanten in de groep om voor opdrachten je zakelijke nummer/website te gebruiken | Netjes en toekomstvast | Vereist gedragsverandering |

**Mijn advies:** gebruik voor opdrachten zoveel mogelijk **2a** (officieel, 1-op-1) en zet de groep desnoods via **optie 1 op een apart, "wegwerpbaar" nummer** of via **optie 2 (handmatig)**. Zeg me welke optie je wilt, dan bouw ik de bijbehorende koppeling (voor optie 1 maak ik een los `connectors/whatsapp-group.js`-script met duidelijke waarschuwingen).

### Even testen zonder echte WhatsApp
```bash
curl -X POST https://JOUW-DASHBOARD/api/ingest/whatsapp \
  -H "x-ingest-token: JOUW_TOKEN" -H "content-type: application/json" \
  -d '{"from":"31612345678","name":"Test","body":"Slot kapot, kunnen jullie langskomen?","group":"Klussen Groep"}'
```

---

## 3. De echte AI aanzetten (Claude)

Standaard draait de AI in **demo-modus** (regels/trefwoorden). Voor slimmere categorisatie:

1. Maak een account op https://console.anthropic.com en genereer een API-sleutel.
2. Zet in `.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ANTHROPIC_MODEL=claude-haiku-4-5-20251001
   ```
   (Haiku is snel en goedkoop en prima voor categoriseren. Wil je het allerslimste, gebruik dan een Sonnet- of Opus-model.)
3. Herstart het dashboard. Boven in beeld zie je nu **"AI actief"**.

De AI valt automatisch terug op de regels als de API even niet bereikbaar is, zodat er nooit berichten verloren gaan.

---

## 4. Het controlesysteem op de AI

Je vroeg om een controle op de AI. Dat zit er zo in:

- **Niets gaat automatisch het bord op** tenzij jij dat instelt. Standaard belandt elk bericht eerst in de **Inbox** ter controle.
- Bij **AI-controle** (admin-tabblad) zie je:
  - hoeveel berichten zijn verwerkt,
  - het **juistheidspercentage** (hoe vaak een mens de AI-keuze ongewijzigd liet),
  - hoeveel keer een mens **corrigeerde**.
- Met de schuif **"drempel voor automatisch goedkeuren"** bepaal je hoe zeker de AI moet zijn voordat hij zelf een opdracht mag aanmaken. **0% = altijd handmatig controleren** (veiligst om mee te beginnen). Zet hem bijvoorbeeld op 85% zodra je de AI vertrouwt.
- Elke goedkeuring/afwijzing/correctie wordt gelogd, zodat je altijd kunt terugzien wie wat deed.

---

## 5. Hosting (online zetten zodat je team erbij kan)

Op je eigen laptop is het alleen lokaal bereikbaar. Om je assistentes en monteurs (op hun telefoon) toegang te geven, zet je het op een server met een vast adres. Opties:

- **Eenvoudig & beheerd:** Render.com, Railway.app of Fly.io (paar klikken, gratis/goedkoop startniveau).
- **Eigen VPS:** bijv. een TransIP/Hetzner VPS met Node.js; draai het met `pm2` en zet er een domein + HTTPS voor.
- **Belangrijk:** zet sterke waarden in `.env` (`SESSION_SECRET`, `INGEST_TOKEN`), gebruik **HTTPS**, en maak regelmatig een back-up van `data/db.json`.

> Groeit het uit? Dan kunnen we `data/db.json` vervangen door een echte database (bijv. PostgreSQL) zonder de rest te herschrijven. Zeg het maar.

---

## Samengevat: jouw checklist

- [ ] Dashboard ergens online zetten met een vast adres + HTTPS
- [ ] Eigen `SESSION_SECRET` en `INGEST_TOKEN` invullen in `.env`
- [ ] Eigen gebruikers aanmaken en demo-wachtwoorden verwijderen
- [ ] E-mail koppelen (Zapier/Make óf het IMAP-script dat ik kan toevoegen)
- [ ] WhatsApp-keuze maken (Business API voor 1-op-1; aparte aanpak voor de groep)
- [ ] Eventueel een Claude API-sleutel invullen voor de slimme AI
- [ ] Drempel voor automatisch goedkeuren instellen (begin op 0%)

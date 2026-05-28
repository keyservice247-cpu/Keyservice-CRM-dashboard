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

## 1. E-mail koppelen (TransIP) — INGEBOUWD, geen extra dienst nodig ✅

Dit is de veiligste en simpelste manier: het dashboard **checkt zelf je TransIP-mailbox** (via IMAP) en haalt nieuwe e-mails op. Geen Zapier of derde partij — je mail blijft in je eigen systeem.

**Wat jij doet:** vul in het bestand `.env` deze regels in:

```
IMAP_HOST=imap.transip.email
IMAP_PORT=993
IMAP_USER=jouwadres@jouwdomein.nl
IMAP_PASSWORD=het-wachtwoord-van-die-mailbox
IMAP_POLL_SECONDS=60
```

> Controleer de juiste IMAP-server in je TransIP-webmailinstellingen (meestal `imap.transip.email`).
> Tip: maak hier het beste een **apart mailbox-wachtwoord** voor aan in TransIP, in plaats van je hoofdwachtwoord.

Herstart daarna het dashboard. In de opstartregels zie je dan: `E-mail (IMAP): actief`. Vanaf dat moment verschijnen nieuwe (ongelezen) e-mails automatisch in de **Inbox** ter controle. Verwerkte mails worden als "gelezen" gemarkeerd zodat ze niet dubbel binnenkomen.

> Werkt het IMAP-checken niet in jouw situatie? Dan kun je als alternatief alsnog een dienst als Zapier/Make naar `POST /api/ingest/email` laten sturen (header `x-ingest-token`). Maar voor de meeste gevallen heb je dat niet nodig.

---

## 2. WhatsApp koppelen

Je gebruikt WhatsApp op twee manieren: **1-op-1 berichten** én **één zeer actieve groep**. Voor allebei kies ik de **veiligste** route.

### 2a. 1-op-1 berichten → officiële WhatsApp Cloud API (INGEBOUWD ✅)
Dit is de nette, toegestane manier voor berichten naar jouw zakelijke nummer. Dit kan **niet** leiden tot blokkade van je nummer. De webhook zit al kant-en-klaar in het dashboard.

**Wat jij doet (eenmalig):**
1. Maak een gratis **Meta for Developers**-account aan (developers.facebook.com) en zet een **WhatsApp**-product op met de **Cloud API**. Je koppelt hier een zakelijk telefoonnummer.
2. Verzin een verify-token en zet het in `.env`:
   ```
   WHATSAPP_VERIFY_TOKEN=een-zelfverzonnen-geheim
   ```
3. Stel in het Meta-dashboard de **webhook** in:
   - Callback-URL: `https://JOUW-DASHBOARD/api/ingest/whatsapp/cloud`
   - Verify token: dezelfde waarde als hierboven
   - Abonneer op het veld **messages**.

Meta controleert de URL automatisch (het dashboard beantwoordt die controle). Daarna komen 1-op-1 berichten vanzelf in de **Inbox**. Dubbele berichten worden er automatisch uitgefilterd.

> Liever via **Twilio** of **360dialog** (vaak iets makkelijker op te zetten)? Laat het weten, dan voeg ik een kleine "vertaler" voor dat formaat toe. Het algemene adres `POST /api/ingest/whatsapp` (met header `x-ingest-token`) staat ook klaar.

### 2b. De zeer actieve WhatsApp-groep → handmatig doorzetten (veiligst ✅)
> **Belangrijk:** de officiële WhatsApp API kan **geen groepsberichten** lezen — dat is een bewuste beperking van Meta. De enige manier om dat automatisch te doen is een *onofficiële* bot, en die **kan je nummer laten blokkeren**. Daarom kies ik dat bewust **niet**.

De veilige aanpak die ik heb ingebouwd: in **Inbox → ➕ Bericht handmatig toevoegen** kan je assistente een belangrijk groepsbericht **kopiëren en plakken**. De AI deelt het daarna gewoon in, net als bij e-mail/WhatsApp. Kost een paar seconden, nul risico.

**Tip om handwerk te verminderen:** vraag klanten in de groep om voor échte opdrachten je zakelijke (1-op-1) nummer of website te gebruiken. Dan loopt het meeste automatisch en gebruik je de groep alleen voor uitzonderingen.

> Wil je tóch een (onofficiële) automatische groeps-koppeling, met alle risico's van dien op een **apart wegwerp-nummer**? Zeg het expliciet, dan kan ik een los script toevoegen mét duidelijke waarschuwingen. Standaard doe ik dit niet.

### Even testen zonder echte WhatsApp
Gebruik in het dashboard de knop **➕ Bericht handmatig toevoegen**, of via de webhook:
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
- [ ] E-mail koppelen: `IMAP_*` invullen in `.env` (ingebouwd, geen extra dienst)
- [ ] WhatsApp 1-op-1: Meta Cloud API-webhook instellen naar `/api/ingest/whatsapp/cloud`
- [ ] WhatsApp-groep: assistente belangrijke berichten laten doorzetten via "➕ Bericht handmatig toevoegen"
- [ ] Eventueel een Claude API-sleutel invullen voor de slimme AI
- [ ] Drempel voor automatisch goedkeuren instellen (begin op 0%)

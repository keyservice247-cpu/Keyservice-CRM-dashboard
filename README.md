# 🔑 Keyservice CRM-dashboard

Een eenvoudig, Trello-achtig dashboard waarin je **alle leads, klanten en opdrachten op één plek** ziet — toegankelijk voor jou, je assistentes en je monteurs. Inkomende e-mails en WhatsApp-berichten worden door een **AI gecategoriseerd** in vier kolommen, met een **controlewachtrij** zodat een mens de AI altijd kan corrigeren.

## Wat het kan

- **Opdrachtenbord (kanban)** met 4 kolommen: **Open · Offerte verzonden · Afspraak ingepland · Geannuleerd**. Sleep een kaart om de status te wijzigen.
- **Klanten & Leads** beheren (nieuwe leads worden automatisch klant zodra er een opdracht is).
- **Monteurs** toevoegen en aan opdrachten koppelen.
- **Inbox / AI**: e-mail en WhatsApp komen binnen, de AI stelt een categorie + klantgegevens voor, jij keurt goed of wijst af.
- **AI-controle**: zie hoe goed de AI presteert (juistheid, correcties) en stel in hoeveel hij zelf mag afhandelen.
- **Rollen & toegang**: admin, assistent, monteur — elk met eigen rechten.

## Snel starten (op je eigen computer / server)

Je hebt alleen **Node.js 20+** nodig ([nodejs.org](https://nodejs.org)).

```bash
# 1. Installeer de benodigdheden
npm install

# 2. Maak een instellingenbestand aan
cp .env.example .env
#    open .env en zet eigen waarden voor SESSION_SECRET en INGEST_TOKEN

# 3. Start het dashboard
npm start
```

Open daarna **http://localhost:3000** in je browser.

**Inloggen (demo-accounts):**

| Rol | E-mail | Wachtwoord |
|-----|--------|-----------|
| Admin | `admin@keyservice.nl` | `admin123` |
| Assistent | `sara@keyservice.nl` | `sara123` |
| Monteur | `ahmed@keyservice.nl` | `ahmed123` |

> ⚠️ **Verander deze wachtwoorden** (en maak je eigen gebruikers aan via het tabblad *Gebruikers*) voordat je dit echt gebruikt.

## Online zetten voor je team

Wil je dat je assistentes en monteurs er vanaf hun telefoon bij kunnen? Zet het dashboard online met de **klik-voor-klik handleiding** in **[docs/HOSTING.md](docs/HOSTING.md)** (via Render, met het meegeleverde `render.yaml` — geen technische kennis nodig).

## De AI uitproberen zonder iets te koppelen

Ga naar **Inbox / AI → 🧪 Testbericht simuleren** en typ bijvoorbeeld:
> "Hoi, ik ben buitengesloten en kom mijn huis niet in, kunnen jullie met spoed langskomen?"

De AI deelt het bericht in, jij ziet de suggestie in de inbox en keurt hem goed → er ontstaat een opdracht op het bord.

## Hoe komt het echt aan het werk?

De veiligste en simpelste koppelingen zitten **ingebouwd**:

- **E-mail (TransIP):** het dashboard checkt zelf je mailbox via IMAP. Vul `IMAP_*` in `.env` in — geen Zapier of derde partij nodig.
- **WhatsApp 1-op-1:** officiële Meta Cloud API-webhook (`/api/ingest/whatsapp/cloud`) — kan je nummer niet laten blokkeren.
- **WhatsApp-groep:** veilig handmatig doorzetten via de knop **➕ Bericht handmatig toevoegen** (de officiële API kan geen groepen lezen; een onofficiële bot zou je nummer kunnen blokkeren).

In **[docs/INTEGRATIES.md](docs/INTEGRATIES.md)** staat **stap voor stap** wat jij moet regelen om:
1. je **TransIP-e-mail** automatisch binnen te laten komen,
2. **WhatsApp** (1-op-1 én je actieve groep) te koppelen — inclusief de belangrijke aandachtspunten,
3. de **echte AI (Claude)** aan te zetten i.p.v. de demo-modus,
4. dit online te zetten zodat je team er overal bij kan.

## Modi van de AI

| Modus | Wanneer | Wat |
|-------|---------|-----|
| **Demo** (standaard) | Geen `ANTHROPIC_API_KEY` ingevuld | Categoriseert op basis van slimme regels/trefwoorden. Gratis, werkt direct. |
| **AI** | `ANTHROPIC_API_KEY` ingevuld in `.env` | Gebruikt het Claude-model voor slimmere categorisatie. |

## Techniek (kort)

- **Backend:** Node.js + Express (`server/`)
- **Opslag:** JSON-bestand `data/db.json` (geen database-installatie nodig; eenvoudig over te zetten naar een echte database als je groeit)
- **Frontend:** standaard HTML/CSS/JS (`public/`), geen buildstap
- **AI:** `server/ai/categorizer.js` — regels + optionele Claude-koppeling

## Project-structuur

```
server/
  index.js              # API + server
  db.js                 # JSON-opslag
  auth.js               # inloggen, sessies, rollen
  seed.js               # eerste accounts + voorbeelddata
  pipeline.js           # verwerking van inkomende berichten (gedeeld)
  ai/categorizer.js     # AI-categorisatie (demo-regels + Claude)
  connectors/
    email-imap.js       # ingebouwde TransIP/IMAP e-mailkoppeling
public/                 # de webpagina's (login + dashboard)
docs/INTEGRATIES.md     # koppelingen: e-mail, WhatsApp, AI, hosting
```

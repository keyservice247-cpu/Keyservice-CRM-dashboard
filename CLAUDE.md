# Keyservice CRM — projectstatus (CLAUDE.md)

Trello/Notion-achtig opdrachten-dashboard voor Keyservice (sleutel-/slotenmaker).
Inkomende e-mail + WhatsApp → AI categoriseert → controlewachtrij → kanban.

## Stack & hosting
- **Backend:** Node.js + Express (`server/`), opslag = JSON-bestand `data/db.json` (geen DB).
- **Frontend:** vanilla HTML/CSS/JS (`public/`), geen buildstap. Design: rustige SaaS-stijl
  (MailerLite/Render), Keyservice blauw/geel, outline-iconen, geen emoji in UI.
- **Hosting:** Render (auto-deploy "On Commit" vanaf `main`). URL: keyservice-crm.onrender.com
- **WhatsApp-bridge:** los Node-programma in `whatsapp-bridge/` (whatsapp-web.js), draait op
  een Hetzner VPS (Falkenstein, CPX22) onder `pm2` (proces heet `wa`). Repo staat in
  `/root/ksbridge`. Updaten = `cd /root/ksbridge && git pull && pm2 restart wa`.
- **Render env vars:** INGEST_TOKEN, ANTHROPIC_API_KEY (Claude Haiku), IMAP_* (TransIP ontvangen),
  SMTP_* (TransIP versturen), WHATSAPP_VERIFY_TOKEN, DATA_DIR=/var/data, SESSION_SECRET.
- **Bridge .env / hardcoded:** DASHBOARD_URL, INGEST_TOKEN, PAIR_NUMBER (31685352477) en token
  staan hardcoded in `bridge.js` omdat de Hetzner-webconsole `_ + =` sloopt bij plakken.

## Werkende functies
- **Kanban-bord**, instelbare kolommen (Nieuw, In behandeling, Offerte verzonden, Afspraak
  ingepland + tweede rij Afgerond/Geannuleerd). Slepen wijzigt status. Live-updates via
  `/api/pulse` (5s polling, geen handmatig verversen).
- **Inbox / AI-controlewachtrij:** AI deelt in; mens keurt goed/wijst af. Filters:
  Te controleren / Overige (geklets) / Prullenbak (afgewezen).
- **AI (Claude Haiku):** categorisatie + extractie (naam/tel/e-mail/adres/probleem).
  Bepaalt `isOpdracht`; bij "geen opdracht" (incasso/leverancier/reclame/factuur) → confidence
  max 0.15, naar Overige, nooit auto-geaccepteerd. Regelfilter `NOT_ORDER_WORDS` als extra net.
- **Feedback-leren:** elke afwijzing (ook zonder reden) + elke correctie permanent opgeslagen,
  zonder limiet; meegegeven aan AI (recente voorbeelden + samenvatting van álle afwijzingen).
- **Bedrijfsprofiel** (Instellingen): vrije kennisbank, gaat als context naar AI bij elke
  beoordeling/concept-antwoord. Knop "Filterregels leren & toevoegen" + "Verkeer analyseren".
- **Dedup:** vervolgberichten van dezelfde klant (e-mail/telefoon) hangen aan de lopende kaart;
  ook bij goedkeuren. Inhoud-dedup voor doorgestuurde WhatsApp (DRS→Youssef). Handmatig
  "Samenvoegen"-knop als backup.
- **Bulk-acties inbox:** selectie + afwijzen, "Alle geklets afwijzen", "Hele lijst afwijzen",
  "Accepteer boven drempel" (≥70/80/90% AI-zekerheid, slaat 'geen opdracht' over). Opschonen
  (strenge her-filtering naar Overige).
- **Kaart-details:** klant naam/tel/e-mail/adres bewerkbaar; foto's/bestanden (upload + uit
  e-mail/WhatsApp); gesprekshistorie als chat-stijl (in links/grijs, uit rechts/blauw),
  scrollt naar nieuwste.
- **Beantwoorden:** echte reply met thread + citaat (geen losse mail), via SMTP; verzonden
  antwoord komt in de historie; Nieuw→In behandeling. AI-concept-knop.
- **Meldingen:** statusstip (nieuw/geopend/beantwoord), "Nieuw bericht"-badge + teller op kaart
  bij klantreactie (alle kolommen), verdwijnt bij openen.
- **Verwijderen/prullenbak:** mini-prullenbak per kaart + bulk naar prullenbak; opdracht-
  prullenbak (terughalen/definitief, definitief = admin). Inbox-prullenbak (afgewezen
  berichten): terugzetten, definitief verwijderen + legen = admin-only.
- **Monteur-dispatch (fase 2):** opdracht → WhatsApp-groep van monteur. Handmatig (knop op kaart)
  + volautomatisch met regels (aan/uit, welke monteur, trigger goedgekeurd/afspraak, ALLEEN op
  gekozen dagen). Kaart toont "naar Youssef" + verstuurstatus. Outbox-wachtrij; bridge haalt op
  en verstuurt naar de groep, meldt terug.
- **Werkbon + Facturen:** knoppen op elke kaart. Werkbon = uitgevoerd werk + materialen +
  handtekening-canvas (bijlage). Factuur = regels (prijzen EXCL btw, btw erbovenop), btw
  21/9/0%, nummer per jaar (2026-0001…), PDF in eigen huisstijl (logo public/img/
  logo-factuur.png, excl/incl-kolommen, vervaldatum, garantie-regel, juridische disclaimer,
  werkbon-handtekening op de factuur; server/invoices.js), mailen met PDF-bijlage, status
  concept/verzonden/betaald, Facturen-overzicht (monteur alleen eigen). Bedrijfsgegevens
  staan als standaard in de code (Rhenen/KvK/BTW/IBAN) en zijn aanpasbaar in Instellingen →
  Facturen-pil, incl. PRIJSLIJST (vaste producten/werkzaamheden, 1-klik in de factuur).
- **Offertes + losse facturen:** naast kaart-facturen ook LOSSTAANDE facturen/offertes
  (Facturen-pagina → + Factuur / + Offerte → klant kiezen of nieuw). Offerte: nummer
  OFF-2026-…, eigen PDF (geldigheidsdatum, Voor akkoord-blok), status concept/verzonden/
  goedgekeurd/afgekeurd, 1-klik omzetten naar factuur. Verder: kopiëren, verwijderen
  (betaald nooit, verzonden alleen admin), betaalherinnering (met teller), verlopen-detectie
  in het overzicht. Rechten: monteur alleen eigen kaarten + zelf aangemaakte records.
- **Bewaking:** WhatsApp-heartbeat (bridge pingt elke 60s) → zijbalk groen "WhatsApp: actief" /
  rood "GESTOPT". Systeemcheck (DB/IMAP/SMTP/AI) in AI-controle. Abonnementen-pagina (Render/
  Claude/TransIP/VPS + AI-verbruiksteller).
- **Overig:** rollen (admin/assistent/monteur), wachtwoord wijzigen, wekelijks agenda-inklappen
  (zondag na 23:59, behalve open + afspraken na die week), dubbele klanten samenvoegen.

## AI-statusscan — NIET verzwakken (werkt, 6 juli bevestigd)
- De statusscan leest de **dagrapporten** van de monteur (WhatsApp-monteursgroep, bv.
  "Youssef Keyservice247"). Formaat: kopje (Afgerond/Offerte/Afspraken/Geannuleerd) +
  regels met **postcode + plaats**; elke regel erft de status van het kopje erboven.
- Kernpunten die het werkend maken (niet weghalen):
  1. Groepsberichten worden tot **2500 tekens** meegestuurd (niet 300 — anders valt het
     rapport af). Monteursgroep = elke `waGroup` van een monteur (labeling in `categorizer.js`).
  2. Kaarten krijgen een **volgnummer (#1..#n)**; de AI verwijst daarmee (server accepteert
     `#12` én het echte id). Afgekapt AI-antwoord wordt **gered** (bracket-parser), nooit stil leeg.
  3. De scan draait **altijd minimaal op Sonnet 5** (Haiku-override wordt opgewaardeerd).
     Instelbaar hoger via `ANTHROPIC_ANALYZE_MODEL` (sonnet/opus), nooit lager.
- Kosten (indicatie, Sonnet 5): ~$0,12 per scan, nachtscan ~€3,50/mnd. Zie Abonnementen
  (per-model uitsplitsing) + Claude Console → Usage voor het officiële verbruik.


## Cijfers/Financiën (Fase 3 gestart 12 jul)
- Admin-only pagina **Cijfers**: handmatig inkomsten/uitgaven boeken per maand. Categorieën
  volgens eigenaars-model (income: DRS opdracht/Schuifpui/Overig; expense: Marketing fee DRS
  ~€65/wk, Fee per opdracht €42,50, Uitbetaling monteur (Youssef 50%), Google Ads, Producten,
  Hulpmonteur, Benzine, Overig). Snelknoppen voor vaste bedragen. Koppel aan monteur/bron.
- Overzicht: omzet/kosten/WINST + marge, per categorie, per bron, per monteur (netto),
  6-maanden verloop (bars). server/finance.js, db().finance.entries.
- Volgende stappen (nog te doen): auto-omzet uit monteursrapporten (€-bedragen parsen als
  suggesties), uitgaven-scan/AI-suggesties, wekelijks CEO-rapport per e-mail op deze cijfers.

## DE NOORDSTER — visie van de eigenaar (interview 12 jul 2026, NOOIT VERGETEN)
Hier werken we naartoe; elke feature moet hieraan bijdragen:
1. **CLARITY & OVERZICHT boven alles.** Rustig, netjes, mobiel super gebruiksvriendelijk.
   Stabiliteit > nieuwe features: geen bugs is belangrijker dan meer functies.
2. **De assistente wordt de hoofdgebruiker** (CEO checkt 1x/week). Zij moet per opdracht
   compleet overzicht hebben; snel antwoorden / kant-en-klare teksten / automatische
   berichten zijn haar kerngereedschap.
3. **Groei:** meer leads, meer klanten, extra monteur aannemen; eigenaar stopt met zelf
   repareren en gaat sturen op data.
4. **Rompslomp vervangen:** wordt alleen gebruikt voor digitale facturen + klantgegevens
   t.b.v. E-MAILCAMPAGNES → klantdata heilig bewaren (back-ups!) en campagne-functie
   is een gewenste module.
5. **Financiële clarity:** eigenaar is 'all over the place' qua cijfers → dashboard met
   omzet/winst/verlies per maand/monteur/bron (facturen zitten al in het CRM; uitgaven
   later via invoer of AI-scan van aangeleverde data).
6. **Autopilot-droom (lange termijn):** AI's die continu scannen en problemen oppikken
   (bestaat deels: watchdog/statusscan/nachtscan), SEO-content & backlinks (website-
   project), B2B/VvE-prospectie (VvE's, vastgoed, inbraakpreventie-projecten zoeken),
   Meta-ads voor monteurs-werving. Eerlijk faseren: eerst CRM-fundament, dan marketing-
   motor, dan autopilot.

## Belangrijke beslissingen
- Onofficiële WhatsApp (whatsapp-web.js) op apart wegwerp-nummer i.p.v. Meta Cloud API, omdat
  de officiële API GEEN groepen kan lezen. Risico = blokkade nummer; daarom wegwerp-nummer.
- Geen echte AI-hertraining mogelijk → in-context leren (profiel + feedback meesturen).
- Auto-accept standaard 0% (alles handmatig) tijdens training; bij hoger % nooit 'geen opdracht'.

## Nog fine-tunen / open
- Mobiel UX gebruiksvriendelijker maken (gebruiker stuurt schermvideo). Ideeën: bottom-sheet
  i.p.v. popup, kolom-tabs i.p.v. horizontaal scrollen, grotere tikdoelen, swipe-acties.
- Gesprekshistorie: in deze fase vooral relevant voor e-mail; WhatsApp-historie alleen als het
  perfect te finetunen is.
- Bridge op VPS bijwerken na elke wijziging in `whatsapp-bridge/` (git pull + pm2 restart wa);
  monteur-groep koppelen bij Monteurs; wegwerp-nummer moet lid zijn van de monteur-groep.

## Koppeling met de website (keyservice247.nl) — NIET SLOPEN
- De statische site `keyservice247.nl` (aparte repo, apart Claude-project) POST elke
  formulier-lead rechtstreeks naar dit CRM: `POST /api/ingest/form`.
- Endpoint accepteert leads van het eigen domein ZONDER token (origin-check op
  keyservice247.nl; instelbaar via env `FORM_ALLOWED_ORIGINS`), of met FORM_TOKEN/INGEST_TOKEN.
- Velden: name, phone, email, subject, message (of comment), formType. Leads komen altijd
  eerst in de te-controleren inbox (nooit auto-opdracht). Zie docs/WEBSITE-CRM-KOPPELING.md.
- Website-kant: `axios.post` in `src/hooks/useFormSubmission.js` + `connect-src`-regel in
  `public/.htaccess`. Wijzig dit endpoint-contract niet zonder beide kanten bij te werken.

## Test/run
- Lokaal: `npm install && npm start` (poort 3000). Demo-login admin@keyservice.nl / admin123.
- Deploy: push naar `main` → Render auto-deploy. Branch voor werk: `claude/busy-bardeen-cr8tX`.

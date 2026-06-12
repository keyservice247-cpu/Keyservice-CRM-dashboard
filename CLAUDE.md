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
- **Bewaking:** WhatsApp-heartbeat (bridge pingt elke 60s) → zijbalk groen "WhatsApp: actief" /
  rood "GESTOPT". Systeemcheck (DB/IMAP/SMTP/AI) in AI-controle. Abonnementen-pagina (Render/
  Claude/TransIP/VPS + AI-verbruiksteller).
- **Overig:** rollen (admin/assistent/monteur), wachtwoord wijzigen, wekelijks agenda-inklappen
  (zondag na 23:59, behalve open + afspraken na die week), dubbele klanten samenvoegen.

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

## Test/run
- Lokaal: `npm install && npm start` (poort 3000). Demo-login admin@keyservice.nl / admin123.
- Deploy: push naar `main` → Render auto-deploy. Branch voor werk: `claude/busy-bardeen-cr8tX`.

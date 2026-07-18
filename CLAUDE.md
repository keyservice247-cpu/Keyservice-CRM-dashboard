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

## LEAD-INSTROOM WETTEN (bindend, 18 jul 2026 — niet afzwakken zonder akkoord Abdel)
Kernprincipe: DETERMINISME BOVEN AI-VRIJHEID. De AI classificeert en extraheert;
hij wijzigt, samenvoegt of overschrijft NOOIT zelf klanten of kaarten. Zelfde input
geeft altijd zelfde uitkomst. Alle instroomkanalen (WhatsApp-bridge, Cloud API,
IMAP-mailboxen, websiteformulier) lopen door ingestMessage/applyReview in
server/pipeline.js — er bestaat geen pad eromheen.
1. Elke AANVRAAG wordt een NIEUWE kaart, ook bij een bestaande klant. Nooit
   automatisch samenvoegen: open kaart zelfde klant → mergeSuggestion-badge (mens
   klikt Samenvoegen/Negeren, via bestaand POST /api/orders/merge). Automatische
   uitzonderingen: exacte-inhoud-dedup van doorgestuurde WhatsApp (24u, alleen
   IDENTIEKE tekst) + REACTIE-verkeer blijft in de kaart-thread: een 1-op-1 appje
   van een klant mét open kaart, én elke e-mail met Re:/Antw:-onderwerp of
   In-Reply-To-header (isEmailReply — wint van intake-herkenning én van de
   website-dedup; matching op het échte afzenderadres). Fwd: telt bewust NIET als
   reactie. Anders sterven chat-weergave en "Nieuw bericht"-badge.
2. Klant-matching ALLEEN op harde identificatoren: e-mail exact óf telefoon
   genormaliseerd (matchPhone: +31/0031 ↔ 0). Naam is NOOIT koppelgrond.
   Generieke namen (GENERIC_NAMES: "Key Service", "DRS", …) worden nooit een
   klantnaam: record heet "Onbekende klant" + kaartvlag customerIncomplete
   ("Klant onbekend — aanvullen"). De afzender is nooit de klant.
3. Klantrecord NOOIT stil overschrijven. Afwijkend adres/telefoon/e-mail/naam →
   dataSuggestions op de kaart (knoppen Bijwerken/Negeren, endpoint
   /api/orders/:id/data-suggestion). Elke kaart draagt order.intake (gegevens van
   DÍE aanvraag); monteur-dispatch gebruikt intake vóór het klantrecord.
4. Leveranciers-/webshopmail (DEFAULT_EMAIL_FILTERS in settings.js + eigen
   patronen in settings.emailFilters; match alléén op afzender+onderwerp) → STIL
   naar Overige, geen lead, geen melding; wint van intake-herkenning; het
   websiteformulier wint van alles. Auto-kaart (drempel/intake) mag ALLEEN uit
   opdracht-groepen; 1-op-1, losse mail en formulier gaan altijd eerst langs een
   mens in Te controleren.
5. Website-leads: /api/ingest/form accepteert JSON én multipart/form-data
   (bestandsvelden "bijlage", max 10MB totaal, jpg/png/webp/heic/heif/pdf; een
   bijlage-fout laat de lead nooit sneuvelen). Extra mailboxen meelezen via env
   IMAP_INGEST_ACCOUNTS="user:wachtwoord,user2:ww2" (zelfde IMAP-host);
   FormSubmit-mails worden geparsed naar een genormaliseerde aanvraag; dezelfde
   aanvraag via site én mail wordt binnen 15 min ontdubbeld op tel/e-mail
   (bijlages hangen aan de bestaande lead). Bron per lead: message.mailbox.
LET OP: md-bestanden zijn dev-documentatie; de runtime-regels staan in code +
settings. Wijzig je het één, houd BEIDE synchroon.

## WhatsApp-groepstoring (LID) — opgelost ronde 26 (17 jul), NIET verzwakken
- WhatsApp's LID-migratie brak het LEZEN van groeps-chats in whatsapp-web.js 1.34.7
  (getChats/getChat gooien een minified fout zoals "r"); 1-op-1 werkt, en VERSTUREN
  naar een groep op id werkt óók (het verzendpad gebruikt getAsModel:false en omzeilt
  de kapotte code — geverifieerd in de bibliotheek-broncode). 1.34.7 = nieuwste; geen
  upstream fix; webVersionCache-pinning helpt niet. window.Store bestaat NIET meer in
  1.34.x — in-page modules heten nu window.require('WAWebCollections') etc.
- **CRM-kant (werkt zonder VPS):** groeps-koppelingen id→naam in Instellingen →
  Koppelingen (seed: Raf breda-id 120363177872957422); heling van "groep <id>" op
  berichten/kaarten bij boot + bij koppeling-opslaan; inhaalslag-dispatch (<48u) bij
  boot; groeps-outbox-items worden bij falen HERKANST (36u) i.p.v. definitief mislukt;
  dispatch-items dragen groupId + monteur-06 als noodpad → oude bridge bezorgt 1-op-1.
- **Bridge v2:** LID-reparatie (hardenGroupChatModel patcht WWebJS.getChatModel),
  directe naamlezing via WAWebCollections, groep-verzenden op id vóór naam, 1-op-1
  noodpad, stuurt groupId mee (CRM leert koppelingen automatisch), version in
  heartbeat. VPS-update = alleen git pull + pm2 restart wa (GEEN npm install).
- Dit samenspel (koppelingen + herkansing + noodpad + inhaalslag) is het vangnet
  waardoor een opdracht nooit meer stil verloren gaat — niet weghalen of verzwakken.

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
- Vaste/terugkerende kosten (Google Ads €2000/mnd, Marketing fee DRS €65/wk) worden
  automatisch geboekt (bookRecurringDue, periode-sleutel, nooit dubbel/terugwerkend);
  instelbaar in Cijfers -> Vaste kosten & rapport. Gemiddelde kosten/klus (€300) als context.
- Omzet-import uit monteursrapporten: €-bedragen uit monteursgroepen als suggesties (slimme
  gok omzet vs kost o.b.v. woord direct na het bedrag: pin->omzet, lips kosten->kost),
  dedup via sourceRef, mens vinkt aan en boekt.
- Wekelijks CEO-rapport per e-mail (maandagochtend, instelbaar uur): deze week/vorige week
  omzet-kosten-winst, maand tot nu, nieuwe leads, openstaande+verlopen facturen, stille
  opdrachten. sendWeeklyCeoReport in automations.js; test-knop in de instellingen.
- Nog te doen: uitgaven-scan/AI-suggesties (bonnetjes/Google-Ads-koppeling).

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

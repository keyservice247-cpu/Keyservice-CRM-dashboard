# Keyservice CRM — projectstatus (CLAUDE.md)

Trello/Notion-achtig opdrachten-dashboard voor Keyservice (sleutel-/slotenmaker).
Inkomende e-mail + WhatsApp → AI categoriseert → controlewachtrij → kanban.

## TESTREGEL (bindend — NOOIT overslaan, ook niet "voor een kleine wijziging")
Vóór elke `git push`/deploy geldt: eerst testen, dan live. Zeg nooit "getest" of
"live" zonder dat de betreffende test daadwerkelijk groen draaide.
1. **Altijd** `node --check` op elk gewijzigd `.js`-bestand.
2. **Backend-wijziging** (server/): draai de relevante lokale server-test met een
   verse test-DB (`DATA_DIR=<scratch> INGEST_TOKEN=test123 SESSION_SECRET=test`),
   plus de scenario-regressie (`scratchpad/scenarios.mjs`, de 10 lead-instroom-
   wetten) — die MOET groen blijven.
3. **Frontend-wijziging** (public/js/app.js, public/*.html/css): draai ALTIJD de
   headless-browser-smoketest (`scratchpad/browser-test.mjs`, Chromium via
   playwright-core op `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`). Die
   logt in, opent de betrokken schermen (o.a. factuur/offerte-editor, instellingen)
   en FAALT bij elke JS-console-fout. Reden: server-tests vangen een
   ReferenceError in het scherm NIET — dat kostte ooit een kapotte factuur-editor
   ("Can't find variable: bundles").
4. Na deploy: hard verifiëren (`git merge-base --is-ancestor HEAD origin/main`) +
   de live-site pollen tot hij herstart en weer 200 geeft.
Een gefaalde assertie door verouderde TESTDATA corrigeer je in de test — niet door
de regel te negeren. De tests staan in `test/` (zie `test/README.md` voor het
draaien): `test/scenarios.mjs` (50 backend-assertions), `test/factuur-test.mjs`,
`test/browser-test.mjs` (headless Chromium). Nieuwe functie = assertie erbij, zodat
de regressie meegroeit.

## Stack & hosting
- **Backend:** Node.js + Express (`server/`). **Opslag = SQLite** (`data/db.sqlite`,
  better-sqlite3) sinds 28 jul. Alles blijft in het geheugen — `db()` geeft gewoon een
  JS-object, geen enkel endpoint gebruikt SQL — maar wegschrijven gaat PER RECORD i.p.v.
  het hele bestand herschrijven (was 172 ms bij 20 MB; server stond zolang stil).
  `db()` levert een proxy die bijhoudt wélke lijst is aangeraakt, zodat alleen die
  vergeleken wordt; elke minuut draait een volledige controleronde als vangnet.
  **Noodrem:** env `STORAGE=json` → terug naar het oude JSON-model; `db.json` wordt
  daarvoor elke 10 min + bij back-up/afsluiten als volledige momentopname bijgewerkt.
  Werkt SQLite niet (module ontbreekt), dan valt de opslag automatisch terug op JSON.
  Back-ups blijven JSON (leesbaar/draagbaar); migratie telt na afloop elk record na en
  breekt af bij het kleinste verschil. Test: `test/opslag-test.mjs` (22 assertions).
- **Frontend:** vanilla HTML/CSS/JS (`public/`), geen buildstap. Design: rustige SaaS-stijl
  (MailerLite/Render), Keyservice blauw/geel, outline-iconen, geen emoji in UI.
- **Hosting:** Render (auto-deploy "On Commit" vanaf `main`). URL: keyservice-crm.onrender.com
- **WhatsApp-bridge:** los Node-programma in `whatsapp-bridge/` (whatsapp-web.js), draait op
  een Hetzner VPS (Falkenstein, CPX22) onder `pm2` (proces heet `wa`). Repo staat in
  `/root/ksbridge` — dat is een kloon van DEZE repo, dus `bridge.js` staat in
  `/root/ksbridge/whatsapp-bridge/`, niet in de hoofdmap. De WhatsApp-sessie heet
  `wa-session` (SESSION_DIR in bridge.js), NIET `.wwebjs_auth`.
  Updaten = `cd /root/ksbridge && git pull && pm2 restart wa`.
  OPNIEUW KOPPELEN (koppelcode) = eerst Ctrl+C als `pm2 logs` nog draait, dan:
  `pm2 delete wa && cd /root/ksbridge/whatsapp-bridge && rm -rf wa-session &&
  pm2 start bridge.js --name wa && pm2 logs wa`. De `cd` moet vóór `pm2 start`,
  anders zoekt de bridge zijn sessiemap in de verkeerde map.
  LET OP bij console-instructies: `pm2 logs` blijft draaien; wat je daarna typt wordt
  alleen als tekst getoond en NIET uitgevoerd. Vermeld Ctrl+C dus altijd expliciet.
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
- **Slimmer samenvoegen + klant-context (25 jul):** (1) "zelfde moment"-venster —
  aanvraag van klant met open kaart <6u (instelbaar, Instellingen → Werkwijze, 0=uit)
  hangt bij goedkeuren automatisch aan die kaart (systeemnotitie, dispatch-guard);
  (2) 1-op-1 WhatsApp matcht op het ÉCHTE afzendernummer (fromPhone/laatste
  "Telefoon:"-regel, senderPhoneFromText) — tikfout-nummers in klanttekst (>13
  cijfers) genegeerd; (3) inbox-items tonen "Bekende klant: X — open kaart: Y"
  (knownCustomer op GET /api/reviews); (4) kaart-chatblok heeft "Alles van deze
  klant": GET /api/customers/:id/history = alle threads (incl. archief/prullenbak)
  + losse inbox-berichten, chronologisch met kaart-labels (monteur alleen eigen
  klanten).
- **Mail-bewaking (25 jul):** sendMail registreert ELKE mislukte mail centraal
  (db()._mailFailures + logboek) → watchdog max 1 verzamel-alarm/dag; rejected-
  ontvangers tellen als fout; uitgaande replies krijgen In-Reply-To/References
  (echte threading) + messageId op de thread-entry; BOUNCE-detectie in de IMAP-
  poller (mailer-daemon/DSN) → waarschuwing op de juiste kaart + melding, nooit
  een lead. Mobiel: bottom-nav zweeft niet meer (body scroll-lock met scrollY-
  herstel, eigen compositielaag, verborgen bij open modal).
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
  KORTING per factuur/offerte (percentage óf vast bedrag EXCL btw; van subtotaal af,
  btw over het verlaagde bedrag; aparte subtotaal+kortingsregel op de PDF; kopie neemt
  korting mee). Verzonden document wijzigen = eerst expliciete waarschuwing in het
  scherm + logboek-registratie (editedAfterSendAt); betaald/goedgekeurd blijft hard
  vergrendeld. AUTOMATISCHE betaalherinnering (standaard UIT; aan te zetten in
  Instellingen → Facturen): X dagen na vervaldatum, herhaald, met maximum; deelt de
  mail+PDF met de handmatige knop (sendInvoiceReminder in invoices.js); vangrails:
  nooit >120 dagen oud, max 10/ronde. Facturen-overzicht "verlopen" volgt de échte
  betaaltermijn (dueAt van de server). Instellingen-pagina: kaarten gegroepeerd per
  pil met kopjes, standaard "Alles".
- **Prijslijst-opslag + PAKKETTEN (20 jul):** in de factuur-editor kun je alle
  ingevulde regels met één knop opslaan in de vaste prijslijst ("Regels → prijslijst",
  dedup op omschrijving) óf als PAKKET ("Regels → pakket"). Een pakket (bundel,
  settings.priceBundles) voegt met één klik MEERDERE regels tegelijk toe — arbeid en
  producten los, elk met eigen prijs (bv. "Hefschuifpui complete reparatie" = loop-
  wagens + hefsluiting + arbeid i.p.v. één regel van 740). Endpoints
  /api/pricelist/add en /api/bundles/add; pakketten ook bewerkbaar in Instellingen →
  Facturen. Editor-endpoints geven bundles mee.
- **Prijzen doorwerken (28 jul):** de PRIJSLIJST is de baas. Wijzig je daar een prijs
  (Instellingen → Facturen of via "Regels → prijslijst"), dan gaan PAKKET-regels met
  exact dezelfde omschrijving automatisch mee (syncBundlesToPriceList in settings.js;
  antwoord bevat priceSync {changed, bundles} → zichtbare melding + logboek). Vóór
  deze fix hield elk pakket zijn eigen prijskopie en kwamen wijzigingen dus niet in
  nieuwe facturen/offertes. Bestaande documenten veranderen NOOIT vanzelf: in de
  editor zit knop "Prijzen bijwerken" die regels op omschrijving matcht, eerst laat
  zien wat er wijzigt (oud → nieuw) en pas na bevestiging aanpast.
- **Offerte-automatisering (20 jul):** offerte op "Goedgekeurd" → automatisch een
  factuur-CONCEPT klaargezet (kopie, nieuw nummer, niet verzonden; idempotent via
  inv.convertedInvoiceId; koppelt de kaart aan de nieuwe factuur; instelbaar
  autoInvoiceOnAccept, default AAN). Automatische offerte-OPVOLGING: verzonden
  offerte die na X dagen niet is beantwoord → vriendelijke opvolgmail met offerte-PDF;
  heeft de klant GEEN e-mail maar wel een 06 → herinnering als WhatsApp-appje via de
  bridge (sendQuoteFollowup kiest zelf het kanaal; teller quoteFollowupCount, max;
  standaard UIT). Handmatige "Herinnering"-knop op verzonden offertes doet hetzelfde
  (POST /api/invoices/:id/quote-followup). Beide in
  Instellingen → Facturen. Los van de bestaande kanban-follow-up (followup.js op
  order-status offerte_verzonden).
- **Offertes + losse facturen:** naast kaart-facturen ook LOSSTAANDE facturen/offertes
  (Facturen-pagina → + Factuur / + Offerte → klant kiezen of nieuw). Offerte: nummer
  OFF-2026-…, eigen PDF (geldigheidsdatum, Voor akkoord-blok), status concept/verzonden/
  goedgekeurd/afgekeurd, 1-klik omzetten naar factuur. Verder: kopiëren, verwijderen
  (betaald nooit, verzonden alleen admin), betaalherinnering (met teller), verlopen-detectie
  in het overzicht. Rechten: monteur alleen eigen kaarten + zelf aangemaakte records.
- **Nachtronde 27 jul:** (1) WEBSITE-LEADS boven de drempel worden automatisch een
  kaart (Regel 5-verfijning, isFormLead telt mee; ontvangstbevestiging óók bij
  auto-accept; losse mail/1-op-1 blijven handmatig; drempel 0 = alles handmatig);
  (2) CIJFERS-AUTOSYNC (finance.js runFinanceAutoSync, uurlijks + POST
  /api/finance/autosync): betaalde factuur → omzet excl. btw (bron-heuristiek
  DRS/Schuifpui/Overig, monteur gekoppeld, sourceRef inv:<id>), afgeronde
  DRS-kaart → fee (default €42,50, drsFeePerJob, sourceRef drsfee:<id>);
  instelbaar via financeSettings.autoSync (default AAN), nooit dubbel;
  TERUGWERKEND (28 jul): collectAutoSyncEntries/bookAutoSyncEntries gesplitst →
  GET /api/finance/autosync/preview?since= toont wat er geboekt zou worden mét
  possibleDuplicate-vlag (zelfde bedrag+maand als een handmatige boeking, die
  staan vooraf UITgevinkt), POST /api/finance/autosync/apply boekt alleen de
  aangevinkte sourceRefs; knop "Historie alsnog boeken" op Cijfers. Omzet-
  suggesties uit monteursrapporten: totaal van de selectie + "Weiger
  geselecteerde" (dismissedRefs, komen nooit meer terug);
  (3) AI-DAGOVERZICHT op Start (GET /api/day-overview, 1x/dag gecachet
  _dayOverview, Ververs-knop): dayOverview() scant WhatsApp ≤7d + e-mail ≤14d
  + dashboard-feiten → JSON (kop/acties met prio+doelpagina/kansen/risico's),
  model instelbaar (aiOverviewModel standaard=Sonnet | opus=claude-opus-5),
  zonder AI nette feiten-fallback; (4) parseFormSubmit-opschoning (kopcel
  "Value"/herhaald label lekt nooit meer in waarden; Type_schuifpui-label).
  Tests: cijfers-test.mjs (7, PORT=3123) + uitbreidingen in scenarios/briefing/
  mail/browser.
- **AI-ochtendbriefing (23 jul):** elke ochtend één bericht met afspraken van vandaag
  (tijd + bevestigd ja/nee), actiepunten (onbeantwoorde klantreacties, nieuwe leads,
  offertes 4+ dagen stil, verlopen facturen, kaarten 5+ dagen stil), geld deze week
  (weeklyReportData) en 2-3 zinnen AI-duiding (morningInsight in categorizer.js,
  ANTHROPIC_ANALYZE_MODEL, faalt stil → feiten gaan altijd uit). Kanaal WhatsApp
  (zelfde doel als CRM-meldingen, óók als die uit staan; eigen outbox-item
  by:'ochtendbriefing', geen 2-min-rem) en/of e-mail (fallback backup-mail-adres).
  Instelbaar in Instellingen → AI: aan/uit (default UIT), uur (default 7), alleen
  werkdagen, toon coachend/zakelijk, test-knop (POST /api/morning-briefing/test).
  sendMorningBriefing/runMorningBriefing in automations.js (dagvlag
  _lastMorningBriefDay, Europe/Amsterdam). Test: test/briefing-test.mjs (8 assertions,
  PORT=3119).
- **Klantenbeheer-uitbreiding (26 jul):** KLANTDOSSIER (klik op klantnaam → alles
  op één scherm: gegevens, kaarten incl. archief, facturen, betaald/openstaand,
  snelknoppen; GET /api/customers/:id/dossier, monteur alleen eigen); KLANTIMPORT
  CSV/Excel (xlsx-dependency; /api/customers/import-preview + /import: kolom-
  heuristiek + handmatige mapping, dedupe op e-mail/telefoon, nooit overschrijven,
  max 5000 rijen); E-MAILCAMPAGNE (/api/campaign/send, admin+assistent, {naam}-
  placeholder, testmail, 400ms tussenpozen, campaignOptOut per klant, afmeld-voet,
  db().campaigns-log); NOG TE FACTUREREN (/api/invoices/todo vóór de /:id-route!)
  als blok op de Facturen-pagina; zoekveld in het kaart-chatblok; HTML-HANDTEKENING
  (getHtmlSignature, default AAN met eigenaar-gegevens; wrapHtmlMail in email-smtp
  maakt van elke tekstmail een nette HTML-mail met logo als cid-bijlage, platte
  handtekening blijft fallback); FOTO-DISPATCH (dispatch-modal met foto-vinkjes →
  outbox-item.media → bridge downloadt via /uploads met ingest-token en stuurt max 6
  foto's na de tekst; VPS-update nodig voor het versturen); schijfruimte-overzicht
  (/api/disk-usage) + back-ups-prune-knop in Instellingen → Systeem; BIJLAGEN
  BEHEREN (27 jul, "makkelijk schijfruimte vrijmaken"): /api/attachments/browse
  (alle bijlages van kaarten incl. prullenbak + losse inbox-berichten, groot→klein
  gesorteerd) + /api/attachments/bulk-delete (multi-select + verwijderen, geeft
  vrijgemaakte bytes terug); werkbon-handtekeningen NOOIT in de lijst én NOOIT
  verwijderbaar (protectedIds-check zit in BEIDE endpoints, niet alleen de listing);
  scherm in Instellingen → Systeem ("Foto's & video's beheren") met filters
  (alles/afgerond+geannuleerd/ouder dan 90 dagen/alleen video's) en "alles
  selecteren". Test: test/klanten-test.mjs (25 assertions, PORT=3121).
- **Ideeën 1-5 (28 jul):** (1) AI-ASSISTENT MET GEHEUGEN: /api/assistant/ask
  accepteert history (max 6 beurten, alleen bij de nieuwste vraag gaat de zware
  data mee); frontend is een doorlopend gesprek (_asChat) met "Nieuw gesprek"-
  knop, doorvragen werkt; (2) KAART-ACTIES: kaartnummers #xxxxxx in AI-antwoorden
  zijn klikbaar (linkifyCardRefs → openOrderModal, ook archief); systeemprompt
  vraagt de AI die nummers te gebruiken; (3) WEKELIJKSE AI-CONTROLE
  (automations.js weeklyCheckData/sendWeeklyAiCheck, maandag, settings.
  weeklyAiCheck default UIT, Instellingen → AI): deterministische checks
  (afgerond zonder factuur, verlopen afspraak nog open, inbox-leads 2+ dagen,
  offertes 7+ dagen stil, verlopen facturen, kaarten 14+ dagen stil, klant
  onvolledig) + AI-advies (faalt stil); zelfde kanaal als de ochtendbriefing;
  test-knop POST /api/weekly-check/test + GET /api/weekly-check; (4) AI-KLANT-
  SAMENVATTING in het dossier (POST /api/customers/:id/summary, cache op
  customer.aiSummary, monteur alleen eigen klanten); (5) SLIMME ZOEKBALK op
  Start (GET /api/search?q=, min 2 tekens): klanten/kaarten/facturen/berichten
  in één veld, telefoon genormaliseerd (+31↔06), klik opent dossier/kaart/
  factuur/bericht-modal; monteur alleen eigen data en géén berichten.
- **Bord periode-filter (28 jul):** keuzelijst op Opdrachten/E-mail/WhatsApp-bord
  ("Vandaag/Gisteren/Deze week/Vorige week/Deze maand binnengekomen"): filtert op
  order.createdAt over ÁLLE kolommen (ook afgerond/geannuleerd/offerte); bij actieve
  periode haalt loadBoard includeArchived=1 op zodat ingeklapte kaarten meetellen;
  balk (.board-period-bar) legt uit wat je ziet + "Filter uit"-knop
  (boardPeriodRange/filteredOrders in app.js).
- **Rustig scherm / geen geknipper (29 jul):** het bord, de inbox, Start en de
  ingeklapte agenda's werden bij ELKE serverwijziging (ook achtergrondtaken) volledig
  opnieuw opgebouwd via innerHTML. Gevolg: bulk-selectie verdween (`selectedCardIds`
  las alleen de DOM), scrollposities sprongen, half ingetypte inbox-correcties weg,
  zoekbalk op Start leeg, open week-agenda's dicht. Nu: elke render bouwt eerst de HTML
  als string en slaat het hertekenen OVER als die identiek is (_lastBoardHtml/
  _lastInboxHtml/_lastOvHtml/_lastArchHtml); selectie leeft in `boardSel` (Set) en wordt
  in cardHTML als `checked` teruggezet; scrollpositie van pagina/kolommen wordt bewaard;
  de pulse slaat het bord over zolang er een selectie openstaat; showView scrollt naar
  boven bij een ander scherm; toast staat boven de onderbalk (safe-area). BRON
  aangepakt: huishoudelijke schrijfacties gebruiken `saveSoonQuiet()` (db.js) — die
  bewaart wel maar hoogt de wijzigingsteller NIET op. Toegepast op de WhatsApp-
  hartslag (elke 60 s!) en de mailbox-vulgraad; die lieten voorheen élk geopend
  scherm de klok rond herladen. Veeg-beweging op mobiel zet nu `window._dragging`
  (incl. touchcancel), zodat een verversing nooit midden in een swipe de kaart
  vervangt. Regressie: browser-test 41 + scenarios 72 assertions.
- **Factuur/offerte via WhatsApp (1 aug):** knop "Via WhatsApp" in de editor →
  POST /api/invoices/:id/send-whatsapp bouwt de PDF, zet hem met saveBuffer in uploads
  (inv.waPdfFile; vorige wordt opgeruimd) en plaatst een outbox-item kind
  whatsapp_customer met media=[{pdf}]. De bridge haalt het bestand met het ingest-token
  op en stuurt het als document — GEEN bridge-update nodig, dat mediapad bestond al.
  sentAt alleen bij de EERSTE verzending (betaaltermijn schuift niet op), lastSentAt
  apart. Nummer: order.intake vóór klantrecord.
- **Reviews (1 aug):** knop "Review" op elke VERZONDEN factuur die aan een kaart hangt
  (POST /api/invoices/:id/review-request, force=1 om nogmaals te sturen; vinkje ✓ +
  inv.reviewRequestedAt als het al gebeurd is). De automatische review-ronde is nu PER
  MONTEUR uit te zetten (monteur.reviewAuto, default true; reviewAutoAllowed in
  automations.js) — vinkje in het monteur-scherm. sendReviewRequest is de gedeelde
  verzendfunctie voor beide paden. Het verzoek gaat via E-MAIL ÉN WHATSAPP TEGELIJK
  (klant met alleen een 06 krijgt 'm nu ook); de automatische ronde gebruikt exact
  dezelfde functie.
- **Audit-reparaties (1 aug):** Cloud-API-webhook VERWIJDERD (accepteerde berichten van
  iedereen); review-stortvloed-vangrail (enabledAt + max 14 dagen oud + max 5/ronde);
  dagrapport houdt REGELEINDES (categorizer msgList, limiet 4000 + zichtbare afkap-
  markering), postcode zonder spatie + adres niet meer afgekapt op de komma, scan sorteert
  NIEUWSTE eerst en krijgt intake-adres, eerste threadregel en datums; recent afgeronde
  kaarten blijven zichtbaar voor de scan; via AI toegepaste status wordt vastgelegd
  (order.aiStatusChange, PATCH-veld aiSuggested); nachtscan meldt mislukking en zet de
  dagvlag pas ná succes; scanresultaat staat in de ochtendbriefing. EIGEN RAPPORT in een
  opdracht-groep wordt deterministisch herkend (statuskopje + 2+ postcoderegels →
  isEigenRapport) en is nooit een aanvraag. Factuur: sentAt alleen bij eerste verzending
  (lastSentAt/sendCount apart), afwijkend verzendadres wordt dataSuggestion i.p.v. stille
  overschrijving, verzonden offerte zet de kaart op offerte_verzonden. Pipeline: eigen
  verkeer (antwoord op onze messageId of Re: van bekende klant) omzeilt het
  leveranciersfilter; website-dedup vergelijkt ALTIJD de tekst en bewaart de tweede
  inzending als notitie; reacties gaan naar de NIEUWSTE open kaart; bulk-goedkeuren
  dispatcht naar de monteur. E-mailafzender: naam + functie van de INGELOGDE gebruiker
  (user.functie, afzenderVan(req) → getEmailSignature/wrapHtmlMail). Test:
  `test/rapport-test.mjs` (11) bewaakt het lezen van dagrapporten.
- **Bewaking:** WhatsApp-heartbeat (bridge pingt elke 60s) → zijbalk groen "WhatsApp: actief" /
  rood "GESTOPT". Systeemcheck (DB/IMAP/SMTP/AI) in AI-controle. Abonnementen-pagina (Render/
  Claude/TransIP/VPS + AI-verbruiksteller).
- **Agenda "blijft ontkoppelen" (7 aug):** oorzaak zit bij GOOGLE, niet in het CRM —
  staat de OAuth-toestemmingspagina nog op **Testing**, dan trekt Google het
  refresh-token na **7 dagen** in, hoe vaak je ook opnieuw koppelt. Eenmalige fix:
  console.cloud.google.com → OAuth consent screen → **PUBLISH APP** (In production).
  Het CRM legt nu elke `invalid_grant` met tijdstip vast (`google.disconnectHistory`,
  laatste 6); `testingModusVermoeden()` herkent het 7-dagen-ritme (tussenpoos 3–10
  dagen). Bij dat patroon noemen zowel het alarm als Instellingen → Koppelingen de
  ÉCHTE oplossing met klikpad, i.p.v. eeuwig "verbind opnieuw". Test: 6 assertions in
  test/google-test.mjs (22 totaal).
- **Google Agenda-sync bewaakt + zelfherstellend (24 jul, sync-regel instelbaar 1 aug):**
  WELKE afspraken meegaan is nu een INSTELLING (settings.googleSync, Instellingen →
  Koppelingen): alles (STANDAARD) / alleen gekozen monteurs / alleen schuifpui /
  monteurs+schuifpui (het oude hardcoded gedrag). Reden: de vaste regel "alleen Abdel
  of schuifpui" voelde als willekeur ("soms wel, soms niet in de agenda").
  Zelfherstel: PATCH op verdwenen event (404/410) → verwijzing weg + nieuw event;
  aanmaken is idempotent (zoekt eerst op extendedProperty ksOrderId → nooit dubbel).
  Uurlijkse vangnet-ronde (runGoogleCalendarSweep) synct komende afspraken zonder
  event/na fout alsnog (max 20/ronde). Alarmen (watchdog): koppeling stil verbroken
  (invalid_grant → disconnectReason, calendarAlarmDecision) → direct melding +
  herstelmelding; komende afspraken met googleSyncError → 1 melding/dag. Test:
  test/google-test.mjs (10 assertions, zonder server).
- **Overig:** rollen (admin/assistent/monteur), wachtwoord wijzigen, wekelijks agenda-inklappen
  (zondag na 23:59, behalve open + afspraken na die week), dubbele klanten samenvoegen.

## LEAD-INSTROOM WETTEN (bindend, 18 jul 2026 — niet afzwakken zonder akkoord Abdel)
Kernprincipe: DETERMINISME BOVEN AI-VRIJHEID. De AI classificeert en extraheert;
hij wijzigt, samenvoegt of overschrijft NOOIT zelf klanten of kaarten. Zelfde input
geeft altijd zelfde uitkomst. Alle instroomkanalen (WhatsApp-bridge, Cloud API,
IMAP-mailboxen, websiteformulier) lopen door ingestMessage/applyReview in
server/pipeline.js — er bestaat geen pad eromheen.
1. Elke AANVRAAG wordt een NIEUWE kaart, ook bij een bestaande klant; open kaart
   zelfde klant → mergeSuggestion-badge (mens klikt Samenvoegen/Negeren, via
   bestaand POST /api/orders/merge). VERFIJNING (25 jul, akkoord Abdel): het
   "ZELFDE MOMENT"-VENSTER — heeft de klant een open kaart die minder dan
   autoMergeWindowHours geleden (default 6u, instelbaar in Instellingen →
   Werkwijze, 0 = uit) is aangemaakt/bijgewerkt, dan hangt de goedgekeurde
   aanvraag automatisch aan díe kaart (applyReview, systeemnotitie + review.
   mergedIntoOrder; dispatch-guard sentToMonteur voorkomt dubbel versturen).
   Ouder dan het venster → nieuwe kaart + suggestie, zoals altijd. Overige
   automatische uitzonderingen: exacte-inhoud-dedup van doorgestuurde WhatsApp
   (24u, alleen IDENTIEKE tekst) + REACTIE-verkeer blijft in de kaart-thread:
   een 1-op-1 appje van een klant mét open kaart, én elke e-mail met Re:/Antw:-
   onderwerp of In-Reply-To-header (isEmailReply — wint van intake-herkenning én
   van de website-dedup; matching op het échte afzenderadres). Fwd: telt bewust
   NIET als reactie. Anders sterven chat-weergave en "Nieuw bericht"-badge.
2. Klant-matching ALLEEN op harde identificatoren: e-mail exact óf telefoon
   genormaliseerd (matchPhone: +31/0031 ↔ 0). Naam is NOOIT koppelgrond.
   Bij 1-op-1 WhatsApp is het ÉCHTE afzendernummer de hardste identificator
   (25 jul, Karin-casus): bridge/Cloud-API sturen fromPhone mee én plakken het
   als laatste regel "Telefoon: +31…" onder de body (senderPhoneFromText leest
   de LAATSTE regel — nooit een nummer dat de klant zelf in de tekst typte);
   een harde afzender-treffer (waFrom/fromEmail) wint van het AI-oordeel
   aiNotOrder/looksMarketing, niet van het leveranciersfilter. Onzin-nummers
   (>13 cijfers, bv. tikfout-handtekening) worden nooit klantnummer. In een
   groep geldt dit bewust NIET (afzender = doorstuurder). Generieke namen
   (GENERIC_NAMES: "Key Service", "DRS", …) worden nooit een klantnaam: record
   heet "Onbekende klant" + kaartvlag customerIncomplete ("Klant onbekend —
   aanvullen"). De afzender is nooit de klant.
3. Klantrecord NOOIT stil overschrijven. Afwijkend adres/telefoon/e-mail/naam →
   dataSuggestions op de kaart (knoppen Bijwerken/Negeren, endpoint
   /api/orders/:id/data-suggestion). Elke kaart draagt order.intake (gegevens van
   DÍE aanvraag); monteur-dispatch gebruikt intake vóór het klantrecord.
4. Leveranciers-/webshopmail (DEFAULT_EMAIL_FILTERS in settings.js + eigen
   patronen in settings.emailFilters; match alléén op afzender+onderwerp) → STIL
   naar Overige, geen lead, geen melding; wint van intake-herkenning; het
   websiteformulier wint van alles. Auto-kaart via de DREMPEL mag uit opdracht-
   groepen én van het EIGEN websiteformulier — STRIKT alleen de directe
   site-POST (forceRelevant) mét contactgegevens en niet-generieke naam, nooit
   een e-mailreactie (verfijning 27 jul; formAutoOk in pipeline.js). Een mail
   die op formuliertekst LIJKT (FormSubmit-kopie/citaat/webshopmail) telt NIET
   — anders sneuvelt Regel 4. Auto-accept meldt zich altijd (push + team-app)
   en draait dezelfde monteur-dispatch als handmatig goedkeuren; ontvangst-
   bevestiging gaat ook uit én is zichtbaar op de kaart. Volautomatische
   intake-flow blijft alleen opdracht-groepen. Losse 1-op-1 appjes en losse
   e-mails gaan ALTIJD eerst langs een mens. Drempel 0 = alles handmatig.
5. Website-leads: /api/ingest/form accepteert JSON én multipart/form-data
   (bestandsvelden "bijlage", max 10MB totaal, jpg/png/webp/heic/heif/pdf; een
   bijlage-fout laat de lead nooit sneuvelen). Extra mailboxen meelezen via env
   IMAP_INGEST_ACCOUNTS="user:wachtwoord,user2:ww2" (zelfde IMAP-host);
   FormSubmit-mails worden geparsed naar een genormaliseerde aanvraag (kop-rij
   "Name/Value" wordt overgeslagen; HTML-tabel wordt gelezen; ruwe tekst als
   vangnet); dezelfde aanvraag via site én mail wordt ontdubbeld op
   tel/e-mail: binnen 3 uur volstaat zelfde contact; tot 72 UUR terug alléén als
   óók de klanttekst overeenkomt (coreLine, langste vrije regel >25 tekens —
   FormSubmit bezorgde de mailkopie bewezen 3u01m later, Misa-casus 28 jul; een
   échte nieuwe aanvraag met andere tekst wordt dus nooit opgeslokt). Bijlages
   hangen aan de bestaande lead. Bron per lead:
   message.mailbox. BIJLAGE-ONTDUBBELING: elke opgeslagen bijlage krijgt een
   inhoud-hash (storage.js); identieke foto's worden nooit dubbel aan een kaart
   gehangen (mergeAttachments/dedupeAttachments), binnen één upload/mail én bij
   samenvoegen. Eenmalige veilige opruiming bij boot (_attDedupV1): dubbele
   verwijzingen weg, bestanden blijven op schijf.
VASTE WERKAFSPRAAK TITELS: een kaart-titel begint ALTIJD met de PLAATSNAAM van de
klant, dan " — " en het probleem (bv. "Hoogerheide — slot voordeur eruit gekomen").
Zit in de AI-prompt (categorizer "title") én in /api/orders/paste. Reden: het bord
en de dagrapport-matching (postcode/plaats) leunen op de plaats vooraan.
PLAK-OPDRACHT (noodroute 2 aug): knop "Plak opdracht" op het bord → POST
/api/orders/paste parseert het DRS-formaat (Naam/Adres/Woonplaats/Telefoon/
Opmerkingen) deterministisch, ontdubbelt de klant op telefoon, maakt direct een
kaart (source "DRS WhatsApp groep") en draait dezelfde monteur-dispatch als
goedkeuren. Gebouwd toen het bridge-nummer tijdelijk geblokkeerd was.

LET OP: md-bestanden zijn dev-documentatie; de runtime-regels staan in code +
settings. Wijzig je het één, houd BEIDE synchroon.

## OFFICIËLE WHATSAPP (Meta Cloud API) — klaargezet 3 aug, staat UIT
Aanleiding: 2 aug blokkeerde WhatsApp het wegwerpnummer wegens "geautomatiseerde
berichten". `server/connectors/whatsapp-cloud.js` praat met Meta's officiële platform.
- **Alles staat standaard uit.** Zonder `WHATSAPP_CLOUD_TOKEN` + `WHATSAPP_PHONE_ID`
  doet de module niets; zonder `WHATSAPP_APP_SECRET` geeft de webhook 404.
- **Binnenkomend:** `POST /api/ingest/whatsapp/cloud` controleert de HMAC-handtekening
  (`x-hub-signature-256`) met het app secret in constante tijd — zonder geldige
  handtekening 403. Daarna gaat het bericht door dezelfde `ingestMessage`, dus alle
  lead-instroom-wetten gelden onverkort (bewezen in de test: klant-matching en
  inhoud-dedup grijpen gewoon in). De vórige Cloud-route had GEEN enkele controle en is
  daarom weggehaald; bouw die nooit terug zonder handtekening-check.
- **Uitgaand:** `runCloudOutbox()` (elke 20 s) pakt alleen 1-op-1 KLANT-items uit de
  bestaande outbox (`group === '__klant_dm__'`), nooit een groep. BUITEN het
  24-uursvenster (Meta-code 131047) wordt de tekst automatisch nogmaals verstuurd
  als SJABLOON (settings.whatsappCloudTemplate, standaard `keyservice_bericht`,
  één invulveld {{1}}; tekst platgeslagen tot één regel — Meta verbiedt
  regeleindes in invulvelden; leeg = terugval uit). Zo kun je élke klant appen. Aan te zetten in
  Instellingen → Koppelingen (`settings.whatsappCloudSend`, default UIT); de pauzeknop
  gaat er boven. **Vangnet:** weigert Meta het bericht (meestal buiten het 24-uursvenster),
  dan blijft het item gewoon `queued` en verstuurt de bridge het alsnog — één Cloud-poging
  per item (`cloudTried`). Er kan dus niets verloren gaan door dit aan te zetten.
- **HARDE GRENS — groepen kunnen NIET officieel** (nagetrokken in Meta's eigen docs,
  3 aug): de officiële Groups API werkt alléén met groepen die je zélf via die koppeling
  aanmaakt. Er bestaat geen commando om een bestaande groep binnen te komen, geen
  commando om iemand toe te voegen (alleen uitnodigingslink), max 8 deelnemers en max
  één zakelijk nummer per groep. De DRS-groep is dus onmogelijk via de officiële weg —
  ook niet met een blauw vinkje, want de gate is de Groups API zelf, niet je status.
  Vandaar de gesplitste route: **bridge blijft voor groepen, officieel voor klantverkeer.**
- Het blauwe vinkje is wél haalbaar (OBA gratis, of Meta Verified ~$15/mnd) en goed voor
  klantvertrouwen — maar het opent DRS niet. KvK-bedrijfsverificatie is gratis en nodig
  voor alles.
- Test: `test/whatsapp-cloud-test.mjs` (20 assertions, PORT=3125, met
  `WHATSAPP_APP_SECRET=appsecret123`).

## BERICHTEN-SCHERM (7 aug 2026) — alle klantgesprekken op één plek
Nieuw menu-item "Berichten" (admin+assistent; monteur bewust niet): links alle
gesprekken (nieuwste bovenaan, ongelezen-teller, gekoppelde open kaart), rechts het
gesprek als chat met verstuur-balk. Mobiel: lijst → tik → gesprek vult het scherm,
terugknop; scherm begint op mobiel ALTIJD met de lijst. Techniek:
- GET /api/chats (lijst), POST /api/chats/:id/send, POST /api/chats/:id/read.
- Historie = verzamelKlantHistorie() — dezelfde functie als "Alles van deze klant"
  op de kaart, nu mét uitgaande outbox-items + verzendstatus (waStatus). Een via de
  chat verstuurd bericht komt óók als thread-notitie op de nieuwste open kaart
  (outboxId koppelt notitie ↔ wachtrij-item; vlag threaded voorkomt dubbelen).
- Versturen loopt ALTIJD via de bestaande outbox — pauzeknop, snelheidsrem,
  dubbelfilter en vervaltermijn gelden onverkort; er bestaat geen apart verzendpad.
- /read gebruikt saveSoonQuiet (geen geknipper op andere schermen).
- ONBEKENDE nummers staan er ook in als gesprek `tel:<nummer>` (WET regel 5: er
  ontstaat GEEN klantrecord; dat gebeurt pas bij goedkeuren in de Inbox). Eigen
  routes GET/POST /api/chats/nummer/:phone.
- **Afzendernummer staat nu OP het bericht** (`message.fromPhone`, 7 aug): de bridge
  plakt "Telefoon: +31…" onder de body, de officiële Meta-route NIET. Wie het nummer
  uit de tekst las vond bij een officieel bericht niets → het appje leek spoorloos.
  Overal `m.fromPhone || senderPhoneFromText(m.body)` (terugval voor oude berichten).
- **Melding bij elk 1-op-1 appje**: valt het (terecht) buiten de leadwachtrij, dan
  gaat er alsnog een push uit ('Nieuw WhatsApp-bericht'). Teller op het menu-item via
  GET /api/pulse (`newChats`, sinds `settings._chatsGezienOp`); POST /api/chats/seen
  zet hem op nul bij het openen van het scherm.
- Bijlage-links zijn ONDERTEKEND (`/uploads/<file>?sig=HMAC(file)`) zodat een klant een
  factuur-PDF kan openen zonder login én zonder ingest-token in de URL. Buiten het
  24-uursvenster gaat een PDF als link mee in het sjabloon.
- **WhatsApp-look + live (12 aug):** het gesprek oogt als WhatsApp (beige wand,
  groene uit-bubbels, tijd + bezorgvinkjes ÍN de bubbel: ◷ wachtrij, ✓ verstuurd,
  ✓✓ blauw afgeleverd via waResult, ! mislukt) en werkt LIVE: de pulse-guard heeft
  een uitzondering voor #cpText en renderChatPane ververst alléén #cpMsgs — kop en
  verstuurbalk blijven staan, dus getypte tekst en cursor overleven elke update.
  Berichten staat ook in de mobiele ONDERBALK (bn-item chats + bnChatBadge).
  Zelftest-knop repareert het WABA-app-abonnement (subscribed_apps via debug_token)
  — symptoom: Meta's test-webhook komt aan maar echte berichten niet.
  sjabloonMetReserve: fout 132000 (sjabloon zonder {{1}}) → nogmaals zonder invulling
  + eerlijke uitleg in lastResult.
- **Ongelezen-tellers + statusflow (15 aug, audit):** ongelezen per gesprek via
  leesmarkering `settings._chatGelezen` (customerId of "tel:<nr>", gezet door
  POST /api/chats/:id/read; telOngelezenChats telt binnengekomen berichten ná de
  markering, vloer 7 dagen) — dekt óók klant zonder open kaart en tel:-gesprekken
  (order.unreadReplies doet alléén nog de bord-badge). Menubadge = pulse
  `chatsOngelezen` (gememoiseerd per changeVersion) = zelfde getal als de lijst.
  Cloud-status: ALLE wamids per outbox-item bewaard (cloudMsgIds — bijlage-status
  matcht nu; item zonder tekst krijgt ook een id), "gelezen ✓✓" apart van
  "afgeleverd ✓" (nooit terug omlaag), delivered/read via saveSoon (blauw vinkje
  live), asynchrone Meta-weigering → terug in de wachtrij voor de bridge (alleen
  als bridgeGroupsOnly UIT, jonger dan 24u), foutreden zichtbaar ónder de bubbel
  (.wa-foutregel). outboxOnderhoud (5 min): klant-DM's >24u vervallen ook mét
  stilliggende bridge, DM zonder geldig nummer → eerlijk failed, sent-items >6u
  zonder bevestiging → "verstuurd — geen bezorgbevestiging ontvangen" (chip
  "verstuurd (onbevestigd)"). Verbindingstest-tabel waarschuwt als de bridge stil
  ligt (window._waBridgeOnline). Historie-dedup sleutelt nu óók op dag — identiek
  bericht van maanden later verdwijnt niet meer uit het gesprek.
- **Kanaalbewust antwoorden + monteur-toegang (16 aug):** de verstuurbalk heeft een
  KANAAL-knop (WhatsApp/e-mail; standaard = kanaal van het laatste klantbericht) —
  een mailgesprek wordt nooit stiekem een appje. kanaal 'email' in POST
  /api/chats/:id/send = echte SMTP-reply met In-Reply-To (berichten zonder
  Message-ID zoals formulier-leads worden overgeslagen bij het threaden), gelogd op
  de nieuwste OPEN kaart (anders nieuwste gesloten; helemaal geen kaart →
  db().mailUit, max 500). Ongelezen: eigen MENSELIJK antwoord telt als gelezen
  (kaart-reply/chat/mailUit; automatiseringen — afzender "Keyservice (…)" of
  autoReply-vlag — tellen bewust NIET). MONTEUR mag Berichten in: alleen klanten
  van eigen opdrachten, geen tel:-gesprekken, en ALLEEN MEELEZEN (16 aug, besluit
  eigenaar): zelf typen geeft 403 — versturen kan uitsluitend via de vaste
  kaart-knoppen (Onderweg, Factuur/Offerte, Review); zijn /read schrijft een EIGEN
  markering (settings._chatGelezenMonteur) en raakt team-badge/unreadReplies niet;
  pulse-teller per monteur gememoiseerd. Verder: zoekbalk op Facturen (naam/nummer/
  telefoon genormaliseerd), push-zelfherstel bij app-start (syncPush; localStorage
  ksPushUit respecteert bewust-uit) + GET /api/push/status toont server-toestellen,
  HEIC/verdwenen foto's krijgen een nette bestands-tegel, Berichten op mobiel
  voluit (view-head weg, grotere bubbels/tikdoelen).
- Tests: test/chat-test.mjs (57 assertions, PORT=3127) + browser-assertions
  (desktop + iPhone-formaat, echt versturen, live-update mét getypte tekst).

## SNELHEIDSREM OP DE UITGAANDE WACHTRIJ (6 aug 2026) — NIET verzwakken
Aanleiding: na de storing stond de wachtrij dagen vol. Zodra de bridge terugkwam ging
ALLES in enkele seconden de deur uit — tientallen berichten, met dubbelen ertussen.
Dat is exact het patroon waarvoor WhatsApp op 2 aug het nummer blokkeerde. Drie
vangrails, alle drie in `GET /api/outbox` (aan de bron, niet in de bridge):
1. **Verlopen klantberichten vervallen** (>24u in de wachtrij → status failed met
   uitleg). Een appje van gisteren is niet meer relevant. GROEPS-items houden hun
   ruimere herkansing van 36u — een opdracht mag nooit stil verloren gaan.
2. **Dubbelen eruit**: zelfde ontvanger + identieke tekst → alleen de eerste gaat weg.
3. **Snelheidsrem**: hooguit 2 berichten per ronde en minimaal 20 s tussen rondes
   (`db()._outboxLaatsteRonde`). Bij normaal gebruik merk je hier niets van; alleen een
   opgelopen wachtrij wordt rustig afgewikkeld.
`GET /api/whatsapp/outbox-status?full=1` (admin) geeft de HELE wachtrij ongefilterd —
nodig voor diagnose én voor de tests, want /api/outbox is sinds de rem geen eerlijk
beeld meer van wat er klaarstaat. Regressie: 3 assertions in scenarios.mjs (88 totaal).

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

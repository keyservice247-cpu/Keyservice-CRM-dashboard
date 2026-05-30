# Het dashboard online zetten (klik voor klik)

Doel: een **webadres** krijgen (bijv. `https://keyservice-crm.onrender.com`) waar jij, je assistentes en monteurs op kunnen inloggen — vanaf elke telefoon of computer. Je hebt hiervoor **geen technische kennis** nodig; je klikt alleen.

We gebruiken **Render** omdat het de software automatisch instelt via het bestand `render.yaml` dat al in dit project staat.

---

## Wat je nodig hebt
- Het GitHub-account dat eigenaar is van deze code (`keyservice247-cpu`). ✅ heb je al.
- Een (gratis) Render-account — maak je zo aan.
- Een betaalmethode voor het **Starter**-plan (± **€7/maand**). Dit is nodig zodat je **gegevens bewaard blijven** (zie uitleg onderaan). Het kan ook gratis, maar dan kun je data verliezen bij een update — niet aan te raden voor een echt klantenbestand.

---

## Stap 1 — Render-account aanmaken
1. Ga naar **https://render.com**.
2. Klik **Get Started** → kies **GitHub** ("Sign in with GitHub").
3. Geef Render toegang tot je GitHub. Beperk het desgewenst tot alleen de repo **Keyservice-CRM-dashboard**.

## Stap 2 — Het project aanzetten (Blueprint)
1. Klik in Render op **New +** (rechtsboven) → **Blueprint**.
2. Kies de repository **keyservice247-cpu/Keyservice-CRM-dashboard**.
3. Bij **Branch** kies je de tak waar de code op staat:
   - `main` als de code al naar main is samengevoegd (aanbevolen — vraag Claude om een "pull request" als dat nog niet zo is), **of**
   - `claude/busy-bardeen-cr8tX` (de werk-tak).
4. Render leest automatisch `render.yaml` en toont de service **keyservice-crm**. Klik **Apply** / **Create**.
5. Render vraagt mogelijk om het **Starter**-plan te bevestigen (vanwege de schijf voor je data). Bevestig.

## Stap 3 — Wachten en je adres ophalen
1. Render bouwt nu de software (1–3 minuten). Je ziet logs meelopen; wacht tot de status **Live** is.
2. Bovenaan de service staat je webadres, bijvoorbeeld:
   **`https://keyservice-crm.onrender.com`**
   Dit is **jouw dashboard**. 🎉

## Stap 4 — Inloggen en beveiligen
1. Open het webadres in je browser.
2. Log in met het demo-account:
   - e-mail: **`admin@keyservice.nl`**
   - wachtwoord: **`admin123`**
3. **Maak meteen je eigen beheerder aan** en verwijder de demo-accounts:
   - Ga naar het tabblad **⚙️ Gebruikers** → **+ Nieuwe gebruiker** → maak een admin met jouw eigen e-mail en een sterk wachtwoord.
   - Log uit, log in met je nieuwe account, en verwijder daarna de demo-gebruikers (admin/sara/ahmed).
4. Maak accounts aan voor je **assistentes** (rol: assistent) en **monteurs** (rol: monteur). Geef ze het webadres.

Klaar — het dashboard is live en in gebruik. Alles hieronder is optioneel en kan later.

---

## Later: de koppelingen aanzetten
Je zet koppelingen aan door **instellingen (environment variables)** toe te voegen in Render. Dat gaat zo:
> Render → jouw service **keyservice-crm** → tabblad **Environment** → **Add Environment Variable** → naam + waarde invullen → **Save Changes**. Render herstart daarna automatisch.

### E-mail (TransIP) aanzetten
Voeg deze variabelen toe (waarden uit je TransIP-account, te vinden op transip.nl → E-mail):
| Naam | Waarde |
|------|--------|
| `IMAP_HOST` | `imap.transip.email` |
| `IMAP_USER` | je volledige e-mailadres |
| `IMAP_PASSWORD` | het wachtwoord van die mailbox |

Na opslaan controleert het dashboard zelf je mailbox en verschijnen nieuwe mails in de **Inbox**.

### Slimme AI (Claude) aanzetten
Voeg toe: `ANTHROPIC_API_KEY` = je sleutel van console.anthropic.com. Zonder deze sleutel blijft de AI in demo-modus (werkt prima).

### WhatsApp 1-op-1 (Meta Cloud API)
De webhook-URL wordt: `https://JOUW-ADRES/api/ingest/whatsapp/cloud`.
Het bijbehorende `WHATSAPP_VERIFY_TOKEN` is automatisch gegenereerd — je vindt de waarde in Render onder **Environment**. Volledige stappen staan in [INTEGRATIES.md](INTEGRATIES.md).

---

## Belangrijk om te weten

**Je gegevens bewaren (de schijf).**
Het dashboard bewaart alles in één bestand op een **blijvende schijf** (in `render.yaml` al ingesteld op 1 GB). Daardoor blijven je klanten en opdrachten staan, ook na een update of herstart. Dit hoort bij het **Starter**-plan. Op het gratis plan is er géén blijvende schijf en kan data verdwijnen bij een nieuwe versie — gebruik gratis dus alleen om even te proberen.

**Geheimen.**
`SESSION_SECRET`, `INGEST_TOKEN` en `WHATSAPP_VERIFY_TOKEN` worden automatisch en veilig aangemaakt. Je hoeft die niet zelf te verzinnen. Bekijken kan in Render → Environment.

**Back-up.**
Maak af en toe een back-up: in Render kun je via de **Shell** van de service het bestand `/var/data/db.json` downloaden. Vraag Claude om hulp als je dit wilt automatiseren.

**Kosten kort samengevat.**
- Render Starter-webservice: ± €7/maand (incl. de schijf voor je data).
- WhatsApp Cloud API: gratis voor normale aantallen gesprekken.
- Claude AI (optioneel): betaal-per-gebruik, doorgaans enkele euro's per maand bij categoriseren met een Haiku-model.

---

## Hulp nodig?
Vastgelopen bij een stap? Zeg tegen Claude wáár je vastloopt (welke knop, welke melding) en je krijgt gerichte hulp. Claude kan ook een **pull request** maken zodat de code netjes op `main` staat (handig voor stap 2).

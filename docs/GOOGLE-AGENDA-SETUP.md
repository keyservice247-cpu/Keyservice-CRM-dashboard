# Google Agenda koppelen — eenmalig instellen (±10 min)

Je doet dit één keer. Daarna zet het dashboard afspraken automatisch in Google Agenda.

## Stap 1 — Google Cloud project maken
1. Ga naar https://console.cloud.google.com → log in met het **kantoor-Google-account**
   (het account waarvan je de agenda's wilt gebruiken).
2. Bovenin → projectkiezer → **New Project** → naam bv. "Keyservice CRM" → **Create**.

## Stap 2 — Google Calendar API aanzetten
1. Menu (links) → **APIs & Services → Library**.
2. Zoek **Google Calendar API** → klik erop → **Enable**.

## Stap 3 — OAuth-toestemmingsscherm
1. **APIs & Services → OAuth consent screen**.
2. Kies **External** → **Create**.
3. Vul in: App-naam (Keyservice CRM), support-e-mail (jouw e-mail), developer-e-mail.
   De rest mag leeg → **Save and Continue** tot het einde.
4. Bij **Test users** → **Add users** → voeg het kantoor-Google-account toe (en eventueel
   de monteurs-accounts). → **Save**.
   (Zolang de app "Testing" is, mogen alleen deze accounts verbinden — dat is prima.)

## Stap 4 — OAuth-client (de sleutels)
1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Bij **Authorized redirect URIs → ADD URI** plak exact:
   ```
   https://keyservice-crm.onrender.com/api/google/callback
   ```
   (Gebruik je een ander domein? Vervang dan dat begin, maar `/api/google/callback` moet
   precies zo blijven.)
4. **Create**. Je krijgt nu een **Client ID** en **Client Secret** — kopieer beide.

## Stap 5 — Sleutels op Render zetten
1. Ga naar https://dashboard.render.com → service **keyservice-crm** → **Environment**.
2. Voeg drie variabelen toe (**Add Environment Variable**):
   | Key | Value |
   |-----|-------|
   | `GOOGLE_CLIENT_ID` | (de Client ID uit stap 4) |
   | `GOOGLE_CLIENT_SECRET` | (de Client Secret uit stap 4) |
   | `APP_URL` | `https://keyservice-crm.onrender.com` |
3. **Save Changes** → Render doet automatisch een redeploy (~1-2 min).

## Stap 6 — Verbinden in het dashboard
1. Open het dashboard → **Instellingen** → kaart **"Google Agenda — directe 2-weg koppeling"**.
2. Klik **Verbind Google Agenda** → log in met het kantoor-account → geef toestemming.
3. Je komt terug in het dashboard met de melding "Google Agenda verbonden". Klaar!

## Stap 7 — Agenda's per monteur (optioneel maar aanbevolen)
1. Maak in Google Agenda voor elke monteur een aparte agenda
   (Google Agenda → links "Andere agenda's" → **+** → Nieuwe agenda maken),
   óf deel de bestaande agenda van de monteur met het kantoor-account (met
   recht "Wijzigingen aanbrengen aan afspraken").
2. In het dashboard → **Monteurs** → monteur bewerken → kies bij **"Google Agenda van
   deze monteur"** de juiste agenda → **Opslaan**.
3. Vanaf nu komt een afspraak van die monteur automatisch in zijn/haar agenda.
   Opdrachten zonder gekoppelde monteur gaan naar de **standaardagenda**
   (in te stellen bij Instellingen).

## Werkt het?
- Plan op een opdracht een afspraakdatum in → binnen enkele seconden staat de afspraak in
  de juiste Google Agenda (met klantnaam, adres en telefoon).
- Wijzig je de datum of de monteur → de afspraak verplaatst mee.
- Zet je de opdracht op "Geannuleerd" of gooi je 'm weg → de afspraak verdwijnt uit Google.

## Problemen?
- **"redirect_uri_mismatch"** bij verbinden: de URL in stap 4 komt niet exact overeen.
  Controleer op een typefout of een ontbrekende `https://`.
- **"Niet verbonden" blijft staan**: controleer of de 3 env-vars goed op Render staan en of
  de redeploy klaar is.
- **"Google-koppeling verlopen"**: klik gewoon opnieuw op **Verbind Google Agenda**.

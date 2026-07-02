# Website-formulieren rechtstreeks in de CRM — definitieve koppeling

**Doel:** elke aanvraag van keyservice247.nl komt **gegarandeerd** in het CRM-dashboard,
onafhankelijk van FormSubmit en e-mail (die onbetrouwbaar zijn: rate limits, spam).

De CRM-kant is al klaar: `POST https://keyservice-crm.onrender.com/api/ingest/form`.
Alleen de **website-repo (`keyservice247`)** moet nog 3 kleine wijzigingen krijgen.

---

## Stap 0 — Render: FORM_TOKEN instellen (1 min)

1. Render → service **keyservice-crm** → **Environment** → **Add Environment Variable**
2. Key: `FORM_TOKEN` — Value: een geheime willekeurige tekst (bv. 20 tekens: `ks_9f3k2p7q1x8w4m6z`)
3. **Save Changes** (Render redeployt vanzelf)

> Deze token beschermt het endpoint. Hij komt straks óók in de website-code te staan
> (dat mag: het ergste dat een lek kan doen is spam-leads, en die gaan sowieso eerst
> door jouw handmatige controle).

---

## Stap 1 — `src/data/globalVariables.js`

Voeg onderaan toe:

```js
// CRM-koppeling: leads gaan rechtstreeks naar het dashboard (naast FormSubmit).
export const CRM_FORM_ENDPOINT = 'https://keyservice-crm.onrender.com/api/ingest/form';
export const CRM_FORM_TOKEN = 'ZET_HIER_DEZELFDE_WAARDE_ALS_FORM_TOKEN_OP_RENDER';
```

---

## Stap 2 — `src/hooks/useFormSubmission.js`

Voeg een **tweede POST** toe naar de CRM, náást de bestaande FormSubmit-POST.
"Fire-and-forget": als de CRM even traag is, mag de klant er nooit last van hebben.

Bovenin het bestand, bij de imports:

```js
import { CRM_FORM_ENDPOINT, CRM_FORM_TOKEN } from '../data/globalVariables';
```

In de functie `submitForm(endpoint, data, redirectPath)`, vlak vóór of ná de
bestaande `axios.post(...)` naar FormSubmit, dit blok toevoegen:

```js
// Stuur de lead óók rechtstreeks naar het CRM-dashboard (betrouwbaar, geen mail-omweg).
axios.post(CRM_FORM_ENDPOINT, {
  name: data.name,
  phone: data.phone,
  email: data.email,
  subject: data.subject || '',
  message: data.message || data.comment || '',
  formType: endpoint.includes('offerte') || (data.comment !== undefined) ? 'offerte' : 'contact',
  token: CRM_FORM_TOKEN,
}).catch(() => { /* mag de klant-flow nooit breken */ });
```

> De bestaande FormSubmit-POST en de `res.data.success`-check laat je gewoon staan.
> Zo blijft de "offerte verzonden"-pagina werken en heb je e-mail als extra kopie.

---

## Stap 3 — `public/.htaccess` (⚠️ cruciaal)

De Content-Security-Policy blokkeert anders stil de verbinding naar het nieuwe domein.
Voeg in de CSP-regel `https://keyservice-crm.onrender.com` toe aan **`connect-src`**
(daar staat waarschijnlijk al `https://formsubmit.co`):

Vóór:
```
connect-src 'self' https://formsubmit.co;
```
Ná:
```
connect-src 'self' https://formsubmit.co https://keyservice-crm.onrender.com;
```

(Staat er een `form-action`-regel? Die hoeft niet aangepast, want we POSTen via
axios/JavaScript — `connect-src` is de bepalende.)

---

## Stap 4 — deployen & testen

1. Deploy de site (branch `master` = test, of de "Deploy naar LIVE"-workflow).
2. Vul een formulier in op de site met een **vers e-mailadres**.
3. Kijk in het dashboard → **Inbox / AI → Te controleren**: de aanvraag hoort er
   binnen enkele seconden te staan.
4. (De ontvangstbevestiging naar de klant test je met dat verse adres — check ook spam.)

---

## Waarom dit de juiste oplossing is

- **FormSubmit is een gratis doorgeefdienst**: rate limits, spamfilters, afhankelijk
  van hún uptime en van jouw mailbezorging. Niet geschikt als enige weg voor een bedrijf.
- De **directe POST** hangt van niets af: de lead landt meteen in de CRM-controlewachtrij.
- FormSubmit mag als extra e-mail-notificatie blijven bestaan, maar is niet meer je
  vangnet — de CRM is dat.

Vragen bij het doorvoeren? De beheerder (of ik) kan meekijken.

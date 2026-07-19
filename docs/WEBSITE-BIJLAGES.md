# Website → CRM: leads mét foto's/pdf (multipart-contract)

Endpoint (live): `POST https://keyservice-crm.onrender.com/api/ingest/form`

Het endpoint accepteert **twee** vormen. De bestaande JSON-vorm blijft ongewijzigd
werken; multipart is de nieuwe vorm voor formulieren mét bestanden.

## Vorm 1 — JSON (bestaand, ongewijzigd)
`Content-Type: application/json`, body:
`{name, phone, email, subject, message, city, postcode, address, formType, site}`

## Vorm 2 — multipart/form-data (nieuw, voor bijlages)
Zelfde tekstvelden als hierboven, elk als los form-veld, plus **1 t/m 10
bestandsvelden met de naam `bijlage`**.

- Toegestane bestandstypes: `image/jpeg`, `image/png`, `image/webp`,
  `image/heic`, `image/heif`, `application/pdf`
- Maximum: **10 MB totaal per aanvraag** (alle bijlages samen)
- Een te groot of verkeerd bestand laat de lead **gewoon doorgaan** — alleen die
  bijlage wordt geweigerd; dat zie je terug in het antwoord.
- Browser: gewoon `fetch(url, { method: 'POST', body: formData })` — géén
  Content-Type-header zelf zetten (de browser zet de multipart-boundary).

## Toegang
Zoals voorheen: het verzoek moet komen van een toegestaan domein
(keyservice247.nl, schuifpuiservice.com, de stad-domeinen + hun *.pages.dev —
de browser stuurt de Origin-header vanzelf mee), óf een token meesturen
(header `x-form-token`, of `?token=` in de URL). Kale curl-tests zonder
Origin-header krijgen dus 401 — dat staat los van multipart.
De OPTIONS-preflight wordt afgehandeld (204).

## Antwoord
Succes (óók als een bijlage geweigerd is — de lead telt):
```json
{
  "ok": true,
  "reviewId": "rev_…",
  "status": "pending",
  "duplicate": false,
  "bijlagen": {
    "opgeslagen": 1,
    "geweigerd": [ { "file": "notitie.txt", "reason": "bestandstype niet toegestaan (text/plain) — alleen jpg/png/webp/heic/heif/pdf" } ]
  }
}
```
`duplicate: true` = dezelfde aanvraag kwam al binnen (bv. site + FormSubmit-mail
binnen 15 minuten); de bijlages zijn dan aan de bestaande lead gehangen — geen
tweede lead. Fouten: `400 {"error":"Lege aanvraag"}` (geen naam/telefoon/e-mail/
bericht), `401 {"error":"Niet toegestaan"}` (origin/token).

## Test-voorbeeld (curl)
```bash
curl -X POST "https://keyservice-crm.onrender.com/api/ingest/form" \
  -H "Origin: https://schuifpuireparatie-amsterdam.nl" \
  -F "name=Test Klant" -F "phone=0612345678" -F "email=test@example.nl" \
  -F "formType=offerte" -F "site=schuifpuireparatie-amsterdam.nl" \
  -F "message=Schuifpui klemt, zie foto" \
  -F "bijlage=@foto.webp;type=image/webp"
```
Verwacht: `{"ok":true, …, "bijlagen":{"opgeslagen":1,"geweigerd":[]}}`

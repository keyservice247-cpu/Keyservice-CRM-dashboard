# Keyservice WhatsApp-bridge

Stuurt WhatsApp-berichten (1-op-1 én groepen) van een **wegwerp-nummer** door naar je CRM-dashboard.

> ⚠️ **Onofficiële koppeling.** Gebruik een **apart nummer** (niet je hoofdnummer). Meta kan zulke nummers blokkeren. De bridge leest alleen mee en stuurt door; hij verstuurt zelf niets.

## Hoe het werkt
```
iPhone 12 (wegwerp-nummer, in de groepen)
        │  (gekoppeld apparaat, net als WhatsApp Web)
        ▼
WhatsApp-bridge (dit programma, op een VPS, 24/7 aan)
        │  POST /api/ingest/whatsapp
        ▼
Keyservice CRM-dashboard  →  Inbox / AI
```

## Wat je nodig hebt
- Een **wegwerp-WhatsApp-nummer** op je iPhone 12 (los simkaartje of tweede nummer), in de relevante groepen.
- Een **VPS** (klein Linux-servertje, ±€4–5/maand). Aanrader: Hetzner CX22, of een Ubuntu-VPS bij TransIP/DigitalOcean.

---

## Setup op een VPS (stap voor stap)

### 1. VPS aanmaken
Maak een **Ubuntu 22.04/24.04** VPS aan bij je provider. Je krijgt een IP-adres + inloggegevens. Log in via SSH:
```bash
ssh root@JOUW-VPS-IP
```

### 2. Node.js + benodigdheden installeren
```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git

# Chromium-afhankelijkheden voor WhatsApp Web
apt-get install -y chromium-browser fonts-liberation libatk-bridge2.0-0 \
  libnss3 libxss1 libasound2 libgbm1 || apt-get install -y chromium
```

### 3. De bridge ophalen en installeren
```bash
git clone https://github.com/keyservice247-cpu/Keyservice-CRM-dashboard.git
cd Keyservice-CRM-dashboard/whatsapp-bridge
npm install
cp .env.example .env
nano .env     # vul DASHBOARD_URL en INGEST_TOKEN in (zie hieronder)
```

**In `.env` zet je:**
- `DASHBOARD_URL` = je dashboard-adres, bv. `https://keyservice-crm.onrender.com`
- `INGEST_TOKEN` = exact dezelfde waarde als `INGEST_TOKEN` in je Render-omgeving
  (Render → keyservice-crm → Environment → klik op het oogje bij INGEST_TOKEN)
- `GROUP_FILTER` = laat leeg voor álle groepen, of vul stukjes groepsnaam in (bv. `DRS,Spoed`)
- `FORWARD_DIRECT` = `true` om ook 1-op-1 berichten door te sturen

### 4. Eerste keer starten + QR scannen
```bash
npm start
```
Er verschijnt een **QR-code** in het scherm. Op je iPhone:
**WhatsApp → Instellingen → Gekoppelde apparaten → Apparaat koppelen** → scan de code.

Je ziet daarna `🚀 Bridge actief`. De sessie wordt opgeslagen, dus na een herstart hoef je **niet** opnieuw te scannen.

### 5. Altijd aan houden (zodat hij blijft draaien)
Gebruik `pm2` zodat de bridge automatisch herstart en blijft draaien:
```bash
npm install -g pm2
pm2 start bridge.js --name whatsapp-bridge
pm2 save
pm2 startup     # volg de instructie die hij toont (1 commando kopiëren/plakken)
```
Handige commando's: `pm2 logs whatsapp-bridge` (live meekijken), `pm2 restart whatsapp-bridge`.

---

## Testen
Stuur vanaf een ander toestel een WhatsApp naar het wegwerp-nummer (of post iets in een doorgestuurde groep). Binnen enkele seconden verschijnt het in je dashboard onder **📥 Inbox / AI**.

## Problemen?
- **Geen QR / crasht meteen:** Chromium-pakketten ontbreken → herhaal stap 2.
- **"Doorsturen mislukt 401":** `INGEST_TOKEN` komt niet overeen met die in Render.
- **Steeds opnieuw QR:** de map `wa-session` mag niet verwijderd worden; draai met `pm2` zodat de sessie bewaard blijft.
- **Nummer geblokkeerd:** gebruik een ander wegwerp-nummer; stuur geen spam, houd het rustig.

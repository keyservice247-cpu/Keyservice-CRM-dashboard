// Keyservice WhatsApp-bridge
// Koppelt een (wegwerp-)WhatsApp-account via QR (zoals WhatsApp Web) en stuurt
// inkomende 1-op-1 en groepsberichten door naar het CRM-dashboard.
//
// Draaien op een altijd-aan computer/VPS:
//   1) npm install
//   2) kopieer .env.example naar .env en vul DASHBOARD_URL + INGEST_TOKEN in
//   3) npm start  -> scan de QR-code met de WhatsApp op je iPhone (wegwerp-nummer)
//
// LET OP: dit is een onofficiële koppeling. Gebruik een APART nummer, niet je
// hoofdnummer. Meta kan zulke nummers blokkeren.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

// --- eenvoudige .env-lader (geen extra dependency) ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
  }
}

// Hardcoded omdat de Hetzner-webconsole tekens als _ + = sloopt bij plakken.
// Pas deze twee waarden aan als je dashboard-adres of token verandert.
const HARDCODED_DASHBOARD_URL = 'https://keyservice-crm.onrender.com';
const HARDCODED_INGEST_TOKEN = 'kNG2TbPsgPXqRKkugqmplBXXI0KONYSDiNB+59DLdtg=';

// Hardcoded waarden hebben voorrang (de .env op de server bevat door de console
// beschadigde tekens). Verander hierboven als je wilt afwijken.
const DASHBOARD_URL = (HARDCODED_DASHBOARD_URL || process.env.DASHBOARD_URL || '').replace(/\/$/, '');
const INGEST_TOKEN = HARDCODED_INGEST_TOKEN || process.env.INGEST_TOKEN || '';
const FORWARD_DIRECT = (process.env.FORWARD_DIRECT || 'true') === 'true';
const GROUP_FILTER = (process.env.GROUP_FILTER || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const SESSION_DIR = process.env.SESSION_DIR || './wa-session';

if (!DASHBOARD_URL || !INGEST_TOKEN) {
  console.error('❌ Vul eerst DASHBOARD_URL en INGEST_TOKEN in het .env-bestand in.');
  process.exit(1);
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
  puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
});

// Koppelen via 8-cijferige code i.p.v. QR-scan.
// Nummer staat hier hardcoded omdat de Hetzner-webconsole _ en $ bij plakken
// sloopt. Pas dit getal aan als je een ander nummer koppelt (internationaal,
// alleen cijfers, bv. 31612345678). Leeg laten = QR gebruiken.
const HARDCODED_PAIR_NUMBER = '31685352477';
const PAIR_NUMBER = (process.env.PAIR_NUMBER || HARDCODED_PAIR_NUMBER || '').replace(/[^\d]/g, '');
let pairingRequested = false;

client.on('qr', async (qr) => {
  // Als er een telefoonnummer is opgegeven: vraag een koppelcode aan.
  if (PAIR_NUMBER && !pairingRequested) {
    pairingRequested = true;
    try {
      const code = await client.requestPairingCode(PAIR_NUMBER);
      const pretty = code.match(/.{1,4}/g)?.join('-') || code;
      console.log('\n==============================================');
      console.log('  KOPPELCODE: ' + pretty);
      console.log('==============================================');
      console.log('Op je iPhone: WhatsApp -> Instellingen -> Gekoppelde apparaten');
      console.log('-> Een apparaat koppelen -> "Koppel met telefoonnummer"');
      console.log('-> tik bovenstaande code in.\n');
      console.log('(Code verloopt? Dan verschijnt hier vanzelf een nieuwe.)\n');
    } catch (e) {
      console.error('Kon geen koppelcode aanvragen:', e.message);
      console.error('Controleer of PAIR_NUMBER klopt (bv. 31612345678).');
    }
    return;
  }
  // Anders: toon de QR (tekst + scanbare afbeelding-link).
  console.log('\nScan deze QR-code met WhatsApp op je iPhone:');
  console.log('(WhatsApp -> Instellingen -> Gekoppelde apparaten -> Apparaat koppelen)\n');
  qrcode.generate(qr, { small: true });
  const link = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(qr);
  console.log('\n>>> Lukt scannen niet? Open DEZE link in je browser en scan die QR:\n');
  console.log(link + '\n');
});

client.on('authenticated', () => console.log('Gekoppeld — sessie opgeslagen, geen QR meer nodig bij herstart.'));
client.on('ready', () => {
  console.log(`\nBridge actief. Berichten worden doorgestuurd naar ${DASHBOARD_URL}\n`);
  startHeartbeat();
  startOutbox();
});
client.on('disconnected', (r) => console.log('Verbinding verbroken:', r, '— pm2 herstart automatisch.'));

// Stuurt elke 60s een "ik leef nog"-seintje naar het dashboard. Als deze
// uitblijft, weet het dashboard dat de WhatsApp-bridge stil ligt.
let heartbeatTimer = null;
function startHeartbeat() {
  const ping = async () => {
    try {
      await fetch(`${DASHBOARD_URL}/api/whatsapp/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ingest-token': INGEST_TOKEN },
        body: JSON.stringify({ at: new Date().toISOString() }),
      });
    } catch (e) { /* netwerkfout: volgende keer opnieuw */ }
  };
  ping();
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(ping, 60 * 1000);
}

// Haalt de uitgaande wachtrij op en stuurt opdrachten naar de monteur-groep.
let outboxTimer = null;
let groupCache = null;
async function resolveGroupId(groupName, forceRefresh = false) {
  if (!groupCache || forceRefresh) {
    const chats = await client.getChats();
    groupCache = chats.filter((c) => c.isGroup);
    console.log(`[outbox] ${groupCache.length} groepen bekend: ${groupCache.map((g) => g.name).join(' | ')}`);
  }
  const wanted = (groupName || '').toLowerCase().trim();
  if (wanted.length < 2) return null; // lege/onzin-naam mag NOOIT de eerste groep pakken
  // Een nep-naam voor klant-DM's hoort hier niet thuis.
  if (wanted.includes('klant_dm') || wanted.includes('__')) return null;
  const hit = groupCache.find((g) => (g.name || '').toLowerCase().trim() === wanted)
    || groupCache.find((g) => (g.name || '').toLowerCase().includes(wanted));
  return hit ? hit.id._serialized : null;
}
// Zet een (Nederlands) telefoonnummer om naar een WhatsApp chat-id (internationaal).
function toChatId(phone) {
  let n = String(phone || '').replace(/[^\d]/g, '');
  if (!n) return null;
  if (n.startsWith('00')) n = n.slice(2);          // 0031... -> 31...
  else if (n.startsWith('0')) n = '31' + n.slice(1); // 06... -> 316...
  if (n.length < 10) return null;
  return `${n}@c.us`;
}
function startOutbox() {
  console.log(`[outbox] poller actief — checkt ${DASHBOARD_URL}/api/outbox elke 8s`);
  let warned = false;
  const tick = async () => {
    try {
      const resp = await fetch(`${DASHBOARD_URL}/api/outbox`, { headers: { 'x-ingest-token': INGEST_TOKEN } });
      if (!resp.ok) {
        if (!warned) { console.error(`[outbox] dashboard gaf status ${resp.status} (token/url controleren?)`); warned = true; }
        return;
      }
      warned = false;
      const items = await resp.json();
      if (items.length) console.log(`[outbox] ${items.length} opdracht(en) in de wachtrij`);
      for (const it of items) {
        let ok = false;
        try {
          if (it.phone) {
            // 1-op-1 naar een klant (bv. offerte follow-up). Nummer naar internationaal formaat.
            const chatId = toChatId(it.phone);
            if (chatId) { await client.sendMessage(chatId, it.text); ok = true; console.log(`[outbox] -> follow-up verstuurd naar klant ${it.phone}`); }
            else console.error(`[outbox] ongeldig telefoonnummer: "${it.phone}"`);
          } else {
            let gid = await resolveGroupId(it.group);
            if (!gid) gid = await resolveGroupId(it.group, true); // cache verversen en opnieuw
            if (gid) { await client.sendMessage(gid, it.text); ok = true; console.log(`[outbox] -> verstuurd naar monteur-groep "${it.group}"`); }
            else { console.error(`[outbox] Groep NIET gevonden: "${it.group}" — controleer de exacte groepsnaam bij Monteurs`); }
          }
        } catch (e) { console.error('[outbox] versturen mislukt:', e.message); }
        await fetch(`${DASHBOARD_URL}/api/outbox/${it.id}/done`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-token': INGEST_TOKEN },
          body: JSON.stringify({ ok }),
        }).catch((e) => console.error('[outbox] terugmelden mislukt:', e.message));
      }
    } catch (e) {
      if (!warned) { console.error('[outbox] netwerkfout bij ophalen wachtrij:', e.message); warned = true; }
    }
  };
  if (outboxTimer) clearInterval(outboxTimer);
  outboxTimer = setInterval(tick, 8000); // elke 8 sec
}

// Bepaalt of een groep moet worden doorgestuurd op basis van GROUP_FILTER.
function groupAllowed(name) {
  if (!GROUP_FILTER.length) return true; // geen filter = alle groepen
  const n = (name || '').toLowerCase();
  return GROUP_FILTER.some((f) => n.includes(f));
}

async function forward({ channel, sender, group, body, externalId }) {
  try {
    const resp = await fetch(`${DASHBOARD_URL}/api/ingest/whatsapp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ingest-token': INGEST_TOKEN },
      body: JSON.stringify({ name: sender, group, body, externalId }),
    });
    if (!resp.ok) console.error('Doorsturen mislukt:', resp.status, await resp.text());
    else console.log(`→ doorgestuurd (${channel}) van ${sender}${group ? ' in ' + group : ''}`);
  } catch (e) {
    console.error('Fout bij doorsturen:', e.message);
  }
}

client.on('message', async (msg) => {
  try {
    const chat = await msg.getChat();
    const contact = await msg.getContact();
    const sender = contact?.pushname || contact?.number || 'Onbekend';

    if (chat.isGroup) {
      if (!groupAllowed(chat.name)) return;
      await forward({ channel: 'groep', sender, group: chat.name, body: msg.body || `[${msg.type}]`, externalId: msg.id?._serialized });
    } else {
      if (!FORWARD_DIRECT) return;
      // nummer mee in de body zodat het dashboard het herkent
      const phone = (contact?.number || '').replace(/[^\d+]/g, '');
      const body = `${msg.body || `[${msg.type}]`}${phone ? `\nTelefoon: +${phone}` : ''}`;
      await forward({ channel: '1-op-1', sender, body, externalId: msg.id?._serialized });
    }
  } catch (e) {
    console.error('Verwerkingsfout:', e.message);
  }
});

console.log('Bridge wordt gestart… even geduld voor de QR-code.');
client.initialize();

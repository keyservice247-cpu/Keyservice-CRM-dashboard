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

const DASHBOARD_URL = (process.env.DASHBOARD_URL || '').replace(/\/$/, '');
const INGEST_TOKEN = process.env.INGEST_TOKEN || '';
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

client.on('qr', (qr) => {
  console.log('\n📱 Scan deze QR-code met WhatsApp op je iPhone:');
  console.log('   (WhatsApp → Instellingen → Gekoppelde apparaten → Apparaat koppelen)\n');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => console.log('✅ Gekoppeld — sessie opgeslagen, geen QR meer nodig bij herstart.'));
client.on('ready', () => console.log(`\n🚀 Bridge actief. Berichten worden doorgestuurd naar ${DASHBOARD_URL}\n`));
client.on('disconnected', (r) => console.log('⚠️ Verbinding verbroken:', r, '— herstart het programma.'));

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

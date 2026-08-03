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
const { Client, LocalAuth, MessageMedia } = pkg;

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
  // --disable-dev-shm-usage: op een kleine VPS is /dev/shm te klein -> anders random
  // Chromium-crashes. --disable-gpu: headless, geen GPU nodig.
  puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] },
  takeoverOnConflict: true, // pak de sessie terug i.p.v. crashen bij een conflict
  takeoverTimeoutMs: 10000,
});

// Koppelen via 8-cijferige code i.p.v. QR-scan.
// Nummer staat hier hardcoded omdat de Hetzner-webconsole _ en $ bij plakken
// sloopt. Pas dit getal aan als je een ander nummer koppelt (internationaal,
// alleen cijfers, bv. 31612345678). Leeg laten = QR gebruiken.
const HARDCODED_PAIR_NUMBER = '31685352477';
const PAIR_NUMBER = (process.env.PAIR_NUMBER || HARDCODED_PAIR_NUMBER || '').replace(/[^\d]/g, '');
// Een koppelcode verloopt na een paar minuten. WhatsApp stuurt dan een NIEUWE
// qr-gebeurtenis — en juist dán heb je een verse code nodig. Eerder werd de code
// maar ÉÉN keer aangevraagd (een vlag die nooit werd teruggezet), waardoor er na het
// verlopen alleen nog QR-blokken in de log verschenen en koppelen onmogelijk werd
// zonder de bridge te herstarten. Nu vragen we bij elke ronde een verse code aan.
let laatsteCodeOp = 0;
let codeGeblokkeerd = false;   // WhatsApp weigert (tijdelijk) codes -> QR blijft zichtbaar

client.on('qr', async (qr) => {
  // Als er een telefoonnummer is opgegeven: vraag een (nieuwe) koppelcode aan.
  // De rem van 30 seconden voorkomt dat een snelle reeks qr-gebeurtenissen de log
  // volgooit met codes die je toch niet op tijd kunt intikken.
  if (PAIR_NUMBER && Date.now() - laatsteCodeOp > 30000) {
    laatsteCodeOp = Date.now();
    try {
      const code = await client.requestPairingCode(PAIR_NUMBER);
      const pretty = code.match(/.{1,4}/g)?.join('-') || code;
      console.log('\n==============================================');
      console.log('  KOPPELCODE: ' + pretty);
      console.log('==============================================');
      console.log('Op je iPhone: WhatsApp -> Instellingen -> Gekoppelde apparaten');
      console.log('-> Een apparaat koppelen -> "Koppel met telefoonnummer"');
      console.log('-> tik bovenstaande code in.\n');
      console.log('(Verlopen? Wacht — hieronder verschijnt vanzelf een verse code.)\n');
      return;
    } catch (e) {
      // GEEN code gekregen — meestal omdat WhatsApp een rem zet op het herhaald
      // aanvragen van koppelcodes voor hetzelfde nummer. Dan mag de QR NOOIT
      // wegvallen: dat is op zo'n moment de enige manier om nog te koppelen.
      console.error('Kon geen koppelcode aanvragen:', e.message);
      console.error('Meestal betekent dit: te vaak achter elkaar een code gevraagd.');
      console.error('Wacht 15 minuten, of koppel nu via de QR-code hieronder.\n');
      codeGeblokkeerd = true;
    }
  }
  // Met een nummer ingesteld koppelen we normaal via de CODE; het QR-blok zou de log
  // dan alleen maar vervuilen en de code uit beeld duwen. Lukt de code niet, dan komt
  // de QR juist wél in beeld — anders sta je met lege handen.
  if (PAIR_NUMBER && !codeGeblokkeerd) return;
  // Anders: toon de QR (tekst + scanbare afbeelding-link).
  console.log('\nScan deze QR-code met WhatsApp op je iPhone:');
  console.log('(WhatsApp -> Instellingen -> Gekoppelde apparaten -> Apparaat koppelen)\n');
  qrcode.generate(qr, { small: true });
  const link = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(qr);
  console.log('\n>>> Lukt scannen niet? Open DEZE link in je browser en scan die QR:\n');
  console.log(link + '\n');
});

// Versie van deze bridge (gaat mee met de heartbeat, zichtbaar in het CRM):
// v2 = verstuurt naar groepen rechtstreeks op id (werkt óók tijdens de WhatsApp-
// storing), leest groepsnamen via een reparatie-route, valt terug op 1-op-1 naar de
// monteur als een groep echt niet lukt, en stuurt het groeps-id mee naar het CRM
// zodat dat de koppeling id→naam automatisch leert.
const BRIDGE_VERSION = 2;

client.on('authenticated', () => console.log('Gekoppeld — sessie opgeslagen, geen QR meer nodig bij herstart.'));
client.on('ready', async () => {
  console.log(`\nBridge actief (v${BRIDGE_VERSION}). Berichten worden doorgestuurd naar ${DASHBOARD_URL}\n`);
  startHeartbeat();
  startOutbox();
  // Reparatie voor de WhatsApp-storing (LID-migratie, zomer 2026): vang de lees-fout
  // op groeps-chats af zodat getChats()/getChat() weer bruikbaar zijn. Moet na elke
  // (her)verbinding opnieuw, want WhatsApp-web wordt dan opnieuw geladen.
  try { await hardenGroupChatModel(); console.log('[reparatie] groeps-leesfout (LID) afgevangen — groepsnamen weer beschikbaar'); }
  catch (e) { console.error('[reparatie] afvangen niet gelukt (gaan door met noodpaden):', e.message); }
  // Vul de groepsnaam-cache meteen én ververs elke 5 min, zodat een binnenkomend
  // groepsbericht altijd van de echte naam voorzien kan worden (ook als getChat faalt).
  refreshGroups(true).catch((e) => console.error('[groepen] eerste ophalen mislukt:', e.message));
  setInterval(() => refreshGroups(true).catch(() => {}), 5 * 60 * 1000);
});

// ---- Reparaties voor de WhatsApp-storing van zomer 2026 (LID-migratie) ----
// WhatsApp gaf groepsleden nieuwe interne id's ("lid"). De bibliotheek struikelt
// daarover bij het LEZEN van groeps-chats (getChats/getChat gooien een korte
// minified fout zoals "r"), terwijl VERSTUREN naar een groep gewoon werkt omdat dat
// pad de kapotte conversie overslaat. Twee reparaties, allebei zonder externe code:

// 1) Lees-fout afvangen: crasht het nette groepsmodel (de lid-conversie), bouw dan
// zelf een eenvoudig model mét groepsnaam. Alleen-lezen, veilig, herstelbaar.
async function hardenGroupChatModel() {
  await client.pupPage.evaluate(() => {
    const W = window.WWebJS;
    if (!W || W.__lidHardened) return;
    const orig = W.getChatModel;
    W.getChatModel = async function (chat, opts) {
      try { return await orig(chat, opts); }
      catch (err) {
        if (!chat) return null;
        const model = chat.serialize();
        model.isGroup = !!chat.groupMetadata;
        model.isMuted = !!(chat.mute && chat.mute.expiration !== 0);
        model.formattedTitle = chat.formattedTitle;
        if (chat.groupMetadata) {
          try { model.groupMetadata = chat.groupMetadata.serialize(); }
          catch (e2) { model.groupMetadata = { subject: chat.formattedTitle || '' }; }
          model.isReadOnly = !!chat.groupMetadata.announce;
        }
        model.lastMessage = null;
        delete model.msgs; delete model.msgUnsyncedButtonReplyMsgs; delete model.unsyncedButtonReplies;
        return model;
      }
    };
    W.__lidHardened = true;
  });
}

// 2) Groepsnaam DIRECT uit het geheugen van WhatsApp-web lezen, zonder het kapotte
// pad aan te raken. Let op: window.Store bestaat niet meer in bibliotheek 1.34.x;
// de modules heten nu WAWebCollections/WAWebWidFactory (window.require).
async function readGroupNameDirect(chatId) {
  try {
    const name = await client.pupPage.evaluate((cid) => {
      const pick = (chat) => chat
        ? ((chat.groupMetadata && chat.groupMetadata.subject) || chat.formattedTitle || chat.name || null)
        : null;
      try {
        const WidFactory = window.require('WAWebWidFactory');
        const { Chat } = window.require('WAWebCollections');
        return pick(Chat.get(WidFactory.createWid(cid)));
      } catch (e) {
        try { if (window.Store && window.Store.Chat) return pick(window.Store.Chat.get(cid)); } catch (e2) { /* leeg */ }
        return null;
      }
    }, chatId);
    return name || '';
  } catch { return ''; }
}
// ZELFHERSTEL: bij een verbroken verbinding echt afsluiten, zodat pm2 het proces
// opnieuw start en de sessie zich herstelt. (Voorheen werd hier alleen gelogd en
// bleef de bridge als zombie draaien: heartbeat groen, maar niets kwam meer binnen.)
client.on('disconnected', (r) => {
  console.error('Verbinding verbroken:', r, '— bridge sluit af zodat pm2 opnieuw start.');
  setTimeout(() => process.exit(1), 2000);
});

// Stuurt elke 60s een "ik leef nog"-seintje naar het dashboard — maar ALLEEN als de
// WhatsApp-verbinding ook écht werkt (state CONNECTED). Een half-dode sessie stuurt
// dus geen heartbeat meer, waardoor de zijbalk rood wordt en het uitval-alarm afgaat
// i.p.v. dat alles groen lijkt terwijl er niets meer binnenkomt.
let heartbeatTimer = null;
let notConnectedCount = 0;
let lastIncomingAt = null; // laatst ONTVANGEN WhatsApp-bericht (voor diagnose in het CRM)
function startHeartbeat() {
  const ping = async () => {
    let state = 'ONBEKEND';
    try { state = await client.getState() || 'GEEN'; } catch (e) { state = 'FOUT: ' + e.message; }
    if (state !== 'CONNECTED') {
      notConnectedCount++;
      console.error(`[heartbeat] WhatsApp-status is '${state}' (${notConnectedCount}x op rij) — geen heartbeat gestuurd.`);
      // ZELFHERSTEL: 3 minuten lang niet verbonden -> herstart via pm2.
      if (notConnectedCount >= 3) {
        console.error('[heartbeat] verbinding blijft weg — bridge sluit af zodat pm2 opnieuw start.');
        process.exit(1);
      }
      return;
    }
    notConnectedCount = 0;
    try {
      await fetch(`${DASHBOARD_URL}/api/whatsapp/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ingest-token': INGEST_TOKEN },
        body: JSON.stringify({ at: new Date().toISOString(), state, lastIncomingAt, version: BRIDGE_VERSION }),
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
// Naam-cache: groeps-id -> groepsnaam. Gevuld via client.getChats() — die WERKT nog,
// óók nu msg.getChat() per bericht faalt op de nieuwste WhatsApp-Web-build. Zo kunnen
// we een binnenkomend groepsbericht toch van de ECHTE groepsnaam voorzien (bv.
// "Raf breda…"), zodat het CRM de opdracht-groep herkent en de monteur-dispatch werkt.
const groupNameById = new Map();
let lastRefreshFailAt = 0;
let lastGroupsSyncAt = 0;
async function refreshGroups(forceRefresh = false) {
  if (groupCache && !forceRefresh) return groupCache;
  // Net nog mislukt (storing)? Dan 30s niet opnieuw hameren.
  if (Date.now() - lastRefreshFailAt < 30 * 1000) return groupCache || [];
  try {
    const chats = await client.getChats();
    groupCache = chats.filter((c) => c.isGroup);
    for (const g of groupCache) { const idk = g.id?._serialized; if (idk && g.name) groupNameById.set(idk, g.name); }
    console.log(`[groepen] ${groupCache.length} bekend: ${groupCache.map((g) => g.name).join(' | ')}`);
    syncGroupsToCrm().catch(() => {});
  } catch (e) {
    // getChats kan stuk zijn door de WhatsApp-storing — NOOIT crashen; we werken
    // gewoon door met de naam-cache + directe naam-lezing + versturen op id.
    lastRefreshFailAt = Date.now();
    console.error('[groepen] ophalen mislukt (storing?):', e.message);
  }
  return groupCache || [];
}

// Stuur de complete groepenlijst (id + naam) naar het CRM, dat daarvan ALLE
// koppelingen automatisch leert — ook van groepen die zelf nooit iets sturen.
// Zo koppelt het systeem zichzelf en hoeft niemand op "groep <cijfers>" te letten.
async function syncGroupsToCrm() {
  if (Date.now() - lastGroupsSyncAt < 60 * 1000) return; // max 1x per minuut
  const groups = [...groupNameById.entries()]
    .map(([gid, name]) => ({ id: String(gid).replace(/@.*$/, ''), name }))
    .filter((g) => g.id && g.name);
  if (!groups.length) return;
  lastGroupsSyncAt = Date.now();
  try {
    await fetch(`${DASHBOARD_URL}/api/whatsapp/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ingest-token': INGEST_TOKEN },
      body: JSON.stringify({ groups }),
    });
    console.log(`[groepen] ${groups.length} koppeling(en) doorgegeven aan het CRM`);
  } catch (e) { /* volgende ronde opnieuw */ }
}
async function resolveGroupId(groupName, forceRefresh = false) {
  const list = await refreshGroups(forceRefresh || !groupCache);
  const wanted = (groupName || '').toLowerCase().trim();
  if (wanted.length < 2) return null; // lege/onzin-naam mag NOOIT de eerste groep pakken
  // Een nep-naam voor klant-DM's hoort hier niet thuis.
  if (wanted.includes('klant_dm') || wanted.includes('__')) return null;
  const hit = (list || []).find((g) => (g.name || '').toLowerCase().trim() === wanted)
    || (list || []).find((g) => (g.name || '').toLowerCase().includes(wanted));
  if (hit) return hit.id._serialized;
  // Ook de naam-cache proberen (gevuld uit binnengekomen berichten/directe lezing).
  for (const [gid, nm] of groupNameById) {
    const n = (nm || '').toLowerCase().trim();
    if (n === wanted || n.includes(wanted)) return gid;
  }
  return null;
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
        let detail = '';
        let target = null; // chat-id waar de tekst heen ging (voor eventuele foto's erna)
        // Klant-DM's gaan altijd 1-op-1. Groeps-items (monteur-dispatch, terugkoppeling,
        // CRM-meldingen) proberen éérst de groep; het telefoonnummer daarop is een NOODPAD.
        const isKlantDm = it.kind === 'whatsapp_customer' || it.group === '__klant_dm__' || (!it.group && it.phone);
        try {
          if (isKlantDm) {
            const chatId = toChatId(it.phone);
            if (chatId) { await client.sendMessage(chatId, it.text); ok = true; target = chatId; detail = '1-op-1'; console.log(`[outbox] -> verstuurd naar klant ${it.phone}`); }
            else { detail = `ongeldig telefoonnummer: "${it.phone}"`; console.error(`[outbox] ${detail}`); }
          } else {
            // GROEP versturen: 1) rechtstreeks op groeps-id — dat pad werkt óók tijdens
            // de WhatsApp-storing; 2) anders op naam via cache/getChats; 3) nood: 1-op-1
            // naar het meegegeven nummer (bv. de monteur zelf) — een opdracht mag NOOIT
            // ongemerkt blijven hangen.
            let gid = null;
            const idDigits = String(it.groupId || '').replace(/\D/g, '');
            if (idDigits.length >= 10) gid = `${idDigits}@g.us`;
            if (!gid) {
              const raw = String(it.group || '');
              const rawDigits = raw.replace(/\D/g, '');
              if (/^groep\s+\d+$/i.test(raw) || (rawDigits.length >= 15 && !/[a-z]/i.test(raw.replace(/groep/i, '')))) gid = `${rawDigits}@g.us`;
            }
            if (!gid) gid = await resolveGroupId(it.group);
            if (!gid) gid = await resolveGroupId(it.group, true); // cache verversen en opnieuw
            if (gid) {
              try { await client.sendMessage(gid, it.text); ok = true; target = gid; detail = 'groep'; console.log(`[outbox] -> verstuurd naar groep "${it.group}" (${gid})`); }
              catch (eSend) { detail = 'groep-verzending mislukt: ' + eSend.message; console.error(`[outbox] ${detail}`); }
            } else {
              detail = `groep niet gevonden: "${it.group}"`;
              console.error(`[outbox] ${detail} — koppel de groep in het CRM (Instellingen → Koppelingen), dan verstuurt de bridge op id`);
            }
            if (!ok && it.phone) {
              const chatId = toChatId(it.phone);
              if (chatId) {
                await client.sendMessage(chatId, it.text);
                ok = true; target = chatId; detail = '1-op-1 noodpad (groep niet bereikbaar)';
                console.log(`[outbox] -> NOODPAD: 1-op-1 verstuurd naar ${it.phone} omdat de groep niet lukte`);
              }
            }
          }
        } catch (e) { detail = detail || ('versturen mislukt: ' + e.message); console.error('[outbox] versturen mislukt:', e.message); }
        // Foto's meesturen (door de assistente aangevinkt op de kaart). Tekst is al
        // bezorgd; een foutje bij een foto maakt het item dus NIET mislukt.
        if (ok && target && Array.isArray(it.media) && it.media.length) {
          let nFoto = 0;
          for (const m of it.media.slice(0, 6)) {
            try {
              const rMedia = await fetch(`${DASHBOARD_URL}${m.url}`, { headers: { 'x-ingest-token': INGEST_TOKEN } });
              if (!rMedia.ok) { console.error(`[outbox] foto ophalen mislukt (${rMedia.status}): ${m.url}`); continue; }
              const buf = Buffer.from(await rMedia.arrayBuffer());
              const mm = new MessageMedia(m.mime || 'image/jpeg', buf.toString('base64'), m.name || 'foto.jpg');
              await client.sendMessage(target, mm);
              nFoto++;
            } catch (eM) { console.error('[outbox] foto meesturen mislukt:', eM.message); }
          }
          if (nFoto) console.log(`[outbox] -> ${nFoto} foto('s) meegestuurd`);
        }
        await fetch(`${DASHBOARD_URL}/api/outbox/${it.id}/done`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-token': INGEST_TOKEN },
          body: JSON.stringify({ ok, detail }),
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

// Persistente herkansings-wachtrij: een binnengekomen bericht dat (tijdelijk) niet
// doorgestuurd kan worden — bv. omdat de CRM net een update uitrolt — gaat NIET
// verloren. Het wordt bewaard (ook over een bridge-herstart heen) en opnieuw
// geprobeerd tot het lukt. De CRM ontdubbelt op externalId, dus een dubbele poging
// maakt nooit een dubbele kaart.
const QUEUE_FILE = path.join(__dirname, 'pending-forwards.json');
let retryQueue = [];
try { if (fs.existsSync(QUEUE_FILE)) retryQueue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')) || []; } catch { retryQueue = []; }
function saveQueue() { try { fs.writeFileSync(QUEUE_FILE, JSON.stringify(retryQueue)); } catch (e) { console.error('[wachtrij] opslaan mislukt:', e.message); } }

async function postForward(payload) {
  const resp = await fetch(`${DASHBOARD_URL}/api/ingest/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ingest-token': INGEST_TOKEN },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`status ${resp.status}`);
}

async function forward({ channel, sender, group, groupId, body, externalId, fromPhone }) {
  // groupId gaat mee zodat het CRM de koppeling id→naam automatisch leert (en bij een
  // storing zelf kan vertalen). Bij 1-op-1 berichten is er geen groep(-id), maar wél
  // fromPhone: het échte afzendernummer als hard veld (het CRM matcht daarop de klant).
  const payload = { name: sender, group, groupId, body, externalId, fromPhone };
  const label = `${sender}${group ? ' in ' + group : ''}`;
  try {
    await postForward(payload);
    console.log(`→ doorgestuurd (${channel}) van ${label}`);
  } catch (e) {
    console.error(`Doorsturen mislukt (${e.message}) — in wachtrij voor herkansing: ${label}`);
    retryQueue.push({ payload, label, at: Date.now(), attempts: 0 });
    saveQueue();
  }
}

async function processRetryQueue() {
  if (!retryQueue.length) return;
  const keep = [];
  for (const q of retryQueue) {
    if (Date.now() - q.at > 24 * 3600000 || q.attempts > 300) {
      console.error(`[wachtrij] OPGEGEVEN na ${q.attempts} pogingen (>24u): ${q.label}`);
      continue; // te oud/te vaak — nooit stil, wél gelogd
    }
    try {
      await postForward(q.payload);
      console.log(`[wachtrij] alsnog doorgestuurd: ${q.label}`);
    } catch {
      q.attempts++;
      keep.push(q);
    }
  }
  const changed = keep.length !== retryQueue.length;
  retryQueue = keep;
  if (changed) saveQueue();
}
setInterval(processRetryQueue, 20 * 1000); // elke 20s de wachtrij opnieuw proberen
if (retryQueue.length) console.log(`[wachtrij] ${retryQueue.length} bericht(en) uit vorige sessie worden opnieuw geprobeerd`);

client.on('message', async (msg) => {
  lastIncomingAt = new Date().toISOString(); // bewijs dat ONTVANGEN werkt (gaat mee met de heartbeat)
  try {
    // NOOIT-KWIJT-PRINCIPE: getChat()/getContact() kunnen crashen als WhatsApp z'n
    // binnenkant wijzigt en de bibliotheek verouderd is (zoals de "Verwerkingsfout: r"
    // die groepsberichten liet verdwijnen). Daarom zijn ze hier optioneel: falen ze,
    // dan sturen we het bericht ALSNOG door met de gegevens die we wél hebben, in
    // plaats van het stil weg te gooien.
    let chat = null, contact = null;
    try { chat = await msg.getChat(); } catch (e) { console.error('[ontvangen] getChat faalde (bibliotheek verouderd?):', e.message); }
    try { contact = await msg.getContact(); } catch (e) { console.error('[ontvangen] getContact faalde:', e.message); }
    const remote = msg?.id?.remote || msg.from || '';
    const isGroup = chat ? !!chat.isGroup : String(remote).endsWith('@g.us');
    const sender = contact?.pushname || contact?.number || msg?._data?.notifyName
      || String(msg.author || msg.from || 'Onbekend').replace(/@.*$/, '');

    if (isGroup) {
      // Groepsnaam bepalen: 1) uit getChat (werkt met de LID-reparatie meestal weer),
      // 2) uit de naam-cache, 3) DIRECT uit het geheugen van WhatsApp-web (reparatie-
      // route die de storing omzeilt), 4) via getChats() verversen, 5) als laatste
      // redmiddel het kale id — het CRM vertaalt dat dan via de groeps-koppeling.
      let groupName = (chat && (chat.name || chat.formattedTitle)) || groupNameById.get(remote) || '';
      if (!groupName) groupName = await readGroupNameDirect(remote);
      if (!groupName) { await refreshGroups(true); groupName = groupNameById.get(remote) || ''; }
      const knownName = groupName;
      if (groupName) groupNameById.set(remote, groupName); // onthouden voor de volgende keer
      if (!groupName) groupName = `groep ${String(remote).replace(/@.*$/, '')}`;
      if (knownName && !groupAllowed(knownName)) return; // filter alleen als de naam echt bekend is
      await forward({ channel: 'groep', sender, group: groupName, groupId: String(remote).replace(/@.*$/, ''), body: msg.body || `[${msg.type}]`, externalId: msg.id?._serialized });
    } else {
      if (!FORWARD_DIRECT) return;
      // nummer mee in de body zodat het dashboard het herkent
      const phone = (contact?.number || String(msg.from || '').replace(/@.*$/, '')).replace(/[^\d+]/g, '');
      const body = `${msg.body || `[${msg.type}]`}${phone ? `\nTelefoon: +${phone}` : ''}`;
      await forward({ channel: '1-op-1', sender, body, externalId: msg.id?._serialized, fromPhone: phone ? `+${phone}` : '' });
    }
  } catch (e) {
    console.error('Verwerkingsfout:', e.message);
  }
});

console.log('Bridge wordt gestart… even geduld voor de QR-code.');
client.initialize();

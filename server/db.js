// Eenvoudige JSON-database: alles wordt in geheugen gehouden en weggeschreven
// naar data/db.json. Geen native dependencies, draait overal.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Waar de data wordt bewaard. Standaard de map data/ in het project, maar
// online (bijv. Render) wijzen we dit via DATA_DIR naar een blijvende schijf,
// zodat je gegevens niet verloren gaan bij een herstart of nieuwe versie.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_DATA = {
  users: [],
  customers: [],
  orders: [],
  monteurs: [],
  messages: [],
  reviews: [],
  feedback: [],
  outbox: [],
  trash: [],
  sessions: [],
  activity: [],
  invoices: [],
  finance: { entries: [] },
  settings: { aiAutoApproveThreshold: null },
  _seeded: false,
};

let data = null;
let saveTimer = null;
// Wijzigingsteller voor live-updates (gaat omhoog bij elke opslag).
let changeCounter = Date.now();
export function bumpChange() { changeCounter++; }
export function changeVersion() { return changeCounter; }

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function parseDbFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return { ...structuredClone(DEFAULT_DATA), ...JSON.parse(raw) };
}
// Heeft een geladen dataset échte inhoud? (om lege/kapotte data te herkennen)
function hasRealData(d) {
  return !!(d && ((d.customers && d.customers.length) || (d.orders && d.orders.length) || (d.invoices && d.invoices.length)));
}
// Probeer te herstellen uit de nieuwste bruikbare back-up (nieuwste eerst).
function loadFromBackups() {
  for (const b of listBackups()) {
    try {
      const parsed = parseDbFile(path.join(BACKUP_DIR, b.name));
      if (hasRealData(parsed)) return { parsed, from: b.name };
    } catch { /* volgende back-up proberen */ }
  }
  return null;
}

export function load() {
  ensureDir();
  if (fs.existsSync(DB_FILE)) {
    try {
      data = parseDbFile(DB_FILE);
      return data;
    } catch (err) {
      // KRITIEK: db.json is onleesbaar. NOOIT stil leeg starten en het origineel
      // overschrijven — dan is alle klantdata weg. Eerst het kapotte bestand veilig
      // wegzetten, dan herstellen uit de nieuwste bruikbare back-up.
      console.error('[DB-CORRUPT] db.json is onleesbaar:', err.message);
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.copyFileSync(DB_FILE, `${DB_FILE}.corrupt-${stamp}`);
        console.error(`[DB-CORRUPT] kapotte versie bewaard als db.json.corrupt-${stamp}`);
      } catch (e) { console.error('[DB-CORRUPT] kon kapotte db niet apart bewaren:', e.message); }
      const rec = loadFromBackups();
      if (rec) {
        data = rec.parsed;
        console.error(`[DB-HERSTEL] hersteld uit back-up ${rec.from} — ${(data.customers || []).length} klanten, ${(data.orders || []).length} opdrachten`);
        try { save(); } catch { /* opslaan van het herstel is best-effort */ }
        return data;
      }
      // Geen bruikbare back-up: leeg starten maar MARKEREN, zodat we geen goede
      // back-ups overschrijven met lege data (back-ups worden overgeslagen zolang leeg).
      console.error('[DB-HERSTEL] GEEN bruikbare back-up — start leeg; back-ups tijdelijk uit tot er weer echte data is.');
      data = structuredClone(DEFAULT_DATA);
      data._recoveryEmpty = true;
      return data;
    }
  } else {
    data = structuredClone(DEFAULT_DATA);
    save();
  }
  return data;
}

export function db() {
  if (!data) load();
  return data;
}

// Atomisch én duurzaam wegschrijven: schrijf naar tmp, fsync (dwing naar schijf),
// hernoem (atomair), en fsync de map. Zo raakt db.json nooit half kapot en gaat een
// net-opgeslagen wijziging niet verloren bij een harde crash. Een schrijffout
// (bv. schijf vol) laat het BESTAANDE db.json intact en wordt luid gelogd.
export function save() {
  if (!data) return true;
  changeCounter++;
  ensureDir();
  const tmp = `${DB_FILE}.tmp`;
  try {
    const json = JSON.stringify(data, null, 2);
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, json); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, DB_FILE);
    // Map-fsync zodat de hernoeming ook duurzaam is (best-effort; niet op elk FS nodig).
    try { const dfd = fs.openSync(DATA_DIR, 'r'); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); } } catch { /* optioneel */ }
    return true;
  } catch (e) {
    console.error('[DB-SCHRIJFFOUT] opslaan mislukt (data staat nog in het geheugen):', e.message);
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* opruimen best-effort */ }
    return false;
  }
}

// Debounced opslaan voor veel kleine wijzigingen achter elkaar.
export function saveSoon() {
  bumpChange();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    save();
  }, 200);
}

export function id(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

// ---------- Back-ups ----------
// Een back-up is gewoon een kopie van db.json met een tijdstempel, in DATA_DIR/backups.
// Op Render staat DATA_DIR op de blijvende schijf, dus back-ups overleven herstarts/deploys.
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
// 10 kopieën (2,5 dag bij 6-uurs-interval) is ruim voldoende naast de dagelijkse
// off-site back-upmail. 60 kopieën van een database mét handtekening-afbeeldingen
// heeft ooit de hele Render-schijf volgezet — waardoor ook bijlages en (erger) het
// wegschrijven van de database zelf konden mislukken.
const KEEP_BACKUPS = Math.max(3, Number(process.env.BACKUP_KEEP || 10));

export function backupNow(reason = 'auto') {
  try {
    if (!data) return null;
    // Nooit een verdacht LEGE dataset back-uppen: anders verdringt een lege back-up
    // (na een mislukte/lege start) langzaam alle goede back-ups uit de rotatie.
    if (!hasRealData(data)) { console.error('[BACK-UP] overgeslagen — dataset lijkt leeg (0 klanten/opdrachten/facturen)'); return null; }
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    // EERST oude back-ups opruimen, DAN pas schrijven. Andersom werkt niet op een
    // volle schijf: het schrijven faalt en het opruimen wordt nooit meer bereikt —
    // de schijf blijft dan voorgoed vol.
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('db-') && f.endsWith('.json')).sort();
    while (files.length >= KEEP_BACKUPS) {
      const old = files.shift();
      try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch { /* negeren */ }
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(BACKUP_DIR, `db-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(data));
    return { file, reason };
  } catch (e) {
    console.error('Back-up maken mislukt:', e.message);
    return null;
  }
}

// Vrije schijfruimte (MB) op de datamap — voor de schijf-bewaking. Geeft null als
// het besturingssysteem/Node het niet ondersteunt (dan slaan we de check gewoon over).
export function diskFreeMB() {
  try {
    const st = fs.statfsSync(DATA_DIR);
    return Math.round((st.bavail * st.bsize) / 1048576);
  } catch { return null; }
}

export function listBackups() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('db-') && f.endsWith('.json'))
      .map((f) => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: st.size, at: st.mtime.toISOString() };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch { return []; }
}

export function dbFilePath() { return DB_FILE; }

// Een back-up terugzetten (admin-only route). Zet eerst de huidige stand veilig weg
// (pre-restore-back-up), laadt dan de gekozen back-up in het geheugen en schrijft die weg.
export function restoreBackup(name) {
  if (typeof name !== 'string' || !/^db-[\w.\-]+\.json$/.test(name)) return { error: 'Ongeldige back-upnaam' };
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) return { error: 'Back-up niet gevonden' };
  let parsed;
  try { parsed = parseDbFile(file); } catch (e) { return { error: 'Back-up onleesbaar: ' + e.message }; }
  try { backupNow('pre-restore'); } catch { /* best-effort */ }
  data = parsed;
  delete data._recoveryEmpty;
  const ok = save();
  return ok ? { ok: true, customers: (data.customers || []).length, orders: (data.orders || []).length, invoices: (data.invoices || []).length }
    : { error: 'Terugzetten gelukt in geheugen, maar wegschrijven mislukte (schijf vol?)' };
}

// Start automatische back-ups: één bij opstarten (na 10s) en daarna elke X uur.
export function startBackups() {
  const hours = Math.max(1, Number(process.env.BACKUP_EVERY_HOURS || 6));
  setTimeout(() => backupNow('startup'), 10 * 1000);
  setInterval(() => backupNow('periodiek'), hours * 3600 * 1000);
  console.log(`  Back-ups: elke ${hours} uur naar ${BACKUP_DIR} (laatste ${KEEP_BACKUPS} bewaard)`);
}

export function now() {
  return new Date().toISOString();
}

export function logActivity(actorName, action, detail = '') {
  db().activity.unshift({
    id: id('act'),
    actorName: actorName || 'systeem',
    action,
    detail,
    at: now(),
  });
  // Houd de log behapbaar
  if (db().activity.length > 1000) db().activity.length = 1000;
  saveSoon();
}

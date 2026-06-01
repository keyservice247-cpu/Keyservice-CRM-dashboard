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
  trash: [],
  sessions: [],
  activity: [],
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

export function load() {
  ensureDir();
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      data = { ...structuredClone(DEFAULT_DATA), ...JSON.parse(raw) };
    } catch (err) {
      console.error('Kon db.json niet lezen, start met lege database:', err.message);
      data = structuredClone(DEFAULT_DATA);
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

// Atomisch wegschrijven (schrijf naar tmp, hernoem) zodat het bestand nooit half kapot raakt.
export function save() {
  if (!data) return;
  changeCounter++;
  ensureDir();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE);
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

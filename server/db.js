// Opslag van alle gegevens. Alles staat in het geheugen (snel, geen queries nodig in
// de rest van de code) en wordt duurzaam bewaard op schijf.
//
// TWEE MOTOREN, dezelfde functies naar buiten toe:
//   sqlite (standaard) — SQLite bewaart per RECORD. Wijzig je één kaart, dan wordt
//                        alleen die kaart weggeschreven (~0,05 ms).
//   json   (noodrem)   — het oude model: bij elke wijziging het HELE db.json
//                        herschrijven. Bij 22 MB kostte dat 172 ms, en zolang dat
//                        duurde stond de hele server stil. Zet STORAGE=json om
//                        hiernaar terug te vallen; db.json wordt daarvoor elke 10
//                        minuten bijgewerkt als volledig momentopname-bestand.
//
// De rest van de code (153 endpoints) merkt hier niets van: db() geeft nog steeds
// gewoon een gewoon JavaScript-object terug.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Waar de data wordt bewaard. Standaard de map data/ in het project, maar
// online (bijv. Render) wijzen we dit via DATA_DIR naar een blijvende schijf,
// zodat je gegevens niet verloren gaan bij een herstart of nieuwe versie.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SQLITE_FILE = path.join(DATA_DIR, 'db.sqlite');

// Welke motor? Standaard sqlite; STORAGE=json is de noodrem terug naar het oude model.
let engine = String(process.env.STORAGE || 'sqlite').toLowerCase() === 'json' ? 'json' : 'sqlite';
export function storageEngine() { return engine; }

// Lijsten die PER RECORD worden bewaard (elk item heeft een eigen id). Alle andere
// sleutels (settings, finance, sessions, tellers…) gaan als één klein blokje mee.
// Bewust een vaste lijst en geen automatische herkenning: voorspelbaar is veiliger.
const RECORD_COLLS = ['users', 'customers', 'orders', 'monteurs', 'messages', 'reviews', 'feedback', 'outbox', 'trash', 'invoices', 'activity'];

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

// ============================================================================
// SQLITE-MOTOR
// ============================================================================
// Twee tabellen: 'rec' voor losse records (één rij per kaart/klant/bericht) en
// 'meta' voor alles wat geen lijst-met-ids is (instellingen, finance, sessies) plus
// per lijst de VOLGORDE (#order:<lijst>) — die moet exact bewaard blijven, want de
// inbox, gesprekshistorie en dedup rekenen op de volgorde waarin dingen binnenkwamen.
let sdb = null;             // de SQLite-verbinding
let stmts = null;           // voorbereide queries (sneller)
const written = new Map();  // wat er nu op schijf staat: sleutel -> json-tekst

// WELKE LIJST IS AANGERAAKT? Zonder dit zou elke opslag álle 25.000 records opnieuw
// moeten vergelijken (~65 ms). Nu houden we bij welke lijsten sinds de vorige opslag
// zijn OPGEVRAAGD via db() — en aanraken kan alleen ná opvragen, dus dat is altijd
// een ruime bovengrens. Kost één Set-toevoeging per toegang; niets aan de records
// zelf, dus lezen blijft precies zo snel als nu.
let touched = new Set();
let touchAll = true;        // eerste ronde (en de periodieke controleronde): alles
let dataProxy = null;
let dataProxyVoor = null;   // voor welke dataset de proxy geldt
function markTouched(prop) { if (typeof prop === 'string') touched.add(prop); }
function makeProxy(target) {
  return new Proxy(target, {
    get(t, p) { markTouched(p); return t[p]; },
    set(t, p, v) { markTouched(p); t[p] = v; return true; },
    deleteProperty(t, p) { markTouched(p); delete t[p]; return true; },
  });
}

function openSqlite() {
  ensureDir();
  const Database = require('better-sqlite3');
  const d = new Database(SQLITE_FILE);
  d.pragma('journal_mode = WAL');    // lezen blijft mogelijk tijdens schrijven
  d.pragma('synchronous = NORMAL');  // duurzaam bij crash, veel sneller dan FULL
  d.exec(`CREATE TABLE IF NOT EXISTS rec (coll TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (coll, id));
          CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, json TEXT NOT NULL);`);
  sdb = d;
  stmts = {
    up: d.prepare('INSERT INTO rec (coll, id, json) VALUES (?, ?, ?) ON CONFLICT(coll, id) DO UPDATE SET json = excluded.json'),
    del: d.prepare('DELETE FROM rec WHERE coll = ? AND id = ?'),
    delColl: d.prepare('DELETE FROM rec WHERE coll = ?'),
    meta: d.prepare('INSERT INTO meta (k, json) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET json = excluded.json'),
    delMeta: d.prepare('DELETE FROM meta WHERE k = ?'),
    all: d.prepare('SELECT coll, id, json FROM rec'),
    allMeta: d.prepare('SELECT k, json FROM meta'),
    count: d.prepare('SELECT COUNT(*) AS n FROM rec'),
  };
  return d;
}

// Alles uit SQLite terug in het geheugen zetten, in de oorspronkelijke volgorde.
function sqliteLoad() {
  const out = structuredClone(DEFAULT_DATA);
  const perColl = new Map();
  for (const row of stmts.all.all()) {
    if (!perColl.has(row.coll)) perColl.set(row.coll, new Map());
    perColl.get(row.coll).set(row.id, JSON.parse(row.json));
    written.set(`${row.coll} ${row.id}`, row.json);
  }
  const orders = new Map();  // bewaarde volgorde per lijst
  for (const row of stmts.allMeta.all()) {
    written.set(`#meta ${row.k}`, row.json);
    if (row.k.startsWith('#order:')) { orders.set(row.k.slice(7), JSON.parse(row.json)); continue; }
    if (row.k.startsWith('#blob:')) { out[row.k.slice(6)] = JSON.parse(row.json); continue; }
    out[row.k] = JSON.parse(row.json);
  }
  for (const [coll, recs] of perColl) {
    const volgorde = orders.get(coll) || [];
    const lijst = [];
    for (const rid of volgorde) { const r = recs.get(rid); if (r !== undefined) { lijst.push(r); recs.delete(rid); } }
    for (const r of recs.values()) lijst.push(r); // onbekende volgorde -> achteraan (vangnet)
    out[coll] = lijst;
  }
  return out;
}

// Eenmalige overzetting van db.json naar SQLite, mét controle achteraf. Wijkt er ook
// maar één aantal af, dan gaat de migratie NIET door en blijft alles bij het oude.
function migrateJsonToSqlite(src) {
  const t0 = Date.now();
  const tel = (d) => RECORD_COLLS.reduce((acc, c) => { acc[c] = Array.isArray(d[c]) ? d[c].length : 0; return acc; }, {});
  const voor = tel(src);
  data = src;
  written.clear();
  const changes = collectChanges(RECORD_COLLS.slice(), true);
  applyChanges(changes);
  // Controle: opnieuw inlezen uit SQLite en record voor record natellen.
  const terug = sqliteLoad();
  const na = tel(terug);
  const fouten = RECORD_COLLS.filter((c) => voor[c] !== na[c]).map((c) => `${c}: ${voor[c]} -> ${na[c]}`);
  if (fouten.length) {
    console.error('[MIGRATIE] AFGEBROKEN — aantallen kloppen niet:', fouten.join(', '));
    try { sdb.close(); } catch { /* al dicht */ }
    try { fs.renameSync(SQLITE_FILE, `${SQLITE_FILE}.mislukt-${Date.now()}`); } catch { /* best-effort */ }
    sdb = null; stmts = null; written.clear();
    return false;
  }
  console.log(`[MIGRATIE] db.json -> SQLite gelukt in ${Date.now() - t0} ms — ${RECORD_COLLS.map((c) => `${c}:${na[c]}`).join(' ')}`);
  return true;
}

// Wat is er veranderd sinds de vorige keer? Vergelijkt per record de nieuwe json-tekst
// met wat er op schijf staat. Alleen verschillen worden weggeschreven.
function collectChanges(colls, alles = false, overigeSleutels = null) {
  const ups = [], dels = [], metas = [], delMetas = [], delColls = [];
  for (const coll of colls) {
    const arr = Array.isArray(data[coll]) ? data[coll].slice() : [];
    // Veiligheidsklep: records zonder id (of dubbele ids) kunnen niet per record
    // bewaard worden. Dan gaat die hele lijst als één blokje mee — nooit dataverlies.
    const ids = new Set();
    let perRecord = true;
    for (const r of arr) {
      const rid = r && typeof r === 'object' ? r.id : null;
      if (typeof rid !== 'string' || !rid || ids.has(rid)) { perRecord = false; break; }
      ids.add(rid);
    }
    if (!perRecord) {
      const js = JSON.stringify(arr);
      if (alles || written.get(`#meta #blob:${coll}`) !== js) {
        metas.push([`#blob:${coll}`, js]);
        delColls.push(coll);                       // eventuele losse rijen opruimen
        delMetas.push(`#order:${coll}`);
      }
      continue;
    }
    if (written.has(`#meta #blob:${coll}`)) { delMetas.push(`#blob:${coll}`); }
    const volgorde = [];
    for (const r of arr) {
      volgorde.push(r.id);
      const key = `${coll} ${r.id}`;
      const js = JSON.stringify(r);
      if (alles || written.get(key) !== js) ups.push([coll, r.id, js, key]);
    }
    // Verdwenen records (verwijderd/naar prullenbak verplaatst) ook echt weghalen.
    const prefix = `${coll} `;
    for (const key of written.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rid = key.slice(prefix.length);
      if (!ids.has(rid)) dels.push([coll, rid, key]);
    }
    const ordJs = JSON.stringify(volgorde);
    if (alles || written.get(`#meta #order:${coll}`) !== ordJs) metas.push([`#order:${coll}`, ordJs]);
  }
  // Alles wat géén record-lijst is (settings, finance, sessions, tellers…). Deze zijn
  // klein; bij een gerichte ronde kijken we alleen naar de aangeraakte sleutels.
  const overig = overigeSleutels || Object.keys(data);
  for (const k of overig) {
    if (RECORD_COLLS.includes(k)) continue;
    if (!(k in data)) { if (written.has(`#meta ${k}`)) delMetas.push(k); continue; } // gewist
    const js = JSON.stringify(data[k]);
    if (js === undefined) continue;
    if (alles || written.get(`#meta ${k}`) !== js) metas.push([k, js]);
  }
  // Bij een VOLLEDIGE ronde ook sleutels opruimen die uit de data zijn gehaald (bv.
  // _recoveryEmpty na een herstel) — anders zouden die bij de volgende start terugkomen.
  if (!overigeSleutels) {
    for (const key of written.keys()) {
      if (!key.startsWith('#meta ')) continue;
      const k = key.slice(6);
      if (k.startsWith('#order:') || k.startsWith('#blob:') || RECORD_COLLS.includes(k)) continue;
      if (!(k in data)) delMetas.push(k);
    }
  }
  return { ups, dels, metas, delMetas, delColls };
}

// Alle wijzigingen in ÉÉN transactie: of alles lukt, of er verandert niets.
function applyChanges(ch) {
  const { ups, dels, metas, delMetas, delColls } = ch;
  if (!ups.length && !dels.length && !metas.length && !delMetas.length && !delColls.length) return 0;
  const tx = sdb.transaction(() => {
    for (const coll of delColls) stmts.delColl.run(coll);
    for (const [coll, rid, js] of ups) stmts.up.run(coll, rid, js);
    for (const [coll, rid] of dels) stmts.del.run(coll, rid);
    for (const [k, js] of metas) stmts.meta.run(k, js);
    for (const k of delMetas) stmts.delMeta.run(k);
  });
  tx();
  // Pas ná een geslaagde transactie onthouden wat er op schijf staat.
  for (const coll of delColls) { const p = `${coll} `; for (const key of [...written.keys()]) if (key.startsWith(p)) written.delete(key); }
  for (const [, , js, key] of ups) written.set(key, js);
  for (const [, , key] of dels) written.delete(key);
  for (const [k, js] of metas) written.set(`#meta ${k}`, js);
  for (const k of delMetas) written.delete(`#meta ${k}`);
  return ups.length + dels.length + metas.length;
}

// Welke lijsten moeten we deze ronde vergelijken? Alleen de aangeraakte — behalve bij
// de eerste ronde, een controleronde of een terugzet-actie: dan alles.
function teControleren() {
  if (touchAll) { touchAll = false; touched = new Set(); return { record: RECORD_COLLS.slice(), overig: null }; }
  const aangeraakt = [...touched];
  touched = new Set();
  return { record: aangeraakt.filter((c) => RECORD_COLLS.includes(c)), overig: aangeraakt.filter((c) => !RECORD_COLLS.includes(c)) };
}

// Direct en volledig wegschrijven (gebruikt door save(): afsluiten, terugzetten, e.d.).
function persistSync() {
  const sel = teControleren();
  applyChanges(collectChanges(sel.record, false, sel.overig));
  return true;
}

// Wegschrijven in stukjes: tussen de stukjes door krijgt de server ruimte om
// verzoeken af te handelen. Zo staat het scherm nooit stil, ook niet bij veel data.
const CHUNK = 4000;
let passRunning = false, passAgain = false;
async function persistChunked() {
  if (passRunning) { passAgain = true; return; }
  passRunning = true;
  try {
    do {
      passAgain = false;
      const sel = teControleren();
      const alleChanges = { ups: [], dels: [], metas: [], delMetas: [], delColls: [] };
      for (const coll of sel.record) {
        const ch = collectChanges([coll], false, []);
        for (const k of Object.keys(alleChanges)) alleChanges[k].push(...ch[k]);
        // Bij een grote lijst even ademruimte geven, zodat de server niet blokkeert.
        if ((data[coll] || []).length > CHUNK) await new Promise((r) => setImmediate(r));
      }
      const rest = collectChanges([], false, sel.overig); // settings, finance, sessies…
      for (const k of Object.keys(alleChanges)) alleChanges[k].push(...rest[k]);
      applyChanges(alleChanges);
    } while (passAgain);
    lastSaveFailureAt = 0; lastSaveFailureMsg = '';
  } catch (e) {
    lastSaveFailureAt = Date.now();
    lastSaveFailureMsg = e.message;
    console.error('[DB-SCHRIJFFOUT] SQLite opslaan mislukt (data staat nog in het geheugen):', e.message);
  } finally { passRunning = false; }
}

// Volledige momentopname als db.json wegschrijven. Dit is het TERUGVALPUNT: zet je
// STORAGE=json, dan start het systeem hiervandaan. Draait elke 10 minuten en vóór
// elke back-up, dus je verliest bij terugvallen hooguit een paar minuten.
export function snapshotJson() {
  if (!data) return false;
  ensureDir();
  const tmp = `${DB_FILE}.tmp`;
  try {
    const json = JSON.stringify(data, null, 2);
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, json); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, DB_FILE);
    try { const dfd = fs.openSync(DATA_DIR, 'r'); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); } } catch { /* optioneel */ }
    return true;
  } catch (e) {
    console.error('[MOMENTOPNAME] db.json bijwerken mislukt:', e.message);
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* best-effort */ }
    return false;
  }
}

// ============================================================================

export function load() {
  ensureDir();
  if (engine === 'sqlite') {
    try {
      openSqlite();
      const rijen = stmts.count.get().n;
      if (rijen > 0) {
        data = sqliteLoad();
        console.log(`  Opslag: SQLite (${rijen} records) — ${SQLITE_FILE}`);
        return data;
      }
      // Nog leeg: overzetten vanuit db.json (of vers beginnen).
      if (fs.existsSync(DB_FILE)) {
        let src = null;
        try { src = parseDbFile(DB_FILE); }
        catch (err) {
          console.error('[DB-CORRUPT] db.json is onleesbaar:', err.message);
          const rec = loadFromBackups();
          if (rec) { src = rec.parsed; console.error(`[DB-HERSTEL] migratie gebruikt back-up ${rec.from}`); }
        }
        if (src && migrateJsonToSqlite(src)) return data;
        if (src) { engine = 'json'; data = src; console.error('[OPSLAG] migratie mislukt — verder met het oude JSON-model.'); return data; }
      }
      data = structuredClone(DEFAULT_DATA);
      persistSync();
      console.log('  Opslag: SQLite (nieuw, nog leeg)');
      return data;
    } catch (e) {
      // SQLite werkt niet (bv. ontbrekende module): NOOIT stilvallen — terug naar JSON.
      console.error('[OPSLAG] SQLite niet beschikbaar, val terug op db.json:', e.message);
      engine = 'json';
      sdb = null; stmts = null;
    }
  }
  // ---- JSON-motor (oude gedrag, ongewijzigd) ----
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
  if (engine !== 'sqlite') return data;
  // Eén vaste proxy per dataset, zodat db() === db() blijft gelden.
  if (!dataProxy || dataProxyVoor !== data) { dataProxy = makeProxy(data); dataProxyVoor = data; }
  return dataProxy;
}

// Atomisch én duurzaam wegschrijven. Bij SQLite gaat dat per record in één
// transactie; bij de JSON-noodrem via tmp-bestand + fsync + hernoemen, zodat
// db.json nooit half kapot raakt. Een schrijffout (bv. schijf vol) laat de
// bestaande gegevens intact en wordt luid gelogd.
// Bewaking: wanneer het wegschrijven voor het laatst mislukte (bv. schijf vol).
// De watchdog slaat hierop direct alarm — een stille schrijffout betekent dat
// wijzigingen alleen in het geheugen leven en bij een herstart verloren gaan
// (zo verdwenen op 18 jul ingeplande afspraken; dat mag nooit meer stil gebeuren).
let lastSaveFailureAt = 0;
let lastSaveFailureMsg = '';
export function saveFailure() {
  return lastSaveFailureAt ? { at: lastSaveFailureAt, message: lastSaveFailureMsg } : null;
}

export function save() {
  changeCounter++;
  return writeNow();
}

// Het daadwerkelijke wegschrijven, zonder de wijzigingsteller aan te raken.
function writeNow() {
  if (!data) return true;
  ensureDir();
  if (engine === 'sqlite') {
    try {
      persistSync();
      lastSaveFailureAt = 0;
      lastSaveFailureMsg = '';
      return true;
    } catch (e) {
      lastSaveFailureAt = Date.now();
      lastSaveFailureMsg = e.message;
      console.error('[DB-SCHRIJFFOUT] SQLite opslaan mislukt (data staat nog in het geheugen):', e.message);
      return false;
    }
  }
  const tmp = `${DB_FILE}.tmp`;
  try {
    const json = JSON.stringify(data, null, 2);
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, json); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, DB_FILE);
    // Map-fsync zodat de hernoeming ook duurzaam is (best-effort; niet op elk FS nodig).
    try { const dfd = fs.openSync(DATA_DIR, 'r'); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); } } catch { /* optioneel */ }
    lastSaveFailureAt = 0;
    lastSaveFailureMsg = '';
    return true;
  } catch (e) {
    lastSaveFailureAt = Date.now();
    lastSaveFailureMsg = e.message;
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
    if (engine === 'sqlite') persistChunked();
    else save();
  }, 200);
}

// STIL OPSLAAN: wel bewaren, maar de "er is iets veranderd"-teller NIET ophogen.
// Voor huishoudelijke velden die de gebruiker nooit ziet — de WhatsApp-hartslag
// (elke 60 s!), de mailbox-vulgraad en de systeemcheck-teller. Die lieten elk
// scherm van elke ingelogde gebruiker onnodig herladen, de klok rond.
export function saveSoonQuiet() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (engine === 'sqlite') persistChunked();
    else writeNow();
  }, 200);
}

export function id(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

// ---------- Back-ups ----------
// Een back-up is een volledige kopie van alle gegevens als JSON met tijdstempel, in
// DATA_DIR/backups — ook met SQLite, want JSON is leesbaar, draagbaar en terug te
// zetten op elke versie van het systeem. Op Render staat DATA_DIR op de blijvende
// schijf, dus back-ups overleven herstarts/deploys.
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
    if (engine === 'sqlite') snapshotJson(); // terugvalpunt meteen bijwerken
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

// Het pad naar het volledige JSON-bestand. Met SQLite is dit de momentopname —
// roep eerst snapshotJson() aan als je een ACTUELE kopie nodig hebt (back-upmail,
// downloadknop doen dat).
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
  touchAll = true; // compleet andere dataset: alles opnieuw vergelijken en wegschrijven
  const ok = save();
  if (ok && engine === 'sqlite') snapshotJson();
  return ok ? { ok: true, customers: (data.customers || []).length, orders: (data.orders || []).length, invoices: (data.invoices || []).length }
    : { error: 'Terugzetten gelukt in geheugen, maar wegschrijven mislukte (schijf vol?)' };
}

// Start automatische back-ups: één bij opstarten (na 10s) en daarna elke X uur.
// Met SQLite draait daarnaast elke 10 minuten een momentopname naar db.json, zodat
// terugvallen op de oude motor (STORAGE=json) nooit meer dan een paar minuten kost.
export function startBackups() {
  const hours = Math.max(1, Number(process.env.BACKUP_EVERY_HOURS || 6));
  setTimeout(() => backupNow('startup'), 10 * 1000);
  setInterval(() => backupNow('periodiek'), hours * 3600 * 1000);
  if (engine === 'sqlite') {
    setTimeout(() => snapshotJson(), 30 * 1000);
    setInterval(() => snapshotJson(), 10 * 60 * 1000);
    // Vangnet: elke minuut één VOLLEDIGE vergelijking van alle records. Normaal
    // schrijven we alleen aangeraakte lijsten weg (razendsnel); deze ronde garandeert
    // dat er hoe dan ook nooit iets achterblijft, ook niet bij een onverwacht pad.
    setInterval(() => { touchAll = true; persistChunked(); }, 60 * 1000);
    console.log('  Terugvalpunt: db.json wordt elke 10 minuten bijgewerkt (STORAGE=json om terug te vallen)');
  }
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

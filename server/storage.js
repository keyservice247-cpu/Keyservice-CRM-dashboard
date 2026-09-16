// Opslag van bijlagen (foto's, video's, documenten) van klanten.
// Bestanden komen in DATA_DIR/uploads/ en worden geserveerd via /uploads/<bestand>.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

// Max grootte per bijlage (standaard 25 MB) — beschermt de schijf.
const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024);

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/heic': 'heic', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/3gpp': '3gp',
  'application/pdf': 'pdf', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/amr': 'amr',
};

function ensureDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export function kindFor(mime = '') {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

// HASH-INDEX (16 sep 2026, "heel veel foto's dubbel of driedubbel opgeslagen"):
// inhoud-hash -> bestandsnaam op schijf. Dezelfde foto die nogmaals binnenkomt
// (klant stuurt 'm via site én mail, DRS-groep én monteursgroep, tweede kaart van
// dezelfde klant) krijgt GEEN tweede bestand meer: de nieuwe verwijzing wijst naar
// het bestaande bestand. Het CRM vult de index bij het opstarten uit alle bekende
// bijlages (registerAttachmentFiles); saveBuffer houdt hem daarna zelf bij.
const hashIndex = new Map();
export function registerAttachmentFiles(list) {
  for (const a of list || []) {
    if (a && a.hash && a.file && !hashIndex.has(a.hash)) hashIndex.set(a.hash, a.file);
  }
}
export function forgetAttachmentFile(file) {
  for (const [h, f] of hashIndex) if (f === file) hashIndex.delete(h);
}
export function hashIndexSize() { return hashIndex.size; }

// Slaat een buffer op en geeft metadata terug (of null bij te groot/leeg).
export function saveBuffer(buffer, { mime = 'application/octet-stream', filename = '' } = {}) {
  if (!buffer || !buffer.length) return null;
  if (buffer.length > MAX_BYTES) {
    console.error(`Bijlage te groot (${buffer.length} bytes), overgeslagen.`);
    return null;
  }
  ensureDir();
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const ext = EXT[mime] || (filename.includes('.') ? filename.split('.').pop().slice(0, 5) : 'bin');
  // Bestaat exact dit bestand al? Dan hergebruiken i.p.v. nogmaals wegschrijven.
  let name = hashIndex.get(hash) || '';
  let hergebruikt = false;
  if (name && fs.existsSync(path.join(UPLOAD_DIR, name))) hergebruikt = true;
  else {
    name = `att_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
    hashIndex.set(hash, name);
  }
  return {
    id: 'att_' + crypto.randomBytes(8).toString('hex'),
    file: name,
    url: `/uploads/${name}`,
    mime,
    kind: kindFor(mime),
    filename: filename || name,
    size: buffer.length,
    // Inhoud-vingerafdruk: identieke bestanden (zelfde bytes) hebben dezelfde hash,
    // zodat we dezelfde foto niet 15x aan één kaart hangen.
    hash,
    at: new Date().toISOString(),
    ...(hergebruikt ? { hergebruikt: true } : {}),
  };
}

// Sleutel om identieke bijlages te herkennen: op inhoud-hash, met een terugval op
// grootte+bestandsnaam voor oudere bijlages (van vóór de hash).
export function attKey(a) {
  if (!a) return '';
  return a.hash || `${a.size || 0}:${(a.filename || a.file || '').toLowerCase()}`;
}

// Voeg nieuwe bijlages toe aan een bestaande lijst ZONDER dubbelen (op inhoud). Een
// overgeslagen (identiek) bestand wordt meteen van de schijf verwijderd, zodat er
// geen weesbestanden achterblijven.
export function mergeAttachments(existing = [], incoming = []) {
  const seen = new Set((existing || []).map(attKey).filter(Boolean));
  const out = Array.isArray(existing) ? existing.slice() : [];
  for (const a of incoming || []) {
    const k = attKey(a);
    if (k && seen.has(k)) {
      // Dubbel op inhoud: verwijzing overslaan. Het BESTAND alleen weghalen als het
      // écht een los, vers exemplaar is — een hergebruikt bestand (hash-index) of een
      // bestand dat al in de lijst staat, wordt door anderen gebruikt (16 sep 2026).
      if (!a.hergebruikt && !out.some((x) => x && x.file === a.file)) { try { deleteFile(a.file); } catch { /* al weg */ } }
      continue;
    }
    if (k) seen.add(k);
    out.push(a);
  }
  return out;
}

// Ontdubbel een lijst bijlages op zichzelf (binnen één bericht/upload).
export function dedupeAttachments(list = []) {
  return mergeAttachments([], list);
}

// Inhoud-hash van een reeds opgeslagen bestand (voor bijlages van vóór de hash).
export function attachmentHashFromDisk(file) {
  try {
    if (!file || !/^att_[a-zA-Z0-9_.]+$/.test(file)) return '';
    const p = path.join(UPLOAD_DIR, file);
    if (!fs.existsSync(p)) return '';
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  } catch { return ''; }
}

// VEILIGE opruiming van bestaande dubbele foto's: verwijdert alleen dubbele
// ENTRIES uit een lijst (op inhoud), en laat de bestanden op schijf staan — dus
// nul risico op dataverlies. Vult onderweg de hash aan voor oude bijlages.
export function dedupeListEntries(list) {
  if (!Array.isArray(list) || list.length < 2) return { list: list || [], removed: 0 };
  const seen = new Set(); const out = []; let removed = 0;
  for (const a of list) {
    if (!a) continue;
    if (!a.hash && a.file) { const h = attachmentHashFromDisk(a.file); if (h) a.hash = h; }
    const k = attKey(a);
    if (k && seen.has(k)) { removed++; continue; }
    if (k) seen.add(k);
    out.push(a);
  }
  return { list: out, removed };
}

export function deleteFile(fileName) {
  try {
    if (fileName && /^att_[a-zA-Z0-9_.]+$/.test(fileName)) {
      const p = path.join(UPLOAD_DIR, fileName);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      forgetAttachmentFile(fileName);
    }
  } catch (e) { /* negeren */ }
}

export function fileExists(fileName) {
  try { return !!fileName && /^att_[a-zA-Z0-9_.]+$/.test(fileName) && fs.existsSync(path.join(UPLOAD_DIR, fileName)); } catch { return false; }
}
export function fileSize(fileName) {
  try { return fs.statSync(path.join(UPLOAD_DIR, fileName)).size; } catch { return 0; }
}

// ONTDUBBELEN OP SCHIJF (16 sep 2026). `groepen` = alle bijlage-verwijzingen uit het
// hele CRM (kaarten, prullenbak, gesprekshistorie, losse berichten, taken). Werkwijze:
// (1) ontbrekende hash aanvullen vanaf schijf; (2) per hash één bestand houden (het
// oudste), alle andere verwijzingen dáárheen laten wijzen en de overbodige bestanden
// verwijderen; (3) hash-index vullen. Verwijzingen worden alleen HERSCHREVEN, nooit
// weggehaald — geen enkele kaart raakt een foto kwijt. Met dryRun alleen tellen.
export function ontdubbelOpSchijf(alleVerwijzingen, { dryRun = false } = {}) {
  const perHash = new Map(); // hash -> Map(file -> [refs])
  let zonderBestand = 0;
  for (const a of alleVerwijzingen || []) {
    if (!a || !a.file) continue;
    if (!fileExists(a.file)) { zonderBestand++; continue; }
    if (!a.hash) { const h = attachmentHashFromDisk(a.file); if (h) a.hash = h; else continue; }
    if (!a.size) a.size = fileSize(a.file);
    if (!perHash.has(a.hash)) perHash.set(a.hash, new Map());
    const m = perHash.get(a.hash);
    if (!m.has(a.file)) m.set(a.file, []);
    m.get(a.file).push(a);
  }
  let dubbeleBestanden = 0; let vrijgemaakt = 0; let herschreven = 0;
  for (const [hash, files] of perHash) {
    const namen = [...files.keys()];
    if (!dryRun) hashIndex.set(hash, namen[0]);
    if (namen.length < 2) continue;
    // Oudste bestand houden (naam bevat de tijdstempel).
    namen.sort();
    const houd = namen[0];
    for (const f of namen.slice(1)) {
      dubbeleBestanden++;
      vrijgemaakt += fileSize(f);
      if (dryRun) continue;
      for (const a of files.get(f)) { a.file = houd; a.url = `/uploads/${houd}`; herschreven++; }
      deleteFile(f);
    }
    if (!dryRun) hashIndex.set(hash, houd);
  }
  return { bestanden: [...perHash.values()].reduce((n, m) => n + m.size, 0), dubbeleBestanden, vrijgemaakt, herschreven, zonderBestand };
}

// Weesbestanden: att_-bestanden in de uploadmap waar geen enkele verwijzing meer
// naar wijst (bv. van vóór deze opruiming). Alleen tellen of (met verwijder=true)
// weghalen; bestanden jonger dan een uur blijven staan (kunnen nog in een lopende
// upload/ingest zitten).
export function weesBestanden(alleVerwijzingen, { verwijder = false } = {}) {
  ensureDir();
  const inGebruik = new Set((alleVerwijzingen || []).map((a) => a && a.file).filter(Boolean));
  const grens = Date.now() - 3600000;
  let n = 0; let bytes = 0;
  for (const f of fs.readdirSync(UPLOAD_DIR)) {
    if (!/^att_[a-zA-Z0-9_.]+$/.test(f) || inGebruik.has(f)) continue;
    let st; try { st = fs.statSync(path.join(UPLOAD_DIR, f)); } catch { continue; }
    if (st.mtimeMs > grens) continue;
    n++; bytes += st.size;
    if (verwijder) deleteFile(f);
  }
  return { n, bytes };
}

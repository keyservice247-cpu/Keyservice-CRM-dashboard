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

// Slaat een buffer op en geeft metadata terug (of null bij te groot/leeg).
export function saveBuffer(buffer, { mime = 'application/octet-stream', filename = '' } = {}) {
  if (!buffer || !buffer.length) return null;
  if (buffer.length > MAX_BYTES) {
    console.error(`Bijlage te groot (${buffer.length} bytes), overgeslagen.`);
    return null;
  }
  ensureDir();
  const ext = EXT[mime] || (filename.includes('.') ? filename.split('.').pop().slice(0, 5) : 'bin');
  const name = `att_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
  return {
    id: 'att_' + crypto.randomBytes(8).toString('hex'),
    file: name,
    url: `/uploads/${name}`,
    mime,
    kind: kindFor(mime),
    filename: filename || name,
    size: buffer.length,
    at: new Date().toISOString(),
  };
}

export function deleteFile(fileName) {
  try {
    if (fileName && /^att_[a-zA-Z0-9_.]+$/.test(fileName)) {
      const p = path.join(UPLOAD_DIR, fileName);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } catch (e) { /* negeren */ }
}

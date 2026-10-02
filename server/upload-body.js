// SNELLE UPLOAD-BODY (28 sep 2026, audit server GEMIST 1). Een foto/video gaat vanuit
// het scherm als JSON { filename, mime, dataBase64 } naar POST /api/orders/:id/attachments.
// Met de gewone JSON-lezer kostte een video van 20 MB (27 MB base64) op de hoofdthread:
// buffer → tekst (±40 ms), JSON.parse (±60 ms) en base64 → bytes (±60 ms) in één ruk —
// de HELE server stond intussen stil (gemeten tot 0,35 s wachttijd voor een ander
// verzoek). Deze lezer:
//   1. leest de body als bytes (geen tekstconversie van 27 MB);
//   2. knipt het dataBase64-veld er als bytes uit en leest de rest (een paar honderd
//      bytes) met de gewone JSON.parse;
//   3. laat de route de base64 in blokken van 1 MB omzetten, met een pauze ertussen.
// Alles wat niet precies in dat patroon past (escape-tekens, een gecomprimeerde body,
// vreemde tekens in de base64) gaat via het oude, volledige pad — dezelfde uitkomst.
// Limiet en foutmeldingen zijn gelijk aan express.json (413 / 400).

const KEY = Buffer.from('"dataBase64"');

function fout(status, type, message) {
  const e = new Error(message);
  e.status = status; e.statusCode = status; e.type = type; e.expose = true;
  return e;
}

export function snelleUploadJson({ limit = 40 * 1024 * 1024, terugval } = {}) {
  return (req, res, next) => {
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    const enc = String(req.headers['content-encoding'] || 'identity').toLowerCase();
    // Alleen gewone (niet-gecomprimeerde) JSON; al het andere via de standaardlezer.
    if (!ct.startsWith('application/json') || enc !== 'identity' || (ct.includes('charset=') && !/charset=["']?utf-?8/.test(ct))) {
      return terugval(req, res, next);
    }
    const lengte = Number(req.headers['content-length'] || 0);
    if (lengte > limit) { req.resume(); return next(fout(413, 'entity.too.large', 'request entity too large')); }
    const delen = []; let n = 0; let klaar = false;
    const einde = (err) => { if (klaar) return; klaar = true; next(err); };
    req.on('data', (c) => {
      if (klaar) return;
      n += c.length;
      if (n > limit) { delen.length = 0; req.resume(); return einde(fout(413, 'entity.too.large', 'request entity too large')); }
      delen.push(c);
    });
    req.on('error', (e) => einde(fout(400, 'request.aborted', e.message)));
    req.on('aborted', () => einde(fout(400, 'request.aborted', 'request aborted')));
    req.on('end', () => {
      if (klaar) return;
      const buf = Buffer.concat(delen, n); delen.length = 0;
      try {
        req.body = {};
        if (!buf.length) return einde();
        const seg = zoekBase64(buf);
        if (seg) {
          const rest = Buffer.concat([buf.subarray(0, seg.start), buf.subarray(seg.end)]);
          req.body = JSON.parse(rest.toString('utf8'));
          if (!req.body || typeof req.body !== 'object') throw new Error('geen object');
          req.uploadBase64 = buf.subarray(seg.start, seg.end); // de route zet dit om
          req.body.dataBase64 = req.uploadBase64.length ? '(zie req.uploadBase64)' : '';
        } else {
          const obj = JSON.parse(buf.toString('utf8'));
          if (!obj || typeof obj !== 'object') throw new Error('geen object');
          req.body = obj;
        }
        req._body = true;
        return einde();
      } catch (e) {
        return einde(fout(400, 'entity.parse.failed', e.message));
      }
    });
  };
}

// Positie van de WAARDE van "dataBase64" (zonder aanhalingstekens), of null als het
// niet eenduidig is (dan het volledige pad).
function zoekBase64(buf) {
  const k = buf.indexOf(KEY);
  if (k < 0 || buf.indexOf(KEY, k + KEY.length) >= 0) return null; // ontbreekt / dubbel
  let i = k + KEY.length;
  const spatie = (b) => b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d;
  while (i < buf.length && spatie(buf[i])) i++;
  if (buf[i] !== 0x3a) return null; // ':'
  i++;
  while (i < buf.length && spatie(buf[i])) i++;
  if (buf[i] !== 0x22) return null; // geen string
  const start = i + 1;
  const end = buf.indexOf(0x22, start);
  if (end < 0) return null;
  const bs = buf.indexOf(0x5c, start); // backslash binnen de string → escapes → volledig pad
  if (bs >= 0 && bs < end) return null;
  return { start, end };
}

// base64 (eventueel als data-URL "data:…;base64,…") → bytes, in blokken met een pauze
// ertussen. Zelfde uitkomst als Buffer.from(tekst.split(',').pop(), 'base64').
const BLOK = 1 << 20; // deelbaar door 4: elk blok is los te decoderen
export async function base64NaarBytes(seg) {
  const komma = seg.lastIndexOf(0x2c);
  const data = komma >= 0 ? seg.subarray(komma + 1) : seg;
  const uit = [];
  for (let off = 0; off < data.length; off += BLOK) {
    const eind = Math.min(off + BLOK, data.length);
    const s = data.toString('latin1', off, eind);
    // Alleen schone base64 mag in blokken; '=' alleen in het laatste blok. Anders (bv.
    // regeleindes erin) het hele stuk in één keer — Buffer.from slaat die over.
    if (/[^A-Za-z0-9+/=_-]/.test(s) || (eind < data.length && s.includes('='))) {
      return Buffer.from(data.toString('latin1'), 'base64');
    }
    uit.push(Buffer.from(s, 'base64'));
    if (eind < data.length) await new Promise((r) => setImmediate(r));
  }
  return Buffer.concat(uit);
}

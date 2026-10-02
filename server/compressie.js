// GZIP-COMPRESSIE (28 sep 2026, audit pc-browser#14 / mobiel-browser#17 / server#5).
// De server comprimeerde niets: /api/orders ging als 0,2-1 MB platte JSON over de lijn
// (gzip: ~10%), app.js als 517 KB. Op de telefoon (4G) en bij elke bord-verversing
// telt dat. Zonder extra npm-pakket, met node:zlib:
//   - JSON: res.json comprimeert antwoorden vanaf 1 KB ASYNCHROON (zlib draait in de
//     threadpool van Node, de server blijft intussen verzoeken afhandelen). Kleine
//     antwoorden (de pulse elke 5 s) gaan gewoon plat — daar wint gzip niets.
//   - Statische tekstbestanden (js/css/html/svg/manifest): eenmalig gecomprimeerd en in
//     het geheugen bewaard tot het bestand wijzigt (deploy), mét dezelfde ETag/Last-
//     Modified/Cache-Control als express.static, zodat 304-antwoorden blijven werken.
// Wat er NIET door gaat: bijlagen/foto's/video's (al gecomprimeerd, en range-
// verzoeken), PDF's, alles zonder "Accept-Encoding: gzip" en Range-verzoeken.
// De VORM van elk antwoord blijft identiek — alleen de verpakking verschilt.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const MIN_BYTES = 1024;
const GZIP_OPTS = { level: 6 };

export function wilGzip(req) {
  const ae = String(req.headers['accept-encoding'] || '');
  for (const deel of ae.split(',')) {
    const [naam, ...params] = deel.split(';').map((x) => x.trim().toLowerCase());
    if (naam !== 'gzip') continue;
    // "gzip;q=0" = uitdrukkelijk NIET.
    const q = params.find((p) => p.startsWith('q='));
    return !q || Number(q.slice(2)) > 0;
  }
  return false;
}

// ---- JSON-antwoorden ----
export function jsonCompressie() {
  return (req, res, next) => {
    const origJson = res.json.bind(res);
    res.json = function jsonGzip(body) {
      if (req.method === 'HEAD' || !wilGzip(req) || res.headersSent) return origJson(body);
      let str;
      try { str = JSON.stringify(body); } catch { return origJson(body); } // zelfde fout als vroeger
      if (typeof str !== 'string' || str.length < MIN_BYTES) return origJson(body);
      if (!res.get('Content-Type')) res.set('Content-Type', 'application/json; charset=utf-8');
      res.vary('Accept-Encoding');
      zlib.gzip(str, GZIP_OPTS, (err, buf) => {
        // Intussen al een ander antwoord verstuurd (bv. de foutafhandelaar)? Dan niets
        // meer doen — nooit "headers already sent".
        if (res.headersSent || res.writableEnded) return;
        try {
          if (err) return res.send(str);
          res.set('Content-Encoding', 'gzip');
          res.send(buf);
        } catch (e) {
          console.error('[gzip] antwoord versturen mislukt:', e.message);
        }
      });
      return res;
    };
    next();
  };
}

// ---- Statische tekstbestanden ----
const TEKST_EXT = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.webmanifest', '.txt', '.map']);
const cache = new Map(); // bestandspad -> { mtimeMs, size, gz }
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
let cacheBytes = 0;

function gzipAsync(buf) {
  return new Promise((resolve, reject) => zlib.gzip(buf, GZIP_OPTS, (e, out) => (e ? reject(e) : resolve(out))));
}

// Zelfde ETag-vorm als `send` (express.static): W/"<grootte-hex>-<mtime-hex>". Met een
// -gz-achtervoegsel, want de gecomprimeerde bytes zijn anders dan de platte.
function etagVoor(st) {
  return `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}-gz"`;
}

export async function stuurGzipBestand(req, res, file) {
  const st = await fs.promises.stat(file);
  if (!st.isFile()) return false;
  let c = cache.get(file);
  if (!c || c.mtimeMs !== st.mtimeMs || c.size !== st.size) {
    const gz = await gzipAsync(await fs.promises.readFile(file));
    if (c) cacheBytes -= c.gz.length;
    if (cacheBytes + gz.length > MAX_CACHE_BYTES) { cache.clear(); cacheBytes = 0; }
    c = { mtimeMs: st.mtimeMs, size: st.size, gz };
    cache.set(file, c);
    cacheBytes += gz.length;
  }
  if (res.headersSent) return true;
  res.type(path.extname(file));
  res.set('Cache-Control', 'public, max-age=0');
  res.set('Last-Modified', new Date(st.mtimeMs).toUTCString());
  res.set('ETag', etagVoor(st));
  res.vary('Accept-Encoding');
  if (req.fresh) { res.status(304).end(); return true; }
  res.set('Content-Encoding', 'gzip');
  res.set('Content-Length', String(c.gz.length));
  if (req.method === 'HEAD') { res.end(); return true; }
  res.end(c.gz);
  return true;
}

export function statischeCompressie(rootDir) {
  const root = path.resolve(rootDir);
  return (req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.headers.range || !wilGzip(req)) return next();
    let rel;
    try { rel = decodeURIComponent(req.path); } catch { return next(); }
    if (rel.includes('\0')) return next();
    const ext = path.extname(rel).toLowerCase();
    if (!TEKST_EXT.has(ext)) return next();
    const file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
    if (!file.startsWith(root + path.sep)) return next();
    // Verborgen bestanden (zoals .env) serveert express.static ook niet.
    if (file.slice(root.length).split(path.sep).some((d) => d.startsWith('.'))) return next();
    stuurGzipBestand(req, res, file).then((klaar) => { if (!klaar) next(); }).catch(() => next());
  };
}

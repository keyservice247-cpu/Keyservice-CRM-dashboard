// MEDIA-REPARATIE (28 sep 2026) — "het CRM stuurt geen foto's meer mee".
// Sinds de WhatsApp-Web-versies van 17 sep 2026 faalt in whatsapp-web.js 1.34.7 ELKE
// verzending met een bijlage (foto, video, PDF) met "Data passed to getter must include
// an id property (it's how we memoize) but got undefined". Tekst gaat gewoon, en de
// bridge meldde het item daarom als verstuurd: de monteur kreeg de opdracht, maar
// zonder foto's. Oorzaak zit in de bibliotheek: het media-model heeft een interne
// __x_id, en die overschrijft bij het samenstellen van het bericht de échte bericht-id.
// De reparatie is één regel, `delete message.__x_id` direct na het samenstellen
// (upstream PR wwebjs/whatsapp-web.js#201923, door meerdere gebruikers in productie
// bevestigd). Er is nog geen nieuwe versie van de bibliotheek, dus zet de bridge die
// regel er bij elke start zelf in, vóórdat de bibliotheek geladen wordt. Staat hij er
// al (of komt er een versie die het zelf oplost), dan gebeurt er niets.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export const MEDIAFIX_MARKER = 'keyservice-mediafix';
const ANKER = "// Bot's won't reply if canonicalUrl is set (linking)";
const FIX_REGEL = `delete message.__x_id; // ${MEDIAFIX_MARKER}: media-model-id mag de bericht-id niet overschrijven (wwebjs#201923)`;

// Past de reparatie toe op de broncode van Utils.js. Puur (geen bestanden), zodat het
// CRM hem kan testen zonder dat whatsapp-web.js geïnstalleerd is.
// status: 'toegepast' | 'al-aanwezig' | 'anker-niet-gevonden' | 'fout'
export function patchBron(src) {
  if (typeof src !== 'string' || !src.trim()) return { status: 'fout', detail: 'leeg bestand' };
  if (src.includes(MEDIAFIX_MARKER) || /delete\s+message\.__x_id\b/.test(src)) return { status: 'al-aanwezig', src };
  // 1) Vaste commentaarregel die in sendMessage direct ná het berichtobject staat.
  if (src.split(ANKER).length === 2) {
    const i = src.indexOf(ANKER);
    const regelStart = src.lastIndexOf('\n', i) + 1;
    const inspring = (src.slice(regelStart, i).match(/^[ \t]*/) || [''])[0];
    return {
      status: 'toegepast', detail: 'anker',
      src: `${src.slice(0, regelStart)}${inspring}${FIX_REGEL}\n${src.slice(regelStart)}`,
    };
  }
  // 2) Reserve: het einde van het (enige) `const message = {…};` in het bestand.
  const starts = [...src.matchAll(/^([ \t]*)const message = \{[ \t]*$/gm)];
  if (starts.length === 1) {
    const inspring = starts[0][1];
    const sluit = new RegExp(`^${inspring}\\};[ \\t]*$`, 'm');
    const rest = src.slice(starts[0].index);
    const m = rest.match(sluit);
    if (m) {
      const eind = starts[0].index + m.index + m[0].length;
      return {
        status: 'toegepast', detail: 'reserve-anker',
        src: `${src.slice(0, eind)}\n${inspring}${FIX_REGEL}${src.slice(eind)}`,
      };
    }
  }
  return { status: 'anker-niet-gevonden', detail: 'sendMessage heeft een onbekende vorm (andere versie van whatsapp-web.js?)' };
}

// Zoekt het bestand van de bibliotheek zonder hem te laden (require.resolve voert
// niets uit — de bibliotheek leest Utils.js pas als hij geladen wordt).
export function zoekUtilsBestand(vanaf = import.meta.url) {
  try {
    const req = createRequire(vanaf);
    const hoofd = req.resolve('whatsapp-web.js');
    const f = path.join(path.dirname(hoofd), 'src', 'util', 'Injected', 'Utils.js');
    return fs.existsSync(f) ? f : '';
  } catch { return ''; }
}

function versieVan(utilsBestand) {
  try {
    const pkgFile = path.join(path.dirname(utilsBestand), '..', '..', '..', 'package.json');
    return JSON.parse(fs.readFileSync(pkgFile, 'utf8')).version || '';
  } catch { return ''; }
}

// Leest, repareert en schrijft Utils.js. Gooit nooit: de bridge moet altijd kunnen
// starten, ook als de reparatie niet lukt (dan gaat tekst gewoon door zoals voorheen).
export function pasMediaFixToe({ bestand } = {}) {
  const doel = bestand || zoekUtilsBestand();
  if (!doel) return { status: 'niet-gevonden', detail: 'whatsapp-web.js niet gevonden', versie: '' };
  const versie = versieVan(doel);
  try {
    const r = patchBron(fs.readFileSync(doel, 'utf8'));
    if (r.status === 'toegepast') fs.writeFileSync(doel, r.src);
    return { status: r.status, detail: r.detail || '', versie };
  } catch (e) {
    return { status: 'fout', detail: String(e.message || e).slice(0, 160), versie };
  }
}

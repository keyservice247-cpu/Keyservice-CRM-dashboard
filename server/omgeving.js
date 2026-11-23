// TESTOMGEVING (23 nov 2026, na de audit). Met OMGEVING=test draait de server in een
// afgeschermde stand, bedoeld om nieuwe schermen te bekijken zonder dat er iets naar
// buiten kan:
//   1. ALLE koppelingen worden hier hard uitgezet — ook als iemand per ongeluk de
//      sleutels van productie in de testdienst zet. Geen mail, geen WhatsApp, geen
//      Google, geen AI. Een testomgeving mag nooit met een echte klant praten.
//   2. Inloggen gaat met een eigen beheerder uit ADMIN_EMAIL / ADMIN_PASSWORD
//      (zie beheerder.js); de voorbeeldwachtwoorden werken er niet.
//   3. De database wordt gevuld met verzonnen klanten (zie testdata.js).
// DIT BESTAND MOET ALS ALLEREERSTE WORDEN GEÏMPORTEERD in index.js: imports draaien in
// volgorde, en de andere modules mogen de sleutels nooit te zien krijgen.
import crypto from 'node:crypto';

export const TEST = process.env.OMGEVING === 'test';

// Alles wat een verbinding naar buiten kan openen.
const KOPPEL_RE = /^(SMTP_|IMAP_|SENT_IMAP_|WHATSAPP_|GOOGLE_|ANTHROPIC_)/;
export const uitgezet = [];
if (TEST) {
  for (const k of Object.keys(process.env)) {
    if (KOPPEL_RE.test(k)) { uitgezet.push(k); delete process.env[k]; }
  }
  // De testgegevens komen via dezelfde ingang binnen als echte berichten; daarvoor is
  // een (eigen, willekeurig) token nodig. Nooit dat van productie.
  if (!process.env.INGEST_TOKEN) process.env.INGEST_TOKEN = crypto.randomBytes(24).toString('hex');
  // Zonder eigen geheim zijn links niet te vervalsen maar ook niet stabiel — prima hier.
  if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
}

export function isTestOmgeving() { return TEST; }

// Voorbeeldwachtwoorden uit seed.js mogen alleen werken in de lokale testrunner
// (SESSION_SECRET=test) of met DEMO_LOGIN=1 — nooit op een echte installatie en ook
// niet op de testomgeving bij Render (die is via internet bereikbaar).
export function demoLoginToegestaan() {
  return process.env.SESSION_SECRET === 'test' || process.env.DEMO_LOGIN === '1';
}
export const DEMO_WACHTWOORDEN = ['admin123', 'sara123', 'ahmed123'];

// Instelbare statussen (kolommen) en herkomst-bronnen.
// Deze staan in de database (settings) zodat de gebruiker ze zelf kan
// aanpassen, toevoegen of verwijderen — zonder de code te wijzigen.
import { db, save } from './db.js';

export const DEFAULT_STATUSES = [
  { key: 'open', label: 'Open / Nieuw', color: '#6366f1' },
  { key: 'offerte_verzonden', label: 'Offerte verzonden', color: '#f59e0b' },
  { key: 'afspraak_ingepland', label: 'Afspraak ingepland', color: '#0ea5e9' },
  { key: 'afgerond', label: 'Afgerond', color: '#10b981' },
  { key: 'geannuleerd', label: 'Geannuleerd', color: '#ef4444' },
];

export const DEFAULT_SOURCES = [
  'Keyservice e-mail',
  'Keyservice WhatsApp',
  'DRS WhatsApp groep',
  'Telefoon',
  'Handmatig',
];

// Vult ontbrekende instellingen aan bij het opstarten (ook voor bestaande
// databases die nog geen statussen/bronnen hadden). Reset niets dat al bestaat.
export function ensureSettings() {
  const s = db().settings || (db().settings = {});
  if (!Array.isArray(s.statuses) || s.statuses.length === 0) {
    s.statuses = structuredClone(DEFAULT_STATUSES);
  }
  if (!Array.isArray(s.sources) || s.sources.length === 0) {
    s.sources = structuredClone(DEFAULT_SOURCES);
  }
  if (s.aiAutoApproveThreshold === undefined) s.aiAutoApproveThreshold = null;
  save();
}

export function getStatuses() {
  return db().settings.statuses || DEFAULT_STATUSES;
}
export function getStatusKeys() {
  return getStatuses().map((s) => s.key);
}
export function getStatusLabels() {
  const out = {};
  getStatuses().forEach((s) => { out[s.key] = s.label; });
  return out;
}
export function getSources() {
  return db().settings.sources || DEFAULT_SOURCES;
}
export function isValidStatus(key) {
  return getStatusKeys().includes(key);
}
export function firstStatusKey() {
  return getStatusKeys()[0] || 'open';
}
// Zorgt dat een status altijd bestaat; anders val terug op de eerste kolom.
export function normalizeStatus(key) {
  return isValidStatus(key) ? key : firstStatusKey();
}

// Maak een nette sleutel van een label (voor nieuwe kolommen).
export function slugify(label) {
  return String(label || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || ('status_' + Math.random().toString(36).slice(2, 7));
}

// Valideer/normaliseer een door de gebruiker aangeleverde statussenlijst.
export function sanitizeStatuses(input) {
  if (!Array.isArray(input)) return null;
  const seen = new Set();
  const out = [];
  for (const item of input) {
    const label = (item.label || '').trim();
    if (!label) continue;
    let key = (item.key || slugify(label)).trim();
    while (seen.has(key)) key = key + '_';
    seen.add(key);
    out.push({ key, label, color: /^#[0-9a-fA-F]{6}$/.test(item.color) ? item.color : '#64748b' });
  }
  return out.length ? out : null;
}

export function sanitizeSources(input) {
  if (!Array.isArray(input)) return null;
  const out = [...new Set(input.map((s) => String(s || '').trim()).filter(Boolean))];
  return out;
}

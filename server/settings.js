// Instelbare statussen (kolommen) en herkomst-bronnen.
// Deze staan in de database (settings) zodat de gebruiker ze zelf kan
// aanpassen, toevoegen of verwijderen — zonder de code te wijzigen.
import { db, save } from './db.js';

export const DEFAULT_STATUSES = [
  { key: 'nieuw', label: 'Nieuw', color: '#6366f1', secondary: false },
  { key: 'open', label: 'In behandeling', color: '#8b5cf6', secondary: false },
  { key: 'offerte_verzonden', label: 'Offerte verzonden', color: '#f59e0b', secondary: false },
  { key: 'afspraak_ingepland', label: 'Afspraak ingepland', color: '#0ea5e9', secondary: false },
  { key: 'afgerond', label: 'Afgerond', color: '#10b981', secondary: true },
  { key: 'geannuleerd', label: 'Geannuleerd', color: '#ef4444', secondary: true },
];

export const DEFAULT_SOURCES = [
  'Keyservice e-mail',
  'Keyservice WhatsApp',
  'DRS WhatsApp groep',
  'Telefoon',
  'Handmatig',
];

// Snelle standaardantwoorden (sjablonen) die assistente/admin met één klik
// kan kopiëren (en later, na e-mailkoppeling, direct versturen).
export const DEFAULT_TEMPLATES = [
  {
    id: 'tmpl_hefschuifpui',
    title: 'Offerte — Hefschuifpui complete reparatie (€740 excl.)',
    body: `Hefschuifpui complete reparatie:
• arbeid 2 monteurs
• vervangen van loopwagens en toebehoren
• vervangen van hefsluiting

Totaal: 740,- exclusief btw

Resultaat: makkelijker openen en sluiten van schuifpui met 3 jaar garantie op producten, 1 jaar op arbeid.

Rails worden zelden vervangen en kunnen indien nodig voor meerprijs vervangen worden.

Bij akkoord kunnen we meestal binnen 1 week een afspraak inplannen en de installatie starten.`,
  },
  {
    id: 'tmpl_alu_schuifpui',
    title: 'Offerte — Aluminium schuifpui complete reparatie (€640 excl.)',
    body: `Aluminium schuifpui complete reparatie:
• arbeid 2 monteurs
• vervangen van loopwagens en toebehoren
• afstellen van schuifpui
• afstellen sluiting

Totaal: 640,- exclusief btw

Resultaat: makkelijker openen en sluiten van schuifpui met 3 jaar garantie op producten, 1 jaar op arbeid.

Rails worden zelden vervangen en kunnen indien nodig voor meerprijs vervangen worden.

Bij akkoord kunnen we meestal binnen 1 week een afspraak inplannen en de installatie starten.`,
  },
  {
    id: 'tmpl_fotos',
    title: 'Vraag om foto’s / info (schuifpui)',
    body: `Graag foto’s en video’s van uw schuifpui:
• dichtbij van de hendel
• foto van het geheel
• foto’s van de rail

• Breedte en hoogte van het bewegende deel
• soort materiaal schuifpui

• Woonplaats (eventueel volledig adres)`,
  },
  {
    id: 'tmpl_opvolging',
    title: 'Opvolging openstaande offerte',
    body: `Beste klant, ik zag dat de offerte voor de schuifpui-reparatie nog openstaat. Dat is helemaal prima.
Wilt u dat ik de aanvraag nog even open laat staan, of zal ik hem later nog eens rustig opvolgen?`,
  },
];

// Vult ontbrekende instellingen aan bij het opstarten (ook voor bestaande
// databases die nog geen statussen/bronnen hadden). Reset niets dat al bestaat.
export function ensureSettings() {
  const s = db().settings || (db().settings = {});
  if (!Array.isArray(s.statuses) || s.statuses.length === 0) {
    s.statuses = structuredClone(DEFAULT_STATUSES);
  }
  // Migratie: voeg de nieuwe "Nieuw"-kolom toe en zet secondary-vlaggen, als de
  // database nog de oude kolommenset heeft (zonder 'nieuw'-kolom).
  if (s.statuses.length && !s.statuses.some((x) => x.key === 'nieuw') && !s.statusesMigratedV2) {
    const open = s.statuses.find((x) => x.key === 'open');
    if (open) open.label = 'In behandeling';
    s.statuses.unshift({ key: 'nieuw', label: 'Nieuw', color: '#6366f1', secondary: false });
    s.statuses.forEach((x) => { x.secondary = ['afgerond', 'geannuleerd'].includes(x.key); });
    s.statusesMigratedV2 = true;
  }
  if (!Array.isArray(s.sources) || s.sources.length === 0) {
    s.sources = structuredClone(DEFAULT_SOURCES);
  }
  if (!Array.isArray(s.templates) || s.templates.length === 0) {
    s.templates = structuredClone(DEFAULT_TEMPLATES);
  }
  if (s.aiAutoApproveThreshold === undefined) s.aiAutoApproveThreshold = null;
  if (s.companyProfile === undefined) s.companyProfile = DEFAULT_COMPANY_PROFILE;
  // WhatsApp: uit welke groep(en) maken we opdrachten? Standaard de DRS/"Raf Breda"-groep.
  // Leeg = alle groepen. Berichten uit andere groepen gaan naar "Overige".
  if (s.whatsappOrderGroups === undefined) s.whatsappOrderGroups = 'raf breda';
  // Standaard handtekening onder uitgaande e-mails vanuit het dashboard.
  if (s.emailSignature === undefined) s.emailSignature = DEFAULT_EMAIL_SIGNATURE;
  save();
}

// Nette standaard-handtekening onder elke mail die vanuit het dashboard wordt verstuurd.
export const DEFAULT_EMAIL_SIGNATURE = `Met vriendelijke groet,
Team Key Service 24/7
085 060 2359`;

export function getEmailSignature() {
  const s = db().settings;
  return (s.emailSignature !== undefined ? s.emailSignature : DEFAULT_EMAIL_SIGNATURE);
}

// Lijst met groepsnamen (stukjes) waaruit we WhatsApp-opdrachten oppakken.
// Leeg = alle groepen toegestaan.
export function getWhatsappOrderGroups() {
  return String(db().settings.whatsappOrderGroups || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}
// Hoort een WhatsApp-groep bij de "opdracht-groepen"? (substring-match, hoofdletter-ongevoelig)
export function isWhatsappOrderGroup(groupName) {
  const allow = getWhatsappOrderGroups();
  if (!allow.length) return true; // geen filter ingesteld = alle groepen
  const n = (groupName || '').toLowerCase();
  return allow.some((a) => n.includes(a));
}

// Standaard bedrijfsprofiel (kennisbank) — de gebruiker past dit aan in Instellingen.
// Deze context krijgt de AI bij elke beoordeling/antwoord mee.
export const DEFAULT_COMPANY_PROFILE = `Keyservice is een sleutel- en slotenmakersbedrijf in Nederland.
Diensten: sloten vervangen/repareren, cilindersloten, inbraakschade herstellen,
buitengesloten/openingen, schuifpui- en hefschuifpui-reparatie (loopwagens, rails,
beslag), sleutels bijmaken, hang- en sluitwerk, montage.
Werkwijze: klant stuurt aanvraag via e-mail, WhatsApp of telefoon. Wij vragen indien
nodig om foto's, maten en adres, sturen een offerte/prijsindicatie, en plannen bij
akkoord een afspraak. Toon naar klanten: vriendelijk, professioneel, bondig.`;

export function getCompanyProfile() {
  return db().settings.companyProfile || DEFAULT_COMPANY_PROFILE;
}

export function getTemplates() {
  return db().settings.templates || DEFAULT_TEMPLATES;
}

export function sanitizeTemplates(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const t of input) {
    const title = (t.title || '').trim();
    const body = (t.body || '').trim();
    if (!title && !body) continue;
    out.push({ id: t.id || ('tmpl_' + Math.random().toString(36).slice(2, 9)), title: title || 'Sjabloon', body });
  }
  return out;
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
// De kolom voor ingeplande afspraken (op sleutel of label herkend).
// Geeft null als er geen geschikte kolom bestaat.
export function appointmentStatusKey() {
  const s = getStatuses();
  const found = s.find((x) => x.key === 'afspraak_ingepland')
    || s.find((x) => /afspraak|ingepland|gepland/i.test(x.key + ' ' + x.label));
  return found ? found.key : null;
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
    out.push({ key, label, color: /^#[0-9a-fA-F]{6}$/.test(item.color) ? item.color : '#64748b', secondary: !!item.secondary });
  }
  return out.length ? out : null;
}

export function sanitizeSources(input) {
  if (!Array.isArray(input)) return null;
  const out = [...new Set(input.map((s) => String(s || '').trim()).filter(Boolean))];
  return out;
}

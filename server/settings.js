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
  if (s.autoReply === undefined) s.autoReply = structuredClone(DEFAULT_AUTOREPLY);
  if (s.followUp === undefined) s.followUp = structuredClone(DEFAULT_FOLLOWUP);
  if (s.backupMail === undefined) s.backupMail = structuredClone(DEFAULT_BACKUP_MAIL);
  if (s.terugkoppeling === undefined) s.terugkoppeling = structuredClone(DEFAULT_TERUGKOPPELING);
  if (s.appointmentMsg === undefined) s.appointmentMsg = structuredClone(DEFAULT_APPOINTMENT_MSG);
  if (s.onderwegMsg === undefined) s.onderwegMsg = structuredClone(DEFAULT_ONDERWEG_MSG);
  if (s.reviewRequest === undefined) s.reviewRequest = structuredClone(DEFAULT_REVIEW_REQUEST);
  if (s.autoScan === undefined) s.autoScan = { enabled: false, hour: 5 };
  save();
}

// Automatische terugkoppeling: zodra een DRS-opdracht een uitkomst-status krijgt,
// gaat er een WhatsApp-bericht naar de CONTROLE-groep (bv. Abdel), die het
// controleert en doorstuurt naar de DRS-groep. Bewust NIET rechtstreeks naar DRS.
export const DEFAULT_TERUGKOPPELING = {
  enabled: false,
  monteurId: '',                 // monteur wiens groep de terugkoppeling ontvangt
  statuses: ['afgerond', 'geannuleerd', 'afspraak_ingepland', 'offerte_verzonden'],
};
export function getTerugkoppeling() {
  const t = db().settings.terugkoppeling || {};
  return {
    enabled: !!t.enabled,
    monteurId: t.monteurId || '',
    statuses: Array.isArray(t.statuses) && t.statuses.length ? t.statuses : DEFAULT_TERUGKOPPELING.statuses,
  };
}

// Standaard-prijslijst (alle bedragen EXCL. btw) — overgenomen van de website-tarieven.
// Verschijnt totdat het team zelf een prijslijst opslaat (dan is die leidend).
export const DEFAULT_PRICE_LIST = [
  { description: 'Schuifpui reparatie kunststof (vanaf)', priceExcl: 520 },
  { description: 'Schuifpui reparatie aluminium', priceExcl: 640 },
  { description: 'Schuifpui reparatie hout', priceExcl: 740 },
  { description: 'Deur openen (€90–€150)', priceExcl: 90 },
  { description: 'Cilinderslot houten deur (€70–€120)', priceExcl: 70 },
  { description: 'Cilinderslot kunststof/aluminium deur (vanaf)', priceExcl: 95 },
  { description: 'LIPS oplegslot', priceExcl: 290 },
  { description: 'Oplegslot (Cisa/Yale of vergelijkbaar)', priceExcl: 180 },
  { description: 'Meerpuntssluiting gemiddeld', priceExcl: 300 },
  { description: 'Infrezen meerpuntssluiting SKG3 (vanaf)', priceExcl: 640 },
  { description: 'Anti-kerntrekbeslag (per deur)', priceExcl: 139.50 },
  { description: 'Noodherstel na inbraak', priceExcl: 80 },
  { description: 'Installatiekosten (€78,50–€98,50)', priceExcl: 78.50 },
];
export function getPriceList() {
  const p = db().settings.priceList;
  return Array.isArray(p) && p.length ? p : DEFAULT_PRICE_LIST;
}

// WhatsApp-meldingen voor het team: seintje in een groep (of 1-op-1) bij elke
// nieuwe te-controleren aanvraag en bij klantreacties. Groep aanbevolen: maak een
// WhatsApp-groep (bv. "CRM meldingen") met het wegwerp-nummer + de assistente erin.
export const DEFAULT_CRM_ALERTS = { enabled: false, group: 'CRM meldingen', phone: '', notifyReplies: true };
export function getCrmAlerts() {
  const c = db().settings.crmAlerts || {};
  return {
    enabled: !!c.enabled,
    group: (c.group || DEFAULT_CRM_ALERTS.group).toString().slice(0, 100),
    phone: (c.phone || '').toString().replace(/[^\d+]/g, '').slice(0, 20),
    notifyReplies: c.notifyReplies !== false,
  };
}

// Afspraakbevestiging naar de klant (+ herinnering X uur vooraf).
// "Monteur onderweg"-bericht: met één knop op de kaart krijgt de klant een mail
// én een appje dat de monteur er nu aankomt. Teksten aanpasbaar in Instellingen.
export const DEFAULT_ONDERWEG_MSG = {
  emailSubject: 'Onze monteur is onderweg — Keyservice',
  emailBody: `Beste {naam},

Goed nieuws: {monteur} is nu naar u onderweg.

Zorgt u dat er iemand aanwezig is? Tot zo!`,
  whatsappBody: `Hallo {naam}, {monteur} is nu naar u onderweg. Tot zo! — Keyservice`,
};
export function getOnderweg() {
  const c = db().settings.onderwegMsg || {};
  return { ...DEFAULT_ONDERWEG_MSG, ...c };
}

export const DEFAULT_APPOINTMENT_MSG = {
  emailEnabled: false,
  whatsappEnabled: false,
  blockHours: 3,
  emailSubject: 'Afspraakbevestiging — Keyservice',
  emailBody: `Beste {naam},

Hierbij bevestigen wij uw afspraak op {datum} {tijdblok}.

Onze monteur komt in dit tijdsblok bij u langs. Mocht de afspraak onverhoopt niet uitkomen, laat het ons gerust weten.`,
  whatsappBody: `Hallo {naam}, hierbij bevestigen we uw afspraak op {datum} {tijdblok}. Onze monteur komt in dit tijdsblok langs. Komt het niet uit? Laat het ons even weten. — Keyservice`,
  reminderEnabled: false,
  reminderHours: 24,
  reminderEmailSubject: 'Herinnering: uw afspraak — Keyservice',
  reminderBody: `Hallo {naam}, een korte herinnering: {datum} {tijdblok} komt onze monteur bij u langs. Tot dan! — Keyservice`,
};
export function getAppointmentMsg() {
  const a = db().settings.appointmentMsg || {};
  return {
    emailEnabled: !!a.emailEnabled,
    whatsappEnabled: !!a.whatsappEnabled,
    emailSubject: a.emailSubject || DEFAULT_APPOINTMENT_MSG.emailSubject,
    emailBody: a.emailBody || DEFAULT_APPOINTMENT_MSG.emailBody,
    whatsappBody: a.whatsappBody || DEFAULT_APPOINTMENT_MSG.whatsappBody,
    blockHours: Math.max(1, Math.min(8, Number(a.blockHours) || DEFAULT_APPOINTMENT_MSG.blockHours)),
    reminderEnabled: !!a.reminderEnabled,
    reminderHours: Math.max(1, Math.min(72, Number(a.reminderHours) || DEFAULT_APPOINTMENT_MSG.reminderHours)),
    reminderEmailSubject: a.reminderEmailSubject || DEFAULT_APPOINTMENT_MSG.reminderEmailSubject,
    reminderBody: a.reminderBody || DEFAULT_APPOINTMENT_MSG.reminderBody,
  };
}

// Review-verzoek: X uur na "Afgerond" automatisch een mailtje met de review-link.
export const DEFAULT_REVIEW_REQUEST = {
  enabled: false,
  delayHours: 24,
  link: '',
  subject: 'Hoe hebben wij het gedaan? — Keyservice',
  body: `Beste {naam},

Bedankt dat u voor Keyservice heeft gekozen! We hopen dat alles naar wens is opgelost.

Zou u een korte review willen achterlaten? Daar helpt u ons enorm mee:
{link}

Alvast hartelijk dank!`,
};
export function getReviewRequest() {
  const r = db().settings.reviewRequest || {};
  return {
    enabled: !!r.enabled,
    delayHours: Math.max(1, Math.min(240, Number(r.delayHours) || DEFAULT_REVIEW_REQUEST.delayHours)),
    link: r.link || '',
    subject: r.subject || DEFAULT_REVIEW_REQUEST.subject,
    body: r.body || DEFAULT_REVIEW_REQUEST.body,
  };
}

// Dagelijkse off-site back-up: stuurt een kopie van de database als bijlage naar
// een e-mailadres, zodat er altijd een verse kopie buiten de server staat.
export const DEFAULT_BACKUP_MAIL = { enabled: false, email: '', hour: 6 };

export function getBackupMail() {
  const b = db().settings.backupMail || {};
  return {
    enabled: !!b.enabled,
    email: b.email || '',
    hour: Math.max(0, Math.min(23, Number(b.hour) >= 0 ? Number(b.hour) : DEFAULT_BACKUP_MAIL.hour)),
  };
}

// Automatische follow-up op offertes die X dagen blijven liggen (uit standaard).
export const DEFAULT_FOLLOWUP = {
  emailEnabled: false,
  whatsappEnabled: false,
  days: 3,
  emailSubject: 'Even checken — uw offerte van Keyservice',
  emailBody: `Beste klant,

Een tijdje geleden stuurden wij u een offerte. We horen graag of u nog vragen heeft of dat u verder wilt — dan plannen we het graag voor u in.

Laat het ons gerust weten!`,
  whatsappBody: `Hallo, een tijdje geleden stuurden we u een offerte voor uw aanvraag. Heeft u nog vragen of wilt u dat we het inplannen? Laat het ons gerust weten!`,
  // Follow-up op klanten die we gemaild hebben maar waar nog geen reactie op kwam.
  noReplyEnabled: false,
  noReplyDays: 3,
  noReplyEmailSubject: 'Heeft u onze e-mail ontvangen? — Keyservice',
  noReplyEmailBody: `Beste klant,

Een paar dagen geleden stuurden wij u een e-mail, maar we hebben nog geen reactie van u mogen ontvangen. We willen u graag verder helpen — laat gerust weten of u nog vragen heeft of hoe u verder wilt.`,
};

export function getFollowUp() {
  const f = db().settings.followUp || {};
  const legacy = f.enabled; // oude enkele aan/uit-schakelaar -> beide kanalen
  return {
    emailEnabled: f.emailEnabled !== undefined ? !!f.emailEnabled : !!legacy,
    whatsappEnabled: f.whatsappEnabled !== undefined ? !!f.whatsappEnabled : !!legacy,
    days: Math.max(1, Math.min(30, Number(f.days) || DEFAULT_FOLLOWUP.days)),
    emailSubject: f.emailSubject || DEFAULT_FOLLOWUP.emailSubject,
    emailBody: f.emailBody || DEFAULT_FOLLOWUP.emailBody,
    whatsappBody: f.whatsappBody || DEFAULT_FOLLOWUP.whatsappBody,
    noReplyEnabled: !!f.noReplyEnabled,
    noReplyDays: Math.max(1, Math.min(30, Number(f.noReplyDays) || DEFAULT_FOLLOWUP.noReplyDays)),
    noReplyEmailSubject: f.noReplyEmailSubject || DEFAULT_FOLLOWUP.noReplyEmailSubject,
    noReplyEmailBody: f.noReplyEmailBody || DEFAULT_FOLLOWUP.noReplyEmailBody,
  };
}

// Automatische ontvangstbevestiging (uit standaard). De gebruiker zet dit aan in Instellingen.
export const DEFAULT_AUTOREPLY = {
  enabled: false,
  subject: 'Bedankt voor uw aanvraag bij Keyservice',
  body: `Beste klant,

Bedankt voor uw aanvraag. Om u zo goed mogelijk te kunnen helpen, kunt u ons alvast het volgende toesturen:
- Foto's of een video van de situatie
- Uw woonplaats of volledige adresgegevens

Dan nemen we contact met u op zodra een collega beschikbaar is.`,
};

export function getAutoReply() {
  const a = db().settings.autoReply || {};
  return {
    enabled: !!a.enabled,
    subject: a.subject || DEFAULT_AUTOREPLY.subject,
    body: a.body || DEFAULT_AUTOREPLY.body,
  };
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

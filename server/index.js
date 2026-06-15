import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// VANGNET: een losse fout in een achtergrondtaak (bv. IMAP-verbinding die wegvalt)
// mag NOOIT de hele CRM platleggen. Loggen i.p.v. crashen.
process.on('unhandledRejection', (reason) => {
  console.error('Onafgehandelde promise-fout (genegeerd, app blijft draaien):', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('Onafgehandelde fout (genegeerd, app blijft draaien):', err?.message || err);
});
import { db, id, now, save, saveSoon, load, logActivity, changeVersion, startBackups, backupNow, listBackups, dbFilePath } from './db.js';
import {
  attachUser, requireAuth, requireRole, publicUser,
  verifyPassword, createSession, destroySession,
  setSessionCookie, clearSessionCookie, createUser, hashPassword,
} from './auth.js';
import { aiMode, suggestReply, scoreRelevance, analyzeTraffic, learnFilterRules, askAssistant, suggestStatusChanges } from './ai/categorizer.js';
import { ensureSeed } from './seed.js';
import {
  autoApproveThreshold, upsertCustomer, withRelations, applyReview, ingestMessage,
} from './pipeline.js';
import { startEmailPoller, appendSentMail } from './connectors/email-imap.js';
import { sendMail, smtpConfigured } from './connectors/email-smtp.js';
import { startWeeklyArchiver, runWeeklyArchive } from './archive.js';
import { saveBuffer, deleteFile, UPLOAD_DIR } from './storage.js';
import { runHealthCheck, lastHealth, startHealthMonitor } from './health.js';
import { usageSummary } from './usage.js';
import {
  ensureSettings, getStatuses, getStatusLabels, getStatusKeys, getSources,
  isValidStatus, normalizeStatus, firstStatusKey, sanitizeStatuses, sanitizeSources,
  getTemplates, sanitizeTemplates, appointmentStatusKey, getCompanyProfile,
  getEmailSignature, isWhatsappOrderGroup,
} from './settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

load();
ensureSeed();
ensureSettings();

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(attachUser);

// ---------- Auth-routes ----------
app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db().users.find((u) => u.email === (email || '').toLowerCase());
  if (!user || !verifyPassword(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Onjuist e-mailadres of wachtwoord' });
  }
  const token = createSession(user.id);
  setSessionCookie(res, token);
  logActivity(user.name, 'ingelogd');
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  const cookie = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith('sid='));
  if (cookie) destroySession(cookie.slice(4));
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({
    user: publicUser(req.user),
    meta: {
      aiMode: aiMode(),
      statuses: getStatuses(),
      statusLabels: getStatusLabels(),
      sources: getSources(),
      templates: getTemplates(),
      canSendEmail: smtpConfigured(),
      autoApproveThreshold: autoApproveThreshold(),
      emailSignature: getEmailSignature(),
    },
  });
});

// Eigen wachtwoord wijzigen
app.post('/api/me/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!verifyPassword(currentPassword || '', req.user.passwordHash)) {
    return res.status(400).json({ error: 'Huidig wachtwoord is onjuist' });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Nieuw wachtwoord moet minimaal 6 tekens zijn' });
  }
  req.user.passwordHash = hashPassword(newPassword);
  saveSoon();
  logActivity(req.user.name, 'wachtwoord gewijzigd');
  res.json({ ok: true });
});

// ---------- Users (alleen admin) ----------
app.get('/api/users', requireRole('admin'), (req, res) => {
  res.json(db().users.map(publicUser));
});

app.post('/api/users', requireRole('admin'), (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Naam, e-mail en wachtwoord verplicht' });
  if (db().users.some((u) => u.email === email.toLowerCase())) {
    return res.status(409).json({ error: 'E-mailadres bestaat al' });
  }
  if (!['admin', 'assistent', 'monteur'].includes(role)) {
    return res.status(400).json({ error: 'Ongeldige rol' });
  }
  const user = createUser({ name, email, password, role });
  logActivity(req.user.name, 'gebruiker aangemaakt', `${name} (${role})`);
  res.json(publicUser(user));
});

app.delete('/api/users/:id', requireRole('admin'), (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Je kunt jezelf niet verwijderen' });
  const users = db().users;
  const i = users.findIndex((u) => u.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Niet gevonden' });
  const [removed] = users.splice(i, 1);
  logActivity(req.user.name, 'gebruiker verwijderd', removed.name);
  saveSoon();
  res.json({ ok: true });
});

// ---------- Klanten ----------
app.get('/api/customers', requireAuth, (req, res) => {
  const orders = db().orders;
  const list = db().customers.map((c) => ({
    ...c,
    orderCount: orders.filter((o) => o.customerId === c.id).length,
  }));
  res.json(list);
});

app.post('/api/customers', requireRole('admin', 'assistent'), (req, res) => {
  const { name, phone, email, address, type, notes } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Naam verplicht' });
  const c = {
    id: id('cust'), name, phone: phone || '', email: email || '',
    address: address || '', type: type || 'lead', source: 'handmatig',
    notes: notes || '', createdAt: now(),
  };
  db().customers.push(c);
  logActivity(req.user.name, 'klant toegevoegd', name);
  saveSoon();
  res.json(c);
});

app.patch('/api/customers/:id', requireRole('admin', 'assistent'), (req, res) => {
  const c = db().customers.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Niet gevonden' });
  for (const k of ['name', 'phone', 'email', 'address', 'type', 'notes']) {
    if (k in (req.body || {})) c[k] = req.body[k];
  }
  saveSoon();
  res.json(c);
});

app.delete('/api/customers/:id', requireRole('admin', 'assistent'), (req, res) => {
  const customers = db().customers;
  const i = customers.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Niet gevonden' });
  if (db().orders.some((o) => o.customerId === req.params.id)) {
    return res.status(400).json({ error: 'Klant heeft nog opdrachten; verwijder die eerst' });
  }
  const [removed] = customers.splice(i, 1);
  logActivity(req.user.name, 'klant verwijderd', removed.name);
  saveSoon();
  res.json({ ok: true });
});

// Mogelijke dubbele klanten vinden (zelfde e-mail of telefoon).
app.get('/api/customers/duplicates', requireRole('admin', 'assistent'), (req, res) => {
  const norm = (v) => (v || '').toLowerCase().replace(/[\s().-]/g, '');
  const groups = {};
  for (const c of db().customers) {
    const keys = [];
    if (c.email) keys.push('e:' + c.email.toLowerCase());
    if (c.phone) keys.push('p:' + norm(c.phone));
    for (const k of keys) { (groups[k] ||= []).push(c); }
  }
  const dups = [];
  const seen = new Set();
  for (const list of Object.values(groups)) {
    if (list.length < 2) continue;
    const ids = list.map((c) => c.id).sort().join(',');
    if (seen.has(ids)) continue;
    seen.add(ids);
    const orders = db().orders;
    dups.push(list.map((c) => ({ ...c, orderCount: orders.filter((o) => o.customerId === c.id).length })));
  }
  res.json(dups);
});

// Twee (of meer) klanten samenvoegen tot één. Alle opdrachten gaan naar de
// 'primaire' klant; de rest wordt verwijderd.
app.post('/api/customers/merge', requireRole('admin', 'assistent'), (req, res) => {
  const { primaryId, mergeIds } = req.body || {};
  const primary = db().customers.find((c) => c.id === primaryId);
  if (!primary || !Array.isArray(mergeIds) || !mergeIds.length) {
    return res.status(400).json({ error: 'Kies een hoofdklant en minstens één samen te voegen klant' });
  }
  let moved = 0;
  for (const mid of mergeIds) {
    if (mid === primaryId) continue;
    const other = db().customers.find((c) => c.id === mid);
    if (!other) continue;
    // opdrachten overzetten
    db().orders.forEach((o) => { if (o.customerId === mid) { o.customerId = primaryId; moved++; } });
    db().trash.forEach((o) => { if (o.customerId === mid) o.customerId = primaryId; });
    // ontbrekende gegevens aanvullen
    if (!primary.email && other.email) primary.email = other.email;
    if (!primary.phone && other.phone) primary.phone = other.phone;
    if (!primary.address && other.address) primary.address = other.address;
    if (other.notes) primary.notes = `${primary.notes ? primary.notes + '\n' : ''}${other.notes}`;
    if (other.type !== 'lead') primary.type = other.type;
    db().customers = db().customers.filter((c) => c.id !== mid);
  }
  logActivity(req.user.name, 'klanten samengevoegd', `${primary.name} (+${mergeIds.length - 1 < 0 ? 0 : mergeIds.length})`);
  saveSoon();
  res.json({ ok: true, movedOrders: moved });
});

// ---------- Monteurs ----------
app.get('/api/monteurs', requireAuth, (req, res) => {
  const orders = db().orders;
  const labels = getStatusLabels();
  const now2 = Date.now();
  res.json(db().monteurs.map((m) => {
    const mine = orders.filter((o) => o.monteurId === m.id && !o.archivedWeek);
    const active = mine.filter((o) => !['afgerond', 'geannuleerd'].includes(o.status));
    const upcoming = mine
      .filter((o) => o.appointmentAt && new Date(o.appointmentAt).getTime() >= now2 - 12 * 3600 * 1000 && !['afgerond', 'geannuleerd'].includes(o.status))
      .sort((a, b) => new Date(a.appointmentAt) - new Date(b.appointmentAt))
      .map((o) => ({ id: o.id, title: o.title, at: o.appointmentAt, status: o.status, statusLabel: labels[o.status] || o.status }));
    const sentCount = orders.filter((o) => o.sentToMonteur && o.sentToMonteur.monteurId === m.id).length;
    const doneCount = mine.filter((o) => o.status === 'afgerond').length;
    return {
      ...m,
      activeCount: active.length,
      sentCount,
      doneCount,
      upcoming,
      orders: active.map((o) => ({ id: o.id, title: o.title, status: o.status, statusLabel: labels[o.status] || o.status, appointmentAt: o.appointmentAt || null })),
    };
  }));
});

app.post('/api/monteurs', requireRole('admin', 'assistent'), (req, res) => {
  const { name, phone, email, waGroup } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Naam verplicht' });
  const m = { id: id('mont'), name, phone: phone || '', email: email || '', waGroup: waGroup || '', createdAt: now() };
  db().monteurs.push(m);
  logActivity(req.user.name, 'monteur toegevoegd', name);
  saveSoon();
  res.json(m);
});

app.patch('/api/monteurs/:id', requireRole('admin', 'assistent'), (req, res) => {
  const m = db().monteurs.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'Niet gevonden' });
  for (const k of ['name', 'phone', 'email', 'waGroup']) if (k in (req.body || {})) m[k] = req.body[k];
  saveSoon();
  res.json(m);
});

app.delete('/api/monteurs/:id', requireRole('admin', 'assistent'), (req, res) => {
  const monteurs = db().monteurs;
  const i = monteurs.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Niet gevonden' });
  db().orders.forEach((o) => { if (o.monteurId === req.params.id) o.monteurId = null; });
  const [removed] = monteurs.splice(i, 1);
  logActivity(req.user.name, 'monteur verwijderd', removed.name);
  saveSoon();
  res.json({ ok: true });
});

// ---------- Opdrachten ----------
app.get('/api/orders', requireAuth, (req, res) => {
  let list = db().orders.map(withRelations);
  // Standaard tonen we alleen actieve (niet-ingeklapte) opdrachten op het bord.
  if (req.query.archivedWeek) list = list.filter((o) => o.archivedWeek?.key === req.query.archivedWeek);
  else if (req.query.includeArchived !== '1') list = list.filter((o) => !o.archivedWeek);
  if (req.query.status) list = list.filter((o) => o.status === req.query.status);
  if (req.query.monteurId) list = list.filter((o) => o.monteurId === req.query.monteurId);
  list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  res.json(list);
});

// Lijst van week-bundels (ingeklapte agenda's), met aantallen.
app.get('/api/archives', requireAuth, (req, res) => {
  const map = new Map();
  for (const o of db().orders) {
    if (!o.archivedWeek) continue;
    const k = o.archivedWeek.key;
    if (!map.has(k)) map.set(k, { key: k, label: o.archivedWeek.label, count: 0 });
    map.get(k).count++;
  }
  res.json([...map.values()].sort((a, b) => b.key.localeCompare(a.key)));
});

// Handmatig de wekelijkse archivering nu uitvoeren (admin).
app.post('/api/archives/run', requireRole('admin'), (req, res) => {
  const result = runWeeklyArchive();
  res.json(result);
});

// ---------- Back-ups (admin) ----------
// Lijst van bestaande back-ups.
app.get('/api/backups', requireRole('admin'), (req, res) => {
  res.json({ backups: listBackups() });
});
// Nu meteen een back-up maken.
app.post('/api/backups/now', requireRole('admin'), (req, res) => {
  save(); // eerst de actuele staat wegschrijven
  const r = backupNow('handmatig');
  logActivity(req.user.name, 'back-up gemaakt');
  res.json({ ok: !!r });
});
// De volledige database downloaden (voor een veilige kopie buiten de server).
app.get('/api/backup/download', requireRole('admin'), (req, res) => {
  save();
  const stamp = new Date().toISOString().slice(0, 10);
  res.download(dbFilePath(), `keyservice-backup-${stamp}.json`);
});

// Bepaalt via welk kanaal een opdracht binnenkwam (voor handmatig inklappen per bron).
function orderChannelOf(o) {
  const l = (o.source || '').toLowerCase();
  if (l.includes('mail')) return 'email';
  if (l.includes('whatsapp') || l.includes('app') || l.includes('groep')) return 'whatsapp';
  return 'other';
}

// Handmatig inklappen: stopt alle nu zichtbare (actieve) opdrachten van het gekozen
// kanaal in één gedateerde bundel, zodat het bord weer leeg is. Terug te halen door
// op de bundel te klikken.
app.post('/api/archives/collapse', requireRole('admin', 'assistent'), (req, res) => {
  const channel = (req.body && req.body.channel) || 'all';
  const ts = new Date();
  const key = 'manual_' + ts.getTime();
  const dateLabel = ts.toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  const chanName = channel === 'email' ? 'E-mail' : channel === 'whatsapp' ? 'WhatsApp' : 'Alle opdrachten';
  const label = `Ingeklapt ${dateLabel} — ${chanName}`;
  let count = 0;
  for (const o of db().orders) {
    if (o.archivedWeek) continue;
    if (channel !== 'all' && orderChannelOf(o) !== channel) continue;
    o.archivedWeek = { key, label, manual: true };
    o.updatedAt = now();
    count++;
  }
  if (count > 0) { logActivity(req.user.name, 'handmatig ingeklapt', `${label} — ${count} opdrachten`); saveSoon(); }
  res.json({ ok: true, count, key, label });
});

// Een inklap-bundel ongedaan maken: haal de opdrachten weer terug op het bord.
app.post('/api/archives/uncollapse', requireRole('admin', 'assistent'), (req, res) => {
  const key = req.body && req.body.key;
  if (!key) return res.status(400).json({ error: 'key vereist' });
  let n = 0;
  for (const o of db().orders) {
    if (o.archivedWeek && o.archivedWeek.key === key) { delete o.archivedWeek; o.updatedAt = now(); n++; }
  }
  if (n) { logActivity(req.user.name, 'inklappen ongedaan gemaakt', `${n} opdrachten terug`); saveSoon(); }
  res.json({ ok: true, restored: n });
});

// Eén bericht uit de gesprekshistorie van een opdracht verwijderen (opschonen van
// verkeerd samengevoegde/spam-berichten).
app.delete('/api/orders/:id/thread/:threadId', requireRole('admin', 'assistent'), (req, res) => {
  const order = db().orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Niet gevonden' });
  order.thread = (order.thread || []).filter((t) => t.id !== req.params.threadId);
  order.updatedAt = now();
  saveSoon();
  res.json(withRelations(order));
});

app.post('/api/orders', requireRole('admin', 'assistent'), (req, res) => {
  const b = req.body || {};
  let customerId = b.customerId;
  if (!customerId && (b.customerName || b.customerPhone || b.customerEmail)) {
    const { customer } = upsertCustomer({
      name: b.customerName, phone: b.customerPhone, email: b.customerEmail, source: 'handmatig',
    });
    customerId = customer.id;
  }
  if (!customerId) return res.status(400).json({ error: 'Klant verplicht' });
  if (b.status && !isValidStatus(b.status)) return res.status(400).json({ error: 'Ongeldige status' });
  const order = {
    id: id('ord'),
    title: b.title || 'Nieuwe opdracht',
    description: b.description || '',
    status: normalizeStatus(b.status || 'open'),
    source: b.source || 'Handmatig',
    customerId,
    monteurId: b.monteurId || null,
    appointmentAt: b.appointmentAt || null,
    price: b.price || '',
    urgent: !!b.urgent,
    notes: b.notes || '',
    messageId: null,
    createdAt: now(),
    updatedAt: now(),
  };
  db().orders.push(order);
  logActivity(req.user.name, 'opdracht aangemaakt', order.title);
  saveSoon();
  res.json(withRelations(order));
});

app.patch('/api/orders/:id', requireAuth, (req, res) => {
  const order = db().orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Niet gevonden' });
  const b = req.body || {};

  // Monteurs mogen alleen status, afspraak en notities aanpassen.
  const allowed = req.user.role === 'monteur'
    ? ['status', 'appointmentAt', 'notes']
    : ['title', 'description', 'status', 'source', 'customerId', 'monteurId', 'appointmentAt', 'price', 'urgent', 'notes'];

  if (b.status && !isValidStatus(b.status)) return res.status(400).json({ error: 'Ongeldige status' });

  let changedStatus = false;
  for (const k of allowed) {
    if (k in b) {
      if (k === 'status' && b[k] !== order.status) changedStatus = true;
      order[k] = b[k];
    }
  }

  // Automatisch naar "Afspraak ingepland" zodra er een afspraakdatum is gezet,
  // mits de gebruiker niet zelf al een andere status koos en de opdracht nog
  // open/nieuw of zonder afspraakkolom staat.
  if ('appointmentAt' in b && b.appointmentAt && !b.status) {
    const apptKey = appointmentStatusKey();
    if (apptKey && order.status === firstStatusKey() && order.status !== apptKey) {
      order.status = apptKey;
      changedStatus = true;
    }
  }

  order.updatedAt = now();
  if (changedStatus) logActivity(req.user.name, 'status gewijzigd', `${order.title} → ${getStatusLabels()[order.status] || order.status}`);
  // Auto-versturen naar monteur bij het inplannen van een afspraak (indien ingesteld).
  if ('appointmentAt' in b && b.appointmentAt) maybeAutoSendToMonteur(order, 'appointment');
  saveSoon();
  res.json(withRelations(order));
});

// Meerdere opdrachten samenvoegen tot één (zelfde klant, dubbele kaarten).
// De 'primaire' opdracht behoudt alles; de rest gaat erin op (historie + foto's).
app.post('/api/orders/merge', requireRole('admin', 'assistent'), (req, res) => {
  const { primaryId, mergeIds } = req.body || {};
  const primary = db().orders.find((o) => o.id === primaryId);
  if (!primary || !Array.isArray(mergeIds) || !mergeIds.length) {
    return res.status(400).json({ error: 'Kies een hoofdkaart en minstens één kaart om samen te voegen' });
  }
  primary.thread = primary.thread || [];
  primary.attachments = primary.attachments || [];
  let merged = 0;
  for (const mid of mergeIds) {
    if (mid === primaryId) continue;
    const i = db().orders.findIndex((o) => o.id === mid);
    if (i < 0) continue;
    const other = db().orders[i];
    // historie en bijlagen overnemen
    primary.thread.push(...(other.thread || []));
    primary.attachments.push(...(other.attachments || []));
    // ontbrekende velden aanvullen
    if (!primary.description && other.description) primary.description = other.description;
    if (!primary.appointmentAt && other.appointmentAt) primary.appointmentAt = other.appointmentAt;
    if (!primary.price && other.price) primary.price = other.price;
    if (other.notes) primary.notes = `${primary.notes ? primary.notes + '\n' : ''}${other.notes}`;
    db().orders.splice(i, 1);
    merged++;
  }
  // historie netjes op tijd sorteren
  primary.thread.sort((a, b) => (a.at || '').localeCompare(b.at || ''));
  primary.updatedAt = now();
  logActivity(req.user.name, 'kaarten samengevoegd', `${primary.title} (+${merged})`);
  saveSoon();
  res.json(withRelations(primary));
});

// Verwijderen = naar de prullenbak verplaatsen (terug te halen).
app.delete('/api/orders/:id', requireRole('admin', 'assistent'), (req, res) => {
  const orders = db().orders;
  const i = orders.findIndex((o) => o.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Niet gevonden' });
  const [removed] = orders.splice(i, 1);
  removed.deletedAt = now();
  removed.deletedBy = req.user.name;
  db().trash.unshift(removed);
  if (db().trash.length > 500) {
    // oudste boven de 500 definitief opruimen (incl. bestanden)
    const old = db().trash.splice(500);
    old.forEach((o) => (o.attachments || []).forEach((a) => deleteFile(a.file)));
  }
  logActivity(req.user.name, 'opdracht naar prullenbak', removed.title);
  saveSoon();
  res.json({ ok: true });
});

// Prullenbak bekijken
app.get('/api/trash', requireRole('admin', 'assistent'), (req, res) => {
  res.json(db().trash.map(withRelations));
});

// Opdracht terughalen uit de prullenbak
app.post('/api/trash/:id/restore', requireRole('admin', 'assistent'), (req, res) => {
  const i = db().trash.findIndex((o) => o.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Niet gevonden' });
  const [order] = db().trash.splice(i, 1);
  delete order.deletedAt; delete order.deletedBy;
  order.updatedAt = now();
  db().orders.push(order);
  logActivity(req.user.name, 'opdracht teruggehaald', order.title);
  saveSoon();
  res.json(withRelations(order));
});

// Definitief verwijderen uit de prullenbak (incl. bestanden)
app.delete('/api/trash/:id', requireRole('admin'), (req, res) => {
  const i = db().trash.findIndex((o) => o.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Niet gevonden' });
  const [order] = db().trash.splice(i, 1);
  (order.attachments || []).forEach((a) => deleteFile(a.file));
  logActivity(req.user.name, 'opdracht definitief verwijderd', order.title);
  saveSoon();
  res.json({ ok: true });
});

// Prullenbak helemaal legen (alleen admin)
app.post('/api/trash/empty', requireRole('admin'), (req, res) => {
  const count = db().trash.length;
  db().trash.forEach((o) => (o.attachments || []).forEach((a) => deleteFile(a.file)));
  db().trash = [];
  logActivity(req.user.name, 'prullenbak geleegd', `${count} opdrachten`);
  saveSoon();
  res.json({ ok: true, removed: count });
});

// Markeer een opdracht als 'geopend/gezien' (voor de statusstip op de kaart).
app.post('/api/orders/:id/seen', requireAuth, (req, res) => {
  const order = db().orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Niet gevonden' });
  let changed = false;
  if (!order.openedAt) { order.openedAt = now(); changed = true; }
  // 'Klant heeft gereageerd'-melding wegklikken zodra je de kaart opent.
  if (order.customerReplied) { order.customerReplied = false; changed = true; }
  if (order.unreadReplies) { order.unreadReplies = 0; changed = true; }
  if (changed) saveSoon();
  res.json({ ok: true });
});

// Bijlage handmatig toevoegen aan een opdracht (foto/video/document).
// Verwacht JSON: { filename, mime, dataBase64 }.
app.post('/api/orders/:id/attachments', requireAuth, (req, res) => {
  const order = db().orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Niet gevonden' });
  const { filename, mime, dataBase64 } = req.body || {};
  if (!dataBase64) return res.status(400).json({ error: 'Geen bestand ontvangen' });
  let buffer;
  try { buffer = Buffer.from(String(dataBase64).split(',').pop(), 'base64'); }
  catch { return res.status(400).json({ error: 'Ongeldig bestand' }); }
  const saved = saveBuffer(buffer, { mime, filename });
  if (!saved) return res.status(400).json({ error: 'Bestand te groot of leeg (max 25 MB)' });
  saved.uploadedBy = req.user.name;
  order.attachments = (order.attachments || []).concat(saved);
  order.updatedAt = now();
  logActivity(req.user.name, 'bijlage toegevoegd', `${order.title}: ${saved.filename}`);
  saveSoon();
  res.json(withRelations(order));
});

// Bijlage verwijderen van een opdracht.
app.delete('/api/orders/:id/attachments/:attId', requireRole('admin', 'assistent'), (req, res) => {
  const order = db().orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Niet gevonden' });
  const att = (order.attachments || []).find((a) => a.id === req.params.attId);
  if (att) { deleteFile(att.file); order.attachments = order.attachments.filter((a) => a.id !== req.params.attId); order.updatedAt = now(); saveSoon(); }
  res.json(withRelations(order));
});

// ---------- Inbox / AI-controlewachtrij ----------
app.get('/api/reviews', requireAuth, (req, res) => {
  const status = req.query.status || 'pending';
  const messages = db().messages;
  const list = db().reviews
    .filter((r) => (status === 'all' ? true : r.status === status))
    .map((r) => ({ ...r, message: messages.find((m) => m.id === r.messageId) || null }))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json(list);
});

app.post('/api/reviews/:id/approve', requireRole('admin', 'assistent'), (req, res) => {
  const review = db().reviews.find((r) => r.id === req.params.id);
  if (!review) return res.status(404).json({ error: 'Niet gevonden' });
  if (!['pending', 'overige'].includes(review.status)) return res.status(400).json({ error: 'Al verwerkt' });
  const order = applyReview(review, { actorName: req.user.name, overrides: req.body || {} });
  maybeAutoSendToMonteur(order, 'approved');
  res.json({ review, order: withRelations(order) });
});

// Is dit een opdracht uit de DRS/Raf Breda-groep (de opdracht-WhatsApp-groep)?
function isDrsOrder(order) {
  if (order.originGroup) return isWhatsappOrderGroup(order.originGroup);
  return /whatsapp|groep|app/.test((order.source || '').toLowerCase());
}

// Automatisch versturen naar de monteur als dat is ingesteld én toegestaan op de dag
// van vandaag, en de juiste trigger optreedt. Niet dubbel versturen.
function maybeAutoSendToMonteur(order, event) {
  const cfg = db().settings.monteurDispatch || {};
  if (!cfg.autoEnabled) return;
  if (cfg.trigger !== event) return;
  if (cfg.onlyDrs !== false && !isDrsOrder(order)) return; // standaard alleen DRS-opdrachten
  if (order.sentToMonteur) return; // al verstuurd
  if (!autoSendAllowedToday()) return;
  const monteur = db().monteurs.find((m) => m.id === (cfg.autoMonteurId || order.monteurId));
  if (!monteur || !monteur.waGroup) return;
  if (!order.monteurId) order.monteurId = monteur.id;
  const r = queueToMonteur(order, monteur, 'automatisch');
  if (!r.error) { logActivity('systeem', 'automatisch naar monteur', `${order.title} -> ${monteur.name}`); saveSoon(); }
}

// Volautomatisch (trigger 'intake'): zodra een DRS-opdracht binnenkomt, meteen zelf
// goedkeuren (kaart aanmaken) én naar de monteur sturen — zonder handmatige stap.
function maybeIntakeAutoSend(result) {
  const cfg = db().settings.monteurDispatch || {};
  if (!cfg.autoEnabled || cfg.trigger !== 'intake') return;
  if (!autoSendAllowedToday()) { console.log('[intake] vandaag niet ingeschakeld (dag/aan-uit)'); return; }
  const monteur = db().monteurs.find((m) => m.id === cfg.autoMonteurId);
  if (!monteur) { console.log('[intake] geen monteur gekozen'); return; }
  if (!monteur.waGroup) { console.log('[intake] monteur heeft geen WhatsApp-groep'); return; }

  let order = null;
  const review = result && result.review;
  if (review && review.status === 'pending' && review.suggestion?.relevant) {
    const msg = db().messages.find((m) => m.id === review.messageId);
    if (cfg.onlyDrs !== false && !(msg && isWhatsappOrderGroup(msg.group))) { console.log('[intake] niet uit DRS-groep, overgeslagen'); return; }
    order = applyReview(review, { actorName: 'AI (volautomatisch)', auto: true });
  } else if (review && review.orderId) {
    order = db().orders.find((o) => o.id === review.orderId); // al goedgekeurd door drempel
  } else if (result && result.mergedIntoOrder) {
    order = db().orders.find((o) => o.id === result.mergedIntoOrder); // aan bestaande kaart gehangen
  } else {
    console.log('[intake] geen bruikbare opdracht uit dit bericht (geklets/overige/dubbel)');
    return;
  }
  if (!order) { console.log('[intake] opdracht niet gevonden'); return; }
  if (cfg.onlyDrs !== false && !isDrsOrder(order)) { console.log('[intake] opdracht is geen DRS-opdracht'); return; }
  if (order.sentToMonteur) { console.log('[intake] al naar monteur verstuurd'); return; }
  if (!order.monteurId) order.monteurId = monteur.id;
  const r = queueToMonteur(order, monteur, 'volautomatisch');
  if (!r.error) { console.log(`[intake] volautomatisch in wachtrij -> ${monteur.name} (${monteur.waGroup})`); logActivity('systeem', 'volautomatisch naar monteur', `${order.title} -> ${monteur.name}`); }
  else console.log('[intake] queueToMonteur fout:', r.error);
  saveSoon();
}

// Eén review afwijzen + als leersignaal opslaan (herbruikbaar voor bulk).
function rejectReview(review, user, b = {}) {
  review.status = 'rejected';
  review.reviewedBy = user.name;
  review.reviewedAt = now();
  review.rejectReason = b.reason || '';
  review.rejectNote = b.note || '';
  review.rejectShouldBe = b.shouldBe || '';
  const msg = db().messages.find((m) => m.id === review.messageId);
  db().feedback.unshift({
    id: id('fb'), type: 'reject', at: now(), by: user.name, channel: review.channel,
    reason: b.reason || 'Afgewezen (geen reden opgegeven)', note: b.note || '', shouldBe: b.shouldBe || '',
    aiStatus: review.suggestion?.aiStatus || review.suggestion?.status,
    sample: (msg?.body || '').slice(0, 400),
  });
}

app.post('/api/reviews/:id/reject', requireRole('admin', 'assistent'), (req, res) => {
  const review = db().reviews.find((r) => r.id === req.params.id);
  if (!review) return res.status(404).json({ error: 'Niet gevonden' });
  if (!['pending', 'overige'].includes(review.status)) return res.status(400).json({ error: 'Al verwerkt' });
  rejectReview(review, req.user, req.body || {});
  logActivity(req.user.name, 'review afgewezen', `${review.suggestion?.title || ''}${req.body?.reason ? ' — ' + req.body.reason : ''}`);
  saveSoon();
  res.json({ review });
});

// BULK afwijzen: meerdere ids tegelijk, of alle 'overige' (geklets), of alle pending.
app.post('/api/reviews/bulk-reject', requireRole('admin', 'assistent'), (req, res) => {
  const b = req.body || {};
  let targets = [];
  if (Array.isArray(b.ids) && b.ids.length) {
    targets = db().reviews.filter((r) => b.ids.includes(r.id) && ['pending', 'overige'].includes(r.status));
  } else if (b.scope === 'overige') {
    targets = db().reviews.filter((r) => r.status === 'overige');
  } else if (b.scope === 'pending') {
    targets = db().reviews.filter((r) => r.status === 'pending');
  } else {
    return res.status(400).json({ error: 'Geef ids of scope (overige/pending) op' });
  }
  targets.forEach((r) => rejectReview(r, req.user, { reason: b.reason || '' }));
  logActivity(req.user.name, 'bulk afgewezen', `${targets.length} berichten${b.reason ? ' — ' + b.reason : ''}`);
  saveSoon();
  res.json({ ok: true, count: targets.length });
});

// BULK accepteren: keur alle pending reviews goed met AI-zekerheid >= drempel.
app.post('/api/reviews/bulk-approve', requireRole('admin', 'assistent'), (req, res) => {
  const minPct = Math.max(0, Math.min(100, Number(req.body?.minConfidence) || 80));
  const min = minPct / 100;
  const targets = db().reviews.filter((r) => r.status === 'pending' && !r.suggestion?.aiNotOrder && (r.suggestion?.confidence || 0) >= min);
  let count = 0;
  for (const r of targets) {
    try { applyReview(r, { actorName: `${req.user.name} (bulk >=${minPct}%)` }); count++; } catch { /* skip */ }
  }
  logActivity(req.user.name, 'bulk goedgekeurd', `${count} berichten met AI-zekerheid >= ${minPct}%`);
  saveSoon();
  res.json({ ok: true, count, minPct });
});

// OPSCHONEN: laat alle pending berichten opnieuw door het ruisfilter lopen.
// Geklets verschuift naar 'overige', zodat de hoofdinbox alleen echte aanvragen houdt.
app.post('/api/reviews/recategorize', requireRole('admin', 'assistent'), (req, res) => {
  const messages = db().messages;
  let moved = 0;
  for (const r of db().reviews) {
    if (r.status !== 'pending') continue;
    const m = messages.find((x) => x.id === r.messageId);
    if (!m) continue;
    const rel = scoreRelevance({ subject: m.subject, body: m.body, hasAttachments: (m.attachments || []).length > 0 }, true);
    if (!rel.relevant) {
      r.status = 'overige';
      if (r.suggestion) { r.suggestion.relevant = false; r.suggestion.relevanceReason = rel.reason; }
      moved++;
    }
  }
  logActivity(req.user.name, 'inbox opgeschoond', `${moved} naar Overige`);
  saveSoon();
  res.json({ ok: true, moved });
});



// Feedback-overzicht (waarom werden berichten afgewezen) — voor assistente/eigenaar.
// Afgewezen inbox-bericht terugzetten naar 'te controleren'.
app.post('/api/reviews/:id/restore', requireRole('admin', 'assistent'), (req, res) => {
  const r = db().reviews.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Niet gevonden' });
  if (r.status !== 'rejected') return res.status(400).json({ error: 'Alleen afgewezen berichten terugzetten' });
  r.status = 'pending'; r.reviewedAt = null; r.reviewedBy = null;
  saveSoon();
  res.json({ ok: true });
});

// Afgewezen bericht DEFINITIEF verwijderen (alleen admin).
app.delete('/api/reviews/:id', requireRole('admin'), (req, res) => {
  const i = db().reviews.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Niet gevonden' });
  db().reviews.splice(i, 1);
  saveSoon();
  res.json({ ok: true });
});

// Hele inbox-prullenbak legen (alleen admin).
app.post('/api/reviews/empty-rejected', requireRole('admin'), (req, res) => {
  const before = db().reviews.length;
  db().reviews = db().reviews.filter((r) => r.status !== 'rejected');
  saveSoon();
  res.json({ ok: true, removed: before - db().reviews.length });
});

app.get('/api/feedback', requireAuth, (req, res) => {
  res.json((db().feedback || []).slice(0, 100));
});

// Eén leervoorbeeld verwijderen (bv. een afwijzing die eigenlijk een opdracht was).
app.delete('/api/feedback/:id', requireRole('admin', 'assistent'), (req, res) => {
  const i = (db().feedback || []).findIndex((f) => f.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Niet gevonden' });
  db().feedback.splice(i, 1);
  saveSoon();
  res.json({ ok: true });
});

// Alle leervoorbeelden van VANDAAG wissen (handig na een verkeerde bulk-actie).
app.post('/api/feedback/clear-today', requireRole('admin'), (req, res) => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const before = (db().feedback || []).length;
  db().feedback = (db().feedback || []).filter((f) => new Date(f.at).getTime() < start.getTime());
  saveSoon();
  res.json({ ok: true, removed: before - db().feedback.length });
});

// Alle AI-leervoorbeelden wissen (volledig schoon beginnen). Alleen admin.
app.post('/api/feedback/clear-all', requireRole('admin'), (req, res) => {
  const removed = (db().feedback || []).length;
  db().feedback = [];
  saveSoon();
  res.json({ ok: true, removed });
});

// ---------- Inkomende koppelingen (webhooks) ----------
function checkIngestToken(req, res, next) {
  const expected = process.env.INGEST_TOKEN;
  if (!expected) return res.status(503).json({ error: 'INGEST_TOKEN niet ingesteld op de server' });
  const got = req.get('x-ingest-token') || req.query.token;
  if (got !== expected) return res.status(401).json({ error: 'Ongeldig ingest-token' });
  next();
}

// WhatsApp-bridge laat elke ~60s van zich horen. Hieraan ziet het dashboard of
// de bridge nog draait.
app.post('/api/whatsapp/heartbeat', checkIngestToken, (req, res) => {
  db().settings.whatsappLastSeen = now();
  saveSoon();
  res.json({ ok: true });
});

// Overzicht/Home: kerncijfers (KPI's) + lijstjes die aandacht vragen + activiteit.
app.get('/api/overview', requireAuth, (req, res) => {
  const active = db().orders.filter((o) => !o.archivedWeek);
  const labels = getStatusLabels();
  const custName = (o) => (db().customers.find((c) => c.id === o.customerId) || {}).name || '';
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const endToday = startToday.getTime() + 86400000;
  const weekAgo = Date.now() - 7 * 86400000;
  const threeDays = Date.now() - 3 * 86400000;

  const isToday = (d) => { const t = new Date(d).getTime(); return t >= startToday.getTime() && t < endToday; };
  const apptToday = active.filter((o) => o.appointmentAt && isToday(o.appointmentAt) && !['afgerond', 'geannuleerd'].includes(o.status))
    .sort((a, b) => new Date(a.appointmentAt) - new Date(b.appointmentAt))
    .map((o) => ({ id: o.id, title: o.title, at: o.appointmentAt, customer: custName(o) }));
  const repliedList = active.filter((o) => o.customerReplied).map((o) => ({ id: o.id, title: o.title, customer: custName(o) }));
  const staleQuotes = active.filter((o) => o.status === 'offerte_verzonden' && !o.customerReplied && new Date(o.updatedAt).getTime() < threeDays)
    .map((o) => ({ id: o.id, title: o.title, customer: custName(o) }));

  const last = db().settings.whatsappLastSeen || null;
  const ageSec = last ? (Date.now() - new Date(last).getTime()) / 1000 : null;

  res.json({
    kpis: {
      nieuwVandaag: active.filter((o) => isToday(o.createdAt)).length,
      teControleren: db().reviews.filter((r) => r.status === 'pending').length,
      openOffertes: active.filter((o) => o.status === 'offerte_verzonden').length,
      afsprakenVandaag: apptToday.length,
      klantReacties: repliedList.length,
      afgerondDezeWeek: db().orders.filter((o) => o.status === 'afgerond' && new Date(o.updatedAt).getTime() >= weekAgo).length,
      actief: active.length,
    },
    whatsapp: { online: ageSec != null && ageSec < 180, configured: !!last, lastSeen: last },
    apptToday, repliedList, staleQuotes,
    byStatus: getStatusKeys().map((k) => ({ key: k, label: labels[k], count: active.filter((o) => o.status === k).length })),
    activity: (db().activity || []).slice(0, 8).map((a) => ({ actor: a.actorName, action: a.action, detail: a.detail, at: a.at })),
  });
});

// Status van de WhatsApp-bridge: draait hij nog? (geen seintje in 3 min = stil)
app.get('/api/whatsapp/status', requireAuth, (req, res) => {
  const last = db().settings.whatsappLastSeen || null;
  const ageSec = last ? (Date.now() - new Date(last).getTime()) / 1000 : null;
  const online = ageSec != null && ageSec < 180; // 3 minuten marge
  res.json({ configured: !!last, online, lastSeen: last, ageSeconds: ageSec });
});

app.post('/api/ingest/email', checkIngestToken, async (req, res) => {
  const { from, sender, subject, body, text, html, externalId } = req.body || {};
  const result = await ingestMessage({
    channel: 'email',
    sender: from || sender,
    subject,
    body: body || text || html || '',
    externalId,
  });
  res.json({ ok: true, reviewId: result.review?.id, status: result.review?.status, duplicate: !!result.duplicate });
});

app.post('/api/ingest/whatsapp', checkIngestToken, async (req, res) => {
  const { from, sender, name, body, text, message, group, externalId } = req.body || {};
  const result = await ingestMessage({
    channel: 'whatsapp',
    sender: name || from || sender,
    subject: group ? `WhatsApp-groep: ${group}` : '',
    body: body || text || message || '',
    group,
    externalId,
  });
  // Volautomatisch: DRS-opdracht direct goedkeuren + naar monteur (indien ingesteld).
  try { maybeIntakeAutoSend(result); } catch (e) { console.error('intake-autosend:', e.message); }
  res.json({ ok: true, reviewId: result.review?.id, status: result.review?.status, duplicate: !!result.duplicate });
});

// --- Officiële WhatsApp Cloud API (Meta) ---
// Verificatie van de webhook (Meta doet eerst een GET-aanroep).
app.get('/api/ingest/whatsapp/cloud', (req, res) => {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && verifyToken && token === verifyToken) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Haalt een media-bestand op bij Meta (twee stappen: media-id -> URL -> bytes)
// en slaat het op als bijlage. Vereist WHATSAPP_TOKEN (permanent access token).
async function downloadWhatsappMedia(mediaId, mime, filename) {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token || !mediaId) return null;
  try {
    const metaResp = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaResp.ok) throw new Error('media-meta ' + metaResp.status);
    const meta = await metaResp.json();
    const fileResp = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!fileResp.ok) throw new Error('media-download ' + fileResp.status);
    const buf = Buffer.from(await fileResp.arrayBuffer());
    return saveBuffer(buf, { mime: mime || meta.mime_type, filename });
  } catch (err) {
    console.error('WhatsApp media ophalen mislukt:', err.message);
    return null;
  }
}

// Inkomende berichten van de WhatsApp Cloud API. Meta's formaat wordt hier
// vertaald naar ons standaardformaat (incl. foto's/video's als bijlage).
app.post('/api/ingest/whatsapp/cloud', async (req, res) => {
  try {
    const entries = req.body?.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const contacts = value.contacts || [];
        for (const msg of value.messages || []) {
          const contact = contacts.find((c) => c.wa_id === msg.from) || contacts[0];
          const name = contact?.profile?.name || msg.from;
          const phone = msg.from ? `+${String(msg.from).replace(/[^\d]/g, '')}` : '';

          let text = '';
          const attachments = [];
          const media = msg.image || msg.video || msg.document || msg.audio || msg.voice;
          if (msg.type === 'text') text = msg.text?.body || '';
          else if (msg.type === 'image') text = `[foto] ${msg.image?.caption || ''}`.trim();
          else if (msg.type === 'video') text = `[video] ${msg.video?.caption || ''}`.trim();
          else if (msg.type === 'document') text = `[document] ${msg.document?.caption || msg.document?.filename || ''}`.trim();
          else if (msg.type === 'audio' || msg.type === 'voice') text = '[spraakbericht ontvangen]';
          else if (msg.type === 'location') text = `[locatie] ${msg.location?.name || ''} ${msg.location?.address || ''}`.trim();
          else if (msg.button) text = msg.button.text || '';
          else if (msg.interactive) text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '';
          else text = `[${msg.type}-bericht ontvangen]`;

          // Media downloaden en als bijlage opslaan (indien token aanwezig).
          if (media && media.id) {
            const saved = await downloadWhatsappMedia(media.id, media.mime_type, media.filename);
            if (saved) attachments.push(saved);
          }

          const body = `${text}\nTelefoon: ${phone}`;
          await ingestMessage({
            channel: 'whatsapp',
            sender: name,
            subject: '',
            body,
            externalId: msg.id, // ontdubbelen via Meta's bericht-id
            attachments,
          });
        }
      }
    }
  } catch (err) {
    console.error('WhatsApp Cloud webhook fout:', err.message);
  }
  res.sendStatus(200); // Meta verwacht altijd 200
});

// Handmatig een bericht doorzetten/simuleren vanuit het dashboard.
app.post('/api/simulate', requireRole('admin', 'assistent'), async (req, res) => {
  const { channel, sender, subject, body, group } = req.body || {};
  if (!body) return res.status(400).json({ error: 'Bericht (body) verplicht' });
  const result = await ingestMessage({
    channel: channel === 'whatsapp' ? 'whatsapp' : 'email',
    sender, subject, body, group,
  });
  res.json({ ok: true, reviewId: result.review?.id, status: result.review?.status });
});

// ---------- Instellingen / statistieken / activiteit ----------
app.get('/api/settings', requireRole('admin'), (req, res) => {
  res.json({
    aiAutoApproveThreshold: autoApproveThreshold(),
    aiMode: aiMode(),
    statuses: getStatuses(),
    sources: getSources(),
    templates: getTemplates(),
    companyProfile: getCompanyProfile(),
    whatsappOrderGroups: db().settings.whatsappOrderGroups || '',
    emailSignature: getEmailSignature(),
    sendAddress: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    imapAddress: process.env.IMAP_USER || '',
    monteurDispatch: db().settings.monteurDispatch || { autoEnabled: false, days: [], autoMonteurId: '', trigger: 'approved', onlyDrs: true },
  });
});

app.patch('/api/settings', requireRole('admin'), (req, res) => {
  const b = req.body || {};
  if ('aiAutoApproveThreshold' in b) {
    const v = Number(b.aiAutoApproveThreshold);
    db().settings.aiAutoApproveThreshold = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
  }
  if ('statuses' in b) {
    const clean = sanitizeStatuses(b.statuses);
    if (!clean) return res.status(400).json({ error: 'Minimaal één geldige kolom vereist' });
    db().settings.statuses = clean;
  }
  if ('sources' in b) {
    const clean = sanitizeSources(b.sources);
    if (!clean) return res.status(400).json({ error: 'Minimaal één geldige bron vereist' });
    db().settings.sources = clean;
  }
  if ('templates' in b) {
    const clean = sanitizeTemplates(b.templates);
    if (!clean) return res.status(400).json({ error: 'Ongeldige sjablonen' });
    db().settings.templates = clean;
  }
  if ('companyProfile' in b) {
    db().settings.companyProfile = String(b.companyProfile || '').slice(0, 5000);
  }
  if ('whatsappOrderGroups' in b) {
    db().settings.whatsappOrderGroups = String(b.whatsappOrderGroups || '').slice(0, 500);
  }
  if ('emailSignature' in b) {
    db().settings.emailSignature = String(b.emailSignature || '').slice(0, 1000);
  }
  if ('monteurDispatch' in b) {
    const d = b.monteurDispatch || {};
    const trigger = ['approved', 'appointment', 'intake'].includes(d.trigger) ? d.trigger : 'approved';
    db().settings.monteurDispatch = {
      autoEnabled: !!d.autoEnabled,
      days: Array.isArray(d.days) ? d.days.filter((n) => n >= 0 && n <= 6) : [],
      autoMonteurId: d.autoMonteurId || '',
      trigger, // approved | appointment | intake (volautomatisch)
      onlyDrs: d.onlyDrs !== false, // standaard alleen DRS/Raf Breda-opdrachten
    };
  }
  save();
  res.json({
    aiAutoApproveThreshold: autoApproveThreshold(),
    statuses: getStatuses(),
    sources: getSources(),
    templates: getTemplates(),
    companyProfile: getCompanyProfile(),
    whatsappOrderGroups: db().settings.whatsappOrderGroups || '',
    emailSignature: getEmailSignature(),
    monteurDispatch: db().settings.monteurDispatch || { autoEnabled: false, days: [], autoMonteurId: '', trigger: 'approved', onlyDrs: true },
  });
});

// Sjablonen ophalen (alle ingelogde gebruikers mogen ze gebruiken)
app.get('/api/templates', requireAuth, (req, res) => {
  res.json(getTemplates());
});

// Snel antwoord direct per e-mail versturen (assistente/admin)
// AI stelt een concept-antwoord voor een opdracht voor.
app.post('/api/orders/:id/suggest-reply', requireRole('admin', 'assistent'), async (req, res) => {
  const order = db().orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Niet gevonden' });
  const customer = db().customers.find((c) => c.id === order.customerId);
  const history = (order.thread || []).map((t) => `${t.sender}: ${t.body}`).join('\n');
  try {
    const out = await suggestReply({
      customerName: customer?.name,
      problem: order.description || order.title,
      history,
      templates: getTemplates(),
      companyProfile: getCompanyProfile(),
    });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: 'Kon geen concept maken: ' + err.message });
  }
});

// ---------- Opdracht naar monteur sturen (via WhatsApp-bridge) ----------
// Bouwt een nette samenvatting van de opdracht voor de monteur-groep.
function buildMonteurMessage(order) {
  const c = db().customers.find((x) => x.id === order.customerId);
  const lines = [`*Nieuwe opdracht: ${order.title}*`];
  if (order.originGroup && isWhatsappOrderGroup(order.originGroup)) lines.push('Bron: DRS (Raf Breda)');
  if (c?.name) lines.push(`Klant: ${c.name}`);
  if (c?.phone) lines.push(`Tel: ${c.phone}`);
  if (c?.address) lines.push(`Adres: ${c.address}`);
  if (order.description) lines.push(`Omschrijving: ${order.description}`);
  if (order.appointmentAt) lines.push(`Afspraak: ${order.appointmentAt.replace('T', ' ')}`);
  if (order.price) lines.push(`Prijs: ${order.price}`);
  if (order.attachments?.length) lines.push(`(${order.attachments.length} foto's/bestanden in het dashboard)`);
  return lines.join('\n');
}

// Mag er nu (vandaag) automatisch naar de monteur verstuurd worden?
function autoSendAllowedToday() {
  const cfg = db().settings.monteurDispatch || {};
  if (!cfg.autoEnabled) return false;
  const days = cfg.days || []; // 0=zo ... 6=za
  // Dag in Amsterdamse tijd.
  const wd = new Date().toLocaleDateString('en-US', { timeZone: 'Europe/Amsterdam', weekday: 'short' });
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return days.includes(map[wd]);
}

// Zet een opdracht in de uitgaande wachtrij voor een monteur-groep.
function queueToMonteur(order, monteur, byName) {
  if (!monteur?.waGroup) return { error: 'Deze monteur heeft geen WhatsApp-groep ingesteld' };
  const item = {
    id: id('out'),
    orderId: order.id,
    group: monteur.waGroup,
    monteurName: monteur.name,
    text: buildMonteurMessage(order),
    status: 'queued',           // queued | sent | failed
    createdAt: now(),
    by: byName,
  };
  db().outbox.unshift(item);
  order.sentToMonteur = { monteurId: monteur.id, monteurName: monteur.name, at: now(), status: 'queued' };
  order.updatedAt = now();
  if (db().outbox.length > 1000) db().outbox.length = 1000;
  return { item };
}

// Handmatig: stuur een opdracht naar (de groep van) een monteur.
app.post('/api/orders/:id/send-monteur', requireRole('admin', 'assistent'), (req, res) => {
  const order = db().orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Niet gevonden' });
  const monteurId = req.body?.monteurId || order.monteurId;
  const monteur = db().monteurs.find((m) => m.id === monteurId);
  if (!monteur) return res.status(400).json({ error: 'Kies een monteur' });
  // koppel de monteur ook aan de opdracht als dat nog niet zo is
  if (!order.monteurId) order.monteurId = monteur.id;
  const r = queueToMonteur(order, monteur, req.user.name);
  if (r.error) return res.status(400).json({ error: r.error });
  logActivity(req.user.name, 'naar monteur gestuurd', `${order.title} -> ${monteur.name}`);
  saveSoon();
  res.json(withRelations(order));
});

// De WhatsApp-bridge haalt hier de wachtrij op (queued items).
app.get('/api/outbox', checkIngestToken, (req, res) => {
  res.json(db().outbox.filter((o) => o.status === 'queued'));
});

// De bridge meldt hier terug dat een item verzonden is (of mislukt).
app.post('/api/outbox/:id/done', checkIngestToken, (req, res) => {
  const item = db().outbox.find((o) => o.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Niet gevonden' });
  item.status = req.body?.ok === false ? 'failed' : 'sent';
  item.doneAt = now();
  const order = db().orders.find((o) => o.id === item.orderId);
  if (order && order.sentToMonteur) order.sentToMonteur.status = item.status;
  saveSoon();
  res.json({ ok: true });
});

app.post('/api/send-reply', requireRole('admin', 'assistent'), async (req, res) => {
  const { to, subject, text, orderId } = req.body || {};
  if (!smtpConfigured()) return res.status(503).json({ error: 'E-mail versturen is nog niet ingesteld (SMTP). Zie docs/INTEGRATIES.md.' });
  if (!to) return res.status(400).json({ error: 'Geen e-mailadres van de klant bekend' });
  try {
    await sendMail({ to, subject, text });
    // Zet de mail ook in je IMAP Verzonden-map (best-effort, niet blokkerend), zodat
    // je 'm in TransIP/Outlook terugziet bij "Verzonden".
    appendSentMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER || '', to, subject, text }).catch(() => {});
    // Leg vast in de opdracht (indien meegegeven) en in de activiteit.
    if (orderId) {
      const order = db().orders.find((o) => o.id === orderId);
      if (order) {
        // Ons antwoord als bericht in de gesprekshistorie (zo blijft het gesprek
        // compleet op de kaart, met wie wat wanneer stuurde).
        order.thread = order.thread || [];
        order.thread.push({
          id: id('thr'), channel: 'email', outgoing: true,
          sender: `${req.user.name} (Keyservice)`, subject, body: text, at: now(),
        });
        order.lastReplyAt = now();
        // Antwoord verstuurd -> van "Nieuw" automatisch naar "In behandeling".
        if (order.status === 'nieuw') order.status = isValidStatus('open') ? 'open' : order.status;
        order.openedAt = order.openedAt || now();
        // Klantreactie-melding weg (we hebben er net op gereageerd).
        order.customerReplied = false;
        order.unreadReplies = 0;
        order.updatedAt = now();
      }
    }
    logActivity(req.user.name, 'e-mail verstuurd', `aan ${to}`);
    saveSoon();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Versturen mislukt: ' + err.message });
  }
});

// AI analyseert het binnengekomen verkeer en geeft inzichten. (admin)
app.post('/api/analyze', requireRole('admin'), async (req, res) => {
  const days = Math.max(1, Math.min(365, Number(req.body?.days) || 30));
  const since = Date.now() - days * 86400000;
  const msgs = db().messages.filter((m) => new Date(m.receivedAt).getTime() >= since);
  try {
    const out = await analyzeTraffic({ messages: msgs, companyProfile: getCompanyProfile() });
    // Bewaar het laatste rapport zodat je het kunt terugzien.
    db().settings.lastAnalysis = { at: now(), days, total: msgs.length, ...out };
    saveSoon();
    res.json(db().settings.lastAnalysis);
  } catch (err) {
    res.status(500).json({ error: 'Analyse mislukt: ' + err.message });
  }
});

app.get('/api/analyze/last', requireRole('admin'), (req, res) => {
  res.json(db().settings.lastAnalysis || null);
});

// AI leidt FILTERREGELS af uit het echte verkeer (wat is wel/niet een opdracht)
// en voegt ze toe aan het bedrijfsprofiel, zodat de inbox-filtering scherper wordt.
app.post('/api/learn-filter', requireRole('admin'), async (req, res) => {
  const days = Math.max(1, Math.min(365, Number(req.body?.days) || 30));
  const since = Date.now() - days * 86400000;
  const msgs = db().messages.filter((m) => new Date(m.receivedAt).getTime() >= since);
  try {
    const out = await learnFilterRules({
      messages: msgs,
      companyProfile: getCompanyProfile(),
      feedback: db().feedback || [],
    });
    if (!out.text) return res.status(400).json({ error: 'Geen regels gegenereerd (te weinig berichten of AI uit).' });
    // Vervang een eerder toegevoegd filterregel-blok, of voeg toe.
    const profile = getCompanyProfile();
    const marker = '\n\n=== Door AI geleerde filterregels ===\n';
    const base = profile.split('\n\n=== Door AI geleerde filterregels ===')[0];
    db().settings.companyProfile = `${base}${marker}${out.text}`.slice(0, 5000);
    saveSoon();
    res.json({ ok: true, rules: out.text, companyProfile: db().settings.companyProfile });
  } catch (err) {
    res.status(500).json({ error: 'Mislukt: ' + err.message });
  }
});

// Lichte "is er iets veranderd?"-check voor live-updates. Het dashboard pollt
// dit elke paar seconden en ververst alleen als de versie veranderd is.
app.get('/api/pulse', requireAuth, (req, res) => {
  res.json({
    v: changeVersion(),
    pendingReviews: db().reviews.filter((r) => r.status === 'pending').length,
  });
});

// AI-vraagbaak: stel een vrije vraag over de opgeslagen WhatsApp/e-mail-berichten.
// Bv. "hoeveel omzet in de groep van Youssef?" of "wat is er met opdracht X gebeurd?".
app.post('/api/assistant/ask', requireRole('admin', 'assistent'), async (req, res) => {
  const question = (req.body?.question || '').trim();
  if (!question) return res.status(400).json({ error: 'Stel een vraag' });
  const group = (req.body?.group || '').toLowerCase().trim();
  const days = Number(req.body?.days) || 0;
  let msgs = db().messages.slice();
  if (days > 0) {
    const since = Date.now() - days * 86400000;
    msgs = msgs.filter((m) => new Date(m.receivedAt).getTime() >= since);
  }
  if (group) msgs = msgs.filter((m) => (m.group || '').toLowerCase().includes(group));
  // Neem de nieuwste tot 1500 en zet ze daarna chronologisch (oud->nieuw) voor de AI.
  msgs = msgs.sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt)).slice(0, 1500).reverse();
  try {
    const out = await askAssistant({ question, messages: msgs, companyProfile: getCompanyProfile() });
    logActivity(req.user.name, 'AI-vraagbaak', question.slice(0, 80));
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: 'Mislukt: ' + err.message });
  }
});

// Lijst van WhatsApp-groepen die we kennen (voor het filter in de vraagbaak).
app.get('/api/assistant/groups', requireRole('admin', 'assistent'), (req, res) => {
  const groups = [...new Set(db().messages.map((m) => m.group).filter(Boolean))];
  res.json(groups);
});

// AI-dagcheck: vergelijkt alle berichten van vandaag met de aangemaakte opdrachten en
// meldt of er iets is gemist, wat opvalt (spoed/akkoord/wacht), en geeft een conclusie.
app.post('/api/assistant/daily-check', requireRole('admin', 'assistent'), async (req, res) => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const since = start.getTime();
  const msgs = db().messages.filter((m) => new Date(m.receivedAt).getTime() >= since);
  const orders = db().orders.filter((o) => new Date(o.createdAt).getTime() >= since);
  const labels = getStatusLabels();
  const orderSummary = orders.map((o) => {
    const c = db().customers.find((x) => x.id === o.customerId) || {};
    return `- ${o.title} | ${labels[o.status] || o.status} | klant: ${c.name || '?'} ${c.phone || ''}`;
  }).join('\n') || '(vandaag nog geen opdrachten aangemaakt)';
  const question = `Dit zijn ALLE binnengekomen berichten van vandaag (${msgs.length} stuks; staan hierboven). Hieronder de opdrachten die vandaag in het systeem zijn aangemaakt:\n${orderSummary}\n\nControleer als ervaren kantoorassistent van Keyservice:\n1) Is elke ECHTE klantaanvraag uit de berichten ook een opdracht geworden? Noem met naam de aanvragen die NIET als opdracht terug te vinden zijn (mogelijk gemist).\n2) Wat valt op? (spoed, een klant die AKKOORD geeft op een offerte, een klant die op antwoord wacht, dubbele/zelfde aanvragen).\n3) Korte eindconclusie: is alles netjes verwerkt of moet er iets nagekeken worden?\nWees concreet met namen en kort.`;
  try {
    const out = await askAssistant({ question, messages: msgs, companyProfile: getCompanyProfile() });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: 'Mislukt: ' + err.message });
  }
});

// AI-statusscan: leest recente groepsberichten en stelt statuswijzigingen voor lopende
// opdrachten voor. Past zelf NIETS aan — geeft alleen voorstellen terug.
app.post('/api/assistant/status-scan', requireRole('admin', 'assistent'), async (req, res) => {
  const days = Number(req.body?.days) || 14;
  const since = Date.now() - days * 86400000;
  const active = db().orders
    .filter((o) => !o.archivedWeek && !['afgerond', 'geannuleerd'].includes(o.status))
    .map((o) => ({ id: o.id, title: o.title, status: o.status, customer: (db().customers.find((c) => c.id === o.customerId) || {}).name }));
  const msgs = db().messages
    .filter((m) => new Date(m.receivedAt).getTime() >= since)
    .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))
    .slice(0, 300);
  try {
    const out = await suggestStatusChanges({ orders: active, messages: msgs, statuses: getStatuses(), companyProfile: getCompanyProfile() });
    // Verrijk met huidige opdracht-info + labels, en filter op geldige status/opdracht.
    const labels = getStatusLabels();
    const valid = (out.suggestions || []).map((s) => {
      const order = db().orders.find((o) => o.id === s.orderId);
      if (!order || !isValidStatus(s.suggestedStatus)) return null;
      if (order.status === s.suggestedStatus) return null;
      return {
        orderId: order.id, title: order.title,
        from: order.status, fromLabel: labels[order.status] || order.status,
        to: s.suggestedStatus, toLabel: labels[s.suggestedStatus] || s.suggestedStatus,
        reason: s.reason || '', evidence: s.evidence || '',
      };
    }).filter(Boolean);
    res.json({ suggestions: valid, engine: out.engine, note: out.note || '' });
  } catch (err) {
    res.status(500).json({ error: 'Mislukt: ' + err.message });
  }
});

// Agenda: alle (actieve) opdrachten met een afspraakdatum, voor de agenda-pagina.
// isDrs = afkomstig uit de DRS/opdracht-WhatsApp-groep (originGroup of WhatsApp-bron).
app.get('/api/agenda', requireAuth, (req, res) => {
  const labels = getStatusLabels();
  const items = db().orders
    .filter((o) => o.appointmentAt && !o.archivedWeek && !['geannuleerd'].includes(o.status))
    .map((o) => {
      const c = db().customers.find((x) => x.id === o.customerId) || {};
      const m = db().monteurs.find((x) => x.id === o.monteurId) || null;
      const src = (o.source || '').toLowerCase();
      const isDrs = (o.originGroup && isWhatsappOrderGroup(o.originGroup))
        || (!o.originGroup && /whatsapp|groep|app/.test(src));
      return {
        id: o.id, title: o.title, at: o.appointmentAt, status: o.status, statusLabel: labels[o.status] || o.status,
        customer: c.name || '', phone: c.phone || '', address: c.address || '',
        monteur: m ? m.name : '', source: o.source || '', isDrs,
      };
    })
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  res.json(items);
});

app.get('/api/stats', requireAuth, (req, res) => {
  const orders = db().orders;
  const byStatus = {};
  getStatusKeys().forEach((s) => { byStatus[s] = orders.filter((o) => o.status === s).length; });
  const reviews = db().reviews;
  const handled = reviews.filter((r) => ['approved', 'auto_approved', 'rejected'].includes(r.status));
  const approved = reviews.filter((r) => ['approved', 'auto_approved'].includes(r.status));
  const corrected = approved.filter((r) => r.correctedStatus).length;
  res.json({
    byStatus,
    totalOrders: orders.length,
    leads: db().customers.filter((c) => c.type === 'lead').length,
    customers: db().customers.filter((c) => c.type !== 'lead').length,
    pendingReviews: reviews.filter((r) => r.status === 'pending').length,
    ai: {
      mode: aiMode(),
      handled: handled.length,
      approved: approved.length,
      corrected,
      accuracy: approved.length ? Math.round(((approved.length - corrected) / approved.length) * 100) : null,
    },
  });
});

// Snel statusoverzicht ("scan"): wie heeft gereageerd, wie wacht op ons, enz.
app.get('/api/digest', requireAuth, (req, res) => {
  const active = db().orders.filter((o) => !o.archivedWeek);
  const labels = getStatusLabels();
  const byStatus = {};
  getStatusKeys().forEach((k) => { byStatus[k] = { label: labels[k], count: 0 }; });
  active.forEach((o) => { if (byStatus[o.status]) byStatus[o.status].count++; });

  const customerReplied = active.filter((o) => o.customerReplied)
    .map((o) => ({ id: o.id, title: o.title, customer: (db().customers.find((c) => c.id === o.customerId) || {}).name }));
  const neverOpened = active.filter((o) => !o.openedAt)
    .map((o) => ({ id: o.id, title: o.title }));
  // Wacht op ons antwoord: offerte-fase of open, nog geen antwoord gestuurd.
  const awaitingReply = active.filter((o) => !o.lastReplyAt && ['open', firstStatusKey(), 'offerte_verzonden'].includes(o.status))
    .map((o) => ({ id: o.id, title: o.title }));
  // Lang stil: geen update in 5+ dagen, niet afgerond/geannuleerd.
  const fiveDays = Date.now() - 5 * 86400000;
  const stale = active.filter((o) => !['afgerond', 'geannuleerd'].includes(o.status) && new Date(o.updatedAt).getTime() < fiveDays)
    .map((o) => ({ id: o.id, title: o.title, since: o.updatedAt }));

  const custName = (o) => (db().customers.find((c) => c.id === o.customerId) || {}).name;
  // Afspraken: vandaag en de komende 7 dagen.
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const endToday = startToday.getTime() + 86400000;
  const endWeek = startToday.getTime() + 7 * 86400000;
  const apptList = active
    .filter((o) => o.appointmentAt && !['afgerond', 'geannuleerd'].includes(o.status))
    .map((o) => ({ id: o.id, title: o.title, customer: custName(o), at: o.appointmentAt, t: new Date(o.appointmentAt).getTime() }))
    .filter((a) => !isNaN(a.t))
    .sort((a, b) => a.t - b.t);
  const todayAppointments = apptList.filter((a) => a.t >= startToday.getTime() && a.t < endToday);
  const weekAppointments = apptList.filter((a) => a.t >= startToday.getTime() && a.t < endWeek);
  // Offertes die blijven liggen: verzonden, 3+ dagen geen reactie van de klant.
  const threeDays = Date.now() - 3 * 86400000;
  const staleQuotes = active
    .filter((o) => o.status === 'offerte_verzonden' && !o.customerReplied && new Date(o.updatedAt).getTime() < threeDays)
    .map((o) => ({ id: o.id, title: o.title, customer: custName(o), since: o.updatedAt }));

  res.json({
    total: active.length,
    byStatus,
    customerReplied, neverOpened, awaitingReply, stale,
    todayAppointments, weekAppointments, staleQuotes,
    pendingReviews: db().reviews.filter((r) => r.status === 'pending').length,
  });
});

// Abonnementen-overzicht + (geschat) AI-verbruik via dit dashboard.
app.get('/api/subscriptions', requireRole('admin'), (req, res) => {
  res.json({
    usage: usageSummary(),
    services: [
      {
        name: 'Render (hosting)', what: 'Draait het CRM-dashboard online',
        cost: '± €7 / maand (Starter + schijf)', manageUrl: 'https://dashboard.render.com',
        note: 'Verbruik/facturen zie je in het Render-dashboard.',
      },
      {
        name: 'Claude API (Anthropic Console)', what: 'Slimme AI-categorisatie & concepten',
        cost: 'Betaal per gebruik (zie schatting hiernaast)', manageUrl: 'https://console.anthropic.com/settings/usage',
        note: 'Officieel verbruik/tegoed staat in de Console. Los van je Claude Pro-abo.',
      },
      {
        name: 'TransIP (e-mail & website)', what: 'Mailboxen, domein en website-hosting',
        cost: 'Volgens je TransIP-abonnement', manageUrl: 'https://www.transip.nl/cp/',
        note: 'Facturen/verbruik beheer je in het TransIP-controlepaneel.',
      },
      {
        name: 'WhatsApp-bridge (VPS)', what: 'Stuurt WhatsApp-groepen/1-op-1 door (optioneel)',
        cost: '± €4–5 / maand (indien in gebruik)', manageUrl: '',
        note: 'Alleen nodig als je de onofficiële WhatsApp-koppeling draait.',
      },
    ],
  });
});

// Systeem-gezondheidscheck (laatste resultaat of nu uitvoeren met ?run=1)
app.get('/api/health', requireRole('admin'), async (req, res) => {
  if (req.query.run === '1' || !lastHealth()) {
    try { return res.json(await runHealthCheck()); }
    catch (e) { return res.status(500).json({ error: e.message }); }
  }
  res.json(lastHealth());
});

app.get('/api/activity', requireAuth, (req, res) => {
  res.json(db().activity.slice(0, 100));
});

// ---------- Bijlagen (alleen voor ingelogde gebruikers) ----------
app.get('/uploads/:file', requireAuth, (req, res) => {
  if (!/^att_[a-zA-Z0-9_.]+$/.test(req.params.file)) return res.status(400).end();
  res.sendFile(path.join(UPLOAD_DIR, req.params.file));
});

// ---------- Statische bestanden / frontend ----------
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, req.user ? 'index.html' : 'login.html'));
});
app.use(express.static(PUBLIC_DIR));

app.listen(PORT, () => {
  console.log(`\n  Keyservice CRM draait op  http://localhost:${PORT}`);
  console.log(`  AI-modus: ${aiMode() === 'ai' ? 'AI (Claude)' : 'DEMO (regels)'}`);
  console.log(`  E-mail versturen (SMTP): ${smtpConfigured() ? 'actief' : 'niet geconfigureerd'}`);
  startEmailPoller();
  startWeeklyArchiver();
  startHealthMonitor();
  startBackups();
  console.log('');
});

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, id, now, save, saveSoon, load, logActivity, changeVersion } from './db.js';
import {
  attachUser, requireAuth, requireRole, publicUser,
  verifyPassword, createSession, destroySession,
  setSessionCookie, clearSessionCookie, createUser, hashPassword,
} from './auth.js';
import { aiMode, suggestReply, scoreRelevance, analyzeTraffic, learnFilterRules } from './ai/categorizer.js';
import { ensureSeed } from './seed.js';
import {
  autoApproveThreshold, upsertCustomer, withRelations, applyReview, ingestMessage,
} from './pipeline.js';
import { startEmailPoller } from './connectors/email-imap.js';
import { sendMail, smtpConfigured } from './connectors/email-smtp.js';
import { startWeeklyArchiver, runWeeklyArchive } from './archive.js';
import { saveBuffer, deleteFile, UPLOAD_DIR } from './storage.js';
import { runHealthCheck, lastHealth, startHealthMonitor } from './health.js';
import { usageSummary } from './usage.js';
import {
  ensureSettings, getStatuses, getStatusLabels, getStatusKeys, getSources,
  isValidStatus, normalizeStatus, firstStatusKey, sanitizeStatuses, sanitizeSources,
  getTemplates, sanitizeTemplates, appointmentStatusKey, getCompanyProfile,
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
  res.json(db().monteurs.map((m) => ({
    ...m,
    activeCount: orders.filter((o) => o.monteurId === m.id && o.status !== 'geannuleerd').length,
  })));
});

app.post('/api/monteurs', requireRole('admin', 'assistent'), (req, res) => {
  const { name, phone, email } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Naam verplicht' });
  const m = { id: id('mont'), name, phone: phone || '', email: email || '', createdAt: now() };
  db().monteurs.push(m);
  logActivity(req.user.name, 'monteur toegevoegd', name);
  saveSoon();
  res.json(m);
});

app.patch('/api/monteurs/:id', requireRole('admin', 'assistent'), (req, res) => {
  const m = db().monteurs.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'Niet gevonden' });
  for (const k of ['name', 'phone', 'email']) if (k in (req.body || {})) m[k] = req.body[k];
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
  res.json({ review, order: withRelations(order) });
});

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
  const targets = db().reviews.filter((r) => r.status === 'pending' && (r.suggestion?.confidence || 0) >= min);
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
app.get('/api/feedback', requireAuth, (req, res) => {
  res.json((db().feedback || []).slice(0, 100));
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
  save();
  res.json({
    aiAutoApproveThreshold: autoApproveThreshold(),
    statuses: getStatuses(),
    sources: getSources(),
    templates: getTemplates(),
    companyProfile: getCompanyProfile(),
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

app.post('/api/send-reply', requireRole('admin', 'assistent'), async (req, res) => {
  const { to, subject, text, orderId } = req.body || {};
  if (!smtpConfigured()) return res.status(503).json({ error: 'E-mail versturen is nog niet ingesteld (SMTP). Zie docs/INTEGRATIES.md.' });
  if (!to) return res.status(400).json({ error: 'Geen e-mailadres van de klant bekend' });
  try {
    await sendMail({ to, subject, text });
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

  res.json({
    total: active.length,
    byStatus,
    customerReplied, neverOpened, awaitingReply, stale,
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
  console.log('');
});

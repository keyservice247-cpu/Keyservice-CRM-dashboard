import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, id, now, save, saveSoon, load, logActivity } from './db.js';
import {
  attachUser, requireAuth, requireRole, publicUser,
  verifyPassword, createSession, destroySession,
  setSessionCookie, clearSessionCookie, createUser,
} from './auth.js';
import { classify, aiMode, STATUSES, STATUS_LABELS } from './ai/categorizer.js';
import { ensureSeed } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

load();
ensureSeed();

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(attachUser);

// ---------- Helpers ----------
function autoApproveThreshold() {
  const s = db().settings || {};
  if (s.aiAutoApproveThreshold != null) return Number(s.aiAutoApproveThreshold);
  const env = Number(process.env.AI_AUTO_APPROVE_THRESHOLD);
  return Number.isFinite(env) ? env : 0;
}

function findCustomer({ name, phone, email }) {
  const customers = db().customers;
  const norm = (v) => (v || '').toLowerCase().replace(/[\s().-]/g, '');
  if (email) {
    const m = customers.find((c) => c.email && c.email.toLowerCase() === email.toLowerCase());
    if (m) return m;
  }
  if (phone) {
    const p = norm(phone);
    const m = customers.find((c) => c.phone && norm(c.phone) === p);
    if (m) return m;
  }
  if (name) {
    const m = customers.find((c) => c.name && c.name.toLowerCase() === name.toLowerCase());
    if (m) return m;
  }
  return null;
}

function upsertCustomer({ name, phone, email, source }) {
  let c = findCustomer({ name, phone, email });
  if (c) {
    // vul ontbrekende gegevens aan
    if (!c.phone && phone) c.phone = phone;
    if (!c.email && email) c.email = email;
    if (c.type === 'lead') c.type = 'klant';
    return { customer: c, created: false };
  }
  c = {
    id: id('cust'),
    name: name || 'Onbekende klant',
    phone: phone || '',
    email: email || '',
    address: '',
    type: 'lead',
    source: source || 'handmatig',
    notes: '',
    createdAt: now(),
  };
  db().customers.push(c);
  return { customer: c, created: true };
}

function withRelations(order) {
  const customer = db().customers.find((c) => c.id === order.customerId) || null;
  const monteur = db().monteurs.find((m) => m.id === order.monteurId) || null;
  return { ...order, customer, monteur };
}

// Verwerk een binnenkomend bericht: opslaan -> AI categoriseren -> review aanmaken
// -> eventueel automatisch goedkeuren bij hoge zekerheid.
async function ingestMessage({ channel, sender, subject, body, group, externalId }) {
  const message = {
    id: id('msg'),
    channel,
    sender: sender || '',
    subject: subject || '',
    body: body || '',
    group: group || '',
    externalId: externalId || '',
    receivedAt: now(),
  };
  db().messages.push(message);

  const suggestion = await classify({ channel, sender, subject, body });

  const review = {
    id: id('rev'),
    messageId: message.id,
    channel,
    suggestion,
    status: 'pending', // pending | approved | rejected | auto_approved
    finalStatus: null,
    orderId: null,
    correctedStatus: null, // gevuld als mens iets anders koos dan de AI
    reviewedBy: null,
    reviewedAt: null,
    createdAt: now(),
  };
  db().reviews.push(review);

  const threshold = autoApproveThreshold();
  if (threshold > 0 && suggestion.confidence >= threshold) {
    applyReview(review, { actorName: 'AI (automatisch)', auto: true });
  }

  saveSoon();
  logActivity('systeem', 'bericht ontvangen', `${channel} van ${sender || 'onbekend'}`);
  return { message, review };
}

// Maak van een (goedgekeurde) review een echte opdracht + klant.
function applyReview(review, { actorName, overrides = {}, auto = false }) {
  const s = review.suggestion;
  const status = overrides.status || s.status;
  const { customer } = upsertCustomer({
    name: overrides.customerName ?? s.customerName,
    phone: overrides.customerPhone ?? s.customerPhone,
    email: overrides.customerEmail ?? s.customerEmail,
    source: review.channel,
  });

  const order = {
    id: id('ord'),
    title: overrides.title || s.title || 'Nieuwe opdracht',
    description: '',
    status,
    source: review.channel,
    customerId: customer.id,
    monteurId: overrides.monteurId || null,
    appointmentAt: null,
    price: '',
    urgent: !!s.urgent,
    notes: '',
    messageId: review.messageId,
    createdAt: now(),
    updatedAt: now(),
  };
  db().orders.push(order);

  review.status = auto ? 'auto_approved' : 'approved';
  review.finalStatus = status;
  review.orderId = order.id;
  review.correctedStatus = status !== s.status ? status : null;
  review.reviewedBy = actorName;
  review.reviewedAt = now();
  saveSoon();
  logActivity(actorName, auto ? 'opdracht automatisch aangemaakt' : 'review goedgekeurd', order.title);
  return order;
}

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
      statuses: STATUSES,
      statusLabels: STATUS_LABELS,
      autoApproveThreshold: autoApproveThreshold(),
    },
  });
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
  // Koppel opdrachten los
  db().orders.forEach((o) => { if (o.monteurId === req.params.id) o.monteurId = null; });
  const [removed] = monteurs.splice(i, 1);
  logActivity(req.user.name, 'monteur verwijderd', removed.name);
  saveSoon();
  res.json({ ok: true });
});

// ---------- Opdrachten ----------
app.get('/api/orders', requireAuth, (req, res) => {
  let list = db().orders.map(withRelations);
  if (req.query.status) list = list.filter((o) => o.status === req.query.status);
  if (req.query.monteurId) list = list.filter((o) => o.monteurId === req.query.monteurId);
  list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  res.json(list);
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
  if (!STATUSES.includes(b.status || 'open')) return res.status(400).json({ error: 'Ongeldige status' });
  const order = {
    id: id('ord'),
    title: b.title || 'Nieuwe opdracht',
    description: b.description || '',
    status: b.status || 'open',
    source: b.source || 'handmatig',
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

  if (b.status && !STATUSES.includes(b.status)) return res.status(400).json({ error: 'Ongeldige status' });

  let changedStatus = false;
  for (const k of allowed) {
    if (k in b) {
      if (k === 'status' && b[k] !== order.status) changedStatus = true;
      order[k] = b[k];
    }
  }
  order.updatedAt = now();
  if (changedStatus) logActivity(req.user.name, 'status gewijzigd', `${order.title} → ${STATUS_LABELS[order.status]}`);
  saveSoon();
  res.json(withRelations(order));
});

app.delete('/api/orders/:id', requireRole('admin', 'assistent'), (req, res) => {
  const orders = db().orders;
  const i = orders.findIndex((o) => o.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Niet gevonden' });
  const [removed] = orders.splice(i, 1);
  logActivity(req.user.name, 'opdracht verwijderd', removed.title);
  saveSoon();
  res.json({ ok: true });
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
  if (review.status !== 'pending') return res.status(400).json({ error: 'Al verwerkt' });
  const order = applyReview(review, { actorName: req.user.name, overrides: req.body || {} });
  res.json({ review, order: withRelations(order) });
});

app.post('/api/reviews/:id/reject', requireRole('admin', 'assistent'), (req, res) => {
  const review = db().reviews.find((r) => r.id === req.params.id);
  if (!review) return res.status(404).json({ error: 'Niet gevonden' });
  if (review.status !== 'pending') return res.status(400).json({ error: 'Al verwerkt' });
  review.status = 'rejected';
  review.reviewedBy = req.user.name;
  review.reviewedAt = now();
  review.rejectReason = (req.body && req.body.reason) || '';
  logActivity(req.user.name, 'review afgewezen', review.suggestion?.title || '');
  saveSoon();
  res.json({ review });
});

// ---------- Inkomende koppelingen (webhooks) ----------
function checkIngestToken(req, res, next) {
  const expected = process.env.INGEST_TOKEN;
  if (!expected) return res.status(503).json({ error: 'INGEST_TOKEN niet ingesteld op de server' });
  const got = req.get('x-ingest-token') || req.query.token;
  if (got !== expected) return res.status(401).json({ error: 'Ongeldig ingest-token' });
  next();
}

app.post('/api/ingest/email', checkIngestToken, async (req, res) => {
  const { from, sender, subject, body, text, html } = req.body || {};
  const result = await ingestMessage({
    channel: 'email',
    sender: from || sender,
    subject,
    body: body || text || html || '',
  });
  res.json({ ok: true, reviewId: result.review.id, status: result.review.status });
});

app.post('/api/ingest/whatsapp', checkIngestToken, async (req, res) => {
  const { from, sender, name, body, text, message, group } = req.body || {};
  const result = await ingestMessage({
    channel: 'whatsapp',
    sender: name || from || sender,
    subject: group ? `WhatsApp-groep: ${group}` : '',
    body: body || text || message || '',
    group,
  });
  res.json({ ok: true, reviewId: result.review.id, status: result.review.status });
});

// Handmatig een bericht simuleren vanuit het dashboard (om te testen).
app.post('/api/simulate', requireRole('admin', 'assistent'), async (req, res) => {
  const { channel, sender, subject, body, group } = req.body || {};
  if (!body) return res.status(400).json({ error: 'Bericht (body) verplicht' });
  const result = await ingestMessage({
    channel: channel === 'whatsapp' ? 'whatsapp' : 'email',
    sender, subject, body, group,
  });
  res.json({ ok: true, reviewId: result.review.id, status: result.review.status });
});

// ---------- Instellingen / statistieken / activiteit ----------
app.get('/api/settings', requireRole('admin'), (req, res) => {
  res.json({ aiAutoApproveThreshold: autoApproveThreshold(), aiMode: aiMode() });
});

app.patch('/api/settings', requireRole('admin'), (req, res) => {
  if ('aiAutoApproveThreshold' in (req.body || {})) {
    const v = Number(req.body.aiAutoApproveThreshold);
    db().settings.aiAutoApproveThreshold = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
  }
  save();
  res.json({ aiAutoApproveThreshold: autoApproveThreshold() });
});

app.get('/api/stats', requireAuth, (req, res) => {
  const orders = db().orders;
  const byStatus = {};
  STATUSES.forEach((s) => { byStatus[s] = orders.filter((o) => o.status === s).length; });
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

app.get('/api/activity', requireAuth, (req, res) => {
  res.json(db().activity.slice(0, 100));
});

// ---------- Statische bestanden / frontend ----------
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, req.user ? 'index.html' : 'login.html'));
});
app.use(express.static(PUBLIC_DIR));

app.listen(PORT, () => {
  console.log(`\n  Keyservice CRM draait op  http://localhost:${PORT}`);
  console.log(`  AI-modus: ${aiMode() === 'ai' ? 'AI (Claude)' : 'DEMO (regels)'}\n`);
});

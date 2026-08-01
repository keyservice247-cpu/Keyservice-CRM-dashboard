import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// VANGNET: een losse fout in een achtergrondtaak (bv. IMAP-verbinding die wegvalt)
// mag NOOIT de hele CRM platleggen. Loggen i.p.v. crashen.
process.on('unhandledRejection', (reason) => {
  console.error('Onafgehandelde promise-fout (genegeerd, app blijft draaien):', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('Onafgehandelde fout (genegeerd, app blijft draaien):', err?.message || err);
});
import { db, id, now, save, saveSoon, saveSoonQuiet, load, logActivity, changeVersion, startBackups, backupNow, listBackups, dbFilePath, restoreBackup, snapshotJson, storageEngine } from './db.js';

// Nette afsluiting: bij een deploy/herstart stuurt Render (of Ctrl+C lokaal) een
// signaal. Flush dan de laatste, nog niet weggeschreven wijzigingen naar schijf
// (saveSoon debounct 200ms — zonder dit gaat die laatste seconde stil verloren).
let _shuttingDown = false;
function gracefulShutdown(sig) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.log(`[afsluiten] ${sig} ontvangen — laatste opslag flushen…`);
  try { save(); } catch (e) { console.error('[afsluiten] opslaan mislukt:', e.message); }
  // Terugvalpunt bijwerken: na een herstart/deploy is de JSON-kopie dus actueel.
  try { snapshotJson(); } catch (e) { console.error('[afsluiten] momentopname mislukt:', e.message); }
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
import {
  attachUser, requireAuth, requireRole, publicUser,
  verifyPassword, createSession, destroySession,
  setSessionCookie, clearSessionCookie, createUser, hashPassword,
  can, requirePerm, PERM_KEYS,
} from './auth.js';
import { aiMode, suggestReply, scoreRelevance, analyzeTraffic, learnFilterRules, askAssistant, suggestStatusChanges, dayOverview } from './ai/categorizer.js';
import { ensureSeed } from './seed.js';
import { amsterdamParts } from './week.js';
import {
  autoApproveThreshold, upsertCustomer, withRelations, applyReview, ingestMessage, buildMaps,
  findCustomerStrong, senderPhoneFromText, matchPhone,
} from './pipeline.js';
import { startEmailPoller, appendSentMail } from './connectors/email-imap.js';
import { maybeSendAutoReply, maybeSendConfirmationOnApprove } from './autoreply.js';
import { startFollowUps } from './followup.js';
import { sendBackupMail, startBackupMail } from './backup-mail.js';
import { getPublicKey, addSubscription, removeSubscription, sendPush } from './push.js';
import { startAutomations, maybeSendTerugkoppeling, maybeSendAppointmentConfirm, maybeSendAppointmentCancel, sendWeeklyCeoReport, sendMorningBriefing, morningBriefingData, sendWeeklyAiCheck, weeklyCheckData, sendReviewRequest } from './automations.js';
import { getInvoiceSettings, upsertInvoice, buildInvoicePdf, computeTotals, saveInvoiceFields, createStandaloneInvoice, copyInvoice, sendInvoiceReminder, autoConvertQuoteToInvoice, sendQuoteFollowup } from './invoices.js';
import { addEntry, updateEntry, deleteEntry, monthReport, trend, INCOME_CATEGORIES, EXPENSE_CATEGORIES, QUICK_EXPENSES, getFinanceSettings, saveFinanceSettings, bookRecurringDue, suggestIncomeFromReports, importIncome, weeklyReportData, runFinanceAutoSync, removeAutoIncomeForInvoice, collectAutoSyncEntries, bookAutoSyncEntries, dismissIncomeSuggestions } from './finance.js';
import { sendMail, smtpConfigured } from './connectors/email-smtp.js';
import { startWeeklyArchiver, runWeeklyArchive } from './archive.js';
import { saveBuffer, deleteFile, UPLOAD_DIR, dedupeAttachments, dedupeListEntries } from './storage.js';
import Busboy from 'busboy';
import { runHealthCheck, lastHealth, startHealthMonitor } from './health.js';
import {
  googleConfigured, isConnected as googleConnected, connectionInfo as googleInfo,
  getAuthUrl as googleAuthUrl, exchangeCode as googleExchange, disconnect as googleDisconnect,
  listCalendars as googleListCalendars, setDefaultCalendarId, syncOrderToGoogle, removeOrderFromGoogle,
} from './google.js';
import { usageSummary } from './usage.js';
import {
  ensureSettings, getStatuses, getStatusLabels, getStatusKeys, getSources,
  isValidStatus, normalizeStatus, firstStatusKey, sanitizeStatuses, sanitizeSources,
  getTemplates, sanitizeTemplates, appointmentStatusKey, getCompanyProfile,
  getEmailSignature, isWhatsappOrderGroup, resolveGroupAlias, getAutoReply, getFollowUp, getBackupMail, getOnderweg,
  getTerugkoppeling, getAppointmentMsg, getReviewRequest, getCrmAlerts, getPriceList,
  groupIdForName, healGroupIdNames, learnGroupAlias, DEFAULT_EMAIL_FILTERS, getAttachmentCleanup,
  getPriceBundles, sanitizeBundles, sanitizeBundleLines, getMorningBriefing, getAutoMergeWindowHours,
  getHtmlSignature, getWeeklyAiCheck, syncBundlesToPriceList, getGoogleSync,
} from './settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

load();
ensureSeed();
ensureSettings();

const app = express();
app.set('trust proxy', 1); // achter de Render-proxy: herkent HTTPS via x-forwarded-proto
// Basale beveiligingsheaders op elk antwoord: geen MIME-sniffing, geen clickjacking.
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(attachUser);
const isHttps = (req) => req.secure || req.get('x-forwarded-proto') === 'https';

// Eenvoudige rem tegen wachtwoord-raden: te veel MISLUKTE inlogpogingen vanaf
// hetzelfde IP -> tijdelijk blokkeren. Een geslaagde login wist de teller, dus
// normaal gebruik wordt nooit gehinderd (pas na 8 foute pogingen in 15 min).
const _loginAttempts = new Map();
function loginBlockedFor(ip) {
  const rec = _loginAttempts.get(ip);
  if (rec && rec.blockedUntil > Date.now()) return Math.ceil((rec.blockedUntil - Date.now()) / 1000);
  return 0;
}
function noteLoginFail(ip) {
  const nowMs = Date.now();
  let rec = _loginAttempts.get(ip);
  if (!rec || nowMs - rec.first > 15 * 60000) rec = { count: 0, first: nowMs, blockedUntil: 0 };
  rec.count++;
  if (rec.count >= 8) rec.blockedUntil = nowMs + 10 * 60000; // 10 min blok
  _loginAttempts.set(ip, rec);
}

// ---------- Auth-routes ----------
app.post('/api/login', (req, res) => {
  const ip = req.ip || 'onbekend';
  const wait = loginBlockedFor(ip);
  if (wait) return res.status(429).json({ error: `Te veel inlogpogingen. Probeer het over ${Math.ceil(wait / 60)} min opnieuw.` });
  const { email, password } = req.body || {};
  const user = db().users.find((u) => u.email === (email || '').toLowerCase());
  if (!user || !verifyPassword(password || '', user.passwordHash)) {
    noteLoginFail(ip);
    return res.status(401).json({ error: 'Onjuist e-mailadres of wachtwoord' });
  }
  _loginAttempts.delete(ip); // geslaagd -> teller wissen
  const token = createSession(user.id);
  setSessionCookie(res, token, isHttps(req));
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
  const { name, email, password, role, monteurId } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Naam, e-mail en wachtwoord verplicht' });
  if (db().users.some((u) => u.email === email.toLowerCase())) {
    return res.status(409).json({ error: 'E-mailadres bestaat al' });
  }
  if (!['admin', 'assistent', 'monteur'].includes(role)) {
    return res.status(400).json({ error: 'Ongeldige rol' });
  }
  const user = createUser({ name, email, password, role, monteurId: role === 'monteur' ? (monteurId || null) : null });
  logActivity(req.user.name, 'gebruiker aangemaakt', `${name} (${role})`);
  res.json(publicUser(user));
});

// Gebruiker bijwerken: naam/rol/monteur-koppeling, wachtwoord-reset en RECHTEN
// (perms = per-gebruiker aan/uit; null = terug naar de standaard van de rol).
app.patch('/api/users/:id', requireRole('admin'), (req, res) => {
  const u = db().users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'Niet gevonden' });
  const b = req.body || {};
  if (b.name) u.name = String(b.name).slice(0, 80);
  if (b.role) {
    if (!['admin', 'assistent', 'monteur'].includes(b.role)) return res.status(400).json({ error: 'Ongeldige rol' });
    if (u.id === req.user.id && b.role !== 'admin') return res.status(400).json({ error: 'Je kunt je eigen beheerdersrol niet afnemen' });
    u.role = b.role;
    u.monteurId = b.role === 'monteur' ? (b.monteurId || u.monteurId || null) : null;
  } else if ('monteurId' in b && u.role === 'monteur') {
    u.monteurId = b.monteurId || null;
  }
  if (b.newPassword) {
    if (String(b.newPassword).length < 6) return res.status(400).json({ error: 'Wachtwoord minimaal 6 tekens' });
    u.passwordHash = hashPassword(b.newPassword);
  }
  if ('perms' in b) {
    if (b.perms === null) { delete u.perms; } // terug naar rol-standaard
    else if (typeof b.perms === 'object') {
      u.perms = {};
      for (const k of PERM_KEYS) if (typeof b.perms[k] === 'boolean') u.perms[k] = b.perms[k];
    }
  }
  saveSoon();
  logActivity(req.user.name, 'gebruiker bijgewerkt', `${u.name} (${u.role})`);
  res.json(publicUser(u));
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
  const labels = getStatusLabels();
  // Opdrachten ÉÉN keer groeperen per klant (O(n)) i.p.v. per klant de hele
  // opdrachtenlijst doorzoeken (O(n²)).
  const ordersByCustomer = new Map();
  for (const o of db().orders) {
    if (!o.customerId) continue;
    const arr = ordersByCustomer.get(o.customerId) || [];
    arr.push(o); ordersByCustomer.set(o.customerId, arr);
  }
  // Gefactureerd totaal per klant (verzonden + betaald), voor het klantenoverzicht.
  const invByCustomer = new Map();
  for (const i of (db().invoices || [])) {
    if (!i.customerId || i.type === 'offerte' || !['verzonden', 'betaald'].includes(i.status)) continue;
    const cur = invByCustomer.get(i.customerId) || { total: 0, count: 0 };
    cur.total += Number(i.totalIncl) || 0; cur.count += 1;
    invByCustomer.set(i.customerId, cur);
  }
  const list = db().customers.map((c) => {
    const mine = ordersByCustomer.get(c.id) || [];
    const inv = invByCustomer.get(c.id) || { total: 0, count: 0 };
    const last = mine.slice().sort((a, b) =>
      (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''))[0] || null;
    const activeCount = mine.filter((o) => !['afgerond', 'geannuleerd'].includes(o.status) && !o.archivedWeek).length;
    // Adressen die op de KAARTEN staan (intake per aanvraag) meegeven, zodat zoeken op
    // plaatsnaam/postcode óók werkt als het klantrecord zelf (nog) geen adres heeft —
    // heel gewoon bij WhatsApp/DRS-leads. Alleen voor het zoeken, niet voor weergave.
    const plaatsen = [...new Set(mine.map((o) => (o.intake && o.intake.address) || '').filter(Boolean))].join(' | ').slice(0, 300);
    return {
      ...c,
      searchPlaces: plaatsen,
      orderCount: mine.length,
      activeCount,
      invoicedTotal: Math.round(inv.total * 100) / 100,
      invoiceCount: inv.count,
      lastOrder: last ? {
        id: last.id, title: last.title, status: last.status,
        statusLabel: labels[last.status] || last.status,
        at: last.updatedAt || last.createdAt || '',
        appointmentAt: last.appointmentAt || null,
      } : null,
    };
  });
  // AVG: een monteur mag NIET de complete klantendatabase kunnen ophalen. Hij ziet
  // alleen klanten van zijn eigen opdrachten (genoeg om z'n eigen factuur te maken).
  if (req.user.role === 'monteur') {
    const mineIds = new Set(db().orders.filter((o) => o.monteurId && o.monteurId === req.user.monteurId).map((o) => o.customerId));
    return res.json(list.filter((c) => mineIds.has(c.id)));
  }
  res.json(list);
});

// VOLLEDIGE klanthistorie: alle gesprekken (kaart-threads, óók gearchiveerd/
// prullenbak) plus losse inbox-berichten die op harde identificatoren (écht
// WhatsApp-afzendernummer / e-mailadres) bij deze klant horen. Chronologisch,
// met kaart-label per bericht — zodat je in de kaart gewoon kunt terugscrollen
// door ALLES van deze klant.
app.get('/api/customers/:id/history', requireAuth, (req, res) => {
  const customer = db().customers.find((c) => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Klant niet gevonden' });
  // AVG: een monteur mag alleen de historie van klanten van zijn eigen opdrachten
  // zien. LET OP de o.monteurId-guard: zonder die matcht null === null en leest een
  // monteur-account zonder koppeling álles (zelfde patroon als GET /api/customers).
  if (req.user.role === 'monteur') {
    const mine = db().orders.some((o) => o.customerId === customer.id && o.monteurId && o.monteurId === req.user.monteurId);
    if (!mine) return res.status(403).json({ error: 'Geen toegang tot deze klant' });
  }
  const items = [];
  const seen = new Set(); // dedup: zelfde bericht op kaart én als los bericht
  const key = (channel, body) => `${channel}|${String(body || '').replace(/\s+/g, ' ').trim().slice(0, 180)}`;
  for (const o of [...(db().orders || []), ...(db().trash || [])]) {
    if (o.customerId !== customer.id) continue;
    for (const t of o.thread || []) {
      seen.add(key(t.channel, t.body));
      items.push({ ...t, orderId: o.id, orderTitle: o.title || '', orderStatus: o.status || '', standalone: false });
    }
  }
  // Losse inbox-berichten (nooit aan een kaart gehangen) op harde identiteit:
  // telefoon GENORMALISEERD exact (via het eigen klantnummer, o(1) — geen scan per
  // bericht over alle klanten) en e-mail EXACT (het hele adres, nooit includes():
  // "jan@x.nl" mag nooit de post van "marjan@x.nl" binnenhalen — Regel 2).
  const custEmail = String(customer.email || '').toLowerCase();
  const custPhoneNorm = matchPhone(customer.phone || '');
  const EMAIL_IN_SENDER = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  for (const m of db().messages || []) {
    if (m.skipped || m.bounce || !m.body) continue;
    let match = false;
    if (m.channel === 'whatsapp' && !m.group && custPhoneNorm.length >= 6) {
      const p = matchPhone(senderPhoneFromText(m.body));
      match = p.length >= 6 && p === custPhoneNorm;
    } else if (m.channel === 'email' && custEmail) {
      const em = ((String(m.sender || '').match(EMAIL_IN_SENDER) || [''])[0]).toLowerCase();
      match = !!em && em === custEmail;
    }
    if (!match || seen.has(key(m.channel, m.body))) continue;
    items.push({ id: m.id, channel: m.channel, sender: m.sender, subject: m.subject, body: m.body, at: m.receivedAt, attachments: m.attachments || [], standalone: true });
  }
  items.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  const limit = Math.min(500, Math.max(20, Number(req.query.limit) || 300));
  res.json({ customer: { id: customer.id, name: customer.name }, items: items.slice(-limit), total: items.length });
});

// KLANTDOSSIER: alles van één klant op één scherm — gegevens, alle kaarten (ook
// gearchiveerd), alle facturen/offertes en de omzet-totalen. Monteur alleen eigen.
app.get('/api/customers/:id/dossier', requireAuth, (req, res) => {
  const customer = db().customers.find((c) => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Klant niet gevonden' });
  if (req.user.role === 'monteur') {
    const mine = db().orders.some((o) => o.customerId === customer.id && o.monteurId && o.monteurId === req.user.monteurId);
    if (!mine) return res.status(403).json({ error: 'Geen toegang tot deze klant' });
  }
  const orders = (db().orders || []).filter((o) => o.customerId === customer.id)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .map((o) => ({ id: o.id, title: o.title, status: o.status, createdAt: o.createdAt, appointmentAt: o.appointmentAt, archivedWeek: o.archivedWeek || null, price: o.price || '' }));
  const invoices = (db().invoices || []).filter((i) => i.customerId === customer.id)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .map((i) => ({ id: i.id, number: i.number, type: i.type, status: i.status, totalIncl: i.totalIncl || 0, createdAt: i.createdAt, sentAt: i.sentAt || null }));
  const paid = invoices.filter((i) => i.type !== 'offerte' && i.status === 'betaald').reduce((s, i) => s + i.totalIncl, 0);
  const open = invoices.filter((i) => i.type !== 'offerte' && i.status === 'verzonden').reduce((s, i) => s + i.totalIncl, 0);
  // Laatste gesprekken (WhatsApp/e-mail) uit alle kaarten van deze klant — zodat je
  // in één oogopslag ziet wat er is besproken, zonder kaarten open te klikken.
  const berichten = [];
  for (const o of [...(db().orders || []), ...(db().trash || [])]) {
    if (o.customerId !== customer.id) continue;
    for (const t of o.thread || []) {
      if (t.channel === 'systeem') continue;
      berichten.push({
        at: t.at, channel: t.channel, outgoing: !!t.outgoing,
        sender: t.sender || '', subject: t.subject || '',
        body: String(t.body || '').replace(/\s+/g, ' ').slice(0, 180),
        orderId: o.id, orderTitle: o.title || '',
      });
    }
  }
  berichten.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const laatsteKlus = orders.find((o) => o.status === 'afgerond') || orders[0] || null;
  res.json({
    customer, orders, invoices,
    berichten: berichten.slice(0, 12),
    totals: {
      paid: Math.round(paid * 100) / 100,
      open: Math.round(open * 100) / 100,
      orders: orders.length,
      invoiceCount: invoices.filter((i) => i.type !== 'offerte').length,
      quoteCount: invoices.filter((i) => i.type === 'offerte').length,
      messageCount: berichten.length,
      lastJobAt: laatsteKlus ? (laatsteKlus.createdAt || '') : '',
      customerSince: customer.createdAt || '',
    },
  });
});

// AI-KLANTSAMENVATTING: vat alle kaarten, facturen en gesprekken van één klant samen
// in een paar zinnen (wie is dit, wat is er gedaan, wat staat er open, waar op letten).
// Resultaat wordt op het klantrecord gecachet (aiSummary) en gaat mee in het dossier.
app.post('/api/customers/:id/summary', requireAuth, async (req, res) => {
  const customer = db().customers.find((c) => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Klant niet gevonden' });
  if (req.user.role === 'monteur') {
    const mine = db().orders.some((o) => o.customerId === customer.id && o.monteurId && o.monteurId === req.user.monteurId);
    if (!mine) return res.status(403).json({ error: 'Geen toegang tot deze klant' });
  }
  const labels = getStatusLabels();
  const regels = [`KLANT: ${customer.name || 'onbekend'} · tel ${customer.phone || '-'} · ${customer.email || '-'} · ${customer.address || '-'} · klant sinds ${(customer.createdAt || '').slice(0, 10) || 'onbekend'}`];
  const orders = (db().orders || []).filter((o) => o.customerId === customer.id)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  for (const o of orders) {
    regels.push(`KAART #${o.id.slice(-6)} "${(o.title || '').slice(0, 70)}" status=${labels[o.status] || o.status} aangemaakt=${(o.createdAt || '').slice(0, 10)}${o.appointmentAt ? ` afspraak=${o.appointmentAt}` : ''}${o.price ? ` prijs=${o.price}` : ''}`);
    if (o.description) regels.push(`  omschrijving: ${String(o.description).replace(/\s+/g, ' ').slice(0, 220)}`);
    for (const t of (o.thread || []).slice(-15)) {
      if (t.channel === 'systeem') continue;
      regels.push(`  ${(t.at || '').slice(0, 16)} ${t.outgoing ? 'WIJ' : (t.sender || 'klant')}: ${String(t.body || '').replace(/\s+/g, ' ').slice(0, 220)}`);
    }
  }
  for (const i of (db().invoices || []).filter((i) => i.customerId === customer.id)) {
    regels.push(`${i.type === 'offerte' ? 'OFFERTE' : 'FACTUUR'} ${i.number} status=${i.status} bedrag=€${Number(i.totalIncl || 0).toFixed(2)} ${(i.createdAt || '').slice(0, 10)}`);
  }
  try {
    const out = await askAssistant({
      question: 'Vat deze klant samen in maximaal 6 korte zinnen voor een collega die de klant zo aan de telefoon krijgt: wie is het, wat hebben we gedaan (met welke afloop), wat staat er nu nog open (onbeantwoorde vragen, openstaande facturen/offertes, geplande afspraken) en waar moet je op letten. Geen opsomming van alle data — alleen de kern. Sluit af met één regel "Actie:" als er iets moet gebeuren, anders "Actie: geen".',
      messages: [], companyProfile: getCompanyProfile(), dashboard: regels.join('\n').slice(0, 60000),
    });
    if (out.engine === 'demo') return res.status(400).json({ error: 'AI staat niet aan (ANTHROPIC_API_KEY ontbreekt)' });
    customer.aiSummary = { text: out.text, at: now(), by: req.user.name };
    saveSoon();
    logActivity(req.user.name, 'AI-klantsamenvatting', customer.name || customer.id);
    res.json({ ok: true, summary: customer.aiSummary });
  } catch (err) { res.status(500).json({ error: 'Samenvatting mislukt: ' + err.message }); }
});

// SLIMME ZOEKBALK: één zoekveld over klanten, kaarten, facturen/offertes en berichten.
// Monteur ziet alleen eigen kaarten/klanten/facturen en géén losse inbox-berichten.
app.get('/api/search', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json({ customers: [], orders: [], invoices: [], messages: [] });
  const qDigits = q.replace(/[^\d]/g, '');
  const zoekTel = qDigits.length >= 6 ? qDigits.replace(/^(\+?31|0031)/, '0') : '';
  // Zonder-spaties-variant erbij, zodat een postcode als "3911AB" ook "3911 AB" vindt.
  const qStrip = q.replace(/\s+/g, '');
  const hit = (...velden) => velden.some((v) => {
    const h = String(v || '').toLowerCase();
    return h.includes(q) || h.replace(/\s+/g, '').includes(qStrip);
  });
  const telHit = (v) => !!zoekTel && String(v || '').replace(/[^\d]/g, '').replace(/^(31|0031)/, '0').includes(zoekTel);
  const monteur = req.user.role === 'monteur';
  const mijnKaart = (o) => !monteur || (o.monteurId && o.monteurId === req.user.monteurId);
  const maps = buildMaps();
  const labels = getStatusLabels();

  const mijnKlantIds = monteur
    ? new Set(db().orders.filter((o) => mijnKaart(o)).map((o) => o.customerId)) : null;
  // Adressen van de kaarten per klant: zoeken op plaats/postcode werkt ook als het
  // klantrecord zelf geen adres heeft (WhatsApp/DRS-leads).
  const adresPerKlant = new Map();
  for (const o of db().orders || []) {
    const a = (o.intake || {}).address;
    if (!o.customerId || !a) continue;
    adresPerKlant.set(o.customerId, `${adresPerKlant.get(o.customerId) || ''} ${a}`);
  }
  const customers = (db().customers || [])
    .filter((c) => (!mijnKlantIds || mijnKlantIds.has(c.id))
      && (hit(c.name, c.email, c.address, c.notes, adresPerKlant.get(c.id)) || telHit(c.phone)))
    .slice(0, 8).map((c) => ({ id: c.id, name: c.name || 'Onbekende klant', phone: c.phone || '', address: c.address || '' }));

  const orders = (db().orders || [])
    .filter((o) => mijnKaart(o) && (hit(o.title, o.description, (o.intake || {}).address, (maps.customers.get(o.customerId) || {}).name) || telHit((o.intake || {}).phone) || o.id.toLowerCase().endsWith(q)))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, 10).map((o) => ({ id: o.id, title: o.title || '', status: labels[o.status] || o.status, customer: (maps.customers.get(o.customerId) || {}).name || '', archived: !!o.archivedWeek, updatedAt: o.updatedAt || o.createdAt || '' }));

  const invoices = (db().invoices || [])
    .filter((i) => (!monteur || canTouchInvoice(req, i)) && (hit(i.number, (maps.customers.get(i.customerId) || {}).name)))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 8).map((i) => ({ id: i.id, number: i.number, type: i.type || 'factuur', status: i.status, totalIncl: i.totalIncl || 0, customer: (maps.customers.get(i.customerId) || {}).name || '' }));

  const messages = monteur ? [] : (db().messages || [])
    .filter((m) => !m.bounce && (hit(m.body, m.sender, m.subject, m.group) || telHit(m.body)))
    .sort((a, b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')))
    .slice(0, 8).map((m) => ({ id: m.id, at: m.receivedAt, sender: m.sender || '', group: m.group || '', channel: m.channel || '', snippet: String(m.body || '').replace(/\s+/g, ' ').slice(0, 110), full: String(m.body || '').slice(0, 2000) }));

  res.json({ customers, orders, invoices, messages });
});

// ---------- KLANTIMPORT (CSV / Excel) ----------
// Stap 1: bestand uploaden -> voorbeeld + automatisch herkende kolommen terug.
// Stap 2: importeren met de (eventueel aangepaste) kolomkeuze. Dedupe op de harde
// identificatoren (e-mail exact / telefoon genormaliseerd): bestaande klanten
// worden NOOIT overschreven — alleen lege velden aangevuld (Regel 3).
const _imports = new Map(); // importId -> { headers, rows, at } (kwartier geldig)
function pruneImports() { const cut = Date.now() - 15 * 60000; for (const [k, v] of _imports) if (v.at < cut) _imports.delete(k); }
function parseCsvBuffer(buf) {
  const text = buf.toString('utf8').replace(/^﻿/, '');
  const firstLine = text.slice(0, text.indexOf('\n') + 1 || text.length);
  const delim = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = []; let cell = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => String(c).trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); if (row.some((c) => String(c).trim())) rows.push(row); }
  return rows;
}
const IMPORT_FIELD_PATTERNS = {
  name: /^(naam|name|klant(naam)?|contact(persoon)?|full ?name|voor.*achternaam)/i,
  phone: /(telefoon|phone|^tel$|^tel\b|mobiel|gsm|mobile|06)/i,
  email: /mail/i,
  address: /(adres|address|straat|street)/i,
  postcode: /(postcode|zip|postal)/i,
  city: /(plaats|woonplaats|city|stad)/i,
  notes: /(notitie|opmerking|note|comment|memo)/i,
};
function guessMapping(headers, rows) {
  const mapping = {};
  headers.forEach((h, idx) => {
    for (const [field, re] of Object.entries(IMPORT_FIELD_PATTERNS)) {
      if (mapping[field] === undefined && re.test(String(h || '').trim())) { mapping[field] = idx; return; }
    }
  });
  // Inhoud-vangnet als de koppen niks zeggen: kolom vol e-mailadressen/06-nummers.
  const sample = rows.slice(0, 20);
  headers.forEach((h, idx) => {
    const vals = sample.map((r) => String(r[idx] || '').trim()).filter(Boolean);
    if (!vals.length) return;
    if (mapping.email === undefined && vals.filter((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)).length > vals.length / 2) mapping.email = idx;
    if (mapping.phone === undefined && vals.filter((v) => /^[+\d][\d\s()-]{7,}$/.test(v)).length > vals.length / 2) mapping.phone = idx;
  });
  return mapping;
}
app.post('/api/customers/import-preview', requirePerm('customers'), async (req, res) => {
  pruneImports();
  const parsed = await parseMultipartRaw(req, 15 * 1024 * 1024);
  if (!parsed.file) return res.status(400).json({ error: 'Geen bestand ontvangen. Kies een .csv- of Excel-bestand.' });
  let rows = [];
  try {
    if (/\.(xlsx|xls|ods)$/i.test(parsed.filename) || /spreadsheet|excel|officedocument/.test(parsed.mime)) {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(parsed.file, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
        .map((r) => r.map((c) => String(c ?? '').trim()))
        .filter((r) => r.some((c) => c));
    } else {
      rows = parseCsvBuffer(parsed.file);
    }
  } catch (e) {
    return res.status(400).json({ error: 'Bestand niet leesbaar als CSV/Excel: ' + e.message });
  }
  if (rows.length < 2) return res.status(400).json({ error: 'Te weinig rijen gevonden (verwacht: een kop-rij + klanten).' });
  if (rows.length > 5001) return res.status(400).json({ error: `Te veel rijen (${rows.length - 1}). Splits het bestand op in delen van max 5000 klanten.` });
  const headers = rows[0].map((h) => String(h || '').trim());
  const dataRows = rows.slice(1);
  const importId = id('imp');
  _imports.set(importId, { headers, rows: dataRows, at: Date.now() });
  res.json({ importId, headers, sample: dataRows.slice(0, 5), total: dataRows.length, mapping: guessMapping(headers, dataRows) });
});
app.post('/api/customers/import', requirePerm('customers'), (req, res) => {
  pruneImports();
  const st = _imports.get(String(req.body?.importId || ''));
  if (!st) return res.status(400).json({ error: 'Upload verlopen — kies het bestand opnieuw.' });
  const map = req.body?.mapping || {};
  const col = (r, f) => { const i = Number(map[f]); return Number.isInteger(i) && i >= 0 ? String(r[i] || '').trim() : ''; };
  if (!Object.values(map).some((v) => Number.isInteger(Number(v)) && Number(v) >= 0)) {
    return res.status(400).json({ error: 'Kies minimaal één kolom (bv. Naam).' });
  }
  let added = 0; let filled = 0; let dup = 0; let empty = 0;
  for (const r of st.rows) {
    const name = col(r, 'name');
    const phone = col(r, 'phone');
    const email = col(r, 'email').toLowerCase();
    const address = [col(r, 'address'), [col(r, 'postcode'), col(r, 'city')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const notes = col(r, 'notes');
    if (!name && !phone && !email) { empty++; continue; }
    const existing = findCustomerStrong({ phone, email });
    if (existing) {
      // Nooit overschrijven — alleen gaten aanvullen (Regel 3).
      let touched = false;
      if (!existing.phone && phone) { existing.phone = phone; touched = true; }
      if (!existing.email && email) { existing.email = email; touched = true; }
      if (!existing.address && address) { existing.address = address; touched = true; }
      if (!existing.notes && notes) { existing.notes = notes; touched = true; }
      if (touched) filled++; else dup++;
      continue;
    }
    db().customers.push({
      id: id('cust'), name: name || 'Onbekende klant', phone, email, address,
      type: 'klant', source: 'import', notes, createdAt: now(),
    });
    added++;
  }
  _imports.delete(String(req.body.importId));
  save();
  logActivity(req.user.name, 'klanten geïmporteerd', `${added} nieuw, ${filled} aangevuld, ${dup} dubbel, ${empty} leeg overgeslagen`);
  res.json({ ok: true, added, filled, dup, empty, total: st.rows.length });
});
// Eén ruw bestand uit een multipart-upload lezen (voor de klantimport).
function parseMultipartRaw(req, maxBytes) {
  return new Promise((resolve) => {
    const out = { file: null, filename: '', mime: '' };
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(out); } };
    let bb;
    try { bb = Busboy({ headers: req.headers, limits: { files: 1, fields: 5, fileSize: maxBytes } }); }
    catch { return resolve(out); }
    bb.on('file', (fname, stream, info) => {
      out.filename = (info && info.filename) || '';
      out.mime = String((info && info.mimeType) || '').toLowerCase();
      const chunks = [];
      let truncated = false;
      stream.on('data', (c) => chunks.push(c));
      stream.on('limit', () => { truncated = true; });
      stream.on('end', () => { out.file = truncated ? null : Buffer.concat(chunks); });
    });
    bb.on('finish', finish);
    bb.on('error', finish);
    req.pipe(bb);
  });
}

app.post('/api/customers', requirePerm('customers'), (req, res) => {
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

app.patch('/api/customers/:id', requirePerm('customers'), (req, res) => {
  const c = db().customers.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Niet gevonden' });
  for (const k of ['name', 'phone', 'email', 'address', 'type', 'notes']) {
    if (k in (req.body || {})) c[k] = req.body[k];
  }
  if ('campaignOptOut' in (req.body || {})) c.campaignOptOut = !!req.body.campaignOptOut;
  saveSoon();
  res.json(c);
});

// ---------- E-MAILCAMPAGNE (klantselectie -> mailing) ----------
// De assistente kiest klanten, schrijft één bericht ({naam} wordt ingevuld) en het
// CRM verstuurt netjes met tussenpozen. Klanten zonder e-mail of met "geen mails"
// worden overgeslagen; elk adres max 1x per campagne-aanroep; nette afmeld-voet.
const CAMPAIGN_FOOTER = '\n\nU ontvangt deze e-mail als klant van Key Service 24/7. Liever geen e-mails meer ontvangen? Antwoord dan met "afmelden".';
app.post('/api/campaign/send', requireRole('admin', 'assistent'), async (req, res) => {
  if (!smtpConfigured()) return res.status(503).json({ error: 'E-mail versturen (SMTP) is nog niet ingesteld.' });
  const subj = String(req.body?.subject || '').trim().slice(0, 200);
  const tpl = String(req.body?.body || '').trim().slice(0, 8000);
  if (!subj || !tpl) return res.status(400).json({ error: 'Vul onderwerp en bericht in.' });
  const testTo = String(req.body?.test || '').trim();
  if (testTo) {
    try {
      await sendMail({ to: testTo, subject: `[TEST] ${subj}`, text: tpl.replace(/\{naam\}/g, 'Voorbeeldklant') + CAMPAIGN_FOOTER });
      return res.json({ ok: true, test: true });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }
  const ids = Array.isArray(req.body?.customerIds) ? req.body.customerIds.slice(0, 100) : [];
  if (!ids.length) return res.status(400).json({ error: 'Geen klanten geselecteerd.' });
  let sent = 0; let skipped = 0; const failed = [];
  const seenAddr = new Set();
  for (const cid of ids) {
    const c = db().customers.find((x) => x.id === cid);
    const em = String(c?.email || '').toLowerCase().trim();
    if (!c || !em || c.campaignOptOut || seenAddr.has(em)) { skipped++; continue; }
    seenAddr.add(em);
    try {
      await sendMail({ to: c.email, subject: subj, text: tpl.replace(/\{naam\}/g, c.name || 'klant') + CAMPAIGN_FOOTER });
      c.lastCampaignAt = now();
      sent++;
    } catch (e) { failed.push({ name: c.name || '', error: String(e.message || '').slice(0, 100) }); }
    await new Promise((r) => setTimeout(r, 400)); // nette verzendsnelheid (geen spam-gedrag)
  }
  db().campaigns = Array.isArray(db().campaigns) ? db().campaigns : [];
  db().campaigns.unshift({ id: id('cmp'), subject: subj, at: now(), by: req.user.name, sent, failed: failed.length, skipped });
  db().campaigns = db().campaigns.slice(0, 50);
  logActivity(req.user.name, 'campagne-mail verstuurd', `"${subj}" — ${sent} verstuurd, ${skipped} overgeslagen, ${failed.length} mislukt`);
  saveSoon();
  res.json({ ok: true, sent, skipped, failed });
});

app.delete('/api/customers/:id', requirePerm('customers'), (req, res) => {
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
app.get('/api/customers/duplicates', requirePerm('customers'), (req, res) => {
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
app.post('/api/customers/merge', requirePerm('customers'), (req, res) => {
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
  const labels = getStatusLabels();
  const now2 = Date.now();
  // Opdrachten ÉÉN keer groeperen per monteur (O(n)) i.p.v. per monteur de hele
  // lijst meerdere keren doorzoeken (O(n²)).
  const byMonteur = new Map();
  const sentByMonteur = new Map();
  for (const o of db().orders) {
    if (o.monteurId && !o.archivedWeek) { const a = byMonteur.get(o.monteurId) || []; a.push(o); byMonteur.set(o.monteurId, a); }
    if (o.sentToMonteur && o.sentToMonteur.monteurId) sentByMonteur.set(o.sentToMonteur.monteurId, (sentByMonteur.get(o.sentToMonteur.monteurId) || 0) + 1);
  }
  res.json(db().monteurs.map((m) => {
    const mine = byMonteur.get(m.id) || [];
    const active = mine.filter((o) => !['afgerond', 'geannuleerd'].includes(o.status));
    const upcoming = mine
      .filter((o) => o.appointmentAt && new Date(o.appointmentAt).getTime() >= now2 - 12 * 3600 * 1000 && !['afgerond', 'geannuleerd'].includes(o.status))
      .sort((a, b) => new Date(a.appointmentAt) - new Date(b.appointmentAt))
      .map((o) => ({ id: o.id, title: o.title, at: o.appointmentAt, status: o.status, statusLabel: labels[o.status] || o.status }));
    const sentCount = sentByMonteur.get(m.id) || 0;
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

// Alle opdrachten van één monteur, opgesplitst in actief / verstuurd / afgerond
// (inclusief ingeklapte/afgeronde historie). Voor de klikbare pillen op de
// monteur-kaart. Monteurs zien alleen hun eigen lijst.
app.get('/api/monteurs/:id/orders', requireAuth, (req, res) => {
  const mId = req.params.id;
  if (req.user.role === 'monteur' && req.user.monteurId !== mId) return res.status(403).json({ error: 'Geen toegang' });
  const labels = getStatusLabels();
  const summarize = (o) => {
    const c = db().customers.find((x) => x.id === o.customerId) || {};
    return {
      id: o.id, title: o.title, status: o.status, statusLabel: labels[o.status] || o.status,
      appointmentAt: o.appointmentAt || null, customer: c.name || '', address: c.address || '',
      archived: !!o.archivedWeek, updatedAt: o.updatedAt || o.createdAt || '',
    };
  };
  const mine = db().orders.filter((o) => o.monteurId === mId);
  const active = mine.filter((o) => !o.archivedWeek && !['afgerond', 'geannuleerd'].includes(o.status));
  const done = mine.filter((o) => o.status === 'afgerond');
  // "verstuurd naar monteur" — gemarkeerd via sentToMonteur, ongeacht status/archief.
  const sent = db().orders.filter((o) => o.sentToMonteur && o.sentToMonteur.monteurId === mId);
  const bydate = (a, b) => (b.appointmentAt || b.updatedAt || '').localeCompare(a.appointmentAt || a.updatedAt || '');
  res.json({
    active: active.map(summarize).sort(bydate),
    sent: sent.map(summarize).sort(bydate),
    done: done.map(summarize).sort(bydate),
  });
});

app.post('/api/monteurs', requirePerm('customers'), (req, res) => {
  const { name, phone, email, waGroup } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Naam verplicht' });
  const m = { id: id('mont'), name, phone: phone || '', email: email || '', waGroup: waGroup || '', calendarId: '', reviewAuto: true, createdAt: now() };
  db().monteurs.push(m);
  logActivity(req.user.name, 'monteur toegevoegd', name);
  saveSoon();
  res.json(m);
});

app.patch('/api/monteurs/:id', requirePerm('customers'), (req, res) => {
  const m = db().monteurs.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'Niet gevonden' });
  for (const k of ['name', 'phone', 'email', 'waGroup', 'calendarId']) if (k in (req.body || {})) m[k] = req.body[k];
  if ('reviewAuto' in (req.body || {})) m.reviewAuto = !!req.body.reviewAuto; // automatische review per monteur
  saveSoon();
  res.json(m);
});

app.delete('/api/monteurs/:id', requirePerm('customers'), (req, res) => {
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
  // Eerst filteren op de RAUWE opdrachten (goedkoop), pas daarna de klant/monteur
  // koppelen — en dat met snelle maps i.p.v. per opdracht de lijst doorzoeken.
  let raw = db().orders;
  if (req.user.role === 'monteur') raw = raw.filter((o) => o.monteurId && o.monteurId === req.user.monteurId);
  if (req.query.archivedWeek) raw = raw.filter((o) => o.archivedWeek?.key === req.query.archivedWeek);
  else if (req.query.includeArchived !== '1') raw = raw.filter((o) => !o.archivedWeek);
  if (req.query.status) raw = raw.filter((o) => o.status === req.query.status);
  if (req.query.monteurId) raw = raw.filter((o) => o.monteurId === req.query.monteurId);
  const maps = buildMaps();
  const list = raw.map((o) => withRelations(o, maps));
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
// Schijfruimte-overzicht: wat neemt hoeveel in op de datamap (bijlages, back-ups,
// database) en hoeveel is er nog vrij. Zo zie je in één oogopslag waarom de schijf
// volloopt — en of opruimen of vergroten (Render-dashboard → Disks) nodig is.
app.get('/api/disk-usage', requireRole('admin'), (req, res) => {
  const DATA = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  const dirSize = (dir) => {
    let bytes = 0; let count = 0;
    try {
      for (const f of fs.readdirSync(dir)) {
        try { const st = fs.statSync(path.join(dir, f)); if (st.isFile()) { bytes += st.size; count++; } } catch { /* overslaan */ }
      }
    } catch { /* map bestaat niet */ }
    return { mb: Math.round(bytes / 1048576 * 10) / 10, count };
  };
  const uploads = dirSize(path.join(DATA, 'uploads'));
  const backups = dirSize(path.join(DATA, 'backups'));
  let dbMb = 0; try { dbMb = Math.round(fs.statSync(path.join(DATA, 'db.json')).size / 1048576 * 10) / 10; } catch { /* leeg */ }
  let sqliteMb = 0; try { sqliteMb = Math.round(fs.statSync(path.join(DATA, 'db.sqlite')).size / 1048576 * 10) / 10; } catch { /* nog geen sqlite */ }
  let freeMb = null; try { const st = fs.statfsSync(DATA); freeMb = Math.round((st.bavail * st.bsize) / 1048576); } catch { /* niet ondersteund */ }
  res.json({ uploads, backups, dbMb, sqliteMb, storage: storageEngine(), freeMb, cleanup: getAttachmentCleanup() });
});
// ---------- Bijlagen beheren (foto's/video's makkelijk opruimen) ----------
// Alle bijlages van kaarten (ook prullenbak) + losse inbox-berichten op één rij,
// zodat je zelf kunt kiezen wat weg mag i.p.v. te wachten op de automatische
// opschoning (die alleen afgeronde/geannuleerde klussen ouder dan X dagen pakt).
// Werkbon-handtekeningen worden NOOIT getoond/verwijderbaar gemaakt.
app.get('/api/attachments/browse', requireRole('admin', 'assistent'), (req, res) => {
  const protectedIds = new Set();
  for (const o of [...(db().orders || []), ...(db().trash || [])]) {
    const sigId = o.werkbon && o.werkbon.signatureAttachmentId;
    if (sigId) protectedIds.add(sigId);
  }
  const items = [];
  for (const o of [...(db().orders || []), ...(db().trash || [])]) {
    for (const a of o.attachments || []) {
      if (protectedIds.has(a.id)) continue;
      items.push({ id: a.id, url: a.url, filename: a.filename, mime: a.mime, kind: a.kind, size: a.size || 0, at: a.at || o.createdAt, orderId: o.id, orderTitle: o.title || '', orderStatus: o.status || '', trashed: !!o.trashedAt, source: 'order' });
    }
    for (const t of o.thread || []) {
      for (const a of t.attachments || []) {
        if (protectedIds.has(a.id)) continue;
        items.push({ id: a.id, url: a.url, filename: a.filename, mime: a.mime, kind: a.kind, size: a.size || 0, at: a.at || t.at, orderId: o.id, orderTitle: o.title || '', orderStatus: o.status || '', trashed: !!o.trashedAt, source: 'thread', threadId: t.id });
      }
    }
  }
  for (const m of db().messages || []) {
    for (const a of m.attachments || []) {
      items.push({ id: a.id, url: a.url, filename: a.filename, mime: a.mime, kind: a.kind, size: a.size || 0, at: a.at || m.receivedAt, messageId: m.id, orderTitle: '(los bericht, geen kaart)', source: 'message' });
    }
  }
  res.json({ items, totalBytes: items.reduce((s, x) => s + (x.size || 0), 0) });
});

// Bulk verwijderen: elk item is {id, orderId?, threadId?, messageId?} — precies
// zoals teruggegeven door /browse. Best-effort per item (één kapotte referentie
// mag de rest niet blokkeren); geeft terug hoeveel bytes zijn vrijgemaakt.
app.post('/api/attachments/bulk-delete', requireRole('admin', 'assistent'), (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 2000) : [];
  // Zelfde bescherming als /browse: een werkbon-handtekening mag NOOIT weg, ook
  // niet als een verkeerd/verouderd item-id wordt meegestuurd.
  const protectedIds = new Set();
  for (const o of [...(db().orders || []), ...(db().trash || [])]) {
    const sigId = o.werkbon && o.werkbon.signatureAttachmentId;
    if (sigId) protectedIds.add(sigId);
  }
  let removed = 0; let freedBytes = 0;
  const stripFrom = (list, attId) => {
    if (!Array.isArray(list) || protectedIds.has(attId)) return list;
    const idx = list.findIndex((a) => a.id === attId);
    if (idx === -1) return list;
    const [a] = list.splice(idx, 1);
    try { deleteFile(a.file); } catch { /* bestand al weg */ }
    freedBytes += a.size || 0;
    removed++;
    return list;
  };
  for (const it of items) {
    try {
      if (it.messageId) {
        const m = db().messages.find((x) => x.id === it.messageId);
        if (m) m.attachments = stripFrom(m.attachments, it.id);
        continue;
      }
      if (!it.orderId) continue;
      const o = db().orders.find((x) => x.id === it.orderId) || db().trash.find((x) => x.id === it.orderId);
      if (!o) continue;
      if (it.threadId) {
        const t = (o.thread || []).find((x) => x.id === it.threadId);
        if (t) t.attachments = stripFrom(t.attachments, it.id);
      } else {
        o.attachments = stripFrom(o.attachments, it.id);
      }
    } catch (e) { console.error('[bijlage-verwijderen]', e.message); }
  }
  if (removed) {
    logActivity(req.user.name, 'bijlages opgeruimd', `${removed} bestand(en), ${(freedBytes / 1048576).toFixed(1)} MB vrijgemaakt`);
    saveSoon();
  }
  res.json({ ok: true, removed, freedBytes });
});

// Extra back-ups opruimen (houd de N nieuwste). Handmatige noodrem als de schijf
// vol raakt; de automatische prune (KEEP_BACKUPS) blijft gewoon bestaan.
app.post('/api/backups/prune', requireRole('admin'), (req, res) => {
  const keep = Math.max(3, Math.min(30, Number(req.body?.keep) || 5));
  const DATA = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  const dir = path.join(DATA, 'backups');
  let removed = 0;
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const x of files.slice(keep)) { try { fs.unlinkSync(path.join(dir, x.f)); removed++; } catch { /* overslaan */ } }
  } catch { /* map bestaat niet */ }
  logActivity(req.user.name, 'back-ups opgeruimd', `${removed} verwijderd (nieuwste ${keep} bewaard)`);
  res.json({ ok: true, removed, kept: keep });
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
  snapshotJson(); // verse, volledige JSON-kopie (ook wanneer de opslag SQLite is)
  const stamp = new Date().toISOString().slice(0, 10);
  res.download(dbFilePath(), `keyservice-backup-${stamp}.json`);
});
// Een back-up terugzetten (alleen beheerder). Zet eerst de huidige stand veilig weg.
app.post('/api/backup/restore', requireRole('admin'), (req, res) => {
  const name = String(req.body?.name || '');
  const r = restoreBackup(name);
  if (r.error) return res.status(400).json({ error: r.error });
  logActivity(req.user.name, 'back-up teruggezet', `${name} — ${r.customers} klanten, ${r.orders} opdrachten`);
  res.json(r);
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
app.post('/api/archives/collapse', requirePerm('orders'), (req, res) => {
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
app.post('/api/archives/uncollapse', requirePerm('orders'), (req, res) => {
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
app.delete('/api/orders/:id/thread/:threadId', requirePerm('orders'), (req, res) => {
  const order = db().orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Niet gevonden' });
  order.thread = (order.thread || []).filter((t) => t.id !== req.params.threadId);
  order.updatedAt = now();
  saveSoon();
  res.json(withRelations(order));
});

app.post('/api/orders', requirePerm('orders'), (req, res) => {
  const b = req.body || {};
  let customerId = b.customerId;
  if (!customerId && (b.customerName || b.customerPhone || b.customerEmail)) {
    const { customer } = upsertCustomer({
      name: b.customerName, phone: b.customerPhone, email: b.customerEmail, address: b.customerAddress, source: 'handmatig',
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
    appointmentEndAt: b.appointmentEndAt || null,
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
  if (order.appointmentAt) {
    syncOrderToGoogle(order); // best-effort, niet awaiten
    maybeSendAppointmentConfirm(order).catch(() => {});
  }
  res.json(withRelations(order));
});

app.patch('/api/orders/:id', requireAuth, (req, res) => {
  const order = db().orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Niet gevonden' });
  if (!canTouchOrder(req, order)) return res.status(403).json({ error: 'Alleen je eigen opdrachten' });
  const b = req.body || {};

  // Monteurs mogen alleen status, afspraak en notities aanpassen.
  const allowed = req.user.role === 'monteur'
    ? ['status', 'appointmentAt', 'appointmentEndAt', 'notes']
    : ['title', 'description', 'status', 'source', 'customerId', 'monteurId', 'appointmentAt', 'appointmentEndAt', 'price', 'urgent', 'notes', 'snoozeAt'];

  if (b.status && !isValidStatus(b.status)) return res.status(400).json({ error: 'Ongeldige status' });

  // MENSELIJKE CORRECTIE = hoogste waarheid: worden de klantgegevens op de kaart
  // bewerkt, dan werkt dat óók order.intake bij (de kaart-eigen gegevens waar de
  // monteur-dispatch mee wordt opgebouwd). Anders ging een verbeterde kaart alsnog
  // met de oude AI-extractie ("Klant: U") naar de monteur.
  if (req.user.role !== 'monteur' && b.intake && typeof b.intake === 'object') {
    order.intake = {
      name: String(b.intake.name || '').slice(0, 120).trim(),
      phone: String(b.intake.phone || '').slice(0, 40).trim(),
      email: String(b.intake.email || '').slice(0, 120).trim(),
      address: String(b.intake.address || '').slice(0, 200).trim(),
    };
  }

  // Verplichte notitie: een monteur moet eerst een notitie/omschrijving invullen voordat
  // hij een opdracht naar Offerte verzonden, Afgerond of Geannuleerd verplaatst.
  const NOTE_REQUIRED_STATUSES = ['offerte_verzonden', 'afgerond', 'geannuleerd'];
  if (req.user.role === 'monteur' && b.status && b.status !== order.status && NOTE_REQUIRED_STATUSES.includes(b.status)) {
    const noteAfter = (('notes' in b ? b.notes : order.notes) || '').trim();
    if (!noteAfter) return res.status(400).json({ error: 'Vul eerst een notitie/omschrijving in (wat is er gedaan/afgesproken) voordat je de opdracht op deze status zet.' });
  }

  const prevAppt = order.appointmentAt; // om wijziging/annulering van de afspraak te herkennen
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

  // Een nieuwe herinnering zetten haalt de "opvolgen"-vlag weg.
  if ('snoozeAt' in b) order.snoozeDue = false;
  order.updatedAt = now();
  if (changedStatus) {
    logActivity(req.user.name, 'status gewijzigd', `${order.title} → ${getStatusLabels()[order.status] || order.status}`);
    if (order.status === 'afgerond' && !order.completedAt) order.completedAt = now();
    // Terugkoppeling voor DRS-opdrachten via de controle-groep (bv. Abdel).
    maybeSendTerugkoppeling(order);
  }
  // Auto-versturen naar monteur bij het inplannen van een afspraak (indien ingesteld).
  if ('appointmentAt' in b && b.appointmentAt) {
    maybeAutoSendToMonteur(order, 'appointment');
    // Nieuwe of gewijzigde afspraak -> bevestiging met (nieuwe) datum naar de klant.
    // maybeSendAppointmentConfirm stuurt opnieuw zodra de datum/tijd verandert.
    maybeSendAppointmentConfirm(order).catch(() => {});
  }
  // Afspraak weggehaald (geannuleerd): event verdwijnt via de Google-sync hieronder en
  // uit de CRM-agenda; klant krijgt (indien gevraagd) een annuleringsbericht.
  if ('appointmentAt' in b && !b.appointmentAt && prevAppt) {
    maybeSendAppointmentCancel(order, prevAppt, { notify: !!b.notifyCustomer }).catch(() => {});
  }
  saveSoon();
  // Google Agenda bijwerken zodra afspraak/monteur/status wijzigt (maakt, verplaatst,
  // of verwijdert het event). Best-effort — niet awaiten.
  if ('appointmentAt' in b || 'appointmentEndAt' in b || 'monteurId' in b || 'status' in b) syncOrderToGoogle(order);
  res.json(withRelations(order));
});

// Meerdere opdrachten samenvoegen tot één (zelfde klant, dubbele kaarten).
// De 'primaire' opdracht behoudt alles; de rest gaat erin op (historie + foto's).
app.post('/api/orders/merge', requirePerm('orders'), (req, res) => {
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
app.delete('/api/orders/:id', requirePerm('deleteOrders'), (req, res) => {
  const orders = db().orders;
  const i = orders.findIndex((o) => o.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Niet gevonden' });
  const [removed] = orders.splice(i, 1);
  removed.deletedAt = now();
  removed.deletedBy = req.user.name;
  if (removed.googleEvent) removeOrderFromGoogle(removed); // event uit Google halen
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
app.get('/api/trash', requirePerm('deleteOrders'), (req, res) => {
  res.json(db().trash.map(withRelations));
});

// Opdracht terughalen uit de prullenbak
app.post('/api/trash/:id/restore', requirePerm('deleteOrders'), (req, res) => {
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
app.delete('/api/trash/:id', requirePerm('hardDelete'), (req, res) => {
  const i = db().trash.findIndex((o) => o.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Niet gevonden' });
  const [order] = db().trash.splice(i, 1);
  (order.attachments || []).forEach((a) => deleteFile(a.file));
  logActivity(req.user.name, 'opdracht definitief verwijderd', order.title);
  saveSoon();
  res.json({ ok: true });
});

// Prullenbak helemaal legen (alleen admin)
app.post('/api/trash/empty', requirePerm('hardDelete'), (req, res) => {
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
  if (order.snoozeDue) { order.snoozeDue = false; changed = true; } // opvolg-vlag gezien
  if (changed) saveSoon();
  res.json({ ok: true });
});

// Bijlage handmatig toevoegen aan een opdracht (foto/video/document).
// Verwacht JSON: { filename, mime, dataBase64 }.
app.post('/api/orders/:id/attachments', requireAuth, (req, res) => {
  const order = db().orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Niet gevonden' });
  if (!canTouchOrder(req, order)) return res.status(403).json({ error: 'Alleen je eigen opdrachten' });
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
app.delete('/api/orders/:id/attachments/:attId', requirePerm('orders'), (req, res) => {
  const order = db().orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Niet gevonden' });
  const att = (order.attachments || []).find((a) => a.id === req.params.attId);
  if (att) { deleteFile(att.file); order.attachments = order.attachments.filter((a) => a.id !== req.params.attId); order.updatedAt = now(); saveSoon(); }
  res.json(withRelations(order));
});

// ---------- Inbox / AI-controlewachtrij ----------
app.get('/api/reviews', requireAuth, (req, res) => {
  const status = req.query.status || 'pending';
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 150));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  // Snelle O(1)-opzoeking van berichten (voorheen O(n²) -> traag bij veel berichten).
  const msgById = new Map(db().messages.map((m) => [m.id, m]));
  const all = db().reviews
    .filter((r) => (status === 'all' ? true : r.status === status))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  // KLANT-HINT: laat op elk inbox-item zien of de afzender een BEKENDE klant is
  // (harde identificatoren: écht WhatsApp-afzendernummer, écht e-mailadres, of de
  // geëxtraheerde contactgegevens) en of die klant een open kaart heeft. Zo hoeft
  // niemand meer zelf uit te zoeken "wie is dit?" bij bv. een annulering.
  const knownCustomerFor = (r, m) => {
    try {
      let c = null;
      if (m && m.channel === 'whatsapp' && !m.group) {
        const p = senderPhoneFromText(m.body);
        if (p) c = findCustomerStrong({ phone: p });
      } else if (m && m.channel === 'email') {
        const em = (String(m.sender || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [''])[0];
        if (em) c = findCustomerStrong({ email: em });
      }
      if (!c && r.suggestion) c = findCustomerStrong({ phone: r.suggestion.customerPhone, email: r.suggestion.customerEmail });
      if (!c) return null;
      const open = db().orders.find((o) => o.customerId === c.id && !o.archivedWeek && !['afgerond', 'geannuleerd'].includes(o.status));
      return { id: c.id, name: c.name || '', openOrderId: open ? open.id : null, openOrderTitle: open ? open.title : '' };
    } catch { return null; }
  };
  const items = all.slice(offset, offset + limit).map((r) => {
    const m = msgById.get(r.messageId) || null;
    return { ...r, message: m, knownCustomer: r.status === 'pending' || r.status === 'overige' ? knownCustomerFor(r, m) : null };
  });
  res.json({ items, total: all.length, offset, limit });
});

app.post('/api/reviews/:id/approve', requirePerm('inbox'), (req, res) => {
  const review = db().reviews.find((r) => r.id === req.params.id);
  if (!review) return res.status(404).json({ error: 'Niet gevonden' });
  if (!['pending', 'overige'].includes(review.status)) return res.status(400).json({ error: 'Al verwerkt' });
  const order = applyReview(review, { actorName: req.user.name, overrides: req.body || {} });
  maybeAutoSendToMonteur(order, 'approved');
  // Vangnet: is er bij binnenkomst geen ontvangstbevestiging gestuurd, doe het nu alsnog.
  maybeSendConfirmationOnApprove(order, review).catch(() => {});
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
  if (!cfg.autoEnabled) { console.log(`[autosend] uit — automatisch versturen staat niet aan (${order.title})`); return; }
  if (cfg.trigger !== event) { console.log(`[autosend] trigger '${cfg.trigger}' != gebeurtenis '${event}' — overgeslagen (${order.title})`); return; }
  if (cfg.onlyDrs !== false && !isDrsOrder(order)) { console.log(`[autosend] geen DRS-opdracht — overgeslagen (${order.title})`); return; }
  if (order.sentToMonteur) { console.log(`[autosend] al verstuurd — overgeslagen (${order.title})`); return; }
  if (!autoSendAllowedToday()) { console.log(`[autosend] vandaag niet ingeschakeld (dag staat uit) — overgeslagen (${order.title})`); return; }
  // Trefwoord-routering (bv. "schuifpui" -> Abdel) gaat vóór de standaardmonteur.
  const routed = routeMonteurForOrder(order);
  const monteur = routed || db().monteurs.find((m) => m.id === (cfg.autoMonteurId || order.monteurId));
  if (!monteur) { console.log(`[autosend] geen monteur gekozen (autoMonteurId leeg?) — overgeslagen (${order.title})`); return; }
  if (!monteur.waGroup) { console.log(`[autosend] monteur ${monteur.name} heeft geen WhatsApp-groep — overgeslagen (${order.title})`); return; }
  if (!order.monteurId) order.monteurId = monteur.id;
  const r = queueToMonteur(order, monteur, 'automatisch');
  if (!r.error) { console.log(`[autosend] in wachtrij -> ${monteur.name} (${monteur.waGroup})`); logActivity('systeem', 'automatisch naar monteur', `${order.title} -> ${monteur.name}`); saveSoon(); }
  else console.log('[autosend] queueToMonteur fout:', r.error);
}

// Kiest op basis van trefwoorden in titel/omschrijving een specifieke monteur-groep.
// Bv. een regel { keyword: "schuifpui", monteurId: <Abdel> } stuurt schuifpui-
// opdrachten naar Abdel i.p.v. de standaardmonteur. Geeft null als niets matcht.
function routeMonteurForOrder(order) {
  const cfg = db().settings.monteurDispatch || {};
  const routes = Array.isArray(cfg.keywordRoutes) ? cfg.keywordRoutes : [];
  if (!routes.length) return null;
  const hay = `${order.title || ''} ${order.description || ''}`.toLowerCase();
  for (const r of routes) {
    const kw = String(r.keyword || '').toLowerCase().trim();
    if (kw && r.monteurId && hay.includes(kw)) {
      const m = db().monteurs.find((x) => x.id === r.monteurId);
      if (m && m.waGroup) return m;
    }
  }
  return null;
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
  // Trefwoord-routering (bv. schuifpui -> Abdel) gaat vóór de standaardmonteur.
  const target = routeMonteurForOrder(order) || monteur;
  if (!target.waGroup) { console.log('[intake] doelmonteur heeft geen WhatsApp-groep'); return; }
  if (!order.monteurId) order.monteurId = target.id;
  const r = queueToMonteur(order, target, 'volautomatisch');
  if (!r.error) { console.log(`[intake] volautomatisch in wachtrij -> ${target.name} (${target.waGroup})`); logActivity('systeem', 'volautomatisch naar monteur', `${order.title} -> ${target.name}`); }
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

app.post('/api/reviews/:id/reject', requirePerm('inbox'), (req, res) => {
  const review = db().reviews.find((r) => r.id === req.params.id);
  if (!review) return res.status(404).json({ error: 'Niet gevonden' });
  if (!['pending', 'overige'].includes(review.status)) return res.status(400).json({ error: 'Al verwerkt' });
  rejectReview(review, req.user, req.body || {});
  logActivity(req.user.name, 'review afgewezen', `${review.suggestion?.title || ''}${req.body?.reason ? ' — ' + req.body.reason : ''}`);
  saveSoon();
  res.json({ review });
});

// BULK afwijzen: meerdere ids tegelijk, of alle 'overige' (geklets), of alle pending.
app.post('/api/reviews/bulk-reject', requirePerm('inbox'), (req, res) => {
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
app.post('/api/reviews/bulk-approve', requirePerm('inbox'), (req, res) => {
  const _mc = Number(req.body?.minConfidence); const minPct = Math.max(0, Math.min(100, Number.isFinite(_mc) ? _mc : 80));
  const min = minPct / 100;
  const targets = db().reviews.filter((r) => r.status === 'pending' && !r.suggestion?.aiNotOrder && (r.suggestion?.confidence || 0) >= min);
  let count = 0;
  for (const r of targets) {
    try {
      const order = applyReview(r, { actorName: `${req.user.name} (bulk >=${minPct}%)` }); count++;
      maybeSendConfirmationOnApprove(order, r).catch(() => {}); // vangnet-bevestiging
    } catch { /* skip */ }
  }
  logActivity(req.user.name, 'bulk goedgekeurd', `${count} berichten met AI-zekerheid >= ${minPct}%`);
  saveSoon();
  res.json({ ok: true, count, minPct });
});

// OPSCHONEN: laat alle pending berichten opnieuw door het ruisfilter lopen.
// Geklets verschuift naar 'overige', zodat de hoofdinbox alleen echte aanvragen houdt.
app.post('/api/reviews/recategorize', requirePerm('inbox'), (req, res) => {
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
app.post('/api/reviews/:id/restore', requirePerm('inbox'), (req, res) => {
  const r = db().reviews.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Niet gevonden' });
  if (r.status !== 'rejected') return res.status(400).json({ error: 'Alleen afgewezen berichten terugzetten' });
  r.status = 'pending'; r.reviewedAt = null; r.reviewedBy = null;
  saveSoon();
  res.json({ ok: true });
});

// Afgewezen bericht DEFINITIEF verwijderen (alleen admin).
app.delete('/api/reviews/:id', requirePerm('hardDelete'), (req, res) => {
  const i = db().reviews.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Niet gevonden' });
  db().reviews.splice(i, 1);
  saveSoon();
  res.json({ ok: true });
});

// Hele inbox-prullenbak legen (alleen admin).
app.post('/api/reviews/empty-rejected', requirePerm('hardDelete'), (req, res) => {
  const before = db().reviews.length;
  db().reviews = db().reviews.filter((r) => r.status !== 'rejected');
  saveSoon();
  res.json({ ok: true, removed: before - db().reviews.length });
});

app.get('/api/feedback', requireAuth, (req, res) => {
  res.json((db().feedback || []).slice(0, 100));
});

// Eén leervoorbeeld verwijderen (bv. een afwijzing die eigenlijk een opdracht was).
app.delete('/api/feedback/:id', requirePerm('inbox'), (req, res) => {
  const i = (db().feedback || []).findIndex((f) => f.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Niet gevonden' });
  db().feedback.splice(i, 1);
  saveSoon();
  res.json({ ok: true });
});

// Alle leervoorbeelden van VANDAAG wissen (handig na een verkeerde bulk-actie).
app.post('/api/feedback/clear-today', requirePerm('hardDelete'), (req, res) => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const before = (db().feedback || []).length;
  db().feedback = (db().feedback || []).filter((f) => new Date(f.at).getTime() < start.getTime());
  saveSoon();
  res.json({ ok: true, removed: before - db().feedback.length });
});

// Alle AI-leervoorbeelden wissen (volledig schoon beginnen). Alleen admin.
app.post('/api/feedback/clear-all', requirePerm('hardDelete'), (req, res) => {
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
  // Extra diagnose van de bridge (nieuwere versies sturen dit mee): de echte
  // WhatsApp-verbindingsstatus en wanneer er voor het laatst een bericht BINNENKWAM.
  const b = req.body || {};
  if (b.state) db().settings.whatsappState = String(b.state).slice(0, 60);
  if (b.lastIncomingAt) db().settings.whatsappLastIncomingAt = String(b.lastIncomingAt).slice(0, 40);
  // Bridge-versie: zo zien we in het dashboard of de VPS al de nieuwe bridge draait
  // (v2 = kan groepen per id versturen + leert groeps-koppelingen automatisch).
  if (b.version) db().settings.whatsappBridgeVersion = Number(b.version) || 0;
  // STIL opslaan: de hartslag komt elke 60 seconden binnen en verandert niets wat je
  // op het scherm ziet. Met een gewone saveSoon() herlaadde elk geopend scherm van
  // elke gebruiker daardoor de klok rond — dat was de bron van het "geknipper".
  saveSoonQuiet();
  res.json({ ok: true });
});

// De bridge (v2) stuurt periodiek zijn complete groepenlijst (id + naam). Het CRM
// leert daarvan ALLE koppelingen automatisch — ook van groepen die zelf nooit een
// bericht sturen (zoals "CRM meldingen"). Zo hoeft niemand ooit nog handmatig een
// "groep <lange cijfers>" te koppelen: het systeem koppelt zichzelf.
app.post('/api/whatsapp/groups', checkIngestToken, (req, res) => {
  const groups = Array.isArray(req.body?.groups) ? req.body.groups.slice(0, 100) : [];
  let learned = 0;
  const before = JSON.stringify(db().settings.groupAliases || []);
  for (const g of groups) learnGroupAlias(g && g.id, g && g.name);
  if (JSON.stringify(db().settings.groupAliases || []) !== before) {
    learned = 1;
    // Meteen ook oude "groep <id>"-berichten/kaarten helen en gemiste opdrachten inhalen.
    healGroupIdNames();
    maybeCatchUpDispatch();
  }
  res.json({ ok: true, count: groups.length, changed: !!learned });
});

// Begin (maandag 00:00) en einde (volgende maandag 00:00) van de kalenderweek rond ref.
// "Vandaag" en "deze week" op de NEDERLANDSE klok (Europe/Amsterdam) — de server
// draait op Render in UTC, waardoor 's nachts (00:00-02:00 NL) en op de
// zondag/maandag-grens de tellingen anders verschoven.
function amsMidnightMs(ref = new Date()) {
  const a = amsterdamParts(ref);
  return ref.getTime() - (((a.hour * 60 + a.minute) * 60 + (a.second || 0)) * 1000) - (ref.getTime() % 1000);
}
function weekBounds(ref = new Date()) {
  const a = amsterdamParts(ref);
  const start = amsMidnightMs(ref) - (a.dow - 1) * 86400000;
  return { start, end: start + 7 * 86400000 };
}

// Overzicht/Home: kerncijfers (KPI's) + lijstjes die aandacht vragen + activiteit.
app.get('/api/overview', requireAuth, (req, res) => {
  const active = db().orders.filter((o) => !o.archivedWeek);
  const labels = getStatusLabels();
  const custMap = new Map((db().customers || []).map((c) => [c.id, c]));
  const custName = (o) => (custMap.get(o.customerId) || {}).name || '';
  const startTodayMs = amsMidnightMs();
  const endToday = startTodayMs + 86400000;
  const wk = weekBounds();
  const threeDays = Date.now() - 3 * 86400000;

  const isToday = (d) => { const t = new Date(d).getTime(); return t >= startTodayMs && t < endToday; };
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
      // Op het ECHTE afrondmoment (completedAt) — updatedAt schuift op door elke
      // aanraking (notitie, badge) en trok oude kaarten terug "deze week" in.
      afgerondDezeWeek: db().orders.filter((o) => o.status === 'afgerond' && new Date(o.completedAt || o.updatedAt).getTime() >= wk.start && new Date(o.completedAt || o.updatedAt).getTime() < wk.end).length,
      actief: active.length,
    },
    whatsapp: { online: ageSec != null && ageSec < 180, configured: !!last, lastSeen: last },
    apptToday, repliedList, staleQuotes,
    byStatus: getStatusKeys().map((k) => ({ key: k, label: labels[k], count: active.filter((o) => o.status === k).length })),
    activity: (db().activity || []).slice(0, 8).map((a) => ({ actor: a.actorName, action: a.action, detail: a.detail, at: a.at })),
  });
});

// Status van de WhatsApp-bridge: draait hij nog? (geen seintje in 3 min = stil)
// Recent geziene WhatsApp-groepen (uit de binnengekomen berichten), zodat de gebruiker
// een groep-ID makkelijk aan een naam kan koppelen als de bridge de naam niet levert.
app.get('/api/whatsapp/seen-groups', requireAuth, (req, res) => {
  const since = Date.now() - 14 * 86400000;
  const seen = new Map(); // key(id of naam) -> { group, lastAt }
  for (const m of db().messages || []) {
    if (!m.group || m.channel !== 'whatsapp') continue;
    const t = m.receivedAt ? new Date(m.receivedAt).getTime() : 0;
    if (t < since) continue;
    const cur = seen.get(m.group);
    if (!cur || t > cur.lastAt) seen.set(m.group, { group: m.group, lastAt: t });
  }
  const aliases = db().settings.groupAliases || [];
  const list = [...seen.values()].map((x) => {
    const digits = String(x.group).replace(/\D/g, '');
    const isIdOnly = digits.length >= 10 && !/[a-z]/i.test(x.group.replace(/groep/i, '')); // "groep <id>" zonder echte naam
    const alias = aliases.find((a) => String(a.id || '').replace(/\D/g, '') && digits.includes(String(a.id).replace(/\D/g, '')));
    return { group: x.group, digits, isIdOnly, aliasName: alias?.name || '', lastAt: new Date(x.lastAt).toISOString() };
  }).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  res.json(list);
});

app.get('/api/whatsapp/status', requireAuth, (req, res) => {
  const last = db().settings.whatsappLastSeen || null;
  const ageSec = last ? (Date.now() - new Date(last).getTime()) / 1000 : null;
  const online = ageSec != null && ageSec < 180; // 3 minuten marge
  const lastIn = db().settings.whatsappLastIncomingAt || null;
  res.json({
    configured: !!last, online, lastSeen: last, ageSeconds: ageSec,
    state: db().settings.whatsappState || null,
    lastIncomingAt: lastIn,
    lastIncomingAgeMin: lastIn ? Math.round((Date.now() - new Date(lastIn).getTime()) / 60000) : null,
  });
});

app.post('/api/ingest/email', checkIngestToken, async (req, res) => {
  const { from, sender, subject, body, text, html, externalId, inReplyTo } = req.body || {};
  const result = await ingestMessage({
    channel: 'email',
    sender: from || sender,
    subject,
    body: body || text || html || '',
    inReplyTo, // thread-header: antwoord in bestaande wisseling -> gesprekshistorie
    externalId,
  });
  await maybeSendAutoReply(result).catch(() => {});
  res.json({ ok: true, reviewId: result.review?.id, status: result.review?.status, duplicate: !!result.duplicate });
});

// Website-formulieren (keyservice247.nl): contact- en offerteformulieren POSTen
// hierheen zodat elke lead direct als opdracht in de inbox komt.
// CORS: de statische site draait op een ander domein, dus we staan cross-origin toe.
// Token: eigen FORM_TOKEN (aanbevolen, want zichtbaar in de client) of anders INGEST_TOKEN.
// De impact van een gelekte form-token is beperkt: leads komen ALTIJD eerst in de
// te-controleren inbox (nooit automatisch een opdracht/dispatch).
function formCors(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, x-ingest-token, x-form-token');
  res.set('Access-Control-Max-Age', '86400');
}
app.options('/api/ingest/form', (req, res) => { formCors(req, res); res.sendStatus(204); });
// Toegestane afkomst-domeinen voor formulier-leads (zonder token). Deze basislijst
// staat ALTIJD aan (elke eigen site + elke stad-website); extra domeinen kunnen er
// zonder code-wijziging bij via de Render-variabele FORM_ALLOWED_ORIGINS
// (komma-gescheiden). Nieuwe stad? Voeg 'm hier toe of zet 'm in FORM_ALLOWED_ORIGINS.
// De www.-variant hoeft niet apart: de check matcht het kale domein als deel van de
// origin. Voor .pages.dev-adressen (Cloudflare-preview) staat de volledige host erin.
const ALLOWED_ORIGINS = [
  'keyservice247.nl',
  'schuifpuiservice.com',
  // Stad-websites:
  'schuifpuireparatie-amsterdam.nl',
  'schuifpuireparatie-amsterdam.pages.dev',
  'schuifpuireparatie-rotterdam.nl',
  'schuifpuireparatie-rotterdam.pages.dev',
  'schuifpuireparatie-utrecht.nl',
  'schuifpuireparatie-utrecht.pages.dev',
];
const FORM_ORIGINS = [...new Set([
  ...ALLOWED_ORIGINS,
  ...String(process.env.FORM_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
].map((s) => s.toLowerCase()))];
function fromAllowedSite(req) {
  const src = `${req.get('origin') || ''} ${req.get('referer') || ''}`.toLowerCase();
  return FORM_ORIGINS.some((d) => src.includes(d));
}
// Bijlages op het website-formulier: naast JSON accepteert het endpoint ook
// multipart/form-data (zelfde veldnamen + één of meer bestandsvelden "bijlage").
// Limieten: max 10 MB totaal per aanvraag; alleen afbeeldingen (jpg/png/webp/heic/
// heif) en pdf. Een te groot of verkeerd bestand laat de LEAD gewoon doorgaan —
// alleen die bijlage wordt geweigerd (zichtbaar in het antwoord): een lead mag
// nooit sneuvelen op z'n bijlage.
const FORM_FILE_MAX_TOTAL = 10 * 1024 * 1024;
const FORM_FILE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);
function parseMultipartForm(req) {
  return new Promise((resolve) => {
    const fields = {};
    const attachments = [];
    const rejected = [];
    let total = 0;
    let done = false;
    const finish = () => { if (!done) { done = true; resolve({ fields, attachments, rejected }); } };
    let bb;
    try {
      bb = Busboy({ headers: req.headers, limits: { files: 10, fields: 40, fileSize: FORM_FILE_MAX_TOTAL } });
    } catch (e) {
      rejected.push({ file: '', reason: 'upload onleesbaar: ' + e.message });
      return resolve({ fields, attachments, rejected });
    }
    bb.on('field', (fname, val) => { fields[fname] = String(val || '').slice(0, 4000); });
    bb.on('file', (fname, stream, info) => {
      const filename = (info && info.filename) || 'bijlage';
      const mime = String((info && info.mimeType) || '').toLowerCase();
      const chunks = [];
      let bad = false;
      if (!FORM_FILE_TYPES.has(mime)) {
        bad = true;
        rejected.push({ file: filename, reason: `bestandstype niet toegestaan (${mime || 'onbekend'}) — alleen jpg/png/webp/heic/heif/pdf` });
      }
      stream.on('data', (c) => {
        total += c.length;
        if (bad) return;
        if (total > FORM_FILE_MAX_TOTAL) {
          bad = true;
          chunks.length = 0;
          rejected.push({ file: filename, reason: 'te groot — max 10 MB totaal per aanvraag' });
          return;
        }
        chunks.push(c);
      });
      stream.on('limit', () => {
        if (!bad) { bad = true; chunks.length = 0; rejected.push({ file: filename, reason: 'te groot — max 10 MB totaal per aanvraag' }); }
      });
      stream.on('end', () => {
        if (bad || !chunks.length) return;
        try {
          const saved = saveBuffer(Buffer.concat(chunks), { mime, filename });
          if (saved) attachments.push(saved);
          else rejected.push({ file: filename, reason: 'opslaan mislukt' });
        } catch (e) { rejected.push({ file: filename, reason: 'opslaan mislukt: ' + e.message }); }
      });
      stream.on('error', () => { bad = true; });
    });
    bb.on('error', (e) => { rejected.push({ file: '', reason: 'upload-fout: ' + e.message }); finish(); });
    bb.on('close', finish);
    bb.on('finish', finish);
    req.pipe(bb);
  });
}

app.post('/api/ingest/form', async (req, res) => {
  formCors(req, res);
  // Multipart (met bijlages) of gewone JSON — beide met dezelfde veldnamen. De
  // bestaande JSON-flow van de websites blijft exact zoals hij was.
  const isMultipart = /multipart\/form-data/i.test(req.get('content-type') || '');
  let formAttachments = [];
  let rejectedFiles = [];
  let mb = req.body || {};
  if (isMultipart) {
    const parsed = await parseMultipartForm(req);
    mb = parsed.fields;
    // Identieke bestanden binnen dezelfde inzending direct ontdubbelen (op inhoud).
    formAttachments = dedupeAttachments(parsed.attachments);
    rejectedFiles = parsed.rejected;
  }
  const dropSavedFiles = () => { for (const a of formAttachments) { try { deleteFile(a.file); } catch { /* al weg */ } } };
  // Toegang: óf een geldig token, óf de aanvraag komt aantoonbaar van de eigen site.
  // Leads gaan sowieso altijd eerst door handmatige controle, dus de impact van
  // misbruik is beperkt tot hooguit spam in de te-controleren inbox.
  const expected = process.env.FORM_TOKEN || process.env.INGEST_TOKEN;
  const got = req.get('x-form-token') || req.get('x-ingest-token') || mb.token || req.query.token;
  const tokenOk = expected && got === expected;
  if (!tokenOk && !fromAllowedSite(req)) {
    console.log('[form] geweigerd — geen geldig token en niet van toegestane site:', req.get('origin') || req.get('referer') || 'onbekend');
    dropSavedFiles();
    return res.status(401).json({ error: 'Niet toegestaan' });
  }
  const b = mb;
  const str = (v) => (v || '').toString().trim();
  const name = str(b.name);
  const phone = str(b.phone);
  const email = str(b.email);
  // Adres kan in losse velden binnenkomen (straat + postcode + plaats/woonplaats/stad).
  // We voegen ze samen tot één adres, zodat de PLAATSNAAM altijd meekomt — ook als het
  // website-formulier straat en plaats gescheiden verstuurt.
  const street = str(b.address || b.street || b.straat || b.adres);
  const postcode = str(b.postcode || b.zip || b.postalcode || b.postal_code);
  const city = str(b.city || b.plaats || b.woonplaats || b.stad || b.place || b.town);
  const address = [street, [postcode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ').trim();
  const subject = str(b.subject);
  const message = str(b.message || b.comment);
  const formType = str(b.formType || b.form) || 'website';
  if (!name && !phone && !email && !message) { dropSavedFiles(); return res.status(400).json({ error: 'Lege aanvraag' }); }
  // Van welke site komt de lead? (voor meerdere gekoppelde websites). Neem het meegestuurde
  // 'site'-veld, anders de host uit origin/referer, anders 'website'.
  const hostFrom = (v) => { const m = String(v || '').match(/^(?:https?:\/\/)?([^/?#]+)/i); return m ? m[1].replace(/^www\./, '') : ''; };
  const site = str(b.site) || hostFrom(req.get('origin')) || hostFrom(req.get('referer')) || 'website';

  // Nette, gestructureerde tekst zodat naam/telefoon/e-mail/adres betrouwbaar worden
  // opgeslagen (geen AI-giswerk nodig).
  const lines = [`Nieuwe aanvraag via de website ${site} (${formType}).`, ''];
  if (name) lines.push(`Naam: ${name}`);
  if (phone) lines.push(`Telefoon: ${phone}`);
  if (email) lines.push(`E-mail: ${email}`);
  if (address) lines.push(`Adres: ${address}`);
  if (subject) lines.push(`Onderwerp: ${subject}`);
  if (message) lines.push('', message);

  const result = await ingestMessage({
    channel: 'email',
    sender: email ? `${name || 'Website'} <${email}>` : (name || 'Website-aanvraag'),
    subject: subject || `${/offerte/i.test(formType) ? 'Offerteaanvraag' : 'Contactaanvraag'} via ${site}`,
    body: lines.join('\n'),
    externalId: b.externalId || '',
    attachments: formAttachments,
    mailbox: 'website-direct', // bron-markering: rechtstreeks van de site
    forceRelevant: true, // website-aanvraag = altijd een echte lead
  });
  console.log(`[form] lead ontvangen van ${site}: ${name || '?'} <${email || '-'}> (${formType}${formAttachments.length ? `, ${formAttachments.length} bijlage(s)` : ''})`);
  // Ook website-leads krijgen automatisch de ontvangstbevestiging (indien aan).
  await maybeSendAutoReply(result).catch(() => {});
  // Automatisch goedgekeurd (drempel)? Dan ook meteen de monteur-dispatch draaien —
  // een auto-kaart mag nooit stil blijven liggen terwijl handmatig goedkeuren wél
  // automatisch doorstuurt.
  try {
    if (result.review?.status === 'auto_approved' && result.review.orderId) {
      const ord = db().orders.find((o) => o.id === result.review.orderId);
      if (ord) maybeAutoSendToMonteur(ord, 'approved');
    }
  } catch (e) { console.error('[form-autosend]', e.message); }
  res.json({
    ok: true, reviewId: result.review?.id, status: result.review?.status, duplicate: !!result.duplicate,
    bijlagen: { opgeslagen: formAttachments.length, geweigerd: rejectedFiles },
  });
});

app.post('/api/ingest/whatsapp', checkIngestToken, async (req, res) => {
  const { from, sender, name, body, text, message, externalId, groupId, fromPhone } = req.body || {};
  // Groep-ID -> echte naam vertalen (bij WhatsApp-storing levert de bridge "groep <id>").
  // Doe het hier al, zodat ook het onderwerp/de kaart-titel de echte naam toont.
  const group = resolveGroupAlias(req.body?.group);
  const result = await ingestMessage({
    channel: 'whatsapp',
    sender: name || from || sender,
    subject: group ? `WhatsApp-groep: ${group}` : '',
    body: body || text || message || '',
    group,
    groupId, // nieuwere bridge stuurt het groeps-id mee -> CRM leert de koppeling zelf
    externalId,
    // Het échte afzendernummer (harde identificator, Regel 2). Nieuwere bridge stuurt
    // fromPhone; oudere geeft alleen "31612345678@c.us" in from — beide bruikbaar.
    fromPhone: String(fromPhone || (from ? String(from).replace(/@.*$/, '') : '') || ''),
  });
  // Volautomatisch: DRS-opdracht direct goedkeuren + naar monteur (indien ingesteld).
  try { maybeIntakeAutoSend(result); } catch (e) { console.error('intake-autosend:', e.message); }
  // Drempel-auto-accept met trigger 'goedgekeurd': dezelfde dispatch als bij een
  // handmatige goedkeuring (maybeIntakeAutoSend dekt alleen trigger 'intake').
  try {
    if (result.review?.status === 'auto_approved' && result.review.orderId) {
      const ord = db().orders.find((o) => o.id === result.review.orderId);
      if (ord && !ord.sentToMonteur) maybeAutoSendToMonteur(ord, 'approved');
    }
  } catch (e) { console.error('[wa-autosend]', e.message); }
  // Bevestigt een monteur de doorgestuurde opdracht ("ok/oké") in zijn groep? Dan stuurt
  // het wegwerp-nummer ÉÉNMALIG een "oké" naar de bron-/opdrachtgroep (bv. Raf Breda).
  try { maybeRelayMonteurConfirmation({ group, body: body || text || message || '' }); } catch (e) { console.error('[relay-ack]', e.message); }
  res.json({ ok: true, reviewId: result.review?.id, status: result.review?.status, duplicate: !!result.duplicate });
});

// Korte bevestiging van de monteur -> éénmalig "oké" terug naar de opdrachtgroep.
const MONTEUR_CONFIRM_RE = /^(ok|oke|oké|okay|oké|prima|is\s?goed|goed|top|komt goed|doen we|ja|jazeker|akkoord|duidelijk|begrepen|👍|✅|�👍)\b/i;
function maybeRelayMonteurConfirmation({ group, body }) {
  if (!group) return;
  // Vergevingsgezind vergelijken: hoofdletters en dubbele spaties maken niet uit.
  const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const g = norm(group);
  const monteur = db().monteurs.find((m) => m.waGroup && norm(m.waGroup) === g);
  if (!monteur) return; // alleen in een monteursgroep
  const text = String(body || '').trim();
  if (!text || text.length > 40 || !MONTEUR_CONFIRM_RE.test(text)) return; // moet korte bevestiging zijn
  const since = Date.now() - 36 * 3600 * 1000;
  const order = db().orders
    .filter((o) => o.sentToMonteur && o.sentToMonteur.monteurId === monteur.id
      && !o.monteurAckRelayed
      && o.originGroup && isWhatsappOrderGroup(o.originGroup)
      && o.sentToMonteur.at && new Date(o.sentToMonteur.at).getTime() >= since)
    .sort((a, b) => new Date(b.sentToMonteur.at) - new Date(a.sentToMonteur.at))[0];
  if (!order) return;
  // NUANCE (23 jul): een kort "ok" telt alléén als opdracht-bevestiging als het
  // ook echt op de doorgestuurde opdracht kan slaan. Zat er NÁ het doorsturen
  // ander verkeer in de monteursgroep (dagrapport, foto, vraag), dan ging het
  // "ok" daar hoogstwaarschijnlijk over — en blijft de relay stil. Liever één
  // keer geen automatische bevestiging dan een onterecht "wordt opgepakt" in de
  // opdrachtgroep. Het gewone pad — opdracht doorgestuurd, monteur zegt direct
  // "ok" — verandert hier NIET door: dan zit er niets tussen.
  const sentAtMs = new Date(order.sentToMonteur.at).getTime();
  const intervening = (db().messages || []).some((m) => {
    if (!m.group || norm(m.group) !== g) return false;
    const t = m.receivedAt ? new Date(m.receivedAt).getTime() : 0;
    if (!(t > sentAtMs)) return false;
    const b = String(m.body || '').trim();
    // Korte bevestigingen ("ok", "top", ook dit bericht zelf) tellen niet als
    // tussenliggend gesprek; al het andere (rapport, foto, vraag) wél.
    const isShortConfirm = b && b.length <= 40 && MONTEUR_CONFIRM_RE.test(b);
    const hasContent = b.length > 0 || (Array.isArray(m.attachments) && m.attachments.length > 0);
    return hasContent && !isShortConfirm;
  });
  if (intervening) {
    logActivity('systeem', 'kort "ok" in monteursgroep genegeerd', `ander verkeer tussen de opdracht en het "ok" (${monteur.name}) — geen bevestiging naar ${order.originGroup}`);
    return;
  }
  db().outbox.unshift({
    id: id('out'), orderId: order.id, group: order.originGroup, monteurName: monteur.name,
    groupId: groupIdForName(order.originGroup) || undefined, // direct op id kunnen versturen
    text: 'Oké 👍, wordt opgepakt.', status: 'queued', createdAt: now(), by: 'monteur-bevestiging',
  });
  order.monteurAckRelayed = { at: now(), monteurId: monteur.id, group: order.originGroup };
  if (order.sentToMonteur) order.sentToMonteur.acked = true;
  order.updatedAt = now();
  logActivity('systeem', 'monteur bevestigde — oké naar opdrachtgroep', `${order.title} → ${order.originGroup}`);
  saveSoon();
}

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
            fromPhone: phone, // échte afzendernummer als harde identificator (Regel 2)
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
  await maybeSendAutoReply(result).catch(() => {});
  res.json({ ok: true, reviewId: result.review?.id, status: result.review?.status });
});

// ---------- Instellingen / statistieken / activiteit ----------
app.get('/api/settings', requirePerm('settings'), (req, res) => {
  res.json({
    aiAutoApproveThreshold: autoApproveThreshold(),
    aiMode: aiMode(),
    statuses: getStatuses(),
    sources: getSources(),
    templates: getTemplates(),
    companyProfile: getCompanyProfile(),
    whatsappOrderGroups: db().settings.whatsappOrderGroups || '',
    groupAliases: db().settings.groupAliases || [],
    emailFilters: db().settings.emailFilters || '',
    emailFiltersDefault: DEFAULT_EMAIL_FILTERS.join(', '),
    attachmentCleanup: getAttachmentCleanup(),
    emailSignature: getEmailSignature(),
    sendAddress: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    imapAddress: process.env.IMAP_USER || '',
    calendarToken: getCalendarToken(),
    autoReply: getAutoReply(),
    followUp: getFollowUp(),
    backupMail: getBackupMail(),
    terugkoppeling: getTerugkoppeling(),
    appointmentMsg: getAppointmentMsg(),
    onderwegMsg: getOnderweg(),
    reviewRequest: getReviewRequest(),
    autoScan: db().settings.autoScan || { enabled: false, hour: 5 },
    crmAlerts: getCrmAlerts(),
    morningBriefing: getMorningBriefing(),
    weeklyAiCheck: getWeeklyAiCheck(),
    googleSync: getGoogleSync(),
    autoMergeWindowHours: getAutoMergeWindowHours(),
    htmlSignature: getHtmlSignature(),
    aiOverviewModel: db().settings.aiOverviewModel === 'opus' ? 'opus' : 'standaard',
    invoiceSettings: getInvoiceSettings(),
    priceList: getPriceList(),
    priceBundles: getPriceBundles(),
    monteurDispatch: db().settings.monteurDispatch || { autoEnabled: false, days: [], autoMonteurId: '', trigger: 'approved', onlyDrs: true, keywordRoutes: [] },
  });
});

let _lastPriceSync = null; // laatste "pakketten meegewijzigd"-melding voor het antwoord
app.patch('/api/settings', requirePerm('settings'), (req, res) => {
  const b = req.body || {};
  _lastPriceSync = null;
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
  if ('emailFilters' in b) {
    // WET (Regel 4): eigen filterpatronen (afzender/onderwerp) bovenop de vaste
    // basislijst — leveranciers-/webshopmail stil naar Overige, zonder code-wijziging.
    db().settings.emailFilters = String(b.emailFilters || '').slice(0, 3000);
  }
  if ('attachmentCleanup' in b) {
    const a = b.attachmentCleanup || {};
    db().settings.attachmentCleanup = {
      enabled: a.enabled !== false,
      days: Math.max(90, Math.min(3650, Number(a.days) || 365)),
    };
  }
  if ('groupAliases' in b) {
    // Koppelingen groeps-ID -> naam (voor als de bridge door een WhatsApp-storing geen
    // groepsnaam kan ophalen). Alleen nette id/naam-paren bewaren.
    const arr = Array.isArray(b.groupAliases) ? b.groupAliases : [];
    db().settings.groupAliases = arr
      .map((a) => ({ id: String(a.id || '').replace(/\D/g, '').slice(0, 40), name: String(a.name || '').slice(0, 100).trim() }))
      .filter((a) => a.id.length >= 10 && a.name)
      .slice(0, 50);
    // Direct helen + inhalen: bestaande "groep <id>"-berichten/kaarten krijgen meteen
    // de echte naam, en gemiste opdrachten gaan alsnog automatisch naar de monteur.
    healGroupIdNames();
    maybeCatchUpDispatch();
  }
  if ('emailSignature' in b) {
    db().settings.emailSignature = String(b.emailSignature || '').slice(0, 1000);
  }
  if ('autoReply' in b) {
    const a = b.autoReply || {};
    db().settings.autoReply = {
      enabled: !!a.enabled,
      subject: String(a.subject || '').slice(0, 200),
      body: String(a.body || '').slice(0, 2000),
    };
  }
  if ('followUp' in b) {
    const f = b.followUp || {};
    db().settings.followUp = {
      emailEnabled: !!f.emailEnabled,
      whatsappEnabled: !!f.whatsappEnabled,
      days: Math.max(1, Math.min(30, Number(f.days) || 3)),
      emailSubject: String(f.emailSubject || '').slice(0, 200),
      emailBody: String(f.emailBody || '').slice(0, 2000),
      whatsappBody: String(f.whatsappBody || '').slice(0, 2000),
      noReplyEnabled: !!f.noReplyEnabled,
      noReplyDays: Math.max(1, Math.min(30, Number(f.noReplyDays) || 3)),
      noReplyEmailSubject: String(f.noReplyEmailSubject || '').slice(0, 200),
      noReplyEmailBody: String(f.noReplyEmailBody || '').slice(0, 2000),
    };
  }
  if ('backupMail' in b) {
    const bm = b.backupMail || {};
    db().settings.backupMail = {
      enabled: !!bm.enabled,
      email: String(bm.email || '').slice(0, 200).trim(),
      hour: Math.max(0, Math.min(23, Number(bm.hour) >= 0 ? Number(bm.hour) : 6)),
    };
  }
  if ('terugkoppeling' in b) {
    const t = b.terugkoppeling || {};
    db().settings.terugkoppeling = {
      enabled: !!t.enabled,
      monteurId: String(t.monteurId || ''),
      statuses: Array.isArray(t.statuses) ? t.statuses.filter((k) => isValidStatus(k)) : getTerugkoppeling().statuses,
    };
  }
  if ('appointmentMsg' in b) {
    const a = b.appointmentMsg || {};
    db().settings.appointmentMsg = {
      emailEnabled: !!a.emailEnabled,
      whatsappEnabled: !!a.whatsappEnabled,
      blockHours: Math.max(1, Math.min(8, Number(a.blockHours) || 3)),
      emailSubject: String(a.emailSubject || '').slice(0, 200),
      emailBody: String(a.emailBody || '').slice(0, 2000),
      whatsappBody: String(a.whatsappBody || '').slice(0, 1000),
      reminderEnabled: !!a.reminderEnabled,
      reminderHours: Math.max(1, Math.min(72, Number(a.reminderHours) || 24)),
      reminderEmailSubject: String(a.reminderEmailSubject || '').slice(0, 200),
      reminderBody: String(a.reminderBody || '').slice(0, 1000),
    };
  }
  if ('onderwegMsg' in b) {
    const o = b.onderwegMsg || {};
    db().settings.onderwegMsg = {
      emailSubject: String(o.emailSubject || '').slice(0, 200),
      emailBody: String(o.emailBody || '').slice(0, 2000),
      whatsappBody: String(o.whatsappBody || '').slice(0, 1000),
    };
  }
  if ('invoiceSettings' in b) {
    const v = b.invoiceSettings || {};
    db().settings.invoiceSettings = {
      companyName: String(v.companyName || 'Key service 24/7').slice(0, 100),
      address: String(v.address || '').slice(0, 300),
      kvk: String(v.kvk || '').slice(0, 30),
      btwNr: String(v.btwNr || '').slice(0, 30),
      iban: String(v.iban || '').slice(0, 40),
      bic: String(v.bic || '').slice(0, 20),
      email: String(v.email || '').slice(0, 100),
      phone: String(v.phone || '').slice(0, 30),
      website: String(v.website || '').slice(0, 120),
      paymentDays: Math.max(1, Math.min(90, Number(v.paymentDays) || 7)),
      quoteValidDays: Math.max(1, Math.min(120, Number(v.quoteValidDays) || 30)),
      // Automatische betaalherinnering (na vervaldatum), instelbaar in Instellingen.
      autoRemind: !!v.autoRemind,
      remindAfterDays: Math.max(1, Math.min(60, Number(v.remindAfterDays) || 3)),
      remindRepeatDays: Math.max(2, Math.min(60, Number(v.remindRepeatDays) || 7)),
      remindMax: Math.max(1, Math.min(5, Number(v.remindMax) || 2)),
      autoInvoiceOnAccept: v.autoInvoiceOnAccept !== false,
      autoQuoteFollowup: !!v.autoQuoteFollowup,
      quoteFollowupAfterDays: Math.max(1, Math.min(60, Number(v.quoteFollowupAfterDays) || 3)),
      quoteFollowupRepeatDays: Math.max(2, Math.min(60, Number(v.quoteFollowupRepeatDays) || 5)),
      quoteFollowupMax: Math.max(1, Math.min(5, Number(v.quoteFollowupMax) || 2)),
      btwPct: (Number.isFinite(Number(v.btwPct)) ? Math.max(0, Math.min(21, Number(v.btwPct))) : 21),
      warranty: String(v.warranty || '').slice(0, 300),
      legal: String(v.legal || '').slice(0, 1200),
      footer: String(v.footer || '').slice(0, 300),
    };
  }
  // Prijslijst: vaste producten/werkzaamheden (excl. btw) voor snel factureren.
  if ('priceList' in b) {
    db().settings.priceList = (Array.isArray(b.priceList) ? b.priceList : [])
      .map((p) => ({ description: String(p.description || '').slice(0, 200), priceExcl: Math.max(0, Math.min(999999, Number(p.priceExcl) || 0)) }))
      .filter((p) => p.description)
      .slice(0, 150);
    // Pakketten met dezelfde omschrijving gaan mee (prijslijst is de baas).
    const sync = syncBundlesToPriceList(db().settings.priceList);
    if (sync.changed) {
      _lastPriceSync = sync;
      logActivity(req.user.name, 'prijzen in pakketten meegewijzigd', `${sync.changed} regel(s) — ${sync.bundles.join(', ')}`);
    } else _lastPriceSync = null;
  }
  // Pakketten (bundels): één knop = meerdere regels.
  if ('priceBundles' in b) {
    db().settings.priceBundles = sanitizeBundles(b.priceBundles);
  }
  if ('crmAlerts' in b) {
    const c = b.crmAlerts || {};
    db().settings.crmAlerts = {
      enabled: !!c.enabled,
      group: String(c.group || 'CRM meldingen').slice(0, 100),
      phone: String(c.phone || '').replace(/[^\d+]/g, '').slice(0, 20),
      notifyReplies: c.notifyReplies !== false,
    };
  }
  if ('aiOverviewModel' in b) {
    db().settings.aiOverviewModel = b.aiOverviewModel === 'opus' ? 'opus' : 'standaard';
  }
  if ('htmlSignature' in b) {
    const h = b.htmlSignature || {};
    db().settings.htmlSignature = {
      enabled: !!h.enabled,
      name: String(h.name || '').slice(0, 120),
      role: String(h.role || '').slice(0, 120),
      tagline: String(h.tagline || '').slice(0, 120),
      phone: String(h.phone || '').slice(0, 40),
      email: String(h.email || '').slice(0, 120),
      website: String(h.website || '').slice(0, 120),
    };
  }
  if ('autoMergeWindowHours' in b) {
    const v = Number(b.autoMergeWindowHours);
    db().settings.autoMergeWindowHours = Number.isFinite(v) && v >= 0 ? Math.min(72, v) : 6;
  }
  if ('morningBriefing' in b) {
    const m = b.morningBriefing || {};
    db().settings.morningBriefing = {
      enabled: !!m.enabled,
      hour: Math.max(0, Math.min(23, Number(m.hour) >= 0 ? Number(m.hour) : 7)),
      weekdaysOnly: m.weekdaysOnly !== false,
      channel: ['whatsapp', 'email', 'beide'].includes(m.channel) ? m.channel : 'whatsapp',
      email: String(m.email || '').slice(0, 200).trim(),
      tone: m.tone === 'zakelijk' ? 'zakelijk' : 'coachend',
    };
  }
  if ('googleSync' in b) {
    const g = b.googleSync || {};
    db().settings.googleSync = {
      mode: ['alles', 'monteurs', 'schuifpui', 'monteurs+schuifpui'].includes(g.mode) ? g.mode : 'alles',
      monteurIds: Array.isArray(g.monteurIds) ? g.monteurIds.filter((x) => typeof x === 'string').slice(0, 20) : [],
      keywords: String(g.keywords || '').slice(0, 300),
    };
  }
  if ('weeklyAiCheck' in b) {
    const w = b.weeklyAiCheck || {};
    db().settings.weeklyAiCheck = {
      enabled: !!w.enabled,
      hour: Math.max(0, Math.min(23, Number(w.hour) >= 0 ? Number(w.hour) : 8)),
    };
  }
  if ('reviewRequest' in b) {
    const r = b.reviewRequest || {};
    db().settings.reviewRequest = {
      enabled: !!r.enabled,
      delayHours: Math.max(1, Math.min(240, Number(r.delayHours) || 24)),
      link: String(r.link || '').slice(0, 500).trim(),
      subject: String(r.subject || '').slice(0, 200),
      body: String(r.body || '').slice(0, 2000),
    };
  }
  if ('autoScan' in b) {
    const a = b.autoScan || {};
    db().settings.autoScan = {
      enabled: !!a.enabled,
      hour: Math.max(0, Math.min(23, Number(a.hour) >= 0 ? Number(a.hour) : 5)),
    };
  }
  if ('monteurDispatch' in b) {
    const d = b.monteurDispatch || {};
    const trigger = ['approved', 'appointment', 'intake'].includes(d.trigger) ? d.trigger : 'approved';
    const keywordRoutes = Array.isArray(d.keywordRoutes)
      ? d.keywordRoutes
          .map((r) => ({ keyword: String(r.keyword || '').slice(0, 60).trim(), monteurId: String(r.monteurId || '') }))
          .filter((r) => r.keyword && r.monteurId)
          .slice(0, 30)
      : (db().settings.monteurDispatch?.keywordRoutes || []);
    db().settings.monteurDispatch = {
      autoEnabled: !!d.autoEnabled,
      days: Array.isArray(d.days) ? d.days.filter((n) => n >= 0 && n <= 6) : [],
      autoMonteurId: d.autoMonteurId || '',
      trigger, // approved | appointment | intake (volautomatisch)
      onlyDrs: d.onlyDrs !== false, // standaard alleen DRS/Raf Breda-opdrachten
      keywordRoutes, // [{keyword, monteurId}] -> trefwoord-routering
    };
  }
  save();
  res.json({
    priceSync: _lastPriceSync, // {changed, bundles} als pakketten zijn meegewijzigd
    aiAutoApproveThreshold: autoApproveThreshold(),
    statuses: getStatuses(),
    sources: getSources(),
    templates: getTemplates(),
    companyProfile: getCompanyProfile(),
    whatsappOrderGroups: db().settings.whatsappOrderGroups || '',
    groupAliases: db().settings.groupAliases || [],
    emailFilters: db().settings.emailFilters || '',
    emailFiltersDefault: DEFAULT_EMAIL_FILTERS.join(', '),
    attachmentCleanup: getAttachmentCleanup(),
    emailSignature: getEmailSignature(),
    autoReply: getAutoReply(),
    followUp: getFollowUp(),
    backupMail: getBackupMail(),
    monteurDispatch: db().settings.monteurDispatch || { autoEnabled: false, days: [], autoMonteurId: '', trigger: 'approved', onlyDrs: true, keywordRoutes: [] },
  });
});

// ---------- Push-meldingen ----------
app.get('/api/push/key', requireAuth, (req, res) => {
  res.json({ publicKey: getPublicKey() });
});
app.post('/api/push/subscribe', requireAuth, (req, res) => {
  const ok = addSubscription(req.body, req.user);
  if (!ok) return res.status(400).json({ error: 'Ongeldig abonnement' });
  res.json({ ok: true });
});
app.post('/api/push/unsubscribe', requireAuth, (req, res) => {
  removeSubscription((req.body || {}).endpoint);
  res.json({ ok: true });
});
// Testmelding naar de eigen toestellen.
app.post('/api/push/test', requireAuth, async (req, res) => {
  const out = await sendPush({ title: 'Keyservice CRM', body: 'Testmelding — meldingen werken!', url: '/' });
  res.json(out);
});

// Nu meteen een off-site back-up naar de mail sturen (test / handmatig).
app.post('/api/backup/mail', requireRole('admin'), async (req, res) => {
  try {
    const out = await sendBackupMail((req.body || {}).email);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Google Agenda (OAuth 2-weg) ----------
const _googleStates = new Map(); // state -> vervaltijd (CSRF-bescherming)
function newGoogleState() {
  const s = id('gst');
  _googleStates.set(s, Date.now() + 10 * 60 * 1000);
  // opruimen van verlopen states
  for (const [k, exp] of _googleStates) if (exp < Date.now()) _googleStates.delete(k);
  return s;
}

// Start de koppeling: stuur de admin door naar Google's toestemmingsscherm.
app.get('/api/google/auth', requireRole('admin'), (req, res) => {
  if (!googleConfigured()) return res.status(400).send('Google is niet geconfigureerd op de server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).');
  res.redirect(googleAuthUrl(req, newGoogleState()));
});

// Terugkomst vanaf Google: ruil de code in voor tokens en ga terug naar Instellingen.
app.get('/api/google/callback', requireRole('admin'), async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/?google=geweigerd');
  if (!code || !state || !_googleStates.has(String(state))) return res.redirect('/?google=fout');
  _googleStates.delete(String(state));
  try {
    await googleExchange(String(code), req);
    logActivity(req.user.name, 'Google Agenda verbonden', googleInfo().email || '');
    res.redirect('/?google=verbonden');
  } catch (e) {
    console.error('[google] koppeling mislukt:', e.message);
    res.redirect('/?google=fout');
  }
});

// Status + (indien verbonden) lijst met agenda's voor de instellingen-UI.
app.get('/api/google/status', requireAuth, async (req, res) => {
  const info = googleInfo();
  let calendars = [];
  if (info.connected) {
    try { calendars = await googleListCalendars(); }
    catch (e) { info.error = e.message; }
  }
  res.json({ ...info, calendars });
});

// Standaardagenda kiezen (voor opdrachten zonder gekoppelde monteur).
app.post('/api/google/default-calendar', requireRole('admin'), (req, res) => {
  setDefaultCalendarId(String((req.body || {}).calendarId || 'primary'));
  res.json({ ok: true, defaultCalendarId: googleInfo().defaultCalendarId });
});

// Koppeling verbreken.
app.post('/api/google/disconnect', requireRole('admin'), (req, res) => {
  googleDisconnect();
  logActivity(req.user.name, 'Google Agenda losgekoppeld', '');
  res.json({ ok: true });
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
// WET (Regel 3): de gegevens uit DE AANVRAAG (order.intake) gaan voor — het
// klantrecord kan bewust afwijken (wordt nooit stil overschreven), maar de monteur
// moet naar het adres/nummer uit déze aanvraag.
function buildMonteurMessage(order) {
  const c = db().customers.find((x) => x.id === order.customerId) || {};
  const it = order.intake || {};
  const name = (it.name && !/^onbekende klant$/i.test(it.name) ? it.name : '') || c.name || '';
  const phone = it.phone || c.phone || '';
  const address = it.address || c.address || '';
  const lines = [`*Nieuwe opdracht: ${order.title}*`];
  if (order.originGroup && isWhatsappOrderGroup(order.originGroup)) lines.push('Bron: DRS (Raf Breda)');
  if (name) lines.push(`Klant: ${name}`);
  if (phone) lines.push(`Tel: ${phone}`);
  if (address) lines.push(`Adres: ${address}`);
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
    // Groeps-id (indien gekoppeld): de bridge verstuurt dan DIRECT op id, ook als hij
    // door een WhatsApp-storing geen groepsnamen kan opzoeken.
    groupId: groupIdForName(monteur.waGroup) || undefined,
    // Noodpad: het 06-nummer van de monteur. Kan de bridge de groep (tijdelijk) niet
    // bereiken, dan gaat de opdracht 1-op-1 naar de monteur zelf — een opdracht mag
    // NOOIT ongemerkt blijven hangen.
    phone: String(monteur.phone || '').trim() || undefined,
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

// ---------- Suggesties op de kaart (Regel 1 + 3): de mens beslist ----------
// Gegevens-suggestie toepassen ("bijwerken") of negeren. Toepassen schrijft het
// klantrecord alsnog bij — bewust, zichtbaar en gelogd; negeren haalt alleen de
// suggestie weg. Er verandert nooit iets zonder deze menselijke klik.
app.post('/api/orders/:id/data-suggestion', requireRole('admin', 'assistent'), (req, res) => {
  const order = db().orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Niet gevonden' });
  const { field, action } = req.body || {};
  const list = order.dataSuggestions || [];
  const idx = list.findIndex((s) => s.field === field);
  if (idx < 0) return res.status(404).json({ error: 'Suggestie niet gevonden' });
  const sug = list[idx];
  if (action === 'apply') {
    const customer = db().customers.find((c) => c.id === order.customerId);
    const map = { adres: 'address', telefoon: 'phone', 'e-mail': 'email', naam: 'name' };
    if (customer && map[sug.field]) {
      customer[map[sug.field]] = sug.to;
      order.thread = order.thread || [];
      order.thread.push({ id: id('thr'), channel: 'systeem', outgoing: true, sender: 'Systeem (gegevens-check)', body: `Klantrecord bijgewerkt door ${req.user.name}: ${sug.field} "${sug.from || '—'}" → "${sug.to}".`, at: now() });
      logActivity(req.user.name, 'klantrecord bijgewerkt via suggestie', `${customer.name}: ${sug.field} → ${sug.to}`);
    }
  } else {
    logActivity(req.user.name, 'gegevens-suggestie genegeerd', `${order.title}: ${sug.field}`);
  }
  list.splice(idx, 1);
  if (list.length) order.dataSuggestions = list; else delete order.dataSuggestions;
  order.updatedAt = now();
  saveSoon();
  res.json(withRelations(order));
});

// Samenvoeg-suggestie negeren (samenvoegen zelf gaat via de bestaande
// POST /api/orders/merge, aangestuurd door de knop op de kaart).
app.post('/api/orders/:id/merge-suggestion', requireRole('admin', 'assistent'), (req, res) => {
  const order = db().orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Niet gevonden' });
  if (order.mergeSuggestion) {
    logActivity(req.user.name, 'samenvoeg-suggestie genegeerd', order.title);
    delete order.mergeSuggestion;
    order.updatedAt = now();
    saveSoon();
  }
  res.json(withRelations(order));
});

// Eenmalig bij het opstarten: recente MISLUKTE groeps-berichten (monteur-dispatch,
// terugkoppeling, CRM-meldingen) terug in de wachtrij zetten. Tijdens de WhatsApp-
// storing zijn die ten onrechte als definitief mislukt gemarkeerd; zodra de bridge
// weer kan versturen gaan ze nu alsnog vanzelf de deur uit.
function requeueRecentFailedGroupItems() {
  try {
    const cutoff = Date.now() - 36 * 3600000;
    let n = 0;
    for (const it of db().outbox || []) {
      if (it.status !== 'failed') continue;
      if (!it.group || it.group === '__klant_dm__') continue;
      if (!it.createdAt || new Date(it.createdAt).getTime() < cutoff) continue;
      it.status = 'queued';
      delete it.doneAt;
      it.attempts = it.attempts || 0;
      n++;
    }
    if (n) {
      console.log(`[outbox] ${n} mislukte groeps-bericht(en) terug in de wachtrij (worden opnieuw geprobeerd)`);
      saveSoon();
    }
  } catch (e) { console.error('[outbox-herstel]', e.message); }
}

// Inhaalslag bij het opstarten: kaarten die tijdens de WhatsApp-storing uit een
// opdracht-groep binnenkwamen maar NIET automatisch naar de monteur zijn gegaan
// (de groep werd toen niet herkend), alsnog automatisch versturen. Streng begrensd:
// alleen als de automatische dispatch aanstaat (trigger goedgekeurd/volautomatisch),
// vandaag is toegestaan, en alleen niet-afgeronde kaarten van de afgelopen 48 uur
// zonder eerdere verzending. Zo raakt een opdracht nooit stil kwijt door een storing.
function maybeCatchUpDispatch() {
  try {
    const cfg = db().settings.monteurDispatch || {};
    if (!cfg.autoEnabled) return;
    if (!['approved', 'intake'].includes(cfg.trigger)) return;
    if (!autoSendAllowedToday()) { console.log('[inhaalslag] vandaag niet ingeschakeld (dag staat uit)'); return; }
    const cutoff = Date.now() - 48 * 3600000;
    let n = 0;
    for (const o of db().orders || []) {
      if (o.sentToMonteur || o.archivedWeek) continue;
      if (['afgerond', 'geannuleerd'].includes(o.status)) continue;
      if (!o.createdAt || new Date(o.createdAt).getTime() < cutoff) continue;
      if (!o.originGroup || !isWhatsappOrderGroup(o.originGroup)) continue;
      const routed = routeMonteurForOrder(o);
      const monteur = routed || db().monteurs.find((m) => m.id === (cfg.autoMonteurId || o.monteurId));
      if (!monteur || !monteur.waGroup) continue;
      if (!o.monteurId) o.monteurId = monteur.id;
      const r = queueToMonteur(o, monteur, 'inhaalslag na storing');
      if (!r.error) {
        n++;
        logActivity('systeem', 'inhaalslag: alsnog naar monteur', `${o.title} -> ${monteur.name}`);
      }
    }
    if (n) { console.log(`[inhaalslag] ${n} gemiste opdracht(en) alsnog naar de monteur in de wachtrij`); saveSoon(); }
  } catch (e) { console.error('[inhaalslag]', e.message); }
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
  // Aangevinkte foto's meesturen: de bridge stuurt ze ná de opdrachttekst naar
  // dezelfde groep (max 6, alleen afbeeldingen van deze kaart).
  const attIds = Array.isArray(req.body?.attachmentIds) ? req.body.attachmentIds : [];
  if (attIds.length && r.item) {
    const sel = (order.attachments || []).filter((a) => attIds.includes(a.id) && /^image\//.test(a.mime || ''));
    if (sel.length) r.item.media = sel.slice(0, 6).map((a) => ({ url: a.url, name: a.filename || 'foto.jpg', mime: a.mime || 'image/jpeg' }));
  }
  logActivity(req.user.name, 'naar monteur gestuurd', `${order.title} -> ${monteur.name}${r.item?.media?.length ? ` (+${r.item.media.length} foto's)` : ''}`);
  saveSoon();
  res.json(withRelations(order));
});

// De WhatsApp-bridge haalt hier de wachtrij op (queued items).
app.get('/api/outbox', checkIngestToken, (req, res) => {
  // Herkansings-rem: een eerder mislukt item mag pas na z'n wachttijd (nextTryAt)
  // opnieuw worden aangeboden. Anders hamert de bridge elke 8s op hetzelfde kapotte
  // bericht en loopt de log vol. Nieuwe items gaan wel meteen mee.
  const nu = now();
  const items = db().outbox.filter((o) => o.status === 'queued' && (!o.nextTryAt || o.nextTryAt <= nu));
  // Groeps-id er bij het ophalen live bij zoeken: een koppeling kan ná het aanmaken
  // van het item zijn gezet/geleerd. Zo kan de bridge altijd rechtstreeks op id
  // versturen, ook voor oudere items in de wachtrij.
  for (const it of items) {
    if (it.groupId || !it.group || it.group === '__klant_dm__') continue;
    const viaAlias = groupIdForName(it.group);
    const rawDigits = String(it.group).replace(/\D/g, '');
    const gid = viaAlias || (rawDigits.length >= 15 ? rawDigits : '');
    if (gid) it.groupId = gid;
  }
  res.json(items);
});

// WhatsApp-verbinding testen vanuit Instellingen: zet een testbericht in de
// wachtrij naar een opgegeven nummer. Zo zie je binnen ~10 sec of de bridge
// op de VPS klant-DM's echt verstuurt (status wordt sent/failed).
app.post('/api/whatsapp/test', requirePerm('settings'), (req, res) => {
  const phone = String(req.body?.phone || '').replace(/[^\d+]/g, '');
  if (phone.replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Vul een geldig telefoonnummer in (bv. 0612345678)' });
  const text = String(req.body?.text || '').trim() || `Testbericht van het Keyservice CRM — de WhatsApp-koppeling werkt! (${new Date().toLocaleTimeString('nl-NL')})`;
  db().outbox = db().outbox || [];
  const item = { id: id('out'), kind: 'whatsapp_customer', phone, group: '__klant_dm__', text, status: 'queued', createdAt: now(), by: `testbericht (${req.user.name})` };
  db().outbox.unshift(item);
  logActivity(req.user.name, 'WhatsApp-testbericht in wachtrij', phone);
  saveSoon();
  res.json({ ok: true, id: item.id });
});

// Wachtrij-status voor het test-/diagnosekaartje: de laatste items met status.
app.get('/api/whatsapp/outbox-status', requirePerm('settings'), (req, res) => {
  const items = (db().outbox || []).slice(0, 12).map((o) => ({
    id: o.id, status: o.status, by: o.by || '', createdAt: o.createdAt, doneAt: o.doneAt || null,
    // Groeps-items tonen de groep (ook als er een nood-telefoonnummer op zit).
    to: (o.group && o.group !== '__klant_dm__') ? o.group : (o.phone || 'klant-DM'),
    attempts: o.attempts || 0,
    lastResult: o.lastResult || '',
    text: String(o.text || '').slice(0, 80),
  }));
  res.json(items);
});

// De bridge meldt hier terug dat een item verzonden is (of mislukt).
app.post('/api/outbox/:id/done', checkIngestToken, (req, res) => {
  const item = db().outbox.find((o) => o.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Niet gevonden' });
  const ok = req.body?.ok !== false;
  if (req.body?.detail) item.lastResult = String(req.body.detail).slice(0, 160);
  if (ok) {
    item.status = 'sent';
    item.doneAt = now();
  } else {
    // NIET meteen definitief opgeven: een groeps-bericht kan tijdelijk niet verstuurd
    // worden (WhatsApp-storing, bridge-herstart). Dan blijft het in de wachtrij en
    // wordt het vanzelf alsnog bezorgd zodra de bridge weer kan versturen. Pas na
    // 36 uur geven we echt op. Klant-DM's falen wél direct (verkeerd nummer blijft
    // verkeerd — eindeloos herproberen zou de klant nooit bereiken).
    item.attempts = (item.attempts || 0) + 1;
    const isGroupItem = item.group && item.group !== '__klant_dm__';
    const tooOld = !item.createdAt || (Date.now() - new Date(item.createdAt).getTime()) > 36 * 3600000;
    if (isGroupItem && !tooOld) {
      item.status = 'queued';
      // Rem: volgende poging pas over 60s (i.p.v. elke bridge-ronde van 8s).
      item.nextTryAt = new Date(Date.now() + 60 * 1000).toISOString();
    } else {
      item.status = 'failed';
      item.doneAt = now();
    }
  }
  const order = db().orders.find((o) => o.id === item.orderId);
  if (order && order.sentToMonteur) order.sentToMonteur.status = item.status;
  // Bij het her-wachtrijen niet elke 8s naar schijf schrijven (de oude bridge probeert
  // het snel opnieuw): 1x per 20 pogingen is genoeg — de teller is geen kritieke data.
  if (item.status !== 'queued' || (item.attempts % 20) === 1) saveSoon();
  res.json({ ok: true });
});

// ---------- Werkbon + Facturen ----------
// Monteur mag alleen bij ZIJN eigen opdrachten; kantoor (admin/assistent) overal bij.
function canTouchOrder(req, order) {
  if (req.user.role !== 'monteur') return true;
  return !!(order.monteurId && order.monteurId === req.user.monteurId);
}

// "Monteur onderweg": één knop op de kaart -> klant krijgt een mail én een appje
// dat de monteur er nu aankomt. Mag ook door de monteur zelf (eigen opdrachten).
app.post('/api/orders/:id/onderweg', requireAuth, async (req, res) => {
  const order = db().orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Niet gevonden' });
  if (!canTouchOrder(req, order)) return res.status(403).json({ error: 'Alleen je eigen opdrachten' });
  const customer = db().customers.find((c) => c.id === order.customerId) || {};
  const monteur = db().monteurs.find((m) => m.id === order.monteurId);
  const cfg = getOnderweg();
  // {monteur} leest als hele frase: "onze monteur Youssef" of, zonder toewijzing,
  // gewoon "onze monteur" — zo klopt de zin altijd.
  const vars = { naam: customer.name || '', monteur: monteur?.name ? `onze monteur ${monteur.name}` : 'onze monteur' };
  const fill = (t) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  const sent = [];
  order.thread = order.thread || [];
  // 1) E-mail (indien adres + SMTP)
  const email = (customer.email || '').trim();
  if (email && /@/.test(email) && smtpConfigured()) {
    const sig = getEmailSignature();
    const body = fill(cfg.emailBody);
    try {
      await sendMail({ to: email, subject: fill(cfg.emailSubject), text: sig ? `${body}\n\n${sig}` : body });
      order.thread.push({ id: id('thr'), channel: 'email', outgoing: true, sender: 'Keyservice (onderweg-bericht)', subject: fill(cfg.emailSubject), body, at: now() });
      sent.push('e-mail');
    } catch (e) { console.error('[onderweg] e-mail mislukt:', e.message); }
  }
  // 2) WhatsApp-DM via de bridge (indien telefoonnummer)
  const phone = String(customer.phone || '').replace(/[^\d+]/g, '');
  if (phone) {
    const body = fill(cfg.whatsappBody);
    db().outbox = db().outbox || [];
    db().outbox.unshift({ id: id('out'), kind: 'whatsapp_customer', phone, group: '__klant_dm__', text: body, orderId: order.id, status: 'queued', createdAt: now(), by: `onderweg (${req.user.name})` });
    order.thread.push({ id: id('thr'), channel: 'whatsapp', outgoing: true, sender: 'Keyservice (onderweg-bericht)', body, at: now() });
    sent.push('WhatsApp');
  }
  if (!sent.length) return res.status(400).json({ error: 'Klant heeft geen e-mailadres of telefoonnummer op de kaart (of versturen staat uit).' });
  order.onderwegAt = now();
  order.updatedAt = now();
  logActivity(req.user.name, 'onderweg-bericht verstuurd', `${order.title} — via ${sent.join(' + ')}`);
  saveSoon();
  res.json({ ok: true, sent, summary: `Klant geïnformeerd via ${sent.join(' + ')}` });
});

// Werkbon opslaan op de kaart (uitgevoerd werk, materialen, handtekening als bijlage-id).
app.post('/api/orders/:id/werkbon', requireAuth, (req, res) => {
  const order = db().orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Niet gevonden' });
  if (!canTouchOrder(req, order)) return res.status(403).json({ error: 'Alleen je eigen opdrachten' });
  const b = req.body || {};
  order.werkbon = {
    work: String(b.work || '').slice(0, 3000),
    materials: String(b.materials || '').slice(0, 2000),
    signatureAttachmentId: String(b.signatureAttachmentId || '').slice(0, 60) || (order.werkbon?.signatureAttachmentId || ''),
    by: req.user.name, at: now(),
  };
  order.updatedAt = now();
  saveSoon();
  logActivity(req.user.name, 'werkbon opgeslagen', order.title);
  res.json(withRelations(order));
});

// Rechten op een factuur/offerte: kantoor overal bij; monteur alleen bij zijn eigen
// opdrachten of records die hij zelf heeft aangemaakt (losse facturen/offertes).
function canTouchInvoice(req, inv) {
  if (req.user.role !== 'monteur') return true;
  if (can(req.user, 'invoicesAll')) return true; // recht "alle facturen zien" aangezet
  if (inv.createdById && inv.createdById === req.user.id) return true;
  const order = inv.orderId ? db().orders.find((o) => o.id === inv.orderId) : null;
  return !!(order && order.monteurId === req.user.monteurId);
}
const findInv = (invId) => (db().invoices || []).find((i) => i.id === invId);

// Factuur ophalen (of leeg concept-voorstel op basis van de kaart).
app.get('/api/orders/:id/invoice', requireAuth, (req, res) => {
  const order = db().orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Niet gevonden' });
  if (!canTouchOrder(req, order)) return res.status(403).json({ error: 'Alleen je eigen opdrachten' });
  const inv = (db().invoices || []).find((i) => i.id === order.invoiceId) || null;
  res.json({ invoice: inv, settings: getInvoiceSettings(), priceList: getPriceList(), bundles: getPriceBundles() });
});

// Factuur aanmaken/bijwerken via de kaart (concept).
app.post('/api/orders/:id/invoice', requireAuth, (req, res) => {
  const order = db().orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Niet gevonden' });
  if (!canTouchOrder(req, order)) return res.status(403).json({ error: 'Alleen je eigen opdrachten' });
  const wasSent = !!(order.invoiceId && (db().invoices || []).find((i) => i.id === order.invoiceId && i.status === 'verzonden'));
  const out = upsertInvoice(order, req.body || {}, req.user.name);
  if (out.error) return res.status(400).json({ error: out.error });
  // Verzonden document gewijzigd (na de waarschuwing in het scherm): zichtbaar vastleggen.
  if (wasSent) logActivity(req.user.name, `verzonden ${out.invoice.type} gewijzigd`, out.invoice.number);
  else logActivity(req.user.name, 'factuur opgeslagen (concept)', `${out.invoice.number} — ${order.title}`);
  res.json(out.invoice);
});

// LOSSE factuur of offerte: direct aan een klant (bestaand of nieuw) gekoppeld,
// zonder kaart. Voor snelle offertes en losse verkopen.
app.post('/api/invoices', requireAuth, (req, res) => {
  const b = req.body || {};
  const type = b.type === 'offerte' ? 'offerte' : 'factuur';
  let customerId = b.customerId;
  if (!customerId && b.newCustomer) {
    const nc = b.newCustomer || {};
    if (!String(nc.name || '').trim()) return res.status(400).json({ error: 'Vul minimaal de naam van de nieuwe klant in.' });
    // BELANGRIJK: "nieuwe klant" maakt echt een NIEUWE klant met de ingevoerde naam.
    // NIET via upsertCustomer (die matcht op bestaand e-mailadres/telefoon en zou dan
    // een bestaande klant hergebruiken — bv. "abdel rafour" i.p.v. de getypte naam).
    const c = {
      id: id('cust'), name: String(nc.name).trim(), phone: nc.phone || '', email: nc.email || '',
      address: nc.address || '', type: 'klant', source: 'handmatig',
      notes: '', createdAt: now(),
    };
    db().customers.push(c);
    logActivity(req.user.name, 'klant toegevoegd (via factuur)', c.name);
    customerId = c.id;
  }
  const customer = db().customers.find((c) => c.id === customerId);
  if (!customer) return res.status(400).json({ error: 'Kies een klant of vul een nieuwe klant in.' });
  const inv = createStandaloneInvoice({ customerId, type, actorName: req.user.name, createdById: req.user.id });
  // Optioneel gekoppeld aan een kaart (bv. vanuit "Nog te factureren"): dan telt
  // de klus als gefactureerd en toont de kaart de factuur.
  if (b.orderId) {
    const o = db().orders.find((x) => x.id === b.orderId && x.customerId === customerId);
    if (o) { inv.orderId = o.id; if (type !== 'offerte') o.invoiceId = inv.id; o.updatedAt = now(); saveSoon(); }
  }
  logActivity(req.user.name, `${type} aangemaakt (los)`, `${inv.number} — ${customer.name}`);
  res.json({ invoice: inv, customer });
});

// REVIEW VRAGEN vanaf een verzonden factuur. De klus is af en betaald/gefactureerd —
// dit is het natuurlijke moment. Werkt los van de automatische ronde, zodat je 'm ook
// kunt sturen als die uit staat (of uit staat voor deze monteur).
app.post('/api/invoices/:id/review-request', requirePerm('invoices'), async (req, res) => {
  const inv = (db().invoices || []).find((i) => i.id === req.params.id);
  if (!inv) return res.status(404).json({ error: 'Factuur niet gevonden' });
  if (!canTouchInvoice(req, inv)) return res.status(403).json({ error: 'Geen toegang tot deze factuur' });
  const order = inv.orderId ? db().orders.find((o) => o.id === inv.orderId) : null;
  if (!order) return res.status(400).json({ error: 'Deze factuur hangt niet aan een opdrachtkaart — vraag de review vanaf de kaart.' });
  try {
    const r = await sendReviewRequest(order, { actorName: req.user.name, force: !!req.body?.force });
    if (r.error) return res.status(400).json(r);
    inv.reviewRequestedAt = now();
    saveSoon();
    res.json(r);
  } catch (e) { res.status(500).json({ error: 'Versturen mislukt: ' + e.message }); }
});

// Regels uit een factuur opslaan in de vaste PRIJSLIJST (losse producten/
// werkzaamheden), zodat je ze nooit meer hoeft over te typen. Dedup op omschrijving
// (hoofdletter-ongevoelig): een bestaande regel wordt bijgewerkt met de nieuwe prijs.
app.post('/api/pricelist/add', requirePerm('settings'), (req, res) => {
  const items = sanitizeBundleLines(req.body?.items).map((l) => ({ description: l.description, priceExcl: l.priceExcl }));
  if (!items.length) return res.status(400).json({ error: 'Geen regels om op te slaan.' });
  const cur = Array.isArray(db().settings.priceList) ? db().settings.priceList
    : getPriceList().map((p) => ({ ...p }));
  const norm = (d) => d.toLowerCase().replace(/\s+/g, ' ').trim();
  let added = 0;
  for (const it of items) {
    const ex = cur.find((p) => norm(p.description) === norm(it.description));
    if (ex) ex.priceExcl = it.priceExcl;
    else { cur.push(it); added++; }
  }
  db().settings.priceList = cur.slice(0, 150);
  // Pakketten met dezelfde omschrijving krijgen meteen de nieuwe prijs.
  const sync = syncBundlesToPriceList(db().settings.priceList);
  if (sync.changed) logActivity(req.user.name, 'prijzen in pakketten meegewijzigd', `${sync.changed} regel(s) — ${sync.bundles.join(', ')}`);
  saveSoon();
  logActivity(req.user.name, 'regels opgeslagen in prijslijst', `${items.length} regel(s)`);
  res.json({ ok: true, added, priceList: db().settings.priceList, priceSync: sync.changed ? sync : null });
});

// Regels uit een factuur opslaan als PAKKET (bundel): één knop die deze regels later
// in één keer toevoegt. Bestaand pakket met dezelfde naam wordt overschreven.
app.post('/api/bundles/add', requirePerm('settings'), (req, res) => {
  const name = String(req.body?.name || '').slice(0, 120).trim();
  const lines = sanitizeBundleLines(req.body?.lines);
  if (!name) return res.status(400).json({ error: 'Geef het pakket een naam.' });
  if (!lines.length) return res.status(400).json({ error: 'Geen regels om op te slaan.' });
  const cur = getPriceBundles().slice();
  const norm = (d) => d.toLowerCase().replace(/\s+/g, ' ').trim();
  const ex = cur.find((b) => norm(b.name) === norm(name));
  if (ex) { ex.lines = lines; }
  else cur.push({ id: 'bnd_' + Math.random().toString(36).slice(2, 9), name, lines });
  db().settings.priceBundles = sanitizeBundles(cur);
  saveSoon();
  logActivity(req.user.name, 'pakket opgeslagen', `${name} (${lines.length} regels)`);
  res.json({ ok: true, bundles: db().settings.priceBundles });
});

// Eén factuur/offerte ophalen (voor de editor).
// NOG TE FACTUREREN: afgeronde kaarten (ook gearchiveerd) waar géén factuur aan
// hangt — zodat er nooit meer omzet wordt vergeten. Monteur ziet alleen eigen werk.
// LET OP: vóór de /:id-route registreren, anders vangt die "todo" af.
app.get('/api/invoices/todo', requireAuth, (req, res) => {
  const invByOrder = new Set((db().invoices || []).filter((i) => i.orderId && i.type !== 'offerte').map((i) => i.orderId));
  const maps = buildMaps();
  let list = (db().orders || []).filter((o) => o.status === 'afgerond' && !o.invoiceId && !invByOrder.has(o.id));
  if (req.user.role === 'monteur') list = list.filter((o) => o.monteurId && o.monteurId === req.user.monteurId);
  res.json(list
    .sort((a, b) => String(b.completedAt || b.updatedAt || '').localeCompare(String(a.completedAt || a.updatedAt || '')))
    .slice(0, 100)
    .map((o) => ({
      id: o.id, title: o.title || '', price: o.price || '',
      completedAt: o.completedAt || o.updatedAt || '',
      customerId: o.customerId, customerName: (maps.customers.get(o.customerId) || {}).name || '',
    })));
});

app.get('/api/invoices/:id', requireAuth, (req, res) => {
  const inv = findInv(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Niet gevonden' });
  if (!canTouchInvoice(req, inv)) return res.status(403).json({ error: 'Geen toegang tot deze factuur' });
  const customer = db().customers.find((c) => c.id === inv.customerId) || {};
  const order = inv.orderId ? (db().orders.find((o) => o.id === inv.orderId) || null) : null;
  res.json({ invoice: inv, customer, order: order ? { id: order.id, title: order.title, werkbon: order.werkbon || null } : null, settings: getInvoiceSettings(), priceList: getPriceList(), bundles: getPriceBundles() });
});

// Regels/btw/notitie bijwerken. Betaald/geaccepteerd = vergrendeld.
app.patch('/api/invoices/:id', requireAuth, (req, res) => {
  const inv = findInv(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Niet gevonden' });
  if (!canTouchInvoice(req, inv)) return res.status(403).json({ error: 'Geen toegang tot deze factuur' });
  const wasSent = inv.status === 'verzonden';
  const out = saveInvoiceFields(inv, req.body || {});
  if (out.error) return res.status(400).json({ error: out.error });
  // Verzonden document gewijzigd (na de waarschuwing in het scherm): zichtbaar vastleggen.
  if (wasSent) logActivity(req.user.name, `verzonden ${inv.type} gewijzigd`, inv.number);
  res.json(out.invoice);
});

// Verwijderen: concept mag (eigen), verzonden alleen beheerder, betaald nooit.
app.delete('/api/invoices/:id', requireAuth, (req, res) => {
  const inv = findInv(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Niet gevonden' });
  if (!canTouchInvoice(req, inv)) return res.status(403).json({ error: 'Geen toegang tot deze factuur' });
  if (inv.status === 'betaald') return res.status(400).json({ error: 'Een betaalde factuur kan niet worden verwijderd (boekhouding).' });
  if (inv.status !== 'concept' && req.user.role !== 'admin') return res.status(403).json({ error: 'Een verzonden factuur/offerte kan alleen de beheerder verwijderen.' });
  db().invoices = (db().invoices || []).filter((i) => i.id !== inv.id);
  const order = inv.orderId ? db().orders.find((o) => o.id === inv.orderId) : null;
  if (order && order.invoiceId === inv.id) order.invoiceId = null;
  saveSoon();
  logActivity(req.user.name, `${inv.type === 'offerte' ? 'offerte' : 'factuur'} verwijderd`, inv.number);
  res.json({ ok: true });
});

// Kopiëren (zelfde type) of omzetten (offerte → factuur via body.type='factuur').
app.post('/api/invoices/:id/copy', requireAuth, (req, res) => {
  const src = findInv(req.params.id);
  if (!src) return res.status(404).json({ error: 'Niet gevonden' });
  if (!canTouchInvoice(req, src)) return res.status(403).json({ error: 'Geen toegang tot deze factuur' });
  const inv = copyInvoice(src, { actorName: req.user.name, createdById: req.user.id, copyType: req.body?.type });
  // Offerte → factuur: koppel aan de kaart als die nog geen factuur heeft.
  if (inv.type === 'factuur' && inv.orderId) {
    const order = db().orders.find((o) => o.id === inv.orderId);
    if (order && (!order.invoiceId || order.invoiceId === src.id) && src.type === 'offerte') { order.invoiceId = inv.id; saveSoon(); }
  }
  logActivity(req.user.name, `${src.number} gekopieerd`, `→ ${inv.number} (${inv.type})`);
  res.json(inv);
});

// Factuur/offerte als PDF bekijken/downloaden.
app.get('/api/invoices/:id/pdf', requireAuth, async (req, res) => {
  const inv = findInv(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Niet gevonden' });
  if (!canTouchInvoice(req, inv)) return res.status(403).json({ error: 'Geen toegang tot deze factuur' });
  const order = inv.orderId ? (db().orders.find((o) => o.id === inv.orderId) || {}) : {};
  const customer = db().customers.find((c) => c.id === inv.customerId) || {};
  try {
    const pdf = await buildInvoicePdf(inv, order, customer);
    // ?download=1 => opslaan als bestand (attachment) i.p.v. inline tonen.
    const disp = req.query.download ? 'attachment' : 'inline';
    const fname = `${inv.type === 'offerte' ? 'offerte' : 'factuur'}-${inv.number}.pdf`;
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `${disp}; filename="${fname}"`);
    res.send(pdf);
  } catch (e) { res.status(500).json({ error: 'PDF maken mislukt: ' + e.message }); }
});

// Versturen per e-mail (factuur óf offerte) met PDF-bijlage.
app.post('/api/invoices/:id/send', requireAuth, async (req, res) => {
  const inv = findInv(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Niet gevonden' });
  if (!canTouchInvoice(req, inv)) return res.status(403).json({ error: 'Geen toegang tot deze factuur' });
  const order = inv.orderId ? db().orders.find((o) => o.id === inv.orderId) : null;
  const customer = db().customers.find((c) => c.id === inv.customerId) || {};
  const to = (req.body?.to || customer.email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: 'Geen geldig e-mailadres van de klant. Vul het e-mailveld in.' });
  // Corrigeerde de gebruiker een verkeerd e-mailadres bij het opnieuw versturen?
  // Sla het dan meteen op bij de klant, zodat het overal klopt (niet alleen deze mail).
  if (req.body?.to && customer.id && to.toLowerCase() !== String(customer.email || '').toLowerCase()) {
    customer.email = to;
    logActivity(req.user.name, 'klant-e-mail gecorrigeerd (bij versturen)', `${customer.name || ''} → ${to}`);
  }
  if (!smtpConfigured()) return res.status(400).json({ error: 'E-mail versturen (SMTP) is niet ingesteld.' });
  if (!inv.lines || !inv.lines.length) return res.status(400).json({ error: 'Er staan nog geen regels op.' });
  const cfg = getInvoiceSettings();
  const isQuote = inv.type === 'offerte';
  try {
    const pdf = await buildInvoicePdf(inv, order || {}, customer);
    const sig = getEmailSignature();
    const bedrag = `€ ${inv.totalIncl.toFixed(2).replace('.', ',')}`;
    const body = isQuote
      ? `Beste ${customer.name || 'klant'},\n\nBedankt voor uw aanvraag. In de bijlage vindt u onze offerte ${inv.number}${order ? ` voor: ${order.title}` : ''}.\nTotaalbedrag: ${bedrag} incl. btw. Deze offerte is ${cfg.quoteValidDays || 30} dagen geldig.\n\nGaat u akkoord? Reageer op deze e-mail of bel ons — dan plannen we de werkzaamheden direct in.`
      : `Beste ${customer.name || 'klant'},\n\nIn de bijlage vindt u factuur ${inv.number}${order ? ` voor de uitgevoerde werkzaamheden (${order.title})` : ''}.\nTotaalbedrag: ${bedrag} — graag betalen binnen ${cfg.paymentDays} dagen${cfg.iban ? ` op ${cfg.iban}` : ''} o.v.v. het factuurnummer.\n\nVragen over deze factuur? Reageer gerust op deze e-mail.`;
    await sendMail({
      to, subject: `${isQuote ? 'Offerte' : 'Factuur'} ${inv.number} — ${cfg.companyName}`,
      text: sig ? `${body}\n\n${sig}` : body,
      attachments: [{ filename: `${isQuote ? 'offerte' : 'factuur'}-${inv.number}.pdf`, content: pdf }],
    });
    // Opnieuw versturen mag altijd (bv. verkeerd adres, klant wil kopie), maar
    // verlaag de status NOOIT: een betaalde factuur of goedgekeurde offerte blijft
    // dat. Alleen een concept promoveert naar 'verzonden'.
    if (inv.status === 'concept') inv.status = 'verzonden';
    inv.sentAt = now();
    inv.sentTo = to;
    inv.sendCount = (inv.sendCount || 0) + 1;
    if (order) {
      order.thread = order.thread || [];
      order.thread.push({ id: id('thr'), channel: 'email', outgoing: true, sender: `${req.user.name} (${inv.type})`, subject: `${isQuote ? 'Offerte' : 'Factuur'} ${inv.number}`, body, at: now() });
      order.updatedAt = now();
    }
    saveSoon();
    logActivity(req.user.name, `${inv.type} verstuurd`, `${inv.number} → ${to}`);
    res.json({ ok: true, invoice: inv });
  } catch (e) { res.status(500).json({ error: 'Versturen mislukt: ' + e.message }); }
});

// Vriendelijke betaalherinnering (alleen verzonden facturen), met PDF opnieuw als
// bijlage. De kern is gedeeld met de automatische herinnering (sendInvoiceReminder).
app.post('/api/invoices/:id/remind', requireAuth, async (req, res) => {
  const inv = findInv(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Niet gevonden' });
  if (!canTouchInvoice(req, inv)) return res.status(403).json({ error: 'Geen toegang tot deze factuur' });
  try {
    const r = await sendInvoiceReminder(inv, { to: req.body?.to || '', by: req.user.name });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, invoice: inv });
  } catch (e) { res.status(500).json({ error: 'Versturen mislukt: ' + e.message }); }
});

// Handmatige offerte-opvolging (herinnering): e-mail met PDF, of WhatsApp als de
// klant alleen een 06 heeft. Zelfde kern als de automatische ronde.
app.post('/api/invoices/:id/quote-followup', requireAuth, async (req, res) => {
  const inv = findInv(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Niet gevonden' });
  if (!canTouchInvoice(req, inv)) return res.status(403).json({ error: 'Geen toegang tot deze offerte' });
  try {
    const r = await sendQuoteFollowup(inv, { by: req.user.name });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, via: r.via, to: r.to, invoice: inv });
  } catch (e) { res.status(500).json({ error: 'Versturen mislukt: ' + e.message }); }
});

// Status wijzigen. Factuur: concept/verzonden/betaald. Offerte: + goedgekeurd/afgekeurd.
app.post('/api/invoices/:id/status', requireAuth, (req, res) => {
  const inv = findInv(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Niet gevonden' });
  if (!canTouchInvoice(req, inv)) return res.status(403).json({ error: 'Geen toegang tot deze factuur' });
  const s = String(req.body?.status || '');
  const allowed = inv.type === 'offerte' ? ['concept', 'verzonden', 'goedgekeurd', 'afgekeurd'] : ['concept', 'verzonden', 'betaald'];
  if (!allowed.includes(s)) return res.status(400).json({ error: 'Ongeldige status' });
  // Een betaalde factuur / goedgekeurde offerte mag NIET terug naar concept/verzonden
  // (dat omzeilde de bewerk-/verwijder-vergrendeling). Alleen de beheerder mag dit,
  // voor het geval een betaling per ongeluk is aangevinkt.
  const wasLocked = inv.status === 'betaald' || inv.status === 'goedgekeurd';
  const wouldUnlock = wasLocked && s !== inv.status;
  if (wouldUnlock && req.user.role !== 'admin') {
    return res.status(403).json({ error: `Een ${inv.status === 'betaald' ? 'betaalde factuur' : 'goedgekeurde offerte'} kan alleen de beheerder terugzetten.` });
  }
  const wasPaid = inv.status === 'betaald';
  inv.status = s;
  if (s === 'betaald') inv.paidAt = now();
  if (s === 'goedgekeurd') inv.acceptedAt = now();
  // Betaling teruggedraaid? Dan ook de automatische omzet-boeking uit Cijfers weg —
  // anders blijft er omzet staan die er niet (meer) is.
  if (wasPaid && s !== 'betaald') {
    const n = removeAutoIncomeForInvoice(inv.id);
    if (n) logActivity(req.user.name, 'automatische omzet-boeking teruggedraaid', `${inv.number} (betaling ongedaan)`);
  }
  saveSoon();
  logActivity(req.user.name, `${inv.type === 'offerte' ? 'offerte' : 'factuur'} ${s}`, inv.number);
  // Offerte goedgekeurd -> automatisch een factuur-concept klaarzetten (instelbaar).
  let autoInvoice = null;
  if (s === 'goedgekeurd' && inv.type === 'offerte' && getInvoiceSettings().autoInvoiceOnAccept !== false) {
    try { autoInvoice = autoConvertQuoteToInvoice(inv, req.user.name); } catch (e) { console.error('[auto-factuur]', e.message); }
  }
  res.json(autoInvoice ? { ...inv, autoInvoice: { id: autoInvoice.id, number: autoInvoice.number } } : inv);
});

// Overzicht (kantoor alles; monteur alleen eigen kaarten + zelf aangemaakte losse).
app.get('/api/invoices', requireAuth, (req, res) => {
  const maps = buildMaps();
  let list = db().invoices || [];
  if (req.user.role === 'monteur') list = list.filter((i) => canTouchInvoice(req, i));
  const payDays = getInvoiceSettings().paymentDays || 7;
  res.json(list.map((i) => {
    const c = maps.customers.get(i.customerId) || {};
    const o = i.orderId ? (db().orders.find((x) => x.id === i.orderId) || {}) : {};
    // Vervaldatum meegeven zodat het overzicht "verlopen" op de ÉCHTE betaaltermijn
    // baseert (instelbaar) i.p.v. een vaste 7 dagen in de frontend.
    const dueAt = i.type !== 'offerte' && i.sentAt
      ? new Date(new Date(i.sentAt).getTime() + payDays * 86400000).toISOString() : null;
    return { ...i, customerName: c.name || '', customerEmail: c.email || '', orderTitle: o.title || '', dueAt };
  }));
});


// ---------- Financiën / Cijfers (admin) ----------
app.get('/api/finance', requirePerm('finance'), (req, res) => {
  const month = String(req.query.month || '').slice(0, 7);
  const monteurs = db().monteurs || [];
  // Vaste kosten worden door de uurlijkse automatisering geboekt — niet meer als
  // verrassing bij het openen van deze pagina (GET hoort geen boekingen te doen).
  res.json({
    report: monthReport(month, monteurs),
    trend: trend(6, month),
    monteurs: monteurs.map((m) => ({ id: m.id, name: m.name })),
    categories: { income: INCOME_CATEGORIES, expense: EXPENSE_CATEGORIES },
    quickExpenses: QUICK_EXPENSES,
    settings: getFinanceSettings(),
  });
});
app.post('/api/finance/settings', requirePerm('finance'), (req, res) => {
  const saved = saveFinanceSettings(req.body || {});
  bookRecurringDue();
  res.json(saved);
});
app.get('/api/finance/suggest-income', requirePerm('finance'), (req, res) => {
  res.json({ suggestions: suggestIncomeFromReports(String(req.query.month || '').slice(0, 7), db().monteurs || []) });
});
app.post('/api/finance/dismiss-income', requirePerm('finance'), (req, res) => {
  const n = dismissIncomeSuggestions(Array.isArray(req.body?.refs) ? req.body.refs : []);
  if (n) logActivity(req.user.name, 'omzet-suggesties geweigerd', `${n} bedrag(en) niet meer voorstellen`);
  res.json({ ok: true, dismissed: n });
});
app.post('/api/finance/import-income', requirePerm('finance'), (req, res) => {
  const n = importIncome(req.body?.items || [], req.user.name);
  logActivity(req.user.name, 'omzet geïmporteerd uit monteursrapporten', `${n} boeking(en)`);
  res.json({ ok: true, booked: n });
});
// ---------- AI-DAGOVERZICHT (Start-pagina) ----------
// Eén keer per dag gegenereerd en gecachet; Ververs-knop forceert een nieuwe scan.
// Leest de dashboard-feiten + het echte verkeer (WhatsApp ≤7 dagen, e-mail ≤14
// dagen, ingekort). Zonder AI-sleutel komen alléén de feiten terug (nette fallback).
// AVG: het dagoverzicht bevat klantnamen/omzet uit het HELE bedrijf — niet voor de
// monteur-rol. Fout-antwoorden worden kort (15 min) in het geheugen onthouden i.p.v.
// de hele dag gecachet, en parallelle aanvragen delen één AI-call (in-flight guard).
let _dayOvPromise = null;
let _dayOvErr = null; // { at, payload } — korte fout-cache
app.get('/api/day-overview', requireRole('admin', 'assistent'), async (req, res) => {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
  const cache = db()._dayOverview;
  const refresh = req.query.refresh === '1';
  if (!refresh && cache && cache.day === today && cache.data) return res.json({ ...cache, cached: true });
  const factsData = morningBriefingData();
  // Recente fout? Niet elke pulse opnieuw een (dure) AI-call doen — maar wel
  // korter dan een dag, zodat een tijdelijke storing zichzelf herstelt.
  if (!refresh && _dayOvErr && Date.now() - _dayOvErr.at < 15 * 60000) return res.json(_dayOvErr.payload);
  if (_dayOvPromise) { try { return res.json(await _dayOvPromise); } catch { /* val door naar nieuwe poging */ } }
  const facts = [
    `Afspraken vandaag: ${factsData.appts.length}${factsData.appts.length ? ' — ' + factsData.appts.map((a) => `${a.time} ${a.name || a.title}${a.place ? ` (${a.place})` : ''}${a.confirmed ? '' : ' [NIET bevestigd]'}`).join('; ') : ''}`,
    `Onbeantwoorde klantreacties: ${factsData.unanswered}`,
    `Nieuwe leads te controleren: ${factsData.pendingLeads}`,
    `Offertes 4+ dagen stil: ${factsData.quoteStale}`,
    `Facturen verlopen: ${factsData.overdueCount} (samen € ${factsData.overdueTotal.toFixed(2)})`,
    `Kaarten 5+ dagen stil: ${factsData.stale}`,
    `Deze week: omzet € ${factsData.week.thisWeek.income.toFixed(2)}, winst € ${factsData.week.thisWeek.profit.toFixed(2)}, openstaand € ${factsData.week.unpaidTotal.toFixed(2)} (${factsData.week.unpaidCount})`,
  ].join('\n');
  _dayOvPromise = (async () => {
    let out = { error: 'geen-ai' };
    try {
      const nowMs = Date.now();
      const msgs = (db().messages || []).filter((m) => {
        if (!m.receivedAt || !m.body || m.skipped || m.bounce) return false;
        const age = nowMs - new Date(m.receivedAt).getTime();
        if (m.channel === 'whatsapp') return age <= 7 * 86400000;
        if (m.channel === 'email') return age <= 14 * 86400000;
        return false;
      }).slice(-220);
      const corpus = msgs.map((m) => `[${String(m.receivedAt).slice(5, 16).replace('T', ' ')}] (${m.channel}${m.group ? ' groep ' + String(m.group).slice(0, 28) : ''}) ${String(m.sender || '').slice(0, 30)}: ${String(m.body).replace(/\s+/g, ' ').slice(0, m.group ? 500 : 350)}`).join('\n').slice(0, 90000);
      const modelPref = db().settings.aiOverviewModel === 'opus' ? 'claude-opus-5' : '';
      out = await dayOverview({ corpus, facts, companyProfile: getCompanyProfile(), model: modelPref });
    } catch (e) {
      out = { error: String(e.message || 'onbekende fout').slice(0, 200) };
    }
    // Fout ALTIJD vastleggen in het logboek — anders blijft "het lukte even niet"
    // een raadsel en kunnen we niets gericht oplossen.
    if (!out.data) {
      try { logActivity('systeem', 'AI-dagoverzicht mislukt', String(out.error || '').slice(0, 180)); } catch { /* nooit blokkeren */ }
      console.error('[dagoverzicht]', out.error);
    }
    const payload = { day: today, at: now(), data: out.data || null, engine: out.engine || '', error: out.data ? '' : (out.error || 'ai-fout'), facts: factsData };
    if (out.data) {
      // Alleen een GESLAAGDE scan een hele dag bewaren; een fout mag de dag niet gijzelen.
      db()._dayOverview = payload;
      _dayOvErr = null;
      saveSoon();
    } else {
      _dayOvErr = { at: Date.now(), payload };
    }
    return payload;
  })();
  let payload;
  try { payload = await _dayOvPromise; } finally { _dayOvPromise = null; }
  if (refresh) logActivity(req.user.name, 'AI-dagoverzicht ververst', payload.engine || payload.error || '');
  res.json(payload);
});

// Automatische boekingen (betaalde facturen + DRS-fee) direct draaien — dezelfde
// run als het uurlijkse proces; idempotent (nooit dubbel boeken).
app.post('/api/finance/autosync', requirePerm('finance'), (req, res) => {
  const r = runFinanceAutoSync();
  res.json({ ok: true, ...r });
});

// TERUGWERKEND boeken: laat eerst zien WAT er zou worden geboekt vanaf een datum,
// inclusief een waarschuwing per regel als er al een handmatige boeking staat met
// (bijna) hetzelfde bedrag in dezelfde maand — dan kies je zelf wat je overneemt.
app.get('/api/finance/autosync/preview', requirePerm('finance'), (req, res) => {
  const since = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.since || '')) ? String(req.query.since) : '2000-01-01';
  const list = collectAutoSyncEntries(since);
  // Handmatige (niet-automatische) boekingen om mee te vergelijken.
  const manual = ((db().finance || {}).entries || []).filter((e) => !e.auto);
  const items = list.map((x) => {
    const month = String(x.date).slice(0, 7);
    const dup = manual.find((e) => e.kind === x.kind && String(e.date).slice(0, 7) === month
      && Math.abs((e.amount || 0) - x.amount) < 0.01);
    return { ...x, possibleDuplicate: dup ? { date: dup.date, note: dup.note || '', category: dup.category || '' } : null };
  });
  const monteurName = new Map((db().monteurs || []).map((m) => [m.id, m.name]));
  res.json({
    since,
    items: items.map((x) => ({ ...x, monteurName: x.monteurId ? (monteurName.get(x.monteurId) || '') : '' })),
    totals: {
      income: Math.round(items.filter((x) => x.kind === 'income').reduce((s, x) => s + x.amount, 0) * 100) / 100,
      expense: Math.round(items.filter((x) => x.kind === 'expense').reduce((s, x) => s + x.amount, 0) * 100) / 100,
      duplicates: items.filter((x) => x.possibleDuplicate).length,
    },
  });
});

// Alleen de AANGEVINKTE regels alsnog boeken (op sourceRef).
app.post('/api/finance/autosync/apply', requirePerm('finance'), (req, res) => {
  const refs = new Set(Array.isArray(req.body?.refs) ? req.body.refs.map(String) : []);
  if (!refs.size) return res.status(400).json({ error: 'Niets geselecteerd.' });
  const list = collectAutoSyncEntries('2000-01-01').filter((x) => refs.has(x.sourceRef));
  const r = bookAutoSyncEntries(list);
  if (r.income || r.fees) {
    saveSoon();
    logActivity(req.user.name, 'historie alsnog geboekt', `${r.income} omzet-boeking(en), ${r.fees} fee-boeking(en)`);
  }
  res.json({ ok: true, ...r });
});
app.post('/api/finance/weekly-report/test', requirePerm('finance'), async (req, res) => {
  const to = (req.body?.to || getFinanceSettings().weeklyReport.email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: 'Vul een geldig e-mailadres in bij het CEO-rapport.' });
  if (!smtpConfigured()) return res.status(400).json({ error: 'E-mail versturen (SMTP) is niet ingesteld.' });
  try { await sendWeeklyCeoReport(to, true); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// Wekelijkse AI-controle: nu een test versturen (zelfde kanalen als de briefing).
app.post('/api/weekly-check/test', requirePerm('settings'), async (req, res) => {
  try {
    const r = await sendWeeklyAiCheck({ isTest: true });
    if (r.error) return res.status(400).json({ error: r.error });
    logActivity(req.user.name, 'wekelijkse controle test verstuurd', r.via.join(' + '));
    res.json({ ok: true, via: r.via, text: r.text, findings: r.findings });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// De bevindingen ook los opvraagbaar (voor het scherm, zonder te versturen).
app.get('/api/weekly-check', requireRole('admin', 'assistent'), (req, res) => {
  res.json({ findings: weeklyCheckData() });
});
// AI-ochtendbriefing: nu een test versturen via de ingestelde kanalen.
app.post('/api/morning-briefing/test', requirePerm('settings'), async (req, res) => {
  try {
    const r = await sendMorningBriefing({ isTest: true });
    if (r.error) return res.status(400).json({ error: r.error });
    logActivity(req.user.name, 'ochtendbriefing test verstuurd', r.via.join(' + '));
    res.json({ ok: true, via: r.via, text: r.text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/finance', requirePerm('finance'), (req, res) => {
  const out = addEntry(req.body || {}, req.user.name);
  if (out.error) return res.status(400).json({ error: out.error });
  logActivity(req.user.name, `${out.entry.kind === 'income' ? 'inkomst' : 'uitgave'} geboekt`, `${out.entry.category} € ${out.entry.amount}`);
  res.json(out.entry);
});
app.patch('/api/finance/:id', requirePerm('finance'), (req, res) => {
  const out = updateEntry(req.params.id, req.body || {});
  if (out.error) return res.status(out.error === 'Niet gevonden' ? 404 : 400).json({ error: out.error });
  res.json(out.entry);
});
app.delete('/api/finance/:id', requirePerm('finance'), (req, res) => {
  const out = deleteEntry(req.params.id);
  logActivity(req.user.name, 'financiële regel verwijderd', req.params.id);
  res.json(out);
});

// Testmail: stuur één van de automatische mails (met voorbeeldgegevens) naar een gekozen
// adres, zodat je ziet hoe het bij de klant binnenkomt. Verstuurt NIET naar klanten.
app.post('/api/test-mail', requireRole('admin'), async (req, res) => {
  const to = String(req.body?.to || '').trim();
  const type = String(req.body?.type || 'ontvangstbevestiging');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: 'Vul een geldig e-mailadres in' });
  if (!smtpConfigured()) return res.status(400).json({ error: 'E-mail versturen (SMTP) is nog niet ingesteld op de server.' });
  const sample = { naam: 'Jan de Vries (voorbeeld)', datum: 'maandag 8 juli', tijd: '15:00 - 18:00', tijdblok: 'tussen 15:00 en 18:00', link: getReviewRequest().link || 'https://g.page/r/keyservice-review' };
  const fill = (t) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (sample[k] ?? ''));
  let subject; let body;
  if (type === 'ontvangstbevestiging') { const c = getAutoReply(); subject = c.subject; body = c.body; }
  else if (type === 'afspraak') { const c = getAppointmentMsg(); subject = c.emailSubject; body = c.emailBody; }
  else if (type === 'herinnering') { const c = getAppointmentMsg(); subject = c.reminderEmailSubject; body = c.reminderBody; }
  else if (type === 'review') { const c = getReviewRequest(); subject = c.subject; body = c.body; }
  else if (type === 'annulering') { subject = 'Uw afspraak is geannuleerd'; body = `Beste ${sample.naam},\n\nUw geplande afspraak van ${sample.datum} ${sample.tijdblok} is geannuleerd. Wilt u een nieuwe afspraak inplannen? Neem gerust contact met ons op.\n\nMet vriendelijke groet,\nKeyservice`; }
  else return res.status(400).json({ error: 'Onbekend maildtype' });
  const sig = getEmailSignature();
  let text = fill(body || '');
  text += '\n\n———\n(Dit is een TESTMAIL vanuit je eigen CRM, met voorbeeldgegevens. De echte klant krijgt exact deze opmaak, zonder deze regel.)';
  if (sig) text = `${text}\n\n${sig}`;
  try {
    await sendMail({ to, subject: '[TEST] ' + fill(subject || 'Keyservice'), text });
    logActivity(req.user.name, 'testmail verstuurd', `${type} -> ${to}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/send-reply', requireRole('admin', 'assistent'), async (req, res) => {
  const { to, subject, text, orderId } = req.body || {};
  if (!smtpConfigured()) return res.status(503).json({ error: 'E-mail versturen is nog niet ingesteld (SMTP). Zie docs/INTEGRATIES.md.' });
  if (!to) return res.status(400).json({ error: 'Geen e-mailadres van de klant bekend' });
  try {
    // ECHTE THREADING: verwijs naar het laatste inkomende bericht van dit adres,
    // zodat het antwoord bij de klant in dezelfde conversatie valt (In-Reply-To) én
    // een eventuele bounce later aan het juiste gesprek te koppelen is. Adres wordt
    // EXACT vergeleken (jan@ mag nooit de thread van marjan@ pakken) en de lijst
    // wordt achterstevoren doorlopen zonder kopie.
    const toAddr = String(to).toLowerCase().trim();
    const EMAIL_RE_SENDER = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
    let lastIn = null;
    const msgsAll = db().messages;
    for (let i = msgsAll.length - 1; i >= 0; i--) {
      const m = msgsAll[i];
      if (m.channel !== 'email' || !m.externalId) continue;
      const em = ((String(m.sender || '').match(EMAIL_RE_SENDER) || [''])[0]).toLowerCase();
      if (em && em === toAddr) { lastIn = m; break; }
    }
    const sent = await sendMail({ to, subject, text, inReplyTo: lastIn ? lastIn.externalId : undefined });
    // Zet de mail ook in je IMAP Verzonden-map (best-effort, niet blokkerend), zodat
    // je 'm in TransIP/Outlook terugziet bij "Verzonden".
    appendSentMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER || '', to, subject, text }).catch(() => {});
    // Leg vast in de opdracht (indien meegegeven) en in de activiteit.
    if (orderId) {
      const order = db().orders.find((o) => o.id === orderId);
      if (order) {
        // Ons antwoord als bericht in de gesprekshistorie (zo blijft het gesprek
        // compleet op de kaart, met wie wat wanneer stuurde). messageId maakt een
        // bounce ("mail niet afgeleverd") later exact terug te koppelen.
        order.thread = order.thread || [];
        order.thread.push({
          id: id('thr'), channel: 'email', outgoing: true,
          sender: `${req.user.name} (Keyservice)`, subject, body: text, at: now(),
          messageId: (sent && sent.messageId) || undefined, sentTo: to,
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
  const mq = db()._mailboxQuota;
  res.json({
    v: changeVersion(),
    pendingReviews: db().reviews.filter((r) => r.status === 'pending').length,
    // Mailbox-vulgraad (alleen meegeven als bijna vol — anders blijft het stil).
    mailboxPct: (mq && mq.supported && mq.pct >= 90) ? mq.pct : null,
    mailboxBox: (mq && mq.supported && mq.pct >= 90 && mq.worstUser) ? String(mq.worstUser).split('@')[0] + '@' : null,
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
  // DASHBOARD-CONTEXT: kaarten, facturen/offertes, klanten en cijfers meegeven, zodat
  // de assistent ook vragen als "welke offertes staan open?" of "vergelijk juni met
  // juli" kan beantwoorden — en die kan kruisen met wat er in de groepen is gezegd.
  const includeDash = req.body?.scope !== 'messages';
  const dashboard = includeDash ? buildDashboardContext() : '';
  const modelPref = req.body?.model === 'opus' ? 'claude-opus-5'
    : req.body?.model === 'sonnet' ? 'claude-sonnet-5' : '';
  // Gespreksgeheugen: de browser stuurt de vorige vragen+antwoorden van dit gesprek mee.
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-6) : [];
  try {
    const out = await askAssistant({ question, messages: msgs, companyProfile: getCompanyProfile(), dashboard, model: modelPref, history });
    logActivity(req.user.name, 'AI-vraagbaak', question.slice(0, 80));
    res.json({ ...out, dashboardIncluded: !!dashboard });
  } catch (err) {
    res.status(500).json({ error: 'Mislukt: ' + err.message });
  }
});

// Compacte tekstweergave van het hele dashboard voor de AI-assistent. Bewust
// compact (alleen wat nodig is om vragen te beantwoorden) zodat er ruimte
// overblijft voor het berichtenverkeer.
function buildDashboardContext() {
  const maps = buildMaps();
  const labels = getStatusLabels();
  const eur = (n) => '€' + Number(n || 0).toFixed(2);
  const cName = (id) => (maps.customers.get(id) || {}).name || 'onbekend';
  const mName = (id) => (maps.monteurs.get(id) || {}).name || '';
  const orders = (db().orders || []).slice(-400);
  const kaarten = orders.map((o) => {
    const c = maps.customers.get(o.customerId) || {};
    const it = o.intake || {};
    return [
      `#${o.id.slice(-6)}`,
      `"${(o.title || '').slice(0, 60)}"`,
      `status=${labels[o.status] || o.status}`,
      `klant=${it.name || c.name || 'onbekend'}`,
      (it.address || c.address) ? `plaats=${String(it.address || c.address).slice(0, 40)}` : '',
      o.monteurId ? `monteur=${mName(o.monteurId)}` : '',
      o.appointmentAt ? `afspraak=${String(o.appointmentAt).replace('T', ' ').slice(0, 16)}` : '',
      o.price ? `prijs=${o.price}` : '',
      o.originGroup ? `bron=${String(o.originGroup).slice(0, 24)}` : '',
      `aangemaakt=${String(o.createdAt || '').slice(0, 10)}`,
      o.status === 'afgerond' && o.completedAt ? `afgerond=${String(o.completedAt).slice(0, 10)}` : '',
      (o.thread || []).length ? `berichten=${o.thread.length}` : '',
    ].filter(Boolean).join(' ');
  }).join('\n');
  const invs = (db().invoices || []).slice(-300).map((i) => [
    i.number || '(concept)',
    i.type === 'offerte' ? 'OFFERTE' : 'FACTUUR',
    `klant=${cName(i.customerId)}`,
    `bedrag=${eur(i.totalIncl)} (excl ${eur(i.totalExcl)})`,
    `status=${i.status}`,
    i.sentAt ? `verstuurd=${String(i.sentAt).slice(0, 10)}` : '',
    i.paidAt ? `betaald=${String(i.paidAt).slice(0, 10)}` : '',
  ].filter(Boolean).join(' ')).join('\n');
  // Cijfers van de lopende + vorige maand.
  const nu = new Date().toISOString().slice(0, 7);
  const vorige = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().slice(0, 7);
  const rap = (m) => { try { const r = monthReport(m, db().monteurs || []); return `${m}: omzet ${eur(r.income)}, kosten ${eur(r.expense)}, winst ${eur(r.profit)}`; } catch { return `${m}: n.v.t.`; } };
  const klanten = (db().customers || []).slice(-250)
    .map((c) => `${c.name || 'onbekend'}${c.phone ? ` tel=${c.phone}` : ''}${c.email ? ` mail=${c.email}` : ''}${c.address ? ` adres=${String(c.address).slice(0, 40)}` : ''}`).join('\n');
  return [
    `OPDRACHTKAARTEN (${orders.length} van ${(db().orders || []).length}):\n${kaarten || '(geen)'}`,
    `\nFACTUREN & OFFERTES (${(db().invoices || []).length}):\n${invs || '(geen)'}`,
    `\nCIJFERS:\n${rap(nu)}\n${rap(vorige)}`,
    `\nKLANTEN (${(db().customers || []).length} totaal, laatste ${Math.min(250, (db().customers || []).length)}):\n${klanten || '(geen)'}`,
  ].join('\n').slice(0, 120000);
}

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
// De status-scan draait als ACHTERGROND-job op de server, zodat hij doorloopt
// ook als de gebruiker de app wegswipet. Het laatste resultaat wordt bewaard.
let _statusScan = { running: false, startedAt: null };

async function computeStatusScan(days) {
  const since = Date.now() - days * 86400000;
  const active = db().orders
    .filter((o) => !o.archivedWeek && !['afgerond', 'geannuleerd'].includes(o.status))
    .map((o) => {
      const c = db().customers.find((x) => x.id === o.customerId) || {};
      const src = (o.source || '').toLowerCase();
      const isDrs = (o.originGroup && isWhatsappOrderGroup(o.originGroup))
        || (!o.originGroup && /whatsapp|groep|app/.test(src));
      // Het eigen verhaal van de kaart meegeven (gesprekshistorie + notities), want
      // het bewijs van de juiste status staat vaak ÓP de kaart, niet in losse berichten.
      const thread = (o.thread || []).slice(-4).map((t) =>
        `${t.outgoing ? 'wij' : 'klant'}: ${(t.body || '').replace(/\s+/g, ' ').slice(0, 160)}`);
      return {
        id: o.id, title: o.title, status: o.status, customer: c.name, phone: c.phone || '',
        address: c.address || '', isDrs,
        appointmentAt: o.appointmentAt || '', price: o.price || '',
        notes: (o.notes || '').replace(/\s+/g, ' ').slice(0, 200),
        thread,
      };
    })
    .slice(0, 300);
  // Berichten kiezen: groepsberichten (monteursrapport + DRS) ALTIJD meenemen — dat is
  // het bewijs voor de statussen — aangevuld met recente losse chat/e-mail. Zo kan een
  // stortvloed aan klantberichten de dagrapporten nooit verdringen.
  const byDateDesc = (a, b) => new Date(b.receivedAt) - new Date(a.receivedAt);
  const inWindow = db().messages.filter((m) => m.receivedAt && new Date(m.receivedAt).getTime() >= since);
  const groupMsgs = inWindow.filter((m) => m.group).sort(byDateDesc);
  const otherMsgs = inWindow.filter((m) => !m.group).sort(byDateDesc);
  const msgs = [...groupMsgs.slice(0, 400), ...otherMsgs.slice(0, 400)].sort(byDateDesc).slice(0, 700);
  // Telling per bron, zodat de gebruiker ziet of de monteursrapporten überhaupt binnenkomen.
  // Een groep die bij een monteur hoort (waGroup) telt als monteursgroep — betrouwbaarder
  // dan het opdracht-groepen-filter (dat bij leeg alles als DRS zou tellen).
  const monteurGroups = db().monteurs.map((m) => String(m.waGroup || '').toLowerCase().trim()).filter(Boolean);
  const isMonteurGrp = (name) => { const n = String(name || '').toLowerCase().trim(); return monteurGroups.some((g) => n === g || n.includes(g) || g.includes(n)); };
  const sources = { monteur: 0, drs: 0, email: 0, overig: 0 };
  for (const m of inWindow) {
    if (m.group) { if (isMonteurGrp(m.group)) sources.monteur++; else if (isWhatsappOrderGroup(m.group)) sources.drs++; else sources.monteur++; }
    else if (m.channel === 'email') sources.email++;
    else sources.overig++;
  }
  const out = await suggestStatusChanges({ orders: active, messages: msgs, statuses: getStatuses(), companyProfile: getCompanyProfile(), monteurGroups: db().monteurs.map((m) => m.waGroup).filter(Boolean) });
  const labels = getStatusLabels();
  // De AI mag verwijzen met "#12" (volgnummer in de meegestuurde lijst) of het echte id.
  // Volgnummers zijn betrouwbaarder dan lange hex-ids (één verhaspeld teken = weggegooid
  // voorstel). Afgevallen voorstellen worden geteld en gemeld — nooit meer stil.
  let dropped = 0;
  const resolveOrder = (ref) => {
    const r = String(ref || '').trim();
    const num = r.match(/^#?(\d{1,3})$/);
    if (num) { const a = active[Number(num[1]) - 1]; if (a) return db().orders.find((o) => o.id === a.id); }
    return db().orders.find((o) => o.id === r);
  };
  const suggestions = (out.statusChanges || []).map((s) => {
    const order = resolveOrder(s.orderId);
    if (!order || !isValidStatus(s.suggestedStatus)) { dropped++; return null; }
    if (order.status === s.suggestedStatus) return null; // staat al goed — geen fout
    return {
      orderId: order.id, title: order.title,
      from: order.status, fromLabel: labels[order.status] || order.status,
      to: s.suggestedStatus, toLabel: labels[s.suggestedStatus] || s.suggestedStatus,
      reason: s.reason || '', evidence: s.evidence || '',
    };
  }).filter(Boolean);
  const needsDrsUpdate = (out.needsDrsUpdate || []).map((s) => {
    const order = resolveOrder(s.orderId);
    if (!order) { dropped++; return null; }
    const c = db().customers.find((x) => x.id === order.customerId) || {};
    return {
      orderId: order.id, title: order.title,
      statusLabel: labels[order.status] || order.status,
      customer: c.name || '', address: c.address || '',
      reason: s.reason || '', suggestedText: s.suggestedText || '',
    };
  }).filter(Boolean);
  let note = out.note || '';
  if (dropped) note = `${note ? note + ' ' : ''}(${dropped} AI-voorstel(len) afgevallen wegens onherkenbaar kaart-id of ongeldige status.)`;
  console.log(`[statusscan] AI gaf ${(out.statusChanges || []).length} statusvoorstellen; ${suggestions.length} bruikbaar, ${dropped} afgevallen.`);
  return { at: now(), days, scanned: msgs.length, cards: active.length, sources, suggestions, needsDrsUpdate, engine: out.engine, note, rawSample: out.rawSample || '' };
}

async function runStatusScanJob(days) {
  if (_statusScan.running) return;
  _statusScan = { running: true, startedAt: now() };
  try {
    const result = await computeStatusScan(days);
    db().settings._lastStatusScan = result; // bewaren zodat het bij heropenen blijft staan
    save();
  } catch (e) {
    db().settings._lastStatusScan = { at: now(), days, error: e.message, suggestions: [], needsDrsUpdate: [] };
    save();
    console.error('[statusscan] mislukt:', e.message);
  } finally {
    _statusScan = { running: false, startedAt: null };
  }
}

// Scan starten (achtergrond) — keert meteen terug; resultaat komt later via /result.
app.post('/api/assistant/status-scan/start', requireRole('admin', 'assistent'), (req, res) => {
  const days = Number(req.body?.days) || 30;
  if (!_statusScan.running) runStatusScanJob(days); // niet awaiten: draait door
  res.json({ running: true, startedAt: _statusScan.startedAt || now() });
});

// Status + laatste resultaat ophalen (voor pollen én tonen bij heropenen).
app.get('/api/assistant/status-scan/result', requireRole('admin', 'assistent'), (req, res) => {
  res.json({ running: _statusScan.running, startedAt: _statusScan.startedAt, last: db().settings._lastStatusScan || null });
});
// Markeer een toegepast/genegeerd voorstel op de laatste scan (blijft zo tot een nieuwe scan).
app.post('/api/assistant/status-scan/applied', requireRole('admin', 'assistent'), (req, res) => {
  const last = db().settings._lastStatusScan;
  if (!last) return res.json({ ok: true });
  const ids = Array.isArray(req.body?.orderIds) ? req.body.orderIds : (req.body?.orderId ? [req.body.orderId] : []);
  last.appliedIds = Array.from(new Set([...(last.appliedIds || []), ...ids.map(String)]));
  save();
  res.json({ ok: true, appliedIds: last.appliedIds });
});

// (Compat) directe synchrone scan — nog gebruikt door oudere clients.
app.post('/api/assistant/status-scan', requireRole('admin', 'assistent'), async (req, res) => {
  const days = Number(req.body?.days) || 30;
  try {
    const result = await computeStatusScan(days);
    db().settings._lastStatusScan = result; save();
    res.json({ suggestions: result.suggestions, needsDrsUpdate: result.needsDrsUpdate, engine: result.engine, note: result.note });
  } catch (err) {
    res.status(500).json({ error: 'Mislukt: ' + err.message });
  }
});

// Geheime token voor de iCal-feed (1x gegenereerd, in settings bewaard).
function getCalendarToken() {
  const s = db().settings;
  if (!s.calendarToken) { s.calendarToken = id('caltok'); save(); }
  return s.calendarToken;
}

// iCal-feed van alle afspraken — abonneer hierop in Google Agenda ("Via URL toevoegen").
// Google ververst periodiek, dus nieuwe/gewijzigde afspraken verschijnen vanzelf.
app.get('/api/calendar.ics', (req, res) => {
  if (!req.query.token || req.query.token !== getCalendarToken()) return res.status(401).send('Ongeldig of ontbrekend token');
  const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // UTC voor DTSTAMP
  // Afspraaktijd is ingevoerd als lokale (NL) tijd zonder tijdzone. We geven 'm als
  // "floating" lokale tijd door (geen Z), zodat Google de tijd toont zoals ingevoerd.
  const local = (dtstr, addMin = 0) => {
    const m = String(dtstr).match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
    d.setUTCMinutes(d.getUTCMinutes() + addMin);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}00`;
  };
  const esc = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\r?\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Keyservice CRM//NL', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Keyservice afspraken', 'X-WR-TIMEZONE:Europe/Amsterdam'];
  for (const o of db().orders) {
    if (!o.appointmentAt || o.archivedWeek || o.status === 'geannuleerd') continue;
    const ds = local(o.appointmentAt); if (!ds) continue;
    // Eindtijd: gebruik de opgegeven eindtijd als die ná de begintijd ligt, anders +1 uur.
    let de = o.appointmentEndAt ? local(o.appointmentEndAt) : null;
    if (!de || de <= ds) de = local(o.appointmentAt, 60);
    const c = db().customers.find((x) => x.id === o.customerId) || {};
    lines.push('BEGIN:VEVENT', `UID:${o.id}@keyservice-crm`, `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${ds}`, `DTEND:${de}`,
      `SUMMARY:${esc(o.title + (c.name ? ' - ' + c.name : ''))}`,
      `DESCRIPTION:${esc([c.phone ? 'Tel: ' + c.phone : '', o.description || ''].filter(Boolean).join('\n'))}`,
      `LOCATION:${esc(c.address || '')}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.send(lines.join('\r\n'));
});

// Agenda: alle (actieve) opdrachten met een afspraakdatum, voor de agenda-pagina.
// isDrs = afkomstig uit de DRS/opdracht-WhatsApp-groep (originGroup of WhatsApp-bron).
app.get('/api/agenda', requireAuth, (req, res) => {
  const labels = getStatusLabels();
  const maps = buildMaps();
  const items = db().orders
    .filter((o) => o.appointmentAt && !o.archivedWeek && !['geannuleerd'].includes(o.status))
    .filter((o) => req.user.role !== 'monteur' || (o.monteurId && o.monteurId === req.user.monteurId))
    .map((o) => {
      const c = maps.customers.get(o.customerId) || {};
      const m = maps.monteurs.get(o.monteurId) || null;
      const src = (o.source || '').toLowerCase();
      const isDrs = (o.originGroup && isWhatsappOrderGroup(o.originGroup))
        || (!o.originGroup && /whatsapp|groep|app/.test(src));
      return {
        id: o.id, title: o.title, at: o.appointmentAt, endAt: o.appointmentEndAt || null, status: o.status, statusLabel: labels[o.status] || o.status,
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
  // WhatsApp/DRS/Raf Breda-opdrachten komen via de groep binnen en worden via de
  // status-scan/monteur-flow afgehandeld — die horen NIET in "Nog niet bekeken".
  // Die lijst is alleen voor opdrachten die een mens echt moet openen (e-mail/website/tel).
  const isWhatsappOrder = (o) => {
    const src = (o.source || '').toLowerCase();
    return (o.originGroup && isWhatsappOrderGroup(o.originGroup)) || /whats\s?app|drs|raf breda|groep/.test(src);
  };
  const neverOpened = active.filter((o) => !o.openedAt && !isWhatsappOrder(o))
    .map((o) => ({ id: o.id, title: o.title }));
  // Wacht op ons antwoord: offerte-fase of open, nog geen antwoord gestuurd.
  // NIET tonen als: al naar de monteur gestuurd (die belt de klant), of als er een
  // notitie staat dat het contact al via WhatsApp loopt.
  const viaWhatsappNote = (o) => /whats\s?app/i.test(o.notes || '');
  const awaitingReply = active.filter((o) =>
    !o.lastReplyAt &&
    !o.sentToMonteur &&
    !viaWhatsappNote(o) &&
    ['open', firstStatusKey(), 'offerte_verzonden'].includes(o.status))
    .map((o) => ({ id: o.id, title: o.title }));
  // Lang stil: geen update in 5+ dagen, niet afgerond/geannuleerd.
  const fiveDays = Date.now() - 5 * 86400000;
  const stale = active.filter((o) => !['afgerond', 'geannuleerd'].includes(o.status) && new Date(o.updatedAt).getTime() < fiveDays)
    .map((o) => ({ id: o.id, title: o.title, since: o.updatedAt }));

  const custName = (o) => (db().customers.find((c) => c.id === o.customerId) || {}).name;
  // Afspraken: vandaag, en deze kalenderweek (maandag t/m zondag).
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const endToday = startToday.getTime() + 86400000;
  const wk = weekBounds();
  const apptList = active
    .filter((o) => o.appointmentAt && !['afgerond', 'geannuleerd'].includes(o.status))
    .map((o) => ({ id: o.id, title: o.title, customer: custName(o), at: o.appointmentAt, t: new Date(o.appointmentAt).getTime() }))
    .filter((a) => !isNaN(a.t))
    .sort((a, b) => a.t - b.t);
  const todayAppointments = apptList.filter((a) => a.t >= startToday.getTime() && a.t < endToday);
  const weekAppointments = apptList.filter((a) => a.t >= wk.start && a.t < wk.end);
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

// Prijsveld ("740", "€ 740,-", "1.250,50") -> getal in euro's. 0 als onleesbaar.
function parsePrice(str) {
  let s = String(str || '').replace(/[^\d.,]/g, '');
  if (!s) return 0;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, ''); // 1.250 -> 1250
  s = s.replace(',', '.');
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

// Weekrapport: aantallen, omzet en conversie per monteur (maandag t/m zondag).
// ?offset=0 is deze week, 1 = vorige week, enz.
app.get('/api/report/week', requireRole('admin', 'assistent'), (req, res) => {
  const offset = Math.max(0, Math.min(52, Number(req.query.offset) || 0));
  const ref = new Date(Date.now() - offset * 7 * 86400000);
  const wk = weekBounds(ref);
  const inWeek = (d) => { const t = new Date(d).getTime(); return !isNaN(t) && t >= wk.start && t < wk.end; };

  const monteurMap = new Map(db().monteurs.map((m) => [m.id, { id: m.id, name: m.name, afgerond: 0, omzet: 0, afspraken: 0, actief: 0 }]));
  const none = { id: '', name: 'Geen monteur', afgerond: 0, omzet: 0, afspraken: 0, actief: 0 };

  let newOrders = 0, doneCount = 0, cancelCount = 0, omzet = 0, apptCount = 0;
  for (const o of db().orders.concat(db().trash || [])) {
    const row = monteurMap.get(o.monteurId) || none;
    if (inWeek(o.createdAt)) newOrders++;
    if (o.appointmentAt && inWeek(o.appointmentAt)) { apptCount++; row.afspraken++; }
    const doneAt = o.completedAt || (o.status === 'afgerond' ? o.updatedAt : null);
    if (o.status === 'afgerond' && doneAt && inWeek(doneAt)) {
      doneCount++; row.afgerond++;
      const p = parsePrice(o.price);
      omzet += p; row.omzet += p;
    }
    if (o.status === 'geannuleerd' && inWeek(o.updatedAt)) cancelCount++;
    if (!o.archivedWeek && !['afgerond', 'geannuleerd'].includes(o.status) && o.monteurId && monteurMap.has(o.monteurId)) {
      monteurMap.get(o.monteurId).actief++;
    }
  }
  const aanvragen = db().reviews.filter((r) => inWeek(r.createdAt)).length;
  const perMonteur = [...monteurMap.values(), ...(none.afgerond || none.afspraken || none.omzet ? [none] : [])]
    .sort((a, b) => b.omzet - a.omzet || b.afgerond - a.afgerond);
  res.json({
    weekStart: new Date(wk.start).toISOString(), weekEnd: new Date(wk.end).toISOString(),
    aanvragen, newOrders, apptCount, doneCount, cancelCount,
    omzet: Math.round(omzet * 100) / 100,
    conversie: newOrders ? Math.round((doneCount / newOrders) * 100) : null,
    perMonteur,
  });
});

// Abonnementen-overzicht + (geschat) AI-verbruik via dit dashboard.
app.get('/api/subscriptions', requirePerm('system'), (req, res) => {
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
app.get('/api/health', requirePerm('system'), async (req, res) => {
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
// Bijlages: ingelogde gebruikers, ÓF de bridge met het ingest-token (die haalt
// aangevinkte foto's op om ze naar de monteur-groep te sturen).
const allowUploadAccess = (req, res, next) => {
  const tok = req.headers['x-ingest-token'] || req.query.token;
  if (tok && process.env.INGEST_TOKEN && tok === process.env.INGEST_TOKEN) return next();
  return requireAuth(req, res, next);
};
app.get('/uploads/:file', allowUploadAccess, (req, res) => {
  if (!/^att_[a-zA-Z0-9_.]+$/.test(req.params.file)) return res.status(400).end();
  // Veilig serveren: een klant kan via e-mail/WhatsApp een bijlage sturen. Alleen
  // afbeeldingen/PDF's tonen we inline (voor de fotoviewer); al het andere (bv. .html
  // of .svg met verborgen script) wordt geforceerd gedownload i.p.v. uitgevoerd in
  // onze eigen origin. nosniff voorkomt dat de browser het type zelf herinterpreteert.
  const ext = (req.params.file.split('.').pop() || '').toLowerCase();
  // Video's en spraakberichten (WhatsApp) spelen gewoon af in de browser; alleen
  // actieve inhoud (html/svg met script) blijft geforceerd downloaden.
  const inlineOk = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf',
    'mp4', 'mov', 'webm', 'm4v', '3gp', 'mkv',
    'mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'amr'].includes(ext);
  res.set('X-Content-Type-Options', 'nosniff');
  if (!inlineOk) res.set('Content-Disposition', `attachment; filename="${req.params.file}"`);
  if (ext === 'mov') res.type('video/quicktime');
  if (ext === 'opus' || ext === 'oga') res.type('audio/ogg');
  if (ext === 'amr') res.type('audio/amr');
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
  // Eenmalige veilige opruiming: bestaande dubbele foto's (zelfde inhoud) op kaarten
  // en berichten ontdubbelen — alleen dubbele verwijzingen weg, bestanden blijven staan.
  try {
    if (!db().settings._attDedupV1) {
      let removed = 0;
      for (const o of db().orders || []) {
        if (o.attachments) { const r = dedupeListEntries(o.attachments); o.attachments = r.list; removed += r.removed; }
        for (const t of o.thread || []) if (t.attachments) { const r = dedupeListEntries(t.attachments); t.attachments = r.list; removed += r.removed; }
      }
      for (const m of db().messages || []) if (m.attachments) { const r = dedupeListEntries(m.attachments); m.attachments = r.list; removed += r.removed; }
      db().settings._attDedupV1 = true;
      if (removed) console.log(`[bijlage-dedup] ${removed} dubbele foto-verwijzing(en) opgeruimd`);
      save();
    }
  } catch (e) { console.error('[bijlage-dedup]', e.message); }
  // Eenmalige opschoning: NEP-correcties uit het AI-feedback-geheugen. Door een
  // vergelijkingsfout telde élke gewone goedkeuring als "mens koos nieuw"-correctie
  // (honderden stuks) — dat vervuilde de leervoorbeelden die naar de AI meegaan én
  // maakte de "juist ingedeeld"-statistiek onzin. Echte correcties (mens koos een
  // andere kolom) blijven volledig staan.
  try {
    if (!db().settings._fbNoiseV1) {
      const before = (db().feedback || []).length;
      db().feedback = (db().feedback || []).filter((f) => !(f.type === 'correction' && f.shouldBe === 'nieuw'));
      const removed = before - db().feedback.length;
      // Ook de reviews-teller herstellen: "correctie naar nieuw" was nooit een echte correctie.
      let fixedReviews = 0;
      for (const r of db().reviews || []) {
        if (r.correctedStatus === 'nieuw') { r.correctedStatus = null; fixedReviews++; }
      }
      db().settings._fbNoiseV1 = true;
      if (removed || fixedReviews) logActivity('systeem', 'AI-leerdata opgeschoond', `${removed} nep-correcties verwijderd, ${fixedReviews} statistiek-vlaggen hersteld`);
      save();
    }
  } catch (e) { console.error('[feedback-opschoning]', e.message); }
  // Eenmalige heling: in de herinnering-sjabloon stond het woord "morgen" hard
  // ingetypt — klopte alleen als de herinnering precies een dag vooraf ging. Bij een
  // zelfde-dag-afspraak kreeg de klant dus "morgen" terwijl het vandaag was
  // (Scheepers-casus 28 jul). Het woord wordt vervangen door de variabele {dag},
  // die per bericht "vandaag"/"morgen"/"overmorgen"/dagnaam invult.
  try {
    if (!db().settings._apptDagV1) {
      const a = db().settings.appointmentMsg;
      if (a && a.reminderBody && /\b(morgen|vandaag)\b/i.test(a.reminderBody) && !a.reminderBody.includes('{dag}')) {
        a.reminderBody = a.reminderBody.replace(/\b(?:morgen|vandaag)\b/gi, '{dag}');
        logActivity('systeem', 'herinnering-sjabloon geheeld', '"morgen" vervangen door {dag} (klopt nu op elke dag)');
      }
      db().settings._apptDagV1 = true;
      save();
    }
  } catch (e) { console.error('[sjabloon-heling]', e.message); }
  // Storing-herstel in vaste volgorde: eerst "groep <id>" → echte naam helen (bron-chip
  // klopt weer, ook op bestaande kaarten), dan mislukte groeps-berichten opnieuw in de
  // wachtrij, dan gemiste opdrachten alsnog automatisch naar de monteur.
  healGroupIdNames();
  requeueRecentFailedGroupItems();
  maybeCatchUpDispatch();
  startEmailPoller();
  startWeeklyArchiver();
  startHealthMonitor();
  startBackups();
  startFollowUps();
  startBackupMail();
  startAutomations({ runStatusScan: runStatusScanJob });
  console.log('');
});

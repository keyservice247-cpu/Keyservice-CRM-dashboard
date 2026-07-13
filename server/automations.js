// Automatiseringen rond de opdracht-lus: terugkoppeling via de controle-groep,
// afspraakbevestiging + herinnering naar de klant, review-verzoek na afronding,
// snooze-herinneringen, uitval-alarm (bridge/e-mail/AI) en de nachtelijke statusscan.
import { db, id, now, save, saveSoon, logActivity } from './db.js';
import {
  getTerugkoppeling, getAppointmentMsg, getReviewRequest, getEmailSignature,
  getStatusLabels, isWhatsappOrderGroup, getBackupMail,
} from './settings.js';
import { sendMail, smtpConfigured } from './connectors/email-smtp.js';
import { sendPush } from './push.js';
import { lastHealth } from './health.js';
import { getFinanceSettings, weeklyReportData, bookRecurringDue } from './finance.js';
import { checkMailboxQuota } from './connectors/email-imap.js';
import { queueCrmWhatsappAlert } from './pipeline.js';

const custOf = (o) => db().customers.find((c) => c.id === o.customerId) || {};
const fill = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));

// We werken met TIJDSBLOKKEN (standaard 3 uur, instelbaar). De eindtijd is de expliciete
// afspraak-eindtijd als die er is, anders begintijd + het ingestelde aantal uren.
const blockHours = () => getAppointmentMsg().blockHours || 3;
function apptVars(order, customer) {
  const m = String(order.appointmentAt || '').match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  let datum = '', start = '', eind = '';
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    datum = d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
    start = `${m[4]}:${m[5]}`;
    const em = String(order.appointmentEndAt || '').match(/T(\d{2}):(\d{2})/);
    if (em) eind = `${em[1]}:${em[2]}`;
    else eind = `${String((Number(m[4]) + blockHours()) % 24).padStart(2, '0')}:${m[5]}`;
  }
  const tijdblok = start ? `tussen ${start} en ${eind}` : '';
  // {tijd} toont voortaan het hele blok (bv. "15:00 - 18:00") zodat bestaande sjablonen
  // met {tijd} meteen het tijdsblok tonen. {tijdblok} = "tussen 15:00 en 18:00".
  return { naam: customer.name || 'klant', datum, tijd: start ? `${start} - ${eind}` : '', tijdblok, start, eind };
}

// ---------- 1. Terugkoppeling via de controle-groep (bv. Abdel) ----------
// DRS-opdracht krijgt een uitkomst-status -> WhatsApp-bericht naar de groep van de
// gekozen controle-monteur, die het checkt en zelf doorstuurt naar de DRS-groep.
export function maybeSendTerugkoppeling(order) {
  try {
    const cfg = getTerugkoppeling();
    if (!cfg.enabled || !cfg.monteurId) return;
    if (!cfg.statuses.includes(order.status)) return;
    const isDrs = order.originGroup ? isWhatsappOrderGroup(order.originGroup)
      : /whatsapp|groep|app/.test((order.source || '').toLowerCase());
    if (!isDrs) return;
    if (order.terugkoppeling && order.terugkoppeling.status === order.status) return; // al gemeld
    const monteur = db().monteurs.find((m) => m.id === cfg.monteurId);
    if (!monteur || !monteur.waGroup) return;
    const c = custOf(order);
    const labels = getStatusLabels();
    const lines = [
      '*Terugkoppeling voor DRS* — graag controleren en doorsturen',
      `${order.title}`,
      `${c.name ? 'Klant: ' + c.name : ''}${c.address ? ' — ' + c.address : ''}`.trim(),
      `Status: ${labels[order.status] || order.status}${order.appointmentAt ? ` (${order.appointmentAt.replace('T', ' ')})` : ''}${order.price ? ` — ${order.price}` : ''}`,
    ].filter(Boolean);
    db().outbox.unshift({
      id: id('out'), orderId: order.id, group: monteur.waGroup, monteurName: monteur.name,
      text: lines.join('\n'), status: 'queued', createdAt: now(), by: 'terugkoppeling',
    });
    order.terugkoppeling = { status: order.status, at: now() };
    logActivity('systeem', 'terugkoppeling in wachtrij', `${order.title} -> ${monteur.name}`);
    saveSoon();
  } catch (e) { console.error('[terugkoppeling]', e.message); }
}

// ---------- 2. Afspraakbevestiging naar de klant ----------
export async function maybeSendAppointmentConfirm(order) {
  try {
    const cfg = getAppointmentMsg();
    if (!cfg.emailEnabled && !cfg.whatsappEnabled) return;
    if (!order.appointmentAt || ['afgerond', 'geannuleerd'].includes(order.status)) return;
    if (order.apptMsg && order.apptMsg.confirmedFor === order.appointmentAt) return; // al bevestigd
    const c = custOf(order);
    const vars = apptVars(order, c);
    let sent = false;
    if (cfg.emailEnabled && c.email && smtpConfigured()) {
      const sig = getEmailSignature();
      const body = fill(cfg.emailBody, vars);
      try {
        await sendMail({ to: c.email, subject: fill(cfg.emailSubject, vars), text: sig ? `${body}\n\n${sig}` : body });
        order.thread = order.thread || [];
        order.thread.push({ id: id('thr'), channel: 'email', outgoing: true, sender: 'Keyservice (afspraakbevestiging)', subject: fill(cfg.emailSubject, vars), body, at: now() });
        sent = true;
      } catch (e) { console.error('[afspraakbevestiging] e-mail mislukt:', e.message); }
    } else if (cfg.whatsappEnabled && c.phone) {
      const body = fill(cfg.whatsappBody, vars);
      db().outbox.unshift({ id: id('out'), kind: 'whatsapp_customer', phone: c.phone, group: '__klant_dm__', text: body, orderId: order.id, status: 'queued', createdAt: now(), by: 'afspraakbevestiging' });
      order.thread = order.thread || [];
      order.thread.push({ id: id('thr'), channel: 'whatsapp', outgoing: true, sender: 'Keyservice (afspraakbevestiging)', body, at: now() });
      sent = true;
    }
    if (sent) {
      order.apptMsg = { ...(order.apptMsg || {}), confirmedFor: order.appointmentAt, confirmedAt: now() };
      order.updatedAt = now();
      logActivity('systeem', 'afspraakbevestiging verstuurd', order.title);
      saveSoon();
    }
  } catch (e) { console.error('[afspraakbevestiging]', e.message); }
}

// ---------- 2b. Afspraak geannuleerd -> klant op de hoogte ----------
// Wordt aangeroepen wanneer een afspraakdatum van een opdracht wordt weggehaald.
// Stuurt (indien gevraagd of als de afspraakberichten aanstaan) een net annulerings-
// bericht naar de klant, via hetzelfde kanaal als de bevestiging.
export async function maybeSendAppointmentCancel(order, prevAppt, opts = {}) {
  try {
    const cfg = getAppointmentMsg();
    // Alleen sturen als expliciet gevraagd (knop) OF de afspraakberichten aanstaan.
    if (!opts.notify && !cfg.emailEnabled && !cfg.whatsappEnabled) return;
    const c = custOf(order);
    const m = String(prevAppt || '').match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    let wanneer = '';
    if (m) {
      const d = new Date(+m[1], +m[2] - 1, +m[3]);
      const eind = `${String((Number(m[4]) + blockHours()) % 24).padStart(2, '0')}:${m[5]}`;
      wanneer = `${d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })} tussen ${m[4]}:${m[5]} en ${eind}`;
    }
    const naam = c.name || 'klant';
    const body = `Beste ${naam},\n\nUw geplande afspraak${wanneer ? ` van ${wanneer}` : ''} is geannuleerd. Wilt u een nieuwe afspraak inplannen? Neem gerust contact met ons op, dan plannen we samen een nieuw moment.\n\nMet vriendelijke groet,\nKeyservice`;
    const subject = 'Uw afspraak is geannuleerd';
    let sent = false;
    if ((opts.notify || cfg.emailEnabled) && c.email && smtpConfigured()) {
      const sig = getEmailSignature();
      try {
        await sendMail({ to: c.email, subject, text: sig ? `${body}\n\n${sig}` : body });
        order.thread = order.thread || [];
        order.thread.push({ id: id('thr'), channel: 'email', outgoing: true, sender: 'Keyservice (annulering)', subject, body, at: now() });
        sent = true;
      } catch (e) { console.error('[annulering] e-mail mislukt:', e.message); }
    } else if ((opts.notify || cfg.whatsappEnabled) && c.phone) {
      db().outbox.unshift({ id: id('out'), kind: 'whatsapp_customer', phone: c.phone, group: '__klant_dm__', text: body, orderId: order.id, status: 'queued', createdAt: now(), by: 'afspraak-annulering' });
      order.thread = order.thread || [];
      order.thread.push({ id: id('thr'), channel: 'whatsapp', outgoing: true, sender: 'Keyservice (annulering)', body, at: now() });
      sent = true;
    }
    if (sent) {
      // Reset de bevestig-status zodat een nieuwe afspraak later weer netjes bevestigd wordt.
      order.apptMsg = { ...(order.apptMsg || {}), confirmedFor: null, cancelledAt: now() };
      order.updatedAt = now();
      logActivity('systeem', 'annuleringsbericht verstuurd', order.title);
      saveSoon();
    }
  } catch (e) { console.error('[annulering]', e.message); }
}

// ---------- 3. Afspraakherinnering (X uur vooraf) ----------
async function runAppointmentReminders() {
  const cfg = getAppointmentMsg();
  if (!cfg.reminderEnabled || (!cfg.emailEnabled && !cfg.whatsappEnabled)) return;
  const nowMs = Date.now();
  const windowMs = cfg.reminderHours * 3600000;
  for (const o of db().orders) {
    if (!o.appointmentAt || o.archivedWeek || ['afgerond', 'geannuleerd'].includes(o.status)) continue;
    const t = new Date(o.appointmentAt).getTime();
    if (isNaN(t) || t < nowMs || t - nowMs > windowMs) continue;
    if (o.apptMsg && o.apptMsg.remindedFor === o.appointmentAt) continue;
    const c = custOf(o);
    const vars = apptVars(o, c);
    let sent = false;
    if (cfg.emailEnabled && c.email && smtpConfigured()) {
      const sig = getEmailSignature();
      const body = fill(cfg.reminderBody, vars);
      try {
        await sendMail({ to: c.email, subject: fill(cfg.reminderEmailSubject, vars), text: sig ? `${body}\n\n${sig}` : body });
        o.thread = o.thread || []; o.thread.push({ id: id('thr'), channel: 'email', outgoing: true, sender: 'Keyservice (herinnering)', subject: fill(cfg.reminderEmailSubject, vars), body, at: now() });
        sent = true;
      } catch (e) { console.error('[herinnering] e-mail mislukt:', e.message); }
    } else if (cfg.whatsappEnabled && c.phone) {
      const body = fill(cfg.reminderBody, vars);
      db().outbox.unshift({ id: id('out'), kind: 'whatsapp_customer', phone: c.phone, group: '__klant_dm__', text: body, orderId: o.id, status: 'queued', createdAt: now(), by: 'afspraakherinnering' });
      o.thread = o.thread || []; o.thread.push({ id: id('thr'), channel: 'whatsapp', outgoing: true, sender: 'Keyservice (herinnering)', body, at: now() });
      sent = true;
    }
    if (sent) {
      o.apptMsg = { ...(o.apptMsg || {}), remindedFor: o.appointmentAt, remindedAt: now() };
      o.updatedAt = now();
      logActivity('systeem', 'afspraakherinnering verstuurd', o.title);
      saveSoon();
    }
  }
}

// ---------- 4. Review-verzoek na afronding ----------
async function runReviewRequests() {
  const cfg = getReviewRequest();
  if (!cfg.enabled || !cfg.link || !smtpConfigured()) return;
  const cutoff = Date.now() - cfg.delayHours * 3600000;
  for (const o of db().orders) {
    if (o.status !== 'afgerond' || o.reviewRequested) continue;
    const doneAt = o.completedAt || o.updatedAt;
    if (!doneAt || new Date(doneAt).getTime() > cutoff) continue;
    const c = custOf(o);
    if (!c.email) { o.reviewRequested = 'geen-email'; continue; } // niet elke keer opnieuw checken
    const vars = { naam: c.name || 'klant', link: cfg.link };
    try {
      const sig = getEmailSignature();
      const body = fill(cfg.body, vars);
      await sendMail({ to: c.email, subject: fill(cfg.subject, vars), text: sig ? `${body}\n\n${sig}` : body });
      o.thread = o.thread || [];
      o.thread.push({ id: id('thr'), channel: 'email', outgoing: true, sender: 'Keyservice (review-verzoek)', subject: fill(cfg.subject, vars), body, at: now() });
      o.reviewRequested = now();
      o.updatedAt = now();
      logActivity('systeem', 'review-verzoek verstuurd', `${o.title} -> ${c.email}`);
      saveSoon();
    } catch (e) { console.error('[review-verzoek] mislukt:', e.message); }
  }
}

// ---------- 5. Snooze / opvolg-herinneringen ----------
async function runSnoozeChecks() {
  let changed = 0;
  for (const o of db().orders) {
    if (!o.snoozeAt || o.archivedWeek) continue;
    if (new Date(o.snoozeAt).getTime() > Date.now()) continue;
    o.snoozeAt = null;
    o.snoozeDue = true;
    o.updatedAt = now();
    changed++;
    const c = custOf(o);
    sendPush({ title: 'Opvolgen', body: `${o.title}${c.name ? ' — ' + c.name : ''}`, url: '/' }).catch(() => {});
    logActivity('systeem', 'opvolg-herinnering', o.title);
  }
  if (changed) saveSoon();
}

// ---------- 6. Uitval-alarm (bridge / e-mail / AI) ----------
const BRIDGE_DOWN_MS = 12 * 60 * 1000;
async function alertAdmins(title, body) {
  sendPush({ title, body, url: '/' }).catch(() => {});
  const to = getBackupMail().email; // zelfde adres als de back-up-mail (indien ingesteld)
  if (to && smtpConfigured()) { try { await sendMail({ to, subject: `⚠ ${title} — Keyservice CRM`, text: body }); } catch { /* push is al weg */ } }
  logActivity('systeem', 'alarm', `${title}: ${body}`);
}

async function runWatchdog() {
  const s = db().settings;
  s._alerts = s._alerts || {};
  // WhatsApp-bridge: heartbeat ouder dan 12 min = uitgevallen.
  if (s.whatsappLastSeen) {
    const down = Date.now() - new Date(s.whatsappLastSeen).getTime() > BRIDGE_DOWN_MS;
    if (down && !s._alerts.bridge) {
      s._alerts.bridge = now(); save();
      await alertAdmins('WhatsApp-bridge gestopt', 'De WhatsApp-verbinding laat niets meer van zich horen. Nieuwe WhatsApp-berichten komen NIET binnen. Check de VPS (pm2 restart wa).');
    } else if (!down && s._alerts.bridge) {
      delete s._alerts.bridge; save();
      await alertAdmins('WhatsApp-bridge weer actief', 'De WhatsApp-verbinding doet het weer. Berichten komen weer binnen.');
    }
  }
  // Systeemcheck-onderdelen (SMTP/AI/database) die falen.
  const h = lastHealth();
  if (h) {
    for (const key of ['smtp', 'ai', 'database']) {
      const part = h[key];
      if (!part) continue;
      const bad = part.ok === false;
      if (bad && !s._alerts[key]) {
        s._alerts[key] = now(); save();
        await alertAdmins(`Probleem met ${key === 'smtp' ? 'e-mail versturen' : key === 'ai' ? 'de AI' : 'de database'}`, part.detail || 'Zie AI-controle → Systeemcheck.');
      } else if (!bad && s._alerts[key]) {
        delete s._alerts[key]; save();
      }
    }
  }
}

// ---------- 6b. Wekelijks CEO-rapport (euro's + kansen) ----------
const eur = (n) => '€ ' + Number(n || 0).toFixed(2).replace('.', ',');
export async function sendWeeklyCeoReport(toOverride = '', isTest = false) {
  const cfg = getFinanceSettings().weeklyReport;
  const to = (toOverride || cfg.email || '').trim();
  if (!to || !smtpConfigured()) return false;
  const d = weeklyReportData(db().monteurs || []);
  const pijl = d.thisWeek.profit >= d.lastWeek.profit ? '▲' : '▼';
  const lines = [
    `${isTest ? '[TEST] ' : ''}Wekelijks overzicht — Key Service 24/7`,
    '',
    'DEZE WEEK',
    `• Omzet: ${eur(d.thisWeek.income)}`,
    `• Kosten: ${eur(d.thisWeek.expense)}`,
    `• Winst: ${eur(d.thisWeek.profit)}  (vorige week ${eur(d.lastWeek.profit)} ${pijl})`,
    '',
    'DEZE MAAND TOT NU',
    `• Omzet: ${eur(d.monthIncome)} · Winst: ${eur(d.monthProfit)}`,
    '',
    'AANDACHT',
    `• Nieuwe/te-controleren leads (7 dagen): ${d.newLeads}`,
    `• Openstaande facturen: ${d.unpaidCount} (${eur(d.unpaidTotal)})${d.overdueCount ? ` — waarvan ${d.overdueCount} VERLOPEN` : ''}`,
    `• Opdrachten 5+ dagen stil: ${d.staleOrders}`,
    '',
    'Open het dashboard voor de details: https://keyservice-crm.onrender.com/',
  ];
  const sig = getEmailSignature();
  await sendMail({ to, subject: `${isTest ? '[TEST] ' : ''}Wekelijks overzicht — winst ${eur(d.thisWeek.profit)}`, text: sig ? `${lines.join('\n')}\n\n${sig}` : lines.join('\n') });
  if (!isTest) { db().settings._lastWeeklyReport = new Date().toISOString().slice(0, 10); save(); }
  logActivity('systeem', `wekelijks CEO-rapport ${isTest ? '(test) ' : ''}verstuurd`, to);
  return true;
}

async function runWeeklyReport() {
  const cfg = getFinanceSettings().weeklyReport;
  if (!cfg.enabled || !cfg.email) return;
  const nl = new Date().toLocaleString('en-US', { timeZone: 'Europe/Amsterdam', weekday: 'short', hour: '2-digit', hour12: false });
  const isMonday = /^Mon/.test(nl);
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hour12: false }));
  const today = new Date().toISOString().slice(0, 10);
  if (!isMonday || hour !== cfg.hour) return;
  if (db().settings._lastWeeklyReport === today) return;
  try { await sendWeeklyCeoReport(); } catch (e) { console.error('[ceo-rapport]', e.message); }
}

// ---------- 7. Nachtelijke statusscan ----------
let _runStatusScan = null;
async function runNightlyScan() {
  const cfg = db().settings.autoScan || {};
  if (!cfg.enabled || !process.env.ANTHROPIC_API_KEY || !_runStatusScan) return;
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hour12: false }));
  const today = new Date().toISOString().slice(0, 10);
  if (hour !== (Number(cfg.hour) >= 0 ? Number(cfg.hour) : 5)) return;
  if (db().settings._lastAutoScanDay === today) return;
  db().settings._lastAutoScanDay = today; save();
  console.log('[auto-scan] nachtelijke statusscan gestart');
  await _runStatusScan(30);
}

// ---------- Mailbox-quotum bewaken ----------
// Elk uur: hoe vol zit de info@-mailbox? Bij >=90% één keer per dag alarm slaan
// (WhatsApp-teammelding + logboek). Een volle mailbox blokkeert versturen EN
// weigert inkomende klantmail — dat willen we vóór zijn, niet achteraf ontdekken.
async function runMailboxQuotaCheck() {
  const rec = await checkMailboxQuota();
  if (!rec || !rec.supported || typeof rec.pct !== 'number') return;
  if (rec.pct < 90) return;
  const today = new Date().toISOString().slice(0, 10);
  if (db()._mailboxQuota && db()._mailboxQuota.alertedOn === today) return; // al gemeld vandaag
  db()._mailboxQuota.alertedOn = today;
  saveSoon();
  const txt = `⚠️ CRM: de e-mailbox (info@) zit ${rec.pct}% VOL (${rec.usedMB} van ${rec.limitMB} MB). Ruim op of vergroot het quotum — anders mislukken bevestigingen/antwoorden en wordt inkomende klantmail geweigerd!`;
  logActivity('systeem', 'mailbox bijna vol', `${rec.pct}% (${rec.usedMB}/${rec.limitMB} MB)`);
  queueCrmWhatsappAlert(txt);
  console.log('[mailbox-quotum]', txt);
}

// ---------- Starter ----------
export function startAutomations({ runStatusScan } = {}) {
  _runStatusScan = runStatusScan || null;
  const hourly = async () => {
    try { await runAppointmentReminders(); } catch (e) { console.error('[herinneringen]', e.message); }
    try { await runReviewRequests(); } catch (e) { console.error('[reviews]', e.message); }
    try { await runNightlyScan(); } catch (e) { console.error('[auto-scan]', e.message); }
    try { bookRecurringDue(); } catch (e) { console.error('[vaste-kosten]', e.message); }
    try { await runWeeklyReport(); } catch (e) { console.error('[ceo-rapport]', e.message); }
    try { await runMailboxQuotaCheck(); } catch (e) { console.error('[mailbox-quotum]', e.message); }
  };
  const fast = async () => {
    try { await runSnoozeChecks(); } catch (e) { console.error('[snooze]', e.message); }
    try { await runWatchdog(); } catch (e) { console.error('[watchdog]', e.message); }
  };
  setTimeout(hourly, 45 * 1000);
  setInterval(hourly, 60 * 60 * 1000);   // elk uur
  setTimeout(fast, 60 * 1000);
  setInterval(fast, 5 * 60 * 1000);      // elke 5 minuten
  console.log('  Automatiseringen: actief (terugkoppeling, afspraakberichten, reviews, snooze, uitval-alarm, nachtscan)');
}

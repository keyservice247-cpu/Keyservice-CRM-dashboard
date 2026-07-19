// Automatiseringen rond de opdracht-lus: terugkoppeling via de controle-groep,
// afspraakbevestiging + herinnering naar de klant, review-verzoek na afronding,
// snooze-herinneringen, uitval-alarm (bridge/e-mail/AI) en de nachtelijke statusscan.
import { db, id, now, save, saveSoon, logActivity, diskFreeMB, backupNow, saveFailure } from './db.js';
import {
  getTerugkoppeling, getAppointmentMsg, getReviewRequest, getEmailSignature,
  getStatusLabels, isWhatsappOrderGroup, getBackupMail, groupIdForName,
  getAttachmentCleanup,
} from './settings.js';
import { deleteFile } from './storage.js';
import { getInvoiceSettings, sendInvoiceReminder } from './invoices.js';
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
      groupId: groupIdForName(monteur.waGroup) || undefined, // bridge kan dan direct op id versturen
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
  // Outbox-bewaking: WhatsApp-berichten die MISLUKKEN of lang blijven hangen (dan
  // krijgt een klant/monteur z'n bericht niet). Alleen RECENTE problemen (<24u) tellen,
  // zodat het alarm vanzelf stopt zodra de bridge weer verstuurt. Max 1 melding/dag.
  try {
    const nowMs = Date.now();
    const recent = (o) => o.createdAt && (nowMs - new Date(o.createdAt).getTime()) < 24 * 3600000;
    const ob = db().outbox || [];
    const failed = ob.filter((o) => o.status === 'failed' && recent(o)).length;
    const stuck = ob.filter((o) => o.status === 'queued' && recent(o) && (nowMs - new Date(o.createdAt).getTime()) > 30 * 60000).length;
    const today = new Date().toISOString().slice(0, 10);
    if ((failed >= 1 || stuck >= 1) && s._alerts.outboxDay !== today) {
      s._alerts.outboxDay = today; save();
      await alertAdmins('WhatsApp-berichten komen niet aan', `${failed} bericht(en) MISLUKT en ${stuck} langer dan 30 min in de wachtrij. Klanten/monteurs krijgen die mogelijk niet. Check Instellingen → WhatsApp-verbinding testen en de bridge op de VPS.`);
    } else if (failed === 0 && stuck === 0 && s._alerts.outboxDay) {
      delete s._alerts.outboxDay; save();
    }
  } catch { /* watchdog mag nooit crashen */ }
  // NOODALARM: het wegschrijven van de database mislukt (bv. schijf vol). Dit is het
  // ergste stille probleem dat er bestaat — wijzigingen (nieuwe leads, afspraken)
  // leven dan alleen in het geheugen en verdampen bij de eerstvolgende herstart.
  // Daarom: elk kwartier opnieuw alarmeren zolang het aanhoudt, en meteen een
  // opruimronde draaien om ruimte te maken. (De alarm-vlag staat bewust in het
  // geheugen: opslaan werkt op dat moment immers niet.)
  try {
    const sf = saveFailure();
    if (sf) {
      try { backupNow('nood-opruimronde (opslaan faalt)'); } catch { /* best-effort */ }
      if (!global._saveFailAlarmAt || Date.now() - global._saveFailAlarmAt > 15 * 60000) {
        global._saveFailAlarmAt = Date.now();
        await alertAdmins('NOOD: database kan NIET opslaan', `Het wegschrijven van de database mislukt (${sf.message}). Nieuwe leads en afspraken leven nu ALLEEN in het geheugen en gaan bij een herstart verloren. Waarschijnlijk is de schijf vol: oude back-ups zijn automatisch opgeruimd — helpt dat niet, vergroot dan direct de schijf in het Render-dashboard (Disks). Voer géén updates/deploys uit tot dit alarm stopt.`);
      }
    } else if (global._saveFailAlarmAt) {
      global._saveFailAlarmAt = 0;
      await alertAdmins('Database-opslag hersteld', 'Het wegschrijven van de database werkt weer. Alle wijzigingen worden weer veilig bewaard.');
    }
  } catch { /* watchdog mag nooit crashen */ }
  // Schijfruimte-bewaking: een volle schijf breekt bijlages, back-ups en (erger)
  // het wegschrijven van de database zelf. Onder de 150 MB vrij: alarm (1x/dag) +
  // meteen een back-upronde draaien, want die ruimt eerst oude kopieën op en maakt
  // zo direct ruimte vrij. Boven de grens: alarm vanzelf opheffen.
  try {
    const freeMB = diskFreeMB();
    if (freeMB != null) {
      const today = new Date().toISOString().slice(0, 10);
      if (freeMB < 150) {
        try { backupNow('schijf-bijna-vol (opruimronde)'); } catch { /* best-effort */ }
        if (s._alerts.diskDay !== today) {
          s._alerts.diskDay = today; save();
          await alertAdmins('Schijf bijna VOL op de server', `Nog maar ${freeMB} MB vrij op de datamap. Bijlages en database-opslag kunnen mislukken. Oude back-ups zijn automatisch opgeruimd; blijft dit alarm komen, vergroot dan de schijf in het Render-dashboard (Disks).`);
        }
      } else if (s._alerts.diskDay) {
        delete s._alerts.diskDay; save();
      }
    }
  } catch { /* watchdog mag nooit crashen */ }
  // Off-site back-up-mail: als hij AAN staat maar al >36 uur niet is gelukt, alarm.
  try {
    if (s.backupMail && s.backupMail.enabled && smtpConfigured()) {
      const last = s._backupMailDay ? new Date(s._backupMailDay + 'T12:00:00Z').getTime() : 0;
      const stale = Date.now() - last > 36 * 3600000;
      const today = new Date().toISOString().slice(0, 10);
      if (stale && s._alerts.backupMailDay !== today) {
        s._alerts.backupMailDay = today; save();
        await alertAdmins('Off-site back-up mislukt', `De dagelijkse back-up-mail is al meer dan een dag niet verstuurd${s._backupMailError ? ` (${s._backupMailError.message})` : ''}. Controleer e-mail versturen (SMTP) — je klantdata heeft dan geen verse kopie buiten de server.`);
      } else if (!stale && s._alerts.backupMailDay) {
        delete s._alerts.backupMailDay; save();
      }
    }
  } catch { /* watchdog mag nooit crashen */ }
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
  if (!rec || !rec.supported) return;
  const full = (rec.boxes || []).filter((b) => b.supported && b.pct >= 90);
  if (!full.length) return;
  const today = new Date().toISOString().slice(0, 10);
  if (db()._mailboxQuota && db()._mailboxQuota.alertedOn === today) return; // al gemeld vandaag
  db()._mailboxQuota.alertedOn = today;
  saveSoon();
  const list = full.map((b) => `${b.user}: ${b.pct}% vol (${b.usedMB}/${b.limitMB} MB)`).join(' · ');
  const txt = `⚠️ CRM: mailbox bijna VOL — ${list}. Ruim op of vergroot het quotum — anders mislukken bevestigingen/antwoorden en wordt inkomende klantmail geweigerd!`;
  logActivity('systeem', 'mailbox bijna vol', list);
  queueCrmWhatsappAlert(txt);
  console.log('[mailbox-quotum]', txt);
}

// ---------- Automatische betaalherinnering (1x per dag) ----------
// Verzonden facturen die voorbij de vervaldatum + X dagen zijn krijgen automatisch
// dezelfde nette herinnering als de handmatige knop, met tussenpozen en een maximum.
// Vangrails: nooit voor stokoude facturen (>120 dagen — die zijn vaak buiten het
// systeem om afgehandeld), max 10 mails per ronde, en de teller telt handmatige én
// automatische herinneringen samen.
async function runInvoiceAutoReminders() {
  const cfg = getInvoiceSettings();
  if (!cfg.autoRemind || !smtpConfigured()) return;
  const today = new Date().toISOString().slice(0, 10);
  if (db().settings._invRemindDay === today) return;
  db().settings._invRemindDay = today;
  const nowMs = Date.now();
  let n = 0;
  for (const inv of db().invoices || []) {
    if (inv.type === 'offerte' || inv.status !== 'verzonden' || !inv.sentAt) continue;
    const sent = new Date(inv.sentAt).getTime();
    if (!Number.isFinite(sent) || nowMs - sent > 120 * 86400000) continue;
    const due = sent + (cfg.paymentDays || 7) * 86400000;
    if (nowMs < due + (cfg.remindAfterDays || 3) * 86400000) continue;
    if ((inv.remindCount || 0) >= (cfg.remindMax || 2)) continue;
    const last = inv.remindedAt ? new Date(inv.remindedAt).getTime() : 0;
    if (nowMs - last < (cfg.remindRepeatDays || 7) * 86400000) continue;
    try {
      const r = await sendInvoiceReminder(inv, { by: 'systeem (automatische herinnering)' });
      if (r.ok) n++;
      else if (r.error && !/e-mailadres/.test(r.error)) console.error('[auto-herinnering]', inv.number, r.error);
    } catch (e) { console.error('[auto-herinnering]', inv.number, e.message); }
    if (n >= 10) break; // nooit een mailstorm in één ronde
  }
  if (n) {
    logActivity('systeem', 'automatische betaalherinneringen', `${n} verstuurd`);
    console.log(`[auto-herinnering] ${n} betaalherinnering(en) automatisch verstuurd`);
  }
  saveSoon();
}

// ---------- Bijlage-opschoning (1x per dag) ----------
// Verwijdert bestandsbijlages van AFGERONDE/GEANNULEERDE kaarten (en berichten in de
// prullenbak-leeftijd) ouder dan de ingestelde periode. Uitdrukkelijk NOOIT:
// werkbon-handtekeningen (garantie/juridisch), facturen, of iets van een nog
// lopende kaart. Klant- en kaartgegevens zelf blijven altijd volledig staan —
// alleen de losse bestanden op de schijf verdwijnen.
export function runAttachmentCleanup() {
  const cfg = getAttachmentCleanup();
  if (!cfg.enabled) return;
  const today = new Date().toISOString().slice(0, 10);
  if (db().settings._attCleanupDay === today) return;
  db().settings._attCleanupDay = today;
  const cutoff = Date.now() - cfg.days * 86400000;
  // Bestanden die NOOIT weg mogen: werkbon-handtekeningen.
  const keep = new Set();
  for (const o of [...(db().orders || []), ...(db().trash || [])]) {
    const sigId = o.werkbon && o.werkbon.signatureAttachmentId;
    if (sigId) keep.add(sigId);
  }
  let removed = 0;
  const stripList = (list) => {
    if (!Array.isArray(list) || !list.length) return list;
    const rest = [];
    for (const att of list) {
      if (!att || !att.file || keep.has(att.id)) { rest.push(att); continue; }
      try { deleteFile(att.file); removed++; } catch { rest.push(att); continue; }
    }
    return rest;
  };
  // Leeftijd op basis van het afrondmoment (of anders de aanmaakdatum) — bewust
  // NIET updatedAt: die schuift op door systeemacties (archivering, badges) en zou
  // het opruimen eindeloos uitstellen.
  const oldDone = (o) => {
    if (!['afgerond', 'geannuleerd'].includes(o.status)) return false;
    const ref = o.completedAt || o.createdAt;
    return ref && new Date(ref).getTime() < cutoff;
  };
  for (const o of [...(db().orders || []), ...(db().trash || [])]) {
    if (!oldDone(o)) continue;
    if (o.attachments && o.attachments.length) o.attachments = stripList(o.attachments);
    for (const t of o.thread || []) {
      if (t.attachments && t.attachments.length) t.attachments = stripList(t.attachments);
    }
  }
  // Losse berichten (inbox-historie) ouder dan de periode: bestanden weg, tekst blijft.
  for (const m of db().messages || []) {
    if (!m.receivedAt || new Date(m.receivedAt).getTime() >= cutoff) continue;
    if (m.attachments && m.attachments.length) m.attachments = stripList(m.attachments);
  }
  if (removed) {
    logActivity('systeem', 'oude bijlages opgeruimd', `${removed} bestand(en) van afgehandelde klussen ouder dan ${cfg.days} dagen`);
    console.log(`[bijlage-opschoning] ${removed} bestand(en) verwijderd (ouder dan ${cfg.days} dagen, alleen afgeronde/geannuleerde klussen)`);
  }
  saveSoon();
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
    try { runAttachmentCleanup(); } catch (e) { console.error('[bijlage-opschoning]', e.message); }
    try { await runInvoiceAutoReminders(); } catch (e) { console.error('[auto-herinnering]', e.message); }
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

// Automatische follow-up op offertes die X dagen "blijven liggen" (offerte verzonden,
// geen reactie van de klant). Stuurt een vriendelijke herinnering via e-mail en/of
// WhatsApp (WhatsApp loopt via de outbox -> bridge stuurt naar het klant-nummer).
import { db, id, now, saveSoon, logActivity } from './db.js';
import { getFollowUp, getEmailSignature } from './settings.js';
import { sendMail, smtpConfigured } from './connectors/email-smtp.js';

export function startFollowUps() {
  const tick = () => { try { runFollowUps(); } catch (e) { console.error('Follow-up faalde:', e.message); } };
  setTimeout(tick, 30 * 1000);          // kort na opstarten
  setInterval(tick, 60 * 60 * 1000);    // daarna elk uur
  console.log('  Offerte follow-ups: actief (controleert elk uur)');
}

export async function runFollowUps() {
  const cfg = getFollowUp();
  if (!cfg.enabled) return { sent: 0 };
  const cutoff = Date.now() - cfg.days * 86400000;
  let count = 0;
  for (const o of db().orders) {
    if (o.status !== 'offerte_verzonden' || o.archivedWeek) continue;
    if (o.customerReplied) continue;                 // klant heeft al gereageerd
    if (o.followUpAt) continue;                       // al een follow-up gestuurd
    if (new Date(o.updatedAt).getTime() > cutoff) continue; // nog niet lang genoeg open
    const c = db().customers.find((x) => x.id === o.customerId) || {};
    let sent = false;

    if (c.email && smtpConfigured()) {
      try {
        const sig = getEmailSignature();
        const text = sig ? `${cfg.emailBody}\n\n${sig}` : cfg.emailBody;
        await sendMail({ to: c.email, subject: cfg.emailSubject, text });
        o.thread = o.thread || [];
        o.thread.push({ id: id('thr'), channel: 'email', outgoing: true, sender: 'Keyservice (automatische follow-up)', subject: cfg.emailSubject, body: cfg.emailBody, at: now() });
        sent = true;
      } catch (e) { console.error('Follow-up e-mail mislukt:', e.message); }
    }

    if (c.phone) {
      // Via de outbox: de bridge stuurt dit naar het WhatsApp-nummer van de klant.
      db().outbox.unshift({ id: id('out'), kind: 'whatsapp_customer', phone: c.phone, text: cfg.whatsappBody, orderId: o.id, status: 'queued', createdAt: now(), by: 'follow-up' });
      o.thread = o.thread || [];
      o.thread.push({ id: id('thr'), channel: 'whatsapp', outgoing: true, sender: 'Keyservice (automatische follow-up)', body: cfg.whatsappBody, at: now() });
      sent = true;
    }

    if (sent) {
      o.followUpAt = now();
      o.updatedAt = now();
      count++;
      logActivity('systeem', 'offerte follow-up verstuurd', `${o.title} -> ${c.name || ''}`);
    }
  }
  if (count) saveSoon();
  return { sent: count };
}

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
  const offerteOn = cfg.emailEnabled || cfg.whatsappEnabled;
  if (!offerteOn && !cfg.noReplyEnabled) return { sent: 0 };
  const offerteCutoff = Date.now() - cfg.days * 86400000;
  const noReplyCutoff = Date.now() - cfg.noReplyDays * 86400000;
  let count = 0;
  for (const o of db().orders) {
    if (o.archivedWeek || ['afgerond', 'geannuleerd'].includes(o.status)) continue;
    if (o.followUpAt) continue;                       // al een follow-up gestuurd
    const c = db().customers.find((x) => x.id === o.customerId) || {};

    // A) Offerte blijft liggen: status offerte verzonden, geen reactie, X dagen open.
    const offerteCase = offerteOn && o.status === 'offerte_verzonden' && !o.customerReplied
      && new Date(o.updatedAt).getTime() <= offerteCutoff;

    // B) We hebben gemaild maar geen reactie gekregen (geen offerte-geval).
    const repliedSince = o.customerReplied
      || (o.lastCustomerReplyAt && o.lastReplyAt && new Date(o.lastCustomerReplyAt) > new Date(o.lastReplyAt));
    const noReplyCase = !offerteCase && cfg.noReplyEnabled
      && o.lastReplyAt && !repliedSince && !o.sentToMonteur
      && o.status !== 'afspraak_ingepland'
      && c.email && smtpConfigured()
      && new Date(o.lastReplyAt).getTime() <= noReplyCutoff;

    if (!offerteCase && !noReplyCase) continue;
    let sent = false;

    if (offerteCase) {
      // Kies ÉÉN kanaal (geen dubbele berichten). Voorkeur = bron-kanaal van de klant.
      const src = `${o.source || ''} ${o.originGroup || ''}`.toLowerCase();
      const fromWhatsapp = /whatsapp|groep|app/.test(src);
      const canEmail = cfg.emailEnabled && c.email && smtpConfigured();
      const canWa = cfg.whatsappEnabled && c.phone;
      let useEmail = false; let useWa = false;
      if (canEmail && canWa) { if (fromWhatsapp) useWa = true; else useEmail = true; }
      else { useEmail = canEmail; useWa = canWa; }

      if (useEmail) {
        try {
          const sig = getEmailSignature();
          const text = sig ? `${cfg.emailBody}\n\n${sig}` : cfg.emailBody;
          await sendMail({ to: c.email, subject: cfg.emailSubject, text });
          o.thread = o.thread || [];
          o.thread.push({ id: id('thr'), channel: 'email', outgoing: true, sender: 'Keyservice (automatische follow-up)', subject: cfg.emailSubject, body: cfg.emailBody, at: now() });
          sent = true;
        } catch (e) { console.error('Follow-up e-mail mislukt:', e.message); }
      }
      if (useWa) {
        db().outbox.unshift({ id: id('out'), kind: 'whatsapp_customer', phone: c.phone, group: '__klant_dm__', text: cfg.whatsappBody, orderId: o.id, status: 'queued', createdAt: now(), by: 'follow-up' });
        o.thread = o.thread || [];
        o.thread.push({ id: id('thr'), channel: 'whatsapp', outgoing: true, sender: 'Keyservice (automatische follow-up)', body: cfg.whatsappBody, at: now() });
        sent = true;
      }
    } else if (noReplyCase) {
      // We hebben gemaild -> follow-up via e-mail.
      try {
        const sig = getEmailSignature();
        const text = sig ? `${cfg.noReplyEmailBody}\n\n${sig}` : cfg.noReplyEmailBody;
        await sendMail({ to: c.email, subject: cfg.noReplyEmailSubject, text });
        o.thread = o.thread || [];
        o.thread.push({ id: id('thr'), channel: 'email', outgoing: true, sender: 'Keyservice (automatische follow-up)', subject: cfg.noReplyEmailSubject, body: cfg.noReplyEmailBody, at: now() });
        sent = true;
      } catch (e) { console.error('No-reply follow-up mislukt:', e.message); }
    }

    if (sent) {
      o.followUpAt = now();
      o.updatedAt = now();
      count++;
      logActivity('systeem', offerteCase ? 'offerte follow-up verstuurd' : 'follow-up (geen reactie) verstuurd', `${o.title} -> ${c.name || ''}`);
    }
  }
  if (count) saveSoon();
  return { sent: count };
}

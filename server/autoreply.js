// Automatische ontvangstbevestiging naar de klant bij een nieuwe e-mail-aanvraag.
// Vraagt alvast om foto's + adres, zodat het team sneller verder kan zodra iemand vrij is.
import { db, id, now, saveSoon, logActivity } from './db.js';
import { getAutoReply, getEmailSignature } from './settings.js';
import { sendMail, smtpConfigured } from './connectors/email-smtp.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function maybeSendAutoReply(result) {
  const cfg = getAutoReply();
  if (!cfg.enabled) { console.log('[bevestiging] uit — ontvangstbevestiging staat niet aan'); return; }
  if (!smtpConfigured()) { console.log('[bevestiging] SMTP niet geconfigureerd — kan niet versturen'); return; }
  const review = result && result.review;
  // ALLEEN bij een echt NIEUWE aanvraag (nieuwe kaart) via e-mail. Niet wanneer een
  // bericht aan een bestaande, lopende kaart hangt (klant is dan al in behandeling/
  // offerte) — dan is "bedankt voor uw aanvraag, stuur foto's" niet meer passend.
  if (!review) { console.log('[bevestiging] bericht hing aan bestaande kaart (terugkerende klant) — overgeslagen'); return; }
  if (review.status !== 'pending') { console.log(`[bevestiging] review-status '${review.status}' (geen nieuwe aanvraag) — overgeslagen`); return; }
  if (review.channel !== 'email') { console.log(`[bevestiging] kanaal '${review.channel}' (geen e-mail/website) — overgeslagen`); return; }
  const s = review.suggestion || {};
  const messageId = review.messageId;
  const email = (s.customerEmail || '').trim();
  if (!email || !EMAIL_RE.test(email)) { console.log('[bevestiging] geen geldig klant-e-mailadres gevonden — overgeslagen'); return; }

  // Niet dubbel sturen bij dubbelklik/dubbele submit: max 1 bevestiging per klant
  // per uur. Een échte nieuwe aanvraag (uren of dagen later) krijgt gewoon weer een
  // bevestiging — dat hoort zo.
  const cust = db().customers.find((c) => c.email && c.email.toLowerCase() === email.toLowerCase());
  if (cust && cust.autoRepliedAt && (Date.now() - new Date(cust.autoRepliedAt).getTime()) < 3600000) { console.log(`[bevestiging] klant kreeg al een bevestiging <1 uur geleden (${email}) — overgeslagen`); return; }

  const sig = getEmailSignature();
  const text = sig ? `${cfg.body}\n\n${sig}` : cfg.body;
  try {
    await sendMail({ to: email, subject: cfg.subject, text });
    if (cust) cust.autoRepliedAt = now();
    // Markeer het bericht; de bevestiging komt in de historie zodra de kaart is aangemaakt.
    const msg = db().messages.find((m) => m.id === messageId);
    if (msg) msg.autoReplied = { at: now(), to: email, subject: cfg.subject, body: text };
    logActivity('systeem', 'automatische ontvangstbevestiging verstuurd', email);
    console.log(`[bevestiging] verstuurd naar ${email}`);
    saveSoon();
  } catch (e) {
    console.error('[bevestiging] versturen mislukt:', e.message);
  }
}

// VANGNET bij goedkeuren: is er bij binnenkomst om wat voor reden dan ook GEEN
// bevestiging gestuurd (e-mailadres toen niet gevonden, SMTP-storing, dubbel-
// detectie), maar heeft de goedgekeurde kaart wél een geldig klant-e-mailadres
// (door de mens gecontroleerd)? Stuur de bevestiging dan alsnog. Zo krijgt een
// goedgekeurde e-mail-lead ALTIJD een ontvangstbevestiging.
export async function maybeSendConfirmationOnApprove(order, review) {
  try {
    const cfg = getAutoReply();
    if (!cfg.enabled || !smtpConfigured()) return;
    if (!order || !review || review.channel !== 'email') return;
    if (order.autoReplied) return; // al bij binnenkomst gestuurd
    // Niet bij stokoude aanvragen die iemand laat opruimt/goedkeurt (dan is
    // "bedankt voor uw aanvraag" mosterd na de maaltijd).
    if (review.createdAt && (Date.now() - new Date(review.createdAt).getTime()) > 72 * 3600000) return;
    const cust = db().customers.find((c) => c.id === order.customerId);
    const email = (cust?.email || '').trim();
    if (!email || !EMAIL_RE.test(email)) { console.log('[bevestiging] ook bij goedkeuren geen geldig klant-e-mailadres — overgeslagen'); return; }
    if (cust.autoRepliedAt && (Date.now() - new Date(cust.autoRepliedAt).getTime()) < 3600000) return; // max 1/uur
    const sig = getEmailSignature();
    const text = sig ? `${cfg.body}\n\n${sig}` : cfg.body;
    await sendMail({ to: email, subject: cfg.subject, text });
    cust.autoRepliedAt = now();
    order.thread = order.thread || [];
    order.thread.push({
      id: id('thr'), channel: 'email', outgoing: true, autoReply: true,
      sender: 'Keyservice (automatische bevestiging)',
      subject: cfg.subject, body: text, at: now(),
    });
    order.autoReplied = { at: now() };
    logActivity('systeem', 'ontvangstbevestiging alsnog verstuurd (bij goedkeuren)', email);
    console.log(`[bevestiging] alsnog verstuurd bij goedkeuren naar ${email}`);
    saveSoon();
  } catch (e) {
    console.error('[bevestiging] versturen bij goedkeuren mislukt:', e.message);
  }
}

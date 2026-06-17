// Automatische ontvangstbevestiging naar de klant bij een nieuwe e-mail-aanvraag.
// Vraagt alvast om foto's + adres, zodat het team sneller verder kan zodra iemand vrij is.
import { db, now, saveSoon, logActivity } from './db.js';
import { getAutoReply, getEmailSignature } from './settings.js';
import { sendMail, smtpConfigured } from './connectors/email-smtp.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function maybeSendAutoReply(result) {
  const cfg = getAutoReply();
  if (!cfg.enabled || !smtpConfigured()) return;
  const review = result && result.review;
  // Alleen bij een ECHTE nieuwe aanvraag via e-mail (geen geklets/overige/reclame/rapport).
  if (!review || review.status !== 'pending' || review.channel !== 'email') return;
  const s = review.suggestion || {};
  const email = (s.customerEmail || '').trim();
  if (!email || !EMAIL_RE.test(email)) return;

  // Niet dubbel sturen: max 1 ontvangstbevestiging per klant per 7 dagen.
  const cust = db().customers.find((c) => c.email && c.email.toLowerCase() === email.toLowerCase());
  if (cust && cust.autoRepliedAt && (Date.now() - new Date(cust.autoRepliedAt).getTime()) < 7 * 86400000) return;

  const sig = getEmailSignature();
  const text = sig ? `${cfg.body}\n\n${sig}` : cfg.body;
  try {
    await sendMail({ to: email, subject: cfg.subject, text });
    if (cust) cust.autoRepliedAt = now();
    logActivity('systeem', 'automatische ontvangstbevestiging verstuurd', email);
    saveSoon();
  } catch (e) {
    console.error('Auto-ontvangstbevestiging mislukt:', e.message);
  }
}

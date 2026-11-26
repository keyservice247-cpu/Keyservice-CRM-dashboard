// Automatische ontvangstbevestiging naar de klant bij een nieuwe e-mail-aanvraag.
// Vraagt alvast om foto's + adres, zodat het team sneller verder kan zodra iemand vrij is.
import { db, id, now, saveSoon, logActivity } from './db.js';
import { getAutoReply, getEmailSignature } from './settings.js';
import { sendMail, smtpConfigured } from './connectors/email-smtp.js';
import { matchPhone, senderPhoneFromText, findCustomerStrong } from './pipeline.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Lopende kaart = niet afgerond/geannuleerd, niet in de prullenbak, niet ingeklapt.
export const klantInBehandeling = (customerId) => (db().orders || []).some((o) => o.customerId === customerId
  && !o.trashedAt && !o.archivedWeek && !['afgerond', 'geannuleerd'].includes(o.status));
// Zelfde, maar zonder de kaart die net voor deze aanvraag is aangemaakt.
export const klantInBehandelingBehalve = (customerId, behalveOrderId) => !!customerId && (db().orders || []).some((o) => o.customerId === customerId
  && o.id !== behalveOrderId && !o.archivedWeek && !['afgerond', 'geannuleerd'].includes(o.status));

// ONTVANGSTBEVESTIGING OOK VIA WHATSAPP (27 nov 2026, wens eigenaar: "die automatische
// antwoorden niet alleen via de mail, maar ook via WhatsApp"). Eigen schakelaar (standaard
// UIT). Zelfde regels als de mail: alleen bij een echte NIEUWE aanvraag, nooit dubbel, niet als
// de klant al een lopende opdracht heeft. Extra voor WhatsApp:
//  - NOOIT op een groepsbericht (dat is een doorgestuurde opdracht, geen klant die ons appt);
//  - het nummer is bij een 1-op-1 appje het ECHTE afzendernummer (nooit een nummer uit de
//    tekst); bij het eigen websiteformulier het nummer dat de klant zelf invulde; een losse
//    e-mail krijgt geen appje;
//  - alleen een Nederlands mobiel nummer; hooguit één bevestiging per nummer per uur;
//  - het bericht gaat via de GEWONE wachtrij (snelheidsrem, dubbelfilter, pauzeknop en de
//    officiële route gelden dus ook hier) — er is geen eigen verzendpad.
// Geeft het wachtrij-item terug, of null met de reden in het logboek van de server.
const MOBIEL_NL = /^06\d{8}$/;
export function maybeSendWhatsappBevestiging(result) {
  const cfg = getAutoReply();
  if (!cfg.whatsappEnabled) return null;
  const review = result && result.review;
  if (!review || result.duplicate) return null;
  if (!['pending', 'auto_approved'].includes(review.status)) return null;
  const msg = (db().messages || []).find((m) => m.id === review.messageId);
  if (!msg || msg.autoRepliedWa || msg.teruggevonden) return null;
  if (msg.group || review.group) return null;
  // Een losse e-mail krijgt GEEN appje: het nummer zou daar uit de tekst komen en kan van iemand
  // anders zijn (een beheerder die voor een huurder mailt). Alleen het eigen websiteformulier telt,
  // want daar vult de klant zijn nummer zelf in.
  if (review.channel !== 'whatsapp' && msg.mailbox !== 'website-direct') return null;
  const ruw = review.channel === 'whatsapp' ? (msg.fromPhone || senderPhoneFromText(msg.body)) : ((review.suggestion || {}).customerPhone || '');
  const tel = matchPhone(ruw);
  if (!MOBIEL_NL.test(tel)) return null;
  const uurGeleden = Date.now() - 3600000;
  if ((db().outbox || []).some((x) => x.by === 'ontvangstbevestiging' && matchPhone(x.phone) === tel && new Date(x.createdAt).getTime() > uurGeleden)) return null;
  const cust = findCustomerStrong({ phone: tel, email: '' });
  if (cust && (review.mergedIntoOrder || klantInBehandelingBehalve(cust.id, review.orderId || null))) {
    review.autoReplySkippedWa = 'klant al in behandeling (lopende opdracht)';
    logActivity('systeem', 'ontvangstbevestiging via WhatsApp overgeslagen', 'klant heeft al een lopende opdracht');
    saveSoon();
    return null;
  }
  const body = cfg.whatsappBody;
  const item = { id: id('out'), kind: 'whatsapp_customer', phone: tel, group: '__klant_dm__', text: body, orderId: review.orderId || undefined, status: 'queued', createdAt: now(), by: 'ontvangstbevestiging' };
  db().outbox = db().outbox || [];
  db().outbox.unshift(item);
  msg.autoRepliedWa = { at: now(), to: tel, body };
  // Is de opdracht al aangemaakt (automatisch goedgekeurd)? Dan meteen zichtbaar in het gesprek.
  if (review.orderId) {
    const order = (db().orders || []).find((o) => o.id === review.orderId);
    if (order && !order.autoRepliedWa) {
      order.thread = order.thread || [];
      order.thread.push({ id: id('thr'), channel: 'whatsapp', outgoing: true, autoReply: true, sender: 'Keyservice (automatische bevestiging)', body, at: now(), outboxId: item.id });
      order.autoRepliedWa = { at: now() };
    }
  }
  logActivity('systeem', 'ontvangstbevestiging via WhatsApp klaargezet', 'nieuwe aanvraag');
  saveSoon();
  return item;
}

export async function maybeSendAutoReply(result) {
  // WhatsApp heeft een eigen schakelaar en eigen regels; een fout daar raakt de mail nooit.
  try { maybeSendWhatsappBevestiging(result); } catch (e) { console.error('[bevestiging] WhatsApp mislukt:', e.message); }
  const cfg = getAutoReply();
  if (!cfg.enabled) { console.log('[bevestiging] uit — ontvangstbevestiging staat niet aan'); return; }
  if (!smtpConfigured()) { console.log('[bevestiging] SMTP niet geconfigureerd — kan niet versturen'); return; }
  const review = result && result.review;
  // ALLEEN bij een echt NIEUWE aanvraag (nieuwe kaart) via e-mail. Niet wanneer een
  // bericht aan een bestaande, lopende kaart hangt (klant is dan al in behandeling/
  // offerte) — dan is "bedankt voor uw aanvraag, stuur foto's" niet meer passend.
  if (!review) { console.log('[bevestiging] bericht hing aan bestaande kaart (terugkerende klant) — overgeslagen'); return; }
  // NOOIT TWEE KEER VOOR DEZELFDE AANVRAAG (6 okt 2026): een dubbele binnenkomst (de
  // FormSubmit-kopie van een directe aanvraag, een dubbele klik) krijgt geen eigen
  // bevestiging, en een aanvraag die er al één kreeg ook niet. Voorheen gold alleen
  // "max 1 per klant per uur" — een kopie die later opnieuw werd verwerkt kon de klant
  // zo elk uur opnieuw een bevestiging sturen.
  if (result.duplicate) { console.log('[bevestiging] dubbele binnenkomst — overgeslagen'); return; }
  {
    const eerder = db().messages.find((m) => m.id === review.messageId);
    if (eerder && eerder.autoReplied) { console.log('[bevestiging] deze aanvraag kreeg al een bevestiging — overgeslagen'); return; }
  }
  // Ook automatisch goedgekeurde website-leads (drempel) krijgen gewoon een
  // ontvangstbevestiging — de klant merkt anders niets van z'n aanvraag.
  if (!['pending', 'auto_approved'].includes(review.status)) { console.log(`[bevestiging] review-status '${review.status}' (geen nieuwe aanvraag) — overgeslagen`); return; }
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
  // KLANT AL IN BEHANDELING (wens eigenaar 10 sep): heeft deze klant nog een lopende
  // kaart (niet afgerond/geannuleerd, niet in de prullenbak of ingeklapt), dan is
  // "bedankt voor uw aanvraag, stuur foto's" misplaatst — het team kent 'm al.
  // De aanvraag zelf komt gewoon in de inbox; alleen de automatische mail blijft uit.
  // Automatisch goedgekeurd (drempel) = de kaart van DEZE aanvraag bestaat al; die telt
  // niet als "al in behandeling" (audit 3 okt: een auto-goedgekeurde website-lead kreeg
  // daardoor nooit een bevestiging). Samengevoegd met een lopende kaart telt wél.
  if (cust && (review.mergedIntoOrder || klantInBehandelingBehalve(cust.id, review.orderId || null))) {
    review.autoReplySkipped = 'klant al in behandeling (lopende kaart)';
    logActivity('systeem', 'ontvangstbevestiging overgeslagen', `${email} — klant heeft al een lopende kaart`);
    console.log(`[bevestiging] ${email} heeft al een lopende kaart — overgeslagen`);
    saveSoon();
    return;
  }

  const sig = getEmailSignature();
  const text = sig ? `${cfg.body}\n\n${sig}` : cfg.body;
  try {
    await sendMail({ to: email, subject: cfg.subject, text, automatisch: true });
    if (cust) cust.autoRepliedAt = now();
    // Markeer het bericht; de bevestiging komt in de historie zodra de kaart is aangemaakt.
    const msg = db().messages.find((m) => m.id === messageId);
    if (msg) msg.autoReplied = { at: now(), to: email, subject: cfg.subject, body: text };
    // Is de kaart al aangemaakt (auto-accept boven de drempel draait VÓÓR deze mail)?
    // Zet de bevestiging dan alsnog zichtbaar in de gesprekshistorie + kaart-vlag,
    // anders ziet de assistente niet dat de klant al bericht heeft gehad.
    if (review.orderId) {
      const order = db().orders.find((o) => o.id === review.orderId);
      if (order && !order.autoReplied) {
        order.thread = order.thread || [];
        order.thread.push({ id: id('thr'), channel: 'email', outgoing: true, autoReply: true, sender: 'Keyservice (automatische bevestiging)', subject: cfg.subject, body: text, at: now() });
        order.autoReplied = { at: now() };
        order.updatedAt = now();
      }
    }
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
    // Aanvraag is bij goedkeuren aan een LOPENDE kaart gehangen (zelfde-moment-venster)
    // of de klant heeft nog een andere lopende kaart → geen "bedankt voor uw aanvraag"
    // alsof hij nieuw is (audit 16 sep; zelfde regel als bij binnenkomst).
    if (review.mergedIntoOrder) return;
    if (klantInBehandelingBehalve(order.customerId, order.id)) return;
    // Niet bij stokoude aanvragen die iemand laat opruimt/goedkeurt (dan is
    // "bedankt voor uw aanvraag" mosterd na de maaltijd).
    if (review.createdAt && (Date.now() - new Date(review.createdAt).getTime()) > 72 * 3600000) return;
    const cust = db().customers.find((c) => c.id === order.customerId);
    const email = (cust?.email || '').trim();
    if (!email || !EMAIL_RE.test(email)) { console.log('[bevestiging] ook bij goedkeuren geen geldig klant-e-mailadres — overgeslagen'); return; }
    if (cust.autoRepliedAt && (Date.now() - new Date(cust.autoRepliedAt).getTime()) < 3600000) return; // max 1/uur
    const sig = getEmailSignature();
    const text = sig ? `${cfg.body}\n\n${sig}` : cfg.body;
    await sendMail({ to: email, subject: cfg.subject, text, automatisch: true });
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

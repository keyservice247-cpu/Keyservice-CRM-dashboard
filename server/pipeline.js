// Gedeelde verwerkingslogica voor inkomende berichten.
// Wordt gebruikt door de API-routes én door de koppelingen (IMAP, WhatsApp).
import { db, id, now, saveSoon, logActivity } from './db.js';
import { classify, scoreRelevance } from './ai/categorizer.js';
import { normalizeStatus, firstStatusKey, getCompanyProfile } from './settings.js';

// Vat ALLE afwijzingen samen per reden ("12x spam/reclame, 5x leverancier"),
// zodat de AI leert van het volledige beeld, niet alleen de losse voorbeelden.
function summarizeRejections(rejects) {
  if (!rejects || !rejects.length) return '';
  const counts = {};
  for (const r of rejects) {
    const key = (r.reason || 'Afgewezen').trim();
    counts[key] = (counts[key] || 0) + 1;
  }
  const parts = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${n}x "${reason}"`);
  return `Totaal ${rejects.length} eerdere afwijzingen door het team. Verdeling: ${parts.join(', ')}.`;
}

export function autoApproveThreshold() {
  const s = db().settings || {};
  if (s.aiAutoApproveThreshold != null) return Number(s.aiAutoApproveThreshold);
  const env = Number(process.env.AI_AUTO_APPROVE_THRESHOLD);
  return Number.isFinite(env) ? env : 0;
}

export function findCustomer({ name, phone, email }) {
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

export function upsertCustomer({ name, phone, email, address, source }) {
  let c = findCustomer({ name, phone, email });
  if (c) {
    if (!c.phone && phone) c.phone = phone;
    if (!c.email && email) c.email = email;
    if (!c.address && address) c.address = address;
    if (c.type === 'lead') c.type = 'klant';
    return { customer: c, created: false };
  }
  c = {
    id: id('cust'),
    name: name || 'Onbekende klant',
    phone: phone || '',
    email: email || '',
    address: address || '',
    type: 'lead',
    source: source || 'handmatig',
    notes: '',
    createdAt: now(),
  };
  db().customers.push(c);
  return { customer: c, created: true };
}

export function withRelations(order) {
  const customer = db().customers.find((c) => c.id === order.customerId) || null;
  const monteur = db().monteurs.find((m) => m.id === order.monteurId) || null;
  return { ...order, customer, monteur };
}

// Maak van een (goedgekeurde) review een echte opdracht + klant.
export function applyReview(review, { actorName, overrides = {}, auto = false }) {
  const s = review.suggestion;
  const status = normalizeStatus(overrides.status || s.status);
  const { customer } = upsertCustomer({
    name: overrides.customerName ?? s.customerName,
    phone: overrides.customerPhone ?? s.customerPhone,
    email: overrides.customerEmail ?? s.customerEmail,
    address: overrides.customerAddress ?? s.customerAddress,
    source: review.channel,
  });

  const defaultSource = review.channel === 'whatsapp' ? 'Keyservice WhatsApp'
    : review.channel === 'email' ? 'Keyservice e-mail'
    : 'Handmatig';

  const order = {
    id: id('ord'),
    title: overrides.title || s.title || 'Nieuwe opdracht',
    description: overrides.description ?? s.problem ?? '',
    status,
    source: overrides.source || defaultSource,
    customerId: customer.id,
    monteurId: overrides.monteurId || null,
    appointmentAt: null,
    price: '',
    urgent: !!s.urgent,
    notes: '',
    messageId: review.messageId,
    thread: [],
    attachments: [],
    createdAt: now(),
    updatedAt: now(),
  };
  // Het oorspronkelijke bericht als eerste item in de gesprekshistorie,
  // inclusief eventuele foto's/video's die de klant meestuurde.
  const origMsg = db().messages.find((m) => m.id === review.messageId);
  if (origMsg) {
    order.thread.push({
      id: id('thr'), channel: origMsg.channel, sender: origMsg.sender,
      subject: origMsg.subject, body: origMsg.body, at: origMsg.receivedAt,
      attachments: origMsg.attachments || [],
    });
    if (origMsg.attachments && origMsg.attachments.length) {
      order.attachments = origMsg.attachments.slice();
    }
  }
  db().orders.push(order);

  review.status = auto ? 'auto_approved' : 'approved';
  review.finalStatus = status;
  review.orderId = order.id;
  // Vergelijk met wat de AI oorspronkelijk dacht (aiStatus), niet de in de inbox
  // getoonde 'nieuw'-status.
  const aiThought = s.aiStatus || s.status;
  review.correctedStatus = status !== aiThought ? status : null;
  review.reviewedBy = actorName;
  review.reviewedAt = now();

  // Mens heeft de AI-categorie GECORRIGEERD -> dit is het sterkste leersignaal.
  // Sla het op zodat de AI het de volgende keer meeneemt.
  if (!auto && review.correctedStatus) {
    const msg = db().messages.find((m) => m.id === review.messageId);
    db().feedback.unshift({
      id: id('fb'),
      type: 'correction',
      at: now(),
      by: actorName,
      channel: review.channel,
      reason: 'Categorie gecorrigeerd',
      note: `AI koos "${aiThought}", mens koos "${status}"`,
      shouldBe: status,
      aiStatus: aiThought,
      sample: (msg?.body || '').slice(0, 400),
    });
  }

  saveSoon();
  logActivity(actorName, auto ? 'opdracht automatisch aangemaakt' : 'review goedgekeurd', order.title);
  return order;
}

// Verwerk een binnenkomend bericht: ontdubbelen -> opslaan -> AI categoriseren
// -> review aanmaken -> eventueel automatisch goedkeuren bij hoge zekerheid.
export async function ingestMessage({ channel, sender, subject, body, group, externalId, attachments = [] }) {
  // Ontdubbelen: zelfde bericht (zelfde externe id) nooit twee keer verwerken.
  if (externalId) {
    const existing = db().messages.find((m) => m.externalId && m.externalId === externalId);
    if (existing) return { message: existing, review: null, duplicate: true };
  }

  const message = {
    id: id('msg'),
    channel,
    sender: sender || '',
    subject: subject || '',
    body: body || '',
    group: group || '',
    externalId: externalId || '',
    attachments: attachments || [],
    receivedAt: now(),
  };
  db().messages.push(message);

  // Feedback meegeven aan de AI. Afwijzingen ("dit is géén opdracht") zijn het
  // belangrijkst, dus die krijgen voorrang: recente afwijzingen als concrete
  // voorbeelden + een samenvatting van ÁLLE afwijzingen (zodat niets verloren gaat,
  // ook al passen niet alle voorbeelden los in het AI-geheugen).
  const allFb = db().feedback || [];
  const rejects = allFb.filter((f) => f.type === 'reject' || f.reason !== 'Categorie gecorrigeerd');
  const corrections = allFb.filter((f) => f.type === 'correction');
  const learnings = [...rejects.slice(0, 25), ...corrections.slice(0, 10)];
  const rejectSummary = summarizeRejections(rejects);
  const companyProfile = getCompanyProfile();
  const suggestion = await classify({ channel, sender, subject, body, learnings, rejectSummary, companyProfile });
  // De AI-inschatting bewaren we als hint, maar alle binnenkomende klanten
  // landen standaard in "Open / Nieuw". De assistente bepaalt de rest.
  suggestion.aiStatus = suggestion.status;
  suggestion.status = firstStatusKey();

  // Ruisfilter: bepaal of dit een echte aanvraag is of geklets. Geklets gaat
  // naar de "Overige"-lijst i.p.v. de gewone te-controleren inbox.
  const rel = scoreRelevance({ subject, body, hasAttachments: (attachments || []).length > 0 });
  suggestion.relevant = rel.relevant;
  suggestion.relevanceReason = rel.reason;

  // Bestaande klant herkennen (op e-mail/telefoon, anders naam). Zo voorkomen we
  // 3 kaarten voor 1 klant: een vervolgbericht hangt aan de lopende opdracht.
  const existingCustomer = findCustomer({
    name: suggestion.customerName,
    phone: suggestion.customerPhone,
    email: suggestion.customerEmail,
  });
  if (existingCustomer) {
    // zoek een nog lopende (niet-afgeronde/geannuleerde/ingeklapte) opdracht
    const openOrder = db().orders.find((o) =>
      o.customerId === existingCustomer.id &&
      !o.archivedWeek &&
      !['afgerond', 'geannuleerd'].includes(o.status));
    if (openOrder) {
      openOrder.thread = openOrder.thread || [];
      openOrder.thread.push({
        id: id('thr'), channel, sender: sender || '',
        subject: subject || '', body: body || '', at: now(),
        attachments: attachments || [],
      });
      // Bijlagen ook op opdracht-niveau verzamelen (foto's/video's van de klant).
      if (attachments && attachments.length) {
        openOrder.attachments = (openOrder.attachments || []).concat(attachments);
      }
      // Markeer dat de KLANT heeft gereageerd -> melding op de kaart.
      openOrder.customerReplied = true;
      openOrder.unreadReplies = (openOrder.unreadReplies || 0) + 1;
      openOrder.lastCustomerReplyAt = now();
      openOrder.updatedAt = now();
      // vul ontbrekende klantgegevens aan
      if (!existingCustomer.email && suggestion.customerEmail) existingCustomer.email = suggestion.customerEmail;
      if (!existingCustomer.phone && suggestion.customerPhone) existingCustomer.phone = suggestion.customerPhone;
      if (!existingCustomer.address && suggestion.customerAddress) existingCustomer.address = suggestion.customerAddress;
      saveSoon();
      logActivity('systeem', 'bericht aan bestaande opdracht', `${existingCustomer.name}: ${openOrder.title}`);
      return { message, review: null, mergedIntoOrder: openOrder.id };
    }
  }

  const review = {
    id: id('rev'),
    messageId: message.id,
    channel,
    suggestion,
    // Geklets komt als 'overige' binnen (aparte lijst), echte aanvragen als 'pending'.
    status: rel.relevant ? 'pending' : 'overige',
    finalStatus: null,
    orderId: null,
    correctedStatus: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: now(),
  };
  db().reviews.push(review);

  const threshold = autoApproveThreshold();
  if (rel.relevant && threshold > 0 && suggestion.confidence >= threshold) {
    applyReview(review, { actorName: 'AI (automatisch)', auto: true });
  }

  saveSoon();
  logActivity('systeem', 'bericht ontvangen', `${channel} van ${sender || 'onbekend'}`);
  return { message, review };
}

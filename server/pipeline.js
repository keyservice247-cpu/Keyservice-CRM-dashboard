// Gedeelde verwerkingslogica voor inkomende berichten.
// Wordt gebruikt door de API-routes én door de koppelingen (IMAP, WhatsApp).
import { db, id, now, saveSoon, logActivity } from './db.js';
import { classify, scoreRelevance } from './ai/categorizer.js';
import { normalizeStatus, firstStatusKey, getCompanyProfile, isWhatsappOrderGroup } from './settings.js';

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

// Normaliseert berichttekst voor inhoud-vergelijking (doorgestuurde berichten
// herkennen): kleine letters, telefoon-regel en "doorgestuurd"-kopjes eruit,
// witruimte samengevoegd.
function normalizeForDedup(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/telefoon:\s*\+?\d[\d\s().-]*/g, '')           // het nummer dat de bridge toevoegt
    .replace(/doorgestuurd|forwarded|fwd:|\bvia drs\b/g, '')
    .replace(/[^a-z0-9à-ÿ ]/g, ' ')                          // leestekens/emoji weg
    .replace(/\s+/g, ' ')
    .trim();
}

export function autoApproveThreshold() {
  const s = db().settings || {};
  if (s.aiAutoApproveThreshold != null) return Number(s.aiAutoApproveThreshold);
  const env = Number(process.env.AI_AUTO_APPROVE_THRESHOLD);
  return Number.isFinite(env) ? env : 0;
}

// Namen die GEEN echte klant zijn (het bedrijf zelf / forwarder / leeg). Hierop mag
// nooit een klant worden samengevoegd, anders belanden allemaal losse klanten op één
// kaart (bv. alles onder "Key Service").
const GENERIC_NAMES = /^(key\s?service|keyservice|key service 24\/?7|het systeem van key service|systeem|info|onbekend|onbekende klant|klant|drs)$/i;
function isGenericName(name) { return !name || GENERIC_NAMES.test(String(name).trim()); }

export function findCustomer({ name, phone, email }) {
  const customers = db().customers;
  const norm = (v) => (v || '').toLowerCase().replace(/[\s().-]/g, '');
  if (email) {
    const m = customers.find((c) => c.email && c.email.toLowerCase() === email.toLowerCase());
    if (m) return m;
  }
  if (phone) {
    const p = norm(phone);
    if (p.length >= 6) {
      const m = customers.find((c) => c.phone && norm(c.phone) === p);
      if (m) return m;
    }
  }
  if (name && !isGenericName(name)) {
    const m = customers.find((c) => c.name && c.name.toLowerCase() === name.toLowerCase());
    if (m) return m;
  }
  return null;
}

// STERKE match: alleen op telefoon of e-mail. Gebruikt om te beslissen of een nieuw
// bericht aan een BESTAANDE kaart mag worden gehangen (samenvoegen). Naam alleen is te
// zwak (en generieke namen als "Key Service" zorgen voor verkeerde samenvoegingen).
export function findCustomerStrong({ phone, email }) {
  const customers = db().customers;
  const norm = (v) => (v || '').toLowerCase().replace(/[\s().-]/g, '');
  if (email) {
    const m = customers.find((c) => c.email && c.email.toLowerCase() === email.toLowerCase());
    if (m) return m;
  }
  if (phone) {
    const p = norm(phone);
    if (p.length >= 6) {
      const m = customers.find((c) => c.phone && norm(c.phone) === p);
      if (m) return m;
    }
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

  // STRENGE DEDUP bij goedkeuren: bestaat er al een actieve (niet-afgeronde/
  // geannuleerde/ingeklapte) kaart van deze klant? Dan dit bericht daaraan
  // toevoegen i.p.v. een tweede kaart maken. Tenzij de gebruiker dat expliciet
  // overslaat (overrides.forceNew).
  const origMsg0 = db().messages.find((m) => m.id === review.messageId);
  if (!overrides.forceNew) {
    const existingOrder = db().orders.find((o) =>
      o.customerId === customer.id &&
      !o.archivedWeek &&
      !['afgerond', 'geannuleerd'].includes(o.status));
    if (existingOrder) {
      existingOrder.thread = existingOrder.thread || [];
      if (origMsg0) {
        existingOrder.thread.push({
          id: id('thr'), channel: origMsg0.channel, sender: origMsg0.sender,
          subject: origMsg0.subject, body: origMsg0.body, at: origMsg0.receivedAt,
          attachments: origMsg0.attachments || [],
        });
        if (origMsg0.attachments && origMsg0.attachments.length) {
          existingOrder.attachments = (existingOrder.attachments || []).concat(origMsg0.attachments);
        }
      }
      existingOrder.customerReplied = true;
      existingOrder.unreadReplies = (existingOrder.unreadReplies || 0) + 1;
      existingOrder.lastCustomerReplyAt = now();
      existingOrder.updatedAt = now();
      review.status = auto ? 'auto_approved' : 'approved';
      review.finalStatus = existingOrder.status;
      review.orderId = existingOrder.id;
      review.reviewedBy = actorName;
      review.reviewedAt = now();
      saveSoon();
      logActivity(actorName, 'bericht aan bestaande opdracht', `${customer.name}: ${existingOrder.title}`);
      return existingOrder;
    }
  }

  const order = {
    id: id('ord'),
    title: overrides.title || s.title || 'Nieuwe opdracht',
    description: overrides.description ?? s.problem ?? '',
    status,
    source: overrides.source || defaultSource,
    // Herkomst-WhatsApp-groep (bv. "Raf breda…") voor de DRS-agenda en monteur-overzicht.
    originGroup: (db().messages.find((m) => m.id === review.messageId)?.group) || '',
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

  // INHOUD-ONTDUBBELEN: een opdracht die uit de DRS-groep wordt doorgestuurd naar
  // Youssef komt als (bijna) identieke tekst opnieuw binnen via WhatsApp. Herken
  // dit en hang het aan de bestaande opdracht/review i.p.v. een tweede kaart.
  const normBody = normalizeForDedup(body);
  if (normBody.length >= 20) {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const twin = db().messages.find((m) =>
      m.channel === 'whatsapp' &&
      new Date(m.receivedAt).getTime() >= dayAgo &&
      normalizeForDedup(m.body) === normBody);
    if (twin) {
      // Hang aan de bijbehorende lopende opdracht als die er is.
      const rev = db().reviews.find((r) => r.messageId === twin.id && r.orderId);
      const order = rev ? db().orders.find((o) => o.id === rev.orderId && !o.archivedWeek) : null;
      if (order) {
        order.thread = order.thread || [];
        order.thread.push({ id: id('thr'), channel, sender: sender || '', subject: subject || '', body: body || '', at: now(), attachments: attachments || [] });
        if (attachments?.length) order.attachments = (order.attachments || []).concat(attachments);
        order.updatedAt = now();
        saveSoon();
        logActivity('systeem', 'dubbele WhatsApp (doorgestuurd) samengevoegd', order.title);
        return { message: twin, review: null, duplicate: true, mergedIntoOrder: order.id };
      }
      // Anders: nog in de inbox -> niet nog een review maken.
      logActivity('systeem', 'dubbele WhatsApp genegeerd', (body || '').slice(0, 40));
      return { message: twin, review: null, duplicate: true };
    }
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

  // Verkeerde contactgegevens opschonen: nooit het eigen bedrijf, een reclame-/
  // magazine- of no-reply-adres als KLANT bewaren. Anders worden losse mensen verkeerd
  // samengevoegd en plakt reclame naar info@... aan kaarten.
  const JUNK_EMAIL_RE = /(keyservice247\.nl|keyservice-crm|@microsoft\.com|@bing|noreply|no-?reply|norep|do-?not-?reply|redactie@|nieuwsbrief|newsletter|mailchimp|sendgrid|mailing|bouwmagazine|facebookmail|linkedin|google\.com)/i;
  const COMPANY_PHONES = ['0850602359', '0031850602359']; // eigen bedrijfsnummer(s)
  const normPhone = (v) => String(v || '').replace(/[^\d]/g, '');
  if (suggestion.customerEmail && JUNK_EMAIL_RE.test(suggestion.customerEmail)) suggestion.customerEmail = '';
  if (suggestion.customerPhone && COMPANY_PHONES.includes(normPhone(suggestion.customerPhone))) suggestion.customerPhone = '';
  // Markeer overduidelijke marketing/niet-opdracht (mag nooit aan een kaart plakken).
  const MARKETING_RE = /(bing|microsoft advertising|places for business|google ads|adwords|nieuwsbrief|newsletter|unsubscribe|afmelden|advertenti|\bseo\b|nieuwe manieren om je bedrijf)/i;
  const looksMarketing = suggestion.aiNotOrder === true || MARKETING_RE.test(`${subject || ''} ${body || ''}`);

  // Ruisfilter: bepaal of dit een echte aanvraag is of geklets. Geklets gaat
  // naar de "Overige"-lijst i.p.v. de gewone te-controleren inbox.
  const rel = scoreRelevance({ subject, body, hasAttachments: (attachments || []).length > 0 });
  // WhatsApp-groepfilter: opdrachten halen we vooral uit de ingestelde groep(en)
  // (standaard de DRS/"Raf Breda"-groep). Berichten uit andere groepen (monteur-
  // groepen van Youssef/Abdel/Oualid) zijn meestal collega-geklets -> "Overige".
  // UITZONDERING: noteert iemand daar concrete klantgegevens na een belletje
  // (telefoon + adres of postcode), dan is het wél een opdracht. Zo blijft de inbox
  // overzichtelijk én missen we geen echte intake.
  const fromOtherGroup = channel === 'whatsapp' && group && !isWhatsappOrderGroup(group);
  const hasPostcode = /\b\d{4}\s?[a-z]{2}\b/i.test(body || '');
  const hasIntakeData = !!(suggestion.customerPhone && (suggestion.customerAddress || hasPostcode));
  const otherGroupButOrder = fromOtherGroup && hasIntakeData;
  const blockAsChatter = fromOtherGroup && !hasIntakeData;
  // De AI mag overrulen: zegt hij expliciet 'geen opdracht' (incasso/leverancier/
  // reclame), dan is het niet relevant — ongeacht wat de regels zeggen.
  const aiSaysNotOrder = suggestion.aiNotOrder === true;
  suggestion.relevant = (aiSaysNotOrder || looksMarketing) ? false : (blockAsChatter ? false : (otherGroupButOrder ? true : rel.relevant));
  if (looksMarketing) { suggestion.aiNotOrder = true; suggestion.confidence = Math.min(suggestion.confidence ?? 0.1, 0.1); }
  suggestion.relevanceReason = looksMarketing
    ? 'Reclame/marketing of nieuwsbrief (bv. Bing/Microsoft/advertenties) — naar Overige.'
    : blockAsChatter ? `Collega-bericht uit groep "${group}" zonder duidelijke klantgegevens — naar Overige.`
    : otherGroupButOrder ? `Klantgegevens (telefoon + adres) herkend in groep "${group}" — als opdracht voorgesteld.`
    : aiSaysNotOrder ? 'AI: dit is geen klantopdracht (bv. incasso/leverancier/reclame).' : rel.reason;

  // Bestaande klant herkennen op TELEFOON/E-MAIL (sterke match). Zo hangt een
  // vervolgbericht aan de lopende opdracht, ZONDER dat losse klanten verkeerd op één
  // kaart belanden (naam alleen is te zwak — denk aan "Key Service" als afzender).
  const existingCustomer = looksMarketing ? null : findCustomerStrong({
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

  // Klantgegevens altijd bewaren in het klantenbestand (ook vóór goedkeuring), zodat
  // namen/e-mails/telefoons nooit verloren gaan. Alleen bij een echte aanvraag met een
  // betrouwbaar contact (e-mail of telefoon), om ruis te voorkomen.
  if (suggestion.relevant && (suggestion.customerEmail || suggestion.customerPhone)) {
    upsertCustomer({
      name: suggestion.customerName,
      phone: suggestion.customerPhone,
      email: suggestion.customerEmail,
      address: suggestion.customerAddress,
      source: channel,
    });
  }

  const review = {
    id: id('rev'),
    messageId: message.id,
    channel,
    suggestion,
    // Geklets komt als 'overige' binnen (aparte lijst), echte aanvragen als 'pending'.
    status: suggestion.relevant ? 'pending' : 'overige',
    finalStatus: null,
    orderId: null,
    correctedStatus: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: now(),
  };
  db().reviews.push(review);

  const threshold = autoApproveThreshold();
  // Automatisch goedkeuren alleen voor ECHTE opdrachten (nooit bij 'geen opdracht'
  // of berichten uit een niet-opdracht-groep).
  if (suggestion.relevant && !suggestion.aiNotOrder && threshold > 0 && suggestion.confidence >= threshold) {
    applyReview(review, { actorName: 'AI (automatisch)', auto: true });
  }

  saveSoon();
  logActivity('systeem', 'bericht ontvangen', `${channel} van ${sender || 'onbekend'}`);
  return { message, review };
}

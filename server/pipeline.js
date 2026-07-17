// Gedeelde verwerkingslogica voor inkomende berichten.
// Wordt gebruikt door de API-routes én door de koppelingen (IMAP, WhatsApp).
import { db, id, now, saveSoon, logActivity } from './db.js';
import { classify, scoreRelevance } from './ai/categorizer.js';
import { normalizeStatus, firstStatusKey, getCompanyProfile, isWhatsappOrderGroup, getCrmAlerts, resolveGroupAlias, learnGroupAlias, groupIdForName } from './settings.js';
import { sendPush } from './push.js';

// ---------- WhatsApp-melding naar het team (groep "CRM meldingen" of 1-op-1) ----------
// Anti-spam: max 1 melding per 2 minuten; wat in de tussentijd binnenkomt wordt geteld
// en meegenomen in de eerstvolgende melding ("+N andere"). Zo blijft de groep rustig,
// ook als er een lading mails tegelijk binnenkomt.
let _waAlertLast = 0;
let _waAlertSuppressed = 0;
export function queueCrmWhatsappAlert(text) {
  try {
    const cfg = getCrmAlerts();
    if (!cfg.enabled) return;
    const nowMs = Date.now();
    if (nowMs - _waAlertLast < 2 * 60000) { _waAlertSuppressed++; return; }
    if (_waAlertSuppressed > 0) { text += `\n(+${_waAlertSuppressed} andere nieuwe meldingen in de afgelopen minuten — zie de inbox)`; _waAlertSuppressed = 0; }
    _waAlertLast = nowMs;
    const item = { id: id('out'), text, status: 'queued', createdAt: now(), by: 'crm-melding' };
    if (cfg.phone) { item.kind = 'whatsapp_customer'; item.phone = cfg.phone; item.group = '__klant_dm__'; }
    else {
      item.group = cfg.group;
      // Groeps-id meegeven (indien gekoppeld): dan kan de bridge direct op id versturen,
      // ook als hij door de WhatsApp-storing geen groepsnamen kan opzoeken.
      const gid = groupIdForName(cfg.group);
      if (gid) item.groupId = gid;
    }
    db().outbox.unshift(item);
    saveSoon();
  } catch (e) { console.error('[crm-melding]', e.message); }
}

// Verstuur een push-melding zonder de verwerking te blokkeren of te laten falen.
function notifyPush(title, body) {
  try { sendPush({ title, body, url: '/' }).catch(() => {}); } catch { /* nooit blokkeren */ }
}

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

// Vergelijkers: telefoon op cijfers, adres genormaliseerd. "Ander adres" = geen van
// beide bevat de ander (zo telt "Lelystad" vs "Dorpsweg 1, Lelystad" NIET als anders,
// maar "Oudenbosch" vs "Lelystad" wél).
const normPhone = (p) => String(p || '').replace(/[^\d]/g, '').replace(/^0031/, '0').replace(/^31(?=\d{9})/, '0');
const normAddr = (a) => String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function phoneDiffers(a, b) { const x = normPhone(a), y = normPhone(b); return !!(x && y && x.length >= 8 && y.length >= 8 && x !== y); }
export function addressDiffers(a, b) {
  const x = normAddr(a), y = normAddr(b);
  return !!(x && y && !x.includes(y) && !y.includes(x));
}

export function upsertCustomer({ name, phone, email, address, source }, opts = {}) {
  let c = findCustomer({ name, phone, email });
  if (c) {
    const changes = [];
    if (!c.phone && phone) c.phone = phone;
    if (!c.email && email) c.email = email;
    if (!c.address && address) c.address = address;
    // BELANGRIJK (goedkeur-moment): geeft de klant in een NIEUWE aanvraag een ander
    // adres/telefoonnummer op, dan is de nieuwste opgave leidend — anders rijdt de
    // monteur naar een oud adres. De wijziging wordt gemeld op de kaart (audit).
    if (opts.updateChanged) {
      if (address && addressDiffers(c.address, address)) { changes.push({ field: 'adres', from: c.address, to: address }); c.address = address; }
      if (phone && phoneDiffers(c.phone, phone)) { changes.push({ field: 'telefoon', from: c.phone, to: phone }); c.phone = phone; }
      if (email && c.email && email.toLowerCase() !== c.email.toLowerCase() && /@/.test(email)) { changes.push({ field: 'e-mail', from: c.email, to: email }); c.email = email; }
    }
    if (c.type === 'lead') c.type = 'klant';
    return { customer: c, created: false, changes };
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
  return { customer: c, created: true, changes: [] };
}

// Bouw snelle opzoek-maps (id -> klant/monteur). Geef die mee aan withRelations
// bij het verwerken van een LIJST opdrachten, zodat je niet per opdracht de hele
// klant-/monteurlijst doorzoekt (O(n²) -> O(n)).
export function buildMaps() {
  return {
    customers: new Map((db().customers || []).map((c) => [c.id, c])),
    monteurs: new Map((db().monteurs || []).map((m) => [m.id, m])),
  };
}

export function withRelations(order, maps) {
  const customer = maps ? (maps.customers.get(order.customerId) || null)
    : (db().customers.find((c) => c.id === order.customerId) || null);
  const monteur = maps ? (maps.monteurs.get(order.monteurId) || null)
    : (db().monteurs.find((m) => m.id === order.monteurId) || null);
  // DRS = afkomstig uit de opdracht-WhatsApp-groep (bv. "Raf Breda…").
  const isDrs = order.originGroup ? isWhatsappOrderGroup(order.originGroup) : false;
  return { ...order, customer, monteur, isDrs };
}

// Maak van een (goedgekeurde) review een echte opdracht + klant.
export function applyReview(review, { actorName, overrides = {}, auto = false }) {
  const s = review.suggestion;
  const status = normalizeStatus(overrides.status || s.status);
  // updateChanged: bij goedkeuren is de NIEUWSTE opgave van de klant leidend (ander
  // adres/telefoon in deze aanvraag wordt overgenomen, met melding op de kaart).
  const { customer, changes: custChanges = [] } = upsertCustomer({
    name: overrides.customerName ?? s.customerName,
    phone: overrides.customerPhone ?? s.customerPhone,
    email: overrides.customerEmail ?? s.customerEmail,
    address: overrides.customerAddress ?? s.customerAddress,
    source: review.channel,
  }, { updateChanged: true });
  const changeNote = custChanges.length
    ? `⚠ Klantgegevens bijgewerkt op basis van deze aanvraag: ${custChanges.map((ch) => `${ch.field}: "${ch.from}" → "${ch.to}"`).join('; ')}. Even checken of dit klopt vóór het inplannen.`
    : '';

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
      if (changeNote) {
        existingOrder.thread.push({ id: id('thr'), channel: 'systeem', outgoing: true, sender: 'Systeem (gegevens-check)', body: changeNote, at: now() });
        logActivity('systeem', 'klantgegevens bijgewerkt (bestaande kaart)', customer.name || '');
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
    // Is er bij binnenkomst een automatische ontvangstbevestiging gestuurd? Toon die in
    // de historie en zet een vlag voor het icoontje op de kaart.
    if (origMsg.autoReplied) {
      order.thread.push({
        id: id('thr'), channel: 'email', outgoing: true, autoReply: true,
        sender: 'Keyservice (automatische bevestiging)',
        subject: origMsg.autoReplied.subject, body: origMsg.autoReplied.body, at: origMsg.autoReplied.at,
      });
      order.autoReplied = { at: origMsg.autoReplied.at };
    }
  }
  // Zichtbare melding op de kaart als klantgegevens zijn bijgewerkt (ander adres/tel).
  if (changeNote) {
    order.thread.push({ id: id('thr'), channel: 'systeem', outgoing: true, sender: 'Systeem (gegevens-check)', body: changeNote, at: now() });
    order.notes = changeNote;
    logActivity('systeem', 'klantgegevens bijgewerkt bij goedkeuren', `${customer.name}: ${custChanges.map((c) => c.field).join(', ')}`);
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
export async function ingestMessage({ channel, sender, subject, body, group, groupId, externalId, attachments = [], forceRelevant = false }) {
  // Stuurt de bridge naam ÉN groeps-id mee? Dan die koppeling meteen leren (self-healing:
  // valt de naam later weg door een WhatsApp-storing, dan kent het CRM de groep al).
  if (groupId && group) learnGroupAlias(groupId, group);
  // Groep-ID -> echte naam vertalen (als de bridge "groep <id>" levert door de
  // WhatsApp-storing). Vanaf hier gebruikt alles de vriendelijke naam: opdracht-groep-
  // herkenning, kaart-titel, statusscan en weergave.
  if (!group && groupId) group = `groep ${String(groupId).replace(/\D/g, '')}`;
  group = resolveGroupAlias(group);
  // Blijft het een kaal groeps-id (geen koppeling bekend)? Waarschuw het team dan
  // duidelijk (1x per groep per 12 uur): één tik in Instellingen → Koppelingen en
  // alles uit die groep wordt weer herkend. Zo blijft zo'n storing nooit meer stil.
  if (channel === 'whatsapp' && /^groep\s+\d{10,}$/i.test(String(group || ''))) {
    try {
      const s = db().settings;
      s._unknownGroupAlerts = s._unknownGroupAlerts || {};
      const key = String(group).replace(/\D/g, '');
      const lastT = s._unknownGroupAlerts[key] ? new Date(s._unknownGroupAlerts[key]).getTime() : 0;
      if (Date.now() - lastT > 12 * 3600000) {
        s._unknownGroupAlerts[key] = now();
        logActivity('systeem', 'onbekende WhatsApp-groep (koppelen!)', String(group));
        notifyPush('Onbekende WhatsApp-groep', `Berichten uit "${group}" komen zonder naam binnen. Koppel de groep in Instellingen → Koppelingen aan z'n echte naam — dan worden opdrachten er weer automatisch uit herkend en doorgestuurd.`);
      }
    } catch { /* melding mag verwerking nooit blokkeren */ }
  }
  // Ontdubbelen: zelfde bericht (zelfde externe id) nooit twee keer verwerken.
  if (externalId) {
    const existing = db().messages.find((m) => m.externalId && m.externalId === externalId);
    if (existing) return { message: existing, review: null, duplicate: true };
  }

  // INHOUD-ONTDUBBELEN: een opdracht die uit de DRS-groep wordt doorgestuurd naar
  // Youssef komt als (bijna) identieke tekst opnieuw binnen via WhatsApp. Herken
  // dit en hang het aan de bestaande opdracht/review i.p.v. een tweede kaart.
  const normBody = normalizeForDedup(body);
  // Telefoonnummer uit een bericht halen (genormaliseerd op cijfers). Twee berichten met
  // dezelfde tekst maar VERSCHILLENDE nummers zijn verschillende klanten -> NIET dedupen
  // (anders raakt een tweede echte lead met standaard-tekst verloren).
  const phoneOf = (t) => { const mm = String(t || '').match(/(?:\+?31|0)\s?6[\s-]?\d(?:[\s-]?\d){7}|\b0\d{1,3}[\s-]?\d{6,8}\b/); return mm ? mm[0].replace(/[^\d]/g, '').replace(/^31/, '0') : ''; };
  const myPhone = phoneOf(body);
  if (normBody.length >= 20) {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const twin = db().messages.find((m) => {
      if (m.channel !== 'whatsapp' || new Date(m.receivedAt).getTime() < dayAgo) return false;
      if (normalizeForDedup(m.body) !== normBody) return false;
      const tp = phoneOf(m.body);
      return !myPhone || !tp || tp === myPhone; // alleen dubbel bij gelijk/ontbrekend nummer
    });
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
  // Website-formulieren komen van ons EIGEN adres (info@...); de echte klant staat in de
  // body bij "Email: ...". Als er nog geen geldig klant-adres is, haal het eerste
  // niet-bedrijfsadres uit de body. Zo gaat ook de auto-bevestiging naar de juiste klant.
  if (!suggestion.customerEmail) {
    const found = String(body || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    const real = found.find((e) => !JUNK_EMAIL_RE.test(e));
    if (real) suggestion.customerEmail = real;
  }
  // Markeer overduidelijke marketing/niet-opdracht (mag nooit aan een kaart plakken).
  const MARKETING_RE = /(bing|microsoft advertising|places for business|google ads|adwords|nieuwsbrief|newsletter|unsubscribe|afmelden|advertenti|\bseo\b|nieuwe manieren om je bedrijf)/i;
  const looksMarketing = suggestion.aiNotOrder === true || MARKETING_RE.test(`${subject || ''} ${body || ''}`);
  // Heeft dit bericht duidelijke KLANTGEGEVENS? Dan is het een echte opdracht — ook al
  // staat er toevallig een woord als "afgerond/opgelost" in (klantwens). Zo voorkomen we
  // dat een echte aanvraag per ongeluk als "rapport" wordt weggefilterd.
  const hasPostcode = /\b\d{4}\s?[a-z]{2}\b/i.test(body || '');
  const hasCustomerData = !!(suggestion.customerPhone && (suggestion.customerAddress || hasPostcode))
    || /(volgende klant|nieuwe klant|naam\s*:\s*\S)/i.test(`${subject || ''} ${body || ''}`);
  // Status-/afrond-RAPPORTAGE van een medewerker (GEEN nieuwe opdracht), bv.
  // "Afgerond: Rosmalen 5247 HS", "Dagrapportage geannuleerde opdrachten", weekfactuur.
  // LET OP: een rapportage bevat vaak óók klant-achtige gegevens (postcodes/nummers van
  // de klussen waarover gerapporteerd wordt). Daarom telt het TOCH als rapport wanneer:
  // - er meerdere postcodes in staan (lijstje klussen ≠ één klant), of
  // - de "klant" een generieke naam is (bv. "Key Service" zelf).
  // Zo wordt een dagrapportage nooit meer een opdracht-kaart die automatisch naar de
  // monteur gaat, terwijl een échte aanvraag (één klant, één adres) er gewoon doorkomt.
  const REPORT_RE = /(\bafgerond\b|\bafgehandeld\b|\bgereed\b|klus\s*(af|klaar|geklaard)|weekfactuur|\bomzet\b|rapportage|dagrapport|geannuleerde opdracht(en)?)/i;
  const postcodeCount = (String(body || '').match(/\b\d{4}\s?[a-z]{2}\b/gi) || []).length;
  const looksReport = REPORT_RE.test(`${subject || ''} ${body || ''}`)
    && (!hasCustomerData || postcodeCount >= 2 || isGenericName(suggestion.customerName));

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
  const hasIntakeData = !!(suggestion.customerPhone && (suggestion.customerAddress || hasPostcode));
  const otherGroupButOrder = fromOtherGroup && hasIntakeData;
  const blockAsChatter = fromOtherGroup && !hasIntakeData;
  // De AI mag overrulen: zegt hij expliciet 'geen opdracht' (incasso/leverancier/
  // reclame), dan is het niet relevant — ongeacht wat de regels zeggen.
  const aiSaysNotOrder = suggestion.aiNotOrder === true;
  // Losse e-mail met DUIDELIJKE klant-intake (telefoon + adres/postcode) is vrijwel
  // zeker een echte aanvraag -> "Te controleren" (een mens beoordeelt 'm), ook als de
  // AI twijfelde. Alleen harde reclame/nieuwsbrief (unsubscribe/adverteren) blijft
  // uitgesloten. Veilig, want Te controleren wordt handmatig gekeurd — nooit auto-opdracht.
  const HARD_MARKETING_RE = /(nieuwsbrief|newsletter|unsubscribe|afmelden|advertenti|\bseo\b|bing|microsoft advertising|google ads|adwords|factuur|incasso|aanmaning)/i;
  const emailIntake = channel === 'email' && hasIntakeData && !looksReport
    && !HARD_MARKETING_RE.test(`${subject || ''} ${body || ''}`);
  if (emailIntake) suggestion.aiNotOrder = false;
  suggestion.relevant = emailIntake ? true
    : (aiSaysNotOrder || looksMarketing || looksReport) ? false
    : (blockAsChatter ? false : (otherGroupButOrder ? true : rel.relevant));
  // Website-formulieren (offerte/contact), ook als ze via FormSubmit worden doorgestuurd
  // vanaf een noreply-adres, zijn ALTIJD een echte aanvraag. Herken de kenmerkende
  // FormSubmit-/formuliertekst en behandel als lead (niet de activatie-mail van FormSubmit).
  const hay = `${subject || ''} ${body || ''}`;
  const isWebsiteForm = /submitted your form on/i.test(hay)
    || /offerteaanvraag via keyservice247|nieuwe (offerte|contact)aanvraag via/i.test(hay)
    || /aanvraag via de website/i.test(hay);
  const isFormActivation = /activate formsubmit|one step away from making forms/i.test(hay);
  // Website-formulieren zijn ALTIJD een echte aanvraag -> Te controleren.
  // KEIHARD: een directe lead van de eigen site (forceRelevant) of een herkende
  // formulier-mail mag door NIEMAND worden overruled — niet door de AI ('geen
  // opdracht'), niet door het marketing- of rapportfilter. Eerder belandden
  // ads-leads daardoor stil in Overige en kreeg de klant geen ontvangstbevestiging.
  const isFormLead = forceRelevant || (isWebsiteForm && !isFormActivation);
  if (isFormLead) {
    suggestion.relevant = true;
    suggestion.aiNotOrder = false;
  }
  if ((looksMarketing || looksReport) && !isFormLead && !emailIntake) { suggestion.aiNotOrder = true; suggestion.confidence = Math.min(suggestion.confidence ?? 0.1, 0.1); }
  suggestion.relevanceReason = isFormLead
    ? 'Website-formulier (offerte/contactaanvraag) — als opdracht voorgesteld.'
    : emailIntake
    ? 'E-mail met duidelijke klantgegevens (telefoon + adres) — als aanvraag voorgesteld.'
    : looksReport
    ? 'Status-/afrond-rapport van een medewerker — geen nieuwe opdracht (naar Overige).'
    : looksMarketing
    ? 'Reclame/marketing of nieuwsbrief (bv. Bing/Microsoft/advertenties) — naar Overige.'
    : blockAsChatter ? `Collega-bericht uit groep "${group}" zonder duidelijke klantgegevens — naar Overige.`
    : otherGroupButOrder ? `Klantgegevens (telefoon + adres) herkend in groep "${group}" — als opdracht voorgesteld.`
    : aiSaysNotOrder ? 'AI: dit is geen klantopdracht (bv. incasso/leverancier/reclame).' : rel.reason;

  // Bestaande klant herkennen op TELEFOON/E-MAIL (sterke match). Zo hangt een
  // vervolgbericht aan de lopende opdracht, ZONDER dat losse klanten verkeerd op één
  // kaart belanden (naam alleen is te zwak — denk aan "Key Service" als afzender).
  const existingCustomer = (looksMarketing && !isFormLead) ? null : findCustomerStrong({
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
      // Noemt het bericht een ÁNDER adres dan bekend? Niet stil overschrijven (nog geen
      // mens naar gekeken), maar wél duidelijk waarschuwen op de kaart — anders rijdt de
      // monteur straks naar het verkeerde adres.
      if (suggestion.customerAddress && addressDiffers(existingCustomer.address, suggestion.customerAddress)) {
        openOrder.thread.push({ id: id('thr'), channel: 'systeem', outgoing: true, sender: 'Systeem (gegevens-check)', body: `⚠ LET OP: in dit bericht staat een ANDER adres: "${suggestion.customerAddress}" — bekend op de kaart: "${existingCustomer.address}". Even bij de klant checken welk adres klopt vóór het inplannen.`, at: now() });
      }
      saveSoon();
      logActivity('systeem', 'bericht aan bestaande opdracht', `${existingCustomer.name}: ${openOrder.title}`);
      notifyPush('Nieuwe reactie van klant', `${existingCustomer.name || 'Klant'} reageerde op: ${openOrder.title}`);
      if (getCrmAlerts().notifyReplies) queueCrmWhatsappAlert(`💬 CRM: ${existingCustomer.name || 'een klant'} reageerde op de lopende kaart "${openOrder.title}". Even kijken in het dashboard.`);
      return { message, review: null, mergedIntoOrder: openOrder.id, suggestion };
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

  // VANGNET: komt een website-lead via de FormSubmit-MAIL binnen zonder dat de
  // directe website->CRM-koppeling dezelfde lead (telefoon/e-mail) in de afgelopen
  // 20 min aanleverde, dan is de directe koppeling mogelijk stuk -> direct alarm.
  if (isWebsiteForm && !forceRelevant && !isFormActivation) {
    const cutoff = Date.now() - 20 * 60000;
    const phone = (suggestion.customerPhone || '').replace(/[^\d]/g, '');
    const mail = (suggestion.customerEmail || '').toLowerCase();
    const directTwin = db().messages.find((m) => m.body && m.body.startsWith('Nieuwe aanvraag via de website')
      && m.receivedAt && new Date(m.receivedAt).getTime() >= cutoff
      && ((phone && m.body.replace(/[^\d]/g, '').includes(phone)) || (mail && m.body.toLowerCase().includes(mail))));
    if (!directTwin) {
      logActivity('systeem', 'VANGNET: lead alleen via FormSubmit-mail', suggestion.customerName || sender || '');
      notifyPush('⚠ Website-lead alleen via e-mail binnen', 'De directe website→CRM-koppeling leverde deze lead niet aan. De lead is veilig binnen via de mail-route, maar check de koppeling op de site.');
    }
  }

  saveSoon();
  logActivity('systeem', 'bericht ontvangen', `${channel} van ${sender || 'onbekend'}`);
  // Melding alleen bij een echte nieuwe aanvraag (niet bij geklets/overige).
  if (review.status === 'pending') {
    const who = suggestion.customerName || sender || 'Onbekend';
    const what = (subject || body || '').replace(/\s+/g, ' ').slice(0, 80);
    notifyPush('Nieuwe aanvraag', `${who}${what ? ' — ' + what : ''}`);
    // WhatsApp-seintje naar het team (groep "CRM meldingen" of de assistente 1-op-1).
    const src = channel === 'email' ? 'e-mail/website' : channel;
    const place = (suggestion.customerAddress || '').replace(/\s+/g, ' ').slice(0, 60);
    queueCrmWhatsappAlert(`🔔 CRM: nieuwe aanvraag te controleren — ${who}${place ? ` (${place})` : ''} via ${src}.\nOpen de inbox: https://keyservice-crm.onrender.com`);
  }
  return { message, review };
}

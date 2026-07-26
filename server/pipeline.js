// Gedeelde verwerkingslogica voor inkomende berichten.
// Wordt gebruikt door de API-routes én door de koppelingen (IMAP, WhatsApp).
import { db, id, now, saveSoon, logActivity } from './db.js';
import { classify, scoreRelevance } from './ai/categorizer.js';
import { normalizeStatus, firstStatusKey, getCompanyProfile, isWhatsappOrderGroup, getCrmAlerts, resolveGroupAlias, learnGroupAlias, groupIdForName, getEmailFilters, getAutoMergeWindowHours } from './settings.js';
import { mergeAttachments, dedupeAttachments } from './storage.js';
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

// Namen die GEEN echte klant zijn (het bedrijf zelf / forwarder / leeg). Zo'n naam
// mag nooit koppelgrond zijn én nooit als klantnaam worden opgeslagen — de afzender
// (bv. een DRS-doorstuurder of "Key Service Admin") is nooit de klant.
const GENERIC_NAMES = /^(key\s?service( admin)?|keyservice|key service 24\/?7|het systeem van key service|systeem|info|onbekend|onbekende klant|klant|drs|no-?reply|formsubmit|website)$/i;
export function isGenericName(name) { return !name || GENERIC_NAMES.test(String(name).trim()); }

// LEAD-INSTROOM WET (Regel 2): koppelen aan een bestaande klant mag ALLEEN op harde
// identificatoren — ① e-mail exact of ② telefoonnummer genormaliseerd exact. Naam is
// NOOIT een koppelgrond (hooguit extra bevestiging): drie verschillende klanten die
// door dezelfde DRS-afzender werden doorgestuurd, zijn ooit op afzendernaam tot één
// klant samengevoegd — dat mag nooit meer gebeuren.
// Telefoon-normalisatie voor matching: alleen cijfers, en internationaal NL naar
// nationaal (0031… / 31… → 0…), zodat "+31 6 11 11 11 11" en "0611111111" als
// HETZELFDE nummer tellen — het bekendste gat waardoor een klant-reactie niet aan
// z'n kaart hing.
export const matchPhone = (v) => String(v || '').replace(/[^\d]/g, '').replace(/^0031/, '0').replace(/^31(?=\d{9})/, '0');

export function findCustomer({ name, phone, email }) {
  const customers = db().customers;
  if (email) {
    const m = customers.find((c) => c.email && c.email.toLowerCase() === email.toLowerCase());
    if (m) return m;
  }
  if (phone) {
    const p = matchPhone(phone);
    if (p.length >= 6) {
      const m = customers.find((c) => c.phone && matchPhone(c.phone) === p);
      if (m) return m;
    }
  }
  return null;
}

// Het échte afzendernummer uit de berichttekst van een 1-op-1 WhatsApp: de bridge
// en de Cloud-API plakken dat ALTIJD als laatste regel "Telefoon: +31…" onder de
// body. $ zonder /m matcht alleen het einde van de hele tekst — dus dit pakt nooit
// een nummer dat de klant zelf midden in het bericht typte.
export const senderPhoneFromText = (body) =>
  ((String(body || '').match(/telefoon:\s*(\+?[\d][\d\s()-]{6,})\s*$/i) || [])[1] || '').replace(/[^\d+]/g, '');

// STERKE match: alleen op telefoon of e-mail. Gebruikt om te beslissen of een nieuw
// bericht aan een BESTAANDE kaart mag worden gehangen (samenvoegen). Naam alleen is te
// zwak (en generieke namen als "Key Service" zorgen voor verkeerde samenvoegingen).
export function findCustomerStrong({ phone, email }) {
  const customers = db().customers;
  if (email) {
    const m = customers.find((c) => c.email && c.email.toLowerCase() === email.toLowerCase());
    if (m) return m;
  }
  if (phone) {
    const p = matchPhone(phone);
    if (p.length >= 6) {
      const m = customers.find((c) => c.phone && matchPhone(c.phone) === p);
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

// LEAD-INSTROOM WET (Regel 3): bestaande klantgegevens worden NOOIT automatisch
// overschreven. Afwijkingen (ander adres/telefoon/e-mail/naam) komen terug als
// SUGGESTIES — de mens beslist op de kaart of het klantrecord wordt bijgewerkt.
// Alleen LEGE velden aanvullen mag (dat overschrijft niets). De kaart zelf gebruikt
// altijd de gegevens uit de aanvraag (order.intake), dus de opdracht klopt sowieso.
export function upsertCustomer({ name, phone, email, address, source }, opts = {}) {
  let c = findCustomer({ name, phone, email });
  if (c) {
    const suggestions = [];
    if (!c.phone && phone) c.phone = phone;
    if (!c.email && email) c.email = email;
    if (!c.address && address) c.address = address;
    if (address && addressDiffers(c.address, address)) suggestions.push({ field: 'adres', from: c.address, to: address });
    if (phone && phoneDiffers(c.phone, phone)) suggestions.push({ field: 'telefoon', from: c.phone, to: phone });
    if (email && c.email && email.toLowerCase() !== c.email.toLowerCase() && /@/.test(email)) suggestions.push({ field: 'e-mail', from: c.email, to: email });
    // Naam alleen als extra bevestiging: een afwijkende ECHTE naam wordt een suggestie.
    if (name && !isGenericName(name) && c.name && !isGenericName(c.name)
      && name.trim().toLowerCase() !== c.name.trim().toLowerCase()) {
      suggestions.push({ field: 'naam', from: c.name, to: name });
    }
    // Eerder als "Onbekende klant" opgeslagen en nu is er wél een echte naam? Aanvullen mag.
    if (name && !isGenericName(name) && (!c.name || isGenericName(c.name))) c.name = name;
    if (c.type === 'lead') c.type = 'klant';
    // Nog steeds geen echte naam? Dan blijft de kaart "Klant onbekend — aanvullen"
    // vragen (ook als het record al bij binnenkomst was aangemaakt).
    return { customer: c, created: false, changes: [], suggestions, unknownName: !c.name || isGenericName(c.name) };
  }
  // WET (Regel 2): een generieke naam ("Key Service", "DRS", afzender-restjes) mag
  // NOOIT als klantnaam worden opgeslagen — dan heet het record "Onbekende klant" en
  // krijgt de kaart het label "Klant onbekend — aanvullen".
  const unknownName = !name || isGenericName(name);
  c = {
    id: id('cust'),
    name: unknownName ? 'Onbekende klant' : name,
    phone: phone || '',
    email: email || '',
    address: address || '',
    type: 'lead',
    source: source || 'handmatig',
    notes: '',
    createdAt: now(),
  };
  db().customers.push(c);
  return { customer: c, created: true, changes: [], suggestions: [], unknownName };
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
  // INTAKE-GEGEVENS: de gegevens zoals ze in DÉZE aanvraag staan. De kaart gebruikt
  // altijd deze gegevens (dus de opdracht/monteur klopt altijd), het klantrecord
  // wordt NOOIT stil herschreven (Regel 3) — afwijkingen worden suggesties.
  const intake = {
    name: (overrides.customerName ?? s.customerName ?? '') || '',
    phone: (overrides.customerPhone ?? s.customerPhone ?? '') || '',
    email: (overrides.customerEmail ?? s.customerEmail ?? '') || '',
    address: (overrides.customerAddress ?? s.customerAddress ?? '') || '',
  };
  const { customer, suggestions: custSuggestions = [], unknownName } = upsertCustomer({
    ...intake,
    source: review.channel,
  });

  const defaultSource = review.channel === 'whatsapp' ? 'Keyservice WhatsApp'
    : review.channel === 'email' ? 'Keyservice e-mail'
    : 'Handmatig';

  // LEAD-INSTROOM WET (Regel 1): elke goedgekeurde aanvraag wordt een NIEUWE kaart,
  // óók als deze klant al een open kaart heeft. Automatisch samenvoegen bestaat niet
  // meer — de nieuwe kaart krijgt een SUGGESTIE ("Mogelijk zelfde opdracht als kaart
  // X — samenvoegen?") en de mens beslist. Zelfde input geeft zo altijd zelfde
  // uitkomst; er verdwijnt nooit meer stil een aanvraag in een oude kaart.
  const openOrder = db().orders.find((o) =>
    o.customerId === customer.id &&
    !o.archivedWeek &&
    !['afgerond', 'geannuleerd'].includes(o.status));

  // VERFIJNING Regel 1 (25 jul, akkoord Abdel): "zelfde moment"-samenvoegen.
  // Heeft deze klant een open kaart die KORT geleden (venster, standaard 6 uur,
  // instelbaar, 0 = uit) is aangemaakt of bijgewerkt, dan is deze aanvraag vrijwel
  // altijd dezelfde klus (tweede appje, foto's erbij, website + DRS tegelijk) —
  // dan hangt hij DIRECT aan die kaart, met een zichtbare systeemnotitie. Is de
  // open kaart ouder, dan geldt Regel 1 onverkort: nieuwe kaart + suggestie.
  // Klantrecord-regels (2/3) veranderen niet: upsertCustomer hierboven heeft al
  // gematcht op harde identificatoren en niets stil overschreven.
  const mergeWindowH = getAutoMergeWindowHours();
  // Venster op CREATEDAT: "wanneer begon deze klus" — bewust niet updatedAt, want
  // die schuift op door elke handeling (dan zou een 3 weken oude kaart waar net op
  // is geantwoord een compleet nieuwe klus opslokken, en sloot het venster nooit).
  const openRefMs = openOrder ? new Date(openOrder.createdAt || openOrder.updatedAt).getTime() : NaN;
  // De mens heeft in het goedkeur-scherm iets WEZENLIJKS aangepast (andere kolom,
  // eigen titel, monteur gekozen)? Dan is dit bewust een eigen kaart — niet mergen.
  const humanChanged = !auto && (
    (overrides.status && normalizeStatus(overrides.status) !== normalizeStatus(s.status))
    || (typeof overrides.title === 'string' && overrides.title.trim() && overrides.title.trim() !== String(s.title || '').trim())
    || !!overrides.monteurId
  );
  // Ander adres dan de open kaart? Dan is het vrijwel zeker een ANDERE klus — Regel 1.
  const otherAddress = !!(intake.address && addressDiffers((openOrder && openOrder.intake && openOrder.intake.address) || customer.address, intake.address));
  if (openOrder && mergeWindowH > 0 && Number.isFinite(openRefMs)
      && (Date.now() - openRefMs) < mergeWindowH * 3600000
      && !humanChanged && !otherAddress) {
    const origMsg2 = db().messages.find((m) => m.id === review.messageId);
    openOrder.thread = openOrder.thread || [];
    if (origMsg2) {
      openOrder.thread.push({
        id: id('thr'), channel: origMsg2.channel, sender: origMsg2.sender,
        subject: origMsg2.subject, body: origMsg2.body, at: origMsg2.receivedAt,
        attachments: origMsg2.attachments || [],
      });
      if (origMsg2.attachments && origMsg2.attachments.length) {
        openOrder.attachments = mergeAttachments(openOrder.attachments || [], origMsg2.attachments);
      }
    }
    openOrder.thread.push({ id: id('thr'), channel: 'systeem', outgoing: true, sender: 'Systeem (samenvoegen)', body: `Nieuwe aanvraag van dezelfde klant binnen ${mergeWindowH} uur — automatisch aan deze kaart toegevoegd. (Venster instelbaar bij Instellingen → Werkwijze; los te maken via de historie.)`, at: now() });
    if (custSuggestions.length) {
      const seen = new Set((openOrder.dataSuggestions || []).map((x) => `${x.field}:${x.to}`));
      openOrder.dataSuggestions = [...(openOrder.dataSuggestions || []), ...custSuggestions.filter((x) => !seen.has(`${x.field}:${x.to}`))];
    }
    // ZICHTBAAR maken (nooit stil): badge + teller + push, en spoed erft over.
    openOrder.customerReplied = true;
    openOrder.unreadReplies = (openOrder.unreadReplies || 0) + 1;
    openOrder.lastCustomerReplyAt = now();
    if (s.urgent) openOrder.urgent = true;
    // Intake-gaten aanvullen met déze aanvraag (nooit overschrijven — Regel 3) en de
    // probleemomschrijving AANVULLEN zodat een (latere) monteur-dispatch alles bevat.
    openOrder.intake = openOrder.intake || {};
    for (const k of ['name', 'phone', 'email', 'address']) {
      if (!openOrder.intake[k] && intake[k]) openOrder.intake[k] = intake[k];
    }
    const extraProblem = String(s.problem || '').trim();
    if (extraProblem && !String(openOrder.description || '').includes(extraProblem.slice(0, 60))) {
      openOrder.description = (openOrder.description ? `${openOrder.description}\n— Aanvulling: ` : '') + extraProblem;
    }
    // Is de kaart al naar de monteur? Stuur dan een korte AANVULLING naar dezelfde
    // groep — de nieuwe informatie mag nooit stil in de kaart blijven hangen.
    if (openOrder.sentToMonteur && origMsg2) {
      const mont = db().monteurs.find((m) => m.id === (openOrder.sentToMonteur.monteurId || openOrder.monteurId));
      if (mont && mont.waGroup) {
        db().outbox.unshift({
          id: id('out'), orderId: openOrder.id, group: mont.waGroup,
          groupId: groupIdForName(mont.waGroup) || undefined,
          phone: String(mont.phone || '').trim() || undefined, monteurName: mont.name,
          text: `*Aanvulling bij eerdere opdracht* — ${openOrder.title}\n${customer.name ? `Klant: ${customer.name}\n` : ''}${String(origMsg2.body || '').slice(0, 600)}`,
          status: 'queued', createdAt: now(), by: 'samenvoegen-aanvulling',
        });
        logActivity('systeem', 'aanvulling naar monteur', `${openOrder.title} -> ${mont.name}`);
      }
    }
    openOrder.updatedAt = now();
    review.status = auto ? 'auto_approved' : 'approved';
    review.finalStatus = openOrder.status;
    review.orderId = openOrder.id;
    review.mergedIntoOrder = true;
    review.correctedStatus = null;
    review.reviewedBy = actorName;
    review.reviewedAt = now();
    logActivity(actorName, 'aanvraag automatisch samengevoegd', `${customer.name || 'klant'}: ${openOrder.title} (binnen ${mergeWindowH}u)`);
    sendPush({ title: 'Aanvraag samengevoegd', body: `${customer.name || 'Klant'}: extra aanvraag toegevoegd aan "${openOrder.title}"`, url: '/' }).catch(() => {});
    saveSoon();
    return openOrder;
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
    // Gegevens van DEZE aanvraag (kaart-waarheid; klantrecord kan afwijken).
    intake,
    // "Klant onbekend — aanvullen": er is geen echte klantnaam uit de tekst gehaald.
    customerIncomplete: !!unknownName || undefined,
    // Suggestie: mogelijk zelfde opdracht als een al open kaart (mens beslist).
    mergeSuggestion: openOrder ? { orderId: openOrder.id, title: openOrder.title, at: now() } : undefined,
    // Suggesties: aanvraag wijkt af van het klantrecord (mens beslist over bijwerken).
    dataSuggestions: custSuggestions.length ? custSuggestions : undefined,
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
      order.attachments = dedupeAttachments(origMsg.attachments);
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
  // Zichtbare SUGGESTIES op de kaart (niets is automatisch toegepast — de mens beslist).
  if (custSuggestions.length) {
    const note = `⚠ Deze aanvraag wijkt af van het klantrecord: ${custSuggestions.map((ch) => `${ch.field}: "${ch.from || '—'}" → "${ch.to}"`).join('; ')}. Niets automatisch gewijzigd — bijwerken kan met één klik op de kaart. De kaart zelf gebruikt de gegevens uit deze aanvraag.`;
    order.thread.push({ id: id('thr'), channel: 'systeem', outgoing: true, sender: 'Systeem (gegevens-check)', body: note, at: now() });
    logActivity('systeem', 'afwijkende klantgegevens (suggestie)', `${customer.name}: ${custSuggestions.map((c) => c.field).join(', ')}`);
  }
  if (unknownName) {
    order.thread.push({ id: id('thr'), channel: 'systeem', outgoing: true, sender: 'Systeem (gegevens-check)', body: 'Klant onbekend — er is geen echte klantnaam in dit bericht gevonden. Vul de klantgegevens aan op de kaart (de afzender is nooit automatisch de klant).', at: now() });
  }
  if (order.mergeSuggestion) {
    order.thread.push({ id: id('thr'), channel: 'systeem', outgoing: true, sender: 'Systeem (dubbel-check)', body: `Mogelijk zelfde opdracht als de open kaart "${order.mergeSuggestion.title}" van deze klant. Niets automatisch samengevoegd — samenvoegen kan met één klik, of negeer deze melding.`, at: now() });
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
export async function ingestMessage({ channel, sender, subject, body, group, groupId, externalId, attachments = [], forceRelevant = false, mailbox = '', inReplyTo = '', fromPhone = '' }) {
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

  // Binnen dit bericht al identieke bijlages weghalen (bv. een formulier dat dezelfde
  // foto dubbel meestuurt).
  attachments = dedupeAttachments(attachments);

  // WEBSITE-DEDUP: dezelfde aanvraag komt vaak dubbel binnen — één keer rechtstreeks
  // van de site (POST /api/ingest/form) en één keer als (FormSubmit-)e-mail op de
  // mailbox. Die mail kan flink vertragen (aflevering + IMAP-poll), dus we kijken tot
  // 3 UUR terug en ontdubbelen op telefoon/e-mail. De tweede binnenkomst (incl.
  // bijlages, maar zonder identieke dubbelen) hangt aan de eerste lead i.p.v. een
  // tweede kaart te maken.
  // REACTIE-HERKENNING e-mail (deterministisch, hier al nodig): een antwoord in een
  // bestaande wisseling — Re:/Antw:-onderwerp of In-Reply-To-header — is nooit een
  // nieuwe aanvraag én mag ook niet door de website-dedup worden opgeslokt (het
  // geciteerde origineel onder de reply lijkt anders sprekend op de eerste aanvraag).
  const REPLY_SUBJECT_RE = /^\s*(re|aw|antw)\s*:/i;
  const isEmailReply = channel === 'email' && !forceRelevant
    && (REPLY_SUBJECT_RE.test(subject || '') || !!inReplyTo);

  const WEBSITE_LEAD_RE = /(nieuwe aanvraag via de website|submitted your form on|offerte-?aanvraag (schuifpui|via)|nieuwe (offerte|contact)aanvraag via|aanvraag via de website)/i;
  const looksWebsiteLead = !isEmailReply && (forceRelevant || WEBSITE_LEAD_RE.test(`${subject || ''}\n${body || ''}`));
  if (looksWebsiteLead) {
    const win = Date.now() - 180 * 60000;
    const mailOf = (t) => ((String(t || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])
      .map((e) => e.toLowerCase()).find((e) => !/keyservice247\.nl|keyservice-crm|formsubmit/.test(e)) || '');
    const myMail = mailOf(body);
    const twin = db().messages.find((m) => {
      if (!m.receivedAt || new Date(m.receivedAt).getTime() < win) return false;
      if (!WEBSITE_LEAD_RE.test(`${m.subject || ''}\n${m.body || ''}`)) return false;
      const tp = phoneOf(m.body);
      const tm = mailOf(m.body);
      return (myPhone && tp && tp === myPhone) || (myMail && tm && tm === myMail);
    });
    if (twin) {
      if (attachments && attachments.length) {
        // Identieke foto's (zelfde inhoud) niet nóg een keer toevoegen.
        twin.attachments = mergeAttachments(twin.attachments || [], attachments);
        const rev0 = db().reviews.find((r) => r.messageId === twin.id);
        if (rev0 && rev0.orderId) {
          const ord = db().orders.find((o) => o.id === rev0.orderId);
          if (ord) { ord.attachments = mergeAttachments(ord.attachments || [], attachments); ord.updatedAt = now(); }
        }
      }
      saveSoon();
      logActivity('systeem', 'dubbele websitelead samengevoegd (site+mail)', `${sender || ''} ${myPhone || myMail}`.trim());
      return { message: twin, review: db().reviews.find((r) => r.messageId === twin.id) || null, duplicate: true };
    }
  }
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
        if (attachments?.length) order.attachments = mergeAttachments(order.attachments || [], attachments);
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
    // Bron-markering: via welke mailbox/route kwam dit binnen (bv.
    // "contact@keyservice247.nl" of "website-direct"). Leeg = hoofdroute.
    mailbox: mailbox || '',
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

  // HET ÉCHTE AFZENDERNUMMER bij een 1-op-1 WhatsApp-bericht (WET Regel 2: harde
  // identificator — net als het échte afzenderadres bij e-mailreacties). Nieuwere
  // bridge/Cloud-API geeft het mee als fromPhone-veld; anders lezen we de laatste
  // regel "Telefoon: +31…" die de bridge altijd onder de body plakt. In een GROEP
  // is de afzender de doorstuurder (DRS/monteur), dus daar geldt dit bewust NIET.
  const waFromRaw = (channel === 'whatsapp' && !group)
    ? (String(fromPhone || '').replace(/[^\d+]/g, '') || senderPhoneFromText(body))
    : '';
  // Alleen een PLAUSIBEL nummer telt als afzender-identiteit (6-13 cijfers).
  // Een WhatsApp-LID (15-18 cijfers, bij een storing in de nummer-opzoeking van de
  // bridge) of ander onzin-id mag nooit als telefoonnummer het klantbestand in.
  const waFromDigits = waFromRaw.replace(/[^\d]/g, '').length;
  const waFrom = (waFromDigits >= 6 && waFromDigits <= 13) ? waFromRaw : '';
  // Verkeerde contactgegevens opschonen: nooit het eigen bedrijf, een reclame-/
  // magazine- of no-reply-adres als KLANT bewaren. Anders worden losse mensen verkeerd
  // samengevoegd en plakt reclame naar info@... aan kaarten.
  const JUNK_EMAIL_RE = /(keyservice247\.nl|keyservice-crm|@microsoft\.com|@bing|noreply|no-?reply|norep|do-?not-?reply|redactie@|nieuwsbrief|newsletter|mailchimp|sendgrid|mailing|bouwmagazine|facebookmail|linkedin|google\.com|formsubmit)/i;
  const COMPANY_PHONES = ['0850602359', '0031850602359']; // eigen bedrijfsnummer(s)
  const normPhone = (v) => String(v || '').replace(/[^\d]/g, '');
  if (suggestion.customerEmail && JUNK_EMAIL_RE.test(suggestion.customerEmail)) suggestion.customerEmail = '';
  if (suggestion.customerPhone && COMPANY_PHONES.includes(normPhone(suggestion.customerPhone))) suggestion.customerPhone = '';
  // Onzin-nummers uit de TEKST (bv. tikfout-handtekening "+278520207007866") mogen
  // nooit een klantrecord worden of de matching sturen: geen echt telefoonnummer is
  // langer dan 13 cijfers. Zet de AI twee nummers in één veld, knip dan het eerste
  // plausibele nummer eruit i.p.v. alles weg te gooien.
  if (suggestion.customerPhone && normPhone(suggestion.customerPhone).length > 13) {
    const first = (String(suggestion.customerPhone).match(/\+?\d[\d\s().-]{5,}/) || [''])[0];
    suggestion.customerPhone = (first && normPhone(first).length >= 6 && normPhone(first).length <= 13) ? first.trim() : '';
  }
  // Bij een 1-op-1 appje is het échte afzendernummer de betrouwbaarste identiteit:
  // gebruik het als klantnummer wanneer de tekst-extractie niets (bruikbaars) gaf.
  if (waFrom && !suggestion.customerPhone) suggestion.customerPhone = waFrom;
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
  // LEAD-INSTROOM WET (Regel 4): leveranciers-/webshop-post (orderbevestiging,
  // bestelling, factuur, verzend-/bezorgbericht, betaalherinnering, no-reply) wordt
  // STIL naar Overige geleid — nooit een pending lead, nooit een melding. Patronen
  // (code-basislijst + eigen patronen uit Instellingen) matchen alléén op afzender +
  // onderwerp, nooit op de body — een klant die over "de bestelling" schrijft wordt
  // dus niet geraakt. Website-formulieren winnen altijd (isFormLead verderop).
  const supplierHay = `${sender || ''} ${subject || ''}`.toLowerCase();
  const looksSupplier = channel === 'email' && !forceRelevant
    && getEmailFilters().some((p) => supplierHay.includes(p));
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
  // Een e-mailREACTIE (isEmailReply, hierboven bepaald) is GEEN nieuwe aanvraag —
  // ook al staan er geciteerde klantgegevens in. Het hoort in de gesprekshistorie
  // van de lopende kaart; nooit een losse kaart of inbox-item met samenvoeg-gedoe.
  // (Fwd:/doorgestuurd telt bewust NIET als reactie: dat is vaak wél een nieuwe klant.)
  const emailIntake = channel === 'email' && !isEmailReply && hasIntakeData && !looksReport && !looksSupplier
    && !HARD_MARKETING_RE.test(`${subject || ''} ${body || ''}`);
  if (emailIntake) suggestion.aiNotOrder = false;
  // Volgorde is bewust: leveranciersfilter wint van intake-herkenning (een order-
  // bevestiging van een webshop bevat ook een adres + telefoonnummer!), maar het
  // website-formulier (isFormLead, verderop) wint van alles.
  suggestion.relevant = looksSupplier ? false
    : emailIntake ? true
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
  if ((looksMarketing || looksReport || looksSupplier) && !isFormLead && !emailIntake) { suggestion.aiNotOrder = true; suggestion.confidence = Math.min(suggestion.confidence ?? 0.1, 0.1); }
  suggestion.relevanceReason = isFormLead
    ? 'Website-formulier (offerte/contactaanvraag) — als opdracht voorgesteld.'
    : looksSupplier
    ? 'Leveranciers-/webshop-mail (bestelling/factuur/verzending/no-reply) — stil naar Overige.'
    : emailIntake
    ? 'E-mail met duidelijke klantgegevens (telefoon + adres) — als aanvraag voorgesteld.'
    : looksReport
    ? 'Status-/afrond-rapport van een medewerker — geen nieuwe opdracht (naar Overige).'
    : looksMarketing
    ? 'Reclame/marketing of nieuwsbrief (bv. Bing/Microsoft/advertenties) — naar Overige.'
    : blockAsChatter ? `Collega-bericht uit groep "${group}" zonder duidelijke klantgegevens — naar Overige.`
    : otherGroupButOrder ? `Klantgegevens (telefoon + adres) herkend in groep "${group}" — als opdracht voorgesteld.`
    : aiSaysNotOrder ? 'AI: dit is geen klantopdracht (bv. incasso/leverancier/reclame).' : rel.reason;

  // LEAD-INSTROOM WET (Regel 1): AANVRAAG-verkeer (opdracht-groepen, website-
  // formulieren, e-mail mét intake-gegevens, vangnet-treffers) wordt NOOIT meer
  // automatisch aan een lopende kaart gehangen — dat wordt bij goedkeuren een NIEUWE
  // kaart met een samenvoeg-suggestie (zie applyReview). Alleen REACTIE-verkeer
  // (een 1-op-1 appje of e-mail zonder intake-kenmerken, van een klant met een open
  // kaart) blijft als bericht in de gesprekshistorie komen — anders zou elk
  // "ok, tot morgen!" een losse kaart worden en sterft de chat-weergave + het
  // "Nieuw bericht"-belletje.
  const isOrderGroupMsg = channel === 'whatsapp' && !!group && isWhatsappOrderGroup(group);
  const isNewAanvraag = !isEmailReply && (isFormLead || emailIntake || isOrderGroupMsg || otherGroupButOrder);
  // Bij een e-mailREACTIE is het ECHTE afzenderadres leidend voor de koppeling aan
  // de kaart — de AI-extractie kan bij replies per ongeluk gegevens uit de
  // geciteerde tekst pakken.
  const fromEmail = channel === 'email'
    ? ((String(sender || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [''])[0])
    : '';
  // HARDE afzender-treffer: het échte e-mailadres (bij een reply) of het échte
  // WhatsApp-afzendernummer (1-op-1). Zo'n treffer wint van het AI-oordeel
  // "geen opdracht" (looksMarketing): een klant die z'n afspraak annuleert of iets
  // korts terugstuurt hoort ALTIJD in de gesprekshistorie van z'n kaart — nooit
  // als losse lead. Het leveranciersfilter (Regel 4, expliciete lijst) blijft wel
  // boven alles gaan, en aanvraag-verkeer blijft een nieuwe kaart (Regel 1).
  const hardSender = (isEmailReply && fromEmail ? findCustomerStrong({ email: fromEmail }) : null)
    || (waFrom ? findCustomerStrong({ phone: waFrom }) : null);
  const existingCustomer = (isNewAanvraag || (looksSupplier && !isFormLead)) ? null
    : (hardSender
      || ((looksMarketing && !isFormLead) ? null
        : findCustomerStrong({ phone: suggestion.customerPhone, email: suggestion.customerEmail })));
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
      // Bijlagen ook op opdracht-niveau verzamelen (foto's/video's van de klant),
      // zonder identieke dubbelen.
      if (attachments && attachments.length) {
        openOrder.attachments = mergeAttachments(openOrder.attachments || [], attachments);
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
      // …en óók de LEGE intake-velden van de kaart (gegevens uit de gesprekshistorie
      // horen vanzelf op de kaart te komen — nooit overschrijven, alleen aanvullen;
      // een generieke naam zoals "U"/"Key Service" wordt nooit een klantnaam).
      openOrder.intake = openOrder.intake || {};
      if (!openOrder.intake.name && suggestion.customerName && !isGenericName(suggestion.customerName) && String(suggestion.customerName).trim().length >= 2) openOrder.intake.name = suggestion.customerName;
      if (!openOrder.intake.phone && suggestion.customerPhone) openOrder.intake.phone = suggestion.customerPhone;
      if (!openOrder.intake.email && suggestion.customerEmail) openOrder.intake.email = suggestion.customerEmail;
      if (!openOrder.intake.address && suggestion.customerAddress) openOrder.intake.address = suggestion.customerAddress;
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

  // Klantgegevens alvast bewaren — maar ALLEEN voor echt aanvraag-verkeer met een
  // betrouwbaar contact. WET (Regel 5): een los 1-op-1 appje maakt NOOIT automatisch
  // een klant aan; dat gebeurt pas als een mens de aanvraag goedkeurt.
  if (isNewAanvraag && suggestion.relevant && (suggestion.customerEmail || suggestion.customerPhone)) {
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
  // WET (Regel 5): alleen aanvragen uit de OPDRACHT-groepen mogen automatisch een
  // kaart worden (via de drempel hier, of volautomatisch via de intake-flow).
  // Losse 1-op-1 appjes, e-mails en website-formulieren gaan ALTIJD eerst langs een
  // mens in Te controleren — de AI vult nooit zelf ontbrekende gegevens in.
  if (isOrderGroupMsg && suggestion.relevant && !suggestion.aiNotOrder && threshold > 0 && suggestion.confidence >= threshold) {
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

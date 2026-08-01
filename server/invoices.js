// Facturen + werkbon: monteur of kantoor maakt vanuit een opdracht een factuur,
// verstuurt die als nette PDF per e-mail naar de klant, en markeert 'm betaald.
// Factuurnummers lopen automatisch op (per jaar). Bedragen worden ingevoerd
// EXCLUSIEF btw; de btw wordt erbovenop gerekend (zoals de boekhouding wil).
// De PDF volgt de eigen huisstijl: logo, excl/incl-kolommen, vervaldatum,
// garantie-regel, juridische disclaimer en (indien aanwezig) de werkbon-handtekening.
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { db, id, now, save, saveSoon, logActivity } from './db.js';
import { UPLOAD_DIR } from './storage.js';
import { sendMail, smtpConfigured } from './connectors/email-smtp.js';
import { getEmailSignature } from './settings.js';

const LOGO_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'img', 'logo-factuur.png');

// ---------- Instellingen (bedrijfsgegevens op de factuur) ----------
export const DEFAULT_INVOICE_SETTINGS = {
  companyName: 'Key service 24/7',
  address: 'Julianastraat 45, 3911HH Rhenen',
  kvk: '73119695',
  btwNr: 'NL002375027.B41',
  iban: 'NL98 BUNQ 2067 1359 10',
  bic: 'BUNQNL2A',
  email: 'info@keyservice247.nl',
  phone: '+31 (0) 85 060 2359',
  website: 'https://keyservice247.nl',
  paymentDays: 7,
  quoteValidDays: 30,     // geldigheid van offertes
  // Automatische betaalherinnering: X dagen ná de vervaldatum, herhaald met een
  // tussenpoos, met een maximum — standaard UIT (eerst checken of alle betaalde
  // facturen ook echt op 'betaald' staan, anders krijgt een klant onterecht een
  // herinnering). Aanzetten kan in Instellingen → Facturen.
  autoRemind: false,
  remindAfterDays: 3,
  remindRepeatDays: 7,
  remindMax: 2,
  // Offerte goedgekeurd -> automatisch een factuur-CONCEPT klaarzetten (niet
  // versturen). Scheelt de assistente een handeling en voorkomt vergeten factureren.
  autoInvoiceOnAccept: true,
  // Automatische offerte-opvolging: verzonden offerte die na X dagen nog niet is
  // goedgekeurd/afgekeurd krijgt een vriendelijke opvolgmail (met de offerte-PDF),
  // herhaald met tussenpoos en een maximum. Standaard UIT.
  autoQuoteFollowup: false,
  quoteFollowupAfterDays: 3,
  quoteFollowupRepeatDays: 5,
  quoteFollowupMax: 2,
  btwPct: 21,             // standaardtarief; per factuur aan te passen
  warranty: '3 jaar garantie op onze producten, 1 jaar garantie op arbeid.',
  legal: 'Bij reparatie- en montagewerkzaamheden aan bestaande kozijnen, deuren, ramen en beglazing kan ondanks zorgvuldig werken lichte, redelijkerwijs onvermijdbare gebruiksschade ontstaan (zoals kleine krasjes, haarscheurtjes of loslatende verf/kit op verouderde delen). Dergelijke geringe schade valt binnen het acceptabele werkrisico en geeft geen recht op schadevergoeding of verrekening. Reclamaties binnen 48 uur na uitvoering melden.',
  footer: 'Bedankt voor uw vertrouwen in Key Service 24/7 — Service is key.',
};
export function getInvoiceSettings() {
  const s = db().settings.invoiceSettings || {};
  return { ...DEFAULT_INVOICE_SETTINGS, ...s };
}

// ---------- Nummering: factuur 2026-0001…, offerte OFF-2026-0001… (teller per jaar) ----------
function nextInvoiceNumber(type = 'factuur') {
  const year = new Date().getFullYear();
  const st = db().settings;
  const key = type === 'offerte' ? '_quoteCounter' : '_invoiceCounter';
  if (!st[key] || st[key].year !== year) st[key] = { year, n: 0 };
  st[key].n += 1;
  save();
  const nr = `${year}-${String(st[key].n).padStart(4, '0')}`;
  return type === 'offerte' ? `OFF-${nr}` : nr;
}

// ---------- Rekenen (bedragen EXCL btw ingevoerd; btw erbovenop) ----------
const r2 = (x) => Math.round(x * 100) / 100;
export function lineExcl(l, btwPct) {
  // Backward-compat: oude regels hadden priceIncl — reken die eenmalig terug.
  if (l.priceExcl !== undefined) return Number(l.priceExcl) || 0;
  if (l.priceIncl !== undefined) return r2((Number(l.priceIncl) || 0) / (1 + (Number(btwPct) || 0) / 100));
  return 0;
}
// Korting: één korting per factuur/offerte — een percentage óf een vast bedrag
// (EXCL. btw). De korting gaat van het subtotaal EXCL btw af; de btw wordt daarna
// over het verlaagde bedrag gerekend (fiscaal juist).
// AFRONDEN GEBEURT IN ÉÉN KETEN: elk bedrag wordt op 2 decimalen gezet en het
// volgende bedrag rekent verder met dát afgeronde getal. Eerder werd er op het
// eind pas afgerond en werd totalIncl apart uit de ONafgeronde bedragen berekend;
// bij sommige combinaties van korting en btw stond er dan een cent verschil op de
// factuur (getoond excl + getoonde btw ≠ getoond totaal). Nu klopt de optelling
// die de klant ziet altijd: subtotaal - korting = totaal excl, en totaal excl +
// btw = totaal incl.
export function computeTotals(lines, btwPct, discount) {
  const pct = Number(btwPct) || 0;
  const subtotalExcl = r2((lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * lineExcl(l, pct), 0));
  let discountExcl = 0;
  if (discount && Number(discount.value) > 0) {
    discountExcl = discount.type === 'pct'
      ? r2(subtotalExcl * (Math.min(100, Number(discount.value)) / 100))
      : Math.min(r2(Number(discount.value)), subtotalExcl);
  }
  const totalExcl = r2(subtotalExcl - discountExcl);
  const btw = r2(totalExcl * (pct / 100));
  const totalIncl = r2(totalExcl + btw); // nooit apart uitrekenen: excl + btw is de waarheid
  return { subtotalExcl, discountExcl, totalExcl, btw, totalIncl };
}

function sanitizeLines(lines, btwPct) {
  return (Array.isArray(lines) ? lines : [])
    .map((l) => ({
      description: String(l.description || '').slice(0, 300),
      qty: (() => { const q = Number(l.qty); return Math.max(0, Math.min(9999, Number.isFinite(q) ? q : 1)); })(),
      priceExcl: Math.max(0, Math.min(999999, l.priceExcl !== undefined ? (Number(l.priceExcl) || 0) : lineExcl(l, btwPct))),
    }))
    .filter((l) => l.description || l.priceExcl > 0)
    .slice(0, 40);
}

// ---------- Aanmaken / bijwerken (concept) ----------
// Gedeeld: regels/btw/notitie op een bestaand record zetten (met vergrendel-check).
export function saveInvoiceFields(inv, body) {
  if (inv.status === 'betaald') return { error: 'Deze factuur is al betaald en kan niet meer worden gewijzigd.' };
  if (inv.status === 'goedgekeurd') return { error: 'Deze offerte is al goedgekeurd. Kopieer of zet om naar factuur.' };
  const btwPct = Math.max(0, Math.min(21, Number(body.btwPct ?? inv.btwPct ?? getInvoiceSettings().btwPct)));
  inv.lines = sanitizeLines(body.lines, btwPct);
  inv.btwPct = btwPct;
  inv.note = String(body.note || '').slice(0, 500);
  // Handtekening rechtstreeks op de factuur/offerte (data-URL PNG), los van een werkbon.
  // Zo kan er ook op een LOSSE factuur (zonder kaart/werkbon) getekend worden.
  if ('signature' in body) {
    const sig = body.signature;
    if (typeof sig === 'string' && sig.length <= 500000 && sig.startsWith('data:image/png') && signatureBuffer(sig)) {
      inv.signature = sig; // alleen een écht decodeerbare PNG (binnen de limiet) bewaren
    } else {
      inv.signature = ''; // leeg/ongeldig = wissen (nooit een kapotte handtekening opslaan)
    }
  }
  // Korting instellen/weghalen (percentage of vast bedrag, EXCL btw).
  if ('discount' in body) {
    const d = body.discount || {};
    const raw = Number(d.value);
    const val = Math.max(0, Math.min(999999, Number.isFinite(raw) ? raw : 0));
    if (val > 0) inv.discount = { type: d.type === 'pct' ? 'pct' : 'bedrag', value: d.type === 'pct' ? Math.min(100, val) : val };
    else delete inv.discount;
  }
  // Een al VERZONDEN document inhoudelijk wijzigen mag (ná de expliciete
  // waarschuwing in het scherm), maar wordt zichtbaar vastgelegd — de klant heeft
  // immers al een andere versie ontvangen.
  if (inv.status === 'verzonden') inv.editedAfterSendAt = now();
  Object.assign(inv, computeTotals(inv.lines, btwPct, inv.discount));
  inv.updatedAt = now();
  saveSoon();
  return { invoice: inv };
}

// Eén definitie van "ziet eruit als een e-mailadres": de KEUZE van de ontvanger en de
// CONTROLE erop mogen nooit uit elkaar lopen, anders kiezen we een adres dat er daarna
// alsnog uitvliegt. eersteGeldigeMail pakt het eerste adres uit de rij dat de toets
// doorstaat — staat er in het klantrecord onzin ("n.v.t.", een halve typefout), dan is
// het laatst gebruikte adres nog altijd beter dan helemaal niets versturen.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const eersteGeldigeMail = (...kandidaten) => kandidaten.map((x) => String(x || '').trim()).find((x) => EMAIL_RE.test(x)) || '';

// Betaalherinnering — gedeeld door de handmatige knop én de automatische ronde:
// zelfde nette mail met de PDF opnieuw als bijlage; teller en tijdstip worden
// bijgehouden zodat er nooit te vaak herinnerd wordt.
export async function sendInvoiceReminder(inv, { to: toOverride = '', by = 'systeem' } = {}) {
  if (inv.type === 'offerte') return { error: 'Herinnering is voor facturen. Verstuur de offerte desnoods opnieuw.' };
  if (inv.status !== 'verzonden') return { error: 'Alleen voor verzonden (nog niet betaalde) facturen.' };
  const customer = db().customers.find((c) => c.id === inv.customerId) || {};
  // Ontvanger: het HUIDIGE klantadres is leidend. inv.sentTo is slechts het LAATST
  // gebruikte adres — is de factuur ooit als kopie naar bv. de boekhouder gemaild,
  // dan gingen alle herinneringen daarheen en hoorde de klant niets. Alleen als de
  // klant zelf geen e-mailadres (meer) heeft, vallen we terug op dat laatste adres.
  // Een handmatig opgegeven adres blijft leidend zoals het is ingetypt (typefout →
  // nette foutmelding, nooit stilletjes naar een ander adres).
  const to = String(toOverride || '').trim() || eersteGeldigeMail(customer.email, inv.sentTo);
  if (!EMAIL_RE.test(to)) return { error: 'Geen geldig e-mailadres bekend.' };
  if (!smtpConfigured()) return { error: 'E-mail versturen (SMTP) is niet ingesteld.' };
  const cfg = getInvoiceSettings();
  const order = inv.orderId ? (db().orders.find((o) => o.id === inv.orderId) || {}) : {};
  const pdf = await buildInvoicePdf(inv, order, customer);
  const sig = getEmailSignature();
  const body = `Beste ${customer.name || 'klant'},\n\nVolgens onze administratie staat factuur ${inv.number} (€ ${inv.totalIncl.toFixed(2).replace('.', ',')}) nog open. Mogelijk is het aan uw aandacht ontsnapt — dat kan gebeuren.\n\nWilt u het bedrag overmaken${cfg.iban ? ` op ${cfg.iban}` : ''} o.v.v. het factuurnummer? De factuur zit nogmaals in de bijlage.\n\nHeeft u al betaald of heeft u een vraag? Reageer gerust op deze e-mail.`;
  await sendMail({
    to, subject: `Betaalherinnering: factuur ${inv.number} — ${cfg.companyName}`,
    text: sig ? `${body}\n\n${sig}` : body,
    attachments: [{ filename: `factuur-${inv.number}.pdf`, content: pdf }],
  });
  inv.remindedAt = now();
  inv.remindCount = (inv.remindCount || 0) + 1;
  saveSoon();
  logActivity(by, 'betaalherinnering verstuurd', `${inv.number} → ${to}`);
  return { ok: true, to };
}

// Offerte goedgekeurd -> automatisch een factuur-concept aanmaken (kopie van de
// offerte, nieuw factuurnummer, status concept — NIET verzonden). Idempotent: doet
// niets als er al een factuur uit deze offerte is gemaakt. Koppelt de kaart aan de
// nieuwe factuur zodat de "Factuur"-knop meteen de juiste opent.
export function autoConvertQuoteToInvoice(inv, actorName = 'systeem') {
  if (!inv || inv.type !== 'offerte') return null;
  if (inv.convertedInvoiceId && (db().invoices || []).some((i) => i.id === inv.convertedInvoiceId)) return null;
  const factuur = copyInvoice(inv, { actorName, copyType: 'factuur' });
  inv.convertedInvoiceId = factuur.id;
  const order = inv.orderId ? db().orders.find((o) => o.id === inv.orderId) : null;
  if (order && (!order.invoiceId || order.invoiceId === inv.id)) order.invoiceId = factuur.id;
  saveSoon();
  logActivity(actorName, 'offerte goedgekeurd → factuur-concept', `${inv.number} → ${factuur.number}`);
  return factuur;
}

// Vriendelijke opvolging van een VERZONDEN offerte die nog niet is beantwoord.
// Gedeeld door de knop en de automatische ronde. Kanaal-keuze: éérst e-mail (met de
// offerte-PDF opnieuw als bijlage); heeft de klant geen (geldig) e-mailadres maar
// wél een 06, dan gaat de herinnering als WhatsApp-appje via de bridge (tekst —
// een PDF kan daar niet mee). Teller voorkomt te vaak opvolgen.
export async function sendQuoteFollowup(inv, { by = 'systeem' } = {}) {
  if (inv.type !== 'offerte') return { error: 'Alleen voor offertes.' };
  if (inv.status !== 'verzonden') return { error: 'Alleen voor verzonden (nog niet beantwoorde) offertes.' };
  const customer = db().customers.find((c) => c.id === inv.customerId) || {};
  const cfg = getInvoiceSettings();
  const order = inv.orderId ? (db().orders.find((o) => o.id === inv.orderId) || null) : null;
  const bedrag = `€ ${Number(inv.totalIncl || 0).toFixed(2).replace('.', ',')}`;
  const markFollowedUp = () => {
    inv.quoteFollowupAt = now();
    inv.quoteFollowupCount = (inv.quoteFollowupCount || 0) + 1;
  };

  // 1) E-mail (voorkeur: nette mail mét de offerte-PDF opnieuw).
  // Zelfde volgorde als bij de betaalherinnering: het huidige klantadres wint van
  // inv.sentTo (dat is alleen het laatst gebruikte adres, bv. een kopie naar de
  // boekhouder). inv.sentTo blijft de vangnet-optie als de klant geen adres heeft.
  const to = eersteGeldigeMail(customer.email, inv.sentTo);
  if (EMAIL_RE.test(to) && smtpConfigured()) {
    const pdf = await buildInvoicePdf(inv, order || {}, customer);
    const sig = getEmailSignature();
    const body = `Beste ${customer.name || 'klant'},\n\nEen tijdje geleden stuurden wij u onze offerte ${inv.number} (${bedrag} incl. btw). We horen graag of u nog vragen heeft of dat u verder wilt — dan plannen we de werkzaamheden graag voor u in.\n\nDe offerte zit voor het gemak nogmaals in de bijlage. Laat gerust weten hoe u erover denkt!`;
    await sendMail({
      to, subject: `Nog vragen over offerte ${inv.number}? — ${cfg.companyName}`,
      text: sig ? `${body}\n\n${sig}` : body,
      attachments: [{ filename: `offerte-${inv.number}.pdf`, content: pdf }],
    });
    markFollowedUp();
    saveSoon();
    logActivity(by, 'offerte-opvolging verstuurd (e-mail)', `${inv.number} → ${to}`);
    return { ok: true, to, via: 'e-mail' };
  }

  // 2) WhatsApp-pad: klant heeft alleen een telefoonnummer (of e-mail/SMTP werkt niet).
  const phone = String(customer.phone || (order && order.intake && order.intake.phone) || '').trim();
  if (phone.replace(/\D/g, '').length >= 10) {
    const text = `Beste ${customer.name || 'klant'}, een tijdje geleden stuurden wij u offerte ${inv.number} (${bedrag} incl. btw). Heeft u nog vragen, of wilt u dat we de werkzaamheden inplannen? Reageer gerust op dit bericht — we helpen u graag verder. — ${cfg.companyName}`;
    db().outbox.unshift({
      id: id('out'), kind: 'whatsapp_customer', phone, group: '__klant_dm__', text,
      orderId: inv.orderId || undefined, status: 'queued', createdAt: now(), by: 'offerte-opvolging',
    });
    if (order) {
      order.thread = order.thread || [];
      order.thread.push({ id: id('thr'), channel: 'whatsapp', outgoing: true, sender: 'Keyservice (offerte-opvolging)', body: text, at: now() });
      order.updatedAt = now();
    }
    markFollowedUp();
    saveSoon();
    logActivity(by, 'offerte-opvolging via WhatsApp in wachtrij', `${inv.number} → ${phone}`);
    return { ok: true, to: phone, via: 'whatsapp' };
  }

  return { error: 'Geen geldig e-mailadres én geen telefoonnummer bekend bij deze klant.' };
}

export function upsertInvoice(order, body, actorName) {
  db().invoices = db().invoices || [];
  let inv = db().invoices.find((i) => i.id === order.invoiceId);
  if (!inv) {
    const type = body.type === 'offerte' ? 'offerte' : 'factuur';
    inv = {
      id: id('inv'), number: nextInvoiceNumber(type), type, orderId: order.id, customerId: order.customerId,
      status: 'concept', createdAt: now(), createdBy: actorName || '',
    };
    db().invoices.unshift(inv);
    order.invoiceId = inv.id;
  }
  return saveInvoiceFields(inv, body);
}

// Losse factuur of offerte, direct aan een klant gekoppeld (niet via een kaart).
export function createStandaloneInvoice({ customerId, type = 'factuur', actorName = '', createdById = '' }) {
  db().invoices = db().invoices || [];
  const t = type === 'offerte' ? 'offerte' : 'factuur';
  const inv = {
    id: id('inv'), number: nextInvoiceNumber(t), type: t, orderId: null, customerId,
    status: 'concept', lines: [], btwPct: getInvoiceSettings().btwPct,
    ...computeTotals([], getInvoiceSettings().btwPct),
    createdAt: now(), createdBy: actorName, createdById,
  };
  db().invoices.unshift(inv);
  saveSoon();
  return inv;
}

// Kopie (nieuw nummer, concept). copyType kan afwijken (offerte -> factuur = omzetten).
export function copyInvoice(src, { actorName = '', createdById = '', copyType } = {}) {
  const t = copyType === 'offerte' ? 'offerte' : copyType === 'factuur' ? 'factuur' : (src.type || 'factuur');
  const inv = {
    id: id('inv'), number: nextInvoiceNumber(t), type: t, orderId: src.orderId || null, customerId: src.customerId,
    status: 'concept', lines: (src.lines || []).map((l) => ({ ...l })), btwPct: src.btwPct,
    discount: src.discount ? { ...src.discount } : undefined,
    note: src.note || '', ...computeTotals(src.lines || [], src.btwPct, src.discount),
    createdAt: now(), createdBy: actorName, createdById, copiedFrom: src.number,
  };
  db().invoices.unshift(inv);
  saveSoon();
  return inv;
}

const eur = (n) => '€ ' + Number(n || 0).toFixed(2).replace('.', ',');
const nlDate = (d) => new Date(d).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Controleer of een PNG-buffer écht te decoderen is. pdfkit (via png-js) decodeert
// de IDAT-stroom ASYNCHROON; bij een kapotte PNG gooit zlib dan een niet-vangbare
// fout die het hele proces zou laten hangen/crashen. Daarom valideren we hier eerst
// synchroon: PNG-signatuur checken en de IDAT-chunks synchroon inflaten. Faalt dat,
// dan slaan we de handtekening gewoon over (nooit een hangende PDF-endpoint).
export function pngDecodable(buf) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 8) return false;
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return false;
    const idat = [];
    let off = 8;
    while (off + 8 <= buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.toString('ascii', off + 4, off + 8);
      const dataStart = off + 8;
      const dataEnd = dataStart + len;
      if (dataEnd + 4 > buf.length) return false; // afgekapt bestand
      if (type === 'IDAT') idat.push(buf.subarray(dataStart, dataEnd));
      if (type === 'IEND') break;
      off = dataEnd + 4; // + CRC
    }
    if (!idat.length) return false;
    zlib.inflateSync(Buffer.concat(idat)); // gooit bij kapotte stroom -> gevangen
    return true;
  } catch { return false; }
}

// Data-URL PNG -> geldige buffer, of null als het niet (veilig) te gebruiken is.
export function signatureBuffer(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png')) return null;
  const b64 = dataUrl.split(',')[1] || '';
  if (!b64) return null;
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch { return null; }
  return pngDecodable(buf) ? buf : null;
}

// ---------- PDF (huisstijl: zie voorbeeldfactuur van het oude pakket) ----------
export function buildInvoicePdf(inv, order, customer) {
  const cfg = getInvoiceSettings();
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const blue = '#2b4b9b'; const ink = '#1b2430'; const muted = '#6b7280';
    const FOOTER_TOP = 760; // vaste y van de voetregel; content moet daarboven blijven
    const invDate = inv.sentAt || inv.updatedAt || inv.createdAt || new Date();
    const dueDate = new Date(new Date(invDate).getTime() + (cfg.paymentDays || 7) * 86400000);

    // Kop: logo links, bedrijfsgegevens rechts.
    try { if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, 50, 42, { fit: [200, 92] }); } catch { /* logo optioneel */ }
    doc.fontSize(10).font('Helvetica-Bold').fillColor(ink).text(cfg.companyName, 320, 46, { width: 225, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(muted);
    const kop = [cfg.address,
      cfg.phone ? `Tel.: ${cfg.phone}` : '', cfg.email ? `E-mail: ${cfg.email}` : '', cfg.website ? `Website: ${cfg.website}` : '',
      cfg.iban ? `IBAN: ${cfg.iban}` : '', cfg.bic ? `BIC: ${cfg.bic}` : ''].filter(Boolean);
    doc.text(kop.join('\n'), 320, 62, { width: 225, align: 'right', lineGap: 1.5 });

    // Klantblok links.
    let y = 165;
    doc.fontSize(11).fillColor(ink).font('Helvetica-Bold').text(customer.name || 'Klant', 50, y);
    doc.font('Helvetica').fontSize(10);
    const custLines = [customer.address, customer.phone, customer.email].filter(Boolean);
    if (custLines.length) doc.text(custLines.join('\n'), 50, y + 15, { lineGap: 1.5 });

    // Nummer + data (factuur of offerte).
    const isQuote = inv.type === 'offerte';
    const validUntil = new Date(new Date(invDate).getTime() + (cfg.quoteValidDays || 30) * 86400000);
    y = 238;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(ink).text(`${isQuote ? 'Offerte' : 'Factuur'}: ${inv.number}`, 50, y);
    doc.font('Helvetica').fontSize(10).fillColor(muted)
      .text(`${isQuote ? 'Offertedatum' : 'Factuurdatum'}: ${nlDate(invDate)}`, 330, y - 12, { width: 215, align: 'right' })
      .text(`Vervaldatum: ${nlDate(isQuote ? validUntil : dueDate)}`, 330, y + 2, { width: 215, align: 'right' });

    // Reparatielocatie + betreft.
    y += 26;
    doc.fillColor(ink).fontSize(10);
    if (customer.address) { doc.text(`Reparatielocatie: ${customer.address}`, 50, y); y += 14; }
    if (order?.title) { doc.fillColor(muted).text(`Betreft: ${order.title}`, 50, y); y += 14; }

    // Tabel: Aantal | Beschrijving | excl | incl (per regel klein het btw-tarief).
    y += 8;
    const pct = Number(inv.btwPct) || 0;
    doc.rect(50, y, 495, 22).fill('#eef2fb');
    doc.fillColor(blue).fontSize(8.5).font('Helvetica-Bold')
      .text('AANTAL', 56, y + 7, { width: 40 })
      .text('BESCHRIJVING', 102, y + 7)
      .text('BEDRAG EXCL. BTW', 350, y + 7, { width: 90, align: 'right' })
      .text('BEDRAG INCL. BTW', 448, y + 7, { width: 90, align: 'right' });
    y += 28;
    doc.font('Helvetica').fillColor(ink).fontSize(10);
    for (const l of inv.lines || []) {
      const unit = lineExcl(l, pct);
      const qty = Number(l.qty) || 0;
      const ex = unit * qty;
      const inc = ex * (1 + pct / 100);
      const h = Math.max(13, doc.heightOfString(l.description, { width: 235 }));
      doc.fillColor(ink)
        .text(String(l.qty), 56, y, { width: 40 })
        .text(l.description, 102, y, { width: 235 })
        .text(eur(ex), 350, y, { width: 90, align: 'right' })
        .text(eur(inc), 448, y, { width: 90, align: 'right' });
      // Bij meer dan 1 stuk: stuksprijs eronder (zoals het oude pakket).
      let extraH = 0;
      if (qty > 1) { doc.fillColor(muted).fontSize(7.5).text(`Stuksprijs: ${eur(unit)}`, 102, y + h + 1, { width: 235 }); extraH = 9; }
      doc.fillColor(muted).fontSize(7.5).text(`${pct}% btw`, 448, y + h + 1, { width: 90, align: 'right' });
      doc.fontSize(10);
      y += h + 14 + extraH;
      doc.moveTo(50, y - 4).lineTo(545, y - 4).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
      if (y > 640) { doc.addPage(); y = 60; }
    }

    // Totalen (met aparte subtotaal- en kortingsregel wanneer er korting is gegeven).
    y += 6;
    if (Number(inv.discountExcl) > 0) {
      doc.fontSize(10).fillColor(muted)
        .text('Subtotaal excl. btw', 330, y, { width: 140, align: 'right' })
        .fillColor(ink).text(eur(inv.subtotalExcl ?? (inv.totalExcl + inv.discountExcl)), 478, y, { width: 60, align: 'right' });
      y += 16;
      const kortLabel = inv.discount && inv.discount.type === 'pct' ? `Korting (${inv.discount.value}%)` : 'Korting';
      doc.fillColor(muted).text(kortLabel, 330, y, { width: 140, align: 'right' })
        .fillColor(ink).text(`- ${eur(inv.discountExcl)}`, 470, y, { width: 68, align: 'right' });
      y += 16;
    }
    doc.fontSize(10).fillColor(muted)
      .text('Totaalbedrag excl. btw', 330, y, { width: 140, align: 'right' }).fillColor(ink).text(eur(inv.totalExcl), 478, y, { width: 60, align: 'right' });
    y += 16;
    doc.fillColor(muted).text(`Btw ${pct === 21 ? 'hoog' : pct === 9 ? 'laag' : ''} (${pct}%)`.replace('  ', ' '), 330, y, { width: 140, align: 'right' }).fillColor(ink).text(eur(inv.btw), 478, y, { width: 60, align: 'right' });
    y += 20;
    doc.rect(320, y - 4, 225, 24).fill('#eef2fb');
    doc.fillColor(blue).font('Helvetica-Bold').fontSize(12)
      .text('Totaalbedrag incl. btw', 328, y + 2, { width: 138 }).text(eur(inv.totalIncl), 470, y + 2, { width: 68, align: 'right' });

    // Betaalinstructie (factuur) of geldigheid + akkoord-blok (offerte).
    y += 40;
    doc.font('Helvetica').fontSize(10).fillColor(ink);
    if (isQuote) {
      doc.text(`Deze offerte is geldig tot ${nlDate(validUntil)}. Gaat u akkoord? Reageer op de e-mail, bel ons, of stuur deze pagina getekend terug — dan plannen we de werkzaamheden direct in.`, 50, y, { width: 495 });
      y += doc.heightOfString('x', { width: 495 }) + 28;
    } else {
      doc.text(`Gelieve dit bedrag van ${eur(inv.totalIncl)} over te maken vóór ${nlDate(dueDate)} op rekeningnummer: ${cfg.iban} o.v.v. "Factuur ${inv.number}".`, 50, y, { width: 495 });
      y += doc.heightOfString(`x`, { width: 495 }) + 20;
    }
    if (cfg.warranty) { doc.font('Helvetica-Bold').fillColor(ink).text(cfg.warranty, 50, y, { width: 495 }); y += doc.heightOfString(cfg.warranty, { width: 495 }) + 10; }
    if (inv.note) { doc.font('Helvetica').fillColor(ink).text(inv.note, 50, y, { width: 495 }); y += doc.heightOfString(inv.note, { width: 495 }) + 10; }
    if (cfg.legal) {
      // De voetregel staat VAST onderaan de pagina (y = 760/774). Bij een wat langere
      // factuur (meer regels, korting, notitie) kwam de juridische tekst daar dwars
      // overheen. Daarom eerst meten hoe hoog de tekst wordt en pas plaatsen als het
      // écht past; anders een nieuwe pagina beginnen. Opmaak blijft verder identiek.
      doc.font('Helvetica').fontSize(7.5).fillColor(muted);
      const legalH = doc.heightOfString(cfg.legal, { width: 495, lineGap: 1 });
      if (y + legalH > FOOTER_TOP - 10) {
        doc.addPage(); y = 60;
        // pdfkit schrijft de tekstkleur PER PAGINA weg: na een eigen addPage staat de
        // kleur weer op zwart. Zonder deze regel werd de juridische tekst op de nieuwe
        // pagina ineens zwart in plaats van grijs.
        doc.fillColor(muted);
      }
      doc.text(cfg.legal, 50, y, { width: 495, lineGap: 1 });
      // Doorschuiven met dezelfde maat als vóór deze wijziging (dus zonder lineGap):
      // het "Voor akkoord"-blok en de handtekening hangen aan vaste y-drempels, en die
      // 3 punt verschil zette een korte offerte anders zonder reden op een 2e pagina.
      y += doc.heightOfString(cfg.legal, { width: 495 }) + 12;
      doc.fontSize(10);
    }

    // Offerte: "Voor akkoord"-blok (naam/datum/plaats/handtekening) zoals het oude pakket.
    if (isQuote) {
      if (y > 600) { doc.addPage(); y = 60; }
      y += 8;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(ink).text('Voor akkoord:', 320, y);
      doc.font('Helvetica').fontSize(10).fillColor(ink);
      for (const lbl of ['Naam:', 'Datum:', 'Plaats:', 'Handtekening:']) {
        y += 22;
        doc.text(lbl, 320, y);
        doc.moveTo(400, y + 11).lineTo(545, y + 11).strokeColor('#9aa3b2').lineWidth(0.7).stroke();
      }
      y += 30;
    }

    // Handtekening: bewijs van akkoord door de klant. Eerst de werkbon-handtekening
    // (indien gezet); anders een handtekening die direct op de factuur/offerte is
    // gezet (inv.signature — data-URL, werkt ook op LOSSE facturen zonder werkbon).
    try {
      const sigId = order?.werkbon?.signatureAttachmentId;
      const att = sigId ? (order.attachments || []).find((a) => a.id === sigId) : null;
      const sigPath = att ? path.join(UPLOAD_DIR, att.file) : null;
      let sigImage = null; let sigLabel = null;
      if (sigPath && fs.existsSync(sigPath)) {
        sigImage = sigPath;
        sigLabel = `Voor akkoord getekend door klant (werkbon${order.werkbon.at ? ' d.d. ' + nlDate(order.werkbon.at) : ''}):`;
      } else if (inv.signature) {
        const sigBuf = signatureBuffer(inv.signature);
        if (sigBuf) { sigImage = sigBuf; sigLabel = 'Voor akkoord getekend door klant:'; }
      }
      if (sigImage) {
        if (y > 640) { doc.addPage(); y = 60; }
        doc.fontSize(9).fillColor(muted).text(sigLabel, 50, y);
        doc.image(sigImage, 50, y + 14, { fit: [180, 60] });
        doc.rect(50, y + 14, 190, 64).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
        y += 88;
      }
    } catch { /* handtekening optioneel */ }

    // Voetregel: btw/kvk + slogan.
    doc.fontSize(8.5).fillColor(muted)
      .text(`Btw-nummer: ${cfg.btwNr}   ·   KVK-nummer: ${cfg.kvk}`, 50, FOOTER_TOP, { width: 495, align: 'center' });
    if (cfg.footer) doc.text(cfg.footer, 50, FOOTER_TOP + 14, { width: 495, align: 'center' });

    doc.end();
  });
}

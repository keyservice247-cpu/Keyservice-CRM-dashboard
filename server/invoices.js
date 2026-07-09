// Facturen + werkbon: monteur of kantoor maakt vanuit een opdracht een factuur,
// verstuurt die als nette PDF per e-mail naar de klant, en markeert 'm betaald.
// Factuurnummers lopen automatisch op (per jaar). Bedragen worden ingevoerd
// EXCLUSIEF btw; de btw wordt erbovenop gerekend (zoals de boekhouding wil).
// De PDF volgt de eigen huisstijl: logo, excl/incl-kolommen, vervaldatum,
// garantie-regel, juridische disclaimer en (indien aanwezig) de werkbon-handtekening.
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, id, now, save, saveSoon } from './db.js';
import { UPLOAD_DIR } from './storage.js';

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
export function computeTotals(lines, btwPct) {
  const pct = Number(btwPct) || 0;
  const totalExcl = (lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * lineExcl(l, pct), 0);
  const btw = totalExcl * (pct / 100);
  return { totalExcl: r2(totalExcl), btw: r2(btw), totalIncl: r2(totalExcl + btw) };
}

function sanitizeLines(lines, btwPct) {
  return (Array.isArray(lines) ? lines : [])
    .map((l) => ({
      description: String(l.description || '').slice(0, 300),
      qty: Math.max(0, Math.min(9999, Number(l.qty) || 1)),
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
  Object.assign(inv, computeTotals(inv.lines, btwPct));
  inv.updatedAt = now();
  saveSoon();
  return { invoice: inv };
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
    note: src.note || '', ...computeTotals(src.lines || [], src.btwPct),
    createdAt: now(), createdBy: actorName, createdById, copiedFrom: src.number,
  };
  db().invoices.unshift(inv);
  saveSoon();
  return inv;
}

const eur = (n) => '€ ' + Number(n || 0).toFixed(2).replace('.', ',');
const nlDate = (d) => new Date(d).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' });

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

    // Totalen.
    y += 6;
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
    if (cfg.legal) { doc.font('Helvetica').fontSize(7.5).fillColor(muted).text(cfg.legal, 50, y, { width: 495, lineGap: 1 }); y += doc.heightOfString(cfg.legal, { width: 495 }) + 12; doc.fontSize(10); }

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

    // Handtekening van de werkbon (indien gezet): bewijs van akkoord door de klant.
    try {
      const sigId = order?.werkbon?.signatureAttachmentId;
      const att = sigId ? (order.attachments || []).find((a) => a.id === sigId) : null;
      const sigPath = att ? path.join(UPLOAD_DIR, att.file) : null;
      if (sigPath && fs.existsSync(sigPath)) {
        if (y > 640) { doc.addPage(); y = 60; }
        doc.fontSize(9).fillColor(muted).text(`Voor akkoord getekend door klant (werkbon${order.werkbon.at ? ' d.d. ' + nlDate(order.werkbon.at) : ''}):`, 50, y);
        doc.image(sigPath, 50, y + 14, { fit: [180, 60] });
        doc.rect(50, y + 14, 190, 64).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
        y += 88;
      }
    } catch { /* handtekening optioneel */ }

    // Voetregel: btw/kvk + slogan.
    doc.fontSize(8.5).fillColor(muted)
      .text(`Btw-nummer: ${cfg.btwNr}   ·   KVK-nummer: ${cfg.kvk}`, 50, 760, { width: 495, align: 'center' });
    if (cfg.footer) doc.text(cfg.footer, 50, 774, { width: 495, align: 'center' });

    doc.end();
  });
}

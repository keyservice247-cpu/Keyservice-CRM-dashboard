// Facturen + werkbon: monteur of kantoor maakt vanuit een opdracht een factuur,
// verstuurt die als nette PDF per e-mail naar de klant, en markeert 'm betaald.
// Factuurnummers lopen automatisch op (per jaar). Bedragen worden ingevoerd
// INCLUSIEF btw (consumentenwerk); de PDF toont de excl/btw-uitsplitsing.
import PDFDocument from 'pdfkit';
import { db, id, now, save, saveSoon } from './db.js';

// ---------- Instellingen (bedrijfsgegevens op de factuur) ----------
export const DEFAULT_INVOICE_SETTINGS = {
  companyName: 'Key Service 24/7',
  address: '',            // straat + postcode + plaats, mag meerregelig
  kvk: '',
  btwNr: '',
  iban: '',
  email: 'info@keyservice247.nl',
  phone: '',
  paymentDays: 14,
  btwPct: 21,             // standaardtarief; per factuur aan te passen
  footer: 'Bedankt voor uw vertrouwen in Key Service 24/7.',
};
export function getInvoiceSettings() {
  const s = db().settings.invoiceSettings || {};
  return { ...DEFAULT_INVOICE_SETTINGS, ...s };
}

// ---------- Nummering: 2026-0001, 2026-0002, ... (teller per jaar) ----------
function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const st = db().settings;
  if (!st._invoiceCounter || st._invoiceCounter.year !== year) st._invoiceCounter = { year, n: 0 };
  st._invoiceCounter.n += 1;
  save();
  return `${year}-${String(st._invoiceCounter.n).padStart(4, '0')}`;
}

// ---------- Rekenen (bedragen incl. btw ingevoerd) ----------
export function computeTotals(lines, btwPct) {
  const totalIncl = (lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.priceIncl) || 0), 0);
  const totalExcl = totalIncl / (1 + (Number(btwPct) || 0) / 100);
  const btw = totalIncl - totalExcl;
  const r = (x) => Math.round(x * 100) / 100;
  return { totalIncl: r(totalIncl), totalExcl: r(totalExcl), btw: r(btw) };
}

function sanitizeLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((l) => ({
      description: String(l.description || '').slice(0, 300),
      qty: Math.max(0, Math.min(9999, Number(l.qty) || 1)),
      priceIncl: Math.max(0, Math.min(999999, Number(l.priceIncl) || 0)),
    }))
    .filter((l) => l.description || l.priceIncl > 0)
    .slice(0, 40);
}

// ---------- Aanmaken / bijwerken (concept) ----------
export function upsertInvoice(order, body, actorName) {
  db().invoices = db().invoices || [];
  let inv = db().invoices.find((i) => i.id === order.invoiceId);
  const lines = sanitizeLines(body.lines);
  const btwPct = Math.max(0, Math.min(21, Number(body.btwPct ?? getInvoiceSettings().btwPct)));
  if (!inv) {
    inv = {
      id: id('inv'), number: nextInvoiceNumber(), orderId: order.id, customerId: order.customerId,
      status: 'concept', createdAt: now(), createdBy: actorName || '',
    };
    db().invoices.unshift(inv);
    order.invoiceId = inv.id;
  }
  if (inv.status === 'betaald') return { error: 'Deze factuur is al betaald en kan niet meer worden gewijzigd.' };
  inv.lines = lines;
  inv.btwPct = btwPct;
  inv.note = String(body.note || '').slice(0, 500);
  Object.assign(inv, computeTotals(lines, btwPct));
  inv.updatedAt = now();
  saveSoon();
  return { invoice: inv };
}

const eur = (n) => '€ ' + Number(n || 0).toFixed(2).replace('.', ',');

// ---------- PDF ----------
export function buildInvoicePdf(inv, order, customer) {
  const cfg = getInvoiceSettings();
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const blue = '#1d4ed8'; const ink = '#111827'; const muted = '#6b7280';

    // Kop
    doc.fontSize(22).fillColor(blue).font('Helvetica-Bold').text(cfg.companyName, 50, 50);
    doc.fontSize(9).fillColor(muted).font('Helvetica');
    const koplines = [cfg.address, [cfg.phone, cfg.email].filter(Boolean).join(' · '),
      [cfg.kvk ? 'KvK ' + cfg.kvk : '', cfg.btwNr ? 'BTW ' + cfg.btwNr : ''].filter(Boolean).join(' · ')].filter(Boolean);
    doc.text(koplines.join('\n'), 50, 78);

    doc.fontSize(26).fillColor(ink).font('Helvetica-Bold').text('FACTUUR', 380, 50, { align: 'right', width: 165 });
    doc.fontSize(10).font('Helvetica').fillColor(muted)
      .text(`Factuurnummer: ${inv.number}`, 330, 84, { align: 'right', width: 215 })
      .text(`Datum: ${new Date(inv.sentAt || inv.updatedAt || inv.createdAt).toLocaleDateString('nl-NL')}`, 330, 98, { align: 'right', width: 215 });

    // Klant
    let y = 140;
    doc.fontSize(9).fillColor(muted).text('FACTUUR AAN', 50, y);
    doc.fontSize(11).fillColor(ink).font('Helvetica-Bold').text(customer.name || 'Klant', 50, y + 14);
    doc.font('Helvetica').fontSize(10).fillColor(ink);
    const custLines = [customer.address, customer.phone, customer.email].filter(Boolean);
    doc.text(custLines.join('\n'), 50, y + 30);
    if (order?.title) doc.fontSize(9).fillColor(muted).text(`Betreft: ${order.title}`, 50, y + 32 + custLines.length * 13);

    // Tabel
    y = 240;
    doc.rect(50, y, 495, 22).fill('#eef2fb');
    doc.fillColor(blue).fontSize(9).font('Helvetica-Bold')
      .text('OMSCHRIJVING', 58, y + 7).text('AANTAL', 350, y + 7, { width: 50, align: 'right' })
      .text('PRIJS', 410, y + 7, { width: 60, align: 'right' }).text('BEDRAG', 478, y + 7, { width: 60, align: 'right' });
    y += 26;
    doc.font('Helvetica').fillColor(ink).fontSize(10);
    for (const l of inv.lines || []) {
      const h = doc.heightOfString(l.description, { width: 285 });
      doc.text(l.description, 58, y, { width: 285 });
      doc.text(String(l.qty), 350, y, { width: 50, align: 'right' });
      doc.text(eur(l.priceIncl), 410, y, { width: 60, align: 'right' });
      doc.text(eur(l.qty * l.priceIncl), 478, y, { width: 60, align: 'right' });
      y += Math.max(16, h + 4);
      doc.moveTo(50, y - 2).lineTo(545, y - 2).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
      if (y > 700) { doc.addPage(); y = 60; }
    }

    // Totalen (bedragen zijn incl. btw ingevoerd)
    y += 8;
    doc.fontSize(10).fillColor(muted)
      .text(`Subtotaal (excl. btw)`, 350, y, { width: 120, align: 'right' }).fillColor(ink).text(eur(inv.totalExcl), 478, y, { width: 60, align: 'right' });
    y += 16;
    doc.fillColor(muted).text(`Btw ${inv.btwPct}%`, 350, y, { width: 120, align: 'right' }).fillColor(ink).text(eur(inv.btw), 478, y, { width: 60, align: 'right' });
    y += 20;
    doc.rect(340, y - 4, 205, 24).fill('#eef2fb');
    doc.fillColor(blue).font('Helvetica-Bold').fontSize(12)
      .text('TOTAAL', 350, y + 2, { width: 120, align: 'right' }).text(eur(inv.totalIncl), 470, y + 2, { width: 68, align: 'right' });

    // Notitie + betaalinfo
    y += 44;
    doc.font('Helvetica').fontSize(10).fillColor(ink);
    if (inv.note) { doc.text(inv.note, 50, y, { width: 495 }); y += doc.heightOfString(inv.note, { width: 495 }) + 12; }
    const betaal = [`Graag betalen binnen ${cfg.paymentDays} dagen${cfg.iban ? ` op ${cfg.iban}` : ''} o.v.v. factuurnummer ${inv.number}.`];
    doc.fillColor(muted).text(betaal.join('\n'), 50, y, { width: 495 });
    if (cfg.footer) doc.fontSize(9).fillColor(muted).text(cfg.footer, 50, 770, { width: 495, align: 'center' });

    doc.end();
  });
}

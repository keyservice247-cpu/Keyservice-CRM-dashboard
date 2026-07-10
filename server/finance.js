// Financieel overzicht (Cijfers). Fase 1: HANDMATIG invoeren van inkomsten en
// uitgaven, met heldere categorieën, koppeling aan monteur/bron, en maand-overzicht
// (omzet / kosten / winst + uitsplitsingen). Later: auto-omzet uit monteursrapporten
// en AI-suggesties. Bewust simpel en stabiel — geen boekhoudpakket, wél clarity.
import { db, id, now, saveSoon } from './db.js';

// Vaste categorieën (het bedrijfsmodel van de eigenaar). Uitbreidbaar via 'Overig'.
export const INCOME_CATEGORIES = ['DRS opdracht', 'Schuifpui reparatie', 'Overig'];
export const EXPENSE_CATEGORIES = [
  'Marketing fee DRS',        // ~€65/week
  'Fee per opdracht',         // €42,50 per afgeronde opdracht
  'Uitbetaling monteur',      // bv. Youssef 50% van zijn omzet
  'Google Ads',
  'Producten / materiaal',
  'Hulpmonteur',
  'Benzine',
  'Overig',
];
// Vaste bedragen die de eigenaar noemde (snelknoppen in de UI).
export const QUICK_EXPENSES = [
  { category: 'Marketing fee DRS', amount: 65, note: 'Wekelijkse marketingfee DRS' },
  { category: 'Fee per opdracht', amount: 42.5, note: 'Fee per afgeronde opdracht' },
];

const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const monthOf = (dateStr) => String(dateStr || '').slice(0, 7); // YYYY-MM

function fin() {
  const d = db();
  if (!d.finance) d.finance = { entries: [] };
  if (!Array.isArray(d.finance.entries)) d.finance.entries = [];
  return d.finance;
}

export function addEntry(b, actorName) {
  const kind = b.kind === 'income' ? 'income' : 'expense';
  const amount = r2(b.amount);
  if (!(amount > 0)) return { error: 'Vul een bedrag groter dan 0 in.' };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : new Date().toISOString().slice(0, 10);
  const cats = kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const entry = {
    id: id('fin'),
    kind,
    date,
    amount,
    category: cats.includes(b.category) ? b.category : (String(b.category || '').slice(0, 60) || 'Overig'),
    monteurId: b.monteurId || null,
    source: kind === 'income' ? (String(b.source || '').slice(0, 40) || null) : null,
    orderId: b.orderId || null,
    note: String(b.note || '').slice(0, 300),
    createdBy: actorName || '',
    createdAt: now(),
  };
  fin().entries.unshift(entry);
  saveSoon();
  return { entry };
}

export function updateEntry(id2, b) {
  const e = fin().entries.find((x) => x.id === id2);
  if (!e) return { error: 'Niet gevonden' };
  if ('amount' in b) { const a = r2(b.amount); if (!(a > 0)) return { error: 'Ongeldig bedrag' }; e.amount = a; }
  if ('date' in b && /^\d{4}-\d{2}-\d{2}$/.test(b.date)) e.date = b.date;
  if ('category' in b) e.category = String(b.category || '').slice(0, 60) || 'Overig';
  if ('monteurId' in b) e.monteurId = b.monteurId || null;
  if ('source' in b) e.source = String(b.source || '').slice(0, 40) || null;
  if ('note' in b) e.note = String(b.note || '').slice(0, 300);
  saveSoon();
  return { entry: e };
}

export function deleteEntry(id2) {
  const before = fin().entries.length;
  fin().entries = fin().entries.filter((x) => x.id !== id2);
  saveSoon();
  return { ok: fin().entries.length < before };
}

// Maandoverzicht: entries + samenvatting (omzet/kosten/winst + uitsplitsingen).
export function monthReport(month, monteurs = []) {
  const m = /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
  const entries = fin().entries.filter((e) => monthOf(e.date) === m)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const nameOf = (mid) => (monteurs.find((x) => x.id === mid) || {}).name || null;

  let income = 0; let expense = 0;
  const incomeByCat = {}; const expenseByCat = {}; const bySource = {};
  const byMonteur = {}; // { name: { income, expense } }
  for (const e of entries) {
    const who = e.monteurId ? (nameOf(e.monteurId) || 'Onbekende monteur') : null;
    if (e.kind === 'income') {
      income += e.amount;
      incomeByCat[e.category] = r2((incomeByCat[e.category] || 0) + e.amount);
      if (e.source) bySource[e.source] = r2((bySource[e.source] || 0) + e.amount);
    } else {
      expense += e.amount;
      expenseByCat[e.category] = r2((expenseByCat[e.category] || 0) + e.amount);
    }
    if (who) {
      const b = byMonteur[who] || { income: 0, expense: 0 };
      b[e.kind] = r2(b[e.kind] + e.amount);
      byMonteur[who] = b;
    }
  }
  // Per monteur ook het netto (omzet - kosten die aan hem hangen).
  const monteurRows = Object.entries(byMonteur).map(([name, v]) => ({
    name, income: v.income, expense: v.expense, net: r2(v.income - v.expense),
  })).sort((a, b) => b.income - a.income);

  return {
    month: m,
    income: r2(income),
    expense: r2(expense),
    profit: r2(income - expense),
    marginPct: income > 0 ? Math.round(((income - expense) / income) * 100) : 0,
    incomeByCat, expenseByCat, bySource,
    monteurRows,
    entries: entries.map((e) => ({ ...e, monteurName: e.monteurId ? nameOf(e.monteurId) : null })),
    count: entries.length,
  };
}

// Trend: laatste N maanden (omzet/kosten/winst per maand) voor grafiek/CEO-rapport.
export function trend(months = 6, endMonth) {
  const end = /^\d{4}-\d{2}$/.test(endMonth) ? endMonth : new Date().toISOString().slice(0, 7);
  const [ey, em] = end.split('-').map(Number);
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    let y = ey; let mo = em - i;
    while (mo <= 0) { mo += 12; y -= 1; }
    const key = `${y}-${String(mo).padStart(2, '0')}`;
    const es = fin().entries.filter((e) => monthOf(e.date) === key);
    let inc = 0; let exp = 0;
    for (const e of es) { if (e.kind === 'income') inc += e.amount; else exp += e.amount; }
    out.push({ month: key, income: r2(inc), expense: r2(exp), profit: r2(inc - exp) });
  }
  return out;
}

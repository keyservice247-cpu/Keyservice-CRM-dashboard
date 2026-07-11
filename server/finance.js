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
const today = () => new Date().toISOString().slice(0, 10);

// ---------- Finance-instellingen (vaste kosten, gemiddelden, CEO-rapport) ----------
export const DEFAULT_FINANCE_SETTINGS = {
  avgJobCost: 300,          // gemiddelde kosten per schuifpui-klus (materiaal/hulp/benzine)
  recurring: [
    { id: 'rec_ads', label: 'Google Ads', amount: 2000, period: 'month', category: 'Google Ads', active: true, lastBooked: '' },
    { id: 'rec_drs', label: 'Marketing fee DRS', amount: 65, period: 'week', category: 'Marketing fee DRS', active: true, lastBooked: '' },
  ],
  weeklyReport: { enabled: false, email: '', hour: 8 }, // elke maandag om {hour}:00
};
export function getFinanceSettings() {
  const s = (db().settings.financeSettings) || {};
  const rec = Array.isArray(s.recurring) ? s.recurring : DEFAULT_FINANCE_SETTINGS.recurring;
  return {
    avgJobCost: Number.isFinite(+s.avgJobCost) ? +s.avgJobCost : DEFAULT_FINANCE_SETTINGS.avgJobCost,
    recurring: rec.map((r) => ({
      id: r.id || id('rec'), label: String(r.label || '').slice(0, 60),
      amount: r2(r.amount), period: r.period === 'week' ? 'week' : 'month',
      category: String(r.category || 'Overig').slice(0, 60), active: r.active !== false, lastBooked: r.lastBooked || '',
    })),
    weeklyReport: {
      enabled: !!(s.weeklyReport && s.weeklyReport.enabled),
      email: String((s.weeklyReport && s.weeklyReport.email) || '').slice(0, 120),
      hour: (() => { const h = Number(s.weeklyReport && s.weeklyReport.hour); return Number.isFinite(h) ? Math.max(0, Math.min(23, h)) : 8; })(),
    },
  };
}
export function saveFinanceSettings(b) {
  const cur = getFinanceSettings();
  const merged = {
    avgJobCost: Number.isFinite(+b.avgJobCost) ? Math.max(0, +b.avgJobCost) : cur.avgJobCost,
    recurring: Array.isArray(b.recurring) ? b.recurring.map((r) => ({
      id: r.id || id('rec'), label: String(r.label || '').slice(0, 60),
      amount: Math.max(0, r2(r.amount)), period: r.period === 'week' ? 'week' : 'month',
      category: String(r.category || 'Overig').slice(0, 60), active: r.active !== false,
      lastBooked: (cur.recurring.find((x) => x.id === r.id) || {}).lastBooked || '',
    })).slice(0, 30) : cur.recurring,
    weeklyReport: {
      enabled: !!(b.weeklyReport && b.weeklyReport.enabled),
      email: String((b.weeklyReport && b.weeklyReport.email) || cur.weeklyReport.email).slice(0, 120),
      hour: (() => { const h = Number(b.weeklyReport && b.weeklyReport.hour); return Number.isFinite(h) ? Math.max(0, Math.min(23, h)) : cur.weeklyReport.hour; })(),
    },
  };
  db().settings.financeSettings = merged;
  saveSoon();
  return merged;
}

// Weeknummer-sleutel (ISO-achtig, jaar+week) voor wekelijkse vaste kosten.
function weekKey(d = new Date()) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const wk = Math.ceil((((dt - yStart) / 86400000) + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

// Boek de terugkerende (vaste) kosten die voor de HUIDIGE periode nog niet geboekt zijn.
// Boekt nooit met terugwerkende kracht: alleen de lopende maand/week. Geeft aantal terug.
export function bookRecurringDue(actorName = 'systeem') {
  const s = getFinanceSettings();
  let booked = 0;
  const nowMonth = new Date().toISOString().slice(0, 7);
  const nowWeek = weekKey();
  const persisted = db().settings.financeSettings || (db().settings.financeSettings = { ...s });
  persisted.recurring = s.recurring.map((r) => {
    if (!r.active || !(r.amount > 0)) return r;
    const periodKey = r.period === 'week' ? nowWeek : nowMonth;
    if (r.lastBooked === periodKey) return r;
    fin().entries.unshift({
      id: id('fin'), kind: 'expense', date: today(), amount: r.amount, category: r.category,
      monteurId: null, source: null, orderId: null,
      note: `${r.label} (vaste ${r.period === 'week' ? 'week' : 'maand'}kosten)`,
      auto: true, createdBy: actorName, createdAt: now(),
    });
    booked++;
    return { ...r, lastBooked: periodKey };
  });
  if (booked) saveSoon();
  return booked;
}

// Zoek €-bedragen in monteursrapporten (monteursgroepen) van een maand -> import-suggesties.
export function suggestIncomeFromReports(month, monteurs = []) {
  const m = /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
  const groupToMonteur = new Map();
  for (const mo of monteurs) if (mo.waGroup) groupToMonteur.set(String(mo.waGroup).toLowerCase().trim(), mo);
  const bookedRefs = new Set((fin().entries || []).map((e) => e.sourceRef).filter(Boolean));
  const out = [];
  const amountRe = /€\s?(\d{1,3}(?:[.\s]?\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?)/g;
  for (const msg of db().messages || []) {
    if (!msg.group || monthOf(msg.receivedAt) !== m) continue;
    const mo = groupToMonteur.get(String(msg.group).toLowerCase().trim());
    if (!mo) continue; // alleen echte monteursgroepen
    const body = String(msg.body || '');
    let mt; let idx = 0;
    while ((mt = amountRe.exec(body))) {
      const raw = mt[1].replace(/[.\s]/g, '').replace(',', '.');
      const amount = r2(parseFloat(raw));
      if (!(amount >= 20)) continue; // ruis (bv. €5) overslaan
      const around = body.slice(Math.max(0, mt.index - 45), mt.index + 40).replace(/\s+/g, ' ').trim();
      const ref = `${msg.externalId || msg.id}:${idx}:${amount}`;
      idx++;
      if (bookedRefs.has(ref)) continue;
      // Slimme gok op basis van het woord DIRECT NÁ het bedrag (sterkste signaal):
      // "€90 lips kosten" -> kost; "€556 pin" -> omzet. Neutraal -> standaard omzet.
      // Alleen tot het volgende bedrag/haakje/regeleinde kijken, zodat "€556 pin" niet de
      // "(€90 lips kosten)" van het buurbedrag meepakt.
      const after = body.slice(amountRe.lastIndex).split(/[€(\n]/)[0].slice(0, 22).toLowerCase();
      const looksCost = /kost|lips|materiaal|inkoop/.test(after);
      const looksIncome = /pin|contant|betaald|cash|getikt|gepind/.test(after);
      out.push({
        ref, amount, date: (msg.receivedAt || '').slice(0, 10) || today(),
        monteurId: mo.id, monteurName: mo.name, context: around,
        guess: looksCost ? 'cost' : 'income',
      });
    }
  }
  out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return out.slice(0, 100);
}

// Boek geselecteerde omzet-suggesties (income) met bron 'monteursrapport'.
export function importIncome(items, actorName = '') {
  let n = 0;
  for (const it of (items || [])) {
    const amount = r2(it.amount);
    if (!(amount > 0)) continue;
    fin().entries.unshift({
      id: id('fin'), kind: 'income', date: /^\d{4}-\d{2}-\d{2}$/.test(it.date) ? it.date : today(),
      amount, category: 'DRS opdracht', source: 'DRS', monteurId: it.monteurId || null, orderId: null,
      note: `Uit monteursrapport${it.context ? ': ' + String(it.context).slice(0, 120) : ''}`,
      sourceRef: it.ref || null, createdBy: actorName, createdAt: now(),
    });
    n++;
  }
  if (n) saveSoon();
  return n;
}

// Data voor het wekelijkse CEO-rapport (deze week + vorige week + openstaand).
export function weeklyReportData(monteurs = []) {
  const now2 = Date.now();
  const startOfWeek = (offset) => { const d = new Date(); const day = (d.getDay() || 7) - 1; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - day + offset * 7); return d.getTime(); };
  const thisStart = startOfWeek(0); const lastStart = startOfWeek(-1);
  const sum = (from, to) => {
    let inc = 0; let exp = 0;
    for (const e of fin().entries) { const t = new Date(e.date).getTime(); if (isNaN(t) || t < from || t >= to) continue; if (e.kind === 'income') inc += e.amount; else exp += e.amount; }
    return { income: r2(inc), expense: r2(exp), profit: r2(inc - exp) };
  };
  const thisWeek = sum(thisStart, now2 + 86400000);
  const lastWeek = sum(lastStart, thisStart);
  const weekAgo = now2 - 7 * 86400000;
  const newLeads = (db().reviews || []).filter((r) => r.createdAt && new Date(r.createdAt).getTime() >= weekAgo).length;
  const invoices = db().invoices || [];
  const unpaid = invoices.filter((i) => i.type !== 'offerte' && i.status === 'verzonden');
  const unpaidTotal = r2(unpaid.reduce((s, i) => s + (i.totalIncl || 0), 0));
  const overdue = unpaid.filter((i) => i.sentAt && (now2 - new Date(i.sentAt).getTime()) > 7 * 86400000);
  const staleOrders = (db().orders || []).filter((o) => !o.archivedWeek && !['afgerond', 'geannuleerd'].includes(o.status) && new Date(o.updatedAt).getTime() < now2 - 5 * 86400000).length;
  const monthNow = monthReport(new Date().toISOString().slice(0, 7), monteurs);
  return { thisWeek, lastWeek, newLeads, unpaidCount: unpaid.length, unpaidTotal, overdueCount: overdue.length, staleOrders, monthProfit: monthNow.profit, monthIncome: monthNow.income };
}

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

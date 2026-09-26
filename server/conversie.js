// CONVERSIE (20 sep 2026, wens eigenaar): hoeveel van de binnengekomen aanvragen
// (opdrachten die als "nieuw" binnenkomen) worden uiteindelijk écht uitgevoerd?
//
// Definities (bewust simpel en eerlijk):
//   binnengekomen = elke opdracht die in de periode is AANGEMAAKT (createdAt),
//                   prullenbak niet meegeteld, ingeklapte weken wél.
//   gewonnen      = status 'afgerond' ÓF 'afspraak_ingepland' (een ingeplande afspraak
//                   is een "ja" van de klant — akkoord eigenaar 20 sep 2026)
//   verloren      = status 'geannuleerd'
//   open          = de rest (nieuw / in behandeling / offerte verzonden): nog niet beslist
//   conversie beslist = gewonnen / (gewonnen + verloren)  → "van wat al is beslist"
//   conversie totaal  = gewonnen / binnengekomen           → "van alles wat binnenkwam"
// Beide worden getoond; "beslist" is het eerlijkste getal voor een korte periode
// (de open opdrachten drukken "totaal" anders omlaag). Omzet en doorlooptijd tellen
// alleen op écht afgeronde opdrachten. Periodes: 7/14/30/90/365 dagen.
import { db, now, save, logActivity } from './db.js';
import { getStatuses, isWhatsappOrderGroup, getCompanyProfile } from './settings.js';
import { conversieInsight } from './ai/categorizer.js';

const DAG = 86400000;
const pct = (t, n) => (n > 0 ? Math.round((t / n) * 1000) / 10 : null);
const r2 = (n) => Math.round(n * 100) / 100;

// Bron van een opdracht, teruggebracht tot een handvol herkenbare labels.
export function bronVan(o, msgById) {
  const src = String(o.source || '').toLowerCase();
  if ((o.originGroup && isWhatsappOrderGroup(o.originGroup)) || /\bdrs\b/.test(src)) return 'DRS-groep';
  const m = o.messageId && msgById ? msgById.get(o.messageId) : null;
  if (/website/.test(src) || (m && (/website/i.test(m.mailbox || '') || /^nieuwe aanvraag via de website/i.test(m.body || '')))) return 'Website';
  if (/e-?mail/.test(src)) return 'E-mail';
  if (/whatsapp/.test(src)) return 'WhatsApp (1-op-1)';
  if (/telefoon/.test(src)) return 'Telefoon';
  if (/handmatig|monteur/.test(src) || !src) return 'Handmatig';
  return o.source;
}

export const GEWONNEN = new Set(['afgerond', 'afspraak_ingepland']);
export const VERLOREN = new Set(['geannuleerd']);
export const PERIODES = [7, 14, 30, 90, 365];
function telling() { return { binnen: 0, gewonnen: 0, afgerond: 0, afspraak: 0, verloren: 0, open: 0, omzet: 0 }; }
function afronden(t) {
  return {
    ...t,
    omzet: r2(t.omzet),
    conversie: pct(t.gewonnen, t.gewonnen + t.verloren),
    conversieTotaal: pct(t.gewonnen, t.binnen),
  };
}
// Eén plek die telt, gedeeld door totaal/bron/monteur/week.
function telOp(t, o, invByOrder) {
  t.binnen++;
  if (o.status === 'afgerond') { t.gewonnen++; t.afgerond++; t.omzet += omzetVan(o, invByOrder); }
  else if (GEWONNEN.has(o.status)) { t.gewonnen++; t.afspraak++; }
  else if (VERLOREN.has(o.status)) t.verloren++;
  else t.open++;
}
const GESLOTEN = new Set([...GEWONNEN, ...VERLOREN]);

// Omzet van een afgeronde opdracht: gekoppelde factuur (excl. btw) wint van het prijsveld.
// Gedeeld met het Weekrapport op Start (26 sep 2026: dat keek alleen naar het
// prijsveld → monteurs die wel factureren maar het prijsveld leeg laten stonden op €0).
// Prijsveld ("740", "€ 740,-", "1.250,50") → euro's; 0 als onleesbaar. (Oude lezer
// maakte van "1.250,50" niets en van "€ 740,-" soms NaN.)
export function leesPrijs(str) {
  let t = String(str || '').replace(/[^\d.,]/g, '');
  if (!t) return 0;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) t = t.replace(/\./g, ''); // 1.250 → 1250
  t = t.replace(',', '.');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}
export function omzetVan(o, invByOrder) {
  const inv = invByOrder.get(o.id);
  if (inv && Number.isFinite(Number(inv.totalExcl))) return Number(inv.totalExcl);
  return leesPrijs(o.price);
}
// Factuur per opdracht: alleen echte facturen (geen offerte), niet-concept. Heeft de
// opdracht er meerdere, dan wint die waar order.invoiceId naar wijst.
export function factuurPerOpdracht() {
  const map = new Map();
  for (const i of db().invoices || []) if (i.orderId && i.type !== 'offerte' && i.status !== 'concept') map.set(i.orderId, i);
  for (const o of db().orders || []) {
    const hoofd = o.invoiceId && (db().invoices || []).find((i) => i.id === o.invoiceId && i.type !== 'offerte' && i.status !== 'concept');
    if (hoofd) map.set(o.id, hoofd);
  }
  return map;
}

function maandag(ms) {
  const d = new Date(ms); const dag = (d.getUTCDay() || 7) - 1;
  d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - dag);
  return d.getTime();
}

export function conversieData({ dagen = 90, weken = 12 } = {}) {
  dagen = Math.max(7, Math.min(730, Number(dagen) || 90));
  const nu = Date.now();
  const van = nu - dagen * DAG;
  const vorigVan = van - dagen * DAG;
  const msgById = new Map((db().messages || []).map((m) => [m.id, m]));
  const invByOrder = factuurPerOpdracht();
  const monteurNaam = new Map((db().monteurs || []).map((m) => [m.id, m.name]));
  const statussen = getStatuses();
  const label = (k) => (statussen.find((s) => s.key === k) || {}).label || k;

  const alle = (db().orders || []).filter((o) => o.createdAt);
  const inVenster = (o, a, b) => { const t = new Date(o.createdAt).getTime(); return t >= a && t < b; };
  const huidig = alle.filter((o) => inVenster(o, van, nu + DAG));
  const vorig = alle.filter((o) => inVenster(o, vorigVan, van));

  const tel = (lijst) => {
    const t = telling();
    for (const o of lijst) telOp(t, o, invByOrder);
    return afronden(t);
  };
  const totaal = tel(huidig);
  const vorige = tel(vorig);

  // Per status (waar staan de aanvragen uit deze periode NU?) — in kolomvolgorde.
  const perStatusMap = new Map();
  for (const o of huidig) perStatusMap.set(o.status, (perStatusMap.get(o.status) || 0) + 1);
  const perStatus = [...statussen.map((s) => s.key), ...[...perStatusMap.keys()].filter((k) => !statussen.some((s) => s.key === k))]
    .filter((k) => perStatusMap.has(k))
    .map((k) => ({ key: k, label: label(k), count: perStatusMap.get(k), pct: pct(perStatusMap.get(k), totaal.binnen) }));

  // Per bron en per monteur.
  const groepeer = (sleutel) => {
    const map = new Map();
    for (const o of huidig) {
      const k = sleutel(o);
      if (!map.has(k)) map.set(k, telling());
      telOp(map.get(k), o, invByOrder);
    }
    return [...map.entries()].map(([naam, t]) => ({ naam, ...afronden(t) })).sort((a, b) => b.binnen - a.binnen);
  };
  const perBron = groepeer((o) => bronVan(o, msgById));
  const perMonteur = groepeer((o) => (o.monteurId && monteurNaam.get(o.monteurId)) || 'Geen monteur');

  // Per week (cohort op aanmaakweek): hoeveel kwam er binnen en wat is ervan geworden?
  const perWeek = [];
  const startWeek = maandag(nu) - (weken - 1) * 7 * DAG;
  for (let i = 0; i < weken; i++) {
    const a = startWeek + i * 7 * DAG; const b = a + 7 * DAG;
    const t = tel(alle.filter((o) => inVenster(o, a, b)));
    perWeek.push({ week: new Date(a).toISOString().slice(0, 10), ...t });
  }

  // Doorlooptijd: dagen van aanmaak tot afronding/annulering (gemiddelde + mediaan).
  const dagenTot = (o, veld) => { const e = new Date(o[veld] || o.updatedAt || 0).getTime(); const s = new Date(o.createdAt).getTime(); return e > s ? (e - s) / DAG : null; };
  const afgerondDagen = huidig.filter((o) => o.status === 'afgerond').map((o) => dagenTot(o, 'completedAt')).filter((x) => x !== null).sort((a, b) => a - b);
  const geannDagen = huidig.filter((o) => VERLOREN.has(o.status)).map((o) => dagenTot(o, 'updatedAt')).filter((x) => x !== null).sort((a, b) => a - b);
  const gem = (l) => (l.length ? r2(l.reduce((s, x) => s + x, 0) / l.length) : null);
  const med = (l) => (l.length ? r2(l[Math.floor(l.length / 2)]) : null);
  const doorlooptijd = { afgerondGem: gem(afgerondDagen), afgerondMediaan: med(afgerondDagen), geannuleerdGem: gem(geannDagen), n: afgerondDagen.length };

  // Waarde: omzet uit afgeronde opdrachten (factuur excl. btw of prijsveld).
  const waarde = {
    omzetAfgerond: totaal.omzet,
    perAfgerond: totaal.afgerond ? r2(totaal.omzet / totaal.afgerond) : null,
    perAanvraag: totaal.binnen ? r2(totaal.omzet / totaal.binnen) : null,
    afgerondZonderFactuur: huidig.filter((o) => o.status === 'afgerond' && !invByOrder.has(o.id)).length,
  };

  // Stilliggers: open aanvragen uit deze periode die al 14+ dagen niet zijn aangeraakt.
  const stil = huidig.filter((o) => !GESLOTEN.has(o.status) && nu - new Date(o.updatedAt || o.createdAt).getTime() > 14 * DAG).length;

  const patronen = herkenPatronen({ totaal, vorige, perBron, perMonteur, perWeek, doorlooptijd, waarde, stil, dagen });
  return {
    periode: { dagen, van: new Date(van).toISOString(), tot: new Date(nu).toISOString() },
    totaal, vorige,
    delta: { conversie: totaal.conversie !== null && vorige.conversie !== null ? r2(totaal.conversie - vorige.conversie) : null, binnen: totaal.binnen - vorige.binnen },
    perStatus, perBron, perMonteur, perWeek, doorlooptijd, waarde, stil, patronen,
    definitie: { gewonnen: [...GEWONNEN], verloren: [...VERLOREN], periodes: PERIODES },
    briefing: db().settings._conversieBriefing || null,
  };
}

// Deterministische patroonherkenning — werkt altijd, ook zonder AI. De AI krijgt
// deze regels als vertrekpunt en mag er duiding aan geven.
export function herkenPatronen(d) {
  const uit = [];
  const t = d.totaal;
  if (t.binnen === 0) return ['Geen aanvragen in deze periode.'];
  if (t.conversie !== null && d.vorige.conversie !== null) {
    const v = r2(t.conversie - d.vorige.conversie);
    if (Math.abs(v) >= 5) uit.push(`Conversie ${v > 0 ? 'stijgt' : 'daalt'} met ${Math.abs(v)} punt(en) t.o.v. de vorige ${d.dagen} dagen (${d.vorige.conversie}% → ${t.conversie}%).`);
  }
  if (d.vorige.binnen && t.binnen) {
    const g = Math.round(((t.binnen - d.vorige.binnen) / d.vorige.binnen) * 100);
    if (Math.abs(g) >= 20) uit.push(`Instroom ${g > 0 ? '+' : ''}${g}% t.o.v. de vorige periode (${d.vorige.binnen} → ${t.binnen} aanvragen).`);
  }
  const beslist = d.perBron.filter((b) => b.gewonnen + b.verloren >= 5 && b.conversie !== null);
  if (beslist.length >= 2) {
    const best = [...beslist].sort((a, b) => b.conversie - a.conversie)[0];
    const slecht = [...beslist].sort((a, b) => a.conversie - b.conversie)[0];
    if (best.naam !== slecht.naam && best.conversie - slecht.conversie >= 15) uit.push(`Bron ${best.naam} converteert het best (${best.conversie}%), ${slecht.naam} het slechtst (${slecht.conversie}%).`);
  }
  const grootsteBron = d.perBron[0];
  if (grootsteBron && grootsteBron.binnen >= 5 && t.binnen) uit.push(`${grootsteBron.naam} levert ${Math.round((grootsteBron.binnen / t.binnen) * 100)}% van alle aanvragen.`);
  const mBeslist = d.perMonteur.filter((m) => m.naam !== 'Geen monteur' && m.gewonnen + m.verloren >= 5 && m.conversie !== null);
  if (mBeslist.length >= 2) {
    const best = [...mBeslist].sort((a, b) => b.conversie - a.conversie)[0];
    const slecht = [...mBeslist].sort((a, b) => a.conversie - b.conversie)[0];
    if (best.naam !== slecht.naam && best.conversie - slecht.conversie >= 15) uit.push(`Per monteur: ${best.naam} ${best.conversie}% tegenover ${slecht.naam} ${slecht.conversie}%.`);
  }
  if (t.open && t.binnen && t.open / t.binnen >= 0.4 && d.dagen >= 30) uit.push(`${Math.round((t.open / t.binnen) * 100)}% van de aanvragen staat nog open — het echte cijfer wordt pas duidelijk als die beslist zijn.`);
  if (d.stil >= 3) uit.push(`${d.stil} open aanvragen uit deze periode zijn 14+ dagen niet aangeraakt; die verliezen meestal.`);
  if (d.doorlooptijd.afgerondMediaan !== null && d.doorlooptijd.afgerondMediaan > 10) uit.push(`Afgeronde opdrachten duren gemiddeld lang: mediaan ${d.doorlooptijd.afgerondMediaan} dagen van aanvraag tot afronding.`);
  if (d.waarde.afgerondZonderFactuur >= 3) uit.push(`${d.waarde.afgerondZonderFactuur} afgeronde opdrachten hebben geen factuur in het CRM — de omzet per aanvraag is daardoor te laag.`);
  const laatste4 = d.perWeek.slice(-4).filter((w) => w.binnen > 0);
  const eerdere = d.perWeek.slice(0, -4).filter((w) => w.binnen > 0);
  if (laatste4.length >= 3 && eerdere.length >= 3) {
    const gemL = laatste4.reduce((s, w) => s + w.binnen, 0) / laatste4.length;
    const gemE = eerdere.reduce((s, w) => s + w.binnen, 0) / eerdere.length;
    if (gemE > 0 && Math.abs(gemL - gemE) / gemE >= 0.3) uit.push(`Instroom per week de laatste 4 weken ${gemL > gemE ? 'hoger' : 'lager'} dan daarvoor (gem. ${r2(gemL)} vs ${r2(gemE)} per week).`);
  }
  if (!uit.length) uit.push('Geen opvallende patronen; de cijfers zijn stabiel.');
  return uit;
}

// Feiten-tekst voor de AI en voor het CEO-rapport.
export function conversieFeiten(d) {
  const t = d.totaal;
  const r = [];
  r.push(`Periode: laatste ${d.periode.dagen} dagen. Binnengekomen ${t.binnen}, gewonnen ${t.gewonnen} (${t.afgerond} afgerond + ${t.afspraak} afspraak ingepland), verloren (geannuleerd) ${t.verloren}, nog open ${t.open}.`);
  r.push(`Conversie (van beslist): ${t.conversie ?? '-'}% (vorige periode ${d.vorige.conversie ?? '-'}%). Conversie van alles: ${t.conversieTotaal ?? '-'}%.`);
  r.push(`Per bron: ${d.perBron.map((b) => `${b.naam} ${b.binnen} binnen / ${b.gewonnen} gewonnen / ${b.verloren} verloren (${b.conversie ?? '-'}%)`).join('; ')}.`);
  r.push(`Per monteur: ${d.perMonteur.map((m) => `${m.naam} ${m.gewonnen}/${m.gewonnen + m.verloren} (${m.conversie ?? '-'}%)`).join('; ')}.`);
  r.push(`Per week (binnen/gewonnen/verloren): ${d.perWeek.map((w) => `${w.week.slice(5)}: ${w.binnen}/${w.gewonnen}/${w.verloren}`).join(', ')}.`);
  r.push(`Doorlooptijd afgerond: gem. ${d.doorlooptijd.afgerondGem ?? '-'} d, mediaan ${d.doorlooptijd.afgerondMediaan ?? '-'} d; geannuleerd gem. ${d.doorlooptijd.geannuleerdGem ?? '-'} d.`);
  r.push(`Omzet uit afgeronde opdrachten: € ${d.waarde.omzetAfgerond} (per afgeronde ${d.waarde.perAfgerond ?? '-'}, per aanvraag ${d.waarde.perAanvraag ?? '-'}); ${d.waarde.afgerondZonderFactuur} afgerond zonder factuur; ${d.stil} stilliggers.`);
  r.push(`Herkende patronen: ${d.patronen.join(' ')}`);
  return r.join('\n');
}

// Wekelijkse briefing: AI-duiding op de feiten (faalt stil → alleen de patronen).
export async function maakConversieBriefing({ force = false, door = 'systeem' } = {}) {
  const weekKey = new Date(maandag(Date.now())).toISOString().slice(0, 10);
  const huidig = db().settings._conversieBriefing;
  if (!force && huidig && huidig.week === weekKey) return huidig;
  const d30 = conversieData({ dagen: 30 });
  const d90 = conversieData({ dagen: 90 });
  const feiten = `30 DAGEN\n${conversieFeiten(d30)}\n\n90 DAGEN\n${conversieFeiten(d90)}`;
  let tekst = '';
  let bron = 'feiten';
  try { tekst = await conversieInsight({ facts: feiten, companyProfile: getCompanyProfile() }); if (tekst) bron = 'ai'; } catch { tekst = ''; }
  if (!tekst) {
    tekst = [`Conversie laatste 30 dagen: ${d30.totaal.conversie ?? '-'}% van de besliste aanvragen gewonnen (${d30.totaal.gewonnen} van ${d30.totaal.gewonnen + d30.totaal.verloren}: ${d30.totaal.afgerond} afgerond + ${d30.totaal.afspraak} afspraak ingepland); ${d30.totaal.open} staan nog open.`, ...d30.patronen.map((p) => `• ${p}`)].join('\n');
  }
  const b = { at: now(), week: weekKey, tekst, bron, door, conversie30: d30.totaal.conversie, conversie90: d90.totaal.conversie };
  db().settings._conversieBriefing = b;
  logActivity(door, 'conversie-briefing gemaakt', `${bron}, 30 d: ${d30.totaal.conversie ?? '-'}%`);
  save();
  return b;
}

// DRS-RAPPORT (16 okt 2026, casus 4879 NB Etten-Leur / North Ridge BV).
//
// Elke AFGERONDE opdracht uit de DRS-groep kost Keyservice een fee. De assistente zet
// elke avond een dagrapport in die groep ("*Dinsdag 13-10* / *Afgerond:* / 4879 NB
// Etten-Leur"), en DRS factureert op basis daarvan. De kolom Afgerond in het CRM bevat
// de hele week (hij klapt pas zondagnacht in), dus bij het samenstellen zag je niet welke
// opdrachten al gemeld waren — 4879 NB stond dinsdag én donderdag als afgerond in het
// rapport = twee keer betalen voor één klus.
//
// Oplossing, deterministisch (geen AI):
//  1. Per opdracht wordt per kopje vastgelegd of hij AL GEMELD is aan DRS
//     (order.drsGemeld = { afgerond: {at, datum, door, via, rapportId, regel}, … }).
//  2. Het DRS-rapport toont alleen wat nog NIET gemeld is en maakt de tekst klaar (met
//     klantnaam, wens van DRS). Een opdracht die al als afgerond gemeld is kan nooit
//     nogmaals als afgerond gemeld worden (alleen bewust met force).
//  3. VANGNET: het rapport dat de assistente zelf in de DRS-groep zet komt via de bridge
//     binnen (pipeline → isEigenRapport). Dat rapport wordt gelezen: opdrachten worden
//     automatisch afgevinkt, en staat een opdracht er voor de tweede keer als afgerond
//     in, dan gaat er direct een DUBBEL-alarm uit naar kantoor. Zo werkt handmatig
//     (vanaf de telefoon) en via het CRM allebei, en wordt elke vergissing gezien.
import { db, id, now, saveSoon, logActivity } from './db.js';
import { isWhatsappOrderGroup, appointmentStatusKey, getWhatsappOrderGroups } from './settings.js';

// ---------- kopjes ----------
export const DRS_KOPJES = [
  { cat: 'afgerond', label: 'Afgerond', status: () => 'afgerond' },
  { cat: 'geannuleerd', label: 'Geannuleerd', status: () => 'geannuleerd' },
  { cat: 'offerte', label: 'Offerte', status: () => 'offerte_verzonden' },
  { cat: 'afspraak', label: 'Afspraken', status: () => appointmentStatusKey() || 'afspraak_ingepland' },
];
export const KOPJE_LABEL = Object.fromEntries(DRS_KOPJES.map((k) => [k.cat, k.label]));
export const DEFAULT_DRS_RAPPORT = {
  kopjes: ['afgerond', 'geannuleerd'],     // wat er standaard in het rapport staat
  herinnering: true,                       // 's avonds een melding als er nog iets te melden is
  herinneringUur: 21,                      // Nederlandse tijd
  afzenders: [],                           // extra namen (zoals in WhatsApp) die het rapport plaatsen
  emailAfzenders: [],                      // e-mailadressen/domeinen waarmee DRS opdrachten mailt
};
// BEWUST GEEN "rechtstreeks in de DRS-groep plaatsen" door het CRM: eerdere beslissing van
// de eigenaar (terugkoppeling gaat nooit direct naar DRS) én whatsapp-web.js kan een fout
// melden NÁ het bezorgen — dan zou het rapport als "niet verstuurd" gelden en een tweede
// keer gemeld worden. Precies wat we hier voorkomen. De assistente plakt het rapport zelf;
// het vangnet leest het daarna uit de groep.
export function getDrsRapportInstellingen() {
  const s = db().settings.drsRapport || {};
  const kopjes = Array.isArray(s.kopjes) ? s.kopjes.filter((k) => KOPJE_LABEL[k]) : DEFAULT_DRS_RAPPORT.kopjes;
  return {
    kopjes: kopjes.length ? kopjes : DEFAULT_DRS_RAPPORT.kopjes,
    herinnering: s.herinnering !== undefined ? !!s.herinnering : DEFAULT_DRS_RAPPORT.herinnering,
    herinneringUur: Number.isInteger(s.herinneringUur) && s.herinneringUur >= 12 && s.herinneringUur <= 23 ? s.herinneringUur : DEFAULT_DRS_RAPPORT.herinneringUur,
    afzenders: Array.isArray(s.afzenders) ? s.afzenders.map((x) => String(x).trim()).filter(Boolean).slice(0, 20) : [],
    emailAfzenders: Array.isArray(s.emailAfzenders) ? s.emailAfzenders.map((x) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 20) : [],
  };
}
export function sanitizeDrsRapportInstellingen(b = {}) {
  const uit = getDrsRapportInstellingen();
  if (Array.isArray(b.kopjes)) {
    const k = [...new Set(b.kopjes.map(String).filter((x) => KOPJE_LABEL[x]))];
    if (k.length) uit.kopjes = k;
  }
  if ('herinnering' in b) uit.herinnering = !!b.herinnering;
  if ('herinneringUur' in b) { const u = Number(b.herinneringUur); if (Number.isInteger(u) && u >= 12 && u <= 23) uit.herinneringUur = u; }
  if ('afzenders' in b) uit.afzenders = (Array.isArray(b.afzenders) ? b.afzenders : String(b.afzenders || '').split(','))
    .map((x) => String(x).trim().slice(0, 60)).filter((x) => x.length >= 3).slice(0, 20);
  if ('emailAfzenders' in b) uit.emailAfzenders = (Array.isArray(b.emailAfzenders) ? b.emailAfzenders : String(b.emailAfzenders || '').split(/[,\s]+/))
    .map((x) => String(x).trim().toLowerCase().replace(/^@/, '')).filter((x) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(x) || /^[a-z0-9.-]+\.[a-z]{2,}$/.test(x)).slice(0, 20);
  return uit;
}
// Mailt DRS? Volledig adres (opdrachten@drs.nl) of alleen het domein (drs.nl).
export function isDrsEmailAfzender(adres) {
  const a = String(adres || '').trim().toLowerCase();
  if (!a.includes('@')) return false;
  const domein = a.split('@')[1];
  return getDrsRapportInstellingen().emailAfzenders.some((x) => (x.includes('@') ? x === a : domein === x || domein.endsWith('.' + x)));
}
// Bij welk kopje hoort de HUIDIGE status van een opdracht?
export function catVanStatus(status) {
  const k = DRS_KOPJES.find((x) => x.status() === status);
  return k ? k.cat : null;
}

// ---------- DRS-opdracht herkennen (één bron van waarheid; index.js gebruikt deze ook) ----------
export function isDrsOrder(order) {
  if (!order) return false;
  const bron = String(order.source || '').toLowerCase();
  // Expliciet als DRS gemarkeerd (Herkomst "DRS WhatsApp groep") wint altijd — ook als de
  // opdracht via de monteursgroep binnenkwam (audit 16 okt 2026: die kreeg anders geen
  // DRS-rapportregel en geen fee, en de assistente kon het nergens rechtzetten).
  if (/\bdrs\b/.test(bron)) return true;
  // Lege instelling ("alle groepen") maakt NIET elke groep tot DRS (audit 16 okt): dan zouden
  // opdrachten uit monteursgroepen in het DRS-rapport en als DRS-fee meetellen.
  if (order.originGroup) return getWhatsappOrderGroups().length > 0 && isWhatsappOrderGroup(order.originGroup);
  // Zonder herkomstgroep: een groepsbron telt ook. De oude regex /whatsapp|groep|app/ zag
  // élke 1-op-1 WhatsApp-kaart ("Keyservice WhatsApp") als DRS (audit 3 okt 2026).
  return /groep/.test(bron);
}

// ---------- postcode / plaats / naam ----------
// Strenge NL-postcode: 1000-9999 + twee letters, geen SA/SD/SS en geen gewoon woordje
// ("2025 al" is geen postcode — zelfde stoplijst als de groepsintake).
const PC_STOP = new Set(['al', 'om', 'en', 'is', 'op', 'in', 'te', 'of', 'er', 'de', 'je', 'we', 'ik', 'na', 'nu', 'ca', 'uw', 'zo', 'ja', 'ok', 'km', 'kg', 'cm', 'mm', 'eu', 'uu', 'sa', 'sd', 'ss', 'pm', 'am', 'st', 'nr']);
const PC_RE = /(?<![\d])([1-9]\d{3})\s?([a-z]{2})(?![a-z])/gi;
export function vindPostcode(tekst) {
  for (const m of String(tekst || '').replace(/[*_~]/g, '').matchAll(PC_RE)) {
    if (!PC_STOP.has(m[2].toLowerCase())) return `${m[1]}${m[2].toUpperCase()}`;
  }
  return '';
}
export const toonPostcode = (pc) => (pc && pc.length === 6 ? `${pc.slice(0, 4)} ${pc.slice(4)}` : pc || '');

const GENERIEK = /^(onbekende klant|onbekend|klant|key ?service( 24\/7)?( admin)?|keyservice|drs|slotenmaker|beheerder|info|systeem|website|n\.?v\.?t\.?|-)$/i;
function klantVan(order) {
  return (db().customers || []).find((c) => c.id === order.customerId) || {};
}
function berichtVan(order) {
  return order && order.messageId ? (db().messages || []).find((m) => m.id === order.messageId) || null : null;
}
// Waar komt het adres van DÉZE aanvraag vandaan? (Audit 16 okt 2026: viel de postcode uit
// het klantrecord, dan kon een terugkerende klant met een oud adres een VERKEERDE postcode
// in het rapport krijgen — en dan vindt het vangnet het eigen rapport niet terug.)
// Volgorde: intake-adres → de opdrachttekst / het oorspronkelijke bericht (DRS-veld
// "Woonplaats: 4879 NB - Etten-Leur") → titel → pas als laatste het klantrecord.
// Lui uitgerekend: het oorspronkelijke bericht opzoeken kost een zoekslag door alle berichten.
function adresBronnen(order) {
  return [
    ['aanvraag', () => order.intake && order.intake.address],
    ['opdracht', () => order.description],
    ['bericht', () => (berichtVan(order) || {}).body],
    ['gesprek', () => ((order.thread || [])[0] || {}).body],
    ['titel', () => order.title],
    ['klant', () => klantVan(order).address],
  ];
}
export function postcodeMetBron(order) {
  for (const [bron, tekst] of adresBronnen(order)) {
    const pc = vindPostcode(tekst());
    if (pc) return { pc, bron };
  }
  return { pc: '', bron: '' };
}
export function postcodeVanOrder(order) { return postcodeMetBron(order).pc; }
function hoofdletters(s) {
  return String(s || '').toLowerCase().replace(/(^|[\s-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase()).replace(/^'S /i, "'s ");
}
export function plaatsVanOrder(order) {
  const { pc } = postcodeMetBron(order);
  for (const [, tekst] of adresBronnen(order)) {
    const a = String(tekst() || '');
    if (pc && vindPostcode(a) !== pc) continue; // plaats hoort bij dezelfde postcode
    const m = a.match(/[1-9]\d{3}\s?[a-z]{2}(?![a-z])[ \t,.-]*([a-zà-ÿ'][a-zà-ÿ' .-]*?)[ \t]*(?:,|$|\n|\d|\()/i);
    if (m && m[1] && m[1].trim().length >= 2) return hoofdletters(m[1].trim().replace(/[.-]+$/, ''));
  }
  // Titel begint volgens de vaste werkafspraak met de plaatsnaam ("Etten-Leur — slot kapot").
  const t = String(order.title || '').split(/\s+[—–-]\s+/)[0].trim();
  if (t && t.length <= 40 && !/\d/.test(t)) return hoofdletters(t);
  return '';
}
export function naamVanOrder(order) {
  const c = klantVan(order);
  // De afzender van het DRS-bericht (bv. "Shemara DRS") is nooit de klant (audit 16 okt).
  const afz = String((berichtVan(order) || {}).sender || '').trim().toLowerCase();
  for (const n of [order.intake && order.intake.name, c.name]) {
    const s = String(n || '').trim();
    if (!s || GENERIEK.test(s)) continue;
    if (afz && (s.toLowerCase() === afz || afz.split(/\s+/)[0] === s.toLowerCase())) continue;
    return s.slice(0, 60);
  }
  return '';
}
const TEL_RE = /(?:\+31|0031|0)[1-9](?:[\s-]?\d){8}/g;
// Reden bij geannuleerd/offerte: laatste niet-lege regel van de notitie (kort, bewerkbaar
// in het scherm vóór het versturen — nooit ongezien naar DRS).
function korteNotitie(order) {
  // Nooit een telefoonnummer meesturen (privé + dan lijkt het rapport op een opdracht).
  const regels = String(order.notes || '').replace(TEL_RE, '').split(/\n+/).map((r) => r.trim()).filter(Boolean);
  const r = regels.length ? regels[regels.length - 1] : '';
  return r.length > 140 ? r.slice(0, 137) + '…' : r;
}
export function regelVoor(order, cat) {
  const pc = toonPostcode(postcodeVanOrder(order));
  const plaats = plaatsVanOrder(order);
  const naam = naamVanOrder(order);
  let regel = [pc, plaats].filter(Boolean).join(' ') || String(order.title || '').slice(0, 60);
  if (naam) regel += ` — ${naam}`;
  if ((cat === 'geannuleerd' || cat === 'offerte') && korteNotitie(order)) regel += `, ${korteNotitie(order)}`;
  if (cat === 'afspraak' && order.appointmentAt) {
    const m = String(order.appointmentAt).match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2})/);
    if (m) regel += ` (${m[2]}-${m[1]} ${m[3]})`;
  }
  return regel;
}

// ---------- mogelijk dubbele opdracht (audit 16 okt 2026) ----------
// Zelfde klant (telefoon) of zelfde adres (postcode) kort geleden al als opdracht in het CRM?
// Gebruikt door "Plak opdracht" (409 + bewust doorgaan) en door de groepsintake (een DRS-
// opdracht die opnieuw gepost wordt nadat de eerste al is afgerond, wordt niet meer stil
// automatisch een tweede kaart + tweede fee).
const telSleutel = (t) => {
  let d = String(t || '').replace(/\D/g, '');
  if (d.startsWith('0031')) d = '0' + d.slice(4); else if (d.startsWith('31') && d.length === 11) d = '0' + d.slice(2);
  return d.length >= 9 ? d.slice(-9) : '';
};
export function zoekMogelijkDubbel({ phone, address, tekst, dagen = 30, alleenAfgesloten = false, alleenDrs = false, metInbox = false, nu = Date.now() } = {}) {
  const tel = telSleutel(phone);
  const pc = vindPostcode(address) || vindPostcode(tekst);
  if (!tel && !pc) return null;
  const kandidaten = [];
  for (const o of alleOpdrachten()) {
    const t = new Date(o.completedAt || o.updatedAt || o.createdAt || 0).getTime();
    if (!(nu - t <= dagen * DAG)) continue;
    const afgesloten = ['afgerond', 'geannuleerd'].includes(o.status) || !!o.archivedWeek;
    if (alleenAfgesloten && !afgesloten) continue;
    if (alleenDrs && !isDrsOrder(o)) continue;
    const c = klantVan(o);
    const telRaak = !!tel && [o.intake && o.intake.phone, c.phone].some((p) => telSleutel(p) === tel);
    const pcRaak = !!pc && postcodeVanOrder(o) === pc;
    if (telRaak || pcRaak) kandidaten.push({ o, telRaak, pcRaak, t });
  }
  kandidaten.sort((a, b) => (b.telRaak - a.telRaak) || (b.t - a.t));
  const k = kandidaten[0];
  if (k) return { soort: 'opdracht', orderId: k.o.id, titel: k.o.title || '', status: k.o.status, datum: nlDatum(new Date(k.t)), opTelefoon: k.telRaak, opPostcode: k.pcRaak, ingeklapt: !!k.o.archivedWeek, isDrs: isDrsOrder(k.o) };
  if (metInbox && tel) {
    const r = (db().reviews || []).filter((x) => ['pending', 'overige'].includes(x.status) && nu - new Date(x.createdAt || 0).getTime() <= 7 * DAG
      && telSleutel(x.suggestion && x.suggestion.customerPhone) === tel)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
    if (r) return { soort: 'inbox', reviewId: r.id, titel: (r.suggestion && (r.suggestion.title || r.suggestion.customerName)) || 'bericht in de inbox', datum: nlDatum(new Date(r.createdAt)), opTelefoon: true, opPostcode: false };
  }
  return null;
}

// ---------- datum ----------
const DAGEN = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];
export function nlDatum(d = new Date()) {
  return new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' }); // JJJJ-MM-DD
}
export function datumKop(datum) {
  const [j, m, d] = String(datum).split('-').map(Number);
  const dt = new Date(Date.UTC(j, m - 1, d, 12));
  return `${DAGEN[dt.getUTCDay()]} ${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}`;
}
export function korteDatum(datum) {
  const [, m, d] = String(datum || '').split('-');
  return d && m ? `${DAGEN[new Date(Date.UTC(+String(datum).slice(0, 4), +m - 1, +d, 12)).getUTCDay()].slice(0, 2).toLowerCase()} ${d}-${m}` : '';
}

// ---------- opslag ----------
export function rapportenLijst() {
  if (!Array.isArray(db().drsRapporten)) db().drsRapporten = [];
  return db().drsRapporten;
}
function bewaarRapport(r) {
  const lijst = rapportenLijst();
  lijst.unshift(r);
  if (lijst.length > 300) lijst.length = 300; // ruim een jaar aan dagrapporten
  return r;
}
const alleOpdrachten = () => (db().orders || []).filter((o) => o && !o.deletedAt);
// Prullenbak telt mee voor "was dit adres al gemeld?" (kaart gemeld en daarna weggegooid of
// samengevoegd) — maar wordt zelf nooit afgevinkt.
const prullenbakGemeld = () => (db().trash || []).filter((o) => o && o.drsGemeld && Object.keys(o.drsGemeld).length);

// ---------- wat moet er nog gemeld worden? ----------
const DAG = 86400000;
function sindsVan(order, cat) {
  if (cat === 'afgerond') return order.completedAt || order.statusSince || order.updatedAt || order.createdAt;
  if (cat === 'geannuleerd') return order.cancelledAt || order.statusSince || order.updatedAt || order.createdAt;
  return order.statusSince || order.updatedAt || order.createdAt;
}
// Alles van de afgelopen `dagen` dat in een gekozen kopje staat en daarvoor nog niet is
// gemeld. Ook INGEKLAPTE weken tellen mee (zaterdag afgerond, maandag gemeld).
export function nogTeMelden({ kopjes, dagen = 30, nu = Date.now() } = {}) {
  const cats = kopjes || getDrsRapportInstellingen().kopjes;
  const grens = nu - dagen * DAG;
  const uit = [];
  for (const o of alleOpdrachten()) {
    if (!isDrsOrder(o)) continue;
    const cat = catVanStatus(o.status);
    if (!cat || !cats.includes(cat)) continue;
    if (o.drsGemeld && o.drsGemeld[cat]) continue;
    const sinds = sindsVan(o, cat);
    if (sinds && new Date(sinds).getTime() < grens) continue;
    uit.push(o);
  }
  return uit;
}
// Eerder gemelde opdrachten met dezelfde postcode (laatste 45 dagen) — voor de
// waarschuwing "4879 NB is op di 13-10 al als afgerond gemeld (andere opdracht)".
function eerderGemeldOpPostcode(pc, behalveId, nu = Date.now()) {
  if (!pc) return [];
  const uit = [];
  for (const o of [...alleOpdrachten(), ...prullenbakGemeld()]) {
    if (o.id === behalveId || !o.drsGemeld || !o.drsGemeld.afgerond) continue;
    if (nu - new Date(o.drsGemeld.afgerond.at).getTime() > 45 * DAG) continue;
    if (postcodeVanOrder(o) === pc) uit.push(o);
  }
  return uit;
}
// Voor de AI-statusscan (audit 16 okt): wil de AI een DRS-opdracht op afgerond zetten terwijl
// er op hetzelfde adres kort geleden al een ANDERE opdracht als afgerond aan DRS is gemeld?
// Dan is het bewijs waarschijnlijk ons eigen oude rapport → waarschuwing, niet blind toepassen.
export function alAfgerondGemeldOpAdres(order, nu = Date.now()) {
  const pc = postcodeVanOrder(order);
  const e = eerderGemeldOpPostcode(pc, order.id, nu)[0];
  return e ? { datum: e.drsGemeld.afgerond.datum, titel: e.title || '', postcode: toonPostcode(pc) } : null;
}
export function rapportVoorstel({ kopjes, nu = Date.now() } = {}) {
  const cfg = getDrsRapportInstellingen();
  const cats = kopjes && kopjes.length ? kopjes.filter((k) => KOPJE_LABEL[k]) : cfg.kopjes;
  const vandaag = nlDatum(new Date(nu));
  const orders = nogTeMelden({ kopjes: cats, nu });
  const items = orders.map((o) => {
    const cat = catVanStatus(o.status);
    const { pc, bron } = postcodeMetBron(o);
    const sinds = sindsVan(o, cat);
    const waarschuwingen = [];
    if (!pc) waarschuwingen.push('Geen postcode bekend — vul het adres van de klant aan');
    else if (bron === 'klant' && o.intake && o.intake.address) waarschuwingen.push('Postcode komt uit het klantrecord (het adres van deze aanvraag heeft geen postcode) — klopt hij nog?');
    if (!naamVanOrder(o)) waarschuwingen.push('Klantnaam ontbreekt — vul hem eventueel zelf in de regel in');
    if (cat === 'afgerond') {
      for (const e of eerderGemeldOpPostcode(pc, o.id, nu)) {
        waarschuwingen.push(`${toonPostcode(pc)} is op ${korteDatum(e.drsGemeld.afgerond.datum)} al als afgerond gemeld (opdracht "${String(e.title || '').slice(0, 50)}"). Zelfde klus? Dan niet nogmaals melden.`);
      }
    }
    return {
      orderId: o.id, cat, status: o.status, titel: o.title || '', postcode: toonPostcode(pc),
      plaats: plaatsVanOrder(o), naam: naamVanOrder(o), regel: regelVoor(o, cat),
      sinds, sindsDatum: sinds ? nlDatum(new Date(sinds)) : '', ouder: !!(sinds && nlDatum(new Date(sinds)) < vandaag && (nu - new Date(sinds).getTime()) > 2 * DAG),
      ingeklapt: !!o.archivedWeek, groep: o.originGroup || '',
      waarschuwingen,
    };
  });
  // Twee opdrachten met dezelfde postcode in hetzelfde kopje van dit rapport.
  // Alleen als BEIDE een klantnaam hebben en die verschillen, zijn het twee echte opdrachten
  // (twee units); een lege naam ("Onbekende klant") = mogelijk dezelfde klus (audit 16 okt).
  for (const it of items) {
    if (!it.postcode) continue;
    const zelfde = items.filter((x) => x !== it && x.cat === it.cat && x.postcode === it.postcode
      && !(it.naam && x.naam && it.naam.toLowerCase() !== x.naam.toLowerCase()));
    if (zelfde.length) it.waarschuwingen.push(`${it.postcode} staat ${zelfde.length + 1}× in dit rapport — dubbele opdracht? Meld hem maar één keer.`);
  }
  // Volgorde: kopjes in vaste volgorde, daarbinnen oudste eerst.
  const volg = DRS_KOPJES.map((k) => k.cat);
  items.sort((a, b) => volg.indexOf(a.cat) - volg.indexOf(b.cat) || String(a.sinds || '').localeCompare(String(b.sinds || '')));
  return { datum: vandaag, kop: datumKop(vandaag), kopjes: cats, items };
}
// Tekst in het vaste formaat van het dagrapport (WhatsApp-opmaak met *vet*).
export function rapportTekst(datum, regels) {
  const perCat = new Map();
  for (const r of regels) {
    if (!perCat.has(r.cat)) perCat.set(r.cat, []);
    perCat.get(r.cat).push(String(r.regel || '').replace(/\s*\n+\s*/g, ' ').trim());
  }
  const delen = [`*${datumKop(datum)}*`];
  for (const k of DRS_KOPJES) {
    const lijst = (perCat.get(k.cat) || []).filter(Boolean);
    if (!lijst.length) continue;
    delen.push(`*${k.label}:*\n\n${lijst.join('\n\n')}`);
  }
  return delen.join('\n\n');
}

// ---------- markeren ----------
// Vastleggen dat opdrachten gemeld zijn. Een opdracht die al als AFGEROND gemeld is wordt
// geweigerd (conflict) tenzij force — dat is precies de dubbele betaling die we voorkomen.
export function markeerGemeld({ items = [], datum, via = 'crm', door = '', rapportId = '', force = false, tekst = '' } = {}) {
  const dag = /^\d{4}-\d{2}-\d{2}$/.test(String(datum || '')) ? datum : nlDatum();
  const conflicten = []; const gemarkeerd = []; const regels = []; let alGemeld = 0;
  const ordersById = new Map(alleOpdrachten().map((o) => [o.id, o]));
  for (const it of items) {
    const o = ordersById.get(it.orderId);
    const cat = KOPJE_LABEL[it.cat] ? it.cat : null;
    if (!o || !cat) continue;
    const al = o.drsGemeld && o.drsGemeld[cat];
    // Zelfde dag al gemeld (bv. het rapport kwam via de groep al binnen vóór "Geplaatst —
    // vink af"): dat is hetzelfde rapport → stil overslaan, geen conflict (audit 16 okt).
    if (al && al.datum === dag && !force) { alGemeld++; continue; }
    if (al && cat === 'afgerond' && !force) {
      conflicten.push({ orderId: o.id, cat, titel: o.title || '', al: { datum: al.datum, door: al.door, via: al.via } });
      continue;
    }
    o.drsGemeld = { ...(o.drsGemeld || {}), [cat]: { at: now(), datum: dag, door, via, rapportId, regel: String(it.regel || '').slice(0, 300), ...(al ? { eerder: { datum: al.datum, door: al.door } } : {}) } };
    gemarkeerd.push({ orderId: o.id, cat });
    regels.push({ cat, orderId: o.id, tekst: String(it.regel || '').slice(0, 300), uitkomst: al ? 'opnieuw (bewust)' : 'gemeld' });
  }
  return { conflicten, gemarkeerd, regels, datum: dag, tekst, alGemeld };
}
// Rapport vastleggen in de geschiedenis (ook voor de controle van de DRS-factuur).
export function legRapportVast({ id: rid, datum, via, door, regels, tekst = '', bronId = '', groep = '' }) {
  return bewaarRapport({
    id: rid || id('drsr'), datum, at: now(), via, door, groep, bronId: bronId || undefined,
    tekst: String(tekst || '').slice(0, 4000), regels: (regels || []).slice(0, 200),
  });
}
// Eén rapport (of één opdracht) terugdraaien — voor vergissingen in het CRM.
export function maakOngedaan({ rapportId, orderId, cat } = {}) {
  let n = 0;
  for (const o of alleOpdrachten()) {
    if (!o.drsGemeld) continue;
    for (const c of Object.keys(o.drsGemeld)) {
      const g = o.drsGemeld[c];
      const raak = rapportId ? g.rapportId === rapportId : (o.id === orderId && c === cat);
      if (!raak) continue;
      delete o.drsGemeld[c]; n++;
    }
    if (!Object.keys(o.drsGemeld).length) delete o.drsGemeld;
  }
  if (rapportId) { const r = rapportenLijst().find((x) => x.id === rapportId); if (r) r.ongedaan = now(); }
  return n;
}

// ---------- VANGNET: ons eigen rapport uit de DRS-groep lezen ----------
// Kopje = het woord op een EIGEN regel (emoji/opsommingsteken ervoor mag), eventueel met
// "opdrachten"/"vandaag" erachter, gevolgd door ":" of een streepje of direct een postcode,
// of niets. ("Openen deur" of "afspraken morgen om 9" zijn géén kopjes.)
const KOP_WOORD = '(af\\s?ge?ro?n[dt]e?|afgehandeld|geannuleerd|annulering(?:en)?|offertes?|afspra(?:ak|ken)|ingepland|geen gehoor|niet gedaan|open(?:staand)?)';
const KOP_RE = new RegExp(`^[^A-Za-zÀ-ÿ0-9]*${KOP_WOORD}(?:\\s+(?:opdrachten|klussen|vandaag|gisteren|deze week))?\\s*(?::|[—–-]|(?=[1-9]\\d{3}\\s?[a-z]{2}(?![a-z]))|$)\\s*(.*)$`, 'i');
function catVanKop(woord) {
  const w = String(woord || '').toLowerCase().replace(/\s/g, '');
  if (/^afge?ro?n[dt]e?$|^afgehandeld$/.test(w)) return 'afgerond';
  if (/^geannuleerd$|^annulering/.test(w)) return 'geannuleerd';
  if (/^offerte/.test(w)) return 'offerte';
  if (/^afspra|^ingepland$/.test(w)) return 'afspraak';
  return null; // geen gehoor / open: geen DRS-kopje dat we bijhouden
}
// Leest een rapporttekst: datum uit de kop ("Dinsdag 13-10") en per kopje de postcodes.
// Onder een kopje telt een postcode overal in de regel ("North Ridge BV — 4879 NB
// Etten-Leur" mag ook). Een ANDER kopje-achtige regel ("Nog open:", "*Wacht op onderdelen*")
// sluit het vorige kopje af, zodat zulke regels nooit als afgerond tellen (audit 16 okt).
export function leesRapport(tekst, ontvangenOp = new Date()) {
  const ruw = String(tekst || '');
  const schoon = ruw.replace(/[*_~]/g, '');
  const ruweRegels = ruw.split(/\r?\n/);
  let datum = '';
  const ontvangenDag = nlDatum(ontvangenOp);
  const dm = schoon.match(/(?:^|\n)[^\S\n]*(?:maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)?[^\S\n]*(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?[^\S\n]*(?:\n|$)/i);
  if (dm) {
    const jaarOntv = Number(ontvangenDag.slice(0, 4));
    let jaar = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : jaarOntv;
    const mnd = Number(dm[2]); const dag = Number(dm[1]);
    if (mnd >= 1 && mnd <= 12 && dag >= 1 && dag <= 31) {
      // Rapport van eind december dat in januari binnenkomt: vorig jaar.
      if (!dm[3] && mnd === 12 && Number(ontvangenDag.slice(5, 7)) === 1) jaar -= 1;
      datum = `${jaar}-${String(mnd).padStart(2, '0')}-${String(dag).padStart(2, '0')}`;
    }
  }
  if (!datum) datum = ontvangenDag;
  const posten = [];
  let cat = null; let kopjes = 0;
  for (const ruweRegel of ruweRegels) {
    const r = ruweRegel.replace(/[*_~]/g, '');
    const k = r.match(KOP_RE);
    if (k) {
      cat = catVanKop(k[1]); kopjes++;
      const rest = k[2] || '';
      const pc = vindPostcode(rest);
      if (pc && cat) posten.push({ cat, postcode: pc, tekst: rest.trim() });
      continue;
    }
    const pc = vindPostcode(r);
    if (!pc) {
      // Kopje-achtig (eindigt op ":" of is een *vette* regel) maar geen bekend kopje → sluit af.
      if (/^[^\d]{2,50}:\s*$/.test(r.trim()) || (/^\s*\*[^*]+\*\s*$/.test(ruweRegel) && !/\d{1,2}[-/.]\d{1,2}/.test(r))) cat = null;
      continue;
    }
    if (!cat) continue;
    posten.push({ cat, postcode: pc, tekst: r.trim().replace(/^[-•·]\s*/, '').replace(/^\d{1,2}[.)]\s+/, '') });
  }
  return { datum, posten, kopjes };
}
// Is dit bericht een rapport? Minstens één bekend kopje met een postcode eronder, en géén
// opdracht-velden (Naam:/Adres:/Telefoon:/Woonplaats: — een DRS-opdracht heeft die altijd).
export function lijktDrsRapport(tekst) {
  const ruw = String(tekst || '');
  if (/^\s*\*?(naam|naam klant|klant|adres|adres klant|telefoon|telefoonnummer|telefoon ?nr|tel|tel\.|telnr|mobiel|woonplaats)\*?\s*[:=]/im.test(ruw)) return false;
  const { posten, kopjes } = leesRapport(ruw);
  return kopjes >= 1 && posten.length >= 1;
}
// Komt het bericht van ons? Alleen dan vinkt het vangnet af (audit 16 okt: een DRS-
// medewerker die "Afgerond: 5146 BE graag factuur" schrijft, vinkte anders onze opdracht af
// en kon een vals dubbel-alarm geven). Standaard: naam bevat "Key service"/"Keyservice", de
// namen van de kantoor-accounts, plus wat er in de instellingen staat.
export function afzenderVanOns(sender) {
  const s = String(sender || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return true; // onbekende afzender (oude route / test): niet blokkeren
  const heelWoord = (x) => new RegExp(`(^|[^a-zà-ÿ0-9])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-zà-ÿ0-9]|$)`).test(s);
  // Expliciet ingesteld of "key service" in de naam: telt altijd.
  const expliciet = ['key service', 'keyservice', ...getDrsRapportInstellingen().afzenders.map((x) => x.toLowerCase())].filter((x) => x.length >= 3);
  if (expliciet.some((x) => heelWoord(x))) return true;
  // Iemand met "DRS" als los woord in de naam (bv. "Shemara DRS") is van DRS, niet van ons.
  if (heelWoord('drs')) return false;
  // Namen van de kantoor-accounts: alleen als HEEL woord ("Ali" telt niet in "Natalie").
  for (const u of db().users || []) {
    if (!['admin', 'assistent'].includes(u.role) || !u.name) continue;
    const n = String(u.name).toLowerCase().replace(/\s+/g, ' ').trim();
    if (n.length < 3 || /^(beheerder|admin|assistente?)$/.test(n)) continue;
    if (heelWoord(n) || (n.split(' ')[0].length >= 3 && heelWoord(n.split(' ')[0]))) return true;
  }
  return false;
}

const dubbelUitleg = (d) => `${toonPostcode(d.postcode)}${d.plaats ? ' ' + d.plaats : ''} (${d.zelfdeRapport ? 'staat twee keer in hetzelfde rapport' : d.zelfdeDagNogmaals ? 'vandaag al in een ander bericht in de groep gemeld' : d.mogelijk ? `tweede opdracht op dit adres, eerder gemeld op ${korteDatum(d.eerder)}` : `eerder gemeld op ${korteDatum(d.eerder)}`})`;
function meldDubbel(dubbels, datum) {
  if (!dubbels.length) return;
  const tekst = dubbels.map(dubbelUitleg).join(', ');
  logActivity('systeem', 'DRS: DUBBEL als afgerond gemeld', `${korteDatum(datum)}: ${tekst}`);
  const lijst = (db().settings._drsAlarmen = Array.isArray(db().settings._drsAlarmen) ? db().settings._drsAlarmen : []);
  for (const d of dubbels) lijst.unshift({ id: id('drsa'), at: now(), datum, postcode: toonPostcode(d.postcode), plaats: d.plaats || '', orderId: d.orderId || '', eerder: d.eerder, uitleg: dubbelUitleg(d), mogelijk: !!d.mogelijk, afgehandeld: null });
  if (lijst.length > 100) lijst.length = 100;
  import('./push.js').then(({ sendPush }) => sendPush({
    title: 'Let op: dubbel gemeld aan DRS',
    body: `${tekst} staat opnieuw als AFGEROND in het rapport. Laat DRS weten dat het om één opdracht gaat, anders betaal je twee keer.`,
    url: '/?drsrapport=1',
  })).catch(() => {});
}

// Verwerkt een bericht uit een opdracht-groep dat op ons rapport lijkt. Vinkt opdrachten
// af en geeft per postcode een uitkomst. `stil` = geen push (eenmalige inhaalslag).
export function verwerkEigenDrsRapport({ body, group, receivedAt, messageId, sender = '', herhaling = false } = {}, { stil = false } = {}) {
  if (!group || !isWhatsappOrderGroup(group)) return null;
  // Lege instelling betekent "alle groepen zijn opdracht-groep" — dan zou het rapport van de
  // monteur in zijn eigen groep als melding aan DRS tellen. Alleen met een ingestelde groep.
  if (!getWhatsappOrderGroups().length) return null;
  if (!lijktDrsRapport(body)) return null;
  if (messageId && rapportenLijst().some((r) => r.bronId === messageId)) return null; // al verwerkt
  const ontvangen = receivedAt ? new Date(receivedAt) : new Date();
  const gelezen = leesRapport(body, ontvangen);
  const posten = gelezen.posten;
  if (!posten.length) return null;
  // OUDE KOP LATEN STAAN (audit 16 okt): rapport van dinsdag gekopieerd en donderdag
  // aangevuld zonder de kop aan te passen → de kop zegt 13-10, DRS krijgt het op 15-10.
  // Meer dan een dag ouder dan het plaatsen = de dag van plaatsen telt (en dubbels vallen op).
  const ontvangenDag = nlDatum(ontvangen);
  let datum = gelezen.datum; let kopDatum = '';
  if (datum && (Date.parse(ontvangenDag) - Date.parse(datum)) > DAG) { kopDatum = datum; datum = ontvangenDag; }
  // Kop in de toekomst (tikfout "14-11" i.p.v. "14-10"): de dag van plaatsen telt.
  if (datum && datum > ontvangenDag) { kopDatum = datum; datum = ontvangenDag; }
  // Niet van ons (bv. een DRS-medewerker met een eigen lijstje)? Alleen vastleggen ter
  // informatie — nooit afvinken, nooit een alarm.
  if (!afzenderVanOns(sender)) {
    const info = bewaarRapport({ id: id('drsr'), datum, at: now(), via: 'groep', door: sender || '', groep: group, bronId: messageId || undefined, tekst: String(body || '').slice(0, 4000), vreemdeAfzender: true,
      regels: posten.map((p) => ({ cat: p.cat, postcode: toonPostcode(p.postcode), tekst: p.tekst.slice(0, 300), uitkomst: 'niet meegeteld (andere afzender)' })) });
    if (!stil) logActivity('systeem', 'DRS: lijstje van een andere afzender niet meegeteld', `${sender}: ${posten.length} postcode(s) — staat deze naam bij Instellingen → DRS-rapport, dan telt het wél`);
    saveSoon();
    return info;
  }
  // Alleen kaarten die er al WAREN toen het rapport binnenkwam (een rapport gaat nooit over
  // een later aangemaakte kaart — belangrijk bij het terugkijken door de eenmalige start).
  const grensMs = ontvangen.getTime() + 3600000;
  const bestond = (o) => !o.createdAt || new Date(o.createdAt).getTime() <= grensMs;
  const drs = alleOpdrachten().filter((o) => isDrsOrder(o) && bestond(o));
  const perPc = new Map();
  for (const o of drs) { const pc = postcodeVanOrder(o); if (pc) { if (!perPc.has(pc)) perPc.set(pc, []); perPc.get(pc).push(o); } }
  const prullenbakPerPc = new Map();
  for (const o of prullenbakGemeld()) { const pc = postcodeVanOrder(o); if (pc) { if (!prullenbakPerPc.has(pc)) prullenbakPerPc.set(pc, []); prullenbakPerPc.get(pc).push(o); } }
  const regels = []; const dubbels = []; const rapportId = id('drsr');
  // Per kopje+postcode: welke kaarten zijn in DIT rapport al "gebruikt"?
  const gebruikt = new Map();
  // Twee échte opdrachten op hetzelfde adres (bv. twee units)? Dan beslist de naam in de
  // regel ("4880 AB Etten-Leur — Jansen") welke bedoeld wordt (audit 16 okt).
  const naamWoorden = (o) => naamVanOrder(o).toLowerCase().split(/[^a-zà-ÿ0-9]+/).filter((w) => w.length >= 4);
  // Stond deze postcode (dit kopje) al in een ÁNDER groepsbericht van ons? (Lijstjes van
  // andere afzenders tellen nooit mee.) Optioneel alleen op één datum.
  const eerderInGroep = (p, opDatum) => rapportenLijst().some((r) => r.via === 'groep' && !r.vreemdeAfzender && r.id !== rapportId && !r.ongedaan && (!opDatum || r.datum === opDatum)
    && (r.regels || []).some((x) => x.cat === p.cat && x.postcode === toonPostcode(p.postcode) && x.uitkomst !== 'onbekend' && !/andere afzender/.test(x.uitkomst || '')));
  const eerderVandaagInGroep = (p) => eerderInGroep(p, datum);
  // "Zelfde rapport": gemeld op de dag van dit rapport, óf op de (oude) kopdatum ervan zolang
  // die regel nog nooit in de groep stond (kop in het CRM teruggezet en later geplaatst). Stond
  // hij er wél al, dan is het een gekopieerd oud rapport = dubbel (audit + review 16 okt).
  const zelfdeRapportDatum = (g, p) => g && (g.datum === datum || (kopDatum && g.datum === kopDatum && !eerderInGroep(p)));
  const VENSTER = 45 * DAG; // ouder gemeld = geen dubbel meer (terugkerend adres, nieuwe klus)
  // "Aangenomen" (bij de start als gemeld verondersteld, nooit echt gezien) geeft nooit een alarm.
  const binnenVenster = (g) => g && g.via !== 'aangenomen' && g.datum < datum && (Date.parse(datum) - Date.parse(g.datum)) <= VENSTER;
  const dubbelVan = (p, o, eerder, extra = {}) => dubbels.push({ postcode: p.postcode, plaats: plaatsVanOrder(o || {}), eerder, orderId: (o && o.id) || '', ...extra });
  for (const p of posten) {
    let kandidaten = perPc.get(p.postcode) || [];
    const opNaam = kandidaten.length > 1 ? kandidaten.filter((o) => naamWoorden(o).some((w) => p.tekst.toLowerCase().includes(w))) : [];
    if (opNaam.length === 1) kandidaten = opNaam;
    const regel = { cat: p.cat, postcode: toonPostcode(p.postcode), tekst: p.tekst.slice(0, 300) };
    const gk = `${p.cat}|${p.postcode}`;
    const alGebruikt = gebruikt.get(gk) || new Set();
    // Al eerder in DIT rapport en niet op naam naar een ándere kaart → twee keer in het rapport.
    if (alGebruikt.size && !(opNaam.length === 1 && !alGebruikt.has(opNaam[0].id))) {
      regel.uitkomst = p.cat === 'afgerond' ? 'dubbel' : 'twee keer in dit rapport';
      if (p.cat === 'afgerond') dubbelVan(p, kandidaten[0], datum, { zelfdeRapport: true });
      regels.push(regel); continue;
    }
    const gebruik = (o) => { alGebruikt.add(o ? o.id : `x${regels.length}`); gebruikt.set(gk, alGebruikt); };
    if (!kandidaten.length) {
      const weg = (prullenbakPerPc.get(p.postcode) || []).filter((o) => binnenVenster(o.drsGemeld[p.cat]));
      if (p.cat === 'afgerond' && weg.length) {
        regel.uitkomst = 'dubbel'; regel.eerder = weg[0].drsGemeld.afgerond.datum;
        dubbelVan(p, weg[0], regel.eerder); regel.orderId = undefined;
      } else regel.uitkomst = 'onbekend';
      gebruik(null); regels.push(regel); continue;
    }
    const gemeldK = kandidaten.filter((o) => o.drsGemeld && o.drsGemeld[p.cat]);
    const zelfdeDag = gemeldK.filter((o) => zelfdeRapportDatum(o.drsGemeld[p.cat], p));
    const open = kandidaten.filter((o) => !(o.drsGemeld && o.drsGemeld[p.cat]));
    const opStatus = open.filter((o) => catVanStatus(o.status) === p.cat);
    // 1) Al gemeld met de datum van dit rapport (bv. eerst "Geplaatst — vink af" in het CRM,
    //    daarna komt het rapport via de groep binnen) → dat is DEZE regel. Nooit een andere
    //    open kaart op hetzelfde adres afvinken (audit 16 okt: dan telde de maandtelling 2).
    //    Wél dubbel als het vandaag al in een ánder groepsbericht stond of herhaald is.
    if (zelfdeDag.length && !(opStatus.length && opNaam.length === 1 && !zelfdeDag.includes(opNaam[0]))) {
      const o = zelfdeDag[0]; regel.orderId = o.id; gebruik(o);
      if (p.cat === 'afgerond' && (eerderVandaagInGroep(p) || herhaling)) {
        regel.uitkomst = 'dubbel'; regel.eerder = datum;
        dubbelVan(p, o, datum, { zelfdeDagNogmaals: true });
      } else regel.uitkomst = 'al gemeld (zelfde rapport)';
      regels.push(regel); continue;
    }
    // 2) Kiezen: een open kaart die in het CRM óók op dit kopje staat. Een open kaart met een
    //    ANDERE status (oud geannuleerd, lopend) alleen als er op dit adres niets anders is.
    let keuze = null;
    if (opStatus.length === 1) keuze = opStatus[0];
    else if (opStatus.length > 1) { regel.uitkomst = 'meerdere opdrachten'; regel.kandidaten = opStatus.slice(0, 5).map((o) => o.id); gebruik(null); regels.push(regel); continue; }
    else if (!gemeldK.length && open.length === 1) keuze = open[0];
    else if (!gemeldK.length && open.length > 1) { regel.uitkomst = 'meerdere opdrachten'; regel.kandidaten = open.slice(0, 5).map((o) => o.id); gebruik(null); regels.push(regel); continue; }
    if (!keuze) {
      // 3) Alles op dit adres is al gemeld (op een eerdere dag): de NIEUWSTE melding telt.
      const laatste = gemeldK.map((o) => ({ o, g: o.drsGemeld[p.cat] })).sort((a, b) => String(b.g.datum).localeCompare(String(a.g.datum)))[0];
      regel.orderId = laatste.o.id; regel.eerder = laatste.g.datum; gebruik(laatste.o);
      if (p.cat === 'afgerond' && binnenVenster(laatste.g)) {
        regel.uitkomst = 'dubbel';
        dubbelVan(p, laatste.o, laatste.g.datum);
      } else regel.uitkomst = laatste.g.via === 'aangenomen' ? 'al als gemeld aangenomen (van vóór het DRS-rapport)' : laatste.g.datum < datum ? 'al eerder gemeld (lang geleden — nieuwe klus? vink hem zelf af)' : 'al eerder gemeld';
      regels.push(regel); continue;
    }
    const r = markeerGemeld({ items: [{ orderId: keuze.id, cat: p.cat, regel: p.tekst }], datum, via: 'groep', door: sender || 'rapport in de DRS-groep', rapportId });
    regel.orderId = keuze.id; gebruik(keuze);
    regel.uitkomst = r.gemarkeerd.length ? (catVanStatus(keuze.status) === p.cat ? 'gemeld' : 'gemeld (status in CRM wijkt af)') : 'al gemeld';
    if (catVanStatus(keuze.status) !== p.cat) regel.crmStatus = keuze.status;
    // Tweede KAART op dezelfde postcode die kort geleden al als afgerond is gemeld: waarschijnlijk
    // dezelfde klus dubbel in het CRM (bv. twee keer doorgestuurd) → ook dan alarm.
    if (p.cat === 'afgerond') {
      const kortGeleden = [...kandidaten, ...(prullenbakPerPc.get(p.postcode) || [])].filter((o) => o.id !== keuze.id && o.drsGemeld && o.drsGemeld.afgerond && o.drsGemeld.afgerond.via !== 'aangenomen' && o.drsGemeld.afgerond.datum < datum
        && (Date.parse(datum) - Date.parse(o.drsGemeld.afgerond.datum)) <= 14 * DAG);
      if (kortGeleden.length) {
        regel.uitkomst = 'gemeld — mogelijk dubbel';
        regel.eerder = kortGeleden[0].drsGemeld.afgerond.datum;
        dubbelVan(p, keuze, regel.eerder, { mogelijk: true });
      }
    }
    regels.push(regel);
  }
  const rapport = bewaarRapport({ id: rapportId, datum, at: now(), via: 'groep', door: sender || '', groep: group, bronId: messageId || undefined, tekst: String(body || '').slice(0, 4000), regels, ...(kopDatum ? { kopDatum } : {}), ...(herhaling ? { herhaling: true } : {}) });
  if (dubbels.length) {
    rapport.dubbel = dubbels.length;
    if (!stil) meldDubbel(dubbels, datum);
    else {
      logActivity('systeem', 'DRS: dubbel gemeld gevonden (terugkijken)', `${korteDatum(datum)}: ${dubbels.map(dubbelUitleg).join(', ')}`);
      // Wel zichtbaar maken in het DRS-scherm (zonder push): bewijs uit het verleden.
      const lijst = (db().settings._drsAlarmen = Array.isArray(db().settings._drsAlarmen) ? db().settings._drsAlarmen : []);
      for (const d of dubbels) lijst.unshift({ id: id('drsa'), at: now(), datum, postcode: toonPostcode(d.postcode), plaats: d.plaats || '', orderId: d.orderId || '', eerder: d.eerder, uitleg: dubbelUitleg(d), mogelijk: !!d.mogelijk, terugkijken: true, afgehandeld: null });
      if (lijst.length > 100) lijst.length = 100;
    }
  }
  const gemeld = regels.filter((r) => /^gemeld/.test(r.uitkomst || '')).length;
  if (!stil) logActivity('systeem', 'DRS-rapport uit de groep gelezen', `${korteDatum(datum)}: ${gemeld} afgevinkt${dubbels.length ? `, ${dubbels.length} DUBBEL` : ''}${regels.some((r) => r.uitkomst === 'onbekend') ? ', onbekende postcode(s)' : ''}`);
  saveSoon();
  return rapport;
}

// ---------- eenmalige start (bestaande opdrachten) ----------
// 1) Lees alle rapporten die al in de DRS-groep stonden (berichten van de laatste 60
//    dagen, oudste eerst) → opdrachten afvinken, dubbels uit het verleden zichtbaar.
// 2) Wat daarna nog open staat en ouder is dan 7 dagen: als "gemeld (aangenomen)"
//    markeren, zodat het rapport niet start met tientallen oude opdrachten.
export function drsStartMigratie({ nu = Date.now() } = {}) {
  const s = db().settings;
  if (s._drsGemeldV1) return null;
  const berichten = (db().messages || [])
    .filter((m) => m && m.channel === 'whatsapp' && m.group && isWhatsappOrderGroup(m.group) && (nu - new Date(m.receivedAt || 0).getTime()) < 60 * DAG)
    .sort((a, b) => String(a.receivedAt || '').localeCompare(String(b.receivedAt || '')));
  let gelezen = 0; let dubbel = 0;
  for (const m of berichten) {
    const r = verwerkEigenDrsRapport({ body: m.body, group: m.group, receivedAt: m.receivedAt, messageId: m.id, sender: m.sender }, { stil: true });
    if (r) { gelezen++; dubbel += r.dubbel || 0; }
  }
  let aangenomen = 0;
  for (const o of alleOpdrachten()) {
    if (!isDrsOrder(o)) continue;
    const cat = catVanStatus(o.status);
    if (!cat || (o.drsGemeld && o.drsGemeld[cat])) continue;
    const sinds = sindsVan(o, cat);
    if (!sinds || nu - new Date(sinds).getTime() > 7 * DAG) {
      o.drsGemeld = { ...(o.drsGemeld || {}), [cat]: { at: now(), datum: sinds ? nlDatum(new Date(sinds)) : nlDatum(new Date(nu)), door: 'systeem', via: 'aangenomen', regel: '' } };
      aangenomen++;
    }
  }
  s._drsGemeldV1 = { at: now(), gelezen, dubbel, aangenomen };
  logActivity('systeem', 'DRS-rapport ingericht', `${gelezen} rapport(en) uit de groep gelezen, ${aangenomen} oude opdracht(en) als gemeld aangenomen${dubbel ? `, ${dubbel} dubbele melding(en) uit het verleden gevonden` : ''}`);
  saveSoon();
  return s._drsGemeldV1;
}

// ---------- avondherinnering ----------
// Eén keer per avond (instelbaar uur, NL-tijd): staan er nog DRS-opdrachten van vandaag
// of eerder open om te melden, dan een melding naar kantoor met een directe link.
export function drsHerinneringVerschuldigd({ nu = new Date() } = {}) {
  const cfg = getDrsRapportInstellingen();
  if (!cfg.herinnering) return null;
  const uur = Number(nu.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hour12: false })) % 24;
  if (uur < cfg.herinneringUur) return null;
  const dag = nlDatum(nu);
  if (db().settings._drsHerinneringDag === dag) return null;
  const open = nogTeMelden({ kopjes: cfg.kopjes, dagen: 7, nu: nu.getTime() });
  return { dag, aantal: open.length, afgerond: open.filter((o) => o.status === 'afgerond').length };
}
export async function runDrsHerinnering({ nu = new Date() } = {}) {
  const v = drsHerinneringVerschuldigd({ nu });
  if (!v) return null;
  db().settings._drsHerinneringDag = v.dag;
  saveSoon();
  if (!v.aantal) return { ...v, verstuurd: false };
  const { sendPush } = await import('./push.js');
  await sendPush({ title: 'DRS-rapport klaar om te versturen', body: `${v.aantal} DRS-opdracht(en) nog niet gemeld${v.afgerond ? ` (${v.afgerond} afgerond)` : ''}. Tik om het rapport te openen en te kopiëren.`, url: '/?drsrapport=1' }).catch(() => {});
  return { ...v, verstuurd: true };
}

// ---------- overzicht voor de controle van de DRS-factuur ----------
export function drsMaandOverzicht({ maand } = {}) {
  const m = /^\d{4}-\d{2}$/.test(String(maand || '')) ? maand : nlDatum().slice(0, 7);
  const rijen = [];
  for (const o of alleOpdrachten()) {
    const g = o.drsGemeld && o.drsGemeld.afgerond;
    if (!g || g.via === 'aangenomen' || !String(g.datum || '').startsWith(m)) continue;
    rijen.push({ orderId: o.id, datum: g.datum, regel: g.regel || regelVoor(o, 'afgerond'), via: g.via, door: g.door, titel: o.title || '' });
  }
  rijen.sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
  return { maand: m, afgerond: rijen.length, rijen };
}

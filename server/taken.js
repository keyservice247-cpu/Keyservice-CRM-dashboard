// TAKEN-MODULE (8 sep 2026) — handmatig takenbeheer voor Abdel en de assistentes.
//
// BEWUST ZONDER AI en ZONDER koppeling aan de lead-instroom: taken ontstaan alleen
// doordat iemand ze intypt. Puur deterministisch. Privé-taken zijn uitsluitend
// zichtbaar voor wie ze aanmaakte; zakelijke taken ziet het hele kantoor
// (admin + assistent) en zijn te filteren op "toegewezen aan mij".
import { db, id, now, saveSoon, logActivity } from './db.js';

export const CATEGORIEEN = ['zakelijk', 'prive'];
export const URGENTIES = ['hoog', 'middel', 'laag'];
export const DUREN = ['kort', 'middel', 'lang'];
export const STATUSSEN = ['open', 'bezig', 'klaar'];

export function takenLijst() {
  if (!Array.isArray(db().taken)) db().taken = [];
  return db().taken;
}

const kies = (v, lijst, standaard) => (lijst.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : standaard);
const datum = (v) => { const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; };
const namen = (v) => (Array.isArray(v) ? v : String(v || '').split(/[+,]/)).map((s) => String(s).trim()).filter(Boolean).slice(0, 6);

// Dagen tot een deadline, geteld op kalenderdagen (Europe/Amsterdam-lokaal via de
// server-klok; negatief = verlopen).
export function dagenTot(deadline) {
  const d = datum(deadline);
  if (!d) return null;
  const vandaag = new Date(); vandaag.setHours(0, 0, 0, 0);
  const [y, m, dd] = d.split('-').map(Number);
  const doel = new Date(y, m - 1, dd);
  return Math.round((doel.getTime() - vandaag.getTime()) / 86400000);
}

// Privé-taak: eigenaar ziet 'm altijd; OPTIONEEL gedeeld met gekozen collega's
// (gedeeldMet = lijst gebruikers-id's, alleen door de eigenaar te zetten). Een
// gedeelde privé-taak mag de collega gewoon overnemen (bewerken/afvinken), maar
// niet verwijderen of verder delen.
export function zichtbaarVoor(t, user) {
  if (!user) return false;
  if (!['admin', 'assistent'].includes(user.role)) return false;
  if (t.categorie === 'prive') return t.eigenaarId === user.id || (t.gedeeldMet || []).includes(user.id);
  return true;
}
export const isEigenaar = (t, user) => !!user && t.eigenaarId === user.id;
// Collega's waarmee gedeeld kan worden: kantoor (admin + assistent), nooit jezelf.
export function collegas(user) {
  return (db().users || []).filter((u) => ['admin', 'assistent'].includes(u.role) && u.id !== user?.id && !u.disabled)
    .map((u) => ({ id: u.id, name: u.name || u.email || '', role: u.role }));
}
const idLijst = (v, user) => {
  const geldig = new Set(collegas(user).map((c) => c.id));
  return (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter((x) => geldig.has(x)).slice(0, 20);
};
const naamVanUser = (uid) => { const u = (db().users || []).find((x) => x.id === uid); return u ? (u.name || u.email || '') : ''; };
export const gedeeldMetNamen = (t) => (t.gedeeldMet || []).map(naamVanUser).filter(Boolean);

// "Toegewezen aan mij": op naam (voornaam volstaat) of op gebruikers-id.
export function aanMij(t, user) {
  const voornaam = String(user?.name || '').trim().split(/\s+/)[0].toLowerCase();
  return (t.toegewezen || []).some((n) => String(n).toLowerCase() === (user?.id || '').toLowerCase()
    || (voornaam && String(n).trim().split(/\s+/)[0].toLowerCase() === voornaam));
}

export function nieuweTaak(body, user) {
  const b = body || {};
  const titel = String(b.titel || '').trim().slice(0, 160);
  if (!titel) throw Object.assign(new Error('Vul een titel in'), { status: 400 });
  return {
    id: id('taak'),
    titel,
    omschrijving: String(b.omschrijving || '').trim().slice(0, 2000),
    categorie: kies(b.categorie, CATEGORIEEN, 'zakelijk'),
    urgentie: kies(b.urgentie, URGENTIES, 'middel'),
    duur: kies(b.duur, DUREN, 'middel'),
    deadline: datum(b.deadline),
    toegewezen: namen(b.toegewezen).length ? namen(b.toegewezen) : [String(user.name || '').trim().split(/\s+/)[0] || 'ik'],
    status: kies(b.status, STATUSSEN, 'open'),
    orderId: b.orderId ? String(b.orderId) : null,
    customerId: b.customerId ? String(b.customerId) : null,
    notities: String(b.notities || '').trim().slice(0, 4000),
    gedeeldMet: idLijst(b.gedeeldMet, user),
    bijlagen: [],
    volgorde: null,
    eigenaarId: user.id,
    eigenaarNaam: user.name || '',
    aangemaaktOp: now(),
    afgerondOp: null,
  };
}

export function werkTaakBij(t, body, user) {
  const b = body || {};
  // Delen alleen door de eigenaar; een collega die de taak overneemt kan de kring niet wijzigen.
  if ('gedeeldMet' in b && isEigenaar(t, user)) t.gedeeldMet = idLijst(b.gedeeldMet, user);
  if ('titel' in b) { const v = String(b.titel || '').trim().slice(0, 160); if (!v) throw Object.assign(new Error('Titel mag niet leeg zijn'), { status: 400 }); t.titel = v; }
  if ('omschrijving' in b) t.omschrijving = String(b.omschrijving || '').trim().slice(0, 2000);
  if ('categorie' in b) t.categorie = kies(b.categorie, CATEGORIEEN, t.categorie);
  if ('urgentie' in b) t.urgentie = kies(b.urgentie, URGENTIES, t.urgentie);
  if ('duur' in b) t.duur = kies(b.duur, DUREN, t.duur);
  if ('deadline' in b) t.deadline = datum(b.deadline);
  if ('toegewezen' in b) t.toegewezen = namen(b.toegewezen);
  if ('orderId' in b) t.orderId = b.orderId ? String(b.orderId) : null;
  if ('customerId' in b) t.customerId = b.customerId ? String(b.customerId) : null;
  if ('notities' in b) t.notities = String(b.notities || '').trim().slice(0, 4000);
  if ('volgorde' in b) t.volgorde = Number.isFinite(Number(b.volgorde)) && b.volgorde !== null ? Number(b.volgorde) : null;
  if ('status' in b) zetStatus(t, kies(b.status, STATUSSEN, t.status));
  return t;
}

export function zetStatus(t, status) {
  t.status = status;
  t.afgerondOp = status === 'klaar' ? (t.afgerondOp || now()) : null;
  return t;
}

// Sorteren: afgerond altijd onderaan. Daarbinnen per modus:
//   slim (standaard): urgentie (hoog→laag), dan deadline (dichtstbij eerst)
//   handmatig: eigen volgorde (t.volgorde, gezet door slepen), rest daarna op slim
//   deadline: dichtstbijzijnde deadline eerst (zonder deadline achteraan), dan urgentie
//   nieuw: nieuwste eerst
const URG_RANG = { hoog: 0, middel: 1, laag: 2 };
export const SORTEER_MODI = ['slim', 'handmatig', 'deadline', 'nieuw'];
export function sorteerTaken(lijst, modus = 'slim') {
  const m = SORTEER_MODI.includes(modus) ? modus : 'slim';
  const slim = (a, b) => {
    const da = a.deadline ? dagenTot(a.deadline) : 9999; const dbb = b.deadline ? dagenTot(b.deadline) : 9999;
    if ((URG_RANG[a.urgentie] ?? 1) !== (URG_RANG[b.urgentie] ?? 1)) return (URG_RANG[a.urgentie] ?? 1) - (URG_RANG[b.urgentie] ?? 1);
    if (da !== dbb) return da - dbb;
    return String(a.aangemaaktOp || '').localeCompare(String(b.aangemaaktOp || ''));
  };
  return lijst.slice().sort((a, b) => {
    const ka = a.status === 'klaar' ? 1 : 0; const kb = b.status === 'klaar' ? 1 : 0;
    if (ka !== kb) return ka - kb;
    if (ka) return String(b.afgerondOp || '').localeCompare(String(a.afgerondOp || ''));
    if (m === 'handmatig') {
      const va = Number.isFinite(a.volgorde) ? a.volgorde : Infinity; const vb = Number.isFinite(b.volgorde) ? b.volgorde : Infinity;
      if (va !== vb) return va - vb;
      return slim(a, b);
    }
    if (m === 'deadline') {
      const da = a.deadline ? dagenTot(a.deadline) : 9999; const dbb = b.deadline ? dagenTot(b.deadline) : 9999;
      if (da !== dbb) return da - dbb;
      return slim(a, b);
    }
    if (m === 'nieuw') return String(b.aangemaaktOp || '').localeCompare(String(a.aangemaaktOp || ''));
    return slim(a, b);
  });
}

// Eigen volgorde na slepen: de meegegeven id's (in de gewenste volgorde) krijgen
// volgorde 10, 20, 30 … — alleen taken die deze gebruiker mag zien.
export function zetVolgorde(ids, user) {
  const lijst = takenLijst();
  let n = 0;
  (Array.isArray(ids) ? ids : []).slice(0, 500).forEach((id, i) => {
    const t = lijst.find((x) => x.id === id);
    if (t && zichtbaarVoor(t, user)) { t.volgorde = (i + 1) * 10; n++; }
  });
  return n;
}

export function filterTaken(lijst, q, user) {
  let uit = lijst;
  if (q.categorie && CATEGORIEEN.includes(q.categorie)) uit = uit.filter((t) => t.categorie === q.categorie);
  if (q.urgentie && URGENTIES.includes(q.urgentie)) uit = uit.filter((t) => t.urgentie === q.urgentie);
  if (q.duur && DUREN.includes(q.duur)) uit = uit.filter((t) => t.duur === q.duur);
  if (q.status && STATUSSEN.includes(q.status)) uit = uit.filter((t) => t.status === q.status);
  if (q.mij === '1' || q.mij === 'true') uit = uit.filter((t) => aanMij(t, user));
  return uit;
}

// "Vandaag"-blok op Start: urgent en/of deadline binnen 14 dagen, max N.
export function vandaagLijst(user, max = 5) {
  const open = takenLijst().filter((t) => t.status !== 'klaar' && zichtbaarVoor(t, user));
  const verrijkt = open.map((t) => ({ ...t, dagen: dagenTot(t.deadline) }))
    .filter((t) => t.urgentie === 'hoog' || (t.dagen !== null && t.dagen <= 14));
  verrijkt.sort((a, b) => {
    const ra = a.dagen !== null && a.dagen <= 3 ? 0 : (URG_RANG[a.urgentie] ?? 1) + 1;
    const rb = b.dagen !== null && b.dagen <= 3 ? 0 : (URG_RANG[b.urgentie] ?? 1) + 1;
    if (ra !== rb) return ra - rb;
    return (a.dagen ?? 9999) - (b.dagen ?? 9999);
  });
  return verrijkt.slice(0, max);
}

// Starttaken uit het voorbeeld (taken-dashboard.html, 8 sep 2026) — één keer inladen.
export function seedTaken() {
  const s = db().settings;
  if (s._takenSeedV1) return 0;
  const lijst = takenLijst();
  if (lijst.length) { s._takenSeedV1 = now(); saveSoon(); return 0; }
  const admin = (db().users || []).find((u) => u.role === 'admin') || { id: 'admin', name: 'Abdel' };
  const mk = (t) => ({
    id: id('taak'), omschrijving: '', deadline: null, status: 'open', orderId: null, customerId: null, notities: '', gedeeldMet: [], bijlagen: [],
    eigenaarId: admin.id, eigenaarNaam: admin.name || 'Abdel', aangemaaktOp: now(), afgerondOp: null, ...t,
  });
  lijst.push(
    mk({ titel: 'Afspraken met Youssef vastleggen vanaf 1 november', omschrijving: 'Als Youssef blijft: omzet blijft 50/50, per opdracht €35 — óók voor offertes. Nu regelen, niet wachten tot oktober. (DRS-prijsverhoging voor klanten gaat in op 1 november.)', categorie: 'zakelijk', urgentie: 'hoog', duur: 'kort', deadline: '2026-11-01', toegewezen: ['Abdel'] }),
    mk({ titel: 'Schuifpui-monteurs (ZZP) binnenhalen', omschrijving: 'Gedelegeerd aan Ouiam, maar zelf ook keihard erachteraan: iedereen benaderen die je kent.', categorie: 'zakelijk', urgentie: 'hoog', duur: 'lang', toegewezen: ['Ouiam', 'Abdel'] }),
    mk({ titel: 'Gesprek met Roger voorbereiden', omschrijving: 'Alle punten van Amal verzamelen + eigen punten uit notities. Eén lijst, op prioriteit.', categorie: 'zakelijk', urgentie: 'hoog', duur: 'middel', toegewezen: ['Abdel'] }),
    mk({ titel: 'Nieuwe assistente zoeken — plan maken', omschrijving: 'Waar vind je de juiste persoon? Kanalen bepalen (netwerk, moskee-gemeenschap, LinkedIn, Indeed), scorecard uit Who-methode gebruiken.', categorie: 'zakelijk', urgentie: 'hoog', duur: 'lang', toegewezen: ['Abdel'] }),
    mk({ titel: 'Ads starten op ChatGPT — sloten én schuifpuien', omschrijving: "Twee campagnes opzetten. Landingspagina's eerst klaar (zie ADS-LANDINGSPAGINA-prompt).", categorie: 'zakelijk', urgentie: 'middel', duur: 'middel', toegewezen: ['Abdel', 'Dennis'] }),
    mk({ titel: 'SEO knallen: backlinks investeren', omschrijving: 'Bouwmagazines, VvE-platforms en bouwsites benaderen. Premium plaatsingen via Backlink.nl (DR 25+). Doel: 3–5 per maand.', categorie: 'zakelijk', urgentie: 'middel', duur: 'lang', toegewezen: ['Abdel'] }),
    mk({ titel: 'Tuinman regelen voor de tuin', omschrijving: 'Bellen, prijs vragen, datum plannen.', categorie: 'prive', urgentie: 'middel', duur: 'kort', toegewezen: ['Abdel'] }),
    mk({ titel: 'Tanger stad/markt — spullen voor de buren', omschrijving: 'Olijvenzeep en rozenwater.', categorie: 'prive', urgentie: 'laag', duur: 'kort', toegewezen: ['Abdel'] }),
    mk({ titel: 'Marokkaanse shirts voor broertje', omschrijving: 'Met Amazigh-tekst erop.', categorie: 'prive', urgentie: 'laag', duur: 'kort', toegewezen: ['Abdel'] }),
    mk({ titel: 'Amlou kopen — in de buurt van Tanger', categorie: 'prive', urgentie: 'laag', duur: 'kort', toegewezen: ['Abdel'] }),
    mk({ titel: 'Honing voor moeder', categorie: 'prive', urgentie: 'laag', duur: 'kort', toegewezen: ['Abdel'] }),
  );
  s._takenSeedV1 = now();
  logActivity('systeem', 'starttaken ingeladen', `${lijst.length} taken`);
  saveSoon();
  return lijst.length;
}

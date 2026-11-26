// AFVINKEN OP START (25 nov 2026, wens eigenaar: "dit soort dingen en 'jouw dag in één oogopslag'
// bij Start moeten we af kunnen vinken of weg swipen als ze het hebben gedaan").
//
// VASTE AFSPRAKEN:
//  1. Afvinken haalt iets alleen van START. Er verandert NIETS aan de opdracht, factuur, klant of
//     het gesprek zelf: op zijn eigen plek (bord, inbox, Facturen, Berichten) staat alles nog.
//  2. Onthouden PER ONDERDEEL (welke opdracht, welke factuur). Komt er iets nieuws bij, dan staat
//     het punt er weer — met alleen het nieuwe. Niets verdwijnt dus stil voorgoed.
//  3. Het kantoor (beheerder + assistente) deelt één lijst: vinkt de één af, dan is het ook bij
//     de ander weg. Een monteur heeft zijn eigen lijst.
//  4. Alles is terug te zetten.
//  5. Een kapotte koppeling is nooit af te vinken (zie eerst-doen.js).
//
// Opslag: settings._startAf[scope][sleutel] = { items: { id: tijdstip }, at, door }.
// De functies met `In` werken op een los object (zonder database) en zijn zo te testen.

import { db, saveSoon } from './db.js';
import { AFVINKBAAR } from './eerst-doen.js';

/** De regels uit "Jouw dag in één oogopslag": het scherm maakt zelf een sleutel per regel. */
export const DAG = 'dag';
/** Lijstjes op Start die geen punt van "Eerst doen" zijn. */
export const LIJSTEN = ['afspraakVandaag'];
export const ALLE_SLEUTELS = [...AFVINKBAAR, ...LIJSTEN, DAG];
/** Een monteur ziet alleen deze onderdelen, dus alleen die mag hij afvinken. */
export const MONTEUR_SLEUTELS = ['reactie', 'afspraakGeweest', 'offertes', 'factureren', 'afspraakVandaag'];

const MAX_PER_SLEUTEL = 3000;
const DAG_BEWAREN_MS = 14 * 86400000;
const ID_RE = /^[\w:.|@+#-]{1,160}$/;

export const scopeVan = (user) => (user && user.role === 'monteur' ? `m:${user.monteurId || user.id}` : 'kantoor');
export const magSleutel = (user, sleutel) => ALLE_SLEUTELS.includes(sleutel) && (!user || user.role !== 'monteur' || MONTEUR_SLEUTELS.includes(sleutel));

/** {sleutel: Set(id's)} voor deze scope — de vorm die eerstDoenLijst verwacht. */
export function afgevinktUit(opslag, scope) {
  const uit = {};
  for (const [sleutel, v] of Object.entries((opslag && opslag[scope]) || {})) uit[sleutel] = new Set(Object.keys((v && v.items) || {}));
  return uit;
}

/**
 * Vink af. `geldig` = de id's die er NU zijn (Set); alleen die worden onthouden, en wat intussen
 * is opgelost wordt meteen vergeten (komt het later terug, dan is het weer zichtbaar). Voor de
 * dag-regels is er geen vaste lijst: daar verloopt een vinkje na 14 dagen.
 * Geeft het aantal nieuw afgevinkte onderdelen terug.
 */
export function vinkAfIn(opslag, scope, sleutel, ids, { door = '', geldig = null, nu = Date.now() } = {}) {
  if (!opslag[scope]) opslag[scope] = {};
  const rij = opslag[scope][sleutel] || { items: {} };
  const items = { ...(rij.items || {}) };
  if (geldig) { for (const id of Object.keys(items)) if (!geldig.has(id)) delete items[id]; }
  else { for (const [id, at] of Object.entries(items)) if (nu - new Date(at).getTime() > DAG_BEWAREN_MS) delete items[id]; }
  const moment = new Date(nu).toISOString();
  let erbij = 0;
  for (const ruw of Array.isArray(ids) ? ids : []) {
    const id = String(ruw == null ? '' : ruw);
    if (!ID_RE.test(id) || (geldig && !geldig.has(id)) || items[id]) continue;
    if (Object.keys(items).length >= MAX_PER_SLEUTEL) break;
    items[id] = moment; erbij++;
  }
  if (!Object.keys(items).length) delete opslag[scope][sleutel];
  else opslag[scope][sleutel] = erbij ? { items, at: moment, door: String(door || '').slice(0, 80) } : { ...rij, items };
  return erbij;
}

/** Zet terug: de opgegeven id's, of (zonder id's) alles van die sleutel. Geeft het aantal terug. */
export function zetTerugIn(opslag, scope, sleutel, ids = null) {
  const rij = opslag[scope] && opslag[scope][sleutel];
  if (!rij) return 0;
  const items = { ...(rij.items || {}) };
  let weg = 0;
  if (Array.isArray(ids)) { for (const id of ids) if (items[String(id)]) { delete items[String(id)]; weg++; } }
  else { weg = Object.keys(items).length; for (const id of Object.keys(items)) delete items[id]; }
  if (!Object.keys(items).length) delete opslag[scope][sleutel]; else opslag[scope][sleutel] = { ...rij, items };
  return weg;
}

/** De wachtende klanten zonder wie op Start als punt is afgevinkt (id = gesprek|tijdstip van het bericht). */
export const wachtId = (w) => `${w.chatId}|${w.at}`;
export function zonderAfgevinkteWachtenden(lijst, afgevinkt) {
  const set = afgevinkt && afgevinkt.wacht;
  return set && set.size ? (lijst || []).filter((w) => !set.has(wachtId(w))) : (lijst || []);
}

// ---------- met de database ----------
const opslag = () => { const s = db().settings; if (!s._startAf || typeof s._startAf !== 'object') s._startAf = {}; return s._startAf; };
/** Lezen zonder iets aan te maken (een leesactie schrijft nooit). */
export const afgevinktVoor = (user) => afgevinktUit((db().settings && db().settings._startAf) || {}, scopeVan(user));
export function infoVoor(user, sleutel) {
  const rij = (((db().settings && db().settings._startAf) || {})[scopeVan(user)] || {})[sleutel];
  return rij ? { at: rij.at || null, door: rij.door || '' } : null;
}
export function vinkAf(user, sleutel, ids, geldig) {
  // Een nieuw object per scope: de opslag ziet zo dat de instellingen zijn gewijzigd.
  const o = { ...opslag() }; o[scopeVan(user)] = { ...(o[scopeVan(user)] || {}) };
  const n = vinkAfIn(o, scopeVan(user), sleutel, ids, { door: (user && user.name) || '', geldig });
  db().settings._startAf = o; saveSoon();
  return n;
}
export function zetTerug(user, sleutel, ids = null) {
  const o = { ...opslag() }; o[scopeVan(user)] = { ...(o[scopeVan(user)] || {}) };
  const n = zetTerugIn(o, scopeVan(user), sleutel, ids);
  db().settings._startAf = o; if (n) saveSoon();
  return n;
}

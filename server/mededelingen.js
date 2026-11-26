// MEDEDELINGEN AAN HET TEAM (26 nov 2026, wens eigenaar: "ik wil zelf een update of notificatie
// kunnen toevoegen, zoals 'Wat is er veranderd?' op Start, om iets aan het team te melden").
//
// De beheerder schrijft een kort bericht en kiest voor wie (iedereen / kantoor / monteurs). Het
// staat bij die mensen bovenaan het scherm tot ze op "Gelezen" tikken. De beheerder ziet wie het
// gelezen heeft en kan een bericht intrekken. Een bericht kan een einddatum hebben.
// Opslag: db().mededelingen (nieuwste eerst). De functies bovenaan zijn puur (los te testen).

import { db, id, now, saveSoon, logActivity } from './db.js';

export const VOOR = ['iedereen', 'kantoor', 'monteurs'];
export const VOOR_NAAM = { iedereen: 'iedereen', kantoor: 'kantoor (beheerder en assistente)', monteurs: 'de monteurs' };
const MAX_BEWAARD = 200;

/** Is dit bericht voor deze gebruiker bedoeld? */
export const isVoor = (m, user) => !!user && (m.voor === 'iedereen' || (m.voor === 'monteurs' ? user.role === 'monteur' : m.voor === 'kantoor' ? user.role !== 'monteur' : false));
/** Nog zichtbaar: niet ingetrokken en de einddatum (t/m die dag, Nederlandse tijd) is niet voorbij. */
export function isActief(m, nu = Date.now()) {
  if (!m || m.ingetrokkenAt) return false;
  if (!m.totEnMet) return true;
  const vandaag = new Date(nu).toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
  return vandaag <= m.totEnMet;
}
export const isGelezen = (m, user) => !!(m.gelezen && user && m.gelezen[user.id]);
/** De ongelezen berichten voor deze gebruiker, nieuwste eerst. */
export function ongelezenVoor(lijst, user, nu = Date.now()) {
  return (lijst || []).filter((m) => isActief(m, nu) && isVoor(m, user) && !isGelezen(m, user))
    .map((m) => ({ id: m.id, titel: m.titel, tekst: m.tekst, belangrijk: !!m.belangrijk, door: m.door || '', at: m.at }));
}
/** Voor de beheerder: wie heeft het gelezen en wie nog niet (alleen de mensen voor wie het is). */
export function leesOverzicht(m, users) {
  const doel = (users || []).filter((u) => isVoor(m, u));
  const gelezen = doel.filter((u) => isGelezen(m, u)).map((u) => u.name || u.email || '');
  const nogNiet = doel.filter((u) => !isGelezen(m, u)).map((u) => u.name || u.email || '');
  return { aantal: doel.length, gelezen, nogNiet };
}
export function leesInvoer(body) {
  const b = body || {};
  const titel = String(b.titel || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const tekst = String(b.tekst || '').replace(/\r/g, '').trim().slice(0, 2000);
  const tot = /^\d{4}-\d{2}-\d{2}$/.test(String(b.totEnMet || '')) ? String(b.totEnMet) : '';
  return { titel, tekst, voor: VOOR.includes(b.voor) ? b.voor : 'iedereen', totEnMet: tot, belangrijk: !!b.belangrijk };
}

// ---------- met de database ----------
const alle = () => { if (!Array.isArray(db().mededelingen)) db().mededelingen = []; return db().mededelingen; };
const lees = () => (Array.isArray(db().mededelingen) ? db().mededelingen : []);
export const vind = (mid) => lees().find((m) => m.id === mid) || null;
export const mijnOngelezen = (user) => ongelezenVoor(lees(), user);
// Het overzicht voor wie mag plaatsen (beheerder + assistente, 27 nov 2026). `magWeg`: de
// beheerder mag alles intrekken, de assistente alleen wat ze zelf plaatste.
export const magIntrekken = (m, user) => !user || user.role === 'admin' || (user.role === 'assistent' && !!m.doorId && m.doorId === user.id);
export function voorBeheer(user = null) {
  const users = db().users || [];
  return lees().slice(0, 50).map((m) => ({ id: m.id, magWeg: magIntrekken(m, user), titel: m.titel, tekst: m.tekst, voor: m.voor, voorNaam: VOOR_NAAM[m.voor] || m.voor, belangrijk: !!m.belangrijk,
    totEnMet: m.totEnMet || '', door: m.door || '', at: m.at, ingetrokkenAt: m.ingetrokkenAt || null, actief: isActief(m), lezers: leesOverzicht(m, users) }));
}
export function plaats(body, user) {
  const inv = leesInvoer(body);
  if (!inv.titel) { const e = new Error('Vul een korte titel in.'); e.status = 400; throw e; }
  if (inv.totEnMet && !isActief({ totEnMet: inv.totEnMet })) { const e = new Error('De einddatum ligt in het verleden.'); e.status = 400; throw e; }
  // Wie hem plaatst hoeft hem niet zelf nog als ongelezen te zien.
  const m = { id: id('med'), ...inv, at: now(), door: (user && user.name) || '', doorId: (user && user.id) || '', gelezen: user ? { [user.id]: now() } : {} };
  alle().unshift(m);
  if (alle().length > MAX_BEWAARD) db().mededelingen = alle().slice(0, MAX_BEWAARD);
  logActivity(m.door || 'systeem', 'mededeling geplaatst', `"${m.titel}" — voor ${VOOR_NAAM[m.voor]}`);
  saveSoon();
  return m;
}
export function markeerGelezen(m, user) {
  if (!isVoor(m, user)) { const e = new Error('Dit bericht is niet voor jou bedoeld.'); e.status = 403; throw e; }
  if (!isGelezen(m, user)) { m.gelezen = { ...(m.gelezen || {}), [user.id]: now() }; saveSoon(); }
  return m;
}
export function trekIn(m, user) {
  if (!m.ingetrokkenAt) { m.ingetrokkenAt = now(); m.ingetrokkenDoor = (user && user.name) || ''; logActivity(m.ingetrokkenDoor || 'systeem', 'mededeling ingetrokken', `"${m.titel}"`); saveSoon(); }
  return m;
}

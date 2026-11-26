// OFFERTE ONLINE GOEDKEUREN — de "akkoordknop" (27 nov 2026, voorstel 2, akkoord eigenaar).
//
// De klant krijgt bij een offerte (mail, WhatsApp, herinnering en de downloadpagina) een
// ondertekende link /akkoord/<offerte>/<sig>. Daar ziet hij nummer, bedrag en geldigheid en
// tikt hij op "Ja, ik ga akkoord". Dan:
//   - gaat de offerte op Goedgekeurd (zelfde gevolgen als de knop in het CRM: factuur-concept
//     klaar als dat zo is ingesteld),
//   - komt er een regel in de opdracht + de opdracht krijgt "Klant reageerde",
//   - krijgt het kantoor (en de monteur van de opdracht) een melding,
//   - worden klaarstaande offerte-herinneringen ingetrokken.
//
// VASTE AFSPRAKEN:
//   1. De link OPENEN keurt niets goed (mailprogramma's en virusscanners openen links uit
//      zichzelf). Alleen de knop (POST) doet dat — zelfde principe als afmelden.
//   2. Alleen een VERSTUURDE offerte die nog GELDIG is. Al goedgekeurd = nette bevestiging,
//      afgekeurd/verlopen/concept = "neem contact op". Nooit een factuur.
//   3. Een schakelaar (Instellingen → Facturen & prijzen), standaard UIT: zolang die uit staat
//      komt de link nergens in te staan. Een link die al bij een klant is, blijft werken.
//
// Dit bestand doet alleen de regels en de links; het goedkeuren zelf staat in index.js (daar
// zijn alle gevolgen al beschikbaar).

import crypto from 'node:crypto';
import { db, saveSoon } from './db.js';

const geheim = () => process.env.LINK_SECRET || process.env.SESSION_SECRET || 'ks-upload';
const basis = () => String(process.env.APP_URL || 'https://keyservice-crm.onrender.com').replace(/\/+$/, '');
const DAG = 86400000;

export const akkoordSig = (invId) => crypto.createHmac('sha256', geheim()).update(`akkoord:${invId}`).digest('hex').slice(0, 24);
export const akkoordLink = (inv) => `${basis()}/akkoord/${encodeURIComponent(inv.id)}/${akkoordSig(inv.id)}`;
export const AKKOORD_LINK_RE = /^https?:\/\/\S+\/akkoord\/[\w-]+\/[0-9a-f]{24}$/;

export function akkoordAan() { return !!((db().settings && db().settings.offerteAkkoord) || {}).aan; }
export function zetAkkoordAan(aan) {
  db().settings.offerteAkkoord = { ...((db().settings.offerteAkkoord) || {}), aan: !!aan };
  saveSoon();
  return akkoordAan();
}

/** Controleert de link. Geeft de offerte terug (verandert niets), of null. */
export function akkoordToegang(invId, sig) {
  if (!/^[\w-]{3,80}$/.test(String(invId || '')) || !/^[0-9a-f]{24}$/.test(String(sig || ''))) return null;
  const goed = Buffer.from(akkoordSig(String(invId))); const gegeven = Buffer.from(String(sig));
  if (goed.length !== gegeven.length || !crypto.timingSafeEqual(goed, gegeven)) return null;
  const inv = (db().invoices || []).find((i) => i.id === invId);
  return inv && inv.type === 'offerte' ? inv : null;
}

/** Tot wanneer de offerte geldig is — dezelfde berekening als op de PDF. */
export function geldigTot(inv, quoteValidDays = 30) {
  const start = new Date(inv.sentAt || inv.updatedAt || inv.createdAt || Date.now()).getTime();
  return new Date(start + (Number(quoteValidDays) || 30) * DAG);
}

/**
 * Wat de klant op de pagina te zien krijgt:
 *   'open'      — kan nu akkoord geven
 *   'al'        — is al goedgekeurd
 *   'verlopen'  — geldigheid voorbij
 *   'gesloten'  — afgekeurd, nog niet verstuurd, of anders niet (meer) open
 */
export function akkoordStaat(inv, { quoteValidDays = 30, nu = Date.now() } = {}) {
  if (!inv || inv.type !== 'offerte') return 'gesloten';
  if (inv.status === 'goedgekeurd') return 'al';
  if (inv.status !== 'verzonden') return 'gesloten';
  if (geldigTot(inv, quoteValidDays).getTime() < nu) return 'verlopen';
  return 'open';
}

/**
 * De zin met de link voor in een bericht aan de klant ('' als de knop uit staat of het geen
 * offerte is). `kort` = voor WhatsApp (één regel).
 */
export function akkoordRegel(inv, { kort = false } = {}) {
  if (!inv || inv.type !== 'offerte' || !akkoordAan()) return '';
  const link = akkoordLink(inv);
  return kort ? `Akkoord? Tik hier om de offerte goed te keuren: ${link}` : `Gaat u akkoord? Klik op de link hieronder, dan plannen we de werkzaamheden direct in:\n\n${link}`;
}

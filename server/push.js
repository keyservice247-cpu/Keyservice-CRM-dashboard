// Push-meldingen (Web Push) — stuurt een melding naar de telefoon/desktop van het
// team zodra er iets nieuws binnenkomt, ook als de CRM dicht is.
//
// Gebruikt VAPID-sleutels die één keer worden gegenereerd en in de database
// (settings.push) bewaard, zodat je niets handmatig hoeft in te stellen.
//
// PER ROL (21 sep 2026, wens eigenaar "ook voor assistentes en monteurs"): elk
// toestel hangt aan de ingelogde gebruiker (userId). Wie wat krijgt bepaalt `aan`:
//   (leeg) / 'kantoor' → admin + assistent (nieuwe aanvraag, reactie klant, alarmen)
//   'admin'            → alleen beheerders (schijfruimte, mailbox)
//   'iedereen'         → alle toestellen
//   { monteurId }      → de monteur(s) met dat monteur-record (eigen opdracht,
//                        reactie van zijn klant, afspraak ingepland/gewijzigd)
//   { userIds: [...] } → specifieke gebruikers (bv. de testmelding: alleen jijzelf)
// Toestellen van vóór deze regel (zonder userId) tellen als kantoor.
import webpush from 'web-push';
import { db, save, saveSoon } from './db.js';

let configured = false;

function ensureKeys() {
  const s = db().settings;
  if (!s.push || !s.push.publicKey || !s.push.privateKey) {
    const keys = webpush.generateVAPIDKeys();
    s.push = { publicKey: keys.publicKey, privateKey: keys.privateKey };
    save();
    console.log('[push] nieuwe VAPID-sleutels gegenereerd');
  }
  if (!configured) {
    const subject = process.env.PUSH_SUBJECT || 'mailto:info@keyservice247.nl';
    webpush.setVapidDetails(subject, s.push.publicKey, s.push.privateKey);
    configured = true;
  }
  return s.push;
}

export function getPublicKey() {
  return ensureKeys().publicKey;
}

function subsList() {
  if (!Array.isArray(db().pushSubs)) db().pushSubs = [];
  return db().pushSubs;
}

// Een toestel aanmelden voor meldingen.
export function addSubscription(sub, user) {
  if (!sub || !sub.endpoint) return false;
  const list = subsList();
  const i = list.findIndex((s) => s.endpoint === sub.endpoint);
  const entry = { ...sub, userId: user?.id || '', userName: user?.name || '', at: new Date().toISOString() };
  if (i >= 0) list[i] = entry; else list.push(entry);
  saveSoon();
  return true;
}

export function removeSubscription(endpoint) {
  const list = subsList();
  const i = list.findIndex((s) => s.endpoint === endpoint);
  if (i >= 0) { list.splice(i, 1); saveSoon(); }
}

const KANTOOR = new Set(['admin', 'assistent']);

// Welke toestellen horen bij `aan`? Puur (geen netwerk) zodat het te testen is.
// users = db().users (rol en monteurId worden LIVE opgezocht — een rolwijziging
// werkt dus meteen door, zonder opnieuw aanmelden).
export function kiesToestellen(aan, subs, users) {
  const userById = new Map((users || []).map((u) => [u.id, u]));
  const rolVan = (sub) => (sub.userId && userById.get(sub.userId)) || null;
  return (subs || []).filter((sub) => {
    const u = rolVan(sub);
    if (aan === 'iedereen') return true;
    if (aan && typeof aan === 'object') {
      if (Array.isArray(aan.userIds)) return !!sub.userId && aan.userIds.includes(sub.userId);
      if (aan.monteurId) return !!u && u.role === 'monteur' && u.monteurId === aan.monteurId;
      return false;
    }
    // Oud toestel zonder gebruiker (van vóór 21 sep) of gebruiker die niet meer
    // bestaat: als kantoor behandelen — dat was altijd de eigenaar.
    if (!u) return aan !== 'admin' || !sub.userId;
    if (aan === 'admin') return u.role === 'admin';
    return KANTOOR.has(u.role); // standaard: kantoor
  });
}

// Stuur een melding naar de toestellen die bij `aan` horen. Dode abonnementen
// (verlopen/afgemeld) worden automatisch opgeruimd.
export async function sendPush({ title, body, url = '/', tag = 'ks', aan } = {}) {
  ensureKeys();
  const list = subsList();
  const doelen = kiesToestellen(aan, list, db().users || []);
  if (!doelen.length) return { sent: 0, doelen: 0 };
  const payload = JSON.stringify({ title, body, url, tag });
  let sent = 0;
  const dead = [];
  await Promise.all(doelen.map(async (sub) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) dead.push(sub.endpoint);
    }
  }));
  if (dead.length) {
    db().pushSubs = list.filter((s) => !dead.includes(s.endpoint));
    saveSoon();
  }
  return { sent, doelen: doelen.length };
}

// Melding voor de monteur van een opdracht (alleen als die een gekoppeld account
// met aangemeld toestel heeft; anders gebeurt er stil niets).
export function pushNaarMonteur(order, { title, body, url } = {}) {
  if (!order || !order.monteurId) return Promise.resolve({ sent: 0, doelen: 0 });
  return sendPush({ title, body, url: url || `/?open=${order.id}`, tag: `ks-${order.id}`, aan: { monteurId: order.monteurId } }).catch(() => ({ sent: 0, doelen: 0 }));
}

export function pushEnabled() {
  return subsList().length > 0;
}

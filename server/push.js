// Push-meldingen (Web Push) — stuurt een melding naar de telefoon/desktop van het
// team zodra er iets nieuws binnenkomt, ook als de CRM dicht is.
//
// Gebruikt VAPID-sleutels die één keer worden gegenereerd en in de database
// (settings.push) bewaard, zodat je niets handmatig hoeft in te stellen.
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

// Stuur een melding naar alle aangemelde toestellen. Dode abonnementen (verlopen/
// afgemeld) worden automatisch opgeruimd.
export async function sendPush({ title, body, url = '/', tag = 'ks' }) {
  ensureKeys();
  const list = subsList();
  if (!list.length) return { sent: 0 };
  const payload = JSON.stringify({ title, body, url, tag });
  let sent = 0;
  const dead = [];
  await Promise.all(list.map(async (sub) => {
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
  return { sent };
}

export function pushEnabled() {
  return subsList().length > 0;
}

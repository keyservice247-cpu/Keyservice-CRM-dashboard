// ONBEANTWOORDE KLANTVRAGEN (punt 10, audit 18 aug).
// De ongelezen-teller zegt alleen of iemand het gesprek heeft GEOPEND — niet of er
// ook geantwoord is. Deze meting kijkt puur naar de tijd: het laatste binnengekomen
// klantbericht (WhatsApp 1-op-1 of e-mail van een bekende klant) waar ná dat moment
// géén menselijk antwoord op is gegeven, ouder dan X uur. Automatische berichten
// (afzender "Keyservice (…)") tellen niet als antwoord. Gedeeld door de Start-pagina,
// de ochtendbriefing en de wekelijkse controle.
import { db } from './db.js';
import { matchPhone, senderPhoneFromText } from './pipeline.js';

const SYSTEEMRUIS = /^\s*\[?(e2e_notification|ciphertext|protocol|revoked|gp2|notification_template|call_log)\b/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const echtNummer = (p) => { const d = String(p).replace(/\D/g, ''); return d.length >= 6 && d.length <= 13; };

export function onbeantwoordeGesprekken(urenGrens = 2, maxDagen = 14) {
  const nu = Date.now();
  const vloer = nu - maxDagen * 86400000;
  const grens = nu - urenGrens * 3600000;
  const perNummer = new Map(); const perMail = new Map();
  for (const c of db().customers || []) {
    const p = matchPhone(c.phone || ''); if (p.length >= 6 && !perNummer.has(p)) perNummer.set(p, c);
    const e = String(c.email || '').toLowerCase(); if (e && !perMail.has(e)) perMail.set(e, c);
  }
  // Laatste INKOMENDE klantbericht per gesprek.
  const laatsteIn = new Map(); // chatId -> { at, body, klant }
  for (const m of db().messages || []) {
    if (m.skipped || m.bounce || !m.body) continue;
    const t = new Date(m.receivedAt || 0).getTime();
    if (!t || t < vloer) continue;
    let chatId = ''; let klant = null;
    if (m.channel === 'whatsapp' && !m.group) {
      if (SYSTEEMRUIS.test(m.body)) continue;
      const p = matchPhone(m.fromPhone || senderPhoneFromText(m.body));
      if (!echtNummer(p)) continue;
      klant = perNummer.get(p) || null; chatId = klant ? klant.id : `tel:${p}`;
    } else if (m.channel === 'email') {
      const em = ((String(m.sender || '').match(EMAIL_RE) || [''])[0]).toLowerCase();
      klant = em ? perMail.get(em) : null; if (!klant) continue; chatId = klant.id;
    }
    if (!chatId) continue;
    const cur = laatsteIn.get(chatId);
    if (!cur || t > cur.at) laatsteIn.set(chatId, { at: t, body: m.body, klant, phone: m.fromPhone || '', channel: m.channel });
  }
  // Laatste MENSELIJKE uitgaande reactie per gesprek.
  const laatsteUit = new Map();
  const bump = (cid, at) => { const t = new Date(at || 0).getTime(); if (t && t > (laatsteUit.get(cid) || 0)) laatsteUit.set(cid, t); };
  for (const o of db().orders || []) {
    if (!o.customerId) continue;
    for (const t of o.thread || []) {
      if (!t.outgoing || t.channel === 'systeem' || t.autoReply || /^Keyservice\s*\(/i.test(String(t.sender || ''))) continue;
      bump(o.customerId, t.at);
    }
  }
  for (const ob of db().outbox || []) {
    if (ob.group && ob.group !== '__klant_dm__') continue;
    if (!/^chat\s*\(/.test(String(ob.by || ''))) continue;
    const cid = ob.customerId || (echtNummer(matchPhone(ob.phone || '')) ? `tel:${matchPhone(ob.phone)}` : '');
    if (cid) bump(cid, ob.createdAt);
  }
  for (const mu of db().mailUit || []) bump(mu.customerId, mu.at);
  const uit = [];
  for (const [chatId, info] of laatsteIn) {
    if (info.at > grens) continue;                 // nog binnen de grens
    if ((laatsteUit.get(chatId) || 0) >= info.at) continue; // wél beantwoord
    uit.push({
      chatId, naam: info.klant ? (info.klant.name || 'Klant') : `Onbekend nummer ${chatId.slice(4)}`,
      kanaal: info.channel, at: new Date(info.at).toISOString(),
      urenWachtend: Math.round((nu - info.at) / 3600000),
      tekst: String(info.body || '').replace(/\s+/g, ' ').slice(0, 90),
    });
  }
  uit.sort((a, b) => b.urenWachtend - a.urenWachtend);
  return uit;
}

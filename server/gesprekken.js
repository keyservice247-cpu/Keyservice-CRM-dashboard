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

// Hoe ver terug het blok kijkt (16 sep 2026, wens eigenaar: "alles wat 2 weken of
// ouder is moet eruit"): instelbaar, standaard 14 dagen, Instellingen → Werkwijze.
export function wachtOpAntwoordDagen() {
  const v = Number(db().settings.wachtOpAntwoordDagen);
  return Number.isFinite(v) && v >= 1 ? Math.min(60, Math.round(v)) : 14;
}
export function onbeantwoordeGesprekken(urenGrens = 2, maxDagen = wachtOpAntwoordDagen()) {
  const nu = Date.now();
  const vloer = nu - maxDagen * 86400000;
  const afgehandeld = db().settings._wachtAfgehandeld || {};
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
  // Kaarten per klant: (a) een kaart die NA het bericht is afgerond/geannuleerd telt
  // als afgehandeld (iemand heeft de klant gesproken of de zaak gesloten); (b) de
  // nieuwste open kaart gaat mee als context ("waar gaat dit over?").
  const kaartenPerKlant = new Map();
  for (const o of db().orders || []) {
    if (!o.customerId || o.trashedAt) continue;
    if (!kaartenPerKlant.has(o.customerId)) kaartenPerKlant.set(o.customerId, []);
    kaartenPerKlant.get(o.customerId).push(o);
  }
  const GESLOTEN = new Set(['afgerond', 'geannuleerd']);
  const uit = [];
  for (const [chatId, info] of laatsteIn) {
    if (info.at > grens) continue;                 // nog binnen de grens
    if ((laatsteUit.get(chatId) || 0) >= info.at) continue; // wél beantwoord
    const markering = afgehandeld[chatId] ? new Date(afgehandeld[chatId]).getTime() : 0;
    if (markering >= info.at) continue;            // handmatig op "afgehandeld" gezet
    const kaarten = kaartenPerKlant.get(chatId) || [];
    if (kaarten.some((o) => GESLOTEN.has(o.status) && new Date(o.updatedAt || 0).getTime() >= info.at)) continue;
    const open = kaarten.filter((o) => !GESLOTEN.has(o.status)).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0]
      || kaarten.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
    const uren = Math.round((nu - info.at) / 3600000);
    uit.push({
      chatId, naam: info.klant ? (info.klant.name || 'Klant') : `Onbekend nummer ${chatId.slice(4)}`,
      kanaal: info.channel, at: new Date(info.at).toISOString(),
      urenWachtend: uren,
      dagenWachtend: Math.floor(uren / 24),
      tekst: String(info.body || '').replace(/\s+/g, ' ').slice(0, 140),
      kaart: open ? { id: open.id, title: open.title || '', status: open.status || '' } : null,
    });
  }
  // Nieuwste bovenaan: wat vandaag binnenkwam vraagt het eerst om actie; het oudste
  // valt na de ingestelde termijn vanzelf af.
  uit.sort((a, b) => a.urenWachtend - b.urenWachtend);
  return uit;
}

// VOORBEELDREGEL in de gesprekkenlijst (20 okt 2026, Berichten in WhatsApp-stijl): alleen
// het NIEUWE deel van een bericht. Een e-mailantwoord sleepte het hele geciteerde gesprek
// mee ("Wij gaan akkoord! Op di 20 okt 2026 om 18:06 schreef Keyservice…"), en de bridge
// plakt onder elk appje "Telefoon: +31…" — dat hoort niet in de voorvertoning.
const CITAAT_REGEL = [
  /^\s*>/,                                // geciteerde regel
  /^\s*-----.*schreef.*-----/i,           // ons eigen citaat-formaat
  /^\s*Op .*schreef.*:\s*$/i,             // Gmail NL
  /^\s*On .*wrote:\s*$/i,                 // Gmail EN
  /^\s*(Van|From|Verzonden|Sent):\s/i,    // Outlook-kopblok
  /^\s*-{2,}\s*Oorspronkelijk bericht/i,  // Outlook NL
  /^\s*_{5,}\s*$/,                        // Outlook-scheidingslijn
];
export function voorbeeldTekst(body, max = 120) {
  const regels = String(body || '').replace(/\r\n/g, '\n').split('\n');
  let eind = regels.length;
  for (let i = 0; i < regels.length; i++) if (CITAAT_REGEL.some((re) => re.test(regels[i]))) { eind = i; break; }
  let tekst = regels.slice(0, eind).join('\n');
  if (!tekst.trim()) tekst = regels.join('\n'); // alles was citaat → dan toch iets tonen
  tekst = tekst
    .replace(/\n\s*Telefoon:\s*\+?\d[\d\s()-]{5,}\s*$/i, '')        // nummer dat de bridge eronder plakt
    .replace(/\s+Op [^\n]{3,90}? schreef [^\n]{0,120}?:\s[\s\S]*$/i, '') // citaatkop op dezelfde regel
    .replace(/\s+/g, ' ').trim();
  return tekst.length > max ? tekst.slice(0, max) : tekst;
}

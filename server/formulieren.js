// WEBSITE-FORMULIEREN BEWAKEN (6 okt 2026, eigenaar: "het lijkt alsof FormSubmit niet
// werkt — dat moet werken!"). Elke website stuurt een aanvraag DUBBEL:
//   1) rechtstreeks naar het CRM (POST /api/ingest/form, mailbox 'website-direct'), en
//   2) via FormSubmit als e-mail naar contact@keyservice247.nl → de IMAP-poller leest
//      die mailbox en de pipeline ontdubbelt hem tegen de directe lead.
// Wat mis kan gaan en hier zichtbaar wordt:
//   - FormSubmit vraagt per NIEUWE website eenmalig om ACTIVATIE ("Activate FormSubmit
//     on …"). Die mail viel ongezien in "Geen aanvraag" → FormSubmit stuurde voor die
//     site nooit iets door. Nu: link bewaard, push + melding in het CRM.
//   - De mailbox waar FormSubmit naartoe mailt wordt niet door het CRM gelezen.
//   - Per website: wanneer kwam de laatste directe lead / FormSubmit-kopie binnen.
import { db, now, saveSoon, logActivity } from './db.js';
import { sendPush } from './push.js';

export const FORMSUBMIT_DOEL = 'contact@keyservice247.nl';
const DAG = 86400000;

// Is dit de activatie-/bevestigingsmail van FormSubmit?
export function isFormSubmitActivatie({ from = '', subject = '', text = '' } = {}) {
  const hay = `${subject}\n${text}`;
  return /formsubmit/i.test(`${from} ${hay}`)
    && /activate formsubmit|activate form|one step away from making forms|confirm (?:your|this) (?:email|form)|action required/i.test(hay);
}

// Activatielink + website uit de mail halen.
export function leesActivatie({ subject = '', text = '', html = '' } = {}) {
  const alles = `${subject}\n${text}\n${html}`;
  const links = [...alles.matchAll(/https?:\/\/(?:www\.)?formsubmit\.co\/[^\s"'<>)]+/gi)].map((m) => m[0].replace(/&amp;/g, '&'));
  const link = links.find((l) => /confirm|activat|verify/i.test(l)) || '';
  let site = '';
  const kand = alles.match(/\b(?:on|op|from|van)\s+(?:https?:\/\/)?((?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:nl|com|be|eu|dev|net|org))\b/i);
  if (kand) site = kand[1].toLowerCase().replace(/^www\./, '');
  if (!site) {
    const doms = [...alles.matchAll(/\b((?:[a-z0-9-]+\.)+(?:nl|com|be|eu|dev))\b/gi)].map((m) => m[1].toLowerCase().replace(/^www\./, ''))
      .filter((d) => !/formsubmit|keyservice-crm|onrender|gmail|hotmail|outlook/.test(d) && d !== 'keyservice247.nl');
    site = doms[0] || '';
  }
  return { link, site: site || 'onbekende website' };
}

// Activatiemail vastleggen (één keer per link) + seintje naar kantoor.
export function registreerFormSubmitActivatie({ subject = '', text = '', html = '' } = {}) {
  const s = db().settings;
  const { link, site } = leesActivatie({ subject, text, html });
  s._formSubmitActivaties = Array.isArray(s._formSubmitActivaties) ? s._formSubmitActivaties : [];
  const sleutel = link || `${site}|${subject}`;
  if (s._formSubmitActivaties.some((a) => (a.link || `${a.site}|${a.subject}`) === sleutel)) return null;
  const rec = { at: now(), site, link, subject: String(subject).slice(0, 200), afgehandeld: null };
  s._formSubmitActivaties.unshift(rec);
  s._formSubmitActivaties = s._formSubmitActivaties.slice(0, 30);
  logActivity('systeem', 'FormSubmit vraagt activatie', `${site}${link ? '' : ' (geen link gevonden — kijk in de mailbox)'}`);
  try {
    sendPush({ title: 'FormSubmit: website bevestigen', body: `FormSubmit stuurt aanvragen van ${site} pas door na één klik. Open het CRM: Instellingen → Koppelingen → Website-formulieren.`, url: '/' }).catch(() => {});
  } catch { /* melding mag nooit blokkeren */ }
  saveSoon();
  return rec;
}

export function markeerActivatieAfgehandeld(sleutel, door = '') {
  const lijst = db().settings._formSubmitActivaties || [];
  const a = lijst.find((x) => (x.link || `${x.site}|${x.subject}`) === sleutel);
  if (!a) return false;
  a.afgehandeld = now(); a.door = door;
  saveSoon();
  return true;
}

// FormSubmit-mailbox (contact@): wat laten we liggen? Standaard ALLES behalve de
// formulier-mails en FormSubmit-activaties (instelling formSubmitBox.alleenFormulieren,
// standaard aan). Andere mailboxen: nooit iets overslaan.
export function mailOverslaanInFormSubmitBox({ mailbox = '', from = '', subject = '', instelling = null } = {}) {
  if (String(mailbox || '').trim().toLowerCase() !== FORMSUBMIT_DOEL) return false;
  if (instelling && instelling.alleenFormulieren === false) return false;
  if (/formsubmit/i.test(from)) return false;
  if (/offerte-?aanvraag|contactaanvraag|aanvraag via|submitted your form/i.test(subject)) return false;
  return true;
}

// Website van een (direct of FormSubmit-)bericht.
export function siteVanBericht(m) {
  const b = String((m && m.body) || '');
  const r = b.match(/^Nieuwe aanvraag via de website\s+([a-z0-9.-]+\.[a-z]{2,})/i)
    || b.match(/submitted your form on\s+(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:nl|com|be|eu|dev))/i)
    || String((m && m.subject) || '').match(/\(((?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:nl|com|be|eu|dev))\)/i)
    || String((m && m.subject) || '').match(/\bvia\s+((?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:nl|com|be|eu|dev))\b/i);
  return r ? r[1].toLowerCase().replace(/^www\./, '') : 'website onbekend';
}
const isDirect = (m) => m && m.mailbox === 'website-direct';
// Echte FormSubmit-aanvraagmail: AFZENDER is FormSubmit (niet alleen de tekstvorm — een
// klant die "Offerte-aanvraag" als onderwerp typt telde anders mee) en geen activatie.
const isFormSubmitMail = (m) => m && m.channel === 'email' && m.mailbox !== 'website-direct'
  && /formsubmit/i.test(String(m.sender || ''))
  && !isFormSubmitActivatie({ from: m.sender, subject: m.subject, text: m.body });

// Telefoon (genormaliseerd, 06…/0xx…) en e-mail van de klant uit de berichttekst.
function contactSleutels(body) {
  const b = String(body || '');
  const uit = [];
  for (const mm of b.matchAll(/(?:\+31|0031|\b0)\s?\(?0?\)?\s?[1-9](?:[\s-]?\d){8}\b/g)) {
    const d = mm[0].replace(/\D/g, '').replace(/^0031/, '0').replace(/^31/, '0').replace(/^00/, '0');
    if (d.length === 10) uit.push('t:' + d);
  }
  for (const mm of b.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    const e = mm[0].toLowerCase();
    if (!/keyservice247\.nl|keyservice-crm|formsubmit/.test(e)) uit.push('m:' + e);
  }
  return [...new Set(uit)];
}

// Welke mailboxen leest het CRM? (alleen namen, nooit wachtwoorden)
export function gelezenMailboxen(env = process.env) {
  const lijst = [];
  if (env.IMAP_USER) lijst.push(String(env.IMAP_USER).trim().toLowerCase());
  for (const e of String(env.IMAP_INGEST_ACCOUNTS || '').split(',')) {
    const u = e.split(':')[0].trim().toLowerCase();
    if (u && !lijst.includes(u)) lijst.push(u);
  }
  return lijst;
}

export function formulierStatus({ env = process.env, nu = Date.now() } = {}) {
  const sites = new Map();
  const per = (site) => {
    if (!sites.has(site)) sites.set(site, { site, direct: { laatste: null, aantal30: 0 }, formsubmit: { laatste: null, aantal30: 0 }, zonderKopie30: 0 });
    return sites.get(site);
  };
  const later = (a, b) => (!a || (b && b > a) ? b : a);
  // Koppeling direct ↔ FormSubmit-mail op klantnummer/e-mail (±3 dagen). De vlag
  // formSubmitKopieAt bestaat pas sinds 6 okt; oudere paren (of een kopie die als los
  // bericht binnenkwam) telden anders ten onrechte als "zonder kopie".
  const fsContact = new Map();
  for (const m of db().messages || []) {
    if (!m || !m.receivedAt || !isFormSubmitMail(m)) continue;
    const t = new Date(m.receivedAt).getTime();
    for (const k of contactSleutels(m.body)) { if (!fsContact.has(k)) fsContact.set(k, []); fsContact.get(k).push(t); }
  }
  const heeftFsKopie = (m, t) => contactSleutels(m.body).some((k) => (fsContact.get(k) || []).some((ft) => ft >= t - DAG && ft <= t + 3 * DAG));
  for (const m of db().messages || []) {
    if (!m || !m.receivedAt) continue;
    const t = new Date(m.receivedAt).getTime();
    const binnen30 = nu - t < 30 * DAG;
    if (isDirect(m)) {
      const r = per(siteVanBericht(m));
      r.direct.laatste = later(r.direct.laatste, m.receivedAt);
      if (binnen30) r.direct.aantal30++;
      // FormSubmit-kopie die tegen deze directe lead is ontdubbeld (pipeline zet de vlag).
      if (m.formSubmitKopieAt) {
        r.formsubmit.laatste = later(r.formsubmit.laatste, m.formSubmitKopieAt);
        if (nu - new Date(m.formSubmitKopieAt).getTime() < 30 * DAG) r.formsubmit.aantal30++;
      } else if (binnen30 && nu - t > 6 * 3600000 && !heeftFsKopie(m, t)) r.zonderKopie30++;
    } else if (isFormSubmitMail(m)) {
      const r = per(siteVanBericht(m));
      r.formsubmit.laatste = later(r.formsubmit.laatste, m.receivedAt);
      if (binnen30) r.formsubmit.aantal30++;
    }
  }
  const mailboxen = gelezenMailboxen(env);
  const activaties = (db().settings._formSubmitActivaties || []).map((a) => ({ ...a, sleutel: a.link || `${a.site}|${a.subject}` }));
  // Komen er de laatste 14 dagen FormSubmit-mails binnen, dan bereiken ze het CRM (bv.
  // via doorsturen naar de hoofdmailbox) — ook als contact@ zelf niet gekoppeld is.
  const laatsteFs = [...sites.values()].map((s) => s.formsubmit.laatste).filter(Boolean).sort().pop() || null;
  const viaDoorsturen = !mailboxen.includes(FORMSUBMIT_DOEL) && !!(laatsteFs && nu - new Date(laatsteFs).getTime() < 14 * DAG);
  const teruggevonden30 = (db().messages || []).filter((m) => m && m.teruggevonden && m.receivedAt && nu - new Date(m.receivedAt).getTime() < 30 * DAG).length;
  return {
    doel: FORMSUBMIT_DOEL,
    mailboxen,
    leestDoelBox: mailboxen.includes(FORMSUBMIT_DOEL) || viaDoorsturen,
    viaDoorsturen,
    alleenFormulieren: !(db().settings.formSubmitBox && db().settings.formSubmitBox.alleenFormulieren === false),
    eersteScan: db().settings._fsBoxEersteScan || null,
    teruggevonden30,
    imapLaatstOk: db()._imapLaatstOk || null,
    sites: [...sites.values()].sort((a, b) => String(b.direct.laatste || b.formsubmit.laatste || '').localeCompare(String(a.direct.laatste || a.formsubmit.laatste || ''))),
    activatiesOpen: activaties.filter((a) => !a.afgehandeld),
    activatiesKlaar: activaties.filter((a) => a.afgehandeld).slice(0, 10),
  };
}

// Uitgaande e-mail (SMTP) — voor het direct versturen van snelle antwoorden
// vanuit het dashboard. Werkt met TransIP (smtp.transip.email) of elke andere
// SMTP-server.
//
// Aanzetten via .env / Render:
//   SMTP_HOST=smtp.transip.email
//   SMTP_PORT=465
//   SMTP_USER=info@jouwdomein.nl      (of crm@..., het verzendadres)
//   SMTP_PASSWORD=...
//   SMTP_FROM="Keyservice <info@jouwdomein.nl>"   (optioneel; standaard SMTP_USER)
//
// Valt SMTP weg, dan blijft "kopieer / open in e-mail" in het dashboard werken.
import fs from 'node:fs';
import path from 'node:path';
import { db, now, logActivity, saveSoon } from '../db.js';
import { getHtmlSignature, getEmailSignature } from '../settings.js';

let transporter = null;

// ---------- Nette HTML-opmaak + handtekening (zoals de eigenaar 'm wil) ----------
const LOGO_PATH = path.join(process.cwd(), 'public', 'img', 'logo-factuur.png');
const escHtml = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function signatureHtml(sig) {
  // Rol als "Eigenaar | Key Service 24/7": eerste deel grijs, bedrijfsnaam in goud.
  const roleParts = String(sig.role || '').split('|').map((x) => x.trim());
  const roleHtml = roleParts.length > 1
    ? `${escHtml(roleParts[0])} | <span style="color:#d99a06;font-weight:600">${escHtml(roleParts.slice(1).join(' | '))}</span>`
    : escHtml(sig.role || '');
  const site = String(sig.website || '').replace(/^https?:\/\//, '');
  return `
  <table cellpadding="0" cellspacing="0" role="presentation" style="margin-top:22px;border-collapse:collapse">
    <tr><td style="border-left:4px solid #1d4ed8;padding:6px 0 6px 18px">
      <table cellpadding="0" cellspacing="0" role="presentation"><tr>
        ${fs.existsSync(LOGO_PATH) ? '<td style="padding-right:18px;vertical-align:middle"><img src="cid:kslogo" alt="Key Service 24/7" width="112" style="display:block;max-width:112px;height:auto"></td>' : ''}
        <td style="border-left:1px solid #d7dbe3;padding-left:18px;vertical-align:middle;font-family:Segoe UI,Arial,sans-serif;font-size:13.5px;color:#2b3442;line-height:1.55">
          <div style="font-size:19px;font-weight:700;color:#1d4ed8">${escHtml(sig.name)}</div>
          <div style="color:#5b6472">${roleHtml}</div>
          ${sig.tagline ? `<div style="color:#8a93a3;font-style:italic;margin:1px 0 8px">${escHtml(sig.tagline)}</div>` : ''}
          ${sig.phone ? `<div><b>Tel / WhatsApp:</b> ${escHtml(sig.phone)}</div>` : ''}
          ${sig.email ? `<div><b>E-mail:</b> <a href="mailto:${escHtml(sig.email)}" style="color:#1d4ed8;text-decoration:none">${escHtml(sig.email)}</a></div>` : ''}
          ${site ? `<div><b>Website:</b> <a href="https://${escHtml(site)}" style="color:#1d4ed8;text-decoration:none">${escHtml(site)}</a></div>` : ''}
        </td>
      </tr></table>
    </td></tr>
  </table>`;
}

// Maakt van de platte mailtekst een nette HTML-mail met de handtekening eronder.
// De oude TEKST-handtekening (indien aanwezig aan het einde) wordt in de HTML-
// versie vervangen door de mooie variant — in het platte-tekst-deel blijft hij
// staan als fallback. Geeft null als de HTML-handtekening uitstaat.
export function wrapHtmlMail(text, afzender = null) {
  let sig;
  try { sig = getHtmlSignature(); } catch { return null; }
  // Wie stuurt deze mail? Verstuurt Youssef of de assistente een factuur of antwoord,
  // dan hoort daar HÚN naam en functie onder — niet die van de eigenaar.
  if (afzender && afzender.name) sig = { ...sig, name: afzender.name, role: afzender.role || sig.role };
  if (!sig || !sig.enabled) return null;
  let t = String(text || '');
  try {
    const plain = String(getEmailSignature() || '').trim();
    if (plain && t.trim().endsWith(plain)) t = t.trim().slice(0, t.trim().length - plain.length).trim();
  } catch { /* fallback: hele tekst tonen */ }
  const paras = escHtml(t).split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`).join('');
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14.5px;color:#1f2530;line-height:1.6;max-width:640px">${paras}${signatureHtml(sig)}</div>`;
}

// ÉÉN centraal punt voor mislukte mails: elke sendMail-fout (waar dan ook vandaan:
// snel antwoord, afspraakbevestiging, herinnering, review-verzoek, follow-up,
// factuur, opvolging) komt in het logboek + een korte lijst waar de watchdog
// dagelijks alarm op slaat. Nooit meer een mail die STIL niet aankomt.
function recordMailFailure(to, subject, errMsg) {
  try {
    const d = db();
    d._mailFailures = Array.isArray(d._mailFailures) ? d._mailFailures : [];
    d._mailFailures.unshift({ at: now(), to: String(to || ''), subject: String(subject || '').slice(0, 120), error: String(errMsg || '').slice(0, 200) });
    d._mailFailures = d._mailFailures.slice(0, 50);
    logActivity('systeem', 'e-mail MISLUKT', `${to}: ${String(errMsg || '').slice(0, 140)}`);
    saveSoon();
  } catch { /* registratie mag nooit de flow breken */ }
}

export function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

async function getTransporter() {
  if (!smtpConfigured()) return null;
  if (transporter) return transporter;
  const nodemailer = (await import('nodemailer')).default;
  const port = Number(process.env.SMTP_PORT || 465);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // 465 = SSL, 587 = STARTTLS
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
  return transporter;
}

export async function sendMail({ to, subject, text, attachments, inReplyTo, references, afzender = null }) {
  const tx = await getTransporter();
  if (!tx) throw new Error('SMTP niet geconfigureerd op de server');
  if (!to) throw new Error('Geen ontvanger (e-mailadres) opgegeven');
  // Altijd een nette afzendernaam, anders tonen mail-apps alleen het kale adresdeel
  // ("info"). SMTP_FROM (compleet) of SMTP_FROM_NAME (alleen de naam) op Render
  // overschrijven de standaard.
  const from = process.env.SMTP_FROM
    || { name: process.env.SMTP_FROM_NAME || 'Key Service 24/7 contact', address: process.env.SMTP_USER };
  try {
    const mail = { from, to, subject: subject || 'Keyservice', text: text || '' };
    if (attachments && attachments.length) mail.attachments = attachments;
    // Nette HTML-versie met de huisstijl-handtekening (tekst blijft als fallback).
    const html = wrapHtmlMail(text || '', afzender);
    if (html) {
      mail.html = html;
      if (fs.existsSync(LOGO_PATH)) {
        mail.attachments = [...(mail.attachments || []), { filename: 'logo.png', path: LOGO_PATH, cid: 'kslogo', contentDisposition: 'inline' }];
      }
    }
    // Echte e-mail-threading: een antwoord verwijst naar het oorspronkelijke bericht,
    // zodat het bij de klant in dezelfde conversatie valt (en een bounce terug te
    // koppelen is aan het juiste gesprek).
    if (inReplyTo) { mail.inReplyTo = inReplyTo; mail.references = references || inReplyTo; }
    const info = await tx.sendMail(mail);
    // ALLE ontvangers geweigerd (accepted leeg)? Dan is de mail écht niet
    // aangekomen — fout. De verbinding zelf is gezond, dus die blijft staan.
    if (Array.isArray(info.accepted) && info.accepted.length === 0) {
      const err = new Error(`De mailserver weigerde de ontvanger (${(info.rejected || []).join(', ') || to}). Controleer het e-mailadres.`);
      err.rejectedRecipient = true; // al geregistreerd; catch hieronder slaat 'm over
      recordMailFailure(to, subject, err.message);
      throw err;
    }
    // GEDEELTELIJK geweigerd (meerdere adressen, één fout): de mail IS bezorgd bij
    // de rest — wél registreren, niet falen.
    if (info.rejected && info.rejected.length) {
      recordMailFailure(info.rejected.join(', '), subject, 'Deze ontvanger is door de mailserver geweigerd (de overige ontvangers kregen de mail wél)');
    }
    return { messageId: info.messageId, accepted: info.accepted || [], rejected: info.rejected || [] };
  } catch (err) {
    // Geweigerde ontvanger: al geregistreerd, verbinding gezond, tekst klopt al.
    if (err && err.rejectedRecipient) throw err;
    // Verbinding weggooien zodat de volgende poging een verse maakt (bv. na wachtwoordwijziging).
    transporter = null;
    // Maak veelvoorkomende SMTP-fouten begrijpelijk voor het team.
    const code = err && (err.responseCode || err.code);
    const msg = String((err && err.message) || '');
    let out = err;
    if (code === 535 || /auth|login|credential|password/i.test(msg)) {
      out = new Error(`E-mail versturen mislukt (inloggen geweigerd door de mailserver). Controleer op Render: SMTP_USER = het verzendadres, SMTP_PASSWORD = het HUIDIGE wachtwoord daarvan, en dat de service opnieuw is gedeployd. Serverdetail: ${msg.slice(0, 140)}`);
    } else if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || /timed?out|connect/i.test(msg)) {
      out = new Error('Geen verbinding met de e-mailserver. Probeer het zo nog eens; blijft het fout, controleer SMTP_HOST/SMTP_PORT op Render.');
    }
    // Elke mislukte mail wordt centraal geregistreerd (logboek + dagelijks alarm) —
    // óók wanneer de aanroepende code de fout zelf stilletjes zou negeren.
    recordMailFailure(to, subject, out.message);
    throw out;
  }
}

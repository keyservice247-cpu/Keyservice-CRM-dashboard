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
import { db, now, logActivity, saveSoon } from '../db.js';

let transporter = null;

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

export async function sendMail({ to, subject, text, attachments, inReplyTo, references }) {
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
    // Echte e-mail-threading: een antwoord verwijst naar het oorspronkelijke bericht,
    // zodat het bij de klant in dezelfde conversatie valt (en een bounce terug te
    // koppelen is aan het juiste gesprek).
    if (inReplyTo) { mail.inReplyTo = inReplyTo; mail.references = references || inReplyTo; }
    const info = await tx.sendMail(mail);
    // Weigert de server de ontvanger (accepted leeg / rejected gevuld), dan is de
    // mail NIET aangekomen — dat is een fout, geen succes.
    if ((info.rejected && info.rejected.length) || (Array.isArray(info.accepted) && info.accepted.length === 0)) {
      const err = new Error(`De mailserver weigerde de ontvanger (${(info.rejected || []).join(', ') || to}). Controleer het e-mailadres.`);
      recordMailFailure(to, subject, err.message);
      throw err;
    }
    return { messageId: info.messageId, accepted: info.accepted || [], rejected: info.rejected || [] };
  } catch (err) {
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
    if (!/weigerde de ontvanger/.test(String(out.message || ''))) recordMailFailure(to, subject, out.message);
    throw out;
  }
}

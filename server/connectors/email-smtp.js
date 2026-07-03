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
let transporter = null;

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

export async function sendMail({ to, subject, text, attachments }) {
  const tx = await getTransporter();
  if (!tx) throw new Error('SMTP niet geconfigureerd op de server');
  if (!to) throw new Error('Geen ontvanger (e-mailadres) opgegeven');
  // Altijd een nette afzendernaam ("Keyservice <info@…>"), anders tonen mail-apps
  // alleen het kale adresdeel ("info"). SMTP_FROM (compleet) of SMTP_FROM_NAME
  // (alleen de naam) op Render overschrijven de standaard.
  const from = process.env.SMTP_FROM
    || { name: process.env.SMTP_FROM_NAME || 'Keyservice', address: process.env.SMTP_USER };
  try {
    const mail = { from, to, subject: subject || 'Keyservice', text: text || '' };
    if (attachments && attachments.length) mail.attachments = attachments;
    const info = await tx.sendMail(mail);
    return { messageId: info.messageId };
  } catch (err) {
    // Verbinding weggooien zodat de volgende poging een verse maakt (bv. na wachtwoordwijziging).
    transporter = null;
    // Maak veelvoorkomende SMTP-fouten begrijpelijk voor het team.
    const code = err && (err.responseCode || err.code);
    const msg = String((err && err.message) || '');
    if (code === 535 || /auth|login|credential|password/i.test(msg)) {
      throw new Error(`E-mail versturen mislukt (inloggen geweigerd door de mailserver). Controleer op Render: SMTP_USER = het verzendadres, SMTP_PASSWORD = het HUIDIGE wachtwoord daarvan, en dat de service opnieuw is gedeployd. Serverdetail: ${msg.slice(0, 140)}`);
    }
    if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || /timed?out|connect/i.test(msg)) {
      throw new Error('Geen verbinding met de e-mailserver. Probeer het zo nog eens; blijft het fout, controleer SMTP_HOST/SMTP_PORT op Render.');
    }
    throw err;
  }
}

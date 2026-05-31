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

export async function sendMail({ to, subject, text }) {
  const tx = await getTransporter();
  if (!tx) throw new Error('SMTP niet geconfigureerd op de server');
  if (!to) throw new Error('Geen ontvanger (e-mailadres) opgegeven');
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const info = await tx.sendMail({ from, to, subject: subject || 'Keyservice', text: text || '' });
  return { messageId: info.messageId };
}

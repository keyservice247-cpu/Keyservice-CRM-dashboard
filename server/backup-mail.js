// Dagelijkse off-site back-up: e-mailt een kopie van de database als bijlage naar
// een ingesteld adres, zodat er altijd een verse kopie buiten Render staat.
import fs from 'node:fs';
import { db, dbFilePath, save, now, logActivity } from './db.js';
import { getBackupMail } from './settings.js';
import { sendMail, smtpConfigured } from './connectors/email-smtp.js';

// Verstuur nu een back-up naar het opgegeven adres (of het ingestelde adres).
export async function sendBackupMail(toOverride) {
  const cfg = getBackupMail();
  const to = (toOverride || cfg.email || '').trim();
  if (!to) throw new Error('Geen e-mailadres voor de back-up ingesteld');
  if (!smtpConfigured()) throw new Error('SMTP niet geconfigureerd — versturen kan niet');
  save(); // zorg dat het bestand actueel is
  const file = dbFilePath();
  const content = fs.readFileSync(file);
  const stamp = new Date().toISOString().slice(0, 10);
  const counts = {
    opdrachten: (db().orders || []).length,
    klanten: (db().customers || []).length,
    berichten: (db().messages || []).length,
  };
  const text = `Hierbij de dagelijkse back-up van het Keyservice CRM (${stamp}).

Inhoud: ${counts.opdrachten} opdrachten, ${counts.klanten} klanten, ${counts.berichten} berichten.

Bewaar deze e-mail; de bijlage is een volledige kopie van alle gegevens en kan gebruikt worden om het systeem te herstellen.`;
  await sendMail({
    to,
    subject: `Keyservice CRM — back-up ${stamp}`,
    text,
    attachments: [{ filename: `keyservice-backup-${stamp}.json`, content }],
  });
  db().settings._lastBackupMailAt = now();
  save();
  logActivity('systeem', 'off-site back-up gemaild', to);
  return { ok: true, to, counts };
}

// Eén keer per dag op het ingestelde uur automatisch versturen.
export function startBackupMail() {
  let lastSentDay = null;
  const tick = async () => {
    try {
      const cfg = getBackupMail();
      if (!cfg.enabled || !cfg.email) return;
      const d = new Date();
      const day = d.toISOString().slice(0, 10);
      if (d.getHours() === cfg.hour && lastSentDay !== day) {
        lastSentDay = day;
        await sendBackupMail();
        console.log('[backup-mail] dagelijkse back-up verstuurd naar', cfg.email);
      }
    } catch (e) {
      console.error('[backup-mail] versturen mislukt:', e.message);
    }
  };
  setInterval(tick, 15 * 60 * 1000); // elk kwartier kijken of het tijd is
  setTimeout(tick, 30 * 1000);       // ook kort na opstarten
}

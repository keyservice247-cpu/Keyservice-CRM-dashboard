// Dagelijkse off-site back-up: e-mailt een kopie van de database als bijlage naar
// een ingesteld adres, zodat er altijd een verse kopie buiten Render staat.
import fs from 'node:fs';
import { db, dbFilePath, save, snapshotJson, now, logActivity } from './db.js';
import { getBackupMail } from './settings.js';
import { sendMail, smtpConfigured } from './connectors/email-smtp.js';

// Waar gaat de back-up naartoe? Het ingestelde adres, en anders automatisch het
// e-mailadres van de (eerste) beheerder — zodat aanzetten genoeg is, zonder eerst
// een adres te hoeven typen.
export function backupTarget() {
  const cfg = getBackupMail();
  if (cfg.email) return cfg.email;
  const admin = (db().users || []).find((u) => u.role === 'admin' && u.email);
  return admin ? admin.email : '';
}

// Verstuur nu een back-up naar het opgegeven adres (of anders automatisch de beheerder).
export async function sendBackupMail(toOverride) {
  const to = (toOverride || backupTarget() || '').trim();
  if (!to) throw new Error('Geen e-mailadres voor de back-up ingesteld (en geen beheerder met e-mail)');
  if (!smtpConfigured()) throw new Error('SMTP niet geconfigureerd — versturen kan niet');
  save();
  snapshotJson(); // volledige, actuele JSON-kopie op schijf (ook met SQLite-opslag)
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
  const tick = async () => {
    try {
      const cfg = getBackupMail();
      // 'email' hoeft niet meer ingevuld: bij aan-staan valt hij terug op de beheerder.
      if (!cfg.enabled || !backupTarget()) return;
      const d = new Date();
      const day = d.toISOString().slice(0, 10);
      const s = db().settings;
      // Op of ná het ingestelde uur, en nog niet gelukt vandaag. De "gelukt vandaag"-
      // markering staat in de DB (restart-veilig) en wordt pas NÁ succes gezet — dus
      // een tijdelijke SMTP-storing zorgt niet dat de hele dag wordt overgeslagen: de
      // volgende tick (elk kwartier) probeert het gewoon opnieuw.
      if (d.getHours() >= cfg.hour && s._backupMailDay !== day) {
        const r = await sendBackupMail();
        s._backupMailDay = day;
        delete s._backupMailError;
        save();
        console.log('[backup-mail] dagelijkse back-up verstuurd naar', r.to);
      }
    } catch (e) {
      console.error('[backup-mail] versturen mislukt (wordt volgende kwartier opnieuw geprobeerd):', e.message);
      try { db().settings._backupMailError = { at: now(), message: String(e.message).slice(0, 200) }; save(); } catch { /* best-effort */ }
    }
  };
  setInterval(tick, 15 * 60 * 1000); // elk kwartier kijken of het tijd is (en herproberen)
  setTimeout(tick, 30 * 1000);       // ook kort na opstarten
}

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
  const freqTxt = { halfmaand: 'halfmaandelijkse', week: 'wekelijkse', dag: 'dagelijkse' }[getBackupMail().frequentie] || 'periodieke';
  const text = `Hierbij de ${freqTxt} back-up van het Keyservice CRM (${stamp}).

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

// Periodesleutel in NEDERLANDSE tijd: bij 'dag' de datum, bij 'week' de maandag van
// die week, bij 'halfmaand' "YYYY-MM-a" (1e t/m 14e) of "YYYY-MM-b" (15e t/m eind).
// Er gaat één mail per periode — op of ná het ingestelde uur, zodra die periode begint.
// Lag de server op de 1e/15e plat, dan gaat hij bij de eerstvolgende ronde alsnog.
export function backupPeriode(datum = new Date(), frequentie = 'halfmaand') {
  const nl = new Date(datum).toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' }); // YYYY-MM-DD
  if (frequentie === 'dag') return nl;
  if (frequentie === 'week') {
    const [y, m, d] = nl.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() || 7) - 1));
    return `week-${t.toISOString().slice(0, 10)}`;
  }
  return `${nl.slice(0, 7)}-${Number(nl.slice(8, 10)) < 15 ? 'a' : 'b'}`;
}
export const nlUur = (datum = new Date()) => Number(new Date(datum).toLocaleString('en-US', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hour12: false })) % 24;
// Moet er NU een back-up-mail uit? (puur, voor de test)
export function backupMailVerschuldigd({ datum = new Date(), cfg, laatstePeriode }) {
  if (!cfg || !cfg.enabled) return false;
  if (nlUur(datum) < cfg.hour) return false;
  return backupPeriode(datum, cfg.frequentie) !== laatstePeriode;
}

// Op het ingestelde uur automatisch versturen, één keer per periode (standaard 2x per maand).
export function startBackupMail() {
  const tick = async () => {
    try {
      const cfg = getBackupMail();
      // 'email' hoeft niet meer ingevuld: bij aan-staan valt hij terug op de beheerder.
      if (!cfg.enabled || !backupTarget()) return;
      const d = new Date();
      const s = db().settings;
      // Eenmalig: oude installaties hebben alleen _backupMailDay. Ligt die in de huidige
      // periode, dan is deze periode al gedaan (geen extra mail direct na de update).
      if (!s._backupMailPeriode && s._backupMailDay && backupPeriode(new Date(`${s._backupMailDay}T12:00:00Z`), cfg.frequentie) === backupPeriode(d, cfg.frequentie)) {
        s._backupMailPeriode = backupPeriode(d, cfg.frequentie);
      }
      // De "gelukt"-markering staat in de DB (herstart-veilig) en wordt pas NÁ succes
      // gezet — een tijdelijke SMTP-storing slaat de periode dus niet over: de volgende
      // tick (elk kwartier) probeert het gewoon opnieuw.
      if (backupMailVerschuldigd({ datum: d, cfg, laatstePeriode: s._backupMailPeriode })) {
        const r = await sendBackupMail();
        s._backupMailPeriode = backupPeriode(d, cfg.frequentie);
        s._backupMailDay = d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
        delete s._backupMailError;
        save();
        console.log(`[backup-mail] back-up (${cfg.frequentie}) verstuurd naar`, r.to);
      }
    } catch (e) {
      console.error('[backup-mail] versturen mislukt (wordt volgende kwartier opnieuw geprobeerd):', e.message);
      try { db().settings._backupMailError = { at: now(), message: String(e.message).slice(0, 200) }; save(); } catch { /* best-effort */ }
    }
  };
  setInterval(tick, 15 * 60 * 1000); // elk kwartier kijken of het tijd is (en herproberen)
  setTimeout(tick, 30 * 1000);       // ook kort na opstarten
}

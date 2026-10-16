// Wekelijks inklappen/archiveren van opdrachten.
//
// Regel (op verzoek): elke zondag ná 23:59 worden opdrachten ingeklapt onder een
// week-bundel met titel "agenda 18 t/m 24 mei '26", maar ALLEEN:
//   - "Afspraak ingepland" (mits de afspraak NIET ná die week valt), en
//   - afgehandelde kolommen "Afgerond" / "Geannuleerd".
// Nieuw / In behandeling / Offerte verzonden blijven ALTIJD op het bord staan
// (die mogen nooit inklappen, tenzij ze afgerond of geannuleerd worden).
import fs from 'node:fs';
import path from 'node:path';
import { db, now, save, saveSoon, logActivity, dbFilePath } from './db.js';
import { appointmentStatusKey, getStatuses } from './settings.js';
import { completedWeek } from './week.js';

// Oude ruwe berichten opschonen zodat db.json niet oneindig groeit (en elke opslag
// traag wordt). VEILIG: berichten worden EERST naar een archiefbestand geschreven
// vóór ze uit de actieve database gaan (niets gaat verloren, altijd terug te vinden).
// We bewaren alles wat nog nodig is: recent (<90 dagen, voor ontdubbeling/analyse) én
// alles waar nog een openstaande inbox-melding (pending/overige) aan hangt.
export function pruneOldMessages(days = 90) {
  const d = db();
  const msgs = d.messages || [];
  if (msgs.length < 500) return { archived: 0, remaining: msgs.length }; // pas opschonen als het echt oploopt
  const cutoff = Date.now() - days * 86400000;
  // 'overige' (geklets/leveranciersmail) alleen de laatste 60 dagen vasthouden — anders
  // groeide de berichtenlijst onbegrensd en remde elk scherm mee (punt 20).
  const overigeGrens = Date.now() - 60 * 86400000;
  const needed = new Set((d.reviews || [])
    .filter((r) => r.status === 'pending' || (r.status === 'overige' && new Date(r.createdAt || 0).getTime() > overigeGrens))
    .map((r) => r.messageId).filter(Boolean));
  const keep = []; const archive = [];
  for (const m of msgs) {
    const t = m.receivedAt ? new Date(m.receivedAt).getTime() : (m.at ? new Date(m.at).getTime() : Date.now());
    if (t < cutoff && !needed.has(m.id)) archive.push(m); else keep.push(m);
  }
  if (!archive.length) return { archived: 0, remaining: keep.length };
  try {
    const dir = path.join(path.dirname(dbFilePath()), 'archives');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'messages-archive.jsonl'), archive.map((m) => JSON.stringify(m)).join('\n') + '\n');
  } catch (e) {
    console.error('[opschonen] archiefbestand schrijven mislukt — berichten NIET verwijderd:', e.message);
    return { archived: 0, remaining: msgs.length, error: e.message };
  }
  d.messages = keep;
  save();
  logActivity('systeem', 'oude berichten gearchiveerd', `${archive.length} berichten (>${days} dagen) naar archief`);
  return { archived: archive.length, remaining: keep.length };
}

// Is dit een 'afgehandelde' kolom (Afgerond/Geannuleerd)?
function isSecondaryStatus(statusKey) {
  const st = getStatuses().find((s) => s.key === statusKey);
  return !!(st && st.secondary);
}

// Kalenderdag (JJJJ-MM-DD) in Nederlandse tijd. Een afspraak staat als "kale" lokale tijd
// ("2026-10-18T10:00", datetime-local) opgeslagen → gewoon de datum eraf lezen; een
// tijdstip mét tijdzone (ISO met Z) omrekenen naar Amsterdam.
export function nlKalenderdag(waarde) {
  const t = String(waarde || '');
  if (/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.test(t)) return t.slice(0, 10);
  const d = new Date(t);
  return isNaN(d) ? '' : d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
}

// Bepaalt of een opdracht ingeklapt mag worden voor de af te sluiten week.
// AUDIT 16 okt 2026 (tellen van afgeronde opdrachten / DRS-rapport):
//  - het weekeinde was zondag 00:00 UTC i.p.v. zondag 23:59 NL → een opdracht met een
//    afspraak op ZONDAG bleef een week extra in de kolom Afgerond staan (en kon zo twee
//    keer in het dagrapport belanden). Nu op Nederlandse kalenderdag vergeleken;
//  - "afspraak ná deze week blijft staan" gold voor élke status → een afgeronde opdracht
//    met een (oude, verzette) afspraakdatum later bleef wekenlang staan. Geldt nu alleen
//    voor de afspraak-kolom; afgerond/geannuleerd gaan op het moment van afronden;
//  - een afspraak-kaart ZONDER datum werd ingeklapt terwijl de afspraak nog onbekend is.
function qualifies(order, week) {
  if (order.archivedWeek) return false;                 // al ingeklapt
  const zondag = week.endDate.toISOString().slice(0, 10); // zondag van de af te sluiten week
  if (order.status === appointmentStatusKey()) {
    if (!order.appointmentAt) return false;             // afspraak nog onbekend → blijft staan
    const dag = nlKalenderdag(order.appointmentAt);
    return !!dag && dag <= zondag;                      // afspraak ná deze week blijft staan
  }
  if (!isSecondaryStatus(order.status)) return false;   // open kolommen klappen nooit in
  // Afgehandeld NA het weekeinde (bv. maandag 00:10, vóór de ronde van dat uur)? Dan hoort
  // hij bij de nieuwe week en blijft hij nog staan.
  const sinds = order.completedAt || order.cancelledAt || order.statusSince;
  if (sinds && nlKalenderdag(sinds) > zondag) return false;
  return true;
}

// Voert de archivering uit voor elke nog niet-afgesloten week tot en met de
// laatst voltooide week. Veilig om vaak aan te roepen (doet niets dubbel).
export function runWeeklyArchive(reference = new Date()) {
  const week = completedWeek(reference);
  const settings = db().settings;
  if (settings.lastArchivedWeek === week.key) return { archived: 0, week };

  let count = 0;
  for (const order of db().orders) {
    if (qualifies(order, week)) {
      // updatedAt NIET meer ophogen (audit 16 okt): inklappen is geen wijziging door een
      // mens, en tellingen die op updatedAt terugvallen (geannuleerd in het weekrapport,
      // oude afgeronde kaarten zonder completedAt) schoven daardoor naar de volgende week.
      order.archivedWeek = { key: week.key, label: week.label, at: now() };
      count++;
    }
  }
  settings.lastArchivedWeek = week.key;
  saveSoon();
  if (count > 0) logActivity('systeem', 'week ingeklapt', `${week.label} — ${count} opdrachten`);
  return { archived: count, week };
}

// Start een lichte timer die elk uur controleert of er een week afgesloten
// moet worden. Draait ook één keer bij het opstarten (inhaalslag).
export function startWeeklyArchiver() {
  const tick = () => {
    try { runWeeklyArchive(); } catch (e) { console.error('Wekelijkse archivering faalde:', e.message); }
    // Hooguit één keer per dag oude berichten opschonen.
    try {
      const today = new Date().toISOString().slice(0, 10);
      if (db().settings._msgPruneDay !== today) {
        db().settings._msgPruneDay = today; saveSoon();
        const r = pruneOldMessages(90);
        if (r.archived) console.log(`[opschonen] ${r.archived} oude berichten gearchiveerd, ${r.remaining} nog in gebruik`);
      }
    } catch (e) { console.error('[opschonen] mislukt:', e.message); }
  };
  tick();
  setInterval(tick, 60 * 60 * 1000); // elk uur
}

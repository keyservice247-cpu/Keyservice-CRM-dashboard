// Wekelijks inklappen/archiveren van opdrachten.
//
// Regel (op verzoek): elke zondag ná 23:59 worden opdrachten ingeklapt onder een
// week-bundel met titel "agenda 18 t/m 24 mei '26", maar ALLEEN:
//   - "Afspraak ingepland" (mits de afspraak NIET ná die week valt), en
//   - afgehandelde kolommen "Afgerond" / "Geannuleerd".
// Nieuw / In behandeling / Offerte verzonden blijven ALTIJD op het bord staan
// (die mogen nooit inklappen, tenzij ze afgerond of geannuleerd worden).
import { db, now, saveSoon, logActivity } from './db.js';
import { appointmentStatusKey, getStatuses } from './settings.js';
import { completedWeek } from './week.js';

// Is dit een 'afgehandelde' kolom (Afgerond/Geannuleerd)?
function isSecondaryStatus(statusKey) {
  const st = getStatuses().find((s) => s.key === statusKey);
  return !!(st && st.secondary);
}

// Bepaalt of een opdracht ingeklapt mag worden voor de af te sluiten week.
function qualifies(order, week) {
  if (order.archivedWeek) return false;                 // al ingeklapt
  // Alleen 'Afspraak ingepland' en afgehandelde kolommen klappen wekelijks in.
  const mayCollapse = order.status === appointmentStatusKey() || isSecondaryStatus(order.status);
  if (!mayCollapse) return false;
  if (order.appointmentAt) {
    const appt = new Date(order.appointmentAt);
    if (!isNaN(appt) && appt > week.endDate) return false; // afspraak ná deze week blijft staan
  }
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
      order.archivedWeek = { key: week.key, label: week.label };
      order.updatedAt = now();
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
  };
  tick();
  setInterval(tick, 60 * 60 * 1000); // elk uur
}

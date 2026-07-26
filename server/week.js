// Hulpfuncties voor "weken" (maandag t/m zondag) in de tijdzone Europe/Amsterdam.
// Gebruikt voor het wekelijks inklappen/archiveren van opdrachten.

const MONTHS_NL = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

// Geeft de datum-onderdelen (jaar/maand/dag/uur/min) zoals ze in Amsterdam zijn.
export function amsterdamParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    weekday: 'short',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second) || 0,
    dow: weekdayMap[p.weekday] || 1, // 1 = maandag ... 7 = zondag
  };
}

// Bouwt een week-object (maandag 00:00 t/m zondag 23:59) rond een gegeven datum,
// op basis van de Amsterdamse kalender. Werkt met "kale" datums (lokaal middernacht).
function weekFor(date) {
  const a = amsterdamParts(date);
  // Maak een datum (UTC-vrij) voor de Amsterdamse dag, en schuif naar maandag.
  const base = new Date(Date.UTC(a.year, a.month - 1, a.day));
  const mondayOffset = a.dow - 1; // dagen terug naar maandag
  const monday = new Date(base); monday.setUTCDate(base.getUTCDate() - mondayOffset);
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
  return { monday, sunday };
}

function isoWeekKey(monday) {
  // Sleutel zoals "2026-05-18" (de maandag) — uniek en sorteerbaar.
  return monday.toISOString().slice(0, 10);
}

function label(monday, sunday) {
  const d1 = monday.getUTCDate();
  const d2 = sunday.getUTCDate();
  const m1 = MONTHS_NL[monday.getUTCMonth()];
  const m2 = MONTHS_NL[sunday.getUTCMonth()];
  const yr = `'${String(sunday.getUTCFullYear()).slice(-2)}`;
  if (m1 === m2) return `agenda ${d1} t/m ${d2} ${m1} ${yr}`;
  return `agenda ${d1} ${m1} t/m ${d2} ${m2} ${yr}`;
}

export function weekInfo(date) {
  const { monday, sunday } = weekFor(date);
  return {
    key: isoWeekKey(monday),
    label: label(monday, sunday),
    start: monday.toISOString(),
    // einde van de week = zondag 23:59 Amsterdamse tijd (benadering in UTC voldoende)
    endDate: sunday,
  };
}

// De week die "klaar" is om af te sluiten op het moment `now`:
// als nu voorbij zondag 23:59 van deze week is -> deze week; anders de vorige.
export function completedWeek(now = new Date()) {
  const a = amsterdamParts(now);
  const thisWeek = weekFor(now);
  // zondag 23:59 van deze week, in Amsterdamse kalender:
  const sundayEndPassed = a.dow === 7 && (a.hour > 23 || (a.hour === 23 && a.minute >= 59));
  if (sundayEndPassed) {
    return weekInfo(now); // sluit de zojuist geëindigde week af
  }
  // anders: de vorige (al geëindigde) week
  const prev = new Date(thisWeek.monday); prev.setUTCDate(prev.getUTCDate() - 1);
  return weekInfo(prev);
}

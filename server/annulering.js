// ANNULERINGSREDENEN (24 nov 2026, audit D11 + wens eigenaar: "als de AI alle annuleringen
// in oude kaarten kan checken kan hij zelf tot een conclusie komen wat de top 5 is").
// Twee lagen, bewust in deze volgorde:
//   1. VASTE REGELS: uit de notitie en de laatste berichten van een geannuleerde opdracht
//      wordt met trefwoorden een reden afgeleid. Zelfde tekst = altijd dezelfde reden, het
//      werkt zonder AI en ook voor alle oude opdrachten.
//   2. WAT EEN MENS KIEST WINT: bij annuleren kan kantoor/monteur een reden aanwijzen
//      (order.annulering = {reden, at, door}); het systeem stelt alleen voor.
// De AI komt er pas ná (conversie-briefing leest dit overzicht mee); hij beslist niets.
// Geen databasetoegang hier: de aanroeper geeft de opdrachten mee (los te testen).

export const STANDAARD_REDENEN = [
  { key: 'prijs', label: 'Te duur' },
  { key: 'ander', label: 'Andere partij gekozen' },
  { key: 'zelf', label: 'Zelf opgelost of niet meer nodig' },
  { key: 'geen_reactie', label: 'Klant reageert niet meer' },
  { key: 'afspraak', label: 'Afspraak afgezegd of niet thuis' },
  { key: 'niet_ons_werk', label: 'Kunnen wij niet uitvoeren' },
  { key: 'afstand', label: 'Te ver weg' },
  { key: 'dubbel', label: 'Dubbele aanvraag' },
  { key: 'anders', label: 'Anders' },
];
const LABELS = new Map(STANDAARD_REDENEN.map((r) => [r.key, r.label]));
export const isReden = (key) => LABELS.has(key);
export const redenLabel = (key) => LABELS.get(key) || (key === 'onbekend' ? 'Niet vastgelegd' : String(key || ''));

// Volgorde = voorrang: het meest specifieke eerst. "Te duur, we nemen een ander" is een
// prijskwestie; "dubbel" gaat voor alles (er is dan geen klant afgehaakt).
const REGELS = [
  ['dubbel', /\bdubbel(e|en)?\b|\bduplicaat\b|stond er al in|al (eerder )?(binnen|aangemaakt|ingevoerd)|zelfde (klant|opdracht|aanvraag)|samengevoegd/i],
  ['prijs', /te duur|\bduur\b|te hoog|\bprijs\b|\bkosten\b|\bbudget\b|geen geld|goedkoper|niet akkoord met de offerte|offerte (afgewezen|niet akkoord|te hoog)/i],
  ['ander', /ander(e)? (partij|bedrijf|slotenmaker|monteur|firma)|iemand anders|\bconcurrent\b|\belders\b|al (iemand|een ander)/i],
  ['zelf', /zelf (al )?(opgelost|gedaan|gemaakt|gerepareerd|vervangen|gefikst)|niet meer nodig|hoeft niet meer|is al opgelost|al verholpen|probleem (is )?(weg|verholpen|opgelost)|sleutel (weer |terug)?gevonden|verhuurder|woningbouw|\bvve\b regelt/i],
  ['afspraak', /niet thuis|afgezegd|afgebeld|niet komen opdagen|kwam niet opdagen|no.?show|afspraak (geannuleerd|afgezegd|vergeten)|komt niet uit/i],
  ['geen_reactie', /geen (reactie|gehoor|antwoord)|reageert niet|neemt niet op|niet bereikbaar|onbereikbaar|voicemail|niets meer (van )?gehoord/i],
  ['afstand', /te ver( weg)?\b|buiten (ons |het )?(werkgebied|de regio|regio)|\bafstand\b|\breistijd\b/i],
  ['niet_ons_werk', /doen wij niet|kunnen wij niet|niet (meer )?leverbaar|onderdeel (is )?niet|geen onderdelen|niet te repareren|niet ons werk|niet mogelijk|voeren wij niet uit/i],
];

/** Reden afleiden uit vrije tekst. '' = niets herkend. */
export function leidRedenAf(tekst) {
  const t = String(tekst || '');
  if (!t.trim()) return '';
  for (const [key, re] of REGELS) if (re.test(t)) return key;
  return '';
}

/** De tekst waar de reden meestal in staat: de notitie + de laatste paar berichten. */
export function annuleringsTekst(order) {
  if (!order) return '';
  const delen = [order.annulering && order.annulering.toelichting, order.notes];
  for (const t of (order.thread || []).slice(-4)) if (t && t.channel !== 'systeem') delen.push(t.body);
  return delen.filter(Boolean).join('\n').slice(0, 1500);
}

/** { key, bron } — bron 'gekozen' (door een mens), 'afgeleid' (regels) of 'onbekend'. */
export function redenVan(order) {
  const gekozen = order && order.annulering && order.annulering.reden;
  if (gekozen && isReden(gekozen)) return { key: gekozen, bron: 'gekozen' };
  const afgeleid = leidRedenAf(annuleringsTekst(order));
  return afgeleid ? { key: afgeleid, bron: 'afgeleid' } : { key: 'onbekend', bron: 'onbekend' };
}

/**
 * Overzicht voor Cijfers → Conversie: waarom haken klanten af?
 * @param {Array} orders   alle opdrachten (de functie kiest zelf de geannuleerde in de periode)
 * @param {number} vanMs   begin van de periode
 * @param {number} totMs   einde van de periode
 */
export function annuleringsOverzicht(orders, vanMs = 0, totMs = Date.now()) {
  return redenenTelling((orders || []).filter((o) => {
    if (!o || o.status !== 'geannuleerd' || o.deletedAt) return false;
    const t = new Date(o.cancelledAt || o.statusSince || o.updatedAt || o.createdAt || 0).getTime();
    return !!t && t >= vanMs && t <= totMs;
  }));
}

/** Telling over een lijst die de aanroeper al heeft gekozen (Conversie: de "verloren" opdrachten). */
export function redenenTelling(geannuleerd) {
  const tel = new Map(); let totaal = 0; let gekozen = 0; let afgeleid = 0;
  for (const o of geannuleerd || []) {
    if (!o) continue;
    const r = redenVan(o);
    totaal++; if (r.bron === 'gekozen') gekozen++; else if (r.bron === 'afgeleid') afgeleid++;
    tel.set(r.key, (tel.get(r.key) || 0) + 1);
  }
  const redenen = [...tel.entries()]
    .map(([key, aantal]) => ({ key, label: redenLabel(key), aantal, pct: totaal ? Math.round((aantal / totaal) * 100) : 0 }))
    // 'Niet vastgelegd' altijd onderaan: het is geen reden maar een gat in de gegevens.
    .sort((a, b) => ((a.key === 'onbekend') - (b.key === 'onbekend')) || (b.aantal - a.aantal) || a.label.localeCompare(b.label));
  return { totaal, gekozen, afgeleid, onbekend: tel.get('onbekend') || 0, redenen, top5: redenen.filter((r) => r.key !== 'onbekend').slice(0, 5) };
}

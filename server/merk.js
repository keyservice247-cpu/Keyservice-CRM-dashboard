// MERK PER OPDRACHT (24 nov 2026, audit D12 + eigenaar: "Key Service 24/7 is de hoofdnaam,
// Schuifpuiservice valt eronder — elk met aparte reviewpagina's en accounts").
// Een opdracht hoort bij één merk. Dat bepaalt naar welke REVIEWPAGINA de klant wordt
// gestuurd. Vaste regels, in deze volgorde:
//   1. wat een mens op de opdracht heeft gekozen (order.merk);
//   2. de website waar de aanvraag vandaan kwam (schuifpui-site → Schuifpuiservice);
//   3. het soort werk in de titel/omschrijving (schuifpui, hefschuif, loopwagens …);
//   4. anders Key Service 24/7.
// Geen databasetoegang: los te testen.

export const MERKEN = [
  { key: 'keyservice', naam: 'Key Service 24/7' },
  { key: 'schuifpui', naam: 'Schuifpuiservice' },
];
const NAMEN = new Map(MERKEN.map((m) => [m.key, m.naam]));
export const isMerk = (key) => NAMEN.has(key);
export const merkNaam = (key) => NAMEN.get(key) || NAMEN.get('keyservice');

const SITE_SCHUIFPUI = /schuifpuiservice\.com|schuifpuireparatie-[a-z]+\.(?:nl|pages\.dev)/i;
const SITE_KEYSERVICE = /keyservice247\.nl/i;
const WERK_SCHUIFPUI = /schuifpui|schuifdeur|hef-?schuif|kiep-?schuif|schuif-?kiep|loopwagen/i;

/** { key, bron } — bron: 'gekozen' | 'website' | 'werk' | 'standaard'. */
export function merkVan(order) {
  const o = order || {};
  if (isMerk(o.merk)) return { key: o.merk, bron: 'gekozen' };
  // Waar kwam de aanvraag binnen? Dat staat in de bron en in het eerste bericht.
  const herkomst = [o.source, ...(o.thread || []).slice(0, 2).map((t) => `${(t && t.subject) || ''}\n${(t && t.body) || ''}`)].filter(Boolean).join('\n').slice(0, 4000);
  if (SITE_SCHUIFPUI.test(herkomst)) return { key: 'schuifpui', bron: 'website' };
  if (SITE_KEYSERVICE.test(herkomst)) return { key: 'keyservice', bron: 'website' };
  const werk = [o.title, o.description, o.intake && o.intake.problem].filter(Boolean).join('\n');
  if (WERK_SCHUIFPUI.test(werk)) return { key: 'schuifpui', bron: 'werk' };
  return { key: 'keyservice', bron: 'standaard' };
}

/** Losse factuur zonder opdracht: het soort werk op de regels beslist. */
export function merkVanFactuur(inv) {
  const i = inv || {};
  if (isMerk(i.merk)) return { key: i.merk, bron: 'gekozen' };
  const regels = (i.lines || []).map((l) => (l && l.description) || '').join('\n') + '\n' + (i.note || '');
  return WERK_SCHUIFPUI.test(regels) ? { key: 'schuifpui', bron: 'werk' } : { key: 'keyservice', bron: 'standaard' };
}

/**
 * De reviewlink voor dit merk. Heeft het merk geen eigen link, dan de algemene link —
 * zo verandert er niets zolang er maar één link is ingevuld.
 * @param {string} merkKey
 * @param {{link?: string, links?: Record<string,string>}} cfg  uit getReviewRequest()
 */
export function reviewLinkVoor(merkKey, cfg) {
  const c = cfg || {};
  const eigen = c.links && String(c.links[merkKey] || '').trim();
  return eigen || String(c.link || '').trim();
}

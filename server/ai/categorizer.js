// AI-categorisatie van inkomende berichten (e-mail / WhatsApp).
//
// Twee modi:
//  1) DEMO-modus (geen ANTHROPIC_API_KEY): categorisatie op basis van regels/keywords.
//     Werkt direct, zonder kosten, zodat je het systeem kunt zien werken.
//  2) AI-modus (met ANTHROPIC_API_KEY): vraagt het Claude-model om een gestructureerde
//     beoordeling. Valt automatisch terug op de regels als de AI faalt.
//
// De uitvoer is altijd hetzelfde formaat, zodat de rest van de app er niet om geeft
// welke modus actief is.
import { recordAIUsage } from '../usage.js';
import { isWhatsappOrderGroup } from '../settings.js';

// De vaste "denkcategorieën" die de AI gebruikt. De échte kolommen in het
// dashboard zijn instelbaar (zie server/settings.js); na categorisatie wordt
// de keuze daar zo nodig op teruggelegd.
export const CANONICAL_STATUSES = ['open', 'offerte_verzonden', 'afspraak_ingepland', 'afgerond', 'geannuleerd'];

const CANONICAL_LABELS = {
  open: 'Open / Nieuw',
  offerte_verzonden: 'Offerte verzonden',
  afspraak_ingepland: 'Afspraak ingepland',
  afgerond: 'Afgerond',
  geannuleerd: 'Geannuleerd',
};

const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
// Nederlands adres: straat + huisnummer (bv. "Hoofdstraat 12" of "Kerklaan 3A")
const ADDRESS_RE = /([A-Z][a-zà-ÿ'.-]+(?:\s[A-Z]?[a-zà-ÿ'.-]+){0,3}(?:straat|laan|weg|plein|kade|dijk|gracht|hof|pad|dreef|singel|park|baan|steeg|markt|plantsoen)\s?\d{1,4}\s?[a-zA-Z]?)/;
// Postcode + plaats (bv. "1234 AB Amsterdam" of "5056AC Berkel-Enschot"). De spatie
// tussen cijfers en letters is OPTIONEEL: monteurs en DRS schrijven de postcode in het
// dagrapport meestal aaneen ("5056AC"), en die viel er voorheen volledig af — waardoor
// een rapportregel niet meer aan een kaart te koppelen was. Geen cijfer ervoor, zodat
// telefoonnummers niet meetellen. De plaatsnaam mag uit meerdere woorden bestaan
// ("Berkel-Enschot", "Den Bosch", "'s-Hertogenbosch").
const POSTCODE_RE = /(?<!\d)(\d{4}[ \t]?[A-Za-z]{2})\b(?:[ \t]+((?:'?[A-Za-zà-ÿ][a-zà-ÿ'.-]*)(?:[ \t]+(?:van|de|den|der|het|aan|op|'?[A-Z][a-zà-ÿ'.-]*))*))?/;

function pick(text, re) {
  const m = (text || '').match(re);
  return m ? (m[1] || m[0]).trim() : null;
}

// Bepaalt of een bericht een echte werk-aanvraag is of "ruis" (geklets, bedankjes,
// losse reacties). Geeft { relevant: bool, reason }. Vooral voor drukke groepen.
const WORK_WORDS = /(slot|sleutel|cilinder|schuifpui|hefschuifpui|deur|raam|kozijn|sloten|inbra|buitengesloten|buitensluit|kapot|klemt|defect|stuk|vervang|repareer|reparatie|monteur|offerte|prijs|kosten|wat kost|afspraak|inplannen|langskomen|adres|woonplaats|spoed|loopwagen|rail|beslag|hang|scharnier|montage|installat)/i;
// STERKE slotenmaker-aanvraag: concrete fysieke termen. Deze wegen zwaarder dan de
// "geen-opdracht"-filter, zodat een echte klantaanvraag nooit als ruis wegvalt —
// ook al staat er toevallig een woord als "offerte" of "aanbieding" in.
// "buitensluit" dekt óók "buitensluiting" — het DRS-woord voor buitengesloten
// (17 aug: een 98%-zekere DRS-opdracht belandde in Overige omdat alleen
// "buitengesloten" in de lijst stond en "factuur DRS" in de opmerking het
// NOT_ORDER-filter triggerde).
const STRONG_WORK = /(slot|sleutel|cilinder|schuifpui|hefschuifpui|kozijn|sloten|inbra|buitengesloten|buitensluit|loopwagen|rail|beslag|scharnier|deur|raam|montage|installat|reparatie|repareer|monteur|kapot|klemt|defect|vervang)/i;
const CHATTER_ONLY = /^(ok|oké|oke|oke[ëe]|top|prima|bedankt|dankje|dank je|dankjewel|thanks|thx|ja|nee|goed|mooi|super|perfect|duidelijk|👍|🙏|😂|😅|🙂|❤️|\?+|\.+|haha+|hihi+|proficiat|gefeliciteerd|goedemorgen|goedemiddag|goedenavond|hoi|hallo|hey|doei|tot ziens|fijne dag|welkom)[\s!.,👍🙏🙂😂😅❤️]*$/i;
// Sterke signalen dat het GEEN klantopdracht is (incasso/leverancier/reclame/admin).
// LET OP: "offerte van" is hier bewust NIET opgenomen — klanten vragen juist een
// offerte aan ("ik ontvang graag een offerte van jullie") en dat is een echte opdracht.
const NOT_ORDER_WORDS = /(incasso|aanmaning|herinnering betaling|betalingsherinnering|deurwaarder|factuur|factuurnummer|automatische incasso|nieuwsbrief|uitschrijven|afmelden|unsubscribe|leverancier|inkoop|bestelling bevestig|orderbevestiging|btw-aangifte|belastingdienst|kvk|verzekering|abonnement|webinar|vacature|sollicitat|no-?reply|noreply|bing|microsoft advertising|places for business|google ads|adwords|seo|advertenti|marketing|nieuwe manieren om je bedrijf)/i;

export function scoreRelevance({ subject, body, hasAttachments }, strict = false) {
  const text = `${subject || ''} ${body || ''}`.trim();
  const clean = text.replace(/telefoon:\s*\+?\d+/gi, '').trim(); // nummer dat bridge toevoegt niet meetellen
  const words = clean.split(/\s+/).filter(Boolean);

  // Foto/video van een klant is bijna altijd relevant (vaak schade/situatie).
  if (hasAttachments) return { relevant: true, reason: 'Bevat foto/bestand.' };
  // STERKE slotenmaker-aanvraag wint van de ruisfilter (mis nooit een echte opdracht).
  if (STRONG_WORK.test(clean)) return { relevant: true, reason: 'Concrete slotenmaker-aanvraag.' };

  // Sterke "geen opdracht"-signalen (incasso/leverancier/reclame/administratie).
  if (NOT_ORDER_WORDS.test(clean)) return { relevant: false, reason: 'Lijkt geen klantopdracht (incasso/leverancier/reclame/administratie).' };

  // Duidelijke werk-termen (ook zwakkere: offerte/prijs/afspraak) -> relevant.
  if (WORK_WORDS.test(clean)) return { relevant: true, reason: 'Bevat een aanvraag/werk-term.' };
  // Telefoon of adres genoemd -> waarschijnlijk een aanvraag.
  if (PHONE_RE.test(clean) || ADDRESS_RE.test(clean) || POSTCODE_RE.test(clean)) {
    return { relevant: true, reason: 'Bevat contact-/adresgegevens.' };
  }
  // Heel kort en/of puur geklets -> ruis.
  if (clean.length < 12 || words.length <= 2) return { relevant: false, reason: 'Te kort / losse reactie.' };
  if (CHATTER_ONLY.test(clean)) return { relevant: false, reason: 'Geklets/bevestiging zonder aanvraag.' };
  // Strenge modus (opschonen): geen enkel werk-/contactsignaal gevonden -> ruis.
  if (strict) return { relevant: false, reason: 'Geen aanvraag-signaal (geen werk-term, telefoon of adres).' };
  // Normale modus: twijfelgeval -> laat het in de inbox (liever te veel dan iets missen).
  return { relevant: true, reason: 'Twijfelgeval — voor de zekerheid in de inbox.' };
}

function cleanName(sender) {
  if (!sender) return null;
  // "Jan Jansen <jan@x.nl>" -> "Jan Jansen"
  const m = sender.match(/^\s*"?([^"<]+?)"?\s*<.*>/);
  if (m) return m[1].trim();
  if (EMAIL_RE.test(sender)) return sender.split('@')[0].replace(/[._]/g, ' ').trim();
  return sender.trim();
}

// Een waarde die met een label is aangegeven, bv. "Naam: Jan", "Tel 06-..".
// De waarde stopt bij een zin-einde, nieuwe regel of een volgend labelwoord,
// zodat we niet de hele zin meepakken.
const STOP_WORDS = 'telefoon|telefoonnummer|tel|mobiel|gsm|nummer|adres|straat|woonplaats|plaats|locatie|postcode|email|e-mail|naam';
function pickLabeled(text, labels, { keepComma = false } = {}) {
  for (const label of labels) {
    // sta "naam is X", "naam: X", "naam X" toe; stop bij . , \n of volgend label.
    // BIJ EEN ADRES stoppen we NIET op de komma: "Kerkstraat 12, 5056 AC Berkel-Enschot"
    // bleef anders steken op "Kerkstraat 12" — zonder postcode is een rapportregel
    // niet meer aan de kaart te koppelen.
    const stop = keepComma ? '[^\\n;]' : '[^\\n.,;]';
    const re = new RegExp(`\\b${label}\\b\\s*(?:is|:|=|-)?\\s*(${stop}{2,80})`, 'i');
    const m = (text || '').match(re);
    if (m && m[1]) {
      let v = m[1].trim();
      // knip af bij een volgend labelwoord dat per ongeluk meeliep
      v = v.split(new RegExp(`\\b(?:${STOP_WORDS})\\b`, 'i'))[0].trim();
      if (v) return v.slice(0, 80);
    }
  }
  return null;
}

// Zoekt een patroon (e-mail/telefoon) dat ná een label staat. Pakt een ruime
// strook tekst na het label (mag punten bevatten, zodat e-mailadressen heel
// blijven) en haalt daar het patroon uit. Zo wint "Email: klant@x.nl" van een
// bedrijfsadres elders in de mail.
function pickLabeledPattern(text, labels, re) {
  for (const label of labels) {
    const lre = new RegExp(`\\b${label}\\b\\s*(?:is|:|=|-)?\\s*([^\\n]{2,120})`, 'i');
    const m = (text || '').match(lre);
    if (m && m[1]) {
      const found = m[1].match(re);
      if (found) return found[1] || found[0];
    }
  }
  return null;
}

// Naam: 1–4 woorden met hoofdletter, evt. met tussenvoegsels (de, van, der).
// Belangrijk: blijft binnen één regel (geen \n), zodat de naam niet doorloopt
// in het eerste woord van de volgende zin.
function pickName(text) {
  const m = (text || '').match(/(?:naam[ \t]*(?:is|:)?[ \t]*)?([A-Z][a-zà-ÿ]+(?:[ \t]+(?:de|van|der|den|ten|te|het|el|al|bin)?[ \t]?[A-Z][a-zà-ÿ]+){0,3})/);
  return m ? m[1].trim() : null;
}

function cleanPhone(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d+]/g, '');
  return cleaned.replace(/\D/g, '').length >= 8 ? cleaned : null;
}

// Haalt klantgegevens uit vrije (geplakte) tekst: naam, telefoon, e-mail, adres,
// en een korte probleemomschrijving.
// BELANGRIJK: gelabelde velden ("Naam:", "Email:", "Telefoon:") krijgen altijd
// voorrang — dat zijn de gegevens die de klant zelf invult. Pas als een label
// ontbreekt, valt hij terug op een vrije zoektocht in de tekst (zodat een
// bedrijfsnummer/handtekening niet per ongeluk wordt overgenomen).
export function extractDetails(text) {
  const t = text || '';

  // Telefoon: eerst het gelabelde klantnummer (let op: 'telefoon' vóór 'tel'
  // zodat "Telefoon:" wint van een los "<tel:...>").
  let phone = cleanPhone(pickLabeledPattern(t, ['telefoonnummer', 'telefoon', 'mobiel', 'gsm', 'tel'], PHONE_RE));
  if (!phone) phone = cleanPhone(pick(t, PHONE_RE));

  // E-mail: eerst gelabeld, anders eerste e-mail in de tekst.
  let email = pickLabeledPattern(t, ['e-mailadres', 'emailadres', 'e-mail', 'email', 'mail'], EMAIL_RE);
  if (!email) email = pick(t, EMAIL_RE);

  // Naam: eerst via label, anders patroon.
  let name = pickLabeled(t, ['naam', 'voornaam', 'achternaam']);
  if (name) name = name.replace(/^is\s+/i, '').trim();
  if (!name) name = pickName(t);

  // Adres: eerst gelabeld, anders straat + huisnummer / postcode + plaats.
  let address = pickLabeled(t, ['adres', 'woonplaats', 'volledig adres'], { keepComma: true });
  if (!address) {
    const street = pick(t, ADDRESS_RE);
    const pc = t.match(POSTCODE_RE);
    address = [street, pc ? pc[0].trim() : null].filter(Boolean).join(', ') || null;
  }

  // Probleemomschrijving: zin met een probleem-werkwoord, anders eerste lange zin
  // zonder pure contactgegevens.
  const sentences = t.split(/(?<=[.!?])\s+|\n+/).map((l) => l.trim()).filter(Boolean);
  const problemWords = /(klemt|kapot|stuk|kromt|hapert|zwaar|defect|vervang|repareer|maken|los|lekt|sluit niet|gaat niet|open|slot|sleutel|schuifpui|deur|raam|hang)/i;
  let problem = sentences.find((s) => problemWords.test(s) && s.length >= 12);
  if (!problem) {
    problem = sentences.find((s) => {
      if (/^(naam|tel|telefoon|adres|e-?mail|mobiel|postcode|plaats|woonplaats)\b/i.test(s)) return false;
      return s.length >= 15;
    });
  }
  // Haal contactgegevens uit de probleemzin weg voor de leesbaarheid.
  if (problem) {
    problem = problem.replace(EMAIL_RE, '').replace(PHONE_RE, '').replace(/\s{2,}/g, ' ').trim();
  }

  return {
    customerPhone: phone,
    customerEmail: email,
    customerName: name,
    customerAddress: address,
    problem: problem ? problem.slice(0, 200) : null,
  };
}

// --- DEMO-modus: regels ---
export function classifyWithRules({ channel, sender, subject, body }) {
  const text = `${subject || ''}\n${body || ''}`.toLowerCase();
  let status = 'open';
  const reasons = [];
  let confidence = 0.55;

  const has = (...words) => words.some((w) => text.includes(w));

  if (has('annuleer', 'annuleren', 'geannuleerd', 'gaat niet door', 'niet meer nodig', 'afzeggen', 'afgezegd')) {
    status = 'geannuleerd';
    confidence = 0.8;
    reasons.push('Bericht bevat woorden die op annulering wijzen.');
  } else if (has('afgerond', 'opgelost', 'gerepareerd', 'gefixt', 'is gemaakt', 'probleem verholpen', 'klaar gemaakt', 'betaald')) {
    status = 'afgerond';
    confidence = 0.75;
    reasons.push('Bericht lijkt erop te wijzen dat de klus is afgerond.');
  } else if (has('afspraak', 'inplannen', 'ingepland', 'langskomen', 'wanneer kun', 'kunnen jullie komen', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag')) {
    status = 'afspraak_ingepland';
    confidence = 0.7;
    reasons.push('Bericht lijkt over het inplannen van een afspraak te gaan.');
  } else if (has('offerte verstuurd', 'offerte verzonden', 'prijsopgave verstuurd')) {
    status = 'offerte_verzonden';
    confidence = 0.7;
    reasons.push('Bericht verwijst naar een verzonden offerte.');
  } else if (has('offerte', 'prijsopgave', 'wat kost', 'prijs', 'kosten', 'aanvraag')) {
    status = 'open';
    confidence = 0.75;
    reasons.push('Nieuwe aanvraag/offerteverzoek: nieuwe opdracht in "Open".');
  } else {
    reasons.push('Geen duidelijke signalen gevonden; standaard ingedeeld als "Open".');
  }

  // Onderwerp / urgentie hints
  const urgent = has('spoed', 'direct', 'snel', 'noodgeval', 'buitengesloten', 'kom ik niet binnen');
  if (urgent) reasons.push('Lijkt urgent (spoed/buitengesloten).');

  // Gegevens uit de tekst halen, met de afzender als aanvulling.
  const det = extractDetails(`${sender || ''}\n${body || ''}`);
  const customerPhone = det.customerPhone || pick(`${sender} ${body}`, PHONE_RE);
  const customerEmail = det.customerEmail || pick(`${sender} ${body}`, EMAIL_RE);
  const customerName = det.customerName || cleanName(sender);
  const customerAddress = det.customerAddress || null;

  const title =
    (subject && subject.trim()) ||
    (det.problem && det.problem.slice(0, 80)) ||
    (body || '').trim().split('\n')[0].slice(0, 80) ||
    `Nieuw bericht via ${channel}`;

  return {
    status,
    title: title.slice(0, 120),
    customerName,
    customerPhone,
    customerEmail,
    customerAddress,
    problem: det.problem,
    urgent,
    confidence: Math.round(confidence * 100) / 100,
    reasoning: reasons.join(' '),
    engine: 'regels',
  };
}

// Bouwt een leerblok van eerdere team-correcties. Correcties (mens koos andere
// categorie) wegen zwaarder dan afwijzingen, en worden vooraan gezet.
function learningsBlock(learnings) {
  if (!learnings || !learnings.length) return '';
  // Sorteer: echte correcties eerst, dan de rest; max 15 voorbeelden.
  const sorted = [...learnings].sort((a, b) => {
    const ca = a.shouldBe ? 0 : 1, cb = b.shouldBe ? 0 : 1;
    return ca - cb;
  }).slice(0, 15);
  const lines = sorted.map((f, i) => {
    const bits = [];
    if (f.shouldBe) bits.push(`CORRECTIE: moet "${f.shouldBe}" zijn (AI koos eerder "${f.aiStatus || '?'}")`);
    else bits.push(`Reden afwijzing: ${f.reason}`);
    if (f.note) bits.push(`uitleg: ${f.note}`);
    if (f.sample) bits.push(`bericht leek op: "${(f.sample || '').replace(/\s+/g, ' ').slice(0, 140)}"`);
    return `${i + 1}. ${bits.join(' | ')}`;
  });
  return `\n\nBELANGRIJK — leer van deze eerdere correcties van het team en pas je oordeel hierop aan.
Als een nieuw bericht lijkt op een van deze voorbeelden, volg dan de correctie/het advies:
${lines.join('\n')}`;
}

// --- AI-modus: Claude ---
async function classifyWithClaude(message) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

  const system = `Je bent een assistent voor een sleutel-/slotenmaker-bedrijf (Keyservice).
${message.companyProfile ? `\nOVER HET BEDRIJF (gebruik dit om aanvragen goed te begrijpen):\n${message.companyProfile}\n` : ''}
Je categoriseert inkomende klantberichten (e-mail of WhatsApp) voor een opdrachten-dashboard
en haalt de klantgegevens eruit.
Kies precies één status uit deze lijst:
- "open": nieuwe aanvraag of offerteverzoek dat nog opgepakt moet worden.
- "offerte_verzonden": er is al een offerte/prijsopgave naar de klant gestuurd.
- "afspraak_ingepland": het gaat over het maken/bevestigen van een afspraak of langskomen.
- "afgerond": de klus is uitgevoerd/klaar/opgelost.
- "geannuleerd": de klant annuleert of zegt af.

BELANGRIJK bij de klantgegevens:
- Pak de gegevens van de KLANT, niet van Keyservice zelf. Negeer handtekeningen,
  bedrijfsregels of footers met "Key Service", "info@keyservice247.nl" of nummers
  als 085-..., en negeer doorstuur-/website-systeemteksten.
- Velden met labels ("Naam:", "Email:", "Telefoon:", "Adres:") zijn leidend.
- Maak een korte, duidelijke probleemomschrijving in 1 zin.

CRUCIAAL — bepaal eerst of dit überhaupt een opdracht is:
Geef een veld "isOpdracht" (true/false): is dit een ECHTE klantaanvraag/opdracht
voor een sleutel-/slotenmaker? Zet "isOpdracht": false bij incasso, aanmaning,
factuur, leverancier, reclame, nieuwsbrief, bank, overheid, intern bericht of
geklets — ZELFS als er een bedrag of urgentie in staat.
Het veld "confidence" betekent: hoe zeker ben je dat dit een ECHTE opdracht is
ÉN in de juiste kolom staat. Is "isOpdracht" false, geef dan confidence MAXIMAAL 0.15.
Het team heeft eerder berichten afgewezen — leer daar streng van.
Antwoord UITSLUITEND met geldige JSON, geen extra tekst.${message.rejectSummary ? `\n\nSAMENVATTING van alle afwijzingen door het team:\n${message.rejectSummary}` : ''}${learningsBlock(message.learnings)}`;

  const user = `Bericht-kanaal: ${message.channel}
Afzender: ${message.sender || '(onbekend)'}
Onderwerp: ${message.subject || '(geen)'}
Inhoud:
"""
${(message.body || '').slice(0, 4000)}
"""

Geef JSON met exact deze velden:
{
  "isOpdracht": true/false,
  "status": "open|offerte_verzonden|afspraak_ingepland|afgerond|geannuleerd",
  "title": "korte titel; BEGIN ALTIJD MET DE PLAATSNAAM van de klant als die bekend is, dan een streepje en het probleem (bv. \\"Hoogerheide — slot voordeur eruit gekomen\\"); max 120 tekens",
  "customerName": "naam klant of null",
  "customerPhone": "telefoonnummer of null",
  "customerEmail": "e-mailadres of null",
  "customerAddress": "adres/woonplaats of null",
  "problem": "korte probleemomschrijving of null",
  "urgent": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "korte uitleg in het Nederlands waarom je deze status koos"
}`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!resp.ok) {
    throw new Error(`Claude API gaf status ${resp.status}: ${await resp.text()}`);
  }

  const json = await resp.json();
  recordAIUsage(json.usage, model);
  const text = (json.content || []).map((c) => c.text || '').join('').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Geen JSON in AI-antwoord');
  const parsed = JSON.parse(match[0]);

  if (!CANONICAL_STATUSES.includes(parsed.status)) parsed.status = 'open';
  parsed.confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5));
  parsed.engine = `ai:${model}`;

  // BELANGRIJK: 'confidence' is de zekerheid over de KOLOM, niet of het een echte
  // opdracht is. Zegt de AI zelf dat het GEEN opdracht is (incasso/leverancier/
  // reclame/intern), dan markeren we het als niet-relevant én verlagen we de
  // zekerheid, zodat automatisch accepteren het nooit oppakt.
  parsed.isOpdracht = parsed.isOpdracht !== false; // default true tenzij expliciet false
  if (!parsed.isOpdracht) {
    parsed.aiNotOrder = true;
    parsed.confidence = Math.min(parsed.confidence, 0.2);
  }

  // Veiligheidsnet: vul ontbrekende velden aan met de regel-extractie, die heel
  // betrouwbaar gelabelde gegevens en het juiste telefoonnummer pakt.
  const det = extractDetails(`${message.sender || ''}\n${message.body || ''}`);
  parsed.customerName = parsed.customerName || det.customerName;
  parsed.customerPhone = parsed.customerPhone || det.customerPhone;
  parsed.customerEmail = parsed.customerEmail || det.customerEmail;
  parsed.customerAddress = parsed.customerAddress || det.customerAddress;
  parsed.problem = parsed.problem || det.problem;
  return parsed;
}

export async function classify(message) {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await classifyWithClaude(message);
    } catch (err) {
      console.error('AI-categorisatie mislukt, val terug op regels:', err.message);
      const rules = classifyWithRules(message);
      rules.reasoning += ` (Let op: AI faalde, regels gebruikt. ${err.message})`;
      rules.engine = 'regels (ai-fallback)';
      return rules;
    }
  }
  return classifyWithRules(message);
}

export function aiMode() {
  return process.env.ANTHROPIC_API_KEY ? 'ai' : 'demo';
}

// Stelt een concept-antwoord voor een klant op, op basis van het probleem,
// de gesprekshistorie en (optioneel) je standaardsjablonen. Vereist de AI-modus.
export async function suggestReply({ customerName, problem, history = '', templates = [], companyProfile = '' }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
  if (!apiKey) {
    // Demo-modus: geen AI -> geef het meest relevante sjabloon terug (of leeg).
    const t = templates[0];
    return { text: t ? t.body : '', engine: 'demo (geen AI)' };
  }

  const tmplText = templates.length
    ? `\n\nBeschikbare standaardteksten (gebruik/combineer indien passend):\n${templates.map((t) => `- ${t.title}: ${t.body}`).join('\n')}`
    : '';

  const system = `Je bent de klantenservice van Keyservice, een sleutel-/slotenmakerbedrijf.
${companyProfile ? `\nOVER HET BEDRIJF:\n${companyProfile}\n` : ''}
Schrijf een vriendelijk, professioneel en BONDIG concept-antwoord in het Nederlands aan de klant.
- Spreek de klant netjes aan${customerName ? ` (klant: ${customerName})` : ''}.
- Beantwoord of help met het probleem; vraag om ontbrekende info (foto's, maten, adres) als dat nodig is.
- Geen verzonnen prijzen of garanties; gebruik alleen info uit de standaardteksten als die past.
- Eindig met een nette afsluiting namens Keyservice.
Antwoord met ALLEEN de e-mailtekst, geen uitleg eromheen.${tmplText}`;

  const user = `Probleem/omschrijving van de klant: ${problem || '(onbekend)'}
${history ? `\nGesprekshistorie:\n${history.slice(0, 2000)}` : ''}`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 700, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!resp.ok) throw new Error(`Claude API gaf status ${resp.status}`);
  const json = await resp.json();
  recordAIUsage(json.usage, model);
  const text = (json.content || []).map((c) => c.text || '').join('').trim();
  return { text, engine: `ai:${model}` };
}

// Analyseert een berg berichten (WhatsApp/e-mail) en geeft inzichten terug:
// veelgevraagde diensten, terugkerende patronen, en verbeterpunten.
export async function analyzeTraffic({ messages = [], companyProfile = '' }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  // Voor een grondige analyse gebruiken we een sterker model als dat kan.
  const model = process.env.ANTHROPIC_ANALYZE_MODEL || 'claude-sonnet-5';
  if (!apiKey) return { text: 'Zet eerst de AI aan (ANTHROPIC_API_KEY) om analyses te draaien.', engine: 'demo' };
  if (!messages.length) return { text: 'Geen berichten om te analyseren.', engine: 'n.v.t.' };

  // Beperk de hoeveelheid tekst (kosten/limiet): neem tot 200 berichten, ingekort.
  const sample = messages.slice(0, 200).map((m, i) =>
    `[${i + 1}] (${m.channel}) ${m.sender || ''}: ${(m.body || '').replace(/\s+/g, ' ').slice(0, 300)}`
  ).join('\n');

  const system = `Je bent een data-analist voor Keyservice, een sleutel-/slotenmakersbedrijf.
${companyProfile ? `\nOver het bedrijf:\n${companyProfile}\n` : ''}
Je krijgt een verzameling inkomende klantberichten (WhatsApp/e-mail). Analyseer ze en
geef een helder, praktisch rapport in het Nederlands met deze kopjes:
1. Meest gevraagde diensten/klussen (met aantallen/percentages indien mogelijk)
2. Terugkerende patronen (typische vragen, drukke momenten, soorten klanten)
3. Veelvoorkomende ruis/niet-opdrachten
4. Concrete verbeterpunten voor de werkwijze (bv. standaardvragen, snellere reactie)
Houd het bondig en bruikbaar. Geen verzonnen cijfers — baseer je op wat je ziet.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 4000, system, messages: [{ role: 'user', content: `Berichten:\n${sample}` }] }),
  });
  if (!resp.ok) throw new Error(`Claude API gaf status ${resp.status}`);
  const json = await resp.json();
  recordAIUsage(json.usage, model);
  const text = (json.content || []).map((c) => c.text || '').join('').trim();
  return { text, engine: `ai:${model}`, analyzed: Math.min(messages.length, 200) };
}

// Korte AI-duiding voor de ochtendbriefing: 2-3 zinnen "focus vandaag op X, want Y".
// Zonder API-key of bij een fout komt er gewoon '' terug — de briefing zelf (de
// feiten) gaat dan alsnog uit, alleen zonder duiding.
export async function morningInsight({ facts, companyProfile = '', tone = 'coachend' }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !facts) return '';
  const model = process.env.ANTHROPIC_ANALYZE_MODEL || 'claude-sonnet-5';
  const stijl = tone === 'zakelijk'
    ? 'Zakelijk en puntig, alleen de kern.'
    : 'Coachend en menselijk, alsof een slimme rechterhand even meedenkt.';
  const system = `Je bent de operationeel rechterhand van Keyservice, een sleutel-/slotenmakersbedrijf. Je krijgt de feiten van vanochtend uit het CRM. Schrijf in het Nederlands een korte duiding van 2 à 3 zinnen: waar moet vandaag de focus liggen en waarom. Verwijs naar concrete aantallen of namen uit de feiten. Geen opsomming, geen begroeting, geen emoji. ${stijl}${companyProfile ? `\n\nOver het bedrijf:\n${String(companyProfile).slice(0, 1500)}` : ''}`;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 300, system, messages: [{ role: 'user', content: `Feiten van vanochtend:\n${facts}` }] }),
    });
    if (!resp.ok) return '';
    const json = await resp.json();
    recordAIUsage(json.usage, model);
    return (json.content || []).map((c) => c.text || '').join('').trim();
  } catch { return ''; }
}

// Repareert een AFGEKAPTE JSON (het antwoord stopte middenin). Gooit de laatste,
// onvolledige waarde weg en sluit alle nog open haakjes/accolades netjes af, zodat
// een half antwoord tóch bruikbaar is in plaats van helemaal verloren te gaan.
export function repairTruncatedJson(raw) {
  let s = String(raw || '').trim();
  if (!s.startsWith('{')) return null;
  // 1. Loop door de tekst en houd bij: zitten we in een string, en welke haakjes
  //    staan er nog open? Onthoud de laatste positie waar de JSON "heel" was.
  const stack = [];
  let inStr = false; let esc = false; let veiligTot = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { if (inStr) esc = true; continue; }
    if (ch === '"') { inStr = !inStr; if (!inStr) veiligTot = i; continue; }
    if (inStr) continue;
    if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') { stack.pop(); veiligTot = i; }
    else if (ch === ',' || /\d/.test(ch) || ch === 'e' || ch === 'l') veiligTot = i; // cijfers/true/null
  }
  if (!stack.length) { try { return JSON.parse(s); } catch { /* verderop repareren */ } }
  // 2. Knip af tot het laatste punt waarop de JSON heel was, haal een losse komma
  //    of half sleutelwoord weg, en sluit daarna alles wat nog openstaat.
  if (veiligTot > 0) s = s.slice(0, veiligTot + 1);
  s = s.replace(/,\s*$/, '')
    .replace(/[,{[]\s*"[^"]*$/, '')          // halve string ("wacht al…)
    .replace(/[,{]\s*"[^"]*"\s*:?\s*$/, '')  // sleutel zonder waarde ("waarom":)
    .replace(/,\s*$/, '');
  // Opnieuw tellen na het knippen (er kunnen haakjes zijn weggevallen).
  const stack2 = [];
  let inStr2 = false; let esc2 = false;
  for (const ch of s) {
    if (esc2) { esc2 = false; continue; }
    if (ch === '\\') { if (inStr2) esc2 = true; continue; }
    if (ch === '"') { inStr2 = !inStr2; continue; }
    if (inStr2) continue;
    if (ch === '{' || ch === '[') stack2.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') stack2.pop();
  }
  if (inStr2) s += '"';
  s = s.replace(/,\s*$/, '');
  while (stack2.length) s += stack2.pop();
  try { return JSON.parse(s); } catch { return null; }
}

// AI-DAGOVERZICHT (Start-pagina): leest de dashboard-feiten + het échte verkeer
// (WhatsApp ≤7 dagen, e-mail ≤14 dagen) en geeft een gestructureerd overzicht
// terug als JSON — kop, acties (met prioriteit + waar te klikken), kansen en
// risico's. Model instelbaar tot Opus-niveau (Instellingen → AI).
export async function dayOverview({ corpus = '', facts = '', companyProfile = '', model = '' }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'geen-ai' };
  const useModel = model || process.env.ANTHROPIC_ANALYZE_MODEL || 'claude-sonnet-5';
  const system = `Je bent de scherpe operationeel rechterhand van Keyservice (sleutel-/slotenmakersbedrijf). Je krijgt (1) feiten uit het CRM-dashboard en (2) het ruwe berichtenverkeer van de afgelopen dagen. Maak daar het dagoverzicht van voor de eigenaar/assistente.
${companyProfile ? `\nOver het bedrijf:\n${String(companyProfile).slice(0, 1500)}\n` : ''}
Antwoord UITSLUITEND met geldige JSON (geen tekst eromheen, geen markdown):
{"kop":"één krachtige zin die de dag samenvat",
 "acties":[{"prio":"hoog","titel":"...","waarom":"...","waar":"inbox"}],
 "beantwoorden":[{"wie":"naam of afzender","kanaal":"email","waarover":"...","urgent":true}],
 "kansen":["..."],
 "risicos":["..."]}
Regels: max 6 acties (belangrijkste eerst; prio = "hoog"|"middel"|"laag"; waar = "inbox"|"opdrachten"|"facturen"|"agenda"|"klanten"). "beantwoorden" = jouw ADVISEURSROL: max 5 berichten/mails uit het verkeer die een antwoord verwachten of te belangrijk zijn om te missen (wachtende klanten, vragen zonder reactie, boze of dringende toon, zakelijke kansen; kanaal = "email"|"whatsapp"; urgent alleen bij echte haast) — sla over wat al beantwoord lijkt. Max 3 kansen (omzet/vervolgklussen die je in het verkeer ziet), max 3 risico's (dingen die stil dreigen mis te gaan). Wees CONCREET: gebruik namen, plaatsen en bedragen uit de gegevens. Nederlands, geen emoji, geen verzinsels — alleen wat je echt ziet.`;
  // Overbelasting/rate-limit (429/529) is tijdelijk: kort wachten en opnieuw,
  // zodat één drukke minuut bij Anthropic niet je hele dagoverzicht kost.
  // Ruime antwoordlimiet: met 2500 werd de JSON regelmatig middenin afgekapt
  // (stop_reason max_tokens) en was het hele dagoverzicht onbruikbaar.
  const body = JSON.stringify({ model: useModel, max_tokens: 8000, system, messages: [{ role: 'user', content: `FEITEN (dashboard):\n${facts}\n\nBERICHTEN:\n${corpus || '(geen recente berichten)'}` }] });
  let resp = null; let lastErr = '';
  for (let poging = 0; poging < 3; poging++) {
    if (poging) await new Promise((r) => setTimeout(r, poging * 2500));
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body,
      });
    } catch (e) { lastErr = `netwerkfout: ${e.message}`; resp = null; continue; }
    if (resp.ok) break;
    // Foutdetails van de API meenemen — anders blijft het gissen.
    const det = await resp.text().catch(() => '');
    let uitleg = '';
    try { uitleg = (JSON.parse(det).error || {}).message || ''; } catch { uitleg = det.slice(0, 160); }
    lastErr = `Claude API status ${resp.status}${uitleg ? ` — ${uitleg}` : ''}`;
    if (![429, 500, 502, 503, 529].includes(resp.status)) break; // niet-tijdelijk: stoppen
    resp = null;
  }
  if (!resp || !resp.ok) throw new Error(lastErr || 'AI niet bereikbaar');
  const json = await resp.json();
  recordAIUsage(json.usage, useModel);
  const text = (json.content || []).map((c) => c.text || '').join('').trim();
  // Afgekapt/omringd antwoord redden: pak het buitenste JSON-blok.
  // Pak het JSON-blok; is het antwoord afgekapt, dan staat er geen sluit-accolade
  // meer — daarom vanaf de EERSTE accolade tot het eind knippen en repareren.
  const start = text.indexOf('{');
  if (start === -1) return { error: `AI gaf geen bruikbaar antwoord${json.stop_reason === 'max_tokens' ? ' (antwoord afgekapt)' : ''}` };
  const blok = text.slice(start).replace(/```\s*$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(blok); } catch { parsed = repairTruncatedJson(blok); }
  if (!parsed) return { error: `AI-antwoord kon niet worden gelezen${json.stop_reason === 'max_tokens' ? ' (antwoord afgekapt)' : ''}` };
  const arr = (x, n) => (Array.isArray(x) ? x.slice(0, n) : []);
  const data = {
    kop: String(parsed.kop || '').slice(0, 200),
    acties: arr(parsed.acties, 6).map((a) => ({
      prio: ['hoog', 'middel', 'laag'].includes(a.prio) ? a.prio : 'middel',
      titel: String(a.titel || '').slice(0, 140),
      waarom: String(a.waarom || '').slice(0, 200),
      waar: ['inbox', 'opdrachten', 'facturen', 'agenda', 'klanten'].includes(a.waar) ? a.waar : 'opdrachten',
    })).filter((a) => a.titel),
    beantwoorden: arr(parsed.beantwoorden, 5).map((b) => ({
      wie: String((b && b.wie) || '').slice(0, 80),
      kanaal: (b && b.kanaal) === 'whatsapp' ? 'whatsapp' : 'email',
      waarover: String((b && b.waarover) || '').slice(0, 160),
      urgent: !!(b && b.urgent),
    })).filter((b) => b.wie || b.waarover),
    kansen: arr(parsed.kansen, 3).map((k) => String(k).slice(0, 200)).filter(Boolean),
    risicos: arr(parsed.risicos, 3).map((k) => String(k).slice(0, 200)).filter(Boolean),
  };
  return { data, engine: `ai:${useModel}` };
}

// AI-vraagbaak: beantwoordt een vrije vraag op basis van de opgeslagen WhatsApp/
// e-mail-berichten. Bv. "hoeveel omzet is in de groep van Youssef genoemd?" of
// "wat is er met de opdracht van mevrouw Jansen gebeurd?".
export async function askAssistant({ question, messages = [], companyProfile = '', dashboard = '', model: modelPref = '', history = [] }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = modelPref || process.env.ANTHROPIC_ANALYZE_MODEL || 'claude-sonnet-5';
  if (!apiKey) return { text: 'Zet eerst de AI aan (ANTHROPIC_API_KEY) om de vraagbaak te gebruiken.', engine: 'demo' };
  if (!question) return { text: 'Stel een vraag.', engine: 'n.v.t.' };
  if (!messages.length && !dashboard) return { text: 'Er zijn nog geen gegevens om in te zoeken.', engine: 'n.v.t.' };

  // Corpus: tot 1500 berichten (chronologisch, oud->nieuw), met datum, groep en afzender.
  // We laten de volledige berichttekst toe tot 600 tekens (rapportages met bedragen).
  const corpus = messages.slice(0, 1500).map((m, i) => {
    const when = m.receivedAt ? new Date(m.receivedAt).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const where = m.group ? `groep ${m.group}` : (m.channel || '');
    return `[${i + 1}] ${when} (${where}) ${m.sender || ''}: ${(m.body || '').replace(/\s+/g, ' ').slice(0, 600)}`;
  }).join('\n');

  const system = `Je bent de interne data-assistent van Keyservice (sleutel-/slotenmaker).
${companyProfile ? `\nOver het bedrijf:\n${companyProfile}\n` : ''}
Je krijgt twee soorten gegevens:
(A) DASHBOARD-GEGEVENS: opdrachtkaarten (met status, klant, monteur, afspraak, prijs),
    facturen en offertes (nummer, bedrag, status, betaald ja/nee), klanten en de
    financiële cijfers. Gebruik deze voor vragen over kaarten, omzet, facturen,
    klanten, monteurs, statussen en vergelijkingen.
(B) BERICHTEN: WhatsApp- en e-mailverkeer (chronologisch, met datum, groep, afzender).
    Gebruik deze voor wat er is BESPROKEN of AFGESPROKEN.
Combineer beide waar dat de vraag beter beantwoordt (bv. "welke klussen zijn volgens de
groep afgerond maar staan nog niet op Afgerond?" of "welke klanten hebben wel een offerte
maar geen factuur?"). Beantwoord UITSLUITEND op basis van de gegeven data. Verzin niets.

WERKWIJZE BIJ OMZET-/BEDRAG-VRAGEN (zeer belangrijk, wees exact en volledig):
1. Ga ELK bericht in de gevraagde periode langs — sla geen enkele dagrapportage over.
2. Houd je STRIKT aan de datumrange in de vraag (bv. "1 juni t/m 13 juni"): tel alleen
   bedragen mee met een datum binnen die range.
3. Haal elk los bedrag eruit met de bijbehorende datum en categorie (contant / pin /
   overboeking / kosten / overig). Negeer de door de monteur zélf opgetelde totalen —
   bereken alles zelf uit de losse bedragen, zodat fouten van hem niet doorwerken.
4. Maak eerst een overzicht PER DAG (datum → bedragen per categorie), tel daarna PER
   CATEGORIE op, en geef tot slot een EINDTOTAAL.
5. Noem twijfelgevallen apart (bv. "nog niet binnen", onduidelijke datum) en tel die niet
   stilzwijgend mee.

ALGEMEEN:
- Noem concrete berichten/data waar je je op baseert.
- Staat iets er niet in of twijfel je? Zeg dat eerlijk.
- Antwoord helder in het Nederlands, met een nette tabel/opsomming waar dat past.
- Dit is een DOORLOPEND GESPREK: eerdere vragen en antwoorden krijg je mee — verwijs
  ernaar en bouw erop voort ("die drie facturen van net"). Is een vraag te vaag om
  goed te beantwoorden, stel dan ÉÉN korte verduidelijkingsvraag in plaats van gokken.
- Verwijs je naar een opdrachtkaart, gebruik dan altijd het kaartnummer zoals het in
  de dashboard-gegevens staat (bv. #a1b2c3) — daar kan de gebruiker op klikken.`;

  const inhoud = [
    dashboard ? `=== (A) DASHBOARD-GEGEVENS ===\n${dashboard}` : '',
    corpus ? `=== (B) BERICHTEN (chronologisch) ===\n${corpus}` : '',
    `---\nVraag: ${question}`,
  ].filter(Boolean).join('\n\n');
  // Gespreksgeheugen: eerdere beurten gaan als losse user/assistant-berichten mee
  // (zonder de zware data — die zit alleen bij de nieuwste vraag). Max 6 beurten.
  const turns = [];
  for (const h of (Array.isArray(history) ? history : []).slice(-6)) {
    const q = String(h?.q || '').slice(0, 2000).trim();
    const a = String(h?.a || '').slice(0, 6000).trim();
    if (q && a) { turns.push({ role: 'user', content: q }, { role: 'assistant', content: a }); }
  }
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 6000, system, messages: [...turns, { role: 'user', content: inhoud }] }),
  });
  if (!resp.ok) {
    const det = await resp.text().catch(() => '');
    let uitleg = '';
    try { uitleg = (JSON.parse(det).error || {}).message || ''; } catch { uitleg = det.slice(0, 160); }
    throw new Error(`Claude API status ${resp.status}${uitleg ? ` — ${uitleg}` : ''}`);
  }
  const json = await resp.json();
  recordAIUsage(json.usage, model);
  const text = (json.content || []).map((c) => c.text || '').join('').trim();
  return { text, engine: `ai:${model}`, searched: Math.min(messages.length, 1500) };
}

// AI-statusscan: leest recente (groeps)berichten, matcht ze aan lopende opdrachten en
// stelt statuswijzigingen voor (bv. monteur meldt "klaar" -> Afgerond; "offerte gestuurd"
// -> Offerte verzonden; "klant wil niet" -> Geannuleerd). Geeft voorstellen terug die
// een mens nog moet goedkeuren — past zelf NIETS aan.
// De invoer die de AI te zien krijgt, los opgebouwd zodat een test kan controleren dat
// het dagrapport MET regeleindes en met datums wordt aangeleverd (test/rapport-test.mjs).
export function buildStatusScanPrompt({ orders = [], messages = [], monteurGroups = [] }) {
  const orderList = orders.slice(0, 300).map((o, i) => {
    let line = `#${i + 1} | ${o.id} | "${o.title}" | klant: ${o.customer || '?'} | tel: ${o.phone || '-'} | adres: ${o.address || '-'} | herkomst: ${o.isDrs ? 'DRS/Raf Breda-groep' : 'overig'} | nu: ${o.status}`;
    if (o.createdAt) line += ` | binnen: ${o.createdAt}`;
    if (o.updatedAt) line += ` | laatst gewijzigd: ${o.updatedAt}`;
    if (o.appointmentAt) line += ` | afspraak: ${o.appointmentAt}`;
    if (o.price) line += ` | prijs: ${o.price}`;
    if (o.notes) line += ` | notitie: ${o.notes}`;
    if (o.thread && o.thread.length) line += `\n   gesprek: ${o.thread.join(' || ')}`;
    return line;
  }).join('\n');
  const mg = monteurGroups.map((g) => String(g || '').toLowerCase().trim()).filter(Boolean);
  const isMonteurGroup = (name) => { const n = String(name || '').toLowerCase().trim(); return mg.some((g) => n === g || n.includes(g) || g.includes(n)); };
  const msgList = messages.slice(0, 600).map((m) => {
    const when = m.receivedAt ? new Date(m.receivedAt).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    let src; const isGroup = !!m.group;
    if (m.group) src = isMonteurGroup(m.group) ? `monteursgroep "${m.group}"` : (isWhatsappOrderGroup(m.group) ? `DRS-groep "${m.group}"` : `monteursgroep "${m.group}"`);
    else src = m.channel === 'email' ? 'e-mail' : (m.channel || 'overig');
    const limit = isGroup ? 4000 : 220;
    let tekst = String(m.body || '');
    if (isGroup) {
      // REGELEINDES BEWAREN — zie de uitleg bij de originele opbouw hieronder.
      tekst = tekst.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (tekst.length > limit) tekst = `${tekst.slice(0, limit)}\n[AFGEKAPT — nog ${tekst.length - limit} tekens]`;
      return `${when} [${src}] ${m.sender || ''}:\n${tekst.split('\n').map((r) => `    ${r}`).join('\n')}`;
    }
    return `${when} [${src}] ${m.sender || ''}: ${tekst.replace(/\s+/g, ' ').slice(0, limit)}`;
  }).join('\n');
  return `Lopende opdrachten:\n${orderList}\n\nRecente berichten:\n${msgList}`;
}

export async function suggestStatusChanges({ orders = [], messages = [], statuses = [], companyProfile = '', monteurGroups = [] }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  // De statusscan draait ALTIJD minimaal op Sonnet 5 — dit is het denkwerk dat de
  // kaarten sorteert. Een eventuele zwakkere override (bv. Haiku) wordt hier
  // opgewaardeerd naar Sonnet 5, zodat de kwaliteit nooit stilletjes terugvalt.
  const requested = process.env.ANTHROPIC_ANALYZE_MODEL || 'claude-sonnet-5';
  const model = /haiku/i.test(requested) ? 'claude-sonnet-5' : requested;
  if (!apiKey) return { suggestions: [], engine: 'demo', note: 'Zet de AI aan (ANTHROPIC_API_KEY) voor de statusscan.' };
  if (!orders.length || !messages.length) return { suggestions: [], engine: 'n.v.t.' };

  const orderList = orders.slice(0, 300).map((o, i) => {
    let line = `#${i + 1} | ${o.id} | "${o.title}" | klant: ${o.customer || '?'} | tel: ${o.phone || '-'} | adres: ${o.address || '-'} | herkomst: ${o.isDrs ? 'DRS/Raf Breda-groep' : 'overig'} | nu: ${o.status}`;
    if (o.createdAt) line += ` | binnen: ${o.createdAt}`;
    if (o.updatedAt) line += ` | laatst gewijzigd: ${o.updatedAt}`;
    if (o.appointmentAt) line += ` | afspraak: ${o.appointmentAt}`;
    if (o.price) line += ` | prijs: ${o.price}`;
    if (o.notes) line += ` | notitie: ${o.notes}`;
    if (o.thread && o.thread.length) line += `\n   gesprek: ${o.thread.join(' || ')}`;
    return line;
  }).join('\n');
  // Label elk bericht naar bron-type, zodat de Ai het verschil snapt tussen een
  // tussentijds monteursrapport en een definitieve terugkoppeling in de DRS-groep.
  // BELANGRIJK: het dagrapport van de monteur is één LANG bericht met veel opdrachten.
  // Groepsberichten (monteursgroep/DRS) daarom ruim meesturen (tot 2500 tekens); losse
  // chat/e-mail kort houden zodat de prompt behapbaar blijft.
  // Een groep die bij een monteur hoort (waGroup) is ALTIJD een monteursgroep — dat is
  // betrouwbaarder dan het opdracht-groepen-filter (dat bij leeg "alles" matcht en dan
  // het dagrapport per ongeluk als DRS-groep zou labelen).
  const mg = monteurGroups.map((g) => String(g || '').toLowerCase().trim()).filter(Boolean);
  const isMonteurGroup = (name) => { const n = String(name || '').toLowerCase().trim(); return mg.some((g) => n === g || n.includes(g) || g.includes(n)); };
  const msgList = messages.slice(0, 600).map((m) => {
    const when = m.receivedAt ? new Date(m.receivedAt).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    let src; const isGroup = !!m.group;
    if (m.group) {
      if (isMonteurGroup(m.group)) src = `monteursgroep "${m.group}"`;
      else src = isWhatsappOrderGroup(m.group) ? `DRS-groep "${m.group}"` : `monteursgroep "${m.group}"`;
    } else src = m.channel === 'email' ? 'e-mail' : (m.channel || 'overig');
    const limit = isGroup ? 4000 : 220; // dagrapport volledig; geklets kort
    let tekst = String(m.body || '');
    if (isGroup) {
      // REGELEINDES BEWAREN. Dit is het dagrapport van de monteur: een KOPJE
      // ("Afgerond") met daaronder regels met postcode + plaats. Werd dat platgeslagen
      // tot één lange zin, dan moest het model raden of "Offerte" een kopje was of een
      // detail bij de vorige klus — precies de fout die de eigenaar zag. Alleen spaties
      // en tabs inklappen; \n blijft staan. Het blok wordt ingesprongen zodat de AI ziet
      // waar het rapport begint en eindigt.
      tekst = tekst.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (tekst.length > limit) tekst = `${tekst.slice(0, limit)}\n[AFGEKAPT — nog ${tekst.length - limit} tekens]`;
      return `${when} [${src}] ${m.sender || ''}:\n${tekst.split('\n').map((r) => `    ${r}`).join('\n')}`;
    }
    return `${when} [${src}] ${m.sender || ''}: ${tekst.replace(/\s+/g, ' ').slice(0, limit)}`;
  }).join('\n');
  const statusKeys = statuses.map((s) => `${s.key} (${s.label})`).join(', ');

  const system = `Je bent een assistent voor Keyservice (sleutel-/slotenmaker).
${companyProfile ? `\nOver het bedrijf:\n${companyProfile}\n` : ''}
ZO WERKT KEYSERVICE (lees dit goed):
- Een opdracht komt binnen via de DRS/"Raf Breda"-groep (of e-mail/telefoon) en wordt een kaart.
- AAN HET EIND VAN ELKE DAG stuurt de monteur ÉÉN dagrapport in de monteursgroep met ALLE
  opdrachten van die dag tegelijk: welke zijn GEREDEN/afgerond, welke kregen een AFSPRAAK,
  welke een OFFERTE, welke zijn GEANNULEERD, en welke staan nog OPEN. Dit rapport is dus een
  LIJST met meerdere opdrachten in één bericht (vaak per plaats/adres één regel).
- Op basis van dat dagrapport moeten (1) de kaarten op de juiste status gezet worden en
  (2) de relevante opdrachten teruggekoppeld worden in de Raf Breda-groep.

Je krijgt (1) een lijst lopende opdrachten (met klant, telefoon, adres/postcode, herkomst en
huidige status, plus het gesprek/notitie óp de kaart) en (2) recente berichten, elk gelabeld
met de bron ([DRS-groep "..."], [monteursgroep "..."] of [e-mail]).

TAAK A — STATUSWIJZIGINGEN ("statusChanges") — DIT IS DE BELANGRIJKSTE TAAK:
Loop het dagrapport (en het gesprek/notitie op elke kaart) na en bepaal per opdracht de status.

HET DAGRAPPORT-FORMAAT (heel belangrijk): de monteur zet een KOPJE (de uitkomst) en daaronder
één of meer regels met een POSTCODE + plaats + detail. Elke regel onder een kopje krijgt de
status van dat kopje, TOT het volgende kopje. Voorbeeld:
   Vrijdag 03-07
   Afgerond
   5056AC Berkel-Enschot €556 pin
   Offerte
   4631 TB Hoogerheide offerte afgegeven
   Afspraken
   5171AE Kaatsheuvel maandag
   4664 BS Lepelstraat maandag
   Geannuleerd
   5224BN Denbosch advies gegeven
   4661ZD Halsteren heeft zelf opgelost
Hieruit volgt: Berkel-Enschot -> afgerond, Hoogerheide -> offerte, Kaatsheuvel + Lepelstraat ->
afspraak ingepland, Denbosch + Halsteren -> geannuleerd.

REGELS:
1. Behandel ELKE regel van het rapport apart. Koppel 'm aan de juiste kaart primair op de
   POSTCODE (bv. 5056AC / 4664 BS — let op: postcode kan met of zonder spatie staan), anders
   op plaatsnaam, adres, klantnaam of onderwerp. Eén rapport = meerdere kaarten.
2. De status komt van het KOPJE erboven. Kopjes en losse woorden -> status:
   - "Afgerond / gereden / klaar / gefixt / opgelost / vervangen / gemaakt / pin / betaald" -> afgerond
   - "Afspraken / afspraak / (weekdag) / maandag..zondag / ingepland / komt terug / plaatsen" -> afspraak ingepland
   - "Offerte / prijs opgegeven / prijsopgave / offerte afgegeven" -> offerte verzonden
   - "Geannuleerd / gaat niet door / geen gehoor / zelf opgelost / advies gegeven / vervallen" -> geannuleerd
   - "nog open / moet terug / niet gedaan / staat nog" -> in behandeling laten (niet wijzigen)
3. Het gesprek/notitie ÓP de kaart is óók sterk bewijs (klant "akkoord, plan in" -> afspraak;
   "offerte verstuurd" -> offerte; monteur "klaar" -> afgerond).
Geldige statussen: ${statusKeys}.
WEES RUIMHARTIG: een MENS controleert en bevestigt elke suggestie vóór die wordt toegepast.
Stel dus alles voor wat redelijk waarschijnlijk is — liever een suggestie die weggeklikt kan
worden dan een gemiste statuswijziging. Alleen bij écht geen enkele aanwijzing laat je een
opdracht met rust.

TAAK B — OPENSTAANDE TERUGKOPPELING IN RAF BREDA ("needsDrsUpdate") — secundair:
Voor opdrachten uit de "DRS/Raf Breda-groep" waarvan de uitkomst bekend is (uit een rapport
of de huidige status) maar die nog niet is teruggekoppeld in de DRS-groep: geef een korte
kant-en-klare tekst om in Raf Breda te plakken (bv. "Afgerond — Hulst 4561KZ"). Laat deze
taak NOOIT ten koste gaan van Taak A.

Antwoord UITSLUITEND met één JSON-object, geen tekst eromheen:
{"statusChanges":[{"orderId":"#12","suggestedStatus":"<geldige statuskey>","reason":"korte uitleg","evidence":"kort citaat"}],
 "needsDrsUpdate":[{"orderId":"#12","reason":"waarom dit nog terug moet","suggestedText":"tekst om in Raf Breda te plakken"}]}
Gebruik bij "orderId" bij voorkeur het VOLGNUMMER van de opdracht (bv. "#12"); het lange
ord_-id mag ook, maar dan exact overgenomen.
HOUD HET COMPACT: "reason" max 12 woorden, "evidence" max 100 tekens (alleen het relevante
stukje citeren, niet het hele rapport). Beide lijsten mogen leeg zijn ([]).`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 16000, system, messages: [{ role: 'user', content: `Lopende opdrachten:\n${orderList}\n\nRecente berichten:\n${msgList}` }] }),
  });
  if (!resp.ok) throw new Error(`Claude API gaf status ${resp.status}`);
  const json = await resp.json();
  recordAIUsage(json.usage, model);
  const text = (json.content || []).map((c) => c.text || '').join('').trim();
  const truncated = json.stop_reason === 'max_tokens';
  console.log(`[statusscan] AI-antwoord: ${text.length} tekens, stop_reason=${json.stop_reason}`);

  // Haalt een JSON-array met de gegeven sleutel uit de tekst, óók als het antwoord
  // halverwege is afgekapt: complete objecten worden gered, het kapotte laatste object
  // wordt weggegooid. Zo kan een lang antwoord nooit meer stilletjes "leeg" worden.
  const extractArray = (src, key) => {
    const ki = src.indexOf(`"${key}"`);
    if (ki === -1) return null;
    const start = src.indexOf('[', ki);
    if (start === -1) return null;
    let depth = 0, inStr = false, esc = false, lastComplete = start;
    for (let i = start; i < src.length; i++) {
      const ch = src[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') {
        depth--;
        if (depth === 1 && ch === '}') lastComplete = i; // einde van een compleet object
        if (depth === 0) { // nette afsluiting van de array
          try { return JSON.parse(src.slice(start, i + 1)); } catch { break; }
        }
      }
    }
    // Afgekapt: red alles t/m het laatste complete object.
    if (lastComplete > start) {
      try { return JSON.parse(src.slice(start, lastComplete + 1) + ']'); } catch { /* geef op */ }
    }
    return null;
  };

  let statusChanges = extractArray(text, 'statusChanges');
  let needsDrsUpdate = extractArray(text, 'needsDrsUpdate');
  // Terugvalcompat: model gaf een kale array terug.
  if (!statusChanges && !needsDrsUpdate) {
    const arr = text.match(/\[[\s\S]*\]/);
    if (arr) { try { const a = JSON.parse(arr[0]); if (Array.isArray(a)) statusChanges = a; } catch { /* laat leeg */ } }
  }
  if (!Array.isArray(statusChanges)) statusChanges = [];
  if (!Array.isArray(needsDrsUpdate)) needsDrsUpdate = [];
  // Nooit meer stil falen: als er tekst was maar niets geparsed kon worden, meld het.
  let note = '';
  if (truncated && statusChanges.length) note = `Let op: het AI-antwoord was te lang en is afgekapt — ${statusChanges.length} voorstellen zijn gered; draai de scan eventueel nog eens voor de rest.`;
  if (!statusChanges.length && !needsDrsUpdate.length && text.length > 50) {
    note = 'De AI gaf een antwoord dat niet als voorstel-lijst te lezen was. Technische details hieronder.';
    return { statusChanges, needsDrsUpdate, engine: `ai:${model}`, note, rawSample: text.slice(0, 1200) };
  }
  return { statusChanges, needsDrsUpdate, engine: `ai:${model}`, note };
}

// Genereert een bondige "leerregel"-tekst op basis van het verkeer: wat IS en wat
// is NIET een echte opdracht voor Keyservice. Bedoeld om aan het bedrijfsprofiel
// toe te voegen, zodat de AI scherper filtert in de inbox.
export async function learnFilterRules({ messages = [], companyProfile = '', feedback = [] }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_ANALYZE_MODEL || 'claude-sonnet-5';
  if (!apiKey) return { text: '', engine: 'demo' };
  if (!messages.length) return { text: '', engine: 'n.v.t.' };

  const sample = messages.slice(0, 200).map((m, i) =>
    `[${i + 1}] (${m.channel}) ${m.sender || ''}: ${(m.body || '').replace(/\s+/g, ' ').slice(0, 250)}`
  ).join('\n');
  const rejectInfo = feedback.length
    ? `\nHet team heeft eerder berichten AFGEWEZEN met deze redenen: ${[...new Set(feedback.map((f) => f.reason))].slice(0, 15).join('; ')}.`
    : '';

  const system = `Je helpt Keyservice (sleutel-/slotenmaker) de inbox-filtering verbeteren.
${companyProfile ? `\nHuidig bedrijfsprofiel:\n${companyProfile}\n` : ''}${rejectInfo}
Bekijk de echte inkomende berichten en schrijf een KORTE set leerregels (max ~12 regels)
die een AI helpt om te bepalen wat WEL een echte opdracht/aanvraag is en wat NIET
(geklets, reclame, leveranciers, interne berichten). Wees concreet en gebruik
voorbeelden uit de berichten. Schrijf in het Nederlands, als bullet-punten.
Begin met de kop "FILTERREGELS (op basis van werkelijk verkeer):".`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 3000, system, messages: [{ role: 'user', content: `Berichten:\n${sample}` }] }),
  });
  if (!resp.ok) throw new Error(`Claude API gaf status ${resp.status}`);
  const json = await resp.json();
  recordAIUsage(json.usage, model);
  const text = (json.content || []).map((c) => c.text || '').join('').trim();
  return { text, engine: `ai:${model}` };
}

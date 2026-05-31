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
// Postcode + plaats (bv. "1234 AB Amsterdam"). Vereist spatie tussen cijfers en
// letters, en geen cijfer ervoor (zodat telefoonnummers niet meetellen).
const POSTCODE_RE = /(?<!\d)(\d{4}[ \t][A-Za-z]{2})\b(?:[ \t]+([A-Z][a-zà-ÿ-]+))?/;

function pick(text, re) {
  const m = (text || '').match(re);
  return m ? (m[1] || m[0]).trim() : null;
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
function pickLabeled(text, labels) {
  for (const label of labels) {
    // sta "naam is X", "naam: X", "naam X" toe; stop bij . , \n of volgend label
    const re = new RegExp(`\\b${label}\\b\\s*(?:is|:|=|-)?\\s*([^\\n.,;]{2,80})`, 'i');
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
function pickName(text) {
  const m = (text || '').match(/\b(?:naam\s*(?:is|:)?\s*)?([A-Z][a-zà-ÿ]+(?:\s(?:de|van|der|den|ten|te|het|el|al)?\s?[A-Z][a-zà-ÿ]+){0,3})/);
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
  let address = pickLabeled(t, ['adres', 'woonplaats', 'volledig adres']);
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

// Korte samenvatting van recente afwijzingen, zodat de AU ervan "leert".
// (Wordt door classify() meegegeven; categorizer kent de db niet zelf.)
function learningsBlock(learnings) {
  if (!learnings || !learnings.length) return '';
  const lines = learnings.slice(0, 8).map((f, i) => {
    const bits = [`${i + 1}. Reden: ${f.reason}`];
    if (f.shouldBe) bits.push(`had moeten zijn: ${f.shouldBe}`);
    if (f.note) bits.push(`uitleg: ${f.note}`);
    if (f.sample) bits.push(`voorbeeldtekst: "${(f.sample || '').slice(0, 120)}"`);
    return bits.join(' | ');
  });
  return `\n\nLeer van eerdere correcties door het team (vermijd dezelfde fouten):\n${lines.join('\n')}`;
}

// --- AI-modus: Claude ---
async function classifyWithClaude(message) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

  const system = `Je bent een assistent voor een sleutel-/slotenmaker-bedrijf (Keyservice).
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
Antwoord UITSLUITEND met geldige JSON, geen extra tekst.${learningsBlock(message.learnings)}`;

  const user = `Bericht-kanaal: ${message.channel}
Afzender: ${message.sender || '(onbekend)'}
Onderwerp: ${message.subject || '(geen)'}
Inhoud:
"""
${(message.body || '').slice(0, 4000)}
"""

Geef JSON met exact deze velden:
{
  "status": "open|offerte_verzonden|afspraak_ingepland|afgerond|geannuleerd",
  "title": "korte titel voor de opdracht (max 120 tekens)",
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
  const text = (json.content || []).map((c) => c.text || '').join('').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Geen JSON in AI-antwoord');
  const parsed = JSON.parse(match[0]);

  if (!CANONICAL_STATUSES.includes(parsed.status)) parsed.status = 'open';
  parsed.confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5));
  parsed.engine = `ai:${model}`;

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

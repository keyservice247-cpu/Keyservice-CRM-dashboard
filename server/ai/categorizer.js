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

export const STATUSES = ['open', 'offerte_verzonden', 'afspraak_ingepland', 'geannuleerd'];

export const STATUS_LABELS = {
  open: 'Open',
  offerte_verzonden: 'Offerte verzonden',
  afspraak_ingepland: 'Afspraak ingepland',
  geannuleerd: 'Geannuleerd',
};

const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

function pick(text, re) {
  const m = (text || '').match(re);
  return m ? m[0].trim() : null;
}

function cleanName(sender) {
  if (!sender) return null;
  // "Jan Jansen <jan@x.nl>" -> "Jan Jansen"
  const m = sender.match(/^\s*"?([^"<]+?)"?\s*<.*>/);
  if (m) return m[1].trim();
  if (EMAIL_RE.test(sender)) return sender.split('@')[0].replace(/[._]/g, ' ').trim();
  return sender.trim();
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

  const customerPhone = pick(`${sender} ${body}`, PHONE_RE);
  const customerEmail = pick(`${sender} ${body}`, EMAIL_RE);
  const customerName = cleanName(sender);

  const title =
    (subject && subject.trim()) ||
    (body || '').trim().split('\n')[0].slice(0, 80) ||
    `Nieuw bericht via ${channel}`;

  return {
    status,
    title: title.slice(0, 120),
    customerName,
    customerPhone,
    customerEmail,
    urgent,
    confidence: Math.round(confidence * 100) / 100,
    reasoning: reasons.join(' '),
    engine: 'regels',
  };
}

// --- AI-modus: Claude ---
async function classifyWithClaude(message) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

  const system = `Je bent een assistent voor een sleutel-/slotenmaker-bedrijf (Keyservice).
Je categoriseert inkomende klantberichten (e-mail of WhatsApp) voor een opdrachten-dashboard.
Kies precies één status uit deze lijst:
- "open": nieuwe aanvraag of offerteverzoek dat nog opgepakt moet worden.
- "offerte_verzonden": er is al een offerte/prijsopgave naar de klant gestuurd.
- "afspraak_ingepland": het gaat over het maken/bevestigen van een afspraak of langskomen.
- "geannuleerd": de klant annuleert of zegt af.
Antwoord UITSLUITEND met geldige JSON, geen extra tekst.`;

  const user = `Bericht-kanaal: ${message.channel}
Afzender: ${message.sender || '(onbekend)'}
Onderwerp: ${message.subject || '(geen)'}
Inhoud:
"""
${(message.body || '').slice(0, 4000)}
"""

Geef JSON met exact deze velden:
{
  "status": "open|offerte_verzonden|afspraak_ingepland|geannuleerd",
  "title": "korte titel voor de opdracht (max 120 tekens)",
  "customerName": "naam klant of null",
  "customerPhone": "telefoonnummer of null",
  "customerEmail": "e-mailadres of null",
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

  if (!STATUSES.includes(parsed.status)) parsed.status = 'open';
  parsed.confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5));
  parsed.engine = `ai:${model}`;
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

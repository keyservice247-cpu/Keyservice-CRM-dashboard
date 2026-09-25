// Test: AI-MODELLEN PER TAAK (25 sep 2026). Zonder server en zonder echte AI-kosten:
// fetch wordt onderschept, zodat we zien welk model, welke denkdiepte (effort) en welke
// limiet elk onderdeel meestuurt. Plus: de ochtendbriefing neemt de kern van het
// dagoverzicht (WhatsApp + e-mail) over, en de kostenteller rekent met actuele prijzen.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DATA_DIR = process.env.DATA_DIR || mkdtempSync(join(tmpdir(), 'crm-aitest-'));
process.env.ANTHROPIC_API_KEY = 'test-sleutel';
for (const k of ['ANTHROPIC_MODEL', 'ANTHROPIC_ANALYZE_MODEL', 'ANTHROPIC_REPLY_MODEL', 'ANTHROPIC_BRIEFING_MODEL']) delete process.env[k];

let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); } }

// Nep-API: onthoudt elke aanvraag en geeft een passend antwoord terug.
const verzoeken = [];
const DAG_JSON = JSON.stringify({
  kop: 'Drukke dag met twee wachtende klanten',
  acties: [{ prio: 'hoog', titel: 'Bel Jansen terug', waarom: 'wacht sinds gisteren', waar: 'inbox' }],
  beantwoorden: [{ wie: 'Jansen', kanaal: 'whatsapp', waarover: 'vraagt om afspraak', urgent: true }, { wie: 'De Vries', kanaal: 'email', waarover: 'offerte schuifpui', urgent: false }],
  kansen: ['VvE Utrecht vraagt naar 12 cilinders'], risicos: ['Offerte Mulder verloopt'],
});
globalThis.fetch = async (url, opts = {}) => {
  const body = JSON.parse(opts.body || '{}');
  verzoeken.push({ url, body, heeftSignal: !!opts.signal });
  const tekst = /dagoverzicht|JSON/.test(String(body.system || '')) ? DAG_JSON : 'Focus vandaag op Jansen.';
  return new Response(JSON.stringify({ content: [{ type: 'text', text: tekst }], usage: { input_tokens: 1000, output_tokens: 200 }, stop_reason: 'end_turn' }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const laatste = () => verzoeken[verzoeken.length - 1];

const ai = await import('../server/ai/categorizer.js');
const { db } = await import('../server/db.js');

console.log('\n== Modelkeuze per taak ==');
ok('MODELLEN: Haiku 4.5 / Sonnet 5 / Opus 5 / Opus 5.5', ai.MODELLEN.snel === 'claude-haiku-4-5-20251001' && ai.MODELLEN.analyse === 'claude-sonnet-5' && ai.MODELLEN.opus55 === 'claude-opus-5-5');

await ai.suggestReply({ customerName: 'Jan', problem: 'slot kapot', history: '', templates: [] });
ok('concept-antwoord (Snel antwoord) → Sonnet 5 (was Haiku)', laatste().body.model === 'claude-sonnet-5', laatste().body.model);
ok('concept-antwoord: effort low + ruime limiet (denken telt mee)', laatste().body.output_config?.effort === 'low' && laatste().body.max_tokens >= 2000, JSON.stringify([laatste().body.output_config, laatste().body.max_tokens]));

await ai.morningInsight({ facts: 'Afspraken: 2' });
ok('ochtendbriefing-duiding → Opus 5.5', laatste().body.model === 'claude-opus-5-5', laatste().body.model);
ok('ochtendbriefing: effort low, limiet ≥ 2000 (was 300 → kon afgekapt worden)', laatste().body.output_config?.effort === 'low' && laatste().body.max_tokens >= 2000);

await ai.conversieInsight({ facts: 'conversie 80%' });
ok('conversie-briefing → Sonnet 5, effort low, limiet ≥ 2000', laatste().body.model === 'claude-sonnet-5' && laatste().body.output_config?.effort === 'low' && laatste().body.max_tokens >= 2000, JSON.stringify(laatste().body.output_config));

const dov = await ai.dayOverview({ corpus: 'x', facts: 'y', model: ai.MODELLEN.opus55 });
ok('dagoverzicht → Opus 5.5, effort medium, limiet 16000, eigen time-out', laatste().body.model === 'claude-opus-5-5' && laatste().body.output_config?.effort === 'medium' && laatste().body.max_tokens === 16000 && laatste().heeftSignal, JSON.stringify({ m: laatste().body.model, e: laatste().body.output_config, t: laatste().body.max_tokens }));
ok('dagoverzicht-antwoord wordt gelezen', dov.data && dov.data.kop === 'Drukke dag met twee wachtende klanten' && dov.engine === 'ai:claude-opus-5-5', JSON.stringify(dov).slice(0, 150));

console.log('\n== Denkdiepte alleen waar het model het kent ==');
ok('Haiku krijgt GEEN effort (anders 400)', JSON.stringify(ai.effortVoor('claude-haiku-4-5-20251001')) === '{}');
ok('Sonnet 5 / Opus 5 / Opus 5.5 wel', ['claude-sonnet-5', 'claude-opus-5', 'claude-opus-5-5'].every((m) => ai.effortVoor(m, 'low').output_config?.effort === 'low'));
process.env.ANTHROPIC_ANALYZE_MODEL = 'claude-haiku-4-5-20251001';
await ai.conversieInsight({ facts: 'x' });
ok('env op Haiku gezet → conversie-briefing zonder effort (geen 400)', laatste().body.model === 'claude-haiku-4-5-20251001' && !laatste().body.output_config);
delete process.env.ANTHROPIC_ANALYZE_MODEL;

console.log('\n== Ochtendbriefing leest WhatsApp + e-mail via het dagoverzicht ==');
const auto = await import('../server/automations.js');
db().settings.morningBriefing = { enabled: true, channel: 'whatsapp', hour: 7 };
db().settings.crmAlerts = { enabled: true, phone: '+31612345678' };
db()._dayOverview = null;
db().messages = [{ id: 'm1', channel: 'whatsapp', sender: 'Jansen', body: 'Kunnen jullie morgen komen?', receivedAt: new Date().toISOString() }];
const voor = verzoeken.length;
await auto.sendMorningBriefing({ isTest: true });
const nieuw = verzoeken.slice(voor);
const dagCall = nieuw.find((v) => /JSON/.test(String(v.body.system || '')));
ok('briefing maakt het dagoverzicht (Opus 5.5, standaardinstelling)', !!dagCall && dagCall.body.model === 'claude-opus-5-5', dagCall && dagCall.body.model);
ok('dagoverzicht kreeg het WhatsApp-bericht mee', !!dagCall && /Kunnen jullie morgen komen/.test(dagCall.body.messages[0].content));
const item = (db().outbox || []).find((o) => o.by === 'ochtendbriefing');
const tekst = item ? item.text : '';
ok('briefing bevat blok "UIT WHATSAPP & E-MAIL" met kop, wachtende klanten, risico en kans', /UIT WHATSAPP & E-MAIL/.test(tekst) && /Drukke dag/.test(tekst) && /Antwoord nodig: Jansen \(WhatsApp\).*\[URGENT\]/.test(tekst) && /Risico: Offerte Mulder/.test(tekst) && /Kans: VvE Utrecht/.test(tekst), tekst.slice(0, 400));
const duiding = nieuw.find((v) => /rechterhand/.test(String(v.body.system || '')) && !/JSON/.test(String(v.body.system || '')));
ok('AI-duiding (Opus 5.5) krijgt óók het WhatsApp/e-mailblok als feiten', !!duiding && /UIT WHATSAPP & E-MAIL/.test(duiding.body.messages[0].content) && duiding.body.model === 'claude-opus-5-5');
ok('dagoverzicht is meteen klaar voor Start (cache van vandaag)', db()._dayOverview && db()._dayOverview.data && db()._dayOverview.engine === 'ai:claude-opus-5-5');
const voor2 = verzoeken.length;
await auto.haalDagoverzicht();
ok('tweede keer vandaag: uit de cache, geen nieuwe AI-aanroep', verzoeken.length === voor2);
db().settings.aiOverviewModel = 'standaard';
await auto.haalDagoverzicht({ refresh: true });
ok('instelling "standaard" → dagoverzicht op Sonnet 5', laatste().body.model === 'claude-sonnet-5', laatste().body.model);
db().settings.aiOverviewModel = 'opus';

console.log('\n== Briefing zonder AI blijft gewoon werken ==');
globalThis.fetch = async () => new Response('{"error":{"message":"overbelast"}}', { status: 400 });
db()._dayOverview = null; db().outbox = [];
await auto.sendMorningBriefing({ isTest: true });
const zonder = (db().outbox || []).find((o) => o.by === 'ochtendbriefing');
ok('AI faalt → briefing gaat toch uit, zonder WhatsApp/e-mailblok', !!zonder && /Ochtendbriefing/.test(zonder.text) && !/UIT WHATSAPP/.test(zonder.text), zonder && zonder.text.slice(0, 120));

console.log('\n== Kostenteller: actuele prijzen ==');
const u = await import('../server/usage.js');
const r2 = (x) => Math.round(x * 100) / 100;
ok('Sonnet 5 = $2 / $10 per miljoen (was $3 / $15)', r2(u.kostenVan('sonnet', 1e6, 1e6)) === 12);
ok('Opus 5 = $5 / $25 (was $15 / $75)', r2(u.kostenVan('opus', 1e6, 1e6)) === 30);
ok('Opus 5.5 = $4 / $20, eigen regel', u.tierOf('claude-opus-5-5') === 'opus55' && r2(u.kostenVan('opus55', 1e6, 1e6)) === 24);
ok('Haiku 4.5 = $1 / $5', r2(u.kostenVan('haiku', 1e6, 1e6)) === 6);
ok('Opus 5 wordt niet als 5.5 geteld', u.tierOf('claude-opus-5') === 'opus');

console.log(`\n==========\nAI-modellen-test: ${passed} geslaagd, ${failed} gefaald`);
if (failed) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);

// Test: AI BIJ CAMPAGNES (stap 3, 25 nov 2026). Zonder server en zonder echte AI-kosten:
// fetch wordt onderschept. Bewaakt:
//   - de AI krijgt alleen TELLINGEN (geen naam, adres, e-mailadres of klant-id);
//   - het verzoek gebruikt het afgesproken model, een vaste JSON-structuur en geen instellingen
//     die de nieuwe modellen weigeren (temperature, budget_tokens, uitgeschakeld denken);
//   - een onbruikbaar of geweigerd antwoord geeft géén voorstellen (de aanroeper valt dan terug
//     op de vaste regels) en een voorstel met een onbekende doelgroep wordt weggegooid.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DATA_DIR = process.env.DATA_DIR || mkdtempSync(join(tmpdir(), 'crm-campai-'));
process.env.ANTHROPIC_API_KEY = 'test-sleutel';
delete process.env.ANTHROPIC_CAMPAGNE_MODEL;

let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); } }

const verzoeken = []; let antwoord = () => ({});
globalThis.fetch = async (url, opts = {}) => {
  const body = JSON.parse(opts.body || '{}'); verzoeken.push({ url, body });
  const a = antwoord(body);
  return new Response(JSON.stringify(a.json || {}), { status: a.status || 200, headers: { 'content-type': 'application/json' } });
};
const tekstAntwoord = (obj, extra = {}) => ({ json: { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }], usage: { input_tokens: 900, output_tokens: 400 }, stop_reason: 'end_turn', ...extra } });

const ai = await import('../server/ai/categorizer.js');
const { klantFeiten, doelgroepTelling, DOELGROEPEN } = await import('../server/campagnes.js');

const nu = Date.now(); const geleden = (d) => new Date(nu - d * 86400000).toISOString();
const customers = [
  { id: 'kl_geheim1', name: 'Familie Geheimnaam', email: 'geheim@prive-adres.test', address: 'Verborgenlaan 12, 1234 AB Testdorp' },
  { id: 'kl_geheim2', name: 'Mevrouw Anoniem', email: 'anoniem@prive-adres.test', address: 'Stillestraat 3, 1234 AB Testdorp' },
];
const orders = [{ id: 'o1', customerId: 'kl_geheim1', status: 'afgerond', title: 'Testdorp — schuifpui loopt zwaar', createdAt: geleden(500), completedAt: geleden(499) }];
const telling = doelgroepTelling(klantFeiten({ customers, orders, invoices: [], nu }), { nu });
const doelgroepen = DOELGROEPEN.map((d) => ({ key: d.key, naam: d.naam, uitleg: d.uitleg }));

antwoord = () => tekstAntwoord({ voorstellen: [
  { titel: 'Schuifpui klaar voor de winter', doelgroep: 'schuifpui', maanden: 0, plaats: '', waarom: 'Er zijn 140 schuifpui-klanten bereikbaar.', onderwerp: 'Loopt uw schuifpui nog soepel?', tekst: 'Beste {naam},\n\nEen onderhoudsbeurt voorkomt tocht.', moment: 'dinsdagochtend rond 10 uur' },
  { titel: 'Lang niet gezien', doelgroep: 'oud', maanden: 18, plaats: '', waarom: 'Negentig klanten.', onderwerp: 'Sluit alles nog goed?', tekst: 'Beste {naam},\n\nWerkt alles nog?', moment: 'donderdag' },
  { titel: 'Verzonnen groep', doelgroep: 'bestaat-niet', maanden: 0, plaats: '', waarom: 'x', onderwerp: 'x', tekst: 'x', moment: 'x' },
] });
const uit = await ai.campagneVoorstellenAI({ telling, doelgroepen, maand: 11, eerdere: [{ doelgroep: 'sloten', onderwerp: 'Donkere dagen', dagenGeleden: 20, verstuurd: 80, nieuweOpdrachten: 3 }], companyProfile: 'Wij werken in Gelderland en Utrecht.' });
const v = verzoeken[verzoeken.length - 1].body;
const verstuurd = JSON.stringify(v);
ok('de AI krijgt alleen tellingen: geen naam, e-mailadres, straat of klant-id in het verzoek', !/Geheimnaam|Anoniem|prive-adres|Verborgenlaan|Stillestraat|kl_geheim/.test(verstuurd), verstuurd.slice(0, 200));
ok('wel: aantallen per doelgroep, de maand, eerdere campagnes met resultaat en de bedrijfsinformatie', /bereikbaarPerEmail/.test(verstuurd) && /"maand": 11/.test(v.messages[0].content) && /nieuweOpdrachten/.test(verstuurd) && /Gelderland/.test(v.system));
ok('model: Opus 5.5 (afspraak voor commercieel denkwerk), met de vaste terugvalketting', v.model === 'claude-opus-5-5' && ai.modelKetting('claude-opus-5-5').length >= 3, v.model);
ok('vaste JSON-structuur gevraagd (structured outputs) met alleen bestaande doelgroepen als keuze', v.output_config && v.output_config.format && v.output_config.format.type === 'json_schema' && JSON.stringify(v.output_config.format.schema.properties.voorstellen.items.properties.doelgroep.enum) === JSON.stringify(DOELGROEPEN.map((d) => d.key)) && v.output_config.format.schema.additionalProperties === false);
ok('denkdiepte via effort; niets dat de nieuwe modellen weigeren (temperature, budget_tokens, denken uit, voorgevuld antwoord)', v.output_config.effort === 'medium' && !('temperature' in v) && !('top_p' in v) && !('thinking' in v) && v.messages.length === 1 && v.messages[0].role === 'user' && v.max_tokens >= 8000);
ok('het antwoord wordt gelezen op type (een denkblok vooraan is normaal) en netjes genormaliseerd', uit && uit.voorstellen.length === 2 && uit.voorstellen[0].doelgroep === 'schuifpui' && uit.voorstellen[1].params.maanden === 18 && uit.voorstellen.every((x) => x.bron === 'ai' && x.tekst && x.onderwerp && x.waarom), JSON.stringify(uit));
ok('een voorstel met een doelgroep die niet bestaat wordt weggegooid', !uit.voorstellen.some((x) => x.doelgroep === 'bestaat-niet'));
ok('in de opdracht aan de AI staat dat een mens beslist en dat er geen prijzen of acties verzonnen worden', /beslist en verstuurt zelf/.test(v.system) && /Verzin geen prijzen/.test(v.system) && /afmeldlink zet het systeem/.test(v.system));

antwoord = () => tekstAntwoord('dit is geen json');
ok('onbruikbaar antwoord → geen voorstellen (de vaste regels nemen het over)', (await ai.campagneVoorstellenAI({ telling, doelgroepen, maand: 11 })) === null);
antwoord = () => ({ json: { content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null }, usage: { input_tokens: 10, output_tokens: 0 } } });
const voorWeigering = verzoeken.length;
ok('weigering van elk model in de ketting → geen voorstellen, geen fout', (await ai.campagneVoorstellenAI({ telling, doelgroepen, maand: 11 })) === null && verzoeken.length - voorWeigering >= 2, String(verzoeken.length - voorWeigering));
antwoord = () => ({ status: 500, json: { error: { message: 'storing' } } });
ok('storing bij de AI → geen voorstellen, geen fout', (await ai.campagneVoorstellenAI({ telling, doelgroepen, maand: 11 })) === null);
const zonder = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
const voorZonder = verzoeken.length;
ok('zonder AI-sleutel wordt de AI niet eens aangeroepen', (await ai.campagneVoorstellenAI({ telling, doelgroepen, maand: 11 })) === null && verzoeken.length === voorZonder);
let foutZonder = ''; try { await ai.campagneTekstAI({ wens: 'korter' }); } catch (e) { foutZonder = e.message; }
ok('tekst schrijven zonder sleutel: duidelijke uitleg in gewone taal', /niet ingesteld/.test(foutZonder), foutZonder);
process.env.ANTHROPIC_API_KEY = zonder;

antwoord = () => tekstAntwoord({ onderwerp: 'Loopt uw schuifpui nog soepel?', tekst: 'Beste {naam},\n\nKorter en duidelijker.' });
const t = await ai.campagneTekstAI({ wens: 'Maak hem korter', doelgroepNaam: 'Schuifpui-klanten', onderwerp: 'Oud', tekst: 'Beste {naam}, lange tekst', companyProfile: '' });
const vt = verzoeken[verzoeken.length - 1].body;
ok('tekst schrijven: onderwerp + tekst terug, met de wens en de huidige tekst in het verzoek', t.tekst.includes('Korter') && t.onderwerp.includes('schuifpui') && /Maak hem korter/.test(vt.messages[0].content) && /lange tekst/.test(vt.messages[0].content) && vt.output_config.format.type === 'json_schema');
antwoord = () => ({ json: { content: [], stop_reason: 'refusal', usage: { input_tokens: 1, output_tokens: 0 } } });
let foutWeiger = ''; try { await ai.campagneTekstAI({ wens: 'x' }); } catch (e) { foutWeiger = e.message; }
ok('tekst schrijven: een weigering geeft een nette melding (geen lege tekst in het scherm)', /niet uitvoeren|niet bereikbaar|geen bruikbare/.test(foutWeiger), foutWeiger);

console.log(`\n========== CAMPAGNE-AI: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);

// Test: het LEZEN VAN DAGRAPPORTEN — het onderdeel waar de eigenaar over klaagde
// ("zelfs simpele rapporten die we dagelijks in DRS sturen slaat die AI soms de plank
// mis"). Er was geen enkele test die dit bewaakte; daardoor bleven vier fouten jarenlang
// onopgemerkt. Deze test draait zonder server en zonder AI-sleutel: hij controleert de
// VOORBEREIDING (wat de AI te zien krijgt) en de herkenning van postcodes en adressen.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = process.env.DATA_DIR || mkdtempSync(join(tmpdir(), 'crm-rapport-'));
let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); } }

const { extractDetails, buildStatusScanPrompt } = await import('../server/ai/categorizer.js');

// Het rapport zoals de monteur het 's avonds stuurt: kopje + regels met postcode.
const DAGRAPPORT = `Vrijdag 03-07
Afgerond
5056AC Berkel-Enschot €556 pin
Offerte
4631 TB Hoogerheide offerte afgegeven
Afspraken
5171AE Kaatsheuvel maandag
4664 BS Lepelstraat maandag
Geannuleerd
5224BN Den Bosch advies gegeven`;

console.log('\n== De AI krijgt het rapport MET regeleindes te zien ==');
const prompt = buildStatusScanPrompt({
  orders: [{ id: 'ord_1', title: 'Slot vervangen', status: 'open', customer: 'Jan', phone: '0612345678', address: 'Kerkstraat 12, 5056 AC Berkel-Enschot', isDrs: true, createdAt: '2026-07-01', updatedAt: '2026-07-02', thread: [] }],
  messages: [{ receivedAt: new Date().toISOString(), group: 'Youssef Keyservice247', sender: 'Youssef', body: DAGRAPPORT, channel: 'whatsapp' }],
  monteurGroups: ['Youssef Keyservice247'],
});
// Het rapport heeft 10 regels; die moeten allemaal apart in de prompt staan.
const rapportRegels = (prompt.match(/^ {4}\S/gm) || []).length;
ok('rapport staat als losse regels in de prompt (niet platgeslagen)', rapportRegels >= 9, `ingesprongen rapportregels: ${rapportRegels}`);
ok('kopje "Afgerond" staat op een eigen regel', /\n\s*Afgerond\s*\n/.test(prompt));
ok('kopje "Afspraken" staat op een eigen regel', /\n\s*Afspraken\s*\n/.test(prompt));
ok('elke postcoderegel staat apart', /5171AE Kaatsheuvel/.test(prompt) && /4664 BS Lepelstraat/.test(prompt));
ok('het rapport is als monteursgroep gelabeld', /monteursgroep/.test(prompt));
ok('kaarten dragen een datum, zodat de AI ze in de tijd kan plaatsen', /binnen: 2026-07-01/.test(prompt) && /laatst gewijzigd: 2026-07-02/.test(prompt));

console.log('\n== Postcodes: mét én zonder spatie ==');
const adresVan = (t) => extractDetails(t).customerAddress || '';
ok('postcode ZONDER spatie wordt herkend (5056AC)', /5056AC/.test(adresVan('Naam: Piet\nAdres: Hoofdstraat 8 5056AC Berkel-Enschot')), adresVan('Naam: Piet\nAdres: Hoofdstraat 8 5056AC Berkel-Enschot'));
ok('postcode MET spatie blijft werken (5211 AB)', /5211 AB/.test(adresVan('Naam: Piet\nAdres: Hoofdstraat 8 5211 AB Den Bosch')), adresVan('Naam: Piet\nAdres: Hoofdstraat 8 5211 AB Den Bosch'));

console.log('\n== Adres wordt niet meer afgekapt bij de komma ==');
const metKomma = adresVan('Naam: Jan Jansen\nTelefoon: 0612345678\nAdres: Kerkstraat 12, 5056 AC Berkel-Enschot\nBericht: slot kapot');
ok('postcode en plaats blijven staan achter de komma', /5056 AC/.test(metKomma) && /Berkel-Enschot/.test(metKomma), metKomma);
ok('straat en huisnummer staan er nog steeds voor', /Kerkstraat 12/.test(metKomma), metKomma);

console.log('\n== Meerwoordige plaatsnamen ==');
const denBosch = adresVan("Naam: Piet\nAdres: Marktplein 3, 5211 AB 's-Hertogenbosch");
ok('plaatsnaam met apostrof/streepje blijft heel', /Hertogenbosch/.test(denBosch), denBosch);

console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);

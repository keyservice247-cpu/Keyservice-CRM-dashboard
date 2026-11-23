// Test: AI VALT UIT (audit G1, 23 nov 2026). Zonder server en zonder echte AI: fetch
// wordt onderschept en geeft voor elke AI-aanroep een storing terug.
// Regel: als de AI uitvalt delen vaste trefwoorden het bericht in, met een vaste
// "zekerheid". Dat getal mag NOOIT tellen voor automatisch goedkeuren — het bericht
// blijft voor een mens in de inbox, met de reden erbij. Zonder AI-sleutel (de bewuste
// stand zonder AI) blijft alles werken zoals het was.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ALTIJD een eigen, lege map: deze test mag nooit op bestaande gegevens draaien.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'crm-aiuitval-'));
for (const k of Object.keys(process.env)) if (/^(SMTP_|IMAP_|WHATSAPP_|GOOGLE_|ANTHROPIC_)/.test(k)) delete process.env[k];

let aiAanroepen = 0;
globalThis.fetch = async (url) => {
  if (String(url).includes('anthropic')) { aiAanroepen++; return new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), { status: 529 }); }
  throw new Error('onverwachte netwerkaanroep in de test: ' + url);
};

const { db, load } = await import('../server/db.js');
load();
const { ingestMessage } = await import('../server/pipeline.js');

let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); } }

const s = db().settings;
s.whatsappOrderGroups = 'opdrachtgever testgroep';
s.aiAutoApproveThreshold = 0.5;
s.autoMergeWindowHours = 0;
const opdracht = (naam, tel, straat) => `Hallo. We sturen je de volgende klant:\nNaam: ${naam}\nAdres: ${straat}\nWoonplaats: 1234 EF - Testdorp\nTelefoon: ${tel}\nOpmerkingen: voordeur klemt, graag vandaag`;

console.log('\n== 1. Zonder AI-sleutel (bewuste stand): gedrag ongewijzigd ==');
const a = await ingestMessage({ channel: 'whatsapp', sender: 'Kim', group: 'Opdrachtgever testgroep', body: opdracht('Peter Smits', '0611000021', 'Eikenlaan 14'), externalId: 'u-1' });
ok('complete groepsopdracht boven de drempel wordt automatisch een opdracht', a.review && a.review.status === 'auto_approved', a.review && a.review.status);
ok('geen AI aangeroepen', aiAanroepen === 0);

console.log('\n== 2. Met AI-sleutel, maar de AI is onbereikbaar ==');
process.env.ANTHROPIC_API_KEY = 'test-sleutel';
const t0 = Date.now();
const b = await ingestMessage({ channel: 'whatsapp', sender: 'Kim', group: 'Opdrachtgever testgroep', body: opdracht('Anna Koster', '0611000022', 'Wilgenhof 3'), externalId: 'u-2' });
ok('de AI is echt geprobeerd', aiAanroepen >= 1, String(aiAanroepen));
ok('het bericht is NIET verloren: er staat een inbox-item', !!b.review && !!b.message);
ok('ingedeeld op trefwoorden (ai-fallback)', /ai-fallback/.test(String(b.suggestion?.engine || b.review?.suggestion?.engine || '')), JSON.stringify(b.review?.suggestion?.engine));
ok('NIET automatisch goedgekeurd — blijft "te controleren"', b.review.status === 'pending', b.review.status);
ok('de reden staat op het bericht', /AI niet beschikbaar/.test(String(b.review.autoOvergeslagen || '')), String(b.review.autoOvergeslagen));
ok('er is geen opdracht van gemaakt', !(db().orders || []).some((o) => /Koster/.test(JSON.stringify(o.intake || {}) + (o.title || ''))));
console.log(`  (uitval + terugval duurde ${Math.round((Date.now() - t0) / 100) / 10} s)`);

console.log('\n== 3. AI-sleutel weer weg: weer als vanouds ==');
delete process.env.ANTHROPIC_API_KEY;
const c = await ingestMessage({ channel: 'whatsapp', sender: 'Kim', group: 'Opdrachtgever testgroep', body: opdracht('Karel Proef', '0611000023', 'Dorpsstraat 7'), externalId: 'u-3' });
ok('zonder sleutel weer automatisch goedgekeurd', c.review && c.review.status === 'auto_approved', c.review && c.review.status);

console.log(`\n========== AI-UITVAL: ${passed} geslaagd, ${failed} gefaald ==========`);
if (failed) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);

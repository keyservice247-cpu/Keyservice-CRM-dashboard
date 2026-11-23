// Test: EERLIJKE SYSTEEMCONTROLE (audit E5, 23 nov 2026). Zonder server; geen verbinding
// naar buiten (de "mailserver" is een dichte poort op deze machine).
// Regel: een koppeling die ooit werkte en nu "niet ingesteld" is, is ROOD — niet groen.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'crm-status-'));
for (const k of Object.keys(process.env)) if (/^(SMTP_|IMAP_|WHATSAPP_|GOOGLE_|ANTHROPIC_|OMGEVING)/.test(k)) delete process.env[k];
globalThis.fetch = async (url) => { if (String(url).includes('anthropic')) return new Response('{}', { status: 200 }); throw new Error('onverwachte netwerkaanroep: ' + url); };

const { db, load } = await import('../server/db.js'); load();
const { runHealthCheck, runLichteCheck, lastHealth } = await import('../server/health.js');
let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); } }

console.log('\n== 1. Nooit iets ingesteld: geen alarm (nieuwe installatie) ==');
let h = await runHealthCheck();
ok('mail en AI "niet ingesteld" zijn dan gewoon in orde', h.smtp.ok && h.imap.ok && h.ai.ok && h.allOk, JSON.stringify(h).slice(0, 200));

console.log('\n== 2. Koppelingen ingesteld (mailserver = dichte poort hier) ==');
Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: '2', SMTP_USER: 'x', SMTP_PASSWORD: 'y', IMAP_HOST: '127.0.0.1', IMAP_PORT: '3', IMAP_USER: 'x', IMAP_PASSWORD: 'y', ANTHROPIC_API_KEY: 'test-sleutel' });
h = await runHealthCheck();
ok('SMTP ingesteld maar onbereikbaar → rood met de echte fout', h.smtp.configured === true && h.smtp.ok === false && /SMTP-fout/.test(h.smtp.detail), h.smtp.detail);
ok('AI ingesteld en bereikbaar → groen', h.ai.ok && h.ai.mode === 'ai');
ok('het systeem onthoudt dat de drie koppelingen ingesteld waren', !!db().settings._koppelGezien?.smtp && !!db().settings._koppelGezien?.imap && !!db().settings._koppelGezien?.ai);

console.log('\n== 3. Instellingen vallen weg (bijvoorbeeld bij een wijziging op de server) ==');
for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'IMAP_HOST', 'IMAP_USER', 'IMAP_PASSWORD', 'ANTHROPIC_API_KEY']) delete process.env[k];
const licht = runLichteCheck();
ok('lichte ronde (elke 10 min): alle drie ROOD, niet "alles werkt"', licht.allOk === false && !licht.smtp.ok && !licht.imap.ok && !licht.ai.ok, JSON.stringify([licht.smtp, licht.imap, licht.ai]).slice(0, 240));
ok('de melding zegt wat er aan de hand is en waar', /WAS ingesteld/.test(licht.smtp.detail) && /Render/.test(licht.imap.detail));
h = await runHealthCheck();
ok('volledige ronde: zelfde oordeel', h.allOk === false && !h.smtp.ok && !h.imap.ok && !h.ai.ok && /WAS ingesteld/.test(h.ai.detail));
ok('database-controle blijft groen', h.database.ok === true);

console.log('\n== 4. Weer ingesteld: herstelt vanzelf ==');
process.env.ANTHROPIC_API_KEY = 'test-sleutel';
h = await runHealthCheck();
ok('AI weer groen zodra de sleutel terug is', h.ai.ok === true && lastHealth().ai.ok === true);

console.log(`\n========== STATUS: ${passed} geslaagd, ${failed} gefaald ==========`);
if (failed) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);

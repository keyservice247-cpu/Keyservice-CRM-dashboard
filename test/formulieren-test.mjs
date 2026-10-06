// Test: bewaking van de website-formulieren (6 okt 2026, eigenaar: "het lijkt alsof
// FormSubmit niet werkt — dat moet werken!"). Zonder server: FormSubmit-activatiemails
// worden herkend + link bewaard (één keer), status per website (direct vs. FormSubmit-
// kopie), welke mailboxen het CRM leest, en de pipeline markeert de FormSubmit-kopie op
// de directe lead.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = process.env.DATA_DIR || mkdtempSync(join(tmpdir(), 'crm-formtest-'));
delete process.env.ANTHROPIC_API_KEY;
const F = await import('../server/formulieren.js');
const { db } = await import('../server/db.js');
const { ingestMessage } = await import('../server/pipeline.js');

let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); } }

console.log('\n== FormSubmit-activatiemail herkennen ==');
const actMail = {
  from: 'formsubmit <submissions@formsubmit.co>',
  subject: 'Action Required: Activate FormSubmit on schuifpuireparatie-breda.nl',
  text: 'Hi, you are one step away from making forms on https://schuifpuireparatie-breda.nl/offerte work. Click the button below to activate your form.',
  html: '<a href="https://formsubmit.co/confirm/abc123def456">ACTIVATE FORM</a> <a href="https://formsubmit.co">FormSubmit</a>',
};
ok('activatiemail wordt herkend', F.isFormSubmitActivatie(actMail));
ok('een gewone FormSubmit-aanvraag is GEEN activatie', !F.isFormSubmitActivatie({ from: 'FormSubmit <submissions@formsubmit.co>', subject: 'Offerte-aanvraag schuifpui – Breda (schuifpuireparatie-breda.nl)', text: 'Naam: Piet\nTelefoon: 0612345678' }));
ok('klantmail met "activeren" is GEEN activatie', !F.isFormSubmitActivatie({ from: 'Piet <piet@example.nl>', subject: 'Kunt u mijn alarm activeren?', text: 'action required' }));
const gelezen = F.leesActivatie(actMail);
ok('activatielink + website uit de mail gehaald', gelezen.link === 'https://formsubmit.co/confirm/abc123def456' && gelezen.site === 'schuifpuireparatie-breda.nl', JSON.stringify(gelezen));
const r1 = F.registreerFormSubmitActivatie(actMail);
const r2 = F.registreerFormSubmitActivatie(actMail);
ok('zelfde activatiemail twee keer → één keer vastgelegd', !!r1 && r2 === null && db().settings._formSubmitActivaties.length === 1);

console.log('\n== Mailboxen die het CRM leest ==');
ok('hoofdbox + extra boxen, zonder wachtwoorden', JSON.stringify(F.gelezenMailboxen({ IMAP_USER: 'Info@keyservice247.nl', IMAP_INGEST_ACCOUNTS: 'contact@keyservice247.nl:geheim,assistente@keyservice247.nl:x' })) === JSON.stringify(['info@keyservice247.nl', 'contact@keyservice247.nl', 'assistente@keyservice247.nl']));
const st0 = F.formulierStatus({ env: { IMAP_USER: 'info@keyservice247.nl' } });
ok('FormSubmit-box niet in de lijst → "wordt niet gelezen"', st0.leestDoelBox === false && st0.activatiesOpen.length === 1 && !JSON.stringify(st0).includes('geheim'));
ok('met contact@ erbij → wordt gelezen', F.formulierStatus({ env: { IMAP_INGEST_ACCOUNTS: 'contact@keyservice247.nl:x' } }).leestDoelBox === true);
ok('activatie afvinken → niet meer open', F.markeerActivatieAfgehandeld(st0.activatiesOpen[0].sleutel, 'Test') && F.formulierStatus({ env: {} }).activatiesOpen.length === 0);

console.log('\n== Direct + FormSubmit-kopie per website ==');
const direct = await ingestMessage({
  channel: 'email', sender: 'Bart Breda <bart@example.nl>', subject: 'Offerteaanvraag via schuifpuireparatie-breda.nl',
  body: 'Nieuwe aanvraag via de website schuifpuireparatie-breda.nl (offerte).\n\nNaam: Bart Breda\nTelefoon: 0654545454\nE-mail: bart@example.nl\nWoonplaats: Breda\nBericht: Schuifpui loopt zwaar, graag langskomen voor een offerte',
  mailbox: 'website-direct', forceRelevant: true,
});
ok('directe website-aanvraag binnen', !!direct.message && direct.message.mailbox === 'website-direct');
const kopie = await ingestMessage({
  channel: 'email', sender: 'FormSubmit <submissions@formsubmit.co>', subject: 'Offerte-aanvraag schuifpui – Breda (schuifpuireparatie-breda.nl)',
  body: 'Nieuwe aanvraag via de website schuifpuireparatie-breda.nl (FormSubmit-mail).\nNaam: Bart Breda\nTelefoon: 0654545454\nE-mail: bart@example.nl\nAdres: Breda\n\nSchuifpui loopt zwaar, graag langskomen voor een offerte',
  externalId: 'fs-1',
});
ok('FormSubmit-kopie ontdubbeld tegen de directe lead', kopie.duplicate === true);
ok('… en op de directe lead gemarkeerd als "kopie aangekomen"', !!direct.message.formSubmitKopieAt);
const st = F.formulierStatus({ env: {} });
const breda = st.sites.find((s) => s.site === 'schuifpuireparatie-breda.nl');
ok('status per website: direct 1, FormSubmit 1, zonder kopie 0', breda && breda.direct.aantal30 === 1 && breda.formsubmit.aantal30 === 1 && breda.zonderKopie30 === 0, JSON.stringify(breda));
// Directe lead van >6 uur oud zonder kopie → telt als "zonder kopie".
const oud = await ingestMessage({
  channel: 'email', sender: 'Olga Oud <olga@example.nl>', subject: 'Offerteaanvraag via schuifpuireparatie-amsterdam.nl',
  body: 'Nieuwe aanvraag via de website schuifpuireparatie-amsterdam.nl (offerte).\n\nNaam: Olga Oud\nTelefoon: 0611122233\nE-mail: olga@example.nl\nWoonplaats: Amsterdam\nBericht: Schuifpui sluit niet meer goed af, graag een offerte',
  mailbox: 'website-direct', forceRelevant: true,
});
oud.message.receivedAt = new Date(Date.now() - 8 * 3600000).toISOString();
const ams = F.formulierStatus({ env: {} }).sites.find((s) => s.site === 'schuifpuireparatie-amsterdam.nl');
ok('directe lead zonder FormSubmit-kopie na 6 uur → gemeld als "zonder kopie"', ams && ams.zonderKopie30 === 1 && ams.formsubmit.aantal30 === 0, JSON.stringify(ams));

console.log(`\n========== FORMULIEREN: ${passed} geslaagd, ${failed} gefaald ==========`);
if (failed) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);

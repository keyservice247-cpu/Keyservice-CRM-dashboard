// Test: bewaking van de website-formulieren (6 okt 2026, eigenaar: "het lijkt alsof
// FormSubmit niet werkt — dat moet werken!"). Zonder server: FormSubmit-activatiemails
// worden herkend + link bewaard (één keer), status per website (direct vs. FormSubmit-
// kopie), welke mailboxen het CRM leest, en de pipeline markeert de FormSubmit-kopie op
// de directe lead.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer } from 'node:net';

process.env.DATA_DIR = process.env.DATA_DIR || mkdtempSync(join(tmpdir(), 'crm-formtest-'));
delete process.env.ANTHROPIC_API_KEY;
// Nep-mailserver: telt de ontvangstbevestigingen (nooit dubbel naar dezelfde klant).
const SMTP_PORT = 2645;
const mails = [];
const smtp = createServer((sock) => {
  let data = false; let buf = ''; let huidig = '';
  sock.write('220 nep\r\n');
  sock.on('data', (c) => {
    buf += c.toString('utf8'); let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const r = buf.slice(0, i); buf = buf.slice(i + 2);
      if (data) { if (r === '.') { data = false; mails.push(huidig); huidig = ''; sock.write('250 OK\r\n'); } else huidig += r + '\n'; continue; }
      const cmd = r.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO') sock.write('250-nep\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (cmd === 'AUTH') sock.write('235 OK\r\n');
      else if (cmd === 'MAIL' || cmd === 'RCPT' || cmd === 'RSET' || cmd === 'NOOP') sock.write('250 OK\r\n');
      else if (cmd === 'DATA') { data = true; sock.write('354 ga\r\n'); }
      else if (cmd === 'QUIT') { sock.write('221 doei\r\n'); sock.end(); }
      else sock.write('250 OK\r\n');
    }
  });
  sock.on('error', () => {});
});
await new Promise((r) => smtp.listen(SMTP_PORT, r));
Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(SMTP_PORT), SMTP_USER: 'crm@keyservice247.nl', SMTP_PASSWORD: 'x' });
const F = await import('../server/formulieren.js');
const { db } = await import('../server/db.js');
const { ingestMessage } = await import('../server/pipeline.js');
const { maybeSendAutoReply } = await import('../server/autoreply.js');
const { parseFormSubmit } = await import('../server/connectors/email-imap.js');

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
// Oude kopie zonder vlag (van vóór 6 okt, los opgeslagen) telt wél als kopie: koppeling op nummer.
db().messages.push({ id: 'fs-los-olga', channel: 'email', sender: 'FormSubmit <submissions@formsubmit.co>', mailbox: 'crm@keyservice247.nl',
  subject: 'Offerte-aanvraag schuifpui (schuifpuireparatie-amsterdam.nl)', receivedAt: new Date(Date.now() - 7 * 3600000).toISOString(),
  body: 'Nieuwe aanvraag via de website schuifpuireparatie-amsterdam.nl (FormSubmit-mail).\nNaam: Olga Oud\nTelefoon: +31 6 11122233\nAndere tekst' });
const ams2 = F.formulierStatus({ env: {} }).sites.find((s) => s.site === 'schuifpuireparatie-amsterdam.nl');
ok('losse oude FormSubmit-mail met zelfde nummer (+31-notatie) → niet meer "zonder kopie"', ams2 && ams2.zonderKopie30 === 0 && ams2.formsubmit.aantal30 === 1, JSON.stringify(ams2));
db().messages = db().messages.filter((m) => m.id !== 'fs-los-olga');

console.log('\n== FormSubmit-mailbox: alleen formulier-mails ==');
ok('contact@: gewone mail wordt overgeslagen', F.mailOverslaanInFormSubmitBox({ mailbox: 'contact@keyservice247.nl', from: 'Leverancier <info@leverancier.nl>', subject: 'Uw bestelling' }) === true);
ok('contact@: FormSubmit-mail wordt verwerkt', F.mailOverslaanInFormSubmitBox({ mailbox: 'contact@keyservice247.nl', from: 'FormSubmit <submissions@formsubmit.co>', subject: 'Offerte' }) === false);
ok('andere mailbox: nooit overslaan', F.mailOverslaanInFormSubmitBox({ mailbox: '', from: 'Leverancier <info@leverancier.nl>', subject: 'x' }) === false);
ok('instelling "alles" → niets overslaan', F.mailOverslaanInFormSubmitBox({ mailbox: 'contact@keyservice247.nl', from: 'x <x@y.nl>', subject: 'x', instelling: { alleenFormulieren: false } }) === false);
const pf = parseFormSubmit('Someone just submitted your form on https://www.keyservice247.nl/contact.\nname: Kees\nphone: 0612345678', 'New submission');
ok('website uit "submitted your form on …" gehaald (geen "website onbekend")', /^Nieuwe aanvraag via de website keyservice247\.nl \(FormSubmit-mail\)/.test(pf), pf.split('\n')[0]);

console.log('\n== Achterstand (net gekoppelde mailbox): ontdubbelen op de dag van de mail ==');
const tweeDagen = new Date(Date.now() - 2 * 86400000).toISOString();
const d2 = await ingestMessage({
  channel: 'email', sender: 'Dirk Dagen <dirk@example.nl>', subject: 'Offerteaanvraag via schuifpuiservice.com',
  body: 'Nieuwe aanvraag via de website schuifpuiservice.com (offerte).\n\nNaam: Dirk Dagen\nTelefoon: 0677712345\nE-mail: dirk@example.nl\nWoonplaats: Ede\nBericht: Schuifpui klemt aan de onderkant, graag een monteur langs',
  mailbox: 'website-direct', forceRelevant: true,
});
d2.message.receivedAt = tweeDagen;
const oudeKopie = await ingestMessage({
  channel: 'email', sender: 'FormSubmit <submissions@formsubmit.co>', subject: 'Offerte-aanvraag schuifpui (schuifpuiservice.com)',
  body: 'Nieuwe aanvraag via de website schuifpuiservice.com (FormSubmit-mail).\nNaam: Dirk Dagen\nTelefoon: 0677712345\nE-mail: dirk@example.nl\n\n(tekst door FormSubmit anders opgemaakt)',
  externalId: 'fs-oud-1', verzondenOp: tweeDagen, backlog: true,
});
ok('oude FormSubmit-kopie (2 dagen) van een bekende aanvraag → dubbel, geen nieuwe lead', oudeKopie.duplicate === true, JSON.stringify({ dup: oudeKopie.duplicate }));
ok('… en de kopie staat op de directe aanvraag met de datum van de mail', d2.message.formSubmitKopieAt && Math.abs(new Date(d2.message.formSubmitKopieAt).getTime() - new Date(tweeDagen).getTime()) < 60000);
const gemist = await ingestMessage({
  channel: 'email', sender: 'FormSubmit <submissions@formsubmit.co>', subject: 'Offerte-aanvraag schuifpui (schuifpuireparatie-utrecht.nl)',
  body: 'Nieuwe aanvraag via de website schuifpuireparatie-utrecht.nl (FormSubmit-mail).\nNaam: Greet Gemist\nTelefoon: 0688812345\nE-mail: greet@example.nl\nAdres: Utrecht\n\nOnze schuifpui zit vast, kunt u komen kijken?',
  externalId: 'fs-oud-2', verzondenOp: tweeDagen, backlog: true,
});
ok('oude FormSubmit-mail zónder directe aanvraag → TERUGGEVONDEN in de inbox', gemist.review && gemist.review.status === 'pending' && gemist.message.teruggevonden === true && /TERUGGEVONDEN/.test(gemist.review.suggestion.relevanceReason || ''), JSON.stringify({ st: gemist.review && gemist.review.status, r: gemist.review && gemist.review.suggestion.relevanceReason }));
ok('teller teruggevonden in de status', F.formulierStatus({ env: {} }).teruggevonden30 >= 1);

console.log('\n== Ontvangstbevestiging: nooit twee keer voor dezelfde aanvraag ==');
db().settings.autoReply = { enabled: true };
const nieuw = await ingestMessage({
  channel: 'email', sender: 'Bea Bevestig <bea@example.nl>', subject: 'Offerteaanvraag via schuifpuiservice.com',
  body: 'Nieuwe aanvraag via de website schuifpuiservice.com (offerte).\n\nNaam: Bea Bevestig\nTelefoon: 0699912345\nE-mail: bea@example.nl\nWoonplaats: Zeist\nBericht: Graag een offerte voor nieuwe loopwagens in de schuifpui',
  mailbox: 'website-direct', forceRelevant: true,
});
await maybeSendAutoReply(nieuw);
const naarBea = () => mails.filter((m) => /bea@example\.nl/i.test(m)).length;
ok('eerste keer: één bevestiging', naarBea() === 1, String(naarBea()));
const bea = db().customers.find((c) => c.email === 'bea@example.nl');
if (bea) bea.autoRepliedAt = new Date(Date.now() - 3 * 3600000).toISOString(); // uur-rem voorbij
await maybeSendAutoReply({ ...nieuw, duplicate: true });
ok('dubbele binnenkomst (FormSubmit-kopie) → géén tweede bevestiging, ook na het uur', naarBea() === 1, String(naarBea()));
await maybeSendAutoReply({ message: nieuw.message, review: nieuw.review });
ok('zelfde aanvraag nog eens verwerkt → géén tweede bevestiging', naarBea() === 1, String(naarBea()));
console.log('\n== Mailbox-verwerking (nagebootste contact@-mailbox) ==');
{
  const { _processInboxVoorTest } = await import('../server/connectors/email-imap.js');
  // Directe aanvraag van vandaag; de FormSubmit-kopie komt straks uit "contact@".
  await ingestMessage({
    channel: 'email', sender: 'Mia Mailbox <mia@example.nl>', subject: 'Offerteaanvraag via schuifpuiservice.com',
    body: 'Nieuwe aanvraag via de website schuifpuiservice.com (offerte).\n\nNaam: Mia Mailbox\nTelefoon: 0655566677\nE-mail: mia@example.nl\nWoonplaats: Gouda\nBericht: Onze schuifpui gaat heel zwaar open en dicht, graag advies',
    mailbox: 'website-direct', forceRelevant: true,
  });
  const nu = new Date();
  const doos = {
    1: { env: { messageId: '<fs-mia@formsubmit>', from: [{ name: 'FormSubmit', address: 'submissions@formsubmit.co' }], subject: 'Offerte-aanvraag schuifpui (schuifpuiservice.com)' },
      parsed: { from: { text: 'FormSubmit <submissions@formsubmit.co>' }, subject: 'Offerte-aanvraag schuifpui (schuifpuiservice.com)', date: nu, attachments: [], text: 'Someone just submitted your form on https://schuifpuiservice.com/offerte.\nNaam: Mia Mailbox\nTelefoon: 0655566677\nE-mail: mia@example.nl\nWoonplaats: Gouda\nToelichting: Onze schuifpui gaat heel zwaar open en dicht, graag advies' } },
    2: { env: { messageId: '<lev-1@leverancier>', from: [{ name: 'Leverancier', address: 'info@leverancier.nl' }], subject: 'Uw bestelling is verzonden' },
      parsed: { from: { text: 'Leverancier <info@leverancier.nl>' }, subject: 'Uw bestelling is verzonden', date: nu, attachments: [], text: 'Uw pakket komt morgen.' } },
  };
  let bronOpgehaald = 0;
  const client = {
    getMailboxLock: async () => ({ release() {} }),
    search: async () => [1, 2],
    fetchOne: async (uid, q) => (q.envelope ? { envelope: doos[uid].env } : (bronOpgehaald++, { source: String(uid) })),
  };
  const parser = async (src) => doos[Number(src)].parsed;
  const berichtenVoor = db().messages.length;
  const reviewsVoor = db().reviews.length;
  const mailsVoor = mails.length;
  await _processInboxVoorTest(client, parser, new Date(Date.now() - 86400000), 'contact@keyservice247.nl');
  ok('leveranciersmail in contact@ blijft buiten het CRM (alleen FormSubmit-mails)', !db().messages.some((m) => /leverancier/i.test(m.sender || '')) && !!db().settings._imapGezien['<lev-1@leverancier>']);
  ok('FormSubmit-kopie ontdubbeld: geen nieuw bericht, geen nieuwe aanvraag', db().messages.length === berichtenVoor && db().reviews.length === reviewsVoor, `${berichtenVoor}->${db().messages.length}`);
  ok('… onthouden, en geen ontvangstbevestiging voor de kopie', !!db().settings._imapGezien['<fs-mia@formsubmit>'] && mails.length === mailsVoor);
  const bronNa1 = bronOpgehaald;
  await _processInboxVoorTest(client, parser, new Date(Date.now() - 86400000), 'contact@keyservice247.nl');
  ok('volgende ronde: niets opnieuw opgehaald of verwerkt', bronOpgehaald === bronNa1 && db().messages.length === berichtenVoor, `opgehaald ${bronNa1}->${bronOpgehaald}`);
  const miaDirect = db().messages.find((m) => m.mailbox === 'website-direct' && /Mia Mailbox/.test(m.body || ''));
  ok('status: FormSubmit-kopie zichtbaar bij schuifpuiservice.com', !!(miaDirect && miaDirect.formSubmitKopieAt));
}
smtp.close();

console.log(`\n========== FORMULIEREN: ${passed} geslaagd, ${failed} gefaald ==========`);
if (failed) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);

// Test: bounce-detectie ("mail niet afgeleverd") — zonder server en zonder echte
// mailbox. Bewaakt precies de gevaarlijke kant: een ECHTE klantmail mag nooit als
// bounce worden weggegooid (lead-instroom-wetten), en een echte DSN moet netjes
// aan de juiste kaart worden teruggekoppeld.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = process.env.DATA_DIR || mkdtempSync(join(tmpdir(), 'crm-mailtest-'));
const { looksLikeBounce, handleBounce } = await import('../server/connectors/email-imap.js');
const { db } = await import('../server/db.js');

let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); } }

const DSN_BODY = `This is the mail system at host mail.transip.email.
I'm sorry to have to inform you that your message could not be delivered.
Final-Recipient: rfc822; klant@example.nl
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550 5.1.1 Recipient address rejected: User unknown in virtual mailbox table
--- Original message headers ---
Message-ID: <ks-uit-123@keyservice247.nl>
`;

console.log('\n== looksLikeBounce: echte DSN wél, klantmail nooit ==');
ok('echte DSN (mailer-daemon + delivery-status) -> bounce', looksLikeBounce(
  { from: { text: 'Mail Delivery System <MAILER-DAEMON@transip.email>' }, subject: 'Undelivered Mail Returned to Sender', headerLines: [] }, DSN_BODY) === true);
ok('klantmail met "niet bezorgd" in onderwerp -> GEEN bounce (lead blijft leven)', looksLikeBounce(
  { from: { text: 'Piet Klant <piet@example.nl>' }, subject: 'Mijn vorige mail werd niet bezorgd - graag reactie', headerLines: [] },
  'Hallo, mijn slot is kapot. Kunnen jullie komen? 06-12345678.') === false);
ok('Fwd: Undeliverable van een klant -> GEEN bounce', looksLikeBounce(
  { from: { text: 'Piet Klant <piet@example.nl>' }, subject: 'Fwd: Undeliverable: mijn aanvraag', headerLines: [] },
  'zie onder, mijn voordeur klemt, tel 0612345678') === false);
ok('vertragings-DSN (action: delayed) -> GEEN bounce (geen vals alarm)', looksLikeBounce(
  { from: { text: 'MAILER-DAEMON@transip.email' }, subject: 'Delivery Status Notification (Delay)', headerLines: [] },
  'This is a warning only.\nFinal-Recipient: rfc822; klant@example.nl\nAction: delayed\nWill keep trying.') === false);

console.log('\n== handleBounce: terugkoppeling op de juiste kaart ==');
const d = db();
d.orders = d.orders || []; d.customers = d.customers || []; d.messages = d.messages || [];
d.customers.push({ id: 'cust_bt', name: 'Bounce Klant', email: 'klant@example.nl' });
const entry = { id: 'thr_bt', channel: 'email', outgoing: true, sender: 'Admin (Keyservice)', body: 'Beste klant, hierbij de offerte.', at: new Date().toISOString(), messageId: '<ks-uit-123@keyservice247.nl>', sentTo: 'klant@example.nl' };
d.orders.push({ id: 'ord_bt', title: 'Slot vervangen Rhenen', customerId: 'cust_bt', status: 'open', thread: [entry], updatedAt: new Date().toISOString() });
handleBounce({ from: { text: 'MAILER-DAEMON@transip.email' }, subject: 'Undelivered Mail Returned to Sender' }, DSN_BODY, '<bounce-1@transip>');
const ordBt = d.orders.find((o) => o.id === 'ord_bt');
ok('uitgaande mail gemarkeerd als NIET afgeleverd', entry.delivered === false && /550/.test(entry.bounce || ''), JSON.stringify(entry.bounce));
ok('waarschuwing in de gesprekshistorie van de kaart', (ordBt.thread || []).some((t) => /NIET AANGEKOMEN/.test(t.body || '')));
ok('reden = volledige Diagnostic-Code (niet het korte fragment)', /User unknown/.test((ordBt.thread.find((t) => /NIET AANGEKOMEN/.test(t.body || '')) || {}).body || ''));
ok('bounce geregistreerd als verwerkt bericht (nooit een lead)', d.messages.some((m) => m.externalId === '<bounce-1@transip>' && m.bounce === true));

console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);

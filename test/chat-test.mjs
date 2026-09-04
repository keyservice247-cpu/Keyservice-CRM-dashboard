// Test: BERICHTEN-SCHERM (7 aug 2026) — alle klantgesprekken op één plek.
//
// Bewaakt drie dingen die niet stilletjes kapot mogen:
// 1. Versturen loopt ALTIJD via de beveiligde wachtrij (pauzeknop/snelheidsrem gelden),
//    en het bericht komt óók als notitie op de nieuwste open kaart (alles gekoppeld).
// 2. De gesprekkenlijst en de historie kloppen (in- en uitgaand, geen dubbelen).
// 3. Alleen admin/assistent mogen erin; een monteur niet (die ziet alleen eigen kaarten).
//
// Draaien: DATA_DIR=<vers> INGEST_TOKEN=test123 SESSION_SECRET=test PORT=3127 node server/index.js &
//          node test/chat-test.mjs
const BASE = 'http://localhost:3127';
const TOKEN = 'test123';

let cookie = '';
let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}
async function api(method, path, body, useToken = false) {
  const headers = { 'content-type': 'application/json' };
  if (useToken) headers['x-ingest-token'] = TOKEN;
  if (cookie && !useToken) headers.cookie = cookie;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setC = r.headers.get('set-cookie');
  if (setC) cookie = setC.split(';')[0];
  let json = null; try { json = await r.json(); } catch { /* leeg */ }
  return { status: r.status, json };
}

console.log('\n== Setup ==');
const login = await api('POST', '/api/login', { email: 'admin@keyservice.nl', password: 'admin123' });
ok('inloggen', login.status === 200);
await api('PATCH', '/api/settings', { whatsappOrderGroups: 'raf breda', autoMergeWindowHours: 0 });
const mont = await api('POST', '/api/monteurs', { name: 'Youssef', phone: '0687654321', waGroup: 'Youssef Keyservice247' });
await api('PATCH', '/api/settings', { monteurDispatch: { autoEnabled: true, days: [0, 1, 2, 3, 4, 5, 6], autoMonteurId: mont.json.id, trigger: 'intake', onlyDrs: true } });

// Een klant komt binnen via de DRS-groep -> kaart + klant bestaan.
console.log('\n== Gesprek ontstaat uit een binnengekomen aanvraag ==');
await api('POST', '/api/ingest/whatsapp', {
  group: 'groep 120363177872957422', name: 'Chat Klant',
  body: 'Chat Klant, Teststraat 1, 3911 AB Rhenen, 0655512399, slot klemt, graag langskomen',
  externalId: 'chat1',
}, true);
const chats1 = await api('GET', '/api/chats');
ok('gesprekkenlijst bereikbaar', chats1.status === 200 && Array.isArray(chats1.json));
const gesprek = (chats1.json || []).find((c) => (c.phone || '').includes('0655512399'));
ok('klant staat in de gesprekkenlijst', !!gesprek, JSON.stringify((chats1.json || []).map((c) => c.name)));
ok('open kaart is gekoppeld aan het gesprek', !!gesprek?.orderId, JSON.stringify(gesprek));
ok('laatste bericht is het binnengekomen appje', /slot klemt/i.test(gesprek?.lastBody || ''));

console.log('\n== Versturen: via de beveiligde wachtrij én op de kaart ==');
const stuur = await api('POST', `/api/chats/${gesprek.id}/send`, { text: 'Goedemorgen! We kunnen vanmiddag om 14:00 langskomen. Schikt dat?' });
ok('versturen lukt', stuur.status === 200 && stuur.json?.ok, JSON.stringify(stuur.json));
ok('bericht gekoppeld aan de open kaart', stuur.json?.orderId === gesprek.orderId);
const wachtrij = await api('GET', '/api/whatsapp/outbox-status?full=1');
const item = (wachtrij.json || []).find((o) => /vanmiddag om 14:00/.test(o.text || ''));
ok('bericht staat in de ECHTE wachtrij (zelfde vangrails als altijd)', !!item && item.status === 'queued', JSON.stringify(item));
const orders = (await api('GET', '/api/orders')).json || [];
const kaart = orders.find((o) => o.id === gesprek.orderId);
ok('bericht staat ook als uitgaand in de kaart-historie', (kaart?.thread || []).some((t) => t.outgoing && /vanmiddag om 14:00/.test(t.body || '')));

const hist = await api('GET', `/api/customers/${gesprek.id}/history?limit=50`);
const uitgaand = (hist.json?.items || []).filter((t) => /vanmiddag om 14:00/.test(t.body || ''));
ok('historie toont het bericht PRECIES één keer (geen dubbel wachtrij+kaart)', uitgaand.length === 1, `${uitgaand.length}x`);
ok('met verzendstatus erbij', uitgaand[0]?.waStatus === 'queued', JSON.stringify(uitgaand[0]?.waStatus));

console.log('\n== Vangrails ==');
const pauze = await api('PATCH', '/api/settings', { whatsappPaused: true });
ok('pauzeknop aan te zetten', pauze.status === 200);
const stuur2 = await api('POST', `/api/chats/${gesprek.id}/send`, { text: 'Tweede bericht tijdens de pauze' });
ok('tijdens pauze: bericht in wachtrij, mét duidelijke pauze-vlag', stuur2.json?.ok && stuur2.json?.paused === true, JSON.stringify(stuur2.json));
await api('PATCH', '/api/settings', { whatsappPaused: false });
const leeg = await api('POST', `/api/chats/${gesprek.id}/send`, { text: '   ' });
ok('leeg bericht wordt geweigerd', leeg.status === 400);
const kloi = await api('POST', '/api/chats/bestaat-niet/send', { text: 'x' });
ok('onbekende klant -> nette 404', kloi.status === 404);
// Klant zonder (geldig) nummer -> duidelijke uitleg.
const zonderNr = await api('POST', '/api/customers', { name: 'Zonder Nummer', email: 'zn@example.nl' });
const znId = (zonderNr.json?.id) || (zonderNr.json?.customer?.id);
const stuur3 = await api('POST', `/api/chats/${znId}/send`, { text: 'Hallo?' });
ok('klant zonder nummer -> uitleg i.p.v. stille fout', stuur3.status === 400 && /telefoonnummer/i.test(stuur3.json?.error || ''), JSON.stringify(stuur3.json));

console.log('\n== Gelezen-teller ==');
// Klant reageert 1-op-1 -> unread loopt op; lezen zet hem op 0.
await api('POST', '/api/ingest/whatsapp', {
  name: 'Chat Klant', body: 'Ja dat schikt!\nTelefoon: +31655512399', externalId: 'chat2',
}, true);
const chats2 = await api('GET', '/api/chats');
const g2 = (chats2.json || []).find((c) => c.id === gesprek.id);
ok('klantreactie telt als ongelezen', (g2?.unread || 0) >= 1, JSON.stringify(g2?.unread));
ok('reactie staat in het gesprek als laatste bericht', /dat schikt/i.test(g2?.lastBody || ''));
await api('POST', `/api/chats/${gesprek.id}/read`, {});
const chats3 = await api('GET', '/api/chats');
ok('na openen: teller op nul', ((chats3.json || []).find((c) => c.id === gesprek.id)?.unread || 0) === 0);

console.log('\n== Onbekend nummer: appje is METEEN zichtbaar in Berichten ==');
// Een 1-op-1 appje van een onbekend nummer maakt (WET regel 5) géén klant aan — maar
// het gesprek moet wél direct in de lijst staan, anders "verdwijnt" het voor de gebruiker.
await api('POST', '/api/ingest/whatsapp', {
  name: 'Piet Onbekend', body: 'Hallo, wat kost een cilinderslot vervangen?\nTelefoon: +31688877766', externalId: 'chat-onb-1',
}, true);
const chatsO = await api('GET', '/api/chats');
const onb = (chatsO.json || []).find((c) => String(c.id).startsWith('tel:') && (c.phone || '').includes('688877766'));
ok('onbekend nummer staat in de gesprekkenlijst', !!onb, JSON.stringify((chatsO.json || []).map((c) => c.id)));
ok('met de profielnaam van de afzender', /Piet Onbekend/i.test(onb?.name || ''), onb?.name);
const kl0 = (await api('GET', '/api/customers')).json || [];
ok('er is GEEN klantrecord aangemaakt (WET regel 5)', !kl0.some((c) => (c.phone || '').includes('688877766')));
const histO = await api('GET', `/api/chats/nummer/${encodeURIComponent(onb.phone)}`);
ok('gesprek toont het binnengekomen appje', (histO.json?.items || []).some((t) => /cilinderslot vervangen/i.test(t.body || '')));
const stuurO = await api('POST', `/api/chats/nummer/${encodeURIComponent(onb.phone)}/send`, { text: 'Dat kost vanaf 95 euro incl. montage.' });
ok('terugsturen naar onbekend nummer lukt', stuurO.status === 200 && stuurO.json?.ok, JSON.stringify(stuurO.json));
const histO2 = await api('GET', `/api/chats/nummer/${encodeURIComponent(onb.phone)}`);
ok('antwoord staat in het gesprek met verzendstatus', (histO2.json?.items || []).some((t) => t.outgoing && /95 euro/.test(t.body || '') && t.waStatus === 'queued'));
const kl1 = (await api('GET', '/api/customers')).json || [];
ok('ook na versturen nog steeds geen klantrecord', !kl1.some((c) => (c.phone || '').includes('688877766')));

console.log('\n== Officiële Meta-route: nummer staat OP het bericht (niet in de tekst) ==');
// De bridge plakt "Telefoon: +31…" onder de body; Meta doet dat NIET en geeft het
// alleen als veld mee. Zonder opslaan viel zo'n appje overal buiten en leek het weg.
await api('POST', '/api/ingest/whatsapp', {
  name: 'Meta Klant', body: 'Goedemiddag, mijn voordeur klemt. Kunt u langskomen?',
  fromPhone: '0699911122', externalId: 'chat-meta-1',
}, true);
const chatsM = await api('GET', '/api/chats');
const mChat = (chatsM.json || []).find((c) => (c.phone || '').includes('699911122'));
ok('appje zonder telefoonregel in de tekst is TOCH zichtbaar', !!mChat, JSON.stringify((chatsM.json || []).map((c) => `${c.id}:${c.phone}`)));
ok('met de tekst van de klant erbij', /voordeur klemt/i.test(mChat?.lastBody || ''));
const histM = await api('GET', `/api/chats/nummer/${encodeURIComponent(mChat.phone)}`);
ok('het gesprek is te openen', (histM.json?.items || []).some((t) => /voordeur klemt/i.test(t.body || '')));

console.log('\n== Melding-teller: nieuwe klantappjes ==');
// Verse installatie: zonder ooit-geopend-markering telt hij bewust NIETS (audit 12
// aug — anders staat er "3000 nieuw" bij de eerste keer). Eerst openen, dan tellen.
const puls0 = await api('GET', '/api/pulse');
ok('vóór de eerste keer openen: teller op nul (geen oude berg)', (puls0.json?.newChats || 0) === 0, JSON.stringify(puls0.json?.newChats));
await api('POST', '/api/chats/seen', {});
await api('POST', '/api/ingest/whatsapp', { name: 'Meta Klant', body: 'Nog een vraagje!', fromPhone: '0699911122', externalId: 'chat-meta-1b' }, true);
const puls1 = await api('GET', '/api/pulse');
ok('pulse telt nieuwe klantappjes', (puls1.json?.newChats || 0) >= 1, JSON.stringify(puls1.json?.newChats));
await api('POST', '/api/chats/seen', {});
const puls2 = await api('GET', '/api/pulse');
ok('na openen van Berichten staat de teller op nul', (puls2.json?.newChats || 0) === 0, JSON.stringify(puls2.json?.newChats));
await api('POST', '/api/ingest/whatsapp', { name: 'Meta Klant', body: 'Bent u er nog?', fromPhone: '0699911122', externalId: 'chat-meta-2' }, true);
const puls3 = await api('GET', '/api/pulse');
ok('nieuw appje laat de teller weer oplopen', (puls3.json?.newChats || 0) >= 1, JSON.stringify(puls3.json?.newChats));

console.log('\n== Ruis hoort NIET in de gesprekkenlijst ==');
// WhatsApp stuurt zelf systeemmeldingen door en gebruikt interne codes van 15-18
// cijfers (LID's). Die stonden als "klanten" in de lijst en verdrongen de echte
// gesprekken; versturen gaf dan "Ongeldig nummer".
await api('POST', '/api/ingest/whatsapp', {
  name: '236206105329815', body: '[e2e_notification] Telefoon: +236206105329815', externalId: 'ruis-1',
}, true);
await api('POST', '/api/ingest/whatsapp', {
  name: 'LID Nummer', body: 'Bericht van een interne code\nTelefoon: +187419588604031', externalId: 'ruis-2',
}, true);
const chatsR = await api('GET', '/api/chats');
const lijstR = chatsR.json || [];
ok('systeemmelding [e2e_notification] staat NIET in de lijst',
  !lijstR.some((c) => /e2e_notification/i.test(c.lastBody || '')), JSON.stringify(lijstR.map((c) => c.lastBody).slice(0, 5)));
ok('interne WhatsApp-code (15+ cijfers) wordt geen gesprek',
  !lijstR.some((c) => String(c.phone || '').replace(/\D/g, '').length > 13), JSON.stringify(lijstR.map((c) => c.phone)));
ok('echte klantgesprekken staan er nog gewoon in', lijstR.some((c) => (c.phone || '').includes('0655512399')));

console.log('\n== Klant-link naar een bijlage (voor PDF via WhatsApp) ==');
// Ondertekende link: zonder inloggen te openen, maar alleen met de juiste handtekening.
const ordersU = (await api('GET', '/api/orders')).json || [];
const metBijlage = ordersU.find((o) => (o.attachments || []).length) || null;
let upFile = metBijlage?.attachments?.[0]?.file;
if (!upFile) {
  const up = await api('POST', `/api/orders/${ordersU[0].id}/attachments`, { filename: 'test.pdf', mime: 'application/pdf', dataBase64: Buffer.from('%PDF-1.4 test').toString('base64') });
  upFile = (up.json?.attachments || []).slice(-1)[0]?.file;
}
const zonderSig = await fetch(`${BASE}/uploads/${upFile}`, { redirect: 'manual' });
ok('zonder handtekening of login: geen toegang', zonderSig.status !== 200, String(zonderSig.status));
const fouteSig = await fetch(`${BASE}/uploads/${upFile}?sig=${'a'.repeat(32)}`, { redirect: 'manual' });
ok('met verkeerde handtekening: geen toegang', fouteSig.status !== 200, String(fouteSig.status));

console.log('\n== Beveiligde bijlage-link (audit 12 aug) ==');
// Constant-tijd-vergelijking mag het gedrag niet veranderen: goede sig werkt nog.
const ordU = (await api('GET', '/api/orders')).json || [];
const metB = ordU.find((o) => (o.attachments || []).length);
if (metB) {
  const f = metB.attachments[0].file;
  // De handtekening kunnen we hier niet berekenen (secret op de server), maar een
  // sig van verkeerde LENGTE mag nooit een 500 geven.
  const kort = await fetch(`${BASE}/uploads/${f}?sig=abc`, { redirect: 'manual' });
  ok('te korte handtekening -> nette weigering, geen crash', kort.status !== 200 && kort.status < 500, String(kort.status));
}

console.log('\n== Afspraakbevestiging: e-mail EN WhatsApp tegelijk (12 aug) ==');
// Klant mét e-mail én 06: voorheen kreeg die alleen e-mail. Nu hoort er ALTIJD ook
// een appje in de wachtrij te staan. (SMTP is hier niet geconfigureerd, dus de
// e-mailtak faalt stil — het appje mag daar nooit van afhangen.)
await api('PATCH', '/api/settings', { appointmentMsg: { emailEnabled: true, whatsappEnabled: true, emailSubject: 'Afspraak', emailBody: 'Bevestiging {datum}', whatsappBody: 'Bevestiging appje {datum}', reminderEnabled: false, reminderHours: 24, reminderEmailSubject: 'Herinnering', reminderBody: 'Herinnering {datum}' } });
const bevKlant = await api('POST', '/api/orders', { customerName: 'Bevestiging Klant', customerPhone: '0644332211', customerEmail: 'bevestiging@example.nl', title: 'Rhenen — bevestigingstest' });
await api('PATCH', `/api/orders/${bevKlant.json.id}`, { appointmentAt: new Date(Date.now() + 86400000).toISOString().slice(0, 16) });
await new Promise((r) => setTimeout(r, 600));
const wachtrijBev = (await api('GET', '/api/whatsapp/outbox-status?full=1')).json || [];
ok('klant mét e-mailadres krijgt TOCH een WhatsApp-bevestiging in de wachtrij',
  wachtrijBev.some((o) => (o.text || '').includes('Bevestiging appje')), JSON.stringify(wachtrijBev.map((o) => o.text).slice(0, 5)));

console.log('\n== Ongelezen ZONDER open kaart + tel:-gesprek (15 aug) ==');
// Het gemelde geval: klant met alleen AFGERONDE kaarten appt → moet gewoon een groene
// teller geven (leunde eerst op order.unreadReplies en bleef dus 0). En een onbekend
// nummer (tel:-gesprek) had een hardcoded 0 — ook dat telt nu echt.
await api('PATCH', `/api/orders/${gesprek.orderId}`, { status: 'afgerond' });
await api('POST', `/api/chats/${gesprek.id}/read`, {}); // schone start voor deze klant
await api('POST', '/api/ingest/whatsapp', {
  name: 'Chat Klant', body: 'Kunt u nog een reservesleutel bijmaken?\nTelefoon: +31655512399', externalId: 'chat-naklus-1',
}, true);
const chatsNa = await api('GET', '/api/chats');
const gNa = (chatsNa.json || []).find((c) => c.id === gesprek.id);
ok('appje ná afgeronde kaart telt als ongelezen', (gNa?.unread || 0) >= 1, JSON.stringify(gNa?.unread));
const pulsNa = await api('GET', '/api/pulse');
ok('pulse telt gesprekken met ongelezen (menubadge)', (pulsNa.json?.chatsOngelezen || 0) >= 1, JSON.stringify(pulsNa.json?.chatsOngelezen));
await api('POST', `/api/chats/${gesprek.id}/read`, {});
const chatsNa2 = await api('GET', '/api/chats');
ok('na lezen: teller weer op nul', ((chatsNa2.json || []).find((c) => c.id === gesprek.id)?.unread || 0) === 0);
// tel:-gesprek: ná ons eerdere antwoord (dat telt als gelezen) stuurt Piet iets nieuws.
await api('POST', '/api/ingest/whatsapp', {
  name: 'Piet Onbekend', body: 'Oke doe maar, wanneer kunt u?\nTelefoon: +31688877766', externalId: 'chat-onb-2',
}, true);
const chatsT = await api('GET', '/api/chats');
const telChat = (chatsT.json || []).find((c) => String(c.id).startsWith('tel:') && (c.phone || '').includes('688877766'));
ok('tel:-gesprek heeft een échte ongelezen-teller', (telChat?.unread || 0) >= 1, JSON.stringify(telChat));
const leesT = await api('POST', `/api/chats/${encodeURIComponent(telChat.id)}/read`, {});
ok('tel:-gesprek lezen lukt', leesT.status === 200, JSON.stringify(leesT.json));
const chatsT2 = await api('GET', '/api/chats');
ok('tel:-teller na lezen op nul', ((chatsT2.json || []).find((c) => c.id === telChat.id)?.unread || 0) === 0);

console.log('\n== Eigen antwoord telt als gelezen (15 aug) ==');
// Wie zelf antwoordt hoeft het gesprek niet ook nog te "openen" — de badge hoort dan weg.
await api('POST', '/api/ingest/whatsapp', {
  name: 'Chat Klant', body: 'Nog een vraag over de sleutel\nTelefoon: +31655512399', externalId: 'chat-eigen-1',
}, true);
const chatsE1 = await api('GET', '/api/chats');
ok('nieuw appje telt eerst als ongelezen', ((chatsE1.json || []).find((c) => c.id === gesprek.id)?.unread || 0) >= 1);
await api('POST', `/api/chats/${gesprek.id}/send`, { text: 'De reservesleutel ligt klaar, u kunt hem morgen ophalen.' });
const chatsE2 = await api('GET', '/api/chats');
ok('na ons eigen antwoord: badge weg zonder extra klik', ((chatsE2.json || []).find((c) => c.id === gesprek.id)?.unread || 0) === 0, JSON.stringify((chatsE2.json || []).find((c) => c.id === gesprek.id)?.unread));

console.log('\n== Automatisch bericht veegt de badge NIET weg (review-audit 15 aug) ==');
// Klantvraag om 14:00 + afspraakherinnering/bevestiging om 18:00 → vraag blijft ongelezen.
await api('POST', '/api/ingest/whatsapp', {
  name: 'Bevestiging Klant', body: 'Kunnen jullie iets eerder komen?\nTelefoon: +31644332211', externalId: 'chat-auto-1',
}, true);
const bevChat = ((await api('GET', '/api/chats')).json || []).find((c) => (c.phone || '').includes('644332211'));
ok('klantvraag telt als ongelezen', (bevChat?.unread || 0) >= 1, JSON.stringify(bevChat?.unread));
// Nieuwe afspraak zetten -> automatische bevestiging (outgoing thread-entry "Keyservice (afspraakbevestiging)").
await api('PATCH', `/api/orders/${bevKlant.json.id}`, { appointmentAt: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16) });
await new Promise((r) => setTimeout(r, 600));
const bevChat2 = ((await api('GET', '/api/chats')).json || []).find((c) => (c.phone || '').includes('644332211'));
ok('na automatische bevestiging: vraag NOG STEEDS ongelezen', (bevChat2?.unread || 0) >= 1, JSON.stringify(bevChat2?.unread));

console.log('\n== Kanaalkeuze: e-mail wordt nooit stiekem WhatsApp ==');
// Zonder SMTP hoort de e-mailkeuze een nette uitleg te geven — nooit stil een appje sturen.
const mailPoging = await api('POST', `/api/chats/${gesprek.id}/send`, { text: 'Dit hoort per mail te gaan', kanaal: 'email' });
ok('kanaal e-mail zonder SMTP -> nette uitleg (geen stil WhatsApp-appje)', mailPoging.status === 503 && /SMTP|E-mail/i.test(mailPoging.json?.error || ''), JSON.stringify(mailPoging.json));
const wachtrijNaMail = (await api('GET', '/api/whatsapp/outbox-status?full=1')).json || [];
ok('de e-mailpoging staat NIET in de WhatsApp-wachtrij', !wachtrijNaMail.some((o) => /hoort per mail/i.test(o.text || '')));

console.log('\n== Rechten: monteur ziet alleen eigen klanten ==');
// Monteur mag sinds 15 aug in Berichten, maar UITSLUITEND met klanten van zijn eigen
// opdrachten — geen andermans gesprekken, geen onbekende nummers (lead-verkeer).
await api('POST', '/api/users', { name: 'Monteur Test', email: 'monteurtest@keyservice.nl', password: 'monteur123', role: 'monteur' });
const adminCookie = cookie;
cookie = '';
const ml = await api('POST', '/api/login', { email: 'monteurtest@keyservice.nl', password: 'monteur123' });
ok('monteur kan inloggen', ml.status === 200);
const mChats = await api('GET', '/api/chats');
ok('monteur: gesprekkenlijst bereikbaar', mChats.status === 200 && Array.isArray(mChats.json));
ok('monteur zonder gekoppelde klanten: lege lijst (niet andermans gesprekken)', (mChats.json || []).length === 0, JSON.stringify((mChats.json || []).map((c) => c.id)));
ok('monteur: versturen naar andermans klant geweigerd', (await api('POST', `/api/chats/${gesprek.id}/send`, { text: 'x' })).status === 403);
ok('monteur: onbekende nummers (tel:) blijven verborgen', !(mChats.json || []).some((c) => String(c.id).startsWith('tel:')));
cookie = adminCookie;
// Monteur MÉT gekoppelde klant: meelezen mag, zelf typen niet (16 aug, besluit
// eigenaar — klantcommunicatie in eigen woorden blijft bij kantoor; de monteur
// verstuurt alleen via de vaste kaart-knoppen).
await api('POST', '/api/users', { name: 'Monteur Gekoppeld', email: 'monteur2@keyservice.nl', password: 'monteur123', role: 'monteur', monteurId: mont.json.id });
// De kaart stond eerder in de test op afgerond — voor de monteur telt alleen een
// LOPENDE opdracht, dus eerst weer openzetten.
await api('PATCH', `/api/orders/${gesprek.orderId}`, { monteurId: mont.json.id, status: 'nieuw' });
cookie = '';
await api('POST', '/api/login', { email: 'monteur2@keyservice.nl', password: 'monteur123' });
const m2Chats = await api('GET', '/api/chats');
ok('gekoppelde monteur ZIET het gesprek van zijn lopende klus', (m2Chats.json || []).some((c) => c.id === gesprek.id), JSON.stringify((m2Chats.json || []).map((c) => c.id)));
const m2Stuur = await api('POST', `/api/chats/${gesprek.id}/send`, { text: 'eigen tekstje' });
ok('gekoppelde monteur mag NIET zelf typen (vaste knoppen wél)', m2Stuur.status === 403 && /knoppen|kaart/i.test(m2Stuur.json?.error || ''), JSON.stringify(m2Stuur.json));
cookie = adminCookie;
// Klus afgerond -> het gesprek blijft nog 14 DAGEN zichtbaar (punt 5, 18 aug: bij het
// factureren wil hij nog teruglezen wat er is afgesproken); oude klussen van maanden
// terug blijven wél buiten beeld (monteurChatKlanten kijkt naar updatedAt).
await api('PATCH', `/api/orders/${gesprek.orderId}`, { status: 'afgerond' });
cookie = '';
await api('POST', '/api/login', { email: 'monteur2@keyservice.nl', password: 'monteur123' });
const m2Chats2 = await api('GET', '/api/chats');
ok('na afronden: gesprek blijft 14 dagen zichtbaar (net afgerond = zichtbaar)', (m2Chats2.json || []).some((c) => c.id === gesprek.id), JSON.stringify((m2Chats2.json || []).map((c) => c.id)));
// Klantgegevens (17 aug): monteur mag contactgegevens van ZIJN klant bijwerken
// (e-mail toevoegen om een factuur te sturen) — andermans klanten niet.
const m2Patch = await api('PATCH', `/api/customers/${gesprek.id}`, { email: 'chatklant@example.nl' });
ok('monteur mag e-mail van eigen klant toevoegen', m2Patch.status === 200 && m2Patch.json?.email === 'chatklant@example.nl', JSON.stringify(m2Patch.json));
const m2PatchVreemd = await api('PATCH', `/api/customers/${znId}`, { email: 'hack@example.nl' });
ok('monteur mag andermans klant NIET bewerken', m2PatchVreemd.status === 403, JSON.stringify(m2PatchVreemd.json));
cookie = adminCookie;

console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);

// Verplicht testplan uit de masterprompt: 10 scenario's + opdracht 1 (multipart) +
// opdracht 2 (site+mail-dedup). Draait tegen een lokale server met verse test-DB.
const BASE = 'http://localhost:3113';
const TOKEN = 'test123';
const RAF_ID = '120363177872957422';
const RAF_NAME = 'Raf breda en vliegende keer Rhenen straal 30 KM';

let cookie = '';
let passed = 0, failed = 0;
const bad = [];
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
  let json = null;
  try { json = await r.json(); } catch { /* leeg */ }
  return { status: r.status, json };
}
const orders = async () => (await api('GET', '/api/orders')).json || [];
const customers = async () => (await api('GET', '/api/customers')).json || [];
const outboxQ = async () => (await api('GET', '/api/outbox', null, true)).json || [];
// De HELE wachtrij (beheerdersweergave). /api/outbox toont sinds de snelheidsrem maar
// een paar berichten per ronde aan de bridge; voor het inspecteren van wat er klaarstaat
// is dat geen eerlijk beeld meer.
const outboxAll = async () => (await api('GET', '/api/whatsapp/outbox-status?full=1')).json || [];

// ---------- Setup ----------
console.log('\n== Setup ==');
const login = await api('POST', '/api/login', { email: 'admin@keyservice.nl', password: 'admin123' });
ok('inloggen', login.status === 200);
await api('PATCH', '/api/settings', {
  whatsappOrderGroups: 'raf breda, tilburg',
  crmAlerts: { enabled: true, group: 'CRM meldingen', phone: '', notifyReplies: true },
  // Wetten-scenario's draaien met het zelfde-moment-venster UIT (0), zodat de
  // basisregel (nieuwe kaart + suggestie) getest blijft. Het venster zelf heeft
  // verderop zijn eigen scenario's.
  autoMergeWindowHours: 0,
});
const mont = await api('POST', '/api/monteurs', { name: 'Youssef', phone: '0687654321', waGroup: 'Youssef Keyservice247' });
const MID = mont.json.id;
await api('PATCH', '/api/settings', {
  monteurDispatch: { autoEnabled: true, days: [0, 1, 2, 3, 4, 5, 6], autoMonteurId: MID, trigger: 'intake', onlyDrs: true },
});
const baselineCust = (await customers()).length;

// ---------- Scenario 1: nieuwe klant in DRS-groep, complete gegevens ----------
console.log('\n== 1. Nieuwe klant appt in DRS-groep met complete gegevens ==');
const s1 = await api('POST', '/api/ingest/whatsapp', {
  group: `groep ${RAF_ID}`, name: 'Karin Smit',
  body: 'Karin Smit, Dorpsstraat 12, 3911 AB Rhenen, 0611111111, cilinderslot voordeur kapot, graag vandaag',
  externalId: 'sc1',
}, true);
ok('volautomatisch goedgekeurd (auto_approved)', s1.json?.status === 'auto_approved', JSON.stringify(s1.json));
let os = await orders();
const o1 = os.find((o) => o.originGroup === RAF_NAME && (o.customer?.phone || '').includes('0611111111'));
ok('nieuwe kaart aangemaakt met juiste herkomst', !!o1, JSON.stringify(os.map((o) => o.title)));
ok('nieuwe klant aangemaakt', (await customers()).some((c) => (c.phone || '').includes('0611111111')));
ok('kaart draagt intake-gegevens van deze aanvraag', o1 && o1.intake && (o1.intake.phone || '').includes('0611111111'), o1 && JSON.stringify(o1.intake));
ok('automatisch naar monteur in wachtrij', (await outboxQ()).some((x) => x.orderId === o1?.id));

// ---------- Scenario 3: zelfde tekst doorgestuurd naar monteursgroep binnen 24u ----------
console.log('\n== 3. Identieke tekst doorgestuurd (monteursgroep) -> inhoud-dedup ==');
const s3 = await api('POST', '/api/ingest/whatsapp', {
  group: 'Youssef Keyservice247', name: 'Abdel',
  body: 'Karin Smit, Dorpsstraat 12, 3911 AB Rhenen, 0611111111, cilinderslot voordeur kapot, graag vandaag',
  externalId: 'sc3',
}, true);
ok('géén tweede kaart (duplicate)', s3.json?.duplicate === true, JSON.stringify(s3.json));
ok('kaarten-aantal ongewijzigd', (await orders()).length === os.length);

// ---------- Scenario 2 + 4: zelfde klant, nieuwe (bijna-zelfde maar niet identieke) aanvraag ----------
console.log('\n== 2+4. Bestaande klant, nieuwe aanvraag -> NIEUWE kaart + samenvoeg-suggestie ==');
const before24 = (await orders()).length;
const s2 = await api('POST', '/api/ingest/whatsapp', {
  group: `groep ${RAF_ID}`, name: 'Karin Smit',
  body: 'Karin Smit, Dorpsstraat 12, 3911 AB Rhenen, 0611111111, nu ook achterdeur slot vervangen graag',
  externalId: 'sc2',
}, true);
ok('nieuwe aanvraag volautomatisch goedgekeurd', s2.json?.status === 'auto_approved', JSON.stringify(s2.json));
os = await orders();
ok('NIEUWE kaart aangemaakt (geen automatische merge)', os.length === before24 + 1, `${before24} -> ${os.length}`);
const o2 = os.find((o) => /achterdeur/i.test(`${o.title} ${o.description}`));
ok('zelfde klant op beide kaarten', o2 && o1 && o2.customerId === o1.customerId);
ok('samenvoeg-SUGGESTIE aanwezig (mens beslist)', o2 && o2.mergeSuggestion && o2.mergeSuggestion.orderId === o1.id, o2 && JSON.stringify(o2.mergeSuggestion));
ok('klantenbestand: nog steeds één Karin', (await customers()).filter((c) => (c.phone || '').includes('0611111111')).length === 1);

// ---------- Scenario 7: bekende klant, ander adres ----------
console.log('\n== 7. Bekende klant met ANDER adres -> suggestie, record ongewijzigd, kaart met nieuw adres ==');
const s7 = await api('POST', '/api/ingest/whatsapp', {
  group: `groep ${RAF_ID}`, name: 'Karin Smit',
  body: 'Karin Smit, Nieuwe Laan 99, 6811 CD Arnhem, 0611111111, buitengesloten bij vakantiehuis',
  externalId: 'sc7',
}, true);
ok('goedgekeurd', s7.json?.status === 'auto_approved');
os = await orders();
const o7 = os.find((o) => /vakantiehuis|buitengesloten/i.test(`${o.title} ${o.description}`));
ok('kaart-intake heeft het NIEUWE adres', o7 && /nieuwe laan|arnhem/i.test(o7.intake?.address || ''), o7 && JSON.stringify(o7.intake));
ok('suggestie "adres wijkt af" op de kaart', o7 && (o7.dataSuggestions || []).some((s) => s.field === 'adres'), o7 && JSON.stringify(o7.dataSuggestions));
const karin = (await customers()).find((c) => (c.phone || '').includes('0611111111'));
ok('klantrecord-adres ONGEWIJZIGD (Rhenen)', /rhenen/i.test(karin?.address || ''), karin?.address);
const dispatch7 = (await outboxAll()).find((x) => x.orderId === o7?.id);
ok('monteur-bericht gebruikt het AANVRAAG-adres (Arnhem)', dispatch7 && /arnhem/i.test(dispatch7.text), dispatch7 && dispatch7.text.slice(0, 120));
// Suggestie toepassen via de kaart-knop -> record wél bijgewerkt (bewust, gelogd)
await api('POST', `/api/orders/${o7.id}/data-suggestion`, { field: 'adres', action: 'apply' });
const karin2 = (await customers()).find((c) => (c.phone || '').includes('0611111111'));
ok('na klik "Bijwerken": klantrecord nu wél bijgewerkt', /arnhem/i.test(karin2?.address || ''), karin2?.address);

// ---------- Scenario 5: geen echte klantnaam -> Klant onbekend ----------
console.log('\n== 5. AI vindt geen klantnaam -> "Klant onbekend", nooit klant "Key Service" ==');
const s5 = await api('POST', '/api/ingest/whatsapp', {
  group: `groep ${RAF_ID}`, name: 'Key Service',
  body: 'Spoedje: Marktweg 4, 5011 AB Tilburg, 0622222222, slot dicht na inbraak',
  externalId: 'sc5',
}, true);
ok('goedgekeurd', s5.json?.status === 'auto_approved');
os = await orders();
const o5 = os.find((o) => (o.intake?.phone || '').includes('0622222222'));
ok('kaart gemarkeerd "Klant onbekend — aanvullen"', o5 && o5.customerIncomplete === true, o5 && JSON.stringify({ ci: o5.customerIncomplete }));
ok('klantrecord heet "Onbekende klant"', o5 && o5.customer?.name === 'Onbekende klant', o5 && o5.customer?.name);
ok('GEEN klant "Key Service" aangemaakt', !(await customers()).some((c) => /^key\s?service$/i.test(c.name || '')));

// ---------- Scenario 6: twee verschillende klanten via dezelfde DRS-afzender ----------
console.log('\n== 6. Twee klanten via dezelfde afzender -> twee klanten, twee kaarten ==');
const custBefore6 = (await customers()).length;
await api('POST', '/api/ingest/whatsapp', {
  group: `groep ${RAF_ID}`, name: 'Raf DRS',
  body: 'Klant A: Bergweg 1, 1211 AB Hilversum, 0633333333, slot vervangen', externalId: 'sc6a',
}, true);
await api('POST', '/api/ingest/whatsapp', {
  group: `groep ${RAF_ID}`, name: 'Raf DRS',
  body: 'Klant B: Zeeweg 8, 2011 CD Haarlem, 0644444444, deur opengaan lukt niet', externalId: 'sc6b',
}, true);
const custAfter6 = await customers();
ok('twee NIEUWE klantrecords (niet samengevoegd op afzendernaam)', custAfter6.length === custBefore6 + 2, `${custBefore6} -> ${custAfter6.length}`);
os = await orders();
const o6a = os.find((o) => (o.intake?.phone || '').includes('0633333333'));
const o6b = os.find((o) => (o.intake?.phone || '').includes('0644444444'));
ok('twee losse kaarten met elk hun eigen klant', o6a && o6b && o6a.customerId !== o6b.customerId);

// ---------- Scenario 8: orderbevestiging/factuur-mail -> stil naar Overige ----------
console.log('\n== 8. Orderbevestiging op info@ -> geen lead, geen melding ==');
const outboxBefore8 = (await outboxQ()).length;
const custBefore8 = (await customers()).length;
const s8 = await api('POST', '/api/ingest/email', {
  from: 'no-reply@webshop-sloten.nl',
  subject: 'Orderbevestiging #45821 — uw bestelling is verzonden',
  body: 'Bedankt voor uw bestelling! Bezorgadres: Keyservice, Rhenen. Track & trace: XYZ. Totaal: 149,95. Tel: 0612121212',
  externalId: 'sc8',
}, true);
ok('naar Overige (geen pending lead)', s8.json?.status === 'overige', JSON.stringify(s8.json));
ok('geen team-melding in wachtrij', (await outboxQ()).length === outboxBefore8);
ok('geen klant aangemaakt uit leveranciersmail', (await customers()).length === custBefore8);

// ---------- Scenario 9: websiteformulier -> wél lead ----------
console.log('\n== 9. Websiteformulier -> wel lead (ongewijzigd) ==');
const s9 = await api('POST', '/api/ingest/form?token=' + TOKEN, {
  name: 'Nora Visser', phone: '0655555555', email: 'nora@example.nl',
  city: 'Breda', postcode: '4811 AB', address: 'Kerkstraat 8',
  message: 'Schuifpui klemt, graag offerte', formType: 'offerte', site: 'schuifpuiservice.com',
});
ok('website-lead -> Te controleren (pending)', s9.json?.status === 'pending', JSON.stringify(s9.json));
ok('NIET automatisch een kaart (mens keurt)', !(await orders()).some((o) => (o.intake?.phone || '').includes('0655555555')));

// ---------- Scenario 10: los 1-op-1 appje ----------
console.log('\n== 10. Los 1-op-1 appje -> Te controleren, geen kaart/klant ==');
const custBefore10 = (await customers()).length;
const ordersBefore10 = (await orders()).length;
const s10 = await api('POST', '/api/ingest/whatsapp', {
  name: 'Willem', body: 'hoi, kunnen jullie langskomen?\nTelefoon: +31677777777', externalId: 'sc10',
}, true);
ok('naar Te controleren (pending)', s10.json?.status === 'pending', JSON.stringify(s10.json));
ok('geen kaart aangemaakt', (await orders()).length === ordersBefore10);
ok('geen klant aangemaakt (pas na menselijke goedkeuring)', (await customers()).length === custBefore10);

// ---------- Reactie-verkeer: klant met open kaart appt 1-op-1 -> aan de kaart ----------
console.log('\n== Extra: 1-op-1 reactie van klant mét open kaart blijft aan de kaart hangen ==');
const s11 = await api('POST', '/api/ingest/whatsapp', {
  name: 'Karin Smit', body: 'is morgen 10:00 ook goed?\nTelefoon: +31611111111', externalId: 'sc11',
}, true);
ok('reactie samengevoegd met lopende kaart (chat blijft werken)', !!s11.json && !s11.json.reviewId, JSON.stringify(s11.json));
os = await orders();
const oK = os.filter((o) => o.customerId === o1.customerId).find((o) => o.customerReplied);
ok('kaart toont "Nieuw bericht" van klant', !!oK);

// ---------- Opdracht 1: multipart met bijlage ----------
console.log('\n== O1. Multipart-formulier met bijlages ==');
const png1 = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000000000000', 'hex');
const png2 = Buffer.from('89504e470d0a1a0a0000000d4948445200000002000000020806000000aabbccdd', 'hex');
const fd = new FormData();
fd.append('name', 'Foto Klant');
fd.append('phone', '0666666666');
fd.append('email', 'foto@example.nl');
fd.append('city', 'Utrecht');
fd.append('message', 'Zie foto van de kapotte pui');
fd.append('formType', 'offerte');
fd.append('site', 'schuifpuireparatie-utrecht.nl');
fd.append('bijlage', new Blob([png1], { type: 'image/png' }), 'pui.png');
fd.append('bijlage', new Blob([png2], { type: 'image/jpeg' }), 'pui2.jpg');
const r1 = await fetch(`${BASE}/api/ingest/form?token=${TOKEN}`, { method: 'POST', body: fd });
const j1 = await r1.json();
ok('multipart geaccepteerd', r1.status === 200 && j1.ok, JSON.stringify(j1));
ok('2 bijlages opgeslagen', j1.bijlagen?.opgeslagen === 2, JSON.stringify(j1.bijlagen));
const revs = await api('GET', '/api/reviews?limit=50');
const revO1 = (revs.json.items || []).find((r) => r.message && /foto@example\.nl/i.test(r.message.body || ''));
ok('lead in Te controleren mét bijlages op het bericht', revO1 && (revO1.message.attachments || []).length === 2, revO1 && JSON.stringify((revO1.message.attachments || []).length));
ok('bron gemarkeerd als website-direct', revO1 && revO1.message.mailbox === 'website-direct', revO1 && revO1.message.mailbox);

// Verkeerd type + te groot: lead blijft, bijlage netjes geweigerd
const fd2 = new FormData();
fd2.append('name', 'Pdf Test');
fd2.append('phone', '0666666667');
fd2.append('message', 'verkeerd bestand test');
fd2.append('bijlage', new Blob(['gewoon tekst'], { type: 'text/plain' }), 'notitie.txt');
fd2.append('bijlage', new Blob([Buffer.alloc(11 * 1024 * 1024)], { type: 'image/jpeg' }), 'groot.jpg');
const r2 = await fetch(`${BASE}/api/ingest/form?token=${TOKEN}`, { method: 'POST', body: fd2 });
const j2 = await r2.json();
ok('lead zelf gaat DOOR ondanks bijlage-fouten', r2.status === 200 && j2.ok && j2.reviewId, JSON.stringify(j2));
ok('txt geweigerd (type) én jpg geweigerd (te groot)', (j2.bijlagen?.geweigerd || []).length === 2 && j2.bijlagen?.opgeslagen === 0, JSON.stringify(j2.bijlagen));
const pre = await fetch(`${BASE}/api/ingest/form`, { method: 'OPTIONS' });
ok('OPTIONS-preflight antwoordt 204', pre.status === 204);

// ---------- Opdracht 2: site+mail-dedup binnen 15 min ----------
console.log('\n== O2. Zelfde aanvraag via site én (FormSubmit-)mail -> één lead ==');
const revCountBefore = ((await api('GET', '/api/reviews?limit=60')).json.items || []).length;
const sMail = await api('POST', '/api/ingest/email', {
  from: 'FormSubmit <noreply@formsubmit.co>',
  subject: 'Offerte-aanvraag schuifpui (schuifpuiservice.com)',
  body: 'Nieuwe aanvraag via de website schuifpuiservice.com (FormSubmit-mail).\nNaam: Nora Visser\nTelefoon: 0655555555\nE-mail: nora@example.nl\nAdres: Breda\n\nSchuifpui klemt, graag offerte',
  externalId: 'sc-o2',
}, true);
ok('FormSubmit-mail herkend als duplicaat van de site-lead', sMail.json?.duplicate === true, JSON.stringify(sMail.json));
const revs2 = await api('GET', '/api/reviews?limit=60');
ok('geen tweede lead in Te controleren', (revs2.json.items || []).length === revCountBefore);

// ---------- E-mail-reactie: antwoord in bestaande wisseling -> gesprekshistorie ----------
console.log('\n== Extra: e-mailreactie van klant -> in de kaart, GEEN nieuwe kaart/inbox-item ==');
// Nora's website-lead goedkeuren zodat ze een open kaart heeft.
const revsN = await api('GET', '/api/reviews?limit=60');
const revN = (revsN.json.items || []).find((r) => r.message && /0655555555/.test(r.message.body || ''));
const apprN = await api('POST', `/api/reviews/${revN.id}/approve`, {});
ok('website-lead goedgekeurd -> kaart', apprN.status === 200 && apprN.json.order?.id);
const revCountBeforeR = ((await api('GET', '/api/reviews?limit=80')).json.items || []).length;
const ordersBeforeR = (await orders()).length;
// Klant antwoordt in de mailwisseling — mét geciteerde klantgegevens (postcode+tel).
const sR = await api('POST', '/api/ingest/email', {
  from: 'Nora Visser <nora@example.nl>',
  subject: 'Re: Offerteaanvraag via schuifpuiservice.com',
  inReplyTo: '<abc123@keyservice247.nl>',
  body: 'Ja graag, kom maar langs!\n\n> Op 18 jul schreef Keyservice:\n> Klant: Nora Visser, Kerkstraat 8, 4811 AB Breda, 0655555555\n> Schuifpui klemt, graag offerte',
  externalId: 'sc-reply1',
}, true);
ok('reactie -> samengevoegd met kaart (geen nieuw inbox-item)', sR.json && !sR.json.reviewId, JSON.stringify(sR.json));
ok('geen nieuwe kaart aangemaakt', (await orders()).length === ordersBeforeR);
ok('geen nieuw item in Te controleren', ((await api('GET', '/api/reviews?limit=80')).json.items || []).length === revCountBeforeR);
const oN = (await orders()).find((o) => o.id === apprN.json.order.id);
ok('kaart toont Nieuw bericht + reactie in historie', oN && oN.customerReplied === true);
// Tegenproef: een Fwd: MET klantgegevens is wél een (mogelijke) nieuwe aanvraag.
const sF = await api('POST', '/api/ingest/email', {
  from: 'Abdel <abdel@keyservice247.nl>',
  subject: 'Fwd: nieuwe klus',
  body: 'Doorgestuurd: Klant Peters, Molenweg 3, 7311 AB Apeldoorn, 0688888888, slot klemt',
  externalId: 'sc-fwd1',
}, true);
ok('Fwd met klantgegevens -> wél Te controleren (nieuwe aanvraag)', sF.json?.status === 'pending', JSON.stringify(sF.json));

// ---------- Karin-casus (25 jul): tikfout-nummer in de tekst mag matching nooit breken ----------
// De klant zet ZELF een (fout) nummer onder haar bericht; de bridge plakt het échte
// afzendernummer als laatste regel. Het échte nummer moet winnen: het bericht hoort
// in de kaart-thread van de bestaande klant — nooit een los inbox-item of duplicaat-
// klant met een fantasienummer.
console.log('\n== Karin-casus: écht afzendernummer wint van tikfout-nummer in de tekst ==');
const custBeforeKC = (await customers()).length;
const sKC = await api('POST', '/api/ingest/whatsapp', {
  name: 'Karin van Kemenade',
  body: 'Beste Keyservice, ik ben onverwachts eerder op vakantie. De afspraak kan geannuleerd worden.\nKarin van Kemenade\nTelefoon: +278520207007866\nTelefoon: +31611111111',
  externalId: 'kc1',
}, true);
ok('annulering hangt aan de bestaande kaart (geen los inbox-item)', !!sKC.json && !sKC.json.reviewId, JSON.stringify(sKC.json));
ok('geen duplicaat-klant met fantasienummer aangemaakt', (await customers()).length === custBeforeKC && !(await customers()).some((c) => (c.phone || '').includes('278520207007866')));
const oKC = (await orders()).filter((o) => o.customerId === o1.customerId).find((o) => (o.thread || []).some((t) => /vakantie/i.test(t.body || '')));
ok('annulering zichtbaar in de gesprekshistorie van de klantkaart', !!oKC);

// ---------- Zelfde-moment-venster: tweede aanvraag hangt automatisch aan de kaart ----------
console.log('\n== Zelfde-moment-venster: aanvragen kort na elkaar -> één kaart ==');
await api('PATCH', '/api/settings', { autoMergeWindowHours: 6 });
const sW1 = await api('POST', '/api/ingest/whatsapp', {
  group: `groep ${RAF_ID}`, name: 'Vera Venster',
  body: 'Vera Venster, Marktplein 3, 3901 AB Veenendaal, 0633334444, voordeurslot dicht, spoed',
  externalId: 'w1',
}, true);
ok('eerste aanvraag -> kaart', sW1.json?.status === 'auto_approved');
const ordersBeforeW2 = (await orders()).length;
const sW2 = await api('POST', '/api/ingest/whatsapp', {
  group: `groep ${RAF_ID}`, name: 'Vera Venster',
  body: 'Vera Venster, Marktplein 3, 3901 AB Veenendaal, 0633334444, oja en graag ook een reservesleutel meenemen',
  externalId: 'w2',
}, true);
ok('tweede aanvraag binnen venster -> GEEN nieuwe kaart', (await orders()).length === ordersBeforeW2, `${ordersBeforeW2} -> ${(await orders()).length}`);
const oW = (await orders()).find((o) => (o.intake?.phone || '').includes('0633334444'));
ok('tweede bericht in de thread + systeemnotitie samenvoegen', oW && (oW.thread || []).some((t) => /reservesleutel/i.test(t.body || '')) && (oW.thread || []).some((t) => /automatisch aan deze kaart/i.test(t.body || '')));
const obW = (await outboxAll()).filter((x) => x.orderId === oW?.id);
ok('geen dubbele volledige dispatch, wél aanvulling naar de monteur', obW.filter((x) => x.by !== 'samenvoegen-aanvulling').length === 1 && obW.some((x) => x.by === 'samenvoegen-aanvulling'), JSON.stringify(obW.map((x) => x.by)));
ok('kaart kreeg "Nieuw bericht"-badge bij samenvoegen (nooit stil)', oW && oW.customerReplied === true && (oW.unreadReplies || 0) >= 1);
// Ander adres binnen het venster -> tóch een nieuwe kaart (andere klus, Regel 1).
const ordersBeforeW3 = (await orders()).length;
await api('POST', '/api/ingest/whatsapp', {
  group: `groep ${RAF_ID}`, name: 'Vera Venster',
  body: 'Vera Venster, Havenkade 55, 8011 AB Zwolle, 0633334444, schuifpui vakantiehuis klemt',
  externalId: 'w3',
}, true);
ok('zelfde klant, ANDER adres -> wél nieuwe kaart (andere klus)', (await orders()).length === ordersBeforeW3 + 1, `${ordersBeforeW3} -> ${(await orders()).length}`);
await api('PATCH', '/api/settings', { autoMergeWindowHours: 0 }); // terug voor de rest

// ---------- Website-lead boven drempel -> automatisch kaart (verfijning 27 jul) ----------
console.log('\n== Website-lead boven drempel -> automatisch kaart + tweede formulier dedupt ==');
await api('PATCH', '/api/settings', { aiAutoApproveThreshold: 0.65, autoMergeWindowHours: 6 });
const sJG = await api('POST', '/api/ingest/form?token=' + TOKEN, {
  name: 'Johan Goslinga', phone: '0646471096', email: 'jagoslinga@home.nl',
  address: 'Dorpsweg 8', postcode: '9798 PB', city: 'Garmerwolde',
  message: 'Houten schuifpui loopt zwaar en gaat slecht op slot; loopwielen en sluitmechanisme vervangen',
  formType: 'offerte', site: 'schuifpuiservice.com',
});
ok('website-lead boven drempel -> automatisch goedgekeurd', sJG.json?.status === 'auto_approved', JSON.stringify(sJG.json));
const oJG = (await orders()).find((o) => (o.intake?.phone || '').includes('0646471096'));
ok('kaart automatisch aangemaakt (niet blijven hangen in inbox)', !!oJG);
const ordersBeforeJG2 = (await orders()).length;
const sJG2 = await api('POST', '/api/ingest/email', {
  from: '"FormSubmit" <submissions@formsubmit.co>',
  subject: 'Offerte-aanvraag schuifpui (schuifpuiservice.com)',
  body: 'Nieuwe aanvraag via de website schuifpuiservice.com (FormSubmit-mail).\nNaam: Johan Goslinga\nTelefoon: 0646471096\nE-mail: jagoslinga@home.nl\nWoonplaats: Garmerwolde\nBericht: schuifpui loopt zwaar',
  externalId: 'jg2',
}, true);
ok('tweede formulier (mail-route) zelfde klant -> duplicaat, geen tweede kaart', !!sJG2.json?.duplicate && (await orders()).length === ordersBeforeJG2, JSON.stringify(sJG2.json));
await api('PATCH', '/api/settings', { aiAutoApproveThreshold: 0, autoMergeWindowHours: 0 });

// ---------- Vangrails identiteit: LID-onzin + e-mail-exact + monteur-afscherming ----------
console.log('\n== Vangrails: LID-nummer, e-mail-exact, monteur-afscherming ==');
// (a) Een WhatsApp-LID (18 cijfers, bridge-storing) mag nooit een klantnummer worden.
const sLid = await api('POST', '/api/ingest/whatsapp', {
  from: '123456789012345678@lid', name: 'Storing Klant',
  body: 'slot kapot, kunnen jullie komen? Dorpsweg 2, 3911 AB Rhenen', externalId: 'lid1',
}, true);
if (sLid.json?.reviewId) await api('POST', `/api/reviews/${sLid.json.reviewId}/approve`, {});
ok('LID-onzin (18 cijfers) nooit als klantnummer opgeslagen', !(await customers()).some((c) => String(c.phone || '').replace(/\D/g, '').length > 13));
// (b) Klanthistorie matcht e-mail EXACT: jan@ krijgt nooit de post van marjan@.
const custJan = await api('POST', '/api/customers', { name: 'Jan Janssen', email: 'jan@example.com' });
await api('POST', '/api/ingest/email', { from: 'Marjan Bakker <marjan@example.com>', subject: 'Vertrouwelijk', body: 'Prive-bericht van Marjan over haar reservesleutel', externalId: 'mj1' }, true);
const histJan = await api('GET', `/api/customers/${custJan.json.id}/history`);
ok('historie van Jan bevat NIETS van marjan@ (exacte match)', histJan.status === 200 && !(histJan.json.items || []).some((x) => /Marjan/i.test(x.sender || '')), JSON.stringify((histJan.json.items || []).map((x) => x.sender)));
// (c) Monteur-account ZONDER gekoppeld monteur-record mag geen klanthistorie lezen.
await api('POST', '/api/users', { name: 'Losse Monteur', email: 'los@keyservice.nl', password: 'test12345', role: 'monteur' });
const rLogin = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'los@keyservice.nl', password: 'test12345' }) });
const monCookie = (rLogin.headers.get('set-cookie') || '').split(';')[0];
const rHist = await fetch(`${BASE}/api/customers/${custJan.json.id}/history`, { headers: { cookie: monCookie } });
ok('monteur zonder koppeling krijgt 403 op klanthistorie', rHist.status === 403, `status=${rHist.status}`);

// ---------- Klant-hint op inbox-items + klanthistorie-endpoint ----------
console.log('\n== Klant-hint op inbox-items + klanthistorie ==');
await api('POST', '/api/ingest/form?token=' + TOKEN, {
  name: 'Karin Smit', phone: '0611111111', message: 'Nieuwe klus: garagedeurslot vervangen graag', formType: 'contact', site: 'keyservice247.nl',
});
const revsH = (await api('GET', '/api/reviews?status=pending&limit=80')).json.items || [];
const hinted = revsH.find((r) => r.knownCustomer && (r.knownCustomer.name || '').includes('Karin'));
ok('inbox-item toont bekende klant + open kaart', !!hinted && !!hinted.knownCustomer.openOrderId, JSON.stringify(revsH.map((r) => r.knownCustomer && r.knownCustomer.name)));
const custKarin = (await customers()).find((c) => (c.phone || '').includes('0611111111'));
const hist = await api('GET', `/api/customers/${custKarin.id}/history`);
ok('klanthistorie: meerdere berichten over kaarten heen', hist.status === 200 && (hist.json.items || []).length >= 3, `items=${(hist.json.items || []).length}`);
ok('klanthistorie: chronologisch + kaart-labels', (hist.json.items || []).every((x, i, a) => i === 0 || String(a[i - 1].at || '').localeCompare(String(x.at || '')) <= 0) && (hist.json.items || []).some((x) => x.orderTitle));

// ---------- Extra: monteur-"ok" alleen relayen als het over de opdracht gaat ----------
// Een kort "ok" in de monteursgroep vlak na een doorgestuurde opdracht -> bevestiging
// naar de opdrachtgroep (bestaand gedrag). Maar zat er ANDER verkeer tussen (bv. een
// dagrapport), dan sloeg het "ok" dáárop en mag er GEEN "wordt opgepakt" uitgaan.
console.log('\n== Extra: monteur-"ok" alleen bevestigen als het over de opdracht gaat ==');
const pauze = () => new Promise((r) => setTimeout(r, 30));
await api('POST', '/api/ingest/whatsapp', {
  group: `groep ${RAF_ID}`, name: 'Pier Post',
  body: 'Pier Post, Kerkweg 8, 3911 CC Rhenen, 0644444455, slot achterdeur klemt, graag langskomen',
  externalId: 'ack1',
}, true);
await pauze();
await api('POST', '/api/ingest/whatsapp', { group: 'Youssef Keyservice247', name: 'Youssef', body: 'Ok', externalId: 'ack2' }, true);
const ackCount1 = (await outboxAll()).filter((x) => x.by === 'monteur-bevestiging').length;
ok('direct "ok" van de monteur -> bevestiging naar de opdrachtgroep', ackCount1 === 1, `count=${ackCount1}`);
await api('POST', '/api/ingest/whatsapp', {
  group: `groep ${RAF_ID}`, name: 'Sanne Vos',
  body: 'Sanne Vos, Bergweg 21, 3912 AD Rhenen, 0655554444, cilinder bijmaken sleutel kwijt',
  externalId: 'ack3',
}, true);
await pauze();
await api('POST', '/api/ingest/whatsapp', {
  group: 'Youssef Keyservice247', name: 'Youssef',
  body: 'Donderdag 23-07\nAfgerond\n3262DJ oud Beijerland €665,49 pin (€135 kosten)\nAnulering stuur ik morgen beter',
  externalId: 'ack4',
}, true);
await pauze();
await api('POST', '/api/ingest/whatsapp', { group: 'Youssef Keyservice247', name: 'Abdel', body: 'Oke', externalId: 'ack5' }, true);
const ackCount2 = (await outboxAll()).filter((x) => x.by === 'monteur-bevestiging').length;
ok('"oke" op een dagrapport -> GEEN onterechte bevestiging naar de opdrachtgroep', ackCount2 === ackCount1, `count=${ackCount2}`);

// ---------- Rustig scherm: huishoudelijke opslag mag geen verversing uitlokken ----------
// De WhatsApp-hartslag komt elke 60 seconden binnen. Bumpte die de wijzigingsteller,
// dan herlaadde elk geopend scherm zich de klok rond (klacht 29 jul: "het scherm
// refresht en mijn selectie is weg").
console.log('\n== Hartslag verandert niets zichtbaars -> geen schermverversing ==');
const pulse1 = (await api('GET', '/api/pulse')).json;
await api('POST', '/api/whatsapp/heartbeat', { state: 'CONNECTED', version: 2 }, true);
await new Promise((r) => setTimeout(r, 350));
const pulse2 = (await api('GET', '/api/pulse')).json;
ok('WhatsApp-hartslag hoogt de wijzigingsteller NIET op', pulse2.v === pulse1.v, `${pulse1.v} -> ${pulse2.v}`);
const nieuweKaart = await api('POST', '/api/orders', { title: 'Pulse-test kaart', customerName: 'Pulse Klant', customerPhone: '0612340000' });
const pulse3 = (await api('GET', '/api/pulse')).json;
ok('een ECHTE wijziging hoogt de teller wel op (scherm ververst nog steeds)', pulse3.v !== pulse2.v && nieuweKaart.status === 200, `${pulse2.v} -> ${pulse3.v}`);

// ---------- Audit-reparaties 1 aug ----------
console.log('\n== Ons EIGEN dagrapport in de DRS-groep is geen aanvraag ==');
await api('PATCH', '/api/settings', { whatsappOrderGroups: 'Raf Breda' });
const eigenRapport = 'Vrijdag 03-07\nAfgerond\n5056AC Berkel-Enschot 556 pin\nOfferte\n4631 TB Hoogerheide offerte afgegeven\nAfspraken\n5171AE Kaatsheuvel maandag';
const rRap = await api('POST', '/api/ingest/whatsapp', { group: 'Raf Breda', name: 'Abdel Rafour', body: eigenRapport, externalId: 'auditrap-1' }, true);
ok('eigen terugkoppeling wordt NOOIT een aanvraag', rRap.json.status === 'overige', JSON.stringify(rRap.json.status));
const echteAanvraag = 'Goedemiddag, ik ben buitengesloten. Kunt u komen?\nNaam: Els de Wit\nTelefoon: 0612345678\nAdres: Dorpsstraat 5, 4051 AB Ochten';
const rEcht = await api('POST', '/api/ingest/whatsapp', { group: 'Raf Breda', name: 'DRS', body: echteAanvraag, externalId: 'auditrap-2' }, true);
ok('een ECHTE aanvraag uit dezelfde groep komt gewoon door', ['pending', 'auto_approved'].includes(rEcht.json.status), JSON.stringify(rEcht.json.status));

console.log('\n== Antwoord op onze eigen factuurmail komt bij de kaart ==');
const cF = await api('POST', '/api/customers', { name: 'Factuur Reply Klant', email: 'freply@example.nl', phone: '0611220099' });
const oF = await api('POST', '/api/orders', { customerId: cF.json.id, title: 'Slot vervangen factuurreply' });
await api('POST', '/api/simulate', { channel: 'email', sender: 'Factuur Reply Klant <freply@example.nl>', subject: 'Re: Factuur 2026-0001 — Key Service 24/7', body: 'Ik heb de factuur betaald maar de deur klemt nog steeds.' });
const naF = (await api('GET', '/api/orders')).json.find((o) => o.id === oF.json.id);
ok('bericht met "Factuur" in het onderwerp verdwijnt niet meer in Overige', (naF.thread || []).length >= 1, `thread=${(naF.thread || []).length}`);
ok('de kaart krijgt de "nieuw bericht"-markering', (naF.unreadReplies || 0) >= 1);

console.log('\n== Reactie landt op de NIEUWSTE open kaart, niet de oudste ==');
const cN = await api('POST', '/api/customers', { name: 'Twee Kaarten Klant', phone: '0611330044' });
const oud = await api('POST', '/api/orders', { customerId: cN.json.id, title: 'Oude klus' });
await new Promise((r) => setTimeout(r, 20));
const nieuw = await api('POST', '/api/orders', { customerId: cN.json.id, title: 'Nieuwe klus' });
await api('POST', '/api/ingest/whatsapp', { name: 'Twee Kaarten Klant', body: 'Ja prima, morgen 10 uur is goed\nTelefoon: +31611330044', externalId: 'twee-1' }, true);
const alle = (await api('GET', '/api/orders')).json;
const oudNa = alle.find((o) => o.id === oud.json.id); const nieuwNa = alle.find((o) => o.id === nieuw.json.id);
ok('antwoord gaat naar de nieuwste kaart', (nieuwNa.thread || []).length > (oudNa.thread || []).length, `nieuw=${(nieuwNa.thread || []).length} oud=${(oudNa.thread || []).length}`);

// ---------- Plak-opdracht (DRS-noodroute) + pauzeknop ----------
console.log('\n== Plak-opdracht: DRS-bericht -> kaart met plaatsnaam-titel ==');
const drsBericht = 'Hallo Abdel Rafour. We sturen je de volgende klant. Graag z.s.m. contact opnemen.:\n\nDatum: 03 augustus 2026\nNaam: Daniel Winters\nAdres: De Tulp, 13\nWoonplaats: 4631 AJ - Hoogerheide\nTelefoon: 0682049908\nOpmerkingen: Slot voordeur eruit gekomen\nLocatie: https://www.google.nl/maps?q=51.42983,4.31723';
const pl = await api('POST', '/api/orders/paste', { text: drsBericht });
ok('geplakte DRS-opdracht wordt een kaart', pl.status === 200 && !!pl.json.id, JSON.stringify(pl.json.error || pl.json.title));
ok('titel begint met de PLAATSNAAM', /^Hoogerheide — /.test(pl.json.title || ''), pl.json.title);
ok('klantgegevens er goed uitgehaald', pl.json.customer?.name === 'Daniel Winters' && pl.json.customer?.phone === '0682049908');
ok('intake-adres compleet met postcode', /4631 AJ Hoogerheide/.test(pl.json.intake?.address || ''), pl.json.intake?.address);
const pl2 = await api('POST', '/api/orders/paste', { text: drsBericht });
const dubbelKlant = (await customers()).filter((k) => String(k.phone || '').includes('682049908'));
ok('tweede keer plakken maakt GEEN dubbele klant', pl2.status === 200 && dubbelKlant.length === 1, `klanten=${dubbelKlant.length}`);
const plLeeg = await api('POST', '/api/orders/paste', { text: 'hoi' });
ok('onzin plakken geeft een nette uitleg', plLeeg.status === 400 && /klantgegevens|hele bericht/i.test(plLeeg.json.error || ''));

console.log('\n== Pauzeknop: bridge krijgt een lege wachtrij ==');
await api('POST', '/api/orders/paste', { text: drsBericht }); // vult mogelijk de outbox via dispatch
const obVoor = await (await fetch(`${BASE}/api/outbox`, { headers: { 'x-ingest-token': TOKEN } })).json();
await api('PATCH', '/api/settings', { whatsappPaused: true });
const obPauze = await (await fetch(`${BASE}/api/outbox`, { headers: { 'x-ingest-token': TOKEN } })).json();
ok('tijdens pauze gaat er NIETS naar de bridge', Array.isArray(obPauze) && obPauze.length === 0, `items=${obPauze.length}`);
await api('PATCH', '/api/settings', { whatsappPaused: false });
const statusNa = (await api('GET', '/api/whatsapp/outbox-status')).json || [];
ok('na de pauze staat de wachtrij er nog (niets kwijt)',
  statusNa.some((o) => o.status === 'queued'), JSON.stringify(statusNa.map((o) => o.status)));

// ---------- Snelheidsrem (6 aug 2026) ----------
// Aanleiding: na de WhatsApp-storing stond de wachtrij dagen vol. Zodra de bridge
// terugkwam ging ALLES in enkele seconden de deur uit — tientallen berichten, met
// dubbelen ertussen. Dat is precies het patroon waarvoor WhatsApp een nummer blokkeert.
// Deze assertions bewaken dat de rem er nooit stilletjes uitloopt.
console.log('\n== Snelheidsrem: wachtrij mag nooit in één stortvloed leeglopen ==');
// Twee identieke berichten naar hetzelfde nummer + drie verschillende.
await api('POST', '/api/whatsapp/test', { phone: '0612000001', text: 'Zelfde bericht' });
await api('POST', '/api/whatsapp/test', { phone: '0612000001', text: 'Zelfde bericht' });
for (let i = 2; i <= 4; i++) await api('POST', '/api/whatsapp/test', { phone: `061200000${i}`, text: `Bericht ${i}` });
// Even wachten tot de rem (20s tussen rondes) een nieuwe ronde toestaat.
await new Promise((r) => setTimeout(r, 21000));
const ronde1 = await outboxQ();
ok('hooguit 2 berichten per ronde naar de bridge', ronde1.length <= 2, `kreeg ${ronde1.length}`);
const ronde2 = await outboxQ();
ok('direct daarna komt er niets bij (20 seconden ertussen)', ronde2.length === 0, `kreeg ${ronde2.length}`);
const naRem = (await api('GET', '/api/whatsapp/outbox-status')).json || [];
ok('identiek dubbel bericht wordt niet verstuurd',
  naRem.some((o) => String(o.lastResult || '').startsWith('dubbel')),
  JSON.stringify(naRem.slice(0, 6).map((o) => `${o.status}:${o.lastResult}`)));

// ---------- Samenvatting ----------
console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);

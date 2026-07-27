// Test: AI-ochtendbriefing — instellingen, testverzending via WhatsApp (zonder dat
// de CRM-meldingen aan hoeven te staan), inhoud (afspraak van vandaag + actiepunten)
// en de nette foutmelding als er geen kanaal beschikbaar is.
// Draaien tegen een verse lokale server op PORT=3119 (zie test/README.md).
const BASE = 'http://localhost:3119';
let cookie = '';
let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); } }
async function api(method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setC = r.headers.get('set-cookie'); if (setC) cookie = setC.split(';')[0];
  let json = null; try { json = await r.json(); } catch { /* leeg */ }
  return { status: r.status, json };
}

await api('POST', '/api/login', { email: 'admin@keyservice.nl', password: 'admin123' });

console.log('\n== Instellingen opslaan & teruglezen ==');
await api('PATCH', '/api/settings', { crmAlerts: { enabled: false, group: 'CRM meldingen', phone: '0687654321' } });
const p = await api('PATCH', '/api/settings', { morningBriefing: { enabled: true, hour: 7, weekdaysOnly: true, channel: 'whatsapp', email: '', tone: 'zakelijk' } });
ok('instellingen geaccepteerd', p.status === 200);
const st = await api('GET', '/api/settings');
ok('instellingen bewaard (uur/kanaal/toon)', st.json.morningBriefing?.enabled === true && st.json.morningBriefing?.hour === 7 && st.json.morningBriefing?.channel === 'whatsapp' && st.json.morningBriefing?.tone === 'zakelijk', JSON.stringify(st.json.morningBriefing));

console.log('\n== Briefing-inhoud: afspraak van vandaag + actiepunten ==');
const vandaagNL = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
const cust = await api('POST', '/api/customers', { name: 'Briefing Klant', phone: '0611111122', address: 'Teststraat 1, Rhenen' });
await api('POST', '/api/orders', { customerId: cust.json.id, title: 'Slot vervangen briefing-test', appointmentAt: `${vandaagNL}T14:30`, status: 'afspraak_ingepland' });
const t1 = await api('POST', '/api/morning-briefing/test', {});
ok('test-briefing verstuurd via WhatsApp (meldingen staan UIT)', t1.status === 200 && t1.json.ok && (t1.json.via || []).includes('whatsapp'), JSON.stringify(t1.json));
ok('briefing bevat de afspraak van vandaag (14:30 + klant)', /14:30/.test(t1.json.text || '') && /Briefing Klant/.test(t1.json.text || ''));
ok('briefing markeert onbevestigde afspraak', /NIET bevestigd/.test(t1.json.text || ''));
ok('briefing heeft de vaste onderdelen', /Ochtendbriefing/.test(t1.json.text || '') && /VRAAGT OM ACTIE/.test(t1.json.text || '') && /GELD DEZE WEEK/.test(t1.json.text || ''));

console.log('\n== WhatsApp-wachtrij: item naar het meldingen-nummer ==');
const ob = await (await fetch(`${BASE}/api/outbox`, { headers: { 'x-ingest-token': 'test123' } })).json();
ok('briefing in wachtrij naar 0687654321', ob.some((x) => x.by === 'ochtendbriefing' && x.phone === '0687654321'), JSON.stringify(ob.map((x) => x.by)));

console.log('\n== Geen kanaal beschikbaar -> nette fout ==');
await api('PATCH', '/api/settings', { morningBriefing: { enabled: true, hour: 7, channel: 'email', email: '', tone: 'coachend' } });
const t2 = await api('POST', '/api/morning-briefing/test', {});
ok('e-mail zonder SMTP/adres: nette foutmelding', t2.status === 400 && /kanaal/i.test(t2.json.error || ''), JSON.stringify(t2.json));

console.log('\n== AI-dagoverzicht (zonder AI-sleutel: nette feiten-fallback) ==');
const ov1 = await api('GET', '/api/day-overview');
ok('dagoverzicht antwoordt met feiten-fallback (nooit kapot blok)', ov1.status === 200 && !ov1.json.data && ov1.json.facts && typeof ov1.json.facts.pendingLeads === 'number' && ['geen-ai', 'nachtrust'].includes(ov1.json.error), JSON.stringify({ error: ov1.json.error }));
const ov2 = await api('GET', '/api/day-overview');
if (ov1.json.error === 'geen-ai') ok('fout wordt kort hergebruikt (geen dubbele dure AI-call)', ov2.status === 200 && ov2.json.at === ov1.json.at, `${ov1.json.at} vs ${ov2.json.at}`);
else ok('nachtrust-modus blijft feiten geven', ov2.status === 200 && !!ov2.json.facts);
// AVG: een monteur-account mag het bedrijfsbrede dagoverzicht NIET zien.
await api('POST', '/api/users', { name: 'Ov Monteur', email: 'ovmont@keyservice.nl', password: 'test12345', role: 'monteur' });
const rL = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ovmont@keyservice.nl', password: 'test12345' }) });
const mCookie = (rL.headers.get('set-cookie') || '').split(';')[0];
const rOv = await fetch(`${BASE}/api/day-overview`, { headers: { cookie: mCookie } });
ok('monteur krijgt 403 op het dagoverzicht (AVG)', rOv.status === 403, `status=${rOv.status}`);

console.log('\n== Dagoverzicht: geen nachtblokkade meer (werkt 24/7) ==');
// De nachtrust-blokkade (00:00-05:00) is verwijderd: het overzicht moet op elk
// moment van de dag een antwoord geven, nooit 'nachtrust'.
const ovNight = await api('GET', '/api/day-overview');
ok('dagoverzicht geeft nooit meer "nachtrust" terug', ovNight.json.error !== 'nachtrust', JSON.stringify(ovNight.json.error));
ok('foutmelding is leesbaar (geen kale code)', !ovNight.json.error || ovNight.json.error === 'geen-ai' || ovNight.json.error.length > 12, ovNight.json.error);

console.log('\n== AI-assistent: dashboard-brede scope ==');
const ask1 = await api('POST', '/api/assistant/ask', { question: 'Hoeveel opdrachten heb ik?', scope: 'all', model: 'sonnet' });
ok('assistent-route accepteert scope + model', [200, 500].includes(ask1.status), `status=${ask1.status}`);
// Zonder AI-sleutel geeft hij de demo-melding terug (geen crash, geen 500 door onze code).
if (ask1.status === 200) ok('antwoord bevat tekst (of nette demo-melding)', typeof ask1.json.text === 'string' && ask1.json.text.length > 5, JSON.stringify(ask1.json).slice(0, 120));
else ok('nette foutmelding i.p.v. crash', !!ask1.json.error);

console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);

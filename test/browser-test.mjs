// ECHTE browsertest: opent de CRM in headless Chromium, logt in, en opent de
// factuur- én offerte-editor. Vangt elke JS-console-fout (zoals "Can't find
// variable: bundles") — de test die de vorige bug had moeten vangen.
import { chromium } from 'playwright-core';
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:3122';
let pass = 0, fail = 0; const bad = [];
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; bad.push(n); console.log('  ✗ FAIL: ' + n + (e ? ' — ' + e : '')); } };

const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
const page = await browser.newPage();
const jsErrors = [];
page.on('pageerror', (e) => jsErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') jsErrors.push(m.text()); });
const clear = () => { jsErrors.length = 0; };
const noErr = (label) => { const r = jsErrors.filter((e) => !/favicon|manifest|ServiceWorker|the server responded with a status of 4/i.test(e)); ok(`${label}: geen JS-fout in de browser`, r.length === 0, r.join(' | ')); };

// 1) Login
await page.goto(BASE + '/login.html', { waitUntil: 'networkidle' });
await page.fill('input[type=email], input[name=email], #email', 'admin@keyservice.nl');
await page.fill('input[type=password], input[name=password], #password', 'admin123');
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), page.click('button[type=submit], button')]);
await page.waitForTimeout(2000);
ok('ingelogd', await page.evaluate(() => !!document.querySelector('#board, .board, .column, .card') || /Opdrachten/i.test(document.body.innerText)));

// 2) Maak via de API een klant + pakket + losse factuur (deterministisch, geen kaart nodig)
const setup = await page.evaluate(async () => {
  const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  const cust = await post('/api/customers', { name: 'Browsertest Klant', email: 'bt@example.nl', phone: '0611000000' });
  await post('/api/bundles/add', { name: 'Hefschuifpui complete reparatie', lines: [{ description: 'Loopwagens', qty: 2, priceExcl: 180 }, { description: 'Hefsluiting', qty: 1, priceExcl: 220 }, { description: 'Arbeid', qty: 1, priceExcl: 160 }] });
  const inv = await post('/api/invoices', { customerId: cust.id, type: 'factuur' });
  const off = await post('/api/invoices', { customerId: cust.id, type: 'offerte' });
  return { invId: (inv.invoice || inv).id, offId: (off.invoice || off).id };
});
ok('testdata (klant/pakket/factuur/offerte) aangemaakt via API', setup.invId && setup.offId, JSON.stringify(setup));

// 3) FACTUUR-editor openen (dit raakt renderInvoiceEditor met bundles)
clear();
await page.evaluate((id) => window.openStandaloneInvoice(id), setup.invId);
await page.waitForTimeout(1500);
ok('FACTUUR-editor opent (Concept opslaan zichtbaar)', await page.locator('#inv-save').count() > 0);
ok('pakket-knop zichtbaar in de editor', await page.locator('.bn-add').count() > 0);
ok('opslaan-knoppen (Regels → prijslijst / pakket) zichtbaar', await page.locator('#il-to-pricelist, #il-to-bundle').count() >= 2);
noErr('Factuur openen');

// 4) Pakket-knop klikken -> voegt 3 regels toe
clear();
const linesBefore = await page.locator('#inv-lines .inv-line').count();
await page.click('.bn-add');
await page.waitForTimeout(600);
const linesAfter = await page.locator('#inv-lines .inv-line').count();
// De lege startregel wordt vervangen door de 3 pakket-regels -> minstens 3 regels.
ok('pakket voegt de 3 regels toe', linesAfter >= 3, `${linesBefore} -> ${linesAfter}`);
noErr('Pakket toevoegen');
await page.click('#inv-cancel').catch(() => {});
await page.waitForTimeout(400);

// 5) OFFERTE-editor openen
clear();
await page.evaluate((id) => window.openStandaloneInvoice(id), setup.offId);
await page.waitForTimeout(1500);
ok('OFFERTE-editor opent', await page.locator('#inv-save').count() > 0);
noErr('Offerte openen');

// 6) Instellingen → Facturen: pakketten-beheer rendert
clear();
await page.evaluate(() => window.loadSettings && window.loadSettings());
await page.waitForTimeout(1500);
noErr('Instellingen laden');

// 7) Instellingen → AI: ochtendbriefing-kaart rendert met alle velden
ok('ochtendbriefing-instellingen zichtbaar', await page.locator('#mb-enabled').count() > 0 && await page.locator('#mb-channel').count() > 0 && await page.locator('#testMorningBrief').count() > 0);
ok('samenvoeg-venster-instelling zichtbaar', await page.locator('#amw-hours').count() > 0);

// 8) Kaart-modal: gesprekshistorie + "Alles van deze klant" (klanthistorie)
clear();
const ordId = await page.evaluate(async () => {
  const post = (p, b, h = {}) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) }).then((r) => r.json());
  const ord = await post('/api/orders', { customerName: 'Browsertest Klant', customerPhone: '0611000000', title: 'Kaart voor historietest' });
  // 1-op-1 appje van dezelfde klant -> hangt aan de kaart (thread gevuld).
  await post('/api/ingest/whatsapp', { name: 'Browsertest Klant', body: 'foto volgt zo\nTelefoon: +31611000000', externalId: 'bt-hist-1' }, { 'x-ingest-token': 'test123' });
  state.orders = await fetch('/api/orders').then((r) => r.json());
  openOrderModal(ord.id);
  return ord.id;
});
await page.waitForTimeout(900);
ok('kaart-modal opent met gesprekshistorie', !!ordId && await page.locator('#f-chat').count() > 0);
ok('"Alles van deze klant"-knop aanwezig', await page.locator('#f-history').count() > 0);
await page.click('#f-history');
await page.waitForTimeout(900);
ok('klanthistorie geladen (knop wisselt naar "Alleen deze kaart")', /Alleen deze kaart/i.test(await page.locator('#f-history').innerText().catch(() => '')));
ok('zoekveld in de gesprekshistorie aanwezig', await page.locator('#f-chatsearch').count() > 0);
noErr('Kaart + klanthistorie');

// 9) Klanten-tools: dossier, import- en campagne-scherm openen zonder JS-fouten
clear();
await page.evaluate(() => closeModal());
await page.evaluate(async () => { state._customers = await fetch('/api/customers').then((r) => r.json()); });
const dosOk = await page.evaluate(async () => {
  const c = state._customers.find((x) => x.name === 'Browsertest Klant');
  await openCustomerDossier(c.id);
  return !!document.querySelector('#dos-close');
});
ok('klantdossier opent (kaarten + facturen + totalen)', dosOk);
await page.evaluate(() => closeModal());
await page.evaluate(() => openImportModal());
ok('import-scherm (CSV/Excel) opent', await page.locator('#imp-file').count() > 0);
await page.evaluate(() => closeModal());
await page.evaluate(() => openCampaignModal());
ok('campagne-scherm opent', await page.locator('#cp-subject').count() > 0);
await page.evaluate(() => closeModal());
await page.evaluate(() => openAttachmentManager());
await page.waitForTimeout(600);
ok('bijlagen-beheren-scherm opent en laadt de lijst', await page.locator('#am-grid').count() > 0 && !/^Laden/.test((await page.locator('#am-summary').innerText().catch(() => '')) || 'x'));
await page.evaluate(() => closeModal());
noErr('Klanten-tools (dossier/import/campagne/bijlagen-beheren)');

// 9b) Cijfers: historie-boeken en omzet-suggesties openen zonder JS-fout
clear();
await page.evaluate(() => goView('finance'));
await page.waitForTimeout(1200);
await page.evaluate(() => openBackfillModal());
await page.waitForTimeout(900);
ok('historie-boeken-scherm opent met datumveld', await page.locator('#bf-since').count() > 0 && await page.locator('#bf-book').count() > 0);
await page.evaluate(() => closeModal());
await page.evaluate(() => openImportIncome());
await page.waitForTimeout(900);
ok('omzet-uit-rapporten-scherm opent', await page.locator('#imp-cancel').count() > 0);
await page.evaluate(() => closeModal());
noErr('Cijfers (historie boeken / omzet-suggesties)');

// 10) Start-pagina: AI-dagoverzicht rendert (feiten-fallback zonder AI-sleutel)
clear();
await page.evaluate(() => goView('overview'));
await page.waitForTimeout(1200);
ok('dagoverzicht-blok aanwezig op Start', await page.locator('#dayov').count() > 0);
ok('dagoverzicht toont inhoud (geen leeg blok)', ((await page.locator('#dayov-body').innerText().catch(() => '')) || '').length > 10);
noErr('Start + AI-dagoverzicht');

// 11) Slimme zoekbalk op Start: typen -> resultaten verschijnen, klik crasht niet
clear();
ok('zoekbalk aanwezig op Start', await page.locator('#globalSearch').count() > 0);
await page.fill('#globalSearch', 'Browser');
await page.waitForTimeout(900); // debounce (300ms) + zoek-rondje
const gsText = (await page.locator('#gsResults').innerText().catch(() => '')) || '';
ok('zoekresultaten verschijnen onder het veld', gsText.length > 3, gsText.slice(0, 60));
noErr('Slimme zoekbalk');

console.log(`\n========== BROWSER: ${pass} geslaagd, ${fail} gefaald ==========`);
await browser.close();
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);

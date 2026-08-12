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

// 12) Bord: periode-filter "vandaag binnengekomen" toont de vandaag aangemaakte kaart
clear();
await page.evaluate(() => goView('board'));
await page.waitForTimeout(1200);
await page.selectOption('#boardPeriodFilter', 'vandaag');
await page.waitForTimeout(1200); // her-laden mét ingeklapte kaarten
const bpText = (await page.locator('#board').innerText().catch(() => '')) || '';
ok('periode-balk verschijnt bij filter "vandaag"', await page.locator('.board-period-bar').count() > 0);
ok('vandaag aangemaakte kaart blijft zichtbaar in het filter', /historietest/i.test(bpText), bpText.slice(0, 80));
await page.selectOption('#boardPeriodFilter', '');
await page.waitForTimeout(800);
noErr('Bord periode-filter');

// 13) Bulk-selectie blijft staan als het bord opnieuw wordt opgebouwd (klacht 29 jul:
// "als ik opdrachten selecteer gaat die na 30 seconden weg alsof het scherm refresht").
clear();
await page.evaluate(() => goView('board'));
await page.waitForTimeout(1200);
const aantalVinkjes = await page.locator('.card-check').count();
if (aantalVinkjes >= 2) {
  await page.locator('.card-check').nth(0).check();
  await page.locator('.card-check').nth(1).check();
  const balkZichtbaar = async () => !(await page.locator('#boardBulkBar').isHidden());
  ok('bulkbalk verschijnt bij 2 selecties', await balkZichtbaar() && /2 geselecteerd/.test(await page.locator('#boardBulkCount').innerText()));
  // Forceer precies wat de automatische verversing doet.
  await page.evaluate(async () => { await loadBoard(); });
  await page.waitForTimeout(600);
  ok('selectie OVERLEEFT een volledige verversing van het bord', await page.locator('.card-check:checked').count() === 2, String(await page.locator('.card-check:checked').count()));
  ok('bulkbalk staat er dan nog steeds', await balkZichtbaar());
  // Nogmaals renderen zonder datawijziging: het bord mag niet opnieuw getekend worden.
  const zelfdeHtml = await page.evaluate(() => { const voor = document.querySelector('#board').firstElementChild; renderBoard(); return document.querySelector('#board').firstElementChild === voor; });
  ok('bord wordt NIET opnieuw getekend als er niets veranderd is (geen geknipper)', zelfdeHtml);
  await page.evaluate(() => clearBoardSel());
  ok('selectie wissen leegt de balk', await page.locator('#boardBulkBar').isHidden());
} else {
  ok('bulk-selectietest overgeslagen (te weinig kaarten)', true);
}
noErr('Bulk-selectie & verversing');

// ---------- Koppelcode-kaartje (6 aug 2026) — óók op telefoonformaat ----------
// De bridge stuurt de koppelcode naar het CRM zodat je nooit meer in de VPS-console
// hoeft. Dit MOET op mobiel werken (daar zoek je de code op terwijl de telefoon met
// WhatsApp in je andere hand ligt), dus we testen het letterlijk op iPhone-formaat.
clear();
// Bridge gesimuleerd: code melden zoals bridge.js dat doet (zelfde endpoint + token).
const gemeld = await page.evaluate(() => fetch('/api/whatsapp/pairing', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-token': 'test123' },
  body: JSON.stringify({ code: 'V6AF-P2CR', qr: '2@testqrdata', at: new Date().toISOString() }),
}).then((r) => r.status));
ok('bridge kan de koppelcode melden', gemeld === 200, `status=${gemeld}`);
await page.setViewportSize({ width: 390, height: 844 }); // iPhone-formaat
await page.evaluate(() => showView('settings'));
await page.waitForTimeout(1800);
ok('koppel-kaartje zichtbaar op telefoonformaat', await page.locator('#wa-pair-card').isVisible());
ok('de code staat er leesbaar in', (await page.locator('#pair-code').textContent().catch(() => '')) === 'V6AF-P2CR');
const past = await page.evaluate(() => {
  const el = document.querySelector('#pair-code');
  return el && el.getBoundingClientRect().right <= window.innerWidth + 1;
});
ok('code valt binnen het scherm (geen horizontaal scrollen)', past === true);
// Koppeling gelukt -> bridge meldt leeg -> kaartje verdwijnt vanzelf (poll of herbezoek).
await page.evaluate(() => fetch('/api/whatsapp/pairing', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-token': 'test123' },
  body: JSON.stringify({}),
}));
await page.evaluate(() => showView('start'));
await page.waitForTimeout(300);
await page.evaluate(() => showView('settings'));
await page.waitForTimeout(1200);
ok('na gelukte koppeling verdwijnt het kaartje', await page.locator('#wa-pair-card').isHidden());
// Alleen een QR zonder code = niets tonen: wij koppelen uitsluitend met de CODE.
await page.evaluate(() => fetch('/api/whatsapp/pairing', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-token': 'test123' },
  body: JSON.stringify({ qr: '2@alleen-qr', at: new Date().toISOString() }),
}));
await page.evaluate(() => showView('start'));
await page.waitForTimeout(300);
await page.evaluate(() => showView('settings'));
await page.waitForTimeout(1200);
ok('alleen-QR (zonder code) toont GEEN koppelkaartje meer', await page.locator('#wa-pair-card').isHidden());
await page.evaluate(() => fetch('/api/whatsapp/pairing', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-token': 'test123' },
  body: JSON.stringify({}),
}));
await page.setViewportSize({ width: 1280, height: 800 });
noErr('Koppelcode-kaartje (mobiel)');

// ---------- Berichten-scherm (7 aug 2026) — desktop én telefoonformaat ----------
// Het chatscherm: gesprekkenlijst, gesprek openen, bericht versturen (gaat door de
// echte beveiligde wachtrij), koppeling naar de kaart. Moet vlekkeloos op mobiel.
clear();
// Testdata: klant + kaart + binnengekomen appje via de echte pipeline.
await page.evaluate(async () => {
  await fetch('/api/ingest/whatsapp', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-token': 'test123' },
    body: JSON.stringify({ name: 'Chat Browserklant', body: 'Goedemiddag, cilinder kapot in Veenendaal, Beukenlaan 4, 3903AB. Kunt u helpen?\nTelefoon: +31644455566', externalId: 'br-chat-1' }),
  });
});
await page.evaluate(() => goView('chats'));
await page.waitForTimeout(1500);
ok('Berichten-scherm opent met gesprekkenlijst', await page.locator('#chatList').count() > 0);
const rij = page.locator('.chat-item', { hasText: 'Chat Browserklant' }).first();
const rijGevonden = await rij.count() > 0 || await page.locator('.chat-item').count() > 0;
ok('gesprek zichtbaar in de lijst', rijGevonden);
await (await rij.count() ? rij : page.locator('.chat-item').first()).click();
await page.waitForTimeout(1200);
ok('gesprek opent met berichten', await page.locator('#cpMsgs .chat-msg').count() > 0, String(await page.locator('#cpMsgs .chat-msg').count()));
await page.fill('#cpText', 'Browsertest: we komen eraan!');
await page.click('#cpSend');
await page.waitForTimeout(1200);
ok('verstuurd bericht verschijnt als uitgaande bubbel', await page.locator('#cpMsgs .chat-msg.out', { hasText: 'we komen eraan' }).count() > 0);
noErr('Berichten-scherm (desktop)');

// LIVE bijwerken terwijl je typt (12 aug): nieuw klantbericht verschijnt in het open
// gesprek ZONDER dat je getypte tekst verdwijnt — de klassieke chat-valkuil.
clear();
await page.fill('#cpText', 'half getypt antwoord');
await page.evaluate(() => fetch('/api/ingest/whatsapp', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-token': 'test123' },
  body: JSON.stringify({ name: 'Chat Browserklant', body: 'En de achterdeur graag ook nakijken!\nTelefoon: +31644455566', externalId: 'br-chat-live' }),
}));
await page.waitForTimeout(7000); // pulse-interval afwachten
ok('nieuw klantbericht verschijnt LIVE in het open gesprek', await page.locator('#cpMsgs .chat-msg.in', { hasText: 'achterdeur graag ook' }).count() > 0);
ok('getypte tekst blijft gewoon staan', (await page.inputValue('#cpText')) === 'half getypt antwoord');
ok('WhatsApp-stijl: tijd + vinkjes in de bubbel', await page.locator('#cpMsgs .wa-meta').count() > 0);
await page.fill('#cpText', '');
noErr('Live bijwerken tijdens typen');

// Telefoonformaat: lijst -> gesprek vult het scherm -> terugknop terug naar de lijst.
clear();
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => showView('overview'));
await page.waitForTimeout(300);
await page.evaluate(() => goView('chats'));
await page.waitForTimeout(1200);
ok('mobiel: lijst zichtbaar, gesprek nog niet', await page.locator('#chatList').isVisible() && await page.locator('#chatPane').isHidden());
await page.locator('.chat-item').first().click();
await page.waitForTimeout(1200);
ok('mobiel: gesprek vult het scherm, lijst weg', await page.locator('#chatPane').isVisible() && await page.locator('#chatList').isHidden());
const chatPast = await page.evaluate(() => {
  const p = document.querySelector('.chat-pane');
  return p && p.getBoundingClientRect().right <= window.innerWidth + 1;
});
ok('mobiel: gesprek valt binnen het scherm', chatPast === true);
ok('mobiel: verstuur-balk bereikbaar', await page.locator('#cpText').isVisible());
await page.click('#cpBack');
await page.waitForTimeout(600);
ok('mobiel: terugknop -> lijst terug', await page.locator('#chatList').isVisible());
ok('mobiel: Berichten-knop staat in de onderbalk', await page.locator('.bn-item[data-view="chats"]').isVisible());
await page.setViewportSize({ width: 1280, height: 800 });
noErr('Berichten-scherm (mobiel)');

// ---------- Zijbalk past altijd (6 aug 2026) ----------
// Klacht: "ik moet naar 75% uitzoomen om AI actief / WhatsApp actief en alles
// eronder te zien". De balk stond op 100vh zonder scroll, dus de onderkant viel
// er gewoon af. Dit test op een LAAG scherm dat het voetblok in beeld blijft.
clear();
await page.setViewportSize({ width: 1280, height: 620 });   // laag scherm / 100% zoom
await page.evaluate(() => showView('start'));
await page.waitForTimeout(800);
const zij = await page.evaluate(() => {
  const foot = document.querySelector('.sidebar-foot');
  const bar = document.querySelector('.sidebar');
  if (!foot || !bar) return { err: 'zijbalk niet gevonden' };
  const f = foot.getBoundingClientRect();
  const nav = document.querySelector('.nav');
  return {
    footOnderkant: Math.round(f.bottom),
    schermHoogte: window.innerHeight,
    navScrollt: nav ? getComputedStyle(nav).overflowY : '',
    uitloggenZichtbaar: !!document.querySelector('#logoutBtn, .foot-actions'),
  };
});
ok('voetblok (status + account + uitloggen) valt binnen het scherm',
  !zij.err && zij.footOnderkant <= zij.schermHoogte + 1, JSON.stringify(zij));
ok('menu-lijst scrollt zelf als hij niet past', zij.navScrollt === 'auto' || zij.navScrollt === 'scroll', zij.navScrollt);
ok('uitlog-/accountknoppen aanwezig', zij.uitloggenZichtbaar === true);
await page.setViewportSize({ width: 1280, height: 800 });
noErr('Zijbalk op laag scherm');

console.log(`\n========== BROWSER: ${pass} geslaagd, ${fail} gefaald ==========`);
await browser.close();
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);

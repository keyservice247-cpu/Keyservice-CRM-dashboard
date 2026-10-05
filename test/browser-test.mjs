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
// Cluster D (28 sep 2026): app.js en grote JSON komen gzip-gecomprimeerd binnen; de
// service worker blijft actief (installeerbaar + push) maar onderschept alleen nog
// navigaties — een API-verzoek gaat er niet meer doorheen.
const czD = await page.evaluate(async () => {
  const r = await fetch('/js/app.js', { cache: 'no-store' });
  const reg = navigator.serviceWorker ? await Promise.race([navigator.serviceWorker.ready, new Promise((res) => setTimeout(() => res(null), 4000))]) : null;
  return { enc: r.headers.get('content-encoding'), sw: !!(reg && reg.active), push: !!(reg && reg.pushManager) };
});
ok('app.js komt gzip-gecomprimeerd binnen', czD.enc === 'gzip', JSON.stringify(czD));
ok('service worker actief (push blijft werken)', czD.sw && czD.push, JSON.stringify(czD));

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
ok('FACTUUR-editor opent (Opslaan zichtbaar)', await page.locator('#inv-save').count() > 0);
// Standaard betaald (20 sep 2026): nieuwe factuur = betaald, knop "Nog niet betaald", geen "✓ Betaald".
ok('nieuwe factuur staat op Betaald met knop "Nog niet betaald"', await page.locator('#inv-unpaid').count() === 1 && await page.locator('#inv-paid').count() === 0 && /Betaald/.test(await page.locator('#modal p.muted').first().textContent()));
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
// "Regels → pakket" vraagt de naam in een EIGEN venster (geen browser-prompt), bovenop de editor.
await page.click('#il-to-bundle');
await page.waitForTimeout(300);
ok('pakketnaam wordt gevraagd in een eigen venster (geen prompt)', await page.locator('#md-input').count() === 1 && await page.locator('#inv-save').count() === 1);
await page.fill('#md-input', 'Browsertest pakket');
await page.click('#md-ok');
await page.waitForTimeout(600);
ok('pakket opgeslagen via het venster', await page.evaluate(() => fetch('/api/settings').then((r) => r.json()).then((s) => (s.priceBundles || []).some((b) => b.name === 'Browsertest pakket'))));
ok('venster is weer weg, editor staat nog', await page.locator('#md-input').count() === 0 && await page.locator('#inv-save').count() === 1);
noErr('Pakketnaam-venster');
// BETAALD-KEUZE BIJ VERSTUREN (3 okt 2026): elke factuur-verzending vraagt eerst
// "Kan deze factuur als betaald worden verstuurd?" — Annuleren verstuurt niets.
clear();
await page.click('#inv-send-wa');
await page.waitForSelector('#bk-ja', { timeout: 4000 }).catch(() => {});
const bk = await page.evaluate(() => ({
  titel: (document.querySelector('#bk-titel') || {}).textContent || '',
  ja: !!document.querySelector('#bk-ja'), nee: !!document.querySelector('#bk-nee'),
  bedrag: /€\s?\d/.test((document.querySelector('.bk-dialog .muted') || {}).textContent || ''),
  editorStaat: !!document.querySelector('#inv-save'),
}));
ok('betaald-vraag verschijnt bij "Via WhatsApp" (Ja/Nee + bedrag, editor blijft staan)', /als betaald worden verstuurd/.test(bk.titel) && bk.ja && bk.nee && bk.bedrag && bk.editorStaat, JSON.stringify(bk));
await page.click('#bk-cancel');
await page.waitForTimeout(400);
const naAnnuleren = await page.evaluate(async (id) => ({ weg: !document.querySelector('#bk-ja'), editor: !!document.querySelector('#inv-save'), inv: await fetch('/api/invoices/' + id).then((r) => r.json()) }), setup.invId);
const invNaA = naAnnuleren.inv.invoice || naAnnuleren.inv;
ok('Annuleren: niets verstuurd, factuur ongewijzigd', naAnnuleren.weg && naAnnuleren.editor && !invNaA.sentAt, JSON.stringify({ weg: naAnnuleren.weg, sent: invNaA.sentAt }));
await page.click('#inv-send-wa');
await page.waitForSelector('#bk-nee', { timeout: 4000 }).catch(() => {});
await page.click('#bk-nee');
await page.waitForFunction(() => !document.querySelector('#inv-save'), null, { timeout: 8000 }).catch(() => {});
const naNee = await page.evaluate(async (id) => {
  const inv = await fetch('/api/invoices/' + id).then((r) => r.json());
  const ob = await fetch('/api/whatsapp/outbox-status?full=1').then((r) => r.json());
  const lijst = Array.isArray(ob) ? ob : (ob.items || []);
  return { inv: inv.invoice || inv, item: lijst.find((x) => x.invoiceId === id) || null };
}, setup.invId);
ok('"Nee, nog niet betaald": factuur Verzonden (open), WhatsApp-tekst zonder "voldaan"', naNee.inv.status === 'verzonden' && !naNee.inv.paidAt && naNee.item && !/voldaan/i.test(naNee.item.text || ''), JSON.stringify({ s: naNee.inv.status, t: naNee.item && naNee.item.text }));
noErr('Betaald-keuze bij versturen');
// Niet-opgeslagen regels gaan nooit stil verloren bij een statusknop (audit 3 okt 2026).
clear();
const bewaarId = await page.evaluate(async () => {
  const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  const c = await post('/api/customers', { name: 'Bewaar Klant', email: 'bewaar@example.nl', phone: '0611000001' });
  const i = await post('/api/invoices', { customerId: c.id, type: 'factuur' });
  return (i.invoice || i).id;
});
await page.click('#inv-cancel').catch(() => {});
await page.waitForTimeout(300);
await page.evaluate((id) => window.openStandaloneInvoice(id), bewaarId);
await page.waitForSelector('.bn-add', { timeout: 5000 }).catch(() => {});
await page.click('.bn-add');
await page.waitForTimeout(300);
await page.click('#inv-unpaid');
await page.waitForFunction(() => !document.querySelector('#inv-save'), null, { timeout: 8000 }).catch(() => {});
const bewaard = await page.evaluate(async (id) => { const j = await fetch('/api/invoices/' + id).then((r) => r.json()); return j.invoice || j; }, bewaarId);
ok('"Nog niet betaald" met nieuwe regels: eerst opgeslagen, dan status gewijzigd', (bewaard.lines || []).length >= 3 && bewaard.status === 'concept', JSON.stringify({ n: (bewaard.lines || []).length, s: bewaard.status }));
noErr('Statusknop bewaart eerst');
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
// Voetregel onder automatische klantmails (10 sep): veld met standaardtekst, opslaan werkt.
ok('voetregel-veld voor automatische mails zichtbaar mét standaardtekst', await page.locator('#ar-disclaimer').count() > 0 && /automatisch gegenereerd/i.test(await page.locator('#ar-disclaimer').inputValue()));
// De kaart zit in een ingeklapte instellingen-groep (niet zichtbaar zonder pil-klik):
// waarde zetten en opslaan via het DOM, precies wat de knop zelf doet.
await page.locator('#ar-disclaimer').evaluate((el) => { el.value = 'Dit is een automatisch gegenereerd bericht (browsertest).'; });
await page.locator('#saveAutoReply').evaluate((b) => b.click());
await page.waitForTimeout(1200);
const arOpgeslagen = await page.evaluate(async () => (await (await fetch('/api/settings')).json()).autoReply?.disclaimer);
ok('voetregel opslaan komt door tot de server', arOpgeslagen === 'Dit is een automatisch gegenereerd bericht (browsertest).', JSON.stringify(arOpgeslagen));

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
ok('klanthistorie geladen (knop wisselt naar "Alleen deze kaart")', /Alleen deze opdracht/i.test(await page.locator('#f-history').innerText().catch(() => '')));
ok('zoekveld in de gesprekshistorie aanwezig', await page.locator('#f-chatsearch').count() > 0);
noErr('Kaart + klanthistorie');

// 8b) OPDRACHT-VENSTER & DATA-INTEGRITEIT (audit 28 sep 2026): dubbelklik = één
// opdracht, Esc/klik-naast met getypte notitie vraagt eerst, Esc werkt weer na een
// eigen invoervenster, aanvraag-adres (intake) blijft na Opslaan staan, en een
// collega-wijziging wordt niet stil teruggezet.
clear();
await page.evaluate(() => closeModal());
await page.evaluate(() => openOrderModal());
await page.waitForTimeout(400);
await page.fill('#f-title', 'Ede — dubbelklik browsertest');
await page.fill('#f-cname', 'Dubbelklik Klant');
await page.fill('#f-cphone', '0611000444');
await page.dblclick('#f-save');
await page.waitForTimeout(1500);
const dblAantal = await page.evaluate(() => fetch('/api/orders').then((r) => r.json()).then((os) => os.filter((o) => o.title === 'Ede — dubbelklik browsertest').length));
ok('dubbelklik op Opslaan maakt precies 1 opdracht', dblAantal === 1, String(dblAantal));
// Intake-testkaart: klantrecord Rhenen, deze aanvraag Utrecht.
const ikId = await page.evaluate(async () => {
  const req = (m, p, b) => fetch(p, { method: m, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  const c = await req('POST', '/api/customers', { name: 'Intake Browser', phone: '0611000555', address: 'Oudeweg 1, 3911 AA Rhenen' });
  const o = await req('POST', '/api/orders', { customerId: c.id, title: 'Utrecht — intake browsertest', status: 'open' });
  await req('PATCH', `/api/orders/${o.id}`, { intake: { name: 'Intake Browser', phone: '0611000555', email: '', address: 'Nieuwelaan 99, 3511 AA Utrecht' } });
  return o.id;
});
await page.evaluate((id) => openOrderModal(id), ikId); // niet op het bord → haalt alleen deze kaart op
await page.waitForTimeout(900);
ok('venster toont het adres van DEZE aanvraag (intake), niet het klantrecord', await page.inputValue('#f-ccaddress').catch(() => '') === 'Nieuwelaan 99, 3511 AA Utrecht');
// Esc zonder wijzigingen sluit direct (geen vraag).
let dlgTeller = 0; const telDlg = () => { dlgTeller++; }; page.on('dialog', telDlg);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
ok('Esc zonder wijzigingen sluit meteen, zonder vraag', await page.locator('#modalRoot').isHidden() && dlgTeller === 0);
page.off('dialog', telDlg);
await page.evaluate((id) => openOrderModal(id), ikId);
await page.waitForTimeout(900);
await page.click('#f-notes');
await page.keyboard.type('Klant belt terug om 14:00');
let escVraag = '';
page.once('dialog', (d) => { escVraag = d.message(); d.dismiss(); });
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
ok('Esc met getypte notitie vraagt eerst "Niet opgeslagen wijzigingen"', /Niet opgeslagen wijzigingen/.test(escVraag) && !(await page.locator('#modalRoot').isHidden()), escVraag);
ok('na "blijven" staat de getypte notitie er nog', /14:00/.test(await page.inputValue('#f-notes')));
let klikVraag = '';
page.once('dialog', (d) => { klikVraag = d.message(); d.dismiss(); });
await page.mouse.click(8, 450); // naast het venster (achtergrond)
await page.waitForTimeout(400);
ok('klik naast het venster met getypte notitie vraagt ook eerst', /Niet opgeslagen/.test(klikVraag) && !(await page.locator('#modalRoot').isHidden()), klikVraag);
// Eigen invoervenster (vraagTekst) annuleren → daarna werkt Esc nog steeds.
await page.evaluate(() => { vraagTekst({ titel: 'Test' }); });
await page.waitForTimeout(200);
await page.click('#md-cancel');
await page.waitForTimeout(200);
page.once('dialog', (d) => d.accept());
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
ok('na een eigen invoervenster sluit Esc het venster nog (bevestigd)', await page.locator('#modalRoot').isHidden());
// Intake blijft na een gewone Opslaan (alleen de prijs gewijzigd); collega-notitie blijft ook.
await page.evaluate((id) => openOrderModal(id), ikId);
await page.waitForTimeout(900);
await page.evaluate((id) => fetch(`/api/orders/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ notes: 'Collega: sleutel ligt bij buren' }) }), ikId);
await page.fill('#f-price', '95');
await page.click('#f-save');
await page.waitForTimeout(1000);
const naOpslaan = await page.evaluate((id) => fetch(`/api/orders/${id}`).then((r) => r.json()), ikId);
ok('intake-adres blijft na Opslaan staan (monteur rijdt naar het juiste adres)', naOpslaan.intake?.address === 'Nieuwelaan 99, 3511 AA Utrecht' && naOpslaan.price === '95', JSON.stringify({ intake: naOpslaan.intake, price: naOpslaan.price }));
ok('notitie van de collega is niet stil teruggezet', naOpslaan.notes === 'Collega: sleutel ligt bij buren', naOpslaan.notes);
ok('klantrecord bleef Rhenen (niets stil overschreven)', naOpslaan.customer?.address === 'Oudeweg 1, 3911 AA Rhenen', naOpslaan.customer?.address);
noErr('Opdracht-venster data-integriteit');

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
// Foto's & video's beheren (16 sep 2026): dezelfde foto op twee kaarten = één tegel
// "op 2 plekken", filters per aantal dagen, schijf-regel, verwijderen haalt alles weg.
const fotoSetup = await page.evaluate(async () => {
  const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  const cust = await post('/api/customers', { name: 'Fotodubbel Klant', phone: '0611000099' });
  const a = await post('/api/orders', { customerId: cust.id, title: 'Rhenen — fotodubbel A', status: 'nieuw' });
  const b = await post('/api/orders', { customerId: cust.id, title: 'Rhenen — fotodubbel B', status: 'nieuw' });
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';
  const ua = await post(`/api/orders/${a.id}/attachments`, { filename: 'dubbel.png', mime: 'image/png', dataBase64: png });
  const ub = await post(`/api/orders/${b.id}/attachments`, { filename: 'dubbel.png', mime: 'image/png', dataBase64: png });
  const fa = (ua.attachments || []).find((x) => x.filename === 'dubbel.png');
  const fb = (ub.attachments || []).find((x) => x.filename === 'dubbel.png');
  return { file: fa && fa.file, zelfde: !!fa && !!fb && fa.file === fb.file };
});
ok('zelfde foto op 2 kaarten = 1 bestand op schijf', fotoSetup.zelfde, JSON.stringify(fotoSetup));
await page.evaluate(() => openAttachmentManager());
await page.waitForTimeout(900);
ok('bijlagen-beheren-scherm opent en laadt de lijst', await page.locator('#am-grid').count() > 0 && !/^Laden/.test((await page.locator('#am-summary').innerText().catch(() => '')) || 'x'));
ok('filter kent 14/30/60/90/180 dagen', await page.evaluate(() => ['old14', 'old30', 'old60', 'old90', 'old180', 'missing', 'los'].every((v) => !!document.querySelector(`#am-filter option[value="${v}"]`))));
ok('schijf-regel (dubbelen/wezen) staat in het scherm', ((await page.locator('#am-schijf').innerText().catch(() => '')) || '').length > 5);
ok('tegel toont "op 2 plekken"', await page.evaluate(() => /op 2 plekken/.test(document.querySelector('#am-grid')?.innerText || '')));
const tegelsVoor = await page.locator('#am-grid .am-item').count();
await page.evaluate((file) => { const c = [...document.querySelectorAll('#am-grid .am-pick')].find((x) => x.closest('.am-item')?.querySelector('span.chip')); if (c) { c.click(); } }, fotoSetup.file);
await page.waitForTimeout(200);
page.once('dialog', (d) => d.accept());
await page.click('#am-delete');
await page.waitForTimeout(900);
const tegelsNa = await page.locator('#am-grid .am-item').count();
ok('verwijderen haalt de tegel weg (1 bestand, beide plekken)', tegelsNa === tegelsVoor - 1, `${tegelsVoor} -> ${tegelsNa}`);
const kapot = await page.evaluate(async () => {
  const os = await fetch('/api/orders').then((r) => r.json());
  return os.filter((o) => /fotodubbel/.test(o.title)).some((o) => (o.attachments || []).some((a) => a.filename === 'dubbel.png'));
});
ok('geen kapotte verwijzing op kaart A of B', !kapot);
await page.evaluate(() => closeModal());
noErr('Klanten-tools (dossier/import/campagne/bijlagen-beheren)');

// Naar monteur sturen (28 sep 2026, "het CRM stuurt geen foto's meer mee"): foto's staan
// standaard AAN (max 6), "geen"/"alles"-knop, een 7e aanvinken kan niet, waarschuwing als
// de opdracht al eens is verstuurd, en de kaart toont hoeveel foto's er écht aankwamen.
clear();
const smSetup = await page.evaluate(async () => {
  const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  const m = await post('/api/monteurs', { name: 'Browser Monteur', phone: '0612000111', waGroup: 'Browser Groep' });
  const cust = await post('/api/customers', { name: 'Fotomonteur Klant', phone: '0611000088' });
  const o = await post('/api/orders', { customerId: cust.id, title: 'Rotterdam — hefschuifpui browsertest', status: 'nieuw', monteurId: m.id });
  for (let i = 0; i < 7; i++) {
    const c = document.createElement('canvas'); c.width = 6; c.height = 6;
    const g = c.getContext('2d'); g.fillStyle = `rgb(${20 + i * 30},${120 - i * 10},200)`; g.fillRect(0, 0, 6, 6);
    await post(`/api/orders/${o.id}/attachments`, { filename: `kozijn${i + 1}.png`, mime: 'image/png', dataBase64: c.toDataURL('image/png') });
  }
  state.monteurs = await fetch('/api/monteurs').then((r) => r.json());
  state.orders = await fetch('/api/orders').then((r) => r.json());
  return { orderId: o.id, monteurId: m.id, fotos: (state.orders.find((x) => x.id === o.id)?.attachments || []).length };
});
ok('testopdracht met 7 foto\'s', smSetup.fotos === 7, JSON.stringify(smSetup));
const smStaat = () => page.evaluate(() => ({ totaal: document.querySelectorAll('.sm-img').length, aan: document.querySelectorAll('.sm-img:checked').length, knop: (document.querySelector('#sm-imgall') || {}).textContent, al: !!document.querySelector('.sm-al-verstuurd') }));
await page.evaluate((id) => openSendMonteurModal(state.orders.find((o) => o.id === id)), smSetup.orderId);
await page.waitForTimeout(300);
const sm1 = await smStaat();
ok('verstuur-venster: de eerste 6 foto\'s staan standaard aan, knop "geen"', sm1.totaal === 7 && sm1.aan === 6 && sm1.knop === 'geen' && !sm1.al, JSON.stringify(sm1));
await page.locator('.sm-img').nth(6).click({ force: true });
await page.waitForTimeout(150);
const sm2 = await smStaat();
ok('7e foto aanvinken kan niet (max 6), met uitleg', sm2.aan === 6 && !(await page.locator('.sm-img').nth(6).isChecked()) && /Hooguit 6/.test(await page.locator('#toast').textContent()), JSON.stringify(sm2));
await page.click('#sm-imgall');
const sm3 = await smStaat();
ok('"geen" zet alle foto\'s uit, knop wordt "alles"', sm3.aan === 0 && sm3.knop === 'alles', JSON.stringify(sm3));
await page.click('#sm-imgall');
const sm4 = await smStaat();
ok('"alles" zet er weer 6 aan', sm4.aan === 6 && sm4.knop === 'geen', JSON.stringify(sm4));
for (const n of [2, 3, 4, 5]) await page.locator('.sm-img').nth(n).click({ force: true });
ok('losse foto\'s uitzetten werkt (2 over)', (await smStaat()).aan === 2);
await page.selectOption('#sm-monteur', smSetup.monteurId);
await page.click('#sm-send');
await page.waitForTimeout(700);
const smItem = await page.evaluate(async (oid) => {
  const q = await fetch('/api/whatsapp/outbox-status?full=1').then((r) => r.json());
  return (q || []).find((x) => x.orderId === oid && x.group === 'Browser Groep') || null;
}, smSetup.orderId);
ok('versturen: 2 aangevinkte foto\'s gaan als bijlage mee', !!smItem && (smItem.media || []).length === 2, JSON.stringify(smItem && smItem.media));
// Bridge meldt terug: 1 van de 2 foto's kwam aan → de kaart laat dat zien.
await page.evaluate(async (itemId) => {
  await fetch(`/api/outbox/${itemId}/done`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-token': 'test123' }, body: JSON.stringify({ ok: true, detail: 'groep', media: { gevraagd: 2, verstuurd: 1, fout: 'test' } }) });
  state.orders = await fetch('/api/orders').then((r) => r.json());
}, smItem && smItem.id);
await page.evaluate((id) => openOrderModal(id), smSetup.orderId);
await page.waitForTimeout(700);
ok('kaart toont "foto\'s: 1 van 2 aangekomen" (opvallend)', /1 van 2 aangekomen/.test(await page.locator('.sent-monteur .sm-foto-mislukt').textContent().catch(() => '')));
await page.evaluate((id) => openSendMonteurModal(state.orders.find((o) => o.id === id)), smSetup.orderId);
await page.waitForTimeout(300);
ok('opnieuw openen: waarschuwing "Al verstuurd naar Browser Monteur"', /Al verstuurd naar Browser Monteur/.test(await page.locator('.sm-al-verstuurd').textContent().catch(() => '')));
await page.click('#sm-cancel');
await page.waitForTimeout(500);
await page.evaluate(() => closeModal());
noErr('Naar monteur sturen (foto\'s)');

// Snel antwoord via WhatsApp (2 okt 2026): knop in het antwoordvenster van een opdracht,
// nummer vooraf ingevuld, alleen het getypte antwoord gaat de wachtrij in.
clear();
await page.evaluate((id) => openOrderModal(id), smSetup.orderId);
await page.waitForTimeout(500);
await page.click('#f-reply');
await page.waitForTimeout(300);
ok('Snel antwoord: knop "Via WhatsApp" + 06-nummer vooraf ingevuld', await page.locator('#rep-wa').count() === 1 && (await page.inputValue('#rep-phone')) === '0611000088', await page.inputValue('#rep-phone').catch(() => '?'));
await page.fill('#rep-body', 'Browsertest: we komen morgen om 10 uur.');
await page.click('#rep-wa');
await page.waitForTimeout(700);
const saItem = await page.evaluate(async () => ((await fetch('/api/whatsapp/outbox-status?full=1').then((r) => r.json())) || []).find((x) => /Browsertest: we komen morgen/.test(x.text || '')) || null);
ok('Via WhatsApp: alleen het antwoord (zonder handtekening) staat in de wachtrij, venster dicht', !!saItem && saItem.text === 'Browsertest: we komen morgen om 10 uur.' && saItem.group === '__klant_dm__' && await page.locator('#rep-wa').count() === 0, JSON.stringify(saItem));
noErr('Snel antwoord via WhatsApp');

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

// 9c-0) PUSHMELDINGEN PER ROL (21 sep 2026): hint-balk + meldingen-blok in "Mijn account".
clear();
ok('push-hintbalk bestaat (zichtbaar of verborgen, nooit een fout)', await page.locator('#pushHint').count() === 1);
await page.evaluate(() => openAccountModal());
await page.waitForTimeout(900);
ok('Mijn account toont meldingen-blok + wachtwoordvelden', await page.locator('#modal #pushPanel').count() === 1 && await page.locator('#p-save').count() === 1 && /Meldingen op dit toestel/.test(await page.locator('#modal').textContent()));
await page.evaluate(() => closeModal());
noErr('Account (meldingen)');

// 9c) CONVERSIE (20 sep 2026): blok bovenaan Cijfers — KPI's, per bron, weken, briefing.
clear();
await page.evaluate(() => goView('finance'));
await page.waitForFunction(() => document.querySelectorAll('#conversiePanel .stat').length > 0, null, { timeout: 8000 });
const cvDesk = await page.evaluate(() => ({
  stats: document.querySelectorAll('#conversiePanel .stat').length,
  groot: !!document.querySelector('#conversiePanel .cv-stat-groot .num') && /%|–/.test(document.querySelector('#conversiePanel .cv-stat-groot .num').textContent),
  tabellen: document.querySelectorAll('#conversiePanel .cv-tabel').length,
  weken: document.querySelectorAll('#conversiePanel .cv-week').length,
  patronen: document.querySelectorAll('#conversiePanel .cv-patronen li').length,
  knop: !!document.querySelector('#cvBriefingBtn'),
  periode: document.querySelector('#cvDagen') && document.querySelector('#cvDagen').value,
  finKop: !!document.querySelector('#financePanel .fin-kop'),
}));
ok('conversie: 5 KPI-tegels, groot percentage, 2 tabellen, 12 weken, patronen, briefing-knop (admin)', cvDesk.stats === 5 && cvDesk.groot && cvDesk.tabellen >= 2 && cvDesk.weken === 12 && cvDesk.patronen >= 1 && cvDesk.knop && cvDesk.finKop, JSON.stringify(cvDesk));
ok('conversie: periodes 7/14/30/90/365 + uitleg-blok met "afspraak"', await page.evaluate(() => [...document.querySelectorAll('#cvDagen option')].map((o) => o.value).join() === '7,14,30,90,365' && /afspraak ingepland/.test((document.querySelector('.cv-uitleg') || {}).textContent || '')));
// Periode wisselen wordt onthouden en herlaadt zonder fout.
await page.selectOption('#cvDagen', '7');
await page.waitForTimeout(700);
ok('conversie: periode 7 dagen gekozen en onthouden', await page.evaluate(() => document.querySelector('#cvDagen').value === '7' && localStorage.getItem('ksConversieDagen') === '7' && /7 dagen/.test(document.querySelector('#conversiePanel .muted').textContent)));
await page.selectOption('#cvDagen', '30');
await page.waitForTimeout(700);
// Briefing maken via de knop (zonder AI-sleutel = feiten-tekst) → tekst verschijnt.
await page.click('#cvBriefingBtn');
await page.waitForFunction(() => !!document.querySelector('#conversiePanel .cv-briefing-tekst'), null, { timeout: 15000 });
ok('conversie: briefing verschijnt na "Nieuwe analyse"', await page.evaluate(() => /Conversie laatste 30 dagen/.test(document.querySelector('#conversiePanel .cv-briefing-tekst').textContent)));
// FILTERS + excl. btw (2 okt 2026): filterbalk boven Cijfers, werkt op conversie én omzet.
const cfInfo = await page.evaluate(() => ({
  balk: !!document.querySelector('#cijfersFilter #cfMonteur') && !!document.querySelector('#cfBron') && !!document.querySelector('#cfWebsite'),
  eigen: [...document.querySelectorAll('#cfBron option')].some((o) => o.value === 'eigen'),
  btw: /Omzet deze maand\s*excl\. btw/.test(document.querySelector('#financePanel').textContent),
}));
ok('cijfers: filterbalk (monteur/bron/website) + "excl. btw" op de omzettegel', cfInfo.balk && cfInfo.eigen && cfInfo.btw, JSON.stringify(cfInfo));
await page.selectOption('#cfBron', 'eigen');
await page.waitForFunction(() => /eigen leads/.test((document.querySelector('.cf-actief') || {}).textContent || ''), null, { timeout: 8000 });
ok('cijfers: filter "eigen leads" toont uitleg + "gefilterd" bij conversie en omzet, onthouden', await page.evaluate(() => document.querySelectorAll('.cf-chip').length >= 2 && JSON.parse(localStorage.getItem('ksCijfersFilter')).bron === 'eigen'));
await page.click('#cfWis');
await page.waitForFunction(() => !document.querySelector('.cf-actief'), null, { timeout: 8000 });
ok('cijfers: "Wis filters" zet alles terug', await page.evaluate(() => document.querySelector('#cfBron').value === '' && !document.querySelector('.cf-chip')));
// Mobiel: alles binnen 390 px, tabellen schuiven zelf (geen paginabrede overflow).
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
const cvMob = await page.evaluate(() => {
  const p = document.querySelector('#conversiePanel');
  const r = p.getBoundingClientRect();
  const kolommen = [...document.querySelectorAll('#conversiePanel .cv-grid .cv-card')];
  const a = kolommen[0].getBoundingClientRect(); const b = kolommen[1].getBoundingClientRect();
  return { breedteOk: r.right <= window.innerWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1, onderElkaar: b.top >= a.bottom - 1 };
});
ok('conversie: mobiel binnen het scherm, kaarten onder elkaar', cvMob.breedteOk && cvMob.onderElkaar, JSON.stringify(cvMob));
await page.setViewportSize({ width: 1280, height: 800 });
noErr('Cijfers (conversie)');

// 10) Start-pagina: AI-dagoverzicht rendert (feiten-fallback zonder AI-sleutel)
clear();
await page.evaluate(() => goView('overview'));
// Wacht op antwoord (16 sep 2026): appje van bekende klant zonder antwoord → blok met
// kaart-context en Afgehandeld-knop; klikken haalt het item weg zonder JS-fout.
await page.evaluate(async () => {
  const post = (p, b, tok) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { 'x-ingest-token': 'test123' } : {}) }, body: JSON.stringify(b) }).then((r) => r.json());
  const c = await post('/api/customers', { name: 'Wachtblok Klant', phone: '0611000077' });
  await post('/api/orders', { customerId: c.id, title: 'Rhenen — wachtblok kaart', status: 'nieuw' });
  await post('/api/ingest/whatsapp', { from: '31611000077@c.us', fromPhone: '31611000077', name: 'Wachtblok Klant', body: 'Wanneer komt de monteur?\nTelefoon: +31611000077', externalId: 'wa-wachtblok-1' }, true);
});
// ROBUUST (28 sep 2026): het blok kijkt standaard naar >2 uur, dus een gelijktijdige
// verversing van Start (pulse na de POSTs hierboven) tekende het met de échte, lege
// lijst weer leeg — de test faalde soms. Nu staat de "alles"-variant (uren=0) aan
// zolang deze sectie loopt, óók voor de verversing van Start zelf, en wachten we op
// het blok i.p.v. een vaste pauze.
await page.evaluate(async () => {
  window.__origApi = window.api;
  window.api = (p, ...rest) => p.startsWith('/api/chats/onbeantwoord') ? window.__origApi('/api/chats/onbeantwoord?uren=0') : window.__origApi(p, ...rest);
  await vulOnbeantwoord();
});
const wachtZichtbaar = await page.waitForFunction(() => { const t = document.querySelector('#onbeantwoordBlok')?.innerText || ''; return /Wachtblok Klant/.test(t) && /wachtblok kaart/.test(t); }, null, { timeout: 8000 }).then(() => true).catch(() => false);
ok('Wacht-op-antwoord-blok toont het appje mét kaart-context', wachtZichtbaar);
clear();
const wachtVoor = await page.locator('#onbeantwoordBlok li[data-chat]').count();
await page.evaluate(() => { const b = [...document.querySelectorAll('#onbeantwoordBlok .wacht-klaar')].find((x) => /Wachtblok/.test(x.closest('li')?.innerText || '')); b && b.click(); });
await page.waitForFunction(() => !/Wachtblok Klant/.test(document.querySelector('#onbeantwoordBlok')?.innerText || ''), null, { timeout: 5000 }).catch(() => {});
const wachtNa = await page.evaluate(() => fetch('/api/chats/onbeantwoord?uren=0').then((r) => r.json()).then((l) => l.some((x) => /Wachtblok/.test(x.naam))));
await page.evaluate(() => { if (window.__origApi) window.api = window.__origApi; });
ok('Afgehandeld-knop haalt het gesprek uit de lijst (server)', wachtVoor >= 1 && wachtNa === false, `voor=${wachtVoor} naServer=${wachtNa}`);
noErr('Wacht op antwoord');
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
await page.waitForTimeout(1200);
// Instellingen onthoudt de laatst gekozen groep (keuze eigenaar 16 sep).
await page.click('#settingsPanel .sg-chip[data-g="facturen"]');
await page.waitForTimeout(200);
await page.evaluate(() => { state._sgroup = null; });
await page.evaluate(() => loadSettings());
await page.waitForTimeout(1200);
ok('instellingen openen op de laatst gekozen groep (Facturen)', await page.evaluate(() => document.querySelector('#settingsPanel .sg-chip.on')?.dataset.g === 'facturen'));
await page.waitForTimeout(1800);
// HANDTEKENING PER MEDEWERKER (23 sep): blok gevuld met een rij per account + testmail-knop.
await page.click('#settingsPanel .sg-chip[data-g="bericht"]');
await page.waitForFunction(() => document.querySelectorAll('#sigPerUser .sig-user').length > 0, null, { timeout: 8000 });
const sigRij = await page.evaluate(() => ({ rijen: document.querySelectorAll('#sigPerUser .sig-user').length, test: document.querySelectorAll('#sigPerUser .su-test').length, voorbeeld: [...document.querySelectorAll('#sigPerUser .sig-user-tekst')].some((e) => /Met vriendelijke groet/.test(e.textContent)) }));
ok('Instellingen → AI: knop "Test AI-modellen" aanwezig', await page.locator('#testAiModellen').count() === 1);
ok('handtekening per medewerker: rij per account, testmail-knop, voorbeeldtekst', sigRij.rijen >= 2 && sigRij.test === sigRij.rijen && sigRij.voorbeeld, JSON.stringify(sigRij));
await page.click('#settingsPanel .sg-chip[data-g="facturen"]'); // terug naar de groep van de volgende asserties
await page.evaluate(() => loadSettings()); // opnieuw opbouwen → koppelkaartje wordt weer geladen
await page.waitForTimeout(2000);
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
// ZOEKBALK in Berichten (23 sep 2026): filtert lokaal op naam/nummer/opdracht.
{
  const totaal = await page.locator('.chat-item').count();
  await page.fill('#chatZoek', 'zzz-bestaat-niet');
  await page.waitForTimeout(400);
  ok('zoeken op onzin → "Geen gesprek gevonden"', await page.locator('.chat-item').count() === 0 && /Geen gesprek gevonden/.test(await page.locator('#chatList').textContent()));
  await page.fill('#chatZoek', 'browserklant');
  await page.waitForTimeout(400);
  const nu = await page.locator('.chat-item').count();
  ok('zoeken op naam filtert de lijst', nu >= 1 && nu <= totaal, `${nu} van ${totaal}`);
  await page.fill('#chatZoek', '');
  await page.waitForTimeout(400);
  ok('zoekveld leeg → volledige lijst terug', await page.locator('.chat-item').count() === totaal);
  // Zoek-icoon (28 sep 2026): 'search' ontbrak in ICON_PATHS → lege plek in het veld.
  ok('Berichten-zoekveld toont een zoek-icoon', await page.locator('.chat-zoek svg').count() === 1);
}
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
// Maak-knoppen op het bord ZONDER zijwaarts scrollen in beeld (14 sep: de monteur
// zag "Plak opdracht" nooit — hij stond helemaal rechts in de schuivende rij).
await page.evaluate(() => goView('board'));
await page.waitForTimeout(1000);
{
  // Kopbalk op de telefoon: inhoud + wat lucht, niet een derde van het scherm (was 222 px).
  const kop = await page.evaluate(() => document.querySelector('.sidebar')?.getBoundingClientRect().height);
  ok('mobiel: kopbalk is compact (< 90 px)', typeof kop === 'number' && kop < 90, String(kop));
  ok('mobiel: Telefoon/Status-scan/Inklappen staan niet in de kop, Inklappen staat onderaan', await page.locator('#phoneOrderBtn').isHidden() && await page.locator('#digestBtn').isHidden() && await page.locator('#collapseBtn').isHidden() && await page.locator('#collapseBtnFoot').isVisible());
  const zoek = await page.locator('#boardSearch').boundingBox();
  ok('mobiel: zoekveld op het bord staat zonder scrollen in beeld', !!zoek && zoek.x >= 0 && zoek.x + zoek.width <= 390 && zoek.y < 844, JSON.stringify(zoek));
  const pb = await page.locator('#pasteOrderBtn').boundingBox();
  const nb = await page.locator('#newOrderBtn').boundingBox();
  ok('mobiel: "Plak opdracht" en "+ Nieuwe opdracht" staan zonder scrollen in beeld', !!pb && !!nb && pb.x >= 0 && pb.x + pb.width <= 390 && nb.x >= 0 && nb.x + nb.width <= 390, JSON.stringify({ pb, nb }));
}
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
// STRENG (18 aug, melding eigenaar): de verstuurbalk moet ÍN het scherm staan zonder
// scrollen — de statusbalk duwde hem er op de telefoon onderuit. Eerst de asynchrone
// statusbalk laten laden, dan meten tegen de viewport-hoogte.
await page.waitForTimeout(800);
const cpBox = await page.evaluate(() => { const el = document.querySelector('#cpText'); if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: window.innerHeight }; });
ok('mobiel: verstuur-balk bereikbaar', await page.locator('#cpText').isVisible());
ok('mobiel: verstuur-balk staat ZONDER scrollen in beeld', !!cpBox && cpBox.bottom <= cpBox.vh && cpBox.top >= 0, JSON.stringify(cpBox));
ok('mobiel: statusbalk verborgen zolang een gesprek open is', await page.evaluate(() => { const b = document.querySelector('#chatStatusBar'); return !b || b.hidden || b.offsetHeight === 0; }));
// 28 sep 2026 (audit): de pagina was 24 px hoger dan het scherm (gesprekskop schoof onder
// de kopbalk) en een melding viel precies over de verstuurbalk.
{
  await page.evaluate(() => toast('Testmelding boven de verstuurbalk'));
  await page.waitForTimeout(300); // inschuif-animatie (10 px) laten aflopen
  const chatMob = await page.evaluate(() => {
    const t = document.querySelector('#toast').getBoundingClientRect();
    const sb = document.querySelector('.cp-send').getBoundingClientRect();
    return { docH: document.documentElement.scrollHeight, vh: window.innerHeight, overlap: t.bottom > sb.top && t.top < sb.bottom, t: [t.top, t.bottom], s: [sb.top, sb.bottom] };
  });
  ok('mobiel: Berichten-scherm schuift niet mee (pagina niet hoger dan het scherm)', chatMob.docH <= chatMob.vh + 1, JSON.stringify(chatMob));
  ok('mobiel: melding valt niet over de verstuurbalk', !chatMob.overlap, JSON.stringify(chatMob));
  await page.evaluate(() => { document.querySelector('#toast').hidden = true; });
}
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

// ---------- Taken-module (8 sep 2026) ----------
// Twee kolommen (Zakelijk/Privé), snel-toevoegen, afvinken, filterchips, deadline-
// blok, Vandaag-blok op Start. Geen AI, geen lead-instroom. Faalt bij elke JS-fout.
clear();
await page.evaluate(() => goView('taken'));
await page.waitForTimeout(1200);
ok('taken: scherm zichtbaar met twee kolommen', await page.locator('#view-taken .tk-kolom').count() === 2);
ok('taken: tellers open/bezig/urgent/klaar', await page.locator('#view-taken .tk-tile').count() === 4);
ok('taken: starttaken staan op het bord', await page.locator('#view-taken .tk-kaart').count() >= 11);
ok('taken: deadline-blok met Youssef-taak', (await page.locator('#view-taken .tk-dl-item').allTextContents()).some((t) => /Youssef/.test(t)));
ok('taken: zeven filterchips', await page.locator('#view-taken .tk-chip').count() === 7);
await page.fill('#tkSnelTitel', 'Browsertest taak');
await page.press('#tkSnelTitel', 'Enter');
await page.waitForTimeout(1000);
const tkNieuw = page.locator('#view-taken .tk-kaart', { hasText: 'Browsertest taak' });
ok('taken: snel toevoegen (Enter) plaatst de taak in Zakelijk', await tkNieuw.count() === 1 && await page.locator('#view-taken .tk-kolom-zakelijk .tk-kaart', { hasText: 'Browsertest taak' }).count() === 1);
// Audit 28 sep 2026: het veld is daarna leeg, dus een tweede Enter maakt geen dubbele taak.
ok('taken: invoerveld is leeg na toevoegen', await page.inputValue('#tkSnelTitel') === '');
await page.press('#tkSnelTitel', 'Enter');
await page.waitForTimeout(600);
ok('taken: tweede Enter maakt geen dubbele taak', await tkNieuw.count() === 1);
const openVoor = Number(await page.locator('#view-taken .tk-tile').first().locator('.num').textContent());
await tkNieuw.locator('.tk-toggle').check();
await page.waitForTimeout(1000);
ok('taken: afvinken vervaagt de kaart en zakt onderaan', await page.locator('#view-taken .tk-kaart.tk-klaar', { hasText: 'Browsertest taak' }).count() === 1);
const openNa = Number(await page.locator('#view-taken .tk-tile').first().locator('.num').textContent());
ok('taken: teller open gaat één omlaag', openNa === openVoor - 1, `${openVoor} -> ${openNa}`);
await page.click('#view-taken .tk-chip[data-f="prive"]');
await page.waitForTimeout(300);
ok('taken: filter Privé maakt de Zakelijk-kolom leeg', await page.locator('#view-taken .tk-kolom-zakelijk .tk-kaart').count() === 0 && await page.locator('#view-taken .tk-kolom-prive .tk-kaart').count() >= 5);
await page.click('#view-taken .tk-chip[data-f="alles"]');
await page.waitForTimeout(300);
await page.locator('#view-taken .tk-kaart', { hasText: 'Browsertest taak' }).locator('.tk-body').click();
await page.waitForTimeout(500);
ok('taken: bewerkscherm opent met titel', await page.locator('#tk-titel').inputValue() === 'Browsertest taak');
// Toewijzen met vinkjes (14 sep): kantoor-accounts als vinkjes, jijzelf gemarkeerd met "(ik)".
ok('taken: toewijzen = vinkjes per kantoor-account, jijzelf "(ik)"', await page.locator('.tk-wie-opt').count() >= 1 && /\(ik\)/.test(await page.locator('#tk-wie-lijst').textContent()));
await page.locator('.tk-wie-opt').first().check();
await page.click('#tk-save');
await page.waitForTimeout(1000);
ok('taken: aangevinkte naam staat als label op de kaart', (await page.locator('#view-taken .tk-kaart', { hasText: 'Browsertest taak' }).locator('.tk-wie').textContent()).includes('Beheerder'));
await page.locator('#view-taken .tk-kaart', { hasText: 'Browsertest taak' }).locator('.tk-body').click();
await page.waitForTimeout(500);
ok('taken: deelblok verborgen bij een zakelijke taak', await page.locator('#tk-deelblok').isHidden());
await page.selectOption('#tk-cat', 'prive');
await page.waitForTimeout(200);
ok('taken: deelblok verschijnt zodra je Privé kiest', await page.locator('#tk-deelblok').isVisible());
await page.click('#tk-cancel');
await page.waitForTimeout(300);
await page.locator('#view-taken .tk-kolom-prive .tk-kaart').first().locator('.tk-body').click();
await page.waitForTimeout(500);
ok('taken: privé-taak toont "Delen met (optioneel)"', await page.locator('#tk-deelblok').isVisible() && /Delen met/.test(await page.locator('#tk-deelblok').textContent()));
// Bijlage écht uploaden via het bestandsveld (1x1 PNG), tegel + regel + teller op de kaart.
ok('taken: knop + Toevoegen (bijlages) zichtbaar', await page.locator('#tk-addfile').isVisible());
const tkPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
await page.setInputFiles('#tk-fileinput', { name: 'bonnetje.png', mimeType: 'image/png', buffer: tkPng });
await page.waitForTimeout(1500);
ok('taken: bijlage staat als tegel + regel in het scherm', await page.locator('#tk-attwrap .att').count() === 1 && await page.locator('#tk-attwrap .tk-att-regel').count() === 1);
ok('taken: bijlage-teller in de kop', (await page.locator('#tk-attcount').textContent()).trim() === '(1)');
await page.click('#tk-cancel');
await page.waitForTimeout(600);
ok('taken: kaart toont paperclip-teller', await page.locator('#view-taken .tk-kolom-prive .tk-kaart').first().locator('.tk-bijlage').count() === 1);
// Status bezig: één tik op "Start" kleurt de hele kaart blauw; nog een tik zet 'm terug.
const eersteZak = page.locator('#view-taken .tk-kolom-zakelijk .tk-kaart:not(.tk-klaar)').first();
const eersteZakId = await eersteZak.getAttribute('data-id');
await eersteZak.locator('.tk-status-knop').click();
await page.waitForTimeout(1000);
const bezigKaart = page.locator(`#view-taken .tk-kaart[data-id="${eersteZakId}"]`);
ok('taken: Start-knop zet de kaart op bezig (blauwe kaart)', await bezigKaart.evaluate((el) => el.classList.contains('tk-bezig')));
ok('taken: bezig-kaart heeft zichtbaar andere achtergrond dan een open kaart', await page.evaluate((id) => {
  const b = document.querySelector(`.tk-kaart[data-id="${id}"]`); const o = document.querySelector('.tk-kaart:not(.tk-bezig):not(.tk-klaar)');
  return !!b && !!o && getComputedStyle(b).backgroundColor !== getComputedStyle(o).backgroundColor;
}, eersteZakId));
ok('taken: teller bezig = 1', (await page.locator('#view-taken .tk-tile-bezig .num').textContent()).trim() === '1');
await bezigKaart.locator('.tk-status-knop').click();
await page.waitForTimeout(1000);
ok('taken: nog een tik → terug naar open', !(await page.locator(`#view-taken .tk-kaart[data-id="${eersteZakId}"]`).evaluate((el) => el.classList.contains('tk-bezig'))));
// Sorteren: keuzemenu + echt slepen met de muis (pointer events) binnen de kolom.
ok('taken: sorteermenu met 4 opties', await page.locator('#tkSorteer option').count() === 4 && await page.locator('#tkSorteer').inputValue() === 'slim');
const openZak = page.locator('#view-taken .tk-kolom-zakelijk .tk-kaart:not(.tk-klaar)');
const idA = await openZak.nth(0).getAttribute('data-id');
const idB = await openZak.nth(1).getAttribute('data-id');
const gripB = openZak.nth(1).locator('.tk-grip');
const gb = await gripB.boundingBox(); const ka = await openZak.nth(0).boundingBox();
await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2 - ((gb.y - ka.y + 10) * i) / 8);
await page.mouse.up();
await page.waitForTimeout(1200);
const naSleep = await page.locator('#view-taken .tk-kolom-zakelijk .tk-kaart:not(.tk-klaar)').evaluateAll((els) => els.map((e) => e.dataset.id));
ok('taken: slepen zet kaart B boven kaart A', naSleep[0] === idB && naSleep[1] === idA, JSON.stringify([idA, idB, naSleep.slice(0, 2)]));
ok('taken: na slepen staat sortering op "Eigen volgorde"', await page.locator('#tkSorteer').inputValue() === 'handmatig');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.evaluate(() => goView('taken'));
await page.waitForTimeout(1200);
const naHerlaad = await page.locator('#view-taken .tk-kolom-zakelijk .tk-kaart:not(.tk-klaar)').evaluateAll((els) => els.map((e) => e.dataset.id));
ok('taken: eigen volgorde blijft na herladen (server + onthouden keuze)', naHerlaad[0] === idB && await page.locator('#tkSorteer').inputValue() === 'handmatig', JSON.stringify(naHerlaad.slice(0, 2)));
await page.selectOption('#tkSorteer', 'slim');
await page.waitForTimeout(1000);
ok('taken: terug naar Slim herstelt de urgentie-volgorde', (await page.locator('#view-taken .tk-kolom-zakelijk .tk-kaart:not(.tk-klaar)').first().getAttribute('data-id')) === idA);
noErr('Taken-scherm');
// Vandaag-blok op Start + badge in de zijbalk.
await page.evaluate(() => goView('overview'));
await page.waitForTimeout(1500);
const tkVandaag = await page.locator('#takenVandaagBlok li[data-taak]').count();
ok('taken: Vandaag-blok op Start gevuld (max 5)', tkVandaag > 0 && tkVandaag <= 5, String(tkVandaag));
ok('taken: menu-badge toont aantal', !(await page.locator('#takenBadge').isHidden()));
// Mobiel: één kolom, menu-item aanwezig.
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => goView('taken'));
await page.waitForTimeout(1000);
const tkMob = await page.evaluate(() => { const k = document.querySelectorAll('#view-taken .tk-kolom'); if (k.length < 2) return null; const a = k[0].getBoundingClientRect(), b = k[1].getBoundingClientRect(); return { onderElkaar: b.top >= a.bottom - 1, breedte: a.right <= window.innerWidth + 1 }; });
ok('taken: mobiel één kolom onder elkaar, binnen het scherm', !!tkMob && tkMob.onderElkaar && tkMob.breedte, JSON.stringify(tkMob));
await page.setViewportSize({ width: 1280, height: 800 });
noErr('Taken (mobiel)');

// ---------- Bord: slepen met de muis (13 sep 2026, eigen pointer-implementatie) ----------
// Klacht: "elke keer als ik een kaart sleep loopt hij vast". Test: echte muisbeweging,
// halverwege wordt het bord door een 'collega-wijziging' ververst (zoals de pulse
// doet) — het slepen moet gewoon doorgaan, de kaart komt in de nieuwe kolom, en de
// sleepvlag is daarna vrij. Daarna: klikken opent de kaart nog steeds.
clear();
await page.setViewportSize({ width: 1366, height: 820 });
await page.evaluate(() => goView('board'));
await page.waitForFunction(() => document.querySelectorAll('#board .card').length > 0);
await page.waitForTimeout(600);
{
  const bron = page.locator('#board .column[data-status="open"] .card').first();
  if (!(await bron.count())) {
    await page.evaluate(async () => { await fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ customerName: 'Sleep Klant', customerPhone: '0612340099', title: 'Rhenen — sleeptest', status: 'open' }) }); await loadBoard(); });
    await page.waitForTimeout(600);
  }
  const kaart = page.locator('#board .column[data-status="open"] .card').first();
  const sleepId = await kaart.getAttribute('data-id');
  const b = await kaart.boundingBox();
  const doel = await page.locator('#board .column[data-status="nieuw"]').first().boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + 30);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 12, b.y + 42, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2 + 80, b.y + 80, { steps: 6 });
  {
    // De kopie moet ÉCHT bij de muis staan (browser-audit 16 sep: hij stond op y=1499
    // door een CSS-specificiteitsfout — position:fixed werd door .card overschreven).
    const g = await page.evaluate(() => { const el = document.querySelector('.board-drag-ghost'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, pos: getComputedStyle(el).position }; });
    const mx = b.x + b.width / 2 + 80; const my = b.y + 80;
    ok('bord: sleep-kopie staat vast onder de muis (position fixed, < 120 px afstand)', !!g && g.pos === 'fixed' && mx >= g.x - 120 && mx <= g.x + g.w + 120 && my >= g.y - 120 && my <= g.y + g.h + 120, JSON.stringify({ g, mx, my }));
  }
  ok('bord: slepen gestart (kopie volgt de muis, bron vervaagd)', await page.evaluate((id) => window._dragging === true && !!document.querySelector('.board-drag-ghost') && document.querySelector(`.card[data-id="${id}"]`)?.classList.contains('drag-src'), sleepId));
  // Collega wijzigt een andere kaart -> bord zou herbouwd worden; moet nu uitgesteld zijn.
  await page.evaluate(async () => { const o = state.orders.find((x) => x.status !== 'open') || state.orders[1]; await fetch(`/api/orders/${o.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: o.title + ' (gewijzigd)' }) }); await loadBoard(); });
  await page.waitForTimeout(300);
  ok('bord: verversing tijdens slepen wordt uitgesteld (kaart blijft bestaan)', await page.evaluate((id) => window._boardRenderNaSleep === true && !!document.querySelector(`.card[data-id="${id}"].drag-src`), sleepId));
  await page.mouse.move(doel.x + doel.width / 2, doel.y + 60, { steps: 10 });
  await page.waitForTimeout(150);
  ok('bord: doelkolom licht op', await page.locator('#board .column[data-status="nieuw"].drag-over').count() === 1);
  await page.mouse.up();
  await page.waitForTimeout(2000);
  const naSleepBord = await page.evaluate((id) => ({ dragging: window._dragging, ghost: !!document.querySelector('.board-drag-ghost'), inNieuw: !!document.querySelector(`#board .column[data-status="nieuw"] .card[data-id="${id}"]`), status: state.orders.find((o) => o.id === id)?.status, pending: !!window._boardRenderNaSleep }), sleepId);
  ok('bord: kaart staat in de nieuwe kolom en de sleepvlag is vrij', naSleepBord.inNieuw && naSleepBord.status === 'nieuw' && naSleepBord.dragging === false && !naSleepBord.ghost && !naSleepBord.pending, JSON.stringify(naSleepBord));
  const serverStatus = await page.evaluate(async (id) => (await (await fetch('/api/orders')).json()).find((o) => o.id === id)?.status, sleepId);
  ok('bord: status ook op de server gewijzigd', serverStatus === 'nieuw', serverStatus);
  ok('bord: de uitgestelde collega-wijziging is na het slepen alsnog getekend', (await page.locator('#board .card:has-text("(gewijzigd)")').count()) === 1);
  // Loslaten buiten een kolom: niets gebeurt, niets blijft hangen.
  const k2 = page.locator(`#board .card[data-id="${sleepId}"]`); const b2 = await k2.boundingBox();
  await page.mouse.move(b2.x + 40, b2.y + 30); await page.mouse.down(); await page.mouse.move(b2.x + 60, b2.y + 60, { steps: 4 }); await page.mouse.move(700, 60, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(800);
  ok('bord: loslaten buiten een kolom = geen wijziging, niets blijft hangen', await page.evaluate((id) => window._dragging === false && !document.querySelector('.board-drag-ghost') && !document.querySelector('.card.drag-src') && state.orders.find((o) => o.id === id)?.status === 'nieuw', sleepId));
  // Gewone klik opent nog steeds de kaart.
  await k2.click();
  await page.waitForTimeout(800);
  ok('bord: gewone klik opent de kaart', await page.locator('#f-title').count() === 1);
  await page.evaluate(() => closeModal());
  await page.waitForTimeout(300);
}
noErr('Bord slepen');

// ---------- Bord: per kaart bijwerken + rustig slepen (28 sep 2026, audit cluster C) ----------
// Eén gewijzigde kaart liet het HELE bord opnieuw opbouwen (alle kaarten nieuwe
// elementen, rode tellers poppen opnieuw, hover weg). Nu moeten ongewijzigde kaarten
// exact hetzelfde element blijven. En een versleepte kaart wordt één keer getekend en
// springt niet meer na het loslaten.
clear();
await page.setViewportSize({ width: 1366, height: 820 });
await page.evaluate(() => goView('board'));
await page.waitForFunction(() => document.querySelectorAll('#board .card').length > 1);
await page.waitForTimeout(500);
{
  const r = await page.evaluate(async () => {
    const kaarten = [...document.querySelectorAll('#board .card[data-id]')];
    const a = kaarten[0], b = kaarten[1];
    window._probeB = b; window._probeA = a;
    const o = state.orders.find((x) => x.id === a.dataset.id);
    await fetch(`/api/orders/${o.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: o.title + ' (diff)' }) });
    await loadBoard();
    const bNa = document.querySelector(`#board .card[data-id="${b.dataset.id}"]`);
    const aNa = document.querySelector(`#board .card[data-id="${a.dataset.id}"]`);
    return { bZelfde: bNa === window._probeB, aNieuw: !!aNa && aNa !== window._probeA && aNa.textContent.includes('(diff)'), kolommenBlijven: !!document.querySelector('#board .column-cards') };
  });
  ok('bord: wijziging van één kaart laat de ANDERE kaart-elementen staan (zelfde DOM-node)', r.bZelfde, JSON.stringify(r));
  ok('bord: de gewijzigde kaart zelf is wél bijgewerkt', r.aNieuw, JSON.stringify(r));
  // Klik werkt nog op een hergebruikte kaart (gedelegeerde luisteraar op #board).
  await page.evaluate(() => window._probeB.click());
  await page.waitForTimeout(700);
  ok('bord: klik op een hergebruikte kaart opent hem (gedelegeerd)', await page.locator('#f-title').count() === 1);
  await page.evaluate(() => closeModal());
  await page.waitForTimeout(300);
  // Pop-animatie alleen bij een echte stijging: na een verversing zonder nieuwe
  // berichten loopt er geen pop-in op de tellers.
  const pops = await page.evaluate(async () => { _lastBoardHtml = ''; renderBoard(); return document.querySelectorAll('#board .title-count.pop').length; });
  ok('bord: tellers poppen niet opnieuw bij een verversing zonder nieuwe berichten', pops === 0, String(pops));

  // Slepen: kaart wordt één keer getekend en blijft daarna op zijn plek staan.
  const bron = page.locator('#board .column[data-status="nieuw"] .card').first();
  if (await bron.count()) {
    const id = await bron.getAttribute('data-id');
    await page.evaluate((id) => {
      window._sleepToevoegingen = 0;
      window._sleepObs = new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.matches?.(`.card[data-id="${id}"]`) && n.closest('#board')) window._sleepToevoegingen++; });
      window._sleepObs.observe(document.querySelector('#board'), { childList: true, subtree: true });
    }, id);
    const bb = await bron.boundingBox();
    const doel = await page.locator('#board .column[data-status="open"]').first().boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + 30);
    await page.mouse.down();
    await page.mouse.move(bb.x + bb.width / 2 + 20, bb.y + 50, { steps: 4 });
    await page.mouse.move(doel.x + doel.width / 2, doel.y + 80, { steps: 8 });
    // Kopie zonder overgang: staat direct onder de muis (geen ~120 ms naloop).
    const naloop = await page.evaluate(() => getComputedStyle(document.querySelector('.board-drag-ghost')).transitionDuration);
    ok('bord: sleep-kopie heeft geen CSS-overgang (volgt de muis direct)', /^0s(, 0s)*$/.test(naloop), naloop);
    await page.mouse.up();
    await page.waitForTimeout(60);
    const plek1 = await page.evaluate((id) => { const el = document.querySelector(`#board .column[data-status="open"] .card[data-id="${id}"]`); return el ? [...el.parentNode.children].indexOf(el) : -1; }, id);
    await page.waitForTimeout(1200);
    const plek2 = await page.evaluate((id) => { const el = document.querySelector(`#board .column[data-status="open"] .card[data-id="${id}"]`); window._sleepObs.disconnect(); return el ? [...el.parentNode.children].indexOf(el) : -1; }, id);
    const keer = await page.evaluate(() => window._sleepToevoegingen);
    ok('bord: versleepte kaart staat meteen bovenaan de doelkolom en springt niet meer', plek1 === 0 && plek2 === 0, JSON.stringify({ plek1, plek2 }));
    ok('bord: versleepte kaart wordt één keer getekend (geen tweede herbouw)', keer === 1, String(keer));
  } else {
    ok('sleep-tekentest overgeslagen (geen kaart in Nieuw)', true);
  }
}
noErr('Bord per kaart bijwerken');

// ---------- Werkbon laat geen luisteraars op het document achter (28 sep 2026, audit) ----------
// Voorheen kwamen er bij ELK openen mousemove/mouseup/touchmove(niet-passief)/touchend
// op document bij die nooit weggingen. Nu alleen tijdens het tekenen.
clear();
{
  const cdp = await page.context().newCDPSession(page);
  const tel = async () => { const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' }); const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId }); const c = {}; for (const l of listeners) c[l.type] = (c[l.type] || 0) + 1; return c; };
  const voor = await tel();
  for (let i = 0; i < 3; i++) { await page.evaluate(() => openWerkbonModal(state.orders[0])); await page.waitForTimeout(300); await page.evaluate(() => closeModal()); await page.waitForTimeout(150); }
  await page.evaluate(() => openWerkbonModal(state.orders[0]));
  await page.waitForTimeout(400);
  const cv = await page.locator('#wb-sign').boundingBox();
  await page.mouse.move(cv.x + 20, cv.y + 20); await page.mouse.down();
  const tijdens = await tel();
  // Lijn loopt door buiten het vak (bewegen op het document) en stopt bij loslaten.
  await page.mouse.move(cv.x + 120, cv.y + 60, { steps: 5 }); await page.mouse.move(cv.x + cv.width + 30, cv.y + 60, { steps: 3 }); await page.mouse.up();
  const getekend = await page.evaluate(() => { const c = document.querySelector('#wb-sign'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
  const na = await tel();
  await page.evaluate(() => closeModal());
  const k = (o, t) => o[t] || 0;
  ok('werkbon: 4x openen laat GEEN touchmove/mousemove op het document achter', k(na, 'touchmove') === k(voor, 'touchmove') && k(na, 'mousemove') === k(voor, 'mousemove') && k(na, 'touchend') === k(voor, 'touchend'), JSON.stringify({ voor, na }));
  ok('werkbon: tijdens het tekenen wél document-luisteraars, en tekenen werkt', k(tijdens, 'mousemove') === k(voor, 'mousemove') + 1 && getekend > 50, JSON.stringify({ tijdens: k(tijdens, 'mousemove'), getekend }));
  await cdp.detach();
}
noErr('Werkbon-luisteraars');

// ---------- Mobiel: plakkende balken, inbox-velden, toast (28 sep 2026, audit mobiel) ----------
clear();
await page.setViewportSize({ width: 390, height: 844 });
{
  await page.evaluate(() => goView('settings'));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForTimeout(300);
  const sg = await page.evaluate(() => { const n = document.querySelector('.sg-nav'); return n && { top: Math.round(n.getBoundingClientRect().top), y: Math.round(scrollY) }; });
  ok('mobiel: Instellingen-tabbladen plakken onder de kopbalk (.content is geen scroll-container meer)', !!sg && (sg.y < 100 || (sg.top >= 40 && sg.top <= 60)), JSON.stringify(sg));
  ok('mobiel: geen horizontale paginascroll door overflow-x: clip', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await page.evaluate(() => goView('inbox'));
  await page.waitForTimeout(1500);
  const iv = await page.evaluate(() => { const v = document.querySelector('.review .r-velden'); return v ? getComputedStyle(v).display : 'geen-items'; });
  ok('mobiel: inbox-correctievelden staan in twee kolommen (grid)', iv === 'grid' || iv === 'geen-items', iv);
  await page.evaluate(() => goView('board'));
  await page.waitForTimeout(1200);
  const toastL = await page.evaluate(async () => { toast('Testmelding'); await new Promise((r) => setTimeout(r, 30)); return Math.round(document.querySelector('.toast').getBoundingClientRect().left); });
  ok('mobiel: melding staat vanaf het begin binnen beeld (eigen animatie)', toastL >= 0, String(toastL));
  ok('mobiel: kolom-tabs zijn plakkend', await page.evaluate(() => getComputedStyle(document.querySelector('#boardTabs')).position === 'sticky'));
}
await page.setViewportSize({ width: 1366, height: 820 });
noErr('Mobiel plakkende balken');

// ---------- Venster openen verschuift de achtergrond niet (28 sep 2026, audit pc) ----------
// Headless Chromium verbergt scrollbalken standaard; dit eigen browsertje toont ze (zoals
// Windows), anders is de 15 px-sprong niet te meten.
{
  const sb = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'], ignoreDefaultArgs: ['--hide-scrollbars'] });
  const sp = await sb.newPage({ viewport: { width: 1440, height: 900 } });
  await sp.goto(BASE + '/login.html', { waitUntil: 'networkidle' });
  await sp.fill('input[type=email], input[name=email], #email', 'admin@keyservice.nl');
  await sp.fill('input[type=password], input[name=password], #password', 'admin123');
  await Promise.all([sp.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), sp.click('button[type=submit], button')]);
  await sp.waitForTimeout(1500);
  await sp.evaluate(() => goView('board'));
  await sp.waitForFunction(() => document.querySelectorAll('#board .card').length > 0);
  await sp.waitForTimeout(500);
  const meet = () => sp.evaluate(() => { const c = document.querySelectorAll('#board .column')[2] || document.querySelector('#board .column'); const r = c.getBoundingClientRect(); return { x: r.x, w: r.width, cw: document.documentElement.clientWidth }; });
  const voor = await meet();
  await sp.evaluate(() => openOrderModal(document.querySelector('#board .card').dataset.id));
  await sp.waitForTimeout(500);
  const open = await meet();
  await sp.evaluate(() => closeModal());
  await sp.waitForTimeout(300);
  const na = await meet();
  ok('venster openen op 1440 px: bord verschuift NIET horizontaal (scrollbar-gutter)', Math.abs(open.x - voor.x) < 0.5 && Math.abs(open.w - voor.w) < 0.5 && Math.abs(na.x - voor.x) < 0.5, JSON.stringify({ voor, open, na }));
  await sb.close();
}

// Afspraak annuleren = één venster met vinkje (audit 16 sep), geen dubbele systeem-popup.
{
  clear();
  const apptId = await page.evaluate(async () => {
    const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    const c = await post('/api/customers', { name: 'Afspraak Klant', phone: '0611000055', email: 'afspraak@example.nl' });
    const o = await post('/api/orders', { customerId: c.id, title: 'Rhenen — afspraak annuleren test', status: 'open', appointmentAt: '2030-01-10T10:00' });
    return o.id;
  });
  await page.evaluate(async (id) => { state.orders = await fetch('/api/orders').then((r) => r.json()); openOrderModal(id); }, apptId);
  await page.waitForTimeout(600);
  ok('kaart met afspraak toont "Afspraak annuleren"', await page.locator('#f-cancel-appt').count() === 1);
  await page.click('#f-cancel-appt');
  await page.waitForTimeout(400);
  ok('annuleren opent één eigen venster met vinkje voor het klantbericht', await page.locator('#ca-ok').count() === 1 && await page.locator('#ca-notify').count() === 1);
  await page.evaluate(() => { document.querySelector('#ca-notify').checked = false; });
  await page.click('#ca-ok');
  await page.waitForTimeout(900);
  const zonderAfspraak = await page.evaluate((id) => fetch('/api/orders').then((r) => r.json()).then((os) => { const o = os.find((x) => x.id === id); return o && !o.appointmentAt; }), apptId);
  ok('afspraak is weg, kaart blijft', zonderAfspraak === true);
  noErr('Afspraak annuleren');
}

// 1-KLIK AFWIJZEN in de inbox (keuze eigenaar 16 sep): direct weg, "Ongedaan maken"
// zet terug, "Reden toevoegen" zet de reden achteraf op de afwijzing.
{
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => fetch('/api/ingest/email', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-token': 'test123' }, body: JSON.stringify({ from: 'afwijs@example.nl', subject: 'Slot voordeur Rhenen', body: 'Kunt u langskomen voor een kapot slot in Rhenen?', externalId: 'br-afwijs-1' }) }));
  await page.waitForTimeout(800);
  await page.evaluate(() => goView('inbox'));
  await page.waitForTimeout(1500);
  const rij = page.locator('#reviewList .review', { hasText: 'afwijs@example.nl' }).first();
  ok('inbox: testbericht staat in de lijst', await rij.count() === 1);
  // Mobiel: "Accepteer boven drempel" blijft zichtbaar zonder de bulkbalk open te klappen (18 sep).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  ok('mobiel: Accepteer boven drempel + %-keuze direct zichtbaar in de inbox', await page.locator('#bulkApproveBtn').isVisible() && await page.locator('#bulkApprovePct').isVisible() && await page.locator('#bulkRejectBtn').isHidden());
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(400);
  clear();
  await rij.locator('.r-reject').click();
  await page.waitForTimeout(700);
  ok('1-klik afwijzen: melding met Ongedaan maken + Reden toevoegen, geen venster', await page.locator('#tr-undo').count() === 1 && await page.locator('#tr-reason').count() === 1 && await page.locator('#rj-save').count() === 0);
  await page.click('#tr-undo');
  await page.waitForTimeout(900);
  const terug = await page.evaluate(() => fetch('/api/reviews?status=all').then((r) => r.json()).then((d) => (d.items || d).find((x) => /br-afwijs-1|afwijs@example/.test(JSON.stringify(x)))?.status));
  ok('ongedaan maken zet het bericht terug in de wachtrij', terug === 'pending', String(terug));
  await page.waitForTimeout(600);
  const rij2 = page.locator('#reviewList .review', { hasText: 'afwijs@example.nl' }).first();
  await rij2.locator('.r-reject').click();
  await page.waitForTimeout(700);
  await page.click('#tr-reason');
  await page.waitForTimeout(500);
  ok('reden toevoegen opent het redenvenster', await page.locator('#rj-save').count() === 1);
  await page.fill('#rj-note', 'Was een leverancier');
  await page.click('#rj-save');
  await page.waitForTimeout(800);
  const reden = await page.evaluate(() => fetch('/api/reviews?status=all').then((r) => r.json()).then((d) => (d.items || d).find((x) => /br-afwijs-1|afwijs@example/.test(JSON.stringify(x)))));
  ok('reden achteraf opgeslagen op de afwijzing', reden && reden.status === 'rejected' && reden.rejectNote === 'Was een leverancier', JSON.stringify(reden && { s: reden.status, n: reden.rejectNote }));
  noErr('1-klik afwijzen');
}

// ---------- LIVE VERVERSEN (28 sep 2026, audit): Start, bord, inbox, tellers ----------
{
  await page.setViewportSize({ width: 1280, height: 800 });
  const ingest = (n, tekst) => page.evaluate(([n, tekst]) => fetch('/api/ingest/whatsapp', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-token': 'test123' },
    body: JSON.stringify({ name: 'Live Klant ' + n, body: `${tekst}\nTelefoon: +316123${String(n).padStart(5, '0')}`, externalId: 'br-live-' + n }),
  }).then((r) => r.status), [n, tekst]);
  const aanvraag = (n) => `Goedemiddag, het slot van de voordeur is kapot (aanvraag ${n}). Adres Dorpsstraat ${n}, 3911AB Rhenen. Kunt u langskomen?`;
  // a) Na het openen van de app is Start het scherm dat live meeloopt (stond op 'board').
  clear();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const begin = await page.evaluate(() => ({ view: state.view, body: document.body.dataset.view, zicht: !document.querySelector('#view-overview').hidden }));
  ok('na openen: Start is het scherm dat de live-verversing bijhoudt', begin.view === 'overview' && begin.body === 'overview' && begin.zicht, JSON.stringify(begin));
  // b) Zoekveld met resultaten; daarna een achtergrondwijziging (nieuwe aanvraag).
  await page.fill('#globalSearch', 'Browser');
  await page.waitForFunction(() => !document.querySelector('#gsResults').hidden && document.querySelector('#gsResults').textContent.length > 3, null, { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => { document.querySelector('#globalSearch').__merk = 1; const d = document.querySelector('#dayov'); if (d) d.__merk = 1; document.activeElement?.blur(); });
  const kpiTe = () => page.evaluate(() => Number(document.querySelector('#ovKpis .kpi-card[data-go="inbox"] .kpi-num')?.textContent ?? -1));
  const voor = await kpiTe();
  await ingest(1, aanvraag(1));
  const live = await page.waitForFunction((v) => Number(document.querySelector('#ovKpis .kpi-card[data-go="inbox"] .kpi-num')?.textContent ?? -1) > v, voor, { timeout: 15000 }).then(() => true).catch(() => false);
  ok('Start ververst LIVE: "Te controleren" telt een nieuwe aanvraag mee zonder te navigeren', live, `${voor} -> ${await kpiTe()}`);
  const na = await page.evaluate(() => ({ v: document.querySelector('#globalSearch')?.value, zelfde: document.querySelector('#globalSearch')?.__merk === 1, res: !document.querySelector('#gsResults')?.hidden, dag: document.querySelector('#dayov')?.__merk === 1, laden: /laden/i.test(document.querySelector('#dayov-body')?.textContent || '') }));
  ok('Start: zoekveld + zoekresultaten blijven staan bij een achtergrondwijziging', na.v === 'Browser' && na.zelfde && na.res, JSON.stringify(na));
  ok('Start: dagoverzicht wordt daarbij niet opnieuw opgebouwd (geen "laden…")', na.dag && !na.laden, JSON.stringify(na));
  await page.fill('#globalSearch', '');
  noErr('Start live verversen');

  // c) Tellers lopen door met een open venster (stonden stil zolang er een venster open was).
  clear();
  await page.evaluate(() => modal('<h2>Testvenster</h2><p>open</p>'));
  const badgeVoor = await page.evaluate(() => Number(document.querySelector('#inboxBadge')?.textContent || 0));
  await ingest(2, aanvraag(2));
  const badgeLive = await page.waitForFunction((v) => Number(document.querySelector('#inboxBadge')?.textContent || 0) > v, badgeVoor, { timeout: 15000 }).then(() => true).catch(() => false);
  ok('Inbox-teller loopt door terwijl een venster open staat', badgeLive, String(badgeVoor));
  await page.evaluate(() => closeModal());

  // d) Bord ververst terwijl de filter-keuzelijst focus heeft (een <select> houdt op de pc
  //    na het kiezen de focus — dat bevroor het bord tot je ergens anders klikte).
  clear();
  await page.evaluate(() => goView('board'));
  await page.waitForTimeout(1200);
  await page.selectOption('#boardMonteurFilter', '');
  await page.evaluate(() => document.querySelector('#boardMonteurFilter').focus());
  const liveTitel = 'Rhenen — live met filterfocus';
  await page.evaluate(async (t) => {
    const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    const c = await post('/api/customers', { name: 'Live Bord Klant', phone: '0611004455' });
    await post('/api/orders', { customerId: c.id, title: t, status: 'nieuw' });
  }, liveTitel);
  const kaartLive = await page.waitForFunction((t) => [...document.querySelectorAll('#board .card')].some((c) => c.textContent.includes(t)), liveTitel, { timeout: 15000 }).then(() => true).catch(() => false);
  const focusNog = await page.evaluate(() => document.activeElement?.id);
  ok('bord ververst LIVE terwijl de filter-keuzelijst focus heeft', kaartLive && focusNog === 'boardMonteurFilter', `kaart=${kaartLive} focus=${focusNog}`);
  await page.evaluate(() => document.activeElement?.blur());
  noErr('Bord live met filterfocus');

  // e) Inbox: na "Toon meer" blijft de lijst uitgeklapt en blijft je leespositie staan.
  clear();
  const totaal0 = await page.evaluate(() => fetch('/api/reviews?status=pending&limit=1').then((r) => r.json()).then((d) => d.total || 0));
  for (let i = 0, n = 10; i < Math.max(0, 72 - totaal0); i++, n++) await ingest(n, aanvraag(n));
  await page.evaluate(() => goView('inbox'));
  await page.waitForSelector('#inboxMore', { timeout: 8000 }).catch(() => {});
  await page.click('#inboxMore');
  await page.waitForTimeout(1200);
  const rijenVoor = await page.locator('#reviewList .review').count();
  const anker = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#reviewList .review')];
    const el = rows[rows.length - 3]; el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -100);
    return { id: el.dataset.id, top: el.getBoundingClientRect().top, y: window.scrollY };
  });
  await ingest(999, aanvraag(999));
  const nieuwIn = await page.waitForFunction(() => /Live Klant 999/.test(document.querySelector('#reviewList')?.textContent || ''), null, { timeout: 15000 }).then(() => true).catch(() => false);
  const naInbox = await page.evaluate((id) => { const el = document.querySelector(`#reviewList .review[data-id="${id}"]`); return { rijen: document.querySelectorAll('#reviewList .review').length, top: el ? el.getBoundingClientRect().top : null, y: window.scrollY }; }, anker.id);
  ok('Inbox: nieuw bericht komt live binnen', nieuwIn);
  ok('Inbox: na "Toon meer" blijft de lijst uitgeklapt bij een verversing (niet terug naar 60)', rijenVoor > 60 && naInbox.rijen >= rijenVoor, `${rijenVoor} -> ${naInbox.rijen}`);
  ok('Inbox: leespositie blijft staan (zelfde bericht op dezelfde hoogte)', naInbox.top !== null && Math.abs(naInbox.top - anker.top) < 5, JSON.stringify({ anker, naInbox }));
  noErr('Inbox Toon meer + live');
  // Opruimen: de testaanvragen weer uit de wachtrij (volgende secties tellen op de inbox).
  await page.evaluate(async () => {
    const d = await fetch('/api/reviews?status=pending&limit=500').then((r) => r.json());
    const ids = (d.items || []).filter((r) => /^Live Klant/.test(r.message?.sender || '')).map((r) => r.id);
    if (ids.length) await fetch('/api/reviews/bulk-reject', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) });
  });
  await page.evaluate(() => window.scrollTo(0, 0));

  // f) Weekrapport op de telefoon: de tabel blijft binnen de kaart (schuift zelf).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => goView('overview'));
  await page.waitForSelector('#wr-body .wr-tabel', { timeout: 8000 }).catch(() => {});
  const wr = await page.evaluate(() => {
    const vak = document.querySelector('#wr-body .wr-tabel'); const kaart = document.querySelector('#wr-body')?.closest('.info-card');
    if (!vak || !kaart) return null;
    return { vak: vak.getBoundingClientRect().right, kaart: kaart.getBoundingClientRect().right, docW: document.documentElement.scrollWidth, vw: window.innerWidth, schuift: getComputedStyle(vak).overflowX };
  });
  ok('mobiel: weekrapport-tabel valt binnen de kaart en schuift zelf', !!wr && wr.vak <= wr.kaart + 1 && wr.docW <= wr.vw + 1 && wr.schuift === 'auto', JSON.stringify(wr));
  ok('weekrapport: "conversie" heet nu "afgerond t.o.v. nieuw"', await page.evaluate(() => /afgerond t\.o\.v\. nieuw/.test(document.querySelector('#wr-body').textContent) && !/\bconversie\b/i.test([...document.querySelectorAll('#wr-body .wr-kpi span:last-child')].map((x) => x.textContent).join(' '))));
  noErr('Weekrapport mobiel');

  // g) Zelf-herlaad na een deploy: daarna hetzelfde scherm, dezelfde kolom-tab en
  //    (ongeveer) dezelfde scrollhoogte — voorheen sprong elke telefoon terug naar Start.
  clear();
  await page.evaluate(() => goView('board'));
  await page.waitForTimeout(1200);
  const plekVoor = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.board-tab')];
    const tab = tabs[1] || tabs[0]; tab && tab.click();
    window.scrollTo(0, 0);
    const y = Math.min(250, Math.max(0, document.documentElement.scrollHeight - window.innerHeight - 5));
    window.scrollTo(0, y);
    return { tab: state.boardTab, y: window.scrollY };
  });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.evaluate(() => { window._nieuweVersie = true; document.activeElement?.blur(); probeerHerladen(true); }),
  ]);
  await page.waitForFunction(() => typeof state !== 'undefined' && state.view === 'board' && !!document.querySelector('#board .column'), null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  const plekNa = await page.evaluate(() => ({ view: state.view, tab: state.boardTab, y: window.scrollY, zicht: !document.querySelector('#view-board').hidden }));
  ok('na de zelf-herlaad (nieuwe versie) staat hetzelfde scherm + dezelfde kolom-tab terug', plekNa.view === 'board' && plekNa.zicht && plekNa.tab === plekVoor.tab, JSON.stringify({ plekVoor, plekNa }));
  ok('na de zelf-herlaad staat de scrollhoogte terug', Math.abs(plekNa.y - plekVoor.y) < 30, JSON.stringify({ plekVoor, plekNa }));
  noErr('Zelf-herlaad met plek-herstel');
  await page.setViewportSize({ width: 1280, height: 800 });
}

// MONTEUR-NOODROUTE ÉCHT via het scherm (audit 16 sep, kritiek): een gekoppelde
// monteur vult "+ Nieuwe opdracht" in en drukt Opslaan. Voorheen kreeg hij altijd
// "Titel verplicht" (de titel zat achter de kantoor-vlag) en kon hij nooit een kaart maken.
{
  const mSetup = await page.evaluate(async () => {
    const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    const m = await post('/api/monteurs', { name: 'Browser Monteur', phone: '0687000001', waGroup: 'Browser Monteur groep' });
    const u = await post('/api/users', { name: 'Browser Monteur', email: 'bmonteur@keyservice.nl', password: 'monteur123', role: 'monteur', monteurId: m.id });
    return { monteurId: m.id, userId: u.id, error: u.error };
  });
  ok('monteur-account met koppeling aangemaakt', !!mSetup.monteurId && !mSetup.error, JSON.stringify(mSetup));
  const mp = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mErr = [];
  mp.on('pageerror', (e) => mErr.push(e.message));
  await mp.goto(BASE + '/login.html', { waitUntil: 'networkidle' });
  await mp.fill('input[type=email], input[name=email], #email', 'bmonteur@keyservice.nl');
  await mp.fill('input[type=password], input[name=password], #password', 'monteur123');
  await Promise.all([mp.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), mp.click('button[type=submit], button')]);
  await mp.waitForTimeout(2500);
  await mp.evaluate(() => goView('board'));
  await mp.waitForTimeout(1000);
  ok('monteur: "+ Nieuwe opdracht" zichtbaar', await mp.locator('#newOrderBtn').isVisible());
  await mp.click('#newOrderBtn');
  await mp.waitForTimeout(600);
  await mp.fill('#f-title', 'Rhenen — noodroute via scherm');
  await mp.fill('#f-cname', 'Noodroute Klant');
  await mp.fill('#f-cphone', '0611009988');
  await mp.click('#f-save');
  await mp.waitForTimeout(1500);
  const gemaakt = await mp.evaluate(() => fetch('/api/orders').then((r) => r.json()).then((os) => os.find((o) => /noodroute via scherm/.test(o.title))));
  ok('monteur: kaart via het formulier ÉCHT aangemaakt (geen "Titel verplicht")', !!gemaakt, JSON.stringify(gemaakt && gemaakt.title));
  ok('monteur: kaart hangt aan hemzelf + vlag zelf aangemaakt', !!gemaakt && gemaakt.monteurId === mSetup.monteurId && gemaakt.zelfAangemaaktDoorMonteur === true, JSON.stringify(gemaakt && { m: gemaakt.monteurId, z: gemaakt.zelfAangemaaktDoorMonteur }));
  // Kaart MET samenvoeg-suggestie (browser-audit 16 sep, kritiek): de monteur-modal
  // brak op null.onclick en geen enkele knop werkte meer.
  const sugId = await page.evaluate(async (monteurId) => {
    const post = (p, b, tok) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { 'x-ingest-token': 'test123' } : {}) }, body: JSON.stringify(b) }).then((r) => r.json());
    await fetch('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ autoMergeWindowHours: 0, whatsappOrderGroups: 'raf breda' }) });
    const c = await post('/api/customers', { name: 'Suggestie Monteur Klant', phone: '0611009977' });
    await post('/api/orders', { customerId: c.id, title: 'Rhenen — bestaande open kaart', status: 'open', monteurId });
    await post('/api/ingest/whatsapp', { group: 'Raf breda', name: 'DRS', body: 'Naam: Suggestie Monteur Klant\nAdres: Dorp 1\nWoonplaats: Rhenen\nTelefoon: 0611009977\nOpmerkingen: tweede aanvraag', externalId: 'br-sug-1' }, true);
    const rv = await fetch('/api/reviews').then((r) => r.json());
    const r = (rv.items || rv).find((x) => /0611009977/.test(JSON.stringify(x)));
    if (!r) return null;
    const g = await post(`/api/reviews/${r.id}/approve`, { monteurId });
    return g.order && g.order.mergeSuggestion ? g.order.id : ('geen-suggestie:' + JSON.stringify(g).slice(0, 80));
  }, mSetup.monteurId);
  ok('testkaart met samenvoeg-suggestie aangemaakt', !!sugId && !/^geen/.test(sugId), String(sugId));
  mErr.length = 0;
  await mp.evaluate(async (id) => { state.orders = await fetch('/api/orders').then((r) => r.json()); openOrderModal(id); }, sugId);
  await mp.waitForTimeout(700);
  const gebonden = await mp.evaluate(() => ({ save: !!document.querySelector('#f-save')?.onclick, onweg: !!document.querySelector('#f-onweg')?.onclick, werkbon: !!document.querySelector('#f-werkbon')?.onclick }));
  ok('monteur: kaart met samenvoeg-suggestie is volledig bruikbaar (Opslaan/Onderweg/Werkbon gebonden)', gebonden.save && gebonden.onweg && gebonden.werkbon, JSON.stringify(gebonden));
  ok('monteur: geen JS-fout bij het openen van die kaart', !mErr.filter((e) => !/favicon|manifest|ServiceWorker/i.test(e)).length, mErr.join(' | '));
  ok('monteur-scherm zonder JS-fouten', !mErr.filter((e) => !/favicon|manifest|ServiceWorker/i.test(e)).length, mErr.join(' | '));
  await mp.close();
}

// ZOEKEN IN DE INGEKLAPTE AGENDA'S (5 okt 2026): zoekbalk op het bord vindt ook
// opdrachten in ingeklapte weken; die week klapt open met alleen de treffers.
clear();
const archKey = await page.evaluate(async () => {
  const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  const c = await post('/api/customers', { name: 'Zoekniko Archiefklant', phone: '0612399888' });
  await post('/api/orders', { customerId: c.id, title: 'Breda — zoektest archief', status: 'afgerond' });
  return (await post('/api/archives/collapse', { channel: 'all' })).key;
});
await page.evaluate(() => goView('board'));
await page.waitForTimeout(1200);
await page.fill('#boardSearch', 'zoekniko');
await page.waitForSelector('.archive-treffer .archive-item', { timeout: 8000 }).catch(() => {});
const archZoek = await page.evaluate(() => ({ treffers: document.querySelectorAll('.archive-treffer .archive-item').length, open: !!document.querySelector('.archive-treffer[open]'), kop: (document.querySelector('#archiveWrap .archive-title') || {}).textContent || '' }));
ok('zoeken op het bord vindt ook opdrachten in de ingeklapte agenda\'s (week open, alleen treffers)', archZoek.treffers === 1 && archZoek.open && /1 opdracht gevonden/.test(archZoek.kop), JSON.stringify(archZoek));
await page.fill('#boardSearch', '');
await page.waitForFunction(() => !document.querySelector('.archive-treffer'), null, { timeout: 8000 }).catch(() => {});
ok('zoekveld leeg → gewone ingeklapte weken weer terug', await page.evaluate(() => !document.querySelector('.archive-treffer') && document.querySelectorAll('#archiveWrap details.archive').length >= 1));
noErr('Zoeken in ingeklapte agenda\'s');
await page.evaluate(async (key) => { await fetch('/api/archives/uncollapse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) }); }, archKey);

// TRUSTPILOT (5 okt 2026): instelling, vinkje in het verstuur-venster, knop op een
// afgeronde opdracht — alleen als het adres is ingesteld.
clear();
const tpSetup = await page.evaluate(async () => {
  const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  await fetch('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trustpilot: { bcc: 'test+abc@invite.trustpilot.com', standaardAan: false } }) });
  await refreshMeta();
  const c = await post('/api/customers', { name: 'Trust Klant', email: 'trust@example.nl', phone: '0611777888' });
  const o = await post('/api/orders', { customerId: c.id, title: 'Rhenen — trustpilot browser', status: 'afgerond' });
  const i = await post('/api/invoices', { customerId: c.id, orderId: o.id, type: 'factuur' });
  const inv = i.invoice || i;
  await fetch('/api/invoices/' + inv.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines: [{ description: 'Slot', qty: 1, priceExcl: 100 }], btwPct: 21 }) });
  return { orderId: o.id, invId: inv.id, aan: !!(state.meta.trustpilot && state.meta.trustpilot.aan) };
});
ok('Trustpilot-instelling bekend in het scherm (meta)', tpSetup.aan, JSON.stringify(tpSetup));
await page.evaluate((id) => openOrderVers(id), tpSetup.orderId);
await page.waitForSelector('#f-trustpilot', { timeout: 6000 }).catch(() => {});
ok('afgeronde opdracht heeft een knop "Trustpilot"', await page.locator('#f-trustpilot').count() === 1);
await page.evaluate(() => closeModal());
await page.evaluate((id) => window.openStandaloneInvoice(id), tpSetup.invId);
await page.waitForSelector('#inv-send', { timeout: 6000 }).catch(() => {});
await page.click('#inv-send');
await page.waitForSelector('#bk-ja', { timeout: 4000 }).catch(() => {});
const tpVinkje = await page.evaluate(() => ({ er: !!document.querySelector('#bk-tp'), uit: document.querySelector('#bk-tp') && !document.querySelector('#bk-tp').checked }));
ok('factuur per e-mail: vinkje "Trustpilot-uitnodiging meesturen" staat er (standaard uit)', tpVinkje.er && tpVinkje.uit, JSON.stringify(tpVinkje));
await page.click('#bk-cancel');
await page.click('#inv-send-wa');
await page.waitForSelector('#bk-ja', { timeout: 4000 }).catch(() => {});
ok('via WhatsApp: géén Trustpilot-vinkje (werkt alleen per e-mail)', await page.evaluate(() => !document.querySelector('#bk-tp')));
await page.click('#bk-cancel');
await page.evaluate(() => closeModal());
noErr('Trustpilot');

console.log(`\n========== BROWSER: ${pass} geslaagd, ${fail} gefaald ==========`);
await browser.close();
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);

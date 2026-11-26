// ECHTE browsertest: opent de CRM in headless Chromium, logt in, en opent de
// factuur- én offerte-editor. Vangt elke JS-console-fout (zoals "Can't find
// variable: bundles") — de test die de vorige bug had moeten vangen.
import fs from 'node:fs';
import { chromium } from 'playwright-core';
// De werkomgeving wisselt van Chromium-versie; /opt/pw-browsers/chromium wijst altijd naar de
// geïnstalleerde. Het oude vaste pad blijft als terugval (of zet CHROME_PATH).
const EXEC = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => p && fs.existsSync(p));
const BASE = 'http://localhost:3122';
let pass = 0, fail = 0; const bad = [];
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; bad.push(n); console.log('  ✗ FAIL: ' + n + (e ? ' — ' + e : '')); } };

const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
const page = await browser.newPage();
const jsErrors = [];
page.on('pageerror', (e) => jsErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') jsErrors.push(m.text()); });
const clear = () => { jsErrors.length = 0; };
// Instellingen (23 nov 2026): een onderwerp kiezen. Op de telefoon staat de lijst met
// onderwerpen achter '← Alle instellingen' zodra je er één hebt geopend.
const instKies = async (pg, g) => { await pg.evaluate(() => { const t = document.querySelector('#instTerug'); if (t && t.offsetParent) t.click(); }); return pg.click(`#settingsPanel .sg-chip[data-g="${g}"]`); };
// Inbox (ontwerp nov 2026): op de pc staat links een lijst en is alleen het gekozen bericht in
// beeld. Open een bericht zoals een gebruiker dat doet: klik in de lijst (telefoon: niets nodig).
const inboxOpenMet = async (pg, tekst) => pg.evaluate((t) => {
  const r = [...document.querySelectorAll('#reviewList .review')].find((x) => x.textContent.includes(t)); if (!r) return false;
  const item = document.querySelector(`#inboxLijst .il-item[data-id="${r.dataset.id}"]`);
  if (item && item.offsetParent !== null) item.click();
  return true;
}, tekst);
const inboxToonMeer = async (pg) => { const links = pg.locator('#inboxMoreLijst'); if (await links.isVisible().catch(() => false)) await links.click(); else await pg.click('#inboxMore'); };
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

// 4b) REPARATIELOCATIE + CORRIGEREN BINNEN HETZELFDE NUMMER (23 nov 2026, wensen eigenaar).
// Losse factuur (geen opdracht → de standaard is het klantadres; de volgorde opdracht → klant
// zit in factuur-test). Typen + opslaan + opnieuw openen; daarna vergrendelen en corrigeren.
clear();
const corrSetup = await page.evaluate(async () => {
  const stuur = (m, p, b) => fetch(p, { method: m, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  const c = await stuur('POST', '/api/customers', { name: 'Locatie Browser Klant', email: 'locatie-bt@example.nl', phone: '0611770041', address: 'Klantlaan 1, 3911 AA Rhenen' });
  const i = (await stuur('POST', '/api/invoices', { customerId: c.id, type: 'factuur' })).invoice;
  await stuur('PATCH', '/api/invoices/' + i.id, { lines: [{ description: 'Cilinder vervangen', qty: 1, priceExcl: 90 }], btwPct: 21, note: '' });
  return { invId: i.id, nummer: i.number };
});
const invVan = (id) => page.evaluate((x) => fetch('/api/invoices/' + x).then((r) => r.json()).then((d) => d.invoice), id);
const openFactuur = async (id, wachtOp) => { await page.evaluate((x) => { if (typeof closeModal === 'function') closeModal(); window.openStandaloneInvoice(x); }, id); await page.waitForSelector(wachtOp, { timeout: 6000 }).catch(() => {}); };
const bewaarEnWacht = async () => { await page.click('#inv-save'); await page.waitForFunction(() => !document.querySelector('#inv-save'), null, { timeout: 8000 }).catch(() => {}); };
await openFactuur(corrSetup.invId, '#inv-rep');
const repVeld = await page.evaluate(() => {
  const el = document.querySelector('#inv-rep'); const klant = document.querySelector('#modal details'); const regels = document.querySelector('#inv-lines');
  const na = (a, b) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  return { er: !!el, waarde: el ? el.value : '', zichtbaar: !!el && el.offsetParent !== null && !el.closest('details'), aan: !!el && !el.disabled,
    label: /Reparatielocatie/.test((el && el.closest('label') || {}).textContent || ''),
    hint: /Staat zo op de PDF\. Leeg laten = adres van de opdracht of de klant\./.test(document.querySelector('#modal').textContent),
    onderKlant: na(klant, el), bovenRegels: na(el, regels) };
});
ok('factuur-editor: zichtbaar veld "Reparatielocatie" (onder de klantgegevens, boven de regels) met uitleg, voorgevuld met de standaard', repVeld.er && repVeld.zichtbaar && repVeld.aan && repVeld.label && repVeld.hint && repVeld.onderKlant && repVeld.bovenRegels && repVeld.waarde === 'Klantlaan 1, 3911 AA Rhenen', JSON.stringify(repVeld));
// Onaangeroerd opslaan bevriest het adres niet (de factuur blijft de standaard volgen).
await bewaarEnWacht();
ok('reparatielocatie: onaangeroerd opslaan bewaart niets aparts (blijft de standaard volgen)', !(await invVan(corrSetup.invId)).reparatieAdres);
await openFactuur(corrSetup.invId, '#inv-rep');
await page.fill('#inv-rep', 'Loods 3, Havenweg 12, 4811 XX Breda');
await bewaarEnWacht();
const repBewaard = (await invVan(corrSetup.invId)).reparatieAdres;
await openFactuur(corrSetup.invId, '#inv-rep');
ok('reparatielocatie: typen + opslaan blijft bewaard (opnieuw openen toont de waarde)', repBewaard === 'Loods 3, Havenweg 12, 4811 XX Breda' && await page.inputValue('#inv-rep') === 'Loods 3, Havenweg 12, 4811 XX Breda', JSON.stringify(repBewaard));
await page.fill('#inv-rep', '');
await bewaarEnWacht();
await openFactuur(corrSetup.invId, '#inv-rep');
ok('reparatielocatie: leegmaken → terug naar de standaard (veld toont weer het klantadres)', !(await invVan(corrSetup.invId)).reparatieAdres && await page.inputValue('#inv-rep') === 'Klantlaan 1, 3911 AA Rhenen');
// Klantadres wijzigen in hetzelfde venster: een onaangeroerde reparatielocatie volgt mee;
// staat er een eigen adres, dan blijft dat staan en zegt de melding dat erbij.
// Het venster wordt na de vorige Opslaan opnieuw opgebouwd; op een drukke machine kan dat net
// ná het invullen gebeuren (dan is de invoer weg en faalt de controle zonder dat er iets stuk
// is). Daarom: invullen, kort wachten, nakijken dat het er nog staat, dán pas opslaan.
const zetKlantAdres = async (adres) => {
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => { const d = document.querySelector('#modal details'); if (d) d.open = true; });
    await page.fill('#cust-address', adres); await page.waitForTimeout(250);
    if (await page.inputValue('#cust-address').catch(() => '') === adres) break;
  }
  await page.click('#cust-save');
};
await zetKlantAdres('Klantlaan 2, 3911 AA Rhenen');
await page.waitForFunction(() => (document.querySelector('#inv-rep') || {}).value === 'Klantlaan 2, 3911 AA Rhenen', null, { timeout: 6000 }).catch(() => {});
ok('klantadres gewijzigd in de editor: een onaangeroerde reparatielocatie volgt het nieuwe adres', await page.inputValue('#inv-rep') === 'Klantlaan 2, 3911 AA Rhenen');
await page.fill('#inv-rep', 'Loods 3, Havenweg 12, 4811 XX Breda');
await zetKlantAdres('Klantlaan 1, 3911 AA Rhenen');
await page.waitForFunction(() => /niet meegewijzigd/.test((document.querySelector('#toast') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
ok('klantadres gewijzigd terwijl er een eigen reparatielocatie staat: die blijft staan, met een melding', await page.inputValue('#inv-rep') === 'Loods 3, Havenweg 12, 4811 XX Breda' && /reparatielocatie hieronder is niet meegewijzigd/.test(await page.evaluate(() => (document.querySelector('#toast') || {}).textContent || '')));
// Vergrendelen: als betaald verstuurd (WhatsApp-wachtrij) → verstuurd + betaald.
await page.evaluate((id) => fetch('/api/invoices/' + id + '/send-whatsapp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ betaald: true }) }).then((r) => r.json()), corrSetup.invId);
await openFactuur(corrSetup.invId, '#inv-corr');
const slot = await page.evaluate(() => ({ corr: !!document.querySelector('#inv-corr'), save: !!document.querySelector('#inv-save'), repDicht: (document.querySelector('#inv-rep') || {}).disabled === true, uitleg: /Dit document is vergrendeld/.test(document.querySelector('#modal').textContent), focus: (document.activeElement || {}).id || '' }));
ok('vergrendelde factuur (beheerder): knop "Corrigeren" bij de uitleg; velden dicht, geen Opslaan', slot.corr && !slot.save && slot.repDicht && slot.uitleg && slot.focus !== 'inv-corr', JSON.stringify(slot));
await page.fill('#inv-lines .il-desc', 'Cilinder vervangen (SKG3)');
await page.click('#inv-corr');
await page.waitForSelector('#md-input', { timeout: 4000 }).catch(() => {});
ok('Corrigeren vraagt de reden in het eigen venster (geen prompt), de factuur blijft erachter staan', await page.locator('#md-input').count() === 1 && /corrigeren/.test(await page.locator('#md-titel').textContent()) && await page.locator('#inv-corr').count() === 1);
await page.fill('#md-input', 'ab');
await page.click('#md-ok');
ok('te korte reden: het venster blijft staan met uitleg', await page.locator('#md-input').count() === 1 && await page.evaluate(() => { const f = document.querySelector('#md-fout'); return !!f && !f.hidden && /minimaal 3/.test(f.textContent); }));
await page.fill('#md-input', 'Verkeerd aantal cilinders');
await page.click('#md-ok');
await page.waitForSelector('#inv-corr-melding', { timeout: 6000 }).catch(() => {});
const corrStand = await page.evaluate(() => ({
  melding: (document.querySelector('#inv-corr-melding') || {}).textContent || '', knop: (document.querySelector('#inv-save') || {}).textContent || '',
  open: ['#inv-rep', '#inv-btw', '#inv-note', '#inv-disc-type'].every((q) => document.querySelector(q) && !document.querySelector(q).disabled) && !!document.querySelector('#il-add'),
  geenAndereActies: !document.querySelector('#inv-send') && !document.querySelector('#inv-send-wa') && !document.querySelector('#inv-unpaid') && !document.querySelector('#inv-del') && !document.querySelector('#inv-corr'),
}));
ok('correctie-stand: melding "Je corrigeert deze factuur. Het nummer blijft <nr>.", velden open, alleen "Correctie opslaan"', corrStand.melding.includes(`Je corrigeert deze factuur. Het nummer blijft ${corrSetup.nummer}.`) && /Correctie opslaan/.test(corrStand.knop) && corrStand.open && corrStand.geenAndereActies, JSON.stringify(corrStand));
ok('correctie-stand: wat al in de regel was getypt vóór "Corrigeren" is meegenomen', await page.inputValue('#inv-lines .il-desc') === 'Cilinder vervangen (SKG3)');
await page.fill('#inv-lines .il-qty', '2');
await page.fill('#inv-rep', 'Goedstraat 7, 3911 AC Rhenen');
await page.click('#inv-save');
await page.waitForSelector('#inv-gecorr', { timeout: 8000 }).catch(() => {});
const naCorr = await invVan(corrSetup.invId);
ok('correctie opgeslagen: zelfde nummer, nog steeds betaald + verstuurd, nieuw totaal, reden vastgelegd', naCorr.number === corrSetup.nummer && naCorr.status === 'betaald' && !!naCorr.sentAt && !!naCorr.paidAt && naCorr.totalExcl === 180 && naCorr.reparatieAdres === 'Goedstraat 7, 3911 AC Rhenen' && (naCorr.correcties || []).length === 1 && naCorr.correcties[0].reden === 'Verkeerd aantal cilinders' && naCorr.correcties[0].vanTotaal === 108.9 && naCorr.correcties[0].naarTotaal === 217.8 && naCorr.lines[0].description === 'Cilinder vervangen (SKG3)', JSON.stringify({ n: naCorr.number, s: naCorr.status, t: naCorr.totalExcl, c: naCorr.correcties }));
ok('melding na het opslaan: "Correctie opgeslagen — het nummer blijft <nr>"', await page.evaluate((nr) => ((document.querySelector('#toast') || {}).textContent || '').includes(`Correctie opgeslagen — het nummer blijft ${nr}`), corrSetup.nummer));
const naCorrScherm = await page.evaluate(() => ({ regel: (document.querySelector('#inv-gecorr') || {}).textContent || '', dicht: !document.querySelector('#inv-save') && (document.querySelector('#inv-rep') || {}).disabled === true, opnieuw: !!document.querySelector('#inv-resend'), corr: !!document.querySelector('#inv-corr') }));
ok('daarna weer vergrendeld: het venster toont "Gecorrigeerd op …" met de reden, en "Verstuur opnieuw"', /Gecorrigeerd op/.test(naCorrScherm.regel) && /Verkeerd aantal cilinders/.test(naCorrScherm.regel) && naCorrScherm.dicht && naCorrScherm.opnieuw && naCorrScherm.corr, JSON.stringify(naCorrScherm));
// Opnieuw versturen werkt zoals altijd: e-mailadres → de betaald-vraag (hier geannuleerd).
await page.click('#inv-resend');
await page.waitForSelector('#md-input', { timeout: 4000 }).catch(() => {});
await page.click('#md-ok').catch(() => {});
await page.waitForSelector('#bk-ja', { timeout: 4000 }).catch(() => {});
ok('gecorrigeerde factuur: "Verstuur opnieuw" → e-mailadres → de betaald-vraag (ongewijzigd)', await page.locator('#bk-ja').count() === 1 && await page.locator('#bk-nee').count() === 1);
await page.click('#bk-cancel').catch(() => {});
await page.waitForTimeout(200);
await page.evaluate(() => closeModal());
noErr('Reparatielocatie + corrigeren');

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

// 8a2) OPDRACHTVENSTER, NIEUWE INDELING (23 nov 2026, herontwerp): kop met status en klant,
// ÉÉN volgende stap, tabbladen, knoppen in vaste groepjes. Niets mag verdwenen zijn.
clear();
{
  // Nieuwe klantreactie → het venster hoort op het gesprek te openen.
  await page.evaluate(async () => { await fetch('/api/ingest/whatsapp', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-token': 'test123' }, body: JSON.stringify({ name: 'Browsertest Klant', body: 'nog een vraag over de prijs\nTelefoon: +31611000000', externalId: 'bt-hist-2' }) }); });
  await page.evaluate((id) => { closeModal(); return openOrderVers(id); }, ordId);
  await page.waitForSelector('#modalRoot:not([hidden]) .ov-tabs'); await page.waitForTimeout(500);
  const ov = await page.evaluate(() => {
    const m = document.querySelector('#modal');
    const zichtbaar = (sel) => { const e = m.querySelector(sel); return !!e && e.offsetParent !== null; };
    const ids = ['f-title', 'f-ccname', 'f-ccphone', 'f-ccemail', 'f-ccaddress', 'f-status', 'f-monteur', 'f-appt', 'f-appt-end', 'f-price', 'f-notes', 'f-urgent', 'f-addfile', 'f-attachgrid', 'f-chat', 'f-chatsearch', 'f-history', 'f-delete', 'f-gcal', 'f-werkbon', 'f-invoice', 'f-quote', 'f-snooze', 'f-send-monteur', 'f-onweg', 'f-merge', 'f-reply', 'f-cancel', 'f-save'];
    return {
      titel: m.querySelector('.ov-titel')?.textContent.trim(), chip: m.querySelector('.ov-chip')?.textContent.trim(),
      tel: m.querySelector('.ov-klant a[href^="tel:"]')?.getAttribute('href'),
      tabs: [...m.querySelectorAll('.ov-tab')].map((t) => t.dataset.ovtab).join(), actief: m.querySelector('.ov-tab.active')?.dataset.ovtab,
      stap: m.querySelector('#ov-stap')?.textContent.trim(), chat: zichtbaar('#f-chat'), titelveld: zichtbaar('#f-title'),
      weg: ids.filter((i) => !m.querySelector('#' + i)),
      groepen: [...m.querySelectorAll('.ov-actiegroep:not([hidden])')].map((g) => g.querySelector('.ov-actiekop').textContent + ':' + g.querySelectorAll('.btn').length).join(' '),
      knoppenZichtbaar: ['f-reply', 'f-werkbon', 'f-invoice', 'f-quote', 'f-send-monteur', 'f-onweg', 'f-save'].every((i) => zichtbaar('#' + i)),
    };
  });
  ok('opdrachtvenster: kop met titel, status en belbaar nummer', ov.titel === 'Kaart voor historietest' && !!ov.chip && ov.tel === 'tel:0611000000', JSON.stringify(ov));
  ok('opdrachtvenster: tabbladen Details · Gesprek · Foto\'s · Geschiedenis; bij een ongelezen klantreactie opent het op Gesprek', ov.tabs === 'details,gesprek,fotos,historie' && ov.actief === 'gesprek' && ov.chat && !ov.titelveld, JSON.stringify([ov.tabs, ov.actief, ov.chat, ov.titelveld]));
  ok('opdrachtvenster: volgende stap bij een klantreactie = Beantwoorden', ov.stap === 'Beantwoorden', String(ov.stap));
  ok('opdrachtvenster: geen enkel veld en geen enkele knop is verdwenen', ov.weg.length === 0, ov.weg.join());
  ok('opdrachtvenster: knoppen in vaste groepjes (Klant · Werk · Planning · Meer), op elk tabblad zichtbaar', /^Klant:\d+ Werk:4 Planning:\d+ Meer:1$/.test(ov.groepen) && ov.knoppenZichtbaar, ov.groepen);
  // Tabblad wisselen: velden blijven staan; Opslaan bewaart ook wat op een ander tabblad staat.
  await page.click('.ov-tab[data-ovtab="details"]'); await page.waitForTimeout(200);
  await page.fill('#f-notes', 'tabproef: notitie op Details');
  await page.click('.ov-tab[data-ovtab="fotos"]'); await page.waitForTimeout(200);
  ok('tabblad Foto\'s: toevoegknop zichtbaar, Details verborgen, getypte notitie blijft staan', await page.evaluate(() => document.querySelector('#f-addfile').offsetParent !== null && document.querySelector('#f-notes').offsetParent === null && document.querySelector('#f-notes').value === 'tabproef: notitie op Details'));
  await page.click('.ov-tab[data-ovtab="historie"]'); await page.waitForTimeout(200);
  ok('tabblad Geschiedenis: toont wanneer de opdracht binnenkwam', await page.evaluate(() => { const p = document.querySelector('.ov-paneel[data-ovp="historie"]'); return !p.hidden && /Binnengekomen/.test(p.textContent); }));
  // Vervolgvenster en terug: zelfde tabblad.
  await page.click('.ov-tab[data-ovtab="fotos"]'); await page.waitForTimeout(150);
  await page.click('#f-save'); await page.waitForTimeout(900);
  const bewaard = await page.evaluate((id) => fetch('/api/orders/' + id).then((r) => r.json()).then((o) => o.notes), ordId);
  ok('Opslaan vanaf een ander tabblad bewaart de notitie van Details', bewaard === 'tabproef: notitie op Details', String(bewaard));
  await page.evaluate((id) => openOrderVers(id), ordId); await page.waitForSelector('#modalRoot:not([hidden]) .ov-tabs'); await page.waitForTimeout(300);
  await page.click('.ov-tab[data-ovtab="fotos"]'); await page.waitForTimeout(150);
  await page.click('#f-werkbon'); await page.waitForSelector('#wb-cancel'); await page.click('#wb-cancel'); await page.waitForSelector('.ov-tabs'); await page.waitForTimeout(300);
  ok('terug uit een vervolgvenster (werkbon): je staat weer op het tabblad waar je was', await page.evaluate(() => document.querySelector('.ov-tab.active')?.dataset.ovtab === 'fotos'));
  // De volgende stap volgt vaste regels (geen AI): zelfde opdracht = zelfde voorstel.
  const stappen = await page.evaluate(() => {
    const k = { canWrite: true, isMonteur: false }, mo = { canWrite: false, isMonteur: true };
    const dag = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('sv-SE');
    const s = (o, r) => (ovVolgendeStap(o, r) || {}).label || '-';
    return [
      s({ status: 'nieuw', customerIncomplete: true }, k), s({ status: 'open', unreadReplies: 2 }, k), s({ status: 'nieuw' }, k),
      s({ status: 'nieuw', sentToMonteur: { at: 'x' } }, k), s({ status: 'open' }, k), s({ status: 'offerte_verzonden' }, k),
      s({ status: 'afspraak_ingepland', appointmentAt: dag(1) + 'T10:00' }, k), s({ status: 'afspraak_ingepland', appointmentAt: dag(-1) + 'T10:00' }, k),
      s({ status: 'afspraak_ingepland', appointmentAt: dag(0) + 'T10:00' }, mo), s({ status: 'afspraak_ingepland', appointmentAt: dag(0) + 'T10:00', onderwegAt: 'x' }, mo),
      s({ status: 'afgerond' }, k), s({ status: 'afgerond', invoiceId: 'i' }, k), s({ status: 'geannuleerd' }, k), s({ status: 'open', unreadReplies: 2 }, mo),
    ].join(' | ');
  });
  ok('volgende stap volgt vaste regels per situatie (kantoor en monteur)', stappen === 'Klantgegevens aanvullen | Beantwoorden | Stuur naar monteur | Afspraak plannen | Afspraak plannen | Afspraak plannen | - | Afronden | Onderweg melden | Afronden | Factuur maken | - | - | Afspraak plannen', stappen);
  // Volgende stap "Afspraak plannen" brengt je naar het veld, ook vanaf een ander tabblad.
  await page.click('.ov-tab[data-ovtab="historie"]'); await page.waitForTimeout(150);
  const stapNu = await page.evaluate(() => document.querySelector('#ov-stap')?.textContent.trim() || '');
  if (stapNu) await page.click('#ov-stap');
  await page.waitForTimeout(400);
  ok('klik op de volgende stap doet iets zichtbaars (veld in beeld of vervolgvenster open)', await page.evaluate(() => !!document.querySelector('#msm-send, #sm-send, [id^="sm-"], [id^="msm-"]') || document.activeElement?.id === 'f-appt' || document.activeElement?.id === 'f-ccname' || !document.querySelector('.ov-tabs')), stapNu);
  await page.evaluate(() => closeModal());
  // Telefoon: tabbalk niet platgedrukt, niets steekt buiten het scherm, knoppen twee naast elkaar.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate((id) => openOrderVers(id), ordId); await page.waitForSelector('#modalRoot:not([hidden]) .ov-tabs'); await page.waitForTimeout(400);
  const ovTel = await page.evaluate(() => {
    const m = document.querySelector('#modal'); const t = m.querySelector('.ov-tabs').getBoundingClientRect();
    const knoppen = [...m.querySelectorAll('.ov-actieknoppen .btn')].map((b) => b.getBoundingClientRect());
    return { tabHoogte: Math.round(t.height), breedte: m.scrollWidth - m.clientWidth, buiten: knoppen.filter((r) => r.right > 391 || r.left < 0).length, tik: Math.min(...knoppen.map((r) => Math.round(r.height))) };
  });
  ok('telefoon: tabbalk heeft tikhoogte (≥ 44 px), venster schuift niet opzij, knoppen binnen beeld met tikhoogte ≥ 44 px', ovTel.tabHoogte >= 44 && ovTel.breedte <= 0 && ovTel.buiten === 0 && ovTel.tik >= 44, JSON.stringify(ovTel));
  await page.evaluate(() => { const m = document.querySelector('#modal'); m.scrollTop = 400; });
  await page.waitForTimeout(200);
  ok('telefoon: de tabbladen blijven bovenaan bereikbaar tijdens het scrollen', await page.evaluate(() => { const m = document.querySelector('#modal'); if (m.scrollTop < 50) return true; const t = m.querySelector('.ov-tabs').getBoundingClientRect(); const mr = m.getBoundingClientRect(); return t.top >= mr.top - 1 && t.top <= mr.top + 40; }));
  await page.evaluate(() => closeModal());
  await page.setViewportSize({ width: 1280, height: 800 });
}
noErr('Opdrachtvenster nieuwe indeling');

// 8a3) START: werklijst "Eerst doen" bovenaan (24 nov 2026, herontwerp).
clear();
{
  // Een losse e-mail gaat altijd eerst langs een mens → er wacht dus zeker één aanvraag.
  await page.evaluate(() => fetch('/api/ingest/email', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-token': 'test123' }, body: JSON.stringify({ from: 'Start Proef <startproef@example.nl>', subject: 'Slot voordeur kapot', body: 'Goedemiddag, het slot van mijn voordeur is kapot en ik kan niet meer afsluiten. Kunt u langskomen?\nNaam: Start Proef\nTelefoon: 0611000321\nAdres: Dorpsstraat 5, 3911 AA Rhenen', externalId: 'bt-start-1' }) }));
  await page.evaluate(() => goView('overview')); await page.waitForTimeout(1800);
  const ed = await page.evaluate(() => {
    const blok = document.querySelector('#eerstDoenBlok'); const taken = document.querySelector('#takenVandaagBlok'); const kpi = document.querySelector('#ovKpis');
    return { er: !!blok && !!blok.querySelector('.eerst-doen'), rijen: [...document.querySelectorAll('.eerst-rij')].map((r) => r.dataset.eerst), boven: !!blok && !!kpi && (blok.compareDocumentPosition(kpi) & Node.DOCUMENT_POSITION_FOLLOWING) > 0 && (!taken || (blok.compareDocumentPosition(taken) & Node.DOCUMENT_POSITION_FOLLOWING) > 0), zoek: !!document.querySelector('#globalSearch'), kpis: document.querySelectorAll('#ovKpis .kpi-card').length, tekst: blok ? blok.innerText : '' };
  });
  ok('Start: werklijst "Eerst doen" staat bovenaan, vóór taken en tegels; zoekveld en tegels zijn er nog', ed.er && ed.boven && ed.zoek && ed.kpis === 7, JSON.stringify({ ...ed, tekst: ed.tekst.slice(0, 120) }));
  ok('Start: de werklijst toont de wachtende aanvragen als eerste punt, zonder bedragen', ed.rijen[0] === 'inbox' && !/€/.test(ed.tekst), ed.rijen.join());
  await page.click('.eerst-rij[data-eerst="inbox"]'); await page.waitForTimeout(900);
  ok('Start: klik op het punt brengt je naar de inbox', await page.evaluate(() => !document.querySelector('#view-inbox').hidden));
  await page.evaluate(() => goView('overview')); await page.waitForTimeout(1200);
  if (ed.rijen.includes('drs')) {
    await page.click('.eerst-rij[data-eerst="drs"]'); await page.waitForTimeout(1200);
    ok('Start: het punt DRS-rapport opent het rapportvenster', await page.evaluate(() => !document.querySelector('#modalRoot').hidden && /DRS/i.test(document.querySelector('#modal').textContent)));
    await page.evaluate(() => closeModal());
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(400);
  ok('Start op de telefoon: de werklijst past binnen het scherm en elke regel is een tikdoel (≥ 44 px)', await page.evaluate(() => { const r = [...document.querySelectorAll('.eerst-rij')].map((x) => x.getBoundingClientRect()); return r.length > 0 && r.every((x) => x.right <= 391 && x.height >= 44) && document.documentElement.scrollWidth <= 391; }));
  await page.setViewportSize({ width: 1280, height: 800 });
}
noErr('Start: Eerst doen');

// 8a4) MERK PER OPDRACHT + REDEN VAN ANNULEREN (24 nov 2026).
clear();
{
  const req = (m, p, b) => page.evaluate(([mm, pp, bb]) => fetch(pp, { method: mm, headers: { 'content-type': 'application/json' }, body: bb ? JSON.stringify(bb) : undefined }).then((r) => r.json()), [m, p, b]);
  const oMerk = await req('POST', '/api/orders', { customerName: 'Merk Browser', customerPhone: '0611000777', title: 'Ede — schuifpui loopt zwaar', notes: 'Klant twijfelt nog' });
  await page.evaluate((i) => openOrderVers(i), oMerk.id); await page.waitForSelector('#modalRoot:not([hidden]) .ov-tabs'); await page.waitForTimeout(400);
  const mk = await page.evaluate(() => ({ chip: [...document.querySelectorAll('.ov-chip')].some((c) => /Schuifpuiservice/.test(c.textContent)), keuze: document.querySelector('#f-merk')?.value, auto: document.querySelector('#f-merk option')?.textContent || '', redenVerborgen: document.querySelector('#f-annuleer-rij')?.hidden }));
  ok('opdracht over een schuifpui: merk staat automatisch op Schuifpuiservice (label in de kop + keuzelijst)', mk.chip && mk.keuze === '' && /Automatisch — Schuifpuiservice/.test(mk.auto), JSON.stringify(mk));
  ok('lopende opdracht: het veld "Reden van annuleren" is niet in beeld', mk.redenVerborgen === true);
  await page.selectOption('#f-status', 'geannuleerd'); await page.waitForTimeout(200);
  const rd = await page.evaluate(() => ({ zichtbaar: document.querySelector('#f-annuleer-rij').offsetParent !== null, opties: document.querySelectorAll('#f-annuleer option').length }));
  ok('status op Geannuleerd → het veld verschijnt met de 9 vaste redenen', rd.zichtbaar && rd.opties === 10, JSON.stringify(rd));
  await page.selectOption('#f-annuleer', 'prijs'); await page.selectOption('#f-merk', 'keyservice');
  await page.click('#f-save'); await page.waitForTimeout(1000);
  const na = await req('GET', `/api/orders/${oMerk.id}`);
  ok('Opslaan bewaart status, gekozen reden en gekozen merk', na.status === 'geannuleerd' && na.annulering?.reden === 'prijs' && na.merk === 'keyservice', JSON.stringify([na.status, na.annulering, na.merk]));
  // Al geannuleerd zonder gekozen reden: het systeem stelt er één voor uit de notitie.
  const oV = await req('POST', '/api/orders', { customerName: 'Voorstel Browser', customerPhone: '0611000778', title: 'Ede — cilinder', notes: 'Drie keer gebeld, geen gehoor' });
  await req('PATCH', `/api/orders/${oV.id}`, { status: 'geannuleerd' });
  await page.evaluate((i) => openOrderVers(i), oV.id); await page.waitForSelector('#modalRoot:not([hidden]) .ov-tabs'); await page.waitForTimeout(400);
  const vs = await page.evaluate(() => ({ hint: document.querySelector('#f-annuleer-hint')?.textContent || '', knop: !!document.querySelector('#f-annuleer-over'), keuze: document.querySelector('#f-annuleer')?.value }));
  ok('geannuleerd zonder gekozen reden: voorstel uit de notitie, nog niets ingevuld', /Voorstel uit de notitie: Klant reageert niet meer/.test(vs.hint) && vs.knop && vs.keuze === '', JSON.stringify(vs));
  await page.click('#f-annuleer-over'); await page.waitForTimeout(150);
  ok('"Overnemen" zet het voorstel in het veld (pas bewaard na Opslaan)', await page.inputValue('#f-annuleer') === 'geen_reactie' && !(await req('GET', `/api/orders/${oV.id}`)).annulering);
  await page.click('#f-save'); await page.waitForTimeout(900);
  ok('…en na Opslaan staat de reden op de opdracht', (await req('GET', `/api/orders/${oV.id}`)).annulering?.reden === 'geen_reactie');
  // Cijfers → Conversie: waarom haken klanten af?
  await page.evaluate(() => goView('finance')); await page.waitForTimeout(1800);
  const ak = await page.evaluate(() => { const k = document.querySelector('#annuleringenKaart'); return { er: !!k, tekst: k ? k.innerText.replace(/\s+/g, ' ') : '' }; });
  ok('Cijfers toont "Waarom haken klanten af?" met de redenen en aantallen', ak.er && /Te duur/.test(ak.tekst) && /Klant reageert niet meer/.test(ak.tekst) && /geannuleerde opdracht/.test(ak.tekst), ak.tekst.slice(0, 260));
  // Instellingen: eigen reviewlink en Trustpilot-adres voor Schuifpuiservice.
  await page.evaluate(() => goView('settings')); await page.waitForTimeout(1500);
  ok('Instellingen: reviewlink en Trustpilot-adres voor Schuifpuiservice staan erbij (in "Berichten aan klanten")', await page.evaluate(() => { const a = document.querySelector('#rr-link-schuif'), b = document.querySelector('#tp-bcc-schuif'); return !!a && !!b && a.closest('[data-sg]')?.dataset.sg === 'bericht' && b.closest('[data-sg]')?.dataset.sg === 'bericht'; }));
}
noErr('Merk + annuleringsreden');

// 8a5) UITLEG "WAT IS ER VERANDERD?" (24 nov 2026): één keer zichtbaar, wegklikbaar, en
// altijd terug te vinden via Account. Geen venster dat het werk blokkeert.
clear();
{
  await page.evaluate(() => { try { localStorage.removeItem('ksNieuwGezien'); } catch {} const p = document.querySelector('#overviewPanel'); if (p) p.dataset.skelet = ''; });
  await page.evaluate(() => goView('overview')); await page.waitForTimeout(1800);
  const nb = await page.evaluate(() => { const b = document.querySelector('#nieuwBalk'); const ed = document.querySelector('#eerstDoenBlok'); return { er: !!b && b.offsetParent !== null, venster: !document.querySelector('#modalRoot').hidden, boven: !!b && !!ed && (b.compareDocumentPosition(ed) & Node.DOCUMENT_POSITION_FOLLOWING) > 0 }; });
  ok('Start: balk "Het CRM is opnieuw ingedeeld" staat bovenaan en opent zelf geen venster', nb.er && !nb.venster && nb.boven, JSON.stringify(nb));
  await page.click('#nieuwBalk [data-nieuw="toon"]'); await page.waitForTimeout(400);
  const nv = await page.evaluate(() => ({ open: !document.querySelector('#modalRoot').hidden, punten: document.querySelectorAll('.nieuw-lijst li').length, tekst: document.querySelector('#modal').innerText }));
  ok('uitleg voor kantoor: waar E-mail/WhatsApp, Eerst doen, tabbladen en Instellingen nu staan', nv.open && nv.punten >= 7 && /Alle · E-mail · WhatsApp/.test(nv.tekst) && /Eerst doen/.test(nv.tekst) && /Details · Gesprek/.test(nv.tekst) && /Instellingen/.test(nv.tekst), String(nv.punten));
  await page.click('#nw-ok'); await page.waitForTimeout(300);
  ok('na "Duidelijk" is de balk weg en blijft hij weg (per toestel onthouden)', await page.evaluate(() => !document.querySelector('#nieuwBalk') && /^\d{4}-\d{2}(-\d+)?$/.test(localStorage.getItem('ksNieuwGezien') || '')));
  await page.evaluate(() => openAccountModal()); await page.waitForTimeout(400);
  await page.click('#acc-nieuw'); await page.waitForTimeout(300);
  ok('Account → "Wat is er veranderd?" toont de uitleg opnieuw', await page.evaluate(() => document.querySelectorAll('.nieuw-lijst li').length >= 7));
  await page.evaluate(() => closeModal());
}
noErr('Uitleg wat is er veranderd');

// 8a6) ALLE KOPPELINGEN IN ÉÉN OOGOPSLAG (24 nov 2026).
clear();
{
  await page.evaluate(() => goView('settings')); await page.waitForTimeout(1500);
  await instKies(page, 'koppel'); await page.waitForTimeout(900);
  const ko = await page.evaluate(() => { const k = document.querySelector('#koppelOverzichtKaart'); return { groep: k?.dataset.sg, zichtbaar: !!k && k.offsetParent !== null, eerste: document.querySelector('#settingsPanel .inst-inhoud > [data-sg="koppel"]')?.id, rijen: [...document.querySelectorAll('#koppelOverzicht .ko-rij')].map((r) => r.dataset.ko).sort().join(), kop: document.querySelector('#koppelOverzicht .ko-kop')?.textContent.trim(), instroom: !!document.querySelector('#koppelOverzicht .ko-instroom') }; });
  ok('Instellingen → Koppelingen begint met "Alle koppelingen in één oogopslag": 8 koppelingen + of er nog iets binnenkomt', ko.groep === 'koppel' && ko.zichtbaar && ko.eerste === 'koppelOverzichtKaart' && ko.rijen === 'agenda,ai,mailIn,mailUit,opslag,waGroep,waOfficieel,website' && !!ko.kop && ko.instroom, JSON.stringify(ko));
  await page.click('#koppelOverzicht [data-ko-ververs]'); await page.waitForTimeout(600);
  ok('Ververs haalt het overzicht opnieuw op', await page.evaluate(() => document.querySelectorAll('#koppelOverzicht .ko-rij').length === 8));
  await page.evaluate(() => openKoppelStatus()); await page.waitForTimeout(700);
  ok('hetzelfde overzicht als venster (vanaf de werklijst op Start), met de weg naar Instellingen', await page.evaluate(() => !document.querySelector('#modalRoot').hidden && document.querySelectorAll('#koppelStatusVenster .ko-rij').length === 8 && !!document.querySelector('#ko-inst')));
  await page.evaluate(() => closeModal());
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  await page.evaluate(() => openKoppelStatus()); await page.waitForTimeout(700);
  ok('telefoon: het overzicht past binnen het scherm', await page.evaluate(() => { const m = document.querySelector('#modal'); return m.scrollWidth <= m.clientWidth + 1 && [...m.querySelectorAll('.ko-rij')].every((r) => r.getBoundingClientRect().right <= 391); }));
  await page.evaluate(() => closeModal());
  await page.setViewportSize({ width: 1280, height: 800 });
}
noErr('Koppelingen-overzicht');

// 8a7) TUSSENPERSOON WORDT NOOIT DE KLANT (24 nov 2026, audit D1).
clear();
{
  const tp = await page.evaluate(async () => {
    const J = { 'content-type': 'application/json' };
    const stuur = (id, naam, tel) => fetch('/api/ingest/email', { method: 'POST', headers: { ...J, 'x-ingest-token': 'test123' }, body: JSON.stringify({ from: 'Beheer Proef <beheer@vastgoed-proef.test>', subject: 'Slot kapot bij huurder', externalId: id, body: `Graag een monteur.\nNaam: ${naam}\nTelefoon: ${tel}\nAdres: Proefweg 1, 3911 AA Rhenen\nProbleem: slot voordeur kapot` }) }).then((r) => r.json());
    const keur = (rid, naam, tel) => fetch(`/api/reviews/${rid}/approve`, { method: 'POST', headers: J, body: JSON.stringify({ customerName: naam, customerPhone: tel, customerEmail: 'beheer@vastgoed-proef.test' }) }).then((r) => r.json());
    const a = await stuur('bt-tp-1', 'Huurder Alfa', '0611000811'); const oa = await keur(a.reviewId, 'Huurder Alfa', '0611000811');
    const b = await stuur('bt-tp-2', 'Bewoner Beta', '0611000822'); const ob = await keur(b.reviewId, 'Bewoner Beta', '0611000822');
    return { a: oa.order, b: ob.order };
  });
  ok('twee huurders via één beheerder-adres: twee aparte klanten', !!tp.a && !!tp.b && tp.a.customerId !== tp.b.customerId, JSON.stringify([tp.a?.customerId, tp.b?.customerId]));
  await page.evaluate((i) => openOrderVers(i), tp.b.id); await page.waitForSelector('#modalRoot:not([hidden]) .ov-tabs'); await page.waitForTimeout(400);
  const bn = await page.evaluate(() => { const b = document.querySelector('#tp-banner'); return { er: !!b && b.offsetParent !== null, tekst: b ? b.innerText : '', knoppen: [...(b ? b.querySelectorAll('[data-tp]') : [])].map((k) => k.dataset.tp).join() }; });
  ok('de opdracht legt uit dat het adres niet als klantgegeven is opgeslagen en noemt de andere klant', bn.er && /beheer@vastgoed-proef\.test/.test(bn.tekst) && /Huurder Alfa/.test(bn.tekst) && /niet als klantgegeven/.test(bn.tekst) && bn.knoppen === 'toevoegen,negeren', JSON.stringify(bn));
  await page.click('#tp-banner [data-tp="toevoegen"]'); await page.waitForTimeout(700);
  ok('"Altijd zo behandelen": melding weg, adres staat op de lijst', await page.evaluate(async () => !document.querySelector('#tp-banner') && ((await fetch('/api/settings').then((r) => r.json())).tussenpersonen || []).includes('beheer@vastgoed-proef.test')));
  await page.evaluate(() => closeModal());
  await page.evaluate(() => goView('settings')); await page.waitForTimeout(1500);
  await instKies(page, 'inbox'); await page.waitForTimeout(600);
  ok('Instellingen → Aanvragen & inbox: lijst "Opdrachtgevers en tussenpersonen" met het adres erin', await page.evaluate(() => { const k = document.querySelector('#tussenpersonenKaart'); return !!k && k.offsetParent !== null && k.dataset.sg === 'inbox' && /beheer@vastgoed-proef\.test/.test(document.querySelector('#tussenpersonen').value); }));
  await page.fill('#tussenpersonen', 'gmail.com'); await page.click('#saveTussenpersonen'); await page.waitForTimeout(700);
  ok('gmail.com als domein wordt geweigerd met uitleg', await page.evaluate(() => { const t = document.querySelector('#toast'); return !!t && !t.hidden && /gmail\.com/.test(t.textContent); }));
  await page.fill('#tussenpersonen', 'beheer@vastgoed-proef.test'); await page.click('#saveTussenpersonen'); await page.waitForTimeout(700);
}
noErr('Tussenpersoon');

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
// WIJZIGINGEN OPSLAAN? (24 nov 2026, klacht eigenaar): elke manier van sluiten vraagt eerst —
// Esc, klik ernaast, het kruisje én de knop Sluiten — met Opslaan / Niet opslaan / Terug.
const svStand = () => page.evaluate(() => { const w = document.querySelector('#sluitVraag'); return { vraag: w ? w.querySelector('h3').textContent : '', knoppen: w ? [...w.querySelectorAll('button')].map((b) => b.id).join() : '', open: !document.querySelector('#modalRoot').hidden }; });
const notitieOpServer = () => page.evaluate((id) => fetch(`/api/orders/${id}`).then((r) => r.json()).then((o) => o.notes || ''), ikId);
await page.click('#f-notes');
await page.keyboard.type('Klant belt terug om 14:00');
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
let sv = await svStand();
ok('Esc met getypte notitie vraagt eerst "Wijzigingen opslaan?" (Opslaan / Niet opslaan / Terug)', sv.vraag === 'Wijzigingen opslaan?' && sv.knoppen === 'sv-opslaan,sv-weg,sv-terug' && sv.open, JSON.stringify(sv));
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
sv = await svStand();
ok('Esc in de vraag = terug: venster open, notitie staat er nog, niets weggegooid', !sv.vraag && sv.open && /14:00/.test(await page.inputValue('#f-notes')), JSON.stringify(sv));
await page.mouse.click(8, 450); await page.waitForTimeout(300); // naast het venster (achtergrond)
sv = await svStand();
ok('klik naast het venster met getypte notitie vraagt ook eerst', sv.vraag === 'Wijzigingen opslaan?' && sv.open, JSON.stringify(sv));
await page.click('#sv-terug'); await page.waitForTimeout(200);
await page.click('.ov-sluit'); await page.waitForTimeout(300);
sv = await svStand();
ok('het KRUISJE met getypte notitie vraagt eerst (was: sloot zonder iets te zeggen)', sv.vraag === 'Wijzigingen opslaan?' && sv.open, JSON.stringify(sv));
await page.click('#sv-terug'); await page.waitForTimeout(200);
ok('"Terug": venster open en de notitie staat er nog', (await svStand()).open && /14:00/.test(await page.inputValue('#f-notes')));
await page.click('#f-cancel'); await page.waitForTimeout(300);
sv = await svStand();
ok('de knop SLUITEN met getypte notitie vraagt eerst', sv.vraag === 'Wijzigingen opslaan?' && sv.open, JSON.stringify(sv));
await page.click('#sv-weg'); await page.waitForTimeout(500);
ok('"Niet opslaan": venster dicht en er is niets bewaard', !(await svStand()).open && !/14:00/.test(await notitieOpServer()), await notitieOpServer());
await page.evaluate((id) => openOrderModal(id), ikId); await page.waitForTimeout(900);
await page.click('#f-notes'); await page.keyboard.type('Bewaren via de vraag');
await page.click('.ov-sluit'); await page.waitForTimeout(300);
await page.click('#sv-opslaan'); await page.waitForTimeout(1200);
ok('"Opslaan" in de vraag bewaart en sluit het venster', !(await svStand()).open && /Bewaren via de vraag/.test(await notitieOpServer()), await notitieOpServer());
await page.evaluate((id) => openOrderModal(id), ikId); await page.waitForTimeout(900);
await page.click('.ov-sluit'); await page.waitForTimeout(300);
sv = await svStand();
ok('niets gewijzigd: kruisje sluit meteen, zonder vraag', !sv.vraag && !sv.open, JSON.stringify(sv));
await page.evaluate((id) => openOrderModal(id), ikId); await page.waitForTimeout(900);
await page.click('#f-urgent'); await page.click('#f-cancel'); await page.waitForTimeout(300);
sv = await svStand();
ok('alleen het vinkje Spoed gewijzigd telt ook als wijziging', sv.vraag === 'Wijzigingen opslaan?' && sv.open, JSON.stringify(sv));
await page.click('#sv-weg'); await page.waitForTimeout(400);
// Vervolgvenster: werkbon → Annuleren gooit getypt werk niet meer zomaar weg.
await page.evaluate((id) => openOrderModal(id), ikId); await page.waitForTimeout(900);
await page.click('#f-werkbon'); await page.waitForSelector('#wb-work');
await page.fill('#wb-work', 'Cilinder vervangen en afgesteld');
await page.click('#wb-cancel'); await page.waitForTimeout(300);
sv = await svStand();
ok('werkbon: Annuleren met getypt werk vraagt eerst', sv.vraag === 'Wijzigingen opslaan?' && await page.inputValue('#wb-work') === 'Cilinder vervangen en afgesteld', JSON.stringify(sv));
await page.click('#sv-weg'); await page.waitForSelector('.ov-tabs'); await page.waitForTimeout(300);
ok('"Niet opslaan" in de werkbon brengt je terug naar de opdracht', await page.locator('#f-title').count() === 1 && await page.locator('#wb-work').count() === 0);
// Eigen invoervenster (vraagTekst) annuleren → daarna werkt Esc nog steeds.
await page.click('#f-notes'); await page.keyboard.type('nog iets');
await page.evaluate(() => { vraagTekst({ titel: 'Test' }); });
await page.waitForTimeout(200);
await page.click('#md-cancel');
await page.waitForTimeout(200);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
ok('na een eigen invoervenster werkt Esc nog: de vraag komt', (await svStand()).vraag === 'Wijzigingen opslaan?');
await page.click('#sv-weg'); await page.waitForTimeout(400);
ok('…en "Niet opslaan" sluit het venster', await page.locator('#modalRoot').isHidden());
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

// 9d) FACTUREN DEZE MAAND (23 nov 2026, besluit eigenaar): blok boven "Omzet en kosten" met
// de tabbladen Verstuurd (standaard) en Betaald; volgt de maandkiezer; klik opent de factuur.
clear();
await page.evaluate(() => goView('finance'));
await page.waitForSelector('#facturenOmzetPanel .fo-tab', { timeout: 8000 }).catch(() => {});
const eurBt = (n) => '€ ' + Number(n || 0).toFixed(2).replace('.', ',');
const foLees = () => page.evaluate(async () => {
  const p = document.querySelector('#facturenOmzetPanel'); const fin = document.querySelector('#financePanel');
  const api = await fetch('/api/finance/facturen-omzet?maand=' + document.querySelector('#finMonth').value).then((r) => r.json());
  return {
    api: { v: api.verstuurd.aantal, vEx: api.verstuurd.exclBtw, b: api.betaald.aantal, bEx: api.betaald.exclBtw, open: api.openstaand.aantal, vRijen: api.verstuurd.facturen.length, bRijen: api.betaald.facturen.length },
    titel: (p.querySelector('h3') || {}).textContent || '', tabs: [...p.querySelectorAll('.fo-tab')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()),
    actief: (p.querySelector('.fo-tab.on') || {}).dataset?.tab || '', aantal: (p.querySelector('#foAantal') || {}).textContent || '', omzet: (p.querySelector('#foOmzet') || {}).textContent || '',
    open: (p.querySelector('#foOpen') || {}).textContent || '', rijen: p.querySelectorAll('.fo-rij').length, tekst: p.textContent.replace(/\s+/g, ' '),
    bovenOmzet: !!(p.compareDocumentPosition(fin) & Node.DOCUMENT_POSITION_FOLLOWING) && p.nextElementSibling === fin,
    tegels: fin.querySelectorAll('.stat-grid .stat').length, finKop: /Omzet en kosten/.test((fin.querySelector('.fin-kop') || {}).textContent || ''),
  };
});
const foV = await foLees();
ok('cijfers: blok "Facturen deze maand" direct boven "Omzet en kosten", tabbladen Verstuurd (standaard) en Betaald', /Facturen deze maand/.test(foV.titel) && foV.tabs.length === 2 && /^Verstuurd/.test(foV.tabs[0]) && /^Betaald/.test(foV.tabs[1]) && foV.actief === 'verstuurd' && foV.bovenOmzet, JSON.stringify({ t: foV.titel, tabs: foV.tabs, a: foV.actief, b: foV.bovenOmzet }));
ok('cijfers: tab Verstuurd toont aantal + omzet excl. btw + lijst, gelijk aan de server', foV.api.v >= 2 && foV.aantal === String(foV.api.v) && foV.omzet === eurBt(foV.api.vEx) && foV.rijen === foV.api.vRijen && foV.open === String(foV.api.open) && /Omzet verstuurde facturen excl\. btw/.test(foV.tekst), JSON.stringify({ api: foV.api, aantal: foV.aantal, omzet: foV.omzet, rijen: foV.rijen }));
ok('cijfers: uitlegregel Verstuurd/Betaald staat erbij; bestaande tegels ongemoeid (4 tegels, kop "Omzet en kosten")', /Verstuurd = facturen die in deze maand naar de klant zijn gegaan\. Betaald = facturen die in deze maand op betaald zijn gezet\./.test(foV.tekst) && foV.tegels === 4 && foV.finKop, JSON.stringify({ tegels: foV.tegels, kop: foV.finKop }));
await page.click('.fo-tab[data-tab="betaald"]');
await page.waitForFunction(() => (document.querySelector('#facturenOmzetPanel .fo-tab.on') || {}).dataset?.tab === 'betaald', null, { timeout: 4000 }).catch(() => {});
const foB = await foLees();
ok('cijfers: wisselen naar tab Betaald toont de betaalde facturen van de maand', foB.actief === 'betaald' && foB.api.b >= 1 && foB.aantal === String(foB.api.b) && foB.omzet === eurBt(foB.api.bEx) && foB.rijen === foB.api.bRijen && /Omzet betaalde facturen excl\. btw/.test(foB.tekst) && !foB.open, JSON.stringify({ api: foB.api, aantal: foB.aantal, omzet: foB.omzet, rijen: foB.rijen }));
// De gecorrigeerde factuur van 4b is verstuurd én betaald: hij staat in deze lijst met het NIEUWE bedrag.
const foRij = await page.evaluate((id) => { const r = document.querySelector(`#facturenOmzetPanel .fo-rij[data-inv="${id}"]`); return r ? r.textContent.replace(/\s+/g, ' ').trim() : ''; }, corrSetup.invId);
ok('cijfers: regel = nummer, klant, datum en bedrag excl. btw (na de correctie € 180,00)', foRij.includes(corrSetup.nummer) && /Locatie Browser Klant/.test(foRij) && /\d{2}-\d{2}/.test(foRij) && /€ 180,00/.test(foRij), foRij);
await page.click(`#facturenOmzetPanel .fo-rij[data-inv="${corrSetup.invId}"]`);
await page.waitForSelector('#inv-cancel', { timeout: 6000 }).catch(() => {});
ok('cijfers: klik op een regel opent die factuur', await page.evaluate((nr) => /Factuur — Locatie Browser Klant/.test((document.querySelector('#modal h2') || {}).textContent || '') && document.querySelector('#modal').textContent.includes(nr), corrSetup.nummer));
await page.evaluate(() => closeModal());
// Maandkiezer: een maand zonder facturen → nul + nette lege regel; daarna terug.
const foMaand = await page.inputValue('#finMonth');
await page.evaluate(() => { const m = document.querySelector('#finMonth'); m.value = '2020-01'; m.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForFunction(() => /2020-01/.test((document.querySelector('#facturenOmzetPanel h3') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
ok('cijfers: het blok volgt de maandkiezer (2020-01 → 0 facturen, "nog geen facturen")', await page.evaluate(() => document.querySelector('#foAantal').textContent === '0' && !document.querySelector('#facturenOmzetPanel .fo-rij') && /nog geen facturen/.test(document.querySelector('#facturenOmzetPanel .fo-leeg').textContent)));
await page.evaluate((m) => { const el = document.querySelector('#finMonth'); el.value = m; el.dispatchEvent(new Event('change', { bubbles: true })); }, foMaand);
await page.waitForFunction((m) => (document.querySelector('#facturenOmzetPanel h3') || {}).textContent.includes(m) && !!document.querySelector('#facturenOmzetPanel .fo-rij'), foMaand, { timeout: 6000 }).catch(() => {});
ok('cijfers: terug naar de lopende maand, gekozen tabblad blijft staan', await page.evaluate(() => (document.querySelector('#facturenOmzetPanel .fo-tab.on') || {}).dataset?.tab === 'betaald' && document.querySelectorAll('#facturenOmzetPanel .fo-rij').length >= 1));
// Filter actief: het blok zegt eerlijk dat het filter er niet voor geldt.
await page.selectOption('#cfBron', 'eigen');
await page.waitForFunction(() => /filter hierboven geldt niet/.test((document.querySelector('#facturenOmzetPanel .fo-uitleg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
ok('cijfers: bij een actief filter meldt het blok dat het alle facturen toont', await page.evaluate(() => /Het filter hierboven geldt niet voor dit blok/.test(document.querySelector('#facturenOmzetPanel .fo-uitleg').textContent)));
await page.click('#cfWis');
await page.waitForFunction(() => !document.querySelector('.cf-actief') && !/filter hierboven/.test((document.querySelector('#facturenOmzetPanel .fo-uitleg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
await page.click('.fo-tab[data-tab="verstuurd"]');
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
ok('cijfers: "Facturen deze maand" past op de telefoon (390 px, geen paginabrede overflow)', await page.evaluate(() => { const r = document.querySelector('#facturenOmzetPanel').getBoundingClientRect(); return r.right <= window.innerWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('#facturenOmzetPanel .fo-rij')].every((x) => x.getBoundingClientRect().right <= window.innerWidth + 1); }));
await page.setViewportSize({ width: 1280, height: 800 });
noErr('Cijfers (facturen deze maand)');

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
await instKies(page, 'facturen');
await page.waitForTimeout(200);
await page.evaluate(() => { state._sgroup = null; });
await page.evaluate(() => loadSettings());
await page.waitForTimeout(1200);
ok('instellingen openen op de laatst gekozen groep (Facturen)', await page.evaluate(() => document.querySelector('#settingsPanel .sg-chip.on')?.dataset.g === 'facturen'));
await page.waitForTimeout(1800);
// HANDTEKENING PER MEDEWERKER (23 sep): blok gevuld met een rij per account + testmail-knop.
await instKies(page, 'bericht');
await page.waitForFunction(() => document.querySelectorAll('#sigPerUser .sig-user').length > 0, null, { timeout: 8000 });
const sigRij = await page.evaluate(() => ({ rijen: document.querySelectorAll('#sigPerUser .sig-user').length, test: document.querySelectorAll('#sigPerUser .su-test').length, voorbeeld: [...document.querySelectorAll('#sigPerUser .sig-user-tekst')].some((e) => /Met vriendelijke groet/.test(e.textContent)) }));
ok('Instellingen → AI: knop "Test AI-modellen" aanwezig', await page.locator('#testAiModellen').count() === 1);
ok('handtekening per medewerker: rij per account, testmail-knop, voorbeeldtekst', sigRij.rijen >= 2 && sigRij.test === sigRij.rijen && sigRij.voorbeeld, JSON.stringify(sigRij));
await instKies(page, 'facturen'); // terug naar de groep van de volgende asserties
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
// WHATSAPP-STIJL LIJST (20 okt 2026, screenshot eigenaar): op de telefoon rechtop vielen tijd
// en groene teller rechts buiten beeld — een lange voorbeeldregel maakte de kolom breder dan
// het scherm. Nu: rondje met initialen, vinkjes, teller altijd zichtbaar, filterknoppen.
{
  await page.evaluate(() => fetch('/api/ingest/whatsapp', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-token': 'test123' }, body: JSON.stringify({ name: 'Lange Tekst Klant', body: 'Goedemiddag, ik heb een heel lang verhaal over mijn hefschuifpui die al weken tocht en waarvan de hendel steeds vaster komt te zitten, kunnen jullie morgen langskomen?', fromPhone: '0611777555', externalId: 'br-chat-lang' }) }));
  await page.evaluate(() => loadChats());
  await page.waitForSelector('.chat-item.ongelezen', { timeout: 6000 }).catch(() => {});
  const maat = await page.evaluate(() => ({ vw: innerWidth, docW: document.documentElement.scrollWidth, items: [...document.querySelectorAll('.chat-item')].map((e) => Math.round(e.getBoundingClientRect().right)), tellers: [...document.querySelectorAll('.chat-unread, .ci-time')].map((e) => Math.round(e.getBoundingClientRect().right)), zoek: Math.round(document.querySelector('#chatZoek').getBoundingClientRect().right) }));
  ok('mobiel: gesprekkenlijst valt binnen het scherm (tijd + groene teller zichtbaar)', maat.docW <= maat.vw && maat.items.every((r) => r <= maat.vw) && maat.tellers.length > 0 && maat.tellers.every((r) => r <= maat.vw) && maat.zoek <= maat.vw, JSON.stringify(maat));
  ok('WhatsApp-stijl: rondje met initialen bij elk gesprek', await page.locator('.chat-item .ci-av').count() === await page.locator('.chat-item').count());
  const lang = page.locator('.chat-item', { hasText: 'Lange Tekst Klant' });
  ok('ongelezen gesprek: groene teller + vet (klasse ongelezen)', await lang.locator('.chat-unread').count() === 1 && await lang.evaluate((e) => e.classList.contains('ongelezen')));
  await page.click('.chat-filter[data-f="ongelezen"]');
  ok('filter "Ongelezen" toont alleen ongelezen gesprekken', await page.evaluate(() => { const r = [...document.querySelectorAll('.chat-item')]; return r.length > 0 && r.every((e) => e.classList.contains('ongelezen')); }));
  await page.click('.chat-filter[data-f="wacht"]');
  ok('filter "Wacht op antwoord" toont alleen gesprekken waar de klant wacht', await page.evaluate(() => { const r = [...document.querySelectorAll('.chat-item')]; return r.length > 0 && r.every((e) => e.classList.contains('wacht')); }));
  await page.locator('.chat-item').first().click();
  await page.waitForSelector('#cpAfgehandeld', { timeout: 6000 }).catch(() => {});
  ok('gesprek met wachtende klant: balk "wacht op een antwoord" + knop Afgehandeld', await page.locator('#cpAfgehandeld').count() === 1);
  await page.click('#cpAfgehandeld');
  await page.waitForFunction(() => !document.querySelector('#cpWacht'), null, { timeout: 6000 }).catch(() => {});
  ok('Afgehandeld haalt de wacht-balk weg', await page.locator('#cpWacht').count() === 0);
  await page.click('#cpBack');
  await page.waitForTimeout(600);
  await page.click('.chat-filter[data-f="alle"]');
  await page.waitForTimeout(300);
}
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
  // INSTELLINGEN OPNIEUW GEORDEND (23 nov 2026): de pillenbalk is vervangen door een lijst
  // met onderwerpen; op de telefoon open je er één en ga je terug met "Alle instellingen".
  await page.evaluate(() => { const t = document.querySelector('#instTerug'); if (t && t.offsetParent) t.click(); });
  await page.waitForTimeout(200);
  const inst0 = await page.evaluate(() => ({ lijst: !!document.querySelector('.inst-nav')?.offsetParent, onderwerpen: document.querySelectorAll('.inst-nav .sg-chip').length, kaartenInBeeld: [...document.querySelectorAll('#settingsPanel .inst-inhoud > [data-sg]')].filter((e) => e.offsetParent).length, totaal: document.querySelectorAll('#settingsPanel .inst-inhoud > [data-sg]').length, zoek: !!document.querySelector('#instZoek')?.offsetParent }));
  ok('mobiel: Instellingen begint met de lijst van 8 onderwerpen (+ "alles") en een zoekveld', inst0.lijst && inst0.onderwerpen === 9 && inst0.kaartenInBeeld === 0 && inst0.zoek, JSON.stringify(inst0));
  const instG = await page.evaluate(() => { const goed = ['werk', 'inbox', 'bericht', 'facturen', 'team', 'ai', 'koppel', 'systeem']; const k = [...document.querySelectorAll('#settingsPanel .inst-inhoud > [data-sg]')]; return { zonder: k.filter((e) => !goed.includes(e.dataset.sg)).map((e) => (e.querySelector('h3')?.textContent || '').trim().slice(0, 30)), buiten: [...document.querySelectorAll('#settingsPanel .card')].filter((e) => !e.closest('.inst-inhoud')).length }; });
  ok('Instellingen: geen enkel blok is verdwenen (minstens 37) en elk blok hoort bij één van de 8 onderwerpen', inst0.totaal >= 37 && instG.zonder.length === 0 && instG.buiten === 0, JSON.stringify({ totaal: inst0.totaal, ...instG }));
  await page.click('#settingsPanel .sg-chip[data-g="bericht"]'); await page.waitForTimeout(400);
  const inst1 = await page.evaluate(() => ({ lijst: !!document.querySelector('.inst-nav')?.offsetParent, terug: !!document.querySelector('#instTerug')?.offsetParent, kop: document.querySelector('#instKop')?.textContent, titels: [...document.querySelectorAll('#settingsPanel .inst-inhoud > [data-sg]')].filter((e) => e.offsetParent).map((e) => (e.querySelector('h3')?.textContent || '').trim().slice(0, 22)) }));
  ok('mobiel: een onderwerp openen toont alleen dat onderwerp, met een terugknop', !inst1.lijst && inst1.terug && inst1.kop === 'Berichten aan klanten' && inst1.titels.length === 10 && /WhatsApp/i.test(inst1.titels[0]) && inst1.titels.some((t) => /ontvangst/i.test(t)), JSON.stringify(inst1));
  await page.evaluate(() => loadSettings()); await page.waitForTimeout(1200);
  ok('mobiel: na opnieuw opbouwen (zoals na Opslaan) blijf je in het onderwerp', await page.evaluate(() => !document.querySelector('.inst-nav')?.offsetParent && document.querySelector('#instKop')?.textContent === 'Berichten aan klanten'));
  await page.click('#instTerug'); await page.waitForTimeout(300);
  await page.fill('#instZoek', 'prijslijst'); await page.waitForTimeout(400);
  const instZ = await page.evaluate(() => [...document.querySelectorAll('#settingsPanel .inst-inhoud > [data-sg]')].filter((e) => e.offsetParent).map((e) => (e.querySelector('h3')?.textContent || '').trim()));
  ok('Instellingen: zoeken op "prijslijst" vindt het blok Prijslijst, uit welk onderwerp ook', instZ.length >= 1 && instZ.some((t) => /Prijslijst/.test(t)) && instZ.length < 12, instZ.join(' | ').slice(0, 200));
  // Op de telefoon staat het zoekveld in de lijst; de resultaten vullen het scherm. Terug = zoekveld leeg.
  await page.click('#instTerug'); await page.waitForTimeout(300);
  ok('mobiel: terug vanuit de zoekresultaten toont de lijst weer, met een leeg zoekveld', await page.evaluate(() => !!document.querySelector('.inst-nav')?.offsetParent && document.querySelector('#instZoek').value === ''));
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
  await inboxOpenMet(page, 'afwijs@example.nl'); await page.waitForTimeout(200);
  await rij.locator('.r-reject').click();
  await page.waitForTimeout(700);
  ok('1-klik afwijzen: melding met Ongedaan maken + Reden toevoegen, geen venster', await page.locator('#tr-undo').count() === 1 && await page.locator('#tr-reason').count() === 1 && await page.locator('#rj-save').count() === 0);
  await page.click('#tr-undo');
  await page.waitForTimeout(900);
  const terug = await page.evaluate(() => fetch('/api/reviews?status=all').then((r) => r.json()).then((d) => (d.items || d).find((x) => /br-afwijs-1|afwijs@example/.test(JSON.stringify(x)))?.status));
  ok('ongedaan maken zet het bericht terug in de wachtrij', terug === 'pending', String(terug));
  await page.waitForTimeout(600);
  const rij2 = page.locator('#reviewList .review', { hasText: 'afwijs@example.nl' }).first();
  await inboxOpenMet(page, 'afwijs@example.nl'); await page.waitForTimeout(200);
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
  await page.waitForSelector('#inboxMore', { state: 'attached', timeout: 8000 }).catch(() => {});
  await inboxToonMeer(page);
  await page.waitForTimeout(1200);
  const rijenVoor = await page.locator('#reviewList .review').count();
  // De leespositie zit op de pc in de lijst links (die schuift zelf); daar meten we.
  const anker = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#inboxLijst .il-item')];
    const el = rows[rows.length - 3]; el.scrollIntoView({ block: 'start' }); document.querySelector('#inboxLijst').scrollTop -= 100;
    return { id: el.dataset.id, top: el.getBoundingClientRect().top, y: document.querySelector('#inboxLijst').scrollTop };
  });
  await ingest(999, aanvraag(999));
  const nieuwIn = await page.waitForFunction(() => /Live Klant 999/.test(document.querySelector('#reviewList')?.textContent || ''), null, { timeout: 15000 }).then(() => true).catch(() => false);
  const naInbox = await page.evaluate((id) => { const el = document.querySelector(`#inboxLijst .il-item[data-id="${id}"]`); return { rijen: document.querySelectorAll('#reviewList .review').length, top: el ? el.getBoundingClientRect().top : null, y: window.scrollY }; }, anker.id);
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
  // MIJN DAG (24 nov 2026): een afspraak van vandaag staat bovenaan het bord van de monteur.
  ok('monteur: de uitleg-balk staat boven "Mijn dag" en noemt in het venster zijn eigen punten', await mp.evaluate(async () => { const b = document.querySelector('#mijnDag #nieuwBalk'); if (!b) return false; b.querySelector('[data-nieuw="toon"]').click(); await new Promise((r) => setTimeout(r, 300)); const t = document.querySelector('#modal').innerText; const goed = /Mijn dag/.test(t) && /Werkbon, Factuur en Onderweg/.test(t) && !/Instellingen/.test(t); document.querySelector('#nw-ok').click(); await new Promise((r) => setTimeout(r, 300)); return goed && !document.querySelector('#nieuwBalk'); }));
  ok('monteur zonder afspraak vandaag: "Mijn dag" zegt dat eerlijk', await mp.evaluate(() => { const e = document.querySelector('#mijnDag'); return !!e && !e.hidden && /geen afspraken vandaag/.test(e.textContent); }));
  const mdOk = await mp.evaluate(async (id) => {
    const d = new Date(); const p = (n) => String(n).padStart(2, '0'); const dag = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const r = await fetch('/api/orders/' + id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appointmentAt: dag + 'T23:30', appointmentEndAt: dag + 'T23:45' }) });
    await loadBoard(); return r.status;
  }, gemaakt && gemaakt.id);
  await mp.waitForTimeout(600);
  const md = await mp.evaluate(() => { const e = document.querySelector('#mijnDag'); const rij = e && e.querySelector('.md-rij'); return { zichtbaar: !!e && !e.hidden, tekst: e ? e.innerText.replace(/\s+/g, ' ') : '', bel: !!(rij && rij.querySelector('a[href^="tel:0611009988"]')), bovenBord: !!e && (e.compareDocumentPosition(document.querySelector('#board')) & Node.DOCUMENT_POSITION_FOLLOWING) > 0 }; });
  ok('monteur: afspraak van vandaag staat in "Mijn dag" boven het bord, met tijd en belknop', mdOk === 200 && md.zichtbaar && /1 afspraak vandaag/.test(md.tekst) && /23:30/.test(md.tekst) && /noodroute via scherm/.test(md.tekst) && md.bel && md.bovenBord, JSON.stringify([mdOk, md]));
  await mp.click('#mijnDag [data-md-open]'); await mp.waitForTimeout(700);
  ok('monteur: tik op de afspraak opent de opdracht', await mp.locator('#f-title').count() === 1 && /noodroute via scherm/.test(await mp.inputValue('#f-title')));
  await mp.evaluate(() => closeModal());
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
  // Betaald-vraag óók voor de monteur (vraag eigenaar 7 okt): factuur op zijn eigen opdracht.
  const mInvId = await mp.evaluate(async ([orderId, customerId]) => {
    const r = await fetch('/api/invoices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId, customerId, type: 'factuur' }) }).then((x) => x.json());
    const inv = r.invoice || r;
    await fetch('/api/invoices/' + inv.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines: [{ description: 'Cilinder', qty: 1, priceExcl: 80 }], btwPct: 21 }) });
    return inv.id || JSON.stringify(r).slice(0, 120);
  }, [gemaakt && gemaakt.id, gemaakt && gemaakt.customerId]);
  await mp.evaluate((id) => { if (typeof closeModal === 'function') closeModal(); window.openStandaloneInvoice(id); }, mInvId);
  await mp.waitForSelector('#inv-send-wa', { timeout: 6000 }).catch(() => {});
  await mp.click('#inv-send-wa').catch(() => {});
  await mp.waitForSelector('#bk-ja', { timeout: 5000 }).catch(() => {});
  const mBk = await mp.evaluate(() => ({ ja: !!document.querySelector('#bk-ja'), nee: !!document.querySelector('#bk-nee'), tekst: (document.querySelector('.bk-dialog') || {}).textContent || '' }));
  ok('monteur: bij versturen van een factuur óók de vraag "Kan deze factuur als betaald worden verstuurd?"', mBk.ja && mBk.nee && /betaald/i.test(mBk.tekst), JSON.stringify({ ...mBk, tekst: mBk.tekst.slice(0, 80), inv: mInvId }));
  await mp.click('#bk-cancel').catch(() => {});
  // REPARATIELOCATIE + CORRIGEREN (23 nov 2026): de monteur vult de reparatielocatie zelf in op
  // de factuur van zijn eigen opdracht; een vergrendelde factuur corrigeren is kantoorwerk.
  await mp.waitForSelector('#inv-rep', { timeout: 6000 }).catch(() => {});
  ok('monteur: veld "Reparatielocatie" staat in zijn factuur-editor en is in te vullen', await mp.evaluate(() => { const el = document.querySelector('#inv-rep'); return !!el && !el.disabled && el.offsetParent !== null; }));
  await mp.fill('#inv-rep', 'Achterom via de steeg, Dorpsstraat 2, Rhenen').catch(() => {});
  await mp.click('#inv-save').catch(() => {});
  await mp.waitForFunction(() => !document.querySelector('#inv-save'), null, { timeout: 8000 }).catch(() => {});
  ok('monteur: ingevulde reparatielocatie is opgeslagen', await mp.evaluate((id) => fetch('/api/invoices/' + id).then((r) => r.json()).then((d) => d.invoice.reparatieAdres), mInvId) === 'Achterom via de steeg, Dorpsstraat 2, Rhenen');
  await mp.evaluate((id) => fetch('/api/invoices/' + id + '/send-whatsapp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ betaald: true }) }).then((r) => r.json()), mInvId);
  await mp.evaluate((id) => { if (typeof closeModal === 'function') closeModal(); window.openStandaloneInvoice(id); }, mInvId);
  await mp.waitForSelector('#inv-resend', { timeout: 6000 }).catch(() => {});
  const mSlot = await mp.evaluate(() => ({ vergrendeld: /Dit document is vergrendeld/.test((document.querySelector('#modal') || {}).textContent || ''), corr: !!document.querySelector('#inv-corr'), save: !!document.querySelector('#inv-save'), rep: (document.querySelector('#inv-rep') || {}).value || '' }));
  ok('monteur: vergrendelde factuur ZONDER knop "Corrigeren" (kantoorwerk); reparatielocatie blijft zichtbaar', mSlot.vergrendeld && !mSlot.corr && !mSlot.save && mSlot.rep === 'Achterom via de steeg, Dorpsstraat 2, Rhenen', JSON.stringify(mSlot));
  await mp.evaluate(() => closeModal());
  ok('monteur-scherm zonder JS-fouten', !mErr.filter((e) => !/favicon|manifest|ServiceWorker/i.test(e)).length, mErr.join(' | '));
  // NIEUWE OFFERTE/FACTUUR BIJ EEN BESTAANDE, AFGERONDE KLANT (26 okt 2026, wens eigenaar): de
  // knoppen op de opdracht openden altijd de oude (betaalde) factuur. Nu eerst kiezen.
  const oudeKlus = await page.evaluate(async (monteurId) => {
    const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    const o = await post('/api/orders', { customerName: 'Afgeronde Klant', customerPhone: '0611009966', title: 'Ede — oude klus', monteurId });
    await post(`/api/orders/${o.id}/invoice`, { lines: [{ description: 'Slot', qty: 1, priceExcl: 120 }], btwPct: 21, type: 'factuur' });
    await fetch('/api/orders/' + o.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'afgerond' }) });
    return o.id;
  }, mSetup.monteurId);
  mErr.length = 0;
  await mp.evaluate((id) => { if (typeof closeModal === 'function') closeModal(); openOrderVers(id); }, oudeKlus);
  await mp.waitForSelector('#f-quote', { timeout: 6000 }).catch(() => {});
  await mp.click('#f-quote').catch(() => {});
  await mp.waitForSelector('[data-dockeuze]', { timeout: 6000 }).catch(() => {});
  const keuze = await mp.evaluate(() => ({ titel: (document.querySelector('[data-dockeuze]') || {}).textContent || '', rijen: document.querySelectorAll('#dk-lijst .doc-keuze-rij').length, nieuw: (document.querySelector('#dk-nieuw') || {}).textContent || '' }));
  ok('monteur: "Offerte" op een afgeronde opdracht met factuur → eerst kiezen (oude factuur + "+ Nieuwe offerte")', /Offerte/.test(keuze.titel) && keuze.rijen === 1 && /Nieuwe offerte/.test(keuze.nieuw), JSON.stringify(keuze));
  ok('monteur: keuzevenster past op 390 px', await mp.evaluate(() => document.documentElement.scrollWidth <= 392));
  await mp.click('#dk-nieuw').catch(() => {});
  await mp.waitForFunction(() => /OFF-\d{4}-\d+/.test((document.querySelector('#modal') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
  const editor = await mp.evaluate(() => ({ h: (document.querySelector('#modal h2') || {}).textContent || '', nr: ((document.querySelector('#modal') || {}).textContent || '').match(/OFF-\d{4}-\d+/)?.[0] || '' }));
  ok('monteur: "+ Nieuwe offerte" opent een nieuwe offerte voor die klant (eigen nummer)', /Offerte — Afgeronde Klant/.test(editor.h) && !!editor.nr, JSON.stringify(editor));
  ok('monteur: geen knoppen "Regels → prijslijst/pakket" (alleen kantoor; gaven een foutmelding)', await mp.locator('#il-to-pricelist, #il-to-bundle').count() === 0);
  const docsNa = await mp.evaluate((id) => fetch(`/api/orders/${id}/invoice`).then((r) => r.json()).then((d) => (d.documenten || []).map((x) => `${x.type}:${x.bijDezeOpdracht ? 'bij' : 'los'}`)), oudeKlus);
  ok('monteur: nieuwe offerte is los (de oude opdracht houdt zijn factuur)', docsNa.includes('offerte:los') && docsNa.includes('factuur:bij'), JSON.stringify(docsNa));
  await mp.evaluate(() => closeModal());
  // + Offerte op Facturen: zijn afgeronde klant staat in de lijst, met de laatste opdracht.
  await mp.evaluate(() => openNewInvoiceFlow('offerte'));
  await mp.waitForSelector('.ni-hit', { timeout: 6000 }).catch(() => {});
  const nfl = await mp.evaluate(() => ({ hits: [...document.querySelectorAll('.ni-hit')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()), nieuweKlant: !!document.querySelector('#ni-newcust') }));
  ok('monteur: + Offerte toont zijn afgeronde klant met laatste opdracht, zonder "nieuwe klant"-knop die toch niet mag', nfl.hits.some((t) => /Afgeronde Klant/.test(t) && /Laatste opdracht: Ede — oude klus/.test(t)) && !nfl.nieuweKlant, JSON.stringify(nfl));
  await mp.evaluate(() => closeModal());
  ok('monteur: keuzevenster en nieuwe offerte zonder JS-fouten', !mErr.filter((e) => !/favicon|manifest|ServiceWorker/i.test(e)).length, mErr.join(' | '));
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
// ECHT KLIKKEN (6 okt 2026, casus eigenaar: "Cannot set properties of null (setting
// 'innerHTML')" NA een geslaagde verzending). De testserver heeft geen mailserver, dus het
// antwoord wordt nagebootst; de fout zat in het scherm, ná het antwoord.
const tpNep = (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, to: 'trust@example.nl', trustpilotAt: new Date().toISOString() }) });
await page.route('**/api/orders/*/trustpilot', tpNep);
await page.evaluate(() => { const t = document.querySelector('#toast'); if (t) { t.hidden = true; t.textContent = ''; t.className = 'toast'; } });
page.once('dialog', (d) => d.accept());
await page.click('#f-trustpilot');
await page.waitForFunction(() => /✓/.test((document.querySelector('#f-trustpilot') || {}).textContent || '') || (document.querySelector('#toast.err') && !document.querySelector('#toast').hidden), null, { timeout: 6000 }).catch(() => {});
const tpKlik = await page.evaluate(() => { const t = document.querySelector('#toast'); return { knop: (document.querySelector('#f-trustpilot') || {}).textContent || '', toast: t ? t.textContent : '', fout: !!(t && !t.hidden && t.classList.contains('err')) }; });
ok('knop Trustpilot op de opdracht: na versturen ✓ op de knop en GEEN foutmelding', /✓/.test(tpKlik.knop) && !tpKlik.fout && /verstuurd naar trust@example\.nl/.test(tpKlik.toast), JSON.stringify(tpKlik));
await page.unroute('**/api/orders/*/trustpilot', tpNep);
await page.evaluate(() => closeModal());
// Knop "Trustpilot" ook bij Facturen (lijst + geopende factuur), naast Review.
const tpStatusVooraf = await page.evaluate(async (id) => { const r = await fetch('/api/invoices/' + id).then((x) => x.json()); const st = (r.invoice || r).status; await fetch('/api/invoices/' + id + '/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'betaald' }) }); return st; }, tpSetup.invId);
await page.evaluate(() => goView('invoices'));
await page.waitForSelector(`.inv-tp[data-id="${tpSetup.invId}"]`, { timeout: 8000 }).catch(() => {});
ok('Facturen-lijst: knop "Trustpilot" bij een betaalde factuur', await page.locator(`.inv-tp[data-id="${tpSetup.invId}"]`).count() === 1);
const tpNepF = (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, to: 'trust@example.nl', trustpilotAt: new Date().toISOString() }) });
await page.route('**/api/invoices/*/trustpilot', tpNepF);
await page.evaluate(() => { const t = document.querySelector('#toast'); if (t) { t.hidden = true; t.textContent = ''; t.className = 'toast'; } });
page.once('dialog', (d) => d.accept());
await page.click(`.inv-tp[data-id="${tpSetup.invId}"]`);
await page.waitForFunction(() => /verstuurd naar/.test((document.querySelector('#toast') || {}).textContent || '') || (document.querySelector('#toast.err') && !document.querySelector('#toast').hidden), null, { timeout: 6000 }).catch(() => {});
const tpLijst = await page.evaluate(() => { const t = document.querySelector('#toast'); return { toast: t ? t.textContent : '', fout: !!(t && !t.hidden && t.classList.contains('err')) }; });
ok('Facturen-lijst: Trustpilot-knop verstuurt zonder foutmelding', !tpLijst.fout && /verstuurd naar trust@example\.nl/.test(tpLijst.toast), JSON.stringify(tpLijst));
await page.evaluate((id) => window.openStandaloneInvoice(id), tpSetup.invId);
await page.waitForSelector('#inv-tp', { timeout: 6000 }).catch(() => {});
ok('geopende factuur: knop "Trustpilot" staat er', await page.locator('#inv-tp').count() === 1);
await page.evaluate(() => { const t = document.querySelector('#toast'); if (t) { t.hidden = true; t.textContent = ''; t.className = 'toast'; } });
page.once('dialog', (d) => d.accept());
await page.click('#inv-tp');
await page.waitForFunction(() => /✓/.test((document.querySelector('#inv-tp') || {}).textContent || '') || (document.querySelector('#toast.err') && !document.querySelector('#toast').hidden), null, { timeout: 6000 }).catch(() => {});
const tpEditor = await page.evaluate(() => { const t = document.querySelector('#toast'); return { knop: (document.querySelector('#inv-tp') || {}).textContent || '', fout: !!(t && !t.hidden && t.classList.contains('err')), toast: t ? t.textContent : '' }; });
ok('geopende factuur: Trustpilot-knop → ✓ zonder foutmelding', /✓/.test(tpEditor.knop) && !tpEditor.fout, JSON.stringify(tpEditor));
await page.unroute('**/api/invoices/*/trustpilot', tpNepF);
await page.evaluate(() => closeModal());
// Zet de factuur terug zoals hij was voor de verstuur-vinkje-checks hieronder.
if (tpStatusVooraf && tpStatusVooraf !== 'betaald') await page.evaluate(async ([id, st]) => { await fetch('/api/invoices/' + id + '/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: st }) }); }, [tpSetup.invId, tpStatusVooraf]);
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

// FACTUREN VASTPINNEN + TELLER MAX. 2 MAANDEN (16 okt 2026, wens eigenaar).
clear();
const pinNieuw = await page.evaluate(async (custFrom) => {
  // Een nieuwere factuur maken, zodat de Trustpilot-factuur NIET meer bovenaan staat.
  const r = await fetch('/api/invoices/' + custFrom).then((x) => x.json());
  const i = await fetch('/api/invoices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ customerId: (r.invoice || r).customerId, type: 'factuur' }) }).then((x) => x.json());
  return (i.invoice || i).id;
}, tpSetup.invId);
await page.evaluate(() => goView('invoices'));
await page.waitForSelector(`.inv-pin[data-id="${tpSetup.invId}"]`, { timeout: 8000 }).catch(() => {});
// Gecorrigeerde factuur (23 nov 2026, zie 4b): klein label "gecorrigeerd" in de lijst, alleen daar.
ok('Facturen-lijst: label "gecorrigeerd" op de gecorrigeerde factuur (en alleen daar)', await page.evaluate((id) => { const alle = [...document.querySelectorAll('#invoiceList .inv-gecorr')]; return alle.length === 1 && alle[0].textContent.trim() === 'gecorrigeerd' && !!alle[0].closest(`.inv-rij[data-inv="${id}"]`); }, corrSetup.invId), await page.evaluate(() => String(document.querySelectorAll('#invoiceList .inv-gecorr').length)));
const pinVooraf = await page.evaluate(() => (document.querySelector('#invoiceList .inv-rij') || {}).dataset?.inv || '');
ok('vooraf: de te pinnen factuur staat niet bovenaan', !!pinNieuw && pinVooraf !== tpSetup.invId, JSON.stringify({ pinVooraf }));
await page.click(`.inv-pin[data-id="${tpSetup.invId}"]`);
await page.waitForSelector('#md-input', { timeout: 4000 }).catch(() => {});
ok('vastpinnen vraagt om een (optionele) reden', await page.locator('#md-input').count() === 1);
await page.fill('#md-input', 'klant belt vrijdag terug');
await page.click('#md-ok');
await page.waitForFunction((id) => (document.querySelector('#invoiceList .inv-rij') || {}).dataset?.inv === id, tpSetup.invId, { timeout: 6000 }).catch(() => {});
const pinNa = await page.evaluate(() => { const r = document.querySelector('#invoiceList .inv-rij'); return { id: r?.dataset.inv, vast: r?.classList.contains('inv-vast'), kop: (r?.querySelector('.inv-vast-kop') || {}).textContent || '', knop: (r?.querySelector('.inv-pin') || {}).textContent || '', teller: (document.querySelector('.inv-teller') || {}).textContent || '' }; });
ok('na vastpinnen staat hij BOVENAAN, gemarkeerd, met reden', pinNa.id === tpSetup.invId && pinNa.vast && /Vastgepind/.test(pinNa.kop) && /vrijdag terug/.test(pinNa.kop) && /Losmaken/.test(pinNa.knop), JSON.stringify(pinNa));
ok('teller noemt "1 vastgepind"', /1 vastgepind/.test(pinNa.teller), pinNa.teller);
await page.selectOption('#invFilter', 'vastgepind');
ok('filter "Vastgepind" toont alleen de vastgepinde', await page.evaluate((id) => { const r = [...document.querySelectorAll('#invoiceList .inv-rij')]; return r.length === 1 && r[0].dataset.inv === id; }, tpSetup.invId));
await page.selectOption('#invFilter', 'all');
// Vanuit het geopende venster losmaken: venster blijft open, knop wisselt.
await page.evaluate((id) => window.openStandaloneInvoice(id), tpSetup.invId);
await page.waitForSelector('#inv-pin', { timeout: 6000 }).catch(() => {});
ok('geopende factuur: knop "Losmaken" (staat vast)', /Losmaken/.test(await page.locator('#inv-pin').textContent().catch(() => '')));
await page.click('#inv-pin');
await page.waitForFunction(() => /Vastpinnen/.test((document.querySelector('#inv-pin') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
ok('losmaken in het venster: knop wordt "Vastpinnen", venster blijft open', /Vastpinnen/.test(await page.locator('#inv-pin').textContent().catch(() => '')));
await page.evaluate(() => closeModal());
await page.waitForFunction((id) => !document.querySelector(`#invoiceList .inv-rij[data-inv="${id}"].inv-vast`), tpSetup.invId, { timeout: 6000 }).catch(() => {});
ok('na losmaken: niet meer gemarkeerd en niet meer bovenaan', await page.evaluate((id) => !document.querySelector(`.inv-rij[data-inv="${id}"].inv-vast`) && (document.querySelector('#invoiceList .inv-rij') || {}).dataset?.inv !== id, tpSetup.invId));
// TELLER: nagebootste lijst met een recente open, een OUDE open (3 mnd, verlopen) en een betaalde.
const dag = 86400000; const nu = Date.now();
const nepLijst = [
  { id: 'inv_recent', number: '2026-9001', type: 'factuur', status: 'verzonden', totalIncl: 121, sentAt: new Date(nu - 10 * dag).toISOString(), createdAt: new Date(nu - 10 * dag).toISOString(), dueAt: new Date(nu + 5 * dag).toISOString(), customerName: 'Recent Klant' },
  { id: 'inv_oud', number: '2026-9002', type: 'factuur', status: 'verzonden', totalIncl: 500, sentAt: new Date(nu - 90 * dag).toISOString(), createdAt: new Date(nu - 90 * dag).toISOString(), dueAt: new Date(nu - 80 * dag).toISOString(), customerName: 'Oud Klant' },
  { id: 'inv_bet', number: '2026-9003', type: 'factuur', status: 'betaald', totalIncl: 242, sentAt: new Date(nu - 3 * dag).toISOString(), createdAt: new Date(nu - 3 * dag).toISOString(), paidAt: new Date(nu - 3 * dag).toISOString(), customerName: 'Betaald Klant' },
];
const nepFacturen = (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nepLijst) });
await page.route('**/api/invoices', nepFacturen);
await page.evaluate(() => loadInvoices());
await page.waitForFunction(() => document.querySelectorAll('#invoiceList .inv-rij').length === 3, null, { timeout: 6000 }).catch(() => {});
const teller = await page.evaluate(() => (document.querySelector('.inv-teller') || {}).textContent.replace(/\s+/g, ' ') || '');
ok('teller "Openstaand" telt alleen open facturen van max. 2 maanden (€ 121, niet € 621)', /Openstaand \(laatste 2 mnd\): € 121,00/.test(teller) && !/621/.test(teller), teller);
ok('oude open factuur telt NIET mee als "verlopen"', !/verlopen/.test(teller.split('Niet meegeteld')[0]), teller);
ok('oude open facturen staan apart vermeld (aantal + bedrag)', /Niet meegeteld: 1 open factuur ouder dan 2 maanden \(€ 500,00\)/.test(teller), teller);
await page.click('.inv-teller-oud-knop');
ok('klik op "ouder dan 2 maanden" → filter toont alleen de oude', await page.evaluate(() => { const r = [...document.querySelectorAll('#invoiceList .inv-rij')]; return r.length === 1 && r[0].dataset.inv === 'inv_oud' && document.querySelector('#invFilter').value === 'oud'; }));
await page.selectOption('#invFilter', 'verlopen');
ok('filter "Verlopen" volgt dezelfde 2-maandengrens (oude staat onder "ouder dan 2 mnd")', await page.evaluate(() => document.querySelectorAll('#invoiceList .inv-rij').length === 0));
await page.selectOption('#invFilter', 'all');
await page.unroute('**/api/invoices', nepFacturen);
await page.evaluate(() => loadInvoices());
// Assistente-weergave is in rollen-test gedekt; de monteur ziet geen pin-knop.
ok('pin-knop alleen voor kantoor (pinKnopMag)', await page.evaluate(() => { const echt = state.me.role; state.me.role = 'monteur'; const m = pinKnopMag(); state.me.role = echt; return m === false && pinKnopMag() === true; }));
noErr('Facturen vastpinnen + teller');

// FACTUUR AFSCHRIJVEN / ONINBAAR (16 okt 2026, keuze A van de eigenaar).
clear();
const afId = await page.evaluate(async () => {
  const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  const c = await post('/api/customers', { name: 'Afschrijf Klant', email: 'af@example.nl' });
  const i = await post('/api/invoices', { customerId: c.id, type: 'factuur' });
  const inv = i.invoice || i;
  await fetch('/api/invoices/' + inv.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines: [{ description: 'Slot', qty: 1, priceExcl: 50 }], btwPct: 21 }) });
  await post('/api/invoices/' + inv.id + '/status', { status: 'verzonden' });
  return inv.id;
});
await page.evaluate(() => goView('invoices'));
await page.evaluate((id) => window.openStandaloneInvoice(id), afId);
await page.waitForSelector('#inv-afschrijf', { timeout: 6000 }).catch(() => {});
ok('open (verstuurde) factuur: knop "Afschrijven" in het venster', await page.locator('#inv-afschrijf').count() === 1);
await page.click('#inv-afschrijf');
await page.waitForSelector('#md-input', { timeout: 4000 }).catch(() => {});
ok('afschrijven vraagt een (optionele) reden met uitleg', /telt daarna niet meer als openstaand/.test(await page.locator('.mini-dialog').textContent().catch(() => '')));
await page.fill('#md-input', 'klant reageert niet meer');
await page.click('#md-ok');
await page.waitForFunction((id) => /Afgeschreven/.test((document.querySelector(`.inv-rij[data-inv="${id}"]`) || {}).textContent || ''), afId, { timeout: 6000 }).catch(() => {});
const afRij = await page.evaluate((id) => { const r = document.querySelector(`.inv-rij[data-inv="${id}"]`); return { tekst: r ? r.textContent.replace(/\s+/g, ' ') : '', terug: !!(r && r.querySelector('.inv-heropen')), betaald: !!(r && r.querySelector('.inv-mark')) }; }, afId);
ok('lijst: "Afgeschreven (oninbaar)" met reden, knoppen "Terug naar open" + "✓ Betaald"', /Afgeschreven \(oninbaar\)/.test(afRij.tekst) && /klant reageert niet meer/.test(afRij.tekst) && afRij.terug && afRij.betaald, JSON.stringify(afRij));
await page.selectOption('#invFilter', 'oninbaar');
ok('filter "Afgeschreven" toont hem', await page.evaluate((id) => !!document.querySelector(`.inv-rij[data-inv="${id}"]`), afId));
await page.selectOption('#invFilter', 'all');
await page.click(`.inv-rij[data-inv="${afId}"] .inv-heropen`);
await page.waitForFunction((id) => !/Afgeschreven/.test((document.querySelector(`.inv-rij[data-inv="${id}"]`) || {}).textContent || 'Afgeschreven'), afId, { timeout: 6000 }).catch(() => {});
ok('"Terug naar open" → weer verzonden (open)', await page.evaluate((id) => /nog niet betaald/i.test((document.querySelector(`.inv-rij[data-inv="${id}"]`) || {}).textContent || ''), afId));
// Bulk in het filter "ouder dan 2 mnd" (nagebootste lijst + nagebootste statusroute).
const nuB = Date.now();
const oudLijst = [1, 2].map((n) => ({ id: `inv_oud${n}`, number: `2026-80${n}`, type: 'factuur', status: 'verzonden', totalIncl: 100 * n, sentAt: new Date(nuB - 100 * 86400000).toISOString(), createdAt: new Date(nuB - 100 * 86400000).toISOString(), dueAt: new Date(nuB - 90 * 86400000).toISOString(), customerName: `Oud ${n}` }));
const nepOud = (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(oudLijst) });
let bulkPosts = 0;
const nepStatus = (route) => { bulkPosts++; route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); };
await page.route('**/api/invoices', nepOud);
await page.route('**/api/invoices/inv_oud*/status', nepStatus);
await page.evaluate(() => loadInvoices());
await page.selectOption('#invFilter', 'oud');
await page.waitForSelector('#invBulkAf', { timeout: 4000 }).catch(() => {});
ok('filter "ouder dan 2 mnd": knop "Alle 2 afschrijven"', /Alle 2 afschrijven/.test(await page.locator('#invBulkAf').textContent().catch(() => '')));
await page.click('#invBulkAf');
await page.waitForSelector('#md-ok', { timeout: 4000 }).catch(() => {});
await page.click('#md-ok');
await page.waitForFunction(() => /afgeschreven/.test((document.querySelector('#toast') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
ok('bulk afschrijven: per factuur één statusverzoek', bulkPosts === 2, String(bulkPosts));
await page.unroute('**/api/invoices', nepOud);
await page.unroute('**/api/invoices/inv_oud*/status', nepStatus);
await page.selectOption('#invFilter', 'all');
await page.evaluate(() => loadInvoices());
noErr('Factuur afschrijven');

// DRS-RAPPORT (16 okt 2026, casus 4879 NB Etten-Leur twee keer als afgerond gemeld).
clear();
await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {});
const drsId = await page.evaluate(async () => {
  const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  const o = await post('/api/orders', { source: 'DRS WhatsApp groep', customerName: 'North Ridge BV', customerPhone: '0611222333', customerAddress: 'Industrieweg 4, 4879 NB Etten-Leur', title: 'Etten-Leur — deur sluit niet' });
  await fetch('/api/orders/' + o.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'afgerond' }) });
  await refreshMeta();
  return o.id;
});
await page.evaluate(() => goView('board'));
await page.waitForSelector(`.card[data-id="${drsId}"]`, { timeout: 8000 }).catch(() => {});
ok('bord: DRS-opdracht (ook via "Plak opdracht"-bron) heeft chip "DRS: nog melden"', await page.locator(`.card[data-id="${drsId}"] .chip-drs-melden`).count() === 1);
ok('bord: knop "DRS-rapport" staat er', await page.locator('#drsReportBtn').isVisible());
// Ook in de kolommen "Offerte verzonden" en "Afspraak ingepland" (24 okt 2026, wens eigenaar).
const [drsOffId, drsAfsId] = await page.evaluate(async () => {
  const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  const patch = (id, b) => fetch('/api/orders/' + id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const of = await post('/api/orders', { source: 'DRS WhatsApp groep', customerName: 'Offerte Klant', customerPhone: '0611222444', customerAddress: 'Markt 6, 4661 AA Halsteren', title: 'Halsteren — offerte cilinders' });
  await patch(of.id, { status: 'offerte_verzonden', notes: 'Offerte 3 cilinders verstuurd' });
  const af = await post('/api/orders', { source: 'DRS WhatsApp groep', customerName: 'Afspraak Klant', customerPhone: '0611222555', customerAddress: 'Plein 7, 4703 AB Roosendaal', title: 'Roosendaal — slot vervangen' });
  await patch(af.id, { status: 'afspraak_ingepland', appointmentAt: '2026-10-28T09:30' });
  await loadBoard();
  return [of.id, af.id];
});
await page.waitForSelector(`.column[data-status="afspraak_ingepland"] .card[data-id="${drsAfsId}"]`, { timeout: 8000 }).catch(() => {});
ok('bord: kolom "Offerte verzonden" — DRS-kaart heeft chip "DRS: nog melden"', await page.locator(`.column[data-status="offerte_verzonden"] .card[data-id="${drsOffId}"] .chip-drs-melden`).count() === 1);
ok('bord: kolom "Afspraak ingepland" — DRS-kaart heeft chip "DRS: nog melden"', await page.locator(`.column[data-status="afspraak_ingepland"] .card[data-id="${drsAfsId}"] .chip-drs-melden`).count() === 1);
await page.selectOption('#boardMonteurFilter', 'src:drsmelden');
const filterDrs = await page.evaluate((id) => [...document.querySelectorAll('#board .card')].map((c) => c.dataset.id), drsId);
ok('filter "DRS: nog te melden" toont de niet-gemelde DRS-opdracht', filterDrs.includes(drsId), JSON.stringify(filterDrs.length));
await page.selectOption('#boardMonteurFilter', '');
await page.click('#drsReportBtn');
await page.waitForSelector(`.drs-rij[data-k^="${drsId}"]`, { timeout: 6000 }).catch(() => {});
const drsModal = await page.evaluate((id) => ({ regel: (document.querySelector(`.drs-rij[data-k^="${id}"] .drs-regel`) || {}).value || '', tekst: (document.querySelector('#drsTekst') || {}).value || '' }), drsId);
ok('DRS-rapport: regel met postcode + plaats + klantnaam', drsModal.regel === '4879 NB Etten-Leur — North Ridge BV', drsModal.regel);
ok('DRS-rapport: voorbeeld in het vaste formaat (*kop*, *Afgerond:*)', /^\*\w+dag \d{2}-\d{2}\*/.test(drsModal.tekst) && /\*Afgerond:\*\n\n.*4879 NB Etten-Leur — North Ridge BV/.test(drsModal.tekst), drsModal.tekst.slice(0, 160));
ok('DRS-rapport: ook *Offerte:* en *Afspraken:* (met notitie en tijd)', /\*Offerte:\*\n\n(?:[^*\n][^\n]*\n\n)*4661 AA Halsteren — Offerte Klant, Offerte 3 cilinders verstuurd/.test(drsModal.tekst) && /\*Afspraken:\*\n\n(?:[^*\n][^\n]*\n\n)*4703 AB Roosendaal — Afspraak Klant \(28-10 09:30\)/.test(drsModal.tekst), drsModal.tekst);
// Het venster kan net na het openen nog één keer worden bijgewerkt (verse gegevens van de
// server); valt dat precies op het invullen, dan is de invoer weg. Daarom invullen, kort
// wachten en zo nodig nog een keer — de controle zelf blijft: het voorbeeld volgt de regel.
for (let i = 0; i < 4; i++) {
  await page.fill(`.drs-rij[data-k^="${drsId}"] .drs-regel`, '4879 NB Etten-Leur — North Ridge BV (achterdeur)');
  if (await page.waitForFunction(() => /achterdeur/.test((document.querySelector('#drsTekst') || {}).value || ''), null, { timeout: 1500 }).then(() => true).catch(() => false)) break;
}
ok('regel aanpassen werkt het voorbeeld meteen bij', /achterdeur/.test(await page.evaluate(() => document.querySelector('#drsTekst').value)));
await page.click('#drsKopieer');
await page.waitForSelector('#drsNaKopie:not([hidden])', { timeout: 4000 }).catch(() => {});
ok('na kopiëren: vraag "Staat het erin?" met knop "Geplaatst — vink af"', await page.locator('#drsGeplaatst').isVisible().catch(() => false));
await page.click('#drsGeplaatst');
await page.waitForSelector('.drs-leeg', { timeout: 6000 }).catch(() => {});
ok('na afvinken: "Alles is gemeld"', await page.locator('.drs-leeg').count() === 1);
ok('geschiedenis toont het rapport (CRM) met "Ongedaan"-knop', await page.locator('.drs-hist .drs-ongedaan').count() >= 1);
await page.evaluate(() => closeModal());
await page.evaluate(() => loadBoard());
await page.waitForSelector(`.card[data-id="${drsId}"] .chip-drs-ok`, { timeout: 6000 }).catch(() => {});
ok('bord: chip wordt "DRS gemeld <dag>"', /DRS gemeld \w{2} \d{2}-\d{2}/.test(await page.locator(`.card[data-id="${drsId}"] .chip-drs-ok`).textContent().catch(() => '')));
ok('bord: ook de offerte- en afspraakkaart staan nu op "DRS gemeld"', await page.locator(`.card[data-id="${drsOffId}"] .chip-drs-ok`).count() === 1 && await page.locator(`.card[data-id="${drsAfsId}"] .chip-drs-ok`).count() === 1);
await page.evaluate((id) => openOrderVers(id), drsAfsId);
await page.waitForSelector('#f-drs', { timeout: 6000 }).catch(() => {});
ok('opdracht in "Afspraak ingepland": regel "Gemeld aan DRS als Afspraak"', /Gemeld aan DRS als Afspraak op/.test(await page.locator('#f-drs').textContent().catch(() => '')));
await page.evaluate(() => closeModal());
await page.evaluate((id) => openOrderVers(id), drsId);
await page.waitForSelector('#f-drs', { timeout: 6000 }).catch(() => {});
ok('opdracht: regel "Gemeld aan DRS als Afgerond"', /Gemeld aan DRS als Afgerond/.test(await page.locator('#f-drs').textContent().catch(() => '')));
page.once('dialog', (dl) => dl.accept());
await page.click('#f-drs-uit');
await page.waitForSelector('#f-drs-aan', { timeout: 6000 }).catch(() => {});
ok('opdracht: vinkje weghalen → "Nog niet gemeld" + knop "Is al gemeld"', /Nog niet gemeld aan DRS/.test(await page.locator('#f-drs').textContent().catch(() => '')));
await page.click('#f-drs-aan');
await page.waitForSelector('#f-drs-uit', { timeout: 6000 }).catch(() => {});
ok('opdracht: "Is al gemeld" vinkt weer af', /Gemeld aan DRS/.test(await page.locator('#f-drs').textContent().catch(() => '')));
await page.evaluate(() => closeModal());
// Dubbel-alarm zichtbaar: ons rapport uit de groep met dezelfde opdracht op een latere dag.
await page.evaluate(async () => {
  // Eerst het rapport zelf (komt terug uit de groep = zelfde rapport, geen alarm), daarna een
  // tweede bericht met dezelfde opdracht = dubbel aan DRS.
  const post = (body, ext) => fetch('/api/ingest/whatsapp', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-token': 'test123' }, body: JSON.stringify({ group: 'Raf breda en vliegende keer Rhenen straal 30 KM', name: 'Key service 24/7', body, externalId: ext }) });
  await post('*Afgerond:*\n\n4879 NB Etten-Leur — North Ridge BV', 'br-drs-rapport-1');
  await post('*Afgerond:*\n\n4879 NB Etten-Leur\n\n4421 BR Kapelle', 'br-drs-rapport-2');
});
await page.click('#drsReportBtn');
await page.waitForSelector('.drs-alarm', { timeout: 6000 }).catch(() => {});
ok('DRS-rapport: rood alarm "Dubbel gemeld aan DRS" met knop Afgehandeld', /Dubbel gemeld aan DRS/.test(await page.locator('.drs-alarm').first().textContent().catch(() => '')) && await page.locator('.drs-alarm-ok').count() >= 1);
await page.click('.drs-alarm-ok');
await page.waitForFunction(() => !document.querySelector('.drs-alarm'), null, { timeout: 6000 }).catch(() => {});
ok('alarm afhandelen haalt het weg', await page.locator('.drs-alarm').count() === 0);
await page.evaluate(() => closeModal());
// Telefoonformaat: knop in beeld, venster zonder horizontaal schuiven.
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => goView('board'));
await page.waitForTimeout(400);
const drsKnopMob = await page.evaluate(() => { const r = document.querySelector('#drsReportBtn')?.getBoundingClientRect(); return r ? { x: r.x, w: r.width, zichtbaar: r.width > 0 } : null; });
ok('mobiel: knop "DRS-rapport" staat binnen 390 px', !!drsKnopMob && drsKnopMob.zichtbaar && drsKnopMob.x >= 0 && drsKnopMob.x + drsKnopMob.w <= 390, JSON.stringify(drsKnopMob));
await page.evaluate(() => openDrsRapport());
await page.waitForSelector('.drs-geschiedenis', { timeout: 6000 }).catch(() => {});
ok('mobiel: DRS-rapport zonder horizontaal schuiven', await page.evaluate(() => { const m = document.querySelector('#modal'); return m && m.scrollWidth <= m.clientWidth + 2 && document.documentElement.scrollWidth <= 392; }));
await page.evaluate(() => closeModal());
await page.setViewportSize({ width: 1280, height: 800 });
await page.evaluate(() => goView('settings'));
await page.waitForSelector('#saveDrsRapport', { timeout: 8000 }).catch(() => {});
ok('instellingen: kaart "DRS-rapport" (beheerder)', await page.locator('#saveDrsRapport').count() === 1);
ok('instellingen: alle vier kopjes staan standaard aan (ook Offerte + Afspraken)', await page.locator('#dr-kopjes input:checked').count() === 4);
// Opgeslagen waarden komen terug na opnieuw openen (toonde altijd de standaard → een tweede
// keer opslaan wiste het e-mailadres van DRS).
await instKies(page, 'werk');
await page.fill('#dr-email', 'planning@drs-test.nl');
await page.click('#saveDrsRapport');
await page.waitForFunction(() => /DRS-rapport-instellingen opgeslagen/.test((document.querySelector('#toast') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
await page.evaluate(() => loadSettings());
await page.waitForSelector('#dr-email', { timeout: 6000 }).catch(() => {});
ok('instellingen: opgeslagen e-mailadres van DRS staat er weer na opnieuw openen', await page.locator('#dr-email').inputValue().catch(() => '') === 'planning@drs-test.nl');
await page.fill('#dr-email', '');
await page.click('#saveDrsRapport');
await page.waitForTimeout(300);
// KOLOMMEN OPSLAAN (30 okt 2026): wiste het vinkje "afgehandeld" van Afgerond/Geannuleerd →
// die klapten na zondag niet meer in. Nu blijft het staan.
await instKies(page, 'werk').catch(() => {});
await page.click('#saveStatuses');
await page.waitForFunction(() => /Kolommen opgeslagen/.test((document.querySelector('#toast') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
const kolNa = await page.evaluate(() => fetch('/api/settings').then((r) => r.json()).then((s) => (s.statuses || []).filter((x) => ['afgerond', 'geannuleerd'].includes(x.key)).map((x) => x.secondary)));
ok('instellingen: "Kolommen opslaan" houdt Afgerond/Geannuleerd als afgehandeld (klappen zondag in)', kolNa.length === 2 && kolNa.every((v) => v === true), JSON.stringify(kolNa));
noErr('DRS-rapport');

// OFFERTE-HERINNERING ÉÉN KEER (8 okt 2026): geen "Max. aantal" meer, uitleg staat er, en
// opslaan van de factuur-instellingen werkt nog (de oude regel las #is-quote-max).
clear();
await page.evaluate(() => goView('settings'));
await page.waitForSelector('#saveInvoiceSettings', { timeout: 8000 }).catch(() => {});
const quoteUi = await page.evaluate(() => ({ max: !!document.querySelector('#is-quote-max'), uitleg: (document.querySelector('#is-quote-uitleg') || {}).textContent || '' }));
ok('instellingen: geen "Max. aantal" meer bij offerte-opvolging, wel uitleg "één herinnering"', !quoteUi.max && /één/.test(quoteUi.uitleg), JSON.stringify(quoteUi));
await page.evaluate(() => { const t = document.querySelector('#toast'); if (t) { t.hidden = true; t.textContent = ''; t.className = 'toast'; } });
await page.evaluate(() => document.querySelector('#saveInvoiceSettings').click());
await page.waitForFunction(() => /opgeslagen|fout|niet/i.test((document.querySelector('#toast') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
const quoteSave = await page.evaluate(() => { const t = document.querySelector('#toast'); return { tekst: t ? t.textContent : '', fout: !!(t && t.classList.contains('err')) }; });
ok('factuur-instellingen opslaan werkt nog (geen fout)', /Factuurgegevens opgeslagen/.test(quoteSave.tekst) && !quoteSave.fout, JSON.stringify(quoteSave));
noErr('Offerte-herinnering instellingen');

// WEBSITE-FORMULIEREN (6 okt 2026): controlekaart in Instellingen → Koppelingen.
clear();
await page.evaluate(() => goView('settings'));
await page.waitForFunction(() => /komen de aanvragen binnen/.test((document.querySelector('#formulierenKaart') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
const fk = await page.evaluate(() => { const k = document.querySelector('#formulierenKaart'); return { er: !!k, lijst: !!(k && k.querySelector('.form-sites')), mailbox: /contact@keyservice247\.nl/.test((k || {}).textContent || ''), schakelaar: !!(k && k.querySelector('#fsAlleenFormulieren')), breedteOk: !k || k.scrollWidth <= k.clientWidth + 2 }; });
ok('Instellingen: kaart "Website-formulieren" met lijst per website, reserve-mailbox en schakelaar', fk.er && fk.lijst && fk.mailbox && fk.schakelaar && fk.breedteOk, JSON.stringify(fk));
noErr('Website-formulieren');

// NIETS GAAT STIL VERLOREN (24 nov 2026, naloop van het hele systeem na de klacht "op het
// kruisje krijg ik geen melding"). Alles hieronder was vóór de reparatie zonder melding weg.
clear();
{
  await page.evaluate(() => { if (!document.querySelector('#modalRoot').hidden) { modalSchoon(); closeModal(); } });
  // helper: voer iets uit en vang de browser-vraag (confirm) die daarbij komt
  const metVraag = async (doe, { ja = false } = {}) => {
    const gezien = []; const h = async (d) => { gezien.push(d.message()); try { if (ja) await d.accept(); else await d.dismiss(); } catch { /* al afgehandeld */ } };
    page.on('dialog', h); try { await doe(); await page.waitForTimeout(350); } finally { page.off('dialog', h); }
    return gezien;
  };
  const sluitVraag = () => page.evaluate(() => { const w = document.querySelector('#sluitVraag'); return w ? { titel: w.querySelector('h3').textContent, knoppen: [...w.querySelectorAll('button')].map((x) => x.textContent.trim()).join('|') } : null; });
  const uniek = Date.now();

  // --- 1. vervolgknop in de opdracht met een niet-opgeslagen wijziging ---
  await page.evaluate(() => goView('board')); await page.waitForTimeout(900);
  const nlId = await page.evaluate(() => { const o = state.orders.find((x) => !['afgerond', 'geannuleerd'].includes(x.status)); return o ? o.id : ''; });
  await page.evaluate((id) => openOrderModal(id), nlId); await page.waitForSelector('#f-notes', { state: 'attached', timeout: 8000 }); await page.waitForTimeout(600);
  await page.evaluate(() => ovNaarVeld('#f-notes')); await page.waitForTimeout(200);
  const nlNotitie = 'Naloop notitie ' + uniek;
  await page.fill('#f-notes', nlNotitie);
  await page.click('#f-werkbon'); await page.waitForTimeout(400);
  let nv = await sluitVraag();
  ok('opdracht: knop Werkbon met een niet-opgeslagen notitie vraagt "Eerst opslaan?" (was: notitie stil weg)', !!nv && nv.titel === 'Eerst opslaan?' && nv.knoppen === 'Opslaan en doorgaan|Doorgaan zonder opslaan|Terug', JSON.stringify(nv));
  await page.click('#sv-terug'); await page.waitForTimeout(250);
  ok('"Terug" laat de opdracht open met de getypte notitie', (await page.inputValue('#f-notes')) === nlNotitie && !(await sluitVraag()));
  await page.click('#f-werkbon'); await page.waitForTimeout(300);
  await page.click('#sv-opslaan'); await page.waitForSelector('#wb-work', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(400);
  const nlBewaard = await page.evaluate((id) => fetch(`/api/orders/${id}`).then((r) => r.json()).then((o) => o.notes || ''), nlId);
  ok('"Opslaan en doorgaan" bewaart de notitie én opent daarna de werkbon', nlBewaard === nlNotitie && !!(await page.$('#wb-work')), nlBewaard);

  // --- 2. werkbon: alleen een handtekening = ook een wijziging ---
  if (await page.$('#wb-sign')) {
    await page.locator('#wb-sign').scrollIntoViewIfNeeded();
    const vak = await page.locator('#wb-sign').boundingBox();
    await page.mouse.move(vak.x + 30, vak.y + 30); await page.mouse.down(); await page.mouse.move(vak.x + 130, vak.y + 60, { steps: 5 }); await page.mouse.up();
    await page.keyboard.press('Escape'); await page.waitForTimeout(350);
    nv = await sluitVraag();
    ok('werkbon: alleen een handtekening gezet → sluiten vraagt eerst (was: handtekening stil weg)', !!nv, JSON.stringify(nv));
    if (nv) { await page.click('#sv-weg'); await page.waitForTimeout(300); }
  }
  await page.evaluate(() => { if (!document.querySelector('#modalRoot').hidden) { modalSchoon(); closeModal(); } });

  // --- 3. zonder wijziging geen vraag; Annuleren in vervolgvensters gaat terug naar de opdracht ---
  await page.evaluate((id) => openOrderModal(id), nlId); await page.waitForSelector('#f-snooze', { state: 'attached', timeout: 8000 }); await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('#f-snooze').scrollIntoView({ block: 'center' }));
  await page.click('#f-snooze'); await page.waitForTimeout(500);
  ok('opdracht zonder wijziging: vervolgknop opent meteen (geen onnodige vraag)', !(await sluitVraag()) && !!(await page.$('#sn-cancel')));
  await page.click('#sn-cancel'); await page.waitForSelector('#f-notes', { state: 'attached', timeout: 6000 }).catch(() => {}); await page.waitForTimeout(400);
  ok('herinnering: Annuleren brengt je terug in de opdracht (was: alles dicht)', !!(await page.$('#f-notes')) && await page.evaluate(() => !document.querySelector('#modalRoot').hidden));

  // --- 4. meldingen zijn zichtbaar terwijl een venster open staat ---
  await page.evaluate(() => toast('Proefmelding naloop')); await page.waitForTimeout(250);
  const tz = await page.evaluate(() => { const el = document.querySelector('#toast'); const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { op: Number(cs.opacity), top: Math.round(r.top), z: Number(cs.zIndex), hidden: el.hidden }; });
  ok('een gewone melding is zichtbaar als er een venster open staat (was: onzichtbaar)', !tz.hidden && tz.op > 0.5 && tz.top < 140 && tz.z > 300, JSON.stringify(tz));
  await page.evaluate(() => { modalSchoon(); closeModal(); const t = document.querySelector('#toast'); if (t) t.hidden = true; });

  // --- 5. Instellingen: weggaan met iets dat niet is opgeslagen ---
  await page.evaluate(() => goView('settings')); await page.waitForSelector('#ar-subject', { state: 'attached', timeout: 8000 }); await page.waitForTimeout(1200);
  await instKies(page, 'bericht'); await page.waitForTimeout(300);
  const arOud = await page.inputValue('#ar-subject');
  await page.fill('#ar-subject', 'Onderwerp naloop ' + uniek);
  let vr = await metVraag(() => page.evaluate(() => showView('board')));
  ok('Instellingen: weggaan met een niet-opgeslagen veld vraagt eerst en noemt het blok', vr.length === 1 && /nog niet is opgeslagen/.test(vr[0]) && /ontvangstbevestiging/i.test(vr[0]) && await page.evaluate(() => state.view === 'settings'), JSON.stringify(vr));
  ok('Instellingen: Annuleren = blijven, de tekst staat er nog', (await page.inputValue('#ar-subject')) === 'Onderwerp naloop ' + uniek);
  await page.fill('#ar-subject', arOud);
  vr = await metVraag(() => page.evaluate(() => showView('board')));
  ok('Instellingen: teruggezet naar de oude waarde = geen vraag', vr.length === 0 && await page.evaluate(() => state.view === 'board'), JSON.stringify(vr));
  await page.evaluate(() => goView('settings')); await page.waitForSelector('#tm-to', { state: 'attached', timeout: 8000 }); await page.waitForTimeout(1200);
  await instKies(page, 'bericht'); await page.waitForTimeout(300);
  await page.fill('#tm-to', 'proef@voorbeeld.test'); await page.click('#ar-body');
  vr = await metVraag(() => page.evaluate(() => showView('board')));
  ok('Instellingen: een testadres of alleen aanklikken is geen wijziging (geen onnodige vraag)', vr.length === 0 && await page.evaluate(() => state.view === 'board'), JSON.stringify(vr));

  // --- 6. Instellingen: een ander blok opslaan gooit getypte invoer niet weg ---
  await page.evaluate(() => goView('settings')); await page.waitForSelector('#amw-hours', { state: 'attached', timeout: 8000 }); await page.waitForTimeout(1200);
  await instKies(page, 'werk'); await page.waitForTimeout(300);
  const amwOud = await page.inputValue('#amw-hours'); const amwNieuw = String((Number(amwOud) || 0) + 3);
  await page.fill('#amw-hours', amwNieuw);
  await page.evaluate(() => [...document.querySelectorAll('#settingsPanel button')].find((x) => /Bronnen opslaan/.test(x.textContent)).click());
  await page.waitForFunction(() => /Bronnen opgeslagen/.test((document.querySelector('#toast') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1800);
  ok('Instellingen: "Bronnen opslaan" laat een getypt getal in een ANDER blok staan (was: weg)', (await page.inputValue('#amw-hours').catch(() => 'weg')) === amwNieuw, await page.inputValue('#amw-hours').catch(() => 'weg'));
  vr = await metVraag(() => page.evaluate(() => showView('board')), { ja: true });
  ok('…en dat veld telt nog steeds als niet opgeslagen; OK = weggaan', vr.length === 1 && /Zelfde-moment/i.test(vr[0]) && await page.evaluate(() => state.view === 'board'), JSON.stringify(vr));

  // --- 7. de twee velden voor de opdracht-groepen lopen gelijk ---
  await page.evaluate(() => goView('settings')); await page.waitForSelector('#waOrderGroups', { state: 'attached', timeout: 8000 }); await page.waitForTimeout(1200);
  await instKies(page, 'inbox'); await page.waitForTimeout(300);
  const grOud = await page.inputValue('#waOrderGroups');
  await page.fill('#waOrderGroups', 'Proefgroep ' + uniek);
  await page.evaluate(() => { const k = document.querySelector('#waOrderGroups').closest('.info-card'); [...k.querySelectorAll('button')].find((x) => /opslaan/i.test(x.textContent)).click(); });
  await page.waitForTimeout(900);
  ok('Instellingen: het tweede groepenveld volgt het eerste (was: latere Opslaan zette stil de oude groepen terug)', (await page.inputValue('#md-ordergroups')) === 'Proefgroep ' + uniek, await page.inputValue('#md-ordergroups').catch(() => 'geen veld'));
  await page.fill('#waOrderGroups', grOud);
  await page.evaluate(() => { const k = document.querySelector('#waOrderGroups').closest('.info-card'); [...k.querySelectorAll('button')].find((x) => /opslaan/i.test(x.textContent)).click(); });
  await page.waitForTimeout(900);
  vr = await metVraag(() => page.evaluate(() => showView('board')));
  ok('Instellingen: na opslaan geen vraag bij weggaan', vr.length === 0 && await page.evaluate(() => state.view === 'board'), JSON.stringify(vr));

  // --- 8. inbox: getypte correctie overleeft een hertekening en een filterwissel ---
  await page.evaluate(() => fetch('/api/ingest/email', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-token': 'test123' }, body: JSON.stringify({ from: 'Naloop Proef <naloopproef@example.nl>', subject: 'Slot achterdeur klemt', externalId: 'bt-naloop-' + Date.now(), body: 'Goedemiddag, het slot van de achterdeur klemt. Kunt u langskomen?\nNaam: Naloop Proef\nAdres: Proefstraat 12, 3911 AA Rhenen\nTelefoon: 0611000123' }) }));
  await page.evaluate(() => goView('inbox')); await page.waitForSelector('#reviewList .review', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(600);
  const nlRev = await page.evaluate(() => (document.querySelector('#reviewList .review') || { dataset: {} }).dataset.id || '');
  if (nlRev) {
    const veld = `.review[data-id="${nlRev}"] .r-cname`;
    await page.fill(veld, 'Naam Naloop Getypt'); await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.evaluate(() => { _lastInboxHtml = ''; return loadInbox(); }); await page.waitForTimeout(900);
    ok('inbox: een getypte correctie overleeft een hertekening van de lijst (was: weg na goedkeuren van een ander bericht)', (await page.inputValue(veld).catch(() => 'weg')) === 'Naam Naloop Getypt', await page.inputValue(veld).catch(() => 'weg'));
    await page.selectOption('#inboxFilter', { index: 1 }); await page.waitForTimeout(900);
    await page.selectOption('#inboxFilter', { index: 0 }); await page.waitForTimeout(900);
    ok('inbox: de correctie staat er nog na een ander filter en terug', (await page.inputValue(veld).catch(() => 'weg')) === 'Naam Naloop Getypt', await page.inputValue(veld).catch(() => 'weg'));
    const bu = await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return { tegengehouden: e.defaultPrevented, wat: ietsOnbewaard() }; });
    ok('tabblad sluiten/verversen met een getypte correctie → de browser vraagt eerst', bu.tegengehouden === true && /inbox/.test(bu.wat), JSON.stringify(bu));
    await page.evaluate((v) => { const el = document.querySelector(v); el.value = el.defaultValue; }, veld);
  } else ok('inbox: er is een bericht om mee te testen', false, 'geen inbox-item');
  await page.evaluate(() => { const c = document.querySelector('#selectAll'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.evaluate(() => { _lastInboxHtml = ''; return loadInbox(); }); await page.waitForTimeout(900);
  const selNa = await page.evaluate(() => ({ sel: inboxSel.size, vink: [...document.querySelectorAll('.r-select')].filter((c) => c.checked).length, tot: document.querySelectorAll('.r-select').length }));
  ok('inbox: "alles selecteren" blijft staan na een verversing (was: alle vinkjes weg)', selNa.tot > 0 && selNa.sel === selNa.tot && selNa.vink === selNa.tot, JSON.stringify(selNa));
  await page.evaluate(() => { const c = document.querySelector('#selectAll'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });

  // --- 9. Taken: gekozen Privé/Hoog blijft staan; half getypte taak → uitloggen vraagt ---
  await page.evaluate(() => goView('taken')); await page.waitForSelector('#tkSnel', { timeout: 8000 }); await page.waitForTimeout(500);
  await page.click('#tkSnel .tk-keuze[data-k="categorie"] .tk-opt[data-v="prive"]');
  await page.click('#tkSnel .tk-keuze[data-k="urgentie"] .tk-opt[data-v="hoog"]');
  await page.evaluate(() => loadTaken()); await page.waitForTimeout(800);
  const tkKeuze = await page.evaluate(() => ({ c: (document.querySelector('#tkSnel .tk-keuze[data-k="categorie"] .tk-opt.active') || { dataset: {} }).dataset.v, u: (document.querySelector('#tkSnel .tk-keuze[data-k="urgentie"] .tk-opt.active') || { dataset: {} }).dataset.v }));
  ok('Taken: gekozen Privé + Hoog blijft staan bij een hertekening (was: terug naar Zakelijk — zichtbaar voor kantoor)', tkKeuze.c === 'prive' && tkKeuze.u === 'hoog', JSON.stringify(tkKeuze));
  await page.fill('#tkSnelTitel', 'Half getypte taak');
  vr = await metVraag(() => page.evaluate(() => document.querySelector('#logoutBtn').click()));
  ok('uitloggen met iets dat niet is opgeslagen vraagt eerst; Annuleren = ingelogd blijven', vr.length === 1 && /niet is opgeslagen/.test(vr[0]) && await page.evaluate(() => fetch('/api/me').then((r) => r.json()).then((j) => !!j.user)), JSON.stringify(vr));
  await page.fill('#tkSnelTitel', '');
  await page.click('#tkSnel .tk-keuze[data-k="categorie"] .tk-opt[data-v="zakelijk"]');

  // --- 10. Berichten: concept per gesprek ---
  await page.evaluate(() => goView('chats')); await page.waitForSelector('.chat-item', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(500);
  const nlChats = await page.evaluate(() => [...document.querySelectorAll('.chat-item')].map((x) => x.dataset.cid));
  if (nlChats.length >= 2) {
    await page.click(`.chat-item[data-cid="${nlChats[0]}"]`); await page.waitForSelector('#cpText', { timeout: 6000 }); await page.waitForTimeout(400);
    await page.fill('#cpText', 'Half getypt antwoord naloop');
    await page.click(`.chat-item[data-cid="${nlChats[1]}"]`); await page.waitForTimeout(900);
    const leeg = await page.inputValue('#cpText').catch(() => '?');
    await page.click(`.chat-item[data-cid="${nlChats[0]}"]`); await page.waitForTimeout(900);
    ok('Berichten: een half getypt antwoord staat er weer als je terugkomt in het gesprek (was: weg); het andere gesprek begint leeg', leeg === '' && (await page.inputValue('#cpText').catch(() => '?')) === 'Half getypt antwoord naloop', leeg);
    await page.fill('#cpText', ''); await page.waitForTimeout(100);
  } else ok('Berichten: er zijn twee gesprekken om mee te testen', false, String(nlChats.length));
  const rust = await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return { tegengehouden: e.defaultPrevented, wat: ietsOnbewaard() }; });
  ok('niets openstaand → de browser vraagt niets bij sluiten (geen vals alarm)', rust.tegengehouden === false && rust.wat === '', JSON.stringify(rust));

  // --- 11. DRS "was al gemeld" vraagt eerst; aangepaste regel is geen verlies bij sluiten ---
  await page.evaluate(() => goView('board')); await page.waitForTimeout(600);
  await page.evaluate(() => openDrsRapport()); await page.waitForSelector('[data-drs]', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(600);
  if (await page.$('.drs-regel')) {
    await page.locator('.drs-regel').first().fill('1234 AB Proefstad — naloop'); await page.waitForTimeout(150);
    vr = await metVraag(() => page.locator('.drs-al').first().click());
    ok('DRS-rapport: "was al gemeld" vraagt eerst; Annuleren laat de regel staan (was: één tik = voorgoed uit het rapport)', vr.length === 1 && /AL GEMELD/.test(vr[0]) && (await page.locator('.drs-regel').first().inputValue()) === '1234 AB Proefstad — naloop', JSON.stringify(vr));
    await page.keyboard.press('Escape'); await page.waitForTimeout(350);
    ok('DRS-rapport: een aangepaste regel wordt onthouden → sluiten zonder vals alarm', !(await sluitVraag()) && await page.evaluate(() => document.querySelector('#modalRoot').hidden), JSON.stringify(await sluitVraag()));
  }
  if (await page.$('#sluitVraag #sv-weg')) { await page.click('#sluitVraag #sv-weg'); await page.waitForTimeout(250); }
  await page.evaluate(() => { if (!document.querySelector('#modalRoot').hidden) { modalSchoon(); closeModal(); } });

  // --- 12. ingelogd op de inlogpagina belanden → meteen door naar het CRM ---
  await page.goto(BASE + '/login.html'); await page.waitForSelector('.view:not([hidden])', { timeout: 10000 }).catch(() => {});
  ok('inlogpagina terwijl je al bent ingelogd → meteen door naar het CRM (terugknop zette je op een inlogscherm)', !/login\.html/.test(page.url()) && !!(await page.$('.view:not([hidden])')), page.url());
  await page.waitForTimeout(800);
}
noErr('Naloop: niets gaat stil verloren');

// NALOOP DEEL 2 (24 nov 2026): punten uit de twee browser-doorlopen (pc kantoor, telefoon + monteur).
clear();
{
  const metVraag = async (doe, { ja = false } = {}) => {
    const gezien = []; const h = async (d) => { gezien.push(d.message()); try { if (ja) await d.accept(); else await d.dismiss(); } catch { /* al afgehandeld */ } };
    page.on('dialog', h); try { await doe(); await page.waitForTimeout(450); } finally { page.off('dialog', h); }
    return gezien;
  };
  const sluitVraag = () => page.evaluate(() => { const w = document.querySelector('#sluitVraag'); return w ? { titel: w.querySelector('h3').textContent, knoppen: [...w.querySelectorAll('button')].map((x) => x.textContent.trim()).join('|') } : null; });
  // De vraag netjes beantwoorden (knop), niet het element weghalen: anders blijft hij "open" staan.
  const allesDicht = async () => { if (await page.$('#sluitVraag #sv-weg')) { await page.click('#sluitVraag #sv-weg'); await page.waitForTimeout(250); } await page.evaluate(() => { if (!document.querySelector('#modalRoot').hidden) { modalSchoon(); closeModal(); } }); };
  await allesDicht();
  await page.evaluate(() => goView('board')); await page.waitForTimeout(900);

  // --- foto's in de opdracht: teller klopt na toevoegen; weghalen kan in de opdracht zelf ---
  const d2Id = await page.evaluate(() => { const o = state.orders.find((x) => !['afgerond', 'geannuleerd'].includes(x.status)); return o ? o.id : ''; });
  await page.evaluate((id) => openOrderModal(id), d2Id); await page.waitForSelector('#f-addfile', { state: 'attached', timeout: 8000 }); await page.waitForTimeout(500);
  await page.evaluate(() => ovToonTab('fotos')); await page.waitForTimeout(200);
  const d2Voor = await page.evaluate((id) => fetch(`/api/orders/${id}`).then((r) => r.json()).then((o) => (o.attachments || []).length), d2Id);
  // Elke run een andere afbeelding (inhoud-ontdubbeling zou een tweede keer dezelfde foto weigeren).
  const d2Png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 8; c.height = 8; const x = c.getContext('2d'); x.fillStyle = `rgb(${Date.now() % 255},${Math.floor(Math.random() * 255)},${Math.floor(Math.random() * 255)})`; x.fillRect(0, 0, 8, 8); return c.toDataURL('image/png').split(',')[1]; });
  await page.setInputFiles('#f-fileinput', [{ name: 'naloop-proef.png', mimeType: 'image/png', buffer: Buffer.from(d2Png, 'base64') }]);
  await page.waitForFunction((n) => document.querySelectorAll('#f-attachgrid > *').length > n, d2Voor, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  const d2Na = await page.evaluate(() => ({ tegels: document.querySelectorAll('#f-attachgrid > *').length, tab: (document.querySelector('#modal .ov-tab[data-ovtab="fotos"] .ov-tab-n') || {}).textContent || '', kop: ((document.querySelector('#modal .attach .thread-head') || {}).textContent || '').replace(/\s+/g, ' ') }));
  ok('opdracht: na een foto toevoegen klopt de teller op het tabblad en in het kopje (bleef op het oude getal)', d2Na.tegels === d2Voor + 1 && d2Na.tab === String(d2Voor + 1) && d2Na.kop.includes(`(${d2Voor + 1})`), JSON.stringify(d2Na));
  await allesDicht();
  await page.evaluate((id) => openOrderModal(id), d2Id); await page.waitForSelector('#f-fotoweg', { state: 'attached', timeout: 8000 }).catch(() => {}); await page.waitForTimeout(400);
  await page.evaluate(() => ovToonTab('fotos')); await page.waitForTimeout(200);
  if (await page.$('#f-fotoweg')) {
    await page.click('#f-fotoweg'); await page.waitForTimeout(150);
    let fv = await metVraag(() => page.locator('#f-attachgrid > *').last().click());
    const naNee = await page.evaluate(() => document.querySelectorAll('#f-attachgrid > *').length);
    fv = fv.concat(await metVraag(() => page.locator('#f-attachgrid > *').last().click(), { ja: true }));
    await page.waitForTimeout(600);
    const naJa = await page.evaluate((id) => fetch(`/api/orders/${id}`).then((r) => r.json()).then((o) => (o.attachments || []).length), d2Id);
    ok('opdracht: een foto weghalen kan in de opdracht zelf — eerst een vraag, Annuleren = blijft, OK = weg', fv.length === 2 && /verwijderen\?/.test(fv[0]) && naNee === d2Voor + 1 && naJa === d2Voor, JSON.stringify({ fv: fv.length, naNee, naJa, d2Voor }));
  } else ok('opdracht: knop "Verwijderen…" staat bij de foto\'s', false);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  ok('foto toevoegen/weghalen telt niet als niet-opgeslagen wijziging (geen onnodige vraag)', !(await sluitVraag()), JSON.stringify(await sluitVraag()));
  await allesDicht();

  // --- de tabbalk van de opdracht plakt strak bovenaan (geen strook waar velden doorheen schuiven) ---
  await page.setViewportSize({ width: 1280, height: 560 });
  await page.evaluate((id) => openOrderModal(id), d2Id); await page.waitForSelector('.ov-tabs', { timeout: 8000 }); await page.waitForTimeout(500);
  const tabPlek = await page.evaluate(() => { const sc = document.querySelector('#modalRoot'); sc.scrollTop = 600; const r = document.querySelector('.ov-tabs').getBoundingClientRect(); return { top: Math.round(r.top), gescrold: Math.round(sc.scrollTop) }; });
  ok('opdracht (pc): de tabbalk plakt strak tegen de bovenrand (was 40 px lager met velden erboven)', tabPlek.gescrold > 100 && tabPlek.top <= 1, JSON.stringify(tabPlek));
  await allesDicht();
  await page.setViewportSize({ width: 1440, height: 900 });

  // --- factuur: lege nieuwe factuur opslaan vraagt eerst; klantgegevens gaan mee bij opslaan ---
  const d2Fid = await page.evaluate(() => { const o = state.orders.find((x) => !x.invoiceId && !['afgerond', 'geannuleerd'].includes(x.status)); return o ? o.id : ''; });
  if (d2Fid) {
    await page.evaluate((id) => openOrderModal(id), d2Fid); await page.waitForSelector('#f-invoice', { state: 'attached', timeout: 8000 }); await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('#f-invoice').click()); await page.waitForSelector('#inv-save', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(600);
    const invVoor = await page.evaluate(() => fetch('/api/invoices').then((r) => r.json()).then((l) => l.length));
    const lv = await metVraag(() => page.evaluate(() => document.querySelector('#inv-save').click()));
    const invNa = await page.evaluate(() => fetch('/api/invoices').then((r) => r.json()).then((l) => l.length));
    ok('factuur: Opslaan van een lege nieuwe factuur vraagt eerst; Annuleren = er wordt geen nummer verbruikt', lv.length === 1 && /nog geen regels/.test(lv[0]) && invNa === invVoor, JSON.stringify({ lv, invVoor, invNa }));
    if (await page.$('#cust-email')) {
      await page.evaluate(() => { const d = document.querySelector('#cust-email').closest('details'); if (d) d.open = true; });
      const d2Mail = 'naloop' + Date.now() + '@voorbeeld.test';
      await page.fill('#cust-email', d2Mail);
      await page.fill('#inv-lines .il-desc', 'Proefregel naloop'); await page.fill('#inv-lines .il-price', '50');
      await page.locator('#inv-save').scrollIntoViewIfNeeded(); await page.click('#inv-save'); await page.waitForTimeout(1500);
      const d2Klant = await page.evaluate((id) => fetch(`/api/orders/${id}`).then((r) => r.json()).then((o) => fetch('/api/customers').then((r) => r.json()).then((l) => (l.find((c) => c.id === o.customerId) || {}).email || '')), d2Fid);
      ok('factuur: een gewijzigd klant-e-mailadres wordt meebewaard bij Opslaan van de factuur (was: stil weg, factuur naar het oude adres)', d2Klant === d2Mail, d2Klant);
    }
    await allesDicht();
    // regel weghalen = wijziging
    await page.evaluate((id) => openOrderModal(id), d2Fid); await page.waitForSelector('#f-invoice', { state: 'attached', timeout: 8000 }); await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('#f-invoice').click()); await page.waitForTimeout(1500);
    if (await page.$('[data-dockeuze]')) { const e = await page.$('[data-dockeuze] .dk-rij, [data-dockeuze] [data-dk]'); if (e) { await e.click(); await page.waitForTimeout(1500); } }
    if (await page.$('#inv-save') && await page.$('#inv-lines .il-del')) {
      await page.click('#inv-lines .il-del'); await page.keyboard.press('Escape'); await page.waitForTimeout(350);
      const rv = await sluitVraag();
      ok('factuur: een regel weghalen telt als wijziging en de vraag biedt Opslaan (was: "Ja, sluiten" zonder Opslaan)', !!rv && rv.titel === 'Wijzigingen opslaan?' && /^Opslaan\|/.test(rv.knoppen), JSON.stringify(rv));
    }
    await allesDicht();
  }

  // --- taak: alleen een vinkje omzetten telt ook ---
  await page.evaluate(() => goView('taken')); await page.waitForSelector('.tk-kaart .tk-body', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(400);
  if (await page.$('.tk-kaart .tk-body')) {
    await page.locator('.tk-kaart .tk-body').first().click(); await page.waitForSelector('.tk-wie-opt', { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(300);
    if (await page.$('.tk-wie-opt')) {
      await page.locator('.tk-wie-opt').first().click(); await page.keyboard.press('Escape'); await page.waitForTimeout(350);
      ok('taak: alleen een vinkje "Toegewezen aan" omgezet → sluiten vraagt eerst (was: wijziging stil weg)', !!(await sluitVraag()), JSON.stringify(await sluitVraag()));
    }
    await allesDicht();
  }
  // snelle taak met een leeg veld
  await page.evaluate(() => { const t = document.querySelector('#toast'); if (t) { t.hidden = true; t.textContent = ''; } });
  await page.evaluate(() => document.querySelector('#tkSnel').requestSubmit ? document.querySelector('#tkSnel').requestSubmit() : document.querySelector('#tkSnel button').click()); await page.waitForTimeout(300);
  ok('snelle taak: Toevoegen met een leeg veld geeft uitleg (deed niets)', /Typ eerst/.test(await page.textContent('#toast')), await page.textContent('#toast'));

  // --- Instellingen: verwijderknoppen in rijen hebben een icoon en een titel ---
  await page.evaluate(() => goView('settings')); await page.waitForSelector('#statusRows .editor-row', { state: 'attached', timeout: 8000 }).catch(() => {}); await page.waitForTimeout(1200);
  const rijKnoppen = await page.evaluate(() => [...document.querySelectorAll('#settingsPanel .editor-row > button.btn-danger')].map((x) => ({ titel: x.title, svg: !!x.querySelector('svg') })));
  ok('Instellingen: elke verwijderknop bij kolommen, bronnen en standaardantwoorden heeft een icoon en een titel (waren lege knopjes)', rijKnoppen.length > 3 && rijKnoppen.every((x) => x.titel && x.svg), JSON.stringify(rijKnoppen.filter((x) => !x.titel || !x.svg)));
  await page.evaluate(() => showView('board')); await page.waitForTimeout(500);

  // --- telefoon: Facturen-knoppen in beeld; Berichten geeft de monteur geen geweigerde aanroep ---
  const tp = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const tpFout = []; tp.on('response', (r) => { if (r.status() === 403) tpFout.push(r.request().method() + ' ' + r.url().replace(BASE, '')); });
  await tp.goto(BASE + '/login.html', { waitUntil: 'networkidle' });
  await tp.fill('input[type=email], input[name=email], #email', 'bmonteur@keyservice.nl');
  await tp.fill('input[type=password], input[name=password], #password', 'monteur123');
  await Promise.all([tp.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), tp.click('button[type=submit], button')]);
  await tp.waitForSelector('.view:not([hidden])', { timeout: 10000 }).catch(() => {}); await tp.waitForTimeout(1200);
  const tpIn = await tp.evaluate(() => typeof state !== 'undefined' && !!state.me);
  if (tpIn) {
    await tp.evaluate(() => showView('chats')); await tp.waitForTimeout(1200);
    ok('monteur opent Berichten zonder geweigerde aanroep (gaf elke keer een 403 in de console)', !tpFout.some((x) => /chats\/seen/.test(x)), tpFout.join(' | '));
    await tp.evaluate(() => showView('invoices')); await tp.waitForTimeout(1200);
    const tk = await tp.evaluate(() => ['#newInvoiceBtn', '#newQuoteBtn', '#invSearch', '#invFilter'].map((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { s, x1: Math.round(r.left), x2: Math.round(r.right), zichtbaar: r.width > 0 }; }).filter(Boolean));
    ok('telefoon: + Factuur, + Offerte, zoeken en filter op Facturen passen binnen 390 px (+ Offerte stond buiten beeld)', tk.length >= 3 && tk.every((x) => !x.zichtbaar || (x.x1 >= 0 && x.x2 <= 390)), JSON.stringify(tk));
  } else ok('telefoon: monteur kan inloggen voor de naloop-controles', false, await tp.url());
  await tp.close();
}
noErr('Naloop deel 2');

// NALOOP DEEL 3 (25 nov 2026): punten uit de onafhankelijke controle van de wijzigingen.
clear();
{
  const metVraag = async (doe, { ja = false } = {}) => {
    const gezien = []; const h = async (d) => { gezien.push(d.type() + ':' + d.message()); try { if (ja || d.type() === 'beforeunload') await d.accept(); else await d.dismiss(); } catch { /* al afgehandeld */ } };
    page.on('dialog', h); try { await doe(); await page.waitForTimeout(450); } finally { page.off('dialog', h); }
    return gezien;
  };
  const sluitVraag = () => page.evaluate(() => { const w = document.querySelector('#sluitVraag'); return w ? { titel: w.querySelector('h3').textContent, knoppen: [...w.querySelectorAll('button')].map((x) => x.textContent.trim()).join('|') } : null; });
  const allesDicht = async () => { if (await page.$('#sluitVraag #sv-weg')) { await page.click('#sluitVraag #sv-weg'); await page.waitForTimeout(250); } await page.evaluate(() => { if (!document.querySelector('#modalRoot').hidden) { modalSchoon(); closeModal(); } }); };
  await allesDicht();
  await page.evaluate(() => goView('board')); await page.waitForTimeout(900);

  // --- "Opslaan" in de vraag bewaart de FACTUUR (koos eerst de knop "Delen / opslaan" → PDF gedeeld, niets bewaard) ---
  const d3 = await page.evaluate(async () => { const l = await fetch('/api/invoices').then((r) => r.json()); const i = l.find((x) => x.type !== 'offerte' && x.orderId && !x.sentAt && (x.lines || []).length); return i ? { id: i.id, orderId: i.orderId } : null; });
  if (d3) {
    await page.evaluate((id) => openOrderModal(id), d3.orderId); await page.waitForSelector('#f-invoice', { state: 'attached', timeout: 8000 }); await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('#f-invoice').click()); await page.waitForTimeout(1500);
    if (await page.$('[data-dockeuze]')) { const e = await page.$('[data-dockeuze] .dk-rij, [data-dockeuze] [data-dk]'); if (e) { await e.click(); await page.waitForTimeout(1500); } }
    const heeftDelen = !!(await page.$('#inv-share')) && !!(await page.$('#inv-save'));
    const nieuweTekst = 'Regel via de sluit-vraag ' + Date.now();
    if (heeftDelen) {
      await page.fill('#inv-lines .il-desc', nieuweTekst); await page.keyboard.press('Escape'); await page.waitForTimeout(350);
      const v = await sluitVraag();
      const knopDoel = await page.evaluate(() => { const b = modalBewaarKnop(); return b ? b.id : ''; });
      if (v) { await page.click('#sv-opslaan'); await page.waitForTimeout(1800); }
      const bewaard = await page.evaluate((id) => fetch(`/api/invoices/${id}`).then((r) => r.json()).then((j) => ((j.invoice || j).lines || []).map((x) => x.description).join('|')).catch(() => fetch('/api/invoices').then((r) => r.json()).then((l) => ((l.find((x) => x.id === id) || {}).lines || []).map((x) => x.description).join('|'))), d3.id);
      ok('factuur met een knop "Delen / opslaan": "Opslaan" in de sluit-vraag bewaart de factuur (deelde eerst de PDF en bewaarde niets)', !!v && knopDoel === 'inv-save' && bewaard.includes(nieuweTekst), JSON.stringify({ v, knopDoel, bewaard }));
    } else ok('factuur met Delen- én Opslaan-knop gevonden voor de test', false, JSON.stringify(d3));
    await allesDicht();
  } else ok('er is een opgeslagen factuur om de sluit-vraag op te testen', false);

  // --- "Doorgaan zonder opslaan" + vervolg afgebroken: de wijziging telt nog (sluiten vraagt daarna gewoon) ---
  const d3Ord = await page.evaluate(() => { const o = state.orders.find((x) => !['afgerond', 'geannuleerd'].includes(x.status)); return o ? o.id : ''; });
  await page.evaluate((id) => openOrderModal(id), d3Ord); await page.waitForSelector('#f-notes', { state: 'attached', timeout: 8000 }); await page.waitForTimeout(500);
  await page.evaluate(() => ovNaarVeld('#f-notes')); await page.fill('#f-notes', 'Nog niet opgeslagen ' + Date.now());
  if (await page.$('#f-onweg')) {
    await page.evaluate(() => document.querySelector('#f-onweg').scrollIntoView({ block: 'center' }));
    await page.click('#f-onweg'); await page.waitForTimeout(300);
    const eerst = await sluitVraag();
    const afgebroken = await metVraag(async () => { if (await page.$('#sv-weg')) await page.click('#sv-weg'); });   // de vraag "Klant laten weten…?" → Annuleren
    await page.waitForTimeout(300);
    const nogOpen = await page.evaluate(() => !document.querySelector('#modalRoot').hidden && !!document.querySelector('#f-notes'));
    if (nogOpen) {
      await page.keyboard.press('Escape'); await page.waitForTimeout(350);
      ok('opdracht: "Doorgaan zonder opslaan" en daarna het vervolg afbreken → sluiten vraagt nog steeds (wijziging telde niet meer)', !!eerst && !!(await sluitVraag()), JSON.stringify({ eerst, afgebroken, na: await sluitVraag() }));
    }
  }
  await allesDicht();

  // --- bellen/mailen met iets dat niet is opgeslagen geeft GEEN "Site verlaten?" ---
  await page.evaluate(() => goView('taken')); await page.waitForSelector('#tkSnelTitel', { timeout: 8000 }); await page.waitForTimeout(300);
  await page.fill('#tkSnelTitel', 'Half getypt voor de bel-test');
  const bel = await page.evaluate(async () => {
    const meet = () => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
    const voor = meet();
    const a = document.createElement('a'); a.href = 'tel:0612345678'; a.textContent = 'bel'; a.addEventListener('click', (e) => e.preventDefault()); document.body.appendChild(a); a.click();
    const direct = meet(); a.remove();
    await new Promise((r) => setTimeout(r, 2700));
    return { voor, direct, later: meet() };
  });
  ok('bellen (tel:-link) met iets dat niet is opgeslagen geeft geen "Site verlaten?"; daarna beschermt de vraag weer', bel.voor === true && bel.direct === false && bel.later === true, JSON.stringify(bel));
  await page.fill('#tkSnelTitel', '');

  // --- snelle taak: na een geslaagde toevoeging weer Zakelijk/Middel ---
  await page.click('#tkSnel .tk-keuze[data-k="categorie"] .tk-opt[data-v="prive"]');
  await page.fill('#tkSnelTitel', 'Privé proeftaak naloop ' + Date.now()); await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#tkSnelTitel').value, null, { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(700);
  const naToevoegen = await page.evaluate(() => (document.querySelector('#tkSnel .tk-keuze[data-k="categorie"] .tk-opt.active') || { dataset: {} }).dataset.v);
  ok('snelle taak: na toevoegen staat de keuze weer op Zakelijk (de volgende taak werd anders ongemerkt ook Privé)', naToevoegen === 'zakelijk', naToevoegen);

  // --- Instellingen: opslaan in het ene blok markeert een ANDER blok niet als bewaard ---
  await page.evaluate(() => goView('settings')); await page.waitForSelector('#ar-subject', { state: 'attached', timeout: 8000 }); await page.waitForTimeout(1200);
  await instKies(page, 'bericht'); await page.waitForTimeout(300);
  const d3Oud = await page.inputValue('#ar-subject');
  await page.fill('#ar-subject', 'Niet opgeslagen onderwerp ' + Date.now());
  await page.evaluate(() => { const k = document.querySelector('#ow-subject').closest('.info-card'); [...k.querySelectorAll('button')].find((x) => /opslaan/i.test(x.textContent)).click(); });
  await page.waitForTimeout(900);
  let d3v = await metVraag(() => page.evaluate(() => showView('board')));
  ok('Instellingen: een ander blok opslaan laat het niet-opgeslagen blok als "nog niet opgeslagen" staan', d3v.length === 1 && /ontvangstbevestiging/i.test(d3v[0]) && !/onderweg/i.test(d3v[0]), JSON.stringify(d3v));
  await page.fill('#ar-subject', d3Oud);
  d3v = await metVraag(() => page.evaluate(() => showView('board')));

  // --- concepten overleven een verversing (F5 / zelf-verversing na een update) ---
  await page.evaluate(() => goView('inbox')); await page.waitForSelector('#reviewList .review', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(500);
  const d3Rev = await page.evaluate(() => (document.querySelector('#reviewList .review') || { dataset: {} }).dataset.id || '');
  if (d3Rev) { await page.fill(`.review[data-id="${d3Rev}"] .r-cname`, 'Correctie Overleeft Verversen'); await page.evaluate(() => document.activeElement && document.activeElement.blur()); }
  const magHerladen = await page.evaluate(() => veiligOmTeHerladen());
  await page.evaluate(() => goView('chats')); await page.waitForSelector('.chat-item', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(400);
  const d3Chat = await page.evaluate(() => (document.querySelector('.chat-item') || { dataset: {} }).dataset.cid || '');
  if (d3Chat) { await page.click(`.chat-item[data-cid="${d3Chat}"]`); await page.waitForSelector('#cpText', { timeout: 6000 }); await page.waitForTimeout(300); await page.fill('#cpText', 'Concept overleeft verversen'); }
  await metVraag(() => page.reload({ waitUntil: 'networkidle' }), { ja: true });
  await page.waitForSelector('.view:not([hidden])', { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(1200);
  await page.evaluate(() => goView('inbox')); await page.waitForSelector('#reviewList .review', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(700);
  const naF5Inbox = d3Rev ? await page.inputValue(`.review[data-id="${d3Rev}"] .r-cname`).catch(() => 'weg') : 'geen item';
  await page.evaluate(() => goView('chats')); await page.waitForSelector('.chat-item', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(400);
  if (d3Chat) { await page.click(`.chat-item[data-cid="${d3Chat}"]`); await page.waitForSelector('#cpText', { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(500); }
  const naF5Chat = d3Chat ? await page.inputValue('#cpText').catch(() => 'weg') : 'geen gesprek';
  ok('na een verversing staan de getypte inbox-correctie en het half getypte bericht er weer; de zelf-verversing wacht niet eindeloos op een inbox-correctie', naF5Inbox === 'Correctie Overleeft Verversen' && naF5Chat === 'Concept overleeft verversen' && magHerladen === true, JSON.stringify({ naF5Inbox, naF5Chat, magHerladen }));
  if (d3Chat) { await page.fill('#cpText', ''); await page.waitForTimeout(100); }
  await page.evaluate(() => goView('inbox')); await page.waitForTimeout(600);
  if (d3Rev) await page.evaluate((id) => { const v = document.querySelector(`.review[data-id="${id}"] .r-cname`); if (v) v.value = v.defaultValue; }, d3Rev);
  await page.evaluate(() => goView('board')); await page.waitForTimeout(500);
}
noErr('Naloop deel 3');

// ONTWERP 2 (25 nov 2026): de volledige look van het goedgekeurde prototype — bovenbalk met
// zoeken + koppelingen, Start in twee kolommen, snelfilters op het bord, inbox als lijst + bericht.
clear();
{
  await page.evaluate(() => { if (!document.querySelector('#modalRoot').hidden) { modalSchoon(); closeModal(); } });
  await page.setViewportSize({ width: 1440, height: 900 });
  // --- bovenbalk: zoeken werkt op ELK scherm; resultaten sluiten bij een keuze of een ander scherm ---
  await page.evaluate(() => goView('board')); await page.waitForTimeout(900);
  const tb = await page.evaluate(() => { const b = document.querySelector('#topBalk'); const z = document.querySelector('#globalSearch'); const r = b.getBoundingClientRect(); return { zichtbaar: z.offsetParent !== null, top: Math.round(r.top), plakt: getComputedStyle(b).position, inStart: !!document.querySelector('#overviewPanel #globalSearch') }; });
  ok('ontwerp: het zoekveld staat in een vaste bovenbalk, ook op het bord (niet meer alleen op Start)', tb.zichtbaar && tb.top === 0 && tb.plakt === 'sticky' && !tb.inStart, JSON.stringify(tb));
  await page.fill('#globalSearch', 'Browser');
  await page.waitForFunction(() => !document.querySelector('#gsResults').hidden && document.querySelector('#gsResults').textContent.length > 3, null, { timeout: 6000 }).catch(() => {});
  const zoekOpen = await page.evaluate(() => !document.querySelector('#gsResults').hidden);
  await page.evaluate(() => showView('invoices')); await page.waitForTimeout(500);
  const zoekNaWissel = await page.evaluate(() => document.querySelector('#gsResults').hidden);
  ok('ontwerp: zoeken vanaf het bord geeft resultaten; bij een ander scherm klappen ze dicht', zoekOpen && zoekNaWissel, JSON.stringify({ zoekOpen, zoekNaWissel }));
  await page.fill('#globalSearch', ''); await page.waitForTimeout(400);
  // --- stand van de koppelingen rechtsboven, klik = het overzicht ---
  await page.waitForFunction(() => { const k = document.querySelector('#tbKoppel'); return k && !k.hidden; }, null, { timeout: 8000 }).catch(() => {});
  const kop = await page.evaluate(() => { const k = document.querySelector('#tbKoppel'); return { zichtbaar: !!k && !k.hidden, tekst: (document.querySelector('#tbKoppelTekst') || {}).textContent || '' }; });
  ok('ontwerp: rechtsboven staat hoe de koppelingen ervoor staan', kop.zichtbaar && /koppeling/i.test(kop.tekst), JSON.stringify(kop));
  await page.click('#tbKoppel'); await page.waitForSelector('#modal .ko-lijst', { timeout: 8000 }).catch(() => {});
  ok('ontwerp: een klik daarop opent het overzicht van alle koppelingen', !!(await page.$('#modal .ko-lijst')));
  await page.evaluate(() => { modalSchoon(); closeModal(); });

  // --- Start in twee kolommen ---
  await page.evaluate(() => goView('overview')); await page.waitForSelector('#eerstDoenBlok', { timeout: 8000 }); await page.waitForTimeout(1200);
  const st2 = await page.evaluate(() => { const l = document.querySelector('.ov-links').getBoundingClientRect(); const r = document.querySelector('.ov-rechts').getBoundingClientRect(); return { links: Math.round(l.left), rechts: Math.round(r.left), naast: r.left > l.right - 2 && Math.abs(r.top - l.top) < 4, eerstLinks: !!document.querySelector('.ov-links #eerstDoenBlok'), lijstenRechts: !!document.querySelector('.ov-rechts #ovLijsten'), kpis: !!document.querySelector('#ovKpis') }; });
  ok('ontwerp: Start staat in twee kolommen — links Eerst doen, rechts de lijsten van vandaag; de tegels staan er nog', st2.naast && st2.eerstLinks && st2.lijstenRechts && st2.kpis, JSON.stringify(st2));

  // --- bord: snelfilters; de knoppen staan als groep rechtsboven ---
  await page.evaluate(() => goView('board')); await page.waitForSelector('#boardSnel .snel', { timeout: 8000 }); await page.waitForTimeout(600);
  const totaalKaarten = await page.locator('#board .card[data-id]').count();
  await page.click('#boardSnel [data-snel="spoed"]'); await page.waitForTimeout(500);
  const spoed = await page.evaluate(() => ({ kaarten: [...document.querySelectorAll('#board .card[data-id]')].length, alleSpoed: [...document.querySelectorAll('#board .card[data-id]')].every((c) => c.classList.contains('urgent')), aan: document.querySelector('#boardSnel [data-snel="spoed"]').classList.contains('on') }));
  await page.click('#boardSnel [data-snel="src:drs"]'); await page.waitForTimeout(400);
  const drsKeuze = await page.evaluate(() => document.querySelector('#boardMonteurFilter').value);
  await page.click('#boardSnel [data-snel=""]'); await page.waitForTimeout(500);
  const naAlles = await page.evaluate(() => ({ kaarten: document.querySelectorAll('#board .card[data-id]').length, keuze: document.querySelector('#boardMonteurFilter').value, snel: state.boardSnel || '' }));
  ok('ontwerp: snelfilter "Spoed" toont alleen spoed; "DRS" zet de bestaande keuzelijst; "Alles" zet alles terug', spoed.aan && spoed.alleSpoed && spoed.kaarten <= totaalKaarten && drsKeuze === 'src:drs' && naAlles.kaarten === totaalKaarten && naAlles.keuze === '' && naAlles.snel === '', JSON.stringify({ totaalKaarten, spoed, drsKeuze, naAlles }));
  const knoppen = await page.evaluate(() => { const g = document.querySelector('.board-knoppen').getBoundingClientRect(); const h = document.querySelector('#view-board .view-head h2').getBoundingClientRect(); const n = document.querySelector('#newOrderBtn').getBoundingClientRect(); return { opRegelVanTitel: Math.abs(g.top - h.top) < 30, nieuwRechts: n.right > innerWidth - 80, alle: ['digestBtn', 'collapseBtn', 'phoneOrderBtn', 'drsReportBtn', 'pasteOrderBtn', 'newOrderBtn'].every((id) => { const e = document.getElementById(id); return e && e.offsetParent !== null; }) }; });
  ok('ontwerp: alle bordknoppen staan er nog, rechtsboven naast de titel, met "+ Nieuwe opdracht" helemaal rechts', knoppen.opRegelVanTitel && knoppen.nieuwRechts && knoppen.alle, JSON.stringify(knoppen));

  // --- inbox: lijst links, alleen het gekozen bericht rechts; vinkje in de lijst = vinkje van het bericht ---
  await page.evaluate(() => Promise.all([1, 2].map((i) => fetch('/api/ingest/email', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-token': 'test123' }, body: JSON.stringify({ from: `Ontwerp Proef ${i} <ontwerp${i}@example.nl>`, subject: 'Slot kapot', externalId: `bt-ontwerp-${i}-${Date.now()}`, body: `Goedemiddag, het slot van de voordeur is kapot.\nNaam: Ontwerp Proef ${i}\nAdres: Proefweg ${i}, 3911 AA Rhenen\nTelefoon: 06110002${i}0` }) }))));
  await page.evaluate(() => goView('inbox')); await page.waitForSelector('#inboxLijst .il-item', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(700);
  const ib = await page.evaluate(() => { const rijen = [...document.querySelectorAll('#reviewList .review')]; const zichtbaar = rijen.filter((r) => r.offsetParent !== null); return { split: document.querySelector('#inboxSplit').classList.contains('aan'), items: document.querySelectorAll('#inboxLijst .il-item').length, rijen: rijen.length, zichtbaar: zichtbaar.length, open: zichtbaar[0] ? zichtbaar[0].dataset.id : '', aan: (document.querySelector('#inboxLijst .il-item.on') || { dataset: {} }).dataset.id }; });
  ok('ontwerp: de inbox toont links de lijst en rechts precies één (het gekozen) bericht', ib.split && ib.items === ib.rijen && ib.items >= 2 && ib.zichtbaar === 1 && ib.open === ib.aan, JSON.stringify(ib));
  await page.locator('#inboxLijst .il-item').nth(1).click(); await page.waitForTimeout(250);
  const ib2 = await page.evaluate(() => { const z = [...document.querySelectorAll('#reviewList .review')].filter((r) => r.offsetParent !== null); return { zichtbaar: z.length, open: z[0] ? z[0].dataset.id : '', tweede: document.querySelectorAll('#inboxLijst .il-item')[1].dataset.id, velden: !!(z[0] && z[0].querySelector('.r-cname') && z[0].querySelector('.r-cname').offsetParent !== null) }; });
  ok('ontwerp: een ander bericht aanklikken in de lijst opent dát bericht, met de velden om te corrigeren', ib2.zichtbaar === 1 && ib2.open === ib2.tweede && ib2.velden, JSON.stringify(ib2));
  await page.locator('#inboxLijst .il-item .il-vink').first().click(); await page.waitForTimeout(200);
  const vinkje = await page.evaluate(() => { const id = document.querySelector('#inboxLijst .il-item').dataset.id; return { echt: document.querySelector(`#reviewList .review[data-id="${id}"] .r-select`).checked, inSel: inboxSel.has(id), teller: (document.querySelector('#bulkCount') || {}).textContent || '' }; });
  ok('ontwerp: het vinkje in de lijst selecteert het bericht voor de bulk-acties', vinkje.echt && vinkje.inSel && /1 geselecteerd/.test(vinkje.teller), JSON.stringify(vinkje));
  await page.locator('#inboxLijst .il-item .il-vink').first().click(); await page.waitForTimeout(150);
  // telefoon: alles onder elkaar zoals altijd (geen lijst links)
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(400);
  const ibTel = await page.evaluate(() => ({ lijst: document.querySelector('#inboxLijst').offsetParent !== null, zichtbaar: [...document.querySelectorAll('#reviewList .review')].filter((r) => r.offsetParent !== null).length, rijen: document.querySelectorAll('#reviewList .review').length }));
  ok('ontwerp: op de telefoon staat de inbox gewoon onder elkaar (alle berichten zichtbaar)', !ibTel.lijst && ibTel.zichtbaar === ibTel.rijen && ibTel.rijen >= 2, JSON.stringify(ibTel));
  await page.evaluate(() => goView('overview')); await page.waitForTimeout(900);
  const telStart = await page.evaluate(() => { const z = document.querySelector('#globalSearch'); const r = z.getBoundingClientRect(); return { zichtbaar: z.offsetParent !== null, binnen: r.left >= 0 && r.right <= 390, kop: Math.round(document.querySelector('.sidebar').getBoundingClientRect().height) }; });
  await page.evaluate(() => goView('board')); await page.waitForTimeout(600);
  const telBord = await page.evaluate(() => document.querySelector('#topBalk').offsetParent !== null);
  ok('ontwerp: op de telefoon staat het zoekveld op Start (past binnen 390 px) en kost het op andere schermen geen ruimte', telStart.zichtbaar && telStart.binnen && telStart.kop < 90 && !telBord, JSON.stringify({ telStart, telBord }));
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(300);
  // opruimen: de twee proefberichten weer weg
  await page.evaluate(async () => { const d = await fetch('/api/reviews?status=pending&limit=500').then((r) => r.json()); for (const r of (d.items || d)) if (/Ontwerp Proef/.test(JSON.stringify(r))) await fetch(`/api/reviews/${r.id}/reject`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); });
}
noErr('Ontwerp 2');

// ============================================================================================
// CAMPAGNES (25 nov 2026, stap 3): e-mail naar bestaande klanten. De AI (of de vaste regels) stelt
// voor, een mens beslist: er gaat niets uit zonder klik. Verzonnen klanten (.test-adressen).
clear();
{
  const dlg = async (doe, ja) => { const gezien = []; const h = async (d) => { gezien.push(d.message()); try { if (ja || d.type() === 'beforeunload') await d.accept(); else await d.dismiss(); } catch { /* al afgehandeld */ } }; page.on('dialog', h); try { await doe(); await page.waitForTimeout(500); } finally { page.off('dialog', h); } return gezien; };
  await page.evaluate(() => { if (document.querySelector('#sluitVraag #sv-weg')) document.querySelector('#sluitVraag #sv-weg').click(); if (!document.querySelector('#modalRoot').hidden) { modalSchoon(); closeModal(); } });
  await page.setViewportSize({ width: 1440, height: 900 });
  // vier verzonnen klanten met een e-mailadres, zodat er altijd iets voor te stellen valt
  await page.evaluate(async () => { for (let i = 1; i <= 4; i++) await fetch('/api/customers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `Campagne Proef ${i}`, email: `campagne-proef-${i}@voorbeeld.test`, phone: `06100000${40 + i}`, address: `Proefstraat ${i}, 3911 AA Rhenen` }) }); });
  const menu = await page.evaluate(() => { const k = document.querySelector('.nav-item[data-view="campagnes"]'); return { er: !!k, zichtbaar: !!k && !k.hidden && k.offsetParent !== null, naFacturen: !!k && k.previousElementSibling && k.previousElementSibling.dataset.view === 'invoices' }; });
  ok('campagnes: het menu-item staat bij Klanten & geld, direct onder Facturen', menu.er && menu.zichtbaar && menu.naFacturen, JSON.stringify(menu));
  await page.click('.nav-item[data-view="campagnes"]'); await page.waitForSelector('#cmpLijst > *', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(500);
  const info = await page.textContent('#cmpInfo');
  ok('campagnes: het scherm toont hoeveel klanten bereikbaar zijn en de grenzen (per dag, rust per klant)', /klanten met een e-mailadres/.test(info) && /hooguit \d+ verstuurd/.test(info) && /per \d+ dagen/.test(info), info);
  await page.click('#cmpVoorstelBtn'); await page.waitForSelector('.cmp-voorstel', { timeout: 30000 }).catch(() => {}); await page.waitForTimeout(400);
  const vst = await page.evaluate(() => [...document.querySelectorAll('.cmp-voorstel')].map((v) => ({ knop: !!v.querySelector('[data-vst]'), tekst: v.textContent.length })));
  const lijstVoor = await page.locator('#cmpLijst .cmp-rij').count();
  ok('campagnes: "Stel campagnes voor" geeft voorstellen met uitleg; een voorstel verstuurt niets (er komt geen campagne bij)', vst.length >= 1 && vst.every((v) => v.knop && v.tekst > 60) && lijstVoor === 0, JSON.stringify({ vst, lijstVoor }));
  await page.locator('.cmp-voorstel [data-vst]').first().click(); await page.waitForSelector('#cm-tekst', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(900);
  const concept = await page.evaluate(() => ({ onderwerp: (document.querySelector('#cm-onderwerp') || {}).value || '', tekst: (document.querySelector('#cm-tekst') || {}).value || '', wie: (document.querySelector('#cm-wie') || {}).textContent || '', knoppen: ['#cm-save', '#cm-plan', '#cm-nu', '#cm-testbtn', '#cm-ai'].every((k) => !!document.querySelector(k)) }));
  ok('campagnes: een voorstel wordt een CONCEPT met onderwerp, tekst met {naam}, het aantal ontvangers en de knoppen Opslaan · Inplannen · Nu versturen', concept.onderwerp.length > 3 && /\{naam\}/.test(concept.tekst) && /kla(nt|nten) krij/.test(concept.wie) && concept.knoppen, JSON.stringify({ ...concept, tekst: concept.tekst.slice(0, 40) }));
  const nee = await dlg(() => page.click('#cm-nu'), false);
  const naNee = await page.evaluate(async () => ({ editor: !!document.querySelector('#cm-tekst'), status: ((await fetch('/api/campagnes').then((r) => r.json())).campagnes || []).map((c) => c.status).join(',') }));
  ok('campagnes: "Nu versturen" vraagt eerst met het aantal ontvangers; Annuleren = er gaat niets uit', nee.length === 1 && /versturen naar \d+/.test(nee[0]) && naNee.editor && naNee.status === 'concept', JSON.stringify({ nee, naNee }));
  await dlg(async () => { await page.click('#cm-nu'); await page.waitForSelector('.cmp-tegels', { timeout: 10000 }).catch(() => {}); }, true);
  const verloop = await page.evaluate(() => ({ tegels: document.querySelectorAll('.cmp-tegels > *').length, tekst: (document.querySelector('#modal') || {}).textContent || '' }));
  ok('campagnes: na "ja" opent de voortgang (verstuurd · wacht nog · overgeslagen · mislukt · reacties · opdrachten); zonder mailinstelling staat er duidelijk "Proef"', verloop.tegels >= 6 && /verstuurd/.test(verloop.tekst) && /wacht nog/.test(verloop.tekst) && /reacties/.test(verloop.tekst) && /Proef/.test(verloop.tekst), JSON.stringify({ tegels: verloop.tegels, tekst: verloop.tekst.slice(0, 160) }));
  await page.click('#cv-close'); await page.waitForTimeout(700);
  const rij = await page.evaluate(() => ({ rijen: document.querySelectorAll('#cmpLijst .cmp-rij').length, tekst: (document.querySelector('#cmpLijst') || {}).textContent || '' }));
  ok('campagnes: de campagne staat daarna in de lijst met status en resultaat (verstuurd · reacties · nieuwe opdrachten)', rij.rijen === 1 && /Verstuurd|Bezig|Gepland/.test(rij.tekst) && /reacties/.test(rij.tekst) && /nieuwe opdrachten/.test(rij.tekst), rij.tekst.slice(0, 200));
  // een gestarte campagne is geen concept meer: de tekst kan niet stil veranderen
  const vast = await page.evaluate(async () => { const c = ((await fetch('/api/campagnes').then((r) => r.json())).campagnes || [])[0]; const r = await fetch(`/api/campagnes/${c.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tekst: 'Andere tekst' }) }); return r.status; });
  ok('campagnes: de tekst van een gestarte campagne is niet meer te wijzigen (409)', vast === 409, vast);
  // nieuw concept: sluiten met getypte tekst vraagt eerst, met Opslaan
  await page.click('#cmpNieuwBtn'); await page.waitForSelector('#cm-tekst', { timeout: 8000 }); await page.waitForTimeout(500);
  await page.fill('#cm-onderwerp', 'Proef onderwerp'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  const sv = await page.evaluate(() => { const w = document.querySelector('#sluitVraag'); return w ? [...w.querySelectorAll('button')].map((x) => x.textContent.trim()).join('|') : null; });
  ok('campagnes: een concept met getypte tekst sluiten vraagt eerst (Opslaan · Niet opslaan · Terug)', !!sv && /^Opslaan\|/.test(sv), sv);
  if (sv) { await page.click('#sv-weg'); await page.waitForTimeout(300); }
  // het snelle venster op Klanten wijst de weg naar Campagnes
  await page.evaluate(() => goView('customers')); await page.waitForSelector('#campaignBtn', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(500);
  if (await page.$('#campaignBtn')) {
    await page.click('#campaignBtn'); await page.waitForSelector('#cp-subject', { timeout: 8000 }).catch(() => {});
    ok('campagnes: het snelle mail-venster bij Klanten bestaat nog en verwijst naar het nieuwe scherm', !!(await page.$('#cp-subject')) && /Campagnes/.test(await page.textContent('#modal .cmp-tip').catch(() => '')), '');
    await page.evaluate(() => { modalSchoon(); closeModal(); });
  }
  // telefoon: past binnen het scherm
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => showView('campagnes')); await page.waitForTimeout(1000);
  const telC = await page.evaluate(() => ({ breed: document.documentElement.scrollWidth, knop: (() => { const k = document.querySelector('#cmpNieuwBtn').getBoundingClientRect(); return k.left >= 0 && k.right <= 390 && k.height >= 38; })() }));
  ok('campagnes: op de telefoon past het scherm binnen 390 px en is "+ Nieuwe campagne" een volwaardige knop', telC.breed <= 392 && telC.knop, JSON.stringify(telC));
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(300);
  // monteur: geen menu-item en de server weigert
  const mc = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await mc.goto(BASE + '/login.html', { waitUntil: 'networkidle' });
  await mc.fill('input[type=email], input[name=email], #email', 'bmonteur@keyservice.nl');
  await mc.fill('input[type=password], input[name=password], #password', 'monteur123');
  await Promise.all([mc.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), mc.click('button[type=submit], button')]);
  await mc.waitForSelector('.view:not([hidden])', { timeout: 10000 }).catch(() => {}); await mc.waitForTimeout(1000);
  const mIn = await mc.evaluate(() => typeof state !== 'undefined' && !!state.me && state.me.role === 'monteur');
  if (mIn) {
    const mm = await mc.evaluate(async () => { const k = document.querySelector('.nav-item[data-view="campagnes"]'); return { zichtbaar: !!k && !k.hidden && k.offsetParent !== null, lijst: (await fetch('/api/campagnes')).status, start: (await fetch('/api/campagnes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status }; });
    ok('campagnes: de monteur ziet het menu-item niet en de server weigert (403)', !mm.zichtbaar && mm.lijst === 403 && mm.start === 403, JSON.stringify(mm));
  } else ok('campagnes: monteur kon inloggen voor de rechtencontrole', false, 'inloggen als monteur mislukte');
  await mc.close();
}
noErr('Campagnes');

// ============================================================================================
// AFVINKEN OP START (25 nov 2026, wens eigenaar: "dit soort dingen en 'jouw dag in één oogopslag'
// moeten we af kunnen vinken of weg swipen"). Elk punt heeft een vinkje; op de telefoon is het weg
// te vegen. Weg van Start tot er iets nieuws bij komt, en altijd terug te zetten.
clear();
{
  const zetAllesTerug = (pg) => pg.evaluate(async () => { for (const k of ['inbox', 'wacht', 'reactie', 'afspraakGeweest', 'offertes', 'factureren', 'verlopen', 'drs', 'onvolledig', 'afspraakVandaag', 'dag']) await fetch('/api/start/terugzetten', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sleutel: k }) }); });
  const punten = (pg) => pg.evaluate(() => [...document.querySelectorAll('#eerstDoenBlok .eerst-item')].map((li) => ({ t: li.querySelector('strong').textContent, af: !!li.querySelector('.af-knop'), sleutel: li.querySelector('[data-eerst]').dataset.eerst })));
  await page.evaluate(() => { if (document.querySelector('#sluitVraag #sv-weg')) document.querySelector('#sluitVraag #sv-weg').click(); if (!document.querySelector('#modalRoot').hidden) { modalSchoon(); closeModal(); } });
  await page.setViewportSize({ width: 1440, height: 900 });
  // zeker iets om af te vinken: een aanvraag in de inbox, een taak voor vandaag en een afspraak van vandaag
  await page.evaluate(async () => {
    const j = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-token': 'test123' }, body: JSON.stringify(b) });
    await j('/api/ingest/email', { from: 'Afvink Proef <afvink-proef@voorbeeld.test>', subject: 'Slot vervangen', text: 'Goedemiddag, kunt u ons slot vervangen? Naam: Afvink Proef, tel 0610000071, Proeflaan 1, 3911 AA Rhenen', externalId: 'afvink-proef-' + Date.now() });
    await j('/api/taken', { titel: 'Afvinkproef op Start', urgentie: 'hoog', categorie: 'zakelijk', deadline: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' }) });
    await j('/api/orders', { customerName: 'Afvink Vandaag', customerPhone: '0610000072', title: 'Rhenen — afspraak van vandaag (afvinkproef)', status: 'afspraak_ingepland', appointmentAt: new Date().toISOString() });
  });
  await zetAllesTerug(page);
  await page.evaluate(() => goView('overview')); await page.waitForSelector('#eerstDoenBlok .eerst-item', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(1300);
  const voor = await punten(page);
  ok('afvinken: elk werkpunt van "Eerst doen" heeft een vinkje (een kapotte koppeling niet)', voor.length >= 1 && voor.every((p) => p.af === !(p.sleutel === 'bridge' || p.sleutel.startsWith('koppeling:'))), JSON.stringify(voor));
  const eerste = voor.find((p) => p.af);
  await page.locator(`#eerstDoenBlok .eerst-item .af-knop[data-af="${eerste.sleutel}"]`).click(); await page.waitForTimeout(1300);
  const na = await page.evaluate(() => ({ titels: [...document.querySelectorAll('#eerstDoenBlok .eerst-item strong')].map((x) => x.textContent), toast: document.querySelector('#toast').textContent, regel: (document.querySelector('#eerstAfToon') || {}).textContent || '', view: state.view }));
  ok('afvinken: een klik op het vinkje haalt het punt van Start (je blijft op Start), met "Ongedaan maken" en de regel "1 afgevinkt"', !na.titels.includes(eerste.t) && /Ongedaan maken/.test(na.toast) && /1 afgevinkt/.test(na.regel) && na.view === 'overview', JSON.stringify(na));
  await page.click('#toast .toast-undo'); await page.waitForTimeout(1300);
  ok('afvinken: "Ongedaan maken" zet het punt terug', (await punten(page)).some((p) => p.t === eerste.t));
  await page.locator(`#eerstDoenBlok .eerst-item .af-knop[data-af="${eerste.sleutel}"]`).click(); await page.waitForTimeout(1100);
  await page.click('#eerstAfToon'); await page.waitForTimeout(300);
  const afLijst = await page.evaluate(() => [...document.querySelectorAll('.eerst-af-lijst li')].map((li) => ({ t: li.querySelector('.eerst-af-tekst').textContent, knop: !!li.querySelector('[data-af-terug]') })));
  ok('afvinken: "afgevinkt · bekijken" laat zien wat is afgevinkt, door wie, met een knop Terugzetten', afLijst.length === 1 && afLijst[0].knop && afLijst[0].t.includes(eerste.t) && /Admin|Beheerder|Abdel/i.test(afLijst[0].t), JSON.stringify(afLijst));
  // de pulse hertekent Start: de open lijst en het vinkje blijven staan
  await page.evaluate(() => loadOverview()); await page.waitForTimeout(700);
  ok('afvinken: na een verversing is het punt nog steeds weg en staat de lijst nog open', !(await punten(page)).some((p) => p.t === eerste.t) && (await page.locator('.eerst-af-lijst li').count()) === 1);
  await page.click('.eerst-af-lijst [data-af-terug]'); await page.waitForTimeout(1300);
  ok('afvinken: Terugzetten in die lijst zet het punt terug op Start', (await punten(page)).some((p) => p.t === eerste.t) && !(await page.$('#eerstAfToon')));
  // een klik op de regel zelf doet nog wat hij deed (naar de juiste plek), het vinkje niet
  const inboxPunt = (await punten(page)).find((p) => p.sleutel === 'inbox');
  if (inboxPunt) {
    await page.click('#eerstDoenBlok [data-eerst="inbox"]'); await page.waitForTimeout(900);
    ok('afvinken: een klik op de regel zelf gaat nog gewoon naar de inbox', (await page.evaluate(() => state.view)) === 'inbox');
    await page.evaluate(() => goView('overview')); await page.waitForSelector('#eerstDoenBlok .eerst-item'); await page.waitForTimeout(900);
  }
  // "Jouw dag in één oogopslag": elke regel heeft een vinkje
  await page.waitForSelector('#dayov-body .dag-rij', { timeout: 15000 }).catch(() => {});
  const dag = await page.evaluate(() => ({ rijen: document.querySelectorAll('#dayov-body .dag-rij').length, knoppen: document.querySelectorAll('#dayov-body .dag-rij .af-knop').length }));
  ok('afvinken: elke regel van "Jouw dag in één oogopslag" heeft een vinkje', dag.rijen >= 1 && dag.knoppen === dag.rijen, JSON.stringify(dag));
  if (dag.rijen) {
    await page.locator('#dayov-body .dag-rij .af-knop').first().click(); await page.waitForTimeout(1100);
    const d2 = await page.evaluate(() => ({ rijen: document.querySelectorAll('#dayov-body .dag-rij').length, terug: (document.querySelector('#dagAfTerug') || {}).textContent || '' }));
    ok('afvinken: een regel van het dagoverzicht afvinken haalt hem weg, met "1 afgevinkt · terugzetten"', d2.rijen === dag.rijen - 1 && /1 afgevinkt/.test(d2.terug), JSON.stringify(d2));
    await page.evaluate(() => loadOverview()); await page.waitForTimeout(700);
    ok('afvinken: de regel blijft weg na een verversing (onthouden op de server, voor het hele kantoor)', (await page.locator('#dayov-body .dag-rij').count()) === dag.rijen - 1 && (await page.evaluate(async () => ((await (await fetch('/api/overview')).json()).dagAf || []).length)) === 1);
    await page.click('#dagAfTerug'); await page.waitForTimeout(1100);
    ok('afvinken: "terugzetten" brengt de regel van het dagoverzicht terug', (await page.locator('#dayov-body .dag-rij').count()) === dag.rijen);
  }
  // taken van vandaag: het vinkje = de taak is klaar (met Ongedaan maken)
  const taakId = await page.evaluate(() => { const li = [...document.querySelectorAll('#takenVandaagBlok li[data-taak]')].find((x) => /Afvinkproef/.test(x.textContent)); return li ? li.dataset.taak : ''; });
  if (taakId) {
    await page.click(`#takenVandaagBlok li[data-taak="${taakId}"] .af-knop`); await page.waitForTimeout(1200);
    const taak = await page.evaluate(async (id) => ({ klaar: [].concat(await (await fetch('/api/taken')).json()).find((t) => t.id === id)?.status, inLijst: !!document.querySelector(`#takenVandaagBlok li[data-taak="${id}"]`), view: state.view, toast: document.querySelector('#toast').textContent }), taakId);
    ok('afvinken: het vinkje bij een taak van vandaag zet de taak op klaar (je blijft op Start), met "Ongedaan maken"', taak.klaar === 'klaar' && !taak.inLijst && taak.view === 'overview' && /Ongedaan maken/.test(taak.toast), JSON.stringify(taak));
    await page.click('#toast .toast-undo'); await page.waitForTimeout(1200);
    ok('afvinken: "Ongedaan maken" zet de taak weer open', await page.evaluate(async (id) => [].concat(await (await fetch('/api/taken')).json()).find((t) => t.id === id)?.status !== 'klaar', taakId));
    await page.evaluate((id) => fetch(`/api/taken/${id}`, { method: 'DELETE' }), taakId);
  } else ok('afvinken: de proeftaak staat bij "Vandaag — taken"', false, 'taak niet gevonden in het blok');
  // de lijstjes rechts: per regel een vinkje; de tegel blijft het echte aantal
  const lij = await page.evaluate(() => { const li = [...document.querySelectorAll('#ovLijsten li.ov-af-rij')].find((x) => /afvinkproef/.test(x.textContent)); return { id: li ? li.dataset.open : '', knop: !!(li && li.querySelector('.af-knop')), tegel: [...document.querySelectorAll('#ovKpis .kpi-card')].find((k) => /Afspraken vandaag/.test(k.textContent))?.querySelector('.kpi-num').textContent }; });
  if (lij.id) {
    await page.click(`#ovLijsten li[data-open="${lij.id}"] .af-knop`); await page.waitForTimeout(1200);
    const l2 = await page.evaluate((id) => ({ weg: !document.querySelector(`#ovLijsten li[data-open="${id}"]`), modal: !document.querySelector('#modalRoot').hidden, tegel: [...document.querySelectorAll('#ovKpis .kpi-card')].find((k) => /Afspraken vandaag/.test(k.textContent))?.querySelector('.kpi-num').textContent, af: (document.querySelector('#eerstAfToon') || {}).textContent || '' }), lij.id);
    ok('afvinken: een regel in "Afspraken vandaag" afvinken haalt alleen die regel weg (de opdracht opent niet, de tegel blijft het echte aantal)', lij.knop && l2.weg && !l2.modal && l2.tegel === lij.tegel && /afgevinkt/.test(l2.af), JSON.stringify({ lij, l2 }));
  } else ok('afvinken: de proefafspraak staat bij "Afspraken vandaag"', false, 'afspraak niet gevonden');
  await zetAllesTerug(page);

  // --- telefoon: wegvegen ---
  const vp = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const vpFout = []; vp.on('pageerror', (e) => vpFout.push(e.message));
  await vp.goto(BASE + '/login.html', { waitUntil: 'networkidle' });
  await vp.fill('input[type=email], input[name=email], #email', 'admin@keyservice.nl');
  await vp.fill('input[type=password], input[name=password], #password', 'admin123');
  await Promise.all([vp.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), vp.click('button[type=submit], button')]);
  await vp.waitForSelector('.view:not([hidden])', { timeout: 10000 }).catch(() => {}); await vp.waitForTimeout(1000);
  await vp.evaluate(() => { const h = document.getElementById('pushHint'); if (h) h.hidden = true; showView('overview'); });
  await vp.waitForSelector('#eerstDoenBlok .eerst-item[data-veeg]', { timeout: 8000 }).catch(() => {}); await vp.waitForTimeout(1200);
  const veeg = (sel, dx, dy = 0) => vp.evaluate(({ sel, dx, dy }) => { const el = document.querySelector(sel); const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const mk = (type, cx, cy) => { const touch = new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy }); el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [touch], changedTouches: [touch] })); };
    mk('touchstart', x, y); for (let i = 1; i <= 8; i++) mk('touchmove', x + (dx * i) / 8, y + (dy * i) / 8); mk('touchend', x + dx, y + dy); }, { sel, dx, dy });
  const telVoor = await punten(vp);
  const doel = telVoor.find((p) => p.af);
  const rijSel = `#eerstDoenBlok .eerst-item[data-veeg] [data-eerst="${doel.sleutel}"]`;
  await veeg(rijSel, -45); await vp.waitForTimeout(500);
  await veeg(rijSel, 20, 160); await vp.waitForTimeout(500);
  const telKort = await vp.evaluate(() => ({ n: document.querySelectorAll('#eerstDoenBlok .eerst-item').length, view: state.view, vlag: !!window._dragging }));
  ok('afvinken (telefoon): een kort veegje of omlaag scrollen doet niets — de regel staat er nog, je bent nog op Start', telKort.n === telVoor.length && telKort.view === 'overview' && !telKort.vlag, JSON.stringify(telKort));
  await veeg(rijSel, -170); await vp.waitForTimeout(1400);
  const telNa = await vp.evaluate(() => ({ titels: [...document.querySelectorAll('#eerstDoenBlok .eerst-item strong')].map((x) => x.textContent), toast: document.querySelector('#toast').textContent, view: state.view, vlag: !!window._dragging }));
  ok('afvinken (telefoon): een regel wegvegen = afgevinkt, met "Ongedaan maken"; je blijft op Start en het scherm ververst daarna weer gewoon', !telNa.titels.includes(doel.t) && /Ongedaan maken/.test(telNa.toast) && telNa.view === 'overview' && !telNa.vlag, JSON.stringify(telNa));
  await vp.click('#toast .toast-undo'); await vp.waitForTimeout(1300);
  const telMaat = await vp.evaluate(() => { const k = document.querySelector('#eerstDoenBlok .af-knop').getBoundingClientRect(); return { breed: document.documentElement.scrollWidth, knop: Math.round(k.width), rechts: Math.round(k.right), terug: [...document.querySelectorAll('#eerstDoenBlok .eerst-item strong')].length }; });
  ok('afvinken (telefoon): na "Ongedaan maken" staat de regel er weer; het vinkje is 40 px en alles past binnen 390 px', telMaat.terug === telVoor.length && telMaat.knop >= 40 && telMaat.rechts <= 390 && telMaat.breed <= 392, JSON.stringify(telMaat));
  // wacht op antwoord: wegvegen = Afgehandeld (als er iemand wacht)
  const wachtId = await vp.evaluate(() => { const li = document.querySelector('#onbeantwoordBlok li[data-veeg]'); return li ? li.dataset.chat : ''; });
  if (wachtId) {
    await veeg(`#onbeantwoordBlok li[data-chat="${wachtId}"]`, 180); await vp.waitForTimeout(1400);
    const w = await vp.evaluate((id) => ({ weg: !document.querySelector(`#onbeantwoordBlok li[data-chat="${id}"]`), toast: document.querySelector('#toast').textContent, view: state.view }), wachtId);
    ok('afvinken (telefoon): bij "Wacht op antwoord" is wegvegen hetzelfde als Afgehandeld, met "Ongedaan maken"', w.weg && /Ongedaan maken/.test(w.toast) && w.view === 'overview', JSON.stringify(w));
    await vp.click('#toast .toast-undo'); await vp.waitForTimeout(1300);
    ok('afvinken (telefoon): "Ongedaan maken" zet de wachtende klant terug in de lijst', await vp.evaluate((id) => !!document.querySelector(`#onbeantwoordBlok li[data-chat="${id}"]`), wachtId));
  }
  ok('afvinken (telefoon): geen JS-fout', vpFout.length === 0, vpFout.join(' | '));
  await vp.close();
  // opruimen
  await page.evaluate(async () => {
    const o = (await (await fetch('/api/orders')).json()).find((x) => /afvinkproef/.test(x.title || '')); if (o) await fetch(`/api/orders/${o.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'afgerond', note: 'proef klaar' }) });
    const d = await fetch('/api/reviews?status=pending&limit=500').then((r) => r.json()); for (const r of (d.items || d)) if (/Afvink Proef/.test(JSON.stringify(r))) await fetch(`/api/reviews/${r.id}/reject`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  });
  await zetAllesTerug(page);
}
noErr('Afvinken op Start');

// ============================================================================================
// 26 NOV 2026 (wensen eigenaar): campagne met een vast sjabloon + eigen foto + voorbeeld,
// mededelingen aan het team, en het weekrapport dat op de telefoon te breed was.
clear();
{
  await page.evaluate(() => { if (document.querySelector('#sluitVraag #sv-weg')) document.querySelector('#sluitVraag #sv-weg').click(); if (!document.querySelector('#modalRoot').hidden) { modalSchoon(); closeModal(); } });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const dlgJa = (d) => d.accept().catch(() => {}); page.on('dialog', dlgJa);
  // --- campagne: sjablonen ---
  await page.evaluate(() => goView('campagnes')); await page.waitForSelector('#cmpLijst > *', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(500);
  await page.click('#cmpNieuwBtn'); await page.waitForSelector('#cm-sjablonen .cmp-sj-knop', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(400);
  const sjKeuze = await page.evaluate(() => ({ knoppen: [...document.querySelectorAll('#cm-sjablonen .cmp-sj-knop')].map((k) => k.dataset.sj).join(), aan: (document.querySelector('#cm-sjablonen .cmp-sj-knop.aan') || {}).dataset?.sj, velden: !document.querySelector('#cm-opmaak').hidden }));
  ok('sjablonen: een nieuwe campagne biedt "alleen tekst" en de drie vaste sjablonen; standaard alleen tekst, zonder opmaakvelden', sjKeuze.knoppen === 'tekst,schuifpui,kozijn,sloten' && sjKeuze.aan === 'tekst' && !sjKeuze.velden, JSON.stringify(sjKeuze));
  const perSj = [];
  for (const key of ['schuifpui', 'kozijn', 'sloten']) {
    await page.click(`#cm-sjablonen [data-sj="${key}"]`); await page.waitForTimeout(250);
    const v = await page.evaluate(() => ({ o: document.querySelector('#cm-onderwerp').value, t: document.querySelector('#cm-tekst').value, kop: document.querySelector('#cm-kop').value, knop: document.querySelector('#cm-knoptekst').value, velden: !document.querySelector('#cm-opmaak').hidden }));
    await page.click('#cm-vb-knop'); await page.waitForSelector('#cm-vb iframe', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(600);
    const fr = page.frameLocator('#cm-vb iframe');
    const h1 = await fr.locator('h1').textContent().catch(() => ''); const knop = (await fr.locator('a[href^="tel:"]').first().textContent().catch(() => '')).trim(); const afmeld = await fr.locator('a', { hasText: 'Meld u hier af' }).count().catch(() => 0);
    perSj.push({ key, goed: v.velden && v.o.length > 5 && /Beste \{naam\}/.test(v.t) && !!v.kop && h1 === v.kop && knop === v.knop && afmeld === 1, v: { o: v.o, kop: v.kop, knop: v.knop }, h1, knop });
  }
  ok('sjablonen: elk sjabloon vult onderwerp, tekst, kop en knoptekst in, en het voorbeeld toont de mail met die kop, een bel-knop en de afmeldlink', perSj.every((x) => x.goed) && new Set(perSj.map((x) => x.h1)).size === 3, JSON.stringify(perSj));
  await page.fill('#cm-tekst', 'Beste {naam},\n\nMijn eigen tekst voor de proef.'); await page.click('#cm-sjablonen [data-sj="schuifpui"]'); await page.waitForTimeout(250);
  ok('sjablonen: wisselen van sjabloon overschrijft een zelf getypte tekst niet', (await page.inputValue('#cm-tekst')).includes('Mijn eigen tekst'));
  // eigen foto (wordt in de browser verkleind) → zichtbaar in het voorbeeld
  await page.setInputFiles('#cm-foto', { name: 'proef.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAGCAYAAAD68A/GAAAAFklEQVR42mP8z8Dwn4EIwDiqkL4KAZ0jBf3bV1p1AAAAAElFTkSuQmCC', 'base64') }); await page.waitForTimeout(2000);
  const foto = await page.evaluate(() => ({ status: document.querySelector('#cm-fotostatus').textContent, weg: !document.querySelector('#cm-fotoweg').hidden }));
  const fotoInVb = await page.frameLocator('#cm-vb iframe').locator('img[src*="/foto"]').evaluate((i) => i.complete && i.naturalWidth > 0).catch(() => false);
  ok('sjablonen: een eigen foto toevoegen bewaart het concept en toont de foto in het voorbeeld', /staat een foto/.test(foto.status) && foto.weg && fotoInVb, JSON.stringify({ foto, fotoInVb }));
  await page.click('#cm-vb-maat [data-vbm="tel"]'); await page.waitForTimeout(300);
  ok('sjablonen: het voorbeeld is ook op telefoonbreedte te bekijken', (await page.evaluate(() => Math.round(document.querySelector('#cm-vb iframe').getBoundingClientRect().width))) === 375);
  await page.click('#cm-save'); await page.waitForTimeout(1200);
  const bewaard = await page.evaluate(async () => { const c = ((await (await fetch('/api/campagnes')).json()).campagnes || []).find((x) => /eigen tekst voor de proef/.test(x.tekst)); return c ? { id: c.id, opmaak: c.opmaak, foto: c.foto } : null; });
  ok('sjablonen: opslaan bewaart het sjabloon, de kop, de knop en de foto bij de campagne', !!bewaard && bewaard.opmaak.sjabloon === 'schuifpui' && !!bewaard.opmaak.kop && !!bewaard.opmaak.knopTekst && bewaard.foto === true, JSON.stringify(bewaard));
  if (bewaard) await page.evaluate((id) => fetch(`/api/campagnes/${id}`, { method: 'DELETE' }), bewaard.id);

  // --- mededeling aan het team ---
  await page.evaluate(() => goView('overview')); await page.waitForSelector('#mededelingBtn', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(700);
  await page.click('#mededelingBtn'); await page.waitForSelector('#mdl-titel', { timeout: 8000 });
  await page.fill('#mdl-titel', 'Proefmededeling: vrijdag om 15:00 dicht'); await page.fill('#mdl-tekst', 'Graag de bus <b>op tijd</b> terug.');
  await page.click('#mdl-save'); await page.waitForTimeout(1300);
  ok('mededeling: de beheerder plaatst een bericht via "Mededeling aan team"; hij ziet het zelf niet als balk', await page.evaluate(() => document.querySelector('#modalRoot').hidden && document.querySelector('#mededelingBalk').hidden));
  const mm = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mmFout = []; mm.on('pageerror', (e) => mmFout.push(e.message));
  await mm.goto(BASE + '/login.html', { waitUntil: 'networkidle' });
  await mm.fill('input[type=email], input[name=email], #email', 'bmonteur@keyservice.nl');
  await mm.fill('input[type=password], input[name=password], #password', 'monteur123');
  await Promise.all([mm.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), mm.click('button[type=submit], button')]);
  await mm.waitForSelector('.view:not([hidden])', { timeout: 10000 }).catch(() => {}); await mm.waitForTimeout(1500);
  const balk = await mm.evaluate(() => { const b = document.querySelector('#mededelingBalk'); return { zichtbaar: !!b && !b.hidden && b.offsetParent !== null, tekst: b ? b.textContent : '', opmaak: !!(b && b.querySelector('.meded-tekst b')), breed: document.documentElement.scrollWidth, plaatsknop: !!document.querySelector('#mededelingBtn'), knop: (() => { const k = b && b.querySelector('[data-meded-gelezen]'); return k ? Math.round(k.getBoundingClientRect().height) : 0; })() }; });
  ok('mededeling: de monteur ziet hem op de telefoon bovenaan zijn scherm (past binnen 390 px, knop Gelezen 40 px, getypte tekens worden geen opmaak); zelf plaatsen kan hij niet', balk.zichtbaar && /Proefmededeling/.test(balk.tekst) && /op tijd/.test(balk.tekst) && !balk.opmaak && balk.breed <= 392 && balk.knop >= 40 && !balk.plaatsknop, JSON.stringify(balk));
  await mm.click('#mededelingBalk [data-meded-gelezen]'); await mm.waitForTimeout(1000);
  ok('mededeling: na "Gelezen" is de balk weg, ook na opnieuw laden', (await mm.evaluate(() => document.querySelector('#mededelingBalk').hidden)) && (await mm.evaluate(async () => (await (await fetch('/api/mededelingen')).json()).mijn.length)) === 0);
  await page.click('#mededelingBtn'); await page.waitForSelector('#mdl-lijst li', { timeout: 8000 }); await page.waitForTimeout(300);
  const lezers = await page.evaluate(() => [...document.querySelectorAll('#mdl-lijst li')].find((li) => /Proefmededeling/.test(li.textContent))?.textContent || '');
  ok('mededeling: de beheerder ziet wie het gelezen heeft (de monteur staat erbij) en wie nog niet', /Gelezen door \d+ van \d+/.test(lezers) && /Browser Monteur/.test(lezers.split('nog niet')[0]), lezers.slice(0, 260));
  await page.evaluate(() => [...document.querySelectorAll('#mdl-lijst li')].find((li) => /Proefmededeling/.test(li.textContent)).querySelector('[data-mdl-weg]').click()); await page.waitForTimeout(1200);
  ok('mededeling: intrekken zet hem op "ingetrokken"', /ingetrokken/.test(await page.evaluate(() => [...document.querySelectorAll('#mdl-lijst li')].find((li) => /Proefmededeling/.test(li.textContent))?.textContent || '')));
  await page.evaluate(() => { modalSchoon(); closeModal(); });
  ok('mededeling (telefoon): geen JS-fout', mmFout.length === 0, mmFout.join(' | '));
  await mm.close();

  // --- weekrapport op de telefoon: de kaart was breder dan het scherm ---
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => goView('overview')); await page.waitForSelector('#ovWeekrapport .wr-kpis', { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(600);
  const wr = await page.evaluate(() => { const k = document.querySelector('#ovWeekrapport'); const r = k.getBoundingClientRect(); const breedste = [...k.querySelectorAll('#wr-body *')].reduce((m, e) => Math.max(m, e.getBoundingClientRect().right), 0); return { links: Math.round(r.left), rechts: Math.round(r.right), breedste: Math.round(breedste), pagina: document.documentElement.scrollWidth, kop: getComputedStyle(k.querySelector('.wr-tabel thead') || k).display, kolommen: getComputedStyle(k.querySelector('.wr-kpis')).gridTemplateColumns.split(' ').length }; });
  ok('weekrapport (telefoon): de kaart en alles erin past binnen 390 px; de monteurs staan als blokjes (geen brede tabel), de tegels twee naast elkaar', wr.links >= 0 && wr.rechts <= 390 && wr.breedste <= wr.rechts && wr.pagina <= 392 && wr.kop === 'none' && wr.kolommen === 2, JSON.stringify(wr));
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(400);
  ok('weekrapport (pc): daar is het nog gewoon een tabel met kolomkoppen', (await page.evaluate(() => getComputedStyle(document.querySelector('#ovWeekrapport .wr-tabel thead')).display)) !== 'none');
  page.off('dialog', dlgJa);
}
noErr('Sjablonen, mededelingen en weekrapport');

// ============================================================================================
// 27 NOV 2026 (wens eigenaar): de ontvangstbevestiging ook via WhatsApp — eigen schakelaar in
// Instellingen → Berichten aan klanten, standaard uit.
clear();
{
  await page.evaluate(() => { if (document.querySelector('#sluitVraag #sv-weg')) document.querySelector('#sluitVraag #sv-weg').click(); if (!document.querySelector('#modalRoot').hidden) { modalSchoon(); closeModal(); } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { try { localStorage.setItem('ksInstellingenGroep', 'bericht'); } catch { /* geen opslag */ } return goView('settings'); });
  await page.waitForSelector('#ar-wa-enabled', { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(500);
  const wab = await page.evaluate(() => { const v = document.querySelector('#ar-wa-enabled'); const t = document.querySelector('#ar-wa-body'); return { er: !!v && !!t, aan: !!v && v.checked, tekst: t ? t.value : '', inKaart: !!v && !!v.closest('.info-card').querySelector('#saveAutoReply'), binnen: !!v && !!v.closest('.inst-inhoud') }; });
  ok('WhatsApp-bevestiging: de schakelaar staat in de kaart van de ontvangstbevestiging, standaard UIT, met een standaardtekst', wab.er && !wab.aan && /automatisch bericht/i.test(wab.tekst) && wab.inKaart && wab.binnen, JSON.stringify(wab));
  await page.evaluate(() => { document.querySelector('#ar-wa-enabled').closest('.info-card').scrollIntoView({ block: 'center' }); });
  await page.check('#ar-wa-enabled'); await page.fill('#ar-wa-body', 'Bedankt voor uw bericht. Wij bellen u zo snel mogelijk. (Automatisch bericht.)');
  await page.click('#saveAutoReply'); await page.waitForTimeout(1200);
  const bewaard = await page.evaluate(async () => (await (await fetch('/api/settings')).json()).autoReply);
  ok('WhatsApp-bevestiging: aanzetten + eigen tekst worden bewaard met de knop Opslaan van die kaart (de mailinstelling blijft zoals hij was)', bewaard.whatsappEnabled === true && /Wij bellen u/.test(bewaard.whatsappBody) && typeof bewaard.enabled === 'boolean' && !!bewaard.subject, JSON.stringify(bewaard).slice(0, 260));
  await page.evaluate(async () => { const a = (await (await fetch('/api/settings')).json()).autoReply; await fetch('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ autoReply: { ...a, whatsappEnabled: false, whatsappBody: '' } }) }); });
  await page.evaluate(() => goView('overview')); await page.waitForTimeout(600);
  if (await page.$('#sluitVraag #sv-weg')) await page.click('#sluitVraag #sv-weg');
}
noErr('Ontvangstbevestiging via WhatsApp');

// ============================================================================================
// 27 NOV 2026 (besluit eigenaar): klanten alleen via het officiële WhatsApp-nummer, een knop per
// automatisch WhatsApp-bericht, en Campagnes aan/uit (op de live-site uit tot hij ze aanzet).
clear();
{
  await page.evaluate(() => { try { localStorage.setItem('ksInstellingenGroep', 'bericht'); } catch { /* geen opslag */ } return goView('settings'); });
  await page.waitForSelector('#waAutoKaart [data-wa-auto]', { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(500);
  const wk = await page.evaluate(() => { const k = document.querySelector('#waAutoKaart'); const kn = [...document.querySelectorAll('#waAutoKaart [data-wa-auto]')];
    return { er: !!k, binnen: !!k && !!k.closest('.inst-inhoud'), zichtbaar: !!k && k.offsetParent !== null, sleutels: kn.map((x) => x.dataset.waAuto).join(','), betaal: kn.find((x) => x.dataset.waAuto === 'betaal')?.checked, review: kn.find((x) => x.dataset.waAuto === 'review')?.checked, breed: kn.every((x) => x.getBoundingClientRect().width >= 40) }; });
  ok('WhatsApp-knoppen: één kaart met een knop per automatisch bericht (8), nieuw staat uit en wat al ging staat aan', wk.er && wk.binnen && wk.zichtbaar && wk.sleutels === 'ontvangst,afspraak,annulering,herinnering,review,opvolging,offerte,betaal' && wk.betaal === false && wk.review === true && wk.breed, JSON.stringify(wk));
  await page.evaluate(() => document.querySelector('#waAutoKaart').scrollIntoView({ block: 'center' }));
  await page.check('[data-wa-auto="betaal"]'); await page.check('[data-wa-auto="ontvangst"]'); await page.waitForTimeout(1200);
  const na = await page.evaluate(async () => ({ stand: (await (await fetch('/api/whatsapp/automatisch')).json()).stand, vink: document.querySelector('#ar-wa-enabled')?.checked, open: instellingenGewijzigd().length }));
  ok('WhatsApp-knoppen: omzetten wordt meteen bewaard (geen Opslaan nodig, geen "niet opgeslagen"), en het vinkje in de kaart eronder loopt mee', na.stand.betaal === true && na.stand.ontvangst === true && na.vink === true && na.open === 0, JSON.stringify(na));
  await page.evaluate(async () => { for (const soort of ['betaal', 'ontvangst']) await fetch('/api/whatsapp/automatisch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ soort, aan: false }) }); });

  // Campagnes aan/uit + proefmail
  const ck = await page.evaluate(() => { const k = document.querySelector('#campagneAanKaart'); return { er: !!k, binnen: !!k && !!k.closest('.inst-inhoud'), aan: document.querySelector('#cmp-aan')?.checked, proef: !!document.querySelector('#cmp-proef-btn'), naar: document.querySelector('#cmp-proef-naar')?.value || '', menu: [...document.querySelectorAll('.sidebar [data-view="campagnes"]')].some((el) => el.offsetParent !== null) }; });
  ok('Campagnes aan/uit: kaart voor de beheerder met de knop "Stuur mij een proefmail" (eigen adres vooringevuld) en de schakelaar', ck.er && ck.binnen && ck.aan === true && ck.proef && /@/.test(ck.naar) && ck.menu, JSON.stringify(ck));
  await page.evaluate(() => document.querySelector('#campagneAanKaart').scrollIntoView({ block: 'center' }));
  await page.uncheck('#cmp-aan'); await page.waitForTimeout(1000);
  const uit = await page.evaluate(async () => { const zichtbaar = [...document.querySelectorAll('[data-view="campagnes"]')].some((el) => el.offsetParent !== null); showView('campagnes'); await new Promise((r) => setTimeout(r, 300));
    return { zichtbaar, view: state.view, server: (await (await fetch('/api/me')).json()).meta.campagnes, uitleg: document.querySelector('#cmp-aan-uitleg')?.textContent || '', nieuw: nieuwPunten().some((p) => /campagne/i.test(p[0])) }; });
  ok('Campagnes UIT: het menu-item is weg, het scherm is niet te openen en de uitleg "Wat is er veranderd?" noemt het niet', uit.zichtbaar === false && uit.view === 'settings' && uit.server === false && /Uit:/.test(uit.uitleg) && uit.nieuw === false, JSON.stringify(uit));
  page.once('dialog', (d) => d.accept());
  await page.check('#cmp-aan'); await page.waitForTimeout(1000);
  const aan = await page.evaluate(async () => ({ zichtbaar: [...document.querySelectorAll('.sidebar [data-view="campagnes"]')].some((el) => el.offsetParent !== null), server: (await (await fetch('/api/me')).json()).meta.campagnes }));
  ok('Campagnes weer AAN (na een bevestiging): het menu-item is terug', aan.zichtbaar === true && aan.server === true, JSON.stringify(aan));

  // Koppelingen: de vaste regel staat erbij, de oude schakelaar is weg
  await page.evaluate(() => { try { localStorage.setItem('ksInstellingenGroep', 'koppel'); } catch { /* geen opslag */ } return goView('overview').then(() => goView('settings')); });
  await page.waitForSelector('#koppelOverzichtKaart', { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(600);
  const vr = await page.evaluate(() => ({ schakelaar: !!document.querySelector('#wa-bridge-groepen'), tekst: [...document.querySelectorAll('#settingsPanel .info-card')].map((k) => k.textContent).find((t) => /Officiële WhatsApp \(Meta\)/.test(t)) || '' }));
  ok('Koppelingen: "klanten alleen via het officiële nummer" staat er als vaste regel; de oude schakelaar is weg', vr.schakelaar === false && /alleen via dit officiële nummer/.test(vr.tekst) && /nooit een klantbericht/.test(vr.tekst), vr.tekst.slice(0, 200));
  await page.evaluate(() => goView('overview')); await page.waitForTimeout(600);
  if (await page.$('#sluitVraag #sv-weg')) await page.click('#sluitVraag #sv-weg');
}
noErr('WhatsApp-knoppen en Campagnes aan/uit');

console.log(`\n========== BROWSER: ${pass} geslaagd, ${fail} gefaald ==========`);
await browser.close();
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);

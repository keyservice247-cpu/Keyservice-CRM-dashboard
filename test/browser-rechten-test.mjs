// Browsertest: RECHTEN IN HET SCHERM na de audit (23 nov 2026). Headless Chromium tegen een
// lokale testserver op poort 3153 (verse database, SESSION_SECRET=test). Faalt bij elke
// JS-fout in de console. Bewaakt:
//  - assistente: Cijfers toont alleen de conversie, nergens omzet of winst;
//  - beheerder: Cijfers ongewijzigd, met omzet;
//  - monteur: geen Cijfers, geen foutmeldingen bij het openen;
//  - een rare datumtekst komt nooit als opmaak in het scherm.
import fs from 'node:fs';
import { chromium } from 'playwright-core';
const EXEC = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium'].find((p) => p && fs.existsSync(p));
const BASE = 'http://localhost:3153';
let pass = 0, fail = 0; const bad = [];
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; bad.push(n); console.log('  ✗ FAIL: ' + n + (e ? ' — ' + e : '')); } };
const post = async (cookie, path, body, method = 'POST') => { const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }); return r.json().catch(() => ({})); };
const inlog = async (email, password) => ((await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })).headers.get('set-cookie') || '').split(';')[0];

// ---------- gegevens klaarzetten via de API ----------
const admin = await inlog('admin@keyservice.nl', 'admin123');
const sam = await post(admin, '/api/monteurs', { name: 'Sam', phone: '0611000101' });
await post(admin, '/api/users', { name: 'Noor Test', email: 'noor@rechten.test', password: 'assist-12345', role: 'assistent' });
await post(admin, '/api/users', { name: 'Sam Test', email: 'sam@rechten.test', password: 'monteur-12345', role: 'monteur', monteurId: sam.id });
const o1 = await post(admin, '/api/orders', { customerName: 'Familie Proef', customerPhone: '0611000201', customerAddress: 'Proefweg 1, 1234 AB Testdorp', title: 'Testdorp — slot vervangen', monteurId: sam.id, price: '987' });
await post(admin, `/api/orders/${o1.id}`, { status: 'afgerond', notes: 'klaar' }, 'PATCH');
await post(admin, '/api/finance', { kind: 'income', amount: 4321, category: 'Overig', date: new Date().toISOString().slice(0, 10) });

const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
async function sessie(email, password, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage(); const fouten = [];
  page.on('pageerror', (e) => fouten.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|manifest|ServiceWorker/i.test(m.text())) fouten.push(m.text()); });
  await page.goto(BASE + '/login.html', { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', email); await page.fill('input[type=password]', password);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), page.click('button[type=submit]')]);
  await page.waitForSelector('.view:not([hidden])'); await page.waitForTimeout(1500);
  return { ctx, page, fouten };
}
const tekstVan = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return ''; const zicht = (n) => { const st = getComputedStyle(n); return st.display !== 'none' && st.visibility !== 'hidden'; }; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let t = ''; while (w.nextNode()) { let n = w.currentNode.parentElement, ok = true; while (n && n !== el.parentElement) { if (!zicht(n)) { ok = false; break; } n = n.parentElement; } if (ok) t += ' ' + w.currentNode.textContent; } return t.replace(/\s+/g, ' '); }, sel);

console.log('\n== Assistente (standaardrechten) ==');
{
  const { ctx, page, fouten } = await sessie('noor@rechten.test', 'assist-12345');
  ok('geen testbalk buiten de testomgeving', await page.evaluate(() => !document.getElementById('testBalk')));
  await page.waitForTimeout(1500);
  const start = await tekstVan(page, '#view-overview');
  ok('Start: weekrapport zonder omzet', !/omzet/i.test(start) && !/€\s?987|€\s?4\.?321/.test(start), start.match(/.{0,40}omzet.{0,40}/i)?.[0] || '');
  ok('menu: Cijfers is zichtbaar', await page.evaluate(() => !!document.querySelector('.nav-item[data-view="finance"]')));
  await page.evaluate(() => document.querySelector('.nav-item[data-view="finance"]').click()); await page.waitForTimeout(2500);
  const cij = await tekstVan(page, '#view-finance');
  ok('Cijfers: conversieblok staat er', /Conversie/i.test(cij) && /Binnengekomen/i.test(cij), cij.slice(0, 120));
  ok('Cijfers: geen euroteken, geen "omzet", "winst" of "kosten" in beeld', !/€/.test(cij) && !/\bomzet\b|\bwinst\b|\bkosten\b/i.test(cij), (cij.match(/.{0,40}(€|omzet|winst|kosten).{0,40}/i) || [''])[0]);
  ok('Cijfers: geen knoppen om te boeken', await page.evaluate(() => { const el = document.querySelector('#view-finance .view-actions'); return !el || getComputedStyle(el).display === 'none'; }));
  ok('Cijfers: paneel met omzet en kosten is leeg', await page.evaluate(() => (document.querySelector('#financePanel')?.innerText || '').trim() === ''));
  await page.evaluate(() => document.querySelector('.nav-item[data-view="invoices"]').click()); await page.waitForTimeout(1500);
  const fac = await tekstVan(page, '#view-invoices');
  ok('Facturen: geen totaalbedrag "Betaald" voor de assistente', !/Betaald:\s*€/.test(fac), (fac.match(/.{0,30}Betaald:.{0,30}/) || [''])[0]);
  ok('assistente: geen fouten in de console', fouten.length === 0, fouten.slice(0, 3).join(' | '));
  await ctx.close();
}

console.log('\n== Beheerder ==');
{
  const { ctx, page, fouten } = await sessie('admin@keyservice.nl', 'admin123');
  await page.evaluate(() => document.querySelector('.nav-item[data-view="finance"]').click()); await page.waitForTimeout(2500);
  const cij = await tekstVan(page, '#view-finance');
  ok('Cijfers: omzet en kosten staan er gewoon', /Omzet/i.test(cij) && /€/.test(cij) && /4321|4\.321/.test(cij), cij.slice(0, 160));
  ok('Cijfers: boekknoppen zichtbaar', await page.evaluate(() => getComputedStyle(document.querySelector('#view-finance .view-actions')).display !== 'none'));
  ok('conversietabel toont de omzetkolom', await page.evaluate(() => [...document.querySelectorAll('#conversiePanel .cv-geld')].some((el) => getComputedStyle(el).display !== 'none')));
  await page.evaluate(() => document.querySelector('.nav-item[data-view="users"]').click()); await page.waitForTimeout(1200);
  ok('Gebruikers: het recht "Conversie bekijken" bestaat in de app', await page.evaluate(() => typeof PERM_LABELS !== 'undefined' && PERM_LABELS.some((p) => p[0] === 'conversie')));
  ok('een rare datumtekst wordt nooit opmaak', await page.evaluate(() => { const t = fmtDate('<img src=x onerror="window.__proef=true">'); const d = document.createElement('div'); d.innerHTML = t; return !d.querySelector('img') && fmtDateShort('<b>x</b>').indexOf('<b>') < 0; }));
  // ---- ontwerp november 2026: menu, kanaalknoppen, lettertype ----
  await page.evaluate(() => showView('board', document.querySelector('.nav-item[data-view="board"]'))); await page.waitForTimeout(1200);
  const menu = await page.evaluate(() => { const g = document.querySelector('.sidebar-foot').getBoundingClientRect().top; const items = [...document.querySelectorAll('.sidebar .nav-item')].filter((e) => !e.hidden && e.offsetParent); return { aantal: items.length, buiten: items.filter((e) => e.getBoundingClientRect().bottom > g + 1).map((e) => e.textContent.trim()), groepen: [...document.querySelectorAll('.sidebar .nav-sep')].filter((e) => !e.hidden).map((e) => e.textContent.trim()) }; });
  ok('menu: 16 onderdelen, allemaal in beeld op een scherm van 900 hoog', menu.aantal === 16 && menu.buiten.length === 0, JSON.stringify(menu));
  ok('menu: vier duidelijke groepen', menu.groepen.join('|') === 'Klanten & geld|Team & hulp|Beheer', menu.groepen.join('|'));
  ok('menu: "E-mail" en "WhatsApp" zijn geen losse menu-items meer', await page.evaluate(() => !document.querySelector('.nav-item[data-channel="email"]') && !document.querySelector('.nav-item[data-channel="whatsapp"]')));
  const alle = await page.evaluate(() => document.querySelectorAll('#board .card').length);
  await page.click('#boardKanaal .seg-knop[data-kanaal="whatsapp"]'); await page.waitForTimeout(900);
  const wa = await page.evaluate(() => ({ n: document.querySelectorAll('#board .card').length, aan: document.querySelector('#boardKanaal .seg-knop.on')?.dataset.kanaal, kop: document.querySelector('#view-board h2').textContent }));
  await page.click('#boardKanaal .seg-knop[data-kanaal="all"]'); await page.waitForTimeout(900);
  const terug = await page.evaluate(() => document.querySelectorAll('#board .card').length);
  ok('bord: knop "WhatsApp" filtert het bord en "Alle" zet het terug', wa.aan === 'whatsapp' && /WhatsApp/.test(wa.kop) && wa.n <= alle && terug === alle, JSON.stringify({ alle, wa, terug }));
  ok('geen emoji in de knoppen boven het bord', await page.evaluate(() => !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(document.querySelector('#view-board .view-head').innerText)));
  ok('lettertype Inter wordt echt geladen', await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('14px Inter') && [...document.fonts].some((f) => /Inter/.test(f.family) && f.status === 'loaded'); }));
  ok('beheerder: geen fouten in de console', fouten.length === 0, fouten.slice(0, 3).join(' | '));
  await ctx.close();
}

console.log('\n== Monteur (telefoon) ==');
{
  const { ctx, page, fouten } = await sessie('sam@rechten.test', 'monteur-12345', { width: 390, height: 844 });
  ok('monteur: geen Cijfers en geen Inbox in het menu of de onderbalk', await page.evaluate(() => { const weg = (sel) => [...document.querySelectorAll(sel)].every((el) => el.hidden || getComputedStyle(el).display === 'none'); return weg('.nav-item[data-view="finance"]') && weg('.nav-item[data-view="inbox"]') && weg('.bn-item[data-view="inbox"]'); }));
  await page.evaluate(() => showView('agenda')); await page.waitForTimeout(1200);
  await page.evaluate(() => showView('board')); await page.waitForTimeout(1200);
  ok('monteur: geen fouten of geweigerde verzoeken bij het openen', fouten.length === 0, fouten.slice(0, 3).join(' | '));
  await ctx.close();
}
await browser.close();
console.log(`\n========== BROWSER-RECHTEN: ${pass} geslaagd, ${fail} gefaald ==========`);
if (fail) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }

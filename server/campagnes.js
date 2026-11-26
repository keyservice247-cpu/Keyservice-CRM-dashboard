// E-MAILCAMPAGNES (stap 3, 25 nov 2026 — wens eigenaar: "een systeem dat e-mailcampagnes kan
// uitvoeren, met een AI die een complete campagne kan uitvoeren en voorstellen doet op basis
// van ons klantenbestand en de geschiedenis").
//
// VASTE AFSPRAKEN (niet verzwakken zonder akkoord van de eigenaar):
//  1. DE AI STELT VOOR, EEN MENS BESLIST. Er gaat nooit een campagne de deur uit zonder dat
//     een mens op "Versturen" of "Inplannen" heeft geklikt.
//  2. WIE EEN CAMPAGNE KRIJGT volgt uit VASTE REGELS (doelgroepen hieronder), niet uit de AI.
//     Zelfde klantenbestand + zelfde doelgroep = altijd dezelfde lijst.
//  3. DE AI ZIET GEEN KLANTGEGEVENS. Hij krijgt alleen TELLINGEN per doelgroep ("142 klanten
//     met schuifpui-werk ouder dan 12 maanden") — geen namen, adressen of e-mailadressen.
//  4. VANGRAILS BIJ HET VERSTUREN: nooit naar wie zich heeft afgemeld, nooit naar een
//     tussenpersoon/DRS-adres, nooit naar een adres dat eerder terugkwam (bounce), elk adres
//     één keer, een rustperiode per klant (standaard 30 dagen), alleen overdag (09–20 uur
//     Nederlandse tijd), met tussenpozen en een maximum per dag.
//  5. De testomgeving verstuurt niets (daar is SMTP uitgeschakeld): een campagne loopt er
//     wel helemaal door, maar elke mail wordt alleen als "zou verstuurd zijn" geteld.
//
// De reken-functies bovenaan lezen de database niet (los te testen); de functies eronder wel.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, id, now, saveSoon, saveSoonQuiet, logActivity } from './db.js';
import { merkVan } from './merk.js';
import { omzetVan, factuurPerOpdracht } from './conversie.js';
import { klantvriendelijkMoment, nlDag } from './tijdvenster.js';
import { sendMail, smtpConfigured } from './connectors/email-smtp.js';
import { nooitKlantMail } from './pipeline.js';
import { TEST, demoLoginToegestaan } from './omgeving.js';
import { getHtmlSignature } from './settings.js';
import { leesOpmaak, bouwCampagneHtml, sjabloonVan } from './campagne-sjablonen.js';

export const STANDAARD_INSTELLINGEN = { rustDagen: 30, perDag: 200, perRonde: 8, pauzeMs: 2500 };
const STORING_MAX = 5; // zoveel rondes op rij een storing bij het versturen → campagne pauzeert
const DAG = 86400000;
const AFGEHANDELD = new Set(['afgerond', 'geannuleerd']);
const ZAKELIJK_RE = /\b(b\.?v\.?|n\.?v\.?|v\.?o\.?f\.?|vve|v\.v\.e\.?|vereniging van eigenaren|stichting|beheer|vastgoed|makelaar|makelaardij|woningcorporatie|woonstichting|bouw|aannem|installatie|holding|groep|group|hotel|restaurant|school|gemeente|kantoor)\b/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

const ms = (iso) => { const t = new Date(iso || 0).getTime(); return Number.isFinite(t) ? t : 0; };
const kleineMail = (e) => String(e || '').trim().toLowerCase();

/** Plaatsnaam uit een adres ("Straat 1, 1234 AB Plaats" of "…, Plaats"). Leeg als onbekend. */
export function plaatsUit(adres) {
  const a = String(adres || '').trim();
  const pc = a.match(/\b\d{4}\s?[A-Za-z]{2}\b[\s,]+([^,\d][^,]*)$/);
  if (pc) return pc[1].trim();
  const laatste = a.match(/,\s*([^,\d][^,]*)$/);
  if (laatste) return laatste[1].trim();
  // Alleen een plaatsnaam ingevuld ("Rhenen"): geen cijfers en geen komma.
  return a && !/[\d,]/.test(a) && a.length <= 40 ? a : '';
}

/**
 * Per klant de feiten waar doelgroepen op kiezen. Puur: alles komt binnen als lijst.
 * `nooitMail(adres)` = tussenpersoon/DRS (mag ontbreken).
 */
export function klantFeiten({ customers = [], orders = [], invoices = [], nooitMail = () => false, nu = Date.now() } = {}) {
  const perKlant = new Map();
  for (const o of orders) {
    if (!o || !o.customerId || o.deletedAt) continue;
    if (!perKlant.has(o.customerId)) perKlant.set(o.customerId, { orders: [], invoices: [] });
    perKlant.get(o.customerId).orders.push(o);
  }
  for (const i of invoices) {
    if (!i || !i.customerId) continue;
    if (!perKlant.has(i.customerId)) perKlant.set(i.customerId, { orders: [], invoices: [] });
    perKlant.get(i.customerId).invoices.push(i);
  }
  return customers.filter(Boolean).map((c) => {
    const eigen = perKlant.get(c.id) || { orders: [], invoices: [] };
    const email = kleineMail(c.email);
    const laatste = eigen.orders.reduce((m, o) => Math.max(m, ms(o.completedAt) || ms(o.createdAt)), 0);
    const eerste = eigen.orders.reduce((m, o) => { const t = ms(o.createdAt); return t && (!m || t < m) ? t : m; }, 0);
    const merken = new Set(eigen.orders.map((o) => merkVan(o).key));
    const afgerond = eigen.orders.filter((o) => o.status === 'afgerond').length;
    const lopend = eigen.orders.some((o) => !AFGEHANDELD.has(o.status) && !o.archivedWeek);
    // Offerte gekregen maar niet doorgegaan: een verstuurde/afgekeurde offerte zonder factuur
    // erna, of een opdracht die in "offerte verzonden" is geannuleerd.
    const offertes = eigen.invoices.filter((i) => i.type === 'offerte' && ['verzonden', 'afgekeurd'].includes(i.status) && !i.convertedInvoiceId);
    const laatsteOfferte = offertes.reduce((m, i) => Math.max(m, ms(i.sentAt) || ms(i.createdAt)), 0);
    const factuurNaOfferte = laatsteOfferte && eigen.invoices.some((i) => i.type !== 'offerte' && ms(i.createdAt) > laatsteOfferte);
    const offerteNietDoor = !!laatsteOfferte && !factuurNaOfferte && nu - laatsteOfferte > 14 * DAG;
    return {
      id: c.id, naam: String(c.name || '').trim(), email, plaats: plaatsUit(c.address),
      geldigeMail: EMAIL_RE.test(email),
      afgemeld: !!c.campaignOptOut,
      bounce: !!c.emailBounceAt,
      tussenpersoon: !!email && !!nooitMail(email),
      onbekend: /^onbekende klant$/i.test(String(c.name || '').trim()) || !String(c.name || '').trim(),
      aantalOpdrachten: eigen.orders.length, afgerond, lopend,
      laatsteOpdrachtMs: laatste, eersteOpdrachtMs: eerste,
      schuifpui: merken.has('schuifpui'), sloten: merken.has('keyservice'),
      offerteNietDoor,
      zakelijk: ZAKELIJK_RE.test(String(c.name || '')) || (!!email && ZAKELIJK_RE.test(email.split('@')[1] || '')),
      laatsteCampagneMs: ms(c.lastCampaignAt),
    };
  });
}

/**
 * De doelgroepen. Elke doelgroep is een vaste regel op de feiten van één klant.
 * `params.maanden` / `params.plaats` waar dat bij de doelgroep hoort.
 */
export const DOELGROEPEN = [
  { key: 'alle', naam: 'Alle klanten met een e-mailadres', uitleg: 'Iedereen die ooit klant was en een e-mailadres heeft.', test: () => true },
  { key: 'oud', naam: 'Lang niet gezien', uitleg: 'Klanten van wie de laatste opdracht langer dan het gekozen aantal maanden geleden is. Goed voor onderhoud of een controle.', param: 'maanden', standaard: { maanden: 12 },
    test: (f, p, nu) => f.afgerond > 0 && !!f.laatsteOpdrachtMs && nu - f.laatsteOpdrachtMs > (Number(p.maanden) || 12) * 30.4 * DAG },
  { key: 'schuifpui', naam: 'Schuifpui-klanten', uitleg: 'Klanten met minstens één opdracht voor een schuifpui of schuifdeur.', test: (f) => f.schuifpui },
  { key: 'sloten', naam: 'Slot- en sleutelklanten', uitleg: 'Klanten met minstens één opdracht voor sloten, cilinders of buitensluiting.', test: (f) => f.sloten },
  { key: 'offerte', naam: 'Offerte gekregen, niet doorgegaan', uitleg: 'Klanten met een offerte van meer dan twee weken oud waar geen factuur op volgde.', test: (f) => f.offerteNietDoor },
  { key: 'zakelijk', naam: 'Zakelijke klanten', uitleg: 'VvE\'s, beheerders, bedrijven en instellingen (herkend aan de naam of het e-maildomein).', test: (f) => f.zakelijk },
  { key: 'nieuw', naam: 'Nieuwe klanten', uitleg: 'Klanten van wie de eerste opdracht binnen het gekozen aantal maanden valt.', param: 'maanden', standaard: { maanden: 3 },
    test: (f, p, nu) => !!f.eersteOpdrachtMs && nu - f.eersteOpdrachtMs <= (Number(p.maanden) || 3) * 30.4 * DAG },
  { key: 'plaats', naam: 'Klanten in één plaats', uitleg: 'Alle klanten met een adres in de gekozen plaats.', param: 'plaats', standaard: { plaats: '' },
    test: (f, p) => !!String(p.plaats || '').trim() && f.plaats.toLowerCase() === String(p.plaats).trim().toLowerCase() },
];
const DOELGROEP = new Map(DOELGROEPEN.map((d) => [d.key, d]));
export const isDoelgroep = (key) => DOELGROEP.has(key);
export const doelgroepNaam = (key) => (DOELGROEP.get(key) || {}).naam || key;

/**
 * Wie krijgt de campagne? Puur en vast: zelfde invoer = zelfde lijst. Geeft ook terug
 * HOEVEEL er om welke reden afvallen, zodat het scherm dat eerlijk kan laten zien.
 */
export function kiesOntvangers(feiten, { doelgroep = 'alle', params = {}, rustDagen = STANDAARD_INSTELLINGEN.rustDagen, nu = Date.now(), ookLopend = true } = {}) {
  const dg = DOELGROEP.get(doelgroep) || DOELGROEP.get('alle');
  const p = { ...(dg.standaard || {}), ...(params || {}) };
  const af = { geenEmail: 0, afgemeld: 0, nietAangekomen: 0, tussenpersoon: 0, rust: 0, dubbelAdres: 0, lopend: 0 };
  const gezien = new Set(); const ontvangers = [];
  const inGroep = feiten.filter((f) => dg.test(f, p, nu));
  for (const f of inGroep.slice().sort((a, b) => (a.naam || '').localeCompare(b.naam || '', 'nl') || String(a.id).localeCompare(String(b.id)))) {
    if (!f.geldigeMail) { af.geenEmail++; continue; }
    if (f.afgemeld) { af.afgemeld++; continue; }
    if (f.bounce) { af.nietAangekomen++; continue; }
    if (f.tussenpersoon) { af.tussenpersoon++; continue; }
    if (rustDagen > 0 && f.laatsteCampagneMs && nu - f.laatsteCampagneMs < rustDagen * DAG) { af.rust++; continue; }
    if (!ookLopend && f.lopend) { af.lopend++; continue; }
    if (gezien.has(f.email)) { af.dubbelAdres++; continue; }
    gezien.add(f.email);
    ontvangers.push({ customerId: f.id, email: f.email, naam: f.naam, plaats: f.plaats });
  }
  return { doelgroep: dg.key, params: p, inGroep: inGroep.length, ontvangers, afgevallen: af };
}

/** Tellingen per doelgroep — het ENIGE dat de AI van het klantenbestand te zien krijgt. */
export function doelgroepTelling(feiten, { rustDagen = STANDAARD_INSTELLINGEN.rustDagen, nu = Date.now() } = {}) {
  const totaal = feiten.length;
  const metMail = feiten.filter((f) => f.geldigeMail).length;
  const groepen = DOELGROEPEN.filter((d) => d.key !== 'plaats').map((d) => {
    const r = kiesOntvangers(feiten, { doelgroep: d.key, rustDagen, nu });
    return { key: d.key, naam: d.naam, inGroep: r.inGroep, bereikbaar: r.ontvangers.length };
  });
  const plaatsen = new Map();
  for (const f of feiten) if (f.plaats && f.geldigeMail && !f.afgemeld) plaatsen.set(f.plaats, (plaatsen.get(f.plaats) || 0) + 1);
  const topPlaatsen = [...plaatsen.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'nl')).slice(0, 8).map(([plaats, aantal]) => ({ plaats, aantal }));
  return { totaal, metMail, afgemeld: feiten.filter((f) => f.afgemeld).length, groepen, topPlaatsen };
}

/** {naam} en {plaats} invullen. Een onbekende naam wordt "klant". */
export function vulTekst(tpl, o) {
  const naam = (o && o.naam && !/^onbekende klant$/i.test(o.naam)) ? o.naam : 'klant';
  return String(tpl || '').replace(/\{naam\}/gi, naam).replace(/\{plaats\}/gi, (o && o.plaats) || 'uw woonplaats');
}

/**
 * VOORSTELLEN ZONDER AI (vaste regels op de tellingen + het seizoen). Dit is ook de terugval
 * als de AI niet bereikbaar is, zodat de knop "Voorstellen" altijd iets oplevert.
 */
export function regelVoorstellen(telling, { maand = new Date().getMonth() + 1, eerdere = [] } = {}) {
  const g = Object.fromEntries((telling.groepen || []).map((x) => [x.key, x]));
  const recent = new Set((eerdere || []).filter((c) => c && c.doelgroep).map((c) => c.doelgroep));
  const winter = [10, 11, 12, 1, 2].includes(maand); const voorjaar = [3, 4, 5].includes(maand);
  const uit = [];
  const voeg = (v) => { if (v.bereikbaar >= 3) uit.push(v); };
  if (g.schuifpui) voeg({ doelgroep: 'schuifpui', params: {}, bereikbaar: g.schuifpui.bereikbaar,
    titel: voorjaar ? 'Schuifpui klaar voor de zomer' : winter ? 'Schuifpui: tocht en zwaar lopen voorkomen' : 'Onderhoud voor uw schuifpui',
    waarom: `${g.schuifpui.bereikbaar} schuifpui-klanten zijn per e-mail bereikbaar. ${voorjaar ? 'In het voorjaar gaan de puien weer open: het moment voor een onderhoudsbeurt.' : winter ? 'In de koude maanden merken mensen tocht en een zwaar lopende pui het meest.' : 'Een onderhoudsbeurt voorkomt een dure reparatie.'}`,
    onderwerp: voorjaar ? 'Loopt uw schuifpui weer soepel deze zomer?' : 'Een onderhoudsbeurt voor uw schuifpui',
    tekst: `Beste {naam},\n\nEerder hebben wij uw schuifpui gerepareerd of afgesteld. Een schuifpui die elk jaar even wordt nagekeken en gesmeerd, blijft licht lopen en goed sluiten.\n\nWilt u dat wij langskomen voor een onderhoudsbeurt? Antwoord op deze e-mail of bel ons, dan plannen we een moment dat u past.` });
  if (g.oud) voeg({ doelgroep: 'oud', params: { maanden: 12 }, bereikbaar: g.oud.bereikbaar,
    titel: 'Klanten die we een jaar niet zagen', waarom: `${g.oud.bereikbaar} klanten hadden hun laatste opdracht meer dan een jaar geleden. Een korte herinnering houdt u in beeld voor als er weer iets is.`,
    onderwerp: 'Sluit alles nog goed bij u thuis?',
    tekst: `Beste {naam},\n\nHet is alweer een tijd geleden dat wij bij u zijn geweest. Werkt alles nog naar wens?\n\nMocht een slot stroef gaan, een deur klemmen of wilt u extra sleutels laten bijmaken: wij helpen u graag. Antwoord op deze e-mail of bel ons.` });
  if (g.offerte) voeg({ doelgroep: 'offerte', params: {}, bereikbaar: g.offerte.bereikbaar,
    titel: 'Offertes die zijn blijven liggen', waarom: `${g.offerte.bereikbaar} klanten kregen een offerte waar niets meer op volgde. Een vriendelijke vraag levert vaak alsnog een opdracht op.`,
    onderwerp: 'Kunnen wij nog iets voor u betekenen?',
    tekst: `Beste {naam},\n\nEen tijd geleden hebben wij u een offerte gestuurd. Wij zijn benieuwd of u er nog over nadenkt, of dat er vragen zijn waarmee wij kunnen helpen.\n\nWilt u de offerte opnieuw ontvangen of iets laten aanpassen? Antwoord gerust op deze e-mail.` });
  if (g.sloten && winter) voeg({ doelgroep: 'sloten', params: {}, bereikbaar: g.sloten.bereikbaar,
    titel: 'Donkere dagen: is uw huis goed beveiligd?', waarom: `${g.sloten.bereikbaar} slot- en sleutelklanten zijn bereikbaar. In de donkere maanden zijn er meer inbraken; dan denken mensen na over betere sloten.`,
    onderwerp: 'Donkere dagen: zijn uw sloten nog veilig genoeg?',
    tekst: `Beste {naam},\n\nIn de donkere maanden wordt er vaker ingebroken. Goede sloten met het SKG-keurmerk maken het een inbreker een stuk lastiger.\n\nWij kijken graag vrijblijvend met u mee of uw sloten nog voldoen. Antwoord op deze e-mail of bel ons voor een afspraak.` });
  if (g.zakelijk) voeg({ doelgroep: 'zakelijk', params: {}, bereikbaar: g.zakelijk.bereikbaar,
    titel: 'Zakelijke klanten: vaste afspraken', waarom: `${g.zakelijk.bereikbaar} zakelijke klanten (VvE's, beheerders, bedrijven) zijn bereikbaar. Zij hebben vaker werk en waarderen één vast aanspreekpunt.`,
    onderwerp: 'Eén vast aanspreekpunt voor sloten en schuifpuien',
    tekst: `Beste {naam},\n\nVoor VvE's, beheerders en bedrijven werken wij met vaste afspraken: snel ter plaatse, duidelijke prijzen en één aanspreekpunt.\n\nZullen wij vrijblijvend bespreken wat wij voor uw panden kunnen betekenen? Antwoord op deze e-mail of bel ons.` });
  if (g.nieuw) voeg({ doelgroep: 'nieuw', params: { maanden: 3 }, bereikbaar: g.nieuw.bereikbaar,
    titel: 'Nieuwe klanten bedanken', waarom: `${g.nieuw.bereikbaar} klanten kwamen de laatste drie maanden voor het eerst. Een bedankje met de vraag ons aan te bevelen levert nieuwe klanten op.`,
    onderwerp: 'Bedankt voor uw vertrouwen',
    tekst: `Beste {naam},\n\nBedankt dat u voor ons heeft gekozen. Wij hopen dat alles naar wens werkt.\n\nBent u tevreden? Dan helpt u ons enorm door ons aan te bevelen bij buren, familie of collega's. En is er toch nog iets niet in orde, laat het ons dan weten: wij lossen het op.` });
  // Past geen enkele doelgroep (bijvoorbeeld een klein of nieuw klantenbestand)? Dan één algemeen voorstel.
  if (!uit.length && g.alle && g.alle.bereikbaar >= 3) uit.push({ doelgroep: 'alle', params: {}, bereikbaar: g.alle.bereikbaar,
    titel: 'Even van ons laten horen', waarom: `${g.alle.bereikbaar} klanten zijn per e-mail bereikbaar. Een kort bericht houdt u in beeld voor als er weer iets is met een slot of schuifpui.`,
    onderwerp: 'Kunnen wij iets voor u betekenen?',
    tekst: `Beste {naam},\n\nU bent eerder klant bij ons geweest. Mocht er weer iets zijn met een slot, een sleutel of een schuifpui, dan staan wij graag voor u klaar.\n\nAntwoord op deze e-mail of bel ons, dan kijken we wat we voor u kunnen doen.` });
  // Doelgroepen die net een campagne kregen komen achteraan.
  return uit.sort((a, b) => (recent.has(a.doelgroep) ? 1 : 0) - (recent.has(b.doelgroep) ? 1 : 0) || b.bereikbaar - a.bereikbaar).slice(0, 5).map((v) => ({ ...v, bron: 'regels' }));
}

// ====================================================================================
// Vanaf hier: met de database
// ====================================================================================

export function campagneInstellingen() {
  const s = (db().settings && db().settings.campagnes) || {};
  const getal = (v, std, min, max) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : std; };
  return {
    rustDagen: getal(s.rustDagen, STANDAARD_INSTELLINGEN.rustDagen, 0, 365),
    perDag: getal(s.perDag, STANDAARD_INSTELLINGEN.perDag, 10, 1000),
    // Nummer voor de knop "Stuur een WhatsApp" in een sjabloon (leeg = die knop is er niet).
    whatsapp: String(s.whatsapp || '').replace(/[^\d+ ]/g, '').trim().slice(0, 20),
  };
}
export function zetCampagneInstellingen(invoer) {
  const s = db().settings; s.campagnes = { ...(s.campagnes || {}), ...(invoer || {}) };
  s.campagnes = campagneInstellingen(); saveSoon();
  return s.campagnes;
}

export function alleFeiten(nu = Date.now()) {
  return klantFeiten({ customers: db().customers || [], orders: db().orders || [], invoices: db().invoices || [], nooitMail: nooitKlantMail, nu });
}
const lijst = () => { const d = db(); if (!Array.isArray(d.campagnes)) d.campagnes = []; return d.campagnes; };
export const vindCampagne = (cid) => lijst().find((c) => c.id === cid) || null;

const LINK_SECRET = () => process.env.LINK_SECRET || process.env.SESSION_SECRET || 'ks-upload';
export const afmeldSig = (customerId) => crypto.createHmac('sha256', LINK_SECRET()).update('afmelden:' + customerId).digest('hex').slice(0, 24);
export function afmeldLink(customerId) {
  const basis = String(process.env.APP_URL || 'https://keyservice-crm.onrender.com').replace(/\/+$/, '');
  return `${basis}/afmelden/${encodeURIComponent(customerId)}/${afmeldSig(customerId)}`;
}
export const voetTekst = (customerId) => `\n\nU ontvangt deze e-mail omdat u klant bent (geweest) van Key Service 24/7. Liever geen e-mails meer? Meld u af via ${afmeldLink(customerId)} of antwoord met "afmelden".`;

/** Wat het scherm van een campagne te zien krijgt (zonder de hele ontvangerslijst). */
export function campagneUitvoer(c, { metOntvangers = false } = {}) {
  const o = c.ontvangers || [];
  const tel = (s) => o.filter((x) => x.status === s).length;
  const uit = {
    id: c.id, naam: c.naam, onderwerp: c.onderwerp, tekst: c.tekst, doelgroep: c.doelgroep, doelgroepNaam: doelgroepNaam(c.doelgroep), params: c.params || {},
    status: c.status, bron: c.bron || 'mens', waarom: c.waarom || '', createdAt: c.createdAt, door: c.door, geplandOp: c.geplandOp || null,
    gestartOp: c.gestartOp || null, klaarOp: c.klaarOp || null, gestartDoor: c.gestartDoor || '',
    aantal: o.length, verstuurd: tel('verstuurd'), wacht: tel('wacht'), mislukt: tel('mislukt'), overgeslagen: tel('overgeslagen'),
    proef: !!c.proef, melding: c.melding || '',
    opmaak: leesOpmaak(c.opmaak), foto: !!(c.foto && c.foto.file),
  };
  if (metOntvangers) uit.ontvangers = o.map((x) => ({ naam: x.naam, email: x.email, plaats: x.plaats || '', status: x.status, at: x.at || null, fout: x.fout || '' }));
  return uit;
}

const schoon = (v, max) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, max);
function leesInvoer(body = {}) {
  const uit = {};
  if ('naam' in body) uit.naam = schoon(body.naam, 120);
  if ('onderwerp' in body) uit.onderwerp = schoon(body.onderwerp, 200);
  if ('tekst' in body) uit.tekst = schoon(body.tekst, 8000);
  if ('doelgroep' in body) uit.doelgroep = isDoelgroep(body.doelgroep) ? body.doelgroep : 'alle';
  if ('params' in body && body.params && typeof body.params === 'object') {
    uit.params = {};
    if ('maanden' in body.params) uit.params.maanden = Math.min(120, Math.max(1, Math.round(Number(body.params.maanden) || 12)));
    if ('plaats' in body.params) uit.params.plaats = schoon(body.params.plaats, 80);
  }
  if ('waarom' in body) uit.waarom = schoon(body.waarom, 600);
  if ('bron' in body) uit.bron = body.bron === 'ai' ? 'ai' : body.bron === 'regels' ? 'regels' : 'mens';
  if ('opmaak' in body) uit.opmaak = leesOpmaak(body.opmaak);
  return uit;
}

export function maakCampagne(body, gebruiker) {
  const inv = leesInvoer(body);
  const c = { id: id('cmp'), naam: inv.naam || inv.onderwerp || 'Nieuwe campagne', onderwerp: inv.onderwerp || '', tekst: inv.tekst || '', doelgroep: inv.doelgroep || 'alle', params: inv.params || {},
    waarom: inv.waarom || '', bron: inv.bron || 'mens', opmaak: inv.opmaak || { sjabloon: 'tekst' }, status: 'concept', createdAt: now(), door: (gebruiker && gebruiker.name) || '', ontvangers: [] };
  lijst().unshift(c); saveSoon();
  return c;
}
export function werkCampagneBij(c, body) {
  if (c.status !== 'concept') { const e = new Error('Alleen een concept kun je nog wijzigen. Zet een geplande campagne eerst terug naar concept.'); e.status = 409; throw e; }
  Object.assign(c, leesInvoer(body)); c.updatedAt = now(); saveSoon();
  return c;
}
// ---------- OPMAAK: sjabloon + eigen foto (26 nov 2026, zie campagne-sjablonen.js) ----------
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const FOTO_DIR = path.join(DATA_DIR, 'campagne-fotos');
const FOTO_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const FOTO_MAX_BYTES = 1500 * 1024;
export const fotoPad = (c) => (c && c.foto && c.foto.file ? path.join(FOTO_DIR, path.basename(c.foto.file)) : '');
/** Eigen foto bovenaan de mail. Alleen bij een concept; het scherm verkleint hem vooraf. */
export function zetFoto(c, buffer, mime) {
  if (c.status !== 'concept') { const e = new Error('Alleen bij een concept kun je de foto nog wijzigen.'); e.status = 409; throw e; }
  const ext = FOTO_MIME[String(mime || '').toLowerCase()];
  if (!ext) { const e = new Error('Kies een foto als JPG, PNG of WebP.'); e.status = 400; throw e; }
  if (!buffer || !buffer.length) { const e = new Error('De foto is leeg.'); e.status = 400; throw e; }
  if (buffer.length > FOTO_MAX_BYTES) { const e = new Error('De foto is te groot (maximaal 1,5 MB). Kies een kleinere foto.'); e.status = 413; throw e; }
  fs.mkdirSync(FOTO_DIR, { recursive: true });
  haalFotoWeg(c, true);
  const file = `${c.id}-${Date.now().toString(36)}.${ext}`;
  fs.writeFileSync(path.join(FOTO_DIR, file), buffer);
  c.foto = { file, mime: String(mime).toLowerCase(), bytes: buffer.length, at: now() }; c.updatedAt = now(); saveSoon();
  return c;
}
export function haalFotoWeg(c, stil = false) {
  if (!stil && c.status !== 'concept') { const e = new Error('Alleen bij een concept kun je de foto nog weghalen.'); e.status = 409; throw e; }
  const pad = fotoPad(c);
  if (pad) { try { fs.unlinkSync(pad); } catch { /* al weg */ } }
  if (c.foto) { delete c.foto; if (!stil) { c.updatedAt = now(); saveSoon(); } }
  return c;
}
/** De gegevens van het bedrijf onder de mail en achter de knop. */
export function bedrijfVoorMail() {
  let sig = {}; try { sig = getHtmlSignature(); } catch { /* standaard */ }
  const naam = String(sig.role || '').split('|').pop().trim() || 'Key Service 24/7';
  return { naam, telefoon: sig.phone || '', email: sig.email || '', website: sig.website || '', whatsapp: campagneInstellingen().whatsapp };
}
/**
 * De mail voor één ontvanger: platte tekst (altijd, met de afmeldregel) en — bij een sjabloon —
 * de opgemaakte versie met de afmeldlink onderaan. `voorbeeld` = voor in het scherm (foto en logo
 * als gewone adressen in plaats van bijlagen).
 */
export function mailVoor(c, o, { voorbeeld = false } = {}) {
  const gevuld = vulTekst(c.tekst, o);
  const text = gevuld + (o.customerId ? voetTekst(o.customerId) : '');
  const opmaak = leesOpmaak(c.opmaak);
  if (opmaak.sjabloon === 'tekst') return { text };
  const pad = fotoPad(c); const heeftFoto = !!pad && fs.existsSync(pad);
  const html = bouwCampagneHtml({
    opmaak, onderwerp: c.onderwerp, tekst: gevuld, bedrijf: bedrijfVoorMail(),
    afmeldUrl: o.customerId ? afmeldLink(o.customerId) : (voorbeeld ? '#' : ''),
    logoSrc: voorbeeld ? '/img/logo-factuur.png' : 'cid:kslogo',
    fotoSrc: heeftFoto ? (voorbeeld ? `/api/campagnes/${c.id}/foto?v=${encodeURIComponent((c.foto && c.foto.at) || '')}` : 'cid:kopfoto') : '',
  });
  const attachments = heeftFoto && !voorbeeld ? [{ filename: `foto.${path.extname(pad).slice(1) || 'jpg'}`, path: pad, cid: 'kopfoto', contentDisposition: 'inline' }] : [];
  return { text, html, attachments };
}
export { sjabloonVan };

/** Voorbeeld: wie krijgt hem NU, en wie valt waarom af. Verandert niets. */
export function voorbeeldOntvangers(c, nu = Date.now()) {
  return kiesOntvangers(alleFeiten(nu), { doelgroep: c.doelgroep, params: c.params, rustDagen: campagneInstellingen().rustDagen, nu });
}
/**
 * Versturen of inplannen — de ENIGE plek waar een campagne "aan" gaat, en dat gebeurt alleen
 * na een klik van een mens (de route). De ontvangerslijst wordt op dit moment vastgelegd.
 */
export function startCampagne(c, { op = null, gebruiker = null, nu = Date.now(), verwacht = null } = {}) {
  if (c.status !== 'concept') { const e = new Error('Deze campagne is al gestart of ingepland.'); e.status = 409; throw e; }
  if (!c.onderwerp || !c.tekst) { const e = new Error('Vul eerst een onderwerp en een bericht in.'); e.status = 400; throw e; }
  const v = voorbeeldOntvangers(c, nu);
  if (!v.ontvangers.length) { const e = new Error('Er is niemand in deze doelgroep om naar te sturen (kijk bij "Wie krijgt hem?" waarom).'); e.status = 400; throw e; }
  // De mens bevestigde een AANTAL ("versturen naar 42 klanten?"). Klopt dat niet meer met de lijst
  // van dit moment (andere doelgroep gekozen, klant erbij/afgemeld), dan gaat er niets uit en
  // vraagt het scherm opnieuw — er vertrekt nooit een mailing naar meer mensen dan bevestigd.
  if (verwacht != null && Number(verwacht) !== v.ontvangers.length) { const e = new Error(`Het aantal ontvangers is veranderd: nu ${v.ontvangers.length} (je bevestigde ${Number(verwacht)}). Er is niets verstuurd — kijk opnieuw en bevestig nog een keer.`); e.status = 409; e.aantal = v.ontvangers.length; throw e; }
  c.ontvangers = v.ontvangers.map((o) => ({ ...o, status: 'wacht' }));
  c.afgevallen = v.afgevallen;
  const opMs = op ? ms(op) : 0;
  if (opMs && opMs > nu + 60000) { c.status = 'gepland'; c.geplandOp = new Date(opMs).toISOString(); } else { c.status = 'bezig'; c.geplandOp = null; }
  c.gestartOp = c.status === 'bezig' ? now() : null;
  c.gestartDoor = (gebruiker && gebruiker.name) || '';
  logActivity(c.gestartDoor || 'systeem', c.status === 'gepland' ? 'campagne ingepland' : 'campagne gestart', `"${c.naam}" — ${c.ontvangers.length} ontvangers (${doelgroepNaam(c.doelgroep)})`);
  saveSoon();
  return c;
}
export function pauzeerCampagne(c) { if (['bezig', 'gepland'].includes(c.status)) { c.vorigeStatus = c.status; c.status = 'gepauzeerd'; saveSoon(); } return c; }
export function hervatCampagne(c) { if (c.status === 'gepauzeerd') { c.status = c.vorigeStatus === 'gepland' ? 'gepland' : 'bezig'; c.storingen = 0; c.melding = ''; saveSoon(); } return c; }
/** Stoppen: wat nog wacht gaat niet meer uit. Wat al verstuurd is blijft in het overzicht. */
export function stopCampagne(c, gebruiker) {
  if (!['bezig', 'gepland', 'gepauzeerd'].includes(c.status)) return c;
  for (const o of c.ontvangers || []) if (o.status === 'wacht') { o.status = 'overgeslagen'; o.fout = 'campagne gestopt'; }
  c.status = 'gestopt'; c.klaarOp = now();
  logActivity((gebruiker && gebruiker.name) || 'systeem', 'campagne gestopt', `"${c.naam}"`);
  saveSoon(); return c;
}
/** Terug naar concept (alleen zolang er nog niets verstuurd is). */
export function naarConcept(c) {
  if ((c.ontvangers || []).some((o) => o.status === 'verstuurd')) { const e = new Error('Er is al verstuurd: deze campagne kan niet meer terug naar concept.'); e.status = 409; throw e; }
  c.status = 'concept'; c.ontvangers = []; c.geplandOp = null; c.gestartOp = null; saveSoon(); return c;
}
export function verwijderCampagne(c) {
  if (c.status !== 'concept') { const e = new Error('Alleen een concept kan worden verwijderd.'); e.status = 409; throw e; }
  haalFotoWeg(c, true);
  db().campagnes = lijst().filter((x) => x.id !== c.id); saveSoon();
}

/** Hoeveel campagnemails zijn er vandaag (Nederlandse dag) al verstuurd? */
export function vandaagVerstuurd(nu = new Date()) {
  const dag = nlDag(nu); let n = 0;
  for (const c of lijst()) for (const o of c.ontvangers || []) if (o.status === 'verstuurd' && o.at && nlDag(new Date(o.at)) === dag) n++;
  return n;
}

let _bezig = false;
/**
 * DE VERZENDRONDE (elke minuut). Stuurt een paar mails van de campagne die aan de beurt is,
 * met een pauze ertussen. Alleen overdag en binnen het dagmaximum. Overleeft een herstart:
 * elke ontvanger heeft zijn eigen status. `altijd` slaat het tijdvenster over (tests).
 */
export async function runCampagnes({ altijd = false, nu = new Date(), verstuur = sendMail, pauzeMs = STANDAARD_INSTELLINGEN.pauzeMs, perRonde = STANDAARD_INSTELLINGEN.perRonde } = {}) {
  if (_bezig) return { bezig: true };
  // Alleen in een testopstelling (nooit op de echte site): geen tijdvenster en geen pauzes,
  // zodat de test niet tot 09:00 uur hoeft te wachten.
  if (process.env.CAMPAGNE_TEST === '1' && demoLoginToegestaan()) { altijd = true; pauzeMs = 0; }
  _bezig = true;
  const uit = { verstuurd: 0, mislukt: 0, overgeslagen: 0, reden: '' };
  try {
    // Ingeplande campagnes waarvan het moment is aangebroken gaan lopen.
    for (const c of lijst()) if (c.status === 'gepland' && ms(c.geplandOp) <= nu.getTime()) { c.status = 'bezig'; c.gestartOp = now(); saveSoon(); }
    const c = lijst().filter((x) => x.status === 'bezig').sort((a, b) => ms(a.gestartOp) - ms(b.gestartOp))[0];
    if (!c) { uit.reden = 'niets te doen'; return uit; }
    if (!altijd && !klantvriendelijkMoment(nu)) { uit.reden = 'buiten 09–20 uur'; c.melding = 'Gaat verder om 09:00 uur (er wordt alleen overdag verstuurd).'; saveSoonQuiet(); return uit; }
    const inst = campagneInstellingen();
    let ruimte = inst.perDag - vandaagVerstuurd(nu);
    if (ruimte <= 0) { uit.reden = 'dagmaximum bereikt'; c.melding = `Het maximum van ${inst.perDag} mails per dag is bereikt; morgen gaat de rest.`; saveSoonQuiet(); return uit; }
    const echt = smtpConfigured() && !TEST;
    c.proef = !echt; c.melding = '';
    const wacht = (c.ontvangers || []).filter((o) => o.status === 'wacht').slice(0, Math.min(perRonde, ruimte));
    for (const o of wacht) {
      const klant = (db().customers || []).find((k) => k.id === o.customerId);
      // Vangrails OP HET MOMENT VAN VERSTUREN (de klant kan zich intussen hebben afgemeld).
      // Ook de rustperiode: tussen inplannen en versturen kan de klant een ANDERE campagne hebben gekregen.
      const netGehad = !!klant && inst.rustDagen > 0 && klant.lastCampaignId !== c.id && ms(klant.lastCampaignAt) > 0 && nu.getTime() - ms(klant.lastCampaignAt) < inst.rustDagen * DAG;
      const reden = !klant ? 'klant bestaat niet meer' : klant.campaignOptOut ? 'afgemeld' : klant.emailBounceAt ? 'adres kwam eerder terug' : kleineMail(klant.email) !== o.email ? 'e-mailadres is gewijzigd' : nooitKlantMail(o.email) ? 'adres van een tussenpersoon' : netGehad ? 'kreeg intussen een andere campagne' : '';
      if (reden) { o.status = 'overgeslagen'; o.fout = reden; o.at = now(); uit.overgeslagen++; continue; }
      try {
        if (echt) await verstuur({ to: o.email, subject: c.onderwerp, ...mailVoor(c, o) });
        o.status = 'verstuurd'; o.at = now(); o.proef = !echt || undefined;
        klant.lastCampaignAt = o.at; klant.lastCampaignSubject = c.onderwerp; klant.lastCampaignId = c.id;
        uit.verstuurd++; c.storingen = 0;
      } catch (e) {
        const tekst = String((e && e.message) || 'onbekende fout').slice(0, 160);
        // Alleen een geweigerd ADRES is "mislukt" voor die klant.
        if (e && e.rejectedRecipient) { o.status = 'mislukt'; o.at = now(); o.fout = tekst; uit.mislukt++; }
        else {
          // STORING BIJ HET VERSTUREN ZELF (mailserver onbereikbaar, wachtwoord, limiet): deze klant
          // blijft gewoon wachten en de ronde stopt. Na 5 rondes op rij pauzeert de campagne met
          // uitleg — zo wordt nooit een hele lijst als "mislukt" weggeschreven door een storing.
          c.storingen = (c.storingen || 0) + 1; uit.reden = 'mail versturen lukt niet';
          if (c.storingen >= STORING_MAX) {
            c.vorigeStatus = 'bezig'; c.status = 'gepauzeerd';
            c.melding = `Versturen lukt niet (${tekst}). De campagne is gepauzeerd; wie nog wacht krijgt de mail zodra je op Hervatten klikt.`;
            logActivity('systeem', 'campagne gepauzeerd', `"${c.naam}" — mail versturen lukt niet: ${tekst}`);
          } else c.melding = `Versturen lukt nu niet (${tekst}). Over een minuut wordt het opnieuw geprobeerd; er is niemand overgeslagen.`;
          saveSoon(); return uit;
        }
      }
      saveSoonQuiet();
      if (echt && pauzeMs > 0) await new Promise((r) => setTimeout(r, pauzeMs));
    }
    if (!(c.ontvangers || []).some((o) => o.status === 'wacht')) {
      c.status = 'verstuurd'; c.klaarOp = now();
      const t = campagneUitvoer(c);
      logActivity(c.gestartDoor || 'systeem', 'campagne klaar', `"${c.naam}" — ${t.verstuurd} verstuurd, ${t.mislukt} mislukt, ${t.overgeslagen} overgeslagen${c.proef ? ' (proef: er is niets echt verstuurd)' : ''}`);
    }
    saveSoon();
    return uit;
  } finally { _bezig = false; }
}

/**
 * WAT LEVERDE HET OP? Van de mensen die de campagne kregen: wie reageerde (bericht binnen
 * 14 dagen), wie een nieuwe opdracht kreeg (binnen 30 dagen) en wie zich afmeldde. Bedragen
 * alleen als `metGeld` (recht Cijfers) — de assistente ziet aantallen, nooit omzet.
 */
export function campagneResultaat(c, { metGeld = false, nu = Date.now() } = {}) {
  const verstuurd = (c.ontvangers || []).filter((o) => o.status === 'verstuurd');
  const perKlant = new Map(verstuurd.map((o) => [o.customerId, ms(o.at)]));
  const perMail = new Map(verstuurd.map((o) => [o.email, ms(o.at)]));
  const reageerders = new Set();
  for (const m of db().messages || []) {
    if (!m || m.channel !== 'email' || m.bounce || m.outgoing) continue;
    const van = kleineMail(m.fromEmail || (String(m.sender || '').match(/<([^>]+)>/) || [])[1] || m.sender);
    const t0 = perMail.get(van); const t = ms(m.receivedAt);
    if (t0 && t > t0 && t - t0 <= 14 * DAG) reageerders.add(van);
  }
  // Omzet = dezelfde rekenregel als Cijfers/Conversie (`omzetVan`: factuur excl. btw, anders het
  // prijsveld; een afgeschreven factuur telt niet).
  let opdrachten = 0; let omzet = 0;
  const facturen = metGeld ? factuurPerOpdracht() : null;
  for (const o of db().orders || []) {
    if (!o || o.deletedAt) continue;
    const t0 = perKlant.get(o.customerId); const t = ms(o.createdAt);
    if (t0 && t > t0 && t - t0 <= 30 * DAG) { opdrachten++; if (metGeld && o.status !== 'geannuleerd') omzet += Number(omzetVan(o, facturen)) || 0; }
  }
  const klantOp = new Map((db().customers || []).map((k) => [k.id, k]));
  const afgemeld = verstuurd.filter((o) => { const k = klantOp.get(o.customerId); return k && k.campaignOptOut && ms(k.campaignOptOutAt) >= ms(o.at); }).length;
  const uit = { verstuurd: verstuurd.length, reacties: reageerders.size, opdrachten, afgemeld, dagenGeleden: c.klaarOp ? Math.floor((nu - ms(c.klaarOp)) / DAG) : null };
  if (metGeld) uit.omzet = Math.round(omzet * 100) / 100;
  return uit;
}

/** Afmelden via de link in de mail (geen login). Geeft de klant terug, of null bij een foute link. */
/** Klopt de afmeldlink? Geeft de klant terug (verandert niets), anders null. */
export function afmeldKlant(customerId, sig) {
  const goed = afmeldSig(customerId);
  const a = Buffer.from(String(sig || '')); const b = Buffer.from(goed);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return (db().customers || []).find((x) => x.id === customerId) || null;
}
export function meldAf(customerId, sig) {
  const k = afmeldKlant(customerId, sig);
  if (!k) return null;
  if (!k.campaignOptOut) { k.campaignOptOut = true; k.campaignOptOutAt = now(); k.campaignOptOutVia = 'link'; logActivity('klant', 'afgemeld voor campagnemails', k.name || ''); saveSoon(); }
  return k;
}

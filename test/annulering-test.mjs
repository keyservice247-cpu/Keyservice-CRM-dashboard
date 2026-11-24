// ANNULERINGSREDENEN (24 nov 2026). Zonder server: vaste regels (server/annulering.js).
// Bewaakt: zelfde tekst = zelfde reden, een gekozen reden wint van het voorstel, en het
// overzicht telt alleen geannuleerde opdrachten in de periode.   node test/annulering-test.mjs
import { leidRedenAf, redenVan, annuleringsOverzicht, STANDAARD_REDENEN, redenLabel, annuleringsTekst } from '../server/annulering.js';

let pass = 0, fail = 0;
const ok = (naam, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${naam}`); } else { fail++; console.log(`  ✗ FAIL: ${naam} ${extra}`); } };

console.log('\n== Reden afleiden uit de notitie ==');
const gevallen = [
  ['Klant vindt het te duur, ziet ervan af', 'prijs'],
  ['Offerte te hoog, klant neemt een ander', 'prijs'],
  ['Heeft al een andere slotenmaker laten komen', 'ander'],
  ['Klant heeft het zelf opgelost', 'zelf'],
  ['Niet meer nodig, sleutel teruggevonden', 'zelf'],
  ['Verhuurder regelt het', 'zelf'],
  ['Drie keer gebeld, geen gehoor', 'geen_reactie'],
  ['Klant reageert niet meer op de offerte', 'geen_reactie'],
  ['Klant was niet thuis op de afspraak', 'afspraak'],
  ['Afspraak afgezegd door klant', 'afspraak'],
  ['Te ver weg voor ons, buiten werkgebied', 'afstand'],
  ['Dit type slot doen wij niet', 'niet_ons_werk'],
  ['Onderdeel is niet meer leverbaar', 'niet_ons_werk'],
  ['Dubbele aanvraag, stond er al in', 'dubbel'],
  ['Dubbel: klant vond het ook te duur', 'dubbel'],
  ['Geannuleerd', ''],
  ['', ''],
];
const mis = gevallen.filter(([t, verwacht]) => leidRedenAf(t) !== verwacht).map(([t, v]) => `"${t}" → ${leidRedenAf(t) || '(niets)'} i.p.v. ${v || '(niets)'}`);
ok(`${gevallen.length} voorbeeldnotities krijgen de verwachte reden`, mis.length === 0, mis.join(' | '));
ok('zelfde tekst = altijd dezelfde reden (geen toeval)', [1, 2, 3].every(() => leidRedenAf('Klant vindt het te duur') === 'prijs'));
ok('"duurzaam" of "duurt lang" is geen prijskwestie', leidRedenAf('Reparatie duurt lang, klant wacht') === '' && leidRedenAf('Duurzaam slot gevraagd') === '');
ok('elke standaardreden heeft een leesbare naam; "Anders" staat erbij', STANDAARD_REDENEN.length === 9 && STANDAARD_REDENEN.every((r) => r.key && r.label) && redenLabel('anders') === 'Anders' && redenLabel('onbekend') === 'Niet vastgelegd');

console.log('\n== Wat een mens kiest wint ==');
ok('gekozen reden wint van wat de notitie suggereert', JSON.stringify(redenVan({ notes: 'te duur', annulering: { reden: 'afstand' } })) === JSON.stringify({ key: 'afstand', bron: 'gekozen' }));
ok('geen keuze → afgeleid uit de notitie', redenVan({ notes: 'klant had geen gehoor, voicemail' }).bron === 'afgeleid' && redenVan({ notes: 'geen gehoor' }).key === 'geen_reactie');
ok('ook uit het laatste klantbericht (niet uit systeemregels)', redenVan({ notes: '', thread: [{ channel: 'whatsapp', body: 'Sorry, we hebben al iemand anders gevonden' }] }).key === 'ander' && redenVan({ thread: [{ channel: 'systeem', body: 'te duur' }] }).key === 'onbekend');
ok('onbekende sleutel van buitenaf wordt niet overgenomen', redenVan({ notes: '', annulering: { reden: 'iets-raars' } }).key === 'onbekend');
ok('tekst wordt begrensd (lange gesprekken)', annuleringsTekst({ notes: 'x'.repeat(5000) }).length === 1500);

console.log('\n== Overzicht: waarom haken klanten af? ==');
const dag = 86400000; const NU = Date.parse('2026-11-24T12:00:00Z');
const o = (status, notes, dagenTerug, extra = {}) => ({ status, notes, cancelledAt: new Date(NU - dagenTerug * dag).toISOString(), ...extra });
const lijst = [
  o('geannuleerd', 'te duur', 2), o('geannuleerd', 'veel te duur', 5), o('geannuleerd', 'prijs viel tegen', 9),
  o('geannuleerd', 'andere partij', 3), o('geannuleerd', 'geen gehoor', 4),
  o('geannuleerd', 'Geannuleerd', 6),                                  // niets herkend
  o('geannuleerd', 'te duur', 1, { annulering: { reden: 'zelf' } }),    // mens koos iets anders
  o('geannuleerd', 'te duur', 40),                                     // buiten de periode
  o('geannuleerd', 'te duur', 2, { deletedAt: 'x' }),                  // prullenbak
  o('afgerond', 'te duur maar toch gedaan', 2),                        // niet geannuleerd
];
const ov = annuleringsOverzicht(lijst, NU - 30 * dag, NU);
ok('telt alleen geannuleerde opdrachten in de periode (geen prullenbak, geen afgeronde)', ov.totaal === 7, String(ov.totaal));
ok('meest genoemde reden bovenaan, met percentage', ov.redenen[0].key === 'prijs' && ov.redenen[0].aantal === 3 && ov.redenen[0].pct === 43, JSON.stringify(ov.redenen[0]));
ok('"Niet vastgelegd" staat altijd onderaan en niet in de top 5', ov.redenen[ov.redenen.length - 1].key === 'onbekend' && ov.onbekend === 1 && !ov.top5.some((r) => r.key === 'onbekend'));
ok('gekozen en afgeleid worden apart geteld', ov.gekozen === 1 && ov.afgeleid === 5, JSON.stringify([ov.gekozen, ov.afgeleid]));
ok('lege lijst geeft een leeg overzicht (geen fout)', annuleringsOverzicht([], 0, NU).totaal === 0 && annuleringsOverzicht(null).top5.length === 0);

console.log(`\n========== ANNULERING: ${pass} geslaagd, ${fail} gefaald ==========`);
process.exit(fail ? 1 : 0);

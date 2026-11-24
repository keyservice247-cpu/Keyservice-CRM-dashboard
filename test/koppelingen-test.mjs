// ALLE KOPPELINGEN IN ÉÉN OOGOPSLAG (24 nov 2026). Zonder server: vaste regels
// (server/koppelingen.js). Bewaakt vooral de twee stille storingen: "verbonden maar er
// komt niets binnen" en "er komt nergens meer iets binnen".   node test/koppelingen-test.mjs
import { beoordeelKoppelingen, koppelAlarmen } from '../server/koppelingen.js';

let pass = 0, fail = 0;
const ok = (naam, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${naam}`); } else { fail++; console.log(`  ✗ FAIL: ${naam} ${extra}`); } };
const NU = Date.parse('2026-11-24T12:00:00Z');
const terug = (min) => new Date(NU - min * 60000).toISOString();
const goedHealth = { database: { ok: true }, imap: { ok: true }, smtp: { ok: true }, ai: { ok: true } };
const basis = (extra = {}) => ({
  nu: NU, test: false, health: goedHealth,
  mailIngesteld: true, smtpIngesteld: true, aiIngesteld: true, imapLaatstOk: terug(2),
  laatsteMailIn: terug(40), laatsteGroepIn: terug(90), laatste1op1In: terug(15), laatsteWebsiteIn: terug(300),
  bridge: { ooit: true, laatstGezien: terug(1), gepauzeerd: false, herstartRecent: false }, opdrachtGroepen: true,
  officieel: { ingesteld: true, aan: true }, agenda: { ingesteld: true, verbonden: true, fouten: 0 },
  mailFouten24u: 0, outboxMislukt24u: 0, laatsteBackup: terug(120), schijfVrijMB: 800, ...extra,
});
const rij = (o, k) => o.regels.find((r) => r.sleutel === k);

console.log('\n== Alles werkt ==');
const goed = beoordeelKoppelingen(basis());
ok('acht koppelingen, allemaal goed, totaal goed', goed.regels.length === 8 && goed.regels.every((r) => r.stand === 'goed') && goed.stand === 'goed', JSON.stringify(goed.regels.map((r) => r.stand)));
ok('elke regel zegt in gewone taal wanneer er iets binnenkwam', /laatste e-mail binnen: 40 min geleden/.test(rij(goed, 'mailIn').uitleg) && /laatste bericht uit een groep: 2 uur geleden/.test(rij(goed, 'waGroep').uitleg), rij(goed, 'waGroep').uitleg);
ok('instroom: laatste bericht van alle kanalen samen', goed.instroom.stand === 'goed' && goed.instroom.urenStil === 0 && /15 min geleden/.test(goed.instroom.uitleg), JSON.stringify(goed.instroom));
ok('geen alarm als alles werkt', koppelAlarmen(goed).length === 0);

console.log('\n== WhatsApp-groepen: de stille storing ==');
const stil = beoordeelKoppelingen(basis({ laatsteGroepIn: terug(30 * 60) }));
ok('verbonden, maar 24+ uur geen groepsbericht = aandacht, met wat je moet doen', rij(stil, 'waGroep').stand === 'let' && /Verbonden, maar al 30 uur geen enkel bericht uit een groep/.test(rij(stil, 'waGroep').uitleg) && /testbericht/.test(rij(stil, 'waGroep').watNu), JSON.stringify(rij(stil, 'waGroep')));
ok('…en dat geeft op een werkdag een alarm, in het weekend niet', koppelAlarmen(stil, { werkdag: true }).some((a) => a.sleutel === 'groepStil') && !koppelAlarmen(stil, { werkdag: false }).some((a) => a.sleutel === 'groepStil'));
ok('zonder opdracht-groepen is stilte in de groepen geen probleem', rij(beoordeelKoppelingen(basis({ laatsteGroepIn: terug(30 * 60), opdrachtGroepen: false })), 'waGroep').stand === 'goed');
const weg = beoordeelKoppelingen(basis({ bridge: { ooit: true, laatstGezien: terug(40) } }));
ok('hartslag 12+ min weg = fout, met de noodroute "Plak opdracht"', rij(weg, 'waGroep').stand === 'fout' && /komen NIET binnen/.test(rij(weg, 'waGroep').uitleg) && /Plak opdracht/.test(rij(weg, 'waGroep').watNu) && weg.stand === 'fout');
ok('net herstart voor een update: 25 minuten de tijd', rij(beoordeelKoppelingen(basis({ bridge: { ooit: true, laatstGezien: terug(20), herstartRecent: true } })), 'waGroep').stand === 'goed');
ok('noodrem aan = aandacht (ontvangen loopt door)', rij(beoordeelKoppelingen(basis({ bridge: { ooit: true, laatstGezien: terug(1), gepauzeerd: true } })), 'waGroep').stand === 'let');
ok('nooit gekoppeld = uit, geen storing', rij(beoordeelKoppelingen(basis({ bridge: { ooit: false } })), 'waGroep').stand === 'uit');
ok('wat aandacht vraagt staat bovenaan', weg.regels[0].sleutel === 'waGroep' && stil.regels[0].sleutel === 'waGroep');

console.log('\n== Er komt nergens meer iets binnen ==');
const dood = beoordeelKoppelingen(basis({ laatsteMailIn: terug(40 * 60), laatsteGroepIn: terug(50 * 60), laatste1op1In: terug(38 * 60), laatsteWebsiteIn: terug(60 * 60) }));
ok('36+ uur niets = fout en een alarm', dood.instroom.stand === 'fout' && dood.instroom.urenStil === 38 && /NIETS binnengekomen/.test(dood.instroom.uitleg) && dood.stand === 'fout' && koppelAlarmen(dood).some((a) => a.sleutel === 'instroom'), JSON.stringify(dood.instroom));
const rustig = beoordeelKoppelingen(basis({ laatsteMailIn: terug(20 * 60), laatsteGroepIn: terug(21 * 60), laatste1op1In: terug(19 * 60), laatsteWebsiteIn: terug(30 * 60) }));
ok('18+ uur niets = aandacht, nog geen alarm', rustig.instroom.stand === 'let' && !koppelAlarmen(rustig).some((a) => a.sleutel === 'instroom'));
ok('testomgeving: stilte is nooit een storing', beoordeelKoppelingen(basis({ test: true, laatsteMailIn: null, laatsteGroepIn: null, laatste1op1In: null, laatsteWebsiteIn: terug(99 * 60) })).instroom.stand === 'goed');

console.log('\n== De andere koppelingen ==');
const kapot = beoordeelKoppelingen(basis({ health: { database: { ok: true }, imap: { ok: false, detail: 'Inloggen op de mailbox mislukt' }, smtp: { ok: false, detail: 'SMTP weigert' }, ai: { ok: false, detail: 'AI-tegoed op (429)' } }, agenda: { ingesteld: true, verbonden: false, reden: 'toegang ingetrokken' } }));
ok('mail in/uit, AI en agenda kapot = elk een eigen rode regel met de echte reden', ['mailIn', 'mailUit', 'ai', 'agenda'].every((k) => rij(kapot, k).stand === 'fout') && /mailbox mislukt/.test(rij(kapot, 'mailIn').uitleg) && /429/.test(rij(kapot, 'ai').uitleg) && /toegang ingetrokken/.test(rij(kapot, 'agenda').uitleg));
ok('niet ingesteld is "uit", geen storing', (() => { const u = beoordeelKoppelingen(basis({ mailIngesteld: false, smtpIngesteld: false, aiIngesteld: false, health: { database: { ok: true } }, officieel: { ingesteld: false }, agenda: { ingesteld: false }, laatsteWebsiteIn: null })); return ['mailIn', 'mailUit', 'ai', 'waOfficieel', 'agenda', 'website'].every((k) => rij(u, k).stand === 'uit') && u.stand === 'goed'; })());
ok('mailbox 30+ min niet uitgelezen = aandacht', rij(beoordeelKoppelingen(basis({ imapLaatstOk: terug(50) })), 'mailIn').stand === 'let');
ok('mislukte mails en mislukte appjes = aandacht met het aantal', /2 mails zijn/.test(rij(beoordeelKoppelingen(basis({ mailFouten24u: 2 })), 'mailUit').uitleg) && /1 WhatsApp-bericht is/.test(rij(beoordeelKoppelingen(basis({ outboxMislukt24u: 1 })), 'waOfficieel').uitleg));
ok('website 4+ dagen stil = aandacht', rij(beoordeelKoppelingen(basis({ laatsteWebsiteIn: terug(5 * 24 * 60) })), 'website').stand === 'let');
ok('agenda: afspraken die niet in Google staan = aandacht', /3 afspraken staan niet/.test(rij(beoordeelKoppelingen(basis({ agenda: { ingesteld: true, verbonden: true, fouten: 3 } })), 'agenda').uitleg));
ok('opslag: database stuk = fout; weinig ruimte of oude back-up = aandacht', rij(beoordeelKoppelingen(basis({ health: { ...goedHealth, database: { ok: false, detail: 'schrijven mislukt' } } })), 'opslag').stand === 'fout' && rij(beoordeelKoppelingen(basis({ schijfVrijMB: 120 })), 'opslag').stand === 'let' && rij(beoordeelKoppelingen(basis({ laatsteBackup: terug(20 * 60) })), 'opslag').stand === 'let');
ok('nergens een geheim of adres in de uitvoer', !/@|token|wachtwoord:|sk-/i.test(JSON.stringify(goed)) && beoordeelKoppelingen().regels.length === 8);

console.log(`\n========== KOPPELINGEN: ${pass} geslaagd, ${fail} gefaald ==========`);
process.exit(fail ? 1 : 0);

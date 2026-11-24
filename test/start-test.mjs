// START — werklijst "Eerst doen" (24 nov 2026). Zonder server: de regels zijn een pure
// functie (server/eerst-doen.js). Bewaakt: belangrijkste eerst, juiste tellingen en
// enkelvoud/meervoud, per rol de juiste punten, nooit bedragen, en de plek waar elke knop
// naartoe gaat.   Draaien: node test/start-test.mjs
import { eerstDoenLijst, duurTekst } from '../server/eerst-doen.js';

let pass = 0, fail = 0;
const ok = (naam, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${naam}`); } else { fail++; console.log(`  ✗ FAIL: ${naam} ${extra}`); } };
const NU = Date.parse('2026-11-24T10:00:00Z');
const min = (n) => new Date(NU - n * 60000).toISOString();

console.log('\n== Wachttijd in gewone woorden ==');
ok('minuten, uren en dagen', duurTekst(0) === '1 min' && duurTekst(42 * 60000) === '42 min' && duurTekst(3 * 3600000) === '3 uur' && duurTekst(47 * 3600000) === '47 uur' && duurTekst(50 * 3600000) === '2 dagen', [duurTekst(0), duurTekst(42 * 60000), duurTekst(3 * 3600000), duurTekst(50 * 3600000)].join());

console.log('\n== Kantoor: alles op een rij, belangrijkste eerst ==');
const vol = eerstDoenLijst({
  monteur: false, nu: NU,
  pending: [{ createdAt: min(5) }, { createdAt: min(42) }, { createdAt: min(12) }],
  wacht: [{ naam: 'Familie Voorbeeld', at: min(180) }, { naam: 'Mevrouw Test', at: min(30 * 60) }],
  reacties: [{ id: 'o1', title: 'Testdorp — slot' }],
  afspraakGeweest: [{ id: 'o2', title: 'A' }, { id: 'o3', title: 'B' }],
  offertesStil: [{ id: 'o4', title: 'Proefwijk — schuifpui' }],
  teFactureren: [{ id: 'o5', title: 'X' }, { id: 'o6', title: 'Y' }],
  verlopenFacturen: 3, drsTeMelden: 7,
  onvolledig: [{ id: 'o7', title: 'Z' }],
  bridge: { ingesteld: true, stilMin: 2 },
});
const sleutels = vol.map((p) => p.sleutel).join();
ok('volgorde: rood eerst (inbox, wacht), dan oranje, dan grijs', sleutels === 'inbox,wacht,reactie,afspraakGeweest,offertes,factureren,verlopen,drs,onvolledig', sleutels);
const p = (k) => vol.find((x) => x.sleutel === k);
ok('inbox: telling en oudste wachttijd', p('inbox').titel === '3 nieuwe aanvragen beoordelen' && p('inbox').uitleg === 'Oudste wacht 42 min' && p('inbox').ga.view === 'inbox', JSON.stringify(p('inbox')));
ok('wacht: langst wachtende klant, rood na 24 uur, opent Berichten op "wacht"', p('wacht').titel === '2 klanten wachten op antwoord' && /Mevrouw Test · 30 uur/.test(p('wacht').uitleg) && p('wacht').ernst === 'rood' && p('wacht').ga.view === 'chats' && p('wacht').ga.chatFilter === 'wacht', JSON.stringify(p('wacht')));
ok('één opdracht → de knop opent meteen die opdracht', p('reactie').titel === 'Klant reageerde op 1 opdracht' && p('reactie').ga.open === 'o1' && p('offertes').ga.open === 'o4');
ok('meerdere opdrachten → naar de juiste kolom op het bord', p('afspraakGeweest').ga.view === 'board' && p('afspraakGeweest').ga.col === 'afspraak_ingepland' && /^2 afspraken zijn geweest/.test(p('afspraakGeweest').titel));
ok('facturen: nog te factureren en over de termijn, met het juiste filter', p('factureren').ga.view === 'invoices' && p('verlopen').ga.invFilter === 'verlopen' && p('verlopen').titel === '3 facturen zijn over de betaaltermijn');
ok('DRS-rapport opent het rapportvenster', p('drs').ga.actie === 'drsrapport' && p('drs').titel === 'DRS-rapport: 7 opdrachten nog te melden' && p('drs').ernst === 'grijs');
ok('nergens een bedrag in de lijst (ook de assistente ziet hem)', !/€|\beuro\b/i.test(JSON.stringify(vol)));
ok('elk punt heeft een telling, titel, knoptekst en een bestemming', vol.every((x) => x.aantal > 0 && x.titel && x.knop && x.ga && (x.ga.view || x.ga.open || x.ga.actie)));

console.log('\n== Enkelvoud, lege lijst en de koppeling ==');
const een = eerstDoenLijst({ monteur: false, nu: NU, pending: [{ createdAt: min(3) }], wacht: [{ naam: 'Klant', at: min(125) }], verlopenFacturen: 1, drsTeMelden: 1 });
ok('enkelvoud klopt', een.map((x) => x.titel).join(' | ') === '1 nieuwe aanvraag beoordelen | 1 klant wacht op antwoord | 1 factuur is over de betaaltermijn | DRS-rapport: 1 opdracht nog te melden', een.map((x) => x.titel).join(' | '));
ok('wacht korter dan 24 uur = oranje', een.find((x) => x.sleutel === 'wacht').ernst === 'oranje');
ok('niets te doen = lege lijst (het scherm zegt dan "alles is bij")', eerstDoenLijst({ monteur: false, nu: NU }).length === 0 && eerstDoenLijst().length === 0);
const stil = eerstDoenLijst({ monteur: false, nu: NU, pending: [{ createdAt: min(1) }], bridge: { ingesteld: true, stilMin: 40 } });
ok('WhatsApp-groepen 15+ min stil = bovenaan, en opent het koppelingen-overzicht', stil[0].sleutel === 'bridge' && stil[0].ga.actie === 'koppelstatus' && /40 min/.test(stil[0].uitleg), JSON.stringify(stil[0]));
const kf = eerstDoenLijst({ monteur: false, nu: NU, pending: [{ createdAt: min(1) }], koppelFouten: [{ sleutel: 'mailUit', naam: 'E-mail versturen', uitleg: 'SMTP weigert de login' }, { sleutel: 'agenda', naam: 'Google Agenda', uitleg: 'Niet meer verbonden' }] });
ok('een andere kapotte koppeling (mail, agenda…) staat als eigen rode regel bovenaan', kf[0].sleutel === 'koppeling:mailUit' && kf[0].titel === 'E-mail versturen werkt niet' && kf[0].ernst === 'rood' && kf[1].sleutel === 'koppeling:agenda' && kf[2].sleutel === 'inbox' && kf[0].ga.actie === 'koppelstatus', JSON.stringify(kf.map((x) => x.sleutel)));
ok('de monteur ziet geen meldingen over koppelingen', !eerstDoenLijst({ monteur: true, nu: NU, koppelFouten: [{ sleutel: 'mailUit', naam: 'E-mail versturen', uitleg: 'x' }] }).length);
ok('korter stil, of nooit gekoppeld = geen melding', !eerstDoenLijst({ nu: NU, bridge: { ingesteld: true, stilMin: 14 } }).length && !eerstDoenLijst({ nu: NU, bridge: { ingesteld: false, stilMin: 999 } }).length);

console.log('\n== Monteur: alleen zijn eigen werk ==');
const mont = eerstDoenLijst({ monteur: true, nu: NU, pending: [{ createdAt: min(5) }], wacht: [{ naam: 'X', at: min(300) }], reacties: [{ id: 'm1', title: 'Eigen opdracht' }], afspraakGeweest: [{ id: 'm2', title: 'Q' }], offertesStil: [{ id: 'm3', title: 'R' }], teFactureren: [{ id: 'm4', title: 'S' }], verlopenFacturen: 4, drsTeMelden: 9, onvolledig: [{ id: 'm5', title: 'T' }], bridge: { ingesteld: true, stilMin: 99 } });
ok('monteur ziet geen inbox, wachtlijst, offertes, verlopen facturen, DRS of koppelingen', mont.map((x) => x.sleutel).join() === 'reactie,afspraakGeweest,factureren', mont.map((x) => x.sleutel).join());

console.log(`\n========== START: ${pass} geslaagd, ${fail} gefaald ==========`);
process.exit(fail ? 1 : 0);

// START — werklijst "Eerst doen" (24 nov 2026). Zonder server: de regels zijn een pure
// functie (server/eerst-doen.js). Bewaakt: belangrijkste eerst, juiste tellingen en
// enkelvoud/meervoud, per rol de juiste punten, nooit bedragen, en de plek waar elke knop
// naartoe gaat.   Draaien: node test/start-test.mjs
import { eerstDoenLijst, duurTekst, AFVINKBAAR } from '../server/eerst-doen.js';
import { vinkAfIn, zetTerugIn, afgevinktUit, scopeVan, magSleutel, wachtId, zonderAfgevinkteWachtenden } from '../server/start-af.js';

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

// AFVINKEN (25 nov 2026, wens eigenaar): een punt van Start afvinken of wegvegen. Onthouden per
// onderdeel; iets nieuws komt terug; een kapotte koppeling is nooit af te vinken.
console.log('\n== Afvinken: weg van Start, tot er iets nieuws bij komt ==');
{
  const basis = { monteur: false, nu: NU, teFactureren: [{ id: 'o1', title: 'Een' }, { id: 'o2', title: 'Twee' }], verlopenFacturen: [{ afId: 'f1' }, { afId: 'f2' }, { afId: 'f3' }],
    reacties: [{ id: 'o9', title: 'Reactie', afId: 'o9|2026-11-24T08:00:00.000Z' }], koppelFouten: [{ sleutel: 'mailUit', naam: 'E-mail versturen', uitleg: 'x' }], bridge: { ingesteld: true, stilMin: 40 } };
  const voor = eerstDoenLijst(basis);
  const fact = voor.find((p) => p.sleutel === 'factureren');
  ok('elk werkpunt is af te vinken en draagt de id\'s van zijn onderdelen; een kapotte koppeling niet', fact.afvinkbaar === true && fact.ids.join() === 'o1,o2' && voor.find((p) => p.sleutel === 'verlopen').ids.join() === 'f1,f2,f3'
    && voor.filter((p) => p.sleutel === 'bridge' || p.sleutel.startsWith('koppeling:')).every((p) => p.afvinkbaar === false && !p.ids), JSON.stringify(voor.map((p) => [p.sleutel, p.afvinkbaar])));
  const opslag = {};
  const n = vinkAfIn(opslag, 'kantoor', 'factureren', fact.ids, { door: 'Assistente', geldig: new Set(['o1', 'o2']), nu: NU });
  const na = eerstDoenLijst({ ...basis, afgevinkt: afgevinktUit(opslag, 'kantoor') });
  ok('afgevinkt = het punt is weg van Start; de andere punten staan er nog', n === 2 && !na.some((p) => p.sleutel === 'factureren') && na.some((p) => p.sleutel === 'verlopen') && na.some((p) => p.sleutel === 'reactie'));
  const metNieuw = eerstDoenLijst({ ...basis, teFactureren: [...basis.teFactureren, { id: 'o3', title: 'Nieuw afgerond' }], afgevinkt: afgevinktUit(opslag, 'kantoor') });
  const terug = metNieuw.find((p) => p.sleutel === 'factureren');
  ok('komt er iets NIEUWS bij, dan staat het punt er weer — met alleen het nieuwe (1, niet 3)', !!terug && terug.aantal === 1 && /^1 afgeronde opdracht zonder factuur$/.test(terug.titel) && terug.ids.join() === 'o3' && terug.ga && terug.uitleg === 'Nieuw afgerond', JSON.stringify(terug));
  const afLijst = eerstDoenLijst({ ...basis, afgevinkt: afgevinktUit(opslag, 'kantoor'), alleenAfgevinkt: true });
  ok('wat is afgevinkt is op te vragen (voor "Terugzetten"), zonder de koppelingen', afLijst.length === 1 && afLijst[0].sleutel === 'factureren' && afLijst[0].aantal === 2, JSON.stringify(afLijst.map((p) => [p.sleutel, p.aantal])));
  vinkAfIn(opslag, 'kantoor', 'verlopen', ['f1'], { geldig: new Set(['f1', 'f2', 'f3']), nu: NU });
  const deel = eerstDoenLijst({ ...basis, afgevinkt: afgevinktUit(opslag, 'kantoor') }).find((p) => p.sleutel === 'verlopen');
  ok('één onderdeel afvinken laat de rest staan (3 → 2)', deel.aantal === 2 && /^2 facturen/.test(deel.titel) && deel.ids.join() === 'f2,f3');
  ok('alleen wat er NU is wordt onthouden: een onbekende of rare id wordt genegeerd', vinkAfIn(opslag, 'kantoor', 'verlopen', ['bestaat-niet', '<script>', 'f2'], { geldig: new Set(['f1', 'f2', 'f3']), nu: NU }) === 1 && Object.keys(opslag.kantoor.verlopen.items).sort().join() === 'f1,f2');
  // opgelost en later opnieuw: het vinkje van toen geldt niet meer
  vinkAfIn(opslag, 'kantoor', 'verlopen', ['f3'], { geldig: new Set(['f3']), nu: NU });
  ok('wat is opgelost wordt vergeten (f1 en f2 zijn betaald → uit het geheugen)', Object.keys(opslag.kantoor.verlopen.items).join() === 'f3');
  ok('terugzetten: één onderdeel of alles van een punt', zetTerugIn(opslag, 'kantoor', 'factureren', ['o1']) === 1 && Object.keys(opslag.kantoor.factureren.items).join() === 'o2' && zetTerugIn(opslag, 'kantoor', 'factureren') === 1 && !opslag.kantoor.factureren && zetTerugIn(opslag, 'kantoor', 'factureren') === 0);
  // een klant die later opnieuw reageert is een nieuw onderdeel
  vinkAfIn(opslag, 'kantoor', 'reactie', ['o9|2026-11-24T08:00:00.000Z'], { geldig: new Set(['o9|2026-11-24T08:00:00.000Z']), nu: NU });
  const weg = eerstDoenLijst({ ...basis, afgevinkt: afgevinktUit(opslag, 'kantoor') }).some((p) => p.sleutel === 'reactie');
  const opnieuw = eerstDoenLijst({ ...basis, reacties: [{ id: 'o9', title: 'Reactie', afId: 'o9|2026-11-24T09:30:00.000Z' }], afgevinkt: afgevinktUit(opslag, 'kantoor') }).some((p) => p.sleutel === 'reactie');
  ok('klantreactie afgevinkt = weg; reageert dezelfde klant later OPNIEUW, dan staat hij er weer', !weg && opnieuw);
  // een kaal getal (oude aanroep) blijft werken
  const getal = eerstDoenLijst({ nu: NU, verlopenFacturen: 4, drsTeMelden: 2 });
  ok('een kaal aantal (zonder onderdelen) werkt nog zoals voorheen', getal.find((p) => p.sleutel === 'verlopen').aantal === 4 && getal.find((p) => p.sleutel === 'drs').aantal === 2);
  // kantoor deelt één lijst; een monteur heeft zijn eigen
  vinkAfIn(opslag, scopeVan({ role: 'monteur', monteurId: 'mon1' }), 'factureren', ['o1'], { geldig: new Set(['o1']), nu: NU });
  ok('het kantoor deelt één lijst, een monteur heeft zijn eigen (zijn vinkje raakt het kantoor niet)', scopeVan({ role: 'admin' }) === 'kantoor' && scopeVan({ role: 'assistent' }) === 'kantoor' && scopeVan({ role: 'monteur', monteurId: 'mon1' }) === 'm:mon1'
    && !afgevinktUit(opslag, 'kantoor').factureren && afgevinktUit(opslag, 'm:mon1').factureren.has('o1'));
  ok('een monteur mag alleen zijn eigen soort punten afvinken; een koppeling kan niemand afvinken', magSleutel({ role: 'monteur' }, 'factureren') && !magSleutel({ role: 'monteur' }, 'inbox') && !magSleutel({ role: 'monteur' }, 'verlopen') && magSleutel({ role: 'admin' }, 'inbox')
    && !magSleutel({ role: 'admin' }, 'bridge') && !magSleutel({ role: 'admin' }, 'koppeling:mailUit') && AFVINKBAAR.every((k) => magSleutel({ role: 'assistent' }, k)));
  // het punt "klanten wachten op antwoord" afgevinkt → die klanten staan ook niet meer in het blok op Start
  const wachtenden = [{ chatId: 'cust_a', at: '2026-11-23T08:00:00.000Z', naam: 'A' }, { chatId: 'tel:+31612000001', at: '2026-11-23T09:00:00.000Z', naam: 'B' }];
  vinkAfIn(opslag, 'kantoor', 'wacht', [wachtId(wachtenden[0])], { geldig: new Set(wachtenden.map(wachtId)), nu: NU });
  const blok = zonderAfgevinkteWachtenden(wachtenden, afgevinktUit(opslag, 'kantoor'));
  const opnieuwGeschreven = zonderAfgevinkteWachtenden([{ ...wachtenden[0], at: '2026-11-24T07:00:00.000Z' }], afgevinktUit(opslag, 'kantoor'));
  ok('afgevinkte wachtende klant staat niet meer in het blok op Start; schrijft hij OPNIEUW, dan wel; zonder vinkjes verandert er niets', blok.length === 1 && blok[0].naam === 'B' && opnieuwGeschreven.length === 1 && zonderAfgevinkteWachtenden(wachtenden, {}).length === 2 && zonderAfgevinkteWachtenden(wachtenden, afgevinktUit(opslag, 'm:mon1')).length === 2);
  // regels uit het dagoverzicht: geen vaste lijst, het vinkje verloopt na 14 dagen
  vinkAfIn(opslag, 'kantoor', 'dag', ['dag:actie:abc123'], { nu: NU - 20 * 86400000 });
  vinkAfIn(opslag, 'kantoor', 'dag', ['dag:actie:nieuw1'], { nu: NU });
  ok('dagoverzicht: een vinkje van langer dan 14 dagen geleden wordt opgeruimd', Object.keys(opslag.kantoor.dag.items).join() === 'dag:actie:nieuw1');
}

// ---- Campagne-concept dat het CRM zelf klaarzette (27 nov 2026) ----
{
  const metConcept = eerstDoenLijst({ nu: NU, campagneConcepten: [{ id: 'cmp1', naam: 'Jaarlijks onderhoud schuifpui — december 2026', aantal: 7 }] });
  const punt = metConcept.find((p) => p.sleutel === 'campagne');
  ok('campagne-concept: grijs punt "klaar om na te lezen" met de naam en het aantal klanten, af te vinken, gaat naar Campagnes', !!punt && punt.ernst === 'grijs' && /klaar om na te lezen: Jaarlijks onderhoud/.test(punt.titel) && /7 klanten/.test(punt.uitleg) && /niets uit zonder jouw klik/.test(punt.uitleg) && punt.afvinkbaar === true && punt.ids.join() === 'cmp1' && punt.ga.view === 'campagnes', JSON.stringify(punt));
  ok('campagne-concept: nooit bij de monteur, en weg zodra het is afgevinkt', !eerstDoenLijst({ monteur: true, nu: NU, campagneConcepten: [{ id: 'cmp1', naam: 'x', aantal: 3 }] }).some((p) => p.sleutel === 'campagne')
    && !eerstDoenLijst({ nu: NU, campagneConcepten: [{ id: 'cmp1', naam: 'x', aantal: 3 }], afgevinkt: { campagne: new Set(['cmp1']) } }).some((p) => p.sleutel === 'campagne'));
}

console.log(`\n========== START: ${pass} geslaagd, ${fail} gefaald ==========`);
process.exit(fail ? 1 : 0);

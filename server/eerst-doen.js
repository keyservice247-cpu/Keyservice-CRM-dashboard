// EERST DOEN (24 nov 2026, herontwerp van Start). Eén werklijst bovenaan: wat moet er NU
// gebeuren, het belangrijkste eerst. Vaste regels uit gegevens die er al zijn — geen AI,
// dus dezelfde stand geeft altijd dezelfde lijst. Elk punt heeft een telling, één regel
// uitleg, een knoptekst en een plek om naartoe te gaan (`ga`: het scherm leest dat uit).
// Deze functie leest zelf niets uit de database: de route geeft alles mee, zodat de regels
// los te testen zijn. Er staan NOOIT bedragen in (ook de assistente ziet deze lijst).

export function duurTekst(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${Math.max(1, min)} min`;
  const uur = Math.round(min / 60);
  if (uur < 48) return `${uur} uur`;
  return `${Math.floor(uur / 24)} dagen`;
}

const ERNST_VOLGORDE = { rood: 0, oranje: 1, grijs: 2 };

// AFVINKEN (25 nov 2026, wens eigenaar: "dit soort dingen moeten we af kunnen vinken of weg
// swipen als ze het hebben gedaan"). Een punt bestaat uit losse ONDERDELEN (opdrachten, facturen,
// gesprekken). Wat is afgevinkt wordt PER ONDERDEEL onthouden (`afgevinkt[sleutel]` = de id's):
//  - afgevinkte onderdelen tellen niet meer mee; is er niets over, dan is het punt weg;
//  - komt er iets NIEUWS bij, dan staat het punt er weer — met alleen het nieuwe;
//  - een kapotte koppeling is NOOIT af te vinken: die verdwijnt pas als hij weer werkt.
// Een onderdeel heet `afId` (anders `id`); een kaal getal telt als zoveel naamloze onderdelen.
/** De sleutels die af te vinken zijn (de route controleert hiertegen). */
export const AFVINKBAAR = ['akkoord', 'inbox', 'wacht', 'reactie', 'afspraakGeweest', 'offertes', 'factureren', 'verlopen', 'drs', 'onvolledig', 'campagne'];
export const afIdVan = (x, i = 0) => String((x && (x.afId || x.id)) || `#${i}`);
const alsLijst = (v) => (Array.isArray(v) ? v : Array.from({ length: Math.max(0, Number(v) || 0) }, () => ({})));
const isAf = (afgevinkt, sleutel, id) => { const set = afgevinkt && afgevinkt[sleutel]; return !!set && (set instanceof Set ? set.has(id) : Array.isArray(set) ? set.includes(id) : Object.prototype.hasOwnProperty.call(set, id)); };
/** Een lijst zonder (of juist met alleen) de afgevinkte onderdelen. */
export function zonderAfgevinkt(lijst, afgevinkt, sleutel, alleenAf = false) {
  return alsLijst(lijst).filter((x, i) => isAf(afgevinkt, sleutel, afIdVan(x, i)) === alleenAf);
}

/**
 * @param {object} in_
 * @param {boolean} in_.monteur            ingelogd als monteur (ziet alleen eigen werk)
 * @param {number}  in_.nu                 tijdstip (ms)
 * @param {Array}   in_.pending            wachtende inbox-aanvragen [{createdAt}]
 * @param {Array}   in_.wacht              onbeantwoorde gesprekken [{naam, at}]
 * @param {Array}   in_.reacties           opdrachten met een nieuwe klantreactie [{id, title}]
 * @param {Array}   in_.afspraakGeweest    afspraak vóór vandaag, opdracht nog open [{id, title}]
 * @param {Array}   in_.offertesStil       offertes 3+ dagen stil [{id, title}]
 * @param {Array}   in_.teFactureren       afgerond zonder factuur [{id, title}]
 * @param {number}  in_.verlopenFacturen   aantal facturen over de betaaltermijn
 * @param {number}  in_.drsTeMelden        aantal DRS-opdrachten dat nog gemeld moet worden
 * @param {Array}   in_.onvolledig         opdrachten zonder klantnaam [{id, title}]
 * @param {Array}   in_.campagneConcepten  automatisch klaargezette campagne-concepten [{id, naam, aantal}]
 * @param {Array}   in_.akkoordOffertes    offertes die de klant online goedkeurde en nog niet zijn
 *                                         ingepland [{id (offerte), orderId, nummer, klant}]
 * @param {object}  in_.bridge             {ingesteld, stilMin} van de WhatsApp-bridge
 * @param {Array}   in_.koppelFouten       andere koppelingen die niet werken [{sleutel, naam, uitleg}]
 * @param {object}  in_.afgevinkt          {sleutel: id's} — wat is afgevinkt (zie AFVINKEN hierboven)
 * @param {boolean} in_.alleenAfgevinkt    geef juist de AFGEVINKTE punten terug (voor "Terugzetten")
 */
export function eerstDoenLijst(in_) {
  const { monteur = false, nu = Date.now(), bridge = null, koppelFouten = [], afgevinkt = null, alleenAfgevinkt = false } = in_ || {};
  const kies = (sleutel, lijst) => zonderAfgevinkt(lijst, afgevinkt, sleutel, alleenAfgevinkt);
  const pending = kies('inbox', (in_ || {}).pending || []);
  const wacht = kies('wacht', (in_ || {}).wacht || []);
  const reacties = kies('reactie', (in_ || {}).reacties || []);
  const afspraakGeweest = kies('afspraakGeweest', (in_ || {}).afspraakGeweest || []);
  const offertesStil = kies('offertes', (in_ || {}).offertesStil || []);
  const teFactureren = kies('factureren', (in_ || {}).teFactureren || []);
  const verlopen = kies('verlopen', (in_ || {}).verlopenFacturen || 0);
  const drs = kies('drs', (in_ || {}).drsTeMelden || 0);
  const onvolledig = kies('onvolledig', (in_ || {}).onvolledig || []);
  const campagne = kies('campagne', (in_ || {}).campagneConcepten || []);
  const akkoord = kies('akkoord', (in_ || {}).akkoordOffertes || []);
  const verlopenFacturen = verlopen.length; const drsTeMelden = drs.length;
  const onderdelen = { inbox: pending, wacht, reactie: reacties, afspraakGeweest, offertes: offertesStil, factureren: teFactureren, verlopen, drs, onvolledig, campagne, akkoord };
  const uit = [];
  const zet = (p) => {
    if (!(p.aantal > 0)) return;
    const lijst = onderdelen[p.sleutel];
    // Af te vinken = elk punt dat uit onderdelen bestaat; de id's gaan mee zodat het scherm
    // precies afvinkt wat het liet zien (iets dat intussen binnenkomt blijft staan).
    uit.push(lijst ? { ...p, afvinkbaar: true, ids: lijst.map((x, i) => afIdVan(x, i)) } : { ...p, afvinkbaar: false });
  };
  const mv = (n, een, meer) => (n === 1 ? een : meer.replace('{n}', String(n)));
  // Eén opdracht → meteen die opdracht openen; meer → naar de plek waar ze staan.
  const naar = (lijst, anders) => (lijst.length === 1 && lijst[0].id ? { open: lijst[0].id } : anders);
  const eerste = (lijst) => (lijst[0] && lijst[0].title ? String(lijst[0].title).slice(0, 80) : '');
  const oudste = (lijst, veld) => lijst.reduce((m, x) => { const t = new Date(x[veld] || 0).getTime(); return t && t < m ? t : m; }, nu);

  if (!monteur && !alleenAfgevinkt) {
    if (bridge && bridge.ingesteld && bridge.stilMin >= 15) {
      zet({ sleutel: 'bridge', ernst: 'rood', aantal: 1, titel: 'WhatsApp-groepen komen niet binnen',
        uitleg: `De koppeling met de groepen is ${duurTekst(bridge.stilMin * 60000)} stil. Opdrachten uit de groep kunnen ontbreken.`,
        knop: 'Bekijken', ga: { actie: 'koppelstatus' } });
    }
    // Een andere koppeling die niet werkt (mail, agenda, AI, opslag): elk een eigen regel.
    for (const k of koppelFouten || []) {
      zet({ sleutel: `koppeling:${k.sleutel}`, ernst: 'rood', aantal: 1, titel: `${k.naam} werkt niet`, uitleg: String(k.uitleg || '').slice(0, 160), knop: 'Bekijken', ga: { actie: 'koppelstatus' } });
    }
  }
  if (!monteur) {
    // De klant ging online akkoord met een offerte (akkoordknop, 27 nov 2026): dit is werk dat
    // geld oplevert — bovenaan, tot de afspraak staat of iemand het afvinkt.
    const een = akkoord.length === 1 ? akkoord[0] : null;
    zet({ sleutel: 'akkoord', ernst: 'rood', aantal: akkoord.length,
      titel: een ? `${een.klant || 'Klant'} ging akkoord met offerte ${een.nummer || ''}`.trim() : `${akkoord.length} klanten gingen akkoord met een offerte`,
      uitleg: 'Plan de afspraak in — de klant wacht op ons', knop: een ? 'Openen' : 'Bekijken',
      ga: een ? (een.orderId ? { open: een.orderId } : { factuur: een.id }) : { view: 'invoices', invFilter: 'akkoord' } });
    zet({ sleutel: 'inbox', ernst: 'rood', aantal: pending.length,
      titel: mv(pending.length, '1 nieuwe aanvraag beoordelen', '{n} nieuwe aanvragen beoordelen'),
      uitleg: pending.length ? `Oudste wacht ${duurTekst(nu - oudste(pending, 'createdAt'))}` : '',
      knop: 'Naar inbox', ga: { view: 'inbox' } });
    const langst = wacht.slice().sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))[0];
    zet({ sleutel: 'wacht', ernst: langst && nu - new Date(langst.at).getTime() > 24 * 3600000 ? 'rood' : 'oranje', aantal: wacht.length,
      titel: mv(wacht.length, '1 klant wacht op antwoord', '{n} klanten wachten op antwoord'),
      uitleg: langst ? `Langst: ${String(langst.naam || 'klant').slice(0, 40)} · ${duurTekst(nu - new Date(langst.at).getTime())}` : '',
      knop: 'Antwoorden', ga: { view: 'chats', chatFilter: 'wacht' } });
  }
  zet({ sleutel: 'reactie', ernst: 'oranje', aantal: reacties.length,
    titel: mv(reacties.length, 'Klant reageerde op 1 opdracht', 'Klanten reageerden op {n} opdrachten'),
    uitleg: eerste(reacties), knop: 'Bekijken', ga: naar(reacties, { view: 'board' }) });
  zet({ sleutel: 'afspraakGeweest', ernst: 'oranje', aantal: afspraakGeweest.length,
    titel: mv(afspraakGeweest.length, '1 afspraak is geweest, opdracht staat nog open', '{n} afspraken zijn geweest, opdrachten staan nog open'),
    uitleg: 'Afronden, verzetten of annuleren', knop: 'Bekijken', ga: naar(afspraakGeweest, { view: 'board', col: 'afspraak_ingepland' }) });
  if (!monteur) {
    zet({ sleutel: 'offertes', ernst: 'oranje', aantal: offertesStil.length,
      titel: mv(offertesStil.length, '1 offerte ligt 3+ dagen stil', '{n} offertes liggen 3+ dagen stil'),
      uitleg: eerste(offertesStil), knop: 'Opvolgen', ga: naar(offertesStil, { view: 'board', col: 'offerte_verzonden' }) });
  }
  zet({ sleutel: 'factureren', ernst: 'oranje', aantal: teFactureren.length,
    titel: mv(teFactureren.length, '1 afgeronde opdracht zonder factuur', '{n} afgeronde opdrachten zonder factuur'),
    uitleg: eerste(teFactureren), knop: 'Factureren', ga: { view: 'invoices' } });
  if (!monteur) {
    zet({ sleutel: 'verlopen', ernst: 'oranje', aantal: verlopenFacturen,
      titel: mv(verlopenFacturen, '1 factuur is over de betaaltermijn', '{n} facturen zijn over de betaaltermijn'),
      uitleg: 'Herinneren, bellen of afschrijven', knop: 'Bekijken', ga: { view: 'invoices', invFilter: 'verlopen' } });
    zet({ sleutel: 'drs', ernst: 'grijs', aantal: drsTeMelden,
      titel: mv(drsTeMelden, 'DRS-rapport: 1 opdracht nog te melden', 'DRS-rapport: {n} opdrachten nog te melden'),
      uitleg: 'Elke opdracht staat er één keer in', knop: 'Openen', ga: { actie: 'drsrapport' } });
    zet({ sleutel: 'onvolledig', ernst: 'grijs', aantal: onvolledig.length,
      titel: mv(onvolledig.length, '1 opdracht zonder klantnaam', '{n} opdrachten zonder klantnaam'),
      uitleg: 'Klantgegevens aanvullen', knop: 'Aanvullen', ga: naar(onvolledig, { view: 'board' }) });
    // Een concept dat het CRM zelf heeft klaargezet (jaarlijks onderhoud). Er gaat niets uit
    // zonder dat iemand het naleest en zelf op versturen klikt.
    zet({ sleutel: 'campagne', ernst: 'grijs', aantal: campagne.length,
      titel: campagne.length === 1 ? `Campagne staat klaar om na te lezen: ${campagne[0].naam || 'concept'}` : `${campagne.length} campagnes staan klaar om na te lezen`,
      uitleg: campagne.length === 1 && campagne[0].aantal ? `${campagne[0].aantal} klanten · er gaat niets uit zonder jouw klik` : 'Er gaat niets uit zonder jouw klik', knop: 'Nalezen', ga: { view: 'campagnes' } });
  }
  // Belangrijkste eerst; binnen dezelfde ernst blijft de vaste volgorde hierboven staan.
  return uit.map((p, i) => ({ ...p, _i: i })).sort((a, b) => (ERNST_VOLGORDE[a.ernst] - ERNST_VOLGORDE[b.ernst]) || (a._i - b._i)).map(({ _i, ...p }) => p);
}

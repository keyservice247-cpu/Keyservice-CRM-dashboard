// ALLE KOPPELINGEN IN ÉÉN OOGOPSLAG (24 nov 2026, audit E5/E12/E16/I7).
// Eén lijst in gewone taal: werkt het, wanneer kwam er voor het laatst iets binnen, en wat
// moet je doen als het niet werkt. Twee dingen die eerder ontbraken:
//   - "VERBONDEN MAAR ER KOMT NIETS BINNEN": de WhatsApp-koppeling meldt zich netjes, maar
//     leest de groepen niet (gebeurde bij de LID-storing). Daarom kijken we niet alleen naar
//     de hartslag maar ook naar het laatste bericht dat écht binnenkwam.
//   - "ER KOMT NERGENS MEER IETS BINNEN": geen mail, geen WhatsApp, geen formulier.
// `beoordeelKoppelingen` is een pure functie (geen database, geen netwerk): de aanroeper
// verzamelt de feiten. Zo zijn de regels los te testen. Er verandert hier NIETS aan een
// koppeling — dit kijkt alleen.
import { duurTekst } from './eerst-doen.js';
import { db, changeVersion, listBackups, diskFreeMB } from './db.js';
import { TEST } from './omgeving.js';
import { lastHealth } from './health.js';
import { smtpConfigured } from './connectors/email-smtp.js';
import { cloudConfigured } from './connectors/whatsapp-cloud.js';
import { connectionInfo as agendaInfo } from './google.js';

const UUR = 3600000;
const geleden = (iso, nu) => { const t = iso ? new Date(iso).getTime() : NaN; return Number.isFinite(t) ? Math.max(0, nu - t) : null; };
const sinds = (iso, nu) => { const ms = geleden(iso, nu); return ms === null ? 'nog nooit' : `${duurTekst(ms)} geleden`; };
const ERNST = { fout: 0, let: 1, goed: 2, uit: 3 };

/**
 * @param {object} f  feiten (zie koppelFeiten in index.js)
 * @returns {{stand:'goed'|'let'|'fout', regels:Array, instroom:object, at:string}}
 */
export function beoordeelKoppelingen(f = {}) {
  const nu = f.nu || Date.now();
  const h = f.health || {};
  const regels = [];
  const zet = (sleutel, naam, stand, uitleg, watNu = '') => regels.push({ sleutel, naam, stand, uitleg, watNu });

  // 1. E-mail ontvangen
  if (h.imap && h.imap.ok === false) zet('mailIn', 'E-mail ontvangen', 'fout', h.imap.detail || 'De mailbox is niet bereikbaar.', 'Controleer het wachtwoord van de mailbox bij TransIP en de instelling in Render.');
  else if (!f.mailIngesteld) zet('mailIn', 'E-mail ontvangen', 'uit', 'Niet ingesteld: e-mails komen niet in het CRM.');
  else {
    const ronde = geleden(f.imapLaatstOk, nu);
    if (ronde !== null && ronde > 30 * 60000) zet('mailIn', 'E-mail ontvangen', 'let', `De mailbox is ${duurTekst(ronde)} niet uitgelezen.`, 'Meestal herstelt dit vanzelf. Blijft het zo, kijk dan bij AI-controle → Systeemcheck.');
    else zet('mailIn', 'E-mail ontvangen', 'goed', `Mailbox wordt uitgelezen · laatste e-mail binnen: ${sinds(f.laatsteMailIn, nu)}`);
  }

  // 2. E-mail versturen
  if (h.smtp && h.smtp.ok === false) zet('mailUit', 'E-mail versturen', 'fout', h.smtp.detail || 'Versturen lukt niet.', 'Klanten krijgen nu geen mails (facturen, bevestigingen). Controleer de mailinstellingen in Render.');
  else if (!f.smtpIngesteld) zet('mailUit', 'E-mail versturen', 'uit', 'Niet ingesteld: het CRM kan geen e-mails versturen.');
  else if ((f.mailFouten24u || 0) > 0) zet('mailUit', 'E-mail versturen', 'let', `${f.mailFouten24u} ${f.mailFouten24u === 1 ? 'mail is' : 'mails zijn'} in de laatste 24 uur niet aangekomen.`, 'Vaak een typefout in het e-mailadres van de klant. Zie het logboek bij AI-controle.');
  else zet('mailUit', 'E-mail versturen', 'goed', 'Versturen werkt.');

  // 3. WhatsApp-groepen (de koppeling met het wegwerpnummer)
  const b = f.bridge || {};
  if (!b.ooit) zet('waGroep', 'WhatsApp-groepen', 'uit', 'Nog nooit gekoppeld: berichten uit WhatsApp-groepen komen niet binnen.');
  else {
    const stil = geleden(b.laatstGezien, nu) ?? 0;
    const grens = (b.herstartRecent ? 25 : 12) * 60000;
    const groep = geleden(f.laatsteGroepIn, nu);
    if (stil > grens) zet('waGroep', 'WhatsApp-groepen', 'fout', `De koppeling laat ${duurTekst(stil)} niets van zich horen. Opdrachten uit de groepen komen NIET binnen.`, 'Gebruik zolang de knop "Plak opdracht" op het bord. Herstarten: op de server `pm2 restart wa`.');
    else if (b.gepauzeerd) zet('waGroep', 'WhatsApp-groepen', 'let', 'Versturen via het wegwerpnummer staat op pauze (noodrem). Ontvangen loopt door.', 'Zet de pauze uit bij Koppelingen → Wegwerpnummer pauzeren als het nummer weer vrij is.');
    else if (f.opdrachtGroepen && groep !== null && groep > 24 * UUR) zet('waGroep', 'WhatsApp-groepen', 'let', `Verbonden, maar al ${duurTekst(groep)} geen enkel bericht uit een groep ontvangen.`, 'Is het echt zo rustig? Stuur een testbericht in de groep. Komt dat niet in de inbox, dan leest de koppeling niet mee: herstart hem.');
    else zet('waGroep', 'WhatsApp-groepen', 'goed', `Verbonden · laatste bericht uit een groep: ${sinds(f.laatsteGroepIn, nu)}`);
  }

  // 4. WhatsApp-klantberichten via het officiële nummer
  const o = f.officieel || {};
  // Sinds 27 nov 2026 is dit de ENIGE weg naar een klant: het wegwerpnummer verstuurt nooit
  // meer klantberichten. Uit of niet ingesteld = klanten krijgen geen WhatsApp van het CRM.
  if (!o.ingesteld) zet('waOfficieel', 'WhatsApp officieel nummer', 'uit', 'Niet ingesteld: klanten krijgen geen WhatsApp van het CRM (wel e-mail).');
  else if (!o.aan) zet('waOfficieel', 'WhatsApp officieel nummer', f.test ? 'uit' : 'let', 'Versturen staat uit: klanten krijgen nu geen WhatsApp van het CRM. Ontvangen werkt wel.', 'Zet het aan in Instellingen → Koppelingen.');
  else if ((f.outboxMislukt24u || 0) > 0) zet('waOfficieel', 'WhatsApp officieel nummer', 'let', `${f.outboxMislukt24u} WhatsApp-${f.outboxMislukt24u === 1 ? 'bericht is' : 'berichten zijn'} in 24 uur niet verstuurd.`, 'Open Berichten: bij het bericht staat de reden.');
  else zet('waOfficieel', 'WhatsApp officieel nummer', 'goed', 'Versturen staat aan.');

  // 5. Website-formulieren
  const web = geleden(f.laatsteWebsiteIn, nu);
  if (web === null) zet('website', 'Website-formulieren', 'uit', 'Er is nog geen aanvraag via een website binnengekomen.');
  else if (web > 4 * 24 * UUR) zet('website', 'Website-formulieren', 'let', `Al ${duurTekst(web)} geen aanvraag via een website.`, 'Vul zelf het formulier op de website in. Komt het niet binnen, dan is de koppeling met de site stuk.');
  else zet('website', 'Website-formulieren', 'goed', `Laatste aanvraag via een website: ${sinds(f.laatsteWebsiteIn, nu)}`);

  // 6. Google Agenda
  const a = f.agenda || {};
  if (!a.ingesteld) zet('agenda', 'Google Agenda', 'uit', 'Niet ingesteld: afspraken staan alleen in het CRM.');
  else if (!a.verbonden) zet('agenda', 'Google Agenda', 'fout', a.reden ? `Niet meer verbonden: ${a.reden}` : 'Niet verbonden: afspraken komen niet in Google Agenda.', 'Koppelingen → Google Agenda → opnieuw verbinden.');
  else if ((a.fouten || 0) > 0) zet('agenda', 'Google Agenda', 'let', `${a.fouten} ${a.fouten === 1 ? 'afspraak staat' : 'afspraken staan'} niet in Google Agenda.`, 'Koppelingen → Google Agenda → "Controleer & herstel nu".');
  else zet('agenda', 'Google Agenda', 'goed', 'Verbonden.');

  // 7. AI
  if (h.ai && h.ai.ok === false) zet('ai', 'AI (indelen van aanvragen)', 'fout', h.ai.detail || 'De AI reageert niet.', 'Aanvragen komen wel binnen, maar worden niet automatisch goedgekeurd. Controleer het tegoed bij Anthropic.');
  else if (!f.aiIngesteld) zet('ai', 'AI (indelen van aanvragen)', 'uit', 'Geen AI-sleutel: aanvragen worden met vaste regels ingedeeld.');
  else zet('ai', 'AI (indelen van aanvragen)', 'goed', 'De AI reageert.');

  // 8. Opslag en back-ups
  const bk = geleden(f.laatsteBackup, nu);
  if (h.database && h.database.ok === false) zet('opslag', 'Opslag en back-ups', 'fout', h.database.detail || 'De database kan niet opslaan.', 'Dit is ernstig: wijzigingen gaan verloren. Neem meteen contact op met de bouwer.');
  else if (typeof f.schijfVrijMB === 'number' && f.schijfVrijMB < 500) zet('opslag', 'Opslag en back-ups', 'let', `Nog maar ${Math.round(f.schijfVrijMB)} MB vrij op de schijf.`, 'Instellingen → Systeem & back-ups → Foto\'s & video\'s beheren → opruimen.');
  else if (!f.test && (bk === null || bk > 13 * UUR)) zet('opslag', 'Opslag en back-ups', 'let', bk === null ? 'Er is nog geen back-up gemaakt.' : `Laatste back-up is ${duurTekst(bk)} oud (hoort elke 6 uur).`, 'Instellingen → Systeem & back-ups → Back-ups.');
  else zet('opslag', 'Opslag en back-ups', 'goed', `Opslaan werkt${bk === null ? '' : ` · laatste back-up ${duurTekst(bk)} geleden`}${typeof f.schijfVrijMB === 'number' ? ` · ${Math.round(f.schijfVrijMB)} MB vrij` : ''}`);

  // Komt er nog iets binnen? (alle kanalen samen)
  const laatste = [f.laatsteMailIn, f.laatsteGroepIn, f.laatste1op1In, f.laatsteWebsiteIn].filter(Boolean).sort().pop() || null;
  const stilMs = geleden(laatste, nu);
  const instroom = { laatste, urenStil: stilMs === null ? null : Math.floor(stilMs / UUR), stand: 'goed', uitleg: `Laatste bericht binnen: ${sinds(laatste, nu)}` };
  if (!f.test && stilMs !== null) {
    if (stilMs >= 36 * UUR) { instroom.stand = 'fout'; instroom.uitleg = `Er is al ${duurTekst(stilMs)} NIETS binnengekomen: geen e-mail, geen WhatsApp, geen formulier.`; }
    else if (stilMs >= 18 * UUR) { instroom.stand = 'let'; instroom.uitleg = `Al ${duurTekst(stilMs)} niets binnengekomen. Kan kloppen in een rustige nacht — anders de koppelingen hieronder nakijken.`; }
  }

  const tellend = [...regels.map((r) => r.stand), instroom.stand];
  const stand = tellend.includes('fout') ? 'fout' : tellend.includes('let') ? 'let' : 'goed';
  // Wat aandacht vraagt bovenaan; de vaste volgorde blijft daarbinnen staan.
  const gesorteerd = regels.map((r, i) => ({ r, i })).sort((x, y) => (ERNST[x.r.stand] - ERNST[y.r.stand]) || (x.i - y.i)).map((x) => x.r);
  return { at: new Date(nu).toISOString(), stand, instroom, regels: gesorteerd };
}

/**
 * Moet er een alarm uit? Hooguit één per soort per dag; de aanroeper onthoudt de dag.
 * @returns {Array<{sleutel, titel, tekst}>}
 */
export function koppelAlarmen(overzicht, { werkdag = true } = {}) {
  const uit = [];
  if (!overzicht) return uit;
  if (overzicht.instroom && overzicht.instroom.stand === 'fout') {
    uit.push({ sleutel: 'instroom', titel: 'Er komt niets meer binnen', tekst: `${overzicht.instroom.uitleg} Kijk bij Instellingen → Koppelingen welke koppeling stilstaat.` });
  }
  const groep = (overzicht.regels || []).find((r) => r.sleutel === 'waGroep');
  if (werkdag && groep && groep.stand === 'let' && /geen enkel bericht uit een groep/.test(groep.uitleg)) {
    uit.push({ sleutel: 'groepStil', titel: 'WhatsApp-groepen: verbonden, maar er komt niets binnen', tekst: `${groep.uitleg} ${groep.watNu}` });
  }
  return uit;
}

// ---- De feiten verzamelen (leest alleen; verandert niets) ----
// Het laatste binnengekomen bericht per kanaal. De berichtenlijst kan groot zijn en deze
// vraag komt van Start, Instellingen en de bewaking: één keer per wijziging uitrekenen.
let _binnenCache = { sleutel: '', uit: null };
function laatsteBinnen() {
  const sleutel = `${changeVersion()}|${Math.floor(Date.now() / 60000)}`;
  if (_binnenCache.sleutel === sleutel && _binnenCache.uit) return _binnenCache.uit;
  const uit = { mail: null, groep: null, een: null, web: null };
  const ms = db().messages || [];
  // De lijst groeit aan het eind; de laatste paar duizend zijn ruim genoeg.
  for (let i = ms.length - 1, n = 0; i >= 0 && n < 4000; i--, n++) {
    const m = ms[i]; const at = m && m.receivedAt; if (!at) continue;
    const soort = m.mailbox === 'website-direct' ? 'web' : m.channel === 'email' ? 'mail' : m.channel === 'whatsapp' ? (m.group ? 'groep' : 'een') : '';
    if (soort && (!uit[soort] || at > uit[soort])) uit[soort] = at;
  }
  _binnenCache = { sleutel, uit };
  return uit;
}

export function koppelFeiten() {
  const s = db().settings || {};
  const nu = Date.now();
  const binnen = laatsteBinnen();
  const sinds24u = nu - 24 * UUR;
  const agenda = (() => { try { return agendaInfo(); } catch { return { configured: false, connected: false }; } })();
  const backups = (() => { try { return listBackups(); } catch { return []; } })();
  return {
    nu, test: TEST, health: lastHealth() || {},
    mailIngesteld: !!(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD),
    smtpIngesteld: smtpConfigured(), aiIngesteld: !!process.env.ANTHROPIC_API_KEY,
    imapLaatstOk: s._imapLaatstOk || null,
    laatsteMailIn: binnen.mail, laatsteGroepIn: binnen.groep, laatste1op1In: binnen.een, laatsteWebsiteIn: binnen.web,
    bridge: {
      ooit: !!s.whatsappLastSeen, laatstGezien: s.whatsappLastSeen || null, gepauzeerd: !!s.whatsappPaused,
      herstartRecent: !!s.whatsappRestartAt && nu - new Date(s.whatsappRestartAt).getTime() < 25 * 60000,
    },
    opdrachtGroepen: !!String(Array.isArray(s.whatsappOrderGroups) ? s.whatsappOrderGroups.join('') : (s.whatsappOrderGroups || '')).trim(),
    officieel: { ingesteld: cloudConfigured(), aan: !!(cloudConfigured() && s.whatsappCloudSend !== false) },
    agenda: {
      ingesteld: !!agenda.configured, verbonden: !!agenda.connected, reden: agenda.disconnectReason || '',
      fouten: (db().orders || []).filter((o) => !o.archivedWeek && !o.deletedAt && o.appointmentAt && o.googleSyncError && new Date(o.appointmentAt).getTime() > nu).length,
    },
    mailFouten24u: (db()._mailFailures || []).filter((x) => x && new Date(x.at).getTime() > sinds24u).length,
    outboxMislukt24u: (db().outbox || []).filter((x) => x && x.status === 'failed' && x.group === '__klant_dm__' && !x.dubbel && !/^ingetrokken/i.test(String(x.lastResult || '')) && new Date(x.createdAt || 0).getTime() > sinds24u).length,
    laatsteBackup: backups[0] ? backups[0].at : null,
    schijfVrijMB: (() => { try { const v = diskFreeMB(); return typeof v === 'number' ? v : null; } catch { return null; } })(),
  };
}

export function koppelingenOverzicht() { return beoordeelKoppelingen(koppelFeiten()); }

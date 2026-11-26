// OPMAAK VAN EEN CAMPAGNEMAIL (26 nov 2026, wens eigenaar: "templates zoals in MailerLite of
// Mailchimp, niet heel uitgebreid: 3 vaste — schuifpuien, kozijnonderhoud, sloten/cilinders").
//
// Vier keuzes: alleen tekst (de gewone mail met handtekening) en drie VASTE sjablonen. Een
// sjabloon is: logo, een gekleurde balk met een kop, (optioneel) een eigen foto, de tekst, één
// knop, de bedrijfsgegevens en de afmeldlink. Geen vrij ontwerp: zo ziet elke mail er verzorgd
// uit en kan er niets stuk. De AI kan GEEN afbeeldingen maken; hij kiest alleen een sjabloon en
// schrijft kop, tekst en knoptekst. Een foto komt van de gebruiker zelf.
//
// Dit bestand leest geen database (los te testen).

export const SJABLONEN = [
  { key: 'tekst', naam: 'Alleen tekst (gewone mail)', uitleg: 'Een gewone e-mail met jullie handtekening, zonder opmaak.' },
  { key: 'schuifpui', naam: 'Schuifpuien', uitleg: 'Blauwe kop. Voor onderhoud, afstellen en reparatie van schuifpuien.',
    kleur: '#1f4e9c', zacht: '#eef3fb', kop: 'Loopt uw schuifpui nog soepel?',
    onderwerp: 'Een onderhoudsbeurt voor uw schuifpui',
    tekst: 'Beste {naam},\n\nEen schuifpui die elk jaar even wordt nagekeken en gesmeerd, blijft licht lopen en goed sluiten. Dat voorkomt tocht, slijtage aan de loopwagens en dure reparaties.\n\nWilt u dat wij langskomen voor een onderhoudsbeurt? Bel ons of antwoord op deze e-mail, dan plannen we een moment dat u past.',
    knopTekst: 'Plan een onderhoudsbeurt', knopSoort: 'bel' },
  { key: 'kozijn', naam: 'Kozijnonderhoud', uitleg: 'Groene kop. Voor onderhoud van kozijnen, ramen en deuren: afstellen, smeren, tochtstrips.',
    kleur: '#2f6f4f', zacht: '#edf6f1', kop: 'Klemt er een raam of deur?',
    onderwerp: 'Onderhoud voor uw kozijnen, ramen en deuren',
    tekst: 'Beste {naam},\n\nRamen en deuren die klemmen, tochten of niet meer goed sluiten, zijn meestal met een onderhoudsbeurt weer in orde: hang- en sluitwerk afstellen, smeren en waar nodig de tochtstrips vervangen.\n\nZullen wij uw kozijnen een keer nalopen? Bel ons of antwoord op deze e-mail voor een afspraak.',
    knopTekst: 'Maak een afspraak', knopSoort: 'bel' },
  { key: 'sloten', naam: 'Sloten & cilinders', uitleg: 'Donkere kop met geel accent. Voor sloten, cilinders en inbraakpreventie.',
    kleur: '#1b2330', zacht: '#f6f4ea', accent: '#f2b705', kop: 'Zijn uw sloten nog veilig genoeg?',
    onderwerp: 'Zijn uw sloten nog veilig genoeg?',
    tekst: 'Beste {naam},\n\nEen goed slot met een SKG-keurmerk maakt het een inbreker een stuk lastiger. Oudere cilinders zijn vaak binnen een minuut open; een nieuwe cilinder met kerntrekbeveiliging is snel geplaatst.\n\nWij kijken graag vrijblijvend met u mee of uw sloten nog voldoen. Bel ons of antwoord op deze e-mail.',
    knopTekst: 'Laat uw sloten nakijken', knopSoort: 'bel' },
];
const OP_KEY = new Map(SJABLONEN.map((s) => [s.key, s]));
export const isSjabloon = (key) => OP_KEY.has(key);
export const sjabloonVan = (key) => OP_KEY.get(key) || OP_KEY.get('tekst');
export const KNOP_SOORTEN = ['bel', 'whatsapp', 'mail', 'site', 'geen'];

/** Welk sjabloon past bij een doelgroep (voor de voorstellen uit vaste regels). */
export const sjabloonVoorDoelgroep = (doelgroep) => (['schuifpui', 'onderhoud'].includes(doelgroep) ? 'schuifpui' : doelgroep === 'sloten' ? 'sloten' : 'tekst');

const schoon = (v, max) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim().slice(0, max);
/** Opmaak uit invoer: alleen bekende keuzes, korte teksten. */
export function leesOpmaak(invoer) {
  const i = invoer && typeof invoer === 'object' ? invoer : {};
  const sj = sjabloonVan(isSjabloon(i.sjabloon) ? i.sjabloon : 'tekst');
  if (sj.key === 'tekst') return { sjabloon: 'tekst' };
  return {
    sjabloon: sj.key,
    kop: schoon(i.kop, 90) || sj.kop,
    knopTekst: schoon(i.knopTekst, 40) || sj.knopTekst,
    knopSoort: KNOP_SOORTEN.includes(i.knopSoort) ? i.knopSoort : sj.knopSoort,
  };
}

export const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const cijfers = (s) => String(s || '').replace(/[^\d+]/g, '');
/** Tekst → alinea's (lege regel = nieuwe alinea, enkele regel = regeleinde). Alles ge-escaped. */
export function tekstNaarHtml(tekst) {
  return String(tekst || '').replace(/\r/g, '').split(/\n{2,}/).map((a) => a.trim()).filter(Boolean)
    .map((a) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1b2330">${esc(a).replace(/\n/g, '<br>')}</p>`).join('');
}

/** Waar de knop naartoe gaat. Leeg = geen knop (bv. WhatsApp gekozen maar geen nummer ingesteld). */
export function knopDoel(soort, bedrijf = {}, onderwerp = '') {
  if (soort === 'bel' && cijfers(bedrijf.telefoon)) return `tel:${cijfers(bedrijf.telefoon)}`;
  if (soort === 'whatsapp' && cijfers(bedrijf.whatsapp)) { const n = cijfers(bedrijf.whatsapp).replace(/^\+/, '').replace(/^0(?=6)/, '31'); return `https://wa.me/${n}`; }
  if (soort === 'mail' && bedrijf.email) return `mailto:${bedrijf.email}?subject=${encodeURIComponent(`Re: ${onderwerp || ''}`.trim())}`;
  if (soort === 'site' && bedrijf.website) return /^https?:\/\//i.test(bedrijf.website) ? bedrijf.website : `https://${bedrijf.website}`;
  return '';
}

/**
 * De complete HTML-mail. Tabellen en vaste stijlen: zo ziet hij er in Gmail, Outlook en op de
 * telefoon hetzelfde uit. `tekst` is al ingevuld ({naam} vervangen) en bevat GEEN afmeldregel:
 * die komt onderaan als link.
 * @param {object} in_ { opmaak, onderwerp, tekst, bedrijf:{naam,telefoon,email,website,whatsapp},
 *                       afmeldUrl, logoSrc, fotoSrc, knopUrl }
 * `knopUrl` (optioneel): de knop gaat dan via dit adres (de klikteller), dat doorstuurt naar het
 * echte doel. Zonder doel (bv. geen telefoonnummer ingesteld) is er geen knop, ook niet met knopUrl.
 */
export function bouwCampagneHtml(in_) {
  const { opmaak = {}, onderwerp = '', tekst = '', bedrijf = {}, afmeldUrl = '', logoSrc = '', fotoSrc = '', knopUrl = '' } = in_ || {};
  const sj = sjabloonVan(opmaak.sjabloon);
  if (sj.key === 'tekst') return '';
  const kop = esc(opmaak.kop || sj.kop);
  const doel = knopDoel(opmaak.knopSoort || sj.knopSoort, bedrijf, onderwerp);
  const knopTekst = esc(opmaak.knopTekst || sj.knopTekst);
  const knopKleur = sj.accent || sj.kleur; const knopInkt = sj.accent ? '#1b2330' : '#ffffff';
  const knop = doel && (opmaak.knopSoort || sj.knopSoort) !== 'geen' ? `
        <tr><td style="padding:4px 32px 28px" align="left">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:8px;background:${knopKleur}">
            <a href="${esc(knopUrl || doel)}" style="display:inline-block;padding:14px 26px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:${knopInkt};text-decoration:none;border-radius:8px">${knopTekst}</a>
          </td></tr></table>
        </td></tr>` : '';
  const contact = [bedrijf.telefoon ? `Bel ${esc(bedrijf.telefoon)}` : '', bedrijf.email ? esc(bedrijf.email) : '', bedrijf.website ? esc(bedrijf.website) : ''].filter(Boolean).join(' &nbsp;·&nbsp; ');
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(onderwerp)}</title></head>
<body style="margin:0;padding:0;background:#f1f3f6;-webkit-text-size-adjust:100%">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f3f6"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif">
        ${logoSrc ? `<tr><td style="padding:22px 32px 16px"><img src="${esc(logoSrc)}" alt="${esc(bedrijf.naam || '')}" height="44" style="height:44px;width:auto;display:block;border:0"></td></tr>` : `<tr><td style="padding:22px 32px 16px;font-size:18px;font-weight:bold;color:#1b2330">${esc(bedrijf.naam || '')}</td></tr>`}
        <tr><td style="background:${sj.kleur};padding:26px 32px${sj.accent ? `;border-bottom:5px solid ${sj.accent}` : ''}"><h1 style="margin:0;font-size:26px;line-height:1.25;font-weight:bold;color:#ffffff">${kop}</h1></td></tr>
        ${fotoSrc ? `<tr><td><img src="${esc(fotoSrc)}" alt="" width="600" style="width:100%;max-width:600px;height:auto;display:block;border:0"></td></tr>` : ''}
        <tr><td style="padding:28px 32px 8px">${tekstNaarHtml(tekst)}</td></tr>${knop}
        <tr><td style="background:${sj.zacht};padding:20px 32px;font-size:14px;line-height:1.6;color:#4a5466"><strong style="color:#1b2330">${esc(bedrijf.naam || '')}</strong>${contact ? `<br>${contact}` : ''}</td></tr>
        <tr><td style="padding:16px 32px 22px;font-size:12px;line-height:1.5;color:#8a93a3">U ontvangt deze e-mail omdat u klant bent (geweest) van ${esc(bedrijf.naam || 'ons')}.${afmeldUrl ? ` Liever geen e-mails meer? <a href="${esc(afmeldUrl)}" style="color:#8a93a3;text-decoration:underline">Meld u hier af</a>.` : ''}</td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

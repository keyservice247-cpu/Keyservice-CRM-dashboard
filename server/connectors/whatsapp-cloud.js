// OFFICIËLE WHATSAPP — Meta Cloud API (WhatsApp Business Platform).
//
// Waarom dit bestaat: het CRM praatte tot nu toe met WhatsApp via een onofficiële
// bridge (whatsapp-web.js) op een wegwerpnummer. Op 2 augustus 2026 blokkeerde
// WhatsApp dat nummer tijdelijk wegens "geautomatiseerde berichten". De officiële
// route is gebouwd voor precies dit gebruik en levert geen blokkade op.
//
// STAAT STANDAARD UIT. Zolang de drie omgevingsvariabelen niet zijn ingevuld doet dit
// bestand niets en blijft alles lopen zoals het liep:
//   WHATSAPP_CLOUD_TOKEN     permanent access token van de Meta-app
//   WHATSAPP_PHONE_ID        het "Phone number ID" van het geregistreerde nummer
//   WHATSAPP_APP_SECRET      app secret — nodig om binnenkomende webhooks te controleren
//
// BELANGRIJK VOOR DE KOSTEN EN DE REGELS: binnen 24 uur na een bericht van de klant mag
// je vrij terugschrijven (gratis). Daarbuiten moet het een vooraf goedgekeurd SJABLOON
// zijn (betaald). Deze module ondersteunt beide; de keuze maakt de aanroeper.
import crypto from 'node:crypto';

const API = 'https://graph.facebook.com/v21.0';

export function cloudConfigured() {
  return !!(process.env.WHATSAPP_CLOUD_TOKEN && process.env.WHATSAPP_PHONE_ID);
}

function telefoonNaarWaId(nummer) {
  // WhatsApp wil het nummer in internationale vorm zonder plus of streepjes.
  // Nederlandse invoer is meestal 06… of +316…; beide worden 316….
  const cijfers = String(nummer || '').replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (/^0[1-9]/.test(cijfers)) return `31${cijfers.slice(1)}`;
  if (/^0031/.test(cijfers)) return `31${cijfers.slice(4)}`;
  return cijfers;
}

async function post(pad, body) {
  const resp = await fetch(`${API}/${pad}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.WHATSAPP_CLOUD_TOKEN}` },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const uitleg = json?.error?.message || `HTTP ${resp.status}`;
    const err = new Error(`WhatsApp (Meta) weigerde het bericht: ${uitleg}`);
    err.metaCode = json?.error?.code;
    throw err;
  }
  return json;
}

// Vrij tekstbericht — mag ALLEEN binnen 24 uur na een bericht van de klant.
export async function sendCloudText(nummer, tekst) {
  if (!cloudConfigured()) throw new Error('Officiële WhatsApp is nog niet ingesteld op de server.');
  return post(`${process.env.WHATSAPP_PHONE_ID}/messages`, {
    messaging_product: 'whatsapp',
    to: telefoonNaarWaId(nummer),
    type: 'text',
    text: { preview_url: true, body: String(tekst || '').slice(0, 4000) },
  });
}

// Sjabloonbericht — nodig buiten het 24-uursvenster. `variabelen` vult {{1}}, {{2}}, …
export async function sendCloudTemplate(nummer, sjabloon, variabelen = [], taal = 'nl') {
  if (!cloudConfigured()) throw new Error('Officiële WhatsApp is nog niet ingesteld op de server.');
  const componenten = variabelen.length
    ? [{ type: 'body', parameters: variabelen.map((v) => ({ type: 'text', text: String(v).slice(0, 200) })) }]
    : [];
  return post(`${process.env.WHATSAPP_PHONE_ID}/messages`, {
    messaging_product: 'whatsapp',
    to: telefoonNaarWaId(nummer),
    type: 'template',
    template: { name: sjabloon, language: { code: taal }, components: componenten },
  });
}

// Document (bv. een factuur-PDF) of foto meesturen. `url` moet openbaar bereikbaar zijn.
export async function sendCloudMedia(nummer, { url, filename = '', caption = '', soort = 'document' }) {
  if (!cloudConfigured()) throw new Error('Officiële WhatsApp is nog niet ingesteld op de server.');
  const veld = soort === 'image' ? 'image' : 'document';
  const inhoud = soort === 'image' ? { link: url, caption } : { link: url, filename: filename || 'bestand.pdf', caption };
  return post(`${process.env.WHATSAPP_PHONE_ID}/messages`, {
    messaging_product: 'whatsapp', to: telefoonNaarWaId(nummer), type: veld, [veld]: inhoud,
  });
}

// HANDTEKENING-CONTROLE op binnenkomende webhooks. Dit is precies wat de oude
// Cloud-API-route miste, waardoor iedereen berichten in de wachtrij kon zetten.
// Meta ondertekent de RUWE body met het app secret; we vergelijken in constante tijd.
export function webhookSignatureOk(ruweBody, handtekeningHeader) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return false;                       // geen secret = niets vertrouwen
  const gegeven = String(handtekeningHeader || '');
  if (!gegeven.startsWith('sha256=')) return false;
  const eigen = 'sha256=' + crypto.createHmac('sha256', secret).update(ruweBody).digest('hex');
  const a = Buffer.from(eigen);
  const b = Buffer.from(gegeven);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Meta's webhook-formaat omzetten naar ons standaardformaat, zodat een binnengekomen
// bericht exact dezelfde weg door het CRM aflegt als een bericht van de bridge.
export function parseCloudWebhook(body) {
  const uit = [];
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      const waarde = change.value || {};
      const namen = new Map((waarde.contacts || []).map((c) => [c.wa_id, c.profile?.name || '']));
      for (const m of waarde.messages || []) {
        const van = m.from || '';
        const tekst = m.text?.body
          || m.button?.text
          || m.interactive?.list_reply?.title
          || m.interactive?.button_reply?.title
          || m.image?.caption || m.document?.caption || m.video?.caption || '';
        uit.push({
          externalId: m.id,
          fromPhone: van.startsWith('31') ? `0${van.slice(2)}` : van,
          sender: namen.get(van) || van,
          body: tekst,
          soort: m.type,
          mediaId: m.image?.id || m.document?.id || m.audio?.id || m.video?.id || null,
          mime: m.image?.mime_type || m.document?.mime_type || m.audio?.mime_type || m.video?.mime_type || '',
          filename: m.document?.filename || '',
          at: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString(),
        });
      }
    }
  }
  return uit;
}

// ZELFTEST: klopt de koppeling écht? Vraagt bij Meta het geregistreerde nummer op.
// Zo weet je zeker of het token, het phone-id én de rechten kloppen — in plaats van te
// wachten tot een klantbericht stilletjes mislukt.
export async function cloudSelftest() {
  const uit = { token: !!process.env.WHATSAPP_CLOUD_TOKEN, phoneId: !!process.env.WHATSAPP_PHONE_ID, appSecret: !!process.env.WHATSAPP_APP_SECRET };
  if (!uit.token || !uit.phoneId) {
    uit.ok = false;
    uit.uitleg = 'Nog niet compleet ingesteld op de server. Vul in Render de ontbrekende waarde(n) in.';
    return uit;
  }
  try {
    const resp = await fetch(`${API}/${process.env.WHATSAPP_PHONE_ID}?fields=display_phone_number,verified_name,quality_rating,platform_type`, {
      headers: { authorization: `Bearer ${process.env.WHATSAPP_CLOUD_TOKEN}` },
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      uit.ok = false;
      const code = json?.error?.code;
      uit.uitleg = code === 190
        ? 'Meta weigert het token (verlopen of ingetrokken). Maak in Bedrijfsinstellingen → Systeemgebruikers een nieuw token met vervaldatum "Nooit" en zet dat in Render.'
        : code === 100
        ? 'Meta kent dit telefoonnummer-ID niet, of de systeemgebruiker heeft geen toegang tot dit WhatsApp-account. Controleer het Phone number ID en of het WhatsApp-account aan de systeemgebruiker is toegewezen met "Volledige controle".'
        : `Meta antwoordde: ${json?.error?.message || `HTTP ${resp.status}`}`;
      return uit;
    }
    uit.ok = true;
    uit.nummer = json.display_phone_number || '';
    uit.naam = json.verified_name || '';
    uit.kwaliteit = json.quality_rating || '';
    uit.uitleg = `Verbonden met ${uit.nummer}${uit.naam ? ` (${uit.naam})` : ''}.`;
    if (!uit.appSecret) uit.uitleg += ' LET OP: WHATSAPP_APP_SECRET ontbreekt nog — zonder die waarde komen binnenkomende berichten van klanten niet binnen.';
    // ONTVANGST-ABONNEMENT controleren en zo nodig REPAREREN (12 aug 2026).
    // Meta stuurt echte klantberichten alleen door als het WhatsApp-account aan de app
    // is gekoppeld ("subscribed app"). Is het account via Business Manager aangemaakt
    // (zoals hier), dan ontbreekt die koppeling vaak — met precies dit symptoom: de
    // test-webhook komt aan, echte berichten nooit. De WABA-id's halen we uit het
    // token zelf (debug_token), daarna koppelen we de app aan elk account.
    try {
      const kop = { authorization: `Bearer ${process.env.WHATSAPP_CLOUD_TOKEN}` };
      const dbg = await fetch(`${API}/debug_token?input_token=${encodeURIComponent(process.env.WHATSAPP_CLOUD_TOKEN)}`, { headers: kop })
        .then((r) => r.json()).catch(() => null);
      const wabas = new Set();
      for (const gs of dbg?.data?.granular_scopes || []) {
        if (/whatsapp_business/.test(gs.scope || '')) (gs.target_ids || []).forEach((x) => wabas.add(String(x)));
      }
      uit.abonnement = [];
      for (const waba of wabas) {
        const sub = await fetch(`${API}/${waba}/subscribed_apps`, { headers: kop }).then((r) => r.json()).catch(() => null);
        const al = (sub?.data || []).length > 0;
        if (al) { uit.abonnement.push({ account: waba, status: 'stond al goed' }); continue; }
        const fix = await fetch(`${API}/${waba}/subscribed_apps`, { method: 'POST', headers: kop }).then((r) => r.json()).catch(() => null);
        uit.abonnement.push({ account: waba, status: fix?.success ? 'GEREPAREERD — ontvangst staat nu aan' : `repareren mislukt: ${fix?.error?.message || 'onbekend'}` });
      }
      if (uit.abonnement.some((a) => /GEREPAREERD/.test(a.status))) {
        uit.uitleg += ' Het ontvangst-abonnement ontbrak en is nu gerepareerd — stuur een nieuw testbericht naar het nummer.';
      }
    } catch { /* reparatie is een extraatje; de basis-uitslag blijft staan */ }
    return uit;
  } catch (e) {
    uit.ok = false;
    uit.uitleg = `Kon Meta niet bereiken: ${String(e.message || '').slice(0, 120)}`;
    return uit;
  }
}

// STATUS-MELDINGEN uit de webhook: Meta zegt bij het versturen alleen "aangenomen".
// Of het bericht écht is BEZORGD — of geweigerd (bv. buiten het 24-uursvenster,
// code 131047) — komt pas daarna binnen als status-update. Wie die negeert, toont
// "verstuurd" terwijl de klant niets kreeg. Deze functie haalt ze uit de payload.
export function parseCloudStatuses(body) {
  const uit = [];
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      for (const st of change.value?.statuses || []) {
        const fout = (st.errors || [])[0] || {};
        uit.push({
          id: st.id || '',
          status: st.status || '',
          code: fout.code || null,
          detail: fout.error_data?.details || fout.message || fout.title || '',
        });
      }
    }
  }
  return uit;
}

// Een meegestuurd bestand ophalen (twee stappen bij Meta: eerst de URL, dan het bestand).
export async function fetchCloudMedia(mediaId) {
  if (!cloudConfigured() || !mediaId) return null;
  const kop = { authorization: `Bearer ${process.env.WHATSAPP_CLOUD_TOKEN}` };
  const meta = await fetch(`${API}/${mediaId}`, { headers: kop }).then((r) => r.json()).catch(() => null);
  if (!meta?.url) return null;
  const bestand = await fetch(meta.url, { headers: kop });
  if (!bestand.ok) return null;
  return { buffer: Buffer.from(await bestand.arrayBuffer()), mime: meta.mime_type || 'application/octet-stream' };
}

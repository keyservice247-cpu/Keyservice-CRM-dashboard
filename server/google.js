// Google Agenda 2-weg koppeling (OAuth) — zet afspraken automatisch in Google
// Calendar zodra ze in het dashboard worden ingepland/gewijzigd/geannuleerd.
//
// Werkwijze: het kantoor verbindt ÉÉN Google-account via OAuth. De refresh-token
// wordt bewaard in db().settings.google. Per monteur kun je een agenda (calendarId)
// toewijzen; een afspraak van die monteur komt dan in zijn/haar agenda. Opdrachten
// zonder (gekoppelde) monteur gaan naar de standaardagenda.
//
// Aanzetten via .env / Render:
//   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
//   GOOGLE_CLIENT_SECRET=...
//   APP_URL=https://keyservice-crm.onrender.com   (basis-URL voor de OAuth-redirect)
//
// Gebruikt alleen fetch — geen extra npm-pakket nodig.
import { db, save, saveSoon, now } from './db.js';
import { getGoogleSync } from './settings.js';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'openid',
  'email',
].join(' ');

const TIMEZONE = 'Europe/Amsterdam';

// ---------- Welke opdrachten horen in Google Agenda ----------
// Op verzoek: ALLEEN opdrachten van monteur Abdel Rafour, OF schuifpui-/schuifdeur-
// opdrachten (herkenbaar aan de titel/omschrijving). Alle andere opdrachten worden
// NIET naar Google gesynct (en een bestaand event wordt weer verwijderd).
// Pas de monteurnaam of de trefwoorden hieronder aan als de regels veranderen.
const GOOGLE_SYNC_MONTEUR = 'abdel';                        // monteurnaam bevat dit (kleine letters)
const GOOGLE_SYNC_KEYWORDS = /schuifpui|schuifdeur|schuifwand|schuifsysteem/i;

export function shouldSyncToGoogle(order, monteur) {
  const cfg = getGoogleSync();
  if (cfg.mode === 'alles') return true;
  const text = `${order.title || ''} ${order.description || ''}`;
  const woorden = cfg.keywords.split(',').map((w) => w.trim()).filter(Boolean);
  const opSchuifpui = () => woorden.some((w) => text.toLowerCase().includes(w.toLowerCase()));
  const opMonteur = () => {
    if (cfg.monteurIds.length) return !!(order.monteurId && cfg.monteurIds.includes(order.monteurId));
    // Geen monteurs gekozen? Dan de oude vangrail: naam bevat "abdel".
    return ((monteur && monteur.name) || '').toLowerCase().includes(GOOGLE_SYNC_MONTEUR);
  };
  if (cfg.mode === 'schuifpui') return opSchuifpui();
  if (cfg.mode === 'monteurs') return opMonteur();
  return opMonteur() || opSchuifpui(); // 'monteurs+schuifpui' (het oude gedrag)
}

// Haalt de plaatsnaam uit een adres (tekst na de postcode, of het laatste deel).
// Zelfde logica als in de frontend, zodat de Google-titel altijd met de plaats begint.
function placeName(addr) {
  if (!addr) return '';
  const s = String(addr).trim();
  const m = s.match(/\d{4}\s?[a-z]{2}\s+(.+)$/i);
  if (m) return m[1].replace(/,.*$/, '').trim();
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : s;
}

// ---------- Configuratie / status ----------
export function googleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function appBaseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  if (req) {
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (host) return `${proto}://${host}`;
  }
  return 'http://localhost:3000';
}

export function getRedirectUri(req) {
  return `${appBaseUrl(req)}/api/google/callback`;
}

function gstore() {
  const s = db().settings;
  if (!s.google) s.google = {};
  return s.google;
}

export function isConnected() {
  return googleConfigured() && !!gstore().refreshToken;
}

// Veilige status voor de frontend (nooit de tokens zelf meesturen).
// Herkent het "elke week opnieuw koppelen"-patroon. Google trekt een refresh-token na
// 7 dagen in zolang de OAuth-toestemmingspagina op TESTING staat; verbreekt de koppeling
// dus herhaaldelijk met ongeveer een week ertussen, dan is dát vrijwel zeker de oorzaak
// — en niet iets in dit CRM. Zo kunnen we de gebruiker de échte oplossing tonen.
export function testingModusVermoeden(history = []) {
  const tijden = (history || []).map((t) => new Date(t).getTime()).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (tijden.length < 2) return false;
  // Minstens één tussenpoos van 3 tot 10 dagen = het 7-dagen-ritme van Testing-modus.
  for (let i = 1; i < tijden.length; i++) {
    const dagen = (tijden[i] - tijden[i - 1]) / 86400000;
    if (dagen >= 3 && dagen <= 10) return true;
  }
  return false;
}

export function connectionInfo() {
  const g = gstore();
  return {
    configured: googleConfigured(),
    connected: isConnected(),
    email: g.email || '',
    connectedAt: g.connectedAt || '',
    defaultCalendarId: g.defaultCalendarId || 'primary',
    disconnectReason: g.disconnectReason || '',
    disconnectCount: (g.disconnectHistory || []).length,
    lastDisconnectAt: (g.disconnectHistory || []).slice(-1)[0] || '',
    // Waarschijnlijk de 7-dagen-limiet van een niet-gepubliceerde Google-app.
    testingVermoeden: testingModusVermoeden(g.disconnectHistory),
  };
}

export function getDefaultCalendarId() {
  return gstore().defaultCalendarId || 'primary';
}

export function setDefaultCalendarId(calId) {
  gstore().defaultCalendarId = calId || 'primary';
  save();
}

// ---------- OAuth-flow ----------
export function getAuthUrl(req, state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: getRedirectUri(req),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent', // forceer refresh_token, ook bij herverbinden
    state: state || '',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCode(code, req) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: getRedirectUri(req),
    grant_type: 'authorization_code',
  });
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error_description || json.error || `token-fout ${resp.status}`);
  const g = gstore();
  if (json.refresh_token) g.refreshToken = json.refresh_token; // bij herverbinden soms leeg
  g.connectedAt = now();
  // E-mailadres van het verbonden account ophalen (handig om te tonen).
  try {
    if (json.access_token) {
      const ui = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { authorization: `Bearer ${json.access_token}` },
      }).then((r) => r.json());
      if (ui && ui.email) g.email = ui.email;
    }
  } catch { /* niet kritiek */ }
  if (!g.defaultCalendarId) g.defaultCalendarId = 'primary';
  delete g.disconnectReason; // opnieuw verbonden -> eventueel alarm opheffen
  save();
  return { ok: true, email: g.email || '' };
}

// reason: alleen gezet bij een AUTOMATISCHE verbreking (token ingetrokken/verlopen).
// De watchdog slaat daar alarm op; een handmatige ontkoppeling (knop) blijft stil.
export function disconnect(reason) {
  const g = gstore();
  delete g.refreshToken;
  delete g.email;
  delete g.connectedAt;
  if (reason) g.disconnectReason = reason; else delete g.disconnectReason;
  save();
}

// Pure beslis-logica voor het koppeling-alarm (testbaar, zelfde stijl als
// healthAlarmDecision): alarm bij een nieuwe automatische verbreking, herstel-
// melding zodra er weer verbonden is.
export function calendarAlarmDecision({ disconnectReason, alerted }) {
  return { alert: !!disconnectReason && !alerted, recover: !disconnectReason && !!alerted };
}

// Korte cache van het access-token (verloopt na ~1 uur).
let _tok = { value: '', exp: 0 };
async function getAccessToken() {
  if (!isConnected()) throw new Error('Google Agenda is niet verbonden');
  if (_tok.value && Date.now() < _tok.exp - 60000) return _tok.value;
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: gstore().refreshToken,
    grant_type: 'refresh_token',
  });
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  const json = await resp.json();
  if (!resp.ok) {
    // Token ingetrokken / ongeldig → koppeling als verbroken beschouwen. De reden
    // blijft bewaard zodat de watchdog er een melding van maakt (stil verbreken mag niet).
    if (json.error === 'invalid_grant') {
      // OORZAAK VASTLEGGEN (7 aug 2026). "Elke keer opnieuw koppelen" heeft bijna
      // altijd één oorzaak: staat de OAuth-toestemmingspagina in Google Cloud nog op
      // TESTING, dan trekt Google het refresh-token na 7 DAGEN in. Publiceren ("In
      // production") maakt het permanent. We houden daarom bij wanneer de koppeling
      // verbrak, zodat we dat patroon kunnen herkennen en benoemen i.p.v. steeds
      // hetzelfde "verbind opnieuw" te tonen.
      const g = gstore();
      g.disconnectHistory = [...(g.disconnectHistory || []), new Date().toISOString()].slice(-6);
      disconnect('Google heeft de toegang ingetrokken of het token is verlopen');
      throw new Error('Google-koppeling verlopen — opnieuw verbinden in Instellingen');
    }
    throw new Error(json.error_description || json.error || `token-fout ${resp.status}`);
  }
  _tok = { value: json.access_token, exp: Date.now() + (json.expires_in || 3600) * 1000 };
  return _tok.value;
}

async function gapi(method, url, payload) {
  const token = await getAccessToken();
  const resp = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (resp.status === 204) return {};
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error((json.error && json.error.message) || `Google API ${resp.status}`);
    err.status = resp.status; // zodat de sync een verdwenen event (404/410) kan herkennen
    throw err;
  }
  return json;
}

// Zoek een bestaand event van deze opdracht (op ksOrderId). Maakt het aanmaken
// idempotent: ook als de kaart z'n event-verwijzing kwijt is (bv. na een database-
// terugzetting) vinden we het event terug i.p.v. een dubbel aan te maken.
async function findEventByOrderId(calId, orderId) {
  try {
    const out = await gapi('GET', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?privateExtendedProperty=${encodeURIComponent(`ksOrderId=${orderId}`)}&maxResults=2&showDeleted=false`);
    return (out.items || [])[0] || null;
  } catch { return null; }
}

// ---------- Agenda's ----------
export async function listCalendars() {
  const out = await gapi('GET', 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250');
  return (out.items || []).map((c) => ({
    id: c.id, name: c.summary || c.id,
    primary: !!c.primary, role: c.accessRole || '',
  }));
}

// ---------- Tijd ----------
// appointmentAt is een lokale (NL) tijd zonder tijdzone, bv "2026-06-23T14:00".
// We geven Google de wandklok-tijd + timeZone, zodat de tijd klopt zoals ingevoerd.
function wallClock(dtstr, addMin = 0) {
  const m = String(dtstr).match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  d.setUTCMinutes(d.getUTCMinutes() + addMin);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00`;
}

function buildEventBody(order, customer) {
  const start = wallClock(order.appointmentAt);
  // Eindtijd: gebruik de opgegeven eindtijd als die ná de begintijd ligt, anders +1 uur.
  let end = order.appointmentEndAt ? wallClock(order.appointmentEndAt) : null;
  if (!end || end <= start) end = wallClock(order.appointmentAt, 60);
  const descParts = [];
  if (customer.phone) descParts.push('Tel: ' + customer.phone);
  if (customer.email) descParts.push('E-mail: ' + customer.email);
  if (order.description) descParts.push(order.description);
  if (order.price) descParts.push('Prijs: ' + order.price);
  descParts.push('— Keyservice CRM');
  // Titel begint ALTIJD met de plaatsnaam (als die bekend is), daarna de opdracht + klant.
  const place = placeName(customer.address);
  const summary = `${place ? place + ' — ' : ''}${order.title}${customer.name ? ' — ' + customer.name : ''}`;
  return {
    summary,
    location: customer.address || '',
    description: descParts.join('\n'),
    start: { dateTime: start, timeZone: TIMEZONE },
    end: { dateTime: end, timeZone: TIMEZONE },
    extendedProperties: { private: { ksOrderId: order.id } },
  };
}

async function deleteEvent(calId, eventId) {
  await gapi('DELETE', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`);
}

// ---------- Hoofd-sync ----------
// Zorgt dat Google Calendar overeenkomt met de opdracht: maakt/wijzigt/verwijdert
// het event. Best-effort: faalt dit, dan blijft het dashboard gewoon werken.
export async function syncOrderToGoogle(order) {
  if (!isConnected() || !order) return;
  try {
    const customer = db().customers.find((c) => c.id === order.customerId) || {};
    const monteur = order.monteurId ? db().monteurs.find((m) => m.id === order.monteurId) : null;
    const targetCal = (monteur && monteur.calendarId) || getDefaultCalendarId();
    // Alleen Abdel Rafour + schuifpui-opdrachten horen in Google Agenda (zie boven).
    const shouldExist = shouldSyncToGoogle(order, monteur)
      && !!order.appointmentAt && order.status !== 'geannuleerd' && !order.archivedWeek;
    const existing = order.googleEvent; // { calendarId, eventId }

    if (!shouldExist) {
      if (existing && existing.eventId) {
        await deleteEvent(existing.calendarId, existing.eventId).catch(() => {});
        order.googleEvent = null;
        order.googleSyncedAt = now();
        saveSoon();
      }
      return;
    }

    // Monteur (en dus agenda) gewijzigd? Verwijder het oude event eerst.
    if (existing && existing.eventId && existing.calendarId !== targetCal) {
      await deleteEvent(existing.calendarId, existing.eventId).catch(() => {});
      order.googleEvent = null;
    }

    const body = buildEventBody(order, customer);
    if (order.googleEvent && order.googleEvent.eventId) {
      try {
        await gapi('PATCH', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCal)}/events/${encodeURIComponent(order.googleEvent.eventId)}`, body);
      } catch (e) {
        // ZELFHERSTEL: verwijst de kaart naar een event dat niet (meer) bestaat
        // (bv. handmatig verwijderd of na een database-terugzetting), dan bleef de
        // sync vroeger voor altijd stil falen. Nu: verwijzing weggooien en hieronder
        // gewoon een nieuw event aanmaken.
        if (e.status === 404 || e.status === 410) order.googleEvent = null;
        else throw e;
      }
    }
    if (!order.googleEvent || !order.googleEvent.eventId) {
      // Eerst kijken of er al een event van déze opdracht bestaat (idempotent):
      // gevonden -> bijwerken i.p.v. een dubbele afspraak in de agenda zetten.
      const bestaand = await findEventByOrderId(targetCal, order.id);
      if (bestaand) {
        await gapi('PATCH', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCal)}/events/${encodeURIComponent(bestaand.id)}`, body);
        order.googleEvent = { calendarId: targetCal, eventId: bestaand.id };
      } else {
        const ev = await gapi('POST', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCal)}/events`, body);
        order.googleEvent = { calendarId: targetCal, eventId: ev.id };
      }
    }
    order.googleSyncedAt = now();
    order.googleSyncError = null;
    saveSoon();
  } catch (e) {
    order.googleSyncError = e.message;
    saveSoon();
    console.error('[google] sync mislukt voor opdracht', order.id, '-', e.message);
  }
}

// Verwijder het Google-event van een opdracht (bij prullenbak/definitief weg).
export async function removeOrderFromGoogle(order) {
  if (!isConnected() || !order || !order.googleEvent || !order.googleEvent.eventId) return;
  try {
    await deleteEvent(order.googleEvent.calendarId, order.googleEvent.eventId);
    order.googleEvent = null;
    saveSoon();
  } catch (e) {
    console.error('[google] verwijderen event mislukt voor', order.id, '-', e.message);
  }
}

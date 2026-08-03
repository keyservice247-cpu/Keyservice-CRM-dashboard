// ---------- Helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Dunne outline-iconen (Lucide-stijl) — strak en zakelijk, geen emoji.
const ICON_PATHS = {
  whatsapp: '<path d="M3 21l1.7-5A8 8 0 1 1 8 19.3z"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  pin: '<path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  phone: '<path d="M5 4h3l1.5 5-2 1.5a11 11 0 0 0 5 5l1.5-2 5 1.5V19a2 2 0 0 1-2 2A16 16 0 0 1 4 6a2 2 0 0 1 1-2z"/>',
  tag: '<path d="M3 7v5l8 8 6-6-8-8H3z"/><circle cx="7" cy="11" r="1"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 1 5.4-5.4l-2.5 2.5-2-2 2.5-2.5z"/>',
  bolt: '<path d="M13 3 4 14h6l-1 7 9-11h-6z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>',
  paperclip: '<path d="M21 11.5 12 20a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7-7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 2.5-5 6-5s6 2 6 5"/><path d="M16 5.5a3 3 0 0 1 0 5.5"/>',
  message: '<path d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-6.5A8 8 0 1 1 21 12z"/>',
  reply: '<path d="M9 7 4 12l5 5"/><path d="M4 12h11a5 5 0 0 1 5 5v1"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18 9l-4.2 1.3L12 15l-1.8-4.7L6 9l4.2-1.3z"/><path d="M18 14l.8 2 .2.8-2-.8z"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  box: '<path d="m3 7 9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 0M7 21c0-5 10-5 10 0"/>',
  merge: '<path d="M7 21V8M7 8 4 11M7 8l3 3"/><path d="M17 21v-7a4 4 0 0 0-4-4H7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  activity: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  'chevron-left': '<path d="M15 5l-7 7 7 7"/>',
  'chevron-right': '<path d="M9 5l7 7-7 7"/>',
};
function icon(name, size = 16) {
  const p = ICON_PATHS[name];
  if (!p) return '';
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}
// Outline-icoon dat past bij een herkomst-bron (whatsapp/mail/telefoon/overig).
function sourceIcon(label) {
  const l = (label || '').toLowerCase();
  if (l.includes('groep') || l.includes('whatsapp') || l.includes('app')) return icon('whatsapp');
  if (l.includes('mail')) return icon('mail');
  if (l.includes('telefoon') || l.includes('bel')) return icon('phone');
  return icon('tag');
}

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { window.location.href = '/'; return; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Er ging iets mis');
  return data;
}

function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' err' : '');
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 3000);
}

// Toast met een "Ongedaan maken"-knop die een actie terugdraait. Verdwijnt na ms (default 8s).
function toastUndo(msg, undoFn, ms = 8000) {
  const t = $('#toast');
  t.className = 'toast';
  t.innerHTML = `<span>${esc(msg)}</span><button type="button" class="toast-undo">Ongedaan maken</button>`;
  t.hidden = false;
  clearTimeout(toast._t);
  const close = () => { t.hidden = true; t.textContent = ''; };
  toast._t = setTimeout(close, ms);
  const btn = $('.toast-undo', t);
  if (btn) btn.onclick = async () => { clearTimeout(toast._t); close(); try { await undoFn(); } catch (e) { toast(e.message, true); } };
}

// Bouwt een "Zet in Google Agenda"-link (opent Google met een vooraf ingevuld event).
// De afspraaktijd is lokale NL-tijd; we geven 'm zo door + ctz=Europe/Amsterdam zodat
// Google de juiste tijd toont (geen UTC-verschuiving).
function googleCalUrl({ title, at, end, details, location }) {
  const m = String(at || '').match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return '#';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  const p = (n) => String(n).padStart(2, '0');
  const fmt = (dt) => `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}T${p(dt.getUTCHours())}${p(dt.getUTCMinutes())}00`;
  // Eindtijd: gebruik de opgegeven eindtijd als die geldig is en ná de begintijd ligt,
  // anders standaard +1 uur.
  const em = String(end || '').match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  let endDt = em ? new Date(Date.UTC(+em[1], +em[2] - 1, +em[3], +em[4], +em[5])) : null;
  if (!endDt || endDt.getTime() <= d.getTime()) endDt = new Date(d.getTime() + 60 * 60000);
  const pr = new URLSearchParams({
    action: 'TEMPLATE',
    text: title || 'Keyservice afspraak',
    dates: `${fmt(d)}/${fmt(endDt)}`,
    details: details || '',
    location: location || '',
    ctz: 'Europe/Amsterdam',
  });
  return 'https://calendar.google.com/calendar/render?' + pr.toString();
}

// Verwijderde opdracht(en) terughalen uit de prullenbak (voor de undo-knop).
async function restoreOrders(ids) {
  for (const id of ids) { try { await api(`/api/trash/${id}/restore`, 'POST'); } catch { /* al weg */ } }
  toast(ids.length > 1 ? `${ids.length} teruggehaald` : 'Teruggehaald');
  loadBoard();
}

// Herkomst-bron: rustige kleurklasse (pill) op basis van trefwoorden in de naam.
// Geen emoji-iconen (conform design-systeem) — alleen een subtiele kleur.
function sourceMeta(label) {
  const l = (label || '').toLowerCase();
  if (l.includes('groep')) return { icon: '', cls: 'src-groep' };
  if (l.includes('whatsapp') || l.includes('app')) return { icon: '', cls: 'src-whatsapp' };
  if (l.includes('mail')) return { icon: '', cls: 'src-email' };
  if (l.includes('telefoon') || l.includes('bel')) return { icon: '', cls: 'src-telefoon' };
  return { icon: '', cls: '' };
}

// Label voor het "afkomstig uit groep"-chipje. De vertrouwde "Raf Breda"-groep
// houdt het korte label "DRS"; andere opdracht-groepen (bv. "opdrachten tilburg
// omgeving") tonen hun ÉCHTE groepsnaam i.p.v. verkeerd "DRS".
function orderGroupLabel(o) {
  const g = String(o.originGroup || '').trim();
  if (!g) return 'Opdrachtgroep';
  const gl = g.toLowerCase();
  if (gl.includes('raf breda') || gl.includes('drs')) return 'DRS';
  return g.length > 24 ? g.slice(0, 22) + '…' : g;
}

// Bepaalt via welk kanaal een opdracht binnenkwam (voor de hoofdmenu's E-mail / WhatsApp).
function orderChannel(o) {
  const l = (o.source || '').toLowerCase();
  if (l.includes('mail')) return 'email';
  if (l.includes('whatsapp') || l.includes('app') || l.includes('groep')) return 'whatsapp';
  return 'other';
}

// ---------- State ----------
const state = { me: null, meta: null, monteurs: [], orders: [], view: 'board', channel: 'all' };

const statusLabel = (key) => (state.meta.statusLabels && state.meta.statusLabels[key]) || key;
const statusColor = (key) => {
  const s = (state.meta.statuses || []).find((x) => x.key === key);
  return s ? s.color : '#94a3b8';
};

// ---------- Rechten (spiegel van server/auth.js) ----------
// Rol = basisprofiel; de beheerder kan per gebruiker functies aan/uit zetten.
const ROLE_PERM_DEFAULTS = {
  admin:     { inbox: true,  orders: true,  deleteOrders: true,  customers: true,  invoicesAll: true,  finance: true,  system: true,  settings: true,  hardDelete: true },
  assistent: { inbox: true,  orders: true,  deleteOrders: true,  customers: true,  invoicesAll: true,  finance: false, system: false, settings: false, hardDelete: false },
  monteur:   { inbox: false, orders: false, deleteOrders: false, customers: false, invoicesAll: false, finance: false, system: false, settings: false, hardDelete: false },
};
function hasPerm(key) {
  if (!state.me) return false;
  if (state.me.role === 'admin') return true;
  const o = state.me.perms && typeof state.me.perms[key] === 'boolean' ? state.me.perms[key] : undefined;
  if (o !== undefined) return o;
  return !!(ROLE_PERM_DEFAULTS[state.me.role] || {})[key];
}

// ---------- Init ----------
(async function init() {
  const me = await api('/api/me');
  if (!me || !me.user) { window.location.href = '/'; return; }
  state.me = me.user; state.meta = me.meta;
  $('#userName').textContent = `${me.user.name} · ${me.user.role}`;
  $('#avatar').textContent = (me.user.name || '?').trim().charAt(0).toUpperCase();
  $('#aiMode').textContent = me.meta.aiMode === 'ai' ? 'AI actief' : 'AI: demo';

  // Admin-onderdelen: weg voor wie het recht niet heeft. Een element met
  // data-need="finance" (enz.) blijft staan als dat recht per gebruiker aanstaat.
  if (me.user.role !== 'admin') $$('.admin-only').forEach((el) => { const need = el.dataset.need; if (!need || !hasPerm(need)) el.remove(); });
  if (me.user.role === 'monteur') {
    $$('.perm-write').forEach((el) => (el.hidden = true));
    // Monteur ziet alleen zijn eigen werk: Opdrachten + Agenda + eigen Facturen
    // (+ Inbox als de beheerder dat recht heeft aangezet).
    const monteurAllowed = ['board', 'agenda', 'invoices'];
    if (hasPerm('inbox')) monteurAllowed.push('inbox');
    $$('.nav-item, .bn-item').forEach((el) => { if (!monteurAllowed.includes(el.dataset.view)) el.hidden = true; });
  }

  bindNav();
  bindButtons();
  // Monteur start op zijn opdrachten (Overzicht is voor hem verborgen).
  if (me.user.role === 'monteur') goView('board');
  await refreshAll();
  // Terugkomst van de Google Agenda-koppeling.
  try {
    const gp = new URLSearchParams(location.search).get('google');
    if (gp) {
      history.replaceState({}, '', location.pathname);
      if (gp === 'verbonden') { toast('Google Agenda verbonden'); goView('settings'); }
      else if (gp === 'geweigerd') toast('Google-koppeling geweigerd', true);
      else if (gp === 'fout') toast('Google-koppeling mislukt — probeer opnieuw', true);
    }
  } catch { /* geen probleem */ }
  refreshWaStatus();
  setInterval(refreshWaStatus, 60000);
  startLiveUpdates();
  maybeMorningDigest();
})();

// Voorkeur: opent de status-scan elke ochtend vanzelf? STANDAARD UIT. Het venster
// popte vroeger elke dag ongevraagd open en was nergens uit te zetten; nu kiest de
// gebruiker dat zelf (vinkje in de status-scan zelf, opgeslagen in de browser).
function digestAutoOn() {
  try { return localStorage.getItem('ks_digestAuto') === '1'; } catch { return false; }
}

// Toont de status-scan één keer per dag automatisch (ochtend-samenvatting) voor
// admin/assistent — alleen als de gebruiker dat expliciet heeft aangezet. De knop
// "Status-scan" blijft altijd gewoon werken.
function maybeMorningDigest() {
  if (state.me.role === 'monteur') return;
  if (!digestAutoOn()) return;
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (localStorage.getItem('ks_lastDigest') === today) return;
    localStorage.setItem('ks_lastDigest', today);
  } catch { return; }
  setTimeout(() => { if ($('#modalRoot').hidden) openDigestModal(); }, 1500);
}

// Live-updates: checkt elke 5s of er iets veranderd is op de server en ververst
// dan automatisch de huidige weergave — geen handmatig verversen nodig.
let _lastPulse = null;
// Onthoud wanneer de gebruiker voor het laatst scrollde/tikte, zodat we het scherm
// niet midden in een swipe/scroll opnieuw opbouwen (voorkomt schokkerig gevoel).
window._lastInteract = 0;
['touchstart', 'touchmove', 'pointerdown', 'wheel', 'scroll'].forEach((ev) =>
  window.addEventListener(ev, () => { window._lastInteract = Date.now(); }, { passive: true, capture: true }));
async function startLiveUpdates() {
  const tick = async () => {
    // Niet verversen tijdens slepen, een open venster (modal) of typen.
    if (window._dragging) return;
    if (!$('#modalRoot').hidden) return;
    // Niet verversen vlak na scrollen/tikken (vooral mobiel): voorkomt haperingen.
    if (Date.now() - (window._lastInteract || 0) < 2500) return;
    const active = document.activeElement;
    if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return;
    try {
      const p = await api('/api/pulse');
      if (!p) return;
      // Inbox-badge meteen bijwerken.
      const badge = $('#inboxBadge');
      if (badge) { badge.textContent = p.pendingReviews; badge.hidden = p.pendingReviews === 0; }
      const bn = $('#bnInboxBadge'); if (bn) { bn.textContent = p.pendingReviews; bn.hidden = p.pendingReviews === 0; }
      // Mailbox bijna vol? Rood lampje in de zijbalk (verdwijnt vanzelf na opruimen).
      const mw = $('#mailboxWarn');
      if (mw) {
        if (typeof p.mailboxPct === 'number') { mw.textContent = `Mailbox ${p.mailboxBox || ''} ${p.mailboxPct}% VOL — ruim op!`; mw.hidden = false; }
        else mw.hidden = true;
      }
      // Alleen de inhoud verversen als er écht iets veranderd is.
      if (_lastPulse !== null && p.v !== _lastPulse) {
        // Bezig met een bulk-selectie? Dan het bord met rust laten tot je klaar bent —
        // anders schuift alles onder je vingers weg terwijl je aan het aanvinken bent.
        if (state.view === 'board' && boardSel.size) return;
        if (state.view === 'overview') loadOverview();
        else if (state.view === 'board') loadBoard();
        else if (state.view === 'inbox') loadInbox();
        else if (state.view === 'customers') loadCustomers();
      }
      _lastPulse = p.v;
    } catch { /* offline: volgende keer opnieuw */ }
  };
  tick();
  setInterval(tick, 5000);
}

// Toont of de WhatsApp-bridge nog draait (groen) of stil ligt (rood).
async function refreshWaStatus() {
  const el = $('#waStatus');
  if (!el) return;
  try {
    const s = await api('/api/whatsapp/status');
    if (!s.configured) { el.hidden = true; return; } // nooit gekoppeld: niks tonen
    el.hidden = false;
    if (s.online) {
      el.textContent = 'WhatsApp: actief';
      // Diagnose in de tooltip: wanneer kwam het laatste bericht BINNEN? Zo zie je
      // meteen of ontvangen ook echt werkt (en niet alleen het proces draait).
      el.title = s.lastIncomingAgeMin != null ? `Laatste bericht ontvangen: ${s.lastIncomingAgeMin} min geleden` : '';
      el.classList.remove('wa-down'); el.classList.add('wa-up');
    } else {
      const mins = s.ageSeconds ? Math.round(s.ageSeconds / 60) : '?';
      el.textContent = `WhatsApp: GESTOPT (${mins} min stil)`;
      el.classList.remove('wa-up'); el.classList.add('wa-down');
    }
  } catch { el.hidden = true; }
}

async function refreshMeta() {
  const me = await api('/api/me');
  if (me && me.meta) state.meta = me.meta;
}

function bindNav() {
  $$('.nav-item').forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.view, tab)));
  // Onderbalk (mobiel): zelfde acties + een zoek-knop die de command palette opent.
  $$('.bn-item').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.action === 'search') { openCommandPalette(); return; }
    showView(b.dataset.view, b);
  }));
  $('#logoutBtn').addEventListener('click', async () => { await api('/api/logout', 'POST'); window.location.href = '/'; });
  $('#accountBtn').addEventListener('click', openAccountModal);
  const themeBtn = $('#themeBtn');
  if (themeBtn) {
    const syncLabel = () => { themeBtn.textContent = document.documentElement.dataset.theme === 'dark' ? 'Lichte modus' : 'Nachtmodus'; };
    syncLabel();
    themeBtn.addEventListener('click', () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      if (dark) { delete document.documentElement.dataset.theme; try { localStorage.setItem('ks_theme', 'light'); } catch {} }
      else { document.documentElement.dataset.theme = 'dark'; try { localStorage.setItem('ks_theme', 'dark'); } catch {} }
      syncLabel();
    });
  }
}

function showView(view, tab) {
  const anderView = state.view !== view;
  state.view = view;
  if (view !== 'assistant') ssPollActive = false; // statusscan-pollen stoppen buiten de AI-pagina
  // De drie board-menu's (Opdrachten/E-mail/WhatsApp) delen dezelfde weergave maar filteren op kanaal.
  state.channel = (tab && tab.dataset.channel) || 'all';
  $$('.nav-item').forEach((t) => t.classList.remove('active'));
  if (tab && tab.classList.contains('nav-item')) tab.classList.add('active');
  else $(`.nav-item[data-view="${view}"]`)?.classList.add('active');
  // Onderbalk (mobiel) active-markering synchroniseren.
  $$('.bn-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  // Bij een ANDER scherm bovenaan beginnen. Zonder dit hield de pagina de scrollpositie
  // van het vorige scherm vast; is het nieuwe scherm korter, dan klemt de browser die
  // positie en zie je alles verspringen (voelt als een balk die beweegt).
  if (anderView) window.scrollTo(0, 0);
  const active = $(`#view-${view}`);
  if (active) { active.classList.remove('fade-swap'); void active.offsetWidth; active.classList.add('fade-swap'); }
  const map = { overview: loadOverview, board: loadBoard, inbox: loadInbox, customers: loadCustomers, agenda: loadAgenda, assistant: loadAssistant, monteurs: loadMonteurs, trash: loadTrash, control: loadControl, subs: loadSubs, settings: loadSettings, users: loadUsers, invoices: loadInvoices, finance: loadFinance };
  (map[view] || (() => {}))();
}

// Markeer een opdracht als geopend/gezien (zet de statusstip op blauw).
async function markSeen(id) {
  const o = state.orders.find((x) => x.id === id);
  if (!o) return;
  // Niets te doen als al geopend én geen nieuwe klantreactie open staat.
  if (o.openedAt && !o.customerReplied) return;
  o.openedAt = o.openedAt || new Date().toISOString();
  o.customerReplied = false;
  o.unreadReplies = 0;
  const card = $(`.card[data-id="${id}"]`);
  if (card) {
    card.classList.remove('is-new', 'replied-alert');
    const dot = $('.state-dot', card);
    if (dot && !o.lastReplyAt) { dot.classList.remove('new'); dot.classList.add('opened'); }
    const banner = $('.reply-banner', card); if (banner) banner.remove();
    const corner = $('.reply-corner', card); if (corner) corner.remove();
  }
  try { await api(`/api/orders/${id}/seen`, 'POST'); } catch {}
}

// Korte groene puls op een element, om te tonen dat iets is opgeslagen/veranderd.
function flash(elOrSelector) {
  const el = typeof elOrSelector === 'string' ? $(elOrSelector) : elOrSelector;
  if (!el) return;
  el.classList.remove('flash-saved'); void el.offsetWidth; el.classList.add('flash-saved');
}

async function refreshAll() {
  state.monteurs = await api('/api/monteurs');
  fillMonteurFilter();
  await loadOverview();
  await refreshInboxBadge();
}

// Spring naar een weergave alsof je op het menu-item klikt (incl. actief-markering).
function goView(view) {
  const tab = $(`.nav-item[data-view="${view}"]`);
  showView(view, tab);
}

// AI-dagcheck: laat de AI controleren of alle aanvragen van vandaag netjes verwerkt zijn.
async function openDailyCheck() {
  modal(`<h2>AI-dagcheck</h2><p class="muted small">De AI vergelijkt alle berichten van vandaag met de aangemaakte opdrachten… dit kan ~10-30 sec duren.</p><div id="dc-result" class="muted small">Bezig met controleren…</div><div class="modal-actions"><span></span><div class="right"><button class="btn btn-primary" id="dc-close">Sluiten</button></div></div>`);
  $('#dc-close').onclick = closeModal;
  try {
    const out = await api('/api/assistant/daily-check', 'POST', {});
    $('#dc-result').innerHTML = `<div class="analysis-box">${esc(out.text || '').replace(/\n/g, '<br>')}</div>${out.searched ? `<div class="muted small" style="margin-top:6px">Doorzocht: ${out.searched} berichten · ${esc(out.engine || '')}</div>` : ''}`;
  } catch (err) { $('#dc-result').innerHTML = `<div class="error small">${esc(err.message)}</div>`; }
}

// ---------- Slimme zoekbalk (Start): klanten, kaarten, facturen én berichten ----------
let _gsTimer = null;
function initGlobalSearch() {
  const inp = $('#globalSearch'); const box = $('#gsResults');
  if (!inp || !box) return;
  const doSearch = async () => {
    const q = inp.value.trim();
    if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
    let r;
    try { r = await api('/api/search?q=' + encodeURIComponent(q)); }
    catch { return; }
    if (inp.value.trim() !== q) return; // verouderd antwoord (er is doorgetypt)
    const eur = (n) => '€ ' + Number(n || 0).toFixed(2).replace('.', ',');
    const sec = (titel, items) => items.length ? `<div class="gs-sec">${titel}</div>${items.join('')}` : '';
    const html = [
      sec('Klanten', r.customers.map((c) => `<button class="gs-row" data-t="cust" data-id="${esc(c.id)}"><strong>${esc(c.name)}</strong><span class="muted small">${esc([c.phone, c.address].filter(Boolean).join(' · '))}</span></button>`)),
      sec('Opdrachten', r.orders.map((o) => `<button class="gs-row" data-t="order" data-id="${esc(o.id)}"><strong>${esc(o.title || 'Zonder titel')}</strong><span class="muted small">${esc([o.customer, o.status, o.archived ? 'archief' : ''].filter(Boolean).join(' · '))}</span></button>`)),
      sec('Facturen & offertes', r.invoices.map((i) => `<button class="gs-row" data-t="inv" data-id="${esc(i.id)}"><strong>${esc(i.number)}</strong><span class="muted small">${esc([i.type === 'offerte' ? 'offerte' : 'factuur', i.customer, i.status].filter(Boolean).join(' · '))} · ${eur(i.totalIncl)}</span></button>`)),
      sec('Berichten', (r.messages || []).map((m, ix) => `<button class="gs-row" data-t="msg" data-ix="${ix}"><strong>${esc(m.sender || m.group || m.channel)}</strong><span class="muted small">${esc(fmtDate(m.at))} · ${esc(m.snippet)}</span></button>`)),
    ].join('');
    box.innerHTML = html || '<div class="muted small" style="padding:8px">Niets gevonden.</div>';
    box.hidden = false;
    $$('.gs-row', box).forEach((b) => b.onclick = async () => {
      const t = b.dataset.t;
      if (t === 'cust') return openCustomerDossier(b.dataset.id);
      if (t === 'order') {
        state.orders = await api('/api/orders?includeArchived=1');
        markSeen(b.dataset.id); return openOrderModal(b.dataset.id);
      }
      if (t === 'inv') return openStandaloneInvoice(b.dataset.id);
      if (t === 'msg') {
        const m = (r.messages || [])[Number(b.dataset.ix)]; if (!m) return;
        modal(`<h2>Bericht</h2><div class="muted small" style="margin-bottom:8px">${esc(m.sender || '')}${m.group ? ' · groep ' + esc(m.group) : ''} · ${esc(fmtDate(m.at))} · ${esc(m.channel)}</div><div class="analysis-box" style="white-space:pre-wrap">${esc(m.full || m.snippet)}</div><div class="modal-actions"><span></span><div class="right"><button class="btn" id="gs-inbox">Naar de inbox</button><button class="btn btn-primary" id="gs-close">Sluiten</button></div></div>`);
        $('#gs-close').onclick = closeModal;
        $('#gs-inbox').onclick = () => { closeModal(); goView('inbox'); };
      }
    });
  };
  inp.oninput = () => { clearTimeout(_gsTimer); _gsTimer = setTimeout(doSearch, 300); };
  inp.onkeydown = (e) => { if (e.key === 'Escape') { inp.value = ''; box.hidden = true; } };
}

// ---------- Overzicht / Home ----------
async function loadOverview() {
  const d = await api('/api/overview');
  const k = d.kpis;
  const first = (state.me.name || '').trim().split(' ')[0] || '';
  $('#overviewHi').textContent = first ? `Hoi ${first}` : 'Overzicht';
  $('#overviewDate').textContent = new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const card = (num, label, view, cls = '', col = '') => `<button class="kpi-card ${cls}" data-go="${view}"${col ? ` data-col="${esc(col)}"` : ''}><span class="kpi-num">${num}</span><span class="kpi-label">${esc(label)}</span></button>`;
  const wa = d.whatsapp || {};
  const list = (arr, empty) => arr.length
    ? `<ul class="ov-list">${arr.slice(0, 6).map((o) => `<li data-open="${o.id}">${esc(o.title)}${o.at ? ` <span class="muted">· ${fmtDate(o.at)}</span>` : ''}${o.customer ? ` <span class="muted">· ${esc(o.customer)}</span>` : ''}</li>`).join('')}${arr.length > 6 ? `<li class="muted small">+ ${arr.length - 6} meer…</li>` : ''}</ul>`
    : `<div class="muted small">${empty}</div>`;
  const ovHtml = `
    <div class="info-card" style="margin-bottom:18px;position:relative">
      <input id="globalSearch" type="search" autocomplete="off" placeholder="Zoek alles: klant, opdracht, factuur${state.me.role === 'monteur' ? '' : ', bericht'}… (naam, 06-nummer, adres, factuurnummer)" style="width:100%">
      <div id="gsResults" hidden></div>
    </div>
    ${state.me.role === 'monteur' ? '' : `
    <div class="info-card" id="dayov" style="margin-bottom:18px;border-left:4px solid var(--accent)">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <h3 style="margin:0">${icon('sparkles', 16)} Jouw dag in één oogopslag</h3>
        <span class="muted small" id="dayov-meta" style="margin-left:auto"></span>
        ${state.me.role !== 'monteur' ? `<button class="btn btn-sm" id="dayov-refresh" title="Nieuwe AI-scan: WhatsApp tot 7 dagen + e-mail tot 14 dagen terug">${icon('refresh', 13)} Ververs</button>` : ''}
      </div>
      <div id="dayov-body" class="muted small" style="margin-top:10px">Dagoverzicht laden…</div>
    </div>`}
    <div class="kpi-grid">
      ${card(k.teControleren, 'Te controleren', 'inbox', k.teControleren ? 'kpi-attn' : '')}
      ${card(k.klantReacties, 'Klant reageerde', 'board', k.klantReacties ? 'kpi-attn' : '')}
      ${card(k.afsprakenVandaag, 'Afspraken vandaag', 'agenda')}
      ${card(k.nieuwVandaag, 'Nieuw vandaag', 'board', '', 'nieuw')}
      ${card(k.openOffertes, 'Open offertes', 'board', '', 'offerte_verzonden')}
      ${card(k.afgerondDezeWeek, 'Afgerond deze week', 'board', '', 'afgerond')}
      ${card(k.actief, 'Actieve opdrachten', 'board')}
    </div>
    <div class="ov-cols">
      <div class="info-card"><h3>Afspraken vandaag</h3>${list(d.apptToday, 'Geen afspraken vandaag.')}</div>
      <div class="info-card"><h3>Klant heeft gereageerd</h3>${list(d.repliedList, 'Niemand op dit moment.')}</div>
      <div class="info-card"><h3>Offerte blijft liggen (3+ dagen)</h3>${list(d.staleQuotes, 'Niets blijft liggen.')}</div>
    </div>
    <div class="ov-cols">
      <div class="info-card"><h3>Verdeling over kolommen</h3><div class="ov-bars">${d.byStatus.map((s) => `<div class="ov-bar" data-go="board" data-col="${esc(s.key)}"><span class="column-dot" style="background:${esc(statusColor(s.key))}"></span><span class="ov-bar-label">${esc(s.label)}</span><span class="ov-bar-count">${s.count}</span></div>`).join('')}</div></div>
      <div class="info-card"><h3>WhatsApp & recente activiteit</h3>
        <div class="ov-wa ${wa.online ? 'on' : 'off'}">${wa.online ? 'WhatsApp-bridge: actief' : (wa.configured ? 'WhatsApp-bridge: GESTOPT' : 'WhatsApp: niet gekoppeld')}</div>
        <ul class="ov-activity">${(d.activity || []).map((a) => `<li><span class="muted small">${fmtDate(a.at)}</span> ${esc(a.actor)} — ${esc(a.action)}${a.detail ? `: ${esc(a.detail)}` : ''}</li>`).join('') || '<li class="muted small">Nog geen activiteit.</li>'}</ul>
      </div>
    </div>
    ${state.me.role !== 'monteur' ? `
    <div class="info-card" style="margin-top:18px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <h3 style="margin:0">${icon('activity', 15)} Weekrapport</h3>
        <select id="wr-offset" style="max-width:170px;margin-left:auto"><option value="0">Deze week</option><option value="1">Vorige week</option><option value="2">2 weken terug</option></select>
      </div>
      <div id="wr-body" class="muted small" style="margin-top:10px">Laden…</div>
    </div>` : ''}`;
  // Alleen opnieuw tekenen als er echt iets veranderd is. Anders werd bij élke
  // achtergrondwijziging je zoekbalk leeggegooid, het dagoverzicht opnieuw opgehaald
  // en sprong de pagina — precies het "geknipper" op Start.
  if (ovHtml === _lastOvHtml && $('#overviewPanel').children.length) return;
  _lastOvHtml = ovHtml;
  $('#overviewPanel').innerHTML = ovHtml;
  $$('#overviewPanel [data-go]').forEach((el) => el.onclick = () => {
    const col = el.dataset.col;
    if (col) { state.boardTab = col; state._focusCol = col; } // open meteen de juiste kolom
    goView(el.dataset.go);
  });
  // ---------- AI-dagoverzicht (1x per dag gegenereerd, Ververs forceert) ----------
  const renderDayOverview = (d) => {
    const body = $('#dayov-body'); if (!body) return;
    const meta = $('#dayov-meta');
    if (meta && d.at) meta.textContent = `${d.engine && /opus/i.test(d.engine) ? 'Opus · ' : ''}gemaakt ${fmtDate(d.at)}`;
    const viewOf = { inbox: 'inbox', opdrachten: 'board', facturen: 'invoices', agenda: 'agenda', klanten: 'customers' };
    const prioDot = { hoog: '#ef4444', middel: '#f59e0b', laag: '#10b981' };
    if (d.data) {
      const a = d.data;
      body.innerHTML = `
        ${a.kop ? `<div style="font-size:15.5px;color:var(--ink);font-weight:600;line-height:1.45;margin-bottom:10px">${esc(a.kop)}</div>` : ''}
        ${(a.acties || []).length ? `<div>${a.acties.map((x) => `
          <div class="dayov-act" data-go2="${esc(viewOf[x.waar] || 'board')}" style="display:flex;gap:9px;align-items:flex-start;padding:7px 8px;margin:2px -8px;border-radius:8px;cursor:pointer">
            <span style="width:9px;height:9px;border-radius:50%;background:${prioDot[x.prio] || prioDot.middel};margin-top:5px;flex:none"></span>
            <span style="color:var(--ink)"><strong>${esc(x.titel)}</strong>${x.waarom ? ` <span class="muted">— ${esc(x.waarom)}</span>` : ''}</span>
          </div>`).join('')}</div>` : '<div class="muted small">Geen acties — alles loopt.</div>'}
        ${(a.beantwoorden || []).length ? `
        <div style="margin-top:10px"><div class="small" style="font-weight:600;color:var(--accent);margin-bottom:4px">${icon('reply', 12)} Beantwoorden vandaag</div>
          ${a.beantwoorden.map((b) => `<div class="muted small" style="padding:2px 0">${b.kanaal === 'whatsapp' ? icon('whatsapp', 11) : icon('mail', 11)} <strong style="color:var(--ink)">${esc(b.wie || 'Onbekend')}</strong>${b.waarover ? ` — ${esc(b.waarover)}` : ''}${b.urgent ? ' <span style="color:#ef4444;font-weight:700">· urgent</span>' : ''}</div>`).join('')}
        </div>` : ''}
        ${(a.kansen || []).length || (a.risicos || []).length ? `
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:10px">
          ${(a.kansen || []).length ? `<div style="flex:1;min-width:220px"><div class="small" style="font-weight:600;color:#0d7a43;margin-bottom:4px">Kansen</div>${a.kansen.map((k) => `<div class="muted small" style="padding:2px 0">• ${esc(k)}</div>`).join('')}</div>` : ''}
          ${(a.risicos || []).length ? `<div style="flex:1;min-width:220px"><div class="small" style="font-weight:600;color:#b45309;margin-bottom:4px">Let op</div>${a.risicos.map((k) => `<div class="muted small" style="padding:2px 0">• ${esc(k)}</div>`).join('')}</div>` : ''}
        </div>` : ''}`;
      $$('.dayov-act', body).forEach((el) => {
        el.onmouseenter = () => { el.style.background = 'var(--panel-2, #f6f8fb)'; };
        el.onmouseleave = () => { el.style.background = ''; };
        el.onclick = () => goView(el.dataset.go2);
      });
    } else {
      // Zonder AI: de feiten netjes tonen — nooit een leeg of kapot blok.
      const f = d.facts || {};
      const rows = [
        f.appts && f.appts.length ? `${f.appts.length} afspraak/afspraken vandaag` : 'Geen afspraken vandaag',
        f.pendingLeads ? `${f.pendingLeads} lead(s) te controleren in de inbox` : '',
        f.unanswered ? `${f.unanswered} klantreactie(s) onbeantwoord` : '',
        f.overdueCount ? `${f.overdueCount} factuur/facturen verlopen` : '',
      ].filter(Boolean);
      body.innerHTML = `${rows.map((r) => `<div style="padding:2px 0">• ${esc(r)}</div>`).join('')}<div class="muted small" style="margin-top:8px">${d.error === 'geen-ai'
        ? 'Zet de AI aan (ANTHROPIC_API_KEY) voor het volledige dagoverzicht met acties, kansen en risico’s.'
        : `AI-scan lukte niet: <strong>${esc(d.error || 'onbekende fout')}</strong> — klik op Ververs om het opnieuw te proberen.`}</div>`;
    }
  };
  const loadDayOverview = async (refresh = false) => {
    if (!$('#dayov')) return; // monteur-rol heeft dit blok niet (AVG)
    try { renderDayOverview(await api(`/api/day-overview${refresh ? '?refresh=1' : ''}`)); }
    catch (err) { const b = $('#dayov-body'); if (b) b.textContent = 'Dagoverzicht niet beschikbaar: ' + err.message; }
  };
  loadDayOverview();
  initGlobalSearch();
  const rf = $('#dayov-refresh');
  if (rf) rf.onclick = async () => { rf.disabled = true; rf.textContent = 'Scannen…'; await loadDayOverview(true); rf.disabled = false; rf.innerHTML = `${icon('refresh', 13)} Ververs`; };
  $$('#overviewPanel [data-open]').forEach((el) => el.onclick = async () => { if (!state.orders.length) state.orders = await api('/api/orders'); markSeen(el.dataset.open); openOrderModal(el.dataset.open); });
  if ($('#wr-offset')) {
    const euro = (n) => '€ ' + Number(n || 0).toLocaleString('nl-NL', { maximumFractionDigits: 0 });
    const loadWeek = async () => {
      const box = $('#wr-body'); if (!box) return;
      box.textContent = 'Laden…';
      try {
        const r = await api('/api/report/week?offset=' + $('#wr-offset').value);
        const range = `${new Date(r.weekStart).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })} t/m ${new Date(new Date(r.weekEnd).getTime() - 1).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}`;
        box.innerHTML = `
          <div class="muted small" style="margin-bottom:8px">${esc(range)}</div>
          <div class="wr-kpis">
            <div class="wr-kpi"><span class="wr-num">${r.aanvragen}</span><span>aanvragen</span></div>
            <div class="wr-kpi"><span class="wr-num">${r.newOrders}</span><span>nieuwe opdrachten</span></div>
            <div class="wr-kpi"><span class="wr-num">${r.apptCount}</span><span>afspraken</span></div>
            <div class="wr-kpi"><span class="wr-num">${r.doneCount}</span><span>afgerond</span></div>
            <div class="wr-kpi"><span class="wr-num">${euro(r.omzet)}</span><span>omzet (prijsveld)</span></div>
            <div class="wr-kpi"><span class="wr-num">${r.conversie === null ? '—' : r.conversie + '%'}</span><span>conversie</span></div>
          </div>
          <table style="margin-top:12px"><thead><tr><th>Monteur</th><th>Afgerond</th><th>Omzet</th><th>Afspraken</th><th>Nu actief</th></tr></thead>
          <tbody>${(r.perMonteur || []).map((m) => `<tr><td>${esc(m.name)}</td><td>${m.afgerond}</td><td>${euro(m.omzet)}</td><td>${m.afspraken}</td><td>${m.actief}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nog geen monteurs</td></tr>'}</tbody></table>
          <p class="muted small" style="margin-top:8px">Omzet komt uit het <strong>prijsveld</strong> op afgeronde kaarten — vul die in voor een kloppend rapport.</p>`;
      } catch (err) { box.innerHTML = `<span class="error">${esc(err.message)}</span>`; }
    };
    $('#wr-offset').onchange = loadWeek;
    loadWeek();
  }
}

// ---------- Source <select> (met 'andere bron toevoegen') ----------
function sourceSelect(selected, extraClass = '') {
  const sources = state.meta.sources || [];
  const has = selected && sources.includes(selected);
  const opts = sources.map((s) => `<option value="${esc(s)}" ${selected === s ? 'selected' : ''}>${esc(s)}</option>`).join('');
  const custom = !has && selected ? `<option value="${esc(selected)}" selected>${esc(selected)}</option>` : '';
  return `<select class="${extraClass}" data-source>${opts}${custom}<option value="__new__">Andere bron…</option></select>`;
}
function bindSourceSelect(sel) {
  if (!sel) return;
  sel.addEventListener('change', () => {
    if (sel.value === '__new__') {
      const naam = prompt('Naam van de nieuwe herkomst-bron (bv. "DRS WhatsApp groep"):');
      if (naam && naam.trim()) {
        const opt = document.createElement('option');
        opt.value = naam.trim(); opt.textContent = naam.trim();
        sel.insertBefore(opt, sel.querySelector('option[value="__new__"]'));
        sel.value = naam.trim();
      } else {
        sel.selectedIndex = 0;
      }
    }
  });
}

// ---------- Board ----------
function fillMonteurFilter() {
  const sel = $('#boardMonteurFilter');
  sel.innerHTML = '<option value="">Alle monteurs</option>' +
    state.monteurs.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
}

async function loadBoard() {
  // Periode-filter actief? Dan óók de ingeklapte (gearchiveerde) kaarten ophalen,
  // zodat een vandaag/deze-week binnengekomen aanvraag ALTIJD zichtbaar is — ook
  // als hij al is verwerkt naar Afgerond/Geannuleerd en de week is ingeklapt.
  const periode = $('#boardPeriodFilter')?.value || '';
  state.orders = await api(periode ? '/api/orders?includeArchived=1' : '/api/orders');
  state.archives = await api('/api/archives');
  renderBoard();
  renderArchives();
  const stats = await api('/api/stats');
  $('#boardStats').innerHTML =
    `<span title="Actieve opdracht-kaarten op het bord (niet ingeklapt)">${stats.totalOrders} opdrachten</span> · ` +
    `<span class="stat-link" data-go="customers" title="Contacten die nog geen klant zijn (eenmalige/aanvraag-contacten). Klik om te bekijken.">${stats.leads} leads</span> · ` +
    `<span class="stat-link" data-go="customers" title="Contacten met wie je zaken hebt gedaan. Klik om te bekijken.">${stats.customers} klanten</span>`;
  $$('#boardStats .stat-link').forEach((el) => el.onclick = () => showView(el.dataset.go));
}

// Ingeklapte week-agenda's onder het bord.
function renderArchives() {
  let wrap = $('#archiveWrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'archiveWrap';
    wrap.className = 'archive-wrap';
    $('#view-board').appendChild(wrap);
  }
  const archives = state.archives || [];
  if (!archives.length) { wrap.innerHTML = ''; _lastArchHtml = ''; return; }
  // Ook hier: alleen hertekenen als er echt iets veranderd is — anders klapte elke
  // opengeklapte week-agenda bij iedere achtergrondwijziging weer dicht.
  const archVinger = JSON.stringify(archives.map((a) => [a.key, a.label, a.count]));
  if (archVinger === _lastArchHtml && wrap.children.length) return;
  _lastArchHtml = archVinger;
  wrap.innerHTML = `<h3 class="archive-title">${icon('box', 14)} Ingeklapte agenda's</h3>` +
    archives.map((a) => `
      <details class="archive"> <summary> ${esc(a.label)} <span class="count">${a.count}</span></summary> <div class="archive-body" data-week="${esc(a.key)}">Laden…</div> </details>`).join('');
  $$('.archive').forEach((d) => {
    d.addEventListener('toggle', async () => {
      if (!d.open) return;
      const body = $('.archive-body', d);
      const week = body.dataset.week;
      const orders = await api(`/api/orders?archivedWeek=${encodeURIComponent(week)}`);
      // Overzichtelijk: gegroepeerd per kolom (status), met kopjes en aantallen.
      const statuses = state.meta.statuses || [];
      const groups = statuses
        .map((st) => ({ st, items: orders.filter((o) => o.status === st.key) }))
        .filter((g) => g.items.length);
      body.innerHTML = groups.map((g) => `
        <div class="arch-group">
          <div class="arch-group-head"><span class="column-dot" style="background:${esc(g.st.color)}"></span> ${esc(g.st.label)} <span class="count">${g.items.length}</span></div>
          ${g.items.map((o) => `
            <div class="archive-item" data-id="${o.id}">
              <span class="dot" style="background:${esc(statusColor(o.status))}"></span>
              <strong>${esc(o.title)}</strong>
              <span class="muted small">${esc(o.customer?.name || '')}${o.customer?.phone ? ' · ' + esc(o.customer.phone) : ''}</span>
              <span class="muted small arch-when">${esc(fmtDateShort(o.createdAt))}</span>
            </div>`).join('')}
        </div>`).join('') || '<div class="muted small">Leeg</div>';
      $$('.archive-item', body).forEach((it) => it.onclick = () => openOrderModal(it.dataset.id, orders));
    });
  });
}

// Periode-grenzen (lokale tijd) voor het "binnengekomen in…"-filter op het bord.
function boardPeriodRange(keuze) {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const dag = 86400000;
  const maandagVan = (ref) => { const m = new Date(ref); const wd = (m.getDay() + 6) % 7; m.setTime(m.getTime() - wd * dag); return m.getTime(); };
  if (keuze === 'vandaag') return [d0.getTime(), d0.getTime() + dag];
  if (keuze === 'gisteren') return [d0.getTime() - dag, d0.getTime()];
  if (keuze === 'week') return [maandagVan(d0), d0.getTime() + dag];
  if (keuze === 'vorigeweek') { const ma = maandagVan(d0); return [ma - 7 * dag, ma]; }
  if (keuze === 'maand') { const m = new Date(d0); m.setDate(1); return [m.getTime(), d0.getTime() + dag]; }
  return null;
}

function filteredOrders() {
  const q = ($('#boardSearch').value || '').toLowerCase();
  const mont = $('#boardMonteurFilter').value;
  const bereik = boardPeriodRange($('#boardPeriodFilter')?.value || '');
  return state.orders.filter((o) => {
    if (state.channel === 'email' && orderChannel(o) !== 'email') return false;
    if (state.channel === 'whatsapp' && orderChannel(o) !== 'whatsapp') return false;
    if (mont && o.monteurId !== mont) return false;
    if (bereik) {
      const t = new Date(o.createdAt || 0).getTime();
      if (!(t >= bereik[0] && t < bereik[1])) return false;
    }
    if (q) {
      const threadTxt = (o.thread || []).map((t) => t.body || '').join(' ');
      const hay = `${o.title} ${o.description || ''} ${o.customer?.name || ''} ${o.customer?.phone || ''} ${o.customer?.email || ''} ${o.customer?.address || ''} ${o.notes || ''} ${o.source || ''} ${threadTxt}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderBoard() {
  const board = $('#board');
  // Titel meebewegen met het gekozen hoofdmenu.
  const titles = { all: 'Opdrachten', email: 'E-mail — opdrachten', whatsapp: 'WhatsApp — opdrachten' };
  const h = $('#view-board h2'); if (h) h.textContent = titles[state.channel] || 'Opdrachten';
  const orders = filteredOrders();
  const statuses = state.meta.statuses || [];
  const colHTML = (st) => {
    const items = orders.filter((o) => o.status === st.key);
    return `
      <div class="column ${st.secondary ? 'column-secondary' : ''}" data-status="${esc(st.key)}"> <div class="column-head"> <span class="column-dot" style="background:${esc(st.color)}"></span> ${esc(st.label)}
          <span class="count">${items.length}</span> </div> <div class="column-cards" data-status="${esc(st.key)}"> ${items.map(cardHTML).join('') || '<div class="empty">Leeg</div>'}
        </div> </div>`;
  };
  const primary = statuses.filter((s) => !s.secondary);
  const secondary = statuses.filter((s) => s.secondary);
  // Periode-filter actief? Toon een duidelijke balk met wat je nu ziet.
  const perKeuze = $('#boardPeriodFilter')?.value || '';
  const perLabels = { vandaag: 'vandaag', gisteren: 'gisteren', week: 'deze week', vorigeweek: 'vorige week', maand: 'deze maand' };
  const perBar = perKeuze ? `<div class="board-period-bar">${icon('clock', 13)} Je ziet alleen aanvragen die <strong>${perLabels[perKeuze] || perKeuze}</strong> zijn binnengekomen — over alle kolommen, ook al verwerkt (${orders.length}). <button type="button" class="chip" id="bp-clear">Filter uit</button></div>` : '';
  const nieuweHtml = perBar +
    `<div class="board-row board-primary">${primary.map(colHTML).join('')}</div>` +
    (secondary.length ? `<div class="board-row board-secondary"><div class="board-sec-label">Afgehandeld</div><div class="board-sec-cols">${secondary.map(colHTML).join('')}</div></div>` : '');
  // NIET OPNIEUW TEKENEN als er letterlijk niets veranderd is. Het bord werd tot nu toe
  // elke keer volledig herbouwd zodra de server ook maar íets opsloeg (ook een
  // achtergrondtaak). Dat gaf het "knipperen", liet de pagina verspringen onder de
  // onderbalk, en wiste je selectie. Zelfde HTML = scherm met rust laten.
  if (nieuweHtml === _lastBoardHtml && board.children.length) return;
  _lastBoardHtml = nieuweHtml;
  // Scrollposities onthouden (pagina + horizontaal gescrolde kolommenrij), zodat het
  // beeld niet wegspringt terwijl je aan het kijken of tikken bent.
  const paginaY = window.scrollY;
  const rijX = [...board.querySelectorAll('.board-row')].map((r) => r.scrollLeft);
  const kolomY = [...board.querySelectorAll('.column-cards')].map((c) => c.scrollTop);
  board.innerHTML = nieuweHtml;
  const rijen = [...board.querySelectorAll('.board-row')];
  rijX.forEach((x, i) => { if (rijen[i] && x) rijen[i].scrollLeft = x; });
  const kolommen = [...board.querySelectorAll('.column-cards')];
  kolomY.forEach((y, i) => { if (kolommen[i] && y) kolommen[i].scrollTop = y; });
  if (window.scrollY !== paginaY) window.scrollTo(0, paginaY);
  const bpc = $('#bp-clear');
  if (bpc) bpc.onclick = () => { $('#boardPeriodFilter').value = ''; loadBoard(); };

  $$('.card').forEach((el) => {
    el.addEventListener('click', (e) => {
      // Klikken op selectievakje/prullenbak, of net na een swipe, opent de kaart niet.
      if (e.target.closest('.card-select') || e.target.closest('.card-trash') || el.dataset.swiped) return;
      markSeen(el.dataset.id); openOrderModal(el.dataset.id);
    });
    el.addEventListener('dragstart', (e) => { window._dragging = true; e.dataTransfer.setData('text/plain', el.dataset.id); el.style.opacity = '.5'; });
    el.addEventListener('dragend', () => { window._dragging = false; el.style.opacity = '1'; });
  });
  bindCardSwipe();
  // Mini-prullenbak per kaart (met "Ongedaan maken")
  $$('.card-trash').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const id = b.dataset.del;
    try { await api(`/api/orders/${id}`, 'DELETE'); loadBoard(); toastUndo('Naar prullenbak', () => restoreOrders([id])); }
    catch (err) { toast(err.message, true); }
  }));
  // Selectievakjes -> onthouden in het geheugen, zodat een verversing ze niet wist.
  $$('.card-check').forEach((c) => c.addEventListener('change', () => {
    if (c.checked) boardSel.add(c.dataset.id); else boardSel.delete(c.dataset.id);
    updateBoardBulk();
  }));
  // Kaarten die niet meer op het bord staan (verwerkt/verwijderd) uit de selectie halen.
  const zichtbaar = new Set($$('.card-check').map((c) => c.dataset.id));
  for (const sid of [...boardSel]) if (!zichtbaar.has(sid)) boardSel.delete(sid);
  updateBoardBulk();

  $$('.column-cards').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.closest('.column').classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.closest('.column').classList.remove('drag-over'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.closest('.column').classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const newStatus = col.dataset.status;
      const order = state.orders.find((o) => o.id === id);
      if (order && order.status !== newStatus) {
        order.status = newStatus;
        renderBoard();
        const moved = $(`.card[data-id="${id}"]`); if (moved) moved.classList.add('just-moved');
        try { await api(`/api/orders/${id}`, 'PATCH', { status: newStatus }); toast('Status bijgewerkt'); await loadBoard(); flash(`.card[data-id="${id}"]`); }
        catch (err) { toast(err.message, true); loadBoard(); }
      }
    });
  });

  // Prullenbak-dropzone (alleen voor wie mag verwijderen)
  const tz = $('#trashZone');
  if (tz && state.me.role !== 'monteur') {
    tz.hidden = false;
    tz.ondragover = (e) => { e.preventDefault(); tz.classList.add('drag-over'); };
    tz.ondragleave = () => tz.classList.remove('drag-over');
    tz.ondrop = async (e) => {
      e.preventDefault(); tz.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      try { await api(`/api/orders/${id}`, 'DELETE'); loadBoard(); toastUndo('Naar prullenbak verplaatst', () => restoreOrders([id])); }
      catch (err) { toast(err.message, true); }
    };
  } else if (tz) { tz.hidden = true; }

  setupBoardTabs();
  // Kwam je via een KPI/kolom-klik? Spring meteen naar die kolom (mobiel = tab, pc = scroll).
  if (state._focusCol) {
    const colEl = $(`#board .column[data-status="${state._focusCol}"]`);
    if (colEl) { colEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); flash(colEl); }
    state._focusCol = null;
  }
}

// Mobiel: kolom-tabs bovenaan het bord (kies één kolom i.p.v. horizontaal scrollen).
function setupBoardTabs() {
  const board = $('#board');
  let tabs = $('#boardTabs');
  const isMobile = window.matchMedia('(max-width: 820px)').matches;
  if (!isMobile) { if (tabs) tabs.remove(); board.classList.remove('tabbed'); return; }
  const statuses = state.meta.statuses || [];
  const counts = {};
  filteredOrders().forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1; });
  if (!tabs) { tabs = document.createElement('div'); tabs.id = 'boardTabs'; tabs.className = 'board-tabs'; board.parentNode.insertBefore(tabs, board); }
  if (!state.boardTab || !statuses.find((s) => s.key === state.boardTab)) state.boardTab = statuses[0]?.key;
  tabs.innerHTML = statuses.map((s) => `<button class="board-tab ${s.key === state.boardTab ? 'active' : ''}" data-tab="${esc(s.key)}"><span class="column-dot" style="background:${esc(s.color)}"></span>${esc(s.label)} <span class="count">${counts[s.key] || 0}</span></button>`).join('');
  board.classList.add('tabbed');
  try {
    if (state.me.role !== 'monteur' && !localStorage.getItem('ks_swipeHint')) {
      localStorage.setItem('ks_swipeHint', '1');
      setTimeout(() => toast('Tip: veeg een kaart naar rechts = volgende kolom, naar links = vorige kolom. Verwijderen via het prullenbak-icoon op de kaart.'), 800);
    }
  } catch {}
  const apply = () => $$('#board .column').forEach((col) => col.classList.toggle('tab-active', col.dataset.status === state.boardTab));
  apply();
  $$('.board-tab', tabs).forEach((b) => b.onclick = () => {
    state.boardTab = b.dataset.tab;
    $$('.board-tab', tabs).forEach((x) => x.classList.toggle('active', x === b));
    apply();
  });
}

// Bord opnieuw indelen als de schermbreedte verandert (telefoon <-> pc / draaien).
window.addEventListener('resize', () => { if (state.view === 'board' && state.orders) setupBoardTabs(); });

// Verzet een opdracht naar de volgende kolom (voor swipe-rechts op mobiel).
// BEWUST GEEN bevestigingsvraag vooraf (dat vertraagt het werken op de telefoon):
// we onthouden de vorige kolom en bieden achteraf "Ongedaan maken" aan — hetzelfde
// patroon als de prullenbak. Zo is een per ongeluk geveegde kaart nooit een probleem.
function advanceStatus(id, dir = 1) {
  const o = state.orders.find((x) => x.id === id); if (!o) return;
  const keys = (state.meta.statuses || []).map((s) => s.key);
  const i = keys.indexOf(o.status);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= keys.length) { toast(dir > 0 ? 'Al in de laatste kolom' : 'Al in de eerste kolom', true); loadBoard(); return; }
  const next = keys[j];
  const vorige = o.status;   // vóór de wijziging vastleggen — hier zet de undo-knop 'm op terug
  o.status = next;
  api(`/api/orders/${id}`, 'PATCH', { status: next })
    .then(() => {
      loadBoard();
      toastUndo('Verzet naar ' + statusLabel(next), async () => {
        await api(`/api/orders/${id}`, 'PATCH', { status: vorige });
        toast('Teruggezet naar ' + statusLabel(vorige));
        loadBoard();
      });
    })
    .catch((e) => { toast(e.message, true); loadBoard(); });
}

// Swipe-acties op kaarten (alleen mobiel): rechts = volgende kolom, links = vorige kolom.
// (Verwijderen gaat NIET via swipe — daarvoor is het prullenbak-knopje op de kaart.)
function bindCardSwipe() {
  if (!window.matchMedia('(max-width: 820px)').matches || state.me.role === 'monteur') return;
  $$('#board .card').forEach((card) => {
    let x0 = 0, y0 = 0, dx = 0, dragging = false, decided = false, horiz = false;
    card.addEventListener('touchstart', (e) => {
      const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; dx = 0; dragging = true; decided = false; horiz = false;
      window._dragging = true;   // bord niet verversen midden in een veegbeweging
      card.style.transition = '';
    }, { passive: true });
    card.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      const t = e.touches[0]; dx = t.clientX - x0; const dy = t.clientY - y0;
      if (!decided && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) { decided = true; horiz = Math.abs(dx) > Math.abs(dy); }
      if (horiz) { e.preventDefault(); card.style.transform = `translateX(${dx}px)`; card.style.opacity = String(Math.max(0.55, 1 - Math.abs(dx) / 360)); }
    }, { passive: false });
    // Vinger van het scherm zonder net touchend (bv. inkomend telefoontje): rem eraf.
    card.addEventListener('touchcancel', () => { window._dragging = false; dragging = false; card.style.transform = ''; card.style.opacity = ''; });
    card.addEventListener('touchend', () => {
      window._dragging = false;
      if (!dragging) return; dragging = false;
      card.style.transition = 'transform .16s ease, opacity .16s ease';
      card.style.transform = ''; card.style.opacity = '';
      const id = card.dataset.id;
      if (horiz && Math.abs(dx) >= 95) {
        card.dataset.swiped = '1'; setTimeout(() => { delete card.dataset.swiped; }, 400);
        advanceStatus(id, dx > 0 ? 1 : -1); // rechts = volgende, links = vorige
      }
    });
  });
}

// SELECTIE LEEFT IN HET GEHEUGEN, niet alleen in de vinkjes op het scherm. Anders
// was je selectie weg zodra het bord opnieuw werd opgebouwd (dat gebeurt automatisch
// zodra er ergens iets verandert) — precies de klacht "na een halve minuut is mijn
// selectie verdwenen en kan ik niets meer toepassen".
const boardSel = new Set();
let _lastBoardHtml = '';   // laatst getekende bord, om nutteloos hertekenen te herkennen
let _lastArchHtml = '';    // idem voor de ingeklapte week-agenda's
let _lastOvHtml = '';      // idem voor de Start-pagina
function selectedCardIds() { return [...boardSel]; }
function clearBoardSel() { boardSel.clear(); $$('.card-check').forEach((c) => (c.checked = false)); updateBoardBulk(); }
function updateBoardBulk() {
  const bar = $('#boardBulkBar'); if (!bar) return;
  const ids = selectedCardIds();
  bar.hidden = ids.length === 0;
  const c = $('#boardBulkCount'); if (c) c.textContent = `${ids.length} geselecteerd`;
}

function cardHTML(o) {
  const sm = sourceMeta(o.source);
  // Duidelijke, gekleurde status-pill vooraan zodat de status meteen opvalt.
  const stCol = statusColor(o.status);
  const meta = [`<span class="chip status-pill" style="color:${esc(stCol)};background:${esc(stCol)}1f;border-color:${esc(stCol)}66">${esc(statusLabel(o.status))}</span>`];
  meta.push(`<span class="chip ${sm.cls}">${sourceIcon(o.source)} ${esc(o.source || 'Handmatig')}</span>`);
  if (o.isDrs) { const gl = orderGroupLabel(o); meta.push(`<span class="chip chip-drs" title="Afkomstig uit WhatsApp-groep: ${esc(o.originGroup || 'opdrachtgroep')}">${esc(gl)}</span>`); }
  if (o.monteur) meta.push(`<span class="chip mont">${icon('wrench', 13)} ${esc(o.monteur.name)}</span>`);
  if (o.sentToMonteur) meta.push(`<span class="chip src-whatsapp" title="Verstuurd naar ${esc(o.sentToMonteur.monteurName)}">${icon('whatsapp', 13)} naar ${esc(o.sentToMonteur.monteurName)}</span>`);
  if (o.urgent) meta.push(`<span class="chip urgent">${icon('bolt', 13)} spoed</span>`);
  if (o.appointmentAt) meta.push(`<span class="chip">${icon('calendar', 13)} ${fmtDate(o.appointmentAt)}</span>`);
  if (o.snoozeDue) meta.push(`<span class="chip urgent" title="De opvolg-herinnering is verlopen — actie nodig">${icon('clock', 13)} opvolgen!</span>`);
  else if (o.snoozeAt) meta.push(`<span class="chip" title="Opvolg-herinnering ingesteld">${icon('clock', 13)} ${fmtDate(o.snoozeAt)}</span>`);
  if (o.attachments && o.attachments.length) meta.push(`<span class="chip">${icon('paperclip', 13)} ${o.attachments.length}</span>`);
  if (o.autoReplied) meta.push(`<span class="chip chip-ack" title="Automatische ontvangstbevestiging verstuurd">${icon('mail', 12)} bevestigd</span>`);
  // Suggesties (lead-instroom wetten): het systeem voegt nooit zelf samen of wijzigt
  // nooit zelf klantgegevens — deze chips vragen om een menselijke beslissing.
  if (o.mergeSuggestion) meta.push(`<span class="chip chip-sug" title="Mogelijk zelfde opdracht als een open kaart van deze klant — open de kaart om samen te voegen of te negeren">${icon('merge', 13)} dubbel?</span>`);
  if (o.dataSuggestions && o.dataSuggestions.length) meta.push(`<span class="chip chip-sug" title="Deze aanvraag wijkt af van het klantrecord — open de kaart om bij te werken of te negeren">${icon('user', 13)} gegevens-check</span>`);
  if (o.customerIncomplete) meta.push(`<span class="chip urgent" title="Geen echte klantnaam in het bericht gevonden — vul de klantgegevens aan">${icon('user', 13)} klant onbekend</span>`);
  // Status-stip: beantwoord (groen) > geopend (blauw) > nieuw/ongelezen (geel).
  const st = o.lastReplyAt ? { c: 'replied', t: 'Beantwoord' }
    : o.openedAt ? { c: 'opened', t: 'Geopend' }
    : { c: 'new', t: 'Nieuw — nog niet bekeken' };
  const replyCount = o.unreadReplies || 0;
  const replyLabel = replyCount > 1 ? `${replyCount} nieuwe berichten` : 'Nieuw bericht';
  const canDel = state.me.role !== 'monteur';
  return `
    <div class="card ${o.urgent ? 'urgent' : ''} ${st.c === 'new' ? 'is-new' : ''} ${o.customerReplied ? 'replied-alert' : ''}" data-id="${o.id}" draggable="true" style="border-left-color:${esc(statusColor(o.status))}">
      ${canDel ? `<label class="card-select" title="Selecteren"><input type="checkbox" class="card-check" data-id="${o.id}"${boardSel.has(o.id) ? ' checked' : ''}></label>` : ''}
      ${canDel ? `<button class="card-trash" data-del="${o.id}" title="Naar prullenbak">${icon('trash', 14)}</button>` : ''}
      ${o.customerReplied ? `<div class="reply-banner">${icon('message', 12)} ${replyLabel}</div>` : ''}
      <div class="card-title"><span class="state-dot ${st.c}" title="${st.t}"></span><span class="card-title-txt">${esc(o.title)}</span>${replyCount ? `<span class="title-count" title="${replyLabel}">${replyCount}</span>` : ''}</div>
      ${o.customer ? `<div class="card-customer">${icon('user', 13)} ${esc(o.customer.name)}${o.customer.phone ? ' · ' + esc(o.customer.phone) : ''}</div>` : ''}
      ${o.customer && placeName(o.customer.address) ? `<div class="card-place">${icon('pin', 13)} ${esc(placeName(o.customer.address))}</div>` : ''}
      <div class="card-meta">${meta.join('')}</div>
      <div class="card-foot">${icon('clock', 12)} Binnen: ${esc(fmtDateShort(o.createdAt))}</div>
    </div>`;
}

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Haalt de plaatsnaam uit een adres ("Straat 12, 1234 AB Plaats" -> "Plaats").
// Valt terug op het laatste deel na een komma, of het adres zelf.
function placeName(addr) {
  if (!addr) return '';
  const s = String(addr).trim();
  const m = s.match(/\d{4}\s?[a-z]{2}\s+(.+)$/i); // tekst na de postcode = plaats
  if (m) return m[1].replace(/,.*$/, '').trim();
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : s;
}

// Splitst een e-mail/bericht in 'nieuwe tekst' en 'geciteerde tekst' (de >-regels en
// reply-headers eronder). Zo leest de historie als een nette chat — niet steeds de hele
// oude mail eronder geplakt. De geciteerde tekst gaat achter een "toon citaat"-knopje.
function splitQuoted(body) {
  const raw = (body || '').replace(/\r\n/g, '\n');
  const lines = raw.split('\n');
  const markers = [
    /^\s*>/,                                       // geciteerde regel (Gmail e.d.)
    /^\s*-----.*schreef.*-----/i,                  // ons eigen citaat-formaat
    /^\s*Op .*schreef.*:\s*$/i,                    // Gmail NL: "Op … schreef …:"
    /^\s*On .*wrote:\s*$/i,                         // Gmail EN: "On … wrote:"
    /^\s*(Van|From|Verzonden|Sent):\s/i,           // Outlook header-blok
    /^\s*-{2,}\s*Oorspronkelijk bericht/i,         // Outlook NL
    /^\s*_{5,}\s*$/,                                // Outlook scheidingslijn
  ];
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    if (markers.some((m) => m.test(lines[i]))) { cut = i; break; }
  }
  if (cut < 0) return { text: raw.trim(), quoted: '' };
  const text = lines.slice(0, cut).join('\n').trim();
  const quoted = lines.slice(cut).join('\n').replace(/^\s*>\s?/gm, '').trim();
  if (!text) return { text: quoted || raw.trim(), quoted: '' }; // alles was citaat → toch tonen
  return { text, quoted };
}

// Toont bijlagen als thumbnails (foto) of speler/bestand-tegels.
// LET OP video + audio: die kregen de klasse .att mee, en die is hard 76x76 px —
// een spraakbericht of filmpje was daardoor een onbruikbaar blokje (afspeelknop
// half afgesneden). Ze staan nu op een eigen regel over de volle breedte van de
// strook, met bestandsnaam erbij, zodat je ze gewoon kunt afspelen.
// Sommige oudere bijlages hebben alleen een mime en geen kind — daarom beide checken.
function attachmentsHTML(atts) {
  if (!atts || !atts.length) return '<div class="muted small">Nog geen foto’s of bestanden.</div>';
  const isKind = (a, soort) => a.kind === soort || new RegExp('^' + soort + '/').test(a.mime || '');
  return atts.map((a) => {
    const naam = a.filename || '';
    if (isKind(a, 'image')) return `<a class="att att-img" href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(naam)}"><img src="${esc(a.url)}" loading="lazy"></a>`;
    // GEEN witruimte/regeleinden tussen deze tags: in de gesprekshistorie staat de
    // strook in een chat-bubbel met white-space:pre-wrap, en dan wordt elke regel
    // afbreking als lege regel getekend (gemeten: 527px i.p.v. 257px per bericht).
    if (isKind(a, 'video')) return `<div class="att-video" style="flex:1 1 100%;max-width:380px;min-width:0;white-space:normal"><video controls preload="metadata" playsinline style="width:100%;max-height:240px;border-radius:10px;background:#000;display:block"><source src="${esc(a.url)}"${a.mime ? ` type="${esc(a.mime)}"` : ''}></video><div class="muted small" style="display:flex;align-items:center;gap:6px;margin-top:3px">${icon('video', 13)}<a href="${esc(a.url)}" target="_blank" rel="noopener" style="color:inherit">${esc((naam || 'video').slice(0, 40))}</a></div></div>`;
    if (isKind(a, 'audio')) return `<div class="att-audio" style="flex:1 1 100%;max-width:380px;min-width:0;white-space:normal"><div class="muted small" style="display:flex;align-items:center;gap:6px;margin-bottom:3px">${icon('mic', 13)}${esc((naam || 'spraakbericht').slice(0, 40))}</div><audio controls preload="metadata" style="width:100%;display:block" src="${esc(a.url)}"></audio></div>`;
    return `<a class="att att-file" href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(naam)}">${icon('file', 22)}<span>${esc((naam || 'bestand').slice(0, 14))}</span></a>`;
  }).join('');
}

// Datum + tijd voltuit, bv. "31 mei 2026, 14:07"
function fmtDateShort(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusOptionsHTML(selected) {
  return (state.meta.statuses || []).map((s) => `<option value="${esc(s.key)}" ${selected === s.key ? 'selected' : ''}>${esc(s.label)}</option>`).join('');
}

// ---------- Order modal ----------
// Kaarten samenvoegen: kies andere opdrachten (zelfde klant of handmatig) die in
// deze kaart moeten opgaan (historie + foto's komen samen).
// Opdracht naar een monteur(-groep) sturen.
function openSendMonteurModal(order) {
  const opts = state.monteurs.map((m) => `<option value="${m.id}" ${order.monteurId === m.id ? 'selected' : ''} ${!m.waGroup ? 'disabled' : ''}>${esc(m.name)}${m.waGroup ? ' — ' + esc(m.waGroup) : ' (geen WhatsApp-groep)'}</option>`).join('');
  const imgs = (order.attachments || []).filter((a) => /^image\//.test(a.mime || ''));
  modal(`
    <h2>Naar monteur sturen</h2>
    <p class="muted small">De opdracht wordt als nette samenvatting naar de WhatsApp-groep van de monteur gestuurd via de bridge.</p>
    <label>Monteur <select id="sm-monteur">${opts || '<option>(geen monteurs)</option>'}</select></label>
    ${imgs.length ? `
    <label style="margin-top:10px">Foto's meesturen <span class="muted small">— vink aan wat de monteur moet zien (max 6)</span>
      <button type="button" class="btn btn-sm" id="sm-imgall" style="margin-left:8px">alles</button></label>
    <div class="attach-grid" style="margin-top:6px">${imgs.map((a) => `
      <label class="sm-imgpick" style="position:relative;cursor:pointer;display:block">
        <input type="checkbox" class="sm-img" value="${esc(a.id)}" style="position:absolute;top:6px;left:6px;width:18px;height:18px;z-index:2;accent-color:var(--accent)">
        <img src="${esc(a.url)}" alt="" style="width:100%;height:90px;object-fit:cover;border-radius:8px;display:block;border:2px solid transparent">
      </label>`).join('')}</div>` : ''}
    <p class="muted small">Heeft de monteur nog geen WhatsApp-groep? Stel die in bij Monteurs.</p>
    <div class="modal-actions"><span></span><div class="right"> <button class="btn" id="sm-cancel">Annuleren</button> <button class="btn btn-primary" id="sm-send">Versturen</button> </div></div>`);
  // Aangevinkte foto krijgt een blauw kader (duidelijk op mobiel).
  $$('.sm-img').forEach((c) => c.addEventListener('change', () => { c.nextElementSibling.style.borderColor = c.checked ? 'var(--accent)' : 'transparent'; }));
  const allBtn = $('#sm-imgall');
  if (allBtn) allBtn.onclick = () => $$('.sm-img').forEach((c) => { c.checked = true; c.nextElementSibling.style.borderColor = 'var(--accent)'; });
  $('#sm-cancel').onclick = () => openOrderModal(order.id);
  $('#sm-send').onclick = async () => {
    const monteurId = $('#sm-monteur').value;
    if (!monteurId) return toast('Kies een monteur', true);
    const attachmentIds = $$('.sm-img:checked').map((c) => c.value);
    try {
      await api(`/api/orders/${order.id}/send-monteur`, 'POST', { monteurId, attachmentIds });
      closeModal(); toast(`In de wachtrij gezet${attachmentIds.length ? ` met ${attachmentIds.length} foto('s)` : ''} — wordt verstuurd`); loadBoard();
    } catch (err) { toast(err.message, true); }
  };
}

function openMergeModal(primary) {
  // Kandidaten: andere actieve kaarten, dezelfde klant bovenaan.
  const others = state.orders.filter((o) => o.id !== primary.id);
  const sameCustomer = others.filter((o) => o.customerId && o.customerId === primary.customerId);
  const rest = others.filter((o) => !(o.customerId && o.customerId === primary.customerId));
  const row = (o, suggested) => `
    <label class="dup-row"><input type="checkbox" class="mg-pick" value="${o.id}" ${suggested ? 'checked' : ''}>
      <span><strong>${esc(o.title)}</strong> <span class="muted">· ${esc(o.customer?.name || '')} · ${esc(statusLabel(o.status))} · ${o.attachments?.length || 0} bijlagen</span></span></label>`;
  modal(`
    <h2>Kaarten samenvoegen</h2>
    <p class="muted small">Alles wat je aanvinkt gaat op in deze kaart: <strong>${esc(primary.title)}</strong> (${esc(primary.customer?.name || '')}). Gesprekshistorie en foto's worden gecombineerd; de andere kaarten verdwijnen.</p>
    ${sameCustomer.length ? `<div class="muted small" style="margin:8px 0 4px">Zelfde klant (aangeraden):</div>${sameCustomer.map((o) => row(o, true)).join('')}` : '<div class="muted small">Geen andere kaarten van dezelfde klant gevonden.</div>'}
    ${rest.length ? `<details style="margin-top:10px"><summary class="muted small" style="cursor:pointer">Andere kaarten tonen (${rest.length})</summary>${rest.slice(0, 40).map((o) => row(o, false)).join('')}</details>` : ''}
    <div class="modal-actions"><span></span><div class="right"> <button class="btn" id="mg-cancel">Annuleren</button> <button class="btn btn-primary" id="mg-save">Samenvoegen</button> </div></div>`);
  $('#mg-cancel').onclick = () => openOrderModal(primary.id);
  $('#mg-save').onclick = async () => {
    const ids = $$('.mg-pick:checked').map((c) => c.value);
    if (!ids.length) return toast('Selecteer minstens één kaart', true);
    try { await api('/api/orders/merge', 'POST', { primaryId: primary.id, mergeIds: ids }); closeModal(); toast(`${ids.length} kaart(en) samengevoegd`); loadBoard(); }
    catch (err) { toast(err.message, true); }
  };
}

function openOrderModal(id, pool) {
  const list = pool || state.orders;
  const o = id ? list.find((x) => x.id === id) : null;
  const canWrite = state.me.role !== 'monteur';
  const isMonteur = state.me.role === 'monteur';
  const monteurOpts = '<option value="">— geen monteur —</option>' +
    state.monteurs.map((m) => `<option value="${m.id}" ${o?.monteurId === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('');

  modal(`
    <h2>${o ? 'Opdracht bewerken' : 'Nieuwe opdracht'}</h2> ${o ? `<p class="muted small" style="margin:-8px 0 14px">Binnengekomen: <strong>${esc(fmtDateShort(o.createdAt))}</strong>${o.updatedAt ? ' · laatst bijgewerkt ' + esc(fmtDateShort(o.updatedAt)) : ''}</p>` : ''}
    ${o && o.sentToMonteur ? `<div class="sent-monteur">${icon('whatsapp', 13)} Verstuurd naar monteur ${esc(o.sentToMonteur.monteurName)} · ${fmtDateShort(o.sentToMonteur.at)}${o.sentToMonteur.status === 'sent' ? ' ✓' : o.sentToMonteur.status === 'failed' ? ' (mislukt)' : ' (wachtrij)'}</div>` : ''}
    ${o && o.customerIncomplete ? `<div class="sug-banner sug-warn">${icon('user', 13)} <strong>Klant onbekend — aanvullen.</strong> Er is geen echte klantnaam in het bericht gevonden (de afzender is nooit automatisch de klant). Vul hieronder de klantgegevens aan.</div>` : ''}
    ${o && o.mergeSuggestion ? `<div class="sug-banner">${icon('merge', 13)} Mogelijk zelfde opdracht als de open kaart <strong>${esc(o.mergeSuggestion.title)}</strong> van deze klant. Niets is automatisch samengevoegd. <span class="sug-actions"><button type="button" class="btn btn-sm" id="sug-merge-do">Samenvoegen</button> <button type="button" class="btn btn-sm" id="sug-merge-no">Negeren</button></span></div>` : ''}
    ${o && o.dataSuggestions && o.dataSuggestions.length ? `<div class="sug-banner">${icon('user', 13)} <strong>Deze aanvraag wijkt af van het klantrecord.</strong> Niets is automatisch gewijzigd; de kaart gebruikt de gegevens uit de aanvraag.${o.dataSuggestions.map((sg) => `<div class="sug-row">${esc(sg.field)}: <span class="muted">"${esc(sg.from || '—')}"</span> → <strong>"${esc(sg.to)}"</strong> <span class="sug-actions"><button type="button" class="btn btn-sm sug-apply" data-field="${esc(sg.field)}">Bijwerken</button> <button type="button" class="btn btn-sm sug-skip" data-field="${esc(sg.field)}">Negeren</button></span></div>`).join('')}</div>` : ''}
    <label>Titel <input id="f-title" value="${esc(o?.title || '')}" ${isMonteur ? 'disabled' : ''} placeholder="bv. Cilinderslot vervangen"></label>
    <div class="form-sec">${icon('user', 13)} Klantgegevens</div> ${!o ? `
      <div class="row"> <label>Klantnaam <input id="f-cname" placeholder="Naam klant"></label> <label>Telefoon <input id="f-cphone" placeholder="06-…"></label> </div> <div class="row"> <label>E-mail klant <input id="f-cemail" placeholder="optioneel"></label> <label>Adres <input id="f-caddress" placeholder="Straat, postcode, plaats"></label> </div> ` : `
      <div class="row"> <label>Klantnaam <input id="f-ccname" value="${esc(o.customer?.name || '')}" ${isMonteur ? 'disabled' : ''}></label> <label>Telefoon <input id="f-ccphone" value="${esc(o.customer?.phone || '')}" ${isMonteur ? 'disabled' : ''}></label> </div> <div class="row"> <label>E-mail <input id="f-ccemail" value="${esc(o.customer?.email || '')}" ${isMonteur ? 'disabled' : ''} placeholder="e-mailadres klant"></label> <label>Adres <input id="f-ccaddress" value="${esc(o.customer?.address || '')}" ${isMonteur ? 'disabled' : ''}></label> </div>`}
    <div class="form-sec">${icon('calendar', 13)} Planning &amp; status</div> <div class="row"> <label class="status-field-label">${icon('tag', 13)} Status <select id="f-status" class="status-field">${statusOptionsHTML(o?.status)}</select></label> <label>Monteur <select id="f-monteur" ${isMonteur ? 'disabled' : ''}>${monteurOpts}</select></label> </div> <div class="row"> <label>Afspraak begin <input id="f-appt" type="datetime-local" step="1800" value="${o?.appointmentAt ? esc(o.appointmentAt.slice(0,16)) : ''}"></label> <label>Afspraak eind <input id="f-appt-end" type="datetime-local" step="1800" value="${o?.appointmentEndAt ? esc(o.appointmentEndAt.slice(0,16)) : ''}"></label> </div>${o && o.appointmentAt && canWrite ? `<button type="button" class="btn btn-sm" id="f-cancel-appt" style="margin:0 0 8px;color:var(--danger);border-color:var(--danger)">${icon('x', 13)} Afspraak annuleren (uit agenda + Google Agenda)</button>` : ''} <div class="row"> <label>Prijs <input id="f-price" value="${esc(o?.price || '')}" ${isMonteur ? 'disabled' : ''} placeholder="€"></label> <span></span> </div> ${canWrite ? `<label>Herkomst (bron) ${sourceSelect(o?.source || 'Handmatig')}</label>` : ''}
    <div class="form-sec">${icon('message', 13)} Intern</div> <label>Notities <textarea id="f-notes" rows="3" placeholder="Interne notities">${esc(o?.notes || '')}</textarea></label> ${canWrite ? `<label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="f-urgent" style="width:auto" ${o?.urgent ? 'checked' : ''}>Spoed</label>` : ''}
    ${o ? `
      <div class="attach"> <div class="thread-head">${icon('paperclip', 15)} Foto's &amp; bestanden${o.attachments && o.attachments.length ? ` (${o.attachments.length})` : ''}
          <button class="btn btn-sm" id="f-addfile" type="button" style="margin-left:auto">+ Toevoegen</button> <input type="file" id="f-fileinput" accept="image/*,video/*,application/pdf" multiple hidden> </div> <div class="attach-grid" id="f-attachgrid">${attachmentsHTML(o.attachments)}</div> </div>` : ''}
    ${o && o.thread && o.thread.length ? `
      <div class="thread">
        <div class="thread-head">${icon('message', 16)} Gesprekshistorie <span class="thread-count">${o.thread.length}</span>${o.thread.length ? `<span class="thread-last muted">laatste: ${fmtDate(o.thread[o.thread.length - 1].at)}</span>` : ''}<input id="f-chatsearch" type="search" placeholder="Zoeken…" style="margin-left:8px;max-width:120px;padding:4px 9px;font-size:12px" title="Zoek in de berichten hieronder">${o.customerId ? `<button type="button" class="btn btn-sm" id="f-history" style="margin-left:6px" title="Alle WhatsApp- en e-mailberichten van deze klant, over alle kaarten heen — gewoon terugscrollen">${icon('clock', 12)} Alles van deze klant</button>` : ''}</div>
        <div class="chat" id="f-chat">
          ${o.thread.map((t) => {
            const q = splitQuoted(t.body || '');
            // FormSubmit-notificaties (van de website) standaard inklappen — de directe
            // CRM-aanvraag is leidend; de FormSubmit-kopie is alleen back-up.
            const isForm = /formsubmit\.co/i.test(t.sender || '') || /submitted your form on|formsubmit/i.test(t.body || '');
            const meta = `<div class="chat-meta">${t.outgoing ? icon('reply', 12) : sourceIcon(t.channel)} ${esc(t.sender || (t.outgoing ? 'Keyservice' : 'Klant'))} · ${fmtDate(t.at)}${canWrite && t.id ? ` <button type="button" class="chat-del" data-thr="${esc(t.id)}" title="Dit bericht uit de historie verwijderen">${icon('x', 12)}</button>` : ''}</div>`;
            const bubble = `<div class="chat-bubble">${esc(q.text)}${q.quoted ? `<button type="button" class="quote-toggle">${icon('message', 11)} toon eerdere berichten</button><div class="quoted-block" hidden>${esc(q.quoted)}</div>` : ''}${t.attachments && t.attachments.length ? `<div class="attach-grid" style="margin-top:8px">${attachmentsHTML(t.attachments)}</div>` : ''}</div>`;
            if (isForm) return `<div class="chat-msg in form-msg" data-thr="${esc(t.id || '')}"><details class="form-collapse"><summary class="muted small">${icon('mail', 12)} FormSubmit-kopie (website) · ${fmtDate(t.at)} — klik om te tonen</summary>${meta}${bubble}</details></div>`;
            return `<div class="chat-msg ${t.outgoing ? 'out' : 'in'}" data-thr="${esc(t.id || '')}">${meta}${bubble}</div>`;
          }).join('')}
        </div>
      </div>` : ''}
    <div class="modal-actions"> ${o && canWrite ? '<button class="btn btn-danger" id="f-delete">Verwijderen</button>' : '<span></span>'}
      <div class="right"> ${o && o.customer?.address ? `<a class="btn" id="f-nav" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(o.customer.address)}" title="Navigeer naar het klantadres">${icon('pin', 14)} Navigeer</a>` : ''} ${o ? `<a class="btn" id="f-gcal" target="_blank" rel="noopener" title="Afspraak in Google Agenda zetten">${icon('calendar', 14)} Google Agenda</a>` : ''} ${o ? `<button class="btn" id="f-werkbon">${icon('tag', 14)} Werkbon${o.werkbon ? ' ✓' : ''}</button>` : ''} ${o ? `<button class="btn" id="f-invoice">${icon('mail', 14)} Factuur</button>` : ''} ${o ? `<button class="btn" id="f-quote">${icon('file', 14)} Offerte</button>` : ''} ${o && canWrite ? `<button class="btn" id="f-snooze">${icon('clock', 14)} Herinnering</button>` : ''} ${o && canWrite ? `<button class="btn" id="f-send-monteur">${icon('whatsapp', 14)} ${o.sentToMonteur ? 'Opnieuw naar monteur' : 'Stuur naar monteur'}</button>` : ''} ${o ? `<button class="btn" id="f-onweg" title="Stuur de klant een mail + appje dat de monteur nu onderweg is">${icon('pin', 14)} Onderweg${o.onderwegAt ? ' ✓' : ''}</button>` : ''} ${o && canWrite ? `<button class="btn" id="f-merge">${icon('merge', 14)} Samenvoegen</button>` : ''} ${o ? `<button class="btn" id="f-reply">${icon('reply', 14)} Snel antwoord</button>` : ''}
        <button class="btn" id="f-cancel">Sluiten</button> <button class="btn btn-primary" id="f-save">Opslaan</button> </div> </div> `);
  bindSourceSelect($('#modal [data-source]'));
  // Suggestie-knoppen (lead-instroom wetten): de mens beslist, het systeem nooit.
  if (o && o.mergeSuggestion) {
    $('#sug-merge-do').onclick = async () => {
      if (!confirm(`Deze kaart samenvoegen met "${o.mergeSuggestion.title}"? De berichten en bijlages gaan mee naar die kaart.`)) return;
      try { await api('/api/orders/merge', 'POST', { primaryId: o.mergeSuggestion.orderId, mergeIds: [o.id] }); toast('Kaarten samengevoegd'); closeModal(); loadBoard(); }
      catch (err) { toast(err.message, true); }
    };
    $('#sug-merge-no').onclick = async () => {
      try { await api(`/api/orders/${o.id}/merge-suggestion`, 'POST', {}); toast('Suggestie weggehaald'); closeModal(); loadBoard(); }
      catch (err) { toast(err.message, true); }
    };
  }
  if (o && o.dataSuggestions && o.dataSuggestions.length) {
    $$('.sug-apply', $('#modal')).forEach((btn) => btn.onclick = async () => {
      try { await api(`/api/orders/${o.id}/data-suggestion`, 'POST', { field: btn.dataset.field, action: 'apply' }); toast('Klantrecord bijgewerkt'); closeModal(); loadBoard(); }
      catch (err) { toast(err.message, true); }
    });
    $$('.sug-skip', $('#modal')).forEach((btn) => btn.onclick = async () => {
      try { await api(`/api/orders/${o.id}/data-suggestion`, 'POST', { field: btn.dataset.field, action: 'skip' }); toast('Suggestie genegeerd'); closeModal(); loadBoard(); }
      catch (err) { toast(err.message, true); }
    });
  }
  // Status-veld laten opvallen: kader kleurt mee met de gekozen status.
  {
    const stEl = $('#f-status');
    if (stEl) {
      const paint = () => { const c = statusColor(stEl.value); stEl.style.borderColor = c; stEl.style.boxShadow = `0 0 0 3px ${c}22`; };
      paint(); stEl.addEventListener('change', paint);
    }
  }
  // Eindtijd automatisch op +1 uur zetten zodra je een begintijd kiest (en de eindtijd
  // nog leeg is of vóór de begintijd ligt). Je kunt 'm daarna altijd handmatig aanpassen.
  {
    const apptEl = $('#f-appt'), apptEndEl = $('#f-appt-end');
    if (apptEl && apptEndEl) apptEl.addEventListener('change', () => {
      if (!apptEl.value) return;
      if (!apptEndEl.value || apptEndEl.value <= apptEl.value) {
        const d = new Date(apptEl.value);
        d.setMinutes(d.getMinutes() + 60);
        const p = (n) => String(n).padStart(2, '0');
        apptEndEl.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
      }
    });
  }
  // Gesprek meteen naar het nieuwste bericht scrollen.
  const chat = $('#f-chat'); if (chat) chat.scrollTop = chat.scrollHeight;
  // Zoeken in de gesprekshistorie: filtert live de berichten (werkt óók in de
  // "Alles van deze klant"-weergave, want het kijkt naar wat er nu in de chat staat).
  {
    const zoek = $('#f-chatsearch');
    if (zoek && chat) zoek.addEventListener('input', () => {
      const q = zoek.value.toLowerCase().trim();
      $$('.chat-msg', chat).forEach((m) => { m.style.display = !q || m.textContent.toLowerCase().includes(q) ? '' : 'none'; });
      if (!q) chat.scrollTop = chat.scrollHeight;
    });
  }
  // VOLLEDIGE klanthistorie in het chat-blok: één klik toont alle WhatsApp- en
  // e-mailberichten van deze klant over ALLE kaarten heen (incl. losse inbox-
  // berichten), chronologisch met datum-scheiders en een kaart-label. Nog een
  // klik en je bent terug bij alleen deze kaart.
  {
    const histBtn = $('#f-history');
    if (histBtn && chat && o) {
      let origHTML = null;
      histBtn.onclick = async () => {
        if (origHTML !== null) {
          chat.innerHTML = origHTML; origHTML = null;
          histBtn.innerHTML = `${icon('clock', 12)} Alles van deze klant`;
          chat.scrollTop = chat.scrollHeight;
          return;
        }
        histBtn.disabled = true;
        try {
          const h = await api(`/api/customers/${o.customerId}/history`);
          origHTML = chat.innerHTML;
          let lastDay = '';
          chat.innerHTML = (h.items || []).map((t) => {
            const day = String(t.at || '').slice(0, 10);
            const sep = day && day !== lastDay ? `<div class="muted small" style="text-align:center;margin:10px 0 4px">— ${esc(new Date(day + 'T12:00:00').toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))} —</div>` : '';
            if (day) lastDay = day;
            const label = t.standalone
              ? '<span class="chip" style="font-size:10px;padding:1px 7px">los bericht (inbox)</span>'
              : (t.orderId && t.orderId !== o.id ? `<span class="chip" style="font-size:10px;padding:1px 7px" title="Uit een andere kaart van deze klant">${esc((t.orderTitle || 'andere kaart').slice(0, 40))}</span>` : '');
            const q = splitQuoted(t.body || '');
            return `${sep}<div class="chat-msg ${t.outgoing ? 'out' : 'in'}"><div class="chat-meta">${t.outgoing ? icon('reply', 12) : sourceIcon(t.channel)} ${esc(t.sender || (t.outgoing ? 'Keyservice' : 'Klant'))} · ${fmtDate(t.at)} ${label}</div><div class="chat-bubble">${esc(q.text)}${t.attachments && t.attachments.length ? `<div class="attach-grid" style="margin-top:8px">${attachmentsHTML(t.attachments)}</div>` : ''}</div></div>`;
          }).join('') || '<div class="empty">Geen berichten gevonden voor deze klant.</div>';
          histBtn.innerHTML = `${icon('clock', 12)} Alleen deze kaart`;
          chat.scrollTop = chat.scrollHeight;
        } catch (err) { toast(err.message, true); }
        finally { histBtn.disabled = false; }
      };
    }
  }
  // Los bericht uit de historie verwijderen (opschonen van spam/verkeerd toegevoegd).
  // GEDELEGEERD op de chat-container: overleeft ook het heen-en-weer wisselen van
  // "Alles van deze klant" (innerHTML-vervanging zou losse knop-handlers doden).
  if (chat && o) chat.addEventListener('click', async (e) => {
    const b = e.target.closest('.chat-del');
    if (!b) return;
    e.stopPropagation();
    if (!confirm('Dit bericht uit de gesprekshistorie verwijderen?')) return;
    try {
      await api(`/api/orders/${o.id}/thread/${b.dataset.thr}`, 'DELETE');
      o.thread = (o.thread || []).filter((t) => t.id !== b.dataset.thr);
      b.closest('.chat-msg')?.remove();
      toast('Bericht verwijderd uit historie');
    } catch (err) { toast(err.message, true); }
  });
  if (o) $('#f-reply').onclick = () => openReplyModal({ name: o.customer?.name, email: o.customer?.email, phone: o.customer?.phone, orderId: o.id, title: o.title, thread: o.thread || [] });
  // "Zet in Google Agenda": gebruikt de actuele velden in het formulier op het moment van klikken.
  if (o) { const g = $('#f-gcal'); if (g) g.onclick = (e) => {
    const appt = $('#f-appt')?.value;
    if (!appt) { e.preventDefault(); toast('Vul eerst een afspraak (datum/tijd) in', true); return; }
    const det = [o.customer?.phone ? 'Tel: ' + o.customer.phone : '', $('#f-notes')?.value || '', 'Via Keyservice CRM'].filter(Boolean).join('\n');
    g.href = googleCalUrl({ title: $('#f-title')?.value || o.title, at: appt, end: $('#f-appt-end')?.value, details: det, location: o.customer?.address || '' });
  }; }
  if (o && canWrite) $('#f-merge').onclick = () => openMergeModal(o);
  if (o && canWrite) $('#f-send-monteur').onclick = () => openSendMonteurModal(o);
  if (o && canWrite && $('#f-snooze')) $('#f-snooze').onclick = () => openSnoozeModal(o);
  if (o && $('#f-werkbon')) $('#f-werkbon').onclick = () => openWerkbonModal(o);
  if (o && $('#f-invoice')) $('#f-invoice').onclick = () => openInvoiceModal(o);
  if (o && $('#f-quote')) $('#f-quote').onclick = () => openInvoiceModal(o, 'offerte');
  if (o && $('#f-onweg')) $('#f-onweg').onclick = async () => {
    if (!confirm(`Klant laten weten dat de monteur nu onderweg is?${o.onderwegAt ? ' (Er is al eerder een onderweg-bericht gestuurd.)' : ''}`)) return;
    try { const r = await api(`/api/orders/${o.id}/onderweg`, 'POST', {}); toast(r.summary || 'Onderweg-bericht verstuurd'); closeModal(); loadBoard(); }
    catch (err) { toast(err.message, true); }
  };
  // Afspraak annuleren: haalt de datum weg (verdwijnt uit de agenda + Google Agenda) en
  // brengt desgewenst de klant op de hoogte. De opdracht zelf blijft bestaan.
  if (o && canWrite && $('#f-cancel-appt')) $('#f-cancel-appt').onclick = async () => {
    if (!confirm('Afspraak annuleren?\n\nDe afspraak wordt uit de agenda én uit Google Agenda verwijderd. De opdracht zelf blijft staan.')) return;
    const notifyCustomer = confirm('Wil je de klant hierover een bericht sturen (annulering)?\n\nOK = klant op de hoogte brengen · Annuleren = geen bericht');
    try {
      await api(`/api/orders/${o.id}`, 'PATCH', { appointmentAt: null, appointmentEndAt: null, notifyCustomer });
      toast(notifyCustomer ? 'Afspraak geannuleerd — klant wordt op de hoogte gebracht' : 'Afspraak geannuleerd');
      closeModal();
      loadBoard();
    } catch (err) { toast(err.message, true); }
  };

  // Bijlagen toevoegen
  if (o) {
    const fileInput = $('#f-fileinput');
    $('#f-addfile').onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      const files = [...fileInput.files];
      if (!files.length) return;
      toast(`${files.length} bestand(en) uploaden…`);
      let gelukt = 0; let mislukt = 0; let laatsteFout = '';
      for (const file of files) {
        try {
          const dataBase64 = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = reject;
            fr.readAsDataURL(file);
          });
          const updated = await api(`/api/orders/${o.id}/attachments`, 'POST', { filename: file.name, mime: file.type, dataBase64 });
          o.attachments = updated.attachments || [];
          gelukt++;
        } catch (err) { mislukt++; laatsteFout = err.message || 'uploaden mislukt'; }
      }
      $('#f-attachgrid').innerHTML = attachmentsHTML(o.attachments);
      flash('#f-attachgrid');
      // Eerlijke melding: hier stond altijd "Toegevoegd", óók als élke upload faalde
      // (die foutmelding werd meteen overschreven).
      if (mislukt) toast(gelukt ? `${gelukt} toegevoegd, ${mislukt} mislukt: ${laatsteFout}` : `Uploaden mislukt: ${laatsteFout}`, true);
      else toast(gelukt === 1 ? 'Toegevoegd' : `${gelukt} bestanden toegevoegd`);
      loadBoard();
    };
  }

  $('#f-cancel').onclick = closeModal;
  $('#f-save').onclick = async () => {
    // Monteur: verplichte notitie voordat een opdracht naar offerte/afgerond/geannuleerd gaat.
    const noteRequired = ['offerte_verzonden', 'afgerond', 'geannuleerd'];
    if (isMonteur && o && $('#f-status').value !== o.status && noteRequired.includes($('#f-status').value) && !($('#f-notes').value || '').trim()) {
      toast('Vul eerst een notitie in (wat is er gedaan/afgesproken) voordat je deze status kiest.', true);
      $('#f-notes')?.focus();
      return;
    }
    const payload = {
      status: $('#f-status').value,
      appointmentAt: $('#f-appt').value || null,
      appointmentEndAt: $('#f-appt-end') ? ($('#f-appt-end').value || null) : null,
      notes: $('#f-notes').value,
    };
    if (canWrite) {
      payload.title = $('#f-title').value;
      payload.monteurId = $('#f-monteur').value || null;
      payload.price = $('#f-price').value;
      payload.source = $('#modal [data-source]')?.value || 'Handmatig';
      payload.urgent = $('#f-urgent')?.checked || false;
    }
    let klantFout = '';   // mislukte klant-update onthouden: nooit "Opgeslagen" liegen
    try {
      if (o) {
        // Klantgegevens op de kaart bewerkt? Dan gaan die naar het klantrecord ÉN
        // naar order.intake — zodat "Stuur naar monteur" altijd de verbeterde
        // gegevens gebruikt (nooit meer de oude AI-extractie).
        if (canWrite && o.customer) {
          const cp = { name: $('#f-ccname')?.value, phone: $('#f-ccphone')?.value, email: $('#f-ccemail')?.value, address: $('#f-ccaddress')?.value };
          payload.intake = { name: cp.name, phone: cp.phone, email: cp.email, address: cp.address };
          // Het klantrecord kan apart mislukken (bv. geen recht op Klanten, of een
          // serverfout). Die fout werd hier stil weggegooid en het scherm zei tóch
          // "Opgeslagen" — de gebruiker dacht dat de gegevens klopten terwijl ze weg
          // waren. De kaart zelf slaan we wél gewoon op, maar we melden het eerlijk.
          try { await api(`/api/customers/${o.customer.id}`, 'PATCH', cp); }
          catch (err) { klantFout = err.message || 'klantgegevens niet opgeslagen'; }
        }
        await api(`/api/orders/${o.id}`, 'PATCH', payload);
      } else {
        payload.customerName = $('#f-cname').value;
        payload.customerPhone = $('#f-cphone').value;
        payload.customerEmail = $('#f-cemail').value;
        payload.customerAddress = $('#f-caddress').value;
        if (!payload.title) return toast('Titel verplicht', true);
        if (!payload.customerName && !payload.customerPhone) return toast('Klantnaam of telefoon verplicht', true);
        await api('/api/orders', 'POST', payload);
      }
      // Ging de klant-update mis? Dan blijft het scherm open (je typwerk blijft staan)
      // en zie je de échte foutmelding van de server i.p.v. "Opgeslagen".
      if (klantFout) { toast('Kaart opgeslagen, maar de klantgegevens NIET: ' + klantFout, true); loadBoard(); return; }
      closeModal(); toast('Opgeslagen'); loadBoard();
    } catch (err) { toast(err.message, true); }
  };
  if (o && canWrite) $('#f-delete').onclick = async () => {
    if (!confirm('Opdracht verwijderen?')) return;
    try { await api(`/api/orders/${o.id}`, 'DELETE'); closeModal(); loadBoard(); toastUndo('Verwijderd', () => restoreOrders([o.id])); }
    catch (err) { toast(err.message, true); }
  };
}

// ---------- Inbox / reviews ----------
async function refreshInboxBadge() {
  try {
    const stats = await api('/api/stats');
    const n = stats.pendingReviews;
    const badge = $('#inboxBadge');
    if (badge) { badge.textContent = n; badge.hidden = n === 0; }
    const bn = $('#bnInboxBadge');
    if (bn) { bn.textContent = n; bn.hidden = n === 0; }
  } catch {}
}

const INBOX_PAGE = 60; // aantal berichten per keer renderen (voorkomt vastlopen)
let _lastInboxHtml = '';   // laatst getekende inbox, om nutteloos hertekenen te herkennen
async function loadInbox(append = false) {
  const filter = $('#inboxFilter')?.value || 'pending';
  if (!append) state._inboxOffset = 0;
  const offset = state._inboxOffset || 0;
  const resp = await api(`/api/reviews?status=${filter}&limit=${INBOX_PAGE}&offset=${offset}`);
  const reviews = resp.items || [];
  const total = resp.total || reviews.length;
  state._inboxOffset = offset + reviews.length;
  const list = $('#reviewList');
  const bulkBar = $('#bulkBar');
  // Bulk-balk en "alle geklets afwijzen"-knop alleen tonen wanneer relevant.
  if (bulkBar && state.me.role !== 'monteur') bulkBar.hidden = reviews.length === 0;
  // Op de prullenbak-weergave verbergen we approve/afwijs-acties; toon evt. 'legen'.
  const inTrash = filter === 'rejected';
  ['#bulkApproveBtn', '#bulkApprovePct', '#bulkRejectBtn', '#rejectAllOverigeBtn', '#rejectAllPendingBtn'].forEach((sel) => { const e = $(sel); if (e) e.style.display = inTrash ? 'none' : (sel.includes('Overige') ? (filter === 'overige' ? '' : 'none') : sel.includes('Pending') ? (filter === 'pending' ? '' : 'none') : ''); });
  if ($('#emptyRejectedBtn')) $('#emptyRejectedBtn').style.display = (inTrash && hasPerm('hardDelete')) ? '' : 'none';
  if ($('#selectAll')) $('#selectAll').checked = false;
  updateBulkCount();
  if (!append && !reviews.length) {
    if (bulkBar) bulkBar.hidden = true;
    list.innerHTML = filter === 'rejected'
      ? '<div class="empty">De inbox-prullenbak is leeg.</div>'
      : filter === 'overige'
      ? '<div class="empty">Geen overige berichten (geklets).</div>'
      : '<div class="empty">Geen berichten om te controleren. Goed bezig!</div>';
    return;
  }
  const rowsHTML = reviews.map(reviewHTML).join('');
  // Niets veranderd? Dan de lijst met rust laten. Anders werd de inbox bij élke
  // achtergrondwijziging opnieuw opgebouwd: half ingetypte klantcorrecties weg,
  // "Toon meer" weer dichtgeklapt en het scherm dat zichtbaar verspringt.
  const inboxVinger = `${filter}\n${rowsHTML}`;
  if (!append && inboxVinger === _lastInboxHtml && list.children.length) return;
  if (!append) _lastInboxHtml = inboxVinger;
  if (append) { $('#inboxMoreWrap')?.remove(); list.insertAdjacentHTML('beforeend', rowsHTML); _lastInboxHtml = ''; }
  else list.innerHTML = rowsHTML;
  reviews.forEach((r) => bindReview(r));
  $$('.r-select').forEach((c) => c.addEventListener('change', updateBulkCount));
  // "Toon meer"-knop als er nog berichten resteren.
  const shown = state._inboxOffset || 0;
  if (shown < total) {
    list.insertAdjacentHTML('beforeend', `<div id="inboxMoreWrap" style="text-align:center;margin:14px 0"><button class="btn" id="inboxMore">Toon meer (${total - shown} van ${total} resterend)</button></div>`);
    $('#inboxMore').onclick = () => loadInbox(true);
  }
}

function selectedReviewIds() {
  return $$('.r-select:checked').map((c) => c.dataset.id);
}
function updateBulkCount() {
  const n = selectedReviewIds().length;
  const el = $('#bulkCount'); if (el) el.textContent = n ? `${n} geselecteerd` : '';
}

function reviewHTML(r) {
  const s = r.suggestion || {};
  const m = r.message || {};
  const conf = Math.round((s.confidence || 0) * 100);
  const monteurOpts = '<option value="">— monteur later —</option>' + state.monteurs.map((mo) => `<option value="${mo.id}">${esc(mo.name)}</option>`).join('');
  const defaultSource = r.channel === 'whatsapp' ? 'Keyservice WhatsApp' : r.channel === 'email' ? 'Keyservice e-mail' : 'Handmatig';
  return `
    <div class="review" data-id="${r.id}" style="border-left-color:${esc(statusColor(s.status))}"> <div class="review-top"> <div> <label class="bulk-check" style="margin-right:8px"><input type="checkbox" class="r-select" data-id="${r.id}"></label><strong>${sourceIcon(r.channel)} ${esc(m.sender || 'Onbekend')}</strong> ${m.group ? `<span class="chip src-groep">${icon('users', 13)} ${esc(m.group)}</span>` : ''}${m.mailbox ? `<span class="chip" title="Bron/route waarlangs dit binnenkwam">${icon('mail', 12)} ${esc(m.mailbox)}</span>` : ''}${r.knownCustomer ? `<span class="chip" style="background:#e7f0fe;color:#1d4ed8" title="Afzender herkend op telefoonnummer/e-mailadres">${icon('user', 12)} Bekende klant: ${esc(r.knownCustomer.name || 'zonder naam')}${r.knownCustomer.openOrderTitle ? ` — open kaart: ${esc(r.knownCustomer.openOrderTitle)}` : ''}</span>` : ''}
          <div class="muted small">${esc(m.subject || '')} · ${fmtDate(m.receivedAt)}</div> </div> <div class="small muted" style="text-align:right">AI-zekerheid ${conf}%<br> <span class="confidence"><div style="width:${conf}%;background:${conf>=70?'#10b981':conf>=40?'#f59e0b':'#ef4444'}"></div></span> <div>${esc(s.engine || '')}</div> </div> </div> ${s.aiNotOrder ? '<div class="not-order-warn">⚠ AI denkt dat dit GEEN klantopdracht is (bv. incasso/leverancier/reclame)</div>' : ''} <div class="review-msg">${esc(m.body || '')}</div> ${m.attachments && m.attachments.length ? `<div class="attach-grid" style="margin:8px 0">${attachmentsHTML(m.attachments)}</div>` : ''} <div class="small"><strong>AI herkende:</strong> ${esc(s.reasoning || '')}${s.aiStatus && s.aiStatus !== s.status ? ` <em>(AI-categorie: ${esc(statusLabel(s.aiStatus))})</em>` : ''}</div> <div class="review-actions"> <label class="small" style="margin:0">Kolom<select class="r-status" style="margin-top:3px">${statusOptionsHTML(s.status)}</select></label> <label class="small" style="margin:0">Klant<input class="r-cname" value="${esc(s.customerName || '')}" style="margin-top:3px"></label> <label class="small" style="margin:0">Telefoon<input class="r-cphone" value="${esc(s.customerPhone || '')}" style="margin-top:3px"></label> <label class="small" style="margin:0">E-mail<input class="r-cemail" value="${esc(s.customerEmail || '')}" style="margin-top:3px"></label> <label class="small" style="margin:0">Adres<input class="r-caddress" value="${esc(s.customerAddress || '')}" style="margin-top:3px"></label> <label class="small" style="margin:0">Herkomst${sourceSelect(defaultSource, 'r-source')}</label> <label class="small" style="margin:0">Monteur<select class="r-monteur" style="margin-top:3px">${monteurOpts}</select></label> </div> <label class="small" style="margin:10px 0 0">Probleem / omschrijving<textarea class="r-problem" rows="2" style="margin-top:3px">${esc(s.problem || '')}</textarea></label> <div class="review-actions" style="margin-top:10px">${r.status === 'rejected'
      ? `<button class="btn r-restore">${icon('reply', 14)} Terugzetten</button>${hasPerm('hardDelete') ? '<button class="btn btn-danger r-perm">Definitief verwijderen</button>' : ''}`
      : `<button class="btn r-reply">${icon('reply', 14)} Snel antwoord</button> <button class="btn btn-success r-approve">Goedkeuren</button> <button class="btn btn-danger r-reject">Afwijzen</button>`} </div> </div>`;
}

function bindReview(r) {
  const el = $(`.review[data-id="${r.id}"]`);
  bindSourceSelect($('[data-source]', el));
  // Prullenbak-acties (afgewezen berichten)
  const restoreBtn = $('.r-restore', el);
  if (restoreBtn) restoreBtn.onclick = async () => {
    try { await api(`/api/reviews/${r.id}/restore`, 'POST'); toast('Teruggezet naar Te controleren'); loadInbox(); refreshInboxBadge(); }
    catch (err) { toast(err.message, true); }
  };
  const permBtn = $('.r-perm', el);
  if (permBtn) permBtn.onclick = async () => {
    if (!confirm('Definitief verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;
    try { await api(`/api/reviews/${r.id}`, 'DELETE'); toast('Definitief verwijderd'); loadInbox(); }
    catch (err) { toast(err.message, true); }
  };
  if (!$('.r-approve', el)) return; // afgewezen-weergave: geen verdere knoppen
  $('.r-approve', el).onclick = async () => {
    try {
      await api(`/api/reviews/${r.id}/approve`, 'POST', {
        status: $('.r-status', el).value,
        customerName: $('.r-cname', el).value,
        customerPhone: $('.r-cphone', el).value,
        customerEmail: $('.r-cemail', el).value,
        customerAddress: $('.r-caddress', el).value,
        description: $('.r-problem', el).value,
        source: $('[data-source]', el).value,
        monteurId: $('.r-monteur', el).value || null,
      });
      toast('Opdracht aangemaakt'); loadInbox(); refreshInboxBadge();
    } catch (err) { toast(err.message, true); }
  };
  $('.r-reject', el).onclick = () => openRejectModal(r);
  $('.r-reply', el).onclick = () => openReplyModal({
    name: $('.r-cname', el).value,
    email: $('.r-cemail', el).value,
    phone: $('.r-cphone', el).value,
    channel: r.channel,
    title: r.suggestion?.title,
    thread: r.message ? [{ sender: r.message.sender, body: r.message.body, at: r.message.receivedAt, channel: r.channel }] : [],
  });
}

// ---------- Customers ----------
async function loadCustomers() {
  state._customers = await api('/api/customers');
  renderCustomers();
}
// Tekstvergelijking voor zoekvelden: gewoon "bevat", plus een variant zonder spaties
// zodat een postcode als "3911AB" ook "3911 AB" vindt (en andersom).
function txtHit(hay, q) {
  const h = String(hay || '').toLowerCase();
  if (h.includes(q)) return true;
  const strip = (s) => s.replace(/\s+/g, '');
  return strip(h).includes(strip(q));
}

function renderCustomers() {
  const q = ($('#customerSearch').value || '').toLowerCase().trim();
  // Zoekt op naam, telefoon, e-mail, notities én adres — inclusief PLAATS en POSTCODE,
  // ook als die alleen op de opdrachtkaarten staan (searchPlaces van de server).
  const list = (state._customers || []).filter((c) => !q
    || txtHit(`${c.name} ${c.phone} ${c.email} ${c.address || ''} ${c.notes || ''} ${c.searchPlaces || ''}`, q));
  const canWrite = state.me.role !== 'monteur';
  const lastCell = (c) => {
    if (!c.lastOrder) return '<span class="muted small">—</span>';
    const lo = c.lastOrder;
    const when = lo.at ? fmtDateShort(lo.at) : '';
    const col = statusColor(lo.status);
    return `<span class="cust-last" data-open="${esc(lo.id)}" title="${esc(lo.title)} — open opdracht">
      <span class="chip status-pill" style="color:${esc(col)};background:${esc(col)}1f;border-color:${esc(col)}66">${esc(lo.statusLabel)}</span>
      <span class="muted small" style="display:block;margin-top:2px">${esc(lo.title.slice(0, 28))}${when ? ' · ' + esc(when) : ''}</span></span>`;
  };
  const eurC = (n) => '€ ' + Number(n || 0).toFixed(2).replace('.', ',');
  $('#customerList').innerHTML = `
    <table><thead><tr> <th>Naam</th><th>Type</th><th>Telefoon</th><th>Laatste status</th><th>Opdrachten</th><th title="Verzonden + betaalde facturen, incl. btw (offertes tellen niet mee)">Gefactureerd</th>${canWrite ? '<th></th>' : ''}
    </tr></thead><tbody> ${list.map((c) => `<tr> <td><strong class="cust-open" data-dossier="${esc(c.id)}" style="cursor:pointer;color:var(--accent)" title="Open het klantdossier (alles van deze klant op één scherm)">${esc(c.name)}</strong>${c.address ? `<div class="muted small">${esc(c.address)}</div>` : ''}${c.email ? `<div class="muted small">${esc(c.email)}</div>` : ''}</td> <td><span class="tag ${c.type === 'lead' ? 'lead' : 'klant'}">${esc(c.type)}</span></td> <td>${esc(c.phone || '')}</td> <td>${lastCell(c)}</td> <td>${c.orderCount}${c.activeCount ? ` <span class="muted small">(${c.activeCount} actief)</span>` : ''}</td> <td>${c.invoiceCount ? `<span class="cust-invoiced">${eurC(c.invoicedTotal)}<div class="muted small">${c.invoiceCount} factuur${c.invoiceCount > 1 ? 'en' : ''}</div></span>` : '<span class="muted small">—</span>'}</td> ${canWrite ? `<td style="white-space:nowrap"><button class="btn btn-sm btn-primary" data-neworder="${c.id}">+ Opdracht</button> <button class="btn btn-sm" data-edit="${c.id}">Bewerk</button></td>` : ''}
    </tr>`).join('') || `<tr><td colspan="7" class="empty">Geen klanten</td></tr>`}
    </tbody></table>`;
  $$('[data-edit]').forEach((b) => b.onclick = () => openCustomerModal(state._customers.find((c) => c.id === b.dataset.edit)));
  $$('[data-neworder]').forEach((b) => b.onclick = () => openNewOrderForCustomer(state._customers.find((c) => c.id === b.dataset.neworder)));
  $$('.cust-open[data-dossier]').forEach((el) => el.onclick = () => openCustomerDossier(el.dataset.dossier));
  $$('.cust-last[data-open]').forEach((el) => el.onclick = async () => {
    if (!state.orders.length || !state.orders.find((x) => x.id === el.dataset.open)) state.orders = await api('/api/orders?includeArchived=1');
    markSeen(el.dataset.open); openOrderModal(el.dataset.open);
  });
}

// KLANTDOSSIER: alles van één klant op één scherm — gegevens, kaarten, facturen,
// omzet-totalen — met snelknoppen voor een nieuwe factuur/offerte/opdracht.
async function openCustomerDossier(custId) {
  try {
    const d = await api(`/api/customers/${custId}/dossier`);
    const c = d.customer;
    const eurD = (n) => '€ ' + Number(n || 0).toFixed(2).replace('.', ',');
    const canWrite = state.me.role !== 'monteur';
    // Status-badges in vaste kleurcodes (zoals een boekhoudpakket): in één oogopslag
    // zie je of een factuur nog open staat, betaald is of een offerte nog loopt.
    const badge = (txt, kleur) => `<span class="dos-badge" style="border:1px solid ${kleur};color:${kleur}">${esc(txt)}</span>`;
    const invBadges = (i) => {
      if (i.type === 'offerte') {
        return { concept: badge('Concept', '#8a93a3'), verzonden: badge('Verzonden', '#1d4ed8'), goedgekeurd: badge('Akkoord', '#0d7a43'), afgekeurd: badge('Afgewezen', '#b42318') }[i.status] || '';
      }
      if (i.status === 'betaald') return badge('Betaald', '#0d7a43');
      if (i.status === 'verzonden') return `${badge('Verzonden', '#0d7a43')}${badge('Nog niet betaald', '#b45309')}`;
      return badge('Concept', '#8a93a3');
    };
    const facturen = d.invoices.filter((i) => i.type !== 'offerte');
    const offertes = d.invoices.filter((i) => i.type === 'offerte');
    const sectie = (titel, aantal, inhoud) => `
      <div class="dos-card">
        <div class="dos-card-head">${esc(titel)}${aantal ? `<span class="dos-count">${aantal}</span>` : ''}</div>
        ${inhoud}
      </div>`;
    modal(`
      <h2 style="margin-bottom:14px">${icon('user', 16)} ${esc(c.name)}</h2>
      <div class="dos-top">
        <div class="dos-card dos-contact">
          <div style="font-size:17px;font-weight:600;color:var(--ink);margin-bottom:8px">${esc(c.name)}</div>
          ${c.address ? `<div class="muted" style="line-height:1.5">${esc(c.address)}</div>` : ''}
          <div style="margin-top:10px;display:flex;flex-direction:column;gap:5px">
            ${c.email ? `<div>${icon('mail', 13)} <a href="mailto:${esc(c.email)}" style="color:var(--accent);text-decoration:none">${esc(c.email)}</a></div>` : ''}
            ${c.phone ? `<div>${icon('phone', 13)} <a href="tel:${esc(c.phone)}" style="color:var(--accent);text-decoration:none">${esc(c.phone)}</a></div>` : ''}
            ${c.address ? `<div>${icon('pin', 13)} <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none">Google Maps</a></div>` : ''}
          </div>
          ${c.notes ? `<div class="muted small" style="margin-top:10px;padding-top:8px;border-top:1px solid var(--line-soft,#e5e7eb)">${esc(c.notes)}</div>` : ''}
        </div>
        <div class="dos-card dos-kpi">
          <div class="dos-kpi-row"><span>Openstaand bedrag:</span><strong style="color:${d.totals.open ? '#b45309' : 'var(--ink)'}">${eurD(d.totals.open)}</strong></div>
          <div class="dos-kpi-row"><span>Totale omzet:</span><strong style="color:#0d7a43">${eurD(d.totals.paid)}</strong></div>
          <div class="dos-kpi-row"><span>Aantal facturen:</span><strong>${d.totals.invoiceCount}</strong></div>
          <div class="dos-kpi-row"><span>Aantal opdrachten:</span><strong>${d.totals.orders}</strong></div>
          ${d.totals.customerSince ? `<div class="dos-kpi-row"><span>Klant sinds:</span><strong>${fmtDateShort(d.totals.customerSince)}</strong></div>` : ''}
        </div>
      </div>

      <div class="dos-card" id="dos-ai" style="margin-bottom:12px">
        <div class="dos-card-head" style="display:flex;align-items:center;gap:8px">${icon('sparkles', 14)} AI-samenvatting
          <button class="btn btn-sm" id="dos-ai-btn" style="margin-left:auto">${c.aiSummary ? 'Vernieuwen' : 'Maak samenvatting'}</button>
        </div>
        <div id="dos-ai-body">${c.aiSummary ? `<div style="white-space:pre-wrap">${esc(c.aiSummary.text)}</div><div class="muted small" style="margin-top:6px">Gemaakt ${fmtDate(c.aiSummary.at)}</div>` : '<div class="muted small">Nog geen samenvatting — één klik en de AI vat alle klussen, facturen en gesprekken van deze klant samen.</div>'}</div>
      </div>

      ${sectie('Laatste facturen', facturen.length, facturen.length ? `
        <table class="dos-table"><thead><tr><th style="width:110px">Datum</th><th>Omschrijving</th><th style="text-align:right">Bedrag</th></tr></thead><tbody>
        ${facturen.slice(0, 8).map((i) => `<tr class="dos-row" data-inv="${esc(i.id)}">
          <td class="muted small">${fmtDateShort(i.sentAt || i.createdAt)}<div>${esc(i.number || '')}</div></td>
          <td>${esc(i.orderTitle || 'Factuur')}<div style="margin-top:3px">${invBadges(i)}</div></td>
          <td style="text-align:right;white-space:nowrap"><strong>${eurD(i.totalIncl)}</strong></td>
        </tr>`).join('')}</tbody></table>` : '<div class="dos-empty">Nog geen facturen</div>')}

      ${sectie('Laatste offertes', offertes.length, offertes.length ? `
        <table class="dos-table"><thead><tr><th style="width:110px">Datum</th><th>Omschrijving</th><th style="text-align:right">Bedrag</th></tr></thead><tbody>
        ${offertes.slice(0, 6).map((i) => `<tr class="dos-row" data-inv="${esc(i.id)}">
          <td class="muted small">${fmtDateShort(i.sentAt || i.createdAt)}<div>${esc(i.number || '')}</div></td>
          <td>${esc(i.orderTitle || 'Offerte')}<div style="margin-top:3px">${invBadges(i)}</div></td>
          <td style="text-align:right;white-space:nowrap"><strong>${eurD(i.totalIncl)}</strong></td>
        </tr>`).join('')}</tbody></table>` : '<div class="dos-empty">Nog geen offertes</div>')}

      ${sectie('Opdrachten', d.orders.length, d.orders.length ? `
        <table class="dos-table"><thead><tr><th style="width:110px">Datum</th><th>Opdracht</th><th style="text-align:right">Status</th></tr></thead><tbody>
        ${d.orders.slice(0, 10).map((o) => `<tr class="dos-row" data-order="${esc(o.id)}">
          <td class="muted small">${fmtDateShort(o.createdAt)}</td>
          <td>${esc(o.title)}${o.archivedWeek ? ' <span class="muted small">(archief)</span>' : ''}${o.appointmentAt ? `<div class="muted small">afspraak ${esc(String(o.appointmentAt).replace('T', ' ').slice(0, 16))}</div>` : ''}</td>
          <td style="text-align:right"><span class="dos-badge" style="border:1px solid ${esc(statusColor(o.status))};color:${esc(statusColor(o.status))}">${esc(statusLabel(o.status))}</span></td>
        </tr>`).join('')}</tbody></table>` : '<div class="dos-empty">Nog geen opdrachten</div>')}

      ${sectie('Laatste gesprekken', d.totals.messageCount, (d.berichten || []).length ? `
        <div style="max-height:220px;overflow-y:auto">${d.berichten.map((b) => `
          <div class="dos-msg" data-order="${esc(b.orderId)}">
            <div class="muted small">${b.outgoing ? icon('reply', 11) : sourceIcon(b.channel)} ${esc(b.outgoing ? 'Wij' : (b.sender || 'Klant'))} · ${fmtDate(b.at)} <span style="opacity:.7">· ${esc((b.orderTitle || '').slice(0, 28))}</span></div>
            <div style="margin-top:2px">${esc(b.body)}${b.body.length >= 180 ? '…' : ''}</div>
          </div>`).join('')}</div>` : '<div class="dos-empty">Nog geen gesprekken</div>')}

      <div class="modal-actions"><span></span><div class="right">
        <button class="btn" id="dos-invoice">+ Factuur</button>
        <button class="btn" id="dos-quote">+ Offerte</button>
        ${canWrite ? '<button class="btn" id="dos-order">+ Opdracht</button><button class="btn" id="dos-edit">Bewerken</button>' : ''}
        <button class="btn btn-primary" id="dos-close">Sluiten</button>
      </div></div>`);
    $('#dos-close').onclick = closeModal;
    // AI-samenvatting: één klik en de AI vat de hele klant samen (blijft bewaard).
    const aiBtn = $('#dos-ai-btn');
    if (aiBtn) aiBtn.onclick = async () => {
      aiBtn.disabled = true; aiBtn.textContent = 'AI leest alles…';
      try {
        const r = await api(`/api/customers/${custId}/summary`, 'POST', {});
        $('#dos-ai-body').innerHTML = `<div style="white-space:pre-wrap">${esc(r.summary.text)}</div><div class="muted small" style="margin-top:6px">Gemaakt ${fmtDate(r.summary.at)}</div>`;
        aiBtn.textContent = 'Vernieuwen';
      } catch (err) { toast(err.message, true); aiBtn.textContent = 'Opnieuw proberen'; }
      aiBtn.disabled = false;
    };
    const editBtn = $('#dos-edit'); if (editBtn) editBtn.onclick = () => openCustomerModal((state._customers || []).find((x) => x.id === custId) || c);
    const ordBtn = $('#dos-order'); if (ordBtn) ordBtn.onclick = () => openNewOrderForCustomer(c);
    $('#dos-invoice').onclick = async () => { try { const r = await api('/api/invoices', 'POST', { customerId: custId, type: 'factuur' }); openStandaloneInvoice((r.invoice || r).id); } catch (err) { toast(err.message, true); } };
    $('#dos-quote').onclick = async () => { try { const r = await api('/api/invoices', 'POST', { customerId: custId, type: 'offerte' }); openStandaloneInvoice((r.invoice || r).id); } catch (err) { toast(err.message, true); } };
    $$('.dos-row[data-order], .dos-msg[data-order]').forEach((el) => el.onclick = async () => {
      if (!state.orders.length || !state.orders.find((x) => x.id === el.dataset.order)) state.orders = await api('/api/orders?includeArchived=1');
      markSeen(el.dataset.order); openOrderModal(el.dataset.order);
    });
    $$('.dos-row[data-inv]').forEach((el) => el.onclick = () => openStandaloneInvoice(el.dataset.inv));
  } catch (err) { toast(err.message, true); }
}

// PLAK-OPDRACHT (noodroute): kopieer het DRS-bericht uit WhatsApp, plak het hier, en
// het CRM haalt de klantgegevens eruit en maakt direct een kaart. Gebouwd toen het
// bridge-nummer tijdelijk geblokkeerd was, maar ook daarna handig als vangnet.
function openPasteOrderModal() {
  modal(`
    <h2>Opdracht plakken</h2>
    <p class="muted small">Kopieer het hele bericht uit de WhatsApp-groep (met Naam, Adres, Woonplaats, Telefoon en Opmerkingen) en plak het hieronder. De kaart-titel begint automatisch met de plaatsnaam.</p>
    <label>WhatsApp-bericht <textarea id="po-text" rows="10" placeholder="Hallo Abdel Rafour. We sturen je de volgende klant...\n\nNaam: ...\nAdres: ...\nWoonplaats: ...\nTelefoon: ...\nOpmerkingen: ..."></textarea></label>
    <div class="modal-actions"><span></span><div class="right">
      <button class="btn" id="po-cancel">Annuleren</button>
      <button class="btn btn-primary" id="po-save">Maak kaart</button>
    </div></div>`);
  $('#po-cancel').onclick = closeModal;
  $('#po-save').onclick = async () => {
    const text = $('#po-text').value.trim();
    if (!text) return toast('Plak eerst het bericht', true);
    const btn = $('#po-save'); btn.disabled = true; btn.textContent = 'Bezig…';
    try {
      const o = await api('/api/orders/paste', 'POST', { text });
      closeModal(); toast(`Kaart aangemaakt: ${o.title}`);
      await loadBoard();
      openOrderModal(o.id);
    } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = 'Maak kaart'; }
  };
}

// Maak een nieuwe opdracht voor een BESTAANDE klant (uit het klantenbestand).
function openNewOrderForCustomer(c) {
  if (!c) return;
  modal(`
    <h2>Nieuwe opdracht voor ${esc(c.name)}</h2>
    <p class="muted small">${esc(c.phone || '')}${c.email ? ' · ' + esc(c.email) : ''}${c.address ? ' · ' + esc(c.address) : ''}</p>
    <label>Titel <input id="no-title" placeholder="bv. Cilinderslot vervangen"></label>
    <div class="row"><label>Status <select id="no-status">${statusOptionsHTML()}</select></label><label>Herkomst ${sourceSelect('Handmatig')}</label></div>
    <label>Omschrijving <textarea id="no-desc" rows="3" placeholder="Wat moet er gebeuren?"></textarea></label>
    <div class="modal-actions"><span></span><div class="right"><button class="btn" id="no-cancel">Annuleren</button><button class="btn btn-primary" id="no-save">Opdracht aanmaken</button></div></div>`);
  bindSourceSelect($('#modal [data-source]'));
  $('#no-cancel').onclick = closeModal;
  $('#no-save').onclick = async () => {
    const title = $('#no-title').value.trim();
    if (!title) return toast('Titel verplicht', true);
    try {
      await api('/api/orders', 'POST', { title, status: $('#no-status').value, description: $('#no-desc').value, source: $('#modal [data-source]')?.value || 'Handmatig', customerId: c.id });
      closeModal(); toast('Opdracht aangemaakt'); goView('board');
    } catch (err) { toast(err.message, true); }
  };
}
// ---------- KLANTIMPORT (CSV/Excel) ----------
// Bestand kiezen -> voorbeeld + automatisch herkende kolommen -> zelf bijstellen ->
// importeren. Dedupe op e-mail/telefoon; bestaande klanten worden nooit overschreven.
const IMPORT_FIELD_LABELS = { skip: '— overslaan —', name: 'Naam', phone: 'Telefoon', email: 'E-mail', address: 'Adres', postcode: 'Postcode', city: 'Plaats', notes: 'Notities' };
// ---------- Foto's & video's beheren (schijfruimte makkelijk vrijmaken) ----------
// Toont ALLE bijlages (kaarten incl. prullenbak + losse inbox-berichten) op
// grootte gesorteerd, met vinkjes en een bulk-verwijderknop. Werkbon-hand-
// tekeningen worden door de server al buiten deze lijst gehouden.
function fmtBytes(n) {
  if (!n) return '0 KB';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  return Math.round(n / 1024) + ' KB';
}
async function openAttachmentManager() {
  modal(`
    <h2>${icon('paperclip', 16)} Foto's &amp; video's beheren</h2>
    <p class="muted small">Vink aan wat je wilt verwijderen en klik op Verwijderen. Werkbon-handtekeningen staan hier bewust niet bij — die blijven altijd bewaard.</p>
    <div id="am-toolbar" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0">
      <label style="margin:0"><input type="checkbox" id="am-all" style="width:auto"> Alles selecteren</label>
      <select id="am-filter" style="max-width:220px">
        <option value="all">Alle bijlages</option>
        <option value="done">Alleen afgeronde/geannuleerde klussen</option>
        <option value="old">Ouder dan 90 dagen</option>
        <option value="video">Alleen video's</option>
      </select>
      <span class="muted small" id="am-summary" style="margin-left:auto"></span>
    </div>
    <div id="am-grid" style="max-height:50vh;overflow-y:auto;border:1px solid var(--line-soft,#e5e7eb);border-radius:8px;padding:10px">Laden…</div>
    <div class="modal-actions"><span></span><div class="right"><button class="btn" id="am-cancel">Sluiten</button><button class="btn btn-danger" id="am-delete" disabled>Verwijder geselecteerde</button></div></div>`);
  $('#am-cancel').onclick = closeModal;
  let items = [];
  const selected = new Set();
  const updateSummary = () => {
    const sel = items.filter((x) => selected.has(x.id));
    $('#am-summary').textContent = sel.length ? `${sel.length} geselecteerd — ${fmtBytes(sel.reduce((s, x) => s + (x.size || 0), 0))}` : `${items.length} bestand(en) — ${fmtBytes(items.reduce((s, x) => s + (x.size || 0), 0))}`;
    $('#am-delete').disabled = sel.length === 0;
    $('#am-delete').textContent = sel.length ? `Verwijder ${sel.length} geselecteerde` : 'Verwijder geselecteerde';
  };
  const renderGrid = () => {
    const f = $('#am-filter').value;
    const cutoff = Date.now() - 90 * 86400000;
    const shown = items.filter((x) => {
      if (f === 'done') return ['afgerond', 'geannuleerd'].includes(x.orderStatus);
      if (f === 'old') return x.at && new Date(x.at).getTime() < cutoff;
      if (f === 'video') return x.kind === 'video';
      return true;
    });
    $('#am-grid').innerHTML = shown.length ? `<div class="attach-grid">${shown.map((x) => `
      <label class="am-item" style="position:relative;cursor:pointer;display:block">
        <input type="checkbox" class="am-pick" data-id="${esc(x.id)}" ${selected.has(x.id) ? 'checked' : ''} style="position:absolute;top:6px;left:6px;width:18px;height:18px;z-index:2;accent-color:var(--danger)">
        ${x.kind === 'image' ? `<img src="${esc(x.url)}" loading="lazy" style="width:100%;height:90px;object-fit:cover;border-radius:8px;display:block;border:2px solid transparent">` : `<div style="width:100%;height:90px;border-radius:8px;background:var(--panel-2,#f6f8fb);display:flex;align-items:center;justify-content:center;border:2px solid transparent">${icon(x.kind === 'video' ? 'video' : 'file', 26)}</div>`}
        <div class="muted small" style="margin-top:3px;line-height:1.3" title="${esc(x.orderTitle)}">${esc((x.orderTitle || '').slice(0, 22))}<br>${fmtBytes(x.size)} · ${fmtDateShort(x.at)}</div>
      </label>`).join('')}</div>` : '<div class="empty">Niets gevonden voor dit filter.</div>';
    $$('.am-pick', $('#am-grid')).forEach((c) => {
      const box = c.closest('.am-item');
      if (c.checked && box) box.querySelector('img,div').style.borderColor = 'var(--danger)';
      c.addEventListener('change', () => {
        if (c.checked) selected.add(c.dataset.id); else selected.delete(c.dataset.id);
        const el = box.querySelector('img,div'); if (el) el.style.borderColor = c.checked ? 'var(--danger)' : 'transparent';
        updateSummary();
      });
    });
    updateSummary();
  };
  $('#am-filter').onchange = renderGrid;
  $('#am-all').onchange = () => {
    const f = $('#am-filter').value;
    const cutoff = Date.now() - 90 * 86400000;
    const visible = items.filter((x) => {
      if (f === 'done') return ['afgerond', 'geannuleerd'].includes(x.orderStatus);
      if (f === 'old') return x.at && new Date(x.at).getTime() < cutoff;
      if (f === 'video') return x.kind === 'video';
      return true;
    });
    if ($('#am-all').checked) visible.forEach((x) => selected.add(x.id));
    else visible.forEach((x) => selected.delete(x.id));
    renderGrid();
  };
  $('#am-delete').onclick = async () => {
    const toDelete = items.filter((x) => selected.has(x.id));
    if (!toDelete.length) return;
    if (!confirm(`${toDelete.length} bestand(en) definitief verwijderen (${fmtBytes(toDelete.reduce((s, x) => s + (x.size || 0), 0))})? Dit kan niet ongedaan worden gemaakt.`)) return;
    const btn = $('#am-delete'); btn.disabled = true; btn.textContent = 'Bezig…';
    try {
      const r = await api('/api/attachments/bulk-delete', 'POST', { items: toDelete.map((x) => ({ id: x.id, orderId: x.orderId, threadId: x.threadId, messageId: x.messageId })) });
      toast(`${r.removed} bestand(en) verwijderd — ${fmtBytes(r.freedBytes)} vrijgemaakt`);
      items = items.filter((x) => !selected.has(x.id));
      selected.clear();
      renderGrid();
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  };
  try {
    const r = await api('/api/attachments/browse');
    items = (r.items || []).sort((a, b) => (b.size || 0) - (a.size || 0));
    renderGrid();
  } catch (err) { $('#am-grid').innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}

function openImportModal() {
  modal(`
    <h2>${icon('users', 16)} Klanten importeren</h2>
    <p class="muted small">Kies een <strong>.csv</strong>- of <strong>Excel</strong>-bestand (bv. je export uit Rompslomp of Excel-lijst). Je krijgt eerst een voorbeeld te zien en kunt per kolom aangeven wat erin staat — pas daarna wordt er echt geïmporteerd. Bestaande klanten (zelfde e-mail of telefoonnummer) worden <strong>nooit overschreven</strong>: alleen lege velden worden aangevuld.</p>
    <input type="file" id="imp-file" accept=".csv,.xlsx,.xls,.ods,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="margin-top:8px">
    <div id="imp-preview" style="margin-top:12px"></div>
    <div class="modal-actions"><span></span><div class="right"><button class="btn" id="imp-cancel">Sluiten</button><button class="btn btn-primary" id="imp-go" disabled>Importeren</button></div></div>`);
  $('#imp-cancel').onclick = closeModal;
  let importState = null;
  $('#imp-file').addEventListener('change', async () => {
    const f = $('#imp-file').files[0];
    if (!f) return;
    $('#imp-preview').innerHTML = '<div class="muted small">Bestand lezen…</div>';
    try {
      const fd = new FormData();
      fd.append('bestand', f);
      const r = await fetch('/api/customers/import-preview', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Upload mislukt');
      importState = j;
      const selects = j.headers.map((h, idx) => {
        const chosen = Object.entries(j.mapping || {}).find(([, v]) => v === idx)?.[0] || 'skip';
        return `<th style="min-width:120px"><div class="muted small" style="font-weight:400">${esc(h || `kolom ${idx + 1}`)}</div>
          <select class="imp-map" data-col="${idx}" style="margin-top:3px;font-size:12px">${Object.entries(IMPORT_FIELD_LABELS).map(([k, l]) => `<option value="${k}" ${k === chosen ? 'selected' : ''}>${l}</option>`).join('')}</select></th>`;
      }).join('');
      $('#imp-preview').innerHTML = `
        <div class="muted small" style="margin-bottom:6px"><strong>${j.total}</strong> rijen gevonden. Controleer of elke kolom goed herkend is:</div>
        <div class="table-wrap" style="overflow-x:auto"><table style="font-size:12.5px"><thead><tr>${selects}</tr></thead>
        <tbody>${j.sample.map((row) => `<tr>${j.headers.map((_, i) => `<td>${esc(String(row[i] || '').slice(0, 40))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      const go = $('#imp-go');
      go.disabled = false;
      go.textContent = `Importeer ${j.total} rijen`;
    } catch (err) { $('#imp-preview').innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  });
  $('#imp-go').onclick = async () => {
    if (!importState) return;
    const mapping = {};
    $$('.imp-map').forEach((s) => { if (s.value !== 'skip' && mapping[s.value] === undefined) mapping[s.value] = Number(s.dataset.col); });
    if (mapping.name === undefined && mapping.phone === undefined && mapping.email === undefined) return toast('Wijs minimaal de kolom Naam, Telefoon of E-mail aan', true);
    const go = $('#imp-go'); go.disabled = true; go.textContent = 'Bezig met importeren…';
    try {
      const r = await api('/api/customers/import', 'POST', { importId: importState.importId, mapping });
      closeModal();
      toast(`Import klaar: ${r.added} nieuw, ${r.filled} aangevuld, ${r.dup} dubbel en ${r.empty} leeg overgeslagen`);
      loadCustomers();
    } catch (err) { toast(err.message, true); go.disabled = false; go.textContent = 'Importeren'; }
  };
}

// ---------- E-MAILCAMPAGNE ----------
// Selecteer klanten (huidig zoekresultaat of alle klanten met e-mail), schrijf één
// bericht ({naam} wordt per klant ingevuld) en het CRM verstuurt netjes met
// tussenpozen — met testmail vooraf en een nette afmeld-voet eronder.
function openCampaignModal() {
  const all = (state._customers || []).filter((c) => c.email && !c.campaignOptOut);
  const q = ($('#customerSearch')?.value || '').toLowerCase();
  const filtered = all.filter((c) => !q || `${c.name} ${c.phone} ${c.email} ${c.address || ''}`.toLowerCase().includes(q));
  if (!all.length) return toast('Geen klanten met een e-mailadres gevonden', true);
  modal(`
    <h2>${icon('mail', 16)} E-mail naar klanten sturen</h2>
    <p class="muted small">Schrijf één bericht; <code>{naam}</code> wordt automatisch de klantnaam. Onderaan komt de huisstijl-handtekening + een nette afmeldregel. Verstuurd met tussenpozen (geen spam-gedrag).</p>
    <label>Naar wie
      <select id="cp-who">
        <option value="filter" ${q ? 'selected' : ''}>Huidig zoekresultaat (${filtered.length} klanten met e-mail)</option>
        <option value="all" ${q ? '' : 'selected'}>Alle klanten met e-mail (${all.length})</option>
      </select></label>
    <label>Onderwerp <input id="cp-subject" placeholder="bv. Zomeractie: gratis slotcheck"></label>
    <label>Bericht <textarea id="cp-body" rows="7" placeholder="Beste {naam},&#10;&#10;..."></textarea></label>
    <div class="row" style="align-items:flex-end"><label>Eerst testen naar <input id="cp-test" type="email" value="${esc(state.me?.email || '')}"></label><button class="btn" id="cp-testbtn" style="align-self:flex-end">Stuur testmail</button></div>
    <div id="cp-progress" class="muted small" style="margin-top:8px"></div>
    <div class="modal-actions"><span></span><div class="right"><button class="btn" id="cp-cancel">Annuleren</button><button class="btn btn-primary" id="cp-send">Versturen</button></div></div>`);
  $('#cp-cancel').onclick = closeModal;
  $('#cp-testbtn').onclick = async () => {
    const to = $('#cp-test').value.trim();
    if (!to) return toast('Vul een testadres in', true);
    try { await api('/api/campaign/send', 'POST', { subject: $('#cp-subject').value, body: $('#cp-body').value, test: to }); toast(`Testmail verstuurd naar ${to}`); }
    catch (err) { toast(err.message, true); }
  };
  $('#cp-send').onclick = async () => {
    const doel = $('#cp-who').value === 'all' ? all : filtered;
    const subject = $('#cp-subject').value.trim();
    const body = $('#cp-body').value.trim();
    if (!subject || !body) return toast('Vul onderwerp en bericht in', true);
    if (!doel.length) return toast('Geen klanten in deze selectie', true);
    if (!confirm(`Deze e-mail nu naar ${doel.length} klanten sturen?\n\nOnderwerp: ${subject}`)) return;
    const btn = $('#cp-send'); btn.disabled = true;
    let sent = 0; let skipped = 0; let failed = 0;
    const prog = $('#cp-progress');
    try {
      for (let i = 0; i < doel.length; i += 50) {
        prog.textContent = `Versturen… ${Math.min(i, doel.length)} van ${doel.length}`;
        const r = await api('/api/campaign/send', 'POST', { subject, body, customerIds: doel.slice(i, i + 50).map((c) => c.id) });
        sent += r.sent || 0; skipped += r.skipped || 0; failed += (r.failed || []).length;
      }
      closeModal();
      toast(`Campagne klaar: ${sent} verstuurd${skipped ? `, ${skipped} overgeslagen` : ''}${failed ? `, ${failed} MISLUKT (zie logboek)` : ''}`);
    } catch (err) { toast(err.message, true); btn.disabled = false; prog.textContent = ''; }
  };
}

function openCustomerModal(c) {
  modal(`
    <h2>${c ? 'Klant bewerken' : 'Nieuwe klant'}</h2> <label>Naam <input id="c-name" value="${esc(c?.name || '')}"></label> <div class="row"> <label>Telefoon <input id="c-phone" value="${esc(c?.phone || '')}"></label> <label>E-mail <input id="c-email" value="${esc(c?.email || '')}"></label> </div> <label>Adres <input id="c-address" value="${esc(c?.address || '')}"></label> <label>Type <select id="c-type"> <option value="lead" ${c?.type==='lead'?'selected':''}>Lead</option> <option value="klant" ${c?.type==='klant'?'selected':''}>Klant</option> </select></label> <label>Notities <textarea id="c-notes" rows="2">${esc(c?.notes || '')}</textarea></label> <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="c-optout" style="width:auto" ${c?.campaignOptOut ? 'checked' : ''}> Geen campagne-mails sturen (klant is afgemeld)</label> <div class="modal-actions"> ${c ? '<button class="btn btn-danger" id="c-del">Verwijderen</button>' : '<span></span>'}
      <div class="right"><button class="btn" id="c-cancel">Annuleren</button><button class="btn btn-primary" id="c-save">Opslaan</button></div> </div>`);
  $('#c-cancel').onclick = closeModal;
  $('#c-save').onclick = async () => {
    const payload = { name: $('#c-name').value, phone: $('#c-phone').value, email: $('#c-email').value, address: $('#c-address').value, type: $('#c-type').value, notes: $('#c-notes').value, campaignOptOut: $('#c-optout').checked };
    if (!payload.name) return toast('Naam verplicht', true);
    try {
      if (c) await api(`/api/customers/${c.id}`, 'PATCH', payload);
      else await api('/api/customers', 'POST', payload);
      closeModal(); toast('Opgeslagen'); loadCustomers();
    } catch (err) { toast(err.message, true); }
  };
  if (c) $('#c-del').onclick = async () => {
    if (!confirm('Klant verwijderen?')) return;
    try { await api(`/api/customers/${c.id}`, 'DELETE'); closeModal(); toast('Verwijderd'); loadCustomers(); }
    catch (err) { toast(err.message, true); }
  };
}

// ---------- Monteurs ----------
async function loadMonteurs() {
  state.monteurs = await api('/api/monteurs');
  fillMonteurFilter();
  const canWrite = state.me.role !== 'monteur';
  const fmtAppt = (s) => s ? new Date(s).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  $('#monteurList').innerHTML = state.monteurs.map((m) => `
    <div class="info-card">
      <h3>${icon('wrench', 15)} ${esc(m.name)}</h3>
      <div class="muted small">${esc(m.phone || '')}${m.email ? ' · ' + esc(m.email) : ''}${m.waGroup ? ' · groep: ' + esc(m.waGroup) : ' · <span style="color:var(--danger)">geen WhatsApp-groep</span>'}</div>
      <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
        <span class="chip chip-click" data-mfilter="active" data-mid="${m.id}" data-mname="${esc(m.name)}">${m.activeCount} actief</span>
        <span class="chip chip-click" data-mfilter="sent" data-mid="${m.id}" data-mname="${esc(m.name)}">${m.sentCount || 0} verstuurd</span>
        <span class="chip chip-click" data-mfilter="done" data-mid="${m.id}" data-mname="${esc(m.name)}">${m.doneCount || 0} afgerond</span>
      </div>
      ${m.upcoming && m.upcoming.length ? `<div style="margin-top:12px"><div class="muted small" style="font-weight:500;margin-bottom:4px">Komende afspraken</div>${m.upcoming.slice(0, 5).map((o) => `<div class="mont-line" data-open="${o.id}"><strong>${esc(fmtAppt(o.at))}</strong> — ${esc(o.title)} <span class="muted">· ${esc(o.statusLabel)}</span></div>`).join('')}</div>` : ''}
      ${m.orders && m.orders.length ? `<details style="margin-top:10px"><summary class="muted small" style="cursor:pointer">Alle ${m.orders.length} actieve opdrachten</summary>${m.orders.map((o) => `<div class="mont-line" data-open="${o.id}">${esc(o.title)} <span class="muted">· ${esc(o.statusLabel)}${o.appointmentAt ? ' · ' + esc(fmtAppt(o.appointmentAt)) : ''}</span></div>`).join('')}</details>` : ''}
      ${canWrite ? `<div style="margin-top:12px"><button class="btn btn-sm" data-medit="${m.id}">Bewerk</button> <button class="btn btn-sm btn-danger" data-mdel="${m.id}">Verwijder</button></div>` : ''}
    </div>`).join('') || '<div class="empty">Nog geen monteurs</div>';
  $$('#monteurList .mont-line[data-open]').forEach((el) => el.onclick = async () => { if (!state.orders.length) state.orders = await api('/api/orders'); markSeen(el.dataset.open); openOrderModal(el.dataset.open); });
  $$('#monteurList .chip-click[data-mfilter]').forEach((el) => el.onclick = () => openMonteurOrders(el.dataset.mid, el.dataset.mname, el.dataset.mfilter));
  $$('[data-medit]').forEach((b) => b.onclick = () => openMonteurModal(state.monteurs.find((m) => m.id === b.dataset.medit)));
  $$('[data-mdel]').forEach((b) => b.onclick = async () => {
    if (!confirm('Monteur verwijderen?')) return;
    try { await api(`/api/monteurs/${b.dataset.mdel}`, 'DELETE'); toast('Verwijderd'); loadMonteurs(); }
    catch (err) { toast(err.message, true); }
  });
}

// Toont alle opdrachten van een monteur in een categorie (actief/verstuurd/afgerond),
// elk klikbaar om de kaart te openen. Geopend via de klikbare pillen op de monteur-kaart.
async function openMonteurOrders(mId, mName, filter) {
  const titles = { active: 'Actieve opdrachten', sent: 'Verstuurd naar monteur', done: 'Afgeronde opdrachten' };
  modal(`<h2>${esc(mName)} — ${esc(titles[filter] || 'Opdrachten')}</h2><div id="mo-list" class="muted small">Laden…</div><div class="modal-actions"><span></span><div class="right"><button class="btn" id="mo-close">Sluiten</button></div></div>`);
  $('#mo-close').onclick = closeModal;
  const fmtAppt = (s) => s ? new Date(s).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  try {
    const data = await api(`/api/monteurs/${mId}/orders`);
    const list = data[filter] || [];
    if (!list.length) { $('#mo-list').textContent = 'Geen opdrachten in deze categorie.'; return; }
    $('#mo-list').innerHTML = list.map((o) => `
      <div class="mont-line" data-open="${o.id}" style="padding:10px 0;border-bottom:1px solid var(--line-soft)">
        <div><strong>${esc(o.title)}</strong> <span class="muted">· ${esc(o.statusLabel)}</span>${o.archived ? ' <span class="chip" style="font-size:10px">ingeklapt</span>' : ''}</div>
        <div class="muted small">${o.customer ? esc(o.customer) : ''}${o.address ? ' · ' + esc(o.address) : ''}${o.appointmentAt ? ' · ' + esc(fmtAppt(o.appointmentAt)) : ''}</div>
      </div>`).join('');
    $$('#mo-list .mont-line[data-open]').forEach((el) => el.onclick = async () => {
      if (!state.orders.length) state.orders = await api('/api/orders?includeArchived=1');
      else if (!state.orders.find((x) => x.id === el.dataset.open)) state.orders = await api('/api/orders?includeArchived=1');
      markSeen(el.dataset.open); openOrderModal(el.dataset.open);
    });
  } catch (err) { $('#mo-list').innerHTML = `<span class="error">${esc(err.message)}</span>`; }
}

// Snelle telefonische intake: compact formulier voor tijdens een telefoongesprek.
// Alleen de essentie (naam/tel/plaats/probleem) — de rest vul je later aan op de kaart.
function openPhoneIntakeModal() {
  const monteurOpts = '<option value="">— monteur later —</option>' + state.monteurs.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  modal(`
    <h2>📞 Telefonische aanvraag</h2>
    <p class="muted small">Noteer snel de essentie tijdens het gesprek. Aanvullen kan later op de kaart.</p>
    <div class="row"><label>Naam klant <input id="pi-name" placeholder="naam"></label><label>Telefoon <input id="pi-phone" placeholder="06-…"></label></div>
    <label>Plaats of adres <input id="pi-address" placeholder="bv. Breda, of straat + postcode"></label>
    <label>Wat is het probleem? <textarea id="pi-problem" rows="3" placeholder="bv. buitengesloten, cilinder vervangen, schuifpui klemt…"></textarea></label>
    <div class="row"><label>Monteur <select id="pi-monteur">${monteurOpts}</select></label><label style="display:flex;align-items:center;gap:8px;flex-direction:row;margin-top:24px"><input type="checkbox" id="pi-urgent" style="width:auto"> Spoed</label></div>
    <div class="modal-actions"><span></span><div class="right"><button class="btn" id="pi-cancel">Annuleren</button><button class="btn btn-primary" id="pi-save">Kaart aanmaken</button></div></div>`);
  $('#pi-name').focus();
  $('#pi-cancel').onclick = closeModal;
  $('#pi-save').onclick = async () => {
    const name = $('#pi-name').value.trim();
    const problem = $('#pi-problem').value.trim();
    if (!name && !$('#pi-phone').value.trim()) return toast('Vul minimaal een naam of telefoonnummer in', true);
    const place = $('#pi-address').value.trim();
    try {
      await api('/api/orders', 'POST', {
        title: `${problem ? problem.split('\n')[0].slice(0, 60) : 'Telefonische aanvraag'}${place ? ' - ' + placeName(place) : ''}`,
        description: problem,
        status: 'nieuw',
        source: 'Telefoon',
        customerName: name || 'Onbekend (telefoon)',
        customerPhone: $('#pi-phone').value.trim(),
        customerAddress: place,
        monteurId: $('#pi-monteur').value || null,
        urgent: $('#pi-urgent').checked,
      });
      closeModal(); toast('Kaart aangemaakt'); loadBoard();
    } catch (err) { toast(err.message, true); }
  };
}

// Opvolg-herinnering (snooze): kies wanneer deze kaart terug moet komen.
// Op het gekozen moment krijg je een pushmelding en een "opvolgen!"-vlag op de kaart.
function openSnoozeModal(o) {
  const pad = (n) => String(n).padStart(2, '0');
  const toLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const at = (daysAhead, hour) => { const d = new Date(); d.setDate(d.getDate() + daysAhead); d.setHours(hour, 0, 0, 0); return toLocal(d); };
  const nextMonday = () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0, 0, 0); return toLocal(d); };
  modal(`
    <h2>${icon('clock', 16)} Herinnering — ${esc(o.title)}</h2>
    <p class="muted small">Wanneer moet deze kaart terugkomen? Je krijgt dan een pushmelding en de kaart krijgt een "opvolgen!"-vlag.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">
      <button class="btn sn-q" data-at="${at(0, 16)}">Vanmiddag 16:00</button>
      <button class="btn sn-q" data-at="${at(1, 9)}">Morgen 09:00</button>
      <button class="btn sn-q" data-at="${at(2, 9)}">Over 2 dagen</button>
      <button class="btn sn-q" data-at="${nextMonday()}">Volgende week ma</button>
    </div>
    <label>Of kies zelf <input id="sn-custom" type="datetime-local" value="${esc((o.snoozeAt || '').slice(0, 16))}"></label>
    <div class="modal-actions">
      ${o.snoozeAt || o.snoozeDue ? '<button class="btn btn-danger" id="sn-clear">Herinnering weghalen</button>' : '<span></span>'}
      <div class="right"><button class="btn" id="sn-cancel">Annuleren</button><button class="btn btn-primary" id="sn-save">Instellen</button></div>
    </div>`);
  const set = async (val) => {
    try {
      await api(`/api/orders/${o.id}`, 'PATCH', { snoozeAt: val });
      toast(val ? 'Herinnering ingesteld' : 'Herinnering weggehaald');
      closeModal(); loadBoard();
    } catch (err) { toast(err.message, true); }
  };
  $$('.sn-q').forEach((b) => b.onclick = () => set(b.dataset.at));
  $('#sn-save').onclick = () => { const v = $('#sn-custom').value; if (!v) return toast('Kies een moment', true); set(v); };
  if ($('#sn-clear')) $('#sn-clear').onclick = () => set(null);
  $('#sn-cancel').onclick = () => { closeModal(); };
}

// ---------- Werkbon (uitgevoerd werk + materialen + handtekening klant) ----------
function openWerkbonModal(o) {
  const wb = o.werkbon || {};
  modal(`
    <h2>${icon('tag', 16)} Werkbon — ${esc(o.title)}</h2>
    <p class="muted small">Vul in wat er is gedaan. De klant kan hieronder tekenen. De werkbon blijft op de kaart bewaard en kun je overnemen in de factuur.</p>
    <label>Uitgevoerd werk <textarea id="wb-work" rows="4" placeholder="bv. Loopwagens schuifpui vervangen (2x), rail gereinigd en afgesteld">${esc(wb.work || '')}</textarea></label>
    <label>Gebruikte materialen / onderdelen <textarea id="wb-mat" rows="2" placeholder="bv. 2x loopwagen GU 9-146, siliconenspray">${esc(wb.materials || '')}</textarea></label>
    <label>Handtekening klant ${wb.signatureAttachmentId ? '<span class="muted small">(al gezet — opnieuw tekenen vervangt)</span>' : ''}</label>
    <canvas id="wb-sign" width="600" height="160" style="width:100%;height:120px;border:1.5px dashed var(--border);border-radius:10px;background:#fff;touch-action:none"></canvas>
    <button type="button" class="btn btn-sm" id="wb-clear" style="margin-top:6px">Handtekening wissen</button>
    <div class="modal-actions"><span></span><div class="right"><button class="btn" id="wb-cancel">Annuleren</button><button class="btn btn-primary" id="wb-save">Werkbon opslaan</button></div></div>`);
  // Simpel teken-canvas (muis + touch).
  const cv = $('#wb-sign'); const ctx = cv.getContext('2d');
  ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#111';
  let drawing = false; let drew = false;
  const pos = (e) => { const r = cv.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; return { x: (p.clientX - r.left) * (cv.width / r.width), y: (p.clientY - r.top) * (cv.height / r.height) }; };
  const start = (e) => { drawing = true; drew = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); };
  const move = (e) => { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); };
  const end = () => { drawing = false; };
  cv.addEventListener('mousedown', start); cv.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
  cv.addEventListener('touchstart', start, { passive: false }); cv.addEventListener('touchmove', move, { passive: false }); cv.addEventListener('touchend', end);
  $('#wb-clear').onclick = () => { ctx.clearRect(0, 0, cv.width, cv.height); drew = false; };
  $('#wb-cancel').onclick = closeModal;
  $('#wb-save').onclick = async () => {
    try {
      let signatureAttachmentId = '';
      if (drew) {
        const dataBase64 = cv.toDataURL('image/png');
        const updated = await api(`/api/orders/${o.id}/attachments`, 'POST', { filename: `handtekening-${new Date().toISOString().slice(0, 10)}.png`, mime: 'image/png', dataBase64 });
        const atts = updated.attachments || [];
        signatureAttachmentId = atts.length ? (atts[atts.length - 1].id || '') : '';
      }
      const updatedOrder = await api(`/api/orders/${o.id}/werkbon`, 'POST', { work: $('#wb-work').value, materials: $('#wb-mat').value, signatureAttachmentId });
      const idx = state.orders.findIndex((x) => x.id === o.id); if (idx >= 0) state.orders[idx] = updatedOrder;
      toast('Werkbon opgeslagen'); closeModal(); loadBoard();
    } catch (err) { toast(err.message, true); }
  };
}

// ---------- Factuur (regels, btw, versturen als PDF) ----------
// ---------- Factuur/offerte-editor (vanaf kaart óf losstaand) ----------
// type = 'factuur' of 'offerte' — telt alleen bij het AANMAKEN; bestaat er al een
// gekoppeld document, dan opent gewoon dat document (type wijzigt nooit stiekem).
function openInvoiceModal(o, type = 'factuur') {
  api(`/api/orders/${o.id}/invoice`).then(({ invoice, settings, priceList = [], bundles = [] }) => {
    renderInvoiceEditor({
      inv: invoice || { lines: [], btwPct: settings.btwPct, note: '', status: 'concept', type },
      customer: o.customer || {}, contextTitle: o.title, werkbon: o.werkbon || null, priceList, bundles,
      save: (body) => api(`/api/orders/${o.id}/invoice`, 'POST', { ...body, type }),
      after: () => loadBoard(),
    });
  }).catch((err) => toast(err.message, true));
}

function openStandaloneInvoice(invId) {
  api(`/api/invoices/${invId}`).then(({ invoice, customer, order, priceList = [], bundles = [] }) => {
    renderInvoiceEditor({
      inv: invoice, customer: customer || {}, contextTitle: order?.title || (customer?.name || ''), werkbon: order?.werkbon || null, priceList, bundles,
      save: (body) => api(`/api/invoices/${invoice.id}`, 'PATCH', body),
      after: () => { if (state._invoices) loadInvoices(); },
    });
  }).catch((err) => toast(err.message, true));
}

// PDF delen (mobiel: native deel-menu -> WhatsApp / Bestanden / Mail) of anders
// downloaden (desktop). Werkt voor facturen én offertes.
async function shareInvoicePdf(invId, label, btn) {
  const safe = String(label || 'document').replace(/[^\w\-. ]+/g, '').trim() || 'document';
  const prev = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Bezig…'; }
  try {
    const resp = await fetch(`/api/invoices/${invId}/pdf`, { credentials: 'same-origin' });
    if (!resp.ok) throw new Error('PDF ophalen mislukt');
    const blob = await resp.blob();
    const file = new File([blob], `${safe}.pdf`, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: safe, text: `${safe} — Keyservice` }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; /* anders: downloaden */ }
    }
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = objUrl; a.download = `${safe}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
    toast('PDF gedownload');
  } catch (err) { toast(err.message || 'Delen mislukt', true); }
  finally { if (btn) { btn.disabled = false; btn.textContent = prev; } }
}

// Factuur/offerte (opnieuw) versturen naar de klant. Vraagt naar het e-mailadres
// (voorgevuld met het huidige/laatst gebruikte) zodat een verkeerd adres direct te
// corrigeren is. Mag zo vaak als nodig; een betaalde factuur blijft betaald.
async function resendInvoice(invId, label, prefillEmail, after) {
  const to = prompt(`${label} versturen naar welk e-mailadres?`, prefillEmail || '');
  if (to === null) return; // geannuleerd
  const addr = to.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) { toast('Geen geldig e-mailadres', true); return; }
  try {
    const r = await api(`/api/invoices/${invId}/send`, 'POST', { to: addr });
    toast(`Verstuurd naar ${r.invoice?.sentTo || addr}`);
    if (after) after();
  } catch (err) { toast(err.message, true); }
}

function renderInvoiceEditor(ctx) {
  const { inv, customer, priceList, bundles = [] } = ctx;
  const isQuote = inv.type === 'offerte';
  const woord = isQuote ? 'Offerte' : 'Factuur';
  const locked = inv.status === 'betaald' || inv.status === 'goedgekeurd';
  const toExcl = (l) => l.priceExcl !== undefined ? l.priceExcl : Math.round(((l.priceIncl || 0) / (1 + (Number(inv.btwPct) || 21) / 100)) * 100) / 100;
  inv.lines = (inv.lines || []).map((l) => ({ ...l, priceExcl: toExcl(l) }));
  if (!inv.lines.length) inv.lines = [{ description: '', qty: 1, priceExcl: 0 }];
  const eur = (n) => '€ ' + Number(n || 0).toFixed(2).replace('.', ',');
  const stLabel = { concept: 'Concept', verzonden: 'Verzonden', betaald: 'Betaald ✓', goedgekeurd: 'Goedgekeurd ✓', afgekeurd: 'Afgekeurd' }[inv.status] || inv.status;
  const lineRow = (l, i) => `
    <div class="inv-line" data-i="${i}" style="display:flex;gap:6px;margin-bottom:6px;align-items:center">
      <input class="il-desc" value="${esc(l.description || '')}" placeholder="Omschrijving" style="flex:3">
      <input class="il-qty" type="number" min="0" step="1" value="${esc(String(l.qty ?? 1))}" style="width:64px" title="Aantal">
      <input class="il-price" type="number" min="0" step="0.01" value="${esc(String(l.priceExcl ?? 0))}" style="width:96px" title="Prijs per stuk (EXCL. btw)">
      <button type="button" class="btn btn-sm il-del" title="Regel weghalen">${icon('x', 12)}</button>
    </div>`;
  modal(`
    <h2>${icon('mail', 16)} ${woord} — ${esc(customer.name || ctx.contextTitle || '')}</h2>
    <p class="muted small">${inv.number ? `Nummer <strong>${esc(inv.number)}</strong> · status: <strong>${esc(stLabel)}</strong>${inv.sentTo ? ` · verstuurd naar ${esc(inv.sentTo)}` : ''}` : `Nieuw concept — het ${woord.toLowerCase()}nummer wordt bij opslaan toegekend.`} Prijzen voer je <strong>EXCL. btw</strong> in; de btw komt erbovenop.${locked ? ' <strong>Dit document is vergrendeld.</strong>' : ''}</p>
    ${customer.id ? `<details class="pl-collapse" style="margin-bottom:12px"><summary style="cursor:pointer;font-weight:600;padding:8px 0">${icon('user', 13)} Klantgegevens${customer.name ? ' — ' + esc(customer.name) : ''} (klik om te wijzigen)</summary>
      <div class="row" style="margin-top:8px"><label>Naam <input id="cust-name" value="${esc(customer.name || '')}"></label><label>Telefoon <input id="cust-phone" value="${esc(customer.phone || '')}"></label></div>
      <div class="row"><label>E-mail <input id="cust-email" value="${esc(customer.email || '')}"></label><label>Adres (straat, postcode, plaats) <input id="cust-address" value="${esc(customer.address || '')}"></label></div>
      <button type="button" class="btn btn-sm" id="cust-save">Klantgegevens opslaan</button><span class="muted small" style="margin-left:8px">Wijzigingen gelden voor deze klant overal in het CRM.</span>
    </details>` : ''}
    ${bundles.length && !locked ? `<details class="pl-collapse" open style="margin-bottom:10px"><summary style="cursor:pointer;font-weight:600;padding:8px 0">${icon('tag', 13)} Pakketten — één klik voegt meerdere regels toe</summary><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${bundles.map((bn, bi) => { const tot = (bn.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.priceExcl) || 0), 0); return `<button type="button" class="chip bn-add" data-bi="${bi}" title="${esc((bn.lines || []).map((l) => l.description).join(' · '))}" style="cursor:pointer;border-color:var(--brand,#2563eb)">${icon('tag', 12)} ${esc(bn.name.slice(0, 40))} · ${bn.lines.length} regels · ${eur(tot)}</button>`; }).join('')}</div></details>` : ''}
    ${priceList.length && !locked ? `<details class="pl-collapse" style="margin-bottom:12px"><summary style="cursor:pointer;font-weight:600;padding:8px 0">${icon('tag', 13)} Prijzenlijst — klik om te openen en snel toe te voegen</summary><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${priceList.map((p, pi) => `<button type="button" class="chip pl-add" data-pi="${pi}" title="€ ${Number(p.priceExcl).toFixed(2)} excl. btw" style="cursor:pointer">${esc(p.description.slice(0, 44))} · ${eur(p.priceExcl)}</button>`).join('')}</div></details>` : ''}
    <div id="inv-lines">${inv.lines.map(lineRow).join('')}</div>
    ${locked ? '' : `<button type="button" class="btn btn-sm" id="il-add">+ Regel toevoegen</button>
    ${ctx.werkbon?.work ? `<button type="button" class="btn btn-sm" id="il-werkbon">Werkbon overnemen als regel</button>` : ''}
    <button type="button" class="btn btn-sm" id="il-to-pricelist" title="Alle regels hierboven toevoegen aan je vaste prijzenlijst">${icon('tag', 12)} Regels → prijslijst</button>
    <button type="button" class="btn btn-sm" id="il-to-bundle" title="Deze regels bewaren als pakket, om ze later met één klik toe te voegen">${icon('tag', 12)} Regels → pakket</button>
    <button type="button" class="btn btn-sm" id="il-refresh-prices" title="Regels bijwerken naar de huidige prijzen uit je prijslijst (op omschrijving)">${icon('refresh', 12)} Prijzen bijwerken</button>`}
    <div class="row" style="margin-top:10px"> <label>Btw-tarief <select id="inv-btw" ${locked ? 'disabled' : ''}><option value="21" ${Number(inv.btwPct) === 21 ? 'selected' : ''}>21%</option><option value="9" ${Number(inv.btwPct) === 9 ? 'selected' : ''}>9%</option><option value="0" ${Number(inv.btwPct) === 0 ? 'selected' : ''}>0%</option></select></label>
      <label>Opmerking op de ${esc(woord.toLowerCase())} <input id="inv-note" value="${esc(inv.note || '')}" placeholder="optioneel" ${locked ? 'disabled' : ''}></label> </div>
    <div class="row"> <label>Korting <select id="inv-disc-type" ${locked ? 'disabled' : ''}><option value="" ${!inv.discount ? 'selected' : ''}>Geen korting</option><option value="pct" ${inv.discount?.type === 'pct' ? 'selected' : ''}>Percentage (%)</option><option value="bedrag" ${inv.discount?.type === 'bedrag' ? 'selected' : ''}>Vast bedrag (excl. btw)</option></select></label>
      <label>Kortingswaarde <input id="inv-disc-val" type="number" min="0" step="0.01" value="${esc(String(inv.discount?.value ?? ''))}" placeholder="bv. 10" ${locked ? 'disabled' : ''}></label> </div>
    ${locked ? (inv.signature ? `<div style="margin:10px 0"><div class="muted small">Handtekening voor akkoord:</div><img src="${esc(inv.signature)}" alt="handtekening" style="max-width:200px;border:1px solid var(--line-soft, #e5e7eb);border-radius:6px;background:#fff"></div>` : '') : `
    <details class="pl-collapse" style="margin:12px 0"><summary style="cursor:pointer;font-weight:600;padding:8px 0">${icon('edit', 13)} Handtekening voor akkoord${inv.signature ? ' — gezet ✓' : ' (optioneel)'}</summary>
      <p class="muted small" style="margin:6px 0">Laat de klant hier tekenen; de handtekening komt op de PDF als bewijs van akkoord. Werkt ook zonder werkbon.</p>
      <canvas id="inv-sig" width="360" height="120" style="border:1px solid var(--line-soft, #cbd5e1);border-radius:8px;background:#fff;touch-action:none;max-width:100%;cursor:crosshair"></canvas>
      <div style="margin-top:6px"><button type="button" class="btn btn-sm" id="inv-sig-clear">Wissen</button><span class="muted small" id="inv-sig-status" style="margin-left:8px">${inv.signature ? 'Er staat al een handtekening — teken opnieuw om te vervangen, of Wissen om te verwijderen.' : ''}</span></div>
    </details>`}
    <div id="inv-totals" class="muted small" style="margin:8px 0;font-size:14px"></div>
    <div class="modal-actions">
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${inv.id && !isQuote && inv.status === 'verzonden' ? `<button class="btn btn-success" id="inv-paid">✓ Betaald</button><button class="btn" id="inv-remind">${icon('bell', 13)} Herinnering</button>` : ''}
        ${inv.id && isQuote && inv.status === 'verzonden' ? `<button class="btn btn-success" id="inv-accept">✓ Goedgekeurd</button><button class="btn btn-danger" id="inv-reject">✗ Afgekeurd</button><button class="btn" id="inv-qremind" title="Vriendelijke herinnering: per e-mail met PDF, of via WhatsApp als de klant alleen een 06 heeft">${icon('bell', 13)} Herinnering${inv.quoteFollowupCount ? ` (${inv.quoteFollowupCount}x)` : ''}</button>` : ''}
        ${inv.id && isQuote && (inv.status === 'goedgekeurd' || inv.status === 'verzonden') ? `<button class="btn" id="inv-tofactuur">→ Maak factuur</button>` : ''}
        ${inv.id ? `<button class="btn" id="inv-copy">${icon('merge', 13)} Kopieer</button>` : ''}
        ${inv.id && inv.status !== 'betaald' ? `<button class="btn btn-danger" id="inv-del">${icon('trash', 13)} Verwijder</button>` : ''}
      </div>
      <div class="right">
        ${inv.id ? `<a class="btn" target="_blank" rel="noopener" href="/api/invoices/${inv.id}/pdf">${icon('eye', 14)} PDF openen</a>` : ''}
        ${inv.id ? `<button class="btn" id="inv-share">${icon('paperclip', 14)} Delen / opslaan</button>` : ''}
        ${inv.id && locked ? `<button class="btn" id="inv-resend">${icon('mail', 14)} Verstuur opnieuw</button>` : ''}
        <button class="btn" id="inv-cancel">Sluiten</button>
        ${locked ? '' : `<button class="btn" id="inv-save">Concept opslaan</button>
        <button class="btn btn-primary" id="inv-send">${inv.status === 'verzonden' ? 'Opnieuw versturen' : 'Versturen naar klant'}</button>
        <button class="btn" id="inv-send-wa" title="Stuur de PDF als WhatsApp-bericht naar de klant">${icon('whatsapp', 14)} Via WhatsApp</button>`}
      </div>
    </div>`);
  const readLines = () => $$('#inv-lines .inv-line').map((row) => ({
    description: $('.il-desc', row).value, qty: Number($('.il-qty', row).value) || 0, priceExcl: Number($('.il-price', row).value) || 0,
  })).filter((l) => l.description || l.priceExcl > 0);
  const readDiscount = () => {
    const type = $('#inv-disc-type')?.value || '';
    const value = Number($('#inv-disc-val')?.value) || 0;
    return type && value > 0 ? { type, value } : null;
  };
  const renderTotals = () => {
    const btw = Number($('#inv-btw').value);
    const sub = readLines().reduce((s, l) => s + l.qty * l.priceExcl, 0);
    // Zelfde rekenwijze als de server: korting van het subtotaal EXCL btw af,
    // daarna de btw over het verlaagde bedrag.
    const d = readDiscount();
    const korting = d ? (d.type === 'pct' ? sub * Math.min(100, d.value) / 100 : Math.min(d.value, sub)) : 0;
    const excl = sub - korting;
    const btwBedrag = excl * (btw / 100);
    $('#inv-totals').innerHTML = `${korting > 0 ? `Subtotaal: <strong>${eur(sub)}</strong> · korting${d.type === 'pct' ? ` (${d.value}%)` : ''}: <strong>- ${eur(korting)}</strong> · ` : ''}Totaal excl. btw: <strong>${eur(excl)}</strong> · btw ${btw}%: <strong>${eur(btwBedrag)}</strong> · <span style="font-size:16px">Totaal incl. btw: <strong>${eur(excl + btwBedrag)}</strong></span>`;
  };
  if ($('#inv-disc-type')) $('#inv-disc-type').onchange = renderTotals;
  if ($('#inv-disc-val')) $('#inv-disc-val').oninput = renderTotals;
  const bindRows = () => {
    $$('#inv-lines input').forEach((i) => i.oninput = renderTotals);
    $$('#inv-lines .il-del').forEach((b) => b.onclick = () => { b.closest('.inv-line').remove(); renderTotals(); });
  };
  bindRows(); renderTotals();
  $('#inv-btw').onchange = renderTotals;
  if ($('#il-add')) $('#il-add').onclick = () => { $('#inv-lines').insertAdjacentHTML('beforeend', lineRow({ description: '', qty: 1, priceExcl: 0 }, 99)); bindRows(); renderTotals(); };
  $$('.pl-add').forEach((b) => b.onclick = () => { const p = priceList[Number(b.dataset.pi)]; if (!p) return; $('#inv-lines').insertAdjacentHTML('beforeend', lineRow({ description: p.description, qty: 1, priceExcl: p.priceExcl }, 99)); bindRows(); renderTotals(); });
  // Pakket: voeg ALLE regels van het pakket in één keer toe (arbeid + producten los).
  $$('.bn-add').forEach((b) => b.onclick = () => {
    const bn = (ctx.bundles || [])[Number(b.dataset.bi)]; if (!bn) return;
    // Een lege eerste regel (het standaard-lege concept) eerst opruimen.
    const first = $('#inv-lines .inv-line');
    if (first && !$('.il-desc', first).value.trim() && !(Number($('.il-price', first).value) > 0)) first.remove();
    for (const l of bn.lines || []) $('#inv-lines').insertAdjacentHTML('beforeend', lineRow({ description: l.description, qty: l.qty ?? 1, priceExcl: l.priceExcl ?? 0 }, 99));
    bindRows(); renderTotals(); toast(`Pakket "${bn.name}" toegevoegd (${bn.lines.length} regels)`);
  });
  // Alle huidige regels opslaan in de vaste prijslijst (losse producten).
  if ($('#il-to-pricelist')) $('#il-to-pricelist').onclick = async () => {
    const items = readLines(); if (!items.length) { toast('Geen regels om op te slaan', true); return; }
    try { const r = await api('/api/pricelist/add', 'POST', { items }); toast(`${r.added} nieuw in de prijslijst opgeslagen (${items.length} regel(s) verwerkt)`); }
    catch (err) { toast(err.message, true); }
  };
  // Alle huidige regels opslaan als pakket (bundel) onder een naam naar keuze.
  if ($('#il-to-bundle')) $('#il-to-bundle').onclick = async () => {
    const items = readLines(); if (!items.length) { toast('Geen regels om op te slaan', true); return; }
    const name = prompt(`Naam voor dit pakket (bv. "Hefschuifpui complete reparatie"):`, ctx.contextTitle || '');
    if (!name || !name.trim()) return;
    try { await api('/api/bundles/add', 'POST', { name: name.trim(), lines: items }); toast(`Pakket "${name.trim()}" opgeslagen — voortaan één klik`); }
    catch (err) { toast(err.message, true); }
  };
  // PRIJZEN BIJWERKEN: regels die al op dit concept staan krijgen de HUIDIGE prijs uit
  // de prijslijst (match op omschrijving). Een bestaand document verandert nooit vanzelf
  // — je ziet eerst wat er wijzigt en bevestigt zelf.
  if ($('#il-refresh-prices')) $('#il-refresh-prices').onclick = () => {
    const norm = (d) => String(d || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const prijs = new Map((priceList || []).map((p) => [norm(p.description), Number(p.priceExcl) || 0]));
    const wijzigingen = [];
    for (const row of $$('#inv-lines .inv-line')) {
      const d = norm($('.il-desc', row).value);
      const nieuw = prijs.get(d);
      if (nieuw === undefined) continue;
      const oud = Number($('.il-price', row).value) || 0;
      if (oud !== nieuw) wijzigingen.push({ row, oud, nieuw, desc: $('.il-desc', row).value });
    }
    if (!wijzigingen.length) return toast('Alle regels staan al op de huidige prijslijst-prijzen');
    const eur = (n) => '€ ' + Number(n).toFixed(2).replace('.', ',');
    const lijst = wijzigingen.slice(0, 8).map((w) => `• ${w.desc}: ${eur(w.oud)} → ${eur(w.nieuw)}`).join('\n');
    if (!confirm(`${wijzigingen.length} regel(s) bijwerken naar de huidige prijslijst?\n\n${lijst}${wijzigingen.length > 8 ? `\n… en nog ${wijzigingen.length - 8}` : ''}`)) return;
    for (const w of wijzigingen) $('.il-price', w.row).value = w.nieuw;
    bindRows(); renderTotals();
    toast(`${wijzigingen.length} regel(s) bijgewerkt — vergeet niet op te slaan`);
  };
  if ($('#il-werkbon')) $('#il-werkbon').onclick = () => { $('#inv-lines').insertAdjacentHTML('beforeend', lineRow({ description: (ctx.werkbon.work || '').replace(/\s+/g, ' ').slice(0, 200), qty: 1, priceExcl: 0 }, 99)); bindRows(); renderTotals(); };
  // Handtekening-canvas: teken direct op de factuur/offerte (los van een werkbon).
  let sigDrawn = false;   // klant heeft nu getekend
  let sigCleared = false; // klant heeft "Wissen" gebruikt (bestaande weghalen)
  const sigCanvas = $('#inv-sig');
  if (sigCanvas) {
    const cctx = sigCanvas.getContext('2d');
    cctx.lineWidth = 2; cctx.lineCap = 'round'; cctx.strokeStyle = '#111827';
    let drawing = false, lastX = 0, lastY = 0;
    const pos = (e) => { const r = sigCanvas.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return { x: (t.clientX - r.left) * (sigCanvas.width / r.width), y: (t.clientY - r.top) * (sigCanvas.height / r.height) }; };
    const start = (e) => { e.preventDefault(); drawing = true; const p = pos(e); lastX = p.x; lastY = p.y; };
    const move = (e) => { if (!drawing) return; e.preventDefault(); const p = pos(e); cctx.beginPath(); cctx.moveTo(lastX, lastY); cctx.lineTo(p.x, p.y); cctx.stroke(); lastX = p.x; lastY = p.y; sigDrawn = true; sigCleared = false; const st = $('#inv-sig-status'); if (st) st.textContent = ''; };
    const end = () => { drawing = false; };
    sigCanvas.addEventListener('pointerdown', start); sigCanvas.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    if ($('#inv-sig-clear')) $('#inv-sig-clear').onclick = () => { cctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height); sigDrawn = false; sigCleared = true; const st = $('#inv-sig-status'); if (st) st.textContent = inv.signature ? 'Handtekening wordt verwijderd bij opslaan.' : ''; };
  }
  const readSignature = () => {
    if (sigDrawn && sigCanvas) return sigCanvas.toDataURL('image/png');
    if (sigCleared) return '';
    return undefined; // niet aangeraakt = bestaande handtekening behouden
  };
  const saveConcept = async () => {
    const body = { lines: readLines(), btwPct: Number($('#inv-btw').value), note: $('#inv-note').value, discount: readDiscount() || {} };
    const sig = readSignature();
    if (sig !== undefined) body.signature = sig;
    return ctx.save(body);
  };
  // WAARSCHUWING (op verzoek Abdel): een al VERZONDEN factuur/offerte wijzig je niet
  // zomaar — de klant heeft al een andere versie ontvangen. Wijzigen mag, maar pas
  // na deze bewuste bevestiging (en het wordt in het logboek vastgelegd).
  const confirmEditIfSent = () => inv.status !== 'verzonden'
    || confirm(`LET OP: deze ${woord.toLowerCase()} is al verstuurd naar de klant. Wijzigen kan tot verwarring leiden — netter is een kopie (of bij een fout een creditregel). Toch wijzigen?`);
  const done = (msg) => { toast(msg); closeModal(); if (ctx.after) ctx.after(); };
  if ($('#cust-save')) $('#cust-save').onclick = async () => {
    const cp = { name: $('#cust-name').value, phone: $('#cust-phone').value, email: $('#cust-email').value, address: $('#cust-address').value };
    if (!cp.name.trim()) { toast('Naam mag niet leeg zijn', true); return; }
    try {
      const updated = await api(`/api/customers/${customer.id}`, 'PATCH', cp);
      Object.assign(customer, { name: updated.name, phone: updated.phone, email: updated.email, address: updated.address });
      const sum = $('#modal details summary'); if (sum) sum.innerHTML = `${icon('user', 13)} Klantgegevens — ${esc(customer.name)} (klik om te wijzigen)`;
      const h = $('#modal h2'); if (h) h.innerHTML = `${icon('mail', 16)} ${woord} — ${esc(customer.name)}`;
      toast('Klantgegevens opgeslagen');
    } catch (err) { toast(err.message, true); }
  };
  $('#inv-cancel').onclick = closeModal;
  if ($('#inv-share')) $('#inv-share').onclick = (e) => shareInvoicePdf(inv.id, `${woord}-${inv.number || ''}${customer.name ? ' ' + customer.name : ''}`, e.currentTarget);
  if ($('#inv-resend')) $('#inv-resend').onclick = () => resendInvoice(inv.id, `${woord} ${inv.number || ''}`, customer.email || inv.sentTo || '', () => { closeModal(); if (ctx.after) ctx.after(); });
  if ($('#inv-save')) $('#inv-save').onclick = async () => { if (!confirmEditIfSent()) return; try { await saveConcept(); done(inv.status === 'verzonden' ? 'Gewijzigd opgeslagen (vastgelegd in het logboek)' : 'Concept opgeslagen'); } catch (err) { toast(err.message, true); } };
  if ($('#inv-send')) $('#inv-send').onclick = async () => {
    if (!customer.email) { toast('Deze klant heeft nog geen e-mailadres — vul dat eerst in (op de kaart of bij Klanten).', true); return; }
    if (!confirm(inv.status === 'verzonden'
      ? `LET OP: deze ${woord.toLowerCase()} is al eerder verstuurd. Je verstuurt nu een NIEUWE versie (eventuele wijzigingen vervangen wat de klant heeft). Doorgaan naar ${customer.email}?`
      : `${woord} nu versturen naar ${customer.email}?`)) return;
    try {
      const saved = await saveConcept();
      await api(`/api/invoices/${saved.id}/send`, 'POST', {});
      done(`${woord} verstuurd naar de klant`);
    } catch (err) { toast(err.message, true); }
  };
  // Versturen via WhatsApp: de PDF gaat als bijlage mee naar het 06 van de klant.
  if ($('#inv-send-wa')) $('#inv-send-wa').onclick = async () => {
    const tel = (ctx.order && ctx.order.intake && ctx.order.intake.phone) || customer.phone || '';
    if (!tel) { toast('Deze klant heeft nog geen telefoonnummer — vul dat eerst in.', true); return; }
    if (!confirm(`${woord} als PDF via WhatsApp sturen naar ${tel}?`)) return;
    try {
      const saved = await saveConcept();
      await api(`/api/invoices/${saved.id}/send-whatsapp`, 'POST', {});
      done(`${woord} via WhatsApp verstuurd naar ${tel}`);
    } catch (err) { toast(err.message, true); }
  };
  const statusBtn = (sel, status, msg) => { if ($(sel)) $(sel).onclick = async () => { try { await api(`/api/invoices/${inv.id}/status`, 'POST', { status }); done(msg); } catch (err) { toast(err.message, true); } }; };
  statusBtn('#inv-paid', 'betaald', 'Gemarkeerd als betaald ✓');
  statusBtn('#inv-reject', 'afgekeurd', 'Offerte afgekeurd');
  // Goedkeuren: als er automatisch een factuur-concept van wordt gemaakt, dat meteen melden.
  if ($('#inv-accept')) $('#inv-accept').onclick = async () => {
    try {
      const r = await api(`/api/invoices/${inv.id}/status`, 'POST', { status: 'goedgekeurd' });
      if (r && r.autoInvoice) toast(`Offerte goedgekeurd ✓ — factuur-concept ${r.autoInvoice.number} klaargezet`);
      else toast('Offerte goedgekeurd ✓');
      closeModal(); if (ctx.after) ctx.after();
    } catch (err) { toast(err.message, true); }
  };
  if ($('#inv-remind')) $('#inv-remind').onclick = async () => {
    if (!confirm(`Vriendelijke betaalherinnering sturen naar ${inv.sentTo || customer.email}?`)) return;
    try { await api(`/api/invoices/${inv.id}/remind`, 'POST', {}); done('Herinnering verstuurd'); } catch (err) { toast(err.message, true); }
  };
  if ($('#inv-qremind')) $('#inv-qremind').onclick = async () => {
    const doel = customer.email || customer.phone || 'de klant';
    if (!confirm(`Vriendelijke offerte-herinnering sturen naar ${doel}? (E-mail met PDF, of WhatsApp als er alleen een 06 is.)`)) return;
    try {
      const r = await api(`/api/invoices/${inv.id}/quote-followup`, 'POST', {});
      done(`Herinnering verstuurd via ${r.via === 'whatsapp' ? 'WhatsApp' : 'e-mail'}`);
    } catch (err) { toast(err.message, true); }
  };
  if ($('#inv-copy')) $('#inv-copy').onclick = async () => {
    try { const copy = await api(`/api/invoices/${inv.id}/copy`, 'POST', {}); toast(`Gekopieerd → ${copy.number}`); closeModal(); openStandaloneInvoice(copy.id); } catch (err) { toast(err.message, true); }
  };
  if ($('#inv-tofactuur')) $('#inv-tofactuur').onclick = async () => {
    if (!confirm('Van deze offerte een factuur maken (nieuw factuurnummer)?')) return;
    try { const f = await api(`/api/invoices/${inv.id}/copy`, 'POST', { type: 'factuur' }); toast(`Factuur ${f.number} aangemaakt`); closeModal(); openStandaloneInvoice(f.id); } catch (err) { toast(err.message, true); }
  };
  if ($('#inv-del')) $('#inv-del').onclick = async () => {
    if (!confirm(`${woord} ${inv.number} definitief verwijderen?`)) return;
    try { await api(`/api/invoices/${inv.id}`, 'DELETE'); done(`${woord} verwijderd`); } catch (err) { toast(err.message, true); }
  };
}

// Nieuwe losse factuur/offerte: eerst klant kiezen (bestaand of nieuw).
function openNewInvoiceFlow(type) {
  const woord = type === 'offerte' ? 'Offerte' : 'Factuur';
  api('/api/customers').then((customers) => {
    modal(`
      <h2>${icon('mail', 16)} Nieuwe ${esc(woord.toLowerCase())} — kies de klant</h2>
      <label>Zoek bestaande klant <input id="ni-search" placeholder="Typ naam, telefoon of e-mail…" autocomplete="off"></label>
      <div id="ni-results" style="max-height:220px;overflow:auto;margin:6px 0 12px"></div>
      <details id="ni-newcust"><summary style="cursor:pointer;font-weight:600;padding:6px 0">+ Of maak een nieuwe klant</summary>
        <div class="row"><label>Naam <input id="ni-name"></label><label>Telefoon <input id="ni-phone"></label></div>
        <div class="row"><label>E-mail <input id="ni-email"></label><label>Adres (straat, postcode, plaats) <input id="ni-address"></label></div>
        <button class="btn btn-primary" id="ni-create" style="margin-top:8px">${esc(woord)} maken voor nieuwe klant</button>
      </details>
      <div class="modal-actions"><span></span><div class="right"><button class="btn" id="ni-cancel">Annuleren</button></div></div>`);
    const start = async (payload) => {
      try { const { invoice } = await api('/api/invoices', 'POST', { type, ...payload }); closeModal(); openStandaloneInvoice(invoice.id); }
      catch (err) { toast(err.message, true); }
    };
    const renderResults = () => {
      const q = ($('#ni-search').value || '').toLowerCase().trim();
      const hits = !q ? customers.slice(0, 8) : customers.filter((c) => `${c.name} ${c.phone} ${c.email}`.toLowerCase().includes(q)).slice(0, 12);
      $('#ni-results').innerHTML = hits.length ? hits.map((c) => `
        <div class="ni-hit" data-id="${esc(c.id)}" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:5px;cursor:pointer">
          <strong>${esc(c.name || 'Onbekend')}</strong> <span class="muted small">${esc(c.phone || '')}${c.email ? ' · ' + esc(c.email) : ''}${c.address ? ' · ' + esc(c.address) : ''}</span>
        </div>`).join('') : '<div class="muted small" style="padding:6px">Geen klant gevonden — maak hieronder een nieuwe aan.</div>';
      $$('.ni-hit').forEach((el) => el.onclick = () => start({ customerId: el.dataset.id }));
    };
    renderResults();
    $('#ni-search').oninput = renderResults;
    $('#ni-search').focus();
    $('#ni-create').onclick = () => start({ newCustomer: { name: $('#ni-name').value, phone: $('#ni-phone').value, email: $('#ni-email').value, address: $('#ni-address').value } });
    $('#ni-cancel').onclick = closeModal;
  }).catch((err) => toast(err.message, true));
}

// ---------- Prullenbak ----------
// ---------- AI Assistent (vraagbaak) ----------
async function loadAssistant() {
  const groups = await api('/api/assistant/groups').catch(() => []);
  const examples = [
    'Welke klanten hebben een offerte gekregen maar nog geen factuur?',
    'Welke klussen zijn volgens de groepsberichten afgerond maar staan nog niet op Afgerond?',
    'Welke facturen staan nog open en hoe lang al?',
    'Hoeveel omzet is er genoemd in de groep van Youssef de afgelopen 30 dagen?',
    'Vergelijk deze maand met vorige maand: omzet, kosten en aantal klussen.',
    'Welke klanten hebben meerdere klussen gehad? Wie is mijn beste klant?',
    'Wat is er besproken over de schuifpui-opdracht van mevrouw Jansen?',
    'Welke afspraken staan er deze week en zijn ze allemaal bevestigd?',
  ];
  $('#assistantPanel').innerHTML = `
    <div class="info-card">
      <p class="muted small" style="margin:-2px 0 10px">De assistent kijkt standaard naar <strong>álles</strong>: je opdrachtkaarten, facturen &amp; offertes, klanten en cijfers — plus het WhatsApp- en e-mailverkeer. Zo kan hij ook vergelijken ("welke klussen zijn volgens de groep afgerond maar staan nog op In behandeling?").</p>
      <div class="row">
        <label>Wat mag hij doorzoeken <select id="as-scope">
          <option value="all" selected>Alles — dashboard + berichten</option>
          <option value="messages">Alleen WhatsApp &amp; e-mail</option>
        </select></label>
        <label>AI-niveau <select id="as-model">
          <option value="sonnet" selected>Standaard (Sonnet) — snel</option>
          <option value="opus">Hoogste niveau (Opus) — scherper, duurder</option>
        </select></label>
      </div>
      <div class="row">
        <label>Zoeken in groep <select id="as-group"><option value="">Alle groepen + e-mail</option>${groups.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}</select></label>
        <label>Periode berichten <select id="as-days"><option value="0">Alles</option><option value="7">laatste 7 dagen</option><option value="30" selected>laatste 30 dagen</option><option value="90">laatste 90 dagen</option></select></label>
      </div>
      <label>Je vraag <textarea id="as-q" rows="3" placeholder="bv. Welke klanten hebben een offerte gekregen maar nog geen factuur?"></textarea></label>
      <div class="as-examples">${examples.map((e) => `<button type="button" class="chip as-ex">${esc(e)}</button>`).join('')}</div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" id="as-ask">${icon('sparkles', 14)} Vraag de AI</button><button class="btn" id="as-new" title="Geheugen wissen en met een schone lei beginnen">Nieuw gesprek</button></div>
      <p class="muted small" style="margin:8px 0 0">De assistent onthoudt dit gesprek: je kunt gewoon <strong>doorvragen</strong> ("en van die drie, wie heeft nog niet betaald?"). Kaartnummers in het antwoord zijn <strong>klikbaar</strong> — die openen direct de kaart.</p>
      <div id="as-answer" style="margin-top:16px"></div>
    </div>
    <div class="info-card" style="margin-top:18px">
      <h3>${icon('activity', 15)} AI-statusscan — sorteer alles in één keer</h3>
      <p class="muted small">De AI scant al je lopende kaarten én de groeps-/e-mailberichten. Hij snapt de werkwijze: opdracht binnen → monteur stuurt 's avonds een rapport in de monteursgroep → kantoor koppelt terug in de Raf Breda-groep. Je krijgt <strong>(1)</strong> statusvoorstellen (afgerond / geannuleerd / offerte / afspraak) en <strong>(2)</strong> opdrachten die nog <strong>teruggekoppeld</strong> moeten worden in de Raf Breda-groep, met kant-en-klare tekst om te plakken.</p>
      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
        <label style="margin:0">Periode berichten <select id="ss-days"><option value="14">laatste 14 dagen</option><option value="30" selected>laatste 30 dagen</option><option value="90">laatste 90 dagen</option></select></label>
        <button class="btn btn-primary" id="ss-run">Statusscan starten</button>
      </div>
      ${state.me.role === 'admin' ? `<label style="display:flex;align-items:center;gap:8px;flex-direction:row;margin-top:10px"><input type="checkbox" id="ss-auto" style="width:auto"> Elke nacht automatisch scannen (resultaat ligt 's ochtends klaar)</label>` : ''}
      <div id="ss-result" style="margin-top:14px"></div>
    </div>`;
  // Nachtelijke auto-scan (alleen admin): huidige stand laden + direct opslaan bij wijzigen.
  if ($('#ss-auto')) {
    api('/api/settings').then((st) => { const el = $('#ss-auto'); if (el) el.checked = !!st.autoScan?.enabled; }).catch(() => {});
    $('#ss-auto').onchange = async () => {
      try { await api('/api/settings', 'PATCH', { autoScan: { enabled: $('#ss-auto').checked, hour: 5 } }); toast($('#ss-auto').checked ? 'Nachtelijke scan aan (rond 05:00)' : 'Nachtelijke scan uit'); }
      catch (err) { toast(err.message, true); }
    };
  }
  $$('.as-ex').forEach((b) => b.onclick = () => { $('#as-q').value = b.textContent; });
  $('#ss-run').onclick = async () => {
    try { await api('/api/assistant/status-scan/start', 'POST', { days: Number($('#ss-days').value) }); }
    catch (err) { return toast(err.message, true); }
    ssPollActive = true; pollStatusScan();
  };
  // Bij openen: laatste resultaat tonen + verder pollen als er nog een scan loopt.
  ssPollActive = true; pollStatusScan();
  renderAsChat();
  $('#as-new').onclick = () => { _asChat = []; renderAsChat(); toast('Nieuw gesprek gestart — geheugen gewist'); };
  $('#as-ask').onclick = async () => {
    const question = $('#as-q').value.trim();
    if (!question) return toast('Stel eerst een vraag', true);
    const btn = $('#as-ask'); btn.disabled = true; btn.innerHTML = 'Bezig met zoeken…';
    const scope = $('#as-scope')?.value || 'all';
    renderAsChat(`De AI doorzoekt ${scope === 'all' ? 'je dashboard én de berichten' : 'de berichten'}${_asChat.length ? ' (mét het gesprek tot nu toe)' : ''}… dit kan ~10-40 sec duren.`);
    try {
      const out = await api('/api/assistant/ask', 'POST', {
        question, group: $('#as-group').value, days: Number($('#as-days').value),
        scope, model: $('#as-model')?.value || 'sonnet',
        history: _asChat.map((t) => ({ q: t.q, a: t.a })),
      });
      _asChat.push({ q: question, a: out.text, meta: `Doorzocht: ${out.dashboardIncluded ? 'dashboard + ' : ''}${out.searched || 0} berichten · ${out.engine || ''}` });
      $('#as-q').value = '';
      renderAsChat();
    } catch (err) { renderAsChat('', err.message); }
    btn.disabled = false; btn.innerHTML = `${icon('sparkles', 14)} Vraag de AI`;
  };
}

// Gesprek met de assistent (blijft staan zolang je niet op "Nieuw gesprek" klikt of herlaadt).
let _asChat = [];
// Kaartnummers (#a1b2c3) in een AI-antwoord klikbaar maken: klik = kaart openen.
function linkifyCardRefs(escapedText) {
  return escapedText.replace(/#([a-z0-9]{6})\b/gi, '<button type="button" class="chip as-cardref" data-ref="$1">#$1</button>');
}
function renderAsChat(busyText = '', errText = '') {
  const box = $('#as-answer'); if (!box) return;
  let html = _asChat.map((t) => `
    <div class="as-turn">
      <div class="as-q"><strong>Jij:</strong> ${esc(t.q)}</div>
      <div class="analysis-box">${linkifyCardRefs(esc(t.a)).replace(/\n/g, '<br>')}</div>
      ${t.meta ? `<div class="muted small" style="margin-top:4px">${esc(t.meta)}</div>` : ''}
    </div>`).join('');
  if (busyText) html += `<div class="muted small">${esc(busyText)}</div>`;
  if (errText) html += `<div class="error small">${esc(errText)}</div>`;
  box.innerHTML = html;
  $$('#as-answer .as-cardref').forEach((b) => b.onclick = async () => {
    const ref = (b.dataset.ref || '').toLowerCase();
    if (!state.orders.length) state.orders = await api('/api/orders').catch(() => []);
    let ord = state.orders.find((o) => o.id.toLowerCase().endsWith(ref));
    if (!ord) { // ook het archief doorzoeken
      const all = await api('/api/orders?includeArchived=1').catch(() => []);
      ord = (all || []).find((o) => o.id.toLowerCase().endsWith(ref));
      if (ord) { openOrderModal(ord.id, all); return; }
    }
    if (!ord) return toast('Kaart niet gevonden (misschien verwijderd)', true);
    markSeen(ord.id); openOrderModal(ord.id);
  });
  const last = box.querySelector('.as-turn:last-of-type, .muted.small:last-child, .error');
  if (last) last.scrollIntoView({ block: 'nearest' });
}

// Achtergrond-statusscan: pollt de server (scan loopt door ook als je wegswipet)
// en toont het laatst opgehaalde resultaat. Stopt zodra je de pagina verlaat.
let ssPollActive = false;
async function pollStatusScan() {
  const btn = $('#ss-run'); const box = $('#ss-result');
  if (!btn || !box) { ssPollActive = false; return; } // pagina verlaten
  let data;
  try { data = await api('/api/assistant/status-scan/result'); }
  catch { if (ssPollActive) setTimeout(pollStatusScan, 4000); return; }
  if (data.running) {
    btn.disabled = true; btn.textContent = 'Bezig met scannen…';
    if (!box.innerHTML.includes('ss-item')) box.innerHTML = '<div class="muted small">De AI leest alle kaarten en groepsberichten op de achtergrond… je kunt gerust wegklikken, het loopt door.</div>';
    if (ssPollActive) setTimeout(pollStatusScan, 3000);
    return;
  }
  btn.disabled = false; btn.textContent = 'Statusscan starten';
  if (data.last) renderStatusScan(data.last);
}

function renderStatusScan(out) {
  const box = $('#ss-result'); if (!box) return;
  const sugg = out.suggestions || [];
  const todo = out.needsDrsUpdate || [];
  const when = out.at ? `<div class="muted small" style="margin-bottom:8px">Laatste scan: ${esc(fmtDate(out.at))} · ${out.cards || 0} kaarten en ${out.scanned || 0} berichten doorzocht${out.engine ? ' · ' + esc(out.engine) : ''}</div>` : '';
  // Bron-telling: laat zien of de monteursrapporten überhaupt binnenkomen. 0 = probleem aan
  // de WhatsApp-kant (bridge/groep), niet aan de AI.
  let src = '';
  if (out.sources) {
    const s = out.sources;
    const warn = (s.monteur || 0) === 0;
    src = `<div class="muted small" style="margin-bottom:8px${warn ? ';color:var(--danger)' : ''}">Berichten: ${s.monteur || 0} uit monteursgroep · ${s.drs || 0} uit DRS/Raf Breda · ${s.email || 0} e-mail · ${s.overig || 0} overig.${warn ? ' ⚠ 0 monteursrapporten binnen — de dagrapporten bereiken het CRM niet. Controleer of het wegwerp-nummer in de monteursgroep zit én of de bridge die groep doorstuurt (GROUP_FILTER leeg laten). Zonder deze rapporten kan de AI de kaarten niet sorteren.' : ''}</div>`;
  }
  let html = when + src;
  if (out.error) html += `<div class="error small">Laatste scan mislukt: ${esc(out.error)}</div>`;
  // Reeds toegepaste voorstellen (deze scan) blijven zichtbaar als "toegepast" tot je opnieuw scant.
  const appliedSet = new Set((out.appliedIds || []).map(String));
  const openSugg = sugg.filter((s) => !appliedSet.has(String(s.orderId)));
  const doneSugg = sugg.filter((s) => appliedSet.has(String(s.orderId)));
  if (openSugg.length) {
    html += `<div class="ss-bulkbar"><span class="muted small">${openSugg.length} statusvoorstel(len) open</span><button class="btn btn-sm btn-success" id="ss-apply-all">Alles toepassen</button></div>` + openSugg.map((s) => `
      <div class="ss-item" data-oid="${esc(s.orderId)}">
        <div><strong>${esc(s.title)}</strong>: ${esc(s.fromLabel)} → <strong>${esc(s.toLabel)}</strong></div>
        <div class="muted small">${esc(s.reason)}</div>
        ${s.evidence ? `<div class="muted small" style="font-style:italic">"${esc(s.evidence.slice(0, 160))}"</div>` : ''}
        <div style="margin-top:6px;display:flex;gap:6px"><button class="btn btn-sm btn-success ss-apply" data-id="${s.orderId}" data-to="${esc(s.to)}" data-ev="${esc((s.evidence || '').slice(0, 200))}">Toepassen</button><button class="btn btn-sm ss-ignore">Negeren</button></div>
      </div>`).join('');
  }
  if (doneSugg.length) {
    html += `<details style="margin:10px 0"><summary class="muted small" style="cursor:pointer">✓ ${doneSugg.length} al toegepast in deze scan (klik om te tonen)</summary>${doneSugg.map((s) => `
      <div class="ss-item" style="opacity:.6"><div><strong>${esc(s.title)}</strong>: ${esc(s.fromLabel)} → <strong>${esc(s.toLabel)}</strong> <span class="chip" style="color:var(--ok)">toegepast ✓</span></div></div>`).join('')}</details>`;
  }
  if (todo.length) {
    html += `<div class="ss-drs-head"><strong>${icon('whatsapp', 14)} Nog terugkoppelen in de Raf Breda-groep (${todo.length})</strong><div class="muted small">Deze opdrachten hebben een bekende uitkomst, maar lijken nog niet teruggekoppeld in de DRS-groep. Kopieer de tekst en plak die in WhatsApp.</div></div>` + todo.map((t) => `
      <div class="ss-item ss-drs" data-id="${esc(t.orderId)}">
        <div><strong>${esc(t.title)}</strong>${t.address ? ` <span class="muted small">· ${esc(t.address)}</span>` : ''} <span class="muted small">(${esc(t.statusLabel)})</span></div>
        <div class="muted small">${esc(t.reason)}</div>
        ${t.suggestedText ? `<div class="ss-drs-text">${esc(t.suggestedText)}</div>` : ''}
        <div style="margin-top:6px;display:flex;gap:6px">${t.suggestedText ? `<button class="btn btn-sm btn-primary ss-copy" data-text="${esc(t.suggestedText)}">Kopieer tekst</button>` : ''}<button class="btn btn-sm ss-ignore">Klaar / negeren</button></div>
      </div>`).join('');
  }
  if (out.note && (sugg.length || todo.length)) html += `<div class="muted small" style="margin-bottom:8px">${esc(out.note)}</div>`;
  if (!sugg.length && !todo.length) html += `<div class="muted small">${esc(out.note || 'Geen wijzigingen voorgesteld. De AI vond in het CRM geen duidelijk bewijs (een bericht of monteursmelding) om een kaart te verplaatsen. Staat er tóch een kaart in de verkeerde status? Dan mist de AI het bewijs — bijvoorbeeld omdat de "klaar"-melding van de monteur alleen in de WhatsApp-groep staat en niet in het CRM. Zet die kaart dan handmatig goed, of laat de monteursgroep meelezen.')}</div>`;
  if (out.rawSample) html += `<details style="margin-top:8px"><summary class="muted small" style="cursor:pointer">Technische details (ruwe AI-antwoord, voor debugging)</summary><pre style="white-space:pre-wrap;font-size:11px;background:var(--panel-2);border:1px solid var(--border);border-radius:8px;padding:10px;max-height:300px;overflow:auto">${esc(out.rawSample)}</pre></details>`;
  box.innerHTML = html;
  $$('.ss-apply').forEach((b) => b.onclick = async () => {
    try {
      await api(`/api/orders/${b.dataset.id}`, 'PATCH', { status: b.dataset.to, aiSuggested: true, aiEvidence: b.dataset.ev || '' });
      await api('/api/assistant/status-scan/applied', 'POST', { orderId: b.dataset.id }).catch(() => {});
      toast('Status bijgewerkt'); pollStatusScan(); loadBoard();
    } catch (err) { toast(err.message, true); }
  });
  if ($('#ss-apply-all')) $('#ss-apply-all').onclick = async () => {
    const items = $$('.ss-apply');
    if (!items.length) return;
    if (!confirm(`${items.length} statuswijziging(en) in één keer toepassen?`)) return;
    let ok = 0; const done = [];
    for (const b of items) { try { await api(`/api/orders/${b.dataset.id}`, 'PATCH', { status: b.dataset.to }); ok++; done.push(b.dataset.id); } catch { /* skip */ } }
    await api('/api/assistant/status-scan/applied', 'POST', { orderIds: done }).catch(() => {});
    toast(`${ok} opdracht(en) bijgewerkt`);
    pollStatusScan(); loadBoard();
  };
  $$('.ss-ignore').forEach((b) => b.onclick = () => b.closest('.ss-item').remove());
  $$('.ss-copy').forEach((b) => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.text); toast('Tekst gekopieerd — plak in de Raf Breda-groep'); b.textContent = 'Gekopieerd ✓'; }
    catch { toast('Kopiëren niet gelukt', true); }
  });
}

// ---------- Agenda ----------
async function loadAgenda() {
  const [agenda, orders] = await Promise.all([api('/api/agenda'), api('/api/orders')]);
  state._agenda = agenda;
  state.orders = orders; // zodat het openen van een kaart de volledige opdracht heeft
  renderAgenda();
}
function renderAgenda() {
  const scope = $('#agendaScope')?.value || 'all';
  let items = state._agenda || [];
  if (scope === 'drs') items = items.filter((a) => a.isDrs);
  const wrap = $('#agendaList');
  // BELANGRIJK: één afspraak met een onleesbare datum mag NOOIT de hele agenda leeg
  // maken. We slaan zulke afspraken over (en tellen ze) i.p.v. te crashen op toISOString().
  const parse = (d) => { const x = new Date(d); return isNaN(x.getTime()) ? null : x; };
  let skipped = 0;
  items = items.filter((a) => { if (parse(a.at)) return true; skipped++; return false; });
  const skipNote = skipped ? `<div class="muted small" style="margin-bottom:10px">${skipped} afspraak/afspraken met een onleesbare datum overgeslagen.</div>` : '';
  if (!items.length) { wrap.innerHTML = skipNote + '<div class="empty">Geen afspraken gepland.</div>'; return; }
  // Groeperen per dag (datum als sleutel).
  const fmtDay = (d) => parse(d).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
  const dayKey = (d) => parse(d).toISOString().slice(0, 10);
  const fmtTime = (d) => parse(d).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  const todayKey = new Date().toISOString().slice(0, 10);
  const groups = {};
  for (const a of items) { const k = dayKey(a.at); (groups[k] = groups[k] || []).push(a); }
  const dayBlock = (k) => `
    <div class="agenda-day">
      <div class="agenda-day-head">${k === todayKey ? '<span class="agenda-today">Vandaag</span> ' : ''}${esc(fmtDay(k))}<span class="count">${groups[k].length}</span></div>
      ${groups[k].map((a) => `
        <div class="agenda-item" data-open="${a.id}">
          <div class="agenda-time">${esc(fmtTime(a.at))}${a.endAt ? '<span class="agenda-endtime">' + esc(fmtTime(a.endAt)) + '</span>' : ''}</div>
          <div class="agenda-body">
            <div class="agenda-title"><span class="dot" style="background:${esc(statusColor(a.status))}"></span>${esc(a.title)} ${a.isDrs ? `<span class="chip src-whatsapp" title="${esc(a.originGroup || '')}">${esc(orderGroupLabel(a))}</span>` : ''}</div>
            <div class="muted small">${esc(a.customer || '')}${a.phone ? ' · ' + esc(a.phone) : ''}${a.address ? ' · ' + esc(a.address) : ''}</div>
            <div class="muted small">${esc(a.statusLabel)}${a.monteur ? ' · monteur ' + esc(a.monteur) : ' · geen monteur'}</div>
            <div style="display:flex;gap:14px;flex-wrap:wrap">
              ${a.address ? `<a class="agenda-gcal" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a.address)}">${icon('pin', 12)} Navigeer</a>` : ''}
              <a class="agenda-gcal" target="_blank" rel="noopener" href="${esc(googleCalUrl({ title: a.title, at: a.at, location: a.address, details: a.phone ? 'Tel: ' + a.phone : '' }))}">${icon('calendar', 12)} Zet in Google Agenda</a>
            </div>
          </div>
        </div>`).join('')}
    </div>`;
  const allKeys = Object.keys(groups).sort();
  const upcoming = allKeys.filter((k) => k >= todayKey);          // vandaag + toekomst
  const past = allKeys.filter((k) => k < todayKey).reverse();      // voorbij: nieuwste eerst
  const pastCount = past.reduce((n, k) => n + groups[k].length, 0);
  let html = skipNote + (upcoming.length ? upcoming.map(dayBlock).join('')
    : '<div class="empty" style="margin-bottom:10px">Geen openstaande afspraken meer.</div>');
  if (past.length) {
    html += `<details class="agenda-past"><summary>${icon('clock', 13)} Afgelopen afspraken (${pastCount}) — klik om te tonen</summary>${past.map(dayBlock).join('')}</details>`;
  }
  wrap.innerHTML = html;
  $$('.agenda-item[data-open]').forEach((el) => el.onclick = (e) => { if (e.target.closest('.agenda-gcal')) return; markSeen(el.dataset.open); openOrderModal(el.dataset.open); });
}

async function loadTrash() {
  state._trash = await api('/api/trash');
  renderTrash();
}
function renderTrash() {
  const isAdmin = hasPerm('hardDelete'); // recht 'definitief verwijderen'
  const q = ($('#trashSearch')?.value || '').toLowerCase();
  const items = (state._trash || []).filter((o) => {
    if (!q) return true;
    const threadTxt = (o.thread || []).map((t) => t.body || '').join(' ');
    const hay = `${o.title} ${o.description || ''} ${o.customer?.name || ''} ${o.customer?.phone || ''} ${o.customer?.email || ''} ${o.customer?.address || ''} ${o.notes || ''} ${o.source || ''} ${threadTxt}`.toLowerCase();
    return hay.includes(q);
  });
  $('#trashList').innerHTML = items.length ? items.map((o) => `
    <div class="info-card"> <h3>${esc(o.title)}</h3> <div class="muted small">${esc(o.customer?.name || '')}${o.customer?.phone ? ' · ' + esc(o.customer.phone) : ''}</div> <div class="muted small" style="margin-top:4px">Verwijderd door ${esc(o.deletedBy || '?')} · ${fmtDateShort(o.deletedAt)}</div> <div style="margin-top:12px;display:flex;gap:6px"> <button class="btn btn-sm" data-restore="${o.id}">${icon('reply', 13)} Terughalen</button> ${isAdmin ? `<button class="btn btn-sm btn-danger" data-perm="${o.id}">Definitief</button>` : ''}
      </div> </div>`).join('') : `<div class="empty">${q ? 'Niets gevonden in de prullenbak.' : 'De prullenbak is leeg.'}</div>`;
  $$('[data-restore]').forEach((b) => b.onclick = async () => {
    try { await api(`/api/trash/${b.dataset.restore}/restore`, 'POST'); toast('Teruggehaald'); loadTrash(); }
    catch (err) { toast(err.message, true); }
  });
  $$('[data-perm]').forEach((b) => b.onclick = async () => {
    if (!confirm('Definitief verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;
    try { await api(`/api/trash/${b.dataset.perm}`, 'DELETE'); toast('Definitief verwijderd'); loadTrash(); }
    catch (err) { toast(err.message, true); }
  });
}

async function openMonteurModal(m) {
  // Google-agenda's ophalen (alleen tonen als de koppeling actief is).
  let calField = '';
  try {
    const g = await api('/api/google/status');
    if (g.connected) {
      const opts = ['<option value="">— geen (gebruik standaardagenda) —</option>']
        .concat((g.calendars || []).map((c) => `<option value="${esc(c.id)}" ${m?.calendarId === c.id ? 'selected' : ''}>${esc(c.name)}${c.primary ? ' (hoofd)' : ''}</option>`)).join('');
      calField = `<label>Google Agenda van deze monteur <select id="m-cal">${opts}</select><span class="muted small">Afspraken van deze monteur komen in deze agenda.</span></label>`;
    } else if (g.configured) {
      calField = `<p class="muted small">Wil je afspraken in de Google Agenda van deze monteur? Verbind eerst Google Agenda bij <strong>Instellingen</strong>.</p>`;
    }
  } catch { /* google-status optioneel */ }
  modal(`
    <h2>${m ? 'Monteur bewerken' : 'Nieuwe monteur'}</h2> <label>Naam <input id="m-name" value="${esc(m?.name || '')}"></label> <div class="row"> <label>Telefoon <input id="m-phone" value="${esc(m?.phone || '')}"></label> <label>E-mail <input id="m-email" value="${esc(m?.email || '')}"></label> </div> <label>WhatsApp-groep (voor opdrachten) <input id="m-wagroup" value="${esc(m?.waGroup || '')}" placeholder="exacte naam van de WhatsApp-groep"></label> ${calField} <div class="modal-actions"><span></span><div class="right"> <button class="btn" id="m-cancel">Annuleren</button><button class="btn btn-primary" id="m-save">Opslaan</button> </div></div>`);
  // Automatische review per monteur aan/uit — los van de algemene instelling.
  const revWrap = document.createElement('label');
  revWrap.style.cssText = 'display:flex;align-items:center;gap:8px;flex-direction:row;margin-top:4px';
  revWrap.innerHTML = `<input type="checkbox" id="m-reviewauto" style="width:auto"${m?.reviewAuto === false ? '' : ' checked'}> Automatisch review vragen na een afgeronde klus van deze monteur`;
  const acties = $('#modal .modal-actions');
  if (acties) acties.parentNode.insertBefore(revWrap, acties);
  $('#m-cancel').onclick = closeModal;
  $('#m-save').onclick = async () => {
    const payload = { name: $('#m-name').value, phone: $('#m-phone').value, email: $('#m-email').value, waGroup: $('#m-wagroup').value, reviewAuto: !!$('#m-reviewauto')?.checked };
    if ($('#m-cal')) payload.calendarId = $('#m-cal').value;
    if (!payload.name) return toast('Naam verplicht', true);
    try {
      if (m) await api(`/api/monteurs/${m.id}`, 'PATCH', payload);
      else await api('/api/monteurs', 'POST', payload);
      closeModal(); toast('Opgeslagen'); loadMonteurs();
    } catch (err) { toast(err.message, true); }
  };
}

// ---------- AI control panel ----------
async function loadControl() {
  const stats = await api('/api/stats');
  const settings = await api('/api/settings');
  const ai = stats.ai;
  const pct = settings.aiAutoApproveThreshold ? Math.round(settings.aiAutoApproveThreshold * 100) : 0;
  $('#controlPanel').innerHTML = `
    <div class="stat-grid"> <div class="stat"><div class="num">${ai.mode === 'ai' ? 'AI' : 'Demo'}</div><div class="lbl">Categorisatie-modus</div></div> <div class="stat"><div class="num">${ai.handled}</div><div class="lbl">Berichten verwerkt</div></div> <div class="stat"><div class="num">${ai.accuracy === null ? '—' : ai.accuracy + '%'}</div><div class="lbl">Juist ingedeeld (na controle)</div></div> <div class="stat"><div class="num">${ai.corrected}</div><div class="lbl">Door mens gecorrigeerd</div></div> <div class="stat"><div class="num">${stats.pendingReviews}</div><div class="lbl">Wacht op controle</div></div> </div> <div class="info-card" style="max-width:680px"> <h3>Controle-instelling</h3> <p class="muted small">Hoe zeker moet de AI zijn voordat een bericht <strong>automatisch</strong> een opdracht wordt (zonder handmatige controle)? Zet op 0% om <strong>alles</strong> handmatig te controleren (veiligst).</p> <label>Drempel voor automatisch goedkeuren: <strong id="threshLbl">${pct}%</strong> <input type="range" id="threshold" min="0" max="100" step="5" value="${pct}"></label> <button class="btn btn-primary" id="saveThreshold">Opslaan</button> </div> ${ai.mode === 'demo' ? '<p class="muted small" style="max-width:680px;margin-top:14px">De AI draait nu in <strong>demo-modus</strong> (regels). Vul een Claude API-sleutel in (<code>ANTHROPIC_API_KEY</code>) voor slimmere categorisatie. Zie docs/INTEGRATIES.md.</p>' : '<p class="muted small" style="margin-top:14px">Slimme AI (Claude) is actief.</p>'}
    <div class="info-card" style="max-width:680px;margin-top:16px"> <h3>Wekelijkse agenda inklappen</h3> <p class="muted small">Gebeurt automatisch elke zondag na 23:59. Opdrachten van de afgelopen week worden ingeklapt onder een agenda-bundel — behalve openstaande/nieuwe opdrachten en afspraken die ná die week vallen. Je kunt het ook nu handmatig uitvoeren.</p> <button class="btn" id="runArchive">${icon('box', 14)} Nu de afgelopen week inklappen</button> </div> <div class="info-card" style="max-width:680px;margin-top:16px"> <h3>Systeemcheck</h3> <p class="muted small">Test of e-mail (ontvangen/versturen) en de AI nog werken. Draait ook automatisch elke 6 uur.</p> <div id="healthList">Laden…</div> <button class="btn" id="runHealth" style="margin-top:10px">${icon('refresh', 14)} Nu opnieuw testen</button> </div> <div class="info-card" style="max-width:680px;margin-top:16px"> <h3>Afwijzingen & feedback (waar de AI van leert)</h3> <p class="muted small">De laatste afwijzingen met reden. De AI krijgt deze mee om dezelfde fouten te vermijden.</p> <div id="feedbackList" class="feedback-list">Laden…</div> </div> `;
  loadFeedbackList();
  loadHealth();
  $('#runHealth').onclick = () => loadHealth(true);
  const range = $('#threshold');
  range.oninput = () => ($('#threshLbl').textContent = range.value + '%');
  $('#saveThreshold').onclick = async () => {
    await api('/api/settings', 'PATCH', { aiAutoApproveThreshold: Number(range.value) / 100 });
    toast('Instelling opgeslagen');
  };
  $('#runArchive').onclick = async () => {
    const r = await api('/api/archives/run', 'POST');
    toast(r.archived > 0 ? `${r.archived} opdrachten ingeklapt onder "${r.week.label}"` : 'Niets om in te klappen (al gedaan of niets passend)');
  };
}

async function loadFeedbackList() {
  const el = $('#feedbackList');
  if (!el) return;
  const fb = await api('/api/feedback');
  const tools = state.me.role === 'admin'
    ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><button class="btn btn-sm btn-danger" id="fb-clear-today">Leervoorbeelden van vandaag wissen</button><button class="btn btn-sm btn-danger" id="fb-clear-all">Alle leervoorbeelden wissen</button></div>`
    : '';
  if (!fb.length) { el.innerHTML = tools + '<div class="muted small">Nog geen afwijzingen.</div>'; bindFbTools(); return; }
  el.innerHTML = tools + fb.map((f) => `
    <div class="feedback-item"> <div><strong>${esc(f.reason)}</strong>${f.shouldBe ? ` <span class="chip"> ${esc(f.shouldBe)}</span>` : ''}
        <span class="muted small">· ${esc(f.by)} · ${fmtDateShort(f.at)}</span>
        <button class="btn btn-sm fb-del" data-id="${f.id}" title="Dit leervoorbeeld verwijderen" style="float:right">verwijder</button></div> ${f.note ? `<div class="small">${esc(f.note)}</div>` : ''}
      ${f.sample ? `<div class="muted small" style="margin-top:3px">“${esc(f.sample.slice(0, 120))}…”</div>` : ''}
    </div>`).join('');
  $$('.fb-del').forEach((b) => b.onclick = async () => {
    try { await api(`/api/feedback/${b.dataset.id}`, 'DELETE'); toast('Verwijderd'); loadFeedbackList(); }
    catch (err) { toast(err.message, true); }
  });
  bindFbTools();
}
function bindFbTools() {
  $('#fb-clear-today')?.addEventListener('click', async () => {
    if (!confirm('Alle leervoorbeelden van VANDAAG wissen? (handig na een verkeerde bulk-actie)')) return;
    try { const r = await api('/api/feedback/clear-today', 'POST'); toast(`${r.removed} gewist`); loadFeedbackList(); }
    catch (err) { toast(err.message, true); }
  });
  $('#fb-clear-all')?.addEventListener('click', async () => {
    if (!confirm('ALLE AI-leervoorbeelden wissen en schoon beginnen? Dit kan niet ongedaan worden gemaakt.')) return;
    try { const r = await api('/api/feedback/clear-all', 'POST'); toast(`${r.removed} gewist — schoon begonnen`); loadFeedbackList(); }
    catch (err) { toast(err.message, true); }
  });
}

async function loadHealth(run = false) {
  const el = $('#healthList');
  if (!el) return;
  el.innerHTML = '<div class="muted small">Testen…</div>';
  try {
    const h = await api('/api/health' + (run ? '?run=1' : ''));
    const row = (label, c) => `<div class="health-row"><span class="hdot ${c.ok ? 'ok' : 'bad'}"></span><strong>${label}</strong><span class="muted small">${esc(c.detail || '')}</span></div>`;
    el.innerHTML = `
      <div class="health-summary ${h.allOk ? 'ok' : 'bad'}">${h.allOk ? 'Alle systemen werken' : 'Aandacht nodig'} <span class="muted small">· ${fmtDateShort(h.at)}</span></div> ${row('Database', h.database)}
      ${row('E-mail ontvangen (IMAP)', h.imap)}
      ${row('E-mail versturen (SMTP)', h.smtp)}
      ${row('AI (Claude)', h.ai)}`;
  } catch (err) { el.innerHTML = `<div class="error small">${esc(err.message)}</div>`; }
}

// ---------- Facturen ----------
async function loadInvoices() {
  state._invoices = await api('/api/invoices');
  renderInvoices();
}
function renderInvoices() {
  const wrap = $('#invoiceList'); if (!wrap) return;
  const f = $('#invFilter')?.value || 'all';
  const all = state._invoices || [];
  const eur = (n) => '€ ' + Number(n || 0).toFixed(2).replace('.', ',');
  // Verlopen = verzonden factuur voorbij de ÉCHTE vervaldatum (dueAt komt van de
  // server en volgt de ingestelde betaaltermijn — niet meer een vaste 7 dagen).
  const isOverdue = (i) => (i.type !== 'offerte') && i.status === 'verzonden'
    && ((i.dueAt && new Date(i.dueAt).getTime() < Date.now())
      || (!i.dueAt && i.sentAt && (Date.now() - new Date(i.sentAt).getTime()) > 7 * 86400000));
  let items = all;
  if (f === 'factuur') items = all.filter((i) => i.type !== 'offerte');
  else if (f === 'offerte') items = all.filter((i) => i.type === 'offerte');
  else if (f === 'verlopen') items = all.filter(isOverdue);
  else if (f !== 'all') items = all.filter((i) => i.status === f);
  const open = all.filter((i) => i.type !== 'offerte' && i.status === 'verzonden').reduce((s, i) => s + (i.totalIncl || 0), 0);
  const paid = all.filter((i) => i.type !== 'offerte' && i.status === 'betaald').reduce((s, i) => s + (i.totalIncl || 0), 0);
  const overdueCount = all.filter(isOverdue).length;
  let html = `<div class="muted small" style="margin-bottom:12px">Openstaand: <strong>${eur(open)}</strong>${overdueCount ? ` · <span style="color:var(--danger);font-weight:600">${overdueCount} verlopen</span>` : ''} · Betaald: <strong>${eur(paid)}</strong> · Totaal: ${all.length}</div>
    <div id="invTodoWrap"></div>`;
  if (!items.length) html += '<div class="empty">Niets in deze weergave. Maak er één met de knoppen rechtsboven, of via de knop Factuur op een kaart.</div>';
  html += items.map((i) => {
    const quote = i.type === 'offerte';
    const overdue = isOverdue(i);
    const stLabel = overdue ? 'Nog niet betaald — VERLOPEN' : ({ concept: 'Concept', verzonden: quote ? 'Verzonden' : 'Verzonden — open', betaald: 'Betaald ✓', goedgekeurd: 'Goedgekeurd ✓', afgekeurd: 'Afgekeurd' }[i.status] || i.status);
    return `
    <div class="info-card" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <div>
        <div>${quote ? `<span class="chip" style="font-size:11px">OFFERTE</span> ` : ''}<strong>${esc(i.number)}</strong> · ${esc(i.customerName || 'klant')} <span class="muted small">${i.orderTitle ? '— ' + esc(i.orderTitle) : '(losstaand)'}</span></div>
        <div class="muted small">${esc(new Date(i.sentAt || i.createdAt).toLocaleDateString('nl-NL'))} · <span class="inv-st ${overdue ? 'verlopen' : esc(i.status)}">${esc(stLabel)}</span>${i.sentTo ? ` · naar ${esc(i.sentTo)}` : ''}${i.remindCount ? ` · ${i.remindCount}× herinnerd` : ''}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <strong style="font-size:15px">${eur(i.totalIncl)}</strong>
        <button class="btn btn-sm btn-primary inv-edit" data-id="${esc(i.id)}">Openen</button>
        <a class="btn btn-sm" target="_blank" rel="noopener" href="/api/invoices/${esc(i.id)}/pdf">PDF</a>
        <button class="btn btn-sm inv-share" data-id="${esc(i.id)}" data-label="${esc((quote ? 'Offerte' : 'Factuur') + '-' + i.number + (i.customerName ? ' ' + i.customerName : ''))}">${icon('paperclip', 13)} Deel</button>
        ${i.sentAt ? `<button class="btn btn-sm inv-resend" data-id="${esc(i.id)}" data-label="${esc((quote ? 'Offerte' : 'Factuur') + ' ' + i.number)}" data-email="${esc(i.customerEmail || i.sentTo || '')}" title="Opnieuw naar de klant mailen (bv. verkeerd adres)">${icon('mail', 13)} Opnieuw</button>` : ''}
        ${i.orderId ? `<button class="btn btn-sm inv-open" data-oid="${esc(i.orderId)}">Kaart</button>` : ''}
        ${!quote && i.sentAt && i.orderId ? `<button class="btn btn-sm inv-review" data-id="${esc(i.id)}" title="${i.reviewRequestedAt ? 'Al gevraagd op ' + esc(fmtDateShort(i.reviewRequestedAt)) : 'Vraag de klant om een Google-review'}">${icon('sparkles', 13)} Review${i.reviewRequestedAt ? ' ✓' : ''}</button>` : ''}
        ${!quote && i.status === 'verzonden' ? `<button class="btn btn-sm btn-success inv-mark" data-id="${esc(i.id)}">✓ Betaald</button>` : ''}
        ${quote && i.status === 'verzonden' ? `<button class="btn btn-sm btn-success inv-ok" data-id="${esc(i.id)}">✓ Goedgekeurd</button>` : ''}
      </div>
    </div>`;
  }).join('');
  wrap.innerHTML = html;
  $$('.inv-edit').forEach((b) => b.onclick = () => openStandaloneInvoice(b.dataset.id));
  $$('.inv-share').forEach((b) => b.onclick = (e) => shareInvoicePdf(b.dataset.id, b.dataset.label, e.currentTarget));
  $$('.inv-resend').forEach((b) => b.onclick = () => resendInvoice(b.dataset.id, b.dataset.label, b.dataset.email, () => loadInvoices()));
  $$('.inv-open').forEach((b) => b.onclick = async () => { const orders = await api('/api/orders?includeArchived=1'); state.orders = orders; openOrderModal(b.dataset.oid); });
  // Zelf een review vragen bij een verzonden factuur — het moment waarop de klus af is.
  $$('.inv-review').forEach((b) => b.onclick = async () => {
    const alGedaan = b.textContent.includes('✓');
    if (alGedaan && !confirm('Er is al een review gevraagd voor deze klus. Nog een keer sturen?')) return;
    b.disabled = true; const oud = b.innerHTML; b.textContent = 'Versturen…';
    try {
      const r = await api(`/api/invoices/${b.dataset.id}/review-request`, 'POST', { force: alGedaan });
      toast(`Review gevraagd — mail naar ${r.to}`);
      loadInvoices();
    } catch (err) { toast(err.message, true); b.disabled = false; b.innerHTML = oud; }
  });
  const quickStatus = (sel, status, msg) => $$(sel).forEach((b) => b.onclick = async () => {
    try { await api(`/api/invoices/${b.dataset.id}/status`, 'POST', { status }); toast(msg); loadInvoices(); }
    catch (err) { toast(err.message, true); }
  });
  quickStatus('.inv-mark', 'betaald', 'Betaald ✓');
  // NOG TE FACTUREREN: afgeronde kaarten zonder factuur — nooit meer omzet vergeten.
  (async () => {
    try {
      const todo = await api('/api/invoices/todo');
      const box = $('#invTodoWrap');
      if (!box || !todo.length) return;
      // INGEKLAPT tenzij je hem zelf openzet: 45 regels duwden de hele facturenlijst
      // weg. De keuze wordt onthouden per gebruiker (localStorage).
      const open = localStorage.getItem('ks_todoOpen') === '1';
      box.innerHTML = `
        <details class="info-card todo-blok" style="margin-bottom:14px;border-left:4px solid var(--warn,#f59e0b)"${open ? ' open' : ''}>
          <summary style="cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600">
            ${icon('tag', 14)} Nog te factureren <span class="chip" style="font-size:11px">${todo.length}</span>
            <span class="muted small" style="font-weight:400;margin-left:auto">klik om te openen</span>
          </summary>
          <p class="muted small" style="margin:8px 0">Afgeronde klussen waar nog géén factuur voor is gemaakt.</p>
          ${todo.slice(0, 15).map((t) => `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line-soft,#e5e7eb)">
              <span>${esc(t.title)}${t.customerName ? ` <span class="muted small">— ${esc(t.customerName)}</span>` : ''}<span class="muted small" style="display:block">afgerond ${fmtDateShort(t.completedAt)}${t.price ? ' · ' + esc(t.price) : ''}</span></span>
              <button class="btn btn-sm btn-primary todo-inv" data-cust="${esc(t.customerId)}" data-order="${esc(t.id)}">Maak factuur</button>
            </div>`).join('')}
          ${todo.length > 15 ? `<div class="muted small" style="margin-top:6px">+ nog ${todo.length - 15} oudere…</div>` : ''}
        </details>`;
      const det = $('.todo-blok', box);
      if (det) det.addEventListener('toggle', () => {
        localStorage.setItem('ks_todoOpen', det.open ? '1' : '0');
        const hint = $('summary .muted', det); if (hint) hint.textContent = det.open ? 'klik om te sluiten' : 'klik om te openen';
      });
      $$('.todo-inv', box).forEach((b) => b.onclick = async () => {
        try {
          const r = await api('/api/invoices', 'POST', { customerId: b.dataset.cust, orderId: b.dataset.order, type: 'factuur' });
          openStandaloneInvoice((r.invoice || r).id);
        } catch (err) { toast(err.message, true); }
      });
    } catch { /* blok is optioneel */ }
  })();
  quickStatus('.inv-ok', 'goedgekeurd', 'Offerte goedgekeurd ✓');
}

// ---------- Cijfers / Financiën ----------
const eurF = (n) => '€ ' + Number(n || 0).toFixed(2).replace('.', ',');
async function loadFinance() {
  if (!$('#finMonth').value) $('#finMonth').value = new Date().toISOString().slice(0, 7);
  state._finance = await api(`/api/finance?month=${$('#finMonth').value}`);
  renderFinance();
}
function renderFinance() {
  const d = state._finance; if (!d) return;
  const r = d.report;
  const maxTrend = Math.max(1, ...d.trend.map((t) => Math.max(t.income, t.expense)));
  const bar = (val, color) => `<div style="height:6px;border-radius:3px;background:${color};width:${Math.round((val / maxTrend) * 100)}%;min-width:2px"></div>`;
  const catRows = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div style="display:flex;justify-content:space-between;padding:4px 0"><span class="muted small">${esc(k)}</span><strong>${eurF(v)}</strong></div>`).join('') || '<span class="muted small">Nog niets</span>';
  $('#financePanel').innerHTML = `
    <div class="stat-grid" style="margin-bottom:16px">
      <div class="stat"><div class="num" style="color:var(--ok)">${eurF(r.income)}</div><div class="lbl">Omzet deze maand</div></div>
      <div class="stat"><div class="num" style="color:var(--danger)">${eurF(r.expense)}</div><div class="lbl">Kosten deze maand</div></div>
      <div class="stat"><div class="num" style="color:${r.profit >= 0 ? 'var(--ok)' : 'var(--danger)'}">${eurF(r.profit)}</div><div class="lbl">Winst (${r.marginPct}% marge)</div></div>
      <div class="stat"><div class="num">${r.count}</div><div class="lbl">Boekingen</div></div>
    </div>
    <div class="settings-grid" style="margin-bottom:16px">
      <div class="info-card"><h3>Omzet per categorie</h3>${catRows(r.incomeByCat)}${Object.keys(r.bySource).length ? `<hr style="border:none;border-top:1px solid var(--line-soft);margin:10px 0"><div class="muted small" style="margin-bottom:4px">Per bron:</div>${catRows(r.bySource)}` : ''}</div>
      <div class="info-card"><h3>Kosten per categorie</h3>${catRows(r.expenseByCat)}</div>
    </div>
    ${r.monteurRows.length ? `<div class="info-card" style="margin-bottom:16px"><h3>Per monteur</h3>
      <table><thead><tr><th>Monteur</th><th>Omzet</th><th>Kosten</th><th>Netto</th></tr></thead><tbody>
      ${r.monteurRows.map((m) => `<tr><td><strong>${esc(m.name)}</strong></td><td>${eurF(m.income)}</td><td>${eurF(m.expense)}</td><td><strong style="color:${m.net >= 0 ? 'var(--ok)' : 'var(--danger)'}">${eurF(m.net)}</strong></td></tr>`).join('')}
      </tbody></table></div>` : ''}
    <div class="info-card" style="margin-bottom:16px"><h3>Verloop (laatste 6 maanden)</h3>
      <div style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap">${d.trend.map((t) => `
        <div style="flex:1;min-width:90px;text-align:center">
          <div class="muted small" style="margin-bottom:4px">${eurF(t.profit)}</div>
          <div style="display:flex;flex-direction:column;gap:3px">${bar(t.income, 'var(--ok)')}${bar(t.expense, 'var(--danger)')}</div>
          <div class="muted small" style="margin-top:5px">${esc(t.month.slice(5))}/${esc(t.month.slice(2, 4))}</div>
        </div>`).join('')}</div>
      <div class="muted small" style="margin-top:8px">Groen = omzet · rood = kosten · getal = winst</div>
    </div>
    <div class="info-card"><h3>Boekingen (${r.month})</h3>
      ${r.entries.length ? `<table><thead><tr><th>Datum</th><th>Soort</th><th>Categorie</th><th>Monteur/bron</th><th>Notitie</th><th style="text-align:right">Bedrag</th><th></th></tr></thead><tbody>
      ${r.entries.map((e) => `<tr>
        <td>${esc(e.date.slice(8) + '-' + e.date.slice(5, 7))}</td>
        <td><span class="chip" style="color:${e.kind === 'income' ? 'var(--ok)' : 'var(--danger)'}">${e.kind === 'income' ? 'in' : 'uit'}</span></td>
        <td>${esc(e.category)}</td>
        <td class="muted small">${esc(e.monteurName || e.source || '')}${e.auto ? ' <span class="chip" style="font-size:10px;padding:1px 7px" title="Automatisch geboekt door het systeem (factuur/DRS-fee/vaste kosten)">automatisch</span>' : ''}</td>
        <td class="muted small">${esc((e.note || '').slice(0, 40))}</td>
        <td style="text-align:right"><strong style="color:${e.kind === 'income' ? 'var(--ok)' : 'var(--danger)'}">${e.kind === 'income' ? '+' : '−'}${eurF(e.amount).replace('€ ', '€')}</strong></td>
        <td><button class="btn btn-sm fin-del" data-id="${esc(e.id)}" title="Verwijderen">${icon('x', 12)}</button></td>
      </tr>`).join('')}
      </tbody></table>` : '<div class="empty">Nog geen boekingen deze maand. Voeg een inkomst of uitgave toe met de knoppen rechtsboven.</div>'}
    </div>`;
  $$('.fin-del').forEach((b) => b.onclick = async () => {
    if (!confirm('Deze boeking verwijderen?')) return;
    try { await api(`/api/finance/${b.dataset.id}`, 'DELETE'); loadFinance(); } catch (err) { toast(err.message, true); }
  });
}
function openFinanceEntry(kind) {
  const d = state._finance || { monteurs: [], categories: { income: [], expense: [] }, quickExpenses: [] };
  const income = kind === 'income';
  const cats = income ? d.categories.income : d.categories.expense;
  const quick = income ? [] : (d.quickExpenses || []);
  modal(`
    <h2>${icon(income ? 'tag' : 'mail', 16)} ${income ? 'Inkomst' : 'Uitgave'} toevoegen</h2>
    ${quick.length ? `<div class="muted small" style="margin-bottom:4px">Snel invoeren:</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${quick.map((q, i) => `<button type="button" class="chip fq" data-i="${i}" style="cursor:pointer">${esc(q.category)} · ${eurF(q.amount)}</button>`).join('')}</div>` : ''}
    <div class="row"> <label>Bedrag (€) <input id="fe-amount" type="number" min="0" step="0.01" placeholder="0,00"></label> <label>Datum <input id="fe-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></label> </div>
    <div class="row"> <label>Categorie <select id="fe-cat">${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label> <label>Monteur (optioneel) <select id="fe-monteur"><option value="">— geen —</option>${(d.monteurs || []).map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select></label> </div>
    ${income ? `<label>Bron <select id="fe-source"><option value="">— kies —</option><option>DRS</option><option>Schuifpui</option><option>Overig</option></select></label>` : ''}
    <label>Notitie (optioneel) <input id="fe-note" placeholder="bv. Youssef 50% van omzet week 28"></label>
    <div class="modal-actions"><span></span><div class="right"><button class="btn" id="fe-cancel">Annuleren</button><button class="btn btn-primary" id="fe-save">Boeken</button></div></div>`);
  $$('.fq').forEach((b) => b.onclick = () => { const q = quick[Number(b.dataset.i)]; if (!q) return; $('#fe-amount').value = q.amount; $('#fe-cat').value = q.category; $('#fe-note').value = q.note || ''; });
  $('#fe-cancel').onclick = closeModal;
  $('#fe-save').onclick = async () => {
    const payload = { kind, amount: Number($('#fe-amount').value), date: $('#fe-date').value, category: $('#fe-cat').value, monteurId: $('#fe-monteur').value || null, note: $('#fe-note').value };
    if (income) payload.source = $('#fe-source')?.value || '';
    if (!(payload.amount > 0)) { toast('Vul een bedrag in', true); return; }
    try {
      const r = await api('/api/finance', 'POST', payload);
      // Lijkt dit dezelfde boeking als eentje die er al staat (bv. de DRS-fee die de
      // automatische ronde al had geboekt)? Dan wél boeken, maar het wel even zeggen.
      if (r && r.duplicateWarning) toast(`Geboekt — LET OP: ${r.duplicateWarning}`, true);
      else toast(income ? 'Inkomst geboekt' : 'Uitgave geboekt');
      closeModal(); loadFinance();
    }
    catch (err) { toast(err.message, true); }
  };
}


// TERUGWERKEND boeken: alle betaalde facturen + afgeronde DRS-klussen uit het
// verleden alsnog in de cijfers zetten. Je ziet eerst wát er geboekt wordt, met
// een waarschuwing als je datzelfde bedrag die maand al handmatig hebt geboekt.
function openBackfillModal() {
  const defSince = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  modal(`
    <h2>${icon('tag', 16)} Historie alsnog boeken</h2>
    <p class="muted small">Het systeem boekt normaal alleen vanaf het moment dat automatisch boeken aanstond. Hiermee haal je het verleden alsnog op: elke <strong>betaalde factuur</strong> als omzet (excl. btw) en elke <strong>afgeronde DRS-klus</strong> als fee. Niets wordt geboekt tot jij op de knop drukt.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin:10px 0">
      <label style="margin:0">Vanaf datum <input id="bf-since" type="date" value="${esc(defSince)}"></label>
      <button class="btn" id="bf-load">Bekijken</button>
      <span class="muted small" id="bf-summary" style="margin-left:auto"></span>
    </div>
    <div id="bf-list" style="max-height:44vh;overflow-y:auto"></div>
    <div class="modal-actions"><label style="margin:0;font-weight:400"><input type="checkbox" id="bf-all" style="width:auto"> Alles selecteren</label><div class="right"><button class="btn" id="bf-cancel">Sluiten</button><button class="btn btn-primary" id="bf-book" disabled>Boek geselecteerde</button></div></div>`);
  $('#bf-cancel').onclick = closeModal;
  let items = [];
  const upd = () => {
    const sel = $$('.bf-c:checked').map((c) => items[Number(c.dataset.i)]);
    const inc = sel.filter((x) => x.kind === 'income').reduce((s, x) => s + x.amount, 0);
    const exp = sel.filter((x) => x.kind === 'expense').reduce((s, x) => s + x.amount, 0);
    $('#bf-summary').innerHTML = sel.length
      ? `${sel.length} geselecteerd · omzet <strong style="color:var(--ok)">${eurF(inc)}</strong> · kosten <strong style="color:var(--danger)">${eurF(exp)}</strong>`
      : `${items.length} gevonden`;
    $('#bf-book').disabled = !sel.length;
    $('#bf-book').textContent = sel.length ? `Boek ${sel.length} regel(s)` : 'Boek geselecteerde';
  };
  const load = async () => {
    $('#bf-list').innerHTML = '<div class="muted small">Zoeken…</div>';
    try {
      const r = await api(`/api/finance/autosync/preview?since=${encodeURIComponent($('#bf-since').value)}`);
      items = r.items || [];
      if (!items.length) { $('#bf-list').innerHTML = '<div class="empty">Niets te boeken — alles uit deze periode staat al in de cijfers.</div>'; $('#bf-summary').textContent = ''; $('#bf-book').disabled = true; return; }
      $('#bf-list').innerHTML = `
        ${r.totals.duplicates ? `<div class="sug-banner sug-warn" style="margin-bottom:8px">${icon('user', 13)} <strong>${r.totals.duplicates} regel(s) lijken al handmatig geboekt</strong> (zelfde bedrag in dezelfde maand). Die staan hieronder <strong>uitgevinkt</strong> — check ze zelf voordat je boekt.</div>` : ''}
        ${items.map((x, i) => `
        <label style="display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border:1px solid var(--line-soft,#e5e7eb);border-radius:8px;margin-bottom:5px;font-weight:400">
          <input type="checkbox" class="bf-c" data-i="${i}" style="width:auto;margin-top:3px" ${x.possibleDuplicate ? '' : 'checked'}>
          <span style="flex:1">
            <strong style="color:${x.kind === 'income' ? 'var(--ok)' : 'var(--danger)'}">${x.kind === 'income' ? '+' : '−'}${eurF(x.amount)}</strong>
            <span class="muted small">· ${esc(x.date)} · ${esc(x.category)}${x.monteurName ? ' · ' + esc(x.monteurName) : ''}</span>
            <div class="muted small">${esc((x.note || '').slice(0, 90))}</div>
            ${x.possibleDuplicate ? `<div class="small" style="color:#b45309">⚠ Mogelijk al geboekt: ${esc(x.possibleDuplicate.date)} — ${esc((x.possibleDuplicate.note || x.possibleDuplicate.category || '').slice(0, 60))}</div>` : ''}
          </span>
        </label>`).join('')}`;
      $$('.bf-c').forEach((c) => c.onchange = upd);
      upd();
    } catch (err) { $('#bf-list').innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  };
  $('#bf-load').onclick = load;
  $('#bf-all').onchange = () => { $$('.bf-c').forEach((c) => { c.checked = $('#bf-all').checked; }); upd(); };
  $('#bf-book').onclick = async () => {
    const refs = $$('.bf-c:checked').map((c) => items[Number(c.dataset.i)].sourceRef);
    if (!refs.length) return;
    if (!confirm(`${refs.length} regel(s) definitief in de cijfers boeken?`)) return;
    const btn = $('#bf-book'); btn.disabled = true; btn.textContent = 'Boeken…';
    try {
      const r = await api('/api/finance/autosync/apply', 'POST', { refs });
      toast(`Geboekt: ${r.income} omzet-regel(s), ${r.fees} fee-regel(s)`);
      closeModal(); loadFinance();
    } catch (err) { toast(err.message, true); btn.disabled = false; upd(); }
  };
  load();
}

// Omzet importeren uit monteursrapporten (WhatsApp): kies de bedragen en boek ze.
function openImportIncome() {
  const month = $('#finMonth').value || new Date().toISOString().slice(0, 7);
  api(`/api/finance/suggest-income?month=${month}`).then(({ suggestions }) => {
    modal(`
      <h2>${icon('whatsapp', 16)} Omzet uit monteursrapporten — ${esc(month)}</h2>
      <p class="muted small">Bedragen uit de monteursrapporten van deze maand. Vink aan wat je wilt boeken en kies per regel of het <strong>omzet</strong> of <strong>kosten</strong> zijn — de eerste gok komt uit het woord achter het bedrag ("pin" = omzet, "lips kosten" = kosten), maar jij beslist.</p>
      ${suggestions.length ? `<div style="max-height:340px;overflow:auto;margin:8px 0">${suggestions.map((s, i) => `
        <label style="display:flex;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:5px;font-weight:400">
          <input type="checkbox" class="imp-c" data-i="${i}" style="width:auto" checked>
          <span style="flex:1"><strong>${eurF(s.amount)}</strong> <span class="muted small">· ${esc(s.monteurName || '')} · ${esc(s.date)}</span><div class="muted small">${esc((s.context || '').slice(0, 90))}</div></span>
          <select class="imp-kind" data-i="${i}" style="width:auto;max-width:120px;font-size:13px">
            <option value="income" ${s.guess === 'income' ? 'selected' : ''}>Omzet</option>
            <option value="expense" ${s.guess === 'cost' ? 'selected' : ''}>Kosten</option>
          </select>
        </label>`).join('')}</div>
        <div style="display:flex;gap:8px;align-items:center;margin:6px 0"><label style="margin:0;font-weight:400"><input type="checkbox" id="imp-all" style="width:auto"> Alles selecteren</label></div>
        <div class="modal-actions"><span class="muted small" id="imp-count"></span><div class="right"><button class="btn" id="imp-cancel">Annuleren</button><button class="btn" id="imp-dismiss" title="Deze bedragen zijn geen omzet — niet meer voorstellen">Weiger geselecteerde</button><button class="btn btn-primary" id="imp-save">Boek geselecteerde</button></div></div>`
        : '<div class="empty" style="margin:16px 0">Geen (nieuwe) bedragen gevonden in de monteursrapporten van deze maand.</div><div class="modal-actions"><span></span><div class="right"><button class="btn" id="imp-cancel">Sluiten</button></div></div>'}`);
    const upd = () => {
      const gekozen = $$('.imp-c:checked').map((c) => ({ s: suggestions[Number(c.dataset.i)], kind: ($(`.imp-kind[data-i="${c.dataset.i}"]`) || {}).value || 'income' }));
      const omzet = gekozen.filter((x) => x.kind === 'income').reduce((t, x) => t + (x.s.amount || 0), 0);
      const kosten = gekozen.filter((x) => x.kind === 'expense').reduce((t, x) => t + (x.s.amount || 0), 0);
      const sel = gekozen;
      if ($('#imp-count')) $('#imp-count').innerHTML = sel.length
        ? `${sel.length} geselecteerd · omzet <strong>${eurF(omzet)}</strong>${kosten ? ` · kosten <strong>${eurF(kosten)}</strong>` : ''}`
        : `${suggestions.length} gevonden`;
      if ($('#imp-save')) { $('#imp-save').disabled = !sel.length; $('#imp-dismiss').disabled = !sel.length; }
    };
    $$('.imp-c').forEach((c) => c.onchange = upd);
    $$('.imp-kind').forEach((c) => c.onchange = upd);
    upd();
    if ($('#imp-all')) $('#imp-all').onchange = () => { $$('.imp-c').forEach((c) => { c.checked = $('#imp-all').checked; }); upd(); };
    $('#imp-cancel').onclick = closeModal;
    if ($('#imp-dismiss')) $('#imp-dismiss').onclick = async () => {
      const refs = $$('.imp-c:checked').map((c) => suggestions[Number(c.dataset.i)].ref);
      if (!refs.length) { toast('Vink eerst bedragen aan', true); return; }
      if (!confirm(`${refs.length} bedrag(en) weigeren? Ze worden nooit meer voorgesteld.`)) return;
      try { const r = await api('/api/finance/dismiss-income', 'POST', { refs }); toast(`${r.dismissed} bedrag(en) geweigerd`); closeModal(); }
      catch (err) { toast(err.message, true); }
    };
    if ($('#imp-save')) $('#imp-save').onclick = async () => {
      // De keuze omzet/kosten gaat MEE naar de server; die respecteert 'kind' boven de
      // automatische gok, zodat een verkeerde gok altijd te overrulen is.
      const items = $$('.imp-c:checked').map((c) => ({ ...suggestions[Number(c.dataset.i)], kind: ($(`.imp-kind[data-i="${c.dataset.i}"]`) || {}).value || 'income' }));
      if (!items.length) { toast('Vink minstens één bedrag aan', true); return; }
      const nOmzet = items.filter((x) => x.kind === 'income').length;
      const nKosten = items.length - nOmzet;
      try {
        const r = await api('/api/finance/import-income', 'POST', { items });
        const delen = [nOmzet ? `${nOmzet} omzet` : '', nKosten ? `${nKosten} kosten` : ''].filter(Boolean).join(' + ');
        toast(`${r.booked} boeking(en) toegevoegd (${delen})${r.skipped ? ` · ${r.skipped} overgeslagen (stond er al in)` : ''}`);
        closeModal(); loadFinance();
      }
      catch (err) { toast(err.message, true); }
    };
  }).catch((err) => toast(err.message, true));
}

// Vaste (terugkerende) kosten + gemiddelde kosten per klus + wekelijks CEO-rapport.
function openFinanceSettings() {
  const d = state._finance; if (!d) return;
  const s = d.settings;
  const recRow = (r) => `
    <div class="rec-row" data-id="${esc(r.id)}" style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
      <input class="rec-label" value="${esc(r.label)}" placeholder="Naam" style="flex:2">
      <input class="rec-amount" type="number" min="0" step="0.01" value="${esc(String(r.amount))}" style="width:100px" title="Bedrag">
      <select class="rec-period" style="width:110px"><option value="month" ${r.period === 'month' ? 'selected' : ''}>per maand</option><option value="week" ${r.period === 'week' ? 'selected' : ''}>per week</option></select>
      <label style="display:flex;align-items:center;gap:5px;margin:0;font-weight:400"><input type="checkbox" class="rec-active" style="width:auto" ${r.active ? 'checked' : ''}>aan</label>
      <button type="button" class="btn btn-sm rec-del">${icon('x', 12)}</button>
    </div>`;
  modal(`
    <h2>${icon('tag', 16)} Vaste kosten &amp; CEO-rapport</h2>
    <h3 style="margin:0 0 6px">Automatisch boeken</h3>
    <p class="muted small" style="margin-bottom:8px">Het systeem boekt zelf: elke <strong>betaalde factuur</strong> als omzet (excl. btw, juiste bron + monteur) en per <strong>afgeronde DRS-opdracht</strong> automatisch de vaste fee. Nooit dubbel; handmatig corrigeren blijft mogelijk.</p>
    <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="fs-autosync" style="width:auto" ${s.autoSync !== false ? 'checked' : ''}> Automatisch boeken aanzetten</label>
    <label>Fee per afgeronde DRS-opdracht (€) <input id="fs-drsfee" type="number" min="0" step="0.5" value="${esc(String(s.drsFeePerJob ?? 42.5))}" style="max-width:130px"></label>
    <hr style="border:none;border-top:1px solid var(--line-soft);margin:14px 0">
    <label>Gemiddelde kosten per schuifpui-klus (€) <input id="fs-avg" type="number" min="0" step="1" value="${esc(String(s.avgJobCost))}"><span class="muted small">Voor winstschatting en AI-context.</span></label>
    <h3 style="margin:14px 0 6px">Terugkerende kosten (worden automatisch geboekt)</h3>
    <p class="muted small" style="margin-bottom:8px">Bijvoorbeeld Google Ads €2000/maand en marketingfee DRS €65/week. Ze worden aan het begin van elke periode automatisch in de cijfers gezet.</p>
    <div id="rec-rows">${(s.recurring || []).map(recRow).join('')}</div>
    <button type="button" class="btn btn-sm" id="rec-add">+ Vaste kostenpost</button>
    <h3 style="margin:16px 0 6px">Wekelijks CEO-rapport per e-mail</h3>
    <p class="muted small" style="margin-bottom:8px">Elke maandagochtend automatisch: omzet, kosten, winst, nieuwe leads, openstaande facturen en aandachtspunten.</p>
    <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="wr-enabled" style="width:auto" ${s.weeklyReport.enabled ? 'checked' : ''}> Wekelijks rapport aanzetten</label>
    <div class="row"><label>Naar e-mailadres <input id="wr-email" value="${esc(s.weeklyReport.email)}" placeholder="jij@keyservice247.nl"></label><label>Uur (maandag) <input id="wr-hour" type="number" min="0" max="23" value="${esc(String(s.weeklyReport.hour))}" style="max-width:90px"></label></div>
    <button type="button" class="btn btn-sm" id="wr-test">Stuur nu een test-rapport</button>
    <div class="modal-actions"><span></span><div class="right"><button class="btn" id="fs-cancel">Annuleren</button><button class="btn btn-primary" id="fs-save">Opslaan</button></div></div>`);
  const bindRec = () => $$('#rec-rows .rec-del').forEach((b) => b.onclick = () => b.closest('.rec-row').remove());
  bindRec();
  $('#rec-add').onclick = () => { $('#rec-rows').insertAdjacentHTML('beforeend', recRow({ id: 'rec_' + Date.now(), label: '', amount: 0, period: 'month', active: true })); bindRec(); };
  const collect = () => ({
    autoSync: $('#fs-autosync').checked,
    drsFeePerJob: Number($('#fs-drsfee').value) || 0,
    avgJobCost: Number($('#fs-avg').value) || 0,
    recurring: $$('#rec-rows .rec-row').map((r) => ({ id: r.dataset.id, label: $('.rec-label', r).value, amount: Number($('.rec-amount', r).value) || 0, period: $('.rec-period', r).value, active: $('.rec-active', r).checked, category: $('.rec-label', r).value })).filter((r) => r.label),
    weeklyReport: { enabled: $('#wr-enabled').checked, email: $('#wr-email').value, hour: Number($('#wr-hour').value) || 8 },
  });
  $('#wr-test').onclick = async () => {
    const to = $('#wr-email').value.trim();
    if (!to) { toast('Vul eerst een e-mailadres in', true); return; }
    try { await api('/api/finance/settings', 'POST', collect()); await api('/api/finance/weekly-report/test', 'POST', { to }); toast('Test-rapport verstuurd — check je mail'); }
    catch (err) { toast(err.message, true); }
  };
  $('#fs-cancel').onclick = closeModal;
  $('#fs-save').onclick = async () => {
    try { await api('/api/finance/settings', 'POST', collect()); toast('Opgeslagen'); closeModal(); loadFinance(); }
    catch (err) { toast(err.message, true); }
  };
}


// ---------- Abonnementen & verbruik ----------
async function loadSubs() {
  const d = await api('/api/subscriptions');
  const u = d.usage;
  $('#subsPanel').innerHTML = `
    <div class="stat-grid"> <div class="stat"><div class="num">${u.calls}</div><div class="lbl">AI-aanroepen deze maand (${esc(u.month)})</div></div> <div class="stat"><div class="num">$${u.estimatedCostUsd.toFixed(2)}</div><div class="lbl">Geschatte AI-kosten (indicatie)</div></div> <div class="stat"><div class="num">${(u.inputTokens + u.outputTokens).toLocaleString('nl-NL')}</div><div class="lbl">Tokens verbruikt</div></div> </div>
    ${(u.perModel && u.perModel.length) ? `<div class="muted small" style="margin:-6px 0 8px"><strong>Per model deze maand:</strong> ${u.perModel.map((p) => `${esc(p.tier)}: ${p.calls}× · ${(p.inputTokens + p.outputTokens).toLocaleString('nl-NL')} tokens · ~$${p.estCostUsd.toFixed(2)}`).join(' &nbsp;·&nbsp; ')}</div>` : ''}
    <p class="muted small" style="margin:0 0 16px">De AI-kosten zijn een <strong>schatting</strong> van het verbruik via dit dashboard (Haiku voor sorteren per bericht, Sonnet 5 voor de statusscan/assistent). Het officiële verbruik/tegoed zie je altijd in de <strong>Claude Console</strong> → Usage.</p> <div class="card-grid"> ${d.services.map((s) => `
        <div class="info-card"> <h3>${esc(s.name)}</h3> <div class="muted small">${esc(s.what)}</div> <div style="margin:8px 0"><span class="chip">${esc(s.cost)}</span></div> <div class="small">${esc(s.note)}</div> ${s.manageUrl ? `<div style="margin-top:10px"><a class="btn btn-sm" href="${esc(s.manageUrl)}" target="_blank" rel="noopener">Beheer / verbruik </a></div>` : ''}
        </div>`).join('')}
    </div>`;
}

// ---------- Instellingen (kolommen + bronnen) ----------
function renderAnalysis(a) {
  const el = $('#analyzeResult');
  if (!el || !a || !a.text) return;
  // Simpele opmaak: kopjes vetter, regels behouden.
  const html = esc(a.text).replace(/\n/g, '<br>').replace(/(\d+\.\s[^<]+)/g, '<strong>$1</strong>');
  el.innerHTML = `<div class="analysis-box">${html}</div><div class="muted small" style="margin-top:8px">Gebaseerd op ${a.total || a.analyzed || '?'} berichten · ${fmtDateShort(a.at)}</div>`;
}

async function loadSettings() {
  const s = await api('/api/settings');
  $('#settingsPanel').innerHTML = `
    <div class="sg-nav">
      <button class="chip sg-chip on" data-g="alles">Alles</button>
      <button class="chip sg-chip" data-g="bericht">${icon('mail', 12)} Automatische berichten</button>
      <button class="chip sg-chip" data-g="facturen">${icon('tag', 12)} Facturen</button>
      <button class="chip sg-chip" data-g="werk">${icon('wrench', 12)} Werkwijze &amp; bord</button>
      <button class="chip sg-chip" data-g="koppel">${icon('calendar', 12)} Koppelingen</button>
      <button class="chip sg-chip" data-g="ai">${icon('sparkles', 12)} AI</button>
      <button class="chip sg-chip" data-g="systeem">${icon('shield', 12)} Systeem &amp; back-ups</button>
    </div>
    <div data-sg="systeem" class="info-card" style="margin-bottom:18px"> <h3>Hoe alles werkt &amp; is verbonden</h3>
      <p class="muted small">Een overzicht van alle routes waarlangs opdrachten binnenkomen en hoe ze in het dashboard belanden.</p>
      <div class="flow-box">
        <div class="flow-line"><strong>E-mail:</strong> klant / website-formulier → <code>info@keyservice247.nl</code> → (assistent stuurt door / wordt opgehaald) → <strong>IMAP</strong> leest mailbox <code>${esc(s.imapAddress || 'niet ingesteld')}</code> → AI deelt in → <strong>Inbox / AI</strong> → goedkeuren → kaart in <strong>Opdrachten</strong>.</div>
        <div class="flow-line"><strong>WhatsApp:</strong> klant/groep → wegwerp-nummer (iPhone) → <strong>bridge op VPS</strong> → dashboard → AI deelt in → Inbox. <em>Opdrachten worden alleen uit de ingestelde groep(en) gehaald (zie hieronder).</em></div>
        <div class="flow-line"><strong>Antwoorden:</strong> "Snel antwoord" op een kaart → verstuurd via SMTP vanaf <code>${esc(s.sendAddress || 'niet ingesteld')}</code> → komt in de gesprekshistorie. Mail je buiten het dashboard om? Dan wordt die uit je Verzonden-map opgehaald en alsnog bij de kaart gezet.</div>
        <div class="flow-line"><strong>Naar monteur:</strong> kaart → "Stuur naar monteur" (of automatisch) → wachtrij → bridge → WhatsApp-groep van de monteur.</div>
      </div>
      <p class="muted small" style="margin-top:10px">Verzendadres (SMTP): <strong>${esc(s.sendAddress || 'niet ingesteld in Render')}</strong> · Inkomende mailbox (IMAP): <strong>${esc(s.imapAddress || 'niet ingesteld')}</strong></p>
    </div>
    <div data-sg="systeem" class="info-card" style="margin-bottom:18px"> <h3>Back-ups &amp; veiligheid</h3>
      <p class="muted small">Alle gegevens staan op de blijvende schijf van de server en worden <strong>automatisch elke 6 uur</strong> geback-upt (laatste 60 bewaard). Maak af en toe ook een kopie op je eigen computer — dan ben je veilig, zelfs als de server uitvalt.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <a class="btn btn-primary" href="/api/backup/download">Download back-up (kopie op je pc)</a>
        <button class="btn" id="backupNow">Nu een back-up maken</button>
      </div>
      <div id="backupList" class="muted small" style="margin-top:12px">Back-ups laden…</div>
      <hr style="border:none;border-top:1px solid var(--line-soft);margin:16px 0">
      <h3 style="font-size:14px">Schijfruimte</h3>
      <div id="diskUsage" class="muted small">Laden…</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn" id="pruneBackups">Back-ups opruimen (houd de 5 nieuwste)</button>
      </div>
      <p class="muted small" style="margin-top:8px">Loopt de schijf vol? De foto-opschoning staat bij "Opslag &amp; opschonen" (Systeem-pil). Blijft het krap, vergroot dan de schijf in het <strong>Render-dashboard → jouw service → Disks</strong> (± $0,25 per GB per maand) — dat is veiliger dan agressief opruimen. Onder de 150 MB vrij krijg je automatisch een alarm.</p>
      <hr style="border:none;border-top:1px solid var(--line-soft);margin:16px 0">
      <h3 style="font-size:14px">Dagelijkse off-site back-up per e-mail</h3>
      <p class="muted small">Stuurt elke dag automatisch een volledige kopie van alle gegevens als bijlage naar je e-mail. Zo heb je altijd een verse back-up <strong>buiten</strong> de server — gratis en zonder eraan te denken.</p>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="bm-enabled" style="width:auto" ${s.backupMail?.enabled ? 'checked' : ''}> Dagelijkse back-up-mail aanzetten</label>
      <div class="row">
        <label>E-mailadres <input id="bm-email" type="email" value="${esc(s.backupMail?.email || '')}" placeholder="bv. ${esc(state.me?.email || 'jij@voorbeeld.nl')}"></label>
        <label>Tijdstip (uur) <input id="bm-hour" type="number" min="0" max="23" value="${esc(String(s.backupMail?.hour ?? 6))}" style="max-width:120px"></label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn btn-primary" id="saveBackupMail">Opslaan</button>
        <button class="btn" id="testBackupMail">Stuur nu een testmail</button>
      </div>
    </div>
    <div data-sg="koppel" class="info-card" style="margin-bottom:18px;border-left:4px solid var(--danger)"> <h3>${icon('whatsapp', 15)} WhatsApp-verzending pauzeren (noodrem)</h3>
      <p class="muted small">Is het WhatsApp-nummer (tijdelijk) geblokkeerd? Zet dit vinkje AAN: het CRM geeft de bridge dan een lege wachtrij, zodat er geen enkel bericht meer uitgaat. Berichten die klaarstonden blijven bewaard en gaan vanzelf alsnog uit zodra je de pauze weer uitzet. Ontvangen blijft gewoon werken.</p>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="wa-pause" style="width:auto" ${s.whatsappPaused ? 'checked' : ''}> Alle uitgaande WhatsApp-berichten pauzeren</label>
    </div>
    <div data-sg="koppel" class="info-card" style="margin-bottom:18px"> <h3>${icon('whatsapp', 15)} Officiële WhatsApp (Meta) voor klantberichten</h3>
      <p class="muted small">Stuurt facturen, offertes, review-verzoeken en bevestigingen naar de <strong>klant</strong> via het officiële WhatsApp Business-platform van Meta, in plaats van via het wegwerpnummer. Groepsberichten (DRS, monteurs) blijven altijd via de bridge lopen — de officiële route kan geen bestaande groepen binnen. Weigert Meta een bericht (bijvoorbeeld omdat de klant langer dan 24 uur niets stuurde), dan blijft het gewoon in de wachtrij staan en verstuurt de bridge het alsnog: er kan niets verloren gaan.</p>
      ${s.whatsappCloudReady
        ? `<label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="wa-cloud-send" style="width:auto" ${s.whatsappCloudSend ? 'checked' : ''}> Klantberichten via de officiële WhatsApp versturen</label>`
        : `<p class="muted small" style="margin:0"><strong>Nog niet ingesteld.</strong> Vul op de server eerst <code>WHATSAPP_CLOUD_TOKEN</code>, <code>WHATSAPP_PHONE_ID</code> en <code>WHATSAPP_APP_SECRET</code> in; daarna verschijnt hier de aan/uit-knop.</p>`}
    </div>
    <div data-sg="koppel" class="info-card" style="margin-bottom:18px"> <h3>${icon('whatsapp', 15)} WhatsApp-verbinding testen</h3>
      <p class="muted small">Stuur een testbericht naar een nummer en zie hieronder of de bridge het écht verstuurt. Blijft een bericht op <strong>wachtrij</strong> staan of wordt het <strong>mislukt</strong>? Dan moet de bridge op de VPS worden bijgewerkt/herstart.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <label style="margin:0;flex:1;min-width:180px">Telefoonnummer <input id="wt-phone" placeholder="bv. 0612345678"></label>
        <button class="btn btn-primary" id="wt-send" style="align-self:flex-end">Stuur testbericht</button>
        <button class="btn" id="wt-refresh" style="align-self:flex-end" title="Status verversen">${icon('refresh', 14)}</button>
      </div>
      <div id="wt-status" style="margin-top:12px"></div>
    </div>
    <div data-sg="koppel" class="info-card" style="margin-bottom:18px"> <h3>${icon('users', 15)} WhatsApp-groepen koppelen (bij WhatsApp-storing)</h3>
      <p class="muted small">WhatsApp verandert soms z'n binnenkant, waardoor de bridge de <strong>groepsnaam</strong> niet meer kan ophalen en een opdracht binnenkomt als "groep 1203…". Koppel hieronder het nummer aan de echte naam — dan herkent het CRM de opdracht-groep weer en werkt automatisch doorsturen. Zet de naam die je hier geeft ook in het opdracht-groepen-veld (bv. "Raf breda").</p>
      <div id="ga-seen" class="small" style="margin:8px 0"></div>
      <div id="ga-rows"></div>
      <button type="button" class="btn btn-sm" id="ga-add" style="margin-top:6px">+ Koppeling toevoegen</button>
      <div style="margin-top:12px"><button class="btn btn-primary" id="ga-save">Koppelingen opslaan</button></div>
    </div>
    <div data-sg="koppel" class="info-card" style="margin-bottom:18px"> <h3>${icon('bell', 15)} Meldingen op je telefoon</h3>
      <p class="muted small">Krijg een pushmelding op dit toestel zodra er een nieuwe aanvraag of een reactie van een klant binnenkomt — ook als de CRM dicht is. Zet het per toestel aan (telefoon én pc kan allebei).</p>
      <div id="pushPanel" class="muted small" style="margin-top:10px">Laden…</div>
    </div>
    <div data-sg="koppel" class="info-card admin-only" style="margin-bottom:18px"> <h3>${icon('calendar', 15)} Google Agenda — directe 2-weg koppeling</h3>
      <p class="muted small">Verbind één Google-account. Afspraken die je in het dashboard inplant, verschijnen <strong>direct</strong> in Google Agenda (en passen mee bij wijzigen/annuleren). Wijs per monteur een agenda toe bij <strong>Monteurs</strong>, dan komt elke afspraak in de agenda van de juiste monteur.</p>
      <div id="googlePanel" class="muted small" style="margin-top:10px">Status laden…</div>
    </div>
    <div data-sg="koppel" class="info-card" style="margin-bottom:18px"> <h3>Agenda via abonnementslink (alleen-lezen, alternatief)</h3>
      <p class="muted small">Liever geen koppeling? Abonneer Google Agenda op onderstaande link, dan verschijnen alle CRM-afspraken automatisch (Google ververst periodiek, dus iets vertraagd). In Google Agenda: <strong>Andere agenda's → Via URL → plak de link</strong>.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px">
        <input id="calUrl" type="text" readonly value="${esc(location.origin + '/api/calendar.ics?token=' + (s.calendarToken || ''))}" style="flex:1;min-width:220px;font-size:12px">
        <button class="btn" id="copyCalUrl">Kopieer link</button>
      </div>
      <p class="muted small" style="margin-top:8px">Houd deze link privé (geeft toegang tot je afspraken). Losse afspraak nú toevoegen kan ook met de knop <strong>"Google Agenda"</strong> op een opdracht/agenda-item.</p>
    </div>
    <div data-sg="werk" class="info-card" style="margin-bottom:18px"> <h3>WhatsApp: uit welke groep(en) opdrachten?</h3> <p class="muted small">Alleen berichten uit deze groep(en) worden opdrachten (bv. de DRS / "Raf Breda"-groep). Berichten uit andere groepen gaan naar <strong>Overige</strong> en worden nooit een kaart. Meerdere namen? Scheid met komma's. Leeg = alle groepen.</p> <input id="waOrderGroups" type="text" value="${esc(s.whatsappOrderGroups || '')}" placeholder="bv. Raf Breda, DRS"> <div style="margin-top:12px"><button class="btn btn-primary" id="saveWaGroups">Opslaan</button></div> </div>
    <div data-sg="werk" class="info-card" style="margin-bottom:18px"> <h3>E-mailfilter: bestellingen &amp; leveranciers</h3>
      <p class="muted small">Mails waarvan de <strong>afzender of het onderwerp</strong> een van deze woorden bevat (bv. orderbevestigingen, facturen van webshops, verzendberichten, no-reply-post) gaan <strong>stil naar Overige</strong> — nooit een lead, nooit een melding. Website-aanvragen worden hier nooit door tegengehouden. Eigen woorden toevoegen: één per regel of met komma's.</p>
      <textarea id="emailFilters" rows="3" placeholder="bv. bol.com, mijn leverancier bv">${esc(s.emailFilters || '')}</textarea>
      <p class="muted small" style="margin-top:6px">Standaard al actief: ${esc(s.emailFiltersDefault || '')}</p>
      <div style="margin-top:12px"><button class="btn btn-primary" id="saveEmailFilters">Filter opslaan</button></div> </div>
    <div data-sg="systeem" class="info-card" style="margin-bottom:18px"> <h3>Oude bijlages automatisch opruimen</h3>
      <p class="muted small">Foto's en bestanden van <strong>afgeronde of geannuleerde</strong> klussen worden na de ingestelde periode van de schijf verwijderd, zodat die nooit volloopt. Klantgegevens, kaarten, facturen en <strong>werkbon-handtekeningen blijven altijd bewaard</strong> — alleen de losse bestanden verdwijnen. Tip: garantie op producten is 3 jaar; kies 1095 dagen als je foto's daarvoor wilt kunnen terugkijken.</p>
      <div class="row" style="align-items:center"><label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="ac-enabled" style="width:auto" ${s.attachmentCleanup?.enabled !== false ? 'checked' : ''}>Aan</label>
      <label>Na hoeveel dagen <input id="ac-days" type="number" min="90" max="3650" value="${esc(String(s.attachmentCleanup?.days ?? 365))}" style="max-width:120px"></label></div>
      <div style="margin-top:12px"><button class="btn btn-primary" id="saveAttCleanup">Opslaan</button></div>
      <hr style="border:none;border-top:1px solid var(--line-soft);margin:16px 0">
      <h3 style="font-size:14px">Foto's &amp; video's nu opruimen</h3>
      <p class="muted small">Wil je niet wachten op de automatische opschoning? Blader hier door alle foto's/video's van al je kaarten, vink aan wat weg mag en verwijder in één keer — handig als de schijf snel vrij moet.</p>
      <button class="btn" id="openAttMgr">${icon('paperclip', 14)} Foto's &amp; video's beheren</button>
    </div>
    <div data-sg="bericht" class="info-card" style="margin-bottom:18px"> <h3>E-mail handtekening</h3>
      <p class="muted small">Elke mail vanuit het dashboard krijgt automatisch een <strong>mooie HTML-handtekening</strong> in de huisstijl: logo, naam, functie en contactgegevens met de blauwe accentbalk. De platte tekst hieronder blijft als reserve voor mail-apps zonder opmaak. Check hoe het eruitziet via de testmail-knoppen hieronder.</p>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="hs-enabled" style="width:auto" ${s.htmlSignature?.enabled !== false ? 'checked' : ''}> Mooie HTML-handtekening aanzetten</label>
      <div class="row"> <label>Naam <input id="hs-name" value="${esc(s.htmlSignature?.name || '')}"></label> <label>Functie <input id="hs-role" value="${esc(s.htmlSignature?.role || '')}" placeholder="Eigenaar | Key Service 24/7"></label> </div>
      <div class="row"> <label>Slogan <input id="hs-tagline" value="${esc(s.htmlSignature?.tagline || '')}" placeholder="Service is key"></label> <label>Tel / WhatsApp <input id="hs-phone" value="${esc(s.htmlSignature?.phone || '')}"></label> </div>
      <div class="row"> <label>E-mail <input id="hs-email" value="${esc(s.htmlSignature?.email || '')}"></label> <label>Website <input id="hs-website" value="${esc(s.htmlSignature?.website || '')}"></label> </div>
      <label style="margin-top:8px">Platte tekst-handtekening (reserve) <textarea id="emailSignature" rows="3" style="margin-top:6px">${esc(s.emailSignature || '')}</textarea></label>
      <div style="margin-top:12px"><button class="btn btn-primary" id="saveSignature">Handtekening opslaan</button></div> </div>
    <div data-sg="facturen" class="info-card" style="margin-bottom:18px"> <h3>${icon('tag', 15)} Factuurgegevens (op elke factuur-PDF)</h3>
      <p class="muted small">Deze bedrijfsgegevens komen op elke factuur die je vanuit een kaart verstuurt (knop <strong>Factuur</strong>). Het logo staat er automatisch op. Prijzen voer je <strong>excl. btw</strong> in.</p>
      <div class="row"> <label>Bedrijfsnaam <input id="is-name" value="${esc(s.invoiceSettings?.companyName || '')}"></label> <label>Telefoon <input id="is-phone" value="${esc(s.invoiceSettings?.phone || '')}"></label> </div>
      <div class="row"> <label>Adres (straat, postcode, plaats) <input id="is-address" value="${esc(s.invoiceSettings?.address || '')}"></label> <label>Website <input id="is-web" value="${esc(s.invoiceSettings?.website || '')}"></label> </div>
      <div class="row"> <label>KvK-nummer <input id="is-kvk" value="${esc(s.invoiceSettings?.kvk || '')}"></label> <label>BTW-nummer <input id="is-btwnr" value="${esc(s.invoiceSettings?.btwNr || '')}"></label> </div>
      <div class="row"> <label>IBAN <input id="is-iban" value="${esc(s.invoiceSettings?.iban || '')}" placeholder="NL00 BANK 0000 0000 00"></label> <label>BIC <input id="is-bic" value="${esc(s.invoiceSettings?.bic || '')}" placeholder="BUNQNL2A"></label> </div>
      <div class="row"> <label>E-mail op factuur <input id="is-email" value="${esc(s.invoiceSettings?.email || '')}"></label> <span></span> </div>
      <div class="row"> <label>Betaaltermijn (dagen) <input id="is-days" type="number" min="1" max="90" value="${esc(String(s.invoiceSettings?.paymentDays ?? 7))}" style="max-width:110px"></label> <label>Standaard btw-tarief <select id="is-btw"><option value="21" ${Number(s.invoiceSettings?.btwPct ?? 21) === 21 ? 'selected' : ''}>21%</option><option value="9" ${Number(s.invoiceSettings?.btwPct) === 9 ? 'selected' : ''}>9%</option><option value="0" ${Number(s.invoiceSettings?.btwPct) === 0 ? 'selected' : ''}>0%</option></select></label> </div>
      <div style="border-top:1px solid var(--line-soft,#e5e7eb);margin:12px 0 10px;padding-top:10px"><strong>Automatische betaalherinnering</strong>
        <p class="muted small" style="margin:4px 0 8px">Verzonden facturen die na de vervaldatum nog openstaan krijgen vanzelf een vriendelijke herinnering (zelfde mail als de knop, met PDF). Zet eerst alle al betaalde facturen op "Betaald" — anders krijgt een klant onterecht een herinnering.</p>
        <div class="row" style="align-items:center"><label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="is-autoremind" style="width:auto" ${s.invoiceSettings?.autoRemind ? 'checked' : ''}>Aan</label>
        <label>Dagen ná vervaldatum <input id="is-remind-after" type="number" min="1" max="60" value="${esc(String(s.invoiceSettings?.remindAfterDays ?? 3))}" style="max-width:100px"></label></div>
        <div class="row"><label>Herhaal om de (dagen) <input id="is-remind-repeat" type="number" min="2" max="60" value="${esc(String(s.invoiceSettings?.remindRepeatDays ?? 7))}" style="max-width:100px"></label>
        <label>Maximaal aantal herinneringen <input id="is-remind-max" type="number" min="1" max="5" value="${esc(String(s.invoiceSettings?.remindMax ?? 2))}" style="max-width:100px"></label></div>
      </div>
      <div style="border-top:1px solid var(--line-soft,#e5e7eb);margin:12px 0 10px;padding-top:10px"><strong>Offertes</strong>
        <label style="display:flex;align-items:center;gap:8px;flex-direction:row;margin-top:6px"><input type="checkbox" id="is-autofactuur" style="width:auto" ${s.invoiceSettings?.autoInvoiceOnAccept !== false ? 'checked' : ''}>Bij <strong>Goedgekeurd</strong> automatisch een factuur-concept klaarzetten (niet versturen)</label>
        <p class="muted small" style="margin:4px 0 8px">Zo hoef je na akkoord alleen nog de factuur te controleren en versturen — je vergeet nooit meer te factureren.</p>
        <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="is-autoquote" style="width:auto" ${s.invoiceSettings?.autoQuoteFollowup ? 'checked' : ''}>Verzonden offerte die blijft liggen automatisch opvolgen (vriendelijke mail met de offerte)</label>
        <div class="row" style="margin-top:6px"><label>Dagen na versturen <input id="is-quote-after" type="number" min="1" max="60" value="${esc(String(s.invoiceSettings?.quoteFollowupAfterDays ?? 3))}" style="max-width:100px"></label>
        <label>Max. aantal <input id="is-quote-max" type="number" min="1" max="5" value="${esc(String(s.invoiceSettings?.quoteFollowupMax ?? 2))}" style="max-width:100px"></label></div>
      </div>
      <label>Garantie-regel (dik gedrukt op de factuur) <input id="is-warranty" value="${esc(s.invoiceSettings?.warranty || '')}"></label>
      <label>Juridische tekst (kleine lettertjes onderaan) <textarea id="is-legal" rows="3">${esc(s.invoiceSettings?.legal || '')}</textarea></label>
      <label>Voettekst op de factuur <input id="is-footer" value="${esc(s.invoiceSettings?.footer || '')}"></label>
      <div style="margin-top:12px"><button class="btn btn-primary" id="saveInvoiceSettings">Factuurgegevens opslaan</button></div>
    </div>
    <div data-sg="facturen" class="info-card" style="margin-bottom:18px"> <h3>${icon('tag', 15)} Prijslijst — vaste producten &amp; werkzaamheden</h3>
      <p class="muted small">Vul hier je vaste producten en werkzaamheden in mét prijs (<strong>excl. btw</strong>). De monteur klikt ze in de factuur met één tik aan — geen getyp meer. Bijvoorbeeld: "Voorrijkosten", "Afstellen sluitingen", "ROTO sluitingsmechanisme". <strong>Deze lijst is de baas:</strong> wijzig je hier een prijs, dan gaan pakketten met exact dezelfde omschrijving automatisch mee. Facturen en offertes die al bestaan blijven staan zoals ze zijn — die werk je bij met de knop <strong>"Prijzen bijwerken"</strong> in de editor.</p>
      <div id="plRows">${(s.priceList || []).map((p) => `
        <div class="pl-row" style="display:flex;gap:6px;margin-bottom:6px;align-items:center">
          <input class="pl-desc" value="${esc(p.description)}" placeholder="Omschrijving" style="flex:3">
          <input class="pl-price" type="number" min="0" step="0.01" value="${esc(String(p.priceExcl))}" style="width:110px" title="Prijs excl. btw">
          <button type="button" class="btn btn-sm pl-del">${icon('x', 12)}</button>
        </div>`).join('')}</div>
      <button type="button" class="btn btn-sm" id="plAdd">+ Product/werkzaamheid toevoegen</button>
      <div style="margin-top:12px"><button class="btn btn-primary" id="savePriceList">Prijslijst opslaan</button></div>
    </div>
    <div data-sg="facturen" class="info-card" style="margin-bottom:18px"> <h3>${icon('tag', 15)} Pakketten — één knop, meerdere regels</h3>
      <p class="muted small">Een pakket voegt in één klik <strong>meerdere</strong> factuurregels toe, met arbeid en producten apart. Bijvoorbeeld "Hefschuifpui complete reparatie" = loopwagens + hefsluiting + arbeid, elk met eigen prijs. Handig maken kan ook rechtstreeks vanuit een factuur: vul de regels in en klik <strong>"Regels → pakket"</strong>.</p>
      <div id="bnRows">${(s.priceBundles || []).map((bn) => `
        <div class="bn-block" data-id="${esc(bn.id || '')}" style="border:1px solid var(--line-soft,#e5e7eb);border-radius:8px;padding:10px;margin-bottom:10px">
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><input class="bn-name" value="${esc(bn.name)}" placeholder="Naam van het pakket" style="flex:3;font-weight:600"><button type="button" class="btn btn-sm bn-del" title="Pakket verwijderen">${icon('trash', 12)}</button></div>
          <div class="bn-lines">${(bn.lines || []).map((l) => `
            <div class="bn-line" style="display:flex;gap:6px;margin-bottom:4px;align-items:center">
              <input class="bnl-desc" value="${esc(l.description)}" placeholder="Omschrijving" style="flex:3">
              <input class="bnl-qty" type="number" min="0" step="1" value="${esc(String(l.qty ?? 1))}" style="width:60px" title="Aantal">
              <input class="bnl-price" type="number" min="0" step="0.01" value="${esc(String(l.priceExcl ?? 0))}" style="width:96px" title="Prijs excl. btw">
              <button type="button" class="btn btn-sm bnl-del">${icon('x', 12)}</button>
            </div>`).join('')}</div>
          <button type="button" class="btn btn-sm bnl-add">+ Regel</button>
        </div>`).join('')}</div>
      <button type="button" class="btn btn-sm" id="bnAdd">+ Pakket toevoegen</button>
      <div style="margin-top:12px"><button class="btn btn-primary" id="saveBundles">Pakketten opslaan</button></div>
    </div>
    <div data-sg="bericht" class="info-card" style="margin-bottom:18px"> <h3>${icon('whatsapp', 15)} WhatsApp-melding bij nieuwe aanvragen (team)</h3>
      <p class="muted small">Krijg een WhatsApp-seintje zodra er iets nieuws in het CRM staat: een <strong>nieuwe aanvraag om te controleren</strong> of een <strong>klantreactie</strong> op een lopende kaart. Aanbevolen: maak een WhatsApp-groep (bv. "CRM meldingen") met het <strong>wegwerp-nummer</strong> en je assistente erin — dan ziet het hele team het. Max 1 melding per 2 minuten; drukte wordt gebundeld ("+N andere").</p>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="ca-enabled" style="width:auto" ${s.crmAlerts?.enabled ? 'checked' : ''}> Meldingen aanzetten</label>
      <label>WhatsApp-groep (naam, wegwerp-nummer moet lid zijn) <input id="ca-group" value="${esc(s.crmAlerts?.group || 'CRM meldingen')}" placeholder="CRM meldingen"></label>
      <label>Óf 1-op-1 naar dit nummer (laat leeg om de groep te gebruiken) <input id="ca-phone" value="${esc(s.crmAlerts?.phone || '')}" placeholder="bv. 0612345678 of +31612345678"></label>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="ca-replies" style="width:auto" ${s.crmAlerts?.notifyReplies !== false ? 'checked' : ''}> Ook melden bij klantreacties op lopende kaarten</label>
      <div style="margin-top:12px"><button class="btn btn-primary" id="saveCrmAlerts">Opslaan</button></div>
    </div>
    <div data-sg="bericht" class="info-card" style="margin-bottom:18px"> <h3>${icon('mail', 15)} Testmail — zie hoe het bij de klant binnenkomt</h3>
      <p class="muted small">Stuur een automatische mail met <strong>voorbeeldgegevens</strong> naar een eigen adres, zodat je de opmaak ziet zoals de klant 'm krijgt. Er gaat niets naar echte klanten.</p>
      <label>Stuur test naar (e-mailadres) <input id="tm-to" type="email" value="${esc(state.me?.email || '')}" placeholder="jouw@email.nl"></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn btn-sm tm-send" data-type="ontvangstbevestiging">Ontvangstbevestiging</button>
        <button class="btn btn-sm tm-send" data-type="afspraak">Afspraakbevestiging</button>
        <button class="btn btn-sm tm-send" data-type="herinnering">Herinnering</button>
        <button class="btn btn-sm tm-send" data-type="review">Review-verzoek</button>
        <button class="btn btn-sm tm-send" data-type="annulering">Annulering</button>
      </div>
    </div>
    <div data-sg="bericht" class="info-card" style="margin-bottom:18px"> <h3>Automatische ontvangstbevestiging (e-mail)</h3>
      <p class="muted small">Stuurt automatisch een mailtje naar een nieuwe klant die per e-mail een aanvraag doet — bv. met het verzoek alvast foto's en adres te sturen. Alleen bij echte aanvragen, max. 1x per klant. (Handtekening wordt eronder gezet.)</p>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="ar-enabled" style="width:auto" ${s.autoReply?.enabled ? 'checked' : ''}> Automatische ontvangstbevestiging aanzetten</label>
      <label>Onderwerp <input id="ar-subject" value="${esc(s.autoReply?.subject || '')}"></label>
      <label>Bericht <textarea id="ar-body" rows="6">${esc(s.autoReply?.body || '')}</textarea></label>
      <div style="margin-top:12px"><button class="btn btn-primary" id="saveAutoReply">Opslaan</button></div>
    </div>
    <div data-sg="bericht" class="info-card" style="margin-bottom:18px"> <h3>Automatische follow-up op offertes</h3>
      <p class="muted small">Staat een offerte langer dan het ingestelde aantal dagen open zonder reactie van de klant? Dan stuurt het systeem automatisch een vriendelijke herinnering via e-mail én WhatsApp (1x per kaart). WhatsApp-follow-up loopt via de bridge naar het klant-nummer.</p>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="fu-email" style="width:auto" ${s.followUp?.emailEnabled ? 'checked' : ''}> Follow-up via <strong>e-mail</strong> aanzetten</label>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="fu-whatsapp" style="width:auto" ${s.followUp?.whatsappEnabled ? 'checked' : ''}> Follow-up via <strong>WhatsApp</strong> aanzetten</label>
      <label>Na hoeveel dagen zonder reactie? <input id="fu-days" type="number" min="1" max="30" value="${esc(String(s.followUp?.days || 3))}" style="max-width:120px"></label>
      <label>E-mail onderwerp <input id="fu-emailSubject" value="${esc(s.followUp?.emailSubject || '')}"></label>
      <label>E-mail bericht <textarea id="fu-emailBody" rows="5">${esc(s.followUp?.emailBody || '')}</textarea></label>
      <label>WhatsApp bericht <textarea id="fu-whatsappBody" rows="3">${esc(s.followUp?.whatsappBody || '')}</textarea></label>
      <hr style="border:none;border-top:1px solid var(--line-soft);margin:16px 0">
      <h3 style="font-size:14px">Follow-up: gemaild, maar geen reactie</h3>
      <p class="muted small">Heeft een klant op onze e-mail nog niet gereageerd na X dagen? Dan stuurt het systeem automatisch een vriendelijke herinnering via e-mail (1x per kaart). Geldt niet voor offertes (die hierboven) of ingeplande afspraken.</p>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="fu-noreply" style="width:auto" ${s.followUp?.noReplyEnabled ? 'checked' : ''}> Follow-up op gemailde klanten zonder reactie aanzetten</label>
      <label>Na hoeveel dagen zonder reactie? <input id="fu-noReplyDays" type="number" min="1" max="30" value="${esc(String(s.followUp?.noReplyDays || 3))}" style="max-width:120px"></label>
      <label>E-mail onderwerp <input id="fu-noReplySubject" value="${esc(s.followUp?.noReplyEmailSubject || '')}"></label>
      <label>E-mail bericht <textarea id="fu-noReplyBody" rows="5">${esc(s.followUp?.noReplyEmailBody || '')}</textarea></label>
      <div style="margin-top:12px"><button class="btn btn-primary" id="saveFollowUp">Opslaan</button></div>
    </div>
    <div data-sg="bericht" class="info-card" style="margin-bottom:18px"> <h3>${icon('calendar', 15)} Afspraakbevestiging &amp; herinnering (automatisch)</h3>
      <p class="muted small">Plan je op een kaart een afspraak in? Dan krijgt de klant automatisch een bevestiging met datum en tijd — en optioneel een herinnering vooraf (minder no-shows). Gebruik <code>{naam}</code>, <code>{datum}</code>, <code>{tijdblok}</code> (bv. "tussen 15:00 en 18:00") en <code>{dag}</code> in de teksten; die worden automatisch ingevuld. <code>{dag}</code> wordt vanzelf "vandaag", "morgen", "overmorgen" of de dagnaam — typ dus nooit zelf "morgen" in de herinnering, want die klopt niet bij een zelfde-dag-afspraak. We werken met tijdsblokken van 3 uur. <code>{tijd}</code> mag ook — die toont nu óók het hele blok. E-mail heeft voorrang; geen e-mailadres bekend, dan WhatsApp.</p>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="ab-email" style="width:auto" ${s.appointmentMsg?.emailEnabled ? 'checked' : ''}> Bevestiging via <strong>e-mail</strong></label>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="ab-whatsapp" style="width:auto" ${s.appointmentMsg?.whatsappEnabled ? 'checked' : ''}> Bevestiging via <strong>WhatsApp</strong></label>
      <label>Lengte tijdsblok (uren) — de monteur komt binnen dit blok langs <input id="ab-block" type="number" min="1" max="8" value="${esc(String(s.appointmentMsg?.blockHours ?? 3))}" style="max-width:120px"><span class="muted small">Bij een afspraak om 15:00 en blok van 3 uur toont de klant "tussen 15:00 en 18:00". Zet je op de kaart zelf een eindtijd, dan gebruikt de bevestiging díe.</span></label>
      <label>E-mail onderwerp <input id="ab-subject" value="${esc(s.appointmentMsg?.emailSubject || '')}"></label>
      <label>E-mail bericht <textarea id="ab-body" rows="5">${esc(s.appointmentMsg?.emailBody || '')}</textarea></label>
      <label>WhatsApp bericht <textarea id="ab-wabody" rows="3">${esc(s.appointmentMsg?.whatsappBody || '')}</textarea></label>
      <hr style="border:none;border-top:1px solid var(--line-soft);margin:16px 0">
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="ab-reminder" style="width:auto" ${s.appointmentMsg?.reminderEnabled ? 'checked' : ''}> Herinnering vooraf aanzetten</label>
      <label>Hoeveel uur vóór de afspraak? <input id="ab-hours" type="number" min="1" max="72" value="${esc(String(s.appointmentMsg?.reminderHours ?? 24))}" style="max-width:120px"></label>
      <label>Herinnering (tekst) <textarea id="ab-rembody" rows="3">${esc(s.appointmentMsg?.reminderBody || '')}</textarea></label>
      <div style="margin-top:12px"><button class="btn btn-primary" id="saveApptMsg">Opslaan</button></div>
    </div>
    <div data-sg="bericht" class="info-card" style="margin-bottom:18px"> <h3>${icon('pin', 15)} "Monteur onderweg"-bericht (knop op de kaart)</h3>
      <p class="muted small">Met de knop <strong>Onderweg</strong> op een kaart krijgt de klant direct een mail én een appje dat de monteur eraan komt. Gebruik <code>{naam}</code> en <code>{monteur}</code> in de tekst.</p>
      <label>E-mail onderwerp <input id="ow-subject" value="${esc(s.onderwegMsg?.emailSubject || '')}"></label>
      <label>E-mail bericht <textarea id="ow-body" rows="5">${esc(s.onderwegMsg?.emailBody || '')}</textarea></label>
      <label>WhatsApp-bericht <textarea id="ow-wabody" rows="3">${esc(s.onderwegMsg?.whatsappBody || '')}</textarea></label>
      <div style="margin-top:12px"><button class="btn btn-primary" id="saveOnderweg">Opslaan</button></div>
    </div>
    <div data-sg="bericht" class="info-card" style="margin-bottom:18px"> <h3>⭐ Review-verzoek na afronding (automatisch)</h3>
      <p class="muted small">Zodra een opdracht op <strong>Afgerond</strong> staat, krijgt de klant na het ingestelde aantal uren automatisch een vriendelijk mailtje met jullie review-link (bv. Google). Goede reviews = meer klanten. Gebruik <code>{naam}</code> en <code>{link}</code> in de tekst.</p>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="rr-enabled" style="width:auto" ${s.reviewRequest?.enabled ? 'checked' : ''}> Review-verzoek aanzetten</label>
      <div class="row">
        <label>Review-link <input id="rr-link" value="${esc(s.reviewRequest?.link || '')}" placeholder="https://g.page/r/… (jullie Google-review-link)"></label>
        <label>Na hoeveel uur? <input id="rr-hours" type="number" min="1" max="240" value="${esc(String(s.reviewRequest?.delayHours ?? 24))}" style="max-width:120px"></label>
      </div>
      <label>Onderwerp <input id="rr-subject" value="${esc(s.reviewRequest?.subject || '')}"></label>
      <label>Bericht <textarea id="rr-body" rows="6">${esc(s.reviewRequest?.body || '')}</textarea></label>
      <div style="margin-top:12px"><button class="btn btn-primary" id="saveReview">Opslaan</button></div>
    </div>
    <div data-sg="ai" class="info-card" style="margin-bottom:18px"> <h3>Bedrijfsprofiel — wat de AI over jullie moet weten</h3> <p class="muted small">Beschrijf hoe Keyservice werkt: diensten, prijzen, aanpak, toon. De AI krijgt dit bij ELKE aanvraag en elk concept-antwoord mee, zodat het past bij jullie werkwijze.</p> <textarea id="companyProfile" rows="8" style="margin-top:6px">${esc(s.companyProfile || '')}</textarea> <div style="margin-top:12px"><button class="btn btn-primary" id="saveProfile">Bedrijfsprofiel opslaan</button></div> </div>
    <div data-sg="ai" class="info-card" style="margin-bottom:18px"> <h3>Verkeer analyseren</h3> <p class="muted small">Laat de AI het binnengekomen WhatsApp/e-mail-verkeer bestuderen: veelgevraagde diensten, terugkerende patronen en verbeterpunten. (Kost een paar cent per analyse.)</p> <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"> <label style="margin:0">Periode <select id="analyzeDays" style="margin-top:3px"><option value="7">laatste 7 dagen</option><option value="30" selected>laatste 30 dagen</option><option value="90">laatste 90 dagen</option></select></label> <button class="btn btn-primary" id="runAnalyze" style="align-self:flex-end">Analyse starten</button> </div> <div id="analyzeResult" style="margin-top:14px"></div> </div>
    <div data-sg="ai" class="info-card" style="margin-bottom:18px"> <h3>AI laten leren filteren</h3> <p class="muted small">Laat de AI uit het echte verkeer afleiden wat wél en niet een opdracht is, en voeg die filterregels toe aan het bedrijfsprofiel. Daarna filtert de inbox scherper.</p> <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"> <label style="margin:0">Periode <select id="learnDays" style="margin-top:3px"><option value="7">laatste 7 dagen</option><option value="30" selected>laatste 30 dagen</option><option value="90">laatste 90 dagen</option></select></label> <button class="btn btn-primary" id="runLearn" style="align-self:flex-end">Filterregels leren &amp; toevoegen</button> </div> <div id="learnResult" style="margin-top:14px"></div> </div>
    <div data-sg="ai" class="info-card" style="margin-bottom:18px"> <h3>${icon('sparkles', 15)} AI-ochtendbriefing</h3>
      <p class="muted small">Elke ochtend één bericht met wat er vandaag speelt: <strong>afspraken van vandaag</strong> (met tijd en of ze bevestigd zijn), alles wat <strong>om actie vraagt</strong> (onbeantwoorde klantreacties, nieuwe leads, stille offertes, verlopen facturen, stilliggende kaarten), de <strong>cijfers van deze week</strong> — afgesloten met 2-3 zinnen AI-advies waar de focus moet liggen. Via WhatsApp gaat de briefing naar dezelfde groep of het nummer van de <strong>WhatsApp-meldingen</strong> (Automatische berichten-pil); die meldingen hoeven daarvoor niet aan te staan. Kost ongeveer 1 cent per briefing.</p>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="mb-enabled" style="width:auto" ${s.morningBriefing?.enabled ? 'checked' : ''}> Ochtendbriefing aanzetten</label>
      <div class="row">
        <label>Tijdstip (uur) <input id="mb-hour" type="number" min="0" max="23" value="${esc(String(s.morningBriefing?.hour ?? 7))}" style="max-width:110px"></label>
        <label>Kanaal <select id="mb-channel">
          <option value="whatsapp" ${(s.morningBriefing?.channel || 'whatsapp') === 'whatsapp' ? 'selected' : ''}>WhatsApp</option>
          <option value="email" ${s.morningBriefing?.channel === 'email' ? 'selected' : ''}>E-mail</option>
          <option value="beide" ${s.morningBriefing?.channel === 'beide' ? 'selected' : ''}>Allebei</option>
        </select></label>
      </div>
      <div class="row">
        <label>E-mailadres (bij kanaal e-mail) <input id="mb-email" type="email" value="${esc(s.morningBriefing?.email || '')}" placeholder="leeg = adres van de back-up-mail"></label>
        <label>Toon <select id="mb-tone">
          <option value="coachend" ${(s.morningBriefing?.tone || 'coachend') === 'coachend' ? 'selected' : ''}>Coachend — met advies</option>
          <option value="zakelijk" ${s.morningBriefing?.tone === 'zakelijk' ? 'selected' : ''}>Zakelijk-kort — alleen feiten</option>
        </select></label>
      </div>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="mb-weekdays" style="width:auto" ${s.morningBriefing?.weekdaysOnly !== false ? 'checked' : ''}> Alleen werkdagen (ma t/m vr)</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn btn-primary" id="saveMorningBrief">Opslaan</button>
        <button class="btn" id="testMorningBrief">Stuur nu een test</button>
      </div>
    </div>
    <div data-sg="ai" class="info-card" style="margin-bottom:18px"> <h3>${icon('activity', 15)} Wekelijkse AI-controle — wat blijft er liggen?</h3>
      <p class="muted small">Elke <strong>maandagochtend</strong> één bericht met alles wat scheef staat of blijven liggen is: afgeronde klussen <strong>zonder factuur</strong>, afspraken die al geweest zijn maar waarvan de kaart nog open staat, <strong>vergeten inbox-leads</strong> (2+ dagen), offertes 7+ dagen stil, verlopen facturen en kaarten die 14+ dagen niet zijn aangeraakt — met kort AI-advies wat je het eerst oppakt. Gaat via hetzelfde kanaal als de ochtendbriefing (WhatsApp-meldingen en/of e-mail).</p>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="wc-enabled" style="width:auto" ${s.weeklyAiCheck?.enabled ? 'checked' : ''}> Wekelijkse controle aanzetten</label>
      <div class="row"><label>Tijdstip maandag (uur) <input id="wc-hour" type="number" min="0" max="23" value="${esc(String(s.weeklyAiCheck?.hour ?? 8))}" style="max-width:110px"></label></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn btn-primary" id="saveWeeklyCheck">Opslaan</button>
        <button class="btn" id="testWeeklyCheck">Stuur nu een test</button>
      </div>
    </div>
    <div data-sg="ai" class="info-card" style="margin-bottom:18px"> <h3>${icon('sparkles', 15)} AI-dagoverzicht (Start-pagina)</h3>
      <p class="muted small">Het blok "Jouw dag in één oogopslag" bovenaan Start scant elke dag het échte verkeer (<strong>WhatsApp tot 7 dagen</strong>, <strong>e-mail tot 14 dagen</strong> terug) plus alle kaarten, afspraken en facturen — en zet daar de belangrijkste acties, kansen en risico's uit op een rij. Wordt 1x per dag gemaakt; met de Ververs-knop op Start forceer je een nieuwe scan.</p>
      <label>AI-niveau <select id="ov-model">
        <option value="standaard" ${s.aiOverviewModel !== 'opus' ? 'selected' : ''}>Standaard (Sonnet) — ± €0,10 per scan</option>
        <option value="opus" ${s.aiOverviewModel === 'opus' ? 'selected' : ''}>Hoogste niveau (Opus) — scherper, ± €0,50 per scan</option>
      </select></label>
      <div style="margin-top:12px"><button class="btn btn-primary" id="saveOvModel">Opslaan</button></div>
    </div>
    <div data-sg="werk" class="info-card" style="margin-bottom:18px"> <h3>Opdrachten naar monteur (WhatsApp)</h3> <p class="muted small">Stuur opdrachten naar de WhatsApp-groep van een monteur. Handmatig via de knop op een kaart, of automatisch volgens onderstaande regels. Koppel eerst per monteur een WhatsApp-groep (bij Monteurs).</p>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="md-auto" style="width:auto"> Automatisch versturen aanzetten</label>
      <div class="row"> <label>Welke monteur (auto) <select id="md-monteur"></select></label> <label>Wanneer <select id="md-trigger"><option value="approved">zodra ik de opdracht goedkeur</option><option value="appointment">zodra een afspraak is ingepland</option><option value="intake">volautomatisch — meteen bij binnenkomst</option></select></label> </div>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row;margin-top:6px"><input type="checkbox" id="md-onlydrs" style="width:auto"> Alleen opdrachten uit de opdracht-groepen (hieronder ingesteld)</label>
      <div style="margin:8px 0 0;padding:10px 12px;background:var(--bg-soft, #f6f8fb);border-radius:8px">
        <label style="margin:0;font-size:13px;font-weight:600">Opdracht-groepen (WhatsApp) — worden automatisch doorgestuurd</label>
        <p class="muted small" style="margin:2px 0 6px">Alle groepen hier tellen als opdracht-groep en worden net als "Raf Breda" volautomatisch doorgestuurd naar de monteur. Meerdere? Scheid met komma's. Leeg = alle groepen.</p>
        <input id="md-ordergroups" type="text" value="${esc(s.whatsappOrderGroups || '')}" placeholder="bv. Raf Breda, opdrachten tilburg omgeving" style="width:100%">
        <div id="md-groupcheck" class="small" style="margin-top:8px"></div>
      </div>
      <p class="muted small" id="md-hint" style="margin:6px 0 0"></p>
      <label style="margin:10px 0 4px">Alleen op deze dagen versturen</label>
      <div id="md-days" style="display:flex;gap:6px;flex-wrap:wrap"></div>
      <hr style="border:none;border-top:1px solid var(--line-soft);margin:16px 0">
      <h3 style="font-size:14px">Trefwoord-routering (naar een specifieke monteur)</h3>
      <p class="muted small">Bevat de opdracht een bepaald woord (bv. <strong>schuifpui</strong>), stuur 'm dan naar een andere monteur-groep i.p.v. de standaard. Handig om bv. alle schuifpui-klussen naar Abdel te sturen. Regels gaan vóór de standaardmonteur.</p>
      <div id="md-routes"></div>
      <button class="btn btn-sm" id="md-addroute" type="button" style="margin-top:6px">+ Regel toevoegen</button>
      <hr style="border:none;border-top:1px solid var(--line-soft);margin:16px 0">
      <h3 style="font-size:14px">Automatische terugkoppeling (via controle-groep)</h3>
      <p class="muted small">Krijgt een DRS-opdracht een uitkomst (Afgerond / Geannuleerd / Afspraak / Offerte)? Dan gaat er automatisch een WhatsApp-bericht naar de groep van de gekozen monteur (bv. <strong>Abdel</strong>), die het controleert en zelf doorstuurt naar de DRS-groep. Er wordt dus <strong>nooit</strong> rechtstreeks in de DRS-groep gepost. Werkt ook bij "Alles toepassen" in de AI-statusscan en bulk-statuswijzigingen.</p>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="tk-enabled" style="width:auto" ${s.terugkoppeling?.enabled ? 'checked' : ''}> Automatische terugkoppeling aanzetten</label>
      <label>Naar de groep van <select id="tk-monteur"></select></label>
      <div style="margin-top:12px"><button class="btn btn-primary" id="md-save">Verstuur-instellingen opslaan</button></div>
    </div>
    <div data-sg="werk" class="info-card" style="margin-bottom:18px"> <h3>${icon('users', 15)} Zelfde-moment-aanvragen automatisch samenvoegen</h3>
      <p class="muted small">Vraagt dezelfde klant kort na elkaar (nogmaals) iets aan — tweede appje, foto's erbij, of via de website én DRS tegelijk — dan hangt de goedgekeurde aanvraag <strong>automatisch aan de bestaande open kaart</strong>, met een zichtbare systeemnotitie. Is de open kaart ouder dan dit venster, dan wordt het gewoon een nieuwe kaart met een samenvoeg-suggestie (jij beslist). Zet op <strong>0</strong> om alles weer handmatig te doen.</p>
      <label>Venster (uren) <input id="amw-hours" type="number" min="0" max="72" value="${esc(String(s.autoMergeWindowHours ?? 6))}" style="max-width:120px"></label>
      <div style="margin-top:12px"><button class="btn btn-primary" id="saveAutoMerge">Opslaan</button></div>
    </div>
    <div data-sg="werk" class="settings-grid"> <div class="info-card"> <h3>Kolommen (statussen)</h3> <p class="muted small">Sleep niet — gebruik de volgorde van boven naar beneden. Wijzig naam of kleur, voeg toe of verwijder.</p> <div id="statusRows"></div> <button class="btn btn-sm" id="addStatus">+ Kolom toevoegen</button> <div style="margin-top:14px"><button class="btn btn-primary" id="saveStatuses">Kolommen opslaan</button></div> </div> <div class="info-card"> <h3>Herkomst-bronnen</h3> <p class="muted small">De plekken waar opdrachten vandaan komen (bv. Keyservice e-mail, DRS WhatsApp groep).</p> <div id="sourceRows"></div> <button class="btn btn-sm" id="addSource">+ Bron toevoegen</button> <div style="margin-top:14px"><button class="btn btn-primary" id="saveSources">Bronnen opslaan</button></div> </div> </div> <div data-sg="werk" class="info-card" style="margin-top:18px"> <h3>Snelle standaardantwoorden</h3> <p class="muted small">Vaste teksten (offertes, info-verzoeken, opvolging) die je team met één klik gebruikt bij een bericht.</p> <div id="tmplRows"></div> <button class="btn btn-sm" id="addTmpl">+ Sjabloon toevoegen</button> <div style="margin-top:14px"><button class="btn btn-primary" id="saveTmpls">Sjablonen opslaan</button></div> </div>`;

  // OVERZICHT: kaarten fysiek groeperen in dezelfde volgorde als de pillen, met een
  // groepskopje erboven. Zo staat álles logisch bij elkaar — ook in het "Alles"-
  // overzicht springt de lijst niet meer heen en weer tussen onderwerpen.
  {
    const GROUP_ORDER = ['bericht', 'facturen', 'werk', 'koppel', 'ai', 'systeem'];
    const GROUP_LABELS = { bericht: 'Automatische berichten', facturen: 'Facturen', werk: 'Werkwijze & bord', koppel: 'Koppelingen', ai: 'AI', systeem: 'Systeem & back-ups' };
    const cards = $$('#settingsPanel [data-sg]');
    const parent = cards[0]?.parentElement;
    if (parent) {
      // Alleen directe kinderen sorteren (geneste kaarten in een wrapper blijven staan).
      const top = cards.filter((el) => el.parentElement === parent);
      for (const g of GROUP_ORDER) {
        const head = document.createElement('div');
        head.className = 'form-sec';
        head.dataset.sg = g;
        head.style.margin = '18px 0 10px';
        head.textContent = GROUP_LABELS[g];
        parent.appendChild(head);
        top.filter((el) => el.dataset.sg === g).forEach((el) => parent.appendChild(el));
      }
    }
  }
  // Sectie-chips werken als TABBLADEN: je ziet één onderwerp tegelijk i.p.v. de hele
  // lange lijst. "Alles" toont alles, netjes gegroepeerd met kopjes.
  const applySGroup = (g, scroll) => {
    $$('#settingsPanel [data-sg]').forEach((el) => { el.style.display = (g === 'alles' || el.dataset.sg === g) ? '' : 'none'; });
    $$('#settingsPanel .sg-chip').forEach((c) => c.classList.toggle('on', c.dataset.g === g));
    state._sgroup = g;
    if (scroll) { const p = $('#settingsPanel'); if (p) p.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  };
  $$('#settingsPanel .sg-chip').forEach((c) => c.onclick = () => applySGroup(c.dataset.g, true));
  // Standaard "Alles" (gegroepeerd mét kopjes): dan mist niemand een instelling die
  // toevallig onder een ander tabblad staat. Het laatst gekozen tabblad blijft leidend.
  applySGroup(state._sgroup || 'alles');

  $('#saveApptMsg').onclick = async () => {
    const appointmentMsg = {
      emailEnabled: $('#ab-email').checked, whatsappEnabled: $('#ab-whatsapp').checked,
      blockHours: Math.max(1, Math.min(8, Number($('#ab-block').value) || 3)),
      emailSubject: $('#ab-subject').value, emailBody: $('#ab-body').value, whatsappBody: $('#ab-wabody').value,
      reminderEnabled: $('#ab-reminder').checked, reminderHours: Number($('#ab-hours').value) || 24,
      reminderEmailSubject: 'Herinnering: uw afspraak — Keyservice', reminderBody: $('#ab-rembody').value,
    };
    try { await api('/api/settings', 'PATCH', { appointmentMsg }); toast('Afspraakberichten opgeslagen'); }
    catch (err) { toast(err.message, true); }
  };
  const wtRender = (items) => {
    const stChip = { queued: '<span class="inv-st verzonden">wachtrij</span>', sent: '<span class="inv-st betaald">verstuurd ✓</span>', failed: '<span class="inv-st verlopen">MISLUKT</span>' };
    $('#wt-status').innerHTML = items.length ? `<table><thead><tr><th>Tijd</th><th>Naar</th><th>Status</th><th>Door</th></tr></thead><tbody>${items.map((i) => `<tr><td class="muted small">${esc(fmtDate(i.createdAt))}</td><td>${esc(i.to)}</td><td>${stChip[i.status] || esc(i.status)}</td><td class="muted small">${esc(i.by)}</td></tr>`).join('')}</tbody></table>` : '<span class="muted small">Nog geen berichten in de wachtrij.</span>';
  };

  // --- Groep-koppelingen (id -> naam) ---
  const gaRow = (a = {}) => `<div class="ga-row" style="display:flex;gap:8px;margin-bottom:6px;align-items:center">
    <input class="ga-id" placeholder="groep-nummer (bv. 120363177872957422)" value="${esc(a.id || '')}" style="flex:1">
    <span class="muted">→</span>
    <input class="ga-name" placeholder="naam (bv. Raf breda)" value="${esc(a.name || '')}" style="flex:1">
    <button type="button" class="btn btn-sm ga-del" title="Weg">${icon('x', 13)}</button></div>`;
  const gaBindDel = () => $$('#ga-rows .ga-del').forEach((b) => b.onclick = () => b.closest('.ga-row').remove());
  const gaRender = (aliases) => { $('#ga-rows').innerHTML = (aliases && aliases.length ? aliases : [{}]).map(gaRow).join(''); gaBindDel(); };
  gaRender(s.groupAliases || []);
  $('#ga-add').onclick = () => { $('#ga-rows').insertAdjacentHTML('beforeend', gaRow()); gaBindDel(); };
  $('#ga-save').onclick = async () => {
    const groupAliases = $$('#ga-rows .ga-row').map((r) => ({ id: $('.ga-id', r).value.trim(), name: $('.ga-name', r).value.trim() })).filter((a) => a.id && a.name);
    try { await api('/api/settings', 'PATCH', { groupAliases }); toast('Groep-koppelingen opgeslagen'); }
    catch (err) { toast(err.message, true); }
  };
  // Toon recent geziene groepen (vooral "groep <id>" zonder naam) zodat je makkelijk kunt koppelen.
  api('/api/whatsapp/seen-groups').then((groups) => {
    const el = $('#ga-seen'); if (!el) return;
    const unnamed = (groups || []).filter((g) => g.isIdOnly && !g.aliasName);
    if (!groups || !groups.length) { el.innerHTML = '<span class="muted">Nog geen WhatsApp-groepen gezien.</span>'; return; }
    el.innerHTML = '<div class="muted" style="margin-bottom:4px">Recent geziene groepen:</div>' + groups.slice(0, 8).map((g) => {
      const digits = g.digits;
      const label = g.aliasName ? `<span style="color:var(--ok)">✓ ${esc(g.aliasName)}</span>` : (g.isIdOnly ? `<span style="color:var(--danger)">nog niet gekoppeld</span>` : '');
      return `<div style="display:flex;align-items:center;gap:8px;padding:2px 0"><code style="font-size:11px">${esc(g.group.length > 30 ? g.group.slice(0, 28) + '…' : g.group)}</code> ${label} ${g.isIdOnly && !g.aliasName ? `<button type="button" class="btn btn-sm ga-quick" data-id="${esc(digits)}">koppel</button>` : ''}</div>`;
    }).join('');
    $$('#ga-seen .ga-quick').forEach((b) => b.onclick = () => { $('#ga-rows').insertAdjacentHTML('beforeend', gaRow({ id: b.dataset.id })); gaBindDel(); const rows = $$('#ga-rows .ga-row'); rows[rows.length - 1]?.querySelector('.ga-name')?.focus(); });
  }).catch(() => {});
  const wtLoad = async () => { try { wtRender(await api('/api/whatsapp/outbox-status')); } catch { /* stil */ } };
  wtLoad();
  $('#wt-refresh').onclick = wtLoad;
  $('#wt-send').onclick = async () => {
    const phone = $('#wt-phone').value.trim();
    if (!phone) return toast('Vul eerst een telefoonnummer in', true);
    try {
      await api('/api/whatsapp/test', 'POST', { phone });
      toast('Testbericht in de wachtrij — de bridge verstuurt binnen ~10 sec');
      await wtLoad();
      setTimeout(wtLoad, 12000); // na de bridge-poll nog eens verversen
    } catch (err) { toast(err.message, true); }
  };
  $('#saveOnderweg').onclick = async () => {
    const onderwegMsg = { emailSubject: $('#ow-subject').value, emailBody: $('#ow-body').value, whatsappBody: $('#ow-wabody').value };
    try { await api('/api/settings', 'PATCH', { onderwegMsg }); toast('Onderweg-bericht opgeslagen'); }
    catch (err) { toast(err.message, true); }
  };
  $('#saveReview').onclick = async () => {
    const reviewRequest = { enabled: $('#rr-enabled').checked, link: $('#rr-link').value.trim(), delayHours: Number($('#rr-hours').value) || 24, subject: $('#rr-subject').value, body: $('#rr-body').value };
    if (reviewRequest.enabled && !reviewRequest.link) return toast('Vul eerst de review-link in', true);
    try { await api('/api/settings', 'PATCH', { reviewRequest }); toast('Review-verzoek opgeslagen'); }
    catch (err) { toast(err.message, true); }
  };
  $('#saveProfile').onclick = async () => {
    try { await api('/api/settings', 'PATCH', { companyProfile: $('#companyProfile').value }); toast('Bedrijfsprofiel opgeslagen'); }
    catch (err) { toast(err.message, true); }
  };
  $('#saveWaGroups').onclick = async () => {
    try { await api('/api/settings', 'PATCH', { whatsappOrderGroups: $('#waOrderGroups').value }); toast('WhatsApp opdracht-groepen opgeslagen'); }
    catch (err) { toast(err.message, true); }
  };
  $('#saveEmailFilters').onclick = async () => {
    try { await api('/api/settings', 'PATCH', { emailFilters: $('#emailFilters').value }); toast('E-mailfilter opgeslagen'); }
    catch (err) { toast(err.message, true); }
  };
  $('#saveAttCleanup').onclick = async () => {
    try { await api('/api/settings', 'PATCH', { attachmentCleanup: { enabled: $('#ac-enabled').checked, days: Number($('#ac-days').value) || 365 } }); toast('Bijlage-opschoning opgeslagen'); }
    catch (err) { toast(err.message, true); }
  };
  $('#openAttMgr').onclick = openAttachmentManager;
  $('#saveSignature').onclick = async () => {
    const htmlSignature = {
      enabled: $('#hs-enabled').checked,
      name: $('#hs-name').value, role: $('#hs-role').value, tagline: $('#hs-tagline').value,
      phone: $('#hs-phone').value, email: $('#hs-email').value, website: $('#hs-website').value,
    };
    try { await api('/api/settings', 'PATCH', { emailSignature: $('#emailSignature').value, htmlSignature }); await refreshMeta(); toast('Handtekening opgeslagen'); }
    catch (err) { toast(err.message, true); }
  };
  $('#saveInvoiceSettings').onclick = async () => {
    const invoiceSettings = {
      companyName: $('#is-name').value, phone: $('#is-phone').value, address: $('#is-address').value,
      website: $('#is-web').value, kvk: $('#is-kvk').value, btwNr: $('#is-btwnr').value,
      iban: $('#is-iban').value, bic: $('#is-bic').value, email: $('#is-email').value,
      paymentDays: Number($('#is-days').value) || 7, btwPct: Number($('#is-btw').value),
      warranty: $('#is-warranty').value, legal: $('#is-legal').value, footer: $('#is-footer').value,
      autoRemind: $('#is-autoremind').checked,
      remindAfterDays: Number($('#is-remind-after').value) || 3,
      remindRepeatDays: Number($('#is-remind-repeat').value) || 7,
      remindMax: Number($('#is-remind-max').value) || 2,
      autoInvoiceOnAccept: $('#is-autofactuur').checked,
      autoQuoteFollowup: $('#is-autoquote').checked,
      quoteFollowupAfterDays: Number($('#is-quote-after').value) || 3,
      quoteFollowupMax: Number($('#is-quote-max').value) || 2,
    };
    try { await api('/api/settings', 'PATCH', { invoiceSettings }); toast('Factuurgegevens opgeslagen'); }
    catch (err) { toast(err.message, true); }
  };
  // Prijslijst: rijen toevoegen/weghalen + opslaan.
  const bindPl = () => $$('#plRows .pl-del').forEach((b) => b.onclick = () => b.closest('.pl-row').remove());
  bindPl();
  $('#plAdd').onclick = () => { $('#plRows').insertAdjacentHTML('beforeend', `<div class="pl-row" style="display:flex;gap:6px;margin-bottom:6px;align-items:center"><input class="pl-desc" placeholder="Omschrijving" style="flex:3"><input class="pl-price" type="number" min="0" step="0.01" value="0" style="width:110px" title="Prijs excl. btw"><button type="button" class="btn btn-sm pl-del">${icon('x', 12)}</button></div>`); bindPl(); };
  $('#savePriceList').onclick = async () => {
    const priceList = $$('#plRows .pl-row').map((r) => ({ description: $('.pl-desc', r).value, priceExcl: Number($('.pl-price', r).value) || 0 })).filter((p) => p.description);
    try {
      const r = await api('/api/settings', 'PATCH', { priceList });
      const sy = r?.priceSync;
      toast(sy ? `Prijslijst opgeslagen — ${sy.changed} regel(s) in pakketten meegewijzigd (${sy.bundles.join(', ')})` : 'Prijslijst opgeslagen');
    }
    catch (err) { toast(err.message, true); }
  };
  // Pakketten (bundels) beheren in Instellingen.
  const bnLineRow = () => `<div class="bn-line" style="display:flex;gap:6px;margin-bottom:4px;align-items:center"><input class="bnl-desc" placeholder="Omschrijving" style="flex:3"><input class="bnl-qty" type="number" min="0" step="1" value="1" style="width:60px" title="Aantal"><input class="bnl-price" type="number" min="0" step="0.01" value="0" style="width:96px" title="Prijs excl. btw"><button type="button" class="btn btn-sm bnl-del">${icon('x', 12)}</button></div>`;
  const bindBn = () => {
    $$('#bnRows .bn-del').forEach((b) => b.onclick = () => b.closest('.bn-block').remove());
    $$('#bnRows .bnl-del').forEach((b) => b.onclick = () => b.closest('.bn-line').remove());
    $$('#bnRows .bnl-add').forEach((b) => b.onclick = () => { b.closest('.bn-block').querySelector('.bn-lines').insertAdjacentHTML('beforeend', bnLineRow()); bindBn(); });
  };
  bindBn();
  if ($('#bnAdd')) $('#bnAdd').onclick = () => { $('#bnRows').insertAdjacentHTML('beforeend', `<div class="bn-block" style="border:1px solid var(--line-soft,#e5e7eb);border-radius:8px;padding:10px;margin-bottom:10px"><div style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><input class="bn-name" placeholder="Naam van het pakket" style="flex:3;font-weight:600"><button type="button" class="btn btn-sm bn-del">${icon('trash', 12)}</button></div><div class="bn-lines">${bnLineRow()}</div><button type="button" class="btn btn-sm bnl-add">+ Regel</button></div>`); bindBn(); };
  if ($('#saveBundles')) $('#saveBundles').onclick = async () => {
    const priceBundles = $$('#bnRows .bn-block').map((blk) => ({
      id: blk.dataset.id || '',
      name: $('.bn-name', blk).value,
      lines: $$('.bn-line', blk).map((r) => ({ description: $('.bnl-desc', r).value, qty: Number($('.bnl-qty', r).value) || 1, priceExcl: Number($('.bnl-price', r).value) || 0 })).filter((l) => l.description),
    })).filter((b) => b.name && b.lines.length);
    try { await api('/api/settings', 'PATCH', { priceBundles }); toast('Pakketten opgeslagen'); }
    catch (err) { toast(err.message, true); }
  };
  $('#saveCrmAlerts').onclick = async () => {
    const crmAlerts = { enabled: $('#ca-enabled').checked, group: $('#ca-group').value, phone: $('#ca-phone').value, notifyReplies: $('#ca-replies').checked };
    try { await api('/api/settings', 'PATCH', { crmAlerts }); toast('WhatsApp-meldingen opgeslagen'); }
    catch (err) { toast(err.message, true); }
  };
  $('#saveAutoMerge').onclick = async () => {
    try { await api('/api/settings', 'PATCH', { autoMergeWindowHours: Number($('#amw-hours').value) }); toast('Samenvoeg-venster opgeslagen'); }
    catch (err) { toast(err.message, true); }
  };
  $('#saveOvModel').onclick = async () => {
    try { await api('/api/settings', 'PATCH', { aiOverviewModel: $('#ov-model').value }); toast('AI-dagoverzicht-instelling opgeslagen'); }
    catch (err) { toast(err.message, true); }
  };
  $('#saveMorningBrief').onclick = async () => {
    const morningBriefing = {
      enabled: $('#mb-enabled').checked,
      hour: Number($('#mb-hour').value),
      weekdaysOnly: $('#mb-weekdays').checked,
      channel: $('#mb-channel').value,
      email: $('#mb-email').value.trim(),
      tone: $('#mb-tone').value,
    };
    try { await api('/api/settings', 'PATCH', { morningBriefing }); toast('Ochtendbriefing opgeslagen'); }
    catch (err) { toast(err.message, true); }
  };
  $('#testMorningBrief').onclick = async () => {
    const btn = $('#testMorningBrief');
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'Versturen…';
    try {
      // Eerst opslaan wat er nu staat, zodat de test de zichtbare instellingen gebruikt.
      const morningBriefing = { enabled: $('#mb-enabled').checked, hour: Number($('#mb-hour').value), weekdaysOnly: $('#mb-weekdays').checked, channel: $('#mb-channel').value, email: $('#mb-email').value.trim(), tone: $('#mb-tone').value };
      await api('/api/settings', 'PATCH', { morningBriefing });
      const r = await api('/api/morning-briefing/test', 'POST', {});
      toast(`Test-briefing verstuurd via ${(r.via || []).map((v) => v === 'whatsapp' ? 'WhatsApp' : 'e-mail').join(' + ')}`);
    } catch (err) { toast(err.message, true); }
    finally { btn.disabled = false; btn.textContent = old; }
  };
  if ($('#wa-pause')) $('#wa-pause').onchange = async () => {
    const aan = $('#wa-pause').checked;
    try { await api('/api/settings', 'PATCH', { whatsappPaused: aan }); toast(aan ? 'WhatsApp-verzending GEPAUZEERD — er gaat niets meer uit' : 'Pauze eraf — wachtrij gaat weer lopen'); }
    catch (err) { toast(err.message, true); }
  };
  if ($('#wa-cloud-send')) $('#wa-cloud-send').onchange = async () => {
    const aan = $('#wa-cloud-send').checked;
    try { await api('/api/settings', 'PATCH', { whatsappCloudSend: aan }); toast(aan ? 'Klantberichten gaan nu via de officiële WhatsApp' : 'Klantberichten gaan weer via de bridge'); }
    catch (err) { toast(err.message, true); }
  };
  $('#saveWeeklyCheck').onclick = async () => {
    const weeklyAiCheck = { enabled: $('#wc-enabled').checked, hour: Number($('#wc-hour').value) };
    try { await api('/api/settings', 'PATCH', { weeklyAiCheck }); toast('Wekelijkse controle opgeslagen'); }
    catch (err) { toast(err.message, true); }
  };
  $('#testWeeklyCheck').onclick = async () => {
    const btn = $('#testWeeklyCheck');
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'Controleren…';
    try {
      const r = await api('/api/weekly-check/test', 'POST', {});
      toast(`Test-controle (${r.findings ?? 0} bevinding(en)) verstuurd via ${(r.via || []).map((v) => v === 'whatsapp' ? 'WhatsApp' : 'e-mail').join(' + ')}`);
    } catch (err) { toast(err.message, true); }
    finally { btn.disabled = false; btn.textContent = old; }
  };
  $$('.tm-send').forEach((btn) => btn.onclick = async () => {
    const to = ($('#tm-to')?.value || '').trim();
    if (!to) { toast('Vul eerst een e-mailadres in', true); $('#tm-to')?.focus(); return; }
    const type = btn.dataset.type;
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'Versturen…';
    try { await api('/api/test-mail', 'POST', { to, type }); toast(`Testmail (${old}) verstuurd naar ${to} — check ook je spam`); }
    catch (err) { toast(err.message, true); }
    finally { btn.disabled = false; btn.textContent = old; }
  });
  $('#saveAutoReply').onclick = async () => {
    const autoReply = { enabled: $('#ar-enabled').checked, subject: $('#ar-subject').value, body: $('#ar-body').value };
    try { await api('/api/settings', 'PATCH', { autoReply }); toast('Ontvangstbevestiging opgeslagen'); }
    catch (err) { toast(err.message, true); }
  };
  $('#saveBackupMail').onclick = async () => {
    const backupMail = { enabled: $('#bm-enabled').checked, email: $('#bm-email').value.trim(), hour: Number($('#bm-hour').value) };
    if (backupMail.enabled && !backupMail.email) return toast('Vul een e-mailadres in', true);
    try { await api('/api/settings', 'PATCH', { backupMail }); toast('Back-up-mail opgeslagen'); }
    catch (err) { toast(err.message, true); }
  };
  $('#testBackupMail').onclick = async () => {
    const email = $('#bm-email').value.trim();
    if (!email) return toast('Vul eerst een e-mailadres in', true);
    const btn = $('#testBackupMail'); btn.disabled = true; btn.textContent = 'Versturen…';
    try { const r = await api('/api/backup/mail', 'POST', { email }); toast(`Back-up verstuurd naar ${r.to}`); }
    catch (err) { toast(err.message, true); }
    btn.disabled = false; btn.textContent = 'Stuur nu een testmail';
  };
  $('#saveFollowUp').onclick = async () => {
    const followUp = { emailEnabled: $('#fu-email').checked, whatsappEnabled: $('#fu-whatsapp').checked, days: Number($('#fu-days').value) || 3, emailSubject: $('#fu-emailSubject').value, emailBody: $('#fu-emailBody').value, whatsappBody: $('#fu-whatsappBody').value, noReplyEnabled: $('#fu-noreply').checked, noReplyDays: Number($('#fu-noReplyDays').value) || 3, noReplyEmailSubject: $('#fu-noReplySubject').value, noReplyEmailBody: $('#fu-noReplyBody').value };
    try { await api('/api/settings', 'PATCH', { followUp }); toast('Follow-up opgeslagen'); }
    catch (err) { toast(err.message, true); }
  };
  $('#copyCalUrl')?.addEventListener('click', async () => {
    const v = $('#calUrl').value;
    try { await navigator.clipboard.writeText(v); toast('Agenda-link gekopieerd'); }
    catch { $('#calUrl').select(); document.execCommand('copy'); toast('Agenda-link gekopieerd'); }
  });

  // Google Agenda 2-weg: status, verbinden, standaardagenda, loskoppelen.
  const loadGoogle = async () => {
    const box = $('#googlePanel'); if (!box) return;
    let g; try { g = await api('/api/google/status'); } catch { box.innerHTML = '<span class="error">Status ophalen mislukt.</span>'; return; }
    if (!g.configured) {
      box.innerHTML = `<div class="error">Nog niet ingesteld op de server. Voeg <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> en <code>APP_URL</code> toe op Render. Vraag het stappenplan op.</div>`;
      return;
    }
    if (!g.connected) {
      box.innerHTML = `<div style="margin-bottom:10px">Status: <strong>niet verbonden</strong></div><a class="btn btn-primary" href="/api/google/auth">${icon('calendar', 14)} Verbind Google Agenda</a>`;
      return;
    }
    const opts = (g.calendars || []).map((c) => `<option value="${esc(c.id)}" ${c.id === g.defaultCalendarId ? 'selected' : ''}>${esc(c.name)}${c.primary ? ' (hoofd)' : ''}</option>`).join('');
    box.innerHTML = `
      <div style="margin-bottom:8px">Status: <strong style="color:var(--ok,#10b981)">verbonden</strong>${g.email ? ` — ${esc(g.email)}` : ''}</div>
      ${g.error ? `<div class="error small">Let op: ${esc(g.error)}</div>` : ''}
      <label style="display:block;margin:8px 0">Standaardagenda (voor opdrachten zonder gekoppelde monteur)
        <select id="g-defcal" style="margin-top:4px">${opts || '<option value="primary">primary</option>'}</select></label>
      <label style="display:block;margin:12px 0 0">Welke afspraken gaan naar Google Agenda?
        <select id="g-mode" style="margin-top:4px">
          <option value="alles">Alle afspraken</option>
          <option value="monteurs">Alleen van gekozen monteurs</option>
          <option value="schuifpui">Alleen schuifpui-klussen</option>
          <option value="monteurs+schuifpui">Gekozen monteurs én schuifpui-klussen</option>
        </select></label>
      <div id="g-mont-wrap" hidden style="margin-top:8px">
        <div class="muted small" style="margin-bottom:4px">Van welke monteurs?</div>
        <div id="g-monteurs" style="display:flex;flex-wrap:wrap;gap:10px"></div>
      </div>
      <p class="muted small" style="margin:6px 0 0">Stond eerder vast op "alleen Abdel of schuifpui" — daardoor kwam de ene afspraak er wel in en de andere niet.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn btn-sm btn-primary" id="g-savemode">Keuze opslaan</button>
        <button class="btn btn-sm" id="g-savecal">Standaardagenda opslaan</button>
        <a class="btn btn-sm" href="/api/google/auth">Opnieuw verbinden</a>
        <button class="btn btn-sm btn-danger" id="g-disconnect">Loskoppelen</button>
      </div>
      <p class="muted small" style="margin-top:8px">Tip: maak in Google Agenda per monteur een aparte agenda (of deel hun agenda met dit account) en koppel die bij <strong>Monteurs → monteur bewerken</strong>.</p>`;
    // Sync-regel invullen en opslaan.
    const gs = (await api('/api/settings').catch(() => ({}))).googleSync || { mode: 'alles', monteurIds: [] };
    $('#g-mode').value = gs.mode || 'alles';
    const monteurs = state.monteurs || [];
    $('#g-monteurs').innerHTML = monteurs.map((m) => `<label style="display:flex;align-items:center;gap:6px;font-size:14px"><input type="checkbox" class="g-mont" value="${esc(m.id)}" style="width:auto"${(gs.monteurIds || []).includes(m.id) ? ' checked' : ''}> ${esc(m.name)}</label>`).join('') || '<span class="muted small">Nog geen monteurs</span>';
    const toonMont = () => { $('#g-mont-wrap').hidden = !String($('#g-mode').value).includes('monteurs'); };
    toonMont();
    $('#g-mode').onchange = toonMont;
    $('#g-savemode').onclick = async () => {
      const googleSync = { mode: $('#g-mode').value, monteurIds: $$('.g-mont:checked').map((c) => c.value), keywords: gs.keywords || 'schuifpui, schuifdeur, schuifwand, schuifsysteem' };
      try { await api('/api/settings', 'PATCH', { googleSync }); toast('Opgeslagen — nieuwe en gewijzigde afspraken volgen deze keuze'); }
      catch (err) { toast(err.message, true); }
    };
    $('#g-savecal').onclick = async () => {
      try { await api('/api/google/default-calendar', 'POST', { calendarId: $('#g-defcal').value }); toast('Standaardagenda opgeslagen'); }
      catch (err) { toast(err.message, true); }
    };
    $('#g-disconnect').onclick = async () => {
      if (!confirm('Google Agenda loskoppelen? Bestaande events blijven in Google staan, maar worden niet meer bijgewerkt.')) return;
      try { await api('/api/google/disconnect', 'POST'); toast('Losgekoppeld'); loadGoogle(); }
      catch (err) { toast(err.message, true); }
    };
  };
  loadGoogle();
  loadPush();
  const loadBackups = async () => {
    try {
      const r = await api('/api/backups');
      const list = r.backups || [];
      $('#backupList').innerHTML = list.length
        ? `<div style="margin-bottom:6px">Laatste back-ups (${list.length}) — je kunt er eentje terugzetten:</div>` + list.slice(0, 8).map((b) => `<div style="display:flex;align-items:center;gap:8px;padding:4px 0"><span style="flex:1">${esc(fmtDate(b.at))} — ${(b.size / 1024).toFixed(0)} kB</span><button class="btn btn-sm bk-restore" data-name="${esc(b.name)}">Terugzetten</button></div>`).join('')
        : 'Nog geen back-ups (de eerste wordt automatisch gemaakt).';
      $$('#backupList .bk-restore').forEach((btn) => btn.onclick = async () => {
        if (!confirm('LET OP: dit vervangt ALLE huidige gegevens door deze back-up.\n\nDe huidige stand wordt eerst automatisch veilig weggezet, maar wijzigingen ná deze back-up gaan verloren.\n\nDoorgaan?')) return;
        try {
          const res = await api('/api/backup/restore', 'POST', { name: btn.dataset.name });
          toast(`Teruggezet: ${res.customers} klanten, ${res.orders} opdrachten`);
          setTimeout(() => location.reload(), 1200);
        } catch (err) { toast(err.message, true); }
      });
    } catch { $('#backupList').textContent = ''; }
  };
  loadBackups();
  $('#backupNow').onclick = async () => {
    try { await api('/api/backups/now', 'POST'); toast('Back-up gemaakt'); loadBackups(); }
    catch (err) { toast(err.message, true); }
  };
  // Schijfruimte-overzicht: wat neemt hoeveel in + hoeveel is vrij.
  const loadDisk = async () => {
    try {
      const du = await api('/api/disk-usage');
      const row = (label, val) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:2px 0"><span>${label}</span><strong>${val}</strong></div>`;
      $('#diskUsage').innerHTML =
        row(`Foto's & bestanden (${du.uploads.count})`, `${du.uploads.mb} MB`) +
        row(`Back-ups (${du.backups.count})`, `${du.backups.mb} MB`) +
        (du.storage === 'sqlite'
          ? row('Database (SQLite — snel, per record)', `${du.sqliteMb} MB`) + row('Terugvalkopie (db.json)', `${du.dbMb} MB`)
          : row('Database (db.json)', `${du.dbMb} MB`)) +
        (du.freeMb != null ? row('Vrije ruimte op de schijf', `${du.freeMb >= 1024 ? (du.freeMb / 1024).toFixed(1) + ' GB' : du.freeMb + ' MB'}${du.freeMb < 300 ? ' ⚠' : ''}`) : '');
    } catch { $('#diskUsage').textContent = 'Kon schijfruimte niet uitlezen.'; }
  };
  loadDisk();
  $('#pruneBackups').onclick = async () => {
    if (!confirm('Oude back-ups verwijderen en alleen de 5 nieuwste bewaren?')) return;
    try { const r = await api('/api/backups/prune', 'POST', { keep: 5 }); toast(`${r.removed} back-up(s) opgeruimd`); loadBackups(); loadDisk(); }
    catch (err) { toast(err.message, true); }
  };

  // Monteur-verstuurinstellingen
  const md = s.monteurDispatch || { autoEnabled: false, days: [], autoMonteurId: '', trigger: 'approved', onlyDrs: true };
  $('#md-auto').checked = !!md.autoEnabled;
  $('#md-trigger').value = md.trigger || 'approved';
  $('#md-onlydrs').checked = md.onlyDrs !== false;
  // Korte uitleg bij de gekozen stand.
  const hints = {
    approved: 'Half-automatisch: je controleert de opdracht en zodra jij goedkeurt gaat hij naar de monteur.',
    appointment: 'De opdracht gaat naar de monteur zodra er een afspraakdatum is ingepland.',
    intake: 'Volautomatisch: zodra een opdracht binnenkomt wordt hij meteen aangemaakt én naar de monteur gestuurd (geen handmatige stap).',
  };
  const setHint = () => { $('#md-hint').textContent = hints[$('#md-trigger').value] || ''; };
  setHint();
  $('#md-trigger').addEventListener('change', setHint);
  // monteurs vullen
  const mons = await api('/api/monteurs').catch(() => []);
  // Live groep-controle: laat per BEKENDE WhatsApp-groep zien of hij met de huidige
  // veldinhoud wordt herkend als opdracht-groep. Eén typefout (bv. "30km" i.p.v.
  // "30 KM") betekent anders dat opdrachten stilletjes in Overige belanden — dat
  // maakt dit blokje direct zichtbaar, al tijdens het typen.
  const normG = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const gcMatches = (conf, name) => {
    const allow = String(conf || '').split(',').map(normG).filter(Boolean);
    if (!allow.length) return true; // leeg veld = alle groepen
    return allow.some((a) => normG(name).includes(a));
  };
  const monteurGroups = new Set(mons.map((m) => normG(m.waGroup)).filter(Boolean));
  let _knownGroups = [];
  const renderGroupCheck = () => {
    const el = $('#md-groupcheck'); if (!el) return;
    if (!_knownGroups.length) { el.innerHTML = ''; return; }
    const conf = $('#md-ordergroups') ? $('#md-ordergroups').value : '';
    el.innerHTML = '<div class="muted" style="margin-bottom:4px">Controle — zo herkent het systeem je groepen op dit moment:</div>' + _knownGroups.map((g) => {
      if (monteurGroups.has(normG(g))) return `<div style="padding:2px 0"><span class="muted">•</span> ${esc(g)} <span class="muted">— monteursgroep (hoort geen vinkje te hebben)</span></div>`;
      const ok = gcMatches(conf, g);
      return `<div style="padding:2px 0">${ok ? '<span style="color:var(--ok);font-weight:700">✓</span>' : '<span style="color:var(--danger);font-weight:700">✗</span>'} ${esc(g)} <span class="muted">${ok ? '— wordt opdracht + doorgestuurd' : '— wordt NIET herkend: gaat naar Overige (geen kaart, geen monteur!)'}</span></div>`;
    }).join('');
  };
  api('/api/assistant/groups').then((g) => { _knownGroups = g || []; renderGroupCheck(); }).catch(() => {});
  if ($('#md-ordergroups')) $('#md-ordergroups').addEventListener('input', renderGroupCheck);
  $('#md-monteur').innerHTML = '<option value="">— kies monteur —</option>' + mons.map((m) => `<option value="${m.id}" ${md.autoMonteurId === m.id ? 'selected' : ''}>${esc(m.name)}${m.waGroup ? '' : ' (geen groep!)'}</option>`).join('');
  // Terugkoppeling: controle-monteur (bv. Abdel) wiens groep de terugkoppeling ontvangt.
  $('#tk-monteur').innerHTML = '<option value="">— kies monteur —</option>' + mons.map((m) => `<option value="${m.id}" ${s.terugkoppeling?.monteurId === m.id ? 'selected' : ''}>${esc(m.name)}${m.waGroup ? '' : ' (geen groep!)'}</option>`).join('');
  // dagen als knopjes
  const dayNames = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
  $('#md-days').innerHTML = dayNames.map((d, i) => `<button type="button" class="day-toggle ${(md.days || []).includes(i) ? 'on' : ''}" data-day="${i}">${d}</button>`).join('');
  $$('#md-days .day-toggle').forEach((b) => b.onclick = () => b.classList.toggle('on'));
  // Trefwoord-routering: rijen met trefwoord -> monteur.
  const monteurOptsFor = (sel) => '<option value="">— kies monteur —</option>' + mons.map((m) => `<option value="${m.id}" ${sel === m.id ? 'selected' : ''}>${esc(m.name)}${m.waGroup ? '' : ' (geen groep!)'}</option>`).join('');
  const routeRow = (r = {}) => `<div class="md-route" style="display:flex;gap:8px;margin-bottom:6px;align-items:center">
    <input class="md-route-kw" placeholder="trefwoord, bv. schuifpui" value="${esc(r.keyword || '')}" style="flex:1">
    <span class="muted small">→</span>
    <select class="md-route-mon" style="flex:1">${monteurOptsFor(r.monteurId)}</select>
    <button type="button" class="btn btn-sm md-route-del" title="Verwijder">${icon('x', 13)}</button></div>`;
  const renderRoutes = (routes) => { $('#md-routes').innerHTML = (routes || []).map(routeRow).join(''); bindRouteDel(); };
  const bindRouteDel = () => $$('#md-routes .md-route-del').forEach((b) => b.onclick = () => b.closest('.md-route').remove());
  renderRoutes(md.keywordRoutes || []);
  $('#md-addroute').onclick = () => { $('#md-routes').insertAdjacentHTML('beforeend', routeRow()); bindRouteDel(); };
  $('#md-save').onclick = async () => {
    const days = $$('#md-days .day-toggle.on').map((b) => Number(b.dataset.day));
    const keywordRoutes = $$('#md-routes .md-route').map((row) => ({
      keyword: $('.md-route-kw', row).value.trim(),
      monteurId: $('.md-route-mon', row).value,
    })).filter((r) => r.keyword && r.monteurId);
    const cfg = { autoEnabled: $('#md-auto').checked, days, autoMonteurId: $('#md-monteur').value, trigger: $('#md-trigger').value, onlyDrs: $('#md-onlydrs').checked, keywordRoutes };
    if (cfg.autoEnabled && !cfg.autoMonteurId) return toast('Kies eerst een monteur', true);
    if (cfg.autoEnabled && !days.length) return toast('Kies minstens één dag (anders wordt er nooit verstuurd)', true);
    const terugkoppeling = { enabled: $('#tk-enabled').checked, monteurId: $('#tk-monteur').value };
    if (terugkoppeling.enabled && !terugkoppeling.monteurId) return toast('Kies de monteur voor de terugkoppeling', true);
    const whatsappOrderGroups = $('#md-ordergroups') ? $('#md-ordergroups').value : undefined;
    const payload = { monteurDispatch: cfg, terugkoppeling };
    if (whatsappOrderGroups !== undefined) payload.whatsappOrderGroups = whatsappOrderGroups;
    try {
      await api('/api/settings', 'PATCH', payload);
      // Houd het losse veld hierboven in sync als het zichtbaar is.
      if (whatsappOrderGroups !== undefined && $('#waOrderGroups')) $('#waOrderGroups').value = whatsappOrderGroups;
      toast('Verstuur-instellingen opgeslagen');
    }
    catch (err) { toast(err.message, true); }
  };
  // Laatste analyse tonen indien aanwezig.
  (async () => {
    try { const last = await api('/api/analyze/last'); if (last && last.text) renderAnalysis(last); } catch {}
  })();
  $('#runAnalyze').onclick = async () => {
    const btn = $('#runAnalyze'); btn.disabled = true; btn.textContent = 'Bezig met analyseren…';
    $('#analyzeResult').innerHTML = '<div class="muted small">De AI bestudeert de berichten… dit kan ~10-30 sec duren.</div>';
    try {
      const out = await api('/api/analyze', 'POST', { days: Number($('#analyzeDays').value) });
      renderAnalysis(out);
    } catch (err) { $('#analyzeResult').innerHTML = `<div class="error small">${esc(err.message)}</div>`; }
    btn.disabled = false; btn.textContent = 'Analyse starten';
  };
  $('#runLearn').onclick = async () => {
    const btn = $('#runLearn'); btn.disabled = true; btn.textContent = 'Bezig met leren…';
    $('#learnResult').innerHTML = '<div class="muted small">De AI bestudeert het verkeer en stelt filterregels op… ~10-30 sec.</div>';
    try {
      const out = await api('/api/learn-filter', 'POST', { days: Number($('#learnDays').value) });
      $('#learnResult').innerHTML = `<div class="analysis-box">${esc(out.rules).replace(/\n/g, '<br>')}</div><div class="muted small" style="margin-top:8px">Toegevoegd aan het bedrijfsprofiel. De AI gebruikt dit nu bij het filteren.</div>`;
      // Profielveld bijwerken zodat je de toevoeging direct ziet.
      if ($('#companyProfile')) $('#companyProfile').value = out.companyProfile;
      toast('Filterregels toegevoegd aan bedrijfsprofiel');
    } catch (err) { $('#learnResult').innerHTML = `<div class="error small">${esc(err.message)}</div>`; }
    btn.disabled = false; btn.textContent = 'Filterregels leren & toevoegen';
  };

  const statusRows = $('#statusRows');
  const renderStatusRow = (st = { key: '', label: '', color: '#64748b' }) => {
    const row = document.createElement('div');
    row.className = 'editor-row';
    row.dataset.key = st.key || '';
    row.innerHTML = `<input type="color" value="${esc(st.color || '#64748b')}"><input type="text" value="${esc(st.label || '')}" placeholder="Kolomnaam"><button class="btn btn-sm btn-danger" title="Verwijderen"></button>`;
    row.querySelector('button').onclick = () => row.remove();
    statusRows.appendChild(row);
  };
  (s.statuses || []).forEach(renderStatusRow);
  $('#addStatus').onclick = () => renderStatusRow();
  $('#saveStatuses').onclick = async () => {
    const statuses = $$('#statusRows .editor-row').map((row) => ({
      key: row.dataset.key || undefined,
      label: row.querySelector('input[type=text]').value,
      color: row.querySelector('input[type=color]').value,
    })).filter((x) => x.label.trim());
    if (!statuses.length) return toast('Minimaal één kolom nodig', true);
    try { await api('/api/settings', 'PATCH', { statuses }); await refreshMeta(); toast('Kolommen opgeslagen'); loadSettings(); }
    catch (err) { toast(err.message, true); }
  };

  const sourceRows = $('#sourceRows');
  const renderSourceRow = (val = '') => {
    const row = document.createElement('div');
    row.className = 'editor-row';
    row.innerHTML = `<input type="text" value="${esc(val)}" placeholder="Bijv. DRS WhatsApp groep"><button class="btn btn-sm btn-danger"></button>`;
    row.querySelector('button').onclick = () => row.remove();
    sourceRows.appendChild(row);
  };
  (s.sources || []).forEach(renderSourceRow);
  $('#addSource').onclick = () => renderSourceRow();
  $('#saveSources').onclick = async () => {
    const sources = $$('#sourceRows .editor-row input').map((i) => i.value).filter((v) => v.trim());
    if (!sources.length) return toast('Minimaal één bron nodig', true);
    try { await api('/api/settings', 'PATCH', { sources }); await refreshMeta(); toast('Bronnen opgeslagen'); loadSettings(); }
    catch (err) { toast(err.message, true); }
  };

  // Sjablonen (standaardantwoorden)
  const tmplRows = $('#tmplRows');
  const renderTmpl = (t = { id: '', title: '', body: '' }) => {
    const row = document.createElement('div');
    row.className = 'tmpl-row';
    row.dataset.id = t.id || '';
    row.innerHTML = `
      <div class="editor-row"><input type="text" class="t-title" value="${esc(t.title || '')}" placeholder="Titel van het antwoord"><button class="btn btn-sm btn-danger"></button></div> <textarea class="t-body" rows="4" placeholder="De standaardtekst…">${esc(t.body || '')}</textarea>`;
    row.querySelector('button').onclick = () => row.remove();
    tmplRows.appendChild(row);
  };
  (s.templates || []).forEach(renderTmpl);
  $('#addTmpl').onclick = () => renderTmpl();
  $('#saveTmpls').onclick = async () => {
    const templates = $$('#tmplRows .tmpl-row').map((row) => ({
      id: row.dataset.id || undefined,
      title: row.querySelector('.t-title').value,
      body: row.querySelector('.t-body').value,
    })).filter((t) => t.title.trim() || t.body.trim());
    try { await api('/api/settings', 'PATCH', { templates }); await refreshMeta(); toast('Sjablonen opgeslagen'); loadSettings(); }
    catch (err) { toast(err.message, true); }
  };
}

// ---------- Push-meldingen ----------
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function loadPush() {
  const box = $('#pushPanel'); if (!box) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    box.innerHTML = '<span class="muted">Dit toestel/browser ondersteunt geen pushmeldingen. Op iPhone: voeg de CRM eerst toe aan je beginscherm (deel-knop → "Zet op beginscherm") en open hem vandaaruit.</span>';
    return;
  }
  let active = false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    active = !!sub;
  } catch { /* negeren */ }
  const denied = Notification.permission === 'denied';
  box.innerHTML = `
    <div style="margin-bottom:8px">Status op dit toestel: <strong>${active ? 'aan' : 'uit'}</strong>${denied ? ' — <span class="error">meldingen geblokkeerd in je browserinstellingen</span>' : ''}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${active
        ? '<button class="btn" id="push-off">Meldingen uitzetten</button><button class="btn btn-sm" id="push-test">Stuur testmelding</button>'
        : `<button class="btn btn-primary" id="push-on" ${denied ? 'disabled' : ''}>${icon('bell', 14)} Meldingen aanzetten</button>`}
    </div>`;
  if ($('#push-on')) $('#push-on').onclick = enablePush;
  if ($('#push-off')) $('#push-off').onclick = disablePush;
  if ($('#push-test')) $('#push-test').onclick = async () => {
    try { const r = await api('/api/push/test', 'POST'); toast(r.sent ? 'Testmelding verstuurd' : 'Geen toestellen aangemeld'); }
    catch (err) { toast(err.message, true); }
  };
}

async function enablePush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Meldingen niet toegestaan', true); return; }
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api('/api/push/key');
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
    await api('/api/push/subscribe', 'POST', sub.toJSON());
    toast('Meldingen aan op dit toestel');
    loadPush();
  } catch (err) { toast('Aanzetten mislukt: ' + err.message, true); }
}

async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await api('/api/push/unsubscribe', 'POST', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
    toast('Meldingen uit op dit toestel');
    loadPush();
  } catch (err) { toast(err.message, true); }
}

// ---------- Users (admin) ----------
// Labels + uitleg van alle instelbare rechten (volgorde = weergavevolgorde).
const PERM_LABELS = [
  ['inbox', 'Inbox / AI-wachtrij behandelen', 'Aanvragen goedkeuren en afwijzen'],
  ['orders', 'Opdrachten aanmaken & bewerken', 'Ook samenvoegen en bijlagen beheren'],
  ['deleteOrders', 'Naar prullenbak + terughalen', 'Opdrachten verwijderen (niet definitief)'],
  ['customers', 'Klanten & monteurs beheren', 'Gegevens bewerken, samenvoegen, toevoegen'],
  ['invoicesAll', 'Alle facturen & offertes zien', 'Uit = alleen eigen facturen (monteur-stand)'],
  ['finance', 'Cijfers bekijken & boeken', 'Omzet, kosten en winst — gevoelige informatie'],
  ['system', 'AI-controle & Abonnementen', 'Systeembewaking en kosten-overzicht'],
  ['settings', 'Instellingen wijzigen', 'Automatische berichten, factuurgegevens, AI, enz.'],
  ['hardDelete', 'Definitief verwijderen', 'Prullenbak legen — onomkeerbaar'],
];
async function loadUsers() {
  const users = await api('/api/users');
  state._users = users;
  const roleName = { admin: 'Beheerder', assistent: 'Assistent', monteur: 'Monteur' };
  const permCount = (u) => {
    if (u.role === 'admin') return 'alles';
    const eff = PERM_LABELS.filter(([k]) => (u.perms && typeof u.perms[k] === 'boolean') ? u.perms[k] : (ROLE_PERM_DEFAULTS[u.role] || {})[k]).length;
    return `${eff} van ${PERM_LABELS.length} functies${u.perms && Object.keys(u.perms).length ? ' · aangepast' : ''}`;
  };
  $('#userList').innerHTML = `
    <table><thead><tr><th>Naam</th><th>E-mail</th><th>Rol</th><th>Rechten</th><th></th></tr></thead><tbody> ${users.map((u) => `<tr> <td><strong>${esc(u.name)}</strong>${u.id === state.me.id ? ' <span class="muted small">(jij)</span>' : ''}</td><td>${esc(u.email)}</td> <td><span class="tag ${esc(u.role)}">${esc(roleName[u.role] || u.role)}</span></td> <td class="muted small">${permCount(u)}</td> <td style="white-space:nowrap"><button class="btn btn-sm" data-uedit="${u.id}">Rechten &amp; rol</button> ${u.id !== state.me.id ? `<button class="btn btn-sm btn-danger" data-udel="${u.id}">Verwijder</button>` : ''}</td> </tr>`).join('')}
    </tbody></table>`;
  $$('[data-udel]').forEach((b) => b.onclick = async () => {
    if (!confirm('Gebruiker verwijderen?')) return;
    try { await api(`/api/users/${b.dataset.udel}`, 'DELETE'); toast('Verwijderd'); loadUsers(); }
    catch (err) { toast(err.message, true); }
  });
  $$('[data-uedit]').forEach((b) => b.onclick = () => openUserPermsModal(state._users.find((u) => u.id === b.dataset.uedit)));
}

// Rechten & rol per gebruiker: rol = basisprofiel, vinkjes = fijnafstelling.
function openUserPermsModal(u) {
  if (!u) return;
  const monteurOpts = (state.monteurs || []).map((m) => `<option value="${m.id}" ${u.monteurId === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
  const effective = (role, k) => (u.perms && typeof u.perms[k] === 'boolean') ? u.perms[k] : (ROLE_PERM_DEFAULTS[role] || {})[k];
  const rows = (role) => PERM_LABELS.map(([k, label, sub]) => `
    <label class="perm-row" style="display:flex;align-items:flex-start;gap:10px;flex-direction:row;padding:9px 0;border-bottom:1px solid var(--line-soft);margin:0">
      <input type="checkbox" class="up-perm" data-k="${k}" style="width:auto;margin-top:3px" ${effective(role, k) ? 'checked' : ''} ${role === 'admin' ? 'checked disabled' : ''}>
      <span><strong style="font-weight:600">${esc(label)}</strong><br><span class="muted small">${esc(sub)}</span></span>
    </label>`).join('');
  modal(`
    <h2>${icon('user', 16)} ${esc(u.name)} — rechten &amp; rol</h2>
    <p class="muted small">De rol is het basisprofiel; met de vinkjes stel je per gebruiker bij. De gebruiker ziet de wijziging na opnieuw inloggen of verversen.</p>
    <div class="row">
      <label>Rol <select id="up-role">
        <option value="assistent" ${u.role === 'assistent' ? 'selected' : ''}>Assistent</option>
        <option value="monteur" ${u.role === 'monteur' ? 'selected' : ''}>Monteur</option>
        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Beheerder (altijd alles)</option>
      </select></label>
      <label id="up-monteur-wrap" ${u.role !== 'monteur' ? 'hidden' : ''}>Gekoppelde monteur <select id="up-monteur"><option value="">— kies monteur —</option>${monteurOpts}</select></label>
    </div>
    <div class="form-sec">${icon('mail', 13)} Naam onder uitgaande e-mail</div>
    <label>Functie van deze persoon <input id="up-functie" value="${esc(u.functie || '')}" placeholder="bv. Monteur | Key Service 24/7">
      <span class="muted small">Vul je dit in, dan staat onder mails die déze gebruiker verstuurt zijn eigen naam en functie — in plaats van de vaste handtekening uit Instellingen. Leeg laten = de vaste handtekening blijft staan.</span></label>
    <div class="form-sec">${icon('shield', 13)} Functies</div>
    <div id="up-perms">${rows(u.role)}</div>
    <button type="button" class="btn btn-sm" id="up-reset" style="margin-top:10px">Terug naar standaard van de rol</button>
    <div class="form-sec">${icon('tag', 13)} Wachtwoord</div>
    <label>Nieuw wachtwoord (leeg = niet wijzigen) <input id="up-pass" type="text" placeholder="minimaal 6 tekens"></label>
    <div class="modal-actions"><span></span><div class="right">
      <button class="btn" id="up-cancel">Annuleren</button>
      <button class="btn btn-primary" id="up-save">Opslaan</button>
    </div></div>`);
  const refreshRows = () => { $('#up-perms').innerHTML = rows($('#up-role').value); };
  $('#up-role').addEventListener('change', () => {
    $('#up-monteur-wrap').hidden = $('#up-role').value !== 'monteur';
    refreshRows(); // nieuwe rol = nieuwe standaard-vinkjes
  });
  $('#up-reset').onclick = refreshRows;
  $('#up-cancel').onclick = closeModal;
  $('#up-save').onclick = async () => {
    const role = $('#up-role').value;
    const payload = { role, monteurId: role === 'monteur' ? $('#up-monteur').value : null, functie: $('#up-functie').value.trim() };
    if (role === 'monteur' && !payload.monteurId) return toast('Kies welke monteur dit account is', true);
    if (role !== 'admin') {
      const perms = {}; const defs = ROLE_PERM_DEFAULTS[role] || {};
      $$('#up-perms .up-perm').forEach((c) => { if (c.checked !== !!defs[c.dataset.k]) perms[c.dataset.k] = c.checked; });
      payload.perms = Object.keys(perms).length ? perms : null; // null = precies de rol-standaard
    }
    const pass = $('#up-pass').value.trim();
    if (pass) { if (pass.length < 6) return toast('Wachtwoord minimaal 6 tekens', true); payload.newPassword = pass; }
    try { await api(`/api/users/${u.id}`, 'PATCH', payload); closeModal(); toast('Opgeslagen'); loadUsers(); }
    catch (err) { toast(err.message, true); }
  };
}
function openUserModal() {
  const monteurOpts = (state.monteurs || []).map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  modal(`
    <h2>Nieuwe gebruiker</h2> <label>Naam <input id="u-name"></label> <label>E-mail <input id="u-email" type="email"></label> <label>Wachtwoord <input id="u-pass" type="text" placeholder="minimaal 6 tekens"></label> <label>Rol <select id="u-role"> <option value="assistent">Assistent (alles behalve gebruikersbeheer)</option> <option value="monteur">Monteur (ziet alleen eigen opdrachten)</option> <option value="admin">Admin (volledige toegang)</option> </select></label> <label id="u-monteur-wrap" hidden>Welke monteur is dit account? <select id="u-monteur"><option value="">— kies monteur —</option>${monteurOpts}</select></label> <div class="modal-actions"><span></span><div class="right"> <button class="btn" id="u-cancel">Annuleren</button><button class="btn btn-primary" id="u-save">Aanmaken</button> </div></div>`);
  const syncMonteur = () => { $('#u-monteur-wrap').hidden = $('#u-role').value !== 'monteur'; };
  $('#u-role').addEventListener('change', syncMonteur); syncMonteur();
  $('#u-cancel').onclick = closeModal;
  $('#u-save').onclick = async () => {
    const role = $('#u-role').value;
    const payload = { name: $('#u-name').value, email: $('#u-email').value, password: $('#u-pass').value, role, monteurId: role === 'monteur' ? $('#u-monteur').value : null };
    if (!payload.name || !payload.email || payload.password.length < 6) return toast('Vul alles in (wachtwoord min. 6 tekens)', true);
    if (role === 'monteur' && !payload.monteurId) return toast('Kies welke monteur dit account is', true);
    try { await api('/api/users', 'POST', payload); closeModal(); toast('Gebruiker aangemaakt'); loadUsers(); }
    catch (err) { toast(err.message, true); }
  };
}

// ---------- Afwijzen met feedback (AI laten leren) ----------
const REJECT_REASONS = [
  'Geen echte opdracht (spam/reclame)',
  'Dubbel — bestaat al',
  'Verkeerde categorie ingeschat',
  'Klantgegevens niet kloppend',
  'Geen klantaanvraag (intern/leverancier)',
  'Anders',
];
function openRejectModal(r) {
  const statusOpts = '<option value="">— n.v.t. —</option>' + statusOptionsHTML('');
  modal(`
    <h2>Afwijzen</h2> <p class="muted small">Je kunt direct afwijzen. Feedback geven is optioneel, maar helpt de AI leren en is zichtbaar voor het team.</p> <label>Reden (optioneel) <select id="rj-reason"><option value="">— geen reden —</option>${REJECT_REASONS.map((x) => `<option>${esc(x)}</option>`).join('')}</select></label> <label>Had eigenlijk moeten zijn (optioneel) <select id="rj-should">${statusOpts}</select></label> <label>Uitleg (optioneel) <textarea id="rj-note" rows="3" placeholder="Bv. dit was een nieuwsbrief van een leverancier, geen klant."></textarea></label> <div class="modal-actions"><span></span><div class="right"> <button class="btn" id="rj-cancel">Annuleren</button> <button class="btn btn-danger" id="rj-save">Afwijzen</button> </div></div>`);
  $('#rj-cancel').onclick = closeModal;
  $('#rj-save').onclick = async () => {
    try {
      await api(`/api/reviews/${r.id}/reject`, 'POST', {
        reason: $('#rj-reason').value,
        shouldBe: $('#rj-should').value ? statusLabel($('#rj-should').value) : '',
        note: $('#rj-note').value,
      });
      closeModal(); toast('Afgewezen'); loadInbox(); refreshInboxBadge();
    } catch (err) { toast(err.message, true); }
  };
}

// ---------- Beantwoorden (echte conversatie) ----------
function openReplyModal(ctx = {}) {
  const templates = state.meta.templates || [];
  const opts = '<option value="">— kies standaardtekst —</option>' + templates.map((t, i) => `<option value="${i}">${esc(t.title)}</option>`).join('');
  const canSend = state.meta.canSendEmail && ctx.email;
  const thread = ctx.thread || [];
  // Onderwerp wordt "Re: <titel>" zodat het een doorlopend gesprek is.
  const subj = ctx.title ? (/^re:/i.test(ctx.title) ? ctx.title : 'Re: ' + ctx.title) : 'Re: uw aanvraag bij Keyservice';
  // Laatste klantbericht om te citeren (zodat het als antwoord leest).
  const lastMsg = [...thread].reverse().find((t) => t.body);
  const sig = (state.meta.emailSignature || '').trim();
  const threadHTML = thread.length
    ? `<div class="reply-thread">${thread.slice(-6).map((t) => `
        <div class="reply-msg-row"><span class="reply-who">${esc(t.sender || 'Klant')}</span> <span class="muted small">${fmtDate(t.at)}</span><div class="reply-msg-txt">${esc(splitQuoted(t.body || '').text.slice(0, 600))}</div></div>`).join('')}</div>`
    : '<div class="muted small">Nog geen eerdere berichten.</div>';

  modal(`
    <h2>Beantwoorden${ctx.name ? ' — ' + esc(ctx.name) : ''}</h2>
    <p class="muted small">${ctx.email ? esc(ctx.email) : 'Geen e-mailadres bekend'}</p>
    <div class="reply-head">Gesprek</div>
    ${threadHTML}
    <div class="row" style="margin-top:12px"> <label>Aan <input id="rep-to" value="${esc(ctx.email || '')}" placeholder="e-mailadres klant"></label> <label>Onderwerp <input id="rep-subject" value="${esc(subj)}"></label> </div>
    <label>Sjabloon invoegen <select id="rep-select">${opts}</select></label>
    <label>Jouw antwoord <textarea id="rep-body" rows="7" placeholder="Typ hier je antwoord aan de klant…"></textarea></label>
    <label style="display:flex;align-items:center;gap:8px;flex-direction:row;margin-top:4px"><input type="checkbox" id="rep-quote" style="width:auto"> Vorig bericht citeren onder mijn antwoord</label>
    ${sig ? `<p class="muted small" style="margin:8px 0 0">Onder je antwoord komt automatisch:<br><span style="white-space:pre-line;color:var(--ink-soft)">${esc(sig)}</span></p>` : ''}
    <div class="modal-actions"> ${ctx.orderId ? `<button class="btn" id="rep-ai">${icon('sparkles', 14)} AI-concept</button>` : '<span></span>'}
      <div class="right"> <button class="btn" id="rep-close">Sluiten</button> <button class="btn" id="rep-copy">${icon('copy', 14)} Kopieer</button> ${ctx.email ? `<a class="btn" id="rep-mail" href="#" target="_blank" rel="noopener">${icon('mail', 14)} Open in e-mail</a>` : ''}
        ${canSend ? '<button class="btn btn-primary" id="rep-send">Verzenden</button>' : ''}
      </div> </div>
    <p class="muted small" id="rep-hint" style="margin-top:10px">${
      canSend ? 'Wordt direct vanuit het dashboard verstuurd, met je naam als afzender. Het hele gesprek blijft op de kaart bewaard.'
      : ctx.email ? 'Direct versturen staat nog uit (SMTP). Gebruik “Open in e-mail” of kopieer de tekst.'
      : 'Geen e-mailadres bekend — kopieer de tekst en plak hem in WhatsApp.'
    }</p> `);

  // Bouwt de volledige tekst: jouw antwoord + nette handtekening + (optioneel) citaat.
  const fullText = () => {
    let t = $('#rep-body').value.trim();
    if (sig) t += `\n\n${sig}`;
    if ($('#rep-quote')?.checked && lastMsg) {
      const when = fmtDate(lastMsg.at);
      const quoted = splitQuoted(lastMsg.body || '').text.split('\n').map((l) => '> ' + l).join('\n');
      t += `\n\n----- Op ${when} schreef ${lastMsg.sender || 'de klant'}: -----\n${quoted}`;
    }
    return t;
  };

  const aiBtn = $('#rep-ai');
  if (aiBtn) aiBtn.onclick = async () => {
    aiBtn.disabled = true; aiBtn.textContent = 'Bezig…';
    try {
      const out = await api(`/api/orders/${ctx.orderId}/suggest-reply`, 'POST');
      if (out.text) { $('#rep-body').value = out.text; flash('#rep-body'); toast('Concept ingevuld'); }
      else toast('Geen concept (zet de AI aan)', true);
    } catch (err) { toast(err.message, true); }
    aiBtn.disabled = false; aiBtn.innerHTML = `${icon('sparkles', 14)} AI-concept`;
  };
  // Bewust GEEN automatisch AI-concept bij openen: het antwoordvak blijft leeg totdat
  // je zelf op "AI-concept" klikt. Scheelt ook AI-kosten bij elk antwoord.
  // Sjabloon kiezen → tekst in het antwoordvak zetten (bestaande tekst wordt vervangen na bevestiging).
  const tplSel = $('#rep-select');
  if (tplSel) tplSel.onchange = () => {
    const i = tplSel.value;
    if (i === '') return;
    const tpl = templates[Number(i)];
    if (!tpl) return;
    const bodyEl = $('#rep-body');
    if (bodyEl.value.trim() && !confirm('Het antwoordvak wordt vervangen door dit sjabloon. Doorgaan?')) {
      tplSel.value = ''; return;
    }
    bodyEl.value = tpl.body || '';
    flash('#rep-body');
    tplSel.value = ''; // terug naar "kies standaardtekst" zodat je 'm opnieuw kunt kiezen
  };
  $('#rep-close').onclick = closeModal;
  $('#rep-copy').onclick = async () => {
    const t = fullText();
    try { await navigator.clipboard.writeText(t); toast('Tekst gekopieerd'); }
    catch { const b = $('#rep-body'); b.value = t; b.select(); document.execCommand('copy'); toast('Tekst gekopieerd'); }
  };
  const mailBtn = $('#rep-mail');
  if (mailBtn) mailBtn.onclick = () => {
    mailBtn.href = `mailto:${encodeURIComponent($('#rep-to').value)}?subject=${encodeURIComponent($('#rep-subject').value)}&body=${encodeURIComponent(fullText())}`;
  };
  const sendBtn = $('#rep-send');
  if (sendBtn) sendBtn.onclick = async () => {
    if (!$('#rep-body').value.trim()) return toast('Typ eerst een antwoord', true);
    sendBtn.disabled = true;
    try {
      await api('/api/send-reply', 'POST', {
        to: $('#rep-to').value, subject: $('#rep-subject').value, text: fullText(), orderId: ctx.orderId || null,
      });
      closeModal(); toast('Verstuurd'); loadBoard();
    } catch (err) { toast(err.message, true); sendBtn.disabled = false; }
  };
}

// ---------- Account / wachtwoord ----------
function openAccountModal() {
  modal(`
    <h2>Mijn account</h2> <p class="muted small">${esc(state.me.name)} · ${esc(state.me.email)} · rol: ${esc(state.me.role)}</p> <h3 style="margin:16px 0 10px;font-size:15px">Wachtwoord wijzigen</h3> <label>Huidig wachtwoord <input id="p-cur" type="password"></label> <label>Nieuw wachtwoord <input id="p-new" type="password" placeholder="minimaal 6 tekens"></label> <label>Herhaal nieuw wachtwoord <input id="p-new2" type="password"></label> <div class="modal-actions"><span></span><div class="right"> <button class="btn" id="p-cancel">Sluiten</button><button class="btn btn-primary" id="p-save">Wijzigen</button> </div></div>`);
  $('#p-cancel').onclick = closeModal;
  $('#p-save').onclick = async () => {
    const cur = $('#p-cur').value, n1 = $('#p-new').value, n2 = $('#p-new2').value;
    if (n1.length < 6) return toast('Nieuw wachtwoord minimaal 6 tekens', true);
    if (n1 !== n2) return toast('Wachtwoorden komen niet overeen', true);
    try { await api('/api/me/password', 'POST', { currentPassword: cur, newPassword: n1 }); closeModal(); toast('Wachtwoord gewijzigd'); }
    catch (err) { toast(err.message, true); }
  };
}

// ---------- Bericht handmatig toevoegen ----------
function openSimulateModal() {
  modal(`
    <h2>Bericht handmatig toevoegen</h2> <p class="muted small">Handig om een bericht uit je <strong>WhatsApp-groep</strong> door te zetten: kopieer het en plak het hieronder. De AI deelt het daarna in.</p> <label>Kanaal <select id="s-channel"> <option value="whatsapp">WhatsApp</option><option value="email">E-mail</option> </select></label> <label>Afzender (naam / nummer / e-mail) <input id="s-sender" placeholder="Jan Jansen of 06-12345678"></label> <label>Groep (optioneel) <input id="s-group" placeholder="bv. DRS WhatsApp groep"></label> <label>Onderwerp (bij e-mail) <input id="s-subject" placeholder="Offerte aanvraag voordeurslot"></label> <label>Bericht <textarea id="s-body" rows="4" placeholder="Hoi, ik ben buitengesloten en kom mijn huis niet in. Kunnen jullie snel langskomen?"></textarea></label> <div class="modal-actions"><span></span><div class="right"> <button class="btn" id="s-cancel">Annuleren</button><button class="btn btn-primary" id="s-save">Versturen</button> </div></div>`);
  $('#s-cancel').onclick = closeModal;
  $('#s-save').onclick = async () => {
    const payload = { channel: $('#s-channel').value, sender: $('#s-sender').value, group: $('#s-group').value, subject: $('#s-subject').value, body: $('#s-body').value };
    if (!payload.body) return toast('Bericht verplicht', true);
    try { await api('/api/simulate', 'POST', payload); closeModal(); toast('Bericht ontvangen — zie Inbox'); refreshInboxBadge(); if (state.view === 'inbox') loadInbox(); }
    catch (err) { toast(err.message, true); }
  };
}

// ---------- Status-scan (digest) ----------
async function openDigestModal() {
  modal('<h2>Status-scan</h2><p class="muted small">Bezig met scannen…</p>');
  const d = await api('/api/digest');
  const list = (arr, emptyTxt) => arr.length
    ? `<ul class="digest-list">${arr.map((o) => `<li data-open="${o.id}">${esc(o.title)}${o.customer ? ` <span class="muted">· ${esc(o.customer)}</span>` : ''}</li>`).join('')}</ul>`
    : `<div class="muted small">${emptyTxt}</div>`;
  // Variant met afspraaktijd erbij.
  const apptList = (arr, emptyTxt) => arr.length
    ? `<ul class="digest-list">${arr.map((o) => `<li data-open="${o.id}"><strong>${fmtDate(o.at)}</strong> — ${esc(o.title)}${o.customer ? ` <span class="muted">· ${esc(o.customer)}</span>` : ''}</li>`).join('')}</ul>`
    : `<div class="muted small">${emptyTxt}</div>`;
  const statusBar = Object.values(d.byStatus).map((s) => `<span class="chip">${esc(s.label)}: <strong>${s.count}</strong></span>`).join(' ');
  modal(`
    <h2>Status-scan</h2> <p class="muted small">${d.total} actieve opdrachten · ${d.pendingReviews} wachten in de inbox</p> <div style="display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px">${statusBar}</div>
    <div class="digest-block"><h3>Afspraken vandaag (${d.todayAppointments?.length || 0})</h3>${apptList(d.todayAppointments || [], 'Geen afspraken vandaag.')}</div>
    <div class="digest-block"><h3>Afspraken deze week (${d.weekAppointments?.length || 0})</h3>${apptList(d.weekAppointments || [], 'Geen afspraken deze week.')}</div>
    <div class="digest-block"><h3>Klant heeft gereageerd (${d.customerReplied.length})</h3>${list(d.customerReplied, 'Niemand op dit moment.')}</div>
    <div class="digest-block"><h3>Wacht op ons antwoord (${d.awaitingReply.length})</h3>${list(d.awaitingReply, 'Niets openstaand.')}</div>
    <div class="digest-block"><h3>Offerte blijft liggen — 3+ dagen geen reactie (${d.staleQuotes?.length || 0})</h3>${list(d.staleQuotes || [], 'Geen offertes blijven liggen.')}</div>
    <div class="digest-block"><h3>Nog niet bekeken (${d.neverOpened.length})</h3>${list(d.neverOpened, 'Alles is bekeken.')}</div>
    <div class="digest-block"><h3>Lang stil (5+ dagen) (${d.stale.length})</h3>${list(d.stale, 'Niets blijft liggen.')}</div>
    <label class="muted small" style="display:flex;align-items:center;gap:8px;flex-direction:row;margin-top:12px"><input type="checkbox" id="dg-auto" style="width:auto"${digestAutoOn() ? ' checked' : ''}> Dit scherm elke ochtend automatisch openen</label>
    <div class="modal-actions"><span></span><div class="right"><button class="btn btn-primary" id="dg-close">Sluiten</button></div></div> `);
  $('#dg-close').onclick = closeModal;
  // Hier zet de gebruiker het automatisch openen aan of uit (standaard uit).
  const dgAuto = $('#dg-auto');
  if (dgAuto) dgAuto.onchange = () => {
    try {
      localStorage.setItem('ks_digestAuto', dgAuto.checked ? '1' : '0');
      // Vandaag is de scan al bekeken (je staat er nu in te kijken), dus zetten we
      // de dagvlag meteen. Anders sprong het venster bij de eerstvolgende verversing
      // dezelfde dag alsnog open — precies het gedrag waar de klacht over ging.
      if (dgAuto.checked) localStorage.setItem('ks_lastDigest', new Date().toISOString().slice(0, 10));
    } catch {}
    toast(dgAuto.checked ? 'Status-scan opent voortaan elke ochtend automatisch' : 'Automatisch openen staat uit');
  };
  $$('[data-open]').forEach((li) => li.onclick = () => { const id = li.dataset.open; closeModal(); markSeen(id); openOrderModal(id); });
}

// ---------- Dubbele klanten samenvoegen ----------
async function openDuplicatesModal() {
  modal('<h2>Dubbele klanten</h2><p class="muted small">Zoeken naar dubbele klanten…</p>');
  const groups = await api('/api/customers/duplicates');
  if (!groups.length) {
    modal('<h2>Dubbele klanten</h2><p>Geen dubbele klanten gevonden.</p><div class="modal-actions"><span></span><div class="right"><button class="btn btn-primary" id="d-close">Sluiten</button></div></div>');
    $('#d-close').onclick = closeModal; return;
  }
  const blocks = groups.map((grp, gi) => `
    <div class="dup-group"> <div class="muted small">Mogelijke dezelfde klant:</div> ${grp.map((c, ci) => `
        <label class="dup-row"> <input type="radio" name="primary-${gi}" value="${c.id}" ${ci === 0 ? 'checked' : ''}> <span><strong>${esc(c.name)}</strong> · ${esc(c.email || '')} ${esc(c.phone || '')} <span class="muted">(${c.orderCount} opdrachten)</span></span> </label>`).join('')}
      <button class="btn btn-sm btn-primary" data-merge="${gi}">Samenvoegen tot gekozen klant</button> </div>`).join('');
  modal(`<h2>Dubbele klanten (${groups.length})</h2> <p class="muted small">Kies per groep de juiste hoofdklant en voeg samen. Opdrachten worden verplaatst.</p> ${blocks}
    <div class="modal-actions"><span></span><div class="right"><button class="btn btn-primary" id="d-close">Sluiten</button></div></div>`);
  $('#d-close').onclick = closeModal;
  $$('[data-merge]').forEach((b) => b.onclick = async () => {
    const gi = b.dataset.merge;
    const primaryId = $(`input[name="primary-${gi}"]:checked`).value;
    const mergeIds = groups[gi].map((c) => c.id);
    try {
      const r = await api('/api/customers/merge', 'POST', { primaryId, mergeIds });
      toast(`Samengevoegd (${r.movedOrders} opdrachten verplaatst)`);
      openDuplicatesModal();
      if (state.view === 'customers') loadCustomers();
    } catch (err) { toast(err.message, true); }
  });
}

// ---------- Buttons & modal infra ----------
function bindButtons() {
  $('#newOrderBtn')?.addEventListener('click', () => openOrderModal());
  $('#phoneOrderBtn')?.addEventListener('click', openPhoneIntakeModal);
  $('#newCustomerBtn')?.addEventListener('click', () => openCustomerModal());
  $('#importCustomersBtn')?.addEventListener('click', openImportModal);
  $('#campaignBtn')?.addEventListener('click', openCampaignModal);
  $('#newMonteurBtn')?.addEventListener('click', () => openMonteurModal());
  $('#newUserBtn')?.addEventListener('click', () => openUserModal());
  $('#simulateBtn')?.addEventListener('click', () => openSimulateModal());
  $('#pasteOrderBtn')?.addEventListener('click', openPasteOrderModal);
  $('#boardSearch')?.addEventListener('input', renderBoard);
  // Periode wisselen = opnieuw laden (mét of zonder ingeklapte kaarten), niet alleen filteren.
  $('#boardPeriodFilter')?.addEventListener('change', loadBoard);
  $('#boardMonteurFilter')?.addEventListener('change', renderBoard);
  $('#customerSearch')?.addEventListener('input', renderCustomers);
  $('#trashSearch')?.addEventListener('input', renderTrash);
  $('#agendaScope')?.addEventListener('change', renderAgenda);
  $('#invFilter')?.addEventListener('change', renderInvoices);
  $('#newInvoiceBtn')?.addEventListener('click', () => openNewInvoiceFlow('factuur'));
  $('#newQuoteBtn')?.addEventListener('click', () => openNewInvoiceFlow('offerte'));
  $('#finMonth')?.addEventListener('change', loadFinance);
  $('#finAddIncome')?.addEventListener('click', () => openFinanceEntry('income'));
  $('#finAddExpense')?.addEventListener('click', () => openFinanceEntry('expense'));
  $('#finImport')?.addEventListener('click', openImportIncome);
  $('#finBackfill')?.addEventListener('click', openBackfillModal);
  $('#finSettings')?.addEventListener('click', openFinanceSettings);
  $('#inboxFilter')?.addEventListener('change', loadInbox);
  $('#selectAll')?.addEventListener('change', (e) => {
    $$('.r-select').forEach((c) => (c.checked = e.target.checked));
    updateBulkCount();
  });
  $('#bulkRejectBtn')?.addEventListener('click', async () => {
    const ids = selectedReviewIds();
    if (!ids.length) return toast('Selecteer eerst berichten', true);
    if (!confirm(`${ids.length} geselecteerde berichten afwijzen? Dit traint ook de AI.`)) return;
    try { const r = await api('/api/reviews/bulk-reject', 'POST', { ids }); toast(`${r.count} afgewezen`); loadInbox(); refreshInboxBadge(); }
    catch (err) { toast(err.message, true); }
  });
  $('#rejectAllOverigeBtn')?.addEventListener('click', async () => {
    if (!confirm('ALLE berichten in "Overige" (geklets) afwijzen? Dit traint de AI dat dit geen opdrachten zijn.')) return;
    try { const r = await api('/api/reviews/bulk-reject', 'POST', { scope: 'overige' }); toast(`${r.count} geklets afgewezen`); loadInbox(); refreshInboxBadge(); }
    catch (err) { toast(err.message, true); }
  });
  $('#rejectAllPendingBtn')?.addEventListener('click', async () => {
    if (!confirm('ALLE berichten in "Te controleren" afwijzen? Gebruik dit om een achterstand op te ruimen — het traint de AI dat dit geen opdrachten waren.')) return;
    try { const r = await api('/api/reviews/bulk-reject', 'POST', { scope: 'pending' }); toast(`${r.count} afgewezen`); loadInbox(); refreshInboxBadge(); }
    catch (err) { toast(err.message, true); }
  });
  $('#emptyRejectedBtn')?.addEventListener('click', async () => {
    if (!confirm('De inbox-prullenbak definitief legen? Dit kan niet ongedaan worden gemaakt.')) return;
    try { const r = await api('/api/reviews/empty-rejected', 'POST'); toast(`${r.removed} definitief verwijderd`); loadInbox(); }
    catch (err) { toast(err.message, true); }
  });
  $('#bulkApproveBtn')?.addEventListener('click', async () => {
    const pct = Number($('#bulkApprovePct').value);
    if (!confirm(`Alle inbox-berichten met AI-zekerheid van ${pct}% of hoger automatisch goedkeuren (worden opdrachten)?`)) return;
    try { const r = await api('/api/reviews/bulk-approve', 'POST', { minConfidence: pct }); toast(r.count ? `${r.count} goedgekeurd (≥${pct}%)` : 'Geen berichten boven de drempel'); loadInbox(); refreshInboxBadge(); loadBoard(); }
    catch (err) { toast(err.message, true); }
  });
  $('#cleanupBtn')?.addEventListener('click', async () => {
    if (!confirm('De inbox opschonen? Geklets wordt verplaatst naar "Overige", echte aanvragen blijven staan.')) return;
    try { const r = await api('/api/reviews/recategorize', 'POST'); toast(r.moved ? `${r.moved} geklets verplaatst naar Overige` : 'Niets te verplaatsen'); loadInbox(); refreshInboxBadge(); }
    catch (err) { toast(err.message, true); }
  });
  $('#digestBtn')?.addEventListener('click', openDigestModal);
  $('#ovDigestBtn')?.addEventListener('click', openDigestModal);
  $('#ovDailyCheck')?.addEventListener('click', openDailyCheck);
  $('#collapseBtn')?.addEventListener('click', async () => {
    const naam = state.channel === 'email' ? 'E-mail' : state.channel === 'whatsapp' ? 'WhatsApp' : 'Alle';
    const visible = filteredOrders().length;
    if (!visible) return toast('Er staan geen kaarten om in te klappen', true);
    if (!confirm(`${visible} kaart(en) van "${naam}" nu inklappen in een gedateerde bundel? Het bord wordt leeg; je vindt ze terug onder "Ingeklapte agenda's" en kunt ze altijd weer openen.`)) return;
    try {
      const r = await api('/api/archives/collapse', 'POST', { channel: state.channel });
      loadBoard();
      if (r.count && r.key) {
        toastUndo(`${r.count} kaart(en) ingeklapt`, async () => { await api('/api/archives/uncollapse', 'POST', { key: r.key }); toast('Inklappen ongedaan gemaakt'); loadBoard(); }, 12000);
      } else { toast('Niets ingeklapt'); }
    } catch (err) { toast(err.message, true); }
  });
  $('#boardBulkDelete')?.addEventListener('click', async () => {
    const ids = selectedCardIds();
    if (!ids.length) return;
    if (!confirm(`${ids.length} kaart(en) naar de prullenbak verplaatsen?`)) return;
    try { for (const id of ids) await api(`/api/orders/${id}`, 'DELETE'); clearBoardSel(); loadBoard(); toastUndo(`${ids.length} naar prullenbak`, () => restoreOrders(ids)); }
    catch (err) { toast(err.message, true); }
  });
  // Status-kiezer vullen + bulk-status toepassen op alle geselecteerde kaarten.
  const bulkSel = $('#boardBulkStatus');
  if (bulkSel) bulkSel.innerHTML = statusOptionsHTML();
  $('#boardBulkApply')?.addEventListener('click', async () => {
    const ids = selectedCardIds();
    const status = $('#boardBulkStatus')?.value;
    if (!ids.length || !status) return;
    const label = statusLabel(status);
    if (!confirm(`${ids.length} kaart(en) op "${label}" zetten?`)) return;
    let ok = 0;
    for (const id of ids) { try { await api(`/api/orders/${id}`, 'PATCH', { status }); ok++; } catch { /* skip */ } }
    toast(`${ok} kaart(en) → ${label}`);
    clearBoardSel();
    loadBoard();
  });
  $('#boardBulkClear')?.addEventListener('click', clearBoardSel);
  $('#dupBtn')?.addEventListener('click', openDuplicatesModal);
  $('#emptyTrashBtn')?.addEventListener('click', async () => {
    if (!confirm('De hele prullenbak definitief legen?')) return;
    try { const r = await api('/api/trash/empty', 'POST'); toast(`${r.removed} opdrachten verwijderd`); loadTrash(); }
    catch (err) { toast(err.message, true); }
  });
}

function modal(html) {
  $('#modal').innerHTML = html;
  $('#modalRoot').hidden = false;
  $('#modalRoot').scrollTop = 0;
  // ECHTE scroll-lock (iOS): body vastpinnen op de huidige scrollpositie.
  // Zonder dit schilderde Safari de vaste onderbalk soms op de oude positie
  // ("zwevende balk") en sprong de pagina na sluiten naar boven. Alleen de
  // positie bewaren bij de EERSTE modal (modal() wordt soms geketend aangeroepen).
  if (!document.body.classList.contains('modal-open')) {
    const y = window.scrollY || 0;
    document.body.dataset.lockY = String(y);
    document.body.style.top = `-${y}px`;
  }
  document.body.classList.add('modal-open'); // achtergrond vastzetten
  $('.modal-backdrop').onclick = closeModal;
}
function closeModal() {
  // Geen venster open (bv. Escape op een gewone pagina)? Dan óók niet scrollen —
  // anders sprong de pagina naar boven.
  if ($('#modalRoot').hidden) return;
  const m = $('#modal'); m.style.transform = ''; m.style.transition = '';
  $('#modalRoot').hidden = true; m.innerHTML = '';
  document.body.classList.remove('modal-open');
  // Scrollpositie exact herstellen (zie modal()).
  const y = Number(document.body.dataset.lockY || 0);
  document.body.style.top = '';
  delete document.body.dataset.lockY;
  window.scrollTo(0, y);
}

// Bottom-sheet: op mobiel sluit je een venster door het balkje/de titel bovenaan
// vast te pakken en omlaag te swipen (zoals je van apps gewend bent).
(() => {
  const sheet = document.getElementById('modal');
  const rootEl = document.getElementById('modalRoot');
  if (!sheet || !rootEl) return;
  let startY = 0, dragging = false, dy = 0;
  sheet.addEventListener('touchstart', (e) => {
    if (window.innerWidth > 820 || rootEl.hidden) return;
    const t = e.touches[0];
    const rect = sheet.getBoundingClientRect();
    if (t.clientY - rect.top > 64) return; // alleen de bovenste strook (balkje/titel)
    startY = t.clientY; dragging = true; dy = 0;
    sheet.style.transition = 'none';
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    sheet.style.transform = dy ? `translateY(${dy}px)` : '';
    if (dy) e.preventDefault(); // tijdens het slepen niet ook nog scrollen
  }, { passive: false });
  const endDrag = () => {
    if (!dragging) return; dragging = false;
    sheet.style.transition = 'transform .18s ease';
    if (dy > 110) {
      sheet.style.transform = 'translateY(105%)';
      setTimeout(closeModal, 170); // closeModal ruimt transform/transition op
    } else {
      sheet.style.transform = '';
      setTimeout(() => { sheet.style.transition = ''; }, 200);
    }
  };
  sheet.addEventListener('touchend', endDrag);
  sheet.addEventListener('touchcancel', endDrag);
})();

// Menu rechtsboven (mobiel): alle pagina's als nette knoppen in een sheet,
// plus Nachtmodus/Account/Uitloggen (die staan op mobiel niet in de bovenbalk).
function openNavMenu() {
  const items = navItems();
  modal(`<h2>${icon('list', 16)} Menu</h2>
    <div class="nav-menu-grid">${items.map((n) => `<button type="button" class="btn nav-menu-item" data-view="${esc(n.view)}">${icon(n.ic || 'list', 15)} ${esc(n.label)}</button>`).join('')}</div>
    <div class="form-sec">${icon('user', 13)} Account</div>
    <div class="nav-menu-grid">
      <button type="button" class="btn nav-menu-item" id="nm-theme">${icon('clock', 15)} Nachtmodus</button>
      <button type="button" class="btn nav-menu-item" id="nm-account">${icon('user', 15)} Account</button>
      <button type="button" class="btn nav-menu-item" id="nm-logout">${icon('x', 15)} Uitloggen</button>
    </div>
    <div class="modal-actions"><div class="right"><button class="btn" id="nm-close">Sluiten</button></div></div>`);
  $$('#modal .nav-menu-item[data-view]').forEach((b) => b.onclick = () => { closeModal(); goView(b.dataset.view); });
  const relay = (sel, target) => { const el = $(sel); if (el) el.onclick = () => { closeModal(); const t = document.getElementById(target); if (t) t.click(); }; };
  relay('#nm-theme', 'themeBtn'); relay('#nm-account', 'accountBtn'); relay('#nm-logout', 'logoutBtn');
  $('#nm-close').onclick = closeModal;
}
{ const b = document.getElementById('navMenuBtn'); if (b) b.onclick = openNavMenu; }
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if ($('.lightbox')) return; // open foto-viewer handelt zijn eigen Esc af
  closeModal();
});
// Sneltoets: druk "/" om direct in de zoekbalk van de huidige weergave te springen.
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey) return;
  const a = document.activeElement;
  if (a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName)) return;
  if (!$('#modalRoot').hidden) return;
  const view = $(`#view-${state.view}`);
  const search = view && $('input[type=search]', view);
  if (search) { e.preventDefault(); search.focus(); }
});

// Command palette: Ctrl/⌘+K -> overal zoeken (opdrachten, klanten) en snel navigeren.
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCommandPalette(); }
});
// Eén lijst met alle pagina's — gebruikt door het zoekvenster ("Ga naar") én het
// menu rechtsboven, zodat ze nooit uit elkaar lopen. Rechten-gestuurd: een
// assistente met het recht "Cijfers" krijgt die pagina hier vanzelf bij.
function navItems() {
  const monteur = state.me.role === 'monteur';
  const nav = [];
  if (!monteur) nav.push({ label: 'Overzicht', view: 'overview', ic: 'activity' });
  nav.push({ label: 'Opdrachten', view: 'board', ic: 'list' });
  if (hasPerm('inbox')) nav.push({ label: 'Inbox / AI', view: 'inbox', ic: 'mail' });
  nav.push({ label: 'Agenda', view: 'agenda', ic: 'calendar' });
  if (hasPerm('customers')) nav.push({ label: 'Klanten & leads', view: 'customers', ic: 'users' }, { label: 'Monteurs', view: 'monteurs', ic: 'wrench' });
  nav.push({ label: 'Facturen', view: 'invoices', ic: 'file' });
  if (!monteur) nav.push({ label: 'AI Assistent', view: 'assistant', ic: 'sparkles' });
  if (hasPerm('deleteOrders')) nav.push({ label: 'Prullenbak', view: 'trash', ic: 'trash' });
  if (hasPerm('system')) nav.push({ label: 'AI-controle', view: 'control', ic: 'shield' }, { label: 'Abonnementen', view: 'subs', ic: 'refresh' });
  if (hasPerm('finance')) nav.push({ label: 'Cijfers', view: 'finance', ic: 'activity' });
  if (hasPerm('settings')) nav.push({ label: 'Instellingen', view: 'settings', ic: 'wrench' });
  if (state.me.role === 'admin') nav.push({ label: 'Gebruikers', view: 'users', ic: 'user' });
  return nav;
}

async function openCommandPalette() {
  if ($('#cmdPalette')) return;
  const [orders, customers] = await Promise.all([api('/api/orders').catch(() => []), api('/api/customers').catch(() => [])]);
  state.orders = orders; // zodat een gekozen opdracht netjes opent
  const nav = navItems().map((n) => ({ label: n.label, view: n.view, type: 'view' }));
  const root = document.createElement('div'); root.id = 'cmdPalette'; root.className = 'cmd-root';
  root.innerHTML = `<div class="cmd-box"><input id="cmd-input" class="cmd-input" placeholder="Zoek opdracht of klant, of ga naar…" autocomplete="off" spellcheck="false"><div id="cmd-results" class="cmd-results"></div><div class="cmd-hint">↑ ↓ kiezen · Enter openen · Esc sluiten</div></div>`;
  document.body.appendChild(root);
  const input = $('#cmd-input', root);
  let items = []; let sel = 0;
  const render = () => {
    const q = input.value.toLowerCase().trim();
    const res = nav.filter((n) => !q || n.label.toLowerCase().includes(q));
    if (q) {
      orders.filter((o) => `${o.title} ${o.customer?.name || ''} ${o.customer?.phone || ''} ${o.customer?.email || ''}`.toLowerCase().includes(q)).slice(0, 7)
        .forEach((o) => res.push({ type: 'order', label: o.title, sub: o.customer?.name || '', id: o.id }));
      customers.filter((c) => `${c.name} ${c.email || ''} ${c.phone || ''}`.toLowerCase().includes(q)).slice(0, 5)
        .forEach((c) => res.push({ type: 'customer', label: c.name, sub: c.email || c.phone || '', obj: c }));
    }
    items = res; if (sel >= items.length) sel = 0;
    $('#cmd-results', root).innerHTML = items.map((it, i) =>
      `<div class="cmd-item ${i === sel ? 'sel' : ''}" data-i="${i}"><span class="cmd-type">${it.type === 'view' ? 'Ga naar' : it.type === 'order' ? 'Opdracht' : 'Klant'}</span> ${esc(it.label)}${it.sub ? ` <span class="muted">· ${esc(it.sub)}</span>` : ''}</div>`
    ).join('') || '<div class="cmd-empty muted small">Geen resultaten</div>';
  };
  const close = () => { root.remove(); document.removeEventListener('keydown', onKey, true); };
  const choose = (it) => { close(); if (!it) return; if (it.type === 'view') goView(it.view); else if (it.type === 'order') { markSeen(it.id); openOrderModal(it.id); } else openCustomerModal(it.obj); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(items[sel]); }
  };
  input.addEventListener('input', () => { sel = 0; render(); });
  document.addEventListener('keydown', onKey, true);
  root.addEventListener('click', (e) => { const it = e.target.closest('.cmd-item'); if (it) choose(items[Number(it.dataset.i)]); else if (e.target === root) close(); });
  render(); input.focus();
}

// ---------- Foto-viewer (lightbox) ----------
// Toont een foto schermvullend met kruisje, Esc om te sluiten en pijltjes ← → tussen foto's.
function openLightbox(images, start = 0) {
  if (!images || !images.length) return;
  let i = Math.max(0, Math.min(start, images.length - 1));
  const multi = images.length > 1;
  const root = document.createElement('div');
  root.className = 'lightbox';
  root.innerHTML = `
    <button class="lb-close" title="Sluiten (Esc)">${icon('x', 24)}</button>
    ${multi ? `<button class="lb-nav lb-prev" title="Vorige (←)">${icon('chevron-left', 30)}</button>` : ''}
    <img class="lb-img" src="" alt="">
    ${multi ? `<button class="lb-nav lb-next" title="Volgende (→)">${icon('chevron-right', 30)}</button>` : ''}
    <div class="lb-counter"></div>`;
  document.body.appendChild(root);
  const imgEl = $('.lb-img', root);
  const counter = $('.lb-counter', root);
  const show = () => { imgEl.src = images[i].url; counter.textContent = multi ? `${i + 1} / ${images.length}` : ''; };
  const close = () => { root.remove(); document.removeEventListener('keydown', onKey); };
  const prev = () => { i = (i - 1 + images.length) % images.length; show(); };
  const next = () => { i = (i + 1) % images.length; show(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'ArrowLeft' && multi) prev();
    else if (e.key === 'ArrowRight' && multi) next();
  };
  $('.lb-close', root).onclick = close;
  $('.lb-prev', root)?.addEventListener('click', (e) => { e.stopPropagation(); prev(); });
  $('.lb-next', root)?.addEventListener('click', (e) => { e.stopPropagation(); next(); });
  root.addEventListener('click', (e) => { if (e.target === root || e.target === imgEl) close(); });
  document.addEventListener('keydown', onKey);
  show();
}

// Geciteerde tekst (oude mail onder een bericht) in-/uitklappen in de gesprekshistorie.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.quote-toggle');
  if (!btn) return;
  const blk = btn.nextElementSibling;
  if (!blk || !blk.classList.contains('quoted-block')) return;
  const hidden = blk.hasAttribute('hidden');
  if (hidden) { blk.removeAttribute('hidden'); btn.innerHTML = `${icon('message', 11)} eerdere berichten verbergen`; }
  else { blk.setAttribute('hidden', ''); btn.innerHTML = `${icon('message', 11)} toon eerdere berichten`; }
});

// Klik op een foto-bijlage opent de viewer i.p.v. de losse afbeelding in een nieuw tabblad.
// Alle foto's in dezelfde bijlage-grid vormen samen de galerij (pijltjes bladeren erdoorheen).
document.addEventListener('click', (e) => {
  const a = e.target.closest('.att-img');
  if (!a) return;
  e.preventDefault();
  const grid = a.closest('.attach-grid') || document;
  const imgs = $$('.att-img', grid).map((el) => ({ url: el.getAttribute('href'), name: el.getAttribute('title') || '' }));
  const idx = imgs.findIndex((x) => x.url === a.getAttribute('href'));
  openLightbox(imgs.length ? imgs : [{ url: a.getAttribute('href') }], Math.max(0, idx));
});

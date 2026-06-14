// ---------- Helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Dunne outline-iconen (Lucide-stijl) — strak en zakelijk, geen emoji.
const ICON_PATHS = {
  whatsapp: '<path d="M3 21l1.7-5A8 8 0 1 1 8 19.3z"/>',
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

// ---------- Init ----------
(async function init() {
  const me = await api('/api/me');
  if (!me || !me.user) { window.location.href = '/'; return; }
  state.me = me.user; state.meta = me.meta;
  $('#userName').textContent = `${me.user.name} · ${me.user.role}`;
  $('#avatar').textContent = (me.user.name || '?').trim().charAt(0).toUpperCase();
  $('#aiMode').textContent = me.meta.aiMode === 'ai' ? 'AI actief' : 'AI: demo';

  if (me.user.role !== 'admin') $$('.admin-only').forEach((el) => el.remove());
  if (me.user.role === 'monteur') $$('.perm-write').forEach((el) => (el.hidden = true));

  bindNav();
  bindButtons();
  await refreshAll();
  refreshWaStatus();
  setInterval(refreshWaStatus, 60000);
  startLiveUpdates();
  maybeMorningDigest();
})();

// Toont de status-scan één keer per dag automatisch (ochtend-samenvatting) voor
// admin/assistent. Daarna pas weer de volgende dag.
function maybeMorningDigest() {
  if (state.me.role === 'monteur') return;
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
      // Alleen de inhoud verversen als er écht iets veranderd is.
      if (_lastPulse !== null && p.v !== _lastPulse) {
        if (state.view === 'board') loadBoard();
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
  $('#logoutBtn').addEventListener('click', async () => { await api('/api/logout', 'POST'); window.location.href = '/'; });
  $('#accountBtn').addEventListener('click', openAccountModal);
}

function showView(view, tab) {
  state.view = view;
  // De drie board-menu's (Opdrachten/E-mail/WhatsApp) delen dezelfde weergave maar filteren op kanaal.
  state.channel = (tab && tab.dataset.channel) || 'all';
  $$('.nav-item').forEach((t) => t.classList.remove('active'));
  if (tab) tab.classList.add('active');
  else $(`.nav-item[data-view="${view}"]`)?.classList.add('active');
  $$('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  const active = $(`#view-${view}`);
  if (active) { active.classList.remove('fade-swap'); void active.offsetWidth; active.classList.add('fade-swap'); }
  const map = { board: loadBoard, inbox: loadInbox, customers: loadCustomers, agenda: loadAgenda, assistant: loadAssistant, monteurs: loadMonteurs, trash: loadTrash, control: loadControl, subs: loadSubs, settings: loadSettings, users: loadUsers };
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
  await loadBoard();
  await refreshInboxBadge();
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
  state.orders = await api('/api/orders');
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
  if (!archives.length) { wrap.innerHTML = ''; return; }
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

function filteredOrders() {
  const q = ($('#boardSearch').value || '').toLowerCase();
  const mont = $('#boardMonteurFilter').value;
  return state.orders.filter((o) => {
    if (state.channel === 'email' && orderChannel(o) !== 'email') return false;
    if (state.channel === 'whatsapp' && orderChannel(o) !== 'whatsapp') return false;
    if (mont && o.monteurId !== mont) return false;
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
  board.innerHTML =
    `<div class="board-row board-primary">${primary.map(colHTML).join('')}</div>` +
    (secondary.length ? `<div class="board-row board-secondary"><div class="board-sec-label">Afgehandeld</div><div class="board-sec-cols">${secondary.map(colHTML).join('')}</div></div>` : '');

  $$('.card').forEach((el) => {
    el.addEventListener('click', (e) => {
      // Klikken op selectievakje of prullenbak-knop opent de kaart niet.
      if (e.target.closest('.card-select') || e.target.closest('.card-trash')) return;
      markSeen(el.dataset.id); openOrderModal(el.dataset.id);
    });
    el.addEventListener('dragstart', (e) => { window._dragging = true; e.dataTransfer.setData('text/plain', el.dataset.id); el.style.opacity = '.5'; });
    el.addEventListener('dragend', () => { window._dragging = false; el.style.opacity = '1'; });
  });
  // Mini-prullenbak per kaart
  $$('.card-trash').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await api(`/api/orders/${b.dataset.del}`, 'DELETE'); toast('Naar prullenbak'); loadBoard(); }
    catch (err) { toast(err.message, true); }
  }));
  // Selectievakjes -> toon/verberg de bord-bulkbalk
  $$('.card-check').forEach((c) => c.addEventListener('change', updateBoardBulk));
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
      try { await api(`/api/orders/${id}`, 'DELETE'); toast('Naar prullenbak verplaatst'); loadBoard(); }
      catch (err) { toast(err.message, true); }
    };
  } else if (tz) { tz.hidden = true; }

  setupBoardTabs();
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

function selectedCardIds() { return $$('.card-check:checked').map((c) => c.dataset.id); }
function updateBoardBulk() {
  const bar = $('#boardBulkBar'); if (!bar) return;
  const ids = selectedCardIds();
  bar.hidden = ids.length === 0;
  const c = $('#boardBulkCount'); if (c) c.textContent = `${ids.length} geselecteerd`;
}

function cardHTML(o) {
  const sm = sourceMeta(o.source);
  const meta = [`<span class="chip ${sm.cls}">${sourceIcon(o.source)} ${esc(o.source || 'Handmatig')}</span>`];
  if (o.monteur) meta.push(`<span class="chip mont">${icon('wrench', 13)} ${esc(o.monteur.name)}</span>`);
  if (o.sentToMonteur) meta.push(`<span class="chip src-whatsapp" title="Verstuurd naar ${esc(o.sentToMonteur.monteurName)}">${icon('whatsapp', 13)} naar ${esc(o.sentToMonteur.monteurName)}</span>`);
  if (o.urgent) meta.push(`<span class="chip urgent">${icon('bolt', 13)} spoed</span>`);
  if (o.appointmentAt) meta.push(`<span class="chip">${icon('calendar', 13)} ${fmtDate(o.appointmentAt)}</span>`);
  if (o.attachments && o.attachments.length) meta.push(`<span class="chip">${icon('paperclip', 13)} ${o.attachments.length}</span>`);
  // Status-stip: beantwoord (groen) > geopend (blauw) > nieuw/ongelezen (geel).
  const st = o.lastReplyAt ? { c: 'replied', t: 'Beantwoord' }
    : o.openedAt ? { c: 'opened', t: 'Geopend' }
    : { c: 'new', t: 'Nieuw — nog niet bekeken' };
  const replyCount = o.unreadReplies || 0;
  const replyLabel = replyCount > 1 ? `${replyCount} nieuwe berichten` : 'Nieuw bericht';
  const canDel = state.me.role !== 'monteur';
  return `
    <div class="card ${o.urgent ? 'urgent' : ''} ${st.c === 'new' ? 'is-new' : ''} ${o.customerReplied ? 'replied-alert' : ''}" data-id="${o.id}" draggable="true" style="border-left-color:${esc(statusColor(o.status))}">
      ${canDel ? `<label class="card-select" title="Selecteren"><input type="checkbox" class="card-check" data-id="${o.id}"></label>` : ''}
      ${canDel ? `<button class="card-trash" data-del="${o.id}" title="Naar prullenbak">${icon('trash', 14)}</button>` : ''}
      ${o.customerReplied ? `<div class="reply-banner">${icon('message', 12)} ${replyLabel}</div>` : ''}
      <div class="card-title"><span class="state-dot ${st.c}" title="${st.t}"></span><span class="card-title-txt">${esc(o.title)}</span>${replyCount ? `<span class="title-count" title="${replyLabel}">${replyCount}</span>` : ''}</div>
      ${o.customer ? `<div class="card-customer">${icon('user', 13)} ${esc(o.customer.name)}${o.customer.phone ? ' · ' + esc(o.customer.phone) : ''}</div>` : ''}
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

// Toont bijlagen als thumbnails (foto/video) of bestand-tegels.
function attachmentsHTML(atts) {
  if (!atts || !atts.length) return '<div class="muted small">Nog geen foto’s of bestanden.</div>';
  return atts.map((a) => {
    if (a.kind === 'image') return `<a class="att att-img" href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.filename)}"><img src="${esc(a.url)}" loading="lazy"></a>`;
    if (a.kind === 'video') return `<a class="att att-vid" href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.filename)}">${icon('video', 22)}<span>video</span></a>`;
    if (a.kind === 'audio') return `<a class="att att-file" href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.filename)}">${icon('mic', 22)}<span>audio</span></a>`;
    return `<a class="att att-file" href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.filename)}">${icon('file', 22)}<span>${esc((a.filename || 'bestand').slice(0, 14))}</span></a>`;
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
  modal(`
    <h2>Naar monteur sturen</h2>
    <p class="muted small">De opdracht wordt als nette samenvatting naar de WhatsApp-groep van de monteur gestuurd via de bridge.</p>
    <label>Monteur <select id="sm-monteur">${opts || '<option>(geen monteurs)</option>'}</select></label>
    <p class="muted small">Heeft de monteur nog geen WhatsApp-groep? Stel die in bij Monteurs.</p>
    <div class="modal-actions"><span></span><div class="right"> <button class="btn" id="sm-cancel">Annuleren</button> <button class="btn btn-primary" id="sm-send">Versturen</button> </div></div>`);
  $('#sm-cancel').onclick = () => openOrderModal(order.id);
  $('#sm-send').onclick = async () => {
    const monteurId = $('#sm-monteur').value;
    if (!monteurId) return toast('Kies een monteur', true);
    try { await api(`/api/orders/${order.id}/send-monteur`, 'POST', { monteurId }); closeModal(); toast('In de wachtrij gezet — wordt verstuurd'); loadBoard(); }
    catch (err) { toast(err.message, true); }
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
    <label>Titel <input id="f-title" value="${esc(o?.title || '')}" ${isMonteur ? 'disabled' : ''} placeholder="bv. Cilinderslot vervangen"></label> ${!o ? `
      <div class="row"> <label>Klantnaam <input id="f-cname" placeholder="Naam klant"></label> <label>Telefoon <input id="f-cphone" placeholder="06-…"></label> </div> <label>E-mail klant <input id="f-cemail" placeholder="optioneel"></label> ` : `
      <div class="row"> <label>Klantnaam <input id="f-ccname" value="${esc(o.customer?.name || '')}" ${isMonteur ? 'disabled' : ''}></label> <label>Telefoon <input id="f-ccphone" value="${esc(o.customer?.phone || '')}" ${isMonteur ? 'disabled' : ''}></label> </div> <div class="row"> <label>E-mail <input id="f-ccemail" value="${esc(o.customer?.email || '')}" ${isMonteur ? 'disabled' : ''} placeholder="e-mailadres klant"></label> <label>Adres <input id="f-ccaddress" value="${esc(o.customer?.address || '')}" ${isMonteur ? 'disabled' : ''}></label> </div>`}
    <div class="row"> <label>Status <select id="f-status">${statusOptionsHTML(o?.status)}</select></label> <label>Monteur <select id="f-monteur" ${isMonteur ? 'disabled' : ''}>${monteurOpts}</select></label> </div> <div class="row"> <label>Afspraak (datum/tijd) <input id="f-appt" type="datetime-local" value="${o?.appointmentAt ? esc(o.appointmentAt.slice(0,16)) : ''}"></label> <label>Prijs <input id="f-price" value="${esc(o?.price || '')}" ${isMonteur ? 'disabled' : ''} placeholder="€"></label> </div> ${canWrite ? `<label>Herkomst (bron) ${sourceSelect(o?.source || 'Handmatig')}</label>` : ''}
    <label>Notities <textarea id="f-notes" rows="3" placeholder="Interne notities">${esc(o?.notes || '')}</textarea></label> ${canWrite ? `<label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="f-urgent" style="width:auto" ${o?.urgent ? 'checked' : ''}>Spoed</label>` : ''}
    ${o ? `
      <div class="attach"> <div class="thread-head">${icon('paperclip', 15)} Foto's &amp; bestanden${o.attachments && o.attachments.length ? ` (${o.attachments.length})` : ''}
          <button class="btn btn-sm" id="f-addfile" type="button" style="margin-left:auto">+ Toevoegen</button> <input type="file" id="f-fileinput" accept="image/*,video/*,application/pdf" multiple hidden> </div> <div class="attach-grid" id="f-attachgrid">${attachmentsHTML(o.attachments)}</div> </div>` : ''}
    ${o && o.thread && o.thread.length ? `
      <div class="thread">
        <div class="thread-head">${icon('message', 16)} Gesprekshistorie <span class="thread-count">${o.thread.length}</span>${o.thread.length ? `<span class="thread-last muted">laatste: ${fmtDate(o.thread[o.thread.length - 1].at)}</span>` : ''}</div>
        <div class="chat" id="f-chat">
          ${o.thread.map((t) => { const q = splitQuoted(t.body || ''); return `
          <div class="chat-msg ${t.outgoing ? 'out' : 'in'}">
            <div class="chat-meta">${t.outgoing ? icon('reply', 12) : sourceIcon(t.channel)} ${esc(t.sender || (t.outgoing ? 'Keyservice' : 'Klant'))} · ${fmtDate(t.at)}</div>
            <div class="chat-bubble">${esc(q.text)}${q.quoted ? `<button type="button" class="quote-toggle">${icon('message', 11)} toon eerdere berichten</button><div class="quoted-block" hidden>${esc(q.quoted)}</div>` : ''}${t.attachments && t.attachments.length ? `<div class="attach-grid" style="margin-top:8px">${attachmentsHTML(t.attachments)}</div>` : ''}</div>
          </div>`; }).join('')}
        </div>
      </div>` : ''}
    <div class="modal-actions"> ${o && canWrite ? '<button class="btn btn-danger" id="f-delete">Verwijderen</button>' : '<span></span>'}
      <div class="right"> ${o && canWrite ? `<button class="btn" id="f-send-monteur">${icon('whatsapp', 14)} ${o.sentToMonteur ? 'Opnieuw naar monteur' : 'Stuur naar monteur'}</button>` : ''} ${o && canWrite ? `<button class="btn" id="f-merge">${icon('merge', 14)} Samenvoegen</button>` : ''} ${o ? `<button class="btn" id="f-reply">${icon('reply', 14)} Snel antwoord</button>` : ''}
        <button class="btn" id="f-cancel">Annuleren</button> <button class="btn btn-primary" id="f-save">Opslaan</button> </div> </div> `);
  bindSourceSelect($('#modal [data-source]'));
  // Gesprek meteen naar het nieuwste bericht scrollen.
  const chat = $('#f-chat'); if (chat) chat.scrollTop = chat.scrollHeight;
  if (o) $('#f-reply').onclick = () => openReplyModal({ name: o.customer?.name, email: o.customer?.email, phone: o.customer?.phone, orderId: o.id, title: o.title, thread: o.thread || [] });
  if (o && canWrite) $('#f-merge').onclick = () => openMergeModal(o);
  if (o && canWrite) $('#f-send-monteur').onclick = () => openSendMonteurModal(o);

  // Bijlagen toevoegen
  if (o) {
    const fileInput = $('#f-fileinput');
    $('#f-addfile').onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      const files = [...fileInput.files];
      if (!files.length) return;
      toast(`${files.length} bestand(en) uploaden…`);
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
        } catch (err) { toast(err.message, true); }
      }
      $('#f-attachgrid').innerHTML = attachmentsHTML(o.attachments);
      flash('#f-attachgrid');
      toast('Toegevoegd ');
      loadBoard();
    };
  }

  $('#f-cancel').onclick = closeModal;
  $('#f-save').onclick = async () => {
    const payload = {
      status: $('#f-status').value,
      appointmentAt: $('#f-appt').value || null,
      notes: $('#f-notes').value,
    };
    if (canWrite) {
      payload.title = $('#f-title').value;
      payload.monteurId = $('#f-monteur').value || null;
      payload.price = $('#f-price').value;
      payload.source = $('#modal [data-source]')?.value || 'Handmatig';
      payload.urgent = $('#f-urgent')?.checked || false;
    }
    try {
      if (o) {
        await api(`/api/orders/${o.id}`, 'PATCH', payload);
        // Klantgegevens (naam/telefoon/e-mail/adres) van de gekoppelde klant bijwerken.
        if (canWrite && o.customer) {
          const cp = { name: $('#f-ccname')?.value, phone: $('#f-ccphone')?.value, email: $('#f-ccemail')?.value, address: $('#f-ccaddress')?.value };
          await api(`/api/customers/${o.customer.id}`, 'PATCH', cp).catch(() => {});
        }
      } else {
        payload.customerName = $('#f-cname').value;
        payload.customerPhone = $('#f-cphone').value;
        payload.customerEmail = $('#f-cemail').value;
        if (!payload.title) return toast('Titel verplicht', true);
        if (!payload.customerName && !payload.customerPhone) return toast('Klantnaam of telefoon verplicht', true);
        await api('/api/orders', 'POST', payload);
      }
      closeModal(); toast('Opgeslagen'); loadBoard();
    } catch (err) { toast(err.message, true); }
  };
  if (o && canWrite) $('#f-delete').onclick = async () => {
    if (!confirm('Opdracht verwijderen?')) return;
    try { await api(`/api/orders/${o.id}`, 'DELETE'); closeModal(); toast('Verwijderd'); loadBoard(); }
    catch (err) { toast(err.message, true); }
  };
}

// ---------- Inbox / reviews ----------
async function refreshInboxBadge() {
  try {
    const stats = await api('/api/stats');
    const badge = $('#inboxBadge');
    if (badge) { badge.textContent = stats.pendingReviews; badge.hidden = stats.pendingReviews === 0; }
  } catch {}
}

async function loadInbox() {
  const filter = $('#inboxFilter')?.value || 'pending';
  const reviews = await api('/api/reviews?status=' + filter);
  const list = $('#reviewList');
  const bulkBar = $('#bulkBar');
  // Bulk-balk en "alle geklets afwijzen"-knop alleen tonen wanneer relevant.
  if (bulkBar && state.me.role !== 'monteur') bulkBar.hidden = reviews.length === 0;
  // Op de prullenbak-weergave verbergen we approve/afwijs-acties; toon evt. 'legen'.
  const inTrash = filter === 'rejected';
  ['#bulkApproveBtn', '#bulkApprovePct', '#bulkRejectBtn', '#rejectAllOverigeBtn', '#rejectAllPendingBtn'].forEach((sel) => { const e = $(sel); if (e) e.style.display = inTrash ? 'none' : (sel.includes('Overige') ? (filter === 'overige' ? '' : 'none') : sel.includes('Pending') ? (filter === 'pending' ? '' : 'none') : ''); });
  if ($('#emptyRejectedBtn')) $('#emptyRejectedBtn').style.display = (inTrash && state.me.role === 'admin') ? '' : 'none';
  if ($('#selectAll')) $('#selectAll').checked = false;
  updateBulkCount();
  if (!reviews.length) {
    if (bulkBar) bulkBar.hidden = true;
    list.innerHTML = filter === 'rejected'
      ? '<div class="empty">De inbox-prullenbak is leeg.</div>'
      : filter === 'overige'
      ? '<div class="empty">Geen overige berichten (geklets).</div>'
      : '<div class="empty">Geen berichten om te controleren. Goed bezig!</div>';
    return;
  }
  list.innerHTML = reviews.map(reviewHTML).join('');
  reviews.forEach((r) => bindReview(r));
  $$('.r-select').forEach((c) => c.addEventListener('change', updateBulkCount));
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
    <div class="review" data-id="${r.id}" style="border-left-color:${esc(statusColor(s.status))}"> <div class="review-top"> <div> <label class="bulk-check" style="margin-right:8px"><input type="checkbox" class="r-select" data-id="${r.id}"></label><strong>${sourceIcon(r.channel)} ${esc(m.sender || 'Onbekend')}</strong> ${m.group ? `<span class="chip src-groep">${icon('users', 13)} ${esc(m.group)}</span>` : ''}
          <div class="muted small">${esc(m.subject || '')} · ${fmtDate(m.receivedAt)}</div> </div> <div class="small muted" style="text-align:right">AI-zekerheid ${conf}%<br> <span class="confidence"><div style="width:${conf}%;background:${conf>=70?'#10b981':conf>=40?'#f59e0b':'#ef4444'}"></div></span> <div>${esc(s.engine || '')}</div> </div> </div> ${s.aiNotOrder ? '<div class="not-order-warn">⚠ AI denkt dat dit GEEN klantopdracht is (bv. incasso/leverancier/reclame)</div>' : ''} <div class="review-msg">${esc(m.body || '')}</div> <div class="small"><strong>AI herkende:</strong> ${esc(s.reasoning || '')}${s.aiStatus && s.aiStatus !== s.status ? ` <em>(AI-categorie: ${esc(statusLabel(s.aiStatus))})</em>` : ''}</div> <div class="review-actions"> <label class="small" style="margin:0">Kolom<select class="r-status" style="margin-top:3px">${statusOptionsHTML(s.status)}</select></label> <label class="small" style="margin:0">Klant<input class="r-cname" value="${esc(s.customerName || '')}" style="margin-top:3px"></label> <label class="small" style="margin:0">Telefoon<input class="r-cphone" value="${esc(s.customerPhone || '')}" style="margin-top:3px"></label> <label class="small" style="margin:0">E-mail<input class="r-cemail" value="${esc(s.customerEmail || '')}" style="margin-top:3px"></label> <label class="small" style="margin:0">Adres<input class="r-caddress" value="${esc(s.customerAddress || '')}" style="margin-top:3px"></label> <label class="small" style="margin:0">Herkomst${sourceSelect(defaultSource, 'r-source')}</label> <label class="small" style="margin:0">Monteur<select class="r-monteur" style="margin-top:3px">${monteurOpts}</select></label> </div> <label class="small" style="margin:10px 0 0">Probleem / omschrijving<textarea class="r-problem" rows="2" style="margin-top:3px">${esc(s.problem || '')}</textarea></label> <div class="review-actions" style="margin-top:10px">${r.status === 'rejected'
      ? `<button class="btn r-restore">${icon('reply', 14)} Terugzetten</button>${state.me.role === 'admin' ? '<button class="btn btn-danger r-perm">Definitief verwijderen</button>' : ''}`
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
function renderCustomers() {
  const q = ($('#customerSearch').value || '').toLowerCase();
  const list = (state._customers || []).filter((c) => !q || `${c.name} ${c.phone} ${c.email}`.toLowerCase().includes(q));
  const canWrite = state.me.role !== 'monteur';
  $('#customerList').innerHTML = `
    <table><thead><tr> <th>Naam</th><th>Type</th><th>Telefoon</th><th>E-mail</th><th>Herkomst</th><th>Opdrachten</th>${canWrite ? '<th></th>' : ''}
    </tr></thead><tbody> ${list.map((c) => { const sm = sourceMeta(c.source); return `<tr> <td><strong>${esc(c.name)}</strong>${c.address ? `<div class="muted small">${esc(c.address)}</div>` : ''}</td> <td><span class="tag ${c.type === 'lead' ? 'lead' : 'klant'}">${esc(c.type)}</span></td> <td>${esc(c.phone || '')}</td><td>${esc(c.email || '')}</td> <td><span class="chip ${sm.cls}">${sm.icon} ${esc(c.source || '')}</span></td> <td>${c.orderCount}</td> ${canWrite ? `<td><button class="btn btn-sm" data-edit="${c.id}">Bewerk</button></td>` : ''}
    </tr>`; }).join('') || `<tr><td colspan="7" class="empty">Geen klanten</td></tr>`}
    </tbody></table>`;
  $$('[data-edit]').forEach((b) => b.onclick = () => openCustomerModal(state._customers.find((c) => c.id === b.dataset.edit)));
}
function openCustomerModal(c) {
  modal(`
    <h2>${c ? 'Klant bewerken' : 'Nieuwe klant'}</h2> <label>Naam <input id="c-name" value="${esc(c?.name || '')}"></label> <div class="row"> <label>Telefoon <input id="c-phone" value="${esc(c?.phone || '')}"></label> <label>E-mail <input id="c-email" value="${esc(c?.email || '')}"></label> </div> <label>Adres <input id="c-address" value="${esc(c?.address || '')}"></label> <label>Type <select id="c-type"> <option value="lead" ${c?.type==='lead'?'selected':''}>Lead</option> <option value="klant" ${c?.type==='klant'?'selected':''}>Klant</option> </select></label> <label>Notities <textarea id="c-notes" rows="2">${esc(c?.notes || '')}</textarea></label> <div class="modal-actions"> ${c ? '<button class="btn btn-danger" id="c-del">Verwijderen</button>' : '<span></span>'}
      <div class="right"><button class="btn" id="c-cancel">Annuleren</button><button class="btn btn-primary" id="c-save">Opslaan</button></div> </div>`);
  $('#c-cancel').onclick = closeModal;
  $('#c-save').onclick = async () => {
    const payload = { name: $('#c-name').value, phone: $('#c-phone').value, email: $('#c-email').value, address: $('#c-address').value, type: $('#c-type').value, notes: $('#c-notes').value };
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
        <span class="chip">${m.activeCount} actief</span>
        <span class="chip">${m.sentCount || 0} verstuurd</span>
        <span class="chip">${m.doneCount || 0} afgerond</span>
      </div>
      ${m.upcoming && m.upcoming.length ? `<div style="margin-top:12px"><div class="muted small" style="font-weight:500;margin-bottom:4px">Komende afspraken</div>${m.upcoming.slice(0, 5).map((o) => `<div class="mont-line" data-open="${o.id}"><strong>${esc(fmtAppt(o.at))}</strong> — ${esc(o.title)} <span class="muted">· ${esc(o.statusLabel)}</span></div>`).join('')}</div>` : ''}
      ${m.orders && m.orders.length ? `<details style="margin-top:10px"><summary class="muted small" style="cursor:pointer">Alle ${m.orders.length} actieve opdrachten</summary>${m.orders.map((o) => `<div class="mont-line" data-open="${o.id}">${esc(o.title)} <span class="muted">· ${esc(o.statusLabel)}${o.appointmentAt ? ' · ' + esc(fmtAppt(o.appointmentAt)) : ''}</span></div>`).join('')}</details>` : ''}
      ${canWrite ? `<div style="margin-top:12px"><button class="btn btn-sm" data-medit="${m.id}">Bewerk</button> <button class="btn btn-sm btn-danger" data-mdel="${m.id}">Verwijder</button></div>` : ''}
    </div>`).join('') || '<div class="empty">Nog geen monteurs</div>';
  $$('#monteurList .mont-line[data-open]').forEach((el) => el.onclick = async () => { if (!state.orders.length) state.orders = await api('/api/orders'); markSeen(el.dataset.open); openOrderModal(el.dataset.open); });
  $$('[data-medit]').forEach((b) => b.onclick = () => openMonteurModal(state.monteurs.find((m) => m.id === b.dataset.medit)));
  $$('[data-mdel]').forEach((b) => b.onclick = async () => {
    if (!confirm('Monteur verwijderen?')) return;
    try { await api(`/api/monteurs/${b.dataset.mdel}`, 'DELETE'); toast('Verwijderd'); loadMonteurs(); }
    catch (err) { toast(err.message, true); }
  });
}

// ---------- Prullenbak ----------
// ---------- AI Assistent (vraagbaak) ----------
async function loadAssistant() {
  const groups = await api('/api/assistant/groups').catch(() => []);
  const examples = [
    'Hoeveel omzet is er genoemd in de groep van Youssef de afgelopen 30 dagen?',
    'Wat is er besproken over de schuifpui-opdracht van mevrouw Jansen?',
    'Welke klussen zijn deze week afgerond volgens de groepsberichten?',
    'Welke afspraken zijn er genoemd voor komende week?',
  ];
  $('#assistantPanel').innerHTML = `
    <div class="info-card">
      <div class="row">
        <label>Zoeken in groep <select id="as-group"><option value="">Alle groepen + e-mail</option>${groups.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}</select></label>
        <label>Periode <select id="as-days"><option value="0">Alles</option><option value="7">laatste 7 dagen</option><option value="30" selected>laatste 30 dagen</option><option value="90">laatste 90 dagen</option></select></label>
      </div>
      <label>Je vraag <textarea id="as-q" rows="3" placeholder="bv. Hoeveel omzet is er verstuurd in de groep van Youssef?"></textarea></label>
      <div class="as-examples">${examples.map((e) => `<button type="button" class="chip as-ex">${esc(e)}</button>`).join('')}</div>
      <div style="margin-top:12px"><button class="btn btn-primary" id="as-ask">${icon('sparkles', 14)} Vraag de AI</button></div>
      <div id="as-answer" style="margin-top:16px"></div>
    </div>
    <div class="info-card" style="margin-top:18px">
      <h3>${icon('activity', 15)} AI-statusscan</h3>
      <p class="muted small">De AI leest de recente groepsberichten (monteur-rapportages) en stelt statuswijzigingen voor op lopende opdrachten. Jij keurt elke wijziging zelf goed — er gebeurt niets automatisch.</p>
      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
        <label style="margin:0">Periode <select id="ss-days"><option value="7">laatste 7 dagen</option><option value="14" selected>laatste 14 dagen</option><option value="30">laatste 30 dagen</option></select></label>
        <button class="btn btn-primary" id="ss-run">Statusscan starten</button>
      </div>
      <div id="ss-result" style="margin-top:14px"></div>
    </div>`;
  $$('.as-ex').forEach((b) => b.onclick = () => { $('#as-q').value = b.textContent; });
  $('#ss-run').onclick = async () => {
    const btn = $('#ss-run'); btn.disabled = true; btn.textContent = 'Bezig met scannen…';
    $('#ss-result').innerHTML = '<div class="muted small">De AI leest de groepsberichten… ~10-30 sec.</div>';
    try {
      const out = await api('/api/assistant/status-scan', 'POST', { days: Number($('#ss-days').value) });
      const sugg = out.suggestions || [];
      if (!sugg.length) {
        $('#ss-result').innerHTML = `<div class="muted small">${esc(out.note || 'Geen statuswijzigingen voorgesteld.')}</div>`;
      } else {
        $('#ss-result').innerHTML = sugg.map((s, i) => `
          <div class="ss-item" data-i="${i}">
            <div><strong>${esc(s.title)}</strong>: ${esc(s.fromLabel)} → <strong>${esc(s.toLabel)}</strong></div>
            <div class="muted small">${esc(s.reason)}</div>
            ${s.evidence ? `<div class="muted small" style="font-style:italic">"${esc(s.evidence.slice(0, 160))}"</div>` : ''}
            <div style="margin-top:6px;display:flex;gap:6px"><button class="btn btn-sm btn-success ss-apply" data-id="${s.orderId}" data-to="${esc(s.to)}">Toepassen</button><button class="btn btn-sm ss-ignore">Negeren</button></div>
          </div>`).join('');
        $$('.ss-apply').forEach((b) => b.onclick = async () => {
          try { await api(`/api/orders/${b.dataset.id}`, 'PATCH', { status: b.dataset.to }); toast('Status bijgewerkt'); b.closest('.ss-item').remove(); loadBoard(); }
          catch (err) { toast(err.message, true); }
        });
        $$('.ss-ignore').forEach((b) => b.onclick = () => b.closest('.ss-item').remove());
      }
    } catch (err) { $('#ss-result').innerHTML = `<div class="error small">${esc(err.message)}</div>`; }
    btn.disabled = false; btn.textContent = 'Statusscan starten';
  };
  $('#as-ask').onclick = async () => {
    const question = $('#as-q').value.trim();
    if (!question) return toast('Stel eerst een vraag', true);
    const btn = $('#as-ask'); btn.disabled = true; btn.innerHTML = 'Bezig met zoeken…';
    $('#as-answer').innerHTML = '<div class="muted small">De AI doorzoekt de berichten… dit kan ~10-30 sec duren.</div>';
    try {
      const out = await api('/api/assistant/ask', 'POST', { question, group: $('#as-group').value, days: Number($('#as-days').value) });
      $('#as-answer').innerHTML = `<div class="analysis-box">${esc(out.text).replace(/\n/g, '<br>')}</div>${out.searched ? `<div class="muted small" style="margin-top:6px">Doorzocht: ${out.searched} berichten · ${esc(out.engine || '')}</div>` : ''}`;
    } catch (err) { $('#as-answer').innerHTML = `<div class="error small">${esc(err.message)}</div>`; }
    btn.disabled = false; btn.innerHTML = `${icon('sparkles', 14)} Vraag de AI`;
  };
}

// ---------- Agenda ----------
async function loadAgenda() {
  const [agenda, orders] = await Promise.all([api('/api/agenda'), api('/api/orders')]);
  state._agenda = agenda;
  state.orders = orders; // zodat het openen van een kaart de volledige opdracht heeft
  renderAgenda();
}
function renderAgenda() {
  const scope = $('#agendaScope')?.value || 'drs';
  let items = state._agenda || [];
  if (scope === 'drs') items = items.filter((a) => a.isDrs);
  const wrap = $('#agendaList');
  if (!items.length) { wrap.innerHTML = '<div class="empty">Geen afspraken gepland.</div>'; return; }
  // Groeperen per dag (datum als sleutel).
  const fmtDay = (d) => new Date(d).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
  const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
  const fmtTime = (d) => new Date(d).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  const todayKey = new Date().toISOString().slice(0, 10);
  const groups = {};
  for (const a of items) { const k = dayKey(a.at); (groups[k] = groups[k] || []).push(a); }
  wrap.innerHTML = Object.keys(groups).sort().map((k) => `
    <div class="agenda-day">
      <div class="agenda-day-head">${k === todayKey ? '<span class="agenda-today">Vandaag</span> ' : ''}${esc(fmtDay(k))}<span class="count">${groups[k].length}</span></div>
      ${groups[k].map((a) => `
        <div class="agenda-item" data-open="${a.id}">
          <div class="agenda-time">${esc(fmtTime(a.at))}</div>
          <div class="agenda-body">
            <div class="agenda-title"><span class="dot" style="background:${esc(statusColor(a.status))}"></span>${esc(a.title)} ${a.isDrs ? '<span class="chip src-whatsapp">DRS</span>' : ''}</div>
            <div class="muted small">${esc(a.customer || '')}${a.phone ? ' · ' + esc(a.phone) : ''}${a.address ? ' · ' + esc(a.address) : ''}</div>
            <div class="muted small">${esc(a.statusLabel)}${a.monteur ? ' · monteur ' + esc(a.monteur) : ' · geen monteur'}</div>
          </div>
        </div>`).join('')}
    </div>`).join('');
  $$('.agenda-item[data-open]').forEach((el) => el.onclick = () => { markSeen(el.dataset.open); openOrderModal(el.dataset.open); });
}

async function loadTrash() {
  state._trash = await api('/api/trash');
  renderTrash();
}
function renderTrash() {
  const isAdmin = state.me.role === 'admin';
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

function openMonteurModal(m) {
  modal(`
    <h2>${m ? 'Monteur bewerken' : 'Nieuwe monteur'}</h2> <label>Naam <input id="m-name" value="${esc(m?.name || '')}"></label> <div class="row"> <label>Telefoon <input id="m-phone" value="${esc(m?.phone || '')}"></label> <label>E-mail <input id="m-email" value="${esc(m?.email || '')}"></label> </div> <label>WhatsApp-groep (voor opdrachten) <input id="m-wagroup" value="${esc(m?.waGroup || '')}" placeholder="exacte naam van de WhatsApp-groep"></label> <div class="modal-actions"><span></span><div class="right"> <button class="btn" id="m-cancel">Annuleren</button><button class="btn btn-primary" id="m-save">Opslaan</button> </div></div>`);
  $('#m-cancel').onclick = closeModal;
  $('#m-save').onclick = async () => {
    const payload = { name: $('#m-name').value, phone: $('#m-phone').value, email: $('#m-email').value, waGroup: $('#m-wagroup').value };
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

// ---------- Abonnementen & verbruik ----------
async function loadSubs() {
  const d = await api('/api/subscriptions');
  const u = d.usage;
  $('#subsPanel').innerHTML = `
    <div class="stat-grid"> <div class="stat"><div class="num">${u.calls}</div><div class="lbl">AI-aanroepen deze maand (${esc(u.month)})</div></div> <div class="stat"><div class="num">$${u.estimatedCostUsd.toFixed(2)}</div><div class="lbl">Geschatte AI-kosten (indicatie)</div></div> <div class="stat"><div class="num">${(u.inputTokens + u.outputTokens).toLocaleString('nl-NL')}</div><div class="lbl">Tokens verbruikt</div></div> </div> <p class="muted small" style="margin:-6px 0 16px">De AI-kosten zijn een <strong>schatting</strong> van het verbruik via dit dashboard. Het officiële verbruik/tegoed zie je in de Claude Console.</p> <div class="card-grid"> ${d.services.map((s) => `
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
    <div class="info-card" style="margin-bottom:18px"> <h3>Hoe alles werkt &amp; is verbonden</h3>
      <p class="muted small">Een overzicht van alle routes waarlangs opdrachten binnenkomen en hoe ze in het dashboard belanden.</p>
      <div class="flow-box">
        <div class="flow-line"><strong>E-mail:</strong> klant / website-formulier → <code>info@keyservice247.nl</code> → (assistent stuurt door / wordt opgehaald) → <strong>IMAP</strong> leest mailbox <code>${esc(s.imapAddress || 'niet ingesteld')}</code> → AI deelt in → <strong>Inbox / AI</strong> → goedkeuren → kaart in <strong>Opdrachten</strong>.</div>
        <div class="flow-line"><strong>WhatsApp:</strong> klant/groep → wegwerp-nummer (iPhone) → <strong>bridge op VPS</strong> → dashboard → AI deelt in → Inbox. <em>Opdrachten worden alleen uit de ingestelde groep(en) gehaald (zie hieronder).</em></div>
        <div class="flow-line"><strong>Antwoorden:</strong> "Snel antwoord" op een kaart → verstuurd via SMTP vanaf <code>${esc(s.sendAddress || 'niet ingesteld')}</code> → komt in de gesprekshistorie. Mail je buiten het dashboard om? Dan wordt die uit je Verzonden-map opgehaald en alsnog bij de kaart gezet.</div>
        <div class="flow-line"><strong>Naar monteur:</strong> kaart → "Stuur naar monteur" (of automatisch) → wachtrij → bridge → WhatsApp-groep van de monteur.</div>
      </div>
      <p class="muted small" style="margin-top:10px">Verzendadres (SMTP): <strong>${esc(s.sendAddress || 'niet ingesteld in Render')}</strong> · Inkomende mailbox (IMAP): <strong>${esc(s.imapAddress || 'niet ingesteld')}</strong></p>
    </div>
    <div class="info-card" style="margin-bottom:18px"> <h3>Back-ups &amp; veiligheid</h3>
      <p class="muted small">Alle gegevens staan op de blijvende schijf van de server en worden <strong>automatisch elke 6 uur</strong> geback-upt (laatste 60 bewaard). Maak af en toe ook een kopie op je eigen computer — dan ben je veilig, zelfs als de server uitvalt.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <a class="btn btn-primary" href="/api/backup/download">Download back-up (kopie op je pc)</a>
        <button class="btn" id="backupNow">Nu een back-up maken</button>
      </div>
      <div id="backupList" class="muted small" style="margin-top:12px">Back-ups laden…</div>
    </div>
    <div class="info-card" style="margin-bottom:18px"> <h3>WhatsApp: uit welke groep(en) opdrachten?</h3> <p class="muted small">Alleen berichten uit deze groep(en) worden opdrachten (bv. de DRS / "Raf Breda"-groep). Berichten uit andere groepen gaan naar <strong>Overige</strong> en worden nooit een kaart. Meerdere namen? Scheid met komma's. Leeg = alle groepen.</p> <input id="waOrderGroups" type="text" value="${esc(s.whatsappOrderGroups || '')}" placeholder="bv. Raf Breda, DRS"> <div style="margin-top:12px"><button class="btn btn-primary" id="saveWaGroups">Opslaan</button></div> </div>
    <div class="info-card" style="margin-bottom:18px"> <h3>E-mail handtekening</h3> <p class="muted small">Komt automatisch onder elke mail die je vanuit het dashboard verstuurt. Strak en professioneel.</p> <textarea id="emailSignature" rows="4" style="margin-top:6px">${esc(s.emailSignature || '')}</textarea> <div style="margin-top:12px"><button class="btn btn-primary" id="saveSignature">Handtekening opslaan</button></div> </div>
    <div class="info-card" style="margin-bottom:18px"> <h3>Bedrijfsprofiel — wat de AI over jullie moet weten</h3> <p class="muted small">Beschrijf hoe Keyservice werkt: diensten, prijzen, aanpak, toon. De AI krijgt dit bij ELKE aanvraag en elk concept-antwoord mee, zodat het past bij jullie werkwijze.</p> <textarea id="companyProfile" rows="8" style="margin-top:6px">${esc(s.companyProfile || '')}</textarea> <div style="margin-top:12px"><button class="btn btn-primary" id="saveProfile">Bedrijfsprofiel opslaan</button></div> </div>
    <div class="info-card" style="margin-bottom:18px"> <h3>Verkeer analyseren</h3> <p class="muted small">Laat de AI het binnengekomen WhatsApp/e-mail-verkeer bestuderen: veelgevraagde diensten, terugkerende patronen en verbeterpunten. (Kost een paar cent per analyse.)</p> <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"> <label style="margin:0">Periode <select id="analyzeDays" style="margin-top:3px"><option value="7">laatste 7 dagen</option><option value="30" selected>laatste 30 dagen</option><option value="90">laatste 90 dagen</option></select></label> <button class="btn btn-primary" id="runAnalyze" style="align-self:flex-end">Analyse starten</button> </div> <div id="analyzeResult" style="margin-top:14px"></div> </div>
    <div class="info-card" style="margin-bottom:18px"> <h3>AI laten leren filteren</h3> <p class="muted small">Laat de AI uit het echte verkeer afleiden wat wél en niet een opdracht is, en voeg die filterregels toe aan het bedrijfsprofiel. Daarna filtert de inbox scherper.</p> <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"> <label style="margin:0">Periode <select id="learnDays" style="margin-top:3px"><option value="7">laatste 7 dagen</option><option value="30" selected>laatste 30 dagen</option><option value="90">laatste 90 dagen</option></select></label> <button class="btn btn-primary" id="runLearn" style="align-self:flex-end">Filterregels leren &amp; toevoegen</button> </div> <div id="learnResult" style="margin-top:14px"></div> </div>
    <div class="info-card" style="margin-bottom:18px"> <h3>Opdrachten naar monteur (WhatsApp)</h3> <p class="muted small">Stuur opdrachten naar de WhatsApp-groep van een monteur. Handmatig via de knop op een kaart, of automatisch volgens onderstaande regels. Koppel eerst per monteur een WhatsApp-groep (bij Monteurs).</p>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="md-auto" style="width:auto"> Automatisch versturen aanzetten</label>
      <div class="row"> <label>Welke monteur (auto) <select id="md-monteur"></select></label> <label>Wanneer <select id="md-trigger"><option value="approved">zodra ik de opdracht goedkeur</option><option value="appointment">zodra een afspraak is ingepland</option><option value="intake">volautomatisch — meteen bij binnenkomst</option></select></label> </div>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row;margin-top:6px"><input type="checkbox" id="md-onlydrs" style="width:auto"> Alleen opdrachten uit de DRS / Raf Breda-groep</label>
      <p class="muted small" id="md-hint" style="margin:6px 0 0"></p>
      <label style="margin:10px 0 4px">Alleen op deze dagen versturen</label>
      <div id="md-days" style="display:flex;gap:6px;flex-wrap:wrap"></div>
      <div style="margin-top:12px"><button class="btn btn-primary" id="md-save">Verstuur-instellingen opslaan</button></div>
    </div>
    <div class="settings-grid"> <div class="info-card"> <h3>Kolommen (statussen)</h3> <p class="muted small">Sleep niet — gebruik de volgorde van boven naar beneden. Wijzig naam of kleur, voeg toe of verwijder.</p> <div id="statusRows"></div> <button class="btn btn-sm" id="addStatus">+ Kolom toevoegen</button> <div style="margin-top:14px"><button class="btn btn-primary" id="saveStatuses">Kolommen opslaan</button></div> </div> <div class="info-card"> <h3>Herkomst-bronnen</h3> <p class="muted small">De plekken waar opdrachten vandaan komen (bv. Keyservice e-mail, DRS WhatsApp groep).</p> <div id="sourceRows"></div> <button class="btn btn-sm" id="addSource">+ Bron toevoegen</button> <div style="margin-top:14px"><button class="btn btn-primary" id="saveSources">Bronnen opslaan</button></div> </div> </div> <div class="info-card" style="margin-top:18px"> <h3>Snelle standaardantwoorden</h3> <p class="muted small">Vaste teksten (offertes, info-verzoeken, opvolging) die je team met één klik gebruikt bij een bericht.</p> <div id="tmplRows"></div> <button class="btn btn-sm" id="addTmpl">+ Sjabloon toevoegen</button> <div style="margin-top:14px"><button class="btn btn-primary" id="saveTmpls">Sjablonen opslaan</button></div> </div>`;

  $('#saveProfile').onclick = async () => {
    try { await api('/api/settings', 'PATCH', { companyProfile: $('#companyProfile').value }); toast('Bedrijfsprofiel opgeslagen'); }
    catch (err) { toast(err.message, true); }
  };
  $('#saveWaGroups').onclick = async () => {
    try { await api('/api/settings', 'PATCH', { whatsappOrderGroups: $('#waOrderGroups').value }); toast('WhatsApp opdracht-groepen opgeslagen'); }
    catch (err) { toast(err.message, true); }
  };
  $('#saveSignature').onclick = async () => {
    try { await api('/api/settings', 'PATCH', { emailSignature: $('#emailSignature').value }); await refreshMeta(); toast('Handtekening opgeslagen'); }
    catch (err) { toast(err.message, true); }
  };
  const loadBackups = async () => {
    try {
      const r = await api('/api/backups');
      const list = r.backups || [];
      $('#backupList').innerHTML = list.length
        ? `Laatste back-ups (${list.length}):<br>` + list.slice(0, 6).map((b) => `· ${esc(fmtDate(b.at))} — ${(b.size / 1024).toFixed(0)} kB`).join('<br>')
        : 'Nog geen back-ups (de eerste wordt automatisch gemaakt).';
    } catch { $('#backupList').textContent = ''; }
  };
  loadBackups();
  $('#backupNow').onclick = async () => {
    try { await api('/api/backups/now', 'POST'); toast('Back-up gemaakt'); loadBackups(); }
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
  $('#md-monteur').innerHTML = '<option value="">— kies monteur —</option>' + mons.map((m) => `<option value="${m.id}" ${md.autoMonteurId === m.id ? 'selected' : ''}>${esc(m.name)}${m.waGroup ? '' : ' (geen groep!)'}</option>`).join('');
  // dagen als knopjes
  const dayNames = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
  $('#md-days').innerHTML = dayNames.map((d, i) => `<button type="button" class="day-toggle ${(md.days || []).includes(i) ? 'on' : ''}" data-day="${i}">${d}</button>`).join('');
  $$('#md-days .day-toggle').forEach((b) => b.onclick = () => b.classList.toggle('on'));
  $('#md-save').onclick = async () => {
    const days = $$('#md-days .day-toggle.on').map((b) => Number(b.dataset.day));
    const cfg = { autoEnabled: $('#md-auto').checked, days, autoMonteurId: $('#md-monteur').value, trigger: $('#md-trigger').value, onlyDrs: $('#md-onlydrs').checked };
    if (cfg.autoEnabled && !cfg.autoMonteurId) return toast('Kies eerst een monteur', true);
    if (cfg.autoEnabled && !days.length) return toast('Kies minstens één dag (anders wordt er nooit verstuurd)', true);
    try { await api('/api/settings', 'PATCH', { monteurDispatch: cfg }); toast('Verstuur-instellingen opgeslagen'); }
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

// ---------- Users (admin) ----------
async function loadUsers() {
  const users = await api('/api/users');
  $('#userList').innerHTML = `
    <table><thead><tr><th>Naam</th><th>E-mail</th><th>Rol</th><th></th></tr></thead><tbody> ${users.map((u) => `<tr> <td><strong>${esc(u.name)}</strong></td><td>${esc(u.email)}</td> <td><span class="tag ${esc(u.role)}">${esc(u.role)}</span></td> <td>${u.id !== state.me.id ? `<button class="btn btn-sm btn-danger" data-udel="${u.id}">Verwijder</button>` : '<span class="muted small">jij</span>'}</td> </tr>`).join('')}
    </tbody></table>`;
  $$('[data-udel]').forEach((b) => b.onclick = async () => {
    if (!confirm('Gebruiker verwijderen?')) return;
    try { await api(`/api/users/${b.dataset.udel}`, 'DELETE'); toast('Verwijderd'); loadUsers(); }
    catch (err) { toast(err.message, true); }
  });
}
function openUserModal() {
  modal(`
    <h2>Nieuwe gebruiker</h2> <label>Naam <input id="u-name"></label> <label>E-mail <input id="u-email" type="email"></label> <label>Wachtwoord <input id="u-pass" type="text" placeholder="minimaal 6 tekens"></label> <label>Rol <select id="u-role"> <option value="assistent">Assistent (alles behalve gebruikersbeheer)</option> <option value="monteur">Monteur (alleen opdrachten bekijken/bijwerken)</option> <option value="admin">Admin (volledige toegang)</option> </select></label> <div class="modal-actions"><span></span><div class="right"> <button class="btn" id="u-cancel">Annuleren</button><button class="btn btn-primary" id="u-save">Aanmaken</button> </div></div>`);
  $('#u-cancel').onclick = closeModal;
  $('#u-save').onclick = async () => {
    const payload = { name: $('#u-name').value, email: $('#u-email').value, password: $('#u-pass').value, role: $('#u-role').value };
    if (!payload.name || !payload.email || payload.password.length < 6) return toast('Vul alles in (wachtwoord min. 6 tekens)', true);
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
    <div class="modal-actions"><span></span><div class="right"><button class="btn btn-primary" id="dg-close">Sluiten</button></div></div> `);
  $('#dg-close').onclick = closeModal;
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
  $('#newCustomerBtn')?.addEventListener('click', () => openCustomerModal());
  $('#newMonteurBtn')?.addEventListener('click', () => openMonteurModal());
  $('#newUserBtn')?.addEventListener('click', () => openUserModal());
  $('#simulateBtn')?.addEventListener('click', () => openSimulateModal());
  $('#boardSearch')?.addEventListener('input', renderBoard);
  $('#boardMonteurFilter')?.addEventListener('change', renderBoard);
  $('#customerSearch')?.addEventListener('input', renderCustomers);
  $('#trashSearch')?.addEventListener('input', renderTrash);
  $('#agendaScope')?.addEventListener('change', renderAgenda);
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
  $('#collapseBtn')?.addEventListener('click', async () => {
    const naam = state.channel === 'email' ? 'E-mail' : state.channel === 'whatsapp' ? 'WhatsApp' : 'Alle';
    const visible = filteredOrders().length;
    if (!visible) return toast('Er staan geen kaarten om in te klappen', true);
    if (!confirm(`${visible} kaart(en) van "${naam}" nu inklappen in een gedateerde bundel? Het bord wordt leeg; je vindt ze terug onder "Ingeklapte agenda's" en kunt ze altijd weer openen.`)) return;
    try {
      const r = await api('/api/archives/collapse', 'POST', { channel: state.channel });
      toast(r.count ? `${r.count} kaart(en) ingeklapt` : 'Niets ingeklapt');
      loadBoard();
    } catch (err) { toast(err.message, true); }
  });
  $('#boardBulkDelete')?.addEventListener('click', async () => {
    const ids = selectedCardIds();
    if (!ids.length) return;
    if (!confirm(`${ids.length} kaart(en) naar de prullenbak verplaatsen?`)) return;
    try { for (const id of ids) await api(`/api/orders/${id}`, 'DELETE'); toast(`${ids.length} naar prullenbak`); loadBoard(); }
    catch (err) { toast(err.message, true); }
  });
  $('#boardBulkClear')?.addEventListener('click', () => { $$('.card-check').forEach((c) => (c.checked = false)); updateBoardBulk(); });
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
  $('.modal-backdrop').onclick = closeModal;
}
function closeModal() { $('#modalRoot').hidden = true; $('#modal').innerHTML = ''; }
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

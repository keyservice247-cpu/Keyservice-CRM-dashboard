// ---------- Helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

// Herkomst-bron: icoon + kleurklasse op basis van trefwoorden in de naam.
function sourceMeta(label) {
  const l = (label || '').toLowerCase();
  if (l.includes('groep')) return { icon: '👥', cls: 'src-groep' };
  if (l.includes('whatsapp') || l.includes('app')) return { icon: '💬', cls: 'src-whatsapp' };
  if (l.includes('mail')) return { icon: '✉️', cls: 'src-email' };
  if (l.includes('telefoon') || l.includes('bel')) return { icon: '📞', cls: 'src-telefoon' };
  return { icon: '🏷️', cls: '' };
}

// ---------- State ----------
const state = { me: null, meta: null, monteurs: [], orders: [], view: 'board' };

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
  $('#aiMode').textContent = me.meta.aiMode === 'ai' ? '🤖 AI actief' : '⚙️ AI: demo';

  if (me.user.role !== 'admin') $$('.admin-only').forEach((el) => el.remove());
  if (me.user.role === 'monteur') $$('.perm-write').forEach((el) => (el.hidden = true));

  bindNav();
  bindButtons();
  await refreshAll();
  setInterval(refreshInboxBadge, 20000);
})();

async function refreshMeta() {
  const me = await api('/api/me');
  if (me && me.meta) state.meta = me.meta;
}

function bindNav() {
  $$('.nav-item').forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.view)));
  $('#logoutBtn').addEventListener('click', async () => { await api('/api/logout', 'POST'); window.location.href = '/'; });
  $('#accountBtn').addEventListener('click', openAccountModal);
}

function showView(view) {
  state.view = view;
  $$('.nav-item').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  $$('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  const map = { board: loadBoard, inbox: loadInbox, customers: loadCustomers, monteurs: loadMonteurs, control: loadControl, settings: loadSettings, users: loadUsers };
  (map[view] || (() => {}))();
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
  return `<select class="${extraClass}" data-source>${opts}${custom}<option value="__new__">➕ Andere bron…</option></select>`;
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
  $('#boardStats').textContent = `${stats.totalOrders} opdrachten · ${stats.leads} leads · ${stats.customers} klanten`;
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
  wrap.innerHTML = `<h3 class="archive-title">📦 Ingeklapte agenda's</h3>` +
    archives.map((a) => `
      <details class="archive">
        <summary>🗓️ ${esc(a.label)} <span class="count">${a.count}</span></summary>
        <div class="archive-body" data-week="${esc(a.key)}">Laden…</div>
      </details>`).join('');
  $$('.archive').forEach((d) => {
    d.addEventListener('toggle', async () => {
      if (!d.open) return;
      const body = $('.archive-body', d);
      const week = body.dataset.week;
      const orders = await api(`/api/orders?archivedWeek=${encodeURIComponent(week)}`);
      body.innerHTML = orders.map((o) => `
        <div class="archive-item" data-id="${o.id}">
          <span class="dot" style="background:${esc(statusColor(o.status))}"></span>
          <strong>${esc(o.title)}</strong>
          <span class="muted small">${esc(o.customer?.name || '')} · ${esc(statusLabel(o.status))}</span>
        </div>`).join('') || '<div class="muted small">Leeg</div>';
      $$('.archive-item', body).forEach((it) => it.onclick = () => openOrderModal(it.dataset.id, orders));
    });
  });
}

function filteredOrders() {
  const q = ($('#boardSearch').value || '').toLowerCase();
  const mont = $('#boardMonteurFilter').value;
  return state.orders.filter((o) => {
    if (mont && o.monteurId !== mont) return false;
    if (q) {
      const hay = `${o.title} ${o.customer?.name || ''} ${o.notes || ''} ${o.source || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderBoard() {
  const board = $('#board');
  const orders = filteredOrders();
  const statuses = state.meta.statuses || [];
  board.innerHTML = statuses.map((st) => {
    const items = orders.filter((o) => o.status === st.key);
    return `
      <div class="column" data-status="${esc(st.key)}">
        <div class="column-head">
          <span class="column-dot" style="background:${esc(st.color)}"></span>
          ${esc(st.label)}
          <span class="count">${items.length}</span>
        </div>
        <div class="column-cards" data-status="${esc(st.key)}">
          ${items.map(cardHTML).join('') || '<div class="empty">Leeg</div>'}
        </div>
      </div>`;
  }).join('');

  $$('.card').forEach((el) => {
    el.addEventListener('click', () => openOrderModal(el.dataset.id));
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', el.dataset.id); el.style.opacity = '.5'; });
    el.addEventListener('dragend', () => (el.style.opacity = '1'));
  });

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
        try { await api(`/api/orders/${id}`, 'PATCH', { status: newStatus }); toast('Status bijgewerkt'); loadBoard(); }
        catch (err) { toast(err.message, true); loadBoard(); }
      }
    });
  });
}

function cardHTML(o) {
  const sm = sourceMeta(o.source);
  const meta = [`<span class="chip ${sm.cls}">${sm.icon} ${esc(o.source || 'Handmatig')}</span>`];
  if (o.monteur) meta.push(`<span class="chip mont">🔧 ${esc(o.monteur.name)}</span>`);
  if (o.urgent) meta.push('<span class="chip urgent">⚡ spoed</span>');
  if (o.appointmentAt) meta.push(`<span class="chip">📅 ${fmtDate(o.appointmentAt)}</span>`);
  return `
    <div class="card ${o.urgent ? 'urgent' : ''}" data-id="${o.id}" draggable="true" style="border-left-color:${esc(statusColor(o.status))}">
      <div class="card-title">${esc(o.title)}</div>
      ${o.customer ? `<div class="card-customer">👤 ${esc(o.customer.name)}${o.customer.phone ? ' · ' + esc(o.customer.phone) : ''}</div>` : ''}
      <div class="card-meta">${meta.join('')}</div>
      <div class="card-foot">🕓 Binnen: ${esc(fmtDateShort(o.createdAt))}</div>
    </div>`;
}

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
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
function openOrderModal(id, pool) {
  const list = pool || state.orders;
  const o = id ? list.find((x) => x.id === id) : null;
  const canWrite = state.me.role !== 'monteur';
  const isMonteur = state.me.role === 'monteur';
  const monteurOpts = '<option value="">— geen monteur —</option>' +
    state.monteurs.map((m) => `<option value="${m.id}" ${o?.monteurId === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('');

  modal(`
    <h2>${o ? 'Opdracht bewerken' : 'Nieuwe opdracht'}</h2>
    ${o ? `<p class="muted small" style="margin:-8px 0 14px">🕓 Binnengekomen: <strong>${esc(fmtDateShort(o.createdAt))}</strong>${o.updatedAt ? ' · laatst bijgewerkt ' + esc(fmtDateShort(o.updatedAt)) : ''}</p>` : ''}
    <label>Titel <input id="f-title" value="${esc(o?.title || '')}" ${isMonteur ? 'disabled' : ''} placeholder="bv. Cilinderslot vervangen"></label>
    ${!o ? `
      <div class="row">
        <label>Klantnaam <input id="f-cname" placeholder="Naam klant"></label>
        <label>Telefoon <input id="f-cphone" placeholder="06-…"></label>
      </div>
      <label>E-mail klant <input id="f-cemail" placeholder="optioneel"></label>
    ` : `<label>Klant <input value="${esc(o.customer?.name || '')}${o.customer?.phone ? ' · ' + esc(o.customer.phone) : ''}" disabled></label>`}
    <div class="row">
      <label>Status <select id="f-status">${statusOptionsHTML(o?.status)}</select></label>
      <label>Monteur <select id="f-monteur" ${isMonteur ? 'disabled' : ''}>${monteurOpts}</select></label>
    </div>
    <div class="row">
      <label>Afspraak (datum/tijd) <input id="f-appt" type="datetime-local" value="${o?.appointmentAt ? esc(o.appointmentAt.slice(0,16)) : ''}"></label>
      <label>Prijs <input id="f-price" value="${esc(o?.price || '')}" ${isMonteur ? 'disabled' : ''} placeholder="€"></label>
    </div>
    ${canWrite ? `<label>Herkomst (bron) ${sourceSelect(o?.source || 'Handmatig')}</label>` : ''}
    <label>Notities <textarea id="f-notes" rows="3" placeholder="Interne notities">${esc(o?.notes || '')}</textarea></label>
    ${canWrite ? `<label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="f-urgent" style="width:auto" ${o?.urgent ? 'checked' : ''}> Spoed</label>` : ''}
    ${o && o.thread && o.thread.length ? `
      <div class="thread">
        <div class="thread-head">💬 Gesprekshistorie (${o.thread.length})</div>
        ${o.thread.map((t) => `
          <div class="thread-item">
            <div class="thread-meta">${sourceMeta(t.channel).icon} ${esc(t.sender || '')} · ${fmtDate(t.at)}${t.subject ? ' · ' + esc(t.subject) : ''}</div>
            <div class="thread-body">${esc(t.body || '')}</div>
          </div>`).join('')}
      </div>` : ''}
    <div class="modal-actions">
      ${o && canWrite ? '<button class="btn btn-danger" id="f-delete">Verwijderen</button>' : '<span></span>'}
      <div class="right">
        ${o ? '<button class="btn" id="f-reply">💬 Snel antwoord</button>' : ''}
        <button class="btn" id="f-cancel">Annuleren</button>
        <button class="btn btn-primary" id="f-save">Opslaan</button>
      </div>
    </div>
  `);
  bindSourceSelect($('[data-source]'));
  if (o) $('#f-reply').onclick = () => openReplyModal({ name: o.customer?.name, email: o.customer?.email, phone: o.customer?.phone, orderId: o.id });

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
      payload.source = $('[data-source]')?.value || 'Handmatig';
      payload.urgent = $('#f-urgent')?.checked || false;
    }
    try {
      if (o) await api(`/api/orders/${o.id}`, 'PATCH', payload);
      else {
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
  const reviews = await api('/api/reviews?status=pending');
  const list = $('#reviewList');
  if (!reviews.length) { list.innerHTML = '<div class="empty">📭 Geen berichten om te controleren. Goed bezig!</div>'; return; }
  list.innerHTML = reviews.map(reviewHTML).join('');
  reviews.forEach((r) => bindReview(r));
}

function reviewHTML(r) {
  const s = r.suggestion || {};
  const m = r.message || {};
  const conf = Math.round((s.confidence || 0) * 100);
  const monteurOpts = '<option value="">— monteur later —</option>' + state.monteurs.map((mo) => `<option value="${mo.id}">${esc(mo.name)}</option>`).join('');
  const defaultSource = r.channel === 'whatsapp' ? 'Keyservice WhatsApp' : r.channel === 'email' ? 'Keyservice e-mail' : 'Handmatig';
  return `
    <div class="review" data-id="${r.id}" style="border-left-color:${esc(statusColor(s.status))}">
      <div class="review-top">
        <div>
          <strong>${sourceMeta(r.channel).icon} ${esc(m.sender || 'Onbekend')}</strong>
          ${m.group ? `<span class="chip src-groep">👥 ${esc(m.group)}</span>` : ''}
          <div class="muted small">${esc(m.subject || '')} · ${fmtDate(m.receivedAt)}</div>
        </div>
        <div class="small muted" style="text-align:right">
          AI-zekerheid ${conf}%<br>
          <span class="confidence"><div style="width:${conf}%;background:${conf>=70?'#10b981':conf>=40?'#f59e0b':'#ef4444'}"></div></span>
          <div>${esc(s.engine || '')}</div>
        </div>
      </div>
      <div class="review-msg">${esc(m.body || '')}</div>
      <div class="small"><strong>AI herkende:</strong> ${esc(s.reasoning || '')}${s.aiStatus && s.aiStatus !== s.status ? ` <em>(AI-categorie: ${esc(statusLabel(s.aiStatus))})</em>` : ''}</div>
      <div class="review-actions">
        <label class="small" style="margin:0">Kolom<select class="r-status" style="margin-top:3px">${statusOptionsHTML(s.status)}</select></label>
        <label class="small" style="margin:0">Klant<input class="r-cname" value="${esc(s.customerName || '')}" style="margin-top:3px"></label>
        <label class="small" style="margin:0">Telefoon<input class="r-cphone" value="${esc(s.customerPhone || '')}" style="margin-top:3px"></label>
        <label class="small" style="margin:0">E-mail<input class="r-cemail" value="${esc(s.customerEmail || '')}" style="margin-top:3px"></label>
        <label class="small" style="margin:0">Adres<input class="r-caddress" value="${esc(s.customerAddress || '')}" style="margin-top:3px"></label>
        <label class="small" style="margin:0">Herkomst${sourceSelect(defaultSource, 'r-source')}</label>
        <label class="small" style="margin:0">Monteur<select class="r-monteur" style="margin-top:3px">${monteurOpts}</select></label>
      </div>
      <label class="small" style="margin:10px 0 0">Probleem / omschrijving<textarea class="r-problem" rows="2" style="margin-top:3px">${esc(s.problem || '')}</textarea></label>
      <div class="review-actions" style="margin-top:10px">
        <button class="btn r-reply">💬 Snel antwoord</button>
        <button class="btn btn-success r-approve">✓ Goedkeuren → opdracht</button>
        <button class="btn btn-danger r-reject">✕ Afwijzen</button>
      </div>
    </div>`;
}

function bindReview(r) {
  const el = $(`.review[data-id="${r.id}"]`);
  bindSourceSelect($('[data-source]', el));
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
    <table><thead><tr>
      <th>Naam</th><th>Type</th><th>Telefoon</th><th>E-mail</th><th>Herkomst</th><th>Opdrachten</th>${canWrite ? '<th></th>' : ''}
    </tr></thead><tbody>
    ${list.map((c) => { const sm = sourceMeta(c.source); return `<tr>
      <td><strong>${esc(c.name)}</strong>${c.address ? `<div class="muted small">${esc(c.address)}</div>` : ''}</td>
      <td><span class="tag ${c.type === 'lead' ? 'lead' : 'klant'}">${esc(c.type)}</span></td>
      <td>${esc(c.phone || '')}</td><td>${esc(c.email || '')}</td>
      <td><span class="chip ${sm.cls}">${sm.icon} ${esc(c.source || '')}</span></td>
      <td>${c.orderCount}</td>
      ${canWrite ? `<td><button class="btn btn-sm" data-edit="${c.id}">Bewerk</button></td>` : ''}
    </tr>`; }).join('') || `<tr><td colspan="7" class="empty">Geen klanten</td></tr>`}
    </tbody></table>`;
  $$('[data-edit]').forEach((b) => b.onclick = () => openCustomerModal(state._customers.find((c) => c.id === b.dataset.edit)));
}
function openCustomerModal(c) {
  modal(`
    <h2>${c ? 'Klant bewerken' : 'Nieuwe klant'}</h2>
    <label>Naam <input id="c-name" value="${esc(c?.name || '')}"></label>
    <div class="row">
      <label>Telefoon <input id="c-phone" value="${esc(c?.phone || '')}"></label>
      <label>E-mail <input id="c-email" value="${esc(c?.email || '')}"></label>
    </div>
    <label>Adres <input id="c-address" value="${esc(c?.address || '')}"></label>
    <label>Type <select id="c-type">
      <option value="lead" ${c?.type==='lead'?'selected':''}>Lead</option>
      <option value="klant" ${c?.type==='klant'?'selected':''}>Klant</option>
    </select></label>
    <label>Notities <textarea id="c-notes" rows="2">${esc(c?.notes || '')}</textarea></label>
    <div class="modal-actions">
      ${c ? '<button class="btn btn-danger" id="c-del">Verwijderen</button>' : '<span></span>'}
      <div class="right"><button class="btn" id="c-cancel">Annuleren</button><button class="btn btn-primary" id="c-save">Opslaan</button></div>
    </div>`);
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
  $('#monteurList').innerHTML = state.monteurs.map((m) => `
    <div class="info-card">
      <h3>🔧 ${esc(m.name)}</h3>
      <div class="muted small">${esc(m.phone || '')}${m.email ? ' · ' + esc(m.email) : ''}</div>
      <div style="margin-top:10px"><span class="chip">${m.activeCount} actieve opdrachten</span></div>
      ${canWrite ? `<div style="margin-top:12px"><button class="btn btn-sm" data-medit="${m.id}">Bewerk</button> <button class="btn btn-sm btn-danger" data-mdel="${m.id}">Verwijder</button></div>` : ''}
    </div>`).join('') || '<div class="empty">Nog geen monteurs</div>';
  $$('[data-medit]').forEach((b) => b.onclick = () => openMonteurModal(state.monteurs.find((m) => m.id === b.dataset.medit)));
  $$('[data-mdel]').forEach((b) => b.onclick = async () => {
    if (!confirm('Monteur verwijderen?')) return;
    try { await api(`/api/monteurs/${b.dataset.mdel}`, 'DELETE'); toast('Verwijderd'); loadMonteurs(); }
    catch (err) { toast(err.message, true); }
  });
}
function openMonteurModal(m) {
  modal(`
    <h2>${m ? 'Monteur bewerken' : 'Nieuwe monteur'}</h2>
    <label>Naam <input id="m-name" value="${esc(m?.name || '')}"></label>
    <div class="row">
      <label>Telefoon <input id="m-phone" value="${esc(m?.phone || '')}"></label>
      <label>E-mail <input id="m-email" value="${esc(m?.email || '')}"></label>
    </div>
    <div class="modal-actions"><span></span><div class="right">
      <button class="btn" id="m-cancel">Annuleren</button><button class="btn btn-primary" id="m-save">Opslaan</button>
    </div></div>`);
  $('#m-cancel').onclick = closeModal;
  $('#m-save').onclick = async () => {
    const payload = { name: $('#m-name').value, phone: $('#m-phone').value, email: $('#m-email').value };
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
    <div class="stat-grid">
      <div class="stat"><div class="num">${ai.mode === 'ai' ? '🤖 AI' : '⚙️ Demo'}</div><div class="lbl">Categorisatie-modus</div></div>
      <div class="stat"><div class="num">${ai.handled}</div><div class="lbl">Berichten verwerkt</div></div>
      <div class="stat"><div class="num">${ai.accuracy === null ? '—' : ai.accuracy + '%'}</div><div class="lbl">Juist ingedeeld (na controle)</div></div>
      <div class="stat"><div class="num">${ai.corrected}</div><div class="lbl">Door mens gecorrigeerd</div></div>
      <div class="stat"><div class="num">${stats.pendingReviews}</div><div class="lbl">Wacht op controle</div></div>
    </div>
    <div class="info-card" style="max-width:680px">
      <h3>Controle-instelling</h3>
      <p class="muted small">Hoe zeker moet de AI zijn voordat een bericht <strong>automatisch</strong> een opdracht wordt (zonder handmatige controle)? Zet op 0% om <strong>alles</strong> handmatig te controleren (veiligst).</p>
      <label>Drempel voor automatisch goedkeuren: <strong id="threshLbl">${pct}%</strong>
        <input type="range" id="threshold" min="0" max="100" step="5" value="${pct}"></label>
      <button class="btn btn-primary" id="saveThreshold">Opslaan</button>
    </div>
    ${ai.mode === 'demo' ? '<p class="muted small" style="max-width:680px;margin-top:14px">ℹ️ De AI draait nu in <strong>demo-modus</strong> (regels). Vul een Claude API-sleutel in (<code>ANTHROPIC_API_KEY</code>) voor slimmere categorisatie. Zie docs/INTEGRATIES.md.</p>' : '<p class="muted small" style="margin-top:14px">🤖 Slimme AI (Claude) is actief.</p>'}
    <div class="info-card" style="max-width:680px;margin-top:16px">
      <h3>Wekelijkse agenda inklappen</h3>
      <p class="muted small">Gebeurt automatisch elke zondag na 23:59. Opdrachten van de afgelopen week worden ingeklapt onder een agenda-bundel — behalve openstaande/nieuwe opdrachten en afspraken die ná die week vallen. Je kunt het ook nu handmatig uitvoeren.</p>
      <button class="btn" id="runArchive">📦 Nu de afgelopen week inklappen</button>
    </div>
    <div class="info-card" style="max-width:680px;margin-top:16px">
      <h3>📝 Afwijzingen & feedback (waar de AI van leert)</h3>
      <p class="muted small">De laatste afwijzingen met reden. De AI krijgt deze mee om dezelfde fouten te vermijden.</p>
      <div id="feedbackList" class="feedback-list">Laden…</div>
    </div>
  `;
  loadFeedbackList();
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
  if (!fb.length) { el.innerHTML = '<div class="muted small">Nog geen afwijzingen.</div>'; return; }
  el.innerHTML = fb.map((f) => `
    <div class="feedback-item">
      <div><strong>${esc(f.reason)}</strong>${f.shouldBe ? ` <span class="chip">→ ${esc(f.shouldBe)}</span>` : ''}
        <span class="muted small">· ${esc(f.by)} · ${fmtDateShort(f.at)}</span></div>
      ${f.note ? `<div class="small">${esc(f.note)}</div>` : ''}
      ${f.sample ? `<div class="muted small" style="margin-top:3px">“${esc(f.sample.slice(0, 120))}…”</div>` : ''}
    </div>`).join('');
}

// ---------- Instellingen (kolommen + bronnen) ----------
async function loadSettings() {
  const s = await api('/api/settings');
  $('#settingsPanel').innerHTML = `
    <div class="settings-grid">
      <div class="info-card">
        <h3>📋 Kolommen (statussen)</h3>
        <p class="muted small">Sleep niet — gebruik de volgorde van boven naar beneden. Wijzig naam of kleur, voeg toe of verwijder.</p>
        <div id="statusRows"></div>
        <button class="btn btn-sm" id="addStatus">+ Kolom toevoegen</button>
        <div style="margin-top:14px"><button class="btn btn-primary" id="saveStatuses">Kolommen opslaan</button></div>
      </div>
      <div class="info-card">
        <h3>🏷️ Herkomst-bronnen</h3>
        <p class="muted small">De plekken waar opdrachten vandaan komen (bv. Keyservice e-mail, DRS WhatsApp groep).</p>
        <div id="sourceRows"></div>
        <button class="btn btn-sm" id="addSource">+ Bron toevoegen</button>
        <div style="margin-top:14px"><button class="btn btn-primary" id="saveSources">Bronnen opslaan</button></div>
      </div>
    </div>
    <div class="info-card" style="margin-top:18px">
      <h3>💬 Snelle standaardantwoorden</h3>
      <p class="muted small">Vaste teksten (offertes, info-verzoeken, opvolging) die je team met één klik gebruikt bij een bericht.</p>
      <div id="tmplRows"></div>
      <button class="btn btn-sm" id="addTmpl">+ Sjabloon toevoegen</button>
      <div style="margin-top:14px"><button class="btn btn-primary" id="saveTmpls">Sjablonen opslaan</button></div>
    </div>`;

  const statusRows = $('#statusRows');
  const renderStatusRow = (st = { key: '', label: '', color: '#64748b' }) => {
    const row = document.createElement('div');
    row.className = 'editor-row';
    row.dataset.key = st.key || '';
    row.innerHTML = `<input type="color" value="${esc(st.color || '#64748b')}"><input type="text" value="${esc(st.label || '')}" placeholder="Kolomnaam"><button class="btn btn-sm btn-danger" title="Verwijderen">✕</button>`;
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
    row.innerHTML = `<input type="text" value="${esc(val)}" placeholder="Bijv. DRS WhatsApp groep"><button class="btn btn-sm btn-danger">✕</button>`;
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
      <div class="editor-row"><input type="text" class="t-title" value="${esc(t.title || '')}" placeholder="Titel van het antwoord"><button class="btn btn-sm btn-danger">✕</button></div>
      <textarea class="t-body" rows="4" placeholder="De standaardtekst…">${esc(t.body || '')}</textarea>`;
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
    <table><thead><tr><th>Naam</th><th>E-mail</th><th>Rol</th><th></th></tr></thead><tbody>
    ${users.map((u) => `<tr>
      <td><strong>${esc(u.name)}</strong></td><td>${esc(u.email)}</td>
      <td><span class="tag ${esc(u.role)}">${esc(u.role)}</span></td>
      <td>${u.id !== state.me.id ? `<button class="btn btn-sm btn-danger" data-udel="${u.id}">Verwijder</button>` : '<span class="muted small">jij</span>'}</td>
    </tr>`).join('')}
    </tbody></table>`;
  $$('[data-udel]').forEach((b) => b.onclick = async () => {
    if (!confirm('Gebruiker verwijderen?')) return;
    try { await api(`/api/users/${b.dataset.udel}`, 'DELETE'); toast('Verwijderd'); loadUsers(); }
    catch (err) { toast(err.message, true); }
  });
}
function openUserModal() {
  modal(`
    <h2>Nieuwe gebruiker</h2>
    <label>Naam <input id="u-name"></label>
    <label>E-mail <input id="u-email" type="email"></label>
    <label>Wachtwoord <input id="u-pass" type="text" placeholder="minimaal 6 tekens"></label>
    <label>Rol <select id="u-role">
      <option value="assistent">Assistent (alles behalve gebruikersbeheer)</option>
      <option value="monteur">Monteur (alleen opdrachten bekijken/bijwerken)</option>
      <option value="admin">Admin (volledige toegang)</option>
    </select></label>
    <div class="modal-actions"><span></span><div class="right">
      <button class="btn" id="u-cancel">Annuleren</button><button class="btn btn-primary" id="u-save">Aanmaken</button>
    </div></div>`);
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
    <h2>✕ Afwijzen</h2>
    <p class="muted small">Je kunt direct afwijzen. Feedback geven is optioneel, maar helpt de AI leren en is zichtbaar voor het team.</p>
    <label>Reden (optioneel) <select id="rj-reason"><option value="">— geen reden —</option>${REJECT_REASONS.map((x) => `<option>${esc(x)}</option>`).join('')}</select></label>
    <label>Had eigenlijk moeten zijn (optioneel) <select id="rj-should">${statusOpts}</select></label>
    <label>Uitleg (optioneel) <textarea id="rj-note" rows="3" placeholder="Bv. dit was een nieuwsbrief van een leverancier, geen klant."></textarea></label>
    <div class="modal-actions"><span></span><div class="right">
      <button class="btn" id="rj-cancel">Annuleren</button>
      <button class="btn btn-danger" id="rj-save">Afwijzen</button>
    </div></div>`);
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

// ---------- Snel antwoord (standaard-sjablonen) ----------
function openReplyModal(ctx = {}) {
  const templates = state.meta.templates || [];
  const opts = templates.map((t, i) => `<option value="${i}">${esc(t.title)}</option>`).join('');
  const canSend = state.meta.canSendEmail && ctx.email;
  modal(`
    <h2>💬 Snel antwoord</h2>
    <p class="muted small">Kies een standaardtekst, pas hem zo nodig aan, en verstuur of kopieer.${ctx.name ? ' Klant: <strong>' + esc(ctx.name) + '</strong>' : ''}${ctx.email ? ' · ' + esc(ctx.email) : ''}</p>
    <label>Sjabloon <select id="rep-select">${opts || '<option>(geen sjablonen)</option>'}</select></label>
    <div class="row">
      <label>Aan (e-mail) <input id="rep-to" value="${esc(ctx.email || '')}" placeholder="e-mailadres klant"></label>
      <label>Onderwerp <input id="rep-subject" value="Keyservice — uw aanvraag"></label>
    </div>
    <label>Tekst <textarea id="rep-body" rows="11">${esc(templates[0]?.body || '')}</textarea></label>
    <div class="modal-actions">
      <span></span>
      <div class="right">
        <button class="btn" id="rep-close">Sluiten</button>
        <button class="btn" id="rep-copy">📋 Kopieer</button>
        ${ctx.email ? '<a class="btn" id="rep-mail" href="#" target="_blank" rel="noopener">✉️ Open in e-mail</a>' : ''}
        ${canSend ? '<button class="btn btn-primary" id="rep-send">📨 Direct versturen</button>' : ''}
      </div>
    </div>
    <p class="muted small" id="rep-hint" style="margin-top:10px">${
      canSend ? '✅ Wordt direct vanuit het dashboard per e-mail verstuurd.'
      : ctx.email ? 'ℹ️ Direct versturen staat nog uit. Zet SMTP aan (zie docs) of gebruik “Open in e-mail”.'
      : 'ℹ️ Geen e-mailadres bekend — kopieer de tekst en plak hem in WhatsApp.'
    }</p>
  `);
  const sel = $('#rep-select'), body = $('#rep-body');
  sel.onchange = () => { const t = templates[Number(sel.value)]; if (t) body.value = t.body; };
  $('#rep-close').onclick = closeModal;
  $('#rep-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(body.value); toast('Tekst gekopieerd'); }
    catch { body.select(); document.execCommand('copy'); toast('Tekst gekopieerd'); }
  };
  const mailBtn = $('#rep-mail');
  if (mailBtn) mailBtn.onclick = (e) => {
    mailBtn.href = `mailto:${encodeURIComponent($('#rep-to').value)}?subject=${encodeURIComponent($('#rep-subject').value)}&body=${encodeURIComponent(body.value)}`;
  };
  const sendBtn = $('#rep-send');
  if (sendBtn) sendBtn.onclick = async () => {
    sendBtn.disabled = true;
    try {
      await api('/api/send-reply', 'POST', {
        to: $('#rep-to').value, subject: $('#rep-subject').value, text: body.value, orderId: ctx.orderId || null,
      });
      closeModal(); toast('E-mail verstuurd ✅');
    } catch (err) { toast(err.message, true); sendBtn.disabled = false; }
  };
}

// ---------- Account / wachtwoord ----------
function openAccountModal() {
  modal(`
    <h2>Mijn account</h2>
    <p class="muted small">${esc(state.me.name)} · ${esc(state.me.email)} · rol: ${esc(state.me.role)}</p>
    <h3 style="margin:16px 0 10px;font-size:15px">Wachtwoord wijzigen</h3>
    <label>Huidig wachtwoord <input id="p-cur" type="password"></label>
    <label>Nieuw wachtwoord <input id="p-new" type="password" placeholder="minimaal 6 tekens"></label>
    <label>Herhaal nieuw wachtwoord <input id="p-new2" type="password"></label>
    <div class="modal-actions"><span></span><div class="right">
      <button class="btn" id="p-cancel">Sluiten</button><button class="btn btn-primary" id="p-save">Wijzigen</button>
    </div></div>`);
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
    <h2>➕ Bericht handmatig toevoegen</h2>
    <p class="muted small">Handig om een bericht uit je <strong>WhatsApp-groep</strong> door te zetten: kopieer het en plak het hieronder. De AI deelt het daarna in.</p>
    <label>Kanaal <select id="s-channel">
      <option value="whatsapp">💬 WhatsApp</option><option value="email">✉️ E-mail</option>
    </select></label>
    <label>Afzender (naam / nummer / e-mail) <input id="s-sender" placeholder="Jan Jansen of 06-12345678"></label>
    <label>Groep (optioneel) <input id="s-group" placeholder="bv. DRS WhatsApp groep"></label>
    <label>Onderwerp (bij e-mail) <input id="s-subject" placeholder="Offerte aanvraag voordeurslot"></label>
    <label>Bericht <textarea id="s-body" rows="4" placeholder="Hoi, ik ben buitengesloten en kom mijn huis niet in. Kunnen jullie snel langskomen?"></textarea></label>
    <div class="modal-actions"><span></span><div class="right">
      <button class="btn" id="s-cancel">Annuleren</button><button class="btn btn-primary" id="s-save">Versturen</button>
    </div></div>`);
  $('#s-cancel').onclick = closeModal;
  $('#s-save').onclick = async () => {
    const payload = { channel: $('#s-channel').value, sender: $('#s-sender').value, group: $('#s-group').value, subject: $('#s-subject').value, body: $('#s-body').value };
    if (!payload.body) return toast('Bericht verplicht', true);
    try { await api('/api/simulate', 'POST', payload); closeModal(); toast('Bericht ontvangen — zie Inbox'); refreshInboxBadge(); if (state.view === 'inbox') loadInbox(); }
    catch (err) { toast(err.message, true); }
  };
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
}

function modal(html) {
  $('#modal').innerHTML = html;
  $('#modalRoot').hidden = false;
  $('.modal-backdrop').onclick = closeModal;
}
function closeModal() { $('#modalRoot').hidden = true; $('#modal').innerHTML = ''; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

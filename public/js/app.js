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

const SRC_ICON = { email: '✉️', whatsapp: '💬', telefoon: '📞', handmatig: '✍️' };

// ---------- State ----------
const state = { me: null, meta: null, monteurs: [], orders: [], view: 'board' };

// ---------- Init ----------
(async function init() {
  const { user, meta } = await api('/api/me');
  if (!user) { window.location.href = '/'; return; }
  state.me = user; state.meta = meta;
  $('#userName').textContent = `${user.name} · ${user.role}`;
  $('#aiMode').textContent = meta.aiMode === 'ai' ? 'AI actief' : 'AI: demo-modus';

  // Rechten toepassen
  if (user.role !== 'admin') $$('.admin-only').forEach((el) => el.remove());
  if (user.role === 'monteur') $$('.perm-write').forEach((el) => (el.hidden = true));

  bindNav();
  bindButtons();
  await refreshAll();
  setInterval(refreshInboxBadge, 20000);
})();

function bindNav() {
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.view)));
  $('#logoutBtn').addEventListener('click', async () => { await api('/api/logout', 'POST'); window.location.href = '/'; });
}

function showView(view) {
  state.view = view;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  $$('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  const map = { board: loadBoard, inbox: loadInbox, customers: loadCustomers, monteurs: loadMonteurs, control: loadControl, users: loadUsers };
  (map[view] || (() => {}))();
}

async function refreshAll() {
  state.monteurs = await api('/api/monteurs');
  fillMonteurFilter();
  await loadBoard();
  await refreshInboxBadge();
}

// ---------- Board ----------
const COLUMNS = ['open', 'offerte_verzonden', 'afspraak_ingepland', 'geannuleerd'];
const COL_COLOR = { open: 'var(--open)', offerte_verzonden: 'var(--offerte)', afspraak_ingepland: 'var(--afspraak)', geannuleerd: 'var(--geannuleerd)' };

function fillMonteurFilter() {
  const sel = $('#boardMonteurFilter');
  sel.innerHTML = '<option value="">Alle monteurs</option>' +
    state.monteurs.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
}

async function loadBoard() {
  state.orders = await api('/api/orders');
  renderBoard();
  const stats = await api('/api/stats');
  $('#boardStats').textContent = `${stats.totalOrders} opdrachten · ${stats.leads} leads · ${stats.customers} klanten`;
}

function filteredOrders() {
  const q = ($('#boardSearch').value || '').toLowerCase();
  const mont = $('#boardMonteurFilter').value;
  return state.orders.filter((o) => {
    if (mont && o.monteurId !== mont) return false;
    if (q) {
      const hay = `${o.title} ${o.customer?.name || ''} ${o.notes || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderBoard() {
  const board = $('#board');
  const orders = filteredOrders();
  board.innerHTML = COLUMNS.map((status) => {
    const items = orders.filter((o) => o.status === status);
    return `
      <div class="column" data-status="${status}">
        <div class="column-head">
          <span class="column-dot" style="background:${COL_COLOR[status]}"></span>
          ${esc(state.meta.statusLabels[status])}
          <span class="count">${items.length}</span>
        </div>
        <div class="column-cards" data-status="${status}">
          ${items.map(cardHTML).join('') || '<div class="empty small">Leeg</div>'}
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
  const canDrag = state.me.role !== 'monteur' || true; // iedereen mag verslepen (status wijzigen)
  const src = o.source || 'handmatig';
  const meta = [];
  meta.push(`<span class="chip src-${src}">${SRC_ICON[src] || ''} ${esc(src)}</span>`);
  if (o.monteur) meta.push(`<span class="chip mont">🔧 ${esc(o.monteur.name)}</span>`);
  if (o.urgent) meta.push('<span class="chip urgent">⚡ spoed</span>');
  if (o.appointmentAt) meta.push(`<span class="chip">📅 ${fmtDate(o.appointmentAt)}</span>`);
  return `
    <div class="card ${o.urgent ? 'urgent' : ''}" data-id="${o.id}" draggable="${canDrag}">
      <div class="card-title">${esc(o.title)}</div>
      ${o.customer ? `<div class="card-customer">👤 ${esc(o.customer.name)}${o.customer.phone ? ' · ' + esc(o.customer.phone) : ''}</div>` : ''}
      <div class="card-meta">${meta.join('')}</div>
    </div>`;
}

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ---------- Order modal ----------
function openOrderModal(id) {
  const o = id ? state.orders.find((x) => x.id === id) : null;
  const canWrite = state.me.role !== 'monteur';
  const isMonteur = state.me.role === 'monteur';
  const monteurOpts = '<option value="">— geen monteur —</option>' +
    state.monteurs.map((m) => `<option value="${m.id}" ${o?.monteurId === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
  const statusOpts = state.meta.statuses.map((s) => `<option value="${s}" ${o?.status === s ? 'selected' : ''}>${esc(state.meta.statusLabels[s])}</option>`).join('');

  modal(`
    <h2>${o ? 'Opdracht bewerken' : 'Nieuwe opdracht'}</h2>
    <label>Titel <input id="f-title" value="${esc(o?.title || '')}" ${isMonteur ? 'disabled' : ''} placeholder="bv. Cilinderslot vervangen"></label>
    ${!o ? `
      <div class="row">
        <label>Klantnaam <input id="f-cname" placeholder="Naam klant"></label>
        <label>Telefoon <input id="f-cphone" placeholder="06-…"></label>
      </div>
      <label>E-mail klant <input id="f-cemail" placeholder="optioneel"></label>
    ` : `<label>Klant <input value="${esc(o.customer?.name || '')}${o.customer?.phone ? ' · ' + esc(o.customer.phone) : ''}" disabled></label>`}
    <div class="row">
      <label>Status <select id="f-status">${statusOpts}</select></label>
      <label>Monteur <select id="f-monteur" ${isMonteur ? 'disabled' : ''}>${monteurOpts}</select></label>
    </div>
    <div class="row">
      <label>Afspraak (datum/tijd) <input id="f-appt" type="datetime-local" value="${o?.appointmentAt ? esc(o.appointmentAt.slice(0,16)) : ''}"></label>
      <label>Prijs <input id="f-price" value="${esc(o?.price || '')}" ${isMonteur ? 'disabled' : ''} placeholder="€"></label>
    </div>
    ${canWrite ? `<label>Bron <select id="f-source">${['handmatig','email','whatsapp','telefoon'].map((s)=>`<option value="${s}" ${o?.source===s?'selected':''}>${s}</option>`).join('')}</select></label>` : ''}
    <label>Notities <textarea id="f-notes" rows="3" placeholder="Interne notities">${esc(o?.notes || '')}</textarea></label>
    ${canWrite ? `<label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input type="checkbox" id="f-urgent" style="width:auto" ${o?.urgent ? 'checked' : ''}> Spoed</label>` : ''}
    <div class="modal-actions">
      ${o && canWrite ? '<button class="btn btn-danger" id="f-delete">Verwijderen</button>' : '<span></span>'}
      <div class="right">
        <button class="btn" id="f-cancel">Annuleren</button>
        <button class="btn btn-primary" id="f-save">Opslaan</button>
      </div>
    </div>
  `);

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
      payload.source = $('#f-source')?.value || 'handmatig';
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
  const statusOpts = state.meta.statuses.map((st) => `<option value="${st}" ${s.status === st ? 'selected' : ''}>${esc(state.meta.statusLabels[st])}</option>`).join('');
  const monteurOpts = '<option value="">— monteur later —</option>' + state.monteurs.map((mo) => `<option value="${mo.id}">${esc(mo.name)}</option>`).join('');
  return `
    <div class="review" data-id="${r.id}">
      <div class="review-top">
        <div>
          <strong>${SRC_ICON[r.channel] || ''} ${esc(m.sender || 'Onbekend')}</strong>
          ${m.group ? `<span class="chip src-whatsapp">groep: ${esc(m.group)}</span>` : ''}
          <div class="muted small">${esc(m.subject || '')} · ${fmtDate(m.receivedAt)}</div>
        </div>
        <div class="small muted" style="text-align:right">
          AI-zekerheid ${conf}%<br>
          <span class="confidence"><div style="width:${conf}%;background:${conf>=70?'var(--afspraak)':conf>=40?'var(--offerte)':'var(--geannuleerd)'}"></div></span>
          <div>${esc(s.engine || '')}</div>
        </div>
      </div>
      <div class="review-msg">${esc(m.body || '')}</div>
      <div class="small"><strong>AI-uitleg:</strong> ${esc(s.reasoning || '')}</div>
      <div class="review-actions">
        <label class="small" style="margin:0">Status
          <select class="r-status" style="margin-top:2px">${statusOpts}</select></label>
        <label class="small" style="margin:0">Klant
          <input class="r-cname" value="${esc(s.customerName || '')}" style="margin-top:2px"></label>
        <label class="small" style="margin:0">Monteur
          <select class="r-monteur" style="margin-top:2px">${monteurOpts}</select></label>
        <button class="btn btn-success r-approve">✓ Goedkeuren → opdracht</button>
        <button class="btn btn-danger r-reject">✕ Afwijzen</button>
      </div>
    </div>`;
}

function bindReview(r) {
  const el = $(`.review[data-id="${r.id}"]`);
  $('.r-approve', el).onclick = async () => {
    try {
      await api(`/api/reviews/${r.id}/approve`, 'POST', {
        status: $('.r-status', el).value,
        customerName: $('.r-cname', el).value,
        monteurId: $('.r-monteur', el).value || null,
      });
      toast('Opdracht aangemaakt'); loadInbox(); refreshInboxBadge();
    } catch (err) { toast(err.message, true); }
  };
  $('.r-reject', el).onclick = async () => {
    try { await api(`/api/reviews/${r.id}/reject`, 'POST', {}); toast('Afgewezen'); loadInbox(); refreshInboxBadge(); }
    catch (err) { toast(err.message, true); }
  };
}

// ---------- Customers ----------
async function loadCustomers() {
  const customers = await api('/api/customers');
  state._customers = customers;
  renderCustomers();
}
function renderCustomers() {
  const q = ($('#customerSearch').value || '').toLowerCase();
  const list = (state._customers || []).filter((c) => !q || `${c.name} ${c.phone} ${c.email}`.toLowerCase().includes(q));
  const canWrite = state.me.role !== 'monteur';
  $('#customerList').innerHTML = `
    <table><thead><tr>
      <th>Naam</th><th>Type</th><th>Telefoon</th><th>E-mail</th><th>Bron</th><th>Opdrachten</th>${canWrite ? '<th></th>' : ''}
    </tr></thead><tbody>
    ${list.map((c) => `<tr>
      <td><strong>${esc(c.name)}</strong>${c.address ? `<div class="muted small">${esc(c.address)}</div>` : ''}</td>
      <td><span class="tag ${c.type === 'lead' ? 'lead' : 'klant'}">${esc(c.type)}</span></td>
      <td>${esc(c.phone || '')}</td><td>${esc(c.email || '')}</td>
      <td><span class="chip">${SRC_ICON[c.source] || ''} ${esc(c.source || '')}</span></td>
      <td>${c.orderCount}</td>
      ${canWrite ? `<td><button class="btn btn-sm" data-edit="${c.id}">Bewerk</button></td>` : ''}
    </tr>`).join('') || `<tr><td colspan="7" class="empty">Geen klanten</td></tr>`}
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
      <div style="margin-top:8px"><span class="chip">${m.activeCount} actieve opdrachten</span></div>
      ${canWrite ? `<div style="margin-top:10px"><button class="btn btn-sm" data-medit="${m.id}">Bewerk</button> <button class="btn btn-sm btn-danger" data-mdel="${m.id}">Verwijder</button></div>` : ''}
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
        <input type="range" id="threshold" min="0" max="100" step="5" value="${pct}">
      </label>
      <button class="btn btn-primary" id="saveThreshold">Opslaan</button>
    </div>
    ${ai.mode === 'demo' ? '<p class="muted small" style="max-width:680px;margin-top:14px">ℹ️ De AI draait nu in <strong>demo-modus</strong> (regels/keywords). Vul een Claude API-sleutel in (<code>ANTHROPIC_API_KEY</code> in het <code>.env</code>-bestand) voor slimmere categorisatie. Zie docs/INTEGRATIES.md.</p>' : ''}
  `;
  const range = $('#threshold');
  range.oninput = () => ($('#threshLbl').textContent = range.value + '%');
  $('#saveThreshold').onclick = async () => {
    await api('/api/settings', 'PATCH', { aiAutoApproveThreshold: Number(range.value) / 100 });
    toast('Instelling opgeslagen');
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

// ---------- Simulate test message ----------
function openSimulateModal() {
  modal(`
    <h2>🧪 Testbericht simuleren</h2>
    <p class="muted small">Doe alsof er een e-mail of WhatsApp binnenkomt, zodat je ziet hoe de AI categoriseert.</p>
    <label>Kanaal <select id="s-channel">
      <option value="email">✉️ E-mail</option><option value="whatsapp">💬 WhatsApp</option>
    </select></label>
    <label>Afzender (naam / nummer / e-mail) <input id="s-sender" placeholder="Jan Jansen <jan@example.nl> of 06-12345678"></label>
    <label>Onderwerp (bij e-mail) <input id="s-subject" placeholder="Offerte aanvraag voordeurslot"></label>
    <label>Bericht <textarea id="s-body" rows="4" placeholder="Hoi, ik ben buitengesloten en kom mijn huis niet in. Kunnen jullie snel langskomen?"></textarea></label>
    <div class="modal-actions"><span></span><div class="right">
      <button class="btn" id="s-cancel">Annuleren</button><button class="btn btn-primary" id="s-save">Versturen</button>
    </div></div>`);
  $('#s-cancel').onclick = closeModal;
  $('#s-save').onclick = async () => {
    const payload = { channel: $('#s-channel').value, sender: $('#s-sender').value, subject: $('#s-subject').value, body: $('#s-body').value };
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

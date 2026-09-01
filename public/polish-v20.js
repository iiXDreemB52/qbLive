(() => {
  if (window.__sawalefPolishV20) return;
  window.__sawalefPolishV20 = true;

  const $ = id => document.getElementById(id);
  const messageMeta = new Map();
  const selected = { groups: new Set(), users: new Set() };
  let ownerMeta = { roomId: '', createdBy: '', canManage: false };
  let boundSocket = null;
  let adminObserver = null;

  const toast = text => { try { showToast(text); } catch {} };
  const safeCssEscape = value => window.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-z0-9_-]/gi, '\\$&');

  function currentRoomId() {
    try { return String(roomId || ''); } catch { return ''; }
  }

  function requestOwnerMeta() {
    const room = currentRoomId();
    let s = null;
    try { s = socket; } catch {}
    if (!room || !s?.connected) {
      ownerMeta = { roomId: '', createdBy: '', canManage: false };
      decorateAllMessages();
      return;
    }
    s.emit('owner:room-info', { roomId: room }, res => {
      if (!res?.ok || currentRoomId() !== room) return;
      ownerMeta = {
        roomId: room,
        createdBy: String(res.group?.createdBy || ''),
        canManage: Boolean(res.canManage),
      };
      window.SawalefOwnerMeta = ownerMeta;
      decorateAllMessages();
      decorateOwnerPresence();
    });
  }

  function isOwnerUser(userId) {
    return Boolean(ownerMeta.createdBy && String(userId || '') === ownerMeta.createdBy);
  }

  function addOwnerBadge(container) {
    if (!container || container.querySelector('.owner-name-badge')) return;
    const badge = document.createElement('span');
    badge.className = 'owner-name-badge';
    badge.textContent = 'مالك المجموعة';
    container.appendChild(badge);
  }

  function decorateMessageNode(node, message) {
    if (!node || !message?.id) return;
    const id = String(message.id);
    node.dataset.messageId = id;
    node.dataset.userId = String(message.userId || '');
    messageMeta.set(id, message);

    const head = node.querySelector('.msg-head');
    head?.querySelectorAll('.owner-name-badge,.owner-msg-delete').forEach(el => el.remove());
    if (isOwnerUser(message.userId)) addOwnerBadge(head);

    if (ownerMeta.canManage && !node.classList.contains('msg-media') && head) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'owner-msg-delete';
      del.title = 'حذف الرسالة';
      del.setAttribute('aria-label', 'حذف الرسالة');
      del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M8 10v7M12 10v7M16 10v7M6 7l1 14h10l1-14"/></svg>';
      del.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        deleteTextMessage(id, node);
      };
      head.appendChild(del);
    }
  }

  function decorateHistory(history = []) {
    const nodes = [...document.querySelectorAll('#messages .msg:not(.msg-media)')];
    const slice = nodes.slice(Math.max(0, nodes.length - history.length));
    history.forEach((m, i) => decorateMessageNode(slice[i], m));
  }

  function decorateLastMessage(message) {
    const nodes = document.querySelectorAll('#messages .msg:not(.msg-media)');
    decorateMessageNode(nodes[nodes.length - 1], message);
  }

  function decorateAllMessages() {
    for (const [id, message] of messageMeta.entries()) {
      const node = document.querySelector(`#messages .msg[data-message-id="${safeCssEscape(id)}"]`);
      if (node) decorateMessageNode(node, message);
    }
  }

  function deleteTextMessage(id, node) {
    let s = null;
    try { s = socket; } catch {}
    const room = currentRoomId();
    if (!ownerMeta.canManage || !s?.connected || !room) return toast('الحذف متاح لمالك المجموعة فقط.');
    if (!confirm('حذف هذه الرسالة من المجموعة؟')) return;
    const button = node?.querySelector('.owner-msg-delete');
    if (button) button.disabled = true;
    s.emit('owner:message:delete', { roomId: room, messageId: id }, res => {
      if (!res?.ok) {
        if (button) button.disabled = false;
        return toast(res?.error || 'تعذر حذف الرسالة.');
      }
      node?.remove();
      messageMeta.delete(String(id));
      toast('تم حذف الرسالة.');
    });
  }

  function decorateOwnerPresence(list = null) {
    const presence = Array.isArray(list) ? list : (() => { try { return currentPresence || []; } catch { return []; } })();
    for (const user of presence) {
      const speaker = document.getElementById(`speaker-${user.id}`);
      const name = speaker?.querySelector('.speaker-name');
      name?.querySelectorAll('.owner-name-badge').forEach(el => el.remove());
      if (name && isOwnerUser(user.userId)) addOwnerBadge(name);
    }
  }

  function bindSocket() {
    let s = null;
    try { s = socket; } catch {}
    if (!s || s === boundSocket) return Boolean(s);
    boundSocket = s;

    s.on('message-history', history => requestAnimationFrame(() => decorateHistory(history || [])));
    s.on('chat-message', message => requestAnimationFrame(() => decorateLastMessage(message)));
    s.on('message:deleted', ({ id } = {}) => {
      if (!id) return;
      document.querySelectorAll(`#messages .msg[data-message-id="${safeCssEscape(id)}"]`).forEach(el => el.remove());
      messageMeta.delete(String(id));
    });
    s.on('presence', list => requestAnimationFrame(() => {
      decorateOwnerPresence(list || []);
      if (currentRoomId() && ownerMeta.roomId !== currentRoomId()) requestOwnerMeta();
    }));
    s.on('group:updated', () => setTimeout(requestOwnerMeta, 0));
    return true;
  }

  function composerOrder() {
    const form = $('messageForm');
    if (!form) return;
    form.classList.add('composer-v20');
  }

  function activeAdminType() {
    return $('adminRoomsView')?.classList.contains('hidden') ? 'users' : 'groups';
  }

  function ensureBulkBar() {
    const panel = document.querySelector('#adminPanel .admin-sheet');
    const tabs = panel?.querySelector('.admin-tabs');
    if (!panel || !tabs) return;
    let bar = $('adminBulkBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'adminBulkBar';
      bar.className = 'admin-bulk-bar';
      bar.innerHTML = '<label class="admin-select-all"><input id="adminSelectAll" type="checkbox"/><span>تحديد الكل</span></label><span id="adminSelectedCount">0 محدد</span><button id="adminDeleteSelected" class="btn-danger" type="button" disabled>حذف المحدد</button>';
      tabs.after(bar);
      $('adminSelectAll').addEventListener('change', e => toggleAll(Boolean(e.target.checked)));
      $('adminDeleteSelected').addEventListener('click', deleteSelectedAdminItems);
    }
    updateBulkBar();
  }

  function decorateAdminRows() {
    ensureBulkBar();
    decorateAdminView($('adminRoomsView'), 'groups');
    decorateAdminView($('adminUsersView'), 'users');
    updateBulkBar();
  }

  function decorateAdminView(view, type) {
    if (!view) return;
    for (const row of view.querySelectorAll('.admin-row')) {
      let id = '';
      if (type === 'groups') id = row.querySelector('[data-admin-delete-stored-group]')?.dataset.adminDeleteStoredGroup || '';
      else id = row.querySelector('[data-admin-delete-user]')?.dataset.adminDeleteUser || '';
      if (!id) continue;
      row.classList.add('admin-row-selectable');
      let cell = row.querySelector('.admin-row-select');
      if (!cell) {
        cell = document.createElement('label');
        cell.className = 'admin-row-select';
        cell.innerHTML = '<input type="checkbox" aria-label="تحديد" />';
        row.prepend(cell);
      }
      const input = cell.querySelector('input');
      input.dataset.bulkType = type;
      input.dataset.bulkId = id;
      input.checked = selected[type].has(id);
      input.onchange = () => {
        input.checked ? selected[type].add(id) : selected[type].delete(id);
        updateBulkBar();
      };
      cell.onclick = e => e.stopPropagation();
    }
  }

  function visibleSelectableInputs() {
    const type = activeAdminType();
    const view = type === 'groups' ? $('adminRoomsView') : $('adminUsersView');
    return [...(view?.querySelectorAll(`.admin-row-select input[data-bulk-type="${type}"]`) || [])];
  }

  function toggleAll(checked) {
    const type = activeAdminType();
    for (const input of visibleSelectableInputs()) {
      input.checked = checked;
      const id = input.dataset.bulkId;
      checked ? selected[type].add(id) : selected[type].delete(id);
    }
    updateBulkBar();
  }

  function updateBulkBar() {
    const type = activeAdminType();
    const count = selected[type].size;
    if ($('adminSelectedCount')) $('adminSelectedCount').textContent = `${count} محدد`;
    if ($('adminDeleteSelected')) $('adminDeleteSelected').disabled = count === 0;
    const inputs = visibleSelectableInputs();
    const all = inputs.length > 0 && inputs.every(i => i.checked);
    const some = inputs.some(i => i.checked);
    if ($('adminSelectAll')) {
      $('adminSelectAll').checked = all;
      $('adminSelectAll').indeterminate = some && !all;
    }
  }

  function emitAck(event, payload) {
    return new Promise((resolve, reject) => {
      let s = null;
      try { s = socket; } catch {}
      if (!s?.connected) return reject(new Error('غير متصل بالسيرفر.'));
      const timer = setTimeout(() => reject(new Error('تأخر رد السيرفر.')), 10000);
      s.emit(event, payload, res => {
        clearTimeout(timer);
        res?.ok ? resolve(res) : reject(new Error(res?.error || 'تعذر تنفيذ العملية.'));
      });
    });
  }

  async function deleteSelectedAdminItems() {
    const type = activeAdminType();
    const ids = [...selected[type]];
    if (!ids.length) return;
    const label = type === 'groups' ? 'قروب' : 'حساب';
    if (!confirm(`حذف ${ids.length} ${label} محدد نهائيًا؟`)) return;
    const btn = $('adminDeleteSelected');
    btn.disabled = true;
    let done = 0, failed = 0;
    for (const id of ids) {
      try {
        if (type === 'groups') await emitAck('admin:group:delete', { roomId: id });
        else await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
        selected[type].delete(id);
        done++;
      } catch { failed++; }
    }
    toast(failed ? `تم حذف ${done} وتعذر حذف ${failed}.` : `تم حذف ${done} بنجاح.`);
    try { await loadAdmin(); } catch {}
    setTimeout(decorateAdminRows, 0);
  }

  function setupAdmin() {
    ensureBulkBar();
    const rooms = $('adminRoomsView'), users = $('adminUsersView');
    if (!rooms || !users) return;
    if (!adminObserver) {
      adminObserver = new MutationObserver(() => queueMicrotask(decorateAdminRows));
      adminObserver.observe(rooms, { childList: true, subtree: true });
      adminObserver.observe(users, { childList: true, subtree: true });
    }
    $('adminRoomsTab')?.addEventListener('click', () => setTimeout(updateBulkBar, 0));
    $('adminUsersTab')?.addEventListener('click', () => setTimeout(updateBulkBar, 0));
    decorateAdminRows();
  }

  function pollRoomState() {
    bindSocket();
    composerOrder();
    setupAdmin();
    const room = currentRoomId();
    if (room && ownerMeta.roomId !== room) requestOwnerMeta();
    if (!room && ownerMeta.roomId) ownerMeta = { roomId: '', createdBy: '', canManage: false };
  }

  composerOrder();
  setupAdmin();
  bindSocket();
  document.addEventListener('sawalef:room-runtime-ready', () => {
    composerOrder();
    requestOwnerMeta();
    decorateOwnerPresence();
  });
  $('adminBtn')?.addEventListener('click', () => setTimeout(decorateAdminRows, 80));

  const timer = setInterval(pollRoomState, 900);
  setTimeout(() => {
    if (!currentRoomId() && !$('adminPanel')?.classList.contains('hidden')) return;
    clearInterval(timer);
  }, 30000);
})();

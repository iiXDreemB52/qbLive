(() => {
  const byId = id => document.getElementById(id);
  const remember = byId('rememberLogin');
  const boot = byId('bootPage');
  let ownerInfo = null;
  let lastOwnerRoom = '';
  let inviteJoinStarted = false;

  function settleBoot() {
    const hasAnyToken = Boolean(localStorage.getItem('sawalef_token') || sessionStorage.getItem('sawalef_token'));
    const ready = !hasAnyToken || Boolean(me) || !byId('authPage')?.classList.contains('hidden');
    if (!ready) return;
    document.body.classList.remove('booting');
    boot?.classList.add('hidden');
    if (sessionStorage.getItem('sawalef_session_bridge') === '1') {
      localStorage.removeItem('sawalef_token');
      sessionStorage.removeItem('sawalef_session_bridge');
    }
  }

  // Preserve existing users as remembered, then let them explicitly choose session-only later.
  try {
    if (remember) {
      const pref = localStorage.getItem('sawalef_remember');
      remember.checked = pref === '1' || (pref === null && Boolean(localStorage.getItem('sawalef_token')));
    }
  } catch {}

  const baseSetAuth = setAuth;
  setAuth = function (result) {
    const keep = Boolean(remember?.checked);
    baseSetAuth(result);
    try {
      if (keep) {
        localStorage.setItem('sawalef_remember', '1');
        localStorage.setItem('sawalef_token', result.token);
        sessionStorage.removeItem('sawalef_token');
      } else {
        localStorage.setItem('sawalef_remember', '0');
        sessionStorage.setItem('sawalef_token', result.token);
        localStorage.removeItem('sawalef_token');
      }
    } catch {}
    setTimeout(settleBoot, 0);
  };

  const baseClearAuth = clearAuth;
  clearAuth = function () {
    try {
      sessionStorage.removeItem('sawalef_token');
      sessionStorage.removeItem('sawalef_session_bridge');
      localStorage.removeItem('sawalef_token');
    } catch {}
    baseClearAuth();
    document.body.classList.remove('booting');
    boot?.classList.add('hidden');
  };

  function modalHtml() {
    if (!byId('profileModal')) {
      document.body.insertAdjacentHTML('beforeend', `
        <div id="profileModal" class="group-modal hidden">
          <div class="group-modal-backdrop" data-profile-close></div>
          <section class="group-modal-sheet compact-sheet">
            <div class="group-modal-head"><div><span class="eyebrow">حسابك</span><h2>تعديل الصورة</h2></div><button class="round-btn" data-profile-close type="button">✕</button></div>
            <div class="profile-editor">
              <div class="profile-editor-avatar" id="profileEditorAvatar"></div>
              <div><b id="profileEditorName"></b><small>غيّر صورة حسابك وتنعكس في القروبات.</small></div>
            </div>
            <input id="profileImageInput" type="file" accept="image/png,image/jpeg,image/webp" hidden />
            <button id="profileChooseImage" class="primary wide" type="button">اختيار صورة جديدة</button>
          </section>
        </div>
        <div id="ownerModal" class="group-modal hidden">
          <div class="group-modal-backdrop" data-owner-close></div>
          <section class="group-modal-sheet owner-sheet">
            <div class="group-modal-head"><div><span class="eyebrow">إدارة المجموعة</span><h2 id="ownerModalTitle">المجموعة</h2></div><button class="round-btn" data-owner-close type="button">✕</button></div>
            <div id="ownerInviteBox" class="owner-invite-box hidden"><div><b>رابط الدعوة الخاص</b><small id="ownerInviteText"></small></div><button id="ownerCopyInvite" type="button">نسخ الرابط</button></div>
            <div class="owner-section-title">الأعضاء</div>
            <div id="ownerMembers" class="owner-members"></div>
            <button id="ownerDeleteGroup" class="btn-danger wide owner-delete" type="button">حذف المجموعة نهائيًا</button>
          </section>
        </div>
      `);
    }
    if (!byId('ownerBar')) {
      byId('roomPage')?.insertAdjacentHTML('beforeend', `
        <div id="ownerBar" class="owner-bar hidden">
          <button id="ownerManageBtn" type="button">⚙ إدارة المجموعة</button>
          <button id="ownerInviteBtn" class="hidden" type="button">🔗 نسخ رابط الدعوة</button>
        </div>
      `);
    }
  }
  modalHtml();

  function avatarMarkup(u) {
    const src = safeAvatar(u?.avatar || '');
    return src ? `<img src="${esc(src)}" alt=""/>` : `<span>${esc(initials(u?.name || u?.username || '؟'))}</span>`;
  }

  function openProfile() {
    if (!me) return;
    byId('profileEditorName').textContent = me.name || me.username || '';
    byId('profileEditorAvatar').innerHTML = avatarMarkup(me);
    byId('profileModal').classList.remove('hidden');
  }
  document.querySelector('.me-chip')?.addEventListener('click', openProfile);
  document.querySelectorAll('[data-profile-close]').forEach(el => el.onclick = () => byId('profileModal').classList.add('hidden'));
  byId('profileChooseImage').onclick = () => byId('profileImageInput').click();
  byId('profileImageInput').onchange = async () => {
    const file = byId('profileImageInput').files?.[0];
    if (!file) return;
    try {
      const avatar = await resizeAvatar(file);
      const result = await api('/api/me/avatar', { method: 'PATCH', body: JSON.stringify({ avatar }) });
      me = result.user;
      renderMe();
      byId('profileEditorAvatar').innerHTML = avatarMarkup(me);
      socket?.emit('profile:changed', { avatar: me.avatar || '' });
      showToast('تم تحديث صورة الحساب.');
    } catch (e) { showToast(e?.message || 'تعذر تحديث الصورة.'); }
  };

  function inviteUrl(room = roomId) {
    const u = new URL(location.origin + location.pathname);
    u.searchParams.set('join', room);
    return u.toString();
  }
  async function copyInvite() {
    const url = inviteUrl();
    try { await navigator.clipboard.writeText(url); showToast('تم نسخ رابط الدعوة.'); }
    catch { prompt('انسخ رابط الدعوة:', url); }
  }
  window.SawalefShowInviteLink = group => {
    if (!group?.roomId) return;
    const url = inviteUrl(group.roomId);
    showToast(group.type === 'private' ? 'تم إنشاء المجموعة الخاصة — رابط الدعوة جاهز.' : 'تم إنشاء المجموعة.');
    try { sessionStorage.setItem('sawalef_last_invite', url); } catch {}
  };

  function refreshOwnerUi() {
    const bar = byId('ownerBar');
    if (!bar) return;
    const can = Boolean(ownerInfo?.canManage && roomId && ownerInfo?.group?.roomId === roomId);
    bar.classList.toggle('hidden', !can);
    const privateGroup = can && ownerInfo?.group?.type === 'private';
    byId('ownerInviteBtn')?.classList.toggle('hidden', !privateGroup);
  }

  function renderOwnerMembers() {
    const view = byId('ownerMembers');
    if (!view) return;
    const members = Array.isArray(currentPresence) ? currentPresence : [];
    view.innerHTML = members.length ? members.map(u => {
      const self = u.userId === me?.id && u.id === socket?.id;
      const mutedByOwner = Boolean(u.ownerMuted);
      return `<div class="owner-member-row">
        <div class="owner-member-avatar">${avatarMarkup(u)}</div>
        <div class="owner-member-main"><b>${esc(u.name || u.username || 'مستخدم')}${self ? ' • أنت' : ''}</b><small>${u.voice ? 'داخل المايك' : 'مستمع/كتابة'}${mutedByOwner ? ' • المايك مقفول' : ''}</small></div>
        <div class="owner-member-actions">${self ? '<span class="owner-you">المنشئ</span>' : `<button data-owner-mute="${esc(u.id)}" data-muted="${mutedByOwner ? '1' : '0'}" type="button">${mutedByOwner ? 'فك الميوت' : 'ميوت'}</button><button class="danger-mini" data-owner-kick="${esc(u.id)}" type="button">طرد</button>`}</div>
      </div>`;
    }).join('') : '<div class="groups-empty">لا يوجد أعضاء الآن.</div>';

    view.querySelectorAll('[data-owner-mute]').forEach(btn => btn.onclick = () => {
      const next = btn.dataset.muted !== '1';
      socket.emit('owner:member:mute', { roomId, socketId: btn.dataset.ownerMute, muted: next }, res => {
        if (!res?.ok) return showToast(res?.error || 'تعذر تغيير الميوت.');
        showToast(next ? 'تم تعطيل مايك الشخص.' : 'تم السماح له بالمايك.');
        setTimeout(loadOwnerInfo, 120);
      });
    });
    view.querySelectorAll('[data-owner-kick]').forEach(btn => btn.onclick = () => {
      if (!confirm('إخراج هذا الشخص من المجموعة؟')) return;
      socket.emit('owner:member:kick', { roomId, socketId: btn.dataset.ownerKick }, res => {
        if (!res?.ok) return showToast(res?.error || 'تعذر إخراج الشخص.');
        showToast('تم إخراج الشخص.');
        setTimeout(loadOwnerInfo, 120);
      });
    });
  }

  function loadOwnerInfo() {
    if (!roomId || !socket?.connected) {
      ownerInfo = null;
      lastOwnerRoom = '';
      refreshOwnerUi();
      return;
    }
    socket.emit('owner:room-info', { roomId }, res => {
      if (!res?.ok) { ownerInfo = null; refreshOwnerUi(); return; }
      ownerInfo = res;
      lastOwnerRoom = roomId;
      refreshOwnerUi();
      renderOwnerMembers();
      byId('ownerModalTitle').textContent = res.group?.name || roomId;
      const isPrivate = res.group?.type === 'private';
      byId('ownerInviteBox').classList.toggle('hidden', !isPrivate);
      if (isPrivate) byId('ownerInviteText').textContent = inviteUrl(roomId);
    });
  }

  byId('ownerManageBtn').onclick = () => { loadOwnerInfo(); byId('ownerModal').classList.remove('hidden'); };
  byId('ownerInviteBtn').onclick = copyInvite;
  byId('ownerCopyInvite').onclick = copyInvite;
  document.querySelectorAll('[data-owner-close]').forEach(el => el.onclick = () => byId('ownerModal').classList.add('hidden'));
  byId('ownerDeleteGroup').onclick = () => {
    if (!ownerInfo?.canManage || !roomId) return;
    if (!confirm('حذف المجموعة نهائيًا؟ ما تقدر ترجعها بعد الحذف.')) return;
    socket.emit('owner:group:delete', { roomId }, res => {
      if (!res?.ok) return showToast(res?.error || 'تعذر حذف المجموعة.');
      byId('ownerModal').classList.add('hidden');
      showToast('تم حذف المجموعة.');
    });
  };

  function bindSocket() {
    if (!socket || socket.__proFeaturesBound) return;
    socket.__proFeaturesBound = true;
    socket.on('owner:kicked', ({ reason } = {}) => {
      showToast(reason || 'تم إخراجك من المجموعة.');
      try { leaveRoom(false); } catch {}
    });
    socket.on('profile:updated', ({ userId, avatar } = {}) => {
      if (!userId) return;
      if (me?.id === userId) { me.avatar = avatar || ''; renderMe(); }
      if (Array.isArray(currentPresence)) {
        currentPresence.forEach(u => { if (u.userId === userId) u.avatar = avatar || ''; });
        if (roomId) renderPresence(currentPresence);
      }
      refreshCommunity?.();
    });
    socket.on('group:deleted', () => refreshCommunity?.());
    socket.on('presence', () => {
      setTimeout(() => { if (ownerInfo?.canManage) { renderOwnerMembers(); loadOwnerInfo(); } }, 0);
    });
  }

  function maybeJoinInvite() {
    if (inviteJoinStarted || !me || !socket?.connected || roomId) return;
    const code = new URL(location.href).searchParams.get('join');
    if (!code) return;
    inviteJoinStarted = true;
    setTimeout(() => joinRoomCode(code), 120);
  }

  setInterval(() => {
    bindSocket();
    settleBoot();
    maybeJoinInvite();
    if (roomId !== lastOwnerRoom) loadOwnerInfo();
  }, 350);

  // If the session bridge was invalid and auth became visible, remove the stale session token too.
  setTimeout(() => {
    if (!me && !byId('authPage')?.classList.contains('hidden')) {
      try { sessionStorage.removeItem('sawalef_token'); } catch {}
      settleBoot();
    }
  }, 2500);
})();

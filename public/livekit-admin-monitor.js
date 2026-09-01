(() => {
  const STATUS = {
    green: { label: 'ممتازة', color: '#39d98a' },
    yellow: { label: 'جيدة', color: '#f4c95d' },
    red: { label: 'معطلة / سيئة', color: '#ff5d5d' },
  };

  const style = document.createElement('style');
  style.textContent = `
    .lk-health-card{border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.035);border-radius:18px;padding:14px;display:grid;gap:12px;margin-bottom:2px}
    .lk-health-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.lk-health-title{display:flex;align-items:center;gap:9px;font-weight:900}.lk-dot{width:12px;height:12px;border-radius:50%;box-shadow:0 0 18px currentColor}.lk-health-meta{font-size:11px;color:#96a29d}.lk-client-list{display:grid;gap:7px}.lk-client{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:9px 10px;border-radius:13px;background:rgba(0,0,0,.16)}.lk-client b{font-size:12px}.lk-client small{display:block;color:#96a29d;font-size:10px;margin-top:3px}.lk-badge{font-size:10px;font-weight:900;padding:5px 8px;border-radius:999px;background:rgba(255,255,255,.06)}
  `;
  document.head.appendChild(style);

  function ensureCard() {
    const panel = document.querySelector('#adminPanel .admin-sheet');
    if (!panel) return null;
    let card = document.getElementById('lkHealthCard');
    if (card) return card;
    card = document.createElement('div');
    card.id = 'lkHealthCard';
    card.className = 'lk-health-card';
    card.innerHTML = `
      <div class="lk-health-head"><div class="lk-health-title"><span id="lkHealthDot" class="lk-dot"></span><span>حالة شبكة LiveKit</span></div><span id="lkHealthLabel" class="lk-badge">جاري الفحص...</span></div>
      <div id="lkHealthMeta" class="lk-health-meta">فحص اتصال SFU وواجهة LiveKit API...</div>
      <div id="lkClientList" class="lk-client-list"></div>`;
    const stats = panel.querySelector('.admin-stats');
    if (stats?.parentNode) stats.parentNode.insertBefore(card, stats.nextSibling);
    else panel.appendChild(card);
    return card;
  }

  function statusFromClient(m = {}) {
    if (!m.active || ['disconnected','failed','idle'].includes(String(m.state))) return 'red';
    const q = String(m.quality || '').toLowerCase();
    if (q === 'excellent' || q === 'good') return 'green';
    if (q === 'poor' || q === 'unknown') return 'yellow';
    if (q === 'lost') return 'red';
    return 'yellow';
  }

  function render(data) {
    ensureCard();
    const server = data?.server || { status: 'red', label: 'معطل' };
    const visual = STATUS[server.status] || STATUS.red;
    const dot = document.getElementById('lkHealthDot');
    const label = document.getElementById('lkHealthLabel');
    const meta = document.getElementById('lkHealthMeta');
    const list = document.getElementById('lkClientList');
    if (dot) { dot.style.background = visual.color; dot.style.color = visual.color; }
    if (label) { label.textContent = server.label || visual.label; label.style.color = visual.color; }
    if (meta) {
      meta.textContent = server.status === 'red'
        ? `LiveKit: ${server.error || 'تعذر الوصول للسيرفر'}`
        : `زمن الاستجابة ${server.latencyMs ?? '-'}ms • الغرف النشطة ${server.activeRooms ?? 0}`;
    }
    if (!list) return;
    const voiceClients = (data?.clients || []).filter(c => c.voice || c.livekit?.active);
    list.innerHTML = voiceClients.length ? voiceClients.map(c => {
      const s = statusFromClient(c.livekit);
      const v = STATUS[s];
      const m = c.livekit || {};
      return `<div class="lk-client"><div><b>${escapeHtml(c.name || 'مستخدم')}</b><small>${escapeHtml(c.roomId || 'بدون غرفة')} • صوت مستلم: ${Number(m.subscribedAudio)||0} • مشاركون بعيدون: ${Number(m.remoteParticipants)||0}</small></div><span class="lk-badge" style="color:${v.color}">${v.label}</span></div>`;
    }).join('') : '<div class="lk-health-meta">ما فيه مستخدمين داخل الصوت الآن.</div>';
  }

  function escapeHtml(value='') {
    const d = document.createElement('div'); d.textContent = String(value); return d.innerHTML;
  }

  function refresh() {
    if (typeof socket === 'undefined' || !socket?.connected || me?.role !== 'admin') return;
    ensureCard();
    socket.emit('livekit:health', {}, (res) => { if (res?.ok) render(res); });
  }

  function sendClientState() {
    if (typeof socket === 'undefined' || !socket?.connected) return;
    const lk = window.SawalefLiveKit;
    const room = lk?.room;
    let subscribedAudio = 0;
    let remoteParticipants = 0;
    if (room) {
      try {
        remoteParticipants = room.remoteParticipants?.size || 0;
        for (const p of room.remoteParticipants?.values?.() || []) {
          for (const pub of p.trackPublications?.values?.() || []) if (pub.track && (pub.kind === 'audio' || pub.track.kind === 'audio')) subscribedAudio++;
        }
      } catch {}
    }
    socket.emit('livekit:client-state', {
      active: Boolean(lk?.active),
      state: room?.connectionState || (lk?.active ? 'connected' : 'idle'),
      quality: room?.localParticipant?.connectionQuality || 'unknown',
      remoteParticipants,
      subscribedAudio,
      canPlaybackAudio: typeof room?.canPlaybackAudio === 'boolean' ? room.canPlaybackAudio : null,
    });
  }

  document.getElementById('adminBtn')?.addEventListener('click', () => setTimeout(refresh, 100));
  document.getElementById('adminRefresh')?.addEventListener('click', () => setTimeout(refresh, 100));
  setInterval(() => { sendClientState(); if (!document.getElementById('adminPanel')?.classList.contains('hidden')) refresh(); }, 3000);
})();

(() => {
  if (window.__sawalefPolishV19) return;
  window.__sawalefPolishV19 = true;

  const $ = id => document.getElementById(id);
  const bellSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7Z"/><path d="M10 20h4"/></svg>';
  let audioCtx = null;
  let voiceWrapped = false;
  let socketBound = null;

  function toast(text) {
    try { showToast(text); } catch {}
  }

  function ensureLobbyNotificationButton() {
    const actions = document.querySelector('#lobbyPage .user-actions');
    const meChip = actions?.querySelector('.me-chip');
    if (!actions || !meChip) return;
    let btn = $('lobbyNotifyBtn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'lobbyNotifyBtn';
      btn.className = 'icon-btn lobby-notify-btn';
      btn.type = 'button';
      btn.title = 'إشعارات المكالمة';
      btn.setAttribute('aria-label', 'إشعارات المكالمة');
      btn.innerHTML = bellSvg;
      meChip.before(btn);
      btn.addEventListener('click', requestNotifications);
    }
    syncNotificationButton();
  }

  async function requestNotifications() {
    if (typeof window.Notification === 'undefined' || typeof Notification.requestPermission !== 'function') {
      toast('الإشعارات غير مدعومة في هذا المتصفح.');
      return;
    }
    try {
      const permission = Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission;
      syncNotificationButton();
      toast(permission === 'granted' ? 'تم تفعيل إشعارات المكالمة.' : 'لم يتم السماح بالإشعارات.');
    } catch {
      toast('تعذر تفعيل الإشعارات.');
    }
  }

  function syncNotificationButton() {
    const btn = $('lobbyNotifyBtn');
    if (!btn) return;
    const supported = typeof window.Notification !== 'undefined' && typeof Notification.requestPermission === 'function';
    const granted = supported && Notification.permission === 'granted';
    btn.classList.toggle('active', granted);
    btn.classList.toggle('unsupported', !supported);
    btn.title = granted ? 'الإشعارات مفعلة' : 'تفعيل إشعارات المكالمة';
  }

  function primeAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      return audioCtx;
    } catch {
      return null;
    }
  }

  function tone(ctx, frequency, when, duration, volume) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, when);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume, when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }

  function playCallCue(kind) {
    const ctx = primeAudio();
    if (!ctx) return;
    const now = ctx.currentTime + 0.015;
    if (kind === 'join') {
      tone(ctx, 520, now, 0.105, 0.055);
      tone(ctx, 760, now + 0.085, 0.12, 0.05);
    } else {
      tone(ctx, 620, now, 0.095, 0.05);
      tone(ctx, 370, now + 0.075, 0.14, 0.055);
    }
  }

  function ensureChatUsable() {
    const input = $('messageInput');
    const form = $('messageForm');
    const toggle = $('chatToggle');
    if (input) {
      input.disabled = false;
      input.readOnly = false;
      input.setAttribute('aria-disabled', 'false');
      if (!input.__sawalefFocusBound) {
        input.__sawalefFocusBound = true;
        input.addEventListener('focus', () => $('chatSheet')?.classList.remove('collapsed'));
      }
    }
    if (form) form.style.pointerEvents = 'auto';
    if (toggle) {
      toggle.classList.remove('hidden');
      toggle.style.pointerEvents = 'auto';
    }
  }

  function wrapVoiceActions() {
    if (voiceWrapped || typeof window.joinVoice !== 'function' || typeof window.leaveVoice !== 'function') return;
    voiceWrapped = true;
    const originalJoin = window.joinVoice;
    const originalLeave = window.leaveVoice;

    window.joinVoice = async function (...args) {
      primeAudio();
      let before = false;
      try { before = Boolean(joinedVoice); } catch {}
      const result = await originalJoin.apply(this, args);
      let after = false;
      try { after = Boolean(joinedVoice); } catch {}
      if (!before && after) playCallCue('join');
      ensureChatUsable();
      return result;
    };

    window.leaveVoice = async function (...args) {
      primeAudio();
      let before = false;
      try { before = Boolean(joinedVoice); } catch {}
      const result = await originalLeave.apply(this, args);
      let after = false;
      try { after = Boolean(joinedVoice); } catch {}
      if (before && !after) playCallCue('leave');
      ensureChatUsable();
      return result;
    };
  }

  function updateTotalMemberCount(list) {
    const total = Array.isArray(list) ? list.length : 0;
    if ($('memberCount')) $('memberCount').textContent = String(total);
    if ($('voiceCountTop')) $('voiceCountTop').textContent = String(total);
  }

  function bindPresence() {
    let currentSocket = null;
    try { currentSocket = socket; } catch {}
    if (!currentSocket || currentSocket === socketBound) return Boolean(currentSocket);
    socketBound = currentSocket;
    currentSocket.on('presence', updateTotalMemberCount);
    return true;
  }

  function patchRenderPresence() {
    try {
      if (typeof renderPresence !== 'function' || renderPresence.__sawalefTotalPatched) return;
      const original = renderPresence;
      const wrapped = function (list = []) {
        const result = original(list);
        updateTotalMemberCount(list);
        return result;
      };
      wrapped.__sawalefTotalPatched = true;
      renderPresence = wrapped;
    } catch {}
  }

  function polishRoom() {
    // Notifications live in the lobby now. Keep any legacy room button out of the layout.
    $('callNotifyBtn')?.setAttribute('aria-hidden', 'true');
    ensureChatUsable();
    wrapVoiceActions();
  }

  ensureLobbyNotificationButton();
  patchRenderPresence();
  ensureChatUsable();
  syncNotificationButton();

  document.addEventListener('sawalef:room-runtime-ready', polishRoom);
  document.addEventListener('visibilitychange', syncNotificationButton);
  window.addEventListener('focus', syncNotificationButton);

  const bindTimer = setInterval(() => {
    ensureLobbyNotificationButton();
    patchRenderPresence();
    ensureChatUsable();
    if (bindPresence() && voiceWrapped) clearInterval(bindTimer);
  }, 700);
  setTimeout(() => clearInterval(bindTimer), 20000);
})();

(() => {
  if (window.__sawalefNativeAndroidV21) return;
  window.__sawalefNativeAndroidV21 = true;

  const $ = id => document.getElementById(id);
  let nativeSharing = false;
  let nativeStarting = false;

  function toast(text) {
    try { showToast(text); } catch {}
  }
  function nativeBridge() {
    try { return window.SawalefNative || null; } catch { return null; }
  }
  function nativeScreenAvailable() {
    try { return Boolean(nativeBridge()?.isScreenShareAvailable?.()); } catch { return false; }
  }
  function currentRoomId() {
    try { return String(roomId || ''); } catch { return ''; }
  }
  function currentSocket() {
    try { return socket || null; } catch { return null; }
  }

  function syncNativeClass() {
    const btn = $('screenShareBtn');
    document.documentElement.classList.toggle('sawalef-native-app', nativeScreenAvailable());
    if (!btn) return;
    btn.classList.toggle('native-screen-active', nativeSharing);
    btn.classList.toggle('native-screen-starting', nativeStarting);
    if (nativeSharing) {
      btn.title = 'إيقاف مشاركة الشاشة';
      btn.setAttribute('aria-label', 'إيقاف مشاركة الشاشة');
    }
  }

  function openNativeSettings() {
    const modal = $('screenSettingsModal');
    if (!modal) return toast('انتظر تجهيز أدوات المكالمة ثم جرّب مرة ثانية.');
    const note = $('screenCapabilityNote');
    if (note) note.textContent = 'تطبيق سوالف يستخدم مشاركة شاشة Android الأصلية. المشاركة تستمر عند الانتقال لتطبيق آخر، والدقة والفريمات تُطبق بأعلى قيمة يدعمها الجهاز والشبكة.';
    modal.classList.remove('hidden');
  }

  function tokenForNativeScreen(room) {
    return new Promise((resolve, reject) => {
      const s = currentSocket();
      if (!s?.connected) return reject(new Error('غير متصل بالسيرفر.'));
      const timer = setTimeout(() => reject(new Error('تأخر تجهيز مشاركة الشاشة.')), 8000);
      s.emit('livekit:native-screen-token', { roomId: room }, res => {
        clearTimeout(timer);
        if (res?.ok && res.url && res.token) resolve(res);
        else reject(new Error(res?.error || 'تعذر تجهيز مشاركة الشاشة.'));
      });
    });
  }

  async function startNativeShare() {
    if (nativeSharing || nativeStarting) return;
    const room = currentRoomId();
    if (!room) return toast('ادخل المجموعة أولًا.');
    const bridge = nativeBridge();
    if (!bridge || !nativeScreenAvailable()) return toast('مشاركة Android الأصلية غير متاحة في هذه النسخة من التطبيق.');

    const quality = $('screenQualitySelect')?.value || '1080';
    const fps = Math.max(15, Math.min(144, Number($('screenFpsSelect')?.value || 60)));
    const audio = Boolean($('screenAudioCheck')?.checked);
    const mode = $('screenModeSelect')?.value || 'motion';
    const startBtn = $('screenStartShare');
    const oldText = startBtn?.textContent || '';
    if (startBtn) { startBtn.disabled = true; startBtn.textContent = 'جاري تجهيز مشاركة Android…'; }
    nativeStarting = true;
    syncNativeClass();

    try {
      const auth = await tokenForNativeScreen(room);
      const payload = JSON.stringify({
        url: auth.url,
        token: auth.token,
        roomId: room,
        identity: auth.identity || '',
        name: auth.name || '',
        quality,
        fps,
        audio,
        mode,
      });
      const accepted = bridge.startScreenShare(payload);
      if (accepted === false) throw new Error('تعذر فتح نافذة مشاركة شاشة Android.');
      $('screenSettingsModal')?.classList.add('hidden');
      toast('اختر بدء المشاركة من نافذة Android.');
    } catch (e) {
      nativeStarting = false;
      syncNativeClass();
      toast(e?.message || 'تعذر بدء مشاركة الشاشة.');
    } finally {
      if (startBtn) { startBtn.disabled = false; startBtn.textContent = oldText || 'ابدأ المشاركة'; }
    }
  }

  function stopNativeShare() {
    if (!nativeSharing && !nativeStarting) return;
    try { nativeBridge()?.stopScreenShare?.(); } catch {}
    nativeStarting = false;
    syncNativeClass();
  }

  window.SawalefNativeScreenShareStatus = status => {
    status = status || {};
    const state = String(status.state || '');
    if (state === 'started') {
      nativeStarting = false;
      nativeSharing = true;
      currentSocket()?.emit?.('screen-share-state', { active:true, native:true, quality:status.quality || '', fps:Number(status.fps || 0) || undefined });
      toast(`بدأت مشاركة شاشة الجوال${status.fps ? ` • ${status.fps} FPS` : ''}.`);
    } else if (state === 'stopped' || state === 'cancelled') {
      const wasActive = nativeSharing || nativeStarting;
      nativeStarting = false;
      nativeSharing = false;
      currentSocket()?.emit?.('screen-share-state', { active:false, native:true });
      if (wasActive && state === 'stopped') toast('تم إيقاف مشاركة شاشة الجوال.');
    } else if (state === 'error') {
      nativeStarting = false;
      nativeSharing = false;
      currentSocket()?.emit?.('screen-share-state', { active:false, native:true });
      toast(status.message || 'تعذر تشغيل مشاركة شاشة Android.');
    }
    syncNativeClass();
  };

  async function enterFullscreen(card, video) {
    try {
      if (card?.requestFullscreen) {
        try { await card.requestFullscreen({ navigationUI:'hide' }); }
        catch { await card.requestFullscreen(); }
        try { await screen.orientation?.lock?.('landscape'); } catch {}
        return;
      }
      if (video?.webkitEnterFullscreen) video.webkitEnterFullscreen();
    } catch {
      toast('تعذر فتح وضع ملء الشاشة على هذا الجهاز.');
    }
  }

  // Capture before room-experience-v10's onclick handlers. Browser share remains unchanged
  // outside the APK; only the Android WebView is redirected to MediaProjection.
  document.addEventListener('click', e => {
    const full = e.target.closest?.('.screen-fullscreen');
    if (full) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const card = full.closest('.screen-share-card');
      enterFullscreen(card, card?.querySelector('video'));
      return;
    }

    if (!nativeScreenAvailable()) return;
    const screenBtn = e.target.closest?.('#screenShareBtn');
    if (screenBtn) {
      e.preventDefault();
      e.stopImmediatePropagation();
      nativeSharing || nativeStarting ? stopNativeShare() : openNativeSettings();
      return;
    }
    const startBtn = e.target.closest?.('#screenStartShare');
    if (startBtn) {
      e.preventDefault();
      e.stopImmediatePropagation();
      startNativeShare();
    }
  }, true);

  document.addEventListener('fullscreenchange', () => {
    document.documentElement.classList.toggle('sawalef-screen-fullscreen', Boolean(document.fullscreenElement));
    if (!document.fullscreenElement) {
      try { screen.orientation?.unlock?.(); } catch {}
    }
  });

  const roomPage = $('roomPage');
  if (roomPage) {
    new MutationObserver(() => {
      if (roomPage.classList.contains('hidden') && (nativeSharing || nativeStarting)) stopNativeShare();
    }).observe(roomPage, { attributes:true, attributeFilter:['class'] });
  }

  // v10 refreshes button markup frequently; CSS owns the native active label/color.
  setInterval(syncNativeClass, 650);
  syncNativeClass();
})();

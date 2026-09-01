(() => {
  if (window.__sawalefRoomRuntimeLoader) return;
  window.__sawalefRoomRuntimeLoader = true;

  const VERSION = '13';
  let roomRuntimePromise = null;
  let adminMonitorPromise = null;

  function addCss(href, key) {
    if (document.querySelector(`link[data-sawalef-lazy="${key}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.sawalefLazy = key;
    document.head.appendChild(link);
  }

  function loadScript(src, key, timeoutMs = 8000) {
    const existing = document.querySelector(`script[data-sawalef-lazy="${key}"]`);
    if (existing?.dataset.loaded === '1') return Promise.resolve();
    if (existing?.__loadPromise) return existing.__loadPromise;

    const script = existing || document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.sawalefLazy = key;

    script.__loadPromise = new Promise((resolve, reject) => {
      let done = false;
      const finish = (ok, err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (ok) {
          script.dataset.loaded = '1';
          resolve();
        } else {
          try { script.remove(); } catch {}
          reject(err || new Error(`تعذر تحميل ${key}`));
        }
      };
      const timer = setTimeout(() => finish(false, new Error(`انتهت مهلة تحميل ${key}`)), timeoutMs);
      script.onload = () => finish(true);
      script.onerror = () => finish(false, new Error(`فشل تحميل ${key}`));
    });

    if (!existing) document.head.appendChild(script);
    return script.__loadPromise;
  }

  async function loadLiveKit() {
    if (window.LivekitClient?.Room) return;
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/livekit-client@2.22.1/dist/livekit-client.umd.min.js', 'livekit-jsdelivr', 5000);
    } catch {
      await loadScript('https://unpkg.com/livekit-client@2.22.1/dist/livekit-client.umd.min.js', 'livekit-unpkg', 5000);
    }
    if (!window.LivekitClient?.Room) throw new Error('مكتبة LiveKit لم تبدأ.');
  }

  async function loadRoomRuntime() {
    if (roomRuntimePromise) return roomRuntimePromise;
    roomRuntimePromise = (async () => {
      addCss(`/advanced-call-v4.css?v=${VERSION}`, 'advanced-call-css');
      addCss(`/room-experience-v10.css?v=${VERSION}`, 'room-experience-css');

      // Local setup can load immediately while the external LiveKit package downloads in parallel.
      const localPrep = loadScript(`/audio-ultra.js?v=${VERSION}`, 'audio-ultra');
      const liveKit = loadLiveKit();
      await Promise.all([localPrep, liveKit]);

      // Order matters: voice creates SawalefLiveKit, then fixes/features attach to it.
      await loadScript(`/voice-v3.js?v=${VERSION}`, 'voice-v3');
      await loadScript(`/livekit-audio-fix.js?v=${VERSION}`, 'livekit-audio-fix');
      await loadScript(`/advanced-call-v4.js?v=${VERSION}`, 'advanced-call-v4');
      await loadScript(`/compat-v10.js?v=${VERSION}`, 'compat-v10');
      await loadScript(`/room-experience-v10.js?v=${VERSION}`, 'room-experience-v10');

      document.dispatchEvent(new CustomEvent('sawalef:room-runtime-ready'));
    })().catch(err => {
      roomRuntimePromise = null;
      console.error('Sawalef room runtime failed:', err);
      try { showToast?.('تعذر تجهيز المكالمة الآن — الشات والقروبات ما زالت شغالة.'); } catch {}
      throw err;
    });
    return roomRuntimePromise;
  }

  function maybeLoadRoomRuntime() {
    const roomPage = document.getElementById('roomPage');
    const visible = roomPage && !roomPage.classList.contains('hidden');
    let hasRoom = false;
    try { hasRoom = Boolean(roomId); } catch {}
    if (visible || hasRoom) loadRoomRuntime().catch(() => {});
  }

  const roomPage = document.getElementById('roomPage');
  if (roomPage) {
    new MutationObserver(maybeLoadRoomRuntime).observe(roomPage, { attributes: true, attributeFilter: ['class'] });
  }

  // The admin LiveKit monitor is only needed if the admin actually opens the panel.
  function loadAdminMonitor() {
    if (adminMonitorPromise) return adminMonitorPromise;
    adminMonitorPromise = loadScript(`/livekit-admin-monitor.js?v=${VERSION}`, 'livekit-admin-monitor').catch(err => {
      adminMonitorPromise = null;
      throw err;
    });
    return adminMonitorPromise;
  }
  document.getElementById('adminBtn')?.addEventListener('click', () => loadAdminMonitor().catch(() => {}), { passive: true });

  // Initial check handles invite/direct-entry flows.
  queueMicrotask(maybeLoadRoomRuntime);

  window.SawalefRuntimeLoader = { loadRoomRuntime, loadAdminMonitor };
})();
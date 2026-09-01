(() => {
  if (window.__sawalefRoomRuntimeLoader) return;
  window.__sawalefRoomRuntimeLoader = true;

  const VERSION = '14';
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

  function loadScript(src, key, timeoutMs = 6000) {
    const existing = document.querySelector(`script[data-sawalef-lazy="${key}"]`);
    if (existing?.dataset.loaded === '1') return Promise.resolve();
    if (existing?.__loadPromise) return existing.__loadPromise;

    const script = existing || document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.sawalefLazy = key;
    script.__loadPromise = new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => finish(false, new Error(`انتهت مهلة تحميل ${key}`)), timeoutMs);
      function finish(ok, err) {
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
      }
      script.onload = () => finish(true);
      script.onerror = () => finish(false, new Error(`فشل تحميل ${key}`));
    });
    if (!existing) document.head.appendChild(script);
    return script.__loadPromise;
  }

  async function loadLiveKitLocal() {
    if (window.LivekitClient?.Room) return;
    await loadScript(`/vendor/livekit-client.umd.min.js?v=${VERSION}`, 'livekit-local', 6000);
    if (!window.LivekitClient?.Room) throw new Error('مكتبة LiveKit المحلية لم تبدأ.');
  }

  const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  async function loadRoomRuntime() {
    if (roomRuntimePromise) return roomRuntimePromise;
    roomRuntimePromise = (async () => {
      const started = performance.now();
      document.documentElement.dataset.roomRuntime = 'loading';

      addCss(`/advanced-call-v4.css?v=${VERSION}`, 'room-data-css');
      addCss(`/room-experience-v10.css?v=${VERSION}`, 'room-experience-css');
      addCss(`/room-experience-v11.css?v=${VERSION}`, 'room-experience-v11-css');

      // Let the room paint first. Loading the voice stack must never freeze navigation into a group.
      await nextPaint();

      // LiveKit is served from this Render service now; room entry no longer waits on jsDelivr/unpkg.
      await loadLiveKitLocal();
      await loadScript(`/voice-v3.js?v=${VERSION}`, 'voice-v3');
      document.dispatchEvent(new CustomEvent('sawalef:voice-core-ready'));

      // Independent lightweight features can initialize together.
      await Promise.all([
        loadScript(`/livekit-audio-fix.js?v=${VERSION}`, 'livekit-audio-fix'),
        loadScript(`/room-data-v1.js?v=${VERSION}`, 'room-data-v1'),
        loadScript(`/room-perf-v1.js?v=${VERSION}`, 'room-perf-v1'),
      ]);

      // One screen-share/control implementation only. v11 is explicitly loaded after v10.
      await loadScript(`/room-experience-v10.js?v=${VERSION}`, 'room-experience-v10');
      await loadScript(`/room-experience-v11.js?v=${VERSION}`, 'room-experience-v11');

      document.documentElement.dataset.roomRuntime = 'ready';
      window.__sawalefRoomRuntimeMs = Math.round(performance.now() - started);
      document.dispatchEvent(new CustomEvent('sawalef:room-runtime-ready', { detail: { ms: window.__sawalefRoomRuntimeMs } }));
    })().catch(err => {
      roomRuntimePromise = null;
      document.documentElement.dataset.roomRuntime = 'failed';
      console.error('Sawalef room runtime failed:', err);
      try { showToast?.('تعذر تجهيز المكالمة الآن — القروب والشات ما زالوا يعملون.'); } catch {}
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
  if (roomPage) new MutationObserver(maybeLoadRoomRuntime).observe(roomPage, { attributes: true, attributeFilter: ['class'] });

  function loadAdminMonitor() {
    if (adminMonitorPromise) return adminMonitorPromise;
    adminMonitorPromise = loadScript(`/livekit-admin-monitor.js?v=${VERSION}`, 'livekit-admin-monitor').catch(err => {
      adminMonitorPromise = null;
      throw err;
    });
    return adminMonitorPromise;
  }
  document.getElementById('adminBtn')?.addEventListener('click', () => loadAdminMonitor().catch(() => {}), { passive: true });

  queueMicrotask(maybeLoadRoomRuntime);
  window.SawalefRuntimeLoader = { loadRoomRuntime, loadAdminMonitor };
})();

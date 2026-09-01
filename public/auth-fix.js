(async () => {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    const cfg = await res.json();
    const area = document.getElementById('googleArea');
    const divider = document.querySelector('.auth-card .divider');
    const fallback = document.getElementById('googleFallback');
    if (!area) return;

    const enabled = Boolean(cfg.googleClientId);
    area.classList.toggle('hidden', !enabled);
    if (divider) divider.classList.toggle('hidden', !enabled);
    if (!enabled || !fallback) return;

    area.style.minHeight = '44px';

    const hasOfficialGoogleButton = () => Boolean(
      area.querySelector('iframe') ||
      area.querySelector('[role="button"]') ||
      area.querySelector('.g_id_signin')
    );

    const syncGoogleVisibility = () => {
      const ready = hasOfficialGoogleButton();
      if (ready) {
        if (!fallback.classList.contains('hidden')) fallback.classList.add('hidden');
      } else {
        if (fallback.classList.contains('hidden')) fallback.classList.remove('hidden');
      }
    };

    const renderStableGoogleButton = () => {
      if (!window.google?.accounts?.id || hasOfficialGoogleButton()) {
        syncGoogleVisibility();
        return;
      }

      let holder = document.getElementById('googleStableHolder');
      if (!holder) {
        holder = document.createElement('div');
        holder.id = 'googleStableHolder';
        holder.style.width = '100%';
        holder.style.display = 'flex';
        holder.style.justifyContent = 'center';
        area.appendChild(holder);
      }

      try {
        google.accounts.id.initialize({
          client_id: cfg.googleClientId,
          callback: (resp) => window.handleGoogle?.(resp),
        });
        google.accounts.id.renderButton(holder, {
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          width: 320,
          locale: 'ar',
        });
      } catch {}

      requestAnimationFrame(() => setTimeout(syncGoogleVisibility, 80));
    };

    const ensureGoogleSdk = () => {
      if (window.google?.accounts?.id) {
        renderStableGoogleButton();
        return;
      }

      let script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', renderStableGoogleButton, { once: true });
    };

    syncGoogleVisibility();
    const observer = new MutationObserver(syncGoogleVisibility);
    observer.observe(area, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });

    fallback.onclick = () => {
      ensureGoogleSdk();
      setTimeout(syncGoogleVisibility, 1200);
    };

    ensureGoogleSdk();
    setTimeout(syncGoogleVisibility, 1500);
    setTimeout(syncGoogleVisibility, 4000);
  } catch {}
})();

(() => {
  for (const src of ['/livekit-audio-fix.js?v=2', '/livekit-admin-monitor.js?v=2']) {
    if (document.querySelector(`script[src^="${src.split('?')[0]}"]`)) continue;
    const s = document.createElement('script');
    s.src = src;
    s.defer = true;
    document.body.appendChild(s);
  }
})();

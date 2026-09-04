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
      fallback.classList.toggle('hidden', ready);
    };

    // app.js is the single owner of Google Identity initialization/rendering.
    // This helper only keeps the fallback visibility in sync so a second
    // Google button can never be rendered by a competing initializer.
    syncGoogleVisibility();
    const observer = new MutationObserver(syncGoogleVisibility);
    observer.observe(area, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });

    setTimeout(syncGoogleVisibility, 1500);
    setTimeout(syncGoogleVisibility, 4000);
  } catch {}
})();

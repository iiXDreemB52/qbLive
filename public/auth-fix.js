(async () => {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    const cfg = await res.json();
    const area = document.getElementById('googleArea');
    const divider = document.querySelector('.auth-card .divider');
    if (!area) return;
    const enabled = Boolean(cfg.googleClientId);
    area.classList.toggle('hidden', !enabled);
    if (divider) divider.classList.toggle('hidden', !enabled);
  } catch {}
})();

(() => {
  const s = document.createElement('script');
  s.src = '/audio-ultra.js?v=1';
  s.async = false;
  document.body.appendChild(s);
})();

(() => {
  if (window.__sawalefBootGuardV12) return;
  window.__sawalefBootGuardV12 = true;

  // Version query strings were only used to force-refresh old browser caches.
  // Keep one public Sawalef URL: strip only ?v=... while preserving invite params such as ?join=...
  try {
    const url = new URL(location.href);
    if (url.searchParams.has('v')) {
      url.searchParams.delete('v');
      const search = url.searchParams.toString();
      history.replaceState(history.state, '', url.pathname + (search ? '?' + search : '') + url.hash);
    }
  } catch {}

  const boot = document.getElementById('bootPage');
  let finished = false;

  function storedToken() {
    try { return localStorage.getItem('sawalef_token') || sessionStorage.getItem('sawalef_token') || ''; }
    catch { return ''; }
  }

  function runtimeState() {
    let runtimeToken = '', user = null;
    try { runtimeToken = typeof token === 'string' ? token : ''; } catch {}
    try { user = typeof me !== 'undefined' ? me : null; } catch {}
    return { runtimeToken, user };
  }

  function reveal(force = false) {
    if (finished) return true;
    const stored = storedToken();
    const { runtimeToken, user } = runtimeState();
    const ready = Boolean(user) || (!stored && !runtimeToken);
    if (!ready && !force) return false;

    finished = true;
    document.body.classList.remove('booting');
    boot?.classList.add('hidden');

    if (force && !user) {
      try {
        if (typeof showPage === 'function') showPage('auth');
      } catch {}
      try {
        if ((stored || runtimeToken) && typeof showToast === 'function') {
          showToast('تأخر استعادة الجلسة — تقدر تعيد المحاولة بدون ما تعلق الصفحة.');
        }
      } catch {}
    }
    return true;
  }

  // Fast path: no stored session means there is nothing to restore.
  setTimeout(() => reveal(false), 0);

  const poll = setInterval(() => {
    if (reveal(false)) clearInterval(poll);
  }, 100);

  // Absolute safety net: never leave the user trapped on the splash screen.
  setTimeout(() => {
    clearInterval(poll);
    reveal(true);
  }, 4500);

  window.addEventListener('error', () => setTimeout(() => reveal(true), 3500), { once: true });
  window.addEventListener('unhandledrejection', () => setTimeout(() => reveal(true), 3500), { once: true });
})();

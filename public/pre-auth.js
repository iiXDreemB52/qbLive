(() => {
  try {
    const persistent = localStorage.getItem('sawalef_token');
    const sessionOnly = sessionStorage.getItem('sawalef_token');
    if (!persistent && sessionOnly) {
      localStorage.setItem('sawalef_token', sessionOnly);
      sessionStorage.setItem('sawalef_session_bridge', '1');
    }
  } catch {}
})();

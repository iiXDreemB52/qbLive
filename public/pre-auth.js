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

(() => {
  // Socket.IO is used for group presence, room entry and chat. On some mobile
  // networks/Render edges, starting with WebSocket can stall before fallback.
  // Start with polling, then upgrade to WebSocket once the Engine.IO session is
  // established. This keeps room navigation responsive without changing the
  // rest of the app's socket logic.
  const originalIo = window.io;
  if (typeof originalIo !== 'function' || window.__sawalefStableIo) return;
  window.__sawalefStableIo = true;

  const wrapOptions = (input = {}) => ({
    ...input,
    transports: ['polling', 'websocket'],
    upgrade: true,
    tryAllTransports: true,
    rememberUpgrade: false,
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelay: 450,
    reconnectionDelayMax: 4000,
    randomizationFactor: 0.25,
    timeout: 10000,
  });

  window.io = new Proxy(originalIo, {
    apply(target, thisArg, args) {
      const next = [...args];
      if (typeof next[0] === 'string' || next[0] instanceof URL) {
        next[1] = wrapOptions(next[1] && typeof next[1] === 'object' ? next[1] : {});
      } else {
        next[0] = wrapOptions(next[0] && typeof next[0] === 'object' ? next[0] : {});
      }

      const socket = Reflect.apply(target, thisArg, next);
      const diag = window.__sawalefSocketDiag = {
        state: 'connecting',
        transport: '',
        attempts: 0,
        lastError: '',
        connectedAt: 0,
      };

      socket.on('connect', () => {
        diag.state = 'connected';
        diag.connectedAt = Date.now();
        diag.lastError = '';
        try { diag.transport = socket.io?.engine?.transport?.name || ''; } catch {}
      });
      socket.on('connect_error', err => {
        diag.state = 'connect_error';
        diag.lastError = String(err?.message || err || 'unknown');
      });
      socket.io?.on?.('reconnect_attempt', attempt => {
        diag.state = 'reconnecting';
        diag.attempts = Number(attempt || 0);
      });
      socket.io?.on?.('upgrade', transport => {
        try { diag.transport = transport?.name || socket.io?.engine?.transport?.name || ''; } catch {}
      });
      socket.on('disconnect', reason => {
        diag.state = 'disconnected';
        diag.lastError = String(reason || '');
      });

      return socket;
    },
  });
})();

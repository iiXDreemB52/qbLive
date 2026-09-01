(() => {
  if (window.__sawalefRoomPerfV1) return;
  window.__sawalefRoomPerfV1 = true;

  const nativeAppendChild = Node.prototype.appendChild;
  const controlOrder = ['chatToggle', 'callNotifyBtn', 'screenShareBtn', 'joinVoice', 'muteBtn', 'leaveVoice', 'deafenBtn'];

  function controlsAlreadyOrdered(parent) {
    if (!(parent instanceof Element) || !parent.classList.contains('room-controls')) return false;
    const ids = [...parent.children].map(el => el.id).filter(Boolean);
    const relevant = ids.filter(id => controlOrder.includes(id));
    const expected = controlOrder.filter(id => document.getElementById(id)?.parentElement === parent);
    return relevant.length === expected.length && relevant.every((id, i) => id === expected[i]);
  }

  Node.prototype.appendChild = function sawalefAppendChild(child) {
    if (this instanceof Element && this.classList.contains('room-controls') && child?.parentNode === this && controlsAlreadyOrdered(this)) {
      return child;
    }
    return nativeAppendChild.call(this, child);
  };

  // Lightweight diagnostics for automated/live testing. No polling is added.
  window.__sawalefRoomPerf = { longTasks: 0, maxLongTaskMs: 0 };
  try {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        window.__sawalefRoomPerf.longTasks += 1;
        window.__sawalefRoomPerf.maxLongTaskMs = Math.max(window.__sawalefRoomPerf.maxLongTaskMs, Math.round(entry.duration));
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  } catch {}
})();

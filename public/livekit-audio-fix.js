(() => {
  const rack = document.getElementById('audioRack');
  if (rack) {
    rack.style.display = 'block';
    rack.style.position = 'fixed';
    rack.style.width = '1px';
    rack.style.height = '1px';
    rack.style.opacity = '0';
    rack.style.pointerEvents = 'none';
    rack.style.overflow = 'hidden';
    rack.style.left = '-9999px';
    rack.style.bottom = '0';
  }

  let lastRoom = null;
  let lastPlaybackToast = 0;

  function currentRoom() {
    return window.SawalefLiveKit?.active ? window.SawalefLiveKit.room : null;
  }

  async function unlockAudio() {
    const room = currentRoom();
    if (!room) return;
    try { await room.startAudio?.(); } catch {}
    document.querySelectorAll('audio[data-livekit-audio="1"]').forEach((el) => {
      el.autoplay = true;
      el.playsInline = true;
      if (!el.muted) el.volume = 1;
      el.play?.().catch(() => {});
    });
  }

  document.addEventListener('pointerdown', unlockAudio, { passive: true, capture: true });
  document.addEventListener('touchstart', unlockAudio, { passive: true, capture: true });
  document.addEventListener('click', unlockAudio, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) unlockAudio(); });

  setInterval(() => {
    const room = currentRoom();
    if (!room) { lastRoom = null; return; }
    if (room !== lastRoom) {
      lastRoom = room;
      try {
        room.on?.(window.LivekitClient?.RoomEvent?.AudioPlaybackStatusChanged, () => {
          if (room.canPlaybackAudio === false && Date.now() - lastPlaybackToast > 5000) {
            lastPlaybackToast = Date.now();
            if (typeof showToast === 'function') showToast('اضغط أي مكان مرة واحدة لتفعيل سماع الصوت.');
          }
        });
      } catch {}
    }
    unlockAudio();
  }, 1500);
})();

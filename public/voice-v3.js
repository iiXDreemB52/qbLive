(() => {
  const lk = window.LivekitClient;
  if (!lk?.Room) {
    console.error('LiveKit client unavailable');
    return;
  }

  let room = null;
  let connectedRoomId = '';
  let connecting = null;
  let joiningMic = null;
  let serverMuted = false;
  let playbackBlocked = false;
  let listenerRetryDelay = 1500;
  let nextListenerRetryAt = 0;
  const remoteAudio = new Map();
  const speaking = new Set();
  const rack = document.getElementById('audioRack');

  if (rack) {
    Object.assign(rack.style, {
      display: 'block', position: 'fixed', width: '1px', height: '1px', opacity: '0',
      pointerEvents: 'none', overflow: 'hidden', left: '-9999px', bottom: '0'
    });
  }

  function withTimeout(promise, ms, message) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(message || 'انتهت مهلة العملية.');
        err.code = 'SAWALEF_TIMEOUT';
        reject(err);
      }, ms);
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
  }

  function diag(phase, extra = {}) {
    try {
      socket?.emit('livekit:diagnostic', {
        phase,
        state: room?.state || room?.connectionState || '',
        localIdentity: room?.localParticipant?.identity || '',
        remoteParticipants: room?.remoteParticipants?.size || 0,
        canPlaybackAudio: typeof room?.canPlaybackAudio === 'boolean' ? room.canPlaybackAudio : null,
        ...extra,
      });
      socket?.emit('livekit:client-state', {
        state: room?.state || room?.connectionState || (room ? 'connected' : 'idle'),
        quality: room ? 'connected' : 'idle',
        remoteParticipants: room?.remoteParticipants?.size || 0,
        subscribedAudio: remoteAudio.size,
        canPlaybackAudio: typeof room?.canPlaybackAudio === 'boolean' ? room.canPlaybackAudio : null,
        active: Boolean(room),
        error: extra.error || '',
      });
    } catch {}
  }

  function captureOptions() {
    // Keep capture constraints conservative. Opus is still published at 48 kHz by WebRTC,
    // but we avoid forcing device-specific sample-rate / voice-isolation constraints that
    // have caused getUserMedia stalls on some Android browsers.
    const s = navigator.mediaDevices?.getSupportedConstraints?.() || {};
    const o = {};
    if (s.echoCancellation) o.echoCancellation = true;
    if (s.noiseSuppression) o.noiseSuppression = true;
    if (s.autoGainControl) o.autoGainControl = true;
    if (s.channelCount) o.channelCount = 1;
    return o;
  }

  function publishOptions() {
    return {
      audioPreset: { maxBitrate: 96000, priority: 'high' },
      dtx: true,
      red: true,
      forceStereo: false,
      stopMicTrackOnMute: false,
    };
  }

  function requestToken(targetRoom) {
    return new Promise(resolve => {
      if (!socket?.connected) return resolve({ ok: false, configured: false, error: 'السيرفر غير متصل.' });
      let done = false;
      const timer = setTimeout(() => {
        if (!done) { done = true; resolve({ ok: false, configured: false, error: 'انتهت مهلة تجهيز الصوت.' }); }
      }, 6000);
      socket.emit('livekit:token', { roomId: targetRoom }, res => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(res || { ok: false, configured: false });
      });
    });
  }

  async function play(el) {
    if (!el) return false;
    try {
      el.muted = deafened;
      el.volume = 1;
      await room?.startAudio?.();
      await el.play();
      playbackBlocked = false;
      return true;
    } catch (e) {
      playbackBlocked = true;
      diag('playback-blocked', { error: String(e?.name || e?.message || e).slice(0, 120) });
      return false;
    }
  }

  async function unlockAudio() {
    if (!room) return;
    try { await room.startAudio?.(); } catch {}
    for (const el of remoteAudio.values()) await play(el);
    if (playbackBlocked && room?.canPlaybackAudio === false) showToast('اضغط مرة واحدة لتفعيل سماع الصوت.');
  }

  for (const event of ['pointerdown', 'touchstart', 'click']) {
    document.addEventListener(event, unlockAudio, { passive: true, capture: true });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) unlockAudio(); });

  function attachAudio(track, participant) {
    if (!track || remoteAudio.has(track)) return;
    const el = document.createElement('audio');
    el.autoplay = true;
    el.playsInline = true;
    el.controls = false;
    el.muted = deafened;
    el.volume = 1;
    el.dataset.livekitAudio = '1';
    if (participant?.identity) el.dataset.participant = participant.identity;
    try { track.attach(el); } catch (e) { return diag('attach-failed', { error: String(e?.message || e).slice(0, 160) }); }
    rack?.appendChild(el);
    remoteAudio.set(track, el);
    diag('track-subscribed', {
      participant: participant?.identity || '',
      trackSid: track.sid || '',
      trackState: track.mediaStreamTrack?.readyState || '',
      trackEnabled: track.mediaStreamTrack?.enabled !== false,
    });
    play(el).then(ok => { if (!ok) showToast('الصوت وصل لكن المتصفح حاجب التشغيل — اضغط أي مكان مرة واحدة.'); });
  }

  function detachAudio(track) {
    const el = remoteAudio.get(track);
    if (!el) return;
    try { track.detach(el); } catch {}
    try { el.pause(); el.srcObject = null; el.remove(); } catch {}
    remoteAudio.delete(track);
  }

  function clearAudio() {
    for (const track of [...remoteAudio.keys()]) detachAudio(track);
  }

  function speakerElement(identity) {
    const id = String(identity || '');
    const p = Array.isArray(currentPresence) ? currentPresence.find(u => String(u.id || '') === id) : null;
    return p ? document.getElementById(`speaker-${p.id}`) : null;
  }

  function paintSpeaking() {
    document.querySelectorAll('#voiceStage .speaker').forEach(el => el.classList.remove('speaking'));
    for (const id of speaking) speakerElement(id)?.classList.add('speaking');
  }

  function setActiveSpeakers(list = []) {
    speaking.clear();
    for (const p of list) if (p?.identity) speaking.add(String(p.identity));
    paintSpeaking();
  }

  const stage = document.getElementById('voiceStage');
  if (stage) new MutationObserver(paintSpeaking).observe(stage, { childList: true, subtree: true });

  function wire(r) {
    r.on(lk.RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      if (track.kind === 'audio' || track.kind === lk.Track?.Kind?.Audio) attachAudio(track, participant);
    });
    r.on(lk.RoomEvent.TrackUnsubscribed, track => detachAudio(track));
    r.on(lk.RoomEvent.TrackSubscriptionFailed, (sid, participant, error) => diag('subscription-failed', {
      trackSid: sid || '', participant: participant?.identity || '', error: String(error?.message || error || '').slice(0, 160)
    }));
    r.on(lk.RoomEvent.ParticipantConnected, p => diag('participant-connected', { participant: p?.identity || '' }));
    r.on(lk.RoomEvent.ParticipantDisconnected, p => diag('participant-disconnected', { participant: p?.identity || '' }));
    if (lk.RoomEvent.ActiveSpeakersChanged) r.on(lk.RoomEvent.ActiveSpeakersChanged, setActiveSpeakers);
    if (lk.RoomEvent.AudioPlaybackStatusChanged) r.on(lk.RoomEvent.AudioPlaybackStatusChanged, () => {
      playbackBlocked = r.canPlaybackAudio === false;
      diag('playback-status', { canPlaybackAudio: r.canPlaybackAudio });
    });
    r.on(lk.RoomEvent.Disconnected, reason => {
      diag('disconnected', { reason: String(reason || '').slice(0, 100) });
      clearAudio();
      speaking.clear();
      paintSpeaking();
      if (room === r) {
        room = null;
        connectedRoomId = '';
        nextListenerRetryAt = Date.now() + listenerRetryDelay;
      }
    });
  }

  function attachExisting(r) {
    try {
      for (const p of r.remoteParticipants.values()) {
        for (const publication of p.audioTrackPublications.values()) if (publication.track) attachAudio(publication.track, p);
      }
    } catch {}
  }

  async function disconnectRoom() {
    const old = room;
    room = null;
    connectedRoomId = '';
    clearAudio();
    speaking.clear();
    paintSpeaking();
    if (old) {
      try { await withTimeout(old.disconnect(), 2500, 'تأخر إغلاق اتصال الصوت.'); } catch {}
    }
    diag('listener-disconnected');
  }

  async function connectListener(targetRoom = roomId) {
    targetRoom = String(targetRoom || '');
    if (!targetRoom || !socket?.connected) return false;

    const currentState = String(room?.state || room?.connectionState || '').toLowerCase();
    if (room && connectedRoomId === targetRoom && currentState === 'connected') return true;
    if (connecting) return connecting;

    connecting = (async () => {
      let candidate = null;
      try {
        if (room) await disconnectRoom();
        const auth = await requestToken(targetRoom);
        if (!auth?.configured) throw new Error(auth?.error || 'LiveKit غير مجهز على السيرفر.');
        if (!auth.ok) throw new Error(auth.error || 'تعذر تجهيز LiveKit.');

        candidate = new lk.Room({
          adaptiveStream: false,
          dynacast: false,
          disconnectOnPageLeave: true,
          audioCaptureDefaults: captureOptions(),
          publishDefaults: publishOptions(),
        });
        wire(candidate);
        room = candidate;

        await withTimeout(
          candidate.connect(auth.url, auth.token, { autoSubscribe: true }),
          10000,
          'اتصال المكالمة تأخر. حاول مرة ثانية.'
        );

        if (room !== candidate) {
          try { await candidate.disconnect(); } catch {}
          return false;
        }

        connectedRoomId = targetRoom;
        listenerRetryDelay = 1500;
        nextListenerRetryAt = 0;
        diag('listener-connected', { tokenIdentity: auth.identity || '' });
        attachExisting(candidate);
        await unlockAudio();
        return true;
      } catch (e) {
        console.error('LiveKit listener connect failed:', e);
        diag('listener-failed', { error: String(e?.message || e).slice(0, 180) });
        if (room === candidate || room) await disconnectRoom();
        listenerRetryDelay = Math.min(15000, Math.max(1500, listenerRetryDelay * 2));
        nextListenerRetryAt = Date.now() + listenerRetryDelay;
        return false;
      } finally {
        connecting = null;
      }
    })();

    return connecting;
  }

  function setMicUi(speakingMode) {
    const join = document.getElementById('joinVoice');
    const mute = document.getElementById('muteBtn');
    const leave = document.getElementById('leaveVoice');
    join?.classList.toggle('hidden', speakingMode);
    mute?.classList.toggle('hidden', !speakingMode);
    leave?.classList.toggle('hidden', !speakingMode);
    if (mute) {
      mute.classList.toggle('live', speakingMode && !muted && !serverMuted);
      mute.textContent = serverMuted ? '🔒' : (muted ? '🔇' : '🎙');
      mute.title = serverMuted ? 'الميكروفون معطل بواسطة منشئ المجموعة' : '';
    }
  }

  function stopMicBestEffort() {
    const participant = room?.localParticipant;
    if (!participant) return;
    const op = participant.setMicrophoneEnabled(false);
    withTimeout(op, 3000, 'تأخر إغلاق المايك.').catch(() => {});
  }

  window.joinVoice = async function () {
    if (!roomId) return showToast('ادخل المجموعة أولًا.');
    if (serverMuted) return showToast('منشئ المجموعة عطّل المايك عندك.');
    if (joinedVoice) return;
    if (joiningMic) return joiningMic;

    const btn = document.getElementById('joinVoice');
    joiningMic = (async () => {
      if (btn) btn.disabled = true;
      let micOperation = null;
      try {
        diag('microphone-starting');

        const ok = await withTimeout(
          connectListener(roomId),
          10500,
          'اتصال المكالمة تأخر. حاول مرة ثانية.'
        );
        if (!ok || !room) throw new Error('تعذر الاتصال بسيرفر الصوت.');

        const state = String(room.state || room.connectionState || '').toLowerCase();
        if (state !== 'connected') throw new Error('المكالمة لم تكتمل بعد. حاول مرة ثانية.');

        micOperation = room.localParticipant.setMicrophoneEnabled(true, captureOptions(), publishOptions());
        await withTimeout(
          micOperation,
          8000,
          'المتصفح تأخر في تشغيل المايك. تأكد من إذن الميكروفون وحاول مرة ثانية.'
        );

        const pub = [...room.localParticipant.audioTrackPublications.values()][0];
        const track = pub?.track?.mediaStreamTrack;
        if (!pub?.track || !track || track.readyState !== 'live') throw new Error('الميكروفون لم يبدأ بشكل صحيح.');

        joinedVoice = true;
        muted = false;
        setMicUi(true);

        socket.emit('voice-join', {}, res => {
          if (!res?.ok) {
            joinedVoice = false;
            muted = false;
            setMicUi(false);
            stopMicBestEffort();
            showToast(res?.error || 'تعذر تشغيل المايك.');
          }
        });

        diag('microphone-published', {
          trackSid: pub.trackSid || '', readyState: track.readyState, enabled: track.enabled,
          muted: track.muted, micEnabled: room.localParticipant.isMicrophoneEnabled,
        });
      } catch (e) {
        joinedVoice = false;
        muted = false;
        setMicUi(false);
        diag('microphone-failed', { error: String(e?.message || e).slice(0, 180) });

        if (micOperation) {
          Promise.resolve(micOperation)
            .then(() => { if (!joinedVoice) stopMicBestEffort(); })
            .catch(() => {});
        } else {
          stopMicBestEffort();
        }

        console.error(e);
        showToast(e?.message || 'تعذر تشغيل المايك.');
      } finally {
        if (btn) btn.disabled = false;
        joiningMic = null;
      }
    })();

    return joiningMic;
  };

  window.leaveVoice = async function () {
    if (!joinedVoice && !room?.localParticipant?.isMicrophoneEnabled) return;

    // UI first: leaving the mic must never make the whole room feel frozen.
    joinedVoice = false;
    muted = false;
    setMicUi(false);
    socket?.emit('voice-leave');
    diag('microphone-leaving');

    try {
      await withTimeout(
        room?.localParticipant?.setMicrophoneEnabled(false),
        3500,
        'تأخر إغلاق المايك.'
      );
    } catch (e) {
      diag('microphone-leave-timeout', { error: String(e?.message || e).slice(0, 160) });
    }
    diag('microphone-left');
  };

  const joinBtn = document.getElementById('joinVoice');
  const leaveBtn = document.getElementById('leaveVoice');
  const muteBtn = document.getElementById('muteBtn');
  const deafenBtn = document.getElementById('deafenBtn');

  if (joinBtn) joinBtn.onclick = () => window.joinVoice();
  if (leaveBtn) leaveBtn.onclick = () => window.leaveVoice();
  if (muteBtn) muteBtn.onclick = async () => {
    if (!joinedVoice || !room) return;
    if (serverMuted) return showToast('منشئ المجموعة عطّل المايك عندك.');

    const nextMuted = !muted;
    muted = nextMuted;
    setMicUi(true);
    try {
      await withTimeout(
        room.localParticipant.setMicrophoneEnabled(!nextMuted, captureOptions(), publishOptions()),
        5000,
        'تأخر تغيير حالة المايك.'
      );
      socket?.emit('voice-state', { muted: nextMuted });
      diag(nextMuted ? 'microphone-muted' : 'microphone-unmuted');
    } catch (e) {
      muted = !nextMuted;
      setMicUi(true);
      showToast(e?.message || 'تعذر تغيير حالة المايك.');
    }
  };

  if (deafenBtn) deafenBtn.onclick = () => {
    deafened = !deafened;
    for (const el of remoteAudio.values()) el.muted = deafened;
    deafenBtn.textContent = deafened ? '🔇' : '🔊';
  };

  function bindSocketEvents() {
    if (!socket || socket.__voiceV3Bound) return;
    socket.__voiceV3Bound = true;

    socket.on('owner:mute-state', async ({ muted: nextMuted, reason } = {}) => {
      serverMuted = Boolean(nextMuted);
      if (serverMuted) {
        if (joinedVoice) {
          muted = true;
          setMicUi(true);
          socket.emit('voice-state', { muted: true });
        }
        try {
          await withTimeout(room?.localParticipant?.setMicrophoneEnabled(false), 3500, 'تأخر كتم المايك.');
        } catch {}
      } else if (joinedVoice) {
        muted = true;
        setMicUi(true);
      }
      showToast(reason || (serverMuted ? 'تم تعطيل المايك بواسطة منشئ المجموعة.' : 'تم السماح لك باستخدام المايك.'));
    });

    socket.on('connect', () => {
      nextListenerRetryAt = 0;
      ensureListener();
    });
  }

  async function ensureListener() {
    bindSocketEvents();
    const target = String(roomId || '');

    if (!target) {
      if (room && !connecting) await disconnectRoom();
      return;
    }
    if (!socket?.connected || connecting) return;

    const state = String(room?.state || room?.connectionState || '').toLowerCase();
    if (room && connectedRoomId === target && state === 'connected') {
      listenerRetryDelay = 1500;
      return;
    }

    if (Date.now() < nextListenerRetryAt) return;
    nextListenerRetryAt = Date.now() + listenerRetryDelay;

    const ok = await connectListener(target);
    if (ok) {
      listenerRetryDelay = 1500;
      nextListenerRetryAt = 0;
    } else {
      listenerRetryDelay = Math.min(15000, Math.max(1500, listenerRetryDelay * 2));
      nextListenerRetryAt = Date.now() + listenerRetryDelay;
    }
  }

  bindSocketEvents();
  ensureListener();
  const listenerTimer = setInterval(ensureListener, 2000);

  // If the user leaves the group while speaking, stop publishing but keep listener semantics until roomId clears.
  const originalLeaveRoom = window.leaveRoom;
  if (typeof originalLeaveRoom === 'function') {
    window.leaveRoom = function (...args) {
      if (joinedVoice) window.leaveVoice();
      const result = originalLeaveRoom(...args);
      nextListenerRetryAt = 0;
      setTimeout(() => { if (!roomId) disconnectRoom(); }, 80);
      return result;
    };
  }

  window.addEventListener('pagehide', () => clearInterval(listenerTimer), { once: true });

  window.SawalefLiveKit = {
    get active() { return Boolean(room); },
    get room() { return room; },
    get mode() { return joinedVoice ? 'speaker' : (room ? 'listener' : 'off'); },
    connectListener,
    disconnectRoom,
    unlockAudio,
    get serverMuted() { return serverMuted; },
  };
})();

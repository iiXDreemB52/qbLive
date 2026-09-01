(() => {
  const lk = window.LivekitClient;
  if (!lk?.Room) {
    console.error('LiveKit client unavailable');
    return;
  }

  const legacy = {
    joinVoice: window.joinVoice,
    leaveVoice: window.leaveVoice,
    muteClick: document.getElementById('muteBtn')?.onclick,
    deafenClick: document.getElementById('deafenBtn')?.onclick,
  };

  let room = null;
  let connectedRoomId = '';
  let connecting = null;
  let serverMuted = false;
  let playbackBlocked = false;
  const remoteAudio = new Map();
  const speaking = new Set();
  const rack = document.getElementById('audioRack');

  if (rack) {
    Object.assign(rack.style, {
      display: 'block', position: 'fixed', width: '1px', height: '1px', opacity: '0',
      pointerEvents: 'none', overflow: 'hidden', left: '-9999px', bottom: '0'
    });
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
    const s = navigator.mediaDevices?.getSupportedConstraints?.() || {};
    const o = {};
    if (s.echoCancellation) o.echoCancellation = true;
    if (s.noiseSuppression) o.noiseSuppression = true;
    if (s.autoGainControl) o.autoGainControl = true;
    if (s.channelCount) o.channelCount = 1;
    if (s.sampleRate) o.sampleRate = 48000;
    if (s.voiceIsolation) o.voiceIsolation = true;
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
      }, 7000);
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
    if (old) try { await old.disconnect(); } catch {}
    diag('listener-disconnected');
  }

  async function connectListener(targetRoom = roomId) {
    targetRoom = String(targetRoom || '');
    if (!targetRoom || !socket?.connected) return false;
    if (room && connectedRoomId === targetRoom) return true;
    if (connecting) return connecting;
    connecting = (async () => {
      try {
        if (room) await disconnectRoom();
        const auth = await requestToken(targetRoom);
        if (!auth?.configured) return false;
        if (!auth.ok) throw new Error(auth.error || 'تعذر تجهيز LiveKit.');
        const r = new lk.Room({
          adaptiveStream: false,
          dynacast: false,
          disconnectOnPageLeave: true,
          audioCaptureDefaults: captureOptions(),
          publishDefaults: publishOptions(),
        });
        wire(r);
        room = r;
        await r.connect(auth.url, auth.token, { autoSubscribe: true });
        connectedRoomId = targetRoom;
        diag('listener-connected', { tokenIdentity: auth.identity || '' });
        attachExisting(r);
        await unlockAudio();
        return true;
      } catch (e) {
        console.error('LiveKit listener connect failed:', e);
        diag('listener-failed', { error: String(e?.message || e).slice(0, 180) });
        await disconnectRoom();
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

  window.joinVoice = async function () {
    if (!roomId) return showToast('ادخل المجموعة أولًا.');
    if (serverMuted) return showToast('منشئ المجموعة عطّل المايك عندك.');
    const btn = document.getElementById('joinVoice');
    if (btn) btn.disabled = true;
    try {
      const ok = await connectListener(roomId);
      if (!ok || !room) {
        if (typeof legacy.joinVoice === 'function') return legacy.joinVoice();
        throw new Error('تعذر الاتصال بسيرفر الصوت.');
      }
      await room.localParticipant.setMicrophoneEnabled(true, captureOptions(), publishOptions());
      const pub = [...room.localParticipant.audioTrackPublications.values()][0];
      const track = pub?.track?.mediaStreamTrack;
      if (!pub?.track || !track || track.readyState !== 'live') throw new Error('الميكروفون لم يبدأ بشكل صحيح.');
      joinedVoice = true;
      muted = false;
      setMicUi(true);
      socket.emit('voice-join', {}, res => {
        if (!res?.ok) {
          room?.localParticipant?.setMicrophoneEnabled(false).catch(() => {});
          joinedVoice = false;
          setMicUi(false);
          showToast(res?.error || 'تعذر تشغيل المايك.');
        }
      });
      diag('microphone-published', {
        trackSid: pub.trackSid || '', readyState: track.readyState, enabled: track.enabled,
        muted: track.muted, micEnabled: room.localParticipant.isMicrophoneEnabled,
      });
    } catch (e) {
      console.error(e);
      showToast(e?.message || 'تعذر تشغيل المايك.');
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  window.leaveVoice = async function () {
    if (!joinedVoice) return;
    try { await room?.localParticipant?.setMicrophoneEnabled(false); } catch {}
    socket?.emit('voice-leave');
    joinedVoice = false;
    muted = false;
    setMicUi(false);
    diag('microphone-left');
  };

  const joinBtn = document.getElementById('joinVoice');
  const leaveBtn = document.getElementById('leaveVoice');
  const muteBtn = document.getElementById('muteBtn');
  const deafenBtn = document.getElementById('deafenBtn');
  if (joinBtn) joinBtn.onclick = () => window.joinVoice();
  if (leaveBtn) leaveBtn.onclick = () => window.leaveVoice();
  if (muteBtn) muteBtn.onclick = async () => {
    if (!joinedVoice) return;
    if (serverMuted) return showToast('منشئ المجموعة عطّل المايك عندك.');
    try {
      muted = !muted;
      await room.localParticipant.setMicrophoneEnabled(!muted, captureOptions(), publishOptions());
      socket?.emit('voice-state', { muted });
      setMicUi(true);
    } catch {
      muted = !muted;
      showToast('تعذر تغيير حالة المايك.');
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
        try { await room?.localParticipant?.setMicrophoneEnabled(false); } catch {}
        if (joinedVoice) {
          muted = true;
          socket.emit('voice-state', { muted: true });
          setMicUi(true);
        }
      } else if (joinedVoice) {
        muted = true;
        setMicUi(true);
      }
      showToast(reason || (serverMuted ? 'تم تعطيل المايك بواسطة منشئ المجموعة.' : 'تم السماح لك باستخدام المايك.'));
    });
  }

  setInterval(() => {
    bindSocketEvents();
    const target = String(roomId || '');
    if (target && socket?.connected && (!room || connectedRoomId !== target)) connectListener(target);
    if (!target && room) disconnectRoom();
  }, 450);

  // If the user leaves the group while speaking, stop publishing but keep listener semantics until roomId clears.
  const originalLeaveRoom = window.leaveRoom;
  if (typeof originalLeaveRoom === 'function') {
    window.leaveRoom = function (...args) {
      if (joinedVoice) window.leaveVoice();
      const result = originalLeaveRoom(...args);
      setTimeout(() => { if (!roomId) disconnectRoom(); }, 50);
      return result;
    };
  }

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

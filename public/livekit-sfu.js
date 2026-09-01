(() => {
  const lk = window.LivekitClient;
  const p2p = {
    joinVoice,
    leaveVoice,
    handleVoicePeers,
    handleOffer,
    handleAnswer,
    handleIce,
    connectSocket,
    muteClick: $('muteBtn').onclick,
    deafenClick: $('deafenBtn').onclick,
  };

  let livekitRoom = null;
  let livekitActive = false;
  const remoteLiveKitAudio = new Set();
  const speakingIdentities = new Set();

  const speakingStyle = document.createElement('style');
  speakingStyle.textContent = `
    .speaker.speaking .speaker-avatar{
      border-color:#38d777!important;
      box-shadow:0 0 0 5px rgba(56,215,119,.18),0 0 28px rgba(56,215,119,.65),0 12px 35px rgba(0,0,0,.3)!important;
      animation:sawalefSpeakingPulse .8s ease-in-out infinite alternate;
    }
    @keyframes sawalefSpeakingPulse{
      from{transform:scale(1);box-shadow:0 0 0 4px rgba(56,215,119,.14),0 0 20px rgba(56,215,119,.42),0 12px 35px rgba(0,0,0,.3)}
      to{transform:scale(1.035);box-shadow:0 0 0 7px rgba(56,215,119,.22),0 0 34px rgba(56,215,119,.72),0 12px 35px rgba(0,0,0,.3)}
    }
  `;
  document.head.appendChild(speakingStyle);

  function speakerElementForIdentity(identity) {
    try {
      const id = String(identity || '');
      const person = Array.isArray(currentPresence)
        ? currentPresence.find(u => String(u.id || '') === id || String(u.userId || '') === id)
        : null;
      return person ? document.getElementById(`speaker-${person.id}`) : null;
    } catch { return null; }
  }

  function paintSpeaking() {
    document.querySelectorAll('#voiceStage .speaker').forEach(el => el.classList.remove('speaking'));
    for (const identity of speakingIdentities) {
      speakerElementForIdentity(identity)?.classList.add('speaking');
    }
  }

  function setActiveSpeakers(participants = []) {
    speakingIdentities.clear();
    for (const participant of participants) {
      const identity = participant?.identity;
      if (identity) speakingIdentities.add(String(identity));
    }
    paintSpeaking();
  }

  const voiceStage = $('voiceStage');
  if (voiceStage) {
    new MutationObserver(() => paintSpeaking()).observe(voiceStage, { childList: true, subtree: true });
  }

  function liveKitAudioCapture() {
    const supported = navigator.mediaDevices?.getSupportedConstraints?.() || {};
    const opts = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      sampleRate: 48000,
    };
    if (supported.sampleSize) opts.sampleSize = { ideal: 24 };
    if (supported.latency) opts.latency = { ideal: 0.01 };
    if (supported.voiceIsolation) opts.voiceIsolation = true;
    return opts;
  }

  const publishOptions = {
    audioPreset: { maxBitrate: 256000, priority: 'high' },
    dtx: false,
    red: true,
    forceStereo: false,
    stopMicTrackOnMute: false,
  };

  function requestLiveKitToken() {
    return new Promise((resolve) => {
      if (!socket?.connected) return resolve({ ok: false, configured: false, error: 'السيرفر غير متصل.' });
      let done = false;
      const timer = setTimeout(() => {
        if (!done) { done = true; resolve({ ok: false, configured: false, error: 'انتهت مهلة تجهيز الصوت.' }); }
      }, 5000);
      socket.emit('livekit:token', { roomId }, (res) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(res || { ok: false, configured: false });
      });
    });
  }

  function clearLiveKitAudio() {
    for (const el of remoteLiveKitAudio) {
      try { el.srcObject = null; el.remove(); } catch {}
    }
    remoteLiveKitAudio.clear();
  }

  function attachRemoteAudio(track) {
    try {
      const el = track.attach();
      el.autoplay = true;
      el.playsInline = true;
      el.muted = deafened;
      el.volume = 1;
      el.dataset.livekitAudio = '1';
      audioRack.appendChild(el);
      remoteLiveKitAudio.add(el);
      el.play().catch(() => livekitRoom?.startAudio?.().catch(() => {}));
    } catch (err) {
      console.warn('LiveKit audio attach failed:', err);
    }
  }

  function detachRemoteAudio(track) {
    try {
      const els = track.detach();
      for (const el of els) {
        remoteLiveKitAudio.delete(el);
        el.remove();
      }
    } catch {}
  }

  function wireLiveKitRoom(room) {
    room.on(lk.RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === lk.Track.Kind.Audio || track.kind === 'audio') attachRemoteAudio(track);
    });
    room.on(lk.RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === lk.Track.Kind.Audio || track.kind === 'audio') detachRemoteAudio(track);
    });
    if (lk.RoomEvent.ActiveSpeakersChanged) {
      room.on(lk.RoomEvent.ActiveSpeakersChanged, setActiveSpeakers);
    }
    room.on(lk.RoomEvent.Disconnected, () => {
      clearLiveKitAudio();
      speakingIdentities.clear();
      paintSpeaking();
      if (livekitActive && joinedVoice) showToast('انقطع سيرفر الصوت، جارٍ إعادة الاتصال تلقائيًا.');
    });
  }

  function setVoiceUi(on) {
    $('joinVoice').classList.toggle('hidden', on);
    $('muteBtn').classList.toggle('hidden', !on);
    $('leaveVoice').classList.toggle('hidden', !on);
    $('muteBtn').classList.toggle('live', on && !muted);
    $('muteBtn').textContent = muted ? '🔇' : '🎙';
    if (!on) $('deafenBtn').textContent = '🔊';
  }

  function rewireSocket() {
    if (!socket || socket.__sawalefLiveKitRewired) return;
    socket.off('voice-peers');
    socket.off('webrtc-offer');
    socket.off('webrtc-answer');
    socket.off('webrtc-ice');
    socket.on('voice-peers', (...args) => { if (!livekitActive) return p2p.handleVoicePeers(...args); });
    socket.on('webrtc-offer', (...args) => { if (!livekitActive) return p2p.handleOffer(...args); });
    socket.on('webrtc-answer', (...args) => { if (!livekitActive) return p2p.handleAnswer(...args); });
    socket.on('webrtc-ice', (...args) => { if (!livekitActive) return p2p.handleIce(...args); });
    socket.__sawalefLiveKitRewired = true;
  }

  connectSocket = function (...args) {
    const result = p2p.connectSocket(...args);
    setTimeout(rewireSocket, 0);
    return result;
  };
  setTimeout(rewireSocket, 0);

  joinVoice = async function () {
    if (!roomId) return showToast('ادخل المجموعة أولًا.');
    if (!socket?.connected) return showToast('انتظر الاتصال بالسيرفر.');
    $('joinVoice').disabled = true;
    try {
      const auth = await requestLiveKitToken();
      if (!auth.configured) {
        return await p2p.joinVoice();
      }
      if (!auth.ok) throw new Error(auth.error || 'تعذر تجهيز LiveKit.');
      if (!lk?.Room) throw new Error('تعذر تحميل محرك LiveKit على جهازك.');

      clearLiveKitAudio();
      speakingIdentities.clear();
      paintSpeaking();
      if (livekitRoom) {
        try { await livekitRoom.disconnect(); } catch {}
      }

      const room = new lk.Room({
        adaptiveStream: false,
        dynacast: false,
        disconnectOnPageLeave: true,
        audioCaptureDefaults: liveKitAudioCapture(),
        publishDefaults: publishOptions,
      });
      livekitRoom = room;
      wireLiveKitRoom(room);

      await room.connect(auth.url, auth.token, { autoSubscribe: true });
      await room.startAudio().catch(() => {});
      await room.localParticipant.setMicrophoneEnabled(true, liveKitAudioCapture(), publishOptions);

      livekitActive = true;
      joinedVoice = true;
      muted = false;
      deafened = false;
      setVoiceUi(true);

      // Keep the existing Sawalef presence UI in sync, while P2P media stays disabled.
      rewireSocket();
      socket.emit('voice-join', {}, (res) => {
        if (!res?.ok) showToast(res?.error || 'تعذر تحديث حالة الصوت.');
      });
      showToast('تم تشغيل الصوت عبر SFU + TURN بأعلى ثبات.');
    } catch (err) {
      console.error('LiveKit voice failed:', err);
      livekitActive = false;
      joinedVoice = false;
      speakingIdentities.clear();
      paintSpeaking();
      clearLiveKitAudio();
      try { await livekitRoom?.disconnect(); } catch {}
      livekitRoom = null;
      setVoiceUi(false);
      showToast(err?.message || 'تعذر تشغيل سيرفر الصوت عالي الجودة.');
    } finally {
      $('joinVoice').disabled = false;
    }
  };

  leaveVoice = async function () {
    if (!livekitActive) return p2p.leaveVoice();
    socket?.emit('voice-leave');
    joinedVoice = false;
    muted = false;
    deafened = false;
    speakingIdentities.clear();
    paintSpeaking();
    try { await livekitRoom?.localParticipant?.setMicrophoneEnabled(false); } catch {}
    try { await livekitRoom?.disconnect(); } catch {}
    livekitRoom = null;
    livekitActive = false;
    clearLiveKitAudio();
    setVoiceUi(false);
  };

  $('joinVoice').onclick = joinVoice;
  $('leaveVoice').onclick = () => leaveVoice();
  $('muteBtn').onclick = async () => {
    if (!livekitActive) return p2p.muteClick?.();
    try {
      muted = !muted;
      await livekitRoom.localParticipant.setMicrophoneEnabled(!muted, liveKitAudioCapture(), publishOptions);
      $('muteBtn').textContent = muted ? '🔇' : '🎙';
      $('muteBtn').classList.toggle('live', !muted);
      socket?.emit('voice-state', { muted });
      if (muted) {
        speakingIdentities.delete(String(socket?.id || me?.id || ''));
        paintSpeaking();
      }
    } catch {
      muted = !muted;
      showToast('تعذر تغيير حالة المايك.');
    }
  };
  $('deafenBtn').onclick = () => {
    if (!livekitActive) return p2p.deafenClick?.();
    deafened = !deafened;
    remoteLiveKitAudio.forEach(el => { el.muted = deafened; });
    $('deafenBtn').textContent = deafened ? '🔇' : '🔊';
  };

  window.SawalefLiveKit = {
    get active() { return livekitActive; },
    get room() { return livekitRoom; },
  };
})();

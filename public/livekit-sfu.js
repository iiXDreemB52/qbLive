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
  let playbackNeedsGesture = false;
  const remoteAudioByTrack = new Map();
  const speakingIdentities = new Set();

  // Audio elements must not live in a display:none container. Some mobile browsers
  // will never start media playback while the media element is display:none.
  if (audioRack) {
    audioRack.style.setProperty('display', 'block', 'important');
    audioRack.style.position = 'fixed';
    audioRack.style.width = '1px';
    audioRack.style.height = '1px';
    audioRack.style.opacity = '0';
    audioRack.style.pointerEvents = 'none';
    audioRack.style.overflow = 'hidden';
    audioRack.style.left = '-9999px';
    audioRack.style.bottom = '0';
  }

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

  function diag(phase, extra = {}) {
    try {
      socket?.emit('livekit:diagnostic', {
        phase: String(phase || '').slice(0, 40),
        state: livekitRoom?.connectionState || livekitRoom?.state || '',
        localIdentity: livekitRoom?.localParticipant?.identity || '',
        remoteParticipants: livekitRoom?.remoteParticipants?.size || 0,
        canPlaybackAudio: typeof livekitRoom?.canPlaybackAudio === 'boolean' ? livekitRoom.canPlaybackAudio : null,
        ...extra,
      });
    } catch {}
  }

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
    for (const identity of speakingIdentities) speakerElementForIdentity(identity)?.classList.add('speaking');
  }

  function setActiveSpeakers(participants = []) {
    speakingIdentities.clear();
    for (const participant of participants) {
      if (participant?.identity) speakingIdentities.add(String(participant.identity));
    }
    paintSpeaking();
  }

  const voiceStage = $('voiceStage');
  if (voiceStage) new MutationObserver(paintSpeaking).observe(voiceStage, { childList: true, subtree: true });

  function liveKitAudioCapture() {
    const supported = navigator.mediaDevices?.getSupportedConstraints?.() || {};
    const opts = {};
    if (supported.echoCancellation) opts.echoCancellation = true;
    if (supported.noiseSuppression) opts.noiseSuppression = true;
    if (supported.autoGainControl) opts.autoGainControl = true;
    if (supported.channelCount) opts.channelCount = 1;
    if (supported.sampleRate) opts.sampleRate = 48000;
    if (supported.voiceIsolation) opts.voiceIsolation = true;
    return opts;
  }

  // Keep the publish profile conservative and standards-compatible. 96 kbps mono Opus
  // is already higher than normal speech quality while avoiding SDP/codec overrides.
  function publishOptions() {
    return {
      audioPreset: { maxBitrate: 96000, priority: 'high' },
      dtx: true,
      red: true,
      forceStereo: false,
      stopMicTrackOnMute: false,
    };
  }

  function requestLiveKitToken() {
    return new Promise((resolve) => {
      if (!socket?.connected) return resolve({ ok: false, configured: false, error: 'السيرفر غير متصل.' });
      let done = false;
      const timer = setTimeout(() => {
        if (!done) { done = true; resolve({ ok: false, configured: false, error: 'انتهت مهلة تجهيز الصوت.' }); }
      }, 7000);
      socket.emit('livekit:token', { roomId }, (res) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(res || { ok: false, configured: false });
      });
    });
  }

  function clearLiveKitAudio() {
    for (const [track, el] of remoteAudioByTrack) {
      try { track.detach(el); } catch {}
      try { el.pause(); el.srcObject = null; el.remove(); } catch {}
    }
    remoteAudioByTrack.clear();
  }

  async function playElement(el) {
    if (!el) return false;
    try {
      el.muted = deafened;
      el.volume = 1;
      await livekitRoom?.startAudio?.();
      await el.play();
      playbackNeedsGesture = false;
      return true;
    } catch (err) {
      playbackNeedsGesture = true;
      diag('playback-blocked', { error: String(err?.name || err?.message || err).slice(0, 120) });
      return false;
    }
  }

  async function unlockPlayback() {
    if (!livekitRoom) return;
    try { await livekitRoom.startAudio?.(); } catch {}
    for (const el of remoteAudioByTrack.values()) await playElement(el);
    if (playbackNeedsGesture && livekitRoom?.canPlaybackAudio === false) {
      showToast('اضغط مرة ثانية لتفعيل سماع الصوت.');
    }
  }

  document.addEventListener('pointerdown', unlockPlayback, { capture: true, passive: true });
  document.addEventListener('touchstart', unlockPlayback, { capture: true, passive: true });
  document.addEventListener('click', unlockPlayback, { capture: true, passive: true });

  function attachRemoteAudio(track, participant) {
    if (!track || remoteAudioByTrack.has(track)) return;
    try {
      const el = document.createElement('audio');
      el.autoplay = true;
      el.playsInline = true;
      el.controls = false;
      el.muted = deafened;
      el.volume = 1;
      el.dataset.livekitAudio = '1';
      if (participant?.identity) el.dataset.participant = participant.identity;
      track.attach(el);
      audioRack.appendChild(el);
      remoteAudioByTrack.set(track, el);
      diag('track-subscribed', {
        participant: participant?.identity || '',
        trackSid: track.sid || '',
        trackState: track.mediaStreamTrack?.readyState || '',
        trackEnabled: track.mediaStreamTrack?.enabled !== false,
      });
      playElement(el).then(ok => {
        if (!ok) showToast('الصوت وصل لكن المتصفح حاجب التشغيل — اضغط أي مكان مرة واحدة.');
      });
    } catch (err) {
      console.error('LiveKit audio attach failed:', err);
      diag('attach-failed', { error: String(err?.message || err).slice(0, 160) });
    }
  }

  function detachRemoteAudio(track) {
    const el = remoteAudioByTrack.get(track);
    if (!el) return;
    try { track.detach(el); } catch {}
    try { el.pause(); el.srcObject = null; el.remove(); } catch {}
    remoteAudioByTrack.delete(track);
  }

  function attachAlreadySubscribed(room) {
    try {
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.audioTrackPublications.values()) {
          if (publication.track) attachRemoteAudio(publication.track, participant);
        }
      }
    } catch {}
  }

  function wireLiveKitRoom(room) {
    room.on(lk.RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (track.kind === 'audio' || track.kind === lk.Track?.Kind?.Audio) attachRemoteAudio(track, participant);
    });
    room.on(lk.RoomEvent.TrackUnsubscribed, (track) => detachRemoteAudio(track));
    room.on(lk.RoomEvent.TrackSubscriptionFailed, (trackSid, participant, error) => {
      diag('subscription-failed', { trackSid: trackSid || '', participant: participant?.identity || '', error: String(error?.message || error || '').slice(0, 160) });
    });
    room.on(lk.RoomEvent.ParticipantConnected, (participant) => diag('participant-connected', { participant: participant?.identity || '' }));
    room.on(lk.RoomEvent.ParticipantDisconnected, (participant) => diag('participant-disconnected', { participant: participant?.identity || '' }));
    room.on(lk.RoomEvent.LocalTrackPublished, (publication) => {
      diag('local-track-published', { trackSid: publication?.trackSid || '', kind: publication?.kind || publication?.track?.kind || '' });
    });
    if (lk.RoomEvent.ActiveSpeakersChanged) room.on(lk.RoomEvent.ActiveSpeakersChanged, setActiveSpeakers);
    if (lk.RoomEvent.AudioPlaybackStatusChanged) {
      room.on(lk.RoomEvent.AudioPlaybackStatusChanged, () => {
        diag('playback-status', { canPlaybackAudio: room.canPlaybackAudio });
        if (room.canPlaybackAudio === false) playbackNeedsGesture = true;
      });
    }
    if (lk.RoomEvent.MediaDevicesError) {
      room.on(lk.RoomEvent.MediaDevicesError, (err) => diag('media-device-error', { error: String(err?.message || err).slice(0, 160) }));
    }
    if (lk.RoomEvent.LocalAudioSilenceDetected) {
      room.on(lk.RoomEvent.LocalAudioSilenceDetected, () => diag('local-audio-silence'));
    }
    room.on(lk.RoomEvent.Disconnected, (reason) => {
      diag('disconnected', { reason: String(reason || '').slice(0, 100) });
      clearLiveKitAudio();
      speakingIdentities.clear();
      paintSpeaking();
      livekitActive = false;
      if (joinedVoice) showToast('انقطع اتصال LiveKit. اخرج من الصوت وادخل من جديد.');
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
      if (!auth.configured) return await p2p.joinVoice();
      if (!auth.ok) throw new Error(auth.error || 'تعذر تجهيز LiveKit.');
      if (!lk?.Room) throw new Error('تعذر تحميل محرك LiveKit على جهازك.');

      clearLiveKitAudio();
      speakingIdentities.clear();
      paintSpeaking();
      if (livekitRoom) try { await livekitRoom.disconnect(); } catch {}

      const room = new lk.Room({
        adaptiveStream: false,
        dynacast: false,
        disconnectOnPageLeave: true,
        audioCaptureDefaults: liveKitAudioCapture(),
        publishDefaults: publishOptions(),
      });
      livekitRoom = room;
      wireLiveKitRoom(room);
      diag('token-ready', { tokenIdentity: auth.identity || '' });

      await room.connect(auth.url, auth.token, { autoSubscribe: true });
      diag('connected', { identity: room.localParticipant.identity, remoteParticipants: room.remoteParticipants.size });

      const publication = await room.localParticipant.setMicrophoneEnabled(true, liveKitAudioCapture(), publishOptions());
      const micPub = publication || [...room.localParticipant.audioTrackPublications.values()][0];
      const mediaTrack = micPub?.track?.mediaStreamTrack;
      if (!micPub || !micPub.track || !mediaTrack) throw new Error('تم الاتصال بـ LiveKit لكن الميكروفون لم يُنشر.');
      if (mediaTrack.readyState !== 'live') throw new Error('مسار الميكروفون غير نشط.');

      livekitActive = true;
      joinedVoice = true;
      muted = false;
      deafened = false;
      setVoiceUi(true);
      rewireSocket();

      diag('microphone-published', {
        trackSid: micPub.trackSid || '',
        readyState: mediaTrack.readyState,
        enabled: mediaTrack.enabled,
        muted: mediaTrack.muted,
        micEnabled: room.localParticipant.isMicrophoneEnabled,
      });

      attachAlreadySubscribed(room);
      await unlockPlayback();
      socket.emit('voice-join', {}, (res) => {
        if (!res?.ok) showToast(res?.error || 'تعذر تحديث حالة الصوت.');
      });
      showToast('الصوت متصل عبر LiveKit والمايك منشور بنجاح.');
    } catch (err) {
      console.error('LiveKit voice failed:', err);
      diag('join-failed', { error: String(err?.message || err).slice(0, 180) });
      livekitActive = false;
      joinedVoice = false;
      speakingIdentities.clear();
      paintSpeaking();
      clearLiveKitAudio();
      try { await livekitRoom?.disconnect(); } catch {}
      livekitRoom = null;
      setVoiceUi(false);
      showToast(err?.message || 'تعذر تشغيل LiveKit.');
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
      await livekitRoom.localParticipant.setMicrophoneEnabled(!muted, liveKitAudioCapture(), publishOptions());
      $('muteBtn').textContent = muted ? '🔇' : '🎙';
      $('muteBtn').classList.toggle('live', !muted);
      socket?.emit('voice-state', { muted });
      diag(muted ? 'microphone-muted' : 'microphone-unmuted');
      if (muted) {
        speakingIdentities.delete(String(socket?.id || ''));
        paintSpeaking();
      }
    } catch (err) {
      muted = !muted;
      diag('mute-failed', { error: String(err?.message || err).slice(0, 120) });
      showToast('تعذر تغيير حالة المايك.');
    }
  };
  $('deafenBtn').onclick = () => {
    if (!livekitActive) return p2p.deafenClick?.();
    deafened = !deafened;
    remoteAudioByTrack.forEach(el => { el.muted = deafened; });
    $('deafenBtn').textContent = deafened ? '🔇' : '🔊';
    if (!deafened) unlockPlayback();
  };

  window.SawalefLiveKit = {
    get active() { return livekitActive; },
    get room() { return livekitRoom; },
    unlockAudio: unlockPlayback,
  };
})();

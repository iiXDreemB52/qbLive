(() => {
  const ULTRA_BITRATE = 192000;

  function audioConstraints() {
    const supported = navigator.mediaDevices?.getSupportedConstraints?.() || {};
    const audio = {};
    if (supported.sampleRate) audio.sampleRate = { ideal: 48000 };
    if (supported.channelCount) audio.channelCount = { ideal: 1, max: 1 };
    if (supported.echoCancellation) audio.echoCancellation = { ideal: true };
    if (supported.noiseSuppression) audio.noiseSuppression = { ideal: true };
    if (supported.autoGainControl) audio.autoGainControl = { ideal: true };
    if (supported.latency) audio.latency = { ideal: 0.01 };
    if (supported.voiceIsolation) audio.voiceIsolation = { ideal: true };
    return audio;
  }

  function tuneOpusSdp(sdp = '') {
    const rtp = sdp.match(/a=rtpmap:(\d+)\s+opus\/48000(?:\/2)?/i);
    if (!rtp) return sdp;
    const pt = rtp[1];
    const wanted = {
      minptime: '10',
      useinbandfec: '1',
      usedtx: '0',
      stereo: '0',
      'sprop-stereo': '0',
      maxplaybackrate: '48000',
      maxaveragebitrate: String(ULTRA_BITRATE),
      cbr: '0'
    };
    const fmtpRe = new RegExp(`a=fmtp:${pt}\\s+([^\\r\\n]*)`, 'i');
    const match = sdp.match(fmtpRe);
    const params = new Map();
    if (match) {
      match[1].split(';').map(v => v.trim()).filter(Boolean).forEach(part => {
        const i = part.indexOf('=');
        if (i > 0) params.set(part.slice(0, i).toLowerCase(), part.slice(i + 1));
      });
    }
    Object.entries(wanted).forEach(([k, v]) => params.set(k, v));
    const line = `a=fmtp:${pt} ${[...params].map(([k, v]) => `${k}=${v}`).join(';')}`;
    if (match) return sdp.replace(fmtpRe, line);
    const rtpLineRe = new RegExp(`a=rtpmap:${pt}[^\\r\\n]*`, 'i');
    return sdp.replace(rtpLineRe, m => `${m}\r\n${line}`);
  }

  const proto = window.RTCPeerConnection?.prototype;
  if (proto && !proto.__sawalefUltraAudio) {
    const nativeOffer = proto.createOffer;
    const nativeAnswer = proto.createAnswer;
    proto.createOffer = async function (...args) {
      const d = await nativeOffer.apply(this, args);
      return { type: d.type, sdp: tuneOpusSdp(d.sdp) };
    };
    proto.createAnswer = async function (...args) {
      const d = await nativeAnswer.apply(this, args);
      return { type: d.type, sdp: tuneOpusSdp(d.sdp) };
    };
    Object.defineProperty(proto, '__sawalefUltraAudio', { value: true });
  }

  try {
    preferOpus = function (pc) {
      try {
        const caps = RTCRtpSender.getCapabilities?.('audio') || RTCRtpReceiver.getCapabilities?.('audio');
        if (!caps?.codecs) return;
        const opus = caps.codecs.filter(c => c.mimeType?.toLowerCase() === 'audio/opus');
        const rest = caps.codecs.filter(c => c.mimeType?.toLowerCase() !== 'audio/opus');
        pc.getTransceivers().forEach(t => {
          if (t.receiver?.track?.kind === 'audio' && t.setCodecPreferences && opus.length) {
            t.setCodecPreferences([...opus, ...rest]);
          }
        });
      } catch {}
    };

    tuneSender = async function (pc) {
      for (const sender of pc.getSenders()) {
        if (sender.track?.kind !== 'audio') continue;
        sender.track.contentHint = 'speech';
        try {
          const p = sender.getParameters();
          if (!p.encodings?.length) p.encodings = [{}];
          p.encodings[0].maxBitrate = ULTRA_BITRATE;
          p.encodings[0].priority = 'high';
          p.encodings[0].networkPriority = 'high';
          await sender.setParameters(p);
        } catch {
          try {
            const p = sender.getParameters();
            if (!p.encodings?.length) p.encodings = [{}];
            p.encodings[0].maxBitrate = ULTRA_BITRATE;
            await sender.setParameters(p);
          } catch {}
        }
      }
    };

    joinVoice = async function () {
      try {
        $('joinVoice').disabled = true;
        try {
          localStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(), video: false });
        } catch (err) {
          if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') throw err;
          localStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: false
          });
        }
        const track = localStream.getAudioTracks()[0];
        if (track) {
          track.contentHint = 'speech';
          const supported = navigator.mediaDevices?.getSupportedConstraints?.() || {};
          const extra = {};
          if (supported.channelCount) extra.channelCount = 1;
          if (supported.sampleRate) extra.sampleRate = 48000;
          if (supported.voiceIsolation) extra.voiceIsolation = true;
          try { if (Object.keys(extra).length) await track.applyConstraints(extra); } catch {}
        }
        joinedVoice = true;
        muted = false;
        socket.emit('voice-join', {}, (res) => {
          if (!res?.ok) showToast(res?.error || 'تعذر الانضمام للصوت.');
        });
        $('joinVoice').classList.add('hidden');
        $('muteBtn').classList.remove('hidden');
        $('leaveVoice').classList.remove('hidden');
        $('muteBtn').classList.add('live');
      } catch (err) {
        console.error('Ultra audio capture failed:', err);
        showToast('ما قدرت أوصل للميكروفون. تأكد من الإذن.');
      } finally {
        $('joinVoice').disabled = false;
      }
    };

    $('joinVoice').onclick = joinVoice;
  } catch (err) {
    console.warn('Ultra audio mode fallback:', err);
  }
})();

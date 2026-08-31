const socket = io({ transports: ['websocket', 'polling'] });

const $ = (id) => document.getElementById(id);
const joinCard = $('joinCard'), app = $('app'), joinForm = $('joinForm');
const nameInput = $('nameInput'), roomInput = $('roomInput'), roomLabel = $('roomLabel');
const messages = $('messages'), messageForm = $('messageForm'), messageInput = $('messageInput');
const members = $('members'), memberCount = $('memberCount'), voiceUsers = $('voiceUsers'), voiceCount = $('voiceCount');
const joinVoiceBtn = $('joinVoice'), muteBtn = $('muteBtn'), deafenBtn = $('deafenBtn'), leaveVoiceBtn = $('leaveVoice');
const badge = $('connectionBadge'), toast = $('toast'), audioRack = $('audioRack');

let myName = '', roomId = '', localStream = null, joinedVoice = false, muted = false, deafened = false;
const peers = new Map();
const remoteAudios = new Map();
const pendingIce = new Map();

const rtcConfig = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }
  ],
  iceCandidatePoolSize: 8,
};

function showToast(text) {
  toast.textContent = text; toast.classList.add('show');
  clearTimeout(showToast.t); showToast.t = setTimeout(() => toast.classList.remove('show'), 2200);
}
function initials(name='؟') { return name.trim().slice(0, 2).toUpperCase(); }
function esc(s='') { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function time(ts) { return new Intl.DateTimeFormat('ar-SA',{hour:'2-digit',minute:'2-digit'}).format(new Date(ts)); }

socket.on('connect', () => { badge.textContent='متصل'; badge.className='badge online'; });
socket.on('disconnect', () => { badge.textContent='انقطع الاتصال'; badge.className='badge offline'; });

$('randomRoom').onclick = () => { roomInput.value = 'room-' + Math.random().toString(36).slice(2, 8); };
joinForm.onsubmit = (e) => {
  e.preventDefault();
  myName = nameInput.value.trim();
  roomId = roomInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g,'');
  if (!myName || !roomId) return showToast('اكتب الاسم ورمز الغرفة.');
  socket.emit('join-room', { name: myName, roomId }, (res) => {
    if (!res?.ok) return showToast(res?.error || 'تعذر دخول الغرفة.');
    roomLabel.textContent = roomId; joinCard.classList.add('hidden'); app.classList.remove('hidden');
    history.replaceState(null, '', '#'+roomId); messageInput.focus();
  });
};

const hashRoom = location.hash.slice(1).replace(/[^a-z0-9_-]/gi,'').slice(0,36);
if (hashRoom) roomInput.value = hashRoom;

messageForm.onsubmit = (e) => {
  e.preventDefault(); const text = messageInput.value.trim(); if (!text) return;
  socket.emit('chat-message', { text }, (res) => { if (!res?.ok) showToast('تعذر إرسال الرسالة.'); });
  messageInput.value=''; messageInput.style.height='auto';
};
messageInput.addEventListener('input', () => { messageInput.style.height='auto'; messageInput.style.height=Math.min(messageInput.scrollHeight,130)+'px'; });
messageInput.addEventListener('keydown', (e) => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); messageForm.requestSubmit(); } });

function renderMessage(m) {
  const mine = m.senderId === socket.id;
  const el = document.createElement('div'); el.className='msg';
  el.innerHTML = `<div class="avatar">${esc(initials(m.name))}</div><div><div class="msg-head"><b class="${mine?'you':''}">${esc(m.name)}${mine?' (أنت)':''}</b><span class="time">${time(m.ts)}</span></div><div class="msg-text">${esc(m.text)}</div></div>`;
  messages.appendChild(el); messages.scrollTop = messages.scrollHeight;
}
socket.on('message-history', (history) => { messages.innerHTML=''; history.forEach(renderMessage); });
socket.on('chat-message', renderMessage);

socket.on('presence', (list=[]) => {
  memberCount.textContent=list.length;
  members.innerHTML=list.map(u=>`<div class="member"><div class="avatar">${esc(initials(u.name))}</div><div class="meta"><b class="${u.id===socket.id?'you':''}">${esc(u.name)}${u.id===socket.id?' (أنت)':''}</b><span class="state">${u.voice ? (u.muted?'في الصوت • مكتوم':'في الصوت'):'متصل'}</span></div><span class="online-dot"></span></div>`).join('');
  const vu=list.filter(u=>u.voice); voiceCount.textContent=vu.length;
  voiceUsers.innerHTML=vu.length?vu.map(u=>`<div class="voice-user" id="voice-user-${u.id}"><div class="avatar">${esc(initials(u.name))}</div><div class="meta"><b class="${u.id===socket.id?'you':''}">${esc(u.name)}${u.id===socket.id?' (أنت)':''}</b><span class="state">${u.muted?'🔇 الميكروفون مكتوم':'🎙️ متصل بالصوت'}</span></div></div>`).join(''):'<div class="empty">ما فيه أحد بالصوت.</div>';
});

function preferOpus(pc) {
  try {
    const caps = RTCRtpReceiver.getCapabilities?.('audio');
    if (!caps?.codecs) return;
    const opus = caps.codecs.filter(c => c.mimeType.toLowerCase() === 'audio/opus');
    const rest = caps.codecs.filter(c => c.mimeType.toLowerCase() !== 'audio/opus');
    pc.getTransceivers().forEach(t => { if (t.receiver?.track?.kind === 'audio' && t.setCodecPreferences) t.setCodecPreferences([...opus,...rest]); });
  } catch {}
}

async function tuneSender(pc) {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== 'audio') continue;
    try {
      const p = sender.getParameters();
      if (!p.encodings?.length) p.encodings=[{}];
      p.encodings[0].maxBitrate = 128000;
      p.encodings[0].priority = 'high';
      p.encodings[0].networkPriority = 'high';
      await sender.setParameters(p);
    } catch {}
  }
}

function makeAudio(peerId) {
  let audio = remoteAudios.get(peerId);
  if (!audio) {
    audio=document.createElement('audio'); audio.autoplay=true; audio.playsInline=true; audio.dataset.peer=peerId;
    audioRack.appendChild(audio); remoteAudios.set(peerId,audio);
  }
  audio.muted = deafened;
  return audio;
}

function cleanupPeer(peerId) {
  const pc=peers.get(peerId); if (pc) { try{pc.close()}catch{} peers.delete(peerId); }
  const a=remoteAudios.get(peerId); if(a){a.srcObject=null;a.remove();remoteAudios.delete(peerId)}
  pendingIce.delete(peerId);
}

async function createPeer(peerId, initiator=false) {
  if (peers.has(peerId)) return peers.get(peerId);
  const pc = new RTCPeerConnection(rtcConfig); peers.set(peerId, pc);
  localStream?.getAudioTracks().forEach(track => { track.contentHint='speech'; pc.addTrack(track, localStream); });
  preferOpus(pc); await tuneSender(pc);
  pc.onicecandidate = (e) => { if(e.candidate) socket.emit('webrtc-ice',{target:peerId,candidate:e.candidate}); };
  pc.ontrack = (e) => { const audio=makeAudio(peerId); audio.srcObject=e.streams[0] || new MediaStream([e.track]); audio.play().catch(()=>{}); };
  pc.onconnectionstatechange = () => { if(['failed','closed'].includes(pc.connectionState)) cleanupPeer(peerId); };
  if (initiator) {
    const offer=await pc.createOffer({offerToReceiveAudio:true}); await pc.setLocalDescription(offer);
    socket.emit('webrtc-offer',{target:peerId,sdp:pc.localDescription});
  }
  return pc;
}

async function flushIce(peerId, pc) {
  const arr=pendingIce.get(peerId)||[];
  for(const c of arr){try{await pc.addIceCandidate(c)}catch{}}
  pendingIce.delete(peerId);
}

joinVoiceBtn.onclick = async () => {
  try {
    joinVoiceBtn.disabled=true;
    localStream = await navigator.mediaDevices.getUserMedia({audio:{sampleRate:{ideal:48000},channelCount:{ideal:2},sampleSize:{ideal:16},echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
    joinedVoice=true; muted=false;
    socket.emit('voice-join',{},(res)=>{ if(!res?.ok) showToast(res?.error||'تعذر الانضمام للصوت.'); });
    joinVoiceBtn.classList.add('hidden'); muteBtn.classList.remove('hidden'); deafenBtn.classList.remove('hidden'); leaveVoiceBtn.classList.remove('hidden');
    $('voiceHint').textContent='جودة فائقة مفعلة • Opus 48 kHz • حتى 128 kbps لكل اتصال.';
  } catch (err) { showToast('ما قدرت أوصل للميكروفون. تأكد من الإذن.'); }
  finally { joinVoiceBtn.disabled=false; }
};

socket.on('voice-peers', async (list=[]) => { for(const p of list){try{await createPeer(p.id,true)}catch{}} });
socket.on('webrtc-offer', async ({from,sdp}) => {
  if(!joinedVoice) return;
  try { const pc=await createPeer(from,false); await pc.setRemoteDescription(sdp); await flushIce(from,pc); const ans=await pc.createAnswer(); await pc.setLocalDescription(ans); socket.emit('webrtc-answer',{target:from,sdp:pc.localDescription}); } catch {}
});
socket.on('webrtc-answer', async ({from,sdp}) => { const pc=peers.get(from); if(!pc)return; try{await pc.setRemoteDescription(sdp); await flushIce(from,pc)}catch{} });
socket.on('webrtc-ice', async ({from,candidate}) => {
  const pc=peers.get(from);
  if(!pc || !pc.remoteDescription){ const arr=pendingIce.get(from)||[]; arr.push(candidate); pendingIce.set(from,arr); return; }
  try{await pc.addIceCandidate(candidate)}catch{}
});
socket.on('peer-left', ({id}) => cleanupPeer(id));

muteBtn.onclick = () => {
  muted=!muted; localStream?.getAudioTracks().forEach(t=>t.enabled=!muted); muteBtn.textContent=muted?'🎙️ فتح المايك':'🔇 كتم'; socket.emit('voice-state',{muted});
};
deafenBtn.onclick = () => {
  deafened=!deafened; remoteAudios.forEach(a=>a.muted=deafened); deafenBtn.textContent=deafened?'🎧 فك الصم':'🎧 صمّ';
};
leaveVoiceBtn.onclick = () => {
  socket.emit('voice-leave'); joinedVoice=false; muted=false; deafened=false;
  localStream?.getTracks().forEach(t=>t.stop()); localStream=null;
  [...peers.keys()].forEach(cleanupPeer);
  joinVoiceBtn.classList.remove('hidden'); muteBtn.classList.add('hidden'); deafenBtn.classList.add('hidden'); leaveVoiceBtn.classList.add('hidden');
  $('voiceHint').textContent='قد يطلب المتصفح إذن الميكروفون عند أول انضمام.';
};

$('copyRoom').onclick = async () => { try{await navigator.clipboard.writeText(roomId);showToast('تم نسخ رمز الغرفة.')}catch{showToast(roomId)} };
window.addEventListener('beforeunload',()=>{localStream?.getTracks().forEach(t=>t.stop())});

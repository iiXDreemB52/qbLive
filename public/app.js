const $ = (id) => document.getElementById(id);
const authPage = $('authPage'), lobbyPage = $('lobbyPage'), roomPage = $('roomPage');
const loginForm = $('loginForm'), registerForm = $('registerForm'), joinForm = $('joinForm');
const messages = $('messages'), messageForm = $('messageForm'), messageInput = $('messageInput');
const toast = $('toast'), audioRack = $('audioRack');

let token = localStorage.getItem('sawalef_token') || '';
let me = null, socket = null, roomId = '', localStream = null, joinedVoice = false, muted = false, deafened = false;
let currentPresence = [], deferredInstallPrompt = null, profileAvatar = '';
const peers = new Map(), remoteAudios = new Map(), pendingIce = new Map();

const rtcConfig = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }
  ],
  iceCandidatePoolSize: 8,
};

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => toast.classList.remove('show'), 2600);
}
function initials(name = '؟') { return String(name).trim().slice(0, 2).toUpperCase(); }
function esc(s = '') { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function safeAvatar(url = '') { return /^(data:image\/(png|jpeg|webp);base64,|https:\/\/)/i.test(url) ? url : ''; }
function avatarHtml(user, cls = '') {
  const src = safeAvatar(user?.avatar || '');
  return src ? `<img class="${cls}" src="${esc(src)}" alt="" />` : `<span>${esc(initials(user?.name || user?.username))}</span>`;
}
function time(ts) { return new Intl.DateTimeFormat('ar-SA', { hour: '2-digit', minute: '2-digit' }).format(new Date(ts)); }
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...options, headers });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data.error || 'حدث خطأ غير متوقع.');
  return data;
}

function showPage(name) {
  authPage.classList.toggle('hidden', name !== 'auth');
  lobbyPage.classList.toggle('hidden', name !== 'lobby');
  roomPage.classList.toggle('hidden', name !== 'room');
}
function setAuth(result) {
  token = result.token;
  me = result.user;
  localStorage.setItem('sawalef_token', token);
  enterLobby();
}
function clearAuth() {
  token = '';
  me = null;
  localStorage.removeItem('sawalef_token');
  if (socket) { try { socket.disconnect(); } catch {} socket = null; }
  showPage('auth');
}
function renderMe() {
  $('meName').textContent = me?.name || me?.username || '';
  $('meRole').textContent = me?.role === 'admin' ? 'أدمن' : 'حساب عادي';
  const src = safeAvatar(me?.avatar || '');
  $('meAvatar').classList.toggle('hidden', !src);
  $('meAvatarFallback').classList.toggle('hidden', !!src);
  if (src) $('meAvatar').src = src;
  $('meAvatarFallback').textContent = initials(me?.name || me?.username);
  $('adminBtn').classList.toggle('hidden', me?.role !== 'admin');
}
function enterLobby() {
  renderMe();
  showPage('lobby');
  connectSocket();
  const hashRoom = location.hash.slice(1).replace(/[^a-z0-9_-]/gi, '').slice(0, 36);
  if (hashRoom) $('roomInput').value = hashRoom;
}

$('loginTab').onclick = () => {
  $('loginTab').classList.add('active'); $('registerTab').classList.remove('active');
  loginForm.classList.remove('hidden'); registerForm.classList.add('hidden');
};
$('registerTab').onclick = () => {
  $('registerTab').classList.add('active'); $('loginTab').classList.remove('active');
  registerForm.classList.remove('hidden'); loginForm.classList.add('hidden');
};

loginForm.onsubmit = async (e) => {
  e.preventDefault();
  const btn = loginForm.querySelector('button[type=submit]'); btn.disabled = true;
  try {
    const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: $('loginUsername').value.trim(), password: $('loginPassword').value }) });
    setAuth(result);
  } catch (err) { showToast(err.message); }
  finally { btn.disabled = false; }
};
registerForm.onsubmit = async (e) => {
  e.preventDefault();
  const btn = registerForm.querySelector('button[type=submit]'); btn.disabled = true;
  try {
    const result = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: $('registerUsername').value.trim(), password: $('registerPassword').value, avatar: profileAvatar }) });
    setAuth(result);
  } catch (err) { showToast(err.message); }
  finally { btn.disabled = false; }
};

$('avatarPickBtn').onclick = () => $('avatarInput').click();
$('avatarInput').onchange = async () => {
  const file = $('avatarInput').files?.[0];
  if (!file) return;
  try {
    profileAvatar = await resizeAvatar(file);
    $('avatarPreview').src = profileAvatar;
    $('avatarPreview').classList.remove('hidden');
    $('avatarPreviewText').classList.add('hidden');
  } catch { showToast('تعذر قراءة الصورة.'); }
};
function resizeAvatar(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const size = 256, canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', .78));
      } catch (e) { reject(e); }
    };
    img.onerror = reject; img.src = url;
  });
}

async function initGoogle() {
  try {
    const cfg = await api('/api/config');
    if (!cfg.googleClientId) {
      $('googleFallback').onclick = () => showToast('Google يحتاج GOOGLE_CLIENT_ID في إعدادات Render.');
      return;
    }
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
    s.onload = () => {
      $('googleFallback').classList.add('hidden');
      const holder = document.createElement('div'); $('googleArea').appendChild(holder);
      google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: handleGoogle });
      google.accounts.id.renderButton(holder, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', width: 320, locale: 'ar' });
    };
    document.head.appendChild(s);
  } catch {}
}
async function handleGoogle(resp) {
  try { setAuth(await api('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential: resp.credential }) })); }
  catch (err) { showToast(err.message); }
}

$('logoutBtn').onclick = async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  clearAuth();
};

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferredInstallPrompt = e; $('installBtn').classList.remove('hidden');
});
$('installBtn').onclick = async () => {
  if (!deferredInstallPrompt) return showToast('من قائمة المتصفح اختر: تثبيت التطبيق / إضافة إلى الشاشة الرئيسية.');
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null; $('installBtn').classList.add('hidden');
};
window.addEventListener('appinstalled', () => $('installBtn').classList.add('hidden'));
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));

function connectSocket() {
  if (!token || socket?.connected) return;
  if (socket) try { socket.disconnect(); } catch {}
  socket = io({ transports: ['websocket', 'polling'], auth: { token } });
  socket.on('connect', () => { $('connectionBadge').textContent = 'متصل'; $('connectionBadge').style.color = '#77e9a3'; });
  socket.on('disconnect', () => { $('connectionBadge').textContent = 'غير متصل'; $('connectionBadge').style.color = ''; });
  socket.on('connect_error', (e) => { if (String(e.message).includes('unauthorized')) clearAuth(); });
  socket.on('message-history', (history = []) => { messages.innerHTML = ''; history.forEach(renderMessage); });
  socket.on('chat-message', renderMessage);
  socket.on('presence', renderPresence);
  socket.on('voice-peers', handleVoicePeers);
  socket.on('webrtc-offer', handleOffer);
  socket.on('webrtc-answer', handleAnswer);
  socket.on('webrtc-ice', handleIce);
  socket.on('peer-left', ({ id }) => cleanupPeer(id));
  socket.on('room-closed', ({ reason }) => { showToast(reason || 'تم إغلاق القروب.'); leaveRoom(false); });
  socket.on('kicked', ({ reason }) => showToast(reason || 'تم إخراجك.'));
}

$('randomRoom').onclick = () => { $('roomInput').value = 'room-' + Math.random().toString(36).slice(2, 8); };
joinForm.onsubmit = (e) => {
  e.preventDefault();
  const nextRoom = $('roomInput').value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!nextRoom) return showToast('اكتب رمز القروب.');
  if (!socket?.connected) return showToast('انتظر الاتصال بالسيرفر.');
  socket.emit('join-room', { roomId: nextRoom }, (res) => {
    if (!res?.ok) return showToast(res?.error || 'تعذر دخول القروب.');
    roomId = res.roomId; $('roomLabel').textContent = roomId;
    history.replaceState(null, '', '#' + roomId);
    showPage('room'); messageInput.focus();
  });
};

$('leaveRoomTop').onclick = () => leaveRoom(true);
function leaveRoom(goLobby = true) {
  if (joinedVoice) leaveVoice();
  socket?.emit('leave-room');
  roomId = ''; currentPresence = []; messages.innerHTML = ''; $('roomInput').value = '';
  history.replaceState(null, '', location.pathname);
  if (goLobby) showPage('lobby'); else showPage('lobby');
}

messageForm.onsubmit = (e) => {
  e.preventDefault();
  const text = messageInput.value.trim(); if (!text || !socket) return;
  socket.emit('chat-message', { text }, (res) => { if (!res?.ok) showToast('تعذر إرسال الرسالة.'); });
  messageInput.value = ''; messageInput.style.height = 'auto';
};
messageInput.addEventListener('input', () => { messageInput.style.height = 'auto'; messageInput.style.height = Math.min(messageInput.scrollHeight, 92) + 'px'; });
messageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); messageForm.requestSubmit(); } });
$('chatToggle').onclick = () => $('chatSheet').classList.toggle('collapsed');

function renderMessage(m) {
  const mine = m.userId === me?.id;
  const el = document.createElement('div'); el.className = `msg${mine ? ' mine' : ''}`;
  const src = safeAvatar(m.avatar || '');
  el.innerHTML = `<div class="msg-avatar">${src ? `<img src="${esc(src)}" alt="" />` : `<span>${esc(initials(m.name))}</span>`}</div><div class="msg-bubble"><div class="msg-head"><b>${esc(m.name)}${mine ? ' • أنت' : ''}</b><span class="msg-time">${time(m.ts)}</span></div><div class="msg-text">${esc(m.text)}</div></div>`;
  messages.appendChild(el);
  requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
}

function renderPresence(list = []) {
  currentPresence = list;
  $('memberCount').textContent = list.length;
  $('voiceCountTop').textContent = list.filter(u => u.voice).length;
  $('miniAvatars').innerHTML = list.slice(0, 4).map(u => `<div class="mini-avatar">${avatarHtml(u)}</div>`).join('');
  const voice = list.filter(u => u.voice);
  $('stageEmpty').classList.toggle('hidden', voice.length > 0);
  $('voiceStage').classList.toggle('hidden', voice.length === 0);
  $('voiceStage').innerHTML = voice.map(u => {
    const mine = u.userId === me?.id;
    return `<div class="speaker" id="speaker-${u.id}"><div class="speaker-avatar-wrap"><div class="speaker-avatar">${avatarHtml(u)}</div>${u.muted ? '<span class="mute-badge">🎙̸</span>' : ''}</div><div class="speaker-name">${esc(u.name)}${mine ? ' • أنا' : ''}</div></div>`;
  }).join('');
}

function preferOpus(pc) {
  try {
    const caps = RTCRtpReceiver.getCapabilities?.('audio'); if (!caps?.codecs) return;
    const opus = caps.codecs.filter(c => c.mimeType.toLowerCase() === 'audio/opus');
    const rest = caps.codecs.filter(c => c.mimeType.toLowerCase() !== 'audio/opus');
    pc.getTransceivers().forEach(t => { if (t.receiver?.track?.kind === 'audio' && t.setCodecPreferences) t.setCodecPreferences([...opus, ...rest]); });
  } catch {}
}
async function tuneSender(pc) {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== 'audio') continue;
    try {
      const p = sender.getParameters(); if (!p.encodings?.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = 128000; p.encodings[0].priority = 'high'; p.encodings[0].networkPriority = 'high';
      await sender.setParameters(p);
    } catch {}
  }
}
function makeAudio(peerId) {
  let audio = remoteAudios.get(peerId);
  if (!audio) { audio = document.createElement('audio'); audio.autoplay = true; audio.playsInline = true; audioRack.appendChild(audio); remoteAudios.set(peerId, audio); }
  audio.muted = deafened; return audio;
}
function cleanupPeer(peerId) {
  const pc = peers.get(peerId); if (pc) { try { pc.close(); } catch {} peers.delete(peerId); }
  const a = remoteAudios.get(peerId); if (a) { a.srcObject = null; a.remove(); remoteAudios.delete(peerId); }
  pendingIce.delete(peerId);
}
async function createPeer(peerId, initiator = false) {
  if (peers.has(peerId)) return peers.get(peerId);
  const pc = new RTCPeerConnection(rtcConfig); peers.set(peerId, pc);
  localStream?.getAudioTracks().forEach(track => { track.contentHint = 'speech'; pc.addTrack(track, localStream); });
  preferOpus(pc); await tuneSender(pc);
  pc.onicecandidate = (e) => { if (e.candidate) socket.emit('webrtc-ice', { target: peerId, candidate: e.candidate }); };
  pc.ontrack = (e) => {
    const audio = makeAudio(peerId); audio.srcObject = e.streams[0] || new MediaStream([e.track]); audio.play().catch(() => {});
    const speaker = document.getElementById(`speaker-${peerId}`); if (speaker) speaker.classList.add('speaking');
  };
  pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) cleanupPeer(peerId); };
  if (initiator) {
    const offer = await pc.createOffer({ offerToReceiveAudio: true }); await pc.setLocalDescription(offer);
    socket.emit('webrtc-offer', { target: peerId, sdp: pc.localDescription });
  }
  return pc;
}
async function flushIce(peerId, pc) {
  const arr = pendingIce.get(peerId) || [];
  for (const c of arr) try { await pc.addIceCandidate(c); } catch {}
  pendingIce.delete(peerId);
}

$('joinVoice').onclick = joinVoice;
async function joinVoice() {
  try {
    $('joinVoice').disabled = true;
    localStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: { ideal: 48000 }, channelCount: { ideal: 2 }, sampleSize: { ideal: 16 }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    joinedVoice = true; muted = false;
    socket.emit('voice-join', {}, (res) => { if (!res?.ok) showToast(res?.error || 'تعذر الانضمام للصوت.'); });
    $('joinVoice').classList.add('hidden'); $('muteBtn').classList.remove('hidden'); $('leaveVoice').classList.remove('hidden'); $('muteBtn').classList.add('live');
  } catch { showToast('ما قدرت أوصل للميكروفون. تأكد من الإذن.'); }
  finally { $('joinVoice').disabled = false; }
}
async function handleVoicePeers(list = []) { for (const p of list) try { await createPeer(p.id, true); } catch {} }
async function handleOffer({ from, sdp }) {
  if (!joinedVoice) return;
  try { const pc = await createPeer(from, false); await pc.setRemoteDescription(sdp); await flushIce(from, pc); const ans = await pc.createAnswer(); await pc.setLocalDescription(ans); socket.emit('webrtc-answer', { target: from, sdp: pc.localDescription }); } catch {}
}
async function handleAnswer({ from, sdp }) { const pc = peers.get(from); if (!pc) return; try { await pc.setRemoteDescription(sdp); await flushIce(from, pc); } catch {} }
async function handleIce({ from, candidate }) {
  const pc = peers.get(from);
  if (!pc || !pc.remoteDescription) { const arr = pendingIce.get(from) || []; arr.push(candidate); pendingIce.set(from, arr); return; }
  try { await pc.addIceCandidate(candidate); } catch {}
}
$('muteBtn').onclick = () => {
  muted = !muted; localStream?.getAudioTracks().forEach(t => t.enabled = !muted);
  $('muteBtn').textContent = muted ? '🔇' : '🎙'; socket.emit('voice-state', { muted });
};
$('deafenBtn').onclick = () => {
  deafened = !deafened; remoteAudios.forEach(a => a.muted = deafened); $('deafenBtn').textContent = deafened ? '🔇' : '🔊';
};
$('leaveVoice').onclick = leaveVoice;
function leaveVoice() {
  socket?.emit('voice-leave'); joinedVoice = false; muted = false; deafened = false;
  localStream?.getTracks().forEach(t => t.stop()); localStream = null;
  [...peers.keys()].forEach(cleanupPeer);
  $('joinVoice').classList.remove('hidden'); $('muteBtn').classList.add('hidden'); $('leaveVoice').classList.add('hidden'); $('muteBtn').classList.remove('live'); $('muteBtn').textContent = '🎙'; $('deafenBtn').textContent = '🔊';
}

$('adminBtn').onclick = () => { $('adminPanel').classList.remove('hidden'); loadAdmin(); };
document.querySelectorAll('[data-admin-close]').forEach(el => el.onclick = () => $('adminPanel').classList.add('hidden'));
$('adminRefresh').onclick = loadAdmin;
$('adminRoomsTab').onclick = () => switchAdmin('rooms');
$('adminUsersTab').onclick = () => switchAdmin('users');
function switchAdmin(view) {
  $('adminRoomsTab').classList.toggle('active', view === 'rooms'); $('adminUsersTab').classList.toggle('active', view === 'users');
  $('adminRoomsView').classList.toggle('hidden', view !== 'rooms'); $('adminUsersView').classList.toggle('hidden', view !== 'users');
}
async function loadAdmin() {
  if (me?.role !== 'admin') return;
  try {
    const [summary, users] = await Promise.all([api('/api/admin/summary'), api('/api/admin/users')]);
    $('statUsers').textContent = summary.users; $('statRooms').textContent = summary.rooms.length; $('statConnections').textContent = summary.connections;
    renderAdminRooms(summary.rooms); renderAdminUsers(users.users);
  } catch (err) { showToast(err.message); }
}
function renderAdminRooms(rooms = []) {
  $('adminRoomsView').innerHTML = rooms.length ? rooms.map(r => `<div class="admin-row"><div class="admin-row-avatar">#</div><div class="admin-row-main"><b>${esc(r.roomId)}</b><small>${r.users} متصل • ${r.voice} بالصوت • ${r.messages} رسالة</small></div><div class="admin-row-actions"><button class="btn-neutral" data-admin-clear="${esc(r.roomId)}">مسح الشات</button><button class="btn-danger" data-admin-close-room="${esc(r.roomId)}">حذف القروب</button></div></div>`).join('') : '<div class="empty-admin">ما فيه قروبات نشطة الآن.</div>';
  document.querySelectorAll('[data-admin-clear]').forEach(b => b.onclick = () => adminRoomAction(b.dataset.adminClear, 'clear'));
  document.querySelectorAll('[data-admin-close-room]').forEach(b => b.onclick = () => adminRoomAction(b.dataset.adminCloseRoom, 'close'));
}
async function adminRoomAction(id, action) {
  try {
    if (action === 'close' && !confirm(`حذف القروب ${id} وإخراج الموجودين؟`)) return;
    await api(`/api/admin/rooms/${encodeURIComponent(id)}${action === 'clear' ? '/clear' : ''}`, { method: action === 'clear' ? 'POST' : 'DELETE' });
    showToast(action === 'clear' ? 'تم مسح الشات.' : 'تم حذف القروب.'); loadAdmin();
  } catch (err) { showToast(err.message); }
}
function renderAdminUsers(users = []) {
  $('adminUsersView').innerHTML = users.length ? users.map(u => `<div class="admin-row"><div class="admin-row-avatar">${avatarHtml(u)}</div><div class="admin-row-main"><b>${esc(u.name || u.username)} ${u.role === 'admin' ? '• أدمن' : ''}</b><small>@${esc(u.username)} • ${u.blocked ? 'موقوف' : 'نشط'}</small></div><div class="admin-row-actions">${u.id === me.id ? '<button class="btn-neutral" disabled>حسابك</button>' : `<button class="btn-warn" data-admin-block="${u.id}">${u.blocked ? 'فك الإيقاف' : 'إيقاف'}</button><button class="btn-danger" data-admin-delete-user="${u.id}">حذف</button>`}</div></div>`).join('') : '<div class="empty-admin">لا توجد حسابات.</div>';
  document.querySelectorAll('[data-admin-block]').forEach(b => b.onclick = () => adminUserAction(b.dataset.adminBlock, 'block'));
  document.querySelectorAll('[data-admin-delete-user]').forEach(b => b.onclick = () => adminUserAction(b.dataset.adminDeleteUser, 'delete'));
}
async function adminUserAction(id, action) {
  try {
    if (action === 'delete' && !confirm('حذف هذا الحساب نهائيًا؟')) return;
    await api(`/api/admin/users/${id}${action === 'block' ? '/toggle-block' : ''}`, { method: action === 'block' ? 'POST' : 'DELETE' });
    showToast(action === 'block' ? 'تم تحديث حالة الحساب.' : 'تم حذف الحساب.'); loadAdmin();
  } catch (err) { showToast(err.message); }
}

async function bootstrap() {
  initGoogle();
  if (!token) return showPage('auth');
  try { const result = await api('/api/me'); me = result.user; enterLobby(); }
  catch { clearAuth(); }
}
window.addEventListener('beforeunload', () => localStream?.getTracks().forEach(t => t.stop()));
bootstrap();

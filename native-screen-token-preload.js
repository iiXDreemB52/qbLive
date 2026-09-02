const crypto = require('crypto');
const socketIo = require('socket.io');
const { AccessToken } = require('livekit-server-sdk');
const OriginalServer = socketIo.Server;

const LIVEKIT_URL = String(process.env.LIVEKIT_URL || '').trim();
const LIVEKIT_API_KEY = String(process.env.LIVEKIT_API_KEY || '').trim();
const LIVEKIT_API_SECRET = String(process.env.LIVEKIT_API_SECRET || '').trim();

function clean(v, max = 80) {
  return String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}
function roomCode(v) {
  return clean(v, 36).toLowerCase().replace(/[^a-z0-9_-]/g, '');
}
function configured() {
  return Boolean(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);
}

async function makeNativeScreenToken(socket, requestedRoom) {
  if (!configured()) return { ok:false, error:'LiveKit غير مربوط.' };
  const u = socket.data.user;
  if (!u?.id) return { ok:false, error:'يلزم تسجيل الدخول.' };
  const room = roomCode(requestedRoom || socket.data.roomId || '');
  if (!room || socket.data.roomId !== room) return { ok:false, error:'ادخل المجموعة أولًا.' };

  // The WebView already owns socket.id as its LiveKit identity. Native screen capture
  // must use a second identity or LiveKit would replace the WebView participant.
  const identity = `screen-${socket.id}-${crypto.randomBytes(3).toString('hex')}`;
  const metadata = JSON.stringify({
    userId: String(u.id),
    socketId: String(socket.id),
    ownerIdentity: String(socket.id),
    nativeScreenShare: true,
  });
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name: clean(u.display_name || u.username || 'مستخدم', 60),
    metadata,
    ttl: '2h',
  });
  at.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: false,
    canPublishData: false,
  });
  return {
    ok:true,
    url:LIVEKIT_URL,
    token:await at.toJwt(),
    room,
    identity,
    name:clean(u.display_name || u.username || 'مستخدم', 60),
  };
}

function install(io) {
  io.on('connection', socket => {
    socket.on('livekit:native-screen-token', async (payload = {}, ack = () => {}) => {
      try { ack(await makeNativeScreenToken(socket, payload.roomId)); }
      catch (e) {
        console.error('Native screen token error:', e?.message || e);
        ack({ ok:false, error:'تعذر تجهيز مشاركة شاشة Android.' });
      }
    });
  });
}

class NativeScreenTokenServer extends OriginalServer {
  constructor(...args) {
    super(...args);
    install(this);
  }
}
socketIo.Server = NativeScreenTokenServer;

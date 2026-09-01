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

async function makeDeviceToken(socket, requestedRoom) {
  if (!configured()) return { ok: false, configured: false, error: 'LiveKit غير مربوط بعد.' };
  const u = socket.data.user;
  if (!u?.id) return { ok: false, configured: true, error: 'يلزم تسجيل الدخول.' };
  const room = roomCode(requestedRoom || socket.data.roomId || '');
  if (!room || socket.data.roomId !== room) return { ok: false, configured: true, error: 'ادخل المجموعة أولًا.' };

  // LiveKit requires every concurrently connected participant to have a unique identity.
  // Using the Socket.IO connection id lets the same Sawalef account join from phone + PC.
  const identity = String(socket.id);
  const metadata = JSON.stringify({ userId: String(u.id), socketId: String(socket.id) });
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name: clean(u.display_name || u.username || 'user', 60),
    metadata,
    ttl: '2h',
  });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: false });
  return { ok: true, configured: true, url: LIVEKIT_URL, token: await at.toJwt(), room, identity };
}

function install(io) {
  io.on('connection', (socket) => {
    // This preload is installed last, so replace the older user-id based token listener.
    socket.removeAllListeners('livekit:token');
    socket.on('livekit:token', async (payload = {}, ack = () => {}) => {
      try {
        ack(await makeDeviceToken(socket, payload.roomId));
      } catch (e) {
        console.error('LiveKit device token error:', e?.message || e);
        ack({ ok: false, configured: true, error: 'تعذر تجهيز اتصال الصوت عالي الجودة.' });
      }
    });
  });
}

class DeviceIdentityServer extends OriginalServer {
  constructor(...args) {
    super(...args);
    install(this);
  }
}

socketIo.Server = DeviceIdentityServer;

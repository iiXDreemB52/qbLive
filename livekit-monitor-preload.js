const socketIo = require('socket.io');
const { RoomServiceClient } = require('livekit-server-sdk');
const OriginalServer = socketIo.Server;
const LIVEKIT_URL = String(process.env.LIVEKIT_URL || '').trim();
const LIVEKIT_API_KEY = String(process.env.LIVEKIT_API_KEY || '').trim();
const LIVEKIT_API_SECRET = String(process.env.LIVEKIT_API_SECRET || '').trim();
const ADMIN_NAME = String(process.env.SAWALEF_ADMIN_USERNAME || 'KEMO').trim().toLowerCase();

function httpUrl(url) {
  return url.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
}
function configured() {
  return Boolean(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);
}
function isAdmin(socket) {
  const u = socket.data.user || {};
  const key = String(u.username_key || u.username || '').trim().toLowerCase();
  return u.role === 'admin' || key === ADMIN_NAME;
}
async function checkLiveKit() {
  if (!configured()) return { status: 'red', label: 'معطل', configured: false, latencyMs: null, error: 'إعدادات LiveKit ناقصة' };
  const start = Date.now();
  try {
    const api = new RoomServiceClient(httpUrl(LIVEKIT_URL), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4500));
    const rooms = await Promise.race([api.listRooms(), timeout]);
    const latencyMs = Date.now() - start;
    const status = latencyMs <= 700 ? 'green' : latencyMs <= 1800 ? 'yellow' : 'red';
    return {
      status,
      label: status === 'green' ? 'ممتازة' : status === 'yellow' ? 'جيدة' : 'سيئة',
      configured: true,
      latencyMs,
      activeRooms: Array.isArray(rooms) ? rooms.length : 0,
      url: LIVEKIT_URL,
    };
  } catch (e) {
    return { status: 'red', label: 'معطل', configured: true, latencyMs: Date.now() - start, error: String(e?.message || e).slice(0, 180), url: LIVEKIT_URL };
  }
}

setTimeout(() => {
  checkLiveKit().then((r) => {
    console.log('LK_SERVER_HEALTH', JSON.stringify({
      status: r.status,
      configured: r.configured,
      latencyMs: r.latencyMs,
      activeRooms: r.activeRooms || 0,
      error: r.error || '',
    }));
  }).catch((e) => console.error('LK_SERVER_HEALTH_FAILED', e?.message || e));
}, 2500);

function install(io) {
  io.on('connection', (socket) => {
    socket.data.lkMonitor = { state: 'idle', quality: 'unknown', remoteParticipants: 0, subscribedAudio: 0, canPlaybackAudio: null, updatedAt: Date.now() };
    socket.on('livekit:client-state', (payload = {}) => {
      socket.data.lkMonitor = {
        state: String(payload.state || 'unknown').slice(0, 30),
        quality: String(payload.quality || 'unknown').slice(0, 30),
        remoteParticipants: Math.max(0, Number(payload.remoteParticipants) || 0),
        subscribedAudio: Math.max(0, Number(payload.subscribedAudio) || 0),
        canPlaybackAudio: typeof payload.canPlaybackAudio === 'boolean' ? payload.canPlaybackAudio : null,
        active: Boolean(payload.active),
        error: String(payload.error || '').slice(0, 180),
        updatedAt: Date.now(),
      };
    });
    socket.on('livekit:diagnostic', (payload = {}) => {
      const safe = {
        phase: String(payload.phase || '').slice(0, 40),
        socketId: socket.id,
        userId: socket.data.user?.id || '',
        roomId: socket.data.roomId || '',
        state: String(payload.state || '').slice(0, 30),
        localIdentity: String(payload.localIdentity || '').slice(0, 80),
        remoteParticipants: Math.max(0, Number(payload.remoteParticipants) || 0),
        canPlaybackAudio: typeof payload.canPlaybackAudio === 'boolean' ? payload.canPlaybackAudio : null,
        tokenIdentity: String(payload.tokenIdentity || '').slice(0, 80),
        participant: String(payload.participant || '').slice(0, 80),
        trackSid: String(payload.trackSid || '').slice(0, 80),
        readyState: String(payload.readyState || payload.trackState || '').slice(0, 30),
        enabled: typeof payload.enabled === 'boolean' ? payload.enabled : payload.trackEnabled,
        muted: typeof payload.muted === 'boolean' ? payload.muted : undefined,
        micEnabled: typeof payload.micEnabled === 'boolean' ? payload.micEnabled : undefined,
        error: String(payload.error || '').slice(0, 180),
      };
      console.log('LK_CLIENT_DIAG', JSON.stringify(safe));
    });
    socket.on('livekit:health', async (_payload, ack = () => {}) => {
      if (!isAdmin(socket)) return ack({ ok: false, error: 'admin_required' });
      const server = await checkLiveKit();
      const clients = [];
      for (const s of io.sockets.sockets.values()) {
        if (!s.data.user) continue;
        const m = s.data.lkMonitor || {};
        clients.push({
          socketId: s.id,
          userId: s.data.user.id,
          name: s.data.user.display_name || s.data.user.username || 'مستخدم',
          roomId: s.data.roomId || '',
          voice: Boolean(s.data.voice),
          livekit: m,
        });
      }
      ack({ ok: true, server, clients, checkedAt: Date.now() });
    });
  });
}
class MonitoredServer extends OriginalServer {
  constructor(...args) {
    super(...args);
    install(this);
  }
}
socketIo.Server = MonitoredServer;

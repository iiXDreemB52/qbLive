const socketIo = require('socket.io');
const OriginalServer = socketIo.Server;
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const ADMIN_NAME = String(process.env.SAWALEF_ADMIN_USERNAME || 'KEMO').trim().toLowerCase();
let Pool = null;
try { ({ Pool } = require('pg')); } catch {}
const db = DATABASE_URL && Pool ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 2,
}) : null;

const deletedTextByRoom = new Map();

function clean(v, max = 80) {
  return String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}
function roomCode(v) {
  return clean(v, 36).toLowerCase().replace(/[^a-z0-9_-]/g, '');
}
function isAdmin(u) {
  const key = String(u?.username_key || u?.username || '').trim().toLowerCase();
  return u?.role === 'admin' || key === ADMIN_NAME;
}
async function getGroup(roomId) {
  if (!db) return null;
  const room = roomCode(roomId);
  if (!room) return null;
  const { rows } = await db.query('SELECT room_id, created_by FROM groups WHERE room_id=$1 LIMIT 1', [room]);
  const row = rows[0];
  return row ? { roomId: row.room_id, createdBy: row.created_by } : null;
}
async function canManage(socket, roomId) {
  const group = await getGroup(roomId);
  if (!group) return false;
  const user = socket.data.user;
  return Boolean(user && (isAdmin(user) || String(group.createdBy || '') === String(user.id || '')));
}
function deletedSet(roomId) {
  const room = roomCode(roomId);
  if (!deletedTextByRoom.has(room)) deletedTextByRoom.set(room, new Set());
  return deletedTextByRoom.get(room);
}

function install(io) {
  io.on('connection', socket => {
    // The base server keeps text history in memory. Filter deleted IDs from every history
    // sent to this socket so a deleted message cannot reappear when somebody rejoins.
    const originalEmit = socket.emit.bind(socket);
    socket.emit = function sawalefModeratedEmit(event, ...args) {
      if (event === 'message-history' && Array.isArray(args[0])) {
        const room = roomCode(socket.data.roomId || '');
        const removed = deletedTextByRoom.get(room);
        if (removed?.size) args[0] = args[0].filter(m => !removed.has(String(m?.id || '')));
      }
      return originalEmit(event, ...args);
    };

    socket.on('owner:message:delete', async (payload = {}, ack = () => {}) => {
      try {
        const room = roomCode(payload.roomId || socket.data.roomId || '');
        if (!room || socket.data.roomId !== room) return ack({ ok: false, error: 'ادخل المجموعة أولًا.' });
        if (!(await canManage(socket, room))) return ack({ ok: false, error: 'حذف الرسائل متاح لمالك المجموعة فقط.' });
        const messageId = clean(payload.messageId, 80);
        if (!/^[a-z0-9-]{8,80}$/i.test(messageId)) return ack({ ok: false, error: 'الرسالة غير صالحة.' });
        deletedSet(room).add(messageId);
        io.to(room).emit('message:deleted', { id: messageId, by: socket.data.user?.id || '' });
        ack({ ok: true, id: messageId });
      } catch (e) {
        console.error('Owner message delete failed:', e?.message || e);
        ack({ ok: false, error: 'تعذر حذف الرسالة.' });
      }
    });
  });
}

class ModerationV20Server extends OriginalServer {
  constructor(...args) {
    super(...args);
    install(this);
  }
}
socketIo.Server = ModerationV20Server;

const fs = require('fs');
const socketIo = require('socket.io');
const OriginalServer = socketIo.Server;
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const GROUPS_FALLBACK_FILE = process.env.GROUPS_FALLBACK_FILE || '/tmp/sawalef-groups.json';
const ADMIN_NAME = String(process.env.SAWALEF_ADMIN_USERNAME || 'KEMO').trim().toLowerCase();
let Pool = null;
try { ({ Pool } = require('pg')); } catch {}
const db = DATABASE_URL && Pool ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 3,
}) : null;

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
  const room = roomCode(roomId);
  if (!room) return null;
  if (db) {
    const { rows } = await db.query(
      'SELECT id, room_id, name, type, image, created_by, created_at FROM groups WHERE room_id=$1 LIMIT 1',
      [room]
    );
    const r = rows[0];
    return r ? {
      id: r.id,
      roomId: r.room_id,
      name: r.name,
      type: r.type,
      image: r.image || '',
      createdBy: r.created_by,
      createdAt: r.created_at,
    } : null;
  }
  try {
    if (!fs.existsSync(GROUPS_FALLBACK_FILE)) return null;
    const d = JSON.parse(fs.readFileSync(GROUPS_FALLBACK_FILE, 'utf8'));
    return (Array.isArray(d.groups) ? d.groups : []).find(g => roomCode(g.roomId) === room) || null;
  } catch { return null; }
}
async function deleteGroup(roomId) {
  const room = roomCode(roomId);
  if (!room) return false;
  if (db) {
    const { rowCount } = await db.query('DELETE FROM groups WHERE room_id=$1', [room]);
    return rowCount > 0;
  }
  try {
    if (!fs.existsSync(GROUPS_FALLBACK_FILE)) return false;
    const d = JSON.parse(fs.readFileSync(GROUPS_FALLBACK_FILE, 'utf8'));
    const list = Array.isArray(d.groups) ? d.groups : [];
    const next = list.filter(g => roomCode(g.roomId) !== room);
    if (next.length === list.length) return false;
    fs.writeFileSync(GROUPS_FALLBACK_FILE, JSON.stringify({ groups: next }), { mode: 0o600 });
    return true;
  } catch { return false; }
}
function roomUsers(io, roomId) {
  const ids = io.sockets.adapter.rooms.get(roomId) || new Set();
  return [...ids].map(id => {
    const s = io.sockets.sockets.get(id);
    if (!s || s.data.roomId !== roomId) return null;
    const u = s.data.user || {};
    return {
      id: s.id,
      userId: u.id || '',
      name: u.display_name || u.username || 'مستخدم',
      username: u.username || '',
      avatar: u.avatar || '',
      role: u.role || 'user',
      voice: Boolean(s.data.voice),
      muted: Boolean(s.data.muted || s.data.ownerMuted),
      ownerMuted: Boolean(s.data.ownerMuted),
    };
  }).filter(Boolean);
}
function emitPresence(io, roomId) {
  if (roomId) io.to(roomId).emit('presence', roomUsers(io, roomId));
}
async function canManage(socket, roomId) {
  const group = await getGroup(roomId);
  if (!group) return { ok: false, group: null };
  const user = socket.data.user;
  return { ok: Boolean(user && (isAdmin(user) || String(group.createdBy || '') === String(user.id || ''))), group };
}

function install(io) {
  io.on('connection', socket => {
    socket.data.ownerMuted = false;

    // Prevent a server-muted member from entering microphone mode through the normal Socket.IO path.
    socket.use((packet, next) => {
      const event = packet?.[0];
      if (event === 'voice-join' && socket.data.ownerMuted) {
        const ack = packet[packet.length - 1];
        if (typeof ack === 'function') ack({ ok: false, error: 'منشئ المجموعة عطّل المايك عندك.' });
        return;
      }
      next();
    });

    socket.on('owner:room-info', async (payload = {}, ack = () => {}) => {
      try {
        const room = roomCode(payload.roomId || socket.data.roomId || '');
        if (!room || socket.data.roomId !== room) return ack({ ok: false, error: 'ادخل المجموعة أولًا.' });
        const group = await getGroup(room);
        if (!group) return ack({ ok: false, error: 'المجموعة غير موجودة.' });
        const user = socket.data.user || {};
        ack({
          ok: true,
          group,
          isOwner: String(group.createdBy || '') === String(user.id || ''),
          canManage: isAdmin(user) || String(group.createdBy || '') === String(user.id || ''),
          members: roomUsers(io, room),
        });
      } catch (e) {
        ack({ ok: false, error: 'تعذر تحميل صلاحيات المجموعة.' });
      }
    });

    socket.on('owner:group:delete', async (payload = {}, ack = () => {}) => {
      try {
        const room = roomCode(payload.roomId || socket.data.roomId || '');
        const permission = await canManage(socket, room);
        if (!permission.ok) return ack({ ok: false, error: 'الحذف متاح لمنشئ المجموعة فقط.' });
        if (!(await deleteGroup(room))) return ack({ ok: false, error: 'المجموعة غير موجودة.' });
        const ids = [...(io.sockets.adapter.rooms.get(room) || [])];
        io.to(room).emit('room-closed', { reason: 'تم حذف المجموعة بواسطة المنشئ.' });
        for (const id of ids) {
          const s = io.sockets.sockets.get(id);
          if (!s) continue;
          s.leave(room);
          s.data.roomId = null;
          s.data.voice = false;
          s.data.muted = false;
          s.data.ownerMuted = false;
        }
        io.emit('group:deleted', { roomId: room });
        ack({ ok: true });
      } catch (e) {
        console.error('Owner group delete failed:', e?.message || e);
        ack({ ok: false, error: 'تعذر حذف المجموعة.' });
      }
    });

    socket.on('owner:member:kick', async (payload = {}, ack = () => {}) => {
      try {
        const room = roomCode(payload.roomId || socket.data.roomId || '');
        const permission = await canManage(socket, room);
        if (!permission.ok) return ack({ ok: false, error: 'الطرد متاح لمنشئ المجموعة فقط.' });
        const target = io.sockets.sockets.get(String(payload.socketId || ''));
        if (!target || target.data.roomId !== room) return ack({ ok: false, error: 'الشخص غير موجود في المجموعة.' });
        if (target.id === socket.id) return ack({ ok: false, error: 'ما تقدر تطرد نفسك.' });
        target.emit('owner:kicked', { reason: 'تم إخراجك من المجموعة بواسطة المنشئ.' });
        target.leave(room);
        target.data.roomId = null;
        target.data.voice = false;
        target.data.muted = false;
        target.data.ownerMuted = false;
        emitPresence(io, room);
        ack({ ok: true });
      } catch (e) {
        ack({ ok: false, error: 'تعذر إخراج الشخص.' });
      }
    });

    socket.on('owner:member:mute', async (payload = {}, ack = () => {}) => {
      try {
        const room = roomCode(payload.roomId || socket.data.roomId || '');
        const permission = await canManage(socket, room);
        if (!permission.ok) return ack({ ok: false, error: 'الميوت متاح لمنشئ المجموعة فقط.' });
        const target = io.sockets.sockets.get(String(payload.socketId || ''));
        if (!target || target.data.roomId !== room) return ack({ ok: false, error: 'الشخص غير موجود في المجموعة.' });
        if (target.id === socket.id) return ack({ ok: false, error: 'استخدم زر المايك لكتم نفسك.' });
        const muted = Boolean(payload.muted);
        target.data.ownerMuted = muted;
        if (muted) target.data.muted = true;
        target.emit('owner:mute-state', { muted, reason: muted ? 'منشئ المجموعة عطّل المايك عندك.' : 'تم السماح لك باستخدام المايك.' });
        emitPresence(io, room);
        ack({ ok: true, muted });
      } catch (e) {
        ack({ ok: false, error: 'تعذر تغيير حالة المايك.' });
      }
    });

    socket.on('profile:changed', (payload = {}) => {
      const avatar = String(payload.avatar || '');
      if (!/^(data:image\/(png|jpeg|webp);base64,|https:\/\/)/i.test(avatar)) return;
      if (socket.data.user) socket.data.user.avatar = avatar.slice(0, 650000);
      io.emit('profile:updated', { userId: socket.data.user?.id || '', avatar: socket.data.user?.avatar || '' });
      emitPresence(io, socket.data.roomId);
    });

    socket.on('disconnect', () => {
      // Socket-scoped owner mute disappears with that device connection, which is intentional.
    });
  });
}

class OwnerControlsServer extends OriginalServer {
  constructor(...args) {
    super(...args);
    install(this);
  }
}
socketIo.Server = OwnerControlsServer;

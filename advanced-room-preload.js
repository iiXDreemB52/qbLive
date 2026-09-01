const crypto = require('crypto');
const socketIo = require('socket.io');
const OriginalServer = socketIo.Server;
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const ADMIN_NAME = String(process.env.SAWALEF_ADMIN_USERNAME || 'KEMO').trim().toLowerCase();
let Pool = null;
try { ({ Pool } = require('pg')); } catch {}
const db = DATABASE_URL && Pool ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 3,
}) : null;

function clean(v, max = 120) {
  return String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}
function roomCode(v) {
  return clean(v, 36).toLowerCase().replace(/[^a-z0-9_-]/g, '');
}
function isAdmin(u) {
  const key = String(u?.username_key || u?.username || '').trim().toLowerCase();
  return u?.role === 'admin' || key === ADMIN_NAME;
}
function validGroupImage(v) {
  if (v === '') return '';
  if (!v) return null;
  return /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(v) && v.length <= 650000 ? v : null;
}
function validMedia(kind, mime, dataUrl) {
  const k = kind === 'video' ? 'video' : 'image';
  const m = clean(mime, 80).toLowerCase();
  const d = String(dataUrl || '');
  const allowedImage = /^image\/(jpeg|png|webp|gif)$/i.test(m);
  const allowedVideo = /^video\/(mp4|webm|quicktime)$/i.test(m);
  if (k === 'image' && !allowedImage) return null;
  if (k === 'video' && !allowedVideo) return null;
  const prefix = k === 'image' ? /^data:image\/(jpeg|png|webp|gif);base64,/i : /^data:video\/(mp4|webm|quicktime);base64,/i;
  if (!prefix.test(d)) return null;
  const max = k === 'image' ? 2_600_000 : 11_800_000;
  if (d.length > max) return null;
  return { kind: k, mime: m, dataUrl: d };
}
async function getGroup(roomId) {
  if (!db) return null;
  const room = roomCode(roomId);
  const { rows } = await db.query('SELECT id, room_id, name, type, image, created_by, created_at FROM groups WHERE room_id=$1 LIMIT 1', [room]);
  const r = rows[0];
  return r ? { id:r.id, roomId:r.room_id, name:r.name, type:r.type, image:r.image || '', createdBy:r.created_by, createdAt:r.created_at } : null;
}
function roomUsers(io, roomId) {
  const ids = io.sockets.adapter.rooms.get(roomId) || new Set();
  const seen = new Set();
  const users = [];
  for (const id of ids) {
    const s = io.sockets.sockets.get(id);
    if (!s || s.data.roomId !== roomId) continue;
    const u = s.data.user;
    if (!u?.id || seen.has(u.id)) continue;
    seen.add(u.id);
    users.push({ id:u.id, name:u.display_name || u.username || 'مستخدم', username:u.username || '', avatar:u.avatar || '' });
  }
  return users;
}
async function listPublicGroups(io) {
  if (!db) return [];
  const { rows } = await db.query('SELECT id, room_id, name, type, image, created_by, created_at FROM groups WHERE type=\'public\' ORDER BY created_at DESC');
  return rows.map(r => {
    const activeUsers = roomUsers(io, r.room_id);
    let voiceCount = 0;
    for (const s of io.sockets.sockets.values()) if (s.data.roomId === r.room_id && s.data.voice) voiceCount++;
    return { id:r.id, roomId:r.room_id, name:r.name, type:r.type, image:r.image || '', createdBy:r.created_by, createdAt:r.created_at, activeCount:activeUsers.length, voiceCount, activeUsers:activeUsers.slice(0,6) };
  });
}
async function canManage(socket, roomId) {
  const group = await getGroup(roomId);
  if (!group) return { ok:false, group:null };
  const u = socket.data.user;
  return { ok:Boolean(u && (isAdmin(u) || String(group.createdBy || '') === String(u.id || ''))), group };
}
async function mediaHistory(roomId) {
  if (!db) return [];
  const { rows } = await db.query('SELECT id, room_id, user_id, name, avatar, kind, mime, data_url, caption, ts FROM message_media WHERE room_id=$1 ORDER BY ts ASC LIMIT 80', [roomId]);
  return rows.map(r => ({ id:r.id, roomId:r.room_id, userId:r.user_id, name:r.name, avatar:r.avatar || '', kind:r.kind, mime:r.mime, dataUrl:r.data_url, caption:r.caption || '', ts:Number(r.ts) }));
}

function install(io) {
  io.on('connection', socket => {
    socket.data.screenSharing = false;

    socket.on('groups:list:v2', async (_p, ack = () => {}) => {
      try { ack({ ok:true, groups:await listPublicGroups(io) }); }
      catch (e) { console.error('groups:list:v2 failed:', e?.message || e); ack({ ok:false, error:'تعذر تحميل المجموعات.' }); }
    });

    socket.on('join-room', payload => {
      const target = roomCode(payload?.roomId || '');
      if (!target) return;
      setTimeout(async () => {
        try {
          if (socket.data.roomId === target) socket.emit('media-history', await mediaHistory(target));
        } catch (e) { console.error('Media history load failed:', e?.message || e); }
      }, 180);
    });

    socket.on('media:history', async (_p, ack = () => {}) => {
      try {
        const room = roomCode(socket.data.roomId || '');
        if (!room) return ack({ ok:false, error:'ادخل المجموعة أولًا.' });
        ack({ ok:true, messages:await mediaHistory(room) });
      } catch { ack({ ok:false, error:'تعذر تحميل الوسائط.' }); }
    });

    socket.on('chat-media-message', async (payload = {}, ack = () => {}) => {
      try {
        const room = roomCode(socket.data.roomId || '');
        const u = socket.data.user;
        if (!room || !u?.id) return ack({ ok:false, error:'ادخل المجموعة أولًا.' });
        const media = validMedia(payload.kind, payload.mime, payload.dataUrl);
        if (!media) return ack({ ok:false, error:'الملف غير مدعوم أو حجمه كبير.' });
        const caption = clean(payload.caption, 500);
        const message = {
          id:crypto.randomUUID(), roomId:room, userId:u.id,
          name:u.display_name || u.username || 'مستخدم', avatar:u.avatar || '',
          kind:media.kind, mime:media.mime, dataUrl:media.dataUrl, caption, ts:Date.now(),
        };
        if (db) await db.query(
          'INSERT INTO message_media(id,room_id,user_id,name,avatar,kind,mime,data_url,caption,ts) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [message.id,room,message.userId,message.name,message.avatar,message.kind,message.mime,message.dataUrl,message.caption,message.ts]
        );
        io.to(room).emit('chat-media-message', message);
        ack({ ok:true, id:message.id });
      } catch (e) {
        console.error('Media send failed:', e?.message || e);
        ack({ ok:false, error:'تعذر إرسال الملف.' });
      }
    });

    socket.on('owner:group:update', async (payload = {}, ack = () => {}) => {
      try {
        const room = roomCode(payload.roomId || socket.data.roomId || '');
        const permission = await canManage(socket, room);
        if (!permission.ok) return ack({ ok:false, error:'تعديل المجموعة متاح للمنشئ فقط.' });
        const name = clean(payload.name, 45);
        if (name.length < 2) return ack({ ok:false, error:'اسم المجموعة قصير.' });
        const hasImage = Object.prototype.hasOwnProperty.call(payload, 'image');
        const image = hasImage ? validGroupImage(payload.image) : permission.group.image;
        if (hasImage && image === null) return ack({ ok:false, error:'صورة المجموعة غير صالحة.' });
        if (!db) return ack({ ok:false, error:'التخزين الدائم غير متاح.' });
        const { rows } = await db.query('UPDATE groups SET name=$2, image=$3 WHERE room_id=$1 RETURNING id, room_id, name, type, image, created_by, created_at', [room,name,image || '']);
        const r = rows[0];
        if (!r) return ack({ ok:false, error:'المجموعة غير موجودة.' });
        const group = { id:r.id, roomId:r.room_id, name:r.name, type:r.type, image:r.image || '', createdBy:r.created_by, createdAt:r.created_at };
        io.emit('group:updated', { group });
        ack({ ok:true, group });
      } catch (e) {
        console.error('Group update failed:', e?.message || e);
        ack({ ok:false, error:'تعذر حفظ إعدادات المجموعة.' });
      }
    });

    socket.on('screen-share-state', payload => {
      socket.data.screenSharing = Boolean(payload?.active);
      if (socket.data.roomId) io.to(socket.data.roomId).emit('screen-share-presence', { socketId:socket.id, active:socket.data.screenSharing });
    });

    socket.on('admin:advanced-summary', async (_p, ack = () => {}) => {
      try {
        if (!isAdmin(socket.data.user)) return ack({ ok:false, error:'صلاحية أدمن مطلوبة.' });
        let speakers = 0, listeners = 0, screenShares = 0;
        for (const s of io.sockets.sockets.values()) {
          if (!s.data.roomId) continue;
          if (s.data.voice) speakers++; else listeners++;
          if (s.data.screenSharing) screenShares++;
        }
        let mediaMessages = 0;
        if (db) {
          const { rows } = await db.query('SELECT COUNT(*)::int AS count FROM message_media');
          mediaMessages = rows[0]?.count || 0;
        }
        ack({ ok:true, speakers, listeners, screenShares, mediaMessages });
      } catch { ack({ ok:false, error:'تعذر تحميل الإحصائيات.' }); }
    });
  });
}

class AdvancedRoomServer extends OriginalServer {
  constructor(...args) {
    if (args[1] && typeof args[1] === 'object') args[1] = { ...args[1], maxHttpBufferSize: 14 * 1024 * 1024 };
    super(...args);
    install(this);
  }
}
socketIo.Server = AdvancedRoomServer;

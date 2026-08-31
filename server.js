const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e6,
  pingTimeout: 20000,
  pingInterval: 25000,
});

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_DAYS = 30;
const FALLBACK_FILE = process.env.AUTH_FALLBACK_FILE || '/tmp/sawalef-auth.json';
const roomMessages = new Map();
const authAttempts = new Map();
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 8,
}) : null;

const fallback = { users: [], sessions: [] };

app.disable('x-powered-by');
app.use(express.json({ limit: '700kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
}));

function cleanText(value, max = 120) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}
function usernameKey(value) {
  return cleanText(value, 28).toLowerCase().replace(/\s+/g, '');
}
function validUsername(value) {
  return /^[\p{L}\p{N}_.-]{3,28}$/u.test(value);
}
function validAvatar(value) {
  if (!value) return '';
  if (/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value) && value.length <= 500000) return value;
  if (/^https:\/\/(lh3\.googleusercontent\.com|googleusercontent\.com)\//i.test(value)) return value.slice(0, 1000);
  return '';
}
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    name: row.display_name,
    avatar: row.avatar || '',
    role: row.role,
    blocked: Boolean(row.blocked),
  };
}
function fallbackSave() {
  if (pool) return;
  try {
    fs.writeFileSync(FALLBACK_FILE, JSON.stringify(fallback), { mode: 0o600 });
  } catch (err) {
    console.error('Fallback auth save failed:', err.message || err);
  }
}
function fallbackLoad() {
  if (pool) return;
  try {
    if (!fs.existsSync(FALLBACK_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf8'));
    fallback.users = Array.isArray(parsed.users) ? parsed.users : [];
    fallback.sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
  } catch (err) {
    console.error('Fallback auth load failed:', err.message || err);
  }
}
async function dbQuery(text, params = []) {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  return pool.query(text, params);
}
async function getUserByUsernameKey(key) {
  if (pool) {
    const { rows } = await dbQuery('SELECT * FROM users WHERE username_key=$1 LIMIT 1', [key]);
    return rows[0] || null;
  }
  return fallback.users.find(u => u.username_key === key) || null;
}
async function getUserByGoogleSub(sub) {
  if (pool) {
    const { rows } = await dbQuery('SELECT * FROM users WHERE google_sub=$1 LIMIT 1', [sub]);
    return rows[0] || null;
  }
  return fallback.users.find(u => u.google_sub === sub) || null;
}
async function insertUser(user) {
  if (pool) {
    const { rows } = await dbQuery(
      `INSERT INTO users(id, username, username_key, display_name, password_hash, avatar, google_sub, role, blocked)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [user.id, user.username, user.username_key, user.display_name, user.password_hash || null, user.avatar || '', user.google_sub || null, user.role || 'user', Boolean(user.blocked)]
    );
    return rows[0];
  }
  if (fallback.users.some(u => u.username_key === user.username_key)) {
    const err = new Error('duplicate username'); err.code = '23505'; throw err;
  }
  if (user.google_sub && fallback.users.some(u => u.google_sub === user.google_sub)) {
    const err = new Error('duplicate google'); err.code = '23505'; throw err;
  }
  const row = { ...user, created_at: new Date().toISOString(), blocked: Boolean(user.blocked), role: user.role || 'user' };
  fallback.users.push(row); fallbackSave(); return row;
}
async function updateUser(user) {
  if (pool) {
    const { rows } = await dbQuery(
      `UPDATE users SET username=$2, username_key=$3, display_name=$4, password_hash=$5, avatar=$6, google_sub=$7, role=$8, blocked=$9 WHERE id=$1 RETURNING *`,
      [user.id, user.username, user.username_key, user.display_name, user.password_hash || null, user.avatar || '', user.google_sub || null, user.role || 'user', Boolean(user.blocked)]
    );
    return rows[0] || null;
  }
  const i = fallback.users.findIndex(u => u.id === user.id);
  if (i < 0) return null;
  fallback.users[i] = { ...fallback.users[i], ...user };
  fallbackSave(); return fallback.users[i];
}
async function deleteUserById(id) {
  if (pool) {
    const { rows } = await dbQuery('DELETE FROM users WHERE id=$1 RETURNING id', [id]);
    return Boolean(rows.length);
  }
  const before = fallback.users.length;
  fallback.users = fallback.users.filter(u => u.id !== id);
  fallback.sessions = fallback.sessions.filter(s => s.user_id !== id);
  fallbackSave(); return fallback.users.length !== before;
}
async function listUsers() {
  if (pool) {
    const { rows } = await dbQuery('SELECT * FROM users ORDER BY created_at DESC LIMIT 500');
    return rows;
  }
  return [...fallback.users].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 500);
}
async function countUsers() {
  if (pool) {
    const { rows } = await dbQuery('SELECT COUNT(*)::int AS count FROM users');
    return rows[0].count;
  }
  return fallback.users.length;
}
async function deleteSessionsForUser(userId) {
  if (pool) return dbQuery('DELETE FROM sessions WHERE user_id=$1', [userId]);
  fallback.sessions = fallback.sessions.filter(s => s.user_id !== userId); fallbackSave();
}
async function deleteSessionToken(token) {
  if (!token) return;
  const h = hashToken(token);
  if (pool) return dbQuery('DELETE FROM sessions WHERE token_hash=$1', [h]);
  fallback.sessions = fallback.sessions.filter(s => s.token_hash !== h); fallbackSave();
}

async function initDb() {
  if (pool) {
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        username_key TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        password_hash TEXT,
        avatar TEXT NOT NULL DEFAULT '',
        google_sub TEXT UNIQUE,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
        blocked BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
    `);
    await dbQuery('DELETE FROM sessions WHERE expires_at < NOW()');
  } else {
    fallbackLoad();
    fallback.sessions = fallback.sessions.filter(s => new Date(s.expires_at).getTime() > Date.now());
    fallbackSave();
    console.warn('DATABASE_URL is missing; using temporary local auth storage.');
  }

  if (ADMIN_PASSWORD) {
    const key = usernameKey(ADMIN_USERNAME);
    let existing = await getUserByUsernameKey(key);
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    if (!existing) {
      existing = await insertUser({
        id: crypto.randomUUID(), username: ADMIN_USERNAME, username_key: key,
        display_name: ADMIN_USERNAME, password_hash: passwordHash, avatar: '', google_sub: null,
        role: 'admin', blocked: false,
      });
      console.log('Admin account created.');
    } else {
      existing.role = 'admin'; existing.password_hash = passwordHash;
      await updateUser(existing);
      console.log('Admin account verified.');
    }
  }
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  if (pool) {
    await dbQuery(
      `INSERT INTO sessions(token_hash, user_id, expires_at)
       VALUES($1,$2,NOW() + ($3 || ' days')::interval)`,
      [tokenHash, userId, String(SESSION_DAYS)]
    );
  } else {
    fallback.sessions.push({ token_hash: tokenHash, user_id: userId, expires_at: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString() });
    fallbackSave();
  }
  return token;
}

async function sessionUser(token) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  let user = null;
  if (pool) {
    const { rows } = await dbQuery(
      `SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at > NOW() LIMIT 1`,
      [tokenHash]
    );
    user = rows[0] || null;
  } else {
    const session = fallback.sessions.find(s => s.token_hash === tokenHash && new Date(s.expires_at).getTime() > Date.now());
    if (session) user = fallback.users.find(u => u.id === session.user_id) || null;
  }
  if (!user || user.blocked) return null;
  return user;
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}
async function requireAuth(req, res, next) {
  try {
    const user = await sessionUser(bearer(req));
    if (!user) return res.status(401).json({ ok: false, error: 'يلزم تسجيل الدخول.' });
    req.user = user; next();
  } catch (err) {
    console.error(err); res.status(500).json({ ok: false, error: 'تعذر التحقق من الحساب.' });
  }
}
async function requireAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: 'صلاحية أدمن مطلوبة.' });
    next();
  });
}
function limited(req, key = 'auth') {
  const id = `${key}:${req.ip}`;
  const now = Date.now();
  const data = authAttempts.get(id) || { n: 0, start: now };
  if (now - data.start > 10 * 60 * 1000) { data.n = 0; data.start = now; }
  data.n += 1; authAttempts.set(id, data);
  return data.n > 35;
}

app.get('/health', async (_req, res) => {
  let db = false;
  try { if (pool) { await dbQuery('SELECT 1'); db = true; } } catch {}
  res.json({ ok: true, db, auth: true, storage: pool ? 'postgres' : 'temporary-local', time: new Date().toISOString() });
});
app.get('/api/config', (_req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID || null, pwa: true, storage: pool ? 'postgres' : 'temporary-local' }));

app.post('/api/auth/register', async (req, res) => {
  try {
    if (limited(req, 'register')) return res.status(429).json({ ok: false, error: 'محاولات كثيرة، جرّب بعد قليل.' });
    const username = cleanText(req.body.username, 28);
    const key = usernameKey(username);
    const password = String(req.body.password || '');
    const avatar = validAvatar(req.body.avatar);
    if (!validUsername(username)) return res.status(400).json({ ok: false, error: 'الاسم 3–28 حرفًا ويقبل الحروف والأرقام و _ . - فقط.' });
    if (password.length < 6 || password.length > 128) return res.status(400).json({ ok: false, error: 'الباسورد لازم يكون 6 أحرف على الأقل.' });
    if (await getUserByUsernameKey(key)) return res.status(409).json({ ok: false, error: 'الاسم مستخدم من قبل.' });
    const hash = await bcrypt.hash(password, 12);
    const user = await insertUser({
      id: crypto.randomUUID(), username, username_key: key, display_name: username,
      password_hash: hash, avatar, google_sub: null, role: 'user', blocked: false,
    });
    const token = await createSession(user.id);
    res.json({ ok: true, token, user: publicUser(user) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ ok: false, error: 'الاسم مستخدم من قبل.' });
    console.error(err); res.status(500).json({ ok: false, error: 'تعذر إنشاء الحساب.' });
  }
});
app.post('/api/auth/login', async (req, res) => {
  try {
    if (limited(req, 'login')) return res.status(429).json({ ok: false, error: 'محاولات كثيرة، جرّب بعد قليل.' });
    const key = usernameKey(req.body.username);
    const password = String(req.body.password || '');
    const user = await getUserByUsernameKey(key);
    if (!user?.password_hash || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ ok: false, error: 'الاسم أو الباسورد غير صحيح.' });
    if (user.blocked) return res.status(403).json({ ok: false, error: 'الحساب موقوف.' });
    const token = await createSession(user.id);
    res.json({ ok: true, token, user: publicUser(user) });
  } catch (err) {
    console.error(err); res.status(500).json({ ok: false, error: 'تعذر تسجيل الدخول.' });
  }
});
app.post('/api/auth/google', async (req, res) => {
  try {
    if (!googleClient || !GOOGLE_CLIENT_ID) return res.status(503).json({ ok: false, error: 'تسجيل Google غير مفعّل بعد.' });
    if (limited(req, 'google')) return res.status(429).json({ ok: false, error: 'محاولات كثيرة، جرّب بعد قليل.' });
    const credential = String(req.body.credential || '');
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p?.sub) return res.status(401).json({ ok: false, error: 'تعذر التحقق من Google.' });
    let user = await getUserByGoogleSub(p.sub);
    if (!user) {
      let base = cleanText((p.name || p.email?.split('@')[0] || 'google-user').replace(/\s+/g, '-'), 22) || 'google-user';
      base = base.replace(/[^\p{L}\p{N}_.-]/gu, '') || 'google-user';
      let username = base, key = usernameKey(username);
      for (let i = 0; i < 20 && await getUserByUsernameKey(key); i++) {
        username = `${base.slice(0, 20)}-${Math.floor(Math.random() * 9000 + 1000)}`;
        key = usernameKey(username);
      }
      user = await insertUser({
        id: crypto.randomUUID(), username, username_key: key, display_name: cleanText(p.name || username, 40),
        password_hash: null, avatar: validAvatar(p.picture || ''), google_sub: p.sub, role: 'user', blocked: false,
      });
    }
    if (user.blocked) return res.status(403).json({ ok: false, error: 'الحساب موقوف.' });
    const token = await createSession(user.id);
    res.json({ ok: true, token, user: publicUser(user) });
  } catch (err) {
    console.error(err.message || err); res.status(401).json({ ok: false, error: 'فشل تسجيل الدخول عبر Google.' });
  }
});
app.get('/api/me', requireAuth, (req, res) => res.json({ ok: true, user: publicUser(req.user) }));
app.post('/api/logout', requireAuth, async (req, res) => { try { await deleteSessionToken(bearer(req)); } catch {} res.json({ ok: true }); });
app.patch('/api/me/avatar', requireAuth, async (req, res) => {
  const avatar = validAvatar(req.body.avatar);
  if (!avatar) return res.status(400).json({ ok: false, error: 'صورة غير صالحة.' });
  req.user.avatar = avatar;
  const user = await updateUser(req.user);
  res.json({ ok: true, user: publicUser(user) });
});

function roomUsers(roomId) {
  const ids = io.sockets.adapter.rooms.get(roomId) || new Set();
  return [...ids].map((id) => {
    const s = io.sockets.sockets.get(id);
    if (!s || s.data.roomId !== roomId) return null;
    return {
      id: s.id, userId: s.data.user?.id, name: s.data.user?.display_name || 'زائر', avatar: s.data.user?.avatar || '',
      role: s.data.user?.role || 'user', voice: Boolean(s.data.voice), muted: Boolean(s.data.muted),
    };
  }).filter(Boolean);
}
function activeRooms() {
  const ids = new Set();
  for (const s of io.sockets.sockets.values()) if (s.data.roomId) ids.add(s.data.roomId);
  return [...ids].map((roomId) => {
    const users = roomUsers(roomId);
    return { roomId, users: users.length, voice: users.filter(u => u.voice).length, messages: (roomMessages.get(roomId) || []).length };
  }).sort((a, b) => b.users - a.users);
}
function emitPresence(roomId) { io.to(roomId).emit('presence', roomUsers(roomId)); }
function leaveCurrentRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  socket.to(roomId).emit('peer-left', { id: socket.id });
  socket.leave(roomId); socket.data.roomId = null; socket.data.voice = false; socket.data.muted = false; emitPresence(roomId);
}
function closeRoom(roomId, reason = 'تم إغلاق القروب بواسطة الأدمن.') {
  const ids = [...(io.sockets.adapter.rooms.get(roomId) || [])];
  io.to(roomId).emit('room-closed', { reason });
  for (const id of ids) { const s = io.sockets.sockets.get(id); if (s) leaveCurrentRoom(s); }
  roomMessages.delete(roomId);
}

app.get('/api/admin/summary', requireAdmin, async (_req, res) => {
  res.json({ ok: true, users: await countUsers(), connections: io.engine.clientsCount, rooms: activeRooms() });
});
app.get('/api/admin/rooms', requireAdmin, (_req, res) => res.json({ ok: true, rooms: activeRooms() }));
app.post('/api/admin/rooms/:roomId/clear', requireAdmin, (req, res) => {
  const roomId = cleanText(req.params.roomId, 36).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  roomMessages.set(roomId, []); io.to(roomId).emit('message-history', []); res.json({ ok: true });
});
app.delete('/api/admin/rooms/:roomId', requireAdmin, (req, res) => {
  const roomId = cleanText(req.params.roomId, 36).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  closeRoom(roomId); res.json({ ok: true });
});
app.get('/api/admin/users', requireAdmin, async (_req, res) => res.json({ ok: true, users: (await listUsers()).map(publicUser) }));
app.post('/api/admin/users/:id/toggle-block', requireAdmin, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ ok: false, error: 'ما تقدر توقف حسابك الحالي.' });
  const users = await listUsers();
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ ok: false, error: 'الحساب غير موجود.' });
  user.blocked = !user.blocked;
  await updateUser(user);
  if (user.blocked) {
    await deleteSessionsForUser(user.id);
    for (const s of io.sockets.sockets.values()) if (s.data.user?.id === user.id) s.disconnect(true);
  }
  res.json({ ok: true, user: publicUser(user) });
});
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ ok: false, error: 'ما تقدر تحذف حسابك الحالي.' });
  if (!(await deleteUserById(req.params.id))) return res.status(404).json({ ok: false, error: 'الحساب غير موجود.' });
  for (const s of io.sockets.sockets.values()) if (s.data.user?.id === req.params.id) s.disconnect(true);
  res.json({ ok: true });
});
app.post('/api/admin/connections/:socketId/kick', requireAdmin, (req, res) => {
  const s = io.sockets.sockets.get(req.params.socketId);
  if (!s) return res.status(404).json({ ok: false, error: 'الاتصال غير موجود.' });
  s.emit('kicked', { reason: 'تم إخراجك بواسطة الأدمن.' }); s.disconnect(true); res.json({ ok: true });
});

io.use(async (socket, next) => {
  try {
    const user = await sessionUser(socket.handshake.auth?.token || '');
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user; next();
  } catch (err) { next(err); }
});
io.on('connection', (socket) => {
  socket.data.voice = false; socket.data.muted = false;
  socket.on('join-room', (payload = {}, ack = () => {}) => {
    const roomId = cleanText(payload.roomId, 36).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!roomId) return ack({ ok: false, error: 'رمز الغرفة مطلوب.' });
    leaveCurrentRoom(socket); socket.data.roomId = roomId; socket.join(roomId);
    socket.emit('message-history', roomMessages.get(roomId) || []); emitPresence(roomId); ack({ ok: true, roomId });
  });
  socket.on('leave-room', () => leaveCurrentRoom(socket));
  socket.on('chat-message', (payload = {}, ack = () => {}) => {
    const roomId = socket.data.roomId; if (!roomId) return ack({ ok: false });
    const text = cleanText(payload.text, 1000); if (!text) return ack({ ok: false });
    const message = {
      id: crypto.randomUUID(), senderId: socket.id, userId: socket.data.user.id,
      name: socket.data.user.display_name, avatar: socket.data.user.avatar || '', text, ts: Date.now(),
    };
    const history = roomMessages.get(roomId) || []; history.push(message);
    if (history.length > 150) history.splice(0, history.length - 150);
    roomMessages.set(roomId, history); io.to(roomId).emit('chat-message', message); ack({ ok: true });
  });
  socket.on('voice-join', (_payload, ack = () => {}) => {
    const roomId = socket.data.roomId; if (!roomId) return ack({ ok: false, error: 'ادخل الغرفة أولًا.' });
    socket.data.voice = true;
    const peers = roomUsers(roomId).filter(u => u.voice && u.id !== socket.id);
    socket.emit('voice-peers', peers); emitPresence(roomId); ack({ ok: true, peers: peers.length });
  });
  socket.on('voice-leave', () => {
    const roomId = socket.data.roomId; if (!roomId) return;
    socket.data.voice = false; socket.data.muted = false; socket.to(roomId).emit('peer-left', { id: socket.id }); emitPresence(roomId);
  });
  socket.on('voice-state', (payload = {}) => {
    const roomId = socket.data.roomId; if (!roomId) return;
    socket.data.muted = Boolean(payload.muted); emitPresence(roomId);
  });
  socket.on('webrtc-offer', ({ target, sdp } = {}) => {
    if (!target || !sdp || !socket.data.roomId) return;
    const targetSocket = io.sockets.sockets.get(target);
    if (!targetSocket || targetSocket.data.roomId !== socket.data.roomId) return;
    io.to(target).emit('webrtc-offer', { from: socket.id, sdp, name: socket.data.user.display_name });
  });
  socket.on('webrtc-answer', ({ target, sdp } = {}) => {
    if (!target || !sdp || !socket.data.roomId) return;
    const targetSocket = io.sockets.sockets.get(target);
    if (!targetSocket || targetSocket.data.roomId !== socket.data.roomId) return;
    io.to(target).emit('webrtc-answer', { from: socket.id, sdp });
  });
  socket.on('webrtc-ice', ({ target, candidate } = {}) => {
    if (!target || !candidate || !socket.data.roomId) return;
    const targetSocket = io.sockets.sockets.get(target);
    if (!targetSocket || targetSocket.data.roomId !== socket.data.roomId) return;
    io.to(target).emit('webrtc-ice', { from: socket.id, candidate });
  });
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId; if (!roomId) return;
    socket.to(roomId).emit('peer-left', { id: socket.id }); setTimeout(() => emitPresence(roomId), 0);
  });
});

initDb()
  .then(() => server.listen(PORT, '0.0.0.0', () => console.log(`Sawalef voice chat listening on :${PORT}`)))
  .catch((err) => {
    console.error('Auth storage initialization failed:', err);
    process.exit(1);
  });

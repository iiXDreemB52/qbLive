const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e6,
  pingTimeout: 20000,
  pingInterval: 25000,
});

const PORT = process.env.PORT || 3000;
const roomMessages = new Map();

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
}));

app.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

function cleanText(value, max = 120) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

function roomUsers(roomId) {
  const ids = io.sockets.adapter.rooms.get(roomId) || new Set();
  return [...ids].map((id) => {
    const s = io.sockets.sockets.get(id);
    if (!s) return null;
    return {
      id: s.id,
      name: s.data.name || 'زائر',
      voice: Boolean(s.data.voice),
      muted: Boolean(s.data.muted),
    };
  }).filter(Boolean);
}

function emitPresence(roomId) {
  io.to(roomId).emit('presence', roomUsers(roomId));
}

function leaveCurrentRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  socket.to(roomId).emit('peer-left', { id: socket.id });
  socket.leave(roomId);
  socket.data.roomId = null;
  socket.data.voice = false;
  socket.data.muted = false;
  emitPresence(roomId);
}

io.on('connection', (socket) => {
  socket.data.voice = false;
  socket.data.muted = false;

  socket.on('join-room', (payload = {}, ack = () => {}) => {
    const name = cleanText(payload.name, 28);
    const roomId = cleanText(payload.roomId, 36).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!name || !roomId) return ack({ ok: false, error: 'الاسم ورمز الغرفة مطلوبان.' });

    leaveCurrentRoom(socket);
    socket.data.name = name;
    socket.data.roomId = roomId;
    socket.join(roomId);

    const history = roomMessages.get(roomId) || [];
    socket.emit('message-history', history);
    emitPresence(roomId);
    ack({ ok: true, roomId });
  });

  socket.on('chat-message', (payload = {}, ack = () => {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) return ack({ ok: false });
    const text = cleanText(payload.text, 1000);
    if (!text) return ack({ ok: false });

    const message = {
      id: crypto.randomUUID(),
      senderId: socket.id,
      name: socket.data.name || 'زائر',
      text,
      ts: Date.now(),
    };

    const history = roomMessages.get(roomId) || [];
    history.push(message);
    if (history.length > 100) history.splice(0, history.length - 100);
    roomMessages.set(roomId, history);
    io.to(roomId).emit('chat-message', message);
    ack({ ok: true });
  });

  socket.on('voice-join', (_payload, ack = () => {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) return ack({ ok: false, error: 'ادخل الغرفة أولًا.' });
    socket.data.voice = true;
    const peers = roomUsers(roomId).filter((u) => u.voice && u.id !== socket.id);
    socket.emit('voice-peers', peers);
    emitPresence(roomId);
    ack({ ok: true, peers: peers.length });
  });

  socket.on('voice-leave', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.data.voice = false;
    socket.data.muted = false;
    socket.to(roomId).emit('peer-left', { id: socket.id });
    emitPresence(roomId);
  });

  socket.on('voice-state', (payload = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.data.muted = Boolean(payload.muted);
    emitPresence(roomId);
  });

  socket.on('webrtc-offer', ({ target, sdp } = {}) => {
    if (!target || !sdp || !socket.data.roomId) return;
    const targetSocket = io.sockets.sockets.get(target);
    if (!targetSocket || targetSocket.data.roomId !== socket.data.roomId) return;
    io.to(target).emit('webrtc-offer', { from: socket.id, sdp, name: socket.data.name });
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
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit('peer-left', { id: socket.id });
    setTimeout(() => emitPresence(roomId), 0);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Group voice chat listening on :${PORT}`);
});

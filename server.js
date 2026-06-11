require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── In-memory store ───────────────────────────────────────────────────────────
const rooms = new Map();
// room shape:
// { id, name, code, hostId, isPrivate, members: Map<socketId, member>, queue: [], currentTrack, playback: { playing, startedAt, pausedAt, position }, chat: [] }

function createRoom({ name, isPrivate, hostName, hostId }) {
  const id = uuidv4();
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const room = {
    id, name, code, hostId, isPrivate,
    members: new Map(),
    queue: [],
    currentTrack: null,
    playback: { playing: false, startedAt: null, position: 0 },
    chat: []
  };
  rooms.set(id, room);
  return room;
}

function roomSummary(room) {
  return {
    id: room.id, name: room.name, code: room.code,
    hostId: room.hostId, isPrivate: room.isPrivate,
    memberCount: room.members.size,
    currentTrack: room.currentTrack,
    playback: room.playback,
    queue: room.queue,
    chat: room.chat.slice(-50)
  };
}

function membersArray(room) {
  return Array.from(room.members.values());
}

// ─── REST endpoints ────────────────────────────────────────────────────────────
app.get('/api/rooms/public', (req, res) => {
  const list = [];
  for (const r of rooms.values()) {
    if (!r.isPrivate) list.push({
      id: r.id, name: r.name, memberCount: r.members.size,
      currentTrack: r.currentTrack, code: r.code
    });
  }
  res.json(list);
});

app.get('/api/rooms/find/:code', (req, res) => {
  for (const r of rooms.values()) {
    if (r.code === req.params.code.toUpperCase()) {
      return res.json({ id: r.id, name: r.name, code: r.code, isPrivate: r.isPrivate });
    }
  }
  res.status(404).json({ error: 'Room not found' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  let currentRoomId = null;
  let currentMember = null;

  // Create room
  socket.on('room:create', ({ roomName, isPrivate, userName, avatar }, cb) => {
    const room = createRoom({ name: roomName, isPrivate, hostName: userName, hostId: socket.id });
    currentRoomId = room.id;
    currentMember = { id: socket.id, name: userName, avatar: avatar || '🎵', isHost: true, listening: true, joinedAt: Date.now() };
    room.members.set(socket.id, currentMember);
    socket.join(room.id);
    cb({ success: true, room: roomSummary(room), member: currentMember });
    io.to(room.id).emit('members:update', membersArray(room));
  });

  // Join room
  socket.on('room:join', ({ code, roomId, userName, avatar }, cb) => {
    let room = null;
    if (roomId) room = rooms.get(roomId);
    if (!room && code) {
      for (const r of rooms.values()) {
        if (r.code === code.toUpperCase()) { room = r; break; }
      }
    }
    if (!room) return cb({ success: false, error: 'Room not found' });

    currentRoomId = room.id;
    const isHost = room.members.size === 0;
    if (isHost) room.hostId = socket.id;
    currentMember = { id: socket.id, name: userName, avatar: avatar || '🎵', isHost, listening: true, joinedAt: Date.now() };
    room.members.set(socket.id, currentMember);
    socket.join(room.id);
    cb({ success: true, room: roomSummary(room), member: currentMember });
    io.to(room.id).emit('members:update', membersArray(room));
    // Sync new member with playback state
    socket.emit('playback:sync', room.playback);
  });

  // Chat message
  socket.on('chat:message', ({ text, emoji }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const msg = {
      id: uuidv4(), senderId: socket.id, senderName: currentMember?.name,
      senderAvatar: currentMember?.avatar, text, emoji: emoji || null,
      timestamp: Date.now()
    };
    room.chat.push(msg);
    if (room.chat.length > 200) room.chat.shift();
    io.to(currentRoomId).emit('chat:message', msg);
  });

  // Typing indicator
  socket.on('chat:typing', (isTyping) => {
    if (!currentRoomId || !currentMember) return;
    socket.to(currentRoomId).emit('chat:typing', { userId: socket.id, name: currentMember.name, isTyping });
  });

  // Emoji reaction
  socket.on('chat:reaction', ({ messageId, emoji }) => {
    if (!currentRoomId) return;
    io.to(currentRoomId).emit('chat:reaction', { messageId, emoji, userId: socket.id });
  });

  // Queue: add track
  socket.on('queue:add', (track) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const t = { ...track, id: uuidv4(), addedBy: currentMember?.name, addedAt: Date.now() };
    room.queue.push(t);
    if (!room.currentTrack) {
      room.currentTrack = room.queue.shift();
      room.playback = { playing: false, startedAt: null, position: 0 };
      io.to(currentRoomId).emit('queue:trackChanged', { track: room.currentTrack, playback: room.playback });
    }
    io.to(currentRoomId).emit('queue:update', room.queue);
  });

  // Queue: remove
  socket.on('queue:remove', (trackId) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    room.queue = room.queue.filter(t => t.id !== trackId);
    io.to(currentRoomId).emit('queue:update', room.queue);
  });

  // Queue: reorder
  socket.on('queue:reorder', ({ fromIndex, toIndex }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const [item] = room.queue.splice(fromIndex, 1);
    room.queue.splice(toIndex, 0, item);
    io.to(currentRoomId).emit('queue:update', room.queue);
  });

  // Playback: play/pause
  socket.on('playback:toggle', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || socket.id !== room.hostId) return;
    const now = Date.now();
    if (room.playback.playing) {
      room.playback.position += (now - room.playback.startedAt) / 1000;
      room.playback.playing = false;
      room.playback.startedAt = null;
    } else {
      room.playback.playing = true;
      room.playback.startedAt = now;
    }
    io.to(currentRoomId).emit('playback:sync', room.playback);
  });

  // Playback: seek
  socket.on('playback:seek', (position) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || socket.id !== room.hostId) return;
    room.playback.position = position;
    room.playback.startedAt = room.playback.playing ? Date.now() : null;
    io.to(currentRoomId).emit('playback:sync', room.playback);
  });

  // Playback: skip
  socket.on('playback:skip', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || socket.id !== room.hostId) return;
    if (room.queue.length > 0) {
      room.currentTrack = room.queue.shift();
      room.playback = { playing: true, startedAt: Date.now(), position: 0 };
      io.to(currentRoomId).emit('queue:trackChanged', { track: room.currentTrack, playback: room.playback });
      io.to(currentRoomId).emit('queue:update', room.queue);
    } else {
      room.currentTrack = null;
      room.playback = { playing: false, startedAt: null, position: 0 };
      io.to(currentRoomId).emit('queue:trackChanged', { track: null, playback: room.playback });
    }
  });

  // Track ended (from YouTube player)
  socket.on('playback:ended', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || socket.id !== room.hostId) return;
    if (room.queue.length > 0) {
      room.currentTrack = room.queue.shift();
      room.playback = { playing: true, startedAt: Date.now(), position: 0 };
      io.to(currentRoomId).emit('queue:trackChanged', { track: room.currentTrack, playback: room.playback });
      io.to(currentRoomId).emit('queue:update', room.queue);
    } else {
      room.currentTrack = null;
      room.playback = { playing: false, startedAt: null, position: 0 };
      io.to(currentRoomId).emit('queue:trackChanged', { track: null, playback: room.playback });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    room.members.delete(socket.id);
    if (room.members.size === 0) {
      setTimeout(() => {
        const r = rooms.get(currentRoomId);
        if (r && r.members.size === 0) rooms.delete(currentRoomId);
      }, 30000);
    } else if (room.hostId === socket.id) {
      const newHost = room.members.values().next().value;
      if (newHost) {
        newHost.isHost = true;
        room.hostId = newHost.id;
        io.to(currentRoomId).emit('host:changed', newHost.id);
      }
    }
    io.to(currentRoomId).emit('members:update', membersArray(room));
    socket.to(currentRoomId).emit('chat:system', `${currentMember?.name || 'Someone'} left the room`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🌸 SynGly running on http://localhost:${PORT}`));

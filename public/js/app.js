/* ═══════════════════════════════════════════════════
   SynGly — Main Application
═══════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────────────────────────────
const state = {
  room: null,
  member: null,
  isHost: false,
  queue: [],
  currentTrack: null,
  playback: { playing: false, startedAt: null, position: 0 },
  members: [],
  typingTimeout: null,
  progressInterval: null,
  ytPlayer: null,
  searchResults: [],
  selectedAvatar: { create: '🎵', join: '🎵' }
};

// ── Socket ─────────────────────────────────────────────────────────────────────
const socket = io();

// ── DOM helpers ────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const showPage = (id) => {
  document.querySelectorAll('.page').forEach(p => { p.classList.remove('active'); p.classList.add('hidden'); });
  const page = $(id);
  page.classList.remove('hidden');
  setTimeout(() => page.classList.add('active'), 10);
};
const showModal = (id) => $(id).classList.remove('hidden');
const hideModal = (id) => $(id).classList.add('hidden');

let toastTimeout;
function showToast(msg, duration = 2800) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => t.classList.add('hidden'), duration);
}

function formatTime(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Landing page ───────────────────────────────────────────────────────────────
$('btn-create-room').addEventListener('click', () => showModal('modal-create'));
$('btn-join-room').addEventListener('click', () => showModal('modal-join'));
$('btn-browse').addEventListener('click', () => {
  showModal('modal-browse');
  loadPublicRooms();
});

// Modal close buttons
document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => hideModal(btn.dataset.close));
});
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hideModal(overlay.id);
  });
});

// Avatar pickers
function setupAvatarPicker(pickerId, stateKey) {
  const picker = $(pickerId);
  if (!picker) return;
  picker.querySelectorAll('.avatar-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      picker.querySelectorAll('.avatar-opt').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      state.selectedAvatar[stateKey] = opt.dataset.emoji;
    });
  });
}
setupAvatarPicker('create-avatar-picker', 'create');
setupAvatarPicker('join-avatar-picker', 'join');

// Create room
$('btn-do-create').addEventListener('click', () => {
  const userName = $('create-username').value.trim();
  const roomName = $('create-roomname').value.trim();
  if (!userName) { showToast('Please enter your name!'); return; }
  if (!roomName) { showToast('Please enter a room name!'); return; }
  const isPrivate = $('create-private').checked;
  socket.emit('room:create', {
    roomName, isPrivate, userName, avatar: state.selectedAvatar.create
  }, (res) => {
    if (res.success) {
      hideModal('modal-create');
      enterRoom(res.room, res.member);
    } else {
      showToast('Failed to create room 😢');
    }
  });
});

// Join room
$('btn-do-join').addEventListener('click', () => {
  const userName = $('join-username').value.trim();
  const code = $('join-code').value.trim().toUpperCase();
  if (!userName) { showToast('Please enter your name!'); return; }
  if (!code) { showToast('Please enter a room code!'); return; }
  $('join-error').classList.add('hidden');
  socket.emit('room:join', { code, userName, avatar: state.selectedAvatar.join }, (res) => {
    if (res.success) {
      hideModal('modal-join');
      enterRoom(res.room, res.member);
    } else {
      $('join-error').classList.remove('hidden');
    }
  });
});

// Load public rooms
async function loadPublicRooms() {
  try {
    const resp = await fetch('/api/rooms/public');
    const rooms = await resp.json();
    const list = $('browse-list');
    if (rooms.length === 0) {
      list.innerHTML = '<div class="empty-state">No public rooms right now — create one!</div>';
      return;
    }
    list.innerHTML = rooms.map(r => `
      <div class="browse-room-item" data-id="${r.id}" data-code="${r.code}">
        <div>
          <div class="browse-room-name">${escapeHtml(r.name)}</div>
          <div class="browse-room-meta">👥 ${r.memberCount} listening ${r.currentTrack ? `· 🎵 ${escapeHtml(r.currentTrack.title || '')}` : ''}</div>
        </div>
        <button class="btn-primary small">Join</button>
      </div>`).join('');
    list.querySelectorAll('.browse-room-item').forEach(item => {
      item.querySelector('button').addEventListener('click', () => {
        const userName = $('browse-username').value.trim();
        if (!userName) { showToast('Enter your name first!'); return; }
        socket.emit('room:join', { roomId: item.dataset.id, userName, avatar: '🎵' }, (res) => {
          if (res.success) { hideModal('modal-browse'); enterRoom(res.room, res.member); }
          else showToast('Could not join that room 😢');
        });
      });
    });
  } catch (e) {
    $('browse-list').innerHTML = '<div class="empty-state">Could not load rooms</div>';
  }
}

// ── Enter room ─────────────────────────────────────────────────────────────────
function enterRoom(room, member) {
  state.room = room;
  state.member = member;
  state.isHost = member.isHost;
  state.queue = room.queue || [];
  state.currentTrack = room.currentTrack;
  state.playback = room.playback;

  $('room-name-display').textContent = room.name;
  $('room-code-display').textContent = room.code;
  updateHostUI();
  renderQueue();
  renderChat(room.chat || []);
  if (state.currentTrack) updateNowPlaying(state.currentTrack);

  showPage('page-room');

  // Init YouTube player
  state.ytPlayer = new YTPlayer('yt-player');
  state.ytPlayer.onEndedCallback = () => { if (state.isHost) socket.emit('playback:ended'); };
  state.ytPlayer.onReadyCallback = () => {
    if (state.currentTrack) {
      state.ytPlayer.loadVideo(state.currentTrack.videoId, state.playback.playing);
      if (state.playback.playing) {
        const elapsed = (Date.now() - state.playback.startedAt) / 1000 + state.playback.position;
        state.ytPlayer.seekTo(elapsed);
      } else {
        state.ytPlayer.seekTo(state.playback.position);
      }
    }
    state.ytPlayer.setVolume(80);
  };

  startProgressLoop();
}

// ── Host UI ────────────────────────────────────────────────────────────────────
function updateHostUI() {
  const hostNote = $('host-note');
  hostNote.textContent = state.isHost ? '👑 You are the host — you control playback' : '🎧 Host controls playback for everyone';
  ['btn-play', 'btn-skip', 'btn-prev'].forEach(id => {
    const btn = $(id);
    btn.disabled = !state.isHost;
  });
  // Progress bar seek — host only
  $('progress-bar-outer').style.cursor = state.isHost ? 'pointer' : 'default';
}

// ── Player controls ────────────────────────────────────────────────────────────
$('btn-play').addEventListener('click', () => {
  if (!state.isHost) return;
  socket.emit('playback:toggle');
});

$('btn-skip').addEventListener('click', () => {
  if (!state.isHost) return;
  socket.emit('playback:skip');
});

$('btn-prev').addEventListener('click', () => {
  if (!state.isHost || !state.ytPlayer) return;
  // Restart current track
  socket.emit('playback:seek', 0);
});

$('volume-slider').addEventListener('input', (e) => {
  state.ytPlayer?.setVolume(parseInt(e.target.value));
});

$('progress-bar-outer').addEventListener('click', (e) => {
  if (!state.isHost || !state.ytPlayer) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  const dur = state.ytPlayer.getDuration();
  if (dur > 0) socket.emit('playback:seek', pct * dur);
});

// ── Playback sync from server ──────────────────────────────────────────────────
socket.on('playback:sync', (pb) => {
  state.playback = pb;
  if (!state.ytPlayer?.ready) return;
  const expectedPos = pb.playing
    ? (Date.now() - pb.startedAt) / 1000 + pb.position
    : pb.position;
  const currentPos = state.ytPlayer.getCurrentTime();
  if (Math.abs(currentPos - expectedPos) > 1.5) {
    state.ytPlayer.seekTo(expectedPos);
  }
  if (pb.playing && !state.ytPlayer.isPlaying()) state.ytPlayer.play();
  if (!pb.playing && state.ytPlayer.isPlaying()) state.ytPlayer.pause();
  $('btn-play').textContent = pb.playing ? '⏸' : '▶';
});

socket.on('queue:trackChanged', ({ track, playback }) => {
  state.currentTrack = track;
  state.playback = playback;
  updateNowPlaying(track);
  $('btn-play').textContent = playback.playing ? '⏸' : '▶';
  if (state.ytPlayer?.ready && track) {
    state.ytPlayer.loadVideo(track.videoId, playback.playing);
    if (playback.playing) setTimeout(() => state.ytPlayer.seekTo(playback.position), 500);
  }
});

socket.on('queue:update', (queue) => {
  state.queue = queue;
  renderQueue();
});

// ── Now Playing ────────────────────────────────────────────────────────────────
function updateNowPlaying(track) {
  if (!track) {
    $('track-title').textContent = 'Nothing playing yet';
    $('track-channel').textContent = 'Add a song to get started';
    const art = $('album-art');
    art.innerHTML = '<div class="album-placeholder">🎵</div>';
    $('progress-bar-inner').style.width = '0%';
    $('time-current').textContent = '0:00';
    $('time-total').textContent = '0:00';
    return;
  }
  $('track-title').textContent = track.title || 'Unknown Track';
  $('track-channel').textContent = track.channelTitle || '';
  const art = $('album-art');
  if (track.thumbnail) {
    art.innerHTML = `<img src="${escapeHtml(track.thumbnail)}" alt="album art" />`;
  } else {
    art.innerHTML = '<div class="album-placeholder">🎵</div>';
  }
}

// ── Progress loop ──────────────────────────────────────────────────────────────
function startProgressLoop() {
  clearInterval(state.progressInterval);
  state.progressInterval = setInterval(() => {
    if (!state.ytPlayer?.ready || !state.currentTrack) return;
    const dur = state.ytPlayer.getDuration();
    const cur = state.ytPlayer.getCurrentTime();
    if (dur > 0) {
      $('progress-bar-inner').style.width = (cur / dur * 100).toFixed(1) + '%';
      $('time-current').textContent = formatTime(cur);
      $('time-total').textContent = formatTime(dur);
    }
  }, 500);
}

// ── Queue ──────────────────────────────────────────────────────────────────────
function renderQueue() {
  const list = $('queue-list');
  $('queue-count').textContent = state.queue.length;
  if (state.queue.length === 0) {
    list.innerHTML = '<div class="empty-state small">Queue is empty — search for songs above!</div>';
    return;
  }
  list.innerHTML = state.queue.map((t, i) => `
    <div class="queue-item" data-id="${t.id}">
      <span class="queue-num">${i + 1}</span>
      <img class="queue-thumb" src="${escapeHtml(t.thumbnail || '')}" onerror="this.style.display='none'" alt="" />
      <div class="queue-info">
        <div class="queue-title">${escapeHtml(t.title || '')}</div>
        <div class="queue-by">Added by ${escapeHtml(t.addedBy || 'someone')}</div>
      </div>
      <button class="queue-remove" data-id="${t.id}" title="Remove">✕</button>
    </div>`).join('');
  list.querySelectorAll('.queue-remove').forEach(btn => {
    btn.addEventListener('click', () => socket.emit('queue:remove', btn.dataset.id));
  });
}

// ── YouTube Search ─────────────────────────────────────────────────────────────
$('btn-search').addEventListener('click', doSearch);
$('search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

async function doSearch() {
  const query = $('search-input').value.trim();
  if (!query) return;
  const results = $('search-results');
  results.innerHTML = '<div class="empty-state small">Searching…</div>';
  try {
    // Use YouTube's oEmbed / no-auth endpoint via invidious or ytsr-style
    // For demo, we use YouTube Data API via a proxy or use a CORS-friendly approach
    // We'll build a simple search using the YouTube search page via oEmbed trick
    // In production, set YOUTUBE_API_KEY in .env
    const apiKey = window.__YT_API_KEY__ || '';
    if (apiKey) {
      const resp = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=6&q=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}`);
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);
      state.searchResults = (data.items || []).map(item => ({
        videoId: item.id.videoId,
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails?.default?.url || ''
      }));
    } else {
      // Fallback: scrape YouTube search via InvidiousPublic API (no key needed)
      const invResp = await fetch(`https://inv.tux.pizza/api/v1/search?q=${encodeURIComponent(query)}&type=video`);
      if (!invResp.ok) throw new Error('Search unavailable');
      const invData = await invResp.json();
      state.searchResults = (invData || []).slice(0, 6).map(v => ({
        videoId: v.videoId,
        title: v.title,
        channelTitle: v.author,
        thumbnail: `https://img.youtube.com/vi/${v.videoId}/default.jpg`
      }));
    }
    renderSearchResults();
  } catch (err) {
    results.innerHTML = `<div class="empty-state small">Search failed. ${err.message || 'Try again or add a YouTube URL directly.'}</div>`;
    // Offer manual URL add
    results.innerHTML += `<div style="padding:0.5rem 0;font-size:0.8rem;color:var(--text-sub)">Tip: Paste a YouTube URL in the search box and hit Search to add it directly.</div>`;
    tryUrlFallback(query, results);
  }
}

function tryUrlFallback(query, container) {
  const ytMatch = query.match(/(?:youtu\.be\/|youtube\.com\/watch\?v=)([A-Za-z0-9_-]{11})/);
  if (ytMatch) {
    const videoId = ytMatch[1];
    state.searchResults = [{ videoId, title: `YouTube video (${videoId})`, channelTitle: 'YouTube', thumbnail: `https://img.youtube.com/vi/${videoId}/default.jpg` }];
    renderSearchResults(container);
  }
}

function renderSearchResults(container) {
  const results = container || $('search-results');
  if (state.searchResults.length === 0) {
    results.innerHTML = '<div class="empty-state small">No results found</div>';
    return;
  }
  results.innerHTML = state.searchResults.map((r, i) => `
    <div class="search-item" data-index="${i}">
      <img class="search-thumb" src="${escapeHtml(r.thumbnail)}" onerror="this.style.background='var(--lavender)'" alt="" />
      <div class="search-info">
        <div class="search-title">${escapeHtml(r.title)}</div>
        <div class="search-channel">${escapeHtml(r.channelTitle)}</div>
      </div>
      <button class="search-add" data-index="${i}">+ Add</button>
    </div>`).join('');
  results.querySelectorAll('.search-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const track = state.searchResults[parseInt(btn.dataset.index)];
      socket.emit('queue:add', track);
      btn.textContent = '✓ Added';
      btn.style.background = 'var(--sage2)';
      showToast(`🎵 Added "${track.title.substring(0, 30)}…" to queue`);
    });
  });
}

// ── Chat ───────────────────────────────────────────────────────────────────────
$('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
  // Typing indicator
  socket.emit('chat:typing', true);
  clearTimeout(state.typingTimeout);
  state.typingTimeout = setTimeout(() => socket.emit('chat:typing', false), 1500);
});

$('btn-send').addEventListener('click', sendMessage);

$('emoji-bar').querySelectorAll('.emoji-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $('chat-input').value += btn.dataset.emoji;
    $('chat-input').focus();
  });
});

function sendMessage() {
  const text = $('chat-input').value.trim();
  if (!text) return;
  socket.emit('chat:message', { text });
  $('chat-input').value = '';
  socket.emit('chat:typing', false);
  clearTimeout(state.typingTimeout);
}

socket.on('chat:message', (msg) => appendChatMessage(msg));
socket.on('chat:system', (text) => appendSystemMessage(text));
socket.on('chat:typing', ({ userId, name, isTyping }) => {
  if (userId === socket.id) return;
  const ind = $('typing-indicator');
  if (isTyping) {
    ind.textContent = `${name} is typing…`;
  } else {
    ind.textContent = '';
  }
});

function renderChat(messages) {
  const container = $('chat-messages');
  container.innerHTML = '';
  messages.forEach(msg => appendChatMessage(msg, false));
  container.scrollTop = container.scrollHeight;
}

function appendChatMessage(msg, scroll = true) {
  const container = $('chat-messages');
  const isMe = msg.senderId === socket.id;
  const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const el = document.createElement('div');
  el.className = `chat-msg ${isMe ? 'me' : ''}`;
  el.dataset.msgId = msg.id;
  el.innerHTML = `
    <span class="chat-avatar">${escapeHtml(msg.senderAvatar || '🎵')}</span>
    <div class="chat-bubble-wrap">
      ${!isMe ? `<span class="chat-sender">${escapeHtml(msg.senderName)}</span>` : ''}
      <div class="chat-bubble">${escapeHtml(msg.text)}</div>
      <span class="chat-time">${time}</span>
    </div>`;
  container.appendChild(el);
  if (scroll) container.scrollTop = container.scrollHeight;
}

function appendSystemMessage(text) {
  const container = $('chat-messages');
  const el = document.createElement('div');
  el.className = 'chat-system';
  el.textContent = text;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

// ── Members ────────────────────────────────────────────────────────────────────
socket.on('members:update', (members) => {
  state.members = members;
  renderMembers();
  $('member-count').textContent = `👥 ${members.length}`;
});

socket.on('host:changed', (hostId) => {
  state.isHost = hostId === socket.id;
  state.room.hostId = hostId;
  updateHostUI();
  if (state.isHost) showToast('👑 You are now the host!');
});

function renderMembers() {
  const list = $('members-list');
  if (state.members.length === 0) { list.innerHTML = ''; return; }
  list.innerHTML = state.members.map(m => `
    <div class="member-item">
      <span class="member-avatar">${escapeHtml(m.avatar || '🎵')}</span>
      <div class="member-info">
        <div class="member-name">${escapeHtml(m.name)}</div>
        <div class="member-status">${m.listening ? '🎵 Listening' : '💤 Away'}</div>
      </div>
      ${m.isHost ? '<span class="host-badge">HOST</span>' : ''}
      <span class="member-online-dot"></span>
    </div>`).join('');
}

// ── Room header ────────────────────────────────────────────────────────────────
$('btn-copy-code').addEventListener('click', () => {
  if (!state.room) return;
  navigator.clipboard.writeText(state.room.code).then(() => showToast('📋 Room code copied!'));
});

$('btn-leave').addEventListener('click', () => {
  clearInterval(state.progressInterval);
  state.ytPlayer?.pause();
  socket.disconnect();
  socket.connect();
  showPage('page-landing');
  state.room = null; state.member = null; state.isHost = false;
  state.queue = []; state.currentTrack = null; state.members = [];
});

// ── Utils ──────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Check URL params for room join on load
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (code) {
    $('join-code').value = code;
    showModal('modal-join');
  }
});

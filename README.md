# 🎵 SynGly — Listen Together

A cozy, pastel real-time music listening app. Create rooms, sync YouTube playback, chat with friends.

---

## ✨ Features

- 🏡 Create public or private listening rooms
- 🎵 Sync YouTube music playback across all listeners in real-time
- 🔍 YouTube song search (via API or public Invidious fallback)
- 💬 Live chat with emoji reactions and typing indicators
- 👥 Member list with host badge and online status
- 🎶 Shared queue management — anyone can add songs
- 👑 Host transfers automatically if the host leaves
- 📋 Invite via shareable room code
- 📱 Responsive for desktop and mobile

---

## 🚀 Local Setup

### Prerequisites
- Node.js 18+ (https://nodejs.org)
- npm

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables
cp .env.example .env
# Edit .env if you have a YouTube API key (optional but recommended)

# 3. Start the server
npm start
# or for development with auto-reload:
npm run dev

# 4. Open in browser
# http://localhost:3000
```

---

## 🔑 YouTube API Key (Optional)

SynGly works **without** a YouTube API key using a public Invidious instance as fallback.  
For better reliability in production, get a free YouTube Data API v3 key:

1. Go to https://console.cloud.google.com
2. Create a project → Enable "YouTube Data API v3"
3. Create an API Key credential
4. Add it to `.env`: `YOUTUBE_API_KEY=your_key_here`
5. The key is injected into the frontend via the `/api/config` endpoint (add it to `server.js` if needed)

To pass the key to the frontend, add this to `server.js`:
```js
app.get('/api/config', (req, res) => {
  res.json({ ytApiKey: process.env.YOUTUBE_API_KEY || '' });
});
```
And fetch it in `app.js` on startup:
```js
fetch('/api/config').then(r => r.json()).then(c => { window.__YT_API_KEY__ = c.ytApiKey; });
```

---

## ☁️ Cloud Deployment

### Render (recommended, free tier)
1. Push to GitHub
2. New Web Service → connect repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Add env var: `PORT=10000`
6. Add `YOUTUBE_API_KEY` if you have one

### Railway
1. `railway init && railway up`
2. Set env vars in Railway dashboard

### Heroku
```bash
heroku create syngly
heroku config:set YOUTUBE_API_KEY=your_key
git push heroku main
```

### Vercel
Note: Vercel does **not** support WebSockets. Use Render or Railway instead.

---

## 🏗️ Architecture

```
syngly/
├── server.js          # Express + Socket.IO backend
├── public/
│   ├── index.html     # Single-page app shell
│   ├── css/style.css  # Pastel cozy stylesheet
│   └── js/
│       ├── app.js     # Frontend logic + Socket.IO client
│       └── youtube.js # YouTube IFrame API wrapper
├── .env.example       # Environment variable template
└── package.json
```

### Real-time events (Socket.IO)

| Event | Direction | Description |
|-------|-----------|-------------|
| `room:create` | client→server | Create a new room |
| `room:join` | client→server | Join existing room |
| `chat:message` | both | Send/receive chat messages |
| `chat:typing` | both | Typing indicators |
| `queue:add` | client→server | Add track to queue |
| `queue:remove` | client→server | Remove track from queue |
| `queue:update` | server→client | Queue state sync |
| `queue:trackChanged` | server→client | New track playing |
| `playback:toggle` | client→server | Play/pause (host only) |
| `playback:seek` | client→server | Seek to position (host only) |
| `playback:sync` | server→client | Sync playback state |
| `playback:ended` | client→server | Track ended, advance queue |
| `members:update` | server→client | Member list changed |
| `host:changed` | server→client | New host assigned |

---

## 🎨 Design

Pastel palette: lavender · peach · sage · rose · cream  
Typography: Nunito (body/UI) + DM Serif Display (hero headings)  
Cozy, rounded, soft shadows — no dark themes, no neon, no sharp edges.

---

Made with 💜 and lots of lo-fi beats.

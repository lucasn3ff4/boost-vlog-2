# Boost Vlog

- Record your day
- Put videos in a folder
- Get a vlog, upload to YouTube in the app

Auto-generates YouTube video title, thumbnails, and description.

**TIPS:**
- Record either: "talking clips" (silences will be removed) or "b-roll clips" (these will be used for breaks between talking)
- Upload music on the home page to auto-add music (randomly selects songs and adjusts volume)

--

AI-assisted vlog editing pipeline. Point it at a folder of raw footage and it transcribes speech, detects scenes, classifies talking-head vs. B-roll, generates titles/thumbnails/remixes with LLMs, lays everything out on a Remotion timeline, renders the final video, and uploads to YouTube.

## Stack

**Backend** — FastAPI, SQLAlchemy, SQLite, async worker queue. faster-whisper for transcription, PySceneDetect + OpenCV for scene boundaries, ffmpeg/ffprobe for audio/video processing, watchdog for folder watching.

**AI** — Anthropic Claude (titles/descriptions), Google Gemini (remix generation, thumbnails).

**Frontend** — React 19 + TypeScript, Vite, Remotion (video composition and server-side rendering), react-timeline-editor, Zustand for state.

## Prerequisites

- Python 3.9+
- Node.js 18+
- `ffmpeg` and `ffprobe` on your `PATH`
- A `.env` file at the repo root. Variables (see [backend/config.py](backend/config.py)):
  - `GEMINI_API_KEY` — required for remixes (AI generated scene transitions)
  - `ANTHROPIC_API_KEY` — required for titles/descriptions
  - `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` — required for upload
  - `DEEPGRAM_API_KEY` — optional

## Quick start

Backend (http://localhost:8000):

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

Frontend (http://localhost:5173):

```bash
cd frontend
npm install
npm run dev
```

The SQLite database is created automatically at `data/boost_vlog.db` on first run. The backend `lifespan` hook in [backend/main.py](backend/main.py) also runs lightweight column migrations on startup.

## Layout

```
backend/       FastAPI app, routes, services, workers
  main.py      App entry + router wiring + startup migrations
  config.py    Env vars, paths, thresholds
  routes/      HTTP + WebSocket endpoints
  services/    Pipeline stages (transcribe, scene-detect, remix, render, etc.)
  workers/     Background processing queue
  static/      Processed media served under /static
frontend/      React + Vite + Remotion UI
  src/remotion/      Remotion composition
  src/components/    Timeline, player, upload, asset library, settings
  src/stores/        Zustand stores
data/          Runtime: SQLite DB, uploaded assets (git-ignored)
```

## API surface

Wired in [backend/main.py](backend/main.py):

- **Core** — `/api/projects`, `/api/clips`, `/api/timeline`, `/api/render`, `/api/fs`, `/ws`
- **AI generation** — `/api/titles`, `/api/captions`, `/api/timestamps`, `/api/remixes`, `/api/analyzes`
- **Effects & overlays** — `/api/zooms`, `/api/enlarges`, `/api/trackers`, `/api/subscribes`, `/api/hooks`, `/api/sfx`
- **Assets & audio** — `/api/assets`, `/api/music`
- **Publishing** — `/api/youtube` (OAuth callback at `/api/youtube/callback`)
- **Settings** — `/api/settings`

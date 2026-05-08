from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")
DATA_DIR = BASE_DIR / "data"
PROCESSED_DIR = BASE_DIR / "backend" / "static" / "processed"

DATABASE_URL = f"sqlite:///{DATA_DIR / 'boost_vlog.db'}"

import os
DEEPGRAM_API_KEY = os.environ.get("DEEPGRAM_API_KEY", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

YOUTUBE_CLIENT_ID = os.environ.get("YOUTUBE_CLIENT_ID", "")
YOUTUBE_CLIENT_SECRET = os.environ.get("YOUTUBE_CLIENT_SECRET", "")
YOUTUBE_REDIRECT_URI = "http://localhost:8000/api/youtube/callback"

SILENCE_THRESH_DB = -30
MIN_SILENCE_DURATION = 0.5

TAKE_SIMILARITY_THRESHOLD = 0.75  # 0.0-1.0: how similar two segments must be to count as repeated takes
TAKE_WINDOW_SECONDS = 120.0       # only compare segments within this time window
TAKE_MIN_WORDS = 4                # ignore very short segments (filler words) for take detection

GAZE_FILTER_ENABLED = True
GAZE_SAMPLE_INTERVAL = 1.0        # sample one frame per second of each segment
GAZE_MIN_FACE_RATIO = 0.3         # drop segment if face appears in <30% of frames
GAZE_MIN_EYE_RATIO = 0.4          # drop segment if eyes visible in <40% of face frames

SEGMENT_MERGE_GAP = 8.0           # merge speech segments with gaps smaller than this (seconds)

TALKING_WORD_THRESHOLD = 5

BROLL_NUM_CLIPS = 3
BROLL_CLIP_DURATION = 2.0

SCENE_DETECT_THRESHOLD = 27.0

VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
BROWSER_COMPATIBLE_CODECS = {"h264", "vp8", "vp9", "av1"}
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".ogg"}

ASSETS_DIR = DATA_DIR / "assets"

MUSIC_BASE_VOLUME = 0.25
MUSIC_DUCK_VOLUME = 0.08
MUSIC_FADE_DURATION = 0.5

BROLL_AUDIO_VOLUME = 0.15

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
REMIX_DIR = PROCESSED_DIR.parent / "remixes"
REMIX_DURATION = 4.0

TITLE_SFX_VOLUME = 0.5

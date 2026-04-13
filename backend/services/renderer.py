import asyncio
import json
import logging
import tempfile
from pathlib import Path
from urllib.parse import quote

logger = logging.getLogger(__name__)
from sqlalchemy.orm import Session
from database import SessionLocal
from models import TimelineItem, MusicItem, Asset, TitleItem, CaptionItem, TimestampItem, TrackerItem, SubscribeItem, ZoomItem, EnlargeItem
from routes.ws import broadcast
from services.ducker import compute_volume_envelope
from services.sfx_generator import TITLE_IN_PATH, TITLE_OUT_PATH, ensure_title_sfx
from routes.music import _build_timeline_segments

BASE_URL = "http://127.0.0.1:8000"
FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"
FPS = 30


def _resolve_source_and_range(item: TimelineItem) -> tuple[str, float, float, str | None] | None:
    """Returns (source_path, start_time, end_time, clip_type) for a timeline item."""
    if item.sub_clip_id and item.sub_clip:
        sub = item.sub_clip
        parent = sub.parent_clip
        if parent:
            ct = parent.clip_type.value if parent.clip_type else None
            return (parent.source_path, sub.start_time, sub.end_time, ct)
    if item.clip_id and item.clip:
        clip = item.clip
        ct = clip.clip_type.value if clip.clip_type else None
        return (clip.source_path, 0, clip.duration or 0, ct)
    return None


def _build_input_props(
    items: list[TimelineItem],
    music_items: list[MusicItem],
    title_items: list[TitleItem],
    caption_items: list[CaptionItem],
    timestamp_items: list[TimestampItem],
    tracker_items: list[TrackerItem],
    subscribe_items: list[SubscribeItem],
    zoom_items: list[ZoomItem],
    enlarge_items: list[EnlargeItem],
    volume_envelope: list[dict],
) -> dict:
    """Serialize all data into Remotion inputProps with absolute URLs."""
    timeline_data = []
    for item in items:
        if item.sub_clip_id and item.sub_clip:
            sub = item.sub_clip
            parent = sub.parent_clip
            if not parent:
                continue
            playback_path = parent.processed_path or parent.source_path
            video_url = f"/api/fs/serve-video?path={quote(playback_path, safe='')}"
            start_time = sub.start_time
            end_time = sub.end_time
            duration = end_time - start_time
            clip_type = parent.clip_type.value if parent.clip_type else None
            label = parent.source_path.split("/")[-1]
        elif item.clip_id and item.clip:
            clip = item.clip
            playback_path = clip.processed_path or clip.source_path
            video_url = f"/api/fs/serve-video?path={quote(playback_path, safe='')}"
            start_time = 0
            end_time = clip.duration or 0
            duration = end_time
            clip_type = clip.clip_type.value if clip.clip_type else None
            label = clip.source_path.split("/")[-1]
        else:
            continue

        if duration < 0.034:
            continue

        timeline_data.append({
            "id": item.id,
            "clip_id": item.clip_id,
            "sub_clip_id": item.sub_clip_id,
            "position": item.position,
            "video_url": video_url,
            "duration": duration,
            "start_time": start_time,
            "end_time": end_time,
            "label": label,
            "clip_type": clip_type,
        })

    music_data = [
        {
            "id": mi.id,
            "asset_id": mi.asset_id,
            "asset_name": mi.asset.name if mi.asset else "Unknown",
            "file_path": None,
            "start_time": mi.start_time,
            "end_time": mi.end_time,
            "volume": mi.volume,
        }
        for mi in music_items
    ]

    title_data = [
        {"id": ti.id, "text": ti.text, "start_time": ti.start_time, "end_time": ti.end_time}
        for ti in title_items
    ]

    caption_data = [
        {"id": ci.id, "text": ci.text, "start_time": ci.start_time, "end_time": ci.end_time}
        for ci in caption_items
    ]

    timestamp_data = [
        {"id": ts.id, "text": ts.text, "start_time": ts.start_time, "end_time": ts.end_time}
        for ts in timestamp_items
    ]

    from routes.trackers import _overlay_url
    tracker_data = [
        {
            "id": ti.id,
            "start_time": ti.start_time,
            "end_time": ti.end_time,
            "overlay_url": _overlay_url(ti.overlay_path),
        }
        for ti in tracker_items
    ]

    subscribe_data = [
        {"id": si.id, "text": si.text, "start_time": si.start_time, "end_time": si.end_time}
        for si in subscribe_items
    ]

    zoom_data = [
        {"id": zi.id, "start_time": zi.start_time, "end_time": zi.end_time}
        for zi in zoom_items
    ]

    enlarge_data = [
        {"id": ei.id, "start_time": ei.start_time, "end_time": ei.end_time}
        for ei in enlarge_items
    ]

    # Compute total duration in frames
    total_frames = 0
    for t in timeline_data:
        total_frames += max(round(t["duration"] * FPS), 1)

    return {
        "items": timeline_data,
        "musicItems": music_data,
        "volumeEnvelope": volume_envelope,
        "titleItems": title_data,
        "captionItems": caption_data,
        "timestampItems": timestamp_data,
        "trackerItems": tracker_data,
        "subscribeItems": subscribe_data,
        "zoomItems": zoom_data,
        "enlargeItems": enlarge_data,
        "baseUrl": BASE_URL,
        "sfxTitleInPath": f"{BASE_URL}/api/sfx/title-in",
        "sfxTitleOutPath": f"{BASE_URL}/api/sfx/title-out",
        "durationInFrames": total_frames,
    }


async def render_timeline(project_id: int, output_path: str) -> str:
    db: Session = SessionLocal()
    try:
        items = (
            db.query(TimelineItem)
            .filter(TimelineItem.project_id == project_id)
            .order_by(TimelineItem.position)
            .all()
        )

        if not items:
            raise ValueError("Timeline is empty")

        await broadcast(project_id, "render_progress", {"percent": 0, "stage": "initializing"})

        # Ensure SFX files exist on disk
        await ensure_title_sfx()

        music_items = (
            db.query(MusicItem)
            .filter(MusicItem.project_id == project_id)
            .order_by(MusicItem.start_time)
            .all()
        )
        title_items = (
            db.query(TitleItem)
            .filter(TitleItem.project_id == project_id)
            .order_by(TitleItem.start_time)
            .all()
        )
        caption_items = (
            db.query(CaptionItem)
            .filter(CaptionItem.project_id == project_id)
            .order_by(CaptionItem.start_time)
            .all()
        )
        timestamp_items = (
            db.query(TimestampItem)
            .filter(TimestampItem.project_id == project_id)
            .order_by(TimestampItem.start_time)
            .all()
        )
        tracker_items = (
            db.query(TrackerItem)
            .filter(TrackerItem.project_id == project_id)
            .order_by(TrackerItem.start_time)
            .all()
        )
        subscribe_items = (
            db.query(SubscribeItem)
            .filter(SubscribeItem.project_id == project_id)
            .order_by(SubscribeItem.start_time)
            .all()
        )
        zoom_items = (
            db.query(ZoomItem)
            .filter(ZoomItem.project_id == project_id)
            .order_by(ZoomItem.start_time)
            .all()
        )
        enlarge_items = (
            db.query(EnlargeItem)
            .filter(EnlargeItem.project_id == project_id)
            .order_by(EnlargeItem.start_time)
            .all()
        )

        # Compute volume envelope for music ducking
        segments, total_duration = _build_timeline_segments(items)
        envelope = compute_volume_envelope(segments, total_duration) if music_items else []

        input_props = _build_input_props(
            items, music_items, title_items, caption_items, timestamp_items, tracker_items, subscribe_items,
            zoom_items, enlarge_items, envelope,
        )

        if not input_props["items"]:
            raise ValueError("No valid clips in timeline")

        logger.info(
            "Rendering %d clips, %d music, %d titles, %d captions, %d timestamps, %d subscribes (%d frames) for project %d",
            len(input_props["items"]), len(music_items), len(title_items),
            len(caption_items), len(timestamp_items), len(subscribe_items), input_props["durationInFrames"], project_id,
        )

        await broadcast(project_id, "render_progress", {"percent": 2, "stage": "bundling"})

        with tempfile.TemporaryDirectory() as tmpdir:
            props_path = str(Path(tmpdir) / "props.json")
            with open(props_path, "w") as f:
                json.dump(input_props, f)

            cmd = ["node", str(FRONTEND_DIR / "render.mjs"), props_path, output_path]

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(FRONTEND_DIR),
            )

            last_pct = -1

            async def _read_progress():
                nonlocal last_pct
                async for raw_line in proc.stdout:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        pct = data.get("percent", 0)
                        if pct != last_pct:
                            await broadcast(project_id, "render_progress", {
                                "percent": min(pct, 99), "stage": "rendering",
                            })
                            last_pct = pct
                    except json.JSONDecodeError:
                        pass

            async def _read_stderr():
                output = []
                async for raw_line in proc.stderr:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if line:
                        logger.info("[remotion] %s", line)
                        output.append(line)
                return "\n".join(output)

            stderr_text, _ = await asyncio.gather(_read_stderr(), _read_progress())
            await proc.wait()

            if proc.returncode != 0:
                logger.error("Remotion render failed (rc=%d): %s", proc.returncode, stderr_text[-1000:])
                raise RuntimeError(f"Render failed: {stderr_text[-500:]}")

        await broadcast(project_id, "render_progress", {"percent": 100, "stage": "done"})
        await broadcast(project_id, "render_done", {"output_path": output_path})

        return output_path
    except Exception as e:
        logger.exception("Render failed for project %d", project_id)
        await broadcast(project_id, "render_error", {"error": str(e)})
        raise
    finally:
        db.close()

import asyncio
import logging
import os
import time
from pathlib import Path
from sqlalchemy.orm import Session
from database import SessionLocal
from models import Clip, SubClip, TimelineItem, ProcessingStatus, ClipType, AppSettings
from services.transcriber import extract_audio, transcribe_file
from services.classifier import classify
from services.silence_remover import get_duration, get_creation_time
from services.take_selector import select_takes
from services.gaze_filter import filter_by_gaze
from config import GAZE_FILTER_ENABLED
from routes.ws import broadcast
from services.broll_analyzer import analyze_broll_frame
from config import BROLL_NUM_CLIPS, BROLL_CLIP_DURATION, PROCESSED_DIR, BROWSER_COMPATIBLE_CODECS

logger = logging.getLogger(__name__)


async def _get_video_codec(path: str) -> str:
    """Return the codec name of the first video stream."""
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=codec_name",
        "-of", "default=noprint_wrappers=1:nokey=1",
        path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await proc.communicate()
    return stdout.decode().strip().lower()


async def _generate_proxy(source_path: str, clip_id: int) -> str:
    """Transcode to an H.264 proxy for browser playback. Returns output path."""
    os.makedirs(PROCESSED_DIR, exist_ok=True)
    out_path = str(PROCESSED_DIR / f"proxy_{clip_id}.mp4")
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-i", source_path,
        "-c:v", "libx264", "-preset", "fast", "-crf", "28",
        "-vf", "scale=-2:1080",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        out_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"Proxy generation failed: {stderr.decode()[-500:]}")
    return out_path


async def process_clip(clip_id: int):
    db: Session = SessionLocal()
    try:
        clip = db.query(Clip).filter(Clip.id == clip_id).first()
        if not clip:
            return

        project_id = clip.project_id

        # Get duration
        try:
            clip.duration = await get_duration(clip.source_path)
        except Exception:
            clip.duration = 0

        # Ensure recorded_at is set (fallback if not set during discovery)
        if not clip.recorded_at:
            clip.recorded_at = get_creation_time(clip.source_path)

        total_duration = clip.duration or 0

        # --- Proxy generation for non-browser-compatible codecs ---
        try:
            codec = await _get_video_codec(clip.source_path)
            if codec not in BROWSER_COMPATIBLE_CODECS:
                logger.info(f"Clip {clip_id}: codec '{codec}' not browser-compatible, generating proxy")
                await broadcast(project_id, "clip_progress", {
                    "clip_id": clip_id, "status": "processing",
                    "progress": 5, "detail": f"generating preview proxy ({codec} \u2192 h264)",
                })
                proxy_path = await _generate_proxy(clip.source_path, clip_id)
                clip.processed_path = proxy_path
                db.commit()
                logger.info(f"Clip {clip_id}: proxy saved to {proxy_path}")
        except Exception as e:
            logger.warning(f"Clip {clip_id}: proxy generation failed, continuing: {e}")

        # --- Step 1: Transcribe (0-70% of overall) ---
        clip.status = ProcessingStatus.TRANSCRIBING
        db.commit()
        await broadcast(project_id, "clip_progress", {
            "clip_id": clip_id, "status": "transcribing",
            "progress": 0, "detail": "extracting audio",
        })

        audio_path = await extract_audio(clip.source_path)

        await broadcast(project_id, "clip_progress", {
            "clip_id": clip_id, "status": "transcribing",
            "progress": 20, "detail": "sending to Deepgram",
        })

        try:
            text, segments = await asyncio.to_thread(transcribe_file, audio_path)
        finally:
            import os
            os.unlink(audio_path)
        clip.transcript = text

        # Debug: print transcript with timestamps
        logger.info(f"=== TRANSCRIPT for clip {clip_id} ({len(segments)} segments) ===")
        for seg in segments:
            logger.info(f"  [{seg['start']:.2f}s -> {seg['end']:.2f}s] ({seg['end']-seg['start']:.2f}s) {seg['text']}")
        logger.info(f"=== END TRANSCRIPT ===")

        # --- Step 2: Classify (instant, 70-72%) ---
        clip.status = ProcessingStatus.CLASSIFYING
        db.commit()
        await broadcast(project_id, "clip_progress", {
            "clip_id": clip_id, "status": "classifying",
            "progress": 72, "detail": "classifying clip type",
        })

        clip_type = classify(text, segments)
        clip.clip_type = clip_type

        # --- Step 3: Analyze & store time ranges (72-100%) ---
        clip.status = ProcessingStatus.PROCESSING
        db.commit()

        if clip_type == ClipType.TALKING:
            await broadcast(project_id, "clip_progress", {
                "clip_id": clip_id, "status": "processing",
                "progress": 80, "detail": "building speech segments from transcript",
            })

            # Drop repeated takes, keeping only the last/best attempt at each phrase
            segments = select_takes(segments)

            # Use transcript segment timestamps directly as speech regions
            speech_segments = [
                (seg["start"], seg["end"])
                for seg in segments
                if (seg["end"] - seg["start"]) >= 0.1
            ]

            # Drop segments where person isn't looking at the camera (reading, rehearsing)
            if GAZE_FILTER_ENABLED:
                await broadcast(project_id, "clip_progress", {
                    "clip_id": clip_id, "status": "processing",
                    "progress": 85, "detail": "checking camera eye contact",
                })
                video_path = clip.processed_path or clip.source_path
                speech_segments = await asyncio.to_thread(
                    filter_by_gaze, video_path, speech_segments
                )

            # Store each speech segment as a SubClip
            for i, (start, end) in enumerate(speech_segments):
                sub = SubClip(
                    clip_id=clip_id,
                    start_time=start,
                    end_time=end,
                    label=f"speech {i + 1}",
                )
                db.add(sub)

            clip.status = ProcessingStatus.DONE
            db.commit()

            # Add all speech segments to timeline
            max_pos = db.query(TimelineItem.position).filter(
                TimelineItem.project_id == project_id
            ).order_by(TimelineItem.position.desc()).first()
            next_pos = (max_pos[0] + 1) if max_pos else 0

            for sub in clip.sub_clips:
                item = TimelineItem(
                    project_id=project_id,
                    sub_clip_id=sub.id,
                    position=next_pos,
                )
                db.add(item)
                next_pos += 1

            db.commit()

            await broadcast(project_id, "clip_done", {
                "clip_id": clip_id,
                "clip_type": "talking",
            })

        else:
            await broadcast(project_id, "clip_progress", {
                "clip_id": clip_id, "status": "processing",
                "progress": 80, "detail": "picking b-roll moments",
            })

            min_duration_for_moments = BROLL_NUM_CLIPS * BROLL_CLIP_DURATION
            # Evenly space clips, avoiding first/last 2 seconds
            margin = 2.0 if total_duration > (BROLL_CLIP_DURATION + 4) else 0
            usable_start = margin
            usable_end = total_duration - margin
            usable_duration = usable_end - usable_start

            if total_duration < min_duration_for_moments:
                # Under 6s: use the full clip as-is
                moments = [{"start": 0, "end": total_duration}]
            elif total_duration < 9:
                # 6-9s: trim to middle 6 seconds
                mid = total_duration / 2
                moments = [{"start": mid - 3, "end": mid + 3}]
            else:
                step = usable_duration / (BROLL_NUM_CLIPS + 1)
                moments = []
                for i in range(BROLL_NUM_CLIPS):
                    center = usable_start + step * (i + 1)
                    s = center - BROLL_CLIP_DURATION / 2
                    s = max(usable_start, s)
                    e = s + BROLL_CLIP_DURATION
                    if e > usable_end:
                        e = usable_end
                        s = max(usable_start, e - BROLL_CLIP_DURATION)
                    moments.append({"start": s, "end": e})

            for i, m in enumerate(moments):
                sub = SubClip(
                    clip_id=clip_id,
                    start_time=m["start"],
                    end_time=m["end"],
                    label=f"moment {i + 1}",
                )
                db.add(sub)

            clip.status = ProcessingStatus.DONE
            db.commit()

            # Add b-roll moments to timeline
            max_pos = db.query(TimelineItem.position).filter(
                TimelineItem.project_id == project_id
            ).order_by(TimelineItem.position.desc()).first()
            next_pos = (max_pos[0] + 1) if max_pos else 0

            for sub in clip.sub_clips:
                item = TimelineItem(
                    project_id=project_id,
                    sub_clip_id=sub.id,
                    position=next_pos,
                )
                db.add(item)
                next_pos += 1

            db.commit()

            await broadcast(project_id, "clip_done", {
                "clip_id": clip_id,
                "clip_type": "broll",
            })

            # Auto-analyze new b-roll sub-clips
            auto_setting = db.query(AppSettings).filter(
                AppSettings.key == "auto_analyze_broll"
            ).first()
            if not auto_setting or auto_setting.value != "false":
                from routes.analyzes import _run_analysis, _collect_broll_entries
                # Recompute timeline positions for all items to get accurate positions
                all_tl = (
                    db.query(TimelineItem)
                    .filter(TimelineItem.project_id == project_id)
                    .order_by(TimelineItem.position)
                    .all()
                )
                all_broll = _collect_broll_entries(all_tl)
                # Only analyze sub-clips belonging to this clip that don't already have analysis
                from models import AnalyzeItem
                new_sub_ids = {s.id for s in clip.sub_clips}
                existing_analyzed = {
                    (row.clip_id, row.sub_clip_id)
                    for row in db.query(AnalyzeItem).filter(
                        AnalyzeItem.project_id == project_id
                    ).all()
                }
                auto_entries = [
                    e for e in all_broll
                    if e["sub_clip_id"] in new_sub_ids
                    and (e["clip_id"], e["sub_clip_id"]) not in existing_analyzed
                ]
                if auto_entries:
                    asyncio.create_task(_run_analysis(project_id, auto_entries))

        await broadcast(project_id, "clip_progress", {
            "clip_id": clip_id, "status": "done",
            "progress": 100, "detail": "complete",
        })
        await broadcast(project_id, "timeline_updated", {})

    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"\n!!! CLIP {clip_id} FAILED: {e}\n", flush=True)
        clip = db.query(Clip).filter(Clip.id == clip_id).first()
        if clip:
            clip.status = ProcessingStatus.ERROR
            clip.error_message = str(e)[:500]
            db.commit()
        await broadcast(project_id, "clip_error", {"clip_id": clip_id, "error": str(e)[:500]})
        raise
    finally:
        db.close()

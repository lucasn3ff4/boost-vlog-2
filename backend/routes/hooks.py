import json
import logging

from pathlib import Path
import shutil

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import AnalyzeItem, Clip, ClipType, Project, SubClip, TimelineItem, TrackerItem
from schemas import HookAutoResponse, TimelineItemResponse
from routes.timeline import _resolve_item
from routes.remixes import _shift_overlay_times
from services.title_generator import get_client
from services.tracker_generator import generate_tracker_overlay
from config import PROCESSED_DIR

TRACKER_DIR = PROCESSED_DIR.parent / "trackers"

logger = logging.getLogger(__name__)

router = APIRouter()

HOOK_CLIP_DURATION = 1.0
HOOK_COUNT = 10


def _get_full_timeline_response(db: Session, project_id: int) -> list[TimelineItemResponse]:
    items = (
        db.query(TimelineItem)
        .filter(TimelineItem.project_id == project_id)
        .order_by(TimelineItem.position)
        .all()
    )
    return [_resolve_item(item) for item in items]


def _select_highlights(db: Session, project_id: int) -> list[tuple[SubClip, Clip]]:
    """Use AI descriptions to pick the best b-roll moments for a hook."""
    # Get analyze items (AI descriptions) for this project
    analyze_items = (
        db.query(AnalyzeItem)
        .filter(AnalyzeItem.project_id == project_id)
        .order_by(AnalyzeItem.start_time)
        .all()
    )

    # Build candidate list: analyze items that reference a sub_clip
    candidates = []
    for ai in analyze_items:
        if not ai.sub_clip_id:
            continue
        sub = db.query(SubClip).filter(SubClip.id == ai.sub_clip_id).first()
        if not sub:
            continue
        clip = sub.parent_clip
        if not clip or clip.clip_type != ClipType.BROLL:
            continue
        candidates.append({
            "analyze_id": ai.id,
            "sub_clip_id": sub.id,
            "description": ai.text,
            "sub": sub,
            "clip": clip,
        })

    if not candidates:
        return []

    if len(candidates) <= HOOK_COUNT:
        return [(c["sub"], c["clip"]) for c in candidates]

    # Gather full transcript from all talking clips
    talking_clips = (
        db.query(Clip)
        .filter(Clip.project_id == project_id, Clip.clip_type == ClipType.TALKING)
        .all()
    )
    transcript_parts = [c.transcript for c in talking_clips if c.transcript]
    full_transcript = "\n".join(transcript_parts)

    # Ask Claude to pick the best moments for a hook
    descriptions_list = "\n".join(
        f'{i + 1}. [id={c["analyze_id"]}] {c["description"]}'
        for i, c in enumerate(candidates)
    )

    user_content = f"B-roll clips:\n\n{descriptions_list}"
    if full_transcript:
        truncated = full_transcript[:6000]
        if len(full_transcript) > 6000:
            truncated += "\n\n[transcript truncated]"
        user_content += f"\n\nFull video transcript:\n\n{truncated}"

    try:
        client = get_client()
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=256,
            system=(
                "You pick the best b-roll clips for a video hook. "
                "A hook is a fast montage at the start of a video to grab attention. "
                "You are given the b-roll clip descriptions and the full video transcript. "
                "Pick clips that are diverse, visually striking, relate to the video's topic, and create curiosity. "
                f"Return exactly {HOOK_COUNT} IDs as a JSON array of integers, nothing else."
            ),
            messages=[{
                "role": "user",
                "content": f"Pick the best {HOOK_COUNT} clips for a hook:\n\n{user_content}",
            }],
        )

        raw = response.content[0].text.strip()
        selected_ids = json.loads(raw)

        # Map selected IDs back to candidates
        id_to_candidate = {c["analyze_id"]: c for c in candidates}
        selected = []
        for aid in selected_ids:
            if aid in id_to_candidate:
                c = id_to_candidate[aid]
                selected.append((c["sub"], c["clip"]))
        if selected:
            return selected[:HOOK_COUNT]
    except Exception:
        logger.exception("Claude hook selection failed")
        raise


def _clear_hook_items(db: Session, project_id: int) -> float:
    """Remove hook items and their SubClips. Returns total hook duration removed."""
    hook_items = (
        db.query(TimelineItem)
        .filter(TimelineItem.project_id == project_id, TimelineItem.is_hook == True)
        .order_by(TimelineItem.position)
        .all()
    )

    if not hook_items:
        return 0.0

    total_duration = 0.0
    sub_clip_ids = []
    for item in hook_items:
        if item.sub_clip_id and item.sub_clip:
            sub = item.sub_clip
            total_duration += sub.end_time - sub.start_time
            sub_clip_ids.append(sub.id)
        db.delete(item)

    # Delete hook tracker overlays
    hook_trackers = (
        db.query(TrackerItem)
        .filter(
            TrackerItem.project_id == project_id,
            TrackerItem.overlay_path.like("%hook_tracker_%"),
        )
        .all()
    )
    for t in hook_trackers:
        db.delete(t)

    # Delete the hook SubClips
    if sub_clip_ids:
        db.query(SubClip).filter(SubClip.id.in_(sub_clip_ids)).delete(
            synchronize_session="fetch"
        )

    # Renumber remaining positions
    remaining = (
        db.query(TimelineItem)
        .filter(TimelineItem.project_id == project_id)
        .order_by(TimelineItem.position)
        .all()
    )
    for i, item in enumerate(remaining):
        item.position = i

    db.flush()
    return total_duration


@router.post("/{project_id}/auto", response_model=HookAutoResponse)
async def auto_generate_hook(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    timeline_items = (
        db.query(TimelineItem)
        .filter(TimelineItem.project_id == project_id)
        .all()
    )
    if not timeline_items:
        raise HTTPException(400, "Timeline is empty")

    # Clear existing hook first (idempotent)
    old_duration = _clear_hook_items(db, project_id)
    if old_duration > 0:
        _shift_overlay_times(db, project_id, 0.0, -old_duration)

    # Select highlights
    highlights = _select_highlights(db, project_id)
    if not highlights:
        raise HTTPException(400, "Run Analyze first to generate b-roll descriptions")

    hook_count = len(highlights)
    total_hook_duration = 0.0

    # Create new SubClips and TimelineItems for the hook
    new_hook_items = []
    for i, (sub, clip) in enumerate(highlights):
        duration = min(HOOK_CLIP_DURATION, sub.end_time - sub.start_time)
        hook_sub = SubClip(
            clip_id=clip.id,
            start_time=sub.start_time,
            end_time=sub.start_time + duration,
            score=sub.score,
            label=f"hook {i + 1}",
        )
        db.add(hook_sub)
        db.flush()

        total_hook_duration += duration
        new_hook_items.append((hook_sub, clip, i))

    # Shift existing timeline items down
    existing_items = (
        db.query(TimelineItem)
        .filter(TimelineItem.project_id == project_id)
        .all()
    )
    for item in existing_items:
        item.position += hook_count

    # Shift overlay times forward
    _shift_overlay_times(db, project_id, 0.0, total_hook_duration)

    # Insert hook items at positions 0..N-1
    for hook_sub, clip, i in new_hook_items:
        tl_item = TimelineItem(
            project_id=project_id,
            clip_id=clip.id,
            sub_clip_id=hook_sub.id,
            position=i,
            is_hook=True,
        )
        db.add(tl_item)

    # Generate tracker overlays on every 3rd hook clip
    proj_dir = TRACKER_DIR / str(project_id)
    proj_dir.mkdir(parents=True, exist_ok=True)
    cursor = 0.0
    for hook_sub, clip, i in new_hook_items:
        duration = hook_sub.end_time - hook_sub.start_time
        if (i + 1) % 3 == 0:  # every 3rd clip (3rd, 6th, 9th)
            out_path = str(proj_dir / f"hook_tracker_{i}.webm")
            await generate_tracker_overlay(
                source_path=clip.source_path,
                start_time=hook_sub.start_time,
                end_time=hook_sub.end_time,
                output_path=out_path,
            )
            tracker = TrackerItem(
                project_id=project_id,
                start_time=cursor,
                end_time=cursor + duration,
                overlay_path=out_path,
            )
            db.add(tracker)
        cursor += duration

    db.commit()
    return HookAutoResponse(items=_get_full_timeline_response(db, project_id))


@router.delete("/{project_id}", response_model=HookAutoResponse)
def clear_hook(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    removed_duration = _clear_hook_items(db, project_id)
    if removed_duration > 0:
        _shift_overlay_times(db, project_id, 0.0, -removed_duration)

    db.commit()
    return HookAutoResponse(items=_get_full_timeline_response(db, project_id))

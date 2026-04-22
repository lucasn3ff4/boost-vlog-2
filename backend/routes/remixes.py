import logging
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

logger = logging.getLogger(__name__)
from sqlalchemy.orm import Session

from database import get_db
from models import (
    AnalyzeItem, Clip, ClipType, EnlargeItem, MusicItem, Project, SubClip, TimelineItem,
    TitleItem, CaptionItem, TimestampItem, TrackerItem, SubscribeItem,
    ZoomItem,
)
from schemas import RemixAutoResponse, TimelineItemResponse
from config import REMIX_DIR
from routes.timeline import _resolve_item
from services.remix_generator import (
    find_boundaries,
    select_boundaries_and_generate_prompts,
    generate_remix_video,
    _probe_duration,
)

router = APIRouter()


def _walk_timeline(timeline_items: list[TimelineItem]) -> list[dict]:
    """Walk timeline items and build entries with clip metadata and cumulative timing."""
    entries = []
    cursor = 0.0

    for item in timeline_items:
        if item.sub_clip_id and item.sub_clip:
            sub = item.sub_clip
            clip = sub.parent_clip
            if not clip:
                continue
            duration = sub.end_time - sub.start_time
            source_path = clip.source_path
            start_time = sub.start_time
            end_time = sub.end_time
            clip_type = clip.clip_type.value if clip.clip_type else None
            clip_id = clip.id
            sub_clip_id = sub.id
            transcript = clip.transcript
        elif item.clip_id and item.clip:
            clip = item.clip
            duration = clip.duration or 0
            source_path = clip.source_path
            start_time = 0
            end_time = duration
            clip_type = clip.clip_type.value if clip.clip_type else None
            clip_id = clip.id
            sub_clip_id = None
            transcript = clip.transcript
        else:
            continue

        if duration < 0.034:
            continue

        entries.append({
            "position": item.position,
            "clip_type": clip_type,
            "clip_id": clip_id,
            "sub_clip_id": sub_clip_id,
            "source_path": source_path,
            "start_time": start_time,
            "end_time": end_time,
            "timeline_start": cursor,
            "timeline_end": cursor + duration,
            "transcript": transcript,
        })
        cursor += duration

    return entries


def _shift_overlay_times(db: Session, project_id: int, after_time: float, shift: float):
    """Shift start_time/end_time of all overlay items that start after the given time."""
    for model in (MusicItem, TitleItem, CaptionItem, TimestampItem, TrackerItem, SubscribeItem, ZoomItem, EnlargeItem, AnalyzeItem):
        items = db.query(model).filter(
            model.project_id == project_id,
            model.start_time >= after_time,
        ).all()
        logger.info("Shifting %d %s items (after_time=%.3f, shift=%.3f)", len(items), model.__tablename__, after_time, shift)
        for item in items:
            item.start_time += shift
            item.end_time += shift


def _get_full_timeline_response(db: Session, project_id: int) -> list[TimelineItemResponse]:
    """Fetch and resolve the full timeline."""
    items = (
        db.query(TimelineItem)
        .filter(TimelineItem.project_id == project_id)
        .order_by(TimelineItem.position)
        .all()
    )
    return [_resolve_item(item) for item in items]


@router.get("/{project_id}", response_model=RemixAutoResponse)
def get_remixes(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    # Return full timeline (frontend replaces its timelineItems)
    return RemixAutoResponse(items=_get_full_timeline_response(db, project_id))


@router.post("/{project_id}/auto", response_model=RemixAutoResponse)
async def auto_generate_remixes(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    # First, clear any existing remixes
    _clear_remix_clips(db, project_id)

    timeline_items = (
        db.query(TimelineItem)
        .filter(TimelineItem.project_id == project_id)
        .order_by(TimelineItem.position)
        .all()
    )

    if not timeline_items:
        raise HTTPException(400, "Timeline is empty")

    # Walk timeline to build entries
    entries = _walk_timeline(timeline_items)
    total_duration = entries[-1]["timeline_end"] if entries else 0

    # Find b-roll/talking boundaries
    boundaries = find_boundaries(entries)
    if not boundaries:
        raise HTTPException(400, "No b-roll/talking boundaries found in timeline")

    # Require analyze descriptions and attach them to boundaries
    analyze_items = (
        db.query(AnalyzeItem)
        .filter(AnalyzeItem.project_id == project_id)
        .all()
    )
    if not analyze_items:
        raise HTTPException(400, "B-roll descriptions required — run Analyze first")

    # Build lookup by sub_clip_id
    analyze_by_sub_clip = {a.sub_clip_id: a.text for a in analyze_items if a.sub_clip_id}
    for b in boundaries:
        sc_id = b.get("broll_sub_clip_id")
        if sc_id and sc_id in analyze_by_sub_clip:
            b["broll_description"] = analyze_by_sub_clip[sc_id]

    # Claude decides count and generates prompts
    selections = select_boundaries_and_generate_prompts(boundaries, total_duration)
    if not selections:
        raise HTTPException(400, "No boundaries selected for remix")

    # Sort by insert position descending so we can insert without cascading shifts
    selections.sort(key=lambda s: s["insert_after_position"], reverse=True)

    proj_dir = REMIX_DIR / str(project_id)
    proj_dir.mkdir(parents=True, exist_ok=True)

    # Track cumulative time shift for overlay adjustment
    # Process in reverse order for position shifting, but track overlay shifts per insertion
    insertions = []  # (insert_after_position, remix_duration, timeline_position)

    for idx, sel in enumerate(selections):
        out_path = str(proj_dir / f"remix_{idx}.mp4")

        # Generate the remix video via Runway
        await generate_remix_video(
            broll_source_path=sel["broll_source_path"],
            broll_start=sel["broll_start"],
            broll_end=sel["broll_end"],
            video_prompt=sel["video_prompt"],
            output_path=out_path,
        )

        remix_duration = _probe_duration(out_path)

        # Create Clip row for the remix
        remix_clip = Clip(
            project_id=project_id,
            source_path=sel["broll_source_path"],
            processed_path=out_path,
            clip_type=ClipType.REMIX,
            status="done",
            duration=remix_duration,
        )
        db.add(remix_clip)
        db.flush()  # Get the clip ID

        insert_pos = sel["insert_after_position"]

        # Shift all timeline items after this position
        items_to_shift = (
            db.query(TimelineItem)
            .filter(
                TimelineItem.project_id == project_id,
                TimelineItem.position > insert_pos,
            )
            .all()
        )
        for item in items_to_shift:
            item.position += 1

        # Insert new timeline item
        remix_tl_item = TimelineItem(
            project_id=project_id,
            clip_id=remix_clip.id,
            sub_clip_id=None,
            position=insert_pos + 1,
        )
        db.add(remix_tl_item)

        insertions.append((insert_pos, remix_duration, sel["timeline_position"]))

    db.flush()

    # Shift overlay times — process insertions in forward order (by timeline position)
    insertions.sort(key=lambda x: x[2])
    cumulative_shift = 0.0
    for _, remix_duration, timeline_pos in insertions:
        _shift_overlay_times(db, project_id, timeline_pos + cumulative_shift, remix_duration)
        cumulative_shift += remix_duration

    db.commit()

    return RemixAutoResponse(items=_get_full_timeline_response(db, project_id))


def _clear_remix_clips(db: Session, project_id: int):
    """Remove all remix clips from the timeline and database."""
    # Find all remix clips for this project
    remix_clips = (
        db.query(Clip)
        .filter(Clip.project_id == project_id, Clip.clip_type == ClipType.REMIX)
        .all()
    )

    if not remix_clips:
        return

    remix_clip_ids = [c.id for c in remix_clips]

    # Compute total remix duration for overlay time adjustment
    # Walk timeline to find remix items and their timeline positions
    timeline_items = (
        db.query(TimelineItem)
        .filter(TimelineItem.project_id == project_id)
        .order_by(TimelineItem.position)
        .all()
    )

    # Compute timeline positions and remix durations
    cursor = 0.0
    remix_insertions = []  # (timeline_start, duration)
    for item in timeline_items:
        if item.clip_id and item.clip_id in remix_clip_ids:
            clip = item.clip
            duration = clip.duration or 0
            remix_insertions.append((cursor, duration))
            cursor += duration
        elif item.sub_clip_id and item.sub_clip:
            cursor += item.sub_clip.end_time - item.sub_clip.start_time
        elif item.clip_id and item.clip:
            cursor += item.clip.duration or 0

    # Remove timeline items pointing to remix clips
    db.query(TimelineItem).filter(
        TimelineItem.project_id == project_id,
        TimelineItem.clip_id.in_(remix_clip_ids),
    ).delete(synchronize_session="fetch")

    # Remove the remix clips themselves
    db.query(Clip).filter(Clip.id.in_(remix_clip_ids)).delete(synchronize_session="fetch")

    # Renumber remaining timeline positions
    remaining = (
        db.query(TimelineItem)
        .filter(TimelineItem.project_id == project_id)
        .order_by(TimelineItem.position)
        .all()
    )
    for i, item in enumerate(remaining):
        item.position = i

    # Shift overlay times back — process in reverse order
    remix_insertions.sort(key=lambda x: x[0], reverse=True)
    for timeline_start, duration in remix_insertions:
        _shift_overlay_times(db, project_id, timeline_start, -duration)

    db.flush()


@router.delete("/{project_id}", response_model=RemixAutoResponse)
def clear_remixes(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    _clear_remix_clips(db, project_id)

    # Clean up generated files
    proj_dir = REMIX_DIR / str(project_id)
    if proj_dir.exists():
        shutil.rmtree(proj_dir)

    db.commit()

    return RemixAutoResponse(items=_get_full_timeline_response(db, project_id))

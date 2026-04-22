import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db, SessionLocal
from models import AnalyzeItem, ClipType, TimelineItem, Project
from schemas import AnalyzeItemResponse, AnalyzeAutoResponse
from services.broll_analyzer import analyze_broll_frame
from routes.ws import broadcast

logger = logging.getLogger(__name__)

router = APIRouter()

# Cancel flags per project — checked between each clip
_cancel_flags: dict[int, bool] = {}


def _collect_broll_entries(timeline_items):
    """Walk timeline and collect b-roll clips with their timeline positions."""
    broll_entries = []
    cursor = 0.0
    for item in timeline_items:
        if item.sub_clip_id and item.sub_clip:
            sub = item.sub_clip
            clip = sub.parent_clip
            duration = sub.end_time - sub.start_time
            if clip and clip.clip_type == ClipType.BROLL and duration >= 0.034:
                source_path = clip.processed_path or clip.source_path
                broll_entries.append({
                    "clip_id": clip.id,
                    "sub_clip_id": sub.id,
                    "source_path": source_path,
                    "source_start": sub.start_time,
                    "source_end": sub.end_time,
                    "timeline_start": cursor,
                    "timeline_end": cursor + duration,
                })
            cursor += duration if duration >= 0.034 else 0
        elif item.clip_id and item.clip:
            clip = item.clip
            duration = clip.duration or 0
            if clip.clip_type == ClipType.BROLL and duration >= 0.034:
                source_path = clip.processed_path or clip.source_path
                broll_entries.append({
                    "clip_id": clip.id,
                    "sub_clip_id": None,
                    "source_path": source_path,
                    "source_start": 0,
                    "source_end": duration,
                    "timeline_start": cursor,
                    "timeline_end": cursor + duration,
                })
            if duration >= 0.034:
                cursor += duration
    return broll_entries


async def _run_analysis(project_id: int, broll_entries: list[dict]):
    """Background task: analyze each b-roll clip and broadcast results one at a time."""
    _cancel_flags[project_id] = False
    db = SessionLocal()
    try:
        for entry in broll_entries:
            # Check cancel flag before each clip
            if _cancel_flags.get(project_id):
                break

            try:
                description = await analyze_broll_frame(
                    entry["source_path"],
                    entry["source_start"],
                    entry["source_end"],
                )
            except Exception:
                logger.exception("Failed to analyze b-roll frame")
                continue

            item = AnalyzeItem(
                project_id=project_id,
                clip_id=entry["clip_id"],
                sub_clip_id=entry["sub_clip_id"],
                text=description,
                start_time=entry["timeline_start"],
                end_time=entry["timeline_end"],
            )
            db.add(item)
            db.commit()
            db.refresh(item)

            await broadcast(project_id, "analyze_item_done", {
                "id": item.id,
                "clip_id": item.clip_id,
                "sub_clip_id": item.sub_clip_id,
                "text": item.text,
                "start_time": item.start_time,
                "end_time": item.end_time,
            })

        await broadcast(project_id, "analyze_done", {})
    finally:
        _cancel_flags.pop(project_id, None)
        db.close()


@router.get("/{project_id}", response_model=AnalyzeAutoResponse)
def get_analyzes(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    items = (
        db.query(AnalyzeItem)
        .filter(AnalyzeItem.project_id == project_id)
        .order_by(AnalyzeItem.start_time)
        .all()
    )
    return AnalyzeAutoResponse(items=[AnalyzeItemResponse.model_validate(i) for i in items])


@router.post("/{project_id}/auto")
async def auto_generate_analyzes(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    timeline_items = (
        db.query(TimelineItem)
        .filter(TimelineItem.project_id == project_id)
        .order_by(TimelineItem.position)
        .all()
    )
    if not timeline_items:
        raise HTTPException(400, "No timeline items — process clips first")

    broll_entries = _collect_broll_entries(timeline_items)
    if not broll_entries:
        raise HTTPException(400, "No b-roll clips found in timeline")

    # Build lookup of existing analyses by (clip_id, sub_clip_id)
    existing = db.query(AnalyzeItem).filter(AnalyzeItem.project_id == project_id).all()
    analyzed_map: dict[tuple, AnalyzeItem] = {}
    for item in existing:
        analyzed_map[(item.clip_id, item.sub_clip_id)] = item

    # Separate new vs cached, update timeline positions on cached
    new_entries = []
    current_keys = set()
    for entry in broll_entries:
        key = (entry["clip_id"], entry["sub_clip_id"])
        current_keys.add(key)
        if key in analyzed_map:
            item = analyzed_map[key]
            item.start_time = entry["timeline_start"]
            item.end_time = entry["timeline_end"]
        else:
            new_entries.append(entry)

    # Remove analyses for clips no longer on timeline
    for key, item in analyzed_map.items():
        if key not in current_keys:
            db.delete(item)
    db.commit()

    if not new_entries:
        # Everything already analyzed — just signal done, frontend already has the items
        await broadcast(project_id, "analyze_done", {})
        return {"ok": True, "count": 0, "cached": len(analyzed_map)}

    # Only analyze new entries
    asyncio.create_task(_run_analysis(project_id, new_entries))
    return {"ok": True, "count": len(new_entries), "cached": len(cached_items)}


@router.post("/{project_id}/cancel")
def cancel_analysis(project_id: int):
    _cancel_flags[project_id] = True
    return {"ok": True}


@router.delete("/{project_id}")
def clear_analyzes(project_id: int, db: Session = Depends(get_db)):
    db.query(AnalyzeItem).filter(AnalyzeItem.project_id == project_id).delete()
    db.commit()
    return {"ok": True}

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import ZoomItem, EnlargeItem, TimelineItem, Project
from schemas import ZoomItemResponse, ZoomItemUpdate, ZoomAutoResponse
from services.zoom_generator import generate_effect_items

router = APIRouter()


@router.get("/{project_id}", response_model=ZoomAutoResponse)
def get_zooms(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    items = (
        db.query(ZoomItem)
        .filter(ZoomItem.project_id == project_id)
        .order_by(ZoomItem.start_time)
        .all()
    )
    return ZoomAutoResponse(items=[ZoomItemResponse.model_validate(i) for i in items])


@router.post("/{project_id}/auto", response_model=ZoomAutoResponse)
def auto_generate_zooms(project_id: int, db: Session = Depends(get_db)):
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

    # Exclude clips already used by enlarge items
    enlarge_ranges = [
        (e.start_time, e.end_time)
        for e in db.query(EnlargeItem).filter(EnlargeItem.project_id == project_id).all()
    ]

    overlays = generate_effect_items(timeline_items, enlarge_ranges)

    # Replace only zoom items
    db.query(ZoomItem).filter(ZoomItem.project_id == project_id).delete()

    new_items = []
    for o in overlays:
        item = ZoomItem(project_id=project_id, start_time=o["start_time"], end_time=o["end_time"])
        db.add(item)
        new_items.append(item)

    db.commit()
    for item in new_items:
        db.refresh(item)

    return ZoomAutoResponse(items=[ZoomItemResponse.model_validate(i) for i in new_items])


@router.put("/{project_id}/items/{item_id}", response_model=ZoomItemResponse)
def update_zoom_item(project_id: int, item_id: int, body: ZoomItemUpdate, db: Session = Depends(get_db)):
    item = (
        db.query(ZoomItem)
        .filter(ZoomItem.id == item_id, ZoomItem.project_id == project_id)
        .first()
    )
    if not item:
        raise HTTPException(404, "Zoom item not found")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(item, field, value)

    db.commit()
    db.refresh(item)
    return ZoomItemResponse.model_validate(item)


@router.delete("/{project_id}")
def clear_zooms(project_id: int, db: Session = Depends(get_db)):
    db.query(ZoomItem).filter(ZoomItem.project_id == project_id).delete()
    db.commit()
    return {"ok": True}


@router.delete("/{project_id}/items/{item_id}")
def delete_zoom_item(project_id: int, item_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(ZoomItem)
        .filter(ZoomItem.id == item_id, ZoomItem.project_id == project_id)
        .delete()
    )
    if rows == 0:
        raise HTTPException(404, "Zoom item not found")
    db.commit()
    return {"ok": True}

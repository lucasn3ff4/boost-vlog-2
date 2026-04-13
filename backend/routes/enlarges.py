from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import EnlargeItem, ZoomItem, TimelineItem, Project
from schemas import EnlargeItemResponse, EnlargeItemUpdate, EnlargeAutoResponse
from services.zoom_generator import generate_effect_items

router = APIRouter()


@router.get("/{project_id}", response_model=EnlargeAutoResponse)
def get_enlarges(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    items = (
        db.query(EnlargeItem)
        .filter(EnlargeItem.project_id == project_id)
        .order_by(EnlargeItem.start_time)
        .all()
    )
    return EnlargeAutoResponse(items=[EnlargeItemResponse.model_validate(i) for i in items])


@router.post("/{project_id}/auto", response_model=EnlargeAutoResponse)
def auto_generate_enlarges(project_id: int, db: Session = Depends(get_db)):
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

    # Exclude clips already used by zoom items
    zoom_ranges = [
        (z.start_time, z.end_time)
        for z in db.query(ZoomItem).filter(ZoomItem.project_id == project_id).all()
    ]

    overlays = generate_effect_items(timeline_items, zoom_ranges)

    # Replace only enlarge items
    db.query(EnlargeItem).filter(EnlargeItem.project_id == project_id).delete()

    new_items = []
    for o in overlays:
        item = EnlargeItem(project_id=project_id, start_time=o["start_time"], end_time=o["end_time"])
        db.add(item)
        new_items.append(item)

    db.commit()
    for item in new_items:
        db.refresh(item)

    return EnlargeAutoResponse(items=[EnlargeItemResponse.model_validate(i) for i in new_items])


@router.put("/{project_id}/items/{item_id}", response_model=EnlargeItemResponse)
def update_enlarge_item(project_id: int, item_id: int, body: EnlargeItemUpdate, db: Session = Depends(get_db)):
    item = (
        db.query(EnlargeItem)
        .filter(EnlargeItem.id == item_id, EnlargeItem.project_id == project_id)
        .first()
    )
    if not item:
        raise HTTPException(404, "Enlarge item not found")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(item, field, value)

    db.commit()
    db.refresh(item)
    return EnlargeItemResponse.model_validate(item)


@router.delete("/{project_id}")
def clear_enlarges(project_id: int, db: Session = Depends(get_db)):
    db.query(EnlargeItem).filter(EnlargeItem.project_id == project_id).delete()
    db.commit()
    return {"ok": True}


@router.delete("/{project_id}/items/{item_id}")
def delete_enlarge_item(project_id: int, item_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(EnlargeItem)
        .filter(EnlargeItem.id == item_id, EnlargeItem.project_id == project_id)
        .delete()
    )
    if rows == 0:
        raise HTTPException(404, "Enlarge item not found")
    db.commit()
    return {"ok": True}

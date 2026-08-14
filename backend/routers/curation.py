"""Collection Curating — thin router over services/curation.py."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
import services.curation as curation

router = APIRouter()


@router.get("/state")
def state(db: Session = Depends(get_db)):
    """Debt totals, curation streak, and the active focus creator."""
    return curation.run_state(db)


@router.get("/debt")
def debt(db: Session = Depends(get_db)):
    """Headline curation-debt numbers for the dashboard stat strip."""
    return curation.debt_summary(db)


@router.get("/next")
def next_gallery(exclude: str = "", db: Session = Depends(get_db)):
    """The next gallery to curate.

    `exclude` is a comma-separated list of ids already seen in this sitting, so
    an unbroken run never doubles back on itself.
    """
    exclude_ids = [int(x) for x in exclude.split(",") if x.strip().isdigit()]
    g, lane = curation.next_gallery(db, exclude_ids)
    if not g:
        return {"gallery": None, "lane": None, "exhausted": True}
    return {"gallery": curation.gallery_payload(db, g, lane), "lane": lane, "exhausted": False}


@router.get("/gallery/{gallery_id}")
def get_gallery(gallery_id: int, db: Session = Depends(get_db)):
    from models import Gallery
    g = db.query(Gallery).filter(Gallery.id == gallery_id).first()
    if not g:
        raise HTTPException(404, "Gallery not found")
    return {"gallery": curation.gallery_payload(db, g)}


@router.post("/save")
def save(body: dict, db: Session = Depends(get_db)):
    """Commit staged edits for one gallery.

    `mark_curated: false` is the "keep my changes but don't count it as curated"
    path taken when a run is closed mid-edit.
    """
    gallery_id = body.get("gallery_id")
    if not gallery_id:
        raise HTTPException(400, "gallery_id is required")
    try:
        return curation.save(db, int(gallery_id), body,
                             mark_curated=bool(body.get("mark_curated", True)))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/snooze")
def snooze(body: dict, db: Session = Depends(get_db)):
    gallery_id = body.get("gallery_id")
    if not gallery_id:
        raise HTTPException(400, "gallery_id is required")
    try:
        return curation.snooze(db, int(gallery_id), int(body.get("days") or curation.SNOOZE_DAYS))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/pin")
def pin(body: dict, db: Session = Depends(get_db)):
    """Remember where an interrupted run left off; cleared when next served."""
    return curation.set_pin(db, body.get("gallery_id"))


@router.post("/focus")
def focus(body: dict, db: Session = Depends(get_db)):
    """Lock the beloved lane to one favourite creator (null clears it)."""
    return curation.set_focus(db, body.get("creator_id"))


@router.get("/beloved")
def beloved(db: Session = Depends(get_db)):
    """The beloved pool with curation progress — the focus-mode picker.

    Ordered by blended score so the creators the run leans on most sit at the top.
    """
    from models import Creator
    ids = curation.beloved_creator_ids(db)
    if not ids:
        return []
    creators = db.query(Creator).filter(Creator.id.in_(ids)).all()
    rows = [{"id": c.id, "name": c.name,
             "avatar": f"/api/creators/{c.id}/avatar" if c.avatar_path else None,
             **(curation.beloved_detail(db, c.id) or {}),
             **curation.creator_progress(db, c.id)}
            for c in creators]
    rows.sort(key=lambda r: r.get("score", 0), reverse=True)
    return rows

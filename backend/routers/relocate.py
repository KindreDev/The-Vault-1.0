from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from services import relocate as relocate_svc

router = APIRouter()


@router.post("/suggest")
def suggest(body: dict, db: Session = Depends(get_db)):
    """Where these galleries sit now, whether that's their creator's folder, and
    every creator folder they could be moved to."""
    ids = body.get("gallery_ids") or []
    if not ids:
        raise HTTPException(400, "No galleries given")
    return relocate_svc.suggest_destinations(db, ids)


@router.post("/plan")
def plan(body: dict, db: Session = Depends(get_db)):
    """Dry run — nothing touches the disk. Returns the target path per gallery
    and flags names that already exist at the destination."""
    ids = body.get("gallery_ids") or []
    dest = (body.get("dest_root") or "").strip()
    if not ids:
        raise HTTPException(400, "No galleries given")
    if not dest:
        raise HTTPException(400, "No destination given")
    return relocate_svc.plan_gallery_move(db, ids, dest)


@router.post("/galleries")
def move_galleries(body: dict, db: Session = Depends(get_db)):
    ids = body.get("gallery_ids") or []
    dest = (body.get("dest_root") or "").strip()
    strategy = body.get("strategy") or "rename"
    if not ids:
        raise HTTPException(400, "No galleries given")
    if not dest:
        raise HTTPException(400, "No destination given")
    if strategy not in ("rename", "merge", "skip"):
        raise HTTPException(400, "Unknown clash strategy")
    return relocate_svc.move_galleries(db, ids, dest, strategy)


@router.post("/images")
def move_images(body: dict, db: Session = Depends(get_db)):
    ids = body.get("image_ids") or []
    target = body.get("target_gallery_id")
    if not ids:
        raise HTTPException(400, "No files given")
    if not target:
        raise HTTPException(400, "No target gallery given")
    result = relocate_svc.move_images(db, ids, int(target))
    if result.get("error"):
        raise HTTPException(400, result["error"])
    return result

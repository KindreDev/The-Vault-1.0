from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from database import get_db, SessionLocal
from services import dedup as dedup_svc, task_queue
import threading

router = APIRouter()


def _db_factory():
    return SessionLocal()


@router.post("/compute-hashes")
def compute_hashes():
    task_queue.submit(
        'dedup_hash', 'Build perceptual hash index',
        start_fn=lambda: threading.Thread(
            target=dedup_svc._compute_hashes_thread,
            args=(_db_factory,), daemon=True
        ).start(),
        poll_fn=dedup_svc.get_state,
        cancel_fn=dedup_svc.cancel,
    )
    return {"queued": True}


@router.post("/cancel")
def cancel_hashes():
    task_queue.cancel_current()
    return {"cancelled": True}


@router.get("/status")
def hash_status():
    return dedup_svc.get_state()


@router.get("/search/status")
def search_status():
    return dedup_svc.get_search_state()


@router.get("/groups")
def duplicate_groups(
    threshold: int = Query(10, ge=0, le=64),
):
    return dedup_svc.get_duplicate_groups(_db_factory, threshold=threshold)


@router.get("/image/{image_id}")
def image_duplicates(
    image_id: int,
    threshold: int = Query(10, ge=0, le=64),
    db: Session = Depends(get_db),
):
    return dedup_svc.get_image_duplicates(db, image_id=image_id, threshold=threshold)


@router.get("/stats")
def hash_stats(db: Session = Depends(get_db)):
    return dedup_svc.get_hash_stats(db)


@router.post("/ignore-permanent")
def ignore_permanent(body: dict):
    """
    Permanently mark a duplicate group as 'Keep Both'.
    Writes the group's image IDs to a JSON file next to vault.db.
    NEVER deletes any files — only hides the group from future searches.
    """
    image_ids = body.get("image_ids", [])
    if not image_ids or len(image_ids) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 image IDs")
    count = dedup_svc.ignore_group_permanent(image_ids)
    return {"ok": True, "total_ignored": count}


@router.delete("/ignore-permanent")
def clear_ignore_permanent():
    """Remove all permanently ignored groups so they show up in searches again."""
    dedup_svc.clear_ignored_permanent()
    return {"ok": True}


@router.get("/ignored-count")
def ignored_count():
    return {"count": dedup_svc.get_ignored_count()}

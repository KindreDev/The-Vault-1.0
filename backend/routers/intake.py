import os
import mimetypes
import threading
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from database import get_db, SessionLocal
from models import IntakeRoot, IntakeItem
from services import intake as intake_svc
from services import task_queue

router = APIRouter()


def _launch_in_thread(fn, *args):
    t = threading.Thread(target=fn, args=args, daemon=True)
    t.start()


# ── Intake roots ───────────────────────────────────────────────────────────────
@router.get("/roots")
def list_roots(db: Session = Depends(get_db)):
    return db.query(IntakeRoot).all()


@router.post("/roots", status_code=201)
def add_root(body: dict, db: Session = Depends(get_db)):
    path = (body.get("path") or "").strip()
    if not path:
        raise HTTPException(400, "path required")
    if not os.path.isdir(path):
        raise HTTPException(400, f"Path does not exist: {path}")
    if db.query(IntakeRoot).filter(IntakeRoot.path == path).first():
        raise HTTPException(400, "Intake folder already added")
    if intake_svc._overlaps_library(db, path):
        raise HTTPException(400, "That folder overlaps a library root — pick a separate folder for intake.")
    root = IntakeRoot(path=path, label=(body.get("label") or "").strip() or None)
    db.add(root)
    db.commit()
    db.refresh(root)
    return root


@router.delete("/roots/{root_id}", status_code=204)
def remove_root(root_id: int, db: Session = Depends(get_db)):
    root = db.query(IntakeRoot).filter(IntakeRoot.id == root_id).first()
    if not root:
        raise HTTPException(404, "Intake folder not found")
    db.delete(root)
    db.commit()


# ── Scan / items ───────────────────────────────────────────────────────────────
@router.post("/scan")
def scan(body: dict = None):
    root_id = (body or {}).get("root_id")
    job_id = uuid.uuid4().hex
    task_queue.submit(
        "intake_scan", "Scan intake folders",
        start_fn=lambda: _launch_in_thread(intake_svc.scan_intake, SessionLocal(), root_id, job_id),
        poll_fn=intake_svc.get_intake_state,
        cancel_fn=intake_svc.cancel_intake,
    )
    return {"message": "Queued", "queued": True, "job_id": job_id}


@router.get("/items")
def list_items(status: str = "pending", skip: int = 0, limit: int = 500,
               db: Session = Depends(get_db)):
    q = db.query(IntakeItem)
    if status and status != "all":
        q = q.filter(IntakeItem.status == status)
    q = q.order_by(IntakeItem.discovered_at.desc())
    total = q.count()
    items = q.offset(skip).limit(limit).all()
    return {
        "total": total,
        "items": [
            {
                "id": it.id,
                "filename": it.filename,
                "file_size": it.file_size,
                "is_video": it.is_video,
                "is_archive": it.is_archive,
                "has_funscript": it.has_funscript,
                "duplicate_of": it.duplicate_of,
                "discovered_at": it.discovered_at.isoformat() if it.discovered_at else None,
                "thumb": f"/thumbs/{os.path.basename(it.thumb_path)}" if it.thumb_path else None,
                "status": it.status,
                "error": it.error,
            }
            for it in items
        ],
    }


@router.post("/commit")
def commit(body: dict):
    item_ids = body.get("item_ids") or []
    target = body.get("target") or {}
    if not item_ids:
        raise HTTPException(400, "item_ids required")
    if not target.get("mode"):
        raise HTTPException(400, "target.mode required")
    job_id = uuid.uuid4().hex
    task_queue.submit(
        "intake_commit", f"Sort {len(item_ids)} file(s) into the vault",
        start_fn=lambda: _launch_in_thread(intake_svc.commit_items, SessionLocal(), item_ids, target, job_id),
        poll_fn=intake_svc.get_intake_state,
        cancel_fn=intake_svc.cancel_intake,
    )
    return {"message": "Queued", "queued": True, "job_id": job_id}


# ── Archive inspection ─────────────────────────────────────────────────────────
def _get_archive_item(db: Session, item_id: int) -> IntakeItem:
    item = db.query(IntakeItem).filter(IntakeItem.id == item_id).first()
    if not item or not item.is_archive:
        raise HTTPException(404, "Archive item not found")
    if not os.path.exists(item.source_path):
        raise HTTPException(404, "Archive file no longer exists on disk")
    return item


@router.get("/items/{item_id}/archive")
def archive_contents(item_id: int, db: Session = Depends(get_db)):
    item = _get_archive_item(db, item_id)
    return intake_svc.list_archive_contents(item.source_path)


@router.get("/items/{item_id}/archive/preview")
def archive_preview(item_id: int, name: str, db: Session = Depends(get_db)):
    item = _get_archive_item(db, item_id)
    try:
        data = intake_svc.read_archive_entry(item.source_path, name)
    except KeyError:
        raise HTTPException(404, "No such entry in archive")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return Response(content=data,
                    media_type=mimetypes.guess_type(name)[0] or "application/octet-stream")


@router.post("/discard")
def discard(body: dict, db: Session = Depends(get_db)):
    item_ids = body.get("item_ids") or []
    if not item_ids:
        raise HTTPException(400, "item_ids required")
    return intake_svc.discard_items(db, item_ids, bool(body.get("delete_file", False)))


@router.get("/status")
def status():
    return intake_svc.get_intake_state()


# ── Config (new-creator base folder + archive extraction) ──────────────────────
@router.get("/config")
def get_config():
    return intake_svc.get_intake_config()


@router.post("/config")
def set_config(body: dict):
    return intake_svc.set_intake_config(
        new_creator_base=body.get("new_creator_base"),
        extract_archives=body.get("extract_archives"),
        archive_after=body.get("archive_after"),
        funscript_dest=body.get("funscript_dest"),
    )

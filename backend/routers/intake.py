import os
import mimetypes
import threading
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import Response, FileResponse
from sqlalchemy.orm import Session

from database import get_db, SessionLocal
from models import IntakeRoot, IntakeFolder, IntakeItem
from services import intake as intake_svc
from services import task_queue
from services.video_playback import VideoPlaybackError, ensure_browser_playback

router = APIRouter()


def _launch_in_thread(fn, *args):
    return task_queue.launch_background(fn, *args)


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
def list_items(status: str = "pending", page: int = 1, limit: int = 120,
               kind: str = "all", search: str = "", duplicates: str = "all",
               sort: str = "date", direction: str = "desc",
               db: Session = Depends(get_db)):
    return intake_svc.list_items(db, status=status, page=page, limit=limit,
                                 kind=kind, search=search, duplicates=duplicates,
                                 sort=sort, direction=direction)


@router.get("/folders")
def list_folders(status: str = "pending", page: int = 1, limit: int = 60,
                 search: str = "", sort: str = "date", direction: str = "desc",
                 db: Session = Depends(get_db)):
    return intake_svc.list_folders(db, status=status, page=page, limit=limit,
                                   search=search, sort=sort, direction=direction)


@router.get("/folders/{folder_id}")
def folder_contents(folder_id: int, page: int = 1, limit: int = 120,
                    db: Session = Depends(get_db)):
    folder = db.query(IntakeFolder).filter(IntakeFolder.id == folder_id).first()
    if not folder:
        raise HTTPException(404, "Loading Bay folder not found")
    if not intake_svc._inside_root(db, folder.source_path, folder.root_id):
        raise HTTPException(403, "Folder is outside its Loading Bay root")
    return intake_svc.get_folder_contents(db, folder_id, page=page, limit=limit)


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


@router.post("/commit-folders")
def commit_folders(body: dict):
    folder_ids = body.get("folder_ids") or []
    target = body.get("target") or {}
    if not folder_ids:
        raise HTTPException(400, "folder_ids required")
    if not target.get("mode"):
        raise HTTPException(400, "target.mode required")
    job_id = uuid.uuid4().hex
    task_queue.submit(
        "intake_commit", f"Import {len(folder_ids)} gallery folder(s)",
        start_fn=lambda: _launch_in_thread(intake_svc.commit_folders, SessionLocal(), folder_ids, target, job_id),
        poll_fn=intake_svc.get_intake_state,
        cancel_fn=intake_svc.cancel_intake,
    )
    return {"message": "Queued", "queued": True, "job_id": job_id}


@router.get("/items/{item_id}/file")
def item_file(item_id: int, request: Request, transcode: bool = Query(False), db: Session = Depends(get_db)):
    item = db.query(IntakeItem).filter(IntakeItem.id == item_id).first()
    if not item or not os.path.isfile(item.source_path):
        raise HTTPException(404, "Loading Bay file not found")
    if not intake_svc._inside_root(db, item.source_path, item.root_id):
        raise HTTPException(403, "File is outside its Loading Bay root")
    if item.is_video:
        from routers.images import _video_response
        try:
            playback_path, _ = ensure_browser_playback(
                item.source_path, f"intake-{item_id}", force=transcode,
            )
        except VideoPlaybackError as exc:
            raise HTTPException(502, str(exc)) from exc
        return _video_response(playback_path, request.headers.get("range"), request)
    if item.is_archive:
        raise HTTPException(400, "Archives cannot be played directly")
    return FileResponse(item.source_path)


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
    action = body.get("action") or ("delete" if body.get("delete_file") else "hide")
    try:
        return intake_svc.discard_items(db, item_ids, action)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/discard-folders")
def discard_folders(body: dict, db: Session = Depends(get_db)):
    folder_ids = body.get("folder_ids") or []
    if not folder_ids:
        raise HTTPException(400, "folder_ids required")
    try:
        return intake_svc.discard_folders(db, folder_ids, body.get("action") or "hide")
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/duplicates/bulk")
def bulk_duplicates(body: dict, db: Session = Depends(get_db)):
    action = body.get("action")
    if action not in {"hide", "ignore", "delete"}:
        raise HTTPException(400, "action must be hide, ignore, or delete")
    return intake_svc.bulk_duplicate_action(
        db, action, include_visual=bool(body.get("include_visual", False)),
        kind=body.get("kind") or "all", search=body.get("search") or "")


@router.get("/status")
def status():
    return intake_svc.get_intake_state()


# ── Config (new-creator base folder + archive extraction) ──────────────────────
@router.get("/config")
def get_config():
    return intake_svc.get_intake_config()


@router.post("/config")
def set_config(body: dict, db: Session = Depends(get_db)):
    if body.get("unsorted_folder") is not None and str(body.get("unsorted_folder") or "").strip():
        try:
            intake_svc.validate_unsorted_folder(db, body["unsorted_folder"])
        except ValueError as exc:
            raise HTTPException(400, str(exc))
    return intake_svc.set_intake_config(
        new_creator_base=body.get("new_creator_base"),
        unsorted_folder=body.get("unsorted_folder"),
        extract_archives=body.get("extract_archives"),
        archive_after=body.get("archive_after"),
        funscript_dest=body.get("funscript_dest"),
    )

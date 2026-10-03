"""Durable Task Q orchestration for versioned Foundation catalogue refreshes."""
from __future__ import annotations

import re
from threading import RLock
from datetime import datetime
from uuid import uuid4

from sqlalchemy import func

from database import SessionLocal
from models import TCGFoundationRefreshJob, TCGRelease, TCGSetupState
from services import task_queue


class RefreshCancelled(Exception):
    pass


_enqueue_lock = RLock()


def _job_state(job_id: str) -> dict:
    db = SessionLocal()
    try:
        job = db.get(TCGFoundationRefreshJob, job_id)
        if not job:
            return {"running": False, "status": "failed", "message": "Catalogue task record is missing"}
        return {
            "running": job.status in ("queued", "running"), "status": job.status,
            "phase": job.phase, "progress": job.progress, "total": job.total,
            "message": job.message, "job_id": job.id,
        }
    finally:
        db.close()


def _cancel(job_id: str) -> None:
    db = SessionLocal()
    try:
        job = db.get(TCGFoundationRefreshJob, job_id)
        if job and job.status in ("queued", "running"):
            job.status = "cancel_requested"
            job.message = "Cancellation requested; stopping before snapshot publication"
            db.commit()
    finally:
        db.close()


def _progress(job_id: str, *, phase: str, progress: int, total: int, message: str) -> None:
    db = SessionLocal()
    try:
        job = db.get(TCGFoundationRefreshJob, job_id)
        if not job:
            raise RuntimeError("Durable catalogue task record is missing")
        if job.status == "cancel_requested":
            raise RefreshCancelled("Catalogue refresh cancelled before publication")
        job.phase = phase
        job.progress = int(progress)
        job.total = int(total)
        job.message = message
        db.commit()
    finally:
        db.close()


def _run(job_id: str) -> None:
    db = SessionLocal()
    try:
        job = db.get(TCGFoundationRefreshJob, job_id)
        if not job:
            raise RuntimeError("Durable catalogue task record is missing")
        if job.status == "cancel_requested":
            job.status = "cancelled"
            job.phase = "cancelled"
            job.message = "Catalogue refresh cancelled; the active snapshot was not changed"
            job.finished_at = datetime.utcnow()
            db.commit()
            return
        job.status = "running"
        if job.phase in ("queued", "recovery"):
            job.phase = "generating"
        job.started_at = job.started_at or datetime.utcnow()
        job.message = "Scanning curated sources and generating a complete staged snapshot"
        db.commit()
        from services.foundation_catalog import build_foundation_catalog
        build_foundation_catalog(db, refresh_job=job, progress_fn=lambda **state: _progress(job_id, **state))
    except RefreshCancelled as exc:
        db.rollback()
        job = db.get(TCGFoundationRefreshJob, job_id)
        if job:
            job.status = "cancelled"
            job.phase = "cancelled"
            job.message = str(exc)
            job.finished_at = datetime.utcnow()
            db.commit()
    except Exception as exc:
        db.rollback()
        job = db.get(TCGFoundationRefreshJob, job_id)
        if job:
            job.status = "failed"
            job.phase = "failed"
            job.error = str(exc)
            job.message = f"Refresh stopped safely: {exc}"
            job.finished_at = datetime.utcnow()
            db.commit()
        raise
    finally:
        db.close()


def _descriptor(job_id: str) -> dict:
    return {
        "id": job_id,
        "start_fn": lambda: task_queue.launch_background(_run, job_id),
        "poll_fn": lambda: _job_state(job_id),
        "cancel_fn": lambda: _cancel(job_id),
    }


def enqueue_refresh(db) -> dict:
    # Sequence allocation and reservation are one process-local critical
    # section: two quick requests must not reserve the same unique codes.
    with _enqueue_lock:
        return _enqueue_refresh(db)


def _enqueue_refresh(db) -> dict:
    state = db.query(TCGSetupState).filter(TCGSetupState.id == 1).first()
    if not state or not state.v2_enabled:
        raise ValueError("Start the card collection and publish its first Foundation catalogue before refreshing it")
    active = db.get(TCGRelease, state.active_foundation_release_id) if state.active_foundation_release_id else None
    # Older ready installations predate the active snapshot pointer. Adopt
    # their currently published Foundation release when the first refresh is
    # explicitly requested, without changing any card or checklist rows.
    if not active or active.status != "published" or active.release_kind != "foundation":
        active = db.query(TCGRelease).filter(
            TCGRelease.code == "FND-CORE", TCGRelease.status == "published",
            TCGRelease.release_kind == "foundation",
        ).first()
        if active:
            state.active_foundation_release_id = active.id
    if not active or active.status != "published" or active.release_kind != "foundation":
        raise ValueError("The active Foundation snapshot is unavailable")
    existing = db.query(TCGFoundationRefreshJob).filter(
        TCGFoundationRefreshJob.status.in_(("queued", "running", "cancel_requested")),
    ).order_by(TCGFoundationRefreshJob.created_at.desc()).first()
    if existing:
        return {"queued": True, "job_id": existing.id, "status": existing.status, "existing": True}

    catalog_numbers = [int(match.group(1)) for row in db.query(TCGRelease.generation_seed).filter(
        TCGRelease.release_kind == "foundation",
    ).all() if (match := re.fullmatch(r"catalog:FND-(\d+)", row[0] or ""))]
    catalog_numbers.extend(int(match.group(1)) for row in db.query(TCGFoundationRefreshJob.catalog_code).all()
                           if (match := re.fullmatch(r"FND-(\d+)", row[0] or "")))
    active_number = max(catalog_numbers or [1])
    next_number = active_number + 1
    release_numbers = [int(match.group(1)) for row in db.query(TCGRelease.code).filter(
        TCGRelease.code.like("FND-CORE-R%"),
    ).all() if (match := re.fullmatch(r"FND-CORE-R(\d+)", row[0] or ""))]
    release_numbers.extend(int(match.group(1)) for row in db.query(TCGFoundationRefreshJob.release_code).all()
                           if (match := re.fullmatch(r"FND-CORE-R(\d+)", row[0] or "")))
    release_number = max(release_numbers or [1]) + 1
    job_id = str(uuid4())
    job = TCGFoundationRefreshJob(
        id=job_id, status="queued", phase="queued", progress=0, total=0,
        message="Waiting in Task Q", catalog_code=f"FND-{next_number:03d}",
        release_code=f"FND-CORE-R{release_number:04d}",
    )
    db.add(job)
    db.commit()
    task_queue.submit(
        "foundation_refresh", "Restore card catalogue",
        start_fn=_descriptor(job_id)["start_fn"], poll_fn=_descriptor(job_id)["poll_fn"],
        cancel_fn=_descriptor(job_id)["cancel_fn"], task_id=job_id,
    )
    return {"queued": True, "job_id": job_id, "status": "queued", "catalog_code": job.catalog_code,
            "release_code": job.release_code}


def recoverable_tasks() -> list[dict]:
    db = SessionLocal()
    try:
        jobs = db.query(TCGFoundationRefreshJob).filter(
            TCGFoundationRefreshJob.status.in_(("queued", "running", "cancel_requested")),
        ).all()
        results = []
        for job in jobs:
            if job.status == "cancel_requested":
                job.status = "cancelled"
                job.phase = "cancelled"
                job.message = "Catalogue refresh cancelled; the prior active snapshot remains available"
                job.finished_at = datetime.utcnow()
                continue
            elif job.status == "running":
                job.status = "queued"
                job.message = "Resuming after application restart; active catalogue is unchanged"
            results.append(_descriptor(job.id))
        db.commit()
        return results
    finally:
        db.close()


def persisted_task_history() -> list[dict]:
    db = SessionLocal()
    try:
        jobs = db.query(TCGFoundationRefreshJob).filter(
            TCGFoundationRefreshJob.status.in_(("done", "failed", "cancelled")),
        ).order_by(TCGFoundationRefreshJob.finished_at.desc()).limit(50).all()
        return [{
            "id": job.id, "type": "foundation_refresh", "label": "Restore card catalogue",
            "status": job.status, "progress": job.progress, "total": job.total,
            "message": job.message, "detail": {"phase": job.phase, "catalog_code": job.catalog_code,
                                               "release_code": job.release_code, "error": job.error},
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "finished_at": job.finished_at.isoformat() if job.finished_at else None,
        } for job in jobs]
    finally:
        db.close()


def mark_removed_from_queue(job_id: str) -> None:
    """A user-removed queued task must not remain orphaned as queued in SQLite."""
    db = SessionLocal()
    try:
        job = db.get(TCGFoundationRefreshJob, job_id)
        if job and job.status == "queued":
            job.status = "cancelled"
            job.phase = "cancelled"
            job.message = "Removed from Task Q; the active catalogue was not changed"
            job.finished_at = datetime.utcnow()
            db.commit()
    finally:
        db.close()

"""Card foil masks — model readiness, backfill, and per-image regeneration."""
import os
import threading

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from database import get_db, SessionLocal
from models import Image
from services import masking, task_queue

router = APIRouter()


def _db_factory():
    return SessionLocal()


@router.get("/status")
def status(db: Session = Depends(get_db)):
    """Readiness + how much of the card-backed library is covered."""
    total = len(masking.card_source_image_ids(db))
    done = (db.query(Image)
              .filter(Image.mask_path.isnot(None), Image.is_video == False)  # noqa: E712
              .count())
    usable = (db.query(Image)
                .filter(Image.mask_quality >= masking.MIN_QUALITY)
                .count())
    return {
        "model_ready": masking.is_ready(),
        "card_source_images": total,
        "masked": done,
        "usable": usable,
        "min_quality": masking.MIN_QUALITY,
        **masking.get_state(),
    }


@router.get("/channels/{image_id}/{channel}")
def channel(image_id: int, channel: str, db: Session = Depends(get_db)):
    """Expose one packed mask channel without changing the cached mask file."""
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image or not image.mask_path or not os.path.isfile(image.mask_path):
        raise HTTPException(404, "Mask not found")
    try:
        content = masking.mask_channel_png(image.mask_path, channel)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return Response(
        content=content,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.post("/download-model")
def download_model():
    if masking.is_ready():
        return {"ready": True, "already": True}
    threading.Thread(target=masking.download_model, daemon=True).start()
    return {"ready": False, "downloading": True}


@router.post("/backfill")
def backfill(only_cards: bool = True, force: bool = False):
    """Mask every image that backs a card and doesn't have one yet.

    `only_cards=False` would sweep the whole library — available, but almost
    never what you want: masks are only ever read through a card.
    """
    if masking.get_state()["running"]:
        raise HTTPException(409, "A mask backfill is already running")
    task_queue.submit(
        'mask_backfill', 'Generate card foil masks',
        start_fn=lambda: threading.Thread(
            target=masking.backfill_thread,
            args=(_db_factory,), kwargs={"only_cards": only_cards, "force": force},
            daemon=True
        ).start(),
        poll_fn=masking.get_state,
        cancel_fn=masking.cancel,
    )
    return {"queued": True}


@router.post("/cancel")
def cancel():
    masking.cancel()
    task_queue.cancel_current()
    return {"cancelled": True}


@router.post("/image/{image_id}")
def regenerate(image_id: int, db: Session = Depends(get_db)):
    """Force one image's mask — the escape hatch when a chase card mattes badly."""
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")
    info = masking.ensure_mask(db, img, force=True)
    if info is None:
        raise HTTPException(400, "Cannot mask this image (video, or file missing)")
    db.commit()
    return info

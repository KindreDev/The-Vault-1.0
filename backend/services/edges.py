"""
Edge tracking — the stat behind Edge Mode.

An "edge" is one moment where the device cut or slowed itself. Every image on
screen at that moment is credited +1 (a multi-panel wall genuinely was all being
looked at), but the event itself counts once toward XP and the lifetime total —
otherwise panel count would be an XP multiplier.

Counts are lifetime and never reset, matching cum_count.
"""
from sqlalchemy.orm import Session

from models import Image, Gallery
import services.gamification as gami


def log_edge(db: Session, image_ids: list[int]) -> dict:
    """Credit one edge event to every supplied image (and their galleries).

    Returns the new per-image counts plus the XP awarded for the event.
    """
    # De-duplicate: the same image can legitimately be open in two panels, and
    # it should still only get +1 for a single edge.
    unique_ids = list({int(i) for i in image_ids if i})

    images = (
        db.query(Image).filter(Image.id.in_(unique_ids)).all()
        if unique_ids else []
    )

    gallery_ids: set[int] = set()
    for img in images:
        img.edge_count = (img.edge_count or 0) + 1
        if img.gallery_id:
            gallery_ids.add(img.gallery_id)

    # One bump per gallery even when several of its images were on screen —
    # the gallery was edged to once.
    if gallery_ids:
        for gal in db.query(Gallery).filter(Gallery.id.in_(gallery_ids)).all():
            gal.edge_count = (gal.edge_count or 0) + 1

    db.commit()

    # XP is awarded for the event, not per image. Fires even when nothing was on
    # screen — the edge still happened.
    xp = gami.notify_action(db, "edge_logged")

    return {
        "counts": {img.id: img.edge_count for img in images},
        "images_credited": len(images),
        "xp": xp,
    }

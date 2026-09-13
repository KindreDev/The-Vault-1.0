"""Event-driven automatic creator avatar selection.

The database is the candidate index; this module never walks library folders.
Existing image files are referenced in place, so filling an avatar creates no
duplicate media and costs only a small indexed query per blank creator.
"""

import os
from typing import Iterable, Optional

from sqlalchemy import case, select, union
from sqlalchemy.orm import Session

from models import Creator, Gallery, Image, gallery_creators, image_creators


def _candidate_ids(creator_id: int):
    """All images explicitly or gallery-level linked to a creator."""
    return union(
        select(image_creators.c.image_id).where(image_creators.c.creator_id == creator_id),
        select(Image.id)
        .join(gallery_creators, gallery_creators.c.gallery_id == Image.gallery_id)
        .where(gallery_creators.c.creator_id == creator_id),
        select(Image.id)
        .join(Gallery, Gallery.id == Image.gallery_id)
        .where(Gallery.creator_id == creator_id),
    ).subquery()


def assign_if_missing(db: Session, creator_id: int) -> Optional[str]:
    """Choose one good existing source for a blank creator. Does not commit."""
    creator = db.query(Creator).filter(Creator.id == creator_id).first()
    if not creator or creator.avatar_path:
        return creator.avatar_path if creator else None

    eligible = _candidate_ids(creator_id)
    candidates = (
        db.query(Image)
        .filter(Image.id.in_(select(eligible.c.image_id)))
        .filter(Image.thumb_path.isnot(None))
        .order_by(
            Image.is_video.asc(),
            case((Image.height > Image.width, 0), else_=1),
            Image.rating.desc(),
            Image.id.asc(),
        )
        .limit(50)
        .all()
    )

    for image in candidates:
        if not image.is_video and image.file_path and os.path.isfile(image.file_path):
            creator.avatar_path = image.file_path
            db.flush()
            return creator.avatar_path
        if image.thumb_path and os.path.isfile(image.thumb_path):
            creator.avatar_path = image.thumb_path
            db.flush()
            return creator.avatar_path
    return None


def backfill_missing(
    db: Session,
    creator_ids: Optional[Iterable[int]] = None,
    *,
    commit: bool = True,
) -> int:
    """Fill current blanks once; callers decide when to run and commit."""
    query = db.query(Creator.id).filter(Creator.avatar_path.is_(None))
    if creator_ids is not None:
        ids = {int(value) for value in creator_ids}
        if not ids:
            return 0
        query = query.filter(Creator.id.in_(ids))

    filled = sum(1 for (creator_id,) in query.all() if assign_if_missing(db, creator_id))
    if filled and commit:
        db.commit()
    return filled

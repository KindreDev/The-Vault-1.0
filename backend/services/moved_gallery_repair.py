"""Repair galleries split in two by a library move.

Before the scanner could follow folders across library roots, moving a library
to a new drive or directory created a new gallery for every folder, moved the
files into it, and left the old gallery (with its creators, ratings, period,
history and cards) behind as "missing".

This finds each old gallery whose folder is gone and whose relative path now
exists under another location, then folds the new duplicate into the old
gallery. The old gallery keeps its id, so everything that references it stays
attached; it simply moves to the new folder.
"""

import os
from datetime import datetime

from sqlalchemy import update
from sqlalchemy.orm import Session

from models import (
    ActivityEvent, Card, FeedPost, Gallery, HofCategoryAward, Image, LibraryRoot,
    PanelPlaylistEntry, SessionLog,
)
from services.gallery_deletion import delete_gallery_record, detach_image_references
from services.gallery_merge import _merge_metadata


def _segments(path: str) -> list[str]:
    drive, rest = os.path.splitdrive(os.path.normcase(os.path.normpath(path)))
    return [part for part in rest.split(os.sep) if part]


def find_moved_gallery_matches(db: Session) -> list[dict]:
    roots = {root.id: root.path for root in db.query(LibraryRoot).all()}
    root_online = {root_id: bool(path and os.path.isdir(path)) for root_id, path in roots.items()}

    gone, present = [], []
    for gallery in (db.query(Gallery)
                    .filter(Gallery.is_mix == False, Gallery.folder_path.isnot(None))  # noqa: E712
                    .all()):
        folder = gallery.folder_path
        if not folder or folder.startswith("__"):
            continue
        if root_online.get(gallery.library_root_id) is False or not os.path.isdir(folder):
            gone.append(gallery)
        else:
            present.append(gallery)

    # Present galleries indexed by their last two folder names.
    by_tail: dict = {}
    for gallery in present:
        parts = _segments(gallery.folder_path)
        by_tail.setdefault(tuple(parts[-2:]), []).append((parts, gallery))

    matches, targets = [], {}
    for old in gone:
        parts = _segments(old.folder_path)
        root_path = roots.get(old.library_root_id)
        if root_path:
            root_parts = _segments(root_path)
            if parts[:len(root_parts)] == root_parts:
                parts = parts[len(root_parts):]
        if not parts:
            continue
        candidates = [
            gallery for new_parts, gallery in by_tail.get(tuple(parts[-2:]), [])
            if new_parts[-len(parts):] == parts and gallery.id > old.id
        ]
        if len(candidates) != 1:
            continue  # nothing there, or ambiguous: leave for manual relinking
        new = candidates[0]
        targets.setdefault(new.id, []).append(old.id)
        matches.append({
            "old_id": old.id, "old_name": old.name, "old_path": old.folder_path,
            "new_id": new.id, "new_path": new.folder_path,
            "image_count": new.image_count or 0,
        })
    # A new gallery claimed by two old ones is ambiguous; skip both.
    return [match for match in matches if len(targets[match["new_id"]]) == 1]


def _absorb(db: Session, old: Gallery, new: Gallery) -> None:
    leftovers = {(image.filename or "").lower(): image
                 for image in db.query(Image).filter(Image.gallery_id == old.id).all()}
    for image in db.query(Image).filter(Image.gallery_id == new.id).all():
        previous = leftovers.pop((image.filename or "").lower(), None)
        if previous is None:
            image.gallery_id = old.id
            continue
        # The old row carries the history; give it the new file and retire
        # the duplicate row the scan created.
        path, thumb = image.file_path, image.thumb_path
        funscript, modified = image.funscript_path, image.file_modified_at
        detach_image_references(db, [image.id])
        db.delete(image)
        db.flush()
        previous.file_path = path
        if not (previous.thumb_path and os.path.exists(previous.thumb_path)):
            previous.thumb_path = thumb
        previous.funscript_path = funscript
        previous.file_modified_at = modified
    # Rows whose file did not reappear anywhere in the new folder are stale.
    stale = list(leftovers.values())
    if stale:
        detach_image_references(db, [image.id for image in stale])
        for image in stale:
            db.delete(image)
    db.flush()

    # Anything recorded against the new gallery since the move follows it.
    for model, column in ((SessionLog, SessionLog.gallery_id), (ActivityEvent, ActivityEvent.gallery_id),
                          (Card, Card.source_gallery_id), (HofCategoryAward, HofCategoryAward.gallery_id),
                          (FeedPost, FeedPost.gallery_id)):
        db.execute(update(model).where(column == new.id).values({column.key: old.id}))
    db.execute(update(PanelPlaylistEntry)
               .where(PanelPlaylistEntry.entry_type == "gallery", PanelPlaylistEntry.ref_id == new.id)
               .values(ref_id=old.id))

    _merge_metadata(old, new)
    old.view_count = (old.view_count or 0) + (new.view_count or 0)
    old.cum_count = (old.cum_count or 0) + (new.cum_count or 0)
    old.edge_count = (old.edge_count or 0) + (new.edge_count or 0)
    old.is_favorite = bool(old.is_favorite or new.is_favorite)
    if not old.cover_thumb:
        old.cover_thumb = new.cover_thumb
    new_path, new_root = new.folder_path, new.library_root_id

    delete_gallery_record(db, new)
    db.flush()

    old.folder_path = new_path
    old.name = os.path.basename(new_path) or old.name
    old.library_root_id = new_root
    old.is_missing = False
    old.missing_since = None
    old.scanned_at = datetime.utcnow()
    old.image_count = db.query(Image).filter(Image.gallery_id == old.id).count()
    db.flush()


def repair_moved_galleries(db: Session) -> dict:
    """Apply every confident match. Each gallery commits on its own so one
    failure never undoes the rest."""
    repaired = failed = 0
    for match in find_moved_gallery_matches(db):
        old, new = db.get(Gallery, match["old_id"]), db.get(Gallery, match["new_id"])
        if not old or not new:
            continue
        try:
            _absorb(db, old, new)
            db.commit()
            repaired += 1
        except Exception:
            db.rollback()
            failed += 1
    return {"repaired": repaired, "failed": failed}

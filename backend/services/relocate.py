"""
Moving galleries and files to a different place on disk.

This is the one service that changes the user's filesystem, so it is written to
be boring and inspectable:

  * plan_* functions only read. They report where things are, where they would
    go, and what would collide. Nothing moves until a move_* call.
  * every move is checked for collisions first and answers the caller's chosen
    strategy (merge / rename / skip) rather than guessing.
  * "folder = gallery" is preserved: moving a gallery moves its whole folder and
    updates folder_path. Loose files always land in a real target gallery's
    folder, never loose in a creator root.
"""
import os
import shutil

from sqlalchemy.orm import Session

from models import Gallery, Image, Creator


def _norm(p):
    return os.path.normpath(p).rstrip("\\/") if p else p


def _within(path: str, root: str) -> bool:
    """Is `path` the folder `root`, or somewhere inside it?

    The equality case matters: a creator's own root folder is usually a gallery
    in its own right, and it is emphatically not 'misplaced' — without this it
    would be recommended for a move into itself.
    """
    if not path or not root:
        return False
    p, r = path.lower(), root.lower()
    return p == r or p.startswith(r + os.sep)


def _is_real(gallery) -> bool:
    return bool(gallery.folder_path) and not gallery.folder_path.startswith("__")


def main_creator(db: Session, gallery: Gallery):
    """The creator a gallery 'belongs' to — the first one linked."""
    if gallery.creators:
        return gallery.creators[0]
    if gallery.creator_id:
        return db.query(Creator).filter(Creator.id == gallery.creator_id).first()
    return None


def suggest_destinations(db: Session, gallery_ids: list) -> dict:
    """Where these galleries could go, and whether they look misfiled.

    A gallery is 'misplaced' when it sits outside its main creator's folder —
    that is the case worth recommending a move for.
    """
    galleries = db.query(Gallery).filter(Gallery.id.in_(gallery_ids)).all()
    items, suggested = [], {}

    for g in galleries:
        creator = main_creator(db, g)
        home = _norm(creator.source_folder) if creator and creator.source_folder else None
        cur = _norm(g.folder_path)
        inside = _within(cur, home)
        items.append({
            "id": g.id, "name": g.name, "folder_path": g.folder_path,
            "is_real_folder": _is_real(g),
            "creator_id": creator.id if creator else None,
            "creator_name": creator.name if creator else None,
            "creator_folder": home,
            "already_in_creator_folder": inside,
            "misplaced": bool(home) and not inside,
        })
        if home and not inside:
            suggested[home] = suggested.get(home, 0) + 1

    # Every creator with a folder is offerable as a target, not just the main one.
    creators = (
        db.query(Creator)
          .filter(Creator.source_folder.isnot(None), Creator.source_folder != "")
          .order_by(Creator.name)
          .all()
    )
    return {
        "items": items,
        "misplaced_count": sum(1 for i in items if i["misplaced"]),
        "recommended": max(suggested, key=suggested.get) if suggested else None,
        "creator_folders": [
            {"id": c.id, "name": c.name, "folder": _norm(c.source_folder)} for c in creators
        ],
    }


def plan_gallery_move(db: Session, gallery_ids: list, dest_root: str) -> dict:
    """Dry run: what each gallery would become, and which names already exist."""
    dest_root = _norm(dest_root)
    plans = []
    for g in db.query(Gallery).filter(Gallery.id.in_(gallery_ids)).all():
        if not _is_real(g):
            plans.append({"id": g.id, "name": g.name, "status": "skip",
                          "reason": "not a real folder on disk"})
            continue
        src = _norm(g.folder_path)
        if _within(dest_root, src):
            # Includes dest_root == src. Moving a folder inside itself would
            # recurse the folder into oblivion, so it is never offered.
            plans.append({"id": g.id, "name": g.name, "status": "skip",
                          "reason": "that's inside this folder already", "source": src})
            continue
        target = os.path.join(dest_root, os.path.basename(src))
        if _norm(target).lower() == src.lower():
            plans.append({"id": g.id, "name": g.name, "status": "skip",
                          "reason": "already there", "target": target})
            continue
        # A clash is a real folder already sitting at the destination; the caller
        # decides merge / rename / skip rather than this guessing.
        clash = os.path.exists(target)
        existing = db.query(Gallery).filter(Gallery.folder_path.ilike(target)).first() if clash else None
        plans.append({
            "id": g.id, "name": g.name, "source": src, "target": target,
            "status": "clash" if clash else "ok",
            "target_exists": clash,
            "existing_gallery_id": (existing.id if existing else None),
        })
    return {"dest_root": dest_root, "plans": plans,
            "clashes": sum(1 for p in plans if p["status"] == "clash")}


def _unique_dir(path: str) -> str:
    """'X' -> 'X (2)' -> 'X (3)' … for the rename strategy."""
    if not os.path.exists(path):
        return path
    n = 2
    while os.path.exists(f"{path} ({n})"):
        n += 1
    return f"{path} ({n})"


def move_galleries(db: Session, gallery_ids: list, dest_root: str,
                   strategy: str = "rename") -> dict:
    """Move whole gallery folders under dest_root.

    strategy applies only when the destination name already exists:
      rename — move alongside as "Name (2)"
      merge  — move the files into the existing folder and delete the now-empty
               source gallery row
      skip   — leave it where it is
    """
    dest_root = _norm(dest_root)
    os.makedirs(dest_root, exist_ok=True)

    moved, skipped, merged, errors = 0, 0, 0, []
    for g in db.query(Gallery).filter(Gallery.id.in_(gallery_ids)).all():
        if not _is_real(g):
            skipped += 1
            continue
        src = _norm(g.folder_path)
        if not os.path.isdir(src):
            errors.append({"id": g.id, "name": g.name, "error": "source folder is missing"})
            continue
        if _within(dest_root, src):
            # Never move a folder into itself or its own subtree.
            skipped += 1
            continue
        target = os.path.join(dest_root, os.path.basename(src))
        if _norm(target).lower() == src.lower():
            skipped += 1
            continue

        try:
            if os.path.exists(target):
                if strategy == "skip":
                    skipped += 1
                    continue
                if strategy == "merge":
                    _merge_into(db, g, src, target)
                    merged += 1
                    continue
                target = _unique_dir(target)

            shutil.move(src, target)
            _repoint(db, g, src, target)
            moved += 1
        except Exception as e:      # noqa: BLE001 — surfaced to the user per gallery
            errors.append({"id": g.id, "name": g.name, "error": str(e)})

    db.commit()
    return {"moved": moved, "merged": merged, "skipped": skipped, "errors": errors}


def _repoint(db: Session, gallery: Gallery, old_root: str, new_root: str):
    """Update the gallery and every image path after its folder moved."""
    gallery.folder_path = new_root
    for img in db.query(Image).filter(Image.gallery_id == gallery.id).all():
        if img.file_path and _norm(img.file_path).lower().startswith(old_root.lower()):
            img.file_path = os.path.join(new_root, os.path.relpath(_norm(img.file_path), old_root))
        if img.funscript_path and _norm(img.funscript_path).lower().startswith(old_root.lower()):
            img.funscript_path = os.path.join(
                new_root, os.path.relpath(_norm(img.funscript_path), old_root))


def _merge_into(db: Session, gallery: Gallery, src: str, target: str):
    """Pour a gallery's files into an existing folder, then retire it.

    The destination folder is itself a gallery (folder = gallery), so the rows
    are re-parented to it and the emptied source gallery is deleted.
    """
    dest_gallery = (
        db.query(Gallery)
          .filter(Gallery.folder_path.ilike(target))
          .first()
    )
    for name in os.listdir(src):
        s, d = os.path.join(src, name), os.path.join(target, name)
        if os.path.exists(d):
            base, ext = os.path.splitext(name)
            n = 2
            while os.path.exists(os.path.join(target, f"{base} ({n}){ext}")):
                n += 1
            d = os.path.join(target, f"{base} ({n}){ext}")
        shutil.move(s, d)

    imgs = db.query(Image).filter(Image.gallery_id == gallery.id).all()
    for img in imgs:
        if img.file_path:
            img.file_path = os.path.join(target, os.path.basename(img.file_path))
        if img.funscript_path:
            img.funscript_path = os.path.join(target, os.path.basename(img.funscript_path))
        if dest_gallery:
            img.gallery_id = dest_gallery.id

    if dest_gallery:
        db.flush()
        dest_gallery.image_count = db.query(Image).filter(
            Image.gallery_id == dest_gallery.id).count()
        db.delete(gallery)
    else:
        # No gallery row for the destination yet — just repoint this one at it.
        gallery.folder_path = target

    try:
        os.rmdir(src)
    except OSError:
        pass    # something non-media left behind; harmless


def _thumb_url(img) -> str:
    return f"/thumbs/{os.path.basename(img.thumb_path)}" if img.thumb_path else None


def _refresh_cover(db: Session, gallery, lost_urls: set):
    """Give a gallery a cover if it lost the one it had.

    A gallery whose cover image just moved out would otherwise keep showing a
    thumbnail for a file it no longer contains.
    """
    if gallery.cover_thumb and gallery.cover_thumb not in lost_urls:
        return
    replacement = (
        db.query(Image)
          .filter(Image.gallery_id == gallery.id, Image.thumb_path.isnot(None))
          .order_by(Image.is_video.asc(), Image.sort_order, Image.id)
          .first()
    )
    if replacement and replacement.thumb_path and os.path.exists(replacement.thumb_path):
        gallery.cover_thumb = _thumb_url(replacement)
    else:
        gallery.cover_thumb = None


def move_images(db: Session, image_ids: list, target_gallery_id: int) -> dict:
    """Move loose files into an existing gallery's folder.

    Files always land in a real gallery rather than loose in a creator root, so
    'folder = gallery' still holds and the moved files have an owner.
    """
    dest = db.query(Gallery).filter(Gallery.id == target_gallery_id).first()
    if not dest or not _is_real(dest):
        return {"error": "target gallery has no real folder"}
    if dest.is_mix:
        # A mix gallery is virtual — it has no folder of its own to move files
        # into, and the scanner would prune anything parked there.
        return {"error": "that's a mix gallery — it isn't a folder on disk"}
    dest_dir = _norm(dest.folder_path)
    os.makedirs(dest_dir, exist_ok=True)

    moved, skipped, errors = 0, 0, []
    sources, departed_covers = set(), set()
    for img in db.query(Image).filter(Image.id.in_(image_ids)).all():
        sources.add(img.gallery_id)
        departed_covers.add(_thumb_url(img))
        if not img.file_path or not os.path.isfile(img.file_path):
            errors.append({"id": img.id, "name": img.filename, "error": "file is missing"})
            continue
        if _norm(os.path.dirname(img.file_path)).lower() == dest_dir.lower():
            skipped += 1
            continue
        try:
            name = os.path.basename(img.file_path)
            d = os.path.join(dest_dir, name)
            if os.path.exists(d):
                base, ext = os.path.splitext(name)
                n = 2
                while os.path.exists(os.path.join(dest_dir, f"{base} ({n}){ext}")):
                    n += 1
                d = os.path.join(dest_dir, f"{base} ({n}){ext}")
            shutil.move(img.file_path, d)

            # A funscript belongs beside its video — move it too or the link breaks.
            if img.funscript_path and os.path.isfile(img.funscript_path):
                fs_target = os.path.splitext(d)[0] + ".funscript"
                shutil.move(img.funscript_path, fs_target)
                img.funscript_path = fs_target

            img.file_path = d
            img.filename = os.path.basename(d)
            img.gallery_id = dest.id
            moved += 1
        except Exception as e:      # noqa: BLE001
            errors.append({"id": img.id, "name": img.filename, "error": str(e)})

    # The re-parented rows are already flushed into this count — don't add
    # `moved` on top of it. The galleries they left need recounting too, or
    # their card keeps advertising files that aren't there any more.
    db.flush()
    for gid in sources | {dest.id}:
        if not gid:
            continue
        g = db.query(Gallery).filter(Gallery.id == gid).first()
        if g:
            g.image_count = db.query(Image).filter(Image.gallery_id == gid).count()
            _refresh_cover(db, g, departed_covers)
    # A target with no cover of its own adopts one from what just arrived.
    if not dest.cover_thumb:
        _refresh_cover(db, dest, set())
    db.commit()
    return {"moved": moved, "skipped": skipped, "errors": errors,
            "target_gallery": {"id": dest.id, "name": dest.name}}

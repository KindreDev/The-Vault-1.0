"""Filesystem-safe gallery merging.

Gallery merges are deliberately kept in one service because the Vault has
several entry points that can pour one folder into another.  The important
invariant is simple: when files are moved, every successful database
reassignment must correspond to exactly one file that was moved, and a
replace collision must retire the old database row as well as its file.
"""

from __future__ import annotations

import logging
import hashlib
import os
import shutil
import uuid

from sqlalchemy.orm import Session, selectinload

from models import Gallery, Image
from services.file_ops import remove_file
from services.gallery_deletion import delete_gallery_record, detach_image_references


log = logging.getLogger(__name__)


class GalleryMergeError(ValueError):
    """A merge could not be safely started or completed."""


def _key(path: str | None) -> str:
    if not path:
        return ""
    return os.path.normcase(os.path.abspath(os.path.normpath(path)))


def _same_path(left: str | None, right: str | None) -> bool:
    return bool(left and right and _key(left) == _key(right))


def _files_identical(left: str | None, right: str | None) -> bool:
    """Return whether two existing files have the same size and content."""
    if not left or not right or _same_path(left, right):
        return bool(left and right and os.path.isfile(left) and os.path.isfile(right))
    try:
        if not os.path.isfile(left) or not os.path.isfile(right):
            return False
        if os.path.getsize(left) != os.path.getsize(right):
            return False
        left_hash = hashlib.sha256()
        right_hash = hashlib.sha256()
        with open(left, "rb") as left_file, open(right, "rb") as right_file:
            while True:
                left_chunk = left_file.read(1024 * 1024)
                right_chunk = right_file.read(1024 * 1024)
                if not left_chunk and not right_chunk:
                    break
                left_hash.update(left_chunk)
                right_hash.update(right_chunk)
        return left_hash.digest() == right_hash.digest()
    except OSError:
        return False


def _unique_path(folder: str, filename: str, reserved: set[str]) -> str:
    base, ext = os.path.splitext(filename)
    counter = 1
    candidate = os.path.join(folder, filename)
    while _key(candidate) in reserved or os.path.lexists(candidate):
        candidate = os.path.join(folder, f"{base}_{counter}{ext}")
        counter += 1
    return candidate


def move_file(source: str, destination: str) -> None:
    """Move one file and prove that the source no longer exists.

    ``os.replace`` gives us a true rename on the normal same-volume case.
    ``shutil.move`` is retained as the cross-volume fallback, but its
    copy-then-remove behavior is only accepted if the source is gone after it
    returns.  This prevents a merge from silently becoming a copy operation.
    """
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    try:
        os.replace(source, destination)
    except OSError:
        shutil.move(source, destination)
        if os.path.lexists(source):
            raise OSError(f"Move left the source file in place: {source}")


def _backup_existing(
    path: str,
    backups: list[tuple[str, str]],
    backup_folder: str | None = None,
) -> None:
    if not os.path.lexists(path):
        return
    backup_folder = backup_folder or os.path.dirname(path)
    backup = os.path.join(
        backup_folder,
        f".vault-merge-backup-{uuid.uuid4().hex}-{os.path.basename(path)}",
    )
    move_file(path, backup)
    backups.append((backup, path))


def _restore_operation(
    moved: list[tuple[str, str]],
    backups: list[tuple[str, str]],
) -> None:
    """Best-effort filesystem rollback after a database or move failure."""
    for source, destination in reversed(moved):
        if os.path.lexists(destination) and not os.path.lexists(source):
            try:
                move_file(destination, source)
            except Exception:
                log.exception("Could not roll back merge move %s -> %s", destination, source)
    for backup, original in reversed(backups):
        if os.path.lexists(backup) and not os.path.lexists(original):
            try:
                move_file(backup, original)
            except Exception:
                log.exception("Could not restore merge backup %s -> %s", backup, original)


def _remove_after_commit(paths: list[str | None]) -> None:
    for path in paths:
        if not path:
            continue
        try:
            remove_file(path)
        except OSError:
            # Derived caches and retired sidecars are disposable.  The media
            # and database operation has already completed successfully.
            pass


def _folder_is_empty(path: str | None) -> bool:
    if not path or not os.path.lexists(path):
        return True
    if not os.path.isdir(path):
        return False
    try:
        return not os.listdir(path)
    except OSError:
        return False


def _merge_metadata(target: Gallery, source: Gallery) -> None:
    """Union source creators/tags while keeping the target identity."""
    target_creator_ids = {creator.id for creator in target.creators}
    for creator in source.creators:
        if creator.id not in target_creator_ids:
            target.creators.append(creator)
            target_creator_ids.add(creator.id)
    if target.creator_id is None:
        target.creator_id = source.creator_id or next(iter(target_creator_ids), None)
    target.is_tagged = bool(target.is_tagged or source.is_tagged or target.creators)

    target_tag_ids = {tag.id for tag in target.tags}
    for tag in source.tags:
        if tag.id not in target_tag_ids:
            target.tags.append(tag)
            target_tag_ids.add(tag.id)


def _retire_conflicting_image(
    db: Session,
    image: Image | None,
    cleanup: list[str | None],
) -> None:
    if image is None:
        return
    cleanup.extend((image.thumb_path, image.preview_path, image.mask_path))
    detach_image_references(db, [image.id])
    db.delete(image)
    db.flush()


def merge_gallery_records(
    db: Session,
    source_id: int,
    target_id: int,
    *,
    move_files: bool = True,
    collision_strategy: str = "rename",
) -> dict:
    """Merge ``source_id`` into ``target_id`` and return an audit summary.

    ``rename`` keeps every source file, ``replace`` makes the source file win
    and retires the conflicting target row, and ``skip`` leaves the source
    row/file untouched.  Files are never copied as a successful merge.
    """
    if source_id == target_id:
        raise GalleryMergeError("Source and target gallery must be different")
    if collision_strategy not in {"rename", "replace", "skip"}:
        raise GalleryMergeError("Unknown collision strategy")

    source = (
        db.query(Gallery)
        .options(selectinload(Gallery.creators), selectinload(Gallery.tags))
        .filter(Gallery.id == source_id)
        .first()
    )
    target = (
        db.query(Gallery)
        .options(selectinload(Gallery.creators), selectinload(Gallery.tags))
        .filter(Gallery.id == target_id)
        .first()
    )
    if not source:
        raise GalleryMergeError("Source gallery not found")
    if not target:
        raise GalleryMergeError("Target gallery not found")
    if source.is_mix or target.is_mix:
        raise GalleryMergeError("Mix galleries cannot be merged as folders")

    source_folder = source.folder_path
    target_folder = target.folder_path
    if move_files:
        if not target_folder or not os.path.isdir(target_folder):
            raise GalleryMergeError("Target gallery folder is missing on disk")
        if source_folder and _same_path(source_folder, target_folder):
            raise GalleryMergeError("Source and target gallery folders are the same")

    source_images = db.query(Image).filter(Image.gallery_id == source_id).order_by(Image.id).all()
    target_images = db.query(Image).filter(Image.gallery_id == target_id).all()
    target_by_path = {_key(image.file_path): image for image in target_images if image.file_path}

    moved_files: list[tuple[str, str]] = []
    backups: list[tuple[str, str]] = []
    cleanup_after_commit: list[str | None] = []
    reserved: set[str] = set()
    errors: list[dict] = []
    moved = renamed = replaced = reconciled = skipped = db_only = 0

    try:
        for image in source_images:
            if not move_files:
                image.gallery_id = target_id
                db_only += 1
                continue

            source_path = image.file_path
            if not source_path or not os.path.isfile(source_path):
                # A previous merge may have moved the bytes successfully but
                # failed before the Image row was re-parented. Reconcile that
                # state by adopting the already-present target-side file
                # rather than reporting a skip and leaving two galleries.
                filename = os.path.basename(source_path or image.filename or "")
                existing_target_path = os.path.join(target_folder, filename) if filename else ""
                existing_target_image = target_by_path.get(_key(existing_target_path))
                if (
                    collision_strategy == "replace"
                    and existing_target_path
                    and os.path.isfile(existing_target_path)
                    and existing_target_image is None
                ):
                    image.file_path = existing_target_path
                    image.filename = os.path.basename(existing_target_path)
                    expected_funscript = os.path.splitext(existing_target_path)[0] + ".funscript"
                    if os.path.isfile(expected_funscript):
                        image.funscript_path = expected_funscript
                    image.gallery_id = target_id
                    target_by_path[_key(existing_target_path)] = image
                    reserved.add(_key(existing_target_path))
                    reconciled += 1
                    continue
                skipped += 1
                errors.append({
                    "id": image.id,
                    "name": image.filename,
                    "error": "source file is missing",
                })
                continue

            filename = os.path.basename(source_path)
            destination = os.path.join(target_folder, filename)
            destination_key = _key(destination)
            conflict_image = target_by_path.get(destination_key)
            conflict_exists = destination_key in reserved or os.path.lexists(destination) or conflict_image is not None
            was_renamed = False
            was_replaced = False
            was_reconciled = False

            if conflict_exists and destination_key in reserved:
                # Two source rows should never overwrite each other during one
                # merge, even when the selected strategy is replace.
                destination = _unique_path(target_folder, filename, reserved)
                destination_key = _key(destination)
                was_renamed = True
                conflict_image = None
            elif conflict_exists and collision_strategy == "skip":
                skipped += 1
                continue
            elif conflict_exists and collision_strategy == "rename":
                destination = _unique_path(target_folder, filename, reserved)
                destination_key = _key(destination)
                was_renamed = True
                conflict_image = None
            elif conflict_exists and collision_strategy == "replace":
                if conflict_image is not None:
                    _backup_existing(destination, backups)
                    cleanup_after_commit.extend((
                        conflict_image.thumb_path,
                        conflict_image.preview_path,
                        conflict_image.mask_path,
                    ))
                    if conflict_image.funscript_path:
                        _backup_existing(conflict_image.funscript_path, backups)
                        cleanup_after_commit.append(conflict_image.funscript_path)
                    _retire_conflicting_image(db, conflict_image, cleanup_after_commit)
                    target_by_path.pop(destination_key, None)
                elif os.path.isfile(destination) and _files_identical(source_path, destination):
                    # The source bytes are already present in the target
                    # folder, usually after a prior interrupted merge. Keep
                    # the target-side file as canonical and retire only the
                    # duplicate source path after the database commit.
                    _backup_existing(source_path, backups, target_folder)
                    was_reconciled = True
                else:
                    _backup_existing(destination, backups)
                was_replaced = not was_reconciled

            old_funscript = image.funscript_path
            new_funscript = None
            try:
                if not was_reconciled:
                    move_file(source_path, destination)
                    moved_files.append((source_path, destination))

                if old_funscript and os.path.isfile(old_funscript):
                    funscript_destination = os.path.splitext(destination)[0] + ".funscript"
                    if os.path.lexists(funscript_destination) and not _same_path(old_funscript, funscript_destination):
                        if collision_strategy == "replace" and not was_renamed:
                            if _files_identical(old_funscript, funscript_destination):
                                _backup_existing(old_funscript, backups, target_folder)
                            else:
                                _backup_existing(funscript_destination, backups)
                        else:
                            funscript_destination = _unique_path(
                                target_folder,
                                os.path.basename(funscript_destination),
                                reserved,
                            )
                    if (
                        not _same_path(old_funscript, funscript_destination)
                        and os.path.isfile(old_funscript)
                    ):
                        move_file(old_funscript, funscript_destination)
                        moved_files.append((old_funscript, funscript_destination))
                    new_funscript = funscript_destination
                elif was_reconciled:
                    expected_funscript = os.path.splitext(destination)[0] + ".funscript"
                    if os.path.isfile(expected_funscript):
                        new_funscript = expected_funscript

                image.file_path = destination
                image.filename = os.path.basename(destination)
                image.funscript_path = new_funscript
                image.gallery_id = target_id
                reserved.add(destination_key)
                moved += int(not was_reconciled)
                renamed += int(was_renamed)
                replaced += int(was_replaced)
                reconciled += int(was_reconciled)
            except Exception as exc:
                raise GalleryMergeError(
                    f"Could not move '{os.path.basename(source_path)}' into the target folder: {exc}"
                ) from exc

        _merge_metadata(target, source)
        db.flush()

        remaining = db.query(Image).filter(Image.gallery_id == source_id).count()
        target.image_count = db.query(Image).filter(Image.gallery_id == target_id).count()

        source_deleted = False
        if remaining == 0 and move_files and _folder_is_empty(source_folder):
            if source_folder and os.path.isdir(source_folder):
                try:
                    os.rmdir(source_folder)
                except OSError:
                    pass
            if _folder_is_empty(source_folder):
                delete_gallery_record(db, source)
                source_deleted = True
        if not source_deleted:
            source.image_count = remaining

        db.commit()
    except Exception:
        db.rollback()
        _restore_operation(moved_files, backups)
        raise

    _remove_after_commit(cleanup_after_commit)
    for backup, _original in backups:
        try:
            remove_file(backup)
        except OSError:
            pass

    return {
        "moved": moved,
        "renamed": renamed,
        "replaced": replaced,
        "reconciled": reconciled,
        "skipped": skipped,
        "db_only": db_only,
        "errors": errors,
        "source_deleted": source_deleted,
        "source_id": source_id,
        "target_id": target_id,
    }

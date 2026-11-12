"""Play a binder as a session: its cards become a playlist of their files,
ordered Safe → Hardcore so the session builds up, and the player follows each
file's Spice on a connected device.

Each card brings what it is about: a photo card its photo, a gallery card its
best shots, a creator card her top files."""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from models import Card, Playlist, TCGBinder, TCGBinderSlot, playlist_images
from services import tag_insights

GALLERY_FILES = 6
PERSON_FILES = 6
MAX_FILES = 300
# What makes a file one of the best: finishes, then edges, rating and views.
BEST_ORDER = "COALESCE(cum_count,0) * 5 + COALESCE(edge_count,0) * 3 + COALESCE(rating,0) + COALESCE(view_count,0) * 0.2 DESC"


def _enum(value):
    return value.value if hasattr(value, "value") else value


def _best_in_gallery(db: Session, gallery_id: int, limit: int) -> list[int]:
    return [row[0] for row in db.execute(text(
        f"SELECT id FROM images WHERE gallery_id = :g ORDER BY {BEST_ORDER}, sort_order LIMIT :n"),
        {"g": gallery_id, "n": limit})]


def _best_of_person(db: Session, creator_id: int, limit: int) -> list[int]:
    return [row[0] for row in db.execute(text(f"""
        SELECT i.id FROM images i
        WHERE i.gallery_id IN (SELECT gallery_id FROM gallery_creators WHERE creator_id = :c
                               UNION SELECT id FROM galleries WHERE creator_id = :c)
           OR i.id IN (SELECT image_id FROM image_creators WHERE creator_id = :c)
        ORDER BY {BEST_ORDER} LIMIT :n"""), {"c": creator_id, "n": limit})]


def card_files(db: Session, card: Card) -> list[int]:
    card_type = _enum(card.card_type)
    if card.source_image_id and card_type not in {"creator", "gallery"}:
        return [card.source_image_id]
    if card_type == "gallery" and card.source_gallery_id:
        return _best_in_gallery(db, card.source_gallery_id, GALLERY_FILES)
    if card.source_creator_id:
        return _best_of_person(db, card.source_creator_id, PERSON_FILES)
    if card.source_image_id:
        return [card.source_image_id]
    if card.source_gallery_id:
        return _best_in_gallery(db, card.source_gallery_id, GALLERY_FILES)
    return []


def binder_session(db: Session, binder_id: int) -> dict:
    binder = db.get(TCGBinder, binder_id)
    if not binder:
        raise ValueError("Binder not found")
    slots = (db.query(TCGBinderSlot).filter(TCGBinderSlot.binder_id == binder_id, TCGBinderSlot.card_id.isnot(None))
             .order_by(TCGBinderSlot.section_name, TCGBinderSlot.page_number, TCGBinderSlot.slot_number).all())
    files: list[int] = []
    seen = set()
    for slot in slots:
        card = db.get(Card, slot.card_id)
        for image_id in card_files(db, card) if card else []:
            if image_id not in seen:
                seen.add(image_id)
                files.append(image_id)
    files = files[:MAX_FILES]
    if not files:
        raise ValueError("This binder has no cards with files to play yet")
    ordered = tag_insights.spice_order(db, files)

    # One playlist per binder, refreshed every time it is played.
    name = f"Deck: {binder.name}"
    playlist = db.query(Playlist).filter(Playlist.name == name).first()
    if playlist is None:
        playlist = Playlist(name=name)
        db.add(playlist)
        db.flush()
    playlist.description = f"{len(ordered)} files from the {binder.name} binder, Safe to Hardcore"
    db.execute(playlist_images.delete().where(playlist_images.c.playlist_id == playlist.id))
    db.execute(playlist_images.insert(), [
        {"playlist_id": playlist.id, "image_id": row["id"], "sort_order": index} for index, row in enumerate(ordered)])
    db.commit()
    return {"playlist_id": playlist.id, "name": name, "count": len(ordered)}

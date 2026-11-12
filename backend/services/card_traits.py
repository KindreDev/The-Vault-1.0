"""Traits printed on content card faces: three keywords from the source file's
tags, chosen for what makes the card yours. Your starred tags come first, then
your type (taste profile), then traits that are rare in your library, then the
most confident remaining looks/content tags.

The result is cached on the card (cards.face_traits) and cleared when tags
change (an AI tagging run, starring a tag)."""
from __future__ import annotations

import json

from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

from models import Card, Gallery, Image, Tag, image_tags

TRAIT_CARD_TYPES = {"image", "scene", "variant", "cosplay", "gallery", "collab"}
TRAIT_COUNT = 3
MIN_CONFIDENCE = 0.50
TYPE_MIN_LIFT = 1.8
RARE_SHARE = 0.02
# A plain trait must still say something: not on more than this share of files.
PLAIN_MAX_SHARE = 0.15
KIND_ORDER = {"favorite": 0, "type": 1, "rare": 2, "plain": 3}


def _enum(value):
    return value.value if hasattr(value, "value") else value


def _source_image_id(db: Session, card: Card) -> int | None:
    if card.source_image_id:
        return card.source_image_id
    if not card.source_gallery_id:
        return None
    gallery = db.get(Gallery, card.source_gallery_id)
    if not gallery:
        return None
    if gallery.cover_path:
        row = db.query(Image.id).filter(Image.gallery_id == gallery.id, Image.file_path == gallery.cover_path).first()
        if row:
            return row[0]
    row = db.query(Image.id).filter(Image.gallery_id == gallery.id).order_by(Image.sort_order, Image.id).first()
    return row[0] if row else None


def compute_traits(db: Session, image_id: int) -> list[dict]:
    from services import tag_insights
    roles = tag_insights.tag_roles(db)
    lifts = {row["id"]: row["lift"] for row in tag_insights.taste_profile(db)}
    rows = (db.query(Tag.id, Tag.name, Tag.is_favorite, Tag.source, image_tags.c.confidence)
            .join(image_tags, image_tags.c.tag_id == Tag.id)
            .filter(image_tags.c.image_id == image_id).all())
    picked: dict[int, dict] = {}
    for tag_id, name, favorite, source, confidence in rows:
        info = roles.get(tag_id) or {}
        manual = _enum(source) == "manual" and confidence is None
        if info.get("role") not in tag_insights.RANKED_ROLES and not favorite:
            continue
        if not manual and (confidence or 0) < MIN_CONFIDENCE:
            continue
        lift = lifts.get(tag_id) or 0
        share = info.get("share")
        kind = ("favorite" if favorite else "type" if lift >= TYPE_MIN_LIFT
                else "rare" if share is not None and 0 < share <= RARE_SHARE and not manual else "plain")
        if kind == "plain" and (share or 0) > PLAIN_MAX_SHARE:
            continue
        picked[tag_id] = {"id": tag_id, "name": name.replace("_", " "), "kind": kind,
                          "_rank": (KIND_ORDER[kind], -lift, -(confidence or 1.0))}
    ordered = sorted(picked.values(), key=lambda t: t["_rank"])[:TRAIT_COUNT]
    return [{k: v for k, v in t.items() if k != "_rank"} for t in ordered]


def face_traits(db: Session, card: Card) -> list[dict]:
    """The card's printed traits, from the cache when it is fresh."""
    if _enum(card.card_type) not in TRAIT_CARD_TYPES:
        return []
    if card.face_traits is not None:
        try:
            return json.loads(card.face_traits)
        except (TypeError, ValueError):
            pass
    image_id = _source_image_id(db, card)
    traits = compute_traits(db, image_id) if image_id else []
    payload = json.dumps(traits)
    # Cache it in its own short session so reading a card never leaves the
    # caller's session dirty; a busy database just means no cache this time.
    set_committed_value(card, "face_traits", payload)
    try:
        from database import SessionLocal
        with SessionLocal() as writer:
            writer.execute(text("PRAGMA busy_timeout = 200"))
            writer.execute(text("UPDATE cards SET face_traits = :v WHERE id = :id"), {"v": payload, "id": card.id})
            writer.commit()
    except Exception:
        pass
    return traits


def clear_face_traits(db: Session):
    db.execute(text("UPDATE cards SET face_traits = NULL WHERE face_traits IS NOT NULL"))


def warm_face_traits(db: Session, batch: int = 500) -> int:
    """Fill the trait cache for every content card that lacks it, a batch per
    commit. Run in the background at startup and after tagging."""
    types = [t for t in TRAIT_CARD_TYPES if t not in {"scene", "cosplay"}]
    done = 0
    while True:
        cards = (db.query(Card).filter(Card.face_traits.is_(None), Card.card_type.in_(types))
                 .limit(batch).all())
        if not cards:
            return done
        for card in cards:
            image_id = _source_image_id(db, card)
            card.face_traits = json.dumps(compute_traits(db, image_id) if image_id else [])
        db.commit()
        done += len(cards)

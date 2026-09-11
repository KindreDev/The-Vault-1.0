"""Personal-value scoring for immutable TCG print rarity.

This module only influences rarity when a printing is published. Pack odds and
owned-card selection deliberately do not call it.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from models import Creator, Gallery, Image, Tag, gallery_tags, image_tags


RARITY_ORDER = {"C": 0, "R": 1, "SR": 2, "UR": 3}
POLICY_VERSION = "personal-value-v1"


def _chunks(values, size: int = 700):
    values = list(dict.fromkeys(value for value in values if value is not None))
    for index in range(0, len(values), size):
        yield values[index:index + size]


def _enum(value):
    return value.value if hasattr(value, "value") else value


def _normalized(name: str) -> str:
    return " ".join((name or "").lower().replace("_", " ").replace("-", " ").split())


def apply_rarity_floor(rarity: str, floor: str | None) -> str:
    rarity = "UR" if rarity == "SPR" else (rarity or "C")
    if not floor:
        return rarity
    return floor if RARITY_ORDER.get(floor, 0) > RARITY_ORDER.get(rarity, 0) else rarity


@dataclass
class PersonalValueContext:
    images: dict[int, Image] = field(default_factory=dict)
    galleries: dict[int, Gallery] = field(default_factory=dict)
    creators: dict[int, Creator] = field(default_factory=dict)
    image_tags: dict[int, list[dict]] = field(default_factory=dict)
    gallery_tags: dict[int, list[dict]] = field(default_factory=dict)
    gallery_view_seconds: dict[int, int] = field(default_factory=dict)


def build_personal_value_context(
    db: Session, *, image_ids=(), gallery_ids=(), creator_ids=(), ai_confidence_threshold: float = 0.72,
) -> PersonalValueContext:
    context = PersonalValueContext()
    image_ids = set(image_ids)
    gallery_ids = set(gallery_ids)
    creator_ids = set(creator_ids)

    for chunk in _chunks(image_ids):
        context.images.update({row.id: row for row in db.query(Image).filter(Image.id.in_(chunk)).all()})
    gallery_ids.update(image.gallery_id for image in context.images.values())

    for chunk in _chunks(gallery_ids):
        context.galleries.update({row.id: row for row in db.query(Gallery).filter(Gallery.id.in_(chunk)).all()})
        seconds = db.query(
            Image.gallery_id, func.coalesce(func.sum(Image.view_seconds), 0),
        ).filter(Image.gallery_id.in_(chunk)).group_by(Image.gallery_id).all()
        context.gallery_view_seconds.update({gallery_id: int(total or 0) for gallery_id, total in seconds})
    creator_ids.update(gallery.creator_id for gallery in context.galleries.values() if gallery.creator_id)

    for chunk in _chunks(creator_ids):
        context.creators.update({row.id: row for row in db.query(Creator).filter(Creator.id.in_(chunk)).all()})

    for chunk in _chunks(image_ids):
        rows = db.query(
            image_tags.c.image_id, Tag.id, Tag.name, Tag.source,
            Tag.is_favorite, image_tags.c.confidence,
        ).join(Tag, Tag.id == image_tags.c.tag_id).filter(
            image_tags.c.image_id.in_(chunk),
            or_(Tag.source == "manual", image_tags.c.confidence >= ai_confidence_threshold),
        ).all()
        for image_id, tag_id, name, source, favorite, confidence in rows:
            context.image_tags.setdefault(image_id, []).append({
                "id": tag_id, "name": name, "normalized": _normalized(name),
                "source": _enum(source) or "manual", "confidence": confidence,
                "is_favorite": bool(favorite), "coverage": 1.0,
            })

    for chunk in _chunks(gallery_ids):
        direct = db.query(
            gallery_tags.c.gallery_id, Tag.id, Tag.name, Tag.source, Tag.is_favorite,
        ).join(Tag, Tag.id == gallery_tags.c.tag_id).filter(
            gallery_tags.c.gallery_id.in_(chunk), Tag.is_favorite.is_(True), Tag.source == "manual",
        ).all()
        for gallery_id, tag_id, name, source, favorite in direct:
            context.gallery_tags.setdefault(gallery_id, []).append({
                "id": tag_id, "name": name, "normalized": _normalized(name),
                "source": _enum(source) or "manual", "confidence": 1.0,
                "is_favorite": bool(favorite), "coverage": 1.0,
            })

        coverage_rows = db.query(
            Image.gallery_id, Tag.id, Tag.name, Tag.source,
            func.count(func.distinct(Image.id)), func.count(func.distinct(Image.gallery_id)),
        ).join(image_tags, image_tags.c.image_id == Image.id).join(
            Tag, Tag.id == image_tags.c.tag_id,
        ).filter(
            Image.gallery_id.in_(chunk), Tag.is_favorite.is_(True),
            or_(Tag.source == "manual", image_tags.c.confidence >= ai_confidence_threshold),
        ).group_by(Image.gallery_id, Tag.id, Tag.name, Tag.source).all()
        for gallery_id, tag_id, name, source, matched, _ in coverage_rows:
            gallery = context.galleries.get(gallery_id)
            denominator = max(1, int(gallery.image_count or 0) if gallery else 1)
            evidence = {
                "id": tag_id, "name": name, "normalized": _normalized(name),
                "source": _enum(source) or "manual", "confidence": 1.0,
                "is_favorite": True, "coverage": min(1.0, matched / denominator),
            }
            existing = next((item for item in context.gallery_tags.setdefault(gallery_id, []) if item["id"] == tag_id), None)
            if existing:
                existing["coverage"] = max(existing["coverage"], evidence["coverage"])
            else:
                context.gallery_tags[gallery_id].append(evidence)
    return context


def _tag_floor(source_key: str, favorite_tags: list[dict]) -> tuple[str | None, float]:
    if not favorite_tags:
        return None, 1.0
    ids = ",".join(str(item["id"]) for item in sorted(favorite_tags, key=lambda item: item["id"]))
    digest = hashlib.blake2b(f"favorite-tag-floor|{source_key}|{ids}".encode("utf-8"), digest_size=8).digest()
    roll = int.from_bytes(digest, "big") / float(2**64)
    if roll < 0.25:
        return "SR", roll
    if roll < 0.50:
        return "R", roll
    return None, roll


def evaluate_personal_value(
    *, source_key: str, card_type: str, image: Image | None = None,
    gallery: Gallery | None = None, creator: Creator | None = None,
    tags: list[dict] | None = None, gallery_view_seconds: int = 0,
) -> dict:
    """Return a deterministic score, rarity floor, and frozen audit factors."""
    tags = tags or []
    factors = []
    score = 0.0
    floor = None
    floor_reasons = []

    def add(key: str, label: str, value, points: float, detail: str):
        nonlocal score
        if points <= 0:
            return
        score += points
        factors.append({"key": key, "label": label, "value": value, "points": round(points, 2), "detail": detail})

    def raise_floor(value: str, reason: str):
        nonlocal floor
        previous = floor or "C"
        if RARITY_ORDER[value] > RARITY_ORDER.get(previous, 0):
            floor = value
        floor_reasons.append(reason)

    direct_cum = int(image.cum_count or 0) if image else 0
    direct_edges = int(image.edge_count or 0) if image else 0
    direct_seconds = int(image.view_seconds or 0) if image else 0
    direct_views = int(image.view_count or 0) if image else 0
    rating = float(image.rating or 0) if image else 0.0
    favorite = bool(image.is_favorite) if image else False

    if card_type == "gallery" and gallery:
        direct_cum = int(gallery.cum_count or 0)
        direct_edges = int(gallery.edge_count or 0)
        direct_seconds = int(gallery_view_seconds or 0)
        direct_views = int(gallery.view_count or 0)
        rating = float(gallery.rating or 0)
        favorite = bool(gallery.is_favorite)

    add("rating", "User rating", rating, min(10.0, rating), "A high personal rating raises mint value.")
    add("views", "Repeat views", direct_views, min(8.0, math.log1p(direct_views) * 2.2), "Repeat visits are a stable interest signal.")
    add("orgasms", "Recorded orgasms", direct_cum, min(32.0, direct_cum * 5.0), "Repeated sexual engagement is a primary value signal.")
    add("edges", "Recorded edges", direct_edges, min(12.0, direct_edges * 2.0), "Repeated edging adds a smaller supporting signal.")
    if favorite:
        add("favorite", "Favorite source", True, 15.0, "A direct favorite is protected from Common.")
        raise_floor("R", "Directly favorited source")

    loop_equivalents = None
    if image and image.is_video and card_type != "gallery":
        duration = max(1.0, float(image.duration or 0) or 1.0)
        loop_equivalents = direct_seconds / duration
        watch_points = min(25.0, math.log1p(loop_equivalents) * 5.5) + min(5.0, math.log1p(direct_seconds / 60) * 1.2)
        add("video_attention", "Video attention", round(loop_equivalents, 2), watch_points, f"{direct_seconds}s viewed across a {duration:g}s clip.")
        if loop_equivalents >= 60 or direct_seconds >= 3600:
            raise_floor("UR", "Exceptional duration-normalized video engagement")
        elif loop_equivalents >= 15 or direct_seconds >= 1200:
            raise_floor("SR", "Strong duration-normalized video engagement")
        elif loop_equivalents >= 3 or direct_seconds >= 300:
            raise_floor("R", "Meaningful duration-normalized video engagement")
    elif card_type == "gallery":
        add("gallery_time", "Gallery viewing time", direct_seconds, min(25.0, math.log1p(direct_seconds / 60) * 5.0), "Total viewing time across the gallery.")
        if direct_seconds >= 5400:
            raise_floor("UR", "At least 90 minutes spent in this gallery")
        elif direct_seconds >= 1800:
            raise_floor("SR", "At least 30 minutes spent in this gallery")
        elif direct_seconds >= 600:
            raise_floor("R", "At least 10 minutes spent in this gallery")
    elif image:
        add("photo_time", "Photo viewing time", direct_seconds, min(25.0, math.log1p(direct_seconds / 60) * 5.0), "Long attention on one still image is unusually strong.")
        if direct_seconds >= 900:
            raise_floor("UR", "At least 15 minutes spent on one photo")
        elif direct_seconds >= 600:
            raise_floor("SR", "At least 10 minutes spent on one photo")
        elif direct_seconds >= 120:
            raise_floor("R", "At least 2 minutes spent on one photo")

    if direct_cum >= 6:
        raise_floor("UR", "At least 6 recorded orgasms")
    elif direct_cum >= 3:
        raise_floor("SR", "At least 3 recorded orgasms")
    elif direct_cum >= 1:
        raise_floor("R", "Recorded orgasm")

    if direct_views >= 30:
        raise_floor("SR", "Returned to this source at least 30 times")
    elif direct_views >= 8:
        raise_floor("R", "Returned to this source at least 8 times")

    if creator and creator.is_favorite:
        add("favorite_creator", "Favorite creator", True, 10.0, "The source belongs to a favorite creator.")

    favorite_tags = [tag for tag in tags if tag.get("is_favorite")]
    if favorite_tags:
        coverage = max(float(tag.get("coverage", 1.0)) for tag in favorite_tags)
        add(
            "favorite_tags", "Favorite tags",
            [tag.get("name") for tag in favorite_tags], min(14.0, 7.0 + len(favorite_tags) * 2.0) * coverage,
            f"Favorite-tag coverage is {coverage:.0%}; manual tags and confident AI tags qualify.",
        )
        tag_floor, roll = _tag_floor(source_key, favorite_tags)
        if tag_floor:
            raise_floor(tag_floor, f"Deterministic favorite-tag draw ({roll:.1%})")

    if score >= 72:
        raise_floor("UR", "Combined personal-value score reached the UR threshold")
    elif score >= 46:
        raise_floor("SR", "Combined personal-value score reached the SR threshold")
    elif score >= 24:
        raise_floor("R", "Combined personal-value score reached the R threshold")

    exceptional = (floor == "UR")
    spr_eligible = exceptional or favorite or rating >= 8 or direct_cum >= 6
    return {
        "policy_version": POLICY_VERSION,
        "score": round(min(100.0, score), 2),
        "rarity_floor": floor,
        "floor_reasons": floor_reasons,
        "spr_eligible": bool(spr_eligible),
        "duration_normalized_plays": round(loop_equivalents, 2) if loop_equivalents is not None else None,
        "favorite_tag_names": [tag.get("name") for tag in favorite_tags],
        "factors": factors,
    }

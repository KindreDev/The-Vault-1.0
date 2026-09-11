"""Deterministic frozen recipes for TCG V2 Gallery cards."""

from __future__ import annotations

import json
import math
import os
import random
from datetime import datetime
from typing import Any

from services.character_cards import extract_character_palette


GALLERY_RECIPE_SCHEMA = "vault.gallery-card-recipe"
GALLERY_RECIPE_VERSION = 3

STACK_LAYOUTS = (
    {"offsetX": -62, "offsetY": 22, "rotation": -7.5},
    {"offsetX": 62, "offsetY": 26, "rotation": 6.5},
    {"offsetX": 4, "offsetY": -58, "rotation": 2.2},
)


def _rarity(value: str | None) -> str:
    normalized = str(value or "C").upper()
    return "SR" if normalized == "SSR" else normalized


def _creator_type_label(value: Any) -> str | None:
    normalized = value.value if hasattr(value, "value") else value
    normalized = str(normalized or "").strip().lower()
    labels = {
        "cosplayer": "Cosplayer", "ethot": "E-thot", "artist": "Artist",
        "character": "Character", "actress": "Actress", "custom": "Model/Other",
    }
    return labels.get(normalized, normalized.replace("_", " ").title()) if normalized else None


def build_gallery_recipe(*, rarity: str, gallery_id: int, gallery_name: str,
                         creator_id: int | None, creator_name: str | None,
                         creator_type: str | None, period_label: str | None,
                         card_id: str, minted_at: datetime | str, image_id: int,
                         source_width: int, source_height: int, focal_x: float,
                         focal_y: float, palette: dict[str, str],
                         stack_sources: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    rarity = _rarity(rarity)
    if rarity not in {"C", "R", "SR", "UR", "SPR"}:
        raise ValueError(f"Unsupported Gallery rarity: {rarity}")
    if not gallery_id or not str(gallery_name or "").strip():
        raise ValueError("Gallery recipe requires a real gallery identity")
    if not image_id or source_width <= 0 or source_height <= 0:
        raise ValueError("Gallery recipe requires a valid full-resolution image")
    if bool(creator_id) != bool(str(creator_name or "").strip()):
        raise ValueError("Gallery creator ID and name must either both exist or both be absent")
    minted_value = minted_at.isoformat() if isinstance(minted_at, datetime) else str(minted_at or "").strip()
    if not minted_value or not str(card_id or "").strip():
        raise ValueError("Gallery recipe requires real mint identity")
    for role in ("background", "primary", "secondary", "ink"):
        value = str(palette.get(role, ""))
        if len(value) != 7 or not value.startswith("#"):
            raise ValueError(f"Invalid Gallery palette role: {role}")
        int(value[1:], 16)

    frozen_stack = []
    for index, source in enumerate((stack_sources or [])[:3]):
        if not source.get("imageId") or int(source.get("width") or 0) <= 0 or int(source.get("height") or 0) <= 0:
            raise ValueError("Gallery stack requires valid real image sources")
        layout = STACK_LAYOUTS[index]
        frozen_stack.append({
            "imageId": int(source["imageId"]),
            "width": int(source["width"]),
            "height": int(source["height"]),
            "focalX": min(1.0, max(0.0, float(source.get("focalX", 0.5)))),
            "focalY": min(1.0, max(0.0, float(source.get("focalY", 0.2)))),
            **layout,
        })

    return {
        "schema": GALLERY_RECIPE_SCHEMA,
        "version": GALLERY_RECIPE_VERSION,
        "cardType": "gallery",
        "rarity": rarity,
        "templateId": "gallery-scrapbook-polaroid-v1",
        "snapshot": {
            "galleryId": int(gallery_id),
            "galleryName": str(gallery_name).strip(),
            "creatorId": int(creator_id) if creator_id else None,
            "creatorName": str(creator_name).strip() if creator_name else None,
            "creatorType": str(creator_type).strip().lower() if creator_type else None,
            "creatorTypeLabel": _creator_type_label(creator_type),
            "periodLabel": str(period_label or "").strip() or None,
            "cardId": str(card_id).strip(),
            "mintedAt": minted_value,
        },
        "source": {
            "kind": "image", "imageId": int(image_id),
            "width": int(source_width), "height": int(source_height),
            "focalX": min(1.0, max(0.0, float(focal_x))),
            "focalY": min(1.0, max(0.0, float(focal_y))),
        },
        "stackSources": frozen_stack,
        "palette": dict(palette),
        "effectHooks": ["photograph-stack", "photograph", "background-foil", "subject-foil", "edge-foil", "paper", "polaroid", "tape", "motifs", "rarity", "text", "signature"],
    }


def _source_score(image, *, is_cover: bool) -> tuple:
    width, height = int(image.width or 0), int(image.height or 0)
    aspect = width / height if height else 0.0
    portrait_fit = max(0.0, 1.0 - abs(aspect - (2 / 3)))
    engagement = math.log1p(
        max(0, int(image.view_count or 0))
        + max(0, int(image.cum_count or 0)) * 8
        + max(0, int(image.view_seconds or 0)) / 30
    )
    return (
        1 if is_cover else 0, 1 if image.is_favorite else 0,
        float(image.rating or 0), round(engagement, 6), round(portrait_fit, 6),
        width * height, -int(image.id or 0),
    )


def _primary_creator(gallery):
    if gallery.creator:
        return gallery.creator
    linked = sorted(gallery.creators or [], key=lambda creator: int(creator.id or 0))
    return linked[0] if linked else None


def select_gallery_source(db, gallery) -> Any | None:
    from models import Image

    candidates = db.query(Image).filter(
        Image.gallery_id == gallery.id,
        Image.is_video == False,  # noqa: E712
        Image.width.isnot(None), Image.height.isnot(None),
    ).all()
    candidates = [
        image for image in candidates
        if int(image.width or 0) > 0 and int(image.height or 0) > 0
        and os.path.isfile(image.file_path)
    ]
    if not candidates:
        return None
    cover_path = os.path.normcase(os.path.normpath(gallery.cover_path)) if gallery.cover_path else None
    return max(candidates, key=lambda image: _source_score(
        image,
        is_cover=bool(cover_path and os.path.normcase(os.path.normpath(image.file_path)) == cover_path),
    ))


def select_gallery_stack_sources(db, gallery, hero, *, card_id: int) -> list[Any]:
    """Choose up to three stable, real supporting prints from the same gallery."""
    from models import Image

    candidates = db.query(Image).filter(
        Image.gallery_id == gallery.id,
        Image.id != hero.id,
        Image.is_video == False,  # noqa: E712
        Image.width.isnot(None), Image.height.isnot(None),
    ).all()
    candidates = [
        image for image in candidates
        if int(image.width or 0) > 0 and int(image.height or 0) > 0
        and os.path.isfile(image.file_path)
    ]
    if not candidates:
        return []

    # A seeded shuffle prevents every gallery stack from merely showing three
    # adjacent filenames, while remaining reproducible for this minted card.
    candidates.sort(key=lambda image: int(image.id or 0))
    rng = random.Random(f"gallery-stack:{gallery.id}:{card_id}")
    rng.shuffle(candidates)
    shortlist = candidates[:12]
    shortlist.sort(key=lambda image: _source_score(image, is_cover=False), reverse=True)
    return shortlist[:3]


def prepare_gallery_visual(db, card) -> dict[str, Any]:
    """Freeze one Gallery card from its real folder metadata and source image."""
    if card.visual_recipe:
        recipe = json.loads(card.visual_recipe)
        if recipe.get("schema") == GALLERY_RECIPE_SCHEMA and recipe.get("version") == GALLERY_RECIPE_VERSION:
            return recipe

    from models import CardType, Gallery, Image
    from services.cards import format_period

    card_type = card.card_type.value if hasattr(card.card_type, "value") else card.card_type
    if card_type != CardType.gallery.value or not card.source_gallery_id:
        raise ValueError("Gallery preparation requires a Gallery card with a real gallery")
    gallery = db.query(Gallery).filter(Gallery.id == card.source_gallery_id).first()
    if not gallery:
        raise ValueError("Gallery card source identity is missing")

    source = db.query(Image).filter(Image.id == card.source_image_id).first() if card.source_image_id else None
    if (not source or source.gallery_id != gallery.id or source.is_video
            or not source.width or not source.height or not os.path.isfile(source.file_path)):
        source = select_gallery_source(db, gallery)
    if not source:
        raise ValueError("Gallery has no eligible full-resolution still image")
    card.source_image_id = source.id

    creator = _primary_creator(gallery)
    raw_type = None
    if creator:
        raw_type = creator.creator_type.value if hasattr(creator.creator_type, "value") else creator.creator_type
    stack_sources = select_gallery_stack_sources(db, gallery, source, card_id=card.id)
    recipe = build_gallery_recipe(
        rarity=card.rarity_class, gallery_id=gallery.id, gallery_name=gallery.name,
        creator_id=creator.id if creator else None,
        creator_name=creator.name if creator else None,
        creator_type=raw_type,
        period_label=format_period(gallery.period_month, gallery.period_year),
        card_id=f"GAL-{card.id:06d}", minted_at=card.generated_at,
        image_id=source.id, source_width=source.width, source_height=source.height,
        focal_x=source.focal_x if source.focal_x is not None else 0.5,
        focal_y=source.focal_y if source.focal_y is not None else 0.2,
        palette=extract_character_palette(source.file_path),
        stack_sources=[{
            "imageId": image.id,
            "width": image.width,
            "height": image.height,
            "focalX": image.focal_x if image.focal_x is not None else 0.5,
            "focalY": image.focal_y if image.focal_y is not None else 0.2,
        } for image in stack_sources],
    )
    card.visual_recipe = json.dumps(recipe, separators=(",", ":"), sort_keys=True)
    db.flush()
    return recipe


def backfill_gallery_visuals(db) -> dict[str, int]:
    from models import Card, CardType
    from sqlalchemy import and_, or_

    prepared = failed = 0
    candidates = db.query(Card).filter(
        Card.card_type == CardType.gallery,
        or_(
            and_(Card.print_rarity.is_(None), Card.visual_recipe.is_(None)),
            Card.visual_recipe.like(f'%"schema":"{GALLERY_RECIPE_SCHEMA}"%'),
        ),
    ).all()
    for card in candidates:
        should_prepare = card.print_rarity is None and card.visual_recipe is None
        if card.visual_recipe:
            try:
                existing = json.loads(card.visual_recipe)
                should_prepare = (
                    existing.get("schema") == GALLERY_RECIPE_SCHEMA
                    and int(existing.get("version") or 0) < GALLERY_RECIPE_VERSION
                )
            except (TypeError, ValueError):
                should_prepare = False
        if not should_prepare:
            continue
        try:
            prepare_gallery_visual(db, card)
            prepared += 1
        except Exception:
            failed += 1
    db.commit()
    return {"prepared": prepared, "failed": failed}

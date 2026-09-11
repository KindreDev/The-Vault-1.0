"""Deterministic frozen recipes for TCG V2 Hall of Fame mementos."""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any


HOF_RECIPE_SCHEMA = "vault.hall-of-fame-card-recipe"
HOF_RECIPE_VERSION = 2

HOF_PERIOD_TYPES = {"day", "week", "month", "alltime"}


def _period_type(value: str | None, board_label: str) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in HOF_PERIOD_TYPES:
        return normalized
    label = str(board_label or "").strip().lower()
    if label.endswith(" hall of fame"):
        label = label[:-13].strip()
    by_label = {
        "daily": "day", "weekly": "week", "monthly": "month",
        "all-time": "alltime", "all time": "alltime",
    }
    inferred = by_label.get(label)
    if inferred:
        return inferred
    raise ValueError("Hall of Fame recipe requires a real board period type")


def _rarity(value: str | None) -> str:
    normalized = str(value or "C").upper()
    return "SR" if normalized == "SSR" else normalized


def _creator_type_label(value: Any) -> str:
    normalized = value.value if hasattr(value, "value") else value
    normalized = str(normalized or "").strip().lower()
    return {
        "cosplayer": "Cosplayer", "ethot": "E-thot", "artist": "Artist",
        "character": "Character", "actress": "Actress", "custom": "Model/Other",
    }.get(normalized, normalized.replace("_", " ").title() or "Creator")


def build_hof_recipe(*, rarity: str, creator_id: int, creator_name: str,
                     creator_type: str, gallery_name: str | None,
                     board_label: str, period_label: str, card_id: str,
                     minted_at: datetime | str, image_id: int,
                     source_width: int, source_height: int,
                     focal_x: float, focal_y: float,
                     period_type: str | None = None) -> dict[str, Any]:
    rarity = _rarity(rarity)
    if rarity not in {"C", "R", "SR", "UR", "SPR"}:
        raise ValueError(f"Unsupported Hall of Fame rarity: {rarity}")
    if not creator_id or not str(creator_name or "").strip():
        raise ValueError("Hall of Fame recipe requires a real creator")
    if not image_id or source_width <= 0 or source_height <= 0:
        raise ValueError("Hall of Fame recipe requires a valid full-resolution image")
    if not str(board_label or "").strip() or not str(period_label or "").strip():
        raise ValueError("Hall of Fame recipe requires its real board and winning period")
    normalized_period_type = _period_type(period_type, board_label)
    minted_value = minted_at.isoformat() if isinstance(minted_at, datetime) else str(minted_at or "").strip()
    if not minted_value or not str(card_id or "").strip():
        raise ValueError("Hall of Fame recipe requires real mint identity")
    return {
        "schema": HOF_RECIPE_SCHEMA, "version": HOF_RECIPE_VERSION,
        "cardType": "hall-of-fame", "rarity": rarity,
        "templateId": "hall-of-fame-honor-materials-v2",
        "snapshot": {
            "creatorId": int(creator_id), "creatorName": str(creator_name).strip(),
            "creatorTypeLabel": _creator_type_label(creator_type),
            "galleryName": str(gallery_name or "").strip() or None,
            "boardLabel": str(board_label).strip(),
            "periodType": normalized_period_type,
            "periodLabel": str(period_label).strip(),
            "cardId": str(card_id).strip(), "mintedAt": minted_value,
        },
        "source": {
            "kind": "image", "imageId": int(image_id),
            "width": int(source_width), "height": int(source_height),
            "focalX": min(1.0, max(0.0, float(focal_x))),
            "focalY": min(1.0, max(0.0, float(focal_y))),
        },
        "effectHooks": [
            "photograph", "background-foil", "subject-foil", "edge-foil",
            "frame", "ornaments", "rarity", "text", "signature",
        ],
    }


def prepare_hof_visual(db, card) -> dict[str, Any]:
    from models import CardType, Creator, Gallery, HofCrown, Image
    from services.cards import HOF_BOARD_LABEL, format_hof_period

    if card.visual_recipe:
        try:
            frozen = json.loads(card.visual_recipe)
            if frozen.get("schema") == HOF_RECIPE_SCHEMA and frozen.get("version") == HOF_RECIPE_VERSION:
                return frozen
        except (TypeError, ValueError):
            pass

    card_type = card.card_type.value if hasattr(card.card_type, "value") else card.card_type
    if card_type != CardType.hof.value or not card.source_creator_id:
        raise ValueError("Hall of Fame preparation requires a real Hall of Fame card")
    creator = db.query(Creator).filter(Creator.id == card.source_creator_id).first()
    image = db.query(Image).filter(Image.id == card.source_image_id).first() if card.source_image_id else None
    if not creator or not image or image.is_video or not image.width or not image.height or not os.path.isfile(image.file_path):
        raise ValueError("Hall of Fame source identity or image is unavailable")
    gallery = db.query(Gallery).filter(Gallery.id == image.gallery_id).first() if image.gallery_id else None
    crown = db.query(HofCrown).filter(HofCrown.card_id == card.id).first()
    period_type = crown.period_type if crown else "alltime"
    period_key = crown.period_key if crown else None
    board_label = HOF_BOARD_LABEL.get(period_type)
    period_label = format_hof_period(period_type, period_key)
    raw_type = creator.creator_type.value if hasattr(creator.creator_type, "value") else creator.creator_type
    recipe = build_hof_recipe(
        rarity=card.rarity_class, creator_id=creator.id, creator_name=creator.name,
        creator_type=raw_type, gallery_name=gallery.name if gallery else None,
        board_label=board_label, period_label=period_label,
        period_type=period_type,
        card_id=f"HOF-{card.id:06d}", minted_at=card.generated_at,
        image_id=image.id, source_width=image.width, source_height=image.height,
        focal_x=image.focal_x if image.focal_x is not None else 0.5,
        focal_y=image.focal_y if image.focal_y is not None else 0.2,
    )
    card.visual_recipe = json.dumps(recipe, separators=(",", ":"), sort_keys=True)
    db.flush()
    return recipe


def backfill_hof_visuals(db) -> dict[str, int]:
    from models import Card, CardType

    prepared = failed = 0
    for card in db.query(Card).filter(
        Card.card_type == CardType.hof,
        Card.print_rarity.is_(None),
        Card.visual_recipe.is_(None),
    ).all():
        try:
            prepare_hof_visual(db, card)
            prepared += 1
        except Exception:
            failed += 1
    db.commit()
    return {"prepared": prepared, "failed": failed}

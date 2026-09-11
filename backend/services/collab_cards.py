"""Deterministic TCG V2 Collab recipes for multi-creator cards."""

from __future__ import annotations

import json
import math
import os
from datetime import datetime
from typing import Any

from services.character_cards import extract_character_palette


COLLAB_RECIPE_SCHEMA = "vault.collab-card-recipe"
COLLAB_RECIPE_VERSION = 2


def _rarity(value: str | None) -> str:
    normalized = str(value or "C").upper()
    return "SR" if normalized == "SSR" else normalized


def _banner_label(creator_names: list[str]) -> str:
    return " × ".join(creator_names)


def _character_label(character_names: list[str | None]) -> str | None:
    unique_names: list[str] = []
    for value in character_names:
        name = str(value or "").strip()
        if name and name.casefold() not in {item.casefold() for item in unique_names}:
            unique_names.append(name)
    return " & ".join(unique_names) or None


def build_collab_recipe(*, rarity: str, subtype: str, creator_ids: list[int],
                        creator_names: list[str], character_names: list[str | None] | None,
                        gallery_name: str | None, period_label: str | None,
                        card_id: str, minted_at: datetime | str, image_id: int,
                        source_width: int, source_height: int, focal_x: float,
                        focal_y: float, palette: dict[str, str]) -> dict[str, Any]:
    rarity = _rarity(rarity)
    if rarity not in {"C", "R", "SR", "UR", "SPR"}:
        raise ValueError(f"Unsupported Collab rarity: {rarity}")
    names = [str(name or "").strip() for name in creator_names]
    ids = [int(value) for value in creator_ids]
    if len(names) < 2 or len(ids) != len(names) or any(not name for name in names):
        raise ValueError("Collab recipe requires at least two real creators")
    if not image_id or source_width <= 0 or source_height <= 0:
        raise ValueError("Collab recipe requires a valid full-resolution image")
    characters = [str(name).strip() if name else None for name in (character_names or [])]
    minted_value = minted_at.isoformat() if isinstance(minted_at, datetime) else str(minted_at or "").strip()
    if not minted_value or not str(card_id or "").strip():
        raise ValueError("Collab recipe requires real mint identity")
    for role in ("primary", "secondary", "pop", "ink"):
        value = str(palette.get(role, ""))
        if len(value) != 7 or not value.startswith("#"):
            raise ValueError(f"Invalid Collab palette role: {role}")
        int(value[1:], 16)

    return {
        "schema": COLLAB_RECIPE_SCHEMA,
        "version": COLLAB_RECIPE_VERSION,
        "cardType": "collab",
        "rarity": rarity,
        "templateId": "collab-gift-frame-v1",
        "snapshot": {
            "subtype": str(subtype or "image"),
            "creatorIds": ids,
            "creatorNames": names,
            "characterNames": characters,
            "galleryName": str(gallery_name or "").strip() or None,
            "topLabel": _character_label(characters),
            "bannerLabel": _banner_label(names),
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
        "palette": dict(palette),
        "effectHooks": ["photograph", "background-foil", "subject-foil", "edge-foil", "frame", "rarity", "signature"],
    }


def _source_score(image) -> tuple:
    width, height = int(image.width or 0), int(image.height or 0)
    aspect = width / height if height else 0.0
    portrait_fit = max(0.0, 1.0 - abs(aspect - (2 / 3)))
    engagement = math.log1p(
        max(0, int(image.view_count or 0))
        + max(0, int(image.cum_count or 0)) * 8
        + max(0, int(image.view_seconds or 0)) / 30
    )
    return (
        1 if int(image.person_count or 0) >= 2 else 0,
        1 if image.is_favorite else 0,
        float(image.rating or 0), round(engagement, 6), round(portrait_fit, 6),
        width * height, -int(image.id or 0),
    )


def prepare_collab_visual(db, card) -> dict[str, Any]:
    """Freeze a layered Collab recipe without inventing participant identity."""
    if card.visual_recipe:
        recipe = json.loads(card.visual_recipe)
        if (recipe.get("schema") == COLLAB_RECIPE_SCHEMA
                and recipe.get("version") == COLLAB_RECIPE_VERSION):
            return recipe

    from models import CardType, Creator, Gallery, Image, gallery_creators

    card_type = card.card_type.value if hasattr(card.card_type, "value") else card.card_type
    if card_type != CardType.collab.value:
        raise ValueError("Collab preparation requires a Collab card")
    try:
        metadata = json.loads(card.collab_data or "{}")
    except (TypeError, ValueError) as exc:
        raise ValueError("Collab card has invalid participant metadata") from exc
    creator_ids = metadata.get("creator_ids") or []
    creator_names = metadata.get("creator_names") or []
    if len(creator_names) < 2:
        raise ValueError("Collab card is missing real participant names")

    source = db.query(Image).filter(Image.id == card.source_image_id).first() if card.source_image_id else None
    gallery_id = card.source_gallery_id or (source.gallery_id if source else None)
    if not source or source.is_video or not source.width or not source.height or not os.path.isfile(source.file_path):
        candidates = db.query(Image).filter(
            Image.gallery_id == gallery_id, Image.is_video == False,  # noqa: E712
            Image.width.isnot(None), Image.height.isnot(None),
        ).all() if gallery_id else []
        candidates = [image for image in candidates if os.path.isfile(image.file_path)]
        source = max(candidates, key=_source_score) if candidates else None
    if not source:
        raise ValueError("Collab card has no eligible full-resolution still image")
    card.source_image_id = source.id
    gallery = db.query(Gallery).filter(Gallery.id == (card.source_gallery_id or source.gallery_id)).first()
    metadata_characters = [
        str(name).strip() for name in (metadata.get("character_names") or []) if str(name or "").strip()
    ]
    linked_character_names = []
    if gallery and not metadata_characters:
        linked_character_names = [
            row[0] for row in db.query(Creator.name)
            .join(gallery_creators, gallery_creators.c.creator_id == Creator.id)
            .filter(
                gallery_creators.c.gallery_id == gallery.id,
                Creator.creator_type == "character",
            )
            .order_by(Creator.id.asc())
            .all()
        ]

    base_palette = extract_character_palette(source.file_path)
    palette = {
        "primary": base_palette["primary"], "secondary": base_palette["background"],
        "pop": base_palette["secondary"], "ink": base_palette["ink"],
    }
    period = None
    if gallery and gallery.period_year:
        from services.cards import format_period
        period = format_period(gallery.period_month, gallery.period_year)
    recipe = build_collab_recipe(
        rarity=card.rarity_class, subtype=metadata.get("subtype") or "image",
        creator_ids=creator_ids, creator_names=creator_names,
        character_names=metadata_characters or linked_character_names,
        gallery_name=gallery.name if gallery else None, period_label=period,
        card_id=f"CLB-{card.id:06d}", minted_at=card.generated_at,
        image_id=source.id, source_width=source.width, source_height=source.height,
        focal_x=source.focal_x if source.focal_x is not None else 0.5,
        focal_y=source.focal_y if source.focal_y is not None else 0.2,
        palette=palette,
    )
    card.visual_recipe = json.dumps(recipe, separators=(",", ":"), sort_keys=True)
    db.flush()
    return recipe


def backfill_collab_visuals(db) -> dict[str, int]:
    from models import Card, CardType

    prepared = failed = 0
    for card in db.query(Card).filter(
        Card.card_type == CardType.collab,
        Card.print_rarity.is_(None),
        Card.visual_recipe.is_(None),
    ).all():
        try:
            prepare_collab_visual(db, card)
            prepared += 1
        except Exception:
            failed += 1
    db.commit()
    return {"prepared": prepared, "failed": failed}

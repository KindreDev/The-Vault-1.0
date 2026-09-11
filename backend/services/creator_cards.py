"""Deterministic frozen recipes for TCG V2 Creator cards."""

from __future__ import annotations

import json
import math
import os
from datetime import datetime
from typing import Any, Iterable

from PIL import Image as PILImage

from services.character_cards import extract_character_palette


CREATOR_RECIPE_SCHEMA = "vault.creator-card-recipe"
CREATOR_RECIPE_VERSION = 2
# ``custom`` is the persisted legacy value behind the current Model/Other UI label.
CREATOR_CARD_TYPES = ("cosplayer", "ethot", "artist", "actress", "custom")


def creator_card_eligible_type(value: Any) -> bool:
    normalized = value.value if hasattr(value, "value") else value
    return str(normalized or "").strip().lower() in CREATOR_CARD_TYPES


def _rarity(value: str | None) -> str:
    normalized = str(value or "C").upper()
    return "SR" if normalized == "SSR" else normalized


def _creator_type_label(creator_type: str, custom_type: str | None = None) -> str:
    normalized = str(creator_type or "").strip().lower()
    labels = {
        "cosplayer": "Cosplayer",
        "ethot": "E-thot",
        "artist": "Artist",
        "actress": "Actress",
        "custom": "Model/Other",
    }
    return labels.get(normalized, normalized.replace("_", " ").title() or "Creator")


def build_creator_recipe(*, rarity: str, creator_id: int, creator_name: str,
                         creator_type: str, custom_type: str | None,
                         origin_label: str | None, card_id: str,
                         minted_at: datetime | str, image_id: int | None,
                         source_width: int, source_height: int, focal_x: float,
                         focal_y: float, palette: dict[str, str],
                         source_kind: str = "image") -> dict[str, Any]:
    normalized_rarity = _rarity(rarity)
    if normalized_rarity not in {"C", "R", "SR", "UR", "SPR"}:
        raise ValueError(f"Unsupported Creator rarity: {normalized_rarity}")
    if not creator_id or not str(creator_name or "").strip():
        raise ValueError("Creator recipe requires a real creator identity")
    if not creator_card_eligible_type(creator_type):
        raise ValueError("Creator cards require an eligible real creator type")
    if source_kind not in {"image", "avatar"}:
        raise ValueError(f"Unsupported Creator source kind: {source_kind}")
    if source_kind == "image" and not image_id:
        raise ValueError("Creator recipe requires a real source image ID")
    if source_width <= 0 or source_height <= 0:
        raise ValueError("Creator recipe requires valid source dimensions")
    minted_value = minted_at.isoformat() if isinstance(minted_at, datetime) else str(minted_at or "").strip()
    if not minted_value or not str(card_id or "").strip():
        raise ValueError("Creator recipe requires real mint identity")
    for role in ("background", "primary", "secondary", "ink"):
        value = str(palette.get(role, ""))
        if len(value) != 7 or not value.startswith("#"):
            raise ValueError(f"Invalid Creator palette role: {role}")
        int(value[1:], 16)

    return {
        "schema": CREATOR_RECIPE_SCHEMA,
        "version": CREATOR_RECIPE_VERSION,
        "cardType": "creator",
        "rarity": normalized_rarity,
        "templateId": "creator-archive-rail-v1",
        "snapshot": {
            "creatorId": int(creator_id),
            "creatorName": str(creator_name).strip(),
            "creatorType": str(creator_type).strip().lower(),
            "creatorTypeLabel": _creator_type_label(creator_type, custom_type),
            "originLabel": str(origin_label or "").strip() or None,
            "cardId": str(card_id).strip(),
            "mintedAt": minted_value,
        },
        "source": {
            "kind": source_kind,
            "imageId": int(image_id) if image_id else None,
            "creatorId": int(creator_id) if source_kind == "avatar" else None,
            "width": int(source_width),
            "height": int(source_height),
            "focalX": min(1.0, max(0.0, float(focal_x))),
            "focalY": min(1.0, max(0.0, float(focal_y))),
        },
        "palette": dict(palette),
        "effectHooks": ["photograph", "background-foil", "subject-foil", "edge-foil", "editorial-pattern", "rail", "rarity", "signature", "serial"],
    }


def _source_score(image, *, directly_linked: bool) -> tuple:
    width, height = int(image.width or 0), int(image.height or 0)
    aspect = width / height if height else 0.0
    portrait_fit = max(0.0, 1.0 - abs(aspect - (2 / 3)))
    engagement = math.log1p(
        max(0, int(image.view_count or 0))
        + max(0, int(image.cum_count or 0)) * 8
        + max(0, int(image.view_seconds or 0)) / 30
    )
    return (
        1 if directly_linked else 0,
        1 if image.is_favorite else 0,
        float(image.rating or 0),
        round(engagement, 6),
        round(portrait_fit, 6),
        width * height,
        -int(image.id or 0),
    )


def select_creator_source(db, creator_id: int, *, excluded_image_ids: Iterable[int] = ()) -> dict[str, Any] | None:
    """Select a real still portrait from this creator's own collection links."""
    from sqlalchemy import or_, select
    from models import Creator, Gallery, Image, gallery_creators, image_creators

    creator = db.query(Creator).filter(Creator.id == creator_id).first()
    if not creator:
        raise ValueError("Creator not found")
    creator_type = creator.creator_type.value if hasattr(creator.creator_type, "value") else creator.creator_type
    if not creator_card_eligible_type(creator_type):
        raise ValueError("Creator card requires a cosplayer, e-thot, artist, actress, or Model/Other entity")

    linked_gallery_ids = select(gallery_creators.c.gallery_id).where(
        gallery_creators.c.creator_id == creator_id
    )
    direct_image_ids = {
        row[0] for row in db.query(image_creators.c.image_id).filter(
            image_creators.c.creator_id == creator_id
        ).all()
    }
    excluded = {int(value) for value in excluded_image_ids if value}
    query = db.query(Image).filter(
        Image.is_video == False,  # noqa: E712
        Image.file_path.isnot(None),
        Image.width.isnot(None),
        Image.height.isnot(None),
        or_(
            Image.id.in_(direct_image_ids or {-1}),
            Image.gallery_id.in_(linked_gallery_ids),
            Image.gallery_id.in_(select(Gallery.id).where(Gallery.creator_id == creator_id)),
        ),
    )
    if excluded:
        query = query.filter(~Image.id.in_(excluded))
    candidates = [
        image for image in query.all()
        if int(image.width or 0) > 0 and int(image.height or 0) > 0
        and os.path.isfile(image.file_path)
    ]
    if candidates:
        chosen = max(candidates, key=lambda image: _source_score(
            image, directly_linked=image.id in direct_image_ids,
        ))
        return {"kind": "image", "image": chosen, "creator": creator}

    if creator.avatar_path and os.path.isfile(creator.avatar_path):
        with PILImage.open(creator.avatar_path) as avatar:
            width, height = avatar.size
        return {
            "kind": "avatar", "image": None, "creator": creator,
            "path": creator.avatar_path, "width": width, "height": height,
        }
    return None


def prepare_creator_visual(db, card) -> dict[str, Any]:
    """Freeze one Creator card's real identity, source portrait, and printed data."""
    if card.visual_recipe:
        recipe = json.loads(card.visual_recipe)
        if recipe.get("schema") == CREATOR_RECIPE_SCHEMA and recipe.get("version") == CREATOR_RECIPE_VERSION:
            return recipe

    from models import CardType, Creator, Image

    card_type = card.card_type.value if hasattr(card.card_type, "value") else card.card_type
    if card_type != CardType.creator.value or not card.source_creator_id:
        raise ValueError("Creator preparation requires a Creator card with a real creator")
    creator = db.query(Creator).filter(Creator.id == card.source_creator_id).first()
    if not creator:
        raise ValueError("Creator card source identity is missing")
    if not creator_card_eligible_type(creator.creator_type):
        raise ValueError("Creator card source is not an eligible real creator type")

    image = db.query(Image).filter(Image.id == card.source_image_id).first() if card.source_image_id else None
    if image and (image.is_video or not image.width or not image.height or not os.path.isfile(image.file_path)):
        image = None
    if image:
        selection = {"kind": "image", "image": image, "creator": creator}
    else:
        selection = select_creator_source(db, creator.id)
    if not selection:
        raise ValueError("Creator has no eligible full-resolution portrait or avatar")

    source_kind = selection["kind"]
    image = selection.get("image")
    source_path = image.file_path if image else selection["path"]
    width = int(image.width if image else selection["width"])
    height = int(image.height if image else selection["height"])
    focal_x = float(image.focal_x if image and image.focal_x is not None else 0.5)
    focal_y = float(image.focal_y if image and image.focal_y is not None else 0.2)
    if image:
        card.source_image_id = image.id

    raw_type = creator.creator_type.value if hasattr(creator.creator_type, "value") else creator.creator_type
    recipe = build_creator_recipe(
        rarity=card.rarity_class,
        creator_id=creator.id,
        creator_name=creator.name,
        creator_type=raw_type,
        custom_type=creator.custom_type,
        origin_label=creator.country or creator.origin,
        card_id=f"CRT-{card.id:06d}",
        minted_at=card.generated_at,
        image_id=image.id if image else None,
        source_width=width,
        source_height=height,
        focal_x=focal_x,
        focal_y=focal_y,
        palette=extract_character_palette(source_path),
        source_kind=source_kind,
    )
    card.visual_recipe = json.dumps(recipe, separators=(",", ":"), sort_keys=True)
    db.flush()
    return recipe


def backfill_creator_visuals(db) -> dict[str, int]:
    from models import Card, CardType

    prepared = failed = 0
    for card in db.query(Card).filter(
        Card.card_type == CardType.creator,
        Card.print_rarity.is_(None),
        Card.visual_recipe.is_(None),
    ).all():
        try:
            prepare_creator_visual(db, card)
            prepared += 1
        except Exception:
            failed += 1
    db.commit()
    return {"prepared": prepared, "failed": failed}

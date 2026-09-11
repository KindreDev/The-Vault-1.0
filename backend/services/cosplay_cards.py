"""Deterministic TCG V2 Cosplay recipes for creator×character cards."""

from __future__ import annotations

import hashlib
import json
import math
import os
from datetime import datetime
from typing import Any

from services.character_cards import extract_character_palette


COSPLAY_RECIPE_SCHEMA = "vault.cosplay-card-recipe"
COSPLAY_RECIPE_VERSION = 2
COSPLAY_MOTIFS = (
    "blossom", "star", "heart", "flame", "moon",
    "crown", "note", "paw", "aperture",
)


def choose_cosplay_motif(character_name: str, series: str | None = None) -> str:
    """Persisted decorative choice, seeded only by real identity metadata."""
    seed = f"{character_name.strip().casefold()}|{(series or '').strip().casefold()}"
    index = int.from_bytes(hashlib.sha256(seed.encode("utf-8")).digest()[:4], "big")
    return COSPLAY_MOTIFS[index % len(COSPLAY_MOTIFS)]


def _top_label(series: str | None) -> str:
    franchise = str(series or "").strip()
    return f"{franchise} Cosplay" if franchise else "Cosplay"


def _pairing_label(creator_name: str, character_name: str) -> str:
    return f"{creator_name.strip()} as {character_name.strip()}"


def build_cosplay_recipe(*, rarity: str, creator_id: int, creator_name: str,
                         creator_type: str, character_id: int, character_name: str,
                         series: str | None, gallery_name: str | None,
                         period_label: str | None, card_id: str,
                         minted_at: datetime | str, image_id: int,
                         source_width: int, source_height: int,
                         focal_x: float, focal_y: float,
                         palette: dict[str, str], hero_motif: str) -> dict[str, Any]:
    rarity = str(rarity or "").upper()
    if rarity not in {"C", "R", "SR", "UR", "SPR"}:
        raise ValueError(f"Unsupported Cosplay rarity: {rarity}")
    if not creator_id or not character_id or not image_id:
        raise ValueError("Cosplay recipe requires real creator, character, and image IDs")
    required = {
        "creatorName": creator_name,
        "creatorType": creator_type,
        "characterName": character_name,
        "cardId": card_id,
    }
    missing = [key for key, value in required.items() if not str(value or "").strip()]
    if missing:
        raise ValueError("Cosplay recipe missing real data: " + ", ".join(missing))
    if source_width <= 0 or source_height <= 0:
        raise ValueError("Cosplay recipe requires valid source dimensions")
    if hero_motif not in COSPLAY_MOTIFS:
        raise ValueError(f"Unsupported Cosplay hero motif: {hero_motif}")
    minted_value = minted_at.isoformat() if isinstance(minted_at, datetime) else str(minted_at or "").strip()
    if not minted_value:
        raise ValueError("Cosplay recipe missing real data: mintedAt")
    for role in ("primary", "secondary", "pop", "ink"):
        value = str(palette.get(role, ""))
        if len(value) != 7 or not value.startswith("#"):
            raise ValueError(f"Invalid Cosplay palette role: {role}")
        int(value[1:], 16)

    return {
        "schema": COSPLAY_RECIPE_SCHEMA,
        "version": COSPLAY_RECIPE_VERSION,
        "cardType": "cosplay",
        "rarity": rarity,
        "templateId": "cosplay-comic-print-v1",
        "snapshot": {
            "creatorId": creator_id,
            "creatorName": str(creator_name).strip(),
            "creatorType": str(creator_type).strip(),
            "characterId": character_id,
            "characterName": str(character_name).strip(),
            "series": str(series or "").strip() or None,
            "galleryName": str(gallery_name or "").strip() or None,
            "topLabel": _top_label(series),
            "pairingLabel": _pairing_label(creator_name, character_name),
            "periodLabel": str(period_label or "").strip() or None,
            "cardId": str(card_id).strip(),
            "mintedAt": minted_value,
        },
        "source": {
            "kind": "image",
            "imageId": image_id,
            "width": int(source_width),
            "height": int(source_height),
            "focalX": min(1.0, max(0.0, float(focal_x))),
            "focalY": min(1.0, max(0.0, float(focal_y))),
        },
        "palette": dict(palette),
        "heroMotif": hero_motif,
        "effectHooks": ["photograph", "background-foil", "subject-foil", "edge-foil", "frame", "motifs", "rarity", "signature"],
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
        1 if image.is_favorite else 0,
        float(image.rating or 0),
        round(engagement, 6), round(portrait_fit, 6),
        width * height, -int(image.id or 0),
    )


def _pair_images(db, creator_id: int, character_id: int):
    from sqlalchemy import select
    from models import Gallery, Image, gallery_creators

    creator_galleries = select(gallery_creators.c.gallery_id).where(
        gallery_creators.c.creator_id == creator_id
    )
    character_galleries = select(gallery_creators.c.gallery_id).where(
        gallery_creators.c.creator_id == character_id
    )
    return db.query(Image).filter(
        Image.gallery_id.in_(creator_galleries),
        Image.gallery_id.in_(character_galleries),
        Image.is_video == False,  # noqa: E712
        Image.width.isnot(None), Image.height.isnot(None),
    ).all()


def prepare_cosplay_visual(db, card) -> dict[str, Any]:
    """Freeze a real creator×character Cosplay recipe on a legacy variant card."""
    if card.visual_recipe:
        recipe = json.loads(card.visual_recipe)
        if (recipe.get("schema") == COSPLAY_RECIPE_SCHEMA
                and recipe.get("version") == COSPLAY_RECIPE_VERSION):
            return recipe

    from models import CardType, Creator, Gallery, Image

    card_type = card.card_type.value if hasattr(card.card_type, "value") else card.card_type
    if card_type != CardType.variant.value:
        raise ValueError("Cosplay preparation requires a creator×character variant card")
    creator = db.query(Creator).filter(Creator.id == card.source_creator_id).first()
    character = db.query(Creator).filter(Creator.id == card.linked_character_id).first()
    if not creator or not character:
        raise ValueError("Cosplay card is missing its real creator or character")
    character_type = character.creator_type.value if hasattr(character.creator_type, "value") else character.creator_type
    if character_type != "character":
        raise ValueError("Cosplay card link does not point to a character-type creator")

    source = db.query(Image).filter(Image.id == card.source_image_id).first() if card.source_image_id else None
    if not source or source.is_video or not source.width or not source.height or not os.path.isfile(source.file_path):
        candidates = [image for image in _pair_images(db, creator.id, character.id)
                      if image.width and image.height and os.path.isfile(image.file_path)]
        source = max(candidates, key=_source_score) if candidates else None
    if not source:
        raise ValueError("Cosplay card has no eligible full-resolution still image")
    card.source_image_id = source.id

    gallery = db.query(Gallery).filter(Gallery.id == source.gallery_id).first()
    creator_type = creator.creator_type.value if hasattr(creator.creator_type, "value") else creator.creator_type
    base_palette = extract_character_palette(source.file_path)
    palette = {
        "primary": base_palette["primary"],
        "secondary": base_palette["background"],
        "pop": base_palette["secondary"],
        "ink": base_palette["ink"],
    }
    period = None
    if gallery and gallery.period_year:
        from services.cards import format_period
        period = format_period(gallery.period_month, gallery.period_year)
    recipe = build_cosplay_recipe(
        rarity=(card.rarity_class or "C"),
        creator_id=creator.id, creator_name=creator.name, creator_type=str(creator_type),
        character_id=character.id, character_name=character.name, series=character.series,
        gallery_name=gallery.name if gallery else None, period_label=period,
        card_id=f"CSP-{card.id:06d}", minted_at=card.generated_at,
        image_id=source.id, source_width=source.width, source_height=source.height,
        focal_x=source.focal_x if source.focal_x is not None else 0.5,
        focal_y=source.focal_y if source.focal_y is not None else 0.2,
        palette=palette,
        hero_motif=choose_cosplay_motif(character.name, character.series),
    )
    card.visual_recipe = json.dumps(recipe, separators=(",", ":"), sort_keys=True)
    db.flush()
    return recipe


def backfill_cosplay_visuals(db) -> dict[str, int]:
    """Freeze recipes for pre-V2 creator×character cards, idempotently."""
    from models import Card, CardType

    cards = db.query(Card).filter(
        Card.card_type == CardType.variant,
        Card.print_rarity.is_(None),
        Card.visual_recipe.is_(None),
    ).all()
    prepared = failed = 0
    for card in cards:
        try:
            prepare_cosplay_visual(db, card)
            prepared += 1
        except Exception:
            failed += 1
    db.commit()
    return {"prepared": prepared, "failed": failed}

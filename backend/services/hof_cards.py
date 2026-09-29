"""Deterministic frozen recipes for TCG V2 Hall of Fame mementos."""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from PIL import Image as PILImage


HOF_RECIPE_SCHEMA = "vault.hall-of-fame-card-recipe"
HOF_RECIPE_VERSION = 2

HOF_PERIOD_TYPES = {"day", "week", "month", "alltime"}
HOF_CROWN_BASELINE_RARITY = {
    "day": "epic", "week": "legendary", "month": "celestial", "alltime": "epic",
}
HOF_CROWN_PRINT_RARITY = {"day": "R", "week": "SR", "month": "UR", "alltime": "SPR"}


def hof_source_media_type(image) -> str | None:
    """Classify HOF art for video-like rendering, including animated GIFs."""
    if image is None:
        return None
    if bool(getattr(image, "is_video", False)):
        return "video"
    mime_type = str(getattr(image, "mime_type", "") or "").split(";", 1)[0].strip().lower()
    extension = Path(str(getattr(image, "file_path", "") or "")).suffix.lower()
    if mime_type == "image/gif" or extension == ".gif":
        return "gif"
    return "image"


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


def format_hof_provenance(*, crown=None, award=None, recipe=None, creator_name=None,
                          image_kind=None, gallery_name=None) -> dict[str, Any] | None:
    """Describe what won and when using only recorded crown/recipe evidence."""
    from services.cards import HOF_BOARD_LABEL, format_hof_period

    snapshot = recipe.get("snapshot") or {} if isinstance(recipe, dict) else {}
    source = recipe.get("source") or {} if isinstance(recipe, dict) else {}
    if not isinstance(snapshot, dict):
        snapshot = {}
    if not isinstance(source, dict):
        source = {}
    period_type = getattr(crown, "period_type", None) or snapshot.get("periodType")
    if period_type not in HOF_PERIOD_TYPES:
        return None
    period_key = getattr(crown, "period_key", None)
    period_label = (
        format_hof_period(period_type, period_key) if period_key
        else snapshot.get("periodLabel")
    )
    if not period_label:
        return None
    board_label = HOF_BOARD_LABEL.get(period_type) or snapshot.get("boardLabel")
    award_category = ("creator" if crown else getattr(award, "category_type", None)
                      or snapshot.get("awardCategory"))
    if award_category not in {"creator", "media", "gallery"}:
        return None
    if award_category == "creator":
        recipient_type = "creator"
        recipient_name = creator_name or snapshot.get("creatorName")
    elif award_category == "media" and image_kind in {"video", "gif"}:
        recipient_type = "video"
        recipient_name = creator_name or snapshot.get("creatorName")
    elif award_category == "media":
        recipient_type = "photo"
        recipient_name = creator_name or snapshot.get("creatorName")
    elif award_category == "gallery":
        recipient_type = "gallery"
        recipient_name = creator_name or snapshot.get("creatorName") or gallery_name
    elif image_kind in {"video", "gif"}:
        recipient_type = "video"
        recipient_name = None
    elif image_kind == "image":
        recipient_type = "photo"
        recipient_name = None
    elif source.get("kind") in {"avatar", "placeholder"}:
        recipient_type = "creator"
        recipient_name = creator_name or snapshot.get("creatorName")
    elif gallery_name or snapshot.get("galleryName"):
        recipient_type = "gallery"
        recipient_name = gallery_name or snapshot.get("galleryName")
    else:
        recipient_type = "media"
        recipient_name = None

    won_at = getattr(crown, "won_at", None) if crown else None
    award_date = won_at.date().isoformat() if won_at and hasattr(won_at, "date") else None
    return {
        "recipient_type": recipient_type,
        "recipient_name": recipient_name,
        "gallery_name": (
            None if recipient_type == "creator"
            else gallery_name or snapshot.get("galleryName")
        ),
        "period_type": period_type,
        "board_label": board_label,
        "period_label": period_label,
        "award_date": award_date,
    }


def build_hof_recipe(*, rarity: str, creator_id: int, creator_name: str,
                     creator_type: str, gallery_name: str | None,
                     board_label: str, period_label: str, card_id: str,
                     minted_at: datetime | str, image_id: int | None = None,
                     source_width: int = 2, source_height: int = 3,
                     focal_x: float, focal_y: float,
                     period_type: str | None = None,
                     source_kind: str = "image", source_creator_id: int | None = None,
                     historical_image_id: int | None = None,
                     award_category: str = "creator") -> dict[str, Any]:
    rarity = _rarity(rarity)
    if rarity not in {"C", "R", "SR", "UR", "SPR"}:
        raise ValueError(f"Unsupported Hall of Fame rarity: {rarity}")
    if award_category not in {"creator", "media", "gallery", "legacy"}:
        raise ValueError("Hall of Fame recipe requires a real award category")
    if not str(creator_name or "").strip():
        raise ValueError("Hall of Fame recipe requires a real winner label")
    if source_kind not in {"image", "avatar", "placeholder"}:
        raise ValueError("Hall of Fame recipe has an unsupported source kind")
    if source_kind == "image" and not image_id:
        raise ValueError("Hall of Fame image recipe requires its real source image")
    if source_kind != "image" and not source_creator_id and not (
            source_kind == "placeholder" and award_category in {"media", "gallery"}):
        raise ValueError("Hall of Fame avatar or placeholder requires its real creator ID")
    if source_width <= 0 or source_height <= 0:
        raise ValueError("Hall of Fame recipe requires valid source dimensions")
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
            "creatorId": int(creator_id) if creator_id else None, "creatorName": str(creator_name).strip(),
            "creatorTypeLabel": _creator_type_label(creator_type),
            "awardCategory": award_category,
            "galleryName": str(gallery_name or "").strip() or None,
            "boardLabel": str(board_label).strip(),
            "periodType": normalized_period_type,
            "periodLabel": str(period_label).strip(),
            "cardId": str(card_id).strip(), "mintedAt": minted_value,
        },
        "source": {
            "kind": source_kind,
            "imageId": int(image_id) if image_id else None,
            "creatorId": int(source_creator_id) if source_creator_id else None,
            "historicalImageId": int(historical_image_id) if historical_image_id else None,
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
    from models import CardType, Creator, Gallery, HofCategoryAward, HofCrown, Image
    from services.cards import HOF_BOARD_LABEL, format_hof_period

    card_type = card.card_type.value if hasattr(card.card_type, "value") else card.card_type
    if card_type != CardType.hof.value:
        raise ValueError("Hall of Fame preparation requires a real Hall of Fame card")
    creator = db.query(Creator).filter(Creator.id == card.source_creator_id).first() if card.source_creator_id else None
    crown = db.query(HofCrown).filter(HofCrown.card_id == card.id).first()
    award = db.query(HofCategoryAward).filter(HofCategoryAward.card_id == card.id).first()
    if not creator and not award:
        raise ValueError("Hall of Fame winner identity is unavailable")
    historical_image_id = ((crown.image_id if crown else None)
                           or (award.image_id if award else None) or card.source_image_id)
    award_category = "creator" if crown else award.category_type if award else "legacy"
    if card.visual_recipe:
        try:
            frozen = json.loads(card.visual_recipe)
            if frozen.get("schema") == HOF_RECIPE_SCHEMA and frozen.get("version") == HOF_RECIPE_VERSION:
                frozen_snapshot = frozen.get("snapshot") or {}
                if award_category != "legacy" and frozen_snapshot.get("awardCategory") != award_category:
                    frozen_snapshot["awardCategory"] = award_category
                    frozen["snapshot"] = frozen_snapshot
                    card.visual_recipe = json.dumps(frozen, separators=(",", ":"), sort_keys=True)
                    db.flush()
                frozen_source = frozen.get("source") or {}
                if frozen_source.get("kind") in {"avatar", "placeholder"}:
                    return frozen
                frozen_image = db.query(Image).filter(Image.id == frozen_source.get("imageId")).first()
                if (frozen_image and (award or not frozen_image.is_video) and frozen_image.width and frozen_image.height
                        and frozen_image.file_path and os.path.isfile(frozen_image.file_path)):
                    return frozen
        except (TypeError, ValueError):
            pass

    # Keep the crown's image_id and the card's source_image_id intact as
    # historical evidence. A fallback affects rendering only.
    candidate_ids = []
    for image_id in (historical_image_id, card.source_image_id):
        if image_id and image_id not in candidate_ids:
            candidate_ids.append(image_id)
    history_image = db.query(Image).filter(Image.id == historical_image_id).first() if historical_image_id else None
    image = None
    for image_id in candidate_ids:
        candidate = db.query(Image).filter(Image.id == image_id).first()
        if (candidate and (award or not candidate.is_video) and candidate.width and candidate.height
                and candidate.file_path and os.path.isfile(candidate.file_path)):
            image = candidate
            break
    gallery_id = (award.gallery_id if award and award.gallery_id else
                  image.gallery_id if image else history_image.gallery_id if history_image else card.source_gallery_id)
    gallery = db.query(Gallery).filter(Gallery.id == gallery_id).first() if gallery_id else None
    period_type = crown.period_type if crown else award.period_type if award else "alltime"
    period_key = crown.period_key if crown else award.period_key if award else None
    board_label = HOF_BOARD_LABEL.get(period_type)
    period_label = format_hof_period(period_type, period_key)
    raw_type = (creator.creator_type.value if hasattr(creator.creator_type, "value") else creator.creator_type) if creator else award_category.title()
    creator_name = creator.name if creator else (image.filename if award_category == "media" and image else gallery.name if gallery else "Hall of Fame Winner")
    source_kind = "image"
    source_creator_id = None
    source_image_id = image.id if image else None
    source_width = int(image.width) if image else 0
    source_height = int(image.height) if image else 0
    focal_x = image.focal_x if image and image.focal_x is not None else 0.5
    focal_y = image.focal_y if image and image.focal_y is not None else 0.2
    if not image:
        avatar_path = creator.avatar_path if creator else None
        if avatar_path and os.path.isfile(avatar_path):
            try:
                with PILImage.open(avatar_path) as avatar:
                    source_width, source_height = avatar.size
                if source_width > 0 and source_height > 0:
                    source_kind = "avatar"
                    source_creator_id = creator.id
                else:
                    source_width = source_height = 0
            except Exception:
                source_width = source_height = 0
        if not source_creator_id:
            source_kind = "placeholder"
            source_creator_id = creator.id if creator else None
            source_width, source_height = 2, 3
        source_image_id = None
        focal_x, focal_y = 0.5, 0.2
    recipe = build_hof_recipe(
        rarity=(card.print_rarity if not card.is_legacy and card.print_rarity else card.rarity_class),
        creator_id=creator.id if creator else None, creator_name=creator_name,
        creator_type=raw_type, gallery_name=gallery.name if gallery else None,
        board_label=board_label, period_label=period_label,
        period_type=period_type,
        card_id=f"HOF-{card.id:06d}", minted_at=card.generated_at,
        image_id=source_image_id, source_width=source_width, source_height=source_height,
        focal_x=focal_x, focal_y=focal_y, source_kind=source_kind,
        source_creator_id=source_creator_id, historical_image_id=historical_image_id,
        award_category=award_category,
    )
    card.visual_recipe = json.dumps(recipe, separators=(",", ":"), sort_keys=True)
    db.flush()
    return recipe


def _repair_frozen_recipe_rarity(card, rarity: str) -> tuple[bool, bool]:
    if not card.visual_recipe:
        return False, False
    try:
        recipe = json.loads(card.visual_recipe)
    except (TypeError, ValueError):
        return False, True
    if (not isinstance(recipe, dict) or recipe.get("schema") != HOF_RECIPE_SCHEMA
            or recipe.get("version") != HOF_RECIPE_VERSION):
        return False, True
    if recipe.get("rarity") == rarity:
        return False, False
    recipe["rarity"] = rarity
    card.visual_recipe = json.dumps(recipe, separators=(",", ":"), sort_keys=True)
    return True, False


def backfill_hof_visuals(db) -> dict[str, Any]:
    """Reconcile nonlegacy crown cards and frozen All-Time mementos idempotently."""
    from models import Card, CardType, Creator, HofCrown
    from services.cards import generate_card

    prepared = failed = recreated = print_rarity_repaired = 0
    recipe_rarity_repaired = rarity_class_repaired = 0
    recreated_by_period = {period: 0 for period in HOF_CROWN_PRINT_RARITY}
    crowns = db.query(HofCrown).filter(
        HofCrown.period_type.in_(tuple(HOF_CROWN_PRINT_RARITY)),
    ).order_by(HofCrown.id.asc()).all()

    for crown in crowns:
        period_type = crown.period_type
        print_rarity = HOF_CROWN_PRINT_RARITY[period_type]
        card = db.get(Card, crown.card_id) if crown.card_id is not None else None

        if crown.card_id is None:
            creator = db.get(Creator, crown.creator_id) if crown.creator_id else None
            baseline = HOF_CROWN_BASELINE_RARITY.get(period_type)
            if not creator or not baseline:
                failed += 1
                continue
            card = generate_card(
                db, "hof", source_creator_id=crown.creator_id,
                source_image_id=crown.image_id, baseline_override=baseline,
            )
            if period_type == "alltime":
                card.rarity_class = print_rarity
            card.print_rarity = print_rarity
            crown.card_id = card.id
            db.flush()
            recreated += 1
            recreated_by_period[period_type] += 1
        elif card is None:
            # A dangling non-null link is not a cardless crown; do not guess a
            # replacement by creator or image identity.
            continue

        card_type = card.card_type.value if hasattr(card.card_type, "value") else card.card_type
        if card_type != CardType.hof.value or card.is_legacy:
            continue

        if card.print_rarity != print_rarity:
            card.print_rarity = print_rarity
            print_rarity_repaired += 1
        if period_type == "alltime" and card.rarity_class != print_rarity:
            card.rarity_class = print_rarity
            rarity_class_repaired += 1

        if card.visual_recipe:
            repaired, invalid = _repair_frozen_recipe_rarity(card, print_rarity)
            recipe_rarity_repaired += int(repaired)
            failed += int(invalid)
        else:
            prepare_hof_visual(db, card)
            prepared += 1

    # Generic HOF mementos have no crown row. Their frozen recipe snapshot is
    # the authoritative period marker, so only explicit All-Time recipes join
    # this reconciliation; legacy cards and all other periods remain untouched.
    alltime_mementos = db.query(Card).filter(
        Card.card_type == CardType.hof,
        Card.is_legacy.is_(False),
        Card.visual_recipe.isnot(None),
    ).all()
    for card in alltime_mementos:
        try:
            recipe = json.loads(card.visual_recipe)
        except (TypeError, ValueError):
            continue
        snapshot = recipe.get("snapshot") if isinstance(recipe, dict) else None
        if not isinstance(snapshot, dict) or snapshot.get("periodType") != "alltime":
            continue

        print_rarity = HOF_CROWN_PRINT_RARITY["alltime"]
        if card.print_rarity != print_rarity:
            card.print_rarity = print_rarity
            print_rarity_repaired += 1
        if card.rarity_class != print_rarity:
            card.rarity_class = print_rarity
            rarity_class_repaired += 1
        repaired, invalid = _repair_frozen_recipe_rarity(card, print_rarity)
        recipe_rarity_repaired += int(repaired)
        failed += int(invalid)

    db.commit()
    return {
        "prepared": prepared,
        "failed": failed,
        "recreated": recreated,
        "recreated_by_period": recreated_by_period,
        "print_rarity_repaired": print_rarity_repaired,
        "recipe_rarity_repaired": recipe_rarity_repaired,
        "rarity_class_repaired": rarity_class_repaired,
    }

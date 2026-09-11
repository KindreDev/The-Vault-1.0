"""Earned, evolving TCG V2 Bond cards."""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any

from config import BOND_MILESTONES
from services.character_cards import extract_character_palette


BOND_RECIPE_SCHEMA = "vault.bond-card-recipe"
BOND_RECIPE_VERSION = 1


def migrate_legacy_bond_storage(db_engine) -> dict[str, int]:
    """Rename the retired earned-card storage contract without losing progress."""
    import sqlalchemy

    with db_engine.begin() as conn:
        old_count = conn.execute(sqlalchemy.text(
            "SELECT COUNT(*) FROM cards WHERE card_type = 'goon'"
        )).scalar() or 0
        old_table = conn.execute(sqlalchemy.text(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'goon_milestones'"
        )).first()
        milestone_count = 0

        if old_table:
            milestone_count = conn.execute(sqlalchemy.text(
                "SELECT COUNT(*) FROM goon_milestones"
            )).scalar() or 0
            conn.execute(sqlalchemy.text("""
                INSERT OR IGNORE INTO bond_milestones
                    (id, card_id, image_id, threshold, recorded_count, crossed_at)
                SELECT id, card_id, image_id, threshold, recorded_count, crossed_at
                FROM goon_milestones
            """))

        conn.execute(sqlalchemy.text(
            "UPDATE cards SET card_type = 'bond' WHERE card_type = 'goon'"
        ))
        conn.execute(sqlalchemy.text(
            "UPDATE creator_showcase SET slot = 'bond' WHERE slot = 'goon'"
        ))

        recipes = conn.execute(sqlalchemy.text(
            "SELECT id, visual_recipe FROM cards WHERE card_type = 'bond' AND visual_recipe IS NOT NULL"
        )).all()
        for card_id, raw_recipe in recipes:
            try:
                recipe = json.loads(raw_recipe)
            except (TypeError, ValueError):
                continue
            changed = False
            if recipe.get("schema") == "vault.goon-card-recipe":
                recipe["schema"] = BOND_RECIPE_SCHEMA
                changed = True
            if recipe.get("cardType") == "goon":
                recipe["cardType"] = "bond"
                changed = True
            if recipe.get("templateId") == "goon-pearlescent-hearts-v1":
                recipe["templateId"] = "bond-pearlescent-hearts-v1"
                changed = True
            snapshot = recipe.get("snapshot") or {}
            if str(snapshot.get("cardId") or "").upper().startswith("GON-"):
                snapshot["cardId"] = "BND-" + str(snapshot["cardId"])[4:]
                changed = True
            if changed:
                conn.execute(sqlalchemy.text(
                    "UPDATE cards SET visual_recipe = :recipe WHERE id = :card_id"
                ), {
                    "recipe": json.dumps(recipe, separators=(",", ":"), sort_keys=True),
                    "card_id": card_id,
                })

        if old_table:
            conn.execute(sqlalchemy.text("DROP TABLE goon_milestones"))

    return {"cards": int(old_count), "milestones": int(milestone_count)}


def _rarity(value: str | None) -> str:
    value = str(value or "C").upper()
    return "SR" if value == "SSR" else value


def _type_label(value: Any) -> str:
    value = value.value if hasattr(value, "value") else value
    value = str(value or "").lower()
    return {
        "cosplayer": "Cosplayer", "ethot": "E-thot", "artist": "Artist",
        "character": "Character", "actress": "Actress", "custom": "Model/Other",
    }.get(value, value.replace("_", " ").title() or "Creator")


def build_bond_recipe(*, rarity: str, image_id: int, creator_id: int | None,
                      creator_name: str | None, creator_type: str | None,
                      gallery_id: int, gallery_name: str, card_id: str,
                      period_label: str | None,
                      minted_at: datetime | str, source_width: int,
                      source_height: int, focal_x: float, focal_y: float,
                      palette: dict[str, str], cum_count: int,
                      milestones: list[dict[str, Any]]) -> dict[str, Any]:
    rarity = _rarity(rarity)
    if rarity not in {"C", "R", "SR", "UR", "SPR"}:
        raise ValueError(f"Unsupported Bond rarity: {rarity}")
    if not image_id or not gallery_id or not gallery_name or not card_id:
        raise ValueError("Bond recipe requires real image, gallery, and mint identity")
    if source_width <= 0 or source_height <= 0:
        raise ValueError("Bond recipe requires valid source dimensions")
    if cum_count < BOND_MILESTONES[0]:
        raise ValueError("Bond card has not reached its first milestone")
    current = max(value for value in BOND_MILESTONES if value <= cum_count)
    minted_value = minted_at.isoformat() if isinstance(minted_at, datetime) else str(minted_at)
    return {
        "schema": BOND_RECIPE_SCHEMA, "version": BOND_RECIPE_VERSION,
        "cardType": "bond", "rarity": rarity,
        "templateId": "bond-pearlescent-hearts-v1",
        "snapshot": {
            "imageId": int(image_id), "galleryId": int(gallery_id),
            "galleryName": str(gallery_name).strip(),
            "creatorId": int(creator_id) if creator_id else None,
            "creatorName": str(creator_name).strip() if creator_name else None,
            "creatorType": str(creator_type or "").lower() or None,
            "creatorTypeLabel": _type_label(creator_type),
            "periodLabel": str(period_label).strip() if period_label else None,
            "cardId": str(card_id), "mintedAt": minted_value,
        },
        "source": {
            "kind": "image", "imageId": int(image_id),
            "width": int(source_width), "height": int(source_height),
            "focalX": min(1.0, max(0.0, float(focal_x))),
            "focalY": min(1.0, max(0.0, float(focal_y))),
        },
        "palette": dict(palette),
        "earnedState": {
            "cumCount": int(cum_count), "currentMilestone": int(current),
            "milestones": milestones,
        },
        "effectHooks": ["art", "background-foil", "subject-foil", "edge-foil", "frame", "hearts", "sparkles", "rarity", "milestone", "text", "signature"],
    }


def _primary_creator(gallery):
    if gallery.creator:
        return gallery.creator
    linked = sorted(gallery.creators or [], key=lambda row: int(row.id or 0))
    return linked[0] if linked else None


def prepare_bond_visual(db, card) -> dict[str, Any]:
    from models import BondMilestone, CardType, Gallery, Image

    card_type = card.card_type.value if hasattr(card.card_type, "value") else card.card_type
    if card_type != CardType.bond.value or not card.source_image_id:
        raise ValueError("Bond preparation requires a Bond card with a real image")
    image = db.query(Image).filter(Image.id == card.source_image_id).first()
    if not image or not image.gallery_id or not image.width or not image.height or not os.path.isfile(image.file_path):
        raise ValueError("Bond card source image is unavailable")
    gallery = db.query(Gallery).filter(Gallery.id == image.gallery_id).first()
    if not gallery:
        raise ValueError("Bond card source gallery is unavailable")
    creator = _primary_creator(gallery)
    raw_type = None
    if creator:
        raw_type = creator.creator_type.value if hasattr(creator.creator_type, "value") else creator.creator_type
    rows = db.query(BondMilestone).filter(BondMilestone.card_id == card.id).order_by(BondMilestone.threshold).all()
    milestones = [{
        "threshold": row.threshold,
        "recordedCount": row.recorded_count,
        "crossedAt": row.crossed_at.isoformat() if row.crossed_at else None,
    } for row in rows]
    existing = None
    if card.visual_recipe:
        try:
            existing = json.loads(card.visual_recipe)
        except (TypeError, ValueError):
            pass
    frozen_snapshot = (existing or {}).get("snapshot") or {}
    frozen_source = (existing or {}).get("source") or {}
    palette_path = (
        image.thumb_path if image.is_video and image.thumb_path and os.path.isfile(image.thumb_path)
        else image.file_path
    )
    palette = (existing or {}).get("palette") or extract_character_palette(palette_path)
    from services.cards import format_period
    recipe = build_bond_recipe(
        rarity=card.rarity_class, image_id=image.id,
        creator_id=frozen_snapshot.get("creatorId", creator.id if creator else None),
        creator_name=frozen_snapshot.get("creatorName", creator.name if creator else None),
        creator_type=frozen_snapshot.get("creatorType", raw_type),
        gallery_id=frozen_snapshot.get("galleryId", gallery.id),
        gallery_name=frozen_snapshot.get("galleryName", gallery.name),
        card_id=frozen_snapshot.get("cardId", f"BND-{card.id:06d}"),
        period_label=frozen_snapshot.get("periodLabel", format_period(gallery.period_month, gallery.period_year)),
        minted_at=frozen_snapshot.get("mintedAt", card.generated_at),
        source_width=frozen_source.get("width", image.width),
        source_height=frozen_source.get("height", image.height),
        focal_x=frozen_source.get("focalX", image.focal_x if image.focal_x is not None else 0.5),
        focal_y=frozen_source.get("focalY", image.focal_y if image.focal_y is not None else 0.2),
        palette=palette, cum_count=int(image.cum_count or 0), milestones=milestones,
    )
    card.visual_recipe = json.dumps(recipe, separators=(",", ":"), sort_keys=True)
    db.flush()
    return recipe


def sync_bond_card_for_image(db, image, *, live_event: bool = False,
                             occurred_at: datetime | None = None):
    """Mint at 5 and update the same card at 15/25."""
    from models import BondMilestone, Card, CardInventory, CardType
    from services.cards import generate_card

    count = int(image.cum_count or 0)
    if count < BOND_MILESTONES[0]:
        return None
    card = db.query(Card).filter(
        Card.card_type == CardType.bond,
        Card.source_image_id == image.id,
    ).order_by(Card.id).first()
    if not card:
        from services.physical_cards import grant_card_copy
        card = generate_card(db, "bond", source_image_id=image.id)
        db.flush()
        grant_card_copy(db, card.id)
    existing = {row.threshold: row for row in db.query(BondMilestone).filter(
        BondMilestone.card_id == card.id
    ).all()}
    event_time = occurred_at or (datetime.now() if live_event else None)
    changed = False
    for threshold in BOND_MILESTONES:
        if count < threshold or threshold in existing:
            continue
        db.add(BondMilestone(
            card_id=card.id, image_id=image.id, threshold=threshold,
            recorded_count=count,
            crossed_at=event_time if live_event and count == threshold else None,
        ))
        changed = True
    if changed or not card.visual_recipe:
        db.flush()
        prepare_bond_visual(db, card)
    return card


def backfill_existing_bond_visuals(db) -> dict[str, int]:
    from models import Card, CardType, Image

    prepared = failed = 0
    for card in db.query(Card).filter(
        Card.card_type == CardType.bond,
        Card.print_rarity.is_(None),
        Card.visual_recipe.is_(None),
    ).all():
        image = db.query(Image).filter(Image.id == card.source_image_id).first()
        try:
            if image:
                sync_bond_card_for_image(db, image, live_event=False)
                prepared += 1
        except Exception:
            failed += 1
    db.commit()
    return {"prepared": prepared, "failed": failed}

"""Seed one idempotent Hall of Fame media ladder for local renderer testing.

Usage (from ``backend``):
    python scripts/seed_hof_media_ladder.py

The utility chooses existing, file-backed HOF sources from the local database,
then creates exactly one image-backed and one video-backed card for each HOF
print rarity (R, SR, UR, SPR). It deliberately does not create HofCrown rows:
the cards carry frozen recipes with test period labels, while real HOF history
and ranking data remain untouched. Re-running the utility is a no-op after the
eight marked fixture cards exist.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path

from PIL import Image as PILImage


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database import SessionLocal  # noqa: E402
from models import (  # noqa: E402
    Card,
    CardAcquisition,
    CardRarity,
    CardType,
    Creator,
    Image,
)
from services.hof_cards import build_hof_recipe  # noqa: E402
from services.physical_cards import grant_card_copy  # noqa: E402


FIXTURE_MARKER = "hof-media-ladder-v1"
RARITIES = ("R", "SR", "UR", "SPR")
MEDIA_KINDS = ("image", "video")
RARITY_PERIODS = {
    "R": ("day", "Daily", "28 Sep 2026"),
    "SR": ("week", "Weekly", "Week 39, 2026"),
    "UR": ("month", "Monthly", "Sep 2026"),
    "SPR": ("alltime", "All-Time", "All-Time"),
}
RARITY_BASELINES = {
    "R": CardRarity.epic,
    "SR": CardRarity.legendary,
    "UR": CardRarity.celestial,
    "SPR": CardRarity.celestial,
}


def _audit(card: Card) -> dict:
    try:
        value = json.loads(card.mint_audit_json or "{}")
        return value if isinstance(value, dict) else {}
    except (TypeError, ValueError):
        return {}


def _fixture_cards(db) -> list[Card]:
    return [
        card for card in db.query(Card).filter(Card.card_type == CardType.hof).all()
        if _audit(card).get("developer_fixture") == FIXTURE_MARKER
    ]


def _source_dimensions(image: Image) -> tuple[int, int]:
    if image.width and image.height:
        return int(image.width), int(image.height)
    if image.thumb_path and os.path.isfile(image.thumb_path):
        try:
            with PILImage.open(image.thumb_path) as thumb:
                width, height = thumb.size
            if width > 0 and height > 0:
                return int(width), int(height)
        except (OSError, ValueError):
            pass
    # The media is still real and file-backed; this only protects the recipe
    # contract when an old video has no stored poster dimensions.
    return 2, 3


def _available_sources(db) -> dict[str, list[tuple[Creator, Image]]]:
    """Return distinct, existing HOF creator/source pairs by media kind."""
    sources = {kind: [] for kind in MEDIA_KINDS}
    used_creator_ids: set[int] = set()
    rows = (
        db.query(Card, Creator, Image)
        .join(Creator, Creator.id == Card.source_creator_id)
        .join(Image, Image.id == Card.source_image_id)
        .filter(
            Card.card_type == CardType.hof,
            Card.is_legacy.is_(False),
            Card.source_creator_id.isnot(None),
            Card.source_image_id.isnot(None),
        )
        .order_by(Card.id.asc())
        .all()
    )
    for _card, creator, image in rows:
        kind = "video" if image.is_video else "image"
        if kind not in sources or creator.id in used_creator_ids:
            continue
        if not image.file_path or not os.path.isfile(image.file_path):
            continue
        sources[kind].append((creator, image))
        used_creator_ids.add(creator.id)
        if all(len(items) >= len(RARITIES) for items in sources.values()):
            break
    return sources


def _make_card(db, *, rarity: str, kind: str, creator: Creator, image: Image) -> Card:
    period_type, board_label, period_label = RARITY_PERIODS[rarity]
    width, height = _source_dimensions(image)
    now = datetime.utcnow()
    card = Card(
        card_type=CardType.hof,
        rarity=RARITY_BASELINES[rarity],
        foil=False,
        is_relic=False,
        is_unique=True,
        source_image_id=image.id,
        source_creator_id=creator.id,
        rarity_class=rarity,
        print_rarity=rarity,
        is_legacy=False,
        generated_at=now,
        mint_audit_json=json.dumps({
            "developer_fixture": FIXTURE_MARKER,
            "media_kind": kind,
            "print_rarity": rarity,
            "source_image_id": image.id,
            "source_creator_id": creator.id,
        }, separators=(",", ":"), sort_keys=True),
    )
    db.add(card)
    db.flush()
    card.visual_recipe = json.dumps(
        build_hof_recipe(
            rarity=rarity,
            creator_id=creator.id,
            creator_name=creator.name,
            creator_type=creator.creator_type,
            gallery_name=image.gallery.name if image.gallery else None,
            board_label=board_label,
            period_label=period_label,
            period_type=period_type,
            card_id=f"HOF-TEST-{rarity}-{kind.upper()}-{card.id:06d}",
            minted_at=now,
            image_id=image.id,
            source_width=width,
            source_height=height,
            focal_x=image.focal_x if image.focal_x is not None else 0.5,
            focal_y=image.focal_y if image.focal_y is not None else 0.2,
            source_kind="image",
            historical_image_id=image.id,
            award_category="media",
        ),
        separators=(",", ":"),
        sort_keys=True,
    )
    acquisition = CardAcquisition(
        card_id=card.id,
        quantity=1,
        acquired_at=now,
        source_type="developer_fixture",
        source_id=FIXTURE_MARKER,
        notes="Local HOF image/video renderer test fixture.",
    )
    db.add(acquisition)
    db.flush()
    grant_card_copy(db, card.id, acquisition_id=acquisition.id, acquired_at=now)
    return card


def seed() -> dict:
    db = SessionLocal()
    try:
        existing = _fixture_cards(db)
        if existing:
            if len(existing) != len(RARITIES) * len(MEDIA_KINDS):
                raise RuntimeError(
                    f"Found {len(existing)} marked fixtures; refusing to create a partial ladder."
                )
            db.rollback()
            return {"created": 0, "existing": len(existing), "marker": FIXTURE_MARKER}

        sources = _available_sources(db)
        missing = [kind for kind in MEDIA_KINDS if len(sources[kind]) < len(RARITIES)]
        if missing:
            raise RuntimeError(
                "Not enough distinct file-backed HOF sources for: " + ", ".join(missing)
            )

        created = []
        source_index = {kind: 0 for kind in MEDIA_KINDS}
        for rarity in RARITIES:
            for kind in MEDIA_KINDS:
                creator, image = sources[kind][source_index[kind]]
                source_index[kind] += 1
                created.append(_make_card(
                    db, rarity=rarity, kind=kind, creator=creator, image=image,
                ))
        db.commit()
        return {
            "created": len(created),
            "existing": 0,
            "marker": FIXTURE_MARKER,
            "cards": [
                {
                    "id": card.id,
                    "rarity": card.print_rarity,
                    "media_kind": _audit(card).get("media_kind"),
                    "creator_id": card.source_creator_id,
                    "source_image_id": card.source_image_id,
                }
                for card in created
            ],
        }
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    print(json.dumps(seed(), indent=2, sort_keys=True))

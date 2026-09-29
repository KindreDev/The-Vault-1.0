"""TCG V2 collection, classification, release, pack, and binder services."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta
from functools import lru_cache
import hashlib
import json
import math
import random
import re
from threading import RLock
from typing import Iterable

from sqlalchemy import String, and_, cast, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, object_session

from models import (
    BondMilestone, Card, CardAcquisition, CardContentClassification, CardPack, CardType,
    CardInventory, CardPresentationOverride, CraftingMaterials, Creator, CreatorShowcase,
    Gallery, HofCrown, Image, Tag, TCGChecklistEntry, TCGBinder, TCGBinderSection,
    TCGBinderSlot, TCGPackOpening, TCGPackOpeningCard, TCGPackProduct,
    TCGPackToken, TCGRelease, TCGSet, TCGSettings, TCGWorkshopUnlock,
    TCGPhysicalCardCopy, TCGDisplayAssignment, TCGOnlineOrder, TCGOnlineOrderLine,
    TCGParcel, TCGParcelPack,
    TCGSetupState, UserProfile, gallery_creators, gallery_tags, image_creators, image_tags,
)
from services.cards import _card_to_dict, prepare_card_face_for_reveal
from services.personal_value import apply_rarity_floor, evaluate_personal_value
from services.tcg_rarity import earned_card_pack_rarity


EXPOSURE_VALUES = (
    "Clothed", "Partial", "Implied nude", "Topless", "Bottomless",
    "Nude", "Mixed", "Unknown",
)
INTENSITY_VALUES = ("Safe", "Suggestive", "Explicit", "Unknown")
POLICY_VERSION = "classification-v2"
V2_SHARD_YIELD = {"C": 2, "R": 5, "SR": 15, "UR": 40, "SPR": 80}
PACK_RARITIES = ("C", "R", "SR", "UR", "SPR")
GENERIC_RELEASE_TEMPLATE_CODES = {"RELEASE-STANDARD", "RELEASE-PREMIUM"}
FROZEN_ENTRY_QUERY_BATCH_SIZE = 500
MONTHLY_RELEASE_TYPE_WEIGHTS = {
    "scene": 248,
    "gallery": 93,
    "creator": 93,
    "character": 93,
    "cosplay": 62,
    "collab": 31,
}
PACK_PRICE_DEFAULTS = {
    "release_standard": {"regular_price": 550, "launch_price": 700},
    "release_premium": {"regular_price": 1000, "launch_price": 1250},
}
PACK_PRICE_FORMULA_VERSION = "monthly-pack-price-v1"
PACK_PRICE_STEP = 25
PACK_PRICE_BOUNDS = {
    "release_standard": {
        "regular_price": (300, 900), "launch_price": (400, 1125),
    },
    "release_premium": {
        "regular_price": (600, 1600), "launch_price": (750, 2000),
    },
}
PACK_ODDS_DEFAULTS = {
    "release_standard": {"C": 0.57, "R": 0.30, "SR": 0.11, "UR": 0.018, "SPR": 0.002},
    "release_premium": {"SR": 0.80, "UR": 0.17, "SPR": 0.03},
}

# Monthly releases scale with the published Foundation base-card count, not
# with SPR parallels.  These anchors preserve the accepted September scale
# while making larger collections meaningfully broader without runaway packs.
MONTHLY_RELEASE_SIZE_FORMULA_VERSION = "monthly-release-size-v1"
MONTHLY_RELEASE_SIZE_ANCHORS = (
    (10_000, 300),
    (30_000, 460),
    (60_000, 620),
    (100_000, 800),
    (160_000, 1_000),
)
MONTHLY_RELEASE_SIZE_FLOOR = 120
MONTHLY_RELEASE_REFERENCE_TARGET = 620
MONTHLY_RELEASE_ALGORITHM_VERSION = "release-v6-six-type-mix"


def _round_pack_price(value: float) -> int:
    """Round prices deterministically to the nearest 25-credit step."""
    return int(math.floor(float(value) / PACK_PRICE_STEP + 0.5) * PACK_PRICE_STEP)


def monthly_pack_prices(product_kind: str, economy_modifier: float) -> dict:
    """Scale a future monthly product's prices from its frozen release size.

    The 1.0 reference preserves September exactly. Floors keep small libraries
    affordable without making packs trivial, and ceilings prevent a large
    catalogue from turning Premium into a whale-only sink.
    """
    if product_kind not in PACK_PRICE_DEFAULTS:
        raise ValueError(f"Unsupported monthly product kind: {product_kind}")
    modifier = max(0.01, float(economy_modifier or 0.0))
    values = {}
    for field, base in PACK_PRICE_DEFAULTS[product_kind].items():
        floor, ceiling = PACK_PRICE_BOUNDS[product_kind][field]
        values[field] = min(ceiling, max(floor, _round_pack_price(base * modifier)))
    return values


def _release_economy_modifier(release: TCGRelease | None) -> float:
    """Read the immutable modifier from a release manifest/report."""
    if not release:
        return 1.0
    for raw in (release.generation_report, release.manifest_json):
        payload = _json(raw, {})
        if payload.get("economy_modifier") is not None:
            return float(payload["economy_modifier"])
    return 1.0


def _release_price_metadata(release: TCGRelease | None, product_kind: str) -> dict:
    modifier = _release_economy_modifier(release)
    return {
        "formula_version": PACK_PRICE_FORMULA_VERSION,
        "economy_modifier": round(modifier, 6),
        "prices": monthly_pack_prices(product_kind, modifier),
    }

# More specific evidence wins. Terms are normalized before matching and are
# deliberately explicit: sexual intensity is not inferred from exposure alone.
EXPOSURE_TAGS = {
    "Nude": {"nude", "naked", "completely nude", "full nude", "fully nude"},
    "Bottomless": {"bottomless", "no panties", "panties removed"},
    "Topless": {"topless", "bare breasts", "exposed breasts", "nipples", "no bra"},
    "Implied nude": {"implied nude", "implied nudity", "covered nude", "strategic covering"},
    "Partial": {
        "lingerie", "underwear", "bikini", "swimsuit", "bra", "panties",
        "thong", "see through", "transparent clothing", "open clothes",
    },
    "Clothed": {
        "clothed", "fully clothed", "dress", "shirt", "white shirt",
        "collared shirt", "t shirt", "tshirt", "polo shirt", "uniform", "cosplay",
    },
}

EXPLICIT_TAGS = {
    "explicit", "sex", "sexual intercourse", "penetration", "vaginal", "vaginal sex",
    "anal", "anal sex", "blowjob", "fellatio", "cunnilingus", "oral sex",
    "masturbation", "fingering", "handjob", "cum", "cumshot", "creampie",
    "double penetration", "threesome", "gangbang", "sex toy", "dildo",
    "vibrator", "pussy", "penis", "anus", "bondage sex",
}
SUGGESTIVE_TAGS = {
    "suggestive", "erotic", "seductive", "provocative", "pinup", "lingerie",
    "underwear", "bikini", "swimsuit", "cleavage", "underboob", "sideboob",
    "cameltoe", "ass focus", "breast focus", "ecchi", "bedroom", "boudoir",
}
SAFE_TAGS = {"safe", "sfw", "nonsexual", "casual", "portrait"}


def _json(value, fallback):
    if value in (None, ""):
        return fallback
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


def _enum(value):
    return value.value if hasattr(value, "value") else value


def _acquisition_policy(card_type) -> dict:
    """Describe the immutable ownership policy for every published card."""
    earned_event = _enum(card_type) in {CardType.hof.value, CardType.bond.value}
    return {
        "is_earned_event": earned_event,
        "tradeable": not earned_event,
        "dismantleable": not earned_event,
        "reason": "Personally earned event card" if earned_event else None,
    }


def get_settings(db: Session) -> TCGSettings:
    row = db.query(TCGSettings).filter(TCGSettings.id == 1).first()
    if not row:
        row = TCGSettings(id=1)
        db.add(row)
        db.flush()
    return row


def settings_dict(row: TCGSettings) -> dict:
    return {
        "advanced_mode": bool(row.advanced_mode),
        "release_generation_mode": row.release_generation_mode,
        "ai_confidence_threshold": row.ai_confidence_threshold,
        "enabled_theme_sources": _json(row.enabled_theme_sources, []),
        "policy_version": row.policy_version,
    }


def update_settings(db: Session, values: dict) -> dict:
    row = get_settings(db)
    if "advanced_mode" in values:
        row.advanced_mode = bool(values["advanced_mode"])
    mode = values.get("release_generation_mode")
    if mode is not None:
        if mode not in {"automatic", "manual_review"}:
            raise ValueError("Release generation mode must be automatic or manual_review")
        row.release_generation_mode = mode
    if "ai_confidence_threshold" in values:
        threshold = float(values["ai_confidence_threshold"])
        if not 0.0 <= threshold <= 1.0:
            raise ValueError("AI confidence threshold must be between 0 and 1")
        row.ai_confidence_threshold = threshold
    if "enabled_theme_sources" in values:
        row.enabled_theme_sources = json.dumps(sorted(set(values["enabled_theme_sources"])))
    db.commit()
    return settings_dict(row)


def _card_source_image(db: Session, card: Card) -> Image | None:
    if card.source_image_id:
        return db.query(Image).filter(Image.id == card.source_image_id).first()
    if card.source_gallery_id:
        gallery = db.query(Gallery).filter(Gallery.id == card.source_gallery_id).first()
        if not gallery:
            return None
        if gallery.cover_path:
            image = db.query(Image).filter(
                Image.gallery_id == gallery.id,
                Image.file_path == gallery.cover_path,
            ).first()
            if image:
                return image
        return db.query(Image).filter(Image.gallery_id == gallery.id).order_by(Image.sort_order, Image.id).first()
    return None


def _tag_evidence(db: Session, image_id: int) -> list[dict]:
    rows = (
        db.query(Tag, image_tags.c.confidence, image_tags.c.tagger_model)
        .join(image_tags, image_tags.c.tag_id == Tag.id)
        .filter(image_tags.c.image_id == image_id)
        .all()
    )
    evidence = []
    for tag, confidence, model in rows:
        evidence.append({
            "id": tag.id,
            "name": tag.name,
            "normalized": " ".join(tag.name.lower().replace("_", " ").replace("-", " ").split()),
            "category": tag.category,
            "source": _enum(tag.source) or "manual",
            "confidence": confidence,
            "model": model,
        })
    evidence.sort(key=lambda item: (item["source"] != "manual", item["name"].lower()))
    return evidence


def _best_tag_match(tags: Iterable[dict], mapping: dict[str, set[str]], threshold: float):
    priorities = list(mapping.keys())
    matches = []
    for tag in tags:
        if tag["source"] != "manual" and (tag["confidence"] or 0) < threshold:
            continue
        for value, terms in mapping.items():
            if tag["normalized"] in terms:
                matches.append((tag["source"] == "manual", tag["confidence"] or 1.0, -priorities.index(value), value, tag))
    if not matches:
        return "Unknown", None, None
    matches.sort(reverse=True, key=lambda item: item[:3])
    _, confidence, _, value, tag = matches[0]
    return value, confidence, tag


def infer_classification(tags: list[dict], threshold: float) -> dict:
    exposure, exposure_confidence, exposure_tag = _best_tag_match(tags, EXPOSURE_TAGS, threshold)

    intensity = "Unknown"
    intensity_confidence = None
    intensity_tag = None
    intensity_maps = (("Explicit", EXPLICIT_TAGS), ("Suggestive", SUGGESTIVE_TAGS), ("Safe", SAFE_TAGS))
    candidates = []
    for tag in tags:
        if tag["source"] != "manual" and (tag["confidence"] or 0) < threshold:
            continue
        for rank, (value, terms) in enumerate(intensity_maps):
            if tag["normalized"] in terms:
                # Manual evidence wins, then the policy precedence wins, then
                # confidence breaks ties within the same intensity.
                candidates.append((tag["source"] == "manual", -rank, tag["confidence"] or 1.0, value, tag))
    if candidates:
        candidates.sort(reverse=True, key=lambda item: item[:3])
        _, _, intensity_confidence, intensity, intensity_tag = candidates[0]

    return {
        "exposure": exposure,
        "intensity": intensity,
        "exposure_confidence": exposure_confidence,
        "intensity_confidence": intensity_confidence,
        "exposure_evidence": exposure_tag,
        "intensity_evidence": intensity_tag,
    }


def _exposure_omitted(db: Session, card: Card) -> bool:
    card_type = _enum(card.card_type)
    if card_type == "creator" and card.source_creator_id:
        creator = db.query(Creator).filter(Creator.id == card.source_creator_id).first()
        return not creator or _enum(creator.creator_type) in {"character", "cosplayer", "ethot", "artist", "actress", "custom"}
    return False


def resolve_card_classification(db: Session, card: Card, *, refresh_ai: bool = False) -> CardContentClassification:
    settings = get_settings(db)
    row = db.query(CardContentClassification).filter(CardContentClassification.card_id == card.id).first()
    if not row:
        try:
            with db.begin_nested():
                row = CardContentClassification(card_id=card.id)
                db.add(row)
                db.flush()
        except IntegrityError:
            row = db.query(CardContentClassification).filter(CardContentClassification.card_id == card.id).first()
            if not row:
                raise

    image = _card_source_image(db, card)
    tags = _tag_evidence(db, image.id) if image else []
    inferred = infer_classification(tags, settings.ai_confidence_threshold)

    # Re-evaluate the AI cache from current source tags on every resolution.
    # This refreshes old Unknown values when vocabulary/evidence or this policy
    # changes, while manual overrides below remain authoritative.
    row.exposure_ai = inferred["exposure"]
    row.exposure_confidence = inferred["exposure_confidence"]
    row.intensity_ai = inferred["intensity"]
    row.intensity_confidence = inferred["intensity_confidence"]
    row.ai_model = image.ai_tag_model if image else None
    row.policy_version = POLICY_VERSION
    exposure_omitted = _exposure_omitted(db, card)
    row.evidence_json = json.dumps({
        "image_id": image.id if image else None,
        "tags": tags,
        "exposure_omitted": exposure_omitted,
    })
    if exposure_omitted:
        row.exposure_resolved = "Unknown"
    else:
        ai_exposure_valid = (row.exposure_confidence or 0) >= settings.ai_confidence_threshold
        row.exposure_resolved = row.exposure_manual or (row.exposure_ai if ai_exposure_valid else "Unknown") or "Unknown"
    ai_intensity_valid = (row.intensity_confidence or 0) >= settings.ai_confidence_threshold
    row.intensity_resolved = row.intensity_manual or (row.intensity_ai if ai_intensity_valid else "Unknown") or "Unknown"
    if row.exposure_manual or row.intensity_manual:
        row.metadata_source = "manual"
    elif (not exposure_omitted and (row.exposure_confidence or 0) >= settings.ai_confidence_threshold) or ai_intensity_valid:
        row.metadata_source = "ai"
    elif exposure_omitted and row.intensity_resolved == "Unknown":
        row.metadata_source = "omitted_for_identity_card"
    else:
        row.metadata_source = "unknown"

    if _enum(card.card_type) == "gallery" and card.source_gallery_id:
        distributions = {"exposure": Counter(), "intensity": Counter(), "classified": 0, "total": 0}
        gallery_images = db.query(Image).filter(Image.gallery_id == card.source_gallery_id).all()
        distributions["total"] = len(gallery_images)
        for gallery_image in gallery_images:
            result = infer_classification(_tag_evidence(db, gallery_image.id), settings.ai_confidence_threshold)
            if result["exposure"] != "Unknown" or result["intensity"] != "Unknown":
                distributions["classified"] += 1
            distributions["exposure"][result["exposure"]] += 1
            distributions["intensity"][result["intensity"]] += 1
        row.gallery_distribution = json.dumps({
            "exposure": dict(distributions["exposure"]),
            "intensity": dict(distributions["intensity"]),
            "classified": distributions["classified"],
            "total": distributions["total"],
        })
    db.flush()
    return row


def classification_dict(row: CardContentClassification) -> dict:
    exposure = row.exposure_resolved or "Unknown"
    intensity = row.intensity_resolved or "Unknown"
    evidence = _json(row.evidence_json, {})
    exposure_omitted = bool(evidence.get("exposure_omitted"))
    badge_parts = [value for value in (exposure, intensity) if value != "Unknown"]
    return {
        "exposure": exposure,
        "intensity": intensity,
        "badge": " · ".join(badge_parts) if badge_parts else None,
        "source": row.metadata_source,
        "sources": {
            "exposure": "omitted" if exposure_omitted else ("manual" if row.exposure_manual else ("ai" if exposure != "Unknown" else "unknown")),
            "intensity": "manual" if row.intensity_manual else ("ai" if intensity != "Unknown" else "unknown"),
        },
        "manual": {"exposure": row.exposure_manual, "intensity": row.intensity_manual},
        "ai": {
            "exposure": row.exposure_ai,
            "intensity": row.intensity_ai,
            "exposure_confidence": row.exposure_confidence,
            "intensity_confidence": row.intensity_confidence,
            "model": row.ai_model,
        },
        "policy_version": row.policy_version,
        "evidence": evidence,
        "gallery_distribution": _json(row.gallery_distribution, {}),
    }


def set_manual_classification(db: Session, card_id: int, exposure: str | None, intensity: str | None) -> dict:
    if exposure is not None and exposure not in EXPOSURE_VALUES:
        raise ValueError("Invalid exposure value")
    if intensity is not None and intensity not in INTENSITY_VALUES:
        raise ValueError("Invalid sexual intensity value")
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise ValueError("Card not found")
    row = resolve_card_classification(db, card)
    row.exposure_manual = None if exposure in (None, "AI") else exposure
    row.intensity_manual = None if intensity in (None, "AI") else intensity
    row = resolve_card_classification(db, card, refresh_ai=True)
    db.commit()
    return classification_dict(row)


def backfill_v2_records(db: Session) -> dict:
    settings = get_settings(db)
    acquisitions = 0
    classifications = 0
    inventory = db.query(CardInventory).all()
    for inv in inventory:
        exists = db.query(CardAcquisition.id).filter(CardAcquisition.card_id == inv.card_id).first()
        if not exists:
            db.add(CardAcquisition(
                card_id=inv.card_id,
                quantity=max(1, inv.quantity or 1),
                acquired_at=None,
                source_type="legacy_import",
                notes="Quantity preserved from pre-ledger inventory; acquisition date is unknown.",
            ))
            acquisitions += 1
        if not db.query(CardContentClassification.id).filter(CardContentClassification.card_id == inv.card_id).first():
            resolve_card_classification(db, inv.card)
            classifications += 1
    seed_foundation_release(db)
    seed_pack_products(db)
    seed_workshop(db)
    db.commit()
    return {"acquisitions": acquisitions, "classifications": classifications, "settings": settings_dict(settings)}


def _ensure_founder_sets(db: Session, release: TCGRelease) -> None:
    existing = db.query(TCGSet).filter(TCGSet.release_id == release.id).count()
    entry_count = db.query(TCGChecklistEntry.id).filter(TCGChecklistEntry.release_id == release.id).count()
    if existing >= 20 or entry_count < 100:
        return

    # The permanent catalogue is an open browsing pool. Its named sets are
    # compact selections, not one enormous artificial partition of every card.
    db.query(TCGChecklistEntry).filter(TCGChecklistEntry.release_id == release.id).update(
        {TCGChecklistEntry.set_id: None}, synchronize_session=False,
    )
    db.query(TCGSet).filter(TCGSet.release_id == release.id).delete(synchronize_session=False)
    db.flush()

    gallery_rows = (
        db.query(Gallery.id, Gallery.name, func.count(TCGChecklistEntry.id).label("amount"))
        .join(Image, Image.gallery_id == Gallery.id)
        .join(Card, Card.source_image_id == Image.id)
        .join(TCGChecklistEntry, TCGChecklistEntry.card_id == Card.id)
        .filter(TCGChecklistEntry.release_id == release.id)
        .group_by(Gallery.id, Gallery.name)
        .having(func.count(TCGChecklistEntry.id) >= 6)
        .order_by(func.count(TCGChecklistEntry.id).desc(), Gallery.name)
        .limit(12)
        .all()
    )
    year_rows = (
        db.query(Gallery.period_year, func.count(TCGChecklistEntry.id).label("amount"))
        .join(Image, Image.gallery_id == Gallery.id)
        .join(Card, Card.source_image_id == Image.id)
        .join(TCGChecklistEntry, TCGChecklistEntry.card_id == Card.id)
        .filter(TCGChecklistEntry.release_id == release.id, Gallery.period_year.isnot(None))
        .group_by(Gallery.period_year)
        .having(func.count(TCGChecklistEntry.id) >= 8)
        .order_by(Gallery.period_year.desc())
        .limit(5)
        .all()
    )
    type_rows = (
        db.query(Card.card_type, func.count(TCGChecklistEntry.id).label("amount"))
        .join(TCGChecklistEntry, TCGChecklistEntry.card_id == Card.id)
        .filter(TCGChecklistEntry.release_id == release.id)
        .group_by(Card.card_type)
        .having(func.count(TCGChecklistEntry.id) >= 8)
        .order_by(func.count(TCGChecklistEntry.id).desc())
        .all()
    )

    definitions = [
        {"source": "gallery", "key": gallery_id, "name": f"{name}: Selected Scenes", "description": f"A compact card selection from {name}."}
        for gallery_id, name, _ in gallery_rows
    ]
    definitions.extend(
        {"source": "year", "key": year, "name": f"The Best of {year}", "description": f"Favorite Vault printings dated {year}."}
        for year, _ in year_rows
    )
    definitions.extend(
        {"source": "card_type", "key": _enum(card_type), "name": TYPE_SET_NAMES.get(_enum(card_type), f"{_enum(card_type).title()} Collection"), "description": "A focused collection built around one card format."}
        for card_type, _ in type_rows
    )
    definitions.extend([
        {"source": "rarity", "key": "UR", "name": "The Ultra Cabinet", "description": "Thirty-five standout Ultra Rare printings."},
        {"source": "rarity", "key": "SR", "name": "Super Rare Selects", "description": "A hand-sized run of Super Rare favorites."},
        {"source": "rarity", "key": "R", "name": "Cosmos in the Dark", "description": "Rare printings with the Vault's classic cosmos finish."},
    ])

    created = 0
    for definition in definitions:
        if created >= 20:
            break
        query = (
            db.query(TCGChecklistEntry)
            .join(Card, Card.id == TCGChecklistEntry.card_id)
            .outerjoin(Image, Image.id == Card.source_image_id)
            .outerjoin(Gallery, or_(Gallery.id == Card.source_gallery_id, Gallery.id == Image.gallery_id))
            .filter(TCGChecklistEntry.release_id == release.id, TCGChecklistEntry.set_id.is_(None))
        )
        source, key = definition["source"], definition["key"]
        if source == "gallery":
            query = query.filter(or_(Card.source_gallery_id == key, Image.gallery_id == key))
        elif source == "year":
            query = query.filter(Gallery.period_year == key)
        elif source == "card_type":
            query = query.filter(Card.card_type == key)
        elif source == "rarity":
            query = query.filter(TCGChecklistEntry.published_rarity == key)
        selected = query.order_by(TCGChecklistEntry.collector_position).limit(35).all()
        if len(selected) < 4:
            continue
        created += 1
        tcg_set = TCGSet(
            release_id=release.id, code=f"FND-S{created:02d}", name=definition["name"],
            description=definition["description"], theme_key=str(key), theme_source=source,
            position=created, frozen_at=release.frozen_at,
        )
        db.add(tcg_set)
        db.flush()
        for entry in selected:
            entry.set_id = tcg_set.id

    while created < 20:
        selected = (
            db.query(TCGChecklistEntry)
            .filter(TCGChecklistEntry.release_id == release.id, TCGChecklistEntry.set_id.is_(None))
            .order_by(TCGChecklistEntry.collector_position)
            .limit(35)
            .all()
        )
        if len(selected) < 4:
            break
        created += 1
        tcg_set = TCGSet(
            release_id=release.id, code=f"FND-S{created:02d}", name=f"Founder's Finds, Volume {created}",
            description="A small discovery set drawn from the permanent catalogue.",
            theme_key=f"founders-finds-{created}", theme_source="discovery",
            position=created, frozen_at=release.frozen_at,
        )
        db.add(tcg_set); db.flush()
        for entry in selected:
            entry.set_id = tcg_set.id


def seed_foundation_release(db: Session) -> TCGRelease | None:
    release = db.query(TCGRelease).filter(TCGRelease.code == "FND-CORE").first()
    foundation_query = db.query(Card).filter(Card.is_legacy.is_(False), Card.catalog_code == "FND-001")
    card_count = foundation_query.count()
    if release:
        release.name = "Founder's Catalogue"
        release.description = "The permanent opening catalogue of the Vault TCG."
        entry_count = db.query(func.count(TCGChecklistEntry.id)).filter(TCGChecklistEntry.release_id == release.id).scalar() or 0
        if entry_count >= card_count:
            _ensure_founder_sets(db, release)
            db.commit()
            return release
    cards = foundation_query.order_by(Card.collector_number, Card.id).all()
    if not cards:
        return release
    now = datetime.utcnow()
    if not release:
        release = TCGRelease(
            code="FND-CORE", name="Founder's Catalogue", description="The permanent opening catalogue of the Vault TCG.",
            status="published", release_kind="foundation", generation_mode="automatic",
            generation_seed="foundation-catalog-v2", algorithm_version="foundation-v2-engagement-spr",
            published_at=now, available_from=now, frozen_at=now,
        )
        db.add(release)
        db.flush()
    tcg_set = db.query(TCGSet).filter(TCGSet.code == "FND-CORE-01").first()
    if not tcg_set:
        tcg_set = TCGSet(
            release_id=release.id, code="FND-CORE-01", name="Foundation Core",
            description="The opening frozen checklist.", position=1, frozen_at=release.frozen_at,
        )
        db.add(tcg_set)
        db.flush()
    existing_ids = {row[0] for row in db.query(TCGChecklistEntry.card_id).filter(TCGChecklistEntry.release_id == release.id).all()}
    used_numbers = {row[0] for row in db.query(TCGChecklistEntry.collector_position).filter(TCGChecklistEntry.release_id == release.id).all()}
    next_number = max(used_numbers or {0}) + 1
    for card in cards:
        if card.id in existing_ids:
            continue
        position = card.collector_number if card.collector_number and card.collector_number not in used_numbers else next_number
        while position in used_numbers:
            position += 1
        used_numbers.add(position)
        next_number = max(next_number, position + 1)
        rarity = card.print_rarity or card.rarity_class or "C"
        db.add(TCGChecklistEntry(
            release_id=release.id, set_id=tcg_set.id, card_id=card.id,
            collector_position=position, collector_suffix="S" if rarity == "SPR" else "",
            is_base_printing=rarity != "SPR", required_for_complete=rarity != "SPR",
            published_rarity=rarity, selection_reason="Foundation catalogue publication",
        ))
    total = db.query(func.count(TCGChecklistEntry.id)).filter(TCGChecklistEntry.release_id == release.id).scalar() or len(cards)
    release.algorithm_version = "foundation-v2-engagement-spr"
    release.manifest_json = json.dumps({
        "frozen": False, "base_total": total,
        "spr_target": round(total * 40 / 620), "append_only_spr": True,
        "spr_unlock_cum_threshold": 6, "source": "foundation_catalog",
    })
    tcg_set.manifest_json = release.manifest_json
    return release


def _release_pack_definition(product_kind: str) -> dict:
    if product_kind == "release_standard":
        return {
            "suffix": "STD", "name": "Standard Booster", "card_count": 6,
            "rarity_floor": "SR", "guaranteed_slots": ["SR_OR_HIGHER"],
        }
    return {
        "suffix": "PREM", "name": "Premium Booster", "card_count": 4,
        "rarity_floor": "SR", "guaranteed_slots": ["UR"],
    }


_automatic_pack_report_lock = RLock()


@lru_cache(maxsize=128)
def _cached_automatic_pack_report(config_json: str) -> str:
    """Cache deterministic pack simulations shared by concurrent read requests."""
    return json.dumps(simulate_pack(json.loads(config_json)), separators=(",", ":"))


def _automatic_pack_report(product: TCGPackProduct) -> dict:
    """Validate and simulate a persisted product with a stable evidence seed."""
    config = {
        "card_count": product.card_count,
        "rarity_floor": product.rarity_floor,
        "guaranteed_slots": _json(product.guaranteed_slots, []),
        "odds": _json(product.odds_json, {}),
        "runs": 20000,
        "seed": f"pack-product:{product.code}:v1",
    }
    cache_key = json.dumps(config, sort_keys=True, separators=(",", ":"))
    # lru_cache protects its data structure, but two simultaneous first calls
    # can still run the same expensive simulation before either result lands.
    with _automatic_pack_report_lock:
        return json.loads(_cached_automatic_pack_report(cache_key))


def _backfill_release_products(db: Session) -> None:
    """Repair one product per published release without creating duplicates."""
    releases = db.query(TCGRelease).filter(TCGRelease.status == "published").all()
    for release in releases:
        if not db.query(TCGChecklistEntry.id).filter(TCGChecklistEntry.release_id == release.id).first():
            continue
        for product_kind in ("release_standard", "release_premium"):
            definition = _release_pack_definition(product_kind)
            code = f"{release.code}-{definition['suffix']}"
            product = db.query(TCGPackProduct).filter(TCGPackProduct.code == code).first()
            price_metadata = _release_price_metadata(release, product_kind)
            if not product:
                product = TCGPackProduct(
                    code=code, name=f"{release.name} {definition['name']}",
                    product_kind=product_kind, release_id=release.id,
                    card_count=definition["card_count"], rarity_floor=definition["rarity_floor"],
                    guaranteed_slots=json.dumps(definition["guaranteed_slots"]),
                    odds_json=json.dumps(PACK_ODDS_DEFAULTS[product_kind]),
                    replacement_rules=json.dumps({"same_printing_twice": False}),
                    duplicate_protection=json.dumps({
                        "within_pack": True, "owned_cards_eligible": True,
                        "missing_weight": False, "pity": False,
                    }),
                    eligible_pool_json=json.dumps({
                        "release_id": release.id, "release_code": release.code,
                        "price_model": price_metadata,
                    }),
                    regular_price=price_metadata["prices"]["regular_price"],
                    launch_price=price_metadata["prices"]["launch_price"],
                    launch_days=7, available_from=release.available_from or release.published_at,
                    purchasable=True,
                )
                db.add(product)
                db.flush()
            else:
                product.name = f"{release.name} {definition['name']}"
                product.product_kind = product_kind
                product.release_id = release.id
                if not isinstance(_json(product.odds_json, None), dict) or not _json(product.odds_json, {}):
                    product.odds_json = json.dumps(PACK_ODDS_DEFAULTS[product_kind])
                if not isinstance(_json(product.guaranteed_slots, None), list) or not _json(product.guaranteed_slots, []):
                    product.guaranteed_slots = json.dumps(definition["guaranteed_slots"])
                if not product.card_count or product.card_count < 1:
                    product.card_count = definition["card_count"]
                if not product.rarity_floor:
                    product.rarity_floor = definition["rarity_floor"]
                if not product.regular_price:
                    product.regular_price = price_metadata["prices"]["regular_price"]
                if not product.launch_price:
                    product.launch_price = price_metadata["prices"]["launch_price"]
                if not product.launch_days:
                    product.launch_days = 7
                if not product.available_from:
                    product.available_from = release.available_from or release.published_at
                if not _json(product.eligible_pool_json, {}):
                    product.eligible_pool_json = json.dumps({
                        "release_id": release.id, "release_code": release.code,
                        "price_model": price_metadata,
                    })

            report = _automatic_pack_report(product)
            product.simulation_report = json.dumps(report)
            product.active = bool(report.get("approved"))
            product.purchasable = bool(report.get("approved"))


def seed_pack_products(db: Session) -> None:
    products = (
        {
            "code": "VAULT-PERMANENT", "name": "Permanent Vault Booster", "product_kind": "permanent",
            "card_count": 10, "rarity_floor": "SR", "guaranteed_slots": ["SR_OR_HIGHER"],
            "regular_price": 400, "active": True, "purchasable": True,
            "odds": {"weighted_slots": {"C": 0.60, "R": 0.28, "SR": 0.10, "UR": 0.018, "SPR": 0.002}},
            "duplicate_protection": {"within_pack": True, "owned_cards_eligible": True, "missing_weight": False},
        },
        {
            "code": "RELEASE-STANDARD", "name": "Standard Release Booster", "product_kind": "release_standard",
            "card_count": 6, "rarity_floor": "SR", "guaranteed_slots": ["SR_OR_HIGHER"],
            "regular_price": 0, "active": False, "purchasable": False,
        },
        {
            "code": "RELEASE-PREMIUM", "name": "Premium Release Booster", "product_kind": "release_premium",
            "card_count": 4, "rarity_floor": "SR", "guaranteed_slots": ["UR"],
            "regular_price": 0, "active": False, "purchasable": False,
        },
        {
            "code": "ALL-RELEASES-LIMITED", "name": "Limited All-Releases Booster", "product_kind": "limited",
            "card_count": 3, "rarity_floor": "SR", "guaranteed_slots": ["UR"],
            "regular_price": 0, "active": False, "purchasable": True,
        },
        {
            "code": "WEEKLY-PROTECTION", "name": "Weekly Protection Pack", "product_kind": "weekly_protection",
            "card_count": 4, "rarity_floor": "UR", "guaranteed_slots": ["UR", "UR", "UR", "SPR"],
            "regular_price": 0, "active": True, "purchasable": False,
            "duplicate_protection": {"prioritize_missing": True, "fallback_duplicates": True, "selected_release_required": True},
        },
    )
    for definition in products:
        product = db.query(TCGPackProduct).filter(TCGPackProduct.code == definition["code"]).first()
        if product:
            if definition["code"] in GENERIC_RELEASE_TEMPLATE_CODES:
                product.active = False
                product.purchasable = False
                product.simulation_report = json.dumps({
                    "approved": False, "template": True,
                    "reason": "Release products are created from a published release.",
                })
            continue
        db.add(TCGPackProduct(
            code=definition["code"], name=definition["name"], product_kind=definition["product_kind"],
            card_count=definition["card_count"], rarity_floor=definition["rarity_floor"],
            guaranteed_slots=json.dumps(definition["guaranteed_slots"]), odds_json=json.dumps(definition.get("odds", {})),
            replacement_rules=json.dumps({"same_printing_twice": False}),
            duplicate_protection=json.dumps(definition.get("duplicate_protection", {"within_pack": True, "owned_cards_eligible": True})),
            eligible_pool_json=json.dumps({"status": "configured_at_publication"}),
            regular_price=definition["regular_price"], active=definition["active"], purchasable=definition["purchasable"],
            simulation_report=json.dumps(
                {"approved": True, "reason": "Matches the already-published Foundation booster behavior."}
                if definition["code"] == "VAULT-PERMANENT"
                else {"approved": False, "template": definition["code"] in GENERIC_RELEASE_TEMPLATE_CODES},
            ),
        ))
    db.flush()
    _backfill_release_products(db)


def seed_workshop(db: Session) -> None:
    items = (
        ("SLV-OBSIDIAN", "sleeve", "Obsidian Sleeve", 60),
        ("SLV-PRISM", "premium_sleeve", "Prismatic Sleeve", 180),
        ("CASE-ACRYLIC", "case", "Acrylic Display Case", 240),
        ("STAND-BLACK", "stand", "Black Metal Stand", 120),
        ("BINDER-OPAL", "binder_cover", "Opaline Binder Cover", 300),
        ("FRAME-WALL", "wall_frame", "Illuminated Wall Frame", 420),
        ("LIGHT-ROSE", "room_light", "Rose Display Lighting", 360),
    )
    for code, item_type, name, cost in items:
        if not db.query(TCGWorkshopUnlock.id).filter(TCGWorkshopUnlock.item_code == code).first():
            db.add(TCGWorkshopUnlock(item_code=code, item_type=item_type, name=name, shard_cost=cost))


def _completion(db: Session, release_id: int, set_id: int | None = None) -> dict:
    q = db.query(TCGChecklistEntry).filter(TCGChecklistEntry.release_id == release_id)
    if set_id is not None:
        q = q.filter(TCGChecklistEntry.set_id == set_id)
    entries = q.order_by(TCGChecklistEntry.collector_position).all()
    owned = {row[0] for row in db.query(CardInventory.card_id).filter(CardInventory.quantity > 0).all()}
    base = [entry for entry in entries if entry.required_for_complete]
    master = entries
    owned_base = sum(entry.card_id in owned for entry in base)
    owned_master = sum(entry.card_id in owned for entry in master)
    return {
        "base_owned": owned_base, "base_total": len(base),
        "master_owned": owned_master, "master_total": len(master),
        "set_complete": bool(base) and owned_base == len(base),
        "master_set": bool(master) and owned_master == len(master),
        "percent": round((owned_base / len(base) * 100) if base else 0, 1),
    }


def _completion_by_rarity(db: Session, release_id: int, set_id: int | None = None) -> dict:
    q = db.query(TCGChecklistEntry).filter(TCGChecklistEntry.release_id == release_id)
    if set_id is not None:
        q = q.filter(TCGChecklistEntry.set_id == set_id)
    entries = q.all()
    owned = {row[0] for row in db.query(CardInventory.card_id).filter(CardInventory.quantity > 0).all()}
    result = {}
    for rarity in ("C", "R", "SR", "UR", "SPR"):
        rows = [entry for entry in entries if entry.published_rarity == rarity]
        result[rarity] = {"owned": sum(entry.card_id in owned for entry in rows), "total": len(rows)}
    return result


def _checklist_cover_cards(db: Session, release_id: int, set_id: int | None = None, limit: int = 3) -> list[dict]:
    q = db.query(TCGChecklistEntry).filter(TCGChecklistEntry.release_id == release_id)
    if set_id is not None:
        q = q.filter(TCGChecklistEntry.set_id == set_id)
    entries = q.order_by(TCGChecklistEntry.collector_position).limit(max(1, limit * 5)).all()
    cards = []
    for entry in entries:
        # Index covers only need source art. Avoid fully resolving masks and
        # every frozen face layer for dozens of cards on a collection index.
        art_url = f"/api/images/{entry.card.source_image_id}/file" if entry.card.source_image_id else None
        if not art_url:
            rendered = _card_to_dict(db, entry.card)
            art_url = rendered.get("art_url") or rendered.get("image_url") or rendered.get("source_url")
        if art_url:
            cards.append({"card_id": entry.card_id, "art_url": art_url})
        if len(cards) == limit:
            break
    return cards


def list_releases(db: Session) -> list[dict]:
    seed_foundation_release(db)
    db.commit()
    releases = db.query(TCGRelease).order_by(TCGRelease.published_at.desc(), TCGRelease.id.desc()).all()
    return [{
        "id": release.id, "code": release.code, "name": release.name,
        "description": release.description, "status": release.status,
        "release_kind": release.release_kind, "published_at": release.published_at.isoformat() if release.published_at else None,
        "cover_path": release.cover_path, "completion": _completion(db, release.id),
        "completion_by_rarity": _completion_by_rarity(db, release.id),
        "cover_cards": _checklist_cover_cards(db, release.id),
        "cover_design": {"layout": "release-collage-v1", "seed": release.generation_seed},
        "set_count": db.query(func.count(TCGSet.id)).filter(TCGSet.release_id == release.id).scalar() or 0,
        "validation": _json(release.validation_report, {}),
    } for release in releases]


def list_sets(db: Session) -> list[dict]:
    """Return every finite set as a first-class collection destination."""
    seed_foundation_release(db)
    db.commit()
    sets = (
        db.query(TCGSet)
        .join(TCGRelease, TCGRelease.id == TCGSet.release_id)
        .order_by(TCGRelease.published_at.desc(), TCGRelease.id.desc(), TCGSet.position)
        .all()
    )
    changed = False
    for item in sets:
        if item.release.release_kind == "foundation":
            continue
        source = "card_type" if item.theme_source == "type" else (item.theme_source or "")
        key = str(item.theme_key or item.name or "")
        collector_name = _theme_name(source, key, {})
        if collector_name and collector_name != item.name:
            item.name = collector_name
            changed = True
        if "eligible sources" in (item.description or "").lower():
            item.description = f"A focused selection from {item.release.name}, built around {collector_name}."
            changed = True
    if changed:
        db.commit()
    return [{
        "id": item.id,
        "code": item.code,
        "name": item.name,
        "description": item.description,
        "theme_key": item.theme_key,
        "theme_source": item.theme_source,
        "cover_path": item.cover_path,
        "release_id": item.release_id,
        "release_code": item.release.code,
        "release_name": item.release.name,
        "published_at": item.release.published_at.isoformat() if item.release.published_at else None,
        "completion": _completion(db, item.release_id, item.id),
        "completion_by_rarity": _completion_by_rarity(db, item.release_id, item.id),
        "cover_cards": _checklist_cover_cards(db, item.release_id, item.id, 1),
    } for item in sets]


def _source_key(card: Card, creator_types: dict[int, str] | None = None) -> str:
    """Return the stable identity of one source-card design.

    Audit provenance is authoritative for newer cards. The relationship-based
    fallback keeps older source cards distinct by card family and selected
    image, so one image can support its Scene, portrait, Cosplay, and Collab.
    """
    audit = _json(card.mint_audit_json, {})
    audited_key = audit.get("source_key") if isinstance(audit, dict) else None
    if isinstance(audited_key, str) and audited_key.strip():
        return audited_key.strip()

    card_type = _enum(card.card_type)
    if card_type == CardType.image.value and card.source_image_id:
        return f"image:{card.source_image_id}"
    if card_type == CardType.gallery.value and card.source_gallery_id:
        return f"gallery:{card.source_gallery_id}"
    if card_type == CardType.creator.value and card.source_creator_id:
        creator_type = (creator_types or {}).get(card.source_creator_id)
        if creator_type is None and card.source_creator:
            creator_type = _enum(card.source_creator.creator_type)
        is_character = creator_type == "character"
        family = "character" if is_character else "creator"
        identity = "canon" if card.source_image_id is None else f"portrait:{card.source_image_id}"
        return f"{family}:{card.source_creator_id}:{identity}"
    if card_type == CardType.variant.value and card.source_creator_id and card.linked_character_id:
        if card.source_image_id:
            return f"cosplay:{card.source_creator_id}:{card.linked_character_id}:image:{card.source_image_id}"
        return f"cosplay:{card.source_creator_id}:{card.linked_character_id}"
    if card_type == CardType.collab.value:
        collab = _json(card.collab_data, {})
        creator_ids = collab.get("creator_ids", []) if isinstance(collab, dict) else []
        normalized_ids = sorted({int(value) for value in creator_ids if str(value).isdigit()})
        prefix = f"collab:{','.join(map(str, normalized_ids))}"
        if card.source_image_id:
            return f"{prefix}:image:{card.source_image_id}"
        if card.source_gallery_id:
            return f"{prefix}:gallery:{card.source_gallery_id}"
    if card.source_image_id:
        return f"image:{card.source_image_id}"
    if card.source_gallery_id:
        return f"gallery:{card.source_gallery_id}"
    if card.source_creator_id:
        return f"creator:{card.source_creator_id}:canon"
    return f"card:{card.id}"


def _release_card_type(card: Card, creator_types: dict[int, str] | None = None) -> str:
    """Map storage types to the six visible monthly-release card types."""
    card_type = _enum(card.card_type)
    if card_type == CardType.image.value:
        return "scene"
    if card_type == CardType.gallery.value:
        return "gallery"
    if card_type == CardType.variant.value:
        return "cosplay"
    if card_type == CardType.collab.value:
        return "collab"
    if card_type == CardType.creator.value:
        creator_type = (creator_types or {}).get(card.source_creator_id)
        if creator_type is None and card.source_creator:
            creator_type = _enum(card.source_creator.creator_type)
        return "character" if creator_type == "character" else "creator"
    return ""


def _chunks(values: Iterable[int], size: int = 700):
    values = list(dict.fromkeys(value for value in values if value is not None))
    for index in range(0, len(values), size):
        yield values[index:index + size]


def _release_candidate_cache(db: Session, cards: list[Card], threshold: float) -> dict:
    """Batch the evidence used by monthly release selection.

    Foundation catalogs can contain tens of thousands of source cards. Keeping
    this data-oriented avoids a source image, tag, classification, and creator
    query for every individual candidate.
    """
    card_ids = [card.id for card in cards]
    direct_image_ids = {card.source_image_id for card in cards if card.source_image_id}
    gallery_ids = {card.source_gallery_id for card in cards if card.source_gallery_id}

    galleries = {}
    for chunk in _chunks(gallery_ids):
        galleries.update({row.id: row for row in db.query(Gallery).filter(Gallery.id.in_(chunk)).all()})

    gallery_images = {}
    for chunk in _chunks(gallery_ids):
        rows = db.query(Image).filter(Image.gallery_id.in_(chunk)).order_by(
            Image.gallery_id, Image.sort_order, Image.id,
        ).all()
        for image in rows:
            gallery = galleries.get(image.gallery_id)
            current = gallery_images.get(image.gallery_id)
            if current is None or (gallery and gallery.cover_path == image.file_path):
                gallery_images[image.gallery_id] = image

    images = {image.id: image for image in gallery_images.values()}
    missing_image_ids = direct_image_ids.difference(images)
    for chunk in _chunks(missing_image_ids):
        images.update({row.id: row for row in db.query(Image).filter(Image.id.in_(chunk)).all()})
    gallery_ids.update(image.gallery_id for image in images.values() if image.gallery_id)
    missing_gallery_ids = gallery_ids.difference(galleries)
    for chunk in _chunks(missing_gallery_ids):
        galleries.update({row.id: row for row in db.query(Gallery).filter(Gallery.id.in_(chunk)).all()})

    image_for_card = {}
    for card in cards:
        image_for_card[card.id] = (
            images.get(card.source_image_id)
            if card.source_image_id
            else gallery_images.get(card.source_gallery_id)
        )

    classifications = {}
    for chunk in _chunks(card_ids):
        rows = db.query(CardContentClassification).filter(
            CardContentClassification.card_id.in_(chunk),
        ).all()
        classifications.update({row.card_id: row for row in rows})

    tags_by_image = {}
    relevant_image_ids = {image.id for image in image_for_card.values() if image}
    for chunk in _chunks(relevant_image_ids):
        rows = (
            db.query(
                image_tags.c.image_id, Tag.id, Tag.name, Tag.category,
                Tag.source, Tag.is_favorite, image_tags.c.confidence, image_tags.c.tagger_model,
            )
            .join(Tag, Tag.id == image_tags.c.tag_id)
            .filter(
                image_tags.c.image_id.in_(chunk),
                or_(Tag.source == "manual", image_tags.c.confidence >= threshold),
            )
            .all()
        )
        for image_id, tag_id, name, category, source, favorite, confidence, model in rows:
            tags_by_image.setdefault(image_id, []).append({
                "id": tag_id,
                "name": name,
                "normalized": " ".join(name.lower().replace("_", " ").replace("-", " ").split()),
                "category": category,
                "source": _enum(source) or "manual",
                "is_favorite": bool(favorite),
                "confidence": confidence,
                "model": model,
                "coverage": 1.0,
            })
    for evidence in tags_by_image.values():
        evidence.sort(key=lambda item: (item["source"] != "manual", item["name"].lower()))

    gallery_view_seconds = {}
    favorite_tags_by_gallery = {}
    for chunk in _chunks(gallery_ids):
        gallery_view_seconds.update({gallery_id: int(seconds or 0) for gallery_id, seconds in db.query(
            Image.gallery_id, func.coalesce(func.sum(Image.view_seconds), 0),
        ).filter(Image.gallery_id.in_(chunk)).group_by(Image.gallery_id).all()})
        direct_rows = db.query(
            gallery_tags.c.gallery_id, Tag.id, Tag.name, Tag.source,
        ).join(Tag, Tag.id == gallery_tags.c.tag_id).filter(
            gallery_tags.c.gallery_id.in_(chunk),
            Tag.is_favorite.is_(True), Tag.source == "manual",
        ).all()
        for gallery_id, tag_id, name, source in direct_rows:
            favorite_tags_by_gallery.setdefault(gallery_id, []).append({
                "id": tag_id, "name": name,
                "normalized": " ".join(name.lower().replace("_", " ").replace("-", " ").split()),
                "source": _enum(source) or "manual", "is_favorite": True,
                "confidence": 1.0, "coverage": 1.0,
            })
        rows = db.query(
            Image.gallery_id, Tag.id, Tag.name, Tag.source,
            func.count(func.distinct(Image.id)),
        ).join(image_tags, image_tags.c.image_id == Image.id).join(
            Tag, Tag.id == image_tags.c.tag_id,
        ).filter(
            Image.gallery_id.in_(chunk), Tag.is_favorite.is_(True),
            or_(Tag.source == "manual", image_tags.c.confidence >= threshold),
        ).group_by(Image.gallery_id, Tag.id, Tag.name, Tag.source).all()
        for gallery_id, tag_id, name, source, matched in rows:
            gallery = galleries.get(gallery_id)
            denominator = max(1, int(gallery.image_count or 0) if gallery else 1)
            evidence = {
                "id": tag_id, "name": name,
                "normalized": " ".join(name.lower().replace("_", " ").replace("-", " ").split()),
                "source": _enum(source) or "manual", "is_favorite": True,
                "confidence": 1.0, "coverage": min(1.0, matched / denominator),
            }
            existing = next((item for item in favorite_tags_by_gallery.setdefault(gallery_id, []) if item["id"] == tag_id), None)
            if existing:
                existing["coverage"] = max(existing["coverage"], evidence["coverage"])
            else:
                favorite_tags_by_gallery[gallery_id].append(evidence)

    gallery_creator = {gallery_id: gallery.creator_id for gallery_id, gallery in galleries.items()}
    unresolved_galleries = {gallery_id for gallery_id, creator_id in gallery_creator.items() if not creator_id}
    for chunk in _chunks(unresolved_galleries):
        for gallery_id, creator_id in db.query(
            gallery_creators.c.gallery_id, gallery_creators.c.creator_id,
        ).filter(gallery_creators.c.gallery_id.in_(chunk)).order_by(
            gallery_creators.c.gallery_id, gallery_creators.c.creator_id,
        ).all():
            gallery_creator.setdefault(gallery_id, creator_id)

    image_creator = {}
    for chunk in _chunks(relevant_image_ids):
        for image_id, creator_id in db.query(
            image_creators.c.image_id, image_creators.c.creator_id,
        ).filter(image_creators.c.image_id.in_(chunk)).order_by(
            image_creators.c.image_id, image_creators.c.creator_id,
        ).all():
            image_creator.setdefault(image_id, creator_id)

    creator_ids = {card.source_creator_id for card in cards if card.source_creator_id}
    creator_ids.update(card.linked_character_id for card in cards if card.linked_character_id)
    creator_ids.update(creator_id for creator_id in gallery_creator.values() if creator_id)
    creator_ids.update(image_creator.values())
    creators = {}
    for chunk in _chunks(creator_ids):
        creators.update({row.id: row for row in db.query(Creator).filter(Creator.id.in_(chunk)).all()})

    return {
        "images": image_for_card,
        "classifications": classifications,
        "tags": tags_by_image,
        "gallery_creators": gallery_creator,
        "image_creators": image_creator,
        "creators": creators,
        "galleries": galleries,
        "gallery_view_seconds": gallery_view_seconds,
        "favorite_tags_by_gallery": favorite_tags_by_gallery,
    }


def _candidate_metadata_cached(card: Card, threshold: float, cache: dict, prior_printings: Counter | None = None) -> dict:
    image = cache["images"].get(card.id)
    tags = cache["tags"].get(image.id, []) if image else []
    stored = cache["classifications"].get(card.id)
    if stored:
        classification = {
            "exposure": stored.exposure_resolved, "intensity": stored.intensity_resolved,
            "exposure_confidence": stored.exposure_confidence, "intensity_confidence": stored.intensity_confidence,
        }
    else:
        classification = infer_classification(tags, threshold)
    creator_id = card.source_creator_id
    if not creator_id and image:
        creator_id = cache["image_creators"].get(image.id)
    if not creator_id:
        gallery_id = image.gallery_id if image else card.source_gallery_id
        creator_id = cache["gallery_creators"].get(gallery_id)
    engagement = 0.0
    if image:
        engagement = (
            (image.rating or 0) * 10 + math.log1p(image.view_count or 0) * 8
            + math.log1p(image.view_seconds or 0) * 3 + math.log1p(image.cum_count or 0) * 12
            + (25 if image.is_favorite else 0)
        )
    creator = cache["creators"].get(creator_id)
    gallery_id = image.gallery_id if image else card.source_gallery_id
    gallery = cache["galleries"].get(gallery_id)
    character = cache["creators"].get(card.linked_character_id)
    source_creator = cache["creators"].get(card.source_creator_id)
    creator_types = (
        {card.source_creator_id: _enum(source_creator.creator_type)}
        if source_creator and card.source_creator_id else None
    )
    source_key = _source_key(card, creator_types)
    card_type = _enum(card.card_type)
    release_type = _release_card_type(
        card, creator_types,
    )
    personal_value = evaluate_personal_value(
        source_key=source_key,
        card_type=card_type,
        image=image,
        gallery=gallery,
        creator=creator,
        tags=(cache["favorite_tags_by_gallery"].get(gallery_id, []) if card_type == "gallery" else tags),
        gallery_view_seconds=cache["gallery_view_seconds"].get(gallery_id, 0),
    )
    base_rarity = "UR" if (card.print_rarity or card.rarity_class) == "SPR" else (card.print_rarity or card.rarity_class or "C")
    published_rarity = apply_rarity_floor(base_rarity, personal_value["rarity_floor"])
    engagement += personal_value["score"] * 2
    return {
        "source_card_id": card.id, "source_key": source_key, "creator_id": creator_id,
        "creator_name": creator.name if creator else None,
        "gallery_id": gallery_id, "gallery_name": gallery.name if gallery else None,
        "period_year": gallery.period_year if gallery else None,
        "period_month": gallery.period_month if gallery else None,
        "character_id": card.linked_character_id,
        "character_name": character.name if character else None,
        "card_type": card_type, "release_type": release_type,
        "tags": [tag["normalized"] for tag in tags],
        "exposure": classification["exposure"], "intensity": classification["intensity"],
        "confidence": max(classification["exposure_confidence"] or 0, classification["intensity_confidence"] or 0),
        "engagement": round(engagement, 3),
        "published_rarity": published_rarity,
        "spr_eligible": (card.print_rarity or card.rarity_class) == "SPR" or personal_value["spr_eligible"],
        "personal_value": {**personal_value, "base_rarity": base_rarity, "published_rarity": published_rarity},
        "prior_printings": int((prior_printings or {}).get(source_key, 0)),
    }


def _candidate_metadata(db: Session, card: Card, threshold: float, prior_printings: Counter | None = None) -> dict:
    image = _card_source_image(db, card)
    tags = _tag_evidence(db, image.id) if image else []
    stored = db.query(CardContentClassification).filter(CardContentClassification.card_id == card.id).first()
    if stored:
        classification = {
            "exposure": stored.exposure_resolved, "intensity": stored.intensity_resolved,
            "exposure_confidence": stored.exposure_confidence, "intensity_confidence": stored.intensity_confidence,
        }
    else:
        classification = infer_classification(tags, threshold)
    creator_id = card.source_creator_id
    gallery = image.gallery if image else card.source_gallery
    if not creator_id and gallery:
        creator_id = gallery.creator_id or (gallery.creators[0].id if gallery.creators else None)
    engagement = 0.0
    if image:
        engagement = (
            (image.rating or 0) * 10 + math.log1p(image.view_count or 0) * 8
            + math.log1p(image.view_seconds or 0) * 3 + math.log1p(image.cum_count or 0) * 12
            + (25 if image.is_favorite else 0)
        )
    creator = db.get(Creator, creator_id) if creator_id else None
    source_key = _source_key(card)
    creator_type = _enum(creator.creator_type) if creator else None
    return {
        "source_card_id": card.id, "source_key": source_key, "creator_id": creator_id,
        "creator_name": creator.name if creator else None,
        "card_type": _enum(card.card_type),
        "release_type": _release_card_type(
            card, {card.source_creator_id: creator_type}
            if card.source_creator_id and creator_type else None,
        ),
        "tags": [tag["normalized"] for tag in tags],
        "exposure": classification["exposure"], "intensity": classification["intensity"],
        "confidence": max(classification["exposure_confidence"] or 0, classification["intensity_confidence"] or 0),
        "engagement": round(engagement, 3),
        "published_rarity": "UR" if (card.print_rarity or card.rarity_class) == "SPR" else (card.print_rarity or card.rarity_class or "C"),
        "spr_eligible": (card.print_rarity or card.rarity_class) == "SPR",
        "prior_printings": int((prior_printings or {}).get(source_key, 0)),
    }


TAG_SET_NAMES = {
    "breasts": "Heavy Artillery",
    "large_breasts": "Heavy Artillery",
    "long_hair": "Down to Her Waist",
    "ass": "Rear View",
    "underboob": "Underboob: Gravity Optional",
    "sideboob": "Sideboob After Dark",
    "lingerie": "Lace After Midnight",
    "bikini": "Poolside Heat",
    "topless": "Nothing Above",
    "bottomless": "Nothing Below",
    "nude": "No Dress Code",
    "thong": "Barely There",
    "thigh_highs": "Thigh High Season",
    "underwear": "What Lies Beneath",
    "nipples": "No Pasties",
    "navel": "Midriff",
    "stockings": "Silk & Stockings",
    "latex": "Second Skin",
    "cosplay": "Costume After Hours",
}

TYPE_SET_NAMES = {
    "image": "Scenes Worth Keeping",
    "scene": "Scenes Worth Keeping",
    "gallery": "The Complete Shoot",
    "creator": "Creator Portraits",
    "variant": "Cosplay Crossings",
    "cosplay": "Cosplay Crossings",
    "collab": "Double Feature",
    "hof": "Crowned in the Vault",
    "bond": "Private Milestones",
}


def _theme_name(source: str, key: str, sample: dict) -> str:
    if source == "gallery":
        return f"{sample.get('gallery_name') or 'Gallery'}: Selected Scenes"
    if source == "period":
        try:
            return datetime.strptime(key, "%Y-%m").strftime("After Hours: %B %Y")
        except ValueError:
            return f"After Hours: {key}"
    if source == "year":
        return f"The Best of {key}"
    if source == "character":
        return f"{sample.get('character_name') or 'Character'} After Dark"
    if source == "cosplay":
        creator = sample.get("creator_name") or "The Vault"
        character = sample.get("character_name") or "Character"
        return f"{character}, Reimagined by {creator}"
    if source == "card_type":
        return TYPE_SET_NAMES.get(key, f"{key.replace('_', ' ').title()} Collection")
    if source == "creator":
        return f"{sample.get('creator_name') or 'Creator'}: Private Collection"
    if source == "tag":
        normalized = key.strip().lower().replace(" ", "_")
        return TAG_SET_NAMES.get(normalized, normalized.replace("_", " ").title())
    if source == "exposure":
        return {"Partial": "A Little Less Fabric", "Implied nude": "Almost Nothing", "Topless": "Nothing Above", "Bottomless": "Nothing Below", "Nude": "No Dress Code", "Mixed": "Every State of Undress"}.get(key, key)
    if source == "intensity":
        return {"Safe": "Soft Focus", "Suggestive": "The Tease", "Explicit": "No Holding Back"}.get(key, key)
    return key.replace("_", " ").title()


def _theme_proposals(candidates: list[dict], enabled_sources: list[str]) -> list[dict]:
    enabled = set(enabled_sources or [
        "periods", "characters", "cosplay", "exposure", "sexual-content",
        "clothing", "medium", "creator-spotlights", "collaborations",
    ])
    counts = Counter()
    for candidate in candidates:
        if "periods" in enabled and candidate.get("period_year"):
            counts[("year", str(candidate["period_year"]))] += 1
            if candidate.get("period_month"):
                counts[("period", f"{candidate['period_year']:04d}-{candidate['period_month']:02d}")] += 1
        if candidate.get("gallery_id"):
            counts[("gallery", str(candidate["gallery_id"]))] += 1
        if "characters" in enabled and candidate.get("character_id"):
            counts[("character", str(candidate["character_id"]))] += 1
        if "cosplay" in enabled and candidate.get("creator_id") and candidate.get("character_id"):
            counts[("cosplay", f"{candidate['creator_id']}:{candidate['character_id']}")] += 1
        if "medium" in enabled and candidate.get("card_type"):
            counts[("card_type", candidate["card_type"])] += 1
        if "exposure" in enabled and candidate["exposure"] != "Unknown":
            counts[("exposure", candidate["exposure"])] += 1
        if "sexual-content" in enabled and candidate["intensity"] != "Unknown":
            counts[("intensity", candidate["intensity"])] += 1
        if "clothing" in enabled or "sexual-content" in enabled:
            for tag in candidate["tags"]:
                counts[("tag", tag)] += 1
        if "creator-spotlights" in enabled and candidate["creator_id"]:
            counts[("creator", str(candidate["creator_id"]))] += 1
    by_source = {}
    for (source, key), count in counts.most_common():
        minimum = 4 if source == "cosplay" else 6 if source in {"gallery", "character"} else 8
        if count < minimum:
            continue
        # Very generic model tags do not make useful set identities.
        if key in {"1girl", "solo", "looking at viewer", "highres", "photo"}:
            continue
        matching = [candidate for candidate in candidates if _matches_theme(candidate, {"source": source, "key": key})]
        if not matching:
            continue
        sample = next((candidate for candidate in matching if candidate.get("gallery_name") or candidate.get("creator_name") or candidate.get("character_name")), matching[0])
        proposal = {
            "source": source, "key": key,
            "name": _theme_name(source, key, sample),
            "eligible": count,
            "confidence": round(sum(candidate["confidence"] for candidate in matching) / max(1, len(matching)), 3),
        }
        by_source.setdefault(source, []).append(proposal)

    # A release should feel like a collection, not a list of the most common
    # classifier tags. Round-robin across sources before taking a second theme
    # from any one source.
    source_order = ["gallery", "character", "cosplay", "period", "year", "card_type", "creator", "tag", "exposure", "intensity"]
    proposals = []
    seen_names = set()
    depth = 0
    while len(proposals) < 20:
        added = False
        for source in source_order:
            options = by_source.get(source, [])
            if depth >= len(options):
                continue
            proposal = options[depth]
            if proposal["name"] in seen_names:
                continue
            proposals.append(proposal)
            seen_names.add(proposal["name"])
            added = True
            if len(proposals) == 20:
                break
        if not added:
            break
        depth += 1
    return proposals


def _matches_theme(candidate: dict, theme: dict) -> bool:
    return (
        (theme["source"] == "exposure" and candidate["exposure"] == theme["key"])
        or (theme["source"] == "intensity" and candidate["intensity"] == theme["key"])
        or (theme["source"] == "tag" and theme["key"] in candidate["tags"])
        or (theme["source"] == "creator" and str(candidate["creator_id"]) == theme["key"])
        or (theme["source"] == "gallery" and str(candidate.get("gallery_id")) == theme["key"])
        or (theme["source"] == "year" and str(candidate.get("period_year")) == theme["key"])
        or (theme["source"] == "period" and candidate.get("period_year") and candidate.get("period_month") and f"{candidate['period_year']:04d}-{candidate['period_month']:02d}" == theme["key"])
        or (theme["source"] == "character" and str(candidate.get("character_id")) == theme["key"])
        or (theme["source"] == "cosplay" and f"{candidate.get('creator_id')}:{candidate.get('character_id')}" == theme["key"])
        or (theme["source"] == "card_type" and candidate.get("card_type") == theme["key"])
    )


def monthly_release_size(collection_size: int, candidate_pool_size: int | None = None) -> int:
    """Return the bounded monthly base-printing target for a collection.

    The formula is piecewise-linear between the approved collection-size
    anchors.  Collections below the first anchor receive the small-library
    floor, while the available unique candidate pool always remains the hard
    upper bound.  The caller should use the published Foundation base count
    as ``collection_size`` and exclude all linked SPR parallels.
    """
    collection_size = max(0, int(collection_size or 0))
    if not collection_size:
        target = 0
    elif collection_size < MONTHLY_RELEASE_SIZE_ANCHORS[0][0]:
        target = MONTHLY_RELEASE_SIZE_FLOOR
    else:
        target = MONTHLY_RELEASE_SIZE_ANCHORS[-1][1]
        for (left_size, left_target), (right_size, right_target) in zip(
            MONTHLY_RELEASE_SIZE_ANCHORS, MONTHLY_RELEASE_SIZE_ANCHORS[1:],
        ):
            if collection_size <= right_size:
                fraction = (collection_size - left_size) / (right_size - left_size)
                target = _round_half_up(left_target + fraction * (right_target - left_target))
                break
    if candidate_pool_size is not None:
        target = min(target, max(0, int(candidate_pool_size or 0)))
    return max(0, int(target))


def monthly_release_economy_modifier(target: int) -> float:
    """Return the explicit release-size multiplier relative to September."""
    return round(max(0, int(target or 0)) / MONTHLY_RELEASE_REFERENCE_TARGET, 6)


def _monthly_release_size_metadata(
    collection_size: int,
    candidate_pool_size: int,
    *,
    collection_size_source: str,
) -> dict:
    """Freeze the size formula inputs and result into a release manifest."""
    target = monthly_release_size(collection_size, candidate_pool_size)
    return {
        "collection_size": max(0, int(collection_size or 0)),
        "collection_size_source": collection_size_source,
        "candidate_pool": max(0, int(candidate_pool_size or 0)),
        "target": target,
        "economy_modifier": monthly_release_economy_modifier(target),
        "formula_version": MONTHLY_RELEASE_SIZE_FORMULA_VERSION,
        "formula_anchors": [
            {"collection_size": collection, "target": target_size}
            for collection, target_size in MONTHLY_RELEASE_SIZE_ANCHORS
        ],
        "small_library_floor": MONTHLY_RELEASE_SIZE_FLOOR,
        "reference_target": MONTHLY_RELEASE_REFERENCE_TARGET,
    }


_RELEASE_RARITY_ANCHORS = (
    # Base-printing size -> UR and linked SPR targets.  The non-UR tiers are
    # distributed from the approved 620-card proportions below.
    (120, 20, 8),
    (180, 25, 12),
    (300, 40, 20),
    (620, 70, 40),
)
_NON_UR_RARITY_WEIGHTS = {"C": 300, "R": 140, "SR": 110}


def _round_half_up(value: float) -> int:
    return int(math.floor(value + 0.5))


def _interpolated_release_count(target: int, value_index: int) -> int:
    """Interpolate an approved rarity count for an adaptive release size."""
    target = max(0, int(target))
    if target == 0:
        return 0
    if target <= _RELEASE_RARITY_ANCHORS[0][0]:
        size, ur, spr = _RELEASE_RARITY_ANCHORS[0]
        return _round_half_up(target * (ur if value_index == 1 else spr) / size)
    for (left_size, left_ur, left_spr), (right_size, right_ur, right_spr) in zip(
        _RELEASE_RARITY_ANCHORS, _RELEASE_RARITY_ANCHORS[1:],
    ):
        if target <= right_size:
            left_value = left_ur if value_index == 1 else left_spr
            right_value = right_ur if value_index == 1 else right_spr
            fraction = (target - left_size) / (right_size - left_size)
            return _round_half_up(left_value + fraction * (right_value - left_value))
    size, ur, spr = _RELEASE_RARITY_ANCHORS[-1]
    return _round_half_up(target * (ur if value_index == 1 else spr) / size)


def _release_rarity_targets(target: int) -> dict[str, int]:
    """Return deterministic base and additive SPR targets for a release.

    The 620-card target is exactly 300 C / 140 R / 110 SR / 70 UR plus 40
    linked SPR parallels.  Smaller adaptive releases preserve the same
    non-UR proportions while following the approved UR/SPR anchor points.
    Foundation deliberately does not use this monthly-release path.
    """
    target = max(0, int(target))
    ur_target = min(target, _interpolated_release_count(target, 1))
    spr_target = min(ur_target, _interpolated_release_count(target, 2))
    non_ur_total = target - ur_target

    raw = {
        rarity: non_ur_total * weight / sum(_NON_UR_RARITY_WEIGHTS.values())
        for rarity, weight in _NON_UR_RARITY_WEIGHTS.items()
    }
    counts = {rarity: int(math.floor(value)) for rarity, value in raw.items()}
    remainder = non_ur_total - sum(counts.values())
    for rarity in sorted(raw, key=lambda key: (-(raw[key] - counts[key]), key))[:remainder]:
        counts[rarity] += 1
    return {
        "C": counts["C"], "R": counts["R"], "SR": counts["SR"],
        "UR": ur_target, "SPR": spr_target,
    }


def _release_type_targets(target: int) -> dict[str, int]:
    """Scale the six-card-face mix from the 620-base monthly reference."""
    target = max(0, int(target))
    weight_total = sum(MONTHLY_RELEASE_TYPE_WEIGHTS.values())
    raw = {
        card_type: target * weight / weight_total
        for card_type, weight in MONTHLY_RELEASE_TYPE_WEIGHTS.items()
    }
    counts = {card_type: int(math.floor(value)) for card_type, value in raw.items()}
    remainder = target - sum(counts.values())
    for card_type in sorted(raw, key=lambda key: (-(raw[key] - counts[key]), key))[:remainder]:
        counts[card_type] += 1
    return counts


def _select_release_type_candidates(
    candidates: list[dict], target: int,
) -> tuple[list[dict], dict[str, int], dict[str, int]]:
    """Allocate exact family and rarity margins from immutable source printings."""
    requested_targets = _release_type_targets(target)
    rarity_targets = _release_rarity_targets(target)
    rarities = ("C", "R", "SR", "UR")
    families = tuple(requested_targets)
    cell_candidates = {
        (family, rarity): [] for family in families for rarity in rarities
    }
    for candidate in candidates:
        family = candidate.get("release_type")
        rarity = str(candidate.get("published_rarity") or "").upper()
        if (family, rarity) in cell_candidates:
            cell_candidates[(family, rarity)].append(candidate)
    for pool in cell_candidates.values():
        pool.sort(key=lambda item: (
            item.get("prior_printings", 0), -item.get("confidence", 0),
            -item.get("engagement", 0), item["source_key"],
        ))

    supply = {
        family: {rarity: len(cell_candidates[(family, rarity)]) for rarity in rarities}
        for family in families
    }
    family_supply = {family: sum(supply[family].values()) for family in families}
    targets = {
        family: min(requested_targets[family], family_supply[family])
        for family in families
    }
    remaining = int(target) - sum(targets.values())
    while remaining > 0:
        available_families = [
            family for family in families if targets[family] < family_supply[family]
        ]
        if not available_families:
            raise ValueError(
                "Monthly release family supply cannot fill the target after shortage redistribution. "
                f"Supply matrix={json.dumps(supply, sort_keys=True)}; "
                f"requested family targets={json.dumps(requested_targets, sort_keys=True)}; "
                f"adjusted family targets={json.dumps(targets, sort_keys=True)}; "
                f"rarity targets={json.dumps({rarity: rarity_targets[rarity] for rarity in rarities}, sort_keys=True)}."
            )
        weight_total = sum(MONTHLY_RELEASE_TYPE_WEIGHTS[family] for family in available_families)
        raw_shares = {
            family: remaining * MONTHLY_RELEASE_TYPE_WEIGHTS[family] / weight_total
            for family in available_families
        }
        additions = {
            family: min(
                family_supply[family] - targets[family],
                int(math.floor(raw_shares[family])),
            )
            for family in available_families
        }
        placed = sum(additions.values())
        for family, count in additions.items():
            targets[family] += count
        remaining -= placed
        if remaining == 0:
            break
        remainder_order = sorted(
            available_families,
            key=lambda family: (
                -(raw_shares[family] - math.floor(raw_shares[family])),
                families.index(family),
            ),
        )
        single_placements = 0
        for family in remainder_order:
            if remaining <= 0:
                break
            if targets[family] < family_supply[family]:
                targets[family] += 1
                remaining -= 1
                single_placements += 1
        if placed == 0 and single_placements == 0:
            raise ValueError(
                "Monthly release family shortage redistribution made no progress. "
                f"Supply matrix={json.dumps(supply, sort_keys=True)}; "
                f"requested family targets={json.dumps(requested_targets, sort_keys=True)}; "
                f"adjusted family targets={json.dumps(targets, sort_keys=True)}; remaining={remaining}; "
                f"rarity targets={json.dumps({rarity: rarity_targets[rarity] for rarity in rarities}, sort_keys=True)}."
            )

    source = 0
    family_start = 1
    rarity_start = family_start + len(families)
    sink = rarity_start + len(rarities)
    residual = [[0] * (sink + 1) for _ in range(sink + 1)]

    for family_index, family in enumerate(families):
        family_node = family_start + family_index
        residual[source][family_node] = int(targets[family])
        for rarity_index, rarity in enumerate(rarities):
            residual[family_node][rarity_start + rarity_index] = supply[family][rarity]
    for rarity_index, rarity in enumerate(rarities):
        residual[rarity_start + rarity_index][sink] = int(rarity_targets[rarity])

    required_flow = int(target)
    max_flow = 0
    while max_flow < required_flow:
        parents = [-1] * (sink + 1)
        parents[source] = source
        queue = [source]
        for node in queue:
            for neighbor in range(sink + 1):
                if parents[neighbor] == -1 and residual[node][neighbor] > 0:
                    parents[neighbor] = node
                    queue.append(neighbor)
                    if neighbor == sink:
                        break
            if parents[sink] != -1:
                break
        if parents[sink] == -1:
            break
        amount = required_flow - max_flow
        node = sink
        while node != source:
            previous = parents[node]
            amount = min(amount, residual[previous][node])
            node = previous
        node = sink
        while node != source:
            previous = parents[node]
            residual[previous][node] -= amount
            residual[node][previous] += amount
            node = previous
        max_flow += amount

    if (max_flow != required_flow
            or sum(targets.values()) != required_flow
            or sum(int(rarity_targets[rarity]) for rarity in rarities) != required_flow):
        raise ValueError(
            "Monthly release sources cannot meet exact family and rarity margins "
            f"(maximum flow {max_flow}/{required_flow}). Supply matrix={json.dumps(supply, sort_keys=True)}; "
            f"requested family targets={json.dumps(requested_targets, sort_keys=True)}; "
            f"family targets={json.dumps(targets, sort_keys=True)}; "
            f"rarity targets={json.dumps({rarity: rarity_targets[rarity] for rarity in rarities}, sort_keys=True)}."
        )

    selected = []
    for family_index, family in enumerate(families):
        family_node = family_start + family_index
        for rarity_index, rarity in enumerate(rarities):
            rarity_node = rarity_start + rarity_index
            selected_count = residual[rarity_node][family_node]
            selected.extend(cell_candidates[(family, rarity)][:selected_count])
    return selected, targets, family_supply


def _select_spr_source_keys(allocated: list[dict], spr_target: int) -> list[str]:
    """Choose the fixed UR bases that will receive linked SPR parallels."""
    ur_candidates = [
        candidate for candidate in allocated
        if candidate.get("published_rarity") == "UR" and candidate.get("source_key")
    ]
    ur_candidates.sort(key=lambda item: (
        not bool(item.get("spr_eligible")),
        int(item.get("prior_printings", 0)),
        -float(item.get("engagement", 0) or 0),
        item["source_key"],
    ))
    return [candidate["source_key"] for candidate in ur_candidates[:max(0, int(spr_target))]]


def _validate_release_proposal(manifest: dict) -> dict:
    candidates = manifest.get("candidates", [])
    themes = manifest.get("themes", [])
    base = [candidate for candidate in candidates if candidate.get("lane") != "parallel"]
    rarity = Counter(candidate.get("published_rarity") for candidate in base)
    target = int(manifest.get("target", len(base)))
    expected = _release_rarity_targets(target)
    expected_types = manifest.get("type_targets") or _release_type_targets(target)
    errors = []
    warnings = []
    if len(themes) < 10:
        errors.append(f"Only {len(themes)} valid themes were found; ten are required.")
    if len(base) != target:
        errors.append(f"Exactly {target} base printings are required; {len(base)} were allocated.")
    type_distribution = Counter(candidate.get("release_type") for candidate in base)
    for card_type, expected_count in expected_types.items():
        actual_count = type_distribution[card_type]
        if actual_count != int(expected_count):
            errors.append(
                f"{card_type.title()} coverage is {actual_count}; "
                f"exactly {int(expected_count)} is required at this release size."
            )
    declared_targets = manifest.get("rarity_targets")
    if declared_targets is None:
        errors.append("The release manifest is missing its explicit rarity targets.")
    elif {key: int(declared_targets.get(key, -1)) for key in expected} != expected:
        errors.append("The release manifest rarity targets do not match the approved scale.")
    for rarity_name in ("C", "R", "SR", "UR"):
        if rarity[rarity_name] != expected[rarity_name]:
            errors.append(
                f"{rarity_name} coverage is {rarity[rarity_name]}; "
                f"exactly {expected[rarity_name]} is required at this scale."
            )
    spr_target = manifest.get("spr_target")
    if spr_target is None:
        errors.append("The release manifest is missing its explicit SPR target.")
        spr_target = expected["SPR"]
    else:
        spr_target = int(spr_target)
        if spr_target != expected["SPR"]:
            errors.append(f"SPR target is {spr_target}; exactly {expected['SPR']} is required at this scale.")
    spr_source_keys = manifest.get("spr_source_keys")
    if spr_source_keys is None:
        errors.append("The release manifest is missing its explicit SPR source list.")
        spr_source_keys = []
    spr_source_keys = list(spr_source_keys)
    base_by_key = {candidate.get("source_key"): candidate for candidate in base}
    if len(spr_source_keys) != spr_target or len(set(spr_source_keys)) != len(spr_source_keys):
        errors.append(f"Exactly {spr_target} unique UR bases must be assigned SPR parallels.")
    for source_key in spr_source_keys:
        candidate = base_by_key.get(source_key)
        if not candidate or candidate.get("published_rarity") != "UR":
            errors.append(f"SPR source {source_key!r} is not a UR base printing in this release.")
    source_keys = [candidate["source_key"] for candidate in base]
    if len(source_keys) != len(set(source_keys)):
        errors.append("The proposal contains duplicate source definitions.")
    creator_counts = Counter(candidate.get("creator_id") for candidate in base if candidate.get("creator_id"))
    dominant = creator_counts.most_common(1)[0] if creator_counts else (None, 0)
    if base and dominant[1] / len(base) > 0.12:
        errors.append(f"Creator {dominant[0]} occupies {dominant[1] / len(base):.1%} of the release.")
    distribution = dict(rarity)
    distribution["SPR"] = len(spr_source_keys)
    return {
        "valid": not errors, "errors": errors, "warnings": warnings,
        "base_count": len(base), "theme_count": len(themes), "rarity_distribution": distribution,
        "type_distribution": dict(type_distribution), "type_targets": expected_types,
        "creator_max": {"creator_id": dominant[0], "count": dominant[1]},
        "rarity_targets": expected,
        "spr_target": spr_target,
        "spr_source_count": len(spr_source_keys),
    }


def _rebalance_release_rarities(allocated: list[dict], candidates: list[dict], themes: list[dict], target: int) -> list[dict]:
    """Meet the exact release rarity distribution by swapping source printings.

    Published rarity is immutable, so this never promotes a card. It replaces a
    surplus-rarity allocation with an unused source already published at the
    required rarity and preserves the donor's release lane and themed set.
    """
    requirements = _release_rarity_targets(target)
    result = list(allocated)
    used = {candidate["source_key"] for candidate in result}

    # Each replacement fixes one deficit and one surplus.  Repeating by target
    # tier makes the result exact whenever the source pool can support it.
    for _ in range(len(requirements) * max(1, len(result))):
        counts = Counter(candidate.get("published_rarity") for candidate in result)
        needed = next((rarity for rarity in ("UR", "SR", "R", "C") if counts[rarity] < requirements[rarity]), None)
        if needed is None:
            break
        donor_indexes = [
            index for index, donor in enumerate(result)
            if counts[donor.get("published_rarity")] > requirements.get(donor.get("published_rarity"), 0)
        ]
        replacement_by_donor = {}
        for index in donor_indexes:
            donor_type = result[index].get("release_type")
            pool = [
                candidate for candidate in candidates
                if candidate["source_key"] not in used
                and candidate.get("published_rarity") == needed
                and candidate.get("release_type") == donor_type
            ]
            pool.sort(key=lambda item: (
                item.get("prior_printings", 0), -item.get("confidence", 0),
                -item.get("engagement", 0), item["source_key"],
            ))
            if pool:
                replacement_by_donor[index] = pool[0]
        if not replacement_by_donor:
            break
        matching_indexes = [
            index for index in donor_indexes
            if index in replacement_by_donor
            if result[index].get("theme_index") is not None
            and result[index]["theme_index"] < len(themes)
            and _matches_theme(replacement_by_donor[index], themes[result[index]["theme_index"]])
        ]
        unthemed_indexes = [
            index for index in donor_indexes
            if index in replacement_by_donor and result[index].get("theme_index") is None
        ]
        choices = matching_indexes or unthemed_indexes or list(replacement_by_donor)
        if not choices:
            break
        donor_index = choices[-1]
        donor = result[donor_index]
        replacement = replacement_by_donor[donor_index]
        result[donor_index] = {
            **replacement,
            "theme_index": donor.get("theme_index"),
            "lane": donor.get("lane", "discovery"),
        }
        used.discard(donor["source_key"])
        used.add(replacement["source_key"])
    return result


def _enforce_release_creator_cap(allocated: list[dict], candidates: list[dict], target: int) -> list[dict]:
    """Keep adaptive releases diverse without changing their rarity totals."""
    limit = max(1, int(math.floor(max(1, target) * 0.12)))
    result = list(allocated)
    used = {candidate["source_key"] for candidate in result}
    for _ in range(len(result)):
        creator_counts = Counter(
            candidate.get("creator_id") for candidate in result if candidate.get("creator_id")
        )
        dominant = creator_counts.most_common(1)[0] if creator_counts else (None, 0)
        if dominant[1] <= limit:
            break
        donor_indexes = [
            index for index, candidate in enumerate(result)
            if candidate.get("creator_id") == dominant[0]
        ]
        donor_indexes.sort(key=lambda index: (
            result[index].get("lane") == "themed_set",
            result[index].get("prior_printings", 0),
            -float(result[index].get("engagement", 0) or 0),
            result[index]["source_key"],
        ))
        donor_index = donor_indexes[-1]
        donor = result[donor_index]
        pool = [
            candidate for candidate in candidates
            if candidate["source_key"] not in used
            and candidate.get("published_rarity") == donor.get("published_rarity")
            and candidate.get("release_type") == donor.get("release_type")
            and candidate.get("creator_id") != dominant[0]
            and (
                not candidate.get("creator_id")
                or creator_counts.get(candidate.get("creator_id"), 0) < limit
            )
        ]
        pool.sort(key=lambda candidate: (
            candidate.get("prior_printings", 0),
            -float(candidate.get("confidence", 0) or 0),
            -float(candidate.get("engagement", 0) or 0),
            candidate["source_key"],
        ))
        replacement = pool[0] if pool else None
        if replacement is None:
            break
        result[donor_index] = {
            **replacement,
            "theme_index": donor.get("theme_index"),
            "lane": donor.get("lane", "discovery"),
        }
        used.discard(donor["source_key"])
        used.add(replacement["source_key"])
    return result


def reset_published_release(db: Session, code: str, *, dry_run: bool = False) -> dict:
    """Remove one published monthly release and its owned records.

    This is intentionally narrower than a general TCG reset.  It is used for
    an explicitly authorized release replacement: Foundation, source media,
    creator/gallery records, and unrelated catalogue cards remain untouched.
    The operation is idempotent when the release code no longer exists.
    """
    release = db.query(TCGRelease).filter(TCGRelease.code == code).first()
    if not release:
        return {"status": "missing", "code": code, "dry_run": dry_run, "counts": {}}
    if release.release_kind == "foundation" or code == "FND-CORE":
        raise ValueError("Foundation releases cannot be reset by this helper")

    release_id = release.id
    set_ids = [row[0] for row in db.query(TCGSet.id).filter(TCGSet.release_id == release_id).all()]
    product_ids = [row[0] for row in db.query(TCGPackProduct.id).filter(TCGPackProduct.release_id == release_id).all()]

    # The catalogue code is the authoritative ownership boundary.  Include
    # checklist cards as a defensive fallback for older manifests, then close
    # over any linked parallels before removing the card rows.
    card_ids = set(row[0] for row in db.query(Card.id).filter(Card.catalog_code == code).all())
    card_ids.update(row[0] for row in db.query(TCGChecklistEntry.card_id).filter(
        TCGChecklistEntry.release_id == release_id,
    ).all())
    while card_ids:
        children = {
            row[0] for row in db.query(Card.id).filter(Card.parallel_of_id.in_(card_ids)).all()
            if row[0] not in card_ids
        }
        if not children:
            break
        card_ids.update(children)
    card_ids = sorted(card_ids)

    opening_ids = {
        row[0] for row in db.query(TCGPackOpening.id).filter(or_(
            TCGPackOpening.product_id.in_(product_ids) if product_ids else False,
            TCGPackOpening.selected_release_id == release_id,
        )).all()
    }
    opening_ids = sorted(opening_ids)
    inventory_ids = [row[0] for row in db.query(CardInventory.id).filter(
        CardInventory.card_id.in_(card_ids) if card_ids else False,
    ).all()]
    physical_copy_ids = [row[0] for row in db.query(TCGPhysicalCardCopy.id).filter(
        TCGPhysicalCardCopy.card_id.in_(card_ids) if card_ids else False,
    ).all()]
    order_line_ids = [row[0] for row in db.query(TCGOnlineOrderLine.id).filter(
        TCGOnlineOrderLine.product_id.in_(product_ids) if product_ids else False,
    ).all()]
    order_ids = [row[0] for row in db.query(TCGOnlineOrderLine.order_id).filter(
        TCGOnlineOrderLine.id.in_(order_line_ids) if order_line_ids else False,
    ).all()]
    parcel_ids = [row[0] for row in db.query(TCGParcelPack.parcel_id).filter(or_(
        TCGParcelPack.line_id.in_(order_line_ids) if order_line_ids else False,
        TCGParcelPack.opening_id.in_(opening_ids) if opening_ids else False,
    )).distinct().all()]

    counts = {
        "release": 1,
        "sets": len(set_ids),
        "checklist_entries": db.query(TCGChecklistEntry.id).filter(
            TCGChecklistEntry.release_id == release_id,
        ).count(),
        "pack_products": len(product_ids),
        "pack_tokens": db.query(TCGPackToken.id).filter(
            TCGPackToken.product_id.in_(product_ids) if product_ids else False,
        ).count(),
        "pack_openings": len(opening_ids),
        "pack_opening_cards": db.query(TCGPackOpeningCard.id).filter(or_(
            TCGPackOpeningCard.opening_id.in_(opening_ids) if opening_ids else False,
            TCGPackOpeningCard.card_id.in_(card_ids) if card_ids else False,
        )).count(),
        "card_acquisitions": db.query(CardAcquisition.id).filter(or_(
            CardAcquisition.card_id.in_(card_ids) if card_ids else False,
            CardAcquisition.pack_opening_id.in_(opening_ids) if opening_ids else False,
        )).count(),
        "cards": len(card_ids),
        "card_inventory": len(inventory_ids),
        "physical_copies": len(physical_copy_ids),
        "presentation_overrides": db.query(CardPresentationOverride.id).filter(
            CardPresentationOverride.card_id.in_(card_ids) if card_ids else False,
        ).count(),
        "content_classifications": db.query(CardContentClassification.id).filter(
            CardContentClassification.card_id.in_(card_ids) if card_ids else False,
        ).count(),
        "binder_references_cleared": db.query(TCGBinderSlot.id).filter(or_(
            TCGBinderSlot.card_id.in_(card_ids) if card_ids else False,
            TCGBinderSlot.physical_copy_id.in_(physical_copy_ids) if physical_copy_ids else False,
        )).count(),
        "display_assignments": db.query(TCGDisplayAssignment.id).filter(
            TCGDisplayAssignment.physical_copy_id.in_(physical_copy_ids) if physical_copy_ids else False,
        ).count(),
        "online_order_lines": len(order_line_ids),
        "parcel_packs": db.query(TCGParcelPack.id).filter(or_(
            TCGParcelPack.line_id.in_(order_line_ids) if order_line_ids else False,
            TCGParcelPack.opening_id.in_(opening_ids) if opening_ids else False,
        )).count(),
        "parcels": len(parcel_ids),
        "orders": len(set(order_ids)),
    }
    if dry_run:
        return {"status": "planned", "code": code, "release_id": release_id, "dry_run": True, "counts": counts}

    # Clear nullable physical references while preserving the user's binders.
    if card_ids or physical_copy_ids:
        db.query(TCGBinderSlot).filter(or_(
            TCGBinderSlot.card_id.in_(card_ids) if card_ids else False,
            TCGBinderSlot.physical_copy_id.in_(physical_copy_ids) if physical_copy_ids else False,
        )).update({TCGBinderSlot.card_id: None, TCGBinderSlot.physical_copy_id: None}, synchronize_session=False)
    if physical_copy_ids:
        db.query(TCGDisplayAssignment).filter(
            TCGDisplayAssignment.physical_copy_id.in_(physical_copy_ids),
        ).delete(synchronize_session=False)
    if card_ids:
        db.query(HofCrown).filter(HofCrown.card_id.in_(card_ids)).update(
            {HofCrown.card_id: None}, synchronize_session=False,
        )
        db.query(CardPresentationOverride).filter(CardPresentationOverride.card_id.in_(card_ids)).delete(synchronize_session=False)
        db.query(CardContentClassification).filter(CardContentClassification.card_id.in_(card_ids)).delete(synchronize_session=False)
        db.query(CreatorShowcase).filter(CreatorShowcase.inventory_id.in_(inventory_ids) if inventory_ids else False).delete(synchronize_session=False)
        db.query(CardInventory).filter(CardInventory.id.in_(inventory_ids) if inventory_ids else False).delete(synchronize_session=False)
    if physical_copy_ids:
        db.query(TCGPhysicalCardCopy).filter(TCGPhysicalCardCopy.id.in_(physical_copy_ids)).delete(synchronize_session=False)
    db.query(TCGPackOpeningCard).filter(or_(
        TCGPackOpeningCard.opening_id.in_(opening_ids) if opening_ids else False,
        TCGPackOpeningCard.card_id.in_(card_ids) if card_ids else False,
    )).delete(synchronize_session=False)
    db.query(CardAcquisition).filter(or_(
        CardAcquisition.card_id.in_(card_ids) if card_ids else False,
        CardAcquisition.pack_opening_id.in_(opening_ids) if opening_ids else False,
    )).delete(synchronize_session=False)
    db.query(TCGParcelPack).filter(or_(
        TCGParcelPack.line_id.in_(order_line_ids) if order_line_ids else False,
        TCGParcelPack.opening_id.in_(opening_ids) if opening_ids else False,
    )).delete(synchronize_session=False)
    db.query(TCGPackOpening).filter(TCGPackOpening.id.in_(opening_ids) if opening_ids else False).delete(synchronize_session=False)
    db.query(TCGPackToken).filter(TCGPackToken.product_id.in_(product_ids) if product_ids else False).delete(synchronize_session=False)
    db.query(TCGOnlineOrderLine).filter(TCGOnlineOrderLine.id.in_(order_line_ids) if order_line_ids else False).delete(synchronize_session=False)

    # Order/parcel containers that became empty belong entirely to the reset
    # release; mixed orders remain intact.
    for parcel_id in parcel_ids:
        if not db.query(TCGParcelPack.id).filter(TCGParcelPack.parcel_id == parcel_id).first():
            db.query(TCGParcel).filter(TCGParcel.id == parcel_id).delete(synchronize_session=False)
    for order_id in set(order_ids):
        if not db.query(TCGOnlineOrderLine.id).filter(TCGOnlineOrderLine.order_id == order_id).first():
            db.query(TCGParcel).filter(TCGParcel.order_id == order_id).delete(synchronize_session=False)
            db.query(TCGOnlineOrder).filter(TCGOnlineOrder.id == order_id).delete(synchronize_session=False)

    db.query(TCGChecklistEntry).filter(TCGChecklistEntry.release_id == release_id).delete(synchronize_session=False)
    db.query(Card).filter(Card.id.in_(card_ids) if card_ids else False).delete(synchronize_session=False)
    db.query(TCGSet).filter(TCGSet.release_id == release_id).delete(synchronize_session=False)
    db.query(TCGPackProduct).filter(TCGPackProduct.id.in_(product_ids) if product_ids else False).delete(synchronize_session=False)
    db.query(TCGRelease).filter(TCGRelease.id == release_id).delete(synchronize_session=False)
    db.commit()
    return {"status": "deleted", "code": code, "release_id": release_id, "dry_run": False, "counts": counts}


def _monthly_collection_size_input(db: Session, candidate_pool_size: int) -> tuple[int, str]:
    """Resolve the frozen monthly-size denominator without counting SPRs."""
    foundation = db.query(TCGRelease.id).filter(
        TCGRelease.release_kind == "foundation",
        TCGRelease.status == "published",
    ).order_by(TCGRelease.published_at.asc(), TCGRelease.id.asc()).first()
    if foundation:
        foundation_base_count = db.query(func.count(func.distinct(Card.id))).join(
            TCGChecklistEntry, TCGChecklistEntry.card_id == Card.id,
        ).filter(
            TCGChecklistEntry.release_id == foundation[0],
            TCGChecklistEntry.is_base_printing.is_(True),
            Card.parallel_of_id.is_(None),
        ).scalar() or 0
        if foundation_base_count:
            return int(foundation_base_count), "foundation_base_cards"
    return max(0, int(candidate_pool_size or 0)), "unique_candidate_pool"


def draft_release(db: Session, *, year: int, month: int, regenerate: bool = False) -> dict:
    if month < 1 or month > 12 or year < 2000:
        raise ValueError("A valid release year and month are required")
    settings = get_settings(db)
    code = f"REL-{year:04d}-{month:02d}"
    release = db.query(TCGRelease).filter(TCGRelease.code == code).first()
    if release and release.status == "published":
        raise ValueError("That release is already published")
    if release and not regenerate:
        return release_detail(db, release.id)
    seed = f"{code}:{'regen' if regenerate else 'draft'}:{release.id if release else 0}"
    rng = random.Random(seed)
    source_cards = db.query(Card).filter(
        Card.is_legacy.is_(False), Card.catalog_code.isnot(None),
        Card.card_type.notin_([CardType.hof, CardType.bond]),
    ).all()
    prior_printings = Counter()
    for (reason,) in db.query(TCGChecklistEntry.selection_reason).join(
        TCGRelease, TCGChecklistEntry.release_id == TCGRelease.id,
    ).filter(TCGRelease.release_kind != "foundation").all():
        parsed = _json(reason, {})
        if parsed.get("source_key"):
            prior_printings[parsed["source_key"]] += 1
    creator_ids = {card.source_creator_id for card in source_cards if card.source_creator_id}
    creator_types = {
        row.id: _enum(row.creator_type)
        for row in db.query(Creator).filter(Creator.id.in_(creator_ids)).all()
    } if creator_ids else {}
    unique = {}
    for card in source_cards:
        unique.setdefault(_source_key(card, creator_types), card)
    unique_cards = list(unique.values())
    candidate_cache = _release_candidate_cache(db, unique_cards, settings.ai_confidence_threshold)
    source_candidates = [
        _candidate_metadata_cached(card, settings.ai_confidence_threshold, candidate_cache, prior_printings)
        for card in unique_cards
    ]
    rng.shuffle(source_candidates)
    collection_size, collection_size_source = _monthly_collection_size_input(db, len(source_candidates))
    release_size = _monthly_release_size_metadata(
        collection_size,
        len(source_candidates),
        collection_size_source=collection_size_source,
    )
    target = release_size["target"]
    candidates, type_targets, type_supply = _select_release_type_candidates(source_candidates, target)
    requested_type_targets = _release_type_targets(target)
    type_target_adjustments = {
        family: {
            "requested": requested_type_targets[family],
            "available": type_supply[family],
            "adjusted": type_targets[family],
            "delta": type_targets[family] - requested_type_targets[family],
        }
        for family in type_targets
    }
    rng.shuffle(candidates)
    themes = _theme_proposals(candidates, _json(settings.enabled_theme_sources, []))

    allocated = []
    used = set()
    set_target = max(0, target - min(40, target))
    per_set = math.ceil(set_target / max(1, len(themes))) if themes else 0
    for set_index, theme in enumerate(themes):
        matches = [candidate for candidate in candidates if candidate["source_key"] not in used and _matches_theme(candidate, theme)]
        matches.sort(key=lambda item: (item["prior_printings"], -item["confidence"], -item["engagement"], item["source_key"]))
        for candidate in matches[:per_set]:
            candidate = {**candidate, "theme_index": set_index, "lane": "themed_set"}
            allocated.append(candidate); used.add(candidate["source_key"])

    remaining = [candidate for candidate in candidates if candidate["source_key"] not in used]
    remaining.sort(key=lambda item: (item["prior_printings"], -item["engagement"], item["source_key"]))
    engagement = remaining[:min(20, max(0, target - len(allocated)))]
    for candidate in engagement:
        allocated.append({**candidate, "theme_index": None, "lane": "engagement"}); used.add(candidate["source_key"])
    discovery_pool = [candidate for candidate in candidates if candidate["source_key"] not in used]
    rng.shuffle(discovery_pool)
    for candidate in discovery_pool[:min(20, max(0, target - len(allocated)))]:
        allocated.append({**candidate, "theme_index": None, "lane": "discovery"}); used.add(candidate["source_key"])
    # Small libraries may need more than forty release-lane cards to reach their adaptive target.
    fill = [candidate for candidate in candidates if candidate["source_key"] not in used]
    for candidate in fill[:max(0, target - len(allocated))]:
        allocated.append({**candidate, "theme_index": None, "lane": "discovery"}); used.add(candidate["source_key"])

    allocated = _rebalance_release_rarities(allocated, source_candidates, themes, target)
    allocated = _enforce_release_creator_cap(allocated, source_candidates, target)

    rarity_targets = _release_rarity_targets(target)
    spr_source_keys = _select_spr_source_keys(allocated, rarity_targets["SPR"])
    type_distribution = dict(Counter(candidate.get("release_type") for candidate in allocated))
    type_distribution_percentages = {
        family: round(count * 100 / max(1, target), 2)
        for family, count in type_distribution.items()
    }
    manifest = {
        **release_size,
        "type_supply": type_supply,
        "type_target_adjustments": type_target_adjustments,
        "type_targets": type_targets,
        "type_distribution": type_distribution,
        "type_distribution_percentages": type_distribution_percentages,
        "rarity_targets": rarity_targets,
        "spr_target": rarity_targets["SPR"],
        "spr_source_keys": spr_source_keys,
        "themes": themes,
        "candidates": allocated,
        "seed": seed,
        "algorithm_version": MONTHLY_RELEASE_ALGORITHM_VERSION,
    }
    validation = _validate_release_proposal(manifest)
    now = datetime.utcnow()
    if not release:
        release = TCGRelease(
            code=code, name=f"{datetime(year, month, 1).strftime('%B %Y')} Release",
            description="A monthly drop assembled from memorable shoots, characters, creators, and themes across the Vault.",
            status="draft", release_kind="monthly", generation_mode=settings.release_generation_mode,
            generation_seed=seed, algorithm_version=MONTHLY_RELEASE_ALGORITHM_VERSION, drafted_at=now,
        )
        db.add(release); db.flush()
    release.generation_seed = seed
    release.generation_mode = settings.release_generation_mode
    release.algorithm_version = MONTHLY_RELEASE_ALGORITHM_VERSION
    release.manifest_json = json.dumps(manifest)
    release.validation_report = json.dumps(validation)
    release.rarity_distribution = json.dumps(validation["rarity_distribution"])
    release.generation_report = json.dumps({
        **release_size,
        "allocated": len(allocated),
        "type_supply": type_supply,
        "type_target_adjustments": type_target_adjustments,
        "type_targets": type_targets,
        "type_distribution": type_distribution,
        "type_distribution_percentages": type_distribution_percentages,
        "algorithm_version": MONTHLY_RELEASE_ALGORITHM_VERSION,
        "theme_coverage": [{"name": theme["name"], "eligible": theme["eligible"], "confidence": theme["confidence"]} for theme in themes],
        "reprint_statistics": {
            "sources_considered": len(unique), "selected": len(allocated),
            "previously_printed_selected": sum(candidate["prior_printings"] > 0 for candidate in allocated),
            "maximum_prior_printings": max((candidate["prior_printings"] for candidate in allocated), default=0),
        },
    })
    release.status = "validated" if validation["valid"] else "postponed"
    db.query(TCGSet).filter(TCGSet.release_id == release.id).delete(synchronize_session=False)
    for index, theme in enumerate(themes):
        db.add(TCGSet(
            release_id=release.id, code=f"{code}-S{index + 1:02d}", name=theme["name"],
            description=f"A curated {theme['source'].replace('_', ' ')} collection from this release.",
            theme_key=theme["key"], theme_source=theme["source"], position=index + 1,
            manifest_json=json.dumps(theme),
        ))
    db.flush()
    _ensure_founder_sets(db, release)
    db.commit()
    if settings.release_generation_mode == "automatic" and validation["valid"]:
        return publish_release(db, release.id)
    return release_detail(db, release.id)


def process_due_releases(db: Session, *, through: datetime | None = None, max_releases: int = 24) -> dict:
    """Resume scheduled monthly releases in order without padding failed manifests."""
    if max_releases < 1:
        raise ValueError("At least one due release must be allowed")
    setup = db.query(TCGSetupState).filter(TCGSetupState.id == 1).first()
    if not setup or not setup.v2_enabled or setup.foundation_status != "ready":
        return {"status": "not_ready", "processed": [], "remaining": 0}

    current = through or datetime.utcnow()
    foundation = db.query(TCGRelease).filter(
        TCGRelease.release_kind == "foundation", TCGRelease.status == "published",
    ).order_by(TCGRelease.published_at.asc()).first()
    if not foundation:
        return {"status": "not_ready", "processed": [], "remaining": 0}

    start_at = foundation.published_at or foundation.drafted_at or current
    cursor_year, cursor_month = start_at.year, start_at.month
    due = []
    while (cursor_year, cursor_month) <= (current.year, current.month):
        code = f"REL-{cursor_year:04d}-{cursor_month:02d}"
        release = db.query(TCGRelease).filter(TCGRelease.code == code).first()
        if not release or release.status != "published":
            due.append((cursor_year, cursor_month, release))
        cursor_month += 1
        if cursor_month == 13:
            cursor_year += 1
            cursor_month = 1

    processed = []
    settings = get_settings(db)
    for year, month, existing in due[:max_releases]:
        if settings.release_generation_mode == "manual_review" and existing:
            result = release_detail(db, existing.id)
        else:
            result = draft_release(
                db, year=year, month=month,
                regenerate=bool(existing and existing.status == "postponed"),
            )
        processed.append({"year": year, "month": month, "release": result})
        if result.get("status") != "published":
            break

    published_count = sum(item["release"].get("status") == "published" for item in processed)
    return {
        "status": "complete" if len(due) <= published_count else "pending",
        "processed": processed,
        "remaining": max(0, len(due) - published_count),
    }


def publish_release(db: Session, release_id: int) -> dict:
    release = db.query(TCGRelease).filter(TCGRelease.id == release_id).first()
    if not release:
        raise ValueError("Release not found")
    if release.status == "published":
        return release_detail(db, release.id)
    manifest = _json(release.manifest_json, {})
    validation = _validate_release_proposal(manifest)
    release.validation_report = json.dumps(validation)
    if not validation["valid"]:
        release.status = "postponed"; db.commit()
        raise ValueError("Release validation failed; publication was postponed")
    sets = db.query(TCGSet).filter(TCGSet.release_id == release.id).order_by(TCGSet.position).all()
    now = datetime.utcnow()
    try:
        from services.foundation_catalog import prepare_acquired_visual
        spr_source_keys = set(manifest.get("spr_source_keys", []))
        spr_target = int(manifest.get("spr_target", 0))
        spr_minted = 0
        for position, candidate in enumerate(manifest["candidates"], start=1):
            source = db.get(Card, candidate["source_card_id"])
            if not source:
                raise ValueError(f"Source card {candidate['source_card_id']} is missing")
            printing = Card(
                card_type=source.card_type, rarity=source.rarity, foil=False, is_relic=False,
                is_unique=source.is_unique, source_image_id=source.source_image_id,
                source_gallery_id=source.source_gallery_id, source_creator_id=source.source_creator_id,
                linked_character_id=source.linked_character_id, collab_data=source.collab_data,
                cxp=0, crs=source.crs, rarity_class=candidate["published_rarity"],
                catalog_code=release.code, collector_number=position,
                print_rarity=candidate["published_rarity"], is_legacy=False, generated_at=now,
                mint_audit_json=json.dumps({
                    **(candidate.get("personal_value") or {}),
                    "source_key": candidate["source_key"],
                }),
            )
            db.add(printing); db.flush()
            prepare_acquired_visual(db, printing)
            set_id = sets[candidate["theme_index"]].id if candidate.get("theme_index") is not None and candidate["theme_index"] < len(sets) else None
            db.add(TCGChecklistEntry(
                release_id=release.id, set_id=set_id, card_id=printing.id,
                collector_position=position, collector_suffix="", lane=candidate["lane"],
                is_base_printing=True, required_for_complete=True,
                published_rarity=candidate["published_rarity"],
                selection_reason=json.dumps({
                    "source_key": candidate["source_key"],
                    "engagement": candidate["engagement"],
                    "confidence": candidate["confidence"],
                    "personal_value": candidate.get("personal_value"),
                }),
            ))
            if candidate.get("source_key") in spr_source_keys:
                if candidate.get("published_rarity") != "UR":
                    raise ValueError("An SPR source must reference a UR base printing")
                parallel = Card(
                    card_type=source.card_type, rarity=source.rarity, foil=False, is_relic=False,
                    is_unique=source.is_unique, source_image_id=source.source_image_id,
                    source_gallery_id=source.source_gallery_id, source_creator_id=source.source_creator_id,
                    linked_character_id=source.linked_character_id, collab_data=source.collab_data,
                    cxp=0, crs=source.crs, rarity_class="SPR", catalog_code=release.code,
                    collector_number=position, print_rarity="SPR", parallel_of_id=printing.id,
                    is_legacy=False, generated_at=now,
                    mint_audit_json=json.dumps({
                        **(candidate.get("personal_value") or {}),
                        "source_key": candidate["source_key"],
                        "published_rarity": "SPR",
                        "parallel_of_id": printing.id,
                    }),
                )
                db.add(parallel); db.flush(); prepare_acquired_visual(db, parallel)
                db.add(TCGChecklistEntry(
                    release_id=release.id, set_id=set_id, card_id=parallel.id,
                    collector_position=position, collector_suffix="S", lane="parallel",
                    is_base_printing=False, required_for_complete=False,
                    published_rarity="SPR", selection_reason="Linked signature parallel",
                ))
                spr_minted += 1
        if spr_minted != spr_target:
            raise ValueError(f"SPR minting produced {spr_minted} of {spr_target} required parallels")
        release.status = "published"; release.published_at = now; release.available_from = now; release.frozen_at = now
        for tcg_set in sets:
            tcg_set.frozen_at = now
        for suffix, name, kind, count, floor, guarantees in (
            ("STD", "Standard Booster", "release_standard", 6, "SR", ["SR_OR_HIGHER"]),
            ("PREM", "Premium Booster", "release_premium", 4, "SR", ["UR"]),
        ):
            code = f"{release.code}-{suffix}"
            price_metadata = _release_price_metadata(release, kind)
            if not db.query(TCGPackProduct.id).filter(TCGPackProduct.code == code).first():
                db.add(TCGPackProduct(
                    code=code, name=f"{release.name} {name}", product_kind=kind,
                    release_id=release.id, card_count=count, rarity_floor=floor,
                    guaranteed_slots=json.dumps(guarantees),
                    odds_json=json.dumps(PACK_ODDS_DEFAULTS[kind]),
                    replacement_rules=json.dumps({"same_printing_twice": False}),
                    duplicate_protection=json.dumps({"within_pack": True, "owned_cards_eligible": True, "missing_weight": False, "pity": False}),
                    eligible_pool_json=json.dumps({
                        "release_id": release.id, "release_code": release.code,
                        "price_model": price_metadata,
                    }),
                    regular_price=price_metadata["prices"]["regular_price"],
                    launch_price=price_metadata["prices"]["launch_price"], launch_days=7,
                    available_from=now, purchasable=True, active=False,
                    simulation_report=json.dumps({"approved": False, "reason": "Validation pending."}),
                ))
        db.flush()
        _backfill_release_products(db)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return release_detail(db, release.id)


def release_detail(db: Session, release_id: int) -> dict:
    release = db.query(TCGRelease).filter(TCGRelease.id == release_id).first()
    if not release:
        raise ValueError("Release not found")
    sets = db.query(TCGSet).filter(TCGSet.release_id == release.id).order_by(TCGSet.position).all()
    products = db.query(TCGPackProduct).filter(or_(TCGPackProduct.release_id == release.id, TCGPackProduct.product_kind == "permanent")).all()
    return {
        **next(item for item in list_releases(db) if item["id"] == release.id),
        "manifest": _json(release.manifest_json, {}),
        "rarity_distribution": _json(release.rarity_distribution, {}),
        "generation_report": _json(release.generation_report, {}),
        "sets": [{
            "id": item.id, "code": item.code, "name": item.name, "description": item.description,
            "theme_key": item.theme_key, "theme_source": item.theme_source, "cover_path": item.cover_path,
            "completion": _completion(db, release.id, item.id),
            "completion_by_rarity": _completion_by_rarity(db, release.id, item.id),
            "cover_cards": _checklist_cover_cards(db, release.id, item.id, 1),
        } for item in sets],
        "boosters": [pack_dict(product, release) for product in products],
    }


def checklist(db: Session, *, release_id: int | None = None, set_id: int | None = None,
              skip: int = 0, limit: int = 100) -> dict:
    q = db.query(TCGChecklistEntry)
    if release_id is not None:
        q = q.filter(TCGChecklistEntry.release_id == release_id)
    if set_id is not None:
        q = q.filter(TCGChecklistEntry.set_id == set_id)
    total = q.count()
    rows = (
        q.order_by(TCGChecklistEntry.collector_position, TCGChecklistEntry.collector_suffix)
        .offset(max(0, skip))
        .limit(min(max(1, limit), 250))
        .all()
    )
    owned = {row.card_id: row for row in db.query(CardInventory).all()}
    local_positions = {}
    if set_id is not None:
        base_positions = db.query(TCGChecklistEntry.collector_position).filter(
            TCGChecklistEntry.set_id == set_id,
            TCGChecklistEntry.is_base_printing.is_(True),
        ).order_by(TCGChecklistEntry.collector_position).all()
        local_positions = {position: index for index, (position,) in enumerate(base_positions, start=1)}
        denominator = len(base_positions)
    elif release_id is not None:
        denominator = db.query(func.count(TCGChecklistEntry.id)).filter(
            TCGChecklistEntry.release_id == release_id,
            TCGChecklistEntry.is_base_printing.is_(True),
        ).scalar() or 0
    else:
        denominator = 0

    def display_number(row: TCGChecklistEntry) -> str:
        if not denominator:
            return f"{row.collector_position:03d}{row.collector_suffix}"
        position = local_positions.get(row.collector_position, row.collector_position)
        return f"{position:03d}{row.collector_suffix}/{denominator:03d}"

    items = [{
        "id": row.id, "release_id": row.release_id, "set_id": row.set_id,
        "collector_position": row.collector_position, "collector_suffix": row.collector_suffix,
        "display_number": display_number(row),
        "rarity": row.published_rarity, "owned": row.card_id in owned,
        "quantity": owned[row.card_id].quantity if row.card_id in owned else 0,
        "required_for_complete": row.required_for_complete,
        "identity": _card_identity(db, row.card, row),
        "card": _card_to_dict(db, row.card) if row.card_id in owned else None,
    } for row in rows]
    return {"total": total, "items": items, "skip": skip, "limit": limit}


def _card_creator_match(creator_id: int):
    """Match a creator through the card, source image, or source gallery."""
    return or_(
        Card.source_creator_id == creator_id,
        Card.source_image.has(Image.image_creators.any(Creator.id == creator_id)),
        Card.source_image.has(Image.gallery.has(or_(
            Gallery.creator_id == creator_id,
            Gallery.creators.any(Creator.id == creator_id),
        ))),
        Card.source_gallery.has(or_(
            Gallery.creator_id == creator_id,
            Gallery.creators.any(Creator.id == creator_id),
        )),
    )


def _card_character_match(character_id: int):
    """Match a character from the card or its source image/gallery metadata."""
    return or_(
        Card.linked_character_id == character_id,
        Card.source_creator.has(and_(
            Creator.id == character_id,
            Creator.creator_type == "character",
        )),
        Card.source_image.has(Image.image_creators.any(and_(
            Creator.id == character_id,
            Creator.creator_type == "character",
        ))),
        Card.source_image.has(Image.gallery.has(or_(
            Gallery.linked_character_id == character_id,
            Gallery.creators.any(and_(
                Creator.id == character_id,
                Creator.creator_type == "character",
            )),
        ))),
        Card.source_gallery.has(or_(
            Gallery.linked_character_id == character_id,
            Gallery.creators.any(and_(
                Creator.id == character_id,
                Creator.creator_type == "character",
            )),
        )),
    )


def catalog_filter_options(db: Session) -> dict:
    """Return filter entities that occur in the current V2 catalog."""
    backfill_v2_records(db)
    current = Card.is_legacy.is_(False)
    creator_ids = {
        value for (value,) in db.query(Card.source_creator_id).filter(current).all() if value
    }
    character_ids = {
        value for (value,) in db.query(Card.linked_character_id).filter(current).all() if value
    }
    image_creator_ids = db.query(image_creators.c.creator_id).join(
        Image, Image.id == image_creators.c.image_id,
    ).join(Card, Card.source_image_id == Image.id).filter(current).all()
    creator_ids.update(value for (value,) in image_creator_ids if value)

    direct_gallery_creator_ids = db.query(Gallery.creator_id).join(
        Card, Card.source_gallery_id == Gallery.id,
    ).filter(current, Gallery.creator_id.isnot(None)).all()
    direct_image_gallery_creator_ids = db.query(Gallery.creator_id).join(
        Image, Image.gallery_id == Gallery.id,
    ).join(Card, Card.source_image_id == Image.id).filter(
        current, Gallery.creator_id.isnot(None),
    ).all()
    creator_ids.update(value for (value,) in direct_gallery_creator_ids if value)
    creator_ids.update(value for (value,) in direct_image_gallery_creator_ids if value)

    gallery_creator_ids = db.query(gallery_creators.c.creator_id).join(
        Gallery, Gallery.id == gallery_creators.c.gallery_id,
    ).join(Card, Card.source_gallery_id == Gallery.id).filter(current).all()
    image_gallery_creator_ids = db.query(gallery_creators.c.creator_id).join(
        Gallery, Gallery.id == gallery_creators.c.gallery_id,
    ).join(Image, Image.gallery_id == Gallery.id).join(
        Card, Card.source_image_id == Image.id,
    ).filter(current).all()
    creator_ids.update(value for (value,) in gallery_creator_ids if value)
    creator_ids.update(value for (value,) in image_gallery_creator_ids if value)

    assigned_character_ids = db.query(Gallery.linked_character_id).join(
        Card, Card.source_gallery_id == Gallery.id,
    ).filter(current, Gallery.linked_character_id.isnot(None)).all()
    image_gallery_character_ids = db.query(Gallery.linked_character_id).join(
        Image, Image.gallery_id == Gallery.id,
    ).join(Card, Card.source_image_id == Image.id).filter(
        current, Gallery.linked_character_id.isnot(None),
    ).all()
    character_ids.update(value for (value,) in assigned_character_ids if value)
    character_ids.update(value for (value,) in image_gallery_character_ids if value)

    image_character_ids = db.query(image_creators.c.creator_id).join(
        Image, Image.id == image_creators.c.image_id,
    ).join(Creator, Creator.id == image_creators.c.creator_id).join(
        Card, Card.source_image_id == Image.id,
    ).filter(current, Creator.creator_type == "character").all()
    character_ids.update(value for (value,) in image_character_ids if value)

    creators = db.query(Creator).filter(Creator.id.in_(creator_ids)).order_by(Creator.name).all() if creator_ids else []
    characters = db.query(Creator).filter(
        Creator.id.in_(character_ids), Creator.creator_type == "character",
    ).order_by(Creator.name).all() if character_ids else []
    binders = list_binders(db)
    assigned_card_ids = {card_id for (card_id,) in db.query(TCGBinderSlot.card_id).filter(TCGBinderSlot.card_id.isnot(None)).all()}
    has_unassigned = db.query(Card.id).filter(current, ~Card.id.in_(assigned_card_ids or {-1})).first() is not None
    return {
        "creators": [{"id": row.id, "name": row.name, "type": _enum(row.creator_type)} for row in creators],
        "characters": [{"id": row.id, "name": row.name, "type": _enum(row.creator_type)} for row in characters],
        "binders": binders,
        "has_unassigned": has_unassigned,
    }


def catalog(db: Session, *, ownership: str = "owned", rarity: str | None = None,
            card_type: str | None = None, exposure: str | None = None,
            intensity: str | None = None, search: str | None = None,
            release_id: int | None = None, set_id: int | None = None,
            signature: str | None = None,
            creator_id: int | None = None, character_id: int | None = None,
            binder_id: str | None = None,
            skip: int = 0, limit: int = 100) -> dict:
    """Release-aware catalog page with honest owned and missing states."""
    backfill_v2_records(db)
    legacy_scope = ownership == "legacy"
    latest_acquisition = (
        db.query(
            CardAcquisition.card_id.label("card_id"),
            func.max(CardAcquisition.acquired_at).label("acquired_at"),
        )
        .group_by(CardAcquisition.card_id)
        .subquery()
    )
    q = (
        db.query(
            TCGChecklistEntry, Card, CardInventory, CardContentClassification,
            latest_acquisition.c.acquired_at,
        )
        .select_from(Card)
        .outerjoin(TCGChecklistEntry, TCGChecklistEntry.card_id == Card.id)
        .outerjoin(CardInventory, CardInventory.card_id == Card.id)
        .outerjoin(CardContentClassification, CardContentClassification.card_id == Card.id)
        .outerjoin(latest_acquisition, latest_acquisition.c.card_id == Card.id)
    )
    if legacy_scope:
        # Legacy cards are an explicit collection, never part of the current
        # checklist, rarity, or type categories.
        q = q.filter(Card.is_legacy.is_(True), CardInventory.quantity > 0)
    else:
        q = q.filter(Card.is_legacy.is_(False))
    if ownership == "owned":
        q = q.filter(CardInventory.quantity > 0)
    elif ownership == "missing":
        q = q.filter(TCGChecklistEntry.id.isnot(None), or_(CardInventory.id.is_(None), CardInventory.quantity <= 0))
    elif ownership == "duplicates":
        q = q.filter(CardInventory.quantity > 1)
    if rarity and not legacy_scope:
        # Checklist rarity is authoritative for published entries. Earned
        # cards without a checklist row use their immutable print rarity.
        q = q.filter(func.coalesce(
            TCGChecklistEntry.published_rarity,
            Card.print_rarity,
            Card.rarity_class,
        ) == rarity)
    if card_type and not legacy_scope:
        storage_type = {"scene": "image", "cosplay": "variant", "hall-of-fame": "hof"}.get(card_type, card_type)
        if card_type == "character":
            q = q.filter(Card.card_type == CardType.creator, Card.source_creator.has(Creator.creator_type == "character"))
        elif card_type == "creator":
            q = q.filter(Card.card_type == CardType.creator, ~Card.source_creator.has(Creator.creator_type == "character"))
        else:
            q = q.filter(Card.card_type == storage_type)
    if creator_id is not None and not legacy_scope:
        q = q.filter(_card_creator_match(creator_id))
    if character_id is not None and not legacy_scope:
        q = q.filter(_card_character_match(character_id))
    if binder_id is not None:
        if str(binder_id).lower() == "unassigned":
            assigned = db.query(TCGBinderSlot.card_id).filter(TCGBinderSlot.card_id.isnot(None)).scalar_subquery()
            q = q.filter(~Card.id.in_(assigned))
        else:
            try:
                selected_binder_id = int(binder_id)
            except (TypeError, ValueError) as exc:
                raise ValueError("binder_id must be a binder ID or unassigned") from exc
            q = q.filter(Card.id.in_(db.query(TCGBinderSlot.card_id).filter(
                TCGBinderSlot.binder_id == selected_binder_id,
                TCGBinderSlot.card_id.isnot(None),
            )))
    if exposure and not legacy_scope:
        q = q.filter(CardContentClassification.exposure_resolved == exposure)
    if intensity and not legacy_scope:
        q = q.filter(CardContentClassification.intensity_resolved == intensity)
    if release_id is not None and not legacy_scope:
        q = q.filter(TCGChecklistEntry.release_id == release_id)
    if set_id is not None and not legacy_scope:
        q = q.filter(TCGChecklistEntry.set_id == set_id)
    if not legacy_scope:
        if signature == "signed":
            q = q.filter(or_(TCGChecklistEntry.collector_suffix == "S", Card.print_rarity == "SPR"))
        elif signature == "unsigned":
            q = q.filter(and_(TCGChecklistEntry.collector_suffix != "S", Card.print_rarity != "SPR"))
        if ownership in {"owned", "duplicates"}:
            # Older earned cards can predate checklist publication. They remain
            # valid owned catalog records and must be filterable by their card
            # record's immutable rarity/class.
            q = q.filter(or_(
                TCGChecklistEntry.id.isnot(None),
                CardInventory.quantity > 0,
                Card.card_type.in_([CardType.hof, CardType.bond]),
            ))
        else:
            q = q.filter(or_(TCGChecklistEntry.id.isnot(None), Card.card_type.in_([CardType.hof, CardType.bond])))
    if search and search.strip():
        tokens = search.casefold().split()
        card_type_text = func.lower(cast(Card.card_type, String))
        rarity_text = func.lower(cast(Card.rarity, String))
        for token in tokens:
            pattern = f"%{token}%"
            matches = [
                cast(Card.id, String).ilike(pattern),
                Card.catalog_code.ilike(pattern),
                Card.source_creator.has(or_(
                    Creator.name.ilike(pattern), cast(Creator.creator_type, String).ilike(pattern),
                )),
                Card.linked_character.has(or_(
                    Creator.name.ilike(pattern), cast(Creator.creator_type, String).ilike(pattern),
                )),
                Card.source_gallery.has(or_(
                    Gallery.name.ilike(pattern), Gallery.creators.any(Creator.name.ilike(pattern)),
                )),
                Card.source_image.has(or_(
                    Image.filename.ilike(pattern),
                    Image.gallery.has(or_(
                        Gallery.name.ilike(pattern), Gallery.creators.any(Creator.name.ilike(pattern)),
                    )),
                    Image.image_creators.any(Creator.name.ilike(pattern)),
                )),
                TCGChecklistEntry.release.has(TCGRelease.code.ilike(pattern)),
                cast(TCGChecklistEntry.collector_position, String).ilike(pattern),
                cast(Card.collector_number, String).ilike(pattern),
                TCGChecklistEntry.collector_suffix.ilike(pattern),
                card_type_text.ilike(pattern),
                rarity_text.ilike(pattern),
                Card.print_rarity.ilike(pattern),
                Card.rarity_class.ilike(pattern),
                CardContentClassification.exposure_resolved.ilike(pattern),
                CardContentClassification.intensity_resolved.ilike(pattern),
            ]
            if token.isdigit():
                number = int(token)
                matches.extend((Card.id == number, Card.collector_number == number, TCGChecklistEntry.collector_position == number))
            prefixed_id = re.fullmatch(r"(?:card|earned)-0*(\d+)", token)
            if prefixed_id:
                matches.append(Card.id == int(prefixed_id.group(1)))
            printed_id = re.fullmatch(r"(.+)-0*(\d+)([a-z]?)", token)
            if printed_id and not token.startswith(("card-", "earned-")):
                printed_prefix, printed_number, printed_suffix = printed_id.groups()
                matches.append(and_(
                    or_(Card.catalog_code.ilike(printed_prefix), TCGChecklistEntry.release.has(TCGRelease.code.ilike(printed_prefix))),
                    or_(Card.collector_number == int(printed_number), TCGChecklistEntry.collector_position == int(printed_number)),
                    func.lower(func.coalesce(TCGChecklistEntry.collector_suffix, "")) == printed_suffix,
                ))
            if token in {"hall-of-fame", "hof"}:
                matches.append(Card.card_type == CardType.hof)
            elif token in {"scene", "image"}:
                matches.append(Card.card_type == CardType.image)
            elif token in {"cosplay", "variant"}:
                matches.append(Card.card_type == CardType.variant)
            q = q.filter(or_(*matches))
    rows = q.order_by(TCGChecklistEntry.release_id.desc(), TCGChecklistEntry.collector_position, Card.id).all()
    total = len(rows)
    items = []
    for entry, card, inventory, classification, acquired_at in rows[skip:skip + min(limit, 250)]:
        owned = bool(inventory and inventory.quantity > 0)
        items.append({
            "id": entry.id if entry else f"earned-{card.id}", "owned": owned, "quantity": inventory.quantity if inventory else 0,
            "display_number": f"{entry.collector_position:03d}{entry.collector_suffix}" if entry else (card.catalog_code or f"EARNED-{card.id:06d}"),
            "rarity": entry.published_rarity if entry else (card.print_rarity or card.rarity_class),
            "acquired_at": acquired_at.isoformat() if acquired_at else None,
            "published_at": card.generated_at.isoformat() if card.generated_at else None,
            "identity": _card_identity(db, card, entry),
            "acquisition_policy": _acquisition_policy(card.card_type),
            "card": _card_to_dict(db, card) if owned else None,
            "classification": classification_dict(classification) if classification else None,
        })
    return {"total": total, "items": items}


def card_detail(db: Session, card_id: int) -> dict:
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise ValueError("Card not found")
    classification = resolve_card_classification(db, card)
    source = _card_source_image(db, card)
    gallery = source.gallery if source else (card.source_gallery if card.source_gallery_id else None)
    inventory = db.query(CardInventory).filter(CardInventory.card_id == card.id).first()
    acquisitions = db.query(CardAcquisition).filter(CardAcquisition.card_id == card.id).order_by(CardAcquisition.acquired_at.desc()).all()
    known_acquisition_dates = [item.acquired_at for item in acquisitions if item.acquired_at]
    entries = db.query(TCGChecklistEntry).filter(TCGChecklistEntry.card_id == card.id).all()
    milestones = db.query(BondMilestone).filter(BondMilestone.card_id == card.id).order_by(BondMilestone.threshold).all()
    crown = db.query(HofCrown).filter(HofCrown.card_id == card.id).first()
    hof_category_award = None
    creator = card.source_creator
    hof_provenance = None
    hof_period = None
    if _enum(card.card_type) == CardType.hof.value:
        from models import HofCategoryAward
        from services.hof_cards import format_hof_provenance, hof_source_media_type

        hof_category_award = db.query(HofCategoryAward).filter(HofCategoryAward.card_id == card.id).first()

        try:
            frozen_recipe = json.loads(card.visual_recipe) if card.visual_recipe else None
        except (TypeError, ValueError):
            frozen_recipe = None
        try:
            mint_evidence = json.loads(card.mint_audit_json or "{}")
        except (TypeError, ValueError):
            mint_evidence = {}
        if (isinstance(frozen_recipe, dict) and
                mint_evidence.get("developer_fixture") == "hof-media-ladder-v1"):
            frozen_recipe.setdefault("snapshot", {}).setdefault("awardCategory", "media")
        frozen_source = (frozen_recipe or {}).get("source") or {}
        provenance_image_id = (
            (crown.image_id if crown else None)
            or frozen_source.get("historicalImageId")
            or frozen_source.get("imageId")
            or (source.id if source else None)
        )
        provenance_image = (
            db.query(Image).filter(Image.id == int(provenance_image_id)).first()
            if provenance_image_id else None
        )
        provenance_gallery = provenance_image.gallery if provenance_image else gallery
        recipient_creator = creator
        if not recipient_creator:
            recipient_creator_id = (
                hof_category_award.creator_id if hof_category_award else
                crown.creator_id if crown else None
            )
            if not recipient_creator_id and provenance_gallery:
                recipient_creator_id = provenance_gallery.creator_id
                if not recipient_creator_id:
                    linked = db.query(gallery_creators.c.creator_id).filter(
                        gallery_creators.c.gallery_id == provenance_gallery.id,
                    ).order_by(gallery_creators.c.creator_id.asc()).first()
                    recipient_creator_id = linked[0] if linked else None
            if not recipient_creator_id and provenance_image:
                linked = db.query(image_creators.c.creator_id).filter(
                    image_creators.c.image_id == provenance_image.id,
                ).order_by(image_creators.c.creator_id.asc()).first()
                recipient_creator_id = linked[0] if linked else None
            if recipient_creator_id:
                recipient_creator = db.query(Creator).filter(
                    Creator.id == recipient_creator_id,
                ).first()
        hof_provenance = format_hof_provenance(
            crown=crown,
            award=hof_category_award,
            recipe=frozen_recipe,
            creator_name=recipient_creator.name if recipient_creator else None,
            image_kind=hof_source_media_type(provenance_image),
            gallery_name=provenance_gallery.name if provenance_gallery else None,
        )
        hof_period = {
            "period_type": crown.period_type if crown else hof_category_award.period_type if hof_category_award else (hof_provenance or {}).get("period_type"),
            "period_key": crown.period_key if crown else hof_category_award.period_key if hof_category_award else None,
            "field_size": crown.field_size if crown else hof_category_award.field_size if hof_category_award else None,
            "score": crown.score if crown else hof_category_award.score if hof_category_award else None,
            "won_at": (crown.won_at.isoformat() if crown and crown.won_at else
                       hof_category_award.won_at.isoformat() if hof_category_award and hof_category_award.won_at else None),
            "event_card": True,
            "provenance": hof_provenance,
        } if hof_provenance else None
    override = db.query(CardPresentationOverride).filter(CardPresentationOverride.card_id == card.id).first()
    frozen_mint_audit = _json(card.mint_audit_json, {})
    tags = _tag_evidence(db, source.id) if source else []
    manual_names = {tag["normalized"] for tag in tags if tag["source"] == "manual"}
    resolved_tags = [tag for tag in tags if tag["source"] == "manual" or tag["normalized"] not in manual_names]
    links = []
    if source:
        links.append({"label": "Source media", "url": f"/images?selected={source.id}"})
    if gallery:
        links.append({"label": "Source gallery", "url": f"/galleries/{gallery.id}"})
    if creator:
        links.append({"label": "Creator profile", "url": f"/creators/{creator.id}"})
        for label, url in _json(creator.platform_links, {}).items() if isinstance(_json(creator.platform_links, {}), dict) else []:
            links.append({"label": label, "url": url})
        if creator.wiki_url:
            links.append({"label": creator.wiki_source or "Wiki", "url": creator.wiki_url})
    db.commit()
    return {
        "card": _card_to_dict(db, card),
        "acquisition_policy": _acquisition_policy(card.card_type),
        "classification": classification_dict(classification),
        "medium": "video" if source and source.is_video else (source.mime_type or "image" if source else "unknown"),
        "user_rating": source.rating if source else (gallery.rating if gallery else 0),
        "quantity_owned": inventory.quantity if inventory else 0,
        "acquisitions": [{
            "id": item.id, "quantity": item.quantity,
            "acquired_at": item.acquired_at.isoformat() if item.acquired_at else None,
            "source_type": item.source_type, "source_id": item.source_id, "notes": item.notes,
        } for item in acquisitions],
        "engagement": {
            "views": source.view_count if source else (gallery.view_count if gallery else 0),
            "view_seconds": source.view_seconds if source else 0,
            "cum_count": source.cum_count if source else (gallery.cum_count if gallery else 0),
            "edge_count": source.edge_count if source else (gallery.edge_count if gallery else 0),
            "favorite": bool(source.is_favorite if source else (gallery.is_favorite if gallery else False)),
        },
        "dates": {
            "published": source.file_modified_at.isoformat() if source and source.file_modified_at else None,
            "acquired": min(known_acquisition_dates).isoformat() if known_acquisition_dates else None,
            "card_published": card.generated_at.isoformat() if card.generated_at else None,
        },
        "relationships": [{
            "release_id": entry.release_id, "release_code": entry.release.code,
            "release_name": entry.release.name, "set_id": entry.set_id,
            "set_code": entry.set.code if entry.set else None, "set_name": entry.set.name if entry.set else None,
            "collector_position": entry.collector_position, "collector_suffix": entry.collector_suffix,
        } for entry in entries],
        "hof": hof_period,
        "bond": ({
            "event_card": True,
            "source_image_id": card.source_image_id,
            "milestone_history": [{
                "threshold": item.threshold, "recorded_count": item.recorded_count,
                "crossed_at": item.crossed_at.isoformat() if item.crossed_at else None,
            } for item in milestones],
        } if _enum(card.card_type) == CardType.bond.value else None),
        "bond_milestones": [{
            "threshold": item.threshold, "recorded_count": item.recorded_count,
            "crossed_at": item.crossed_at.isoformat() if item.crossed_at else None,
        } for item in milestones],
        "tags": resolved_tags,
        "source_links": links,
        "mint_audit": {
            "visible": bool(get_settings(db).advanced_mode),
            "crs": card.crs, "published_rarity": card.print_rarity or card.rarity_class,
            "catalog_code": card.catalog_code, "visual_recipe_frozen": bool(card.visual_recipe),
            "personal_value": frozen_mint_audit or None,
            "explanation": (
                "This printing's personal-value evidence was frozen when it was published. Pack odds are independent."
                if frozen_mint_audit else
                "This older printing predates frozen personal-value audits. Its published rarity remains immutable."
            ),
        },
        "presentation_override": override_dict(override),
    }


def workspace_summary(db: Session) -> dict:
    backfill_v2_records(db)
    current_cards = Card.is_legacy.is_(False)
    legacy_cards = Card.is_legacy.is_(True)
    owned_printings = (
        db.query(func.count(CardInventory.id))
        .join(Card, Card.id == CardInventory.card_id)
        .filter(CardInventory.quantity > 0, current_cards)
        .scalar() or 0
    )
    owned_copies = (
        db.query(func.sum(CardInventory.quantity))
        .join(Card, Card.id == CardInventory.card_id)
        .filter(CardInventory.quantity > 0, current_cards)
        .scalar() or 0
    )
    legacy_printings = (
        db.query(func.count(CardInventory.id))
        .join(Card, Card.id == CardInventory.card_id)
        .filter(CardInventory.quantity > 0, legacy_cards)
        .scalar() or 0
    )
    legacy_copies = (
        db.query(func.sum(CardInventory.quantity))
        .join(Card, Card.id == CardInventory.card_id)
        .filter(CardInventory.quantity > 0, legacy_cards)
        .scalar() or 0
    )
    checklist_total = db.query(func.count(TCGChecklistEntry.id)).scalar() or 0
    duplicates = (
        db.query(func.sum(CardInventory.quantity - 1))
        .join(Card, Card.id == CardInventory.card_id)
        .filter(CardInventory.quantity > 1, current_cards)
        .scalar() or 0
    )
    by_rarity = {rarity: count for rarity, count in db.query(TCGChecklistEntry.published_rarity, func.count(TCGChecklistEntry.id)).group_by(TCGChecklistEntry.published_rarity).all()}
    return {
        "owned_printings": owned_printings, "owned_copies": owned_copies,
        "legacy_printings": legacy_printings, "legacy_copies": legacy_copies,
        "has_legacy_cards": legacy_printings > 0,
        "catalog_total": checklist_total, "missing": max(0, checklist_total - owned_printings),
        "duplicates": duplicates, "release_count": db.query(func.count(TCGRelease.id)).scalar() or 0,
        "set_count": db.query(func.count(TCGSet.id)).scalar() or 0, "by_rarity": by_rarity,
        "settings": settings_dict(get_settings(db)),
        "classification_values": {"exposure": EXPOSURE_VALUES, "intensity": INTENSITY_VALUES},
    }


def dismantle_duplicate(db: Session, card_id: int) -> dict:
    """Dismantle one duplicate while preserving the owned printing."""
    from services.physical_cards import remove_card_copy
    card = db.get(Card, card_id)
    if not card:
        raise ValueError("Card not found")
    if _enum(card.card_type) in {CardType.hof.value, CardType.bond.value}:
        raise ValueError("Personally earned Hall of Fame and Bond cards cannot be dismantled")
    inventory = db.query(CardInventory).filter(CardInventory.card_id == card_id).first()
    if not inventory or inventory.quantity <= 1:
        raise ValueError("Only duplicate copies can be dismantled")
    rarity = card.print_rarity or card.rarity_class or "C"
    shards = V2_SHARD_YIELD.get(rarity, V2_SHARD_YIELD["C"])
    materials = db.query(CraftingMaterials).first()
    if not materials:
        materials = CraftingMaterials(shards=0)
        db.add(materials)
    remove_card_copy(db, card_id, preserve_last=True)
    materials.shards = (materials.shards or 0) + shards
    db.add(CardAcquisition(
        card_id=card_id,
        quantity=-1,
        acquired_at=datetime.utcnow(),
        source_type="duplicate_dismantle",
        notes=f"One duplicate {rarity} printing dismantled into {shards} Shards.",
    ))
    db.commit()
    return {"card_id": card_id, "quantity": inventory.quantity, "shards_earned": shards, "shards": materials.shards}


def _card_identity(db: Session, card: Card, entry: TCGChecklistEntry | None = None) -> dict:
    """Return safe checklist identity without resolving or exposing media URLs."""
    card_type = _enum(card.card_type) or "unknown"
    image = db.get(Image, card.source_image_id) if card.source_image_id else None
    gallery = card.source_gallery or (image.gallery if image else None)
    creator = card.source_creator
    character = card.linked_character

    if card_type in {"creator", "variant"}:
        display_name = creator.name if creator else None
    elif card_type == "gallery":
        display_name = gallery.name if gallery else None
    elif card_type == "collab":
        display_name = gallery.name if gallery else None
    else:
        display_name = gallery.name if gallery else (creator.name if creator else None)
    if card_type == "variant" and creator and character:
        display_name = f"{creator.name} / {character.name}"
    display_name = display_name or f"Card {card.id}"

    collector_number = entry.collector_position if entry else card.collector_number
    collector_suffix = entry.collector_suffix if entry else ""
    if entry and entry.release:
        stable_id = f"{entry.release.code}-{collector_number:03d}{collector_suffix}"
    elif card.catalog_code and collector_number is not None:
        stable_id = f"{card.catalog_code}-{collector_number:03d}{collector_suffix}"
    elif card.catalog_code:
        stable_id = card.catalog_code
    else:
        stable_id = f"CARD-{card.id:06d}"
    return {
        "card_id": card.id, "stable_card_id": stable_id,
        "catalog_code": card.catalog_code,
        "collector_number": collector_number, "collector_suffix": collector_suffix,
        "display_number": (
            f"{collector_number:03d}{collector_suffix}" if collector_number is not None else None
        ),
        "card_type": card_type, "display_name": display_name,
        "creator_name": creator.name if creator else None,
        "character_name": character.name if character else None,
        "gallery_name": gallery.name if gallery else None,
    }


def _pack_display_context(product: TCGPackProduct, release: TCGRelease | None) -> tuple[str, int, str]:
    db = object_session(product)
    if release:
        set_count = (
            db.query(func.count(TCGSet.id)).filter(TCGSet.release_id == release.id).scalar()
            if db else 0
        ) or 0
        return release.name, int(set_count), f"{product.card_count} cards from {release.name} across {set_count} sets"
    if product.product_kind == "weekly_protection":
        return "Selected published release", 0, f"{product.card_count} cards from your selected published release"
    if product.product_kind == "limited":
        return "All eligible published releases", 0, f"{product.card_count} cards from eligible published releases"
    return "Permanent Catalogue", 0, "Published cards from the permanent catalogue"


def pack_dict(product: TCGPackProduct, release: TCGRelease | None = None) -> dict:
    now = datetime.utcnow()
    launch_ends = release.published_at + timedelta(days=product.launch_days) if release and release.published_at else None
    launch_active = bool(launch_ends and now < launch_ends and product.launch_price is not None)
    release_name, set_count, pool_summary = _pack_display_context(product, release)
    eligible_pool = _json(product.eligible_pool_json, {})
    return {
        "id": product.id, "code": product.code, "name": product.name,
        "product_kind": product.product_kind, "release_id": product.release_id,
        "release_name": release_name, "set_count": set_count, "pool_summary": pool_summary,
        "card_count": product.card_count, "rarity_floor": product.rarity_floor,
        "guaranteed_slots": _json(product.guaranteed_slots, []), "odds": _json(product.odds_json, {}),
        "replacement_rules": _json(product.replacement_rules, {}),
        "duplicate_protection": _json(product.duplicate_protection, {}),
        "eligible_pool": eligible_pool,
        "price_model": eligible_pool.get("price_model"),
        "price": product.launch_price if launch_active else product.regular_price,
        "launch_active": launch_active, "launch_ends_at": launch_ends.isoformat() if launch_ends else None,
        "available_from": product.available_from.isoformat() if product.available_from else None,
        "available_until": product.available_until.isoformat() if product.available_until else None,
        "purchase_limit": product.purchase_limit, "purchasable": product.purchasable,
        "active": product.active, "simulation": _json(product.simulation_report, {}),
    }


def list_packs(db: Session) -> list[dict]:
    seed_pack_products(db)
    db.commit()
    releases = {row.id: row for row in db.query(TCGRelease).all()}
    token_counts = dict(
        db.query(TCGPackToken.product_id, func.sum(TCGPackToken.quantity))
        .filter(TCGPackToken.consumed_at.is_(None))
        .group_by(TCGPackToken.product_id)
        .all()
    )
    return [
        {**pack_dict(product, releases.get(product.release_id)), "tokens": int(token_counts.get(product.id, 0) or 0)}
        for product in db.query(TCGPackProduct).order_by(TCGPackProduct.id).all()
        if product.code not in GENERIC_RELEASE_TEMPLATE_CODES
    ]


def award_pack_token(
    db: Session, product_code: str, *, quantity: int = 1,
    source_type: str, source_id: str | None = None, cycle_key: str | None = None,
) -> dict:
    seed_pack_products(db)
    product = db.query(TCGPackProduct).filter(TCGPackProduct.code == product_code).first()
    if not product:
        raise ValueError("Pack product not found")
    row = None
    if cycle_key:
        row = db.query(TCGPackToken).filter(
            TCGPackToken.product_id == product.id,
            TCGPackToken.source_type == source_type,
            TCGPackToken.cycle_key == cycle_key,
        ).first()
    if row:
        raise ValueError("This pack reward was already earned for that cycle")
    row = TCGPackToken(
        product_id=product.id, quantity=max(1, int(quantity)), source_type=source_type,
        source_id=source_id, cycle_key=cycle_key,
    )
    db.add(row)
    db.flush()
    return {"token_id": row.id, "product_code": product.code, "quantity": row.quantity}


def _eligible_pack_entries(db: Session, product: TCGPackProduct, selected_release_id: int | None) -> list[TCGChecklistEntry]:
    query = db.query(TCGChecklistEntry).join(
        TCGRelease, TCGChecklistEntry.release_id == TCGRelease.id,
    ).join(Card, TCGChecklistEntry.card_id == Card.id).options(joinedload(TCGChecklistEntry.card))
    query = query.filter(TCGRelease.status == "published")
    # Legacy/pre-V2 cards are never valid pack contents. Keep this invariant
    # at the shared eligibility authority so room orders and direct openings
    # cannot diverge.
    query = query.filter(Card.is_legacy.is_(False))
    query = query.filter(Card.card_type.notin_([CardType.hof, CardType.bond]))
    if product.product_kind in {"release_standard", "release_premium"}:
        query = query.filter(TCGChecklistEntry.release_id == product.release_id)
    elif product.product_kind == "weekly_protection":
        if not selected_release_id:
            raise ValueError("Select a published release before opening the weekly protection pack")
        query = query.filter(TCGChecklistEntry.release_id == selected_release_id)
    elif product.product_kind == "permanent":
        foundation = db.query(TCGRelease.id).filter(TCGRelease.code == "FND-CORE").scalar()
        if foundation:
            query = query.filter(TCGChecklistEntry.release_id == foundation)
    return query.order_by(TCGChecklistEntry.collector_position, TCGChecklistEntry.collector_suffix).all()


def _earned_card_pack_rarity(card: Card) -> str | None:
    """Resolve an earned card's fixed rarity to a pullable V2 pack tier."""
    return earned_card_pack_rarity(card)


def _dynamic_earned_pack_entries(
    db: Session, already_eligible_card_ids: set[int],
) -> list[TCGChecklistEntry]:
    """Add every current nonlegacy Bond/HOF mint to this opening's live pool.

    These transient checklist-shaped rows are never persisted or attached to a
    release. That keeps earned cards live for sealed/prepaid packs while their
    snapshots continue to freeze only the ordinary release checklist.
    """
    cards = db.query(Card).filter(
        Card.is_legacy.is_(False),
        Card.card_type.in_([CardType.bond, CardType.hof]),
    ).order_by(Card.id).all()
    entries = []
    for card in cards:
        if card.id in already_eligible_card_ids:
            continue
        rarity = _earned_card_pack_rarity(card)
        if rarity not in PACK_RARITIES:
            continue
        entries.append(TCGChecklistEntry(
            release_id=0, set_id=None, card_id=card.id,
            collector_position=card.id, collector_suffix="", lane="earned_dynamic",
            is_base_printing=True, required_for_complete=False,
            published_rarity=rarity, selection_reason="Dynamically eligible earned card",
            card=card,
        ))
    return entries


def _weighted_rarity(rng: random.Random, odds: dict) -> str:
    weighted = odds.get("weighted_slots", odds) if isinstance(odds, dict) else {}
    weighted = weighted or {"C": 0.60, "R": 0.28, "SR": 0.10, "UR": 0.018, "SPR": 0.002}
    labels = list(weighted)
    weights = [max(0.0, float(weighted[label])) for label in labels]
    return rng.choices(labels, weights=weights, k=1)[0]


def _pick_pack_entry(
    rng: random.Random, entries: list[TCGChecklistEntry], rarity: str,
    used: set[int], owned: set[int], prioritize_missing: bool,
) -> TCGChecklistEntry:
    exact = [entry for entry in entries if entry.published_rarity == rarity and entry.card_id not in used]
    pool = exact or [entry for entry in entries if entry.card_id not in used] or entries
    if not pool:
        raise ValueError(f"The eligible pool has no card available for the {rarity} slot")
    if prioritize_missing:
        missing = [entry for entry in pool if entry.card_id not in owned]
        if missing:
            pool = missing
    return rng.choice(pool)


def _load_frozen_pack_entries(db: Session, frozen_entry_ids: list[int]) -> list[TCGChecklistEntry]:
    """Load a sealed pack's frozen checklist without exceeding SQLite limits."""
    unique_ids = list(dict.fromkeys(frozen_entry_ids))
    entries: list[TCGChecklistEntry] = []
    for start in range(0, len(unique_ids), FROZEN_ENTRY_QUERY_BATCH_SIZE):
        chunk = unique_ids[start:start + FROZEN_ENTRY_QUERY_BATCH_SIZE]
        entries.extend(
            db.query(TCGChecklistEntry)
            .join(Card, TCGChecklistEntry.card_id == Card.id)
            .options(joinedload(TCGChecklistEntry.card))
            .filter(TCGChecklistEntry.id.in_(chunk))
            .filter(Card.is_legacy.is_(False))
            .all()
        )
    return sorted(entries, key=lambda entry: (entry.collector_position, entry.collector_suffix or ""))


def open_pack_product(
    db: Session, product_id: int, *, selected_release_id: int | None = None,
    use_token: bool = False, prepaid: bool = False, prepaid_price: int = 0,
    commit: bool = True, product_snapshot: dict | None = None,
    seed_override: str | None = None,
) -> dict:
    seed_pack_products(db)
    product = db.query(TCGPackProduct).filter(TCGPackProduct.id == product_id).first()
    if not product or (not product.active and not prepaid):
        raise ValueError("That pack is not currently available")
    simulation = _json(product.simulation_report, {})
    if product.purchasable and not prepaid and not simulation.get("approved"):
        raise ValueError("This pack has not passed odds simulation and cannot be opened")
    token = None
    if not prepaid and (use_token or not product.purchasable):
        token = db.query(TCGPackToken).filter(
            TCGPackToken.product_id == product.id,
            TCGPackToken.consumed_at.is_(None),
            TCGPackToken.quantity > 0,
        ).order_by(TCGPackToken.earned_at).first()
        if not token:
            raise ValueError("No pack token is available for this product")
    price = max(0, int(prepaid_price)) if prepaid else 0
    profile = db.query(UserProfile).first()
    if not prepaid and product.purchasable and not token:
        details = pack_dict(product, db.get(TCGRelease, product.release_id) if product.release_id else None)
        price = int(details["price"] or 0)
        if not profile or (profile.vault_credits or 0) < price:
            raise ValueError(f"Need {price} Vault Credits")
    frozen_entry_ids = product_snapshot.get("eligible_entry_ids") if product_snapshot else None
    if prepaid and frozen_entry_ids:
        entries = _load_frozen_pack_entries(db, frozen_entry_ids)
    else:
        entries = _eligible_pack_entries(db, product, selected_release_id)
    earned_entries = _dynamic_earned_pack_entries(db, {entry.card_id for entry in entries})
    entries.extend(earned_entries)
    if not entries:
        raise ValueError("The pack's persisted eligible pool is empty")
    current_owned = {card_id for (card_id,) in db.query(CardInventory.card_id).filter(CardInventory.quantity > 0).all()}
    owned = set(product_snapshot.get("owned_card_ids", current_owned)) if product_snapshot else current_owned
    frozen = product_snapshot or {}
    card_count = int(frozen.get("card_count", product.card_count))
    guarantees = frozen.get("guaranteed_slots", _json(product.guaranteed_slots, []))
    odds = frozen.get("odds", _json(product.odds_json, {}))
    rules = frozen.get("duplicate_protection", _json(product.duplicate_protection, {}))
    if prepaid and not seed_override:
        raise ValueError("Prepaid pack contents seed is missing")
    seed = str(seed_override) if seed_override else hashlib.sha256(
        f"{product.code}:{datetime.utcnow().isoformat()}:{len(owned)}:{random.random()}".encode("utf-8")
    ).hexdigest()
    if not seed:
        raise ValueError("Pack contents seed is missing")
    rng = random.Random(seed)
    slot_rarities = []
    for slot in range(card_count):
        guarantee = guarantees[slot] if slot < len(guarantees) else None
        if guarantee == "SR_OR_HIGHER":
            rarity = rng.choices(["SR", "UR", "SPR"], weights=[0.90, 0.09, 0.01], k=1)[0]
        elif guarantee in {"C", "R", "SR", "UR", "SPR"}:
            rarity = guarantee
        else:
            rarity = _weighted_rarity(rng, odds)
        slot_rarities.append(rarity)
    used: set[int] = set()
    selected: list[tuple[TCGChecklistEntry, str]] = []
    for rarity in slot_rarities:
        entry = _pick_pack_entry(
            rng, entries, rarity, used, owned,
            prioritize_missing=bool(rules.get("prioritize_missing")),
        )
        if len(entries) >= card_count:
            used.add(entry.card_id)
        selected.append((entry, rarity))
    opening = TCGPackOpening(
        product_id=product.id, price_paid=price, opening_seed=seed,
        selected_release_id=selected_release_id,
        integrity_json=json.dumps({
            "product_code": product.code, "eligible_count": len(entries),
            "eligible_pool_hash": hashlib.sha256(",".join(str(entry.card_id) for entry in entries).encode("utf-8")).hexdigest(),
            "eligible_release_ids": sorted({entry.release_id for entry in entries if entry.release_id > 0}),
            "dynamic_earned_card_ids": sorted(entry.card_id for entry in earned_entries),
            "guaranteed_slots": guarantees, "odds": odds, "duplicate_protection": rules,
            "replacement_rules": _json(product.replacement_rules, {}),
        }),
    )
    db.add(opening); db.flush()
    reveal_meta = []
    for index, (entry, slot_rule) in enumerate(selected):
        from services.physical_cards import grant_card_copy
        was_owned = entry.card_id in owned
        db.add(TCGPackOpeningCard(
            opening_id=opening.id, card_id=entry.card_id, slot_index=index,
            slot_rule=slot_rule, was_owned=was_owned,
        ))
        acquisition = CardAcquisition(
            card_id=entry.card_id, quantity=1, acquired_at=datetime.utcnow(),
            source_type="pack", source_id=product.code, pack_opening_id=opening.id,
        )
        db.add(acquisition)
        db.flush()
        grant_card_copy(db, entry.card_id, acquisition_id=acquisition.id, acquired_at=acquisition.acquired_at)
        reveal_meta.append((entry.card, was_owned, slot_rule))
    if token:
        token.quantity -= 1
        if token.quantity <= 0:
            token.consumed_at = datetime.utcnow()
    elif profile and not prepaid:
        profile.vault_credits -= price
    # A pack reveal must use the same prepared face and mask contract as the
    # collection. Preparation happens before the transaction is committed, and
    # static R+ generation failures abort the reveal instead of publishing a
    # silently flat card. The helper reloads the authoritative ORM state before
    # serializing, preventing a pre-mask snapshot from crossing this boundary.
    try:
        for card, _, _ in reveal_meta:
            authoritative, _diagnostics = prepare_card_face_for_reveal(db, card)
    except ValueError:
        db.rollback()
        raise

    if commit:
        db.commit()
    else:
        db.flush()
    cards = [
        {**_card_to_dict(db, db.get(Card, card.id)), "was_owned": was_owned, "slot_rule": slot_rule}
        for card, was_owned, slot_rule in reveal_meta
    ]
    return {
        "opening_id": opening.id, "product": pack_dict(product, db.get(TCGRelease, product.release_id) if product.release_id else None),
        "cards": cards, "price_paid": price, "token_used": bool(token),
    }


def delete_legacy_cards(db: Session, *, dry_run: bool = True) -> dict:
    """Delete explicitly marked legacy cards and every card-owned dependent row.

    Dry-run is the default so maintenance callers must opt into mutation. The
    nullable historical links are cleared, while non-null dependents are
    removed before the cards. Pack openings survive mixed legacy/V2 contents;
    an opening is removed only when all of its opening-card rows are legacy.
    """
    legacy_ids = [card_id for (card_id,) in db.query(Card.id).filter(Card.is_legacy.is_(True)).all()]
    count_keys = (
        "cards", "inventory", "acquisitions", "classifications", "presentation_overrides",
        "binder_slots", "checklist_entries", "pack_opening_cards", "bond_milestones",
        "hof_crowns", "parallel_references", "pack_openings", "card_packs",
        "creator_showcases",
        "malformed_card_packs", "setup_states",
    )
    counts = {key: 0 for key in count_keys}

    legacy_id_set = set(legacy_ids)
    legacy_inventory_ids = []
    if legacy_ids:
        legacy_inventory_ids = [inventory_id for (inventory_id,) in db.query(CardInventory.id).filter(
            CardInventory.card_id.in_(legacy_ids),
        ).all()]
    counts["creator_showcases"] = (
        db.query(CreatorShowcase).filter(
            CreatorShowcase.inventory_id.in_(legacy_inventory_ids),
        ).count()
        if legacy_inventory_ids else 0
    )
    card_pack_updates = []
    for pack in db.query(CardPack).all():
        try:
            awarded = json.loads(pack.cards_awarded)
        except (TypeError, ValueError):
            counts["malformed_card_packs"] += 1
            continue
        if not isinstance(awarded, list):
            counts["malformed_card_packs"] += 1
            continue
        scrubbed = [item for item in awarded if not (
            (isinstance(item, int) and not isinstance(item, bool) and item in legacy_id_set)
            or (isinstance(item, str) and item.strip().isdigit() and int(item.strip()) in legacy_id_set)
        )]
        if scrubbed != awarded:
            card_pack_updates.append((pack.id, json.dumps(scrubbed)))
    counts["card_packs"] = len(card_pack_updates)
    counts["setup_states"] = db.query(TCGSetupState).filter(
        TCGSetupState.legacy_card_count != 0,
    ).count()

    if not legacy_ids:
        if not dry_run:
            for pack_id, cards_awarded in card_pack_updates:
                db.query(CardPack).filter(CardPack.id == pack_id).update(
                    {CardPack.cards_awarded: cards_awarded}, synchronize_session=False,
                )
            db.query(TCGSetupState).update(
                {TCGSetupState.legacy_card_count: 0}, synchronize_session=False,
            )
            db.commit()
        return {"dry_run": dry_run, "legacy_card_ids": [], "counts": counts}

    opening_rows = db.query(TCGPackOpeningCard.opening_id, TCGPackOpeningCard.card_id).all()
    opening_card_ids: dict[int, list[int]] = {}
    for opening_id, card_id in opening_rows:
        opening_card_ids.setdefault(opening_id, []).append(card_id)
    empty_opening_ids = {
        opening_id for opening_id, card_ids in opening_card_ids.items()
        if card_ids and set(card_ids).issubset(legacy_id_set)
    }

    filters = {
        "inventory": (CardInventory, CardInventory.card_id.in_(legacy_ids)),
        "classifications": (CardContentClassification, CardContentClassification.card_id.in_(legacy_ids)),
        "presentation_overrides": (CardPresentationOverride, CardPresentationOverride.card_id.in_(legacy_ids)),
        "binder_slots": (TCGBinderSlot, TCGBinderSlot.card_id.in_(legacy_ids)),
        "checklist_entries": (TCGChecklistEntry, TCGChecklistEntry.card_id.in_(legacy_ids)),
        "pack_opening_cards": (TCGPackOpeningCard, TCGPackOpeningCard.card_id.in_(legacy_ids)),
        "bond_milestones": (BondMilestone, BondMilestone.card_id.in_(legacy_ids)),
        "hof_crowns": (HofCrown, HofCrown.card_id.in_(legacy_ids)),
        "parallel_references": (Card, Card.parallel_of_id.in_(legacy_ids)),
    }
    for key, (model, condition) in filters.items():
        counts[key] = db.query(model).filter(condition).count()
    counts["acquisitions"] = db.query(CardAcquisition).filter(or_(
        CardAcquisition.card_id.in_(legacy_ids),
        CardAcquisition.pack_opening_id.in_(empty_opening_ids),
    )).count()
    counts["pack_openings"] = len(empty_opening_ids)
    counts["cards"] = len(legacy_ids)

    if dry_run:
        return {"dry_run": True, "legacy_card_ids": legacy_ids, "counts": counts}

    # Break nullable references first so V2 parallels and historical slots can
    # survive after the explicitly legacy cards are removed.
    db.query(Card).filter(Card.parallel_of_id.in_(legacy_ids)).update(
        {Card.parallel_of_id: None}, synchronize_session=False,
    )
    db.query(TCGBinderSlot).filter(TCGBinderSlot.card_id.in_(legacy_ids)).update(
        {TCGBinderSlot.card_id: None}, synchronize_session=False,
    )
    db.query(HofCrown).filter(HofCrown.card_id.in_(legacy_ids)).update(
        {HofCrown.card_id: None}, synchronize_session=False,
    )

    for pack_id, cards_awarded in card_pack_updates:
        db.query(CardPack).filter(CardPack.id == pack_id).update(
            {CardPack.cards_awarded: cards_awarded}, synchronize_session=False,
        )
    db.query(TCGSetupState).update(
        {TCGSetupState.legacy_card_count: 0}, synchronize_session=False,
    )
    if legacy_inventory_ids:
        db.query(CreatorShowcase).filter(
            CreatorShowcase.inventory_id.in_(legacy_inventory_ids),
        ).delete(synchronize_session=False)

    for key, (model, condition) in filters.items():
        if key == "parallel_references":
            continue
        db.query(model).filter(condition).delete(synchronize_session=False)
    db.query(CardAcquisition).filter(or_(
        CardAcquisition.card_id.in_(legacy_ids),
        CardAcquisition.pack_opening_id.in_(empty_opening_ids),
    )).delete(synchronize_session=False)
    if empty_opening_ids:
        db.query(TCGPackOpening).filter(TCGPackOpening.id.in_(empty_opening_ids)).delete(synchronize_session=False)
    db.query(Card).filter(Card.id.in_(legacy_ids)).delete(synchronize_session=False)
    db.commit()
    return {"dry_run": False, "legacy_card_ids": legacy_ids, "counts": counts}


def _simulation_validation(config: dict) -> tuple[dict, list[str]]:
    errors = []
    raw_count = config.get("card_count", 10)
    if isinstance(raw_count, bool) or not isinstance(raw_count, int) or not 1 <= raw_count <= 100:
        errors.append("card_count must be an integer between 1 and 100")
    card_count = raw_count if isinstance(raw_count, int) and not isinstance(raw_count, bool) else 10

    raw_odds = config.get("odds")
    if raw_odds is None:
        weighted = {"C": 0.48, "R": 0.34, "SR": 0.14, "UR": 0.035, "SPR": 0.005}
    elif not isinstance(raw_odds, dict):
        weighted = {}
        errors.append("odds must be an object")
    else:
        weighted = raw_odds.get("weighted_slots", raw_odds)
        if not isinstance(weighted, dict):
            weighted = {}
            errors.append("odds.weighted_slots must be an object")

    parsed_odds = {}
    for label, value in weighted.items():
        if label not in PACK_RARITIES:
            errors.append(f"odds contains unsupported rarity: {label}")
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
            errors.append(f"odds.{label} must be a finite non-negative number")
            continue
        parsed_odds[label] = float(value)
    if not parsed_odds or sum(parsed_odds.values()) <= 0:
        errors.append("odds must contain at least one positive rarity weight")

    raw_guarantees = config.get("guaranteed_slots", [])
    if not isinstance(raw_guarantees, list):
        guarantees = []
        errors.append("guaranteed_slots must be a list")
    else:
        guarantees = raw_guarantees
        if len(guarantees) > card_count:
            errors.append("guaranteed_slots cannot exceed card_count")
        for guarantee in guarantees:
            if guarantee not in (*PACK_RARITIES, "SR_OR_HIGHER"):
                errors.append(f"unsupported guarantee: {guarantee}")

    floor = config.get("rarity_floor")
    if floor is not None and floor not in PACK_RARITIES:
        errors.append("rarity_floor must be a supported rarity")
    if floor in PACK_RARITIES:
        floor_index = PACK_RARITIES.index(floor)
        for guarantee in guarantees:
            if guarantee in PACK_RARITIES and PACK_RARITIES.index(guarantee) < floor_index:
                errors.append(f"guarantee {guarantee} is below rarity_floor {floor}")

    return {
        "card_count": card_count, "odds": parsed_odds, "guaranteed_slots": guarantees,
        "rarity_floor": floor,
    }, errors


def simulate_pack(config: dict) -> dict:
    normalized, errors = _simulation_validation(config)
    runs_value = config.get("runs", 20000)
    try:
        runs = max(1000, min(int(runs_value), 250000))
    except (TypeError, ValueError):
        runs = 20000
        errors.append("runs must be an integer")
    card_count = normalized["card_count"]
    odds = normalized["odds"]
    guarantees = normalized["guaranteed_slots"]
    seed = str(config.get("seed") or "tcg-v2-simulation")
    report = {
        "runs": runs, "seed": seed, "card_count": card_count,
        "validation": {"valid": not errors, "errors": errors},
        "approved": not errors,
    }
    if errors:
        return report

    total = sum(odds.values())
    labels = list(odds)
    weights = [odds[label] / total for label in labels]
    rng = random.Random(seed)
    first_ur = []
    first_spr = []
    rarity_counts = Counter()
    for _ in range(runs):
        pull = []
        for slot in range(card_count):
            guarantee = guarantees[slot] if slot < len(guarantees) else None
            if guarantee == "SR_OR_HIGHER":
                value = rng.choices(["SR", "UR", "SPR"], weights=[0.90, 0.09, 0.01], k=1)[0]
            elif guarantee in PACK_RARITIES:
                value = guarantee
            else:
                value = rng.choices(labels, weights=weights, k=1)[0]
            pull.append(value)
        rarity_counts.update(pull)
        first_ur.append(any(value in {"UR", "SPR"} for value in pull))
        first_spr.append("SPR" in pull)
    p_ur = sum(first_ur) / runs
    p_spr = sum(first_spr) / runs
    report.update({
        "rarity_per_card": {key: round(value / (runs * card_count), 6) for key, value in rarity_counts.items()},
        "pack_has_ur_or_better": round(p_ur, 6), "pack_has_spr": round(p_spr, 6),
        "expected_packs_first_ur": round(1 / p_ur, 2) if p_ur else None,
        "expected_packs_first_spr": round(1 / p_spr, 2) if p_spr else None,
    })
    return report


def override_dict(row: CardPresentationOverride | None) -> dict:
    if not row:
        return {}
    return {
        "signature_x": row.signature_x, "signature_y": row.signature_y,
        "signature_scale": row.signature_scale, "signature_rotation": row.signature_rotation,
        "artwork_x": row.artwork_x, "artwork_y": row.artwork_y, "artwork_scale": row.artwork_scale,
        "mask": _json(row.mask_override_json, {}), "revision": row.revision,
    }


def update_presentation_override(db: Session, card_id: int, values: dict) -> dict:
    if not get_settings(db).advanced_mode:
        raise ValueError("Advanced mode is required")
    if not db.query(Card.id).filter(Card.id == card_id).first():
        raise ValueError("Card not found")
    row = db.query(CardPresentationOverride).filter(CardPresentationOverride.card_id == card_id).first()
    if not row:
        row = CardPresentationOverride(card_id=card_id)
        db.add(row)
    for key in ("signature_x", "signature_y", "signature_scale", "signature_rotation", "artwork_x", "artwork_y", "artwork_scale"):
        if key in values:
            setattr(row, key, None if values[key] is None else float(values[key]))
    if "mask" in values:
        row.mask_override_json = json.dumps(values["mask"] or {})
    row.revision = (row.revision or 0) + 1
    db.commit()
    return override_dict(row)


def list_binders(db: Session) -> list[dict]:
    binders = db.query(TCGBinder).order_by(TCGBinder.position, TCGBinder.id).all()
    return [{
        "id": binder.id, "name": binder.name, "description": binder.description,
        "cover_style": binder.cover_style, "spine_style": binder.spine_style,
        "page_style": binder.page_style,
        "cover_image_id": binder.cover_image_id,
        "cover_image_url": f"/api/images/{binder.cover_image_id}/file" if binder.cover_image_id else None,
        "cover_x": binder.cover_x, "cover_y": binder.cover_y, "cover_scale": binder.cover_scale,
        "purchase_price": binder.purchase_price or 0,
        "card_count": db.query(func.count(TCGBinderSlot.id)).filter(TCGBinderSlot.binder_id == binder.id, TCGBinderSlot.card_id.isnot(None)).scalar() or 0,
    } for binder in binders]


def create_binder(db: Session, values: dict) -> dict:
    name = str(values.get("name") or "").strip()
    if not name:
        raise ValueError("Binder name is required")
    binder_count = db.query(func.count(TCGBinder.id)).scalar() or 0
    purchase_price = 0 if binder_count == 0 else 1200
    profile = db.query(UserProfile).first()
    if purchase_price:
        if not profile or (profile.vault_credits or 0) < purchase_price:
            raise ValueError(f"Need {purchase_price} Vault Credits for another binder")
        profile.vault_credits -= purchase_price
    cover_image_id = values.get("cover_image_id")
    if cover_image_id and not db.get(Image, int(cover_image_id)):
        raise ValueError("Cover image not found")
    binder = TCGBinder(
        name=name, description=str(values.get("description") or ""),
        cover_style=str(values.get("cover_style") or "obsidian"),
        spine_style=str(values.get("spine_style") or "standard"),
        page_style=str(values.get("page_style") or "nine-pocket"),
        cover_image_id=int(cover_image_id) if cover_image_id else None,
        cover_x=float(values.get("cover_x", 0.5)), cover_y=float(values.get("cover_y", 0.5)),
        cover_scale=float(values.get("cover_scale", 1.0)), purchase_price=purchase_price,
        position=binder_count,
    )
    db.add(binder)
    db.flush()
    db.add(TCGBinderSection(binder_id=binder.id, name="Main", position=0))
    db.commit()
    return next(item for item in list_binders(db) if item["id"] == binder.id)


def update_binder(db: Session, binder_id: int, values: dict) -> dict:
    binder = db.query(TCGBinder).filter(TCGBinder.id == binder_id).first()
    if not binder:
        raise ValueError("Binder not found")
    if "name" in values:
        name = str(values.get("name") or "").strip()
        if not name:
            raise ValueError("Binder name is required")
        binder.name = name
    if "description" in values:
        binder.description = str(values.get("description") or "")
    for key in ("cover_style", "spine_style", "page_style"):
        if key in values and values[key] is not None:
            setattr(binder, key, str(values[key]))
    if "cover_image_id" in values:
        cover_image_id = values["cover_image_id"]
        if cover_image_id is not None and not db.get(Image, int(cover_image_id)):
            raise ValueError("Cover image not found")
        binder.cover_image_id = int(cover_image_id) if cover_image_id is not None else None
    for key in ("cover_x", "cover_y", "cover_scale"):
        if key in values and values[key] is not None:
            setattr(binder, key, float(values[key]))
    db.commit()
    return binder_detail(db, binder.id)


def binder_detail(db: Session, binder_id: int) -> dict:
    binder = db.query(TCGBinder).filter(TCGBinder.id == binder_id).first()
    if not binder:
        raise ValueError("Binder not found")
    sections = db.query(TCGBinderSection).filter_by(binder_id=binder.id).order_by(TCGBinderSection.position, TCGBinderSection.id).all()
    slots = db.query(TCGBinderSlot).filter(TCGBinderSlot.binder_id == binder.id).order_by(TCGBinderSlot.section_name, TCGBinderSlot.page_number, TCGBinderSlot.slot_number).all()
    return {
        **next(item for item in list_binders(db) if item["id"] == binder.id),
        "sections": [{"id": row.id, "name": row.name, "position": row.position} for row in sections],
        "slots": [{
            "id": slot.id, "section_id": slot.section_id, "section_name": slot.section_name, "page_number": slot.page_number,
            "slot_number": slot.slot_number, "card_id": slot.card_id,
            "physical_copy_id": slot.physical_copy_id,
            "sleeve_style": slot.sleeve_style, "case_style": slot.case_style,
            "card": _card_to_dict(db, db.get(Card, slot.card_id)) if slot.card_id else None,
        } for slot in slots],
    }


def set_binder_slot(db: Session, binder_id: int, values: dict) -> dict:
    from services.physical_cards import set_binder_slot_compat
    binder = db.query(TCGBinder).filter(TCGBinder.id == binder_id).first()
    if not binder:
        raise ValueError("Binder not found")
    page = max(1, int(values.get("page_number", 1)))
    slot_number = max(1, int(values.get("slot_number", 1)))
    section = str(values.get("section_name") or "Main")
    card_id = values.get("card_id")
    if card_id is not None and not db.query(CardInventory.id).filter(CardInventory.card_id == int(card_id), CardInventory.quantity > 0).first():
        raise ValueError("Only an owned card can be placed in a binder")
    slot = db.query(TCGBinderSlot).filter(
        TCGBinderSlot.binder_id == binder.id, TCGBinderSlot.section_name == section,
        TCGBinderSlot.page_number == page, TCGBinderSlot.slot_number == slot_number,
    ).first()
    if not slot:
        slot = TCGBinderSlot(binder_id=binder.id, section_name=section, page_number=page, slot_number=slot_number)
        db.add(slot)
        db.flush()
    set_binder_slot_compat(db, slot, int(card_id) if card_id is not None else None)
    slot.sleeve_style = values.get("sleeve_style")
    slot.case_style = values.get("case_style")
    db.commit()
    return binder_detail(db, binder.id)


def add_cards_to_binder(db: Session, binder_id: int, card_ids: list[int]) -> dict:
    from services.physical_cards import set_binder_slot_compat
    binder = db.query(TCGBinder).filter(TCGBinder.id == binder_id).first()
    if not binder:
        raise ValueError("Binder not found")
    unique_ids = list(dict.fromkeys(card_ids))
    owned_ids = {
        card_id for (card_id,) in db.query(CardInventory.card_id).filter(
            CardInventory.card_id.in_(unique_ids), CardInventory.quantity > 0,
        ).all()
    }
    missing = [card_id for card_id in unique_ids if card_id not in owned_ids]
    if missing:
        raise ValueError("Only owned cards can be placed in a binder")

    slots = db.query(TCGBinderSlot).filter(TCGBinderSlot.binder_id == binder.id).all()
    occupied = {(slot.page_number, slot.slot_number) for slot in slots if slot.card_id is not None}
    by_position = {(slot.page_number, slot.slot_number): slot for slot in slots}
    cursor = 1
    for card_id in unique_ids:
        while True:
            page = ((cursor - 1) // 9) + 1
            slot_number = ((cursor - 1) % 9) + 1
            cursor += 1
            if (page, slot_number) not in occupied:
                break
        slot = by_position.get((page, slot_number))
        if slot is None:
            slot = TCGBinderSlot(
                binder_id=binder.id, section_name="Main",
                page_number=page, slot_number=slot_number,
            )
            db.add(slot)
            db.flush()
            by_position[(page, slot_number)] = slot
        set_binder_slot_compat(db, slot, card_id)
        occupied.add((page, slot_number))
    db.commit()
    return binder_detail(db, binder.id)


def workshop(db: Session) -> dict:
    seed_workshop(db)
    materials = db.query(CraftingMaterials).filter(CraftingMaterials.id == 1).first()
    if not materials:
        materials = CraftingMaterials(id=1, shards=0, catalyst_tokens=0)
        db.add(materials)
    db.commit()
    profile = db.query(UserProfile).first()
    return {
        "shards": materials.shards or 0,
        "vault_credits": profile.vault_credits if profile else 0,
        "items": [{
            "id": item.id, "code": item.item_code, "type": item.item_type,
            "name": item.name, "shard_cost": item.shard_cost, "owned": item.owned,
            "unlocked_at": item.unlocked_at.isoformat() if item.unlocked_at else None,
        } for item in db.query(TCGWorkshopUnlock).order_by(TCGWorkshopUnlock.shard_cost).all()],
    }


def unlock_workshop_item(db: Session, item_id: int) -> dict:
    item = db.query(TCGWorkshopUnlock).filter(TCGWorkshopUnlock.id == item_id).first()
    materials = db.query(CraftingMaterials).filter(CraftingMaterials.id == 1).first()
    if not item or not materials:
        raise ValueError("Workshop item not found")
    if item.owned:
        raise ValueError("Workshop item already unlocked")
    if (materials.shards or 0) < item.shard_cost:
        raise ValueError(f"Need {item.shard_cost} Shards")
    materials.shards -= item.shard_cost
    item.owned = True
    item.unlocked_at = datetime.utcnow()
    from services.tcg_room import sync_legacy_workshop_item
    sync_legacy_workshop_item(db, item)
    db.commit()
    return workshop(db)

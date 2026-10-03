"""Deterministic daily trader domain. Runtime behavior is authored and seed-driven."""

from __future__ import annotations

from datetime import date, datetime, timedelta
import hashlib
import json
import math
from pathlib import Path
import random
import re
from typing import Any

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from models import (
    Card, CardAcquisition, CardContentClassification, CardInventory, CardType, Creator,
    CraftingMaterials, Gallery, Image, TCGBinder, TCGBinderSlot, TCGChecklistEntry, TCGDisplayAssignment,
    TCGDisplayItemInstance,
    TCGPhysicalCardCopy, TCGRelease,
    TCGTraderDefinition, TCGTraderInventory, TCGTraderOffer, TCGTraderRequest,
    TCGTraderReservation, TCGTraderSimulationReport, TCGTraderTransaction,
    TCGTraderTransactionLine, TCGTraderVisit, UserProfile, gallery_creators, gallery_tags,
    image_creators, image_tags, Tag,
)
from services.physical_cards import grant_card_copy, move_copy


RARITY_UNITS = {"C": 1.0, "R": 4.0, "SR": 15.0, "UR": 60.0, "SPR": 180.0}
DAILY_STOCK_SIZE = 16
DAILY_STOCK_MINIMUM = 15
DAILY_UR_MINIMUM = 3
DAILY_UR_MAXIMUM = 5
DAILY_SR_MINIMUM = 5
DAILY_SR_MAXIMUM = 10
DAILY_SPR_CHANCE = 0.40
REQUEST_FULFILLMENT_CHANCE = 0.72
SURPLUS_RETURN_SHARE_BY_TRADER_CODE = {
    "yoruichi": 0.60,
    "rika": 0.40,
    "lisa": 0.20,
}
DEFAULT_SURPLUS_RETURN_SHARE = 0.35
GRADING_FEE_CREDITS_BY_RARITY = {
    "C": 100, "COMMON": 100,
    "R": 200, "RARE": 200, "UNCOMMON": 150,
    "SR": 400, "EPIC": 400,
    "SSR": 600,
    "UR": 800, "LEGENDARY": 800,
    "SPR": 1600, "CELESTIAL": 1600, "RELIC": 1600,
}
GRADE_TIER_BY_SCORE = {6: "D", 7: "C", 8: "B", 9: "A", 10: "S"}
# Published rarity is the only grading input: C -> D, R -> C, SR -> B,
# UR -> A, SPR -> S. Legacy rarity names map to their current equivalents.
GRADE_SCORE_BY_RARITY = {
    "C": 6, "R": 7, "SR": 8, "UR": 9, "SPR": 10,
}
GRADE_FOCUS_MULTIPLIER = {"D": 1.04, "C": 1.08, "B": 1.12, "A": 1.16, "S": 1.20}
CARD_TYPE_VALUE = {
    "image": 1.0, "gallery": 1.06, "creator": 1.04, "variant": 1.1,
    "collab": 1.1, "bond": 1.12, "hof": 1.15,
}
MANIFEST = Path(__file__).resolve().parents[1] / "data" / "tcg_room" / "traders-v1.json"
FOCUS_IGNORED_TAGS = {
    "1girl", "1boy", "solo", "nsfw", "rating:safe", "rating:questionable",
    "rating:explicit", "source", "signature", "unknown",
}


def _load(raw, fallback):
    try: return json.loads(raw) if raw else fallback
    except (TypeError, ValueError): return fallback


def _dump(value):
    return json.dumps(value, separators=(",", ":"), sort_keys=True, default=str)


def _enum(value):
    return value.value if hasattr(value, "value") else str(value)


def _seed(*parts) -> str:
    return hashlib.sha256(":".join(map(str, parts)).encode("utf-8")).hexdigest()


def _trader_manifest() -> dict:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    traders = manifest.get("traders")
    if not isinstance(traders, list) or not traders:
        raise ValueError("The trader manifest must contain at least one trader")
    expected_codes = [item.get("id") for item in traders]
    if any(not isinstance(code, str) or not code.strip() for code in expected_codes):
        raise ValueError("Every trader must have a stable non-empty id")
    if len(set(expected_codes)) != len(expected_codes):
        raise ValueError("The trader manifest must contain unique trader ids")
    if any(int(item["age"]) < 21 for item in traders):
        raise ValueError("Every trader must be explicitly age 21 or older")
    return manifest


def public_trader_roster() -> list[dict]:
    """Read manifest-backed profiles for preview; this performs no database work."""
    manifest = _trader_manifest()
    visual_defaults = manifest.get("visual_manifest", {})
    return [{
        "id": item["id"], "name": item.get("display_name", item["name"]),
        "age": item["age"], "biography": item["biography"],
        "personality": item["personality"], "preferences": item["preferences"],
        "dislikes": item["dislikes"], "quirks": item["quirks"],
        "visual_manifest": {**visual_defaults, **item.get("visual_manifest", {}),
                            "portrait_key": item["id"]},
        # Roster profiles are informational snapshots; trading still requires a
        # separately established daily visit and its visit_id.
        "preview_only": True,
    } for item in manifest["traders"]]


def seed_traders(db: Session) -> None:
    manifest = _trader_manifest()
    visual, dialogue = manifest.get("visual_manifest", {}), manifest["dialogue_manifest"]
    expected_codes = [item["id"] for item in manifest["traders"]]
    db.query(TCGTraderDefinition).filter(
        TCGTraderDefinition.code.notin_(expected_codes),
    ).update({TCGTraderDefinition.enabled: False}, synchronize_session=False)
    for item in manifest["traders"]:
        row = db.query(TCGTraderDefinition).filter_by(code=item["id"]).first()
        name = item.get("display_name", item["name"])
        values = dict(
            name=name, age=item["age"], biography=item["biography"],
            body_style_json=_dump({"description": item["biography"]}), personality=item["personality"],
            preferences_json=_dump(item["preferences"]), dislikes_json=_dump(item["dislikes"]),
            quirks_json=_dump(item["quirks"]), greed=item["greed"], competence=item["competence"],
            risk_tolerance=item["risk"], request_limit=item["request_limit"],
            schedule_weight=item["schedule_weight"], enabled=item["enabled"],
            visual_manifest_json=_dump({**visual, **item.get("visual_manifest", {}), "portrait_key": item["id"]}),
            dialogue_manifest_json=_dump(dialogue),
        )
        if not row:
            row = TCGTraderDefinition(code=item["id"], **values); db.add(row)
        else:
            for key, value in values.items():
                setattr(row, key, value)
    db.flush()


def production_enabled(db: Session) -> bool:
    # Trader markets are available by default. Simulation reports remain useful
    # for balance review, but must not gate the single-player trading feature.
    return True


def _spr_enabled(db: Session) -> bool:
    # SPR cards are part of the normal published pool unless a trader's stock
    # configuration later chooses a narrower set.
    return True


def _active_visit(db: Session, visit_id: int) -> TCGTraderVisit:
    visit = db.get(TCGTraderVisit, visit_id)
    if not visit or visit.status != "active" or datetime.now() >= visit.departs_at:
        raise ValueError("This trader visit has ended")
    return visit


def _day_key(day: date | None = None) -> str:
    return (day or date.today()).isoformat()


def _published_card_ids(db: Session, *, allow_spr: bool) -> list[int]:
    query = db.query(TCGChecklistEntry.card_id).join(TCGRelease).join(Card).filter(
        TCGRelease.status == "published", Card.card_type.notin_([CardType.hof, CardType.bond]),
    )
    if not allow_spr:
        query = query.filter(TCGChecklistEntry.published_rarity != "SPR")
    return sorted({row[0] for row in query.all()})


def _published_card_rarities(db: Session) -> dict[int, str]:
    rows = db.query(
        Card.id, Card.print_rarity, TCGChecklistEntry.published_rarity, Card.rarity_class,
    ).join(TCGChecklistEntry, TCGChecklistEntry.card_id == Card.id).join(
        TCGRelease, TCGRelease.id == TCGChecklistEntry.release_id,
    ).filter(
        TCGRelease.status == "published", Card.card_type.notin_([CardType.hof, CardType.bond]),
    ).order_by(TCGChecklistEntry.id).all()
    result: dict[int, str] = {}
    for card_id, print_rarity, published_rarity, rarity_class in rows:
        rarity = str(print_rarity or published_rarity or rarity_class or "C").upper()
        if rarity not in RARITY_UNITS:
            rarity = "C"
        result.setdefault(card_id, rarity)
    return result


def _focus_catalog(db: Session) -> tuple[list[str], list[str]]:
    """Collect real topics from card artwork, gallery tags, and linked subjects."""
    direct_tags = db.query(Tag.name).select_from(Card).join(
        image_tags, image_tags.c.image_id == Card.source_image_id,
    ).join(Tag, Tag.id == image_tags.c.tag_id).distinct().all()
    gallery_tags_found = db.query(Tag.name).select_from(Card).join(
        gallery_tags, gallery_tags.c.gallery_id == Card.source_gallery_id,
    ).join(Tag, Tag.id == gallery_tags.c.tag_id).distinct().all()
    gallery_image_tags = db.query(Tag.name).select_from(Card).join(
        Image, Image.gallery_id == Card.source_gallery_id,
    ).join(image_tags, image_tags.c.image_id == Image.id).join(
        Tag, Tag.id == image_tags.c.tag_id,
    ).distinct().all()
    tag_rows = [*direct_tags, *gallery_tags_found, *gallery_image_tags]
    subject_rows = db.query(Creator.name).select_from(Card).join(
        Creator, or_(Card.source_creator_id == Creator.id, Card.linked_character_id == Creator.id),
    ).distinct().all()
    subject_rows.extend(db.query(Creator.name).select_from(Card).join(
        Image, Image.id == Card.source_image_id,
    ).join(image_creators, image_creators.c.image_id == Image.id).join(
        Creator, Creator.id == image_creators.c.creator_id,
    ).distinct().all())
    subject_rows.extend(db.query(Creator.name).select_from(Card).join(
        Gallery, Gallery.id == Card.source_gallery_id,
    ).join(Creator, or_(Gallery.creator_id == Creator.id, Gallery.linked_character_id == Creator.id)).distinct().all())
    subject_rows.extend(db.query(Creator.name).select_from(Card).join(
        gallery_creators, gallery_creators.c.gallery_id == Card.source_gallery_id,
    ).join(Creator, Creator.id == gallery_creators.c.creator_id).distinct().all())

    # Collab cards store additional linked creators as IDs in their frozen
    # metadata instead of the two direct creator columns.
    collab_subjects: list[tuple[str]] = []
    collab_ids: set[int] = set()
    for _, raw in db.query(Card.id, Card.collab_data).filter(Card.collab_data.isnot(None)).all():
        details = _load(raw, {})
        creator_ids = details.get("creator_ids", []) if isinstance(details, dict) else []
        collab_ids.update(int(value) for value in creator_ids if str(value).isdigit())
    if collab_ids:
        collab_subjects.extend(
            (name,) for (name,) in db.query(Creator.name).filter(Creator.id.in_(collab_ids)).all()
        )
    subject_rows.extend(collab_subjects)

    def clean(values, *, tags: bool) -> list[str]:
        result: dict[str, str] = {}
        for row in values:
            value = " ".join(str(row[0] or "").split())
            normalized = value.casefold()
            if not value or len(value) > 48 or len(value) < 3:
                continue
            if tags and normalized in FOCUS_IGNORED_TAGS:
                continue
            if not any(character.isalpha() for character in value):
                continue
            result.setdefault(normalized, value)
        return sorted(result.values(), key=str.casefold)

    return clean(tag_rows, tags=True), clean(subject_rows, tags=False)


def _build_daily_focus(db: Session, seed: str, trader: TCGTraderDefinition) -> dict:
    tags, subjects = _focus_catalog(db)
    rng = random.Random(_seed("tcg-trader-focus-v1", seed, trader.code))
    available_tags = list(tags)
    available_subjects = list(subjects)
    chosen: list[str] = []

    def draw(pool: list[str]) -> str | None:
        if not pool:
            return None
        value = pool.pop(rng.randrange(len(pool)))
        if value.casefold() not in {item.casefold() for item in chosen}:
            chosen.append(value)
            return value
        return draw(pool)

    likes: list[str] = []
    for pool in (available_tags, available_subjects):
        value = draw(pool)
        if value:
            likes.append(value)
    while len(likes) < 2:
        value = draw(available_tags) or draw(available_subjects)
        if not value:
            break
        likes.append(value)

    avoid: list[str] = []
    for pool in (available_tags, available_subjects):
        value = draw(pool)
        if value:
            avoid.append(value)
            if len(avoid) >= 1:
                break
    return {
        "likes": likes,
        "avoids": avoid,
    }


def _visit_focus(db: Session, visit: TCGTraderVisit, trader: TCGTraderDefinition) -> dict:
    saved = _load(visit.focus_json, {})
    if (isinstance(saved, dict) and isinstance(saved.get("likes"), list)
            and isinstance(saved.get("avoids"), list)):
        return saved
    return _build_daily_focus(db, visit.visit_seed, trader)


def _ensure_visit_focus(db: Session, visit: TCGTraderVisit, trader: TCGTraderDefinition) -> tuple[dict, bool]:
    saved = _load(visit.focus_json, {})
    if (isinstance(saved, dict) and isinstance(saved.get("likes"), list)
            and isinstance(saved.get("avoids"), list)):
        return saved, False
    focus = _build_daily_focus(db, visit.visit_seed, trader)
    visit.focus_json = _dump(focus)
    return focus, True


def _focus_card_matches(db: Session, terms: list[str]) -> set[int]:
    normalized = sorted({" ".join(str(term).split()).casefold() for term in terms if str(term).strip()})
    if not normalized:
        return set()
    matched: set[int] = set()
    tag_sources = (
        db.query(Card.id).select_from(Card).join(
            image_tags, image_tags.c.image_id == Card.source_image_id,
        ).join(Tag, Tag.id == image_tags.c.tag_id).filter(func.lower(Tag.name).in_(normalized)),
        db.query(Card.id).select_from(Card).join(
            gallery_tags, gallery_tags.c.gallery_id == Card.source_gallery_id,
        ).join(Tag, Tag.id == gallery_tags.c.tag_id).filter(func.lower(Tag.name).in_(normalized)),
        db.query(Card.id).select_from(Card).join(
            Image, Image.gallery_id == Card.source_gallery_id,
        ).join(image_tags, image_tags.c.image_id == Image.id).join(
            Tag, Tag.id == image_tags.c.tag_id,
        ).filter(func.lower(Tag.name).in_(normalized)),
    )
    for query in tag_sources:
        matched.update(row[0] for row in query.distinct().all())
    subjects = db.query(Card.id).select_from(Card).join(
        Creator, or_(Card.source_creator_id == Creator.id, Card.linked_character_id == Creator.id),
    ).filter(func.lower(Creator.name).in_(normalized)).distinct().all()
    matched.update(row[0] for row in subjects)
    matched.update(row[0] for row in db.query(Card.id).select_from(Card).join(
        Image, Image.id == Card.source_image_id,
    ).join(image_creators, image_creators.c.image_id == Image.id).join(
        Creator, Creator.id == image_creators.c.creator_id,
    ).filter(func.lower(Creator.name).in_(normalized)).distinct().all())
    matched.update(row[0] for row in db.query(Card.id).select_from(Card).join(
        Gallery, Gallery.id == Card.source_gallery_id,
    ).join(Creator, or_(Gallery.creator_id == Creator.id, Gallery.linked_character_id == Creator.id)).filter(
        func.lower(Creator.name).in_(normalized),
    ).distinct().all())
    matched.update(row[0] for row in db.query(Card.id).select_from(Card).join(
        gallery_creators, gallery_creators.c.gallery_id == Card.source_gallery_id,
    ).join(Creator, Creator.id == gallery_creators.c.creator_id).filter(
        func.lower(Creator.name).in_(normalized),
    ).distinct().all())

    # Collab subjects live in JSON, so match those IDs after resolving creator
    # names. This includes legacy, HOF, and Bond cards with linked metadata.
    creator_ids = {
        row[0] for row in db.query(Creator.id).filter(func.lower(Creator.name).in_(normalized)).all()
    }
    if creator_ids:
        for card_id, raw in db.query(Card.id, Card.collab_data).filter(Card.collab_data.isnot(None)).all():
            details = _load(raw, {})
            linked = details.get("creator_ids", []) if isinstance(details, dict) else []
            if any(str(value).isdigit() and int(value) in creator_ids for value in linked):
                matched.add(card_id)
    return matched


def _focused_stock_ids(db: Session, card_ids: list[int], focus: dict, seed: str, *, limit: int = DAILY_STOCK_SIZE) -> list[int]:
    """Build a focus-weighted stock mix with rarity targets and safe shortages."""
    unique_ids = sorted(set(int(card_id) for card_id in card_ids))
    if not unique_ids:
        return []
    stock_size = min(len(unique_ids), max(DAILY_STOCK_MINIMUM, min(DAILY_STOCK_SIZE, int(limit))))
    liked = _focus_card_matches(db, focus.get("likes", []))
    avoided = _focus_card_matches(db, focus.get("avoids", []))
    rarities = _published_card_rarities(db)
    pools: dict[str, list[int]] = {rarity: [] for rarity in RARITY_UNITS}
    for card_id in unique_ids:
        pools[rarities.get(card_id, "C")].append(card_id)

    quota_rng = random.Random(_seed("tcg-trader-stock-rarity-v1", seed))
    selection_rng = random.Random(_seed("tcg-trader-stock-focus-v2", seed))
    spr_roll = random.Random(_seed("tcg-trader-stock-spr-v1", seed)).random() < DAILY_SPR_CHANCE
    ur_target = quota_rng.randint(DAILY_UR_MINIMUM, DAILY_UR_MAXIMUM)
    sr_target = quota_rng.randint(DAILY_SR_MINIMUM, DAILY_SR_MAXIMUM)
    selected: list[int] = []
    selected_ids: set[int] = set()

    def take(candidates: list[int], count: int, *, weight_focus: bool) -> list[int]:
        available = [card_id for card_id in candidates if card_id not in selected_ids]
        taken: list[int] = []
        for _ in range(min(max(0, count), len(available), stock_size - len(selected))):
            if weight_focus:
                weights = [max(0.12, 1.0 + 8.0 * int(card_id in liked) - 0.88 * int(card_id in avoided))
                           for card_id in available]
                card_id = selection_rng.choices(available, weights=weights, k=1)[0]
            else:
                # R and C are the everyday filler and stay uniformly random.
                card_id = selection_rng.choice(available)
            available.remove(card_id)
            selected.append(card_id)
            selected_ids.add(card_id)
            taken.append(card_id)
        return taken

    take(pools["UR"], ur_target, weight_focus=True)
    take(pools["SR"], sr_target, weight_focus=True)
    if spr_roll and len(selected) < stock_size:
        take(pools["SPR"], 1, weight_focus=True)
    take([*pools["R"], *pools["C"]], stock_size - len(selected), weight_focus=False)

    # If R/C are scarce, use any remaining UR/SR capacity without crossing the
    # daily caps. This also fills normal pools when the seeded target was low.
    current_ur = sum(rarities.get(card_id, "C") == "UR" for card_id in selected)
    current_sr = sum(rarities.get(card_id, "C") == "SR" for card_id in selected)
    take(pools["UR"], DAILY_UR_MAXIMUM - current_ur, weight_focus=True)
    take(pools["SR"], DAILY_SR_MAXIMUM - current_sr, weight_focus=True)
    return selected


def _expire_prior_visits(db: Session, active_day: date) -> None:
    """Release abandoned quotes when a later daily visit becomes active."""
    active_key = active_day.isoformat()
    active_start = datetime.combine(active_day, datetime.min.time())
    stale = db.query(TCGTraderVisit).filter(TCGTraderVisit.status == "active").all()
    stale = [visit for visit in stale if visit.arrives_at < active_start or
             (visit.arrives_at == active_start and visit.week_key != active_key)]
    for visit in stale:
        offers = db.query(TCGTraderOffer).filter_by(visit_id=visit.id, status="open").all()
        for offer in offers:
            reservations = db.query(TCGTraderReservation).filter_by(offer_id=offer.id, status="active").all()
            for reservation in reservations:
                _restore_reservation(db, reservation)
            offer.status = "expired"
            offer.resolved_at = datetime.now()
        visit.status = "expired"
    if stale:
        db.commit()


def _assert_transferable_card(db: Session, card_id: int, *, allow_spr: bool) -> Card:
    card = db.get(Card, card_id)
    if not card or _enum(card.card_type) in {"hof", "bond"}:
        raise ValueError("Earned cards cannot enter trader transfers")
    entry = db.query(TCGChecklistEntry).join(TCGRelease).filter(
        TCGChecklistEntry.card_id == card_id, TCGRelease.status == "published",
    ).first()
    if not entry: raise ValueError("Only published cards can enter trader transfers")
    rarity = card.print_rarity or entry.published_rarity or card.rarity_class
    if rarity == "SPR" and not allow_spr:
        raise ValueError("SPR trading is disabled until its simulation is approved")
    return card


def _card_tags(db: Session, card: Card) -> list[str]:
    names: set[str] = set()
    if card.source_image_id:
        names.update(row[0] for row in db.query(Tag.name).join(
            image_tags, Tag.id == image_tags.c.tag_id,
        ).filter(image_tags.c.image_id == card.source_image_id).all())
    if card.source_gallery_id:
        names.update(row[0] for row in db.query(Tag.name).join(
            gallery_tags, Tag.id == gallery_tags.c.tag_id,
        ).filter(gallery_tags.c.gallery_id == card.source_gallery_id).all())
        names.update(row[0] for row in db.query(Tag.name).join(
            image_tags, Tag.id == image_tags.c.tag_id,
        ).join(Image, Image.id == image_tags.c.image_id).filter(
            Image.gallery_id == card.source_gallery_id,
        ).all())
    return sorted(names, key=str.casefold)


def _card_subjects(db: Session, card: Card) -> list[str]:
    subject_ids = {value for value in (card.source_creator_id, card.linked_character_id) if value}
    if card.source_image_id:
        subject_ids.update(row[0] for row in db.query(image_creators.c.creator_id).filter(
            image_creators.c.image_id == card.source_image_id,
        ).all())
    if card.source_gallery_id:
        gallery = db.get(Gallery, card.source_gallery_id)
        if gallery:
            subject_ids.update(value for value in (gallery.creator_id, gallery.linked_character_id) if value)
        subject_ids.update(row[0] for row in db.query(gallery_creators.c.creator_id).filter(
            gallery_creators.c.gallery_id == card.source_gallery_id,
        ).all())
    details = _load(card.collab_data, {})
    collab_ids = details.get("creator_ids", []) if isinstance(details, dict) else []
    subject_ids.update(int(value) for value in collab_ids if str(value).isdigit())
    if not subject_ids:
        return []
    return sorted({row[0] for row in db.query(Creator.name).filter(
        Creator.id.in_(subject_ids),
    ).all()}, key=str.casefold)


def _normalise_topic(value: Any) -> str:
    return re.sub(r"[\W_]+", " ", str(value or "").casefold(), flags=re.UNICODE).strip()


def _matching_topic_count(terms: list[str], values: list[Any]) -> int:
    topics = {_normalise_topic(value) for value in values if _normalise_topic(value)}
    normalized_terms = {_normalise_topic(term) for term in terms if _normalise_topic(term)}
    if not topics or not normalized_terms:
        return 0
    haystack = " " + " ".join(sorted(topics)) + " "
    return sum(1 for term in normalized_terms if term in topics or f" {term} " in haystack)


def _card_catalog_identifier(db: Session, card: Card) -> str:
    entry = db.query(TCGChecklistEntry, TCGRelease.code).join(
        TCGRelease, TCGRelease.id == TCGChecklistEntry.release_id,
    ).filter(
        TCGChecklistEntry.card_id == card.id,
        TCGRelease.status == "published",
    ).order_by(TCGChecklistEntry.is_base_printing.desc(), TCGChecklistEntry.id).first()
    if entry:
        row, release_code = entry
        suffix = row.collector_suffix or ""
        return f"{release_code}-{row.collector_position:03d}{suffix}"
    if card.catalog_code and card.collector_number is not None:
        return f"{card.catalog_code}-{int(card.collector_number):03d}"
    return card.catalog_code or f"CARD-{card.id:06d}"


def _resolve_card_reference(db: Session, card_reference: int | str) -> Card:
    if isinstance(card_reference, bool):
        raise ValueError("Enter a card ID or catalog code")
    if isinstance(card_reference, int):
        card = db.get(Card, card_reference)
        if card:
            return card
        raise ValueError("That card could not be found")

    raw = str(card_reference or "").strip()
    if not raw:
        raise ValueError("Enter a card ID or catalog code")
    if raw.isdigit():
        card = db.get(Card, int(raw))
        if card:
            return card
    legacy_id = re.fullmatch(r"CARD-(\d+)", raw, flags=re.IGNORECASE)
    if legacy_id:
        card = db.get(Card, int(legacy_id.group(1)))
        if card:
            return card

    # Published catalog IDs are release code + collector position + optional
    # suffix, for example REL-2026-10-435 or REL-2026-10-435S.
    match = re.fullmatch(r"(?P<release>.+)-(?P<number>\d+)(?P<suffix>[A-Za-z]*)", raw)
    if match:
        release_code = match.group("release")
        collector_number = int(match.group("number"))
        suffix = match.group("suffix").casefold()
        catalog_match = db.query(Card).join(
            TCGChecklistEntry, TCGChecklistEntry.card_id == Card.id,
        ).join(TCGRelease, TCGRelease.id == TCGChecklistEntry.release_id).filter(
            func.lower(TCGRelease.code) == release_code.casefold(),
            TCGChecklistEntry.collector_position == collector_number,
            func.lower(func.coalesce(TCGChecklistEntry.collector_suffix, "")) == suffix,
        ).order_by(
            (TCGRelease.status == "published").desc(),
            TCGChecklistEntry.is_base_printing.desc(),
            TCGChecklistEntry.id,
        ).first()
        if catalog_match:
            return catalog_match

        # Foundation and preserved legacy printings may have no release row;
        # their Card record still carries catalog_code + collector_number.
        direct = db.query(Card).filter(
            func.lower(Card.catalog_code) == release_code.casefold(),
            Card.collector_number == collector_number,
        )
        if suffix:
            direct = direct.filter(Card.parallel_of_id.isnot(None))
        else:
            direct = direct.order_by(Card.parallel_of_id.isnot(None), Card.id)
        card = direct.first()
        if card:
            return card

    exact_codes = db.query(Card).filter(func.lower(Card.catalog_code) == raw.casefold()).order_by(Card.id).limit(2).all()
    if len(exact_codes) == 1:
        return exact_codes[0]
    if len(exact_codes) > 1:
        raise ValueError("That catalog code matches multiple cards; enter the full card ID")
    raise ValueError("That card or catalog code could not be found")


def _card_display_metadata(db: Session, card: Card) -> dict[str, str]:
    from services.cards import compose_display_name, format_hof_period, format_period

    image = db.get(Image, card.source_image_id) if card.source_image_id else None
    gallery = (db.get(Gallery, card.source_gallery_id) if card.source_gallery_id else None) or (
        db.get(Gallery, image.gallery_id) if image and image.gallery_id else None
    )
    creator = db.get(Creator, card.source_creator_id) if card.source_creator_id else None
    if creator is None and gallery:
        creator = next(iter(gallery.creators), None)
        if creator is None and gallery.creator_id:
            creator = db.get(Creator, gallery.creator_id)
    character = db.get(Creator, card.linked_character_id) if card.linked_character_id else None
    collab = _load(card.collab_data, {})
    display_name = compose_display_name(
        _enum(card.card_type),
        creator_name=creator.name if creator else None,
        gallery_name=gallery.name if gallery else None,
        character_name=character.name if character else None,
        collab_info=collab if isinstance(collab, dict) else None,
    )
    display_period = None
    if _enum(card.card_type) == "gallery" and gallery:
        display_period = format_period(gallery.period_month, gallery.period_year)
    elif _enum(card.card_type) == "hof":
        from models import HofCategoryAward, HofCrown
        crown = db.query(HofCrown.period_type, HofCrown.period_key).filter_by(card_id=card.id).first()
        award = None if crown else db.query(
            HofCategoryAward.period_type, HofCategoryAward.period_key,
        ).filter_by(card_id=card.id).first()
        period_type, period_key = crown or award or ("alltime", None)
        display_period = format_hof_period(period_type, period_key)
    display_title = (f"{display_name}  ·  {display_period}"
                     if display_period and _enum(card.card_type) in {"gallery", "hof"}
                     else display_name)
    catalog_code = _card_catalog_identifier(db, card)
    rarity = card.print_rarity or card.rarity_class or "C"
    card_type = _enum(card.card_type)
    values: list[Any] = [
        display_title, display_name,
        catalog_code, card.catalog_code, card.id, f"Card {card.id}", card_type, rarity,
    ]
    gallery_id = card.source_gallery_id
    if image:
        values.extend((image.filename, Path(image.file_path or image.filename or "").name))
        gallery_id = gallery_id or image.gallery_id
    if gallery_id:
        gallery = db.get(Gallery, gallery_id)
        if gallery:
            values.append(gallery.name)
    values.extend(_card_subjects(db, card))
    values.extend(_card_tags(db, card))
    normalized = dict.fromkeys(
        topic for value in values if (topic := _normalise_topic(value))
    )
    search_text = " ".join(normalized)
    return {
        "name": display_title,
        "display_name": display_name,
        "display_title": display_title,
        "catalog_code": catalog_code,
        "rarity": rarity,
        "card_type": card_type,
        "search_text": search_text,
    }


def valuation_from_inputs(inputs: dict, trader_traits: dict, *, purpose: str, seed: str) -> dict:
    """Pure deterministic valuation core shared by production and economy simulation."""
    competence = min(1.0, max(0.0, float(trader_traits.get("competence", 0.5))))
    metadata = [
        *(inputs.get("tags") or []), *(inputs.get("subjects") or []),
        inputs.get("card_type"), inputs.get("exposure"), inputs.get("intensity"),
        inputs.get("medium"), inputs.get("rarity"),
    ]
    focus = trader_traits.get("focus") or {}
    focus_likes = list(focus.get("likes") or []) if isinstance(focus, dict) else []
    focus_avoids = list(focus.get("avoids") or []) if isinstance(focus, dict) else []
    daily_likes = _matching_topic_count(focus_likes, metadata)
    daily_avoids = _matching_topic_count(focus_avoids, metadata)
    mint = 0.8 + min(0.5, max(0.0, float(inputs.get("mint_score", 0) or 0)) / 200.0)
    age = min(1.25, 1.0 + max(0, int(inputs.get("release_age_days", 0) or 0)) / 3650.0)
    owned_quantity = max(0, int(inputs.get("owned_quantity", 0) or 0))
    scarcity = 1.15 if owned_quantity <= 1 else max(0.75, 1.05 - 0.05 * (owned_quantity - 1))
    completion = 1.0 + min(1.0, max(0.0, float(inputs.get("completion_pressure", 0) or 0))) * 0.2
    reprint = 0.9 if inputs.get("reprint") else 1.0
    signature = 1.2 if inputs.get("signature") else 1.0
    # Only today's visit focus changes a trader's subjective card interest.
    # Cards matching neither side stay at the neutral 1.0 multiplier.
    preference = min(2.5, max(0.3, 1.0 + daily_likes * 0.75 - daily_avoids * 0.55))
    grade = str(inputs.get("grade") or "").upper()
    # A physical grade only adds value when this trader actively likes a card
    # matching today's focus. Neutral and avoided cards keep their base pricing.
    grade_bonus = GRADE_FOCUS_MULTIPLIER.get(grade, 1.0) if daily_likes else 1.0
    card_type = str(inputs.get("card_type") or "image").lower()
    card_type_value = CARD_TYPE_VALUE.get(card_type, 1.0)
    engagement_stats = inputs.get("engagement") or {}
    views = max(0, int(engagement_stats.get("views", 0) or 0))
    view_seconds = max(0, int(engagement_stats.get("view_seconds", 0) or 0))
    cum_count = max(0, int(engagement_stats.get("cum_count", 0) or 0))
    edge_count = max(0, int(engagement_stats.get("edge_count", 0) or 0))
    engagement = min(1.18, 1.0 + min(0.05, math.log1p(views) / 100.0)
                     + min(0.04, math.log1p(view_seconds) / 150.0)
                     + min(0.05, (cum_count + edge_count) * 0.004)
                     + (0.04 if engagement_stats.get("favorite") else 0.0))
    card_id = inputs.get("card_id", "synthetic")
    rng = random.Random(_seed(seed, card_id, purpose))
    noise_span = 0.04 + (1.0 - competence) * 0.28
    noise = 1.0 + rng.uniform(-noise_span, noise_span)
    multiplier = min(3.4, max(0.3,
        mint * age * scarcity * completion * reprint * signature * preference
        * grade_bonus * card_type_value * engagement * noise,
    ))
    rarity = str(inputs.get("rarity") or "C")
    units = max(0.25, RARITY_UNITS.get(rarity, 1.0) * multiplier)
    frozen_inputs = {**inputs, "trader_focus": {"likes": focus_likes, "avoids": focus_avoids}}
    return {"inputs": frozen_inputs, "multipliers": {"mint": mint, "age": age, "scarcity": scarcity,
            "completion": completion, "reprint": reprint, "signature": signature,
            "preference": preference, "grade_bonus": grade_bonus, "card_type": card_type_value,
            "engagement": engagement, "noise": noise}, "units": round(units, 3), "seed": seed}


def valuation(db: Session, card: Card, trader: TCGTraderDefinition, *, purpose: str, seed: str,
              focus: dict | None = None, grade: str | None = None) -> dict:
    rarity = card.print_rarity or card.rarity_class or "C"
    audit = _load(card.mint_audit_json, {})
    recipe = _load(card.visual_recipe, {})
    classification = db.query(CardContentClassification).filter_by(card_id=card.id).first()
    checklist = db.query(TCGChecklistEntry).filter_by(card_id=card.id).order_by(TCGChecklistEntry.id).first()
    release = db.get(TCGRelease, checklist.release_id) if checklist else None
    owned = db.query(func.sum(CardInventory.quantity)).filter_by(card_id=card.id).scalar() or 0
    tags = _card_tags(db, card)
    subjects = _card_subjects(db, card)
    source = db.get(Image, card.source_image_id) if card.source_image_id else None
    completion_pressure = 0.0
    if checklist and checklist.set_id:
        set_card_ids = [row[0] for row in db.query(TCGChecklistEntry.card_id).filter_by(
            set_id=checklist.set_id, required_for_complete=True,
        ).all()]
        if set_card_ids:
            owned_ids = {row[0] for row in db.query(CardInventory.card_id).filter(
                CardInventory.card_id.in_(set_card_ids), CardInventory.quantity > 0,
            ).all()}
            completion_pressure = len(owned_ids) / len(set_card_ids)
    provenance = audit.get("components", audit)
    inputs = {
        "card_id": card.id, "rarity": rarity, "mint_score": float(audit.get("score", card.crs or 0) or 0),
        "release_age_days": max(0, (datetime.now() - release.published_at).days) if release and release.published_at else 0,
        "reprint": bool(card.parallel_of_id), "completion_pressure": round(completion_pressure, 4),
        "signature": rarity == "SPR" or bool(recipe.get("signature")), "owned_quantity": int(owned),
        "card_type": _enum(card.card_type), "creator_id": card.source_creator_id,
        "character_id": card.linked_character_id, "tags": sorted(tags), "subjects": subjects,
        "grade": grade if grade in GRADE_TIER_BY_SCORE.values() else None,
        "exposure": classification.exposure_resolved if classification else "Unknown",
        "intensity": classification.intensity_resolved if classification else "Unknown",
        "medium": "video" if source and source.is_video else "image",
        "engagement_provenance": provenance,
        "engagement": {
            "views": source.view_count if source else 0,
            "view_seconds": source.view_seconds if source else 0,
            "cum_count": source.cum_count if source else 0,
            "edge_count": source.edge_count if source else 0,
            "favorite": bool(source and source.is_favorite),
        },
    }
    return valuation_from_inputs(inputs, {
        "competence": trader.competence, "focus": focus or {},
    }, purpose=purpose, seed=seed)


def _barter_card_value(db: Session, card: Card, trader: TCGTraderDefinition, visit: TCGTraderVisit,
                       copy: TCGPhysicalCardCopy | None = None) -> dict:
    """A stable per-copy quote shared by the preview and submitted trade."""
    seed = _seed(visit.visit_seed, "barter-card-value", card.id)
    return valuation(db, card, trader, purpose="barter", seed=seed,
                     focus=_visit_focus(db, visit, trader),
                     grade=_copy_grade(copy, card) if copy else None)


def _normalise_barter_inventory_ids(inventory_ids: int | list[int], *, allow_empty: bool = False) -> list[int]:
    if isinstance(inventory_ids, int):
        values = [inventory_ids]
    else:
        values = list(inventory_ids or [])
    values = [int(value) for value in values]
    if not values:
        if allow_empty:
            return []
        raise ValueError("Choose one or more cards from her offer")
    if any(value <= 0 for value in values):
        raise ValueError("Choose one or more cards from her offer")
    if len(set(values)) != len(values):
        raise ValueError("Choose each card from her offer only once")
    return values


def _stock_value_units(stock: TCGTraderInventory) -> float:
    """Read a stock card's frozen value, protecting old rows with a 0.25-unit floor."""
    raw = _load(stock.valuation_json, {}).get("units", 1)
    try:
        units = float(raw)
    except (TypeError, ValueError):
        units = 1.0
    if not math.isfinite(units):
        units = 1.0
    return max(0.25, units)


def _barter_minimum_units(stock: TCGTraderInventory, trader: TCGTraderDefinition) -> float:
    return round(_stock_value_units(stock) * (1.05 + trader.greed * .75), 3)


def _barter_surplus_terms(trader: TCGTraderDefinition, offered_units: float,
                          required_units: float | None, credits: int, shards: int) -> dict:
    """Return one deterministic currency payout for value above her minimum."""
    if required_units is None:
        return {
            "surplus_units": None, "payout_currency": None,
            "payout_amount": 0, "payout_value_units": None,
            "surplus_return_share": None,
        }
    surplus_units = round(max(0.0, offered_units - required_units), 3)
    share = SURPLUS_RETURN_SHARE_BY_TRADER_CODE.get(
        str(trader.code or "").casefold(), DEFAULT_SURPLUS_RETURN_SHARE,
    )
    # Mirror the largest currency contribution, preferring Credits on a tie.
    # Cards-only deals use Credits, so the payout has one predictable currency.
    payout_currency = "credits" if credits / 10 >= shards / 2.5 else "shards"
    conversion = 10 if payout_currency == "credits" else 2.5
    payout_amount = math.floor(surplus_units * share * conversion + 1e-9)
    if payout_amount <= 0:
        return {
            "surplus_units": surplus_units, "payout_currency": None,
            "payout_amount": 0, "payout_value_units": 0.0,
            "surplus_return_share": share,
        }
    payout_value_units = round(payout_amount / conversion, 3)
    return {
        "surplus_units": surplus_units, "payout_currency": payout_currency,
        "payout_amount": payout_amount, "payout_value_units": payout_value_units,
        "surplus_return_share": share,
    }


def _barter_pricing(db: Session, visit_id: int, inventory_ids: int | list[int],
                    copy_ids: list[int], credits: int, shards: int, *, allow_empty_targets: bool = False) -> dict:
    """Validate selections and calculate the exact totals used by quote and offer."""
    if credits < 0 or shards < 0:
        raise ValueError("Optional payment cannot be negative")
    target_ids = _normalise_barter_inventory_ids(inventory_ids, allow_empty=allow_empty_targets)
    visit = _active_visit(db, visit_id)
    trader = db.get(TCGTraderDefinition, visit.trader_id)
    stocks = []
    for inventory_id in target_ids:
        stock = db.get(TCGTraderInventory, inventory_id)
        if not stock or stock.visit_id != visit.id:
            raise ValueError("Trader stock is unavailable")
        if stock.quantity - stock.reserved_quantity < 1:
            raise ValueError("One or more cards from her offer are no longer available")
        _assert_transferable_card(db, stock.card_id, allow_spr=_spr_enabled(db))
        stocks.append(stock)

    copies = _eligible_user_copies(db, copy_ids, allow_empty=True)
    # A player can offer several physical copies of the same card. Its value
    # is per card and trader, so reuse that quote instead of repeating the
    # same database-heavy valuation for every copy.
    cards_by_id: dict[int, Card] = {}
    user_card_units = 0.0
    for copy in copies:
        card = cards_by_id.get(copy.card_id)
        if card is None:
            card = db.get(Card, copy.card_id)
        if not card:
            raise ValueError(f"Card {copy.card_id} disappeared while pricing the offer")
        cards_by_id[copy.card_id] = card
        user_card_units += _barter_card_value(db, card, trader, visit, copy)["units"]
    required_units = round(sum(_barter_minimum_units(stock, trader) for stock in stocks), 3) if stocks else None
    offered_units = round(user_card_units + credits / 10 + shards / 2.5, 3)
    shortfall_units = max(0.0, required_units - offered_units) if required_units is not None else None
    surplus = _barter_surplus_terms(trader, offered_units, required_units, credits, shards)
    return {
        "visit": visit,
        "trader": trader,
        "stocks": stocks,
        "copies": copies,
        "target_inventory_ids": target_ids,
        "target_card_ids": [stock.card_id for stock in stocks],
        "user_card_value_units": round(user_card_units, 3),
        "offer_value_units": offered_units,
        "required_value_units": required_units,
        "shortfall_units": round(shortfall_units, 3) if shortfall_units is not None else None,
        "meets_minimum": shortfall_units <= 0.0005 if shortfall_units is not None else None,
        "credits_offered": credits,
        "shards_offered": shards,
        **surplus,
    }


def quote_barter_offer(db: Session, visit_id: int, inventory_ids: int | list[int],
                       copy_ids: list[int] | None = None, credits: int = 0, shards: int = 0) -> dict:
    """Return the same value comparison that a submitted barter offer will use."""
    pricing = _barter_pricing(
        db, visit_id, inventory_ids, copy_ids or [], credits, shards, allow_empty_targets=True,
    )
    return {
        "visit_id": visit_id,
        "inventory_ids": pricing["target_inventory_ids"],
        "card_ids": pricing["target_card_ids"],
        "copy_ids": [copy.id for copy in pricing["copies"]],
        "offer_value_units": pricing["offer_value_units"],
        "required_value_units": pricing["required_value_units"],
        "meets_minimum": pricing["meets_minimum"],
        "shortfall_units": pricing["shortfall_units"],
        "surplus_units": pricing["surplus_units"],
        "payout_currency": pricing["payout_currency"],
        "payout_amount": pricing["payout_amount"],
        "payout_value_units": pricing["payout_value_units"],
    }


def _resolve_pending_requests(db: Session, visit: TCGTraderVisit, trader: TCGTraderDefinition,
                              frozen_ids: list[int]) -> None:
    """Resolve this trader's queued card requests on her next daily appearance."""
    requests = db.query(TCGTraderRequest).join(
        TCGTraderVisit, TCGTraderRequest.visit_id == TCGTraderVisit.id,
    ).filter(
        TCGTraderVisit.trader_id == trader.id,
        TCGTraderRequest.status == "pending",
        TCGTraderRequest.visit_id != visit.id,
    ).order_by(TCGTraderRequest.created_at, TCGTraderRequest.id).all()
    stock_ids = set(frozen_ids)
    rarity_by_id = _published_card_rarities(db)
    stock_rows = {
        row.card_id: row for row in db.query(TCGTraderInventory).filter_by(visit_id=visit.id).all()
    }
    protected_request_ids: set[int] = set()
    rarity_caps = {"UR": DAILY_UR_MAXIMUM, "SR": DAILY_SR_MAXIMUM}
    for request in requests:
        card = db.get(Card, request.card_id)
        try:
            _assert_transferable_card(db, request.card_id, allow_spr=True)
        except ValueError:
            request.status = "refused"
            request.result_json = _dump({"reason": "That card is no longer available to trade.",
                                         "request_chance_pct": 0, "next_visit_id": visit.id,
                                         "catalog_code": _card_catalog_identifier(db, card) if card else None})
            continue
        chance_pct = round(REQUEST_FULFILLMENT_CHANCE * 100)
        already_in_stock = request.card_id in stock_ids
        found = already_in_stock or random.Random(
            _seed(request.seed, "next-appearance", visit.visit_seed),
        ).random() < REQUEST_FULFILLMENT_CHANCE
        if found:
            if not already_in_stock:
                rarity = rarity_by_id.get(card.id, "C")
                cap = rarity_caps.get(rarity)
                if cap is not None:
                    rarity_count = sum(1 for stock_id in stock_ids if rarity_by_id.get(stock_id) == rarity)
                    if rarity_count >= cap:
                        # Keep the published rarity mix intact while honoring
                        # the request. Replace an ordinary card from the same
                        # capped bucket, never a card requested earlier today.
                        replace_id = next((stock_id for stock_id in frozen_ids
                                           if stock_id in stock_ids
                                           and stock_id not in protected_request_ids
                                           and rarity_by_id.get(stock_id) == rarity), None)
                        if replace_id is None:
                            # This can occur only when more same-rarity requests
                            # are pending than the entire daily bucket can hold.
                            request.status = "refused"
                            request.result_json = _dump({
                                "reason": "She couldn't fit another card of that rarity into today's stock.",
                                "request_chance_pct": chance_pct,
                                "next_visit_id": visit.id,
                                "catalog_code": _card_catalog_identifier(db, card),
                            })
                            continue
                        stock_ids.remove(replace_id)
                        frozen_ids.remove(replace_id)
                        replaced_row = stock_rows.pop(replace_id, None)
                        if replaced_row is not None:
                            db.delete(replaced_row)
                quote = valuation(db, card, trader, purpose="stock", seed=visit.visit_seed,
                                  focus=_visit_focus(db, visit, trader))
                inventory_row = TCGTraderInventory(
                    visit_id=visit.id, card_id=card.id, quantity=1,
                    valuation_json=_dump(quote),
                    unit_credits=max(1, round(quote["units"] * 12 * (1.15 + trader.greed * .6))),
                    unit_shards=max(1, round(quote["units"] * 3 * (1.15 + trader.greed * .6))),
                )
                db.add(inventory_row)
                stock_rows[card.id] = inventory_row
                stock_ids.add(card.id)
                frozen_ids.append(card.id)
            protected_request_ids.add(card.id)
            request.status = "fulfilled"
            request.result_json = _dump({"reason": "She brought the card you asked for.",
                                         "request_chance_pct": chance_pct,
                                         "next_visit_id": visit.id,
                                         "catalog_code": _card_catalog_identifier(db, card)})
        else:
            request.status = "refused"
            request.result_json = _dump({"reason": "She couldn't find the card before her next visit.",
                                         "request_chance_pct": chance_pct,
                                         "next_visit_id": visit.id,
                                         "catalog_code": _card_catalog_identifier(db, card)})
    visit.inventory_frozen_json = _dump(frozen_ids)


def current_visit(db: Session, *, day: date | None = None) -> dict:
    seed_traders(db)
    # Persist profile additions and renames even when today's visit already
    # exists. The visit row and its frozen stock are deliberately left untouched.
    db.commit()
    requested_day = day or date.today()
    latest = db.query(TCGTraderVisit).order_by(TCGTraderVisit.arrives_at.desc(), TCGTraderVisit.id.desc()).first()
    # A clock rollback must not create a fresh historical visit or reroll stock.
    if latest and requested_day < latest.arrives_at.date():
        requested_day = latest.arrives_at.date()
    day_key = _day_key(requested_day)
    _expire_prior_visits(db, requested_day)
    visit = db.query(TCGTraderVisit).filter_by(week_key=day_key).first()
    if not visit:
        visit_seed = _seed("vault-daily-trader", day_key)
        traders = db.query(TCGTraderDefinition).filter_by(enabled=True).order_by(TCGTraderDefinition.code).all()
        if not traders:
            raise ValueError("No traders are currently available")
        # Walk the roster in a stable daily cycle, adjusting the first visit
        # after migration if it would repeat the most recent historical trader.
        previous = db.query(TCGTraderVisit).filter(
            TCGTraderVisit.arrives_at <= datetime.combine(requested_day, datetime.min.time()),
            TCGTraderVisit.week_key != day_key,
        ).order_by(TCGTraderVisit.arrives_at.desc(), TCGTraderVisit.id.desc()).first()
        preferred = requested_day.toordinal() % len(traders)
        if previous and len(traders) > 1:
            enabled_ids = {row.id for row in traders}
            if previous.trader_id in enabled_ids and traders[preferred].id == previous.trader_id:
                preferred = (preferred + 1) % len(traders)
        trader = traders[preferred]
        start = datetime.combine(requested_day, datetime.min.time())
        visit = TCGTraderVisit(
            # Keep the unique legacy column for compatibility with existing DBs;
            # new rows store their ISO date here without altering old history.
            week_key=day_key, trader_id=trader.id, visit_seed=visit_seed, arrives_at=start,
            departs_at=start + timedelta(days=1), request_allowance=trader.request_limit,
            inventory_frozen_json="[]", conversation_json="[]", offer_state_json="{}",
        )
        focus = _build_daily_focus(db, visit_seed, trader)
        visit.focus_json = _dump(focus)
        db.add(visit); db.flush()
        ids = _published_card_ids(db, allow_spr=True)
        frozen = _focused_stock_ids(db, ids, focus, visit_seed, limit=16)
        visit.inventory_frozen_json = _dump(frozen)
        for card_id in frozen:
            card = db.get(Card, card_id)
            quote = valuation(db, card, trader, purpose="stock", seed=visit_seed, focus=focus)
            db.add(TCGTraderInventory(
                visit_id=visit.id, card_id=card_id, quantity=1, valuation_json=_dump(quote),
                unit_credits=max(1, round(quote["units"] * 12 * (1.15 + trader.greed * .6))),
                unit_shards=max(1, round(quote["units"] * 3 * (1.15 + trader.greed * .6))),
            ))
        _resolve_pending_requests(db, visit, trader, frozen)
        db.commit()
    elif not _load(visit.inventory_frozen_json, []):
        # Visits created while the old simulation gate was active were saved
        # with an empty stock snapshot. Populate that empty snapshot once, using
        # a stable seed; never reroll existing stock or refill purchases.
        has_inventory = db.query(TCGTraderInventory.id).filter_by(visit_id=visit.id).first()
        if not has_inventory:
            trader = db.get(TCGTraderDefinition, visit.trader_id)
            focus, _ = _ensure_visit_focus(db, visit, trader)
            ids = _published_card_ids(db, allow_spr=True)
            frozen = _focused_stock_ids(db, ids, focus, visit.visit_seed, limit=16)
            visit.inventory_frozen_json = _dump(frozen)
            for card_id in frozen:
                card = db.get(Card, card_id)
                quote = valuation(db, card, trader, purpose="stock", seed=visit.visit_seed, focus=focus)
                db.add(TCGTraderInventory(
                    visit_id=visit.id, card_id=card_id, quantity=1, valuation_json=_dump(quote),
                    unit_credits=max(1, round(quote["units"] * 12 * (1.15 + trader.greed * .6))),
                    unit_shards=max(1, round(quote["units"] * 3 * (1.15 + trader.greed * .6))),
                ))
            _resolve_pending_requests(db, visit, trader, frozen)
            db.commit()
    trader = db.get(TCGTraderDefinition, visit.trader_id)
    focus, focus_changed = _ensure_visit_focus(db, visit, trader)
    if focus_changed:
        db.commit()
    return {"visit_id": visit.id, "week_key": visit.week_key, "day_key": visit.arrives_at.date().isoformat(), "seed": visit.visit_seed,
            "production_enabled": production_enabled(db), "requests_remaining": max(0, visit.request_allowance - visit.requests_used),
            "focus": {"likes": focus.get("likes", []), "avoids": focus.get("avoids", [])},
            "trader": {"id": trader.code, "name": trader.name, "age": trader.age, "biography": trader.biography,
                       "personality": trader.personality, "preferences": _load(trader.preferences_json, []),
                       "dislikes": _load(trader.dislikes_json, []), "quirks": _load(trader.quirks_json, []),
                       "request_chance_pct": round(REQUEST_FULFILLMENT_CHANCE * 100),
                       "visual_manifest": _load(trader.visual_manifest_json, {}), "dialogue_manifest": _load(trader.dialogue_manifest_json, {})}}


def trader_inventory(db: Session, visit_id: int) -> list[dict]:
    visit = _active_visit(db, visit_id)
    trader = db.get(TCGTraderDefinition, visit.trader_id)
    allow_spr = _spr_enabled(db)
    rows = db.query(TCGTraderInventory).filter_by(visit_id=visit_id).order_by(TCGTraderInventory.id).all()
    result = []
    for row in rows:
        card = db.get(Card, row.card_id)
        if card is None:
            continue
        unavailable_reason = None
        try:
            _assert_transferable_card(db, row.card_id, allow_spr=allow_spr)
        except ValueError as exc:
            unavailable_reason = str(exc)
        minimum = _barter_minimum_units(row, trader)
        metadata = _card_display_metadata(db, card)
        result.append({"id": row.id, "card_id": row.card_id, "quantity": row.quantity,
                       **metadata,
                       "available": 0 if unavailable_reason else max(0, row.quantity - row.reserved_quantity),
                       "unavailable_reason": unavailable_reason, "credits": row.unit_credits,
                       "shards": row.unit_shards, "valuation": _load(row.valuation_json, {}),
                       "barter_minimum_units": round(minimum, 3)})
    return result


def trade_candidates(db: Session, visit_id: int) -> dict:
    """Return every owned physical copy that is not already reserved."""
    visit = _active_visit(db, visit_id)
    trader = db.get(TCGTraderDefinition, visit.trader_id)
    owned = {int(card_id): int(quantity or 0) for card_id, quantity in db.query(
        CardInventory.card_id, func.sum(CardInventory.quantity),
    ).group_by(CardInventory.card_id).all()}
    physical_counts = {int(card_id): int(count or 0) for card_id, count in db.query(
        TCGPhysicalCardCopy.card_id, func.count(TCGPhysicalCardCopy.id),
    ).filter(TCGPhysicalCardCopy.location_kind != "traded_away").group_by(
        TCGPhysicalCardCopy.card_id,
    ).all()}
    reserved_ids = {
        int(copy_id) for (copy_id,) in db.query(TCGTraderReservation.physical_copy_id).filter(
            TCGTraderReservation.status == "active",
            TCGTraderReservation.physical_copy_id.isnot(None),
        ).all()
    }
    candidates = []
    metadata_by_card: dict[int, dict[str, str]] = {}
    rows = db.query(TCGPhysicalCardCopy).filter(
        TCGPhysicalCardCopy.location_kind.notin_(["trader_reserved", "traded_away"]),
    ).order_by(TCGPhysicalCardCopy.card_id, TCGPhysicalCardCopy.copy_ordinal).all()
    context = {
        "copies": {copy.id: copy for copy in rows}, "reserved": reserved_ids,
        "owned": owned, "counts": physical_counts,
        "cards": {card.id: card for card in db.query(Card).join(
            TCGPhysicalCardCopy, TCGPhysicalCardCopy.card_id == Card.id,
        ).filter(TCGPhysicalCardCopy.location_kind != "traded_away").distinct().all()},
        "assignments": {row.physical_copy_id: row for row in db.query(TCGDisplayAssignment).all()},
        "slots": {row.id: row for row in db.query(TCGBinderSlot).filter(TCGBinderSlot.physical_copy_id.isnot(None)).all()},
        "locations": db.query(TCGTraderReservation.previous_location_json).filter(
            TCGTraderReservation.status == "active", TCGTraderReservation.physical_copy_id.isnot(None),
        ).all(),
    }
    values_by_card_grade = {}
    for copy in rows:
        if copy.id in reserved_ids:
            continue
        if owned.get(copy.card_id, 0) <= 0 or owned.get(copy.card_id, 0) != physical_counts.get(copy.card_id, 0):
            continue
        try:
            _eligible_user_copy(db, copy.id, context=context)
        except ValueError:
            continue
        card = context["cards"].get(copy.card_id)
        if not card:
            continue
        if card.id not in metadata_by_card:
            metadata_by_card[card.id] = _card_display_metadata(db, card)
        metadata = metadata_by_card[card.id]
        value_key = (card.id, _copy_grade(copy, card))
        if value_key not in values_by_card_grade:
            values_by_card_grade[value_key] = _barter_card_value(db, card, trader, visit, copy)["units"]
        copy_value = values_by_card_grade[value_key]
        candidates.append({
            "copy_id": copy.id,
            "card_id": card.id,
            "copy_ordinal": copy.copy_ordinal,
            "owned_quantity": owned.get(card.id, 0),
            "location_kind": copy.location_kind,
            "release_code": card.catalog_code,
            **metadata,
            "grade": _copy_grade(copy, card),
            "is_graded": copy.grade in GRADE_TIER_BY_SCORE.values(),
            "barter_value_units": copy_value,
        })
    return {
        "items": candidates,
        "policy": {
            "all_owned_copies_eligible": True,
            "active_reservations_excluded": True,
            "final_copy_protected": False,
            "earned_cards_protected": False,
            "unpublished_cards_protected": False,
            "spr_enabled": True,
        },
    }


def _objective_card_grade(card: Card) -> str:
    """Return an identical, deterministic grade for every copy of a card."""
    from services.tcg_rarity import earned_card_pack_rarity

    rarity = earned_card_pack_rarity(card) or "C"
    return GRADE_TIER_BY_SCORE[GRADE_SCORE_BY_RARITY.get(rarity, 6)]


def _copy_grade(copy: TCGPhysicalCardCopy, card: Card) -> str | None:
    # Saved grades from the former copy-ID-based rubric are legacy payment
    # markers only; they are never authoritative for the card's objective grade.
    return _objective_card_grade(card) if copy.grade in GRADE_TIER_BY_SCORE.values() else None


def _grade_quote(db: Session, visit_id: int, copy_ids: list[int]) -> dict:
    visit = _active_visit(db, visit_id)
    unique_ids = list(dict.fromkeys(copy_ids or []))
    if not unique_ids:
        raise ValueError("Choose at least one card to grade")
    copies = _eligible_user_copies(db, unique_ids)
    profile = db.query(UserProfile).first()
    balance = int((profile.vault_credits or 0) if profile else 0)
    items = []
    for copy in copies:
        card = db.get(Card, copy.card_id)
        if not card:
            raise ValueError("A selected card no longer exists")
        metadata = _card_display_metadata(db, card)
        already_graded = copy.grade in GRADE_TIER_BY_SCORE.values()
        rarity_key = str(metadata["rarity"] or "C").upper()
        fee = 0 if already_graded else GRADING_FEE_CREDITS_BY_RARITY.get(rarity_key, 100)
        items.append({
            "copy_id": copy.id,
            "card_id": card.id,
            "catalog_code": metadata["catalog_code"],
            "name": metadata["name"],
            "display_name": metadata["display_name"],
            "display_title": metadata["display_title"],
            "rarity": metadata["rarity"],
            "grade": _objective_card_grade(card),
            "fee_credits": fee,
            "already_graded": already_graded,
            "is_graded": already_graded,
        })
    total_fee = sum(item["fee_credits"] for item in items)
    return {
        "visit_id": visit.id,
        "total_fee_credits": total_fee,
        "credits_balance": balance,
        "can_afford": balance >= total_fee,
        "items": items,
    }


def quote_grading(db: Session, visit_id: int, copy_ids: list[int]) -> dict:
    """Preview stable per-copy grades and rarity-based fees for the active trader visit."""
    return _grade_quote(db, visit_id, copy_ids)


def purchase_grading(db: Session, visit_id: int, copy_ids: list[int]) -> dict:
    """Charge Credits once and persist each deterministic grade on its physical copy."""
    quote = _grade_quote(db, visit_id, copy_ids)
    profile = db.query(UserProfile).first()
    try:
        for item in quote["items"]:
            copy = db.get(TCGPhysicalCardCopy, item["copy_id"])
            if not copy or copy.location_kind in {"trader_reserved", "traded_away"}:
                raise ValueError("A selected card copy became unavailable")
            if copy.grade in GRADE_TIER_BY_SCORE.values():
                item["fee_credits"] = 0
                item["already_graded"] = True
            # A legacy stored grade means the fee was paid, not that its old
            # random result remains authoritative. Persist the canonical grade.
            copy.grade = item["grade"]
            item["is_graded"] = True
        total_fee = sum(item["fee_credits"] for item in quote["items"])
        balance = int((profile.vault_credits or 0) if profile else 0)
        if total_fee and not profile:
            raise ValueError("Vault Credits wallet is unavailable")
        if balance < total_fee:
            raise ValueError(f"Grading costs {total_fee:,} Credits; you have {balance:,}.")
        if profile and total_fee:
            profile.vault_credits = balance - total_fee
        db.commit()
        quote["total_fee_credits"] = total_fee
        quote["credits_balance"] = balance - total_fee
        quote["can_afford"] = True
        return quote
    except Exception:
        db.rollback()
        raise


def _daily_focus_replies(name: str, focus: dict) -> dict[str, str]:
    likes = [str(value).strip() for value in focus.get("likes", []) if str(value).strip()]
    avoids = [str(value).strip() for value in focus.get("avoids", []) if str(value).strip()]
    liked = ", ".join(likes)
    avoided = ", ".join(avoids)
    if liked and avoided:
        intro = f"I'm {name}. Today I'm looking for {liked} and steering clear of {avoided}."
    elif liked:
        intro = f"I'm {name}. Today I'm looking for {liked}."
    elif avoided:
        intro = f"I'm {name}. Today I'm steering clear of {avoided}."
    else:
        intro = f"I'm {name}. I haven't picked a focus for today's cards yet."
    return {
        "intro": intro,
        "like": f"Today I'm especially looking for {liked}." if liked
                else "Nothing in particular is catching my eye today.",
        "dislike": f"Today I'm avoiding {avoided}." if avoided
                   else "Nothing in particular is on my avoid list today.",
    }


def dialogue(db: Session, visit_id: int, action: str | None = None) -> list[dict]:
    visit = db.get(TCGTraderVisit, visit_id)
    if not visit: raise ValueError("Trader visit not found")
    trader = db.get(TCGTraderDefinition, visit.trader_id)
    focus, focus_changed = _ensure_visit_focus(db, visit, trader)
    focus_replies = _daily_focus_replies(trader.name, focus)
    messages = _load(visit.conversation_json, [])
    changed = focus_changed
    for message in messages:
        if isinstance(message, dict) and isinstance(message.get("text"), str):
            # Keep already-saved conversations readable after the public name changes.
            renamed = message["text"].replace("Yoruichi", trader.name)
            if renamed != message["text"]:
                message["text"] = renamed
                changed = True
            action_key = message.get("action")
            if message.get("role") != "user" and isinstance(action_key, str) and action_key in focus_replies:
                updated = focus_replies[action_key]
                if message["text"] != updated:
                    message["text"] = updated
                    changed = True

    user_lines = {
        "browse": "Show me the cards you have today.",
        "sell": "Would you like to buy any of my cards?",
        "trade": "I’d like to trade for some of your cards.",
        "requests": "Could you look for this card for me?",
        "like": "What kinds of cards do you collect?",
        "dislike": "Are there any cards you prefer to avoid?",
        "counter": "Here’s my offer. What do you think?",
        "refuse": "I’ll pass on that offer.",
        "accepted": "Deal. I’ll take it.",
        "goodbye": "I’ll see you next time.",
    }

    latest_offer = None
    if action == "counter":
        latest_offer = db.query(TCGTraderOffer).filter_by(
            visit_id=visit.id, status="open",
        ).order_by(TCGTraderOffer.id.desc()).first()
    elif action == "accepted":
        latest_offer = db.query(TCGTraderOffer).filter_by(
            visit_id=visit.id, status="accepted",
        ).order_by(TCGTraderOffer.id.desc()).first()

    counter_reply = None
    if action == "counter" and latest_offer:
        if latest_offer.offer_kind == "sell":
            if latest_offer.credits_delta > 0:
                counter_reply = f"My offer for those cards is {latest_offer.credits_delta:,} Credits."
            elif latest_offer.shards_delta > 0:
                counter_reply = f"My offer for those cards is {latest_offer.shards_delta:,} Shards."
        elif latest_offer.offer_kind == "barter":
            snapshot = _load(latest_offer.valuation_json, {})
            payout_currency = snapshot.get("payout_currency") if isinstance(snapshot, dict) else None
            payout_amount = int(snapshot.get("payout_amount") or 0) if isinstance(snapshot, dict) else 0
            if payout_amount > 0 and payout_currency in {"credits", "shards"}:
                currency_label = "Credits" if payout_currency == "credits" else "Shards"
                counter_reply = (
                    "The cards you offered are worth more than the cards you picked, "
                    f"so I’ll return {payout_amount:,} {currency_label}."
                )
            else:
                counter_reply = "That trade meets my minimum. No extra payment is needed."
    elif action == "accepted" and latest_offer and latest_offer.offer_kind == "sell":
        user_lines["accepted"] = "Deal. I’ll take the payment."

    # Older visits stored only the trader's reply. Reconstruct the player's
    # utterance from its action so that their saved history reads like a chat.
    backfilled: list[Any] = []
    for message in messages:
        if not isinstance(message, dict):
            backfilled.append(message)
            continue
        line = user_lines.get(message.get("action"))
        if message.get("role") != "user" and line:
            has_matching_user_line = bool(
                backfilled
                and isinstance(backfilled[-1], dict)
                and backfilled[-1].get("role") == "user"
                and backfilled[-1].get("action") == message.get("action")
            )
            if not has_matching_user_line:
                backfilled.append({
                    "role": "user",
                    "action": message["action"],
                    "text": line,
                })
                changed = True
        backfilled.append(message)
    messages = backfilled
    if action:
        allowed = {"intro", "browse", "sell", "trade", "requests", "like", "dislike", "counter", "refuse", "accepted", "goodbye"}
        if action not in allowed: raise ValueError("Unknown dialogue action")
        if action == "intro" and any(message.get("action") == "intro" for message in messages if isinstance(message, dict)):
            if changed:
                visit.conversation_json = _dump(messages[-100:])
                db.commit()
            return messages
        manifest = _load(trader.dialogue_manifest_json, {})
        templates = manifest.get("templates", {}) if isinstance(manifest, dict) else {}
        template = templates.get(action)
        if counter_reply:
            text = counter_reply
        elif action == "accepted" and latest_offer and latest_offer.offer_kind == "sell":
            text = "Pleasure doing business."
        elif action in focus_replies:
            text = focus_replies[action]
        elif action == "sell":
            text = "You can offer any of your cards. I’ll tell you what I think they’re worth."
        else:
            if not isinstance(template, str):
                raise ValueError("Trader dialogue manifest is incomplete")
            text = template.format(
                name=trader.name,
                preferences=", ".join(_load(trader.preferences_json, [])),
                dislikes=", ".join(_load(trader.dislikes_json, [])),
                focus_likes=", ".join(focus.get("likes", [])),
                focus_avoids=", ".join(focus.get("avoids", [])),
            )
        if action in user_lines:
            messages.append({"role": "user", "action": action, "text": user_lines[action]})
        messages.append({"role": "trader", "action": action, "text": text})
        changed = True
    if changed:
        visit.conversation_json = _dump(messages[-100:])
        db.commit()
    return messages


def _eligible_user_copy(db: Session, copy_id: int, *, context: dict | None = None) -> TCGPhysicalCardCopy:
    copy = context["copies"].get(copy_id) if context is not None else db.get(TCGPhysicalCardCopy, copy_id)
    if not copy or copy.location_kind in {"trader_reserved", "traded_away"}:
        raise ValueError("Card copy is unavailable")
    if (copy.id in context["reserved"] if context is not None else db.query(TCGTraderReservation.id).filter_by(
        physical_copy_id=copy.id, status="active",
    ).first()):
        raise ValueError("Card copy is already reserved")
    if copy.location_kind not in {"unorganized_pile", "carried"}:
        active_locations = context["locations"] if context is not None else db.query(TCGTraderReservation.previous_location_json).filter(
            TCGTraderReservation.status == "active",
            TCGTraderReservation.physical_copy_id.isnot(None),
            TCGTraderReservation.physical_copy_id != copy.id,
        ).all()
        assignment = context["assignments"].get(copy.id) if context is not None else db.query(TCGDisplayAssignment).filter_by(physical_copy_id=copy.id).first()
        for (raw_location,) in active_locations:
            prior = _load(raw_location, {})
            prior_assignment = prior.get("display_assignment")
            same_display_slot = bool(
                assignment and prior_assignment
                and int(prior_assignment.get("display_instance_id", 0)) == assignment.display_instance_id
                and str(prior_assignment.get("slot_key") or "primary") == assignment.slot_key
            )
            same_physical_location = (
                prior.get("kind") == copy.location_kind
                and str(prior.get("ref")) == str(copy.location_ref)
                and prior.get("slot") == copy.location_slot
                and not (assignment and prior_assignment)
            )
            if same_physical_location or same_display_slot:
                raise ValueError("This physical location is being held by another open offer")
    if not (context["cards"].get(copy.card_id) if context is not None else db.get(Card, copy.card_id)):
        raise ValueError("Card copy has no matching card record")
    if copy.location_kind == "binder_slot":
        try:
            slot = (context["slots"].get(int(copy.location_ref)) if context is not None else db.get(TCGBinderSlot, int(copy.location_ref))) if copy.location_ref else None
        except (TypeError, ValueError):
            slot = None
        if not slot or slot.physical_copy_id != copy.id or slot.card_id != copy.card_id:
            raise ValueError("Card copy has an inconsistent binder location")
    elif copy.location_kind in {"unorganized_pile", "carried"}:
        if copy.location_ref is not None:
            raise ValueError("Card copy has an inconsistent location reference")
    elif copy.location_kind in {"cabinet_slot", "display_stand", "acrylic_case", "toploader", "set_box"}:
        if not copy.location_ref:
            raise ValueError("Card copy has an incomplete placed location")
        assignment = context["assignments"].get(copy.id) if context is not None else db.query(TCGDisplayAssignment).filter_by(physical_copy_id=copy.id).first()
        if assignment and str(assignment.display_instance_id) != str(copy.location_ref):
            raise ValueError("Card copy has an inconsistent display assignment")
        if copy.location_kind == "display_stand" and not assignment:
            raise ValueError("Card copy has no matching display assignment")
    else:
        raise ValueError("Card copy has an unsupported location")
    aggregate = context["owned"].get(copy.card_id, 0) if context is not None else db.query(func.sum(CardInventory.quantity)).filter_by(card_id=copy.card_id).scalar() or 0
    physical = context["counts"].get(copy.card_id, 0) if context is not None else db.query(func.count(TCGPhysicalCardCopy.id)).filter(
        TCGPhysicalCardCopy.card_id == copy.card_id,
        TCGPhysicalCardCopy.location_kind != "traded_away",
    ).scalar() or 0
    if aggregate <= 0 or aggregate != physical:
        raise ValueError("Owned card records are out of sync")
    return copy


def _eligible_user_copies(db: Session, copy_ids: list[int], *, allow_empty: bool = False) -> list[TCGPhysicalCardCopy]:
    unique_ids = list(dict.fromkeys(copy_ids))
    if not unique_ids:
        if allow_empty:
            return []
        raise ValueError("Choose at least one card copy")
    return [_eligible_user_copy(db, copy_id) for copy_id in unique_ids]


def _reserve_copy(db: Session, offer: TCGTraderOffer, copy: TCGPhysicalCardCopy) -> None:
    _eligible_user_copy(db, copy.id)
    if db.query(TCGTraderReservation.id).filter_by(physical_copy_id=copy.id, status="active").first():
        raise ValueError("Card copy is already reserved")
    previous = {"kind": copy.location_kind, "ref": copy.location_ref, "slot": copy.location_slot}
    if copy.location_kind == "binder_slot" and copy.location_ref:
        slot = db.get(TCGBinderSlot, int(copy.location_ref))
        if slot:
            previous["binder_slot"] = {
                "id": slot.id, "binder_id": slot.binder_id, "section_id": slot.section_id,
                "section_name": slot.section_name, "page_number": slot.page_number,
                "slot_number": slot.slot_number, "card_id": slot.card_id,
                "sleeve_style": slot.sleeve_style, "case_style": slot.case_style,
            }
    assignment = db.query(TCGDisplayAssignment).filter_by(physical_copy_id=copy.id).first()
    if assignment:
        previous["display_assignment"] = {
            "display_instance_id": assignment.display_instance_id,
            "slot_key": assignment.slot_key,
        }
    move_copy(db, copy.id, "trader_reserved", location_ref=str(offer.id), allow_trade_locked=True)
    db.add(TCGTraderReservation(offer_id=offer.id, physical_copy_id=copy.id, previous_location_json=_dump(previous)))


def create_sell_offer(db: Session, visit_id: int, copy_ids: list[int], currency: str) -> dict:
    if currency not in {"credits", "shards"} or not copy_ids: raise ValueError("Choose copies and a payout currency")
    visit = _active_visit(db, visit_id); trader = db.get(TCGTraderDefinition, visit.trader_id)
    if not visit: raise ValueError("Trader visit is unavailable")
    if currency == "credits" and not db.query(UserProfile.id).first(): raise ValueError("Vault Credits wallet is unavailable")
    if currency == "shards" and not db.query(CraftingMaterials.id).first(): raise ValueError("Shards wallet is unavailable")
    copies = _eligible_user_copies(db, copy_ids)
    quote_seed = _seed(visit.visit_seed, "sell", ",".join(map(str, sorted(copy_ids))), currency)
    if db.query(TCGTraderOffer.id).filter_by(offer_seed=quote_seed).first():
        raise ValueError("You've already made this offer during her visit")
    focus = _visit_focus(db, visit, trader)
    card_by_id: dict[int, Card] = {}
    for copy in copies:
        card = card_by_id.get(copy.card_id)
        if card is None:
            card = db.get(Card, copy.card_id)
        if not card:
            raise ValueError("A selected card no longer exists")
        card_by_id[copy.card_id] = card
    quotes = []
    for copy in copies:
        card = card_by_id[copy.card_id]
        grade = _copy_grade(copy, card)
        quotes.append({"copy_id": copy.id, "grade": grade,
                       **valuation(db, card, trader, purpose="sell", seed=quote_seed,
                                   focus=focus, grade=grade)})
    units = sum(item["units"] for item in quotes) * (0.72 - trader.greed * .22)
    credits, shards = (max(1, round(units * 10)), 0) if currency == "credits" else (0, max(1, round(units * 2.5)))
    offer = TCGTraderOffer(visit_id=visit.id, offer_seed=quote_seed, offer_kind="sell", user_copy_ids_json=_dump([c.id for c in copies]),
                           credits_delta=credits, shards_delta=shards, valuation_json=_dump(quotes))
    try:
        db.add(offer); db.flush()
        for copy in copies: _reserve_copy(db, offer, copy)
        db.commit()
        return offer_dict(offer)
    except Exception:
        db.rollback()
        raise


def create_buy_offer(db: Session, visit_id: int, inventory_id: int, currency: str) -> dict:
    if currency not in {"credits", "shards"}: raise ValueError("Choose a payment currency")
    visit = _active_visit(db, visit_id); stock = db.get(TCGTraderInventory, inventory_id)
    if not visit or not stock or stock.visit_id != visit.id: raise ValueError("Trader stock is unavailable")
    _assert_transferable_card(db, stock.card_id, allow_spr=_spr_enabled(db))
    if stock.quantity - stock.reserved_quantity < 1: raise ValueError("Trader stock is reserved")
    seed = _seed(visit.visit_seed, "buy", inventory_id, currency)
    if db.query(TCGTraderOffer.id).filter_by(offer_seed=seed).first():
        raise ValueError("You've already asked to buy this card during her visit")
    cost = stock.unit_credits if currency == "credits" else stock.unit_shards
    offer = TCGTraderOffer(visit_id=visit.id, offer_seed=seed, offer_kind="buy", trader_inventory_id=stock.id,
                           target_card_id=stock.card_id, credits_delta=-cost if currency == "credits" else 0,
                           shards_delta=-cost if currency == "shards" else 0, valuation_json=stock.valuation_json)
    try:
        db.add(offer); db.flush(); stock.reserved_quantity += 1
        db.add(TCGTraderReservation(offer_id=offer.id, inventory_id=stock.id)); db.commit()
        return offer_dict(offer)
    except Exception:
        db.rollback()
        raise


def create_barter_offer(db: Session, visit_id: int, inventory_ids: int | list[int], copy_ids: list[int], credits: int = 0, shards: int = 0) -> dict:
    pricing = _barter_pricing(db, visit_id, inventory_ids, copy_ids, credits, shards)
    visit = pricing["visit"]
    stocks = pricing["stocks"]
    copies = pricing["copies"]
    target_ids = pricing["target_inventory_ids"]
    target_card_ids = pricing["target_card_ids"]
    if not pricing["meets_minimum"]:
        shortfall = pricing["shortfall_units"]
        credits_needed = max(1, math.ceil(shortfall * 10))
        shards_needed = max(1, math.ceil(shortfall * 2.5))
        raise ValueError(
            f"Your offer is short by {shortfall:.1f} value units. Add about {credits_needed} Credits "
            f"or {shards_needed} Shards, or include more cards."
        )
    offer_seed = _seed(
        visit.visit_seed, "barter", ",".join(map(str, sorted(target_ids))),
        ",".join(map(str, sorted(copy.id for copy in copies))), credits, shards,
    )
    if db.query(TCGTraderOffer.id).filter_by(offer_seed=offer_seed).first():
        raise ValueError("You've already made this exact trade offer during her visit")
    target_snapshots = [{
        "inventory_id": stock.id,
        "card_id": stock.card_id,
        "value_units": _stock_value_units(stock),
        "required_value_units": _barter_minimum_units(stock, pricing["trader"]),
        "valuation": _load(stock.valuation_json, {}),
    } for stock in stocks]
    offer = TCGTraderOffer(visit_id=visit.id, offer_seed=offer_seed, offer_kind="barter", trader_inventory_id=stocks[0].id,
                           target_card_id=stocks[0].card_id, user_copy_ids_json=_dump([c.id for c in copies]),
                           credits_delta=(pricing["payout_amount"] if pricing["payout_currency"] == "credits" else 0) - credits,
                           shards_delta=(pricing["payout_amount"] if pricing["payout_currency"] == "shards" else 0) - shards,
                           valuation_json=_dump({
                               "target": target_snapshots[0]["valuation"],
                               "targets": target_snapshots,
                               "target_inventory_ids": target_ids,
                               "target_card_ids": target_card_ids,
                               "user_card_value_units": pricing["user_card_value_units"],
                               "barter_minimum_units": pricing["required_value_units"],
                               "required_value_units": pricing["required_value_units"],
                               "offered_units": pricing["offer_value_units"],
                               "shortfall_units": pricing["shortfall_units"],
                               "surplus_units": pricing["surplus_units"],
                               "credits_offered": pricing["credits_offered"],
                               "shards_offered": pricing["shards_offered"],
                               "payout_currency": pricing["payout_currency"],
                               "payout_amount": pricing["payout_amount"],
                               "payout_value_units": pricing["payout_value_units"],
                               "surplus_return_share": pricing["surplus_return_share"],
                           }))
    try:
        db.add(offer); db.flush()
        for stock in stocks:
            stock.reserved_quantity += 1
            db.add(TCGTraderReservation(offer_id=offer.id, inventory_id=stock.id))
        for copy in copies: _reserve_copy(db, offer, copy)
        db.commit()
        return offer_dict(offer)
    except Exception:
        db.rollback()
        raise


def request_card(db: Session, visit_id: int, card_id: int | str) -> dict:
    visit = _active_visit(db, visit_id); trader = db.get(TCGTraderDefinition, visit.trader_id)
    card = _resolve_card_reference(db, card_id)
    catalog_code = _card_catalog_identifier(db, card)
    prior = db.query(TCGTraderRequest).filter_by(visit_id=visit_id, card_id=card.id).first()
    if prior:
        return {"id": prior.id, "card_id": card.id, "catalog_code": catalog_code,
                "status": prior.status, "result": _load(prior.result_json, {}),
                "requests_remaining": max(0, visit.request_allowance - visit.requests_used)}
    if visit.requests_used >= visit.request_allowance: raise ValueError("You've used all of today's requests")
    eligible = False
    try:
        card = _assert_transferable_card(db, card.id, allow_spr=_spr_enabled(db))
        eligible = True
    except ValueError:
        pass
    index = visit.requests_used; request_seed = _seed(visit.visit_seed, "request", index, card.id)
    visit.requests_used += 1
    chance_pct = round(REQUEST_FULFILLMENT_CHANCE * 100) if eligible else 0
    request = TCGTraderRequest(visit_id=visit.id, card_id=card.id, request_index=index, seed=request_seed,
                               status="pending" if eligible else "refused", result_json="{}")
    db.add(request); db.flush()
    request.result_json = _dump({
        "next_appearance": bool(eligible),
        "request_chance_pct": chance_pct,
        "catalog_code": catalog_code,
        **({} if eligible else {"reason": "That card isn't available to trade."}),
    })
    db.commit(); return {"id": request.id, "card_id": card.id, "catalog_code": catalog_code,
                         "status": request.status, "result": _load(request.result_json, {}),
                         "requests_remaining": visit.request_allowance - visit.requests_used}


def offer_dict(row: TCGTraderOffer) -> dict:
    valuation_snapshot = _load(row.valuation_json, {})
    payout_snapshot = valuation_snapshot if isinstance(valuation_snapshot, dict) else {}
    target_card_ids = (
        valuation_snapshot.get("target_card_ids")
        if isinstance(valuation_snapshot, dict) else None
    )
    if not isinstance(target_card_ids, list) or not target_card_ids:
        target_card_ids = [row.target_card_id] if row.target_card_id is not None else []
    return {"id": row.id, "visit_id": row.visit_id, "kind": row.offer_kind, "status": row.status,
            "user_copy_ids": _load(row.user_copy_ids_json, []), "target_card_id": row.target_card_id,
            "target_card_ids": target_card_ids,
            "surplus_units": payout_snapshot.get("surplus_units"),
            "payout_currency": payout_snapshot.get("payout_currency"),
            "payout_amount": int(payout_snapshot.get("payout_amount") or 0),
            "payout_value_units": payout_snapshot.get("payout_value_units"),
            "credits_delta": row.credits_delta, "shards_delta": row.shards_delta,
            "valuation": valuation_snapshot}


def list_offers(db: Session, visit_id: int) -> list[dict]:
    return [offer_dict(row) for row in db.query(TCGTraderOffer).filter_by(visit_id=visit_id).order_by(TCGTraderOffer.id).all()]


def list_requests(db: Session, visit_id: int) -> list[dict]:
    visit = db.get(TCGTraderVisit, visit_id)
    if not visit:
        raise ValueError("Trader visit not found")
    same_trader = db.query(TCGTraderRequest).join(
        TCGTraderVisit, TCGTraderRequest.visit_id == TCGTraderVisit.id,
    ).filter(TCGTraderVisit.trader_id == visit.trader_id)
    recent = same_trader.order_by(TCGTraderRequest.created_at.desc(), TCGTraderRequest.id.desc()).limit(25).all()
    pending = same_trader.filter(TCGTraderRequest.status == "pending").all()
    rows = {row.id: row for row in [*recent, *pending]}
    return [{"id": row.id, "card_id": row.card_id,
             "catalog_code": (_card_catalog_identifier(db, card) if (card := db.get(Card, row.card_id)) else None),
             "status": row.status,
             "result": _load(row.result_json, {})}
            for row in sorted(rows.values(), key=lambda item: (item.created_at, item.id))]


def _restore_reservation(db: Session, reservation: TCGTraderReservation) -> None:
    if reservation.physical_copy_id:
        copy = db.get(TCGPhysicalCardCopy, reservation.physical_copy_id)
        previous = _load(reservation.previous_location_json, {})
        if copy and copy.location_kind == "trader_reserved":
            kind = previous.get("kind", "unorganized_pile")
            ref = previous.get("ref")
            slot_number = previous.get("slot")
            binder_snapshot = previous.get("binder_slot")
            binder_slot = None
            if kind == "binder_slot" and not binder_snapshot and ref:
                try:
                    binder_slot = db.get(TCGBinderSlot, int(ref))
                except (TypeError, ValueError):
                    binder_slot = None
                if binder_slot:
                    binder_snapshot = {
                        "id": binder_slot.id, "binder_id": binder_slot.binder_id,
                        "section_id": binder_slot.section_id, "section_name": binder_slot.section_name,
                        "page_number": binder_slot.page_number, "slot_number": binder_slot.slot_number,
                        "card_id": binder_slot.card_id, "sleeve_style": binder_slot.sleeve_style,
                        "case_style": binder_slot.case_style,
                    }
            if kind == "binder_slot" and binder_snapshot:
                binder_slot = db.get(TCGBinderSlot, int(binder_snapshot.get("id") or 0))
                if binder_slot is None:
                    binder_slot = db.query(TCGBinderSlot).filter_by(
                        binder_id=binder_snapshot.get("binder_id"),
                        section_name=binder_snapshot.get("section_name") or "Main",
                        page_number=binder_snapshot.get("page_number"),
                        slot_number=binder_snapshot.get("slot_number"),
                    ).first()
                if binder_slot is None and db.get(TCGBinder, binder_snapshot.get("binder_id")):
                    binder_slot = TCGBinderSlot(
                        id=binder_snapshot.get("id"),
                        binder_id=binder_snapshot["binder_id"],
                        section_id=None,
                        section_name=binder_snapshot.get("section_name") or "Main",
                        page_number=binder_snapshot["page_number"],
                        slot_number=binder_snapshot["slot_number"],
                        card_id=None, physical_copy_id=None,
                        sleeve_style=binder_snapshot.get("sleeve_style"),
                        case_style=binder_snapshot.get("case_style"),
                    )
                    db.add(binder_slot)
                    db.flush()
                if binder_slot:
                    ref = binder_slot.id
                    slot_number = binder_slot.slot_number
                    if binder_slot.physical_copy_id not in (None, copy.id):
                        occupant = db.get(TCGPhysicalCardCopy, binder_slot.physical_copy_id)
                        if occupant and db.query(TCGTraderReservation.id).filter_by(
                            physical_copy_id=occupant.id, status="active",
                        ).first():
                            raise ValueError("The saved binder slot is occupied by another active offer")
                        if occupant and occupant.location_kind == "binder_slot":
                            move_copy(db, occupant.id, "unorganized_pile", allow_trade_locked=True)
                        else:
                            binder_slot.physical_copy_id = None
                            binder_slot.card_id = None
            if kind == "binder_slot" and not binder_slot:
                # The binder or pocket may have been deleted while an offer was
                # open; keep the copy owned and safe when its old pocket cannot
                # be reconstructed.
                kind, ref, slot_number = "unorganized_pile", None, None

            display_snapshot = previous.get("display_assignment")
            if not display_snapshot and kind == "display_stand" and ref:
                # Older reservations recorded the stand reference but not its
                # slot key; the original display action defaults to "primary".
                display_snapshot = {"display_instance_id": int(ref), "slot_key": "primary"}
            if display_snapshot and not db.get(
                TCGDisplayItemInstance, int(display_snapshot["display_instance_id"]),
            ):
                display_snapshot = None
                kind, ref, slot_number = "unorganized_pile", None, None
            if display_snapshot:
                display_id = int(display_snapshot["display_instance_id"])
                slot_key = str(display_snapshot.get("slot_key") or "primary")
                existing = db.query(TCGDisplayAssignment).filter_by(
                    display_instance_id=display_id, slot_key=slot_key,
                ).first()
                if existing and existing.physical_copy_id != copy.id:
                    occupant = db.get(TCGPhysicalCardCopy, existing.physical_copy_id)
                    if occupant and db.query(TCGTraderReservation.id).filter_by(
                        physical_copy_id=occupant.id, status="active",
                    ).first():
                        raise ValueError("The saved display slot is occupied by another active offer")
                    if occupant and occupant.location_kind not in {"traded_away", "trader_reserved"}:
                        move_copy(db, occupant.id, "unorganized_pile", allow_trade_locked=True)
                    else:
                        db.delete(existing)
            move_copy(
                db, copy.id, kind, location_ref=ref, location_slot=slot_number,
                allow_trade_locked=True,
            )
            if display_snapshot:
                existing_copy_assignment = db.query(TCGDisplayAssignment).filter_by(
                    physical_copy_id=copy.id,
                ).first()
                if not existing_copy_assignment:
                    db.add(TCGDisplayAssignment(
                        display_instance_id=int(display_snapshot["display_instance_id"]),
                        physical_copy_id=copy.id,
                        slot_key=str(display_snapshot.get("slot_key") or "primary"),
                    ))
    elif reservation.inventory_id:
        stock = db.get(TCGTraderInventory, reservation.inventory_id)
        if stock: stock.reserved_quantity = max(0, stock.reserved_quantity - 1)
    reservation.status = "released"


def _consume_reserved_user_copy(db: Session, offer: TCGTraderOffer,
                                reservation: TCGTraderReservation,
                                copy: TCGPhysicalCardCopy) -> None:
    if (copy.location_kind != "trader_reserved" or copy.location_ref != str(offer.id)
            or reservation.physical_copy_id != copy.id):
        raise ValueError("Reserved card copy is invalid")
    card_id = copy.card_id
    inventory_rows = db.query(CardInventory).filter_by(card_id=card_id).order_by(CardInventory.id).all()
    owned = sum(max(0, int(row.quantity or 0)) for row in inventory_rows)
    physical = db.query(func.count(TCGPhysicalCardCopy.id)).filter(
        TCGPhysicalCardCopy.card_id == card_id,
        TCGPhysicalCardCopy.location_kind != "traded_away",
    ).scalar() or 0
    if owned <= 0 or owned != physical:
        raise ValueError("Owned card records are out of sync")
    inventory = next((row for row in inventory_rows if (row.quantity or 0) > 0), None)
    if not inventory:
        raise ValueError("Owned card inventory is unavailable")
    move_copy(db, copy.id, "traded_away", allow_trade_locked=True)
    inventory.quantity -= 1
    if inventory.quantity <= 0:
        db.delete(inventory)
    db.flush()


def refuse_offer(db: Session, offer_id: int) -> dict:
    offer = db.get(TCGTraderOffer, offer_id)
    if not offer or offer.status != "open": raise ValueError("Offer is no longer open")
    for row in db.query(TCGTraderReservation).filter_by(offer_id=offer.id, status="active").all(): _restore_reservation(db, row)
    offer.status = "refused"; offer.resolved_at = datetime.now(); db.commit(); return offer_dict(offer)


def _validate_reservation_shape(offer: TCGTraderOffer, reservations: list[TCGTraderReservation]) -> None:
    physical_ids = sorted(row.physical_copy_id for row in reservations if row.physical_copy_id is not None)
    inventory_ids = sorted(row.inventory_id for row in reservations if row.inventory_id is not None)
    expected_copies = sorted(_load(offer.user_copy_ids_json, []))
    valuation_snapshot = _load(offer.valuation_json, {})
    target_snapshots = valuation_snapshot.get("targets") if isinstance(valuation_snapshot, dict) else None
    if isinstance(target_snapshots, list) and target_snapshots:
        expected_inventory_ids = sorted(
            int(target["inventory_id"]) for target in target_snapshots
            if isinstance(target, dict) and target.get("inventory_id") is not None
        )
    else:
        expected_inventory_ids = [offer.trader_inventory_id] if offer.trader_inventory_id is not None else []
    barter_snapshot = valuation_snapshot if isinstance(valuation_snapshot, dict) else {}
    has_surplus_snapshot = offer.offer_kind == "barter" and any(
        key in barter_snapshot for key in (
            "credits_offered", "shards_offered", "payout_currency", "payout_amount",
        )
    )
    barter_snapshot_valid = True
    if has_surplus_snapshot:
        try:
            credits_offered = barter_snapshot["credits_offered"]
            shards_offered = barter_snapshot["shards_offered"]
            payout_currency = barter_snapshot["payout_currency"]
            payout_amount = barter_snapshot["payout_amount"]
            payout_value_units = float(barter_snapshot["payout_value_units"])
            surplus_units = float(barter_snapshot["surplus_units"])
            barter_snapshot_valid = (
                isinstance(credits_offered, int) and not isinstance(credits_offered, bool) and credits_offered >= 0
                and isinstance(shards_offered, int) and not isinstance(shards_offered, bool) and shards_offered >= 0
                and payout_currency in {None, "credits", "shards"}
                and isinstance(payout_amount, int) and not isinstance(payout_amount, bool) and payout_amount >= 0
                and payout_value_units >= 0 and surplus_units >= 0
                and payout_value_units <= surplus_units + 0.001
                and ((payout_amount == 0 and payout_currency is None and payout_value_units == 0)
                     or (payout_amount > 0 and payout_currency in {"credits", "shards"}))
                and offer.credits_delta == (payout_amount if payout_currency == "credits" else 0) - credits_offered
                and offer.shards_delta == (payout_amount if payout_currency == "shards" else 0) - shards_offered
            )
        except (KeyError, TypeError, ValueError):
            barter_snapshot_valid = False
        barter_has_payment = bool(
            isinstance(barter_snapshot.get("credits_offered"), int) and barter_snapshot.get("credits_offered") > 0
            or isinstance(barter_snapshot.get("shards_offered"), int) and barter_snapshot.get("shards_offered") > 0
        )
    else:
        barter_has_payment = offer.credits_delta < 0 or offer.shards_delta < 0
    valid = {
        "sell": physical_ids == expected_copies and bool(physical_ids) and not inventory_ids
                and offer.target_card_id is None and offer.credits_delta >= 0 and offer.shards_delta >= 0,
        "buy": not physical_ids and inventory_ids == expected_inventory_ids and len(inventory_ids) == 1
               and offer.target_card_id is not None and offer.credits_delta <= 0 and offer.shards_delta <= 0,
        "barter": physical_ids == expected_copies and (bool(physical_ids) or barter_has_payment)
                  and inventory_ids == expected_inventory_ids and bool(inventory_ids)
                  and offer.target_card_id is not None
                  and barter_snapshot_valid
                  and (has_surplus_snapshot or (offer.credits_delta <= 0 and offer.shards_delta <= 0)),
        "request": not physical_ids and not inventory_ids and offer.target_card_id is not None
                   and offer.credits_delta <= 0 and offer.shards_delta <= 0,
    }.get(offer.offer_kind, False)
    if not valid:
        raise ValueError("Offer reservation ledger is incomplete or invalid")


def accept_offer(db: Session, offer_id: int) -> dict:
    offer = db.get(TCGTraderOffer, offer_id)
    if not offer or offer.status != "open": raise ValueError("Offer is unavailable")
    _active_visit(db, offer.visit_id)
    profile = db.query(UserProfile).first(); materials = db.query(CraftingMaterials).first()
    if offer.credits_delta < 0 and (not profile or (profile.vault_credits or 0) < -offer.credits_delta): raise ValueError("Insufficient Vault Credits")
    if offer.shards_delta < 0 and (not materials or (materials.shards or 0) < -offer.shards_delta): raise ValueError("Insufficient Shards")
    if offer.credits_delta > 0 and not profile: raise ValueError("Vault Credits wallet is unavailable")
    if offer.shards_delta > 0 and not materials: raise ValueError("Shards wallet is unavailable")
    reservations = db.query(TCGTraderReservation).filter_by(offer_id=offer.id, status="active").all()
    _validate_reservation_shape(offer, reservations)
    allow_spr = _spr_enabled(db)
    frozen_valuation = _load(offer.valuation_json, {})
    target_snapshots = frozen_valuation.get("targets") if isinstance(frozen_valuation, dict) else None
    if isinstance(target_snapshots, list) and target_snapshots:
        expected_target_cards = {
            int(target["inventory_id"]): int(target["card_id"])
            for target in target_snapshots
            if isinstance(target, dict) and target.get("inventory_id") is not None and target.get("card_id") is not None
        }
    elif offer.trader_inventory_id is not None and offer.target_card_id is not None:
        expected_target_cards = {offer.trader_inventory_id: offer.target_card_id}
    else:
        expected_target_cards = {}
    ledger_snapshot = {
        "offer": offer_dict(offer),
        "frozen_valuation": frozen_valuation,
        "wallet_before": {
            "credits": (profile.vault_credits or 0) if profile else None,
            "shards": (materials.shards or 0) if materials else None,
        },
    }
    tx = TCGTraderTransaction(visit_id=offer.visit_id, offer_id=offer.id, transaction_kind=offer.offer_kind,
                              credits_delta=offer.credits_delta, shards_delta=offer.shards_delta,
                              valuation_json=_dump(ledger_snapshot))
    delivered_card_ids: set[int] = set()
    try:
        db.add(tx); db.flush()
        for reservation in reservations:
            if reservation.physical_copy_id:
                copy = db.get(TCGPhysicalCardCopy, reservation.physical_copy_id)
                if not copy:
                    raise ValueError("Reserved card copy is invalid")
                card_id = copy.card_id
                _consume_reserved_user_copy(db, offer, reservation, copy)
                db.add(TCGTraderTransactionLine(transaction_id=tx.id, direction="to_trader", card_id=card_id,
                                                physical_copy_id=copy.id, snapshot_json=reservation.previous_location_json))
            elif reservation.inventory_id:
                stock = db.get(TCGTraderInventory, reservation.inventory_id)
                expected_card_id = expected_target_cards.get(reservation.inventory_id)
                if (not stock or stock.visit_id != offer.visit_id or expected_card_id is None
                        or stock.card_id != expected_card_id or stock.quantity < 1 or stock.reserved_quantity < 1):
                    raise ValueError("Reserved stock is invalid")
                _assert_transferable_card(db, stock.card_id, allow_spr=allow_spr)
                stock.quantity -= 1; stock.reserved_quantity -= 1
                card_id = stock.card_id
                acquisition = CardAcquisition(card_id=card_id, quantity=1, acquired_at=datetime.now(), source_type="trader", source_id=str(offer.visit_id))
                db.add(acquisition); db.flush(); copy = grant_card_copy(db, card_id, acquisition_id=acquisition.id, acquired_at=acquisition.acquired_at)
                delivered_card_ids.add(card_id)
                db.add(TCGTraderTransactionLine(transaction_id=tx.id, direction="to_user", card_id=card_id,
                                                physical_copy_id=copy.id, snapshot_json=stock.valuation_json))
            reservation.status = "consumed"
        if offer.offer_kind == "request" and offer.target_card_id:
            _assert_transferable_card(db, offer.target_card_id, allow_spr=allow_spr)
            acquisition = CardAcquisition(card_id=offer.target_card_id, quantity=1, acquired_at=datetime.now(), source_type="trader_request", source_id=str(offer.visit_id))
            db.add(acquisition); db.flush(); copy = grant_card_copy(db, offer.target_card_id, acquisition_id=acquisition.id, acquired_at=acquisition.acquired_at)
            delivered_card_ids.add(offer.target_card_id)
            db.add(TCGTraderTransactionLine(transaction_id=tx.id, direction="to_user", card_id=offer.target_card_id, physical_copy_id=copy.id, snapshot_json=offer.valuation_json))
        if delivered_card_ids:
            # Match booster reveal preparation so trader-acquired cards use the
            # canonical face, packed mask, and foil-map path before commit.
            from services.cards import prepare_card_face_for_reveal
            for card_id in sorted(delivered_card_ids):
                card = db.get(Card, card_id)
                if not card:
                    raise ValueError(f"Card {card_id} disappeared before reveal")
                prepare_card_face_for_reveal(db, card)
        if profile: profile.vault_credits = (profile.vault_credits or 0) + offer.credits_delta
        if materials: materials.shards = (materials.shards or 0) + offer.shards_delta
        ledger_snapshot["wallet_after"] = {
            "credits": (profile.vault_credits or 0) if profile else None,
            "shards": (materials.shards or 0) if materials else None,
        }
        tx.valuation_json = _dump(ledger_snapshot)
        offer.status = "accepted"; offer.resolved_at = datetime.now(); db.commit()
        return {"transaction_id": tx.id, "offer": offer_dict(offer)}
    except Exception:
        db.rollback(); raise


def transaction_history(db: Session, limit: int = 100) -> list[dict]:
    result = []
    for row in db.query(TCGTraderTransaction).order_by(TCGTraderTransaction.id.desc()).limit(min(200, max(1, limit))).all():
        lines = db.query(TCGTraderTransactionLine).filter_by(transaction_id=row.id).order_by(TCGTraderTransactionLine.id).all()
        result.append({"id": row.id, "visit_id": row.visit_id, "offer_id": row.offer_id, "kind": row.transaction_kind,
                       "credits_delta": row.credits_delta, "shards_delta": row.shards_delta,
                       "ledger": _load(row.valuation_json, {}), "completed_at": row.completed_at,
                       "lines": [{"direction": line.direction, "card_id": line.card_id,
                                  "physical_copy_id": line.physical_copy_id, "quantity": line.quantity,
                                  "snapshot": _load(line.snapshot_json, {})} for line in lines]})
    return result


def valuation_audit(db: Session, visit_id: int, card_id: int, purpose: str = "audit") -> dict:
    visit = _active_visit(db, visit_id)
    card = db.get(Card, card_id)
    if not card:
        raise ValueError("Card not found")
    trader = db.get(TCGTraderDefinition, visit.trader_id)
    return valuation(db, card, trader, purpose=purpose, seed=visit.visit_seed,
                     focus=_visit_focus(db, visit, trader))


def save_simulation_report(db: Session, values: dict) -> dict:
    version = str(values["version"])
    row = db.query(TCGTraderSimulationReport).filter_by(version=version).first()
    if row and row.approved:
        raise ValueError("An approved simulation report is immutable")
    if not row:
        row = TCGTraderSimulationReport(version=version, approved=False)
        db.add(row)
    row.weeks_simulated = int(values.get("weeks_simulated", 0))
    row.seed = str(values.get("seed") or "")
    row.report_json = _dump(values.get("report") or {})
    db.commit()
    return {"id": row.id, "approved": False, "weeks_simulated": row.weeks_simulated}


def approve_simulation_report(db: Session, report_id: int) -> dict:
    row = db.get(TCGTraderSimulationReport, report_id)
    required = {"supply_by_rarity", "spr_leakage", "refusal_rate", "offers_per_week", "average_cards_surrendered",
                "credits_created_removed", "shards_created_removed", "duplicate_depletion", "completion_acceleration", "trader_advantage", "exploit_loops"}
    if not row or row.weeks_simulated < 100000 or not required.issubset(_load(row.report_json, {})):
        raise ValueError("A complete simulation of at least 100,000 visitor weeks is required")
    row.approved = True; row.approved_at = datetime.now(); db.commit()
    return {"id": row.id, "approved": True, "weeks_simulated": row.weeks_simulated}


def list_simulation_reports(db: Session) -> list[dict]:
    return [{"id": row.id, "version": row.version, "weeks_simulated": row.weeks_simulated,
             "approved": row.approved, "report": _load(row.report_json, {})}
            for row in db.query(TCGTraderSimulationReport).order_by(TCGTraderSimulationReport.id.desc()).all()]

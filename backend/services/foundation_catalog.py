"""Build and acquire the finite TCG V2 Foundation catalogue.

The Foundation catalogue is publication, not ownership: definitions are frozen
once, then booster pulls add inventory for those definitions.  Reopening a pack
never silently creates a second printing for the same source.
"""

from __future__ import annotations

import hashlib
import json
import os
import random
from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import (
    Card, CardInventory, CardRarity, CardType, Creator, Gallery,
    Image, TCGChecklistEntry, TCGRelease, TCGSettings, TCGSetupState,
)
from services.personal_value import apply_rarity_floor, build_personal_value_context, evaluate_personal_value
from services.tcg_rarity import earned_card_pack_rarity


FOUNDATION_CODE = "FND-001"
FOUNDATION_LARGE_LIBRARY_TARGET = 60_000
FOUNDATION_SEED = "the-vault-foundation-v1"
FOUNDATION_FAMILY_TARGETS = {
    "gallery": 9_000,
    "creator": 6_000,
    "character": 6_000,
    "cosplay": 6_000,
}
FOUNDATION_REAL_CREATOR_TYPES = ("cosplayer", "ethot", "artist", "actress")
PRINT_RARITIES = ("C", "R", "SR", "UR", "SPR")
FOUNDATION_ALGORITHM_VERSION = "foundation-v3-multi-family"
FOUNDATION_SPR_UNLOCK_CUM = 6

# The approved September release is the calibration point for the permanent
# catalogue too: 300/140/110/70 base cards plus 40 additive SPRs per 620 base
# cards.  Largest-remainder rounding keeps every finite catalogue exact.
FOUNDATION_BASE_RARITY_RATIOS = {"C": 300 / 620, "R": 140 / 620, "SR": 110 / 620, "UR": 70 / 620}
FOUNDATION_SPR_RATIO = 40 / 620


def _hash_int(*parts) -> int:
    raw = "|".join(str(part) for part in (FOUNDATION_SEED, *parts)).encode("utf-8")
    return int.from_bytes(hashlib.blake2b(raw, digest_size=8).digest(), "big")


def _round_robin_sources(groups: dict[int, list], target: int, family: str) -> list:
    """Select stable, evenly distributed sources without exceeding real supply."""
    if target <= 0:
        return []
    ordered_ids = sorted(groups, key=lambda value: _hash_int(family, value, "group"))
    for identity in ordered_ids:
        groups[identity] = sorted(
            groups[identity],
            key=lambda item: _hash_int(
                family, identity,
                getattr(item[-1], "id", item[-1]) if isinstance(item, tuple) else getattr(item, "id", item),
                "source",
            ),
        )
    selected = []
    offset = 0
    while len(selected) < target:
        added = False
        for identity in ordered_ids:
            if offset < len(groups[identity]):
                selected.append(groups[identity][offset])
                added = True
                if len(selected) >= target:
                    break
        if not added:
            break
        offset += 1
    return selected


def _portrait_groups(db: Session, people: list[Creator], *, character: bool) -> dict[int, list[Image]]:
    """Return existing full-resolution stills explicitly linked to each profile."""
    from sqlalchemy import or_, select
    from models import gallery_creators, image_creators

    groups: dict[int, list[Image]] = {int(person.id): [] for person in people}
    if not groups:
        return groups
    linked_gallery_ids = select(gallery_creators.c.gallery_id).where(
        gallery_creators.c.creator_id.in_(list(groups))
    )
    directly_linked_ids = select(image_creators.c.image_id).where(
        image_creators.c.creator_id.in_(list(groups))
    )
    legacy_creator_gallery_ids = select(Gallery.id).where(
        Gallery.creator_id.in_(list(groups))
    )
    if character:
        legacy_creator_gallery_ids = select(Gallery.id).where(or_(
            Gallery.creator_id.in_(list(groups)),
            Gallery.linked_character_id.in_(list(groups)),
        ))
    rows = db.query(Image).filter(
        Image.is_video.is_(False),
        Image.file_path.isnot(None), Image.width.isnot(None), Image.height.isnot(None),
        or_(
            Image.id.in_(directly_linked_ids),
            Image.gallery_id.in_(linked_gallery_ids),
            Image.gallery_id.in_(legacy_creator_gallery_ids),
        ),
    ).order_by(Image.id.asc()).all()
    people_by_id = {int(person.id): person for person in people}
    direct_links: dict[int, set[int]] = {}
    for image_id, person_id in db.query(image_creators.c.image_id, image_creators.c.creator_id).filter(
        image_creators.c.creator_id.in_(list(groups))
    ).all():
        direct_links.setdefault(int(image_id), set()).add(int(person_id))
    group_links: dict[int, set[int]] = {}
    for gallery_id, person_id in db.query(gallery_creators.c.gallery_id, gallery_creators.c.creator_id).filter(
        gallery_creators.c.creator_id.in_(list(groups))
    ).all():
        group_links.setdefault(int(gallery_id), set()).add(int(person_id))
    legacy_links: dict[int, set[int]] = {}
    for gallery_id, creator_id, character_id in db.query(
        Gallery.id, Gallery.creator_id, Gallery.linked_character_id
    ).filter(or_(Gallery.creator_id.in_(list(groups)), Gallery.linked_character_id.in_(list(groups)))).all():
        if creator_id in groups:
            legacy_links.setdefault(int(gallery_id), set()).add(int(creator_id))
        if character_id in groups:
            legacy_links.setdefault(int(gallery_id), set()).add(int(character_id))
    for image in rows:
        if (int(image.width or 0) <= 0 or int(image.height or 0) <= 0
                or int(image.height) <= int(image.width) or not os.path.isfile(image.file_path)):
            continue
        owners = set(direct_links.get(int(image.id), ()))
        owners.update(group_links.get(int(image.gallery_id), ()))
        owners.update(legacy_links.get(int(image.gallery_id), ()))
        for person_id in owners:
            if person_id in people_by_id:
                groups[person_id].append(image)
    return groups


def _valid_still_images(query) -> list[Image]:
    return [image for image in query if (
        not image.is_video and image.file_path and os.path.isfile(image.file_path)
        and int(image.width or 0) > 0 and int(image.height or 0) > 0
    )]


def _collab_sources(db: Session) -> list[dict]:
    """Build only gallery and image Collabs backed by explicit creator links."""
    from models import gallery_creators, image_creators

    people = db.query(Creator).filter(Creator.creator_type.in_(FOUNDATION_REAL_CREATOR_TYPES)).all()
    person_ids = {int(person.id) for person in people}
    by_id = {int(person.id): person for person in people}
    gallery_people: dict[int, set[int]] = {}
    for gallery_id, person_id in db.query(gallery_creators.c.gallery_id, gallery_creators.c.creator_id).filter(
        gallery_creators.c.creator_id.in_(person_ids or {-1})
    ).all():
        gallery_people.setdefault(int(gallery_id), set()).add(int(person_id))
    # Legacy gallery ownership is an explicit creator link too.
    for gallery_id, person_id in db.query(Gallery.id, Gallery.creator_id).filter(
        Gallery.creator_id.in_(person_ids or {-1})
    ).all():
        gallery_people.setdefault(int(gallery_id), set()).add(int(person_id))

    gallery_rows = db.query(Gallery).filter(Gallery.id.in_(list(gallery_people) or [-1])).order_by(Gallery.id.asc()).all()
    by_gallery = {int(gallery.id): gallery for gallery in gallery_rows}
    gallery_images = _valid_still_images(db.query(Image).filter(
        Image.gallery_id.in_(list(by_gallery) or [-1]),
        Image.is_video.is_(False), Image.file_path.isnot(None),
        Image.width.isnot(None), Image.height.isnot(None),
    ).order_by(Image.id.asc()).all())
    images_by_gallery: dict[int, list[Image]] = {}
    for image in gallery_images:
        images_by_gallery.setdefault(int(image.gallery_id), []).append(image)

    output: list[dict] = []
    for gallery_id in sorted(gallery_people):
        creator_ids = sorted(gallery_people[gallery_id])
        images = images_by_gallery.get(gallery_id, [])
        if len(creator_ids) >= 2 and images:
            output.append({
                "family": "collab", "subtype": "gallery", "creator_ids": creator_ids,
                "gallery": by_gallery[gallery_id], "image": images[0],
            })

    # Image-level people must be linked directly to the still itself and also
    # belong to the supporting gallery's explicit creator set.
    direct_people: dict[int, set[int]] = {}
    for image_id, person_id in db.query(image_creators.c.image_id, image_creators.c.creator_id).filter(
        image_creators.c.creator_id.in_(person_ids or {-1})
    ).all():
        direct_people.setdefault(int(image_id), set()).add(int(person_id))
    for gallery_id, images in images_by_gallery.items():
        allowed = gallery_people.get(gallery_id, set())
        for image in images:
            creator_ids = sorted(direct_people.get(int(image.id), set()) & allowed)
            if len(creator_ids) >= 2:
                output.append({
                    "family": "collab", "subtype": "image", "creator_ids": creator_ids,
                    "gallery": by_gallery[gallery_id], "image": image,
                })
    output.sort(key=lambda row: (
        row["subtype"], tuple(row["creator_ids"]), int(row["image"].id), int(row["gallery"].id),
    ))
    return output


def foundation_base_rarity_targets(base_count: int) -> dict[str, int]:
    """Return exact C/R/SR/UR targets using the approved September ratios."""
    base_count = max(0, int(base_count or 0))
    raw = {rarity: base_count * ratio for rarity, ratio in FOUNDATION_BASE_RARITY_RATIOS.items()}
    targets = {rarity: int(value) for rarity, value in raw.items()}
    remainder = base_count - sum(targets.values())
    for rarity, _ in sorted(raw.items(), key=lambda item: (-(item[1] - int(item[1])), item[0]))[:remainder]:
        targets[rarity] += 1
    return targets


def foundation_spr_target(base_count: int) -> int:
    """Initial additive SPR quota; later personal milestones may append beyond it."""
    base_count = max(0, int(base_count or 0))
    if base_count <= 0:
        return 0
    return max(1, int(base_count * FOUNDATION_SPR_RATIO + 0.5))


def _source_card_personal_value(card: Card, context) -> dict:
    """Evaluate current engagement without changing the frozen card yet."""
    card_type = card.card_type.value if hasattr(card.card_type, "value") else str(card.card_type)
    image = context.images.get(card.source_image_id) if card.source_image_id else None
    gallery_id = card.source_gallery_id or (image.gallery_id if image else None)
    gallery = context.galleries.get(gallery_id) if gallery_id else None
    creator_id = card.source_creator_id or (gallery.creator_id if gallery else None)
    creator = context.creators.get(creator_id) if creator_id else None
    tags = context.image_tags.get(image.id, []) if image and card_type == CardType.image.value else context.gallery_tags.get(gallery_id, [])
    value = evaluate_personal_value(
        source_key=f"foundation:{card.id}", card_type=card_type,
        image=image, gallery=gallery, creator=creator, tags=tags,
        gallery_view_seconds=context.gallery_view_seconds.get(gallery_id, 0),
    )
    value["source_card_id"] = card.id
    # Image printings inherit creator context through their gallery. Keep that
    # resolved identity in the ranking payload so variety limits do not treat
    # every image card as one anonymous creator bucket.
    value["creator_id"] = creator_id
    value["cum_count"] = int((image.cum_count if image else gallery.cum_count if gallery else 0) or 0)
    value["view_count"] = int((image.view_count if image else gallery.view_count if gallery else 0) or 0)
    value["view_seconds"] = int((image.view_seconds if image else context.gallery_view_seconds.get(gallery_id, 0)) or 0)
    value["rating"] = float((image.rating if image else gallery.rating if gallery else 0) or 0)
    value["is_favorite"] = bool(image.is_favorite if image else gallery.is_favorite if gallery else False)
    value["spr_signal"] = bool(value.get("spr_eligible"))
    return value


def _candidate_sort_key(card: Card, value: dict) -> tuple:
    """Stable engagement ordering: score first, then the strongest raw signals."""
    return (
        -float(value.get("score") or 0),
        -int(value.get("cum_count") or 0),
        -int(value.get("view_seconds") or 0),
        -int(value.get("view_count") or 0),
        -float(value.get("rating") or 0),
        0 if value.get("is_favorite") else 1,
        int(card.id),
    )


def _select_ranked_with_variety(candidates: list[tuple[Card, dict]], target: int) -> list[tuple[Card, dict]]:
    """Take the strongest candidates while preventing one creator from owning all SPRs."""
    if target <= 0:
        return []
    ordered = sorted(candidates, key=lambda item: _candidate_sort_key(*item))
    if not ordered:
        return []
    creator_cap = max(1, int((target * 0.12) + 0.9999))
    selected: list[tuple[Card, dict]] = []
    counts: dict[int | None, int] = {}
    deferred: list[tuple[Card, dict]] = []
    for item in ordered:
        card, value = item
        creator_id = value.get("creator_id") or card.source_creator_id
        if counts.get(creator_id, 0) >= creator_cap:
            deferred.append(item)
            continue
        selected.append(item)
        counts[creator_id] = counts.get(creator_id, 0) + 1
        if len(selected) >= target:
            return selected
    for item in deferred:
        selected.append(item)
        if len(selected) >= target:
            break
    return selected


def _print_rarity(card_type: str, source_id: str | int) -> str:
    """Persisted rarity allocation: 55% C, 28% R, 14% SR, 3% UR."""
    roll = _hash_int(card_type, source_id, "rarity") % 10_000
    if roll < 300:
        return "UR"
    if roll < 1_700:
        return "SR"
    if roll < 4_500:
        return "R"
    return "C"


def _legacy_tier(print_rarity: str) -> CardRarity:
    # The old tier column remains for compatibility with the forge and existing
    # collection code.  `print_rarity` is the authoritative V2 rarity.
    return {
        "C": CardRarity.common,
        "R": CardRarity.common,
        "SR": CardRarity.epic,
        "UR": CardRarity.legendary,
        "SPR": CardRarity.legendary,
    }[print_rarity]


def _state(db: Session) -> TCGSetupState:
    state = db.query(TCGSetupState).filter(TCGSetupState.id == 1).first()
    if not state or not state.v2_enabled:
        raise ValueError("Start the TCG before publishing its Foundation catalogue")
    return state


def foundation_status(db: Session) -> dict:
    state = db.query(TCGSetupState).filter(TCGSetupState.id == 1).first()
    total = db.query(func.count(Card.id)).filter(Card.catalog_code == FOUNDATION_CODE).scalar() or 0
    base = db.query(func.count(Card.id)).filter(
        Card.catalog_code == FOUNDATION_CODE,
        Card.parallel_of_id.is_(None),
    ).scalar() or 0
    parallels = total - base
    return {
        "code": FOUNDATION_CODE,
        "status": (state.foundation_status if state else "pending") or "pending",
        "base_printings": int(base),
        "spr_parallels": int(parallels),
        "total_printings": int(total),
        "target": int(state.foundation_target or 0) if state else 0,
        "ready": bool(state and state.foundation_status == "ready" and base > 0),
    }


def _foundation_release(db: Session) -> TCGRelease | None:
    return db.query(TCGRelease).filter(TCGRelease.code == "FND-CORE").first()


def _foundation_context_for_cards(db: Session, cards: list[Card]):
    image_ids = [card.source_image_id for card in cards if card.source_image_id]
    gallery_ids = [card.source_gallery_id for card in cards if card.source_gallery_id]
    creator_ids = [card.source_creator_id for card in cards if card.source_creator_id]
    return build_personal_value_context(
        db, image_ids=image_ids, gallery_ids=gallery_ids, creator_ids=creator_ids,
    )


def _append_foundation_spr(db: Session, base: Card, value: dict, *, reason: str) -> Card | None:
    """Append one linked SPR and checklist row, idempotently."""
    release = _foundation_release(db)
    if not release:
        return None
    existing = db.query(Card).filter(Card.catalog_code == FOUNDATION_CODE, Card.parallel_of_id == base.id).first()
    if existing:
        return existing
    base_entry = db.query(TCGChecklistEntry).filter(
        TCGChecklistEntry.release_id == release.id, TCGChecklistEntry.card_id == base.id,
    ).first()
    if not base_entry:
        return None
    now = datetime.utcnow()
    mint_audit = {
        **(json.loads(base.mint_audit_json or "{}") if base.mint_audit_json else {}),
        "policy_version": FOUNDATION_ALGORITHM_VERSION,
        "published_rarity": "SPR",
        "parallel_of_id": base.id,
        "selection_reason": reason,
        "personal_value": value,
    }
    spr = Card(
        card_type=base.card_type, rarity=CardRarity.legendary, foil=False,
        is_relic=False, is_unique=False, source_image_id=base.source_image_id,
        source_gallery_id=base.source_gallery_id, source_creator_id=base.source_creator_id,
        linked_character_id=base.linked_character_id, collab_data=base.collab_data,
        cxp=0, crs=float(value.get("score") or base.crs or 0), rarity_class="SPR",
        catalog_code=FOUNDATION_CODE, collector_number=base.collector_number,
        print_rarity="SPR", parallel_of_id=base.id, is_legacy=False,
        generated_at=now, mint_audit_json=json.dumps(mint_audit),
    )
    db.add(spr)
    db.flush()
    db.add(TCGChecklistEntry(
        release_id=release.id, set_id=base_entry.set_id, card_id=spr.id,
        collector_position=base_entry.collector_position, collector_suffix="S",
        lane=base_entry.lane, is_base_printing=False, required_for_complete=False,
        published_rarity="SPR", selection_reason=reason,
    ))
    return spr


def _source_qualifies_for_post_publication_spr(value: dict) -> bool:
    """Live unlock signal: six cums is explicit; existing strong signals remain valid."""
    return bool(
        value.get("cum_count", 0) >= FOUNDATION_SPR_UNLOCK_CUM
        or value.get("is_favorite")
        or float(value.get("rating") or 0) >= 8
        or value.get("spr_signal")
    )


def rebalance_foundation_base_rarities(db: Session) -> dict:
    """Apply the approved scalable base distribution without replacing card IDs."""
    bases = db.query(Card).filter(
        Card.catalog_code == FOUNDATION_CODE, Card.parallel_of_id.is_(None),
    ).order_by(Card.id.asc()).all()
    if not bases:
        return {"updated": 0, "base_count": 0, "targets": foundation_base_rarity_targets(0)}
    targets = foundation_base_rarity_targets(len(bases))
    owned_ids = {
        row[0] for row in db.query(CardInventory.card_id).filter(CardInventory.quantity > 0).all()
    }
    owned = [card for card in bases if card.id in owned_ids]
    owned_counts = {rarity: sum(1 for card in owned if card.print_rarity == rarity) for rarity in ("C", "R", "SR", "UR")}
    # Never force an owned printing across a rarity boundary. If an old owned
    # distribution exceeds a new target, preserve it and take the difference
    # from unowned tiers while keeping the total exact.
    for rarity in owned_counts:
        targets[rarity] = max(targets[rarity], owned_counts[rarity])
    overflow = sum(targets.values()) - len(bases)
    if overflow > 0:
        for rarity in ("C", "R", "SR", "UR"):
            reducible = max(0, targets[rarity] - owned_counts[rarity])
            reduction = min(reducible, overflow)
            targets[rarity] -= reduction
            overflow -= reduction
            if overflow == 0:
                break

    context = _foundation_context_for_cards(db, bases)
    ranked = sorted(
        ((card, _source_card_personal_value(card, context)) for card in bases if card.id not in owned_ids),
        key=lambda item: _candidate_sort_key(*item),
    )
    assignments = {card.id: card.print_rarity if card.id in owned_ids and card.print_rarity in ("C", "R", "SR", "UR") else None for card in bases}
    remaining = [card for card, _value in ranked]
    for rarity in ("UR", "SR", "R", "C"):
        need = targets[rarity] - sum(1 for value in assignments.values() if value == rarity)
        for card in remaining[:max(0, need)]:
            assignments[card.id] = rarity
        remaining = remaining[max(0, need):]
    for card in remaining:
        assignments[card.id] = "C"

    by_card_id = {card.id: card for card in bases}
    updated = 0
    for card_id, rarity in assignments.items():
        card = by_card_id[card_id]
        if rarity not in ("C", "R", "SR", "UR"):
            rarity = "C"
        if card.print_rarity != rarity or card.rarity_class != rarity or card.rarity != _legacy_tier(rarity):
            card.print_rarity = rarity
            card.rarity_class = rarity
            card.rarity = _legacy_tier(rarity)
            updated += 1
        entry = db.query(TCGChecklistEntry).join(TCGRelease).filter(
            TCGRelease.code == "FND-CORE", TCGChecklistEntry.card_id == card.id,
        ).first()
        if entry:
            entry.published_rarity = rarity
            entry.required_for_complete = True
    return {"updated": updated, "base_count": len(bases), "targets": targets}


def ensure_foundation_spr_for_source(
    db: Session, *, image_id: int | None = None, gallery_id: int | None = None,
    creator_id: int | None = None,
) -> dict:
    """Append eligible Foundation SPRs after publication without touching bases."""
    release = _foundation_release(db)
    if not release or release.status != "published":
        return {"added": 0, "existing": 0, "checked": 0}
    query = db.query(Card).filter(Card.catalog_code == FOUNDATION_CODE, Card.parallel_of_id.is_(None))
    if image_id is not None:
        query = query.filter(Card.source_image_id == int(image_id))
    elif gallery_id is not None:
        query = query.filter(Card.source_gallery_id == int(gallery_id))
    elif creator_id is not None:
        query = query.filter(Card.source_creator_id == int(creator_id))
    else:
        return {"added": 0, "existing": 0, "checked": 0}
    bases = query.order_by(Card.id.asc()).all()
    context = _foundation_context_for_cards(db, bases)
    added = 0
    existing = 0
    for base in bases:
        linked = db.query(Card.id).filter(Card.catalog_code == FOUNDATION_CODE, Card.parallel_of_id == base.id).first()
        if linked:
            existing += 1
            continue
        value = _source_card_personal_value(base, context)
        if not _source_qualifies_for_post_publication_spr(value):
            continue
        if _append_foundation_spr(
            db, base, value,
            reason=f"Post-publication engagement unlock (cum milestone {FOUNDATION_SPR_UNLOCK_CUM}+)",
        ):
            added += 1
    if added:
        release.manifest_json = json.dumps({
            **(json.loads(release.manifest_json or "{}") if release.manifest_json else {}),
            "spr_count": db.query(Card.id).filter(Card.catalog_code == FOUNDATION_CODE, Card.print_rarity == "SPR").count(),
            "append_only_spr": True,
            "last_append_at": datetime.utcnow().isoformat(),
        })
        db.flush()
    return {"added": added, "existing": existing, "checked": len(bases)}


def reconcile_foundation_sprs(db: Session) -> dict:
    """Rebuild the initial SPR quota from current evidence, then remain append-only."""
    release = _foundation_release(db)
    if not release or release.status != "published":
        return {"added": 0, "target": 0, "spr_count": 0}
    bases = db.query(Card).filter(Card.catalog_code == FOUNDATION_CODE, Card.parallel_of_id.is_(None)).order_by(Card.id.asc()).all()
    if not bases:
        return {"added": 0, "target": 0, "spr_count": 0}
    context = _foundation_context_for_cards(db, bases)
    candidates = []
    for base in bases:
        if not base.source_image_id and not base.source_gallery_id and not base.source_creator_id:
            continue
        candidates.append((base, _source_card_personal_value(base, context)))
    target = foundation_spr_target(len(bases))
    existing_bases = {
        row[0] for row in db.query(Card.parallel_of_id).filter(
            Card.catalog_code == FOUNDATION_CODE, Card.print_rarity == "SPR",
        ).all() if row[0]
    }
    available = [(base, value) for base, value in candidates if base.id not in existing_bases]
    ur_candidates = [(base, value) for base, value in available if base.print_rarity == "UR"]
    selected = _select_ranked_with_variety(ur_candidates, max(0, target - len(existing_bases)))
    # If older data has fewer URs than the approved scalable quota, use the
    # next strongest base cards rather than starving the permanent catalogue.
    if len(selected) < max(0, target - len(existing_bases)):
        selected_ids = {base.id for base, _ in selected}
        fallback = [(base, value) for base, value in available if base.id not in selected_ids]
        selected.extend(_select_ranked_with_variety(
            fallback, max(0, target - len(existing_bases) - len(selected)),
        ))
    added = 0
    selected_missing_checklist = 0
    append_returned_none = 0
    base_checklist_ids = {
        row[0] for row in db.query(TCGChecklistEntry.card_id).filter(
            TCGChecklistEntry.release_id == release.id,
            TCGChecklistEntry.is_base_printing.is_(True),
        ).all()
    }
    for base, value in selected:
        if base.id not in base_checklist_ids:
            selected_missing_checklist += 1
            continue
        spr = _append_foundation_spr(
            db, base, value,
            reason="Initial Foundation SPR quota selected by deterministic personal-value ranking",
        )
        if spr:
            added += 1
        else:
            append_returned_none += 1
    db.flush()
    spr_count = db.query(Card.id).filter(
        Card.catalog_code == FOUNDATION_CODE, Card.print_rarity == "SPR",
        Card.parallel_of_id.isnot(None),
    ).count()
    spr_checklist_count = db.query(TCGChecklistEntry.id).join(
        Card, TCGChecklistEntry.card_id == Card.id,
    ).filter(
        TCGChecklistEntry.release_id == release.id,
        TCGChecklistEntry.is_base_printing.is_(False),
        TCGChecklistEntry.published_rarity == "SPR",
        Card.catalog_code == FOUNDATION_CODE, Card.print_rarity == "SPR",
        Card.parallel_of_id.isnot(None),
    ).count()
    diagnostics = {
        "base_count": len(bases),
        "base_checklist_count": len(base_checklist_ids),
        "candidate_count": len(candidates),
        "candidate_missing_source_count": len(bases) - len(candidates),
        "ur_candidate_count": len(ur_candidates),
        "existing_spr_base_count": len(existing_bases),
        "selected_count": len(selected),
        "selected_missing_checklist_count": selected_missing_checklist,
        "appended_count": added,
        "append_returned_none_count": append_returned_none,
        "skip_reasons": {
            "missing_source_reference": len(bases) - len(candidates),
            "selected_base_missing_checklist": selected_missing_checklist,
            "append_helper_returned_none": append_returned_none,
        },
        "spr_card_count": spr_count,
        "spr_checklist_count": spr_checklist_count,
        "spr_target": target,
    }
    if spr_count < target or spr_checklist_count < target:
        raise RuntimeError(
            "Foundation SPR quota was not materialized; "
            + json.dumps(diagnostics, sort_keys=True)
        )
    release.algorithm_version = FOUNDATION_ALGORITHM_VERSION
    release.manifest_json = json.dumps({
        **(json.loads(release.manifest_json or "{}") if release.manifest_json else {}),
        "frozen": False,
        "base_total": len(bases),
        "spr_target": target,
        "spr_count": spr_count,
        "spr_unlock_cum_threshold": FOUNDATION_SPR_UNLOCK_CUM,
        "append_only_spr": True,
        "selection": "deterministic personal-value ranking with creator variety",
        "source": "foundation_catalog",
    })
    release.generation_report = json.dumps({
        "base_rarity_targets": foundation_base_rarity_targets(len(bases)),
        "spr_target": target,
        "spr_existing": len(existing_bases),
        "spr_added": added,
        "spr_candidate_count": len(candidates),
        "spr_candidate_missing_source_count": len(bases) - len(candidates),
        "spr_ur_candidate_count": len(ur_candidates),
        "spr_selected_count": len(selected),
        "spr_selected_missing_checklist_count": selected_missing_checklist,
        "spr_append_returned_none_count": append_returned_none,
        "spr_skip_reasons": diagnostics["skip_reasons"],
        "spr_card_count": spr_count,
        "spr_checklist_count": spr_checklist_count,
    })
    db.flush()
    return {
        "added": added, "target": target,
        "spr_count": spr_count,
        "base_count": len(bases),
        **diagnostics,
    }


def repair_foundation_catalog(db: Session) -> dict:
    """One-time live repair for the shipped Foundation release.

    Base Card rows are never deleted or replaced. Existing inventory rows keep
    their card IDs and quantities; only their published rarity metadata may be
    rebalanced to establish the approved scalable distribution.
    """
    release = _foundation_release(db)
    if not release or release.status != "published":
        raise ValueError("Published Foundation release not found")
    before_base_ids = {
        row[0] for row in db.query(Card.id).filter(
            Card.catalog_code == FOUNDATION_CODE, Card.parallel_of_id.is_(None),
        ).all()
    }
    before_inventory = {
        row[0]: int(row[1] or 0) for row in db.query(CardInventory.card_id, CardInventory.quantity).join(Card).filter(
            Card.catalog_code == FOUNDATION_CODE, Card.parallel_of_id.is_(None), CardInventory.quantity > 0,
        ).all()
    }
    rarity = rebalance_foundation_base_rarities(db)
    sprs = reconcile_foundation_sprs(db)
    after_base_ids = {
        row[0] for row in db.query(Card.id).filter(
            Card.catalog_code == FOUNDATION_CODE, Card.parallel_of_id.is_(None),
        ).all()
    }
    after_inventory = {
        row[0]: int(row[1] or 0) for row in db.query(CardInventory.card_id, CardInventory.quantity).join(Card).filter(
            Card.catalog_code == FOUNDATION_CODE, Card.parallel_of_id.is_(None), CardInventory.quantity > 0,
        ).all()
    }
    if before_base_ids != after_base_ids or before_inventory != after_inventory:
        raise RuntimeError("Foundation repair changed base IDs or owned inventory")
    state = db.query(TCGSetupState).filter(TCGSetupState.id == 1).first()
    if state:
        state.foundation_total = db.query(Card.id).filter(Card.catalog_code == FOUNDATION_CODE).count()
        state.foundation_target = len(before_base_ids)
    db.commit()
    return {
        "release_code": release.code, "base_ids_preserved": True,
        "owned_inventory_preserved": True, "rarity": rarity, "sprs": sprs,
        "status": foundation_status(db),
    }


def build_foundation_catalog(db: Session) -> dict:
    """Publish the deterministic initial catalogue. Safe to resume or repeat."""
    state = _state(db)

    # A V2 setup created by an older build could still call the legacy random
    # generator before Foundation publication. Those pulls have no catalogue
    # identity and must not masquerade as current printings. Earned Bond and
    # Hall of Fame cards are intentionally outside booster catalogues and stay
    # current.
    leaked_owned_ids = [row[0] for row in (
        db.query(Card.id)
        .join(CardInventory, CardInventory.card_id == Card.id)
        .filter(
            Card.catalog_code.is_(None),
            Card.is_legacy.is_(False),
            Card.card_type.in_((
                CardType.image, CardType.gallery, CardType.creator,
                CardType.variant, CardType.collab,
            )),
        )
        .distinct()
        .all()
    )]
    if leaked_owned_ids:
        db.query(Card).filter(Card.id.in_(leaked_owned_ids)).update(
            {Card.is_legacy: True}, synchronize_session=False
        )
        db.commit()

    existing = foundation_status(db)
    if existing["ready"]:
        return existing

    state.foundation_status = "building"
    db.commit()

    # Catalogue each supported card face from real sources. Scene count is the
    # residual after the named family targets and all supported Collab sources.
    from models import gallery_creators
    from PIL import Image as PILImage

    still_query = db.query(Image).join(Gallery, Gallery.id == Image.gallery_id).filter(
        Image.is_video.is_(False), Image.file_path.isnot(None),
        Image.width.isnot(None), Image.height.isnot(None),
        Gallery.period_year.isnot(None),
    ).order_by(Image.id.asc())
    eligible_scene_images = _valid_still_images(still_query.all())
    gallery_rows = db.query(Gallery.id, func.min(Image.id).label("image_id")).join(
        Image, Image.gallery_id == Gallery.id
    ).filter(
        Gallery.period_year.isnot(None),
        Image.is_video.is_(False), Image.file_path.isnot(None),
        Image.width.isnot(None), Image.height.isnot(None),
    ).group_by(Gallery.id).order_by(Gallery.id.asc()).all()
    valid_image_by_id = {int(image.id): image for image in eligible_scene_images}
    eligible_galleries = [
        (int(gallery_id), int(image_id)) for gallery_id, image_id in gallery_rows
        if int(image_id) in valid_image_by_id
    ]

    all_people = db.query(Creator).filter(Creator.creator_type.in_(
        ("cosplayer", "ethot", "artist", "character", "actress", "custom")
    )).order_by(Creator.id.asc()).all()
    creators = [person for person in all_people if str(getattr(person.creator_type, "value", person.creator_type)) != "character"]
    characters = [person for person in all_people if str(getattr(person.creator_type, "value", person.creator_type)) == "character"]

    def avatar_ready(person):
        if not person.avatar_path or not os.path.isfile(person.avatar_path):
            return False
        try:
            with PILImage.open(person.avatar_path) as avatar:
                return avatar.width > 0 and avatar.height > 0
        except Exception:
            return False

    portrait_candidate_counts = {"creator": 0, "character": 0}

    def identity_cards(people: list[Creator], family: str) -> list[dict]:
        target_count = FOUNDATION_FAMILY_TARGETS[family]
        grouped = _portrait_groups(db, people, character=(family == "character"))
        portrait_candidate_counts[family] = sum(len(sources) for sources in grouped.values())
        # Canonical identity coverage is one per eligible profile even if its
        # current PFP needs repair before that printing can be rendered.
        cards = [{
            "family": family, "person": person, "image": None,
            "identity_kind": "canonical",
        } for person in sorted(people, key=lambda row: int(row.id))]
        portrait_groups = {
            int(person.id): [(int(person.id), image) for image in grouped.get(int(person.id), [])]
            for person in people
        }
        variants = _round_robin_sources(portrait_groups, max(0, target_count - len(cards)), family)
        people_by_id = {int(person.id): person for person in people}
        cards.extend({
            "family": family, "person": people_by_id[int(person_id)],
            "image": image, "identity_kind": "portrait",
        } for person_id, image in variants)
        return cards[:target_count]

    creator_cards = identity_cards(creators, "creator")
    character_cards = identity_cards(characters, "character")
    missing_live_avatar_ids = sorted(
        int(person.id) for person in all_people if not avatar_ready(person)
    )
    # Gallery-level M2M links establish the real creator×character pairing.
    cre_link = gallery_creators.alias("foundation_pair_creator")
    char_link = gallery_creators.alias("foundation_pair_character")
    # Use explicit aliases for the two linked identities to keep their type
    # predicates independent in SQLAlchemy's ORM query construction.
    from sqlalchemy.orm import aliased
    PairCreator = aliased(Creator, name="foundation_pair_person")
    PairCharacter = aliased(Creator, name="foundation_pair_character_person")
    pair_rows = db.query(
        cre_link.c.creator_id, char_link.c.creator_id, cre_link.c.gallery_id
    ).select_from(cre_link).join(char_link, char_link.c.gallery_id == cre_link.c.gallery_id).join(
        PairCreator, PairCreator.id == cre_link.c.creator_id
    ).join(PairCharacter, PairCharacter.id == char_link.c.creator_id).filter(
        PairCreator.creator_type.in_(FOUNDATION_REAL_CREATOR_TYPES),
        PairCharacter.creator_type == "character",
    ).distinct().order_by(cre_link.c.creator_id, char_link.c.creator_id, cre_link.c.gallery_id).all()
    pair_gallery_ids: dict[tuple[int, int], set[int]] = {}
    for creator_id, character_id, gallery_id in pair_rows:
        pair_gallery_ids.setdefault((int(creator_id), int(character_id)), set()).add(int(gallery_id))
    pair_groups: dict[int, list] = {}
    pair_keys = sorted(pair_gallery_ids)
    image_rows = db.query(Image).filter(
        Image.gallery_id.in_(sorted({gid for ids in pair_gallery_ids.values() for gid in ids}) or [-1]),
        Image.is_video.is_(False), Image.file_path.isnot(None),
        Image.width.isnot(None), Image.height.isnot(None),
    ).order_by(Image.id.asc()).all()
    valid_pair_images = _valid_still_images(image_rows)
    pair_by_gallery: dict[int, list[tuple[int, int]]] = {}
    for pair in pair_keys:
        for gallery_id in pair_gallery_ids[pair]:
            pair_by_gallery.setdefault(gallery_id, []).append(pair)
    for image in valid_pair_images:
        for pair in pair_by_gallery.get(int(image.gallery_id), []):
            pair_groups.setdefault(pair_keys.index(pair), []).append((pair[0], pair[1], image))
    selected_cosplay = _round_robin_sources(pair_groups, FOUNDATION_FAMILY_TARGETS["cosplay"], "cosplay")

    collab_sources = _collab_sources(db)
    gallery_target = min(FOUNDATION_FAMILY_TARGETS["gallery"], len(eligible_galleries))
    selected_galleries = eligible_galleries[:gallery_target]
    selected_creator_cards = creator_cards
    selected_character_cards = character_cards
    non_scene_count = (
        len(selected_galleries) + len(selected_creator_cards) + len(selected_character_cards)
        + len(selected_cosplay) + len(collab_sources)
    )
    if non_scene_count > FOUNDATION_LARGE_LIBRARY_TARGET:
        raise ValueError("Foundation non-Scene source families exceed the 60,000-card base target")
    scene_target = min(len(eligible_scene_images), FOUNDATION_LARGE_LIBRARY_TARGET - non_scene_count)
    scene_pool = list(eligible_scene_images)
    random.Random(_hash_int("foundation-scenes")).shuffle(scene_pool)
    selected_scenes = scene_pool[:scene_target]
    target = non_scene_count + len(selected_scenes)
    state.foundation_target = target
    db.commit()
    if target <= 0:
        state.foundation_status = "failed"
        db.commit()
        raise ValueError("No media or identity sources currently support a Foundation card")

    # Build all personal-value context in bounded source-ID batches.
    selected_image_ids = {
        int(image.id) for image in selected_scenes
    } | {image_id for _, image_id in selected_galleries}
    for entry in (*selected_creator_cards, *selected_character_cards):
        if entry["image"]:
            selected_image_ids.add(int(entry["image"].id))
    selected_image_ids.update(int(image.id) for _, _, image in selected_cosplay)
    selected_image_ids.update(int(row["image"].id) for row in collab_sources)
    selected_gallery_ids = {gallery_id for gallery_id, _ in selected_galleries}
    selected_gallery_ids.update(int(row["gallery"].id) for row in collab_sources)
    selected_creator_ids = {int(entry["person"].id) for entry in (*selected_creator_cards, *selected_character_cards)}
    for row in collab_sources:
        selected_creator_ids.update(row["creator_ids"])
    settings = db.query(TCGSettings).filter(TCGSettings.id == 1).first()
    personal_context = build_personal_value_context(
        db, image_ids=list(selected_image_ids), gallery_ids=list(selected_gallery_ids),
        creator_ids=list(selected_creator_ids),
        ai_confidence_threshold=float(settings.ai_confidence_threshold if settings else 0.72),
    )

    now = datetime.utcnow()
    rows: list[dict] = []
    collector_number = 1

    def append_row(card_type: CardType, family: str, source_identity: str, **source_fields):
        nonlocal collector_number
        image_id = source_fields.get("source_image_id")
        gallery_id = source_fields.get("source_gallery_id")
        image = personal_context.images.get(image_id) if image_id else None
        if not gallery_id and image:
            gallery_id = image.gallery_id
        gallery = personal_context.galleries.get(gallery_id) if gallery_id else None
        creator_id = source_fields.get("source_creator_id") or (gallery.creator_id if gallery else None)
        creator = personal_context.creators.get(creator_id) if creator_id else None
        base_rarity = _print_rarity(family, source_identity)
        personal_value = evaluate_personal_value(
            source_key=source_identity, card_type=family, image=image, gallery=gallery,
            creator=creator,
            tags=(personal_context.gallery_tags.get(gallery_id, []) if family == "gallery"
                  else personal_context.image_tags.get(image_id, [])),
            gallery_view_seconds=personal_context.gallery_view_seconds.get(gallery_id, 0),
        )
        rarity = apply_rarity_floor(base_rarity, personal_value["rarity_floor"])
        mint_audit = {
            **personal_value, "source_key": source_identity,
            "base_rarity": base_rarity, "published_rarity": rarity,
        }
        if source_fields.pop("identity_kind", None):
            mint_audit["identity_kind"] = "canonical" if source_identity.endswith(":canon") else "portrait"
        rows.append({
            "card_type": card_type, "rarity": _legacy_tier(rarity),
            "foil": False, "is_relic": False, "is_unique": False,
            "cxp": 0, "crs": personal_value["score"], "rarity_class": rarity,
            "catalog_code": FOUNDATION_CODE, "collector_number": collector_number,
            "print_rarity": rarity, "parallel_of_id": None, "is_legacy": False,
            "generated_at": now, "mint_audit_json": json.dumps(mint_audit),
            **source_fields,
        })
        collector_number += 1

    for image in selected_scenes:
        append_row(CardType.image, "scene", f"image:{image.id}", source_image_id=image.id)
    for gallery_id, image_id in selected_galleries:
        append_row(CardType.gallery, "gallery", f"gallery:{gallery_id}",
                   source_gallery_id=gallery_id, source_image_id=image_id)
    for family, entries in (("creator", selected_creator_cards), ("character", selected_character_cards)):
        for entry in entries:
            person = entry["person"]
            image = entry["image"]
            key = (
                f"{family}:{person.id}:canon" if image is None
                else f"{family}:{person.id}:portrait:{image.id}"
            )
            append_row(CardType.creator, family, key,
                       source_creator_id=person.id,
                       source_image_id=image.id if image else None,
                       identity_kind=entry["identity_kind"])
    for creator_id, character_id, image in selected_cosplay:
        append_row(CardType.variant, "cosplay",
                   f"cosplay:{creator_id}:{character_id}:image:{image.id}",
                   source_creator_id=creator_id, linked_character_id=character_id,
                   source_image_id=image.id)
    for row in collab_sources:
        gallery = row["gallery"]
        image = row["image"]
        creator_ids = row["creator_ids"]
        names = [personal_context.creators[cid].name for cid in creator_ids if cid in personal_context.creators]
        character_names = [
            person.name for person in db.query(Creator).join(
                gallery_creators, gallery_creators.c.creator_id == Creator.id
            ).filter(gallery_creators.c.gallery_id == gallery.id, Creator.creator_type == "character")
            .order_by(Creator.id.asc()).all()
        ]
        source_identity = (
            f"collab:{','.join(str(value) for value in creator_ids)}:image:{image.id}"
            if row["subtype"] == "image"
            else f"collab:{','.join(str(value) for value in creator_ids)}:gallery:{gallery.id}"
        )
        append_row(CardType.collab, "collab", source_identity,
                   source_creator_id=None, source_gallery_id=gallery.id,
                   source_image_id=image.id,
                   collab_data=json.dumps({
                       "subtype": row["subtype"], "creator_ids": creator_ids,
                       "creator_names": names, "character_names": character_names,
                   }),)

    # A failed prior attempt can leave a partial catalogue. Rebuild only the
    # unpublished rows and never duplicate an already completed catalogue.
    db.query(Card).filter(Card.catalog_code == FOUNDATION_CODE).delete(synchronize_session=False)
    db.flush()
    for start in range(0, len(rows), 2_000):
        db.bulk_insert_mappings(Card, rows[start:start + 2_000])
        db.flush()

    # The base catalogue uses the approved scaled distribution. SPR supply is
    # selected after publication from deterministic personal-value evidence so
    # the quota is large enough to be fun without turning into random noise.
    state.foundation_status = "ready"
    state.foundation_total = len(rows)
    db.commit()
    # The catalogue uses bulk deletes/inserts, which bypass ORM identity-map
    # synchronization. Expire loaded Cards before publication/reconciliation so
    # reused primary keys cannot expose stale source or rarity fields.
    db.expire_all()
    from services.tcg_v2 import seed_foundation_release
    seed_foundation_release(db)
    db.flush()
    rebalance_foundation_base_rarities(db)
    reconcile_foundation_sprs(db)
    state.foundation_total = db.query(Card.id).filter(Card.catalog_code == FOUNDATION_CODE).count()
    release = _foundation_release(db)
    if release:
        try:
            generation_report = json.loads(release.generation_report or "{}")
        except (TypeError, ValueError):
            generation_report = {}
        generation_report.update({
            "algorithm": FOUNDATION_ALGORITHM_VERSION,
            "base_target": FOUNDATION_LARGE_LIBRARY_TARGET,
            "base_count": target,
            "base_composition": {
                "scene": len(selected_scenes), "gallery": len(selected_galleries),
                "creator": len(selected_creator_cards), "character": len(selected_character_cards),
                "cosplay": len(selected_cosplay),
                "collab": len(collab_sources),
                "collab_gallery": sum(row["subtype"] == "gallery" for row in collab_sources),
                "collab_image": sum(row["subtype"] == "image" for row in collab_sources),
            },
            "eligible_sources": {
                "scene_images": len(eligible_scene_images),
                "galleries": len(eligible_galleries),
                "creator_profiles": len(creators), "creator_portrait_images": portrait_candidate_counts["creator"],
                "character_profiles": len(characters), "character_portrait_images": portrait_candidate_counts["character"],
                "cosplay_pair_images": sum(len(items) for items in pair_groups.values()),
                "collab_gallery_and_image_sources": len(collab_sources),
            },
            "missing_live_avatar_profile_ids": missing_live_avatar_ids,
            "family_shortfalls": {
                "gallery": max(0, FOUNDATION_FAMILY_TARGETS["gallery"] - len(selected_galleries)),
                "creator": max(0, FOUNDATION_FAMILY_TARGETS["creator"] - len(selected_creator_cards)),
                "character": max(0, FOUNDATION_FAMILY_TARGETS["character"] - len(selected_character_cards)),
                "cosplay": max(0, FOUNDATION_FAMILY_TARGETS["cosplay"] - len(selected_cosplay)),
                "scene_residual": max(0, FOUNDATION_LARGE_LIBRARY_TARGET - non_scene_count - len(selected_scenes)),
            },
        })
        release.generation_report = json.dumps(generation_report, sort_keys=True)
    db.commit()
    return foundation_status(db)


def prepare_acquired_visual(db: Session, card: Card) -> bool:
    """Freeze the approved V2 face for a pulled definition before revealing it."""
    card.rarity_class = card.print_rarity or card.rarity_class or "C"
    card_type = card.card_type.value if hasattr(card.card_type, "value") else str(card.card_type)
    try:
        if card_type == "gallery":
            from services.gallery_cards import prepare_gallery_visual
            prepare_gallery_visual(db, card)
        elif card_type == "creator":
            creator = db.query(Creator).filter(Creator.id == card.source_creator_id).first()
            creator_type = creator.creator_type.value if creator and hasattr(creator.creator_type, "value") else (creator.creator_type if creator else None)
            if creator_type == "character":
                from services.character_cards import prepare_character_visual
                # Catalogue opening must not block on masking; the accepted
                # full-bleed fallback remains a truthful Character card.
                prepare_character_visual(db, card, creator.id, ensure_mask_fn=lambda _db, _img: None)
            else:
                from services.creator_cards import prepare_creator_visual
                prepare_creator_visual(db, card)
        elif card_type == "variant":
            from services.cosplay_cards import prepare_cosplay_visual
            prepare_cosplay_visual(db, card)
        elif card_type == "collab":
            from services.collab_cards import prepare_collab_visual
            prepare_collab_visual(db, card)
        elif card_type == "hof":
            from services.hof_cards import prepare_hof_visual
            prepare_hof_visual(db, card)
        elif card_type == "bond":
            from services.bond_cards import prepare_bond_visual
            prepare_bond_visual(db, card)
        # Scene recipes are assembled from frozen source identity during
        # serialization; their expensive mask remains background work.
        db.flush()
        return True
    except Exception:
        return card_type == "image"


def acquire_vault_booster(
    db: Session, *, quantity: int, cost_per_pack: int, free: bool = False
) -> dict:
    """Open 10-card permanent boosters from published Foundation definitions."""
    if quantity < 1 or quantity > 20:
        raise ValueError("Open between 1 and 20 boosters at a time")
    status = foundation_status(db)
    if not status["ready"]:
        status = build_foundation_catalog(db)

    from services.cards import _get_or_create_profile, _card_to_dict, prepare_card_face_for_reveal
    profile = _get_or_create_profile(db)
    total_cost = 0 if free else cost_per_pack * quantity
    if not free:
        if (profile.vault_credits or 0) < total_cost:
            raise ValueError(f"Insufficient credits: need {total_cost}, have {profile.vault_credits or 0}")
        profile.vault_credits -= total_cost

    awarded: list[Card] = []
    from models import CardAcquisition, TCGPackOpening, TCGPackOpeningCard, TCGPackProduct
    product = db.query(TCGPackProduct).filter(TCGPackProduct.code == "VAULT-PERMANENT").first()
    from sqlalchemy import or_

    # Foundation printings are finite; personally earned Bond and HOF cards
    # join this live pool as soon as they exist and remain eligible forever.
    live_cards = db.query(Card).filter(
        Card.is_legacy.is_(False),
        or_(
            Card.catalog_code == FOUNDATION_CODE,
            Card.card_type.in_((CardType.bond, CardType.hof)),
        ),
    ).order_by(Card.id.asc()).all()

    pullable_by_rarity: dict[str, list[Card]] = {rarity: [] for rarity in PRINT_RARITIES}
    for card in live_cards:
        rarity = earned_card_pack_rarity(card)
        if not rarity:
            continue
        if card.card_type in (CardType.bond, CardType.hof) and not card.print_rarity:
            # Freeze a normalized V2 pull rarity the first time the earned card
            # enters the permanent booster. Its visual remains the earned face.
            card.print_rarity = rarity
        pullable_by_rarity[rarity].append(card)

    for pack_index in range(quantity):
        opening = None
        if product:
            opening = TCGPackOpening(
                product_id=product.id, price_paid=0 if free else cost_per_pack,
                opening_seed=f"vault:{datetime.utcnow().isoformat()}:{pack_index}",
                integrity_json=json.dumps({
                    "pool": FOUNDATION_CODE, "card_count": 10,
                    "guaranteed_slots": ["SR_OR_HIGHER"],
                    "same_printing_twice": False, "owned_cards_eligible": True,
                    "missing_weight": False, "pity": False,
                }),
            )
            db.add(opening)
            db.flush()
        picked_ids: set[int] = set()
        pack_cards: list[Card] = []

        def draw(allowed: tuple[str, ...]) -> Card:
            choices = [
                card for rarity in allowed for card in pullable_by_rarity.get(rarity, [])
                if card.id not in picked_ids
            ]
            if not choices:
                raise ValueError(f"Foundation has no eligible {'/'.join(allowed)} printing")
            card = random.choice(choices)
            picked_ids.add(card.id)
            return card

        # Guaranteed SR-or-better slot, then nine honest weighted slots.
        pack_cards.append(draw(("SR", "UR", "SPR")))
        for _ in range(9):
            roll = random.random()
            wanted = ("SPR",) if roll < 0.002 else (
                ("UR",) if roll < 0.020 else (
                    ("SR",) if roll < 0.120 else (
                        ("R",) if roll < 0.400 else ("C",)
                    )
                )
            )
            # A tiny/new Vault may have no eligible SPR; fall back without
            # fabricating one outside the published checklist.
            try:
                pack_cards.append(draw(wanted))
            except ValueError:
                pack_cards.append(draw(("C", "R", "SR", "UR")))

        for slot_index, card in enumerate(pack_cards):
            from services.physical_cards import grant_card_copy
            try:
                card, _diagnostics = prepare_card_face_for_reveal(db, card)
            except ValueError:
                # Mask preparation is part of the reveal transaction. Do not
                # charge or publish an opening whose static foil face is not
                # ready; the caller can retry against the same catalogue.
                db.rollback()
                raise
            inv = db.query(CardInventory).filter(CardInventory.card_id == card.id).first()
            if opening:
                db.add(TCGPackOpeningCard(
                    opening_id=opening.id, card_id=card.id, slot_index=slot_index,
                    slot_rule="SR_OR_HIGHER" if slot_index == 0 else "weighted",
                    was_owned=bool(inv),
                ))
                acquisition = CardAcquisition(
                    card_id=card.id, quantity=1, acquired_at=datetime.utcnow(),
                    source_type="booster", source_id=product.code,
                    pack_opening_id=opening.id,
                )
                db.add(acquisition)
                db.flush()
                grant_card_copy(db, card.id, acquisition_id=acquisition.id, acquired_at=acquisition.acquired_at)
            else:
                grant_card_copy(db, card.id)
            awarded.append(card)

    from models import CardPack
    db.add(CardPack(cost_credits=total_cost, cards_awarded=json.dumps([card.id for card in awarded])))
    from services.gamification import notify_action
    xp = notify_action(db, "pack_opened", count=quantity, override_amount=75 * quantity)
    db.commit()
    return {
        "cards": [_card_to_dict(db, db.get(Card, card.id)) for card in awarded],
        "pack_size": 10,
        "pack_type": "vault",
        "xp_earned": xp.amount if hasattr(xp, "amount") else 0,
    }

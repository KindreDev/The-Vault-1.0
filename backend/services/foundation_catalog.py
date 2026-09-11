"""Build and acquire the finite TCG V2 Foundation catalogue.

The Foundation catalogue is publication, not ownership: definitions are frozen
once, then booster pulls add inventory for those definitions.  Reopening a pack
never silently creates a second printing for the same source.
"""

from __future__ import annotations

import hashlib
import json
import random
from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import Card, CardInventory, CardRarity, CardType, Creator, Gallery, Image, TCGSettings, TCGSetupState
from services.personal_value import apply_rarity_floor, build_personal_value_context, evaluate_personal_value


FOUNDATION_CODE = "FND-001"
FOUNDATION_LARGE_LIBRARY_TARGET = 60_000
FOUNDATION_SEED = "the-vault-foundation-v1"
PRINT_RARITIES = ("C", "R", "SR", "UR", "SPR")


def _hash_int(*parts) -> int:
    raw = "|".join(str(part) for part in (FOUNDATION_SEED, *parts)).encode("utf-8")
    return int.from_bytes(hashlib.blake2b(raw, digest_size=8).digest(), "big")


def _print_rarity(card_type: str, source_id: int) -> str:
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

    # Only source records that can truthfully populate the accepted V2 faces.
    eligible_images = (
        db.query(Image.id, Image.gallery_id)
        .join(Gallery, Gallery.id == Image.gallery_id)
        .filter(
            Image.file_path.isnot(None),
            Image.width.isnot(None), Image.height.isnot(None),
            Gallery.creator_id.isnot(None),
            Gallery.period_year.isnot(None),
        )
        .order_by(Image.id.asc())
        .all()
    )
    eligible_galleries = (
        db.query(Gallery.id, func.min(Image.id).label("image_id"))
        .join(Image, Image.gallery_id == Gallery.id)
        .filter(
            Gallery.creator_id.isnot(None), Gallery.period_year.isnot(None),
            Image.file_path.isnot(None), Image.width.isnot(None), Image.height.isnot(None),
        )
        .group_by(Gallery.id)
        .order_by(Gallery.id.asc())
        .all()
    )
    eligible_creators = (
        db.query(Creator.id)
        .filter(Creator.creator_type.in_(("cosplayer", "ethot", "artist", "character", "actress", "custom")))
        .order_by(Creator.id.asc())
        .all()
    )

    available = len(eligible_images) + len(eligible_galleries) + len(eligible_creators)
    target = min(FOUNDATION_LARGE_LIBRARY_TARGET, available)
    state.foundation_target = target
    db.commit()
    if target <= 0:
        state.foundation_status = "failed"
        db.commit()
        raise ValueError("No media currently has enough real metadata for a Foundation card")

    rng = random.Random(_hash_int("catalog-order"))
    rng.shuffle(eligible_images)
    rng.shuffle(eligible_galleries)
    rng.shuffle(eligible_creators)

    creator_quota = min(len(eligible_creators), max(1, round(target * 0.02)))
    gallery_quota = min(len(eligible_galleries), max(1, round(target * 0.08)))
    scene_quota = min(len(eligible_images), target - creator_quota - gallery_quota)
    unfilled = target - scene_quota - gallery_quota - creator_quota
    if unfilled > 0:
        extra = min(unfilled, len(eligible_images) - scene_quota)
        scene_quota += extra
        unfilled -= extra
    if unfilled > 0:
        extra = min(unfilled, len(eligible_galleries) - gallery_quota)
        gallery_quota += extra
        unfilled -= extra
    target = scene_quota + gallery_quota + creator_quota
    state.foundation_target = target

    now = datetime.utcnow()
    rows: list[dict] = []
    collector_number = 1
    selected_images = eligible_images[:scene_quota]
    selected_galleries = eligible_galleries[:gallery_quota]
    selected_creators = eligible_creators[:creator_quota]
    settings = db.query(TCGSettings).filter(TCGSettings.id == 1).first()
    personal_context = build_personal_value_context(
        db,
        image_ids=[image_id for image_id, _ in selected_images] + [image_id for _, image_id in selected_galleries],
        gallery_ids=[gallery_id for gallery_id, _ in selected_galleries],
        creator_ids=[creator_id for (creator_id,) in selected_creators],
        ai_confidence_threshold=float(settings.ai_confidence_threshold if settings else 0.72),
    )

    def append_row(card_type: CardType, source_key: int, **source_fields):
        nonlocal collector_number
        base_rarity = _print_rarity(card_type.value, source_key)
        image_id = source_fields.get("source_image_id")
        image = personal_context.images.get(image_id)
        gallery_id = source_fields.get("source_gallery_id") or (image.gallery_id if image else None)
        gallery = personal_context.galleries.get(gallery_id)
        creator_id = source_fields.get("source_creator_id") or (gallery.creator_id if gallery else None)
        creator = personal_context.creators.get(creator_id)
        source_identity = f"{card_type.value}:{source_key}"
        personal_value = evaluate_personal_value(
            source_key=source_identity,
            card_type=card_type.value,
            image=image,
            gallery=gallery,
            creator=creator,
            tags=(personal_context.gallery_tags.get(gallery_id, []) if card_type == CardType.gallery else personal_context.image_tags.get(image_id, [])),
            gallery_view_seconds=personal_context.gallery_view_seconds.get(gallery_id, 0),
        )
        rarity = apply_rarity_floor(base_rarity, personal_value["rarity_floor"])
        mint_audit = {
            **personal_value,
            "source_key": source_identity,
            "base_rarity": base_rarity,
            "published_rarity": rarity,
        }
        rows.append({
            "card_type": card_type,
            "rarity": _legacy_tier(rarity),
            "foil": False,
            "is_relic": False,
            "is_unique": False,
            "cxp": 0,
            "crs": personal_value["score"],
            "rarity_class": rarity,
            "catalog_code": FOUNDATION_CODE,
            "collector_number": collector_number,
            "print_rarity": rarity,
            "parallel_of_id": None,
            "is_legacy": False,
            "generated_at": now,
            "mint_audit_json": json.dumps(mint_audit),
            **source_fields,
        })
        collector_number += 1

    for image_id, _gallery_id in selected_images:
        append_row(CardType.image, image_id, source_image_id=image_id)
    for gallery_id, image_id in selected_galleries:
        append_row(CardType.gallery, gallery_id, source_gallery_id=gallery_id, source_image_id=image_id)
    for (creator_id,) in selected_creators:
        append_row(CardType.creator, creator_id, source_creator_id=creator_id)

    # A failed prior attempt can leave a partial catalogue. Rebuild only the
    # unpublished rows and never duplicate an already completed catalogue.
    db.query(Card).filter(Card.catalog_code == FOUNDATION_CODE).delete(synchronize_session=False)
    db.flush()
    for start in range(0, len(rows), 2_000):
        db.bulk_insert_mappings(Card, rows[start:start + 2_000])
        db.flush()

    # SPR parallels are scarce and only derive from strong UR bases. They do
    # not consume base collector numbers; the parallel keeps its base number.
    ur_cards = db.query(Card).filter(
        Card.catalog_code == FOUNDATION_CODE,
        Card.print_rarity == "UR",
        Card.parallel_of_id.is_(None),
    ).all()
    spr_rows = []
    for base in ur_cards:
        mint_audit = json.loads(base.mint_audit_json or "{}")
        qualifies = bool(mint_audit.get("spr_eligible"))
        if base.source_image_id:
            image = db.query(Image).filter(Image.id == base.source_image_id).first()
            qualifies = bool(image and (
                image.is_favorite or (image.rating or 0) >= 8 or (image.cum_count or 0) >= 6
            ))
        if base.source_creator_id:
            creator = db.query(Creator).filter(Creator.id == base.source_creator_id).first()
            qualifies = qualifies or bool(creator and (
                creator.is_favorite or (creator.companion_bond_level or 0) >= 10
            ))
        if not qualifies:
            continue
        spr_rows.append({
            "card_type": base.card_type,
            "rarity": CardRarity.legendary,
            "foil": False, "is_relic": False, "is_unique": False,
            "source_image_id": base.source_image_id,
            "source_gallery_id": base.source_gallery_id,
            "source_creator_id": base.source_creator_id,
            "linked_character_id": base.linked_character_id,
            "collab_data": base.collab_data,
            "cxp": 0, "crs": 0.0, "rarity_class": "SPR",
            "catalog_code": FOUNDATION_CODE,
            "collector_number": base.collector_number,
            "print_rarity": "SPR",
            "parallel_of_id": base.id,
            "is_legacy": False,
            "generated_at": now,
            "mint_audit_json": json.dumps({
                **mint_audit,
                "published_rarity": "SPR",
                "parallel_of_id": base.id,
            }),
        })
    if spr_rows:
        db.bulk_insert_mappings(Card, spr_rows)

    state.foundation_status = "ready"
    state.foundation_total = len(rows) + len(spr_rows)
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
            query = db.query(Card).filter(
                Card.catalog_code == FOUNDATION_CODE,
                Card.print_rarity.in_(allowed),
            )
            if picked_ids:
                query = query.filter(~Card.id.in_(picked_ids))
            count = query.count()
            if not count:
                raise ValueError(f"Foundation has no eligible {'/'.join(allowed)} printing")
            card = query.offset(random.randrange(count)).first()
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

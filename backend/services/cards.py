"""
TCG Card Generation Engine
Handles all card creation, pack opening, upgrade lottery, variant cap,
and dismantle/regeneration logic.
"""
import json
import math
import random
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from models import (
    Card, CardInventory, CardPack, CardRarity, CardType,
    CraftingMaterials, CreditEvent, Image, Gallery, Creator,
    UserProfile,
)
from config import (
    BASELINE_RARITY, DROP_WEIGHTS, GOON_THRESHOLD, PACK_COST, PACK_SIZE,
    RARITY_ORDER, SHARD_YIELD, UPGRADE_EPIC_CHANCE, UPGRADE_LEGENDARY_CHANCE,
    UPGRADE_RELIC_CHANCE, UPGRADE_CELESTIAL_CHANCE, VARIANT_CAP, ECONOMY, CATALYST_SHARD_COST,
    DISMANTLE_XP, CXP_THRESHOLDS, CXP_EVOLVE_SHARD_COST, CXP_FEED_YIELD,
    FORGE_VARIANT_SHARD_COST, FORGE_VARIANT_CATALYST_COST,
    FEED_CARD_TYPE_MULTIPLIERS, OVERFLOW_CXP_TO_CREDITS_RATE,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _cxp_level_multiplier(db: Session) -> float:
    """Level 50+ grants +1% CXP per level, capped at +50% at level 100."""
    from models import UserProfile
    profile = db.query(UserProfile).first()
    level = profile.level if profile else 1
    if level <= 50:
        return 1.0
    bonus = min(level - 50, 50)
    return 1.0 + bonus * 0.01


def _get_or_create_materials(db: Session) -> CraftingMaterials:
    m = db.query(CraftingMaterials).first()
    if not m:
        m = CraftingMaterials()
        db.add(m)
        db.flush()
    return m


def _get_or_create_profile(db: Session) -> UserProfile:
    from services.gamification import get_or_create_profile
    return get_or_create_profile(db)


def _upgrade_rarity(base: str) -> tuple[str, bool]:
    """Run the upgrade lottery. Returns (final_rarity, is_relic).
    Roll order (cumulative): celestial(0.1%) → relic(0.5%) → legendary(1%) → epic+1(5%) → base.
    """
    roll = random.random()
    if roll < UPGRADE_CELESTIAL_CHANCE:
        return "celestial", True
    if roll < UPGRADE_RELIC_CHANCE:
        return "relic", True
    if roll < UPGRADE_LEGENDARY_CHANCE:
        return "legendary", False
    if roll < UPGRADE_EPIC_CHANCE:
        # +1 tier, capped at epic
        idx = RARITY_ORDER.index(base)
        epic_idx = RARITY_ORDER.index("epic")
        new_idx = min(idx + 1, epic_idx)
        return RARITY_ORDER[new_idx], False
    return base, base == "celestial"


def _add_to_inventory(db: Session, card: Card) -> Card:
    """Add card to user inventory. Gallery/creator/goon cards stack by source identity.
    Returns the canonical card (may differ from input if stacking onto existing)."""
    ct = card.card_type.value if hasattr(card.card_type, "value") else card.card_type

    if ct == "gallery" and card.source_gallery_id:
        existing_inv = (
            db.query(CardInventory)
            .join(Card, CardInventory.card_id == Card.id)
            .filter(
                Card.card_type == CardType.gallery,
                Card.source_gallery_id == card.source_gallery_id,
            )
            .first()
        )
        if existing_inv and existing_inv.card_id != card.id:
            existing_inv.quantity += 1
            db.delete(card)
            db.flush()
            return existing_inv.card

    elif ct == "creator" and card.source_creator_id:
        existing_inv = (
            db.query(CardInventory)
            .join(Card, CardInventory.card_id == Card.id)
            .filter(
                Card.card_type == CardType.creator,
                Card.source_creator_id == card.source_creator_id,
            )
            .first()
        )
        if existing_inv and existing_inv.card_id != card.id:
            existing_inv.quantity += 1
            db.delete(card)
            db.flush()
            return existing_inv.card

    elif ct == "goon" and card.source_image_id:
        # Goon cards stack by source image — same image pulled twice → quantity+1
        existing_inv = (
            db.query(CardInventory)
            .join(Card, CardInventory.card_id == Card.id)
            .filter(
                Card.card_type == CardType.goon,
                Card.source_image_id == card.source_image_id,
            )
            .first()
        )
        if existing_inv and existing_inv.card_id != card.id:
            existing_inv.quantity += 1
            db.delete(card)
            db.flush()
            return existing_inv.card

    # Default: stack by card_id
    existing = db.query(CardInventory).filter(CardInventory.card_id == card.id).first()
    if existing:
        existing.quantity += 1
    else:
        db.add(CardInventory(card_id=card.id, quantity=1))
    db.flush()
    return card


def _award_credits(db: Session, source: str, amount: int):
    """Award Vault Credits and log the event."""
    profile = _get_or_create_profile(db)
    profile.vault_credits = (profile.vault_credits or 0) + amount
    db.add(CreditEvent(source=source, amount=amount))
    db.flush()


# ── Core Generator ────────────────────────────────────────────────────────────

def generate_card(
    db: Session,
    card_type: str,
    source_image_id: Optional[int] = None,
    source_gallery_id: Optional[int] = None,
    source_creator_id: Optional[int] = None,
    linked_character_id: Optional[int] = None,
    skip_lottery: bool = False,
    baseline_override: Optional[str] = None,
    collab_data: Optional[str] = None,
) -> Card:
    """Create a new Card record with rarity lottery applied."""
    base_rarity = baseline_override if baseline_override else BASELINE_RARITY[card_type]
    if skip_lottery:
        final_rarity, is_relic = base_rarity, (base_rarity == "celestial")
    else:
        final_rarity, is_relic = _upgrade_rarity(base_rarity)

    # Gallery and creator are no longer unique — dupes can stack
    is_unique = card_type in ("goon", "variant")

    card = Card(
        card_type=CardType(card_type),
        rarity=CardRarity(final_rarity),
        is_relic=is_relic,
        is_unique=is_unique,
        source_image_id=source_image_id,
        source_gallery_id=source_gallery_id,
        source_creator_id=source_creator_id,
        linked_character_id=linked_character_id,
        collab_data=collab_data,
    )
    db.add(card)
    db.flush()
    return card


# ── Drop pool selectors ───────────────────────────────────────────────────────

def _pick_image_card(db: Session) -> Optional[Card]:
    base_query = db.query(Image).filter(
        Image.cum_count < GOON_THRESHOLD,
        Image.file_path.isnot(None),
    )
    # 70% pure random (discovery), 30% weighted toward viewed/cumed images (engagement)
    if random.random() < 0.70:
        count = base_query.count()
        if not count:
            return None
        img = base_query.offset(random.randint(0, count - 1)).first()
    else:
        engaged = base_query.filter(
            (Image.view_count > 0) | (Image.cum_count > 0)
        ).all()
        if not engaged:
            count = base_query.count()
            img = base_query.offset(random.randint(0, max(0, count - 1))).first()
        else:
            weights = [math.log(i.view_count + i.cum_count + 2) for i in engaged]
            img = random.choices(engaged, weights=weights, k=1)[0]
    if not img:
        return None
    return generate_card(db, "image", source_image_id=img.id)


def _pick_recent_image_card(db: Session) -> Optional[Card]:
    """Pick from the 100 most recently viewed images (last 7 days).
    Falls back to None if the user hasn't viewed anything recently."""
    from datetime import timedelta
    cutoff = datetime.utcnow() - timedelta(days=7)
    recent = (
        db.query(Image)
        .filter(
            Image.last_viewed_at >= cutoff,
            Image.cum_count < GOON_THRESHOLD,
            Image.file_path.isnot(None),
        )
        .order_by(Image.last_viewed_at.desc())
        .limit(100)
        .all()
    )
    if not recent:
        return None
    img = random.choice(recent)
    return generate_card(db, "image", source_image_id=img.id)


def _pick_gallery_card(db: Session) -> Optional[Card]:
    count = db.query(Gallery).count()
    if not count:
        return _pick_image_card(db)

    gal = db.query(Gallery).offset(random.randint(0, count - 1)).first()

    imgs = db.query(Image).filter(Image.gallery_id == gal.id).all()
    img_id = None
    if imgs:
        good_imgs = [i for i in imgs if i.view_count > 5 or i.cum_count > 1]
        img_id = random.choice(good_imgs).id if good_imgs else random.choice(imgs).id

    return generate_card(db, "gallery", source_gallery_id=gal.id, source_image_id=img_id)


def _pick_creator_card(db: Session) -> Optional[Card]:
    query = db.query(Creator).filter(Creator.creator_type != "character")
    count = query.count()
    if not count:
        return _pick_gallery_card(db)

    creator = query.offset(random.randint(0, count - 1)).first()
    return generate_card(db, "creator", source_creator_id=creator.id)


def _pick_goon_card(db: Session) -> Optional[Card]:
    goon_imgs = db.query(Image).filter(Image.cum_count >= GOON_THRESHOLD).all()
    if not goon_imgs:
        return _pick_image_card(db)  # fallback to image card
    img = random.choice(goon_imgs)
    return generate_card(db, "goon", source_image_id=img.id)


def _pick_variant_card(db: Session) -> Optional[Card]:
    """Pick a real creator×character pair linked via Gallery.linked_character_id.
    Only pairs where at least one gallery has BOTH creator_id AND linked_character_id
    set are eligible — no more random cross-products between unrelated entities.
    Hard cap: VARIANT_CAP variants per pair.
    """
    # All distinct (creator_id, character_id) pairs backed by a real gallery link
    pairs = (
        db.query(Gallery.creator_id, Gallery.linked_character_id)
        .filter(
            Gallery.creator_id.isnot(None),
            Gallery.linked_character_id.isnot(None),
        )
        .distinct()
        .all()
    )
    if not pairs:
        return _pick_creator_card(db)

    # Remove pairs at the hard cap
    eligible = []
    for creator_id, character_id in pairs:
        existing = db.query(Card).filter(
            Card.card_type == CardType.variant,
            Card.source_creator_id == creator_id,
            Card.linked_character_id == character_id,
        ).count()
        if existing < VARIANT_CAP:
            eligible.append((creator_id, character_id))

    if not eligible:
        return _pick_creator_card(db)

    creator_id, character_id = random.choice(eligible)

    # Pick art from the intersection image pool
    gals = db.query(Gallery).filter(
        Gallery.creator_id == creator_id,
        Gallery.linked_character_id == character_id,
    ).all()
    all_imgs = []
    for gal in gals:
        all_imgs.extend(db.query(Image).filter(Image.gallery_id == gal.id).all())

    img = random.choice(all_imgs) if all_imgs else None

    return generate_card(
        db, "variant",
        source_image_id=img.id if img else None,
        source_creator_id=creator_id,
        linked_character_id=character_id,
    )


# ── Collab helpers ───────────────────────────────────────────────────────────

def _cosplayer_count(db: Session, gallery_id: int) -> int:
    from models import gallery_creators
    return db.query(Creator).join(
        gallery_creators, gallery_creators.c.creator_id == Creator.id
    ).filter(
        gallery_creators.c.gallery_id == gallery_id,
        Creator.creator_type == "cosplayer",
    ).count()


def _make_collab_gallery_card(db: Session, gal, cosplayers: list) -> Optional[Card]:
    imgs = db.query(Image).filter(Image.gallery_id == gal.id).all()
    img_id = None
    if imgs:
        good = [i for i in imgs if i.view_count > 5 or i.cum_count > 1]
        img_id = random.choice(good).id if good else random.choice(imgs).id

    collab_data = json.dumps({
        "subtype": "gallery",
        "creator_ids":   [c.id   for c in cosplayers],
        "creator_names": [c.name for c in cosplayers],
    })
    return generate_card(
        db, "collab",
        source_gallery_id=gal.id,
        source_image_id=img_id,
        collab_data=collab_data,
        baseline_override="epic",
    )


def _pick_collab_card(db: Session) -> Optional[Card]:
    """Pick a card from a gallery with 2+ cosplayers.
    Subtypes: image (60 %), gallery (25 %), variant (15 %).
    3-way variant is instantly Celestial."""
    from models import gallery_creators
    from sqlalchemy import func as sqlfunc

    # Galleries with 2+ cosplayer creators
    collab_gallery_ids = [
        row[0] for row in
        db.query(gallery_creators.c.gallery_id)
          .join(Creator, Creator.id == gallery_creators.c.creator_id)
          .filter(Creator.creator_type == "cosplayer")
          .group_by(gallery_creators.c.gallery_id)
          .having(sqlfunc.count(gallery_creators.c.creator_id) >= 2)
          .all()
    ]
    if not collab_gallery_ids:
        return _pick_image_card(db)

    gal_id = random.choice(collab_gallery_ids)
    gal = db.query(Gallery).filter(Gallery.id == gal_id).first()
    if not gal:
        return _pick_image_card(db)

    cosplayers = db.query(Creator).join(
        gallery_creators, gallery_creators.c.creator_id == Creator.id
    ).filter(
        gallery_creators.c.gallery_id == gal_id,
        Creator.creator_type == "cosplayer",
    ).all()

    roll = random.random()

    if roll < 0.15:
        # Collab variant
        characters = db.query(Creator).filter(Creator.creator_type == "character").all()
        if not characters:
            return _make_collab_gallery_card(db, gal, cosplayers)

        # 3-way (20 % chance when gallery has 3+ cosplayers) → instantly Celestial
        if len(cosplayers) >= 3 and random.random() < 0.20:
            picked_creators = random.sample(cosplayers, 3)
            picked_chars    = random.choices(characters, k=3)
            instantly_celestial = True
        else:
            picked_creators = random.sample(cosplayers, min(2, len(cosplayers)))
            picked_chars    = random.choices(characters, k=len(picked_creators))
            instantly_celestial = False

        img_count = db.query(Image).filter(Image.gallery_id == gal_id).count()
        img = db.query(Image).filter(Image.gallery_id == gal_id).offset(
            random.randint(0, max(0, img_count - 1))
        ).first() if img_count else None

        collab_data = json.dumps({
            "subtype":          "variant",
            "creator_ids":      [c.id   for c in picked_creators],
            "creator_names":    [c.name for c in picked_creators],
            "character_ids":    [c.id   for c in picked_chars],
            "character_names":  [c.name for c in picked_chars],
        })

        if instantly_celestial:
            return generate_card(
                db, "collab",
                source_image_id=img.id if img else None,
                source_gallery_id=gal_id,
                collab_data=collab_data,
                baseline_override="celestial",
                skip_lottery=True,
            )
        else:
            return generate_card(
                db, "collab",
                source_image_id=img.id if img else None,
                source_gallery_id=gal_id,
                collab_data=collab_data,
                baseline_override="legendary",
            )

    elif roll < 0.40:
        return _make_collab_gallery_card(db, gal, cosplayers)

    else:
        # Collab image card (rare baseline)
        imgs = db.query(Image).filter(Image.gallery_id == gal_id).all()
        img = random.choice(imgs) if imgs else None
        collab_data = json.dumps({
            "subtype":       "image",
            "creator_ids":   [c.id   for c in cosplayers],
            "creator_names": [c.name for c in cosplayers],
        })
        return generate_card(
            db, "collab",
            source_image_id=img.id if img else None,
            source_gallery_id=gal_id,
            collab_data=collab_data,
            baseline_override="rare",
        )


# ── Pack Opening ──────────────────────────────────────────────────────────────

def open_pack(db: Session, pack_type: str = "standard", quantity: int = 1, free: bool = False) -> dict:
    """
    Draw cards from a pack. Pass free=True to skip credit check (inventory packs).
    Raises ValueError if insufficient credits (when free=False).
    """
    profile = _get_or_create_profile(db)

    if not free:
        cost_per_pack = PACK_COST if pack_type == "standard" else 500
        total_cost = cost_per_pack * quantity
        if (profile.vault_credits or 0) < total_cost:
            raise ValueError(f"Insufficient credits: need {total_cost}, have {profile.vault_credits or 0}")
        profile.vault_credits -= total_cost

    # Adjust rates based on pack type
    if pack_type == "premium":
        types   = ["image", "gallery", "creator", "goon", "variant", "collab"]
        weights = [38, 27, 17, 3, 5, 10]  # sums to 100
    else:
        types   = list(DROP_WEIGHTS.keys())
        weights = list(DROP_WEIGHTS.values())

    selectors = {
        "image":   _pick_image_card,
        "gallery": _pick_gallery_card,
        "creator": _pick_creator_card,
        "goon":    _pick_goon_card,
        "variant": _pick_variant_card,
        "collab":  _pick_collab_card,
    }

    cards = []
    raw_cards = []  # collect before inventory so we can apply the floor guarantee
    total_cards_to_draw = PACK_SIZE * quantity

    # One slot per pack is reserved for a recently viewed image (last 7 days).
    # Falls back to a normal image draw if the user has no recent views.
    recent_slots = quantity
    normal_slots = total_cards_to_draw - recent_slots

    for _ in range(normal_slots):
        chosen_type = random.choices(types, weights=weights, k=1)[0]
        card = selectors[chosen_type](db)
        if card:
            raw_cards.append(card)

    for _ in range(recent_slots):
        card = _pick_recent_image_card(db) or _pick_image_card(db)
        if card:
            raw_cards.append(card)

    # Premium pack: guarantee at least 1 rare+ — if none landed rare+, upgrade
    # the first card; all other cards keep their rolled rarity.
    if pack_type == "premium" and raw_cards:
        from config import RARITY_ORDER as _RO
        from models import CardRarity
        floor_idx = _RO.index("rare")
        has_rare_plus = any(
            _RO.index(c.rarity.value if hasattr(c.rarity, "value") else c.rarity) >= floor_idx
            for c in raw_cards
        )
        if not has_rare_plus:
            c0 = raw_cards[0]
            c0.rarity = CardRarity("rare")
            db.flush()

    for card in raw_cards:
        canonical = _add_to_inventory(db, card)
        cards.append(canonical)

    # Log the pack(s)
    pack = CardPack(
        cost_credits=total_cost,
        cards_awarded=json.dumps([c.id for c in cards]),
    )
    db.add(pack)

    # Award XP (multiply by quantity) — notify_action fires quest + achievement hooks
    from services.gamification import notify_action
    xp = notify_action(db, "pack_opened", count=quantity, override_amount=75 * quantity)

    db.commit()

    return {
        "cards": [_card_to_dict(db, c) for c in cards],
        "xp_earned": xp.amount if hasattr(xp, 'amount') else 0,
    }



# ── Dismantle ─────────────────────────────────────────────────────────────────

def dismantle_card(db: Session, inventory_id: int) -> dict:
    """Destroy a card instance. Unique cards trigger regeneration."""
    inv = db.query(CardInventory).filter(CardInventory.id == inventory_id).first()
    if not inv:
        raise ValueError("Inventory entry not found")

    card = inv.card
    rarity_str = card.rarity.value if hasattr(card.rarity, "value") else card.rarity
    shards = SHARD_YIELD.get(rarity_str, 5)

    # Unique cards: regenerate a new card for the pool
    if card.is_unique:
        _regenerate_unique(db, card)

    # Award shards
    materials = _get_or_create_materials(db)
    materials.shards += shards

    # Award XP — notify_action fires quest + achievement hooks
    from services.gamification import notify_action
    xp = notify_action(db, "card_dismantled")

    # Remove from inventory (or decrement)
    if inv.quantity > 1:
        inv.quantity -= 1
    else:
        db.delete(inv)

    db.commit()
    return {"shards_earned": shards, "xp_earned": xp.amount}


def _regenerate_unique(db: Session, old_card: Card):
    """Pick a fresh asset and create a new card to replace the dismantled one."""
    ct = old_card.card_type.value if hasattr(old_card.card_type, "value") else old_card.card_type

    if ct == "creator":
        # Pick a different image as the card face
        creator_id = old_card.source_creator_id
        img = db.query(Image).join(Gallery).filter(
            Gallery.creator_id == creator_id,
            Image.id != old_card.source_image_id,
        ).order_by(Image.id).first()
        new_card = generate_card(db, "creator", source_creator_id=creator_id,
                                  source_image_id=img.id if img else None)

    elif ct == "gallery":
        new_card = generate_card(db, "gallery", source_gallery_id=old_card.source_gallery_id)

    elif ct == "goon":
        goon_imgs = db.query(Image).filter(
            Image.cum_count >= GOON_THRESHOLD,
            Image.id != old_card.source_image_id,
        ).all()
        if goon_imgs:
            img = random.choice(goon_imgs)
            new_card = generate_card(db, "goon", source_image_id=img.id)
        else:
            return  # no alternatives, skip regeneration

    else:
        return  # variant regeneration handled separately

    _add_to_inventory(db, new_card)


# ── Catalyst Token: force-upgrade rarity ──────────────────────────────────────

def apply_catalyst(db: Session, inventory_id: int) -> dict:
    """Consume 1 Catalyst Token to upgrade a card's rarity by one tier."""
    materials = _get_or_create_materials(db)
    if materials.catalyst_tokens < 1:
        raise ValueError("No catalyst tokens available")

    inv = db.query(CardInventory).filter(CardInventory.id == inventory_id).first()
    if not inv:
        raise ValueError("Inventory entry not found")

    card = inv.card
    rarity_str = card.rarity.value if hasattr(card.rarity, "value") else card.rarity
    current_idx = RARITY_ORDER.index(rarity_str)

    if current_idx >= len(RARITY_ORDER) - 1:
        raise ValueError("Card is already at maximum rarity (celestial)")

    new_rarity = RARITY_ORDER[current_idx + 1]
    card.rarity = CardRarity(new_rarity)
    card.is_relic = (new_rarity == "celestial")
    materials.catalyst_tokens -= 1

    db.commit()
    return {"new_rarity": new_rarity, "is_relic": card.is_relic}


# ── CXP: feed duplicate for XP boost ─────────────────────────────────────────

def feed_duplicate(db: Session, inventory_id: int) -> dict:
    """Consume one duplicate copy, awarding CXP to the base card."""
    inv = db.query(CardInventory).filter(CardInventory.id == inventory_id).first()
    if not inv:
        raise ValueError("Inventory entry not found")
    if inv.quantity < 2:
        raise ValueError("No duplicate to feed — quantity must be > 1")

    card = inv.card
    rarity_str = card.rarity.value if hasattr(card.rarity, "value") else card.rarity
    cxp_base = CXP_FEED_YIELD.get(rarity_str, 30)
    cxp_gain = max(1, int(cxp_base * _cxp_level_multiplier(db)))

    inv.quantity -= 1
    card.cxp = (card.cxp or 0) + cxp_gain

    db.commit()
    return {"cxp_gained": cxp_gain, "new_cxp": card.cxp, "quantity": inv.quantity}


# ── CXP: feed any cards (universal) ──────────────────────────────────────────

def feed_cards(db: Session, target_inventory_id: int, source_inventory_ids: list) -> dict:
    """Feed any cards into a target card for CXP. Any rarity, any type.
    Higher rarities yield more CXP; goon cards get 1.5×, variant cards get 2×.
    CXP that overflows the evolution threshold converts to Vault Credits.
    """
    target_inv = db.query(CardInventory).filter(CardInventory.id == target_inventory_id).first()
    if not target_inv:
        raise ValueError("Target card not found")

    if not source_inventory_ids:
        raise ValueError("No source cards provided")

    target_card  = target_inv.card
    rarity_str   = target_card.rarity.value if hasattr(target_card.rarity, "value") else target_card.rarity
    threshold    = CXP_THRESHOLDS.get(rarity_str)  # None for celestial
    level_mult   = _cxp_level_multiplier(db)

    total_cxp_gained      = 0
    total_overflow_credits = 0
    cards_consumed        = 0

    for src_id in source_inventory_ids:
        if src_id == target_inventory_id:
            continue

        src_inv = db.query(CardInventory).filter(CardInventory.id == src_id).first()
        if not src_inv:
            continue

        src_card    = src_inv.card
        src_rarity  = src_card.rarity.value if hasattr(src_card.rarity, "value") else src_card.rarity
        src_type    = src_card.card_type.value if hasattr(src_card.card_type, "value") else src_card.card_type

        cxp_base    = CXP_FEED_YIELD.get(src_rarity, 30)
        type_mult   = FEED_CARD_TYPE_MULTIPLIERS.get(src_type, 1.0)
        cxp_for_card = max(1, int(cxp_base * type_mult * level_mult))

        # Split into what fits under the threshold vs. overflow
        current_cxp = target_card.cxp or 0
        if threshold is not None:
            remaining = max(0, threshold - current_cxp)
            if remaining <= 0:
                apply   = 0
                overflow = cxp_for_card
            elif cxp_for_card > remaining:
                apply    = remaining
                overflow = cxp_for_card - remaining
            else:
                apply    = cxp_for_card
                overflow = 0
        else:
            # Celestial — no evolution possible; everything overflows
            apply    = 0
            overflow = cxp_for_card

        credits_from_overflow = (
            max(1, overflow // OVERFLOW_CXP_TO_CREDITS_RATE) if overflow > 0 else 0
        )

        target_card.cxp = current_cxp + apply
        total_cxp_gained       += apply
        total_overflow_credits += credits_from_overflow

        # Consume the source card (one copy)
        if src_inv.quantity > 1:
            src_inv.quantity -= 1
        else:
            db.delete(src_inv)
            db.flush()

        cards_consumed += 1

    if total_overflow_credits > 0:
        profile = _get_or_create_profile(db)
        profile.vault_credits = (profile.vault_credits or 0) + total_overflow_credits
        event = CreditEvent(source="feed_overflow", amount=total_overflow_credits)
        db.add(event)

    db.commit()

    new_cxp = target_card.cxp or 0
    return {
        "cxp_gained":       total_cxp_gained,
        "new_cxp":          new_cxp,
        "overflow_credits": total_overflow_credits,
        "cards_consumed":   cards_consumed,
        "evolution_ready":  threshold is not None and new_cxp >= threshold,
    }


# ── CXP evolve: spend shards to evolve when at threshold ─────────────────────

def evolve_via_cxp(db: Session, inventory_id: int) -> dict:
    """Evolve a card one rarity tier by spending shards, if CXP threshold is met."""
    inv = db.query(CardInventory).filter(CardInventory.id == inventory_id).first()
    if not inv:
        raise ValueError("Inventory entry not found")

    card = inv.card
    rarity_str = card.rarity.value if hasattr(card.rarity, "value") else card.rarity

    if rarity_str == "celestial":
        raise ValueError("Card is already at maximum rarity")

    threshold = CXP_THRESHOLDS.get(rarity_str)
    if threshold is None:
        raise ValueError("This card cannot evolve via CXP")

    current_cxp = card.cxp or 0
    if current_cxp < threshold:
        raise ValueError(f"Need {threshold} CXP to evolve (have {current_cxp})")

    materials = _get_or_create_materials(db)
    if materials.shards < CXP_EVOLVE_SHARD_COST:
        raise ValueError(f"Not enough shards — need {CXP_EVOLVE_SHARD_COST}, have {materials.shards}")

    materials.shards -= CXP_EVOLVE_SHARD_COST

    current_idx = RARITY_ORDER.index(rarity_str)
    new_rarity = RARITY_ORDER[current_idx + 1]
    card.rarity = CardRarity(new_rarity)
    card.is_relic = (new_rarity == "celestial")

    db.commit()
    return {"new_rarity": new_rarity, "is_relic": card.is_relic, "cxp": card.cxp}


# ── Dismantle duplicates: keep 1 of everything ───────────────────────────────

def dismantle_duplicates(db: Session) -> dict:
    """Dismantle all extra copies of every card, keeping exactly 1 of each."""
    dupes = db.query(CardInventory).filter(CardInventory.quantity > 1).all()
    if not dupes:
        return {"dismantled": 0, "shards_earned": 0, "xp_earned": 0}

    total_shards = 0
    total_count  = 0

    for inv in dupes:
        extras = inv.quantity - 1
        card = inv.card
        rarity_str = card.rarity.value if hasattr(card.rarity, "value") else card.rarity
        total_shards += SHARD_YIELD.get(rarity_str, 5) * extras
        total_count  += extras
        inv.quantity  = 1

    materials = _get_or_create_materials(db)
    materials.shards += total_shards

    from services.gamification import notify_action
    xp = notify_action(db, "card_dismantled", count=total_count, override_amount=DISMANTLE_XP * total_count)

    db.commit()
    return {"dismantled": total_count, "shards_earned": total_shards, "xp_earned": xp.amount}


# ── Fuse: get fuseable cards for a target inventory entry ─────────────────────

def get_fuseable(db: Session, inventory_id: int) -> list:
    """Return inventory items that can be fused into the target card.
    Includes extra copies of the same card AND same-source cards at lower rarity."""
    target_inv = db.query(CardInventory).filter(CardInventory.id == inventory_id).first()
    if not target_inv:
        return []

    target_card = target_inv.card
    target_rarity_str = target_card.rarity.value if hasattr(target_card.rarity, "value") else target_card.rarity
    target_rarity_idx = RARITY_ORDER.index(target_rarity_str)

    results = []

    # Extra copies of the exact same card
    if target_inv.quantity > 1:
        extras = target_inv.quantity - 1
        cxp_per = CXP_FEED_YIELD.get(target_rarity_str, 30)
        results.append({
            "inventory_id":  target_inv.id,
            "is_self_dupe":  True,
            "quantity":      extras,
            "rarity":        target_rarity_str,
            "cxp_per":       cxp_per,
            "total_cxp":     cxp_per * extras,
            "card":          _card_to_dict(db, target_card),
        })

    # Same source, strictly lower rarity
    same_source = []
    if target_card.source_creator_id:
        same_source = (
            db.query(CardInventory)
            .join(Card, CardInventory.card_id == Card.id)
            .filter(
                Card.source_creator_id == target_card.source_creator_id,
                CardInventory.id != inventory_id,
            )
            .all()
        )
    elif target_card.source_gallery_id:
        same_source = (
            db.query(CardInventory)
            .join(Card, CardInventory.card_id == Card.id)
            .filter(
                Card.source_gallery_id == target_card.source_gallery_id,
                CardInventory.id != inventory_id,
            )
            .all()
        )

    for inv in same_source:
        card = inv.card
        rarity_str = card.rarity.value if hasattr(card.rarity, "value") else card.rarity
        if RARITY_ORDER.index(rarity_str) <= target_rarity_idx:
            cxp_per = CXP_FEED_YIELD.get(rarity_str, 30)
            results.append({
                "inventory_id":  inv.id,
                "is_self_dupe":  False,
                "quantity":      inv.quantity,
                "rarity":        rarity_str,
                "cxp_per":       cxp_per,
                "total_cxp":     cxp_per * inv.quantity,
                "card":          _card_to_dict(db, card),
            })

    return results


def fuse_all(db: Session, inventory_id: int) -> dict:
    """Fuse all eligible lower-rarity and dupe cards into this card for CXP."""
    target_inv = db.query(CardInventory).filter(CardInventory.id == inventory_id).first()
    if not target_inv:
        raise ValueError("Target card not found")

    target_card = target_inv.card
    target_rarity_str = target_card.rarity.value if hasattr(target_card.rarity, "value") else target_card.rarity
    target_rarity_idx = RARITY_ORDER.index(target_rarity_str)

    total_cxp = 0
    total_fused = 0

    # Absorb extra copies of same card
    if target_inv.quantity > 1:
        extras = target_inv.quantity - 1
        cxp_per = CXP_FEED_YIELD.get(target_rarity_str, 30)
        total_cxp += cxp_per * extras
        total_fused += extras
        target_inv.quantity = 1

    # Absorb same-source lower-rarity inventory entries
    same_source = []
    if target_card.source_creator_id:
        same_source = (
            db.query(CardInventory)
            .join(Card, CardInventory.card_id == Card.id)
            .filter(
                Card.source_creator_id == target_card.source_creator_id,
                CardInventory.id != inventory_id,
            )
            .all()
        )
    elif target_card.source_gallery_id:
        same_source = (
            db.query(CardInventory)
            .join(Card, CardInventory.card_id == Card.id)
            .filter(
                Card.source_gallery_id == target_card.source_gallery_id,
                CardInventory.id != inventory_id,
            )
            .all()
        )

    for inv in same_source:
        card = inv.card
        rarity_str = card.rarity.value if hasattr(card.rarity, "value") else card.rarity
        if RARITY_ORDER.index(rarity_str) <= target_rarity_idx:
            cxp_per = CXP_FEED_YIELD.get(rarity_str, 30)
            total_cxp += cxp_per * inv.quantity
            total_fused += inv.quantity
            db.delete(inv)

    if total_fused == 0:
        return {"fused_count": 0, "cxp_gained": 0, "new_cxp": target_card.cxp or 0}

    mult = _cxp_level_multiplier(db)
    total_cxp = max(1, int(total_cxp * mult))
    target_card.cxp = (target_card.cxp or 0) + total_cxp
    db.commit()
    return {"fused_count": total_fused, "cxp_gained": total_cxp, "new_cxp": target_card.cxp}


# ── Batch dismantle ───────────────────────────────────────────────────────────

def dismantle_batch(db: Session, inventory_ids: list) -> dict:
    """Dismantle multiple inventory items in one transaction."""
    total_shards = 0
    total_xp     = 0
    processed    = 0

    for inv_id in inventory_ids:
        inv = db.query(CardInventory).filter(CardInventory.id == inv_id).first()
        if not inv:
            continue

        card = inv.card
        rarity_str = card.rarity.value if hasattr(card.rarity, "value") else card.rarity
        shards = SHARD_YIELD.get(rarity_str, 5)
        total_shards += shards
        total_xp     += DISMANTLE_XP
        processed    += 1

        if inv.quantity > 1:
            inv.quantity -= 1
        else:
            db.delete(inv)

    if total_shards:
        materials = _get_or_create_materials(db)
        materials.shards += total_shards

    if total_xp:
        from services.gamification import notify_action
        xp = notify_action(db, "card_dismantled", count=processed, override_amount=total_xp)

    db.commit()
    return {"dismantled": processed, "shards_earned": total_shards, "xp_earned": total_xp}


# ── Craft catalyst from shards ────────────────────────────────────────────────

def craft_catalyst(db: Session) -> dict:
    materials = _get_or_create_materials(db)
    if materials.shards < CATALYST_SHARD_COST:
        raise ValueError(f"Need {CATALYST_SHARD_COST} shards, have {materials.shards}")
    materials.shards -= CATALYST_SHARD_COST
    materials.catalyst_tokens += 1
    db.commit()
    return {"shards": materials.shards, "catalyst_tokens": materials.catalyst_tokens}


# ── Shards → Credits exchange ─────────────────────────────────────────────────

SHARD_EXCHANGE_RATE   = 3    # Vault Credits per shard
SHARD_EXCHANGE_MIN    = 25   # Minimum shards per transaction
SHARD_EXCHANGE_STEP   = 25   # Must be a multiple of this

def shards_to_credits(db: Session, amount: int) -> dict:
    """Exchange shards for Vault Credits at SHARD_EXCHANGE_RATE credits/shard."""
    if amount < SHARD_EXCHANGE_MIN:
        raise ValueError(f"Minimum exchange is {SHARD_EXCHANGE_MIN} shards")
    if amount % SHARD_EXCHANGE_STEP != 0:
        raise ValueError(f"Amount must be a multiple of {SHARD_EXCHANGE_STEP}")
    materials = _get_or_create_materials(db)
    if materials.shards < amount:
        raise ValueError(f"Not enough shards — have {materials.shards}, need {amount}")
    credits_earned = amount * SHARD_EXCHANGE_RATE
    materials.shards -= amount
    profile = _get_or_create_profile(db)
    profile.vault_credits = (profile.vault_credits or 0) + credits_earned
    db.add(CreditEvent(source="shard_exchange", amount=credits_earned))
    db.commit()
    return {
        "shards_spent": amount,
        "credits_earned": credits_earned,
        "shards": materials.shards,
        "vault_credits": profile.vault_credits,
    }


# ── Forge: variant pair discovery + crafting ─────────────────────────────────

def get_variant_pairs(db: Session) -> list:
    """Return all real creator×character pairs eligible for variant forging.
    A pair is valid if at least one gallery links both via creator_id + linked_character_id.
    """
    pairs = (
        db.query(Gallery.creator_id, Gallery.linked_character_id)
        .filter(
            Gallery.creator_id.isnot(None),
            Gallery.linked_character_id.isnot(None),
        )
        .distinct()
        .all()
    )

    results = []
    for creator_id, character_id in pairs:
        creator   = db.query(Creator).filter(Creator.id == creator_id).first()
        character = db.query(Creator).filter(Creator.id == character_id).first()
        if not creator or not character:
            continue

        existing = db.query(Card).filter(
            Card.card_type == CardType.variant,
            Card.source_creator_id == creator_id,
            Card.linked_character_id == character_id,
        ).count()

        gals = db.query(Gallery).filter(
            Gallery.creator_id == creator_id,
            Gallery.linked_character_id == character_id,
        ).all()
        img_count = sum(
            db.query(Image).filter(Image.gallery_id == g.id).count()
            for g in gals
        )

        # Sample thumbnail from pool for preview
        sample_img = None
        for gal in gals:
            sample_img = db.query(Image).filter(
                Image.gallery_id == gal.id,
                Image.thumb_path.isnot(None),
            ).first()
            if sample_img:
                break

        results.append({
            "creator_id":      creator_id,
            "creator_name":    creator.name,
            "creator_type":    creator.creator_type.value if hasattr(creator.creator_type, "value") else creator.creator_type,
            "creator_avatar":  f"/api/creators/{creator_id}/avatar" if creator.avatar_path else None,
            "character_id":    character_id,
            "character_name":  character.name,
            "character_avatar": f"/api/creators/{character_id}/avatar" if character.avatar_path else None,
            "existing_variants": existing,
            "cap":             VARIANT_CAP,
            "at_cap":          existing >= VARIANT_CAP,
            "image_count":     img_count,
            "sample_thumb":    f"/api/images/{sample_img.id}/thumb" if sample_img else None,
        })

    results.sort(key=lambda r: (r["at_cap"], -r["image_count"]))
    return results


def forge_variant(db: Session, creator_id: int, character_id: int) -> dict:
    """Craft a new variant card from a validated creator×character pair.
    Cost: FORGE_VARIANT_SHARD_COST shards + FORGE_VARIANT_CATALYST_COST catalyst tokens.
    """
    # Validate creator
    creator = db.query(Creator).filter(Creator.id == creator_id).first()
    if not creator:
        raise ValueError("Creator not found")
    ct = creator.creator_type.value if hasattr(creator.creator_type, "value") else creator.creator_type
    if ct == "character":
        raise ValueError("First entity must be a creator (not a character type)")

    # Validate character
    character = db.query(Creator).filter(Creator.id == character_id).first()
    if not character:
        raise ValueError("Character not found")
    char_type = character.creator_type.value if hasattr(character.creator_type, "value") else character.creator_type
    if char_type != "character":
        raise ValueError("Second entity must be of character type")

    # Validate gallery link exists
    link = db.query(Gallery).filter(
        Gallery.creator_id == creator_id,
        Gallery.linked_character_id == character_id,
    ).first()
    if not link:
        raise ValueError(
            f"No gallery links {creator.name} and {character.name}. "
            "Open a gallery, assign the creator, then set the linked character."
        )

    # Check cap
    existing = db.query(Card).filter(
        Card.card_type == CardType.variant,
        Card.source_creator_id == creator_id,
        Card.linked_character_id == character_id,
    ).count()
    if existing >= VARIANT_CAP:
        raise ValueError(
            f"Variant cap reached — you already have {VARIANT_CAP} variants for "
            f"{creator.name} × {character.name}"
        )

    # Check materials
    materials = _get_or_create_materials(db)
    if materials.shards < FORGE_VARIANT_SHARD_COST:
        raise ValueError(f"Need {FORGE_VARIANT_SHARD_COST} shards (have {materials.shards})")
    if materials.catalyst_tokens < FORGE_VARIANT_CATALYST_COST:
        raise ValueError(f"Need {FORGE_VARIANT_CATALYST_COST} Catalyst Token (have {materials.catalyst_tokens})")

    # Deduct materials
    materials.shards          -= FORGE_VARIANT_SHARD_COST
    materials.catalyst_tokens -= FORGE_VARIANT_CATALYST_COST

    # Pick art from intersection galleries
    gals = db.query(Gallery).filter(
        Gallery.creator_id == creator_id,
        Gallery.linked_character_id == character_id,
    ).all()
    all_imgs = []
    for gal in gals:
        all_imgs.extend(db.query(Image).filter(Image.gallery_id == gal.id).all())
    img = random.choice(all_imgs) if all_imgs else None

    # Generate + add to inventory
    card = generate_card(
        db, "variant",
        source_image_id=img.id if img else None,
        source_creator_id=creator_id,
        linked_character_id=character_id,
    )
    canonical = _add_to_inventory(db, card)

    from services.gamification import notify_action
    xp = notify_action(db, "pack_opened", override_amount=100)

    db.commit()
    return {
        "card":             _card_to_dict(db, canonical),
        "shards":           materials.shards,
        "catalyst_tokens":  materials.catalyst_tokens,
        "xp_earned":        xp.amount if hasattr(xp, "amount") else 0,
    }


# ── Economy: award credits alongside XP ───────────────────────────────────────

def award_credits_for_action(db: Session, action: str) -> int:
    """Call this whenever an economy action happens to grant Vault Credits.
    Returns the number of credits awarded (0 if none)."""
    reward = ECONOMY.get(action)
    if not reward:
        return 0
    _, credits = reward
    if credits > 0:
        _award_credits(db, action, credits)
        return credits
    return 0


# ── Serialisation helper ──────────────────────────────────────────────────────

def _card_to_dict(db: Session, card: Card) -> dict:
    rarity = card.rarity.value if hasattr(card.rarity, "value") else card.rarity
    ct = card.card_type.value if hasattr(card.card_type, "value") else card.card_type

    # Resolve image URL (full quality)
    image_id = card.source_image_id
    image_url = f"/api/images/{image_id}/file" if image_id else None
    thumb_url = f"/api/images/{image_id}/thumb" if image_id else None

    # Creator info
    creator_name = None
    creator_avatar = None
    creator_type = None
    creator_created_at = None
    if card.source_creator_id:
        c = db.query(Creator).filter(Creator.id == card.source_creator_id).first()
        if c:
            creator_name = c.name
            creator_avatar = f"/api/creators/{c.id}/avatar" if c.avatar_path else None
            creator_type = c.creator_type.value if hasattr(c.creator_type, "value") else c.creator_type
            creator_created_at = c.created_at.isoformat() if c.created_at else None

    # Gallery info
    gallery_name = None
    gallery_cover = None
    period_month = None
    period_year = None
    if card.source_gallery_id:
        g = db.query(Gallery).filter(Gallery.id == card.source_gallery_id).first()
        if g:
            gallery_name = g.name
            gallery_cover = g.cover_thumb
            period_month = g.period_month
            period_year = g.period_year
            # Populate creator_name from the gallery's assigned creators
            # (gallery cards don't have source_creator_id set)
            if creator_name is None:
                if g.creators:
                    creator_name = g.creators[0].name
                elif g.creator_id:
                    from models import Creator as _Cr
                    _c = db.query(_Cr).filter(_Cr.id == g.creator_id).first()
                    if _c:
                        creator_name = _c.name
    # Fallback: look up period AND creator_name through the source image's gallery
    if (period_month is None or creator_name is None) and card.source_image_id:
        img_gal = (
            db.query(Gallery)
            .join(Image, Image.gallery_id == Gallery.id)
            .filter(Image.id == card.source_image_id)
            .first()
        )
        if img_gal:
            period_month = img_gal.period_month
            period_year = img_gal.period_year
            if creator_name is None:
                if img_gal.creators:
                    creator_name = img_gal.creators[0].name
                elif img_gal.creator_id:
                    _c = db.query(Creator).filter(Creator.id == img_gal.creator_id).first()
                    if _c:
                        creator_name = _c.name

    # Character info (variant)
    character_name = None
    if card.linked_character_id:
        ch = db.query(Creator).filter(Creator.id == card.linked_character_id).first()
        if ch:
            character_name = ch.name

    # Focal point (from source image)
    focal_x, focal_y = 0.5, 0.0
    if card.source_image_id:
        src_img = db.query(Image).filter(Image.id == card.source_image_id).first()
        if src_img:
            focal_x = src_img.focal_x if src_img.focal_x is not None else 0.5
            focal_y = src_img.focal_y if src_img.focal_y is not None else 0.0

    # Collab metadata
    collab_info = None
    if card.collab_data:
        try:
            collab_info = json.loads(card.collab_data)
        except Exception:
            collab_info = None

    return {
        "id": card.id,
        "card_type": ct,
        "rarity": rarity,
        "is_relic": card.is_relic,
        "is_unique": card.is_unique,
        "cxp": card.cxp,
        "generated_at": card.generated_at.isoformat() if card.generated_at else None,
        # Art
        "image_url": image_url,
        "thumb_url": thumb_url,
        # Creator
        "creator_name": creator_name,
        "creator_avatar": creator_avatar,
        "creator_type": creator_type,
        "creator_created_at": creator_created_at,
        # Gallery
        "gallery_name": gallery_name,
        "gallery_cover": gallery_cover,
        # Period
        "period_month": period_month,
        "period_year": period_year,
        # Variant character
        "character_name": character_name,
        # Collab
        "collab_data": collab_info,
        # Focal point
        "image_focal_x": focal_x,
        "image_focal_y": focal_y,
        # IDs for linking
        "source_image_id": card.source_image_id,
        "source_gallery_id": card.source_gallery_id,
        "source_creator_id": card.source_creator_id,
        "linked_character_id": card.linked_character_id,
    }

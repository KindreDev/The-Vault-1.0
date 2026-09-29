"""
TCG Card Generation Engine
Handles all card creation, pack opening, upgrade lottery, variant cap,
and dismantle/regeneration logic.
"""
import json
import logging
import math
import os
import random
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session, aliased

from models import (
    Card, CardInventory, CardPack, CardRarity, CardType,
    CraftingMaterials, CreditEvent, Image, Gallery, Creator,
    UserProfile,
)
from config import (
    BASELINE_RARITY, BOND_THRESHOLD, DROP_WEIGHTS, PACK_COST, PACK_SIZE,
    RARITY_ORDER, LEGACY_RARITY_MAP, SHARD_YIELD, HEART_YIELD,
    FOIL_CHANCE, FOIL_CHANCE_PREMIUM, FOIL_SHARD_MULT,
    GALLERY_EPIC_RATING, PREMIUM_RARITY_FLOOR,
    VARIANT_CAP, ECONOMY, CATALYST_SHARD_COST,
    DISMANTLE_XP, LEVEL_CXP_STEP, MAX_CARD_LEVEL, CXP_FEED_YIELD,
    RARITY_SCORE_BASE, RARITY_SCORE_FOIL_MULT, RARITY_SCORE_LEVEL_BONUS,
    FORGE_VARIANT_SHARD_COST, FORGE_VARIANT_CATALYST_COST,
    FEED_CARD_TYPE_MULTIPLIERS, OVERFLOW_CXP_TO_CREDITS_RATE,
    CREDIT_ACTION_DAILY_CAPS,
)
from services.creator_cards import CREATOR_CARD_TYPES, creator_card_eligible_type

logger = logging.getLogger(__name__)


# ── Inventory browsing (search + filters) ─────────────────────────────────────
#
# A card has no name column of its own — what you read on its face is the name of
# the creator, character or gallery it was minted from. So "search" and "filter
# by creator" both resolve down to: which cards belong to which creators?
#
# That is not just source_creator_id. A gallery card carries no creator link at
# all; its creator comes from the gallery's assignment, and a photo card's comes
# from its image's gallery. Matching only the direct FK would silently hide most
# of a creator's cards, so all four paths are covered.

def _galleries_of_creators(creator_ids):
    """Subquery: gallery ids belonging to any of these creators (FK + M2M)."""
    from sqlalchemy import select, union
    from models import gallery_creators
    return union(
        select(Gallery.id).where(Gallery.creator_id.in_(creator_ids)),
        select(gallery_creators.c.gallery_id).where(gallery_creators.c.creator_id.in_(creator_ids)),
    )


def _cards_of_creators(creator_ids):
    """OR-clause matching every card that belongs to any of these creators.

    `creator_ids` is a subquery/select, never a materialised list — a popular
    creator can own tens of thousands of images and we must not build an IN list
    that big.
    """
    from sqlalchemy import or_, select
    gal = _galleries_of_creators(creator_ids)
    return or_(
        Card.source_creator_id.in_(creator_ids),      # creator card
        Card.linked_character_id.in_(creator_ids),    # variant card's character
        Card.source_gallery_id.in_(gal),              # gallery card
        Card.source_image_id.in_(                     # photo / Bond card
            select(Image.id).where(Image.gallery_id.in_(gal))
        ),
    )


def apply_inventory_filters(q, *, card_type=None, rarity=None, rarity_class=None,
                            creator_id=None, search=None, legacy_mode="include"):
    """Apply the collection browser's filters to a CardInventory query joined to Card."""
    from sqlalchemy import or_, select

    if card_type:
        q = q.filter(Card.card_type == card_type)
    if rarity:
        q = q.filter(Card.rarity == rarity)
    # C / R / SR / SPR / UR — scarcity class, a card's percentile within its own
    # tier. Independent of the tier, so the two stack.
    if rarity_class:
        q = q.filter(Card.rarity_class == rarity_class)
    if legacy_mode == "exclude":
        q = q.filter(Card.is_legacy.is_(False))
    elif legacy_mode == "only":
        q = q.filter(Card.is_legacy.is_(True))

    if creator_id:
        q = q.filter(_cards_of_creators(select(Creator.id).where(Creator.id == creator_id)))

    if search and search.strip():
        pattern = f"%{search.strip()}%"
        # Cards whose own linked names match…
        SrcCreator  = aliased(Creator)
        CharCreator = aliased(Creator)
        SrcGallery  = aliased(Gallery)
        q = (q.outerjoin(SrcCreator,  Card.source_creator_id == SrcCreator.id)
              .outerjoin(CharCreator, Card.linked_character_id == CharCreator.id)
              .outerjoin(SrcGallery,  Card.source_gallery_id == SrcGallery.id))
        # …plus every card belonging to a creator whose name matches, which is
        # how a search for her name also returns her gallery and photo cards.
        matching_creators = select(Creator.id).where(Creator.name.ilike(pattern))
        q = q.filter(or_(
            SrcCreator.name.ilike(pattern),
            CharCreator.name.ilike(pattern),
            SrcGallery.name.ilike(pattern),
            _cards_of_creators(matching_creators),
        ))

    return q


def collection_creators(db: Session, legacy_mode: str = "include") -> list:
    """Creators you actually own cards of, with counts — for the collection filter.

    Deliberately not "all creators": a filter listing hundreds of names you have
    no cards for is the navigation problem, not the fix.
    """
    counts = {}
    q = db.query(CardInventory).join(Card)
    if legacy_mode == "exclude":
        q = q.filter(Card.is_legacy.is_(False))
    elif legacy_mode == "only":
        q = q.filter(Card.is_legacy.is_(True))
    invs = q.all()
    # Resolving each card's creator reuses the same rules the card face uses, so
    # the filter list can never disagree with what is printed on the cards.
    creator_of = _card_creator_map(db, [inv.card for inv in invs])
    for inv in invs:
        cid = creator_of.get(inv.card.id)
        if cid:
            counts[cid] = counts.get(cid, 0) + 1

    if not counts:
        return []
    rows = db.query(Creator).filter(Creator.id.in_(list(counts.keys()))).all()
    out = [{
        "id": c.id,
        "name": c.name,
        "creator_type": c.creator_type.value if hasattr(c.creator_type, "value") else c.creator_type,
        "card_count": counts.get(c.id, 0),
    } for c in rows]
    out.sort(key=lambda r: (-r["card_count"], r["name"].lower()))
    return out


def _card_creator_map(db: Session, cards: list) -> dict:
    """card_id -> primary creator id, following the same four paths as the filter."""
    from models import gallery_creators

    gallery_ids = {c.source_gallery_id for c in cards if c.source_gallery_id}
    image_ids   = {c.source_image_id   for c in cards if c.source_image_id}

    # image -> gallery
    img_gal = {}
    if image_ids:
        for iid, gid in db.query(Image.id, Image.gallery_id).filter(Image.id.in_(image_ids)).all():
            if gid:
                img_gal[iid] = gid
                gallery_ids.add(gid)

    # gallery -> creator (FK first, then M2M as fallback)
    gal_creator = {}
    if gallery_ids:
        for gid, cid in db.query(Gallery.id, Gallery.creator_id).filter(Gallery.id.in_(gallery_ids)).all():
            if cid:
                gal_creator[gid] = cid
        for gid, cid in db.query(gallery_creators.c.gallery_id, gallery_creators.c.creator_id)\
                          .filter(gallery_creators.c.gallery_id.in_(gallery_ids)).all():
            gal_creator.setdefault(gid, cid)

    out = {}
    for c in cards:
        cid = c.source_creator_id or c.linked_character_id
        if not cid and c.source_gallery_id:
            cid = gal_creator.get(c.source_gallery_id)
        if not cid and c.source_image_id:
            cid = gal_creator.get(img_gal.get(c.source_image_id))
        if cid:
            out[c.id] = cid
    return out


# ── Helpers ───────────────────────────────────────────────────────────────────

def norm_rarity(rarity) -> str:
    """Normalise a rarity to the live 4-tier system (tolerates legacy strings)."""
    r = rarity.value if hasattr(rarity, "value") else rarity
    return LEGACY_RARITY_MAP.get(r, r)


def card_level(card: Card) -> int:
    """A card's level (1-10), grown via CXP within its fixed rarity."""
    step = LEVEL_CXP_STEP.get(norm_rarity(card.rarity), 100)
    return min(MAX_CARD_LEVEL, 1 + (card.cxp or 0) // step)


def max_cxp(card: Card) -> int:
    """CXP at which the card hits level 10 — feeding beyond this overflows."""
    step = LEVEL_CXP_STEP.get(norm_rarity(card.rarity), 100)
    return step * (MAX_CARD_LEVEL - 1)


def rarity_score(card: Card) -> int:
    """Composite score ranking how special a card is: tier × foil × level."""
    base = RARITY_SCORE_BASE.get(norm_rarity(card.rarity), 10)
    score = base * (RARITY_SCORE_FOIL_MULT if card.foil else 1.0)
    score *= 1 + RARITY_SCORE_LEVEL_BONUS * (card_level(card) - 1)
    return int(round(score))

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


def _roll_foil(pack_type: str = "standard") -> bool:
    """The foil lottery — replaces the old tier-upgrade lottery. Rarity is fixed
    at birth; the chase within every tier is pulling the FOIL version."""
    chance = FOIL_CHANCE_PREMIUM if pack_type == "premium" else FOIL_CHANCE
    return random.random() < chance


def _add_to_inventory(db: Session, card: Card) -> Card:
    """Add card to user inventory. Gallery/creator/Bond cards stack by source identity.
    Returns the canonical card (may differ from input if stacking onto existing)."""
    ct = card.card_type.value if hasattr(card.card_type, "value") else card.card_type

    if ct == "gallery" and card.source_gallery_id:
        from services.physical_cards import grant_card_copy
        existing_inv = (
            db.query(CardInventory)
            .join(Card, CardInventory.card_id == Card.id)
            .filter(
                Card.card_type == CardType.gallery,
                Card.source_gallery_id == card.source_gallery_id,
                Card.is_legacy.is_(False),
            )
            .first()
        )
        if existing_inv and existing_inv.card_id != card.id:
            grant_card_copy(db, existing_inv.card_id)
            db.delete(card)
            db.flush()
            return existing_inv.card

    elif ct == "creator" and card.source_creator_id:
        # Stack by creator AND art — each of her (up to 5) minted arts is its own card
        q = (
            db.query(CardInventory)
            .join(Card, CardInventory.card_id == Card.id)
            .filter(
                Card.card_type == CardType.creator,
                Card.source_creator_id == card.source_creator_id,
                Card.is_legacy.is_(False),
            )
        )
        if card.source_image_id:
            q = q.filter(Card.source_image_id == card.source_image_id)
        else:
            q = q.filter(Card.source_image_id.is_(None))
        existing_inv = q.first()
        if existing_inv and existing_inv.card_id != card.id:
            from services.physical_cards import grant_card_copy
            grant_card_copy(db, existing_inv.card_id)
            db.delete(card)
            db.flush()
            return existing_inv.card

    elif ct == "hof" and card.source_creator_id:
        # HOF mementos stack by creator — pulling hers again is a dupe
        existing_inv = (
            db.query(CardInventory)
            .join(Card, CardInventory.card_id == Card.id)
            .filter(
                Card.card_type == CardType.hof,
                Card.source_creator_id == card.source_creator_id,
                Card.is_legacy.is_(False),
            )
            .first()
        )
        if existing_inv and existing_inv.card_id != card.id:
            from services.physical_cards import grant_card_copy
            grant_card_copy(db, existing_inv.card_id)
            # HOF cards are minted pool records — never delete the mint itself
            db.flush()
            return existing_inv.card

    elif ct == "bond" and card.source_image_id:
        # Bond cards stack by source image — same image earned twice → quantity+1
        existing_inv = (
            db.query(CardInventory)
            .join(Card, CardInventory.card_id == Card.id)
            .filter(
                Card.card_type == CardType.bond,
                Card.source_image_id == card.source_image_id,
                Card.is_legacy.is_(False),
            )
            .first()
        )
        if existing_inv and existing_inv.card_id != card.id:
            from services.physical_cards import grant_card_copy
            grant_card_copy(db, existing_inv.card_id)
            db.delete(card)
            db.flush()
            return existing_inv.card

    # Default: stack by card_id and create a durable physical identity.
    from services.physical_cards import grant_card_copy
    grant_card_copy(db, card.id)
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
    skip_lottery: bool = False,   # kept for call-site compat; rarity no longer rolls
    baseline_override: Optional[str] = None,
    collab_data: Optional[str] = None,
    foil: bool = False,
) -> Card:
    """Create a new Card record. Rarity is FIXED at birth (type baseline or an
    explicit override from a birth rule) — it never changes afterwards. The only
    lottery is the foil roll, decided by the caller (pack opening)."""
    final_rarity = baseline_override if baseline_override else BASELINE_RARITY[card_type]

    if card_type == "creator":
        creator = db.query(Creator).filter(Creator.id == source_creator_id).first()
        if not creator or not creator_card_eligible_type(creator.creator_type):
            raise ValueError("This entity is not eligible for a Creator card; use a cosplayer, e-thot, artist, actress, or Model/Other entity")

    # Gallery and creator are no longer unique — dupes can stack
    is_unique = card_type in ("bond", "variant", "hof")

    card = Card(
        card_type=CardType(card_type),
        rarity=CardRarity(final_rarity),
        foil=foil,
        is_relic=foil,   # legacy mirror — old frontend reads is_relic for the shine
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

def _pick_image_card(db: Session, engaged_bias: bool = False) -> Optional[Card]:
    base_query = db.query(Image).filter(
        Image.cum_count < BOND_THRESHOLD,
        Image.file_path.isnot(None),
    )
    # Default: 70% pure random (discovery), 30% engagement-weighted.
    # Booster packs flip this (engaged_bias) — "your history" is their identity.
    p_random = 0.30 if engaged_bias else 0.70
    if random.random() < p_random:
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
            Image.cum_count < BOND_THRESHOLD,
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

    # Birth rule: a top-rated gallery (≥9 of 10 stars) is born epic
    override = "epic" if (gal.rating or 0) >= GALLERY_EPIC_RATING else None
    return generate_card(db, "gallery", source_gallery_id=gal.id, source_image_id=img_id,
                         baseline_override=override)


def _pick_creator_card(db: Session) -> Optional[Card]:
    query = db.query(Creator).filter(Creator.creator_type.in_(CREATOR_CARD_TYPES))
    count = query.count()
    if not count:
        return _pick_gallery_card(db)

    creator = query.offset(random.randint(0, count - 1)).first()

    # Creator cards mint with fixed art, up to 5 distinct versions per creator:
    # her FIRST card is the signature card — it shows her profile photo (and
    # follows it, like a real player card portrait); mints 2-5 pin a permanent
    # gallery image each. Beyond 5, pulls stack as dupes of existing mints.
    existing = (db.query(Card)
                  .filter(Card.card_type == CardType.creator,
                          Card.source_creator_id == creator.id,
                          Card.is_legacy.is_(False))
                  .all())
    if len(existing) >= 5:
        return random.choice(existing)   # dupe of one of her minted arts

    if not existing:
        # Signature card — profile photo (no pinned image)
        return generate_card(db, "creator", source_creator_id=creator.id,
                             baseline_override=_creator_birth_rarity(creator))

    used_imgs = {c.source_image_id for c in existing if c.source_image_id}
    pool = (db.query(Image)
              .filter(Image.gallery_id.in_(_creator_gallery_ids(db, creator.id) or [-1]),
                      Image.is_video == False,           # noqa: E712
                      ~Image.id.in_(used_imgs or [-1]))
              .all())
    img = random.choice(pool) if pool else None
    if img is None:
        return random.choice(existing)   # no fresh art available — stack instead
    return generate_card(db, "creator", source_creator_id=creator.id,
                         source_image_id=img.id,
                         baseline_override=_creator_birth_rarity(creator))


def _creator_gallery_ids(db: Session, creator_id: int) -> list[int]:
    """All her galleries — direct FK plus the gallery_creators M2M links."""
    from models import gallery_creators
    direct = [g.id for g in db.query(Gallery.id).filter(Gallery.creator_id == creator_id)]
    m2m = [r[0] for r in db.query(gallery_creators.c.gallery_id)
                           .filter(gallery_creators.c.creator_id == creator_id).all()]
    return list(set(direct) | set(m2m))


def _creator_birth_rarity(creator) -> Optional[str]:
    """Birth rule: a My Queen-tier creator (top of the creator rarity ladder)
    mints a CELESTIAL creator card."""
    cr = creator.card_rarity.value if hasattr(creator.card_rarity, "value") else creator.card_rarity
    return "celestial" if cr in ("relic", "celestial") else None


def _top_bond_image_id(db: Session) -> Optional[int]:
    """The single most-gooned image in the vault — its card is born celestial."""
    img = (db.query(Image)
             .filter(Image.cum_count >= BOND_THRESHOLD)
             .order_by(Image.cum_count.desc(), Image.id.asc())
             .first())
    return img.id if img else None


def _pick_bond_card(db: Session) -> Optional[Card]:
    bond_images = db.query(Image).filter(Image.cum_count >= BOND_THRESHOLD).all()
    if not bond_images:
        return _pick_image_card(db)  # fallback to image card
    img = random.choice(bond_images)
    # Birth rule: THE most-gooned image in the vault is a celestial artifact
    override = "celestial" if img.id == _top_bond_image_id(db) else None
    return generate_card(db, "bond", source_image_id=img.id, baseline_override=override)


# ── Hall of Fame cards ────────────────────────────────────────────────────────

def _hof_top_creators(db: Session, limit: int = 5) -> list:
    """Creators currently in the Hall of Fame, best first — same composite score
    as the creators router: view_seconds + cum×120 + sessions×300 + views×5."""
    from sqlalchemy import func as sqlfunc
    from models import gallery_creators, SessionLog

    rows = (db.query(Creator,
                     sqlfunc.sum(Gallery.view_count).label("views"),
                     sqlfunc.sum(Gallery.cum_count).label("cum"))
              .join(gallery_creators, gallery_creators.c.creator_id == Creator.id)
              .join(Gallery, Gallery.id == gallery_creators.c.gallery_id)
              .group_by(Creator.id).all())
    if not rows:
        return []
    ids = [c.id for c, _, _ in rows]
    secs = dict(db.query(gallery_creators.c.creator_id, sqlfunc.sum(Image.view_seconds))
                  .join(Image, Image.gallery_id == gallery_creators.c.gallery_id)
                  .filter(gallery_creators.c.creator_id.in_(ids))
                  .group_by(gallery_creators.c.creator_id).all())
    sess = dict(db.query(SessionLog.creator_id, sqlfunc.count(SessionLog.id))
                  .filter(SessionLog.creator_id.in_(ids))
                  .group_by(SessionLog.creator_id).all())
    scored = sorted(rows, key=lambda r: (
        int(secs.get(r[0].id) or 0) + int(r[2] or 0) * 120 +
        int(sess.get(r[0].id) or 0) * 300 + int(r[1] or 0) * 5
    ), reverse=True)
    return [c for c, _, _ in scored[:limit]]


def mint_hof_cards(db: Session) -> int:
    """Legacy no-op: HOF cards are minted only from a category award record.

    The former top-five shortcut created creator cards without a specific win,
    which made their award category ambiguous. Real wins are minted by crowns.
    """
    return 0


def _pick_hof_card(db: Session) -> Optional[Card]:
    """Draw one of the minted HOF mementos from the pool (mints any missing
    ones first). Falls back to a creator card if none exist yet."""
    mint_hof_cards(db)
    minted = db.query(Card).filter(
        Card.card_type == CardType.hof,
        Card.is_legacy.is_(False),
    ).all()
    if not minted:
        return _pick_creator_card(db)
    return random.choice(minted)


def backfill_creator_card_art(db: Session) -> int:
    """Pin permanent art onto creator cards minted without one — EXCEPT each
    creator's first (oldest) card, which is her signature card and shows the
    live profile photo by design. Idempotent, cheap — runs at every startup."""
    fixed = 0
    orphans = (db.query(Card)
                 .filter(Card.card_type == CardType.creator,
                         Card.print_rarity.is_(None),
                         Card.source_image_id.is_(None),
                         Card.source_creator_id.isnot(None))
                 .order_by(Card.id.asc())
                 .all())
    signature_seen = set()
    for card in orphans:
        # Her oldest card keeps the profile photo (signature card)
        oldest = (db.query(Card.id)
                    .filter(Card.card_type == CardType.creator,
                            Card.source_creator_id == card.source_creator_id)
                    .order_by(Card.id.asc()).first())
        if oldest and oldest[0] == card.id and card.source_creator_id not in signature_seen:
            signature_seen.add(card.source_creator_id)
            continue
        used = {c.source_image_id for c in db.query(Card)
                  .filter(Card.card_type == CardType.creator,
                          Card.source_creator_id == card.source_creator_id,
                          Card.source_image_id.isnot(None)).all()}
        pool = (db.query(Image)
                  .filter(Image.gallery_id.in_(_creator_gallery_ids(db, card.source_creator_id) or [-1]),
                          Image.is_video == False,          # noqa: E712
                          ~Image.id.in_(used or [-1]))
                  .all())
        if pool:
            card.source_image_id = random.choice(pool).id
            fixed += 1
    if fixed:
        db.commit()
    return fixed


def apply_birth_bonuses(db: Session) -> int:
    """Migration refinement: re-apply the birth rules to EXISTING cards so the
    reworked collection matches what the generator would mint today. Promotes
    only (never demotes): 10★ galleries → epic, the #1 goon image → celestial,
    My Queen creators → celestial. Also mints any missing HOF mementos."""
    promoted = 0
    # Top-rated gallery cards → epic
    for card in db.query(Card).filter(Card.card_type == CardType.gallery).all():
        if norm_rarity(card.rarity) == "common" and card.source_gallery_id:
            g = db.query(Gallery).filter(Gallery.id == card.source_gallery_id).first()
            if g and (g.rating or 0) >= GALLERY_EPIC_RATING:
                card.rarity = CardRarity("epic")
                promoted += 1
    # The single most-gooned image → celestial
    top_bond = _top_bond_image_id(db)
    if top_bond:
        for card in db.query(Card).filter(Card.card_type == CardType.bond,
                                          Card.source_image_id == top_bond).all():
            if norm_rarity(card.rarity) != "celestial":
                card.rarity = CardRarity("celestial")
                promoted += 1
    # My Queen creators → celestial
    for card in db.query(Card).filter(Card.card_type == CardType.creator).all():
        if card.source_creator_id and norm_rarity(card.rarity) != "celestial":
            c = db.query(Creator).filter(Creator.id == card.source_creator_id).first()
            if c and _creator_birth_rarity(c) == "celestial":
                card.rarity = CardRarity("celestial")
                promoted += 1
    # Collab VARIANT subtype → legendary (2-way; 3-way mints celestial at birth)
    for card in db.query(Card).filter(Card.card_type == CardType.collab).all():
        if norm_rarity(card.rarity) == "epic" and card.collab_data:
            try:
                if json.loads(card.collab_data).get("subtype") == "variant":
                    card.rarity = CardRarity("legendary")
                    promoted += 1
            except Exception:
                pass
    mint_hof_cards(db)
    db.commit()
    return promoted


# Real-person / real-creator types that can portray a character to form a variant
# (everything except 'character' itself, and 'custom' which is user-defined).
VARIANT_CREATOR_TYPES = ["cosplayer", "ethot", "actress", "artist"]


def _variant_pairs(db: Session) -> list:
    """Return all distinct (creator_id, character_id) pairs eligible for variant
    cards. A creator×character intersection is recorded by tagging a gallery with
    BOTH a real-creator-type creator (cosplayer/ethot/actress/artist) and a
    character-type creator in the gallery_creators M2M — the legacy
    Gallery.creator_id/linked_character_id columns are not used for this."""
    from models import gallery_creators
    cre = gallery_creators.alias("cre")
    chr_ = gallery_creators.alias("chr")
    cre_c = aliased(Creator)
    chr_c = aliased(Creator)
    return (
        db.query(cre.c.creator_id, chr_.c.creator_id)
          .select_from(cre)
          .join(chr_, chr_.c.gallery_id == cre.c.gallery_id)
          .join(cre_c, cre_c.id == cre.c.creator_id)
          .join(chr_c, chr_c.id == chr_.c.creator_id)
          .filter(cre_c.creator_type.in_(VARIANT_CREATOR_TYPES),
                  chr_c.creator_type == "character")
          .distinct()
          .all()
    )


def _images_for_variant_pair(db: Session, creator_id: int, character_id: int) -> list:
    """Return all images from galleries tagged (via the M2M) with BOTH this
    cosplayer and this character."""
    from models import gallery_creators
    cos = gallery_creators.alias("cos")
    chr_ = gallery_creators.alias("chr")
    gal_ids = [
        r[0] for r in
        db.query(cos.c.gallery_id)
          .join(chr_, chr_.c.gallery_id == cos.c.gallery_id)
          .filter(cos.c.creator_id == creator_id, chr_.c.creator_id == character_id)
          .distinct().all()
    ]
    if not gal_ids:
        return []
    return db.query(Image).filter(Image.gallery_id.in_(gal_ids)).all()


def _pick_variant_card(db: Session) -> Optional[Card]:
    """Pick a real creator×character pair from gallery-level links.
    Hard cap: VARIANT_CAP variants per pair.
    """
    pairs = _variant_pairs(db)
    if not pairs:
        return _pick_creator_card(db)

    eligible = [
        (cid, chid) for cid, chid in pairs
        if db.query(Card).filter(
            Card.card_type == CardType.variant,
            Card.source_creator_id == cid,
            Card.linked_character_id == chid,
            Card.is_legacy.is_(False),
        ).count() < VARIANT_CAP
    ]
    if not eligible:
        return _pick_creator_card(db)

    creator_id, character_id = random.choice(eligible)
    all_imgs = _images_for_variant_pair(db, creator_id, character_id)
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
        from models import gallery_creators as _gc
        all_characters = db.query(Creator).filter(Creator.creator_type == "character").all()
        if not all_characters:
            return _make_collab_gallery_card(db, gal, cosplayers)

        def _chars_for_cosplayer(cosplayer):
            """Return characters this cosplayer has actually cosplayed (gallery-level links)."""
            return (
                db.query(Creator)
                .join(Gallery, Gallery.linked_character_id == Creator.id)
                .join(_gc, _gc.c.gallery_id == Gallery.id)
                .filter(_gc.c.creator_id == cosplayer.id)
                .distinct()
                .all()
            )

        def _pick_char(cosplayer):
            pool = _chars_for_cosplayer(cosplayer)
            return random.choice(pool) if pool else None

        # 3-way (20 % chance when gallery has 3+ cosplayers) → instantly Celestial
        if len(cosplayers) >= 3 and random.random() < 0.20:
            picked_creators = random.sample(cosplayers, 3)
            picked_chars    = [_pick_char(c) for c in picked_creators]
            instantly_celestial = True
        else:
            picked_creators = random.sample(cosplayers, min(2, len(cosplayers)))
            picked_chars    = [_pick_char(c) for c in picked_creators]
            instantly_celestial = False

        img_count = db.query(Image).filter(Image.gallery_id == gal_id).count()
        img = db.query(Image).filter(Image.gallery_id == gal_id).offset(
            random.randint(0, max(0, img_count - 1))
        ).first() if img_count else None

        collab_data = json.dumps({
            "subtype":          "variant",
            "creator_ids":      [c.id        for c in picked_creators],
            "creator_names":    [c.name      for c in picked_creators],
            "character_ids":    [c.id   if c else None for c in picked_chars],
            "character_names":  [c.name if c else None for c in picked_chars],
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
            baseline_override="epic",
        )


# ── Pack Opening ──────────────────────────────────────────────────────────────

def open_pack(db: Session, pack_type: str = "standard", quantity: int = 1, free: bool = False) -> dict:
    """
    Draw cards from a pack. Pass free=True to skip credit check (inventory packs).
    Raises ValueError if insufficient credits (when free=False).
    """
    profile = _get_or_create_profile(db)

    total_cost = 0
    if not free:
        from config import PREMIUM_PACK_COST
        cost_per_pack = PACK_COST if pack_type == "standard" else PREMIUM_PACK_COST
        total_cost = cost_per_pack * quantity
        if (profile.vault_credits or 0) < total_cost:
            raise ValueError(f"Insufficient credits: need {total_cost}, have {profile.vault_credits or 0}")
        profile.vault_credits -= total_cost

    # Adjust rates based on pack type
    if pack_type == "premium":
        types   = ["image", "gallery", "creator", "variant", "collab", "hof"]
        weights = [35, 20, 15, 3, 12, 15]  # Bond cards are earned, never pulled
    else:
        types   = list(DROP_WEIGHTS.keys())
        weights = list(DROP_WEIGHTS.values())

    selectors = {
        # Booster identity: image pulls lean into what you've actually engaged with
        "image":   (lambda d: _pick_image_card(d, engaged_bias=True)) if pack_type != "premium"
                   else _pick_image_card,
        "gallery": _pick_gallery_card,
        "creator": _pick_creator_card,
        "variant": _pick_variant_card,
        "collab":  _pick_collab_card,
        "hof":     _pick_hof_card,
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

    # Prestige is CRAFTED, never pulled — no foil lottery on pack opens anymore.
    # (Prestige = the celestial holo treatment, earned by spending duplicates +
    # credits in the forge. See craft_prestige.)

    # Premium pack: guarantee at least 1 epic+ — if none landed, promote the
    # first card to the floor (this is the ONLY post-birth rarity change left).
    if pack_type == "premium" and raw_cards:
        floor_idx = RARITY_ORDER.index(PREMIUM_RARITY_FLOOR)
        if not any(RARITY_ORDER.index(norm_rarity(c.rarity)) >= floor_idx for c in raw_cards):
            raw_cards[0].rarity = CardRarity(PREMIUM_RARITY_FLOOR)
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

    try:
        for card in cards:
            authoritative, _diagnostics = prepare_card_face_for_reveal(db, card)
    except ValueError:
        db.rollback()
        raise

    db.commit()

    # Re-score collection rarity so the new cards get a crs/class and the
    # percentile buckets shift as the collection grows.
    try:
        from services.rarity import compute_rarity
        compute_rarity(db)
    except Exception:
        pass

    return {
        "cards": [_card_to_dict(db, db.get(Card, c.id)) for c in cards],
        "xp_earned": xp.amount if hasattr(xp, 'amount') else 0,
    }



# ── Dismantle ─────────────────────────────────────────────────────────────────

def dismantle_card(db: Session, inventory_id: int) -> dict:
    """Destroy a card instance. Unique cards trigger regeneration."""
    inv = db.query(CardInventory).filter(CardInventory.id == inventory_id).first()
    if not inv:
        raise ValueError("Inventory entry not found")

    card = inv.card
    card_type = card.card_type.value if hasattr(card.card_type, "value") else card.card_type
    if card_type in {"hof", "bond"}:
        raise ValueError("Personally earned Hall of Fame and Bond cards cannot be dismantled")
    rarity_str = norm_rarity(card.rarity)
    shards = SHARD_YIELD.get(rarity_str, 5) * (FOIL_SHARD_MULT if card.foil else 1)
    hearts = HEART_YIELD.get(rarity_str, 0)

    # Unique cards: regenerate a new card for the pool
    if card.is_unique:
        _regenerate_unique(db, card)

    # Award shards
    materials = _get_or_create_materials(db)
    materials.shards += shards

    # Award hearts (rare and above)
    if hearts > 0:
        profile = _get_or_create_profile(db)
        profile.hearts = (profile.hearts or 0) + hearts

    # Award XP — notify_action fires quest + achievement hooks
    from services.gamification import notify_action
    xp = notify_action(db, "card_dismantled")

    # Remove one unplaced physical copy and update the aggregate mirror.
    from services.physical_cards import remove_card_copy
    remove_card_copy(db, card.id)

    db.commit()
    return {"shards_earned": shards, "xp_earned": xp.amount, "hearts_earned": hearts}


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

    elif ct == "bond":
        bond_images = db.query(Image).filter(
            Image.cum_count >= BOND_THRESHOLD,
            Image.id != old_card.source_image_id,
        ).all()
        if bond_images:
            img = random.choice(bond_images)
            new_card = generate_card(db, "bond", source_image_id=img.id)
        else:
            return  # no alternatives, skip regeneration

    else:
        return  # variant regeneration handled separately

    _add_to_inventory(db, new_card)


# ── Catalyst Token: craft a foil ──────────────────────────────────────────────

def apply_catalyst(db: Session, inventory_id: int) -> dict:
    """Consume 1 Catalyst Token to turn a card FOIL. Rarity is fixed at birth —
    the catalyst is now the deterministic path to the premium holo variant."""
    materials = _get_or_create_materials(db)
    if materials.catalyst_tokens < 1:
        raise ValueError("No catalyst tokens available")

    inv = db.query(CardInventory).filter(CardInventory.id == inventory_id).first()
    if not inv:
        raise ValueError("Inventory entry not found")

    card = inv.card
    if card.foil:
        raise ValueError("Card is already foil")
    ct = card.card_type.value if hasattr(card.card_type, "value") else card.card_type
    if ct == "hof":
        raise ValueError("Hall of Fame mementos can't be altered — they are what they are")

    card.foil = True
    card.is_relic = True   # legacy mirror
    materials.catalyst_tokens -= 1

    db.commit()
    return {"foil": True, "rarity": norm_rarity(card.rarity), "is_relic": True}


# ── Prestige: craft the celestial holo treatment from duplicates ──────────────
# Prestige is never pulled from a pack — it is earned by sacrificing duplicate
# copies (scaled by how easy the tier is to farm) plus a flat credit cost. The
# DB still stores it on the `foil` column; "prestige" is just its public name.
PRESTIGE_DUPES   = {"common": 6, "epic": 4, "legendary": 2, "celestial": 1}
PRESTIGE_CREDITS = 1000


def prestige_cost(card: Card) -> dict:
    """How many total copies (incl. the one kept) + credits a Prestige craft needs."""
    return {"dupes": PRESTIGE_DUPES.get(norm_rarity(card.rarity), 6),
            "credits": PRESTIGE_CREDITS}


def craft_prestige(db: Session, inventory_id: int) -> dict:
    """Turn a card Prestige by consuming duplicate copies + credits. Requires
    N total copies for its tier (Core 6 / Epic 4 / Legendary 2 / Celestial 1);
    N-1 are consumed, the survivor becomes Prestige."""
    inv = db.query(CardInventory).filter(CardInventory.id == inventory_id).first()
    if not inv:
        raise ValueError("Inventory entry not found")
    card = inv.card
    if card.foil:
        raise ValueError("Card is already Prestige")

    need = PRESTIGE_DUPES.get(norm_rarity(card.rarity), 6)
    if (inv.quantity or 0) < need:
        raise ValueError(f"Need {need} copies to craft Prestige — you have {inv.quantity or 0}")

    profile = _get_or_create_profile(db)
    if (profile.vault_credits or 0) < PRESTIGE_CREDITS:
        raise ValueError(f"Need {PRESTIGE_CREDITS} credits — you have {profile.vault_credits or 0}")

    profile.vault_credits -= PRESTIGE_CREDITS
    from services.physical_cards import remove_card_copy
    remove_card_copy(db, card.id, count=need - 1, preserve_last=True)
    card.foil = True
    card.is_relic = True                # legacy mirror for old shine paths

    db.commit()
    return {"prestige": True, "rarity": norm_rarity(card.rarity),
            "credits_spent": PRESTIGE_CREDITS, "dupes_spent": need - 1,
            "quantity": inv.quantity}


# ── CXP: feed duplicate for XP boost ─────────────────────────────────────────

def feed_duplicate(db: Session, inventory_id: int) -> dict:
    """Consume one duplicate copy, awarding CXP to the base card."""
    inv = db.query(CardInventory).filter(CardInventory.id == inventory_id).first()
    if not inv:
        raise ValueError("Inventory entry not found")
    if inv.quantity < 2:
        raise ValueError("No duplicate to feed — quantity must be > 1")

    card = inv.card
    cxp_base = CXP_FEED_YIELD.get(norm_rarity(card.rarity), 30)
    cxp_gain = max(1, int(cxp_base * _cxp_level_multiplier(db)))

    from services.physical_cards import remove_card_copy
    remove_card_copy(db, card.id, preserve_last=True)
    card.cxp = (card.cxp or 0) + cxp_gain

    db.commit()
    return {"cxp_gained": cxp_gain, "new_cxp": card.cxp, "quantity": inv.quantity}


# ── CXP: feed any cards (universal) ──────────────────────────────────────────

def feed_cards(db: Session, target_inventory_id: int, source_inventory_ids: list) -> dict:
    """Feed any cards into a target card for CXP. Any rarity, any type.
    Higher rarities yield more CXP; Bond cards get 1.5×, variant cards get 2×.
    CXP that overflows the evolution threshold converts to Vault Credits.
    """
    target_inv = db.query(CardInventory).filter(CardInventory.id == target_inventory_id).first()
    if not target_inv:
        raise ValueError("Target card not found")

    if not source_inventory_ids:
        raise ValueError("No source cards provided")

    target_card  = target_inv.card
    # CXP cap = level 10; feeding beyond it overflows into credits
    threshold    = max_cxp(target_card)
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
        src_rarity  = norm_rarity(src_card.rarity)
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
        from services.physical_cards import remove_card_copy
        remove_card_copy(db, src_card.id)

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


# ── CXP evolve: retired by the rarity rework ─────────────────────────────────

def evolve_via_cxp(db: Session, inventory_id: int) -> dict:
    """Retired: rarity is fixed at birth. CXP now grows the card's LEVEL (1-10)
    automatically — no evolution step needed."""
    raise ValueError(
        "Cards no longer evolve between rarities — CXP levels the card up "
        "automatically (level 1-10 within its tier)."
    )


# ── Dismantle duplicates: keep 1 of everything ───────────────────────────────

def dismantle_duplicates(db: Session) -> dict:
    """Dismantle all extra copies of every card, keeping exactly 1 of each."""
    dupes = db.query(CardInventory).join(Card, Card.id == CardInventory.card_id).filter(
        CardInventory.quantity > 1,
        Card.card_type.notin_([CardType.hof, CardType.bond]),
    ).all()
    if not dupes:
        return {"dismantled": 0, "shards_earned": 0, "hearts_earned": 0, "xp_earned": 0}

    total_shards = 0
    total_hearts = 0
    total_count  = 0

    for inv in dupes:
        extras = inv.quantity - 1
        card = inv.card
        card_type = card.card_type.value if hasattr(card.card_type, "value") else card.card_type
        if card_type in {"hof", "bond"}:
            continue
        rarity_str = norm_rarity(card.rarity)
        foil_mult = FOIL_SHARD_MULT if card.foil else 1
        total_shards += SHARD_YIELD.get(rarity_str, 5) * foil_mult * extras
        total_hearts += HEART_YIELD.get(rarity_str, 0) * extras
        total_count  += extras
        from services.physical_cards import remove_card_copy
        remove_card_copy(db, card.id, count=extras, preserve_last=True)

    materials = _get_or_create_materials(db)
    materials.shards += total_shards

    if total_hearts:
        profile = _get_or_create_profile(db)
        profile.hearts = (profile.hearts or 0) + total_hearts

    from services.gamification import notify_action
    xp = notify_action(db, "card_dismantled", count=total_count, override_amount=DISMANTLE_XP * total_count)

    db.commit()
    return {"dismantled": total_count, "shards_earned": total_shards, "hearts_earned": total_hearts, "xp_earned": xp.amount}


# ── Fuse: get fuseable cards for a target inventory entry ─────────────────────

def get_fuseable(db: Session, inventory_id: int) -> list:
    """Return inventory items that can be fused into the target card.
    Includes extra copies of the same card AND same-source cards at lower rarity."""
    target_inv = db.query(CardInventory).filter(CardInventory.id == inventory_id).first()
    if not target_inv:
        return []

    target_card = target_inv.card
    target_rarity_str = norm_rarity(target_card.rarity)
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
    # Collab cards are image-specific — each one is its own card. The only valid dupe
    # is quantity > 1 on the exact same inventory entry (handled above).
    target_card_type = target_card.card_type.value if hasattr(target_card.card_type, "value") else target_card.card_type
    same_source = []
    if target_card_type == "collab":
        pass
    elif target_card.source_creator_id:
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
        rarity_str = norm_rarity(card.rarity)
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
    target_rarity_str = norm_rarity(target_card.rarity)
    target_rarity_idx = RARITY_ORDER.index(target_rarity_str)

    total_cxp = 0
    total_fused = 0

    # Absorb extra copies of same card
    if target_inv.quantity > 1:
        extras = target_inv.quantity - 1
        cxp_per = CXP_FEED_YIELD.get(target_rarity_str, 30)
        total_cxp += cxp_per * extras
        total_fused += extras
        from services.physical_cards import remove_card_copy
        remove_card_copy(db, target_card.id, count=extras, preserve_last=True)

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
        rarity_str = norm_rarity(card.rarity)
        if RARITY_ORDER.index(rarity_str) <= target_rarity_idx:
            cxp_per = CXP_FEED_YIELD.get(rarity_str, 30)
            total_cxp += cxp_per * inv.quantity
            total_fused += inv.quantity
            from services.physical_cards import remove_card_copy
            remove_card_copy(db, card.id, count=inv.quantity)

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
    total_hearts = 0
    total_xp     = 0
    processed    = 0

    for inv_id in inventory_ids:
        inv = db.query(CardInventory).filter(CardInventory.id == inv_id).first()
        if not inv:
            continue

        card = inv.card
        card_type = card.card_type.value if hasattr(card.card_type, "value") else card.card_type
        if card_type in {"hof", "bond"}:
            continue
        rarity_str = norm_rarity(card.rarity)
        total_shards += SHARD_YIELD.get(rarity_str, 5) * (FOIL_SHARD_MULT if card.foil else 1)
        total_hearts += HEART_YIELD.get(rarity_str, 0)
        total_xp     += DISMANTLE_XP
        processed    += 1

        from services.physical_cards import remove_card_copy
        remove_card_copy(db, card.id)

    if total_shards:
        materials = _get_or_create_materials(db)
        materials.shards += total_shards

    if total_hearts:
        profile = _get_or_create_profile(db)
        profile.hearts = (profile.hearts or 0) + total_hearts

    if total_xp:
        from services.gamification import notify_action
        notify_action(db, "card_dismantled", count=processed, override_amount=total_xp)

    db.commit()
    return {"dismantled": processed, "shards_earned": total_shards, "hearts_earned": total_hearts, "xp_earned": total_xp}


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
    Includes both gallery-level links and image-level links.
    """
    pairs = _variant_pairs(db)

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

        all_imgs  = _images_for_variant_pair(db, creator_id, character_id)
        img_count = len(all_imgs)

        # Sample thumbnail from the pool
        sample_img = next((i for i in all_imgs if i.thumb_path), None)

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

    # Validate the pair links via the gallery_creators M2M (the SAME rule the
    # variant-pair list uses) and grab the candidate art in one shot. The legacy
    # Gallery.creator_id/linked_character_id columns are not the source of truth.
    all_imgs = _images_for_variant_pair(db, creator_id, character_id)
    if not all_imgs:
        raise ValueError(
            f"No gallery links {creator.name} and {character.name}. "
            "Tag a gallery with both the creator and the character, then try again."
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

    # Pick art from the intersection galleries (gathered above via the M2M)
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
        daily_cap = CREDIT_ACTION_DAILY_CAPS.get(action)
        if daily_cap is not None:
            from datetime import datetime, time
            start = datetime.combine(datetime.utcnow().date(), time.min)
            awarded_today = db.query(CreditEvent).filter(
                CreditEvent.source == action,
                CreditEvent.logged_at >= start,
            ).count()
            if awarded_today >= daily_cap:
                return 0
        _award_credits(db, action, credits)
        return credits
    return 0


# ── Serialisation helper ──────────────────────────────────────────────────────

MASKED_RARITIES = {"R", "SR", "SPR", "UR"}


def prepare_card_face_for_reveal(db: Session, card: Card) -> tuple[Card, dict]:
    """Prepare and resolve the same face contract used by collection cards.

    Pack responses must never serialize the pre-mask ORM snapshot. Static
    R+-source cards require a usable packed mask; temporal sources intentionally
    remain flat. Quality failures are allowed as an explicit, diagnosable
    fallback, while generation failures abort the reveal so a broken mask can
    be retried instead of being silently published.
    """
    from services.foundation_catalog import prepare_acquired_visual
    from services.masking import ensure_mask, ensure_scene_mask, is_temporal_source

    card_id = card.id
    authoritative = db.get(Card, card_id)
    if authoritative is None:
        raise ValueError(f"Card {card_id} disappeared before reveal")
    if not prepare_acquired_visual(db, authoritative):
        raise ValueError(f"Card {card_id} face preparation failed")

    source_image = (
        db.query(Image).filter(Image.id == authoritative.source_image_id).first()
        if authoritative.source_image_id else None
    )
    mask_info = None
    if source_image:
        card_type = (
            authoritative.card_type.value
            if hasattr(authoritative.card_type, "value")
            else authoritative.card_type
        )
        try:
            mask_info = (
                ensure_scene_mask(db, source_image, force=False)
                if card_type == CardType.image.value
                else ensure_mask(db, source_image, force=False, upgrade_stale=True)
            )
        except Exception as exc:
            detail = f"{type(exc).__name__}: {exc}"
            raise ValueError(
                f"Card {card_id} mask preparation failed for static source "
                f"{source_image.id}: {detail}"
            ) from exc
        temporal = is_temporal_source(source_image)
        rarity = authoritative.print_rarity or authoritative.rarity_class or "C"
        if (rarity in MASKED_RARITIES and not temporal and mask_info
                and not mask_info.get("usable")
                and mask_info.get("failure_reason") != "quality-below-threshold"):
            detail = mask_info.get("failure_detail") or source_image.mask_failure_reason
            raise ValueError(
                f"Card {card_id} mask preparation failed for static {rarity} source "
                f"{source_image.id}: {detail or 'unknown mask error'}"
            )
        if rarity == "UR" and card_type != CardType.gallery.value \
                and not temporal and mask_info and mask_info.get("usable"):
            from services.foil_maps import ensure_foil_map
            try:
                foil_info = ensure_foil_map(source_image)
            except Exception as exc:
                detail = f"{type(exc).__name__}: {exc}"
                raise ValueError(
                    f"Card {card_id} foil-map preparation failed for static UR source "
                    f"{source_image.id}: {detail}"
                ) from exc
            if not foil_info or not foil_info.get("path"):
                raise ValueError(
                    f"Card {card_id} foil-map preparation failed for static UR source "
                    f"{source_image.id}: no foil-map artifact was produced"
                )

    db.flush()
    # Expire both the card and source image so the response reads committed
    # authoritative state, never the object graph selected before preparation.
    db.expire_all()
    authoritative = db.get(Card, card_id)
    serialized = _card_to_dict(db, authoritative)
    final_rarity = authoritative.print_rarity or authoritative.rarity_class or "C"
    final_card_type = (
        authoritative.card_type.value
        if hasattr(authoritative.card_type, "value")
        else authoritative.card_type
    )
    if (final_rarity == "UR" and final_card_type != CardType.gallery.value
            and mask_info and mask_info.get("usable")
            and not is_temporal_source(db.get(Image, authoritative.source_image_id))
            and not serialized.get("foil_map_url")):
        raise ValueError(
            f"Card {card_id} foil-map preparation failed: the prepared UR face "
            "did not serialize a foil-map URL"
        )
    diagnostics = {
        "mask_status": serialized.get("mask_status"),
        "mask_visual_mode": serialized.get("mask_visual_mode"),
        "mask_failure_reason": serialized.get("mask_failure_reason"),
        "mask_quality": serialized.get("mask_quality"),
        "mask_url": serialized.get("mask_url"),
        "foil_map_url": serialized.get("foil_map_url"),
    }
    return authoritative, diagnostics

def queue_masks_for_cards(card_ids: list):
    """Prepare expensive visual layers for these cards off the request path.

    Fire-and-forget on its own session: the caller has already committed, and a
    failure here must never take down a pack open. Anything that doesn't get a
    mask simply renders with the whole-card holo instead.
    """
    if not card_ids:
        return

    def _work():
        from database import SessionLocal
        db2 = SessionLocal()
        try:
            from services import masking
            # Standalone fictional characters use their own frozen TCG V2
            # recipe. This branch is deliberately strict: creator×character
            # intersections remain Cosplay/legacy variant cards.
            queued_cards = db2.query(Card).filter(Card.id.in_(card_ids)).all()
            foil_image_ids = {
                queued_card.source_image_id
                for queued_card in queued_cards
                if queued_card.source_image_id
                and (queued_card.rarity_class or "C") == "UR"
                and ((queued_card.card_type.value
                      if hasattr(queued_card.card_type, "value")
                      else queued_card.card_type) != "gallery")
            }
            for queued_card in queued_cards:
                queued_type = (
                    queued_card.card_type.value
                    if hasattr(queued_card.card_type, "value") else queued_card.card_type
                )
                if queued_type == "variant":
                    try:
                        from services.cosplay_cards import prepare_cosplay_visual
                        prepare_cosplay_visual(db2, queued_card)
                    except Exception as exc:
                        import logging
                        logging.getLogger(__name__).warning(
                            "cosplay visual preparation failed for card %s: %s",
                            queued_card.id, exc,
                        )
                if queued_type == "collab":
                    try:
                        from services.collab_cards import prepare_collab_visual
                        prepare_collab_visual(db2, queued_card)
                    except Exception as exc:
                        import logging
                        logging.getLogger(__name__).warning(
                            "collab visual preparation failed for card %s: %s",
                            queued_card.id, exc,
                        )
                if queued_type == "creator":
                    try:
                        from services.creator_cards import prepare_creator_visual
                        prepare_creator_visual(db2, queued_card)
                    except Exception as exc:
                        import logging
                        logging.getLogger(__name__).warning(
                            "creator visual preparation failed for card %s: %s",
                            queued_card.id, exc,
                        )
                if queued_type == "gallery":
                    try:
                        from services.gallery_cards import prepare_gallery_visual
                        prepare_gallery_visual(db2, queued_card)
                    except Exception as exc:
                        import logging
                        logging.getLogger(__name__).warning(
                            "gallery visual preparation failed for card %s: %s",
                            queued_card.id, exc,
                        )
                if queued_type == "bond":
                    try:
                        from services.bond_cards import prepare_bond_visual
                        prepare_bond_visual(db2, queued_card)
                    except Exception as exc:
                        import logging
                        logging.getLogger(__name__).warning(
                            "Bond visual preparation failed for card %s: %s",
                            queued_card.id, exc,
                        )
                if queued_type == "hof":
                    try:
                        from services.hof_cards import prepare_hof_visual
                        prepare_hof_visual(db2, queued_card)
                    except Exception as exc:
                        import logging
                        logging.getLogger(__name__).warning(
                            "Hall of Fame visual preparation failed for card %s: %s",
                            queued_card.id, exc,
                        )
                if not queued_card.source_creator_id or queued_card.visual_recipe:
                    continue
                character = db2.query(Creator).filter(
                    Creator.id == queued_card.source_creator_id
                ).first()
                character_type = (
                    character.creator_type.value
                    if character and hasattr(character.creator_type, "value")
                    else (character.creator_type if character else None)
                )
                if character_type == "character":
                    try:
                        from services.character_cards import prepare_character_visual
                        prepare_character_visual(db2, queued_card, character.id)
                    except Exception as exc:
                        # Missing art or a failed model must not prevent the
                        # remaining cards in the pack from being prepared.
                        import logging
                        logging.getLogger(__name__).warning(
                            "character visual preparation failed for card %s: %s",
                            queued_card.id, exc,
                        )

            rows = (db2.query(Card.source_image_id)
                       .filter(Card.id.in_(card_ids),
                               Card.source_image_id.isnot(None)).distinct().all())
            for (img_id,) in rows:
                img = db2.query(Image).filter(Image.id == img_id).first()
                if img:
                    # Cached masks still pass through ensure_mask so older rows
                    # receive the persisted usable/fallback state. This is cheap
                    # (no inference) and makes the mint response deterministic.
                    mask_info = masking.ensure_mask(db2, img)
                    if img_id in foil_image_ids and mask_info and mask_info.get("usable"):
                        from services.foil_maps import ensure_foil_map
                        ensure_foil_map(img)
            db2.commit()
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning("mask queue failed: %s", e)
        finally:
            db2.close()

    import threading
    threading.Thread(target=_work, daemon=True).start()


MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def format_period(month, year) -> Optional[str]:
    """'Mar 2026' from the gallery's period columns."""
    if not year:
        return None
    if month and 1 <= int(month) <= 12:
        return f"{MONTH_NAMES[int(month) - 1]} {int(year)}"
    return str(int(year))


HOF_BOARD_LABEL = {"day": "Daily", "week": "Weekly", "month": "Monthly",
                   "alltime": "All-Time"}


def format_hof_period(period_type, period_key) -> Optional[str]:
    """The date a Hall of Fame card was WON, printed for its board.

    A HOF card is a dated result, so its period has to come from the crown, not
    from the source gallery's month — the photo she won on can be years older
    than the Tuesday she won it.

        day     2026-08-14  ->  '14 Aug 2026'
        week    2026-W33    ->  'Week 33, 2026'
        month   2026-08     ->  'Aug 2026'
        alltime              -> 'All-Time'
    """
    if period_type == "alltime" or not period_key:
        return "All-Time" if period_type == "alltime" else None
    try:
        if period_type == "day":
            y, m, d = (int(x) for x in period_key.split("-"))
            return f"{d} {MONTH_NAMES[m - 1]} {y}"
        if period_type == "week":
            y, w = period_key.split("-W")
            return f"Week {int(w)}, {y}"
        if period_type == "month":
            y, m = (int(x) for x in period_key.split("-"))
            return f"{MONTH_NAMES[m - 1]} {y}"
    except Exception:
        pass
    return period_key


def compose_display_name(card_type, creator_name=None, gallery_name=None,
                         character_name=None, collab_info=None) -> str:
    """The card's printed name — ONE definition, for every renderer.

    The web card composed this inline in VaultCard.jsx, which was fine while the
    web card was the only reader. It no longer is: the Unreal client has to print
    exactly the same string, and a second implementation of these rules in
    another language would drift the first time a rule changed. So the rules live
    here and both clients consume the finished string.

        photo/creator/bond   creator
        gallery              gallery
        variant              "<Cosplayer> as <Character>"
        collab               "<A> & <B>"
        collab (variant)     "<A> & <B> as <X> & <Y>"

    The period is NOT folded in — see `format_period`. Callers that want the long
    form use `display_title`, so a layout can place the date separately.
    """
    if card_type == "collab" and collab_info:
        creators = [n for n in (collab_info.get("creator_names") or []) if n]
        chars = [n for n in (collab_info.get("character_names") or []) if n]
        joined = " & ".join(creators)
        if collab_info.get("subtype") == "variant" and chars:
            return f"{joined} as {' & '.join(chars)}" if joined else " & ".join(chars)
        if joined:
            return joined

    if card_type == "variant" and creator_name and character_name:
        return f"{creator_name} as {character_name}"

    if card_type == "gallery" and gallery_name:
        return gallery_name

    return creator_name or gallery_name or "Unknown"


def _card_to_dict(db: Session, card: Card) -> dict:
    rarity = norm_rarity(card.rarity)
    ct = card.card_type.value if hasattr(card.card_type, "value") else card.card_type
    earned_event = ct in {"hof", "bond"}

    # Resolve image URL (full quality)
    image_id = card.source_image_id
    image_url = f"/api/images/{image_id}/file" if image_id else None
    thumb_url = f"/api/images/{image_id}/thumb" if image_id else None  # fallback; overridden below if thumb_path known

    # Creator info
    creator_name = None
    creator_avatar = None
    creator_type = None
    creator_created_at = None
    c = None
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
    if (period_month is None or creator_name is None or gallery_name is None) and card.source_image_id:
        img_gal = (
            db.query(Gallery)
            .join(Image, Image.gallery_id == Gallery.id)
            .filter(Image.id == card.source_image_id)
            .first()
        )
        if img_gal:
            gallery_name = gallery_name or img_gal.name
            period_month = img_gal.period_month
            period_year = img_gal.period_year
            if creator_name is None:
                if img_gal.creators:
                    source_creator = img_gal.creators[0]
                    creator_name = source_creator.name
                    creator_type = (
                        source_creator.creator_type.value
                        if hasattr(source_creator.creator_type, "value")
                        else source_creator.creator_type
                    )
                elif img_gal.creator_id:
                    _c = db.query(Creator).filter(Creator.id == img_gal.creator_id).first()
                    if _c:
                        creator_name = _c.name
                        creator_type = (
                            _c.creator_type.value
                            if hasattr(_c.creator_type, "value") else _c.creator_type
                        )

    # Character info (variant)
    character_name = None
    if card.linked_character_id:
        ch = db.query(Creator).filter(Creator.id == card.linked_character_id).first()
        if ch:
            character_name = ch.name

    # Focal point (from source image) + resolve static thumb URL to skip per-request DB hits
    focal_x, focal_y = 0.5, 0.0
    mask_url = None
    mask_quality = None
    mask_status = "fallback"
    mask_failure_reason = "mask-not-available"
    mask_pipeline_version = None
    mask_visual_mode = "flat"
    foil_map_url = None
    src_img = None
    if card.source_image_id:
        src_img = db.query(Image).filter(Image.id == card.source_image_id).first()
        if src_img:
            from services.masking import MIN_QUALITY, is_temporal_source
            temporal_source = is_temporal_source(src_img)
            # Foil mask. `mask_url` is None whenever the card must fall back to a
            # whole-card holo: no mask yet, a mask we don't trust, or a video
            # source a still mask can't track.
            mask_quality = src_img.mask_quality
            mask_status = src_img.mask_status or (
                "usable" if (src_img.mask_quality or 0) >= MIN_QUALITY else "fallback"
            )
            mask_failure_reason = src_img.mask_failure_reason
            mask_pipeline_version = src_img.mask_pipeline_version
            mask_visual_mode = src_img.mask_visual_mode or (
                "layered" if mask_status == "usable" else "flat"
            )
            if temporal_source:
                mask_status = "fallback"
                mask_failure_reason = (
                    "video-source" if src_img.is_video else "animated-image-source"
                )
                mask_visual_mode = "flat"
            if (src_img.mask_path and not temporal_source
                    and os.path.exists(src_img.mask_path)):
                if (src_img.mask_quality or 0) >= MIN_QUALITY:
                    version = src_img.mask_pipeline_version or "legacy"
                    mask_url = f"/masks/{os.path.basename(src_img.mask_path)}?v={version}"
            if ct != "gallery" and not temporal_source:
                from services.foil_maps import foil_map_url as resolve_foil_map_url
                foil_map_url = resolve_foil_map_url(src_img.id)
            focal_x = src_img.focal_x if src_img.focal_x is not None else 0.5
            focal_y = src_img.focal_y if src_img.focal_y is not None else 0.0
            # Resolve thumb URL to a direct static path so VaultCard skips the
            # /api/images/{id}/thumb route (which hits the DB for every card).
            if src_img.thumb_path and os.path.exists(src_img.thumb_path):
                thumb_url = f"/thumbs/{os.path.basename(src_img.thumb_path)}"
            # Video-sourced cards: the full-res "image" URL is a video file that
            # can't render as static card art (opens to emptiness). Prefer the
            # short looping animated-webp preview; else fall back to the poster.
            if src_img.is_video:
                image_url = thumb_url
                if src_img.preview_path and os.path.exists(src_img.preview_path):
                    image_url = f"/thumbs/{os.path.basename(src_img.preview_path)}"

    # Collab metadata
    collab_info = None
    if card.collab_data:
        try:
            collab_info = json.loads(card.collab_data)
        except Exception:
            collab_info = None

    # Which Hall of Fame board this card came off, and when it was won. Read
    # from the crown rather than the gallery: the photo she won on can be years
    # older than the day she won it, so the gallery's month is the wrong date.
    hof_board = hof_period_type = hof_period_key = None
    hof_won_at = None
    category_award = None
    if ct == "hof":
        from models import HofCategoryAward, HofCrown
        crown = db.query(HofCrown).filter(HofCrown.card_id == card.id).first()
        category_award = db.query(HofCategoryAward).filter(HofCategoryAward.card_id == card.id).first()
        if crown:
            hof_period_type = crown.period_type
            hof_period_key = crown.period_key
            hof_won_at = crown.won_at.isoformat() if crown.won_at else None
        elif category_award:
            hof_period_type = category_award.period_type
            hof_period_key = category_award.period_key
            hof_won_at = category_award.won_at.isoformat() if category_award.won_at else None
        else:
            # Preserved cards from the original top-five creator memento mint.
            hof_period_type = "alltime"
        hof_board = HOF_BOARD_LABEL.get(hof_period_type)

    # Composed name + period. Gallery and Hall of Fame cards carry the period in
    # their title (a gallery IS a month's shoot, a HOF card IS a dated win);
    # the others would just be noisier for it.
    _display_name = compose_display_name(
        ct, creator_name=creator_name, gallery_name=gallery_name,
        character_name=character_name, collab_info=collab_info)
    if ct == "hof":
        _display_period = format_hof_period(hof_period_type, hof_period_key)
    else:
        _display_period = format_period(period_month, period_year)
    card_type_wants_period = ct in ("gallery", "hof")

    # TCG V2 calls the legacy `image` pull a Scene card. Expose a complete,
    # real-data recipe when the source record contains everything the template
    # prints. Incomplete catalog metadata is reported explicitly; it is never
    # invented just to make a renderer happy.
    scene_visual = None
    if ct == "image":
        missing_scene_data = []
        scene_period = format_period(period_month, period_year)
        if not creator_name:
            missing_scene_data.append("creator_name")
        if not creator_type:
            missing_scene_data.append("creator_type")
        if not gallery_name:
            missing_scene_data.append("subject_name")
        if not scene_period:
            missing_scene_data.append("period")
        if not src_img or not src_img.width or not src_img.height:
            missing_scene_data.append("source_dimensions")

        scene_visual = {
            "card_type": "scene",
            "template_id": "scene-floral-outline-v1",
            "visual_mode": mask_visual_mode,
            "extraction_status": mask_status,
            "fallback_reason": mask_failure_reason,
            "mask_pipeline_version": mask_pipeline_version,
            "upgradeable": mask_visual_mode == "flat",
            "readiness": "ready" if not missing_scene_data else "missing_metadata",
            "missing_metadata": missing_scene_data,
            "recipe": None,
        }
        if not missing_scene_data:
            from services.scene_cards import build_scene_recipe, extract_scene_outline_palette
            try:
                palette_source = (src_img.thumb_path if src_img.thumb_path
                                  and os.path.exists(src_img.thumb_path) else src_img.file_path)
                outline_primary, outline_secondary = extract_scene_outline_palette(palette_source)
            except (OSError, ValueError):
                outline_primary, outline_secondary = "#5DE5FF", "#F7A8D8"
            scene_visual["recipe"] = build_scene_recipe(
                rarity=(card.rarity_class or "C"),
                creator_name=creator_name,
                creator_type=creator_type,
                subject_name=gallery_name,
                period_label=scene_period,
                card_id=f"SCN-{card.id:06d}",
                minted_at=card.generated_at,
                image_id=card.source_image_id,
                source_width=src_img.width,
                source_height=src_img.height,
                focal_x=focal_x,
                focal_y=focal_y,
                outline_primary=outline_primary,
                outline_secondary=outline_secondary,
                mask_metrics={
                    "accepted": mask_visual_mode == "layered",
                    "quality": mask_quality,
                    "reasons": ([mask_failure_reason] if mask_failure_reason else []),
                },
                mask_pipeline_version=mask_pipeline_version,
            )

    # Character recipes are frozen during mint preparation. Serialization only
    # exposes that immutable contract; it never reruns source selection or a
    # masking model while somebody is browsing the collection.
    character_visual = None
    cosplay_visual = None
    collab_visual = None
    creator_visual = None
    gallery_visual = None
    bond_visual = None
    hof_visual = None
    if card.visual_recipe:
        try:
            frozen_visual = json.loads(card.visual_recipe)
        except (TypeError, ValueError):
            frozen_visual = None
        if frozen_visual and frozen_visual.get("schema") == "vault.character-card-recipe":
            frozen_source = frozen_visual.get("source") or {}
            frozen_mode = frozen_visual.get("visualMode") or "full-bleed"
            frozen_art_url = image_url
            if frozen_source.get("kind") == "avatar":
                frozen_character_id = frozen_source.get("characterId")
                frozen_art_url = (
                    f"/api/creators/{frozen_character_id}/avatar"
                    if frozen_character_id else None
                )
            character_visual = {
                "card_type": "character",
                "template_id": frozen_visual.get("templateId"),
                "visual_mode": frozen_mode,
                "readiness": "ready" if frozen_art_url else "source_missing",
                "art_url": frozen_art_url,
                "mask_url": mask_url,
                "recipe": frozen_visual,
            }
        elif frozen_visual and frozen_visual.get("schema") == "vault.cosplay-card-recipe":
            cosplay_visual = {
                "card_type": "cosplay",
                "template_id": frozen_visual.get("templateId"),
                "readiness": "ready" if image_url else "source_missing",
                "art_url": image_url,
                "mask_url": mask_url,
                "recipe": frozen_visual,
            }
        elif frozen_visual and frozen_visual.get("schema") == "vault.collab-card-recipe":
            collab_visual = {
                "card_type": "collab",
                "template_id": frozen_visual.get("templateId"),
                "readiness": "ready" if image_url else "source_missing",
                "art_url": image_url,
                "mask_url": mask_url,
                "recipe": frozen_visual,
            }
        elif frozen_visual and frozen_visual.get("schema") == "vault.creator-card-recipe":
            frozen_source = frozen_visual.get("source") or {}
            frozen_art_url = image_url
            if frozen_source.get("kind") == "avatar":
                frozen_creator_id = frozen_source.get("creatorId")
                frozen_art_url = (
                    f"/api/creators/{frozen_creator_id}/avatar"
                    if frozen_creator_id else None
                )
            creator_visual = {
                "card_type": "creator",
                "template_id": frozen_visual.get("templateId"),
                "readiness": "ready" if frozen_art_url else "source_missing",
                "art_url": frozen_art_url,
                "mask_url": mask_url,
                "recipe": frozen_visual,
            }
        elif frozen_visual and frozen_visual.get("schema") == "vault.gallery-card-recipe":
            stack_art_urls = [
                f"/api/images/{int(source['imageId'])}/file"
                for source in (frozen_visual.get("stackSources") or [])
                if source.get("imageId")
            ]
            gallery_visual = {
                "card_type": "gallery",
                "template_id": frozen_visual.get("templateId"),
                "readiness": "ready" if image_url else "source_missing",
                "art_url": image_url,
                "stack_art_urls": stack_art_urls,
                "mask_url": mask_url,
                "recipe": frozen_visual,
            }
        elif frozen_visual and frozen_visual.get("schema") == "vault.bond-card-recipe":
            bond_visual = {
                "card_type": "bond",
                "template_id": frozen_visual.get("templateId"),
                "readiness": "ready" if image_url else "source_missing",
                "art_url": image_url,
                "mask_url": mask_url,
                "recipe": frozen_visual,
            }
        elif frozen_visual and frozen_visual.get("schema") == "vault.hall-of-fame-card-recipe":
            from services.hof_cards import hof_source_media_type

            frozen_snapshot = frozen_visual.setdefault("snapshot", {})
            if crown:
                frozen_snapshot["awardCategory"] = "creator"
            elif category_award:
                frozen_snapshot["awardCategory"] = category_award.category_type
            else:
                try:
                    mint_evidence = json.loads(card.mint_audit_json or "{}")
                except (TypeError, ValueError):
                    mint_evidence = {}
                frozen_snapshot.setdefault(
                    "awardCategory",
                    "media" if mint_evidence.get("developer_fixture") == "hof-media-ladder-v1" else "legacy",
                )

            frozen_source = frozen_visual.get("source") or {}
            avatar_creator_id = (
                frozen_source.get("creatorId")
                or frozen_visual.get("snapshot", {}).get("creatorId")
                or card.source_creator_id
            )
            # Hall of Fame is allowed one deliberate exception to the normal
            # card-art rule: if the preserved winning source is a video, the
            # HOF face can play that source directly.  Normal cards still use
            # a poster/preview for videos because their SVG faces need static
            # artwork and their masks cannot track moving frames.
            historical_source = src_img
            historical_image_id = frozen_source.get("historicalImageId")
            if historical_image_id and (
                not historical_source or historical_source.id != historical_image_id
            ):
                try:
                    historical_source = db.query(Image).filter(
                        Image.id == int(historical_image_id)
                    ).first() or historical_source
                except (TypeError, ValueError):
                    pass
            live_avatar_available = bool(
                avatar_creator_id and c and c.id == avatar_creator_id
                and c.avatar_path and os.path.isfile(c.avatar_path)
            )
            hof_art_url = image_url
            hof_media_type = "image"
            hof_poster_url = None
            hof_preview_url = None
            historical_media_type = hof_source_media_type(historical_source)
            renderable_hof_video = bool(
                historical_media_type == "video"
                and historical_source.file_path
                and os.path.isfile(historical_source.file_path)
            )
            renderable_hof_gif = bool(
                historical_media_type == "gif"
                and historical_source.file_path
                and os.path.isfile(historical_source.file_path)
            )
            renderable_hof_image = bool(
                src_img and not src_img.is_video and src_img.file_path and os.path.isfile(src_img.file_path)
            )
            hof_readiness = "ready" if renderable_hof_image else "source_missing"
            if renderable_hof_video:
                hof_art_url = f"/api/images/{historical_source.id}/file"
                hof_media_type = "video"
                hof_preview_url = f"/api/images/{historical_source.id}/video-preview"
                if historical_source.thumb_path and os.path.isfile(historical_source.thumb_path):
                    # Derived video posters can be regenerated without changing
                    # the source video. Include the file mtime so the browser
                    # and Collection Room texture capture cannot retain an old
                    # letterboxed poster after that targeted repair.
                    poster_version = int(os.path.getmtime(historical_source.thumb_path))
                    hof_poster_url = f"/thumbs/{os.path.basename(historical_source.thumb_path)}?v={poster_version}"
                hof_readiness = "ready"
            elif frozen_source.get("kind") in {"avatar", "placeholder"}:
                hof_art_url = (
                    f"/api/creators/{avatar_creator_id}/avatar"
                    if live_avatar_available else None
                )
                hof_readiness = "ready" if hof_art_url else "placeholder"
            elif not renderable_hof_image:
                # Old frozen image recipes can outlive their source file. Keep
                # their crown metadata and use the winner's current PFP when it
                # exists, otherwise let the HOF face render its neutral base.
                hof_art_url = (
                    f"/api/creators/{avatar_creator_id}/avatar"
                    if live_avatar_available else None
                )
                hof_readiness = "ready" if hof_art_url else "placeholder"
            if renderable_hof_gif:
                hof_art_url = f"/api/images/{historical_source.id}/file"
                hof_media_type = "gif"
                hof_readiness = "ready"
            hof_visual = {
                "card_type": "hall-of-fame",
                "template_id": frozen_visual.get("templateId"),
                "readiness": hof_readiness,
                "art_url": hof_art_url,
                "media_type": hof_media_type,
                "poster_url": hof_poster_url,
                "preview_url": hof_preview_url,
                "mask_url": mask_url,
                "recipe": frozen_visual,
            }

    return {
        "id": card.id,
        "is_legacy": bool(card.is_legacy),
        "catalog_code": card.catalog_code,
        "collector_number": card.collector_number,
        "print_rarity": card.print_rarity,
        "parallel_of_id": card.parallel_of_id,
        "card_type": ct,
        "acquisition_policy": {
            "is_earned_event": earned_event,
            "tradeable": not earned_event,
            "dismantleable": not earned_event,
            "reason": "Personally earned event card" if earned_event else None,
        },
        "rarity": rarity,
        "foil": bool(card.foil),
        "prestige": bool(card.foil),            # public name for the holo treatment
        "prestige_dupes": PRESTIGE_DUPES.get(rarity, 6),   # copies needed to craft it
        "prestige_credits": PRESTIGE_CREDITS,
        "is_relic": card.is_relic,   # legacy alias of foil — kept for old UI paths
        "is_unique": card.is_unique,
        "cxp": card.cxp,
        "level": card_level(card),
        "level_max": MAX_CARD_LEVEL,
        "cxp_for_next": (None if card_level(card) >= MAX_CARD_LEVEL
                         else LEVEL_CXP_STEP.get(rarity, 100) * card_level(card)),
        "rarity_score": rarity_score(card),
        "crs": round(card.crs or 0, 2),
        "rarity_class": (
            card.print_rarity
            if ct == "hof" and not card.is_legacy and card.print_rarity
            else card.rarity_class or "C"
        ),
        "generated_at": card.generated_at.isoformat() if card.generated_at else None,
        # Art
        "image_url": image_url,
        "thumb_url": thumb_url,
        # Foil mask (R=subject, G=edge band, B=distance field). None => this card
        # gets the whole-card holo instead of a subject/background split.
        "mask_url": mask_url,
        "mask_quality": mask_quality,
        "mask_status": mask_status,
        "mask_failure_reason": mask_failure_reason,
        "mask_pipeline_version": mask_pipeline_version,
        "mask_visual_mode": mask_visual_mode,
        "foil_map_url": foil_map_url,
        # V2 Scene rendering contract. The existing collection UI can ignore
        # this until the complete family of card-type templates is activated.
        "scene_visual": scene_visual,
        "character_visual": character_visual,
        "cosplay_visual": cosplay_visual,
        "collab_visual": collab_visual,
        "creator_visual": creator_visual,
        "gallery_visual": gallery_visual,
        "bond_visual": bond_visual,
        "hof_visual": hof_visual,
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
        # Composed strings — the single source of truth for what a card is
        # CALLED. Any client (web, Unreal) prints these rather than re-deriving
        # them from the components above.
        "display_name": _display_name,
        "display_period": _display_period,
        "display_title": (f"{_display_name}  ·  {_display_period}"
                          if _display_period and card_type_wants_period else _display_name),
        # Hall of Fame board — which of the four this card was won on, and when.
        # `hof_board` is the sub-line the card frame prints under HALL OF FAME.
        "hof_board": hof_board,
        "hof_period_type": hof_period_type,
        "hof_period_key": hof_period_key,
        "hof_won_at": hof_won_at,
        # Focal point
        "image_focal_x": focal_x,
        "image_focal_y": focal_y,
        # IDs for linking
        "source_image_id": card.source_image_id,
        "source_gallery_id": card.source_gallery_id,
        "source_creator_id": card.source_creator_id,
        "linked_character_id": card.linked_character_id,
    }

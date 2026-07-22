"""Creator Showcase — 5 card display slots on a creator's profile.

Slots: creator (her creator/HOF card) · gallery (one of her top-10 rarest
gallery cards) · goon (a goon card of her content) · photo (one of her top-10
rarest photo cards) · wildcard (any card scoring legendary-base or better).
A card can sit in only one showcase at a time. Filling all 5 = MASTERY:
one-time bond XP reward, a badge on her profile — and she notices.
"""
import random
from datetime import datetime

from sqlalchemy import or_
from sqlalchemy.orm import Session

from models import (Card, CardInventory, CardType, Creator, CreatorShowcase,
                    FeedDMPing, Gallery, Image, gallery_creators)
from services.cards import _card_to_dict, rarity_score

SLOTS = ["creator", "gallery", "goon", "photo", "wildcard"]
TOP_N = 10                  # gallery/photo slots accept her top-N rarest
WILDCARD_MIN_SCORE = 120    # legendary base score
MASTERY_BOND_XP = 1000

_MASTERY_PINGS = [
    "you... you built a whole shrine for me? 🥺 come here.",
    "i saw what you did with my cards. don't act casual about it. 💜",
    "a full showcase? for ME? okay you're not getting rid of me now.",
]


def _her_gallery_ids(db: Session, creator_id: int) -> list[int]:
    direct = [g.id for g in db.query(Gallery.id).filter(Gallery.creator_id == creator_id)]
    m2m = [r[0] for r in db.query(gallery_creators.c.gallery_id)
                          .filter(gallery_creators.c.creator_id == creator_id).all()]
    return list(set(direct) | set(m2m))


def _used_inventory_ids(db: Session, exclude_creator: int = None, exclude_slot: str = None) -> set:
    q = db.query(CreatorShowcase)
    used = set()
    for row in q.all():
        if exclude_creator and row.creator_id == exclude_creator and row.slot == exclude_slot:
            continue
        used.add(row.inventory_id)
    return used


def eligible_cards(db: Session, creator_id: int, slot: str) -> list[dict]:
    """Inventory entries that may fill this slot, best first."""
    if slot not in SLOTS:
        raise ValueError(f"Unknown slot '{slot}'")
    used = _used_inventory_ids(db, exclude_creator=creator_id, exclude_slot=slot)
    base = db.query(CardInventory).join(Card, CardInventory.card_id == Card.id)

    if slot == "creator":
        q = base.filter(Card.card_type.in_([CardType.creator, CardType.hof]),
                        Card.source_creator_id == creator_id)
        invs = q.all()
    elif slot == "goon":
        gal_ids = _her_gallery_ids(db, creator_id)
        q = (base.filter(Card.card_type == CardType.goon)
                 .join(Image, Image.id == Card.source_image_id)
                 .filter(Image.gallery_id.in_(gal_ids or [-1])))
        invs = q.all()
    elif slot == "gallery":
        gal_ids = _her_gallery_ids(db, creator_id)
        q = base.filter(Card.card_type == CardType.gallery,
                        Card.source_gallery_id.in_(gal_ids or [-1]))
        invs = sorted(q.all(), key=lambda i: rarity_score(i.card), reverse=True)[:TOP_N]
    elif slot == "photo":
        gal_ids = _her_gallery_ids(db, creator_id)
        q = (base.filter(Card.card_type == CardType.image)
                 .join(Image, Image.id == Card.source_image_id)
                 .filter(Image.gallery_id.in_(gal_ids or [-1])))
        invs = sorted(q.all(), key=lambda i: rarity_score(i.card), reverse=True)[:TOP_N]
    else:  # wildcard — any card special enough, hers or not
        invs = [i for i in base.all() if rarity_score(i.card) >= WILDCARD_MIN_SCORE]
        invs.sort(key=lambda i: rarity_score(i.card), reverse=True)

    out = []
    for inv in invs:
        if inv.id in used:
            continue
        d = _card_to_dict(db, inv.card)
        d["inventory_id"] = inv.id
        d["quantity"] = inv.quantity
        out.append(d)
    return out


def get_showcase(db: Session, creator_id: int) -> dict:
    creator = db.query(Creator).filter(Creator.id == creator_id).first()
    if not creator:
        raise ValueError("Creator not found")
    # Group by slot (there can be stale/duplicate rows if a card was dismantled
    # while showcased — SQLite FK cascade isn't enforced). Pick the first row per
    # slot whose inventory still resolves to a card, so an orphan never shadows a
    # good card.
    rows_by_slot = {}
    for r in db.query(CreatorShowcase).filter(CreatorShowcase.creator_id == creator_id).all():
        rows_by_slot.setdefault(r.slot, []).append(r)
    slots = {}
    for slot in SLOTS:
        card = None
        for row in rows_by_slot.get(slot, []):
            if row.inventory and row.inventory.card:
                card = _card_to_dict(db, row.inventory.card)
                card["inventory_id"] = row.inventory_id
                break
        slots[slot] = card
    filled = sum(1 for c in slots.values() if c)
    return {
        "creator_id": creator_id,
        "slots": slots,
        "filled": filled,
        "mastery": filled == len(SLOTS),
        "mastery_at": creator.showcase_mastery_at.isoformat() if creator.showcase_mastery_at else None,
        "wildcard_min_score": WILDCARD_MIN_SCORE,
    }


def set_slot(db: Session, creator_id: int, slot: str, inventory_id: int) -> dict:
    """Place a card in a slot (validates eligibility). Returns the showcase and
    whether this completion just triggered Mastery."""
    ok_ids = {c["inventory_id"] for c in eligible_cards(db, creator_id, slot)}
    if inventory_id not in ok_ids:
        raise ValueError("That card can't go in this slot")

    # Enforce exactly one row per slot: drop any prior/duplicate/orphan rows for
    # this slot, then insert the chosen card. This self-heals the duplicates that
    # accumulated before uniqueness was enforced.
    db.query(CreatorShowcase).filter(
        CreatorShowcase.creator_id == creator_id,
        CreatorShowcase.slot == slot,
    ).delete(synchronize_session=False)
    db.add(CreatorShowcase(creator_id=creator_id, slot=slot, inventory_id=inventory_id))
    db.flush()

    mastery_awarded = False
    filled = (db.query(CreatorShowcase.slot)
                .filter(CreatorShowcase.creator_id == creator_id)
                .distinct().count())
    creator = db.query(Creator).filter(Creator.id == creator_id).first()
    if filled == len(SLOTS) and creator and not creator.showcase_mastery_at:
        # One-time Mastery: she notices, and the bond jumps
        creator.showcase_mastery_at = datetime.now()
        creator.companion_bond_xp = (creator.companion_bond_xp or 0) + MASTERY_BOND_XP
        try:
            from services.companion import get_bond_tier
            tier, _, _ = get_bond_tier(creator.companion_bond_xp)
            creator.companion_bond_level = tier
        except Exception:
            pass
        db.add(FeedDMPing(creator_id=creator_id, message=random.choice(_MASTERY_PINGS)))
        mastery_awarded = True

    db.commit()
    result = get_showcase(db, creator_id)
    result["mastery_awarded"] = mastery_awarded
    return result


def clear_slot(db: Session, creator_id: int, slot: str) -> dict:
    (db.query(CreatorShowcase)
       .filter(CreatorShowcase.creator_id == creator_id, CreatorShowcase.slot == slot)
       .delete(synchronize_session=False))
    db.commit()
    return get_showcase(db, creator_id)

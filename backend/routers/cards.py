"""
TCG Cards API Router
Endpoints for inventory, pack opening, dismantle, catalyst, forge, and economy balance.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import Optional, List

from database import get_db
from models import Card, CardInventory, CardPack, CraftingMaterials, CreditEvent, UserProfile
import services.cards as card_svc
from pydantic import BaseModel

class OpenPackRequest(BaseModel):
    pack_type: str = "standard"
    quantity: int = 1

class AddCreditsRequest(BaseModel):
    amount: int = 1000

class DismantleBatchRequest(BaseModel):
    inventory_ids: List[int]

class FeedCardsRequest(BaseModel):
    source_ids: List[int]

class ForgeVariantRequest(BaseModel):
    creator_id: int
    character_id: int

router = APIRouter(prefix="/api/cards", tags=["cards"])
economy_router = APIRouter(prefix="/api/economy", tags=["economy"])


# ── Helper ────────────────────────────────────────────────────────────────────

def _inv_to_dict(db: Session, inv: CardInventory) -> dict:
    d = card_svc._card_to_dict(db, inv.card)
    d["inventory_id"] = inv.id
    d["quantity"] = inv.quantity
    return d


# ── Inventory ─────────────────────────────────────────────────────────────────

@router.get("/inventory")
def get_inventory(
    card_type: Optional[str] = None,
    rarity: Optional[str] = None,
    sort: str = "rarity_desc",
    skip: int = 0,
    limit: int = 10000,
    db: Session = Depends(get_db),
):
    q = db.query(CardInventory).join(Card)

    if card_type:
        q = q.filter(Card.card_type == card_type)
    if rarity:
        q = q.filter(Card.rarity == rarity)

    from models import CardRarity
    RARITY_IDX = {r: i for i, r in enumerate(
        ["common", "uncommon", "rare", "epic", "legendary", "relic", "celestial"]
    )}

    invs = q.all()

    def sort_key(inv):
        r = inv.card.rarity.value if hasattr(inv.card.rarity, "value") else inv.card.rarity
        if sort == "rarity_desc":
            return -RARITY_IDX.get(r, 0)
        if sort == "rarity_asc":
            return RARITY_IDX.get(r, 0)
        if sort == "recent":
            return -(inv.card.generated_at.timestamp() if inv.card.generated_at else 0)
        if sort == "cxp":
            return -(inv.card.cxp or 0)
        return 0

    invs.sort(key=sort_key)
    page = invs[skip: skip + limit]

    return {
        "total": len(invs),
        "items": [_inv_to_dict(db, inv) for inv in page],
    }


@router.get("/rarity-distribution")
def card_rarity_distribution(db: Session = Depends(get_db)):
    from sqlalchemy import func
    rows = (
        db.query(Card.rarity, func.sum(CardInventory.quantity).label("count"))
        .join(CardInventory, CardInventory.card_id == Card.id)
        .group_by(Card.rarity)
        .all()
    )
    by_rarity = {}
    for r in rows:
        key = r.rarity.value if hasattr(r.rarity, "value") else (r.rarity or "common")
        by_rarity[key] = int(r.count or 0)
    total = sum(by_rarity.values())
    return {"by_rarity": by_rarity, "total": total}


@router.get("/{card_id}")
def get_card(card_id: int, db: Session = Depends(get_db)):
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(404, "Card not found")
    return card_svc._card_to_dict(db, card)


# ── Pack opening ──────────────────────────────────────────────────────────────

@router.post("/packs/open")
def open_pack(req: OpenPackRequest, db: Session = Depends(get_db)):
    try:
        result = card_svc.open_pack(db, pack_type=req.pack_type, quantity=req.quantity)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return result


@router.post("/packs/open-from-inventory")
def open_pack_from_inventory(req: OpenPackRequest, db: Session = Depends(get_db)):
    """Open packs from quest-awarded inventory (no credit cost)."""
    from models import UserProfile
    profile = db.query(UserProfile).first()
    if not profile:
        raise HTTPException(400, "No profile found")
    if req.pack_type == "premium":
        available = profile.premium_packs or 0
        if available < req.quantity:
            raise HTTPException(400, f"Not enough premium packs (have {available}, need {req.quantity})")
        profile.premium_packs -= req.quantity
    else:
        available = profile.standard_packs or 0
        if available < req.quantity:
            raise HTTPException(400, f"Not enough standard packs (have {available}, need {req.quantity})")
        profile.standard_packs -= req.quantity
    db.commit()
    try:
        result = card_svc.open_pack(db, pack_type=req.pack_type, quantity=req.quantity, free=True)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return result


# ── Dismantle ─────────────────────────────────────────────────────────────────

@router.post("/{inventory_id}/dismantle")
def dismantle_card(inventory_id: int, db: Session = Depends(get_db)):
    try:
        result = card_svc.dismantle_card(db, inventory_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return result


# ── Apply catalyst token ──────────────────────────────────────────────────────

@router.post("/{inventory_id}/apply-catalyst")
def apply_catalyst(inventory_id: int, db: Session = Depends(get_db)):
    try:
        result = card_svc.apply_catalyst(db, inventory_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return result


# ── CXP: feed duplicate ───────────────────────────────────────────────────────

@router.post("/{inventory_id}/feed-duplicate")
def feed_duplicate(inventory_id: int, db: Session = Depends(get_db)):
    try:
        return card_svc.feed_duplicate(db, inventory_id)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── CXP: evolve via threshold + shards ────────────────────────────────────────

@router.post("/{inventory_id}/feed-cards")
def feed_cards(inventory_id: int, req: FeedCardsRequest, db: Session = Depends(get_db)):
    try:
        return card_svc.feed_cards(db, inventory_id, req.source_ids)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/{inventory_id}/evolve-cxp")
def evolve_via_cxp(inventory_id: int, db: Session = Depends(get_db)):
    try:
        return card_svc.evolve_via_cxp(db, inventory_id)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── Batch dismantle ───────────────────────────────────────────────────────────

@router.post("/forge/dismantle-batch")
def dismantle_batch(req: DismantleBatchRequest, db: Session = Depends(get_db)):
    return card_svc.dismantle_batch(db, req.inventory_ids)


# ── Dismantle all duplicates ──────────────────────────────────────────────────

@router.post("/forge/dismantle-duplicates")
def dismantle_duplicates(db: Session = Depends(get_db)):
    return card_svc.dismantle_duplicates(db)


# ── Consolidate goon stack orphans ────────────────────────────────────────────
# One-time fix: goon cards that were created before the stacking fix each got
# their own CardInventory row (quantity=1). This merges them by source_image_id.

@router.post("/forge/consolidate-goon-stacks")
def consolidate_goon_stacks(db: Session = Depends(get_db)):
    from sqlalchemy import func
    from models import Card, CardInventory, CardType as CT
    invs = (
        db.query(CardInventory)
        .join(Card, CardInventory.card_id == Card.id)
        .filter(Card.card_type == CT.goon, Card.source_image_id.isnot(None))
        .all()
    )
    # Group by source_image_id
    groups: dict = {}
    for inv in invs:
        img_id = inv.card.source_image_id
        groups.setdefault(img_id, []).append(inv)

    merged = 0
    for img_id, group in groups.items():
        if len(group) < 2:
            continue
        # Keep the first, merge the rest into it
        canonical = group[0]
        for dup in group[1:]:
            canonical.quantity += dup.quantity
            db.delete(dup.card)   # cascade deletes inventory row
            merged += 1

    db.commit()
    return {"merged_rows": merged}


# ── Fuse: get fuseable + fuse all ────────────────────────────────────────────

@router.get("/{inventory_id}/fuseable")
def get_fuseable(inventory_id: int, db: Session = Depends(get_db)):
    return card_svc.get_fuseable(db, inventory_id)


@router.post("/{inventory_id}/fuse-all")
def fuse_all(inventory_id: int, db: Session = Depends(get_db)):
    try:
        return card_svc.fuse_all(db, inventory_id)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── Forge: materials & crafting ───────────────────────────────────────────────

@router.get("/forge/materials")
def get_materials(db: Session = Depends(get_db)):
    m = db.query(CraftingMaterials).first()
    if not m:
        m = CraftingMaterials()
        db.add(m)
        db.commit()
    return {"shards": m.shards, "catalyst_tokens": m.catalyst_tokens}


@router.post("/forge/craft-catalyst")
def craft_catalyst(db: Session = Depends(get_db)):
    try:
        result = card_svc.craft_catalyst(db)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return result


@router.get("/forge/variant-pairs")
def get_variant_pairs(db: Session = Depends(get_db)):
    """Return all real creator×character pairs available for variant forging."""
    return card_svc.get_variant_pairs(db)


@router.post("/forge/craft-variant")
def craft_variant(req: ForgeVariantRequest, db: Session = Depends(get_db)):
    """Forge a new variant card from a creator×character pair."""
    try:
        return card_svc.forge_variant(db, req.creator_id, req.character_id)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/forge/shards-to-credits")
def shards_to_credits(amount: int, db: Session = Depends(get_db)):
    """Exchange shards for Vault Credits at 3 credits per shard (min 25, step 25)."""
    try:
        result = card_svc.shards_to_credits(db, amount)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return result


# ── Debug: add credits ────────────────────────────────────────────────────────

@economy_router.post("/add-credits")
def add_credits(req: AddCreditsRequest, db: Session = Depends(get_db)):
    profile = db.query(UserProfile).first()
    if not profile:
        raise HTTPException(404, "No profile")
    profile.vault_credits = (profile.vault_credits or 0) + req.amount
    event = CreditEvent(source="debug", amount=req.amount)
    db.add(event)
    db.commit()
    return {"vault_credits": profile.vault_credits, "added": req.amount}


# ── Economy balance ───────────────────────────────────────────────────────────

@economy_router.get("/balance")
def get_balance(db: Session = Depends(get_db)):
    profile = db.query(UserProfile).first()
    credits = profile.vault_credits if profile else 0

    # Recent credit events
    events = db.query(CreditEvent).order_by(desc(CreditEvent.logged_at)).limit(20).all()
    events_out = [
        {"source": e.source, "amount": e.amount, "logged_at": e.logged_at.isoformat()}
        for e in events
    ]

    return {
        "vault_credits": credits,
        "recent_events": events_out,
    }

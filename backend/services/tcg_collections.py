"""Collections: goals that run across the whole card catalogue instead of one
monthly release.

Trait collections: one per starred tag and per "your type" tag. Own 5, 15, 40
and 100 cards whose source file has that trait for growing rewards.

Spice ladders: own one of a creator's cards at every Spice level she has in
the catalogue (at least three levels) for a one-time reward.

A card counts for a trait or Spice through its source file's tags."""
from __future__ import annotations

import copy
import threading
import time
from collections import defaultdict
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from models import Creator, CreditEvent, TCGCollectionAward
from services import tag_insights

TRAIT_TIERS = (5, 15, 40, 100)
TRAIT_REWARDS = ((100, 50), (250, 150), (600, 400), (1500, 1000))   # (xp, credits) per tier
TYPE_MIN_LIFT = 1.8
TYPE_TRAITS = 8
MIN_CONFIDENCE = 0.50
SPICE_ORDER = ("safe", "suggestive", "explicit", "hardcore")
LADDER_MIN_LEVELS = 3
LADDER_REWARD = (500, 300)

# Every catalogue card with its source file, owned or not.
_CATALOGUE = """
    SELECT c.id AS card_id, c.source_image_id AS image_id, c.source_creator_id AS creator_id,
           COALESCE(inv.quantity, 0) > 0 AS owned
    FROM cards c
    LEFT JOIN card_inventory inv ON inv.card_id = c.id
    WHERE c.is_legacy = 0 AND c.source_image_id IS NOT NULL
      AND (c.id IN (SELECT card_id FROM tcg_checklist_entries) OR COALESCE(inv.quantity, 0) > 0)
"""


def _trait_tags(db: Session) -> list[dict]:
    """Starred tags, then the strongest "your type" tags."""
    roles = tag_insights.tag_roles(db)
    starred = [{"id": tid, "name": name.replace("_", " "), "kind": "favorite"} for tid, name in
               db.execute(text("SELECT id, name FROM tags WHERE is_favorite = 1"))
               if (roles.get(tid) or {}).get("use_count")]
    seen = {tag["id"] for tag in starred}
    types = [{"id": row["id"], "name": row["name"].replace("_", " "), "kind": "type", "lift": row["lift"]}
             for row in tag_insights.taste_profile(db)
             if row["lift"] >= TYPE_MIN_LIFT and row["id"] not in seen][:TYPE_TRAITS]
    return starred + types


def _tiers(available: int) -> list[int]:
    tiers = [tier for tier in TRAIT_TIERS if tier <= available]
    return tiers or ([available] if available else [])


def trait_collections(db: Session) -> list[dict]:
    traits = _trait_tags(db)
    if not traits:
        return []
    ids = ",".join(str(int(t["id"])) for t in traits)
    rows = db.execute(text(f"""
        SELECT it.tag_id, COUNT(DISTINCT cat.card_id), COUNT(DISTINCT CASE WHEN cat.owned THEN cat.card_id END)
        FROM ({_CATALOGUE}) cat
        JOIN image_tags it ON it.image_id = cat.image_id
        WHERE it.tag_id IN ({ids}) AND (it.confidence IS NULL OR it.confidence >= :conf)
        GROUP BY it.tag_id"""), {"conf": MIN_CONFIDENCE}).all()
    counts = {tag_id: (available, owned) for tag_id, available, owned in rows}
    claimed = {key for (key,) in db.query(TCGCollectionAward.key).filter(TCGCollectionAward.key.like("trait:%"))}
    out = []
    for trait in traits:
        available, owned = counts.get(trait["id"], (0, 0))
        if not available:
            continue
        tiers = [{"target": target, "reached": owned >= target,
                  "claimed": f"trait:{trait['id']}:{target}" in claimed,
                  "xp": TRAIT_REWARDS[min(i, len(TRAIT_REWARDS) - 1)][0],
                  "credits": TRAIT_REWARDS[min(i, len(TRAIT_REWARDS) - 1)][1]}
                 for i, target in enumerate(_tiers(available))]
        out.append({**trait, "owned": owned, "available": available, "tiers": tiers})
    return out


def spice_ladders(db: Session) -> list[dict]:
    rows = db.execute(text(f"""
        SELECT COALESCE(cat.creator_id, gc.creator_id) AS creator_id, t.name, cat.card_id, cat.owned
        FROM ({_CATALOGUE}) cat
        JOIN images i ON i.id = cat.image_id
        LEFT JOIN gallery_creators gc ON gc.gallery_id = i.gallery_id AND cat.creator_id IS NULL
        JOIN image_tags it ON it.image_id = cat.image_id
        JOIN tags t ON t.id = it.tag_id AND t.name IN ('safe', 'suggestive', 'explicit', 'hardcore')
        WHERE COALESCE(cat.creator_id, gc.creator_id) IS NOT NULL""")).all()
    rungs: dict[int, dict[str, list[int]]] = defaultdict(lambda: {level: [0, 0] for level in SPICE_ORDER})
    seen = set()
    for creator_id, level, card_id, owned in rows:
        if (creator_id, card_id) in seen:
            continue
        seen.add((creator_id, card_id))
        rungs[creator_id][level][0] += 1
        if owned:
            rungs[creator_id][level][1] += 1
    started = {cid: levels for cid, levels in rungs.items()
               if sum(1 for available, _ in levels.values() if available) >= LADDER_MIN_LEVELS
               and any(owned for _, owned in levels.values())}
    if not started:
        return []
    creators = {c.id: c for c in db.query(Creator).filter(Creator.id.in_(list(started))).all()}
    claimed = {key for (key,) in db.query(TCGCollectionAward.key).filter(TCGCollectionAward.key.like("ladder:%"))}
    out = []
    for creator_id, levels in started.items():
        creator = creators.get(creator_id)
        if not creator:
            continue
        steps = [{"level": level, "available": levels[level][0], "owned": levels[level][1]} for level in SPICE_ORDER]
        needed = [step for step in steps if step["available"]]
        done = sum(1 for step in needed if step["owned"])
        out.append({
            "creator_id": creator_id, "name": creator.name,
            "avatar": f"/api/creators/{creator.id}/avatar" if creator.avatar_path else None,
            "steps": steps, "done": done, "needed": len(needed), "complete": done == len(needed),
            "claimed": f"ladder:{creator_id}" in claimed, "xp": LADDER_REWARD[0], "credits": LADDER_REWARD[1],
        })
    out.sort(key=lambda ladder: (ladder["complete"], -(ladder["done"] / ladder["needed"]), ladder["name"].lower()))
    return out


def _award(db: Session, key: str, xp: int, credits: int, label: str) -> dict:
    from services.gamification import award_xp, get_or_create_profile
    event = award_xp(db, "tcg_set_completed", override_amount=xp)
    profile = get_or_create_profile(db)
    profile.vault_credits = (profile.vault_credits or 0) + credits
    db.add(CreditEvent(source="tcg_collection", amount=credits))
    db.add(TCGCollectionAward(key=key, xp=int(event.amount or xp), credits=credits, awarded_at=datetime.utcnow()))
    return {"key": key, "label": label, "xp": int(event.amount or xp), "credits": credits}


_cache: dict = {}
_lock = threading.Lock()
CACHE_SECONDS = 300


def invalidate():
    with _lock:
        _cache.clear()


def _boards(db: Session) -> tuple[list[dict], list[dict]]:
    """Both boards from a short cache: the catalogue scan takes seconds."""
    with _lock:
        hit = _cache.get("boards")
        if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
            return copy.deepcopy(hit[1])
    boards = (trait_collections(db), spice_ladders(db))
    with _lock:
        _cache["boards"] = (time.monotonic(), boards)
    return copy.deepcopy(boards)


def collections(db: Session) -> dict:
    """Both boards, paying out any milestone reached since the last look."""
    traits, ladders = _boards(db)
    awards = []
    for trait in traits:
        for tier in trait["tiers"]:
            if tier["reached"] and not tier["claimed"]:
                awards.append(_award(db, f"trait:{trait['id']}:{tier['target']}", tier["xp"], tier["credits"],
                                     f"{trait['name']} collection: {tier['target']} cards"))
                tier["claimed"] = True
    for ladder in ladders:
        if ladder["complete"] and not ladder["claimed"]:
            awards.append(_award(db, f"ladder:{ladder['creator_id']}", ladder["xp"], ladder["credits"],
                                 f"{ladder['name']}'s Spice ladder"))
            ladder["claimed"] = True
    if awards:
        db.commit()
        invalidate()
    return {"traits": traits, "ladders": ladders, "new_awards": awards}

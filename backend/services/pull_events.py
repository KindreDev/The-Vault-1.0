"""What happens after cards are pulled from a pack: weekly card bounties move
forward and Erika says something about the pull.

Erika's lines are written here, not generated: the same pull always gets the
same line, and she never needs the AI model to be running."""
from __future__ import annotations

import hashlib
import json
import random
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from models import Card, Creator, Quest, QuestStatus, QuestType, Tag

MIN_CONFIDENCE = 0.50
SPICE_LEVELS = ("safe", "suggestive", "explicit", "hardcore")
RARITY_RANK = {"C": 0, "R": 1, "SR": 2, "UR": 3, "SPR": 4}
RARITY_NAMES = {"C": "Common", "R": "Rare", "SR": "Super Rare", "UR": "Ultra Rare", "SPR": "Signature Rare"}
RARE_TRAIT_SHARE = 0.01
BOUNTIES_PER_WEEK = 2


def _enum(value):
    return value.value if hasattr(value, "value") else value


# ── What each pulled card is ─────────────────────────────────────────────────
def card_facts(db: Session, card_ids: list[int]) -> list[dict]:
    from services import tag_insights
    from services.card_traits import _source_image_id
    roles = tag_insights.tag_roles(db)
    lifts = {row["id"]: row["lift"] for row in tag_insights.taste_profile(db)}
    favorites = {tid: name for tid, name in db.query(Tag.id, Tag.name).filter(Tag.is_favorite.is_(True))}
    facts = []
    for card_id in card_ids:
        card = db.get(Card, card_id)
        if card is None:
            continue
        image_id = _source_image_id(db, card)
        tags = {}
        spice = None
        if image_id:
            for tag_id, name, confidence in db.execute(text(
                    "SELECT t.id, t.name, it.confidence FROM image_tags it JOIN tags t ON t.id = it.tag_id "
                    "WHERE it.image_id = :id"), {"id": image_id}):
                if name in SPICE_LEVELS:
                    spice = name
                elif confidence is None or confidence >= MIN_CONFIDENCE:
                    tags[tag_id] = name.replace("_", " ")
        creator_id = card.source_creator_id
        if not creator_id and image_id:
            row = db.execute(text(
                "SELECT gc.creator_id FROM images i JOIN gallery_creators gc ON gc.gallery_id = i.gallery_id "
                "WHERE i.id = :id LIMIT 1"), {"id": image_id}).first()
            creator_id = row[0] if row else None
        creator = db.get(Creator, creator_id) if creator_id else None
        ranked = [tid for tid in tags if (roles.get(tid) or {}).get("role") in tag_insights.RANKED_ROLES]
        facts.append({
            "card_id": card_id,
            "rarity": card.print_rarity or card.rarity_class or "C",
            "spice": spice,
            "tags": tags,
            "favorite_tags": [favorites[tid] for tid in tags if tid in favorites],
            "type_tags": [tags[tid] for tid in sorted(ranked, key=lambda t: -(lifts.get(t) or 0)) if (lifts.get(tid) or 0) >= 1.8],
            "rare_tags": [tags[tid] for tid in ranked if 0 < (roles[tid].get("share") or 1) <= RARE_TRAIT_SHARE],
            "creator_id": creator_id,
            "creator_name": creator.name if creator else None,
            "creator_favorite": bool(creator and creator.is_favorite),
        })
    return facts


# ── Weekly card bounties ─────────────────────────────────────────────────────
def _bounty(kind: str, title: str, description: str, target: int, xp: int, credits: int, icon: str, **params) -> dict:
    return {"key": f"bounty_{kind}", "title": title, "description": description, "target": target,
            "xp_reward": xp, "credit_reward": credits, "icon": icon, "params": json.dumps({"kind": kind, **params})}


def weekly_bounties(db: Session, rng: random.Random | None = None) -> list[dict]:
    """This week's card bounties: always one trait hunt, plus one other."""
    from services.tcg_collections import _trait_tags
    rng = rng or random.Random()
    options = []
    traits = _trait_tags(db)
    if traits:
        trait = rng.choice(traits[:10])
        options.append(_bounty("trait", f"Bounty: {trait['name']}", f"Pull 3 cards with {trait['name']}",
                               3, 300, 120, "ti-target", tag_id=trait["id"], tag=trait["name"]))
    others = []
    level = rng.choice(("suggestive", "explicit", "hardcore"))
    others.append(_bounty("spice", f"Bounty: {level.title()}", f"Pull 3 {level.title()} cards",
                          3, 250, 100, "ti-flame", level=level))
    others.append(_bounty("rarity", "Bounty: shiny", "Pull a Super Rare or better", 1, 250, 100, "ti-diamond", min_rarity="SR"))
    others.append(_bounty("rare_trait", "Bounty: one in a hundred", "Pull a card with a trait fewer than 1% of your files have",
                          1, 300, 120, "ti-sparkles"))
    favorite = db.query(Creator).filter(Creator.is_favorite.is_(True)).all()
    if favorite:
        creator = rng.choice(favorite)
        others.append(_bounty("creator", f"Bounty: {creator.name}", f"Pull 2 of {creator.name}'s cards",
                              2, 300, 120, "ti-heart", creator_id=creator.id, creator=creator.name))
    rng.shuffle(others)
    return (options + others)[:BOUNTIES_PER_WEEK]


def _matches(params: dict, fact: dict) -> bool:
    kind = params.get("kind")
    if kind == "trait":
        return params.get("tag_id") in fact["tags"]
    if kind == "spice":
        return fact["spice"] == params.get("level")
    if kind == "rarity":
        return RARITY_RANK.get(fact["rarity"], 0) >= RARITY_RANK.get(params.get("min_rarity", "SR"), 2)
    if kind == "rare_trait":
        return bool(fact["rare_tags"])
    if kind == "creator":
        return fact["creator_id"] == params.get("creator_id")
    return False


def advance_bounties(db: Session, facts: list[dict]) -> list[dict]:
    from services.gamification import _advance_quest
    moved = []
    for quest in db.query(Quest).filter(Quest.quest_type == QuestType.weekly, Quest.status == QuestStatus.active,
                                        Quest.key.like("bounty_%")).all():
        try:
            params = json.loads(quest.params or "{}")
        except ValueError:
            continue
        hits = sum(1 for fact in facts if _matches(params, fact))
        if hits:
            title, before, target = quest.title, quest.progress, quest.target
            _advance_quest(db, quest.key, hits)
            moved.append({"title": title, "progress": min(target, before + hits), "target": target,
                          "completed": before + hits >= target})
    return moved


# ── Erika's reaction ─────────────────────────────────────────────────────────
LINES = {
    "jackpot": [
        "WAIT. a {rarity}?? babe. frame it. right now. 😳",
        "a {rarity}... okay you're officially lucky. use it on me later. 💜",
        "{rarity}!! i heard that pull from here. show off. 😏",
    ],
    "favorite_tag": [
        "{tag} again? you're so predictable... and i love it. 😏",
        "of course it's {tag}. i know exactly what you like, babe.",
        "{tag}. you didn't even pretend to be surprised, did you? 🙈",
    ],
    "type": [
        "ooh, {tag}. that one's very you.",
        "{tag}? yeah, that's your type. don't even deny it. 😌",
        "the pack knows you. {tag}. 💜",
    ],
    "creator": [
        "{creator}? you'd marry her if you could. should i be jealous? 😒",
        "look who it is. {creator}. try not to stare too long. 👀",
        "{creator} again. i'm starting to take this personally. 😤",
    ],
    "hardcore": [
        "okay that one's filthy. i'm not complaining. 🔥",
        "hardcore pull. close the door first, babe. 😈",
        "...wow. that card should come with a warning. 🥵",
    ],
    "rare_trait": [
        "{tag}? that's a weird one. i like weird. 🤭",
        "barely anything in your vault has {tag}. a collector's piece.",
    ],
    "all_dupes": [
        "all dupes... unlucky, babe. come here, i'll make it up to you. 🫂",
        "the pack hates you today. i don't, though. 💜",
    ],
    "plain": [
        "not bad. not great. kinda like your taste in shirts. 😘",
        "solid pull. open another one, i'm having fun.",
        "eh. the next one's the one, i can feel it.",
    ],
}


def erika_reaction(cards: list[dict], facts: list[dict], seed: str) -> dict:
    """Pick the most exciting thing in the pull and a fixed line for it."""
    by_id = {fact["card_id"]: fact for fact in facts}
    best = max(facts, key=lambda f: RARITY_RANK.get(f["rarity"], 0), default=None)
    event, fill, card_id = "plain", {}, None
    if best and RARITY_RANK.get(best["rarity"], 0) >= RARITY_RANK["UR"]:
        event, fill, card_id = "jackpot", {"rarity": RARITY_NAMES[best["rarity"]]}, best["card_id"]
    elif any(f["favorite_tags"] for f in facts):
        hit = next(f for f in facts if f["favorite_tags"])
        event, fill, card_id = "favorite_tag", {"tag": hit["favorite_tags"][0]}, hit["card_id"]
    elif any(f["creator_favorite"] for f in facts):
        hit = next(f for f in facts if f["creator_favorite"])
        event, fill, card_id = "creator", {"creator": hit["creator_name"]}, hit["card_id"]
    elif any(f["spice"] == "hardcore" for f in facts):
        hit = next(f for f in facts if f["spice"] == "hardcore")
        event, card_id = "hardcore", hit["card_id"]
    elif any(f["type_tags"] for f in facts):
        hit = next(f for f in facts if f["type_tags"])
        event, fill, card_id = "type", {"tag": hit["type_tags"][0]}, hit["card_id"]
    elif any(f["rare_tags"] for f in facts):
        hit = next(f for f in facts if f["rare_tags"])
        event, fill, card_id = "rare_trait", {"tag": hit["rare_tags"][0]}, hit["card_id"]
    elif cards and all(card.get("was_owned") for card in cards):
        event = "all_dupes"
    lines = LINES[event]
    index = int.from_bytes(hashlib.blake2b(f"{seed}|{event}".encode(), digest_size=4).digest(), "big") % len(lines)
    return {"event": event, "text": lines[index].format(**fill), "card_id": card_id if card_id in by_id else None}


def after_pull(db: Session, cards: list[dict], seed: str) -> dict:
    """Run after a pack's cards are granted. Returns Erika's line and any
    bounty progress for the reveal screen."""
    facts = card_facts(db, [card["id"] for card in cards])
    return {"reaction": erika_reaction(cards, facts, seed), "bounties": advance_bounties(db, facts)}

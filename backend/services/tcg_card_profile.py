"""What the card window says about a card beyond its printed face: the source
file read through the new tags (Spice, people, traits by role, how it fits your
taste, what is rare about it) and where it sits in your collection (set and
creator progress). Kept apart from tcg_v2 so the card window has one home."""
from __future__ import annotations

from urllib.parse import urlparse

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import Card, CardInventory, TCGChecklistEntry, TCGSet
from services import tag_insights

# AI tags below this are noise on a card (the tagger keeps a few low ones,
# like backboob at 5%, for the Spice rules).
TRAIT_MIN_CONFIDENCE = 0.40
TRAIT_ROLES = ("looks", "content", "framing")
TRAITS_PER_ROLE = 10
# A trait on at most this share of the library is called rare.
RARE_SHARE = 0.02
TASTE_MIN_LIFT = 1.25

PLATFORM_NAMES = {
    "patreon.com": "Patreon", "instagram.com": "Instagram", "twitter.com": "Twitter", "x.com": "X",
    "onlyfans.com": "OnlyFans", "fansly.com": "Fansly", "tiktok.com": "TikTok", "youtube.com": "YouTube",
    "twitch.tv": "Twitch", "reddit.com": "Reddit", "pixiv.net": "Pixiv", "fanbox.cc": "Fanbox",
    "deviantart.com": "DeviantArt", "artstation.com": "ArtStation", "linktr.ee": "Linktree",
    "facebook.com": "Facebook", "weibo.com": "Weibo", "boosty.to": "Boosty", "ko-fi.com": "Ko-fi",
}


def link_label(key: str, url: str) -> str:
    """A readable name for a creator link. Old links are stored as link_0,
    link_1, so fall back to the site name."""
    if key and not key.startswith("link_"):
        return key
    host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    for domain, name in PLATFORM_NAMES.items():
        if host == domain or host.endswith("." + domain):
            return name
    return host or "Link"


def source_profile(db: Session, tags: list[dict]) -> dict:
    """Read the source file's tags the way the rest of the app does now."""
    roles = tag_insights.tag_roles(db)
    taste = {row["id"]: row["lift"] for row in tag_insights.taste_profile(db)}
    spice = people = None
    traits: dict[str, list[dict]] = {role: [] for role in TRAIT_ROLES}
    for tag in tags:
        info = roles.get(tag["id"]) or {}
        role = info.get("role")
        manual = tag["source"] == "manual"
        confidence = 1.0 if manual else float(tag["confidence"] or 0)
        if role == "spice" and tag["normalized"] in tag_insights.SPICE_LEVELS:
            spice = tag["normalized"]
            continue
        if role == "people":
            people = tag["normalized"]
            continue
        if role not in traits or (not manual and confidence < TRAIT_MIN_CONFIDENCE):
            continue
        traits[role].append({
            "id": tag["id"], "name": tag["name"].replace("_", " "), "confidence": None if manual else round(confidence, 3),
            "manual": manual, "share": info.get("share"), "lift": taste.get(tag["id"]),
        })
    for role in traits:
        traits[role].sort(key=lambda t: (not t["manual"], -(t["confidence"] or 1.0)))
        traits[role] = traits[role][:TRAITS_PER_ROLE]
    shown = [t for role in ("looks", "content") for t in traits[role]]
    taste_matches = sorted((t for t in shown if (t["lift"] or 0) >= TASTE_MIN_LIFT),
                           key=lambda t: t["lift"], reverse=True)[:4]
    rare = sorted((t for t in shown if not t["manual"] and t["share"] is not None and t["share"] <= RARE_SHARE),
                  key=lambda t: t["share"])[:3]
    return {"spice": spice, "people": people, "traits": traits,
            "taste_matches": taste_matches, "rare_traits": rare}


def _owned_in(db: Session, query) -> int:
    return query.join(CardInventory, CardInventory.card_id == TCGChecklistEntry.card_id) \
        .filter(CardInventory.quantity > 0).with_entities(func.count(func.distinct(TCGChecklistEntry.card_id))).scalar() or 0


def collection_progress(db: Session, card: Card, entries: list[TCGChecklistEntry]) -> dict:
    """Set progress for each set the card is in, and how many of the
    person's cards you own."""
    sets = []
    for entry in entries:
        if not entry.set_id:
            continue
        in_set = db.query(TCGChecklistEntry).filter(TCGChecklistEntry.set_id == entry.set_id,
                                                     TCGChecklistEntry.required_for_complete.is_(True))
        total = in_set.with_entities(func.count(func.distinct(TCGChecklistEntry.card_id))).scalar() or 0
        tcg_set = db.get(TCGSet, entry.set_id)
        sets.append({"set_id": entry.set_id, "name": tcg_set.name if tcg_set else None,
                     "release_name": entry.release.name if entry.release else None,
                     "owned": _owned_in(db, in_set), "total": total})
    person = None
    if card.source_creator_id:
        theirs = db.query(TCGChecklistEntry).join(Card, Card.id == TCGChecklistEntry.card_id) \
            .filter(Card.source_creator_id == card.source_creator_id, Card.is_legacy.is_(False))
        total = theirs.with_entities(func.count(func.distinct(TCGChecklistEntry.card_id))).scalar() or 0
        if total:
            person = {"creator_id": card.source_creator_id, "owned": _owned_in(db, theirs), "total": total}
    return {"sets": sets, "person": person}


def card_story(db: Session, subject: str, source, gallery, gallery_ids: set[int] | None = None) -> dict:
    """The card back: moments from the activity log (kept since tracking
    began) for what the card is about: one file, one gallery or a person."""
    from sqlalchemy import text as sql
    if subject == "image" and source is not None:
        where, params = "image_id = :id", {"id": source.id}
        views, cums = ("view",), ("cum",)
        landed = source.file_created_at or source.created_at
    elif subject == "gallery" and gallery is not None:
        where, params = "gallery_id = :id", {"id": gallery.id}
        views, cums = ("gallery_view",), ("gallery_cum",)
        landed = gallery.created_at
    elif gallery_ids:
        ids = ",".join(str(int(g)) for g in list(gallery_ids)[:5000])
        where = f"(gallery_id IN ({ids}) OR image_id IN (SELECT id FROM images WHERE gallery_id IN ({ids})))"
        params, views, cums, landed = {}, ("view", "gallery_view"), ("cum", "gallery_cum"), None
    else:
        return {}
    kinds = lambda values: ",".join(f"'{v}'" for v in values)
    first_seen, last_seen, days = db.execute(sql(
        f"SELECT MIN(logged_at), MAX(logged_at), COUNT(DISTINCT DATE(logged_at)) FROM activity_events "
        f"WHERE {where} AND kind IN ({kinds(views)})"), params).one()
    first_cum, cum_total = db.execute(sql(
        f"SELECT MIN(logged_at), COALESCE(SUM(amount), 0) FROM activity_events WHERE {where} AND kind IN ({kinds(cums)})"),
        params).one()
    best = db.execute(sql(
        f"SELECT DATE(logged_at) AS day, SUM(CASE WHEN kind LIKE '%cum' THEN 5 WHEN kind LIKE '%edge' THEN 3 "
        f"WHEN kind = 'seconds' THEN 0 ELSE 1 END) AS score FROM activity_events WHERE {where} "
        f"GROUP BY day ORDER BY score DESC LIMIT 1"), params).first()
    iso = lambda value: (value.isoformat() if hasattr(value, "isoformat") else str(value)) if value else None
    return {
        "landed": iso(landed), "first_seen": iso(first_seen), "last_seen": iso(last_seen),
        "days_visited": int(days or 0), "first_finish": iso(first_cum), "finishes": int(cum_total or 0),
        "best_day": best[0] if best and best[1] else None, "best_day_score": int(best[1]) if best and best[1] else 0,
    }

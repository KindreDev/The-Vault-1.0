"""Collection Rarity Score (CRS) + scarcity classes R / SR / SSR / UR.

The tier (common/epic/legendary/celestial) is a card's *family*; CRS layers
per-collection SCARCITY on top so "sort by rarity" is meaningful and a scarce
low-tier card can outshine a generic high-tier one.

Scarcity tied to a creator you don't actually engage with is heavily discounted
(LOVE-GATING) — so a brand-new creator with a tiny collection can't mint an
undeserved chase card. Love is measured from real behaviour: orgasms to her
content, time watched, ratings, and sessions.

Every knob is a named constant up top so the feel is easy to tune.
"""
import math
from sqlalchemy import func, case
from sqlalchemy.orm import Session

from models import Card, Image, Gallery, Creator, SessionLog, gallery_creators
from services.cards import rarity_score, norm_rarity

# ── Tunables ──────────────────────────────────────────────────────────────────
LOVE_W = dict(cum=3.0, watch_per_sec=1/120.0, rated=2.0, avg_rating=0.3,
              session=2.5, view=0.05)
LOVE_REF_PCT   = 0.85    # raw love at this percentile normalises to 1.0
LOVE_FLOOR     = 0.2     # scarcity share kept even for an unloved creator
SCARCITY_GAIN  = 1.2     # max add from creator-footprint scarcity
QUALITY_GAIN   = 0.3     # max add from source content quality
TYPE_SCARCITY  = {"goon": 0.6, "hof": 0.7, "variant": 0.5, "collab": 0.3, "creator": 0.2}
CLASS_CUTOFFS  = [("UR", 0.97), ("SSR", 0.85), ("SR", 0.60)]   # else "R"


def _creator_galleries(db: Session) -> dict:
    """creator_id -> set(gallery_id), via primary FK and the M2M."""
    cg = {}
    for gid, cid in db.query(Gallery.id, Gallery.creator_id).filter(Gallery.creator_id.isnot(None)).all():
        cg.setdefault(cid, set()).add(gid)
    for gid, cid in db.query(gallery_creators.c.gallery_id, gallery_creators.c.creator_id).all():
        cg.setdefault(cid, set()).add(gid)
    return cg


def _gallery_engagement(db: Session) -> dict:
    """gallery_id -> (cum, view_seconds, views, rated_count, rating_sum)."""
    rows = db.query(
        Image.gallery_id,
        func.coalesce(func.sum(Image.cum_count), 0),
        func.coalesce(func.sum(Image.view_seconds), 0),
        func.coalesce(func.sum(Image.view_count), 0),
        func.coalesce(func.sum(case((Image.rating > 0, 1), else_=0)), 0),
        func.coalesce(func.sum(Image.rating), 0.0),
    ).group_by(Image.gallery_id).all()
    return {r[0]: (r[1], r[2], r[3], r[4], r[5]) for r in rows}


def love_scores(db: Session, cg: dict = None, geng: dict = None) -> dict:
    """creator_id -> love 0..1, from real engagement, normalised to the 85th pct."""
    cg = cg if cg is not None else _creator_galleries(db)
    geng = geng if geng is not None else _gallery_engagement(db)
    sess = dict(db.query(SessionLog.creator_id, func.count())
                  .filter(SessionLog.creator_id.isnot(None))
                  .group_by(SessionLog.creator_id).all())
    raw = {}
    for cid, gids in cg.items():
        cum = secs = views = rated = rsum = 0
        for gid in gids:
            e = geng.get(gid)
            if e:
                cum += e[0]; secs += e[1]; views += e[2]; rated += e[3]; rsum += e[4]
        avg_rating = (rsum / rated) if rated else 0.0
        raw[cid] = (LOVE_W["cum"] * cum
                    + LOVE_W["watch_per_sec"] * secs
                    + LOVE_W["rated"] * rated
                    + LOVE_W["avg_rating"] * avg_rating * rated
                    + LOVE_W["session"] * sess.get(cid, 0)
                    + LOVE_W["view"] * views)
    pos = sorted(v for v in raw.values() if v > 0)
    if not pos:
        return {}
    ref = pos[min(len(pos) - 1, int(len(pos) * LOVE_REF_PCT))] or pos[-1] or 1.0
    return {cid: min(1.0, v / ref) for cid, v in raw.items() if v > 0}


def _gallery_creator_map(db: Session) -> dict:
    """gallery_id -> a representative creator_id (primary FK, else first M2M)."""
    gc = {}
    for gid, cid in db.query(Gallery.id, Gallery.creator_id).filter(Gallery.creator_id.isnot(None)).all():
        gc[gid] = cid
    for gid, cid in db.query(gallery_creators.c.gallery_id, gallery_creators.c.creator_id).all():
        gc.setdefault(gid, cid)
    return gc


def _card_creator_id(db: Session, card: Card, gal_creator: dict) -> int:
    if card.source_creator_id:
        return card.source_creator_id
    if card.source_gallery_id:
        return gal_creator.get(card.source_gallery_id)
    if card.source_image_id:
        row = db.query(Image.gallery_id).filter(Image.id == card.source_image_id).first()
        if row:
            return gal_creator.get(row[0])
    return None


def _content_quality(db: Session, card: Card) -> float:
    """0..1 from the source asset's rating / cum / favourite — rewards cards
    minted from your best content."""
    rating = cum = 0.0
    fav = False
    if card.source_image_id:
        img = db.query(Image).filter(Image.id == card.source_image_id).first()
        if img:
            rating, cum, fav = (img.rating or 0), (img.cum_count or 0), bool(img.is_favorite)
    elif card.source_gallery_id:
        g = db.query(Gallery).filter(Gallery.id == card.source_gallery_id).first()
        if g:
            rating, cum, fav = (g.rating or 0), (g.cum_count or 0), bool(g.is_favorite)
    elif card.source_creator_id:
        c = db.query(Creator).filter(Creator.id == card.source_creator_id).first()
        if c:
            rating, fav = (c.rating or 0), bool(c.is_favorite)
    return min(1.0, (rating / 10.0) * 0.7 + min(cum, 20) / 20.0 * 0.2 + (0.1 if fav else 0.0))


def _percentile_class(crs: float, ordered: list) -> str:
    """Map a score to R/SR/SSR/UR by its percentile in the sorted list."""
    if not ordered:
        return "R"
    # fraction of cards at or below this score
    import bisect
    rank = bisect.bisect_right(ordered, crs) / len(ordered)
    for cls, cut in CLASS_CUTOFFS:
        if rank >= cut:
            return cls
    return "R"


def compute_rarity(db: Session) -> int:
    """Recompute crs + rarity_class for every card. Returns the number scored.
    Cheap enough to run at startup and after each pack open."""
    cg = _creator_galleries(db)
    geng = _gallery_engagement(db)
    love = love_scores(db, cg, geng)
    gal_creator = _gallery_creator_map(db)

    # Creator footprint = how many images live under her galleries. A small
    # footprint = a scarcer subject (but only counts once love-gated).
    gal_imgc = dict(db.query(Image.gallery_id, func.count()).group_by(Image.gallery_id).all())
    creator_imgc = {cid: sum(gal_imgc.get(g, 0) for g in gids) for cid, gids in cg.items()}
    max_log = math.log((max(creator_imgc.values(), default=1) or 1) + 1)

    cards = db.query(Card).all()
    for card in cards:
        ct = card.card_type.value if hasattr(card.card_type, "value") else card.card_type
        base = rarity_score(card)                       # tier × foil × level

        cid = _card_creator_id(db, card, gal_creator)
        lv = love.get(cid, 0.0) if cid else 0.0
        footprint = creator_imgc.get(cid, 0) if cid else 0

        # inverse-footprint scarcity 0..1 (few images → ~1)
        inv = 0.0
        if footprint > 0 and max_log > 0:
            inv = 1.0 - min(1.0, math.log(footprint + 1) / max_log)
        gated = inv * (LOVE_FLOOR + (1 - LOVE_FLOOR) * lv)   # love-gate the boost

        scarcity_mult = 1.0 + SCARCITY_GAIN * gated + TYPE_SCARCITY.get(ct, 0.0)
        quality_mult = 1.0 + QUALITY_GAIN * _content_quality(db, card)

        card.crs = round(base * scarcity_mult * quality_mult, 2)

    # Assign classes by PER-TIER percentile: every tier gets its own R→UR spread,
    # so a Core-UR (top of the Core pool) is real and Celestial-R can exist. The
    # global `crs` is kept untouched for the honest cross-tier "Rarity" sort.
    from collections import defaultdict
    by_tier = defaultdict(list)
    for card in cards:
        by_tier[norm_rarity(card.rarity)].append(card)
    for group in by_tier.values():
        ordered = sorted(c.crs or 0 for c in group)
        for card in group:
            card.rarity_class = _percentile_class(card.crs or 0, ordered)

    db.commit()
    return len(cards)

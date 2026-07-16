"""Explore — an algorithmic wall of the whole collection that learns your taste.

Every image you open nudges a persistent per-tag affinity score. The explore feed
then samples random candidates and ranks them by how well their tags match what
you've been into — while always reserving a slice of slots for pure-random
discovery, so it never collapses into an echo chamber. The first image you tap in
the grid is passed back as a "seed" that biases the endless feed toward it.
"""
import random

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import Image, image_tags, ExploreAffinity

AFFINITY_CAP    = 60.0    # keep any single tag from dominating forever
SEED_TAG_BOOST  = 25.0    # how strongly the first-clicked image steers the feed
DISCOVERY_FRAC  = 0.30    # share of slots reserved for random discovery


def _affinity_map(db: Session) -> dict[int, float]:
    return {r[0]: r[1] for r in db.query(ExploreAffinity.tag_id, ExploreAffinity.weight).all()}


def record_interaction(db: Session, image_id: int, strength: float = 1.0) -> dict:
    """Boost the affinity of every tag on the image the user just engaged with."""
    tag_ids = [r[0] for r in db.query(image_tags.c.tag_id)
                              .filter(image_tags.c.image_id == image_id).all()]
    if not tag_ids:
        return {"ok": True, "tags": 0}
    existing = {a.tag_id: a for a in db.query(ExploreAffinity)
                                       .filter(ExploreAffinity.tag_id.in_(tag_ids)).all()}
    for tid in tag_ids:
        a = existing.get(tid)
        if a:
            a.weight = min(a.weight + strength, AFFINITY_CAP)
        else:
            db.add(ExploreAffinity(tag_id=tid, weight=strength))
    db.commit()
    return {"ok": True, "tags": len(tag_ids)}


def explore_feed(db: Session, seed_image_id: int = None, limit: int = 15) -> list[dict]:
    """A fresh algorithmically-ranked batch. Endless: each call samples anew."""
    affinity = _affinity_map(db)

    seed_tags: set[int] = set()
    if seed_image_id:
        seed_tags = {r[0] for r in db.query(image_tags.c.tag_id)
                                    .filter(image_tags.c.image_id == seed_image_id).all()}

    pool_size = max(limit * 8, 80)
    candidates = (db.query(Image.id, Image.is_video, Image.gallery_id, Image.width, Image.height)
                    .filter(Image.thumb_path.isnot(None))
                    .order_by(func.random())
                    .limit(pool_size).all())
    if not candidates:
        return []
    cand_ids = [c[0] for c in candidates]

    tags_by_img: dict[int, list[int]] = {}
    for iid, tid in (db.query(image_tags.c.image_id, image_tags.c.tag_id)
                       .filter(image_tags.c.image_id.in_(cand_ids)).all()):
        tags_by_img.setdefault(iid, []).append(tid)

    scored = []
    for c in candidates:
        tids = tags_by_img.get(c[0], [])
        score = sum(affinity.get(t, 0.0) for t in tids)
        if seed_tags:
            score += len(seed_tags.intersection(tids)) * SEED_TAG_BOOST
        score += random.random() * 3.0   # jitter so identical-affinity items still shuffle
        scored.append((score, c))

    scored.sort(key=lambda x: x[0], reverse=True)
    ranked = [c for _, c in scored]

    top = ranked[:limit]
    # Sprinkle pure-random discovery picks into random slots
    tail = ranked[limit:]
    random.shuffle(tail)
    for k in range(min(max(1, int(limit * DISCOVERY_FRAC)), len(tail))):
        top[random.randint(0, len(top) - 1)] = tail[k]

    # Enrich with the owning creator so the frontend can render IG-style post cards
    from models import Creator, gallery_creators
    from services.feed import handle_for
    gallery_ids = {c[2] for c in top if c[2]}
    creator_by_gallery: dict[int, Creator] = {}
    if gallery_ids:
        rows = (db.query(gallery_creators.c.gallery_id, Creator)
                  .join(Creator, Creator.id == gallery_creators.c.creator_id)
                  .filter(gallery_creators.c.gallery_id.in_(gallery_ids)).all())
        for gid, creator in rows:
            creator_by_gallery.setdefault(gid, creator)

    out = []
    for c in top:
        creator = creator_by_gallery.get(c[2])
        out.append({
            "id": c[0], "is_video": bool(c[1]), "gallery_id": c[2],
            "width": c[3], "height": c[4],
            "creator": {
                "id": creator.id, "name": creator.name,
                "handle": handle_for(creator.name),
                "has_avatar": bool(creator.avatar_path),
            } if creator else None,
        })
    return out

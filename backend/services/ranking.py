"""
Hall of Fame ranking — the single source of truth for how creators are scored.

This used to be duplicated: /creators/hall-of-fame had one copy and the
per-creator stats endpoint had another, and they drifted apart, so a creator
could be #2 in the Hall of Fame and "#4 of 268" in her own stats modal. Both now
call score_all_creators().

Also owns rank movement — the little green/red arrows. The last known rank is
persisted per entity, so a movement stays visible until the next one, the way a
league table shows change since the last matchday rather than resetting on
every page load.
"""
import statistics

from sqlalchemy import func, select, union
from sqlalchemy.orm import Session

from models import (
    Creator, Gallery, Image, SessionLog, HofRank,
    gallery_creators, image_creators,
)

# ── Weights ───────────────────────────────────────────────────────────────────
CUM_WEIGHT          = 120
SESSION_WEIGHT      = 300
GALLERY_VIEW_WEIGHT = 5
IMAGE_VIEW_WEIGHT   = 1
EDGE_WEIGHT         = 60    # an edge is real intent, worth about half an O
DWELL_CLAMP         = (0.75, 1.5)
MIN_DWELL_VIEWS     = 20


def _creator_image_pairs():
    """Distinct (creator_id, image_id) pairs via either path, deduplicated."""
    gallery_pairs = (
        select(gallery_creators.c.creator_id.label("creator_id"),
               Image.id.label("image_id"))
        .select_from(gallery_creators)
        .join(Image, Image.gallery_id == gallery_creators.c.gallery_id)
    )
    file_pairs = (
        select(image_creators.c.creator_id.label("creator_id"),
               image_creators.c.image_id.label("image_id"))
    )
    return union(gallery_pairs, file_pairs).subquery()


def score_all_creators(db: Session) -> dict:
    """Score every creator with at least one assigned gallery.

    Returns {creator_id: {...components..., "score": int}}, plus a "_median_dwell"
    key so callers can explain the engagement factor.
    """
    gal_rows = (
        db.query(gallery_creators.c.creator_id,
                 func.sum(Gallery.view_count),
                 func.sum(Gallery.cum_count),
                 func.sum(Gallery.edge_count))
          .join(Gallery, Gallery.id == gallery_creators.c.gallery_id)
          .group_by(gallery_creators.c.creator_id)
          .all()
    )

    pairs = _creator_image_pairs()
    img_rows = (
        db.query(pairs.c.creator_id,
                 func.sum(Image.view_seconds),
                 func.sum(Image.view_count))
          .join(Image, Image.id == pairs.c.image_id)
          .group_by(pairs.c.creator_id)
          .all()
    )
    img_map = {cid: (int(s or 0), int(v or 0)) for cid, s, v in img_rows}

    # Photos only for dwell — a 20-minute video and a photo studied for 20
    # seconds are not the same kind of attention.
    dwell_pairs = _creator_image_pairs()
    dwell_rows = (
        db.query(dwell_pairs.c.creator_id,
                 func.sum(Image.view_seconds),
                 func.sum(Image.view_count))
          .join(Image, Image.id == dwell_pairs.c.image_id)
          .filter(Image.is_video == False)  # noqa: E712
          .group_by(dwell_pairs.c.creator_id)
          .all()
    )
    dwell_map = {
        cid: (secs or 0) / views
        for cid, secs, views in dwell_rows
        if (views or 0) >= MIN_DWELL_VIEWS
    }
    median_dwell = statistics.median(dwell_map.values()) if dwell_map else 0

    session_map = {
        cid: int(n or 0)
        for cid, n in db.query(SessionLog.creator_id, func.count(SessionLog.id))
                        .filter(SessionLog.creator_id.isnot(None))
                        .group_by(SessionLog.creator_id).all()
    }

    out = {}
    for cid, gviews, gcum, gedge in gal_rows:
        view_secs, image_views = img_map.get(cid, (0, 0))
        dwell = dwell_map.get(cid)
        engagement = 1.0
        if dwell and median_dwell:
            engagement = max(DWELL_CLAMP[0], min(DWELL_CLAMP[1], dwell / median_dwell))

        volume = (
            view_secs
            + int(gcum or 0) * CUM_WEIGHT
            + int(gedge or 0) * EDGE_WEIGHT
            + session_map.get(cid, 0) * SESSION_WEIGHT
            + int(gviews or 0) * GALLERY_VIEW_WEIGHT
            + image_views * IMAGE_VIEW_WEIGHT
        )
        out[cid] = {
            "gallery_views":      int(gviews or 0),
            "image_views":        image_views,
            "total_views":        int(gviews or 0) + image_views,
            "total_cum":          int(gcum or 0),
            "total_edges":        int(gedge or 0),
            "total_view_seconds": view_secs,
            "session_count":      session_map.get(cid, 0),
            "avg_dwell_seconds":  round(dwell, 1) if dwell else None,
            "engagement_factor":  round(engagement, 2),
            "volume_score":       int(volume),
            "score":              int(volume * engagement),
        }
    out["_median_dwell"] = round(median_dwell, 1)
    return out


def ranked_creator_ids(scores: dict) -> list:
    """Creator ids ordered best-first, from a score_all_creators() result."""
    return [cid for cid, _ in sorted(
        ((cid, v["score"]) for cid, v in scores.items() if cid != "_median_dwell"),
        key=lambda kv: kv[1], reverse=True,
    )]


# ── Galleries ─────────────────────────────────────────────────────────────────

def score_all_galleries(db: Session) -> dict:
    """{gallery_id: {...components..., "score": int}} for every gallery with any
    engagement signal. Same weights as creators, minus the dwell factor — a
    gallery's per-photo attention is already fully expressed by its
    image_view_seconds, so scaling by dwell would count it twice."""
    from sqlalchemy import or_

    secs_map = {
        gid: int(s or 0)
        for gid, s in db.query(Image.gallery_id, func.sum(Image.view_seconds))
                        .group_by(Image.gallery_id).all()
    }
    sess_map = {
        gid: int(n or 0)
        for gid, n in db.query(SessionLog.gallery_id, func.count(SessionLog.id))
                        .filter(SessionLog.gallery_id.isnot(None))
                        .group_by(SessionLog.gallery_id).all()
    }

    out = {}
    rows = (
        db.query(Gallery.id, Gallery.view_count, Gallery.cum_count, Gallery.edge_count)
          .filter(or_(Gallery.view_count > 0, Gallery.cum_count > 0, Gallery.edge_count > 0))
          .all()
    )
    for gid, views, cum, edges in rows:
        secs = secs_map.get(gid, 0)
        sess = sess_map.get(gid, 0)
        out[gid] = {
            "view_seconds":  secs,
            "session_count": sess,
            "score": int(
                secs
                + int(cum or 0) * CUM_WEIGHT
                + int(edges or 0) * EDGE_WEIGHT
                + sess * SESSION_WEIGHT
                + int(views or 0) * GALLERY_VIEW_WEIGHT
            ),
        }
    return out


def ranked_gallery_ids(scores: dict) -> list:
    return [gid for gid, _ in sorted(
        ((g, v["score"]) for g, v in scores.items()),
        key=lambda kv: kv[1], reverse=True,
    )]


# ── Individual photos and videos ──────────────────────────────────────────────
# Deliberately different weights from creators/galleries: for a single file, a
# cum tap is overwhelmingly the strongest statement of intent, and passive watch
# time is the weakest.
IMAGE_CUM_WEIGHT   = 500
IMAGE_EDGE_WEIGHT  = 250
IMAGE_VIEW_WEIGHT_ = 30
IMAGE_SECOND_WEIGHT = 0.1


def image_score_expr():
    """SQLAlchemy expression for a single file's Hall of Fame score."""
    return (
        func.coalesce(Image.cum_count, 0) * IMAGE_CUM_WEIGHT
        + func.coalesce(Image.edge_count, 0) * IMAGE_EDGE_WEIGHT
        + func.coalesce(Image.view_count, 0) * IMAGE_VIEW_WEIGHT_
        + func.coalesce(Image.view_seconds, 0) * IMAGE_SECOND_WEIGHT
    )


def image_score(img) -> float:
    return (
        (img.cum_count or 0) * IMAGE_CUM_WEIGHT
        + (img.edge_count or 0) * IMAGE_EDGE_WEIGHT
        + (img.view_count or 0) * IMAGE_VIEW_WEIGHT_
        + (img.view_seconds or 0) * IMAGE_SECOND_WEIGHT
    )


def image_rank(db: Session, img) -> tuple:
    """(rank, total_ranked) for one file, without scoring the whole library —
    counting how many score higher is a single query, where materialising
    hundreds of thousands of scores is not."""
    expr = image_score_expr()
    mine = image_score(img)
    higher = db.query(func.count(Image.id)).filter(expr > mine).scalar() or 0
    total  = db.query(func.count(Image.id)).filter(expr > 0).scalar() or 0
    return higher + 1, total


# ── Rank movement ─────────────────────────────────────────────────────────────

def apply_rank_movement(db: Session, entity_type: str, ordered_ids: list) -> dict:
    """Persist the current ranking and return {entity_id: places_moved}.

    Positive = climbed. The stored previous rank only updates when a rank
    actually changes, so an arrow persists until the next real movement instead
    of vanishing on the next page load.
    """
    existing = {
        r.entity_id: r
        for r in db.query(HofRank).filter(HofRank.entity_type == entity_type).all()
    }

    deltas = {}
    dirty = False
    for idx, eid in enumerate(ordered_ids):
        rank = idx + 1
        row = existing.get(eid)
        if row is None:
            # First time we've seen this entity ranked — no movement to show.
            db.add(HofRank(entity_type=entity_type, entity_id=eid,
                           rank=rank, prev_rank=None))
            dirty = True
            deltas[eid] = 0
        elif row.rank != rank:
            row.prev_rank = row.rank
            row.rank = rank
            dirty = True
            deltas[eid] = row.prev_rank - rank
        else:
            deltas[eid] = (row.prev_rank - row.rank) if row.prev_rank else 0

    if dirty:
        db.commit()
    return deltas

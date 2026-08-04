"""
Deep stats for a single gallery or a single file.

The creator stats modal answers "what is my relationship with her". These answer
the same question one level down: what is this gallery, or this one photo, to
me — how much of my attention it holds, how it ranks, and what stands out
inside it.

Ranks come from services/ranking.py rather than a local copy of the formula.
"""
from datetime import datetime

from sqlalchemy import func, case, select
from sqlalchemy.orm import Session

from models import (
    Gallery, Image, Creator, SessionLog, UserProfile, Tag,
    gallery_creators, image_tags, image_creators,
)
from services import ranking


def _pct(part, whole, digits=1):
    return round(100 * part / whole, digits) if whole else 0.0


def _ratio(part, whole, digits=2):
    return round(part / whole, digits) if whole else 0.0


def _iso(dt):
    return dt.isoformat() if isinstance(dt, datetime) else None


def _thumb(img):
    return {
        "id": img.id, "filename": img.filename, "is_video": bool(img.is_video),
        "gallery_id": img.gallery_id,
        "cum_count": img.cum_count or 0, "edge_count": img.edge_count or 0,
        "view_count": img.view_count or 0, "view_seconds": img.view_seconds or 0,
        "rating": img.rating or 0,
    }


# ── Gallery ───────────────────────────────────────────────────────────────────

def gallery_stats(db: Session, gallery_id: int) -> dict:
    g = db.query(Gallery).filter(Gallery.id == gallery_id).first()
    if not g:
        return None

    d = {c.name: getattr(g, c.name) for c in g.__table__.columns}
    d["created_at"] = _iso(g.created_at)
    d["scanned_at"] = _iso(g.scanned_at)
    d["updated_at"] = _iso(g.updated_at)
    d["creators"] = [
        {"id": c.id, "name": c.name, "creator_type": c.creator_type, "card_rarity": c.card_rarity}
        for c in g.creators
    ]

    # ── Footprint ─────────────────────────────────────────────────────────────
    agg = (
        db.query(
            func.count(Image.id).label("n"),
            func.sum(case((Image.is_video == True, 1), else_=0)).label("videos"),  # noqa: E712
            func.sum(Image.file_size).label("bytes"),
            func.sum(case((Image.is_video == True, func.coalesce(Image.duration, 0)), else_=0)).label("runtime"),  # noqa: E712
            func.sum(case((Image.is_video == True, 1), else_=0)).label("vid_n"),  # noqa: E712
            func.sum(case(((Image.is_video == True) & (Image.duration > 0), 1), else_=0)).label("vid_known"),  # noqa: E712
            func.sum(Image.view_count).label("views"),
            func.sum(Image.view_seconds).label("secs"),
            func.sum(Image.cum_count).label("cum"),
            func.sum(Image.edge_count).label("edges"),
            func.avg(case((Image.rating > 0, Image.rating), else_=None)).label("avg_rating"),
            func.sum(case((Image.rating > 0, 1), else_=0)).label("rated"),
            func.sum(case((Image.is_favorite == True, 1), else_=0)).label("favs"),  # noqa: E712
            func.sum(case((Image.ai_tagged == True, 1), else_=0)).label("ai_tagged"),  # noqa: E712
            func.min(Image.created_at).label("first_added"),
            func.max(Image.last_viewed_at).label("last_viewed"),
        )
        .filter(Image.gallery_id == gallery_id)
        .one()
    )

    photo_n = int(agg.n or 0) - int(agg.videos or 0)
    d["photo_count"]  = photo_n
    d["video_count"]  = int(agg.videos or 0)
    d["total_size_gb"] = round((agg.bytes or 0) / 1_073_741_824, 2)
    d["video_runtime_sec"]     = int(agg.runtime or 0)
    d["video_count_known_len"] = int(agg.vid_known or 0)
    d["image_views"]      = int(agg.views or 0)
    d["view_seconds"]     = int(agg.secs or 0)
    d["image_cum_count"]  = int(agg.cum or 0)
    d["image_edge_count"] = int(agg.edges or 0)
    d["avg_image_rating"] = round(float(agg.avg_rating), 2) if agg.avg_rating else 0.0
    d["rated_count"]      = int(agg.rated or 0)
    d["favorite_count"]   = int(agg.favs or 0)
    d["ai_tagged_count"]  = int(agg.ai_tagged or 0)
    d["first_added_at"]   = _iso(agg.first_added)
    d["last_viewed_at"]   = _iso(agg.last_viewed)

    d["rated_pct"]  = _pct(d["rated_count"], agg.n or 0)
    d["tagged_pct"] = _pct(d["ai_tagged_count"], agg.n or 0)

    # ── Attention ─────────────────────────────────────────────────────────────
    photo_agg = (
        db.query(func.sum(Image.view_seconds), func.sum(Image.view_count))
          .filter(Image.gallery_id == gallery_id, Image.is_video == False)  # noqa: E712
          .one()
    )
    p_secs, p_views = int(photo_agg[0] or 0), int(photo_agg[1] or 0)
    d["avg_dwell_seconds"] = round(p_secs / p_views, 1) if p_views else None
    d["video_watch_seconds"] = d["view_seconds"] - p_secs

    d["session_count"] = db.query(func.count(SessionLog.id)).filter(
        SessionLog.gallery_id == gallery_id).scalar() or 0

    total_views = (g.view_count or 0) + d["image_views"]
    d["gallery_views"] = g.view_count or 0
    d["total_views"]   = total_views
    d["os_per_view"]      = _ratio(g.cum_count or 0, total_views)
    d["views_per_photo"]  = _ratio(total_views, agg.n or 0)
    d["edges_per_cum"]    = _ratio(g.edge_count or 0, g.cum_count or 0, 1)
    d["os_per_hour"]      = _ratio(g.cum_count or 0, d["view_seconds"] / 3600) if d["view_seconds"] else 0.0

    prof = db.query(UserProfile).first()
    total_cum_all  = int(prof.total_cum_count or 0) if prof else 0
    total_edge_all = int(prof.total_edge_count or 0) if prof else 0
    total_secs_all = int(db.query(func.sum(Image.view_seconds)).scalar() or 0)
    d["share_of_total_cum"]   = _pct(g.cum_count or 0, total_cum_all)
    d["share_of_total_edges"] = _pct(g.edge_count or 0, total_edge_all)
    d["share_of_total_time"]  = _pct(d["view_seconds"], total_secs_all)

    # ── Rank ──────────────────────────────────────────────────────────────────
    scores = ranking.score_all_galleries(db)
    order  = ranking.ranked_gallery_ids(scores)
    d["total_galleries_ranked"] = len(order)
    d["rank"] = (order.index(gallery_id) + 1) if gallery_id in order else None
    d["hof_score"] = scores.get(gallery_id, {}).get("score", 0)
    if order and order[0] != gallery_id:
        leader = db.query(Gallery.name).filter(Gallery.id == order[0]).scalar()
        d["leader_name"]     = leader
        d["points_to_first"] = max(0, scores[order[0]]["score"] - d["hof_score"])

    # ── Standouts ─────────────────────────────────────────────────────────────
    def _top(col):
        row = (db.query(Image)
                 .filter(Image.gallery_id == gallery_id)
                 .order_by(col.desc())
                 .first())
        if not row or not (getattr(row, col.key) or 0):
            return None
        return _thumb(row)

    d["most_gooned"] = _top(Image.cum_count)
    d["most_edged"]  = _top(Image.edge_count)
    d["most_viewed"] = _top(Image.view_count)
    d["longest_watched"] = _top(Image.view_seconds)

    # ── Top tags inside the gallery ───────────────────────────────────────────
    tag_rows = (
        db.query(Tag.name, Tag.source, func.count(image_tags.c.image_id).label("n"))
          .join(image_tags, image_tags.c.tag_id == Tag.id)
          .join(Image, Image.id == image_tags.c.image_id)
          .filter(Image.gallery_id == gallery_id)
          .group_by(Tag.id)
          .order_by(func.count(image_tags.c.image_id).desc())
          .limit(12)
          .all()
    )
    d["top_tags"] = [
        {"name": n, "source": (s.value if hasattr(s, "value") else s), "count": int(c)}
        for n, s, c in tag_rows
    ]

    return d


# ── Single photo / video ──────────────────────────────────────────────────────

def image_stats(db: Session, image_id: int) -> dict:
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        return None

    d = {c.name: getattr(img, c.name) for c in img.__table__.columns}
    d["created_at"]     = _iso(img.created_at)
    d["last_viewed_at"] = _iso(img.last_viewed_at)
    d["file_modified_at"] = _iso(getattr(img, "file_modified_at", None))
    d.pop("phash", None)

    gal = db.query(Gallery).filter(Gallery.id == img.gallery_id).first()
    d["gallery"] = {"id": gal.id, "name": gal.name, "cover_thumb": gal.cover_thumb} if gal else None

    # Creators: image-level overrides if present, otherwise inherited from the gallery.
    own = (
        db.query(Creator)
          .join(image_creators, image_creators.c.creator_id == Creator.id)
          .filter(image_creators.c.image_id == image_id)
          .all()
    )
    inherited = gal.creators if (gal and not own) else []
    d["creators"] = [{"id": c.id, "name": c.name, "creator_type": c.creator_type,
                      "card_rarity": c.card_rarity} for c in (own or inherited)]
    d["creators_inherited"] = not own

    d["file_size_mb"] = round((img.file_size or 0) / 1_048_576, 2)
    d["megapixels"]   = round((img.width or 0) * (img.height or 0) / 1_000_000, 1)

    views = img.view_count or 0
    secs  = img.view_seconds or 0
    d["avg_dwell_seconds"] = round(secs / views, 1) if views else None
    d["os_per_view"]   = _ratio(img.cum_count or 0, views)
    d["edges_per_cum"] = _ratio(img.edge_count or 0, img.cum_count or 0, 1)

    # For a video, how many times over you have effectively watched its length.
    if img.is_video and (img.duration or 0) > 0:
        d["watch_throughs"] = round(secs / img.duration, 1)

    # ── Rank ──────────────────────────────────────────────────────────────────
    rank, total = ranking.image_rank(db, img)
    d["rank"] = rank
    d["total_ranked"] = total
    d["hof_score"] = round(ranking.image_score(img))

    # Rank inside its own gallery — the more meaningful comparison for a photo.
    if img.gallery_id:
        expr = ranking.image_score_expr()
        mine = ranking.image_score(img)
        higher = (db.query(func.count(Image.id))
                    .filter(Image.gallery_id == img.gallery_id, expr > mine).scalar() or 0)
        sibling = (db.query(func.count(Image.id))
                     .filter(Image.gallery_id == img.gallery_id).scalar() or 0)
        d["rank_in_gallery"]  = higher + 1
        d["gallery_siblings"] = sibling

    # ── Shares ────────────────────────────────────────────────────────────────
    prof = db.query(UserProfile).first()
    d["share_of_total_cum"] = _pct(img.cum_count or 0, int(prof.total_cum_count or 0) if prof else 0)
    if gal:
        d["share_of_gallery_cum"]  = _pct(img.cum_count or 0, gal.cum_count or 0)
        gal_secs = db.query(func.sum(Image.view_seconds)).filter(
            Image.gallery_id == gal.id).scalar() or 0
        d["share_of_gallery_time"] = _pct(secs, gal_secs)

    # ── Tags, with AI confidence ──────────────────────────────────────────────
    rows = (
        db.query(Tag.name, Tag.category, Tag.source,
                 image_tags.c.confidence, image_tags.c.tagger_model)
          .join(image_tags, image_tags.c.tag_id == Tag.id)
          .filter(image_tags.c.image_id == image_id)
          .all()
    )
    d["tags"] = [
        {"name": n, "category": cat,
         "source": (s.value if hasattr(s, "value") else s),
         "confidence": round(conf, 2) if conf is not None else None,
         "tagger_model": model}
        for n, cat, s, conf, model in rows
    ]

    return d

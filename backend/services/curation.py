"""
Collection Curating — resurfacing galleries that need attention.

The whole feature exists because of one number: a library of 20k+ galleries can
never be walked end to end. At a realistic 5-10 galleries a sitting, a single
full pass takes years. So this service does not "show you an old gallery" — it
ranks galleries by how *broken* their curation is and serves the worst first.
Random selection would spend 95% of the user's clicks on galleries that are
already fine.

Two lanes feed the queue:

  * the BELOVED lane (~40%) — galleries belonging to favourite creators, served
    round-robin so the one favourite with 1,200 messy galleries can't eat the
    lane for weeks. Round-robin is the difference between "this is hopeless"
    and four progress bars you can watch move.
  * the GENERAL lane (~60%) — pure debt score across everything else.

Scoring is split deliberately: the cheap set-membership signals are computed in
SQL over the whole table, then a shortlist is re-scored in Python for the things
SQL can't express (junk folder names, age curves). Scoring everything in Python
would mean pulling 20k rows per click.
"""
import os
import re
import random
import shutil
from datetime import datetime, timedelta

from sqlalchemy import func, select, exists, and_, or_, case
from sqlalchemy.orm import Session

from models import (
    Gallery, Image, Creator, Tag, TagSource, UserProfile,
    gallery_creators, gallery_tags, image_tags, image_creators,
)
import services.gamification as gami
from services.file_ops import rename_path


# ── Tunables ──────────────────────────────────────────────────────────────────
CURATED_COOLDOWN_DAYS = 90    # "curated" — out of rotation for a quarter
SNOOZE_DAYS           = 14    # "not now" — a skip shouldn't cost a full quarter
BELOVED_SHARE         = 0.40  # ~4 in 10 pulls come from favourite creators
SHORTLIST             = 200   # rows re-scored in Python per pull
PICK_BAND             = 25    # winner drawn from the top N of the shortlist
IMAGE_PAGE            = 300   # files sent per gallery before "load all"
IMAGE_CURATED_COOLDOWN_DAYS = 90
IMAGE_SNOOZE_DAYS           = 14

# Debt weights. Structural holes (no creator, no tags, junk name) outrank
# cosmetic ones (no cover) by roughly 5x — that ordering is the whole product.
W_NO_CREATOR    = 40
W_JUNK_NAME     = 30
W_NO_IMG_TAGS   = 15
W_NO_RATING     = 12
W_NEVER_VIEWED  = 12
W_NO_COVER      = 6
W_AGE_MAX       = 15   # full weight once the import is ~2 years old


# ── Junk folder-name detection ────────────────────────────────────────────────
# These are the names that make a library unsearchable: hashes, scraper output,
# bare numbering, release tags. Matching any of them is a strong rename signal.
_JUNK_PATTERNS = [
    re.compile(r"^[0-9a-f]{8,}$", re.I),            # hex hash / md5 fragment
    re.compile(r"^\d+$"),                            # bare digits: "1042"
    re.compile(r"^(new\s*folder|untitled|temp|tmp|misc|stuff|unsorted)", re.I),
    re.compile(r"^(downloads?|download|dl)\b", re.I),
    re.compile(r"^(set|album|gallery|folder|img|images?|pics?|photos?)[\s_-]*\d*$", re.I),
    re.compile(r"\(\d+\)$"),                         # windows dedup suffix "(1)"
    re.compile(r"\[(1080p|720p|4k|hd|xxx|rar|zip)\]", re.I),
    re.compile(r"^[\W_]+$"),                         # punctuation only
]


def _is_junk_name(name: str) -> bool:
    if not name:
        return True
    n = name.strip()
    if len(n) <= 2:
        return True
    return any(p.search(n) for p in _JUNK_PATTERNS)


# ── Cheap SQL debt score ──────────────────────────────────────────────────────
def _sql_debt_score():
    """Debt from set-membership signals, expressed so SQLite computes it.

    Everything here is an EXISTS or a column test — all of it stops at the first
    matching row, so this stays cheap even at 20k galleries.
    """
    has_creator = or_(
        Gallery.creator_id.isnot(None),
        exists(select(gallery_creators.c.gallery_id)
               .where(gallery_creators.c.gallery_id == Gallery.id)),
    )
    has_img_tags = exists(
        select(image_tags.c.image_id)
        .select_from(image_tags.join(Image, Image.id == image_tags.c.image_id))
        .where(Image.gallery_id == Gallery.id)
    )
    has_auto_cover = exists(
        select(Image.id).where(
            Image.gallery_id == Gallery.id,
            Image.thumb_path.isnot(None),
        )
    )

    return (
        case((has_creator, 0), else_=W_NO_CREATOR)
        + case((has_img_tags, 0), else_=W_NO_IMG_TAGS)
        + case((func.coalesce(Gallery.rating, 0) > 0, 0), else_=W_NO_RATING)
        + case((func.coalesce(Gallery.view_count, 0) > 0, 0), else_=W_NEVER_VIEWED)
        + case((or_(Gallery.cover_path.isnot(None), Gallery.cover_thumb.isnot(None), has_auto_cover), 0), else_=W_NO_COVER)
    )


def _eligible_filter():
    """Galleries the run is allowed to serve right now.

    Mix galleries are excluded outright — they are virtual scratch collections,
    not folders on disk, so none of the curation actions mean anything for them.
    """
    now = datetime.utcnow()
    cutoff = now - timedelta(days=CURATED_COOLDOWN_DAYS)
    return and_(
        or_(Gallery.is_mix.is_(False), Gallery.is_mix.is_(None)),
        or_(Gallery.curated_at.is_(None), Gallery.curated_at < cutoff),
        or_(Gallery.curate_snooze_until.is_(None), Gallery.curate_snooze_until < now),
    )


def _age_bonus(g: Gallery) -> float:
    """Old imports outrank last week's. Saturates at ~2 years so a 2015 folder
    and a 2018 folder aren't meaningfully different — both are simply old."""
    ref = g.scanned_at or g.created_at
    if not ref:
        return W_AGE_MAX
    days = (datetime.utcnow() - ref).days
    return W_AGE_MAX * min(1.0, max(0.0, days / 730.0))


def _python_score(g: Gallery, sql_score: float) -> float:
    score = float(sql_score or 0) + _age_bonus(g)
    folder_name = os.path.basename((g.folder_path or "").rstrip("/\\"))
    if _is_junk_name(folder_name) or _is_junk_name(g.name):
        score += W_JUNK_NAME
    return score


def _cover_image_id(db: Session, g: Gallery):
    """Find the effective manual or automatic cover image, if one exists."""
    cover_thumb_name = os.path.basename(str(g.cover_thumb or ""))
    fallback_id = None
    for image_id, file_path, thumb_path in db.query(
        Image.id, Image.file_path, Image.thumb_path,
    ).filter(
        Image.gallery_id == g.id,
    ).order_by(Image.sort_order, Image.id).all():
        if g.cover_path and file_path == g.cover_path and os.path.isfile(file_path):
            return image_id
        if thumb_path and os.path.isfile(thumb_path):
            if cover_thumb_name and os.path.basename(thumb_path) == cover_thumb_name:
                return image_id
            # Old/partially migrated rows may have a usable automatic cover
            # without either cover field populated. The first valid thumbnail
            # is the same fallback the scanner uses.
            fallback_id = fallback_id or image_id
    return fallback_id


# ── Queue ─────────────────────────────────────────────────────────────────────
def _shortlist(db: Session, extra_filter=None, exclude_ids=None):
    """Top-scoring eligible galleries, re-scored in Python and returned best-first.

    The SQL side orders by score with a random tiebreak: without it, thousands of
    galleries share the same maximum score and you would be handed the same rows
    in id order on every single pull.
    """
    score = _sql_debt_score().label("debt")
    q = db.query(Gallery, score).filter(_eligible_filter())
    if extra_filter is not None:
        q = q.filter(extra_filter)
    if exclude_ids:
        q = q.filter(~Gallery.id.in_(list(exclude_ids)))

    rows = q.order_by(score.desc(), func.random()).limit(SHORTLIST).all()
    scored = [(g, _python_score(g, s)) for g, s in rows]
    scored.sort(key=lambda r: r[1], reverse=True)
    return scored


def _pick(scored):
    """Draw from the top band rather than always taking the single worst gallery,
    so consecutive runs don't march through an identical list."""
    if not scored:
        return None
    band = scored[:PICK_BAND]
    return random.choice(band)[0]


# ── Who counts as "beloved" ───────────────────────────────────────────────────
# Favourites alone are a bad proxy. On this library the top twelve creators by
# real engagement include several with no favourite flag and no rating at all —
# a favourites-only lane would never surface any of them. So "beloved" blends
# three signals: what you actually use (the Hall of Fame's own engagement score),
# what you said (the 0-10 rating), and what you starred.
W_BELOVED_ENGAGEMENT = 0.50
W_BELOVED_RATING     = 0.30
W_BELOVED_FAVOURITE  = 0.20
BELOVED_POOL         = 25    # top N by blended score, plus every favourite

# score_all_creators sweeps 400k+ images and takes ~2s, which is far too slow to
# run on every pull. The pool only shifts as engagement accumulates, so a short
# TTL cache costs nothing in accuracy.
_BELOVED_TTL_SECONDS = 600
_beloved_cache = {"at": None, "ids": [], "detail": {}}


def favourite_creator_ids(db: Session):
    return [c.id for c in db.query(Creator.id).filter(Creator.is_favorite.is_(True)).all()]


def _compute_beloved(db: Session):
    import services.ranking as ranking

    scores = ranking.score_all_creators(db)
    ranked = ranking.ranked_creator_ids(scores)
    # Percentile rather than raw score: the top creator outscores the median by
    # orders of magnitude, and a raw-value blend would let engagement alone
    # decide everything while rating and favourite became rounding errors.
    n = max(1, len(ranked))
    pct = {cid: 1.0 - (i / n) for i, cid in enumerate(ranked)}

    creators = db.query(Creator).all()
    detail = {}
    for c in creators:
        engagement = pct.get(c.id, 0.0)
        rating = min(1.0, (c.rating or 0) / 10.0)
        fav = 1.0 if c.is_favorite else 0.0
        blended = (W_BELOVED_ENGAGEMENT * engagement
                   + W_BELOVED_RATING * rating
                   + W_BELOVED_FAVOURITE * fav)

        why = []
        if fav:                why.append("favourite")
        if (c.rating or 0) >= 8:  why.append("highly rated")
        if engagement >= 0.9:  why.append("most used")

        detail[c.id] = {
            "id": c.id, "name": c.name, "score": round(blended, 4),
            "engagement_pct": round(engagement * 100, 1),
            "rating": c.rating or 0, "is_favorite": bool(c.is_favorite),
            "why": why or ["ranked"],
        }

    top = sorted(detail.values(), key=lambda d: d["score"], reverse=True)[:BELOVED_POOL]
    ids = {d["id"] for d in top}
    # A creator you explicitly starred belongs in the lane whatever the numbers
    # say — that flag is a direct statement of intent, not an estimate.
    ids |= {c.id for c in creators if c.is_favorite}
    return sorted(ids), detail


def beloved_creator_ids(db: Session, force: bool = False):
    now = datetime.utcnow()
    cached_at = _beloved_cache["at"]
    fresh = cached_at and (now - cached_at).total_seconds() < _BELOVED_TTL_SECONDS
    if fresh and not force:
        return _beloved_cache["ids"]

    ids, detail = _compute_beloved(db)
    _beloved_cache.update({"at": now, "ids": ids, "detail": detail})
    return ids


def beloved_detail(db: Session, creator_id: int):
    beloved_creator_ids(db)   # ensures the cache is warm
    return _beloved_cache["detail"].get(creator_id)


def _creator_gallery_filter(creator_id: int):
    """Galleries belonging to a creator, via either link — the m2m is primary but
    the legacy creator_id column is still populated for the primary creator."""
    return or_(
        Gallery.creator_id == creator_id,
        Gallery.id.in_(select(gallery_creators.c.gallery_id)
                       .where(gallery_creators.c.creator_id == creator_id)),
    )


def _beloved_rotation(db: Session, beloved_ids):
    """Beloved creators ordered by who has gone longest without being curated.

    One grouped query, not one query per creator — this runs on every pull.
    Creators with no curated gallery at all sort first (NULL max → epoch).
    """
    if not beloved_ids:
        return []
    rows = (
        db.query(gallery_creators.c.creator_id,
                 func.max(Gallery.curated_at).label("last"))
          .select_from(gallery_creators)
          .join(Gallery, Gallery.id == gallery_creators.c.gallery_id)
          .filter(gallery_creators.c.creator_id.in_(beloved_ids))
          .group_by(gallery_creators.c.creator_id)
          .all()
    )
    seen = {cid: last for cid, last in rows}
    # A beloved creator with no galleries linked yet still belongs in the
    # rotation at the front — she is maximally un-curated.
    return sorted(beloved_ids, key=lambda cid: seen.get(cid) or datetime.min)


def next_gallery(db: Session, exclude_ids=None):
    """The next gallery to curate, honouring the pin, focus mode and the 40/60 split."""
    profile = gami.get_or_create_profile(db)
    exclude_ids = set(exclude_ids or [])

    # A pinned gallery is a run that was interrupted — always resume there.
    if profile.curate_pinned_gallery_id and profile.curate_pinned_gallery_id not in exclude_ids:
        pinned = db.query(Gallery).filter(Gallery.id == profile.curate_pinned_gallery_id).first()
        profile.curate_pinned_gallery_id = None
        db.commit()
        if pinned:
            return pinned, "pinned"

    beloved_ids = beloved_creator_ids(db)
    focus_id = profile.curate_focus_creator_id

    # Focus mode overrides the split entirely — the user asked for one creator.
    if focus_id:
        scored = _shortlist(db, _creator_gallery_filter(focus_id), exclude_ids)
        picked = _pick(scored)
        if picked:
            return picked, "focus"
        # Focus exhausted: fall through to the normal lanes rather than dead-ending.

    want_beloved = beloved_ids and random.random() < BELOVED_SHARE
    if want_beloved:
        for cid in _beloved_rotation(db, beloved_ids):
            scored = _shortlist(db, _creator_gallery_filter(cid), exclude_ids)
            picked = _pick(scored)
            if picked:
                return picked, "beloved"
        # Every beloved creator is fully curated — a good problem. General lane.

    picked = _pick(_shortlist(db, None, exclude_ids))
    return (picked, "general") if picked else (None, None)


# ── Payloads ──────────────────────────────────────────────────────────────────
def creator_progress(db: Session, creator_id: int):
    """curated / total for one creator — the bar that turns a hopeless mountain
    into something the user can watch move."""
    cutoff = datetime.utcnow() - timedelta(days=CURATED_COOLDOWN_DAYS)
    base = db.query(func.count(Gallery.id)).filter(_creator_gallery_filter(creator_id))
    total = base.scalar() or 0
    curated = (base.filter(Gallery.curated_at.isnot(None), Gallery.curated_at >= cutoff)
                   .scalar() or 0)
    return {"total": total, "curated": curated,
            "pct": round(100.0 * curated / total, 1) if total else 0.0}


def gallery_payload(db: Session, g: Gallery, lane: str = None, all_images: bool = False):
    """Everything the run UI needs for one gallery, in a single response."""
    creators = list(g.creators or [])
    if g.creator_id and not any(c.id == g.creator_id for c in creators):
        legacy = db.query(Creator).filter(Creator.id == g.creator_id).first()
        if legacy:
            creators.append(legacy)

    # Capped by default so a 5,000-file gallery doesn't stall the run, but the
    # cap has to be liftable: if the file that doesn't belong here is #412, a
    # 300-file window means you can never select it.
    img_q = (db.query(Image)
               .filter(Image.gallery_id == g.id)
               .order_by(Image.sort_order, Image.id))
    total_images = img_q.count()
    images = img_q.all() if all_images else img_q.limit(IMAGE_PAGE).all()

    folder_name = os.path.basename((g.folder_path or "").rstrip("/\\"))
    beloved_ids = set(beloved_creator_ids(db))
    beloved = [c for c in creators if c.id in beloved_ids]
    cover_image_id = _cover_image_id(db, g)
    has_cover = bool((g.cover_path and os.path.isfile(g.cover_path)) or cover_image_id is not None)

    # The reasons list is what makes the run feel intelligent rather than random:
    # the UI shows exactly why this gallery was pulled up.
    reasons = []
    if not creators:
        reasons.append("no creator assigned")
    if _is_junk_name(folder_name):
        reasons.append("folder name needs work")
    if not (g.rating or 0):
        reasons.append("unrated")
    if not (g.view_count or 0):
        reasons.append("never opened")
    if not has_cover:
        reasons.append("no cover set")

    return {
        "id": g.id,
        "name": g.name,
        "folder_name": folder_name,
        "folder_path": g.folder_path,
        "parent_path": os.path.dirname(g.folder_path or ""),
        "lane": lane,
        "rating": g.rating or 0,
        "description": g.description or "",
        "is_favorite": bool(g.is_favorite),
        "cover_thumb": g.cover_thumb,
        "cover_path": g.cover_path,
        "cover_image_id": cover_image_id,
        "image_count": g.image_count or total_images,
        "files_total": total_images,
        "files_shown": len(images),
        "cum_count": g.cum_count or 0,
        "view_count": g.view_count or 0,
        "period_month": g.period_month,
        "period_year": g.period_year,
        "purchase_value": g.purchase_value or 0.0,
        "curated_at": g.curated_at.isoformat() if g.curated_at else None,
        "created_at": g.created_at.isoformat() if g.created_at else None,
        "scanned_at": g.scanned_at.isoformat() if g.scanned_at else None,
        "reasons": reasons,
        "tags": [{"id": t.id, "name": t.name, "source": getattr(t.source, "value", t.source)}
                 for t in (g.tags or [])],
        "creators": [{"id": c.id, "name": c.name, "is_favorite": bool(c.is_favorite),
                      "avatar": f"/api/creators/{c.id}/avatar" if c.avatar_path else None}
                     for c in creators],
        "beloved": [{"id": c.id, "name": c.name,
                     "why": (beloved_detail(db, c.id) or {}).get("why", []),
                     **creator_progress(db, c.id)}
                    for c in beloved],
        "images": [{"id": i.id, "filename": i.filename, "is_video": bool(i.is_video),
                    "thumb": f"/api/images/{i.id}/thumb", "rating": i.rating or 0,
                    "tag_count": len(i.tags or [])}
                   for i in images],
    }


# ── File-level queue ──────────────────────────────────────────────────────────
# Gallery curation remains the default. This parallel lane is deliberately
# separate because one giant dump can contain hundreds of unrelated creators:
# a file is complete when its own metadata is complete, regardless of the
# parent folder's gallery-level state.
IMAGE_W_NO_CREATOR = 40
IMAGE_W_NO_TAGS    = 25
IMAGE_W_NO_RATING  = 12
IMAGE_W_NEVER_VIEWED = 12
IMAGE_W_AGE_MAX     = 15


def _image_eligible_filter():
    now = datetime.utcnow()
    cutoff = now - timedelta(days=IMAGE_CURATED_COOLDOWN_DAYS)
    return and_(
        or_(Gallery.is_mix.is_(False), Gallery.is_mix.is_(None)),
        Image.file_path.isnot(None),
        or_(Image.curated_at.is_(None), Image.curated_at < cutoff),
        or_(Image.curate_snooze_until.is_(None), Image.curate_snooze_until < now),
    )


def _image_has_creator():
    return or_(
        Gallery.creator_id.isnot(None),
        exists(select(gallery_creators.c.gallery_id)
               .where(gallery_creators.c.gallery_id == Image.gallery_id)),
        exists(select(image_creators.c.image_id)
               .where(image_creators.c.image_id == Image.id)),
    )


def _image_sql_debt_score():
    has_tags = exists(select(image_tags.c.image_id)
                      .where(image_tags.c.image_id == Image.id))
    return (
        case((_image_has_creator(), 0), else_=IMAGE_W_NO_CREATOR)
        + case((has_tags, 0), else_=IMAGE_W_NO_TAGS)
        + case((func.coalesce(Image.rating, 0) > 0, 0), else_=IMAGE_W_NO_RATING)
        + case((func.coalesce(Image.view_count, 0) > 0, 0), else_=IMAGE_W_NEVER_VIEWED)
    )


def _image_age_bonus(img: Image) -> float:
    ref = img.file_created_at or img.file_modified_at or img.created_at
    if not ref:
        return IMAGE_W_AGE_MAX
    return IMAGE_W_AGE_MAX * min(1.0, max(0.0, (datetime.utcnow() - ref).days / 730.0))


def _image_python_score(img: Image, sql_score: float) -> float:
    return float(sql_score or 0) + _image_age_bonus(img)


def _image_creator_filter(creator_id: int):
    """Include direct file assignments and both inherited gallery links."""
    return or_(
        _creator_gallery_filter(creator_id),
        Image.id.in_(select(image_creators.c.image_id)
                     .where(image_creators.c.creator_id == creator_id)),
    )


def _image_beloved_rotation(db: Session, beloved_ids, exclude_ids):
    """Rotate file curation independently of gallery completion and skips."""
    links = select(
        image_creators.c.creator_id.label('creator_id'), Image.curated_at.label('last'),
    ).join(Image, Image.id == image_creators.c.image_id).where(
        image_creators.c.creator_id.in_(beloved_ids), Image.curated_at.isnot(None),
    ).union_all(
        select(gallery_creators.c.creator_id, Image.curated_at)
        .join(Image, Image.gallery_id == gallery_creators.c.gallery_id)
        .where(gallery_creators.c.creator_id.in_(beloved_ids), Image.curated_at.isnot(None)),
        select(Gallery.creator_id, Image.curated_at)
        .join(Image, Image.gallery_id == Gallery.id)
        .where(Gallery.creator_id.in_(beloved_ids), Image.curated_at.isnot(None)),
    ).subquery()
    last_curated = dict(db.query(links.c.creator_id, func.max(links.c.last))
                        .group_by(links.c.creator_id).all())
    # "Later" does not mark a file curated, but it must still advance rotation.
    recent = {}
    if exclude_ids:
        shown = db.query(Image.id, Image.gallery_id).filter(Image.id.in_(exclude_ids)).all()
        gallery_ids = {gid for _, gid in shown}
        file_links = {}
        gallery_links = {}
        for iid, cid in db.query(image_creators.c.image_id, image_creators.c.creator_id).filter(
            image_creators.c.image_id.in_(exclude_ids),
        ).all():
            file_links.setdefault(iid, set()).add(cid)
        for gid, cid in db.query(gallery_creators.c.gallery_id, gallery_creators.c.creator_id).filter(
            gallery_creators.c.gallery_id.in_(gallery_ids),
        ).all():
            gallery_links.setdefault(gid, set()).add(cid)
        for gid, cid in db.query(Gallery.id, Gallery.creator_id).filter(Gallery.id.in_(gallery_ids)).all():
            if cid:
                gallery_links.setdefault(gid, set()).add(cid)
        by_id = dict(shown)
        for index, image_id in enumerate(exclude_ids):
            gid = by_id.get(image_id)
            for cid in file_links.get(image_id, set()) | gallery_links.get(gid, set()):
                recent[cid] = index
    return sorted(beloved_ids, key=lambda cid: (
        cid in recent, recent.get(cid, -1), last_curated.get(cid) or datetime.min,
    ))


def _image_shortlist(db: Session, exclude_ids=None, extra_filter=None, exclude_gallery_ids=None):
    score = _image_sql_debt_score().label("debt")
    q = (db.query(Image, score)
           .join(Gallery, Gallery.id == Image.gallery_id)
           .filter(_image_eligible_filter())
           .filter(Image.file_path.isnot(None)))
    if exclude_ids:
        q = q.filter(~Image.id.in_(list(exclude_ids)))
    if extra_filter is not None:
        q = q.filter(extra_filter)
    if exclude_gallery_ids:
        q = q.filter(~Image.gallery_id.in_(exclude_gallery_ids))
    # Randomise BEFORE limiting, as gallery curation does. ID ordering limits
    # every pull to one recently imported gallery even if Python picks randomly.
    rows = q.order_by(score.desc(), func.random()).limit(SHORTLIST).all()
    scored = [(img, _image_python_score(img, raw_score)) for img, raw_score in rows]
    scored.sort(key=lambda row: row[1], reverse=True)
    return scored


def next_image(db: Session, exclude_ids=None):
    """Use gallery curation's beloved/general split with file-level variety."""
    exclude_ids = list(exclude_ids or [])
    recent_gallery_ids = {gid for (gid,) in db.query(Image.gallery_id)
                          .filter(Image.id.in_(exclude_ids[-8:])).all()} if exclude_ids else set()
    profile = gami.get_or_create_profile(db)
    beloved_ids = beloved_creator_ids(db)
    focus_id = profile.curate_focus_creator_id

    def pick(extra_filter=None, avoid_recent=True):
        scored = _image_shortlist(db, exclude_ids, extra_filter,
                                  recent_gallery_ids if avoid_recent else None)
        return random.choice(scored[:PICK_BAND]) if scored else None

    if focus_id:
        selected = pick(_image_creator_filter(focus_id)) or pick(_image_creator_filter(focus_id), False)
        if selected:
            return (*selected, 'focus')

    if beloved_ids and random.random() < BELOVED_SHARE:
        rotation = _image_beloved_rotation(db, beloved_ids, exclude_ids)
        for cid in rotation:
            selected = pick(_image_creator_filter(cid))
            if selected:
                return (*selected, 'beloved')
        # Prefer a fresh general folder over replaying a beloved folder just
        # shown in this sitting. Explicit focus mode is the deliberate exception.

    # Repeated folders are allowed only once the other eligible folders run out.
    selected = pick() or pick(avoid_recent=False)
    return (*selected, 'general') if selected else None


def _effective_image_creators(db: Session, img: Image):
    gallery_creators_list = [{
        "id": c.id, "name": c.name, "creator_type": c.creator_type,
    } for c in (img.gallery.creators if img.gallery else [])]
    if img.gallery and img.gallery.creator_id and not any(c["id"] == img.gallery.creator_id for c in gallery_creators_list):
        legacy = db.query(Creator).filter(Creator.id == img.gallery.creator_id).first()
        if legacy:
            gallery_creators_list.append({"id": legacy.id, "name": legacy.name, "creator_type": legacy.creator_type})

    file_creator_ids = [row.creator_id for row in db.execute(
        select(image_creators.c.creator_id).where(image_creators.c.image_id == img.id)
    ).fetchall()]
    if not file_creator_ids:
        return gallery_creators_list, [], False

    file_creators = db.query(Creator).filter(Creator.id.in_(file_creator_ids)).all()
    by_id = {c.id: {"id": c.id, "name": c.name, "creator_type": c.creator_type} for c in file_creators}
    gallery_ids = {c["id"] for c in gallery_creators_list}
    merged = gallery_creators_list + [by_id[cid] for cid in file_creator_ids if cid not in gallery_ids and cid in by_id]
    return merged, file_creator_ids, True


def image_payload(db: Session, img: Image, score: float = None, lane: str = None):
    creators, file_creator_ids, has_image_creators = _effective_image_creators(db, img)
    reasons = []
    if not creators:
        reasons.append("no creator assigned")
    if not (img.tags or []):
        reasons.append("no tags")
    if not (img.rating or 0):
        reasons.append("unrated")
    if not (img.view_count or 0):
        reasons.append("never opened")
    if not reasons:
        reasons.append("due for a curation refresh")

    return {
        "id": img.id,
        "filename": img.filename,
        "lane": lane,
        "file_path": img.file_path,
        "directory_path": os.path.dirname(img.file_path) if img.file_path else None,
        "gallery_id": img.gallery_id,
        "gallery_name": img.gallery.name if img.gallery else None,
        "is_video": bool(img.is_video),
        "duration": img.duration,
        "thumb": f"/api/images/{img.id}/thumb",
        "file_url": f"/api/images/{img.id}/file",
        "rating": img.rating or 0,
        "notes": img.notes or "",
        "is_favorite": bool(img.is_favorite),
        "width": img.width,
        "height": img.height,
        "file_size": img.file_size,
        "funscript_path": img.funscript_path,
        "tags": [{"id": t.id, "name": t.name, "source": getattr(t.source, "value", t.source)} for t in (img.tags or [])],
        "creators": creators,
        "file_creator_ids": file_creator_ids,
        "has_image_creators": has_image_creators,
        "reasons": reasons,
        "curated_at": img.curated_at.isoformat() if img.curated_at else None,
        "score": round(score, 1) if score is not None else None,
    }


def image_debt_summary(db: Session):
    cutoff = datetime.utcnow() - timedelta(days=IMAGE_CURATED_COOLDOWN_DAYS)
    base = (db.query(Image).join(Gallery, Gallery.id == Image.gallery_id)
            .filter(or_(Gallery.is_mix.is_(False), Gallery.is_mix.is_(None)),
                    Image.file_path.isnot(None)))
    total = base.count()
    curated = base.filter(Image.curated_at.isnot(None), Image.curated_at >= cutoff).count()
    pending = base.filter(_image_eligible_filter()).count()
    return {
        "total": total,
        "curated": curated,
        "pending": pending,
        "pct": round(100.0 * curated / total, 1) if total else 0.0,
        "cooldown_days": IMAGE_CURATED_COOLDOWN_DAYS,
    }


def debt_summary(db: Session):
    """Headline numbers for the dashboard: how much of the library still owes work."""
    now = datetime.utcnow()
    cutoff = now - timedelta(days=CURATED_COOLDOWN_DAYS)
    not_mix = or_(Gallery.is_mix.is_(False), Gallery.is_mix.is_(None))

    total = db.query(func.count(Gallery.id)).filter(not_mix).scalar() or 0
    curated = (db.query(func.count(Gallery.id))
                 .filter(not_mix, Gallery.curated_at.isnot(None), Gallery.curated_at >= cutoff)
                 .scalar() or 0)
    pending = (db.query(func.count(Gallery.id))
                 .filter(not_mix, _eligible_filter())
                 .scalar() or 0)
    return {
        "total": total,
        "curated": curated,
        "pending": pending,
        "pct": round(100.0 * curated / total, 1) if total else 0.0,
        "cooldown_days": CURATED_COOLDOWN_DAYS,
    }


# ── Applying a curation ───────────────────────────────────────────────────────
def _rename_folder(db: Session, g: Gallery, new_name: str):
    """Rename the folder and keep the Vault gallery name identical to it."""
    new_name = (new_name or "").strip()
    if not new_name or any(c in new_name for c in ("/", "\\", "\x00")) or new_name in (".", ".."):
        raise ValueError("Invalid folder name")

    old_path = g.folder_path
    if not old_path or not os.path.isdir(old_path):
        raise ValueError("Gallery folder not found on disk")

    parent = os.path.dirname(old_path)
    new_path = os.path.join(parent, new_name)
    if os.path.normpath(new_path) == os.path.normpath(old_path):
        g.name = new_name
        return False
    if os.path.exists(new_path):
        raise ValueError(f"A folder named '{new_name}' already exists alongside it")

    rename_path(old_path, new_path)

    for img in db.query(Image).filter(Image.gallery_id == g.id).all():
        if img.file_path and (img.file_path == old_path or img.file_path.startswith(old_path + os.sep) or img.file_path.startswith(old_path + '/')):
            img.file_path = new_path + img.file_path[len(old_path):]
        if img.funscript_path and (img.funscript_path == old_path or img.funscript_path.startswith(old_path + os.sep) or img.funscript_path.startswith(old_path + '/')):
            img.funscript_path = new_path + img.funscript_path[len(old_path):]

    g.name = new_name
    g.folder_path = new_path
    return True


def _apply_tags(db: Session, g: Gallery, tag_names):
    """Replace the gallery's tag set. use_count is maintained on both sides so the
    tag manager's counts stay honest."""
    wanted = {(t or "").lower().strip() for t in tag_names if (t or "").strip()}
    current = {t.name: t for t in (g.tags or [])}
    changed = 0

    for name in list(current):
        if name not in wanted:
            tag = current[name]
            g.tags.remove(tag)
            tag.use_count = max(0, (tag.use_count or 0) - 1)
            changed += 1

    for name in wanted:
        if name in current:
            continue
        tag = db.query(Tag).filter(Tag.name == name).first()
        if not tag:
            tag = Tag(name=name, source=TagSource.manual)
            db.add(tag)
            db.flush()
        g.tags.append(tag)
        tag.use_count = (tag.use_count or 0) + 1
        changed += 1

    return changed


def _apply_creators(db: Session, g: Gallery, creator_ids):
    wanted = {int(c) for c in (creator_ids or [])}
    current = {c.id for c in (g.creators or [])}
    if wanted == current:
        return 0

    g.creators = db.query(Creator).filter(Creator.id.in_(wanted)).all() if wanted else []
    # Keep the legacy primary-creator column consistent with the m2m.
    g.creator_id = next(iter(wanted), None) if wanted else None
    g.is_tagged = bool(wanted)
    return 1


def save(db: Session, gallery_id: int, payload: dict, mark_curated: bool = True):
    """Commit one gallery's staged edits, then mark it curated.

    XP scales with how much was actually fixed, but never falls to zero — the
    fast "looks good" path has to stay attractive or the run becomes a chore and
    dies. Rewards only, never penalties.
    """
    g = db.query(Gallery).filter(Gallery.id == gallery_id).first()
    if not g:
        raise ValueError("Gallery not found")

    fixes = []

    folder_name = payload.get("folder_name")
    if folder_name is not None:
        if folder_name.strip():
            old_display_name = g.name
            if _rename_folder(db, g, folder_name):
                fixes.append("renamed")
            elif g.name != old_display_name:
                fixes.append("renamed")

    if "creator_ids" in payload and _apply_creators(db, g, payload["creator_ids"]):
        fixes.append("creators")

    if "tags" in payload and _apply_tags(db, g, payload["tags"]):
        fixes.append("tags")

    if payload.get("rating") is not None and float(payload["rating"]) != (g.rating or 0):
        g.rating = float(payload["rating"])
        fixes.append("rated")

    if payload.get("cover_image_id"):
        img = db.query(Image).filter(Image.id == int(payload["cover_image_id"]),
                                     Image.gallery_id == g.id).first()
        if img and img.file_path != g.cover_path:
            g.cover_path = img.file_path
            g.cover_thumb = img.thumb_path
            fixes.append("cover")

    if payload.get("description") is not None and payload["description"] != (g.description or ""):
        g.description = payload["description"]
        fixes.append("description")

    if payload.get("is_favorite") is not None and bool(payload["is_favorite"]) != bool(g.is_favorite):
        g.is_favorite = bool(payload["is_favorite"])
        fixes.append("favorite")

    for field in ("period_month", "period_year"):
        if field in payload and payload[field] != getattr(g, field):
            setattr(g, field, payload[field])
            if "period" not in fixes:
                fixes.append("period")

    if "purchase_value" in payload and payload["purchase_value"] is not None:
        val = float(payload["purchase_value"])
        if val != (g.purchase_value or 0.0):
            g.purchase_value = val
            if "period" not in fixes:
                fixes.append("period")

    if mark_curated:
        g.curated_at = datetime.utcnow()
        g.curate_snooze_until = None

    db.commit()

    xp_event = None
    if mark_curated:
        xp_event = _award_curation(db, len(fixes))

    return {"gallery_id": g.id, "fixes": fixes, "xp": xp_event}


def _apply_image_creators(db: Session, img: Image, creator_ids):
    wanted = {int(cid) for cid in (creator_ids or [])}
    valid = {c.id for c in db.query(Creator).filter(Creator.id.in_(wanted)).all()} if wanted else set()
    current = {row.creator_id for row in db.execute(
        select(image_creators.c.creator_id).where(image_creators.c.image_id == img.id)
    ).fetchall()}
    if valid == current:
        return 0
    db.execute(image_creators.delete().where(image_creators.c.image_id == img.id))
    if valid:
        db.execute(image_creators.insert(), [{"image_id": img.id, "creator_id": cid} for cid in sorted(valid)])
    return 1


def save_image(db: Session, image_id: int, payload: dict, mark_curated: bool = True):
    """Commit metadata for one file and optionally take it out of file debt."""
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise ValueError("File not found")

    fixes = []
    if "creator_ids" in payload and _apply_image_creators(db, img, payload["creator_ids"]):
        fixes.append("creators")
    if "tags" in payload and _apply_tags(db, img, payload["tags"]):
        fixes.append("tags")
    if payload.get("rating") is not None and float(payload["rating"]) != (img.rating or 0):
        img.rating = float(payload["rating"])
        fixes.append("rated")
    if payload.get("is_favorite") is not None and bool(payload["is_favorite"]) != bool(img.is_favorite):
        img.is_favorite = bool(payload["is_favorite"])
        fixes.append("favorite")
    if payload.get("notes") is not None and payload["notes"] != (img.notes or ""):
        img.notes = payload["notes"]
        fixes.append("notes")

    if mark_curated:
        img.curated_at = datetime.utcnow()
        img.curate_snooze_until = None

    db.commit()

    xp_event = None
    if mark_curated:
        xp_event = _award_image_curation(db, len(fixes))
    return {"image_id": img.id, "fixes": fixes, "xp": xp_event}


def _award_image_curation(db: Session, fix_count: int):
    profile = gami.get_or_create_profile(db)
    today = datetime.utcnow().date()
    last = profile.last_curate_date.date() if profile.last_curate_date else None
    if last != today:
        profile.curate_streak_days = (profile.curate_streak_days or 0) + 1 if last == today - timedelta(days=1) else 1
        profile.last_curate_date = datetime.utcnow()
    profile.total_images_curated = (profile.total_images_curated or 0) + 1
    db.commit()
    amount = min(60, 8 + 6 * max(0, fix_count))
    return gami.notify_action(db, "image_curated", override_amount=amount)


def snooze_image(db: Session, image_id: int, days: int = IMAGE_SNOOZE_DAYS):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise ValueError("File not found")
    img.curate_snooze_until = datetime.utcnow() + timedelta(days=days)
    db.commit()
    return {"image_id": img.id, "snoozed_until": img.curate_snooze_until.isoformat()}


def _award_curation(db: Session, fix_count: int):
    """Flat floor plus a per-fix bonus, capped. Deliberately generous at zero
    fixes: 'nothing wrong here' is the exit most galleries should take."""
    profile = gami.get_or_create_profile(db)
    today = datetime.utcnow().date()
    last = profile.last_curate_date.date() if profile.last_curate_date else None

    if last != today:
        if last == today - timedelta(days=1):
            profile.curate_streak_days = (profile.curate_streak_days or 0) + 1
        else:
            profile.curate_streak_days = 1
        profile.last_curate_date = datetime.utcnow()

    profile.total_galleries_curated = (profile.total_galleries_curated or 0) + 1
    db.commit()

    # notify_action awards the XP itself and advances quests/achievements — going
    # through it (rather than award_xp directly) is what wires curation into the
    # quest system, and calling both would pay out twice.
    amount = min(70, 10 + 8 * max(0, fix_count))
    return gami.notify_action(db, "gallery_curated", override_amount=amount)


def snooze(db: Session, gallery_id: int, days: int = SNOOZE_DAYS):
    g = db.query(Gallery).filter(Gallery.id == gallery_id).first()
    if not g:
        raise ValueError("Gallery not found")
    g.curate_snooze_until = datetime.utcnow() + timedelta(days=days)
    db.commit()
    return {"gallery_id": g.id, "snoozed_until": g.curate_snooze_until.isoformat()}


def set_pin(db: Session, gallery_id):
    """Remember where an interrupted run left off. Cleared when it is served."""
    profile = gami.get_or_create_profile(db)
    profile.curate_pinned_gallery_id = int(gallery_id) if gallery_id else None
    db.commit()
    return {"pinned": profile.curate_pinned_gallery_id}


def set_focus(db: Session, creator_id):
    profile = gami.get_or_create_profile(db)
    profile.curate_focus_creator_id = int(creator_id) if creator_id else None
    db.commit()
    return {"focus_creator_id": profile.curate_focus_creator_id}


def run_state(db: Session):
    profile = gami.get_or_create_profile(db)
    focus = None
    if profile.curate_focus_creator_id:
        c = db.query(Creator).filter(Creator.id == profile.curate_focus_creator_id).first()
        if c:
            focus = {"id": c.id, "name": c.name, **creator_progress(db, c.id)}
    return {
        "focus": focus,
        "streak_days": profile.curate_streak_days or 0,
        "total_curated": profile.total_galleries_curated or 0,
        "pinned_gallery_id": profile.curate_pinned_gallery_id,
        **debt_summary(db),
    }

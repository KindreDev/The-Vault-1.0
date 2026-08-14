from fastapi import APIRouter, Body, Depends, HTTPException, UploadFile, File, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, case, select, union, or_
from typing import List, Optional
from PIL import Image as PILImage
from io import BytesIO
import httpx
import re
import statistics
import uuid
import os

from database import get_db, DATA_DIR
from models import (
    Creator, Gallery, Image, SessionLog, Tag, UserProfile,
    Card, CardInventory, CreatorShowcase, CompanionMessage,
    gallery_creators, image_creators, image_tags,
)
from schemas import CreatorCreate, CreatorUpdate, CreatorOut
import services.gamification as gami
from services import activity
from services import crowns
from services import ranking

THUMBS_DIR = os.path.join(DATA_DIR, "thumbs")

# Avatar upload limits
AVATAR_MAX_BYTES = 50 * 1024 * 1024  # 50 MB
AVATAR_ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP", "GIF"}
AVATAR_FORMAT_EXT = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "GIF": ".gif"}

router = APIRouter()


def _enrich(c: Creator, db: Session) -> dict:
    d = {col.name: getattr(c, col.name) for col in c.__table__.columns}
    # Count galleries via M2M (primary source of truth)
    gallery_count = db.query(gallery_creators).filter(
        gallery_creators.c.creator_id == c.id
    ).count()
    d["gallery_count"] = gallery_count
    # Additive model: count distinct images belonging to this creator via EITHER path.
    # UNION deduplicates so an image counted in both paths is only counted once.
    gallery_img_ids = (
        select(Image.id)
        .join(Gallery, Gallery.id == Image.gallery_id)
        .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
        .where(gallery_creators.c.creator_id == c.id)
    )
    file_img_ids = (
        select(image_creators.c.image_id.label('id'))
        .where(image_creators.c.creator_id == c.id)
    )
    all_ids_sq = union(gallery_img_ids, file_img_ids).subquery()
    d["image_count"] = db.query(func.count()).select_from(all_ids_sq).scalar() or 0
    d["session_count"] = db.query(SessionLog).filter(SessionLog.creator_id == c.id).count()
    all_ids_sq2 = union(gallery_img_ids, file_img_ids).subquery()
    d["total_view_seconds"] = (
        db.query(func.sum(Image.view_seconds))
          .join(all_ids_sq2, Image.id == all_ids_sq2.c.id)
          .scalar() or 0
    )
    # "Total views" means exactly that: every gallery open PLUS every photo and
    # video view. Kept split so callers can show the breakdown.
    all_ids_sq2b = union(gallery_img_ids, file_img_ids).subquery()
    d["image_views"] = (
        db.query(func.sum(Image.view_count))
          .join(all_ids_sq2b, Image.id == all_ids_sq2b.c.id)
          .scalar() or 0
    )
    d["gallery_views"] = (
        db.query(func.sum(Gallery.view_count))
          .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
          .filter(gallery_creators.c.creator_id == c.id)
          .scalar() or 0
    )
    d["total_views"] = int(d["image_views"]) + int(d["gallery_views"])
    # Extra stats: video count, total cum count, total file size
    all_ids_sq3 = union(gallery_img_ids, file_img_ids).subquery()
    img_stats = (
        db.query(
            func.sum(case((Image.is_video == True, 1), else_=0)).label("video_count"),
            func.sum(Image.cum_count).label("cum_count"),
            func.sum(Image.edge_count).label("edge_count"),
            func.sum(Image.file_size).label("total_bytes"),
        )
        .join(all_ids_sq3, Image.id == all_ids_sq3.c.id)
        .one()
    )
    d["video_count"] = int(img_stats.video_count or 0)
    d["cum_count"]   = int(img_stats.cum_count or 0)
    d["edge_count"]  = int(img_stats.edge_count or 0)
    # file_size is null for images scanned before that column existed — fall back to os.stat
    db_bytes = img_stats.total_bytes or 0
    if db_bytes == 0:
        # sum file sizes from the actual paths for images belonging to this creator
        all_paths = (
            db.query(Image.file_path)
            .join(all_ids_sq3, Image.id == all_ids_sq3.c.id)
            .all()
        )
        db_bytes = sum(
            os.path.getsize(r.file_path)
            for r in all_paths
            if r.file_path and os.path.exists(r.file_path)
        )
    d["total_size_gb"] = round(db_bytes / 1_073_741_824, 2)
    d["card_rarity"] = _compute_rarity(
        image_count=d["image_count"],
        rating=float(c.rating or 0),
        session_count=d["session_count"],
    )
    # Bond level — organic accumulation + gifted hearts; excluded for male/unknown artists
    view_secs  = int(d["total_view_seconds"] or 0)
    sess_count = int(d["session_count"] or 0)
    bond_gifts = int(c.bond_gifts or 0)
    bond_score = view_secs * 0.1 + sess_count * 50 + bond_gifts * 500
    thresholds = [100, 500, 1500, 3000, 6000]
    computed_bond = sum(1 for t in thresholds if bond_score >= t)
    is_excluded = (c.creator_type == 'artist' and c.gender not in ('Female', 'Other'))
    d["bond_score"]    = round(bond_score, 1)
    d["bond_excluded"] = is_excluded
    d["bond_level"]    = 0 if is_excluded else computed_bond
    d["bond_gifts"]    = bond_gifts
    # Collection value & completion stats
    stats = gami.calc_creator_stats(db, c.id)
    d["collection_value"] = stats.get("total_value", 0.0)
    d["sub_value"] = stats.get("sub_value", 0.0)
    d["one_time_value"] = stats.get("one_time_value", 0.0)
    d["unique_months_total"] = stats.get("unique_months_total", 0)
    d["months_covered_recent"] = stats.get("months_covered_recent", 0)
    d["total_months_expected"] = stats.get("total_months_expected", 0)
    d["completion_pct"] = stats.get("completion_pct", 0.0)
    return d


def _compute_rarity(image_count: int, rating: float = 0.0, session_count: int = 0) -> str:
    """Tier is purely based on file count. 5 tiers, calibrated for large collections."""
    if image_count >= 15000: return "legendary"   # Grand Collection
    if image_count >= 6000:  return "epic"         # Library
    if image_count >= 2500:  return "rare"         # Big Portfolio
    if image_count >= 500:   return "uncommon"     # Album
    return "common"                                # Snapshot


@router.get("/", response_model=List[CreatorOut])
def list_creators(
    response: Response,
    db: Session = Depends(get_db),
    creator_type: Optional[str] = None,
    favorite: Optional[bool] = None,
    search: Optional[str] = None,
    series: Optional[str] = None,  # franchise / series filter (partial match)
    sort_by: Optional[str] = "name",  # name | rating | image_count | cum_count | date_added | rarity | random
    sort_dir: Optional[str] = None,  # asc | desc
    skip: int = 0,
    limit: int = 200,
):
    _RARITY_RANK = case(
        (Creator.card_rarity == 'legendary', 0),
        (Creator.card_rarity == 'epic',      1),
        (Creator.card_rarity == 'rare',      2),
        (Creator.card_rarity == 'uncommon',  3),
        (Creator.card_rarity == 'common',    4),
        else_=5,
    )
    q = db.query(Creator)
    if creator_type:
        q = q.filter(Creator.creator_type == creator_type)
    if favorite is not None:
        q = q.filter(Creator.is_favorite == favorite)
    if search:
        q = q.filter(Creator.name.ilike(f"%{search}%"))
    if series:
        q = q.filter(Creator.series.ilike(f"%{series}%"))

    # Total count under the current filters, exposed so the frontend can
    # compute the real last page instead of guessing with a fixed window.
    response.headers["X-Total-Count"] = str(q.order_by(None).count())

    # Sorting — sort_dir overrides default direction per column
    use_asc = None
    if sort_dir == "asc":
        use_asc = True
    elif sort_dir == "desc":
        use_asc = False

    if sort_by == "rating":
        col = Creator.rating
        asc_dir = use_asc if use_asc is not None else False
        q = q.order_by(col.asc() if asc_dir else col.desc(), Creator.name)
    elif sort_by == "date_added":
        col = Creator.created_at
        asc_dir = use_asc if use_asc is not None else False
        q = q.order_by(col.asc() if asc_dir else col.desc())
    elif sort_by == "image_count":
        # Sum of Gallery.image_count per creator, via the gallery_creators M2M join
        # table — matches how image_count is actually computed for display below
        # (galleries are assigned to creators through this table, not the legacy
        # Gallery.creator_id FK, which is stale/unpopulated for most galleries).
        img_subq = (
            db.query(
                gallery_creators.c.creator_id.label("creator_id"),
                func.sum(Gallery.image_count).label("total_images")
            )
            .join(Gallery, Gallery.id == gallery_creators.c.gallery_id)
            .group_by(gallery_creators.c.creator_id)
            .subquery()
        )
        q = q.outerjoin(img_subq, Creator.id == img_subq.c.creator_id)
        asc_dir = use_asc if use_asc is not None else False
        
        # Place creators with 0 photos at the bottom of the "most photos" list
        has_photos_case = case(
            (func.coalesce(img_subq.c.total_images, 0) > 0, 1),
            else_=0
        )
        q = q.order_by(
            has_photos_case.desc(),
            img_subq.c.total_images.asc() if asc_dir else img_subq.c.total_images.desc(),
            Creator.name
        )
    elif sort_by == "cum_count":
        # Sum of Gallery.cum_count per creator, via the gallery_creators M2M join
        # table — same reasoning as the image_count sort above.
        cum_subq = (
            db.query(
                gallery_creators.c.creator_id.label("creator_id"),
                func.sum(Gallery.cum_count).label("total_cums")
            )
            .join(Gallery, Gallery.id == gallery_creators.c.gallery_id)
            .group_by(gallery_creators.c.creator_id)
            .subquery()
        )
        q = q.outerjoin(cum_subq, Creator.id == cum_subq.c.creator_id)
        asc_dir = use_asc if use_asc is not None else False
        
        has_cums_case = case(
            (func.coalesce(cum_subq.c.total_cums, 0) > 0, 1),
            else_=0
        )
        q = q.order_by(
            has_cums_case.desc(),
            cum_subq.c.total_cums.asc() if asc_dir else cum_subq.c.total_cums.desc(),
            Creator.name
        )
    elif sort_by == "rarity":
        asc_dir = use_asc if use_asc is not None else True
        q = q.order_by(
            _RARITY_RANK.asc() if asc_dir else _RARITY_RANK.desc(),
            Creator.name
        )
    elif sort_by == "random":
        q = q.order_by(func.random())
    else:  # name
        col = Creator.name
        asc_dir = use_asc if use_asc is not None else True
        q = q.order_by(
            col.asc() if asc_dir else col.desc()
        )

    creators = q.offset(skip).limit(limit).all()
    if not creators:
        return []

    # ── Batch all per-creator stats into 4 queries instead of 4×N ────────────
    # Previously _enrich() fired 4 individual queries per creator — with 50 creators
    # on the list page that's 200+ queries. This batches them into 4 GROUP BY queries.
    creator_ids = [c.id for c in creators]

    gallery_counts = dict(
        db.query(gallery_creators.c.creator_id,
                 func.count(gallery_creators.c.gallery_id))
        .filter(gallery_creators.c.creator_id.in_(creator_ids))
        .group_by(gallery_creators.c.creator_id)
        .all()
    )
    image_counts = dict(
        db.query(gallery_creators.c.creator_id,
                 func.coalesce(func.sum(Gallery.image_count), 0))
        .join(Gallery, Gallery.id == gallery_creators.c.gallery_id)
        .filter(gallery_creators.c.creator_id.in_(creator_ids))
        .group_by(gallery_creators.c.creator_id)
        .all()
    )
    session_counts = dict(
        db.query(SessionLog.creator_id,
                 func.count(SessionLog.id))
        .filter(SessionLog.creator_id.in_(creator_ids))
        .group_by(SessionLog.creator_id)
        .all()
    )
    view_secs = dict(
        db.query(gallery_creators.c.creator_id,
                 func.coalesce(func.sum(Image.view_seconds), 0))
        .join(Gallery, Gallery.id == gallery_creators.c.gallery_id)
        .join(Image, Image.gallery_id == Gallery.id)
        .filter(gallery_creators.c.creator_id.in_(creator_ids))
        .group_by(gallery_creators.c.creator_id)
        .all()
    )

    result = []
    for c in creators:
        d = {col.name: getattr(c, col.name) for col in c.__table__.columns}
        gc = gallery_counts.get(c.id, 0)
        ic = int(image_counts.get(c.id, 0) or 0)
        sc = session_counts.get(c.id, 0)
        vs = int(view_secs.get(c.id, 0) or 0)

        d["gallery_count"]     = gc
        d["image_count"]       = ic
        d["session_count"]     = sc
        d["total_view_seconds"] = vs

        # Rarity — preserve manually pinned celestial
        if c.card_rarity == 'celestial':
            d["card_rarity"] = 'celestial'
        else:
            d["card_rarity"] = _compute_rarity(ic, float(c.rating or 0), sc)

        # Bond — organic accumulation + gifted hearts; excluded for male/unknown artists
        bg = int(c.bond_gifts or 0)
        bs = vs * 0.1 + sc * 50 + bg * 500
        _thresholds = [100, 500, 1500, 3000, 6000]
        computed_bond = sum(1 for t in _thresholds if bs >= t)
        is_excl = (c.creator_type == 'artist' and c.gender not in ('Female', 'Other'))
        d["bond_score"]    = round(bs, 1)
        d["bond_excluded"] = is_excl
        d["bond_level"]    = 0 if is_excl else computed_bond
        d["bond_gifts"]    = bg

        # Collection stats are not shown on list cards — the profile page fetches
        # the full single-creator endpoint which uses _enrich() with all stats.
        d["collection_value"]       = 0.0
        d["sub_value"]              = 0.0
        d["one_time_value"]         = 0.0
        d["unique_months_total"]    = 0
        d["months_covered_recent"]  = 0
        d["total_months_expected"]  = 0
        d["completion_pct"]         = 0.0
        result.append(d)

    return result


@router.post("/", response_model=CreatorOut, status_code=201)
def create_creator(data: CreatorCreate, db: Session = Depends(get_db)):
    creator = Creator(**data.model_dump())
    db.add(creator)
    db.flush()  # assign id so the personality seed is stable
    from services.companion import assign_personality
    assign_personality(creator)
    db.commit()
    db.refresh(creator)
    gami.notify_action(db, "creator_added")
    gami.unlock_achievement(db, "first_creator")
    return _enrich(creator, db)


@router.get("/by-country")
def creators_by_country(db: Session = Depends(get_db)):
    """Returns a list of {country, count, creators} grouped by the country field."""
    from sqlalchemy import text as sqlt
    rows = db.execute(sqlt("""
        SELECT country, COUNT(*) as cnt,
               GROUP_CONCAT(id, ',') as ids,
               GROUP_CONCAT(name, '||') as names,
               GROUP_CONCAT(COALESCE(avatar_path, ''), '||') as avatars
        FROM creators
        WHERE country IS NOT NULL AND country != ''
        GROUP BY country
        ORDER BY cnt DESC
    """)).fetchall()
    result = []
    for r in rows:
        ids     = [int(x) for x in r[2].split(",") if x]
        names   = [x for x in r[3].split("||") if x]
        avatars = r[4].split("||") if r[4] else [""] * len(ids)
        # Pad avatars list if shorter than ids
        while len(avatars) < len(ids):
            avatars.append("")
        result.append({
            "country": r[0],
            "count":   r[1],
            "creators": [
                {"id": ids[i], "name": names[i], "avatar_path": avatars[i] or None}
                for i in range(len(ids))
            ]
        })
    return result


@router.get("/distribution")
def creator_distribution(db: Session = Depends(get_db)):
    """Counts of creators by type and by computed rarity — used by the Stats page."""
    from sqlalchemy import func as sqlfunc
    type_rows   = db.query(Creator.creator_type, sqlfunc.count(Creator.id)).group_by(Creator.creator_type).all()
    # Rarity is computed live in _enrich; read it from the stored card_rarity column
    rarity_rows = db.query(Creator.card_rarity,  sqlfunc.count(Creator.id)).group_by(Creator.card_rarity).all()
    return {
        "by_type":   {t or "custom": int(c) for t, c in type_rows},
        "by_rarity": {r or "common": int(c) for r, c in rarity_rows},
        "total":     db.query(Creator).count(),
    }


@router.get("/hall-of-fame")
def creator_hall_of_fame(db: Session = Depends(get_db), limit: int = 5, offset: int = 0,
                         period: str = "all"):
    """Creators ranked by composite engagement score — see services/ranking.py
    for the formula. Scoring lives there so this endpoint and the per-creator
    stats endpoint can never disagree about a creator's rank again.

    period is day | week | month | all. Anything but all is scored from the
    activity_events log rather than the lifetime counters, so it reflects only
    what happened inside the window.
    """
    # Crown anything that closed since the last sweep. Cheap once the backfill
    # has run (it resumes from the newest crown), and it means a champion is
    # decided at midnight without waiting for the next restart.
    try:
        crowns.award_due_crowns(db)
    except Exception:
        pass

    since = activity.period_start(period)
    if since is None:
        scores = ranking.score_all_creators(db)
        order  = ranking.ranked_creator_ids(scores)
    else:
        scores = ranking.score_all_creators_in_period(db, since)
        order  = ranking.ranked_ids(scores)
    if not order:
        return []

    # Movement is computed over the FULL ranking, not just the page being
    # returned, so "dropped 10 places" is true globally. Each period keeps its
    # own movement table so today's climb isn't overwritten by the all-time
    # ordering; all-time keeps the original unsuffixed key so the arrows that
    # were already on screen survive this change.
    entity_key = "creator" if since is None else f"creator:{period}"
    deltas = ranking.apply_rank_movement(db, entity_key, order)

    page_ids = order[offset:offset + limit]
    crown_counts = crowns.crown_counts_bulk(db, page_ids)

    # offset lets the "know more" list page through the whole ranking while
    # keeping each entry's true global rank.
    out = []
    for rank, cid in enumerate(order[offset:offset + limit], start=offset + 1):
        creator = db.query(Creator).filter(Creator.id == cid).first()
        if not creator:
            continue
        d = _enrich(creator, db)
        d.update(scores[cid])
        d["hof_score"]    = scores[cid]["score"]
        d["rank"]         = rank
        d["rank_change"]  = deltas.get(cid, 0)
        d["crown_count"]  = crown_counts.get(cid, 0)
        out.append(d)
    return out


@router.get("/leaderboard")
def creator_leaderboard(metric: str = "time_spent", limit: int = 30, offset: int = 0,
                        db: Session = Depends(get_db)):
    """Every creator ranked by one specific stat, paged.

    The Stats page shows only the top six of each chart; this is the full list
    behind them. Scores come from the same ranking service the Hall of Fame
    uses, so a creator's numbers are identical wherever they appear.
    """
    METRICS = {
        "time_spent": ("total_view_seconds", "watch time"),
        "sessions":   ("session_count",      "sessions"),
        "edges":      ("total_edges",        "edges"),
        "cum":        ("total_cum",          "orgasms"),
        "views":      ("total_views",        "views"),
    }
    if metric not in METRICS:
        raise HTTPException(400, f"metric must be one of {', '.join(METRICS)}")
    key, label = METRICS[metric]

    scores = ranking.score_all_creators(db)
    scores.pop("_median_dwell", None)
    order = [cid for cid, _ in sorted(
        ((cid, v.get(key) or 0) for cid, v in scores.items()),
        key=lambda kv: kv[1], reverse=True,
    ) if scores[cid].get(key)]

    page = order[offset:offset + limit]
    rows = db.query(Creator).filter(Creator.id.in_(page)).all() if page else []
    by_id = {c.id: c for c in rows}

    out = []
    for n, cid in enumerate(page):
        c = by_id.get(cid)
        if not c:
            continue
        s = scores[cid]
        out.append({
            "id": c.id, "name": c.name, "creator_type": c.creator_type,
            "card_rarity": c.card_rarity, "avatar_path": c.avatar_path,
            "rank": offset + n + 1,
            "metric": metric, "metric_label": label, "value": s.get(key) or 0,
            "total_views": s.get("total_views"), "total_cum": s.get("total_cum"),
            "total_edges": s.get("total_edges"),
            "total_view_seconds": s.get("total_view_seconds"),
            "session_count": s.get("session_count"),
            "avg_dwell_seconds": s.get("avg_dwell_seconds"),
        })
    return out


@router.get("/top-by-value")
def top_creators_by_value(db: Session = Depends(get_db), limit: int = 5):
    """Creators ranked by total collection value — batch-loaded to avoid N+1 queries."""
    creators = db.query(Creator.id, Creator.name, Creator.creator_type, Creator.patreon_price).all()
    if not creators:
        return []

    # Batch-load all galleries (only value-relevant columns)
    galleries = db.query(
        Gallery.id, Gallery.creator_id, Gallery.period_month, Gallery.period_year, Gallery.purchase_value
    ).all()
    gallery_map = {g.id: g for g in galleries}

    # Batch-load all M2M creator→gallery associations
    gc_rows = db.execute(gallery_creators.select()).fetchall()

    # Build creator_id → set of gallery_ids (M2M + primary)
    creator_gallery_ids: dict = {c.id: set() for c in creators}
    for gc in gc_rows:
        if gc.creator_id in creator_gallery_ids:
            creator_gallery_ids[gc.creator_id].add(gc.gallery_id)
    for g in galleries:
        if g.creator_id and g.creator_id in creator_gallery_ids:
            creator_gallery_ids[g.creator_id].add(g.id)

    ranked = []
    for c in creators:
        monthly_price = c.patreon_price or 0.0
        unique_months: set = set()
        one_time_total = 0.0
        for gid in creator_gallery_ids.get(c.id, set()):
            g = gallery_map.get(gid)
            if g:
                if g.period_month and g.period_year:
                    unique_months.add((g.period_year, g.period_month))
                if g.purchase_value:
                    one_time_total += g.purchase_value
        total_value = len(unique_months) * monthly_price + one_time_total
        if total_value > 0:
            ranked.append({
                "id": c.id,
                "name": c.name,
                "creator_type": c.creator_type,
                "collection_value": round(total_value, 2),
            })

    ranked.sort(key=lambda x: x["collection_value"], reverse=True)
    return ranked[:limit]


def _parse_physical(about: str) -> dict:
    """Best-effort extraction of height, age, gender from MAL character about text."""
    out = {}
    if not about:
        return out

    # Height — "165 cm", "165cm", "Height: 165", also feet/inches
    h = re.search(r'(?:height[:\s]*)?(\d{2,3})\s*cm', about, re.IGNORECASE)
    if h:
        val = int(h.group(1))
        if 100 <= val <= 250:
            out["height_cm"] = val
    else:
        ft = re.search(r"(\d)['′](\d{1,2})[\"″]?", about)
        if ft:
            cm = round((int(ft.group(1)) * 12 + int(ft.group(2))) * 2.54)
            if 100 <= cm <= 250:
                out["height_cm"] = cm

    # Age — "Age: 17", "17 years old", "17-year-old"
    age = re.search(r'\bage[d]?[:\s]+(\d{1,3})', about, re.IGNORECASE)
    if not age:
        age = re.search(r'(\d{1,3})[\s\-]year[s]?[\s\-]old', about, re.IGNORECASE)
    if age:
        val = int(age.group(1))
        if 1 <= val <= 120:
            out["age"] = val

    # Gender — explicit label first, then pronoun scan of first 300 chars
    gm = re.search(r'\bgender[:\s]+(male|female)\b', about, re.IGNORECASE)
    if gm:
        out["gender"] = gm.group(1).capitalize()
    else:
        snippet = about[:300]
        females = len(re.findall(r'\b(she|her|girl|woman)\b', snippet, re.IGNORECASE))
        males   = len(re.findall(r'\b(he|him|boy|man)\b',    snippet, re.IGNORECASE))
        if females > males and females >= 2:
            out["gender"] = "Female"
        elif males > females and males >= 2:
            out["gender"] = "Male"

    return out


@router.get("/jikan-search")
async def jikan_search(q: str, limit: int = 8):
    """Search MyAnimeList characters via the Jikan v4 API (no auth required)."""
    if not q or len(q.strip()) < 2:
        return []
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                "https://api.jikan.moe/v4/characters",
                params={"q": q.strip(), "limit": limit, "order_by": "favorites", "sort": "desc"},
            )
        # Without this an upstream failure (504 when MyAnimeList is unreachable,
        # 429 when rate-limited) parses to a body with no "data" key and returns
        # an empty list — indistinguishable from "no character matched", which
        # makes an outage look like a broken search box.
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        if code == 429:
            raise HTTPException(429, "MyAnimeList search is rate-limited — wait a few seconds and try again")
        raise HTTPException(
            503,
            "MyAnimeList character search is unavailable right now "
            f"(Jikan returned {code}). This is upstream — try again later.",
        )
    except Exception:
        raise HTTPException(503, "Jikan API unavailable")

    results = []
    for item in data.get("data", []):
        anime_titles = [a["anime"]["title"] for a in item.get("anime", [])[:3] if a.get("anime")]
        manga_titles = [m["manga"]["title"] for m in item.get("manga", [])[:3] if m.get("manga")]
        series_list  = anime_titles or manga_titles

        about = (item.get("about") or "").strip()
        first_line = about.split("\n")[0].strip() if about else ""
        if first_line.lower().startswith(item["name"].lower()):
            about = "\n".join(about.split("\n")[1:]).strip()

        physical = _parse_physical(about)

        results.append({
            "mal_id":     item["mal_id"],
            "name":       item["name"],
            "name_kanji": item.get("name_kanji") or "",
            "about":      about[:600],
            "image_url":  (item.get("images") or {}).get("jpg", {}).get("image_url"),
            "series":     series_list,
            "url":        item.get("url") or f"https://myanimelist.net/character/{item['mal_id']}",
            "favorites":  item.get("favorites", 0),
            # Physical attributes — present only when found
            **physical,
        })
    return results


@router.get("/jikan-character/{mal_id}")
async def jikan_character_detail(mal_id: int):
    """Fetch full character data from Jikan v4 including confirmed anime/manga appearances."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"https://api.jikan.moe/v4/characters/{mal_id}/full")
        resp.raise_for_status()
        item = resp.json().get("data", {})
    except Exception as exc:
        raise HTTPException(502, f"Jikan request failed: {exc}")

    anime_titles = [a["anime"]["title"] for a in item.get("anime", [])[:5] if a.get("anime")]
    manga_titles = [m["manga"]["title"] for m in item.get("manga", [])[:5] if m.get("manga")]
    series_list  = anime_titles or manga_titles

    about = (item.get("about") or "").strip()
    first_line = about.split("\n")[0].strip() if about else ""
    if first_line.lower().startswith((item.get("name") or "").lower()):
        about = "\n".join(about.split("\n")[1:]).strip()

    physical = _parse_physical(about)

    return {
        "mal_id":     item.get("mal_id"),
        "name":       item.get("name", ""),
        "name_kanji": item.get("name_kanji") or "",
        "about":      about[:1000],
        "image_url":  (item.get("images") or {}).get("jpg", {}).get("image_url"),
        "series":     series_list,
        "url":        item.get("url") or f"https://myanimelist.net/character/{mal_id}",
        "favorites":  item.get("favorites", 0),
        **physical,
    }


@router.get("/favorites")
def list_favorites(db: Session = Depends(get_db)):
    creators = db.query(Creator).filter(Creator.is_favorite == True).order_by(Creator.name).all()
    return [_enrich(c, db) for c in creators]


@router.get("/franchises")
def list_franchises(db: Session = Depends(get_db)):
    """Distinct non-empty franchise (series) values, alphabetically sorted."""
    rows = (
        db.query(Creator.series)
        .filter(Creator.series.isnot(None), Creator.series != '')
        .distinct()
        .order_by(Creator.series)
        .all()
    )
    return [r.series for r in rows]


@router.get("/{creator_id}", response_model=CreatorOut)
def get_creator(creator_id: int, db: Session = Depends(get_db)):
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")
    return _enrich(c, db)


@router.patch("/{creator_id}", response_model=CreatorOut)
def update_creator(creator_id: int, data: CreatorUpdate, db: Session = Depends(get_db)):
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(c, field, value)
    # Recompute card rarity — but never overwrite a manually pinned My Queen (celestial)
    if c.card_rarity != 'celestial':
        image_count = (
            db.query(func.sum(Gallery.image_count))
              .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
              .filter(gallery_creators.c.creator_id == c.id)
              .scalar() or 0
        )
        session_count = db.query(SessionLog).filter(SessionLog.creator_id == c.id).count()
        c.card_rarity = _compute_rarity(image_count, rating=float(c.rating or 0), session_count=session_count)
    db.commit()
    db.refresh(c)
    return _enrich(c, db)


@router.delete("/{creator_id}", status_code=204)
def delete_creator(creator_id: int, db: Session = Depends(get_db)):
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")
    db.delete(c)
    db.commit()


class _FolderAssignRequest(BaseModel):
    folder_path: Optional[str] = None


@router.post("/sync-source-folders")
def sync_source_folders(db: Session = Depends(get_db)):
    """
    Re-run source_folder assignment for every creator that has one set.
    Newly matched galleries get the creator appended; already-assigned ones are skipped.
    Returns counts so the UI can give feedback.
    """
    creators = db.query(Creator).filter(Creator.source_folder.isnot(None)).all()
    if not creators:
        return {"synced_creators": 0, "newly_assigned": 0}

    galleries = db.query(Gallery).all()
    newly_assigned = 0

    for c in creators:
        norm_src = os.path.normcase(os.path.normpath(c.source_folder))
        for g in galleries:
            if not g.folder_path:
                continue
            norm_g = os.path.normcase(os.path.normpath(g.folder_path))
            if norm_g == norm_src or norm_g.startswith(norm_src + os.sep):
                if c not in g.creators:
                    g.creators.append(c)
                    g.is_tagged = True
                    newly_assigned += 1
                if g.creator_id is None:
                    g.creator_id = c.id

    db.commit()
    return {"synced_creators": len(creators), "newly_assigned": newly_assigned}


@router.post("/{creator_id}/assign-folder")
def assign_folder(creator_id: int, data: _FolderAssignRequest, db: Session = Depends(get_db)):
    """Set a source folder for a creator and retroactively assign all matching galleries."""
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")

    c.source_folder = data.folder_path.strip() if data.folder_path else None

    assigned_count = 0
    total_images = 0
    if c.source_folder:
        norm_prefix = os.path.normcase(os.path.normpath(c.source_folder))
        galleries = db.query(Gallery).all()
        for g in galleries:
            norm_g = os.path.normcase(os.path.normpath(g.folder_path))
            if norm_g == norm_prefix or norm_g.startswith(norm_prefix + os.sep):
                if c not in g.creators:
                    g.creators.append(c)
                    g.is_tagged = True
                    total_images += max(1, g.image_count or 0)
                if g.creator_id is None:
                    g.creator_id = creator_id
                assigned_count += 1

    db.commit()
    if total_images > 0:
        gami.notify_action(db, "gallery_assigned", override_amount=total_images)
        db.commit()
    db.refresh(c)
    return {"assigned_count": assigned_count, "creator": _enrich(c, db)}


@router.post("/{creator_id}/gift-heart", response_model=CreatorOut)
def gift_heart(creator_id: int, db: Session = Depends(get_db)):
    """Spend 1 heart from the user's inventory to boost a creator's bond."""
    from models import UserProfile
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")
    profile = db.query(UserProfile).first()
    if not profile or (profile.hearts or 0) < 1:
        raise HTTPException(400, "No hearts available")
    profile.hearts = (profile.hearts or 0) - 1
    c.bond_gifts   = (c.bond_gifts or 0) + 1
    db.commit()
    db.refresh(c)
    return _enrich(c, db)


@router.post("/{creator_id}/set-avatar-random")
def set_avatar_random(creator_id: int, data: dict = Body(default={}), db: Session = Depends(get_db)):
    """Pick a random thumbnail from the creator's galleries and use it as avatar.
    Pass { exclude_path: <current_avatar_path> } to avoid picking the same image twice."""
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")

    base_q = (
        db.query(Image)
          .join(Gallery, Gallery.id == Image.gallery_id)
          .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
          .filter(gallery_creators.c.creator_id == creator_id)
          .filter(Image.thumb_path.isnot(None))
    )

    # Prefer photos — only fall back to videos when the creator has nothing else
    photo_q = base_q.filter(Image.is_video == False)
    pick_q = photo_q if db.query(photo_q.exists()).scalar() else base_q

    exclude_path = data.get("exclude_path")
    if exclude_path and pick_q.count() > 1:
        candidate = pick_q.filter(Image.file_path != exclude_path).order_by(func.random()).first()
    else:
        candidate = pick_q.order_by(func.random()).first()

    if not candidate:
        raise HTTPException(404, "No images found for this creator — assign some galleries first")

    if candidate.is_video:
        # Never store a raw video path as avatar (it can't be served as an image).
        # Extract a full-res frame; fall back to the scan thumbnail if ffmpeg fails.
        from services.scanner import extract_video_frame
        os.makedirs(THUMBS_DIR, exist_ok=True)
        dest = os.path.join(THUMBS_DIR, f"avatar_{creator_id}_{uuid.uuid4().hex[:8]}.jpg")
        if candidate.file_path and os.path.exists(candidate.file_path) and extract_video_frame(candidate.file_path, 5.0, dest):
            c.avatar_path = dest
        elif candidate.thumb_path and os.path.exists(candidate.thumb_path):
            c.avatar_path = candidate.thumb_path
        else:
            raise HTTPException(500, "Could not extract a frame from the picked video")
    else:
        c.avatar_path = candidate.file_path if candidate.file_path and os.path.exists(candidate.file_path) else candidate.thumb_path
    db.commit()
    return {"avatar_path": c.avatar_path}


@router.post("/{creator_id}/avatar-upload")
async def upload_avatar(creator_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Upload a custom avatar image. The file is sniffed by Pillow, the extension
    is determined from the detected format (never trusted from the upload), and the
    size is capped to prevent disk-fill DoS."""
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")

    # Read with a hard cap — read one extra byte to detect oversize without buffering the full file
    body = await file.read(AVATAR_MAX_BYTES + 1)
    if len(body) > AVATAR_MAX_BYTES:
        raise HTTPException(413, f"Avatar exceeds {AVATAR_MAX_BYTES // (1024*1024)} MB limit")

    # Verify it's actually an image (and which kind) — never trust the filename or content-type
    try:
        with PILImage.open(BytesIO(body)) as img:
            img.verify()  # raises if not a valid image
        with PILImage.open(BytesIO(body)) as img:
            fmt = (img.format or "").upper()
    except Exception:
        raise HTTPException(400, "Uploaded file is not a valid image")

    if fmt not in AVATAR_ALLOWED_FORMATS:
        raise HTTPException(400, f"Unsupported image format: {fmt}. Allowed: {', '.join(sorted(AVATAR_ALLOWED_FORMATS))}")

    os.makedirs(THUMBS_DIR, exist_ok=True)
    ext = AVATAR_FORMAT_EXT[fmt]
    filename = f"avatar_{creator_id}_{uuid.uuid4().hex[:8]}{ext}"
    dest = os.path.join(THUMBS_DIR, filename)
    with open(dest, "wb") as f:
        f.write(body)
    c.avatar_path = dest
    db.commit()
    return {"avatar_path": c.avatar_path}


@router.post("/{creator_id}/avatar-from-url")
async def avatar_from_url(creator_id: int, data: dict, db: Session = Depends(get_db)):
    """Fetch an image from a remote URL and save it as the creator's avatar."""
    url = (data.get("url") or "").strip()
    if not url or not url.startswith("https://"):
        raise HTTPException(400, "A valid https:// URL is required")

    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "TheVault/1.0"})
        resp.raise_for_status()
        body = resp.content
    except Exception as exc:
        raise HTTPException(502, f"Failed to fetch avatar URL: {exc}")

    if len(body) > AVATAR_MAX_BYTES:
        raise HTTPException(413, f"Remote image exceeds {AVATAR_MAX_BYTES // (1024*1024)} MB limit")

    try:
        with PILImage.open(BytesIO(body)) as img:
            img.verify()
        with PILImage.open(BytesIO(body)) as img:
            fmt = (img.format or "").upper()
    except Exception:
        raise HTTPException(400, "Remote URL did not return a valid image")

    if fmt not in AVATAR_ALLOWED_FORMATS:
        raise HTTPException(400, f"Unsupported image format: {fmt}")

    os.makedirs(THUMBS_DIR, exist_ok=True)
    ext = AVATAR_FORMAT_EXT.get(fmt, ".jpg")
    filename = f"avatar_{creator_id}_{uuid.uuid4().hex[:8]}{ext}"
    dest = os.path.join(THUMBS_DIR, filename)
    with open(dest, "wb") as f:
        f.write(body)
    c.avatar_path = dest
    db.commit()
    return {"avatar_path": c.avatar_path}


@router.post("/{creator_id}/set-avatar-image/{image_id}")
def set_avatar_from_image(creator_id: int, image_id: int, db: Session = Depends(get_db)):
    """Set creator avatar to the full-resolution file of a specific gallery image."""
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")
    if not img.file_path or not os.path.exists(img.file_path):
        raise HTTPException(400, "Image file not found on disk")
    c.avatar_path = img.file_path  # store full-res path
    db.commit()
    return {"avatar_path": c.avatar_path}


@router.post("/{creator_id}/avatar-from-video/{image_id}")
def set_avatar_from_video(creator_id: int, image_id: int, data: dict = Body(default={}), db: Session = Depends(get_db)):
    """Set the creator's avatar from a video: either a full-res still frame at the given
    timestamp, or a short animated WebP clip starting there (pass {clip: true})."""
    from services.scanner import extract_video_frame, extract_video_clip_webp

    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Video not found")
    if not img.is_video:
        raise HTTPException(400, "Not a video — use set-avatar-image for images")
    if not img.file_path or not os.path.exists(img.file_path):
        raise HTTPException(400, "Video file not found on disk")

    try:
        timestamp = max(0.0, float(data.get("timestamp", 0)))
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid timestamp")
    clip = bool(data.get("clip", False))

    os.makedirs(THUMBS_DIR, exist_ok=True)
    ext = ".webp" if clip else ".jpg"
    dest = os.path.join(THUMBS_DIR, f"avatar_{creator_id}_{uuid.uuid4().hex[:8]}{ext}")

    ok = (extract_video_clip_webp(img.file_path, timestamp, dest) if clip
          else extract_video_frame(img.file_path, timestamp, dest))
    if not ok:
        raise HTTPException(500, "FFmpeg failed to extract from the video")

    c.avatar_path = dest
    db.commit()
    return {"avatar_path": c.avatar_path}


@router.post("/{creator_id}/banner-from-video/{image_id}")
def set_banner_from_video(creator_id: int, image_id: int, data: dict = Body(default={}), db: Session = Depends(get_db)):
    """Set the creator's banner from a video: a full-res still frame at the given
    timestamp, or an animated WebP clip starting there (pass {clip: true})."""
    from services.scanner import extract_video_frame, extract_video_clip_webp

    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Video not found")
    if not img.is_video:
        raise HTTPException(400, "Not a video — use set-banner-image for images")
    if not img.file_path or not os.path.exists(img.file_path):
        raise HTTPException(400, "Video file not found on disk")

    try:
        timestamp = max(0.0, float(data.get("timestamp", 0)))
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid timestamp")
    clip = bool(data.get("clip", False))

    os.makedirs(THUMBS_DIR, exist_ok=True)
    ext = ".webp" if clip else ".jpg"
    dest = os.path.join(THUMBS_DIR, f"banner_{creator_id}_{uuid.uuid4().hex[:8]}{ext}")

    ok = (extract_video_clip_webp(img.file_path, timestamp, dest, width=1280) if clip
          else extract_video_frame(img.file_path, timestamp, dest))
    if not ok:
        raise HTTPException(500, "FFmpeg failed to extract from the video")

    c.banner_path = dest
    c.banner_image_id = None   # uploaded/extracted banner takes precedence
    db.commit()
    return {"banner_path": c.banner_path}


@router.post("/{creator_id}/set-banner-image/{image_id}")
def set_banner_from_image(creator_id: int, image_id: int, db: Session = Depends(get_db)):
    """Set creator banner to a specific gallery image (by image_id)."""
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")
    if img.is_video:
        raise HTTPException(400, "Videos cannot be used as banners")
    c.banner_image_id = img.id
    c.banner_path = None   # clear any uploaded banner so image takes precedence
    db.commit()
    return {"banner_image_id": c.banner_image_id}


_AVATAR_SERVE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

@router.get("/{creator_id}/avatar")
def serve_creator_avatar(creator_id: int, db: Session = Depends(get_db)):
    """Serve the creator's avatar file directly at full resolution."""
    from fastapi.responses import FileResponse
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")
    if not c.avatar_path or not os.path.exists(c.avatar_path):
        raise HTTPException(404, "No avatar")
    # Defensive: only serve files with image extensions. Avatars are set either from
    # uploads (validated, image-only) or from scanned image file_paths, so this
    # should always pass — failing closed if it ever doesn't.
    if os.path.splitext(c.avatar_path)[1].lower() not in _AVATAR_SERVE_EXTS:
        raise HTTPException(404, "Avatar file is not a valid image type")
    return FileResponse(c.avatar_path)


@router.get("/{creator_id}/avatar-thumb")
def serve_creator_avatar_thumb(creator_id: int, size: int = 480, db: Session = Depends(get_db)):
    """Serve a resized thumbnail of the creator's avatar for list views."""
    from fastapi.responses import Response
    from PIL import Image as PILImage
    import io as _io
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")
    if not c.avatar_path or not os.path.exists(c.avatar_path):
        raise HTTPException(404, "No avatar")
    if os.path.splitext(c.avatar_path)[1].lower() not in _AVATAR_SERVE_EXTS:
        raise HTTPException(404, "Not a valid image")
    img = PILImage.open(c.avatar_path)
    # Animated avatars (WebP clips, GIFs): Pillow resizing would flatten them to
    # frame 1 — serve the original file so the animation plays in list views.
    if getattr(img, "is_animated", False):
        from fastapi.responses import FileResponse
        img.close()
        return FileResponse(c.avatar_path, headers={"Cache-Control": "public, max-age=3600"})
    if img.mode == "RGBA":
        img = img.convert("RGB")
    elif img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    img.thumbnail((size, size), PILImage.LANCZOS)
    buf = _io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    buf.seek(0)
    return Response(content=buf.read(), media_type="image/jpeg",
                    headers={"Cache-Control": "public, max-age=3600"})


@router.post("/{creator_id}/set-banner-random")
def set_banner_random(creator_id: int, data: dict = Body(default={}), db: Session = Depends(get_db)):
    """Pick a random image from the creator's galleries and use it as the banner.
    Pass { exclude_id: <current_banner_image_id> } to avoid picking the same image twice."""
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")

    base_q = (
        db.query(Image)
          .join(Gallery, Gallery.id == Image.gallery_id)
          .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
          .filter(gallery_creators.c.creator_id == creator_id)
          .filter(Image.is_video == False)
          .filter(Image.file_path.isnot(None))
    )

    exclude_id = data.get("exclude_id")
    if exclude_id and base_q.count() > 1:
        candidate = base_q.filter(Image.id != exclude_id).order_by(func.random()).first()
    else:
        candidate = base_q.order_by(func.random()).first()

    if not candidate:
        raise HTTPException(404, "No images found for this creator — assign some galleries first")

    c.banner_image_id = candidate.id
    db.commit()
    return {"banner_image_id": c.banner_image_id}


@router.post("/{creator_id}/banner-upload")
async def upload_banner(creator_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Upload a custom banner image. Stored in thumbs/ and linked as the creator's banner."""
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")

    body = await file.read(AVATAR_MAX_BYTES + 1)
    if len(body) > AVATAR_MAX_BYTES:
        raise HTTPException(413, f"Banner exceeds {AVATAR_MAX_BYTES // (1024*1024)} MB limit")

    try:
        with PILImage.open(BytesIO(body)) as img:
            img.verify()
        with PILImage.open(BytesIO(body)) as img:
            fmt = (img.format or "").upper()
    except Exception:
        raise HTTPException(400, "Uploaded file is not a valid image")

    if fmt not in AVATAR_ALLOWED_FORMATS:
        raise HTTPException(400, f"Unsupported format: {fmt}. Allowed: {', '.join(sorted(AVATAR_ALLOWED_FORMATS))}")

    os.makedirs(THUMBS_DIR, exist_ok=True)
    ext = AVATAR_FORMAT_EXT[fmt]
    filename = f"banner_{creator_id}_{uuid.uuid4().hex[:8]}{ext}"
    dest = os.path.join(THUMBS_DIR, filename)
    with open(dest, "wb") as f:
        f.write(body)
    c.banner_path = dest
    c.banner_image_id = None  # custom upload overrides any gallery image selection
    db.commit()
    return {"banner_path": c.banner_path}


@router.get("/{creator_id}/banner")
def serve_creator_banner(creator_id: int, db: Session = Depends(get_db)):
    """Serve the creator's uploaded banner file (only used when banner_path is set)."""
    from fastapi.responses import FileResponse
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")
    if not c.banner_path or not os.path.exists(c.banner_path):
        raise HTTPException(404, "No uploaded banner")
    if os.path.splitext(c.banner_path)[1].lower() not in _AVATAR_SERVE_EXTS:
        raise HTTPException(404, "Banner file is not a valid image type")
    return FileResponse(c.banner_path)


@router.get("/{creator_id}/top-images")
def top_images(creator_id: int, db: Session = Depends(get_db), limit: int = 5):
    from sqlalchemy import or_
    directly_assigned = (
        select(image_creators.c.image_id)
        .where(image_creators.c.creator_id == creator_id)
        .scalar_subquery()
    )
    gallery_inherited = (
        select(Image.id)
        .join(Gallery, Gallery.id == Image.gallery_id)
        .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
        .where(gallery_creators.c.creator_id == creator_id)
        .scalar_subquery()
    )
    images = (
        db.query(Image)
          .filter(
              or_(
                  Image.id.in_(directly_assigned),
                  Image.id.in_(gallery_inherited),
              )
          )
          # Photos only — consumers render these in <img> tags (e.g. the profile
          # banner fallback), which can't display a video file.
          .filter(Image.is_video == False)
          .order_by(Image.cum_count.desc())
          .limit(limit)
          .all()
    )
    return [{"id": i.id, "filename": i.filename, "thumb_path": i.thumb_path,
             "cum_count": i.cum_count, "gallery_id": i.gallery_id} for i in images]


def _creator_image_ids_subq(creator_id: int):
    """A fresh UNION subquery of every image id belonging to this creator, via
    either path (gallery membership OR direct image→creator link). Rebuilt per
    call — a SQLAlchemy subquery can't be safely reused across statements."""
    gallery_img_ids = (
        select(Image.id)
        .join(Gallery, Gallery.id == Image.gallery_id)
        .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
        .where(gallery_creators.c.creator_id == creator_id)
    )
    file_img_ids = (
        select(image_creators.c.image_id.label("id"))
        .where(image_creators.c.creator_id == creator_id)
    )
    return union(gallery_img_ids, file_img_ids).subquery()


@router.get("/{creator_id}/collage")
def creator_collage(creator_id: int, db: Session = Depends(get_db), limit: int = 30):
    """Photo ids for the Hall of Fame living background. Photos only (the collage
    renders them in <img> tags), biased toward her best/most-loved shots but with
    a random tiebreak so the pool feels fresh on every open."""
    sq = _creator_image_ids_subq(creator_id)
    rows = (
        db.query(Image.id, Image.focal_x, Image.focal_y, Image.width, Image.height)
          .join(sq, Image.id == sq.c.id)
          .filter(Image.is_video == False)  # noqa: E712
          .order_by(
              (func.coalesce(Image.rating, 0) * 2
               + func.coalesce(Image.cum_count, 0)
               + func.coalesce(Image.view_count, 0) * 0.1).desc(),
              func.random(),
          )
          .limit(max(1, min(limit, 60)))
          .all()
    )
    return [
        {"id": r.id, "focal_x": r.focal_x if r.focal_x is not None else 0.5,
         "focal_y": r.focal_y if r.focal_y is not None else 0.0,
         "portrait": bool(r.height and r.width and r.height >= r.width)}
        for r in rows
    ]


@router.get("/{creator_id}/stats")
def creator_stats(creator_id: int, db: Session = Depends(get_db)):
    """The deep-dive stats bundle powering the Hall of Fame creator overview.
    Builds on _enrich (counts, view seconds, cum, size, bond, value, months) and
    layers on engagement ratios, timelines, taste profile, cards, and bond flavor."""
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")

    d = _enrich(c, db)

    image_count = int(d.get("image_count") or 0)
    video_count = int(d.get("video_count") or 0)
    d["photo_count"] = max(0, image_count - video_count)

    # ── Aggregate image stats over her whole footprint ──────────────────────────
    sq = _creator_image_ids_subq(creator_id)
    agg = (
        db.query(
            func.sum(Image.view_count).label("views"),
            func.sum(case((Image.is_video == True, func.coalesce(Image.duration, 0)), else_=0)).label("runtime"),  # noqa: E712
            func.avg(case((Image.rating > 0, Image.rating), else_=None)).label("avg_rating"),
            func.sum(case((Image.rating > 0, 1), else_=0)).label("rated"),
            func.sum(case((Image.is_favorite == True, 1), else_=0)).label("favs"),  # noqa: E712
            func.min(Image.created_at).label("first_at"),
            func.max(Image.last_viewed_at).label("last_view"),
        )
        .join(sq, Image.id == sq.c.id)
        .one()
    )
    # This aggregate covers images only. Keep "total views" meaning gallery
    # opens PLUS media views — gallery_views is already set by _enrich above.
    d["image_views"]          = int(agg.views or 0)
    d["total_views"]          = int(agg.views or 0) + int(d.get("gallery_views") or 0)
    d["total_runtime_sec"]    = int(agg.runtime or 0)

    # How much of her video runtime we actually know. Duration is only probed at
    # scan time and that probe post-dates most of the library, so this is near
    # zero for older collections — the UI needs to know not to present a
    # meaningless total as fact.
    sq_r = _creator_image_ids_subq(creator_id)
    vid = (
        db.query(func.count(Image.id).label("n"),
                 func.sum(case((Image.duration > 0, 1), else_=0)).label("n_known"),
                 func.sum(Image.view_seconds).label("watched"))
          .join(sq_r, Image.id == sq_r.c.id)
          .filter(Image.is_video == True)  # noqa: E712
          .one()
    )
    d["video_count_total"]     = int(vid.n or 0)
    d["video_count_known_len"] = int(vid.n_known or 0)
    # The stat people actually mean by "how long have I watched her videos".
    d["video_watch_seconds"]   = int(vid.watched or 0)
    d["avg_image_rating"]     = round(float(agg.avg_rating), 2) if agg.avg_rating else 0.0
    d["rated_image_count"]    = int(agg.rated or 0)
    d["favorite_image_count"] = int(agg.favs or 0)
    d["first_media_at"]       = agg.first_at.isoformat() if agg.first_at else None
    d["last_viewed_at"]       = agg.last_view.isoformat() if agg.last_view else None
    d["rated_pct"]  = round(100 * d["rated_image_count"] / image_count, 1) if image_count else 0.0

    # Days known — compute in Python (portable across SQLite/PG)
    from datetime import datetime
    d["days_in_collection"] = (datetime.now() - agg.first_at).days if agg.first_at else 0

    # Tagged coverage — distinct images carrying at least one tag
    sq_t = _creator_image_ids_subq(creator_id)
    tagged = (
        db.query(func.count(func.distinct(image_tags.c.image_id)))
          .join(sq_t, image_tags.c.image_id == sq_t.c.id)
          .scalar()
    ) or 0
    d["tagged_image_count"] = int(tagged)
    d["tagged_pct"] = round(100 * int(tagged) / image_count, 1) if image_count else 0.0

    # ── Gallery-level stats ─────────────────────────────────────────────────────
    gstats = (
        db.query(
            func.avg(case((Gallery.rating > 0, Gallery.rating), else_=None)),
            func.sum(Gallery.view_count),
        )
        .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
        .filter(gallery_creators.c.creator_id == creator_id)
        .one()
    )
    d["avg_gallery_rating"] = round(float(gstats[0]), 2) if gstats[0] else 0.0
    gallery_count = int(d.get("gallery_count") or 0)
    cum_count     = int(d.get("cum_count") or 0)
    edge_count    = int(d.get("edge_count") or 0)
    view_secs     = int(d.get("total_view_seconds") or 0)

    # ── Engagement ratios (the degenerate KPIs) ─────────────────────────────────
    d["os_per_gallery"]    = round(cum_count / gallery_count, 2) if gallery_count else 0.0
    d["views_per_gallery"] = round(d["total_views"] / gallery_count, 1) if gallery_count else 0.0
    d["os_per_hour"]       = round(cum_count / (view_secs / 3600), 2) if view_secs else 0.0
    # How many times she made you pull back for each finish.
    d["edges_per_cum"]     = round(edge_count / cum_count, 1) if cum_count else 0.0
    d["edges_per_hour"]    = round(edge_count / (view_secs / 3600), 2) if view_secs else 0.0

    # Share of your entire lifetime attention
    prof = db.query(UserProfile).first()
    total_cum_all = int(prof.total_cum_count or 0) if prof else 0
    total_edge_all = int(prof.total_edge_count or 0) if prof else 0
    total_secs_all = int(db.query(func.sum(Image.view_seconds)).scalar() or 0)
    d["share_of_total_cum"]  = round(100 * cum_count / total_cum_all, 1) if total_cum_all else 0.0
    d["share_of_total_edges"] = round(100 * edge_count / total_edge_all, 1) if total_edge_all else 0.0
    d["share_of_total_time"] = round(100 * view_secs / total_secs_all, 1) if total_secs_all else 0.0

    # ── Standout media (ids + thumbs) ───────────────────────────────────────────
    def _top_image(order_col):
        sqi = _creator_image_ids_subq(creator_id)
        row = (db.query(Image.id, Image.filename, Image.cum_count, Image.edge_count,
                        Image.view_count, Image.rating, Image.gallery_id, Image.is_video)
                 .join(sqi, Image.id == sqi.c.id)
                 .order_by(order_col.desc())
                 .first())
        if not row:
            return None
        # A "top" image with a zero count is just the arbitrary first row.
        if order_col is Image.cum_count and (row.cum_count or 0) == 0:
            return None
        if order_col is Image.edge_count and (row.edge_count or 0) == 0:
            return None
        return {"id": row.id, "filename": row.filename, "cum_count": row.cum_count,
                "edge_count": row.edge_count,
                "view_count": row.view_count, "rating": row.rating,
                "gallery_id": row.gallery_id, "is_video": bool(row.is_video)}
    d["most_gooned_image"] = _top_image(Image.cum_count)
    d["most_edged_image"]  = _top_image(Image.edge_count)
    d["most_viewed_image"] = _top_image(Image.view_count)

    top_gallery = (
        db.query(Gallery.id, Gallery.name, Gallery.view_count, Gallery.cum_count,
                 Gallery.rating, Gallery.cover_thumb)
          .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
          .filter(gallery_creators.c.creator_id == creator_id)
          .order_by(Gallery.view_count.desc())
          .first()
    )
    d["most_viewed_gallery"] = (
        {"id": top_gallery.id, "name": top_gallery.name, "view_count": top_gallery.view_count,
         "cum_count": top_gallery.cum_count, "rating": top_gallery.rating,
         "cover_thumb": top_gallery.cover_thumb} if top_gallery else None
    )

    # ── Timelines (grouped by month) ────────────────────────────────────────────
    sq_a = _creator_image_ids_subq(creator_id)
    acq_rows = (
        db.query(func.strftime("%Y-%m", Image.created_at).label("m"), func.count().label("n"))
          .join(sq_a, Image.id == sq_a.c.id)
          .group_by("m").order_by("m").all()
    )
    d["acquisition_timeline"] = [{"month": r.m, "count": int(r.n)} for r in acq_rows if r.m]

    sess_rows = (
        db.query(func.strftime("%Y-%m", SessionLog.logged_at).label("m"), func.count().label("n"))
          .filter(SessionLog.creator_id == creator_id)
          .group_by("m").order_by("m").all()
    )
    d["activity_timeline"] = [{"month": r.m, "sessions": int(r.n)} for r in sess_rows if r.m]

    # ── Taste profile: top tags + orientation ───────────────────────────────────
    sq_tg = _creator_image_ids_subq(creator_id)
    tag_rows = (
        db.query(Tag.name, Tag.category, Tag.source,
                 func.count(image_tags.c.image_id).label("n"))
          .join(image_tags, image_tags.c.tag_id == Tag.id)
          .join(sq_tg, image_tags.c.image_id == sq_tg.c.id)
          .group_by(Tag.id)
          .order_by(func.count(image_tags.c.image_id).desc())
          .limit(18).all()
    )
    d["top_tags"] = [
        {"name": r.name, "category": r.category,
         "source": (r.source.value if hasattr(r.source, "value") else str(r.source)),
         "count": int(r.n)}
        for r in tag_rows
    ]
    d["ai_tag_count"]     = sum(t["count"] for t in d["top_tags"] if t["source"] == "ai")
    d["manual_tag_count"] = sum(t["count"] for t in d["top_tags"] if t["source"] == "manual")

    sq_o = _creator_image_ids_subq(creator_id)
    orient = (
        db.query(
            func.sum(case((Image.width > Image.height, 1), else_=0)),
            func.sum(case((Image.height > Image.width, 1), else_=0)),
            func.sum(case((Image.width == Image.height, 1), else_=0)),
        )
        .join(sq_o, Image.id == sq_o.c.id)
        .filter(Image.is_video == False, Image.width.isnot(None), Image.height.isnot(None))  # noqa: E712
        .one()
    )
    d["orientation"] = {"landscape": int(orient[0] or 0),
                        "portrait": int(orient[1] or 0),
                        "square": int(orient[2] or 0)}

    # ── TCG / cards featuring her ───────────────────────────────────────────────
    # A card belongs to her through ANY path — not just a dedicated creator card:
    # her creator card, a variant linking her, OR any image/gallery card whose
    # source asset is hers.
    from services import cards as card_svc
    her_gal_ids = select(gallery_creators.c.gallery_id).where(gallery_creators.c.creator_id == creator_id)
    her_img_sq = _creator_image_ids_subq(creator_id)
    her_cards = or_(
        Card.source_creator_id == creator_id,
        Card.linked_character_id == creator_id,
        Card.source_gallery_id.in_(her_gal_ids),
        Card.source_image_id.in_(select(her_img_sq.c.id)),
    )
    inv_rows = (
        db.query(CardInventory)
          .join(Card, Card.id == CardInventory.card_id)
          .filter(her_cards)
          .all()
    )

    def _ctype(iv):
        ct = iv.card.card_type
        return ct.value if hasattr(ct, "value") else str(ct)

    owned = sum(int(iv.quantity or 1) for iv in inv_rows)
    variant_owned = sum(int(iv.quantity or 1) for iv in inv_rows if _ctype(iv) == "variant")
    total_cxp = sum(int(iv.card.cxp or 0) for iv in inv_rows)

    # Rank by rarity for "rarest" + the (max 5) previews to render
    ranked = sorted(inv_rows, key=lambda iv: card_svc.rarity_score(iv.card), reverse=True)
    best = None
    if ranked:
        top = ranked[0].card
        best = {"rarity": top.rarity.value if hasattr(top.rarity, "value") else str(top.rarity),
                "foil": bool(top.foil), "type": _ctype(ranked[0])}

    def _preview(iv):
        cd = card_svc._card_to_dict(db, iv.card)
        cd["inventory_id"] = iv.id
        cd["quantity"] = iv.quantity
        return cd

    d["cards"] = {
        "owned_count": int(owned),
        "variant_count": int(variant_owned),
        "total_cxp": int(total_cxp),
        "rarest": best,
        "previews": [_preview(iv) for iv in ranked[:5]],
        "showcase_slots_filled": db.query(CreatorShowcase).filter(CreatorShowcase.creator_id == creator_id).count(),
        "showcase_mastery": c.showcase_mastery_at is not None,
    }

    # ── Bond flavor ─────────────────────────────────────────────────────────────
    d["messages_exchanged"] = db.query(CompanionMessage).filter(
        CompanionMessage.persona_id == creator_id
    ).count()

    # ── Rank among all creators ────────────────────────────────────────────────
    # Uses the SAME scoring service as /hall-of-fame. This block used to carry
    # its own copy of the formula, which drifted and made a creator's modal
    # disagree with her position in the Hall of Fame.
    scores = ranking.score_all_creators(db)
    order  = ranking.ranked_creator_ids(scores)
    d["total_creators"] = len(order)
    d["rank"] = (order.index(creator_id) + 1) if creator_id in order else None

    mine = scores.get(creator_id)
    if mine:
        d["hof_score"]         = mine["score"]
        d["avg_dwell_seconds"] = mine["avg_dwell_seconds"]
        d["engagement_factor"] = mine["engagement_factor"]
        d["median_dwell"]      = scores["_median_dwell"]
        # What the leader has, so the modal can say what it would take to pass her.
        if order:
            leader = order[0]
            d["leader_name"]  = (db.query(Creator.name).filter(Creator.id == leader).scalar()
                                 if leader != creator_id else None)
            d["leader_score"] = scores[leader]["score"]
            d["points_to_first"] = max(0, scores[leader]["score"] - mine["score"])

    # Her honours — every Hall of Fame period she has ever topped.
    d["crowns"] = crowns.crowns_for_creator(db, creator_id)

    return d


@router.get("/{creator_id}/crowns")
def creator_crowns(creator_id: int, db: Session = Depends(get_db)):
    """Every Hall of Fame period this creator has won."""
    if not db.query(Creator).filter(Creator.id == creator_id).first():
        raise HTTPException(404, "Creator not found")
    return crowns.crowns_for_creator(db, creator_id)

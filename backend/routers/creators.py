from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, case
from typing import List, Optional
from PIL import Image as PILImage
from io import BytesIO
import httpx
import re
import uuid
import os

from database import get_db, DATA_DIR
from models import Creator, Gallery, Image, SessionLog, gallery_creators
from schemas import CreatorCreate, CreatorUpdate, CreatorOut
import services.gamification as gami

THUMBS_DIR = os.path.join(DATA_DIR, "thumbs")

# Avatar upload limits
AVATAR_MAX_BYTES = 50 * 1024 * 1024  # 50 MB
AVATAR_ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP", "GIF"}
AVATAR_FORMAT_EXT = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "GIF": ".gif"}

# Wiki subdomain — letters, digits, hyphens only; prevents SSRF via crafted series names
_WIKI_BASE_RE = re.compile(r"^[a-z0-9-]{1,50}$")

router = APIRouter()


def _enrich(c: Creator, db: Session) -> dict:
    d = {col.name: getattr(c, col.name) for col in c.__table__.columns}
    # Count galleries via M2M (primary source of truth)
    gallery_count = db.query(gallery_creators).filter(
        gallery_creators.c.creator_id == c.id
    ).count()
    d["gallery_count"] = gallery_count
    d["image_count"] = (
        db.query(func.sum(Gallery.image_count))
          .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
          .filter(gallery_creators.c.creator_id == c.id)
          .scalar() or 0
    )
    d["session_count"] = db.query(SessionLog).filter(SessionLog.creator_id == c.id).count()
    d["total_view_seconds"] = (
        db.query(func.sum(Image.view_seconds))
          .join(Gallery, Image.gallery_id == Gallery.id)
          .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
          .filter(gallery_creators.c.creator_id == c.id)
          .scalar() or 0
    )
    # Recompute rarity live — but preserve manually pinned celestial (My Queen)
    if c.card_rarity == 'celestial':
        d["card_rarity"] = 'celestial'
    else:
        d["card_rarity"] = _compute_rarity(
            image_count=d["image_count"],
            rating=float(c.rating or 0),
            session_count=d["session_count"],
        )
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
    # Quality multiplier
    if rating >= 8.0:   quality = 1.8
    elif rating >= 6.0: quality = 1.3
    elif rating > 0:    quality = 1.0
    else:               quality = 0.85  # never rated → slight penalty

    # Engagement multiplier
    if session_count >= 20:  engagement = 1.5
    elif session_count >= 5: engagement = 1.2
    elif session_count == 0: engagement = 0.9
    else:                    engagement = 1.0

    score = image_count * quality * engagement

    # Score thresholds (base) + engagement/rating gates at top two tiers
    if score >= 2500:
        # Relic gate: sessions ≥ 30 AND rating ≥ 7
        if session_count >= 30 and rating >= 7:
            return "relic"
        return "legendary"
    if score >= 1200:
        # Legendary gate: sessions ≥ 10 OR rating ≥ 8
        if session_count >= 10 or rating >= 8:
            return "legendary"
        return "epic"
    if score >= 600:  return "epic"
    if score >= 300:  return "rare"
    if score >= 100:  return "uncommon"
    return "common"


@router.get("/", response_model=List[CreatorOut])
def list_creators(
    db: Session = Depends(get_db),
    creator_type: Optional[str] = None,
    favorite: Optional[bool] = None,
    search: Optional[str] = None,
    sort_by: Optional[str] = "name",  # name | rating | image_count | cum_count | date_added | rarity | random
    sort_dir: Optional[str] = None,  # asc | desc
    skip: int = 0,
    limit: int = 200,
):
    _RARITY_RANK = case(
        (Creator.card_rarity == 'celestial', 0),
        (Creator.card_rarity == 'relic',     1),
        (Creator.card_rarity == 'legendary', 2),
        (Creator.card_rarity == 'epic',      3),
        (Creator.card_rarity == 'rare',      4),
        (Creator.card_rarity == 'uncommon',  5),
        (Creator.card_rarity == 'common',    6),
        else_=7,
    )
    q = db.query(Creator)
    if creator_type:
        q = q.filter(Creator.creator_type == creator_type)
    if favorite is not None:
        q = q.filter(Creator.is_favorite == favorite)
    if search:
        q = q.filter(Creator.name.ilike(f"%{search}%"))

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
        # Sum of Gallery.image_count per creator_id
        img_subq = (
            db.query(
                gallery_creators.c.creator_id,
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
        # Sum of Gallery.cum_count per creator_id
        cum_subq = (
            db.query(
                gallery_creators.c.creator_id,
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
               GROUP_CONCAT(name, '||') as names
        FROM creators
        WHERE country IS NOT NULL AND country != ''
        GROUP BY country
        ORDER BY cnt DESC
    """)).fetchall()
    result = []
    for r in rows:
        ids = [int(x) for x in r[2].split(",") if x]
        names = [x for x in r[3].split("||") if x]
        result.append({
            "country": r[0],
            "count": r[1],
            "creators": [{"id": ids[i], "name": names[i]} for i in range(len(ids))]
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
def creator_hall_of_fame(db: Session = Depends(get_db), limit: int = 5):
    """Creators ranked by total view_count across all their galleries (primary).
    total_cum is also returned as a secondary stat."""
    from sqlalchemy import func as sqlfunc
    result = (
        db.query(
            Creator,
            sqlfunc.sum(Gallery.view_count).label("total_views"),
            sqlfunc.sum(Gallery.cum_count).label("total_cum"),
        )
          .join(gallery_creators, gallery_creators.c.creator_id == Creator.id)
          .join(Gallery, Gallery.id == gallery_creators.c.gallery_id)
          .group_by(Creator.id)
          .order_by(sqlfunc.sum(Gallery.view_count).desc(), sqlfunc.sum(Gallery.cum_count).desc())
          .limit(limit)
          .all()
    )
    creator_ids = [c.id for c, _, _ in result]

    # Batch: sum view_seconds per creator across all their galleries' images
    view_secs_rows = (
        db.query(gallery_creators.c.creator_id, sqlfunc.sum(Image.view_seconds))
          .join(Image, Image.gallery_id == gallery_creators.c.gallery_id)
          .filter(gallery_creators.c.creator_id.in_(creator_ids))
          .group_by(gallery_creators.c.creator_id)
          .all()
    )
    view_secs_map = {cid: int(secs or 0) for cid, secs in view_secs_rows}

    out = []
    for creator, total_views, total_cum in result:
        d = _enrich(creator, db)
        d["total_views"]        = int(total_views or 0)
        d["total_cum"]          = int(total_cum or 0)
        d["total_view_seconds"] = view_secs_map.get(creator.id, 0)
        out.append(d)
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
        data = resp.json()
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


@router.post("/{creator_id}/toggle-queen", response_model=CreatorOut)
def toggle_queen(creator_id: int, db: Session = Depends(get_db)):
    """Toggle My Queen (celestial) status. Sets it if not celestial, reverts to computed rarity if already celestial."""
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")

    if c.card_rarity == 'celestial':
        # Revert to computed rarity
        image_count = (
            db.query(func.sum(Gallery.image_count))
              .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
              .filter(gallery_creators.c.creator_id == c.id)
              .scalar() or 0
        )
        session_count = db.query(SessionLog).filter(SessionLog.creator_id == c.id).count()
        c.card_rarity = _compute_rarity(image_count, rating=float(c.rating or 0), session_count=session_count)
    else:
        c.card_rarity = 'celestial'

    db.commit()
    db.refresh(c)
    return _enrich(c, db)


@router.post("/{creator_id}/wiki-import")
async def wiki_import(creator_id: int, db: Session = Depends(get_db)):
    """
    Attempt to pull character data from Fandom wiki using the MediaWiki API.
    Searches by creator name and fills in lore, series, description fields.
    """
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")

    if not c.wiki_url:
        # Auto-detect: query the Fandom wiki for this character's series
        wiki_base = (c.series or "eldenring").lower()
        wiki_base = re.sub(r"[^a-z0-9-]", "", wiki_base)
        if not _WIKI_BASE_RE.match(wiki_base):
            raise HTTPException(400, "Series contains no valid characters for a wiki subdomain")
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                api_url = (
                    f"https://{wiki_base}.fandom.com/api.php"
                    f"?action=query&titles={c.name.replace(' ', '_')}"
                    f"&prop=extracts&exintro=1&explaintext=1&format=json&origin=*"
                )
                resp = await client.get(api_url)
                data = resp.json()
                pages = data.get("query", {}).get("pages", {})
                page = next(iter(pages.values()), {})
                extract = page.get("extract", "")
                if extract:
                    c.lore = extract[:1500]
                    c.wiki_source = f"{wiki_base}.fandom.com"
                    from datetime import datetime
                    c.wiki_synced = datetime.utcnow()
                    db.commit()
                    gami.notify_action(db, "wiki_import")
                    return {"success": True, "lore": c.lore, "source": c.wiki_source}
        except Exception as e:
            raise HTTPException(500, f"Wiki fetch failed: {str(e)}")

    return {"success": False, "message": "Could not auto-detect wiki. Set wiki_url manually."}


@router.post("/{creator_id}/set-avatar-random")
def set_avatar_random(creator_id: int, db: Session = Depends(get_db)):
    """Pick a random thumbnail from the creator's galleries and use it as avatar."""
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")
    random_img = (
        db.query(Image)
          .join(Gallery, Gallery.id == Image.gallery_id)
          .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
          .filter(gallery_creators.c.creator_id == creator_id)
          .filter(Image.thumb_path.isnot(None))
          .order_by(func.random())
          .first()
    )
    if not random_img:
        raise HTTPException(404, "No images found for this creator")
    # Use full-res file path for maximum quality
    c.avatar_path = random_img.file_path if random_img.file_path and os.path.exists(random_img.file_path) else random_img.thumb_path
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
def set_banner_random(creator_id: int, db: Session = Depends(get_db)):
    """Pick a random image from the creator's galleries and use it as the banner."""
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")
    random_img = (
        db.query(Image)
          .join(Gallery, Gallery.id == Image.gallery_id)
          .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
          .filter(gallery_creators.c.creator_id == creator_id)
          .filter(Image.is_video == False)
          .filter(Image.file_path.isnot(None))
          .order_by(func.random())
          .first()
    )
    if not random_img:
        raise HTTPException(404, "No images found for this creator")
    c.banner_image_id = random_img.id
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
    images = (
        db.query(Image)
          .join(Gallery, Gallery.id == Image.gallery_id)
          .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
          .filter(gallery_creators.c.creator_id == creator_id)
          .order_by(Image.cum_count.desc())
          .limit(limit)
          .all()
    )
    return [{"id": i.id, "filename": i.filename, "thumb_path": i.thumb_path,
             "cum_count": i.cum_count, "gallery_id": i.gallery_id} for i in images]

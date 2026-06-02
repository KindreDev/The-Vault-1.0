import re
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import func, or_
from typing import List, Optional

from database import get_db
from models import Gallery, Image, Creator, Tag, gallery_creators, UserProfile, SessionLog, image_tags, mix_images
from schemas import GalleryOut, GalleryCreate, GalleryUpdate
import services.gamification as gami
from sqlalchemy import text

router = APIRouter()


def _enrich(g: Gallery) -> dict:
    d = {c.name: getattr(g, c.name) for c in g.__table__.columns}
    d["tags"] = [
        {"id": t.id, "name": t.name, "category": t.category,
         "color": t.color, "source": t.source, "use_count": t.use_count}
        for t in g.tags
    ]
    d["creators"] = [
        {"id": c.id, "name": c.name, "creator_type": c.creator_type, "card_rarity": c.card_rarity}
        for c in g.creators
    ]
    # Primary creator name from M2M (first entry) or legacy creator_id
    if g.creators:
        d["creator_name"] = g.creators[0].name
    elif g.creator:
        d["creator_name"] = g.creator.name
    else:
        d["creator_name"] = None
    return d


@router.post("/", response_model=GalleryOut, status_code=201)
def create_gallery(data: GalleryCreate, db: Session = Depends(get_db)):
    """Create a manual gallery (no folder scan required)."""
    import uuid as _uuid
    folder_path = data.folder_path or f"__manual__/{_uuid.uuid4().hex}"
    if not folder_path.startswith("__manual__"):
        existing = db.query(Gallery).filter(Gallery.folder_path == folder_path).first()
        if existing:
            raise HTTPException(400, "A gallery already exists at that folder path")
    g = Gallery(
        name=data.name,
        description=data.description or "",
        folder_path=folder_path,
        creator_id=data.creator_id,
    )
    db.add(g)
    db.commit()
    db.refresh(g)
    gami.notify_action(db, "gallery_imported")
    return _enrich(g)


@router.post("/random-mix", response_model=GalleryOut, status_code=201)
def create_random_mix(data: dict, db: Session = Depends(get_db)):
    """Generate a mix gallery from randomly selected images and save it permanently."""
    from datetime import datetime
    from sqlalchemy import insert

    count       = max(1, min(500, int(data.get("count", 50))))
    creator_ids = [int(c) for c in (data.get("creator_ids") or []) if c]
    photos_only = bool(data.get("photos_only", False))
    videos_only = bool(data.get("videos_only", False))
    tag_ids     = [int(t) for t in (data.get("tag_ids") or []) if t]
    name        = (data.get("name") or "").strip() or f"Mix · {datetime.now().strftime('%b %d, %Y')}"

    q = db.query(Image).filter(Image.file_path.isnot(None))
    if creator_ids:
        from models import gallery_creators as _gc
        q = (q.join(Gallery, Image.gallery_id == Gallery.id)
               .join(_gc, _gc.c.gallery_id == Gallery.id)
               .filter(_gc.c.creator_id.in_(creator_ids)))
    if photos_only:
        q = q.filter(Image.is_video == False)
    elif videos_only:
        q = q.filter(Image.is_video == True)
    if tag_ids:
        from models import image_tags as _it
        matching = db.query(_it.c.image_id).filter(_it.c.tag_id.in_(tag_ids)).distinct().subquery()
        q = q.filter(Image.id.in_(matching))

    images = q.order_by(func.random()).limit(count).all()
    if not images:
        raise HTTPException(400, "No matching images found — try adjusting the filters")

    stamp = datetime.now().strftime("%Y%m%d%H%M%S")
    g = Gallery(
        name=name,
        description=f"Random mix · {len(images)} items · generated {datetime.now().strftime('%Y-%m-%d')}",
        folder_path=f"__mix__/{stamp}",
        is_mix=True,
        image_count=len(images),
    )
    db.add(g)
    db.flush()
    db.execute(insert(mix_images), [{"gallery_id": g.id, "image_id": img.id, "sort_order": i} for i, img in enumerate(images)])
    db.commit()
    db.refresh(g)
    return _enrich(g)


@router.get("/", response_model=List[GalleryOut])
def list_galleries(
    db: Session = Depends(get_db),
    creator_id: Optional[str] = None,  # single id or comma-separated ids
    search: Optional[str] = None,
    tag: Optional[str] = None,
    tags: Optional[str] = None,  # comma-separated, AND logic
    favorite: Optional[bool] = None,
    unassigned: Optional[bool] = None,
    sort_by: Optional[str] = "date_added",  # date_added | name | image_count | rating | cum_count | random
    sort_dir: Optional[str] = None,  # asc | desc — defaults depend on sort_by
    skip: int = 0,
    limit: int = 200,
):
    # Eager-load tags + creators so _enrich() doesn't fire N+1 queries on a page of 200
    q = db.query(Gallery).options(
        selectinload(Gallery.tags),
        selectinload(Gallery.creators),
    )

    # Filter by creator via M2M — supports comma-separated IDs for multi-select
    if creator_id:
        cid_list = [int(x.strip()) for x in str(creator_id).split(',') if x.strip().isdigit()]
        if len(cid_list) == 1:
            q = q.join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)\
                 .filter(gallery_creators.c.creator_id == cid_list[0])
        elif len(cid_list) > 1:
            q = q.join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)\
                 .filter(gallery_creators.c.creator_id.in_(cid_list))

    # Unassigned: galleries with no entries in gallery_creators
    if unassigned:
        assigned_ids = db.query(gallery_creators.c.gallery_id).distinct()
        q = q.filter(~Gallery.id.in_(assigned_ids))

    # Multi-tag: comma-separated, each tag must be present (AND).
    # Matches gallery-level tags OR any image in the gallery having that tag.
    tag_list = [t.strip().lower() for t in (tags or tag or '').split(',') if t.strip()]
    for tag_name in tag_list:
        # Explicit subquery: gallery IDs whose images have this tag
        img_subq = (
            db.query(Image.gallery_id)
            .join(image_tags, image_tags.c.image_id == Image.id)
            .join(Tag, Tag.id == image_tags.c.tag_id)
            .filter(Tag.name == tag_name, Image.gallery_id.isnot(None))
            .subquery()
        )
        q = q.filter(or_(
            Gallery.tags.any(Tag.name == tag_name),
            Gallery.id.in_(img_subq),
        ))
    if search:
        q = q.filter(Gallery.name.ilike(f"%{search}%"))
    if favorite is not None:
        q = q.filter(Gallery.is_favorite == favorite)

    # Sorting — sort_dir overrides default direction per column
    use_asc = None
    if sort_dir == "asc":
        use_asc = True
    elif sort_dir == "desc":
        use_asc = False

    if sort_by == "name":
        col = Gallery.name
        q = q.order_by(col.asc() if (use_asc if use_asc is not None else True) else col.desc())
    elif sort_by == "image_count":
        col = Gallery.image_count
        q = q.order_by(col.asc() if (use_asc if use_asc is not None else False) else col.desc())
    elif sort_by == "rating":
        col = Gallery.rating
        q = q.order_by(col.asc() if (use_asc if use_asc is not None else False) else col.desc())
    elif sort_by == "cum_count":
        col = Gallery.cum_count
        q = q.order_by(col.asc() if (use_asc if use_asc is not None else False) else col.desc())
    elif sort_by == "date_modified":
        col = Gallery.updated_at
        q = q.order_by(col.asc() if (use_asc if use_asc is not None else False) else col.desc())
    elif sort_by == "random":
        q = q.order_by(func.random())
    else:
        col = Gallery.created_at
        q = q.order_by(col.asc() if (use_asc if use_asc is not None else False) else col.desc())

    galleries = q.offset(skip).limit(limit).all()
    return [_enrich(g) for g in galleries]


@router.get("/stats")
def vault_stats(db: Session = Depends(get_db)):
    assigned_count = db.query(gallery_creators.c.gallery_id).distinct().count()
    total_galleries = db.query(Gallery).count()
    total_images = db.query(Image).filter(Image.is_video == False).count()
    total_videos = db.query(Image).filter(Image.is_video == True).count()
    total_size = db.query(func.sum(Image.file_size)).scalar() or 0
    total_creators = db.query(Creator).count()
    total_cum_count = db.query(func.sum(Image.cum_count)).scalar() or 0

    # User profile & sessions
    profile = db.query(UserProfile).first()
    streak_days = profile.streak_days if profile else 0
    total_sessions = db.query(SessionLog).count()
    session_total_ms = db.query(func.sum(SessionLog.duration_sec)).scalar() or 0
    session_total_ms = session_total_ms * 1000

    avg_session_ms = (session_total_ms / total_sessions) if total_sessions > 0 else 0

    # Untagged
    untagged_galleries = total_galleries - assigned_count
    # Files without tags
    tagged_files_count = db.query(image_tags.c.image_id).distinct().count()
    untagged_files = (total_images + total_videos) - tagged_files_count
    untagged_pct = (untagged_files / (total_images + total_videos) * 100) if (total_images + total_videos) > 0 else 0

    # Top creator
    top_creator = db.query(Creator.name).join(gallery_creators).join(Gallery).join(Image).group_by(Creator.id).order_by(func.count(Image.id).desc()).first()

    # More stats
    avg_files_per_gallery = (total_images + total_videos) / total_galleries if total_galleries > 0 else 0
    total_video_duration = db.query(func.sum(Image.duration)).filter(Image.is_video == True).scalar() or 0
    avg_video_length = total_video_duration / total_videos if total_videos > 0 else 0
    last_added = db.query(func.max(Image.created_at)).scalar()

    # Activity
    import datetime
    most_active_month = db.query(func.strftime('%m', SessionLog.logged_at), func.count(SessionLog.id)).group_by(func.strftime('%m', SessionLog.logged_at)).order_by(func.count(SessionLog.id).desc()).first()
    most_active_day = db.query(func.strftime('%w', SessionLog.logged_at), func.count(SessionLog.id)).group_by(func.strftime('%w', SessionLog.logged_at)).order_by(func.count(SessionLog.id).desc()).first()

    # Most gooned
    most_gooned_creator = db.query(Creator).join(SessionLog, SessionLog.creator_id == Creator.id).group_by(Creator.id).order_by(func.sum(SessionLog.duration_sec).desc()).first()
    most_gooned_gallery = db.query(Gallery).order_by(Gallery.cum_count.desc()).first()
    most_gooned_img = db.query(Image).filter(Image.is_video == False).order_by(Image.cum_count.desc()).first()
    most_gooned_vid = db.query(Image).filter(Image.is_video == True).order_by(Image.cum_count.desc()).first()

    most_common_tag = db.query(Tag.name).order_by(Tag.use_count.desc()).first()
    
    # Rating & size
    rated_images = db.query(Image).filter(Image.rating > 0).all()
    avg_rating = sum(i.rating for i in rated_images) / len(rated_images) if rated_images else 0
    highest_file_size = db.query(func.max(Image.file_size)).scalar() or 0

    # New creators this month
    now = datetime.datetime.now()
    new_creators_month = db.query(Creator).filter(func.strftime('%Y', Creator.created_at) == str(now.year), func.strftime('%m', Creator.created_at) == f"{now.month:02d}").count()

    # Tags per file
    total_tag_assignments = db.query(image_tags).count()
    avg_tags_per_file = total_tag_assignments / (total_images + total_videos) if (total_images + total_videos) > 0 else 0

    longest_session = db.query(func.max(SessionLog.duration_sec)).scalar() or 0
    
    # Images per creator type (for distribution card)
    # Count non-video images that belong to galleries associated with each creator type.
    # A gallery can have multiple creators — we count distinct images once per gallery.
    images_by_type_rows = db.execute(text("""
        SELECT c.creator_type, COUNT(DISTINCT i.id) AS cnt
        FROM images i
        JOIN gallery_creators gc ON gc.gallery_id = i.gallery_id
        JOIN creators c ON c.id = gc.creator_id
        WHERE i.is_video = 0
        GROUP BY c.creator_type
    """)).fetchall()
    images_by_creator_type = {row[0]: row[1] for row in images_by_type_rows}

    # Collection value: sum of all per-creator calculated values
    all_creator_ids = [row[0] for row in db.query(Creator.id).all()]
    collection_value = sum(
        gami.calc_creator_stats(db, cid).get("total_value", 0.0)
        for cid in all_creator_ids
    )
    # Also add purchase values from unassigned galleries
    unassigned_purchase = db.query(func.sum(Gallery.purchase_value)).filter(
        ~Gallery.id.in_(db.query(gallery_creators.c.gallery_id).distinct()),
        Gallery.creator_id.is_(None),
    ).scalar() or 0
    collection_value += float(unassigned_purchase)

    return {
        "total_images": total_images,
        "total_videos": total_videos,
        "total_galleries": total_galleries,
        "total_creators": total_creators,
        "total_cum_count": total_cum_count,
        "total_size_gb": round(total_size / (1024 ** 3), 2),
        "total_sessions": total_sessions,
        "session_total_ms": session_total_ms,
        
        "avg_session_ms": avg_session_ms,
        "streak_days": streak_days,
        "untagged_files": untagged_files,
        "untagged_pct": round(untagged_pct, 1),
        "top_creator": top_creator[0] if top_creator else "None",

        "avg_files_per_gallery": round(avg_files_per_gallery, 1),
        "total_video_duration": total_video_duration,
        "avg_video_length": round(avg_video_length, 1),
        "last_added": last_added.isoformat() if last_added else None,
        "most_active_month": int(most_active_month[0]) if most_active_month and most_active_month[0] else None,
        "most_active_day": int(most_active_day[0]) if most_active_day and most_active_day[0] else None,
        
        "most_gooned_creator": {"id": most_gooned_creator.id, "name": most_gooned_creator.name} if most_gooned_creator else None,
        "most_gooned_gallery": {"id": most_gooned_gallery.id, "name": most_gooned_gallery.name} if most_gooned_gallery else None,
        "most_gooned_image": {"id": most_gooned_img.id, "filename": most_gooned_img.filename, "gallery_id": most_gooned_img.gallery_id} if most_gooned_img else None,
        "most_gooned_video": {"id": most_gooned_vid.id, "filename": most_gooned_vid.filename, "gallery_id": most_gooned_vid.gallery_id} if most_gooned_vid else None,
        
        "most_common_tag": most_common_tag[0] if most_common_tag else "None",
        "avg_rating": round(avg_rating, 1),
        "highest_file_size": highest_file_size,
        "new_creators_month": new_creators_month,
        "avg_tags_per_file": round(avg_tags_per_file, 1),
        "longest_session_sec": longest_session,
        "collection_value": round(collection_value, 2),
        "images_by_creator_type": images_by_creator_type,
    }


@router.post("/{gallery_id}/view")
def track_gallery_view(gallery_id: int, db: Session = Depends(get_db)):
    """Increment view_count when a gallery page is visited."""
    g = db.query(Gallery).filter(Gallery.id == gallery_id).first()
    if not g:
        raise HTTPException(404, "Gallery not found")
    g.view_count = (g.view_count or 0) + 1
    db.commit()
    return {"view_count": g.view_count}


@router.get("/hall-of-fame")
def hall_of_fame(db: Session = Depends(get_db), limit: int = 10):
    """Images ranked by view_count (primary). cum_count returned as secondary stat."""
    images = db.query(Image).order_by(Image.view_count.desc(), Image.cum_count.desc()).limit(limit).all()
    return [{"id": i.id, "filename": i.filename, "thumb_path": i.thumb_path,
             "view_count": i.view_count, "cum_count": i.cum_count,
             "gallery_id": i.gallery_id, "is_video": i.is_video} for i in images]


@router.get("/gallery-hof")
def gallery_hof(db: Session = Depends(get_db), limit: int = 5):
    """Galleries ranked by view_count (primary). cum_count returned as secondary stat."""
    galleries = (
        db.query(Gallery)
          .options(selectinload(Gallery.tags), selectinload(Gallery.creators))
          .filter(Gallery.view_count > 0)
          .order_by(Gallery.view_count.desc(), Gallery.cum_count.desc())
          .limit(limit)
          .all()
    )
    return [_enrich(g) for g in galleries]


@router.get("/recent")
def recent_galleries(db: Session = Depends(get_db), limit: int = 8):
    galleries = (
        db.query(Gallery)
          .options(selectinload(Gallery.tags), selectinload(Gallery.creators))
          .order_by(Gallery.created_at.desc())
          .limit(limit)
          .all()
    )
    return [_enrich(g) for g in galleries]


@router.get("/random")
def random_gallery(db: Session = Depends(get_db)):
    gallery = (
        db.query(Gallery)
          .options(selectinload(Gallery.tags), selectinload(Gallery.creators))
          .order_by(func.random())
          .first()
    )
    if not gallery:
        raise HTTPException(404, "No galleries found")
    return _enrich(gallery)


@router.get("/{gallery_id}/similar")
def similar_galleries(gallery_id: int, limit: int = 6, db: Session = Depends(get_db)):
    """Galleries sharing the most image-level tags with this gallery."""
    if not db.query(Gallery).filter(Gallery.id == gallery_id).first():
        raise HTTPException(404, "Gallery not found")
    rows = db.execute(text("""
        SELECT g.id, g.name, g.cover_thumb, g.image_count,
               g.cum_count, g.view_count,
               COUNT(DISTINCT it2.tag_id) AS shared_tags
        FROM galleries g
        JOIN images i2 ON i2.gallery_id = g.id
        JOIN image_tags it2 ON it2.image_id = i2.id
        WHERE it2.tag_id IN (
            SELECT DISTINCT it.tag_id
            FROM images i
            JOIN image_tags it ON it.image_id = i.id
            WHERE i.gallery_id = :gid
        )
          AND g.id != :gid
        GROUP BY g.id
        ORDER BY shared_tags DESC
        LIMIT :limit
    """), {"gid": gallery_id, "limit": limit}).fetchall()
    return [{"id": r[0], "name": r[1], "cover_thumb": r[2], "image_count": r[3],
             "cum_count": r[4], "view_count": r[5], "shared_tags": r[6]}
            for r in rows]


@router.get("/{gallery_id}", response_model=GalleryOut)
def get_gallery(gallery_id: int, db: Session = Depends(get_db)):
    g = (
        db.query(Gallery)
          .options(selectinload(Gallery.tags), selectinload(Gallery.creators))
          .filter(Gallery.id == gallery_id)
          .first()
    )
    if not g:
        raise HTTPException(404, "Gallery not found")
    # GET stays idempotent — view tracking handled elsewhere.
    return _enrich(g)


@router.post("/{gallery_id}/set-cover/{image_id}")
def set_gallery_cover(gallery_id: int, image_id: int, db: Session = Depends(get_db)):
    import os as _os
    g = db.query(Gallery).filter(Gallery.id == gallery_id).first()
    if not g:
        raise HTTPException(404, "Gallery not found")
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")
    if img.thumb_path:
        g.cover_thumb = f"/thumbs/{_os.path.basename(img.thumb_path)}"
        g.thumb_path  = img.thumb_path
        db.commit()
    return {"ok": True}


@router.patch("/{gallery_id}", response_model=GalleryOut)
def update_gallery(gallery_id: int, data: GalleryUpdate, db: Session = Depends(get_db)):
    g = db.query(Gallery).filter(Gallery.id == gallery_id).first()
    if not g:
        raise HTTPException(404, "Gallery not found")
    update_data = data.model_dump(exclude_unset=True)
    char_id = update_data.pop("linked_character_id", None)
    period_changed = "period_month" in update_data or "period_year" in update_data or "purchase_value" in update_data
    for field, value in update_data.items():
        setattr(g, field, value)
    db.commit()
    db.refresh(g)
    # Check completion reward for all assigned creators whenever period/value changes
    if period_changed:
        creator_ids = [c.id for c in g.creators]
        if g.creator_id and g.creator_id not in creator_ids:
            creator_ids.append(g.creator_id)
        for cid in creator_ids:
            gami.check_creator_completion(db, cid)
        db.commit()
    return _enrich(g)


@router.delete("/{gallery_id}")
def delete_gallery(gallery_id: int, delete_files: bool = False, db: Session = Depends(get_db)):
    g = db.query(Gallery).filter(Gallery.id == gallery_id).first()
    if not g:
        raise HTTPException(404, "Gallery not found")
    import os, shutil
    
    if delete_files and g.folder_path and os.path.exists(g.folder_path):
        try:
            shutil.rmtree(g.folder_path)
        except Exception:
            pass
            
    db.delete(g)
    db.commit()
    return {"deleted": gallery_id}


@router.post("/{gallery_id}/cum")
def log_cum(gallery_id: int, db: Session = Depends(get_db)):
    g = db.query(Gallery).filter(Gallery.id == gallery_id).first()
    if not g:
        raise HTTPException(404, "Gallery not found")
    g.cum_count += 1
    db.commit()
    xp = gami.notify_action(db, "cum_logged")
    return {"cum_count": g.cum_count, "xp": xp}


@router.post("/{gallery_id}/rate")
def rate_gallery(gallery_id: int, rating: float, db: Session = Depends(get_db)):
    """Set a 0–5 star rating on a gallery and award XP."""
    g = db.query(Gallery).filter(Gallery.id == gallery_id).first()
    if not g:
        raise HTTPException(404, "Gallery not found")
    if not (0 <= rating <= 5):
        raise HTTPException(400, "Rating must be between 0 and 5")
    g.rating = rating
    db.commit()
    xp = gami.notify_action(db, "gallery_rated", extra={"rating": rating})
    return {"rating": g.rating, "xp": xp}


def _natural_key(s: str):
    """Key for natural (human) sort: splits on numeric runs so F2 < F10."""
    return [int(c) if c.isdigit() else c.lower() for c in re.split(r'(\d+)', s or '')]


@router.get("/{gallery_id}/images")
def gallery_images(
    gallery_id: int,
    sort_by: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    q = db.query(Image).options(
        selectinload(Image.tags),
        selectinload(Image.gallery).selectinload(Gallery.creators),
    ).filter(Image.gallery_id == gallery_id)

    if sort_by == "random":
        q = q.order_by(func.random())
    elif sort_by == "date_added":
        q = q.order_by(Image.created_at.desc(), Image.id.desc())
    elif sort_by == "view_count":
        q = q.order_by(Image.view_count.desc(), Image.id.desc())
    elif sort_by == "cum_count":
        q = q.order_by(Image.cum_count.desc(), Image.id.desc())
    elif sort_by == "rating":
        q = q.order_by(Image.rating.desc(), Image.id.desc())
    elif sort_by == "file_size":
        q = q.order_by(Image.file_size.desc(), Image.id.desc())
    elif sort_by == "filename":
        # Natural sort in Python — for galleries scanned before this fix
        images = q.all()
        images.sort(key=lambda img: _natural_key(img.filename))
        return [_enrich_image(img) for img in images]
    else:
        q = q.order_by(Image.sort_order.asc(), Image.id.asc())

    images = q.all()
    return [_enrich_image(img) for img in images]


def _enrich_image(img: Image) -> dict:
    d = {c.name: getattr(img, c.name) for c in img.__table__.columns}
    d["tags"] = [{"id": t.id, "name": t.name, "category": t.category, "source": t.source, "color": t.color, "use_count": t.use_count} for t in img.tags]
    creators = []
    if img.gallery:
        creators = [{"id": c.id, "name": c.name, "creator_type": c.creator_type} for c in img.gallery.creators]
    d["creators"] = creators
    d["gallery_name"] = img.gallery.name if img.gallery else None
    return d


# ── Creator assignment ─────────────────────────────────────────────────────────

@router.post("/{gallery_id}/creators/{creator_id}")
def add_creator(gallery_id: int, creator_id: int, db: Session = Depends(get_db)):
    g = db.query(Gallery).filter(Gallery.id == gallery_id).first()
    if not g:
        raise HTTPException(404, "Gallery not found")
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")
    if c not in g.creators:
        g.creators.append(c)
        g.is_tagged = True
        # Keep legacy creator_id in sync with the first assigned creator
        if g.creator_id is None:
            g.creator_id = creator_id
        db.commit()
        image_count = max(1, g.image_count or 0)
        gami.notify_action(db, "gallery_assigned", override_amount=image_count)
    return _enrich(g)


@router.delete("/{gallery_id}/creators/{creator_id}")
def remove_creator(gallery_id: int, creator_id: int, db: Session = Depends(get_db)):
    g = db.query(Gallery).filter(Gallery.id == gallery_id).first()
    if not g:
        raise HTTPException(404, "Gallery not found")
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if c and c in g.creators:
        g.creators.remove(c)
        # If no creators left, mark untagged and clear legacy FK
        if not g.creators:
            g.is_tagged = False
            g.creator_id = None
        elif g.creator_id == creator_id:
            g.creator_id = g.creators[0].id
        db.commit()
    return _enrich(g)


@router.post("/bulk-assign")
def bulk_assign(
    body: dict,
    db: Session = Depends(get_db),
):
    """Assign one creator to multiple galleries at once."""
    gallery_ids = body.get("gallery_ids", [])
    creator_id  = body.get("creator_id")
    if not creator_id:
        raise HTTPException(400, "creator_id required")
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        raise HTTPException(404, "Creator not found")

    updated = 0
    total_images = 0
    for gid in gallery_ids:
        g = db.query(Gallery).filter(Gallery.id == gid).first()
        if g and c not in g.creators:
            g.creators.append(c)
            g.is_tagged = True
            if g.creator_id is None:
                g.creator_id = creator_id
            total_images += max(1, g.image_count or 0)
            updated += 1
    db.commit()
    if updated > 0:
        gami.notify_action(db, "gallery_assigned", override_amount=total_images)
    return {"updated": updated}


# ── Gallery merge ──────────────────────────────────────────────────────────────

from pydantic import BaseModel as _BaseModel

class MergeRequest(_BaseModel):
    source_id: int
    move_files: bool = True
    collision_strategy: str = "rename"   # "replace" | "rename" | "skip"


@router.post("/{target_id}/merge")
def merge_gallery(target_id: int, req: MergeRequest, db: Session = Depends(get_db)):
    """
    Merge source gallery INTO target gallery.
    - If move_files=True: physically moves each file into target's folder.
      Collisions resolved per collision_strategy (replace/rename/skip).
      Skipped images stay in source gallery; source is deleted only if empty.
    - If move_files=False: only DB records are updated; no files touched.
    """
    import os, shutil

    if target_id == req.source_id:
        raise HTTPException(400, "Source and target gallery must be different")

    target = db.query(Gallery).options(
        selectinload(Gallery.creators)
    ).filter(Gallery.id == target_id).first()
    if not target:
        raise HTTPException(404, "Target gallery not found")

    source = db.query(Gallery).options(
        selectinload(Gallery.creators)
    ).filter(Gallery.id == req.source_id).first()
    if not source:
        raise HTTPException(404, "Source gallery not found")

    images = db.query(Image).filter(Image.gallery_id == req.source_id).all()

    moved = renamed = replaced = skipped = db_only = 0

    for img in images:
        if not req.move_files:
            img.gallery_id = target_id
            db_only += 1
            continue

        # Determine destination
        target_folder = target.folder_path
        if not target_folder or not os.path.isdir(target_folder):
            # Target folder doesn't exist — fall back to DB-only for this image
            img.gallery_id = target_id
            db_only += 1
            continue

        src_path = img.file_path
        if not src_path or not os.path.isfile(src_path):
            # Source file missing — just reassign DB record
            img.gallery_id = target_id
            db_only += 1
            continue

        filename = os.path.basename(src_path)
        dst_path = os.path.join(target_folder, filename)
        new_filename = filename

        if os.path.exists(dst_path) and dst_path != src_path:
            if req.collision_strategy == "skip":
                skipped += 1
                continue   # leave image in source gallery
            elif req.collision_strategy == "replace":
                # Overwrite — remove existing file first so shutil.move works cleanly
                try:
                    os.remove(dst_path)
                except OSError:
                    pass
                replaced += 1
            else:  # rename
                base, ext = os.path.splitext(filename)
                counter = 1
                while os.path.exists(dst_path):
                    new_filename = f"{base}_{counter}{ext}"
                    dst_path = os.path.join(target_folder, new_filename)
                    counter += 1
                renamed += 1

        try:
            shutil.move(src_path, dst_path)
            img.file_path = dst_path
            img.filename  = new_filename
            img.gallery_id = target_id
            moved += 1
        except Exception:
            skipped += 1
            continue

    # Merge creator assignments — add any source creators not already on target
    target_creator_ids = {c.id for c in target.creators}
    for c in source.creators:
        if c.id not in target_creator_ids:
            target.creators.append(c)
            target.is_tagged = True
            if target.creator_id is None:
                target.creator_id = c.id

    # Recalculate image counts
    remaining_in_source = db.query(Image).filter(Image.gallery_id == req.source_id).count()
    target.image_count = db.query(Image).filter(Image.gallery_id == target_id).count()

    db.commit()

    # Delete source gallery only if it's now empty
    source_deleted = False
    if remaining_in_source == 0:
        db.delete(source)
        db.commit()
        source_deleted = True

    return {
        "moved":          moved,
        "renamed":        renamed,
        "replaced":       replaced,
        "skipped":        skipped,
        "db_only":        db_only,
        "source_deleted": source_deleted,
        "source_id":      req.source_id,
        "target_id":      target_id,
    }

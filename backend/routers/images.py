import os
import re
import mimetypes
import aiofiles
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Body, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import func, nullslast, select, or_, and_
from typing import Optional, List

from database import get_db, _read_config
from models import Image, Gallery, Tag, image_tags, TagSource, gallery_creators, mix_images, Creator, image_creators
from schemas import ImageOut, ImageUpdate, CumCountUpdate, EdgeLogIn
import services.gamification as gami
from services import activity
from services import dedup as dedup_svc
from services import edges as edges_svc
from services import entity_stats

router = APIRouter()


def _enrich_image(img: Image, db: Session) -> dict:
    d = {c.name: getattr(img, c.name) for c in img.__table__.columns}

    # Fetch confidence + tagger_model from the junction table in one query
    conf_rows = db.execute(
        select(image_tags.c.tag_id, image_tags.c.confidence, image_tags.c.tagger_model)
        .where(image_tags.c.image_id == img.id)
    ).fetchall()
    conf_map = {row.tag_id: (row.confidence, row.tagger_model) for row in conf_rows}

    d["tags"] = [
        {
            "id": t.id, "name": t.name, "category": t.category,
            "source": t.source, "color": t.color, "use_count": t.use_count,
            "confidence":   conf_map.get(t.id, (None, None))[0],
            "tagger_model": conf_map.get(t.id, (None, None))[1],
        }
        for t in img.tags
    ]

    # Creator resolution: file-level assignments are ADDITIVE on top of gallery-level.
    # Gallery creators always show; file-level creators are merged in on top (deduped by ID).
    file_creator_rows = db.execute(
        select(image_creators.c.creator_id).where(image_creators.c.image_id == img.id)
    ).fetchall()
    file_creator_ids = [r.creator_id for r in file_creator_rows]

    gallery_creators_list = [
        {"id": c.id, "name": c.name, "creator_type": c.creator_type}
        for c in (img.gallery.creators if img.gallery else [])
    ]

    if file_creator_ids:
        file_creator_objs = db.query(Creator).filter(Creator.id.in_(file_creator_ids)).all()
        file_creator_map = {c.id: {"id": c.id, "name": c.name, "creator_type": c.creator_type} for c in file_creator_objs}
        gallery_ids = {c["id"] for c in gallery_creators_list}
        # Gallery creators first, then any file-only creators not already in the list
        merged = gallery_creators_list + [file_creator_map[fid] for fid in file_creator_ids if fid not in gallery_ids and fid in file_creator_map]
        d["creators"] = merged
        d["has_image_creators"] = True
        d["file_creator_ids"] = file_creator_ids
    else:
        d["creators"] = gallery_creators_list
        d["has_image_creators"] = False
        d["file_creator_ids"] = []

    d["gallery_name"] = img.gallery.name if img.gallery else None
    return d


def _natural_key(s: str):
    """Key for natural (human) sort: splits on numeric runs so F2 < F10."""
    return [int(c) if c.isdigit() else c.lower() for c in re.split(r'(\d+)', s or '')]


def _apply_image_filters(
    q,
    db: Session,
    *,
    search: Optional[str] = None,
    tag: Optional[str] = None,
    tags: Optional[str] = None,
    creator_id: Optional[int] = None,
    creator_type: Optional[str] = None,
    series: Optional[str] = None,
    gallery_id: Optional[int] = None,
    is_video: Optional[bool] = None,
    favorite: Optional[bool] = None,
    period: Optional[str] = None,
):
    """Apply the standard image-list filters to a query.

    Shared by the image list endpoint and the image periods endpoint so the
    period dropdown reflects exactly the same filter context as the grid.
    `period` is optional — the periods endpoint omits it so it can show every
    period available under the *other* active filters. Period lives on Gallery,
    so it is applied as a subquery over Image.gallery_id to stay agnostic of
    whatever joins the other filters introduced.
    """
    if search:
        q = q.filter(Image.filename.ilike(f"%{search}%"))
    # Multi-tag: comma-separated, each tag must be present (AND)
    tag_list = [t.strip().lower() for t in (tags or tag or '').split(',') if t.strip()]
    for tag_name in tag_list:
        q = q.filter(Image.tags.any(Tag.name == tag_name))
    if creator_id or creator_type or series:
        if creator_id:
            # Dual-path: images directly assigned to creator (file-level) OR gallery-assigned.
            # Additive model — both paths contribute; OR deduplicates naturally.
            directly_assigned = (
                select(image_creators.c.image_id)
                .where(image_creators.c.creator_id == creator_id)
                .scalar_subquery()
            )
            gallery_assigned = (
                select(Image.id)
                .join(Gallery, Gallery.id == Image.gallery_id)
                .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
                .where(gallery_creators.c.creator_id == creator_id)
                .scalar_subquery()
            )
            q = q.filter(
                or_(
                    Image.id.in_(directly_assigned),
                    Image.id.in_(gallery_assigned),
                )
            )
        elif creator_type or series:
            # No specific creator_id — filter by type/series via gallery join
            q = q.join(Gallery, Gallery.id == Image.gallery_id)\
                 .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)\
                 .join(Creator, Creator.id == gallery_creators.c.creator_id)
            if creator_type:
                q = q.filter(Creator.creator_type == creator_type)
            if series:
                q = q.filter(Creator.series.ilike(f"%{series}%"))
    if gallery_id:
        gallery = db.query(Gallery).filter(Gallery.id == gallery_id).first()
        if gallery and gallery.is_mix:
            mix_image_ids = db.execute(
                mix_images.select().where(mix_images.c.gallery_id == gallery_id)
                .order_by(mix_images.c.sort_order)
            ).fetchall()
            ids = [row.image_id for row in mix_image_ids]
            q = q.filter(Image.id.in_(ids))
        else:
            q = q.filter(Image.gallery_id == gallery_id)
    if is_video is not None:
        q = q.filter(Image.is_video == is_video)
    if favorite is not None:
        q = q.filter(Image.is_favorite == favorite)
    # Period lives on Gallery — match via the image's gallery (subquery keeps this
    # independent of any join the filters above may or may not have added).
    if period:
        parts = period.split('-')
        if parts[0].isdigit():
            gp = select(Gallery.id).where(Gallery.period_year == int(parts[0]))
            if len(parts) > 1 and parts[1].isdigit():
                gp = gp.where(Gallery.period_month == int(parts[1]))
            q = q.filter(Image.gallery_id.in_(gp))
    return q


@router.get("/", response_model=List[ImageOut])
def list_images(
    response: Response,
    db: Session = Depends(get_db),
    search: Optional[str] = None,
    tag: Optional[str] = None,
    creator_id: Optional[int] = None,
    creator_type: Optional[str] = None,  # cosplayer | ethot | artist | character | actress | custom
    series: Optional[str] = None,  # franchise / series filter (partial match)
    gallery_id: Optional[int] = None,
    is_video: Optional[bool] = None,
    favorite: Optional[bool] = None,
    period: Optional[str] = None,  # "YYYY" or "YYYY-MM" — filter by the gallery's collection period
    sort_by: Optional[str] = "date_added",  # date_added | filename | rating | cum_count | file_size | view_count | date_modified | random
    sort_dir: Optional[str] = None,  # asc | desc — defaults depend on sort_by
    _seed: float = 0,  # stable shuffle seed for sort_by=random. float, because the
                       # client seeds with Math.random(); scaled to an int below.
    tags: Optional[str] = None,  # comma-separated, AND logic
    skip: int = 0,
    limit: int = 200,
):
    q = db.query(Image).options(
        selectinload(Image.tags),
        selectinload(Image.gallery).selectinload(Gallery.creators),
    )
    q = _apply_image_filters(
        q, db,
        search=search, tag=tag, tags=tags, creator_id=creator_id,
        creator_type=creator_type, series=series, gallery_id=gallery_id,
        is_video=is_video, favorite=favorite, period=period,
    )

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
        q = q.order_by(Image.rating.asc() if (use_asc if use_asc is not None else False) else Image.rating.desc())
    elif sort_by == "cum_count":
        q = q.order_by(Image.cum_count.asc() if (use_asc if use_asc is not None else False) else Image.cum_count.desc())
    elif sort_by == "file_size":
        q = q.order_by(Image.file_size.asc() if (use_asc if use_asc is not None else False) else Image.file_size.desc())
    elif sort_by == "view_count":
        q = q.order_by(Image.view_count.asc() if (use_asc if use_asc is not None else False) else Image.view_count.desc())
    elif sort_by == "date_modified":
        asc = (use_asc if use_asc is not None else False)
        q = q.order_by(nullslast(Image.file_modified_at.asc() if asc else Image.file_modified_at.desc()))
    elif sort_by == "random":
        # A seeded shuffle keeps the order stable across refetches. Without it,
        # any refetch (favouriting, rating, paging) re-rolls func.random() and
        # the whole list jumps around under the user.
        if _seed:
            # Non-linear mix. A plain (id * seed) % prime stays monotonic while the
            # product is below the prime, so low ids came out in plain id order.
            # Offsetting into a high range and squaring makes it wrap and scatter.
            _s = (int(abs(float(_seed)) * 1_000_000) % 99991) + 1
            _b = (Image.id * _s + 54321) % 100003
            q = q.order_by((_b * _b) % 100003, Image.id)
        else:
            q = q.order_by(func.random())
    elif sort_by == "filename":
        images = q.offset(skip).limit(limit).all()
        asc = (use_asc if use_asc is not None else True)
        images.sort(key=lambda img: _natural_key(img.filename), reverse=not asc)
        return [_enrich_image(img, db) for img in images]
    else:  # date_added
        q = q.order_by(Image.created_at.asc() if (use_asc if use_asc is not None else False) else Image.created_at.desc())
    images = q.offset(skip).limit(limit).all()
    return [_enrich_image(img, db) for img in images]


@router.get("/periods")
def list_image_periods(
    db: Session = Depends(get_db),
    search: Optional[str] = None,
    tag: Optional[str] = None,
    tags: Optional[str] = None,
    creator_id: Optional[int] = None,
    creator_type: Optional[str] = None,
    series: Optional[str] = None,
    gallery_id: Optional[int] = None,
    is_video: Optional[bool] = None,
    favorite: Optional[bool] = None,
):
    """Distinct collection periods (from each image's gallery) for the filter
    dropdown in the Image/Video view, newest first. Respects the same filters as
    the image list so the dropdown only offers periods present in the currently
    filtered set. `period` is deliberately not a parameter — we always show every
    period available under the *other* filters."""
    from datetime import datetime
    filtered_ids = _apply_image_filters(
        db.query(Image.id), db,
        search=search, tag=tag, tags=tags, creator_id=creator_id,
        creator_type=creator_type, series=series, gallery_id=gallery_id,
        is_video=is_video, favorite=favorite,
    ).scalar_subquery()
    rows = (
        db.query(Gallery.period_year, Gallery.period_month, func.count(Image.id.distinct()))
        .join(Image, Image.gallery_id == Gallery.id)
        .filter(Image.id.in_(filtered_ids))
        .filter(Gallery.period_year.isnot(None))
        .group_by(Gallery.period_year, Gallery.period_month)
        .order_by(Gallery.period_year.desc(), Gallery.period_month.desc())
        .all()
    )
    out = []
    for year, month, count in rows:
        if month:
            value = f"{year}-{month:02d}"
            label = datetime(year, month, 1).strftime("%b %Y")
        else:
            value = str(year)
            label = str(year)
        out.append({"value": value, "label": label, "count": count})
    return out


@router.get("/{image_id}", response_model=ImageOut)
def get_image(image_id: int, db: Session = Depends(get_db)):
    img = db.query(Image).options(
        selectinload(Image.tags),
        selectinload(Image.gallery).selectinload(Gallery.creators),
    ).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")
    # View counting is done explicitly via POST /{id}/view — GET stays idempotent.
    return _enrich_image(img, db)


@router.post("/{image_id}/view")
def track_view(image_id: int, db: Session = Depends(get_db)):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")
    img.view_count += 1
    img.last_viewed_at = datetime.now(timezone.utc)
    activity.record(db, "view", image_id=img.id)
    db.commit()
    return {"view_count": img.view_count}


@router.post("/{image_id}/duration")
def track_duration(image_id: int, data: dict = Body(default={}), db: Session = Depends(get_db)):
    """Log seconds spent viewing an image — called when the viewer closes or advances."""
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")
    secs = int(data.get("seconds", 0))
    if secs > 0:
        capped = min(secs, 3600)  # cap single session at 1h
        img.view_seconds = (img.view_seconds or 0) + capped
        activity.record(db, "seconds", image_id=img.id, amount=capped)
        db.commit()
    return {"view_seconds": img.view_seconds}


@router.patch("/{image_id}", response_model=ImageOut)
def update_image(image_id: int, data: ImageUpdate, db: Session = Depends(get_db)):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")
    xp_event = None
    if data.rating is not None:
        img.rating = data.rating
        xp_event = gami.notify_action(db, "image_rated")
    if data.is_favorite is not None:
        img.is_favorite = data.is_favorite
    if data.gallery_id is not None and data.gallery_id != img.gallery_id:
        old_gallery_id = img.gallery_id
        target = db.query(Gallery).filter(Gallery.id == data.gallery_id).first()
        if not target:
            raise HTTPException(404, f"Gallery {data.gallery_id} not found")
        moved_thumb_url = f"/thumbs/{os.path.basename(img.thumb_path)}" if img.thumb_path else None
        img.gallery_id = data.gallery_id
        db.flush()
        # Recount source gallery and re-cover if we just removed its cover image
        if old_gallery_id:
            src = db.query(Gallery).filter(Gallery.id == old_gallery_id).first()
            if src:
                src.image_count = db.query(Image).filter(Image.gallery_id == old_gallery_id).count()
                if moved_thumb_url and src.cover_thumb == moved_thumb_url:
                    # Pick another image (prefer non-video) as new cover, or clear it
                    replacement = (
                        db.query(Image)
                          .filter(Image.gallery_id == old_gallery_id, Image.thumb_path.isnot(None))
                          .order_by(Image.is_video.asc(), Image.sort_order, Image.id)
                          .first()
                    )
                    if replacement and replacement.thumb_path and os.path.exists(replacement.thumb_path):
                        src.cover_thumb = f"/thumbs/{os.path.basename(replacement.thumb_path)}"
                    else:
                        src.cover_thumb = None
        # Recount target gallery
        target.image_count = db.query(Image).filter(Image.gallery_id == data.gallery_id).count()
        # Give target a cover thumbnail if it doesn't have one
        if not target.cover_thumb and img.thumb_path and os.path.exists(img.thumb_path):
            target.cover_thumb = f"/thumbs/{os.path.basename(img.thumb_path)}"
    db.commit()
    db.refresh(img)
    result = _enrich_image(img, db)
    if xp_event:
        result["xp"] = xp_event
    return result



@router.post("/{image_id}/cum")
def log_cum(image_id: int, data: CumCountUpdate, db: Session = Depends(get_db)):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")
    img.cum_count += 1
    activity.record(db, "cum", image_id=img.id)
    # Also bump gallery count
    if img.gallery_id:
        gallery = db.query(Gallery).filter(Gallery.id == img.gallery_id).first()
        if gallery:
            gallery.cum_count += 1
            activity.record(db, "gallery_cum", gallery_id=gallery.id)
    db.commit()
    xp = gami.notify_action(db, "cum_logged")
    return {"cum_count": img.cum_count, "xp": xp}


@router.get("/{image_id}/stats")
def image_stats(image_id: int, db: Session = Depends(get_db)):
    """Deep stats for a single photo or video."""
    d = entity_stats.image_stats(db, image_id)
    if d is None:
        raise HTTPException(404, "Image not found")
    return d


@router.post("/edge")
def log_edge(data: EdgeLogIn, db: Session = Depends(get_db)):
    """Record one Edge Mode edge against everything that was on screen.

    Batched deliberately: the multi-panel viewer can have half a dozen images
    up at once, and one edge should be one round trip.
    """
    return edges_svc.log_edge(db, data.image_ids)


@router.post("/{image_id}/tags/{tag_name}")
def add_tag(image_id: int, tag_name: str, db: Session = Depends(get_db)):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")

    tag = db.query(Tag).filter(Tag.name == tag_name.lower().strip()).first()
    if not tag:
        tag = Tag(name=tag_name.lower().strip(), source=TagSource.manual)
        db.add(tag)
        db.flush()

    xp_event = None
    if tag not in img.tags:
        img.tags.append(tag)
        tag.use_count += 1
        xp_event = gami.notify_action(db, "tag_added")

    db.commit()
    result = {"tag": tag.name, "image_id": image_id}
    if xp_event:
        result["xp"] = xp_event
    return result


@router.delete("/{image_id}/tags/{tag_name}")
def remove_tag(image_id: int, tag_name: str, db: Session = Depends(get_db)):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")
    tag = db.query(Tag).filter(Tag.name == tag_name.lower().strip()).first()
    if tag and tag in img.tags:
        img.tags.remove(tag)
        tag.use_count = max(0, tag.use_count - 1)
        db.commit()
    return {"removed": tag_name}


@router.post("/{image_id}/creators/{creator_id}")
def add_image_creator(image_id: int, creator_id: int, db: Session = Depends(get_db)):
    """Assign a creator directly to this file (overrides gallery-level inheritance for this image)."""
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")
    creator = db.query(Creator).filter(Creator.id == creator_id).first()
    if not creator:
        raise HTTPException(404, "Creator not found")
    existing = db.execute(
        select(image_creators).where(
            image_creators.c.image_id == image_id,
            image_creators.c.creator_id == creator_id,
        )
    ).first()
    if not existing:
        db.execute(image_creators.insert().values(image_id=image_id, creator_id=creator_id))
        db.commit()
    return {"image_id": image_id, "creator_id": creator_id}


@router.delete("/{image_id}/creators/{creator_id}")
def remove_image_creator(image_id: int, creator_id: int, db: Session = Depends(get_db)):
    """Remove one creator from this file's image-level assignment."""
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")
    db.execute(
        image_creators.delete().where(
            image_creators.c.image_id == image_id,
            image_creators.c.creator_id == creator_id,
        )
    )
    db.commit()
    return {"removed": creator_id}


@router.delete("/{image_id}/creators")
def clear_image_creators(image_id: int, db: Session = Depends(get_db)):
    """Clear all image-level creator assignments — image reverts to inheriting from gallery."""
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")
    db.execute(image_creators.delete().where(image_creators.c.image_id == image_id))
    db.commit()
    return {"cleared": image_id}


@router.post("/bulk-assign-creator")
def bulk_assign_image_creator(data: dict = Body(default={}), db: Session = Depends(get_db)):
    """Assign one creator to many files in a single round-trip.

    The context menu used to fire one POST per selected file, which is why
    assigning across a big selection sat there spinning. Existing links are
    skipped so re-assigning is idempotent.
    """
    image_ids = [int(i) for i in (data.get("image_ids") or []) if i]
    creator_id = data.get("creator_id")
    if not image_ids or not creator_id:
        return {"assigned": 0, "already_linked": 0}

    creator = db.query(Creator).filter(Creator.id == int(creator_id)).first()
    if not creator:
        raise HTTPException(404, "Creator not found")

    # Only real images — a stale id from the client must not create a dangling row.
    valid_ids = [
        r.id for r in db.query(Image.id).filter(Image.id.in_(image_ids)).all()
    ]
    if not valid_ids:
        return {"assigned": 0, "already_linked": 0}

    existing = {
        r.image_id for r in db.execute(
            select(image_creators.c.image_id).where(
                image_creators.c.image_id.in_(valid_ids),
                image_creators.c.creator_id == creator.id,
            )
        ).all()
    }
    new_ids = [i for i in valid_ids if i not in existing]
    if new_ids:
        db.execute(
            image_creators.insert(),
            [{"image_id": i, "creator_id": creator.id} for i in new_ids],
        )
        db.commit()

    return {
        "assigned": len(new_ids),
        "already_linked": len(existing),
        "creator_id": creator.id,
        "creator_name": creator.name,
        # Lets the client patch its cached rows in place instead of refetching
        # the whole page just to learn the creator's type.
        "creator_type": creator.creator_type,
    }


@router.post("/bulk-clear-creators")
def bulk_clear_image_creators(data: dict = Body(default={}), db: Session = Depends(get_db)):
    """Strip image-level creator assignments from many images at once.

    Those images go back to inheriting whoever is on their gallery.
    """
    image_ids = [int(i) for i in (data.get("image_ids") or []) if i]
    if not image_ids:
        return {"updated": 0, "removed_links": 0}

    removed = db.execute(
        image_creators.delete().where(image_creators.c.image_id.in_(image_ids))
    ).rowcount or 0
    db.commit()
    return {"updated": len(image_ids), "removed_links": removed}


@router.get("/random/pick", response_model=ImageOut)
def random_image(db: Session = Depends(get_db), tag: str = None):
    q = db.query(Image).options(
        selectinload(Image.tags),
        selectinload(Image.gallery).selectinload(Gallery.creators),
    ).filter(Image.is_video == False)
    if tag:
        q = q.join(Image.tags).filter(Tag.name == tag)
    img = q.order_by(func.random()).first()
    if not img:
        raise HTTPException(404, "No images found")
    return _enrich_image(img, db)


@router.post("/bulk-delete")
def bulk_delete_images(data: dict = Body(...), keep_file: bool = False, db: Session = Depends(get_db)):
    """Delete multiple images in a single DB transaction.
    Accepts {"ids": [1, 2, 3, ...]}. Files are deleted from disk unless keep_file=true.
    Returns {"deleted": N, "ids": [...]}."""
    ids = data.get("ids", [])
    if not ids:
        return {"deleted": 0, "ids": []}

    images = db.query(Image).filter(Image.id.in_(ids)).all()
    gallery_ids = {img.gallery_id for img in images if img.gallery_id}

    deleted_ids = []
    for img in images:
        if not keep_file:
            try:
                if img.file_path and os.path.exists(img.file_path):
                    os.remove(img.file_path)
                if img.thumb_path and os.path.exists(img.thumb_path):
                    os.remove(img.thumb_path)
            except Exception:
                pass
        db.delete(img)
        deleted_ids.append(img.id)

    db.flush()

    # Recount all affected galleries in one pass after all deletes are staged
    for gid in gallery_ids:
        gallery = db.query(Gallery).filter(Gallery.id == gid).first()
        if gallery:
            gallery.image_count = db.query(Image).filter(Image.gallery_id == gid).count()

    db.commit()
    # Invalidate the dedup cache so the duplicate-finder page reflects deletions immediately
    dedup_svc.clear_search_cache()
    return {"deleted": len(deleted_ids), "ids": deleted_ids}


@router.delete("/{image_id}")
def delete_image(image_id: int, keep_file: bool = False, db: Session = Depends(get_db)):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")

    gallery_id = img.gallery_id

    if not keep_file:
        try:
            if img.file_path and os.path.exists(img.file_path):
                os.remove(img.file_path)
            if img.thumb_path and os.path.exists(img.thumb_path):
                os.remove(img.thumb_path)
        except Exception:
            pass

    db.delete(img)
    db.flush()
    if gallery_id:
        gallery = db.query(Gallery).filter(Gallery.id == gallery_id).first()
        if gallery:
            gallery.image_count = db.query(Image).filter(Image.gallery_id == gallery_id).count()
    db.commit()
    return {"deleted": image_id}



# Mirrors services/scanner.py — file extensions we ever index, and therefore the
# only ones the file endpoint will ever serve. Defense-in-depth.
_SERVE_EXTS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".avif",
    ".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".wmv",
}

_VIDEO_EXTS  = {".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".wmv"}
_CHUNK_SIZE  = 256 * 1024   # 256 KB per aiofiles read


def _video_response(path: str, range_header: str | None, request=None) -> StreamingResponse:
    """
    Range-aware video streaming using aiofiles for truly async file I/O.

    aiofiles.open() runs each read in a thread-pool executor, yielding the
    event loop back between reads so other requests are serviced normally.

    request.is_disconnected() is polled before every chunk. On Windows the
    proactor event loop does not always raise ConnectionResetError promptly
    when a browser cancels a video load (e.g. hover-preview teardown or rapid
    navigation). Without this check, abandoned generators keep reading from
    disk and holding open HTTP connections, which saturates Chrome's
    6-connection-per-origin limit and freezes the entire app.
    """
    file_size  = os.path.getsize(path)
    mime_type, _ = mimetypes.guess_type(path)
    mime_type  = mime_type or "application/octet-stream"

    if range_header:
        try:
            val = range_header.strip().replace("bytes=", "")
            s, _, e = val.partition("-")
            start = int(s) if s else 0
            end   = int(e) if e else file_size - 1
        except ValueError:
            raise HTTPException(400, "Invalid Range header")

        end = min(end, file_size - 1)
        if start > end or start < 0:
            raise HTTPException(416, "Range Not Satisfiable")

        length = end - start + 1

        async def _iter_range():
            async with aiofiles.open(path, "rb") as f:
                await f.seek(start)
                remaining = length
                while remaining > 0:
                    if request is not None and await request.is_disconnected():
                        break
                    data = await f.read(min(_CHUNK_SIZE, remaining))
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        return StreamingResponse(
            _iter_range(),
            status_code=206,
            headers={
                "Content-Range":  f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges":  "bytes",
                "Content-Length": str(length),
                "Content-Type":   mime_type,
            },
        )

    # No Range header — send the full file (browser will seek via subsequent Range requests)
    async def _iter_full():
        async with aiofiles.open(path, "rb") as f:
            while True:
                if request is not None and await request.is_disconnected():
                    break
                data = await f.read(_CHUNK_SIZE)
                if not data:
                    break
                yield data

    return StreamingResponse(
        _iter_full(),
        headers={
            "Accept-Ranges":  "bytes",
            "Content-Length": str(file_size),
            "Content-Type":   mime_type,
        },
    )


@router.patch("/{image_id}/focal-point")
def update_focal_point(image_id: int, data: dict, db: Session = Depends(get_db)):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")
    img.focal_x = max(0.0, min(1.0, float(data.get("focal_x", 0.5))))
    img.focal_y = max(0.0, min(1.0, float(data.get("focal_y", 0.0))))
    db.commit()
    return {"focal_x": img.focal_x, "focal_y": img.focal_y}


# Filename-suffix → T-Code axis id, per the multi-axis funscript convention used
# by MultiFunPlayer / OFS. The bare ".funscript" is always the L0 stroke track.
#   clip.funscript        → L0  (up/down stroke)
#   clip.surge.funscript  → L1  (forward/back)
#   clip.sway.funscript   → L2  (left/right)
#   clip.twist.funscript  → R0  (twist / yaw)
#   clip.roll.funscript   → R1  (roll)
#   clip.pitch.funscript  → R2  (pitch)
_AXIS_SUFFIXES = {
    "surge": "L1",
    "sway":  "L2",
    "twist": "R0",
    "roll":  "R1",
    "pitch": "R2",
}


def _read_funscript_json(path: str):
    """Load a funscript JSON file, returning None on any failure (missing, malformed)."""
    import json
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _collect_funscript_axes(main_path: str):
    """
    Load the main .funscript plus any sibling axis files and return
    (axes_dict, main_json) where axes_dict maps axisId → actions[].

    Sources, in order:
      1. The main file's own `actions`            → L0
      2. A single-file embedded `axes` array      → each {id, actions}
      3. Sibling files (clip.roll.funscript, …)   → mapped via _AXIS_SUFFIXES
    Missing or invalid sources are skipped silently — this never raises.
    """
    axes = {}
    main = _read_funscript_json(main_path)
    if main is None:
        return axes, None

    if isinstance(main.get("actions"), list):
        axes["L0"] = main["actions"]

    # Single-file embedded multi-axis (e.g. OFS): {"axes": [{"id": "R1", "actions": [...]}]}
    embedded = main.get("axes")
    if isinstance(embedded, list):
        for ax in embedded:
            if isinstance(ax, dict) and ax.get("id") and isinstance(ax.get("actions"), list):
                axes[str(ax["id"]).upper()] = ax["actions"]

    # Sibling axis files next to the main script
    if main_path.lower().endswith(".funscript"):
        base = main_path[: -len(".funscript")]
    else:
        base = os.path.splitext(main_path)[0]
    for suffix, axis_id in _AXIS_SUFFIXES.items():
        sibling = f"{base}.{suffix}.funscript"
        if os.path.exists(sibling):
            data = _read_funscript_json(sibling)
            if data and isinstance(data.get("actions"), list):
                axes[axis_id] = data["actions"]

    return axes, main


@router.get("/{image_id}/funscript")
def get_funscript(image_id: int, db: Session = Depends(get_db)):
    """
    Return the funscript JSON for a video that has one.

    Backward compatible: top-level `actions` is still the L0 stroke track, so
    existing single-axis consumers (waveform viz, sync) are unaffected. A
    normalized `axes` object ({ "L0": [...], "R1": [...], ... }) is added,
    populated from sibling axis files and/or an embedded multi-axis array.
    """
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")
    if not img.funscript_path:
        raise HTTPException(404, "No funscript associated with this image")
    if not os.path.exists(img.funscript_path):
        raise HTTPException(404, "Funscript file not found on disk")

    axes, main = _collect_funscript_axes(img.funscript_path)
    if main is None:
        raise HTTPException(500, "Failed to read funscript")
    # Replace any raw embedded `axes` list with the normalized { axisId: actions } map.
    main["axes"] = axes
    return main


def _unique_funscript_dest(dest_dir: str, filename: str, old_path: Optional[str] = None) -> str:
    """
    Return a non-colliding path in dest_dir for `filename`.
    If the only collision is with `old_path` (this video's current linked
    script), reuse that exact path so it gets overwritten in place.
    `anran.funscript` -> `anran (2).funscript` on unrelated collisions.
    """
    base, ext = os.path.splitext(filename)
    candidate = os.path.join(dest_dir, filename)
    if old_path and os.path.abspath(candidate) == os.path.abspath(old_path):
        return candidate
    if not os.path.exists(candidate):
        return candidate
    n = 2
    while os.path.exists(candidate):
        candidate = os.path.join(dest_dir, f"{base} ({n}){ext}")
        n += 1
    return candidate


@router.post("/{image_id}/funscript")
def link_funscript(image_id: int, body: dict = Body(...), db: Session = Depends(get_db)):
    """
    Permanently link a funscript to a video. If a central funscript library
    folder is configured (`funscript_library_path`), the script is written
    there as `<videoname>.funscript` so `match_funscript_library` can re-link
    it later; otherwise it falls back to writing beside the video as before.
    `funscript_path` is persisted either way. Body: { "content": "<raw funscript JSON>" }.
    """
    import json as _json
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")
    if not img.is_video:
        raise HTTPException(400, "Funscripts can only be linked to videos")
    if not img.file_path or not os.path.exists(img.file_path):
        raise HTTPException(404, "Video file not found on disk")

    content = body.get("content") or ""
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(400, "Funscript too large")
    try:
        parsed = _json.loads(content)
    except Exception:
        raise HTTPException(400, "Not valid JSON")
    if not isinstance(parsed.get("actions"), list) or not parsed["actions"]:
        raise HTTPException(400, "Not a valid funscript (no actions)")

    video_base = os.path.splitext(os.path.basename(img.file_path))[0]
    filename = video_base + ".funscript"

    library_path = (_read_config().get("funscript_library_path") or "").strip()
    if library_path and os.path.isdir(library_path):
        dest = _unique_funscript_dest(library_path, filename, old_path=img.funscript_path)
    else:
        dest = os.path.splitext(img.file_path)[0] + ".funscript"

    replaced = os.path.exists(dest)
    try:
        with open(dest, "w", encoding="utf-8") as f:
            f.write(content)
    except OSError as e:
        raise HTTPException(500, f"Could not write funscript: {e}")

    img.funscript_path = dest

    # Tag as funscripted, same as the scanner does on detection.
    tag = db.query(Tag).filter(Tag.name == "funscripted").first()
    if not tag:
        tag = Tag(name="funscripted", category="type", source=TagSource.manual)
        db.add(tag)
        db.flush()
    if tag not in img.tags:
        img.tags.append(tag)
    db.commit()
    return {"funscript_path": dest, "replaced_existing": replaced,
            "actions": len(parsed["actions"])}


@router.delete("/{image_id}/funscript")
def unlink_funscript(image_id: int, delete_file: bool = False, db: Session = Depends(get_db)):
    """Unlink a funscript from a video; optionally delete the file from disk."""
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")
    if not img.funscript_path:
        raise HTTPException(404, "No funscript linked")
    if delete_file and os.path.exists(img.funscript_path):
        try:
            os.remove(img.funscript_path)
        except OSError:
            pass
    img.funscript_path = None
    db.commit()
    return {"ok": True}


@router.get("/{image_id}/file")
def serve_image_file(image_id: int, request: Request, db: Session = Depends(get_db)):
    # IMPORTANT: keep as sync def — FastAPI runs sync handlers in a thread pool,
    # so db.query() never blocks the event loop. Making this async def would run
    # the synchronous db.query() on the event loop and stall all other requests.
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")
    ext = os.path.splitext(img.file_path)[1].lower()
    if ext not in _SERVE_EXTS:
        raise HTTPException(404, "File is not a supported media type")
    if not os.path.exists(img.file_path):
        raise HTTPException(404, f"File not found on disk: {img.file_path}")
    if ext in _VIDEO_EXTS:
        return _video_response(img.file_path, request.headers.get("range"), request)
    return FileResponse(img.file_path)

_PREVIEW_WIDTHS = {720, 1080, 1440}   # allowed sizes so the cache can't be spammed

@router.get("/{image_id}/preview")
def serve_preview(image_id: int, w: int = 1080, db: Session = Depends(get_db)):
    """High-quality resized JPEG for feed/large views — generated once, cached on disk.
    Falls back to the original file if resizing fails, and to the thumb for videos."""
    from database import DATA_DIR
    from PIL import Image as PILImage, ImageOps

    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")
    if img.is_video:
        return serve_thumb(image_id, db)   # poster frame — videos stream via /file
    if not img.file_path or not os.path.exists(img.file_path):
        raise HTTPException(404, "File not found on disk")

    ext = os.path.splitext(img.file_path)[1].lower()
    if ext == ".gif":
        return FileResponse(img.file_path)  # keep animation intact

    if w not in _PREVIEW_WIDTHS:
        w = 1080
    thumbs_dir = os.path.join(DATA_DIR, "thumbs")
    cache = os.path.join(thumbs_dir, f"preview_{image_id}_{w}.jpg")
    if not os.path.exists(cache):
        try:
            os.makedirs(thumbs_dir, exist_ok=True)
            with PILImage.open(img.file_path) as im:
                im = ImageOps.exif_transpose(im)
                if im.mode not in ("RGB", "L"):
                    im = im.convert("RGB")
                if im.width > w:
                    im.thumbnail((w, w * 10), PILImage.LANCZOS)
                im.save(cache, "JPEG", quality=88)
        except Exception:
            return FileResponse(img.file_path)
    return FileResponse(cache, headers={"Cache-Control": "public, max-age=86400"})


@router.get("/{image_id}/thumb")
def serve_thumb(image_id: int, db: Session = Depends(get_db)):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")

    # For videos: ONLY serve the pre-generated thumbnail, never the raw video
    # file (browsers can't display a video as an <img> — it just errors).
    if img.is_video:
        thumb = img.thumb_path
        if thumb and os.path.exists(thumb):
            return FileResponse(thumb)
        # No thumbnail yet — try to generate it on-the-fly
        from services.scanner import make_thumb_path, generate_video_thumbnail
        new_thumb = make_thumb_path(img.file_path)
        if not os.path.exists(new_thumb) and os.path.exists(img.file_path):
            generate_video_thumbnail(img.file_path, new_thumb)
        if os.path.exists(new_thumb):
            img.thumb_path = new_thumb
            db.commit()
            return FileResponse(new_thumb)
        raise HTTPException(404, "Video thumbnail not available — run a library scan to generate it")

    # For images: try thumbnail first, fall back to original file
    path = img.thumb_path if img.thumb_path and os.path.exists(img.thumb_path) else img.file_path
    if not path or not os.path.exists(path):
        raise HTTPException(404, "No file found")
    return FileResponse(path)

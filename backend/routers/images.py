import os
import re
import mimetypes
import aiofiles
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Body, Request
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import func
from typing import Optional, List

from database import get_db
from models import Image, Gallery, Tag, image_tags, TagSource, gallery_creators, mix_images
from schemas import ImageOut, ImageUpdate, CumCountUpdate
import services.gamification as gami
from services import dedup as dedup_svc

router = APIRouter()


def _enrich_image(img: Image, db: Session) -> dict:
    from sqlalchemy import select
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
    creators = []
    if img.gallery:
        creators = [{"id": c.id, "name": c.name, "creator_type": c.creator_type} for c in img.gallery.creators]
    d["creators"] = creators
    d["gallery_name"] = img.gallery.name if img.gallery else None
    return d


def _natural_key(s: str):
    """Key for natural (human) sort: splits on numeric runs so F2 < F10."""
    return [int(c) if c.isdigit() else c.lower() for c in re.split(r'(\d+)', s or '')]


@router.get("/", response_model=List[ImageOut])
def list_images(
    db: Session = Depends(get_db),
    search: Optional[str] = None,
    tag: Optional[str] = None,
    creator_id: Optional[int] = None,
    gallery_id: Optional[int] = None,
    is_video: Optional[bool] = None,
    favorite: Optional[bool] = None,
    sort_by: Optional[str] = "date_added",  # date_added | filename | rating | cum_count | file_size | view_count | random
    tags: Optional[str] = None,  # comma-separated, AND logic
    skip: int = 0,
    limit: int = 200,
):
    q = db.query(Image).options(
        selectinload(Image.tags),
        selectinload(Image.gallery).selectinload(Gallery.creators),
    )
    if search:
        q = q.filter(Image.filename.ilike(f"%{search}%"))
    # Multi-tag: comma-separated, each tag must be present (AND)
    tag_list = [t.strip().lower() for t in (tags or tag or '').split(',') if t.strip()]
    for tag_name in tag_list:
        q = q.filter(Image.tags.any(Tag.name == tag_name))
    if creator_id:
        q = q.join(Gallery, Gallery.id == Image.gallery_id)\
             .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)\
             .filter(gallery_creators.c.creator_id == creator_id)
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
    if sort_by == "rating":
        q = q.order_by(Image.rating.desc())
    elif sort_by == "cum_count":
        q = q.order_by(Image.cum_count.desc())
    elif sort_by == "file_size":
        q = q.order_by(Image.file_size.desc())
    elif sort_by == "view_count":
        q = q.order_by(Image.view_count.desc())
    elif sort_by == "random":
        q = q.order_by(func.random())
    elif sort_by == "filename":
        images = q.offset(skip).limit(limit).all()
        images.sort(key=lambda img: _natural_key(img.filename))
        return [_enrich_image(img, db) for img in images]
    else:
        q = q.order_by(Image.created_at.desc())
    images = q.offset(skip).limit(limit).all()
    return [_enrich_image(img, db) for img in images]


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
        img.view_seconds = (img.view_seconds or 0) + min(secs, 3600)  # cap single session at 1h
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
    # Also bump gallery count
    if img.gallery_id:
        gallery = db.query(Gallery).filter(Gallery.id == img.gallery_id).first()
        if gallery:
            gallery.cum_count += 1
    db.commit()
    xp = gami.notify_action(db, "cum_logged")
    return {"cum_count": img.cum_count, "xp": xp}


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


@router.get("/{image_id}/funscript")
def get_funscript(image_id: int, db: Session = Depends(get_db)):
    """Return the raw funscript JSON for a video that has one."""
    import json
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")
    if not img.funscript_path:
        raise HTTPException(404, "No funscript associated with this image")
    if not os.path.exists(img.funscript_path):
        raise HTTPException(404, "Funscript file not found on disk")
    try:
        with open(img.funscript_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(500, f"Failed to read funscript: {e}")


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

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List
from datetime import datetime

from database import get_db
from models import Playlist, Image, Gallery, playlist_images, image_tags, gallery_creators
from schemas import PlaylistCreate, PlaylistOut

router = APIRouter()


@router.get("/", response_model=List[PlaylistOut])
def list_playlists(db: Session = Depends(get_db)):
    playlists = db.query(Playlist).order_by(Playlist.created_at.desc()).all()
    result = []
    for p in playlists:
        d = {c.name: getattr(p, c.name) for c in p.__table__.columns}
        d["image_count"] = len(p.images)
        result.append(d)
    return result


@router.post("/", response_model=PlaylistOut, status_code=201)
def create_playlist(data: PlaylistCreate, db: Session = Depends(get_db)):
    pl = Playlist(**data.model_dump())
    db.add(pl)
    db.commit()
    db.refresh(pl)
    d = {c.name: getattr(pl, c.name) for c in pl.__table__.columns}
    d["image_count"] = 0
    return d


# ── Static sub-routes MUST be registered before /{playlist_id} ───────────────

@router.post("/random-mix", status_code=201)
def create_random_mix(data: dict, db: Session = Depends(get_db)):
    """Generate a playlist from randomly selected images matching the given criteria."""
    count        = max(1, min(500, int(data.get("count", 50))))
    creator_ids  = [int(c) for c in (data.get("creator_ids") or []) if c]
    # legacy single-value fallback
    if not creator_ids and data.get("creator_id"):
        creator_ids = [int(data["creator_id"])]
    photos_only = bool(data.get("photos_only", False))
    videos_only = bool(data.get("videos_only", False))
    tag_ids     = [int(t) for t in (data.get("tag_ids") or []) if t]
    name        = (data.get("name") or "").strip() or f"Mix · {datetime.now().strftime('%b %d, %Y')}"

    query = db.query(Image).filter(Image.file_path.isnot(None))

    if creator_ids:
        # Filter via the M2M gallery_creators table (primary assignment source)
        query = (
            query
            .join(Gallery, Image.gallery_id == Gallery.id)
            .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
            .filter(gallery_creators.c.creator_id.in_(creator_ids))
        )
    if photos_only:
        query = query.filter(Image.is_video == False)
    elif videos_only:
        query = query.filter(Image.is_video == True)

    # Tag filter: images must have AT LEAST ONE of the selected tags (OR logic).
    # AND logic would be far too restrictive for multi-tag selections.
    if tag_ids:
        matching_ids = (
            db.query(image_tags.c.image_id)
            .filter(image_tags.c.tag_id.in_(tag_ids))
            .distinct()
            .subquery()
        )
        query = query.filter(Image.id.in_(matching_ids))

    images = query.order_by(func.random()).limit(count).all()
    if not images:
        raise HTTPException(400, "No matching images found — try adjusting the filters")

    pl = Playlist(
        name=name,
        description=f"Random mix · {len(images)} items · generated {datetime.now().strftime('%Y-%m-%d')}",
    )
    db.add(pl)
    db.flush()
    for img in images:
        pl.images.append(img)
    db.commit()
    db.refresh(pl)
    return {"id": pl.id, "name": pl.name, "image_count": len(pl.images)}


# ── Parameterised routes ──────────────────────────────────────────────────────

@router.get("/{playlist_id}")
def get_playlist(playlist_id: int, db: Session = Depends(get_db)):
    pl = db.query(Playlist).filter(Playlist.id == playlist_id).first()
    if not pl:
        raise HTTPException(404, "Playlist not found")
    return {"id": pl.id, "name": pl.name, "description": pl.description,
            "images": [i.id for i in pl.images], "image_count": len(pl.images)}


@router.get("/{playlist_id}/detail")
def get_playlist_detail(playlist_id: int, db: Session = Depends(get_db)):
    """Return full image data (not just IDs) for a playlist — used by PlaylistView."""
    pl = db.query(Playlist).filter(Playlist.id == playlist_id).first()
    if not pl:
        raise HTTPException(404, "Playlist not found")
    images = []
    for img in pl.images:
        images.append({
            "id": img.id,
            "file_path": img.file_path,
            "thumb_path": img.thumb_path,
            "filename": img.filename,
            "is_video": img.is_video,
            "gallery_id": img.gallery_id,
            "cum_count": img.cum_count,
            "rating": img.rating,
            "width": img.width,
            "height": img.height,
        })
    return {
        "id": pl.id,
        "name": pl.name,
        "description": pl.description,
        "image_count": len(pl.images),
        "images": images,
    }


@router.post("/{playlist_id}/images/{image_id}")
def add_image(playlist_id: int, image_id: int, db: Session = Depends(get_db)):
    pl = db.query(Playlist).filter(Playlist.id == playlist_id).first()
    if not pl:
        raise HTTPException(404, "Playlist not found")
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(404, "Image not found")
    if img not in pl.images:
        pl.images.append(img)
        db.commit()
    return {"playlist_id": playlist_id, "image_id": image_id, "count": len(pl.images)}


@router.delete("/{playlist_id}/images/{image_id}")
def remove_image(playlist_id: int, image_id: int, db: Session = Depends(get_db)):
    pl = db.query(Playlist).filter(Playlist.id == playlist_id).first()
    if not pl:
        raise HTTPException(404, "Playlist not found")
    img = db.query(Image).filter(Image.id == image_id).first()
    if img and img in pl.images:
        pl.images.remove(img)
        db.commit()
    return {"removed": image_id}


@router.delete("/{playlist_id}", status_code=204)
def delete_playlist(playlist_id: int, db: Session = Depends(get_db)):
    pl = db.query(Playlist).filter(Playlist.id == playlist_id).first()
    if not pl:
        raise HTTPException(404, "Playlist not found")
    db.delete(pl)
    db.commit()

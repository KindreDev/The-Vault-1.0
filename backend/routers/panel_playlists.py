"""Panel playlists — saved multi-panel viewer setups.

Separate from `routers/playlists.py`, which serves the mobile app: a panel
playlist is an ordered mix of whole galleries AND individual files, plus the
viewer setup (panel count + playback mode), so loading one restores the entire
session rather than just a pile of images.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel

from database import get_db
from models import PanelPlaylist, PanelPlaylistEntry, Image, Gallery

router = APIRouter()

AUTOSAVE_NAME = "Last session"


# ── Schemas ───────────────────────────────────────────────────────────────────
class EntryIn(BaseModel):
    entry_type: str   # 'gallery' | 'image'
    ref_id: int
    panel_idx: Optional[int] = None   # pinned panel in per-panel mode; None = unpinned


class PlaylistIn(BaseModel):
    name: str
    entries: List[EntryIn] = []
    layout_idx: int = 2
    gallery_mode: str = "grouped"
    is_autosave: bool = False


class RenameIn(BaseModel):
    name: str


def _summary(pl: PanelPlaylist, db: Session) -> dict:
    """List-view payload: counts plus a few covers for the card preview."""
    gallery_ids = [e.ref_id for e in pl.entries if e.entry_type == "gallery"]
    image_ids   = [e.ref_id for e in pl.entries if e.entry_type == "image"]

    covers: List[str] = []
    if gallery_ids:
        rows = db.query(Gallery.cover_thumb).filter(Gallery.id.in_(gallery_ids[:4])).all()
        covers += [r[0] for r in rows if r[0]]
    if len(covers) < 4 and image_ids:
        rows = db.query(Image.id).filter(Image.id.in_(image_ids[:4])).all()
        covers += [f"/api/images/{r[0]}/thumb" for r in rows]

    # How many distinct panels this playlist pins content to — lets the UI flag
    # a saved multi-panel arrangement versus a plain ordered list.
    panels_used = sorted({e.panel_idx for e in pl.entries if e.panel_idx is not None})

    return {
        "id": pl.id,
        "name": pl.name,
        "is_autosave": bool(pl.is_autosave),
        "layout_idx": pl.layout_idx,
        "gallery_mode": pl.gallery_mode,
        "panels_used": panels_used,
        "entry_count": len(pl.entries),
        "gallery_count": len(gallery_ids),
        "image_count": len(image_ids),
        "covers": covers[:4],
        "created_at": pl.created_at,
        "updated_at": pl.updated_at,
    }


def _replace_entries(pl: PanelPlaylist, entries: List[EntryIn], db: Session) -> None:
    """Swap a playlist's entries wholesale, preserving the given order.

    Entries pointing at galleries/images that no longer exist are dropped rather
    than saved, so a stale queue can't resurrect deleted content on load.
    """
    pl.entries.clear()
    db.flush()

    want_gal = {e.ref_id for e in entries if e.entry_type == "gallery"}
    want_img = {e.ref_id for e in entries if e.entry_type == "image"}
    live_gal = {r[0] for r in db.query(Gallery.id).filter(Gallery.id.in_(want_gal)).all()} if want_gal else set()
    live_img = {r[0] for r in db.query(Image.id).filter(Image.id.in_(want_img)).all()} if want_img else set()

    order = 0
    for e in entries:
        if e.entry_type == "gallery" and e.ref_id not in live_gal:
            continue
        if e.entry_type == "image" and e.ref_id not in live_img:
            continue
        if e.entry_type not in ("gallery", "image"):
            continue
        pl.entries.append(PanelPlaylistEntry(
            entry_type=e.entry_type,
            ref_id=e.ref_id,
            sort_order=order,
            panel_idx=e.panel_idx,
        ))
        order += 1


# ── Routes ────────────────────────────────────────────────────────────────────
@router.get("/")
def list_playlists(db: Session = Depends(get_db)):
    rows = db.query(PanelPlaylist).order_by(PanelPlaylist.updated_at.desc()).all()
    return [_summary(p, db) for p in rows]


@router.post("/", status_code=201)
def create_playlist(data: PlaylistIn, db: Session = Depends(get_db)):
    name = data.name.strip() or "Untitled playlist"
    pl = PanelPlaylist(
        name=name,
        is_autosave=data.is_autosave,
        layout_idx=data.layout_idx,
        gallery_mode=data.gallery_mode,
    )
    db.add(pl)
    db.flush()
    _replace_entries(pl, data.entries, db)
    db.commit()
    db.refresh(pl)
    return _summary(pl, db)


@router.put("/autosave")
def upsert_autosave(data: PlaylistIn, db: Session = Depends(get_db)):
    """Overwrite the single rolling autosave slot, creating it on first use.

    Keeps exactly one autosave row so a long session survives a reload without
    the playlist list filling up with snapshots.
    """
    pl = db.query(PanelPlaylist).filter(PanelPlaylist.is_autosave == True).first()  # noqa: E712
    if not pl:
        pl = PanelPlaylist(name=AUTOSAVE_NAME, is_autosave=True)
        db.add(pl)
        db.flush()
    pl.name = AUTOSAVE_NAME
    pl.layout_idx = data.layout_idx
    pl.gallery_mode = data.gallery_mode
    _replace_entries(pl, data.entries, db)
    db.commit()
    db.refresh(pl)
    return _summary(pl, db)


@router.get("/{playlist_id}")
def get_playlist(playlist_id: int, db: Session = Depends(get_db)):
    """Full payload for loading into the viewer — hydrated galleries and images.

    Entry order is authoritative and repeats are preserved, so the same file
    appearing under two galleries plays once per appearance.
    """
    pl = db.query(PanelPlaylist).filter(PanelPlaylist.id == playlist_id).first()
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")

    gallery_ids = [e.ref_id for e in pl.entries if e.entry_type == "gallery"]
    image_ids   = [e.ref_id for e in pl.entries if e.entry_type == "image"]

    galleries = {}
    if gallery_ids:
        for g in db.query(Gallery).filter(Gallery.id.in_(gallery_ids)).all():
            galleries[g.id] = {
                "id": g.id, "name": g.name, "cover_thumb": g.cover_thumb,
                "creator_id": g.creator_id, "image_count": g.image_count,
            }

    images = {}
    needed_img_ids = set(image_ids)
    # Galleries carry their own file list so the viewer can expand them into panels
    gallery_files = {}
    if gallery_ids:
        for img in db.query(Image).filter(Image.gallery_id.in_(gallery_ids)).order_by(Image.sort_order, Image.id).all():
            gallery_files.setdefault(img.gallery_id, []).append({
                "id": img.id, "gallery_id": img.gallery_id, "is_video": img.is_video,
                "file_path": img.file_path, "thumb_path": img.thumb_path,
                "funscript_path": img.funscript_path, "duration": img.duration,
                "width": img.width, "height": img.height,
            })
    if needed_img_ids:
        for img in db.query(Image).filter(Image.id.in_(needed_img_ids)).all():
            images[img.id] = {
                "id": img.id, "gallery_id": img.gallery_id, "is_video": img.is_video,
                "file_path": img.file_path, "thumb_path": img.thumb_path,
                "funscript_path": img.funscript_path, "duration": img.duration,
                "width": img.width, "height": img.height,
            }

    out_entries = []
    for e in pl.entries:
        if e.entry_type == "gallery":
            g = galleries.get(e.ref_id)
            if not g:
                continue
            out_entries.append({
                "entry_type": "gallery",
                "ref_id": e.ref_id,
                "panel_idx": e.panel_idx,
                "media": g,
                "images": gallery_files.get(e.ref_id, []),
            })
        else:
            im = images.get(e.ref_id)
            if not im:
                continue
            out_entries.append({
                "entry_type": "image", "ref_id": e.ref_id,
                "panel_idx": e.panel_idx, "media": im, "images": [],
            })

    return {
        "id": pl.id,
        "name": pl.name,
        "is_autosave": bool(pl.is_autosave),
        "layout_idx": pl.layout_idx,
        "gallery_mode": pl.gallery_mode,
        "entries": out_entries,
    }


@router.put("/{playlist_id}")
def update_playlist(playlist_id: int, data: PlaylistIn, db: Session = Depends(get_db)):
    """Overwrite an existing playlist with the current queue."""
    pl = db.query(PanelPlaylist).filter(PanelPlaylist.id == playlist_id).first()
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if data.name.strip():
        pl.name = data.name.strip()
    pl.layout_idx = data.layout_idx
    pl.gallery_mode = data.gallery_mode
    _replace_entries(pl, data.entries, db)
    db.commit()
    db.refresh(pl)
    return _summary(pl, db)


@router.patch("/{playlist_id}")
def rename_playlist(playlist_id: int, data: RenameIn, db: Session = Depends(get_db)):
    pl = db.query(PanelPlaylist).filter(PanelPlaylist.id == playlist_id).first()
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    pl.name = name
    # Renaming the autosave slot promotes it to a normal keepable playlist,
    # so the next autosave starts a fresh one instead of overwriting this.
    pl.is_autosave = False
    db.commit()
    db.refresh(pl)
    return _summary(pl, db)


@router.delete("/{playlist_id}", status_code=204)
def delete_playlist(playlist_id: int, db: Session = Depends(get_db)):
    pl = db.query(PanelPlaylist).filter(PanelPlaylist.id == playlist_id).first()
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    db.delete(pl)
    db.commit()
    return None

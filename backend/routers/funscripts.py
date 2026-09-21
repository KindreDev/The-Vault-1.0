"""First-class funscript collection and independent script playlists."""
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import asc, desc, func, nullslast, or_
from sqlalchemy.orm import Session, joinedload

from database import get_db
from models import Funscript, FunscriptPlaylist, FunscriptPlaylistEntry, Tag
from schemas import (
    FunscriptPlaylistAdd, FunscriptPlaylistCreate, FunscriptPlaylistOrder,
    FunscriptPlaylistRename, FunscriptTagIn, FunscriptUpdate,
)
from services import funscripts as service

router = APIRouter()


@router.get("")
@router.get("/")
def list_funscripts(
    search: Optional[str] = None,
    sort: str = Query("name"),
    direction: str = Query("asc"),
    favorite: Optional[bool] = None,
    tag: Optional[str] = None,
    compatibility: Optional[str] = None,
    health: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """Search/filter the independent script collection."""
    # Metric definitions are versioned so a safer speed calculation is applied
    # to existing indexes automatically on the next collection request.
    if db.query(Funscript.id).filter(or_(
        Funscript.analysis_version.is_(None),
        Funscript.analysis_version != service.ANALYSIS_VERSION,
    )).first():
        service.reindex(db)
    query = db.query(Funscript).options(joinedload(Funscript.source_image), joinedload(Funscript.tags))
    if search:
        needle = f"%{search.strip()}%"
        query = query.filter((Funscript.name.ilike(needle)) | (Funscript.title.ilike(needle)) | (Funscript.path.ilike(needle)))
    if favorite is not None:
        query = query.filter(Funscript.is_favorite == favorite)
    if health:
        query = query.filter(Funscript.health_status == health)
    if tag:
        query = query.filter(Funscript.tags.any(func.lower(Tag.name) == tag.strip().lower()))
    if compatibility:
        value = compatibility.strip().lower()
        if value == service.SYSTEM_VIBRATOR_TAG:
            query = query.filter(or_(
                Funscript.axes_json.contains('"VIB'),
                Funscript.axes_json.contains('"V0"'),
                Funscript.axes_json.contains('"V1"'),
                Funscript.axes_json.contains('"V2"'),
            ), Funscript.health_status == "healthy")
        elif value == service.SYSTEM_MULTI_AXIS_TAG:
            query = query.filter(Funscript.axis_count > 1, Funscript.health_status == "healthy")
    sort_map = {
        "name": Funscript.name, "title": Funscript.title, "duration": Funscript.duration,
        "actions": Funscript.action_count, "action_count": Funscript.action_count,
        "avg_speed": Funscript.avg_speed, "p95_speed": Funscript.p95_speed,
        "max_speed": Funscript.max_speed, "intensity": Funscript.intensity,
        "active_ratio": Funscript.active_ratio, "high_focus": Funscript.high_focus,
        "low_focus": Funscript.low_focus, "last_played": Funscript.last_played_at,
        "favorite": Funscript.is_favorite,
    }
    order_col = sort_map.get(sort, Funscript.name)
    query = query.order_by(nullslast(desc(order_col) if direction.lower() == "desc" else asc(order_col)), asc(Funscript.id))
    total = query.order_by(None).count()
    items = query.offset(skip).limit(limit).all()
    return {"items": [service.serialize(item) for item in items], "total": total,
            "skip": skip, "limit": limit, "sort": sort, "direction": direction}


@router.post("/analyze")
def analyze_funscripts(body: dict = Body(default={}), db: Session = Depends(get_db)):
    ids = body.get("ids") if isinstance(body, dict) else None
    paths = None
    if ids:
        rows = db.query(Funscript).filter(Funscript.id.in_([int(value) for value in ids])).all()
        paths = [row.path for row in rows]
    return service.reindex(db, paths)


@router.get("/playlists")
def list_script_playlists(db: Session = Depends(get_db)):
    playlists = db.query(FunscriptPlaylist).order_by(FunscriptPlaylist.updated_at.desc(), FunscriptPlaylist.id.desc()).all()
    return [{"id": item.id, "name": item.name, "description": item.description,
             "created_at": item.created_at, "updated_at": item.updated_at,
             "script_count": len(item.entries)} for item in playlists]


@router.post("/playlists", status_code=201)
def create_script_playlist(data: FunscriptPlaylistCreate, db: Session = Depends(get_db)):
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "Playlist name cannot be empty")
    playlist = FunscriptPlaylist(name=name, description=data.description or "")
    db.add(playlist)
    db.commit()
    db.refresh(playlist)
    return service.playlist_dict(playlist)


@router.get("/playlists/{playlist_id}")
def get_script_playlist(playlist_id: int, db: Session = Depends(get_db)):
    playlist = db.query(FunscriptPlaylist).filter(FunscriptPlaylist.id == playlist_id).first()
    if not playlist:
        raise HTTPException(404, "Funscript playlist not found")
    return service.playlist_dict(playlist)


@router.patch("/playlists/{playlist_id}")
def rename_script_playlist(playlist_id: int, data: FunscriptPlaylistRename, db: Session = Depends(get_db)):
    playlist = db.query(FunscriptPlaylist).filter(FunscriptPlaylist.id == playlist_id).first()
    if not playlist:
        raise HTTPException(404, "Funscript playlist not found")
    if not data.name.strip():
        raise HTTPException(400, "Playlist name cannot be empty")
    playlist.name = data.name.strip()
    db.commit()
    return service.playlist_dict(playlist)


@router.delete("/playlists/{playlist_id}", status_code=204)
def delete_script_playlist(playlist_id: int, db: Session = Depends(get_db)):
    playlist = db.query(FunscriptPlaylist).filter(FunscriptPlaylist.id == playlist_id).first()
    if not playlist:
        raise HTTPException(404, "Funscript playlist not found")
    db.delete(playlist)
    db.commit()


@router.post("/playlists/{playlist_id}/scripts")
def add_script_to_playlist(playlist_id: int, data: FunscriptPlaylistAdd, db: Session = Depends(get_db)):
    playlist = db.query(FunscriptPlaylist).filter(FunscriptPlaylist.id == playlist_id).first()
    script = db.query(Funscript).filter(Funscript.id == data.funscript_id).first()
    if not playlist:
        raise HTTPException(404, "Funscript playlist not found")
    if not script:
        raise HTTPException(404, "Funscript not found")
    if any(entry.funscript_id == script.id for entry in playlist.entries):
        return service.playlist_dict(playlist)
    order = max((entry.sort_order for entry in playlist.entries), default=-1) + 1
    playlist.entries.append(FunscriptPlaylistEntry(funscript_id=script.id, sort_order=order))
    playlist.updated_at = func.now()
    db.commit()
    return service.playlist_dict(playlist)


@router.delete("/playlists/{playlist_id}/scripts/{funscript_id}")
def remove_script_from_playlist(playlist_id: int, funscript_id: int, db: Session = Depends(get_db)):
    playlist = db.query(FunscriptPlaylist).filter(FunscriptPlaylist.id == playlist_id).first()
    if not playlist:
        raise HTTPException(404, "Funscript playlist not found")
    playlist.entries[:] = [entry for entry in playlist.entries if entry.funscript_id != funscript_id]
    for index, entry in enumerate(playlist.entries):
        entry.sort_order = index
    playlist.updated_at = func.now()
    db.commit()
    return service.playlist_dict(playlist)


@router.put("/playlists/{playlist_id}/scripts/order")
def reorder_script_playlist(playlist_id: int, data: FunscriptPlaylistOrder, db: Session = Depends(get_db)):
    playlist = db.query(FunscriptPlaylist).filter(FunscriptPlaylist.id == playlist_id).first()
    if not playlist:
        raise HTTPException(404, "Funscript playlist not found")
    entries = {entry.funscript_id: entry for entry in playlist.entries}
    if set(data.funscript_ids) != set(entries) or len(data.funscript_ids) != len(entries):
        raise HTTPException(400, "Order must contain each playlist script exactly once")
    for index, script_id in enumerate(data.funscript_ids):
        entries[script_id].sort_order = index
    playlist.updated_at = func.now()
    db.commit()
    return service.playlist_dict(playlist)


@router.get("/{funscript_id}")
def get_funscript(funscript_id: int, db: Session = Depends(get_db)):
    script = db.query(Funscript).filter(Funscript.id == funscript_id).first()
    if not script:
        raise HTTPException(404, "Funscript not found")
    return service.serialize(script)


@router.get("/{funscript_id}/payload")
def get_funscript_payload(funscript_id: int, db: Session = Depends(get_db)):
    script = db.query(Funscript).filter(Funscript.id == funscript_id).first()
    if not script:
        raise HTTPException(404, "Funscript not found")
    try:
        return service.payload(script)
    except FileNotFoundError:
        raise HTTPException(404, "Funscript file not found on disk")
    except ValueError as error:
        raise HTTPException(422, str(error))


@router.post("/{funscript_id}/played")
def mark_funscript_played(funscript_id: int, db: Session = Depends(get_db)):
    script = db.query(Funscript).filter(Funscript.id == funscript_id).first()
    if not script:
        raise HTTPException(404, "Funscript not found")
    script.last_played_at = func.now()
    db.commit()
    return {"id": script.id, "last_played_at": script.last_played_at}


@router.patch("/{funscript_id}")
def update_funscript(funscript_id: int, data: FunscriptUpdate, db: Session = Depends(get_db)):
    script = db.query(Funscript).filter(Funscript.id == funscript_id).first()
    if not script:
        raise HTTPException(404, "Funscript not found")
    values = data.model_dump(exclude_unset=True)
    if "rating" in values and values["rating"] is not None:
        values["rating"] = max(0.0, min(10.0, float(values["rating"])))
    for key, value in values.items():
        setattr(script, key, value)
    db.commit()
    db.refresh(script)
    return service.serialize(script)


@router.post("/{funscript_id}/tags")
def add_funscript_tag(funscript_id: int, data: FunscriptTagIn, db: Session = Depends(get_db)):
    script = db.query(Funscript).filter(Funscript.id == funscript_id).first()
    if not script:
        raise HTTPException(404, "Funscript not found")
    try:
        service.ensure_tag(db, script, data.name)
    except ValueError as error:
        raise HTTPException(400, str(error))
    db.commit()
    return service.serialize(script)


@router.delete("/{funscript_id}/tags/{tag_id}")
def remove_funscript_tag(funscript_id: int, tag_id: int, db: Session = Depends(get_db)):
    script = db.query(Funscript).filter(Funscript.id == funscript_id).first()
    if not script:
        raise HTTPException(404, "Funscript not found")
    service.remove_tag(db, script, tag_id)
    db.commit()
    return service.serialize(script)


@router.get("/{funscript_id}/source-video")
def get_funscript_source_video(funscript_id: int, db: Session = Depends(get_db)):
    script = db.query(Funscript).filter(Funscript.id == funscript_id).first()
    if not script:
        raise HTTPException(404, "Funscript not found")
    return {"source_image_id": script.source_image_id, "source_image": service._source_data(script)}

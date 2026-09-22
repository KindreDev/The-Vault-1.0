from fastapi import APIRouter, Depends, HTTPException, Body, Query
from sqlalchemy.orm import Session
from typing import List

from database import get_db
from models import SessionLog, Image, Gallery, Creator
from schemas import SessionCreate, SessionUpdate, SessionGroupUpdate, SessionOut
import services.gamification as gami

router = APIRouter()


@router.post("/", status_code=201)
def log_session(data: SessionCreate, db: Session = Depends(get_db)):
    # Auto-fill creator_id from gallery if not explicitly provided
    if data.creator_ids is None and not data.creator_id and data.gallery_id:
        g = db.query(Gallery).filter(Gallery.id == data.gallery_id).first()
        if g:
            if g.creator_id:
                data = data.model_copy(update={"creator_id": g.creator_id})
            elif g.creators:
                data = data.model_copy(update={"creator_id": g.creators[0].id})

    # Transport-only flags — strip before writing to the DB.
    # logged_at is dropped when absent so the column default (now) still applies;
    # a manual add or a recovered session sends the real timestamp instead.
    fields = data.model_dump(exclude={'skip_xp', 'image_ids', 'count_orgasm', 'creator_ids', 'creator_id'})
    if fields.get("logged_at") is None:
        fields.pop("logged_at", None)
    # Keep one row per credited creator for compatibility with the existing
    # multi-panel session model. The first row carries XP/orgasm credit; the
    # sibling rows are silent attribution rows.
    creator_ids = data.creator_ids if data.creator_ids is not None else (
        [data.creator_id] if data.creator_id else [None]
    )
    creator_ids = list(dict.fromkeys(creator_ids)) or [None]
    known_ids = {row[0] for row in db.query(Creator.id).filter(Creator.id.in_([i for i in creator_ids if i is not None])).all()}
    creator_ids = [i if i is None or i in known_ids else None for i in creator_ids]
    creator_ids = list(dict.fromkeys(creator_ids)) or [None]

    sessions = []
    for index, creator_id in enumerate(creator_ids):
        session = SessionLog(**fields, creator_id=creator_id)
        db.add(session)
        db.flush()
        if not data.skip_xp and index == 0:
            xp = gami.notify_action(db, "session_logged", extra={"duration_sec": data.duration_sec or 0})
            session.xp_earned = xp.amount
        else:
            session.xp_earned = 0
        sessions.append(session)

    session = sessions[0]
    db.commit()
    for row in sessions:
        db.refresh(row)

    # Finishing a session counts an orgasm against whatever was on screen.
    # Falls back to the single image the caller named when the on-screen list
    # is empty, so this works from any surface.
    orgasm = None
    if data.count_orgasm and not data.skip_xp:
        targets = list(data.image_ids or [])
        if not targets and data.image_id:
            targets = [data.image_id]
        orgasm = gami.credit_orgasm(db, targets)

    # Spending "quality time" with one creator can make a bonded girl jealous.
    if creator_ids[0]:
        try:
            from services.simulation import on_user_engagement
            for creator_id in creator_ids:
                if creator_id:
                    on_user_engagement(db, creator_id, "goon")
        except Exception:
            pass

    # Achievements are idempotent — safe to call for every session row
    gami.unlock_achievement(db, "first_session")
    # Night owl check — uses the server's local time so "after midnight" means
    # actual midnight for the (single) user, not UTC.
    from datetime import datetime
    local_hour = datetime.now().hour
    if 0 <= local_hour < 5:
        gami.unlock_achievement(db, "night_owl")

    out = SessionOut.model_validate(session, from_attributes=True).model_dump()
    out["orgasm"] = orgasm
    out["creator_ids"] = [row.creator_id for row in sessions if row.creator_id is not None]
    return out


@router.get("/")
def list_sessions(db: Session = Depends(get_db), skip: int = 0, limit: int = 50):
    sessions = db.query(SessionLog).order_by(SessionLog.logged_at.desc()).offset(skip).limit(limit).all()
    result = []
    for s in sessions:
        creator = db.query(Creator).filter(Creator.id == s.creator_id).first() if s.creator_id else None
        gallery = db.query(Gallery).filter(Gallery.id == s.gallery_id).first() if s.gallery_id else None
        result.append({
            "id": s.id,
            "logged_at": s.logged_at,
            "duration_sec": s.duration_sec,
            "image_id": s.image_id,
            "gallery_id": s.gallery_id,
            "creator_id": s.creator_id,
            "xp_earned": s.xp_earned,
            "creator_name": creator.name if creator else None,
            "gallery_name": gallery.name if gallery else None,
        })
    return result


@router.patch("/group")
def update_session_group(data: SessionGroupUpdate, db: Session = Depends(get_db)):
    """Replace the creator attribution for one logical session group.

    Multi-panel sessions are persisted as sibling rows with the same timestamp.
    Reusing those rows keeps the existing history model and lets the editor add
    or remove creators without introducing a second source of truth.
    """
    ids = list(dict.fromkeys(int(i) for i in data.session_ids if i))
    if not ids:
        raise HTTPException(422, "At least one session row is required")
    rows = db.query(SessionLog).filter(SessionLog.id.in_(ids)).order_by(SessionLog.id.asc()).all()
    if not rows:
        raise HTTPException(404, "Session not found")

    requested = list(dict.fromkeys(int(i) for i in data.creator_ids if i))
    known = {row[0] for row in db.query(Creator.id).filter(Creator.id.in_(requested)).all()}
    requested = [creator_id for creator_id in requested if creator_id in known]

    # Keep the duration-bearing row first so the history editor can continue to
    # patch the same row after the creator list changes.
    rows.sort(key=lambda row: (0 if row.duration_sec else 1, row.id))
    template = rows[0]
    keep = []
    for index, creator_id in enumerate(requested):
        if index < len(rows):
            row = rows[index]
            row.creator_id = creator_id
            keep.append(row)
        else:
            clone = SessionLog(
                logged_at=template.logged_at,
                duration_sec=template.duration_sec,
                image_id=template.image_id,
                gallery_id=template.gallery_id,
                creator_id=creator_id,
                notes=template.notes,
                xp_earned=0,
            )
            db.add(clone)
            keep.append(clone)

    if not requested:
        # Removing every creator leaves an honest, still-editable unknown
        # session rather than deleting the user's time record.
        template.creator_id = None
        keep = [template]

    kept_ids = {row.id for row in keep if row.id is not None}
    for row in rows:
        if row.id not in kept_ids and row not in keep:
            db.delete(row)

    db.commit()
    return {
        "session_ids": [row.id for row in keep],
        "creator_ids": [row.creator_id for row in keep if row.creator_id is not None],
    }


def _logical_session_groups(rows):
    """Collapse one multi-creator session's sibling rows into one session.

    The original schema predates a group key and stores multi-panel attribution
    as rows sharing a timestamp.  Keep that compatibility rule in one place so
    overall session time/counts do not multiply when several creators receive
    credit for the same elapsed session.
    """
    groups = []
    current = None
    for row in rows:
        if current is None or abs((current[0].logged_at - row.logged_at).total_seconds()) > 5:
            current = [row]
            groups.append(current)
        else:
            current.append(row)
    return groups


@router.patch("/{session_id}")
def update_session(session_id: int, data: SessionUpdate, db: Session = Depends(get_db)):
    """Correct a logged session by hand.

    Sessions are recorded automatically, so a crash, a forgotten stop, or a
    mis-attributed creator leaves a row that is simply wrong. Only the fields
    actually sent are written — the UI patches one number at a time.

    XP is deliberately left alone: the XP already earned is not re-scored when a
    duration is corrected, because the system rewards and never punishes.
    """
    session = db.query(SessionLog).filter(SessionLog.id == session_id).first()
    if not session:
        raise HTTPException(404, "Session not found")

    changes = data.model_dump(exclude_unset=True)
    if "duration_sec" in changes and changes["duration_sec"] is not None:
        # A negative duration would poison every average on the stats page.
        changes["duration_sec"] = max(0, int(changes["duration_sec"]))

    # Re-derive the creator when the gallery moves and no creator was named,
    # matching what log_session does on the way in.
    if changes.get("gallery_id") and "creator_id" not in changes:
        g = db.query(Gallery).filter(Gallery.id == changes["gallery_id"]).first()
        if g:
            if g.creator_id:
                changes["creator_id"] = g.creator_id
            elif g.creators:
                changes["creator_id"] = g.creators[0].id

    for field, value in changes.items():
        setattr(session, field, value)

    db.commit()
    db.refresh(session)
    return SessionOut.model_validate(session, from_attributes=True).model_dump()


@router.delete("/{session_id}")
def delete_session(session_id: int, db: Session = Depends(get_db)):
    """Remove one logged session.

    The XP it earned stays banked and lifetime cum/edge counts are untouched —
    those are lifetime totals by design, and clawing XP back would be a penalty.
    This deletes the record of the session, not its consequences.
    """
    session = db.query(SessionLog).filter(SessionLog.id == session_id).first()
    if not session:
        raise HTTPException(404, "Session not found")
    db.delete(session)
    db.commit()
    return {"deleted": session_id}


@router.post("/bulk-delete")
def bulk_delete_sessions(data: dict = Body(default={}), db: Session = Depends(get_db)):
    """Delete several session rows at once.

    A multi-panel session writes one row per creator, so what the user sees as a
    single entry in Session History is often several rows. Deleting it has to
    take the whole group or the entry comes back half-alive.
    """
    ids = [int(i) for i in (data.get("ids") or []) if i]
    if not ids:
        return {"deleted": 0}
    deleted = db.query(SessionLog).filter(SessionLog.id.in_(ids)).delete(synchronize_session=False)
    db.commit()
    return {"deleted": deleted or 0}


@router.get("/almanac")
def almanac(db: Session = Depends(get_db)):
    """Long-range analysis — the six-year collecting story plus the habits read.

    Deliberately separate from /stats, which answers "what is happening now".
    """
    from services import almanac as alm
    return alm.the_read(db)


@router.get("/analytics")
def analytics_dashboard(
    range: str = Query("30d"),
    aggregation: str = Query("daily"),
    metric: str = Query("sessions"),
    creator_ids: str | None = Query(None),
    tag_ids: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Longitudinal analytics data, derived without changing telemetry."""
    from services import analytics
    try:
        return analytics.dashboard(
            db,
            range_name=range,
            aggregation=aggregation,
            metric=metric,
            creator_ids_raw=creator_ids,
            tag_ids_raw=tag_ids,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/analytics/compare")
def analytics_compare(
    session_ids: str = Query(...),
    db: Session = Depends(get_db),
):
    """Compare persisted fields for selected logical sessions."""
    from services import analytics
    try:
        return analytics.compare_sessions(db, session_ids)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/analytics/wrapped")
def analytics_wrapped(
    year: int | None = Query(None),
    db: Session = Depends(get_db),
):
    """Annual Vault Wrapped recap from persisted history."""
    from services import analytics
    try:
        from datetime import datetime
        return analytics.annual_wrapped(db, year or datetime.now().year)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/stats")
def session_stats(
    timezone_offset: int = Query(0, description="Browser getTimezoneOffset() in minutes"),
    db: Session = Depends(get_db),
):
    from sqlalchemy import func, extract
    from datetime import datetime, timedelta, date
    now = datetime.utcnow()
    # Session timestamps are stored as naive UTC so every client can read the
    # same database.  Stats buckets are displayed to this single local user,
    # so shift grouping expressions back into the browser's local wall clock.
    try:
        timezone_offset = max(-840, min(840, int(timezone_offset)))
    except (TypeError, ValueError):
        timezone_offset = 0
    local_now = now - timedelta(minutes=timezone_offset)
    local_modifier = f"{(-timezone_offset):+d} minutes"
    week_ago = now - timedelta(days=7)
    session_rows = db.query(SessionLog).order_by(SessionLog.logged_at.desc(), SessionLog.id.desc()).all()
    logical_groups = _logical_session_groups(session_rows)

    # Sessions by day for the last 7 days
    days_data = {}
    for i in range(6, -1, -1):
        d = (local_now - timedelta(days=i)).date()
        days_data[d.isoformat()] = 0
    for group in logical_groups:
        if group[0].logged_at < week_ago:
            continue
        key = (group[0].logged_at - timedelta(minutes=timezone_offset)).date().isoformat()
        if key in days_data:
            days_data[key] += 1

    # Top creator
    top_row = (
        db.query(SessionLog.creator_id, func.sum(SessionLog.duration_sec).label("total_sec"))
          .filter(SessionLog.creator_id != None)
          .group_by(SessionLog.creator_id)
          .order_by(func.sum(SessionLog.duration_sec).desc())
          .first()
    )
    top_creator_name = None
    if top_row:
        # REMOVED: from models import Creator <--- This was causing the bug!
        c = db.query(Creator).filter(Creator.id == top_row.creator_id).first()
        top_creator_name = c.name if c else None
    # Peak hour (0–23)
    hour_counts = {}
    for group in logical_groups:
        hour = (group[0].logged_at - timedelta(minutes=timezone_offset)).hour
        hour_counts[hour] = hour_counts.get(hour, 0) + 1
    peak_hour = max(hour_counts, key=hour_counts.get) if hour_counts else None

    # 91-day heatmap
    heatmap_start = now - timedelta(days=91)
    heatmap_data = {}
    for i in range(91, -1, -1):
        d = (local_now - timedelta(days=i)).date()
        heatmap_data[d.isoformat()] = 0
    for group in logical_groups:
        if group[0].logged_at < heatmap_start:
            continue
        key = (group[0].logged_at - timedelta(minutes=timezone_offset)).date().isoformat()
        if key in heatmap_data:
            heatmap_data[key] += 1

    # Sessions by hour (0-23)
    hour_data = {str(h).zfill(2): 0 for h in range(24)}
    for hour, count in hour_counts.items():
        key = str(hour).zfill(2)
        if key in hour_data:
            hour_data[key] = count

    # Duration stats
    total_dur = sum(next((row.duration_sec for row in group if row.duration_sec), 0) for group in logical_groups)
    total_count = len(logical_groups)
    avg_dur = (total_dur // total_count) if total_count > 0 else 0

    # Cum + edge counts from profile
    from models import UserProfile, XPEvent
    profile = db.query(UserProfile).first()
    total_cum  = profile.total_cum_count if profile else 0
    total_edge = (profile.total_edge_count or 0) if profile else 0

    # XP by day (last 7 days)
    xp_by_day_data = {}
    for i in range(6, -1, -1):
        d = (local_now - timedelta(days=i)).date()
        xp_by_day_data[d.isoformat()] = 0
    xp_rows = (
        db.query(
            func.date(func.datetime(XPEvent.earned_at, local_modifier)).label("day"),
            func.sum(XPEvent.amount).label("total"),
        )
        .filter(XPEvent.earned_at >= week_ago)
        .group_by(func.date(func.datetime(XPEvent.earned_at, local_modifier)))
        .all()
    )
    for row in xp_rows:
        key = str(row.day)
        if key in xp_by_day_data:
            xp_by_day_data[key] = int(row.total or 0)

    # Top creators by session count (for bar chart)
    top_creator_rows = (
        db.query(SessionLog.creator_id, func.count(SessionLog.id).label("cnt"))
          .filter(SessionLog.creator_id.isnot(None))
          .group_by(SessionLog.creator_id)
          .order_by(func.count(SessionLog.id).desc())
          .limit(6)
          .all()
    )
    top_creators_chart = []
    for row in top_creator_rows:
        # This will now perfectly use the global 'Creator' model import!
        c = db.query(Creator).filter(Creator.id == row.creator_id).first()
        if c:
            top_creators_chart.append({ "name": c.name, "count": row.cnt })

    # Top creators by total view time (view_seconds on images)
    from models import gallery_creators
    view_time_rows = (
        db.query(gallery_creators.c.creator_id, func.sum(Image.view_seconds).label("total_secs"))
          .join(Image, Image.gallery_id == gallery_creators.c.gallery_id)
          .group_by(gallery_creators.c.creator_id)
          .order_by(func.sum(Image.view_seconds).desc())
          .limit(6)
          .all()
    )
    top_creators_by_time = []
    for row in view_time_rows:
        # This will also use the global import perfectly!
        c = db.query(Creator).filter(Creator.id == row.creator_id).first()
        if c and (row.total_secs or 0) > 0:
            top_creators_by_time.append({"name": c.name, "seconds": int(row.total_secs or 0)})

    total_view_seconds = int(db.query(func.sum(Image.view_seconds)).scalar() or 0)

    # Creators you edge to most — Edge Mode credits the images on screen, so
    # this rolls those per-image counts up through the gallery→creator join.
    edge_creator_rows = (
        db.query(gallery_creators.c.creator_id, func.sum(Image.edge_count).label("edges"))
          .join(Image, Image.gallery_id == gallery_creators.c.gallery_id)
          .group_by(gallery_creators.c.creator_id)
          .order_by(func.sum(Image.edge_count).desc())
          .limit(6)
          .all()
    )
    top_creators_by_edges = []
    for row in edge_creator_rows:
        if not (row.edges or 0) > 0:
            continue
        c = db.query(Creator).filter(Creator.id == row.creator_id).first()
        if c:
            top_creators_by_edges.append({"name": c.name, "edges": int(row.edges)})

    # Edges per O — how many times you pulled back for each finish.
    edges_per_cum = round(total_edge / total_cum, 1) if total_cum else 0.0

    return {
        "total": total_count,
        "this_week": sum(1 for group in logical_groups if group[0].logged_at >= week_ago),
        "top_creator_id": top_row.creator_id if top_row else None,
        "top_creator_name": top_creator_name,
        "peak_hour": peak_hour,
        "sessions_by_day": [
            {"date": k, "count": v} for k, v in days_data.items()
        ],
        "sessions_by_date": [
            {"date": k, "count": v} for k, v in heatmap_data.items()
        ],
        "sessions_by_hour": [
            {"hour": int(k), "count": v} for k, v in sorted(hour_data.items())
        ],
        "total_duration_sec": total_dur,
        "avg_duration_sec": avg_dur,
        "total_cum_count": total_cum,
        "total_edge_count": total_edge,
        "edges_per_cum": edges_per_cum,
        "xp_by_day": [{"date": k, "xp": v} for k, v in xp_by_day_data.items()],
        "top_creators_chart": top_creators_chart,
        "top_creators_by_time": top_creators_by_time,
        "top_creators_by_edges": top_creators_by_edges,
        "total_view_seconds": total_view_seconds,
    }

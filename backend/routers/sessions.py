from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from database import get_db
from models import SessionLog, Image, Gallery, Creator
from schemas import SessionCreate, SessionOut
import services.gamification as gami

router = APIRouter()


@router.post("/", status_code=201)
def log_session(data: SessionCreate, db: Session = Depends(get_db)):
    # Auto-fill creator_id from gallery if not explicitly provided
    if not data.creator_id and data.gallery_id:
        g = db.query(Gallery).filter(Gallery.id == data.gallery_id).first()
        if g:
            if g.creator_id:
                data = data.model_copy(update={"creator_id": g.creator_id})
            elif g.creators:
                data = data.model_copy(update={"creator_id": g.creators[0].id})

    # Transport-only flags — strip before writing to the DB
    session = SessionLog(**data.model_dump(exclude={'skip_xp', 'image_ids', 'count_orgasm'}))
    db.add(session)
    db.flush()

    if not data.skip_xp:
        xp = gami.notify_action(db, "session_logged", extra={"duration_sec": data.duration_sec or 0})
        session.xp_earned = xp.amount
    else:
        session.xp_earned = 0

    # Award CXP to cards related to this session's creator or gallery.
    # Always fires — every creator in a multi-panel session deserves card XP.
    # Amount scales with session duration — longer sessions = more CXP, capped at 200.
    from models import Card, CardInventory
    duration = data.duration_sec or 0
    session_cxp = max(10, min(200, 10 + (duration // 60) * 7))

    cxp_candidates = []
    if data.creator_id:
        cxp_candidates += (
            db.query(CardInventory).join(Card)
            .filter(Card.source_creator_id == data.creator_id)
            .all()
        )
    if data.gallery_id:
        cxp_candidates += (
            db.query(CardInventory).join(Card)
            .filter(Card.source_gallery_id == data.gallery_id)
            .all()
        )
    seen = set()
    for inv in cxp_candidates:
        if inv.id not in seen:
            seen.add(inv.id)
            inv.card.cxp = (inv.card.cxp or 0) + session_cxp

    db.commit()
    db.refresh(session)

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
    if data.creator_id:
        try:
            from services.simulation import on_user_engagement
            on_user_engagement(db, data.creator_id, "goon")
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


@router.get("/stats")
def session_stats(db: Session = Depends(get_db)):
    from sqlalchemy import func, extract
    from datetime import datetime, timedelta, date
    now = datetime.utcnow()
    week_ago = now - timedelta(days=7)

    # Sessions by day for the last 7 days
    days_data = {}
    for i in range(6, -1, -1):
        d = (now - timedelta(days=i)).date()
        days_data[d.isoformat()] = 0
    rows = (
        db.query(
            func.date(SessionLog.logged_at).label("day"),
            func.count(SessionLog.id).label("cnt"),
        )
        .filter(SessionLog.logged_at >= week_ago)
        .group_by(func.date(SessionLog.logged_at))
        .all()
    )
    for row in rows:
        key = str(row.day)
        if key in days_data:
            days_data[key] = row.cnt

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
    peak_row = (
        db.query(
            func.strftime('%H', SessionLog.logged_at).label("hr"),
            func.count(SessionLog.id).label("cnt"),
        )
        .group_by(func.strftime('%H', SessionLog.logged_at))
        .order_by(func.count(SessionLog.id).desc())
        .first()
    )
    peak_hour = int(peak_row.hr) if peak_row else None

    # 91-day heatmap
    heatmap_start = now - timedelta(days=91)
    heatmap_data = {}
    for i in range(91, -1, -1):
        d = (now - timedelta(days=i)).date()
        heatmap_data[d.isoformat()] = 0
    heatmap_rows = (
        db.query(
            func.date(SessionLog.logged_at).label("day"),
            func.count(SessionLog.id).label("cnt"),
        )
        .filter(SessionLog.logged_at >= heatmap_start)
        .group_by(func.date(SessionLog.logged_at))
        .all()
    )
    for row in heatmap_rows:
        key = str(row.day)
        if key in heatmap_data:
            heatmap_data[key] = row.cnt

    # Sessions by hour (0-23)
    hour_data = {str(h).zfill(2): 0 for h in range(24)}
    hour_rows = (
        db.query(
            func.strftime('%H', SessionLog.logged_at).label("hr"),
            func.count(SessionLog.id).label("cnt"),
        )
        .group_by(func.strftime('%H', SessionLog.logged_at))
        .all()
    )
    for row in hour_rows:
        if row.hr in hour_data:
            hour_data[row.hr] = row.cnt

    # Duration stats
    total_dur = db.query(func.sum(SessionLog.duration_sec)).scalar() or 0
    total_count = db.query(SessionLog).count()
    avg_dur = (total_dur // total_count) if total_count > 0 else 0

    # Cum + edge counts from profile
    from models import UserProfile, XPEvent
    profile = db.query(UserProfile).first()
    total_cum  = profile.total_cum_count if profile else 0
    total_edge = (profile.total_edge_count or 0) if profile else 0

    # XP by day (last 7 days)
    xp_by_day_data = {}
    for i in range(6, -1, -1):
        d = (now - timedelta(days=i)).date()
        xp_by_day_data[d.isoformat()] = 0
    xp_rows = (
        db.query(
            func.date(XPEvent.earned_at).label("day"),
            func.sum(XPEvent.amount).label("total"),
        )
        .filter(XPEvent.earned_at >= week_ago)
        .group_by(func.date(XPEvent.earned_at))
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
        "this_week": db.query(SessionLog).filter(SessionLog.logged_at >= week_ago).count(),
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

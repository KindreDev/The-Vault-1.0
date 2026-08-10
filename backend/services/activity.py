"""Engagement event logging — the time dimension the lifetime counters lack.

Every place that increments Image/Gallery view_count, cum_count, edge_count or
view_seconds also calls record() here. The counters stay authoritative for
all-time ranking (fast, and they carry years of history that predates this
table); these rows are what make Daily / Weekly / Monthly answerable.

Recording is best-effort on purpose: an engagement action must never fail
because its bookkeeping did. A dropped event costs one row in a leaderboard, a
raised exception costs the user their cum tap.
"""
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from models import ActivityEvent

# Image-level kinds carry image_id; gallery-level kinds carry gallery_id. They
# are separate because the scoring weights differ per entity.
IMAGE_KINDS   = ("view", "seconds", "cum", "edge")
GALLERY_KINDS = ("gallery_view", "gallery_cum", "gallery_edge")

PERIODS = ("day", "week", "month", "all")


def record(db: Session, kind: str, *, image_id=None, gallery_id=None, amount: int = 1,
           commit: bool = False):
    """Log one engagement event. Never raises."""
    try:
        if amount <= 0:
            return
        db.add(ActivityEvent(kind=kind, image_id=image_id, gallery_id=gallery_id,
                             amount=int(amount)))
        if commit:
            db.commit()
    except Exception:
        db.rollback()


def record_many(db: Session, kind: str, *, image_ids=None, gallery_ids=None,
                amount: int = 1, commit: bool = False):
    """Log the same event against several entities — a multi-panel wall credits
    every file on screen, so this mirrors how the counters are bumped."""
    try:
        for iid in (image_ids or []):
            db.add(ActivityEvent(kind=kind, image_id=int(iid), amount=int(amount)))
        for gid in (gallery_ids or []):
            db.add(ActivityEvent(kind=kind, gallery_id=int(gid), amount=int(amount)))
        if commit:
            db.commit()
    except Exception:
        db.rollback()


def period_start(period: str) -> datetime | None:
    """Local-calendar start of a period, or None for all-time.

    Calendar boundaries rather than rolling windows: "today" resets at midnight
    and starts empty, which is what makes a daily leaderboard feel like a fresh
    race each day instead of a slowly-shifting 24h average.
    """
    if period in (None, "", "all"):
        return None

    now = datetime.now()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    if period == "day":
        return today
    if period == "week":
        return today - timedelta(days=today.weekday())   # Monday
    if period == "month":
        return today.replace(day=1)
    return None


def tracking_since(db: Session) -> datetime | None:
    """Timestamp of the earliest recorded event, so the UI can be honest about
    a window that started before logging did."""
    row = db.query(ActivityEvent.logged_at).order_by(ActivityEvent.logged_at.asc()).first()
    return row[0] if row else None

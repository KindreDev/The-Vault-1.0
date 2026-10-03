"""Engagement event logging — the time dimension the lifetime counters lack.

Every place that increments Image/Gallery view_count, cum_count, edge_count or
view_seconds also calls record() here. The counters stay authoritative for
all-time ranking (fast, and they carry years of history that predates this
table); these rows are what make Daily / Weekly / Monthly answerable.

Recording is best-effort on purpose: an engagement action must never fail
because its bookkeeping did. A dropped event costs one row in a leaderboard, a
raised exception costs the user their cum tap.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from models import ActivityEvent

# Image-level kinds carry image_id; gallery-level kinds carry gallery_id. They
# are separate because the scoring weights differ per entity.
IMAGE_KINDS   = ("view", "seconds", "cum", "edge")
GALLERY_KINDS = ("gallery_view", "gallery_cum", "gallery_edge")

PERIODS = ("day", "week", "month", "all")


def local_to_utc_naive(value: datetime) -> datetime:
    """Convert a local wall-clock datetime to the naive UTC used by the DB."""
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def utc_naive_to_local(value: datetime) -> datetime:
    """Convert a naive UTC DB timestamp to a local wall-clock datetime."""
    return value.replace(tzinfo=timezone.utc).astimezone().replace(tzinfo=None)


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
    """Naive UTC DB timestamp for a local-calendar start, or None for all-time.

    Calendar boundaries rather than rolling windows: "today" resets at midnight
    and starts empty, which is what makes a daily leaderboard feel like a fresh
    race each day instead of a slowly-shifting 24h average.
    """
    if period in (None, "", "all"):
        return None

    now = datetime.now()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    if period == "day":
        local_start = today
    elif period == "week":
        local_start = today - timedelta(days=today.weekday())   # Monday
    elif period == "month":
        local_start = today.replace(day=1)
    else:
        return None
    return local_to_utc_naive(local_start)


def tracking_since(db: Session) -> datetime | None:
    """Timestamp of the earliest recorded event, so the UI can be honest about
    a window that started before logging did."""
    row = db.query(ActivityEvent.logged_at).order_by(ActivityEvent.logged_at.asc()).first()
    return row[0] if row else None

"""Hall of Fame crowns — the reward for topping a period.

A crown is (period_type, period_key, winner). '2026-08-10' happens once in
history, so the card minted from it can never be re-won, duplicated or farmed;
uniqueness is a property of time rather than a flag we have to defend.

This is deliberately winnable by anyone. A creator you open twice a year can
take a quiet Tuesday and hold a card for it forever — that is the entire point,
and it is why there is no minimum score to qualify. The only bar is the one the
Hall of Fame already sets: if the board has a #1 for that period, she is
crowned. A dead period has no board, so it has no champion.

Tiers ladder by how long the window was held, not by rank:
    day → epic · week → legendary · month → celestial
"""
from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import ActivityEvent, Card, Creator, Gallery, HofCrown, Image, SessionLog
from services import ranking
from services.cards import generate_card

TIER = {"day": "epic", "week": "legendary", "month": "celestial"}

# Nothing is crowned before this — the feature did not exist, and a new install
# has no history here anyway, so the retroactive sweep is naturally a no-op for
# anyone who wasn't already using the app.
EPOCH = datetime(2026, 5, 1)


# ── Period arithmetic ─────────────────────────────────────────────────────────

def _day_key(d):   return d.strftime("%Y-%m-%d")
def _week_key(d):  return f"{d.isocalendar()[0]}-W{d.isocalendar()[1]:02d}"
def _month_key(d): return d.strftime("%Y-%m")

KEYFN = {"day": _day_key, "week": _week_key, "month": _month_key}


def _bounds(period_type: str, start: datetime):
    """[start, end) for the period containing `start`."""
    if period_type == "day":
        s = start.replace(hour=0, minute=0, second=0, microsecond=0)
        return s, s + timedelta(days=1)
    if period_type == "week":
        s = start.replace(hour=0, minute=0, second=0, microsecond=0)
        s -= timedelta(days=s.weekday())
        return s, s + timedelta(days=7)
    s = start.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    nxt = (s + timedelta(days=32)).replace(day=1)
    return s, nxt


def _completed_periods(period_type: str, since: datetime, now: datetime):
    """Every period of this type that has fully finished, oldest first.

    Only completed periods are crowned — a champion is decided when the whistle
    goes, not while the match is still running.
    """
    out = []
    start, _ = _bounds(period_type, since)
    while True:
        s, e = _bounds(period_type, start)
        if e > now:
            break
        out.append((KEYFN[period_type](s), s, e))
        start = e
    return out


# ── Awarding ──────────────────────────────────────────────────────────────────

def _winning_image(db: Session, creator_id: int, since, until):
    """The file she actually won on — the period's most-used, so the card art is
    a capsule of that week rather than a portrait that drifts as tastes move.
    Falls back to her best all-time when the period predates event logging."""
    row = (
        db.query(ActivityEvent.image_id, func.sum(ActivityEvent.amount))
          .join(Image, Image.id == ActivityEvent.image_id)
          .join(Gallery, Gallery.id == Image.gallery_id)
          .filter(ActivityEvent.logged_at >= since, ActivityEvent.logged_at < until,
                  ActivityEvent.kind.in_(("cum", "view", "seconds")),
                  Gallery.creator_id == creator_id)
          .group_by(ActivityEvent.image_id)
          .order_by(func.sum(ActivityEvent.amount).desc()).first()
    )
    if row and row[0]:
        return row[0]

    img = (db.query(Image).join(Gallery, Image.gallery_id == Gallery.id)
             .filter(Gallery.creator_id == creator_id)
             .order_by(Image.cum_count.desc(), Image.view_count.desc()).first())
    return img.id if img else None


def award_period(db: Session, period_type: str, key: str, since, until) -> HofCrown | None:
    """Crown one finished period. Idempotent — the unique (type, key) means a
    second call for the same period is a no-op, so this is safe to sweep."""
    existing = (db.query(HofCrown)
                  .filter(HofCrown.period_type == period_type, HofCrown.period_key == key)
                  .first())
    if existing:
        return None

    scores = ranking.score_all_creators_in_period(db, since, until)
    order  = ranking.ranked_ids(scores)
    if not order:
        return None   # nothing happened; no board, no champion

    winner_id = order[0]
    creator = db.query(Creator).filter(Creator.id == winner_id).first()
    if not creator:
        return None

    s = scores[winner_id]
    crown = HofCrown(
        period_type=period_type, period_key=key, creator_id=winner_id,
        won_at=until - timedelta(seconds=1),
        score=int(s["score"]), field_size=len(order),
        sessions=int(s.get("session_count") or 0),
        cum=int(s.get("total_cum") or 0),
        view_seconds=int(s.get("total_view_seconds") or 0),
        image_id=_winning_image(db, winner_id, since, until),
    )
    db.add(crown)
    db.flush()

    card = generate_card(
        db, "hof",
        source_creator_id=winner_id,
        source_image_id=crown.image_id,
        baseline_override=TIER[period_type],
    )
    crown.card_id = card.id
    db.flush()
    return crown


def award_due_crowns(db: Session, now: datetime | None = None) -> int:
    """Crown every finished period that hasn't been crowned yet.

    Doubles as the retroactive backfill: on first run it walks back to the start
    of recorded history, and on every run after that it only finds the handful
    of periods that closed since. A fresh install has no history before now, so
    it mints nothing — which is exactly the intended behaviour for a new user.
    """
    now = now or datetime.now()

    first_session = db.query(func.min(SessionLog.logged_at)).scalar()
    first_event   = db.query(func.min(ActivityEvent.logged_at)).scalar()
    starts = [d for d in (first_session, first_event) if d]
    if not starts:
        return 0
    history_start = max(min(starts), EPOCH)

    minted = 0
    for period_type in ("day", "week", "month"):
        # Resume from the last crown of this type rather than replaying history
        # every call. Without this a routine sweep re-checks ~90 already-decided
        # periods, which is fine once at boot and far too heavy per request.
        last = (db.query(func.max(HofCrown.won_at))
                  .filter(HofCrown.period_type == period_type).scalar())
        start = last if last else history_start
        for key, s, e in _completed_periods(period_type, start, now):
            if award_period(db, period_type, key, s, e):
                minted += 1

    if minted:
        db.commit()
    return minted


# ── Reads ─────────────────────────────────────────────────────────────────────

def crowns_for_creator(db: Session, creator_id: int) -> dict:
    """Her honours board — what the stats modal shows when you click her."""
    rows = (db.query(HofCrown)
              .filter(HofCrown.creator_id == creator_id)
              .order_by(HofCrown.won_at.desc()).all())

    counts = {"day": 0, "week": 0, "month": 0}
    for r in rows:
        counts[r.period_type] = counts.get(r.period_type, 0) + 1

    return {
        "total": len(rows),
        "counts": counts,
        "first_won": rows[-1].won_at.isoformat() if rows else None,
        "last_won":  rows[0].won_at.isoformat() if rows else None,
        "crowns": [{
            "id": r.id, "period_type": r.period_type, "period_key": r.period_key,
            "won_at": r.won_at.isoformat() if r.won_at else None,
            "score": r.score, "field_size": r.field_size,
            "sessions": r.sessions, "cum": r.cum, "view_seconds": r.view_seconds,
            "image_id": r.image_id, "card_id": r.card_id,
            "tier": TIER.get(r.period_type, "epic"),
        } for r in rows[:60]],
    }


def crown_counts_bulk(db: Session, creator_ids: list) -> dict:
    """{creator_id: total_crowns} — for badging Hall of Fame rows without n+1."""
    if not creator_ids:
        return {}
    rows = (db.query(HofCrown.creator_id, func.count(HofCrown.id))
              .filter(HofCrown.creator_id.in_(creator_ids))
              .group_by(HofCrown.creator_id).all())
    return {int(cid): int(n) for cid, n in rows}


def recent_crowns(db: Session, limit: int = 20) -> list:
    rows = (db.query(HofCrown, Creator)
              .join(Creator, Creator.id == HofCrown.creator_id)
              .order_by(HofCrown.won_at.desc()).limit(limit).all())
    return [{
        "id": r.id, "period_type": r.period_type, "period_key": r.period_key,
        "won_at": r.won_at.isoformat() if r.won_at else None,
        "field_size": r.field_size, "tier": TIER.get(r.period_type, "epic"),
        "creator": {"id": c.id, "name": c.name, "avatar_path": c.avatar_path},
    } for r, c in rows]

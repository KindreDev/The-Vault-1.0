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
from datetime import date, datetime, timedelta
import json

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from models import (
    ActivityEvent, Card, Creator, Gallery, HofCategoryAward, HofCategoryProgress, HofCrown, Image, SessionLog,
    gallery_creators, image_creators,
)
from services import activity, ranking
from services.cards import generate_card
from services.hof_cards import (
    HOF_CROWN_BASELINE_RARITY, HOF_CROWN_PRINT_RARITY, prepare_hof_visual,
)

TIER = {period: rarity for period, rarity in HOF_CROWN_BASELINE_RARITY.items() if period != "alltime"}
ALLTIME_RARITY = HOF_CROWN_PRINT_RARITY["alltime"]

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


def _period_start_from_key(period_type: str, key: str) -> datetime:
    if period_type == "day":
        return datetime.strptime(key, "%Y-%m-%d")
    if period_type == "week":
        year, week = key.split("-W", 1)
        return datetime.combine(date.fromisocalendar(int(year), int(week), 1), datetime.min.time())
    return datetime.strptime(key, "%Y-%m")


# ── Awarding ──────────────────────────────────────────────────────────────────

def _winning_image(db: Session, creator_id: int, since, until):
    """The file she actually won on — the period's most-used, so the card art is
    a capsule of that week rather than a portrait that drifts as tastes move.
    Falls back to her best all-time when the period predates event logging."""
    pairs = ranking._creator_image_pairs()
    row = (
        db.query(ActivityEvent.image_id, func.sum(ActivityEvent.amount))
          .join(pairs, pairs.c.image_id == ActivityEvent.image_id)
          .filter(ActivityEvent.logged_at >= since, ActivityEvent.logged_at < until,
                  ActivityEvent.kind.in_(("cum", "view", "seconds")),
                  pairs.c.creator_id == creator_id)
          .group_by(ActivityEvent.image_id)
          .order_by(func.sum(ActivityEvent.amount).desc()).first()
    )
    if row and row[0]:
        return row[0]

    img = (db.query(Image.id).join(pairs, pairs.c.image_id == Image.id)
             .filter(pairs.c.creator_id == creator_id)
             .order_by(Image.cum_count.desc(), Image.view_count.desc()).first())
    return img[0] if img else None


def _alltime_winning_image(db: Session, creator_id: int):
    """The strongest current image attached to the all-time champion."""
    assigned_gallery_ids = select(gallery_creators.c.gallery_id).where(
        gallery_creators.c.creator_id == creator_id,
    )
    assigned_image_ids = select(image_creators.c.image_id).where(
        image_creators.c.creator_id == creator_id,
    )
    img = (db.query(Image).join(Gallery, Image.gallery_id == Gallery.id)
             .filter(or_(
                 Gallery.creator_id == creator_id,
                 Gallery.id.in_(assigned_gallery_ids),
                 Image.id.in_(assigned_image_ids),
             ))
             .order_by(Image.cum_count.desc(), Image.view_count.desc(), Image.id.asc())
             .first())
    return img.id if img else None


def award_period(db: Session, period_type: str, key: str, since, until) -> HofCrown | None:
    """Crown one finished period. Idempotent — the unique (type, key) means a
    second call for the same period is a no-op, so this is safe to sweep."""
    existing = (db.query(HofCrown)
                  .filter(HofCrown.period_type == period_type, HofCrown.period_key == key)
                  .first())
    if existing:
        return None

    db_since = activity.local_to_utc_naive(since)
    db_until = activity.local_to_utc_naive(until)
    scores = ranking.score_all_creators_in_period(db, db_since, db_until)
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
        image_id=_winning_image(db, winner_id, db_since, db_until),
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
    card.print_rarity = HOF_CROWN_PRINT_RARITY[period_type]
    db.flush()
    prepare_hof_visual(db, card)
    db.flush()
    return crown


def award_alltime_crown(db: Session, now: datetime | None = None) -> HofCrown | None:
    """Record a new all-time champion only when the current leader changes.

    All-time crowns begin with the first observed leader. The transition time is
    stored as both ``won_at`` and the reign key, so later sweeps can distinguish
    a genuine new reign from an unchanged ranking without reconstructing history.
    """
    transition_at = now or datetime.now()
    scores = ranking.score_all_creators(db)
    order = ranking.ranked_creator_ids(scores)
    if not order:
        return None

    winner_id = order[0]
    creator = db.query(Creator).filter(Creator.id == winner_id).first()
    if not creator:
        return None
    latest = (db.query(HofCrown)
                .filter(HofCrown.period_type == "alltime")
                .order_by(HofCrown.won_at.desc(), HofCrown.id.desc())
                .first())
    if latest and latest.creator_id == winner_id:
        return None

    stats = scores[winner_id]
    crown = HofCrown(
        period_type="alltime", period_key=transition_at.isoformat(timespec="microseconds"),
        creator_id=winner_id, won_at=transition_at,
        score=int(stats.get("score") or 0), field_size=len(order),
        sessions=int(stats.get("session_count") or 0),
        cum=int(stats.get("total_cum") or 0),
        view_seconds=int(stats.get("total_view_seconds") or 0),
        image_id=_alltime_winning_image(db, winner_id),
    )
    db.add(crown)
    db.flush()

    card = generate_card(
        db, "hof", source_creator_id=winner_id,
        source_image_id=crown.image_id,
        baseline_override=HOF_CROWN_BASELINE_RARITY["alltime"],
    )
    card.rarity_class = ALLTIME_RARITY
    card.print_rarity = ALLTIME_RARITY
    crown.card_id = card.id
    db.flush()
    prepare_hof_visual(db, card)
    db.flush()
    return crown


def _linked_creator_for_image(db: Session, image: Image):
    gallery = db.query(Gallery).filter(Gallery.id == image.gallery_id).first()
    if gallery:
        linked_creator = _linked_creator_for_gallery(db, gallery)
        if linked_creator:
            return linked_creator
    row = db.query(image_creators.c.creator_id).filter(image_creators.c.image_id == image.id).first()
    return row[0] if row else None


def _linked_creator_for_gallery(db: Session, gallery: Gallery):
    if gallery.creator_id:
        return gallery.creator_id
    row = db.query(gallery_creators.c.creator_id).filter(gallery_creators.c.gallery_id == gallery.id).first()
    return row[0] if row else None


def _category_scores(db: Session, category: str, since=None, until=None):
    if category == "media":
        if since is not None:
            return ranking.score_all_images_in_period(db, since, until)
        return {
            image.id: {"score": ranking.image_score(image)}
            for image in db.query(Image).all()
            if ranking.image_score(image) > 0
        }
    if since is not None:
        return ranking.score_all_galleries_in_period(db, since, until)
    return ranking.score_all_galleries(db)


def _create_category_award(db: Session, category: str, period_type: str, period_key: str,
                           winner_id: int, score: int, field_size: int, won_at: datetime):
    existing = db.query(HofCategoryAward).filter_by(
        category_type=category, period_type=period_type, period_key=period_key,
    ).first()
    if existing:
        return None
    image_id = gallery_id = creator_id = None
    if category == "media":
        winner = db.query(Image).filter(Image.id == winner_id).first()
        if not winner:
            return None
        image_id = winner.id
        creator_id = _linked_creator_for_image(db, winner)
    else:
        winner = db.query(Gallery).filter(Gallery.id == winner_id).first()
        if not winner:
            return None
        gallery_id = winner.id
        creator_id = _linked_creator_for_gallery(db, winner)
        image = (db.query(Image).filter(Image.gallery_id == winner.id)
                 .order_by(Image.sort_order.asc(), Image.id.asc()).first())
        image_id = image.id if image else None

    award = HofCategoryAward(
        category_type=category, period_type=period_type, period_key=period_key,
        winner_id=winner_id, creator_id=creator_id, image_id=image_id,
        gallery_id=gallery_id, won_at=won_at, score=int(score), field_size=field_size,
    )
    db.add(award)
    db.flush()
    card = generate_card(
        db, "hof", source_creator_id=creator_id, source_image_id=image_id,
        source_gallery_id=gallery_id, baseline_override=HOF_CROWN_BASELINE_RARITY[period_type],
    )
    print_rarity = HOF_CROWN_PRINT_RARITY[period_type]
    card.print_rarity = print_rarity
    if period_type == "alltime":
        card.rarity_class = print_rarity
    award.card_id = card.id
    db.flush()
    prepare_hof_visual(db, card)
    recipe = json.loads(card.visual_recipe)
    recipe["snapshot"]["awardCategory"] = category
    card.visual_recipe = json.dumps(recipe, separators=(",", ":"), sort_keys=True)
    db.flush()
    return award


def award_category_period(db: Session, category: str, period_type: str, key: str, since, until):
    db_since = activity.local_to_utc_naive(since)
    db_until = activity.local_to_utc_naive(until)
    scores = _category_scores(db, category, db_since, db_until)
    order = ranking.ranked_ids(scores)
    if not order:
        return None
    winner_id = order[0]
    return _create_category_award(
        db, category, period_type, key, winner_id, scores[winner_id]["score"],
        len(order), until - timedelta(seconds=1),
    )


def award_category_alltime(db: Session, category: str, now: datetime):
    scores = _category_scores(db, category)
    order = ranking.ranked_ids(scores)
    if not order:
        return None
    winner_id = order[0]
    latest = (db.query(HofCategoryAward)
              .filter(HofCategoryAward.category_type == category,
                      HofCategoryAward.period_type == "alltime")
              .order_by(HofCategoryAward.won_at.desc(), HofCategoryAward.id.desc()).first())
    if latest and latest.winner_id == winner_id:
        return None
    key = now.isoformat(timespec="microseconds")
    return _create_category_award(
        db, category, "alltime", key, winner_id, scores[winner_id]["score"],
        len(order), now,
    )


def award_due_crowns(db: Session, now: datetime | None = None) -> int:
    """Crown every finished period that hasn't been crowned yet.

    Doubles as the retroactive backfill: on first run it walks back to the start
    of recorded history, and on every run after that it only finds the handful
    of periods that closed since. A fresh install has no history before now, so
    it mints nothing — which is exactly the intended behaviour for a new user.
    """
    now = now or datetime.now()
    minted = 1 if award_alltime_crown(db, now=now) else 0
    for category in ("media", "gallery"):
        minted += int(bool(award_category_alltime(db, category, now)))

    first_session = db.query(func.min(SessionLog.logged_at)).scalar()
    first_event   = db.query(func.min(ActivityEvent.logged_at)).scalar()
    starts = [d for d in (first_session, first_event) if d]
    if not starts:
        if minted:
            db.commit()
        return minted
    history_start = max(activity.utc_naive_to_local(min(starts)), EPOCH)

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
        for category in ("media", "gallery"):
            progress = (db.query(HofCategoryProgress)
                        .filter_by(category_type=category, period_type=period_type).first())
            category_start = (
                _bounds(period_type, _period_start_from_key(period_type, progress.last_period_key))[1]
                if progress else history_start
            )
            for key, s, e in _completed_periods(period_type, category_start, now):
                if award_category_period(db, category, period_type, key, s, e):
                    minted += 1
                if progress is None:
                    progress = HofCategoryProgress(
                        category_type=category, period_type=period_type, last_period_key=key,
                    )
                    db.add(progress)
                else:
                    progress.last_period_key = key
                    progress.checked_at = now
                db.flush()

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

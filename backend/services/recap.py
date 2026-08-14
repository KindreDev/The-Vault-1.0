"""The Recap — a story-mode reading of your own behaviour over a window.

Deliberately NOT a third stats surface. Stats → Overview owns totals, the
Almanac owns the long view; this assembles the same kind of numbers into a
paced, card-by-card narrative with an opinion about what they mean.

Everything is emitted as a typed card. The frontend is a dumb player: it
renders whatever cards arrive, in order, and knows nothing about how any of
them were computed. Adding a card type is a backend-only change.

Data sources, and why each:
  xp_events      — the dense behavioural log (thousands of rows, every action
                   timestamped and labelled). This is what makes hour-of-day,
                   weekday rhythm and streaks answerable back to May 2026.
  session_logs   — per-creator sessions with duration, also historical.
  activity_events— per-entity views/cum/edges, only from 2026-08-10 onward.
  lifetime counters — all-time superlatives that predate any logging.

Where history is thin the card is simply omitted rather than faked.
"""
import statistics
from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

# ── Unlock gate ───────────────────────────────────────────────────────────────
# A recap built from twenty minutes of history is a worse first impression than
# no recap at all: the superlatives are noise, the comparisons have nothing to
# compare against, and half the cards get omitted for thin data. So the page
# stays hidden until there is enough behaviour to actually read.
#
# Session time and view time are summed rather than requiring sessions alone —
# someone who browses heavily without ever pressing the session button has
# plenty of history for a recap, and gating on sessions would hide it forever.
RECAP_MIN_SECONDS = 5 * 3600


def availability(db: Session) -> dict:
    """Whether the recap has earned its place in the UI yet."""
    from models import SessionLog, Image

    session_secs = db.query(func.coalesce(func.sum(SessionLog.duration_sec), 0)).scalar() or 0
    view_secs    = db.query(func.coalesce(func.sum(Image.view_seconds), 0)).scalar() or 0
    tracked = int(session_secs) + int(view_secs)
    return {
        "unlocked":         tracked >= RECAP_MIN_SECONDS,
        "tracked_seconds":  tracked,
        "required_seconds": RECAP_MIN_SECONDS,
    }

from models import (
    ActivityEvent, Creator, Gallery, Image, SessionLog, XPEvent,
    gallery_creators, image_creators,
)
from services import ranking

# Reasons that mean "you were actually using it on purpose", as opposed to the
# scanner importing 1,790 galleries in an afternoon — which is a real event but
# says nothing about behaviour and would bury the signal in every histogram.
GOON_REASONS   = ("cum_logged", "edge_logged", "session_logged")
ACTIVE_REASONS = GOON_REASONS + ("image_rated", "gallery_rated", "tag_added",
                                 "daily_login", "pack_opened", "creator_added")

PERIOD_LABELS = {
    "day":   "Today",
    "week":  "This Week",
    "month": "This Month",
    "year":  "This Year",
    "all":   "All Time",
}


# ── Windows ───────────────────────────────────────────────────────────────────

def window(period: str):
    """(since, until, previous_since) for a period. since=None means all-time."""
    now   = datetime.now()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    if period == "day":
        return today, now, today - timedelta(days=1)
    if period == "week":
        start = today - timedelta(days=today.weekday())
        return start, now, start - timedelta(days=7)
    if period == "month":
        start = today.replace(day=1)
        prev  = (start - timedelta(days=1)).replace(day=1)
        return start, now, prev
    if period == "year":
        start = today.replace(month=1, day=1)
        return start, now, start.replace(year=start.year - 1)
    return None, now, None


def _range_label(period: str, since, until) -> str:
    if since is None:
        return "Everything, from the beginning"
    if period == "day":
        return since.strftime("%A, %d %B")
    if period == "week":
        return f"{since.strftime('%d %b')} — {until.strftime('%d %b')}"
    if period == "month":
        return since.strftime("%B %Y")
    return since.strftime("%Y")


# ── Primitive measurements ────────────────────────────────────────────────────

def _xp_between(db, since, until, reasons=None):
    q = db.query(XPEvent).filter(XPEvent.earned_at <= until)
    if since is not None:
        q = q.filter(XPEvent.earned_at >= since)
    if reasons:
        q = q.filter(XPEvent.reason.in_(reasons))
    return q


def _counts(db, since, until) -> dict:
    """Headline volume for a window."""
    rows = (
        _xp_between(db, since, until)
        .with_entities(XPEvent.reason, func.count(XPEvent.id), func.sum(XPEvent.amount))
        .group_by(XPEvent.reason).all()
    )
    by_reason = {r: {"n": int(n or 0), "xp": int(x or 0)} for r, n, x in rows}

    sess_q = db.query(SessionLog).filter(SessionLog.logged_at <= until)
    if since is not None:
        sess_q = sess_q.filter(SessionLog.logged_at >= since)
    durations = [int(s.duration_sec or 0) for s in sess_q.all()]

    active_days = (
        _xp_between(db, since, until, ACTIVE_REASONS)
        .with_entities(func.count(func.distinct(func.date(XPEvent.earned_at))))
        .scalar() or 0
    )

    return {
        "cum":          by_reason.get("cum_logged", {}).get("n", 0),
        "edges":        by_reason.get("edge_logged", {}).get("n", 0),
        "sessions":     len(durations),
        "session_secs": sum(durations),
        "longest_sec":  max(durations) if durations else 0,
        "median_sec":   int(statistics.median(durations)) if durations else 0,
        "rated":        by_reason.get("image_rated", {}).get("n", 0)
                        + by_reason.get("gallery_rated", {}).get("n", 0),
        "packs":        by_reason.get("pack_opened", {}).get("n", 0),
        "creators_added": by_reason.get("creator_added", {}).get("n", 0),
        "xp":           sum(v["xp"] for v in by_reason.values()),
        "active_days":  int(active_days),
    }


def _hour_histogram(db, since, until) -> list:
    rows = (
        _xp_between(db, since, until, GOON_REASONS)
        .with_entities(func.strftime("%H", XPEvent.earned_at), func.count(XPEvent.id))
        .group_by(func.strftime("%H", XPEvent.earned_at)).all()
    )
    hist = [0] * 24
    for h, n in rows:
        if h is not None:
            hist[int(h)] = int(n or 0)
    return hist


def _weekday_histogram(db, since, until) -> list:
    """Monday-first, so the chart reads like a week rather than starting Sunday."""
    rows = (
        _xp_between(db, since, until, GOON_REASONS)
        .with_entities(func.strftime("%w", XPEvent.earned_at), func.count(XPEvent.id))
        .group_by(func.strftime("%w", XPEvent.earned_at)).all()
    )
    sun_first = [0] * 7
    for d, n in rows:
        if d is not None:
            sun_first[int(d)] = int(n or 0)
    return sun_first[1:] + sun_first[:1]


def _streak(db, since, until) -> dict:
    """Longest run of consecutive active days inside the window."""
    days = sorted({
        r[0] for r in _xp_between(db, since, until, ACTIVE_REASONS)
        .with_entities(func.date(XPEvent.earned_at)).distinct().all() if r[0]
    })
    if not days:
        return {"longest": 0, "current": 0}

    parsed = [datetime.strptime(d, "%Y-%m-%d").date() for d in days]
    longest = run = 1
    for a, b in zip(parsed, parsed[1:]):
        run = run + 1 if (b - a).days == 1 else 1
        longest = max(longest, run)

    today = datetime.now().date()
    current = 0
    if parsed[-1] in (today, today - timedelta(days=1)):
        current = 1
        for a, b in zip(reversed(parsed[:-1]), reversed(parsed[1:])):
            if (b - a).days == 1:
                current += 1
            else:
                break
    return {"longest": longest, "current": current}


def _top_creators(db, since, limit=5) -> list:
    scores = (ranking.score_all_creators(db) if since is None
              else ranking.score_all_creators_in_period(db, since))
    order = (ranking.ranked_creator_ids(scores) if since is None
             else ranking.ranked_ids(scores))
    out = []
    for cid in order[:limit]:
        c = db.query(Creator).filter(Creator.id == cid).first()
        if not c:
            continue
        s = scores[cid]
        out.append({
            "id": c.id, "name": c.name, "creator_type": c.creator_type,
            "avatar_path": c.avatar_path, "card_rarity": c.card_rarity,
            "score": s["score"], "sessions": s.get("session_count", 0),
            "cum": s.get("total_cum", 0), "views": s.get("total_views", 0),
            "view_seconds": s.get("total_view_seconds", 0),
        })
    return out, scores, order


def _first_seen_creator(db, since, until):
    """A creator whose very first logged engagement falls inside this window —
    someone who did not exist to you before, and now does."""
    if since is None:
        return None
    firsts = dict(
        db.query(SessionLog.creator_id, func.min(SessionLog.logged_at))
          .filter(SessionLog.creator_id.isnot(None))
          .group_by(SessionLog.creator_id).all()
    )
    born = [cid for cid, first in firsts.items() if first and since <= first <= until]
    if not born:
        return None
    # The one who made the biggest impression, not just the most recent.
    counts = dict(
        db.query(SessionLog.creator_id, func.count(SessionLog.id))
          .filter(SessionLog.creator_id.in_(born), SessionLog.logged_at <= until)
          .group_by(SessionLog.creator_id).all()
    )
    cid = max(born, key=lambda c: counts.get(c, 0))
    c = db.query(Creator).filter(Creator.id == cid).first()
    if not c:
        return None
    return {"id": c.id, "name": c.name, "creator_type": c.creator_type,
            "avatar_path": c.avatar_path, "sessions": counts.get(cid, 0)}


def _relic(db, since, until):
    """The single file that took the most deliberate punishment in the window."""
    if since is not None:
        row = (
            db.query(ActivityEvent.image_id, func.sum(ActivityEvent.amount))
              .filter(ActivityEvent.kind == "cum",
                      ActivityEvent.logged_at >= since,
                      ActivityEvent.logged_at <= until)
              .group_by(ActivityEvent.image_id)
              .order_by(func.sum(ActivityEvent.amount).desc()).first()
        )
        if not row:
            return None
        img = db.query(Image).filter(Image.id == row[0]).first()
        count = int(row[1] or 0)
    else:
        img = (db.query(Image).filter(Image.cum_count > 0)
                 .order_by(Image.cum_count.desc()).first())
        if not img:
            return None
        count = int(img.cum_count or 0)

    if not img:
        return None
    gal = db.query(Gallery).filter(Gallery.id == img.gallery_id).first() if img.gallery_id else None
    return {"id": img.id, "filename": img.filename, "thumb_path": img.thumb_path,
            "is_video": img.is_video, "cum": count,
            "gallery_id": img.gallery_id, "gallery_name": gal.name if gal else None}


def _collection_growth(db, since, until) -> dict:
    iq = db.query(func.count(Image.id)).filter(Image.created_at <= until)
    gq = db.query(func.count(Gallery.id)).filter(Gallery.created_at <= until)
    if since is not None:
        iq = iq.filter(Image.created_at >= since)
        gq = gq.filter(Gallery.created_at >= since)
    return {"files": int(iq.scalar() or 0), "galleries": int(gq.scalar() or 0)}


# ── Archetype ─────────────────────────────────────────────────────────────────
# Four binary axes → sixteen types. Same shape as the thing this is modelled on,
# because four axes is genuinely the sweet spot: enough that the result feels
# specific to you, few enough that each axis is explainable in one line.

AXES = ("depth", "focus", "clock", "appetite")

ARCHETYPES = {
    ("marathon", "devoted",  "night", "seeking"): ("The Night Pilgrim",       "Long hours, one obsession at a time, always after dark — and still looking for the next one."),
    ("marathon", "devoted",  "night", "homing"):  ("The Keeper of the Vigil",  "You sit with the same few until sunrise. Nothing new gets in, and nothing needs to."),
    ("marathon", "devoted",  "day",   "seeking"): ("The Collector-Errant",     "Daylight sessions, deep and narrow, but the roster keeps turning over."),
    ("marathon", "devoted",  "day",   "homing"):  ("The Devout",               "Long, focused, unhurried, and entirely faithful. The purest form of this."),
    ("marathon", "roving",   "night", "seeking"): ("The Midnight Cartographer","You go out late and come back with maps. Breadth is the whole point."),
    ("marathon", "roving",   "night", "homing"):  ("The Long Watch",           "Hours after midnight, drifting the whole library, never leaving it."),
    ("marathon", "roving",   "day",   "seeking"): ("The Expedition",           "Long daylight runs across everything you own, plus whatever's new."),
    ("marathon", "roving",   "day",   "homing"):  ("The Curator",              "You take your time and you walk the whole collection. Nothing gets neglected."),
    ("sprint",   "devoted",  "night", "seeking"): ("The Nightcap",             "Quick, late, and you still found someone new before bed."),
    ("sprint",   "devoted",  "night", "homing"):  ("The Ritualist",            "Same face, same hour, same length. A habit, not a search."),
    ("sprint",   "devoted",  "day",   "seeking"): ("The Quick Study",          "In, focused on one, out — and the one keeps changing."),
    ("sprint",   "devoted",  "day",   "homing"):  ("The Loyalist",             "Short visits to the same handful. You know exactly what you came for."),
    ("sprint",   "roving",   "night", "seeking"): ("The Prowler",              "Late, fast, everywhere, and hungry for unfamiliar faces."),
    ("sprint",   "roving",   "night", "homing"):  ("The Insomniac",            "Brief, scattered, nocturnal. Restless rather than searching."),
    ("sprint",   "roving",   "day",   "seeking"): ("The Scout",                "Fast passes over wide ground, hunting for something that sticks."),
    ("sprint",   "roving",   "day",   "homing"):  ("The Grazer",               "A little of everything, often, in daylight. No urgency at all."),
}

AXIS_COPY = {
    "depth":    {"marathon": ("Marathon", "Your sessions run long"),
                 "sprint":   ("Sprint",   "You keep it short")},
    "focus":    {"devoted":  ("Devoted",  "Your attention concentrates on a few"),
                 "roving":   ("Roving",   "Your attention spreads wide")},
    "clock":    {"night":    ("Nocturnal","You peak after dark"),
                 "day":      ("Daylight", "You peak while the sun is up")},
    "appetite": {"seeking":  ("Seeking",  "New faces keep entering the rotation"),
                 "homing":   ("Homing",   "You return to who you already know")},
}


def _archetype(counts, hours, top, scores, order, first_seen) -> dict | None:
    """Needs enough behaviour to be honest — a single session can't have a
    personality, and inventing one would undermine every other card."""
    if counts["sessions"] < 3 and sum(hours) < 10:
        return None

    depth = "marathon" if counts["median_sec"] >= 900 else "sprint"

    total_score = sum(scores[c]["score"] for c in order) or 1
    top3_share  = sum(scores[c]["score"] for c in order[:3]) / total_score
    focus = "devoted" if top3_share >= 0.5 else "roving"

    night_share = (sum(hours[22:]) + sum(hours[:6])) / (sum(hours) or 1)
    peak_hour   = hours.index(max(hours)) if sum(hours) else 12
    clock = "night" if (night_share >= 0.4 or peak_hour >= 22 or peak_hour < 6) else "day"

    appetite = "seeking" if first_seen else "homing"

    key = (depth, focus, clock, appetite)
    name, blurb = ARCHETYPES[key]
    return {
        "name": name, "blurb": blurb,
        "axes": [
            {"axis": a, "value": v, "label": AXIS_COPY[a][v][0], "copy": AXIS_COPY[a][v][1]}
            for a, v in zip(AXES, key)
        ],
        "top3_share": round(top3_share * 100),
        "night_share": round(night_share * 100),
        "peak_hour": peak_hour,
    }


# ── Deck assembly ─────────────────────────────────────────────────────────────

def _delta(now_v, prev_v):
    """Percent change vs the previous window, or None when there's no base to
    compare against — showing '+100%' against zero would be noise."""
    if not prev_v:
        return None
    return round((now_v - prev_v) / prev_v * 100)


def build_deck(db: Session, period: str) -> dict:
    since, until, prev_since = window(period)
    counts = _counts(db, since, until)
    hours  = _hour_histogram(db, since, until)
    days   = _weekday_histogram(db, since, until)
    streak = _streak(db, since, until)
    top, scores, order = _top_creators(db, since)
    first_seen = _first_seen_creator(db, since, until)
    relic  = _relic(db, since, until)
    growth = _collection_growth(db, since, until)

    prev = _counts(db, prev_since, since) if prev_since and since else None

    cards = []

    cards.append({
        "type": "opening",
        "period": period,
        "title": PERIOD_LABELS.get(period, period.title()),
        "range": _range_label(period, since, until),
        "active_days": counts["active_days"],
        "xp": counts["xp"],
    })

    if counts["sessions"] or counts["cum"]:
        cards.append({
            "type": "volume",
            "sessions": counts["sessions"],
            "session_secs": counts["session_secs"],
            "cum": counts["cum"],
            "edges": counts["edges"],
            "longest_sec": counts["longest_sec"],
            "deltas": {
                "sessions":     _delta(counts["sessions"], prev["sessions"]) if prev else None,
                "session_secs": _delta(counts["session_secs"], prev["session_secs"]) if prev else None,
                "cum":          _delta(counts["cum"], prev["cum"]) if prev else None,
            },
        })

    if sum(hours) >= 5:
        peak = hours.index(max(hours))
        cards.append({
            "type": "clock", "hours": hours, "peak_hour": peak,
            "peak_share": round(max(hours) / (sum(hours) or 1) * 100),
            "night_share": round((sum(hours[22:]) + sum(hours[:6])) / (sum(hours) or 1) * 100),
        })

    if sum(days) >= 5 and period != "day":
        peak_day = days.index(max(days))
        cards.append({
            "type": "rhythm", "days": days, "peak_day": peak_day,
            "streak": streak, "active_days": counts["active_days"],
        })

    if len(top) >= 2:
        cards.append({"type": "countdown", "creators": list(reversed(top))})

    if len(order) >= 4:
        total = sum(scores[c]["score"] for c in order) or 1
        cards.append({
            "type": "devotion",
            "top3_share": round(sum(scores[c]["score"] for c in order[:3]) / total * 100),
            "roster": len(order),
            "names": [scores and top[i]["name"] for i in range(min(3, len(top)))],
        })

    if first_seen:
        cards.append({"type": "newcomer", "creator": first_seen})

    if relic and relic["cum"] > 0:
        cards.append({"type": "relic", "image": relic})

    if growth["files"] > 0:
        cards.append({"type": "growth", **growth})

    arch = _archetype(counts, hours, top, scores, order, first_seen)
    if arch:
        cards.append({"type": "archetype", **arch})

    cards.append({
        "type": "closing",
        "title": PERIOD_LABELS.get(period, period.title()),
        "range": _range_label(period, since, until),
        "headline": _headline(counts, top, arch),
        "sessions": counts["sessions"],
        "session_secs": counts["session_secs"],
        "cum": counts["cum"],
        "active_days": counts["active_days"],
        "top_name": top[0]["name"] if top else None,
        "archetype": arch["name"] if arch else None,
    })

    return {
        "period": period,
        "label": PERIOD_LABELS.get(period, period.title()),
        "range": _range_label(period, since, until),
        "since": since.isoformat() if since else None,
        "empty": len(cards) <= 2,
        "cards": cards,
    }


def _headline(counts, top, arch) -> str:
    if not counts["sessions"] and not counts["cum"]:
        return "Quiet. Nothing logged."
    bits = []
    if top:
        bits.append(f"{top[0]['name']} owned it")
    if counts["session_secs"] >= 3600:
        bits.append(f"{counts['session_secs'] // 3600}h logged")
    elif counts["session_secs"]:
        bits.append(f"{counts['session_secs'] // 60}m logged")
    if arch:
        bits.append(arch["name"])
    return " · ".join(bits) or "Logged and counted."

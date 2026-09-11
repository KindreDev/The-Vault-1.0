"""Read-only longitudinal analytics assembled from existing Vault telemetry.

Session rows are historical, while ActivityEvent coverage begins only when the
event ledger was introduced.  This service keeps those two coverage windows
explicit and never fills missing history with inferred events.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Iterable

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import (
    ActivityEvent,
    Creator,
    Gallery,
    Image,
    SessionLog,
    Tag,
    XPEvent,
    gallery_creators,
    gallery_tags,
    image_creators,
    image_tags,
)


RANGES = {"7d": 7, "30d": 30, "90d": 90, "all": None}
AGGREGATIONS = {"daily", "weekly", "monthly"}
METRICS = {"sessions", "session_minutes", "finishes", "edges", "viewing_time", "viewing_minutes"}
MILESTONE_HOURS = (10, 25, 50, 100, 250, 500, 1000)
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
DURATION_BUCKETS = (
    ("under_10", "<10 min", 0, 10 * 60),
    ("10_20", "10-20 min", 10 * 60, 20 * 60),
    ("20_30", "20-30 min", 20 * 60, 30 * 60),
    ("30_45", "30-45 min", 30 * 60, 45 * 60),
    ("45_60", "45-60 min", 45 * 60, 60 * 60),
    ("60_90", "60-90 min", 60 * 60, 90 * 60),
    ("90_plus", "90+ min", 90 * 60, None),
)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _window(db: Session, range_name: str, now: datetime | None = None):
    if range_name not in RANGES:
        raise ValueError("range must be one of: 7d, 30d, 90d, all")
    now = now or datetime.now()
    days = RANGES[range_name]
    if days is not None:
        start = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)
    else:
        candidates = [
            db.query(SessionLog.logged_at).order_by(SessionLog.logged_at.asc()).first(),
            db.query(ActivityEvent.logged_at).order_by(ActivityEvent.logged_at.asc()).first(),
            db.query(XPEvent.earned_at).order_by(XPEvent.earned_at.asc()).first(),
        ]
        values = [row[0] for row in candidates if row and row[0]]
        start = min(values) if values else now.replace(hour=0, minute=0, second=0, microsecond=0)
        start = start.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, now


def _period_start(value: datetime, aggregation: str) -> datetime:
    day = value.replace(hour=0, minute=0, second=0, microsecond=0)
    if aggregation == "weekly":
        return day - timedelta(days=day.weekday())
    if aggregation == "monthly":
        return day.replace(day=1)
    return day


def _advance(value: datetime, aggregation: str) -> datetime:
    if aggregation == "daily":
        return value + timedelta(days=1)
    if aggregation == "weekly":
        return value + timedelta(days=7)
    if value.month == 12:
        return value.replace(year=value.year + 1, month=1, day=1)
    return value.replace(month=value.month + 1, day=1)


def _period_key(value: datetime, aggregation: str) -> str:
    return _period_start(value, aggregation).date().isoformat()


def _period_keys(start: datetime, end: datetime, aggregation: str) -> list[str]:
    cursor = _period_start(start, aggregation)
    end_period = _period_start(end, aggregation)
    out = []
    while cursor <= end_period:
        out.append(cursor.date().isoformat())
        cursor = _advance(cursor, aggregation)
    return out


def _rolling(values: list[float], size: int = 7) -> list[float]:
    out = []
    for index in range(len(values)):
        window = values[max(0, index - size + 1):index + 1]
        out.append(round(sum(window) / len(window), 2))
    return out


def _parse_ids(raw: str | None) -> set[int]:
    if not raw:
        return set()
    parsed = set()
    for value in raw.split(","):
        value = value.strip()
        if value:
            try:
                parsed.add(int(value))
            except ValueError as exc:
                raise ValueError("ids must be comma-separated integers") from exc
    return parsed


def _logical_sessions(rows: Iterable[SessionLog]) -> list[dict]:
    """Fold multi-panel rows written for one end timestamp into one session."""
    groups: dict[datetime, dict] = {}
    for row in sorted(rows, key=lambda item: (item.logged_at or datetime.min, item.id or 0)):
        stamp = row.logged_at or datetime.min
        item = groups.setdefault(stamp, {
            "id": row.id,
            "row_ids": [],
            "logged_at": stamp,
            "duration_sec": 0,
            "creator_ids": set(),
            "gallery_ids": set(),
            "image_ids": set(),
            "xp_earned": 0,
        })
        item["row_ids"].append(row.id)
        item["duration_sec"] = max(item["duration_sec"], max(0, int(row.duration_sec or 0)))
        item["xp_earned"] += int(row.xp_earned or 0)
        if row.creator_id:
            item["creator_ids"].add(int(row.creator_id))
        if row.gallery_id:
            item["gallery_ids"].add(int(row.gallery_id))
        if row.image_id:
            item["image_ids"].add(int(row.image_id))
    result = []
    for item in groups.values():
        item["creator_ids"] = sorted(item["creator_ids"])
        item["gallery_ids"] = sorted(item["gallery_ids"])
        item["image_ids"] = sorted(item["image_ids"])
        result.append(item)
    return result


def _event_entity_maps(db: Session, image_ids: set[int]):
    tag_map: dict[int, set[int]] = defaultdict(set)
    creator_map: dict[int, set[int]] = defaultdict(set)
    gallery_by_image = {}
    if not image_ids:
        return tag_map, creator_map

    for image_id, gallery_id in db.query(Image.id, Image.gallery_id).filter(Image.id.in_(image_ids)).all():
        gallery_by_image[int(image_id)] = int(gallery_id)
    for image_id, tag_id in db.query(image_tags.c.image_id, image_tags.c.tag_id).filter(
        image_tags.c.image_id.in_(image_ids)
    ).all():
        tag_map[int(image_id)].add(int(tag_id))
    for image_id, creator_id in db.query(image_creators.c.image_id, image_creators.c.creator_id).filter(
        image_creators.c.image_id.in_(image_ids)
    ).all():
        creator_map[int(image_id)].add(int(creator_id))

    gallery_ids = set(gallery_by_image.values())
    gallery_tag_map: dict[int, set[int]] = defaultdict(set)
    for gallery_id, tag_id in db.query(gallery_tags.c.gallery_id, gallery_tags.c.tag_id).filter(
        gallery_tags.c.gallery_id.in_(gallery_ids)
    ).all():
        gallery_tag_map[int(gallery_id)].add(int(tag_id))
    gallery_owner = {}
    for gallery_id, creator_id, character_id in db.query(
        Gallery.id, Gallery.creator_id, Gallery.linked_character_id
    ).filter(Gallery.id.in_(gallery_ids)).all():
        owners = {int(v) for v in (creator_id, character_id) if v}
        gallery_owner[int(gallery_id)] = owners
    for gallery_id, creator_id in db.query(
        gallery_creators.c.gallery_id, gallery_creators.c.creator_id
    ).filter(gallery_creators.c.gallery_id.in_(gallery_ids)).all():
        gallery_owner.setdefault(int(gallery_id), set()).add(int(creator_id))
    for image_id, gallery_id in gallery_by_image.items():
        creator_map[image_id].update(gallery_owner.get(gallery_id, set()))
        tag_map[image_id].update(gallery_tag_map.get(gallery_id, set()))
    return tag_map, creator_map


def _coverage(db: Session, start: datetime, event_rows: list[ActivityEvent]) -> dict:
    first_session = db.query(SessionLog.logged_at).order_by(SessionLog.logged_at.asc()).first()
    first_event = db.query(ActivityEvent.logged_at).order_by(ActivityEvent.logged_at.asc()).first()
    first_action = db.query(XPEvent.earned_at).filter(
        XPEvent.reason.in_(("cum_logged", "edge_logged"))
    ).order_by(XPEvent.earned_at.asc()).first()
    event_since = first_event[0] if first_event else None
    action_since = first_action[0] if first_action else None
    return {
        "session_tracking_since": _iso(first_session[0] if first_session else None),
        "event_tracking_since": _iso(event_since),
        "action_tracking_since": _iso(action_since),
        "event_window_complete": bool(event_since and event_since <= start),
        "action_window_complete": bool(action_since and action_since <= start),
        "has_session_history": bool(first_session),
        "has_event_history": bool(event_rows or first_event),
        "limitations": [
            "Viewing, tag, novelty, and attributed edge history begins with the ActivityEvent ledger; earlier lifetime counters have no timestamps.",
            "Device intensity, SPM, continuous-viewing intervals, and per-session edge/finish attribution are not persisted.",
            "Multi-panel SessionLog rows sharing one timestamp are treated as one logical session.",
            "Historical timestamps have no stored timezone and are interpreted exactly as persisted.",
        ],
        "availability": {
            "session_duration": True,
            "viewing_time": bool(first_event),
            "tag_and_creator_event_trends": bool(first_event),
            "novelty": bool(first_event),
            "global_finishes_and_edges": bool(first_action),
            "per_session_edges_and_finishes": False,
            "device_intensity_and_spm": False,
        },
    }


def dashboard(
    db: Session,
    range_name: str = "30d",
    aggregation: str = "daily",
    metric: str = "sessions",
    creator_ids_raw: str | None = None,
    tag_ids_raw: str | None = None,
    now: datetime | None = None,
) -> dict:
    if aggregation not in AGGREGATIONS:
        raise ValueError("aggregation must be one of: daily, weekly, monthly")
    if metric not in METRICS:
        raise ValueError("metric must be one of: sessions, session_minutes, finishes, edges, viewing_time")
    creator_filter = _parse_ids(creator_ids_raw)
    tag_filter = _parse_ids(tag_ids_raw)
    start, end = _window(db, range_name, now)

    session_rows = db.query(SessionLog).filter(
        SessionLog.logged_at >= start, SessionLog.logged_at <= end
    ).order_by(SessionLog.logged_at.asc(), SessionLog.id.asc()).all()
    sessions = _logical_sessions(session_rows)
    event_rows = db.query(ActivityEvent).filter(
        ActivityEvent.logged_at >= start, ActivityEvent.logged_at <= end
    ).order_by(ActivityEvent.logged_at.asc(), ActivityEvent.id.asc()).all()
    xp_rows = db.query(XPEvent).filter(
        XPEvent.earned_at >= start,
        XPEvent.earned_at <= end,
        XPEvent.reason.in_(("cum_logged", "edge_logged")),
    ).order_by(XPEvent.earned_at.asc()).all()

    keys = _period_keys(start, end, aggregation)
    points = {key: {
        "period": key, "sessions": 0, "session_seconds": 0,
        "session_minutes": 0.0, "finishes": 0, "edges": 0,
        "viewing_seconds": 0, "viewing_minutes": 0.0,
        "underlying_sessions": [],
    } for key in keys}
    for item in sessions:
        point = points[_period_key(item["logged_at"], aggregation)]
        point["sessions"] += 1
        point["session_seconds"] += item["duration_sec"]
        point["underlying_sessions"].append({
            "id": item["id"], "row_ids": item["row_ids"],
            "logged_at": _iso(item["logged_at"]),
            "duration_sec": item["duration_sec"],
        })
    for row in xp_rows:
        point = points[_period_key(row.earned_at, aggregation)]
        point["finishes" if row.reason == "cum_logged" else "edges"] += 1
    for row in event_rows:
        if row.kind == "seconds":
            points[_period_key(row.logged_at, aggregation)]["viewing_seconds"] += max(0, int(row.amount or 0))
    for point in points.values():
        point["session_minutes"] = round(point["session_seconds"] / 60, 2)
        point["viewing_minutes"] = round(point["viewing_seconds"] / 60, 2)
    activity = list(points.values())

    # Every logical session stays visible; the rolling line uses the previous
    # seven session days (including zero-session days) to preserve calendar time.
    duration_by_day = defaultdict(list)
    for item in sessions:
        duration_by_day[item["logged_at"].date().isoformat()].append(item["duration_sec"])
    duration_days = _period_keys(start, end, "daily")
    daily_averages = [
        (sum(duration_by_day[key]) / len(duration_by_day[key])) if duration_by_day[key] else 0
        for key in duration_days
    ]
    rolling_days = {}
    for index, key in enumerate(duration_days):
        window_values = [
            duration
            for day in duration_days[max(0, index - 6):index + 1]
            for duration in duration_by_day[day]
        ]
        rolling_days[key] = round(sum(window_values) / len(window_values), 2) if window_values else 0
    duration_series = [{
        "id": item["id"], "row_ids": item["row_ids"], "logged_at": _iso(item["logged_at"]),
        "duration_sec": item["duration_sec"],
        "rolling_average_sec": rolling_days[item["logged_at"].date().isoformat()],
    } for item in sessions]

    cumulative = ([{"date": sessions[0]["logged_at"].date().isoformat(),
                    "session_id": None, "seconds": 0, "hours": 0.0,
                    "milestones_reached": []}] if sessions else [])
    cumulative_seconds = 0
    reached = set()
    for item in sessions:
        cumulative_seconds += item["duration_sec"]
        newly_reached = []
        for hours in MILESTONE_HOURS:
            if hours not in reached and cumulative_seconds >= hours * 3600:
                reached.add(hours)
                newly_reached.append(hours)
        cumulative.append({
            "date": item["logged_at"].date().isoformat(),
            "session_id": item["id"],
            "seconds": cumulative_seconds,
            "hours": round(cumulative_seconds / 3600, 2),
            "milestones_reached": newly_reached,
        })

    hours = [{"hour": hour, "sessions": 0, "session_seconds": 0,
              "session_minutes": 0.0, "average_duration_sec": 0,
              "viewing_seconds": 0, "viewing_minutes": 0.0} for hour in range(24)]
    for item in sessions:
        cell = hours[item["logged_at"].hour]
        cell["sessions"] += 1
        cell["session_seconds"] += item["duration_sec"]
    for row in event_rows:
        if row.kind == "seconds":
            hours[row.logged_at.hour]["viewing_seconds"] += max(0, int(row.amount or 0))
    for cell in hours:
        cell["session_minutes"] = round(cell["session_seconds"] / 60, 2)
        cell["viewing_minutes"] = round(cell["viewing_seconds"] / 60, 2)
        cell["average_duration_sec"] = round(cell["session_seconds"] / cell["sessions"]) if cell["sessions"] else 0

    heatmap = {(day, hour): {"weekday": day, "weekday_name": WEEKDAYS[day], "hour": hour,
                             "sessions": 0, "session_seconds": 0, "session_minutes": 0.0,
                             "viewing_seconds": 0, "viewing_minutes": 0.0}
               for day in range(7) for hour in range(24)}
    for item in sessions:
        cell = heatmap[(item["logged_at"].weekday(), item["logged_at"].hour)]
        cell["sessions"] += 1
        cell["session_seconds"] += item["duration_sec"]
    for row in event_rows:
        if row.kind == "seconds":
            heatmap[(row.logged_at.weekday(), row.logged_at.hour)]["viewing_seconds"] += max(0, int(row.amount or 0))
    for cell in heatmap.values():
        cell["session_minutes"] = round(cell["session_seconds"] / 60, 2)
        cell["viewing_minutes"] = round(cell["viewing_seconds"] / 60, 2)

    weekdays = [{"weekday": day, "name": WEEKDAYS[day], "sessions": 0,
                 "session_seconds": 0, "session_minutes": 0.0,
                 "average_duration_sec": 0} for day in range(7)]
    for item in sessions:
        cell = weekdays[item["logged_at"].weekday()]
        cell["sessions"] += 1
        cell["session_seconds"] += item["duration_sec"]
    for cell in weekdays:
        cell["session_minutes"] = round(cell["session_seconds"] / 60, 2)
        cell["average_duration_sec"] = round(cell["session_seconds"] / cell["sessions"]) if cell["sessions"] else 0

    buckets = []
    for key, label, lower, upper in DURATION_BUCKETS:
        count = sum(1 for item in sessions if item["duration_sec"] >= lower and
                    (upper is None or item["duration_sec"] < upper))
        buckets.append({"key": key, "label": label, "min_sec": lower,
                        "max_sec": upper, "count": count})

    edge_values = []
    edge_rate_values: list[float | None] = []
    for point in activity:
        edge_values.append(point["edges"])
        point["edges_per_session"] = round(point["edges"] / point["sessions"], 2) if point["sessions"] else None
        point["edges_per_session_hour"] = round(point["edges"] / (point["session_seconds"] / 3600), 2) if point["session_seconds"] else None
        edge_rate_values.append(point["edges_per_session"])
    edge_roll = _rolling(edge_values)
    edge_rate_roll = []
    for index in range(len(edge_rate_values)):
        window = [value for value in edge_rate_values[max(0, index - 6):index + 1] if value is not None]
        edge_rate_roll.append(round(sum(window) / len(window), 2) if window else None)
    edge_trend = [{**point, "rolling_average_edges": edge_roll[index],
                   "rolling_average_edges_per_session": edge_rate_roll[index]}
                  for index, point in enumerate(activity)]

    image_ids = {int(row.image_id) for row in event_rows if row.image_id}
    tag_map, creator_map = _event_entity_maps(db, image_ids)
    creator_names = {int(row.id): row for row in db.query(Creator).all()}
    tag_names = {int(row.id): row for row in db.query(Tag).all()}

    creator_period = defaultdict(lambda: defaultdict(lambda: {"sessions": 0, "session_seconds": 0,
                                                               "files_viewed": set(), "views": 0,
                                                               "viewing_seconds": 0,
                                                               "attributed_edges": 0,
                                                               "attributed_finishes": 0}))
    for item in sessions:
        key = _period_key(item["logged_at"], aggregation)
        for creator_id in item["creator_ids"]:
            entry = creator_period[creator_id][key]
            entry["sessions"] += 1
            entry["session_seconds"] += item["duration_sec"]
    for row in event_rows:
        if not row.image_id:
            continue
        key = _period_key(row.logged_at, aggregation)
        for creator_id in creator_map.get(int(row.image_id), set()):
            entry = creator_period[creator_id][key]
            if row.kind == "view":
                entry["views"] += max(0, int(row.amount or 0))
                entry["files_viewed"].add(int(row.image_id))
            elif row.kind == "seconds":
                entry["viewing_seconds"] += max(0, int(row.amount or 0))
            elif row.kind == "edge":
                entry["attributed_edges"] += max(0, int(row.amount or 0))
            elif row.kind == "cum":
                entry["attributed_finishes"] += max(0, int(row.amount or 0))

    if creator_filter:
        selected_creators = creator_filter
    else:
        ranked = sorted(
            creator_period,
            key=lambda cid: (-sum(v["viewing_seconds"] or v["session_seconds"]
                                 for v in creator_period[cid].values()), cid),
        )
        ranked_characters = [cid for cid in ranked if cid in creator_names and
                             getattr(creator_names[cid].creator_type, "value",
                                     creator_names[cid].creator_type) == "character"]
        selected_creators = set(ranked[:12]) | set(ranked_characters[:12])
    creator_trends = []
    total_view_seconds_by_period = {point["period"]: point["viewing_seconds"] for point in activity}
    for creator_id in sorted(selected_creators):
        creator = creator_names.get(creator_id)
        if not creator:
            continue
        series = []
        for key in keys:
            entry = creator_period[creator_id][key]
            view_seconds = entry["viewing_seconds"]
            total_seconds = total_view_seconds_by_period.get(key, 0)
            series.append({"period": key, "sessions": entry["sessions"],
                           "session_seconds": entry["session_seconds"],
                           "files_viewed": len(entry["files_viewed"]), "views": entry["views"],
                           "viewing_seconds": view_seconds,
                           "attributed_edges": entry["attributed_edges"],
                           "attributed_finishes": entry["attributed_finishes"],
                           "share_of_viewing": round(view_seconds / total_seconds * 100, 2) if total_seconds else 0})
        creator_trends.append({"id": creator_id, "name": creator.name,
                               "creator_type": getattr(creator.creator_type, "value", creator.creator_type),
                               "series": series})

    tag_period = defaultdict(lambda: defaultdict(lambda: {"views": 0, "files": set(), "viewing_seconds": 0,
                                                          "attributed_edges": 0, "attributed_finishes": 0}))
    total_views_by_period = defaultdict(int)
    for row in event_rows:
        if row.kind not in ("view", "seconds", "edge", "cum") or not row.image_id:
            continue
        key = _period_key(row.logged_at, aggregation)
        amount = max(0, int(row.amount or 0))
        if row.kind == "view":
            total_views_by_period[key] += amount
        for tag_id in tag_map.get(int(row.image_id), set()):
            entry = tag_period[tag_id][key]
            if row.kind == "view":
                entry["views"] += amount
                entry["files"].add(int(row.image_id))
            elif row.kind == "seconds":
                entry["viewing_seconds"] += amount
            elif row.kind == "edge":
                entry["attributed_edges"] += amount
            elif row.kind == "cum":
                entry["attributed_finishes"] += amount
    selected_tags = tag_filter or set(sorted(
        tag_period,
        key=lambda tid: (-sum(v["views"] for v in tag_period[tid].values()), tid),
    )[:12])
    tag_trends = []
    for tag_id in sorted(selected_tags):
        tag = tag_names.get(tag_id)
        if not tag:
            continue
        series = []
        for key in keys:
            entry = tag_period[tag_id][key]
            series.append({"period": key, "views": entry["views"],
                           "files_viewed": len(entry["files"]),
                           "viewing_seconds": entry["viewing_seconds"],
                           "attributed_edges": entry["attributed_edges"],
                           "attributed_finishes": entry["attributed_finishes"],
                           "share_of_views": round(entry["views"] / total_views_by_period[key] * 100, 2)
                           if total_views_by_period[key] else 0})
        tag_trends.append({"id": tag_id, "name": tag.name, "category": tag.category,
                           "source": getattr(tag.source, "value", tag.source), "series": series})

    # Novelty is honest only inside the ActivityEvent era. The first recorded
    # view is not necessarily the file's real first-ever view if counters predate it.
    all_views = db.query(ActivityEvent).filter(
        ActivityEvent.kind == "view", ActivityEvent.logged_at <= end,
        ActivityEvent.image_id.isnot(None),
    ).order_by(ActivityEvent.logged_at.asc(), ActivityEvent.id.asc()).all()
    seen = set()
    novelty_by_period = {key: {"period": key, "first_tracked_views": 0, "rewatches": 0,
                               "first_tracked_share": 0.0} for key in keys}
    for row in all_views:
        first = int(row.image_id) not in seen
        seen.add(int(row.image_id))
        if row.logged_at < start:
            continue
        entry = novelty_by_period[_period_key(row.logged_at, aggregation)]
        entry["first_tracked_views" if first else "rewatches"] += max(1, int(row.amount or 1))
    for entry in novelty_by_period.values():
        total = entry["first_tracked_views"] + entry["rewatches"]
        entry["first_tracked_share"] = round(entry["first_tracked_views"] / total * 100, 2) if total else 0

    top_n = []
    for key in keys:
        ranked_entities = sorted(
            ((cid, data[key]["viewing_seconds"] or data[key]["session_seconds"])
             for cid, data in creator_period.items()), key=lambda pair: (-pair[1], pair[0]))
        ranked_creators = [
            (cid, value) for cid, value in ranked_entities
            if cid in creator_names and getattr(creator_names[cid].creator_type, "value",
                                                creator_names[cid].creator_type) != "character"
        ][:5]
        ranked_tags = sorted(
            ((tid, data[key]["views"]) for tid, data in tag_period.items()),
            key=lambda pair: (-pair[1], pair[0]))[:5]
        ranked_characters = [(cid, value) for cid, value in ranked_entities
                             if cid in creator_names and getattr(creator_names[cid].creator_type, "value",
                                                                 creator_names[cid].creator_type) == "character"][:5]
        franchise_values = defaultdict(int)
        for creator_id, data in creator_period.items():
            creator = creator_names.get(creator_id)
            if creator and creator.series:
                franchise_values[creator.series] += data[key]["viewing_seconds"] or data[key]["session_seconds"]
        ranked_franchises = sorted(franchise_values.items(), key=lambda pair: (-pair[1], pair[0]))[:5]
        top_n.append({
            "period": key,
            "creators": [{"id": cid, "name": creator_names[cid].name, "value": value}
                         for cid, value in ranked_creators if value and cid in creator_names],
            "tags": [{"id": tid, "name": tag_names[tid].name, "value": value}
                     for tid, value in ranked_tags if value and tid in tag_names],
            "characters": [{"id": cid, "name": creator_names[cid].name, "value": value}
                           for cid, value in ranked_characters if value],
            "franchises": [{"name": name, "value": value}
                           for name, value in ranked_franchises if value],
        })

    records = []
    record_specs = (
        ("longest_session", "Longest session", lambda item: item["duration_sec"], "seconds"),
        ("highest_session_xp", "Most XP in one session", lambda item: item["xp_earned"], "xp"),
        ("most_creators", "Most creators in one session", lambda item: len(item["creator_ids"]), "creators"),
        ("most_galleries", "Most galleries in one session", lambda item: len(item["gallery_ids"]), "galleries"),
        ("most_files", "Most files in one session", lambda item: len(item["image_ids"]), "files"),
    )
    for key, title, getter, unit in record_specs:
        candidates = [(getter(item), item) for item in sessions]
        value, winner = max(candidates, key=lambda pair: (pair[0], pair[1]["logged_at"])) if candidates else (0, None)
        if winner is not None and value > 0:
            records.append({"record": key, "title": title, "logged_at": _iso(winner["logged_at"]),
                            "session_id": winner["id"], "value": value, "unit": unit})

    total_duration = sum(item["duration_sec"] for item in sessions)
    selected_metric = {
        "sessions": "sessions", "session_minutes": "session_minutes",
        "finishes": "finishes", "edges": "edges", "viewing_time": "viewing_minutes",
        "viewing_minutes": "viewing_minutes",
    }.get(metric, "sessions")
    comparison = None
    previous_values = [None] * len(activity)
    if RANGES[range_name] is not None:
        span = end - start
        previous_end = start - timedelta(microseconds=1)
        previous_start = previous_end - span
        previous_sessions = _logical_sessions(db.query(SessionLog).filter(
            SessionLog.logged_at >= previous_start, SessionLog.logged_at <= previous_end).all())
        previous_xp = db.query(XPEvent).filter(
            XPEvent.earned_at >= previous_start, XPEvent.earned_at <= previous_end,
            XPEvent.reason.in_(("cum_logged", "edge_logged"))).all()
        previous_events = db.query(ActivityEvent).filter(
            ActivityEvent.logged_at >= previous_start, ActivityEvent.logged_at <= previous_end,
            ActivityEvent.kind == "seconds").all()
        previous_duration = sum(item["duration_sec"] for item in previous_sessions)
        comparison = {
            "start": _iso(previous_start), "end": _iso(previous_end),
            "sessions": len(previous_sessions), "session_seconds": previous_duration,
            "session_xp": sum(item["xp_earned"] for item in previous_sessions),
            "finishes": sum(1 for row in previous_xp if row.reason == "cum_logged"),
            "edges": sum(1 for row in previous_xp if row.reason == "edge_logged"),
            "viewing_seconds": sum(max(0, int(row.amount or 0)) for row in previous_events),
        }
        previous_keys = _period_keys(previous_start, previous_end, aggregation)
        previous_points = {
            key: {"sessions": 0, "session_minutes": 0.0, "finishes": 0,
                  "edges": 0, "viewing_minutes": 0.0}
            for key in previous_keys
        }
        previous_session_seconds = defaultdict(int)
        for item in previous_sessions:
            key = _period_key(item["logged_at"], aggregation)
            if key in previous_points:
                previous_points[key]["sessions"] += 1
                previous_session_seconds[key] += item["duration_sec"]
        for row in previous_xp:
            key = _period_key(row.earned_at, aggregation)
            if key in previous_points:
                previous_points[key]["finishes" if row.reason == "cum_logged" else "edges"] += 1
        previous_viewing_seconds = defaultdict(int)
        for row in previous_events:
            key = _period_key(row.logged_at, aggregation)
            if key in previous_points:
                previous_viewing_seconds[key] += max(0, int(row.amount or 0))
        for key, point in previous_points.items():
            point["session_minutes"] = round(previous_session_seconds[key] / 60, 2)
            point["viewing_minutes"] = round(previous_viewing_seconds[key] / 60, 2)
        previous_values = [previous_points[key][selected_metric]
                           for key in previous_keys[:len(activity)]]
        previous_values.extend([None] * (len(activity) - len(previous_values)))
    selected_values = [point[selected_metric] for point in activity]
    selected_rolling = _rolling(selected_values)
    return {
        "meta": {"range": range_name, "aggregation": aggregation, "metric": selected_metric,
                 "start": _iso(start), "end": _iso(end), "timezone": "persisted_naive",
                 **_coverage(db, start, event_rows)},
        "summary": {"sessions": len(sessions), "session_seconds": total_duration,
                    "session_hours": round(total_duration / 3600, 2),
                    "session_xp": sum(item["xp_earned"] for item in sessions),
                    "average_duration_sec": round(total_duration / len(sessions)) if sessions else 0,
                    "longest_duration_sec": max((item["duration_sec"] for item in sessions), default=0),
                    "finishes": sum(1 for row in xp_rows if row.reason == "cum_logged"),
                    "edges": sum(1 for row in xp_rows if row.reason == "edge_logged"),
                    "edges_per_orgasm": round(
                        sum(1 for row in xp_rows if row.reason == "edge_logged") /
                        sum(1 for row in xp_rows if row.reason == "cum_logged"), 2
                    ) if any(row.reason == "cum_logged" for row in xp_rows) else None,
                    "viewing_seconds": sum(max(0, int(row.amount or 0)) for row in event_rows if row.kind == "seconds")},
        "previous_period": comparison,
        "activity": activity,
        "selected_activity": [{"period": point["period"], "value": point[selected_metric],
                                "rolling_average": selected_rolling[index],
                                "previous_value": previous_values[index],
                                "underlying_sessions": point["underlying_sessions"]}
                               for index, point in enumerate(activity)],
        "session_duration": {"sessions": duration_series,
                             "daily_average": [{"date": key, "average_duration_sec": round(value, 2),
                                                "rolling_average_sec": rolling_days[key]}
                                               for key, value in zip(duration_days, daily_averages)]},
        "cumulative_lifetime_hours": {"points": cumulative, "milestones": list(MILESTONE_HOURS)},
        "time_of_day": hours,
        "day_hour_heatmap": list(heatmap.values()),
        "weekday_breakdown": weekdays,
        "duration_buckets": buckets,
        "edge_trend": edge_trend,
        "preferences": {"creators": creator_trends,
                        "characters": [row for row in creator_trends if row["creator_type"] == "character"],
                        "tags": tag_trends, "novelty": list(novelty_by_period.values()),
                        "top_n": top_n},
        "records": {"personal_bests": records, "timeline": records,
                    "unsupported": ["most_edges_per_session", "highest_average_spm", "highest_peak_spm",
                                    "most_files_per_session", "longest_continuous_viewing"]},
        "session_intensity": {"supported": False, "series": [],
                              "reason": "Device intensity and SPM samples are not persisted."},
    }


def compare_sessions(db: Session, session_ids_raw: str) -> dict:
    ids = _parse_ids(session_ids_raw)
    if not ids:
        raise ValueError("session_ids must contain at least one id")
    requested = db.query(SessionLog).filter(SessionLog.id.in_(ids)).order_by(SessionLog.logged_at.asc()).all()
    stamps = {row.logged_at for row in requested}
    all_rows = db.query(SessionLog).filter(SessionLog.logged_at.in_(stamps)).all() if stamps else []
    logical = _logical_sessions(all_rows)
    creators = {row.id: row.name for row in db.query(Creator).all()}
    galleries = {row.id: row.name for row in db.query(Gallery).all()}
    images = {row.id: row.filename for row in db.query(Image).all()}
    return {
        "sessions": [{
            "id": item["id"], "row_ids": item["row_ids"], "logged_at": _iso(item["logged_at"]),
            "duration_sec": item["duration_sec"], "xp_earned": item["xp_earned"],
            "creators": [{"id": value, "name": creators.get(value)} for value in item["creator_ids"]],
            "galleries": [{"id": value, "name": galleries.get(value)} for value in item["gallery_ids"]],
            "images": [{"id": value, "name": images.get(value)} for value in item["image_ids"]],
            "edges": None, "finishes": None, "viewing_seconds": None,
            "average_spm": None, "peak_spm": None, "device_intensity": None,
        } for item in logical],
        "not_found": sorted(ids - {int(row.id) for row in requested}),
        "unsupported": ["per_session_edges", "per_session_finishes", "per_session_viewing_time",
                        "average_spm", "peak_spm", "device_intensity"],
    }


def annual_wrapped(db: Session, year: int) -> dict:
    if year < 1970 or year > 9999:
        raise ValueError("year must be between 1970 and 9999")
    start = datetime(year, 1, 1)
    end = datetime(year + 1, 1, 1) - timedelta(microseconds=1)
    data = dashboard(db, "all", "monthly", now=end)
    # The all-time dashboard can begin before the requested year, so trim its
    # raw sources by rebuilding a bounded annual view through local filtering.
    rows = db.query(SessionLog).filter(SessionLog.logged_at >= start, SessionLog.logged_at <= end).all()
    sessions = _logical_sessions(rows)
    events = db.query(ActivityEvent).filter(ActivityEvent.logged_at >= start,
                                             ActivityEvent.logged_at <= end).all()
    xp = db.query(XPEvent).filter(XPEvent.earned_at >= start, XPEvent.earned_at <= end,
                                  XPEvent.reason.in_(("cum_logged", "edge_logged"))).all()
    creator_seconds = defaultdict(int)
    creator_sessions = defaultdict(int)
    for item in sessions:
        for creator_id in item["creator_ids"]:
            creator_seconds[creator_id] += item["duration_sec"]
            creator_sessions[creator_id] += 1
    creators = {row.id: row for row in db.query(Creator).all()}
    creator_candidates = {
        cid: seconds for cid, seconds in creator_seconds.items()
        if cid in creators and getattr(creators[cid].creator_type, "value", creators[cid].creator_type) != "character"
    }
    top_creator_id = max(creator_candidates, key=lambda cid: (creator_candidates[cid], -cid)) if creator_candidates else None
    characters = {cid: value for cid, value in creator_seconds.items()
                  if cid in creators and getattr(creators[cid].creator_type, "value", creators[cid].creator_type) == "character"}
    top_character_id = max(characters, key=lambda cid: (characters[cid], -cid)) if characters else None
    franchises = defaultdict(int)
    for creator_id, seconds in creator_seconds.items():
        creator = creators.get(creator_id)
        if creator and creator.series:
            franchises[creator.series] += seconds
    top_franchise = max(franchises, key=lambda name: (franchises[name], name)) if franchises else None

    image_ids = {int(row.image_id) for row in events if row.image_id}
    tag_map, _ = _event_entity_maps(db, image_ids)
    tag_views = defaultdict(int)
    for row in events:
        if row.kind == "view" and row.image_id:
            for tag_id in tag_map.get(int(row.image_id), set()):
                tag_views[tag_id] += max(0, int(row.amount or 0))
    tags = {row.id: row.name for row in db.query(Tag).all()}
    top_tags = sorted(tag_views, key=lambda tag_id: (-tag_views[tag_id], tag_id))[:5]

    month_seconds = defaultdict(int)
    weekday_count = [0] * 7
    hour_count = [0] * 24
    for item in sessions:
        month_seconds[item["logged_at"].month] += item["duration_sec"]
        weekday_count[item["logged_at"].weekday()] += 1
        hour_count[item["logged_at"].hour] += 1
    total_seconds = sum(item["duration_sec"] for item in sessions)

    first_sessions = dict(db.query(SessionLog.creator_id, func.min(SessionLog.logged_at))
                          .filter(SessionLog.creator_id.isnot(None)).group_by(SessionLog.creator_id).all())
    newcomers = [cid for cid in creator_seconds if first_sessions.get(cid) and
                 start <= first_sessions[cid] <= end]
    biggest_new = max(newcomers, key=lambda cid: creator_seconds[cid]) if newcomers else None
    prior_ids = {row[0] for row in db.query(SessionLog.creator_id).filter(
        SessionLog.creator_id.isnot(None), SessionLog.logged_at < start).distinct().all()}
    persistent = [cid for cid in creator_seconds if cid in prior_ids]
    persistent_id = max(persistent, key=lambda cid: creator_seconds[cid]) if persistent else None

    # Reuse the same tracked-first definition, scoped to this year.
    all_views = db.query(ActivityEvent).filter(ActivityEvent.kind == "view",
                                                ActivityEvent.logged_at <= end,
                                                ActivityEvent.image_id.isnot(None)).order_by(
        ActivityEvent.logged_at.asc(), ActivityEvent.id.asc()).all()
    seen, first_count, rewatch_count = set(), 0, 0
    for row in all_views:
        first = int(row.image_id) not in seen
        seen.add(int(row.image_id))
        if row.logged_at < start:
            continue
        amount = max(1, int(row.amount or 1))
        if first:
            first_count += amount
        else:
            rewatch_count += amount

    previous_rows = _logical_sessions(db.query(SessionLog).filter(
        SessionLog.logged_at >= datetime(year - 1, 1, 1), SessionLog.logged_at < start).all())
    previous_seconds = sum(item["duration_sec"] for item in previous_rows)
    event_since = db.query(ActivityEvent.logged_at).order_by(ActivityEvent.logged_at.asc()).first()
    return {
        "year": year,
        "summary": {"sessions": len(sessions), "session_seconds": total_seconds,
                    "session_hours": round(total_seconds / 3600, 2),
                    "average_duration_sec": round(total_seconds / len(sessions)) if sessions else 0,
                    "longest_duration_sec": max((item["duration_sec"] for item in sessions), default=0),
                    "finishes": sum(1 for row in xp if row.reason == "cum_logged"),
                    "edges": sum(1 for row in xp if row.reason == "edge_logged")},
        "most_active_month": max(month_seconds, key=lambda month: month_seconds[month]) if month_seconds else None,
        "most_active_weekday": WEEKDAYS[weekday_count.index(max(weekday_count))] if any(weekday_count) else None,
        "peak_hour": hour_count.index(max(hour_count)) if any(hour_count) else None,
        "top_creator": ({"id": top_creator_id, "name": creators[top_creator_id].name,
                         "session_seconds": creator_seconds[top_creator_id],
                         "sessions": creator_sessions[top_creator_id]} if top_creator_id else None),
        "top_character": ({"id": top_character_id, "name": creators[top_character_id].name,
                           "session_seconds": creator_seconds[top_character_id]} if top_character_id else None),
        "top_franchise": ({"name": top_franchise, "session_seconds": franchises[top_franchise]}
                           if top_franchise else None),
        "top_tags": [{"id": tag_id, "name": tags.get(tag_id), "views": tag_views[tag_id]}
                     for tag_id in top_tags],
        "biggest_new_obsession": ({"id": biggest_new, "name": creators[biggest_new].name,
                                    "session_seconds": creator_seconds[biggest_new]} if biggest_new else None),
        "most_persistent_favorite": ({"id": persistent_id, "name": creators[persistent_id].name,
                                      "session_seconds": creator_seconds[persistent_id]} if persistent_id else None),
        "novelty": {"first_tracked_views": first_count, "rewatches": rewatch_count,
                    "tracking_since": _iso(event_since[0] if event_since else None)},
        "previous_year": {"year": year - 1, "sessions": len(previous_rows),
                          "session_seconds": previous_seconds,
                          "session_change_percent": round((len(sessions) - len(previous_rows)) / len(previous_rows) * 100, 2)
                          if previous_rows else None,
                          "time_change_percent": round((total_seconds - previous_seconds) / previous_seconds * 100, 2)
                          if previous_seconds else None},
        "records_broken": [row for row in data["records"]["timeline"]
                           if str(row["logged_at"]).startswith(str(year))],
        "device_telemetry": {"supported": False, "reason": "Device intensity and SPM samples are not persisted."},
        "limitations": _coverage(db, start, events)["limitations"],
    }

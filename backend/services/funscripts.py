"""First-class funscript indexing and playback helpers.

The funscript files themselves remain authoritative.  This module only keeps a
small, deterministic SQLite index so the collection can be searched and sorted
without parsing every file on every request.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import statistics
from datetime import datetime
from typing import Any, Dict, Iterable, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from database import _read_config
from models import Funscript, FunscriptPlaylist, FunscriptPlaylistEntry, Image, Tag, funscript_tags

ANALYSIS_VERSION = "3"
# These are the public EroScripts/funlib analysis thresholds.  They are not
# physical device units: positions are normalized to 0-100 and speed is the
# position change per second.  EroScripts suppresses peak transitions shorter
# than 50 ms when selecting Max Speed and ignores zig-zag movement at or below
# 30 position points for Avg Speed.
EROSCRIPTS_MIN_PEAK_DURATION_MS = 50
EROSCRIPTS_MIN_AVERAGE_SPEED = 30.0
AXIS_SUFFIXES = {
    "surge": "L1", "sway": "L2", "twist": "R0", "roll": "R1", "pitch": "R2",
}
SYSTEM_VIBRATOR_TAG = "vibrator compatible"
SYSTEM_MULTI_AXIS_TAG = "multi axis"


def _is_vibrator_axis(axis: Any) -> bool:
    """Only explicit vibration axes qualify; L0 is the linear stroke axis."""
    normalized = str(axis or "").strip().upper().replace("_", "").replace("-", "")
    return normalized.startswith("VIB") or normalized in {"V0", "V1", "V2"}


def _read_json(path: str) -> Optional[dict]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            value = json.load(handle)
        return value if isinstance(value, dict) else None
    except (OSError, ValueError, TypeError):
        return None


def _normalise_actions(raw: Any) -> list[dict]:
    """Match funlib's normalize: round, sort, then keep the first timestamp."""
    actions: list[dict] = []
    if not isinstance(raw, list):
        return []
    for item in raw:
        if not isinstance(item, dict):
            continue
        try:
            at = round(float(item.get("at")))
            pos = round(float(item.get("pos")))
        except (TypeError, ValueError):
            continue
        if at < 0 or not math.isfinite(pos):
            continue
        actions.append({"at": int(at), "pos": max(0.0, min(100.0, pos))})
    actions.sort(key=lambda action: action["at"])
    return [
        action for index, action in enumerate(actions)
        if index == 0 or actions[index - 1]["at"] < action["at"]
    ]


def _axis_items(container: Any) -> Iterable[Tuple[str, Any]]:
    if isinstance(container, list):
        for axis in container:
            if not isinstance(axis, dict):
                continue
            axis_id = axis.get("id") or axis.get("axis") or axis.get("name")
            actions = axis.get("actions") or axis.get("data")
            if axis_id and isinstance(actions, list):
                yield str(axis_id).upper(), actions
    elif isinstance(container, dict):
        for axis_id, value in container.items():
            actions = value.get("actions") if isinstance(value, dict) else value
            if isinstance(actions, list):
                yield str(axis_id).upper(), actions


def collect_axes(path: str) -> tuple[dict[str, list[dict]], Optional[dict]]:
    """Collect main, embedded and sibling tracks using the existing axis IDs."""
    main_path = os.path.abspath(path)
    main = _read_json(main_path)
    if main is None:
        return {}, None
    axes: dict[str, list[dict]] = {}
    if isinstance(main.get("actions"), list):
        axes["L0"] = _normalise_actions(main["actions"])
    for key in ("axes", "channels", "tracks"):
        for axis_id, actions in _axis_items(main.get(key)):
            axes[axis_id] = _normalise_actions(actions)

    base = main_path[:-len(".funscript")] if main_path.lower().endswith(".funscript") else os.path.splitext(main_path)[0]
    # If the indexed path itself is a sibling axis, also look for the bare main.
    for suffix, axis_id in AXIS_SUFFIXES.items():
        marker = "." + suffix
        if base.lower().endswith(marker):
            base = base[:-len(marker)]
            break
    for suffix, axis_id in AXIS_SUFFIXES.items():
        sibling = f"{base}.{suffix}.funscript"
        if os.path.isfile(sibling):
            data = _read_json(sibling)
            if data and isinstance(data.get("actions"), list):
                axes[axis_id] = _normalise_actions(data["actions"])
    bare = f"{base}.funscript"
    if os.path.isfile(bare) and os.path.abspath(bare) != main_path:
        data = _read_json(bare)
        if data and isinstance(data.get("actions"), list):
            axes.setdefault("L0", _normalise_actions(data["actions"]))
    axes = {key: value for key, value in axes.items() if value}
    return axes, main


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = (len(ordered) - 1) * percentile
    low, high = math.floor(index), math.ceil(index)
    if low == high:
        return float(ordered[low])
    return float(ordered[low] + (ordered[high] - ordered[low]) * (index - low))


def _downsample_waveform(actions: list[dict], samples: int = 64) -> list[float]:
    """Return a real timeline waveform as 64 normalized 0-100 positions."""
    if not actions:
        return []
    if len(actions) == 1 or actions[-1]["at"] <= actions[0]["at"]:
        return [round(float(actions[0]["pos"]), 3)] * samples
    start = float(actions[0]["at"])
    end = float(actions[-1]["at"])
    result = []
    cursor = 0
    for index in range(samples):
        target = start + (end - start) * index / (samples - 1)
        while cursor + 1 < len(actions) and actions[cursor + 1]["at"] <= target:
            cursor += 1
        if cursor + 1 >= len(actions):
            position = actions[-1]["pos"]
        else:
            left, right = actions[cursor], actions[cursor + 1]
            span = float(right["at"] - left["at"])
            ratio = (target - left["at"]) / span if span > 0 else 0.0
            position = left["pos"] + (right["pos"] - left["pos"]) * ratio
        result.append(round(max(0.0, min(100.0, float(position))), 3))
    return result


def _speed_between(previous: Optional[dict], current: Optional[dict]) -> float:
    """Match EroScripts' normalized position-per-second speed calculation."""
    if not previous or not current:
        return 0.0
    delta_ms = current["at"] - previous["at"]
    if delta_ms <= 0:
        return 0.0
    return (current["pos"] - previous["pos"]) / delta_ms * 1000.0


def _sign(value: float) -> int:
    return 1 if value > 0 else -1 if value < 0 else 0


def _is_peak(actions: list[dict], index: int) -> int:
    """Return EroScripts' peak/valley marker: 1, -1, or 0."""
    action = actions[index]
    previous = actions[index - 1] if index > 0 else None
    following = actions[index + 1] if index + 1 < len(actions) else None
    if previous is None and following is None:
        return 1
    if previous is None:
        return 1
    if following is None:
        return -1
    speed_to = _speed_between(previous, action)
    speed_from = _speed_between(action, following)
    if _sign(speed_to) == _sign(speed_from):
        return 0
    if speed_to > speed_from:
        return 1
    if speed_to < speed_from:
        return -1
    return 0


def _zigzag_actions(actions: list[dict]) -> list[dict]:
    return [action for index, action in enumerate(actions) if _is_peak(actions, index) != 0]


def _eroscripts_average_speed(actions: list[dict]) -> float:
    """Port actionsAverageSpeed from EroScripts' public funlib."""
    zigzag = _zigzag_actions(actions)
    fast = [
        action for index, action in enumerate(zigzag)
        if index > 0 and abs(_speed_between(zigzag[index - 1], action)) > EROSCRIPTS_MIN_AVERAGE_SPEED
    ]
    numerator = 0.0
    denominator = 0.0
    for index, action in enumerate(fast):
        next_action = fast[index + 1] if index + 1 < len(fast) else None
        next_duration = (next_action["at"] - action["at"]) if next_action else 0
        speed_to = abs(_speed_between(fast[index - 1], action)) if index > 0 else 0.0
        numerator += speed_to * next_duration
        denominator += next_duration
    return numerator / (denominator or 1.0)


def _eroscripts_required_max_speed(actions: list[dict]) -> float:
    """Port actionsRequiredMaxSpeed from EroScripts' public funlib."""
    if len(actions) < 2:
        return 0.0
    required: list[tuple[float, int]] = []
    next_peak_index = 0
    for index, action in enumerate(actions):
        if next_peak_index == index:
            next_peak_index = next((
                candidate for candidate in range(index + 1, len(actions))
                if _is_peak(actions, candidate) != 0
            ), -1)
            if next_peak_index == -1:
                break
        next_peak = actions[next_peak_index]
        required.append((abs(_speed_between(action, next_peak)), next_peak["at"] - action["at"]))
    for speed, duration in sorted(required, key=lambda item: item[0], reverse=True):
        if duration >= EROSCRIPTS_MIN_PEAK_DURATION_MS:
            return speed
    return 0.0


def _metrics(axes: dict[str, list[dict]]) -> dict:
    actions = axes.get("L0") or next(iter(axes.values()), [])
    duration = (actions[-1]["at"] / 1000.0) if actions else 0.0
    distances = []
    speeds = []
    intervals = []
    positions = [float(item["pos"]) for item in actions]
    active_time = 0.0
    pause_count = 0
    longest_pause = 0.0
    for previous, current in zip(actions, actions[1:]):
        dt = max(0.0, (current["at"] - previous["at"]) / 1000.0)
        distance = abs(current["pos"] - previous["pos"])
        intervals.append(dt)
        distances.append(distance)
        if dt > 0:
            speeds.append(distance / dt)
            # A large timestamp gap is a pause even if its endpoints differ.
            # Keep the interval in speed statistics, but don't call all of that
            # elapsed time active movement.
            if distance > 0 and dt <= 2.0:
                active_time += dt
            if dt > 2.0:
                pause_count += 1
                longest_pause = max(longest_pause, dt)
    total_time = sum(intervals)
    # Time-weighted focus is calculated over timeline segments, not just action
    # count, so a long held position is represented honestly.
    high_time = low_time = 0.0
    for previous, current in zip(actions, actions[1:]):
        dt = max(0.0, (current["at"] - previous["at"]) / 1000.0)
        if previous["pos"] >= 75:
            high_time += dt
        if previous["pos"] <= 25:
            low_time += dt
    peak_actions = _zigzag_actions(actions)
    avg_speed = _eroscripts_average_speed(actions)
    active_ratio = (active_time / total_time) if total_time else 0.0
    # Keep the Vault's intensity score separate from the EroScripts display
    # metrics; it remains a normalized ordering aid for our own filters.
    intensity = max(0.0, min(100.0, avg_speed * active_ratio))
    return {
        "duration": duration,
        "action_count": len(peak_actions),
        "actions_per_min": (len(peak_actions) / duration * 60.0) if duration else 0.0,
        "avg_speed": avg_speed,
        "p95_speed": _percentile(speeds, 0.95),
        "max_speed": _eroscripts_required_max_speed(actions),
        "avg_movement_distance": (sum(distances) / len(distances)) if distances else 0.0,
        "movement_range": (max(positions) - min(positions)) if positions else 0.0,
        "avg_position": statistics.fmean(positions) if positions else 0.0,
        "active_ratio": active_ratio,
        "pause_count": pause_count,
        "longest_pause": longest_pause,
        "high_focus": (high_time / total_time) if total_time else 0.0,
        "low_focus": (low_time / total_time) if total_time else 0.0,
        "intensity": intensity,
        "axes_json": json.dumps(sorted(axes.keys())),
        "waveform_json": json.dumps(_downsample_waveform(actions)),
        "axis_count": len(axes),
    }


def analyse_path(path: str) -> dict:
    result = {"path": path, "file_mtime": None, "content_hash": None,
              "health_status": "missing", "parse_status": "missing",
              "analysis_error": None, "axes": {}, **_metrics({})}
    if not os.path.isfile(path):
        return result
    try:
        stat = os.stat(path)
        result["file_mtime"] = stat.st_mtime
        with open(path, "rb") as handle:
            result["content_hash"] = hashlib.sha256(handle.read()).hexdigest()
    except OSError as error:
        result["analysis_error"] = str(error)
        return result
    axes, _ = collect_axes(path)
    if not axes:
        result.update(health_status="invalid", parse_status="invalid", analysis_error="No usable actions")
        return result
    result.update(_metrics(axes), axes=axes, health_status="healthy", parse_status="parsed")
    return result


def _apply_analysis(record: Funscript, data: dict) -> None:
    for key in ("file_mtime", "content_hash", "health_status", "parse_status", "analysis_error",
                "duration", "action_count", "actions_per_min", "avg_speed", "p95_speed",
                "max_speed", "avg_movement_distance", "movement_range", "avg_position",
                "active_ratio", "pause_count", "longest_pause", "high_focus", "low_focus",
                "intensity", "axes_json", "waveform_json", "axis_count"):
        setattr(record, key, data.get(key))
    record.analysis_version = ANALYSIS_VERSION


def _canonical_main_path(path: str) -> str:
    """Map a known sibling axis path to its bare script when present."""
    absolute = os.path.abspath(path)
    if not absolute.lower().endswith(".funscript"):
        return absolute
    stem = absolute[:-len(".funscript")]
    lower = stem.lower()
    for suffix in AXIS_SUFFIXES:
        marker = "." + suffix
        if lower.endswith(marker):
            return stem[:-len(marker)] + ".funscript"
    return absolute


def _repository_paths(root: str) -> set[str]:
    """Find main scripts under Settings' central repository.

    A sibling axis is only folded into a main bundle when that bare main file
    exists.  If the bare file is absent, the sibling is retained as a usable
    standalone script rather than silently disappearing.
    """
    found: set[str] = set()
    if not root or not os.path.isdir(root):
        return found
    for directory, _subdirs, filenames in os.walk(root):
        for filename in filenames:
            if not filename.lower().endswith(".funscript"):
                continue
            path = os.path.abspath(os.path.join(directory, filename))
            canonical = _canonical_main_path(path)
            if canonical != path and os.path.isfile(canonical):
                continue
            found.add(path)
    return found


def reindex(db: Session, paths: Optional[Iterable[str]] = None) -> dict:
    links = db.query(Image).filter(Image.funscript_path.isnot(None), Image.funscript_path != "").all()
    by_path: dict[str, Image] = {}
    for image in links:
        raw_path = os.path.abspath(image.funscript_path)
        path = _canonical_main_path(raw_path)
        # Only canonicalize an axis link when the bare main is actually there;
        # otherwise the axis file is a genuine standalone source.
        if path != raw_path and not os.path.isfile(path):
            path = raw_path
        by_path.setdefault(path, image)

    config = _read_config() or {}
    repository_root = (config.get("funscript_library_path") or "").strip()
    candidates = set(by_path)
    candidates.update(_repository_paths(repository_root))
    if paths is not None:
        requested = {_canonical_main_path(path) for path in paths}
        candidates = {path for path in candidates if path in requested}
    records = {os.path.abspath(row.path): row for row in db.query(Funscript).all()}
    if paths is None:
        # Preserve previously indexed repository scripts even if the setting is
        # temporarily unavailable; they will be marked missing by analysis.
        candidates.update(records)
    else:
        candidates.update(path for path in records if path in requested)
    analyzed = 0
    for path in candidates:
        image = by_path.get(path)
        record = records.get(path)
        if record is None:
            record = Funscript(path=path, name=os.path.basename(path), source_image_id=image.id if image else None)
            db.add(record)
            db.flush()
        else:
            record.source_image_id = image.id if image else None
        data = analyse_path(path)
        _apply_analysis(record, data)
        analyzed += 1
    # Keep stale rows visible for repair, but mark them as missing rather than
    # deleting cached favorites, notes, tags or playlists.
    if paths is None:
        for path, record in records.items():
            if path not in candidates and record.health_status != "missing":
                _apply_analysis(record, analyse_path(path))
    db.commit()
    return {"indexed": analyzed, "total": db.query(Funscript).count(),
            "repository": repository_root or None}


def _source_data(record: Funscript) -> Optional[dict]:
    image = record.source_image
    if not image:
        return None
    return {"id": image.id, "filename": image.filename, "file_path": image.file_path,
            "is_video": bool(image.is_video), "duration": image.duration,
            "gallery_id": image.gallery_id, "thumb_path": image.thumb_path}


def serialize(record: Funscript, include_source: bool = True) -> dict:
    manual_tags = [{"id": tag.id, "name": tag.name, "category": tag.category,
                    "source": "manual", "color": tag.color} for tag in record.tags]
    compatibility = []
    axes = []
    try:
        axes = json.loads(record.axes_json or "[]")
    except (ValueError, TypeError):
        axes = []
    if not isinstance(axes, list):
        axes = []
    has_vibrator = any(_is_vibrator_axis(axis) for axis in axes)
    if has_vibrator:
        compatibility.append(SYSTEM_VIBRATOR_TAG)
    if record.axis_count and record.axis_count > 1:
        compatibility.append(SYSTEM_MULTI_AXIS_TAG)
    result = {c.name: getattr(record, c.name) for c in record.__table__.columns}
    try:
        result["axes"] = json.loads(record.axes_json or "[]")
    except (ValueError, TypeError):
        result["axes"] = []
    try:
        result["waveform"] = json.loads(record.waveform_json or "[]")
    except (ValueError, TypeError):
        result["waveform"] = []
    result["waveform_points"] = result["waveform"]
    result["manual_tags"] = manual_tags
    result["compatibility_tags"] = compatibility
    result["tags"] = manual_tags + [{"name": name, "source": "system"} for name in compatibility]
    source = _source_data(record) if include_source else None
    result["source_image"] = source
    # Stable aliases keep the collection UI decoupled from ORM column names.
    result["source_video"] = source
    result["source_image_id"] = record.source_image_id
    result["favorite"] = bool(record.is_favorite)
    result["active_time"] = round(float(record.active_ratio or 0.0) * 100.0, 3)
    result["vibrator_compatible"] = bool(has_vibrator and record.health_status == "healthy")
    result["multi_axis"] = bool(record.axis_count and record.axis_count > 1 and record.health_status == "healthy")
    result["axis_names"] = result["axes"]
    result["health"] = {"healthy": "Ready", "missing": "Unmatched", "invalid": "Needs review"}.get(record.health_status, "Needs review")
    if source and source.get("duration") and record.duration:
        result["coverage"] = round(min(100.0, float(record.duration) / float(source["duration"]) * 100.0), 2)
    else:
        result["coverage"] = None
    return result


def payload(record: Funscript) -> dict:
    if not os.path.isfile(record.path):
        raise FileNotFoundError(record.path)
    axes, main = collect_axes(record.path)
    if not axes:
        raise ValueError("No usable actions")
    return {"id": record.id, "path": record.path, "name": record.name,
            "duration": record.duration, "axes": axes,
            "actions": axes.get("L0") or next(iter(axes.values())),
            "waveform": _downsample_waveform(axes.get("L0") or next(iter(axes.values()))),
            "axis_count": len(axes), "compatibility_tags":
            (([SYSTEM_VIBRATOR_TAG] if any(_is_vibrator_axis(axis) for axis in axes) else []) +
             ([SYSTEM_MULTI_AXIS_TAG] if len(axes) > 1 else [])),
            "source_image_id": record.source_image_id}


def ensure_tag(db: Session, script: Funscript, name: str) -> Tag:
    normalized = name.strip()
    if not normalized:
        raise ValueError("Tag name cannot be empty")
    tag = db.query(Tag).filter(func.lower(Tag.name) == normalized.lower()).first()
    if tag is None:
        tag = Tag(name=normalized, category="funscript", source="manual")
        db.add(tag)
        db.flush()
    if tag not in script.tags:
        script.tags.append(tag)
    return tag


def remove_tag(db: Session, script: Funscript, tag_id: int) -> bool:
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag or tag not in script.tags:
        return False
    script.tags.remove(tag)
    return True


def playlist_dict(playlist: FunscriptPlaylist) -> dict:
    return {"id": playlist.id, "name": playlist.name, "description": playlist.description,
            "created_at": playlist.created_at, "updated_at": playlist.updated_at,
            "script_count": len(playlist.entries),
            "scripts": [serialize(entry.funscript) for entry in playlist.entries]}

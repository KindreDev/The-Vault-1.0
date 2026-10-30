"""Short, silent MP4 clips that video tiles play on hover.

Starting a full player on the original file took about two seconds per hover.
A clip is built once per video (three 2-second moments from the start, middle
and end), cached outside the library, and starts almost at once after that.

Builds run on two background workers, newest request first, so sweeping the
mouse across a grid builds the tile under the pointer before the ones it
passed. A request waits only briefly for its build, so it never ties up one
of the browser's few connections for long.

With the "pre-generate" setting on, one more thread walks every video and
builds the missing clips ahead of time. It runs at low CPU priority, steps
aside while a hover is waiting for its clip, and pauses during scans.
"""
import hashlib
import os
import subprocess
import sys
import threading
import time
from typing import Optional

from database import DATA_DIR
from services.scanner import _NO_WINDOW, _detect_video_crop, _get_ffmpeg_exe

CLIP_DIR = os.path.join(DATA_DIR, "hover_clips")
_MAX_SIDE = 480
_FPS = 30
_SEGMENT = 2.0
_WORKERS = 2
_MAX_PENDING = 8   # tiles the pointer passed long ago are dropped
_BELOW_NORMAL = 0x00004000 if sys.platform == "win32" else 0
CONFIG_KEY = "pregenerate_hover_clips"
AVG_CLIP_BYTES = 200 * 1024   # measured 140-240 KB on real videos

_cond = threading.Condition()
_pending: dict[str, tuple[str, Optional[float], float]] = {}   # out_path -> (source, duration, requested_at)
_building: set[str] = set()
_failed: set[str] = set()
_started = False


def clip_path(file_path: str) -> str:
    """Cache path for a source file. Moving, replacing or re-encoding the
    source changes the name, so a stale clip is never served."""
    stat = os.stat(file_path)
    key = hashlib.sha256(
        f"{os.path.abspath(file_path)}\0{stat.st_size}\0{stat.st_mtime_ns}".encode("utf-8")
    ).hexdigest()[:20]
    return os.path.join(CLIP_DIR, f"{key}.mp4")


def build_clip(file_path: str, out_path: str, duration: Optional[float], low_priority: bool = False) -> bool:
    """Encode the clip with FFmpeg. Writes to a temp file first so a half-built
    clip is never served. Background builds run below normal CPU priority."""
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    ffmpeg = _get_ffmpeg_exe()
    crop = _detect_video_crop(file_path, ffmpeg)   # match the bar-free thumbnails
    if duration and duration >= 3 * _SEGMENT:
        stamps, length = [duration * 0.15, duration * 0.50, duration * 0.82], _SEGMENT
    else:
        stamps, length = [0.0], max(1.0, min(duration or 3.0, 3.0))
    inputs: list[str] = []
    for t in stamps:
        inputs += ["-ss", f"{t:.2f}", "-t", f"{length:.2f}", "-i", file_path]
    shape = (f"{crop + ',' if crop else ''}"
             f"scale={_MAX_SIDE}:{_MAX_SIDE}:force_original_aspect_ratio=decrease:force_divisible_by=2,"
             f"setsar=1,fps={_FPS},setpts=PTS-STARTPTS")
    graph = "".join(f"[{i}:v]{shape}[v{i}];" for i in range(len(stamps)))
    graph += "".join(f"[v{i}]" for i in range(len(stamps))) + f"concat=n={len(stamps)}:v=1[out]"
    tmp = out_path + ".part.mp4"
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", *inputs,
           "-filter_complex", graph, "-map", "[out]", "-an",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "27", "-pix_fmt", "yuv420p",
           "-movflags", "+faststart", tmp]
    try:
        flags = _NO_WINDOW | (_BELOW_NORMAL if low_priority else 0)
        res = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True,
                             timeout=90, creationflags=flags)
        if res.returncode != 0 or not os.path.isfile(tmp) or os.path.getsize(tmp) == 0:
            return False
        os.replace(tmp, out_path)
        return True
    except (subprocess.TimeoutExpired, OSError):
        return False
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


def _worker() -> None:
    while True:
        with _cond:
            while not _pending:
                _cond.wait()
            out_path = max(_pending, key=lambda p: _pending[p][2])
            source, duration, _ = _pending.pop(out_path)
            _building.add(out_path)
        ok = False
        try:
            ok = build_clip(source, out_path, duration)
        except Exception:
            ok = False
        with _cond:
            _building.discard(out_path)
            if not ok:
                _failed.add(out_path)
            _cond.notify_all()


def _ensure_workers() -> None:
    global _started
    if _started:
        return
    _started = True
    for i in range(_WORKERS):
        threading.Thread(target=_worker, name=f"hover-clip-{i}", daemon=True).start()


def get_clip(file_path: str, duration: Optional[float], wait: float = 6.0) -> tuple[Optional[str], str]:
    """Return (path, "ready"), queueing a build if needed and waiting up to
    `wait` seconds for it. Otherwise (None, "building") or (None, "failed");
    the tile keeps its thumbnail either way."""
    out_path = clip_path(file_path)
    if os.path.isfile(out_path):
        return out_path, "ready"
    deadline = time.monotonic() + wait
    with _cond:
        if out_path in _failed:
            return None, "failed"
        _ensure_workers()
        if out_path not in _building:
            _pending[out_path] = (file_path, duration, time.monotonic())
            while len(_pending) > _MAX_PENDING:
                _pending.pop(min(_pending, key=lambda p: _pending[p][2]))
            _cond.notify_all()
        while out_path in _pending or out_path in _building:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None, "building"
            _cond.wait(remaining)
        if out_path in _failed:
            return None, "failed"
    return (out_path, "ready") if os.path.isfile(out_path) else (None, "building")


# ── Pre-generate every clip (optional setting) ───────────────────────────────

_pregen_lock = threading.Lock()
_pregen = {"running": False, "total": 0, "checked": 0, "built": 0, "ready": 0,
           "failed": 0, "skipped": 0, "bytes": 0, "message": "", "finished_at": None}
_pregen_stop = threading.Event()
_pregen_again = False   # something changed mid-pass (e.g. a scan): walk again after


def pregeneration_enabled() -> bool:
    from database import _read_config
    return bool(_read_config().get(CONFIG_KEY, False))


def pregeneration_status() -> dict:
    with _pregen_lock:
        return dict(_pregen, enabled=pregeneration_enabled())


def stop_pregeneration() -> None:
    _pregen_stop.set()


def start_pregeneration() -> bool:
    """Start a pass if the setting is on. Safe to call any time (startup, after
    a scan): a no-op when off; a pass already running walks once more after."""
    global _pregen_again
    if not pregeneration_enabled():
        return False
    with _pregen_lock:
        _pregen_stop.clear()
        if _pregen["running"]:
            _pregen_again = True
            return True
        _pregen.update(running=True, total=0, checked=0, built=0, ready=0, failed=0,
                       skipped=0, bytes=0, message="Starting…")
    threading.Thread(target=_pregen_loop, name="hover-clip-pregen", daemon=True).start()
    return True


def _pregen_loop() -> None:
    global _pregen_again
    try:
        while True:
            _pregen_pass()
            with _pregen_lock:
                if not _pregen_again or _pregen_stop.is_set():
                    break
                _pregen_again = False
    except Exception as exc:
        with _pregen_lock:
            _pregen["message"] = f"Stopped: {exc}"
    finally:
        with _pregen_lock:
            _pregen["running"] = False
            _pregen["finished_at"] = time.time()


def _wait_for_quiet() -> None:
    """Hold off while a scan runs or a hover is waiting for its own clip."""
    from services.scanner import get_scan_state
    while not _pregen_stop.is_set():
        with _cond:
            hover_waiting = bool(_pending)
        if not hover_waiting and not get_scan_state().get("running"):
            return
        _pregen_stop.wait(0.5)


def _pregen_one(file_path: str, duration: Optional[float]) -> tuple[str, int]:
    try:
        out_path = clip_path(file_path)
    except OSError:
        return "skipped", 0          # file missing or drive offline
    with _cond:
        while out_path in _building:  # a hover is already building this one
            _cond.wait(1.0)
        if os.path.isfile(out_path):
            return "ready", os.path.getsize(out_path)
        if out_path in _failed:
            return "failed", 0
        _pending.pop(out_path, None)
        _building.add(out_path)
    ok = False
    try:
        ok = build_clip(file_path, out_path, duration, low_priority=True)
    finally:
        with _cond:
            _building.discard(out_path)
            if not ok:
                _failed.add(out_path)
            _cond.notify_all()
    return ("built", os.path.getsize(out_path)) if ok else ("failed", 0)


def _pregen_pass() -> None:
    from database import SessionLocal
    from models import Image
    db = SessionLocal()
    try:
        # Newest first, so freshly added videos are covered soonest.
        videos = (db.query(Image.file_path, Image.duration)
                  .filter(Image.is_video == True)  # noqa: E712
                  .order_by(Image.id.desc()).all())
    finally:
        db.close()
    with _pregen_lock:
        _pregen.update(total=len(videos), checked=0, built=0, ready=0, failed=0,
                       skipped=0, bytes=0, message="Building hover clips…")
    for file_path, duration in videos:
        _wait_for_quiet()
        if _pregen_stop.is_set():
            with _pregen_lock:
                _pregen["message"] = "Paused"
            return
        state, size = _pregen_one(file_path, duration) if file_path else ("skipped", 0)
        with _pregen_lock:
            _pregen["checked"] += 1
            _pregen[state] += 1
            _pregen["bytes"] += size
    with _pregen_lock:
        _pregen["message"] = "All hover clips are ready"

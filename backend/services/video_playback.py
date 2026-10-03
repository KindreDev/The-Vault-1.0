"""Browser playback support for video containers/codecs the browser cannot decode.

The Vault deliberately indexes more video formats than Chromium/WebView2 can play
directly.  VLC and FFmpeg can decode those formats, so the server creates a
browser-friendly H.264/AAC MP4 in the writable cache directory the first time a
file is opened.  The original media is never modified.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import threading
from pathlib import Path

from database import DATA_DIR
from services.scanner import _get_ffmpeg_exe


# Chromium/WebView2 reliably handles these containers when their codecs are
# conventional.  Everything else goes through FFmpeg.  A forced conversion is
# also available for an MP4/WebM whose codec is unusual (for example HEVC).
BROWSER_NATIVE_EXTENSIONS = {".mp4", ".webm"}

_CACHE_DIR_NAME = "video_cache"
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


class VideoPlaybackError(RuntimeError):
    """Raised when an indexed video cannot be converted for browser playback."""


def needs_browser_conversion(path: str, *, force: bool = False) -> bool:
    """Return whether *path* should be delivered through the transcoder."""
    return force or Path(path).suffix.lower() not in BROWSER_NATIVE_EXTENSIONS


def _cache_path(source_path: str, cache_key: str | int) -> str:
    """Build a cache name that changes when the source file changes."""
    stat = os.stat(source_path)
    fingerprint = hashlib.sha256(
        f"{os.path.abspath(source_path)}\0{stat.st_size}\0{stat.st_mtime_ns}".encode("utf-8")
    ).hexdigest()[:24]
    cache_dir = os.path.join(DATA_DIR, _CACHE_DIR_NAME)
    return os.path.join(cache_dir, f"{cache_key}-{fingerprint}.mp4")


def _lock_for(path: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(path, threading.Lock())


def _remove_stale_caches(cache_path: str, cache_key: str | int) -> None:
    """Best-effort cleanup of older generated files for the same media item."""
    cache_dir = os.path.dirname(cache_path)
    prefix = f"{cache_key}-"
    try:
        for candidate in Path(cache_dir).glob(f"{prefix}*.mp4"):
            if os.path.abspath(str(candidate)) != os.path.abspath(cache_path):
                try:
                    candidate.unlink()
                except OSError:
                    # A previous browser request may still have the old cache
                    # open on Windows.  It is safe to leave it for now.
                    pass
    except OSError:
        pass


def _probe_streams(source_path: str, ffmpeg: str) -> list[dict] | None:
    """Inspect tracks, including unsupported auxiliary tracks in phone videos."""
    ffprobe = str(Path(ffmpeg).with_name("ffprobe.exe" if os.name == "nt" else "ffprobe"))
    try:
        result = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries",
             "stream=index,codec_type,codec_name,pix_fmt", "-of", "json", source_path],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=20,
            creationflags=getattr(subprocess, "DETACHED_PROCESS", 0),
        )
        if result.returncode != 0:
            return None
        return json.loads(result.stdout).get("streams", [])
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired, ValueError):
        return None


def _playback_tracks(streams: list[dict] | None) -> tuple[list[str], bool]:
    """Select the main audio, skipping tracks without a recognized codec.

    iPhone MOVs may contain an additional audio track with no decoder. Mapping
    every audio track makes an otherwise healthy video fail conversion.
    """
    if streams is None:
        return ["-map", "0:a:0?"], False
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"
                  and stream.get("codec_name") not in {None, "", "none", "unknown"}), None)
    audio_map = ["-map", f"0:{audio['index']}"] if audio else []
    remux = bool(
        video
        and video.get("codec_name") == "h264"
        and video.get("pix_fmt") in {"yuv420p", "yuvj420p"}
        and (audio is None or audio.get("codec_name") == "aac")
    )
    return audio_map, remux


def ensure_browser_playback(
    source_path: str,
    cache_key: str | int,
    *,
    force: bool = False,
) -> tuple[str, bool]:
    """Return ``(path, converted)`` for a browser-playable video.

    Native MP4/WebM files are returned directly. Other containers with H.264
    video and AAC audio are remuxed without re-encoding; other codecs are
    converted to H.264/AAC. Both paths write the cache atomically.
    """
    if not needs_browser_conversion(source_path, force=force):
        return source_path, False
    if not os.path.isfile(source_path):
        raise VideoPlaybackError("Video file not found on disk")

    # A browser retry must be able to bypass a remuxed cache if its codec is
    # still rejected, so forced re-encodes get their own cache entry.
    effective_cache_key = f"forced-{cache_key}" if force else cache_key
    cache_path = _cache_path(source_path, effective_cache_key)
    lock = _lock_for(cache_path)
    with lock:
        if os.path.isfile(cache_path) and os.path.getsize(cache_path) > 0:
            return cache_path, True

        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        temp_path = f"{cache_path}.{os.getpid()}.{threading.get_ident()}.tmp"
        try:
            ffmpeg = _get_ffmpeg_exe()
            audio_map, compatible_streams = _playback_tracks(_probe_streams(source_path, ffmpeg))
            remux = not force and compatible_streams
            for copy_streams in ([True, False] if remux else [False]):
                codec_args = (
                    ["-c:v", "copy", "-c:a", "copy"] if copy_streams else [
                        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                        "-c:v", "libx264",
                        "-preset", "fast",
                        "-crf", "21",
                        "-pix_fmt", "yuv420p",
                        "-c:a", "aac",
                        "-b:a", "160k",
                    ]
                )
                result = subprocess.run([
                    ffmpeg,
                    "-hide_banner",
                    "-loglevel", "error",
                    "-y",
                    "-i", source_path,
                    "-map", "0:v:0",
                    *audio_map,
                    "-sn",
                    *codec_args,
                    "-movflags", "+faststart",
                    "-f", "mp4",
                    temp_path,
                ], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                   stderr=subprocess.PIPE, text=True,
                   creationflags=getattr(subprocess, "DETACHED_PROCESS", 0))
                if result.returncode == 0 and os.path.isfile(temp_path) and os.path.getsize(temp_path) > 0:
                    break
                try:
                    os.remove(temp_path)
                except OSError:
                    pass
            else:
                detail = (result.stderr or "").strip().splitlines()[-1:]
                suffix = f": {detail[0]}" if detail else ""
                raise VideoPlaybackError(f"FFmpeg could not convert this video{suffix}")
            os.replace(temp_path, cache_path)
            _remove_stale_caches(cache_path, effective_cache_key)
            return cache_path, True
        except FileNotFoundError as exc:
            raise VideoPlaybackError("FFmpeg is not available for browser video conversion") from exc
        finally:
            try:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
            except OSError:
                pass

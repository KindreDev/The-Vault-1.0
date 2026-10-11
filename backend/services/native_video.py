"""Authorize local Vault videos and control native Windows VLC output."""
from __future__ import annotations

import ctypes
import os
from pathlib import Path
import re
import sys
import threading
from urllib.parse import urlparse

class _MediaTrack(ctypes.Structure):
    # libVLC's audio/video/subtitle pointers are a C union. python-vlc 3's
    # generated MediaTrack mistakenly places them in three separate fields.
    _fields_ = [("codec", ctypes.c_uint32), ("fourcc", ctypes.c_uint32),
                ("id", ctypes.c_int), ("type", ctypes.c_int),
                ("profile", ctypes.c_int), ("level", ctypes.c_int),
                ("details", ctypes.c_void_p)]


def display_dimensions(vlc, media):
    """Use visible media dimensions, not padded decoder dimensions."""
    get = ctypes.CFUNCTYPE(ctypes.c_uint, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p))(
        ("libvlc_media_tracks_get", vlc.dll))
    release = ctypes.CFUNCTYPE(None, ctypes.c_void_p, ctypes.c_uint)(
        ("libvlc_media_tracks_release", vlc.dll))
    tracks = ctypes.c_void_p()
    count = get(media, ctypes.byref(tracks))
    try:
        pointers = ctypes.cast(tracks, ctypes.POINTER(ctypes.POINTER(_MediaTrack)))
        for index in range(count):
            track = pointers[index].contents
            if track.type == 1 and track.details:
                video = ctypes.cast(track.details, ctypes.POINTER(vlc.VideoTrack)).contents
                w, h = video.width, video.height
                if video.orientation.value >= 4:
                    w, h = h, w
                if w and h:
                    return w, h
        return None
    finally:
        if count:
            release(tracks, count)


def runtime_directory() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "vlc"
    bundled = Path(__file__).resolve().parents[2] / "tools" / "vlc"
    if (bundled / "libvlc.dll").is_file():
        return bundled
    return Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "VideoLAN" / "VLC"


def load_vlc():
    runtime = runtime_directory()
    if not (runtime / "libvlc.dll").is_file():
        raise RuntimeError("The bundled VLC playback engine is missing")
    # python-vlc loads these dynamically. Use our runtime, never a random PATH DLL.
    os.environ["PYTHON_VLC_LIB_PATH"] = str(runtime / "libvlc.dll")
    os.environ["PYTHON_VLC_MODULE_PATH"] = str(runtime / "plugins")
    import vlc
    return vlc


def resolve_video_source(src: str) -> str:
    """Only indexed local media is accessible from the desktop playback bridge."""
    parsed = urlparse(src)
    if parsed.netloc and parsed.hostname not in {"localhost", "127.0.0.1"}:
        raise ValueError("Native playback requires local Vault media")
    match = re.fullmatch(r"/api/(images|intake/items)/(\d+)/file", parsed.path)
    if not match:
        raise ValueError("Unsupported native video source")
    from database import SessionLocal
    from models import Image, IntakeItem
    with SessionLocal() as db:
        if match[1] == "images":
            item = db.query(Image).filter(Image.id == int(match[2])).first()
            path = item.file_path if item and item.is_video else None
        else:
            item = db.query(IntakeItem).filter(IntakeItem.id == int(match[2])).first()
            path = item.source_path if item and item.is_video else None
            if path:
                from services.intake import _inside_root
                if not _inside_root(db, path, item.root_id):
                    raise ValueError("Video is outside its Loading Bay root")
        if not path or not os.path.isfile(path):
            raise FileNotFoundError("Video file not found on disk")
        return path


class NativeVideoBridge:
    """Authorize Vault sources and own the native Windows output lifecycle."""
    def __init__(self, get_window):
        self.get_window = get_window
        self._host = None
        self.guard = threading.RLock()
        self.shutting_down = False

    def capabilities(self):
        try:
            with self.guard:
                if self.shutting_down:
                    raise RuntimeError('The Vault window is closing')
                if not self.get_window():
                    raise RuntimeError('Native video requires the Windows desktop window')
                if not self._host:
                    from services.native_video_surface import NativeSurfaceHost
                    self._host = NativeSurfaceHost(self.get_window)
                return {'available': True, 'engine': 'libVLC', 'output': 'native-window',
                        'version': self._host.vlc.libvlc_get_version().decode()}
        except Exception as exc:
            return {'available': False, 'reason': str(exc)}

    def renderer_recommendation(self, src):
        return {'renderer': 'libVLC', 'output': 'native-window'}

    def open(self, session_id, src, options):
        if not re.fullmatch(r'[a-zA-Z0-9-]{1,80}', session_id):
            raise ValueError('Invalid playback session')
        path = resolve_video_source(src)
        with self.guard:
            result = self.capabilities()
            if not result['available']:
                raise RuntimeError(result['reason'])
            return self._host.open(session_id, path, options)

    def layout(self, session_id, layout):
        if self._host:
            return self._host.layout(session_id, layout)

    def prepare(self, owner, src):
        if not isinstance(owner, str) or not owner or len(owner) > 128:
            raise ValueError('Invalid preparation owner')
        path = resolve_video_source(src)
        available = self.capabilities()
        if not available['available']:
            raise RuntimeError(available.get('reason', 'Native playback unavailable'))
        return self._host.prepare(owner, path)

    def clear_prepared(self, owner):
        if self._host:
            self._host.clear_prepared(owner)

    def command(self, session_id, command, value=None):
        if self._host:
            return self._host.command(session_id, command, value)

    def status(self, session_id):
        return self._host.status(session_id) if self._host else None

    def media_clock(self, session_id):
        return self._host.media_clock(session_id) if self._host else None

    def close(self, session_id):
        if self._host:
            self._host.close(session_id)

    def close_all(self):
        if self._host:
            self._host.close_all()

    def shutdown(self):
        with self.guard:
            self.shutting_down = True
            if self._host:
                self._host.shutdown()

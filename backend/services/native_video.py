"""Local libVLC playback with decoded frames shared directly with WebView2.

No HTTP media request, transcoding, JPEG encoding, or playback cache is involved.
The web canvas remains in the normal DOM, so all existing overlays/transforms work.
"""
from __future__ import annotations

import ctypes
import json
import os
from pathlib import Path
import re
import sys
import threading
import time
from urllib.parse import urlparse

HEADER_BYTES = 128
SLOTS = 4
MAX_SESSIONS = 12


class FrameHeader(ctypes.Structure):
    _fields_ = [
        ("sequence", ctypes.c_uint32), ("frame_slot", ctypes.c_int32),
        ("reading_slot", ctypes.c_int32), ("flags", ctypes.c_uint32),
        ("time", ctypes.c_double), ("duration", ctypes.c_double),
        ("rate", ctypes.c_double), ("width", ctypes.c_uint32),
        ("height", ctypes.c_uint32),
    ]


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


class WebViewFrames:
    """Own the mapping until VLC has stopped and released every callback."""
    def __init__(self, window, session_id):
        self.window = window
        self.session_id = session_id
        self.buffers = []
        self.header = None
        self.address = 0
        self.frame_bytes = 0
        self.dimensions = None

    def allocate(self, width, height):
        if self.dimensions == (width, height) and self.address:
            return self.address  # looping must not allocate another full frame mapping
        from System import Func, Object, UInt64
        from Microsoft.Web.WebView2.Core import CoreWebView2SharedBufferAccess
        control = self.window.native.browser.webview
        self.frame_bytes = width * height * 4

        def create():
            core = control.CoreWebView2
            buffer = core.Environment.CreateSharedBuffer(UInt64(HEADER_BYTES + self.frame_bytes * SLOTS))
            self.buffers.append(buffer)
            self.address = buffer.Buffer.ToInt64()
            ctypes.memset(self.address, 0, HEADER_BYTES + self.frame_bytes * SLOTS)
            self.header = FrameHeader.from_address(self.address)
            self.header.frame_slot = -1
            self.header.reading_slot = -1
            self.header.width = width
            self.header.height = height
            self.header.rate = 1
            self.dimensions = (width, height)
            core.PostSharedBufferToScript(buffer, CoreWebView2SharedBufferAccess.ReadWrite,
                                         json.dumps({"kind": "vault-vlc", "session": self.session_id,
                                                     "width": width, "height": height,
                                                     "headerBytes": HEADER_BYTES, "slots": SLOTS}))
            return None
        control.Invoke(Func[Object](create))
        return self.address

    def close(self):
        from System import Action
        buffers, self.buffers = self.buffers, []
        if buffers:
            try:
                self.window.native.browser.webview.Invoke(Action(lambda: [b.Dispose() for b in buffers]))
            except Exception:
                # The OS closes the mappings if the desktop window already exited.
                pass


class VlcSession:
    def __init__(self, instance, vlc, path, frames, options):
        self.vlc = vlc
        self.frames = frames
        self.player = instance.media_player_new()
        self.media = instance.media_new_path(path)
        self.player.set_media(self.media)
        self.closed = threading.Event()
        self.lock = threading.RLock()
        self.loop = bool(options.get("loop", False))
        self.rate = max(.25, min(4., float(options.get("rate", 1))))
        self.volume = max(0, min(100, round(float(options.get("volume", 1)) * 100)))
        self.muted = bool(options.get("muted", False))
        self.error = None
        self.slot = 0
        self.render_slot = 0
        self.started = time.monotonic()
        self.ready = False
        self.pending_seek = None
        self.want_play = bool(options.get("autoPlay", False))

        # python-vlc's c_char_p converts the writable FourCC to immutable bytes.
        # Keep the native pointer so changing the output chroma actually reaches VLC.
        format_callback = ctypes.CFUNCTYPE(ctypes.c_uint, ctypes.POINTER(ctypes.c_void_p),
                                          ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint),
                                          ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint),
                                          ctypes.POINTER(ctypes.c_uint))
        @format_callback
        def setup(opaque, chroma, width, height, pitches, lines):
            try:
                # VLC supplies the display orientation, including MOV rotation.
                w, h = int(width[0]), int(height[0])
                dimensions = display_dimensions(vlc, self.media)
                if dimensions:
                    w, h = dimensions
                    width[0], height[0] = w, h
                if w <= 0 or h <= 0 or w * h > 4096 * 4096:
                    raise RuntimeError("Video dimensions exceed the playback renderer limit")
                self.frames.allocate(w, h)
                ctypes.memmove(chroma, b"RGBA", 4)
                pitches[0] = w * 4
                lines[0] = h
                return SLOTS
            except Exception as exc:
                self.error = str(exc)
                return 0

        @vlc.CallbackDecorators.VideoLockCb
        def lock(opaque, planes):
            header = self.frames.header
            # Exclude the displayed frame and the frame being uploaded by JS.
            for _ in range(SLOTS):
                self.slot = (self.slot + 1) % SLOTS
                if self.slot not in {header.frame_slot, header.reading_slot}:
                    break
            planes[0] = self.frames.address + HEADER_BYTES + self.slot * self.frames.frame_bytes
            return self.slot + 1

        @vlc.CallbackDecorators.VideoDisplayCb
        def display(opaque, picture):
            header = self.frames.header
            header.frame_slot = int(picture) - 1
            header.sequence = (header.sequence + 1) & 0xFFFFFFFF

        self.callbacks = (setup, lock, display)  # ctypes callbacks must stay alive.
        self.player.video_set_callbacks(lock, None, display, None)
        self.player.video_set_format_callbacks(setup, None)
        self.player.audio_set_volume(self.volume)
        self.player.audio_set_mute(self.muted)
        self.player.set_rate(self.rate)
        # Decode the first frame even when autoplay is off, then pause.
        if self.player.play() == -1:
            raise RuntimeError("VLC could not open this video")
        self.monitor = threading.Thread(target=self._monitor, daemon=True, name="vault-vlc-clock")
        self.monitor.start()

    def _monitor(self):
        while not self.closed.wait(.025):
            with self.lock:
                if self.closed.is_set():
                    break
                state = self.player.get_state()
                header = self.frames.header
                if state == self.vlc.State.Error:
                    self.error = self.error or "VLC could not decode this video"
                if not header:
                    if time.monotonic() - self.started > 20:
                        self.error = self.error or "VLC did not produce a video frame"
                    continue
                if not self.ready and header.sequence:
                    self.ready = True
                    self.player.audio_set_volume(self.volume)
                    self.player.audio_set_mute(self.muted)
                    self.player.set_rate(self.rate)
                    if not self.want_play:
                        self.player.set_pause(1)
                ended = state == self.vlc.State.Ended
                if ended and self.loop and self.want_play:
                    self.player.stop()
                    self.player.play()
                    self.player.set_rate(self.rate)
                    ended = False
                if self.pending_seek is not None and state in {self.vlc.State.Playing, self.vlc.State.Paused}:
                    self.player.set_time(round(self.pending_seek * 1000))
                    self.pending_seek = None
                    if not self.want_play:
                        self.player.set_pause(1)
                header.time = self.pending_seek if self.pending_seek is not None else max(0, self.player.get_time()) / 1000
                header.duration = max(0, self.player.get_length()) / 1000
                header.rate = self.rate
                header.flags = (1 if state == self.vlc.State.Playing and self.want_play else 0) | (2 if ended else 0) | (4 if self.error else 0)

    def command(self, command, value=None):
        with self.lock:
            if self.closed.is_set():
                return
            if command == "play":
                self.want_play = True
                if self.player.get_state() == self.vlc.State.Ended:
                    self.player.stop()
                    self.player.play()
                else:
                    self.player.set_pause(0)
            elif command == "pause":
                self.want_play = False
                self.player.set_pause(1)
            elif command == "seek":
                seconds = max(0., float(value))
                if self.player.get_state() == self.vlc.State.Ended:
                    self.player.stop()
                    self.player.play()
                    self.player.set_rate(self.rate)
                    self.pending_seek = seconds
                else:
                    self.player.set_time(round(seconds * 1000))
                if self.frames.header:
                    self.frames.header.time = seconds
            elif command == "volume":
                self.volume = max(0, min(100, round(float(value) * 100)))
                self.player.audio_set_volume(self.volume)
            elif command == "muted":
                self.muted = bool(value)
                self.player.audio_set_mute(self.muted)
            elif command == "rate":
                self.rate = max(.25, min(4., float(value)))
                self.player.set_rate(self.rate)
            elif command == "loop":
                self.loop = bool(value)
            else:
                raise ValueError("Unknown playback command")

    def close(self):
        self.closed.set()
        with self.lock:
            self.player.stop()  # waits for outstanding frame callbacks
            self.player.release()
            self.media.release()
        self.monitor.join(timeout=1)
        self.frames.close()


class NativeVideoBridge:
    def __init__(self, get_window):
        self.get_window = get_window
        self.sessions = {}
        self.guard = threading.RLock()
        self.vlc = None
        self.instance = None
        self.shutting_down = False

    def capabilities(self):
        try:
            window = self.get_window()
            # Reading CoreWebView2 on a JS bridge worker can marshal back to the
            # UI while pywebview is starting another worker, deadlocking both.
            # Inspect the SDK type here; touch the COM instance only via Invoke.
            from Microsoft.Web.WebView2.Core import CoreWebView2
            if not window or not hasattr(CoreWebView2, "PostSharedBufferToScript"):
                return {"available": False, "reason": "Shared-memory video requires WebView2"}
            with self.guard:
                if self.shutting_down:
                    return {"available": False, "reason": "The Vault window is closing"}
                if not self.instance:
                    self.vlc = load_vlc()
                    self.instance = self.vlc.Instance("--no-video-title-show", "--no-osd", "--no-stats", "--quiet")
            return {"available": True, "engine": "libVLC", "version": self.vlc.libvlc_get_version().decode()}
        except Exception as exc:
            return {"available": False, "reason": str(exc)}

    def open(self, session_id, src, options):
        if not re.fullmatch(r"[a-zA-Z0-9-]{1,80}", session_id):
            raise ValueError("Invalid playback session")
        with self.guard:
            if self.shutting_down:
                raise RuntimeError("The Vault window is closing")
            capabilities = self.capabilities()
            if not capabilities["available"]:
                raise RuntimeError(capabilities["reason"])
            if session_id in self.sessions or len(self.sessions) >= MAX_SESSIONS:
                raise RuntimeError("Too many active video players")
            path = resolve_video_source(src)
            frames = WebViewFrames(self.get_window(), session_id)
            try:
                self.sessions[session_id] = VlcSession(self.instance, self.vlc, path, frames, options)
            except Exception:
                frames.close()
                raise
            return {"engine": "libVLC", "session": session_id}

    def command(self, session_id, command, value=None):
        with self.guard:
            session = self.sessions.get(session_id)
        if session:
            session.command(command, value)

    def status(self, session_id):
        with self.guard:
            session = self.sessions.get(session_id)
        return {"error": session.error if session else None}

    def close(self, session_id):
        with self.guard:
            session = self.sessions.pop(session_id, None)
            if session:
                session.close()  # close_all must wait for an in-flight close, too

    def close_all(self):
        for session_id in list(self.sessions):
            self.close(session_id)

    def shutdown(self):
        with self.guard:
            self.shutting_down = True
            self.close_all()
            if self.instance:
                self.instance.release()
                self.instance = None

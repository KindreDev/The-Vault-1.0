"""Desktop-only bridge. Browser/LAN clients cannot call these native methods."""
from services.native_video import NativeVideoBridge
from services.serial_playback import SerialPlayback
import threading


class VaultDesktopApi:
    def __init__(self):
        self._win = None
        self._video = NativeVideoBridge(lambda: self._win)
        self._serial = SerialPlayback(self._video.media_clock)
        self._close_guard = threading.Lock()
        self._closing = False
        self._released = False

    def toggle_fullscreen(self):
        if self._win:
            self._win.toggle_fullscreen()

    def native_video_capabilities(self):
        return self._video.capabilities()

    def native_video_renderer_recommendation(self, src):
        return self._video.renderer_recommendation(src)

    def native_video_open(self, session_id, src, options):
        if self._closing:
            raise RuntimeError('The Vault window is closing')
        return self._video.open(session_id, src, options)

    def native_video_command(self, session_id, command, value=None):
        return self._video.command(session_id, command, value)

    def native_video_prepare(self, owner, src):
        if self._closing:
            return
        return self._video.prepare(owner, src)

    def native_video_clear_prepared(self, owner):
        return self._video.clear_prepared(owner)

    def native_video_status(self, session_id):
        return self._video.status(session_id)

    def native_video_layout(self, session_id, layout):
        return self._video.layout(session_id, layout)

    def native_video_close(self, session_id):
        self._video.close(session_id)

    def native_video_close_all(self):
        self._video.close_all()

    def serial_ports(self):
        return self._serial.ports()

    def serial_connect(self, device):
        if self._closing:
            raise RuntimeError('The Vault window is closing')
        return self._serial.connect(device)

    def serial_start(self, payload):
        return self._serial.start(payload)

    def serial_update(self, patch):
        self._serial.update(patch)

    def serial_move(self, axis, position, duration, generation):
        self._serial.move(axis, position, duration, generation)

    def serial_stop(self, generation):
        self._serial.stop(generation)

    def serial_status(self):
        return self._serial.status()

    def serial_disconnect(self):
        self._serial.disconnect()

    def desktop_reset_outputs(self):
        self._serial.disconnect()
        self._video.close_all()

    def _on_closing(self):
        # Cancel the first close, keeping the UI thread and WebView mappings
        # alive while VLC finishes its callbacks. Destroy only after cleanup.
        # Stopping VLC on the UI thread can deadlock its frame-buffer Invoke.
        with self._close_guard:
            if self._released:
                return True
            if self._closing:
                return False
            self._closing = True

        def release_then_close():
            self._serial.disconnect()
            self._video.shutdown()
            with self._close_guard:
                self._released = True
            self._win.destroy()

        threading.Thread(target=release_then_close, name='vault-video-shutdown', daemon=False).start()
        return False

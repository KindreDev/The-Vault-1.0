"""Desktop-only bridge. Browser/LAN clients cannot call these native methods."""
from services.native_video import NativeVideoBridge
import threading


class VaultDesktopApi:
    def __init__(self):
        self._win = None
        self._video = NativeVideoBridge(lambda: self._win)
        self._close_guard = threading.Lock()
        self._closing = False
        self._released = False

    def toggle_fullscreen(self):
        if self._win:
            self._win.toggle_fullscreen()

    def native_video_capabilities(self):
        return self._video.capabilities()

    def native_video_open(self, session_id, src, options):
        if self._closing:
            raise RuntimeError('The Vault window is closing')
        return self._video.open(session_id, src, options)

    def native_video_command(self, session_id, command, value=None):
        return self._video.command(session_id, command, value)

    def native_video_status(self, session_id):
        return self._video.status(session_id)

    def native_video_close(self, session_id):
        self._video.close(session_id)

    def native_video_close_all(self):
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
            self._video.shutdown()
            with self._close_guard:
                self._released = True
            self._win.destroy()

        threading.Thread(target=release_then_close, name='vault-video-shutdown', daemon=False).start()
        return False

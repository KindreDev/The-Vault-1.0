r"""Run the actual desktop WebView2 shell against an existing dev server.

Start the normal backend/Vite servers first, then run with backend's environment:
    backend\venv\Scripts\python.exe scripts\run_desktop.py
"""
import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from desktop_api import VaultDesktopApi
from database import DATA_DIR
import webview


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:5173")
    parser.add_argument("--trace", action="store_true", help="Dump thread stacks if the native shell stalls")
    args = parser.parse_args()
    if args.trace:
        import faulthandler
        faulthandler.dump_traceback_later(20, repeat=True)
    api = VaultDesktopApi()
    window = webview.create_window("The Vault", args.url,
                                   width=1440, height=900, min_size=(1024, 700),
                                   background_color="#0e0e0e", text_select=True, js_api=api)
    api._win = window
    def release_players():
        import threading
        threading.Thread(target=api.native_video_close_all, daemon=True).start()
    window.events.before_load += release_players
    window.events.closing += api._on_closing
    storage = Path(DATA_DIR) / "webview_data"
    storage.mkdir(parents=True, exist_ok=True)
    webview.start(gui="edgechromium", debug=False, private_mode=False, storage_path=str(storage))


if __name__ == "__main__":
    main()

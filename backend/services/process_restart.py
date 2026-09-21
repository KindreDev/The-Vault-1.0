"""Reliable process handoff for maintenance operations on Windows and in dev."""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import Callable

from database import DATA_DIR, DB_PATH, engine
from services.file_ops import remove_file, remove_tree


INSTANCE_ID = f"{os.getpid()}-{uuid.uuid4().hex}"
_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0


def _restart_command() -> list[str]:
    if getattr(sys, "frozen", False):
        return [sys.executable, *sys.argv[1:]]
    return [sys.executable, os.path.abspath(sys.argv[0]), *sys.argv[1:]]


def schedule_restart(
    *,
    before_launch: Callable[[], None] | None = None,
    child_action: str | None = None,
    delay: float = 0.8,
) -> None:
    """Finish the response, release SQLite, then hand off to a waiting child.

    The child receives an environment marker and waits at the very start of
    main.py until port 8000 is free. That prevents it from losing a bind race
    against the process which is still delivering this request.
    """

    def _run() -> None:
        time.sleep(delay)
        try:
            engine.dispose()
            if before_launch:
                before_launch()

            env = os.environ.copy()
            env["VAULT_RESTART_HANDOFF"] = INSTANCE_ID
            if child_action:
                env["VAULT_RESTART_ACTION"] = child_action
            cwd = os.path.dirname(sys.executable) if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(sys.argv[0]))
            subprocess.Popen(
                _restart_command(),
                cwd=cwd,
                env=env,
                creationflags=_NO_WINDOW,
            )
        except Exception:
            logging.getLogger("vault").exception("Maintenance restart failed before handoff")
            return
        os._exit(0)

    threading.Thread(target=_run, daemon=False, name="vault-restart-handoff").start()


def wipe_collection_database() -> None:
    """Remove collection state and derived thumbnails while preserving config/media."""
    for path in (DB_PATH, f"{DB_PATH}-wal", f"{DB_PATH}-shm"):
        remove_file(path)
        if os.path.exists(path):
            raise OSError(f"Could not remove database file: {path}")

    data_root = os.path.realpath(DATA_DIR)
    thumbs = os.path.realpath(os.path.join(DATA_DIR, "thumbs"))
    if os.path.dirname(thumbs) != data_root or os.path.basename(thumbs).casefold() != "thumbs":
        raise RuntimeError("Refusing to remove an unexpected thumbnail directory")
    remove_tree(thumbs)

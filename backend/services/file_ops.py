"""Small, retrying filesystem operations used by destructive media actions.

The gallery and media delete endpoints run in a worker thread, so a short
retry window is safe here and matters on Windows: a browser video/image
request can release its handle a moment after the user closes a preview.
"""

import os
import shutil
import stat
import time
from typing import Callable


# Sharing violations are normally released quickly. Keep the total wait short
# enough that a genuinely locked file still produces a useful error promptly.
_RETRY_DELAYS = (0.05, 0.15, 0.35, 0.75, 1.5)


def _make_writable(path: str) -> None:
    """Clear a read-only bit before retrying a removal on Windows."""
    try:
        os.chmod(path, stat.S_IWRITE)
    except FileNotFoundError:
        return


def rename_path(source: str, destination: str) -> None:
    """Rename a file or directory, retrying transient Windows sharing locks."""
    last_error = None
    for attempt, delay in enumerate((0, *_RETRY_DELAYS)):
        if delay:
            time.sleep(delay)
        try:
            os.rename(source, destination)
            return
        except FileNotFoundError:
            raise
        except FileExistsError:
            raise
        except OSError as exc:
            last_error = exc
            if attempt == len(_RETRY_DELAYS):
                break

    raise last_error  # type: ignore[misc]


def remove_file(path: str | None, *, on_error: Callable[[str, Exception], None] | None = None) -> None:
    """Remove one file, treating an already-missing path as success.

    Raises the final filesystem exception when the path still cannot be
    removed. Callers can safely use this for an idempotent retry of a delete.
    """
    if not path:
        return

    last_error = None
    for attempt, delay in enumerate((0, *_RETRY_DELAYS)):
        if delay:
            time.sleep(delay)
        try:
            os.remove(path)
            return
        except FileNotFoundError:
            return
        except OSError as exc:
            last_error = exc
            if on_error:
                on_error(path, exc)
            if attempt == len(_RETRY_DELAYS):
                break
            _make_writable(path)

    raise last_error  # type: ignore[misc]


def remove_tree(path: str | None) -> None:
    """Recursively remove a folder with transient-lock and read-only retries."""
    if not path or not os.path.lexists(path):
        return

    last_error = None
    for attempt, delay in enumerate((0, *_RETRY_DELAYS)):
        if delay:
            time.sleep(delay)

        def onerror(func, failed_path, exc_info):
            # rmtree's callback receives the original exception tuple. Make
            # the item writable and retry the exact operation once; if a
            # sharing violation remains, the outer retry gets another chance.
            _make_writable(failed_path)
            func(failed_path)

        try:
            shutil.rmtree(path, onerror=onerror)
            return
        except FileNotFoundError:
            return
        except OSError as exc:
            last_error = exc
            if attempt == len(_RETRY_DELAYS):
                break

    raise last_error  # type: ignore[misc]

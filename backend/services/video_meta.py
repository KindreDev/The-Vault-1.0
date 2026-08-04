"""
Backfill video durations.

Videos only get their duration probed at the moment they are first scanned, and
that probe was added long after most of the library was imported — so the vast
majority of videos have duration NULL. Anything derived from it (a creator's
"video runtime", length badges) reads as near-zero.

A rescan does not fix this: the scanner skips images it already knows about, so
the column stays empty forever. Hence this one-off pass.

Runs on the shared task queue with the same start/poll/cancel shape as the
dedup hash builder.
"""
import threading
import logging

from models import Image

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_state: dict = {
    "running":   False,
    "progress":  0,
    "total":     0,
    "updated":   0,
    "failed":    0,
    "message":   "Idle",
    "cancelled": False,
}

# Commit every N probes so progress survives a crash and the UI sees movement.
_COMMIT_EVERY = 50


def get_state() -> dict:
    with _lock:
        return dict(_state)


def _set(**kwargs):
    with _lock:
        _state.update(kwargs)


def cancel():
    _set(cancelled=True)


def _is_cancelled() -> bool:
    with _lock:
        return _state["cancelled"]


def missing_count(db) -> int:
    """How many videos still have no usable duration."""
    return (
        db.query(Image)
          .filter(Image.is_video == True)  # noqa: E712
          .filter((Image.duration == None) | (Image.duration <= 0))  # noqa: E711
          .count()
    )


def _backfill_thread(db_factory):
    from services.ai_tagger import _video_duration
    import os

    _set(running=True, cancelled=False, progress=0, updated=0, failed=0,
         message="Finding videos without a duration…")
    db = db_factory()
    try:
        rows = (
            db.query(Image.id, Image.file_path)
              .filter(Image.is_video == True)  # noqa: E712
              .filter((Image.duration == None) | (Image.duration <= 0))  # noqa: E711
              .all()
        )
        total = len(rows)
        _set(total=total, message=f"Probing {total} videos…")

        updated = failed = 0
        for i, (img_id, path) in enumerate(rows, start=1):
            if _is_cancelled():
                _set(message=f"Cancelled — {updated} updated")
                break

            # A missing file is not an error worth counting loudly; the scanner
            # prunes those separately.
            if not path or not os.path.exists(path):
                failed += 1
            else:
                secs = _video_duration(path)
                if secs and secs > 0:
                    db.query(Image).filter(Image.id == img_id).update({"duration": secs})
                    updated += 1
                else:
                    failed += 1

            if i % _COMMIT_EVERY == 0:
                db.commit()
                _set(progress=i, updated=updated, failed=failed,
                     message=f"Probed {i}/{total} — {updated} updated")

        db.commit()
        _set(progress=total if not _is_cancelled() else _state["progress"],
             updated=updated, failed=failed,
             message=f"Done — {updated} durations filled in"
                     + (f", {failed} skipped" if failed else ""))
    except Exception as e:
        logger.exception("video duration backfill failed")
        _set(message=f"Failed: {e}")
    finally:
        try:
            db.close()
        except Exception:
            pass
        _set(running=False)

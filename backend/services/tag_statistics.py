"""Exact tag-pair statistics, with one bounded calculation per process."""
import threading
import time

from sqlalchemy import func
from sqlalchemy.exc import OperationalError
from models import Tag, image_tags

CACHE_SECONDS = 600
QUERY_SECONDS = 120
MAX_PAIRS = 50
_lock = threading.Lock()
_cache = {'bind': None, 'at': 0, 'rows': None, 'failed_until': 0}


class TagStatisticsBusy(RuntimeError):
    pass


def _calculate(db):
    first = image_tags.alias('first_tag')
    second = image_tags.alias('second_tag')
    count = func.count().label('co_count')
    # Keep only IDs in the large grouping workspace; hydrate names afterwards.
    rows = (db.query(first.c.tag_id, second.c.tag_id, count)
            .select_from(first)
            .join(second, (first.c.image_id == second.c.image_id) & (first.c.tag_id < second.c.tag_id))
            .group_by(first.c.tag_id, second.c.tag_id)
            .order_by(count.desc(), first.c.tag_id, second.c.tag_id)
            .limit(MAX_PAIRS).all())
    ids = {tid for left, right, _ in rows for tid in (left, right)}
    tags = {tag.id: {'id': tag.id, 'name': tag.name, 'category': tag.category}
            for tag in db.query(Tag).filter(Tag.id.in_(ids)).all()}
    return [{'tag1': tags[left], 'tag2': tags[right], 'co_count': total}
            for left, right, total in rows if left in tags and right in tags]


def co_occurring_tags(db, limit=10):
    limit = max(1, min(MAX_PAIRS, limit))
    bind = db.get_bind()
    now = time.monotonic()
    if _cache['bind'] is bind and _cache['rows'] is not None and now - _cache['at'] < CACHE_SECONDS:
        return _cache['rows'][:limit]
    # An HTTP timeout doesn't cancel SQLite. Reject duplicates rather than
    # launching another full-library grouping or tying up more worker threads.
    if not _lock.acquire(blocking=False):
        raise TagStatisticsBusy('Tag statistics are already being calculated. Please try again shortly.')
    try:
        now = time.monotonic()
        if _cache['bind'] is bind:
            if _cache['rows'] is not None and now - _cache['at'] < CACHE_SECONDS:
                return _cache['rows'][:limit]
            if now < _cache['failed_until']:
                raise TagStatisticsBusy('Tag statistics took too long. Please try again later.')
        connection = db.connection().connection.driver_connection
        deadline = now + QUERY_SECONDS
        connection.set_progress_handler(lambda: int(time.monotonic() >= deadline), 10000)
        try:
            rows = _calculate(db)
        except OperationalError as exc:
            if 'interrupted' not in str(exc).lower():
                raise
            _cache.update(bind=bind, rows=None, at=0, failed_until=time.monotonic() + 60)
            raise TagStatisticsBusy('Tag statistics exceeded the calculation time limit. Please try again later.') from exc
        finally:
            connection.set_progress_handler(None, 0)
        _cache.update(bind=bind, at=time.monotonic(), rows=rows, failed_until=0)
        return rows[:limit]
    finally:
        _lock.release()

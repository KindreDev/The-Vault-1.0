"""
Central task queue — one task runs at a time, others wait.

Each service (scanner, ai_tagger, dedup) keeps its own internal _state dict.
The queue:
  1. Calls start_fn() — launches the service's background thread
  2. Polls poll_fn() every 0.5 s to read progress / done state
  3. Calls cancel_fn() if the task is cancelled by the user
"""
import threading
import time
import uuid
from datetime import datetime

_lock   = threading.Lock()
_queue:  list  = []   # pending tasks
_current       = None # running task or None
_history: list = []   # last 50 finished tasks
_worker_started = False
_recovery_lock = threading.Lock()
_recovery_checked = False


def _now() -> str:
    return datetime.utcnow().isoformat()


def _public(task: dict) -> dict:
    return {k: v for k, v in task.items() if not k.startswith('_')}


def launch_background(fn, *args, **kwargs):
    """Return the actual worker so preparation cannot outlive its queue slot."""
    def run():
        try:
            fn(*args, **kwargs)
        except Exception as exc:
            thread._task_error = str(exc)
    thread = threading.Thread(target=run, daemon=True)
    thread._task_error = None
    thread.start()
    return thread


def _worker_loop():
    global _current
    while True:
        with _lock:
            task = _queue.pop(0) if _queue and _current is None else None
            if task:
                task.update(status='running', started_at=_now(), message='Preparing…')
                _current = task
        if task is None:
            time.sleep(0.3)
            continue
        try:
            before = task['_poll_fn']()
        except Exception:
            before = {}
        state = {}
        try:
            runner = task['_start_fn']()
            tracked = isinstance(runner, threading.Thread)
            responded = False
            deadline = time.monotonic() + 120
            while True:
                alive = tracked and runner.is_alive()
                try:
                    state = task['_poll_fn']()
                except Exception as exc:
                    if alive:
                        time.sleep(0.3)
                        continue
                    raise RuntimeError(f'Could not read task status: {exc}') from exc
                responded = responded or bool(state.get('running')) or state != before
                with _lock:
                    task['progress'] = state.get('progress', 0)
                    task['total'] = state.get('total', 0)
                    task['detail'] = dict(state)
                    task['message'] = (state.get('message') or 'Preparing…') if responded else 'Preparing…'
                if task.get('_cancelled') and alive:
                    try:
                        task['_cancel_fn']()
                    except Exception:
                        pass
                if tracked:
                    if not alive:
                        if getattr(runner, '_task_error', None):
                            raise RuntimeError(runner._task_error)
                        break
                elif responded and not state.get('running'):
                    break
                elif not responded and time.monotonic() >= deadline:
                    raise RuntimeError('Service did not report its status during startup')
                time.sleep(0.3)
            status = state.get('status')
            if status == 'done':
                task['status'] = 'done'
            elif task.get('_cancelled') or status == 'cancelled':
                task['status'] = 'cancelled'
            elif status == 'paused' or state.get('paused'):
                task['status'] = 'paused'
            elif status == 'failed':
                task['status'] = 'failed'
            else:
                task['status'] = 'done'
        except Exception as exc:
            task['status'] = 'failed'
            task['message'] = str(exc)
        with _lock:
            task['finished_at'] = _now()
            _history.insert(0, _public(task))
            del _history[50:]
            _current = None


def _ensure_worker():
    global _worker_started
    with _lock:
        if not _worker_started:
            _worker_started = True
            threading.Thread(target=_worker_loop, daemon=True).start()


def submit(task_type: str, label: str, start_fn, poll_fn, cancel_fn, *, task_id: str | None = None) -> str:
    """Queue a task. Returns the task id."""
    _ensure_worker()
    task_id = task_id or str(uuid.uuid4())[:8]
    task = {
        'id':          task_id,
        'type':        task_type,
        'label':       label,
        'status':      'queued',
        'progress':    0,
        'total':       0,
        'message':     'Waiting in queue…',
        'detail':      {},
        'created_at':  _now(),
        'started_at':  None,
        'finished_at': None,
        '_start_fn':   start_fn,
        '_poll_fn':    poll_fn,
        '_cancel_fn':  cancel_fn,
        '_cancelled':  False,
    }
    with _lock:
        _queue.append(task)
    return task_id


def cancel_current():
    with _lock:
        task = _current
    if task:
        task['_cancelled'] = True
        try:
            task['_cancel_fn']()
        except Exception:
            pass


def remove_queued(task_id: str) -> bool:
    removed_task = None
    with _lock:
        for i, t in enumerate(_queue):
            if t['id'] == task_id:
                removed_task = _queue.pop(i)
                break
    if not removed_task:
        return False
    if removed_task.get('type') == 'foundation_refresh':
        try:
            from services.foundation_refresh import mark_removed_from_queue
            mark_removed_from_queue(task_id)
        except Exception:
            # Reinsert rather than strand a durable job if its terminal state
            # could not be committed.
            with _lock:
                _queue.insert(0, removed_task)
            return False
    return True


def get_state() -> dict:
    _recover_foundation_refreshes()
    with _lock:
        snapshot = {
            'current': _public(_current) if _current else None,
            'queued':  [_public(t) for t in _queue],
            'history': list(_history),
        }
    try:
        from services.foundation_refresh import persisted_task_history
        known = {task.get('id') for task in snapshot['history']}
        snapshot['history'].extend(task for task in persisted_task_history() if task.get('id') not in known)
        snapshot['history'].sort(key=lambda task: task.get('finished_at') or task.get('created_at') or '', reverse=True)
        snapshot['history'] = snapshot['history'][:50]
    except Exception:
        pass
    return snapshot


def _recover_foundation_refreshes():
    """Requeue persisted Foundation jobs if the process restarted mid-run."""
    global _recovery_checked
    with _recovery_lock:
        if _recovery_checked:
            return
        _recovery_checked = True
    try:
        from services.foundation_refresh import recoverable_tasks
        for descriptor in recoverable_tasks():
            with _lock:
                known = any(task['id'] == descriptor['id'] for task in _queue) or bool(_current and _current['id'] == descriptor['id'])
            if known:
                continue
            submit(
                'foundation_refresh', 'Restore card catalogue',
                start_fn=descriptor['start_fn'], poll_fn=descriptor['poll_fn'],
                cancel_fn=descriptor['cancel_fn'], task_id=descriptor['id'],
            )
    except Exception:
        # A later Task Q read retries recovery after a transient DB error.
        with _recovery_lock:
            _recovery_checked = False


def recover_durable_tasks():
    """Startup hook for durable tasks whose process was interrupted."""
    _recover_foundation_refreshes()


def is_busy() -> bool:
    with _lock:
        return _current is not None or bool(_queue)

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


def _now() -> str:
    return datetime.utcnow().isoformat()


def _public(task: dict) -> dict:
    return {k: v for k, v in task.items() if not k.startswith('_')}


def _worker_loop():
    global _current
    while True:
        with _lock:
            if _queue and _current is None:
                task = _queue.pop(0)
                task['status']     = 'running'
                task['started_at'] = _now()
                _current = task
            else:
                task = None

        if task is None:
            time.sleep(0.3)
            continue

        # Launch the service
        try:
            task['_start_fn']()
        except Exception as e:
            with _lock:
                task['status']      = 'failed'
                task['message']     = f'Failed to start: {e}'
                task['finished_at'] = _now()
                _history.insert(0, _public(task))
                if len(_history) > 50:
                    _history.pop()
                _current = None
            continue

        # Phase 1: detect that the service actually ran.
        # Two cases:
        #   a) Slow tasks  → service sets running=True, we observe it
        #   b) Fast tasks  → service completes before first poll (e.g. "0 images to hash")
        #      In this case running stays False, but the message changes from its pre-start value.
        try:
            pre_msg = task['_poll_fn']().get('message', '')
        except Exception:
            pre_msg = ''

        startup_deadline = time.time() + 5.0
        service_responded = False
        while time.time() < startup_deadline:
            try:
                s = task['_poll_fn']()
            except Exception:
                s = {}
            # Service responded if running=True (slow task started)
            # OR message changed (fast task already finished)
            if s.get('running') or s.get('message', '') != pre_msg:
                service_responded = True
                break
            time.sleep(0.1)

        if not service_responded:
            with _lock:
                task['status']      = 'failed'
                task['message']     = 'Service did not respond within 5 s'
                task['finished_at'] = _now()
                _history.insert(0, _public(task))
                if len(_history) > 50:
                    _history.pop()
                _current = None
            continue

        # Phase 2: poll until the service reports done
        while True:
            try:
                state = task['_poll_fn']()
            except Exception:
                state = {'running': False, 'message': 'Poll error'}

            with _lock:
                task['progress'] = state.get('progress', 0)
                task['total']    = state.get('total', 0)
                task['message']  = state.get('message', '')
                task['detail']   = state  # full state snapshot for frontend

            if not state.get('running', False):
                break
            time.sleep(0.3)

        with _lock:
            if task.get('_cancelled'):
                task['status'] = 'cancelled'
            else:
                task['status'] = 'done'
            task['finished_at'] = _now()
            _history.insert(0, _public(task))
            if len(_history) > 50:
                _history.pop()
            _current = None


def _ensure_worker():
    global _worker_started
    if not _worker_started:
        _worker_started = True
        t = threading.Thread(target=_worker_loop, daemon=True)
        t.start()


def submit(task_type: str, label: str, start_fn, poll_fn, cancel_fn) -> str:
    """Queue a task. Returns the task id."""
    _ensure_worker()
    task_id = str(uuid.uuid4())[:8]
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
    with _lock:
        for i, t in enumerate(_queue):
            if t['id'] == task_id:
                _queue.pop(i)
                return True
    return False


def get_state() -> dict:
    with _lock:
        return {
            'current': _public(_current) if _current else None,
            'queued':  [_public(t) for t in _queue],
            'history': list(_history),
        }


def is_busy() -> bool:
    with _lock:
        return _current is not None or bool(_queue)

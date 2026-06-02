from fastapi import APIRouter, HTTPException
from services import task_queue

router = APIRouter()


@router.get("")
def get_task_queue():
    return task_queue.get_state()


@router.delete("/current")
def cancel_current_task():
    task_queue.cancel_current()
    return {"cancelled": True}


@router.delete("/queued/{task_id}")
def remove_queued_task(task_id: str):
    removed = task_queue.remove_queued(task_id)
    if not removed:
        raise HTTPException(404, "Task not found in queue")
    return {"removed": True}

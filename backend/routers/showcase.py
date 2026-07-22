"""Creator Showcase — thin router, all logic in services/showcase.py."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from services import showcase as svc

router = APIRouter()


@router.get("/{creator_id}/showcase")
def get_showcase(creator_id: int, db: Session = Depends(get_db)):
    try:
        return svc.get_showcase(db, creator_id)
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.get("/{creator_id}/showcase/eligible")
def eligible(creator_id: int, slot: str, db: Session = Depends(get_db)):
    try:
        return svc.eligible_cards(db, creator_id, slot)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.put("/{creator_id}/showcase/{slot}")
def set_slot(creator_id: int, slot: str, data: dict, db: Session = Depends(get_db)):
    inventory_id = data.get("inventory_id")
    if not inventory_id:
        raise HTTPException(400, "inventory_id required")
    try:
        return svc.set_slot(db, creator_id, slot, int(inventory_id))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/{creator_id}/showcase/{slot}")
def clear_slot(creator_id: int, slot: str, db: Session = Depends(get_db)):
    return svc.clear_slot(db, creator_id, slot)

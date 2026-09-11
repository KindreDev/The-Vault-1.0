"""Thin physical-card ledger and location endpoints."""

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from database import get_db
from models import TCGPhysicalCardCopy
from services.physical_cards import (
    audit_physical_cards,
    move_copy,
    move_copies_to_binder,
    repair_physical_cards,
)
from services import tcg_room


router = APIRouter(prefix="/api/tcg-room", tags=["TCG room"])


class CopyMove(BaseModel):
    copy_id: int
    location_kind: Literal[
        "unorganized_pile", "carried", "binder_slot", "cabinet_slot", "display_stand",
        "acrylic_case", "toploader", "set_box", "trader_reserved", "traded_away",
    ]
    location_ref: str | None = None
    location_slot: int | None = None


class CopyMoves(BaseModel):
    moves: list[CopyMove] = Field(min_length=1, max_length=100)


class BinderCopyMove(BaseModel):
    binder_id: int
    copy_ids: list[int] = Field(min_length=1, max_length=100)


class RepairRequest(BaseModel):
    confirm: bool = False


class Vector3(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: float
    y: float
    z: float


class FurnitureTransform(BaseModel):
    model_config = ConfigDict(extra="forbid")
    position: Vector3
    rotation: Vector3


class Placement(BaseModel):
    instance_id: int
    transform: FurnitureTransform
    snap_anchor: str | None = None
    placement_state: str = "placed"


class RoomSave(BaseModel):
    expected_revision: int
    environment_key: str
    lighting: dict[str, Any] = Field(default_factory=dict)
    placements: list[Placement] = Field(default_factory=list, max_length=250)


class RevisionRequest(BaseModel):
    expected_revision: int


class DisplayPurchase(BaseModel):
    definition_id: int
    variant_key: str = "default"


class FurniturePurchase(BaseModel):
    definition_id: int
    variant_key: str = "default"
    request_key: str = Field(min_length=8, max_length=96)


class FurniturePlacementRequest(BaseModel):
    expected_revision: int
    transform: FurnitureTransform
    snap_anchor: str | None = None


class FurnitureRotationRequest(BaseModel):
    expected_revision: int
    rotation: Vector3


class DisplayAssignment(BaseModel):
    instance_id: int
    copy_id: int | None = None
    slot_key: str = "primary"


class OrderLine(BaseModel):
    product_id: int
    quantity: int = Field(default=1, ge=1, le=10)
    selected_release_id: int | None = None


class OrderRequest(BaseModel):
    lines: list[OrderLine] = Field(min_length=1, max_length=10)
    delivery_delay_seconds: int = Field(default=5, ge=3, le=8)


class ParcelPlacement(BaseModel):
    transform: dict[str, Any] = Field(default_factory=dict)
    snap_anchor: str | None = None


def _call(fn, db: Session, *args, **kwargs):
    try:
        return fn(db, *args, **kwargs)
    except tcg_room.RevisionConflict as exc:
        db.rollback()
        raise HTTPException(409, str(exc))
    except ValueError as exc:
        db.rollback()
        raise HTTPException(400, str(exc))


@router.get("/bootstrap")
def bootstrap(db: Session = Depends(get_db)):
    return _call(tcg_room.room_bootstrap, db)


@router.get("/layout")
def layout(db: Session = Depends(get_db)):
    return _call(tcg_room.room_state, db)


@router.put("/layout")
def save_layout(req: RoomSave, db: Session = Depends(get_db)):
    return _call(tcg_room.save_room, db, req.model_dump())


@router.post("/layout/undo")
def undo_layout(req: RevisionRequest, db: Session = Depends(get_db)):
    return _call(tcg_room.undo_room, db, req.expected_revision)


@router.post("/layout/redo")
def redo_layout(req: RevisionRequest, db: Session = Depends(get_db)):
    return _call(tcg_room.redo_room, db, req.expected_revision)


@router.post("/display-items/purchase")
def purchase_display_item(req: DisplayPurchase, db: Session = Depends(get_db)):
    return _call(tcg_room.buy_display_item, db, req.definition_id, req.variant_key)


@router.get("/furniture")
def get_furniture_inventory(db: Session = Depends(get_db)):
    return _call(tcg_room.furniture_inventory, db)


@router.get("/inventory")
def get_room_inventory(db: Session = Depends(get_db)):
    return _call(tcg_room.room_inventory, db)


@router.post("/furniture/purchase")
def purchase_furniture(req: FurniturePurchase, db: Session = Depends(get_db)):
    return _call(tcg_room.buy_display_item, db, req.definition_id, req.variant_key, req.request_key)


@router.post("/furniture/{instance_id}/place")
def place_furniture(instance_id: int, req: FurniturePlacementRequest, db: Session = Depends(get_db)):
    return _call(tcg_room.place_furniture, db, instance_id, req.expected_revision,
                 req.transform.model_dump(), req.snap_anchor)


@router.post("/furniture/{instance_id}/move")
def move_furniture(instance_id: int, req: FurniturePlacementRequest, db: Session = Depends(get_db)):
    return _call(tcg_room.move_furniture, db, instance_id, req.expected_revision,
                 req.transform.model_dump(), req.snap_anchor)


@router.post("/furniture/{instance_id}/rotate")
def rotate_furniture(instance_id: int, req: FurnitureRotationRequest, db: Session = Depends(get_db)):
    return _call(tcg_room.rotate_furniture, db, instance_id, req.expected_revision,
                 req.rotation.model_dump())


@router.post("/furniture/{instance_id}/return")
def return_furniture(instance_id: int, req: RevisionRequest, db: Session = Depends(get_db)):
    return _call(tcg_room.return_furniture, db, instance_id, req.expected_revision)


@router.put("/display-items/assignment")
def assign_display_item(req: DisplayAssignment, db: Session = Depends(get_db)):
    return _call(tcg_room.assign_display_copy, db, req.instance_id, req.copy_id, req.slot_key)


@router.post("/orders")
def create_order(req: OrderRequest, db: Session = Depends(get_db)):
    return _call(tcg_room.place_order, db, [line.model_dump() for line in req.lines],
                 delivery_delay_seconds=req.delivery_delay_seconds)


@router.get("/parcels/{parcel_id}")
def get_parcel(parcel_id: int, db: Session = Depends(get_db)):
    return _call(tcg_room.parcel_status, db, parcel_id)


@router.post("/parcels/{parcel_id}/collect")
def collect_parcel(parcel_id: int, db: Session = Depends(get_db)):
    return _call(tcg_room.collect_parcel, db, parcel_id)


@router.post("/parcels/{parcel_id}/open")
def open_parcel(parcel_id: int, db: Session = Depends(get_db)):
    return _call(tcg_room.open_parcel, db, parcel_id)


@router.post("/inventory/parcels/{parcel_id}/open")
def open_inventory_parcel(parcel_id: int, db: Session = Depends(get_db)):
    return _call(tcg_room.open_parcel, db, parcel_id)


@router.post("/parcels/{parcel_id}/place")
def place_parcel(parcel_id: int, req: ParcelPlacement, db: Session = Depends(get_db)):
    return _call(tcg_room.place_parcel, db, parcel_id, req.model_dump())


def _copy(row: TCGPhysicalCardCopy) -> dict:
    return {
        "id": row.id, "card_id": row.card_id, "copy_ordinal": row.copy_ordinal,
        "acquisition_id": row.acquisition_id, "acquired_at": row.acquired_at,
        "location_kind": row.location_kind, "location_ref": row.location_ref,
        "location_slot": row.location_slot, "trade_locked": row.trade_locked,
    }


@router.get("/copies")
def list_copies(
    card_id: int | None = None, location_kind: str | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(TCGPhysicalCardCopy)
    if card_id is not None:
        query = query.filter(TCGPhysicalCardCopy.card_id == card_id)
    if location_kind is not None:
        query = query.filter(TCGPhysicalCardCopy.location_kind == location_kind)
    return [_copy(row) for row in query.order_by(TCGPhysicalCardCopy.card_id, TCGPhysicalCardCopy.copy_ordinal).all()]


@router.get("/copies/visible")
def visible_copies(db: Session = Depends(get_db)):
    return _call(tcg_room.visible_room_cards, db)


@router.get("/copies/audit")
def audit_copies(db: Session = Depends(get_db)):
    return audit_physical_cards(db)


@router.post("/copies/move")
def move_copies(req: CopyMoves, db: Session = Depends(get_db)):
    try:
        rows = [move_copy(db, item.copy_id, item.location_kind,
                          location_ref=item.location_ref, location_slot=item.location_slot)
                for item in req.moves]
        db.commit()
        return [_copy(row) for row in rows]
    except ValueError as exc:
        db.rollback()
        raise HTTPException(400, str(exc))


@router.post("/copies/move-to-binder")
def move_to_binder(req: BinderCopyMove, db: Session = Depends(get_db)):
    try:
        return move_copies_to_binder(db, req.copy_ids, req.binder_id)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(400, str(exc))


@router.post("/copies/repair")
def repair_copies(req: RepairRequest, db: Session = Depends(get_db)):
    try:
        return repair_physical_cards(db, confirm=req.confirm)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(400, str(exc))

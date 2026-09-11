"""Transactional ownership and location ledger for physical TCG card copies."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
import json

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import (
    Card, CardAcquisition, CardInventory, CardType, PHYSICAL_CARD_LOCATIONS,
    TCGBinder, TCGBinderSection, TCGBinderSlot, TCGDisplayAssignment, TCGPhysicalCardCopy,
    TCGPhysicalCopyMigration,
)


OWNED_LOCATIONS = tuple(value for value in PHYSICAL_CARD_LOCATIONS if value != "traded_away")
REFERENCE_LOCATIONS = {
    "binder_slot", "cabinet_slot", "display_stand", "acrylic_case",
    "toploader", "set_box", "trader_reserved",
}


def _locked(card: Card) -> bool:
    value = card.card_type.value if hasattr(card.card_type, "value") else str(card.card_type)
    return value in {CardType.hof.value, CardType.bond.value}


def _section(db: Session, binder_id: int, name: str) -> TCGBinderSection:
    name = (name or "Main").strip() or "Main"
    row = db.query(TCGBinderSection).filter_by(binder_id=binder_id, name=name).first()
    if row:
        return row
    position = db.query(func.count(TCGBinderSection.id)).filter_by(binder_id=binder_id).scalar() or 0
    row = TCGBinderSection(binder_id=binder_id, name=name, position=position)
    db.add(row)
    db.flush()
    return row


def _inventory_rows(db: Session, card_id: int) -> list[CardInventory]:
    return db.query(CardInventory).filter_by(card_id=card_id).order_by(CardInventory.id).all()


def _consolidate_inventory(db: Session, card_id: int) -> CardInventory | None:
    rows = _inventory_rows(db, card_id)
    if not rows:
        return None
    keeper = rows[0]
    keeper.quantity = sum(max(0, row.quantity or 0) for row in rows)
    for row in rows[1:]:
        db.delete(row)
    return keeper


def audit_physical_cards(db: Session) -> dict:
    """Return ledger inconsistencies without changing persistent state."""
    issues: list[dict] = []
    aggregates = defaultdict(int)
    for card_id, quantity in db.query(CardInventory.card_id, CardInventory.quantity).all():
        aggregates[card_id] += max(0, quantity or 0)
    copies = defaultdict(list)
    for copy in db.query(TCGPhysicalCardCopy).order_by(TCGPhysicalCardCopy.id).all():
        if copy.location_kind != "traded_away":
            copies[copy.card_id].append(copy)
        card = db.get(Card, copy.card_id)
        if card and _locked(card) and not copy.trade_locked:
            issues.append({"code": "protected_copy_unlocked", "copy_id": copy.id})
        if copy.location_kind == "binder_slot":
            slot = db.get(TCGBinderSlot, int(copy.location_ref)) if copy.location_ref else None
            if not slot or slot.physical_copy_id != copy.id:
                issues.append({"code": "binder_location_orphan", "copy_id": copy.id})
    for card_id in sorted(set(aggregates) | set(copies)):
        if aggregates[card_id] != len(copies[card_id]):
            issues.append({
                "code": "aggregate_copy_mismatch", "card_id": card_id,
                "aggregate": aggregates[card_id], "physical": len(copies[card_id]),
            })
    for slot in db.query(TCGBinderSlot).filter(TCGBinderSlot.card_id.isnot(None)).all():
        copy = db.get(TCGPhysicalCardCopy, slot.physical_copy_id) if slot.physical_copy_id else None
        if not copy:
            issues.append({"code": "binder_slot_missing_copy", "slot_id": slot.id})
        elif copy.card_id != slot.card_id or copy.location_kind != "binder_slot" or copy.location_ref != str(slot.id):
            issues.append({"code": "binder_slot_mismatch", "slot_id": slot.id, "copy_id": copy.id})
        section = db.get(TCGBinderSection, slot.section_id) if slot.section_id else None
        if not section or section.binder_id != slot.binder_id or section.name != slot.section_name:
            issues.append({"code": "binder_section_mismatch", "slot_id": slot.id})
    return {
        "healthy": not issues,
        "migration_complete": db.get(TCGPhysicalCopyMigration, 1) is not None,
        "aggregate_total": sum(aggregates.values()),
        "physical_total": sum(len(rows) for rows in copies.values()),
        "issues": issues,
    }


def migrate_physical_cards(db: Session, *, commit: bool = True) -> dict:
    """Deterministically reconcile legacy aggregates and binder slots once."""
    if db.get(TCGPhysicalCopyMigration, 1):
        return {"migrated": False, **audit_physical_cards(db)}
    try:
        inventory = {}
        for card_id, in db.query(CardInventory.card_id).distinct().order_by(CardInventory.card_id).all():
            inventory[card_id] = _consolidate_inventory(db, card_id)
        db.flush()
        slots_by_card = defaultdict(list)
        for slot in db.query(TCGBinderSlot).filter(TCGBinderSlot.card_id.isnot(None)).order_by(
            TCGBinderSlot.binder_id, TCGBinderSlot.section_name,
            TCGBinderSlot.page_number, TCGBinderSlot.slot_number, TCGBinderSlot.id,
        ).all():
            slots_by_card[slot.card_id].append(slot)
            section = _section(db, slot.binder_id, slot.section_name)
            slot.section_id = section.id
        for card_id, slots in slots_by_card.items():
            if len(slots) > (inventory.get(card_id).quantity if inventory.get(card_id) else 0):
                raise ValueError(f"Card {card_id} has more occupied binder slots than owned copies")
        created = 0
        for card_id, inv in sorted(inventory.items()):
            card = db.get(Card, card_id)
            acquisitions = db.query(CardAcquisition).filter_by(card_id=card_id).order_by(
                CardAcquisition.acquired_at.is_(None), CardAcquisition.acquired_at, CardAcquisition.id,
            ).all()
            history = []
            for acquisition in acquisitions:
                history.extend([acquisition] * max(0, acquisition.quantity or 0))
            card_copies = []
            for offset in range(max(0, inv.quantity or 0)):
                acquisition = history[offset] if offset < len(history) else None
                copy = TCGPhysicalCardCopy(
                    card_id=card_id, copy_ordinal=offset + 1,
                    acquisition_id=acquisition.id if acquisition else None,
                    acquired_at=acquisition.acquired_at if acquisition else None,
                    location_kind="unorganized_pile", trade_locked=bool(card and _locked(card)),
                )
                db.add(copy)
                card_copies.append(copy)
                created += 1
            db.flush()
            for slot, copy in zip(slots_by_card.get(card_id, []), card_copies):
                slot.physical_copy_id = copy.id
                copy.location_kind = "binder_slot"
                copy.location_ref = str(slot.id)
                copy.location_slot = slot.slot_number
        report = {"version": 1, "created_copies": created, "migrated_at": datetime.utcnow().isoformat()}
        db.add(TCGPhysicalCopyMigration(id=1, version=1, report_json=json.dumps(report)))
        db.flush()
        audited = audit_physical_cards(db)
        if not audited["healthy"]:
            raise ValueError(f"Physical-copy migration audit failed: {audited['issues']}")
        if commit:
            db.commit()
        return {"migrated": True, **report, **audited}
    except Exception:
        db.rollback()
        raise


def ensure_reconciled(db: Session) -> None:
    if not db.get(TCGPhysicalCopyMigration, 1):
        migrate_physical_cards(db, commit=False)


def grant_card_copy(
    db: Session, card_id: int, *, acquisition_id: int | None = None,
    acquired_at=None, location_kind: str = "unorganized_pile",
) -> TCGPhysicalCardCopy:
    ensure_reconciled(db)
    card = db.get(Card, card_id)
    if not card:
        raise ValueError("Card not found")
    if location_kind not in {"unorganized_pile", "carried"}:
        raise ValueError("New copies must enter an unassigned owned location")
    inv = _consolidate_inventory(db, card_id)
    if not inv:
        inv = CardInventory(card_id=card_id, quantity=0)
        db.add(inv)
    inv.quantity = (inv.quantity or 0) + 1
    ordinal = db.query(func.max(TCGPhysicalCardCopy.copy_ordinal)).filter_by(card_id=card_id).scalar() or 0
    copy = TCGPhysicalCardCopy(
        card_id=card_id, copy_ordinal=ordinal + 1, acquisition_id=acquisition_id,
        acquired_at=acquired_at, location_kind=location_kind, trade_locked=_locked(card),
    )
    db.add(copy)
    db.flush()
    return copy


def remove_card_copy(
    db: Session, card_id: int, *, copy_id: int | None = None,
    count: int = 1, preserve_last: bool = False,
) -> list[int]:
    ensure_reconciled(db)
    inv = _consolidate_inventory(db, card_id)
    if not inv or count < 1 or (preserve_last and (inv.quantity or 0) - count < 1):
        raise ValueError("Not enough removable copies")
    query = db.query(TCGPhysicalCardCopy).filter(
        TCGPhysicalCardCopy.card_id == card_id,
        TCGPhysicalCardCopy.location_kind.in_(("unorganized_pile", "carried")),
        TCGPhysicalCardCopy.trade_locked.is_(False),
    )
    if copy_id is not None:
        query = query.filter(TCGPhysicalCardCopy.id == copy_id)
    rows = query.order_by(TCGPhysicalCardCopy.copy_ordinal.desc()).limit(count).all()
    if len(rows) != count:
        raise ValueError("Requested copies are protected or currently placed")
    removed = [row.id for row in rows]
    for row in rows:
        db.delete(row)
    inv.quantity -= count
    if inv.quantity <= 0:
        db.delete(inv)
    db.flush()
    return removed


def move_copy(
    db: Session, copy_id: int, location_kind: str, *,
    location_ref: str | int | None = None, location_slot: int | None = None,
) -> TCGPhysicalCardCopy:
    ensure_reconciled(db)
    copy = db.get(TCGPhysicalCardCopy, copy_id)
    if not copy or copy.location_kind == "traded_away":
        raise ValueError("Physical copy not found or no longer owned")
    if location_kind not in PHYSICAL_CARD_LOCATIONS:
        raise ValueError("Unknown physical-card location")
    if copy.trade_locked and location_kind in {"trader_reserved", "traded_away"}:
        raise ValueError("This earned copy is permanently protected from trading")
    if location_kind in REFERENCE_LOCATIONS and location_ref is None:
        raise ValueError("This location requires a reference")
    if location_kind not in REFERENCE_LOCATIONS and location_ref is not None:
        raise ValueError("This location cannot have a reference")
    if copy.location_kind == "binder_slot" and copy.location_ref:
        old = db.get(TCGBinderSlot, int(copy.location_ref))
        if old and old.physical_copy_id == copy.id:
            old.physical_copy_id = None
            old.card_id = None
    if copy.location_kind in {"cabinet_slot", "display_stand", "acrylic_case", "toploader", "set_box"}:
        db.query(TCGDisplayAssignment).filter_by(physical_copy_id=copy.id).delete(synchronize_session=False)
    if location_kind == "binder_slot":
        slot = db.get(TCGBinderSlot, int(location_ref))
        if not slot:
            raise ValueError("Binder slot not found")
        if slot.physical_copy_id not in (None, copy.id):
            raise ValueError("Binder slot is occupied")
        section = _section(db, slot.binder_id, slot.section_name)
        slot.section_id = section.id
        slot.physical_copy_id = copy.id
        slot.card_id = copy.card_id
        location_ref = str(slot.id)
        location_slot = slot.slot_number
    copy.location_kind = location_kind
    copy.location_ref = str(location_ref) if location_ref is not None else None
    copy.location_slot = location_slot
    db.flush()
    return copy


def move_copies_to_binder(db: Session, copy_ids: list[int], binder_id: int) -> list[dict]:
    """Place exact physical copies into real normalized binder slots.

    Empty binder pockets are implicit in the 2D UI, so this service creates the
    corresponding TCGBinderSlot rows before moving copies.  The physical-copy
    ledger and the authoritative 2D binder record are updated in one transaction.
    """
    ensure_reconciled(db)
    binder = db.get(TCGBinder, int(binder_id))
    if not binder:
        raise ValueError("Binder not found")
    ordered_ids = list(dict.fromkeys(int(value) for value in copy_ids))
    if not ordered_ids:
        raise ValueError("Choose at least one physical copy")
    copies = db.query(TCGPhysicalCardCopy).filter(TCGPhysicalCardCopy.id.in_(ordered_ids)).all()
    by_id = {row.id: row for row in copies}
    if len(by_id) != len(ordered_ids):
        raise ValueError("One or more physical copies were not found")
    for copy_id in ordered_ids:
        if by_id[copy_id].location_kind not in {"unorganized_pile", "carried"}:
            raise ValueError("Only unorganized or carried copies can be sent to a binder")

    section = _section(db, binder.id, "Main")
    existing = db.query(TCGBinderSlot).filter_by(binder_id=binder.id).all()
    occupied = {(row.page_number, row.slot_number) for row in existing if row.physical_copy_id is not None}
    by_position = {(row.page_number, row.slot_number): row for row in existing}
    result = []
    cursor = 1
    for copy_id in ordered_ids:
        while True:
            page_number = ((cursor - 1) // 9) + 1
            slot_number = ((cursor - 1) % 9) + 1
            cursor += 1
            if (page_number, slot_number) not in occupied:
                break
        slot = by_position.get((page_number, slot_number))
        if slot is None:
            slot = TCGBinderSlot(
                binder_id=binder.id,
                section_id=section.id,
                section_name=section.name,
                page_number=page_number,
                slot_number=slot_number,
            )
            db.add(slot)
            db.flush()
            by_position[(page_number, slot_number)] = slot
        else:
            slot.section_id = section.id
            slot.section_name = section.name
        copy = move_copy(db, copy_id, "binder_slot", location_ref=slot.id)
        occupied.add((page_number, slot_number))
        result.append({
            "copy_id": copy.id,
            "binder_id": binder.id,
            "section_id": section.id,
            "slot_id": slot.id,
            "page_number": page_number,
            "slot_number": slot_number,
        })
    db.commit()
    return result


def set_binder_slot_compat(db: Session, slot: TCGBinderSlot, card_id: int | None) -> None:
    ensure_reconciled(db)
    section = _section(db, slot.binder_id, slot.section_name)
    slot.section_id = section.id
    db.flush()
    if slot.physical_copy_id:
        current = db.get(TCGPhysicalCardCopy, slot.physical_copy_id)
        if current:
            move_copy(db, current.id, "unorganized_pile")
    if card_id is None:
        slot.card_id = None
        slot.physical_copy_id = None
        return
    copy = db.query(TCGPhysicalCardCopy).filter(
        TCGPhysicalCardCopy.card_id == card_id,
        TCGPhysicalCardCopy.location_kind.in_(("unorganized_pile", "carried")),
    ).order_by(TCGPhysicalCardCopy.copy_ordinal).first()
    if not copy:
        raise ValueError("No unassigned owned copy is available")
    move_copy(db, copy.id, "binder_slot", location_ref=slot.id)


def repair_physical_cards(db: Session, *, confirm: bool) -> dict:
    if not confirm:
        raise ValueError("Explicit confirmation is required")
    if not db.get(TCGPhysicalCopyMigration, 1):
        # A confirmed repair may resolve an impossible legacy binder by treating
        # each occupied pocket as evidence of one owned copy. Normal migration
        # never makes this ownership-changing inference.
        required = dict(db.query(TCGBinderSlot.card_id, func.count(TCGBinderSlot.id)).filter(
            TCGBinderSlot.card_id.isnot(None)
        ).group_by(TCGBinderSlot.card_id).all())
        for card_id, count in required.items():
            inv = _consolidate_inventory(db, card_id)
            if not inv:
                inv = CardInventory(card_id=card_id, quantity=count)
                db.add(inv)
            elif (inv.quantity or 0) < count:
                inv.quantity = count
        db.flush()
        migrate_physical_cards(db, commit=False)
    # Preserve the larger ownership signal and identities; repair never deletes
    # a copy merely because one side of the compatibility mirror drifted.
    card_ids = {row[0] for row in db.query(Card.id).all()}
    for card_id in card_ids:
        card = db.get(Card, card_id)
        rows = db.query(TCGPhysicalCardCopy).filter(
            TCGPhysicalCardCopy.card_id == card_id,
            TCGPhysicalCardCopy.location_kind != "traded_away",
        ).all()
        for copy in rows:
            copy.trade_locked = bool(card and _locked(card))
        inv = _consolidate_inventory(db, card_id)
        if rows and not inv:
            inv = CardInventory(card_id=card_id, quantity=len(rows))
            db.add(inv)
        elif inv and len(rows) < (inv.quantity or 0):
            ordinal = db.query(func.max(TCGPhysicalCardCopy.copy_ordinal)).filter_by(card_id=card_id).scalar() or 0
            for _ in range((inv.quantity or 0) - len(rows)):
                ordinal += 1
                db.add(TCGPhysicalCardCopy(
                    card_id=card_id, copy_ordinal=ordinal, location_kind="unorganized_pile",
                    trade_locked=bool(card and _locked(card)),
                ))
        elif inv and len(rows) > (inv.quantity or 0):
            inv.quantity = len(rows)
    db.flush()
    for slot in db.query(TCGBinderSlot).all():
        slot.section_id = _section(db, slot.binder_id, slot.section_name).id
        copy = db.get(TCGPhysicalCardCopy, slot.physical_copy_id) if slot.physical_copy_id else None
        if copy:
            slot.card_id = copy.card_id
            copy.location_kind, copy.location_ref, copy.location_slot = "binder_slot", str(slot.id), slot.slot_number
        elif slot.card_id:
            candidate = db.query(TCGPhysicalCardCopy).filter_by(
                card_id=slot.card_id, location_kind="unorganized_pile"
            ).order_by(TCGPhysicalCardCopy.copy_ordinal).first()
            if candidate:
                move_copy(db, candidate.id, "binder_slot", location_ref=slot.id)
            else:
                slot.card_id = None
                slot.physical_copy_id = None
    db.commit()
    return audit_physical_cards(db)


def merge_printing_copies(db: Session, source_card_id: int, target_card_id: int) -> int:
    """Move all physical identities to a canonical printing without minting copies."""
    ensure_reconciled(db)
    source = _consolidate_inventory(db, source_card_id)
    target = _consolidate_inventory(db, target_card_id)
    if not source:
        return 0
    if not target:
        target = CardInventory(card_id=target_card_id, quantity=0)
        db.add(target)
    next_ordinal = db.query(func.max(TCGPhysicalCardCopy.copy_ordinal)).filter_by(card_id=target_card_id).scalar() or 0
    rows = db.query(TCGPhysicalCardCopy).filter_by(card_id=source_card_id).order_by(TCGPhysicalCardCopy.copy_ordinal).all()
    for row in rows:
        next_ordinal += 1
        row.card_id = target_card_id
        row.copy_ordinal = next_ordinal
        if row.location_kind == "binder_slot" and row.location_ref:
            slot = db.get(TCGBinderSlot, int(row.location_ref))
            if slot:
                slot.card_id = target_card_id
    target.quantity = (target.quantity or 0) + (source.quantity or 0)
    db.delete(source)
    db.flush()
    return len(rows)

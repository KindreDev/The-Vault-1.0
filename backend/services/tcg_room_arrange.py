"""Display stands that arrange themselves: fill empty slots from the room pile
by a rule (a Spice level, a trait, or just your best cards) and put the
stand's cards in order (Safe → Hardcore, or rarest first)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from models import (TCGDisplayAssignment, TCGDisplayItemDefinition, TCGDisplayItemInstance,
                    TCGPhysicalCardCopy)
from services.physical_cards import move_copy
from services.pull_events import RARITY_RANK, SPICE_LEVELS, card_facts

SORTS = {"spice", "rarity", "none"}


def _load(text_value, default):
    import json
    try:
        return json.loads(text_value) if text_value else default
    except (TypeError, ValueError):
        return default


def _matches(rule: str | None, value, fact: dict) -> bool:
    if rule == "spice":
        return fact["spice"] == value
    if rule == "trait":
        return int(value) in fact["tags"]
    return True   # "best": anything, rarest first


def arrange_display(db: Session, instance_id: int, *, sort: str = "spice",
                    fill: str | None = None, value=None) -> dict:
    from services.tcg_room import _holds_cards
    instance = db.get(TCGDisplayItemInstance, instance_id)
    definition = db.get(TCGDisplayItemDefinition, instance.definition_id) if instance else None
    if not instance or not definition or definition.item_type != "display_stand" or not _holds_cards(definition.asset_id):
        raise ValueError("Only card stands can hold cards")
    if sort not in SORTS:
        raise ValueError("Sort must be spice, rarity or none")
    slot_count = _load(definition.footprint_json, {}).get("slots") or 1
    assignments = db.query(TCGDisplayAssignment).filter_by(display_instance_id=instance_id).all()
    held = [row.physical_copy_id for row in assignments]

    added = 0
    free = slot_count - len(held)
    if fill and free > 0:
        pile = db.query(TCGPhysicalCardCopy).filter(TCGPhysicalCardCopy.location_kind == "unorganized_pile").all()
        held_cards = {db.get(TCGPhysicalCardCopy, cid).card_id for cid in held}
        facts = {fact["card_id"]: fact for fact in card_facts(db, list({copy.card_id for copy in pile}))}
        candidates = [copy for copy in pile if copy.card_id in facts and copy.card_id not in held_cards
                      and _matches(fill, value, facts[copy.card_id])]
        candidates.sort(key=lambda copy: -RARITY_RANK.get(facts[copy.card_id]["rarity"], 0))
        picked, picked_cards = [], set()
        for copy in candidates:
            if len(picked) >= free:
                break
            if copy.card_id in picked_cards:
                continue   # one copy of each card per stand
            picked.append(copy.id)
            picked_cards.add(copy.card_id)
        for copy_id in picked:
            move_copy(db, copy_id, "display_stand", location_ref=str(instance_id))
        held += picked
        added = len(picked)

    if sort != "none" and held:
        copies = {cid: db.get(TCGPhysicalCardCopy, cid) for cid in held}
        facts = {fact["card_id"]: fact for fact in card_facts(db, list({c.card_id for c in copies.values()}))}
        spice_rank = {level: n for n, level in enumerate(SPICE_LEVELS)}

        def key(cid):
            fact = facts.get(copies[cid].card_id) or {}
            rarity = RARITY_RANK.get(fact.get("rarity"), 0)
            if sort == "spice":
                return (spice_rank.get(fact.get("spice"), 0), -rarity)
            return (-rarity, spice_rank.get(fact.get("spice"), 0))
        held.sort(key=key)

    # Rewrite the slots in the new order (the slot keys are unique per stand).
    for row in db.query(TCGDisplayAssignment).filter_by(display_instance_id=instance_id).all():
        db.delete(row)
    db.flush()
    for index, copy_id in enumerate(held[:slot_count]):
        db.add(TCGDisplayAssignment(display_instance_id=instance_id, physical_copy_id=copy_id, slot_key=str(index)))
    db.commit()
    return {"instance_id": instance_id, "cards": len(held[:slot_count]), "added": added, "slots": slot_count}

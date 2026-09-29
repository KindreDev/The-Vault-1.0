"""Guarded, one-time reset for rebuilding the pre-release TCG catalogues.

The reset deliberately has no default write path. Call ``preview_prelaunch_rebuild``
to inspect the closure, then call ``apply_prelaunch_rebuild`` only from an
explicitly authorized command after a full database backup has been made.
"""
from __future__ import annotations

from collections import Counter, OrderedDict
import json
import os
from typing import Any

from sqlalchemy import inspect
from sqlalchemy.orm import Session

from models import (
    BondMilestone,
    Card,
    CardAcquisition,
    CardContentClassification,
    CardInventory,
    CardPack,
    CardPresentationOverride,
    CreatorShowcase,
    Creator,
    HofCrown,
    TCGChecklistEntry,
    TCGDisplayAssignment,
    TCGOnlineOrder,
    TCGOnlineOrderLine,
    TCGPackOpening,
    TCGPackOpeningCard,
    TCGPackProduct,
    TCGPackProduct,
    TCGPackToken,
    TCGParcel,
    TCGParcelPack,
    TCGPhysicalCardCopy,
    TCGRelease,
    TCGSet,
    TCGSetupState,
    TCGTraderInventory,
    TCGTraderOffer,
    TCGTraderRequest,
    TCGTraderReservation,
    TCGTraderTransaction,
    TCGTraderTransactionLine,
    TCGBinderSlot,
)


FOUNDATION_RELEASE_CODE = "FND-CORE"
SEPTEMBER_RELEASE_CODE = "REL-2026-09"
HOF_FALLBACK_RARITY = {"day": "epic", "week": "legendary", "month": "celestial", "alltime": "epic"}


class UnsafePrelaunchRebuild(RuntimeError):
    """Raised when the database cannot preserve source history safely."""


def _count(query) -> int:
    return int(query.count())


def _hof_recipe_period_type(visual_recipe: str | None) -> str | None:
    try:
        recipe = json.loads(visual_recipe or "{}")
    except (TypeError, ValueError):
        return None
    snapshot = recipe.get("snapshot") if isinstance(recipe, dict) else None
    period_type = snapshot.get("periodType") if isinstance(snapshot, dict) else None
    return str(period_type).strip().lower() if period_type else None


def _release_targets(db: Session) -> tuple[list[TCGRelease], list[str]]:
    releases = db.query(TCGRelease).order_by(TCGRelease.code).all()
    by_code = {release.code: release for release in releases}
    expected = {FOUNDATION_RELEASE_CODE, SEPTEMBER_RELEASE_CODE}
    missing = sorted(expected - set(by_code))
    return [by_code[code] for code in sorted(expected) if code in by_code], missing


def _bond_fk_is_nullable(db: Session) -> bool:
    try:
        cols = inspect(db.get_bind()).get_columns("bond_milestones")
    except Exception:
        return False
    column = next((col for col in cols if col["name"] == "card_id"), None)
    return bool(column and column.get("nullable"))


def _bond_fk_migration_supported(db: Session) -> bool:
    try:
        return db.get_bind().dialect.name == "sqlite" and any(
            col["name"] == "card_id" for col in inspect(db.get_bind()).get_columns("bond_milestones")
        )
    except Exception:
        return False


def _queries(db: Session, card_ids_subquery, release_ids: list[int]) -> OrderedDict[str, Any]:
    """Return the explicit ORM deletion closure and report-only counts."""
    product_ids = db.query(TCGPackProduct.id).filter(
        TCGPackProduct.release_id.in_(release_ids)
    ).subquery() if release_ids else db.query(TCGPackProduct.id).filter(False).subquery()
    opening_ids = db.query(TCGPackOpening.id).filter(
        (TCGPackOpening.selected_release_id.in_(release_ids) if release_ids else False)
        | TCGPackOpening.product_id.in_(product_ids)
        | TCGPackOpening.id.in_(db.query(TCGPackOpeningCard.opening_id).filter(TCGPackOpeningCard.card_id.in_(card_ids_subquery)))
        | TCGPackOpening.id.in_(db.query(CardAcquisition.pack_opening_id).filter(CardAcquisition.card_id.in_(card_ids_subquery)))
    ).subquery()
    order_ids = db.query(TCGOnlineOrderLine.order_id).filter(
        (TCGOnlineOrderLine.selected_release_id.in_(release_ids) if release_ids else False)
        | TCGOnlineOrderLine.product_id.in_(product_ids)
    ).distinct().subquery()
    parcel_ids = db.query(TCGParcel.id).filter(TCGParcel.order_id.in_(order_ids)).subquery()
    copy_ids = db.query(TCGPhysicalCardCopy.id).filter(TCGPhysicalCardCopy.card_id.in_(card_ids_subquery))
    inventory_ids = db.query(CardInventory.id).filter(CardInventory.card_id.in_(card_ids_subquery))

    return OrderedDict([
        ("bond_milestones_detach", db.query(BondMilestone).filter(BondMilestone.card_id.in_(card_ids_subquery))),
        ("hof_crowns_detach", db.query(HofCrown).filter(HofCrown.card_id.in_(card_ids_subquery))),
        ("creator_showcase", db.query(CreatorShowcase).filter(CreatorShowcase.inventory_id.in_(inventory_ids))),
        ("binder_slots", db.query(TCGBinderSlot).filter(TCGBinderSlot.card_id.in_(card_ids_subquery) | TCGBinderSlot.physical_copy_id.in_(copy_ids))),
        ("display_assignments", db.query(TCGDisplayAssignment).filter(TCGDisplayAssignment.physical_copy_id.in_(copy_ids))),
        ("physical_copies", db.query(TCGPhysicalCardCopy).filter(TCGPhysicalCardCopy.card_id.in_(card_ids_subquery))),
        ("card_acquisitions", db.query(CardAcquisition).filter(CardAcquisition.card_id.in_(card_ids_subquery))),
        ("inventory", db.query(CardInventory).filter(CardInventory.card_id.in_(card_ids_subquery))),
        ("content_classifications", db.query(CardContentClassification).filter(CardContentClassification.card_id.in_(card_ids_subquery))),
        ("presentation_overrides", db.query(CardPresentationOverride).filter(CardPresentationOverride.card_id.in_(card_ids_subquery))),
        ("pack_opening_cards", db.query(TCGPackOpeningCard).filter(TCGPackOpeningCard.card_id.in_(card_ids_subquery))),
        # Offer/copy ids are also serialized into JSON, so clear the pre-release
        # trader ledger as a whole rather than risk retaining stale pointers.
        ("trader_reservations", db.query(TCGTraderReservation)),
        ("trader_transaction_lines", db.query(TCGTraderTransactionLine)),
        ("trader_transactions", db.query(TCGTraderTransaction)),
        ("trader_offers", db.query(TCGTraderOffer)),
        ("trader_requests", db.query(TCGTraderRequest)),
        ("trader_inventory", db.query(TCGTraderInventory)),
        ("checklist_entries", db.query(TCGChecklistEntry).filter(
            TCGChecklistEntry.card_id.in_(card_ids_subquery)
            | (TCGChecklistEntry.release_id.in_(release_ids) if release_ids else False)
        )),
        ("parcel_packs", db.query(TCGParcelPack).filter(
            TCGParcelPack.parcel_id.in_(parcel_ids)
            | TCGParcelPack.opening_id.in_(opening_ids)
            | TCGParcelPack.line_id.in_(db.query(TCGOnlineOrderLine.id).filter(TCGOnlineOrderLine.order_id.in_(order_ids)))
        )),
        ("parcels", db.query(TCGParcel).filter(TCGParcel.id.in_(parcel_ids))),
        ("online_order_lines", db.query(TCGOnlineOrderLine).filter(TCGOnlineOrderLine.order_id.in_(order_ids))),
        ("online_orders", db.query(TCGOnlineOrder).filter(TCGOnlineOrder.id.in_(order_ids))),
        ("pack_openings", db.query(TCGPackOpening).filter(TCGPackOpening.id.in_(opening_ids))),
        ("pack_tokens", db.query(TCGPackToken).filter(TCGPackToken.product_id.in_(product_ids))),
        ("pack_products", db.query(TCGPackProduct).filter(TCGPackProduct.id.in_(product_ids))),
        ("release_sets", db.query(TCGSet).filter(TCGSet.release_id.in_(release_ids) if release_ids else False)),
        ("releases", db.query(TCGRelease).filter(TCGRelease.id.in_(release_ids) if release_ids else False)),
        ("cards", db.query(Card).filter(Card.is_legacy.is_(False))),
    ])


def preview_prelaunch_rebuild(db: Session) -> dict:
    """Return exact current counts and preservation checks without writing."""
    releases, missing_codes = _release_targets(db)
    release_ids = [release.id for release in releases]
    nonlegacy_ids = db.query(Card.id).filter(Card.is_legacy.is_(False)).subquery()
    queries = _queries(db, nonlegacy_ids, release_ids)

    legacy_cards = db.query(Card).filter(Card.is_legacy.is_(True))
    legacy_ids = legacy_cards.with_entities(Card.id).subquery()
    legacy_inventory = db.query(CardInventory).filter(CardInventory.card_id.in_(legacy_ids))
    legacy_copies = db.query(TCGPhysicalCardCopy).filter(TCGPhysicalCardCopy.card_id.in_(legacy_ids))
    bond_definitions = db.query(Card).filter(Card.is_legacy.is_(False), Card.card_type == "bond")
    hof_definitions = db.query(Card).filter(Card.is_legacy.is_(False), Card.card_type == "hof")
    report = {
        "dry_run": True,
        "safe_to_apply": not missing_codes and (_bond_fk_is_nullable(db) or _bond_fk_migration_supported(db)),
        "blockers": [],
        "target_release_codes": [release.code for release in releases],
        "missing_release_codes": missing_codes,
        "release_states": [
            {"code": rel.code, "status": rel.status, "kind": rel.release_kind,
             "checklist_rows": _count(db.query(TCGChecklistEntry).filter(TCGChecklistEntry.release_id == rel.id)),
             "products": _count(db.query(TCGPackProduct).filter(TCGPackProduct.release_id == rel.id)),
             "openings": _count(db.query(TCGPackOpening).filter(TCGPackOpening.selected_release_id == rel.id)),
             "owned_card_rows": _count(db.query(CardInventory).join(Card).join(TCGChecklistEntry, TCGChecklistEntry.card_id == Card.id).filter(TCGChecklistEntry.release_id == rel.id))}
            for rel in releases
        ],
        "preserved": {
            "legacy_card_definitions": _count(legacy_cards),
            "legacy_inventory_rows": _count(legacy_inventory),
            "legacy_owned_quantity": int(sum(row[0] or 0 for row in db.query(CardInventory.quantity).filter(CardInventory.card_id.in_(legacy_ids)).all())),
            "legacy_physical_copies": _count(legacy_copies),
            "bond_milestone_events": _count(db.query(BondMilestone)),
            "hof_crown_results": _count(db.query(HofCrown)),
            "user_profiles": "preserved",
            "creators_and_media": "preserved",
            "economy_and_crafting_balances": "preserved",
        },
        "earned_card_rebuild_plan": {
            "bond_definitions": _count(bond_definitions),
            "distinct_bond_sources": _count(bond_definitions.with_entities(Card.source_image_id).filter(Card.source_image_id.isnot(None)).distinct()),
            "bond_milestone_rows": _count(db.query(BondMilestone)),
            "hof_definitions": _count(hof_definitions),
            "hof_crown_events": _count(db.query(HofCrown)),
            "hof_cards_rebuilt_per_crown": True,
        },
        "removed_or_reset": {
            name: _count(query) for name, query in queries.items()
            if name not in {"bond_milestones_detach", "hof_crowns_detach", "binder_slots"}
        },
        "earned_event_links_detached_then_relinked": {
            "bond_milestones": _count(queries["bond_milestones_detach"]),
            "hof_crowns": _count(queries["hof_crowns_detach"]),
        },
        "legacy_copy_acquisition_links_cleared": _count(db.query(TCGPhysicalCardCopy).filter(
            TCGPhysicalCardCopy.card_id.in_(legacy_ids),
            TCGPhysicalCardCopy.acquisition_id.in_(db.query(CardAcquisition.id).filter(CardAcquisition.card_id.in_(nonlegacy_ids))),
        )),
        "binder_slots_cleared": _count(queries["binder_slots"]),
        "opening_cards": _count(db.query(TCGPackOpeningCard)),
        "old_format_pack_history": _count(db.query(CardPack)),
        "setup_state_rows": _count(db.query(TCGSetupState)),
        "other_release_rows": [
            {"code": rel.code, "kind": rel.release_kind, "status": rel.status}
            for rel in db.query(TCGRelease).filter(~TCGRelease.id.in_(release_ids) if release_ids else True).order_by(TCGRelease.code).all()
        ],
        "schema": {
            "bond_milestones_card_id_nullable": _bond_fk_is_nullable(db),
            "bond_milestone_migration_required": not _bond_fk_is_nullable(db),
            "bond_milestone_migration_supported": _bond_fk_migration_supported(db),
        },
        "limitations": [
            "Pack openings, pack products, tokens, affected orders/parcels, acquisition rows, and card-specific trader history are reset because they refer to deleted pre-release cards or release identities.",
            "TCGSetupState is retained; Foundation status and totals are reset to pending/zero while V2 enablement and the legacy snapshot remain intact.",
            "CardPack rows contain card IDs as JSON without foreign keys; all such old-format pack history must be cleared because those IDs cannot be safely remapped by the schema.",
            "The reset targets REL-2026-09 and FND-CORE. Any additional release row blocks apply for manual review.",
        ],
    }
    if missing_codes:
        report["blockers"].append("Missing required release identities: " + ", ".join(missing_codes))
    if not report["schema"]["bond_milestones_card_id_nullable"] and not report["schema"]["bond_milestone_migration_supported"]:
        report["blockers"].append("bond_milestones.card_id cannot be migrated to nullable by the supported database migration.")
    if report["other_release_rows"]:
        report["blockers"].append("Unexpected release identities exist outside the Foundation and September targets; review them before reset.")
        report["safe_to_apply"] = False
    report["safe_to_apply"] = bool(report["safe_to_apply"] and not report["other_release_rows"])
    return report


def apply_prelaunch_rebuild(db: Session, *, confirmed: bool = False) -> dict:
    """Apply the reset atomically. ``confirmed=True`` is mandatory."""
    if confirmed is not True:
        raise UnsafePrelaunchRebuild("Refusing to apply without explicit confirmation.")
    report = preview_prelaunch_rebuild(db)
    if not report["safe_to_apply"]:
        raise UnsafePrelaunchRebuild("Prelaunch rebuild is blocked: " + "; ".join(report["blockers"]))
    if not _bond_fk_is_nullable(db):
        raise UnsafePrelaunchRebuild("Run the shared Bond schema migration before applying the card reset.")

    release_rows, _ = _release_targets(db)
    release_ids = [release.id for release in release_rows]
    nonlegacy_ids = db.query(Card.id).filter(Card.is_legacy.is_(False)).subquery()
    queries = _queries(db, nonlegacy_ids, release_ids)
    try:
        # Retain earned source events. These links are intentionally detached
        # until the rebuilt Bond/HOF cards exist and their mint services relink.
        db.query(BondMilestone).filter(BondMilestone.card_id.in_(nonlegacy_ids)).update(
            {BondMilestone.card_id: None}, synchronize_session=False
        )
        db.query(HofCrown).filter(HofCrown.card_id.in_(nonlegacy_ids)).update(
            {HofCrown.card_id: None}, synchronize_session=False
        )
        # Retain legacy printings, but break a legacy parallel pointer into the
        # soon-to-be-deleted current catalogue.
        db.query(Card).filter(Card.is_legacy.is_(True), Card.parallel_of_id.in_(nonlegacy_ids)).update(
            {Card.parallel_of_id: None}, synchronize_session=False
        )
        openings_to_remove = db.query(TCGPackOpening.id).filter(
            (TCGPackOpening.selected_release_id.in_(release_ids))
            | TCGPackOpening.product_id.in_(db.query(TCGPackProduct.id).filter(TCGPackProduct.release_id.in_(release_ids)))
            | TCGPackOpening.id.in_(db.query(TCGPackOpeningCard.opening_id).filter(TCGPackOpeningCard.card_id.in_(nonlegacy_ids)))
            | TCGPackOpening.id.in_(db.query(CardAcquisition.pack_opening_id).filter(CardAcquisition.card_id.in_(nonlegacy_ids)))
        ).subquery()
        # Legacy acquisitions can outlive a pack opening. Preserve those rows
        # and detach their optional opening pointer before deleting that log.
        db.query(CardAcquisition).filter(
            CardAcquisition.pack_opening_id.in_(openings_to_remove),
            CardAcquisition.card_id.notin_(nonlegacy_ids),
        ).update({CardAcquisition.pack_opening_id: None}, synchronize_session=False)
        db.query(TCGPhysicalCardCopy).filter(
            TCGPhysicalCardCopy.card_id.notin_(nonlegacy_ids),
            TCGPhysicalCardCopy.acquisition_id.in_(db.query(CardAcquisition.id).filter(CardAcquisition.card_id.in_(nonlegacy_ids))),
        ).update({TCGPhysicalCardCopy.acquisition_id: None}, synchronize_session=False)
        db.query(TCGBinderSlot).filter(TCGBinderSlot.card_id.in_(nonlegacy_ids)).update(
            {TCGBinderSlot.card_id: None}, synchronize_session=False
        )
        db.query(TCGBinderSlot).filter(
            TCGBinderSlot.physical_copy_id.in_(queries["physical_copies"].with_entities(TCGPhysicalCardCopy.id).subquery())
        ).update({TCGBinderSlot.physical_copy_id: None}, synchronize_session=False)

        # Delete children before parents. The report and this ordered list share
        # the same closure to prevent silent omissions.
        delete_order = [
            "creator_showcase", "display_assignments", "physical_copies",
            "card_acquisitions", "inventory", "content_classifications", "presentation_overrides",
            "pack_opening_cards", "trader_reservations", "trader_transaction_lines",
            "trader_transactions", "trader_offers", "trader_requests", "trader_inventory",
            "checklist_entries", "parcel_packs", "parcels", "online_order_lines",
            "online_orders", "pack_openings", "pack_tokens", "pack_products",
            "release_sets", "releases", "cards",
        ]
        for name in delete_order:
            queries[name].delete(synchronize_session=False)

        # Legacy CardPack stores card IDs in unstructured JSON, so the only safe
        # reset is to discard those old-format pack-opening records.
        db.query(CardPack).delete(synchronize_session=False)

        state = db.query(TCGSetupState).filter(TCGSetupState.id == 1).first()
        if state:
            state.foundation_status = "pending"
            state.foundation_total = 0
            state.foundation_target = 0

        db.flush()
        # Recalculate counts after deletes, still inside this transaction.
        report["dry_run"] = False
        report["applied"] = True
        report["post_reset"] = {
            "legacy_cards_remaining": _count(db.query(Card).filter(Card.is_legacy.is_(True))),
            "nonlegacy_cards_remaining": _count(db.query(Card).filter(Card.is_legacy.is_(False))),
            "bond_milestones_retained": _count(db.query(BondMilestone)),
            "bond_milestones_detached": _count(db.query(BondMilestone).filter(BondMilestone.card_id.is_(None))),
            "hof_crowns_retained": _count(db.query(HofCrown)),
            "hof_crowns_detached": _count(db.query(HofCrown).filter(HofCrown.card_id.is_(None))),
            "releases_remaining": _count(db.query(TCGRelease)),
            "legacy_inventory_rows_remaining": _count(db.query(CardInventory).join(Card).filter(Card.is_legacy.is_(True))),
        }
        db.commit()
        return report
    except Exception:
        db.rollback()
        raise


def capture_event_card_links(db: Session) -> dict:
    """Snapshot card-to-event grouping before reset so earned history relinks faithfully."""
    def birth_rarity(card: Card) -> str:
        value = card.rarity.value if hasattr(card.rarity, "value") else card.rarity
        return str(value or "common")

    bond_cards = db.query(Card).filter(Card.is_legacy.is_(False), Card.card_type == "bond").order_by(Card.id).all()
    bond_by_old_id = {
        int(card.id): {
            "image_id": int(card.source_image_id) if card.source_image_id else None,
            "rarity": birth_rarity(card),
            "rarity_class": card.rarity_class,
            "print_rarity": card.print_rarity,
            "milestone_ids": [],
        }
        for card in bond_cards
    }
    for milestone in db.query(BondMilestone).filter(BondMilestone.card_id.in_(list(bond_by_old_id) or [-1])).all():
        bond_by_old_id[int(milestone.card_id)]["milestone_ids"].append(int(milestone.id))
    old_hof_cards = {
        int(card.id): {
            "creator_id": card.source_creator_id,
            "image_id": card.source_image_id,
            "rarity": birth_rarity(card),
            "rarity_class": card.rarity_class,
            "print_rarity": card.print_rarity,
            "recipe_period_type": _hof_recipe_period_type(card.visual_recipe),
            "crown_ids": [],
        }
        for card in db.query(Card).filter(Card.is_legacy.is_(False), Card.card_type == "hof").order_by(Card.id).all()
    }
    crown_snapshots = {}
    for crown in db.query(HofCrown).order_by(HofCrown.id).all():
        linked = old_hof_cards.get(int(crown.card_id)) if crown.card_id is not None else None
        if linked is not None:
            linked["crown_ids"].append(int(crown.id))
        crown_snapshots[int(crown.id)] = linked or {
            "creator_id": crown.creator_id,
            "image_id": crown.image_id,
            "rarity": HOF_FALLBACK_RARITY.get(crown.period_type, "epic"),
            "rarity_class": None,
            "print_rarity": None,
        }
    return {
        "bond_by_old_id": bond_by_old_id,
        "bond_definition_count": len(bond_cards),
        "hof_cards": old_hof_cards,
        "hof_definition_count": len(old_hof_cards),
        "hof_by_crown": crown_snapshots,
    }


def rebuild_preserved_earned_cards(db: Session, links: dict) -> dict:
    """Recreate Bond/HOF cards from preserved event rows, then restore their links."""
    from models import Image
    from services.bond_cards import prepare_bond_visual
    from services.cards import generate_card
    from services.crowns import TIER as HOF_PERIOD_RARITY
    from services.hof_cards import HOF_CROWN_PRINT_RARITY, prepare_hof_visual
    from services.physical_cards import grant_card_copy

    bond_created = 0
    bond_visuals_missing = 0
    milestone_rows = db.query(BondMilestone).filter(BondMilestone.card_id.is_(None)).order_by(
        BondMilestone.image_id, BondMilestone.threshold, BondMilestone.id
    ).all()
    milestone_by_image: dict[int, list[BondMilestone]] = {}
    for row in milestone_rows:
        milestone_by_image.setdefault(int(row.image_id), []).append(row)
    linked_event_ids = set()
    old_bond_snapshots = links.get("bond_by_old_id", {})

    def restore_earned_rarity(card: Card, snapshot: dict) -> None:
        for field in ("rarity_class", "print_rarity"):
            value = snapshot.get(field)
            if value is not None and str(value).strip():
                setattr(card, field, value)

    def set_alltime_hof_rarity(card: Card) -> None:
        rarity = HOF_CROWN_PRINT_RARITY["alltime"]
        card.rarity_class = rarity
        card.print_rarity = rarity

    for old_card_id, snapshot in old_bond_snapshots.items():
        image_id = snapshot.get("image_id")
        if not image_id:
            raise UnsafePrelaunchRebuild(f"Cannot recreate Bond card {old_card_id}: source image is missing.")
        image = db.query(Image).filter(Image.id == image_id).first()
        if not image:
            raise UnsafePrelaunchRebuild(f"Cannot recreate Bond history for missing image {image_id}.")
        card = generate_card(
            db, "bond", source_image_id=image_id,
            baseline_override=snapshot.get("rarity", "common"),
        )
        db.flush()
        restore_earned_rarity(card, snapshot)
        events = [row for row in milestone_by_image.get(int(image_id), [])
                  if int(row.id) in set(snapshot.get("milestone_ids", []))]
        for event in events:
            event.card_id = card.id
            linked_event_ids.add(int(event.id))
        db.flush()
        if image.file_path and os.path.isfile(image.file_path) and image.width and image.height and image.cum_count >= 5:
            prepare_bond_visual(db, card)
        else:
            bond_visuals_missing += 1
        grant_card_copy(db, card.id)
        bond_created += 1

    # Repair any event that had no surviving Bond definition to map back to.
    fallback_images = sorted({int(row.image_id) for row in milestone_rows if int(row.id) not in linked_event_ids})
    for image_id in fallback_images:
        image = db.query(Image).filter(Image.id == image_id).first()
        if not image:
            raise UnsafePrelaunchRebuild(f"Cannot recreate Bond history for missing image {image_id}.")
        events = [row for row in milestone_by_image.get(image_id, []) if int(row.id) not in linked_event_ids]
        card = generate_card(db, "bond", source_image_id=image_id, baseline_override="common")
        db.flush()
        for event in events:
            event.card_id = card.id
            linked_event_ids.add(int(event.id))
        db.flush()
        if image.file_path and os.path.isfile(image.file_path) and image.width and image.height and image.cum_count >= 5:
            prepare_bond_visual(db, card)
        else:
            bond_visuals_missing += 1
        grant_card_copy(db, card.id)
        bond_created += 1

    hof_created = 0
    hof_visuals_missing = 0

    def prepare_preserved_hof_visual(card: Card) -> None:
        nonlocal hof_visuals_missing
        try:
            recipe = prepare_hof_visual(db, card)
        except Exception:
            hof_visuals_missing += 1
            return
        source = recipe.get("source") if isinstance(recipe, dict) else None
        if not isinstance(source, dict) or source.get("kind") not in {"image", "avatar", "placeholder"}:
            hof_visuals_missing += 1

    crowns_by_id = {int(crown.id): crown for crown in db.query(HofCrown).filter(HofCrown.card_id.is_(None)).all()}
    for crown_id, group in links.get("hof_by_crown", {}).items():
        crown = crowns_by_id.get(int(crown_id))
        if not crown:
            continue
        if not crown.creator_id:
            raise UnsafePrelaunchRebuild(f"Cannot recreate Hall of Fame card for crown {crown.id}: creator is missing.")
        override = group.get("rarity") or HOF_PERIOD_RARITY.get(crown.period_type, "epic")
        card = generate_card(
            db, "hof", source_creator_id=group.get("creator_id") or crown.creator_id,
            source_image_id=group.get("image_id") or crown.image_id,
            baseline_override=override,
        )
        db.flush()
        restore_earned_rarity(card, group)
        if crown.period_type == "alltime":
            set_alltime_hof_rarity(card)
        crown.card_id = card.id
        db.flush()
        prepare_preserved_hof_visual(card)
        hof_created += 1

    linked_old_hof_ids = {
        int(old_id) for old_id, snapshot in links.get("hof_cards", {}).items()
        if snapshot.get("crown_ids")
    }
    for old_card_id, snapshot in links.get("hof_cards", {}).items():
        if int(old_card_id) in linked_old_hof_ids:
            continue
        creator_id = snapshot.get("creator_id")
        if not creator_id:
            raise UnsafePrelaunchRebuild(f"Cannot recreate unlinked HOF card {old_card_id}: creator is missing.")
        card = generate_card(db, "hof", source_creator_id=creator_id,
                             source_image_id=snapshot.get("image_id"),
                             baseline_override=snapshot.get("rarity") or "epic")
        db.flush()
        restore_earned_rarity(card, snapshot)
        if snapshot.get("recipe_period_type") == "alltime":
            set_alltime_hof_rarity(card)
        prepare_preserved_hof_visual(card)
        hof_created += 1

    from services.cards import mint_hof_cards
    current_hof_mints = mint_hof_cards(db)

    db.flush()
    recreated_bond_sources = {
        int(snapshot["image_id"]) for snapshot in old_bond_snapshots.values() if snapshot.get("image_id")
    } | set(fallback_images)
    report = {
        "bond_cards_recreated": bond_created,
        "bond_visuals_missing": bond_visuals_missing,
        "bond_definitions_captured": int(links.get("bond_definition_count", 0)),
        "bond_sources_recreated": len(recreated_bond_sources),
        "bond_events_relinked": len(milestone_rows),
        "hof_cards_recreated": hof_created,
        "hof_visuals_missing": hof_visuals_missing,
        "hof_definitions_captured": int(links.get("hof_definition_count", 0)),
        "current_hof_mints_added": current_hof_mints,
        "hof_crowns_relinked": _count(db.query(HofCrown).filter(HofCrown.card_id.isnot(None))),
        "hof_crowns_unlinked": _count(db.query(HofCrown).filter(HofCrown.card_id.is_(None))),
        "bond_events_unlinked": _count(db.query(BondMilestone).filter(BondMilestone.card_id.is_(None))),
    }
    if report["bond_visuals_missing"] or report["hof_visuals_missing"]:
        raise UnsafePrelaunchRebuild(
            "Earned cards are missing valid visual recipes: "
            f"{report['bond_visuals_missing']} Bond, {report['hof_visuals_missing']} HOF."
        )
    if report["bond_events_unlinked"] or report["hof_crowns_unlinked"]:
        raise UnsafePrelaunchRebuild(
            "Earned history remains unlinked: "
            f"{report['bond_events_unlinked']} Bond milestones, {report['hof_crowns_unlinked']} HOF crowns."
        )
    return report


def rebuild_prelaunch_catalogues(db: Session, *, confirmed: bool = False) -> dict:
    """Reset and rebuild both release manifests on a disposable/staging database.

    Release builders commit internally. The CLI therefore runs this against a
    sibling staging copy and replaces the supplied DB only after all phases pass.
    """
    if confirmed is not True:
        raise UnsafePrelaunchRebuild("Refusing to reset or rebuild without explicit confirmation.")
    links = capture_event_card_links(db)
    reset = apply_prelaunch_rebuild(db, confirmed=True)

    from services.foundation_catalog import build_foundation_catalog, foundation_spr_target
    from services.tcg_v2 import _release_card_type, draft_release, get_settings, publish_release

    def validation_diagnostics(report: dict) -> str:
        return json.dumps({
            "errors": report.get("errors") or [],
            "type_distribution": report.get("type_distribution") or {},
            "type_targets": report.get("type_targets") or {},
            "rarity_distribution": report.get("rarity_distribution") or {},
            "rarity_targets": report.get("rarity_targets") or {},
        }, sort_keys=True)

    foundation = build_foundation_catalog(db)
    settings = get_settings(db)
    previous_generation_mode = settings.release_generation_mode
    settings.release_generation_mode = "manual_review"
    db.commit()
    try:
        release = draft_release(db, year=2026, month=9, regenerate=True)
    finally:
        settings = get_settings(db)
        settings.release_generation_mode = previous_generation_mode
        db.commit()
    september_release = db.query(TCGRelease).filter(TCGRelease.code == SEPTEMBER_RELEASE_CODE).first()
    if not september_release:
        raise UnsafePrelaunchRebuild("September draft was not created.")
    validation = json.loads(september_release.validation_report or "{}")
    if not validation.get("valid"):
        raise UnsafePrelaunchRebuild(
            "September draft failed rarity/type validation; staged database will be discarded. "
            f"Validation: {validation_diagnostics(validation)}"
        )
    # Materialize the printings/checklist on the staged DB using the canonical
    # publisher, then immediately return the release to an unpublished state.
    publish_release(db, september_release.id)
    september_release = db.query(TCGRelease).filter(TCGRelease.id == september_release.id).first()
    manifest = json.loads(september_release.manifest_json or "{}")
    materialized_rows = db.query(TCGChecklistEntry, Card).join(
        Card, TCGChecklistEntry.card_id == Card.id,
    ).filter(TCGChecklistEntry.release_id == september_release.id).all()
    actual_type_counts = Counter(
        _release_card_type(card)
        for entry, card in materialized_rows
        if entry.is_base_printing
    )
    actual_type_distribution = dict(actual_type_counts)
    actual_rarity_counts = Counter(
        entry.published_rarity
        for entry, _card in materialized_rows
        if entry.is_base_printing
    )
    actual_rarity_distribution = {
        rarity: int(actual_rarity_counts[rarity]) for rarity in ("C", "R", "SR", "UR")
    }
    actual_rarity_distribution["SPR"] = sum(
        1 for entry, _card in materialized_rows
        if not entry.is_base_printing and entry.published_rarity == "SPR"
    )
    manifest_type_distribution = manifest.get("type_distribution") or {}
    manifest_type_targets = manifest.get("type_targets") or {}
    manifest_rarity_targets = manifest.get("rarity_targets") or {}
    materialized_types_match = (
        actual_type_distribution == manifest_type_distribution
        and actual_type_distribution == manifest_type_targets
    )
    materialized_rarities_match = actual_rarity_distribution == manifest_rarity_targets
    if not materialized_types_match or not materialized_rarities_match:
        raise UnsafePrelaunchRebuild(
            "September materialized checklist differs from its manifest: "
            + json.dumps({
                "errors": validation.get("errors") or [],
                "type_distribution": actual_type_distribution,
                "type_targets": manifest_type_targets,
                "manifest_type_distribution": manifest_type_distribution,
                "rarity_distribution": actual_rarity_distribution,
                "rarity_targets": manifest_rarity_targets,
            }, sort_keys=True)
        )
    september_release.status = "validated"
    september_release.published_at = None
    september_release.available_from = None
    september_release.frozen_at = None
    for tcg_set in db.query(TCGSet).filter(TCGSet.release_id == september_release.id).all():
        tcg_set.frozen_at = None
    for product in db.query(TCGPackProduct).filter(TCGPackProduct.release_id == september_release.id).all():
        product.active = False
        product.purchasable = False
        product.available_from = None
        product.available_until = None
    db.commit()
    earned_cards = rebuild_preserved_earned_cards(db, links)
    db.commit()

    foundation_release = db.query(TCGRelease).filter(TCGRelease.code == FOUNDATION_RELEASE_CODE).first()
    if not foundation_release or not september_release:
        raise UnsafePrelaunchRebuild("A release builder did not recreate both required release identities.")
    foundation_cards = db.query(Card).join(
        TCGChecklistEntry, TCGChecklistEntry.card_id == Card.id,
    ).filter(
        TCGChecklistEntry.release_id == foundation_release.id,
        TCGChecklistEntry.is_base_printing.is_(True),
        Card.parallel_of_id.is_(None),
    ).all()
    foundation_creator_ids = {int(card.source_creator_id) for card in foundation_cards if card.source_creator_id}
    creator_types = {
        int(row.id): str(row.creator_type.value if hasattr(row.creator_type, "value") else row.creator_type)
        for row in db.query(Creator).filter(Creator.id.in_(foundation_creator_ids)).all()
    } if foundation_creator_ids else {}
    foundation_family_counts = {name: 0 for name in ("scene", "gallery", "creator", "character", "cosplay", "collab")}
    for card in foundation_cards:
        card_type = card.card_type.value if hasattr(card.card_type, "value") else str(card.card_type)
        if card_type == "image":
            family = "scene"
        elif card_type == "gallery":
            family = "gallery"
        elif card_type == "variant":
            family = "cosplay"
        elif card_type == "collab":
            family = "collab"
        elif card_type == "creator":
            family = "character" if creator_types.get(card.source_creator_id) == "character" else "creator"
        else:
            continue
        foundation_family_counts[family] += 1
    expected_families = set(foundation_family_counts)
    if len(foundation_cards) != 60_000 or any(foundation_family_counts[name] <= 0 for name in expected_families):
        raise UnsafePrelaunchRebuild(
            f"Foundation preflight failed: expected 60,000 bases and all six families; got {len(foundation_cards)} and {foundation_family_counts}."
        )

    expected_foundation_sprs = foundation_spr_target(len(foundation_cards))
    foundation_spr_cards = db.query(Card.id).filter(
        Card.catalog_code == "FND-001",
        Card.print_rarity == "SPR",
        Card.parallel_of_id.isnot(None),
    ).all()
    foundation_spr_card_count = len(foundation_spr_cards)
    foundation_spr_checklist_count = db.query(TCGChecklistEntry.id).join(
        Card, TCGChecklistEntry.card_id == Card.id,
    ).filter(
        TCGChecklistEntry.release_id == foundation_release.id,
        TCGChecklistEntry.is_base_printing.is_(False),
        TCGChecklistEntry.published_rarity == "SPR",
        Card.catalog_code == "FND-001",
        Card.print_rarity == "SPR",
        Card.parallel_of_id.isnot(None),
    ).count()
    try:
        foundation_manifest = json.loads(foundation_release.manifest_json or "{}")
    except (TypeError, ValueError):
        foundation_manifest = {}
    reported_spr_target = int(foundation_manifest.get("spr_target") or 0)
    reported_spr_count = int(foundation_manifest.get("spr_count") or 0)
    if (
        foundation_spr_card_count < expected_foundation_sprs
        or foundation_spr_checklist_count < expected_foundation_sprs
        or foundation_spr_checklist_count != foundation_spr_card_count
        or reported_spr_target != expected_foundation_sprs
        or reported_spr_count != foundation_spr_card_count
    ):
        raise UnsafePrelaunchRebuild(
            "Foundation SPR preflight failed: expected at least the initial additive quota "
            f"of {expected_foundation_sprs}; got "
            + json.dumps({
                "expected_spr_target": expected_foundation_sprs,
                "manifest_spr_target": reported_spr_target,
                "manifest_spr_count": reported_spr_count,
                "spr_card_count": foundation_spr_card_count,
                "spr_checklist_count": foundation_spr_checklist_count,
            }, sort_keys=True)
        )

    september_checklist = db.query(TCGChecklistEntry).filter(
        TCGChecklistEntry.release_id == september_release.id,
        TCGChecklistEntry.is_base_printing.is_(True),
    ).all()
    manifest_distribution = manifest.get("type_distribution") or {}
    expected_release_types = {"scene", "gallery", "creator", "character", "cosplay", "collab"}
    validation = json.loads(september_release.validation_report or "{}")
    if len(september_checklist) != 620:
        raise UnsafePrelaunchRebuild(f"September must contain 620 base checklist cards; got {len(september_checklist)}.")
    if set(manifest_distribution) != expected_release_types or sum(manifest_distribution.values()) != 620:
        raise UnsafePrelaunchRebuild(f"September manifest lacks the exact six-type 620-card distribution: {manifest_distribution}.")
    if not validation.get("valid"):
        raise UnsafePrelaunchRebuild(
            "September rarity validation report is invalid after materialization. "
            f"Validation: {validation_diagnostics(validation)}"
        )
    if september_release.status != "validated":
        raise UnsafePrelaunchRebuild(f"September must remain validated and unpublished; found {september_release.status}.")
    return {
        "reset": reset,
        "foundation_build": foundation,
        "september_build": release,
        "earned_card_rebuild": earned_cards,
        "final": {
            "foundation_status": foundation_release.status,
            "foundation_base_cards": len(foundation_cards),
            "foundation_family_distribution": foundation_family_counts,
            "foundation_spr_target": expected_foundation_sprs,
            "foundation_spr_cards": foundation_spr_card_count,
            "foundation_spr_checklist_rows": foundation_spr_checklist_count,
            "september_status": september_release.status,
            "september_base_cards": len(september_checklist),
            "september_type_distribution": actual_type_distribution,
            "september_type_distribution_percentages": manifest.get("type_distribution_percentages") or {},
            "september_type_supply": manifest.get("type_supply") or {},
            "september_type_targets": manifest.get("type_targets") or {},
            "september_type_target_adjustments": manifest.get("type_target_adjustments") or {},
            "september_rarity_distribution": actual_rarity_distribution,
            "september_rarity_report_valid": bool(validation.get("valid")),
            "nonlegacy_cards": _count(db.query(Card).filter(Card.is_legacy.is_(False))),
            "legacy_cards": _count(db.query(Card).filter(Card.is_legacy.is_(True))),
        },
    }

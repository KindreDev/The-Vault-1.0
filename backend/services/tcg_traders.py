"""Deterministic weekly trader domain. Runtime behavior is authored and seed-driven."""

from __future__ import annotations

from datetime import date, datetime, timedelta
import hashlib
import json
from pathlib import Path
import random

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import (
    Card, CardAcquisition, CardContentClassification, CardInventory, CardType,
    CraftingMaterials, Image, TCGChecklistEntry, TCGPhysicalCardCopy, TCGRelease,
    TCGTraderDefinition, TCGTraderInventory, TCGTraderOffer, TCGTraderRequest,
    TCGTraderReservation, TCGTraderSimulationReport, TCGTraderTransaction,
    TCGTraderTransactionLine, TCGTraderVisit, UserProfile, image_tags, Tag,
)
from services.physical_cards import grant_card_copy, move_copy, remove_card_copy


RARITY_UNITS = {"C": 1.0, "R": 4.0, "SR": 15.0, "UR": 60.0, "SPR": 180.0}
MANIFEST = Path(__file__).resolve().parents[1] / "data" / "tcg_room" / "traders-v1.json"


def _load(raw, fallback):
    try: return json.loads(raw) if raw else fallback
    except (TypeError, ValueError): return fallback


def _dump(value):
    return json.dumps(value, separators=(",", ":"), sort_keys=True, default=str)


def _enum(value):
    return value.value if hasattr(value, "value") else str(value)


def _seed(*parts) -> str:
    return hashlib.sha256(":".join(map(str, parts)).encode("utf-8")).hexdigest()


def seed_traders(db: Session) -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    visual, dialogue = manifest["visual_manifest"], manifest["dialogue_manifest"]
    expected_codes = [item["id"] for item in manifest["traders"]]
    if len(expected_codes) != 10 or len(set(expected_codes)) != 10:
        raise ValueError("The weekly trader manifest must contain exactly ten unique traders")
    if any(int(item["age"]) < 21 for item in manifest["traders"]):
        raise ValueError("Every weekly trader must be explicitly age 21 or older")
    db.query(TCGTraderDefinition).filter(
        TCGTraderDefinition.code.notin_(expected_codes),
    ).update({TCGTraderDefinition.enabled: False}, synchronize_session=False)
    for item in manifest["traders"]:
        row = db.query(TCGTraderDefinition).filter_by(code=item["id"]).first()
        values = dict(
            name=item["name"], age=item["age"], biography=item["biography"],
            body_style_json=_dump({"description": item["biography"]}), personality=item["personality"],
            preferences_json=_dump(item["preferences"]), dislikes_json=_dump(item["dislikes"]),
            quirks_json=_dump(item["quirks"]), greed=item["greed"], competence=item["competence"],
            risk_tolerance=item["risk"], request_limit=item["request_limit"],
            schedule_weight=item["schedule_weight"], enabled=item["enabled"],
            visual_manifest_json=_dump({**visual, "portrait_key": item["id"]}),
            dialogue_manifest_json=_dump(dialogue),
        )
        if not row:
            row = TCGTraderDefinition(code=item["id"], **values); db.add(row)
        else:
            for key, value in values.items(): setattr(row, key, value)
    db.flush()


def _approved_report(db: Session):
    return db.query(TCGTraderSimulationReport).filter(
        TCGTraderSimulationReport.approved.is_(True), TCGTraderSimulationReport.weeks_simulated >= 100000,
    ).order_by(TCGTraderSimulationReport.approved_at.desc(), TCGTraderSimulationReport.id.desc()).first()


def production_enabled(db: Session) -> bool:
    return _approved_report(db) is not None


def _spr_enabled(db: Session) -> bool:
    report = _approved_report(db)
    return bool(report and _load(report.report_json, {}).get("spr_enabled", False))


def _active_visit(db: Session, visit_id: int) -> TCGTraderVisit:
    visit = db.get(TCGTraderVisit, visit_id)
    if not visit or visit.status != "active" or datetime.now() >= visit.departs_at:
        raise ValueError("This trader visit has ended")
    return visit


def _week_key(day: date | None = None) -> str:
    iso = (day or date.today()).isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def _published_card_ids(db: Session, *, allow_spr: bool) -> list[int]:
    query = db.query(TCGChecklistEntry.card_id).join(TCGRelease).join(Card).filter(
        TCGRelease.status == "published", Card.card_type.notin_([CardType.hof, CardType.bond]),
    )
    if not allow_spr:
        query = query.filter(TCGChecklistEntry.published_rarity != "SPR")
    return sorted({row[0] for row in query.all()})


def _expire_prior_visits(db: Session, active_week: str) -> None:
    """Release abandoned quotes when a later persisted week becomes active."""
    stale = db.query(TCGTraderVisit).filter(
        TCGTraderVisit.week_key < active_week, TCGTraderVisit.status == "active",
    ).all()
    for visit in stale:
        offers = db.query(TCGTraderOffer).filter_by(visit_id=visit.id, status="open").all()
        for offer in offers:
            reservations = db.query(TCGTraderReservation).filter_by(offer_id=offer.id, status="active").all()
            for reservation in reservations:
                _restore_reservation(db, reservation)
            offer.status = "expired"
            offer.resolved_at = datetime.now()
        visit.status = "expired"
    if stale:
        db.commit()


def _assert_transferable_card(db: Session, card_id: int, *, allow_spr: bool) -> Card:
    card = db.get(Card, card_id)
    if not card or _enum(card.card_type) in {"hof", "bond"}:
        raise ValueError("Earned cards cannot enter trader transfers")
    entry = db.query(TCGChecklistEntry).join(TCGRelease).filter(
        TCGChecklistEntry.card_id == card_id, TCGRelease.status == "published",
    ).first()
    if not entry: raise ValueError("Only published cards can enter trader transfers")
    rarity = card.print_rarity or entry.published_rarity or card.rarity_class
    if rarity == "SPR" and not allow_spr:
        raise ValueError("SPR trading is disabled until its simulation is approved")
    return card


def _card_tags(db: Session, card: Card) -> list[str]:
    if not card.source_image_id: return []
    return [row[0] for row in db.query(Tag.name).join(image_tags, Tag.id == image_tags.c.tag_id).filter(image_tags.c.image_id == card.source_image_id).all()]


def valuation_from_inputs(inputs: dict, trader_traits: dict, *, purpose: str, seed: str) -> dict:
    """Pure deterministic valuation core shared by production and economy simulation."""
    preferences = list(trader_traits.get("preferences") or [])
    dislikes = list(trader_traits.get("dislikes") or [])
    competence = min(1.0, max(0.0, float(trader_traits.get("competence", 0.5))))
    preference_subject = {key: value for key, value in inputs.items() if key not in {"trader_preferences", "trader_dislikes"}}
    haystack = _dump(preference_subject).lower()
    likes = sum(str(term).lower() in haystack for term in preferences)
    disliked = sum(str(term).lower() in haystack for term in dislikes)
    mint = 0.8 + min(0.5, max(0.0, float(inputs.get("mint_score", 0) or 0)) / 200.0)
    age = min(1.25, 1.0 + max(0, int(inputs.get("release_age_days", 0) or 0)) / 3650.0)
    owned_quantity = max(0, int(inputs.get("owned_quantity", 0) or 0))
    scarcity = 1.15 if owned_quantity <= 1 else max(0.75, 1.05 - 0.05 * (owned_quantity - 1))
    completion = 1.0 + min(1.0, max(0.0, float(inputs.get("completion_pressure", 0) or 0))) * 0.2
    reprint = 0.9 if inputs.get("reprint") else 1.0
    signature = 1.2 if inputs.get("signature") else 1.0
    preference = min(1.45, max(0.65, 1.0 + likes * 0.12 - disliked * 0.14))
    card_id = inputs.get("card_id", "synthetic")
    rng = random.Random(_seed(seed, card_id, purpose))
    noise_span = 0.04 + (1.0 - competence) * 0.28
    noise = 1.0 + rng.uniform(-noise_span, noise_span)
    multiplier = min(2.4, max(0.45, mint * age * scarcity * completion * reprint * signature * preference * noise))
    rarity = str(inputs.get("rarity") or "C")
    units = max(1.0, RARITY_UNITS.get(rarity, 1.0) * multiplier)
    frozen_inputs = {**inputs, "trader_preferences": preferences, "trader_dislikes": dislikes}
    return {"inputs": frozen_inputs, "multipliers": {"mint": mint, "age": age, "scarcity": scarcity,
            "completion": completion, "reprint": reprint, "signature": signature,
            "preference": preference, "noise": noise}, "units": round(units, 3), "seed": seed}


def valuation(db: Session, card: Card, trader: TCGTraderDefinition, *, purpose: str, seed: str) -> dict:
    rarity = card.print_rarity or card.rarity_class or "C"
    audit = _load(card.mint_audit_json, {})
    recipe = _load(card.visual_recipe, {})
    classification = db.query(CardContentClassification).filter_by(card_id=card.id).first()
    checklist = db.query(TCGChecklistEntry).filter_by(card_id=card.id).order_by(TCGChecklistEntry.id).first()
    release = db.get(TCGRelease, checklist.release_id) if checklist else None
    owned = db.query(func.sum(CardInventory.quantity)).filter_by(card_id=card.id).scalar() or 0
    tags = _card_tags(db, card)
    source = db.get(Image, card.source_image_id) if card.source_image_id else None
    completion_pressure = 0.0
    if checklist and checklist.set_id:
        set_card_ids = [row[0] for row in db.query(TCGChecklistEntry.card_id).filter_by(
            set_id=checklist.set_id, required_for_complete=True,
        ).all()]
        if set_card_ids:
            owned_ids = {row[0] for row in db.query(CardInventory.card_id).filter(
                CardInventory.card_id.in_(set_card_ids), CardInventory.quantity > 0,
            ).all()}
            completion_pressure = len(owned_ids) / len(set_card_ids)
    provenance = audit.get("components", audit)
    inputs = {
        "card_id": card.id, "rarity": rarity, "mint_score": float(audit.get("score", card.crs or 0) or 0),
        "release_age_days": max(0, (datetime.now() - release.published_at).days) if release and release.published_at else 0,
        "reprint": bool(card.parallel_of_id), "completion_pressure": round(completion_pressure, 4),
        "signature": rarity == "SPR" or bool(recipe.get("signature")), "owned_quantity": int(owned),
        "card_type": _enum(card.card_type), "creator_id": card.source_creator_id,
        "character_id": card.linked_character_id, "tags": sorted(tags),
        "exposure": classification.exposure_resolved if classification else "Unknown",
        "intensity": classification.intensity_resolved if classification else "Unknown",
        "medium": "video" if source and source.is_video else "image",
        "engagement_provenance": provenance,
        "engagement": {
            "views": source.view_count if source else 0,
            "view_seconds": source.view_seconds if source else 0,
            "cum_count": source.cum_count if source else 0,
            "edge_count": source.edge_count if source else 0,
            "favorite": bool(source and source.is_favorite),
        },
        "trader_preferences": _load(trader.preferences_json, []), "trader_dislikes": _load(trader.dislikes_json, []),
    }
    return valuation_from_inputs(inputs, {
        "preferences": inputs["trader_preferences"], "dislikes": inputs["trader_dislikes"],
        "competence": trader.competence,
    }, purpose=purpose, seed=seed)


def current_visit(db: Session, *, day: date | None = None) -> dict:
    seed_traders(db)
    week = _week_key(day)
    latest = db.query(TCGTraderVisit).order_by(TCGTraderVisit.week_key.desc()).first()
    # Never materialize a historical week after a later week has been seen.
    # This closes the useful clock-rollback reroll path while retaining the
    # frozen latest visit and its offers.
    if latest and week < latest.week_key:
        week = latest.week_key
    _expire_prior_visits(db, week)
    visit = db.query(TCGTraderVisit).filter_by(week_key=week).first()
    if not visit:
        visit_seed = _seed("vault-weekly-trader", week)
        traders = db.query(TCGTraderDefinition).filter_by(enabled=True).order_by(TCGTraderDefinition.code).all()
        rng = random.Random(visit_seed)
        trader = rng.choices(traders, weights=[row.schedule_weight for row in traders], k=1)[0]
        start = datetime.combine(day or date.today(), datetime.min.time()) - timedelta(days=(day or date.today()).weekday())
        visit = TCGTraderVisit(
            week_key=week, trader_id=trader.id, visit_seed=visit_seed, arrives_at=start,
            departs_at=start + timedelta(days=7), request_allowance=trader.request_limit,
            inventory_frozen_json="[]", conversation_json="[]", offer_state_json="{}",
        )
        db.add(visit); db.flush()
        if production_enabled(db):
            report = _approved_report(db)
            ids = _published_card_ids(db, allow_spr=_spr_enabled(db))
            rng.shuffle(ids)
            frozen = ids[:min(16, len(ids))]
            visit.inventory_frozen_json = _dump(frozen)
            for card_id in frozen:
                card = db.get(Card, card_id)
                quote = valuation(db, card, trader, purpose="stock", seed=visit_seed)
                db.add(TCGTraderInventory(
                    visit_id=visit.id, card_id=card_id, quantity=1, valuation_json=_dump(quote),
                    unit_credits=max(1, round(quote["units"] * 12 * (1.15 + trader.greed * .6))),
                    unit_shards=max(1, round(quote["units"] * 3 * (1.15 + trader.greed * .6))),
                ))
        db.commit()
    trader = db.get(TCGTraderDefinition, visit.trader_id)
    return {"visit_id": visit.id, "week_key": visit.week_key, "seed": visit.visit_seed,
            "production_enabled": production_enabled(db), "requests_remaining": max(0, visit.request_allowance - visit.requests_used),
            "trader": {"id": trader.code, "name": trader.name, "age": trader.age, "biography": trader.biography,
                       "personality": trader.personality, "preferences": _load(trader.preferences_json, []),
                       "dislikes": _load(trader.dislikes_json, []), "quirks": _load(trader.quirks_json, []),
                       "visual_manifest": _load(trader.visual_manifest_json, {}), "dialogue_manifest": _load(trader.dialogue_manifest_json, {})}}


def trader_inventory(db: Session, visit_id: int) -> list[dict]:
    _active_visit(db, visit_id)
    allow_spr = _spr_enabled(db)
    result = []
    for row in db.query(TCGTraderInventory).filter_by(visit_id=visit_id).order_by(TCGTraderInventory.id).all():
        _assert_transferable_card(db, row.card_id, allow_spr=allow_spr)
        result.append({"id": row.id, "card_id": row.card_id, "quantity": row.quantity,
                       "available": row.quantity - row.reserved_quantity, "credits": row.unit_credits,
                       "shards": row.unit_shards, "valuation": _load(row.valuation_json, {})})
    return result


def trade_candidates(db: Session, visit_id: int, limit: int = 120) -> dict:
    """Return only copies the backend currently permits in a trader proposal."""
    _active_visit(db, visit_id)
    safe_limit = min(250, max(1, int(limit)))
    allowed_spr = _spr_enabled(db)
    owned = {
        int(card_id): int(quantity or 0)
        for card_id, quantity in db.query(CardInventory.card_id, CardInventory.quantity).filter(
            CardInventory.quantity > 1,
        ).all()
    }
    candidates = []
    emitted_by_card: dict[int, int] = {}
    if owned:
        rows = db.query(TCGPhysicalCardCopy).filter(
            TCGPhysicalCardCopy.card_id.in_(owned),
            TCGPhysicalCardCopy.trade_locked.is_(False),
            TCGPhysicalCardCopy.location_kind.in_(["unorganized_pile", "carried", "binder_slot"]),
        ).order_by(TCGPhysicalCardCopy.card_id, TCGPhysicalCardCopy.copy_ordinal).all()
        for copy in rows:
            if emitted_by_card.get(copy.card_id, 0) >= max(0, owned.get(copy.card_id, 0) - 1):
                continue
            try:
                card = _assert_transferable_card(db, copy.card_id, allow_spr=allowed_spr)
                _eligible_user_copy(db, copy.id)
            except ValueError:
                continue
            candidates.append({
                "copy_id": copy.id,
                "card_id": card.id,
                "copy_ordinal": copy.copy_ordinal,
                "owned_quantity": owned.get(card.id, 0),
                "location_kind": copy.location_kind,
                "catalog_code": card.catalog_code,
                "rarity": card.print_rarity or card.rarity_class or "C",
                "card_type": _enum(card.card_type),
            })
            emitted_by_card[copy.card_id] = emitted_by_card.get(copy.card_id, 0) + 1
            if len(candidates) >= safe_limit:
                break
    return {
        "items": candidates,
        "policy": {
            "final_copy_protected": True,
            "earned_cards_protected": True,
            "unpublished_cards_protected": True,
            "spr_enabled": allowed_spr,
            "max_copies_per_offer": 5,
        },
    }


def dialogue(db: Session, visit_id: int, action: str | None = None) -> list[dict]:
    visit = db.get(TCGTraderVisit, visit_id)
    if not visit: raise ValueError("Trader visit not found")
    trader = db.get(TCGTraderDefinition, visit.trader_id)
    messages = _load(visit.conversation_json, [])
    if action:
        allowed = {"intro", "browse", "sell", "trade", "requests", "like", "dislike", "counter", "refuse", "accepted", "goodbye"}
        if action not in allowed: raise ValueError("Unknown dialogue action")
        if action == "intro" and any(message.get("action") == "intro" for message in messages if isinstance(message, dict)):
            return messages
        manifest = _load(trader.dialogue_manifest_json, {})
        templates = manifest.get("templates", {}) if isinstance(manifest, dict) else {}
        template = templates.get(action)
        if not isinstance(template, str):
            raise ValueError("Trader dialogue manifest is incomplete")
        text = template.format(
            name=trader.name,
            preferences=", ".join(_load(trader.preferences_json, [])),
            dislikes=", ".join(_load(trader.dislikes_json, [])),
        )
        messages.append({"role": "trader", "action": action, "text": text})
        visit.conversation_json = _dump(messages[-100:]); db.commit()
    return messages


def _eligible_user_copy(db: Session, copy_id: int) -> TCGPhysicalCardCopy:
    copy = db.get(TCGPhysicalCardCopy, copy_id)
    if not copy or copy.trade_locked: raise ValueError("Card copy is unavailable")
    card = _assert_transferable_card(db, copy.card_id, allow_spr=_spr_enabled(db))
    if copy.location_kind not in {"unorganized_pile", "carried", "binder_slot"}: raise ValueError("Card copy must be unplaced or safely removable from a binder")
    inv = db.query(CardInventory).filter_by(card_id=card.id).first()
    reserved_same = db.query(func.count(TCGTraderReservation.id)).join(TCGTraderOffer).join(
        TCGPhysicalCardCopy, TCGTraderReservation.physical_copy_id == TCGPhysicalCardCopy.id,
    ).filter(
        TCGTraderReservation.status == "active", TCGTraderReservation.physical_copy_id.isnot(None),
        TCGTraderReservation.physical_copy_id != copy.id,
        TCGTraderOffer.status == "open", TCGPhysicalCardCopy.card_id == copy.card_id,
    ).scalar() or 0
    if not inv or inv.quantity - reserved_same <= 1: raise ValueError("The final owned copy is protected")
    return copy


def _eligible_user_copies(db: Session, copy_ids: list[int]) -> list[TCGPhysicalCardCopy]:
    unique_ids = list(dict.fromkeys(copy_ids))
    if not unique_ids or len(unique_ids) > 5:
        raise ValueError("Choose between one and five distinct card copies")
    copies = [_eligible_user_copy(db, copy_id) for copy_id in unique_ids]
    counts: dict[int, int] = {}
    for copy in copies:
        counts[copy.card_id] = counts.get(copy.card_id, 0) + 1
    for card_id, offered in counts.items():
        owned = db.query(func.sum(CardInventory.quantity)).filter_by(card_id=card_id).scalar() or 0
        already_reserved = db.query(func.count(TCGTraderReservation.id)).join(
            TCGPhysicalCardCopy, TCGTraderReservation.physical_copy_id == TCGPhysicalCardCopy.id,
        ).filter(
            TCGTraderReservation.status == "active",
            TCGPhysicalCardCopy.card_id == card_id,
        ).scalar() or 0
        if owned - already_reserved - offered < 1:
            raise ValueError("The final owned copy is protected")
    return copies


def _reserve_copy(db: Session, offer: TCGTraderOffer, copy: TCGPhysicalCardCopy) -> None:
    _eligible_user_copy(db, copy.id)
    if db.query(TCGTraderReservation.id).filter_by(physical_copy_id=copy.id, status="active").first():
        raise ValueError("Card copy is already reserved")
    previous = {"kind": copy.location_kind, "ref": copy.location_ref, "slot": copy.location_slot}
    move_copy(db, copy.id, "trader_reserved", location_ref=str(offer.id))
    db.add(TCGTraderReservation(offer_id=offer.id, physical_copy_id=copy.id, previous_location_json=_dump(previous)))


def create_sell_offer(db: Session, visit_id: int, copy_ids: list[int], currency: str) -> dict:
    if currency not in {"credits", "shards"} or not copy_ids: raise ValueError("Choose copies and a payout currency")
    visit = _active_visit(db, visit_id); trader = db.get(TCGTraderDefinition, visit.trader_id)
    if not visit or not production_enabled(db): raise ValueError("Trader inventory is disabled until simulation approval")
    if currency == "credits" and not db.query(UserProfile.id).first(): raise ValueError("Vault Credits wallet is unavailable")
    if currency == "shards" and not db.query(CraftingMaterials.id).first(): raise ValueError("Shards wallet is unavailable")
    copies = _eligible_user_copies(db, copy_ids)
    quote_seed = _seed(visit.visit_seed, "sell", ",".join(map(str, sorted(copy_ids))), currency)
    if db.query(TCGTraderOffer.id).filter_by(offer_seed=quote_seed).first():
        raise ValueError("This exact sell proposal was already persisted for the visit")
    quotes = [valuation(db, db.get(Card, copy.card_id), trader, purpose="sell", seed=quote_seed) for copy in copies]
    units = sum(item["units"] for item in quotes) * (0.72 - trader.greed * .22)
    credits, shards = (max(1, round(units * 10)), 0) if currency == "credits" else (0, max(1, round(units * 2.5)))
    offer = TCGTraderOffer(visit_id=visit.id, offer_seed=quote_seed, offer_kind="sell", user_copy_ids_json=_dump([c.id for c in copies]),
                           credits_delta=credits, shards_delta=shards, valuation_json=_dump(quotes))
    try:
        db.add(offer); db.flush()
        for copy in copies: _reserve_copy(db, offer, copy)
        db.commit()
        return offer_dict(offer)
    except Exception:
        db.rollback()
        raise


def create_buy_offer(db: Session, visit_id: int, inventory_id: int, currency: str) -> dict:
    if currency not in {"credits", "shards"}: raise ValueError("Choose a payment currency")
    visit = _active_visit(db, visit_id); stock = db.get(TCGTraderInventory, inventory_id)
    if not visit or not stock or stock.visit_id != visit.id or not production_enabled(db): raise ValueError("Trader stock is unavailable")
    _assert_transferable_card(db, stock.card_id, allow_spr=_spr_enabled(db))
    if stock.quantity - stock.reserved_quantity < 1: raise ValueError("Trader stock is reserved")
    seed = _seed(visit.visit_seed, "buy", inventory_id, currency)
    if db.query(TCGTraderOffer.id).filter_by(offer_seed=seed).first():
        raise ValueError("This exact purchase proposal was already persisted for the visit")
    cost = stock.unit_credits if currency == "credits" else stock.unit_shards
    offer = TCGTraderOffer(visit_id=visit.id, offer_seed=seed, offer_kind="buy", trader_inventory_id=stock.id,
                           target_card_id=stock.card_id, credits_delta=-cost if currency == "credits" else 0,
                           shards_delta=-cost if currency == "shards" else 0, valuation_json=stock.valuation_json)
    try:
        db.add(offer); db.flush(); stock.reserved_quantity += 1
        db.add(TCGTraderReservation(offer_id=offer.id, inventory_id=stock.id)); db.commit()
        return offer_dict(offer)
    except Exception:
        db.rollback()
        raise


def create_barter_offer(db: Session, visit_id: int, inventory_id: int, copy_ids: list[int], credits: int = 0, shards: int = 0) -> dict:
    if credits < 0 or shards < 0: raise ValueError("Optional payment cannot be negative")
    visit = _active_visit(db, visit_id); stock = db.get(TCGTraderInventory, inventory_id)
    if not visit or not stock or stock.visit_id != visit.id or not production_enabled(db): raise ValueError("Trader stock is unavailable")
    _assert_transferable_card(db, stock.card_id, allow_spr=_spr_enabled(db))
    if stock.quantity - stock.reserved_quantity < 1: raise ValueError("Trader stock is reserved")
    trader = db.get(TCGTraderDefinition, visit.trader_id)
    copies = _eligible_user_copies(db, copy_ids)
    offer_seed = _seed(visit.visit_seed, "barter", inventory_id, ",".join(map(str, sorted(copy_ids))), credits, shards)
    if db.query(TCGTraderOffer.id).filter_by(offer_seed=offer_seed).first():
        raise ValueError("This exact barter proposal was already persisted for the visit")
    user_units = sum(valuation(db, db.get(Card, c.card_id), trader, purpose="barter", seed=offer_seed)["units"] for c in copies)
    target_quote = _load(stock.valuation_json, {})
    target_units = target_quote.get("units", 1) * (1.05 + trader.greed * .75)
    if user_units + credits / 10 + shards / 2.5 < target_units: raise ValueError("Barter value is below the persisted minimum")
    offer = TCGTraderOffer(visit_id=visit.id, offer_seed=offer_seed, offer_kind="barter", trader_inventory_id=stock.id,
                           target_card_id=stock.card_id, user_copy_ids_json=_dump([c.id for c in copies]),
                           credits_delta=-credits, shards_delta=-shards, valuation_json=_dump({"target": target_quote, "user_units": user_units}))
    try:
        db.add(offer); db.flush(); stock.reserved_quantity += 1
        db.add(TCGTraderReservation(offer_id=offer.id, inventory_id=stock.id))
        for copy in copies: _reserve_copy(db, offer, copy)
        db.commit()
        return offer_dict(offer)
    except Exception:
        db.rollback()
        raise


def request_card(db: Session, visit_id: int, card_id: int) -> dict:
    visit = _active_visit(db, visit_id); trader = db.get(TCGTraderDefinition, visit.trader_id)
    if not visit or not production_enabled(db): raise ValueError("Trader requests are disabled until simulation approval")
    prior = db.query(TCGTraderRequest).filter_by(visit_id=visit_id, card_id=card_id).first()
    if prior:
        return {"id": prior.id, "status": prior.status, "result": _load(prior.result_json, {}),
                "requests_remaining": max(0, visit.request_allowance - visit.requests_used)}
    if visit.requests_used >= visit.request_allowance: raise ValueError("This visit's request allowance is exhausted")
    card = db.get(Card, card_id)
    eligible = False
    try:
        card = _assert_transferable_card(db, card_id, allow_spr=_spr_enabled(db))
        eligible = True
    except ValueError:
        card = db.get(Card, card_id)
    index = visit.requests_used; request_seed = _seed(visit.visit_seed, "request", index, card_id)
    visit.requests_used += 1
    accepted = bool(eligible) and random.Random(request_seed).random() < trader.risk_tolerance
    request = TCGTraderRequest(visit_id=visit.id, card_id=card_id, request_index=index, seed=request_seed,
                               status="offered" if accepted else "refused", result_json="{}")
    db.add(request); db.flush()
    if accepted:
        quote = valuation(db, card, trader, purpose="request", seed=request_seed)
        price = max(1, round(quote["units"] * 15 * (1.6 + trader.greed)))
        offer = TCGTraderOffer(visit_id=visit.id, request_id=request.id, offer_seed=request_seed, offer_kind="request",
                               target_card_id=card_id, credits_delta=-price, valuation_json=_dump(quote))
        db.add(offer); db.flush(); request.result_json = _dump({"offer_id": offer.id, "credits": price})
    else: request.result_json = _dump({"reason": "Trader refused this persisted request"})
    db.commit(); return {"id": request.id, "status": request.status, "result": _load(request.result_json, {}), "requests_remaining": visit.request_allowance - visit.requests_used}


def offer_dict(row: TCGTraderOffer) -> dict:
    return {"id": row.id, "visit_id": row.visit_id, "kind": row.offer_kind, "status": row.status,
            "user_copy_ids": _load(row.user_copy_ids_json, []), "target_card_id": row.target_card_id,
            "credits_delta": row.credits_delta, "shards_delta": row.shards_delta, "valuation": _load(row.valuation_json, {})}


def list_offers(db: Session, visit_id: int) -> list[dict]:
    return [offer_dict(row) for row in db.query(TCGTraderOffer).filter_by(visit_id=visit_id).order_by(TCGTraderOffer.id).all()]


def list_requests(db: Session, visit_id: int) -> list[dict]:
    return [{"id": row.id, "card_id": row.card_id, "status": row.status, "result": _load(row.result_json, {})}
            for row in db.query(TCGTraderRequest).filter_by(visit_id=visit_id).order_by(TCGTraderRequest.request_index).all()]


def _restore_reservation(db: Session, reservation: TCGTraderReservation) -> None:
    if reservation.physical_copy_id:
        copy = db.get(TCGPhysicalCardCopy, reservation.physical_copy_id); previous = _load(reservation.previous_location_json, {})
        if copy and copy.location_kind == "trader_reserved":
            try: move_copy(db, copy.id, previous.get("kind", "unorganized_pile"), location_ref=previous.get("ref"), location_slot=previous.get("slot"))
            except ValueError: move_copy(db, copy.id, "unorganized_pile")
    elif reservation.inventory_id:
        stock = db.get(TCGTraderInventory, reservation.inventory_id)
        if stock: stock.reserved_quantity = max(0, stock.reserved_quantity - 1)
    reservation.status = "released"


def refuse_offer(db: Session, offer_id: int) -> dict:
    offer = db.get(TCGTraderOffer, offer_id)
    if not offer or offer.status != "open": raise ValueError("Offer is no longer open")
    for row in db.query(TCGTraderReservation).filter_by(offer_id=offer.id, status="active").all(): _restore_reservation(db, row)
    offer.status = "refused"; offer.resolved_at = datetime.now(); db.commit(); return offer_dict(offer)


def _validate_reservation_shape(offer: TCGTraderOffer, reservations: list[TCGTraderReservation]) -> None:
    physical_ids = sorted(row.physical_copy_id for row in reservations if row.physical_copy_id is not None)
    inventory_ids = [row.inventory_id for row in reservations if row.inventory_id is not None]
    expected_copies = sorted(_load(offer.user_copy_ids_json, []))
    valid = {
        "sell": physical_ids == expected_copies and bool(physical_ids) and not inventory_ids
                and offer.target_card_id is None and offer.credits_delta >= 0 and offer.shards_delta >= 0,
        "buy": not physical_ids and inventory_ids == [offer.trader_inventory_id]
               and offer.target_card_id is not None and offer.credits_delta <= 0 and offer.shards_delta <= 0,
        "barter": physical_ids == expected_copies and bool(physical_ids)
                  and inventory_ids == [offer.trader_inventory_id] and offer.target_card_id is not None
                  and offer.credits_delta <= 0 and offer.shards_delta <= 0,
        "request": not physical_ids and not inventory_ids and offer.target_card_id is not None
                   and offer.credits_delta <= 0 and offer.shards_delta <= 0,
    }.get(offer.offer_kind, False)
    if not valid:
        raise ValueError("Offer reservation ledger is incomplete or invalid")


def accept_offer(db: Session, offer_id: int) -> dict:
    offer = db.get(TCGTraderOffer, offer_id)
    if not offer or offer.status != "open" or not production_enabled(db): raise ValueError("Offer is unavailable")
    _active_visit(db, offer.visit_id)
    profile = db.query(UserProfile).first(); materials = db.query(CraftingMaterials).first()
    if offer.credits_delta < 0 and (not profile or (profile.vault_credits or 0) < -offer.credits_delta): raise ValueError("Insufficient Vault Credits")
    if offer.shards_delta < 0 and (not materials or (materials.shards or 0) < -offer.shards_delta): raise ValueError("Insufficient Shards")
    reservations = db.query(TCGTraderReservation).filter_by(offer_id=offer.id, status="active").all()
    _validate_reservation_shape(offer, reservations)
    allow_spr = _spr_enabled(db)
    frozen_valuation = _load(offer.valuation_json, {})
    ledger_snapshot = {
        "offer": offer_dict(offer),
        "frozen_valuation": frozen_valuation,
        "wallet_before": {
            "credits": (profile.vault_credits or 0) if profile else None,
            "shards": (materials.shards or 0) if materials else None,
        },
    }
    tx = TCGTraderTransaction(visit_id=offer.visit_id, offer_id=offer.id, transaction_kind=offer.offer_kind,
                              credits_delta=offer.credits_delta, shards_delta=offer.shards_delta,
                              valuation_json=_dump(ledger_snapshot))
    try:
        db.add(tx); db.flush()
        for reservation in reservations:
            if reservation.physical_copy_id:
                copy = db.get(TCGPhysicalCardCopy, reservation.physical_copy_id)
                if not copy or copy.trade_locked or copy.location_kind != "trader_reserved" or copy.location_ref != str(offer.id):
                    raise ValueError("Reserved card copy is invalid")
                card_id = copy.card_id
                _assert_transferable_card(db, card_id, allow_spr=allow_spr)
                inv = db.query(CardInventory).filter_by(card_id=card_id).first()
                if not inv or inv.quantity <= 1: raise ValueError("The final owned copy is protected")
                move_copy(db, copy.id, "unorganized_pile")
                remove_card_copy(db, card_id, copy_id=copy.id, preserve_last=True)
                db.add(TCGTraderTransactionLine(transaction_id=tx.id, direction="to_trader", card_id=card_id,
                                                physical_copy_id=copy.id, snapshot_json=reservation.previous_location_json))
            elif reservation.inventory_id:
                stock = db.get(TCGTraderInventory, reservation.inventory_id)
                if (not stock or stock.visit_id != offer.visit_id or stock.id != offer.trader_inventory_id
                        or stock.card_id != offer.target_card_id or stock.quantity < 1 or stock.reserved_quantity < 1):
                    raise ValueError("Reserved stock is invalid")
                _assert_transferable_card(db, stock.card_id, allow_spr=allow_spr)
                stock.quantity -= 1; stock.reserved_quantity -= 1
                card_id = stock.card_id
                acquisition = CardAcquisition(card_id=card_id, quantity=1, acquired_at=datetime.now(), source_type="trader", source_id=str(offer.visit_id))
                db.add(acquisition); db.flush(); copy = grant_card_copy(db, card_id, acquisition_id=acquisition.id, acquired_at=acquisition.acquired_at)
                db.add(TCGTraderTransactionLine(transaction_id=tx.id, direction="to_user", card_id=card_id,
                                                physical_copy_id=copy.id, snapshot_json=stock.valuation_json))
            reservation.status = "consumed"
        if offer.offer_kind == "request" and offer.target_card_id:
            _assert_transferable_card(db, offer.target_card_id, allow_spr=allow_spr)
            acquisition = CardAcquisition(card_id=offer.target_card_id, quantity=1, acquired_at=datetime.now(), source_type="trader_request", source_id=str(offer.visit_id))
            db.add(acquisition); db.flush(); copy = grant_card_copy(db, offer.target_card_id, acquisition_id=acquisition.id, acquired_at=acquisition.acquired_at)
            db.add(TCGTraderTransactionLine(transaction_id=tx.id, direction="to_user", card_id=offer.target_card_id, physical_copy_id=copy.id, snapshot_json=offer.valuation_json))
        if profile: profile.vault_credits = (profile.vault_credits or 0) + offer.credits_delta
        if materials: materials.shards = (materials.shards or 0) + offer.shards_delta
        ledger_snapshot["wallet_after"] = {
            "credits": (profile.vault_credits or 0) if profile else None,
            "shards": (materials.shards or 0) if materials else None,
        }
        tx.valuation_json = _dump(ledger_snapshot)
        offer.status = "accepted"; offer.resolved_at = datetime.now(); db.commit()
        return {"transaction_id": tx.id, "offer": offer_dict(offer)}
    except Exception:
        db.rollback(); raise


def transaction_history(db: Session, limit: int = 100) -> list[dict]:
    result = []
    for row in db.query(TCGTraderTransaction).order_by(TCGTraderTransaction.id.desc()).limit(min(200, max(1, limit))).all():
        lines = db.query(TCGTraderTransactionLine).filter_by(transaction_id=row.id).order_by(TCGTraderTransactionLine.id).all()
        result.append({"id": row.id, "visit_id": row.visit_id, "offer_id": row.offer_id, "kind": row.transaction_kind,
                       "credits_delta": row.credits_delta, "shards_delta": row.shards_delta,
                       "ledger": _load(row.valuation_json, {}), "completed_at": row.completed_at,
                       "lines": [{"direction": line.direction, "card_id": line.card_id,
                                  "physical_copy_id": line.physical_copy_id, "quantity": line.quantity,
                                  "snapshot": _load(line.snapshot_json, {})} for line in lines]})
    return result


def valuation_audit(db: Session, visit_id: int, card_id: int, purpose: str = "audit") -> dict:
    visit = _active_visit(db, visit_id)
    card = _assert_transferable_card(db, card_id, allow_spr=_spr_enabled(db))
    return valuation(db, card, db.get(TCGTraderDefinition, visit.trader_id), purpose=purpose, seed=visit.visit_seed)


def save_simulation_report(db: Session, values: dict) -> dict:
    version = str(values["version"])
    row = db.query(TCGTraderSimulationReport).filter_by(version=version).first()
    if row and row.approved:
        raise ValueError("An approved simulation report is immutable")
    if not row:
        row = TCGTraderSimulationReport(version=version, approved=False)
        db.add(row)
    row.weeks_simulated = int(values.get("weeks_simulated", 0))
    row.seed = str(values.get("seed") or "")
    row.report_json = _dump(values.get("report") or {})
    db.commit()
    return {"id": row.id, "approved": False, "weeks_simulated": row.weeks_simulated}


def approve_simulation_report(db: Session, report_id: int) -> dict:
    row = db.get(TCGTraderSimulationReport, report_id)
    required = {"supply_by_rarity", "spr_leakage", "refusal_rate", "offers_per_week", "average_cards_surrendered",
                "credits_created_removed", "shards_created_removed", "duplicate_depletion", "completion_acceleration", "trader_advantage", "exploit_loops"}
    if not row or row.weeks_simulated < 100000 or not required.issubset(_load(row.report_json, {})):
        raise ValueError("A complete simulation of at least 100,000 visitor weeks is required")
    row.approved = True; row.approved_at = datetime.now(); db.commit()
    return {"id": row.id, "approved": True, "weeks_simulated": row.weeks_simulated}


def list_simulation_reports(db: Session) -> list[dict]:
    return [{"id": row.id, "version": row.version, "weeks_simulated": row.weeks_simulated,
             "approved": row.approved, "report": _load(row.report_json, {})}
            for row in db.query(TCGTraderSimulationReport).order_by(TCGTraderSimulationReport.id.desc()).all()]

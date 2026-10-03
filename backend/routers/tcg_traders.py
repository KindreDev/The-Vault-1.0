"""Thin deterministic daily trader API."""

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from services import tcg_traders


router = APIRouter(prefix="/api/tcg-traders", tags=["TCG traders"])


class DialogueRequest(BaseModel): action: str
class SellQuoteRequest(BaseModel):
    visit_id: int; copy_ids: list[int] = Field(min_length=1); currency: str
class BuyRequest(BaseModel): visit_id: int; inventory_id: int; currency: str = "credits"
class BarterRequest(BaseModel):
    visit_id: int
    inventory_ids: list[int] = Field(default_factory=list)
    inventory_id: int | None = None
    copy_ids: list[int] = Field(default_factory=list)
    credits: int = Field(default=0, ge=0); shards: int = Field(default=0, ge=0)
class SimulationRequest(BaseModel):
    version: str; weeks_simulated: int = Field(ge=0); seed: str; report: dict


def _call(fn, db, *args, **kwargs):
    try: return fn(db, *args, **kwargs)
    except ValueError as exc:
        db.rollback(); raise HTTPException(400, str(exc))


def _barter_inventory_ids(req: BarterRequest) -> list[int]:
    """Keep legacy single-card clients working alongside multi-card clients."""
    ids = list(req.inventory_ids)
    if req.inventory_id is not None and req.inventory_id not in ids:
        ids.append(req.inventory_id)
    return ids


def _payload_object(payload: Any) -> dict:
    if not isinstance(payload, dict):
        raise HTTPException(400, "Send the trader request as a JSON object.")
    return payload


def _positive_id(payload: dict, field: str, label: str) -> int:
    value = payload.get(field)
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise HTTPException(400, f"Enter a valid {label}.")
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        raise HTTPException(400, f"Enter a valid {label}.")
    if parsed <= 0:
        raise HTTPException(400, f"Enter a valid {label}.")
    return parsed


def _physical_copy_ids(payload: dict) -> list[int]:
    raw = payload.get("copy_ids")
    if not isinstance(raw, list) or not raw:
        raise HTTPException(400, "Choose at least one card copy.")
    values = []
    for value in raw:
        if isinstance(value, bool) or not isinstance(value, (int, str)):
            raise HTTPException(400, "Card copy IDs must be whole numbers.")
        try:
            copy_id = int(str(value).strip())
        except (TypeError, ValueError):
            raise HTTPException(400, "Card copy IDs must be whole numbers.")
        if copy_id <= 0:
            raise HTTPException(400, "Card copy IDs must be positive.")
        values.append(copy_id)
    return values


@router.get("/current")
def current(db: Session = Depends(get_db)): return _call(tcg_traders.current_visit, db)

@router.get("/roster")
def roster():
    """Manifest-only profiles for previewing traders without opening a visit."""
    try: return tcg_traders.public_trader_roster()
    except (ValueError, KeyError, TypeError) as exc: raise HTTPException(500, str(exc))

@router.get("/{visit_id}/dialogue")
def get_dialogue(visit_id: int, db: Session = Depends(get_db)): return _call(tcg_traders.dialogue, db, visit_id)

@router.post("/{visit_id}/dialogue")
def post_dialogue(visit_id: int, req: DialogueRequest, db: Session = Depends(get_db)): return _call(tcg_traders.dialogue, db, visit_id, req.action)

@router.get("/{visit_id}/inventory")
def inventory(visit_id: int, db: Session = Depends(get_db)): return _call(tcg_traders.trader_inventory, db, visit_id)

@router.get("/{visit_id}/trade-candidates")
def trade_candidates(visit_id: int, db: Session = Depends(get_db)):
    return _call(tcg_traders.trade_candidates, db, visit_id)

@router.post("/sell/quote")
def sell_quote(req: SellQuoteRequest, db: Session = Depends(get_db)): return _call(tcg_traders.create_sell_offer, db, req.visit_id, req.copy_ids, req.currency)

@router.post("/buy/offer")
def buy_offer(req: BuyRequest, db: Session = Depends(get_db)): return _call(tcg_traders.create_buy_offer, db, req.visit_id, req.inventory_id, req.currency)

@router.post("/barter/quote")
def barter_quote(req: BarterRequest, db: Session = Depends(get_db)):
    return _call(tcg_traders.quote_barter_offer, db, req.visit_id, _barter_inventory_ids(req), req.copy_ids, req.credits, req.shards)

@router.post("/barter/offer")
def barter_offer(req: BarterRequest, db: Session = Depends(get_db)):
    return _call(tcg_traders.create_barter_offer, db, req.visit_id, _barter_inventory_ids(req), req.copy_ids, req.credits, req.shards)

@router.get("/{visit_id}/requests")
def requests(visit_id: int, db: Session = Depends(get_db)): return _call(tcg_traders.list_requests, db, visit_id)

@router.post("/requests")
def request_card(payload: Any = Body(default=None), db: Session = Depends(get_db)):
    body = _payload_object(payload)
    visit_id = _positive_id(body, "visit_id", "trader visit")
    card_reference = body.get("card_id")
    if card_reference is None or (isinstance(card_reference, str) and not card_reference.strip()):
        card_reference = body.get("catalog_code")
    if isinstance(card_reference, bool) or not isinstance(card_reference, (int, str)):
        raise HTTPException(400, "Enter a card ID or catalog code.")
    if isinstance(card_reference, str) and not card_reference.strip():
        raise HTTPException(400, "Enter a card ID or catalog code.")
    return _call(tcg_traders.request_card, db, visit_id, card_reference)


@router.post("/grade/quote")
def grade_quote(payload: Any = Body(default=None), db: Session = Depends(get_db)):
    body = _payload_object(payload)
    visit_id = _positive_id(body, "visit_id", "trader visit")
    copy_ids = _physical_copy_ids(body)
    return _call(tcg_traders.quote_grading, db, visit_id, copy_ids)


@router.post("/grade")
def grade_copies(payload: Any = Body(default=None), db: Session = Depends(get_db)):
    body = _payload_object(payload)
    visit_id = _positive_id(body, "visit_id", "trader visit")
    copy_ids = _physical_copy_ids(body)
    return _call(tcg_traders.purchase_grading, db, visit_id, copy_ids)

@router.get("/{visit_id}/offers")
def offers(visit_id: int, db: Session = Depends(get_db)): return _call(tcg_traders.list_offers, db, visit_id)

@router.post("/offers/{offer_id}/accept")
def accept(offer_id: int, db: Session = Depends(get_db)): return _call(tcg_traders.accept_offer, db, offer_id)

@router.post("/offers/{offer_id}/refuse")
def refuse(offer_id: int, db: Session = Depends(get_db)): return _call(tcg_traders.refuse_offer, db, offer_id)

@router.get("/history/transactions")
def history(limit: int = 100, db: Session = Depends(get_db)): return _call(tcg_traders.transaction_history, db, limit)

@router.get("/{visit_id}/valuation/{card_id}")
def audit(visit_id: int, card_id: int, purpose: str = "audit", db: Session = Depends(get_db)): return _call(tcg_traders.valuation_audit, db, visit_id, card_id, purpose)

@router.get("/developer/simulations")
def simulations(db: Session = Depends(get_db)): return _call(tcg_traders.list_simulation_reports, db)

@router.post("/developer/simulations")
def save_simulation(req: SimulationRequest, db: Session = Depends(get_db)): return _call(tcg_traders.save_simulation_report, db, req.model_dump())

@router.post("/developer/simulations/{report_id}/approve")
def approve_simulation(report_id: int, db: Session = Depends(get_db)): return _call(tcg_traders.approve_simulation_report, db, report_id)

"""Thin deterministic weekly trader API."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from services import tcg_traders


router = APIRouter(prefix="/api/tcg-traders", tags=["TCG traders"])


class DialogueRequest(BaseModel): action: str
class SellQuoteRequest(BaseModel):
    visit_id: int; copy_ids: list[int] = Field(min_length=1, max_length=5); currency: str
class BuyRequest(BaseModel): visit_id: int; inventory_id: int; currency: str = "credits"
class BarterRequest(BaseModel):
    visit_id: int; inventory_id: int; copy_ids: list[int] = Field(min_length=1, max_length=5)
    credits: int = Field(default=0, ge=0); shards: int = Field(default=0, ge=0)
class CardRequest(BaseModel): visit_id: int; card_id: int
class SimulationRequest(BaseModel):
    version: str; weeks_simulated: int = Field(ge=0); seed: str; report: dict


def _call(fn, db, *args, **kwargs):
    try: return fn(db, *args, **kwargs)
    except ValueError as exc:
        db.rollback(); raise HTTPException(400, str(exc))


@router.get("/current")
def current(db: Session = Depends(get_db)): return _call(tcg_traders.current_visit, db)

@router.get("/{visit_id}/dialogue")
def get_dialogue(visit_id: int, db: Session = Depends(get_db)): return _call(tcg_traders.dialogue, db, visit_id)

@router.post("/{visit_id}/dialogue")
def post_dialogue(visit_id: int, req: DialogueRequest, db: Session = Depends(get_db)): return _call(tcg_traders.dialogue, db, visit_id, req.action)

@router.get("/{visit_id}/inventory")
def inventory(visit_id: int, db: Session = Depends(get_db)): return _call(tcg_traders.trader_inventory, db, visit_id)

@router.get("/{visit_id}/trade-candidates")
def trade_candidates(visit_id: int, limit: int = 120, db: Session = Depends(get_db)):
    return _call(tcg_traders.trade_candidates, db, visit_id, limit)

@router.post("/sell/quote")
def sell_quote(req: SellQuoteRequest, db: Session = Depends(get_db)): return _call(tcg_traders.create_sell_offer, db, req.visit_id, req.copy_ids, req.currency)

@router.post("/buy/offer")
def buy_offer(req: BuyRequest, db: Session = Depends(get_db)): return _call(tcg_traders.create_buy_offer, db, req.visit_id, req.inventory_id, req.currency)

@router.post("/barter/offer")
def barter_offer(req: BarterRequest, db: Session = Depends(get_db)): return _call(tcg_traders.create_barter_offer, db, req.visit_id, req.inventory_id, req.copy_ids, req.credits, req.shards)

@router.get("/{visit_id}/requests")
def requests(visit_id: int, db: Session = Depends(get_db)): return _call(tcg_traders.list_requests, db, visit_id)

@router.post("/requests")
def request_card(req: CardRequest, db: Session = Depends(get_db)): return _call(tcg_traders.request_card, db, req.visit_id, req.card_id)

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

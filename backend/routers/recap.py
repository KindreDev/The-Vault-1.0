from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from services import recap as recap_svc

router = APIRouter()

VALID = ("day", "week", "month", "year", "all")


@router.get("/availability")
def get_availability(db: Session = Depends(get_db)):
    """Whether enough usage has been tracked for a recap to be worth reading.
    The sidebar hides the page entirely until this says so."""
    return recap_svc.availability(db)


@router.get("")
def get_recap(period: str = "month", db: Session = Depends(get_db)):
    """The story deck for one window. Thin by design — all the thinking lives in
    services/recap.py, and the frontend just plays whatever cards come back."""
    if period not in VALID:
        raise HTTPException(400, f"period must be one of {', '.join(VALID)}")
    # Enforced here too, not just in the nav: hiding a link is not the same as
    # making the page unreachable by typing the URL.
    if not recap_svc.availability(db)["unlocked"]:
        raise HTTPException(403, "Not enough tracked usage yet")
    return recap_svc.build_deck(db, period)

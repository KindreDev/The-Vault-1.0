"""Tag insights: roles, taste profile, rankings, picks and Tag Hall of Fame."""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from services import tag_insights as insights

router = APIRouter()


class RoleBody(BaseModel):
    role: Optional[str] = None   # None = back to automatic


class SpiceOrderBody(BaseModel):
    image_ids: list[int]


@router.get("/roles")
def roles(db: Session = Depends(get_db)):
    """Every tag with its role; baseline/override lists for the settings page."""
    rows = list(insights.tag_roles(db).values())
    return {
        "baseline_share": insights.BASELINE_SHARE,
        "roles": list(insights.ROLES),
        "tags": sorted(rows, key=lambda r: r["use_count"], reverse=True),
    }


@router.patch("/roles/{tag_id}")
def set_role(tag_id: int, body: RoleBody, db: Session = Depends(get_db)):
    try:
        insights.set_role_override(db, tag_id, body.role)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return insights.tag_roles(db).get(tag_id)


@router.get("/taste")
def taste(limit: int = 20, db: Session = Depends(get_db)):
    """Tags you engage with more than the library average (lift > 1 = more)."""
    return insights.taste_profile(db)[:max(1, min(limit, 100))]


@router.get("/top")
def top(limit: int = 8, db: Session = Depends(get_db)):
    return insights.top_tags(db, limit)


@router.get("/trending")
def trending(limit: int = 8, days: int = 7, db: Session = Depends(get_db)):
    return insights.trending_tags(db, limit, days)


@router.get("/together")
def together(limit: int = 8, db: Session = Depends(get_db)):
    return insights.surprising_pairs(db, limit)


@router.get("/for-you")
def for_you(limit: int = 24, seed: int = 0, media: Literal["all", "photos", "videos"] = "all",
            db: Session = Depends(get_db)):
    return insights.for_you(db, limit, seed, media)


@router.get("/hidden-gems")
def hidden_gems(limit: int = 12, db: Session = Depends(get_db)):
    return insights.hidden_gems(db, limit)


@router.get("/similar/{image_id}")
def similar(image_id: int, limit: int = 24, db: Session = Depends(get_db)):
    return insights.similar_files(db, image_id, limit)


@router.post("/spice-order")
def spice_order(body: SpiceOrderBody, db: Session = Depends(get_db)):
    """Order files Safe → Suggestive → Explicit → Hardcore for a Spice ramp."""
    return insights.spice_order(db, body.image_ids)


@router.get("/tag-hof/{tag_id}")
def tag_hof(tag_id: int, period: Literal["day", "week", "month", "all"] = "all", limit: int = 15,
            ago: int = 0, db: Session = Depends(get_db)):
    return insights.tag_hall_of_fame(db, tag_id, period, limit, ago)

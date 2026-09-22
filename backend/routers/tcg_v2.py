"""TCG V2 release-aware collection API."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from services import tcg_v2
import services.gamification as gami


router = APIRouter(prefix="/api/tcg-v2", tags=["tcg-v2"])


class SettingsRequest(BaseModel):
    advanced_mode: bool | None = None
    release_generation_mode: str | None = None
    ai_confidence_threshold: float | None = None
    enabled_theme_sources: list[str] | None = None


class ClassificationRequest(BaseModel):
    exposure: str | None = None
    intensity: str | None = None


class PresentationRequest(BaseModel):
    signature_x: float | None = None
    signature_y: float | None = None
    signature_scale: float | None = None
    signature_rotation: float | None = None
    artwork_x: float | None = None
    artwork_y: float | None = None
    artwork_scale: float | None = None
    mask: dict[str, Any] | None = None


class BinderRequest(BaseModel):
    name: str
    description: str = ""
    cover_style: str = "obsidian"
    spine_style: str = "standard"
    page_style: str = "nine-pocket"
    cover_image_id: int | None = None
    cover_x: float = Field(default=0.5, ge=0, le=1)
    cover_y: float = Field(default=0.5, ge=0, le=1)
    cover_scale: float = Field(default=1.0, ge=1, le=3)


class BinderUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    cover_style: str | None = None
    spine_style: str | None = None
    page_style: str | None = None
    cover_image_id: int | None = None
    cover_x: float | None = Field(default=None, ge=0, le=1)
    cover_y: float | None = Field(default=None, ge=0, le=1)
    cover_scale: float | None = Field(default=None, ge=1, le=3)


class BinderSlotRequest(BaseModel):
    section_name: str = "Main"
    page_number: int = Field(default=1, ge=1)
    slot_number: int = Field(default=1, ge=1)
    card_id: int | None = None
    sleeve_style: str | None = None
    case_style: str | None = None


class BinderCardsRequest(BaseModel):
    card_ids: list[int] = Field(min_length=1, max_length=500)


class SimulationRequest(BaseModel):
    runs: int = 20000
    card_count: int = 10
    odds: dict[str, float] | None = None
    seed: str = "tcg-v2-simulation"


class OpenPackRequest(BaseModel):
    selected_release_id: int | None = None
    use_token: bool = False


class ReleaseGenerationRequest(BaseModel):
    year: int
    month: int = Field(ge=1, le=12)
    regenerate: bool = False


def _result(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/bootstrap")
def bootstrap(db: Session = Depends(get_db)):
    return tcg_v2.backfill_v2_records(db)


@router.get("/summary")
def summary(db: Session = Depends(get_db)):
    return tcg_v2.workspace_summary(db)


@router.get("/settings")
def settings(db: Session = Depends(get_db)):
    return tcg_v2.settings_dict(tcg_v2.get_settings(db))


@router.patch("/settings")
def patch_settings(request: SettingsRequest, db: Session = Depends(get_db)):
    return _result(tcg_v2.update_settings, db, request.model_dump(exclude_none=True))


@router.get("/cards/{card_id}")
def card_detail(card_id: int, db: Session = Depends(get_db)):
    return _result(tcg_v2.card_detail, db, card_id)


@router.get("/catalog/filter-options")
def catalog_filter_options(db: Session = Depends(get_db)):
    return tcg_v2.catalog_filter_options(db)


@router.get("/catalog")
def catalog(
    ownership: str = "owned", rarity: str | None = None, card_type: str | None = None,
    exposure: str | None = None, intensity: str | None = None, search: str | None = None,
    release_id: int | None = None, set_id: int | None = None, signature: str | None = None,
    creator_id: int | None = None, character_id: int | None = None, binder_id: str | None = None,
    skip: int = 0, limit: int = 100, db: Session = Depends(get_db),
):
    return tcg_v2.catalog(
        db, ownership=ownership, rarity=rarity, card_type=card_type,
        exposure=exposure, intensity=intensity, search=search, skip=skip, limit=limit,
        release_id=release_id, set_id=set_id, signature=signature,
        creator_id=creator_id, character_id=character_id, binder_id=binder_id,
    )


@router.put("/cards/{card_id}/classification")
def classify(card_id: int, request: ClassificationRequest, db: Session = Depends(get_db)):
    return _result(tcg_v2.set_manual_classification, db, card_id, request.exposure, request.intensity)


@router.put("/cards/{card_id}/presentation")
def presentation(card_id: int, request: PresentationRequest, db: Session = Depends(get_db)):
    return _result(tcg_v2.update_presentation_override, db, card_id, request.model_dump(exclude_none=True))


@router.post("/cards/{card_id}/dismantle-duplicate")
def dismantle_duplicate(card_id: int, db: Session = Depends(get_db)):
    return _result(tcg_v2.dismantle_duplicate, db, card_id)


@router.get("/releases")
def releases(db: Session = Depends(get_db)):
    return tcg_v2.list_releases(db)


@router.get("/sets")
def sets(db: Session = Depends(get_db)):
    return tcg_v2.list_sets(db)


@router.post("/releases/generate")
def generate_release(request: ReleaseGenerationRequest, db: Session = Depends(get_db)):
    return _result(
        tcg_v2.draft_release, db, year=request.year, month=request.month,
        regenerate=request.regenerate,
    )


@router.post("/releases/process-due")
def process_due_releases(db: Session = Depends(get_db)):
    return _result(tcg_v2.process_due_releases, db)


@router.get("/releases/{release_id}")
def release(release_id: int, db: Session = Depends(get_db)):
    return _result(tcg_v2.release_detail, db, release_id)


@router.post("/releases/{release_id}/publish")
def publish_release(release_id: int, db: Session = Depends(get_db)):
    return _result(tcg_v2.publish_release, db, release_id)


@router.get("/checklist")
def checklist(
    release_id: int | None = None, set_id: int | None = None,
    skip: int = 0, limit: int = 100, db: Session = Depends(get_db),
):
    return tcg_v2.checklist(db, release_id=release_id, set_id=set_id, skip=skip, limit=limit)


@router.get("/packs")
def packs(db: Session = Depends(get_db)):
    return tcg_v2.list_packs(db)


@router.post("/packs/simulate")
def simulate(request: SimulationRequest):
    return tcg_v2.simulate_pack(request.model_dump())


@router.post("/packs/{product_id}/open")
def open_pack(product_id: int, request: OpenPackRequest, db: Session = Depends(get_db)):
    result = _result(
        tcg_v2.open_pack_product, db, product_id,
        selected_release_id=request.selected_release_id, use_token=request.use_token,
    )
    # The current collection opens packs through TCG V2, so keep the live
    # quest/achievement counters on that path too.
    gami.notify_action(db, "pack_opened", count=1, override_amount=75)
    return result


@router.get("/binders")
def binders(db: Session = Depends(get_db)):
    return tcg_v2.list_binders(db)


@router.post("/binders")
def create_binder(request: BinderRequest, db: Session = Depends(get_db)):
    return _result(tcg_v2.create_binder, db, request.model_dump())


@router.get("/binders/{binder_id}")
def binder(binder_id: int, db: Session = Depends(get_db)):
    return _result(tcg_v2.binder_detail, db, binder_id)


@router.put("/binders/{binder_id}")
def update_binder(binder_id: int, request: BinderUpdateRequest, db: Session = Depends(get_db)):
    return _result(tcg_v2.update_binder, db, binder_id, request.model_dump(exclude_unset=True))


@router.put("/binders/{binder_id}/slot")
def binder_slot(binder_id: int, request: BinderSlotRequest, db: Session = Depends(get_db)):
    return _result(tcg_v2.set_binder_slot, db, binder_id, request.model_dump())


@router.put("/binders/{binder_id}/cards")
def binder_cards(binder_id: int, request: BinderCardsRequest, db: Session = Depends(get_db)):
    return _result(tcg_v2.add_cards_to_binder, db, binder_id, request.card_ids)


@router.get("/workshop")
def workshop(db: Session = Depends(get_db)):
    return tcg_v2.workshop(db)


@router.post("/workshop/{item_id}/unlock")
def unlock_workshop_item(item_id: int, db: Session = Depends(get_db)):
    return _result(tcg_v2.unlock_workshop_item, db, item_id)

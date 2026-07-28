from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db
from models import TagVocabEntry
from schemas import (
    TagVocabEntryOut, TagVocabEntryUpdate, TagVocabBulkUpdate,
    TagVocabList, TagVocabSummary,
)
import services.ai_tagger as ai_tagger

router = APIRouter()


def _model_ready(model: str) -> bool:
    if model == "wd14":
        return ai_tagger.wd14_is_ready()
    if model == "joytag":
        return ai_tagger.joytag_is_ready()
    return False


@router.get("/", response_model=TagVocabList)
def list_vocab(
    model: str,
    search: str = None,
    category: str = None,
    enabled_only: bool = False,
    page: int = 1,
    page_size: int = 100,
    db: Session = Depends(get_db),
):
    if model not in ("wd14", "joytag"):
        raise HTTPException(400, "model must be 'wd14' or 'joytag'")

    q = db.query(TagVocabEntry).filter(TagVocabEntry.model == model)
    if search:
        like = f"%{search.strip().lower()}%"
        q = q.filter(
            (TagVocabEntry.raw_tag.ilike(like)) | (TagVocabEntry.normalized_name.ilike(like))
        )
    if category:
        q = q.filter(TagVocabEntry.category == category)
    if enabled_only:
        q = q.filter(TagVocabEntry.enabled == True)  # noqa: E712

    total = q.count()
    page = max(page, 1)
    page_size = min(max(page_size, 1), 500)
    items = (
        q.order_by(TagVocabEntry.enabled.desc(), TagVocabEntry.raw_tag.asc())
         .offset((page - 1) * page_size)
         .limit(page_size)
         .all()
    )
    return {"total": total, "items": items}


@router.get("/summary", response_model=TagVocabSummary)
def vocab_summary(model: str, db: Session = Depends(get_db)):
    if model not in ("wd14", "joytag"):
        raise HTTPException(400, "model must be 'wd14' or 'joytag'")

    total = db.query(TagVocabEntry).filter(TagVocabEntry.model == model).count()
    enabled = db.query(TagVocabEntry).filter(
        TagVocabEntry.model == model, TagVocabEntry.enabled == True  # noqa: E712
    ).count()
    rows = (
        db.query(TagVocabEntry.category, func.count(TagVocabEntry.id))
          .filter(TagVocabEntry.model == model, TagVocabEntry.enabled == True)  # noqa: E712
          .group_by(TagVocabEntry.category)
          .all()
    )
    return TagVocabSummary(
        model=model,
        model_ready=_model_ready(model),
        total=total,
        enabled=enabled,
        by_category={cat: cnt for cat, cnt in rows},
    )


@router.patch("/{entry_id}", response_model=TagVocabEntryOut)
def update_vocab_entry(entry_id: int, data: TagVocabEntryUpdate, db: Session = Depends(get_db)):
    entry = db.query(TagVocabEntry).filter(TagVocabEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(404, "Tag vocab entry not found")
    if data.enabled is not None:
        entry.enabled = data.enabled
    if data.normalized_name is not None:
        entry.normalized_name = data.normalized_name.strip()
    if data.category is not None:
        entry.category = data.category
    db.commit()
    db.refresh(entry)
    ai_tagger.invalidate_tag_vocab_cache(entry.model)
    return entry


@router.post("/bulk")
def bulk_update_vocab(data: TagVocabBulkUpdate, db: Session = Depends(get_db)):
    if not data.ids:
        return {"updated": 0}
    entries = db.query(TagVocabEntry).filter(TagVocabEntry.id.in_(data.ids)).all()
    models_touched = set()
    for entry in entries:
        entry.enabled = data.enabled
        models_touched.add(entry.model)
    db.commit()
    for model in models_touched:
        ai_tagger.invalidate_tag_vocab_cache(model)
    return {"updated": len(entries)}


@router.post("/reset-defaults")
def reset_defaults(model: str, db: Session = Depends(get_db)):
    if model not in ("wd14", "joytag"):
        raise HTTPException(400, "model must be 'wd14' or 'joytag'")
    db.query(TagVocabEntry).filter(TagVocabEntry.model == model).update(
        {TagVocabEntry.enabled: TagVocabEntry.is_builtin_default}, synchronize_session=False
    )
    db.commit()
    ai_tagger.invalidate_tag_vocab_cache(model)
    return {"message": f"{model} reset to defaults"}

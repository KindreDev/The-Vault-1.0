from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import distinct, func, text
from typing import List

from database import get_db
from models import Tag, image_tags, gallery_tags
from schemas import TagCreate, TagOut, TagUpdate, TagMerge, TagStats

router = APIRouter()


@router.get("/", response_model=List[TagOut])
def list_tags(db: Session = Depends(get_db), category: str = None):
    q = db.query(Tag)
    if category:
        q = q.filter(Tag.category == category)
    return q.order_by(Tag.use_count.desc()).all()


@router.post("/", response_model=TagOut, status_code=201)
def create_tag(data: TagCreate, db: Session = Depends(get_db)):
    existing = db.query(Tag).filter(Tag.name == data.name.lower().strip()).first()
    if existing:
        return existing
    tag = Tag(**data.model_dump())
    tag.name = tag.name.lower().strip()
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


@router.get("/categories")
def tag_categories(db: Session = Depends(get_db)):
    return [r[0] for r in db.query(distinct(Tag.category)).all()]


@router.get("/category-samples")
def category_samples(limit: int = 6, db: Session = Depends(get_db)):
    """Returns sample image thumbnails for each tag category (used by overview cards)."""
    cats = [r[0] for r in db.execute(
        text("SELECT DISTINCT category FROM tags ORDER BY category")
    ).fetchall()]
    result = {}
    for cat in cats:
        rows = db.execute(text("""
            SELECT DISTINCT i.id, i.thumb_path
            FROM images i
            JOIN image_tags it ON it.image_id = i.id
            JOIN tags t ON t.id = it.tag_id
            WHERE t.category = :cat
              AND i.thumb_path IS NOT NULL
              AND i.is_video = 0
            ORDER BY i.cum_count DESC, i.id DESC
            LIMIT :limit
        """), {"cat": cat, "limit": limit}).fetchall()
        result[cat] = [{"id": r[0], "thumb_path": r[1]} for r in rows]
    return result


@router.get("/stats", response_model=TagStats)
def tag_stats(db: Session = Depends(get_db)):
    total_tags = db.query(Tag).count()
    # Count distinct images that have at least one tag
    total_tagged_images = db.execute(
        text("SELECT COUNT(DISTINCT image_id) FROM image_tags")
    ).scalar() or 0
    # Count per category
    rows = db.query(Tag.category, func.count(Tag.id)).group_by(Tag.category).all()
    by_category = {cat: cnt for cat, cnt in rows}
    return TagStats(
        total_tags=total_tags,
        total_tagged_images=total_tagged_images,
        by_category=by_category,
    )


@router.get("/trending")
def trending_tags(limit: int = 8, days: int = 30, db: Session = Depends(get_db)):
    """Tags with the most associations on recently-added images."""
    rows = db.execute(text("""
        SELECT t.id, t.name, t.category, t.use_count,
               COUNT(it.image_id) AS recent_count
        FROM tags t
        JOIN image_tags it ON it.tag_id = t.id
        JOIN images i ON i.id = it.image_id
        WHERE i.created_at >= datetime('now', :days)
        GROUP BY t.id
        ORDER BY recent_count DESC
        LIMIT :limit
    """), {"days": f"-{days} days", "limit": limit}).fetchall()
    return [{"id": r[0], "name": r[1], "category": r[2],
             "use_count": r[3], "recent_count": r[4]} for r in rows]


@router.get("/co-occurring")
def co_occurring_tags(limit: int = 10, db: Session = Depends(get_db)):
    """Top tag pairs that frequently appear together on the same image."""
    rows = db.execute(text("""
        SELECT t1.id AS tag1_id, t1.name AS tag1_name, t1.category AS tag1_cat,
               t2.id AS tag2_id, t2.name AS tag2_name, t2.category AS tag2_cat,
               COUNT(*) AS co_count
        FROM image_tags it1
        JOIN image_tags it2 ON it1.image_id = it2.image_id AND it1.tag_id < it2.tag_id
        JOIN tags t1 ON t1.id = it1.tag_id
        JOIN tags t2 ON t2.id = it2.tag_id
        GROUP BY it1.tag_id, it2.tag_id
        ORDER BY co_count DESC
        LIMIT :limit
    """), {"limit": limit}).fetchall()
    return [{"tag1": {"id": r[0], "name": r[1], "category": r[2]},
             "tag2": {"id": r[3], "name": r[4], "category": r[5]},
             "co_count": r[6]} for r in rows]


@router.get("/{tag_id}", response_model=TagOut)
def get_tag(tag_id: int, db: Session = Depends(get_db)):
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(404, "Tag not found")
    return tag


@router.get("/{tag_id}/images")
def tag_images(tag_id: int, limit: int = 48, offset: int = 0, db: Session = Depends(get_db)):
    """Paginated images that have this tag, ordered by cum_count desc."""
    if not db.query(Tag).filter(Tag.id == tag_id).first():
        raise HTTPException(404, "Tag not found")
    total = db.execute(text("""
        SELECT COUNT(*) FROM image_tags it
        JOIN images i ON i.id = it.image_id
        WHERE it.tag_id = :id
    """), {"id": tag_id}).scalar() or 0
    rows = db.execute(text("""
        SELECT i.id, i.thumb_path, i.gallery_id, i.is_video, i.cum_count, it.confidence
        FROM images i
        JOIN image_tags it ON it.image_id = i.id
        WHERE it.tag_id = :tag_id
        ORDER BY i.cum_count DESC, i.id DESC
        LIMIT :limit OFFSET :offset
    """), {"tag_id": tag_id, "limit": limit, "offset": offset}).fetchall()
    return {
        "total": total,
        "items": [{"id": r[0], "thumb_path": r[1], "gallery_id": r[2],
                   "is_video": bool(r[3]), "cum_count": r[4], "confidence": r[5]}
                  for r in rows],
    }


@router.patch("/{tag_id}", response_model=TagOut)
def update_tag(tag_id: int, data: TagUpdate, db: Session = Depends(get_db)):
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(404, "Tag not found")
    if data.name is not None:
        new_name = data.name.lower().strip()
        conflict = db.query(Tag).filter(Tag.name == new_name, Tag.id != tag_id).first()
        if conflict:
            raise HTTPException(400, f"Tag '{new_name}' already exists")
        tag.name = new_name
    if data.category is not None:
        tag.category = data.category
    db.commit()
    db.refresh(tag)
    return tag


@router.delete("/{tag_id}", status_code=204)
def delete_tag(tag_id: int, db: Session = Depends(get_db)):
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(404, "Tag not found")
    db.execute(image_tags.delete().where(image_tags.c.tag_id == tag_id))
    db.execute(gallery_tags.delete().where(gallery_tags.c.tag_id == tag_id))
    db.delete(tag)
    db.commit()


@router.post("/recalculate-counts")
def recalculate_counts(db: Session = Depends(get_db)):
    """Sync use_count on every tag to the actual number of rows in image_tags."""
    db.execute(text("""
        UPDATE tags SET use_count = (
            SELECT COUNT(*) FROM image_tags it
            JOIN images i ON i.id = it.image_id
            WHERE it.tag_id = tags.id
        )
    """))
    db.commit()
    return {"updated": db.query(Tag).count()}


@router.post("/merge", response_model=TagOut)
def merge_tags(data: TagMerge, db: Session = Depends(get_db)):
    """Merge source_id into target_id: moves all associations, deletes source."""
    source = db.query(Tag).filter(Tag.id == data.source_id).first()
    target = db.query(Tag).filter(Tag.id == data.target_id).first()
    if not source:
        raise HTTPException(404, f"Source tag {data.source_id} not found")
    if not target:
        raise HTTPException(404, f"Target tag {data.target_id} not found")
    if source.id == target.id:
        raise HTTPException(400, "Cannot merge a tag into itself")

    # For image_tags: delete any rows where the image already has the target tag
    # (to avoid PK conflict), then move the rest over.
    db.execute(text("""
        DELETE FROM image_tags
        WHERE tag_id = :src
          AND image_id IN (
            SELECT image_id FROM image_tags WHERE tag_id = :tgt
          )
    """), {"src": data.source_id, "tgt": data.target_id})
    db.execute(text("""
        UPDATE image_tags SET tag_id = :tgt WHERE tag_id = :src
    """), {"src": data.source_id, "tgt": data.target_id})

    # Same for gallery_tags
    db.execute(text("""
        DELETE FROM gallery_tags
        WHERE tag_id = :src
          AND gallery_id IN (
            SELECT gallery_id FROM gallery_tags WHERE tag_id = :tgt
          )
    """), {"src": data.source_id, "tgt": data.target_id})
    db.execute(text("""
        UPDATE gallery_tags SET tag_id = :tgt WHERE tag_id = :src
    """), {"src": data.source_id, "tgt": data.target_id})

    # Recalculate use_count for target
    new_count = db.execute(
        text("SELECT COUNT(*) FROM image_tags WHERE tag_id = :tgt"),
        {"tgt": data.target_id}
    ).scalar() or 0
    target.use_count = new_count

    db.delete(source)
    db.commit()
    db.refresh(target)
    return target

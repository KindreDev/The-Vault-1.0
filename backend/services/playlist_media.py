"""Bounded browsing of gallery contents for the playlist media picker."""
from sqlalchemy.orm import selectinload
from models import Gallery, Image, mix_images


def gallery_media_page(db, gallery_id, *, search='', skip=0, limit=96):
    gallery = db.query(Gallery).filter(Gallery.id == gallery_id).first()
    if gallery is None:
        raise LookupError('Gallery not found')
    query = db.query(Image).options(
        selectinload(Image.tags),
        selectinload(Image.gallery).selectinload(Gallery.creators),
        selectinload(Image.image_creators),
    )
    if gallery.is_mix:
        query = query.join(mix_images, mix_images.c.image_id == Image.id).filter(mix_images.c.gallery_id == gallery_id)
        order = mix_images.c.sort_order
    else:
        query = query.filter(Image.gallery_id == gallery_id)
        order = Image.sort_order
    if search:
        query = query.filter(Image.filename.ilike(f'%{search}%'))
    total = query.count()
    rows = query.order_by(order.asc(), Image.id.asc()).offset(max(0, skip)).limit(max(1, min(200, limit))).all()
    return rows, total

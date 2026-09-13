"""Database cleanup for gallery deletion."""

from sqlalchemy import delete, update
from sqlalchemy.orm import Session

from models import (
    ActivityEvent,
    Card,
    Gallery,
    Image,
    SessionLog,
    gallery_creators,
    gallery_tags,
    image_creators,
    image_tags,
    mix_images,
    playlist_images,
)


def delete_gallery_record(db: Session, gallery: Gallery) -> None:
    """Delete a gallery while preserving history and published cards.

    Historical rows and cards keep existing but lose links to content that no
    longer exists. Association rows are removed before the media rows so SQLite
    foreign-key enforcement cannot leave a half-deleted gallery behind.
    """
    image_ids = [
        image_id
        for (image_id,) in db.query(Image.id).filter(Image.gallery_id == gallery.id).all()
    ]

    db.execute(
        update(SessionLog)
        .where(SessionLog.gallery_id == gallery.id)
        .values(gallery_id=None)
    )
    db.execute(
        update(ActivityEvent)
        .where(ActivityEvent.gallery_id == gallery.id)
        .values(gallery_id=None)
    )
    db.execute(
        update(Card)
        .where(Card.source_gallery_id == gallery.id)
        .values(source_gallery_id=None)
    )

    if image_ids:
        db.execute(
            update(SessionLog)
            .where(SessionLog.image_id.in_(image_ids))
            .values(image_id=None)
        )
        db.execute(
            update(ActivityEvent)
            .where(ActivityEvent.image_id.in_(image_ids))
            .values(image_id=None)
        )
        db.execute(
            update(Card)
            .where(Card.source_image_id.in_(image_ids))
            .values(source_image_id=None)
        )
        db.execute(delete(image_tags).where(image_tags.c.image_id.in_(image_ids)))
        db.execute(delete(image_creators).where(image_creators.c.image_id.in_(image_ids)))
        db.execute(delete(playlist_images).where(playlist_images.c.image_id.in_(image_ids)))
        db.execute(delete(mix_images).where(mix_images.c.image_id.in_(image_ids)))

    db.execute(delete(gallery_tags).where(gallery_tags.c.gallery_id == gallery.id))
    db.execute(delete(gallery_creators).where(gallery_creators.c.gallery_id == gallery.id))
    db.execute(delete(mix_images).where(mix_images.c.gallery_id == gallery.id))
    db.execute(delete(Image).where(Image.gallery_id == gallery.id))
    db.execute(delete(Gallery).where(Gallery.id == gallery.id))

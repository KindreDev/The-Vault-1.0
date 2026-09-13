"""Database cleanup for gallery and individual-media deletion."""

import json

from sqlalchemy import delete, update
from sqlalchemy.orm import Session

from models import (
    ActivityEvent,
    BondMilestone,
    Card,
    FeedPost,
    FeedStory,
    Gallery,
    HofCrown,
    Image,
    IntakeItem,
    PanelPlaylistEntry,
    SessionLog,
    TCGBinder,
    gallery_creators,
    gallery_tags,
    image_creators,
    image_tags,
    mix_images,
    playlist_images,
)


def detach_image_references(db: Session, image_ids: list[int]) -> None:
    """Detach every durable reference before deleting media rows.

    SQLite enforces these foreign keys.  Deleting an Image directly used to
    fail as soon as that file had view/activity history, which is especially
    common for videos that have been previewed before the delete action.
    """
    ids = sorted({int(image_id) for image_id in image_ids if image_id})
    if not ids:
        return

    # Historical records and published objects survive, but no longer point at
    # a media row that the user deliberately removed.
    db.execute(update(SessionLog).where(SessionLog.image_id.in_(ids)).values(image_id=None))
    db.execute(update(ActivityEvent).where(ActivityEvent.image_id.in_(ids)).values(image_id=None))
    db.execute(update(Card).where(Card.source_image_id.in_(ids)).values(source_image_id=None))
    db.execute(update(TCGBinder).where(TCGBinder.cover_image_id.in_(ids)).values(cover_image_id=None))
    db.execute(update(HofCrown).where(HofCrown.image_id.in_(ids)).values(image_id=None))

    # A Bond milestone cannot exist without its source image in the current
    # schema.  Remove only those evidence rows; the earned Card itself remains.
    db.execute(delete(BondMilestone).where(BondMilestone.image_id.in_(ids)))

    db.execute(delete(image_tags).where(image_tags.c.image_id.in_(ids)))
    db.execute(delete(image_creators).where(image_creators.c.image_id.in_(ids)))
    db.execute(delete(playlist_images).where(playlist_images.c.image_id.in_(ids)))
    db.execute(delete(mix_images).where(mix_images.c.image_id.in_(ids)))
    db.execute(delete(PanelPlaylistEntry).where(
        PanelPlaylistEntry.entry_type == "image",
        PanelPlaylistEntry.ref_id.in_(ids),
    ))

    # These intentionally are not foreign keys, but leaving them behind makes
    # later UI actions open media that no longer exists.
    db.execute(delete(FeedStory).where(FeedStory.image_id.in_(ids)))
    db.execute(
        update(IntakeItem)
        .where(IntakeItem.duplicate_of.in_(ids))
        .values(duplicate_of=None, duplicate_kind=None, duplicate_distance=None)
    )
    removed = set(ids)
    for post in db.query(FeedPost).filter(FeedPost.image_ids.isnot(None)).all():
        try:
            kept = [value for value in json.loads(post.image_ids or "[]") if int(value) not in removed]
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        if kept:
            post.image_ids = json.dumps(kept)
        else:
            db.delete(post)


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

    detach_image_references(db, image_ids)

    db.execute(delete(gallery_tags).where(gallery_tags.c.gallery_id == gallery.id))
    db.execute(delete(gallery_creators).where(gallery_creators.c.gallery_id == gallery.id))
    db.execute(delete(mix_images).where(mix_images.c.gallery_id == gallery.id))
    db.execute(delete(Image).where(Image.gallery_id == gallery.id))
    db.execute(delete(Gallery).where(Gallery.id == gallery.id))

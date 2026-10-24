"""Database cleanup for deleting a creator.

Follows the same rule as gallery deletion: galleries, media, history and earned
cards all survive; they only lose their link to the creator that was removed.
"""

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from models import (
    Card,
    CompanionConfig,
    Creator,
    Gallery,
    GroupMember,
    HofCategoryAward,
    HofCrown,
    SessionLog,
    SimRelationship,
    gallery_creators,
    image_creators,
)


def delete_creator_record(db: Session, creator: Creator) -> None:
    creator_id = creator.id

    db.execute(delete(gallery_creators).where(gallery_creators.c.creator_id == creator_id))
    db.execute(delete(image_creators).where(image_creators.c.creator_id == creator_id))

    # The legacy single-creator column moves to another remaining creator of
    # the gallery when there is one, so the gallery keeps a primary creator.
    next_creator = (
        select(gallery_creators.c.creator_id)
        .where(gallery_creators.c.gallery_id == Gallery.id)
        .order_by(gallery_creators.c.creator_id)
        .limit(1)
        .scalar_subquery()
    )
    db.execute(update(Gallery).where(Gallery.creator_id == creator_id).values(creator_id=next_creator))
    db.execute(update(Gallery).where(Gallery.linked_character_id == creator_id).values(linked_character_id=None))

    db.execute(update(SessionLog).where(SessionLog.creator_id == creator_id).values(creator_id=None))
    db.execute(update(Card).where(Card.source_creator_id == creator_id).values(source_creator_id=None))
    db.execute(update(Card).where(Card.linked_character_id == creator_id).values(linked_character_id=None))
    db.execute(update(HofCrown).where(HofCrown.creator_id == creator_id).values(creator_id=None))
    db.execute(update(HofCategoryAward).where(HofCategoryAward.creator_id == creator_id).values(creator_id=None))
    db.execute(update(CompanionConfig).where(CompanionConfig.active_persona_id == creator_id).values(active_persona_id=None))

    # These rows describe the creator herself and cannot exist without her.
    db.execute(delete(SimRelationship).where(
        (SimRelationship.subject_id == creator_id) | (SimRelationship.target_id == creator_id)
    ))
    db.execute(delete(GroupMember).where(GroupMember.creator_id == creator_id))

    # Expire cached relationships so the ORM delete does not touch galleries.
    db.expire(creator)
    db.delete(creator)

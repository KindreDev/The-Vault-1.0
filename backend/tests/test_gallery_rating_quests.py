from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import Base, CreditEvent, Gallery, Quest, QuestStatus, QuestType, XPEvent
from routers.galleries import rate_gallery, update_gallery
from schemas import GalleryUpdate
from services import gamification


@pytest.fixture
def rating_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    gamification.get_or_create_profile(db)
    # Daily selection is random; make this regression's quest deterministic.
    db.query(Quest).filter(Quest.key == "rate_galleries").delete()
    quest = Quest(
        key="rate_galleries", title="Gallery judge", quest_type=QuestType.daily,
        target=3, progress=0, status=QuestStatus.active, xp_reward=50,
        credit_reward=50, expires_at=datetime.utcnow() + timedelta(days=1),
    )
    galleries = [Gallery(name=f"Rating {i}", folder_path=f"C:/rating-test/{i}") for i in range(3)]
    db.add_all([quest, *galleries])
    db.commit()
    try:
        yield db, quest, galleries
    finally:
        db.close()
        engine.dispose()


@pytest.mark.parametrize("use_patch", [False, True])
def test_three_gallery_ratings_complete_daily_quest_once(rating_db, use_patch):
    db, quest, galleries = rating_db
    for progress, gallery in enumerate(galleries, start=1):
        if use_patch:
            update_gallery(gallery.id, GalleryUpdate(rating=8), db=db)
        else:
            result = rate_gallery(gallery.id, rating=8, db=db)
            assert result["xp"] is not None
        db.refresh(quest)
        db.refresh(gallery)
        assert gallery.rating == 8
        assert quest.progress == progress
        assert quest.status == (QuestStatus.completed if progress == 3 else QuestStatus.active)

    assert quest.completed_at is not None
    completion_events = db.query(XPEvent).filter(XPEvent.reason == "quest_complete").count()
    quest_rewards = db.query(CreditEvent).filter(CreditEvent.source == "quest_rate_galleries")
    assert quest_rewards.count() == 1
    assert quest_rewards.one().amount == 50
    rate_gallery(galleries[0].id, rating=9, db=db)
    db.refresh(quest)
    assert quest.progress == 3
    assert db.query(XPEvent).filter(XPEvent.reason == "quest_complete").count() == completion_events
    assert quest_rewards.count() == 1
    assert db.query(XPEvent).filter(XPEvent.reason == "gallery_rated").count() == 4


def test_unrelated_edits_and_invalid_ratings_do_not_advance_quest(rating_db):
    db, quest, galleries = rating_db
    gallery = galleries[0]
    update_gallery(gallery.id, GalleryUpdate(description="Edited metadata"), db=db)
    for invalid in (-1, 11, float("nan")):
        with pytest.raises(ValidationError):
            GalleryUpdate(rating=invalid)
        with pytest.raises(HTTPException):
            rate_gallery(gallery.id, rating=invalid, db=db)
    with pytest.raises(HTTPException):
        update_gallery(gallery.id, GalleryUpdate(rating=None), db=db)
    db.refresh(quest)
    db.refresh(gallery)
    assert quest.progress == 0
    assert gallery.rating == 0
    assert db.query(XPEvent).filter(XPEvent.reason == "gallery_rated").count() == 0

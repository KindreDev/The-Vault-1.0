"""Regression coverage for scanner cleanup of referenced stale media rows."""

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from models import ActivityEvent, Base, Gallery, Image
from services.scanner import _prune_scanned_galleries


def test_prune_scanned_galleries_detaches_references_before_delete(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'scanner-cleanup.sqlite'}")

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        gallery = Gallery(name="Moved", folder_path=str(tmp_path / "moved"))
        db.add(gallery)
        db.flush()

        image = Image(
            filename="gone.jpg",
            file_path=str(tmp_path / "old" / "gone.jpg"),
            gallery_id=gallery.id,
        )
        db.add(image)
        db.flush()
        activity = ActivityEvent(kind="view", image_id=image.id, gallery_id=gallery.id)
        db.add(activity)
        db.commit()

        removed = _prune_scanned_galleries(db, {gallery.id: set()})

        assert removed == 1
        assert db.query(Image).filter(Image.id == image.id).first() is None
        assert db.query(ActivityEvent).filter(ActivityEvent.id == activity.id).one().image_id is None
        assert db.query(Gallery).filter(Gallery.id == gallery.id).one().image_count == 0
    finally:
        db.close()
        engine.dispose()

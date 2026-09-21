from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import Base, Gallery, Image
from routers.images import update_image
from schemas import ImageUpdate


def test_image_notes_persist_through_update_api():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        gallery = Gallery(name="Broad mood", folder_path="C:/media/Broad mood")
        db.add(gallery)
        db.flush()
        image = Image(
            filename="favorite.jpg",
            file_path="C:/media/Broad mood/favorite.jpg",
            gallery_id=gallery.id,
        )
        db.add(image)
        db.commit()

        result = update_image(image.id, ImageUpdate(notes="The lighting is gorgeous."), db)

        db.expire_all()
        assert db.get(Image, image.id).notes == "The lighting is gorgeous."
        assert result["notes"] == "The lighting is gorgeous."
    finally:
        db.close()
        engine.dispose()

from fastapi import Response
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import Base, Gallery, Image
from routers.images import list_images


def test_video_duration_sort_keeps_unknown_lengths_last():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        gallery = Gallery(name="Videos", folder_path="C:/media/Videos")
        db.add(gallery)
        db.flush()
        videos = [
            Image(filename="short.mp4", file_path="C:/media/Videos/short.mp4", gallery_id=gallery.id, is_video=True, duration=30),
            Image(filename="unknown.mp4", file_path="C:/media/Videos/unknown.mp4", gallery_id=gallery.id, is_video=True, duration=None),
            Image(filename="long.mp4", file_path="C:/media/Videos/long.mp4", gallery_id=gallery.id, is_video=True, duration=300),
        ]
        db.add_all(videos)
        db.commit()

        ascending = list_images(Response(), db=db, is_video=True, sort_by="duration", sort_dir="asc")
        descending = list_images(Response(), db=db, is_video=True, sort_by="duration", sort_dir="desc")

        assert [video["filename"] for video in ascending] == ["short.mp4", "long.mp4", "unknown.mp4"]
        assert [video["filename"] for video in descending] == ["long.mp4", "short.mp4", "unknown.mp4"]
    finally:
        db.close()
        engine.dispose()

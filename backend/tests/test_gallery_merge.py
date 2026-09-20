"""Filesystem and database invariants for gallery merges."""

import hashlib
import os

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from models import Base, Gallery, Image
from services.gallery_merge import merge_gallery_records


@pytest.fixture
def db(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'gallery-merge.sqlite'}",
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _fixture(db, root):
    target_dir = root / "target"
    source_dir = root / "source"
    target_dir.mkdir()
    source_dir.mkdir()

    target_file = target_dir / "same.mp4"
    source_file = source_dir / "same.mp4"
    source_other = source_dir / "other.jpg"
    target_file.write_bytes(b"old-target")
    source_file.write_bytes(b"new-source")
    source_other.write_bytes(b"other-source")

    target = Gallery(name="Target", folder_path=str(target_dir), image_count=1)
    source = Gallery(name="Source", folder_path=str(source_dir), image_count=2)
    db.add_all([target, source])
    db.flush()
    db.add_all([
        Image(filename=target_file.name, file_path=str(target_file), gallery_id=target.id, is_video=True),
        Image(filename=source_file.name, file_path=str(source_file), gallery_id=source.id, is_video=True),
        Image(filename=source_other.name, file_path=str(source_other), gallery_id=source.id),
    ])
    db.commit()
    return target.id, source.id, target_dir, source_dir, target_file, source_file


@pytest.mark.parametrize(
    ("strategy", "expected_files", "expected_rows", "source_remains"),
    [
        ("replace", {"same.mp4", "other.jpg"}, 2, False),
        ("rename", {"same.mp4", "same_1.mp4", "other.jpg"}, 3, False),
        ("skip", {"same.mp4", "other.jpg"}, 2, True),
    ],
)
def test_gallery_merge_keeps_disk_and_database_in_sync(
    db, tmp_path, strategy, expected_files, expected_rows, source_remains
):
    target_id, source_id, target_dir, source_dir, target_file, source_file = _fixture(db, tmp_path)
    old_hash = hashlib.sha256(target_file.read_bytes()).hexdigest()
    source_hash = hashlib.sha256(source_file.read_bytes()).hexdigest()

    result = merge_gallery_records(
        db,
        source_id,
        target_id,
        move_files=True,
        collision_strategy=strategy,
    )

    assert set(os.listdir(target_dir)) == expected_files
    same_hash = hashlib.sha256((target_dir / "same.mp4").read_bytes()).hexdigest()
    assert same_hash == (source_hash if strategy == "replace" else old_hash)
    assert db.query(Image).filter(Image.gallery_id == target_id).count() == expected_rows
    assert (db.query(Gallery).filter(Gallery.id == source_id).first() is not None) is source_remains
    assert (source_dir.exists()) is source_remains
    assert result["source_deleted"] is (not source_remains)

    if strategy == "replace":
        assert same_hash == source_hash
        assert not source_file.exists()
    elif strategy == "rename":
        assert hashlib.sha256((target_dir / "same_1.mp4").read_bytes()).hexdigest() == source_hash
        assert not source_file.exists()
    else:
        assert (target_dir / "same.mp4").read_bytes() == b"old-target"
        assert source_file.exists()


def test_replace_reconciles_a_file_already_in_target_folder(db, tmp_path):
    target_id, source_id, target_dir, source_dir, target_file, source_file = _fixture(db, tmp_path)
    target_file.write_bytes(source_file.read_bytes())
    db.query(Image).filter(Image.file_path == str(target_file)).delete(synchronize_session=False)
    db.commit()

    result = merge_gallery_records(
        db,
        source_id,
        target_id,
        move_files=True,
        collision_strategy="replace",
    )

    assert result["reconciled"] == 1
    assert result["source_deleted"] is True
    assert set(os.listdir(target_dir)) == {"same.mp4", "other.jpg"}
    assert not source_file.exists()
    reconciled = db.query(Image).filter(Image.gallery_id == target_id, Image.filename == "same.mp4").one()
    assert reconciled.file_path == str(target_file)


def test_replace_reconciles_missing_source_row_when_target_file_exists(db, tmp_path):
    target_id, source_id, target_dir, source_dir, target_file, source_file = _fixture(db, tmp_path)
    db.query(Image).filter(Image.file_path == str(target_file)).delete(synchronize_session=False)
    db.commit()
    source_file.unlink()

    result = merge_gallery_records(
        db,
        source_id,
        target_id,
        move_files=True,
        collision_strategy="replace",
    )

    assert result["reconciled"] == 1
    assert result["source_deleted"] is True
    assert db.query(Image).filter(Image.gallery_id == target_id, Image.filename == "same.mp4").count() == 1
    assert db.query(Gallery).filter(Gallery.id == source_id).first() is None

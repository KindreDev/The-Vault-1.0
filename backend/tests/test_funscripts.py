import json
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import Base, Gallery, Image, Funscript, FunscriptPlaylist
from routers.funscripts import (
    add_funscript_tag,
    add_script_to_playlist,
    create_script_playlist,
    get_funscript_payload,
    list_funscripts,
    reorder_script_playlist,
)
from schemas import FunscriptPlaylistAdd, FunscriptPlaylistCreate, FunscriptPlaylistOrder, FunscriptTagIn
from services import funscripts as funscript_service
from services.funscripts import analyse_path, reindex


def _script(tmp_path):
    path = tmp_path / "tease.funscript"
    path.write_text(json.dumps({
        "actions": [
            {"at": 0, "pos": 0}, {"at": 1000, "pos": 100},
            {"at": 1000, "pos": 40}, {"at": 4000, "pos": 40},
        ],
        "axes": [{"id": "R1", "actions": [{"at": 0, "pos": 10}, {"at": 3000, "pos": 90}]}],
    }))
    return path


def _db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine)()


def test_metrics_are_deterministic_for_duplicate_timestamps(tmp_path):
    data = analyse_path(str(_script(tmp_path)))
    assert data["health_status"] == "healthy"
    assert data["action_count"] == 3  # funlib normalization keeps the first duplicate
    assert data["duration"] == 4.0
    assert data["axis_count"] == 2
    assert data["max_speed"] == 100.0
    assert data["pause_count"] == 1
    assert len(json.loads(data["waveform_json"])) == 64


def test_long_moving_gap_is_pause_but_speed_is_preserved(tmp_path):
    path = tmp_path / "gap.funscript"
    path.write_text(json.dumps({"actions": [
        {"at": 0, "pos": 0}, {"at": 1000, "pos": 100}, {"at": 5000, "pos": 0},
    ]}))
    data = analyse_path(str(path))
    assert data["pause_count"] == 1
    assert data["longest_pause"] == 4.0
    assert data["active_ratio"] == 0.2
    # The long interval still contributes to the raw speed distribution.
    assert data["max_speed"] == 100.0


def test_sub_frame_timestamp_noise_does_not_create_impossible_peak(tmp_path):
    path = tmp_path / "noise.funscript"
    path.write_text(json.dumps({"actions": [
        {"at": 0, "pos": 0}, {"at": 1, "pos": 100},
        {"at": 1000, "pos": 0},
    ]}))
    data = analyse_path(str(path))
    # The 1 ms edit is retained in the timeline, but excluded from speed
    # statistics because it is below the one-frame measurement floor.
    assert data["max_speed"] < 1000


def test_unlinked_repository_script_is_indexed_and_playable(tmp_path, monkeypatch):
    path = _script(tmp_path)
    monkeypatch.setattr(funscript_service, "_read_config", lambda: {"funscript_library_path": str(tmp_path)})
    engine, db = _db()
    try:
        result = reindex(db)
        assert result["indexed"] == 1
        script = db.query(Funscript).one()
        assert script.source_image_id is None
        payload = get_funscript_payload(script.id, db)
        assert payload["source_image_id"] is None
        assert len(payload["waveform"]) == 64
        assert payload["actions"]
    finally:
        db.close(); engine.dispose()


def test_reindex_compatibility_tags_and_payload(tmp_path):
    engine, db = _db()
    path = _script(tmp_path)
    gallery = Gallery(name="G", folder_path=str(tmp_path))
    db.add(gallery)
    db.flush()
    image = Image(filename="tease.mp4", file_path=str(tmp_path / "tease.mp4"),
                  gallery_id=gallery.id, is_video=True, funscript_path=str(path))
    db.add(image)
    db.commit()
    result = reindex(db)
    assert result["indexed"] == 1
    script = db.query(Funscript).one()
    payload = get_funscript_payload(script.id, db)
    assert set(payload["axes"]) == {"L0", "R1"}
    listed = list_funscripts(compatibility="multi axis", sort="name", direction="asc", skip=0, limit=100, db=db)
    assert listed["total"] == 1
    assert listed["items"][0]["compatibility_tags"] == ["multi axis"]
    assert listed["items"][0]["source_image"]["id"] == image.id
    db.close(); engine.dispose()


def test_vibrator_compatibility_requires_explicit_vibration_axis(tmp_path):
    engine, db = _db()
    path = tmp_path / "vibe.funscript"
    path.write_text(json.dumps({
        "actions": [{"at": 0, "pos": 0}, {"at": 1000, "pos": 50}],
        "axes": [{"id": "V0", "actions": [{"at": 0, "pos": 0}, {"at": 1000, "pos": 50}]}],
    }))
    db.add(Funscript(path=str(path), name=path.name))
    db.commit()
    reindex(db)
    listed = list_funscripts(compatibility="vibrator compatible", sort="name", direction="asc", skip=0, limit=100, db=db)
    assert listed["total"] == 1
    assert listed["items"][0]["compatibility_tags"] == ["vibrator compatible", "multi axis"]
    db.close(); engine.dispose()


def test_manual_tags_and_independent_script_playlist(tmp_path):
    engine, db = _db()
    path = _script(tmp_path)
    gallery = Gallery(name="G", folder_path=str(tmp_path))
    db.add(gallery); db.flush()
    image = Image(filename="tease.mp4", file_path=str(tmp_path / "tease.mp4"), gallery_id=gallery.id,
                  is_video=True, funscript_path=str(path))
    db.add(image); db.commit(); reindex(db)
    script = db.query(Funscript).one()
    tagged = add_funscript_tag(script.id, FunscriptTagIn(name="slow burn"), db)
    assert any(item["name"] == "slow burn" for item in tagged["manual_tags"])
    playlist = create_script_playlist(FunscriptPlaylistCreate(name="Goon tracks"), db)
    add_script_to_playlist(playlist["id"], FunscriptPlaylistAdd(funscript_id=script.id), db)
    detail = db.query(FunscriptPlaylist).get(playlist["id"])
    assert len(detail.entries) == 1
    # Playlist has no relationship to the existing media Playlist table.
    assert detail.entries[0].funscript_id == script.id
    db.close(); engine.dispose()

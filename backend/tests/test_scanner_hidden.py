from pathlib import Path

from services.scanner import filter_hidden_walk_entries, should_ignore_scan_path


def test_hidden_and_housekeeping_directories_are_pruned(tmp_path: Path):
    (tmp_path / ".thumbnails").mkdir()
    (tmp_path / "@eaDir").mkdir()
    (tmp_path / "Visible Gallery").mkdir()
    (tmp_path / ".poster.jpg").write_bytes(b"hidden")
    (tmp_path / "photo.jpg").write_bytes(b"visible")

    dirs = [".thumbnails", "@eaDir", "Visible Gallery"]
    files = [".poster.jpg", "photo.jpg"]
    visible_files, ignored = filter_hidden_walk_entries(
        str(tmp_path), dirs, files, enabled=True,
    )

    assert dirs == ["Visible Gallery"]
    assert visible_files == ["photo.jpg"]
    assert ignored == 3
    assert should_ignore_scan_path(str(tmp_path / ".thumbnails"))
    assert should_ignore_scan_path(str(tmp_path / "@eaDir"))


def test_hidden_filter_can_be_disabled(tmp_path: Path):
    dirs = [".thumbnails", "Visible Gallery"]
    files = [".poster.jpg", "photo.jpg"]

    visible_files, ignored = filter_hidden_walk_entries(
        str(tmp_path), dirs, files, enabled=False,
    )

    assert dirs == [".thumbnails", "Visible Gallery"]
    assert visible_files == files
    assert ignored == 0

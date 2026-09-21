from services.video_playback import BROWSER_NATIVE_EXTENSIONS, needs_browser_conversion


def test_browser_native_video_extensions_are_not_converted():
    assert not needs_browser_conversion("clip.mp4")
    assert not needs_browser_conversion("clip.WEBM")
    assert BROWSER_NATIVE_EXTENSIONS == {".mp4", ".webm"}


def test_non_native_video_containers_are_converted():
    for name in ("clip.wmv", "clip.mkv", "clip.avi", "clip.mov", "clip.m4v"):
        assert needs_browser_conversion(name)


def test_force_conversion_supports_unusual_native_codecs():
    assert needs_browser_conversion("clip.mp4", force=True)

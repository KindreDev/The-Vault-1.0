from services.video_playback import BROWSER_NATIVE_EXTENSIONS, needs_browser_conversion
from services.video_playback import _playback_tracks


def test_browser_native_video_extensions_are_not_converted():
    assert not needs_browser_conversion("clip.mp4")
    assert not needs_browser_conversion("clip.WEBM")
    assert BROWSER_NATIVE_EXTENSIONS == {".mp4", ".webm"}


def test_non_native_video_containers_are_converted():
    for name in ("clip.wmv", "clip.mkv", "clip.avi", "clip.mov", "clip.m4v"):
        assert needs_browser_conversion(name)


def test_force_conversion_supports_unusual_native_codecs():
    assert needs_browser_conversion("clip.mp4", force=True)


def test_phone_video_skips_unknown_auxiliary_audio():
    streams = [
        {"index": 0, "codec_type": "video", "codec_name": "hevc", "pix_fmt": "yuv420p"},
        {"index": 1, "codec_type": "audio", "codec_name": "aac"},
        {"index": 2, "codec_type": "audio"},
    ]
    assert _playback_tracks(streams) == (["-map", "0:1"], False)
    streams[0]["codec_name"] = "h264"
    assert _playback_tracks(streams) == (["-map", "0:1"], True)


def test_unknown_audio_before_main_track_and_silent_video():
    streams = [
        {"index": 0, "codec_type": "video", "codec_name": "h264", "pix_fmt": "yuv420p"},
        {"index": 1, "codec_type": "audio", "codec_name": "none"},
        {"index": 2, "codec_type": "audio", "codec_name": "aac"},
    ]
    assert _playback_tracks(streams) == (["-map", "0:2"], True)
    assert _playback_tracks(streams[:2]) == ([], True)
    assert _playback_tracks(None) == (["-map", "0:a:0?"], False)

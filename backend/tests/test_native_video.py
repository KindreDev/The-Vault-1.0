"""Indexed-source authorization against disposable SQLite and media only."""
import unittest
import threading
from unittest.mock import Mock
import test_media_deletion as fixture
from services.native_video import NativeVideoBridge, resolve_video_source
from services.native_video_surface import NativeSurfaceHost


class NativeVideoTests(unittest.TestCase):
    # Reuse isolated setup helpers, without duplicating the deletion suite.
    setUp = fixture.DeletionTests.setUp
    seed = fixture.DeletionTests.seed
    def test_indexed_video_uses_original_and_requires_video_record(self):
        _, image_id, _, path, _ = self.seed()
        source = f'/api/images/{image_id}/file'
        with self.assertRaises(FileNotFoundError):
            resolve_video_source(source)
        with fixture.database.SessionLocal() as db:
            db.get(fixture.m.Image, image_id).is_video = True
            db.commit()
        self.assertEqual(resolve_video_source(source + '?transcode=1'), str(path))
        path.unlink()
        with self.assertRaises(FileNotFoundError):
            resolve_video_source(source)

    def test_unindexed_and_remote_sources_cannot_create_native_windows(self):
        bridge = NativeVideoBridge(lambda: object())
        host = Mock()
        bridge._host = host
        for source in ['https://example.com/api/images/1/file', 'file:///C:/video.mp4',
                       '/api/images/1/thumbnail', '/api/images/999999/file']:
            with self.subTest(source=source), self.assertRaises((ValueError, FileNotFoundError)):
                bridge.open('valid-session', source, {})
        host.open.assert_not_called()

    def test_authorized_bridge_retains_clock_layout_and_reusable_close(self):
        _, image_id, _, path, _ = self.seed()
        with fixture.database.SessionLocal() as db:
            db.get(fixture.m.Image, image_id).is_video = True
            db.commit()
        bridge = NativeVideoBridge(lambda: object())
        host = Mock()
        host.vlc.libvlc_get_version.return_value = b'fixture'
        bridge._host = host
        bridge.open('valid-session', f'/api/images/{image_id}/file', {'autoPlay': True})
        host.open.assert_called_once_with('valid-session', str(path), {'autoPlay': True})
        bridge.layout('valid-session', {'zoom': 2})
        host.layout.assert_called_once_with('valid-session', {'zoom': 2})
        bridge.media_clock('valid-session')
        host.media_clock.assert_called_once_with('valid-session')
        bridge.close_all()
        host.close_all.assert_called_once()
        self.assertTrue(bridge.capabilities()['available'])
        bridge.shutdown()
        host.shutdown.assert_called_once()
        self.assertFalse(bridge.capabilities()['available'])

    def test_preparation_authorizes_indexed_videos_and_cleanup(self):
        _, image_id, _, path, _ = self.seed()
        with fixture.database.SessionLocal() as db:
            db.get(fixture.m.Image, image_id).is_video = True
            db.commit()
        bridge = NativeVideoBridge(lambda: object())
        bridge._host = Mock()
        bridge._host.vlc.libvlc_get_version.return_value = b'fixture'
        with self.assertRaises(ValueError):
            bridge.prepare('viewer', 'https://example.com/video.mp4')
        bridge._host.prepare.assert_not_called()
        bridge.prepare('viewer', f'/api/images/{image_id}/file')
        bridge._host.prepare.assert_called_once_with('viewer', str(path))
        bridge.clear_prepared('viewer')
        bridge._host.clear_prepared.assert_called_once_with('viewer')

    def test_claim_reuses_prepared_decoder_only_for_its_authorized_path(self):
        host = NativeSurfaceHost.__new__(NativeSurfaceHost)
        host.guard = threading.RLock()
        host.closing = False
        player = Mock()
        session = {'path': 'fixture.mp4', 'player': player, 'ready': True, 'presented': False}
        host.sessions = {'prepared': session}
        host.prepared = {'viewer': 'prepared'}
        result = host.open('main', 'fixture.mp4', {'preloadKey': 'viewer', 'autoPlay': True, 'volume': .4})
        self.assertTrue(result['prepared'])
        self.assertIs(host.sessions['main']['player'], player)
        self.assertNotIn('prepared', host.sessions)
        self.assertEqual(host.prepared, {})
        self.assertFalse(session['presented'])
        player.play.assert_not_called()
        player.audio_set_mute.assert_not_called()


if __name__ == '__main__':
    unittest.main()

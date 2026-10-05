"""Serial timing/ownership regressions, with no real ports or Vault data."""
import time
import unittest

from services.serial_playback import Curve, SerialPlayback


class Port:
    def __init__(self, *args, **kwargs):
        self.is_open = True
        self.writes = []
        self.delay = 0
        self.fail = False
        self.in_waiting = 0

    def read(self, size):
        self.in_waiting = max(0, self.in_waiting - size)
        return b'x' * size

    def write(self, data):
        if self.fail:
            raise IOError("USB removed")
        if self.delay:
            time.sleep(self.delay)
        self.writes.append((time.perf_counter(), data.decode()))
        return len(data)

    def close(self):
        self.is_open = False


def track(generation=1, **patch):
    return dict({"generation": generation, "owner": "independent",
                 "axes": {"L0": [{"at": 0, "pos": 0}, {"at": 2000, "pos": 100}],
                          "R0": [{"at": 0, "pos": 100}, {"at": 2000, "pos": 0}]}}, **patch)


class SerialPlaybackTests(unittest.TestCase):
    def setUp(self):
        self.port = Port()
        self.engine = SerialPlayback(port_factory=lambda *args, **kwargs: self.port)
        self.engine.connect("fake")

    def tearDown(self):
        self.engine.disconnect()

    def test_groups_axes_and_runs_without_ui_updates(self):
        self.engine.start(track())
        time.sleep(.22)  # no UI clock/control messages during playback
        self.engine.stop(2)
        count = len(self.port.writes)
        self.assertGreaterEqual(count, 12)
        self.assertLessEqual(count, 30)
        self.assertTrue(all("L0" in data and " R0" in data and data.count("\n") == 1
                            for _, data in self.port.writes))
        time.sleep(.04)
        self.assertEqual(len(self.port.writes), count)
        self.assertTrue(self.port.is_open)

    def test_slow_writes_sample_current_clock_without_backlog(self):
        self.port.delay = .03
        self.engine.start(track())
        time.sleep(.16)
        self.engine.stop(2)
        count = len(self.port.writes)
        time.sleep(.08)
        self.assertEqual(len(self.port.writes), count)
        self.assertLess(count, 10)
        self.assertGreater(self.engine.status()["time"], .10)

    def test_stopped_generation_cannot_restart_or_seek(self):
        self.engine.start(track())
        self.engine.stop(3)
        self.assertFalse(self.engine.start(track(2)))
        self.engine.update({"generation": 1, "startTime": 1})
        count = len(self.port.writes)
        time.sleep(.04)
        self.assertEqual(len(self.port.writes), count)

    def test_write_failure_is_reported_and_output_stops(self):
        self.port.fail = True
        self.engine.start(track())
        time.sleep(.04)
        self.assertIn("USB removed", self.engine.status()["error"])
        with self.assertRaises(RuntimeError):
            self.engine.move("L0", 50, 10, 2)

    def test_seek_speed_range_secondary_axes_and_final_point(self):
        self.engine.start(track(duration=.3))
        self.engine.update({"generation": 1, "startTime": .29, "speed": 2,
                            "range": {"min": 20, "max": 80}, "strokeFloor": 25, "strokeCeiling": 75})
        time.sleep(.04)
        status = self.engine.status()
        self.assertTrue(status["ended"])
        self.assertEqual(status["time"], .3)
        last = self.port.writes[-1][1]
        l0 = int(last.split()[0][2:6]) / 9999 * 100
        r0 = int(last.split()[1][2:6]) / 9999 * 100
        self.assertGreaterEqual(l0, 35)
        self.assertLessEqual(l0, 65)
        self.assertGreater(r0, l0)  # rotation is not stroke-limited

    def test_loop_preserves_overshoot_and_updates_disabled_axis(self):
        self.engine.start(track(duration=.1, loop=True))
        self.engine.update({"generation": 1, "axisEnabled": {"R0": False}})
        time.sleep(.15)
        self.engine.stop(2)
        self.assertFalse(self.engine.status()["ended"])
        self.assertLess(self.engine.status()["time"], .1)
        self.assertNotIn("R0", self.port.writes[-1][1])

    def test_video_clock_advances_between_vlc_observations_and_holds_paused(self):
        clock = {"time": 1., "rate": 1., "duration": 10., "playing": True}
        self.engine._media_clock = lambda session: dict(clock)
        self.engine.start(track(owner="video", mediaSession="test-video"))
        time.sleep(.06)
        self.assertGreater(self.engine.status()["time"], 1.03)
        clock["playing"] = False
        time.sleep(.025)
        count = len(self.port.writes)
        time.sleep(.03)
        self.assertEqual(len(self.port.writes), count)
        clock.update(time=.2, playing=True)
        time.sleep(.03)
        self.assertLess(self.engine.status()["time"], .25)

    def test_browser_clock_lease_expiry_holds(self):
        self.engine.start(track(owner="video"))
        with self.engine._guard:
            self.engine._track["anchor"] = time.perf_counter() - 3
        time.sleep(.025)
        count = len(self.port.writes)
        time.sleep(.025)
        self.assertEqual(len(self.port.writes), count)

    def test_pchip_endpoints_duplicates_and_monotonic_segments(self):
        curve = Curve([{"at": 0, "pos": 40}, {"at": 0, "pos": 0},
                       {"at": 100, "pos": 100}, {"at": 200, "pos": 0}])
        self.assertEqual(curve.sample(0), 0)
        self.assertEqual(curve.sample(50), 50)
        self.assertEqual(curve.sample(100), 100)
        self.assertEqual(curve.sample(200), 0)
        samples = [curve.sample(t) for t in range(101)]
        self.assertEqual(samples, sorted(samples))

    def test_intensity_cannot_escape_stroke_window(self):
        self.engine.start(track(strokeFloor=25, strokeCeiling=75, intensity=2))
        time.sleep(.035)
        self.engine.stop(2)
        for _, command in self.port.writes:
            axis = next((part for part in command.split() if part.startswith('L0')), None)
            if axis is None:
                continue
            l0 = int(axis[2:6]) / 9999 * 100
            self.assertGreaterEqual(l0, 24.99)
            self.assertLessEqual(l0, 75.01)

    def test_firmware_feedback_is_drained_without_interrupting_motion(self):
        self.port.in_waiting = 9000
        self.engine.start(track())
        time.sleep(.04)
        self.engine.stop(2)
        self.assertEqual(self.port.in_waiting, 0)
        self.assertTrue(self.port.writes)


if __name__ == "__main__":
    unittest.main()

"""Desktop T-Code output, independent of the WebView/UI thread.

The fixed-update design follows MultiFunPlayer's MIT-licensed SerialOutputTarget,
ThreadAbstractOutputTarget and ScriptViewModel: monotonic 10 ms clock,
synchronous grouped writes, dirty-value filtering, no queue of old samples, a
smoothed media clock, soft sync after jumps, a speed limit and auto-home.
See THIRD_PARTY_NOTICES.md.
"""
from __future__ import annotations

import bisect
import math
import sys
import threading
import time

AXES = frozenset(("L0", "L1", "L2", "R0", "R1", "R2"))
INTERVAL = .010
HOME = 50.
# A media observation further than this from the followed clock is a seek.
SEEK_THRESHOLD = 1.
# Jumps smaller than this (rate changes, tiny corrections) re-anchor without a
# soft-sync ramp.
SYNC_JUMP = .25
# VLC's clock can sit on one value for a few hundred ms. Past this, treat the
# media as stalled and hold output instead of extrapolating into the future.
STALL_SECONDS = 1.
# The output thread shares the interpreter lock with the backend's request
# threads. While a CPU-heavy request runs (rebuilding a large gallery list, for
# one), the thread waits for the lock after every sleep. On Windows that wait
# is rounded up to the system timer tick, about 15.6 ms by default, so one busy
# request made the device stutter, and a few at once could stall it for
# seconds. While a serial device is connected the timer runs at 1 ms and the
# lock is handed over after 1 ms instead of CPython's default 5 ms.
OUTPUT_SWITCH_INTERVAL = .001


def _set_fine_timer(enabled):
    if sys.platform != "win32":
        return
    try:
        import ctypes
        winmm = ctypes.windll.winmm
        (winmm.timeBeginPeriod if enabled else winmm.timeEndPeriod)(1)
    except Exception:
        pass


def _raise_thread_priority():
    """Keep the output thread ahead of other busy work on Windows."""
    if sys.platform != "win32":
        return
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        kernel32.SetThreadPriority(kernel32.GetCurrentThread(), 2)  # THREAD_PRIORITY_HIGHEST
    except Exception:
        pass


def finite(value, default=0.):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def clamp(value, low, high):
    return max(low, min(high, value))


def smoothstep(t):
    t = clamp(t, 0., 1.)
    return t * t * (3 - 2 * t)


class Curve:
    """Precomputed shape-preserving Hermite segments, with MFP end ghosts.

    sample() keeps a forward cursor (MFP's AdvanceIndex) so steady playback
    never searches; a backwards or distant jump falls back to bisect.
    """
    def __init__(self, actions):
        points = {}
        for action in actions:
            at, pos = finite(action.get("at"), math.nan), finite(action.get("pos", action.get("position")), math.nan)
            if math.isfinite(at) and math.isfinite(pos):
                points[at] = clamp(pos, 0, 100)
        self.times = sorted(points)
        self.values = [points[t] for t in self.times]
        self.slopes = []
        self._cursor = 0
        for i in range(len(self.times) - 1):
            t0, t1 = self.times[i:i + 2]
            p0, p1 = self.values[i:i + 2]
            tp = self.times[i - 1] if i else 3 * t0 - 2 * t1
            pp = self.values[i - 1] if i else p0
            tn = self.times[i + 2] if i + 2 < len(self.times) else 3 * t1 - 2 * t0
            pn = self.values[i + 2] if i + 2 < len(self.values) else p1
            hp, h, hn = t0 - tp, t1 - t0, tn - t1
            dp, d, dn = (p0 - pp) / hp, (p1 - p0) / h, (pn - p1) / hn

            def slope(a, b, w1, w2):
                return 0. if a * b <= 0 else (w1 + w2) / (w1 / a + w2 / b)

            self.slopes.append((slope(dp, d, 2 * h + hp, h + 2 * hp),
                                slope(d, dn, 2 * hn + h, hn + 2 * h)))

    def _index(self, ms):
        times, i = self.times, self._cursor
        if i < len(times) - 1 and times[i] <= ms:
            # Steady playback: advance a few segments at most.
            for _ in range(8):
                if times[i + 1] > ms:
                    self._cursor = i
                    return i
                i += 1
                if i >= len(times) - 1:
                    break
        i = bisect.bisect_right(times, ms) - 1
        self._cursor = i
        return i

    def sample(self, ms):
        if not self.times:
            return None
        if ms <= self.times[0]:
            return self.values[0]
        if ms >= self.times[-1]:
            return self.values[-1]
        i = self._index(ms)
        h = self.times[i + 1] - self.times[i]
        u = (ms - self.times[i]) / h
        u2 = u * u
        u3 = u2 * u
        m0, m1 = self.slopes[i]
        return clamp((2*u3 - 3*u2 + 1) * self.values[i]
                     + (u3 - 2*u2 + u) * h * m0
                     + (-2*u3 + 3*u2) * self.values[i + 1]
                     + (u3 - u2) * h * m1, 0, 100)


class ClockFollower:
    """MultiFunPlayer's two-stage media clock.

    `internal` advances with the wall clock and is pulled a third of the way to
    each new media observation. `output` chases `internal` at 0.9x-1.1x speed,
    so a coarse or jittery player clock never makes the script step or run
    backwards. Distant observations (seeks) snap both.
    """
    def __init__(self):
        self.reset()

    def reset(self, seconds=None):
        self.internal = self.output = seconds
        self.raw = None
        self.raw_at = None
        self.force_next = False

    def invalidate(self):
        """A known discontinuity: re-anchor on the next observation."""
        self.force_next = True
        self.raw = None

    def observe(self, raw, observed_at, rate, now, force=False):
        """Feed a media position. Returns the size of a snap, or 0.

        Only a changed value counts: a coarse clock re-reports the same time
        many times, and re-anchoring on each would drag the clock backwards.
        force=True is a known discontinuity (seek, rate change, loop wrap).
        """
        force = force or self.force_next
        if raw == self.raw and self.internal is not None and not force:
            return 0.
        self.raw, self.raw_at = raw, observed_at
        expected = raw + max(0., now - observed_at) * rate
        if force or self.internal is None or abs(expected - self.internal) > SEEK_THRESHOLD:
            jump = math.inf if self.internal is None else abs(expected - self.internal)
            self.internal = self.output = expected
            self.force_next = False
            return jump
        self.internal += .33 * (expected - self.internal)
        return 0.

    def stalled(self, now):
        return self.raw_at is not None and now - self.raw_at > STALL_SECONDS

    def advance(self, dt, rate):
        if self.internal is None:
            return None
        step = max(0., dt) * rate
        self.internal += step
        self.output += clamp(self.internal - self.output, step * .9, step * 1.1)
        return self.output


def motion_settings(raw):
    raw = raw or {}
    home = raw.get("autoHome") or {}
    return {
        "syncSeconds": clamp(finite(raw.get("syncSeconds", 1), 1), 0, 10),
        # Percent of full travel per second; 0 disables the limit.
        "speedLimit": max(0., finite(raw.get("speedLimit", 0))),
        "autoHome": bool(home.get("enabled", True)),
        "homeDelay": clamp(finite(home.get("delay", 5), 5), 0, 120),
        "homeDuration": clamp(finite(home.get("duration", 3), 3), 0, 30),
    }


class SerialPlayback:
    def __init__(self, media_clock=None, port_factory=None):
        self._media_clock = media_clock
        self._port_factory = port_factory
        self._guard = threading.RLock()
        self._wake = threading.Event()
        self._closing = threading.Event()
        self._thread = None
        self._port = None
        self._track = None
        self._manual = {}
        self._last_values = {}
        # Last commanded value per axis. Unlike _last_values (the dirty filter),
        # this survives stop/seek so soft sync and auto-home know where the
        # device actually is.
        self._sent = {}
        self._sync = None
        self._home = None
        self._motion = motion_settings(None)
        self._clock = ClockFollower()
        self._held = True
        self._error = None
        self._time = 0.
        self._ended = False
        self._writes = 0
        self._max_gap_ms = 0.
        self._generation = 0
        self._previous_switch_interval = None

    def ports(self):
        from serial.tools import list_ports
        return [{"device": p.device, "description": p.description,
                 "usbVendorId": p.vid, "usbProductId": p.pid,
                 "serialNumber": p.serial_number} for p in list_ports.comports()]

    def connect(self, device):
        self.disconnect()
        if self._port_factory:
            factory = self._port_factory
        else:
            import serial
            if device not in {p["device"] for p in self.ports()}:
                raise ValueError("The selected serial port is no longer available")
            factory = serial.Serial
        port = factory(device, baudrate=115200, timeout=0, write_timeout=.25)
        with self._guard:
            self._port = port
            self._error = None
            self._generation = 0
            self._time = 0.
            self._ended = False
            self._writes = 0
            self._max_gap_ms = 0.
            self._sent.clear()
            self._sync = self._home = None
            self._closing.clear()
            if self._previous_switch_interval is None:
                self._previous_switch_interval = sys.getswitchinterval()
                sys.setswitchinterval(min(self._previous_switch_interval, OUTPUT_SWITCH_INTERVAL))
                _set_fine_timer(True)
            self._thread = threading.Thread(target=self._run, name="vault-tcode-output", daemon=True)
            self._thread.start()
        return {"device": device}

    def start(self, payload):
        axes = payload.get("axes") or {"L0": payload.get("actions", [])}
        curves = {a: Curve(actions) for a, actions in axes.items() if a in AXES}
        curves = {a: curve for a, curve in curves.items() if curve.times}
        if not curves:
            raise ValueError("This funscript has no supported actions")
        with self._guard:
            self._require_port()
            generation = int(payload["generation"])
            if generation < self._generation:
                return False
            self._generation = generation
            now = time.perf_counter()
            self._track = dict(payload, curves=curves, anchor=now,
                               startTime=max(0., finite(payload.get("startTime", 0))),
                               speed=clamp(finite(payload.get("speed", 1), 1), .25, 4),
                               duration=finite(payload.get("duration", 0)) or max(c.times[-1] for c in curves.values()) / 1000)
            if "motion" in payload:
                self._motion = motion_settings(payload["motion"])
            self._clock.reset()
            self._held = True
            self._manual.clear()
            self._last_values.clear()
            self._home = None
            self._ended = False
            self._error = None
            self._wake.set()
        return True

    def update(self, patch):
        with self._guard:
            s = self._track
            if not s or int(patch["generation"]) != self._generation:
                return
            now = time.perf_counter()
            if "speed" in patch and s.get("owner") != "video":
                s["startTime"] += (now - s["anchor"]) * s["speed"]
                s["anchor"] = now
            resync = False
            for key in ("range", "intensity", "axisEnabled", "axisSettings", "loop", "loopRegion",
                        "strokeFloor", "strokeCeiling", "offsetMs", "gate"):
                if key in patch:
                    if key == "gate":
                        # Edge Mode ramps the gate in small steps; only an abrupt
                        # release would jolt the device.
                        resync |= abs(finite(patch[key], 1) - finite(s.get(key, 1), 1)) > .3
                    else:
                        resync |= key in ("offsetMs", "axisSettings", "range", "intensity") and patch[key] != s.get(key)
                    s[key] = patch[key]
            if "motion" in patch:
                self._motion = motion_settings(patch["motion"])
            if "speed" in patch:
                s["speed"] = clamp(finite(patch["speed"], 1), .25, 4)
            if "startTime" in patch:
                s["startTime"] = max(0., finite(patch["startTime"]))
                s["anchor"] = now
                if patch.get("seek"):
                    # HTML video seek: snap to it even when it is close by.
                    self._clock.invalidate()
                if s.get("owner") != "video":
                    # An independent-player seek: the script jumps.
                    self._clock.reset()
                    resync = True
            if "playing" in patch:
                s["playing"] = bool(patch["playing"])
            if resync:
                self._begin_sync(now)
            self._last_values.clear()
            self._wake.set()

    def move(self, axis, position, duration, generation):
        if axis not in AXES:
            raise ValueError("Unsupported T-Code axis")
        with self._guard:
            self._require_port()
            if int(generation) < self._generation:
                return
            self._generation = int(generation)
            self._track = None
            self._home = None
            self._sync = None
            self._manual[axis] = (clamp(finite(position), 0, 100), clamp(finite(duration, 10), 1, 60000))
            self._wake.set()

    def stop(self, generation, park=False):
        # Holding this same lock through write means no sample can arrive after
        # stop returns. The port remains open; only disconnect releases it.
        # park=True (pause) lets auto-home ease the device back to centre after
        # its delay. A plain Stop never moves the device again.
        with self._guard:
            if int(generation) < self._generation:
                return
            self._generation = int(generation)
            track = self._track
            self._track = None
            self._manual.clear()
            self._last_values.clear()
            self._sync = None
            self._home = None
            if park and self._motion["autoHome"] and self._sent:
                targets = {axis: HOME for axis in self._sent}
                if track and "L0" in targets:
                    floor = finite(track.get("strokeFloor", 0))
                    ceiling = finite(track.get("strokeCeiling", 100), 100)
                    targets["L0"] = (floor + ceiling) / 2
                self._home = {"start": time.perf_counter() + self._motion["homeDelay"],
                              "duration": self._motion["homeDuration"],
                              "from": None, "targets": targets}
            self._wake.set()

    def status(self):
        with self._guard:
            return {"connected": self._port is not None and self._port.is_open,
                    "error": self._error, "time": self._time, "ended": self._ended,
                    "generation": self._generation, "writes": self._writes,
                    "maxGapMs": self._max_gap_ms, "homing": self._home is not None,
                    "syncing": self._sync is not None}

    def disconnect(self):
        self._closing.set()
        self._wake.set()
        thread = self._thread
        if thread and thread is not threading.current_thread():
            thread.join(timeout=1)
            if thread.is_alive():
                raise RuntimeError("Serial output is still stopping")
        with self._guard:
            if self._port:
                self._port.close()
            self._port = None
            self._thread = None
            self._track = None
            self._manual.clear()
            self._last_values.clear()
            self._sent.clear()
            self._sync = self._home = None
            if self._previous_switch_interval is not None:
                sys.setswitchinterval(self._previous_switch_interval)
                self._previous_switch_interval = None
                _set_fine_timer(False)

    def _require_port(self):
        if self._error:
            raise RuntimeError(self._error)
        if not self._port or not self._port.is_open:
            raise RuntimeError("Serial device is not connected")

    def _begin_sync(self, now):
        seconds = self._motion["syncSeconds"]
        self._sync = {"start": now, "duration": seconds, "from": dict(self._sent)} if seconds > 0 else None

    def _position_time(self, s, now, elapsed):
        rate = s["speed"]
        if s.get("owner") == "video":
            if s.get("mediaSession"):
                clock = self._media_clock(s["mediaSession"]) if self._media_clock else None
                if not clock or not clock["playing"]:
                    self._clock.reset()
                    return None
                rate = finite(clock.get("rate", 1), 1)
                revision = clock.get("revision")
                # Seek, rate change or loop wrap: re-anchor on this value. Only a
                # real jump (not a rate change) earns a soft-sync ramp.
                force = revision != s.get("mediaRevision")
                s["mediaRevision"] = revision
                raw = finite(clock["time"])
                observed = finite(clock.get("observedAt", now), now)
                # MFP order: advance to now, then correct toward the observation.
                if not self._clock.stalled(now):
                    self._clock.advance(elapsed, rate)
                jump = self._clock.observe(raw, min(observed, now), rate, now, force)
                if jump > SYNC_JUMP:
                    self._begin_sync(now)
                return min(clock["duration"] or math.inf, self._clock.output)
            # HTML video: the page sends observations as startTime updates.
            if not s.get("playing", True) or now - s["anchor"] > 2:
                self._clock.reset()
                return None  # browser media clock lease expired; hold output
            self._clock.advance(elapsed, rate)
            jump = self._clock.observe(s["startTime"], s["anchor"], rate, now)
            if jump > SYNC_JUMP:
                self._begin_sync(now)
            return self._clock.output
        return s["startTime"] + (now - s["anchor"]) * rate

    def _axis_value(self, s, axis, curve, seconds, gate):
        settings = (s.get("axisSettings") or {}).get(axis) or {}
        value = curve.sample(seconds * 1000 + finite(s.get("offsetMs", 0)) + finite(settings.get("offsetMs", 0)))
        if settings.get("invert"):
            value = 100 - value
        bounds = s.get("range") or {"min": 0, "max": 100}
        value = finite(bounds.get("min", 0)) + (finite(bounds.get("max", 100), 100) - finite(bounds.get("min", 0))) * value / 100
        if axis == "L0":
            value = 50 + (value - 50) * clamp(finite(s.get("intensity", 1), 1), 0, 2)
            value = 50 + (value - 50) * gate
            floor, ceiling = finite(s.get("strokeFloor", 0)), finite(s.get("strokeCeiling", 100), 100)
            return floor + (ceiling - floor) * clamp(value, 0, 100) / 100
        low = clamp(finite(settings.get("min", 0)), 0, 100)
        high = clamp(finite(settings.get("max", 100), 100), low, 100)
        return low + (high - low) * clamp(value, 0, 100) / 100

    def _shape(self, axis, value, now, elapsed):
        """Soft sync, then speed limit, against the last commanded value."""
        sync = self._sync
        if sync:
            progress = (now - sync["start"]) / sync["duration"] if sync["duration"] else 1
            if progress >= 1:
                self._sync = None
            else:
                start = sync["from"].get(axis, HOME)
                value = start + (value - start) * smoothstep(progress)
        limit = self._motion["speedLimit"]
        previous = self._sent.get(axis)
        if limit > 0 and previous is not None:
            step = limit * max(elapsed, INTERVAL)
            value = clamp(value, previous - step, previous + step)
        return clamp(value, 0, 100)

    def _sample_home(self, now):
        home = self._home
        if not home or now < home["start"]:
            return {}
        if home["from"] is None:
            home["from"] = {axis: self._sent.get(axis, HOME) for axis in home["targets"]}
        progress = 1 if home["duration"] <= 0 else (now - home["start"]) / home["duration"]
        eased = smoothstep(progress)
        values = {}
        for axis, target in home["targets"].items():
            start = home["from"][axis]
            value = start + (target - start) * eased
            previous = self._last_values.get(axis)
            if previous is None or abs(previous - value) >= .01:
                values[axis] = (value, max(1, round(INTERVAL * 1000)))
        if progress >= 1:
            self._home = None
        return values

    def _sample(self, now, elapsed):
        s = self._track
        if not s:
            if self._manual:
                values, self._manual = self._manual, {}
                return values
            return self._sample_home(now)
        seconds = self._position_time(s, now, elapsed)
        if seconds is None:
            self._held = True
            self._last_values.clear()
            return {}
        if self._held:
            # First sample after start, pause or a lost clock lease.
            self._held = False
            self._begin_sync(now)
        if s.get("owner") != "video":
            region = s.get("loopRegion") or {}
            start = max(0., finite(region.get("start", 0)))
            end = finite(region.get("end", s["duration"]))
            if end <= start:
                start, end = 0., s["duration"]
            if seconds >= end:
                if s.get("loop") and end > start:
                    seconds = start + (seconds - start) % (end - start)
                    s["startTime"], s["anchor"] = seconds, now
                    self._last_values.clear()
                    self._begin_sync(now)
                else:
                    # Emit the actual final point before marking completion.
                    seconds = end
                    self._ended = True
                    self._track = None
        self._time = seconds
        values = {}
        gate = clamp(finite(s.get("gate", 1), 1), 0, 1)
        if gate <= 0:
            return values
        enabled = s.get("axisEnabled") or {}
        for axis, curve in s["curves"].items():
            if enabled.get(axis) is False:
                continue
            value = self._shape(axis, self._axis_value(s, axis, curve, seconds, gate), now, elapsed)
            previous = self._last_values.get(axis)
            # MFP compares against last successfully sent value at device precision.
            if previous is None or abs(previous - value) >= .01:
                values[axis] = (value, max(1, math.floor(elapsed * 1000 + .75)))
        return values

    def _run(self):
        _raise_thread_priority()
        last = time.perf_counter() - INTERVAL
        deadline = last + INTERVAL
        while not self._closing.is_set():
            tick = time.perf_counter()
            elapsed = tick - last
            last = tick
            try:
                with self._guard:
                    if self._closing.is_set():
                        break
                    # MFP drains serial input on fixed updates too. Firmware
                    # telemetry must not fill the receive buffer and stall USB.
                    waiting = self._port.in_waiting
                    if waiting:
                        self._port.read(min(waiting, 4096))
                    values = self._sample(tick, elapsed)
                    if values:
                        commands = " ".join(f"{a}{math.floor(p / 100 * 9999 + .5):04d}I{int(d)}" for a, (p, d) in values.items()) + "\n"
                        encoded = commands.encode("ascii")
                        written = self._port.write(encoded)
                        if written != len(encoded):
                            raise IOError("Incomplete serial write")
                        self._last_values.update({a: p for a, (p, _) in values.items()})
                        self._sent.update({a: p for a, (p, _) in values.items()})
                        self._writes += 1
                        self._max_gap_ms = max(self._max_gap_ms, elapsed * 1000)
            except Exception as exc:
                with self._guard:
                    self._error = f"Serial output stopped: {exc}"
                    self._track = None
                    self._manual.clear()
                    self._home = None
                break
            # Like MFP, subtract work time; slow writes never create catch-up
            # bursts or an unbounded queue. Python 3.11+ uses a high-resolution
            # waitable timer for sleep on Windows (Event.wait can round to 15ms).
            deadline += INTERVAL
            now = time.perf_counter()
            if deadline < now:
                deadline = now + .001
            remaining = deadline - now
            # MFP also sleeps at least 1ms after an overrun. Yielding matters:
            # otherwise a slow writer can repeatedly reacquire the control lock
            # and starve a waiting Stop/seek request.
            time.sleep(max(.001, remaining))

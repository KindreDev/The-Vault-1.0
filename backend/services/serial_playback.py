"""Desktop T-Code output, independent of the WebView/UI thread.

The fixed-update design follows MultiFunPlayer's MIT-licensed SerialOutputTarget
and ThreadAbstractOutputTarget: monotonic 10 ms clock, synchronous grouped writes,
dirty-value filtering and no queue of old samples. See THIRD_PARTY_NOTICES.md.
"""
from __future__ import annotations

import bisect
import math
import threading
import time

AXES = frozenset(("L0", "L1", "L2", "R0", "R1", "R2"))
INTERVAL = .010


def finite(value, default=0.):
    result = float(value)
    return result if math.isfinite(result) else default


def clamp(value, low, high):
    return max(low, min(high, value))


class Curve:
    """Precomputed shape-preserving Hermite segments, with MFP end ghosts."""
    def __init__(self, actions):
        points = {}
        for action in actions:
            at, pos = float(action["at"]), float(action.get("pos", action.get("position", 0)))
            if math.isfinite(at) and math.isfinite(pos):
                points[at] = clamp(pos, 0, 100)
        self.times = sorted(points)
        self.values = [points[t] for t in self.times]
        self.slopes = []
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

    def sample(self, ms):
        if not self.times:
            return None
        if ms <= self.times[0]:
            return self.values[0]
        if ms >= self.times[-1]:
            return self.values[-1]
        i = bisect.bisect_right(self.times, ms) - 1
        h = self.times[i + 1] - self.times[i]
        u = (ms - self.times[i]) / h
        m0, m1 = self.slopes[i]
        return clamp((2*u**3 - 3*u**2 + 1) * self.values[i]
                     + (u**3 - 2*u**2 + u) * h * m0
                     + (-2*u**3 + 3*u**2) * self.values[i + 1]
                     + (u**3 - u**2) * h * m1, 0, 100)


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
        self._error = None
        self._time = 0.
        self._ended = False
        self._writes = 0
        self._max_gap_ms = 0.
        self._generation = 0

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
            self._closing.clear()
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
            self._track = dict(payload, curves=curves, anchor=time.perf_counter(),
                               startTime=max(0., finite(payload.get("startTime", 0))),
                               speed=clamp(finite(payload.get("speed", 1), 1), .25, 4),
                               duration=finite(payload.get("duration", 0)) or max(c.times[-1] for c in curves.values()) / 1000,
                               mediaRaw=None, mediaAnchor=None)
            self._manual.clear()
            self._last_values.clear()
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
            for key in ("range", "intensity", "axisEnabled", "loop", "loopRegion", "strokeFloor", "strokeCeiling", "offsetMs", "gate"):
                if key in patch:
                    s[key] = patch[key]
            if "speed" in patch:
                s["speed"] = clamp(finite(patch["speed"], 1), .25, 4)
            if "startTime" in patch:
                s["startTime"] = max(0., finite(patch["startTime"]))
                s["anchor"] = now
            if "playing" in patch:
                s["playing"] = bool(patch["playing"])
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
            self._manual[axis] = (clamp(finite(position), 0, 100), clamp(finite(duration, 10), 1, 60000))
            self._wake.set()

    def stop(self, generation):
        # Holding this same lock through write means no sample can arrive after
        # stop returns. The port remains open; only disconnect releases it.
        with self._guard:
            if int(generation) < self._generation:
                return
            self._generation = int(generation)
            self._track = None
            self._manual.clear()
            self._last_values.clear()
            self._wake.set()

    def status(self):
        with self._guard:
            return {"connected": self._port is not None and self._port.is_open,
                    "error": self._error, "time": self._time, "ended": self._ended,
                    "generation": self._generation, "writes": self._writes,
                    "maxGapMs": self._max_gap_ms}

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

    def _require_port(self):
        if self._error:
            raise RuntimeError(self._error)
        if not self._port or not self._port.is_open:
            raise RuntimeError("Serial device is not connected")

    def _position_time(self, s, now):
        if s.get("owner") == "video":
            if s.get("mediaSession"):
                clock = self._media_clock(s["mediaSession"]) if self._media_clock else None
                if not clock or not clock["playing"]:
                    s["mediaRaw"] = None
                    return None
                raw, rate = clock["time"], clock["rate"]
                # VLC's get_time advances in coarse steps. Interpolate between
                # observations instead of commanding the same position 25 times.
                predicted = raw if s["mediaRaw"] is None else s["mediaTime"] + (now - s["mediaAnchor"]) * rate
                if s["mediaRaw"] != raw:
                    if s["mediaRaw"] is None or raw < s["mediaRaw"] or abs(raw - predicted) > .5:
                        predicted = raw
                    else:
                        predicted += clamp((raw - predicted) * .1, -.01, .01)
                    s["mediaRaw"], s["mediaTime"], s["mediaAnchor"] = raw, predicted, now
                return min(clock["duration"] or float("inf"), predicted)
            if not s.get("playing", True) or now - s["anchor"] > 2:
                return None  # browser media clock lease expired; hold output
        return s["startTime"] + (now - s["anchor"]) * s["speed"]

    def _sample(self, now, elapsed):
        s = self._track
        if not s:
            values, self._manual = self._manual, {}
            return values
        seconds = self._position_time(s, now)
        if seconds is None:
            self._last_values.clear()
            return {}
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
        for axis, curve in s["curves"].items():
            if (s.get("axisEnabled") or {}).get(axis) is False:
                continue
            value = curve.sample(seconds * 1000 + finite(s.get("offsetMs", 0)))
            bounds = s.get("range") or {"min": 0, "max": 100}
            value = finite(bounds.get("min", 0)) + (finite(bounds.get("max", 100)) - finite(bounds.get("min", 0))) * value / 100
            if axis == "L0":
                value = 50 + (value - 50) * clamp(finite(s.get("intensity", 1), 1), 0, 2)
                value = 50 + (value - 50) * gate
                floor, ceiling = finite(s.get("strokeFloor", 0)), finite(s.get("strokeCeiling", 100))
                value = floor + (ceiling - floor) * clamp(value, 0, 100) / 100
            value = clamp(value, 0, 100)
            previous = self._last_values.get(axis)
            # MFP compares against last successfully sent value at device precision.
            if previous is None or abs(previous - value) >= .01:
                values[axis] = (value, max(1, math.floor(elapsed * 1000 + .75)))
        return values

    def _run(self):
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
                        self._writes += 1
                        self._max_gap_ms = max(self._max_gap_ms, elapsed * 1000)
            except Exception as exc:
                with self._guard:
                    self._error = f"Serial output stopped: {exc}"
                    self._track = None
                    self._manual.clear()
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

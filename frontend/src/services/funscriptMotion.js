/**
 * Funscript motion core shared by every device path in the page: the curve
 * sampler, the smoothed media clock and the output shaper (soft sync + speed
 * limit). The desktop T-Code thread in backend/services/serial_playback.py
 * implements the same behaviour in Python; keep the two in step.
 *
 * Behaviour follows MultiFunPlayer (MIT): PCHIP with ghost end points, a
 * two-stage media clock, soft sync after jumps and an optional speed limit.
 */

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

export const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

// A media observation further than this from the followed clock is a seek.
export const SEEK_THRESHOLD_S = 1
// Smaller re-anchors (rate change, loop jitter) get no soft-sync ramp.
export const SYNC_JUMP_S = 0.25
// VLC can report one value for a few hundred ms; past this the media stalled.
export const STALL_MS = 1000
export const HOME_POSITION = 50

export function normalizeFunscriptActions(actions) {
  const normalized = (Array.isArray(actions) ? actions : [])
    .map(action => ({
      at: Number(action?.at),
      pos: Number(action?.pos ?? action?.position),
    }))
    .filter(action => Number.isFinite(action.at) && Number.isFinite(action.pos))
    .map(action => ({ at: action.at, pos: clamp(action.pos, 0, 100) }))
    .sort((a, b) => a.at - b.at)

  // Duplicate timestamps have no duration. The last authored value is the
  // useful one and avoids zero-length divisions in the interpolator.
  const deduped = []
  for (const action of normalized) {
    if (deduped.at(-1)?.at === action.at) deduped[deduped.length - 1] = action
    else deduped.push(action)
  }
  return deduped
}

function pchipSlope(a, b, w1, w2) {
  return a * b <= 0 ? 0 : (w1 + w2) / (w1 / a + w2 / b)
}

/**
 * Precomputed shape-preserving curve. Slopes are built once, so sampling is
 * allocation-free; a forward cursor (MFP's AdvanceIndex) makes steady playback
 * O(1) and only seeks fall back to a binary search.
 */
export class FunscriptCurve {
  constructor(actions) {
    const points = normalizeFunscriptActions(actions)
    const n = points.length
    this.length = n
    this.times = new Float64Array(n)
    this.values = new Float64Array(n)
    for (let i = 0; i < n; i++) { this.times[i] = points[i].at; this.values[i] = points[i].pos }
    this.m0 = new Float64Array(Math.max(0, n - 1))
    this.m1 = new Float64Array(Math.max(0, n - 1))
    const t = this.times, v = this.values
    for (let i = 0; i < n - 1; i++) {
      // MultiFunPlayer extrapolates a same-valued ghost point at each end.
      const tp = i > 0 ? t[i - 1] : 3 * t[i] - 2 * t[i + 1]
      const pp = i > 0 ? v[i - 1] : v[i]
      const tn = i + 2 < n ? t[i + 2] : 3 * t[i + 1] - 2 * t[i]
      const pn = i + 2 < n ? v[i + 2] : v[i + 1]
      const hp = t[i] - tp, h = t[i + 1] - t[i], hn = tn - t[i + 1]
      const dp = (v[i] - pp) / hp, d = (v[i + 1] - v[i]) / h, dn = (pn - v[i + 1]) / hn
      this.m0[i] = pchipSlope(dp, d, 2 * h + hp, h + 2 * hp)
      this.m1[i] = pchipSlope(d, dn, 2 * hn + h, hn + 2 * h)
    }
    this.cursor = 0
  }

  get start() { return this.length ? this.times[0] : 0 }
  get end() { return this.length ? this.times[this.length - 1] : 0 }

  // Segment index i with times[i] <= ms < times[i + 1].
  indexAt(ms) {
    const t = this.times
    let i = this.cursor
    if (i < this.length - 1 && t[i] <= ms) {
      for (let step = 0; step < 8 && i < this.length - 1; step++, i++) {
        if (t[i + 1] > ms) { this.cursor = i; return i }
      }
    }
    let lo = 0, hi = this.length - 1
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1
      if (t[mid] <= ms) lo = mid
      else hi = mid
    }
    this.cursor = lo
    return lo
  }

  sample(ms) {
    const n = this.length
    if (!n) return null
    const times = this.times, values = this.values
    if (n === 1 || !(ms > times[0])) return values[0]
    if (ms >= times[n - 1]) return values[n - 1]
    let i = this.cursor
    // Fast path: still inside the cursor's segment, or the next one.
    if (!(times[i] <= ms && ms < times[i + 1])) {
      i = (i + 2 < n && times[i + 1] <= ms && ms < times[i + 2]) ? i + 1 : this.indexAt(ms)
      this.cursor = i
    }
    const t0 = times[i], h = times[i + 1] - t0
    const u = (ms - t0) / h, u2 = u * u, u3 = u2 * u
    const v = (2 * u3 - 3 * u2 + 1) * values[i]
      + (u3 - 2 * u2 + u) * h * this.m0[i]
      + (-2 * u3 + 3 * u2) * values[i + 1]
      + (u3 - u2) * h * this.m1[i]
    return v < 0 ? 0 : v > 100 ? 100 : v
  }
}

const curveCache = new WeakMap()

// Compatibility helper for callers holding a normalized action array.
export function sampleFunscriptPosition(actions, timeMs) {
  if (!actions?.length) return null
  let curve = curveCache.get(actions)
  if (!curve) { curve = new FunscriptCurve(actions); curveCache.set(actions, curve) }
  return curve.sample(Number(timeMs))
}

/**
 * MultiFunPlayer's two-stage media clock (seconds).
 *
 * `internal` advances with the wall clock and moves a third of the way toward
 * each new player observation; `output` chases `internal` at 0.9x–1.1x speed,
 * so a coarse player clock (VLC through the desktop bridge updates every
 * ~100 ms) never makes the script stair-step or run backwards. Only a changed
 * observation counts, anchored to when it was sampled.
 */
export class MediaClock {
  constructor() { this.reset() }

  reset(seconds = null) {
    this.internal = seconds
    this.output = seconds
    this.raw = null
    this.rawAt = null
    this.lastAdvanceAt = null
    this.forceNext = false
    this.held = false
  }

  // A known discontinuity (seek, rate change, loop wrap): re-anchor on the next
  // observation even if it lands close by.
  invalidate() { this.forceNext = true; this.raw = null }

  // Media is buffering ('waiting'); stop extrapolating until it plays again.
  hold(flag) { this.held = !!flag; if (!flag) this.raw = null }

  /** Returns the size of a snap in seconds (Infinity on the first one), or 0. */
  observe(rawSeconds, observedAtMs, rate, now) {
    const raw = Number(rawSeconds)
    if (!Number.isFinite(raw)) return 0
    if (raw === this.raw && this.internal != null && !this.forceNext) return 0
    this.raw = raw
    this.rawAt = observedAtMs
    const expected = raw + Math.max(0, now - observedAtMs) / 1000 * rate
    if (this.forceNext || this.internal == null || Math.abs(expected - this.internal) > SEEK_THRESHOLD_S) {
      const jump = this.internal == null ? Infinity : Math.abs(expected - this.internal)
      this.forceNext = false
      this.internal = this.output = expected
      return jump
    }
    this.internal += 0.33 * (expected - this.internal)
    return 0
  }

  stalled(now) {
    return this.held || (this.rawAt != null && now - this.rawAt > STALL_MS)
  }

  /** Advance to `now` and return the smoothed position (seconds) or null. */
  advance(now, rate) {
    if (this.internal == null) return null
    const dt = this.lastAdvanceAt == null ? 0 : clamp((now - this.lastAdvanceAt) / 1000, 0, 1)
    this.lastAdvanceAt = now
    if (this.stalled(now)) return this.output
    const step = dt * rate
    this.internal += step
    this.output += clamp(this.internal - this.output, step * 0.9, step * 1.1)
    return this.output
  }
}

/**
 * Reads the freshest clock observation a video surface offers. The desktop
 * VLC facade reports when VLC was actually sampled; an HTML video is precise
 * at read time.
 */
export function mediaObservation(video, now) {
  const clock = video?.clock
  if (clock && !video.seeking) return clock
  return {
    time: Number(video?.currentTime) || 0,
    observedAt: now,
    rate: video?.playbackRate || 1,
    revision: null,
    playing: !!video && !video.paused && !video.ended,
  }
}

function smoothstep(t) {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

/**
 * Soft sync and speed limit, applied per axis in script space (0..100)
 * against the last value actually sent to that axis.
 */
export class MotionShaper {
  constructor() {
    this.sent = {}
    this.sync = null
  }

  beginSync(now, seconds) {
    this.sync = seconds > 0 ? { start: now, duration: seconds * 1000, from: { ...this.sent } } : null
  }

  get syncing() { return !!this.sync }

  shape(axis, value, now, elapsedMs, { speedLimit = 0 } = {}) {
    let next = value
    const sync = this.sync
    if (sync) {
      const progress = (now - sync.start) / sync.duration
      if (progress >= 1) this.sync = null
      else {
        const from = sync.from[axis] ?? HOME_POSITION
        next = from + (next - from) * smoothstep(progress)
      }
    }
    const previous = this.sent[axis]
    if (speedLimit > 0 && previous != null) {
      const step = speedLimit * Math.max(elapsedMs, 10) / 1000
      next = clamp(next, previous - step, previous + step)
    }
    return clamp(next, 0, 100)
  }

  record(axis, value) { this.sent[axis] = value }
}

/** Per-axis script mapping shared by the page sampler and independent player. */
export function applyAxisSettings(axis, raw, settings) {
  if (!settings) return raw
  let value = settings.invert ? 100 - raw : raw
  // L0's travel window is the global stroke limiter, applied at send time.
  if (axis !== 'L0') {
    const low = clamp(Number(settings.min ?? 0), 0, 100)
    const high = clamp(Number(settings.max ?? 100), low, 100)
    value = low + (high - low) * value / 100
  }
  return value
}

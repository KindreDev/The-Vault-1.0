/**
 * Device Service — singleton that owns the Buttplug client (v4 API),
 * pattern engine, funscript player, ramp mode, scheduler, and Edge Mode.
 *
 * Buttplug v4 API key differences from v2/v3:
 *  - device.runOutput(DeviceOutput.PositionWithDuration.percent(pos, durationMs))
 *  - client.devices is a Map<index, ButtplugClientDevice>
 *  - OutputType.HwPositionWithDuration for linear/stroker devices
 */
import {
  ButtplugClient,
  ButtplugBrowserWebsocketClientConnector,
  DeviceOutput,
  OutputType,
} from 'buttplug'
import { useDeviceStore, PRESETS } from '../store/deviceStore.js'
import { useFunscriptPlayerStore } from '../store/funscriptPlayerStore.js'

// ── Helpers ───────────────────────────────────────────────────────────────────
const store = () => useDeviceStore.getState()

const LAST_DEVICE_PROVIDER_KEY = 'vault_last_device_provider'
const LAST_SERIAL_PORT_KEY = 'vault_last_serial_port'
const DEVICE_PROVIDERS = new Set(['intiface', 'handy', 'serial'])

function readLastDeviceProvider() {
  try {
    const provider = window.localStorage.getItem(LAST_DEVICE_PROVIDER_KEY)
    return DEVICE_PROVIDERS.has(provider) ? provider : null
  } catch (_) {
    return null
  }
}

function rememberLastDeviceProvider(provider) {
  if (!DEVICE_PROVIDERS.has(provider)) return
  try { window.localStorage.setItem(LAST_DEVICE_PROVIDER_KEY, provider) } catch (_) {}
}

function readLastSerialPort() {
  try {
    const value = JSON.parse(window.localStorage.getItem(LAST_SERIAL_PORT_KEY) || 'null')
    return value && typeof value === 'object' ? value : null
  } catch (_) {
    return null
  }
}

function rememberLastSerialPort(info) {
  if (!info) return
  try {
    window.localStorage.setItem(LAST_SERIAL_PORT_KEY, JSON.stringify({
      usbVendorId: info.usbVendorId ?? null,
      usbProductId: info.usbProductId ?? null,
    }))
  } catch (_) {}
}

// App-level Handy Developer API key — registered once at user.handyfeeling.com.
// Not a per-user credential; baked into the app so users never need to enter it.
const HANDY_APP_KEY = '1sWGa-ThX~iSFzdMTz9pUXPE18P9tfZB'

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

// MFP keeps a small, regular update loop and samples a shape-preserving curve
// between authored points. Keeping the sampler here makes video-linked and
// independent playback use exactly the same motion model.
const FUNSCRIPT_SERIAL_INTERVAL_MS = 10
const FUNSCRIPT_INTIFACE_INTERVAL_MS = 50

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

function mfpPchipSlopes(actions, index) {
  const p0 = actions[index]
  const p1 = actions[index + 1]
  // MultiFunPlayer extrapolates a same-valued ghost point at each end of the
  // script. That gives the first and last segment the same eased boundary
  // behaviour as its KeyframeCollection implementation.
  const previous = actions[index - 1] || { at: 3 * p0.at - 2 * p1.at, pos: p0.pos }
  const next = actions[index + 2] || { at: 3 * p1.at - 2 * p0.at, pos: p1.pos }

  const hPrevious = p0.at - previous.at
  const hCurrent = p1.at - p0.at
  const hNext = next.at - p1.at
  const dPrevious = (p0.pos - previous.pos) / hPrevious
  const dCurrent = (p1.pos - p0.pos) / hCurrent
  const dNext = (next.pos - p1.pos) / hNext

  const weight11 = 2 * hCurrent + hPrevious
  const weight12 = hCurrent + 2 * hPrevious
  let slope0 = (weight11 + weight12) / (weight11 / dPrevious + weight12 / dCurrent)
  if (!Number.isFinite(slope0) || dCurrent * dPrevious < 0) slope0 = 0

  const weight21 = 2 * hNext + hCurrent
  const weight22 = hNext + 2 * hCurrent
  let slope1 = (weight21 + weight22) / (weight21 / dCurrent + weight22 / dNext)
  if (!Number.isFinite(slope1) || dNext * dCurrent < 0) slope1 = 0

  return [slope0, slope1]
}

// Sample a normalized 0..100 funscript at any millisecond position. PCHIP is
// monotonic between points, so fast authored sections stay responsive without
// the overshoot that a regular cubic spline can introduce.
export function sampleFunscriptPosition(actions, timeMs) {
  if (!actions?.length) return null
  if (actions.length === 1) return actions[0].pos

  const time = Number(timeMs)
  if (!Number.isFinite(time) || time <= actions[0].at) return actions[0].pos
  if (time >= actions.at(-1).at) return actions.at(-1).pos

  let lo = 0
  let hi = actions.length - 1
  while (lo + 1 < hi) {
    const middle = (lo + hi) >> 1
    if (actions[middle].at <= time) lo = middle
    else hi = middle
  }

  const left = actions[lo]
  const right = actions[lo + 1]
  const h = right.at - left.at
  if (h <= 0) return right.pos

  const u = clamp((time - left.at) / h, 0, 1)
  const [m0, m1] = mfpPchipSlopes(actions, lo)
  const u2 = u * u
  const u3 = u2 * u
  const h00 = 2 * u3 - 3 * u2 + 1
  const h10 = u3 - 2 * u2 + u
  const h01 = -2 * u3 + 3 * u2
  const h11 = u3 - u2
  return clamp(h00 * left.pos + h10 * h * m0 + h01 * right.pos + h11 * h * m1, 0, 100)
}

// Seek/start semantics: never replay the action immediately before the
// requested point. If the point is beyond the authored track, the cursor sits
// at actions.length and the scheduler emits nothing until a loop is requested.
export function firstActionAtOrAfter(actions, timeMs) {
  const index = (actions || []).findIndex(action => Number(action?.at || 0) >= Number(timeMs || 0))
  return index < 0 ? (actions || []).length : index
}

function lerpPattern(a, b, t) {
  return {
    strokeMin: Math.round(a.strokeMin + (b.strokeMin - a.strokeMin) * t),
    strokeMax: Math.round(a.strokeMax + (b.strokeMax - a.strokeMax) * t),
    spm:       Math.round(a.spm       + (b.spm       - a.spm)       * t),
    waveform:  t < 0.5 ? a.waveform : b.waveform,
  }
}

// ── Device Service ────────────────────────────────────────────────────────────
export class DeviceService {
  constructor() {
    this._client         = null
    this._patternTimer   = null
    this._direction      = 1
    this._rampTimer      = null
    this._rampStartTime  = null
    this._schedulerTimer = null
    this._cumTimer       = null

    // Edge Mode — see the Edge Mode section below.
    this._edgeTimer     = null
    this._edgeRampTimer = null
    this._edgeGate      = 1      // 0..1 output gate; 1 = unrestricted
    this._onEdge        = null   // injected reporter, called when an edge fires

    this._finisherActive = false
    this._finisherPrev   = null   // { mode, presetId } to restore when the finisher stops
    this._msgId          = 100   // counter for raw WS message IDs
    // One acknowledged output stream per Intiface device. Keeping only the
    // newest pending point prevents slow websocket/device acknowledgements from
    // building a stale queue behind the video clock.
    this._intifaceOutputPumps = new Map()
    this._intifaceOutputErrorAt = 0
    this._intifaceUseRawPositionFallback = false

    // Per-device linear feature info extracted at connect time
    // Map<deviceIndex, { featureIndex, maxSteps }>
    this._linearFeatures = new Map()

    // Per-device vibrate feature indices extracted at connect time
    // Map<deviceIndex, number[]> — array to support multi-actuator devices (e.g. Lovense Gush)
    this._vibrateFeatures = new Map()

    // Per-device rotate/oscillate feature indices (Kiiroo Onyx/Titan, Vorze
    // Cyclone/UFO, We-Vibe Nova = Rotate; Fun Factory Stronic = Oscillate)
    this._rotateFeatures   = new Map()
    this._oscillateFeatures = new Map()

    // Funscript
    this._funscript       = null
    this._funscriptTimer  = null          // legacy single-axis timer (kept for safety)
    this._funscriptTimers = {}            // multi-axis: { axisId: timeoutId }
    this._funscriptSamplerTimer = null
    this._funscriptSamplerNextAt = null
    this._funscriptSamplerLastWallAt = null
    this._funscriptSamplerLastPositions = {}
    this._funscriptAxesCache = null
    this._videoEl         = null
    // Independent player clock. It never receives or owns an HTMLVideoElement.
    this._independentFs   = null
    this._independentFsTimer = null
    this._funscriptOwner  = null          // 'video' | 'independent'
    this._independentFsError = null

    // The Handy REST API v3 (HSP streaming protocol) — gated by firmware v4+,
    // not by hardware generation: an original Handy 1 updated to firmware 4
    // works fine, one still on firmware 3 (Handy 1 or 2) does not.
    this._HANDY_BASE      = 'https://www.handyfeeling.com/api/handy-rest/v3/'
    this._handyCurrentPos = 50   // interpolated position 0-100
    this._handyTargetPos  = 50   // position last requested via _sendLinearHandy
    this._handySpeed      = 0    // units/sec toward _handyTargetPos
    this._handyBuffer      = []  // points queued for the next hsp/add batch
    this._handyFlushInFlight = false
    this._handyTailIndex   = 0   // tailPointStreamIndex — total points sent this stream
    this._handyStreamId    = 0
    this._handyPlaying     = false
    this._handyServerOffset = 0  // client-server clock skew, ms
    this._handyTickTimer   = null
    // Funscript streaming (Handy only) — feeds regular sampled curve points
    // into the HSP buffer instead of coarse authored keyframes.
    this._handyFsTimer     = null
    this._handyFsNextSampleMs = 0
    this._handyFsFinished  = false

    // Direct serial (Web Serial API)
    this._serialPort   = null
    this._serialWriter = null
    this._quickTogglePromise = null
    this._quickConnectionDeadline = null
  }

  // ── Connection ──────────────────────────────────────────────────────────────

  async connect() {
    // Mutual exclusion — disconnect other providers first
    const { provider } = store()
    if (provider === 'handy')  await this.disconnectHandy()
    if (provider === 'serial') await this.disconnectSerial()

    const { wsUrl } = store()
    useDeviceStore.setState({ status: 'connecting', errorMsg: null, provider: 'intiface' })
    try {
      this._client = new ButtplugClient('The Vault')
      this._intifaceUseRawPositionFallback = false

      this._client.addListener('deviceadded',   (dev) => this._onDeviceAdded(dev))
      this._client.addListener('deviceremoved', (dev) => this._onDeviceRemoved(dev))
      this._client.addListener('disconnect', () => {
        this._stopAll()
        useDeviceStore.setState({ status: 'disconnected', devices: [], mode: 'off', provider: null })
      })

      const connector = new ButtplugBrowserWebsocketClientConnector(wsUrl)
      await this._client.connect(connector)
      useDeviceStore.setState({ status: 'connected' })
      rememberLastDeviceProvider('intiface')
      this.startEdgeMode()   // no-op unless Edge Mode was left armed

      // Kick off scanning immediately
      try { await this._client.startScanning() } catch (_) {}

    } catch (err) {
      useDeviceStore.setState({
        status: 'error',
        errorMsg: err.message || 'Could not connect to Intiface Central',
        provider: null,
      })
      this._client = null
    }
  }

  async quickToggleConnection({ timeoutMs = 3000 } = {}) {
    if (this._quickTogglePromise) return this._quickTogglePromise

    this._quickTogglePromise = this._runQuickToggleConnection(timeoutMs)
      .finally(() => { this._quickTogglePromise = null })
    return this._quickTogglePromise
  }

  async _runQuickToggleConnection(timeoutMs) {
    const current = store()
    if (current.status === 'connecting') return { ok: false, reason: 'busy' }

    if (current.status === 'connected' && current.provider) {
      await this._disconnectProvider(current.provider)
      return { ok: true, action: 'disconnected' }
    }

    const provider = readLastDeviceProvider()
    if (!provider) throw new Error('No previously connected device')

    const deadline = Date.now() + timeoutMs
    this._quickConnectionDeadline = deadline
    let timedOut = false
    const connectPromise = provider === 'intiface'
      ? this.connect()
      : provider === 'handy'
      ? this.connectHandy()
      : this.connectSerial({ reusePermission: true })

    // A provider may finish just after the UI timeout. If that happens, tear
    // it down instead of allowing a late reconnect to appear successful.
    void Promise.resolve(connectPromise)
      .then(() => timedOut ? this._disconnectProvider(provider) : undefined)
      .catch(() => {})
      .finally(() => {
        if (this._quickConnectionDeadline === deadline) this._quickConnectionDeadline = null
      })

    const result = await Promise.race([
      connectPromise.then(() => ({ timedOut: false })),
      new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), timeoutMs)),
    ])

    if (result.timedOut) {
      timedOut = true
      // The providers clean up their own live handles. This also prevents a
      // timed-out reconnect from leaving a stale provider marked as active.
      await this._disconnectProvider(provider).catch(() => {})
      const error = new Error('Could not find the last device within 3 seconds')
      useDeviceStore.setState({ status: 'error', errorMsg: error.message, provider: null })
      throw error
    }

    const next = store()
    if (next.status !== 'connected') {
      throw new Error(next.errorMsg || 'Could not reconnect to the last device')
    }
    return { ok: true, action: 'connected', provider }
  }

  async _disconnectProvider(provider) {
    if (provider === 'handy') return this.disconnectHandy()
    if (provider === 'serial') return this.disconnectSerial()
    return this.disconnect()
  }

  async disconnect() {
    this._stopAll()
    if (this._client) {
      try { await this._client.stopAllDevices() } catch (_) {}
      try { await this._client.disconnect() }     catch (_) {}
      this._client = null
    }
    useDeviceStore.setState({ status: 'disconnected', devices: [], mode: 'off', provider: null })
  }

  _onDeviceAdded(dev) {
    const isLinear    = dev.hasOutput(OutputType.HwPositionWithDuration) ||
                        dev.hasOutput(OutputType.Position)
    const isVibrate   = dev.hasOutput(OutputType.Vibrate)
    const isRotate    = dev.hasOutput(OutputType.Rotate)
    const isOscillate = dev.hasOutput(OutputType.Oscillate)

    // Rebuild this device's feature maps from scratch. 'deviceadded' can fire
    // again for a device that's already known (rescan / reconnect), and the old
    // code appended — which is why servers saw the same FeatureIndex repeated
    // several times in one command.
    this._linearFeatures.delete(dev.index)
    this._vibrateFeatures.delete(dev.index)
    this._rotateFeatures.delete(dev.index)
    this._oscillateFeatures.delete(dev.index)

    // Extract feature info for the output path. Scalar actuators carry their
    // own step count: Buttplug values are integer steps in the device's own
    // range, NOT a 0–1 fraction.
    const outputTypes = []
    const addScalar = (map, featIdx, spec) => {
      const list = map.get(dev.index) || []
      if (list.some(f => f.featureIndex === featIdx)) return
      list.push({ featureIndex: featIdx, maxSteps: spec?.Value?.[1] ?? 100 })
      map.set(dev.index, list)
    }

    for (const [featIdx, feat] of dev.features) {
      const raw = feat._feature?.Output
      if (!raw) continue
      outputTypes.push(...Object.keys(raw))
      if (raw.HwPositionWithDuration && !this._linearFeatures.has(dev.index)) {
        this._linearFeatures.set(dev.index, {
          featureIndex: featIdx,
          maxSteps: raw.HwPositionWithDuration.Value?.[1] ?? 99,
        })
      }
      if (raw.Vibrate   !== undefined) addScalar(this._vibrateFeatures,   featIdx, raw.Vibrate)
      if (raw.Rotate    !== undefined) addScalar(this._rotateFeatures,    featIdx, raw.Rotate)
      if (raw.Oscillate !== undefined) addScalar(this._oscillateFeatures, featIdx, raw.Oscillate)
    }

    useDeviceStore.setState({
      devices: [
        ...store().devices.filter(d => d.index !== dev.index),
        {
          name: dev.name,
          index: dev.index,
          canLinear: isLinear,
          canVibrate: isVibrate,
          canRotate: isRotate,
          canOscillate: isOscillate,
          outputTypes: [...new Set(outputTypes)],
        },
      ],
    })
  }

  _onDeviceRemoved(dev) {
    const pump = this._intifaceOutputPumps.get(dev.index)
    if (pump) {
      pump.cancelled = true
      pump.pending = null
      this._intifaceOutputPumps.delete(dev.index)
    }
    this._linearFeatures.delete(dev.index)
    this._vibrateFeatures.delete(dev.index)
    this._rotateFeatures.delete(dev.index)
    this._oscillateFeatures.delete(dev.index)
    useDeviceStore.setState({
      devices: store().devices.filter(d => d.index !== dev.index),
    })
  }

  // Returns linear/stroker devices from the live client
  _getLinearDevices() {
    if (!this._client) return []
    return [...this._client.devices.values()].filter(d =>
      d.hasOutput(OutputType.HwPositionWithDuration) || d.hasOutput(OutputType.Position)
    )
  }

  // Returns a human-readable list of output types for all connected devices (for error messages)
  _describeDevices() {
    if (!this._client) return 'none'
    return [...this._client.devices.values()].map(d => {
      const types = []
      for (const feat of d.features.values()) {
        const raw = feat._feature?.Output
        if (raw) types.push(...Object.keys(raw))
      }
      return `${d.name} [${types.join(', ') || 'no outputs'}]`
    }).join(' | ') || 'no devices'
  }

  _sendLinear(posPercent, durationMs) {
    // ── Edge Mode gate ────────────────────────────────────────────────────────
    // Applied before provider routing so every device path is gated equally.
    // A fully closed gate sends nothing at all — the device simply holds its
    // last commanded position, which resumes instantly on release.
    const gate = this._edgeGate
    if (gate <= 0) return
    if (gate < 1 && store().mode === 'funscript') {
      // A funscript is locked to the video timeline, so it cannot be slowed
      // without desyncing. Damp the stroke toward the midpoint instead: same
      // rhythm, smaller movement.
      posPercent = 50 + (posPercent - 50) * gate
    }

    // ── Provider routing ──────────────────────────────────────────────────────
    const { provider } = store()
    if (provider === 'handy')  { this._sendLinearHandy(posPercent, durationMs);  return }
    if (provider === 'serial') { this._sendLinearSerial(posPercent, durationMs); return }

    // ── Apply stroke limiter globally ─────────────────────────────────────────
    // strokeFloor / strokeCeiling constrain ALL device movement, regardless of
    // mode (freestyle, funscript, cum, test). posPercent is always 0-100.
    const { strokeFloor, strokeCeiling } = store()
    const limitedPercent = strokeFloor + (strokeCeiling - strokeFloor) * (posPercent / 100)

    const pos = clamp(limitedPercent / 100, 0, 1)
    // The sampler already controls cadence. Do not stretch short authored
    // segments to 50ms; that makes fast strokes visibly lag and pile up.
    const dur = Math.max(1, Math.round(durationMs))
    for (const dev of this._getLinearDevices()) {
      const info = this._linearFeatures.get(dev.index)
      if (!info) continue
      const steps = Math.round(info.maxSteps * pos)
      this._queueIntifacePosition(dev, info.featureIndex, steps, dur)
    }

    // Drive non-linear actuators: map stroke-limited position → intensity.
    // Devices that also support linear are skipped (they already received a position command).
    this._sendScalarActuator(this._vibrateFeatures,   pos, 'Vibrate')
    this._sendScalarActuator(this._rotateFeatures,    pos, 'Rotate')
    this._sendScalarActuator(this._oscillateFeatures, pos, 'Oscillate')
  }

  // The Buttplug client owns message ids, response matching, and the exact
  // OutputCmd schema. MFP also waits for each output command to be accepted
  // before advancing its fixed output loop. Use a latest-value pump here so a
  // busy device cannot play a backlog of old positions after a fast segment.
  _queueIntifacePosition(dev, featureIndex, steps, durationMs) {
    const duration = Math.max(1, Math.round(durationMs))
    if (this._intifaceUseRawPositionFallback) {
      this._rawSend({
        OutputCmd: {
          Id: this._msgId++,
          DeviceIndex: dev.index,
          FeatureIndex: featureIndex,
          Command: { HwPositionWithDuration: { Value: Math.round(steps), Duration: duration } },
        },
      })
      return
    }
    let pump = this._intifaceOutputPumps.get(dev.index)
    if (!pump) {
      pump = { active: false, pending: null, cancelled: false }
      this._intifaceOutputPumps.set(dev.index, pump)
    }
    pump.cancelled = false
    pump.pending = {
      featureIndex,
      steps: Math.round(steps),
      duration,
    }
    if (pump.active) return
    pump.active = true
    void this._drainIntifacePosition(dev, pump)
  }

  async _drainIntifacePosition(dev, pump) {
    try {
      while (!pump.cancelled && pump.pending) {
        const command = pump.pending
        pump.pending = null
        const feature = dev.features?.get(command.featureIndex)
        if (!feature || !feature.hasOutput(OutputType.HwPositionWithDuration)) break
        try {
          await feature.runOutput(
            DeviceOutput.HwPositionWithDuration.steps(command.steps, command.duration),
          )
        } catch (err) {
          // A disconnected device can reject while the sampler is still alive.
          // Keep the player running. Some older Intiface bridges only accept
          // the legacy scalar Value shape, so retain a one-shot raw fallback
          // instead of turning a compatibility mismatch into silence.
          this._intifaceUseRawPositionFallback = true
          this._rawSend({
            OutputCmd: {
              Id: this._msgId++,
              DeviceIndex: dev.index,
              FeatureIndex: command.featureIndex,
              Command: { HwPositionWithDuration: { Value: command.steps, Duration: command.duration } },
            },
          })
          // Avoid flooding the console every tick.
          const now = Date.now()
          if (now - this._intifaceOutputErrorAt > 1000) {
            this._intifaceOutputErrorAt = now
            console.warn('Intiface position command failed', err)
          }
        }
      }
    } finally {
      pump.active = false
      const isCurrent = this._intifaceOutputPumps.get(dev.index) === pump
      if (!isCurrent || pump.cancelled || !pump.pending) {
        if (isCurrent) this._intifaceOutputPumps.delete(dev.index)
      } else {
        pump.active = true
        void this._drainIntifacePosition(dev, pump)
      }
    }
  }

  // Send a scalar intensity command (pos is 0.0–1.0, already stroke-limited) to
  // devices exposing the given actuator type that are NOT also linear
  // (e.g. pure vibrators, Kiiroo Onyx/Titan rotate sleeves, Fun Factory Stronic oscillators).
  //
  // Two things this has to get right, both of which used to be wrong:
  //  · The message is OutputCmd. ScalarCmd was removed in the current Buttplug
  //    message spec — servers reject the whole payload with
  //    "unknown variant `ScalarCmd`", so nothing moved at all.
  //  · Value is an integer step in the feature's own range, not a 0–1 fraction.
  //    Every device advertises its own step count, so 0.5 meant "step 0" (off)
  //    on hardware that steps 0–20.
  _sendScalarActuator(featureMap, pos, actuatorType) {
    const storeDevs = store().devices
    const frac = clamp(pos, 0, 1)
    for (const [devIndex, feats] of featureMap) {
      const d = storeDevs.find(sd => sd.index === devIndex)
      if (d?.canLinear) continue  // linear device already handled
      for (const f of feats) {
        this._rawSend({
          OutputCmd: {
            Id: this._msgId++,
            DeviceIndex: devIndex,
            FeatureIndex: f.featureIndex,
            Command: { [actuatorType]: { Value: Math.round(f.maxSteps * frac) } },
          },
        })
      }
    }
  }

  // Silence every non-linear actuator by commanding intensity 0.
  //
  // Stopping used to mean "stop sending commands", which is only correct for a
  // stroker: a linear device holds its position, which is what you want on
  // pause. A vibrator holds its last *intensity* — so stopping left it buzzing
  // at a fixed level forever, and the only way out was unplugging it.
  //
  // Linear devices are deliberately left alone here: they keep their position,
  // matching how every other script player behaves.
  //
  // This goes out over _rawSend rather than the SDK's stopAllDevices() for the
  // same reason every other command in this file does — the SDK emits a payload
  // shape Intiface v4 rejects outright, and the rejection is invisible because
  // it is swallowed by the caller's catch.
  _stopScalarActuators() {
    if (store().provider !== 'intiface') return   // Handy + serial are linear-only
    const maps = [
      [this._vibrateFeatures,   'Vibrate'],
      [this._rotateFeatures,    'Rotate'],
      [this._oscillateFeatures, 'Oscillate'],
    ]
    const storeDevs = store().devices
    for (const [featureMap, actuatorType] of maps) {
      for (const [devIndex, feats] of featureMap) {
        const d = storeDevs.find(sd => sd.index === devIndex)
        if (d?.canLinear) continue   // stroker — holds position, must not be zeroed
        for (const f of feats) {
          this._rawSend({
            OutputCmd: {
              Id: this._msgId++,
              DeviceIndex: devIndex,
              FeatureIndex: f.featureIndex,
              Command: { [actuatorType]: { Value: 0 } },
            },
          })
        }
      }
    }
  }

  // Stop outputs without stopping discovery, input subscriptions, the client,
  // or the Intiface WebSocket. A global StopCmd can make some device/server
  // combinations effectively disappear until a full reconnect, so emergency
  // stop is deliberately scoped per connected device.
  _stopIntifaceOutputs() {
    if (store().provider !== 'intiface' || !this._client) return
    for (const pump of this._intifaceOutputPumps.values()) {
      pump.cancelled = true
      pump.pending = null
    }
    this._intifaceOutputPumps.clear()
    for (const dev of this._client.devices.values()) {
      this._rawSend({
        StopCmd: {
          Id: this._msgId++,
          DeviceIndex: dev.index,
          FeatureIndex: undefined,
          Inputs: false,
          Outputs: true,
        },
      })
    }
  }

  // ── Test stroke ─────────────────────────────────────────────────────────────

  // Send raw WS message bypassing the SDK (for fallback/debug)
  _rawSend(msg) {
    const ws = this._client?._connector?._ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    try {
      ws.send(JSON.stringify([msg]))
      return true
    } catch (err) {
      console.warn('Intiface command failed', err)
      return false
    }
  }

  async testStroke() {
    if (store().status !== 'connected') return
    const { provider } = store()

    if (provider === 'handy' || provider === 'serial') {
      const dur = 700
      this._sendLinear(100, dur)
      await new Promise(r => setTimeout(r, dur + 100))
      this._sendLinear(0, dur)
      return
    }

    // Intiface: verify we have at least one compatible device
    const hasLinear    = this._getLinearDevices().length > 0
    const hasVibrate   = this._vibrateFeatures.size > 0
    const hasRotate    = this._rotateFeatures.size > 0
    const hasOscillate = this._oscillateFeatures.size > 0
    if (!hasLinear && !hasVibrate && !hasRotate && !hasOscillate) {
      throw new Error(`No compatible devices detected. Connected: ${this._describeDevices()}`)
    }
    // _sendLinear routes to linear, vibrate-only, rotate-only, and oscillate-only devices in one call
    const dur = 700
    this._sendLinear(100, dur)
    await new Promise(r => setTimeout(r, dur + 100))
    this._sendLinear(0, dur)
  }

  // ── Emergency stop ──────────────────────────────────────────────────────────

  async stop() {
    this._stopAll()
    // Emergency stop disarms Edge Mode too — leaving the toggle lit while the
    // engine is dead would be a lie, and a stray edge must not restart output.
    if (store().edgeModeEnabled) useDeviceStore.getState().setEdgeModeEnabled(false)
    const { provider } = store()
    if (provider === 'intiface' && this._client) {
      // stopAllDevices() alone was not enough — see _stopScalarActuators.
      this._stopIntifaceOutputs()
    } else if (provider === 'serial') {
      this._sendLinearSerial(0, 1500)
    }
    useDeviceStore.setState({ mode: 'off' })
  }

  // ── Freestyle mode ──────────────────────────────────────────────────────────

  startFreestyle() {
    if (store().status !== 'connected') return
    useDeviceStore.setState({ mode: 'freestyle' })
    this._stopPatternEngine()
    this._startPatternEngine()
    if (store().rampEnabled)      this._startRamp()
    if (store().schedulerEnabled) this._startScheduler()
    // Edge Mode is deliberately NOT started here — it spans every mode and is
    // armed on connect, so leaving freestyle must not disarm it.
  }

  stopFreestyle() {
    this._stopPatternEngine()
    this._stopRamp()
    this._stopScheduler()
    // Killing the engine stops new commands but leaves a vibrator running at
    // whatever intensity it last received. Silence it explicitly.
    this._stopScalarActuators()
    useDeviceStore.setState({ mode: 'off' })
  }

  // ── Pattern engine ──────────────────────────────────────────────────────────

  _startPatternEngine() {
    this._stopPatternEngine()
    this._direction = 1
    this._patternTick()
  }

  _stopPatternEngine() {
    clearTimeout(this._patternTimer)
    this._patternTimer = null
  }

  _patternTick() {
    if (store().mode !== 'freestyle') return

    const pattern  = store().getEffectivePattern()
    const variance = store().variance        // 0–100
    // Edge Mode slows freestyle by stretching each half-stroke. The tick timer
    // uses the same stretched value, so the engine stays in step with itself.
    const gate     = clamp(this._edgeGate, 0.05, 1)
    const halfDur  = Math.round(60000 / pattern.spm / 2 / gate)
    const spread   = (pattern.strokeMax - pattern.strokeMin) * variance / 100

    // At variance=0 always hits exact endpoints; higher variance picks a
    // random landing anywhere within the inward spread from each endpoint.
    const targetPos = this._direction === 1
      ? pattern.strokeMax - Math.random() * spread
      : pattern.strokeMin + Math.random() * spread

    this._sendLinear(targetPos, halfDur)
    this._direction *= -1
    this._patternTimer = setTimeout(() => this._patternTick(), halfDur)
  }

  // ── Ramp mode ───────────────────────────────────────────────────────────────

  _startRamp() {
    this._stopRamp()
    this._rampStartTime = Date.now()
    this._rampTick()
  }

  _stopRamp() {
    clearTimeout(this._rampTimer)
    this._rampTimer = null
    this._rampStartTime = null
    useDeviceStore.setState({ rampProgress: 0 })
  }

  _rampTick() {
    const s = store()
    if (!s.rampEnabled || s.mode !== 'freestyle') return

    const elapsed = (Date.now() - this._rampStartTime) / 1000
    const total   = s.rampDurationMin * 60
    const t       = clamp(elapsed / total, 0, 1)

    useDeviceStore.setState({ rampProgress: t })

    const startP = PRESETS.find(p => p.id === s.rampStartPreset) || PRESETS[0]
    const endP   = PRESETS.find(p => p.id === s.rampEndPreset)   || PRESETS[PRESETS.length - 2]
    const interp = lerpPattern(startP, endP, t)
    useDeviceStore.setState({ customPattern: interp, activePresetId: 'custom' })

    if (t >= 1) { this._stopRamp(); return }
    this._rampTimer = setTimeout(() => this._rampTick(), 2000)
  }

  // ── Pattern scheduler ────────────────────────────────────────────────────────

  _startScheduler() {
    this._stopScheduler()
    useDeviceStore.setState({ schedulerStep: 0 })
    this._runSchedulerStep()
  }

  _stopScheduler() {
    clearTimeout(this._schedulerTimer)
    this._schedulerTimer = null
  }

  _runSchedulerStep() {
    const s = store()
    if (!s.schedulerEnabled || s.mode !== 'freestyle' || !s.schedulerSteps.length) return
    const step = s.schedulerSteps[s.schedulerStep]
    if (!step) return
    useDeviceStore.setState({ activePresetId: step.presetId })
    this._schedulerTimer = setTimeout(() => {
      const next = (store().schedulerStep + 1) % store().schedulerSteps.length
      useDeviceStore.setState({ schedulerStep: next })
      this._runSchedulerStep()
    }, step.durationMin * 60 * 1000)
  }

  // Play the scheduler queue once (linear, no loop) then stop the device.
  playSchedulerOnce() {
    if (store().status !== 'connected') return
    const steps = store().schedulerSteps
    if (!steps.length) return

    this._stopPatternEngine()
    this._stopScheduler()
    this._stopRamp()
    useDeviceStore.setState({ mode: 'freestyle', schedulerRunningOnce: true, schedulerStep: 0 })
    this._startPatternEngine()
    this._runSchedulerOnce(0)
  }

  _runSchedulerOnce(stepIdx) {
    if (!store().schedulerRunningOnce) return
    const steps = store().schedulerSteps
    if (stepIdx >= steps.length) {
      useDeviceStore.setState({ schedulerRunningOnce: false })
      this.stop()
      return
    }
    const step = steps[stepIdx]
    useDeviceStore.setState({ activePresetId: step.presetId, schedulerStep: stepIdx })
    this._schedulerTimer = setTimeout(
      () => this._runSchedulerOnce(stepIdx + 1),
      step.durationMin * 60 * 1000,
    )
  }

  stopSchedulerOnce() {
    useDeviceStore.setState({ schedulerRunningOnce: false })
    this._stopScheduler()
    this.stop()
  }

  // ── Edge Mode ─────────────────────────────────────────────────────────────
  //
  // Arms a repeating cycle: wait a (random or fixed) interval, then cut or damp
  // device output for a (random or fixed) hold, then release and re-arm.
  //
  // The cut is applied as a single output gate (`_edgeGate`, 0..1) read by
  // _sendLinear, rather than by swapping patterns like the old edging assist
  // did. That is what lets it work in every mode:
  //   • freestyle — the gate stretches stroke durations, so the device slows
  //   • funscript — the script is locked to the video and cannot be slowed, so
  //     the gate damps stroke amplitude toward the midpoint instead
  //   • gate 0    — nothing is sent at all; the device holds where it is
  //
  // Every edge also credits whatever is on screen (see _reportEdge).

  startEdgeMode() {
    this._stopEdgeMode()
    // An edge is a thing the device does. With nothing connected there is
    // nothing to cut, so arming would just award XP for imaginary edges.
    if (!store().edgeModeEnabled || store().status !== 'connected') return
    useDeviceStore.setState({ edgeSessionCount: 0 })
    this._scheduleEdge()
  }

  _stopEdgeMode() {
    clearTimeout(this._edgeTimer)
    clearInterval(this._edgeRampTimer)
    this._edgeTimer     = null
    this._edgeRampTimer = null
    this._edgeGate      = 1
    useDeviceStore.setState({ edgeActive: false, edgeNextAt: null })
  }

  // Public — the UI toggle and the hotkey both go through here.
  setEdgeMode(enabled) {
    useDeviceStore.getState().setEdgeModeEnabled(enabled)
    if (enabled) this.startEdgeMode()
    else         this._stopEdgeMode()
  }

  _scheduleEdge() {
    const s       = store()
    const waitSec = s.rollEdgeInterval()
    useDeviceStore.setState({ edgeActive: false, edgeNextAt: Date.now() + waitSec * 1000 })
    this._edgeTimer = setTimeout(() => this._fireEdge(), waitSec * 1000)
  }

  _fireEdge() {
    const s = store()
    if (!s.edgeModeEnabled) { this._stopEdgeMode(); return }

    this._edgeGate = s.edgeActionMode === 'slow'
      ? clamp(s.edgeSlowPercent / 100, 0, 1)
      : 0

    // The Handy streams funscripts server-side and never passes through
    // _sendLinear, so its already-queued points have to be re-cut by hand.
    if (s.provider === 'handy' && s.mode === 'funscript') this._handyEdgeHold()

    useDeviceStore.setState({
      edgeActive: true,
      edgeNextAt: null,
      edgeSessionCount: s.edgeSessionCount + 1,
    })
    this._reportEdge()

    const holdMs = s.rollEdgeDuration() * 1000
    this._edgeTimer = setTimeout(() => this._releaseEdge(), holdMs)
  }

  _releaseEdge() {
    const s = store()
    const isHandyScript = s.provider === 'handy' && s.mode === 'funscript'

    const rampSec = s.edgeRampBackSec
    if (rampSec <= 0) {
      this._edgeGate = 1
      if (isHandyScript) this._handyEdgeHold()
      useDeviceStore.setState({ edgeActive: false })
      this._scheduleEdge()
      return
    }

    // Ease output back up rather than snapping, so the return isn't a jolt.
    const start = this._edgeGate
    const t0    = Date.now()
    clearInterval(this._edgeRampTimer)
    this._edgeRampTimer = setInterval(() => {
      const t = clamp((Date.now() - t0) / (rampSec * 1000), 0, 1)
      this._edgeGate = start + (1 - start) * t
      if (t >= 1) {
        clearInterval(this._edgeRampTimer)
        this._edgeRampTimer = null
        this._edgeGate = 1
      }
    }, 100)

    // One re-cut at the start of the ramp clears the flatlined points already
    // on the device; from there each 250ms feed tick picks up the rising gate
    // on its own, so the ramp costs no extra round-trips.
    if (isHandyScript) this._handyEdgeHold()

    useDeviceStore.setState({ edgeActive: false })
    this._scheduleEdge()
  }

  // Credit every image currently on screen. Injected by the app at startup so
  // the device service stays free of API and store imports.
  _reportEdge() {
    try { this._onEdge?.() } catch (_) {}
  }

  setEdgeReporter(fn) { this._onEdge = fn }

  // ── Funscript mode ──────────────────────────────────────────────────────────

  loadFunscript(funscriptData, videoEl) {
    this._funscript = funscriptData
    this._funscriptAxesCache = null
    this._videoEl   = videoEl
    if (store().mode === 'funscript') { this._startFunscriptPlayer(); return }
    // Auto-sync: hand control straight to the device so a funscripted video
    // just works without reaching for the Sync button every time.
    if (store().autoSyncFunscript && store().status === 'connected') {
      this.takeFunscriptControl()
    }
  }

  // Lets the video player reflect auto-sync in its Sync button state.
  isFunscriptActive() {
    return store().mode === 'funscript'
  }

  takeFunscriptControl() {
    if (!this._funscript || !this._videoEl) return
    // A video sync explicitly wins device ownership. Keep the independent
    // player's script loaded/paused, but never let two clocks send output.
    this.pauseIndependentFunscript()
    this._funscriptOwner = 'video'
    const prev = store().mode
    useDeviceStore.setState({ mode: 'funscript', previousMode: prev })
    this._stopPatternEngine()
    this._startFunscriptPlayer()
  }

  releaseFunscriptControl() {
    if (this._funscriptOwner && this._funscriptOwner !== 'video') return
    this._stopFunscriptPlayer()
    this._funscriptOwner = null
    store().restorePreviousMode()
    if (store().mode === 'freestyle') this._startPatternEngine()
  }

  unloadFunscript() {
    if (this._funscriptOwner === 'independent') {
      // The video component may unmount while the independent script keeps
      // playing; clear only its stale references, never the independent clock.
      this._funscript = null
      this._funscriptAxesCache = null
      this._videoEl = null
      return
    }
    if (this._funscriptOwner && this._funscriptOwner !== 'video') return
    this._stopFunscriptPlayer()
    this._funscript = null
    this._funscriptAxesCache = null
    this._videoEl   = null
    this._funscriptOwner = null
  }

  _startFunscriptPlayer() {
    this._stopFunscriptPlayer()
    if (!this._funscript || !this._videoEl || this._funscriptOwner === 'independent') return
    // The Handy streams authored points itself; other providers use the regular
    // interpolated sampler below.
    if (store().provider === 'handy') { this._startHandyFsFeed(); return }
    this._startFunscriptSampler()
  }

  _stopFunscriptPlayer() {
    clearTimeout(this._funscriptTimer)
    this._funscriptTimer = null
    for (const t of Object.values(this._funscriptTimers || {})) clearTimeout(t)
    this._funscriptTimers = {}
    clearTimeout(this._funscriptSamplerTimer)
    this._funscriptSamplerTimer = null
    this._funscriptSamplerNextAt = null
    this._funscriptSamplerLastWallAt = null
    this._funscriptSamplerLastPositions = {}
    if (this._handyFsTimer) {
      this._stopHandyFsFeed()
      // Points are queued up to 1.5s ahead — without clearing them the device
      // keeps stroking after the video has stopped.
      this._handyFsResync()
    }
  }

  // Normalize the loaded funscript into { axisId: actions[] }. Prefers the
  // backend's `axes` map (multi-axis); falls back to the legacy single-axis
  // `actions` array as L0 so older / single-axis scripts behave exactly as before.
  _getFunscriptAxes() {
    if (this._funscriptAxesCache) return this._funscriptAxesCache
    const f = this._funscript
    if (!f) return {}
    if (f.axes && typeof f.axes === 'object') {
      const out = {}
      for (const [k, v] of Object.entries(f.axes)) {
        const actions = normalizeFunscriptActions(v)
        if (actions.length) out[k] = actions
      }
      if (Object.keys(out).length) {
        this._funscriptAxesCache = out
        return out
      }
    }
    if (Array.isArray(f.actions) && f.actions.length) {
      this._funscriptAxesCache = { L0: normalizeFunscriptActions(f.actions) }
      return this._funscriptAxesCache
    }
    return {}
  }

  _funscriptOutputInterval() {
    return store().provider === 'serial'
      ? FUNSCRIPT_SERIAL_INTERVAL_MS
      : FUNSCRIPT_INTIFACE_INTERVAL_MS
  }

  _funscriptDirtyThreshold() {
    // Serial output has 0.01-position precision. Buttplug/MFP's output target
    // uses a 0.5-step threshold for a 0..100 script, so retain that bandwidth
    // guard only for the integer-step Intiface path.
    return store().provider === 'serial' ? 0.01 : 0.5
  }

  _startFunscriptSampler() {
    if (store().mode !== 'funscript' || this._funscriptOwner === 'independent' || !this._funscript || !this._videoEl) return
    if (this._videoEl.paused || this._videoEl.ended) return
    const interval = this._funscriptOutputInterval()
    this._funscriptSamplerLastWallAt = null
    this._funscriptSamplerLastPositions = {}
    this._funscriptSamplerNextAt = (typeof performance !== 'undefined' ? performance.now() : Date.now())
    const tick = () => {
      if (this._funscriptSamplerTimer == null) return
      this._tickFunscriptSampler()
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
      this._funscriptSamplerNextAt += interval
      // If a tab was suspended or a command callback took too long, resume
      // from the current clock instead of emitting a burst of catch-up ticks.
      if (this._funscriptSamplerNextAt < now - interval) this._funscriptSamplerNextAt = now + interval
      this._funscriptSamplerTimer = setTimeout(tick, Math.max(0, this._funscriptSamplerNextAt - now))
    }
    this._funscriptSamplerTimer = setTimeout(tick, 0)
    this._tickFunscriptSampler()
  }

  _tickFunscriptSampler() {
    if (store().mode !== 'funscript' || this._funscriptOwner === 'independent' || !this._funscript || !this._videoEl) return
    if (this._videoEl.paused || this._videoEl.ended) return

    const wallNow = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const interval = this._funscriptOutputInterval()
    const elapsed = this._funscriptSamplerLastWallAt == null
      ? interval
      : clamp(wallNow - this._funscriptSamplerLastWallAt, 1, 250)
    this._funscriptSamplerLastWallAt = wallNow

    // Positive offset delays the script relative to the video. Sampling the
    // shifted clock preserves that convention without changing segment widths.
    const timeMs = this._videoEl.currentTime * 1000 + (store().funscriptOffsetMs || 0)
    const axes = this._getFunscriptAxes()
    const enabled = store().funscriptAxes || {}
    for (const [axisId, actions] of Object.entries(axes)) {
      if (enabled[axisId] === false) continue
      const position = sampleFunscriptPosition(actions, timeMs)
      if (position == null) continue

      // Avoid flooding an output with indistinguishable values while still
      // sending the first sample after every seek.
      const previous = this._funscriptSamplerLastPositions[axisId]
      if (previous != null && Math.abs(position - previous) < this._funscriptDirtyThreshold()) continue
      this._sendAxis(axisId, position, elapsed)
      this._funscriptSamplerLastPositions[axisId] = position
    }
  }

  // Seek / play / pause all route through _startFunscriptPlayer so the right
  // engine runs for the active provider (Handy streams, everything else samples
  // a regular interpolated clock). _startFunscriptPlayer stops the previous one first.
  onVideoSeek() {
    if (this._funscriptOwner === 'independent') return
    this._stopFunscriptPlayer()
    if (store().mode === 'funscript') this._startFunscriptPlayer()
  }

  // Update the funscript sync offset and re-arm the sampler immediately so the
  // change takes effect without a seek.
  setFunscriptOffset(ms) {
    useDeviceStore.getState().setFunscriptOffset(ms)
    this.onVideoSeek()
  }

  onVideoPause() {
    // Stop scheduling future commands. A stroker holds its last position, which
    // is the right behaviour on pause — but a vibrator would hold its last
    // intensity and keep buzzing through the pause, so scalar actuators are
    // zeroed. onVideoPlay() re-arms the scheduler and they pick straight back up.
    if (this._funscriptOwner === 'video' && store().mode === 'funscript') this._stopFunscriptPlayer()
    this._stopScalarActuators()
  }

  onVideoPlay() {
    // Resume scheduling from the new current time
    if (this._funscriptOwner === 'video' && store().mode === 'funscript') this._startFunscriptPlayer()
  }

  // ── Independent funscript player ─────────────────────────────────────────
  // This clock is intentionally separate from the video scheduler above. It
  // consumes an axes/actions payload, emits device commands, and reports time
  // to the persistent UI. No video element, media queue, or panel state enters
  // this path.
  getIndependentFunscriptDuration(payload) {
    const axes = payload?.axes && typeof payload.axes === 'object'
      ? Object.values(payload.axes) : [payload?.actions || []]
    return Math.max(0, ...axes.flat().map(a => Number(a?.at || 0))) / 1000
  }

  getIndependentFunscriptError() { return this._independentFsError }

  _independentAxes(payload) {
    if (payload?.axes && typeof payload.axes === 'object') {
      const axes = {}
      for (const [axis, actions] of Object.entries(payload.axes)) {
        const normalized = normalizeFunscriptActions(actions)
        if (normalized.length) axes[axis] = normalized
      }
      if (Object.keys(axes).length) return axes
    }
    const actions = normalizeFunscriptActions(payload?.actions)
    return actions.length ? { L0: actions } : {}
  }

  startIndependentFunscript(payload, options = {}) {
    this._independentFsError = null
    if (!payload) return false
    if (store().status !== 'connected') {
      this._independentFsError = 'Connect a device before playing a funscript'
      options.onError?.(this._independentFsError)
      return false
    }
    const axes = this._independentAxes(payload)
    if (!Object.keys(axes).length) {
      this._independentFsError = 'This funscript has no actions'
      options.onError?.(this._independentFsError)
      return false
    }
    // Video sync loses ownership deterministically. Its linked script remains
    // loaded and can be reclaimed by the existing Sync control later.
    if (this._funscriptOwner === 'video') {
      this._stopFunscriptPlayer()
      this._funscriptOwner = null
      useDeviceStore.setState({ mode: 'off' })
    }
    this._stopIndependentFunscriptClock()
    this._stopPatternEngine()
    this._funscriptOwner = 'independent'
    useDeviceStore.setState({ mode: 'funscript', previousMode: 'off' })

    const rawDuration = Number(payload.duration || 0)
    const duration = (rawDuration > 10000 ? rawDuration / 1000 : rawDuration)
      || this.getIndependentFunscriptDuration(payload)
    const state = {
      axes,
      duration,
      // Player/store time is seconds. Funscript action timestamps are ms and
      // are converted only when comparing against this clock.
      startTime: Math.max(0, Number(options.startTime || 0)),
      speed: Math.max(0.25, Math.min(3, Number(options.speed || 1))),
      range: options.range || { min: 0, max: 100 },
      intensity: Math.max(0, Math.min(2, Number(options.intensity ?? 1))),
      axisEnabled: options.axisEnabled || {},
      loop: !!options.loop,
      loopRegion: options.loopRegion || null,
      startedAt: Date.now(),
      lastWallAt: null,
      lastPositions: {},
      indexes: {},
      onTime: options.onTime,
      onPause: options.onPause,
      onEnd: options.onEnd,
      onError: options.onError,
      paused: false,
    }
    const unsupportedAxes = Object.keys(axes).filter(axis => axis !== 'L0' && store().provider !== 'serial')
    if (unsupportedAxes.length) {
      this._independentFsError = `${store().provider === 'handy' ? 'The Handy' : 'This device'} supports L0 only; ${unsupportedAxes.join(', ')} will be skipped`
      useFunscriptPlayerStore.setState({ compatibilityWarning: this._independentFsError })
    } else {
      useFunscriptPlayerStore.setState({ compatibilityWarning: null })
    }
    this._independentFs = state
    this._independentFsTimer = setInterval(
      () => this._tickIndependentFunscript(),
      this._funscriptOutputInterval(),
    )
    this._tickIndependentFunscript()
    return true
  }

  setIndependentFunscriptParams(patch = {}) {
    if (!this._independentFs) return
    const now = this._independentFs.startTime + ((Date.now() - this._independentFs.startedAt) / 1000) * this._independentFs.speed
    Object.assign(this._independentFs, patch)
    if ('speed' in patch) {
      this._independentFs.startTime = now
      this._independentFs.startedAt = Date.now()
    }
    if ('speed' in patch || 'range' in patch || 'intensity' in patch) {
      this._independentFs.lastWallAt = null
      this._independentFs.lastPositions = {}
    }
  }

  _tickIndependentFunscript() {
    const s = this._independentFs
    if (!s || this._funscriptOwner !== 'independent') return
    const wallNow = Date.now()
    const now = s.startTime + ((wallNow - s.startedAt) / 1000) * s.speed
    const region = s.loopRegion
    const end = region?.end > region?.start ? region.end : s.duration
    if (now >= end) {
      if (s.loop) {
        s.startTime = region?.start >= 0 ? region.start : 0
        s.startedAt = wallNow
        s.lastWallAt = null
        s.lastPositions = {}
      } else {
        this._stopIndependentFunscriptClock()
        s.onTime?.(s.duration, s.duration)
        s.onEnd?.()
        return
      }
    }
    const timeSeconds = s.startTime + ((Date.now() - s.startedAt) / 1000) * s.speed
    const interval = this._funscriptOutputInterval()
    const elapsed = s.lastWallAt == null ? interval : clamp(wallNow - s.lastWallAt, 1, 250)
    s.lastWallAt = wallNow
    for (const [axis, actions] of Object.entries(s.axes)) {
      if (s.axisEnabled[axis] === false) continue
      const raw = sampleFunscriptPosition(actions, timeSeconds * 1000)
      if (raw == null) continue
      const min = Number(s.range?.min ?? 0), max = Number(s.range?.max ?? 100)
      const scaled = min + (max - min) * (raw / 100)
      const pos = axis === 'L0' ? 50 + (scaled - 50) * s.intensity : scaled
      const previous = s.lastPositions[axis]
      if (previous != null && Math.abs(pos - previous) < this._funscriptDirtyThreshold()) continue
      this._sendAxis(axis, pos, elapsed)
      s.lastPositions[axis] = pos
    }
    s.onTime?.(Math.min(timeSeconds, s.duration), s.duration)
  }

  pauseIndependentFunscript() {
    const s = this._independentFs
    if (!s) return
    if (this._funscriptOwner === 'independent') {
      s.startTime = Math.min(s.duration, s.startTime + ((Date.now() - s.startedAt) / 1000) * s.speed)
      this._stopIndependentFunscriptClock()
      s.lastWallAt = null
      s.paused = true
      this._stopScalarActuators()
      s.onPause?.()
    }
  }

  // Independent player time is seconds end-to-end. Action timestamps remain
  // funscript-standard milliseconds, so conversion happens only at the action
  // comparison boundary above.
  seekIndependentFunscript(timeSeconds) {
    if (!this._independentFs) return
    const wasPlaying = !!this._independentFsTimer
    this._independentFs.startTime = Math.max(0, Math.min(this._independentFs.duration, Number(timeSeconds) || 0))
    this._independentFs.startedAt = Date.now()
    this._independentFs.lastWallAt = null
    this._independentFs.lastPositions = {}
    if (wasPlaying && !this._independentFsTimer && this._funscriptOwner === 'independent') {
      this._independentFsTimer = setInterval(
        () => this._tickIndependentFunscript(),
        this._funscriptOutputInterval(),
      )
      this._tickIndependentFunscript()
    }
  }

  _stopIndependentFunscriptClock() {
    clearInterval(this._independentFsTimer)
    this._independentFsTimer = null
    if (this._independentFs) this._independentFs.lastWallAt = null
  }

  stopIndependentFunscript({ clear = false } = {}) {
    this._stopIndependentFunscriptClock()
    if (this._funscriptOwner === 'independent') {
      this._stopScalarActuators()
      this._funscriptOwner = null
      useDeviceStore.setState({ mode: 'off', previousMode: 'off' })
    }
    if (clear) this._independentFs = null
  }

  // ── Finisher ──────────────────────────────────────────────────────────────
  // Instantly override whatever the device is doing (a running funscript,
  // freestyle, ramp…) and loop a chosen saved pattern until manually stopped.
  // The "press one key and let it take you home" button. Meant to be fired only
  // while a funscript is loaded, but works whenever the device is connected.

  hasFunscriptLoaded() {
    return !!(this._funscript && this._videoEl)
  }

  isFinisherActive() {
    return this._finisherActive
  }

  startFinisher(patternName) {
    if (store().status !== 'connected') return false
    const name    = patternName || store().finisherPatternName
    const pattern = store().savedPatterns.find(p => p.name === name)
    if (!pattern) return false

    // Remember what to return to once the finisher stops.
    this._finisherPrev   = { mode: store().mode, presetId: store().activePresetId }
    this._finisherActive = true

    // Kill every other driver so nothing fights the finisher. Switching to
    // 'freestyle' also neutralises the funscript re-arm paths (they all guard
    // on mode === 'funscript'), so a still-playing video won't tug back control.
    this._stopFunscriptPlayer()
    this._stopRamp()
    this._stopScheduler()
    clearTimeout(this._cumTimer)

    useDeviceStore.setState({ mode: 'freestyle', activePresetId: `saved_${name}`, finisherActive: true })
    this._startPatternEngine()
    return true
  }

  stopFinisher() {
    if (!this._finisherActive) return
    this._finisherActive = false
    this._stopPatternEngine()

    const prev = this._finisherPrev || { mode: 'off', presetId: 'tease' }
    this._finisherPrev = null
    useDeviceStore.setState({ finisherActive: false, activePresetId: prev.presetId })

    // Return to whatever was running before the finisher, if we still can.
    if (prev.mode === 'funscript' && this._funscript && this._videoEl) {
      this.takeFunscriptControl()
    } else if (prev.mode === 'freestyle') {
      useDeviceStore.setState({ mode: 'freestyle' })
      this._startPatternEngine()
    } else {
      this.stop()   // send device to rest
    }
  }

  // Same key starts and stops. Returns true if it just started.
  toggleFinisher(patternName) {
    if (this._finisherActive) { this.stopFinisher(); return false }
    return this.startFinisher(patternName)
  }

  // ── Cum pattern shortcut ────────────────────────────────────────────────────

  triggerCumPattern(durationSec = 30) {
    const prev = store().activePresetId
    useDeviceStore.setState({ activePresetId: 'cum' })
    clearTimeout(this._cumTimer)
    this._cumTimer = setTimeout(() => {
      useDeviceStore.setState({ activePresetId: prev })
    }, durationSec * 1000)
  }

  // ── Internal: stop everything ───────────────────────────────────────────────

  _stopAll() {
    this._stopPatternEngine()
    this._stopFunscriptPlayer()
    this._stopIndependentFunscriptClock()
    if (this._funscriptOwner === 'independent') this._stopScalarActuators()
    this._funscriptOwner = null
    this._stopRamp()
    this._stopScheduler()
    this._stopEdgeMode()
    // Every driver is dead; make sure nothing is still humming on its own.
    this._stopScalarActuators()
    clearTimeout(this._cumTimer)
    this._finisherActive = false
    this._finisherPrev   = null
    useDeviceStore.setState({ schedulerRunningOnce: false, finisherActive: false })
  }

  // ── The Handy REST API v3 (HSP streaming protocol) ──────────────────────────
  // Reference: https://ohdoki.notion.site/Handy-API-v3-ea6c47749f854fbcabcc40c729ea6df4
  // Unlike v2's fire-and-forget HDSP position commands, v3 wants a buffer of
  // future timestamped points streamed ahead of playback. We keep a target
  // position + speed (set by _sendLinearHandy, same call sites as before —
  // patterns, funscript, ramp, scheduler, Edge Mode) and a 100ms tick timer
  // interpolates toward it, queuing points that get flushed to hsp/add in
  // small batches once enough have built up.
  _HANDY_LOOKAHEAD_MS = 900   // points are timestamped this far into the future
  _HANDY_FS_PRIME_MS  = 1000  // script buffered onto the device before video starts
  _HANDY_BATCH_POINTS  = 2    // flush after this many buffered points (~200ms)

  async _handyRequest(method, path, body) {
    const { handyKey } = store()
    const remaining = this._quickConnectionDeadline == null
      ? null
      : Math.max(1, this._quickConnectionDeadline - Date.now())
    const controller = remaining == null ? null : new AbortController()
    const abortTimer = controller ? setTimeout(() => controller.abort(), remaining) : null
    try {
      const resp = await fetch(`${this._HANDY_BASE}${path}`, {
        method,
        headers: {
          'Accept': 'application/json',
          'X-Connection-Key': handyKey,
          'X-Api-Key': HANDY_APP_KEY,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        ...(controller ? { signal: controller.signal } : {}),
      })
      const data = await resp.json().catch(() => ({}))
      const err  = data.error
      if (!resp.ok || err) {
        if (err?.code === 1001 || err?.name === 'DeviceNotConnected') throw new Error('Device not connected — open The Handy app and pair via Bluetooth or WiFi first')
        if (resp.status === 401) throw new Error('Unauthorized — check your Connection Key')
        throw new Error(err?.message || `HTTP ${resp.status}`)
      }
      return data
    } finally {
      if (abortTimer) clearTimeout(abortTimer)
    }
  }

  // Estimates client-server clock skew so buffered point timestamps line up
  // with the device's playback clock. Fewer samples than reference impls
  // (which use 30) — a handful is enough and keeps connect() snappy.
  async _handyServerTimeOffset() {
    const SAMPLES = 6
    let sum = 0
    for (let i = 0; i < SAMPLES; i++) {
      const t0 = Date.now()
      const { server_time } = await this._handyRequest('GET', 'servertime')
      const t1 = Date.now()
      sum += (server_time + (t1 - t0) / 2) - t1
    }
    return Math.round(sum / SAMPLES)
  }

  async connectHandy() {
    const { handyKey, provider } = store()
    if (!handyKey.trim()) {
      useDeviceStore.setState({ status: 'error', errorMsg: 'Connection key is required', provider: null })
      return
    }
    // Mutual exclusion
    if (provider === 'intiface') await this.disconnect()
    if (provider === 'serial')   await this.disconnectSerial()

    useDeviceStore.setState({ status: 'connecting', errorMsg: null, provider: 'handy' })
    try {
      await this._handyRequest('PUT', 'hsp/stop').catch(() => {})
      await this._handyRequest('PUT', 'hsp/flush').catch(() => {})
      this._handyServerOffset = await this._handyServerTimeOffset()
      this._handyStreamId += 1
      await this._handyRequest('PUT', 'hsp/setup', { stream_id: this._handyStreamId })

      this._handyCurrentPos    = 50
      this._handyTargetPos     = 50
      this._handySpeed         = 0
      this._handyBuffer        = []
      this._handyTailIndex     = 0
      this._handyPlaying       = false
      this._handyStreamStartAt = Date.now()

      this._handyTickTimer = setInterval(() => this._handyStreamTick(), 100)

      useDeviceStore.setState({
        status:  'connected',
        devices: [{ name: 'The Handy', index: 0, canLinear: true, canVibrate: false, outputTypes: ['HSP'] }],
      })
      rememberLastDeviceProvider('handy')
      this.startEdgeMode()   // no-op unless Edge Mode was left armed
    } catch (err) {
      useDeviceStore.setState({ status: 'error', errorMsg: err.message, provider: null })
    }
  }

  async disconnectHandy() {
    this._stopAll()
    clearInterval(this._handyTickTimer)
    this._handyTickTimer = null
    try { await this._handyRequest('PUT', 'hsp/stop') } catch (_) {}
    try { await this._handyRequest('PUT', 'hsp/flush') } catch (_) {}
    useDeviceStore.setState({ status: 'disconnected', devices: [], mode: 'off', provider: null })
  }

  // Sets the interpolation target — called from the same sites as before
  // (pattern engine, funscript player, ramp mode, scheduler, Edge Mode).
  // The actual HTTP traffic happens on the tick timer, not here.
  _sendLinearHandy(posPercent, durationMs) {
    const { strokeFloor, strokeCeiling } = store()
    const limited = strokeFloor + (strokeCeiling - strokeFloor) * (posPercent / 100)
    const durSec  = Math.max(0.05, durationMs / 1000)
    this._handySpeed     = (limited - this._handyCurrentPos) / durSec
    this._handyTargetPos = limited
  }

  _handyStreamTick() {
    // While a funscript is streaming, its own feeder owns the buffer. Letting
    // the interpolator push here too would interleave two different timelines
    // into one point stream.
    if (this._handyFsTimer) return

    const dt    = 0.1   // seconds, matches the 100ms tick interval
    const delta = this._handySpeed * dt
    if (this._handySpeed > 0)      this._handyCurrentPos = Math.min(this._handyTargetPos, this._handyCurrentPos + delta)
    else if (this._handySpeed < 0) this._handyCurrentPos = Math.max(this._handyTargetPos, this._handyCurrentPos + delta)

    const t = Math.round(Date.now() - this._handyStreamStartAt) + this._HANDY_LOOKAHEAD_MS
    const x = clamp(Math.round(this._handyCurrentPos), 0, 100)
    this._handyBuffer.push({ t, x })

    if (this._handyBuffer.length >= this._HANDY_BATCH_POINTS) this._handyFlushBuffer()
  }

  // ── Handy funscript streaming ───────────────────────────────────────────────
  //
  // The pattern interpolator samples position every 100ms, which is fine for
  // generated patterns but destroys a funscript. HSP accepts timestamped
  // points, so feed it regular samples of the same MFP-matched PCHIP curve.
  // The 250ms HTTP refill cadence only controls network batching; the device
  // receives 50ms points and interpolates between them on its own clock.
  _startHandyFsFeed() {
    this._stopHandyFsFeed()
    if (store().provider !== 'handy') return
    this._handyFsNextSampleMs = (this._videoEl?.currentTime || 0) * 1000
    this._handyFsFinished = false
    // Drop anything the interpolator already queued so the two timelines can't mix
    this._handyBuffer = []
    this._handyFsTimer = setInterval(() => this._handyFsFeed(), 250)
    this._handyFsFeed()
  }

  _stopHandyFsFeed() {
    clearInterval(this._handyFsTimer)
    this._handyFsTimer = null
    this._handyFsAnchor = null
  }

  // ── Primed start ────────────────────────────────────────────────────────────
  //
  // Loads the opening of the script onto the device BEFORE the video rolls, then
  // starts both together. Without it the first strokes are computed for moments
  // only milliseconds away and can land after their due time — the device drops
  // them, and playback opens out of step. Always on for a Handy following a
  // script; every other case falls straight through to a plain play().
  async primedPlay(videoEl) {
    const canPrime = store().provider === 'handy'
      && store().status === 'connected'
      && store().mode === 'funscript'
      && !!this._funscript
    if (!canPrime) { try { await videoEl.play() } catch (_) {} return false }

    const LEAD = this._HANDY_FS_PRIME_MS
    useDeviceStore.setState({ priming: true })
    try {
      // Fresh device timeline so nothing queued earlier can bleed into this run
      this._handyBuffer  = []
      this._handyPlaying = false
      try { await this._handyRequest('PUT', 'hsp/flush') } catch (_) {}

      // Anchor the script to a moment LEAD ms from now, then fill the buffer
      // while the video is still paused.
      this._stopHandyFsFeed()   // clears the anchor, so set it after
      this._handyFsAnchor = { wall: Date.now() + LEAD, videoMs: videoEl.currentTime * 1000 }
      this._handyFsNextSampleMs = this._handyFsAnchor.videoMs
      this._handyFsFinished = false
      this._handyFsPrimeFeed(videoEl)

      await new Promise(r => setTimeout(r, LEAD))
      try { await videoEl.play() } catch (_) {}
      // Hand back to the normal live feed, now anchored to real playback
      this._handyFsAnchor = null
      this._handyFsTimer  = setInterval(() => this._handyFsFeed(), 250)
    } finally {
      useDeviceStore.setState({ priming: false })
    }
    return true
  }

  // One-shot fill used while the video is still paused, so _handyFsFeed's
  // "is it playing?" guard doesn't reject it.
  _handyFsPrimeFeed(v) {
    const actions = this._getFunscriptAxes().L0
    if (!actions || !actions.length) return
    const offsetMs = store().funscriptOffsetMs || 0
    const rate    = v.playbackRate || 1
    const anchor  = this._handyFsAnchor
    const HORIZON = 1500
    const step    = FUNSCRIPT_INTIFACE_INTERVAL_MS * rate
    const streamNow = anchor.wall - this._handyStreamStartAt
    let queued = 0
    const horizonEnd = anchor.videoMs + HORIZON * rate
    const scriptEnd = actions.at(-1).at + offsetMs
    while (this._handyFsNextSampleMs <= horizonEnd) {
      const at = this._handyFsNextSampleMs
      if (scriptEnd >= anchor.videoMs && scriptEnd <= horizonEnd && at > scriptEnd) {
        const raw = sampleFunscriptPosition(actions, scriptEnd)
        this._handyBuffer.push({
          t: Math.round(streamNow + (scriptEnd - anchor.videoMs) / rate),
          x: this._handyScriptPos(raw),
        })
        this._handyFsNextSampleMs = scriptEnd + step
        this._handyFsFinished = true
        queued++
        break
      }
      const raw = sampleFunscriptPosition(actions, at + offsetMs)
      if (raw == null) break
      this._handyBuffer.push({
        t: Math.round(streamNow + (at - anchor.videoMs) / rate),
        x: this._handyScriptPos(raw),
      })
      this._handyFsNextSampleMs += step
      queued++
      if (scriptEnd >= anchor.videoMs && at >= scriptEnd) {
        this._handyFsFinished = true
        break
      }
    }
    if (queued > 0) this._handyFlushBuffer()
  }

  // Maps a raw script position through the stroke limiter and the Edge Mode
  // gate. Damping is toward the centre of the limited window, so a closed gate
  // parks the device mid-stroke rather than at an arbitrary end of it.
  //
  // Gating amplitude — rather than pausing the stream — is what makes Edge Mode
  // work on a Handy without desyncing: the script keeps streaming in lockstep
  // with the video the whole time, and only the size of the movement changes.
  // A gate of 0 collapses every point to the midpoint, so the device holds
  // still, and release resumes in perfect sync because the timeline was never
  // interrupted.
  _handyScriptPos(rawPos) {
    const { strokeFloor, strokeCeiling } = store()
    const limited = strokeFloor + (strokeCeiling - strokeFloor) * (clamp(rawPos, 0, 100) / 100)
    const gate = this._edgeGate
    if (gate >= 1) return clamp(Math.round(limited), 0, 100)
    const mid = (strokeFloor + strokeCeiling) / 2
    return clamp(Math.round(mid + (limited - mid) * gate), 0, 100)
  }

  // Called when the Edge Mode gate opens or closes during Handy funscript
  // playback. Up to HORIZON ms of points are already sitting on the device at
  // the previous amplitude, so without this the edge would take ~1.5s to bite
  // (and just as long to let go). Drop them and re-queue from the current video
  // position, reusing the same flush-and-restart path as a seek.
  async _handyEdgeHold() {
    if (!this._handyFsTimer) return
    await this._handyFsResync()
    // Restart the sampled queue at the live video position with the new gate.
    this._handyFsNextSampleMs = (this._videoEl?.currentTime || 0) * 1000
    this._handyFsFinished = false
    this._handyFsFeed()
  }

  // Discards queued points on the device and restarts the stream — used on seek,
  // pause and offset changes, where everything already buffered is now wrong.
  async _handyFsResync() {
    if (store().provider !== 'handy') return
    this._handyBuffer = []
    this._handyPlaying = false
    try { await this._handyRequest('PUT', 'hsp/flush') } catch (_) {}
  }

  _handyFsFeed() {
    const v = this._videoEl
    if (!v || v.paused || v.ended) return
    const actions = this._getFunscriptAxes().L0
    if (!actions || !actions.length) return
    if (this._handyFsFinished) return

    const offsetMs = store().funscriptOffsetMs || 0
    const videoNow  = v.currentTime * 1000
    const rate      = v.playbackRate || 1
    const HORIZON   = 1500   // ms of script to stay ahead by
    const step      = FUNSCRIPT_INTIFACE_INTERVAL_MS * rate

    // Anchor ties a video position to a wall-clock instant. Normally that's
    // "now", but priming sets it slightly in the future so the opening strokes
    // are already sitting on the device before the video starts — a point whose
    // timestamp arrives after its due time is simply dropped, which is what
    // makes the first moment of playback unreliable otherwise.
    const anchor = this._handyFsAnchor || { wall: Date.now(), videoMs: videoNow }
    const streamNow = anchor.wall - this._handyStreamStartAt
    let queued = 0
    if (this._handyFsNextSampleMs < videoNow) this._handyFsNextSampleMs = videoNow
    const horizonEnd = videoNow + HORIZON * rate
    const scriptEnd = actions.at(-1).at + offsetMs
    while (this._handyFsNextSampleMs <= horizonEnd) {
      const at = this._handyFsNextSampleMs
      if (scriptEnd >= videoNow && scriptEnd <= horizonEnd && at > scriptEnd) {
        const raw = sampleFunscriptPosition(actions, scriptEnd)
        this._handyBuffer.push({
          t: Math.round(streamNow + (scriptEnd - anchor.videoMs) / rate),
          x: this._handyScriptPos(raw),
        })
        this._handyFsNextSampleMs = scriptEnd + step
        this._handyFsFinished = true
        queued++
        break
      }
      const raw = sampleFunscriptPosition(actions, at + offsetMs)
      if (raw == null) break
      // Video time → stream time, relative to the anchor. Dividing by
      // playbackRate keeps the script aligned at non-1x speeds.
      const t = Math.round(streamNow + (at - anchor.videoMs) / rate)
      this._handyBuffer.push({ t, x: this._handyScriptPos(raw) })
      this._handyFsNextSampleMs += step
      queued++
      if (scriptEnd >= videoNow && at >= scriptEnd) {
        this._handyFsFinished = true
        break
      }
    }

    if (queued > 0) this._handyFlushBuffer()
  }

  async _handyFlushBuffer() {
    if (this._handyBuffer.length === 0 || this._handyFlushInFlight) return
    this._handyFlushInFlight = true
    const points = this._handyBuffer
    this._handyBuffer = []
    const isFirstBatch = !this._handyPlaying

    try {
      this._handyTailIndex += points.length
      const data = await this._handyRequest('PUT', 'hsp/add', {
        points,
        flush: isFirstBatch,
        tail_point_stream_index: this._handyTailIndex,
      })

      if (isFirstBatch) {
        const now = Date.now()
        await this._handyRequest('PUT', 'hsp/play', {
          start_time:    now - this._handyStreamStartAt,
          server_time:   now + this._handyServerOffset,
          playback_rate: 1.0,
          loop: false,
        })
        this._handyPlaying = true
      }

      // The device-side buffer misbehaves near capacity — flush it before that
      // happens. tail_point_stream_index and _handyStreamStartAt are absolute
      // across the session and must NOT be reset; only _handyPlaying resets so
      // the next batch issues a fresh hsp/play call to resume.
      const result = data.result
      if (result && (result.max_points - result.points) < 100) {
        await this._handyRequest('PUT', 'hsp/flush').catch(() => {})
        this._handyPlaying = false
      }

      if (store().errorMsg) useDeviceStore.setState({ errorMsg: null })
    } catch (err) {
      const msg = `Handy stroke failed: ${err.message}`
      console.error(msg, err)
      // Surface the error without tearing down the connection (status stays 'connected')
      if (store().errorMsg !== msg) useDeviceStore.setState({ errorMsg: msg })
    } finally {
      this._handyFlushInFlight = false
      if (this._handyBuffer.length > 0) this._handyFlushBuffer()
    }
  }

  // ── Direct serial — FUNSR1 2.0 (T-code, Web Serial API) ────────────────────

  async connectSerial({ reusePermission = false } = {}) {
    if (!navigator.serial) {
      useDeviceStore.setState({
        status: 'error',
        errorMsg: 'Web Serial API is not available. Use Chrome or Edge.',
        provider: null,
      })
      return
    }
    const { provider } = store()
    // Mutual exclusion
    if (provider === 'intiface') await this.disconnect()
    if (provider === 'handy')    await this.disconnectHandy()

    useDeviceStore.setState({ status: 'connecting', errorMsg: null, provider: 'serial' })
    try {
      let port
      if (reusePermission) {
        const ports = await navigator.serial.getPorts()
        const last = readLastSerialPort()
        port = ports.find(candidate => {
          const info = candidate.getInfo()
          return last && info.usbVendorId === last.usbVendorId && info.usbProductId === last.usbProductId
        }) || ports[0]
        if (!port) throw new Error('No previously authorized serial device found')
      } else {
        port = await navigator.serial.requestPort()
      }
      await port.open({ baudRate: 115200 })
      this._serialPort   = port
      this._serialWriter = port.writable.getWriter()
      const info    = port.getInfo()
      const portStr = info.usbVendorId ? `USB VID ${info.usbVendorId.toString(16).toUpperCase()}` : 'Serial'
      rememberLastSerialPort(info)
      useDeviceStore.setState({
        status:         'connected',
        serialPortInfo: portStr,
        devices: [{ name: 'FUNSR1 2.0 (Serial)', index: 0, canLinear: true, canVibrate: false, canMultiAxis: true, outputTypes: ['T-Code L0/L1/L2/R0/R1/R2'] }],
      })
      rememberLastDeviceProvider('serial')
      this.startEdgeMode()   // no-op unless Edge Mode was left armed
    } catch (err) {
      useDeviceStore.setState({
        status:   'error',
        errorMsg: err.name === 'NotFoundError' ? 'No port selected' : err.message || 'Could not open serial port',
        provider: null,
      })
    }
  }

  async disconnectSerial() {
    this._stopAll()
    if (this._serialWriter) {
      try { await this._serialWriter.releaseLock() } catch (_) {}
      this._serialWriter = null
    }
    if (this._serialPort) {
      try { await this._serialPort.close() } catch (_) {}
      this._serialPort = null
    }
    useDeviceStore.setState({
      status: 'disconnected', devices: [], mode: 'off',
      provider: null, serialPortInfo: null,
    })
  }

  _sendLinearSerial(posPercent, durationMs) {
    // The stroke axis (L0) is what patterns/cum/test drive. Delegate to the
    // generic per-axis sender so all T-Code formatting lives in one place.
    this._sendAxisSerial('L0', posPercent, durationMs)
  }

  // ── Multi-axis output ───────────────────────────────────────────────────────
  // axisId is a T-Code channel: L0 stroke, L1 surge, L2 sway, R0 twist,
  // R1 roll, R2 pitch. Only the serial (T-Code) provider has physical multi-axis
  // hardware — Handy and Intiface devices are single-axis, so non-L0 axes are
  // simply dropped for them rather than faked.
  _sendAxis(axisId, posPercent, durationMs) {
    const { provider } = store()
    if (provider === 'serial') { this._sendAxisSerial(axisId, posPercent, durationMs); return }
    // Handy / Intiface: only the stroke axis maps to real hardware
    if (axisId === 'L0') this._sendLinear(posPercent, durationMs)
  }

  _sendAxisSerial(axisId, posPercent, durationMs) {
    if (!this._serialWriter) return
    let p = posPercent
    // The stroke limiter is a stroke-window constraint — it must apply ONLY to
    // L0. Clamping rotation/secondary axes to the stroke floor/ceiling would
    // distort the authored choreography, so those pass through unmodified.
    if (axisId === 'L0') {
      const { strokeFloor, strokeCeiling } = store()
      p = strokeFloor + (strokeCeiling - strokeFloor) * (posPercent / 100)
    }
    const pos = Math.round(clamp(p / 100, 0, 1) * 9999)
    const dur = Math.max(1, Math.round(durationMs))
    const cmd = `${axisId}${String(pos).padStart(4, '0')}I${dur}\n`
    const encoded = new TextEncoder().encode(cmd)
    this._serialWriter.write(encoded).catch(() => {})
  }
}

export const deviceService = new DeviceService()
// The persistent player store calls into this singleton without importing it
// eagerly, avoiding a service/store cycle while keeping a stable public action.
useFunscriptPlayerStore.getState().attachService(deviceService)

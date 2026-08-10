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
  OutputType,
} from 'buttplug'
import { useDeviceStore, PRESETS } from '../store/deviceStore'

// ── Helpers ───────────────────────────────────────────────────────────────────
const store = () => useDeviceStore.getState()

// App-level Handy Developer API key — registered once at user.handyfeeling.com.
// Not a per-user credential; baked into the app so users never need to enter it.
const HANDY_APP_KEY = '1sWGa-ThX~iSFzdMTz9pUXPE18P9tfZB'

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

function lerpPattern(a, b, t) {
  return {
    strokeMin: Math.round(a.strokeMin + (b.strokeMin - a.strokeMin) * t),
    strokeMax: Math.round(a.strokeMax + (b.strokeMax - a.strokeMax) * t),
    spm:       Math.round(a.spm       + (b.spm       - a.spm)       * t),
    waveform:  t < 0.5 ? a.waveform : b.waveform,
  }
}

// ── Device Service ────────────────────────────────────────────────────────────
class DeviceService {
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
    this._videoEl         = null

    // The Handy REST API v3 (HSP streaming protocol) — gated by firmware v4+,
    // not by hardware generation: an original Handy 1 updated to firmware 4
    // works fine, one still on firmware 3 (Handy 1 or 2) does not.
    this._HANDY_BASE      = 'https://www.handyfeeling.com/api/handy-rest/v3/'
    this._handyCurrentPos = 50   // interpolated position 0-100
    this._handyTargetPos  = 50   // position last requested via _sendLinearHandy
    this._handySpeed      = 0    // units/sec toward _handyTargetPos
    this._handyBuffer      = []  // points queued for the next hsp/add batch
    this._handyTailIndex   = 0   // tailPointStreamIndex — total points sent this stream
    this._handyStreamId    = 0
    this._handyPlaying     = false
    this._handyServerOffset = 0  // client-server clock skew, ms
    this._handyTickTimer   = null
    // Funscript streaming (Handy only) — feeds the script's real points straight
    // into the HSP buffer instead of resampling them through the pattern
    // interpolator, which is what HSP is designed to consume.
    this._handyFsTimer     = null
    this._handyFsIdx       = 0

    // Direct serial (Web Serial API)
    this._serialPort   = null
    this._serialWriter = null
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

      this._client.addListener('deviceadded',   (dev) => this._onDeviceAdded(dev))
      this._client.addListener('deviceremoved', (dev) => this._onDeviceRemoved(dev))
      this._client.addListener('disconnect', () => {
        this._stopAll()
        useDeviceStore.setState({ status: 'disconnected', devices: [], mode: 'off', provider: null })
      })

      const connector = new ButtplugBrowserWebsocketClientConnector(wsUrl)
      await this._client.connect(connector)
      useDeviceStore.setState({ status: 'connected' })
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

    // Extract feature info for raw command construction (bypassing SDK bug).
    // Scalar actuators carry their own step count: Buttplug values are integer
    // steps in the device's own range, NOT a 0–1 fraction.
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

    // ── Intiface / Buttplug path ──────────────────────────────────────────────
    // Bypass the buttplug SDK entirely — it sends Value as an array [n] but
    // Intiface v4 schema requires Value as a plain number. SDK bug confirmed.

    // ── Apply stroke limiter globally ─────────────────────────────────────────
    // strokeFloor / strokeCeiling constrain ALL device movement, regardless of
    // mode (freestyle, funscript, cum, test). posPercent is always 0-100.
    const { strokeFloor, strokeCeiling } = store()
    const limitedPercent = strokeFloor + (strokeCeiling - strokeFloor) * (posPercent / 100)

    const pos = clamp(limitedPercent / 100, 0, 1)
    const dur = Math.max(50, Math.round(durationMs))
    for (const dev of this._getLinearDevices()) {
      const info = this._linearFeatures.get(dev.index)
      if (!info) continue
      const steps = Math.round(info.maxSteps * pos)
      this._rawSend({
        OutputCmd: {
          Id: this._msgId++,
          DeviceIndex: dev.index,
          FeatureIndex: info.featureIndex,
          Command: { HwPositionWithDuration: { Value: steps, Duration: dur } },
        },
      })
    }

    // Drive non-linear actuators: map stroke-limited position → intensity.
    // Devices that also support linear are skipped (they already received a position command).
    this._sendScalarActuator(this._vibrateFeatures,   pos, 'Vibrate')
    this._sendScalarActuator(this._rotateFeatures,    pos, 'Rotate')
    this._sendScalarActuator(this._oscillateFeatures, pos, 'Oscillate')
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

  // ── Test stroke ─────────────────────────────────────────────────────────────

  // Send raw WS message bypassing the SDK (for fallback/debug)
  _rawSend(msg) {
    const ws = this._client?._connector?._ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify([msg]))
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
      try { await this._client.stopAllDevices() } catch (_) {}
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
    const prev = store().mode
    useDeviceStore.setState({ mode: 'funscript', previousMode: prev })
    this._stopPatternEngine()
    this._startFunscriptPlayer()
  }

  releaseFunscriptControl() {
    this._stopFunscriptPlayer()
    store().restorePreviousMode()
    if (store().mode === 'freestyle') this._startPatternEngine()
  }

  unloadFunscript() {
    this._stopFunscriptPlayer()
    this._funscript = null
    this._videoEl   = null
  }

  _startFunscriptPlayer() {
    this._stopFunscriptPlayer()
    if (!this._funscript || !this._videoEl) return
    // The Handy streams the script itself; every other provider gets per-action
    // commands from the scheduler below.
    if (store().provider === 'handy') { this._startHandyFsFeed(); return }
    this._scheduleFunscriptActions()
  }

  _stopFunscriptPlayer() {
    clearTimeout(this._funscriptTimer)
    this._funscriptTimer = null
    for (const t of Object.values(this._funscriptTimers || {})) clearTimeout(t)
    this._funscriptTimers = {}
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
    const f = this._funscript
    if (!f) return {}
    if (f.axes && typeof f.axes === 'object') {
      const out = {}
      for (const [k, v] of Object.entries(f.axes)) {
        if (Array.isArray(v) && v.length) out[k] = v
      }
      if (Object.keys(out).length) return out
    }
    if (Array.isArray(f.actions) && f.actions.length) return { L0: f.actions }
    return {}
  }

  _scheduleFunscriptActions() {
    if (store().mode !== 'funscript' || !this._funscript || !this._videoEl) return
    // Nothing may drive the device unless the video is actually rolling.
    // The scheduler advances on wall-clock timers, so without this it walks the
    // whole script while the video sits paused — the device moves on its own.
    // onVideoPlay() re-arms as soon as playback starts.
    if (this._videoEl.paused || this._videoEl.ended) return
    const axes    = this._getFunscriptAxes()
    const enabled = store().funscriptAxes || {}   // { axisId: false } disables an axis; default = on
    for (const [axisId, actions] of Object.entries(axes)) {
      if (enabled[axisId] === false) continue
      this._scheduleAxis(axisId, actions)
    }
  }

  // Sync offset convention: `funscriptOffsetMs` > 0 means the script is DELAYED
  // relative to the video — an action authored at `action.at` should physically
  // fire at video time `action.at + offsetMs`. Negative offset fires it earlier.
  // We implement this by comparing against an "effective" action time
  // (`action.at + offsetMs`) everywhere we'd otherwise use `action.at` directly,
  // so all downstream duration math (which only cares about deltas between
  // consecutive effective times) is unaffected by the shift.
  _scheduleAxis(axisId, actions) {
    const offsetMs = store().funscriptOffsetMs || 0
    const effAt    = (a) => a.at + offsetMs

    const nowMs   = this._videoEl.currentTime * 1000
    const nextIdx = actions.findIndex(a => effAt(a) > nowMs)
    if (nextIdx < 0) return

    const scheduleNext = (idx) => {
      if (store().mode !== 'funscript' || idx >= actions.length - 1) return
      const curr = actions[idx]
      const next = actions[idx + 1]
      const dur  = effAt(next) - effAt(curr)
      // Pass raw pos (0-100); _sendAxisSerial applies the stroke limiter to L0 only.
      this._sendAxis(axisId, next.pos, dur)
      const delay = effAt(curr) - (this._videoEl.currentTime * 1000)
      this._funscriptTimers[axisId] = setTimeout(() => scheduleNext(idx + 1), Math.max(0, delay + dur))
    }
    scheduleNext(nextIdx)
  }

  // Seek / play / pause all route through _startFunscriptPlayer so the right
  // engine runs for the active provider (Handy streams, everything else
  // schedules per action). _startFunscriptPlayer stops the previous one first.
  onVideoSeek() {
    this._stopFunscriptPlayer()
    if (store().mode === 'funscript') this._startFunscriptPlayer()
  }

  // Update the funscript sync offset (see _scheduleAxis for the sign convention)
  // and re-arm the scheduler immediately so the change takes effect without a seek.
  setFunscriptOffset(ms) {
    useDeviceStore.getState().setFunscriptOffset(ms)
    this.onVideoSeek()
  }

  onVideoPause() {
    // Stop scheduling future commands. A stroker holds its last position, which
    // is the right behaviour on pause — but a vibrator would hold its last
    // intensity and keep buzzing through the pause, so scalar actuators are
    // zeroed. onVideoPlay() re-arms the scheduler and they pick straight back up.
    if (store().mode === 'funscript') this._stopFunscriptPlayer()
    this._stopScalarActuators()
  }

  onVideoPlay() {
    // Resume scheduling from the new current time
    if (store().mode === 'funscript') this._startFunscriptPlayer()
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
    const resp = await fetch(`${this._HANDY_BASE}${path}`, {
      method,
      headers: {
        'Accept': 'application/json',
        'X-Connection-Key': handyKey,
        'X-Api-Key': HANDY_APP_KEY,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await resp.json().catch(() => ({}))
    const err  = data.error
    if (!resp.ok || err) {
      if (err?.code === 1001 || err?.name === 'DeviceNotConnected') throw new Error('Device not connected — open The Handy app and pair via Bluetooth or WiFi first')
      if (resp.status === 401) throw new Error('Unauthorized — check your Connection Key')
      throw new Error(err?.message || `HTTP ${resp.status}`)
    }
    return data
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
  // generated patterns but destroys a funscript: a 60ms stroke becomes a single
  // 100ms step, so the device receives ~10 coarse jumps a second and slams
  // between them. HSP already accepts timestamped points, so feed it the script
  // verbatim and let the device interpolate at the script's real resolution.
  _startHandyFsFeed() {
    this._stopHandyFsFeed()
    if (store().provider !== 'handy') return
    this._handyFsIdx = 0
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
      this._handyFsIdx    = 0
      this._handyFsAnchor = { wall: Date.now() + LEAD, videoMs: videoEl.currentTime * 1000 }
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
    const streamNow = anchor.wall - this._handyStreamStartAt

    while (this._handyFsIdx < actions.length &&
           (actions[this._handyFsIdx].at + offsetMs) <= anchor.videoMs) this._handyFsIdx++

    let queued = 0
    while (this._handyFsIdx < actions.length) {
      const a = actions[this._handyFsIdx]
      const at = a.at + offsetMs
      if (at - anchor.videoMs > HORIZON) break
      this._handyBuffer.push({
        t: Math.round(streamNow + (at - anchor.videoMs) / rate),
        x: this._handyScriptPos(a.pos),
      })
      this._handyFsIdx++
      queued++
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
    // The feed's own skip loop re-advances this to the live video position.
    this._handyFsIdx = 0
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

    const offsetMs = store().funscriptOffsetMs || 0
    const videoNow  = v.currentTime * 1000
    const rate      = v.playbackRate || 1
    const HORIZON   = 1500   // ms of script to stay ahead by

    // Anchor ties a video position to a wall-clock instant. Normally that's
    // "now", but priming sets it slightly in the future so the opening strokes
    // are already sitting on the device before the video starts — a point whose
    // timestamp arrives after its due time is simply dropped, which is what
    // makes the first moment of playback unreliable otherwise.
    const anchor = this._handyFsAnchor || { wall: Date.now(), videoMs: videoNow }
    const streamNow = anchor.wall - this._handyStreamStartAt

    // Skip anything already in the past (also covers seeks backwards/forwards)
    while (this._handyFsIdx < actions.length &&
           (actions[this._handyFsIdx].at + offsetMs) <= anchor.videoMs) {
      this._handyFsIdx++
    }

    let queued = 0
    while (this._handyFsIdx < actions.length) {
      const a  = actions[this._handyFsIdx]
      const at = a.at + offsetMs
      if (at - videoNow > HORIZON) break
      // Video time → stream time, relative to the anchor. Dividing by
      // playbackRate keeps the script aligned at non-1x speeds.
      const t = Math.round(streamNow + (at - anchor.videoMs) / rate)
      this._handyBuffer.push({ t, x: this._handyScriptPos(a.pos) })
      this._handyFsIdx++
      queued++
    }

    if (queued > 0) this._handyFlushBuffer()
  }

  async _handyFlushBuffer() {
    if (this._handyBuffer.length === 0) return
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
    }
  }

  // ── Direct serial — FUNSR1 2.0 (T-code, Web Serial API) ────────────────────

  async connectSerial() {
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
      const port = await navigator.serial.requestPort()
      await port.open({ baudRate: 115200 })
      this._serialPort   = port
      this._serialWriter = port.writable.getWriter()
      const info    = port.getInfo()
      const portStr = info.usbVendorId ? `USB VID ${info.usbVendorId.toString(16).toUpperCase()}` : 'Serial'
      useDeviceStore.setState({
        status:         'connected',
        serialPortInfo: portStr,
        devices: [{ name: 'FUNSR1 2.0 (Serial)', index: 0, canLinear: true, canVibrate: false, canMultiAxis: true, outputTypes: ['T-Code L0/L1/L2/R0/R1/R2'] }],
      })
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
    const dur = Math.max(50, Math.round(durationMs))
    const cmd = `${axisId}${String(pos).padStart(4, '0')}I${dur}\n`
    const encoded = new TextEncoder().encode(cmd)
    this._serialWriter.write(encoded).catch(() => {})
  }
}

export const deviceService = new DeviceService()

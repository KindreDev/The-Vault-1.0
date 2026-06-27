/**
 * Device Service — singleton that owns the Buttplug client (v4 API),
 * pattern engine, funscript player, ramp mode, scheduler, and edging assist.
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
    this._edgingTimer    = null
    this._cumTimer       = null
    this._msgId          = 100   // counter for raw WS message IDs

    // Per-device linear feature info extracted at connect time
    // Map<deviceIndex, { featureIndex, maxSteps }>
    this._linearFeatures = new Map()

    // Per-device vibrate feature indices extracted at connect time
    // Map<deviceIndex, number[]> — array to support multi-actuator devices (e.g. Lovense Gush)
    this._vibrateFeatures = new Map()

    // Funscript
    this._funscript       = null
    this._funscriptTimer  = null          // legacy single-axis timer (kept for safety)
    this._funscriptTimers = {}            // multi-axis: { axisId: timeoutId }
    this._videoEl         = null

    // The Handy REST API v2
    this._HANDY_BASE     = 'https://www.handyfeeling.com/api/handy/v2'
    this._handyCurrentPos = 50   // track position 0-100 for velocity calculation

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
    const isLinear  = dev.hasOutput(OutputType.HwPositionWithDuration) ||
                      dev.hasOutput(OutputType.Position)
    const isVibrate = dev.hasOutput(OutputType.Vibrate)

    // Extract feature info for raw command construction (bypassing SDK bug)
    const outputTypes = []
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
      if (raw.Vibrate !== undefined) {
        const feats = this._vibrateFeatures.get(dev.index) || []
        this._vibrateFeatures.set(dev.index, [...feats, featIdx])
      }
    }

    const prev = store().devices
    useDeviceStore.setState({
      devices: [...prev, {
        name: dev.name,
        index: dev.index,
        canLinear: isLinear,
        canVibrate: isVibrate,
        outputTypes,
      }],
    })
  }

  _onDeviceRemoved(dev) {
    this._linearFeatures.delete(dev.index)
    this._vibrateFeatures.delete(dev.index)
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

    // Drive vibrate-only devices: map stroke-limited position → intensity.
    // Devices that also support linear are skipped (they already received a position command).
    this._sendVibrate(pos)
  }

  // Send a vibration intensity command (0.0–1.0, already stroke-limited) to all
  // vibrate-capable devices that are NOT also linear (pure vibrators like Lovense Gush).
  _sendVibrate(pos) {
    const storeDevs = store().devices
    for (const [devIndex, featIdxList] of this._vibrateFeatures) {
      const d = storeDevs.find(sd => sd.index === devIndex)
      if (d?.canLinear) continue  // linear device already handled
      this._rawSend({
        ScalarCmd: {
          Id: this._msgId++,
          DeviceIndex: devIndex,
          Scalars: featIdxList.map(idx => ({ Index: idx, Scalar: clamp(pos, 0, 1), ActuatorType: 'Vibrate' })),
        },
      })
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
    const hasLinear  = this._getLinearDevices().length > 0
    const hasVibrate = this._vibrateFeatures.size > 0
    if (!hasLinear && !hasVibrate) {
      throw new Error(`No compatible devices detected. Connected: ${this._describeDevices()}`)
    }
    // _sendLinear routes to both linear and vibrate-only devices in one call
    const dur = 700
    this._sendLinear(100, dur)
    await new Promise(r => setTimeout(r, dur + 100))
    this._sendLinear(0, dur)
  }

  // ── Emergency stop ──────────────────────────────────────────────────────────

  async stop() {
    this._stopAll()
    const { provider } = store()
    if (provider === 'intiface' && this._client) {
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
    if (store().edgingEnabled)    this._startEdging()
  }

  stopFreestyle() {
    this._stopPatternEngine()
    this._stopRamp()
    this._stopScheduler()
    this._stopEdging()
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
    const halfDur  = Math.round(60000 / pattern.spm / 2)
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
    this._stopEdging()
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

  // ── Edging assist ─────────────────────────────────────────────────────────

  _startEdging() {
    this._stopEdging()
    this._scheduleEdgingDrop()
  }

  _stopEdging() {
    clearTimeout(this._edgingTimer)
    this._edgingTimer = null
  }

  _scheduleEdgingDrop() {
    const peakPresetId = store().activePresetId  // capture peak preset before the drop
    this._edgingTimer = setTimeout(() => {
      useDeviceStore.setState({ activePresetId: store().edgingDropPreset })
      this._edgingTimer = setTimeout(() => {
        useDeviceStore.setState({ activePresetId: peakPresetId })  // restore peak
        this._scheduleEdgingDrop()  // re-arm (captures the restored peak)
      }, store().edgingBuildBackSeconds * 1000)
    }, store().edgingPeakSeconds * 1000)
  }

  // ── Funscript mode ──────────────────────────────────────────────────────────

  loadFunscript(funscriptData, videoEl) {
    this._funscript = funscriptData
    this._videoEl   = videoEl
    if (store().mode === 'funscript') this._startFunscriptPlayer()
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
    this._scheduleFunscriptActions()
  }

  _stopFunscriptPlayer() {
    clearTimeout(this._funscriptTimer)
    this._funscriptTimer = null
    for (const t of Object.values(this._funscriptTimers || {})) clearTimeout(t)
    this._funscriptTimers = {}
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
    const axes    = this._getFunscriptAxes()
    const enabled = store().funscriptAxes || {}   // { axisId: false } disables an axis; default = on
    for (const [axisId, actions] of Object.entries(axes)) {
      if (enabled[axisId] === false) continue
      this._scheduleAxis(axisId, actions)
    }
  }

  _scheduleAxis(axisId, actions) {
    const nowMs   = this._videoEl.currentTime * 1000
    const nextIdx = actions.findIndex(a => a.at > nowMs)
    if (nextIdx < 0) return

    const scheduleNext = (idx) => {
      if (store().mode !== 'funscript' || idx >= actions.length - 1) return
      const curr = actions[idx]
      const next = actions[idx + 1]
      const dur  = next.at - curr.at
      // Pass raw pos (0-100); _sendAxisSerial applies the stroke limiter to L0 only.
      this._sendAxis(axisId, next.pos, dur)
      const delay = curr.at - (this._videoEl.currentTime * 1000)
      this._funscriptTimers[axisId] = setTimeout(() => scheduleNext(idx + 1), Math.max(0, delay + dur))
    }
    scheduleNext(nextIdx)
  }

  onVideoSeek() {
    this._stopFunscriptPlayer()
    if (store().mode === 'funscript') this._scheduleFunscriptActions()
  }

  onVideoPause() {
    // Stop scheduling future commands — device stays at last position silently
    if (store().mode === 'funscript') this._stopFunscriptPlayer()
  }

  onVideoPlay() {
    // Resume scheduling from the new current time
    if (store().mode === 'funscript') this._scheduleFunscriptActions()
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
    this._stopEdging()
    clearTimeout(this._cumTimer)
    useDeviceStore.setState({ schedulerRunningOnce: false })
  }

  // ── The Handy REST API v2 ───────────────────────────────────────────────────

  async _handyRequest(method, path, body) {
    const { handyKey } = store()
    const resp = await fetch(`${this._HANDY_BASE}${path}`, {
      method,
      headers: {
        'X-Connection-Key': handyKey,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      throw new Error(err.error?.message || `HTTP ${resp.status}`)
    }
    return resp.json()
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
      const result = await this._handyRequest('GET', '/connected')
      if (!result.connected) throw new Error('Device not connected — open The Handy app and pair via Bluetooth or WiFi first')
      // Set HDSP mode (mode 2) for real-time position control
      await this._handyRequest('PUT', '/mode', { mode: 2 })
      this._handyCurrentPos = 50
      useDeviceStore.setState({
        status:  'connected',
        devices: [{ name: 'The Handy', index: 0, canLinear: true, canVibrate: false, outputTypes: ['HDSP'] }],
      })
    } catch (err) {
      useDeviceStore.setState({ status: 'error', errorMsg: err.message, provider: null })
    }
  }

  async disconnectHandy() {
    this._stopAll()
    try { await this._handyRequest('PUT', '/hamp/stop') } catch (_) {}
    useDeviceStore.setState({ status: 'disconnected', devices: [], mode: 'off', provider: null })
  }

  _sendLinearHandy(posPercent, durationMs) {
    const { strokeFloor, strokeCeiling } = store()
    const limited = strokeFloor + (strokeCeiling - strokeFloor) * (posPercent / 100)
    const newPos   = clamp(limited / 100, 0, 1)
    const oldPos   = this._handyCurrentPos / 100
    const SLIDE_MM = 110
    const distMm   = Math.abs(newPos - oldPos) * SLIDE_MM
    const durSec   = Math.max(0.05, durationMs / 1000)
    const velocity = clamp(Math.round(distMm / durSec), 10, 400)
    this._handyCurrentPos = limited
    this._handyRequest('PUT', '/hdsp/nextXAVa', { xa: newPos, va: velocity, stopOnTarget: true })
      .then(() => {
        if (store().errorMsg) useDeviceStore.setState({ errorMsg: null })
      })
      .catch(err => {
        const msg = `Handy stroke failed: ${err.message}`
        console.error(msg, err)
        // Surface the error without tearing down the connection (status stays 'connected')
        if (store().errorMsg !== msg) useDeviceStore.setState({ errorMsg: msg })
      })
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

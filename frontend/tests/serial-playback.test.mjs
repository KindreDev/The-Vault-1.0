import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

async function fixture() {
  const state = { status: 'connected', provider: 'serial', mode: 'off', strokeFloor: 10, strokeCeiling: 90,
    funscriptAxes: {}, funscriptOffsetMs: 50, devices: [], restorePreviousMode() {} }
  const player = {}
  const timers = new Map()
  let nextTimer = 0
  const store = { getState: () => state, setState: patch => Object.assign(state, patch), subscribe: () => () => {} }
  const playerStore = { getState: () => ({ attachService() {} }), setState: patch => Object.assign(player, patch) }
  const context = vm.createContext({ console, Date, Math, Map, Set, Promise, TextEncoder, performance,
    queueMicrotask, navigator: {}, window: { localStorage: { getItem() { return null }, setItem() {} } },
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer }, clearTimeout: id => timers.delete(id),
    setInterval: fn => { timers.set(++nextTimer, fn); return nextTimer }, clearInterval: id => timers.delete(id) })
  const source = await readFile(new URL('../src/services/device.js', import.meta.url), 'utf8')
  const module = new vm.SourceTextModule(source, { context })
  await module.link(specifier => {
    const exports = specifier.includes('deviceStore') ? { useDeviceStore: store, PRESETS: [] }
      : specifier.includes('funscriptPlayerStore') ? { useFunscriptPlayerStore: playerStore }
        : specifier.includes('nativeSerial') ? { NativeSerial: class {}, hasNativeSerialBridge: () => false, chooseNativeSerialPort() {} }
          : { ButtplugClient: class {}, ButtplugBrowserWebsocketClientConnector: class {}, DeviceOutput: {}, OutputType: {} }
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
    }, { context })
  })
  await module.evaluate()
  return { state, player, timers, service: new module.namespace.DeviceService() }
}

function native(service) {
  const calls = []
  service._nativeSerial = {
    start: payload => calls.push(['start', payload]), update: patch => calls.push(['update', patch]),
    stop: () => { calls.push(['stop']); return Promise.resolve() }, move: (...args) => calls.push(['move', ...args]),
  }
  return calls
}

test('desktop independent script hands full track to native output without JS motion timer', async () => {
  const { service, timers } = await fixture()
  const calls = native(service)
  const payload = { actions: [{ at: 0, pos: 0 }, { at: 1000, pos: 100 }] }
  assert.equal(service.startIndependentFunscript(payload, { intensity: 0, range: { min: 20, max: 80 } }), true)
  assert.equal(timers.size, 0)
  const start = calls.find(call => call[0] === 'start')[1]
  assert.equal(start.owner, 'independent')
  assert.equal(start.axes.L0.length, 2)
  assert.equal(start.intensity, 0)
  assert.equal(start.offsetMs, 0)
  assert.equal(start.strokeFloor, 10)
  service.seekIndependentFunscript(.5)
  assert.equal(calls.at(-1)[1].startTime, .5)
  service.pauseIndependentFunscript()
  assert.equal(calls.at(-1)[0], 'stop')
  assert.equal(service._nativeSerialPlaying, false)
})

test('native VLC sync supplies session rather than pumping positions from UI', async () => {
  const { service, state, timers } = await fixture()
  const calls = native(service)
  state.mode = 'funscript'
  service._funscriptOwner = 'video'
  service._funscript = { actions: [{ at: 0, pos: 0 }, { at: 1000, pos: 100 }] }
  service._videoEl = { session: 'video-test', currentTime: .2, playbackRate: 2, paused: false, ended: false }
  service._startFunscriptPlayer()
  const start = calls.find(call => call[0] === 'start')[1]
  assert.equal(start.mediaSession, 'video-test')
  assert.equal(start.speed, 2)
  assert.equal(start.offsetMs, 50)
  assert.equal(timers.size, 0)
  service.onVideoPause()
  assert.equal(calls.at(-1)[0], 'stop')
})

test('Stop cancels native output without parking or disconnecting', async () => {
  const { service, state } = await fixture()
  const calls = native(service)
  await service.stop()
  assert.equal(state.mode, 'off')
  assert.equal(state.status, 'connected')
  assert.ok(calls.some(call => call[0] === 'stop'))
  assert.ok(!calls.some(call => call[0] === 'move'))
})

test('browser serial fallback groups axes and retains only newest pending points', async () => {
  const { service } = await fixture()
  const sent = []
  let finish
  service._serialWriter = { write: data => { sent.push(new TextDecoder().decode(data)); return new Promise(resolve => { finish = resolve }) } }
  service._sendAxisSerial('L0', 0, 10)
  service._sendAxisSerial('R0', 100, 10)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sent.length, 1)
  assert.ok(sent[0].includes('L01000') && sent[0].includes(' R09999'))
  service._sendAxisSerial('L0', 20, 10)
  service._sendAxisSerial('L0', 80, 10)
  finish()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sent.length, 2)
  assert.ok(sent[1].includes('L07399'))
  finish()
})

test('native output errors stop the player and remain visible', async () => {
  const { service, state, player } = await fixture()
  native(service)
  service._serialOutputFailed(new Error('USB removed'))
  assert.equal(state.status, 'error')
  assert.equal(state.errorMsg, 'USB removed')
  assert.equal(player.playing, false)
})

test('native Stop bypasses a slow pending load and invalidates its generation', async () => {
  const calls = []
  let finishLoad
  const context = vm.createContext({ console, Promise, setInterval, clearInterval, window: { pywebview: { api: {
    serial_start: payload => { calls.push(['start', payload.generation]); return new Promise(resolve => { finishLoad = resolve }) },
    serial_stop: generation => { calls.push(['stop', generation]); return Promise.resolve() },
  } } } })
  const module = new vm.SourceTextModule(await readFile(new URL('../src/services/nativeSerial.js', import.meta.url), 'utf8'), { context })
  await module.link(() => {})
  await module.evaluate()
  const controller = new module.namespace.NativeSerial(() => {}, error => { throw error })
  controller.start({ axes: {} })
  await new Promise(resolve => setImmediate(resolve))
  await controller.stop()
  assert.deepEqual(calls, [['start', 1], ['stop', 2]])
  finishLoad()
  await controller.queue
})

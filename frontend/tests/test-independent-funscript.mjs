// Focused contract test for the independent player store. This deliberately
// uses a fake device service: the clock/output integration is covered by the
// service's unit boundary without opening a browser, websocket, or video.
globalThis.localStorage = {
  _data: new Map(),
  getItem(key) { return this._data.has(key) ? this._data.get(key) : null },
  setItem(key, value) { this._data.set(key, String(value)) },
  removeItem(key) { this._data.delete(key) },
}

const { useFunscriptPlayerStore } = await import('../src/store/funscriptPlayerStore.js')
const { firstActionAtOrAfter } = await import('../src/services/device.js')

const calls = []
const fakeService = {
  status: 'connected',
  getIndependentFunscriptDuration: () => 4,
  startIndependentFunscript(payload, options) {
    calls.push({ type: 'start', payload, options })
    this.options = options
    return true
  },
  pauseIndependentFunscript() { calls.push({ type: 'pause' }) },
  seekIndependentFunscript(seconds) { calls.push({ type: 'seek', seconds }) },
  stop() { calls.push({ type: 'stop' }) },
  setIndependentFunscriptParams(patch) { calls.push({ type: 'params', patch }) },
}

const payload = {
  duration: 4,
  axes: { L0: [{ at: 0, pos: 20 }, { at: 4000, pos: 80 }] },
}
const store = useFunscriptPlayerStore
store.setState({
  current: null, payload: null, queue: [], currentIndex: -1,
  currentTime: 0, duration: 0, playing: false, status: 'idle', error: null,
  compatibilityWarning: null, expanded: null,
})
store.getState().attachService(fakeService)

await store.getState().loadAndPlay({ id: 'fixture-1', title: 'Clock fixture', payload })
const afterLoad = store.getState()
if (afterLoad.status !== 'playing' || afterLoad.currentTime !== 0) throw new Error('loadAndPlay did not enter playing state in seconds')
if (calls[0]?.type !== 'start' || calls[0].options.startTime !== 0) throw new Error('start boundary did not use seconds')
if ('video' in calls[0].options || 'videoEl' in calls[0].options) throw new Error('independent player acquired video ownership')

calls[0].options.onTime(1.5, 4)
if (store.getState().currentTime !== 1.5) throw new Error('clock callback was not stored as seconds')

store.getState().seek(2.25)
if (calls.at(-1)?.type !== 'seek' || calls.at(-1).seconds !== 2.25) throw new Error('seek crossed an ms boundary')

store.getState().pause()
if (calls.at(-1)?.type !== 'pause' || store.getState().status !== 'paused') throw new Error('pause contract failed')

store.getState().stopOutput()
if (calls.at(-1)?.type !== 'stop') throw new Error('Stop output did not reach the service')
if (store.getState().status !== 'paused') throw new Error('Stop should preserve the loaded script')
if (fakeService.status !== 'connected') throw new Error('Stop disconnected the device')

const authored = [{ at: 0, pos: 10 }, { at: 4000, pos: 90 }]
if (firstActionAtOrAfter(authored, 2250) !== 1) throw new Error('forward seek replayed the previous action')
if (firstActionAtOrAfter(authored, 5000) !== authored.length) throw new Error('seek beyond final action replayed the track')

console.log('independent funscript contract: PASS')

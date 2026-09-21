import { create } from 'zustand'

let funscriptsApiPromise = null
function getFunscriptsApi() {
  // Keep the store importable in focused clock tests and in non-browser
  // surfaces; the actual request still goes through the shared API adapter.
  funscriptsApiPromise ||= import('../lib/api.js').then(module => module.funscriptsApi)
  return funscriptsApiPromise
}

// The independent player deliberately owns a queue of scripts, not media.
// Payloads are kept in memory because a funscript can be large; the small
// queue descriptors are enough to rehydrate the UI after a page navigation.
const QUEUE_KEY = 'vault_funscript_player_queue'

function readQueue() {
  try {
    const raw = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch { return [] }
}

function writeQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.map(({ payload, ...script }) => script)))
  } catch (_) {}
}

function scriptKey(script) {
  return String(script?.id ?? script?.funscript_id ?? script?.path ?? script?.funscript_path ?? script?.name ?? Math.random())
}

function normalizeScript(script, payload = null) {
  const item = { ...(script || {}) }
  item.id = scriptKey(item)
  item.title = item.title || item.name || item.filename || 'Untitled funscript'
  if (payload) item.payload = payload
  return item
}

export const useFunscriptPlayerStore = create((set, get) => ({
  current: null,
  payload: null,
  queue: readQueue(),
  currentIndex: -1,
  playing: false,
  loading: false,
  error: null,
  compatibilityWarning: null,
  status: 'idle', // idle | loading | ready | playing | paused | ended | error
  currentTime: 0,
  duration: 0,
  loop: false,
  loopRegion: null,
  shuffle: false,
  speed: 1,
  range: { min: 0, max: 100 },
  intensity: 1,
  axisEnabled: {},
  // null means use the route default (expanded on Playlists, compact elsewhere)
  // until the user explicitly toggles the dock.
  expanded: null,
  dockHidden: false,
  dockEdge: 'right',
  dockOffset: 50,

  setExpanded: (expanded) => set({ expanded: !!expanded }),
  setDockHidden: (dockHidden) => set({ dockHidden: !!dockHidden }),
  setDockPosition: (dockEdge, dockOffset = 50) => set({
    dockEdge: ['top', 'right', 'bottom', 'left'].includes(dockEdge) ? dockEdge : 'right',
    dockOffset: Math.max(8, Math.min(92, Number(dockOffset) || 50)),
  }),
  setError: (error) => set({ error: error ? String(error) : null, status: error ? 'error' : get().status }),

  enqueue: (script, payload = null) => {
    const item = normalizeScript(script, payload)
    const currentQueue = get().queue
    const existing = currentQueue.findIndex(s => s.id === item.id)
    const queue = existing >= 0
      ? currentQueue.map((s, i) => i === existing ? { ...s, ...item } : s)
      : [...currentQueue, item]
    writeQueue(queue)
    set({ queue })
    return item
  },

  removeFromQueue: (id) => {
    const previous = get().queue
    const removedIndex = previous.findIndex(s => s.id === id)
    const queue = previous.filter(s => s.id !== id)
    const oldIndex = get().currentIndex
    const currentIndex = removedIndex >= 0 && removedIndex < oldIndex
      ? oldIndex - 1
      : Math.min(oldIndex, queue.length - 1)
    writeQueue(queue)
    set({ queue, currentIndex })
  },
  moveInQueue: (from, to) => {
    const queue = [...get().queue]
    if (from < 0 || to < 0 || from >= queue.length || to >= queue.length || from === to) return
    const [item] = queue.splice(from, 1)
    queue.splice(to, 0, item)
    const current = get().currentIndex
    let currentIndex = current
    if (current === from) currentIndex = to
    else if (from < current && to >= current) currentIndex = current - 1
    else if (from > current && to <= current) currentIndex = current + 1
    writeQueue(queue)
    set({ queue, currentIndex })
  },
  clearQueue: () => { writeQueue([]); set({ queue: [], currentIndex: -1 }) },
  setQueue: (queue) => {
    const normalized = (queue || []).map(s => normalizeScript(s))
    writeQueue(normalized)
    set({ queue: normalized, currentIndex: normalized.length ? 0 : -1 })
  },
  setCurrentIndex: (currentIndex) => set({ currentIndex }),

  setCurrentTime: (currentTime) => set({ currentTime: Math.max(0, Number(currentTime) || 0) }),
  setDuration: (duration) => set({ duration: Math.max(0, Number(duration) || 0) }),
  setLoop: (loop) => {
    set({ loop: !!loop })
    try { get()._service?.setIndependentFunscriptParams({ loop: !!loop }) } catch (_) {}
  },
  setLoopRegion: (loopRegion) => {
    set({ loopRegion: loopRegion || null })
    try { get()._service?.setIndependentFunscriptParams({ loopRegion: loopRegion || null }) } catch (_) {}
  },
  setShuffle: (shuffle) => set({ shuffle: !!shuffle }),
  setSpeed: (speed) => {
    const v = Math.max(0.25, Math.min(3, Number(speed) || 1))
    set({ speed: v })
    try { get()._service?.setIndependentFunscriptParams({ speed: v }) } catch (_) {}
  },
  setRange: (range) => {
    const min = Math.max(0, Math.min(100, Number(range?.min ?? get().range.min)))
    const max = Math.max(min, Math.min(100, Number(range?.max ?? get().range.max)))
    set({ range: { min, max } })
    try { get()._service?.setIndependentFunscriptParams({ range: { min, max } }) } catch (_) {}
  },
  setIntensity: (intensity) => {
    const v = Math.max(0, Math.min(2, Number(intensity) || 1))
    set({ intensity: v })
    try { get()._service?.setIndependentFunscriptParams({ intensity: v }) } catch (_) {}
  },
  setAxisEnabled: (axis, enabled) => {
    const axisEnabled = { ...get().axisEnabled, [axis]: !!enabled }
    set({ axisEnabled })
    try { get()._service?.setIndependentFunscriptParams({ axisEnabled }) } catch (_) {}
  },

  // Called by Funscripts and collection surfaces. payloadLoader may return a
  // payload object or a Response-like promise; URL loading stays here so page
  // components do not grow their own API calls.
  loadAndPlay: async (script, payloadLoader = null) => {
    const item = normalizeScript(script)
    set({ loading: true, error: null, status: 'loading' })
    try {
      let payload = item.payload || script?.payload || null
      if (!payload && payloadLoader) payload = await payloadLoader(item)
      if (!payload && (item.payload_url || item.payloadUrl)) {
        const api = await getFunscriptsApi()
        const response = await api.payloadUrl(item.payload_url || item.payloadUrl)
        payload = response.data
      }
      if (!payload && item.id && /^\d+$/.test(String(item.id))) {
        const api = await getFunscriptsApi()
        const response = await api.payload(item.id)
        payload = response.data
      }
      if (!payload) throw new Error('This funscript has no playable payload')
      const queue = get().enqueue(item, payload)
      const currentIndex = get().queue.findIndex(s => s.id === queue.id)
      const service = get()._service
      if (!service) throw new Error('Funscript device service is unavailable')
      const duration = Number(payload.duration || item.duration || 0) || service.getIndependentFunscriptDuration(payload)
      set({ current: { ...queue, payload: undefined }, payload, currentIndex, duration, currentTime: 0, loading: false, playing: true, status: 'playing', compatibilityWarning: null })
      const started = service.startIndependentFunscript(payload, {
        startTime: 0,
        speed: get().speed,
        range: get().range,
        intensity: get().intensity,
        axisEnabled: get().axisEnabled,
        loop: get().loop,
        onTime: (time, total) => set({ currentTime: time, duration: total || get().duration }),
        onPause: () => set({ playing: false, status: 'paused' }),
        onEnd: () => set({ playing: false, status: 'ended', currentTime: get().duration }),
        onError: (error) => set({ playing: false, status: 'error', error: String(error) }),
      })
      if (!started) throw new Error(service.getIndependentFunscriptError?.() || 'Device is not connected')
      // Last-played is intentionally recorded only after the device clock has
      // successfully claimed ownership. A failure here must never interrupt
      // playback or turn the script into a media-player concern.
      if (/^\d+$/.test(String(item.id))) getFunscriptsApi().then(api => api.markPlayed(item.id)).catch(() => {})
      return queue
    } catch (error) {
      set({ loading: false, playing: false, status: 'error', error: error?.message || String(error) })
      return null
    }
  },

  playScript: async (script) => get().loadAndPlay(script, async item => item.payload),
  play: () => {
    const s = get()
    if (!s.payload || !s._service) return false
    const ok = s._service.startIndependentFunscript(s.payload, {
      startTime: s.currentTime, speed: s.speed, range: s.range, intensity: s.intensity,
      axisEnabled: s.axisEnabled, loop: s.loop,
      onTime: (time, total) => set({ currentTime: time, duration: total || get().duration }),
      onPause: () => set({ playing: false, status: 'paused' }),
      onEnd: () => set({ playing: false, status: 'ended' }),
      onError: (error) => set({ playing: false, status: 'error', error: String(error) }),
    })
    if (ok) set({ playing: true, status: 'playing' })
    return ok
  },
  pause: () => {
    get()._service?.pauseIndependentFunscript()
    set({ playing: false, status: 'paused' })
  },
  stopOutput: () => {
    get()._service?.stop()
    set({ playing: false, status: get().payload ? 'paused' : 'idle' })
  },
  seek: (seconds) => {
    const next = Math.max(0, Math.min(get().duration || Infinity, Number(seconds) || 0))
    set({ currentTime: next })
    get()._service?.seekIndependentFunscript(next)
  },
  next: async () => {
    const s = get(); if (!s.queue.length) return null
    let idx = s.currentIndex
    if (s.shuffle) idx = Math.floor(Math.random() * s.queue.length)
    else idx = (idx + 1) % s.queue.length
    return get().loadAndPlay(s.queue[idx])
  },
  previous: async () => {
    const s = get(); if (!s.queue.length) return null
    const idx = (s.currentIndex - 1 + s.queue.length) % s.queue.length
    return get().loadAndPlay(s.queue[idx])
  },

  // Internal service injection avoids an import cycle and makes the store easy
  // to exercise with a fake scheduler in focused tests.
  _service: null,
  attachService: (service) => set({ _service: service }),
}))

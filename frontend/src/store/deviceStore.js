import { create } from 'zustand'

// ── Pattern presets ───────────────────────────────────────────────────────────
export const PRESETS = [
  { id: 'tease', name: 'Tease',  strokeMin: 40, strokeMax: 80,  spm: 15, waveform: 'sine',   desc: 'Slow & gentle' },
  { id: 'edge',  name: 'Edge',   strokeMin: 60, strokeMax: 100, spm: 25, waveform: 'sine',   desc: 'Glans focus, moderate' },
  { id: 'build', name: 'Build',  strokeMin: 20, strokeMax: 100, spm: 35, waveform: 'sine',   desc: 'Full range, escalating' },
  { id: 'pound', name: 'Pound',  strokeMin: 0,  strokeMax: 100, spm: 50, waveform: 'linear', desc: 'Full length, intense' },
  { id: 'cum',   name: 'Cum',    strokeMin: 70, strokeMax: 100, spm: 65, waveform: 'linear', desc: 'Glans blast — finish' },
]

export const DEFAULT_CUSTOM = { strokeMin: 20, strokeMax: 100, spm: 30, waveform: 'sine' }

// ── Read persisted values synchronously before the store is created ───────────
function _readPatterns() {
  try { return JSON.parse(localStorage.getItem('vault_saved_patterns') || '[]') }
  catch { return [] }
}
function _readCustomPattern() {
  try {
    const s = localStorage.getItem('vault_custom_pattern')
    return s ? { ...DEFAULT_CUSTOM, ...JSON.parse(s) } : { ...DEFAULT_CUSTOM }
  } catch { return { ...DEFAULT_CUSTOM } }
}

// ── Store ─────────────────────────────────────────────────────────────────────
export const useDeviceStore = create((set, get) => ({

  // ── Connection ──────────────────────────────────────────────────────────────
  status:    'disconnected',   // 'disconnected' | 'connecting' | 'connected' | 'error'
  provider:  null,             // null | 'intiface' | 'handy' | 'serial' — active provider
  wsUrl:     localStorage.getItem('vault_device_url') || 'ws://localhost:12345',
  errorMsg:  null,
  devices:   [],               // [{ name, index, canLinear, canVibrate }]

  // The Handy REST API
  handyKey:  localStorage.getItem('vault_handy_key') || '',
  setHandyKey: (k) => { localStorage.setItem('vault_handy_key', k); set({ handyKey: k }) },

  // Direct serial
  serialPortInfo: null,        // display string for connected port

  setStatus:  (status, errorMsg = null) => set({ status, errorMsg }),
  setDevices: (devices) => set({ devices }),
  setWsUrl:   (wsUrl) => {
    localStorage.setItem('vault_device_url', wsUrl)
    set({ wsUrl })
  },

  // ── Mode ────────────────────────────────────────────────────────────────────
  // 'off' | 'freestyle' | 'funscript'
  mode:         'off',
  previousMode: 'off',   // used to restore freestyle after funscript ends

  setMode: (mode) => {
    const prev = get().mode
    set({ mode, previousMode: prev === mode ? get().previousMode : prev })
  },
  // Called when a funscripted video is closed — restores freestyle if it was active before
  restorePreviousMode: () => {
    const prev = get().previousMode
    if (prev === 'freestyle') set({ mode: 'freestyle', previousMode: 'off' })
    else set({ mode: 'off' })
  },

  // ── Pattern ─────────────────────────────────────────────────────────────────
  activePresetId: 'tease',        // preset id or 'custom'
  customPattern:  _readCustomPattern(),
  intensity:      1.0,            // 0.1–2.0 speed multiplier
  glansShift:     0.0,            // 0.0–1.0 — shifts stroke window upward

  setActivePreset: (id) => set({ activePresetId: id }),
  setCustomPattern: (patch) => {
    const next = { ...get().customPattern, ...patch }
    try { localStorage.setItem('vault_custom_pattern', JSON.stringify(next)) } catch {}
    set({ customPattern: next })
  },
  variance:        0,              // 0–100: stroke landing randomness within range
  setVariance:     (v) => set({ variance: Math.max(0, Math.min(100, v)) }),

  setIntensity:    (v) => set({ intensity: Math.max(0.1, Math.min(5.0, v)) }),
  setGlansShift:   (v) => set({ glansShift: Math.max(0, Math.min(1, v)) }),

  // Returns the active pattern object with glans shift and intensity applied
  getEffectivePattern: () => {
    const s = get()
    let base
    if (s.activePresetId === 'custom') {
      base = s.customPattern
    } else {
      base = PRESETS.find(p => p.id === s.activePresetId)
      if (!base && s.activePresetId?.startsWith('saved_')) {
        const name = s.activePresetId.slice(6)
        base = s.savedPatterns.find(p => p.name === name)
      }
      base = base || PRESETS[0]
    }

    // Glans shift: slide the stroke window upward
    const range  = base.strokeMax - base.strokeMin
    const maxShift = 100 - base.strokeMax
    const shift  = s.glansShift * maxShift
    const strokeMin = Math.round(base.strokeMin + shift)
    const strokeMax = Math.round(base.strokeMax + shift)

    // Intensity scales speed
    const spm = Math.max(5, Math.min(200, Math.round(base.spm * s.intensity)))

    return { ...base, strokeMin, strokeMax, spm }
  },

  // ── Saved custom patterns ───────────────────────────────────────────────────
  savedPatterns: _readPatterns(),

  savePattern: (name, pattern) => {
    const updated = [...get().savedPatterns.filter(p => p.name !== name), { name, ...pattern }]
    try { localStorage.setItem('vault_saved_patterns', JSON.stringify(updated)) } catch {}
    set({ savedPatterns: updated })
  },
  deleteSavedPattern: (name) => {
    const updated = get().savedPatterns.filter(p => p.name !== name)
    try { localStorage.setItem('vault_saved_patterns', JSON.stringify(updated)) } catch {}
    set({ savedPatterns: updated })
  },

  // ── Funscript stroke limiter (video mode) ───────────────────────────────────
  strokeFloor:   0,    // 0–100
  strokeCeiling: 100,  // 0–100
  setStrokeFloor:   (v) => set({ strokeFloor: Math.min(v, get().strokeCeiling - 5) }),
  setStrokeCeiling: (v) => set({ strokeCeiling: Math.max(v, get().strokeFloor + 5) }),

  // ── Multi-axis funscript ────────────────────────────────────────────────────
  // detectedAxes: axisIds present in the currently-loaded script, e.g. ['L0','R1'].
  //   Set by the video player on load; drives the axis-badge UI. Single-axis
  //   scripts yield ['L0'] (or []), so the badge row stays hidden.
  // funscriptAxes: per-axis enable map. An axis is ON unless explicitly set false,
  //   so the default ("play them all") needs no entries.
  detectedAxes:  [],
  funscriptAxes: {},
  setDetectedAxes: (axes) => set({ detectedAxes: Array.isArray(axes) ? axes : [] }),
  setAxisEnabled: (axisId, on) => set(s => ({
    funscriptAxes: { ...s.funscriptAxes, [axisId]: on },
  })),
  isAxisEnabled: (axisId) => get().funscriptAxes[axisId] !== false,

  // ── Ramp mode ───────────────────────────────────────────────────────────────
  rampEnabled:      false,
  rampDurationMin:  20,          // minutes
  rampStartPreset:  'tease',
  rampEndPreset:    'pound',
  rampProgress:     0.0,         // 0.0–1.0, updated by service

  setRampEnabled:     (v) => set({ rampEnabled: v, ...(v ? { schedulerEnabled: false } : {}) }),
  setRampDuration:    (v) => set({ rampDurationMin: Math.max(1, Math.min(120, v)) }),
  setRampStartPreset: (v) => set({ rampStartPreset: v }),
  setRampEndPreset:   (v) => set({ rampEndPreset: v }),
  setRampProgress:    (v) => set({ rampProgress: v }),

  // ── Pattern scheduler ───────────────────────────────────────────────────────
  schedulerEnabled:    false,
  schedulerRunningOnce: false,   // true while playSchedulerOnce() is active
  schedulerSteps:   [],  // [{ presetId, durationMin }]
  schedulerStep:    0,   // current step index

  setSchedulerEnabled: (v) => set({ schedulerEnabled: v, ...(v ? { rampEnabled: false } : {}) }),
  addSchedulerStep: (step) => set(s => ({ schedulerSteps: [...s.schedulerSteps, step] })),
  removeSchedulerStep: (i) => set(s => ({ schedulerSteps: s.schedulerSteps.filter((_, idx) => idx !== i) })),
  moveSchedulerStep: (from, to) => set(s => {
    const steps = [...s.schedulerSteps]
    const [item] = steps.splice(from, 1)
    steps.splice(to, 0, item)
    return { schedulerSteps: steps }
  }),
  setSchedulerStep: (i) => set({ schedulerStep: i }),

  // ── Edging assist ───────────────────────────────────────────────────────────
  edgingEnabled:         false,
  edgingPeakSeconds:     20,    // seconds at peak before auto-drop
  edgingDropPreset:      'tease',
  edgingBuildBackSeconds: 60,   // seconds to ramp back up after drop

  setEdgingEnabled:          (v) => set({ edgingEnabled: v }),
  setEdgingPeakSeconds:      (v) => set({ edgingPeakSeconds: Math.max(5, v) }),
  setEdgingDropPreset:       (v) => set({ edgingDropPreset: v }),
  setEdgingBuildBackSeconds: (v) => set({ edgingBuildBackSeconds: Math.max(10, v) }),
}))

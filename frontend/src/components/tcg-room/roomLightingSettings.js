// Collection Room lighting moods and the viewer's saved lighting choices.
// Every mood drives the same fixed set of lights, so switching moods only
// changes colours and intensities and never forces a shader recompile.

export const LIGHTING_MOODS = Object.freeze({
  day: Object.freeze({
    label: 'Daylight', sky: '#d5e4ee', exposure: 1.12, environment: .42,
    sun: { color: '#fff1d6', intensity: 1.9, position: [-7, 5.5, 0] },
    fill: { color: '#e7f1ff', intensity: .38 },
    hemisphere: { sky: '#fffaf0', ground: '#d8d1c5', intensity: .72 },
    ambient: .3, lamp: { color: '#fff1dc', intensity: .7 }, accentBoost: .55,
  }),
  golden: Object.freeze({
    label: 'Golden hour', sky: '#f4c193', exposure: 1.1, environment: .34,
    sun: { color: '#ffae62', intensity: 2.5, position: [-8, 2.9, 1.6] },
    fill: { color: '#c9b8ff', intensity: .22 },
    hemisphere: { sky: '#ffe0bf', ground: '#8f7684', intensity: .55 },
    ambient: .16, lamp: { color: '#ffd9a8', intensity: .6 }, accentBoost: .75,
  }),
  evening: Object.freeze({
    label: 'Evening', sky: '#38406c', exposure: 1.16, environment: .24,
    sun: { color: '#9aa8ff', intensity: .55, position: [-7, 4.5, -1] },
    fill: { color: '#7d86c9', intensity: .12 },
    hemisphere: { sky: '#bdb6ff', ground: '#2a2433', intensity: .34 },
    ambient: .12, lamp: { color: '#ffd09a', intensity: 1.55 }, accentBoost: 1,
  }),
  night: Object.freeze({
    label: 'Night', sky: '#0a0d1b', exposure: 1.22, environment: .14,
    sun: { color: '#7f95ff', intensity: .3, position: [-7, 5, 1] },
    fill: { color: '#4b5490', intensity: .08 },
    hemisphere: { sky: '#5a6390', ground: '#141420', intensity: .2 },
    ambient: .05, lamp: { color: '#ffc98c', intensity: .95 }, accentBoost: 1.35,
  }),
})

export const MOOD_ORDER = Object.freeze(['day', 'golden', 'evening', 'night'])

export const ACCENT_SWATCHES = Object.freeze([
  ['#8b7cf6', 'Vault violet'], ['#ff4fa3', 'Hot pink'], ['#2fd3ff', 'Ice blue'],
  ['#35e08a', 'Mint'], ['#ffb347', 'Amber'], ['#ff5252', 'Red'], ['#ffffff', 'White'],
])

// Room light tint: 'natural' keeps each mood's own colours, 'color' tints the
// room with a chosen colour, and 'led' follows the accent LEDs (cycle too).
export const ROOM_TINT_SWATCHES = Object.freeze([
  ['#ffcf9e', 'Warm white'], ['#cfe2ff', 'Cool white'],
  ...ACCENT_SWATCHES.filter(([color]) => color !== '#ffffff'),
])

export const DEFAULT_LIGHTING = Object.freeze({
  mood: 'day',
  ceiling: true,
  accent: Object.freeze({ enabled: true, color: '#8b7cf6', brightness: .55, mode: 'solid' }),
  tint: Object.freeze({ mode: 'natural', color: '#ff4fa3', strength: .5 }),
})

const STORAGE_KEY = 'vault.tcg-room.lighting'
const HEX = /^#[0-9a-f]{6}$/i

export function normalizeLighting(value) {
  const accent = value?.accent || {}
  const tint = value?.tint || {}
  const strength = Number(tint.strength)
  return {
    mood: LIGHTING_MOODS[value?.mood] ? value.mood : DEFAULT_LIGHTING.mood,
    ceiling: value?.ceiling !== false,
    accent: {
      enabled: accent.enabled !== false,
      color: HEX.test(accent.color || '') ? accent.color : DEFAULT_LIGHTING.accent.color,
      brightness: Number.isFinite(Number(accent.brightness)) ? Math.min(1, Math.max(0, Number(accent.brightness))) : DEFAULT_LIGHTING.accent.brightness,
      mode: accent.mode === 'cycle' ? 'cycle' : 'solid',
    },
    tint: {
      mode: ['natural', 'color', 'led'].includes(tint.mode) ? tint.mode : DEFAULT_LIGHTING.tint.mode,
      color: HEX.test(tint.color || '') ? tint.color : DEFAULT_LIGHTING.tint.color,
      strength: Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : DEFAULT_LIGHTING.tint.strength,
    },
  }
}

export function readStoredLighting() {
  try { return normalizeLighting(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')) } catch { return normalizeLighting(null) }
}

export function storeLighting(value) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeLighting(value))) } catch { /* Storage can be unavailable. */ }
}

export const LOOK_DEFAULTS = Object.freeze({ sensitivity: 1, headBob: true })
const LOOK_KEY = 'vault.tcg-room.look'

export function readStoredLook() {
  try {
    const value = JSON.parse(localStorage.getItem(LOOK_KEY) || 'null') || {}
    const sensitivity = Number(value.sensitivity)
    return {
      sensitivity: Number.isFinite(sensitivity) ? Math.min(2.5, Math.max(.3, sensitivity)) : LOOK_DEFAULTS.sensitivity,
      headBob: value.headBob !== false,
    }
  } catch { return { ...LOOK_DEFAULTS } }
}

export function storeLook(value) {
  try { localStorage.setItem(LOOK_KEY, JSON.stringify(value)) } catch { /* Storage can be unavailable. */ }
}

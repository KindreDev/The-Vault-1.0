/**
 * Global hotkey registry.
 *
 * Bindings are stored as normalised strings: modifiers in a fixed order, then
 * the key, all lowercase and joined with '+'. e.g. 'ctrl+e', 'shift+alt+f',
 * 'escape'. An empty string means "unbound".
 *
 * The action list here is the single source of truth — Settings renders from
 * it, and useHotkeys dispatches from it. Adding a hotkey means adding an entry
 * here plus a handler in useHotkeys, nothing else.
 */

export const HOTKEY_ACTIONS = [
  {
    id:      'session_toggle',
    label:   'Start / stop session',
    hint:    'Toggles the goon session timer and the neon border.',
    group:   'Session',
    default: 'ctrl+s',
  },
  {
    id:      'device_stop',
    label:   'Emergency stop device',
    hint:    'Cuts all device output immediately. Works even while typing.',
    group:   'Device',
    default: 'ctrl+.',
    // The one action that must fire from anywhere, including text fields.
    ignoreTypingGuard: true,
  },
  {
    id:      'edge_mode',
    label:   'Toggle Edge Mode',
    hint:    'Arms or disarms the random edging engine.',
    group:   'Device',
    default: 'ctrl+e',
  },
  {
    id:      'goon_mode',
    label:   'Toggle Goon Mode',
    hint:    'Starts or stops device freestyle (pattern) playback.',
    group:   'Device',
    default: 'ctrl+g',
  },
  {
    id:      'finisher',
    label:   'Trigger Finisher pattern',
    hint:    'Overrides the device with your saved finisher pattern.',
    group:   'Device',
    default: '',
  },
  {
    id:      'log_cum',
    label:   'Log cum on current image',
    hint:    'Same as tapping 💦 on whatever you are looking at.',
    group:   'Session',
    default: 'ctrl+d',
  },
  {
    id:      'log_edge',
    label:   'Log an edge',
    hint:    'Counts one edge against everything on screen. No device needed.',
    group:   'Session',
    default: 'ctrl+shift+e',
  },
]

export const HOTKEY_DEFAULTS = Object.fromEntries(
  HOTKEY_ACTIONS.map(a => [a.id, a.default])
)

// Keys that are only modifiers — never a binding on their own.
const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta', 'os', 'altgraph'])

// Normalise a KeyboardEvent into a binding string. Returns '' for a bare
// modifier press, so key-capture UIs can ignore those while the user is still
// holding things down.
export function eventToBinding(e) {
  let key = (e.key || '').toLowerCase()
  if (!key || MODIFIER_KEYS.has(key)) return ''
  if (key === ' ' || key === 'spacebar') key = 'space'

  const parts = []
  if (e.ctrlKey)  parts.push('ctrl')
  if (e.altKey)   parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  if (e.metaKey)  parts.push('meta')
  parts.push(key)
  return parts.join('+')
}

const DISPLAY_NAMES = {
  ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win',
  space: 'Space', escape: 'Esc', arrowup: '↑', arrowdown: '↓',
  arrowleft: '←', arrowright: '→', enter: 'Enter', '.': '.', ',': ',',
}

export function bindingToDisplay(binding) {
  if (!binding) return 'Unbound'
  return binding
    .split('+')
    .map(p => DISPLAY_NAMES[p] || (p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' + ')
}

// True when the event target is somewhere the user is typing, so a bare-letter
// hotkey must not hijack the keystroke.
export function isTypingTarget(el) {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
}

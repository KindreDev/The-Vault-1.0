/**
 * Global hotkey registry.
 *
 * Bindings are stored as normalised strings: modifiers in a fixed order, then
 * the key, all lowercase and joined with '+'. e.g. 'ctrl+e', 'shift+alt+f',
 * 'escape'. An empty string means "unbound".
 *
 * The action list here is the single source of truth — Settings renders from
 * it, and the dispatchers dispatch from it. Adding a hotkey means adding an
 * entry here plus a handler in the matching dispatcher, nothing else.
 *
 * ── Scopes ──────────────────────────────────────────────────────────────────
 *   'global' — dispatched by useHotkeys(), mounted once in <Layout />. Fires
 *              anywhere in the app, so these default to modifier combos.
 *   'viewer' — dispatched by useViewerHotkeys(), mounted by each viewer while
 *              it is open. Bare keys are safe here because nothing else owns
 *              the keyboard when a viewer is up. The viewer dispatcher runs in
 *              the capture phase and stops propagation on a match, so a viewer
 *              binding always wins over a global one.
 */

export const SCOPE_GLOBAL = 'global'
export const SCOPE_VIEWER = 'viewer'

/**
 * Group metadata. Order here is the order Settings renders them in.
 *   collapsible — group starts folded, with a one-line summary. Used for the
 *                 ten rating rows, which would otherwise swamp the panel.
 */
export const HOTKEY_GROUPS = [
  { name: 'Session',     scope: SCOPE_GLOBAL, blurb: 'Timers and logging. Work anywhere in the app.' },
  { name: 'Device',      scope: SCOPE_GLOBAL, blurb: 'Reach these without leaving whatever you are looking at.' },
  { name: 'Viewer',      scope: SCOPE_VIEWER, blurb: 'Only active while a viewer or the panel wall is open.' },
  { name: 'Video',       scope: SCOPE_VIEWER, blurb: 'Apply to the video you are watching, in every viewer.' },
  { name: 'Rating',      scope: SCOPE_VIEWER, blurb: 'Number keys star whatever has focus.', collapsible: true },
  { name: 'Multi-panel', scope: SCOPE_VIEWER, blurb: 'Panel wall only. Most act on the focused panel; a few act on all of them.' },
]

export const HOTKEY_ACTIONS = [
  // ── Session ────────────────────────────────────────────────────────────────
  {
    id:      'session_toggle',
    label:   'Start / stop session',
    hint:    'Toggles the goon session timer and the neon border.',
    group:   'Session',
    scope:   SCOPE_GLOBAL,
    default: 'ctrl+s',
  },
  {
    id:      'log_cum',
    label:   'Log cum on current image',
    hint:    'Same as tapping 💦 on whatever you are looking at.',
    group:   'Session',
    scope:   SCOPE_GLOBAL,
    default: 'ctrl+d',
  },
  {
    id:      'log_cum_repeat',
    label:   'Log cum again on the last one',
    hint:    'Credits the same file as your last 💦, even if the screen has moved on.',
    group:   'Session',
    scope:   SCOPE_GLOBAL,
    default: 'ctrl+shift+d',
  },
  {
    id:      'log_edge',
    label:   'Log an edge',
    hint:    'Counts one edge against everything on screen. No device needed.',
    group:   'Session',
    scope:   SCOPE_GLOBAL,
    default: 'ctrl+shift+e',
  },
  {
    id:      'log_session',
    label:   'Log a session entry',
    hint:    'Files a session log against the focused image without stopping the timer.',
    group:   'Session',
    scope:   SCOPE_GLOBAL,
    default: 'ctrl+shift+l',
  },

  // ── Device ─────────────────────────────────────────────────────────────────
  {
    id:      'device_stop',
    label:   'Emergency stop device',
    hint:    'Cuts all device output immediately. Works even while typing.',
    group:   'Device',
    scope:   SCOPE_GLOBAL,
    default: 'ctrl+.',
    // The one action that must fire from anywhere, including text fields.
    ignoreTypingGuard: true,
  },
  {
    id:      'edge_mode',
    label:   'Toggle Edge Mode',
    hint:    'Arms or disarms the random edging engine.',
    group:   'Device',
    scope:   SCOPE_GLOBAL,
    default: 'ctrl+e',
  },
  {
    id:      'goon_mode',
    label:   'Toggle Goon Mode',
    hint:    'Starts or stops device freestyle (pattern) playback.',
    group:   'Device',
    scope:   SCOPE_GLOBAL,
    default: 'ctrl+g',
  },
  {
    id:      'finisher',
    label:   'Trigger Finisher pattern',
    hint:    'Overrides the device with your saved finisher pattern.',
    group:   'Device',
    scope:   SCOPE_GLOBAL,
    default: '',
  },
  {
    id:      'device_intensity_up',
    label:   'Device faster',
    hint:    'Raises pattern intensity by 10%. Takes effect on the next stroke.',
    group:   'Device',
    scope:   SCOPE_GLOBAL,
    default: 'ctrl+arrowup',
  },
  {
    id:      'device_intensity_down',
    label:   'Device slower',
    hint:    'Lowers pattern intensity by 10%.',
    group:   'Device',
    scope:   SCOPE_GLOBAL,
    default: 'ctrl+arrowdown',
  },
  {
    id:      'device_depth_up',
    label:   'Shift stroke up (glans)',
    hint:    'Slides the stroke window toward the tip.',
    group:   'Device',
    scope:   SCOPE_GLOBAL,
    default: 'ctrl+shift+arrowup',
  },
  {
    id:      'device_depth_down',
    label:   'Shift stroke down (base)',
    hint:    'Slides the stroke window back toward the base.',
    group:   'Device',
    scope:   SCOPE_GLOBAL,
    default: 'ctrl+shift+arrowdown',
  },
  {
    id:      'device_pattern_next',
    label:   'Next pattern',
    hint:    'Cycles forward through presets and your saved patterns.',
    group:   'Device',
    scope:   SCOPE_GLOBAL,
    default: 'ctrl+]',
  },
  {
    id:      'device_pattern_prev',
    label:   'Previous pattern',
    hint:    'Cycles backward through presets and your saved patterns.',
    group:   'Device',
    scope:   SCOPE_GLOBAL,
    default: 'ctrl+[',
  },
  {
    id:      'device_ramp',
    label:   'Toggle Ramp mode',
    hint:    'Starts or stops the slow build between your two ramp presets.',
    group:   'Device',
    scope:   SCOPE_GLOBAL,
    default: 'ctrl+r',
  },

  // ── Viewer ─────────────────────────────────────────────────────────────────
  // The seek pair falls back to next/previous on a photo, so the stock bindings
  // behave exactly as they always have: arrows seek a video, arrows walk a set
  // of photos.
  {
    id:      'viewer_seek_fwd',
    label:   'Seek forward',
    hint:    'Skips ahead in a video. On a photo it moves to the next one instead.',
    group:   'Viewer',
    scope:   SCOPE_VIEWER,
    default: 'arrowright',
  },
  {
    id:      'viewer_seek_back',
    label:   'Seek back',
    hint:    'Skips back in a video. On a photo it moves to the previous one instead.',
    group:   'Viewer',
    scope:   SCOPE_VIEWER,
    default: 'arrowleft',
  },
  {
    id:      'viewer_seek_fwd_big',
    label:   'Seek forward (long)',
    hint:    'The bigger jump. Also falls back to next on a photo.',
    group:   'Viewer',
    scope:   SCOPE_VIEWER,
    default: 'ctrl+arrowright',
  },
  {
    id:      'viewer_seek_back_big',
    label:   'Seek back (long)',
    hint:    'The bigger jump backward.',
    group:   'Viewer',
    scope:   SCOPE_VIEWER,
    default: 'ctrl+arrowleft',
  },
  {
    id:      'viewer_next',
    label:   'Next file',
    hint:    'Always moves to the next file, video or photo.',
    group:   'Viewer',
    scope:   SCOPE_VIEWER,
    default: 'shift+arrowright',
  },
  {
    id:      'viewer_prev',
    label:   'Previous file',
    hint:    'Always moves to the previous file.',
    group:   'Viewer',
    scope:   SCOPE_VIEWER,
    default: 'shift+arrowleft',
  },
  {
    id:      'viewer_play_pause',
    label:   'Play / pause',
    hint:    'Pauses a video, or starts and stops the slideshow on photos.',
    group:   'Viewer',
    scope:   SCOPE_VIEWER,
    default: 'space',
  },
  {
    id:      'viewer_shuffle',
    label:   'Jump somewhere random',
    hint:    'Throws you at a random file in whatever you are currently browsing.',
    group:   'Viewer',
    scope:   SCOPE_VIEWER,
    default: 's',
  },
  {
    id:      'viewer_slideshow_faster',
    label:   'Slideshow faster',
    hint:    'Shortens how long each photo stays up.',
    group:   'Viewer',
    scope:   SCOPE_VIEWER,
    default: 'shift+arrowup',
  },
  {
    id:      'viewer_slideshow_slower',
    label:   'Slideshow slower',
    hint:    'Holds each photo for longer.',
    group:   'Viewer',
    scope:   SCOPE_VIEWER,
    default: 'shift+arrowdown',
  },
  {
    id:      'viewer_fullscreen',
    label:   'Toggle fullscreen',
    hint:    'Same as the fullscreen button.',
    group:   'Viewer',
    scope:   SCOPE_VIEWER,
    default: 'f',
  },
  {
    id:      'viewer_favorite',
    label:   'Favourite (heart)',
    hint:    'Toggles the heart on the focused file.',
    group:   'Viewer',
    scope:   SCOPE_VIEWER,
    default: 'h',
  },
  {
    id:      'viewer_zoom_in',
    label:   'Zoom in',
    hint:    'Zooms the stage. Number keys are taken by ratings, so zoom sits on Z/X/C.',
    group:   'Viewer',
    scope:   SCOPE_VIEWER,
    default: 'z',
  },
  {
    id:      'viewer_zoom_out',
    label:   'Zoom out',
    hint:    'Zooms back out.',
    group:   'Viewer',
    scope:   SCOPE_VIEWER,
    default: 'x',
  },
  {
    id:      'viewer_zoom_reset',
    label:   'Reset zoom',
    hint:    'Back to fit, centred.',
    group:   'Viewer',
    scope:   SCOPE_VIEWER,
    default: 'c',
  },
  {
    id:      'viewer_sidebar',
    label:   'Toggle info sidebar',
    hint:    'Hides or shows the tags and metadata panel.',
    group:   'Viewer',
    scope:   SCOPE_VIEWER,
    default: 'i',
  },
  {
    id:      'viewer_close',
    label:   'Close viewer',
    hint:    'Leaves fullscreen first, then clears zoom, then closes.',
    group:   'Viewer',
    scope:   SCOPE_VIEWER,
    default: 'escape',
  },

  // ── Video ──────────────────────────────────────────────────────────────────
  {
    id:      'video_rate_up',
    label:   'Playback speed up',
    hint:    'Steps playback rate up. Caps at 4×.',
    group:   'Video',
    scope:   SCOPE_VIEWER,
    default: ']',
  },
  {
    id:      'video_rate_down',
    label:   'Playback speed down',
    hint:    'Steps playback rate down. Floors at 0.25×.',
    group:   'Video',
    scope:   SCOPE_VIEWER,
    default: '[',
  },
  {
    id:      'video_rate_reset',
    label:   'Reset playback speed',
    hint:    'Straight back to 1×.',
    group:   'Video',
    scope:   SCOPE_VIEWER,
    default: '\\',
  },
  {
    id:      'video_restart',
    label:   'Restart video',
    hint:    'Jumps to the beginning and keeps playing.',
    group:   'Video',
    scope:   SCOPE_VIEWER,
    default: 'r',
  },
  {
    id:      'video_mute',
    label:   'Mute / unmute',
    hint:    'Toggles sound on the video you are watching.',
    group:   'Video',
    scope:   SCOPE_VIEWER,
    default: 'm',
  },
  {
    id:      'video_loop',
    label:   'Toggle loop',
    hint:    'Repeats the video instead of advancing.',
    group:   'Video',
    scope:   SCOPE_VIEWER,
    default: 'l',
  },
  {
    id:      'video_volume_up',
    label:   'Volume up',
    hint:    'Raises the volume of the focused video.',
    group:   'Video',
    scope:   SCOPE_VIEWER,
    default: 'arrowup',
  },
  {
    id:      'video_volume_down',
    label:   'Volume down',
    hint:    'Lowers the volume of the focused video.',
    group:   'Video',
    scope:   SCOPE_VIEWER,
    default: 'arrowdown',
  },
  {
    id:      'video_funscript_sync',
    label:   'Toggle funscript sync',
    hint:    'Hands the device to this video’s script, or takes it back.',
    group:   'Video',
    scope:   SCOPE_VIEWER,
    default: 'y',
  },

  // ── Rating ─────────────────────────────────────────────────────────────────
  // Ten rows, folded away by default. 1–9 are literal, 0 is ten, backtick wipes.
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ({
    id:      `rate_${n}`,
    label:   `Rate ${n} ${n === 1 ? 'star' : 'stars'}`,
    hint:    `Sets the focused file to ★${n}.`,
    group:   'Rating',
    scope:   SCOPE_VIEWER,
    default: String(n),
  })),
  {
    id:      'rate_10',
    label:   'Rate 10 stars',
    hint:    'Sets the focused file to ★10 — the top of the scale.',
    group:   'Rating',
    scope:   SCOPE_VIEWER,
    default: '0',
  },
  {
    id:      'rate_clear',
    label:   'Clear rating',
    hint:    'Wipes the rating back to unrated.',
    group:   'Rating',
    scope:   SCOPE_VIEWER,
    default: '`',
  },

  // ── Multi-panel ────────────────────────────────────────────────────────────
  {
    id:      'wall_next_all',
    label:   'Advance every panel',
    hint:    'Refreshes the whole wall in one press.',
    group:   'Multi-panel',
    scope:   SCOPE_VIEWER,
    default: 'n',
  },
  {
    id:      'wall_prev_all',
    label:   'Rewind every panel',
    hint:    'Steps the whole wall back one file.',
    group:   'Multi-panel',
    scope:   SCOPE_VIEWER,
    default: 'b',
  },
  {
    id:      'wall_shuffle_all',
    label:   'Shuffle every panel',
    hint:    'Throws a random file into every panel at once.',
    group:   'Multi-panel',
    scope:   SCOPE_VIEWER,
    default: 'shift+s',
  },
  {
    id:      'wall_pause_all',
    label:   'Pause / resume every panel',
    hint:    'Freezes the whole wall, or sets it going again.',
    group:   'Multi-panel',
    scope:   SCOPE_VIEWER,
    default: 'shift+space',
  },
  {
    id:      'wall_focus_next',
    label:   'Focus next panel',
    hint:    'Moves the focus ring on. Focused panel is what the other keys act on.',
    group:   'Multi-panel',
    scope:   SCOPE_VIEWER,
    default: 'tab',
  },
  {
    id:      'wall_device_next',
    label:   'Hand device to next panel',
    hint:    'Cycles which panel’s funscript is driving the device.',
    group:   'Multi-panel',
    scope:   SCOPE_VIEWER,
    default: 'd',
  },
  {
    id:      'wall_add_panel',
    label:   'Add a panel',
    hint:    'Grows the wall by one.',
    group:   'Multi-panel',
    scope:   SCOPE_VIEWER,
    default: '=',
  },
  {
    id:      'wall_remove_panel',
    label:   'Remove a panel',
    hint:    'Shrinks the wall by one.',
    group:   'Multi-panel',
    scope:   SCOPE_VIEWER,
    default: '-',
  },
]

export const HOTKEY_DEFAULTS = Object.fromEntries(
  HOTKEY_ACTIONS.map(a => [a.id, a.default])
)

export const ACTIONS_BY_ID = Object.fromEntries(
  HOTKEY_ACTIONS.map(a => [a.id, a])
)

export const VIEWER_ACTION_IDS = new Set(
  HOTKEY_ACTIONS.filter(a => a.scope === SCOPE_VIEWER).map(a => a.id)
)

/**
 * The arrow-key presets.
 *
 * Rebinding four rows by hand to answer one question ("do arrows seek, or do
 * they change file?") is more work than the question deserves, so Settings
 * offers it as a two-button swap. Both presets keep every arrow key useful —
 * whichever pair loses the bare arrows picks up the shifted ones.
 */
export const ARROW_PRESETS = {
  seek: {
    label: 'Arrows seek',
    hint:  'Left / right scrub through a video. Shift + arrows change file.',
    bindings: {
      viewer_seek_fwd:  'arrowright',
      viewer_seek_back: 'arrowleft',
      viewer_next:      'shift+arrowright',
      viewer_prev:      'shift+arrowleft',
    },
  },
  nav: {
    label: 'Arrows change file',
    hint:  'Left / right jump between files. Shift + arrows scrub the video.',
    bindings: {
      viewer_next:      'arrowright',
      viewer_prev:      'arrowleft',
      viewer_seek_fwd:  'shift+arrowright',
      viewer_seek_back: 'shift+arrowleft',
    },
  },
}

// Which preset the current bindings match, or null if the user has since
// rebound one of the four by hand.
export function detectArrowPreset(hotkeys) {
  for (const [id, preset] of Object.entries(ARROW_PRESETS)) {
    if (Object.entries(preset.bindings).every(([k, v]) => hotkeys?.[k] === v)) return id
  }
  return null
}

// ── Seek / slideshow step settings ───────────────────────────────────────────
// Not bindings, but they belong to the same panel: how far a seek key actually
// moves. Seconds.
export const HOTKEY_SETTING_DEFAULTS = {
  seekStep:    3,
  seekStepBig: 10,
}

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
  arrowleft: '←', arrowright: '→', enter: 'Enter', tab: 'Tab',
  backspace: 'Backspace', '.': '.', ',': ',', '`': '`', '\\': '\\',
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

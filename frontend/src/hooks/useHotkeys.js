/**
 * Global hotkey dispatcher. Mounted once, in <Layout />.
 *
 * Three rules keep this from fighting the viewers:
 *   1. Nothing fires while the user is typing — except emergency stop, which is
 *      the whole point of an emergency stop.
 *   2. Only global-scope actions are dispatched here. Viewer-scope bindings are
 *      owned by useViewerHotkeys(), which runs in the capture phase and stops
 *      the event before this listener ever sees it.
 *   3. Bindings are matched as normalised strings, so a viewer's own bare-key
 *      handlers can never be shadowed by a global binding unless the user
 *      deliberately sets one.
 */
import { useEffect } from 'react'
import toast from 'react-hot-toast'
import { useVaultStore } from '../store/vault'
import { useDeviceStore, PRESETS } from '../store/deviceStore'
import { deviceService } from '../services/device'
import { imagesApi, sessionsApi } from '../lib/api'
import {
  eventToBinding, isTypingTarget, HOTKEY_ACTIONS, VIEWER_ACTION_IDS,
} from '../lib/hotkeys'
import { startSessionNow, finishSessionNow } from '../lib/session'
import { logEdgeNow } from '../lib/edges'

const IGNORE_TYPING = new Set(
  HOTKEY_ACTIONS.filter(a => a.ignoreTypingGuard).map(a => a.id)
)

export function useHotkeys() {
  const hotkeys = useVaultStore(s => s.hotkeys)

  useEffect(() => {
    // Reverse lookup: binding string → action id. Built once per binding change
    // so the keydown handler stays a single map lookup. Viewer-scope actions
    // are skipped — they belong to whichever viewer is open.
    const byBinding = {}
    for (const [actionId, binding] of Object.entries(hotkeys || {})) {
      if (binding && !VIEWER_ACTION_IDS.has(actionId)) byBinding[binding] = actionId
    }

    function onKeyDown(e) {
      const binding = eventToBinding(e)
      if (!binding) return
      const actionId = byBinding[binding]
      if (!actionId) return
      if (isTypingTarget(e.target) && !IGNORE_TYPING.has(actionId)) return

      e.preventDefault()
      e.stopPropagation()
      runAction(actionId)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hotkeys])
}

// ── Action handlers ──────────────────────────────────────────────────────────

function runAction(actionId) {
  switch (actionId) {
    case 'session_toggle':        return toggleSession()
    case 'device_stop':           return emergencyStop()
    case 'edge_mode':             return toggleEdgeMode()
    case 'goon_mode':             return toggleGoonMode()
    case 'finisher':              return triggerFinisher()
    case 'log_cum':               return logCum()
    case 'log_cum_repeat':        return logCumRepeat()
    case 'log_edge':              return logEdgeNow()
    case 'log_session':           return logSession()
    case 'device_intensity_up':   return nudgeIntensity(+0.1)
    case 'device_intensity_down': return nudgeIntensity(-0.1)
    case 'device_depth_up':       return nudgeDepth(+0.1)
    case 'device_depth_down':     return nudgeDepth(-0.1)
    case 'device_pattern_next':   return cyclePattern(+1)
    case 'device_pattern_prev':   return cyclePattern(-1)
    case 'device_ramp':           return toggleRamp()
    default:                      return
  }
}

function toggleSession() {
  // Goes through the same path as every on-screen Stop Session button. This
  // used to end the session in localStorage only — no session logged, no
  // orgasm counted, nothing sent to the server at all.
  if (useVaultStore.getState().sessionActive) finishSessionNow()
  else                                        startSessionNow()
}

function emergencyStop() {
  const { status } = useDeviceStore.getState()
  if (status !== 'connected') return
  deviceService.stop()
  toast('⏹ Device stopped')
}

function toggleEdgeMode() {
  const s = useDeviceStore.getState()
  const next = !s.edgeModeEnabled
  deviceService.setEdgeMode(next)
  if (next && s.status !== 'connected') {
    toast('Edge Mode set — it arms when a device connects')
    return
  }
  toast(next ? '🌊 Edge Mode armed' : 'Edge Mode off')
}

function toggleGoonMode() {
  const s = useDeviceStore.getState()
  if (s.status !== 'connected') {
    toast('No device connected')
    return
  }
  if (s.mode === 'freestyle') {
    deviceService.stopFreestyle()
    toast('Goon Mode off')
  } else {
    deviceService.startFreestyle()
    toast('😵‍💫 Goon Mode on')
  }
}

function triggerFinisher() {
  const { finisherPatternName } = useDeviceStore.getState()
  if (!finisherPatternName) {
    toast('No finisher pattern set')
    return
  }
  // Armed only while a script is loaded, or while it is already running so the
  // key can also end it.
  if (!deviceService.isFinisherActive() && !deviceService.hasFunscriptLoaded()) return
  const started = deviceService.toggleFinisher(finisherPatternName)
  toast(started ? `🏁 Finisher: ${finisherPatternName}` : 'Finisher stopped')
}

function logCum(imageId = null) {
  const s = useVaultStore.getState()
  const target = imageId ?? s.getFocusedImageId()
  if (!target) {
    toast('Nothing on screen to log')
    return
  }
  imagesApi.cum(target, {})
    .then(r => {
      s.addXpToast(`+${r.data?.xp?.amount ?? 5} XP`)
      s.setLastCumImageId(target)
      // Let the open viewer move its counter without a refetch.
      s.pingCount(target, r.data?.cum_count)
    })
    .catch(() => toast('Could not log that'))
}

// Second (third, fourth…) orgasm on the file that earned the last one. By the
// time you come back to the keyboard the slideshow has usually moved on, and
// the plain log-cum key would credit whatever happens to be up now.
function logCumRepeat() {
  const { lastCumImageId } = useVaultStore.getState()
  if (!lastCumImageId) {
    toast('No previous 💦 to repeat')
    return
  }
  logCum(lastCumImageId)
}

async function logSession() {
  const s = useVaultStore.getState()
  const imageId = s.getFocusedImageId()
  if (!imageId) {
    toast('Nothing on screen to log')
    return
  }
  try {
    // Fetch the file first for its gallery, so the server can auto-fill the
    // creator. Logging with image_id alone files a session against nobody.
    const { data: img } = await imagesApi.get(imageId)
    const { data } = await sessionsApi.log({
      image_id:   imageId,
      gallery_id: img?.gallery_id ?? null,
    })
    s.addXpToast(`+${data?.xp_earned ?? 25} XP`)
    toast.success('Session logged ❤️')
  } catch {
    toast.error('Could not log that session')
  }
}

// ── Device nudges ────────────────────────────────────────────────────────────
// These write straight to the device store. The pattern engine reads the store
// on every tick, so a change lands on the next stroke without restarting
// anything — which is exactly what you want mid-session.

function nudgeIntensity(delta) {
  const s = useDeviceStore.getState()
  const next = Math.max(0.1, Math.min(5.0, Math.round((s.intensity + delta) * 10) / 10))
  s.setIntensity(next)
  toast(`⚡ Intensity ${Math.round(next * 100)}%`, { id: 'device-intensity' })
}

function nudgeDepth(delta) {
  const s = useDeviceStore.getState()
  const next = Math.max(0, Math.min(1, Math.round((s.glansShift + delta) * 10) / 10))
  s.setGlansShift(next)
  toast(`↕ Stroke ${next === 0 ? 'full range' : `shifted ${Math.round(next * 100)}% up`}`,
        { id: 'device-depth' })
}

function cyclePattern(dir) {
  const s = useDeviceStore.getState()
  // Presets first, then anything saved — the same order the device panel lists
  // them in, so the key walks the list you can see.
  const ids = [...PRESETS.map(p => p.id), ...s.savedPatterns.map(p => `saved_${p.name}`), 'custom']
  const cur = ids.indexOf(s.activePresetId)
  const next = ids[((cur < 0 ? 0 : cur) + dir + ids.length) % ids.length]
  s.setActivePreset(next)

  const label = next === 'custom'
    ? 'Custom'
    : next.startsWith('saved_')
      ? next.slice(6)
      : (PRESETS.find(p => p.id === next)?.name ?? next)
  toast(`🎛 ${label}`, { id: 'device-pattern' })
}

function toggleRamp() {
  const s = useDeviceStore.getState()
  const next = !s.rampEnabled
  s.setRampEnabled(next)
  toast(next ? '📈 Ramp mode on' : 'Ramp mode off')
}

/**
 * Global hotkey dispatcher. Mounted once, in <Layout />.
 *
 * Two rules keep this from fighting the viewers:
 *   1. Nothing fires while the user is typing — except emergency stop, which is
 *      the whole point of an emergency stop.
 *   2. Bindings live in the vault store and are matched as normalised strings,
 *      so a viewer's own bare-key handlers (arrows, space, escape) can never be
 *      shadowed by a global binding unless the user deliberately sets one.
 */
import { useEffect } from 'react'
import toast from 'react-hot-toast'
import { useVaultStore } from '../store/vault'
import { useDeviceStore } from '../store/deviceStore'
import { deviceService } from '../services/device'
import { imagesApi } from '../lib/api'
import { eventToBinding, isTypingTarget, HOTKEY_ACTIONS } from '../lib/hotkeys'
import { startSessionNow, finishSessionNow } from '../lib/session'

const IGNORE_TYPING = new Set(
  HOTKEY_ACTIONS.filter(a => a.ignoreTypingGuard).map(a => a.id)
)

export function useHotkeys() {
  const hotkeys = useVaultStore(s => s.hotkeys)

  useEffect(() => {
    // Reverse lookup: binding string → action id. Built once per binding change
    // so the keydown handler stays a single map lookup.
    const byBinding = {}
    for (const [actionId, binding] of Object.entries(hotkeys || {})) {
      if (binding) byBinding[binding] = actionId
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
    case 'session_toggle':  return toggleSession()
    case 'device_stop':     return emergencyStop()
    case 'edge_mode':       return toggleEdgeMode()
    case 'goon_mode':       return toggleGoonMode()
    case 'finisher':        return triggerFinisher()
    case 'log_cum':         return logCum()
    default:                return
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

function logCum() {
  const s = useVaultStore.getState()
  const imageId = s.getFocusedImageId()
  if (!imageId) {
    toast('Nothing on screen to log')
    return
  }
  imagesApi.cum(imageId, {})
    .then(r => {
      s.addXpToast(`+${r.data?.xp?.amount ?? 5} XP`)
      // Let the open viewer move its counter without a refetch.
      s.pingCount(imageId, r.data?.cum_count)
    })
    .catch(() => toast('Could not log that'))
}

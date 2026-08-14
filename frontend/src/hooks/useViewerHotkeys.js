/**
 * Viewer-scope hotkey dispatcher.
 *
 * Mounted by whatever viewer is open — the gallery viewer, the photo/video
 * viewer, the playlist lightbox, the panel wall. Each passes a map of the
 * actions it can actually perform; anything it leaves out simply doesn't fire
 * there, so the playlist lightbox is not obliged to implement funscript sync.
 *
 * Three rules make this safe to layer under the global dispatcher:
 *
 *   1. CAPTURE PHASE. A window capture listener runs before the window bubble
 *      listener useHotkeys() uses, so on a match we stopPropagation() and the
 *      global dispatcher never sees the key. A viewer binding always beats a
 *      global one — which is what you want, since the viewer is the thing you
 *      are looking at.
 *   2. Nothing fires while typing. Viewer bindings are bare keys; a tag input
 *      would be unusable otherwise.
 *   3. Only handlers the caller actually provided are dispatched, and an
 *      unhandled key is left completely alone — no preventDefault, no swallow.
 *      That is what keeps browser and OS keys working in viewers that don't
 *      claim them.
 *
 * The `enabled` flag exists for viewers that hand the keyboard to something
 * else while it is up (the slideshow end screen, a modal).
 */
import { useEffect, useRef } from 'react'
import { useVaultStore } from '../store/vault'
import { eventToBinding, isTypingTarget, VIEWER_ACTION_IDS } from '../lib/hotkeys'

export function useViewerHotkeys(handlers, enabled = true) {
  const hotkeys = useVaultStore(s => s.hotkeys)

  // Handlers are rebuilt on nearly every render (they close over idx, zoom,
  // whatever). Holding them in a ref means the listener is attached once per
  // binding change instead of thrashing on every keystroke-driven re-render.
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  useEffect(() => {
    // Reverse lookup, viewer-scope actions only. Built once per binding change
    // so the keydown path stays a single map lookup.
    const byBinding = {}
    for (const [actionId, binding] of Object.entries(hotkeys || {})) {
      if (binding && VIEWER_ACTION_IDS.has(actionId)) byBinding[binding] = actionId
    }

    function onKeyDown(e) {
      if (!enabledRef.current) return
      if (isTypingTarget(e.target)) return

      const binding = eventToBinding(e)
      if (!binding) return
      const actionId = byBinding[binding]
      if (!actionId) return

      const fn = handlersRef.current?.[actionId]
      if (typeof fn !== 'function') return   // this viewer doesn't do that one

      e.preventDefault()
      e.stopPropagation()
      fn(e)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [hotkeys])
}

export default useViewerHotkeys

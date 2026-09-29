import { useSyncExternalStore } from 'react'

const VIDEO_LOOP_KEY = 'vault.video.loop'
const VIDEO_LOOP_EVENT = 'vault-video-loop-change'
let fallbackLoop = false

export function getSavedVideoLoop() {
  try {
    return window.localStorage.getItem(VIDEO_LOOP_KEY) === 'true'
  } catch {
    return fallbackLoop
  }
}

export function saveVideoLoop(enabled) {
  const loop = !!enabled
  fallbackLoop = loop
  try {
    window.localStorage.setItem(VIDEO_LOOP_KEY, String(loop))
  } catch {
    // Keep loop active for this session when storage is unavailable.
  }
  window.dispatchEvent(new Event(VIDEO_LOOP_EVENT))
  return loop
}

function subscribeVideoLoop(listener) {
  window.addEventListener(VIDEO_LOOP_EVENT, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(VIDEO_LOOP_EVENT, listener)
    window.removeEventListener('storage', listener)
  }
}

export function useVideoLoop() {
  return useSyncExternalStore(subscribeVideoLoop, getSavedVideoLoop, () => false)
}

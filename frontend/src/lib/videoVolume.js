const VIDEO_VOLUME_KEY = 'vault.video.volume'

const clampVolume = value => Math.max(0, Math.min(1, Number(value)))

export function getSavedVideoVolume() {
  try {
    const saved = localStorage.getItem(VIDEO_VOLUME_KEY)
    if (saved === null) return 1
    const value = Number(saved)
    return Number.isFinite(value) ? clampVolume(value) : 1
  } catch {
    return 1
  }
}

export function saveVideoVolume(value) {
  const volume = clampVolume(value)
  try {
    localStorage.setItem(VIDEO_VOLUME_KEY, String(volume))
  } catch {
    // Playback still works when storage is unavailable (for example, private mode).
  }
  return volume
}

export function restoreVideoVolume(video) {
  if (!video) return 1
  const volume = getSavedVideoVolume()
  video.volume = volume
  return volume
}

export function rememberVideoElementVolume(event) {
  const video = event?.currentTarget
  if (video) saveVideoVolume(video.volume)
}

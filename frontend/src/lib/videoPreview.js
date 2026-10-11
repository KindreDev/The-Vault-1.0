const previews = new Set()
let blockers = 0

export const canPlayVideoPreview = () => blockers === 0

export function registerVideoPreview(video) {
  previews.add(video)
  const guard = () => { if (!canPlayVideoPreview()) stopVideoPreview(video) }
  video.addEventListener('loadstart', guard)
  video.addEventListener('play', guard)
  guard()
  return () => {
    previews.delete(video)
    video.removeEventListener('loadstart', guard)
    video.removeEventListener('play', guard)
    stopVideoPreview(video)
  }
}

// A viewer owns playback until it closes. Stale hover callbacks cannot restart
// previews underneath it, even when the pointer never left the original card.
export function suspendVideoPreviews() {
  blockers++
  previews.forEach(stopVideoPreview)
  let released = false
  return () => { if (!released) { released = true; blockers-- } }
}

export function stopVideoPreview(video) {
  if (!video) return
  video.pause()
  video.removeAttribute('src')
  video.load()
}

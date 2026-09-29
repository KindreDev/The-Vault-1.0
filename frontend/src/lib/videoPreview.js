export function stopVideoPreview(video) {
  if (!video) return
  video.pause()
  video.removeAttribute('src')
  video.load()
}

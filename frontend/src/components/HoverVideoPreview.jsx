import React, { useRef, useEffect, useState } from 'react'
import { canPlayVideoPreview, registerVideoPreview, stopVideoPreview } from '../lib/videoPreview'
import { useVaultStore } from '../store/vault'

const RETRY_MS = 1000
const MAX_TRIES = 5   // each try waits up to ~6s server-side for the clip build

/**
 * Hover-to-play overlay for video tiles. Mount inside a relatively-positioned
 * tile; the parent owns the `hovered` state.
 *
 * Plays a short cached clip (/hover-clip) in a plain <video>, not the full
 * player on the original file, so it starts almost at once. The first hover
 * of a video builds its clip; the thumbnail stays visible until it plays.
 */
export default function HoverVideoPreview(props) {
  // Settings → Performance can turn hover previews off entirely.
  const enabled = useVaultStore(s => s.hoverPreviewsEnabled)
  return enabled ? <HoverClip {...props} /> : null
}

function HoverClip({ imageId, hovered, className = '', style }) {
  const videoRef = useRef(null)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const vid = videoRef.current
    if (!vid) return
    return registerVideoPreview(vid)
  }, [])

  useEffect(() => {
    const vid = videoRef.current
    if (!vid) return
    setPlaying(false)
    if (!hovered || !canPlayVideoPreview()) {
      stopVideoPreview(vid)
      return
    }
    let tries = 0
    let retryTimer = null
    const start = () => {
      if (!canPlayVideoPreview()) return
      tries++
      vid.src = `/api/images/${imageId}/hover-clip`
      vid.play().catch(() => {})
    }
    // 503 while the clip is still being built; try again while hovered.
    const onError = () => {
      if (!vid.getAttribute('src') || tries >= MAX_TRIES) return
      retryTimer = setTimeout(start, RETRY_MS)
    }
    const onPlaying = () => setPlaying(true)
    vid.addEventListener('error', onError)
    vid.addEventListener('playing', onPlaying)
    start()
    return () => {
      clearTimeout(retryTimer)
      vid.removeEventListener('error', onError)
      vid.removeEventListener('playing', onPlaying)
      stopVideoPreview(vid)
    }
  }, [hovered, imageId])

  return (
    <video
      ref={videoRef}
      muted
      loop
      playsInline
      preload="none"
      disablePictureInPicture
      className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${className}`}
      style={{ opacity: hovered && playing ? 1 : 0, zIndex: 2, pointerEvents: 'none', ...style }}
    />
  )
}

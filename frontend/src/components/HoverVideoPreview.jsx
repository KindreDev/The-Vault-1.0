import React, { useRef, useEffect } from 'react'

/**
 * Lightweight hover-to-play video overlay for thumbnail cards.
 * Mount inside a relatively-positioned card; the parent owns the `hovered` state.
 * Streams the real video muted, seeks to the middle, and stops after 15s to
 * avoid holding file handles open on the HDD.
 *
 * Props
 *   imageId – image record id (video)
 *   hovered – whether the parent card is hovered
 */
export default function HoverVideoPreview({ imageId, hovered }) {
  const videoRef = useRef(null)
  const timerRef = useRef(null)

  useEffect(() => {
    const vid = videoRef.current
    if (!vid) return
    if (hovered) {
      vid.src = `/api/images/${imageId}/file`
      const seekAndPlay = () => {
        if (vid.duration && !isNaN(vid.duration)) vid.currentTime = vid.duration * 0.5
        vid.play().catch(() => {})
      }
      if (vid.readyState >= 1) seekAndPlay()
      else { vid.load(); vid.addEventListener('loadedmetadata', seekAndPlay, { once: true }) }
      timerRef.current = setTimeout(() => vid.pause(), 15000)
    } else {
      clearTimeout(timerRef.current)
      vid.pause()
      vid.removeAttribute('src')
      vid.load()
    }
    return () => clearTimeout(timerRef.current)
  }, [hovered, imageId])

  // Release media pipeline on unmount (see InlineVideoPlayer for why this matters)
  useEffect(() => {
    return () => {
      const vid = videoRef.current
      if (!vid) return
      vid.pause()
      vid.removeAttribute('src')
      vid.load()
    }
  }, [])

  return (
    <video
      ref={videoRef}
      muted
      playsInline
      preload="none"
      className="absolute inset-0 w-full h-full object-cover transition-opacity duration-200"
      style={{ opacity: hovered ? 1 : 0, zIndex: 2, pointerEvents: 'none' }}
    />
  )
}

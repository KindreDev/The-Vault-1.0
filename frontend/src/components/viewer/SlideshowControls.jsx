/**
 * <SlideshowControls /> — play/pause plus the interval picker, shared by every
 * viewer.
 *
 * This block used to be copy-pasted into GalleryView and ImageList with
 * different styling in each, so the same feature looked like two different
 * features depending on which page you opened a video from. One component now,
 * using the labelled Gallery-view styling everywhere.
 */
import React, { useState, useRef, useEffect } from 'react'
import { Play, Pause } from 'lucide-react'
import { useT } from '../../i18n'

export const SLIDESHOW_SPEEDS = [3, 5, 8, 12, 20, 30]

/**
 * True for media that runs on its own clock — video, or an animated GIF.
 *
 * Both advance the slideshow when they finish rather than when the interval
 * elapses, so the interval is meaningless while one is on screen.
 */
export function isTimedMedia(image) {
  if (!image) return false
  if (image.is_video) return true
  return /\.gif$/i.test(image.filename || '')
}

export default function SlideshowControls({
  active,
  onToggle,
  speed,
  onSpeedChange,
  /** True while a video or GIF is on screen. */
  timedMediaPlaying = false,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapRef = useRef(null)
  const t = useT()

  useEffect(() => {
    if (!menuOpen) return
    const onDown = e => { if (!wrapRef.current?.contains(e.target)) setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  // A video or GIF decides for itself when the slide is over — it advances on
  // ended / after a full loop, never on the timer. Showing "5s" next to a
  // playing video implies it is about to be cut off after five seconds, which
  // is both untrue and alarming.
  const showInterval = !timedMediaPlaying

  return (
    <div ref={wrapRef} className="relative flex items-center gap-1.5">
      <button
        onMouseDown={onToggle}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-[13px] font-medium cursor-pointer"
        style={active
          ? { background: 'color-mix(in srgb, var(--c-accent) 30%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 50%, transparent)' }
          : { background: 'rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.6)', border: '0.5px solid rgba(255,255,255,0.15)' }}
        title={t('Play/Pause slideshow (Space)')}>
        {active ? <Pause size={13} /> : <Play size={13} />}
        <span>{active ? t('Pause') : t('Slideshow')}</span>
      </button>

      {showInterval && (
        <>
          <button
            onMouseDown={() => setMenuOpen(o => !o)}
            className="px-2.5 py-1.5 rounded-[7px] text-[13px] font-medium cursor-pointer"
            style={{ background: 'rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.55)',
                     border: '0.5px solid rgba(255,255,255,0.15)' }}
            title={t('Slideshow speed')}>
            {speed}s
          </button>
          {menuOpen && (
            <div className="absolute top-full right-0 mt-1 rounded-[8px] overflow-hidden shadow-xl z-50"
                 style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.12)' }}>
              {SLIDESHOW_SPEEDS.map(s => (
                <button key={s}
                        onMouseDown={() => { onSpeedChange(s); setMenuOpen(false) }}
                        className="w-full text-left px-4 py-1.5 text-[13px] cursor-pointer hover:bg-[rgba(255,255,255,0.06)]"
                        style={{ color: s === speed ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.6)' }}>
                  {s}s
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

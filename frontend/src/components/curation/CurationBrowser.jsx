import React, { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight, X, Star, ImageIcon, Crown, Play } from 'lucide-react'
import { useT } from '../../i18n'

// Judging a gallery means actually seeing it, so these start large. The choice
// persists — the right size depends on the display, not on the gallery.
// Capped at 440: thumbnails are 640px, so every size renders from a downscale
// and stays sharp without ever touching the multi-megabyte originals.
const SIZES = { L: 440, M: 300, S: 200 }
const SIZE_KEY = 'vault.curation.thumbSize'

/**
 * The "browse it" half of a curation run — a self-contained grid + lightbox.
 *
 * Deliberately NOT the shared ViewerPanel: this lives inside a modal that is
 * itself inside the page, and pulling the global viewer/panel store in here
 * would fight the run for keyboard focus and history.
 */
export default function CurationBrowser({ images = [], coverImageId, onSetCover }) {
  const t = useT()
  const [lightbox, setLightbox] = useState(null)   // index into images
  const [size, setSize] = useState(() => localStorage.getItem(SIZE_KEY) || 'L')

  const pickSize = (k) => { setSize(k); localStorage.setItem(SIZE_KEY, k) }

  const step = useCallback((dir) => {
    setLightbox(i => {
      if (i === null) return null
      const next = i + dir
      if (next < 0 || next >= images.length) return i
      return next
    })
  }, [images.length])

  useEffect(() => {
    if (lightbox === null) return
    const onKey = (e) => {
      // stopPropagation keeps Escape from also closing the whole run — one
      // Escape should back you out one level, not dump you off the gallery.
      if (e.key === 'Escape')      { e.stopPropagation(); setLightbox(null) }
      else if (e.key === 'ArrowRight') { e.stopPropagation(); step(1) }
      else if (e.key === 'ArrowLeft')  { e.stopPropagation(); step(-1) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [lightbox, step])

  if (!images.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3"
           style={{ color: 'rgba(255,255,255,0.3)' }}>
        <ImageIcon size={40} strokeWidth={1} />
        <div style={{ fontSize: 16 }}>{t('This gallery has no files on record.')}</div>
      </div>
    )
  }

  const current = lightbox !== null ? images[lightbox] : null

  return (
    <>
      <div className="flex items-center gap-1.5 px-4 pt-3 flex-shrink-0">
        <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)' }}>{t('Size')}</span>
        {Object.keys(SIZES).map(k => (
          <button key={k} onClick={() => pickSize(k)}
                  className="px-2.5 py-0.5 rounded-full cursor-pointer"
                  style={{
                    fontSize: 16,
                    background: size === k ? 'color-mix(in srgb, var(--c-accent) 20%, transparent)' : 'rgba(255,255,255,0.04)',
                    color: size === k ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.35)',
                    border: `0.5px solid ${size === k ? 'color-mix(in srgb, var(--c-accent) 40%, transparent)' : 'transparent'}`,
                  }}>
            {k}
          </button>
        ))}
        <span className="ml-auto" style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)' }}>
          {images.length} {t('shown')}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid gap-3"
             style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${SIZES[size]}px, 1fr))` }}>
          {images.map((img, idx) => (
            <div key={img.id}
                 onClick={() => setLightbox(idx)}
                 className="relative rounded-[10px] overflow-hidden cursor-pointer group"
                 style={{
                   aspectRatio: '3 / 4',
                   background: 'rgba(255,255,255,0.04)',
                   border: coverImageId === img.id
                     ? '2px solid var(--accent, var(--c-accent))'
                     : '0.5px solid rgba(255,255,255,0.08)',
                 }}>
              {/* Always the thumbnail. Thumbs are 640px / ~41 KB; the originals
                  average 10 MB and reach 35 MB, so serving those to fill a 440px
                  card costs ~250x the bytes for a picture that is then scaled
                  DOWN anyway. Every size here stays under 640, so the thumb is
                  the sharpest useful source. */}
              <img src={img.thumb} alt={img.filename} loading="lazy" decoding="async"
                   className="w-full h-full object-cover"
                   onError={e => { e.target.style.visibility = 'hidden' }} />

              {img.is_video && (
                <div className="absolute top-1.5 left-1.5 rounded-full p-1"
                     style={{ background: 'rgba(0,0,0,0.6)' }}>
                  <Play size={12} color="white" fill="white" />
                </div>
              )}

              {/* Set-cover is the cheapest high-value curation action there is,
                  so it lives one hover away rather than in a submenu. */}
              <button
                onClick={e => { e.stopPropagation(); onSetCover?.(img.id) }}
                title={t('Set as cover')}
                className="absolute top-1.5 right-1.5 rounded-full p-1.5 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                style={{
                  background: coverImageId === img.id ? 'var(--accent, var(--c-accent))' : 'rgba(0,0,0,0.65)',
                  opacity: coverImageId === img.id ? 1 : undefined,
                }}>
                <Crown size={13} color="white" />
              </button>

              {(img.rating > 0 || img.tag_count > 0) && (
                <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 px-2 py-1"
                     style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.8))' }}>
                  {img.rating > 0 && (
                    <span className="flex items-center gap-1" style={{ fontSize: 16, color: 'var(--c-amber-text)' }}>
                      <Star size={12} fill="var(--c-amber-text)" />{img.rating}
                    </span>
                  )}
                  {img.tag_count > 0 && (
                    <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)' }}>
                      {img.tag_count}{t(' tags')}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {current && (
        <div className="fixed inset-0 flex items-center justify-center"
             style={{ background: 'rgba(0,0,0,0.94)', zIndex: 90 }}
             onClick={() => setLightbox(null)}>

          {current.is_video
            ? <video src={`/api/images/${current.id}/file`} controls autoPlay loop
                     onClick={e => e.stopPropagation()}
                     style={{ maxWidth: '92vw', maxHeight: '88vh' }} />
            : <img src={`/api/images/${current.id}/file`} alt={current.filename}
                   onClick={e => e.stopPropagation()}
                   style={{ maxWidth: '92vw', maxHeight: '88vh', objectFit: 'contain' }} />}

          <button onClick={e => { e.stopPropagation(); step(-1) }}
                  disabled={lightbox === 0}
                  className="absolute left-4 rounded-full p-3 cursor-pointer disabled:opacity-20"
                  style={{ background: 'rgba(255,255,255,0.08)' }}>
            <ChevronLeft size={22} color="white" />
          </button>
          <button onClick={e => { e.stopPropagation(); step(1) }}
                  disabled={lightbox === images.length - 1}
                  className="absolute right-4 rounded-full p-3 cursor-pointer disabled:opacity-20"
                  style={{ background: 'rgba(255,255,255,0.08)' }}>
            <ChevronRight size={22} color="white" />
          </button>

          <div className="absolute top-4 left-4 flex items-center gap-3">
            <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)' }}>
              {lightbox + 1} / {images.length}
            </span>
            <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>{current.filename}</span>
          </div>

          <button onClick={e => { e.stopPropagation(); onSetCover?.(current.id) }}
                  className="absolute top-4 right-16 flex items-center gap-2 rounded-full px-4 py-2 cursor-pointer"
                  style={{
                    fontSize: 16,
                    background: coverImageId === current.id ? 'var(--accent, var(--c-accent))' : 'rgba(255,255,255,0.1)',
                    color: 'white',
                  }}>
            <Crown size={15} /> {coverImageId === current.id ? t('Cover') : t('Set cover')}
          </button>

          <button onClick={() => setLightbox(null)}
                  className="absolute top-4 right-4 rounded-full p-2 cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.1)' }}>
            <X size={18} color="white" />
          </button>
        </div>
      )}
    </>
  )
}

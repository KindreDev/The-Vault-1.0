import React, { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react'
import { Play, Pause, ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut, Timer, Zap } from 'lucide-react'
import InlineVideoPlayer from './InlineVideoPlayer'
import { imagesApi } from '../lib/api'
import { isGif, armSlideTimer } from '../lib/gif'
import { useVaultStore } from '../store/vault'

const SPEEDS = [3, 5, 8, 12, 20]

// items: array of { id, filename, is_video, galleryId }
const PanelCell = forwardRef(function PanelCell({
  items, onRemoveItem, panelIndex, isFullscreen = false,
  deviceConnected = false, deviceSynced = false, onToggleDeviceSync,
}, ref) {
  const registerVisible   = useVaultStore(s => s.registerVisible)
  const unregisterVisible = useVaultStore(s => s.unregisterVisible)
  const setFocusedSurface = useVaultStore(s => s.setFocusedSurface)
  const pinSurface        = useVaultStore(s => s.pinSurface)
  const pinnedSurface     = useVaultStore(s => s.pinnedSurface)

  const [idx, setIdx]             = useState(0)
  const [playing, setPlaying]     = useState(true)
  const [speed, setSpeed]         = useState(8)
  const [showSpeed, setShowSpeed] = useState(false)
  const [zoom, setZoom]           = useState(1)
  const [pan, setPan]             = useState({ x: 0, y: 0 })
  const [dragging, setDragging]   = useState(false)
  const [hovered, setHovered]     = useState(false)
  const [showControls, setShowControls] = useState(true)
  const dragStart        = useRef({ x: 0, y: 0 })
  const stageRef         = useRef(null)
  const speedRef         = useRef(null)
  const containerRef     = useRef(null)
  const controlsTimer    = useRef(null)
  const isFullscreenRef  = useRef(false)
  const videoRef         = useRef(null)

  const item = items[idx] ?? null
  const viewStartRef = useRef(null)
  const hasScript = !!(item?.is_video && item?.funscript_path)

  // Clamp idx when items shrink
  useEffect(() => {
    if (idx >= items.length && items.length > 0) setIdx(items.length - 1)
  }, [items.length])

  // Register what this panel is showing so Edge Mode credits every visible
  // image, not just the one in the main viewer.
  const surfaceKey = `panel-${panelIndex}`
  useEffect(() => {
    if (item?.id) registerVisible(surfaceKey, item.id)
  }, [item?.id, surfaceKey, registerVisible])
  useEffect(() => () => unregisterVisible(surfaceKey), [surfaceKey, unregisterVisible])

  // Track view count and time spent whenever the displayed item changes
  useEffect(() => {
    if (!item) return
    imagesApi.view(item.id).catch(() => {})
    viewStartRef.current = Date.now()
    return () => {
      if (viewStartRef.current) {
        const secs = Math.round((Date.now() - viewStartRef.current) / 1000)
        // Matches the view-count threshold — see the note in GalleryView.
        if (secs >= 1) imagesApi.logDuration(item.id, secs).catch(() => {})
        viewStartRef.current = null
      }
    }
  }, [item?.id])

  // Slideshow auto-advance (skip videos — they auto-loop).
  // Animated GIFs are held for at least one full loop instead of being cut off
  // at the slide speed; GIFs expose no duration to the DOM, so it's read from
  // the file itself.
  useEffect(() => {
    if (!playing || !item || item.is_video || items.length <= 1) return

    return armSlideTimer({
      url: `/api/images/${item.id}/file`,
      animated: isGif(item.filename || item.file_path),
      baseSecs: speed,
      onFire: () => setIdx(i => (i + 1) % items.length),
    })
  }, [playing, speed, items.length, item])

  const prev = () => { setIdx(i => (i - 1 + items.length) % items.length) }
  const next = () => { setIdx(i => (i + 1) % items.length) }
  const resetZoom = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])

  // What the panel wall's keyboard drives. MultiPanel holds one of these per
  // panel and routes keys to the pinned one — or to every one at once, which
  // is what makes refreshing the whole wall a single keystroke.
  useImperativeHandle(ref, () => ({
    next, prev,
    shuffle: () => {
      if (items.length < 2) return
      setIdx(i => { let n = i; while (n === i) n = Math.floor(Math.random() * items.length); return n })
    },
    setPlaying: (v) => setPlaying(v),
    togglePlay: () => {
      // On a video the play key belongs to the video; on photos it belongs to
      // this panel's slideshow.
      if (item?.is_video) videoRef.current?.togglePlay()
      else setPlaying(p => !p)
    },
    zoomBy: (f) => setZoom(z => { const n = Math.min(Math.max(z * f, 1), 8); if (n === 1) setPan({ x: 0, y: 0 }); return n }),
    resetZoom,
    isPlaying: () => playing,
    isVideo:   () => !!item?.is_video,
    hasScript: () => hasScript,
    getPlayer: () => videoRef.current,
    getItem:   () => item,
  }))

  // Wheel zoom — capture:true fires BEFORE any ancestor scroll handler,
  // passive:false allows preventDefault() to actually suppress scroll.
  //
  // Depends on hasItems because an empty panel renders a placeholder that never
  // attaches containerRef. Without this the effect would run once against a null
  // ref and never re-run, leaving wheel zoom permanently dead on any panel that
  // started empty and got content later (per-panel playlists do exactly that).
  const hasItems = items.length > 0
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e) => {
      if (!el.contains(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15
      setZoom(z => { const n = Math.min(Math.max(z * f, 1), 8); if (n === 1) setPan({ x: 0, y: 0 }); return n })
    }
    el.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => el.removeEventListener('wheel', onWheel, { capture: true })
  }, [hasItems])

  // Outside-click for speed menu
  useEffect(() => {
    const h = (e) => { if (speedRef.current && !speedRef.current.contains(e.target)) setShowSpeed(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // Keep ref in sync with prop so mouse handler never uses a stale closure
  useEffect(() => {
    isFullscreenRef.current = isFullscreen
    clearTimeout(controlsTimer.current)
    if (isFullscreen) setShowControls(false)
    else setShowControls(true)
  }, [isFullscreen])

  const handleMouseDown = (e) => {
    if (zoom <= 1) return
    e.preventDefault()
    setDragging(true)
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }
  const handleMouseMove = (e) => {
    if (dragging) setPan({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y })
    if (!isFullscreenRef.current) return
    setShowControls(true)
    clearTimeout(controlsTimer.current)
    controlsTimer.current = setTimeout(() => setShowControls(false), 2000)
  }
  const handleMouseUp = () => setDragging(false)

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-full"
           style={{ background: '#0a0a0a', border: '0.5px solid rgba(255,255,255,0.06)' }}>
        <div className="text-center">
          <div className="text-[rgba(255,255,255,0.15)] text-[11px] mb-1">Panel {panelIndex + 1}</div>
          <div className="text-[rgba(255,255,255,0.08)] text-[10px]">No media assigned</div>
        </div>
      </div>
    )
  }

  const isPinned = pinnedSurface === surfaceKey

  return (
    <div ref={containerRef}
         className="relative overflow-hidden h-full"
         style={{
           background: '#060606',
           // The focus ring is drawn inset so it can't shift the grid layout by
           // a pixel when it appears — the whole wall twitching every time you
           // pin a different panel would be maddening.
           boxShadow: isPinned
             ? 'inset 0 0 0 2px var(--c-accent, var(--c-accent)), 0 0 18px -4px var(--c-accent, var(--c-accent))'
             : 'none',
           transition: 'box-shadow 0.15s ease',
         }}
         // Click pins this panel: the ring stays and every hotkey targets it
         // until another is pinned. Capture phase so it still registers when a
         // child button swallows the event.
         onMouseDownCapture={() => pinSurface(surfaceKey)}
         onMouseEnter={() => { setHovered(true); setFocusedSurface(surfaceKey) }}
         onMouseLeave={() => { setHovered(false); setDragging(false) }}>

      {/* Stage */}
      <div ref={stageRef}
           className="w-full h-full flex items-center justify-center select-none"
           style={{ cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default' }}
           onMouseDown={handleMouseDown}
           onMouseMove={handleMouseMove}
           onMouseUp={handleMouseUp}
           onMouseLeave={handleMouseUp}
           onDoubleClick={() => { setZoom(z => { const n = z > 1 ? 1 : 2.5; if (n === 1) setPan({ x: 0, y: 0 }); return n }) }}>

        {item?.is_video ? (
          <InlineVideoPlayer
            key={item.id}
            ref={videoRef}
            src={`/api/images/${item.id}/file`}
            imageId={item.id}
            funscriptPath={item.funscript_path ?? null}
            deviceSync={deviceSynced}
            videoZoom={zoom}
            videoPan={pan}
            onEnded={playing && items.length > 1 ? next : undefined}
            isFullscreen={isFullscreen}
            showControls={showControls}
          />
        ) : item ? (
          <img
            key={item.id}
            src={`/api/images/${item.id}/file`}
            alt={item.filename}
            draggable={false}
            className="media-fade-in"
            style={{
              maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              transition: dragging ? 'none' : 'transform 0.12s ease',
              userSelect: 'none',
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          />
        ) : null}
      </div>

      {/* Overlay controls — visible on hover */}
      {hovered && (
        <>
          {/* Top bar */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-2 py-1.5 z-20"
               style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)' }}>
            <div className="flex items-center gap-1.5">
              {/* Device sync — the connected toy can only follow one video at a
                  time, so this claims it for this panel and releases any other. */}
              {deviceConnected && (
                <button onMouseDown={(e) => { e.stopPropagation(); onToggleDeviceSync?.() }}
                        title={deviceSynced
                          ? 'Device is following this panel — click to release'
                          : (hasScript ? 'Sync device to this panel' : 'Sync device to this panel (current file has no script)')}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded-full cursor-pointer flex-shrink-0"
                        style={deviceSynced
                          ? { background: 'color-mix(in srgb, var(--c-pink) 28%, transparent)', color: '#F4C0D1', border: '0.5px solid color-mix(in srgb, var(--c-pink) 55%, transparent)' }
                          : { background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.4)', border: '0.5px solid rgba(255,255,255,0.12)' }}>
                  <Zap size={10} />
                  <span className="text-[13px] leading-none">{deviceSynced ? 'Synced' : 'Sync'}</span>
                </button>
              )}
              <span className="text-[9px] text-[rgba(255,255,255,0.4)] truncate max-w-[120px]">
                {item?.filename ?? ''}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {/* Zoom slider */}
              <button onMouseDown={(e) => { e.stopPropagation(); resetZoom() }}
                      className="cursor-pointer p-0.5 flex-shrink-0"
                      style={{ color: zoom > 1 ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.3)' }}>
                <ZoomOut size={11} />
              </button>
              <input
                type="range" min={1} max={4} step={0.05}
                value={zoom}
                onMouseDown={e => e.stopPropagation()}
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  setZoom(v)
                  if (v === 1) setPan({ x: 0, y: 0 })
                }}
                className="cursor-pointer"
                style={{ width: 60, height: 3, accentColor: 'var(--c-accent)' }}
              />
              <button onMouseDown={(e) => { e.stopPropagation(); setZoom(z => Math.min(z * 1.4, 4)) }}
                      className="cursor-pointer p-0.5 flex-shrink-0"
                      style={{ color: 'rgba(255,255,255,0.45)' }}>
                <ZoomIn size={11} />
              </button>
              <span className="text-[9px] tabular-nums w-7 text-right flex-shrink-0"
                    style={{ color: zoom > 1 ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.3)' }}>
                {zoom.toFixed(1)}×
              </span>
              {/* Remove current item */}
              <button onMouseDown={(e) => { e.stopPropagation(); onRemoveItem(item.id) }}
                      className="cursor-pointer text-[rgba(255,255,255,0.35)] hover:text-[#F4C0D1] p-0.5 ml-0.5">
                <X size={11} />
              </button>
            </div>
          </div>

          {/* Left / right nav arrows */}
          {items.length > 1 && (
            <>
              <button onMouseDown={(e) => { e.stopPropagation(); prev() }}
                      className="absolute left-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer z-20"
                      style={{ background: 'rgba(0,0,0,0.55)', border: '0.5px solid rgba(255,255,255,0.15)' }}>
                <ChevronLeft size={14} />
              </button>
              <button onMouseDown={(e) => { e.stopPropagation(); next() }}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer z-20"
                      style={{ background: 'rgba(0,0,0,0.55)', border: '0.5px solid rgba(255,255,255,0.15)' }}>
                <ChevronRight size={14} />
              </button>
            </>
          )}

          {/* Bottom controls */}
          <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1.5 px-2 py-1.5 z-20"
               style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.75), transparent)' }}>

            {/* Item counter */}
            <span className="text-[13px] text-[rgba(255,255,255,0.4)] tabular-nums">
              {idx + 1}/{items.length}
            </span>

            {/* Play/pause slideshow */}
            {!item?.is_video && items.length > 1 && (
              <button onMouseDown={(e) => { e.stopPropagation(); setPlaying(p => !p) }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[13px] cursor-pointer"
                      style={playing
                        ? { background: 'color-mix(in srgb, var(--c-accent) 30%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 50%, transparent)' }
                        : { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }}>
                {playing ? <Pause size={14} /> : <Play size={14} />}
                <span>{playing ? 'Pause' : 'Play'}</span>
              </button>
            )}

            {/* Speed picker */}
            {!item?.is_video && items.length > 1 && (
              <div ref={speedRef} className="relative">
                <button onMouseDown={(e) => { e.stopPropagation(); setShowSpeed(s => !s) }}
                        className="flex items-center gap-0.5 px-2.5 py-1 rounded-full text-[13px] cursor-pointer"
                        style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.45)' }}>
                  <Timer size={14} />{speed}s
                </button>
                {showSpeed && (
                  <div className="absolute bottom-full mb-1 left-0 rounded-[7px] overflow-hidden shadow-xl z-30"
                       style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.12)', minWidth: 52 }}>
                    {SPEEDS.map(s => (
                      <button key={s}
                              onMouseDown={(e) => { e.stopPropagation(); setSpeed(s); setShowSpeed(false) }}
                              className="w-full text-left px-2.5 py-1 text-[14px] cursor-pointer hover:bg-[rgba(255,255,255,0.06)]"
                              style={{ color: s === speed ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.6)' }}>
                        {s}s
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Filmstrip dots */}
            {items.length > 1 && items.length <= 12 && (
              <div className="flex gap-0.5 ml-auto flex-wrap justify-end max-w-[80px]">
                {items.map((_, i) => (
                  <button key={i} onMouseDown={(e) => { e.stopPropagation(); setIdx(i) }}
                          className="rounded-full cursor-pointer transition-all"
                          style={{ width: 5, height: 5, background: i === idx ? 'var(--c-accent)' : 'rgba(255,255,255,0.2)' }} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Device-sync marker stays visible unhovered, so it's obvious at a glance
          which panel is driving the toy mid-session. */}
      {!hovered && deviceSynced && (
        <div className="absolute top-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full z-10 pointer-events-none"
             style={{ background: 'color-mix(in srgb, var(--c-pink) 85%, transparent)', color: '#fff' }}>
          <Zap size={9} />
          <span className="text-[13px] leading-none">{hasScript ? 'Synced' : 'No script'}</span>
        </div>
      )}

      {/* Always-visible item count badge (when not hovered) */}
      {!hovered && items.length > 1 && (
        <div className="absolute bottom-1.5 right-1.5 text-[8px] tabular-nums px-1.5 py-0.5 rounded-full z-10"
             style={{ background: 'rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.35)' }}>
          {idx + 1}/{items.length}
        </div>
      )}

      {/* Slideshow progress bar */}
      {playing && !item?.is_video && items.length > 1 && (
        <SlideshowProgress key={`${idx}-${speed}-${playing}`} duration={speed} />
      )}
    </div>
  )
})

export default PanelCell

function SlideshowProgress({ duration }) {
  return (
    <div className="absolute bottom-0 left-0 right-0 h-[2px] z-30 overflow-hidden"
         style={{ background: 'rgba(255,255,255,0.06)' }}>
      <div className="h-full rounded-full"
           style={{
             background: 'var(--c-accent)',
             animation: `panel-progress ${duration}s linear forwards`,
           }} />
    </div>
  )
}

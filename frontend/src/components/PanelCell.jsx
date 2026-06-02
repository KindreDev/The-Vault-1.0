import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Play, Pause, ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut, Timer } from 'lucide-react'
import InlineVideoPlayer from './InlineVideoPlayer'
import { imagesApi } from '../lib/api'

const SPEEDS = [3, 5, 8, 12, 20]

// items: array of { id, filename, is_video, galleryId }
export default function PanelCell({ items, onRemoveItem, panelIndex, isFullscreen = false }) {
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

  const item = items[idx] ?? null
  const viewStartRef = useRef(null)

  // Clamp idx when items shrink
  useEffect(() => {
    if (idx >= items.length && items.length > 0) setIdx(items.length - 1)
  }, [items.length])

  // Track view count and time spent whenever the displayed item changes
  useEffect(() => {
    if (!item) return
    imagesApi.view(item.id).catch(() => {})
    viewStartRef.current = Date.now()
    return () => {
      if (viewStartRef.current) {
        const secs = Math.round((Date.now() - viewStartRef.current) / 1000)
        if (secs >= 2) imagesApi.logDuration(item.id, secs).catch(() => {})
        viewStartRef.current = null
      }
    }
  }, [item?.id])

  // Slideshow auto-advance (skip videos — they auto-loop)
  useEffect(() => {
    if (!playing || !item || item.is_video || items.length <= 1) return
    const id = setInterval(() => setIdx(i => (i + 1) % items.length), speed * 1000)
    return () => clearInterval(id)
  }, [playing, speed, items.length, item])

  const prev = () => { setIdx(i => (i - 1 + items.length) % items.length) }
  const next = () => { setIdx(i => (i + 1) % items.length) }
  const resetZoom = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])

  // Wheel zoom — capture:true fires BEFORE any ancestor scroll handler,
  // passive:false allows preventDefault() to actually suppress scroll.
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
  }, [])

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

  return (
    <div ref={containerRef}
         className="relative overflow-hidden h-full"
         style={{ background: '#060606' }}
         onMouseEnter={() => setHovered(true)}
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
            src={`/api/images/${item.id}/file`}
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
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-[rgba(255,255,255,0.4)] truncate max-w-[120px]">
                {item?.filename ?? ''}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {/* Zoom slider */}
              <button onMouseDown={(e) => { e.stopPropagation(); resetZoom() }}
                      className="cursor-pointer p-0.5 flex-shrink-0"
                      style={{ color: zoom > 1 ? '#CECBF6' : 'rgba(255,255,255,0.3)' }}>
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
                style={{ width: 60, height: 3, accentColor: '#7F77DD' }}
              />
              <button onMouseDown={(e) => { e.stopPropagation(); setZoom(z => Math.min(z * 1.4, 4)) }}
                      className="cursor-pointer p-0.5 flex-shrink-0"
                      style={{ color: 'rgba(255,255,255,0.45)' }}>
                <ZoomIn size={11} />
              </button>
              <span className="text-[9px] tabular-nums w-7 text-right flex-shrink-0"
                    style={{ color: zoom > 1 ? '#CECBF6' : 'rgba(255,255,255,0.3)' }}>
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
            <span className="text-[9px] text-[rgba(255,255,255,0.4)] tabular-nums">
              {idx + 1}/{items.length}
            </span>

            {/* Play/pause slideshow */}
            {!item?.is_video && items.length > 1 && (
              <button onMouseDown={(e) => { e.stopPropagation(); setPlaying(p => !p) }}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] cursor-pointer"
                      style={playing
                        ? { background: 'rgba(127,119,221,0.3)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.5)' }
                        : { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }}>
                {playing ? <Pause size={9} /> : <Play size={9} />}
                <span>{playing ? 'Pause' : 'Play'}</span>
              </button>
            )}

            {/* Speed picker */}
            {!item?.is_video && items.length > 1 && (
              <div ref={speedRef} className="relative">
                <button onMouseDown={(e) => { e.stopPropagation(); setShowSpeed(s => !s) }}
                        className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] cursor-pointer"
                        style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.45)' }}>
                  <Timer size={9} />{speed}s
                </button>
                {showSpeed && (
                  <div className="absolute bottom-full mb-1 left-0 rounded-[7px] overflow-hidden shadow-xl z-30"
                       style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.12)', minWidth: 52 }}>
                    {SPEEDS.map(s => (
                      <button key={s}
                              onMouseDown={(e) => { e.stopPropagation(); setSpeed(s); setShowSpeed(false) }}
                              className="w-full text-left px-2.5 py-1 text-[10px] cursor-pointer hover:bg-[rgba(255,255,255,0.06)]"
                              style={{ color: s === speed ? '#CECBF6' : 'rgba(255,255,255,0.6)' }}>
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
                          style={{ width: 5, height: 5, background: i === idx ? '#7F77DD' : 'rgba(255,255,255,0.2)' }} />
                ))}
              </div>
            )}
          </div>
        </>
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
}

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

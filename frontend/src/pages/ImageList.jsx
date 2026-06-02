import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Search, X, ChevronLeft, ChevronRight, Droplets, Heart,
  ZoomIn, ZoomOut, Maximize, Minimize, Images as ImagesIcon,
  ChevronDown, ExternalLink, Tag, Play, Pause,
  ChevronsLeft, ChevronsRight, LayoutGrid, Star,
  CheckSquare, Square, UserPlus, Check, Trash2, LayoutTemplate, GripHorizontal,
  FolderOpen, Zap,
} from 'lucide-react'
import { imagesApi, creatorsApi, galleriesApi, sessionsApi } from '../lib/api'
import { useVaultStore } from '../store/vault'
import toast from 'react-hot-toast'
import { TagPanel, CreatorPanel, TransferPanel } from '../components/ViewerPanel'
import TagFilterInput from '../components/TagFilterInput'
import InlineVideoPlayer from '../components/InlineVideoPlayer'
import DeviceControls from '../components/DeviceControls'
import { SortDropdown } from '../components/SortDropdown'

const TYPE_COLORS = {
  cosplayer: '#9FE1CB', ethot: '#ED93B1', artist: '#CECBF6',
  character: '#FAC775', actress: '#ED93B1', custom: '#D3D1C7',
}

const SORTS = [
  { value: 'filename',   label: 'Filename' },
  { value: 'date_added', label: 'Date Added' },
  { value: 'view_count', label: 'Most Viewed' },
  { value: 'cum_count',  label: 'Most Cummed' },
  { value: 'rating',     label: 'Rating' },
  { value: 'file_size',  label: 'File Size' },
  { value: 'random',     label: 'Random' },
]

const SLIDESHOW_SPEEDS = [3, 5, 8, 12]

// ── Thumbnail ──────────────────────────────────────────────────────────────────
function ImageThumb({ image, onClick, bulkMode, selected, onSelect, masonry = false }) {
  const [failed, setFailed] = useState(false)
  const [hoverVideo, setHoverVideo] = useState(false)
  const videoRef = useRef(null)
  const hoverTimerRef = useRef(null)
  const addToMultiViewer = useVaultStore(s => s.addToMultiViewer)
  const queue = useVaultStore(s => s.multiViewerQueue)
  const MAX = useVaultStore(s => s.MULTIVIEWER_MAX)
  const inQueue = queue.some(q => q.id === `img-${image.id}`)

  const handleSendToViewer = (e) => {
    e.stopPropagation()
    if (queue.length >= MAX) { toast.error(`Multi-viewer full (${MAX}/${MAX})`); return }
    const ok = addToMultiViewer({ id: `img-${image.id}`, type: 'image', media: image })
    if (ok) toast.success('Sent to multi-viewer')
    else toast('Already in multi-viewer', { icon: '✓' })
  }

  const handleMouseEnter = useCallback(() => {
    if (!image.is_video) return
    setHoverVideo(true)
    hoverTimerRef.current = setTimeout(() => setHoverVideo(false), 15000)
  }, [image.is_video])

  const handleMouseLeave = useCallback(() => {
    if (!image.is_video) return
    clearTimeout(hoverTimerRef.current)
    setHoverVideo(false)
  }, [image.is_video])

  useEffect(() => {
    return () => {
      const vid = videoRef.current
      if (!vid) return
      vid.pause()
      vid.removeAttribute('src')
      vid.load()
    }
  }, [])

  useEffect(() => {
    const vid = videoRef.current
    if (!vid) return
    if (hoverVideo) {
      vid.src = `/api/images/${image.id}/file`
      const seekAndPlay = () => {
        if (vid.duration && !isNaN(vid.duration)) vid.currentTime = vid.duration * 0.5
        vid.play().catch(() => {})
      }
      if (vid.readyState >= 1) seekAndPlay()
      else { vid.load(); vid.addEventListener('loadedmetadata', seekAndPlay, { once: true }) }
    } else {
      vid.pause()
      vid.removeAttribute('src')
      vid.load()
    }
    return () => clearTimeout(hoverTimerRef.current)
  }, [hoverVideo, image.id])

  return (
    <div onClick={bulkMode ? () => onSelect(image.id) : onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="relative rounded-[8px] overflow-hidden cursor-pointer group animate-fade-in"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: `0.5px solid ${inQueue ? 'rgba(127,119,221,0.5)' : 'rgba(255,255,255,0.07)'}`,
        // In masonry mode use the image's real aspect ratio; otherwise force 1:1
        aspectRatio: masonry && image.width && image.height
          ? `${image.width} / ${image.height}`
          : '1'
      }}>

      {bulkMode && (
        <div className="absolute top-2 left-2 z-[20]"
          onClick={e => { e.stopPropagation(); onSelect(image.id) }}>
          {selected
            ? <CheckSquare size={16} style={{ color: '#7F77DD' }} />
            : <Square size={16} style={{ color: 'rgba(255,255,255,0.5)', fill: 'rgba(0,0,0,0.4)' }} />
          }
        </div>
      )}
      {selected && (
        <div className="absolute inset-0 z-10 pointer-events-none rounded-[8px]"
          style={{ border: '2px solid #7F77DD', background: 'rgba(127,119,221,0.15)' }} />
      )}

      {/* Static thumbnail */}
      {!failed
        ? <img src={`/api/images/${image.id}/thumb`} alt={image.filename}
          className="w-full h-full object-cover transition-transform duration-200"
          style={{ objectPosition: 'center top', transform: hoverVideo ? 'scale(1)' : undefined }}
          onError={() => setFailed(true)} />
        : <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-2">
          <ImagesIcon size={20} style={{ color: 'rgba(255,255,255,0.1)' }} />
          <div className="text-[10px] text-[rgba(255,255,255,0.2)] text-center truncate w-full">{image.filename}</div>
        </div>
      }

      {/* Video hover preview */}
      {image.is_video && (
        <video
          ref={videoRef}
          muted
          playsInline
          preload="none"
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-200"
          style={{ opacity: hoverVideo ? 1 : 0, zIndex: 2, pointerEvents: 'none' }}
        />
      )}

      {/* Video play icon (when not hovering) */}
      {image.is_video && !hoverVideo && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 1 }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.55)', border: '0.5px solid rgba(255,255,255,0.2)' }}>
            <Play size={11} fill="white" style={{ color: 'white', marginLeft: 1 }} />
          </div>
        </div>
      )}

      {/* Funscripted badge */}
      {image.funscript_path && (
        <div className="absolute top-1 left-1 text-[10px] font-bold px-1 py-0.5 rounded"
          style={{ background: 'rgba(127,119,221,0.85)', color: '#fff', zIndex: 4, letterSpacing: '0.05em' }}>
          FS
        </div>
      )}

      {image.cum_count > 0 && (
        <div className="absolute bottom-1 right-1 flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded-full"
          style={{ background: 'rgba(0,0,0,0.75)', color: '#ED93B1', zIndex: 3 }}>
          <Droplets size={8} /> {image.cum_count}
        </div>
      )}
      {image.creators?.length > 0 && (
        <div className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded-full truncate max-w-[80%]"
          style={{ background: 'rgba(0,0,0,0.75)', color: TYPE_COLORS[image.creators[0].creator_type] || '#D3D1C7', zIndex: 3 }}>
          {image.creators[0].name}
        </div>
      )}

      {/* Send to multi-viewer */}
      <button
        onMouseDown={handleSendToViewer}
        title="Send to multi-viewer"
        className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center cursor-pointer z-10"
        style={inQueue
          ? { background: 'rgba(127,119,221,0.7)', opacity: 1 }
          : { background: 'rgba(0,0,0,0.6)', opacity: 0, transition: 'opacity 0.15s' }
        }
        onMouseEnter={e => { if (!inQueue) e.currentTarget.style.opacity = '1' }}
        onMouseLeave={e => { if (!inQueue) e.currentTarget.style.opacity = '0' }}>
        <LayoutGrid size={9} color="#fff" />
      </button>
    </div>
  )
}



// ── Full-screen image viewer ───────────────────────────────────────────────────
function ImageViewer({ images, startIdx, onClose }) {
  const navigate = useNavigate()
  const [idx, setIdx] = useState(startIdx)
  const [fullLoaded, setFullLoaded] = useState(false)
  const [rating, setRating] = useState(0)
  const [isFavorite, setIsFavorite] = useState(false)
  const [cumCount, setCumCount] = useState(null)
  const [liveViewCount, setLiveViewCount] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showFilmstrip, setShowFilmstrip] = useState(true)
  const [slideshowActive, setSlideshowActive] = useState(false)
  const [slideshowSpeed, setSlideshowSpeed] = useState(5)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const [localTags, setLocalTags] = useState([])
  const [localCreators, setLocalCreators] = useState([])
  const [localFunscript, setLocalFunscript] = useState(null)

  const dragStart         = useRef({ x: 0, y: 0 })
  const stageRef          = useRef(null)
  const viewerRef         = useRef(null)
  const filmstripTimer    = useRef(null)
  const isFullscreenRef   = useRef(false)
  const funscriptInputRef = useRef(null)
  const sessionActive = useVaultStore(s => s.sessionActive)
  const startSession = useVaultStore(s => s.startSession)
  const endSession = useVaultStore(s => s.endSession)
  const addXpToast = useVaultStore(s => s.addXpToast)
  const qc = useQueryClient()

  const image = images[idx]

  useEffect(() => {
    if (!image) return
    setRating(image.rating || 0)
    setIsFavorite(image.is_favorite ?? false)
    setCumCount(image.cum_count ?? 0)
    setLocalTags(image.tags ?? [])
    setLocalCreators(image.creators ?? [])
    setLiveViewCount(null)
    if (!image.is_video) {
      imagesApi.view(image.id).then(r => setLiveViewCount(r.data.view_count)).catch(() => { })
    }
  }, [idx, image?.id])

  const resetZoom = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])
  useEffect(() => { resetZoom() }, [idx])
  useEffect(() => { setLocalFunscript(null) }, [idx])
  // Reset LQIP state whenever the image changes
  useEffect(() => { setFullLoaded(false) }, [idx])

  // Fullscreen management
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) { viewerRef.current?.requestFullscreen() }
    else { document.exitFullscreen() }
  }, [])
  useEffect(() => {
    const h = () => {
      const fs = !!document.fullscreenElement
      isFullscreenRef.current = fs
      setIsFullscreen(fs)
      clearTimeout(filmstripTimer.current)
      if (fs) setShowFilmstrip(false)
      else setShowFilmstrip(true)
    }
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, [])

  // Filmstrip auto-hide on mouse idle in fullscreen
  const handleMouseMove = useCallback(() => {
    if (!isFullscreenRef.current) return
    setShowFilmstrip(true)
    clearTimeout(filmstripTimer.current)
    filmstripTimer.current = setTimeout(() => setShowFilmstrip(false), 2000)
  }, [])

  // Slideshow
  useEffect(() => {
    if (!slideshowActive) return
    const id = setInterval(() => setIdx(i => (i + 1) % images.length), slideshowSpeed * 1000)
    return () => clearInterval(id)
  }, [slideshowActive, slideshowSpeed, images.length])

  // Keyboard nav
  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') { if (zoom > 1) resetZoom(); else onClose(); return }
      if (e.key === 'ArrowLeft') setIdx(i => Math.max(0, i - 1))
      if (e.key === 'ArrowRight') setIdx(i => Math.min(images.length - 1, i + 1))
      if (e.key === ' ') { e.preventDefault(); setSlideshowActive(a => !a) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [images.length, onClose, zoom, resetZoom])

  // Scroll-to-zoom (non-passive)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15
      setZoom(z => { const n = Math.min(Math.max(z * f, 1), 8); if (n === 1) setPan({ x: 0, y: 0 }); return n })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const handleMouseDown = (e) => {
    if (zoom <= 1) return
    e.preventDefault(); setDragging(true)
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }
  const handlePanMove = (e) => { if (!dragging) return; setPan({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y }) }
  const handlePanEnd = () => setDragging(false)

  const cumMutation = useMutation({
    mutationFn: () => imagesApi.cum(image.id, { gallery_id: image.gallery_id }),
    onSuccess: () => { setCumCount(c => c + 1); addXpToast('+5 XP'); qc.invalidateQueries({ queryKey: ['images'] }) }
  })
  const rateMutation = useMutation({
    mutationFn: (r) => imagesApi.update(image.id, { rating: r }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['images'] })
  })
  const favMutation = useMutation({
    mutationFn: (val) => imagesApi.update(image.id, { is_favorite: val }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['images'] })
  })
  const sessionMutation = useMutation({
    mutationFn: (data = {}) => sessionsApi.log({ image_id: image.id, gallery_id: image.gallery_id, ...data }).then(r => r.data),
    onSuccess: (data) => { addXpToast(`+${data.xp_earned} XP`); toast.success('Session logged ❤️') }
  })

  if (!image) return null
  const isZoomed = zoom > 1

  return (
    <div ref={viewerRef} className="fixed inset-0 z-50 flex" style={{ background: '#090909' }}
      onMouseMove={handleMouseMove}>

      {/* ── Main stage ─────────────────────────────────────────────────── */}
      <div className="flex-1 relative min-w-0">
        {/* Topbar — absolute overlay, fades out in fullscreen when mouse idle */}
        <div className="flex items-center gap-2 px-4 h-11 z-20"
          style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.82) 0%, transparent 100%)',
            opacity: isFullscreen && !showFilmstrip ? 0 : 1,
            pointerEvents: isFullscreen && !showFilmstrip ? 'none' : 'auto',
            transition: 'opacity 0.25s ease',
          }}>
          <button type="button" onMouseDown={onClose} className="cursor-pointer text-[rgba(255,255,255,0.4)] hover:text-white"><X size={16} /></button>
          <span className="text-[13px] text-[rgba(255,255,255,0.4)]">{idx + 1} / {images.length}</span>
          <span className="text-[13px] text-[rgba(255,255,255,0.55)] truncate flex-1">{image.filename}</span>

          {/* Quick favorite star */}
          <button type="button"
            onMouseDown={() => { const next = !isFavorite; setIsFavorite(next); favMutation.mutate(next) }}
            className="cursor-pointer p-1 rounded transition-colors"
            style={{ color: isFavorite ? '#EF9F27' : 'rgba(255,255,255,0.3)' }}
            title={isFavorite ? 'Remove favorite' : 'Favorite (5★)'}>
            <Star size={14} fill={isFavorite ? '#EF9F27' : 'none'} />
          </button>

          {/* Slideshow controls */}
          <div className="flex items-center gap-1 relative">
            <button type="button" onMouseDown={() => setSlideshowActive(a => !a)}
              className="cursor-pointer p-1 rounded text-[rgba(255,255,255,0.4)] hover:text-white"
              title="Play/pause slideshow (Space)">
              {slideshowActive ? <Pause size={13} /> : <Play size={13} />}
            </button>
            <button type="button" onMouseDown={() => setShowSpeedMenu(s => !s)}
              className="cursor-pointer text-[11px] px-1.5 py-0.5 rounded-full"
              style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)' }}
              title="Slideshow speed">
              {slideshowSpeed}s
            </button>
            {showSpeedMenu && (
              <div className="absolute top-full right-0 mt-1 rounded-[8px] overflow-hidden z-20 shadow-xl"
                style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.12)' }}>
                {SLIDESHOW_SPEEDS.map(s => (
                  <button key={s} type="button"
                    onMouseDown={() => { setSlideshowSpeed(s); setShowSpeedMenu(false) }}
                    className="block w-full text-left px-3 py-1.5 text-[13px] cursor-pointer hover:bg-[rgba(255,255,255,0.07)]"
                    style={{ color: s === slideshowSpeed ? '#CECBF6' : 'rgba(255,255,255,0.6)' }}>
                    {s}s
                  </button>
                ))}
              </div>
            )}
          </div>

          {isZoomed && (
            <span className="text-[12px] px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(127,119,221,0.2)', color: '#AFA9EC', border: '0.5px solid rgba(127,119,221,0.3)' }}>
              {Math.round(zoom * 100)}%
            </span>
          )}
          <button type="button" onMouseDown={() => setZoom(z => Math.min(z * 1.4, 8))} className="cursor-pointer text-[rgba(255,255,255,0.35)] hover:text-white p-1 rounded"><ZoomIn size={14} /></button>
          <button type="button" onMouseDown={resetZoom} className="cursor-pointer text-[rgba(255,255,255,0.35)] hover:text-white p-1 rounded"><ZoomOut size={14} /></button>
          <button type="button" onMouseDown={toggleFullscreen} className="cursor-pointer text-[rgba(255,255,255,0.35)] hover:text-white p-1 rounded">
            {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
          </button>
        </div>

        {/* Stage — fills the entire content area */}
        <div ref={stageRef}
          className="absolute inset-0 overflow-hidden select-none"
          style={{
            background: '#060606',
            cursor: image.is_video
              ? (isZoomed ? (dragging ? 'grabbing' : 'grab') : 'crosshair')
              : (isZoomed ? (dragging ? 'grabbing' : 'grab') : 'zoom-in'),
          }}
          onMouseDown={handleMouseDown} onMouseMove={handlePanMove}
          onMouseUp={handlePanEnd} onMouseLeave={handlePanEnd}
          onDoubleClick={!image.is_video && isZoomed ? resetZoom : undefined}>

          {image.is_video ? (
            <InlineVideoPlayer
              key={image.id}
              src={`/api/images/${image.id}/file`}
              imageId={image.id}
              funscriptPath={image.funscript_path}
              overrideFunscript={localFunscript}
              onViewTracked={() => imagesApi.view(image.id).then(r => setLiveViewCount(r.data.view_count)).catch(() => { })}
              videoZoom={zoom}
              videoPan={pan}
              isFullscreen={isFullscreen}
              showControls={showFilmstrip}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
              {/* LQIP — blurred 320px thumbnail shown while full image loads */}
              {!fullLoaded && (
                <img
                  data-no-fade
                  src={`/api/images/${image.id}/thumb`}
                  alt=""
                  draggable={false}
                  aria-hidden="true"
                  style={{
                    position: 'absolute', inset: 0, width: '100%', height: '100%',
                    objectFit: 'contain',
                    filter: 'blur(28px)',
                    transform: 'scale(1.08)',
                    opacity: 1,
                    pointerEvents: 'none',
                    zIndex: 0,
                  }}
                />
              )}
              {/* Full-resolution image */}
              <img
                key={image.id}
                src={`/api/images/${image.id}/file`}
                alt={image.filename}
                draggable={false}
                data-no-fade
                style={{
                  maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: 'center center',
                  transition: dragging ? 'none' : 'transform 0.15s ease',
                  userSelect: 'none',
                  opacity: fullLoaded ? 1 : 0,
                  zIndex: 1,
                  position: 'relative',
                }}
                onLoad={() => setFullLoaded(true)}
                onError={e => { e.currentTarget.style.opacity = '0.3'; setFullLoaded(true) }}
                onDoubleClick={e => { e.stopPropagation(); isZoomed ? resetZoom() : setZoom(2.5) }}
              />
            </div>
          )}

          {/* Nav arrows */}
          {(!isZoomed || image.is_video) && idx > 0 && (
            <button type="button" onMouseDown={() => setIdx(i => i - 1)}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer z-20"
              style={{
                background: 'rgba(0,0,0,0.5)', border: '0.5px solid rgba(255,255,255,0.15)',
                opacity: isFullscreen && !showFilmstrip ? 0 : 1,
                pointerEvents: isFullscreen && !showFilmstrip ? 'none' : 'auto',
                transition: 'opacity 0.25s ease',
              }}>
              <ChevronLeft size={18} />
            </button>
          )}
          {(!isZoomed || image.is_video) && idx < images.length - 1 && (
            <button type="button" onMouseDown={() => setIdx(i => i + 1)}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer z-20"
              style={{
                background: 'rgba(0,0,0,0.5)', border: '0.5px solid rgba(255,255,255,0.15)',
                opacity: isFullscreen && !showFilmstrip ? 0 : 1,
                pointerEvents: isFullscreen && !showFilmstrip ? 'none' : 'auto',
                transition: 'opacity 0.25s ease',
              }}>
              <ChevronRight size={18} />
            </button>
          )}

          {isZoomed && !image.is_video && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[12px] px-3 py-1.5 rounded-full pointer-events-none"
              style={{ background: 'rgba(0,0,0,0.6)', color: 'rgba(255,255,255,0.4)' }}>
              Double-click or Esc to reset · Drag to pan
            </div>
          )}
          {slideshowActive && (
            <div className="absolute bottom-3 right-3 text-[12px] px-2 py-1 rounded-full pointer-events-none flex items-center gap-1"
              style={{ background: 'rgba(0,0,0,0.6)', color: '#CECBF6' }}>
              <Play size={9} fill="#CECBF6" /> {slideshowSpeed}s
            </div>
          )}
        </div>

        {/* Filmstrip — absolute overlay at bottom, fades out in fullscreen when mouse idle */}
        <div className="flex gap-1.5 px-3 py-2 overflow-x-auto z-20"
          style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            height: 64,
            background: 'linear-gradient(to top, rgba(0,0,0,0.82) 0%, transparent 100%)',
            opacity: image.is_video || (isFullscreen && !showFilmstrip) ? 0 : 1,
            pointerEvents: image.is_video || (isFullscreen && !showFilmstrip) ? 'none' : 'auto',
            transition: 'opacity 0.25s ease',
          }}>
          {images.map((img, i) => (
            <div key={img.id} onMouseDown={() => setIdx(i)}
              className="w-12 h-12 rounded-[5px] overflow-hidden flex-shrink-0 cursor-pointer"
              style={{ border: `1.5px solid ${i === idx ? '#7F77DD' : 'rgba(255,255,255,0.06)'}`, background: 'rgba(255,255,255,0.04)' }}>
              <img src={`/api/images/${img.id}/thumb`} alt="" className="w-full h-full object-cover"
                onError={e => { e.target.style.display = 'none' }} />
            </div>
          ))}
        </div>
      </div>

      {/* ── Right panel — hidden in fullscreen ─────────────────────────── */}
      {!isFullscreen && <div className="w-56 flex-shrink-0 flex flex-col overflow-y-auto"
        style={{ background: '#141414', borderLeft: '0.5px solid rgba(255,255,255,0.07)' }}>

        {/* Creator(s) */}
        <CreatorPanel
          galleryId={image.gallery_id}
          creators={localCreators}
          onCreatorsChanged={setLocalCreators}
        />

        {/* Gallery link */}
        {image.gallery_name && (
          <div className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
            <div className="text-[12px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-1">Gallery</div>
            <button type="button" onMouseDown={() => { onClose(); navigate(`/galleries/${image.gallery_id}`) }}
              className="flex items-center gap-1 text-[13px] text-[rgba(255,255,255,0.65)] hover:text-white cursor-pointer truncate w-full text-left">
              <span className="truncate">{image.gallery_name}</span>
              <ExternalLink size={9} className="flex-shrink-0" />
            </button>
          </div>
        )}

        {/* Funscript loader — videos only */}
        {image.is_video && (
          <div className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
            <div className="text-[12px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-2">Funscript</div>
            <input ref={funscriptInputRef} type="file" accept=".funscript" className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (!file) return
                file.text().then(text => {
                  try { const d = JSON.parse(text); if (d?.actions) setLocalFunscript(d) } catch {}
                })
                e.target.value = ''
              }} />
            {localFunscript ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1 text-[13px]" style={{ color: '#CECBF6' }}>
                  <Zap size={12} fill="currentColor" /> Custom script loaded
                </div>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => funscriptInputRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-[6px] text-[12px] cursor-pointer"
                    style={{ background: 'rgba(127,119,221,0.12)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.25)' }}>
                    <FolderOpen size={11} /> Replace
                  </button>
                  <button type="button" onClick={() => setLocalFunscript(null)}
                    className="flex items-center justify-center px-2 py-1.5 rounded-[6px] text-[12px] cursor-pointer"
                    style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                    <X size={11} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {image.funscript_path
                  ? <div className="text-[12px] flex items-center gap-1" style={{ color: 'rgba(127,119,221,0.7)' }}><Zap size={11} /> Script attached</div>
                  : <div className="text-[12px] text-[rgba(255,255,255,0.25)]">No script attached</div>
                }
                <button type="button" onClick={() => funscriptInputRef.current?.click()}
                  className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-[6px] text-[12px] cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                  <FolderOpen size={11} /> Load .funscript
                </button>
              </div>
            )}
          </div>
        )}

        {/* Cum counter */}
        <div className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
          <div className="text-[12px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-2">Cum counter</div>
          <div className="flex items-center gap-2">
            <button type="button" onMouseDown={() => cumMutation.mutate()}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-[8px] text-[14px] font-medium cursor-pointer active:scale-95 transition-transform"
              style={{ background: 'rgba(212,83,126,0.2)', color: '#F4C0D1', border: '0.5px solid rgba(212,83,126,0.4)' }}>
              <Droplets size={13} /> Count it
            </button>
            <div className="text-center min-w-[36px]">
              <div className="text-[26px] font-medium leading-none" style={{ color: '#ED93B1' }}>{cumCount ?? 0}</div>
              <div className="text-[11px] text-[rgba(255,255,255,0.25)] mt-0.5">all time</div>
            </div>
          </div>
        </div>

        {/* Rating */}
        <div className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
          <div className="text-[12px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-2">Rating</div>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map(s => (
              <button key={s} type="button" onMouseDown={() => { setRating(s); rateMutation.mutate(s) }}
                className="text-[26px] cursor-pointer leading-none"
                style={{ color: s <= rating ? '#EF9F27' : 'rgba(255,255,255,0.1)' }}>★</button>
            ))}
          </div>
        </div>

        {/* Tags */}
        <TagPanel imageId={image.id} tags={localTags} onTagsChanged={setLocalTags} />

        {/* Info */}
        <div className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
          <div className="text-[12px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-2">Info</div>
          {image.width && (
            <div className="flex justify-between py-0.5">
              <span className="text-[12px] text-[rgba(255,255,255,0.3)]">Size</span>
              <span className="text-[12px] text-[rgba(255,255,255,0.6)]">{image.width}×{image.height}</span>
            </div>
          )}
          {image.file_size && (
            <div className="flex justify-between py-0.5">
              <span className="text-[12px] text-[rgba(255,255,255,0.3)]">File</span>
              <span className="text-[12px] text-[rgba(255,255,255,0.6)]">{(image.file_size / 1024 / 1024).toFixed(1)} MB</span>
            </div>
          )}
          <div className="flex justify-between py-0.5">
            <span className="text-[12px] text-[rgba(255,255,255,0.3)]">Views</span>
            <span className="text-[12px] text-[rgba(255,255,255,0.6)]">{liveViewCount ?? image.view_count}</span>
          </div>
        </div>

        {/* Transfer to gallery */}
        <TransferPanel imageId={image.id} currentGalleryId={image.gallery_id} onTransferred={(newGalleryId) => {
          // Close viewer after transfer as the image is now in another gallery
          toast.success('Image transferred!')
          onClose()
        }} />

        {/* Device controls — shown only when a device is connected */}
        <DeviceControls className="mx-3 mb-2" />

        {/* Actions */}
        <div className="p-3 flex flex-col gap-2">
          <button onMouseDown={() => {
            if (sessionActive) {
              const elapsed = endSession()
              sessionMutation.mutate({ duration_sec: Math.floor(elapsed / 1000) })
              toast.success('Session stopped')
            } else {
              startSession()
              toast.success('Session started ❤️')
            }
          }}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-[8px] text-[13px] font-medium cursor-pointer"
            style={{ background: 'rgba(212,83,126,0.15)', color: '#F4C0D1', border: '0.5px solid rgba(212,83,126,0.3)' }}>
            <Heart size={12} /> {sessionActive ? 'Stop Session' : 'Start Session'}
          </button>
        </div>
      </div>}
    </div>
  )
}



// ── Creator filter dropdown ────────────────────────────────────────────────────
function CreatorFilter({ value, onChange, placeholder = 'All creators' }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)

  const { data: creators } = useQuery({
    queryKey: ['creators-mini'],
    queryFn: () => creatorsApi.list({ limit: 200 }).then(r => r.data),
  })

  const filtered = (creators || []).filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
  const selected = creators?.find(c => c.id === value)

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button type="button" onMouseDown={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[13px] cursor-pointer"
        style={{
          background: value ? 'rgba(127,119,221,0.15)' : 'rgba(255,255,255,0.05)',
          color: value ? '#CECBF6' : 'rgba(255,255,255,0.5)',
          border: `0.5px solid ${value ? 'rgba(127,119,221,0.3)' : 'rgba(255,255,255,0.1)'}`
        }}>
        {selected ? selected.name : placeholder}
        {value
          ? <X size={11} onMouseDown={e => { e.stopPropagation(); onChange(null) }} />
          : <ChevronDown size={11} />
        }
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 rounded-[8px] shadow-2xl z-50 w-52 animate-menu-pop"
          style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.12)' }}>
          <div className="p-2">
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search creators..." className="w-full px-2 py-1.5 rounded-[6px] text-[13px] outline-none"
              style={{
                background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.8)',
                border: '0.5px solid rgba(255,255,255,0.1)'
              }} />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
            <button type="button" onMouseDown={() => { onChange(null); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-[13px] cursor-pointer hover:bg-[rgba(255,255,255,0.05)]"
              style={{ color: 'rgba(255,255,255,0.45)' }}>{placeholder}</button>
            {filtered.map(c => (
              <button key={c.id} type="button" onMouseDown={() => { onChange(c.id); setOpen(false) }}
                className="w-full text-left px-3 py-2 text-[13px] cursor-pointer hover:bg-[rgba(255,255,255,0.05)] flex items-center gap-2"
                style={{ color: 'rgba(255,255,255,0.75)' }}>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: TYPE_COLORS[c.creator_type] || '#D3D1C7' }} />
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Bulk action panel ─────────────────────────────────────────────────────────
function BulkActionPanel({ selectedImages, onDone, onCancel }) {
  const [creatorId, setCreatorId] = useState(null)
  const [tagInput, setTagInput] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [working, setWorking] = useState(false)
  const qc = useQueryClient()
  const addToMultiViewer = useVaultStore(s => s.addToMultiViewer)
  const MAX = useVaultStore(s => s.MULTIVIEWER_MAX)
  const queue = useVaultStore(s => s.multiViewerQueue)

  const selectedGalleryIds = Array.from(new Set(selectedImages.map(i => i.gallery_id).filter(id => id)))

  const assignMutation = useMutation({
    mutationFn: () => galleriesApi.bulkAssign(selectedGalleryIds, creatorId),
    onSuccess: (r) => {
      toast.success(`Assigned creator to ${r.data.updated} galleries`)
      qc.invalidateQueries({ queryKey: ['images-list'] })
      qc.invalidateQueries({ queryKey: ['galleries'] })
      onDone()
    },
    onError: () => toast.error('Assignment failed')
  })

  const handleSendToViewer = () => {
    let added = 0, skipped = 0
    toast('Adding media...', { icon: '⏳', id: 'bulk-add' })
    for (const img of selectedImages) {
      if (queue.length + added >= MAX) break
      const ok = addToMultiViewer({ id: `img-${img.id}`, type: 'image', media: img })
      if (ok) added++; else skipped++
    }
    toast.dismiss('bulk-add')
    if (added > 0) toast.success(`Sent ${added} items to viewer`)
    if (skipped > 0) toast('Some already queued or queue full', { icon: 'ℹ️' })
    onDone()
  }

  const handleAddTags = async () => {
    const tags = tagInput.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    if (!tags.length) return
    setWorking(true)
    let errs = 0
    for (const img of selectedImages)
      for (const t of tags)
        try { await imagesApi.addTag(img.id, t) } catch { errs++ }
    setWorking(false)
    if (errs) toast.error(`Done with ${errs} errors`)
    else toast.success(`Tagged ${selectedImages.length} images`)
    qc.invalidateQueries({ queryKey: ['images-list'] })
    setTagInput('')
    onDone()
  }

  const handleDelete = async () => {
    setWorking(true)
    let errs = 0
    for (const img of selectedImages)
      try { await imagesApi.delete(img.id) } catch { errs++ }
    setWorking(false)
    if (errs) toast.error(`Done with ${errs} errors`)
    else toast.success(`Deleted ${selectedImages.length} files`)
    qc.invalidateQueries({ queryKey: ['images-list'] })
    setConfirmDel(false)
    onDone()
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 rounded-[10px] flex-wrap animate-slide-up"
      style={{ background: 'rgba(127,119,221,0.12)', border: '0.5px solid rgba(127,119,221,0.3)', position: 'relative', zIndex: 60 }}>
      <span className="text-[13px] font-medium" style={{ color: '#CECBF6' }}>
        {selectedImages.length} selected
      </span>

      {/* Send to viewer */}
      <button type="button" onMouseDown={handleSendToViewer} disabled={working}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer transition-colors hover:bg-[rgba(127,119,221,0.2)] disabled:opacity-40"
        style={{ background: 'rgba(127,119,221,0.15)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.3)' }}>
        <LayoutGrid size={12} /> Send to viewer
      </button>

      <div className="w-[1px] h-4 bg-[rgba(255,255,255,0.1)] mx-1" />

      {/* Assign creator — elevated z so dropdown doesn't get clipped */}
      <span className="text-[rgba(255,255,255,0.3)] text-[13px]">Creator</span>
      <div style={{ position: 'relative', zIndex: 80 }}>
        <CreatorFilter value={creatorId} onChange={setCreatorId} placeholder="Pick creator..." />
      </div>
      <button type="button"
        onMouseDown={() => { if (creatorId && !assignMutation.isPending && !working && selectedGalleryIds.length > 0) assignMutation.mutate() }}
        disabled={!creatorId || assignMutation.isPending || working || selectedGalleryIds.length === 0}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer disabled:opacity-40"
        style={{ background: 'rgba(127,119,221,0.3)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.5)' }}>
        <UserPlus size={12} /> {assignMutation.isPending ? 'Assigning…' : 'Assign'}
      </button>

      <div className="w-[1px] h-4 bg-[rgba(255,255,255,0.1)] mx-1" />

      {/* Bulk tag */}
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-[7px]" style={{ background: 'rgba(255,255,255,0.05)' }}>
        <Tag size={11} style={{ color: 'rgba(255,255,255,0.4)', flexShrink: 0 }} />
        <input value={tagInput} onChange={e => setTagInput(e.target.value)} disabled={working}
          placeholder="tag1, tag2…"
          className="bg-transparent text-[13px] outline-none w-24 text-[rgba(255,255,255,0.8)] placeholder-[rgba(255,255,255,0.3)]" />
        <button type="button" onMouseDown={handleAddTags} disabled={!tagInput.trim() || working}
          className="text-[12px] px-2 py-0.5 rounded-[4px] cursor-pointer disabled:opacity-40"
          style={{ background: 'rgba(127,119,221,0.2)', color: '#CECBF6' }}>Add</button>
      </div>

      <div className="w-[1px] h-4 bg-[rgba(255,255,255,0.1)] mx-1" />

      {/* Delete */}
      {confirmDel ? (
        <button onMouseDown={handleDelete} disabled={working}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer animate-pulse disabled:opacity-40"
          style={{ background: 'rgba(212,83,126,0.35)', color: '#F4C0D1' }}>
          <Trash2 size={12} /> Confirm Delete
        </button>
      ) : (
        <button onMouseDown={() => setConfirmDel(true)} disabled={working}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer disabled:opacity-40"
          style={{ background: 'rgba(212,83,126,0.12)', color: '#F4C0D1', border: '0.5px solid rgba(212,83,126,0.25)' }}>
          <Trash2 size={12} /> Delete
        </button>
      )}

      <button type="button" onMouseDown={onCancel} disabled={working}
        className="text-[rgba(255,255,255,0.35)] hover:text-white cursor-pointer ml-auto disabled:opacity-40">
        <X size={14} />
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
const IMG_PAGE_SIZES = [25, 50, 100, 250, 500]

export default function ImageList({ onlyVideos = false }) {
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('date_added')
  const [randomSeed, setRandomSeed] = useState(0)
  const [creatorId, setCreatorId] = useState(null)
  const [favOnly, setFavOnly] = useState(false)
  const [videoOnly, setVideoOnly] = useState(onlyVideos)
  const [activeTags, setActiveTags] = useState(() => {
    const multi = searchParams.get('tags')
    if (multi) return multi.split(',').map(t => t.trim()).filter(Boolean)
    const t = searchParams.get('tag')
    return t ? [t] : []
  })
  const [viewerIdx, setViewerIdx] = useState(null)

  const [bulkMode, setBulkMode] = useState(false)
  const [selected, setSelected] = useState(new Set())

  // Persistent thumb size & layout
  const thumbSize = useVaultStore(s => onlyVideos ? s.thumbSizeVideos : s.thumbSizeImages)
  const setThumbSizeStore = useVaultStore(s => onlyVideos ? s.setThumbSizeVideos : s.setThumbSizeImages)
  const [masonryGrid, setMasonryGrid] = useState(() => localStorage.getItem('vault_masonry_images') === 'true')
  const toggleMasonry = useCallback(() => {
    setMasonryGrid(v => {
      const next = !v
      localStorage.setItem('vault_masonry_images', String(next))
      return next
    })
  }, [])

  const [pageLimit, setPageLimit] = useState(100)
  const [page, setPage] = useState(1)

  // Reset to page 1 whenever any filter or page-size changes
  const filterKey = `${search}|${sortBy}|${creatorId}|${favOnly}|${onlyVideos}|${activeTags.join(',')}|${pageLimit}|${randomSeed}`
  useEffect(() => { setPage(1) }, [filterKey])

  const { data: images, isLoading, isError } = useQuery({
    queryKey: ['images-list', search, sortBy, creatorId, favOnly, onlyVideos, activeTags.join(','), pageLimit, page, randomSeed],
    queryFn: () => imagesApi.list({
      search: search || undefined,
      sort_by: sortBy,
      creator_id: creatorId || undefined,
      favorite: favOnly || undefined,
      is_video: onlyVideos ? true : false,   // Images tab = no videos; Videos tab = only videos
      tags: activeTags.length > 0 ? activeTags.join(',') : undefined,
      limit: pageLimit,
      skip: (page - 1) * pageLimit,
      _seed: randomSeed,
    }).then(r => r.data),
    placeholderData: keepPreviousData,
    staleTime: sortBy === 'random' ? Infinity : 1000 * 60 * 5,
  })

  const toggleBtn = (active, onPress, label) => (
    <button type="button" onMouseDown={onPress}
      className="px-3 py-1.5 rounded-[8px] text-[13px] cursor-pointer"
      style={{
        background: active ? 'rgba(127,119,221,0.15)' : 'rgba(255,255,255,0.05)',
        color: active ? '#CECBF6' : 'rgba(255,255,255,0.45)',
        border: `0.5px solid ${active ? 'rgba(127,119,221,0.3)' : 'rgba(255,255,255,0.1)'}`
      }}>
      {label}
    </button>
  )

  const handleSortChange = (val) => {
    if (val === 'random') setRandomSeed(Math.random())
    setSortBy(val)
  }

  const toggleSelect = (id) => {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const selectAll = () => {
    setSelected(selected.size === images?.length ? new Set() : new Set(images?.map(g => g.id) ?? []))
  }
  const exitBulk = () => { setBulkMode(false); setSelected(new Set()) }

  return (
    <div className="p-5">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div>
          <h1 className="text-[24px] font-medium text-[rgba(255,255,255,0.9)]">{onlyVideos ? 'Videos' : 'Photos'}</h1>
          <div className="text-[13px] text-[rgba(255,255,255,0.3)] mt-0.5">
            {isLoading
              ? 'Loading…'
              : isError
                ? `Error loading ${onlyVideos ? 'videos' : 'photos'}`
                : images?.length === 0
                  ? 'No results'
                  : `${(page - 1) * pageLimit + 1}–${(page - 1) * pageLimit + (images?.length ?? 0)} shown · page ${page}${images?.length < pageLimit ? ' (last)' : ''}`
            }
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="relative flex-1 min-w-[200px] max-w-[320px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.3)]" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by filename…"
            className="w-full pl-8 pr-3 py-1.5 rounded-[8px] text-[13px] outline-none"
            style={{
              background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.8)',
              border: '0.5px solid rgba(255,255,255,0.1)'
            }} />
          {search && (
            <button type="button" onMouseDown={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.3)] hover:text-white cursor-pointer">
              <X size={12} />
            </button>
          )}
        </div>

        <SortDropdown value={sortBy} onChange={handleSortChange} options={SORTS} />

        <CreatorFilter value={creatorId} onChange={setCreatorId} />

        {/* Multi-tag filter with autocomplete */}
        <TagFilterInput
          activeTags={activeTags}
          onAdd={name => setActiveTags(prev => prev.includes(name) ? prev : [...prev, name])}
          onRemove={name => setActiveTags(prev => prev.filter(t => t !== name))}
          placeholder="Filter by tag…"
          rounded="lg"
        />

        {toggleBtn(favOnly, () => setFavOnly(f => !f), '★ Favorites')}

        {/* Masonry Toggle — Only for Images view */}
        {!onlyVideos && (
          <button type="button" onMouseDown={toggleMasonry}
            className="flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-[8px] cursor-pointer"
            style={{
              background: masonryGrid ? 'rgba(127,119,221,0.2)' : 'rgba(255,255,255,0.05)',
              color: masonryGrid ? '#CECBF6' : 'rgba(255,255,255,0.45)',
              border: `0.5px solid ${masonryGrid ? 'rgba(127,119,221,0.4)' : 'rgba(255,255,255,0.08)'}`,
            }}
            title="Toggle Masonry Grid">
            <GripHorizontal size={11} /> Masonry
          </button>
        )}

        <button type="button" onMouseDown={() => { setBulkMode(!bulkMode); setSelected(new Set()) }}
          className="flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-[8px] cursor-pointer ml-auto"
          style={{
            background: bulkMode ? 'rgba(127,119,221,0.2)' : 'rgba(255,255,255,0.05)',
            color: bulkMode ? '#CECBF6' : 'rgba(255,255,255,0.45)',
            border: `0.5px solid ${bulkMode ? 'rgba(127,119,221,0.4)' : 'rgba(255,255,255,0.08)'}`,
          }}>
          <CheckSquare size={11} /> Select
        </button>
      </div>

      {/* Size controls */}
      <div className="flex items-center gap-3 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[rgba(255,255,255,0.3)]">Size</span>
          <input type="range" min={80} max={400} step={10} value={thumbSize}
            onChange={e => setThumbSizeStore(Number(e.target.value))}
            className="w-24 h-1 cursor-pointer accent-[#7F77DD]" />
          <span className="text-[12px] text-[rgba(255,255,255,0.3)] w-8">{thumbSize}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[12px] text-[rgba(255,255,255,0.3)] mr-1">Per page</span>
          {IMG_PAGE_SIZES.map(n => (
            <button key={n} type="button" onMouseDown={() => setPageLimit(n)}
              className="text-[12px] px-2 py-0.5 rounded-full cursor-pointer"
              style={{
                background: pageLimit === n ? 'rgba(127,119,221,0.2)' : 'rgba(255,255,255,0.04)',
                color: pageLimit === n ? '#CECBF6' : 'rgba(255,255,255,0.4)',
                border: `0.5px solid ${pageLimit === n ? 'rgba(127,119,221,0.35)' : 'rgba(255,255,255,0.07)'}`,
              }}>
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk action bar */}
      {bulkMode && (
        <div className="flex items-center gap-3 flex-wrap mb-4">
          <button type="button" onMouseDown={selectAll}
            className="text-[13px] px-3 py-1.5 rounded-full cursor-pointer"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
            {selected.size === images?.length ? 'Deselect all' : 'Select all'}
          </button>
          {selected.size > 0 && (
            <BulkActionPanel selectedImages={(images || []).filter(g => selected.has(g.id))} onDone={exitBulk} onCancel={exitBulk} />
          )}
        </div>
      )}

      {/* Grid */}
      {isLoading ? (
        <div className="text-[16px] text-[rgba(255,255,255,0.25)] py-20 text-center">Loading…</div>
      ) : isError ? (
        <div className="text-[16px] text-[rgba(255,255,255,0.25)] py-20 text-center">Failed to load images. Is the backend running?</div>
      ) : !images || images.length === 0 ? (
        <div className="text-[16px] text-[rgba(255,255,255,0.25)] py-20 text-center">No images found</div>
      ) : (
        (!onlyVideos && masonryGrid) ? (
          <div className="grid-stagger" style={{ columns: `${thumbSize}px`, columnGap: '8px' }}>
            {images.map((img, i) => (
              <div key={img.id} style={{ breakInside: 'avoid', marginBottom: '8px' }}>
                <ImageThumb image={img} onClick={() => setViewerIdx(i)} bulkMode={bulkMode} selected={selected.has(img.id)} onSelect={toggleSelect} masonry />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-2 grid-stagger" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${thumbSize}px, 100%), ${thumbSize}px))` }}>
            {images.map((img, i) => (
              <ImageThumb key={img.id} image={img} onClick={() => setViewerIdx(i)} bulkMode={bulkMode} selected={selected.has(img.id)} onSelect={toggleSelect} />
            ))}
          </div>
        )
      )}

      {/* Pagination controls */}
      {!isLoading && !isError && (images?.length > 0 || page > 1) && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage(1)}
            disabled={page === 1}
            className="p-1.5 rounded-[6px] cursor-pointer disabled:opacity-30"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' }}
            title="First page">
            <ChevronsLeft size={14} />
          </button>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="flex items-center gap-1 px-3 py-1.5 rounded-[8px] text-[13px] cursor-pointer disabled:opacity-30"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.55)' }}>
            <ChevronLeft size={13} /> Prev
          </button>

          {/* Page number pills — sliding window of up to 7 pages around current */}
          {Array.from({ length: 7 }, (_, i) => Math.max(1, page - 3) + i).map(p => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className="w-8 h-8 rounded-[6px] text-[13px] font-medium cursor-pointer"
              style={{
                background: p === page ? 'rgba(127,119,221,0.25)' : 'rgba(255,255,255,0.04)',
                color: p === page ? '#CECBF6' : 'rgba(255,255,255,0.4)',
                border: `0.5px solid ${p === page ? 'rgba(127,119,221,0.4)' : 'rgba(255,255,255,0.08)'}`,
              }}>
              {p}
            </button>
          ))}

          <button
            onClick={() => setPage(p => p + 1)}
            disabled={(images?.length ?? 0) < pageLimit}
            className="flex items-center gap-1 px-3 py-1.5 rounded-[8px] text-[13px] cursor-pointer disabled:opacity-30"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.55)' }}>
            Next <ChevronRight size={13} />
          </button>
        </div>
      )}

      {/* Viewer */}
      {viewerIdx !== null && images?.length > 0 && (
        <ImageViewer images={images} startIdx={viewerIdx} onClose={() => setViewerIdx(null)} />
      )}
    </div>
  )
}

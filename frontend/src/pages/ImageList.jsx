import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Search, X, ChevronLeft, ChevronRight, Droplets, Heart,
  ZoomIn, ZoomOut, Maximize, Minimize, Images as ImagesIcon,
  ChevronDown, ExternalLink, Tag, Play, Pause,
  LayoutGrid, Star,
  CheckSquare, Square, UserPlus, Check, Trash2, LayoutTemplate, GripHorizontal,
  FolderOpen, Zap, FolderOutput,
} from 'lucide-react'
import { imagesApi, creatorsApi, galleriesApi, sessionsApi } from '../lib/api'
import ImageContextMenu from '../components/ImageContextMenu'
import AvatarFramePicker from '../components/AvatarFramePicker'
import GalleryPagination from '../components/GalleryPagination'
import { useVaultStore } from '../store/vault'
import toast from 'react-hot-toast'
import { TagPanel, CreatorPanel, TransferPanel } from '../components/ViewerPanel'
import { useAllCreators } from '../hooks/useAllCreators'
import TagFilterInput from '../components/TagFilterInput'
import InlineVideoPlayer from '../components/InlineVideoPlayer'
import DeviceControls from '../components/DeviceControls'
import { SortDropdown } from '../components/SortDropdown'
import FranchiseFilter from '../components/FranchiseFilter'
import PeriodFilter from '../components/PeriodFilter'
import { useT } from '../i18n'

const TYPE_COLORS = {
  cosplayer: '#9FE1CB', ethot: '#ED93B1', artist: '#CECBF6',
  character: '#FAC775', actress: '#ED93B1', custom: '#D3D1C7',
}

const SORTS = [
  { value: 'filename',      label: 'Filename' },
  { value: 'date_added',    label: 'Date Added' },
  { value: 'date_modified', label: 'Date Modified' },
  { value: 'view_count',    label: 'Most Viewed' },
  { value: 'cum_count',     label: 'Most Cummed' },
  { value: 'rating',        label: 'Rating' },
  { value: 'file_size',     label: 'File Size' },
  { value: 'random',        label: 'Random' },
]

const SLIDESHOW_SPEEDS = [3, 5, 8, 12]

// ── Thumbnail ──────────────────────────────────────────────────────────────────
function ImageThumb({ image, onClick, bulkMode, selected, onSelect, onContextMenu, masonry = false }) {
  const [failed, setFailed] = useState(false)
  const [hoverVideo, setHoverVideo] = useState(false)
  const videoRef = useRef(null)
  const hoverTimerRef = useRef(null)
  const addToMultiViewer = useVaultStore(s => s.addToMultiViewer)
  const queue = useVaultStore(s => s.multiViewerQueue)
  const MAX = useVaultStore(s => s.MULTIVIEWER_MAX)
  const t = useT()
  const inQueue = queue.some(q => q.id === `img-${image.id}`)

  const handleSendToViewer = (e) => {
    e.stopPropagation()
    if (queue.length >= MAX) { toast.error(`Multi-viewer full (${MAX}/${MAX})`); return }
    const ok = addToMultiViewer({ id: `img-${image.id}`, type: 'image', media: image })
    if (ok) toast.success(t('Sent to multi-viewer'))
    else toast(t('Already in multi-viewer'), { icon: '✓' })
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
      onContextMenu={(e) => { e.preventDefault(); onContextMenu?.(image, e) }}
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
        title={t('Send to multi-viewer')}
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
  const t = useT()

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
    if (window.pywebview?.api) {
      const next = !isFullscreenRef.current
      window.pywebview.api.toggle_fullscreen()
      isFullscreenRef.current = next
      setIsFullscreen(next)
      clearTimeout(filmstripTimer.current)
      if (next) setShowFilmstrip(false)
      else setShowFilmstrip(true)
    } else if (!document.fullscreenElement) {
      viewerRef.current?.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
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
      if (e.key === 'Escape') {
        if (window.pywebview?.api && isFullscreenRef.current) {
          window.pywebview.api.toggle_fullscreen()
          isFullscreenRef.current = false
          setIsFullscreen(false)
          setShowFilmstrip(true)
        }
        if (zoom > 1) resetZoom(); else onClose()
        return
      }
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
    onSuccess: (data) => { addXpToast(`+${data.xp_earned} XP`); toast.success(t('Session logged ❤️')) }
  })

  if (!image) return null
  const isZoomed = zoom > 1

  return createPortal((
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
            title={isFavorite ? t('Remove favorite') : t('Favorite')}>
            <Star size={14} fill={isFavorite ? '#EF9F27' : 'none'} />
          </button>

          {/* Slideshow controls */}
          <div className="flex items-center gap-1 relative">
            <button type="button" onMouseDown={() => setSlideshowActive(a => !a)}
              className="cursor-pointer p-1 rounded text-[rgba(255,255,255,0.4)] hover:text-white"
              title={t('Play/pause slideshow (Space)')}>
              {slideshowActive ? <Pause size={13} /> : <Play size={13} />}
            </button>
            <button type="button" onMouseDown={() => setShowSpeedMenu(s => !s)}
              className="cursor-pointer text-[11px] px-1.5 py-0.5 rounded-full"
              style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)' }}
              title={t('Slideshow speed')}>
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
              {t('Double-click or Esc to reset · Drag to pan')}
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
            <div className="text-[12px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-1">{t('Gallery')}</div>
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
            <div className="text-[12px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-2">{t('Funscript')}</div>
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
                  <Zap size={12} fill="currentColor" /> {t('Custom script loaded')}
                </div>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => funscriptInputRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-[6px] text-[12px] cursor-pointer"
                    style={{ background: 'rgba(127,119,221,0.12)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.25)' }}>
                    <FolderOpen size={11} /> {t('Replace')}
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
                  ? <div className="text-[12px] flex items-center gap-1" style={{ color: 'rgba(127,119,221,0.7)' }}><Zap size={11} /> {t('Script attached')}</div>
                  : <div className="text-[12px] text-[rgba(255,255,255,0.25)]">{t('No script attached')}</div>
                }
                <button type="button" onClick={() => funscriptInputRef.current?.click()}
                  className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-[6px] text-[12px] cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                  <FolderOpen size={11} /> {t('Load .funscript')}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Cum counter */}
        <div className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
          <div className="text-[12px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-2">{t('Cum counter')}</div>
          <div className="flex items-center gap-2">
            <button type="button" onMouseDown={() => cumMutation.mutate()}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-[8px] text-[14px] font-medium cursor-pointer active:scale-95 transition-transform"
              style={{ background: 'rgba(212,83,126,0.2)', color: '#F4C0D1', border: '0.5px solid rgba(212,83,126,0.4)' }}>
              <Droplets size={13} /> {t('Count it')}
            </button>
            <div className="text-center min-w-[36px]">
              <div className="text-[26px] font-medium leading-none" style={{ color: '#ED93B1' }}>{cumCount ?? 0}</div>
              <div className="text-[11px] text-[rgba(255,255,255,0.25)] mt-0.5">{t('all time')}</div>
            </div>
          </div>
        </div>

        {/* Rating */}
        <div className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
          <div className="text-[12px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-2">{t('Rating')}</div>
          <div className="flex gap-0.5">
            {[1,2,3,4,5,6,7,8,9,10].map(s => (
              <button key={s} type="button" onMouseDown={() => { setRating(s); rateMutation.mutate(s) }}
                className="text-[20px] cursor-pointer leading-none"
                style={{ color: s <= rating ? '#EF9F27' : 'rgba(255,255,255,0.1)' }}>★</button>
            ))}
          </div>
        </div>

        {/* Tags */}
        <TagPanel imageId={image.id} tags={localTags} onTagsChanged={setLocalTags} />

        {/* Info */}
        <div className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
          <div className="text-[12px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-2">{t('Info')}</div>
          {image.width && (
            <div className="flex justify-between py-0.5">
              <span className="text-[12px] text-[rgba(255,255,255,0.3)]">{t('Size')}</span>
              <span className="text-[12px] text-[rgba(255,255,255,0.6)]">{image.width}×{image.height}</span>
            </div>
          )}
          {image.file_size && (
            <div className="flex justify-between py-0.5">
              <span className="text-[12px] text-[rgba(255,255,255,0.3)]">{t('File')}</span>
              <span className="text-[12px] text-[rgba(255,255,255,0.6)]">{(image.file_size / 1024 / 1024).toFixed(1)} MB</span>
            </div>
          )}
          <div className="flex justify-between py-0.5">
            <span className="text-[12px] text-[rgba(255,255,255,0.3)]">{t('Views')}</span>
            <span className="text-[12px] text-[rgba(255,255,255,0.6)]">{liveViewCount ?? image.view_count}</span>
          </div>
        </div>

        {/* Transfer to gallery */}
        <TransferPanel imageId={image.id} currentGalleryId={image.gallery_id} onTransferred={(newGalleryId) => {
          // Close viewer after transfer as the image is now in another gallery
          toast.success(t('Image transferred!'))
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
              toast.success(t('Session stopped'))
            } else {
              startSession()
              toast.success(t('Session started ❤️'))
            }
          }}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-[8px] text-[13px] font-medium cursor-pointer"
            style={{ background: 'rgba(212,83,126,0.15)', color: '#F4C0D1', border: '0.5px solid rgba(212,83,126,0.3)' }}>
            <Heart size={12} /> {sessionActive ? t('Stop Session') : t('Start Session')}
          </button>
        </div>
      </div>}
    </div>
  ), document.body)
}



// ── Creator type filter dropdown ──────────────────────────────────────────────
const CREATOR_TYPE_OPTIONS = [
  { value: '',           label: 'All types' },
  { value: 'cosplayer',  label: 'Cosplayer' },
  { value: 'ethot',      label: 'E-girl' },
  { value: 'artist',     label: 'Artist' },
  { value: 'character',  label: 'Character' },
  { value: 'actress',    label: 'Actress' },
  { value: 'custom',     label: 'Model / Other' },
]

function CreatorTypeDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const t = useT()
  const selected = CREATOR_TYPE_OPTIONS.find(o => o.value === value) || CREATOR_TYPE_OPTIONS[0]
  const active = !!value

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); setOpen(o => !o) }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[13px] cursor-pointer"
        style={{
          background: active ? 'rgba(127,119,221,0.15)' : 'rgba(255,255,255,0.05)',
          color: active ? '#CECBF6' : 'rgba(255,255,255,0.5)',
          border: `0.5px solid ${active ? 'rgba(127,119,221,0.3)' : 'rgba(255,255,255,0.1)'}`,
        }}>
        {active
          ? <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: TYPE_COLORS[value] || '#CECBF6' }} />
          : null}
        {t(selected.label)}
        {active
          ? <X size={11} onMouseDown={e => { e.stopPropagation(); onChange('') }} className="cursor-pointer" />
          : <ChevronDown size={11} />}
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 rounded-[8px] shadow-2xl animate-menu-pop overflow-hidden"
             style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.12)', minWidth: 160 }}>
          {CREATOR_TYPE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onMouseDown={() => { onChange(opt.value); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-[13px] cursor-pointer flex items-center gap-2 hover:bg-[rgba(255,255,255,0.05)]"
              style={{
                background: value === opt.value ? 'rgba(127,119,221,0.15)' : 'transparent',
                color: value === opt.value ? '#CECBF6' : 'rgba(255,255,255,0.7)',
              }}>
              {opt.value
                ? <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: TYPE_COLORS[opt.value] || '#D3D1C7' }} />
                : <span className="w-1.5 h-1.5 flex-shrink-0" />}
              {t(opt.label)}
              {value === opt.value && <Check size={11} className="ml-auto" style={{ color: '#7F77DD' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Creator filter dropdown ────────────────────────────────────────────────────
function CreatorFilter({ value, onChange, placeholder = 'All creators' }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)
  const t = useT()

  const { data: creators } = useAllCreators()

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
        {selected ? selected.name : t(placeholder)}
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
              placeholder={t('Search creators...')} className="w-full px-2 py-1.5 rounded-[6px] text-[13px] outline-none"
              style={{
                background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.8)',
                border: '0.5px solid rgba(255,255,255,0.1)'
              }} />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
            <button type="button" onMouseDown={() => { onChange(null); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-[13px] cursor-pointer hover:bg-[rgba(255,255,255,0.05)]"
              style={{ color: 'rgba(255,255,255,0.45)' }}>{t(placeholder)}</button>
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
// ── Extract-to-new-gallery modal ───────────────────────────────────────────────
function ExtractModal({ selectedImages, onClose, onExtracted }) {
  const sourceGalleryId = selectedImages[0]?.gallery_id
  const [folderName, setFolderName] = useState('')
  const qc = useQueryClient()
  const navigate = useNavigate()
  const t = useT()

  const { data: srcGallery, isLoading: loadingSrc } = useQuery({
    queryKey: ['gallery', String(sourceGalleryId)],
    queryFn:  () => galleriesApi.get(sourceGalleryId).then(r => r.data),
    enabled:  !!sourceGalleryId,
    staleTime: 60_000,
  })

  const noFolder = srcGallery && (!srcGallery.folder_path || srcGallery.folder_path.startsWith('__manual__'))

  const extractMutation = useMutation({
    mutationFn: () => galleriesApi.extract(
      sourceGalleryId,
      selectedImages.map(i => i.id),
      folderName.trim(),
    ),
    onSuccess: (res) => {
      const g = res.data
      const errs = g.errors?.length ?? 0
      if (errs > 0) toast.error(`Extracted with ${errs} file error(s)`)
      else toast.success(`${g.moved} images → "${g.name}"`)
      qc.invalidateQueries({ queryKey: ['images-list'] })
      qc.invalidateQueries({ queryKey: ['galleries'] })
      onExtracted(g)
      navigate(`/galleries/${g.id}`)
    },
    onError: (err) => toast.error(err?.response?.data?.detail || t('Extract failed')),
  })

  const parentLabel = srcGallery?.folder_path
    ? srcGallery.folder_path.split(/[\\/]/).filter(Boolean).slice(0, -1).join(' › ') || '(root)'
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in"
         style={{ background: 'rgba(0,0,0,0.75)' }}
         onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rounded-[14px] p-5 w-[420px] animate-modal-pop shadow-2xl flex flex-col gap-4"
           style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.15)' }}>

        {/* Header */}
        <div>
          <div className="text-[17px] font-medium text-[rgba(255,255,255,0.9)] flex items-center gap-2 mb-1">
            <FolderOutput size={14} style={{ color: '#7F77DD' }} />
            {t('Extract to new gallery')}
          </div>
          <div className="text-[13px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {selectedImages.length} {t('image')}{selectedImages.length !== 1 ? 's' : ''} {t('will be moved out of')}
            {' '}<span style={{ color: 'rgba(255,255,255,0.7)' }}>{srcGallery?.name ?? '…'}</span>
          </div>
        </div>

        {noFolder ? (
          <div className="px-3 py-3 rounded-[8px] text-[13px]"
               style={{ background: 'rgba(212,83,126,0.1)', border: '0.5px solid rgba(212,83,126,0.3)', color: '#F4C0D1' }}>
            {t('This gallery has no real folder on disk. Extract requires a scanned gallery.')}
          </div>
        ) : (
          <>
            {/* Folder name input */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                {t('New folder / gallery name')}
              </label>
              <input
                autoFocus
                value={folderName}
                onChange={e => setFolderName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && folderName.trim()) extractMutation.mutate()
                  if (e.key === 'Escape') onClose()
                }}
                placeholder={t('e.g. Widowmaker NSFW')}
                className="w-full px-3 py-2 rounded-[8px] text-[14px] font-mono outline-none"
                style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.85)', border: '0.5px solid rgba(255,255,255,0.15)' }}
              />
              {parentLabel && (
                <div className="text-[11px] truncate" style={{ color: 'rgba(255,255,255,0.25)' }}>
                  {t('Will create:')} {parentLabel} › <span style={{ color: 'rgba(255,255,255,0.5)' }}>{folderName || '…'}</span>
                </div>
              )}
            </div>

            {/* Info strip */}
            <div className="px-3 py-2 rounded-[8px] text-[12px]"
                 style={{ background: 'rgba(127,119,221,0.08)', border: '0.5px solid rgba(127,119,221,0.2)', color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
              {t("Files are physically moved on disk. Creator associations are copied from the source gallery. You'll be taken to the new gallery.")}
            </div>
          </>
        )}

        {/* Buttons */}
        <div className="flex gap-2 justify-end">
          <button type="button" onMouseDown={onClose}
                  className="px-3 py-1.5 rounded-full text-[13px] cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' }}>
            {t('Cancel')}
          </button>
          {!noFolder && (
            <button type="button"
                    onMouseDown={() => extractMutation.mutate()}
                    disabled={!folderName.trim() || extractMutation.isPending || loadingSrc}
                    className="px-4 py-1.5 rounded-full text-[13px] font-medium cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
                    style={{ background: 'rgba(127,119,221,0.3)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.5)' }}>
              <FolderOutput size={12} />
              {extractMutation.isPending ? t('Extracting…') : t('Extract')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}


function BulkActionPanel({ selectedImages, onDone, onCancel }) {
  const [creatorId, setCreatorId] = useState(null)
  const [tagInput, setTagInput] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [working, setWorking] = useState(false)
  const [showExtract, setShowExtract] = useState(false)
  const qc = useQueryClient()
  const addToMultiViewer = useVaultStore(s => s.addToMultiViewer)
  const MAX = useVaultStore(s => s.MULTIVIEWER_MAX)
  const queue = useVaultStore(s => s.multiViewerQueue)
  const t = useT()

  const selectedGalleryIds = Array.from(new Set(selectedImages.map(i => i.gallery_id).filter(id => id)))

  const assignMutation = useMutation({
    mutationFn: () => galleriesApi.bulkAssign(selectedGalleryIds, creatorId),
    onSuccess: (r) => {
      toast.success(`Assigned creator to ${r.data.updated} galleries`)
      qc.invalidateQueries({ queryKey: ['images-list'] })
      qc.invalidateQueries({ queryKey: ['galleries'] })
      onDone()
    },
    onError: () => toast.error(t('Assignment failed'))
  })

  const handleSendToViewer = () => {
    let added = 0, skipped = 0
    toast(t('Adding media...'), { icon: '⏳', id: 'bulk-add' })
    for (const img of selectedImages) {
      if (queue.length + added >= MAX) break
      const ok = addToMultiViewer({ id: `img-${img.id}`, type: 'image', media: img })
      if (ok) added++; else skipped++
    }
    toast.dismiss('bulk-add')
    if (added > 0) toast.success(`Sent ${added} items to viewer`)
    if (skipped > 0) toast(t('Some already queued or queue full'), { icon: 'ℹ️' })
    onDone()
  }

  const handleAddTags = async () => {
    const tags = tagInput.split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean)
    if (!tags.length) return
    setWorking(true)
    let errs = 0
    for (const img of selectedImages)
      for (const tag of tags)
        try { await imagesApi.addTag(img.id, tag) } catch { errs++ }
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
        {selectedImages.length} {t('selected')}
      </span>

      {/* Send to viewer */}
      <button type="button" onMouseDown={handleSendToViewer} disabled={working}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer transition-colors hover:bg-[rgba(127,119,221,0.2)] disabled:opacity-40"
        style={{ background: 'rgba(127,119,221,0.15)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.3)' }}>
        <LayoutGrid size={12} /> {t('Send to viewer')}
      </button>

      <div className="w-[1px] h-4 bg-[rgba(255,255,255,0.1)] mx-1" />

      {/* Assign creator — elevated z so dropdown doesn't get clipped */}
      <span className="text-[rgba(255,255,255,0.3)] text-[13px]">{t('Creator')}</span>
      <div style={{ position: 'relative', zIndex: 80 }}>
        <CreatorFilter value={creatorId} onChange={setCreatorId} placeholder="Pick creator..." />
      </div>
      <button type="button"
        onMouseDown={() => { if (creatorId && !assignMutation.isPending && !working && selectedGalleryIds.length > 0) assignMutation.mutate() }}
        disabled={!creatorId || assignMutation.isPending || working || selectedGalleryIds.length === 0}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer disabled:opacity-40"
        style={{ background: 'rgba(127,119,221,0.3)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.5)' }}>
        <UserPlus size={12} /> {assignMutation.isPending ? t('Assigning…') : t('Assign')}
      </button>

      <div className="w-[1px] h-4 bg-[rgba(255,255,255,0.1)] mx-1" />

      {/* Bulk tag */}
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-[7px]" style={{ background: 'rgba(255,255,255,0.05)' }}>
        <Tag size={11} style={{ color: 'rgba(255,255,255,0.4)', flexShrink: 0 }} />
        <input value={tagInput} onChange={e => setTagInput(e.target.value)} disabled={working}
          placeholder={t('tag1, tag2…')}
          className="bg-transparent text-[13px] outline-none w-24 text-[rgba(255,255,255,0.8)] placeholder-[rgba(255,255,255,0.3)]" />
        <button type="button" onMouseDown={handleAddTags} disabled={!tagInput.trim() || working}
          className="text-[12px] px-2 py-0.5 rounded-[4px] cursor-pointer disabled:opacity-40"
          style={{ background: 'rgba(127,119,221,0.2)', color: '#CECBF6' }}>{t('Add')}</button>
      </div>

      <div className="w-[1px] h-4 bg-[rgba(255,255,255,0.1)] mx-1" />

      {/* Delete */}
      {confirmDel ? (
        <button onMouseDown={handleDelete} disabled={working}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer animate-pulse disabled:opacity-40"
          style={{ background: 'rgba(212,83,126,0.35)', color: '#F4C0D1' }}>
          <Trash2 size={12} /> {t('Confirm Delete')}
        </button>
      ) : (
        <button onMouseDown={() => setConfirmDel(true)} disabled={working}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer disabled:opacity-40"
          style={{ background: 'rgba(212,83,126,0.12)', color: '#F4C0D1', border: '0.5px solid rgba(212,83,126,0.25)' }}>
          <Trash2 size={12} /> {t('Delete')}
        </button>
      )}

      {/* Extract — only when all selected images share the same source gallery */}
      {(() => {
        const galleryIds = new Set(selectedImages.map(i => i.gallery_id).filter(Boolean))
        if (galleryIds.size !== 1) return null
        return (
          <>
            <div className="w-[1px] h-4 bg-[rgba(255,255,255,0.1)] mx-1" />
            <button type="button" onMouseDown={() => setShowExtract(true)} disabled={working}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer disabled:opacity-40"
              style={{ background: 'rgba(29,158,117,0.15)', color: '#9FE1CB', border: '0.5px solid rgba(29,158,117,0.3)' }}
              title={t('Move selected images to a brand-new gallery folder')}>
              <FolderOutput size={12} /> {t('Extract to gallery')}
            </button>
          </>
        )
      })()}

      <button type="button" onMouseDown={onCancel} disabled={working}
        className="text-[rgba(255,255,255,0.35)] hover:text-white cursor-pointer ml-auto disabled:opacity-40">
        <X size={14} />
      </button>

      {showExtract && (
        <ExtractModal
          selectedImages={selectedImages}
          onClose={() => setShowExtract(false)}
          onExtracted={() => { setShowExtract(false); onDone() }}
        />
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
const IMG_PAGE_SIZES = [25, 50, 100, 250, 500]

export default function ImageList({ onlyVideos = false }) {
  const [searchParams] = useSearchParams()

  // Persist filter state across navigation (separate keys for Photos vs Videos).
  // A tag link in the URL (?tag= / ?tags=) takes precedence and starts a fresh filter.
  const IL_STATE_KEY = onlyVideos ? 'vault_videolist_state' : 'vault_imagelist_state'
  const _ilInitial = useRef(null)
  if (_ilInitial.current === null) {
    const DEFAULTS = { search: '', sortBy: 'date_added', sortDir: 'desc', randomSeed: 0,
                       creatorId: null, creatorType: '', favOnly: false, franchise: '', period: '', activeTags: [] }
    const urlMulti = searchParams.get('tags')
    const urlSingle = searchParams.get('tag')
    const urlCreator = parseInt(searchParams.get('creator_id'), 10)
    if (urlMulti || urlSingle) {
      const tags = urlMulti ? urlMulti.split(',').map(t => t.trim()).filter(Boolean) : [urlSingle]
      _ilInitial.current = { ...DEFAULTS, activeTags: tags }
    } else if (!isNaN(urlCreator)) {
      // "View all" links from a creator profile start a fresh filter on that creator
      _ilInitial.current = { ...DEFAULTS, creatorId: urlCreator }
    } else {
      let saved = null
      try { saved = JSON.parse(sessionStorage.getItem(IL_STATE_KEY) || 'null') } catch {}
      _ilInitial.current = saved ? { ...DEFAULTS, ...saved } : DEFAULTS
    }
  }
  const _init = _ilInitial.current

  const [search, setSearch] = useState(_init.search)
  const [sortBy, setSortBy] = useState(_init.sortBy)
  const [sortDir, setSortDir] = useState(_init.sortDir)
  const [randomSeed, setRandomSeed] = useState(_init.randomSeed)
  const [creatorId, setCreatorId] = useState(_init.creatorId)
  const [creatorType, setCreatorType] = useState(_init.creatorType)
  const [favOnly, setFavOnly] = useState(_init.favOnly)
  const [franchise, setFranchise] = useState(_init.franchise)
  const [period, setPeriod] = useState(_init.period)
  const [videoOnly, setVideoOnly] = useState(onlyVideos)
  const [activeTags, setActiveTags] = useState(_init.activeTags)

  // Save filter state on every change so re-entry restores it (unless cleared)
  useEffect(() => {
    try {
      sessionStorage.setItem(IL_STATE_KEY, JSON.stringify({
        search, sortBy, sortDir, randomSeed, creatorId, creatorType, favOnly, franchise, period, activeTags,
      }))
    } catch {}
  }, [IL_STATE_KEY, search, sortBy, sortDir, randomSeed, creatorId, creatorType, favOnly, franchise, period, activeTags])
  const [viewerIdx, setViewerIdx] = useState(null)

  const [bulkMode, setBulkMode] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [imageCtxMenu, setImageCtxMenu] = useState(null) // { image, x, y }
  const [avatarFramePicker, setAvatarFramePicker] = useState(null) // { creatorId, image, mode }

  const queryClient = useQueryClient()
  const addToMultiViewer = useVaultStore(s => s.addToMultiViewer)
  const MAX = useVaultStore(s => s.MULTIVIEWER_MAX)
  const queue = useVaultStore(s => s.multiViewerQueue)
  const bumpAvatarBust   = useVaultStore(s => s.bumpAvatarBust)
  const t = useT()

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
  const filterKey = `${search}|${sortBy}|${sortDir}|${creatorId}|${creatorType}|${favOnly}|${franchise}|${period}|${onlyVideos}|${activeTags.join(',')}|${pageLimit}|${randomSeed}`
  const prevFilterKeyRef = useRef(filterKey)

  const { data: imagesPage, isLoading, isError } = useQuery({
    queryKey: ['images-list', search, sortBy, sortDir, creatorId, creatorType, favOnly, franchise, period, onlyVideos, activeTags.join(','), pageLimit, page, randomSeed],
    queryFn: () => imagesApi.list({
      search: search || undefined,
      sort_by: sortBy,
      sort_dir: sortDir,
      creator_id: creatorId || undefined,
      creator_type: creatorType || undefined,
      series: franchise || undefined,
      period: period || undefined,
      favorite: favOnly || undefined,
      is_video: onlyVideos ? true : false,   // Images tab = no videos; Videos tab = only videos
      tags: activeTags.length > 0 ? activeTags.join(',') : undefined,
      limit: pageLimit,
      skip: (page - 1) * pageLimit,
      _seed: randomSeed,
    }).then(r => ({
      items: r.data,
      total: parseInt(r.headers['x-total-count'] ?? '0', 10),
    })),
    placeholderData: keepPreviousData,
    staleTime: sortBy === 'random' ? Infinity : 1000 * 60 * 5,
  })
  const images     = imagesPage?.items
  const totalCount = imagesPage?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / pageLimit))

  // Filter/page-size changes always win and go back to page 1. Otherwise, if
  // the current page no longer exists under this filter (e.g. content was
  // deleted, or a stale page number was restored), snap back to the real
  // last page instead of showing a dead end.
  useEffect(() => {
    if (prevFilterKeyRef.current !== filterKey) {
      prevFilterKeyRef.current = filterKey
      setPage(1)
    } else if (!isLoading && totalCount > 0 && page > totalPages) {
      setPage(totalPages)
    }
  }, [filterKey, isLoading, totalCount, totalPages, page])

  // Scroll back to the top whenever the page number changes, so browsing
  // always resumes from the first item instead of a mid-scroll position.
  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'auto' })
  }, [page])

  // Period options reflect the CURRENT filter context (creator, type, franchise,
  // tags, video-only, etc.) but never the selected period itself.
  const periodKey = `${search}|${creatorId}|${creatorType}|${franchise}|${favOnly}|${onlyVideos}|${activeTags.join(',')}`
  const { data: periods = [] } = useQuery({
    queryKey: ['image-periods', periodKey],
    queryFn: () => imagesApi.periods({
      search: search || undefined,
      creator_id: creatorId || undefined,
      creator_type: creatorType || undefined,
      series: franchise || undefined,
      favorite: favOnly || undefined,
      is_video: onlyVideos ? true : false,
      tags: activeTags.length > 0 ? activeTags.join(',') : undefined,
    }).then(r => r.data),
  })

  // Auto-clear the selected period if the active filters no longer contain it.
  useEffect(() => {
    if (period && periods.length && !periods.some(p => p.value === period)) {
      setPeriod('')
    }
  }, [period, periods])

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
    setSortDir('desc')  // reset to default direction when switching sort column
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
          <h1 className="text-[24px] font-medium text-[rgba(255,255,255,0.9)]">{onlyVideos ? t('Videos') : t('Photos')}</h1>
          <div className="text-[13px] text-[rgba(255,255,255,0.3)] mt-0.5">
            {isLoading
              ? t('Loading…')
              : isError
                ? `Error loading ${onlyVideos ? 'videos' : 'photos'}`
                : images?.length === 0
                  ? t('No results')
                  : `${(page - 1) * pageLimit + 1}–${(page - 1) * pageLimit + (images?.length ?? 0)} shown of ${totalCount} · page ${page} of ${totalPages}`
            }
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="relative flex-1 min-w-[200px] max-w-[320px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.3)]" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('Search by filename…')}
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

        <SortDropdown value={sortBy} onChange={handleSortChange} options={SORTS} sortDir={sortDir} onSortDirChange={setSortDir} />

        <CreatorFilter value={creatorId} onChange={setCreatorId} />

        <CreatorTypeDropdown value={creatorType} onChange={setCreatorType} />

        <FranchiseFilter value={franchise} onChange={v => { setFranchise(v || ''); setPage(1) }} />

        <PeriodFilter value={period} periods={periods} onChange={v => { setPeriod(v || ''); setPage(1) }} />

        {/* Multi-tag filter with autocomplete */}
        <TagFilterInput
          activeTags={activeTags}
          onAdd={name => setActiveTags(prev => prev.includes(name) ? prev : [...prev, name])}
          onRemove={name => setActiveTags(prev => prev.filter(t => t !== name))}
          placeholder={t('Filter by tag…')}
          rounded="lg"
        />

        {toggleBtn(favOnly, () => setFavOnly(f => !f), t('★ Favorites'))}

        {/* Masonry Toggle — Only for Images view */}
        {!onlyVideos && (
          <button type="button" onMouseDown={toggleMasonry}
            className="flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-[8px] cursor-pointer"
            style={{
              background: masonryGrid ? 'rgba(127,119,221,0.2)' : 'rgba(255,255,255,0.05)',
              color: masonryGrid ? '#CECBF6' : 'rgba(255,255,255,0.45)',
              border: `0.5px solid ${masonryGrid ? 'rgba(127,119,221,0.4)' : 'rgba(255,255,255,0.08)'}`,
            }}
            title={t('Toggle Masonry Grid')}>
            <GripHorizontal size={11} /> {t('Masonry')}
          </button>
        )}

        <button type="button" onMouseDown={() => { setBulkMode(!bulkMode); setSelected(new Set()) }}
          className="flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-[8px] cursor-pointer ml-auto"
          style={{
            background: bulkMode ? 'rgba(127,119,221,0.2)' : 'rgba(255,255,255,0.05)',
            color: bulkMode ? '#CECBF6' : 'rgba(255,255,255,0.45)',
            border: `0.5px solid ${bulkMode ? 'rgba(127,119,221,0.4)' : 'rgba(255,255,255,0.08)'}`,
          }}>
          <CheckSquare size={11} /> {t('Select')}
        </button>
      </div>

      {/* Size controls */}
      <div className="flex items-center gap-3 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[rgba(255,255,255,0.3)]">{t('Size')}</span>
          <input type="range" min={80} max={400} step={10} value={thumbSize}
            onChange={e => setThumbSizeStore(Number(e.target.value))}
            className="w-24 h-1 cursor-pointer accent-[#7F77DD]" />
          <span className="text-[12px] text-[rgba(255,255,255,0.3)] w-8">{thumbSize}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[12px] text-[rgba(255,255,255,0.3)] mr-1">{t('Per page')}</span>
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
            {selected.size === images?.length ? t('Deselect all') : t('Select all')}
          </button>
          {selected.size > 0 && (
            <BulkActionPanel selectedImages={(images || []).filter(g => selected.has(g.id))} onDone={exitBulk} onCancel={exitBulk} />
          )}
        </div>
      )}

      {!isLoading && !isError && totalPages > 1 && (
        <div className="mb-4">
          <GalleryPagination page={page} totalPages={totalPages} onChange={setPage} t={t} id="images-top" />
        </div>
      )}

      {/* Grid */}
      {isLoading ? (
        <div className="text-[16px] text-[rgba(255,255,255,0.25)] py-20 text-center">{t('Loading…')}</div>
      ) : isError ? (
        <div className="text-[16px] text-[rgba(255,255,255,0.25)] py-20 text-center">{t('Failed to load images. Is the backend running?')}</div>
      ) : !images || images.length === 0 ? (
        <div className="text-[16px] text-[rgba(255,255,255,0.25)] py-20 text-center">{t('No images found')}</div>
      ) : (
        (!onlyVideos && masonryGrid) ? (
          <div className="grid-stagger" style={{ columns: `${thumbSize}px`, columnGap: '8px' }}>
            {images.map((img, i) => (
              <div key={img.id} style={{ breakInside: 'avoid', marginBottom: '8px' }}>
                <ImageThumb image={img} onClick={() => setViewerIdx(i)} bulkMode={bulkMode} selected={selected.has(img.id)} onSelect={toggleSelect}
                            onContextMenu={(im, e) => {
                              const inSel = bulkMode && selected.has(im.id)
                              const bulkImages = inSel ? (images || []).filter(i => selected.has(i.id)) : null
                              setImageCtxMenu({ image: im, x: e.clientX, y: e.clientY, bulkImages })
                            }} masonry />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-2 grid-stagger" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${thumbSize}px, 100%), ${thumbSize}px))` }}>
            {images.map((img, i) => (
              <ImageThumb key={img.id} image={img} onClick={() => setViewerIdx(i)} bulkMode={bulkMode} selected={selected.has(img.id)} onSelect={toggleSelect}
                          onContextMenu={(im, e) => {
                            const inSel = bulkMode && selected.has(im.id)
                            const bulkImages = inSel ? (images || []).filter(i => selected.has(i.id)) : null
                            setImageCtxMenu({ image: im, x: e.clientX, y: e.clientY, bulkImages })
                          }} />
            ))}
          </div>
        )
      )}

      {/* Pagination controls */}
      {!isLoading && !isError && totalPages > 1 && (
        <div className="mt-6">
          <GalleryPagination page={page} totalPages={totalPages} onChange={setPage} t={t} id="images-bottom" />
        </div>
      )}

      {/* Viewer */}
      {viewerIdx !== null && images?.length > 0 && (
        <ImageViewer images={images} startIdx={viewerIdx} onClose={() => setViewerIdx(null)} />
      )}

      {/* Image right-click context menu */}
      {imageCtxMenu && (
        <ImageContextMenu
          image={imageCtxMenu.image}
          bulkCount={imageCtxMenu.bulkImages?.length ?? null}
          position={{ x: imageCtxMenu.x, y: imageCtxMenu.y }}
          onClose={() => setImageCtxMenu(null)}
          onSelectMode={() => {
            setBulkMode(true)
            setSelected(new Set([imageCtxMenu.image.id]))
          }}
          onView={() => {
            const idx = images?.findIndex(i => i.id === imageCtxMenu.image.id) ?? -1
            if (idx >= 0) setViewerIdx(idx)
          }}
          onSendToViewer={() => {
            const targets = imageCtxMenu.bulkImages ?? [imageCtxMenu.image]
            let added = 0, skipped = 0
            for (const img of targets) {
              if (queue.length + added >= MAX) { skipped += targets.length - added; break }
              const ok = addToMultiViewer({ id: `img-${img.id}`, type: 'image', media: img })
              if (ok) added++; else skipped++
            }
            if (added > 0) toast.success(`${added} ${added === 1 ? 'image' : 'images'} sent to Multi-panel`)
            if (skipped > 0) toast(`${skipped} already queued or queue full`, { icon: 'ℹ️' })
          }}
          creators={imageCtxMenu.image.creators ?? []}
          onSetAsAvatar={(creatorId) => {
            if (imageCtxMenu.image.is_video) {
              setAvatarFramePicker({ creatorId, image: imageCtxMenu.image, mode: 'avatar' })
              return
            }
            creatorsApi.setAvatarFromImage(creatorId, imageCtxMenu.image.id)
              .then(() => { toast.success(t('Avatar updated!')); bumpAvatarBust(); queryClient.invalidateQueries({ queryKey: ['creator', String(creatorId)] }) })
              .catch(() => toast.error(t('Failed to set avatar')))
          }}
          onSetAsBanner={(creatorId) => {
            if (imageCtxMenu.image.is_video) {
              setAvatarFramePicker({ creatorId, image: imageCtxMenu.image, mode: 'banner' })
              return
            }
            creatorsApi.setBannerFromImage(creatorId, imageCtxMenu.image.id)
              .then(() => { toast.success(t('Banner updated!')); bumpAvatarBust(); queryClient.invalidateQueries({ queryKey: ['creator', String(creatorId)] }) })
              .catch(() => toast.error(t('Failed to set banner')))
          }}
          onDelete={async (mode) => {
            const targets = imageCtxMenu.bulkImages ?? [imageCtxMenu.image]
            let errs = 0
            for (const img of targets) {
              try { await imagesApi.delete(img.id, mode === 'vault') }
              catch { errs++ }
            }
            const n = targets.length - errs
            if (n > 0) toast.success(mode === 'vault'
              ? `${n} ${n === 1 ? 'image' : 'images'} removed from vault`
              : `${n} ${n === 1 ? 'image' : 'images'} deleted from disk`)
            if (errs > 0) toast.error(`${errs} deletion${errs > 1 ? 's' : ''} failed`)
            queryClient.invalidateQueries({ queryKey: ['images-list'] })
          }}
        />
      )}

      {/* Video frame picker for avatar / banner */}
      {avatarFramePicker && (
        <AvatarFramePicker
          creatorId={avatarFramePicker.creatorId}
          image={avatarFramePicker.image}
          mode={avatarFramePicker.mode}
          onClose={() => setAvatarFramePicker(null)}
        />
      )}
    </div>
  )
}

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Star, Droplets, Shuffle, Heart, ChevronLeft, ChevronRight,
  X, Images, ZoomIn, ZoomOut, UserPlus, Maximize, Minimize,
  Play, Pause, ExternalLink, Pencil, Trash2, ImagePlus, Sparkles, GitMerge,
  FolderOpen, Zap,
} from 'lucide-react'
import { galleriesApi, imagesApi, sessionsApi, creatorsApi, taggerApi } from '../lib/api'

const THUMB_SIZES = [80, 120, 160, 220, 300, 420]
import { useVaultStore } from '../store/vault'
import toast from 'react-hot-toast'
import { TagPanel, CreatorPanel, TransferPanel } from '../components/ViewerPanel'
import InlineVideoPlayer from '../components/InlineVideoPlayer'
import { SortDropdown } from '../components/SortDropdown'

const SORTS = [
  { value: 'filename',   label: 'Filename' },
  { value: 'sort_order', label: 'Default Order' },
  { value: 'date_added', label: 'Date Added' },
  { value: 'view_count', label: 'Most Viewed' },
  { value: 'cum_count',  label: 'Most Cummed' },
  { value: 'rating',     label: 'Rating' },
  { value: 'file_size',  label: 'File Size' },
  { value: 'random',     label: 'Random' },
]

const TYPE_COLORS = {
  cosplayer: '#9FE1CB', ethot: '#ED93B1', artist: '#CECBF6',
  character: '#FAC775', actress: '#ED93B1', custom: '#D3D1C7',
}

function CreatorAssignPanel({ galleryId, assignedCreators }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const wrapperRef = useRef(null)
  const qc = useQueryClient()

  const { data: allCreators } = useQuery({
    queryKey: ['creators-mini'],
    queryFn: () => creatorsApi.list({ limit: 200 }).then(r => r.data),
  })

  const filtered = useMemo(() => {
    if (!allCreators) return []
    const assignedIds = new Set(assignedCreators.map(c => c.id))
    return allCreators.filter(c =>
      !assignedIds.has(c.id) && c.name.toLowerCase().includes(search.toLowerCase())
    )
  }, [allCreators, assignedCreators, search])

  // Outside-click to close
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const addMutation = useMutation({
    mutationFn: (creatorId) => galleriesApi.addCreator(galleryId, creatorId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gallery', String(galleryId)] })
      qc.invalidateQueries({ queryKey: ['galleries'] })
      setSearch('')
      setOpen(false)
    },
    onError: (err) => toast.error(`Failed to assign creator: ${err.message}`)
  })

  const removeMutation = useMutation({
    mutationFn: (creatorId) => galleriesApi.removeCreator(galleryId, creatorId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gallery', String(galleryId)] })
      qc.invalidateQueries({ queryKey: ['galleries'] })
    },
    onError: (err) => toast.error(`Failed to remove creator: ${err.message}`)
  })

  return (
    <div ref={wrapperRef} className="rounded-[10px] p-3.5"
         style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-center justify-between mb-2.5">
        <div className="text-[11px] font-medium text-[rgba(255,255,255,0.5)] uppercase tracking-wider">Creators</div>
        <button type="button" onMouseDown={() => setOpen(o => !o)}
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-full cursor-pointer"
                style={{ background: 'rgba(127,119,221,0.15)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.3)' }}>
          <UserPlus size={10} /> Add
        </button>
      </div>

      {/* Assigned creators */}
      {assignedCreators.length === 0 ? (
        <div className="text-[11px] text-[rgba(255,255,255,0.2)] py-1">No creator assigned</div>
      ) : (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {assignedCreators.map(c => (
            <div key={c.id}
                 className="flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full text-[11px] group/chip"
                 style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)' }}>
              <span style={{ color: TYPE_COLORS[c.creator_type] || '#D3D1C7', fontWeight: 500 }}>{c.name}</span>
              <button type="button" onMouseDown={e => { e.stopPropagation(); removeMutation.mutate(c.id) }}
                      title="Remove creator"
                      className="cursor-pointer rounded-full w-4 h-4 flex items-center justify-center flex-shrink-0 transition-colors"
                      style={{ color: 'rgba(255,255,255,0.3)', background: 'transparent' }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#F4C0D1'; e.currentTarget.style.background = 'rgba(212,83,126,0.2)' }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.3)'; e.currentTarget.style.background = 'transparent' }}>
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Search dropdown */}
      {open && (
        <div className="mt-1 animate-menu-pop">
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search creators..."
            className="w-full px-2.5 py-1.5 rounded-[7px] text-[11px] text-[rgba(255,255,255,0.8)] placeholder-[rgba(255,255,255,0.25)] outline-none mb-1"
            style={{ background: 'rgba(255,255,255,0.07)', border: '0.5px solid rgba(255,255,255,0.12)' }}
          />
          <div className="rounded-[8px] overflow-hidden"
               style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.12)', maxHeight: 180, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-[rgba(255,255,255,0.25)] text-center">
                {search ? 'No creators found' : 'All creators already assigned'}
              </div>
            ) : filtered.map(c => (
              <button key={c.id}
                      type="button"
                      onMouseDown={() => addMutation.mutate(c.id)}
                      className="w-full text-left px-3 py-2 text-[11px] cursor-pointer hover:bg-[rgba(255,255,255,0.05)] flex items-center gap-2"
                      style={{ color: 'rgba(255,255,255,0.75)' }}>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: TYPE_COLORS[c.creator_type] || '#D3D1C7' }} />
                <span>{c.name}</span>
                <span className="text-[9px] ml-auto" style={{ color: 'rgba(255,255,255,0.25)' }}>{c.creator_type}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const ImageThumb = React.memo(function ImageThumb({ image, idx, onClick, onDeleted, galleryId }) {
  const [failed, setFailed] = useState(false)
  const [hoverVideo, setHoverVideo] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const videoRef = useRef(null)
  const hoverTimerRef = useRef(null)
  const qc = useQueryClient()

  const coverMutation = useMutation({
    mutationFn: () => galleriesApi.setCover(galleryId, image.id),
    onSuccess: () => {
      toast.success('Set as gallery cover!')
      qc.invalidateQueries({ queryKey: ['gallery', String(galleryId)] })
      qc.invalidateQueries({ queryKey: ['galleries'] })
    },
    onError: () => toast.error('Failed to set cover'),
  })

  const deleteMutation = useMutation({
    mutationFn: (keepFile) => imagesApi.delete(image.id, keepFile),
    onSuccess: (_, keepFile) => {
      toast.success(keepFile ? 'Removed from vault' : 'Deleted from disk')
      onDeleted(image.id)
      qc.invalidateQueries({ queryKey: ['gallery'] })
    },
    onError: () => toast.error('Delete failed'),
  })

  const handleMouseEnter = useCallback(() => {
    if (!image.is_video) return
    setHoverVideo(true)
    hoverTimerRef.current = setTimeout(() => setHoverVideo(false), 15000)
  }, [image.is_video])

  const handleMouseLeave = useCallback(() => {
    if (!image.is_video) return
    clearTimeout(hoverTimerRef.current)
    setHoverVideo(false)
    setConfirmDelete(false)
  }, [image.is_video])

  // Release video connection when component unmounts (e.g. navigating away from gallery).
  // Without this, detached <video> elements hold open HTTP connections until GC runs,
  // which saturates Chrome's 6-connection-per-origin limit and blocks the video viewer.
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
      // Set src here, not in JSX — prevents initial metadata requests for every video
      // in the gallery grid from consuming connection slots before the user even hovers.
      vid.src = `/api/images/${image.id}/file`
      const seekAndPlay = () => {
        if (vid.duration && !isNaN(vid.duration)) vid.currentTime = vid.duration * 0.5
        vid.play().catch(() => {})
      }
      if (vid.readyState >= 1) seekAndPlay()
      else { vid.load(); vid.addEventListener('loadedmetadata', seekAndPlay, { once: true }) }
    } else {
      // Tear down the media pipeline completely — pause() alone leaves the HTTP
      // connection open and buffering, saturating Chrome's 6-connection limit.
      vid.pause()
      vid.removeAttribute('src')
      vid.load()
    }
    return () => clearTimeout(hoverTimerRef.current)
  }, [hoverVideo, image.id])

  return (
    <div onMouseEnter={handleMouseEnter}
         onMouseLeave={handleMouseLeave}
         className="relative rounded-[8px] overflow-hidden group animate-fade-in"
         style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.07)', aspectRatio: '1' }}>
      <div onClick={() => onClick(idx)} className="cursor-pointer w-full h-full">
        {!failed
          ? <img
              src={`/api/images/${image.id}/thumb`}
              alt={image.filename}
              loading="lazy" decoding="async"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
              style={{ transform: hoverVideo ? 'scale(1)' : undefined }}
              onError={() => setFailed(true)}
            />
          : <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-2">
              <Images size={20} style={{ color: 'rgba(255,255,255,0.1)' }} />
              <div className="text-[8px] text-[rgba(255,255,255,0.2)] text-center truncate w-full">{image.filename}</div>
            </div>
        }
        {image.is_video && (
          <video ref={videoRef}
                 muted playsInline preload="none"
                 className="absolute inset-0 w-full h-full object-cover transition-opacity duration-200"
                 style={{ opacity: hoverVideo ? 1 : 0, zIndex: 2, pointerEvents: 'none' }} />
        )}
        {image.is_video && !hoverVideo && (
          <div className="absolute top-1 right-1 z-[3] text-white opacity-80" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }}>
            <Play size={12} fill="currentColor" />
          </div>
        )}
        {image.cum_count > 0 && (
          <div className="absolute bottom-1 right-1 flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full z-[3]"
               style={{ background: 'rgba(0,0,0,0.75)', color: '#ED93B1' }}>
            <Droplets size={8} /> {image.cum_count}
          </div>
        )}
        {image.rating > 0 && (
          <div className="absolute top-1 left-1 text-[9px] px-1.5 py-0.5 rounded-full z-[3]"
               style={{ background: 'rgba(0,0,0,0.75)', color: '#EF9F27' }}>
            {'★'.repeat(Math.round(image.rating))}
          </div>
        )}
      </div>

      {/* Delete button — appears on hover */}
      <button
        onClick={(e) => { e.stopPropagation(); setConfirmDelete(c => !c) }}
        className="absolute bottom-1 left-1 z-[4] opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded-full flex items-center justify-center cursor-pointer"
        style={{ background: 'rgba(0,0,0,0.75)', color: 'rgba(255,80,80,0.8)' }}>
        <Trash2 size={10} />
      </button>

      {/* Set as cover button — top-right on hover */}
      {galleryId && !image.is_video && (
        <button
          onClick={(e) => { e.stopPropagation(); coverMutation.mutate() }}
          title="Set as gallery cover"
          className="absolute top-1 right-1 z-[4] opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded-full flex items-center justify-center cursor-pointer"
          style={{ background: 'rgba(0,0,0,0.75)', color: 'rgba(127,119,221,0.9)' }}>
          <ImagePlus size={11} />
        </button>
      )}

      {/* Confirm popover */}
      {confirmDelete && (
        <div className="absolute bottom-8 left-0 z-[10] rounded-[8px] overflow-hidden shadow-xl"
             style={{ background: '#1a1a1a', border: '0.5px solid rgba(255,255,255,0.15)', minWidth: 140 }}
             onClick={e => e.stopPropagation()}>
          <div className="px-2 py-1.5 text-[9px] text-[rgba(255,255,255,0.4)] uppercase tracking-wider border-b border-[rgba(255,255,255,0.06)]">
            Remove photo
          </div>
          <button
            onClick={() => { setConfirmDelete(false); deleteMutation.mutate(true) }}
            className="w-full text-left px-2.5 py-2 text-[11px] cursor-pointer hover:bg-[rgba(255,255,255,0.06)]"
            style={{ color: 'rgba(255,255,255,0.7)' }}>
            Vault only
          </button>
          <button
            onClick={() => { setConfirmDelete(false); deleteMutation.mutate(false) }}
            className="w-full text-left px-2.5 py-2 text-[11px] cursor-pointer hover:bg-[rgba(255,80,80,0.15)]"
            style={{ color: 'rgba(255,100,100,0.9)' }}>
            Delete from disk
          </button>
        </div>
      )}
    </div>
  )
}, (prev, next) =>
  prev.image     === next.image     &&
  prev.idx       === next.idx       &&
  prev.galleryId === next.galleryId
)

const SLIDESHOW_SPEEDS = [3, 5, 8, 12]

function fmtVideoTime(s) {
  if (!s || !isFinite(s)) return '0:00'
  const h   = Math.floor(s / 3600)
  const m   = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
  return `${m}:${String(sec).padStart(2,'0')}`
}

function ImageViewer({ images, startIdx, galleryId, galleryName, onClose }) {
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
  const [slideshowActive, setSlideshowActive] = useState(false)
  const [slideshowSpeed, setSlideshowSpeed] = useState(5)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const [showFilmstrip, setShowFilmstrip] = useState(true)
  const [localTags, setLocalTags] = useState([])
  const [localCreators, setLocalCreators] = useState([])
  const [localFunscript, setLocalFunscript] = useState(null)

  const dragStart          = useRef({ x: 0, y: 0 })
  const stageRef           = useRef(null)
  const viewerRef          = useRef(null)
  const speedMenuRef       = useRef(null)
  const viewStartRef       = useRef(null)
  const viewTimerRef       = useRef(null)
  const filmstripTimer     = useRef(null)
  const isFullscreenRef    = useRef(false)
  const videoPlayerRef     = useRef(null)
  const funscriptInputRef  = useRef(null)
  const sessionActive   = useVaultStore(s => s.sessionActive)
  const startSession    = useVaultStore(s => s.startSession)
  const endSession      = useVaultStore(s => s.endSession)
  const addXpToast      = useVaultStore(s => s.addXpToast)
  const qc              = useQueryClient()
  const image = images[idx]

  // Sync local state when image changes; track view count and time spent
  useEffect(() => {
    if (!image) return
    setLocalTags(image?.tags ?? [])
    setLocalCreators(image?.creators ?? [])
    setRating(image?.rating || 0)
    setIsFavorite(image?.is_favorite ?? false)
    setCumCount(image?.cum_count ?? 0)
    setLiveViewCount(image.view_count)
    // Debounce view tracking — skip the API call if user navigates away within 1s
    clearTimeout(viewTimerRef.current)
    if (!image.is_video) {
      viewTimerRef.current = setTimeout(() => {
        imagesApi.view(image.id).then(r => setLiveViewCount(r.data.view_count)).catch(() => {})
      }, 1000)
    }
    viewStartRef.current = Date.now()

    return () => {
      // Log time spent when navigating away from this image
      if (viewStartRef.current) {
        const secs = Math.round((Date.now() - viewStartRef.current) / 1000)
        if (secs >= 2) imagesApi.logDuration(image.id, secs).catch(() => {})
        viewStartRef.current = null
      }
    }
  }, [image?.id])

  const resetZoom = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])
  useEffect(() => { resetZoom() }, [idx])
  useEffect(() => { setLocalFunscript(null) }, [idx])
  // Reset LQIP state whenever the image changes
  useEffect(() => { setFullLoaded(false) }, [idx])

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      viewerRef.current?.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
      clearTimeout(filmstripTimer.current)
    }
  }, [])

  useEffect(() => {
    const handler = () => {
      const fs = !!document.fullscreenElement
      isFullscreenRef.current = fs
      setIsFullscreen(fs)
      clearTimeout(filmstripTimer.current)
      if (fs) {
        setShowFilmstrip(false)
      } else {
        setShowFilmstrip(true)
      }
    }
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // Slideshow auto-advance
  useEffect(() => {
    if (!slideshowActive) return
    const id = setInterval(() => setIdx(i => (i + 1) % images.length), slideshowSpeed * 1000)
    return () => clearInterval(id)
  }, [slideshowActive, slideshowSpeed, images.length])

  // Keyboard: arrows + space (slideshow toggle) + escape
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT') return
      if (e.key === 'Escape') { if (zoom > 1) resetZoom(); else onClose(); return }
      if (e.key === 'ArrowLeft') {
        if (image.is_video) videoPlayerRef.current?.seek(-3)
        else { setSlideshowActive(false); setIdx(i => Math.max(0, i - 1)) }
      }
      if (e.key === 'ArrowRight') {
        if (image.is_video) videoPlayerRef.current?.seek(3)
        else { setSlideshowActive(false); setIdx(i => Math.min(images.length - 1, i + 1)) }
      }
      if (e.key === ' ') {
        e.preventDefault()
        if (image.is_video) videoPlayerRef.current?.togglePlay()
        else setSlideshowActive(a => !a)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [images.length, onClose, zoom, resetZoom])

  // Outside-click for speed menu
  useEffect(() => {
    const handler = (e) => {
      if (speedMenuRef.current && !speedMenuRef.current.contains(e.target)) setShowSpeedMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Mouse move — drag pan + show chrome briefly in fullscreen
  const handleMouseMove = useCallback((e) => {
    if (dragging) {
      setPan({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y })
    }
    if (!isFullscreenRef.current) return
    setShowFilmstrip(true)
    clearTimeout(filmstripTimer.current)
    filmstripTimer.current = setTimeout(() => setShowFilmstrip(false), 2000)
  }, [dragging])

  // Non-passive wheel listener for zoom (works for both images and videos)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      setZoom(z => {
        const next = Math.min(Math.max(z * factor, 1), 8)
        if (next === 1) setPan({ x: 0, y: 0 })
        return next
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const handleStageMouseDown = (e) => {
    if (zoom <= 1) return
    e.preventDefault()
    setDragging(true)
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }
  const handleMouseUp = () => setDragging(false)

  const cumMutation = useMutation({
    mutationFn: () => imagesApi.cum(image.id, { gallery_id: galleryId }),
    onSuccess: () => {
      setCumCount(c => c + 1)
      addXpToast('+5 XP')
      qc.invalidateQueries({ queryKey: ['gallery-images', String(galleryId)] })
    }
  })

  const rateMutation = useMutation({
    mutationFn: (r) => imagesApi.update(image.id, { rating: r }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gallery-images', String(galleryId)] })
  })

  const favMutation = useMutation({
    mutationFn: (val) => imagesApi.update(image.id, { is_favorite: val }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gallery-images', String(galleryId)] })
  })

  const sessionMutation = useMutation({
    mutationFn: (data = {}) => sessionsApi.log({ image_id: image.id, gallery_id: galleryId, ...data }).then(r => r.data),
    onSuccess: (data) => {
      addXpToast(`+${data.xp_earned} XP`)
      toast.success('Session logged ❤️')
    }
  })

  if (!image) return null
  const isZoomed = zoom > 1

  return (
    <div
      ref={viewerRef}
      className="fixed inset-0 z-50 flex"
      style={{
        background: '#090909',
        cursor: isFullscreen && !showFilmstrip ? 'none' : 'default',
      }}
      onMouseMove={handleMouseMove}
    >
      {/* Main stage — always relative so absolute children fill it */}
      <div className="flex-1 relative min-w-0">
        {/* Topbar — always an absolute overlay; fades out only in fullscreen when mouse idle */}
        <div
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
            height: 44, display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px',
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.82) 0%, transparent 100%)',
            opacity: isFullscreen && !showFilmstrip ? 0 : 1,
            pointerEvents: isFullscreen && !showFilmstrip ? 'none' : 'auto',
            transition: 'opacity 0.25s ease',
          }}>
          <button onMouseDown={onClose} className="cursor-pointer text-[rgba(255,255,255,0.4)] hover:text-white">
            <X size={16} />
          </button>
          <span className="text-[13px] text-[rgba(255,255,255,0.4)]">{idx + 1} / {images.length}</span>
          <span className="text-[13px] text-[rgba(255,255,255,0.55)] truncate">{image.filename}</span>
          <div className="ml-auto flex items-center gap-1.5">
            {/* Quick favorite star */}
            <button
              onMouseDown={() => { const next = !isFavorite; setIsFavorite(next); favMutation.mutate(next) }}
              className="cursor-pointer p-1 rounded transition-colors"
              style={{ color: isFavorite ? '#EF9F27' : 'rgba(255,255,255,0.3)' }}
              title={isFavorite ? 'Remove favorite' : 'Add to favorites'}>
              <Star size={14} fill={isFavorite ? '#EF9F27' : 'none'} />
            </button>
            {/* Slideshow controls */}
            <div ref={speedMenuRef} className="relative flex items-center gap-1.5">
              <button
                onMouseDown={() => setSlideshowActive(a => !a)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-[13px] font-medium cursor-pointer"
                style={slideshowActive
                  ? { background: 'rgba(127,119,221,0.3)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.5)' }
                  : { background: 'rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.6)', border: '0.5px solid rgba(255,255,255,0.15)' }
                }
                title="Play/Pause slideshow (Space)">
                {slideshowActive ? <Pause size={13} /> : <Play size={13} />}
                <span>{slideshowActive ? 'Pause' : 'Play'}</span>
              </button>
              <button
                onMouseDown={() => setShowSpeedMenu(s => !s)}
                className="px-2.5 py-1.5 rounded-[7px] text-[13px] font-medium cursor-pointer"
                style={{ background: 'rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.55)', border: '0.5px solid rgba(255,255,255,0.15)' }}
                title="Slideshow speed">
                {slideshowSpeed}s
              </button>
              {showSpeedMenu && (
                <div className="absolute top-full right-0 mt-1 rounded-[8px] overflow-hidden shadow-xl z-50"
                     style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.12)' }}>
                  {SLIDESHOW_SPEEDS.map(s => (
                    <button key={s}
                            onMouseDown={() => { setSlideshowSpeed(s); setShowSpeedMenu(false) }}
                            className="w-full text-left px-4 py-1.5 text-[13px] cursor-pointer hover:bg-[rgba(255,255,255,0.06)]"
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
            <button onMouseDown={() => setZoom(z => Math.min(z * 1.4, 8))}
                    className="cursor-pointer text-[rgba(255,255,255,0.35)] hover:text-white p-1 rounded"
                    title="Zoom in (scroll wheel)">
              <ZoomIn size={14} />
            </button>
            <button onMouseDown={resetZoom}
                    className="cursor-pointer text-[rgba(255,255,255,0.35)] hover:text-white p-1 rounded"
                    title="Reset zoom">
              <ZoomOut size={14} />
            </button>
            <button onMouseDown={toggleFullscreen}
                    className="cursor-pointer text-[rgba(255,255,255,0.35)] hover:text-white p-1 rounded"
                    title="Fullscreen">
              {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
            </button>
          </div>
        </div>

        {/* Image/Video stage — always fills parent via absolute inset-0 */}
        <div
          ref={stageRef}
          className="absolute inset-0 flex items-center justify-center overflow-hidden select-none"
          style={{
            background: '#060606',
            cursor: isZoomed ? (dragging ? 'grabbing' : 'grab') : (image.is_video ? 'crosshair' : 'zoom-in'),
          }}
          onMouseDown={handleStageMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={image.is_video ? undefined : (isZoomed ? resetZoom : () => setZoom(2.5))}
        >
          {image.is_video ? (
            <InlineVideoPlayer
              ref={videoPlayerRef}
              key={image.id}
              src={`/api/images/${image.id}/file`}
              imageId={image.id}
              funscriptPath={image.funscript_path}
              overrideFunscript={localFunscript}
              onViewTracked={() => imagesApi.view(image.id).then(r => setLiveViewCount(r.data.view_count)).catch(() => {})}
              videoZoom={zoom}
              videoPan={pan}
              isFullscreen={isFullscreen}
              showControls={showFilmstrip}
            />
          ) : (
            <>
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
                onDoubleClick={(e) => { e.stopPropagation(); isZoomed ? resetZoom() : setZoom(2.5) }}
              />
            </>
          )}
          {!isZoomed && idx > 0 && (
            <button onMouseDown={() => { setSlideshowActive(false); setIdx(i => i - 1) }}
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
          {!isZoomed && idx < images.length - 1 && (
            <button onMouseDown={() => { setSlideshowActive(false); setIdx(i => i + 1) }}
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
          {isZoomed && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[10px] px-3 py-1.5 rounded-full pointer-events-none z-20"
                 style={{ background: 'rgba(0,0,0,0.6)', color: 'rgba(255,255,255,0.4)' }}>
              Double-click or Esc to reset · Drag to pan
            </div>
          )}
          {slideshowActive && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 text-[10px] px-3 py-1.5 rounded-full pointer-events-none flex items-center gap-1.5 z-20"
                 style={{ background: 'rgba(127,119,221,0.25)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.4)' }}>
              <Play size={9} /> Slideshow · {slideshowSpeed}s · Space to pause
            </div>
          )}
        </div>

        {/* Filmstrip — always absolute overlay at bottom; fades out in fullscreen when mouse idle */}
        <div
          className="flex gap-1.5 px-3 py-2 overflow-x-auto"
          style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20,
            height: 64,
            background: 'linear-gradient(to top, rgba(0,0,0,0.82) 0%, transparent 100%)',
            opacity: image.is_video || (isFullscreen && !showFilmstrip) ? 0 : 1,
            pointerEvents: image.is_video || (isFullscreen && !showFilmstrip) ? 'none' : 'auto',
            transition: 'opacity 0.25s ease',
          }}>
          {images.map((img, i) => (
            <div key={img.id}
                 onMouseDown={() => { setSlideshowActive(false); setIdx(i) }}
                 className="w-12 h-12 rounded-[5px] overflow-hidden flex-shrink-0 cursor-pointer"
                 style={{ border: `1.5px solid ${i === idx ? '#7F77DD' : 'rgba(255,255,255,0.06)'}`, background: 'rgba(255,255,255,0.04)' }}>
              <img src={`/api/images/${img.id}/thumb`} alt=""
                   loading="lazy" decoding="async"
                   className="w-full h-full object-cover"
                   onError={e => { e.target.style.display = 'none' }} />
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — hidden in fullscreen */}
      {!isFullscreen && <div className="w-56 flex-shrink-0 flex flex-col overflow-y-auto"
           style={{ background: '#141414', borderLeft: '0.5px solid rgba(255,255,255,0.07)' }}>

        {/* Creators */}
        <CreatorPanel
          galleryId={galleryId}
          creators={localCreators}
          onCreatorsChanged={setLocalCreators}
        />

        {/* Gallery name + set cover */}
        {galleryName && (
          <div className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
            <div className="text-[10px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-1">Gallery</div>
            <div className="flex items-center gap-1 text-[11px] text-[rgba(255,255,255,0.65)] truncate mb-2">
              <span className="truncate">{galleryName}</span>
              <ExternalLink size={9} className="flex-shrink-0 opacity-40" />
            </div>
            {!image?.is_video && (
              <button
                onClick={() => galleriesApi.setCover(galleryId, image.id).then(() => toast.success('Set as gallery cover!')).catch(() => toast.error('Failed'))}
                className="flex items-center gap-1.5 w-full px-2.5 py-1.5 rounded-[6px] text-[11px] cursor-pointer"
                style={{ background: 'rgba(127,119,221,0.12)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.25)' }}>
                <ImagePlus size={11} /> Set as cover
              </button>
            )}
          </div>
        )}

        {/* Funscript loader — videos only */}
        {image.is_video && (
          <div className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
            <div className="text-[10px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-2">Funscript</div>
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
                <div className="flex items-center gap-1 text-[10px]" style={{ color: '#CECBF6' }}>
                  <Zap size={10} fill="currentColor" /> Custom script loaded
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => funscriptInputRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-[6px] text-[10px] cursor-pointer"
                    style={{ background: 'rgba(127,119,221,0.12)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.25)' }}>
                    <FolderOpen size={10} /> Replace
                  </button>
                  <button onClick={() => setLocalFunscript(null)}
                    className="flex items-center justify-center px-2 py-1.5 rounded-[6px] text-[10px] cursor-pointer"
                    style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                    <X size={10} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {image.funscript_path
                  ? <div className="text-[10px] flex items-center gap-1" style={{ color: 'rgba(127,119,221,0.7)' }}><Zap size={10} /> Script attached</div>
                  : <div className="text-[10px] text-[rgba(255,255,255,0.25)]">No script attached</div>
                }
                <button onClick={() => funscriptInputRef.current?.click()}
                  className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-[6px] text-[10px] cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                  <FolderOpen size={10} /> Load .funscript
                </button>
              </div>
            )}
          </div>
        )}

        {/* Cum counter */}
        <div className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
          <div className="text-[10px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-2">Cum counter</div>
          <div className="flex items-center gap-2">
            <button onMouseDown={() => cumMutation.mutate()}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-[8px] text-[12px] font-medium cursor-pointer active:scale-95 transition-transform"
                    style={{ background: 'rgba(212,83,126,0.2)', color: '#F4C0D1', border: '0.5px solid rgba(212,83,126,0.4)' }}>
              <Droplets size={13} /> Count it
            </button>
            <div className="text-center min-w-[36px]">
              <div className="text-[22px] font-medium leading-none" style={{ color: '#ED93B1' }}>{cumCount ?? 0}</div>
              <div className="text-[9px] text-[rgba(255,255,255,0.25)] mt-0.5">all time</div>
            </div>
          </div>
        </div>

        {/* Rating */}
        <div className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
          <div className="text-[10px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-2">Rating</div>
          <div className="flex gap-1">
            {[1,2,3,4,5].map(s => (
              <button key={s}
                      onMouseDown={() => { setRating(s); rateMutation.mutate(s) }}
                      className="text-[22px] cursor-pointer leading-none"
                      style={{ color: s <= rating ? '#EF9F27' : 'rgba(255,255,255,0.1)' }}>
                ★
              </button>
            ))}
          </div>
        </div>

        {/* Tags */}
        <TagPanel imageId={image.id} tags={localTags} onTagsChanged={setLocalTags} />

        {/* Info */}
        <div className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
          <div className="text-[10px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-2">Info</div>
          {image.width && (
            <div className="flex justify-between py-0.5">
              <span className="text-[10px] text-[rgba(255,255,255,0.3)]">Size</span>
              <span className="text-[10px] text-[rgba(255,255,255,0.6)]">{image.width}×{image.height}</span>
            </div>
          )}
          {image.file_size && (
            <div className="flex justify-between py-0.5">
              <span className="text-[10px] text-[rgba(255,255,255,0.3)]">File</span>
              <span className="text-[10px] text-[rgba(255,255,255,0.6)]">{(image.file_size / 1024 / 1024).toFixed(1)} MB</span>
            </div>
          )}
          <div className="flex justify-between py-0.5">
            <span className="text-[10px] text-[rgba(255,255,255,0.3)]">Views</span>
            <span className="text-[10px] text-[rgba(255,255,255,0.6)]">{liveViewCount ?? image.view_count}</span>
          </div>
        </div>

        {/* Transfer */}
        <TransferPanel
          imageId={image.id}
          currentGalleryId={galleryId}
          onTransferred={() => { toast.success('Image transferred!'); onClose() }}
        />

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
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-[8px] text-[11px] font-medium cursor-pointer"
                  style={{ background: 'rgba(212,83,126,0.15)', color: '#F4C0D1', border: '0.5px solid rgba(212,83,126,0.3)' }}>
            <Heart size={12} /> {sessionActive ? 'Stop Session' : 'Start Session'}
          </button>
        </div>
      </div>}
    </div>
  )
}

function SimilarCard({ g, onClick }) {
  const [failed, setFailed] = React.useState(false)
  return (
    <div onClick={onClick}
         className="rounded-[10px] overflow-hidden cursor-pointer group"
         style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
      <div className="overflow-hidden" style={{ height: 130, background: 'rgba(255,255,255,0.03)' }}>
        {g.cover_thumb && !failed
          ? <img src={g.cover_thumb} alt={g.name}
                 className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                 onError={() => setFailed(true)} />
          : <div className="w-full h-full flex items-center justify-center opacity-10">
              <Images size={28} />
            </div>
        }
      </div>
      <div className="p-2">
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>{g.name}</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>{g.shared_tags} shared tags</div>
      </div>
    </div>
  )
}

// ── Similar Galleries strip ───────────────────────────────────────────────────
function SimilarGalleriesStrip({ galleryId }) {
  const navigate = useNavigate()
  const { data: similar } = useQuery({
    queryKey: ['similar-galleries', galleryId],
    queryFn: () => galleriesApi.similar(galleryId, 6).then(r => r.data),
    enabled: !!galleryId,
    staleTime: 120000,
  })
  if (!similar || similar.length === 0) return null
  return (
    <div className="mt-8 relative z-10">
      <div className="flex items-center gap-2 mb-3">
        <span style={{ fontSize: 17, fontWeight: 500, color: 'rgba(255,255,255,0.85)' }}>More Like This</span>
        <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)' }}>galleries sharing the most tags</span>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {similar.map(g => <SimilarCard key={g.id} g={g} onClick={() => navigate(`/galleries/${g.id}`)} />)}
      </div>
    </div>
  )
}

// ── Gallery Merge Modal ───────────────────────────────────────────────────────
function MergeModal({ gallery, onClose, onMerged }) {
  const qc = useQueryClient()
  const [search, setSearch]             = useState('')
  const [targetId, setTargetId]         = useState(null)
  const [targetGallery, setTargetGallery] = useState(null)
  const [moveFiles, setMoveFiles]       = useState(true)
  const [collision, setCollision]       = useState('rename')  // rename | replace | skip
  const [step, setStep]                 = useState('pick')    // pick | confirm
  const [merging, setMerging]           = useState(false)

  const { data: allGalleries } = useQuery({
    queryKey: ['galleries-mini'],
    queryFn: () => galleriesApi.list({ limit: 2000, sort_by: 'name' }).then(r => r.data),
    staleTime: 30000,
  })

  const filtered = useMemo(() => {
    if (!allGalleries) return []
    const q = search.toLowerCase().trim()
    return allGalleries
      .filter(g => g.id !== gallery.id && (!q || g.name.toLowerCase().includes(q)))
      .slice(0, 40)
  }, [allGalleries, search, gallery.id])

  const selectTarget = (g) => {
    setTargetId(g.id)
    setTargetGallery(g)
    setSearch(g.name)
  }

  const proceed = () => {
    if (!targetId) return
    setStep('confirm')
  }

  const doMerge = async () => {
    setMerging(true)
    try {
      const res = await galleriesApi.merge(targetId, {
        source_id: gallery.id,
        move_files: moveFiles,
        collision_strategy: collision,
      })
      const d = res.data
      const parts = []
      const totalMoved = (d.moved ?? 0) + (d.renamed ?? 0) + (d.replaced ?? 0) + (d.db_only ?? 0)
      if (totalMoved > 0) parts.push(`${totalMoved} images merged`)
      if (d.skipped > 0)  parts.push(`${d.skipped} skipped`)
      toast.success(parts.join(', ') || 'Merged')
      qc.invalidateQueries({ queryKey: ['gallery', String(gallery.id)] })
      qc.invalidateQueries({ queryKey: ['gallery', String(targetId)] })
      qc.invalidateQueries({ queryKey: ['galleries'] })
      onMerged(d)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Merge failed')
      setMerging(false)
    }
  }

  const sourceCreators = gallery.creators ?? []
  const targetCreators = targetGallery?.creators ?? []
  const newCreators = sourceCreators.filter(
    sc => !targetCreators.some(tc => tc.id === sc.id)
  )

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
         style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
         onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rounded-[14px] w-full max-w-md flex flex-col gap-0 overflow-hidden"
           style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.12)', maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(255,255,255,0.07)]">
          <div className="flex items-center gap-2">
            <GitMerge size={16} style={{ color: '#CECBF6' }} />
            <span style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>Merge gallery</span>
          </div>
          <button onClick={onClose} className="cursor-pointer" style={{ color: 'rgba(255,255,255,0.4)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-4">
          {step === 'pick' ? (
            <>
              {/* Source info */}
              <div className="rounded-[8px] px-3 py-2.5"
                   style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 2 }}>Merging FROM (will be absorbed)</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{gallery.name}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>{gallery.image_count ?? 0} images</div>
              </div>

              {/* Target picker */}
              <div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>Merge INTO (target gallery, keeps its name)</div>
                <input
                  value={search}
                  onChange={e => { setSearch(e.target.value); setTargetId(null); setTargetGallery(null) }}
                  placeholder="Search galleries…"
                  className="w-full rounded-[8px] px-3 py-2 outline-none"
                  style={{ fontSize: 13, background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)' }}
                />
                {targetId && targetGallery ? (
                  <div className="mt-2 flex items-center justify-between px-3 py-2 rounded-[8px]"
                       style={{ background: 'rgba(127,119,221,0.15)', border: '0.5px solid rgba(127,119,221,0.4)' }}>
                    <span style={{ fontSize: 13, color: '#CECBF6', fontWeight: 600 }}>{targetGallery.name}</span>
                    <button onClick={() => { setTargetId(null); setTargetGallery(null); setSearch('') }}
                            className="cursor-pointer" style={{ color: 'rgba(255,255,255,0.35)' }}>
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  filtered.length > 0 && search && (
                    <div className="mt-1 rounded-[8px] overflow-hidden overflow-y-auto"
                         style={{ background: '#161620', border: '0.5px solid rgba(255,255,255,0.1)', maxHeight: 180 }}>
                      {filtered.map(g => (
                        <button key={g.id} onClick={() => selectTarget(g)}
                                className="w-full text-left px-3 py-2 flex items-center justify-between cursor-pointer transition-colors"
                                style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', borderBottom: '0.5px solid rgba(255,255,255,0.05)' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(127,119,221,0.1)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <span>{g.name}</span>
                          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>{g.image_count ?? 0} imgs</span>
                        </button>
                      ))}
                    </div>
                  )
                )}
              </div>

              {/* Move files toggle */}
              <div className="flex items-start justify-between gap-3 pt-2 border-t border-[rgba(255,255,255,0.06)]">
                <div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>Move files on disk</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                    {moveFiles
                      ? 'Files will be physically moved into the target folder'
                      : 'Only database records update — files stay where they are'}
                  </div>
                </div>
                <button onClick={() => setMoveFiles(v => !v)} className="flex-shrink-0 mt-0.5"
                        style={{ width: 38, height: 20, borderRadius: 10, background: moveFiles ? 'rgba(127,119,221,0.6)' : 'rgba(255,255,255,0.1)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s' }}>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: moveFiles ? 'calc(100% - 17px)' : '3px', transition: 'left 0.2s' }} />
                </button>
              </div>

              {/* Collision strategy — only when moving files */}
              {moveFiles && (
                <div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>If a filename already exists in the target folder</div>
                  <div className="flex gap-2">
                    {[
                      { key: 'rename',  label: 'Rename',  desc: 'Add _1, _2…' },
                      { key: 'replace', label: 'Replace', desc: 'Overwrite' },
                      { key: 'skip',    label: 'Skip',    desc: 'Leave in source' },
                    ].map(({ key, label, desc }) => (
                      <button key={key} onClick={() => setCollision(key)}
                              className="flex-1 px-2 py-2 rounded-[8px] text-center cursor-pointer"
                              style={{
                                background: collision === key ? 'rgba(127,119,221,0.2)' : 'rgba(255,255,255,0.04)',
                                border: `0.5px solid ${collision === key ? 'rgba(127,119,221,0.5)' : 'rgba(255,255,255,0.08)'}`,
                              }}>
                        <div style={{ fontSize: 12, color: collision === key ? '#CECBF6' : 'rgba(255,255,255,0.6)', fontWeight: 600 }}>{label}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>{desc}</div>
                      </button>
                    ))}
                  </div>
                  {collision === 'replace' && (
                    <div className="mt-2 px-3 py-2 rounded-[8px]"
                         style={{ background: 'rgba(212,83,126,0.1)', border: '0.5px solid rgba(212,83,126,0.3)', fontSize: 11, color: '#F4C0D1' }}>
                      ⚠ Replace will permanently delete existing files in the target folder that share a filename with source files.
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            /* Confirmation step */
            <>
              <div className="rounded-[8px] px-3 py-3 flex flex-col gap-1"
                   style={{ background: 'rgba(186,117,23,0.1)', border: '1px solid rgba(186,117,23,0.35)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#FAC775' }}>⚠ Confirm merge</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, marginTop: 2 }}>
                  <b style={{ color: 'rgba(255,255,255,0.85)' }}>{gallery.name}</b> will be merged into <b style={{ color: 'rgba(255,255,255,0.85)' }}>{targetGallery?.name}</b>.
                  {gallery.image_count > 0 && <> Its {gallery.image_count} images will be reassigned.</>}
                </div>
              </div>

              {moveFiles ? (
                <div className="rounded-[8px] px-3 py-2.5 flex flex-col gap-1"
                     style={{ background: 'rgba(212,83,126,0.08)', border: '0.5px solid rgba(212,83,126,0.3)' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#F4C0D1' }}>Files will be moved on disk</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
                    All images from <span style={{ color: 'rgba(255,255,255,0.7)' }}>{gallery.folder_path}</span> will be physically moved to <span style={{ color: 'rgba(255,255,255,0.7)' }}>{targetGallery?.folder_path}</span>.
                    Filename conflicts: <b style={{ color: 'rgba(255,255,255,0.7)' }}>{collision}</b>.
                  </div>
                </div>
              ) : (
                <div className="rounded-[8px] px-3 py-2.5"
                     style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)', fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
                  Database records only — files will stay in their current locations on disk.
                </div>
              )}

              {newCreators.length > 0 && (
                <div className="rounded-[8px] px-3 py-2.5"
                     style={{ background: 'rgba(29,158,117,0.08)', border: '0.5px solid rgba(29,158,117,0.3)', fontSize: 12, color: '#9FE1CB' }}>
                  Creator{newCreators.length > 1 ? 's' : ''} <b>{newCreators.map(c => c.name).join(', ')}</b> will be added to the target gallery.
                </div>
              )}

              {collision === 'skip' && moveFiles && (
                <div className="rounded-[8px] px-3 py-2.5"
                     style={{ background: 'rgba(186,117,23,0.08)', border: '0.5px solid rgba(186,117,23,0.3)', fontSize: 12, color: '#FAC775' }}>
                  Skipped images will remain in the source gallery. If any are skipped, the source gallery will not be deleted.
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer buttons */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[rgba(255,255,255,0.07)]">
          {step === 'pick' ? (
            <>
              <button onClick={onClose} className="px-4 py-2 rounded-[8px] text-[13px] cursor-pointer"
                      style={{ color: 'rgba(255,255,255,0.45)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                Cancel
              </button>
              <button onClick={proceed} disabled={!targetId}
                      className="px-4 py-2 rounded-[8px] text-[13px] cursor-pointer disabled:opacity-40"
                      style={{ background: 'rgba(127,119,221,0.2)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.4)' }}>
                Review →
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setStep('pick')} disabled={merging}
                      className="px-4 py-2 rounded-[8px] text-[13px] cursor-pointer disabled:opacity-40"
                      style={{ color: 'rgba(255,255,255,0.45)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                ← Back
              </button>
              <button onClick={doMerge} disabled={merging}
                      className="px-4 py-2 rounded-[8px] text-[13px] cursor-pointer disabled:opacity-40 flex items-center gap-2"
                      style={{ background: merging ? 'rgba(127,119,221,0.15)' : 'rgba(127,119,221,0.25)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.5)' }}>
                {merging ? <><span className="animate-spin inline-block">⟳</span> Merging…</> : <><GitMerge size={13} /> Confirm merge</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  , document.body)
}


export default function GalleryView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const qc = useQueryClient()
  const addXpToast = useVaultStore(s => s.addXpToast)
  const [viewerIdx, setViewerIdx] = useState(null)
  const [sortBy, setSortBy] = useState('filename')
  const [randomSeed, setRandomSeed] = useState(0)
  const [isRenaming, setIsRenaming] = useState(false)
  const [editName, setEditName] = useState('')
  const [retagging, setRetagging]           = useState(false)
  const [showMergeModal, setShowMergeModal] = useState(false)
  const [showPeriodPicker, setShowPeriodPicker] = useState(false)
  const [deletedIds, setDeletedIds] = useState(new Set())
  const [periodMonth, setPeriodMonth] = useState(null)
  const [periodYear, setPeriodYear] = useState(null)
  const [thumbSizeIdx, setThumbSizeIdx] = useState(2) // default: 160px
  const retagPollRef = useRef(null)

  useEffect(() => {
    return () => {
      if (retagPollRef.current) clearInterval(retagPollRef.current)
      // viewTimerRef lives inside ImageViewer — no cleanup needed here
    }
  }, [])

  const handleSortChange = (val) => {
    if (val === 'random') {
      const newSeed = Math.random()
      setRandomSeed(newSeed)
    }
    setSortBy(val)
  }

  // Track gallery visit — fires once per gallery navigation
  useEffect(() => {
    galleriesApi.view(id).catch(() => {})
  }, [id])

  const { data: gallery } = useQuery({
    queryKey: ['gallery', id],
    queryFn: () => galleriesApi.get(id).then(r => r.data),
  })

  const { data: images } = useQuery({
    queryKey: ['gallery-images', id, sortBy, randomSeed],
    queryFn: ({ queryKey }) => {
      const [, galleryId, sort, seed] = queryKey
      return galleriesApi.images(galleryId, { sort_by: sort, _seed: seed }).then(r => r.data)
    },
    gcTime: 5 * 60 * 1000,  // cache for 5 min — returning to a gallery is instant
  })

  // Auto-open image from ?openImage= query param (e.g. from HOF click)
  useEffect(() => {
    const openImageId = searchParams.get('openImage')
    if (openImageId && images?.length) {
      const idx = images.findIndex(img => img.id === parseInt(openImageId))
      if (idx !== -1) setViewerIdx(idx)
    }
  }, [images, searchParams])

  const favMutation = useMutation({
    mutationFn: () => galleriesApi.update(id, { is_favorite: !gallery?.is_favorite }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gallery', id] })
  })

  const renameMutation = useMutation({
    mutationFn: (newName) => galleriesApi.update(id, { name: newName }),
    onSuccess: () => {
      toast.success('Gallery renamed')
      qc.invalidateQueries({ queryKey: ['gallery', id] })
      qc.invalidateQueries({ queryKey: ['galleries'] })
      setIsRenaming(false)
    },
    onError: () => {
      toast.error('Rename failed')
      setIsRenaming(false)
    }
  })

  const submitRename = () => {
    if (editName.trim() && editName.trim() !== gallery?.name) {
      renameMutation.mutate(editName.trim())
    } else {
      setIsRenaming(false)
    }
  }

  const cumMutation = useMutation({
    mutationFn: () => galleriesApi.cum(id),
    onSuccess: (r) => {
      addXpToast('+5 XP')
      qc.invalidateQueries({ queryKey: ['gallery', id] })
    }
  })

  const periodMutation = useMutation({
    mutationFn: ({ month, year }) => galleriesApi.update(id, { period_month: month || null, period_year: year || null }),
    onSuccess: () => {
      toast.success('Period saved')
      qc.invalidateQueries({ queryKey: ['gallery', id] })
      qc.invalidateQueries({ queryKey: ['galleries'] })
      setShowPeriodPicker(false)
    },
    onError: () => toast.error('Failed to save period'),
  })

  // Sync picker state when gallery loads
  useEffect(() => {
    if (gallery) {
      setPeriodMonth(gallery.period_month ?? null)
      setPeriodYear(gallery.period_year ?? null)
    }
  }, [gallery?.period_month, gallery?.period_year])

  const handleRetag = async () => {
    if (retagging || !gallery?.folder_path) return
    setRetagging(true)
    try {
      await taggerApi.start({ scope: 'folder', folder_path: gallery.folder_path, threshold: 0.35, retag: true })
      // Poll until the tagger finishes
      if (retagPollRef.current) clearInterval(retagPollRef.current)
      retagPollRef.current = setInterval(async () => {
        try {
          const { data } = await taggerApi.status()
          if (!data.running) {
            if (retagPollRef.current) {
              clearInterval(retagPollRef.current)
              retagPollRef.current = null
            }
            setRetagging(false)
            toast.success(`Tagged ${data.tagged} images`)
            qc.invalidateQueries({ queryKey: ['gallery-images', id] })
          }
        } catch {
          if (retagPollRef.current) {
            clearInterval(retagPollRef.current)
            retagPollRef.current = null
          }
          setRetagging(false)
        }
      }, 1500)
    } catch (e) {
      toast.error('Tagger error — is a model downloaded?')
      setRetagging(false)
    }
  }

  return (
    <div className="p-5 relative">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(-1)}
                className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-[7px] cursor-pointer"
                style={{ color: 'rgba(255,255,255,0.45)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
          <ArrowLeft size={13} /> Back
        </button>
        <div className="min-w-0 flex-1">
          {isRenaming ? (
            <input
              autoFocus
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setIsRenaming(false) }}
              onBlur={submitRename}
              disabled={renameMutation.isPending}
              className="text-[16px] font-medium text-[rgba(255,255,255,0.9)] bg-transparent border-none outline-none w-full"
              style={{ borderBottom: '1px solid rgba(127,119,221,0.5)', paddingBottom: '1px' }}
            />
          ) : (
            <div className="flex items-center gap-2 group/title cursor-pointer w-max" onClick={() => { setEditName(gallery?.name || ''); setIsRenaming(true) }}>
              <div className="text-[16px] font-medium text-[rgba(255,255,255,0.9)] truncate">{gallery?.name ?? '...'}</div>
              <button className="opacity-0 group-hover/title:opacity-100 transition-opacity text-[rgba(255,255,255,0.35)] hover:text-white flex-shrink-0" title="Rename gallery"><Pencil size={13} /></button>
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-[rgba(255,255,255,0.35)]">
              {gallery?.image_count ?? 0} photos
            </span>
            {/* Period badge */}
            {gallery?.period_month && gallery?.period_year ? (
              <button
                onClick={() => setShowPeriodPicker(p => !p)}
                className="text-[10px] px-2 py-0.5 rounded-full cursor-pointer"
                style={{ background: 'rgba(29,158,117,0.15)', color: '#9FE1CB', border: '0.5px solid rgba(29,158,117,0.3)' }}>
                {new Date(gallery.period_year, gallery.period_month - 1).toLocaleString('default', { month: 'short', year: 'numeric' })}
              </button>
            ) : (
              <button
                onClick={() => setShowPeriodPicker(p => !p)}
                className="text-[10px] px-2 py-0.5 rounded-full cursor-pointer opacity-40 hover:opacity-70"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                + period
              </button>
            )}
          </div>
          {/* Period picker dropdown */}
          {showPeriodPicker && (
            <div className="flex items-center gap-2 mt-1.5 p-2 rounded-[8px]"
                 style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
              <select
                value={periodMonth ?? ''}
                onChange={e => setPeriodMonth(e.target.value ? parseInt(e.target.value) : null)}
                className="text-[11px] rounded-[6px] px-2 py-1 outline-none cursor-pointer"
                style={{ background: '#1a1a1a', color: 'rgba(255,255,255,0.8)', border: '0.5px solid rgba(255,255,255,0.12)' }}>
                <option value="">Month</option>
                {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                  <option key={i+1} value={i+1}>{m}</option>
                ))}
              </select>
              <select
                value={periodYear ?? ''}
                onChange={e => setPeriodYear(e.target.value ? parseInt(e.target.value) : null)}
                className="text-[11px] rounded-[6px] px-2 py-1 outline-none cursor-pointer"
                style={{ background: '#1a1a1a', color: 'rgba(255,255,255,0.8)', border: '0.5px solid rgba(255,255,255,0.12)' }}>
                <option value="">Year</option>
                {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <button
                onClick={() => periodMutation.mutate({ month: periodMonth, year: periodYear })}
                disabled={periodMutation.isPending}
                className="text-[10px] px-2.5 py-1 rounded-full cursor-pointer"
                style={{ background: 'rgba(29,158,117,0.2)', color: '#9FE1CB', border: '0.5px solid rgba(29,158,117,0.3)' }}>
                Save
              </button>
              <button
                onClick={() => setShowPeriodPicker(false)}
                className="text-[10px] text-[rgba(255,255,255,0.3)] hover:text-white cursor-pointer">
                ✕
              </button>
            </div>
          )}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button onClick={() => favMutation.mutate()}
                  className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-full cursor-pointer"
                  style={{
                    background: gallery?.is_favorite ? 'rgba(186,117,23,0.2)' : 'rgba(255,255,255,0.05)',
                    color: gallery?.is_favorite ? '#FAC775' : 'rgba(255,255,255,0.4)',
                    border: '0.5px solid rgba(255,255,255,0.1)',
                  }}>
            <Star size={12} />
          </button>
          <button onClick={() => cumMutation.mutate()}
                  className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-full cursor-pointer"
                  style={{ background: 'rgba(212,83,126,0.15)', color: '#F4C0D1', border: '0.5px solid rgba(212,83,126,0.3)' }}>
            <Droplets size={12} /> {gallery?.cum_count ?? 0}
          </button>
          <SortDropdown value={sortBy} onChange={handleSortChange} options={SORTS} />
          {/* Size slider */}
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-full"
               style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
            <Images size={11} style={{ color: 'rgba(255,255,255,0.35)', flexShrink: 0 }} />
            <input
              type="range" min={0} max={THUMB_SIZES.length - 1} step={1}
              value={thumbSizeIdx}
              onChange={e => setThumbSizeIdx(Number(e.target.value))}
              className="cursor-pointer"
              style={{ width: 64, accentColor: '#7F77DD' }}
            />
          </div>
          <button onClick={handleRetag} disabled={retagging}
                  title="AI-tag all images in this gallery"
                  className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-full cursor-pointer disabled:opacity-50 transition-all"
                  style={{
                    background: retagging ? 'rgba(127,119,221,0.25)' : 'rgba(127,119,221,0.1)',
                    color: retagging ? '#CECBF6' : 'rgba(255,255,255,0.4)',
                    border: `0.5px solid ${retagging ? 'rgba(127,119,221,0.5)' : 'rgba(255,255,255,0.1)'}`,
                  }}>
            <Sparkles size={12} className={retagging ? 'animate-pulse' : ''} />
            {retagging ? 'Tagging…' : 'AI Tag'}
          </button>
          <button onClick={() => setShowMergeModal(true)}
                  title="Merge this gallery into another"
                  className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-full cursor-pointer transition-all"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
            <GitMerge size={12} />
            Merge
          </button>
        </div>
      </div>

      {/* Creator assignment */}
      {gallery && (
        <div className="mb-4 relative z-10">
          <CreatorAssignPanel
            galleryId={parseInt(id)}
            assignedCreators={gallery.creators ?? []}
          />
        </div>
      )}

      {/* Image grid */}
      <div className="relative z-10" />
      {!images
        ? <div className="text-center py-12 text-[rgba(255,255,255,0.3)] text-[13px]">Loading...</div>
        : images.length === 0
          ? <div className="text-center py-16 text-[rgba(255,255,255,0.25)] text-[13px]">No images in this gallery</div>
          : <div className="grid gap-2 grid-stagger" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${THUMB_SIZES[thumbSizeIdx]}px, 1fr))` }}>
              {images.filter(img => !deletedIds.has(img.id)).map((img, i) => (
                <ImageThumb key={img.id} image={img} idx={i} onClick={setViewerIdx}
                            galleryId={parseInt(id)}
                            onDeleted={(imgId) => setDeletedIds(s => new Set([...s, imgId]))} />
              ))}
            </div>
      }

      {/* More Like This */}
      <SimilarGalleriesStrip galleryId={parseInt(id)} />

      {/* Viewer */}
      {viewerIdx !== null && images?.length > 0 && (
        <ImageViewer
          images={images}
          startIdx={viewerIdx}
          galleryId={parseInt(id)}
          galleryName={gallery?.name}
          onClose={() => setViewerIdx(null)}
        />
      )}

      {/* Merge modal */}
      {showMergeModal && gallery && (
        <MergeModal
          gallery={gallery}
          onClose={() => setShowMergeModal(false)}
          onMerged={(result) => {
            setShowMergeModal(false)
            if (result.source_deleted) {
              // This gallery was absorbed — navigate to the target
              navigate(`/galleries/${result.target_id}`)
            }
          }}
        />
      )}
    </div>
  )
}

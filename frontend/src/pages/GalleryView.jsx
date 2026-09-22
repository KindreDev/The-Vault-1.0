import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Star, Droplets, Shuffle, Heart, ChevronLeft, ChevronRight,
  X, Images, ZoomIn, ZoomOut, UserPlus, Maximize, Minimize,
  Play, Pause, ExternalLink, Pencil, Trash2, ImagePlus, Sparkles, GitMerge,
  FolderOpen, Zap, CheckSquare, Square, FolderOutput, HardDrive, Tag, Copy, ListMusic,
  Waves, Search,
} from 'lucide-react'
import { galleriesApi, imagesApi, sessionsApi, creatorsApi, taggerApi, apiErrorMessage } from '../lib/api'
import { patchCachedCreators } from '../lib/creatorCache'
import { logEdgeNow } from '../lib/edges'
import SlideshowEndScreen from '../components/viewer/SlideshowEndScreen'
import SlideshowControls, { isTimedMedia } from '../components/viewer/SlideshowControls'
import SubgalleriesPanel from '../components/SubgalleriesPanel'
import { useT } from '../i18n'
import { useSession } from '../hooks/useSession'
import ImageContextMenu from '../components/ImageContextMenu'
import RelocateModal from '../components/RelocateModal'
import AvatarFramePicker from '../components/AvatarFramePicker'
import TagAutocompleteInput from '../components/TagAutocompleteInput'
import { isGif, armSlideTimer, armVideoWatchdog } from '../lib/gif'
import GalleryTransferModal from '../components/GalleryTransferModal'
import { useViewerHotkeys } from '../hooks/useViewerHotkeys'
import { ratingHandlers, videoHandlers } from '../lib/viewerActions'

const THUMB_SIZES = [80, 120, 160, 220, 300, 420]
// Large galleries can contain several thousand files. Keep the full metadata
// list available for search, selection, and viewer navigation, but mount the
// thumbnail grid in small browseable batches so React and the browser do not
// have to build thousands of interactive tiles on the first paint.
const GALLERY_RENDER_BATCH = 240
import { useVaultStore } from '../store/vault'
import toast from 'react-hot-toast'
import { TagPanel, CreatorPanel } from '../components/ViewerPanel'
import { useAllCreators } from '../hooks/useAllCreators'
import DeviceControls from '../components/DeviceControls'
import InlineVideoPlayer from '../components/InlineVideoPlayer'
import { SortDropdown } from '../components/SortDropdown'
import { useScrollLock } from '../hooks/useScrollLock'

const SORTS = [
  { value: 'filename',   label: 'Filename' },
  { value: 'sort_order', label: 'Default Order' },
  { value: 'date_added', label: 'Date Added' },
  { value: 'date_modified', label: 'Date Modified' },
  { value: 'view_count', label: 'Most Viewed' },
  { value: 'cum_count',  label: 'Most Cummed' },
  { value: 'rating',     label: 'Rating' },
  { value: 'file_size',  label: 'File Size' },
  { value: 'random',     label: 'Random' },
]
const GALLERY_SORT_STORAGE_KEY = 'vault_galleryview_sort'

function readSavedGallerySort() {
  try {
    const saved = localStorage.getItem(GALLERY_SORT_STORAGE_KEY)
    return SORTS.some(option => option.value === saved) ? saved : 'filename'
  } catch {
    return 'filename'
  }
}

const TYPE_COLORS = {
  cosplayer: '#9FE1CB', ethot: '#ED93B1', artist: '#CECBF6',
  character: '#FAC775', actress: '#ED93B1', custom: '#D3D1C7',
}

function CreatorAssignPanel({ galleryId, assignedCreators, galleryImages = [], totalItems = 0 }) {
  const t = useT()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const wrapperRef = useRef(null)
  const qc = useQueryClient()

  const { data: allCreators } = useAllCreators()
  const creatorById = useMemo(
    () => new Map((allCreators ?? []).map(c => [c.id, c])),
    [allCreators]
  )

  // A gallery-level creator is inherited by every file, while file-level
  // assignments can add a creator to only part of the gallery. Build the
  // cards from the effective creator lists returned with each image so the
  // percentage is an honest share of files, not just a count of assignments.
  const creatorEntries = useMemo(() => {
    const assignedIds = new Set(assignedCreators.map(c => c.id))
    const creators = new Map()
    const addCreator = (creator) => {
      if (!creator?.id || creators.has(creator.id)) return
      creators.set(creator.id, { ...(creatorById.get(creator.id) ?? {}), ...creator })
    }

    assignedCreators.forEach(addCreator)
    galleryImages.forEach(image => (image.creators ?? []).forEach(addCreator))

    const total = galleryImages.length || Number(totalItems) || 0
    const counts = new Map([...creators.keys()].map(id => [id, 0]))
    if (galleryImages.length) {
      galleryImages.forEach(image => {
        const ids = image.creators?.length
          ? new Set(image.creators.map(c => c.id))
          : assignedIds
        ids.forEach(id => { if (counts.has(id)) counts.set(id, counts.get(id) + 1) })
      })
    } else {
      assignedIds.forEach(id => counts.set(id, total))
    }

    return [...creators.values()]
      .map(creator => {
        const count = counts.get(creator.id) ?? 0
        return {
          creator,
          count,
          percentage: total ? Math.round((count / total) * 100) : 0,
          galleryAssigned: assignedIds.has(creator.id),
        }
      })
      .sort((a, b) => b.count - a.count || a.creator.name.localeCompare(b.creator.name))
  }, [allCreators, assignedCreators, creatorById, galleryImages, totalItems])

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
         style={{ background: 'color-mix(in srgb, var(--c-card, #1e1e1e) 80%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 16%, rgba(255,255,255,0.08))' }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-[16px] font-semibold text-[rgba(255,255,255,0.9)] uppercase tracking-wide">{t('Creators')}</div>
          <div className="text-[16px] text-[rgba(255,255,255,0.45)] mt-0.5">
            {creatorEntries.length} {creatorEntries.length === 1 ? t('creator') : t('creators')} {t('in this gallery')}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {creatorEntries.length > 0 && (
            <button type="button" onMouseDown={() => navigate('/creators')}
                    className="flex items-center gap-1.5 text-[16px] px-3 py-1.5 rounded-full cursor-pointer"
                    style={{ background: 'color-mix(in srgb, var(--c-card, #1e1e1e) 75%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 28%, transparent)' }}>
              {t('View all creators')} <ChevronRight size={16} />
            </button>
          )}
          <button type="button" onMouseDown={() => setOpen(o => !o)}
                  className="flex items-center gap-1.5 text-[16px] px-3 py-1.5 rounded-full cursor-pointer"
                  style={{ background: 'color-mix(in srgb, var(--c-accent) 15%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
            <UserPlus size={16} /> {t('Add creator')}
          </button>
        </div>
      </div>

      {creatorEntries.length === 0 ? (
        <div className="text-[16px] text-[rgba(255,255,255,0.35)] py-2">{t('No creator assigned')}</div>
      ) : (
        <div className="grid gap-2.5" style={{
          gridTemplateColumns: creatorEntries.length === 1
            ? 'minmax(min(100%, 520px), max-content)'
            : 'repeat(auto-fill, minmax(220px, 1fr))',
          maxHeight: creatorEntries.length > 8 ? 420 : undefined,
          overflowY: creatorEntries.length > 8 ? 'auto' : undefined,
          paddingRight: creatorEntries.length > 8 ? 4 : undefined,
        }}>
          {creatorEntries.map(({ creator: c, count, percentage, galleryAssigned }) => {
            const color = TYPE_COLORS[c.creator_type] || '#D3D1C7'
            const singleCreator = creatorEntries.length === 1
            return (
            <div key={c.id}
                 onMouseDown={() => navigate(`/creators/${c.id}`)}
                 className="relative rounded-[12px] p-3.5 cursor-pointer transition-transform hover:-translate-y-0.5"
                 style={{
                   width: singleCreator ? 'fit-content' : undefined,
                   maxWidth: '100%',
                   background: `color-mix(in srgb, ${color} 8%, var(--c-card, #1e1e1e))`,
                   border: `0.5px solid color-mix(in srgb, ${color} 35%, rgba(255,255,255,0.1))`,
                 }}>
              <div className="flex items-start gap-3">
                <div className="w-16 h-16 rounded-[12px] overflow-hidden flex items-center justify-center flex-shrink-0"
                     style={{ background: `color-mix(in srgb, ${color} 18%, var(--c-surface, #161616))`, border: `1px solid color-mix(in srgb, ${color} 45%, transparent)` }}>
                  {c.avatar_path ? (
                    <img src={`/api/creators/${c.id}/avatar-thumb?size=160`} alt="" className="w-full h-full object-cover"
                         onError={e => { e.currentTarget.style.display = 'none' }} />
                  ) : (
                    <span className="text-[24px] font-semibold" style={{ color }}>{(c.name || '?').charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className={singleCreator ? 'flex-none' : 'min-w-0 flex-1'}>
                  <div className={`text-[18px] font-semibold text-[rgba(255,255,255,0.92)] ${singleCreator ? 'whitespace-nowrap' : 'truncate'}`}
                       style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.name}
                  </div>
                  <div className="inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-[16px]"
                       style={{ color, background: `color-mix(in srgb, ${color} 13%, transparent)`, border: `0.5px solid color-mix(in srgb, ${color} 42%, transparent)` }}>
                    {t(c.creator_type || 'custom')}
                  </div>
                </div>
                {galleryAssigned && (
                  <button type="button" onMouseDown={e => { e.stopPropagation(); removeMutation.mutate(c.id) }}
                          title={t('Remove creator')}
                          className="cursor-pointer rounded-full w-7 h-7 flex items-center justify-center flex-shrink-0"
                          style={{ color: 'rgba(255,255,255,0.38)', background: 'rgba(255,255,255,0.05)' }}>
                    <X size={16} />
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between mt-3 text-[16px]">
                <span style={{ color: `color-mix(in srgb, ${color} 85%, white)` }}>{count} {t('photos')}</span>
                <span className="font-semibold" style={{ color }}>{percentage}%</span>
              </div>
              <div className="h-2 rounded-full mt-2 overflow-hidden" style={{ background: 'rgba(255,255,255,0.11)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${percentage}%`, background: color }} />
              </div>
            </div>
          )})}
        </div>
      )}

      {/* Search dropdown */}
      {open && (
        <div className="mt-1 animate-menu-pop">
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('Search creators...')}
            className="w-full px-3 py-2 rounded-[9px] text-[16px] text-[rgba(255,255,255,0.8)] placeholder-[rgba(255,255,255,0.25)] outline-none mb-1"
            style={{ background: 'rgba(255,255,255,0.07)', border: '0.5px solid rgba(255,255,255,0.12)' }}
          />
          <div className="rounded-[8px] overflow-hidden"
               style={{ background: 'var(--c-card, #1e1e1e)', border: '0.5px solid rgba(255,255,255,0.12)', maxHeight: 220, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[16px] text-[rgba(255,255,255,0.25)] text-center">
                {search ? t('No creators found') : t('All creators already assigned')}
              </div>
            ) : filtered.map(c => (
              <button key={c.id}
                      type="button"
                      onMouseDown={() => addMutation.mutate(c.id)}
                      className="w-full text-left px-3 py-2.5 text-[16px] cursor-pointer hover:bg-[rgba(255,255,255,0.05)] flex items-center gap-2"
                      style={{ color: 'rgba(255,255,255,0.75)' }}>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: TYPE_COLORS[c.creator_type] || '#D3D1C7' }} />
                <span>{c.name}</span>
                <span className="text-[16px] ml-auto" style={{ color: 'rgba(255,255,255,0.35)' }}>{t(c.creator_type || 'custom')}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}



const ImageThumb = React.memo(function ImageThumb({ image, idx, onClick, onDeleted, galleryId, bulkMode, selected, onSelect, onContextMenu }) {
  const [failed, setFailed] = useState(false)
  const [hoverVideo, setHoverVideo] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const videoRef = useRef(null)
  const hoverTimerRef = useRef(null)
  const qc = useQueryClient()
  const t = useT()

  const coverMutation = useMutation({
    mutationFn: () => galleriesApi.setCover(galleryId, image.id),
    onSuccess: () => {
      toast.success(t('Set as gallery cover!'))
      qc.invalidateQueries({ queryKey: ['gallery', String(galleryId)] })
      qc.invalidateQueries({ queryKey: ['galleries'] })
    },
    onError: () => toast.error(t('Failed to set cover')),
  })

  const deleteMutation = useMutation({
    mutationFn: (keepFile) => imagesApi.delete(image.id, keepFile),
    onSuccess: (_, keepFile) => {
      toast.success(keepFile ? t('Removed from vault') : t('Deleted from disk'))
      onDeleted(image.id)
      qc.invalidateQueries({ queryKey: ['gallery'] })
    },
    onError: (e) => toast.error(`${t('Delete failed')}: ${apiErrorMessage(e, t('Could not delete from disk'))}`),
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
         onContextMenu={(e) => { e.preventDefault(); onContextMenu?.(image, e) }}
         className="relative rounded-[8px] overflow-hidden group animate-fade-in"
         style={{ background: 'rgba(255,255,255,0.04)', border: `0.5px solid ${selected ? 'color-mix(in srgb, var(--c-accent) 60%, transparent)' : 'rgba(255,255,255,0.07)'}`, aspectRatio: '1' }}>

      {/* Bulk select overlay. onMouseDown: shift+click natively drags a text
          selection across the grid — suppress it so range-selecting doesn't
          smear blue highlight over every tile. */}
      {bulkMode && (
        <div className="absolute top-1.5 left-1.5 z-[20]"
             onMouseDown={(e) => { if (e.shiftKey) e.preventDefault() }}
             onClick={(e) => { e.stopPropagation(); onSelect?.(image.id, idx, e.shiftKey) }}>
          {selected
            ? <CheckSquare size={15} style={{ color: 'var(--c-accent)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }} />
            : <Square size={15} style={{ color: 'rgba(255,255,255,0.6)', fill: 'rgba(0,0,0,0.5)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }} />
          }
        </div>
      )}
      {selected && (
        <div className="absolute inset-0 z-[5] pointer-events-none rounded-[8px]"
             style={{ background: 'color-mix(in srgb, var(--c-accent) 18%, transparent)' }} />
      )}

      <div onMouseDown={(e) => { if (e.shiftKey) e.preventDefault() }}
           onClick={(e) => bulkMode ? onSelect?.(image.id, idx, e.shiftKey) : onClick(idx)}
           className="cursor-pointer w-full h-full">
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
        {(image.cum_count > 0 || image.edge_count > 0) && (
          <div className="absolute bottom-1 right-1 flex items-center gap-1 z-[3]">
            {image.cum_count > 0 && (
              <div className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full"
                   style={{ background: 'rgba(0,0,0,0.75)', color: 'var(--c-pink-text)' }}>
                <Droplets size={8} /> {image.cum_count}
              </div>
            )}
            {image.edge_count > 0 && (
              <div className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full"
                   style={{ background: 'rgba(0,0,0,0.75)', color: 'var(--c-accent-text)' }}>
                <Waves size={8} /> {image.edge_count}
              </div>
            )}
          </div>
        )}
        {image.rating > 0 && (
          <div className="absolute top-1 left-1 text-[10px] px-1.5 py-0.5 rounded-full z-[3] font-medium"
               style={{ background: 'rgba(0,0,0,0.75)', color: '#EF9F27' }}>
            ★ {image.rating}
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
          title={t('Set as gallery cover')}
          className="absolute top-1 right-1 z-[4] opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded-full flex items-center justify-center cursor-pointer"
          style={{ background: 'rgba(0,0,0,0.75)', color: 'color-mix(in srgb, var(--c-accent) 90%, transparent)' }}>
          <ImagePlus size={11} />
        </button>
      )}

      {/* Confirm popover */}
      {confirmDelete && (
        <div className="absolute bottom-8 left-0 z-[10] rounded-[8px] overflow-hidden shadow-xl"
             style={{ background: '#1a1a1a', border: '0.5px solid rgba(255,255,255,0.15)', minWidth: 140 }}
             onClick={e => e.stopPropagation()}>
          <div className="px-2 py-1.5 text-[9px] text-[rgba(255,255,255,0.4)] uppercase tracking-wider border-b border-[rgba(255,255,255,0.06)]">
            {t('Remove photo')}
          </div>
          <button
            onClick={() => { setConfirmDelete(false); deleteMutation.mutate(true) }}
            className="w-full text-left px-2.5 py-2 text-[11px] cursor-pointer hover:bg-[rgba(255,255,255,0.06)]"
            style={{ color: 'rgba(255,255,255,0.7)' }}>
            {t('Vault only')}
          </button>
          <button
            onClick={() => { setConfirmDelete(false); deleteMutation.mutate(false) }}
            className="w-full text-left px-2.5 py-2 text-[11px] cursor-pointer hover:bg-[rgba(255,80,80,0.15)]"
            style={{ color: 'rgba(255,100,100,0.9)' }}>
            {t('Delete from disk')}
          </button>
        </div>
      )}
    </div>
  )
}, (prev, next) =>
  prev.image     === next.image     &&
  prev.idx       === next.idx       &&
  prev.galleryId === next.galleryId &&
  prev.bulkMode  === next.bulkMode  &&
  prev.selected  === next.selected
)


function fmtVideoTime(s) {
  if (!s || !isFinite(s)) return '0:00'
  const h   = Math.floor(s / 3600)
  const m   = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
  return `${m}:${String(sec).padStart(2,'0')}`
}

function ImageViewer({ images: propImages, startIdx, galleryId, galleryName, galleryCreators, onClose }) {
  useScrollLock()
  // A slideshow can hand the viewer a different run of photos (more from this
  // creator, your favourites, …) without leaving the page. While a queue is
  // loaded it stands in for the gallery's own images everywhere below.
  const [queue, setQueue] = useState(null)   // { images, label, galleryId } | null
  const images = queue?.images ?? propImages
  // Recommendations must follow what you are actually watching, not the gallery
  // the viewer was originally opened from. Null for mixed queues (favourites),
  // where no single gallery is the source.
  const activeGalleryId = queue ? queue.galleryId : galleryId

  const [showEndScreen, setShowEndScreen] = useState(false)
  const [idx, setIdx] = useState(startIdx)
  const [fullLoaded, setFullLoaded] = useState(false)
  const [rating, setRating] = useState(0)
  const [ratingHover, setRatingHover] = useState(0)
  const [notes, setNotes] = useState('')
  const [notesSaveState, setNotesSaveState] = useState('idle')
  const [isFavorite, setIsFavorite] = useState(false)
  const [cumCount, setCumCount] = useState(null)
  const [liveViewCount, setLiveViewCount] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [slideshowActive, setSlideshowActive] = useState(false)
  const [slideshowSpeed, setSlideshowSpeed] = useState(5)
  const [showFilmstrip, setShowFilmstrip] = useState(true)
  const [showSidebar, setShowSidebar] = useState(true)
  const [localTags, setLocalTags] = useState([])
  const [localCreators, setLocalCreators] = useState([])
  const [hasImageCreators, setHasImageCreators] = useState(false)
  const [fileCreatorIds, setFileCreatorIds] = useState([])

  const dragStart          = useRef({ x: 0, y: 0 })
  const stageRef           = useRef(null)
  const viewerRef          = useRef(null)
  const viewStartRef       = useRef(null)
  const viewTimerRef       = useRef(null)
  const filmstripTimer     = useRef(null)
  const isFullscreenRef    = useRef(false)
  const videoPlayerRef     = useRef(null)
  const funscriptInputRef  = useRef(null)
  const notesSaveTimerRef  = useRef(null)
  const { sessionActive, startSession, finishSession } = useSession()
  const addXpToast      = useVaultStore(s => s.addXpToast)
  const registerVisible   = useVaultStore(s => s.registerVisible)
  const unregisterVisible = useVaultStore(s => s.unregisterVisible)
  const lastCountPing     = useVaultStore(s => s.lastCountPing)
  const lastRatingPing    = useVaultStore(s => s.lastRatingPing)
  const { seekStep, seekStepBig } = useVaultStore(s => s.hotkeySettings)
  const qc              = useQueryClient()
  const t               = useT()
  const image = images[idx]

  // Tell the app what's on screen, so Edge Mode and the log-cum hotkey know
  // what to credit. Cleared on unmount so a closed viewer stops counting.
  useEffect(() => {
    if (image?.id) registerVisible('viewer', image.id)
  }, [image?.id, registerVisible])
  useEffect(() => () => unregisterVisible('viewer'), [unregisterVisible])

  // The log-cum hotkey posts straight to the API, so pick up its result here
  // rather than leaving the counter showing a stale number.
  useEffect(() => {
    if (lastCountPing && lastCountPing.imageId === image?.id && lastCountPing.cumCount != null) {
      setCumCount(lastCountPing.cumCount)
    }
  }, [lastCountPing, image?.id])

  // Same again for the number-key ratings, which write through lib/rating.js
  // rather than this viewer's own mutation.
  useEffect(() => {
    if (lastRatingPing && lastRatingPing.imageId === image?.id && lastRatingPing.rating != null) {
      setRating(lastRatingPing.rating)
    }
  }, [lastRatingPing, image?.id])

  // Sync local state when image changes; track view count and time spent
  useEffect(() => {
    if (!image) return
    setLocalTags(image?.tags ?? [])
    setLocalCreators(image?.creators ?? [])
    setHasImageCreators(image?.has_image_creators ?? false)
    setFileCreatorIds(image?.file_creator_ids ?? [])
    setRating(image?.rating || 0)
    setRatingHover(0)
    setNotes(image?.notes || '')
    setNotesSaveState('idle')
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
        // Threshold matches the 1s view-count debounce above. They used to
        // disagree (view at 1s, duration at 2s), so anything looked at for
        // between 1 and 2 seconds banked a view worth zero seconds and dragged
        // every dwell-time average down.
        if (secs >= 1) imagesApi.logDuration(image.id, secs).catch(() => {})
        viewStartRef.current = null
      }
    }
  }, [image?.id])

  const resetZoom = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])
  useEffect(() => { resetZoom() }, [idx])
  // Reset LQIP state whenever the image changes
  useEffect(() => { setFullLoaded(false) }, [idx])

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

  // Slideshow auto-advance. Unlike manual navigation it does NOT wrap: running
  // off the end is what surfaces the "keep going?" screen.
  // Armed per slide rather than on a fixed interval, because how long a slide
  // should stay up depends on what it is:
  //   · video → no timer; it advances from onEnded once it has played out
  //   · animated GIF → held for at least one full loop
  //   · still image → the configured speed
  // Shuffle draws only from `images` — the gallery (or loaded queue) you are
  // actually in, so it can never wander outside the current selection.
  const [shuffle, setShuffle] = useState(false)

  const advanceSlide = useCallback(() => {
    setIdx(i => {
      if (shuffle && images.length > 1) {
        let n = i
        while (n === i) n = Math.floor(Math.random() * images.length)
        return n
      }
      // In order: running off the end is what raises the "keep going?" screen.
      if (i >= images.length - 1) {
        setSlideshowActive(false)
        setShowEndScreen(true)
        return i
      }
      return i + 1
    })
  }, [images.length, shuffle])

  useEffect(() => {
    if (!slideshowActive || showEndScreen || !images?.length) return
    const cur = images[idx]
    // Videos advance from onEnded; the watchdog only rescues one that can't play.
    if (!cur) return
    if (cur.is_video) return armVideoWatchdog({ onFire: advanceSlide })
    return armSlideTimer({
      url: `/api/images/${cur.id}/file`,
      animated: isGif(cur.filename || cur.file_path),
      baseSecs: slideshowSpeed,
      onFire: advanceSlide,
    })
  }, [slideshowActive, slideshowSpeed, images, idx, showEndScreen, advanceSlide])

  // Load a fresh run of photos into this same viewer and keep the slideshow
  // rolling — the whole point of the end screen is not breaking the flow.
  const playQueue = useCallback((nextImages, label, sourceGalleryId = null, creators = []) => {
    setQueue({ images: nextImages, label, galleryId: sourceGalleryId, creators })
    setIdx(0)
    setShowEndScreen(false)
    setSlideshowActive(true)
  }, [])

  const replayCurrent = useCallback(() => {
    setIdx(0)
    setShowEndScreen(false)
    setSlideshowActive(true)
  }, [])

  // ── Keyboard ───────────────────────────────────────────────────────────────
  // Every binding here is user-rebindable in Settings → Hotkeys. The seek pair
  // falls back to next/previous on a photo, which is why the stock arrows still
  // scrub a video and still walk a set of photos exactly as they always did.
  const goNext = useCallback(() => {
    setSlideshowActive(false)
    setIdx(i => Math.min(images.length - 1, i + 1))
  }, [images.length])
  const goPrev = useCallback(() => {
    setSlideshowActive(false)
    setIdx(i => Math.max(0, i - 1))
  }, [])

  const seekOrNav = useCallback((secs) => {
    if (image?.is_video) videoPlayerRef.current?.seek(secs)
    else if (secs > 0) goNext()
    else goPrev()
  }, [image?.is_video, goNext, goPrev])

  const handleEscape = useCallback(() => {
    if (isFullscreenRef.current) {
      if (window.pywebview?.api) { window.pywebview.api.toggle_fullscreen() }
      else if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}) }
      isFullscreenRef.current = false
      setIsFullscreen(false)
      setShowFilmstrip(true)
      return
    }
    if (zoom > 1) resetZoom(); else onClose()
  }, [zoom, resetZoom, onClose])

  useViewerHotkeys({
    viewer_seek_fwd:       () => seekOrNav(seekStep),
    viewer_seek_back:      () => seekOrNav(-seekStep),
    viewer_seek_fwd_big:   () => seekOrNav(seekStepBig),
    viewer_seek_back_big:  () => seekOrNav(-seekStepBig),
    viewer_next:           goNext,
    viewer_prev:           goPrev,
    viewer_play_pause:     () => {
      if (image?.is_video) videoPlayerRef.current?.togglePlay()
      else setSlideshowActive(a => !a)
    },
    viewer_shuffle: () => {
      if (images.length < 2) return
      setIdx(i => { let n = i; while (n === i) n = Math.floor(Math.random() * images.length); return n })
    },
    viewer_slideshow_faster: () => setSlideshowSpeed(s => {
      const n = Math.max(1, s - 1); toast(`⏱ ${n}s per photo`, { id: 'slide-speed' }); return n
    }),
    viewer_slideshow_slower: () => setSlideshowSpeed(s => {
      const n = Math.min(60, s + 1); toast(`⏱ ${n}s per photo`, { id: 'slide-speed' }); return n
    }),
    viewer_fullscreen: toggleFullscreen,
    viewer_keep_going: () => { setSlideshowActive(false); setShowEndScreen(true) },
    viewer_favorite:   () => { const next = !isFavorite; setIsFavorite(next); favMutation.mutate(next) },
    viewer_zoom_in:    () => setZoom(z => Math.min(8, z * 1.25)),
    viewer_zoom_out:   () => setZoom(z => { const n = Math.max(1, z / 1.25); if (n === 1) setPan({ x: 0, y: 0 }); return n }),
    viewer_zoom_reset: resetZoom,
    viewer_sidebar:    () => setShowSidebar(v => !v),
    viewer_close:      handleEscape,
    ...videoHandlers(() => videoPlayerRef.current, () => !!image?.is_video),
    ...ratingHandlers(),
  }, !showEndScreen)   // the end screen owns the keyboard while it is up


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
    // A loaded queue can hold photos from other galleries, so credit the one
    // the image actually belongs to rather than the page's gallery.
    mutationFn: () => imagesApi.cum(image.id, { gallery_id: image.gallery_id ?? galleryId }),
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

  const notesMutation = useMutation({
    mutationFn: ({ imageId, value }) => imagesApi.update(imageId, { notes: value }),
    onSuccess: (_response, variables) => {
      qc.setQueriesData({ queryKey: ['gallery-images'] }, old => Array.isArray(old)
        ? old.map(item => item.id === variables.imageId ? { ...item, notes: variables.value } : item)
        : old)
      if (image?.id === variables.imageId) setNotesSaveState('saved')
    },
    onError: (_error, variables) => {
      if (image?.id === variables.imageId) setNotesSaveState('error')
    },
  })

  const queueNotesSave = (value, immediate = false) => {
    const imageId = image.id
    clearTimeout(notesSaveTimerRef.current)
    setNotesSaveState('saving')
    const save = () => notesMutation.mutate({ imageId, value })
    if (immediate) save()
    else notesSaveTimerRef.current = setTimeout(save, 700)
  }

  const favMutation = useMutation({
    mutationFn: (val) => imagesApi.update(image.id, { is_favorite: val }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gallery-images', String(galleryId)] })
  })

  const sessionMutation = useMutation({
    mutationFn: (data = {}) => sessionsApi.log({ image_id: image.id, gallery_id: galleryId, ...data }).then(r => r.data),
    onSuccess: (data) => {
      addXpToast(`+${data.xp_earned} XP`)
      toast.success(t('Session logged ❤️'))
    }
  })

  if (!image) return null
  const isZoomed = zoom > 1

  return createPortal((
    <div
      ref={viewerRef}
      className="vault-image-viewer fixed inset-0 z-50 flex"
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
          <span className="text-[16px] text-[rgba(255,255,255,0.4)]">{idx + 1} / {images.length}</span>
          <span className="text-[16px] text-[rgba(255,255,255,0.55)] truncate">{image.filename}</span>
          <div className="ml-auto flex items-center gap-1.5">
            {/* Quick favorite star */}
            <button
              onMouseDown={() => { const next = !isFavorite; setIsFavorite(next); favMutation.mutate(next) }}
              className="cursor-pointer p-1 rounded transition-colors"
              style={{ color: isFavorite ? '#EF9F27' : 'rgba(255,255,255,0.3)' }}
              title={isFavorite ? t('Remove favorite') : t('Add to favorites')}>
              <Star size={14} fill={isFavorite ? '#EF9F27' : 'none'} />
            </button>
            {/* Slideshow controls — shared component, see SlideshowControls.jsx */}
            <SlideshowControls
              active={slideshowActive}
              onToggle={() => setSlideshowActive(a => !a)}
              speed={slideshowSpeed}
              onSpeedChange={setSlideshowSpeed}
              timedMediaPlaying={isTimedMedia(image)}
            />
            <button
              type="button"
              onMouseDown={() => { setSlideshowActive(false); setShowEndScreen(true) }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full cursor-pointer"
              style={{ fontSize: 18, background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.65)', border: '0.5px solid rgba(255,255,255,0.12)' }}
              title={t('Open continuation choices (K)')}>
              <Sparkles size={15} /> {t('Keep going')}
            </button>
            {isZoomed && (
              <span className="text-[16px] px-2 py-0.5 rounded-full"
                    style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', color: '#AFA9EC', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
                {Math.round(zoom * 100)}%
              </span>
            )}
            <button onMouseDown={() => setZoom(z => Math.min(z * 1.4, 8))}
                    className="cursor-pointer text-[rgba(255,255,255,0.35)] hover:text-white p-1 rounded"
                    title={t('Zoom in (scroll wheel)')}>
              <ZoomIn size={14} />
            </button>
            <button onMouseDown={resetZoom}
                    className="cursor-pointer text-[rgba(255,255,255,0.35)] hover:text-white p-1 rounded"
                    title={t('Reset zoom')}>
              <ZoomOut size={14} />
            </button>
            <button onMouseDown={toggleFullscreen}
                    className="cursor-pointer text-[rgba(255,255,255,0.35)] hover:text-white p-1 rounded"
                    title={t('Fullscreen')}>
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
        >
          {image.is_video ? (
            <InlineVideoPlayer
              ref={videoPlayerRef}
              key={image.id}
              src={`/api/images/${image.id}/file`}
              imageId={image.id}
              funscriptPath={image.funscript_path}
              onViewTracked={() => imagesApi.view(image.id).then(r => setLiveViewCount(r.data.view_count)).catch(() => {})}
              onFunscriptChange={() => qc.invalidateQueries({ queryKey: ['gallery-images'] })}
              videoZoom={zoom}
              videoPan={pan}
              isFullscreen={isFullscreen}
              showControls={showFilmstrip}
              // During a slideshow the video decides when to move on — the
              // slide timer deliberately doesn't run for videos.
              shuffle={shuffle}
              onToggleShuffle={() => setShuffle(v => !v)}
              // Shuffle advances on its own, without needing the slideshow on.
              onEnded={(slideshowActive || shuffle) && !showEndScreen ? advanceSlide : undefined}
            />
          ) : (
            <>
              {/* LQIP — blurred 320px thumbnail shown while full image loads.
                  Suppressed during a slideshow: a blur flash between every
                  photo defeats the crossfade. */}
              {!fullLoaded && !slideshowActive && (
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
              {/* Full-resolution image.
                  During a slideshow each photo crossfades in, the way the
                  Windows Photos app does it. Outside a slideshow the swap stays
                  instant — a fade would just feel laggy when you are clicking
                  through by hand. */}
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
                  transition: dragging
                    ? 'none'
                    : `transform 0.15s ease${slideshowActive ? ', opacity 0.45s ease-in-out' : ''}`,
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
            <button onMouseDown={(e) => { e.stopPropagation(); setSlideshowActive(false); setIdx(i => i - 1) }}
                    onDoubleClick={e => e.stopPropagation()}
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
            <button onMouseDown={(e) => { e.stopPropagation(); setSlideshowActive(false); setIdx(i => i + 1) }}
                    onDoubleClick={e => e.stopPropagation()}
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
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[16px] px-3 py-1.5 rounded-full pointer-events-none z-20"
                 style={{ background: 'rgba(0,0,0,0.6)', color: 'rgba(255,255,255,0.4)' }}>
              {t('Double-click or Esc to reset · Drag to pan')}
            </div>
          )}
          {/* End-of-slideshow "keep going?" screen — an overlay on the stage,
              not a route, so dismissing it puts you back on the last photo. */}
          {showEndScreen && (
            <SlideshowEndScreen
              galleryId={activeGalleryId}
              galleryName={queue?.label || galleryName}
              galleryCreators={queue ? (queue.creators ?? []) : galleryCreators}
              watchedImages={images}
              onPlayQueue={playQueue}
              onReplay={replayCurrent}
              onDismiss={() => setShowEndScreen(false)}
            />
          )}
          {slideshowActive && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full pointer-events-none flex items-center gap-1.5 z-20"
                 style={{
                   fontSize: 18,
                   background: 'color-mix(in srgb, var(--c-accent) 25%, transparent)',
                   color: 'var(--c-accent-text)',
                   border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)',
                   opacity: isFullscreen && !showFilmstrip ? 0 : 1,
                   transition: 'opacity 0.25s ease',
                 }}>
              <Play size={15} /> {t('Slideshow')} · {slideshowSpeed}s · {t('Space to pause')}
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
                 style={{ border: `1.5px solid ${i === idx ? 'var(--c-accent)' : 'rgba(255,255,255,0.06)'}`, background: 'rgba(255,255,255,0.04)' }}>
              <img src={`/api/images/${img.id}/thumb`} alt=""
                   loading="lazy" decoding="async"
                   className="w-full h-full object-cover"
                   onError={e => { e.target.style.display = 'none' }} />
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — hidden in fullscreen */}
      {!isFullscreen && showSidebar && <div className="w-72 flex-shrink-0 flex flex-col overflow-y-auto"
           style={{ background: '#141414', borderLeft: '0.5px solid rgba(255,255,255,0.07)' }}>

        {/* Creators */}
        <CreatorPanel
          imageId={image.id}
          galleryId={galleryId}
          creators={localCreators}
          hasImageCreators={hasImageCreators}
          fileCreatorIds={fileCreatorIds}
          galleryCreatorIds={(galleryCreators ?? []).map(c => c.id)}
          onCreatorsChanged={setLocalCreators}
          onHasImageCreatorsChanged={setHasImageCreators}
          onFileCreatorIdsChanged={setFileCreatorIds}
        />

        {/* Gallery name + set cover */}
        {galleryName && (
          <div className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
            <div className="text-[16px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-1">{t('Gallery')}</div>
            <div className="flex items-center gap-1 text-[16px] text-[rgba(255,255,255,0.65)] truncate mb-2">
              <span className="truncate">{galleryName}</span>
              <ExternalLink size={9} className="flex-shrink-0 opacity-40" />
            </div>
            {!image?.is_video && (
              <button
                onClick={() => galleriesApi.setCover(galleryId, image.id).then(() => toast.success(t('Set as gallery cover!'))).catch(() => toast.error(t('Failed')))}
                className="flex items-center gap-1.5 w-full px-2.5 py-1.5 rounded-[6px] text-[16px] cursor-pointer"
                style={{ background: 'color-mix(in srgb, var(--c-accent) 12%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 25%, transparent)' }}>
                <ImagePlus size={11} /> {t('Set as cover')}
              </button>
            )}
          </div>
        )}

        {/* Funscript loader — videos only */}
        {image.is_video && (
          <div className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
            <div className="text-[16px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-2">{t('Funscript')}</div>
            <input ref={funscriptInputRef} type="file" accept=".funscript" className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (!file) return
                videoPlayerRef.current?.promptLinkFunscript(file)
                e.target.value = ''
              }} />
            <div className="flex flex-col gap-1.5">
              {image.funscript_path
                ? <div className="text-[16px] flex items-center gap-1" style={{ color: 'color-mix(in srgb, var(--c-accent) 70%, transparent)' }}><Zap size={16} /> {t('Script attached')}</div>
                : <div className="text-[16px] text-[rgba(255,255,255,0.25)]">{t('No script attached')}</div>
              }
              <button onClick={() => funscriptInputRef.current?.click()}
                className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-[6px] text-[16px] cursor-pointer"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                <FolderOpen size={10} /> {t('Load .funscript')}
              </button>
              {image.funscript_path && (
                <div className="flex gap-1.5">
                  <button onClick={async () => {
                      try {
                        await imagesApi.unlinkFunscript(image.id)
                        toast.success(t('Funscript unlinked'))
                        qc.invalidateQueries({ queryKey: ['gallery-images'] })
                      } catch (err) {
                        toast.error(err?.response?.data?.detail || t('Could not unlink funscript'))
                      }
                    }}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-[6px] text-[16px] cursor-pointer"
                    style={{ background: 'color-mix(in srgb, var(--c-pink) 14%, transparent)', color: 'var(--c-pink)', border: '0.5px solid color-mix(in srgb, var(--c-pink) 30%, transparent)' }}>
                    <X size={10} /> {t('Unlink script')}
                  </button>
                  <button onClick={async () => {
                      if (!window.confirm(t('Delete the funscript file from disk too? This cannot be undone.'))) return
                      try {
                        await imagesApi.unlinkFunscript(image.id, true)
                        toast.success(t('Funscript unlinked and deleted'))
                        qc.invalidateQueries({ queryKey: ['gallery-images'] })
                      } catch (err) {
                        toast.error(err?.response?.data?.detail || t('Could not unlink funscript'))
                      }
                    }}
                    title={t('Unlink & delete file')}
                    className="flex items-center justify-center px-2 py-1.5 rounded-[6px] text-[16px] cursor-pointer"
                    style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.3)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                    <Trash2 size={10} />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Cum counter */}
        <div className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
          <div className="text-[16px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-2">{t('Cum counter')}</div>
          <div className="flex items-center gap-2">
            <button onMouseDown={() => cumMutation.mutate()}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-[8px] text-[16px] font-medium cursor-pointer active:scale-95 transition-transform"
                    style={{ background: 'color-mix(in srgb, var(--c-pink) 20%, transparent)', color: '#F4C0D1', border: '0.5px solid color-mix(in srgb, var(--c-pink) 40%, transparent)' }}>
              <Droplets size={13} /> {t('Count it')}
            </button>
            <div className="text-center min-w-[36px]">
              <div className="text-[22px] font-medium leading-none" style={{ color: 'var(--c-pink-text)' }}>{cumCount ?? 0}</div>
              <div className="text-[16px] text-[rgba(255,255,255,0.25)] mt-0.5">{t('all time')}</div>
            </div>
            <div className="text-center min-w-[36px]">
              <div className="text-[22px] font-medium leading-none" style={{ color: '#A89FE8' }}>{image?.edge_count ?? 0}</div>
              <div className="text-[16px] text-[rgba(255,255,255,0.25)] mt-0.5">{t('edges')}</div>
            </div>
          </div>
          {/* Edges used to come only from Edge Mode, so anyone without a device
              had a counter they could never move. This logs one by hand. */}
          <button onMouseDown={() => logEdgeNow()}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-[8px] text-[16px] font-medium cursor-pointer active:scale-95 transition-transform mt-2"
                  style={{ background: 'color-mix(in srgb, var(--c-accent) 16%, transparent)',
                           color: 'color-mix(in srgb, var(--c-accent) 82%, white)',
                           border: '0.5px solid color-mix(in srgb, var(--c-accent) 38%, transparent)' }}>
            <Waves size={13} /> {t('Edge')}
          </button>
        </div>

        {/* Rating */}
        <div className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[16px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest">{t('Rating')}</div>
            <div className="text-[16px]" style={{ color: (ratingHover || rating) ? 'var(--c-amber)' : 'rgba(255,255,255,0.25)' }}>
              {(ratingHover || rating) ? `${ratingHover || rating}/10` : t('Not rated')}
            </div>
          </div>
          <div className="flex items-center justify-between" onMouseLeave={() => setRatingHover(0)}>
            {[1,2,3,4,5,6,7,8,9,10].map(s => (
              <button key={s}
                      type="button"
                      onMouseEnter={() => setRatingHover(s)}
                      onMouseDown={() => { setRating(s); rateMutation.mutate(s) }}
                      className="p-0.5 cursor-pointer transition-transform hover:scale-125"
                      aria-label={`${t('Rate')} ${s}/10`}
                      title={`${t('Rate')} ${s}/10`}
                      style={{ lineHeight: 0 }}>
                <Star
                  size={20}
                  fill={s <= (ratingHover || rating) ? 'var(--c-amber)' : 'none'}
                  stroke={s <= (ratingHover || rating) ? 'var(--c-amber)' : 'rgba(255,255,255,0.28)'}
                  strokeWidth={1.8}
                />
              </button>
            ))}
          </div>
        </div>

        {/* Notes — per-file, shared by images and videos */}
        <div className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[16px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest">{t('Notes')}</div>
            <div className="text-[16px]" style={{
              color: notesSaveState === 'error' ? 'var(--c-pink)' : notesSaveState === 'saved' ? 'var(--c-green)' : 'rgba(255,255,255,0.3)',
            }}>
              {notesSaveState === 'saving' ? t('Saving…') : notesSaveState === 'saved' ? t('Saved') : notesSaveState === 'error' ? t('Save failed') : ''}
            </div>
          </div>
          <textarea
            value={notes}
            rows={4}
            placeholder={t('Add notes about this file…')}
            onChange={event => {
              const value = event.target.value
              setNotes(value)
              queueNotesSave(value)
            }}
            onBlur={() => {
              clearTimeout(notesSaveTimerRef.current)
              if (notes !== (image.notes || '')) queueNotesSave(notes, true)
            }}
            className="w-full resize-y rounded-[8px] p-2.5 text-[16px] outline-none"
            style={{
              minHeight: 96,
              background: 'rgba(255,255,255,0.045)',
              color: 'rgba(255,255,255,0.82)',
              border: '0.5px solid rgba(255,255,255,0.1)',
            }}
          />
        </div>

        {/* Tags */}
        <TagPanel imageId={image.id} tags={localTags} onTagsChanged={setLocalTags} />

        {/* Info */}
        <div className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
          <div className="text-[16px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-2">{t('Info')}</div>
          {image.width && (
            <div className="flex justify-between py-0.5">
              <span className="text-[16px] text-[rgba(255,255,255,0.3)]">{t('Size')}</span>
              <span className="text-[16px] text-[rgba(255,255,255,0.6)]">{image.width}×{image.height}</span>
            </div>
          )}
          {image.file_size && (
            <div className="flex justify-between py-0.5">
              <span className="text-[16px] text-[rgba(255,255,255,0.3)]">{t('File')}</span>
              <span className="text-[16px] text-[rgba(255,255,255,0.6)]">{(image.file_size / 1024 / 1024).toFixed(1)} MB</span>
            </div>
          )}
          <div className="flex justify-between py-0.5">
            <span className="text-[16px] text-[rgba(255,255,255,0.3)]">{t('Views')}</span>
            <span className="text-[16px] text-[rgba(255,255,255,0.6)]">{liveViewCount ?? image.view_count}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="p-3 flex flex-col gap-2">
          <button onMouseDown={() => {
            if (sessionActive) finishSession({ imageId: image.id, galleryId })
            else               startSession()
          }}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-[8px] text-[16px] font-medium cursor-pointer"
                  style={{ background: 'color-mix(in srgb, var(--c-pink) 15%, transparent)', color: '#F4C0D1', border: '0.5px solid color-mix(in srgb, var(--c-pink) 30%, transparent)' }}>
            <Heart size={12} /> {sessionActive ? t('Stop Session') : t('Start Session')}
          </button>
        </div>

        {/* Device controls — only shown when a device is connected */}
        <DeviceControls className="mx-2 mb-3" />
      </div>}
    </div>
  ), document.body)
}

function SimilarCard({ g, onClick }) {
  const t = useT()
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
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>{g.shared_tags} {t('shared tags')}</div>
      </div>
    </div>
  )
}

// ── Similar Galleries strip ───────────────────────────────────────────────────
function SimilarGalleriesStrip({ galleryId }) {
  const t = useT()
  const navigate = useNavigate()
  const { data: similar } = useQuery({
    queryKey: ['similar-galleries', galleryId],
    queryFn: () => galleriesApi.similar(galleryId, 6).then(r => r.data),
    enabled: !!galleryId,
    staleTime: 0, // backend picks a fresh random-but-relevant set each call — always refetch on open
  })
  if (!similar || similar.length === 0) return null
  return (
    <div className="mt-8 relative z-10">
      <div className="flex items-center gap-2 mb-3">
        <span style={{ fontSize: 17, fontWeight: 500, color: 'rgba(255,255,255,0.85)' }}>{t('More Like This')}</span>
        <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)' }}>{t('galleries sharing the most tags')}</span>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {similar.map(g => <SimilarCard key={g.id} g={g} onClick={() => navigate(`/galleries/${g.id}`)} />)}
      </div>
    </div>
  )
}

// ── Gallery Merge Modal ───────────────────────────────────────────────────────
function MergeModal({ gallery, onClose, onMerged }) {
  const t = useT()
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
      if (d.reconciled > 0) parts.push(`${d.reconciled} already-present files reconciled`)
      if (d.skipped > 0)  parts.push(`${d.skipped} skipped`)
      if (d.errors?.length > 0) parts.push(`${d.errors.length} could not be moved`)
      toast[d.errors?.length > 0 ? 'error' : 'success'](parts.join(', ') || t('Merged'))
      qc.invalidateQueries({ queryKey: ['gallery', String(gallery.id)] })
      qc.invalidateQueries({ queryKey: ['gallery', String(targetId)] })
      qc.invalidateQueries({ queryKey: ['galleries'] })
      onMerged(d)
    } catch (err) {
      toast.error(err?.response?.data?.detail || t('Merge failed'))
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
            <GitMerge size={16} style={{ color: 'var(--c-accent-text)' }} />
            <span style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>{t('Merge gallery')}</span>
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
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 2 }}>{t('Merging FROM (will be absorbed)')}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{gallery.name}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>{gallery.image_count ?? 0} {t('images')}</div>
              </div>

              {/* Target picker */}
              <div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>{t('Merge INTO (target gallery, keeps its name)')}</div>
                <input
                  value={search}
                  onChange={e => { setSearch(e.target.value); setTargetId(null); setTargetGallery(null) }}
                  placeholder={t('Search galleries…')}
                  className="w-full rounded-[8px] px-3 py-2 outline-none"
                  style={{ fontSize: 13, background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)' }}
                />
                {targetId && targetGallery ? (
                  <div className="mt-2 flex items-center justify-between px-3 py-2 rounded-[8px]"
                       style={{ background: 'color-mix(in srgb, var(--c-accent) 15%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }}>
                    <span style={{ fontSize: 13, color: 'var(--c-accent-text)', fontWeight: 600 }}>{targetGallery.name}</span>
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
                                onMouseEnter={e => e.currentTarget.style.background = 'color-mix(in srgb, var(--c-accent) 10%, transparent)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <span>{g.name}</span>
                          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>{g.image_count ?? 0} {t('imgs')}</span>
                        </button>
                      ))}
                    </div>
                  )
                )}
              </div>

              {/* Move files toggle */}
              <div className="flex items-start justify-between gap-3 pt-2 border-t border-[rgba(255,255,255,0.06)]">
                <div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>{t('Move files on disk')}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                    {moveFiles
                      ? t('Files will be physically moved into the target folder')
                      : t('Only database records update — files stay where they are')}
                  </div>
                </div>
                <button onClick={() => setMoveFiles(v => !v)} className="flex-shrink-0 mt-0.5"
                        style={{ width: 38, height: 20, borderRadius: 10, background: moveFiles ? 'color-mix(in srgb, var(--c-accent) 60%, transparent)' : 'rgba(255,255,255,0.1)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s' }}>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: moveFiles ? 'calc(100% - 17px)' : '3px', transition: 'left 0.2s' }} />
                </button>
              </div>

              {/* Collision strategy — only when moving files */}
              {moveFiles && (
                <div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>{t('If a filename already exists in the target folder')}</div>
                  <div className="flex gap-2">
                    {[
                      { key: 'rename',  label: 'Rename',  desc: 'Add _1, _2…' },
                      { key: 'replace', label: 'Replace', desc: 'Overwrite' },
                      { key: 'skip',    label: 'Skip',    desc: 'Leave in source' },
                    ].map(({ key, label, desc }) => (
                      <button key={key} onClick={() => setCollision(key)}
                              className="flex-1 px-2 py-2 rounded-[8px] text-center cursor-pointer"
                              style={{
                                background: collision === key ? 'color-mix(in srgb, var(--c-accent) 20%, transparent)' : 'rgba(255,255,255,0.04)',
                                border: `0.5px solid ${collision === key ? 'color-mix(in srgb, var(--c-accent) 50%, transparent)' : 'rgba(255,255,255,0.08)'}`,
                              }}>
                        <div style={{ fontSize: 12, color: collision === key ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.6)', fontWeight: 600 }}>{t(label)}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>{t(desc)}</div>
                      </button>
                    ))}
                  </div>
                  {collision === 'replace' && (
                    <div className="mt-2 px-3 py-2 rounded-[8px]"
                         style={{ background: 'color-mix(in srgb, var(--c-pink) 10%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-pink) 30%, transparent)', fontSize: 11, color: '#F4C0D1' }}>
                      {t('⚠ Replace will permanently delete existing files in the target folder that share a filename with source files.')}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            /* Confirmation step */
            <>
              <div className="rounded-[8px] px-3 py-3 flex flex-col gap-1"
                   style={{ background: 'color-mix(in srgb, var(--c-amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--c-amber) 35%, transparent)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-amber-text)' }}>{t('⚠ Confirm merge')}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, marginTop: 2 }}>
                  <b style={{ color: 'rgba(255,255,255,0.85)' }}>{gallery.name}</b> {t('will be merged into')} <b style={{ color: 'rgba(255,255,255,0.85)' }}>{targetGallery?.name}</b>.
                  {gallery.image_count > 0 && <> Its {gallery.image_count} images will be reassigned.</>}
                </div>
              </div>

              {moveFiles ? (
                <div className="rounded-[8px] px-3 py-2.5 flex flex-col gap-1"
                     style={{ background: 'color-mix(in srgb, var(--c-pink) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-pink) 30%, transparent)' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#F4C0D1' }}>{t('Files will be moved on disk')}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
                    {t('All images from')} <span style={{ color: 'rgba(255,255,255,0.7)' }}>{gallery.folder_path}</span> {t('will be physically moved to')} <span style={{ color: 'rgba(255,255,255,0.7)' }}>{targetGallery?.folder_path}</span>.
                    {t('Filename conflicts:')} <b style={{ color: 'rgba(255,255,255,0.7)' }}>{collision}</b>.
                  </div>
                </div>
              ) : (
                <div className="rounded-[8px] px-3 py-2.5"
                     style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)', fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
                  {t('Database records only — files will stay in their current locations on disk.')}
                </div>
              )}

              {newCreators.length > 0 && (
                <div className="rounded-[8px] px-3 py-2.5"
                     style={{ background: 'color-mix(in srgb, var(--c-green) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-green) 30%, transparent)', fontSize: 12, color: 'var(--c-green-text)' }}>
                  {t('Creator')}{newCreators.length > 1 ? 's' : ''} <b>{newCreators.map(c => c.name).join(', ')}</b> {t('will be added to the target gallery.')}
                </div>
              )}

              {collision === 'skip' && moveFiles && (
                <div className="rounded-[8px] px-3 py-2.5"
                     style={{ background: 'color-mix(in srgb, var(--c-amber) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 30%, transparent)', fontSize: 12, color: 'var(--c-amber-text)' }}>
                  {t('Skipped images will remain in the source gallery. If any are skipped, the source gallery will not be deleted.')}
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
                {t('Cancel')}
              </button>
              <button onClick={proceed} disabled={!targetId}
                      className="px-4 py-2 rounded-[8px] text-[13px] cursor-pointer disabled:opacity-40"
                      style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }}>
                {t('Review →')}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setStep('pick')} disabled={merging}
                      className="px-4 py-2 rounded-[8px] text-[13px] cursor-pointer disabled:opacity-40"
                      style={{ color: 'rgba(255,255,255,0.45)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                {t('← Back')}
              </button>
              <button onClick={doMerge} disabled={merging}
                      className="px-4 py-2 rounded-[8px] text-[13px] cursor-pointer disabled:opacity-40 flex items-center gap-2"
                      style={{ background: merging ? 'color-mix(in srgb, var(--c-accent) 15%, transparent)' : 'color-mix(in srgb, var(--c-accent) 25%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 50%, transparent)' }}>
                {merging ? <><span className="animate-spin inline-block">⟳</span> {t('Merging…')}</> : <><GitMerge size={13} /> {t('Confirm merge')}</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  , document.body)
}




// ── Extract images to new gallery modal ──────────────────────────────────────
function ExtractFromGalleryModal({ gallery, selectedImages, onClose, onExtracted }) {
  const t = useT()
  const [folderName, setFolderName] = useState('')
  const qc = useQueryClient()
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const noFolder = !gallery.folder_path || gallery.folder_path.startsWith('__manual__')

  // Derive parent path for preview
  const parentPath = useMemo(() => {
    if (noFolder || !gallery.folder_path) return null
    const p = gallery.folder_path.replace(/\\/g, '/')
    const lastSlash = p.lastIndexOf('/')
    return lastSlash > 0 ? gallery.folder_path.substring(0, lastSlash) : gallery.folder_path
  }, [gallery.folder_path, noFolder])

  const previewPath = useMemo(() => {
    if (!folderName.trim() || !parentPath) return null
    return parentPath + '\\' + folderName.trim()
  }, [folderName, parentPath])

  const creators = gallery.creators ?? []

  const extractMutation = useMutation({
    mutationFn: () => galleriesApi.extract(
      gallery.id,
      selectedImages.map(i => i.id),
      folderName.trim(),
    ),
    onSuccess: (res) => {
      const g = res.data
      const errs = g.errors?.length ?? 0
      if (errs > 0) toast.error(`Extracted with ${errs} file error(s)`)
      else toast.success(`${g.moved ?? selectedImages.length} images → "${g.name}"`)
      qc.invalidateQueries({ queryKey: ['galleries'] })
      onExtracted(g)
    },
    onError: (err) => toast.error(err?.response?.data?.detail || t('Extract failed')),
  })

  const canSubmit = folderName.trim().length > 0 && !extractMutation.isPending

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
         style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
         onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rounded-[14px] w-full max-w-md flex flex-col overflow-hidden"
           style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.12)', maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(255,255,255,0.07)]">
          <div className="flex items-center gap-2">
            <FolderOutput size={16} style={{ color: 'var(--c-green-text)' }} />
            <span style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>{t('Extract to new gallery')}</span>
          </div>
          <button onClick={onClose} className="cursor-pointer" style={{ color: 'rgba(255,255,255,0.4)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-4">

          {/* Summary */}
          <div className="rounded-[8px] px-3 py-2.5 flex items-center gap-3"
               style={{ background: 'rgba(159,225,203,0.08)', border: '0.5px solid rgba(159,225,203,0.2)' }}>
            <FolderOutput size={18} style={{ color: 'var(--c-green-text)', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-green-text)' }}>
                {selectedImages.length} {t('image')}{selectedImages.length !== 1 ? 's' : ''} {t('selected')}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                {t('Will be moved out of')} <span style={{ color: 'rgba(255,255,255,0.65)' }}>{gallery.name}</span> {t('into a new gallery')}
              </div>
            </div>
          </div>

          {/* Folder name input */}
          <div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>{t('New gallery folder name')}</div>
            <input
              ref={inputRef}
              value={folderName}
              onChange={e => setFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && canSubmit) extractMutation.mutate(); if (e.key === 'Escape') onClose() }}
              placeholder={t('e.g. Cosplay Set 01')}
              className="w-full rounded-[8px] px-3 py-2 outline-none"
              style={{ fontSize: 14, background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.9)' }}
            />
            {previewPath && (
              <div className="mt-1.5 flex items-center gap-1.5"
                   style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                <FolderOpen size={11} style={{ flexShrink: 0, color: 'rgba(255,255,255,0.2)' }} />
                <span className="truncate">{previewPath}</span>
              </div>
            )}
            {noFolder && (
              <div className="mt-1.5" style={{ fontSize: 11, color: 'var(--c-amber-text)' }}>
                {t('⚠ This gallery has no folder path. The new gallery will be database-only (no files moved).')}
              </div>
            )}
          </div>

          {/* Creator info */}
          {creators.length > 0 && (
            <div className="rounded-[8px] px-3 py-2.5"
                 style={{ background: 'color-mix(in srgb, var(--c-green) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-green) 30%, transparent)', fontSize: 12, color: 'var(--c-green-text)', lineHeight: 1.5 }}>
              {t('Creator association')}{creators.length > 1 ? 's' : ''} (<b>{creators.map(c => c.name).join(', ')}</b>) {t('will be copied to the new gallery.')}
            </div>
          )}

          {/* What happens note */}
          <div className="rounded-[8px] px-3 py-2.5"
               style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)', fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>
            {t('The selected images will be')} <b style={{ color: 'rgba(255,255,255,0.6)' }}>{t('physically moved')}</b> {t('to the new folder on disk. The remaining images stay in')} <span style={{ color: 'rgba(255,255,255,0.6)' }}>{gallery.name}</span>.
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[rgba(255,255,255,0.07)]">
          <button onClick={onClose} disabled={extractMutation.isPending}
                  className="px-4 py-2 rounded-[8px] text-[13px] cursor-pointer disabled:opacity-40"
                  style={{ color: 'rgba(255,255,255,0.45)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
            {t('Cancel')}
          </button>
          <button onClick={() => extractMutation.mutate()} disabled={!canSubmit}
                  className="px-4 py-2 rounded-[8px] text-[13px] cursor-pointer disabled:opacity-40 flex items-center gap-2"
                  style={{ background: 'rgba(159,225,203,0.15)', color: 'var(--c-green-text)', border: '0.5px solid rgba(159,225,203,0.3)' }}>
            {extractMutation.isPending
              ? <><span className="animate-spin inline-block">⟳</span> {t('Extracting…')}</>
              : <><FolderOutput size={13} /> {t('Extract')} {selectedImages.length} {t('image')}{selectedImages.length !== 1 ? 's' : ''}</>
            }
          </button>
        </div>
      </div>
    </div>
  , document.body)
}


export default function GalleryView() {
  const t = useT()
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const qc = useQueryClient()
  const addXpToast = useVaultStore(s => s.addXpToast)
  const [viewerIdx, setViewerIdx] = useState(null)
  const initialSort = useRef(readSavedGallerySort()).current
  const [sortBy, setSortBy] = useState(initialSort)
  const [mediaSearch, setMediaSearch] = useState('')
  const [randomSeed, setRandomSeed] = useState(() => initialSort === 'random' ? Math.random() : 0)
  const [renderLimit, setRenderLimit] = useState(GALLERY_RENDER_BATCH)
  const [isRenaming, setIsRenaming] = useState(false)
  const [editName, setEditName] = useState('')
  const renameSubmittedRef = useRef(false)
  const [retagging, setRetagging]           = useState(false)
  const [showMergeModal, setShowMergeModal] = useState(false)
  const [showPeriodPicker, setShowPeriodPicker] = useState(false)
  const [deletedIds, setDeletedIds] = useState(new Set())
  const [periodMonth, setPeriodMonth] = useState(null)
  const [periodYear, setPeriodYear] = useState(null)
  const [thumbSizeIdx, setThumbSizeIdx] = useState(() => { // default: 160px (idx 2)
    try {
      const v = parseInt(localStorage.getItem('vault_galleryview_thumb_idx') ?? '2', 10)
      return (Number.isInteger(v) && v >= 0 && v < THUMB_SIZES.length) ? v : 2
    } catch { return 2 }
  })
  useEffect(() => {
    try { localStorage.setItem('vault_galleryview_thumb_idx', String(thumbSizeIdx)) } catch {}
  }, [thumbSizeIdx])
  useEffect(() => {
    try { localStorage.setItem(GALLERY_SORT_STORAGE_KEY, sortBy) } catch {}
  }, [sortBy])
  // Bulk select + extract
  const [bulkMode, setBulkMode]   = useState(() => new URLSearchParams(window.location.search).get('select') === 'true')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [showExtract, setShowExtract] = useState(false)
  const [extractImages, setExtractImages] = useState(null)
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false)
  const [bulkAssignSearch, setBulkAssignSearch] = useState('')
  const [bulkTagOpen, setBulkTagOpen] = useState(false)
  const [bulkPendingTags, setBulkPendingTags] = useState([])
  const [bulkTagging, setBulkTagging] = useState(false)
  const lastSelectIdxRef = useRef(null)
  // Image context menu
  const [imgCtx, setImgCtx] = useState(null) // { image, x, y }
  const [avatarFramePicker, setAvatarFramePicker] = useState(null) // { creatorId, image, mode }
  // Transfer modal — single image (from ctx menu) or bulk
  const [transferCtx, setTransferCtx] = useState(null) // { images: [...] }
  const [relocatingImages, setRelocatingImages] = useState(null)
  const addToMultiViewer = useVaultStore(s => s.addToMultiViewer)
  const multiViewerQueue = useVaultStore(s => s.multiViewerQueue)
  const MULTIVIEWER_MAX  = useVaultStore(s => s.MULTIVIEWER_MAX)
  const bumpAvatarBust   = useVaultStore(s => s.bumpAvatarBust)
  const retagPollRef = useRef(null)

  useEffect(() => {
    return () => {
      if (retagPollRef.current) clearInterval(retagPollRef.current)
      // viewTimerRef lives inside ImageViewer — no cleanup needed here
    }
  }, [])

  const handleSortChange = (val) => {
    if (val === 'random') {
      setRandomSeed(Math.random())
    }
    setSortBy(val)
  }

  const reshuffle = () => setRandomSeed(Math.random())

  // Track gallery visit — fires once per gallery navigation
  useEffect(() => {
    galleriesApi.view(id).catch(() => {})
  }, [id])

  const { data: gallery } = useQuery({
    queryKey: ['gallery', id],
    queryFn: () => galleriesApi.get(id).then(r => r.data),
  })

  const { data: allCreatorsForAssign } = useAllCreators()

  const { data: images } = useQuery({
    queryKey: ['gallery-images', id, sortBy, randomSeed],
    queryFn: ({ queryKey }) => {
      const [, galleryId, sort, seed] = queryKey
      return galleriesApi.images(galleryId, { sort_by: sort, _seed: seed }).then(r => r.data)
    },
    gcTime: 5 * 60 * 1000,  // cache for 5 min — returning to a gallery is instant
  })

  const searchedImages = useMemo(() => {
    if (!images) return []
    const query = mediaSearch.trim().toLocaleLowerCase()
    if (!query) return images
    return images.filter(image => (image.filename || '').toLocaleLowerCase().includes(query))
  }, [images, mediaSearch])

  const displayedImages = useMemo(
    () => {
      const deletedKeys = new Set([...deletedIds].map(String))
      return searchedImages.filter(image => !deletedKeys.has(String(image.id)))
    },
    [searchedImages, deletedIds],
  )

  // Keep selection comparisons type-safe. API responses can contain numeric IDs
  // while DOM/event payloads may hand us strings, which used to make a selected
  // right-click silently fall back to a single-file action.
  const selectedIdKeys = useMemo(
    () => new Set([...selectedIds].map(String)),
    [selectedIds],
  )
  const selectedImages = useMemo(() => {
    const deletedKeys = new Set([...deletedIds].map(String))
    return (images ?? []).filter(image => (
      !deletedKeys.has(String(image.id)) && selectedIdKeys.has(String(image.id))
    ))
  }, [images, deletedIds, selectedIdKeys])

  // Right-clicking a selected tile applies the menu action to the whole current
  // selection. Right-clicking an unselected tile intentionally targets only it.
  const contextImages = imgCtx
    ? (bulkMode && selectedIdKeys.has(String(imgCtx.image.id))
        ? displayedImages.filter(image => selectedIdKeys.has(String(image.id)))
        : [imgCtx.image])
    : []
  const contextBulkImages = contextImages.length > 1 ? contextImages : null

  const renderedImages = useMemo(
    () => displayedImages.slice(0, renderLimit),
    [displayedImages, renderLimit],
  )

  const loadMoreRef = useRef(null)

  // A new search or sort should start at the top of the result set. The
  // observer below will keep extending the mounted window as the user gets
  // near the end, without changing the full list used by selection/viewer
  // actions.
  useEffect(() => {
    setRenderLimit(GALLERY_RENDER_BATCH)
  }, [id, sortBy, randomSeed, mediaSearch])

  useEffect(() => {
    const node = loadMoreRef.current
    if (!node || renderLimit >= displayedImages.length) return
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      setRenderLimit(current => Math.min(current + GALLERY_RENDER_BATCH, displayedImages.length))
    }, { rootMargin: '900px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [displayedImages.length, renderLimit])

  const galleryFolderName = gallery?.folder_path
    ? gallery.folder_path.split(/[\\/]/).filter(Boolean).pop()
    : gallery?.name || ''

  // Auto-open image from ?openImage= query param (e.g. from HOF / creator profile click)
  const openImageHandled = useRef(false)
  useEffect(() => {
    if (openImageHandled.current) return
    const openImageId = searchParams.get('openImage')
    if (!openImageId || !images?.length) return
    const targetId = parseInt(openImageId, 10)
    const idx = images.findIndex(img => img.id === targetId || String(img.id) === openImageId)
    if (idx !== -1) {
      setViewerIdx(idx)
      openImageHandled.current = true
    }
  }, [images, searchParams])

  const favMutation = useMutation({
    mutationFn: () => galleriesApi.update(id, { is_favorite: !gallery?.is_favorite }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gallery', id] })
  })

  const renameMutation = useMutation({
    mutationFn: (newName) => galleriesApi.renameFolder(id, newName),
    onSuccess: () => {
      toast.success(t('Folder renamed on disk'))
      qc.invalidateQueries({ queryKey: ['gallery', id] })
      qc.invalidateQueries({ queryKey: ['galleries'] })
      qc.invalidateQueries({ queryKey: ['gallery-images', id] })
      setIsRenaming(false)
    },
    onError: () => {
      renameSubmittedRef.current = false
      toast.error(t('Rename failed'))
      setIsRenaming(false)
    }
  })

  const startRename = () => {
    renameSubmittedRef.current = false
    setEditName(galleryFolderName)
    setIsRenaming(true)
  }

  const submitRename = () => {
    // Enter blurs the input immediately afterwards. Ignore that second event
    // so a successful rename cannot be followed by a false error toast.
    if (renameSubmittedRef.current || renameMutation.isPending) return
    const nextName = editName.trim()
    if (nextName && nextName !== galleryFolderName) {
      renameSubmittedRef.current = true
      renameMutation.mutate(nextName)
    } else {
      setIsRenaming(false)
    }
  }

  const [galleryRating, setGalleryRating] = useState(0)
  const [ratingHover, setRatingHover]     = useState(0)
  useEffect(() => { setGalleryRating(gallery?.rating ?? 0) }, [gallery?.rating])

  const rateGalleryMutation = useMutation({
    mutationFn: (r) => galleriesApi.update(id, { rating: r }),
    onSuccess: () => {
      addXpToast('+3 XP')
      qc.invalidateQueries({ queryKey: ['gallery', id] })
      qc.invalidateQueries({ queryKey: ['galleries'] })
    },
    onError: () => toast.error(t('Rating failed')),
  })

  const periodMutation = useMutation({
    mutationFn: ({ month, year }) => galleriesApi.update(id, { period_month: month || null, period_year: year || null }),
    onSuccess: () => {
      toast.success(t('Period saved'))
      qc.invalidateQueries({ queryKey: ['gallery', id] })
      qc.invalidateQueries({ queryKey: ['galleries'] })
      setShowPeriodPicker(false)
    },
    onError: () => toast.error(t('Failed to save period')),
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
      toast.error(t('Tagger error — is a model downloaded?'))
      setRetagging(false)
    }
  }

  const handleSendToPlaylist = async () => {
    if (!gallery || !images?.length) return
    try {
      const { data: galleryImages } = await galleriesApi.bulkImages([gallery.id])
      const ok = addToMultiViewer({
        id: `gal-${gallery.id}`,
        type: 'gallery',
        media: gallery,
        images: galleryImages[String(gallery.id)] || images,
      })
      if (ok) toast.success(t('Gallery added to Playlists'))
      else toast(t('Already in Playlists or queue is full'), { icon: 'ℹ️' })
    } catch {
      toast.error(t('Could not add gallery to Playlists'))
    }
  }

  return (
    <div className="p-5 relative">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(-1)}
                className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-[7px] cursor-pointer"
                style={{ color: 'rgba(255,255,255,0.45)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
          <ArrowLeft size={13} /> {t('Back')}
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
              style={{ borderBottom: '1px solid color-mix(in srgb, var(--c-accent) 50%, transparent)', paddingBottom: '1px' }}
            />
          ) : (
            <div className="flex items-center gap-2 group/title cursor-pointer w-max" onClick={startRename}>
              <div className="text-[16px] font-medium text-[rgba(255,255,255,0.9)] truncate">{gallery?.name ?? '...'}</div>
              <button onClick={startRename} className="opacity-0 group-hover/title:opacity-100 transition-opacity text-[rgba(255,255,255,0.35)] hover:text-white flex-shrink-0" title={t('Rename folder on disk')}><Pencil size={13} /></button>
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-[rgba(255,255,255,0.35)]">
              {gallery?.image_count ?? 0} {t('photos')}
            </span>
            {gallery?.folder_path && !gallery.folder_path.startsWith('__manual__') && (
              <button
                type="button"
                title={`${gallery.folder_path}\n\nClick to copy`}
                onClick={() => { navigator.clipboard.writeText(gallery.folder_path).catch(() => {}); toast.success(t('Path copied')) }}
                className="flex items-center gap-1 cursor-pointer group/path"
                style={{ maxWidth: '55ch', minWidth: 0 }}>
                <FolderOpen size={10} style={{ color: 'rgba(255,255,255,0.2)', flexShrink: 0 }} />
                <span
                  className="group-hover/path:text-[rgba(255,255,255,0.5)] transition-colors"
                  style={{
                    fontSize: 11, fontFamily: 'monospace',
                    color: 'rgba(255,255,255,0.25)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    direction: 'rtl', textAlign: 'left',
                  }}>
                  {gallery.folder_path}
                </span>
              </button>
            )}
            {/* Period badge */}
            {gallery?.period_month && gallery?.period_year ? (
              <button
                onClick={() => setShowPeriodPicker(p => !p)}
                className="text-[10px] px-2 py-0.5 rounded-full cursor-pointer"
                style={{ background: 'color-mix(in srgb, var(--c-green) 15%, transparent)', color: 'var(--c-green-text)', border: '0.5px solid color-mix(in srgb, var(--c-green) 30%, transparent)' }}>
                {new Date(gallery.period_year, gallery.period_month - 1).toLocaleString('default', { month: 'short', year: 'numeric' })}
              </button>
            ) : (
              <button
                onClick={() => setShowPeriodPicker(p => !p)}
                className="text-[10px] px-2 py-0.5 rounded-full cursor-pointer opacity-40 hover:opacity-70"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                {t('+ period')}
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
                <option value="">{t('Month')}</option>
                {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                  <option key={i+1} value={i+1}>{t(m)}</option>
                ))}
              </select>
              <select
                value={periodYear ?? ''}
                onChange={e => setPeriodYear(e.target.value ? parseInt(e.target.value) : null)}
                className="text-[11px] rounded-[6px] px-2 py-1 outline-none cursor-pointer"
                style={{ background: '#1a1a1a', color: 'rgba(255,255,255,0.8)', border: '0.5px solid rgba(255,255,255,0.12)' }}>
                <option value="">{t('Year')}</option>
                {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <button
                onClick={() => periodMutation.mutate({ month: periodMonth, year: periodYear })}
                disabled={periodMutation.isPending}
                className="text-[10px] px-2.5 py-1 rounded-full cursor-pointer"
                style={{ background: 'color-mix(in srgb, var(--c-green) 20%, transparent)', color: 'var(--c-green-text)', border: '0.5px solid color-mix(in srgb, var(--c-green) 30%, transparent)' }}>
                {t('Save')}
              </button>
              <button
                onClick={() => setShowPeriodPicker(false)}
                className="text-[10px] text-[rgba(255,255,255,0.3)] hover:text-white cursor-pointer">
                ✕
              </button>
            </div>
          )}
        </div>
        <div className="vault-control-row flex gap-2 flex-shrink-0">
          <div className="vault-row-control flex items-center gap-2 px-3 py-1.5 rounded-full"
               style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
            <Search size={16} style={{ color: 'rgba(255,255,255,0.35)', flexShrink: 0 }} />
            <input
              value={mediaSearch}
              onChange={event => setMediaSearch(event.target.value)}
              placeholder={t('Search filenames…')}
              aria-label={t('Search filenames in this gallery')}
              className="w-44 bg-transparent outline-none text-[16px]"
              style={{ color: 'rgba(255,255,255,0.8)' }}
            />
            {mediaSearch && (
              <>
                <span className="text-[16px] whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  {searchedImages.length}/{images?.length ?? 0}
                </span>
                <button type="button" onClick={() => setMediaSearch('')}
                        className="cursor-pointer" title={t('Clear filename search')}>
                  <X size={16} style={{ color: 'rgba(255,255,255,0.45)' }} />
                </button>
              </>
            )}
          </div>
          <button onClick={() => favMutation.mutate()}
                  className="flex items-center gap-1.5 text-[16px] px-3 py-1.5 rounded-full cursor-pointer"
                  style={{
                    background: gallery?.is_favorite ? 'color-mix(in srgb, var(--c-amber) 20%, transparent)' : 'rgba(255,255,255,0.05)',
                    color: gallery?.is_favorite ? 'var(--c-amber-text)' : 'rgba(255,255,255,0.4)',
                    border: '0.5px solid rgba(255,255,255,0.1)',
                  }}>
            <Star size={15} />
          </button>
          <button onClick={handleSendToPlaylist}
                  disabled={!gallery || !images?.length}
                  className="flex items-center gap-1.5 text-[16px] px-3 py-1.5 rounded-full cursor-pointer disabled:opacity-40"
                  title={t('Send this gallery to Playlists')}
                  style={{ background: 'color-mix(in srgb, var(--c-accent) 15%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
            <ListMusic size={15} /> {t('Playlists')}
          </button>
          {gallery?.edge_count > 0 && (
            <div className="vault-row-control flex items-center gap-1.5 text-[16px] px-3 py-1.5 rounded-full"
                 title={t('Edges — logged automatically by Edge Mode')}
                 style={{ background: 'color-mix(in srgb, var(--c-accent) 15%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
              <Waves size={15} /> {gallery.edge_count}
            </div>
          )}
          {/* Gallery rating */}
          <div className="vault-row-control flex items-center gap-0.5 px-2 py-1.5 rounded-full"
               style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)' }}
               onMouseLeave={() => setRatingHover(0)}>
            {[1,2,3,4,5,6,7,8,9,10].map(n => {
              const filled = ratingHover ? n <= ratingHover : n <= galleryRating
              return (
                <button key={n} type="button"
                        onMouseEnter={() => setRatingHover(n)}
                        onClick={() => {
                          const next = galleryRating === n ? 0 : n
                          setGalleryRating(next)
                          rateGalleryMutation.mutate(next)
                        }}
                        className="cursor-pointer transition-transform hover:scale-125"
                        title={`Rate ${n}/10`}>
                  <Star size={9}
                        fill={filled ? (ratingHover ? 'color-mix(in srgb, var(--c-amber) 70%, transparent)' : 'var(--c-amber)') : 'none'}
                        stroke={filled ? 'var(--c-amber)' : 'rgba(255,255,255,0.2)'}
                        strokeWidth={1.5} />
                </button>
              )
            })}
            {galleryRating > 0 && !ratingHover && (
              <span className="text-[10px] ml-1" style={{ color: 'var(--c-amber)' }}>{galleryRating}</span>
            )}
          </div>
          <SortDropdown value={sortBy} onChange={handleSortChange} options={SORTS} />
          {sortBy === 'random' && (
            <button type="button" onMouseDown={reshuffle}
                    className="flex items-center gap-1.5 text-[16px] px-3 py-1.5 rounded-full cursor-pointer"
                    title={t('Shuffle the gallery again')}
                    style={{ background: 'color-mix(in srgb, var(--c-accent) 15%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
              <Shuffle size={15} /> {t('Reshuffle')}
            </button>
          )}
          {/* Size slider */}
          <div className="vault-row-control flex items-center gap-1.5 px-2 py-1.5 rounded-full"
               style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
            <Images size={11} style={{ color: 'rgba(255,255,255,0.35)', flexShrink: 0 }} />
            <input
              type="range" min={0} max={THUMB_SIZES.length - 1} step={1}
              value={thumbSizeIdx}
              onChange={e => setThumbSizeIdx(Number(e.target.value))}
              className="cursor-pointer"
              style={{ width: 64, accentColor: 'var(--c-accent)' }}
            />
          </div>
          <button onClick={handleRetag} disabled={retagging}
                  title={t('AI-tag all images in this gallery')}
                  className="flex items-center gap-1.5 text-[16px] px-3 py-1.5 rounded-full cursor-pointer disabled:opacity-50 transition-all"
                  style={{
                    background: retagging ? 'color-mix(in srgb, var(--c-accent) 25%, transparent)' : 'color-mix(in srgb, var(--c-accent) 10%, transparent)',
                    color: retagging ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.4)',
                    border: `0.5px solid ${retagging ? 'color-mix(in srgb, var(--c-accent) 50%, transparent)' : 'rgba(255,255,255,0.1)'}`,
                  }}>
            <Sparkles size={15} className={retagging ? 'animate-pulse' : ''} />
            {retagging ? t('Tagging…') : t('AI Tag')}
          </button>
          <button onClick={() => setShowMergeModal(true)}
                  title={t('Merge this gallery into another')}
                  className="flex items-center gap-1.5 text-[16px] px-3 py-1.5 rounded-full cursor-pointer transition-all"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
            <GitMerge size={15} />
            {t('Merge')}
          </button>
          <button onClick={() => { setBulkMode(b => !b); setSelectedIds(new Set()); lastSelectIdxRef.current = null }}
                  title={t('Select images to extract or delete')}
                  className="flex items-center gap-1.5 text-[16px] px-3 py-1.5 rounded-full cursor-pointer transition-all"
                  style={{
                    background: bulkMode ? 'color-mix(in srgb, var(--c-accent) 20%, transparent)' : 'rgba(255,255,255,0.05)',
                    color: bulkMode ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.4)',
                    border: `0.5px solid ${bulkMode ? 'color-mix(in srgb, var(--c-accent) 40%, transparent)' : 'rgba(255,255,255,0.1)'}`,
                  }}>
            <CheckSquare size={15} />
            {bulkMode ? `${selectedIds.size} selected` : t('Select')}
          </button>
        </div>
      </div>

      {/* Creator assignment */}
      {gallery && (
        <div className="mb-4 relative z-10">
            <CreatorAssignPanel
              galleryId={parseInt(id)}
              assignedCreators={gallery.creators ?? []}
              galleryImages={images ?? []}
              totalItems={gallery.image_count ?? 0}
            />
        </div>
      )}

      {/* Galleries nested inside this one on disk — hides itself when empty */}
      <div className="mb-3">
        <SubgalleriesPanel
          galleryId={parseInt(id)}
          onOpen={(g) => navigate(`/galleries/${g.id}`)}
        />
      </div>

      {/* Bulk action bar */}
      {bulkMode && selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-[10px] mb-3 animate-slide-up relative z-10"
             style={{ background: 'color-mix(in srgb, var(--c-accent) 12%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
          <span className="text-[13px] font-medium" style={{ color: 'var(--c-accent-text)' }}>{selectedIds.size} {t('selected')}</span>
          <button type="button"
                  onMouseDown={() => setSelectedIds(() => displayedImages.length > 0 && displayedImages.every(i => selectedIdKeys.has(String(i.id)))
                    ? new Set()
                    : new Set(displayedImages.map(i => String(i.id))))}
                  className="text-[12px] px-2.5 py-1 rounded-full cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
            {displayedImages.length > 0 && displayedImages.every(i => selectedIdKeys.has(String(i.id))) ? t('Deselect all') : t('Select all')}
          </button>
          <button type="button" onMouseDown={() => { setExtractImages(null); setShowExtract(true) }}
                  className="flex items-center gap-1.5 text-[13px] font-medium px-3 py-1.5 rounded-full cursor-pointer"
                  style={{ background: 'color-mix(in srgb, var(--c-green) 15%, transparent)', color: 'var(--c-green-text)', border: '0.5px solid color-mix(in srgb, var(--c-green) 30%, transparent)' }}>
            <FolderOutput size={12} /> {t('Extract to gallery')}
          </button>
          <button type="button"
                  onMouseDown={() => setRelocatingImages(selectedImages)}
                  className="flex items-center gap-1.5 text-[13px] font-medium px-3 py-1.5 rounded-full cursor-pointer"
                  style={{ background: 'color-mix(in srgb, var(--c-amber) 15%, transparent)', color: 'var(--c-amber-text)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 30%, transparent)' }}>
            <HardDrive size={12} /> {t('Relocate')}
          </button>
          <button type="button"
                  onMouseDown={() => setTransferCtx({ images: selectedImages })}
                  className="flex items-center gap-1.5 text-[13px] font-medium px-3 py-1.5 rounded-full cursor-pointer"
                  style={{ background: 'color-mix(in srgb, var(--c-green) 15%, transparent)', color: 'var(--c-green-text)', border: '0.5px solid color-mix(in srgb, var(--c-green) 30%, transparent)' }}>
            <Copy size={12} /> {t('Copy to gallery')}
          </button>
          <button type="button"
                  onMouseDown={() => { setBulkAssignOpen(v => !v); setBulkTagOpen(false) }}
                  className="flex items-center gap-1.5 text-[13px] font-medium px-3 py-1.5 rounded-full cursor-pointer"
                  style={{ background: bulkAssignOpen ? 'color-mix(in srgb, var(--c-accent) 25%, transparent)' : 'color-mix(in srgb, var(--c-accent) 12%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }}>
            <UserPlus size={12} /> {t('Assign creator')}
          </button>
          <button type="button"
                  onMouseDown={() => { setBulkTagOpen(v => !v); setBulkAssignOpen(false) }}
                  className="flex items-center gap-1.5 text-[13px] font-medium px-3 py-1.5 rounded-full cursor-pointer"
                  style={{ background: bulkTagOpen ? 'color-mix(in srgb, var(--c-accent) 25%, transparent)' : 'color-mix(in srgb, var(--c-accent) 12%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }}>
            <Tag size={12} /> {t('Add tags')}
          </button>
          <button type="button" onMouseDown={() => { setBulkMode(false); setSelectedIds(new Set()); setBulkAssignOpen(false); setBulkTagOpen(false); setBulkPendingTags([]); lastSelectIdxRef.current = null }}
                  className="ml-auto text-[rgba(255,255,255,0.35)] hover:text-white cursor-pointer">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Bulk tag picker — build a pending list, then apply to every selected file */}
      {bulkMode && bulkTagOpen && (
        <div className="mb-3 rounded-[10px] overflow-hidden relative z-20"
             style={{ background: 'rgba(22,22,26,0.97)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)', padding: '10px 12px' }}>
          <div className="flex items-center gap-2 flex-wrap">
            {bulkPendingTags.map(tg => (
              <span key={tg} className="flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[13px]"
                    style={{ background: 'color-mix(in srgb, var(--c-accent) 18%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 35%, transparent)' }}>
                {tg}
                <button type="button" onMouseDown={() => setBulkPendingTags(p => p.filter(x => x !== tg))}
                        className="cursor-pointer text-[rgba(255,255,255,0.4)] hover:text-white ml-0.5">
                  <X size={9} />
                </button>
              </span>
            ))}
            <div style={{ width: 200 }}>
              <TagAutocompleteInput
                autoFocus
                exclude={bulkPendingTags}
                placeholder={t('Add tag…')}
                onAdd={(name) => setBulkPendingTags(p => p.includes(name) ? p : [...p, name])}
              />
            </div>
            <button
              type="button"
              disabled={!bulkPendingTags.length || bulkTagging}
              onMouseDown={async () => {
                if (!bulkPendingTags.length || bulkTagging) return
                const targets = selectedImages
                setBulkTagging(true)
                let errs = 0
                for (const img of targets)
                  for (const tg of bulkPendingTags)
                    try { await imagesApi.addTag(img.id, tg) } catch { errs++ }
                setBulkTagging(false)
                if (errs) toast.error(`Done with ${errs} errors`)
                else toast.success(`Tagged ${targets.length} ${targets.length === 1 ? 'file' : 'files'}`)
                qc.invalidateQueries({ queryKey: ['gallery-images', String(id)] })
                qc.invalidateQueries({ queryKey: ['tags'] })
                setBulkPendingTags([])
                setBulkTagOpen(false)
              }}
              className="flex items-center gap-1.5 text-[13px] font-medium px-3 py-1.5 rounded-full cursor-pointer disabled:opacity-40"
              style={{ background: 'color-mix(in srgb, var(--c-accent) 30%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 50%, transparent)' }}>
              {bulkTagging ? t('Tagging…') : `${t('Apply to')} ${selectedIds.size}`}
            </button>
          </div>
        </div>
      )}

      {/* Bulk assign creator picker */}
      {bulkMode && bulkAssignOpen && (
        <div className="mb-3 rounded-[10px] overflow-hidden relative z-10"
             style={{ background: 'rgba(22,22,26,0.97)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
          <div style={{ padding: '8px 12px 6px' }}>
            <input
              autoFocus
              value={bulkAssignSearch}
              onChange={e => setBulkAssignSearch(e.target.value)}
              placeholder={t('Search creators to assign…')}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '6px 10px', borderRadius: 6, fontSize: 13,
                background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)',
                border: '0.5px solid rgba(255,255,255,0.12)', outline: 'none',
              }}
            />
          </div>
          <div style={{ maxHeight: 180, overflowY: 'auto', padding: '2px 0 6px' }}>
            {(allCreatorsForAssign ?? [])
              .filter(c => c.name.toLowerCase().includes(bulkAssignSearch.toLowerCase()))
              .map(c => (
                <button
                  key={c.id}
                  type="button"
                  onMouseDown={async () => {
                    const ids = selectedImages.map(i => i.id)
                    try {
                      const { data } = await imagesApi.bulkAddCreator(ids, c.id)
                      const n = data?.assigned ?? 0
                      toast.success(n > 0
                        ? `${data.creator_name} assigned to ${n} ${n === 1 ? 'file' : 'files'}`
                        : 'Already assigned')
                      patchCachedCreators(qc, ids, {
                        id: data.creator_id, name: data.creator_name, creator_type: data.creator_type,
                      })
                      setBulkAssignOpen(false)
                      setBulkAssignSearch('')
                    } catch (err) {
                      console.error('Assign creator failed:', err)
                      toast.error(t('Failed to assign creator'))
                    }
                  }}
                  className="w-full text-left flex items-center gap-2 cursor-pointer"
                  style={{
                    padding: '6px 14px', fontSize: 13, color: 'rgba(255,255,255,0.8)',
                    background: 'transparent', transition: 'background 0.08s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--c-accent) 15%, transparent)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  {c.avatar_path
                    ? <img src={`/api/creators/${c.id}/avatar`} style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} onError={e => { e.target.style.display = 'none' }} />
                    : <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, background: 'color-mix(in srgb, var(--c-accent) 30%, transparent)' }} />
                  }
                  {c.name}
                </button>
              ))}
            {(allCreatorsForAssign ?? []).filter(c => c.name.toLowerCase().includes(bulkAssignSearch.toLowerCase())).length === 0 && (
              <div style={{ padding: '8px 14px', fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>{t('No creators found')}</div>
            )}
          </div>
        </div>
      )}

      {/* Image grid */}
      <div className="relative z-10" />
      {!images
        ? <div className="text-center py-12 text-[rgba(255,255,255,0.3)] text-[13px]">{t('Loading...')}</div>
        : images.length === 0
          ? <div className="text-center py-16 text-[rgba(255,255,255,0.25)] text-[16px]">{t('No images in this gallery')}</div>
        : displayedImages.length === 0
          ? <div className="text-center py-16 text-[rgba(255,255,255,0.35)] text-[16px]">{t('No filenames match this search')}</div>
          : <>
            <div className="grid gap-2 grid-stagger" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${THUMB_SIZES[thumbSizeIdx]}px, 1fr))` }}>
              {renderedImages.map((img, i) => (
                <ImageThumb key={img.id} image={img} idx={i} onClick={setViewerIdx}
                            galleryId={parseInt(id)}
                            onDeleted={(imgId) => setDeletedIds(s => new Set([...s, imgId]))}
                            bulkMode={bulkMode}
                            selected={selectedIdKeys.has(String(img.id))}
                            onSelect={(imgId, imgIdx, shiftKey) => {
                              const visibleImgs = displayedImages
                              setSelectedIds(s => {
                                // Anchor for a range. The ref is the explicit one, but it can be
                                // unset when the selection came from somewhere that doesn't set it
                                // (right-click "select", Select all, a restored selection). Falling
                                // back to the nearest already-selected file means shift-click always
                                // extends a range instead of silently toggling one file — which was
                                // why it "only worked after shift-clicking once first".
                                let anchor = lastSelectIdxRef.current
                                const current = new Set([...s].map(String))
                                if (shiftKey && anchor === null && current.size > 0) {
                                  let best = null
                                  visibleImgs.forEach((im, i) => {
                                    if (!current.has(String(im.id))) return
                                    if (best === null || Math.abs(i - imgIdx) < Math.abs(best - imgIdx)) best = i
                                  })
                                  anchor = best
                                }
                                if (shiftKey && anchor !== null) {
                                  const lo = Math.min(anchor, imgIdx)
                                  const hi = Math.max(anchor, imgIdx)
                                  const n = new Set(current)
                                  visibleImgs.slice(lo, hi + 1).forEach(im => n.add(String(im.id)))
                                  lastSelectIdxRef.current = imgIdx   // chain further shift-clicks
                                  return n
                                }
                                const n = new Set(current)
                                const key = String(imgId)
                                n.has(key) ? n.delete(key) : n.add(key)
                                lastSelectIdxRef.current = imgIdx
                                return n
                              })
                            }}
                            onContextMenu={(im, e) => {
                              // Windows behaviour: right-click on selected image → apply to whole selection
                              setImgCtx({ image: im, x: e.clientX, y: e.clientY })
                            }} />
              ))}
            </div>
            {renderedImages.length < displayedImages.length && (
              <div ref={loadMoreRef} className="flex flex-col items-center gap-2 py-8">
                <div className="text-[16px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  {t('Showing')} {renderedImages.length.toLocaleString()} {t('of')} {displayedImages.length.toLocaleString()}
                </div>
                <button
                  type="button"
                  onClick={() => setRenderLimit(current => Math.min(current + GALLERY_RENDER_BATCH, displayedImages.length))}
                  className="px-4 py-2 rounded-full text-[16px] cursor-pointer"
                  style={{
                    background: 'color-mix(in srgb, var(--c-accent) 14%, transparent)',
                    color: 'var(--c-accent-text)',
                    border: '0.5px solid color-mix(in srgb, var(--c-accent) 32%, transparent)',
                  }}>
                  {t('Load more')}
                </button>
              </div>
            )}
          </>
      }

      {/* More Like This */}
      <SimilarGalleriesStrip galleryId={parseInt(id)} />

      {/* Viewer */}
      {viewerIdx !== null && displayedImages.length > 0 && (
        <ImageViewer
          images={displayedImages}
          startIdx={viewerIdx}
          galleryId={parseInt(id)}
          galleryName={gallery?.name}
          galleryCreators={gallery?.creators ?? []}
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
            if (result.source_deleted) navigate(`/galleries/${result.target_id}`)
          }}
        />
      )}

      {/* Extract selected images to new gallery */}
      {showExtract && gallery && (
        <ExtractFromGalleryModal
          gallery={gallery}
          selectedImages={extractImages ?? selectedImages}
          onClose={() => { setShowExtract(false); setExtractImages(null) }}
          onExtracted={(newGallery) => {
            setShowExtract(false)
            setExtractImages(null)
            setBulkMode(false)
            setSelectedIds(new Set())
            qc.invalidateQueries({ queryKey: ['gallery', String(id)] })
            navigate(`/galleries/${newGallery.id}`)
          }}
        />
      )}

      {/* Copy a reference into a mix gallery */}
      {transferCtx && (
        <GalleryTransferModal
          images={transferCtx.images}
          currentGalleryId={parseInt(id)}
          onClose={() => setTransferCtx(null)}
        />
      )}

      {relocatingImages && (
        <RelocateModal
          mode="images"
          images={relocatingImages}
          onClose={() => setRelocatingImages(null)}
        />
      )}

      {/* Image right-click context menu */}
      {imgCtx && (
        <ImageContextMenu
          image={imgCtx.image}
          bulkCount={contextBulkImages?.length ?? null}
          position={{ x: imgCtx.x, y: imgCtx.y }}
          onClose={() => setImgCtx(null)}
          onSelectMode={!bulkMode ? () => {
            setBulkMode(true)
            setSelectedIds(new Set([String(imgCtx.image.id)]))
            // Seed the range anchor too — entering select mode this way used to
            // leave it unset, so the next shift-click toggled a single file
            // instead of extending a range.
            const visibleImgs = displayedImages
            const seedIdx = visibleImgs.findIndex(i => i.id === imgCtx.image.id)
            lastSelectIdxRef.current = seedIdx >= 0 ? seedIdx : null
            setImgCtx(null)
          } : undefined}
          onView={() => {
            const idx2 = displayedImages.findIndex(i => i.id === imgCtx.image.id)
            if (idx2 >= 0) setViewerIdx(idx2)
          }}
          onSetCover={() => galleriesApi.setCover(parseInt(id), imgCtx.image.id)
            .then(() => { toast.success(t('Set as gallery cover!')); qc.invalidateQueries({ queryKey: ['gallery', String(id)] }) })
            .catch(() => toast.error(t('Failed to set cover')))
          }
          onSendToViewer={() => {
            const targets = contextImages
            let added = 0, skipped = 0
            for (const img of targets) {
              if (multiViewerQueue.length + added >= MULTIVIEWER_MAX) { skipped += targets.length - added; break }
              const ok = addToMultiViewer({ id: `img-${img.id}`, type: 'image', media: img })
              if (ok) added++; else skipped++
            }
            if (added > 0) toast.success(`${added} ${added === 1 ? 'image' : 'images'} sent to Playlists`)
            if (skipped > 0) toast(`${skipped} already queued or queue full`, { icon: 'ℹ️' })
          }}
          onCopyTo={() => setTransferCtx({ images: contextImages })}
          onRelocate={() => setRelocatingImages(contextImages)}
          onExtract={() => {
            setExtractImages(contextImages)
            setShowExtract(true)
          }}
          creators={gallery?.creators ?? []}
          onSetAsAvatar={(creatorId) => {
            if (imgCtx.image.is_video) {
              setAvatarFramePicker({ creatorId, image: imgCtx.image, mode: 'avatar' })
              return
            }
            creatorsApi.setAvatarFromImage(creatorId, imgCtx.image.id)
              .then(() => { toast.success(t('Avatar updated!')); bumpAvatarBust(); qc.invalidateQueries({ queryKey: ['creator', String(creatorId)] }) })
              .catch(() => toast.error(t('Failed to set avatar')))
          }}
          onSetAsBanner={(creatorId) => {
            if (imgCtx.image.is_video) {
              setAvatarFramePicker({ creatorId, image: imgCtx.image, mode: 'banner' })
              return
            }
            creatorsApi.setBannerFromImage(creatorId, imgCtx.image.id)
              .then(() => { toast.success(t('Banner updated!')); bumpAvatarBust(); qc.invalidateQueries({ queryKey: ['creator', String(creatorId)] }) })
              .catch(() => toast.error(t('Failed to set banner')))
          }}
          onAssignCreator={async (creatorId) => {
            const targets = contextImages
            try {
              // One request for the whole selection — the per-file loop this
              // replaces is why a big selection sat there spinning.
              const ids = targets.map(i => i.id)
              const { data } = await imagesApi.bulkAddCreator(ids, creatorId)
              const n = data?.assigned ?? 0
              toast.success(n > 0
                ? `${data.creator_name} assigned to ${n} ${n === 1 ? 'file' : 'files'}`
                : 'Already assigned')
              patchCachedCreators(qc, ids, {
                id: data.creator_id, name: data.creator_name, creator_type: data.creator_type,
              })
            } catch (err) {
              console.error('Assign creator failed:', err)
              toast.error(t('Failed to assign creator'))
            }
          }}
          onDelete={async (mode) => {
            const targets = contextImages
            const ids = targets.map(img => img.id)
            const tid = toast.loading(mode === 'vault'
              ? `Removing ${ids.length} ${ids.length === 1 ? 'file' : 'files'}…`
              : `Deleting ${ids.length} ${ids.length === 1 ? 'file' : 'files'} from disk…`)
            try {
              const { data } = await imagesApi.bulkDelete(ids, mode === 'vault')
              const removedIds = data?.ids ?? []
              const failures = data?.failed ?? []
              if (removedIds.length) {
                setDeletedIds(current => new Set([...current, ...removedIds.map(String)]))
                setSelectedIds(current => {
                  const next = new Set([...current].map(String))
                  removedIds.forEach(imageId => next.delete(String(imageId)))
                  return next
                })
              }
              toast.dismiss(tid)
              if (removedIds.length) toast.success(mode === 'vault'
                ? `${removedIds.length} ${removedIds.length === 1 ? 'file' : 'files'} removed from vault`
                : `${removedIds.length} ${removedIds.length === 1 ? 'file' : 'files'} deleted from disk`)
              if (failures.length) {
                const reason = failures[0]?.message
                toast.error(`${failures.length} deletion${failures.length === 1 ? '' : 's'} failed${reason ? `: ${reason}` : ''}`)
              }
            } catch (error) {
              toast.dismiss(tid)
              toast.error(`Deletion failed: ${apiErrorMessage(error, 'Could not complete deletion')}`)
            } finally {
              qc.invalidateQueries({ queryKey: ['gallery', String(id)] })
            }
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

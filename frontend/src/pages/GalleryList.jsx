import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Search, Droplets, Star, Images, Filter, SortAsc, X,
  CheckSquare, Square, UserPlus, UserMinus, ChevronDown, AlertCircle,
  Pencil, FolderPlus, Check, LayoutTemplate, Trash2, GitMerge,
  RotateCcw, FolderSymlink, Archive,
} from 'lucide-react'
import { galleriesApi, creatorsApi, imagesApi } from '../lib/api'
import TagFilterInput from '../components/TagFilterInput'
import { useVaultStore } from '../store/vault'
import toast from 'react-hot-toast'
import { SortDropdown } from '../components/SortDropdown'
import FranchiseFilter from '../components/FranchiseFilter'
import PeriodFilter from '../components/PeriodFilter'
import { useAllCreators } from '../hooks/useAllCreators'
import GalleryContextMenu from '../components/GalleryContextMenu'
import GalleryPagination from '../components/GalleryPagination'
import { useT } from '../i18n'

const TYPE_COLORS = {
  cosplayer: '#9FE1CB', ethot: '#ED93B1', artist: '#CECBF6',
  character: '#FAC775', actress: '#ED93B1', custom: '#D3D1C7',
}

const GL_STATE_KEY = 'vault_gl_state'

const SORT_OPTIONS = [
  { value: 'date_added',    label: 'Date added' },
  { value: 'date_modified', label: 'Date modified' },
  { value: 'name',          label: 'Name A–Z' },
  { value: 'image_count',   label: 'Most photos' },
  { value: 'rating',        label: 'Highest rated' },
  { value: 'cum_count',     label: 'Most cummed' },
  { value: 'period',        label: 'Period' },
  { value: 'random',        label: 'Random' },
]

const PAGE_SIZES = [25, 50, 100, 250]
const DEFAULT_PAGE_SIZE = 100

// ── Create gallery modal ───────────────────────────────────────────────────────
function CreateGalleryModal({ onClose }) {
  const t = useT()
  const [name, setName] = useState('')
  const qc = useQueryClient()

  const createMutation = useMutation({
    mutationFn: () => galleriesApi.create({ name: name.trim() }),
    onSuccess: () => {
      toast.success(`Gallery "${name}" created!`)
      qc.invalidateQueries({ queryKey: ['galleries'] })
      onClose()
    },
    onError: (err) => toast.error(err.response?.data?.detail || t('Failed to create gallery')),
  })

  const submit = () => { if (name.trim()) createMutation.mutate() }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in" style={{ background: 'rgba(0,0,0,0.7)' }}
         onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rounded-[14px] p-5 w-80 animate-modal-pop shadow-2xl" style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.15)' }}>
        <div className="text-[17px] font-medium text-[rgba(255,255,255,0.9)] mb-4 flex items-center gap-2">
          <FolderPlus size={14} style={{ color: '#7F77DD' }} /> {t('New gallery')}
        </div>
        <input
          autoFocus value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose() }}
          placeholder={t('Gallery name…')}
          className="w-full px-3 py-2 rounded-[8px] text-[14px] outline-none mb-4"
          style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.85)', border: '0.5px solid rgba(255,255,255,0.15)' }}
        />
        <div className="flex gap-2 justify-end">
          <button type="button" onMouseDown={onClose}
                  className="px-3 py-1.5 rounded-full text-[13px] cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' }}>
            {t('Cancel')}
          </button>
          <button type="button" onMouseDown={submit} disabled={!name.trim() || createMutation.isPending}
                  className="px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer disabled:opacity-40"
                  style={{ background: 'rgba(127,119,221,0.3)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.5)' }}>
            {createMutation.isPending ? t('Creating…') : t('Create')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Rename folder on disk modal ────────────────────────────────────────────────
function RenameFolderModal({ gallery, onClose }) {
  const t = useT()
  const folderName = gallery.folder_path ? gallery.folder_path.split(/[\\/]/).filter(Boolean).pop() : gallery.name
  const [name, setName] = useState(folderName)
  const qc = useQueryClient()

  const renameMutation = useMutation({
    mutationFn: () => galleriesApi.renameFolder(gallery.id, name.trim()),
    onSuccess: () => {
      toast.success(t('Folder renamed on disk'))
      qc.invalidateQueries({ queryKey: ['galleries'] })
      qc.invalidateQueries({ queryKey: ['gallery', String(gallery.id)] })
      onClose()
    },
    onError: (err) => toast.error(err?.response?.data?.detail || t('Rename failed')),
  })

  const submit = () => { if (name.trim() && name.trim() !== folderName) renameMutation.mutate() }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in" style={{ background: 'rgba(0,0,0,0.7)' }}
         onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rounded-[14px] p-5 w-96 animate-modal-pop shadow-2xl" style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.15)' }}>
        <div className="text-[17px] font-medium text-[rgba(255,255,255,0.9)] mb-1 flex items-center gap-2">
          <FolderSymlink size={13} style={{ color: '#7F77DD' }} /> {t('Rename folder on disk')}
        </div>
        <div className="text-[13px] mb-4" style={{ color: 'rgba(255,255,255,0.35)' }}>
          {t('This renames the actual directory — files will move and all paths will update.')}
        </div>
        <input
          autoFocus value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose() }}
          className="w-full px-3 py-2 rounded-[8px] text-[14px] outline-none mb-4 font-mono"
          style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.85)', border: '0.5px solid rgba(255,255,255,0.15)' }}
        />
        <div className="flex gap-2 justify-end">
          <button type="button" onMouseDown={onClose}
                  className="px-3 py-1.5 rounded-full text-[13px] cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' }}>
            {t('Cancel')}
          </button>
          <button type="button" onMouseDown={submit}
                  disabled={!name.trim() || name.trim() === folderName || renameMutation.isPending}
                  className="px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer disabled:opacity-40"
                  style={{ background: 'rgba(127,119,221,0.3)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.5)' }}>
            {renameMutation.isPending ? t('Renaming…') : t('Rename folder')}
          </button>
        </div>
      </div>
    </div>
  )
}


// ── Rename gallery modal ───────────────────────────────────────────────────────
function RenameModal({ gallery, onClose }) {
  const t = useT()
  const [name, setName] = useState(gallery.name)
  const qc = useQueryClient()

  const renameMutation = useMutation({
    mutationFn: () => galleriesApi.update(gallery.id, { name: name.trim() }),
    onSuccess: () => {
      toast.success(t('Gallery renamed'))
      qc.invalidateQueries({ queryKey: ['galleries'] })
      qc.invalidateQueries({ queryKey: ['gallery', String(gallery.id)] })
      onClose()
    },
    onError: () => toast.error(t('Rename failed')),
  })

  const submit = () => { if (name.trim() && name.trim() !== gallery.name) renameMutation.mutate() }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in" style={{ background: 'rgba(0,0,0,0.7)' }}
         onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rounded-[14px] p-5 w-80 animate-modal-pop shadow-2xl" style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.15)' }}>
        <div className="text-[17px] font-medium text-[rgba(255,255,255,0.9)] mb-4 flex items-center gap-2">
          <Pencil size={13} style={{ color: '#7F77DD' }} /> {t('Rename gallery')}
        </div>
        <input
          autoFocus value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose() }}
          className="w-full px-3 py-2 rounded-[8px] text-[14px] outline-none mb-4"
          style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.85)', border: '0.5px solid rgba(255,255,255,0.15)' }}
        />
        <div className="flex gap-2 justify-end">
          <button type="button" onMouseDown={onClose}
                  className="px-3 py-1.5 rounded-full text-[13px] cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' }}>
            {t('Cancel')}
          </button>
          <button type="button" onMouseDown={submit}
                  disabled={!name.trim() || name.trim() === gallery.name || renameMutation.isPending}
                  className="px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer disabled:opacity-40"
                  style={{ background: 'rgba(127,119,221,0.3)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.5)' }}>
            {renameMutation.isPending ? t('Saving…') : t('Rename')}
          </button>
        </div>
      </div>
    </div>
  )
}


// ── Star rating ───────────────────────────────────────────────────────────────
function StarRating({ value = 0, onRate, className = '' }) {
  const [hovered, setHovered] = useState(0)
  return (
    <div
      className={`flex gap-0.5 items-center ${className}`}
      onMouseLeave={() => setHovered(0)}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}>
      {[1,2,3,4,5,6,7,8,9,10].map(n => {
        const filled = hovered ? n <= hovered : n <= value
        return (
          <button
            key={n}
            type="button"
            onMouseEnter={() => setHovered(n)}
            onMouseDown={e => {
              e.stopPropagation()
              onRate(value === n ? 0 : n)
            }}
            className="cursor-pointer p-0.5 transition-transform hover:scale-125"
            title={`Rate ${n}/10`}>
            <Star
              size={9}
              fill={filled ? (hovered ? 'rgba(186,117,23,0.7)' : '#BA7517') : 'none'}
              stroke={filled ? '#BA7517' : 'rgba(255,255,255,0.2)'}
              strokeWidth={1.5}
            />
          </button>
        )
      })}
      {value > 0 && !hovered && (
        <span className="text-[10px] ml-0.5" style={{ color: '#BA7517' }}>{value}</span>
      )}
    </div>
  )
}

// ── Gallery card ──────────────────────────────────────────────────────────────
// React.memo: grid of 100 cards won't re-render when parent state changes
// (search input, sort, modal open, bulk selection of other cards, etc.)
const GalleryCard = React.memo(function GalleryCard({ gallery, selected, onSelect, onClick, bulkMode, thumbSize = 180, onRename, onContextMenu }) {
  const t = useT()
  const [isHovered, setIsHovered]     = useState(false)
  const [fanImgs, setFanImgs]         = useState([])
  const [firstVideo, setFirstVideo]   = useState(null)
  const [localRating, setLocalRating] = useState(gallery.rating ?? 0)
  const [mouseX, setMouseX]           = useState(0.5)
  const videoRef      = useRef(null)
  const cardRef       = useRef(null)
  const hoverTimer    = useRef(null)
  const qc = useQueryClient()

  const handleMouseMove = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setMouseX(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)))
  }, [])

  const rateMutation = useMutation({
    mutationFn: (r) => galleriesApi.rate(gallery.id, r),
    onMutate: (r) => setLocalRating(r),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['galleries'] }),
    onError: () => { setLocalRating(gallery.rating ?? 0); toast.error(t('Rating failed')) },
  })

  const handleMouseEnter = useCallback(() => {
    // No fan/video in bulk-select mode — you're clicking, not browsing
    if (bulkMode) return
    // 400 ms intent delay — accidental mouse passes don't trigger anything
    hoverTimer.current = setTimeout(async () => {
      if (!gallery?.id) return
      setIsHovered(true)
      try {
        const [rPhotos, rVideo] = await Promise.all([
          imagesApi.list({ gallery_id: gallery.id, is_video: false, sort_by: 'random', limit: 5 }),
          imagesApi.list({ gallery_id: gallery.id, is_video: true,  sort_by: 'random', limit: 1 }),
        ])
        const toArr = (r) => { const d = r.data; return d?.images ?? (Array.isArray(d) ? d : []) }
        setFanImgs(toArr(rPhotos).slice(0, 5))
        setFirstVideo(toArr(rVideo)[0] ?? null)
      } catch {}
    }, 400)
  }, [bulkMode, gallery?.id])

  const handleMouseLeave = useCallback(() => {
    clearTimeout(hoverTimer.current)
    setIsHovered(false)
    setFanImgs([])
    setFirstVideo(null)
  }, [])

  const showFan  = isHovered && fanImgs.length >= 3 && thumbSize >= 150
  const visCount = fanImgs.length
  const activeIdx = fanImgs.length > 0 ? Math.min(fanImgs.length - 1, Math.floor(mouseX * fanImgs.length)) : 0

  useEffect(() => {
    if (isHovered && firstVideo && videoRef.current) {
      videoRef.current.currentTime = 0
      videoRef.current.play().catch(() => {})
    } else if (!isHovered && videoRef.current) {
      videoRef.current.pause()
    }
  }, [isHovered, firstVideo])

  // Release video file handle and cancel any pending hover timer on unmount
  useEffect(() => {
    return () => {
      clearTimeout(hoverTimer.current)
      const v = videoRef.current
      if (!v) return
      v.pause()
      v.removeAttribute('src')
      v.load()
    }
  }, [])

  return (
    <>
    <div ref={cardRef}
         className="vault-card overflow-hidden cursor-pointer group relative animate-fade-in"
         style={{ contentVisibility: 'auto', containIntrinsicSize: `0 ${thumbSize + 64}px` }}
         onMouseEnter={handleMouseEnter}
         onMouseLeave={handleMouseLeave}
         onMouseMove={isHovered ? handleMouseMove : undefined}
         onClick={(e) => bulkMode ? onSelect(gallery.id, e) : onClick()}
         onContextMenu={(e) => { e.preventDefault(); onContextMenu?.(gallery, e) }}>
      {bulkMode && (
        <div className="absolute top-2 left-2 z-20"
             onClick={e => { e.stopPropagation(); onSelect(gallery.id, e) }}>
          {selected
            ? <CheckSquare size={16} style={{ color: '#7F77DD' }} />
            : <Square size={16} style={{ color: 'rgba(255,255,255,0.5)', fill: 'rgba(0,0,0,0.4)' }} />
          }
        </div>
      )}
      {selected && (
        <div className="absolute inset-0 z-10 pointer-events-none rounded-[10px]"
             style={{ border: '1.5px solid #7F77DD', background: 'rgba(127,119,221,0.08)' }} />
      )}
      <div className="relative overflow-hidden" style={{ height: thumbSize, background: 'rgba(255,255,255,0.03)' }}>
        <div className="absolute inset-0">
        {gallery.cover_thumb
          ? <img src={gallery.cover_thumb} alt={gallery.name}
                 loading="lazy" decoding="async"
                 className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                 style={{ transform: (isHovered && firstVideo) ? 'scale(1)' : undefined }} />
          : <div className="w-full h-full flex items-center justify-center opacity-20">
              <Images size={48} />
            </div>
        }
        
        {firstVideo && (
          <video
            ref={videoRef}
            src={`/api/images/${firstVideo.id}/file`}
            muted
            playsInline
            preload="none"
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-200"
            style={{ opacity: isHovered ? 1 : 0, zIndex: 2, pointerEvents: 'none' }}
          />
        )}

        {gallery.cum_count > 0 && (
          <div className="absolute top-2 right-2 flex items-center gap-1 text-[12px] font-medium px-2 py-0.5 rounded-full z-10"
               style={{ background: 'rgba(0,0,0,0.6)', color: '#ED93B1' }}>
            <Droplets size={9} /> {gallery.cum_count}
          </div>
        )}
        {gallery.creators?.length === 0 && (
          <div className="absolute bottom-2 left-2 text-[11px] px-1.5 py-0.5 rounded-full z-10"
               style={{ background: 'rgba(186,117,23,0.7)', color: '#FAC775' }}>
            {t('unassigned')}
          </div>
        )}
        </div>{/* end absolute inset-0 */}
      </div>
      <div className="p-2.5">
        <div className="flex items-center gap-1 group/name">
          <div className="text-[14px] font-medium text-[rgba(255,255,255,0.85)] truncate flex-1">{gallery.name}</div>
          <button type="button"
                  onMouseDown={e => { e.stopPropagation(); onRename?.(gallery) }}
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-[rgba(255,255,255,0.35)] hover:text-[rgba(255,255,255,0.8)] p-0.5 z-20 relative"
                  title={t('Rename gallery')}>
            <Pencil size={10} />
          </button>
        </div>
        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[12px] text-[rgba(255,255,255,0.35)]">{gallery.image_count} {t('items')}</span>
            {gallery.is_mix && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: 'rgba(127,119,221,0.15)', color: '#CECBF6' }}>
                {t('Mix')}
              </span>
            )}
            {gallery.period_month && gallery.period_year && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: 'rgba(29,158,117,0.15)', color: '#9FE1CB' }}>
                {new Date(gallery.period_year, gallery.period_month - 1).toLocaleString('default', { month: 'short', year: 'numeric' })}
              </span>
            )}
          </div>
          {gallery.creators?.length > 0 && (
            <div className="flex gap-1 flex-wrap justify-end">
              {gallery.creators.slice(0, 2).map(c => (
                <span key={c.id} className="text-[11px] px-1.5 py-0.5 rounded-full truncate max-w-[80px]"
                      style={{ background: 'rgba(255,255,255,0.06)', color: TYPE_COLORS[c.creator_type] || '#D3D1C7' }}>
                  {c.name}
                </span>
              ))}
              {gallery.creators.length > 2 && (
                <span className="text-[11px] px-1.5 py-0.5 rounded-full"
                      style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}>
                  +{gallery.creators.length - 2}
                </span>
              )}
            </div>
          )}
        </div>
        {/* Rating row — always visible so the user knows they can rate */}
        <div className={`mt-1.5 transition-opacity duration-150 ${localRating > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          <StarRating
            value={localRating}
            onRate={(r) => !rateMutation.isPending && rateMutation.mutate(r)}
          />
        </div>
      </div>
    </div>

    {/* Photo fan — portal to document.body escapes both the scroll container
        AND any Framer Motion transform ancestor that would break position:fixed */}
    {showFan && cardRef.current && createPortal(
      (() => {
        const r = cardRef.current.getBoundingClientRect()
        return (
          <div className="pointer-events-none" style={{
            position: 'fixed',
            left: r.left + r.width / 2,
            top: r.top - 8,
            transform: 'translateX(-50%) translateY(-100%)',
            zIndex: 9998,
          }}>
            <div className="relative flex items-end justify-center" style={{ width: 320, height: 200 }}>
              {fanImgs.slice(0, visCount).map((img, i) => {
                const isActive = i === activeIdx % visCount
                const spread   = (i - (visCount - 1) / 2) * 44
                const rot      = (i - (visCount - 1) / 2) * 5
                return (
                  <div key={img.id} style={{
                    position: 'absolute', bottom: 0, left: '50%',
                    transform: `translateX(calc(-50% + ${spread}px)) rotate(${rot}deg) translateY(${isActive ? -18 : 0}px)`,
                    transition: 'transform 0.18s ease, box-shadow 0.18s ease',
                    zIndex: isActive ? 10 : visCount - Math.abs(i - activeIdx % visCount),
                    boxShadow: isActive ? '0 14px 32px rgba(0,0,0,0.8)' : '0 6px 16px rgba(0,0,0,0.6)',
                    borderRadius: 8, overflow: 'hidden',
                    width: isActive ? 108 : 78,
                    border: `1px solid ${isActive ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)'}`,
                  }}>
                    <img src={`/api/images/${img.id}/thumb`} alt=""
                         style={{ width: '100%', display: 'block', aspectRatio: '2/3', objectFit: 'cover' }} />
                  </div>
                )
              })}
            </div>
          </div>
        )
      })(),
      document.body
    )}
    </>
  )
}, (prev, next) =>
  prev.gallery   === next.gallery   &&
  prev.selected  === next.selected  &&
  prev.bulkMode  === next.bulkMode  &&
  prev.thumbSize === next.thumbSize
)

// ── Creator dropdown — multi or single-select, ref-based outside-click ──────────
function CreatorDropdown({ value, onChange, placeholder }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const wrapperRef = useRef(null)

  const isMulti = Array.isArray(value)

  const { data: creators } = useAllCreators()

  const filtered = useMemo(() => {
    if (!creators) return []
    return creators.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
  }, [creators, search])

  const selectedCreators = useMemo(() => {
    if (!creators) return []
    if (isMulti) {
      if (!value || !value.length) return []
      return value.map(id => creators.find(c => c.id === id)).filter(Boolean)
    } else {
      if (!value) return []
      const found = creators.find(c => c.id === value)
      return found ? [found] : []
    }
  }, [creators, value, isMulti])

  const hasSelection = isMulti ? (value && value.length > 0) : !!value

  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggle = useCallback((id) => {
    if (isMulti) {
      onChange(prev => {
        const prevArray = Array.isArray(prev) ? prev : []
        return prevArray.includes(id) ? prevArray.filter(x => x !== id) : [...prevArray, id]
      })
    } else {
      onChange(id)
      setOpen(false)
      setSearch('')
    }
  }, [onChange, isMulti])

  const clearAll = useCallback((e) => {
    e?.stopPropagation()
    if (isMulti) {
      onChange([])
    } else {
      onChange(null)
    }
    setSearch('')
  }, [onChange, isMulti])

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); setOpen(o => !o) }}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[13px] cursor-pointer"
        style={{
          background: hasSelection ? 'rgba(127,119,221,0.2)' : 'rgba(255,255,255,0.05)',
          color: hasSelection ? '#CECBF6' : 'rgba(255,255,255,0.45)',
          border: `0.5px solid ${hasSelection ? 'rgba(127,119,221,0.4)' : 'rgba(255,255,255,0.08)'}`,
        }}>
        {hasSelection
          ? (selectedCreators.length === 1
              ? selectedCreators[0].name
              : `${selectedCreators.length} creators`)
          : placeholder}
        {hasSelection
          ? <X size={11} onMouseDown={clearAll} className="cursor-pointer" />
          : <ChevronDown size={11} />
        }
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 rounded-[10px] overflow-hidden shadow-2xl animate-menu-pop"
             style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.15)', minWidth: 220, maxHeight: 300 }}>
          <div className="p-2 border-b border-[rgba(255,255,255,0.07)]">
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('Search creators...')}
              className="w-full bg-transparent text-[13px] text-[rgba(255,255,255,0.8)] placeholder-[rgba(255,255,255,0.25)] outline-none"
            />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
            {hasSelection && (
              <button
                type="button"
                onMouseDown={clearAll}
                className="w-full text-left px-3 py-2 text-[13px] text-[rgba(255,255,255,0.4)] hover:bg-[rgba(255,255,255,0.05)] cursor-pointer">
                {t('Clear selection')}
              </button>
            )}
            {filtered.map(c => {
              const isSelected = isMulti ? value.includes(c.id) : value === c.id
              return (
                <button
                  key={c.id}
                  type="button"
                  onMouseDown={() => toggle(c.id)}
                  className="w-full text-left px-3 py-2 text-[13px] cursor-pointer flex items-center gap-2 hover:bg-[rgba(255,255,255,0.05)]"
                  style={{
                    background: isSelected ? 'rgba(127,119,221,0.15)' : 'transparent',
                    color: isSelected ? '#CECBF6' : 'rgba(255,255,255,0.7)',
                  }}>
                  {isMulti ? (
                    isSelected
                      ? <CheckSquare size={12} style={{ color: '#7F77DD', flexShrink: 0 }} />
                      : <Square size={12} style={{ color: 'rgba(255,255,255,0.25)', flexShrink: 0 }} />
                  ) : (
                    isSelected && <Check size={12} style={{ color: '#7F77DD', flexShrink: 0 }} />
                  )}
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: TYPE_COLORS[c.creator_type] || '#D3D1C7' }} />
                  {c.name}
                </button>
              )
            })}
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-[13px] text-[rgba(255,255,255,0.25)] text-center">{t('No creators found')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
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
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
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
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] cursor-pointer"
        style={{
          background: active ? 'rgba(127,119,221,0.2)' : 'rgba(255,255,255,0.05)',
          color: active ? '#CECBF6' : 'rgba(255,255,255,0.45)',
          border: `0.5px solid ${active ? 'rgba(127,119,221,0.4)' : 'rgba(255,255,255,0.08)'}`,
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
        <div className="absolute top-full mt-1 left-0 z-50 rounded-[10px] shadow-2xl animate-menu-pop overflow-hidden"
             style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.15)', minWidth: 160 }}>
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

// ── Bulk action panel ─────────────────────────────────────────────────────────
// ── Bulk Merge Modal ──────────────────────────────────────────────────────────
function BulkMergeModal({ galleries, onClose, onMerged }) {
  const t = useT()
  const qc = useQueryClient()
  const [targetId, setTargetId]       = useState(null)
  const [moveFiles, setMoveFiles]     = useState(true)
  const [collision, setCollision]     = useState('rename')
  const [step, setStep]               = useState('pick')   // pick | confirm
  const [merging, setMerging]         = useState(false)
  const [progress, setProgress]       = useState(null)     // { done, total, errors }

  const sources = galleries.filter(g => g.id !== targetId)
  const target  = galleries.find(g => g.id === targetId)

  const doMerge = async () => {
    if (!targetId || sources.length === 0) return
    setMerging(true)
    setProgress({ done: 0, total: sources.length, errors: 0 })
    let totalMoved = 0, totalSkipped = 0, errors = 0

    for (const src of sources) {
      try {
        const res = await galleriesApi.merge(targetId, {
          source_id: src.id,
          move_files: moveFiles,
          collision_strategy: collision,
        })
        const d = res.data
        totalMoved   += (d.moved ?? 0) + (d.renamed ?? 0) + (d.replaced ?? 0) + (d.db_only ?? 0)
        totalSkipped += d.skipped ?? 0
        setProgress(p => ({ ...p, done: p.done + 1 }))
      } catch {
        errors++
        setProgress(p => ({ ...p, done: p.done + 1, errors: p.errors + 1 }))
      }
    }

    const parts = []
    if (totalMoved   > 0) parts.push(`${totalMoved} images merged`)
    if (totalSkipped > 0) parts.push(`${totalSkipped} skipped`)
    if (errors       > 0) parts.push(`${errors} failed`)
    toast[errors > 0 ? 'error' : 'success'](parts.join(', ') || t('Merged'))

    qc.invalidateQueries({ queryKey: ['galleries'] })
    setMerging(false)
    onMerged()
  }

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
         style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
         onClick={e => { if (e.target === e.currentTarget && !merging) onClose() }}>
      <div className="rounded-[14px] w-full max-w-md flex flex-col overflow-hidden"
           style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.12)', maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(255,255,255,0.07)]">
          <div className="flex items-center gap-2">
            <GitMerge size={16} style={{ color: '#CECBF6' }} />
            <span style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
              {t('Merge')} {galleries.length} {t('galleries')}
            </span>
          </div>
          {!merging && (
            <button onClick={onClose} className="cursor-pointer" style={{ color: 'rgba(255,255,255,0.4)' }}>
              <X size={16} />
            </button>
          )}
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-4">
          {step === 'pick' ? (
            <>
              {/* Pick target */}
              <div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: 500, marginBottom: 6 }}>
                  {t('Which gallery should survive?')}
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>
                  {t('All others will be merged into it. The target keeps its name and folder.')}
                </div>
                <div className="flex flex-col gap-1.5">
                  {galleries.map(g => (
                    <button key={g.id} onClick={() => setTargetId(g.id)}
                            className="flex items-center gap-3 px-3 py-2.5 rounded-[8px] cursor-pointer text-left transition-colors"
                            style={{
                              background: targetId === g.id ? 'rgba(127,119,221,0.2)' : 'rgba(255,255,255,0.04)',
                              border: `0.5px solid ${targetId === g.id ? 'rgba(127,119,221,0.5)' : 'rgba(255,255,255,0.07)'}`,
                            }}>
                      <div className="w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0"
                           style={{ borderColor: targetId === g.id ? '#CECBF6' : 'rgba(255,255,255,0.2)', background: targetId === g.id ? '#7F77DD' : 'transparent' }}>
                        {targetId === g.id && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div style={{ fontSize: 13, color: targetId === g.id ? '#CECBF6' : 'rgba(255,255,255,0.75)', fontWeight: targetId === g.id ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{g.image_count ?? 0} {t('images')}</div>
                      </div>
                      {targetId === g.id && (
                        <span style={{ fontSize: 10, color: '#CECBF6', background: 'rgba(127,119,221,0.2)', border: '0.5px solid rgba(127,119,221,0.4)', padding: '1px 6px', borderRadius: 4 }}>{t('TARGET')}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Move files toggle */}
              <div className="flex items-start justify-between gap-3 pt-3 border-t border-[rgba(255,255,255,0.06)]">
                <div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>{t('Move files on disk')}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                    {moveFiles ? t('Files physically moved into target folder') : t('DB records only — files stay in place')}
                  </div>
                </div>
                <button onClick={() => setMoveFiles(v => !v)} className="flex-shrink-0 mt-0.5"
                        style={{ width: 38, height: 20, borderRadius: 10, background: moveFiles ? 'rgba(127,119,221,0.6)' : 'rgba(255,255,255,0.1)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s' }}>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: moveFiles ? 'calc(100% - 17px)' : '3px', transition: 'left 0.2s' }} />
                </button>
              </div>

              {/* Collision strategy */}
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
                                background: collision === key ? 'rgba(127,119,221,0.2)' : 'rgba(255,255,255,0.04)',
                                border: `0.5px solid ${collision === key ? 'rgba(127,119,221,0.5)' : 'rgba(255,255,255,0.08)'}`,
                              }}>
                        <div style={{ fontSize: 12, color: collision === key ? '#CECBF6' : 'rgba(255,255,255,0.6)', fontWeight: 600 }}>{t(label)}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>{t(desc)}</div>
                      </button>
                    ))}
                  </div>
                  {collision === 'replace' && (
                    <div className="mt-2 px-3 py-2 rounded-[8px]"
                         style={{ background: 'rgba(212,83,126,0.1)', border: '0.5px solid rgba(212,83,126,0.3)', fontSize: 11, color: '#F4C0D1' }}>
                      ⚠ {t('Replace permanently deletes existing files in the target folder that share a filename.')}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : merging ? (
            /* Progress view */
            <div className="flex flex-col items-center gap-4 py-4">
              <GitMerge size={28} style={{ color: '#CECBF6' }} className="animate-pulse" />
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>
                {t('Merging')} {progress?.done ?? 0} {t('of')} {progress?.total ?? 0}…
              </div>
              <div className="w-full h-1.5 rounded-full bg-[rgba(255,255,255,0.07)] overflow-hidden">
                <div className="h-full rounded-full transition-all"
                     style={{ width: `${progress ? (progress.done / progress.total) * 100 : 0}%`, background: '#7F77DD' }} />
              </div>
              {(progress?.errors ?? 0) > 0 && (
                <div style={{ fontSize: 12, color: '#F4C0D1' }}>{progress.errors} {t('errors so far')}</div>
              )}
            </div>
          ) : (
            /* Confirm view */
            <>
              <div className="rounded-[8px] px-3 py-3 flex flex-col gap-1"
                   style={{ background: 'rgba(186,117,23,0.1)', border: '1px solid rgba(186,117,23,0.35)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#FAC775' }}>⚠ {t('Confirm merge')}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, marginTop: 2 }}>
                  {sources.length} {sources.length === 1 ? t('gallery') : t('galleries')} {t('will be merged into')} <b style={{ color: 'rgba(255,255,255,0.85)' }}>{target?.name}</b>.
                  {' '}{t('Merged galleries will be deleted if all their images are moved successfully.')}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                {sources.map(g => (
                  <div key={g.id} className="flex items-center gap-2 px-3 py-2 rounded-[8px]"
                       style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.06)', fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                    <GitMerge size={11} style={{ color: 'rgba(127,119,221,0.5)', flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                    <span style={{ color: 'rgba(255,255,255,0.25)', flexShrink: 0 }}>{g.image_count ?? 0} {t('imgs')}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 px-3 py-2 rounded-[8px] mt-1"
                     style={{ background: 'rgba(127,119,221,0.12)', border: '0.5px solid rgba(127,119,221,0.4)', fontSize: 12, color: '#CECBF6' }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>→ {target?.name}</span>
                  <span style={{ color: 'rgba(127,119,221,0.6)', flexShrink: 0, fontSize: 10 }}>{t('TARGET')}</span>
                </div>
              </div>

              {moveFiles ? (
                <div className="px-3 py-2 rounded-[8px]"
                     style={{ background: 'rgba(212,83,126,0.08)', border: '0.5px solid rgba(212,83,126,0.25)', fontSize: 11, color: '#F4C0D1' }}>
                  {t('Files will be physically moved on disk · Conflicts:')} <b>{collision}</b>
                </div>
              ) : (
                <div className="px-3 py-2 rounded-[8px]"
                     style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.07)', fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                  {t('Database records only — files stay in current locations')}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!merging && (
          <div className="flex justify-end gap-2 px-5 py-4 border-t border-[rgba(255,255,255,0.07)]">
            {step === 'pick' ? (
              <>
                <button onClick={onClose} className="px-4 py-2 rounded-[8px] text-[13px] cursor-pointer"
                        style={{ color: 'rgba(255,255,255,0.45)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                  {t('Cancel')}
                </button>
                <button onClick={() => setStep('confirm')} disabled={!targetId}
                        className="px-4 py-2 rounded-[8px] text-[13px] cursor-pointer disabled:opacity-40"
                        style={{ background: 'rgba(127,119,221,0.2)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.4)' }}>
                  {t('Review →')}
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setStep('pick')}
                        className="px-4 py-2 rounded-[8px] text-[13px] cursor-pointer"
                        style={{ color: 'rgba(255,255,255,0.45)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                  {t('← Back')}
                </button>
                <button onClick={doMerge}
                        className="px-4 py-2 rounded-[8px] text-[13px] cursor-pointer flex items-center gap-2"
                        style={{ background: 'rgba(127,119,221,0.25)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.5)' }}>
                  <GitMerge size={13} /> {t('Confirm merge')}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  , document.body)
}


function DeleteModal({ count, activeOp, onVault, onDisk, onCancel }) {
  const t = useT()
  const busy = activeOp !== null
  return createPortal(
    <>
      {/* Backdrop */}
      <motion.div
        className="fixed inset-0 z-[200]"
        style={{ background: 'rgba(0,0,0,0.75)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      />
      {/* Card */}
      <motion.div
        className="fixed inset-0 z-[201] flex items-center justify-center pointer-events-none"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        <div className="rounded-[14px] p-6 flex flex-col gap-4 w-[360px] pointer-events-auto"
             style={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 24px 60px rgba(0,0,0,0.6)' }}>
          <div>
            <div className="text-[17px] font-semibold mb-1" style={{ color: 'rgba(255,255,255,0.9)' }}>
              {t('Delete')} {count} {count === 1 ? t('gallery') : t('galleries')}
            </div>
            <div className="text-[15px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
              {t('Choose how you want to remove the selected galleries.')}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <button onClick={onVault} disabled={busy}
              className="w-full py-3 px-4 rounded-[10px] text-left cursor-pointer disabled:opacity-40 transition-colors"
              style={{ background: 'rgba(127,119,221,0.12)', border: '1px solid rgba(127,119,221,0.3)' }}>
              <div className="text-[15px] font-medium" style={{ color: '#CECBF6' }}>
                {activeOp === 'vault' ? t('Removing…') : t('Remove from vault')}
              </div>
              <div className="text-[13px] mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{t('Files stay on disk — only removed from The Vault')}</div>
            </button>

            <button onClick={onDisk} disabled={busy}
              className="w-full py-3 px-4 rounded-[10px] text-left cursor-pointer disabled:opacity-40 transition-colors"
              style={{ background: 'rgba(212,83,126,0.12)', border: '1px solid rgba(212,83,126,0.3)' }}>
              <div className="text-[15px] font-medium" style={{ color: '#F4C0D1' }}>
                {activeOp === 'disk' ? t('Deleting…') : t('Delete from drive')}
              </div>
              <div className="text-[13px] mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{t('Permanently removes files from your disk — cannot be undone')}</div>
            </button>

            <button onClick={onCancel} disabled={busy}
              className="w-full py-2 rounded-[10px] text-[15px] cursor-pointer disabled:opacity-40 transition-colors hover:bg-[rgba(255,255,255,0.04)]"
              style={{ color: 'rgba(255,255,255,0.35)' }}>
              {t('Cancel')}
            </button>
          </div>
        </div>
      </motion.div>
    </>,
    document.body
  )
}


function BulkActionPanel({ selectedGalleries, onDone, onCancel }) {
  const t = useT()
  const [creatorId, setCreatorId]             = useState(null)
  const [removeCreatorId, setRemoveCreatorId] = useState(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteOp, setDeleteOp]               = useState(null) // null | 'vault' | 'disk'
  const [assigning, setAssigning]             = useState(false)
  const [removing, setRemoving]               = useState(false)
  const [zipping, setZipping]                 = useState(false)
  const [showMergeModal, setShowMergeModal]   = useState(false)
  const qc = useQueryClient()
  const addToMultiViewer = useVaultStore(s => s.addToMultiViewer)
  const MAX = useVaultStore(s => s.MULTIVIEWER_MAX)
  const queue = useVaultStore(s => s.multiViewerQueue)

  const selectedIds = selectedGalleries.map(g => g.id)

  const assignMutation = useMutation({
    mutationFn: () => galleriesApi.bulkAssign(selectedIds, creatorId),
    onSuccess: (r) => {
      toast.success(`Assigned creator to ${r.data.updated} galleries`)
      qc.invalidateQueries({ queryKey: ['galleries'] })
      onDone()
    },
    onError: () => toast.error(t('Assignment failed'))
  })

  const handleBulkRemove = async () => {
    if (!removeCreatorId) return
    setRemoving(true)
    let removed = 0
    let errs = 0
    for (const id of selectedIds) {
      try {
        await galleriesApi.removeCreator(id, removeCreatorId)
        removed++
      } catch {
        errs++
      }
    }
    setRemoving(false)
    if (removed > 0) toast.success(`Removed creator from ${removed} ${removed === 1 ? 'gallery' : 'galleries'}`)
    if (errs > 0) toast.error(`${errs} galleries couldn't be updated`)
    qc.invalidateQueries({ queryKey: ['galleries'] })
    onDone()
  }

  const handleSendToViewer = async () => {
    let added = 0
    let skipped = 0
    toast(t('Adding galleries...'), { icon: '⏳', id: 'bulk-add' })
    for (const g of selectedGalleries) {
      if (queue.length + added >= MAX) break
      try {
        const res = await galleriesApi.images(g.id)
        const ok = addToMultiViewer({ id: `gal-${g.id}`, type: 'gallery', media: g, images: res.data })
        if (ok) added++
        else skipped++
      } catch (e) {
        skipped++
      }
    }
    toast.dismiss('bulk-add')
    if (added > 0) toast.success(`Sent ${added} galleries to viewer`)
    if (skipped > 0) toast(t('Some were already queued or queue is full'), { icon: 'ℹ️' })
    onDone()
  }

  const handleVaultDelete = async () => {
    setDeleteOp('vault')
    let errs = 0
    for (const id of selectedIds) {
      try { await galleriesApi.delete(id, false) } catch { errs++ }
    }
    setDeleteOp(null)
    setShowDeleteModal(false)
    qc.invalidateQueries({ queryKey: ['galleries'] })
    if (errs > 0) toast.error(`Finished with ${errs} errors`)
    else toast.success(`Removed ${selectedIds.length} ${selectedIds.length === 1 ? 'gallery' : 'galleries'} from vault`)
    onDone()
  }

  const handleDiskDelete = async () => {
    setDeleteOp('disk')
    let deleted = 0
    let errs = 0
    const blocked = []

    for (const g of selectedGalleries) {
      try {
        await galleriesApi.delete(g.id, true)
        deleted++
      } catch (e) {
        const detail = e.response?.data?.detail
        if (detail?.code === 'has_children') {
          blocked.push({ gallery: g, children: detail.children })
        } else {
          errs++
        }
      }
    }

    setDeleteOp(null)
    setShowDeleteModal(false)
    qc.invalidateQueries({ queryKey: ['galleries'] })

    if (deleted > 0) toast.success(`Deleted ${deleted} ${deleted === 1 ? 'gallery' : 'galleries'} from disk`)
    blocked.forEach(({ gallery, children }) => {
      const names = children.slice(0, 3).map(c => `"${c.name}"`).join(', ')
      const more = children.length > 3 ? ` +${children.length - 3} more` : ''
      toast.error(`"${gallery.name}" has child galleries inside it (${names}${more}) — delete those first`, { duration: 8000 })
    })
    if (errs > 0) toast.error(`${errs} deletion(s) failed`)
    if (deleted > 0) onDone()
  }

  const handleExportZip = async () => {
    setZipping(true)
    try {
      const folderRes = await galleriesApi.pickFolder()
      const outputPath = folderRes.data.path
      const tid = toast.loading(`Zipping ${selectedGalleries.length} ${selectedGalleries.length === 1 ? 'gallery' : 'galleries'}…`)
      const res = await galleriesApi.exportZip(selectedIds, outputPath)
      toast.dismiss(tid)
      const d = res.data
      toast.success(`Zip created — ${d.file_count} file${d.file_count !== 1 ? 's' : ''} · ${d.zip_name}`)
    } catch (e) {
      if (e?.response?.status !== 400) toast.error(e?.response?.data?.detail || t('Export failed'))
    } finally {
      setZipping(false)
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-[10px] flex-wrap animate-slide-up"
         style={{ background: 'rgba(127,119,221,0.12)', border: '0.5px solid rgba(127,119,221,0.3)' }}>
      <span className="text-[13px] font-medium" style={{ color: '#CECBF6' }}>
        {selectedIds.length} {t('selected')}
      </span>

      {/* Action: Send to viewer */}
      <button type="button" onMouseDown={handleSendToViewer} disabled={assigning || zipping}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer transition-colors hover:bg-[rgba(127,119,221,0.2)] disabled:opacity-40"
              style={{ background: 'rgba(127,119,221,0.15)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.3)' }}>
        <LayoutTemplate size={12} /> {t('Send to viewer')}
      </button>

      {/* Action: Export as zip */}
      <button type="button" onMouseDown={handleExportZip} disabled={assigning || zipping}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer disabled:opacity-40"
              style={{ background: 'rgba(127,119,221,0.15)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.3)' }}>
        <Archive size={12} /> {zipping ? t('Zipping…') : t('Export as zip')}
      </button>

      {selectedIds.length >= 2 && (
        <>
          <div className="w-[1px] h-4 bg-[rgba(255,255,255,0.1)] mx-1" />
          <button type="button" onMouseDown={() => setShowMergeModal(true)} disabled={assigning || removing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer disabled:opacity-40"
                  style={{ background: 'rgba(127,119,221,0.15)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.35)' }}>
            <GitMerge size={12} /> {t('Merge')}
          </button>
        </>
      )}

      <div className="w-[1px] h-4 bg-[rgba(255,255,255,0.1)] mx-1" />

      {/* Action: Assign creator */}
      <span className="text-[rgba(255,255,255,0.3)] text-[13px]">{t('assign to')}</span>
      <div style={{ position: 'relative', zIndex: 80 }}>
        <CreatorDropdown value={creatorId} onChange={setCreatorId} placeholder={t('Pick creator...')} />
      </div>
      <button
        type="button"
        onMouseDown={() => { if (creatorId && !assignMutation.isPending && !assigning) assignMutation.mutate() }}
        disabled={!creatorId || assignMutation.isPending || assigning}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer disabled:opacity-40"
        style={{ background: 'rgba(127,119,221,0.3)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.5)' }}>
        <UserPlus size={12} /> {assignMutation.isPending ? t('Assigning...') : t('Assign')}
      </button>

      <div className="w-[1px] h-4 bg-[rgba(255,255,255,0.1)] mx-1" />

      {/* Action: Remove creator */}
      <span className="text-[rgba(255,255,255,0.3)] text-[13px]">{t('remove')}</span>
      <div style={{ position: 'relative', zIndex: 79 }}>
        <CreatorDropdown value={removeCreatorId} onChange={setRemoveCreatorId} placeholder={t('Pick creator...')} />
      </div>
      <button
        type="button"
        onMouseDown={() => { if (removeCreatorId && !removing && !assigning) handleBulkRemove() }}
        disabled={!removeCreatorId || removing || assigning}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer disabled:opacity-40"
        style={{ background: 'rgba(212,83,126,0.2)', color: '#F4C0D1', border: '0.5px solid rgba(212,83,126,0.35)' }}>
        <UserMinus size={12} /> {removing ? t('Removing...') : t('Remove')}
      </button>

      <div className="w-[1px] h-4 bg-[rgba(255,255,255,0.1)] mx-1" />

      {/* Action: Delete */}
      <button onMouseDown={() => setShowDeleteModal(true)} disabled={assigning || removing || deleteOp !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer disabled:opacity-40"
              style={{ background: 'rgba(212,83,126,0.15)', color: '#F4C0D1', border: '0.5px solid rgba(212,83,126,0.3)' }}>
        <Trash2 size={12} /> {t('Delete')}
      </button>

      <AnimatePresence>
        {showDeleteModal && (
          <DeleteModal
            count={selectedIds.length}
            activeOp={deleteOp}
            onVault={handleVaultDelete}
            onDisk={handleDiskDelete}
            onCancel={() => setShowDeleteModal(false)}
          />
        )}
      </AnimatePresence>

      <button type="button" onMouseDown={onCancel}
              className="text-[rgba(255,255,255,0.35)] hover:text-white cursor-pointer ml-auto">
        <X size={14} />
      </button>

      {showMergeModal && (
        <BulkMergeModal
          galleries={selectedGalleries}
          onClose={() => setShowMergeModal(false)}
          onMerged={() => { setShowMergeModal(false); onDone() }}
        />
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────


export default function GalleryList() {
  const t = useT()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // ── Persist filter state so back-navigation (and sidebar re-entry) restores it
  const _glRestoredRef = useRef(false)
  useEffect(() => {
    if (_glRestoredRef.current) return
    _glRestoredRef.current = true
    if (searchParams.toString() === '') {
      try {
        const saved = sessionStorage.getItem(GL_STATE_KEY)
        if (saved) setSearchParams(new URLSearchParams(saved), { replace: true })
      } catch {}
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try { sessionStorage.setItem(GL_STATE_KEY, searchParams.toString()) } catch {}
  }, [searchParams])

  // ── Derive all filter state from URL search params ──────────────────────────
  const search         = searchParams.get('q') || ''
  const sortBy         = searchParams.get('sort') || 'date_added'
  const sortDir        = searchParams.get('dir') || (sortBy === 'name' ? 'asc' : 'desc')
  const randomSeed     = parseFloat(searchParams.get('seed') || '0')
  const creatorFilter  = useMemo(() => {
    const raw = searchParams.get('creators') || searchParams.get('creator_id') || ''
    return raw ? raw.split(',').map(Number).filter(Boolean) : []
  }, [searchParams])
  const unassignedOnly = searchParams.get('unassigned') === '1'
  const favOnly        = searchParams.get('fav') === '1'
  const creatorType    = searchParams.get('ctype') || ''
  const franchise      = searchParams.get('franchise') || ''
  const period         = searchParams.get('period') || ''
  const activeTags     = useMemo(() => {
    const raw = searchParams.get('tags') || searchParams.get('tag') || ''
    return raw ? raw.split(',').filter(Boolean) : []
  }, [searchParams])
  const page           = parseInt(searchParams.get('page') || '1', 10) || 1

  // Page size: stored in localStorage (not URL) so it can't get stuck via sessionStorage restore
  const [pageSize, setPageSizeState] = useState(() => {
    try {
      const stored = localStorage.getItem('vault_gallery_page_size')
      const v = stored ? parseInt(stored, 10) : DEFAULT_PAGE_SIZE
      return PAGE_SIZES.includes(v) ? v : DEFAULT_PAGE_SIZE
    } catch { return DEFAULT_PAGE_SIZE }
  })

  // Persistent thumb size from store (not a filter, doesn't belong in URL)
  const thumbSize         = useVaultStore(s => s.thumbSizeGalleries)
  const setThumbSize      = useVaultStore(s => s.setThumbSizeGalleries)
  const addToMultiViewer  = useVaultStore(s => s.addToMultiViewer)
  const multiViewerQueue  = useVaultStore(s => s.multiViewerQueue)
  const MULTIVIEWER_MAX   = useVaultStore(s => s.MULTIVIEWER_MAX)

  // Transient UI state (not persisted in URL)
  const [bulkMode, setBulkMode]       = useState(false)
  const [selected, setSelected]       = useState(new Set())
  const [renamingGallery, setRenamingGallery]   = useState(null)
  const [renamingFolder, setRenamingFolder]     = useState(null)
  const [contextMenu, setContextMenu]           = useState(null) // { gallery, x, y }
  const [showCreate, setShowCreate]             = useState(false)
  const [ctxMergingGalleries, setCtxMergingGalleries]   = useState(null)
  const [ctxDeletingGalleries, setCtxDeletingGalleries] = useState(null) // array
  const [ctxDeleteOp, setCtxDeleteOp]                   = useState(null)

  const qc = useQueryClient()

  // Refs keep toggleSelect stable so GalleryCard memo never sees a stale closure
  const lastSelectedIdRef = useRef(null)
  const galleriesRef      = useRef(null)
  // Refs for bulk context menu — read inside stable callbacks without adding deps
  const bulkModeRef       = useRef(bulkMode)
  const selectedRef       = useRef(selected)
  useEffect(() => { bulkModeRef.current = bulkMode }, [bulkMode])
  useEffect(() => { selectedRef.current = selected }, [selected])

  // ── Helper: update a single URL param (merges with existing) ────────────────
  const setParam = useCallback((key, value) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (value === null || value === undefined || value === '' || value === false) {
        next.delete(key)
      } else {
        next.set(key, String(value))
      }
      return next
    }, { replace: true })
  }, [setSearchParams])

  const setParams = useCallback((updates) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined || value === '' || value === false) {
          next.delete(key)
        } else {
          next.set(key, String(value))
        }
      }
      return next
    }, { replace: true })
  }, [setSearchParams])

  // ── Setters that update URL params ──────────────────────────────────────────
  const setSearch = useCallback((v) => setParams({ q: v || null, page: null }), [setParams])
  const setPage = useCallback((v) => {
    const p = typeof v === 'function' ? v(page) : v
    setParam('page', p > 1 ? p : null)
  }, [setParam, page])
  const setPageSize = useCallback((v) => {
    setPageSizeState(v)
    try { localStorage.setItem('vault_gallery_page_size', String(v)) } catch {}
    setParam('page', null)
  }, [setParam])
  const setUnassignedOnly = useCallback((v) => setParams({ unassigned: v ? '1' : null, creators: null, page: null }), [setParams])
  const setFavOnly = useCallback((v) => setParams({ fav: v ? '1' : null, page: null }), [setParams])
  const setActiveTags = useCallback((updater) => {
    const newTags = typeof updater === 'function' ? updater(activeTags) : updater
    setParams({ tags: newTags.length > 0 ? newTags.join(',') : null, tag: null, page: null })
  }, [setParams, activeTags])
  const setCreatorFilter = useCallback((updater) => {
    const prev = creatorFilter
    const newVal = typeof updater === 'function' ? updater(prev) : updater
    const arr = Array.isArray(newVal) ? newVal : []
    setParams({ creators: arr.length > 0 ? arr.join(',') : null, creator_id: null, unassigned: null, page: null })
  }, [setParams, creatorFilter])
  const setCreatorType = useCallback((v) => setParams({ ctype: v || null, page: null }), [setParams])
  const setFranchise   = useCallback((v) => setParams({ franchise: v || null, page: null }), [setParams])
  const setPeriod      = useCallback((v) => setParams({ period: v || null, page: null }), [setParams])

  // ── Detect active filters & reset ───────────────────────────────────────────
  const hasActiveFilters = search || sortBy !== 'date_added' || creatorFilter.length > 0 || unassignedOnly || favOnly || activeTags.length > 0 || creatorType || franchise || period
  const resetFilters = useCallback(() => {
    setSearchParams({}, { replace: true })
  }, [setSearchParams])

  // Reset pagination when filters change
  const filterKey = `${search}|${sortBy}|${sortDir}|${creatorFilter.join(',')}|${unassignedOnly}|${favOnly}|${activeTags.join(',')}|${randomSeed}|${creatorType}|${franchise}|${period}`

  const params = {
    search: search || undefined,
    sort_by: sortBy,
    sort_dir: sortBy !== 'random' ? sortDir : undefined,
    creator_id: creatorFilter.length > 0 ? creatorFilter.join(',') : undefined,
    creator_type: creatorType || undefined,
    series: franchise || undefined,
    period: period || undefined,
    unassigned: unassignedOnly || undefined,
    favorite: favOnly || undefined,
    tags: activeTags.length > 0 ? activeTags.join(',') : undefined,
    limit: pageSize,
    skip: (page - 1) * pageSize,
  }

  const { data: galleryPage, isLoading, isFetching } = useQuery({
    queryKey: ['galleries', filterKey, page, pageSize],
    queryFn: () => galleriesApi.list(params).then(r => ({
      items: r.data,
      total: parseInt(r.headers['x-total-count'] ?? '0', 10),
    })),
    placeholderData: keepPreviousData,
  })
  const galleries   = galleryPage?.items
  const totalCount   = galleryPage?.total ?? 0
  const totalPages   = Math.max(1, Math.ceil(totalCount / pageSize))

  // If the current page no longer exists under this filter/page-size (e.g. a
  // filter just shrank the result set, or the user typed a stale page in the
  // URL), snap back to the real last page instead of showing a dead end.
  useEffect(() => {
    if (!isLoading && totalCount > 0 && page > totalPages) setPage(totalPages)
  }, [isLoading, totalCount, totalPages, page, setPage])

  // Scroll the page back to the top whenever the page number changes, so
  // browsing always resumes from the first card instead of wherever the
  // previous page happened to be scrolled to.
  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'auto' })
  }, [page])

  // Keep galleriesRef fresh so toggleSelect can read the current list without
  // being recreated on every fetch (which would bust GalleryCard memo)
  useEffect(() => { galleriesRef.current = galleries }, [galleries])

  // Period options reflect the CURRENT filter context (creator, type, franchise,
  // tags, etc.) — but never the selected period itself, so the dropdown always
  // shows every period available under the other filters.
  const periodParams = {
    search: search || undefined,
    creator_id: creatorFilter.length > 0 ? creatorFilter.join(',') : undefined,
    creator_type: creatorType || undefined,
    series: franchise || undefined,
    unassigned: unassignedOnly || undefined,
    favorite: favOnly || undefined,
    tags: activeTags.length > 0 ? activeTags.join(',') : undefined,
  }
  const periodKey = `${search}|${creatorFilter.join(',')}|${creatorType}|${franchise}|${unassignedOnly}|${favOnly}|${activeTags.join(',')}`
  const { data: periods = [] } = useQuery({
    queryKey: ['gallery-periods', periodKey],
    queryFn: () => galleriesApi.periods(periodParams).then(r => r.data),
  })

  // Auto-clear the selected period if the active filters no longer contain it
  // (e.g. switch to a creator that has no galleries in the chosen period).
  useEffect(() => {
    if (period && periods.length && !periods.some(p => p.value === period)) {
      setPeriod(null)
    }
  }, [period, periods, setPeriod])

  const handleSortChange = useCallback((val) => {
    if (val === 'random') {
      setParams({ sort: 'random', seed: String(Math.random()), dir: null, page: null })
    } else {
      setParams({ sort: val !== 'date_added' ? val : null, dir: val === 'name' ? 'asc' : 'desc', seed: null, page: null })
    }
  }, [setParams])

  const setSortDir = useCallback((dir) => setParam('dir', dir), [setParam])

  const handleCreatorFilterChange = useCallback((updater) => {
    setCreatorFilter(typeof updater === 'function' ? updater : () => updater)
  }, [setCreatorFilter])

  // Context menu — stable handler so GalleryCard memo never sees a new function ref
  // Windows behaviour: right-clicking a selected item operates on the whole selection
  const handleContextMenu = useCallback((gallery, e) => {
    const inSelection = bulkModeRef.current && selectedRef.current.has(gallery.id)
    const bulkGalleries = inSelection
      ? (galleriesRef.current ?? []).filter(g => selectedRef.current.has(g.id))
      : null
    setContextMenu({ gallery, x: e.clientX, y: e.clientY, bulkGalleries })
  }, [])

  const handleCtxSendToPanel = useCallback(async (galleries) => {
    const targets = Array.isArray(galleries) ? galleries : [galleries]
    const tid = toast.loading(targets.length > 1 ? `Adding ${targets.length} galleries…` : t('Adding to Multi-panel…'))
    let added = 0, skipped = 0
    for (const gallery of targets) {
      if (multiViewerQueue.length + added >= MULTIVIEWER_MAX) { skipped += targets.length - added; break }
      try {
        const res = await galleriesApi.images(gallery.id)
        const ok = addToMultiViewer({ id: `gal-${gallery.id}`, type: 'gallery', media: gallery, images: res.data })
        if (ok) added++
        else skipped++
      } catch { skipped++ }
    }
    toast.dismiss(tid)
    if (added > 0) toast.success(`${added} ${added === 1 ? 'gallery' : 'galleries'} added to Multi-panel`)
    if (skipped > 0) toast(`${skipped} already queued or queue full`, { icon: 'ℹ️' })
    if (added === 0 && skipped === 0) toast.error(t('Could not load gallery images'))
  }, [addToMultiViewer, multiViewerQueue, MULTIVIEWER_MAX])

  const favMutation = useMutation({
    mutationFn: (g) => galleriesApi.update(g.id, { is_favorite: !g.is_favorite }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['galleries'] }),
    onError: () => toast.error(t('Could not update favourite')),
  })

  const doCtxDelete = useCallback(async (galleries, mode) => {
    const targets = Array.isArray(galleries) ? galleries : [galleries]
    setCtxDeleteOp(mode)
    let errs = 0
    for (const g of targets) {
      try { await galleriesApi.delete(g.id, mode === 'disk') }
      catch { errs++ }
    }
    const n = targets.length - errs
    if (n > 0) toast.success(mode === 'disk'
      ? `${n} ${n === 1 ? 'gallery' : 'galleries'} deleted from disk`
      : `${n} ${n === 1 ? 'gallery' : 'galleries'} removed from vault`)
    if (errs > 0) toast.error(`${errs} deletion${errs > 1 ? 's' : ''} failed`)
    qc.invalidateQueries({ queryKey: ['galleries'] })
    setCtxDeletingGalleries(null)
    setCtxDeleteOp(null)
  }, [qc])

  // Stable reference — reads lastSelectedId and galleries through refs so the
  // GalleryCard memo comparator (which excludes onSelect) never sees a stale closure
  const toggleSelect = useCallback((id, event) => {
    setSelected(s => {
      const n = new Set(s)
      const currentGalleries = galleriesRef.current
      if (event && event.shiftKey && lastSelectedIdRef.current !== null && currentGalleries) {
        const ids = currentGalleries.map(g => g.id)
        const idxA = ids.indexOf(lastSelectedIdRef.current)
        const idxB = ids.indexOf(id)
        if (idxA !== -1 && idxB !== -1) {
          const start = Math.min(idxA, idxB)
          const end = Math.max(idxA, idxB)
          const shouldAdd = !s.has(id)
          for (let i = start; i <= end; i++) {
            if (shouldAdd) n.add(ids[i])
            else n.delete(ids[i])
          }
        }
      } else {
        if (n.has(id)) n.delete(id)
        else n.add(id)
      }
      return n
    })
    lastSelectedIdRef.current = id
  }, [])

  const selectAll = () => {
    setSelected(selected.size === galleries?.length ? new Set() : new Set(galleries?.map(g => g.id) ?? []))
  }
  const handleCtxExportZip = useCallback(async (galleries) => {
    const targets = Array.isArray(galleries) ? galleries : [galleries]
    try {
      const folderRes = await galleriesApi.pickFolder()
      const outputPath = folderRes.data.path
      const tid = toast.loading(t('Creating zip…'))
      const res = await galleriesApi.exportZip(targets.map(g => g.id), outputPath)
      toast.dismiss(tid)
      const d = res.data
      toast.success(`Zip created — ${d.file_count} file${d.file_count !== 1 ? 's' : ''} · ${d.zip_name}`)
    } catch (e) {
      if (e?.response?.status !== 400) toast.error(e?.response?.data?.detail || t('Export failed'))
    }
  }, [])

  const exitBulk = () => { setBulkMode(false); setSelected(new Set()); lastSelectedIdRef.current = null }

  return (
    <div className="p-5 flex flex-col gap-4 w-full">
      {/* Header + controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-[19px] font-medium text-[rgba(255,255,255,0.9)] mr-1">{t('Galleries')}</div>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full flex-1 min-w-[160px] max-w-xs"
             style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
          <Search size={13} className="text-[rgba(255,255,255,0.3)] flex-shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)}
                 placeholder={t('Search galleries...')}
                 className="bg-transparent border-none outline-none text-[14px] text-[rgba(255,255,255,0.8)] placeholder-[rgba(255,255,255,0.25)] w-full" />
          {search && (
            <button type="button" onMouseDown={() => setSearch('')} className="cursor-pointer text-[rgba(255,255,255,0.3)] hover:text-white">
              <X size={12} />
            </button>
          )}
        </div>

        <CreatorDropdown value={creatorFilter} onChange={handleCreatorFilterChange} placeholder={t('All creators')} />

        <CreatorTypeDropdown value={creatorType} onChange={setCreatorType} />

        <FranchiseFilter value={franchise} onChange={setFranchise} />

        <PeriodFilter value={period} periods={periods} onChange={setPeriod} />

        {/* Multi-tag filter with autocomplete */}
        <TagFilterInput
          activeTags={activeTags}
          onAdd={name => setActiveTags(prev => prev.includes(name) ? prev : [...prev, name])}
          onRemove={name => setActiveTags(prev => prev.filter(tg => tg !== name))}
          placeholder={t('Filter by tag…')}
          rounded="full"
        />

        <SortDropdown value={sortBy} onChange={handleSortChange} options={SORT_OPTIONS} sortDir={sortDir} onSortDirChange={setSortDir} />

        <button type="button" onMouseDown={() => setUnassignedOnly(!unassignedOnly)}
                className="flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-full cursor-pointer"
                style={{
                  background: unassignedOnly ? 'rgba(186,117,23,0.2)' : 'rgba(255,255,255,0.05)',
                  color: unassignedOnly ? '#FAC775' : 'rgba(255,255,255,0.45)',
                  border: `0.5px solid ${unassignedOnly ? 'rgba(186,117,23,0.4)' : 'rgba(255,255,255,0.08)'}`,
                }}>
          <AlertCircle size={11} /> {t('Unassigned')}
        </button>
        <button type="button" onMouseDown={() => setFavOnly(!favOnly)}
                className="flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-full cursor-pointer"
                style={{
                  background: favOnly ? 'rgba(186,117,23,0.2)' : 'rgba(255,255,255,0.05)',
                  color: favOnly ? '#FAC775' : 'rgba(255,255,255,0.45)',
                  border: `0.5px solid ${favOnly ? 'rgba(186,117,23,0.4)' : 'rgba(255,255,255,0.08)'}`,
                }}>
          <Star size={11} /> {t('Favorites')}
        </button>
        <button type="button" onMouseDown={() => setShowCreate(true)}
                className="flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-full cursor-pointer"
                style={{ background: 'rgba(127,119,221,0.15)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.3)' }}>
          <FolderPlus size={11} /> {t('New')}
        </button>
        {hasActiveFilters && (
          <button type="button" onMouseDown={resetFilters}
                  className="flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-full cursor-pointer transition-colors"
                  style={{ background: 'rgba(212,83,126,0.12)', color: '#F4C0D1', border: '0.5px solid rgba(212,83,126,0.3)' }}>
            <RotateCcw size={11} /> {t('Reset')}
          </button>
        )}
        <button type="button" onMouseDown={() => { setBulkMode(!bulkMode); setSelected(new Set()) }}
                className="flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-full cursor-pointer ml-auto"
                style={{
                  background: bulkMode ? 'rgba(127,119,221,0.2)' : 'rgba(255,255,255,0.05)',
                  color: bulkMode ? '#CECBF6' : 'rgba(255,255,255,0.45)',
                  border: `0.5px solid ${bulkMode ? 'rgba(127,119,221,0.4)' : 'rgba(255,255,255,0.08)'}`,
                }}>
          <CheckSquare size={11} /> {t('Select')}
        </button>
        <span className="text-[13px] text-[rgba(255,255,255,0.3)]">{galleries?.length ?? 0}</span>
      </div>

      {/* Size controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[rgba(255,255,255,0.3)]">{t('Size')}</span>
          <input type="range" min={80} max={400} step={10} value={thumbSize}
                 onChange={e => setThumbSize(Number(e.target.value))}
                 className="w-24 h-1 cursor-pointer accent-[#7F77DD]" />
          <span className="text-[12px] text-[rgba(255,255,255,0.3)] w-8">{thumbSize}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[12px] text-[rgba(255,255,255,0.3)] mr-1">{t('Per page')}</span>
          {PAGE_SIZES.map(n => (
            <button key={n} type="button" onMouseDown={() => setPageSize(n)}
                    className="text-[12px] px-2 py-0.5 rounded-full cursor-pointer"
                    style={{
                      background: pageSize === n ? 'rgba(127,119,221,0.2)' : 'rgba(255,255,255,0.04)',
                      color: pageSize === n ? '#CECBF6' : 'rgba(255,255,255,0.4)',
                      border: `0.5px solid ${pageSize === n ? 'rgba(127,119,221,0.35)' : 'rgba(255,255,255,0.07)'}`,
                    }}>
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk action bar */}
      {bulkMode && (
        <div className="flex items-center gap-3 flex-wrap relative" style={{ zIndex: 200 }}>
          <button type="button" onMouseDown={selectAll}
                  className="text-[13px] px-3 py-1.5 rounded-full cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
            {selected.size === galleries?.length ? t('Deselect all') : t('Select all')}
          </button>
          {selected.size > 0 && (
            <BulkActionPanel selectedGalleries={galleries.filter(g => selected.has(g.id))} onDone={exitBulk} onCancel={exitBulk} />
          )}
        </div>
      )}

      {/* Active filters summary */}
      {(creatorFilter.length > 0 || unassignedOnly || search) && (
        <div className="flex items-center gap-2 flex-wrap text-[13px]">
          <Filter size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
          {search && (
            <span className="px-2 py-0.5 rounded-full flex items-center gap-1"
                  style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' }}>
              "{search}" <button type="button" onMouseDown={() => setSearch('')} className="cursor-pointer ml-0.5"><X size={10} /></button>
            </span>
          )}
          {unassignedOnly && (
            <span className="px-2 py-0.5 rounded-full flex items-center gap-1"
                  style={{ background: 'rgba(186,117,23,0.15)', color: '#FAC775' }}>
              {t('Unassigned only')} <button type="button" onMouseDown={() => setUnassignedOnly(false)} className="cursor-pointer ml-0.5"><X size={10} /></button>
            </span>
          )}
          {creatorFilter.length > 0 && (
            <span className="px-2 py-0.5 rounded-full flex items-center gap-1"
                  style={{ background: 'rgba(127,119,221,0.15)', color: '#CECBF6' }}>
              {creatorFilter.length} creator{creatorFilter.length > 1 ? 's' : ''} {t('selected')} <button type="button" onMouseDown={() => setCreatorFilter([])} className="cursor-pointer ml-0.5"><X size={10} /></button>
            </span>
          )}
        </div>
      )}

      {/* Grid */}
      {isLoading && !galleries ? (
        // Skeleton grid while loading
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))` }}>
          {Array.from({ length: 16 }).map((_, i) => (
            <div key={i} className="rounded-[10px] overflow-hidden" style={{ border: '0.5px solid rgba(255,255,255,0.06)' }}>
              <div className="skeleton" style={{ height: thumbSize * 0.75, borderRadius: 0 }} />
              <div className="p-2 flex flex-col gap-1.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <div className="skeleton" style={{ height: 14, width: '75%' }} />
                <div className="skeleton" style={{ height: 11, width: '45%' }} />
              </div>
            </div>
          ))}
        </div>
      ) : !galleries || galleries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div style={{ fontSize: 52, opacity: 0.12 }}>🖼️</div>
          <div className="text-[18px] font-medium" style={{ color: 'rgba(255,255,255,0.25)' }}>{t('No galleries found')}</div>
          <div className="text-[15px]" style={{ color: 'rgba(255,255,255,0.15)' }}>
            {unassignedOnly ? t('All galleries have been assigned to a creator') : t('Try adjusting your filters or scan a folder')}
          </div>
        </div>
      ) : (
        <>
          {totalPages > 1 && (
            <div className="mb-3">
              <GalleryPagination page={page} totalPages={totalPages} onChange={setPage} t={t} id="top" />
            </div>
          )}
          <div className="text-[13px] text-[rgba(255,255,255,0.3)] mb-2">
            {`${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + (galleries?.length ?? 0)} shown of ${totalCount} · page ${page} of ${totalPages}`}
          </div>
          <div className="grid gap-3 grid-stagger" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))` }}>
            {galleries.map(g => (
              <GalleryCard
                key={g.id}
                gallery={g}
                selected={selected.has(g.id)}
                onSelect={toggleSelect}
                onClick={() => navigate(`/galleries/${g.id}`)}
                bulkMode={bulkMode}
                thumbSize={thumbSize}
                onRename={setRenamingGallery}
                onContextMenu={handleContextMenu}
              />
            ))}
          </div>
          {/* Pagination controls */}
          <div className="mt-6">
            <GalleryPagination page={page} totalPages={totalPages} onChange={setPage} t={t} id="bottom" />
          </div>
        </>
      )}

      {/* Modals */}
      {showCreate && <CreateGalleryModal onClose={() => setShowCreate(false)} />}
      {renamingGallery && <RenameModal gallery={renamingGallery} onClose={() => setRenamingGallery(null)} />}
      {renamingFolder  && <RenameFolderModal gallery={renamingFolder} onClose={() => setRenamingFolder(null)} />}
      {ctxMergingGalleries && (
        <BulkMergeModal
          galleries={ctxMergingGalleries}
          onClose={() => setCtxMergingGalleries(null)}
          onMerged={() => { setCtxMergingGalleries(null); qc.invalidateQueries({ queryKey: ['galleries'] }) }}
        />
      )}
      {ctxDeletingGalleries && (
        <DeleteModal
          count={ctxDeletingGalleries.length}
          activeOp={ctxDeleteOp}
          onVault={() => doCtxDelete(ctxDeletingGalleries, 'vault')}
          onDisk={()  => doCtxDelete(ctxDeletingGalleries, 'disk')}
          onCancel={() => { setCtxDeletingGalleries(null); setCtxDeleteOp(null) }}
        />
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <GalleryContextMenu
          gallery={contextMenu.gallery}
          bulkCount={contextMenu.bulkGalleries?.length ?? null}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onSelectMode={() => {
            setBulkMode(true)
            setSelected(new Set([contextMenu.gallery.id]))
          }}
          onOpen={() => navigate(`/galleries/${contextMenu.gallery.id}`)}
          onOpenSelect={() => navigate(`/galleries/${contextMenu.gallery.id}?select=true`)}
          onRename={() => { setRenamingGallery(contextMenu.gallery) }}
          onRenameFolder={() => { setRenamingFolder(contextMenu.gallery) }}
          onToggleFav={() => {
            const targets = contextMenu.bulkGalleries ?? [contextMenu.gallery]
            targets.forEach(g => favMutation.mutate(g))
          }}
          onMerge={() => setCtxMergingGalleries(contextMenu.bulkGalleries ?? [contextMenu.gallery])}
          onExportZip={() => handleCtxExportZip(contextMenu.bulkGalleries ?? [contextMenu.gallery])}
          onSendToPanel={() => handleCtxSendToPanel(contextMenu.bulkGalleries ?? [contextMenu.gallery])}
          onDelete={(mode) => {
            const targets = contextMenu.bulkGalleries ?? [contextMenu.gallery]
            if (mode === 'vault') doCtxDelete(targets, 'vault')
            else setCtxDeletingGalleries(targets)
          }}
        />
      )}
    </div>
  )
}

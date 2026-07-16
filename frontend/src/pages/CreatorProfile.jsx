import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Star, StarOff, Globe, Droplets, Images, Columns3, Shuffle,
  Upload, Camera, X, Image as ImageIcon, Play, Video, MoreHorizontal,
  Pencil, Trash2, Sparkles, FolderOpen,
  ExternalLink, Eye, LayoutTemplate, FolderMinus, UserCircle, Newspaper,
} from 'lucide-react'
import BondHearts from '../components/BondHearts'
import SlimContextMenu, { DIVIDER } from '../components/SlimContextMenu'
import AvatarFramePicker from '../components/AvatarFramePicker'
import HoverVideoPreview from '../components/HoverVideoPreview'
import { creatorsApi, galleriesApi, imagesApi, taggerApi, gamiApi, companionApi } from '../lib/api'
import { useVaultStore } from '../store/vault'
import toast from 'react-hot-toast'
import { FormDropdown } from '../components/FormDropdown'
import { COUNTRIES } from '../lib/countries'
import { useT } from '../i18n'

const COUNTRY_OPTIONS = [
  { value: '', label: 'Select Country' },
  ...COUNTRIES.map(c => ({ value: c, label: c }))
]

const GENDER_OPTIONS = [
  { value: '', label: 'Unknown' },
  { value: 'Female', label: 'Female' },
  { value: 'Male', label: 'Male' },
  { value: 'Other', label: 'Other' },
]

const YES_NO_OPTIONS = [
  { value: '', label: 'Not Set / Unknown' },
  { value: 'no', label: 'No' },
  { value: 'yes', label: 'Yes' },
]

const STATUS_OPTIONS = [
  { value: 'Active', label: 'Active' },
  { value: 'Hiatus', label: 'Hiatus' },
  { value: 'Retired', label: 'Retired' },
]

const TYPE_LABELS = {
  cosplayer: 'Cosplayer',
  ethot: 'Ethot',
  artist: 'Artist',
  character: 'Character',
  actress: 'Actress',
  custom: 'Model/Other'
}

function calculateAge(dobString) {
  if (!dobString) return null;
  const parts = dobString.split('-');
  if (parts.length < 2) return null;
  const birthYear = parseInt(parts[0], 10);
  const birthMonth = parseInt(parts[1], 10);
  const birthDay = parts.length > 2 ? parseInt(parts[2], 10) : 1;
  if (isNaN(birthYear) || isNaN(birthMonth)) return null;

  const today = new Date();
  let age = today.getFullYear() - birthYear;
  if (today.getMonth() + 1 < birthMonth || (today.getMonth() + 1 === birthMonth && today.getDate() < birthDay)) {
    age--;
  }
  return age;
}

const TYPE_COLORS = {
  cosplayer: { bg: 'rgba(29,158,117,0.15)',  text: '#9FE1CB' },
  ethot:     { bg: 'rgba(212,83,126,0.15)',  text: '#ED93B1' },
  artist:    { bg: 'rgba(127,119,221,0.15)', text: '#CECBF6' },
  character: { bg: 'rgba(186,117,23,0.15)',  text: '#FAC775' },
  actress:   { bg: 'rgba(212,83,126,0.15)',  text: '#ED93B1' },
  custom:    { bg: 'rgba(136,135,128,0.15)', text: '#D3D1C7' },
}

const RARITY_COLORS = {
  common:    '#888780',
  uncommon:  '#1D9E75',
  rare:      '#378ADD',
  epic:      '#7F77DD',
  legendary: '#BA7517',
}

const RARITY_LABELS = {
  common:    'Snapshot',
  uncommon:  'Album · 500+',
  rare:      'Big Portfolio · 2.5K+',
  epic:      'Library · 6K+',
  legendary: 'Grand Collection · 15K+',
}

const TYPES = ['cosplayer', 'ethot', 'artist', 'character', 'actress', 'custom']
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary']

function thumbSrc(path) {
  if (!path) return null
  const filename = path.replace(/\\/g, '/').split('/').pop()
  return `/thumbs/${filename}`
}

// ── 10-star rating ────────────────────────────────────────────────────────────
function RatingInput({ value, onChange }) {
  const [hover, setHover] = useState(0)
  const display = hover || value
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
        <span key={n} role="button" tabIndex={0}
                onClick={() => onChange(n)}
                onKeyDown={e => e.key === 'Enter' && onChange(n)}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                className="leading-none cursor-pointer select-none"
                style={{
                  fontSize: 32,
                  display: 'inline-block',
                  padding: '0 1px',
                  color: n <= display ? '#EF9F27' : 'rgba(255,255,255,0.12)',
                  textShadow: n === hover ? '0 0 10px var(--accent), 0 0 22px var(--accent)' : 'none',
                  transition: 'color 0.1s ease, text-shadow 0.1s ease',
                }}>★</span>
      ))}
      {value > 0 && (
        <span className="ml-2 text-[18px] font-semibold" style={{ color: '#EF9F27' }}>
          {Number(value) % 1 === 0 ? `${value}.0` : value}
        </span>
      )}
    </div>
  )
}

// ── Portrait gallery card (horizontal grid) ───────────────────────────────────
function PortraitGalleryCard({ gallery, onClick }) {
  const [failed, setFailed] = useState(false)
  const cover = !failed && gallery.cover_thumb ? thumbSrc(gallery.cover_thumb) : null
  return (
    <div onClick={onClick}
         className="rounded-[10px] overflow-hidden cursor-pointer group relative flex-shrink-0"
         style={{ width: 195, aspectRatio: '2/3', background: '#1a1a1a', border: '0.5px solid rgba(255,255,255,0.08)' }}>
      {cover
        ? <img src={cover} alt={gallery.name}
               className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
               onError={() => setFailed(true)} />
        : <div className="w-full h-full flex items-center justify-center opacity-15"><Images size={36} /></div>
      }
      <div className="absolute inset-x-0 bottom-0 p-3 pt-10"
           style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.88) 0%, transparent 100%)' }}>
        <div className="text-[15px] font-medium text-white truncate leading-tight">{gallery.name}</div>
        <div className="text-[13px] text-[rgba(255,255,255,0.45)] mt-0.5">{gallery.image_count} photos</div>
        {gallery.period_month && gallery.period_year && (
          <div className="text-[12px] mt-0.5 font-medium" style={{ color: '#9FE1CB' }}>
            {new Date(gallery.period_year, gallery.period_month - 1).toLocaleString('default', { month: 'short', year: 'numeric' })}
          </div>
        )}
      </div>
      {gallery.cum_count > 0 && (
        <div className="absolute top-2 right-2 flex items-center gap-0.5 text-[12px] px-2 py-0.5 rounded-full"
             style={{ background: 'rgba(0,0,0,0.75)', color: '#ED93B1' }}>
          <Droplets size={10} /> {gallery.cum_count}
        </div>
      )}
    </div>
  )
}

// ── Discovery row — auto-rotating random photos ───────────────────────────────
const DISCOVERY_CARD_W = 200
const DISCOVERY_GAP    = 10

function DiscoveryRow({ creatorId, onItemClick, onItemContextMenu }) {
  const t = useT()
  const containerRef = useRef(null)
  const poolRef      = useRef([])
  const [slots, setSlots] = useState([])
  const [cardW, setCardW] = useState(DISCOVERY_CARD_W)

  const { data: pool } = useQuery({
    queryKey: ['creator-discovery', creatorId],
    queryFn: () => imagesApi.list({
      creator_id: creatorId,
      is_video: false,
      sort_by: 'random',
      limit: 120,
    }).then(r => r.data),
    staleTime: 60000,
  })

  // Build slots directly from container width + pool — no intermediate count state
  const initSlots = useCallback(() => {
    if (!containerRef.current || !poolRef.current.length) return
    const w = containerRef.current.offsetWidth
    const n = Math.max(1, Math.floor((w + DISCOVERY_GAP) / (DISCOVERY_CARD_W + DISCOVERY_GAP)))
    // Stretch cards to fill the full container width — always >= DISCOVERY_CARD_W
    setCardW((w - (n - 1) * DISCOVERY_GAP) / n)
    setSlots(prev => {
      if (prev.length === n) return prev // no change needed
      return Array.from({ length: n }, (_, i) => ({
        img: poolRef.current[i % poolRef.current.length],
        key: i,
      }))
    })
  }, [])

  // Update pool ref + re-init slots when pool data arrives
  useEffect(() => {
    if (!pool || pool.length === 0) return
    poolRef.current = [...pool].sort(() => Math.random() - 0.5)
    initSlots()
  }, [pool, initSlots])

  // ResizeObserver re-inits when container width changes
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(initSlots)
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [initSlots])

  // Per-slot independent timers — staggered so they don't all flip at once
  useEffect(() => {
    if (slots.length === 0 || !poolRef.current.length) return
    const timers = slots.map((_, i) => {
      const interval = 3200 + i * 650 + Math.random() * 900
      return setInterval(() => {
        setSlots(prev => {
          if (!prev[i]) return prev
          const p = poolRef.current
          let candidate, tries = 0
          do {
            candidate = p[Math.floor(Math.random() * p.length)]
            tries++
          } while (candidate?.id === prev[i]?.img?.id && tries < 8)
          const next = [...prev]
          next[i] = { img: candidate, key: prev[i].key + 1 }
          return next
        })
      }, interval)
    })
    return () => timers.forEach(clearInterval)
  }, [slots.length])

  if (!pool || pool.length === 0) return null

  return (
    <div className="mb-2">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[16px] font-medium uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
          {t('Discovery')}
        </span>
      </div>
      <div ref={containerRef} className="flex overflow-hidden" style={{ gap: DISCOVERY_GAP }}>
        {slots.map((slot, i) => slot?.img && (
          <div
            key={i}
            onClick={() => onItemClick(slot.img)}
            onContextMenu={(e) => onItemContextMenu?.(e, slot.img)}
            className="cursor-pointer flex-shrink-0 rounded-[10px] overflow-hidden relative"
            style={{ width: cardW, aspectRatio: '2/3', background: '#1a1a1a', flexShrink: 0 }}
          >
            <AnimatePresence>
              <motion.img
                key={slot.key}
                src={`/api/images/${slot.img.id}/thumb`}
                alt=""
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.55 }}
                className="absolute inset-0 w-full h-full object-cover hover:scale-[1.04] transition-transform duration-300"
                style={{ display: 'block' }}
                onError={e => { e.currentTarget.style.display = 'none' }}
              />
            </AnimatePresence>
          </div>
        ))}
      </div>
      <div className="h-px mt-6" style={{ background: 'rgba(255,255,255,0.06)' }} />
    </div>
  )
}

// ── Horizontal gallery scroll section ────────────────────────────────────────
function GalleryScroll({ title, icon: Icon, galleries, onGalleryClick, onViewAll }) {
  const t = useT()
  if (!galleries || galleries.length === 0) return null
  return (
    <div className="vault-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] font-medium text-[rgba(255,255,255,0.5)] uppercase tracking-wider flex items-center gap-1.5">
          <Icon size={11} /> {title}
        </div>
        {onViewAll && (
          <button onClick={onViewAll} className="text-[11px] cursor-pointer" style={{ color: '#7F77DD' }}>
            {t('view all')}
          </button>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {galleries.map(g => (
          <PortraitGalleryCard key={g.id} gallery={g} onClick={() => onGalleryClick(g.id)} />
        ))}
      </div>
    </div>
  )
}

// ── Animation constants ───────────────────────────────────────────────────────
const slideVariants = {
  enter: (dir) => ({ x: dir > 0 ? '12%' : '-12%', opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit:  (dir) => ({ x: dir > 0 ? '-8%' : '8%',  opacity: 0 }),
}
const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
}
const staggerItem = {
  hidden:  { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.38, ease: [0.16, 1, 0.3, 1] } },
}

// ── Enhanced gallery card for the new grid ────────────────────────────────────
function GalleryCard({ gallery, onClick, onContextMenu }) {
  const [failed, setFailed] = useState(false)
  const cover = !failed && gallery.cover_thumb ? thumbSrc(gallery.cover_thumb) : null
  return (
    <motion.div
      variants={staggerItem}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="cursor-pointer group"
      style={{ borderRadius: 12, overflow: 'hidden', background: '#1a1a1a', border: '0.5px solid rgba(255,255,255,0.08)' }}
      whileHover={{ y: -5, boxShadow: '0 16px 48px rgba(0,0,0,0.7)', transition: { duration: 0.2 } }}
    >
      <div style={{ aspectRatio: '2/3', overflow: 'hidden', position: 'relative' }}>
        {cover
          ? <img src={cover} alt={gallery.name}
                 className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.07]"
                 onError={() => setFailed(true)} />
          : <div className="w-full h-full flex items-center justify-center" style={{ opacity: 0.1 }}><Images size={36} /></div>
        }
        <div className="absolute inset-x-0 bottom-0 p-3 pt-14 translate-y-1 group-hover:translate-y-0 transition-transform duration-300"
             style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, transparent 100%)' }}>
          <div className="text-[14px] font-semibold text-white truncate leading-snug">{gallery.name}</div>
          <div className="text-[12px] mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {gallery.image_count} {gallery.is_video ? 'videos' : 'photos'}
          </div>
        </div>
        {gallery.cum_count > 0 && (
          <div className="absolute top-2 right-2 flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded-full"
               style={{ background: 'rgba(0,0,0,0.72)', color: '#ED93B1', backdropFilter: 'blur(4px)' }}>
            <Droplets size={9} /> {gallery.cum_count}
          </div>
        )}
        {gallery.is_favorite && (
          <div className="absolute top-2 left-2"><Star size={13} fill="#FAC775" stroke="none" /></div>
        )}
      </div>
    </motion.div>
  )
}

// ── Square photo/video cell ────────────────────────────────────────────────────
function fmtDuration(s) {
  if (!s || !isFinite(s)) return null
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

function PhotoCell({ image, onClick, onContextMenu }) {
  const [hovered, setHovered] = useState(false)
  const dur = image.is_video ? fmtDuration(image.duration) : null
  return (
    <motion.div
      variants={staggerItem}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="cursor-pointer relative"
      style={{ aspectRatio: '1', borderRadius: 6, overflow: 'hidden', background: '#1a1a1a' }}
      whileHover={{ scale: 1.04, transition: { duration: 0.18 } }}
    >
      <img src={`/api/images/${image.id}/thumb`} alt=""
           className="w-full h-full object-cover" style={{ display: 'block' }}
           onError={e => { e.target.style.display = 'none' }} />

      {/* Videos: real playback preview on hover, persistent play badge + duration */}
      {image.is_video && <HoverVideoPreview imageId={image.id} hovered={hovered} />}
      {image.is_video && !hovered && (
        <>
          <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 1 }}>
            <div className="w-9 h-9 rounded-full flex items-center justify-center"
                 style={{ background: 'rgba(0,0,0,0.55)', border: '0.5px solid rgba(255,255,255,0.2)' }}>
              <Play size={13} fill="white" style={{ color: 'white', marginLeft: 1 }} />
            </div>
          </div>
          {dur && (
            <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[12px] font-mono font-semibold"
                 style={{ background: 'rgba(0,0,0,0.72)', color: 'rgba(255,255,255,0.85)', zIndex: 1 }}>
              {dur}
            </div>
          )}
        </>
      )}

      {/* Photos: dark info overlay on hover (videos show the live preview instead) */}
      {!image.is_video && (
        <motion.div
          animate={{ opacity: hovered ? 1 : 0 }}
          transition={{ duration: 0.15 }}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1"
          style={{ background: 'rgba(0,0,0,0.52)' }}
        >
          {image.cum_count > 0 && (
            <div className="flex items-center gap-1 text-[13px] font-semibold" style={{ color: '#ED93B1' }}>
              <Droplets size={12} /> {image.cum_count}
            </div>
          )}
          {image.is_favorite && <Star size={11} fill="#FAC775" stroke="none" />}
        </motion.div>
      )}
    </motion.div>
  )
}

// ── Loading skeletons ─────────────────────────────────────────────────────────
function SkeletonCard() {
  return <div className="rounded-[12px] animate-pulse" style={{ aspectRatio: '2/3', background: '#222' }} />
}
function SkeletonCell() {
  return <div className="rounded-[6px] animate-pulse" style={{ aspectRatio: '1', background: '#222' }} />
}

// ── Empty state with floating icon ────────────────────────────────────────────
function EmptyState({ icon, message }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col items-center justify-center py-20 gap-4"
    >
      <motion.div
        animate={{ y: [0, -7, 0] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
        style={{ color: 'rgba(255,255,255,0.12)' }}
      >
        {icon}
      </motion.div>
      <div className="text-[13px]" style={{ color: 'rgba(255,255,255,0.22)' }}>{message}</div>
    </motion.div>
  )
}

const SORT_OPTS = [
  { value: 'recently_added', label: 'Recently Added' },
  { value: 'most_viewed',    label: 'Most Viewed' },
  { value: 'random',         label: 'Random' },
]

function SortPills({ sort, onChange }) {
  const t = useT()
  return (
    <div className="flex items-center gap-1.5">
      {SORT_OPTS.map(s => (
        <button key={s.value} onClick={() => onChange(s.value)}
                className="text-[11px] px-2.5 py-1 rounded-full cursor-pointer transition-all"
                style={{
                  background: sort === s.value ? 'rgba(127,119,221,0.2)' : 'rgba(255,255,255,0.04)',
                  color: sort === s.value ? '#CECBF6' : 'rgba(255,255,255,0.3)',
                  border: `0.5px solid ${sort === s.value ? 'rgba(127,119,221,0.4)' : 'rgba(255,255,255,0.07)'}`,
                }}>
          {t(s.label)}
        </button>
      ))}
    </div>
  )
}

function applySort(items, sort, favKey = 'is_favorite') {
  const arr = [...items]
  if (sort === 'random') {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }
  if (sort === 'recently_added') return arr.sort((a, b) => b.id - a.id)
  // most_viewed — favorites first
  return arr.sort((a, b) => {
    const favA = a[favKey] ? 1 : 0
    const favB = b[favKey] ? 1 : 0
    if (favB !== favA) return favB - favA
    return (b.view_count ?? 0) - (a.view_count ?? 0)
  })
}

// ── Galleries tab ─────────────────────────────────────────────────────────────
const GALLERY_RENDER_CHUNK = 48

function GalleriesTab({ galleries, onGalleryClick, onViewAll, onGalleryContextMenu }) {
  const t = useT()
  const [sort, setSort] = useState('recently_added')
  const [sortKey, setSortKey] = useState(0)
  const [visibleCount, setVisibleCount] = useState(GALLERY_RENDER_CHUNK)
  const ioRef = useRef(null)

  const handleSort = (s) => { setSort(s); setSortKey(k => k + 1); setVisibleCount(GALLERY_RENDER_CHUNK) }

  // Reveal more cards as the sentinel scrolls into view (callback ref so it
  // re-attaches whenever the sentinel mounts/unmounts)
  const sentinelRef = useCallback(node => {
    ioRef.current?.disconnect()
    if (!node) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) setVisibleCount(c => c + GALLERY_RENDER_CHUNK)
    }, { rootMargin: '600px' })
    io.observe(node)
    ioRef.current = io
  }, [])
  useEffect(() => () => ioRef.current?.disconnect(), [])

  const sorted = useMemo(() => {
    if (!galleries) return []
    return applySort(galleries, sort)
  }, [galleries, sort, sortKey])

  const favorites = sorted.filter(g => g.is_favorite)

  if (!galleries) {
    return (
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    )
  }

  return (
    <div>
      {/* Sort + header row */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-[13px] font-medium" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {sorted.length} {sorted.length === 1 ? t('gallery') : t('galleries')}
        </span>
        <div className="flex items-center gap-3">
          <SortPills sort={sort} onChange={handleSort} />
          <button onClick={onViewAll} className="text-[12px] cursor-pointer" style={{ color: 'var(--accent)' }}>
            {t('View all →')}
          </button>
        </div>
      </div>

      {/* Favorites strip — only when sort is most_viewed */}
      {sort === 'most_viewed' && favorites.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }} className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <Star size={13} fill="#FAC775" stroke="none" />
            <span className="text-[13px] font-semibold" style={{ color: '#FAC775' }}>{t('Favorites')}</span>
            <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.3)' }}>· {favorites.length}</span>
          </div>
          <div className="flex gap-3 pb-2"
               style={{ overflowX: 'auto', scrollbarWidth: 'none', scrollSnapType: 'x mandatory' }}>
            {favorites.map(g => (
              <div key={g.id} style={{ scrollSnapAlign: 'start', flexShrink: 0, width: 280 }}>
                <GalleryCard gallery={g} onClick={() => onGalleryClick(g.id)}
                             onContextMenu={(e) => onGalleryContextMenu?.(e, g)} />
              </div>
            ))}
          </div>
          <div className="h-px my-6" style={{ background: 'rgba(255,255,255,0.07)' }} />
        </motion.div>
      )}

      {sorted.length === 0
        ? <EmptyState icon={<Images size={36} />} message={t('No galleries assigned yet')} />
        : (
          <>
            <motion.div
              key={sortKey}
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
              className="grid gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
            >
              {sorted.slice(0, visibleCount).map(g => (
                <GalleryCard key={g.id} gallery={g} onClick={() => onGalleryClick(g.id)}
                             onContextMenu={(e) => onGalleryContextMenu?.(e, g)} />
              ))}
            </motion.div>
            {visibleCount < sorted.length && (
              <div ref={sentinelRef} className="flex justify-center py-6 text-[13px]"
                   style={{ color: 'rgba(255,255,255,0.3)' }}>
                {t('Loading…')}
              </div>
            )}
          </>
        )
      }
    </div>
  )
}

// ── Photos / Videos tab ───────────────────────────────────────────────────────
const MEDIA_PAGE_SIZE = 48

const MEDIA_SORT_MAP = {
  most_viewed:    'view_count',
  recently_added: 'date_added',
  random:         'random',
}

function MediaTab({ creatorId, isVideo, onItemClick, emptyMessage, onItemContextMenu, onViewAll, total }) {
  const t = useT()
  const [items, setItems]   = useState([])
  const [page, setPage]     = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [sort, setSort]     = useState('recently_added')
  const ioRef = useRef(null)
  const stateRef = useRef({ hasMore: true, fetching: false })

  const handleSort = (s) => {
    if (s === sort) return
    setSort(s)
    setItems([])
    setPage(0)
    setHasMore(true)
  }

  const { data, isFetching } = useQuery({
    queryKey: ['creator-media', creatorId, isVideo, sort, page],
    queryFn: () => imagesApi.list({
      creator_id: creatorId,
      is_video: isVideo,
      sort_by: MEDIA_SORT_MAP[sort] ?? 'view_count',
      limit: MEDIA_PAGE_SIZE,
      skip: page * MEDIA_PAGE_SIZE,
    }).then(r => r.data),
  })

  useEffect(() => {
    if (!data) return
    setItems(prev => page === 0 ? data : [...prev, ...data])
    setHasMore(data.length === MEDIA_PAGE_SIZE)
  }, [data])

  // Keep a ref mirror so the IntersectionObserver callback never reads stale state
  stateRef.current = { hasMore, fetching: isFetching }

  // Auto-load the next page when the sentinel scrolls into view
  const sentinelRef = useCallback(node => {
    ioRef.current?.disconnect()
    if (!node) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && stateRef.current.hasMore && !stateRef.current.fetching) {
        setPage(p => p + 1)
      }
    }, { rootMargin: '600px' })
    io.observe(node)
    ioRef.current = io
  }, [])
  useEffect(() => () => ioRef.current?.disconnect(), [])

  const favorites = sort === 'most_viewed' ? items.filter(img => img.is_favorite) : []
  const isFirstLoad = isFetching && page === 0

  if (isFirstLoad) {
    return (
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {Array.from({ length: 12 }).map((_, i) => <SkeletonCell key={i} />)}
      </div>
    )
  }

  return (
    <div>
      {/* Sort header */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-[13px] font-medium" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {total ? `${items.length} / ${total}` : `${items.length} ${t('loaded')}`}
        </span>
        <div className="flex items-center gap-3">
          <SortPills sort={sort} onChange={handleSort} />
          {onViewAll && (
            <button onClick={onViewAll} className="text-[12px] cursor-pointer" style={{ color: 'var(--accent)' }}>
              {t('View all →')}
            </button>
          )}
        </div>
      </div>

      {favorites.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }} className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Star size={13} fill="#FAC775" stroke="none" />
            <span className="text-[13px] font-semibold" style={{ color: '#FAC775' }}>{t('Favorites')}</span>
            <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.3)' }}>· {favorites.length}</span>
          </div>
          <div className="flex gap-3 pb-2"
               style={{ overflowX: 'auto', scrollbarWidth: 'none', scrollSnapType: 'x mandatory' }}>
            {favorites.map(img => (
              <div key={img.id} style={{ scrollSnapAlign: 'start', flexShrink: 0, width: 220 }}>
                <PhotoCell image={img} onClick={() => onItemClick(img)}
                           onContextMenu={(e) => onItemContextMenu?.(e, img)} />
              </div>
            ))}
          </div>
          <div className="h-px my-5" style={{ background: 'rgba(255,255,255,0.07)' }} />
        </motion.div>
      )}

      {items.length === 0 && !isFetching
        ? <EmptyState icon={<ImageIcon size={40} />} message={t(emptyMessage)} />
        : (
          <>
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
              className="grid gap-2"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
            >
              {items.map(img => (
                <PhotoCell key={img.id} image={img} onClick={() => onItemClick(img)}
                           onContextMenu={(e) => onItemContextMenu?.(e, img)} />
              ))}
            </motion.div>

            {/* Infinite scroll sentinel + status */}
            <div ref={hasMore ? sentinelRef : null} className="flex flex-col items-center gap-2 mt-8 mb-4">
              <div className="text-[13px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                {total ? `${items.length} / ${total}` : items.length}{hasMore ? '' : t(' · all caught up')}
              </div>
              {hasMore && (
                <div className="text-[13px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  {isFetching ? t('Loading…') : ''}
                </div>
              )}
            </div>
          </>
        )
      }
    </div>
  )
}

// ── Avatar picker modal ────────────────────────────────────────────────────────
function AvatarModal({ creatorId, currentAvatarPath, onClose, onSuccess }) {
  const t = useT()
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)
  const qc = useQueryClient()
  const bumpAvatarBust = useVaultStore(s => s.bumpAvatarBust)

  const randomMutation = useMutation({
    mutationFn: () => creatorsApi.setAvatarRandom(creatorId, currentAvatarPath),
    onSuccess: () => {
      toast.success(t('Avatar updated!'))
      qc.invalidateQueries({ queryKey: ['creator', String(creatorId)] })
      qc.invalidateQueries({ queryKey: ['creators'] })
      bumpAvatarBust()
      onSuccess()
    },
    onError: (err) => toast.error(err?.response?.data?.detail || t('No images found — assign galleries to this creator first')),
  })

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await creatorsApi.uploadAvatar(creatorId, file)
      toast.success(t('Avatar uploaded!'))
      qc.invalidateQueries({ queryKey: ['creator', String(creatorId)] })
      qc.invalidateQueries({ queryKey: ['creators'] })
      bumpAvatarBust()
      onSuccess()
    } catch { toast.error(t('Upload failed')) }
    finally { setUploading(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center"
         style={{ background: 'rgba(0,0,0,0.75)' }}
         onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="rounded-[14px] w-80 overflow-hidden"
           style={{ background: '#1a1a1a', border: '0.5px solid rgba(255,255,255,0.12)' }}>
        <div className="flex items-center justify-between p-4 border-b border-[rgba(255,255,255,0.07)]">
          <div className="text-[14px] font-medium text-[rgba(255,255,255,0.9)]">{t('Set avatar')}</div>
          <button onClick={onClose} className="cursor-pointer text-[rgba(255,255,255,0.4)] hover:text-white"><X size={16} /></button>
        </div>
        <div className="p-5 flex flex-col items-center gap-4">
          <div className="text-[12px] text-[rgba(255,255,255,0.45)] text-center">
            {t('Upload an image from your PC to use as avatar')}
          </div>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full text-[12px] font-medium cursor-pointer"
                  style={{ background: 'rgba(127,119,221,0.2)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.35)' }}>
            <Upload size={14} /> {uploading ? t('Uploading...') : t('Pick from PC')}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
          <div className="text-[10px] text-[rgba(255,255,255,0.2)]">{t('— or —')}</div>
          <button onClick={() => randomMutation.mutate()} disabled={randomMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-full text-[11px] cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
            <Shuffle size={11} /> {randomMutation.isPending ? t('Setting...') : t('Random from gallery')}
          </button>
        </div>
      </div>
    </div>
  )
}

// BannerPickerModal removed — banner upload is now inline in the banner controls

// Safely extract a string from FastAPI error responses.
// detail can be a string (HTTPException) or array of objects (Pydantic validation).
function extractApiError(e, fallback = 'Something went wrong') {
  const detail = e?.response?.data?.detail
  if (!detail) return fallback
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map(d => d.msg || JSON.stringify(d)).join('; ')
  return fallback
}


function EditCreatorModal({ creator, onClose }) {
  const t = useT()
  let initialLinks = ''
  try {
    const pl = JSON.parse(creator.platform_links || '{}')
    initialLinks = Object.values(pl).join('\n')
  } catch {}

  const [form, setForm] = useState({
    name: creator.name || '', title: creator.title || '', real_name: creator.real_name || '',
    creator_type: creator.creator_type || 'cosplayer', gender: creator.gender || '',
    eye_color: creator.eye_color || '',
    fake_boobs: creator.fake_boobs === true ? 'yes' : creator.fake_boobs === false ? 'no' : '',
    fake_ass: creator.fake_ass === true ? 'yes' : creator.fake_ass === false ? 'no' : '',
    date_of_birth: creator.date_of_birth || '', height: creator.height || '', body_measurements: creator.body_measurements || '',
    country: creator.country || '', series: creator.series || '', origin: creator.origin || '',
    description: creator.description || '', wiki_url: creator.wiki_url || '', lore: creator.lore || '', card_rarity: creator.card_rarity || 'common',
    patreon_price: creator.patreon_price || '', platform_links: initialLinks,
    status: creator.status || 'Active',
    retirement_year: creator.retirement_year || ''
  })
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => {
      const payload = { ...form }
      payload.height = payload.height ? parseInt(payload.height, 10) || null : null
      payload.patreon_price = payload.patreon_price ? parseFloat(payload.patreon_price) || 0.0 : 0.0
      payload.fake_boobs = form.fake_boobs === 'yes' ? true : form.fake_boobs === 'no' ? false : null
      payload.fake_ass = form.fake_ass === 'yes' ? true : form.fake_ass === 'no' ? false : null
      payload.retirement_year = form.status === 'Retired' && form.retirement_year ? parseInt(form.retirement_year, 10) || null : null
      if (payload.platform_links) {
        const links = payload.platform_links.split(/[\n,]+/).map(l => l.trim()).filter(Boolean)
        const linksObj = {}
        links.forEach((l, i) => linksObj[`link_${i}`] = l)
        payload.platform_links = JSON.stringify(linksObj)
      } else {
        payload.platform_links = "{}"
      }
      return creatorsApi.update(creator.id, payload).then(r => r.data)
    },
    onSuccess: () => {
      toast.success(t('Creator updated'))
      qc.invalidateQueries({ queryKey: ['creator', String(creator.id)] })
      qc.invalidateQueries({ queryKey: ['creators'] })
      onClose()
    },
    onError: () => toast.error(t('Update failed'))
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in" style={{ background: 'rgba(0,0,0,0.8)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="rounded-[14px] p-6 w-[880px] max-h-[85vh] overflow-y-auto animate-modal-pop shadow-2xl" style={{ background: '#1a1a1a', border: '0.5px solid rgba(255,255,255,0.15)' }}>
        <div className="flex items-center justify-between mb-5">
          <div className="text-[22px] font-medium text-[rgba(255,255,255,0.9)] flex items-center gap-2">
            <Pencil size={20} style={{ color: '#7F77DD' }} /> {t('Edit creator')}
          </div>
          <button onClick={onClose} className="cursor-pointer text-[rgba(255,255,255,0.4)] hover:text-white"><X size={20} /></button>
        </div>

        <div className="mb-4">
          <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-2 uppercase tracking-wider font-semibold">{t('Category')}</div>
          <div className="flex flex-wrap gap-1.5">
            {TYPES.map(tg => (
              <button key={tg} onClick={() => set('creator_type', tg)}
                      className="text-[16px] px-3.5 py-2 rounded-full cursor-pointer capitalize transition-all"
                      style={{
                        background: form.creator_type === tg ? 'rgba(127,119,221,0.25)' : 'rgba(255,255,255,0.05)',
                        color: form.creator_type === tg ? '#CECBF6' : 'rgba(255,255,255,0.45)',
                        border: `0.5px solid ${form.creator_type === tg ? 'rgba(127,119,221,0.5)' : 'rgba(255,255,255,0.08)'}`,
                      }}>{t(TYPE_LABELS[tg] || tg)}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-4 mt-4">
          {/* Left Column */}
          <div className="flex flex-col gap-4">
            {[
              { label: 'Name *', key: 'name', placeholder: 'Name' },
              { label: 'Title', key: 'title', placeholder: 'Optional — shown after name' },
              { label: 'Real name', key: 'real_name', placeholder: 'Real name' },
            ].map(f => (
              <div key={f.key}>
                <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">{t(f.label)}</div>
                <input value={form[f.key]} onChange={e => set(f.key, e.target.value)}
                       placeholder={t(f.placeholder)}
                       className="w-full rounded-[8px] px-3.5 py-2.5 text-[18px] text-[rgba(255,255,255,0.85)] placeholder-[rgba(255,255,255,0.2)] outline-none"
                       style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }} />
              </div>
            ))}

            <div>
              <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">{t('Country')}</div>
              <FormDropdown value={form.country} onChange={v => set('country', v)} options={COUNTRY_OPTIONS} placeholder={t('Select Country')} isSearchable={true} />
            </div>

            <div>
              <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">{t('Gender')}</div>
              <FormDropdown value={form.gender} onChange={v => set('gender', v)} options={GENDER_OPTIONS} placeholder={t('Unknown')} />
            </div>

            {form.creator_type !== 'character' && (
              <div>
                <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">{t('Status')}</div>
                <FormDropdown value={form.status} onChange={v => set('status', v)} options={STATUS_OPTIONS} placeholder={t('Active')} />
              </div>
            )}

            {form.creator_type !== 'character' && form.status === 'Retired' && (
              <div>
                <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">{t('Retirement Year')}</div>
                <input value={form.retirement_year} onChange={e => set('retirement_year', e.target.value)}
                       placeholder={t('e.g. 2024')} type="number"
                       className="w-full rounded-[8px] px-3.5 py-2.5 text-[18px] text-[rgba(255,255,255,0.85)] placeholder-[rgba(255,255,255,0.2)] outline-none"
                       style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">{t('Fake Boobs')}</div>
                <FormDropdown value={form.fake_boobs} onChange={v => set('fake_boobs', v)} options={YES_NO_OPTIONS} placeholder={t('Not Set')} />
              </div>
              <div>
                <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">{t('Fake Ass')}</div>
                <FormDropdown value={form.fake_ass} onChange={v => set('fake_ass', v)} options={YES_NO_OPTIONS} placeholder={t('Not Set')} />
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="flex flex-col gap-4">
            <div>
              <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">
                {form.creator_type === 'character' ? t('Age') : t('Date of Birth')}
              </div>
              <input
                value={form.date_of_birth}
                onChange={e => set('date_of_birth', e.target.value)}
                placeholder={form.creator_type === 'character' ? '17' : t('YYYY-MM or YYYY-MM-DD')}
                className="w-full rounded-[8px] px-3.5 py-2.5 text-[18px] text-[rgba(255,255,255,0.85)] placeholder-[rgba(255,255,255,0.2)] outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }}
              />
            </div>

            {[
              { label: 'Height (cm)', key: 'height', placeholder: '165' },
              { label: 'Measurements', key: 'body_measurements', placeholder: '36-24-36' },
              { label: 'Eye Color', key: 'eye_color', placeholder: 'Blue' },
            ].map(f => (
              <div key={f.key}>
                <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">{t(f.label)}</div>
                <input value={form[f.key]} onChange={e => set(f.key, e.target.value)}
                       placeholder={t(f.placeholder)}
                       className="w-full rounded-[8px] px-3.5 py-2.5 text-[18px] text-[rgba(255,255,255,0.85)] placeholder-[rgba(255,255,255,0.2)] outline-none"
                       style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }} />
              </div>
            ))}

            {form.creator_type === 'character' && (
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Franchise', key: 'series', placeholder: 'Franchise' },
                  { label: 'Origin', key: 'origin', placeholder: 'Origin' },
                ].map(f => (
                  <div key={f.key}>
                    <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">{t(f.label)}</div>
                    <input value={form[f.key]} onChange={e => set(f.key, e.target.value)}
                           placeholder={t(f.placeholder)}
                           className="w-full rounded-[8px] px-3.5 py-2.5 text-[18px] text-[rgba(255,255,255,0.85)] placeholder-[rgba(255,255,255,0.2)] outline-none"
                           style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }} />
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {form.creator_type !== 'character' && (
                <div>
                  <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">{t('Monthly Price ($)')}</div>
                  <input value={form.patreon_price} onChange={e => set('patreon_price', e.target.value)}
                         placeholder="10.00" type="number" step="0.01" min="0"
                         className="w-full rounded-[8px] px-3.5 py-2.5 text-[18px] text-[rgba(255,255,255,0.85)] placeholder-[rgba(255,255,255,0.2)] outline-none"
                         style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }} />
                </div>
              )}
              <div className={form.creator_type !== 'character' ? '' : 'col-span-2'}>
                <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">{t('Wiki URL')}</div>
                <input value={form.wiki_url} onChange={e => set('wiki_url', e.target.value)}
                       placeholder="https://residentevil.fandom.com/wiki/Ada_Wong"
                       className="w-full rounded-[8px] px-3.5 py-2.5 text-[16px] text-[rgba(255,255,255,0.85)] placeholder-[rgba(255,255,255,0.2)] outline-none"
                       style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }} />
              </div>
              <div className="col-span-2">
                <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">{t('Lore')}</div>
                <textarea value={form.lore} onChange={e => set('lore', e.target.value)}
                          rows={4} placeholder={t('Character lore / bio — paste or import from wiki above')}
                          className="w-full rounded-[8px] px-3.5 py-2.5 text-[16px] text-[rgba(255,255,255,0.85)] placeholder-[rgba(255,255,255,0.2)] outline-none resize-none"
                          style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }} />
              </div>
            </div>
          </div>
        </div>

        {form.creator_type !== 'character' && (
          <div className="mt-4">
            <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">{t('Source URLs / Links (comma or newline separated)')}</div>
            <textarea value={form.platform_links} onChange={e => set('platform_links', e.target.value)}
                      placeholder="https://patreon.com/..., https://onlyfans.com/..." rows={2}
                      className="w-full rounded-[8px] px-3.5 py-2.5 text-[18px] text-[rgba(255,255,255,0.85)] placeholder-[rgba(255,255,255,0.2)] outline-none resize-none"
                      style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }} />
          </div>
        )}

        <div className="mt-4 mb-6">
          <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">{t('Description')}</div>
          <textarea value={form.description} onChange={e => set('description', e.target.value)}
                    placeholder={t('Description...')} rows={3}
                    className="w-full rounded-[8px] px-3.5 py-2.5 text-[18px] text-[rgba(255,255,255,0.85)] placeholder-[rgba(255,255,255,0.2)] outline-none resize-none"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }} />
        </div>

        <div className="flex gap-4">
          <button onClick={onClose}
                  className="flex-1 py-3 rounded-[8px] text-[16px] cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: '0.5px solid rgba(255,255,255,0.08)' }}>{t('Cancel')}</button>
          <button onClick={() => mutation.mutate()}
                  disabled={!form.name.trim() || mutation.isPending}
                  className="flex-1 py-3 rounded-[8px] text-[16px] font-medium cursor-pointer transition-all"
                  style={{ background: 'rgba(127,119,221,0.3)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.5)' }}>
            {mutation.isPending ? t('Saving...') : t('Save changes')}
          </button>
        </div>
      </div>
    </div>
  )
}
// ── Main profile page ─────────────────────────────────────────────────────────
export default function CreatorProfile() {
  const t = useT()
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const pageRef = useRef(null)

  const bumpAvatarBust = useVaultStore(s => s.bumpAvatarBust)
  const avatarBust = useVaultStore(s => s.avatarBust)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [rating, setRating] = useState(null)
  const [showAvatarModal, setShowAvatarModal] = useState(false)
  const [showAvatarZoom, setShowAvatarZoom]   = useState(false)
  const [avatarDragOver, setAvatarDragOver]   = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [aiTagging, setAiTagging]             = useState(false)  // quick-tag this creator
  const [showEditModal, setShowEditModal]     = useState(false)
  const [confirmDelete, setConfirmDelete]     = useState(false)
  const [valueRevealed, setValueRevealed] = useState(false)
  const [bannerImageId, setBannerImageId] = useState(null)
  const [bannerLocalUrl, setBannerLocalUrl] = useState(null)
  const [bannerY, setBannerY] = useState(20)
  const [bannerZoom, setBannerZoom] = useState(1)
  const [bannerMenuOpen, setBannerMenuOpen] = useState(false)
  const [scrollY, setScrollY] = useState(0)
  const [folderInput, setFolderInput] = useState('')
  const [ctxMenu, setCtxMenu] = useState(null)              // { type: 'gallery'|'media', item, x, y }
  const [framePicker, setFramePicker] = useState(null)      // { image, creatorId, mode: 'avatar'|'banner' }
  const [activeTab, setActiveTab] = useState('galleries')
  const [tabDirection, setTabDirection] = useState(1)
  const contentRef = useRef(null)
  const bannerFileRef = useRef(null)
  const bannerMenuRef = useRef(null)
  const bannerSaveTimer = useRef(null)

  // Find and attach to scrollable parent for parallax
  useEffect(() => {
    const el = pageRef.current
    if (!el) return
    let scrollEl = null
    let node = el.parentElement
    while (node && node !== document.body) {
      const s = window.getComputedStyle(node)
      if (s.overflowY === 'auto' || s.overflowY === 'scroll') { scrollEl = node; break }
      node = node.parentElement
    }
    const target = scrollEl || window
    const onScroll = () => setScrollY(scrollEl ? scrollEl.scrollTop : window.scrollY)
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => target.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const h = (e) => { if (bannerMenuRef.current && !bannerMenuRef.current.contains(e.target)) setBannerMenuOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const { data: creator, isError: creatorError } = useQuery({
    queryKey: ['creator', id],
    queryFn: () => creatorsApi.get(id).then(r => r.data),
  })

  useEffect(() => {
    if (creator && rating === null) setRating(creator.rating || 0)
  }, [creator])

  // Initialize banner from saved creator data (runs once when creator loads)
  useEffect(() => {
    if (!creator) return
    if (creator.banner_image_id) setBannerImageId(creator.banner_image_id)
    if (creator.banner_y != null) setBannerY(creator.banner_y)
    if (creator.banner_zoom != null) setBannerZoom(creator.banner_zoom)
    setFolderInput(creator.source_folder || '')
  }, [creator?.id])  // only on creator ID change, not every field update

  // Save banner settings to DB (debounced 600ms after last change)
  const saveBanner = useCallback((imageId, y, zoom) => {
    clearTimeout(bannerSaveTimer.current)
    bannerSaveTimer.current = setTimeout(() => {
      creatorsApi.update(id, { banner_image_id: imageId, banner_y: y, banner_zoom: zoom })
        .catch(() => {})
    }, 600)
  }, [id])

  const { data: allGalleries } = useQuery({
    queryKey: ['creator-galleries', id],
    queryFn: () => galleriesApi.list({ creator_id: id, sort_by: 'view_count', limit: 5000 }).then(r => r.data),
  })

  const { data: topImages } = useQuery({
    queryKey: ['creator-top', id],
    queryFn: () => creatorsApi.topImages(id, 3).then(r => r.data),
  })


  // Auto-set banner to first top image ONLY if creator has no saved banner
  // (neither a chosen image nor an uploaded/extracted banner_path file)
  useEffect(() => {
    if (!creator) return   // wait for creator — otherwise we can't know if a banner is saved
    if (topImages && topImages.length > 0 && bannerImageId === null
        && !creator.banner_image_id && !creator.banner_path) {
      setBannerImageId(topImages[0].id)
    }
  }, [topImages, creator])

  const randomizeBanner = useCallback(async () => {
    try {
      const res = await creatorsApi.setBannerRandom(id, bannerImageId)
      const newId = res.data.banner_image_id
      // Force a re-render even if the same ID came back (shouldn't happen with exclude,
      // but clears the old state first so the image always visibly reloads)
      setBannerImageId(null)
      setBannerLocalUrl(null)
      setTimeout(() => {
        setBannerImageId(newId)
        saveBanner(newId, bannerY, bannerZoom)
      }, 0)
    } catch {
      toast.error(t('No images found — assign galleries to this creator first'))
    }
  }, [id, bannerImageId, bannerY, bannerZoom, saveBanner])

  const handleBannerFileUpload = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const localUrl = URL.createObjectURL(file)
    if (bannerLocalUrl) URL.revokeObjectURL(bannerLocalUrl)
    setBannerLocalUrl(localUrl)
    setBannerY(50)
    try {
      await creatorsApi.uploadBanner(id, file)
      qc.invalidateQueries({ queryKey: ['creator', id] })
    } catch {
      toast.error(t('Banner upload failed'))
    }
  }, [id, bannerLocalUrl, qc])

  const handleAvatarDrop = useCallback(async (e) => {
    e.preventDefault()
    setAvatarDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    setAvatarUploading(true)
    try {
      await creatorsApi.uploadAvatar(id, file)
      toast.success(t('Avatar updated!'))
      qc.invalidateQueries({ queryKey: ['creator', String(id)] })
      qc.invalidateQueries({ queryKey: ['creators'] })
      bumpAvatarBust()
      setAvatarFailed(false)
    } catch { toast.error(t('Upload failed')) }
    finally { setAvatarUploading(false) }
  }, [id, qc, bumpAvatarBust, t])

  const favMutation = useMutation({
    mutationFn: () => creatorsApi.update(id, { is_favorite: !creator?.is_favorite }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['creator', id] }); qc.invalidateQueries({ queryKey: ['favorites'] }) }
  })
  const { data: profileData } = useQuery({
    queryKey: ['profile'],
    queryFn: () => gamiApi.profile().then(r => r.data),
    staleTime: 30000,
  })
  const heartsAvailable = profileData?.hearts ?? 0

  const giftMutation = useMutation({
    mutationFn: () => creatorsApi.giftHeart(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['creator', id] })
      qc.invalidateQueries({ queryKey: ['creators'] })
      qc.invalidateQueries({ queryKey: ['profile'] })
      toast.success(t('❤️ Heart gifted!'))
    },
    onError: (e) => toast.error(e?.response?.data?.detail || t('No hearts available')),
  })
  const ratingMutation = useMutation({
    mutationFn: (r) => creatorsApi.update(id, { rating: r }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['creator', id] })
  })

  // ── Right-click context menu handlers ────────────────────────────────
  const addToMultiViewer  = useVaultStore(s => s.addToMultiViewer)
  const multiViewerQueue  = useVaultStore(s => s.multiViewerQueue)
  const MULTIVIEWER_MAX   = useVaultStore(s => s.MULTIVIEWER_MAX)

  const openGalleryCtx = useCallback((e, gallery) => {
    e.preventDefault()
    setCtxMenu({ type: 'gallery', item: gallery, x: e.clientX, y: e.clientY })
  }, [])
  const openMediaCtx = useCallback((e, image) => {
    e.preventDefault()
    setCtxMenu({ type: 'media', item: image, x: e.clientX, y: e.clientY })
  }, [])

  const invalidateContent = () => {
    qc.invalidateQueries({ queryKey: ['creator', id] })
    qc.invalidateQueries({ queryKey: ['creator-galleries', id] })
    qc.invalidateQueries({ queryKey: ['creator-media'] })
    qc.invalidateQueries({ queryKey: ['creator-discovery', id] })
  }

  const ctxGalleryFav = (g) => {
    galleriesApi.update(g.id, { is_favorite: !g.is_favorite })
      .then(() => qc.invalidateQueries({ queryKey: ['creator-galleries', id] }))
      .catch(() => toast.error(t('Could not update favourite')))
  }
  const ctxGallerySendToPanel = async (g) => {
    if (multiViewerQueue.length >= MULTIVIEWER_MAX) { toast(t('Multi-panel queue is full'), { icon: 'ℹ️' }); return }
    try {
      const res = await galleriesApi.images(g.id)
      const ok = addToMultiViewer({ id: `gal-${g.id}`, type: 'gallery', media: g, images: res.data })
      ok ? toast.success(t('Added to Multi-panel')) : toast(t('Already queued'), { icon: 'ℹ️' })
    } catch { toast.error(t('Could not load gallery images')) }
  }
  const ctxGalleryDelete = async (g, mode) => {
    try {
      await galleriesApi.delete(g.id, mode === 'disk')
      toast.success(mode === 'disk' ? t('Gallery deleted from disk') : t('Gallery removed from vault'))
      invalidateContent()
    } catch { toast.error(t('Deletion failed')) }
  }
  const ctxMediaSendToPanel = (img) => {
    const ok = addToMultiViewer({ id: `img-${img.id}`, type: 'image', media: img })
    ok ? toast.success(t('Sent to Multi-panel')) : toast(t('Already queued or queue full'), { icon: 'ℹ️' })
  }
  const ctxSetAvatar = (img, creatorId = parseInt(id)) => {
    if (img.is_video) { setFramePicker({ image: img, creatorId, mode: 'avatar' }); return }
    creatorsApi.setAvatarFromImage(creatorId, img.id)
      .then(() => {
        toast.success(t('Avatar updated!'))
        qc.invalidateQueries({ queryKey: ['creator', String(creatorId)] })
        qc.invalidateQueries({ queryKey: ['creators'] })
        bumpAvatarBust()
        if (creatorId === parseInt(id)) setAvatarFailed(false)
      })
      .catch(() => toast.error(t('Failed to set avatar')))
  }
  const ctxSetBanner = (img, creatorId = parseInt(id)) => {
    if (img.is_video) { setFramePicker({ image: img, creatorId, mode: 'banner' }); return }
    creatorsApi.setBannerFromImage(creatorId, img.id)
      .then(() => {
        toast.success(t('Banner updated!'))
        if (creatorId === parseInt(id)) {
          setBannerLocalUrl(null)
          setBannerImageId(img.id)
        }
        qc.invalidateQueries({ queryKey: ['creator', String(creatorId)] })
      })
      .catch(() => toast.error(t('Failed to set banner')))
  }
  const ctxMediaDelete = async (img, mode) => {
    try {
      await imagesApi.delete(img.id, mode === 'vault')
      toast.success(mode === 'vault' ? t('Removed from vault') : t('Deleted from disk'))
      invalidateContent()
    } catch { toast.error(t('Deletion failed')) }
  }

  const ctxItems = ctxMenu?.type === 'gallery'
    ? [
        { icon: ExternalLink,   label: t('Open'),                 action: () => navigate(`/galleries/${ctxMenu.item.id}`) },
        { icon: ctxMenu.item.is_favorite ? StarOff : Star,
          label: ctxMenu.item.is_favorite ? t('Unfavorite') : t('Favorite'),
          action: () => ctxGalleryFav(ctxMenu.item),
          style: ctxMenu.item.is_favorite ? 'normal' : 'amber' },
        { icon: LayoutTemplate, label: t('Send to Multi-panel'),  action: () => ctxGallerySendToPanel(ctxMenu.item), style: 'accent' },
        DIVIDER,
        { icon: FolderMinus,    label: t('Remove from vault'),    action: () => ctxGalleryDelete(ctxMenu.item, 'vault') },
        { icon: Trash2,         label: t('Delete from disk'),     action: () => ctxGalleryDelete(ctxMenu.item, 'disk'), style: 'danger' },
      ]
    : ctxMenu?.type === 'media'
    ? (() => {
        const img = ctxMenu.item
        // When the file belongs to several creators, expand into a picker submenu
        const imgCreators = (img.creators?.length ? img.creators : [{ id: parseInt(id), name: creator?.name }])
        const multi = imgCreators.length > 1
        const avatarLabel = img.is_video ? t('Set avatar from video…') : t('Set as avatar')
        const bannerLabel = img.is_video ? t('Set banner from video…') : t('Set as banner')
        return [
          { icon: Eye,            label: t('View'),                 action: () => img.gallery_id && navigate(`/galleries/${img.gallery_id}?openImage=${img.id}`) },
          { icon: LayoutTemplate, label: t('Send to Multi-panel'),  action: () => ctxMediaSendToPanel(img), style: 'accent' },
          DIVIDER,
          multi
            ? { icon: UserCircle, label: avatarLabel, children: imgCreators.map(c => ({ label: c.name, action: () => ctxSetAvatar(img, c.id) })) }
            : { icon: UserCircle, label: avatarLabel, action: () => ctxSetAvatar(img, imgCreators[0].id), style: 'accent' },
          multi
            ? { icon: ImageIcon,  label: bannerLabel, children: imgCreators.map(c => ({ label: c.name, action: () => ctxSetBanner(img, c.id) })) }
            : { icon: ImageIcon,  label: bannerLabel, action: () => ctxSetBanner(img, imgCreators[0].id), style: 'accent' },
          DIVIDER,
          { icon: FolderMinus,    label: t('Remove from vault'),    action: () => ctxMediaDelete(img, 'vault') },
          { icon: Trash2,         label: t('Delete from disk'),     action: () => ctxMediaDelete(img, 'disk'), style: 'danger' },
        ]
      })()
    : null

  const TAB_ORDER = ['galleries', 'photos', 'videos']
  const changeTab = (newTab) => {
    const oldIdx = TAB_ORDER.indexOf(activeTab)
    const newIdx = TAB_ORDER.indexOf(newTab)
    setTabDirection(newIdx > oldIdx ? 1 : -1)
    setActiveTab(newTab)
    setTimeout(() => contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 30)
  }

  const talkToCreator = async () => {
    try {
      await companionApi.updateConfig({ active_persona_id: creator.id, enabled: true })
      navigate('/erika')
    } catch {
      toast.error(t('Could not open chat'))
    }
  }
  const deleteMutation = useMutation({
    mutationFn: () => creatorsApi.delete(id),
    onSuccess: () => {
      toast.success(`${creator.name} deleted`)
      qc.invalidateQueries({ queryKey: ['creators'] })
      navigate('/creators')
    },
    onError: () => toast.error(t('Failed to delete creator'))
  })
  const folderMutation = useMutation({
    mutationFn: (path) => creatorsApi.assignFolder(id, path || null).then(r => r.data),
    onSuccess: (data, variables) => {
      if (variables) {
        toast.success(`${data.assigned_count} ${data.assigned_count === 1 ? 'gallery' : 'galleries'} assigned to ${creator?.name}`)
      } else {
        toast.success(t('Folder cleared'))
      }
      qc.invalidateQueries({ queryKey: ['creator', id] })
      qc.invalidateQueries({ queryKey: ['creator-galleries', id] })
    },
    onError: () => toast.error(t('Failed to set source folder'))
  })

  if (creatorError) return (
    <div className="p-8 flex flex-col gap-3">
      <div className="text-[rgba(255,255,255,0.5)]">{t('Failed to load creator.')}</div>
      <button onClick={() => navigate('/creators')} className="text-[rgba(255,255,255,0.4)] text-sm underline cursor-pointer w-fit">{t('← Back to Creators')}</button>
    </div>
  )
  if (!creator) return <div className="p-8 text-[rgba(255,255,255,0.3)]">{t('Loading...')}</div>

  const tc = TYPE_COLORS[creator.creator_type] || TYPE_COLORS.custom
  const rc = RARITY_COLORS[creator.card_rarity] || RARITY_COLORS.common
  const initials = creator.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  // Parallax banner: 35% at top → 15% min (stays fixed there)
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const MAX_BANNER = Math.round(vh * 0.42)
  const MIN_BANNER = Math.round(vh * 0.22)
  const bannerHeight = Math.max(MIN_BANNER, MAX_BANNER - scrollY * 0.8)
  const bannerSrc = bannerLocalUrl
    || (bannerImageId ? `/api/images/${bannerImageId}/file` : null)
    || (creator.banner_path ? `/api/creators/${id}/banner?v=${new Date(creator.updated_at || 0).getTime()}_${avatarBust}` : null)

  const handleRating = (r) => { setRating(r); ratingMutation.mutate(r) }
  const isCharacter = creator.creator_type === 'character'
  const age = calculateAge(creator.date_of_birth)
  const dobDisplay = creator.date_of_birth
    ? isCharacter
      ? creator.date_of_birth  // plain age number for characters
      : `${creator.date_of_birth}${age ? ` (Age ${age})` : ''}`
    : null

  return (
    <div ref={pageRef} className="flex flex-col">

      {/* ── Banner + hero combined — image bleeds through both ───────────── */}
      <div className="relative overflow-hidden flex-shrink-0" style={{ background: tc.bg }}>

        {/* Parallax image — fills entire section (banner nav + hero) */}
        {bannerSrc && (
          <img
            src={bannerSrc} alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={{
              transform: `translateY(${scrollY * 0.25}px) scale(${(1.15 * bannerZoom).toFixed(3)})`,
              transformOrigin: 'center top',
              objectPosition: `center ${bannerY}%`,
              willChange: 'transform',
            }}
            onError={e => { e.target.style.display = 'none' }}
          />
        )}

        {/* Gradient — photo stays vivid at top, fades to near-dark at bottom */}
        <div className="absolute inset-0 pointer-events-none"
             style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.18) 40%, rgba(14,14,14,0.7) 72%, rgba(14,14,14,0.96) 100%)' }} />

        {/* Hard fade to page background at the very bottom */}
        <div className="absolute bottom-0 left-0 right-0 pointer-events-none"
             style={{ height: 64, background: 'linear-gradient(to bottom, transparent, #0e0e0e)', zIndex: 1 }} />

        {/* Rarity accent line */}
        <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: rc, zIndex: 2 }} />

        {/* Banner nav area — takes up bannerHeight, nav controls pinned to top */}
        <div className="relative flex-shrink-0 transition-[height] duration-100" style={{ height: bannerHeight }}>
          <div className="absolute top-3 left-4 right-4 flex items-center justify-between z-10">
            <button onClick={() => navigate('/creators')}
                    className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-[7px] cursor-pointer"
                    style={{ color: 'rgba(255,255,255,0.8)', background: 'rgba(0,0,0,0.45)', border: '0.5px solid rgba(255,255,255,0.18)' }}>
              <ArrowLeft size={13} /> {t('Creators')}
            </button>
            <div className="flex items-center gap-2">
              <button onClick={() => setConfirmDelete(true)}
                      className="w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition-colors"
                      style={{ color: 'rgba(255,255,255,0.7)', background: 'rgba(0,0,0,0.5)', border: '0.5px solid rgba(255,255,255,0.2)' }}
                      title={t('Delete creator')}>
                <Trash2 size={14} />
              </button>
            <div ref={bannerMenuRef} className="relative">
              <button onClick={() => setBannerMenuOpen(o => !o)}
                      className="w-8 h-8 rounded-full flex items-center justify-center cursor-pointer"
                      style={{ color: 'rgba(255,255,255,0.8)', background: 'rgba(0,0,0,0.5)', border: '0.5px solid rgba(255,255,255,0.2)' }}>
                <MoreHorizontal size={15} />
              </button>
              {bannerMenuOpen && (
                <div className="absolute top-10 right-0 rounded-[10px] w-52 z-20 overflow-hidden"
                     style={{ background: 'rgba(18,18,18,0.97)', border: '0.5px solid rgba(255,255,255,0.12)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
                  <button onClick={() => { setShowWikiModal(true); setBannerMenuOpen(false) }}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-[11px] cursor-pointer text-left hover:bg-[rgba(255,255,255,0.05)]"
                          style={{ color: '#b8b3f0' }}>
                    <Globe size={12} /> {t('Wiki Import')}
                  </button>
                  <div style={{ height: '0.5px', background: 'rgba(255,255,255,0.07)' }} />
                  <button onClick={() => { randomizeBanner(); setBannerMenuOpen(false) }}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-[11px] cursor-pointer text-left hover:bg-[rgba(255,255,255,0.05)]"
                          style={{ color: 'rgba(255,255,255,0.75)' }}>
                    <Shuffle size={12} /> {t('Randomize banner')}
                  </button>
                  <label className="w-full flex items-center gap-2 px-3 py-2.5 text-[11px] cursor-pointer hover:bg-[rgba(255,255,255,0.05)]"
                         style={{ color: 'rgba(255,255,255,0.75)', display: 'flex' }}>
                    <Upload size={12} /> {t('Upload banner')}
                    <input ref={bannerFileRef} type="file" accept="image/*" className="hidden"
                           onChange={e => { handleBannerFileUpload(e); setBannerMenuOpen(false) }} />
                  </label>
                  {bannerSrc && (
                    <>
                      <div style={{ height: '0.5px', background: 'rgba(255,255,255,0.07)' }} />
                      <div className="px-3 py-2.5">
                        <div className="text-[9px] text-[rgba(255,255,255,0.35)] uppercase tracking-widest mb-1.5">{t('Vertical position')}</div>
                        <input type="range" min={0} max={100} value={bannerY}
                               onChange={e => { const v = Number(e.target.value); setBannerY(v); saveBanner(bannerImageId, v, bannerZoom) }}
                               className="w-full h-1 cursor-pointer accent-[#7F77DD]" />
                      </div>
                      <div className="px-3 pb-3">
                        <div className="text-[9px] text-[rgba(255,255,255,0.35)] uppercase tracking-widest mb-1.5">{t('Zoom')}</div>
                        <input type="range" min={1} max={2} step={0.05} value={bannerZoom}
                               onChange={e => { const v = Number(e.target.value); setBannerZoom(v); saveBanner(bannerImageId, bannerY, v) }}
                               className="w-full h-1 cursor-pointer accent-[#7F77DD]" />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            </div>{/* end outer flex wrapper with delete + ... */}
          </div>
        </div>

        {/* ── Profile hero — transparent, floats over the banner photo ─── */}
        <div className="relative px-6 pb-8 z-10">
        <div className="flex items-start gap-5">
          {/* Avatar — tall vertical portrait */}
          <div className="relative flex-shrink-0 z-10" style={{ marginTop: -300 }}>
            <div className="rounded-[20px] overflow-hidden flex items-center justify-center group/avatar cursor-zoom-in relative"
                 onClick={() => (!avatarFailed && creator.avatar_path) && !avatarDragOver && setShowAvatarZoom(true)}
                 onDragOver={e => { e.preventDefault(); setAvatarDragOver(true) }}
                 onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setAvatarDragOver(false) }}
                 onDrop={handleAvatarDrop}
                 style={{ width: 300, height: 450, background: '#111', border: `3px solid ${avatarDragOver ? '#fff' : rc}`, boxShadow: `0 0 60px ${rc}66`, transition: 'border-color 0.15s' }}>
              {!avatarFailed && creator.avatar_path
                ? <img src={`/api/creators/${id}/avatar?v=${new Date(creator.updated_at || 0).getTime()}_${avatarBust}`} alt={creator.name}
                       className="w-full h-full object-cover transition-transform duration-300 group-hover/avatar:scale-105"
                       onError={() => setAvatarFailed(true)} />
                : <span className="font-semibold select-none" style={{ fontSize: 110, color: tc.text, background: tc.bg, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials}</span>
              }
              {/* drag-and-drop overlay */}
              {(avatarDragOver || avatarUploading) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-[17px]"
                     style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)', pointerEvents: 'none' }}>
                  {avatarUploading
                    ? <span className="text-[16px] font-medium text-white/80">Uploading…</span>
                    : <>
                        <Upload size={36} style={{ color: '#fff', opacity: 0.9 }} />
                        <span className="text-[16px] font-medium text-white/90">Drop to set avatar</span>
                      </>
                  }
                </div>
              )}
            </div>
            <button onClick={() => setShowAvatarModal(true)}
                    className="absolute -bottom-2 -right-2 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer"
                    title="Set avatar"
                    style={{ background: '#1a1a1a', border: `1.5px solid ${rc}66`, color: 'rgba(255,255,255,0.6)' }}>
              <Camera size={15} />
            </button>
          </div>

          {/* Main Info Area */}
          <div className="flex-1 min-w-0 pt-2 flex flex-col justify-between">
            <div className="flex items-start justify-between gap-6">
              {/* Name & Tags */}
              <div className="flex flex-col">
                <div className="flex items-center gap-3 group/name">
                  <div className="text-[28px] font-semibold text-[rgba(255,255,255,0.95)]">
                    {creator.name}
                    {creator.title && (
                      <span className="ml-2 font-light text-[20px]" style={{ color: 'rgba(255,255,255,0.38)' }}>
                        — {creator.title}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="text-[13px] px-3 py-0.5 rounded-full capitalize font-medium" style={{ background: tc.bg, color: tc.text }}>
                    {creator.creator_type}
                  </span>
                  <span className="text-[12px] px-3 py-0.5 rounded-full font-semibold"
                        style={{ background: `${rc}22`, color: rc }}>
                    {t(RARITY_LABELS[creator.card_rarity] ?? creator.card_rarity)}
                  </span>
                  {creator.series && (
                    <span className="text-[12px] px-3 py-0.5 rounded-full"
                          style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.45)' }}>
                      {creator.series}
                    </span>
                  )}
                </div>
                
                {/* Links */}
                {creator.platform_links && creator.platform_links !== "{}" && (
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {Object.values(JSON.parse(creator.platform_links)).map((link, i) => {
                      let icon = <Globe size={11} />
                      let label = t("Link")
                      if (link.includes('patreon')) { label = t("Patreon") }
                      else if (link.includes('onlyfans')) { label = t("OnlyFans") }
                      else if (link.includes('fansly')) { label = t("Fansly") }
                      else if (link.includes('twitter') || link.includes('x.com')) { label = t("Twitter") }
                      else if (link.includes('instagram')) { label = t("Instagram") }
                      
                      return (
                        <a key={i} href={link} target="_blank" rel="noreferrer"
                           className="flex items-center gap-1.5 text-[12px] px-3 py-1 rounded-full hover:bg-[rgba(255,255,255,0.1)] transition-colors"
                           style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                          {icon} {label}
                        </a>
                      )
                    })}
                  </div>
                )}

                <div className="mt-2">
                  <RatingInput value={rating ?? creator.rating ?? 0} onChange={handleRating} />
                </div>
                {!creator.bond_excluded && (
                  <div className="mt-2 flex flex-col gap-2">
                    <BondHearts
                      level={creator.bond_level ?? 0}
                      size="lg"
                      bondScore={creator.bond_score ?? 0}
                      showProgress
                    />
                    <button
                      onClick={() => giftMutation.mutate()}
                      disabled={giftMutation.isPending || heartsAvailable < 1}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '5px 12px', borderRadius: 8, fontSize: 14, fontWeight: 600,
                        cursor: heartsAvailable >= 1 ? 'pointer' : 'not-allowed',
                        background: heartsAvailable >= 1 ? 'rgba(255,45,117,0.18)' : 'rgba(255,255,255,0.04)',
                        border: heartsAvailable >= 1 ? '0.5px solid rgba(255,45,117,0.5)' : '0.5px solid rgba(255,255,255,0.07)',
                        color: heartsAvailable >= 1 ? '#FF2D75' : 'rgba(255,255,255,0.2)',
                        transition: 'all 0.15s',
                        alignSelf: 'flex-start',
                      }}
                    >
                      {t('❤️ Gift Heart')}
                      <span style={{ fontSize: 12, opacity: 0.6 }}>({heartsAvailable} {t('available')})</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Creator Description */}
              {creator.description && (
                <div className="flex-1 min-w-0 max-w-2xl text-[14px] text-white leading-relaxed line-clamp-5 mt-1 hidden md:block" 
                     style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
                  {creator.description}
                </div>
              )}
            </div>

            {/* Expanded Details Stats */}
            <div className="mt-6 flex flex-wrap gap-x-8 gap-y-4">
              {[
                ['Real Name', creator.real_name],
                ['Country', creator.country],
                ['Gender', creator.gender],
                [isCharacter ? 'Age' : 'Date of Birth', dobDisplay],
                ['Height', creator.height ? `${creator.height} cm` : null],
                ['Measurements', creator.body_measurements],
                ['Eye Color', creator.eye_color],
                ['Fake Boobs', creator.fake_boobs === true ? t('Yes') : creator.fake_boobs === false ? t('No') : null],
                ['Fake Ass', creator.fake_ass === true ? t('Yes') : creator.fake_ass === false ? t('No') : null],
                ['Tier Price', creator.patreon_price > 0 ? `$${creator.patreon_price.toFixed(2)}` : null],
                ...(creator.creator_type !== 'character' ? [
                  ['Status', creator.status],
                  ['Retirement Year', creator.status === 'Retired' ? creator.retirement_year : null],
                ] : []),
              ].filter(([, v]) => v !== null && v !== '').map(([k, v]) => (
                <div key={k}>
                  <div className="text-[16px] text-[rgba(255,255,255,0.4)] uppercase tracking-wider mb-0.5">{t(k)}</div>
                  <div className="text-[18px] font-semibold text-[rgba(255,255,255,0.95)]">{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-1.5 flex-shrink-0 pt-2 flex-wrap justify-end">
            <button onClick={() => setShowEditModal(true)}
                    className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-full cursor-pointer"
                    style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.55)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
              <Pencil size={11} /> {t('Edit')}
            </button>
            <button onClick={() => navigate(`/feed?creator_id=${id}`)}
                    className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-full cursor-pointer"
                    style={{ background: 'rgba(212,83,126,0.15)', color: '#ED93B1', border: '0.5px solid rgba(212,83,126,0.3)' }}>
              <Newspaper size={12} /> {t('Feed')}
            </button>
            <button onClick={talkToCreator}
                    className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-full cursor-pointer"
                    style={{ background: 'rgba(127,119,221,0.15)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.3)' }}>
              <Sparkles size={12} /> {t('Talk to')} {creator.name}
            </button>
            <button
              disabled={aiTagging}
              onClick={async () => {
                setAiTagging(true)
                try {
                  await taggerApi.start({ scope: 'creator', creator_id: parseInt(id), threshold: 0.35, retag: false })
                  toast.success(t('AI tagging started for ') + creator.name)
                } catch (err) {
                  toast.error(err?.response?.data?.detail || t('Failed to start AI tagging'))
                } finally {
                  setAiTagging(false)
                }
              }}
              className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-full cursor-pointer disabled:opacity-40"
              style={{ background: 'rgba(127,119,221,0.15)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.3)' }}>
              <Sparkles size={12} /> {aiTagging ? t('Starting…') : t('AI Tag')}
            </button>
            <button onClick={() => favMutation.mutate()}
                    className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-full cursor-pointer"
                    style={{ background: creator.is_favorite ? 'rgba(186,117,23,0.2)' : 'rgba(255,255,255,0.05)',
                             color: creator.is_favorite ? '#FAC775' : 'rgba(255,255,255,0.4)',
                             border: '0.5px solid rgba(255,255,255,0.1)' }}>
              <Star size={12} fill={creator.is_favorite ? '#FAC775' : 'none'} />
              {creator.is_favorite ? t('Favorited') : t('Favorite')}
            </button>
          </div>
        </div>
      </div>
      </div>{/* end combined banner+hero wrapper */}

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="p-5 flex flex-col gap-5">

        {/* ── Info row — three separate boxes side by side ─────────────── */}
        <div className="flex gap-3">

          {/* Box 1: Stats — expands, centered */}
          <div className="rounded-[12px] p-5 flex-1"
               style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center justify-around h-full">
              {[
                { label: 'Photos',    value: creator.image_count ?? 0,     color: 'rgba(255,255,255,0.9)' },
                { label: 'Videos',    value: creator.video_count ?? 0,     color: 'rgba(255,255,255,0.9)' },
                { label: 'Galleries', value: creator.gallery_count ?? 0,   color: 'rgba(255,255,255,0.9)' },
                { label: '💦',        value: creator.cum_count ?? 0,       color: '#D4537E' },
                { label: 'Gooning Time', value: (() => {
                  const secs = creator.total_view_seconds || 0
                  if (secs === 0) return '—'
                  const h = Math.floor(secs / 3600)
                  const m = Math.floor((secs % 3600) / 60)
                  return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`
                })(), color: '#D4537E' },
                { label: 'Size',      value: creator.total_size_gb > 0 ? `${creator.total_size_gb} GB` : '—', color: 'rgba(255,255,255,0.7)' },
              ].map(s => (
                <div key={s.label} className="flex flex-col items-center">
                  <div className="text-[22px] font-semibold leading-none" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-[16px] mt-1.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{t(s.label)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Box 2: Assign by folder — fixed width (+20%) */}
          <div className="rounded-[12px] p-4 flex flex-col justify-center gap-1.5 flex-shrink-0"
               style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)', width: 408 }}>
            <div className="flex items-center gap-2 text-[16px] font-medium uppercase tracking-wider"
                 style={{ color: 'rgba(255,255,255,0.4)' }}>
              <FolderOpen size={14} /> {t('Assign Galleries by Folder')}
            </div>
            <div className="flex items-center gap-2">
              <input
                value={folderInput}
                onChange={e => setFolderInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && folderInput.trim()) folderMutation.mutate(folderInput.trim()) }}
                placeholder={`e.g. D:\\Media\\${creator.name}`}
                className="flex-1 min-w-0 rounded-[8px] px-3 py-2 text-[13px] placeholder-[rgba(255,255,255,0.18)] outline-none font-mono"
                style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)' }}
              />
              <button
                onClick={() => folderMutation.mutate(folderInput.trim())}
                disabled={folderMutation.isPending || !folderInput.trim()}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-[8px] cursor-pointer disabled:opacity-40 text-[13px] font-medium whitespace-nowrap"
                style={{ background: 'rgba(127,119,221,0.2)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.4)' }}>
                <FolderOpen size={13} /> {folderMutation.isPending ? t('Assigning…') : t('Assign')}
              </button>
              {creator.source_folder && (
                <button onClick={() => folderMutation.mutate(null)}
                        disabled={folderMutation.isPending}
                        title={t('Clear saved folder')}
                        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer disabled:opacity-40"
                        style={{ background: 'rgba(212,83,126,0.1)', color: '#ED93B1', border: '0.5px solid rgba(212,83,126,0.25)' }}>
                  <X size={13} />
                </button>
              )}
            </div>
            {creator.source_folder && (
              <div className="text-[11px] font-mono truncate" style={{ color: 'rgba(255,255,255,0.3)' }}>
                {t('Saved:')} {creator.source_folder}
              </div>
            )}
          </div>

          {/* Box 3: Collection Value — only when data present */}
          {((creator.collection_value ?? 0) > 0 || (creator.completion_pct ?? 0) > 0) && (
            <div className="rounded-[12px] p-5 flex-1 flex flex-col justify-between gap-2"
                 style={{ background: 'rgba(29,158,117,0.07)', border: '0.5px solid rgba(29,158,117,0.2)' }}>
              <div className="flex items-start justify-between gap-6">
                {/* Value */}
                <div>
                  <div className="text-[16px] uppercase tracking-wider mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{t('Collection Value')}</div>
                  <div
                    onClick={() => setValueRevealed(true)}
                    title={valueRevealed ? undefined : t('Click to reveal')}
                    style={{
                      cursor: valueRevealed ? 'default' : 'pointer',
                      filter: valueRevealed ? 'none' : 'blur(6px)',
                      transition: 'filter 0.3s ease',
                      userSelect: valueRevealed ? 'auto' : 'none',
                    }}>
                    <div className="text-[20px] font-semibold" style={{ color: '#1D9E75' }}>
                      ${(creator.collection_value ?? 0).toFixed(2)}
                    </div>
                  </div>
                  {!valueRevealed && (
                    <div className="text-[9px] mt-0.5" style={{ color: 'rgba(29,158,117,0.5)' }}>{t('🔒 click to reveal')}</div>
                  )}
                </div>
                {/* Completion % */}
                <div className="text-right">
                  <div className="text-[16px] uppercase tracking-wider mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{t('All-Time')}</div>
                  <div className="text-[20px] font-semibold"
                       style={{ color: (creator.completion_pct ?? 0) >= 100 ? '#BA7517' : '#1D9E75' }}>
                    {(creator.completion_pct ?? 0).toFixed(0)}%
                  </div>
                  <div className="text-[16px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    {creator.months_covered_recent ?? 0}/{creator.total_months_expected || '?'} {t('mo')}
                  </div>
                </div>
              </div>
              {/* Completion bar */}
              <div className="h-[4px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
                <div className="h-full rounded-full transition-all duration-700"
                     style={{
                       width: `${Math.min(100, creator.completion_pct ?? 0)}%`,
                       background: (creator.completion_pct ?? 0) >= 100
                         ? 'linear-gradient(90deg,#BA7517,#EF9F27)'
                         : 'linear-gradient(90deg,#1D9E75,#9FE1CB)',
                     }} />
              </div>
            </div>
          )}
        </div>

        {/* ── Discovery row ─────────────────────────────────────────────── */}
        <DiscoveryRow
          creatorId={id}
          onItemClick={(img) => img.gallery_id && navigate(`/galleries/${img.gallery_id}?openImage=${img.id}`)}
          onItemContextMenu={openMediaCtx}
        />

        {/* ── Instagram-style content tabs ─────────────────────────────── */}
        <motion.div
          ref={contentRef}
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Tab bar */}
          <div className="flex items-center mb-6"
               style={{ borderBottom: '0.5px solid rgba(255,255,255,0.08)' }}>
            {[
              { key: 'galleries', label: 'Galleries', count: creator.gallery_count ?? allGalleries?.length },
              { key: 'photos',    label: 'Photos',    count: creator.image_count || null },
              { key: 'videos',    label: 'Videos',    count: creator.video_count || null },
            ].map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => changeTab(tab.key)}
                className="relative pb-3 px-6 text-[14px] font-medium cursor-pointer transition-colors"
                style={{
                  color: activeTab === tab.key ? '#fff' : 'rgba(255,255,255,0.38)',
                  background: 'none', border: 'none',
                }}
              >
                {t(tab.label)}
                {tab.count != null && (
                  <span className="ml-1.5 text-[12px]"
                        style={{ color: activeTab === tab.key ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.2)' }}>
                    {tab.count}
                  </span>
                )}
                {activeTab === tab.key && (
                  <motion.div
                    layoutId="tab-line"
                    className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full"
                    style={{ background: 'var(--accent)' }}
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  />
                )}
              </button>
            ))}
          </div>

          {/* Sliding tab content */}
          <AnimatePresence mode="wait" custom={tabDirection}>
            <motion.div
              key={activeTab}
              custom={tabDirection}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            >
              {activeTab === 'galleries' && (
                <GalleriesTab
                  galleries={allGalleries}
                  onGalleryClick={(gid) => navigate(`/galleries/${gid}`)}
                  onViewAll={() => navigate(`/galleries?creator_id=${id}`)}
                  onGalleryContextMenu={openGalleryCtx}
                />
              )}
              {activeTab === 'photos' && (
                <MediaTab
                  creatorId={id}
                  isVideo={false}
                  onItemClick={(img) => img.gallery_id && navigate(`/galleries/${img.gallery_id}?openImage=${img.id}`)}
                  emptyMessage="No photos yet"
                  onItemContextMenu={openMediaCtx}
                  onViewAll={() => navigate(`/images?creator_id=${id}`)}
                  total={creator.image_count}
                />
              )}
              {activeTab === 'videos' && (
                <MediaTab
                  creatorId={id}
                  isVideo={true}
                  onItemClick={(img) => img.gallery_id && navigate(`/galleries/${img.gallery_id}?openImage=${img.id}`)}
                  emptyMessage="No videos yet"
                  onItemContextMenu={openMediaCtx}
                  onViewAll={() => navigate(`/videos?creator_id=${id}`)}
                  total={creator.video_count}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </motion.div>


      </div>

      {/* Right-click context menu (galleries + media) */}
      {ctxMenu && ctxItems && (
        <SlimContextMenu
          title={ctxMenu.type === 'gallery' ? ctxMenu.item.name : ctxMenu.item.filename}
          subtitle={ctxMenu.type === 'media' && ctxMenu.item.is_video ? t('Video') : null}
          position={{ x: ctxMenu.x, y: ctxMenu.y }}
          onClose={() => setCtxMenu(null)}
          items={ctxItems}
        />
      )}

      {/* Video frame picker for avatar / banner */}
      {framePicker && (
        <AvatarFramePicker
          creatorId={framePicker.creatorId}
          image={framePicker.image}
          mode={framePicker.mode}
          onSuccess={() => {
            if (framePicker.creatorId !== parseInt(id)) return
            if (framePicker.mode === 'banner') {
              // extracted banner lives in banner_path — clear local overrides so it shows
              setBannerLocalUrl(null)
              setBannerImageId(null)
            } else {
              setAvatarFailed(false)
            }
          }}
          onClose={() => setFramePicker(null)}
        />
      )}

      {/* Modals */}
      {showAvatarModal && (
        <AvatarModal
          creatorId={parseInt(id)}
          currentAvatarPath={creator?.avatar_path}
          onClose={() => setShowAvatarModal(false)}
          onSuccess={() => { setShowAvatarModal(false); setAvatarFailed(false); bumpAvatarBust() }}
        />
      )}
      {showEditModal && <EditCreatorModal creator={creator} onClose={() => setShowEditModal(false)} />}

      {/* Avatar zoom lightbox */}
      {showAvatarZoom && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(12px)', animation: 'fadeIn 0.18s ease' }}
          onClick={() => setShowAvatarZoom(false)}
        >
          <div
            style={{ animation: 'zoomIn 0.22s cubic-bezier(0.34,1.56,0.64,1)' }}
            onClick={e => e.stopPropagation()}
          >
            <img
              src={`/api/creators/${id}/avatar?v=${new Date(creator.updated_at || 0).getTime()}_${avatarBust}`}
              alt={creator.name}
              className="rounded-[24px] shadow-2xl"
              style={{ maxHeight: '85vh', maxWidth: '85vw', objectFit: 'contain', border: `3px solid ${rc}`, boxShadow: `0 0 80px ${rc}55` }}
            />
            <div className="text-center mt-3 text-[14px] font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
              {creator.name}
            </div>
          </div>
          <style>{`
            @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
            @keyframes zoomIn { from { transform: scale(0.6); opacity: 0 } to { transform: scale(1); opacity: 1 } }
          `}</style>
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}>
          <div className="rounded-[16px] p-7 w-[420px] text-center shadow-2xl"
               style={{ background: '#1a1a1a', border: '0.5px solid rgba(255,255,255,0.12)' }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
                 style={{ background: 'rgba(212,83,126,0.15)', border: '1px solid rgba(212,83,126,0.35)' }}>
              <Trash2 size={22} style={{ color: '#ED93B1' }} />
            </div>
            <div className="text-[17px] font-semibold text-white mb-2">{t('Delete')} {creator.name}?</div>
            <div className="text-[13px] mb-6" style={{ color: 'rgba(255,255,255,0.45)', lineHeight: 1.55 }}>
              {t('This will permanently remove this creator and all their data from The Vault. This action is irreversible.')}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(false)}
                      className="flex-1 py-2.5 rounded-[10px] text-[13px] cursor-pointer"
                      style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                {t('Cancel')}
              </button>
              <button onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}
                      className="flex-1 py-2.5 rounded-[10px] text-[13px] font-medium cursor-pointer"
                      style={{ background: 'rgba(212,83,126,0.25)', color: '#ED93B1', border: '0.5px solid rgba(212,83,126,0.45)' }}>
                {deleteMutation.isPending ? t('Deleting...') : t('Yes, delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

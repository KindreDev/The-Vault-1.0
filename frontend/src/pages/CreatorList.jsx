import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Plus, Star, X, User, Loader, LayoutGrid, Filter } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { creatorsApi } from '../lib/api'
import CreatorContextMenu from '../components/CreatorContextMenu'
import { useVaultStore } from '../store/vault'
import toast from 'react-hot-toast'
import { FormDropdown } from '../components/FormDropdown'
import { COUNTRIES } from '../lib/countries'
import { SortDropdown } from '../components/SortDropdown'
import BondHearts from '../components/BondHearts'
import FranchiseFilter from '../components/FranchiseFilter'
import GalleryPagination from '../components/GalleryPagination'
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
  { value: '', label: 'Unknown / Not Set' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]

const TYPE_LABELS = {
  cosplayer: 'Cosplayer',
  ethot:     'Ethot',
  artist:    'Artist',
  character: 'Character',
  actress:   'Actress',
  custom:    'Model/Other',
}

const STATUS_OPTIONS = [
  { value: 'Active', label: 'Active' },
  { value: 'Hiatus', label: 'Hiatus' },
  { value: 'Retired', label: 'Retired' },
]

const TYPE_COLORS = {
  cosplayer: { bg: 'color-mix(in srgb, var(--c-green) 15%, transparent)',  text: '#9FE1CB', glow: 'color-mix(in srgb, var(--c-green) 25%, transparent)' },
  ethot:     { bg: 'color-mix(in srgb, var(--c-pink) 15%, transparent)',  text: '#ED93B1', glow: 'color-mix(in srgb, var(--c-pink) 25%, transparent)' },
  artist:    { bg: 'color-mix(in srgb, var(--c-accent) 15%, transparent)', text: '#CECBF6', glow: 'color-mix(in srgb, var(--c-accent) 25%, transparent)' },
  character: { bg: 'color-mix(in srgb, var(--c-amber) 15%, transparent)',  text: '#FAC775', glow: 'color-mix(in srgb, var(--c-amber) 25%, transparent)' },
  actress:   { bg: 'color-mix(in srgb, var(--c-pink) 15%, transparent)',  text: '#ED93B1', glow: 'color-mix(in srgb, var(--c-pink) 25%, transparent)' },
  custom:    { bg: 'rgba(136,135,128,0.15)', text: '#D3D1C7', glow: 'rgba(136,135,128,0.25)' },
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


// Returns lowercase 2-letter ISO code for flag-icons (fi fi-{code})
const NAME_TO_ISO = {
  'Japan': 'jp', 'Korea, South': 'kr', 'China': 'cn', 'United States': 'us',
  'United Kingdom': 'gb', 'Russia': 'ru', 'Ukraine': 'ua', 'Germany': 'de',
  'France': 'fr', 'Italy': 'it', 'Spain': 'es', 'Poland': 'pl', 'Brazil': 'br',
  'Mexico': 'mx', 'Canada': 'ca', 'Australia': 'au', 'Philippines': 'ph',
  'Thailand': 'th', 'Vietnam': 'vn', 'Indonesia': 'id', 'Malaysia': 'my',
  'Singapore': 'sg', 'Taiwan': 'tw', 'Sweden': 'se', 'Norway': 'no',
  'Denmark': 'dk', 'Finland': 'fi', 'Netherlands': 'nl', 'Belgium': 'be',
  'Switzerland': 'ch', 'Austria': 'at', 'Czechia (Czech Republic)': 'cz',
  'Hungary': 'hu', 'Romania': 'ro', 'Turkey': 'tr', 'Israel': 'il',
  'India': 'in', 'Argentina': 'ar', 'Colombia': 'co', 'Chile': 'cl',
  'Peru': 'pe', 'Portugal': 'pt', 'Greece': 'gr', 'Croatia': 'hr',
  'Serbia': 'rs', 'New Zealand': 'nz', 'South Africa': 'za', 'Egypt': 'eg',
  'USA': 'us', 'UK': 'gb',
}

function countryIso(country) {
  if (!country) return null
  const trimmed = country.trim()
  // Already a 2-letter code (stored as "RU", "JP", etc.)
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toLowerCase()
  return NAME_TO_ISO[trimmed] || null
}

function calcAge(dob) {
  if (!dob) return null
  const parts = String(dob).split('-')
  const year = parseInt(parts[0], 10)
  const month = parseInt(parts[1] || '1', 10)
  const day = parseInt(parts[2] || '1', 10)
  if (!year || year < 1920 || year > new Date().getFullYear()) return null
  const now = new Date()
  let age = now.getFullYear() - year
  if (now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day)) age--
  return age > 0 && age < 100 ? age : null
}

const SORTS = [
  { value: 'name',        label: 'Name A–Z' },
  { value: 'date_added',  label: 'Date Added' },
  { value: 'image_count', label: 'Most Photos' },
  { value: 'cum_count',   label: 'Most Cummed' },
  { value: 'rating',      label: 'Highest Rated' },
  { value: 'rarity',      label: 'Collection Size' },
  { value: 'random',      label: 'Random' },
]

const PER_PAGE_OPTIONS = [25, 50, 100, 250]

// ── Creator card — vertical portrait ─────────────────────────────────────────
// React.memo: prevents grid from re-rendering all 50 cards when parent state
// changes (search input, sort, modal open, etc.)
const CreatorCard = React.memo(function CreatorCard({ creator, onClick, onContextMenu, avatarBust, cardSize = 345 }) {
  const [failed, setFailed]       = useState(false)
  const [ratingOpen, setRatingOpen] = useState(false)
  const [hoverStar, setHoverStar] = useState(0)
  const ratingRef                 = useRef(null)
  const qc                        = useQueryClient()
  const t                         = useT()

  useEffect(() => {
    if (!ratingOpen) return
    const h = e => { if (ratingRef.current && !ratingRef.current.contains(e.target)) setRatingOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [ratingOpen])

  const rateMutation = useMutation({
    mutationFn: (rating) => creatorsApi.update(creator.id, { rating }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['creators'] }); setRatingOpen(false) },
    onError:   () => toast.error(t('Could not update rating')),
  })

  const tc = TYPE_COLORS[creator.creator_type] || TYPE_COLORS.custom
  const rc = RARITY_COLORS[creator.card_rarity] || RARITY_COLORS.common
  const initials = creator.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  // Thumbnail avatar (640px) — sharp enough for HiDPI list cards, much lighter than full-res
  const bust = new Date(creator.updated_at || 0).getTime()
  const url = creator.avatar_path ? `/api/creators/${creator.id}/avatar-thumb?size=640&v=${bust}_${avatarBust}` : null
  const hasAvatar = url && !failed

  const age = calcAge(creator.date_of_birth)
  const iso = countryIso(creator.country)

  return (
    <div onClick={onClick}
         onContextMenu={(e) => { e.preventDefault(); onContextMenu?.(creator, e) }}
         className="rounded-[12px] overflow-hidden cursor-pointer group relative"
         style={{ background: tc.bg, border: `0.5px solid ${rc}44`, aspectRatio: '2/3' }}>

      {/* Photo — fills the entire card */}
      <div className="absolute inset-0" style={{ background: hasAvatar ? '#111' : tc.bg }}>
        {hasAvatar
          ? <img
               key={`${creator.id}-${avatarBust}`}
               src={url} alt={creator.name}
               loading="lazy"
               decoding="async"
               className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
               onError={() => setFailed(true)} />
          : <div className="w-full h-full flex items-center justify-center">
              <span className="font-semibold select-none"
                    style={{ fontSize: Math.max(24, Math.round(64 * cardSize / 345)), color: tc.text, opacity: 0.5 }}>{initials}</span>
            </div>
        }
      </div>

      {/* Gradient overlay — covers bottom third, info strip sits on top of it */}
      <div className="absolute bottom-0 left-0 right-0 pointer-events-none"
           style={{ height: '42%', background: 'linear-gradient(to bottom, transparent, rgba(0,0,0,0.92))' }} />

      {/* Top badges */}
      {creator.is_favorite && (
        <div className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full flex items-center justify-center"
             style={{ background: 'rgba(0,0,0,0.6)', zIndex: 2 }}>
          <Star size={13} style={{ color: '#EF9F27' }} fill="#EF9F27" />
        </div>
      )}
      {/* Rating badge — click to rate inline; fades in on card hover when unrated */}
      <div ref={ratingRef} className="absolute top-2.5 left-2.5" style={{ zIndex: 10 }}>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); setRatingOpen(o => !o) }}
          className={`flex items-center gap-1 px-2 py-1 rounded-full text-[13px] font-semibold cursor-pointer transition-opacity ${creator.rating > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'}`}
          style={{
            background: creator.rating > 0 ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.5)',
            color: '#EF9F27',
            border: `0.5px solid ${creator.rating > 0 ? 'rgba(239,159,39,0.4)' : 'rgba(239,159,39,0.2)'}`,
          }}>
          {creator.rating > 0
            ? `★ ${creator.rating % 1 === 0 ? creator.rating.toFixed(0) : creator.rating.toFixed(1)}`
            : '☆'}
        </button>

        {ratingOpen && (
          <div className="absolute top-full mt-1 left-0 rounded-[10px] p-3 shadow-2xl"
               style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.15)', zIndex: 50, minWidth: 220 }}>
            <div className="text-[11px] mb-2 uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.35)' }}>{t('Rate')}</div>
            <div className="flex gap-0.5">
              {[1,2,3,4,5,6,7,8,9,10].map(n => (
                <button
                  key={n}
                  type="button"
                  onMouseEnter={() => setHoverStar(n)}
                  onMouseLeave={() => setHoverStar(0)}
                  onClick={e => { e.stopPropagation(); rateMutation.mutate(n) }}
                  className="cursor-pointer text-[20px] leading-none transition-colors"
                  style={{ color: n <= (hoverStar || creator.rating) ? '#EF9F27' : 'rgba(255,255,255,0.15)' }}>
                  ★
                </button>
              ))}
            </div>
            {creator.rating > 0 && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); rateMutation.mutate(0) }}
                className="mt-2 text-[11px] w-full text-center cursor-pointer"
                style={{ color: 'rgba(255,255,255,0.3)' }}>
                {t('Clear rating')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Info overlay — pinned to bottom, sits inside the gradient */}
      <div className="absolute bottom-0 left-0 right-0 px-3 pb-3 pt-2 flex flex-col gap-2" style={{ zIndex: 2 }}>
        {/* Name + country flag */}
        <div className="flex items-end gap-2">
          <div className="text-[19px] font-semibold leading-tight flex-1 truncate"
               style={{ color: 'rgba(255,255,255,0.95)' }}>
            {creator.title || creator.name}
          </div>
          {iso && (
            <span className={`fi fi-${iso} flex-shrink-0`}
                  style={{ width: 22, height: 16, borderRadius: 2, display: 'inline-block' }}
                  title={creator.country} />
          )}
        </div>

        {/* Type + rarity + age + photo count */}
        <div className="flex items-center gap-2">
          <span className="text-[13px] px-2.5 py-0.5 rounded-full capitalize font-medium"
                style={{ background: tc.bg, color: tc.text }}>
            {t(TYPE_LABELS[creator.creator_type] || creator.creator_type)}
          </span>
          {creator.card_rarity && creator.card_rarity !== 'common' && (
            <span className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                  style={{ background: `${rc}22`, color: rc, border: `0.5px solid ${rc}55` }}>
              {t(RARITY_LABELS[creator.card_rarity] ?? creator.card_rarity)}
            </span>
          )}
          {age !== null && (
            <span className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{age}y</span>
          )}
          <span className="text-[13px] ml-auto" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {(creator.image_count ?? 0).toLocaleString()} {t('photos')}
          </span>
        </div>

        {/* Galleries + sessions */}
        {(creator.gallery_count > 0 || creator.session_count > 0) && (
          <div className="flex items-center gap-3 text-[12px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {creator.gallery_count > 0 && (
              <span>{creator.gallery_count} {creator.gallery_count === 1 ? t('gallery') : t('galleries')}</span>
            )}
            {creator.session_count > 0 && (
              <span style={{ color: 'color-mix(in srgb, var(--c-pink) 60%, transparent)' }}>♥ {creator.session_count} {t('sessions')}</span>
            )}
          </div>
        )}
        {!creator.bond_excluded && (
          <BondHearts level={creator.bond_level ?? 0} size="sm" />
        )}
      </div>
    </div>
  )
}, (prev, next) =>
  prev.creator    === next.creator    &&
  prev.avatarBust === next.avatarBust &&
  prev.cardSize   === next.cardSize
)
// ── Jikan character search (anime characters via MAL) ─────────────────────────
function JikanSearch({ onSelect }) {
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState([])
  const [loading, setLoading]   = useState(false)
  const [apiError, setApiError] = useState(false)
  const [picked, setPicked]     = useState(null)
  const debounceRef             = useRef(null)
  const t                       = useT()

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (query.trim().length < 2) { setResults([]); setApiError(false); return }
    setLoading(true)
    setApiError(false)
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await creatorsApi.jikanSearch(query.trim())
        setResults(r.data ?? [])
      } catch {
        setResults([])
        setApiError(true)
      }
      finally { setLoading(false) }
    }, 450)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  const handlePick = (char) => {
    setPicked(char)
    setResults([])
    setQuery('')
  }

  const handleConfirm = async () => {
    if (!picked) return
    setLoading(true)
    try {
      const r = await creatorsApi.jikanCharacter(picked.mal_id)
      onSelect({ ...picked, ...r.data })
    } catch {
      onSelect(picked)  // fall back to search result data
    } finally {
      setLoading(false)
      setPicked(null)
    }
  }

  return (
    <div className="mb-5 rounded-[10px] p-4" style={{ background: 'color-mix(in srgb, var(--c-amber) 7%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 25%, transparent)' }}>
      <div className="text-[16px] font-medium mb-2.5 flex items-center gap-1.5" style={{ color: 'var(--c-amber-text)' }}>
        <span className="text-[18px]">⚡</span> {t('Import from MyAnimeList')}
      </div>

      {picked ? (
        <div className="flex items-center gap-4">
          {picked.image_url && (
            <img src={picked.image_url} alt="" className="rounded-[6px] object-cover flex-shrink-0"
                 style={{ width: 60, height: 84 }} onError={e => { e.target.style.display = 'none' }} />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[18px] font-semibold text-white truncate">{picked.name}</div>
            {picked.series?.[0] && (
              <div className="text-[16px] truncate mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>{picked.series[0]}</div>
            )}
            <div className="flex gap-1.5 mt-1 flex-wrap">
              {picked.gender    && <span className="text-[13px] px-2 py-0.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--c-pink) 20%, transparent)', color: 'var(--c-pink-text)' }}>{picked.gender}</span>}
              {picked.height_cm && <span className="text-[13px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' }}>{picked.height_cm} cm</span>}
              {picked.age       && <span className="text-[13px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' }}>{t('Age')} {picked.age}</span>}
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={handleConfirm}
                    className="px-4 py-2 rounded-full text-[16px] font-medium cursor-pointer"
                    style={{ background: 'color-mix(in srgb, var(--c-amber) 30%, transparent)', color: 'var(--c-amber-text)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 50%, transparent)' }}>
              {t('Fill form')}
            </button>
            <button onClick={() => setPicked(null)}
                    className="px-3 py-2 rounded-full text-[16px] cursor-pointer"
                    style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)' }}>
              ✕
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="relative">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('Search anime character name…')}
              className="w-full rounded-[8px] px-3.5 py-2.5 text-[18px] text-[rgba(255,255,255,0.85)] placeholder-[rgba(255,255,255,0.25)] outline-none pr-10"
              style={{ background: 'rgba(255,255,255,0.07)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 35%, transparent)' }}
            />
            {loading && (
              <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                <Loader size={18} className="animate-spin" style={{ color: 'var(--c-amber-text)' }} />
              </div>
            )}
          </div>

          {apiError && (
            <div className="mt-2 text-[14px] px-3 py-2 rounded-[8px]"
                 style={{ background: 'color-mix(in srgb, var(--c-amber) 10%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 30%, transparent)', color: 'var(--c-amber-text)' }}>
              {t('MyAnimeList API is currently unavailable — try again in a moment.')}
            </div>
          )}

          {results.length > 0 && (
            <div className="mt-2.5 flex flex-col gap-1.5 max-h-60 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
              {results.map(char => (
                <button key={char.mal_id} onClick={() => handlePick(char)}
                        className="flex items-center gap-3.5 px-3 py-2.5 rounded-[8px] cursor-pointer text-left hover:bg-[rgba(255,255,255,0.06)] transition-colors">
                  {char.image_url && (
                    <img src={char.image_url} alt="" className="rounded-[4px] object-cover flex-shrink-0"
                         style={{ width: 48, height: 68 }} onError={e => { e.target.style.display = 'none' }} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-[18px] font-medium text-white truncate">{char.name}</div>
                    {char.name_kanji && (
                      <div className="text-[14px] truncate mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>{char.name_kanji}</div>
                    )}
                    {char.series?.[0] && (
                      <div className="text-[16px] truncate mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>{char.series[0]}</div>
                    )}
                    <div className="flex gap-1.5 mt-1 flex-wrap">
                      {char.gender    && <span className="text-[13px] px-2 py-0.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--c-pink) 20%, transparent)', color: 'var(--c-pink-text)' }}>{char.gender}</span>}
                      {char.height_cm && <span className="text-[13px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' }}>{char.height_cm} cm</span>}
                      {char.age       && <span className="text-[13px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' }}>{t('Age')} {char.age}</span>}
                    </div>
                  </div>
                  {char.favorites > 0 && (
                    <div className="text-[14px] flex-shrink-0 font-medium" style={{ color: 'rgba(255,255,255,0.3)' }}>
                      ♥ {char.favorites >= 1000 ? `${(char.favorites / 1000).toFixed(1)}k` : char.favorites}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Add creator modal ──────────────────────────────────────────────────────────
function AddCreatorModal({ onClose, onSuccess }) {
  const [form, setForm] = useState({
    name: '', title: '', real_name: '', creator_type: 'cosplayer',
    gender: '', eye_color: '', fake_boobs: '', fake_ass: '',
    date_of_birth: '', height: '', body_measurements: '', country: '',
    series: '', origin: '', description: '', wiki_url: '', platform_links: '', patreon_price: '',
    status: 'Active', retirement_year: ''
  })
  const pendingAvatarUrl = useRef(null)
  const qc = useQueryClient()
  const t = useT()

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
      return creatorsApi.create(payload).then(r => r.data)
    },
    onSuccess: (data) => {
      toast.success(`${data.name} added! +50 XP`)
      qc.invalidateQueries({ queryKey: ['creators'], refetchType: 'all' })
      qc.invalidateQueries({ queryKey: ['favorites'], refetchType: 'all' })
      qc.invalidateQueries({ queryKey: ['profile'] })
      if (pendingAvatarUrl.current) {
        creatorsApi.setAvatarFromUrl(data.id, pendingAvatarUrl.current).catch(() => {})
        pendingAvatarUrl.current = null
      }
      onSuccess(data)
    },
    onError: () => toast.error(t('Failed to add creator'))
  })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const fillFromJikan = (char) => {
    pendingAvatarUrl.current = char.image_url || null
    setForm(f => ({
      ...f,
      name:         char.name,
      series:       char.series?.[0] || f.series,
      origin:       char.series?.[0] || f.origin,
      description:     char.about ? char.about.slice(0, 1000) : f.description,
      wiki_url:        char.url || f.wiki_url,
      creator_type:    'character',
      ...(char.gender    ? { gender: char.gender }             : {}),
      ...(char.height_cm ? { height: String(char.height_cm) }  : {}),
      ...(char.age       ? { date_of_birth: String(char.age) } : {}),
    }))
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}>
      <motion.div
        className="rounded-[14px] p-6 w-[880px] max-h-[85vh] overflow-y-auto shadow-2xl"
        style={{ background: '#1a1a1a', border: '0.5px solid rgba(255,255,255,0.12)' }}
        initial={{ scale: 0.82, opacity: 0, y: 12 }}
        animate={{ scale: 1,    opacity: 1, y: 0  }}
        exit={{    scale: 0.82, opacity: 0, y: 12 }}
        transition={{ type: 'spring', stiffness: 480, damping: 32 }}>

        <div className="flex items-center justify-between mb-5">
          <div className="text-[22px] font-medium text-[rgba(255,255,255,0.9)]">{t('Add creator')}</div>
          <button onClick={onClose} className="cursor-pointer text-[rgba(255,255,255,0.4)] hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="mb-4">
          <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-2 uppercase tracking-wider font-semibold">{t('Category')}</div>
          <div className="flex flex-wrap gap-1.5">
            {TYPES.map(ct => (
              <button key={ct} onClick={() => set('creator_type', ct)}
                      className="text-[16px] px-3.5 py-2 rounded-full cursor-pointer capitalize transition-all"
                      style={{
                        background: form.creator_type === ct ? 'color-mix(in srgb, var(--c-accent) 25%, transparent)' : 'rgba(255,255,255,0.05)',
                        color: form.creator_type === ct ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.45)',
                        border: `0.5px solid ${form.creator_type === ct ? 'color-mix(in srgb, var(--c-accent) 50%, transparent)' : 'rgba(255,255,255,0.08)'}`,
                      }}>
                {t(TYPE_LABELS[ct] || ct)}
              </button>
            ))}
          </div>
        </div>

        {/* MAL import — character type only */}
        {form.creator_type === 'character' && (
          <JikanSearch onSelect={fillFromJikan} />
        )}

        <div className="grid grid-cols-2 gap-x-8 gap-y-4 mt-4">
          {/* Left Column */}
          <div className="flex flex-col gap-4">
            {[
              { label: 'Name *', key: 'name', placeholder: 'Queen Marika' },
              { label: 'Title', key: 'title', placeholder: 'Optional title shown after name' },
              { label: 'Real name', key: 'real_name', placeholder: 'Real identity if known' },
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
                  { label: 'Origin/Universe', key: 'origin', placeholder: 'Lands Between' },
                  { label: 'Franchise', key: 'series', placeholder: 'Elden Ring' },
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
                       placeholder="https://..."
                       className="w-full rounded-[8px] px-3.5 py-2.5 text-[18px] text-[rgba(255,255,255,0.85)] placeholder-[rgba(255,255,255,0.2)] outline-none"
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
                    placeholder={t('Brief description...')} rows={2}
                    className="w-full rounded-[8px] px-3.5 py-2.5 text-[18px] text-[rgba(255,255,255,0.85)] placeholder-[rgba(255,255,255,0.2)] outline-none resize-none"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }} />
        </div>

        <div className="flex gap-4">
          <button onClick={onClose}
                  className="flex-1 py-3 rounded-[8px] text-[16px] cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
            {t('Cancel')}
          </button>
          <button onClick={() => mutation.mutate()}
                  disabled={!form.name.trim() || mutation.isPending}
                  className="flex-1 py-3 rounded-[8px] text-[16px] font-medium cursor-pointer"
                  style={{ background: !form.name.trim() ? 'color-mix(in srgb, var(--c-accent) 10%, transparent)' : 'color-mix(in srgb, var(--c-accent) 30%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }}>
            {mutation.isPending ? t('Adding...') : t('Add creator +50 XP')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
const TYPE_FILTER_LIST = ['all', ...TYPES]
const CL_STATE_KEY = 'vault_creator_list_state'

export default function CreatorList() {
  const navigate   = useNavigate()
  const avatarBust = useVaultStore(s => s.avatarBust)
  const cardSize    = useVaultStore(s => s.thumbSizeCreators)
  const setCardSize = useVaultStore(s => s.setThumbSizeCreators)
  const [searchParams, setSearchParams] = useSearchParams()

  // ── Persist filter state so back-navigation (and sidebar re-entry) restores it —
  // same pattern as GalleryList: URL params are the source of truth, sessionStorage
  // is only a restore-on-mount convenience for when the URL itself is bare.
  const _clRestoredRef = useRef(false)
  useEffect(() => {
    if (_clRestoredRef.current) return
    _clRestoredRef.current = true
    if (searchParams.toString() === '') {
      try {
        const saved = sessionStorage.getItem(CL_STATE_KEY)
        if (saved) setSearchParams(new URLSearchParams(saved), { replace: true })
      } catch {}
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try { sessionStorage.setItem(CL_STATE_KEY, searchParams.toString()) } catch {}
  }, [searchParams])

  // ── Derive all filter state from URL search params ──────────────────────────
  const search     = searchParams.get('q') || ''
  const typeFilter = searchParams.get('ctype') || 'all'
  const sortBy     = searchParams.get('sort') || 'name'
  const sortDir    = searchParams.get('dir') || (sortBy === 'name' ? 'asc' : 'desc')
  const franchise  = searchParams.get('franchise') || ''
  const favOnly    = searchParams.get('fav') === '1'
  const page       = parseInt(searchParams.get('page') || '1', 10) || 1

  // Page size: localStorage (not URL) so it can't get stuck via sessionStorage restore
  const [perPage, setPerPageState] = useState(() => parseInt(localStorage.getItem('vault_creator_page_size') || '50', 10))

  const [showModal, setShowModal] = useState(false)
  const [creatorCtxMenu, setCreatorCtxMenu] = useState(null) // { creator, x, y }

  const qc = useQueryClient()
  const t = useT()

  // ── Helpers: update URL params, merging with what's already there ───────────
  const setParam = useCallback((key, value) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (value === null || value === undefined || value === '' || value === false) next.delete(key)
      else next.set(key, String(value))
      return next
    }, { replace: true })
  }, [setSearchParams])

  const setParams = useCallback((updates) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined || value === '' || value === false) next.delete(key)
        else next.set(key, String(value))
      }
      return next
    }, { replace: true })
  }, [setSearchParams])

  const setSearch     = useCallback(v => setParams({ q: v || null, page: null }), [setParams])
  const setTypeFilter = useCallback(v => setParams({ ctype: v !== 'all' ? v : null, page: null }), [setParams])
  const setFranchise  = useCallback(v => setParams({ franchise: v || null, page: null }), [setParams])
  const setFavOnly    = useCallback(v => setParams({ fav: v ? '1' : null, page: null }), [setParams])
  const setSortDir    = useCallback(v => setParam('dir', v), [setParam])
  const setPage = useCallback((v) => {
    const p = typeof v === 'function' ? v(page) : v
    setParam('page', p > 1 ? p : null)
  }, [setParam, page])
  const setPerPage = useCallback((v) => {
    setPerPageState(v)
    try { localStorage.setItem('vault_creator_page_size', String(v)) } catch {}
    setParam('page', null)
  }, [setParam])
  const handleSortChange = useCallback((val) => {
    setParams({ sort: val !== 'name' ? val : null, dir: val === 'name' ? null : 'desc', page: null })
  }, [setParams])

  const hasActiveFilters = search || typeFilter !== 'all' || sortBy !== 'name' || franchise || favOnly
  const resetFilters = useCallback(() => setSearchParams({}, { replace: true }), [setSearchParams])

  const skip = (page - 1) * perPage
  const filterKey = `${search}|${typeFilter}|${sortBy}|${sortDir}|${franchise}|${favOnly}`

  const { data: creatorPage, isLoading } = useQuery({
    queryKey: ['creators', filterKey, page, perPage],
    // avatarBust intentionally excluded — avatar images have their own cache-busting
    // in the URL (v=${updated_at}_${avatarBust}). Including it here caused the ENTIRE
    // creators list to re-fetch from the server whenever any avatar changed.
    queryFn: () => creatorsApi.list({
      search: search || undefined,
      creator_type: typeFilter !== 'all' ? typeFilter : undefined,
      series: franchise || undefined,
      favorite: favOnly || undefined,
      sort_by: sortBy,
      sort_dir: sortBy !== 'random' ? sortDir : undefined,
      skip,
      limit: perPage,
    }).then(r => ({
      items: r.data,
      total: parseInt(r.headers['x-total-count'] ?? '0', 10),
    })),
  })

  const creators   = creatorPage?.items ?? []
  const totalPages = Math.max(1, Math.ceil((creatorPage?.total ?? 0) / perPage))

  return (
    <div className="p-5 pb-16">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="text-[16px] font-medium text-[rgba(255,255,255,0.9)] mr-1">{t('Creators')}</div>

        {/* Search */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
             style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
          <Search size={13} className="text-[rgba(255,255,255,0.3)] flex-shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)}
                 placeholder={t('Search...')}
                 className="bg-transparent border-none outline-none text-[12px] text-[rgba(255,255,255,0.8)] placeholder-[rgba(255,255,255,0.25)] w-32" />
          {search && <button onClick={() => setSearch('')} className="cursor-pointer text-[rgba(255,255,255,0.3)] hover:text-white"><X size={11} /></button>}
        </div>

        {/* Sort */}
        <SortDropdown
          value={sortBy}
          onChange={handleSortChange}
          options={SORTS}
          sortDir={sortDir}
          onSortDirChange={setSortDir}
        />

        <FranchiseFilter value={franchise} onChange={v => setFranchise(v || '')} />

        {/* Favorites toggle */}
        <button onClick={() => setFavOnly(!favOnly)}
                className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full cursor-pointer"
                style={{
                  background: favOnly ? 'color-mix(in srgb, var(--c-amber) 20%, transparent)' : 'rgba(255,255,255,0.05)',
                  color: favOnly ? 'var(--c-amber-text)' : 'rgba(255,255,255,0.45)',
                  border: `0.5px solid ${favOnly ? 'color-mix(in srgb, var(--c-amber) 40%, transparent)' : 'rgba(255,255,255,0.08)'}`,
                }}>
          <Star size={12} fill={favOnly ? 'var(--c-amber-text)' : 'none'} /> {t('Favorites')}
        </button>

        {hasActiveFilters && (
          <button onClick={resetFilters}
                  className="text-[12px] px-3 py-1.5 rounded-full cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.4)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
            {t('Reset')}
          </button>
        )}

        <button onClick={() => setShowModal(true)}
                className="flex items-center gap-1.5 text-[12px] font-medium px-4 py-2 rounded-full ml-auto cursor-pointer"
                style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 35%, transparent)' }}>
          <Plus size={13} /> {t('Add creator')}
        </button>
      </div>

      {/* Active filters summary */}
      {(search || typeFilter !== 'all' || franchise || favOnly) && (
        <div className="flex items-center gap-2 flex-wrap text-[12px] mb-3">
          <Filter size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
          {search && (
            <span className="px-2 py-0.5 rounded-full flex items-center gap-1"
                  style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' }}>
              "{search}" <button type="button" onClick={() => setSearch('')} className="cursor-pointer ml-0.5"><X size={10} /></button>
            </span>
          )}
          {typeFilter !== 'all' && (
            <span className="px-2 py-0.5 rounded-full flex items-center gap-1"
                  style={{ background: 'color-mix(in srgb, var(--c-accent) 15%, transparent)', color: 'var(--c-accent-text)' }}>
              {t(TYPE_LABELS[typeFilter] || typeFilter)} <button type="button" onClick={() => setTypeFilter('all')} className="cursor-pointer ml-0.5"><X size={10} /></button>
            </span>
          )}
          {franchise && (
            <span className="px-2 py-0.5 rounded-full flex items-center gap-1"
                  style={{ background: 'color-mix(in srgb, var(--c-accent) 15%, transparent)', color: 'var(--c-accent-text)' }}>
              {franchise} <button type="button" onClick={() => setFranchise('')} className="cursor-pointer ml-0.5"><X size={10} /></button>
            </span>
          )}
          {favOnly && (
            <span className="px-2 py-0.5 rounded-full flex items-center gap-1"
                  style={{ background: 'color-mix(in srgb, var(--c-amber) 15%, transparent)', color: 'var(--c-amber-text)' }}>
              {t('Favorites only')} <button type="button" onClick={() => setFavOnly(false)} className="cursor-pointer ml-0.5"><X size={10} /></button>
            </span>
          )}
        </div>
      )}

      {/* Controls row: type filter + per-page */}
      <div className="flex items-center gap-1.5 mb-5 flex-wrap">
        {TYPE_FILTER_LIST.map(ct => (
          <button key={ct} onClick={() => setTypeFilter(ct)}
                  className="text-[11px] px-3 py-1 rounded-full cursor-pointer capitalize"
                  style={{
                    background: typeFilter === ct ? 'color-mix(in srgb, var(--c-accent) 20%, transparent)' : 'rgba(255,255,255,0.04)',
                    color: typeFilter === ct ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.4)',
                    border: `0.5px solid ${typeFilter === ct ? 'color-mix(in srgb, var(--c-accent) 35%, transparent)' : 'rgba(255,255,255,0.07)'}`,
                  }}>
            {ct === 'all' ? t('All') : t(TYPE_LABELS[ct] || ct)}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-3">
          {/* Card size slider */}
          <div className="flex items-center gap-2">
            <LayoutGrid size={12} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
            <input
              type="range" min={160} max={345} step={5} value={cardSize}
              onChange={e => setCardSize(Number(e.target.value))}
              className="w-24 h-1 cursor-pointer accent-[var(--c-accent)]"
              title={`Card size: ${cardSize}px`}
            />
          </div>

          <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.1)' }} />

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[rgba(255,255,255,0.3)]">{t('Per page')}</span>
            {PER_PAGE_OPTIONS.map(n => (
              <button key={n} onClick={() => setPerPage(n)}
                      className="text-[11px] px-2.5 py-1 rounded-[6px] cursor-pointer"
                      style={{
                        background: perPage === n ? 'color-mix(in srgb, var(--c-accent) 25%, transparent)' : 'rgba(255,255,255,0.04)',
                        color: perPage === n ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.45)',
                        border: `0.5px solid ${perPage === n ? 'color-mix(in srgb, var(--c-accent) 40%, transparent)' : 'rgba(255,255,255,0.07)'}`,
                      }}>
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Pagination (top) */}
      {!isLoading && creators.length > 0 && totalPages > 1 && (
        <div className="mb-5">
          <GalleryPagination page={page} totalPages={totalPages} onChange={setPage} t={t} id="creators-top" />
        </div>
      )}

      {/* Grid */}
      {isLoading
        ? <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))` }}>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="rounded-[10px] overflow-hidden" style={{ border: '0.5px solid rgba(255,255,255,0.06)' }}>
                <div className="skeleton" style={{ height: cardSize * 1.1, borderRadius: 0 }} />
                <div className="p-2 flex flex-col gap-1.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <div className="skeleton" style={{ height: 14, width: '65%' }} />
                  <div className="skeleton" style={{ height: 11, width: '40%' }} />
                </div>
              </div>
            ))}
          </div>
        : creators.length === 0
          ? <div className="flex flex-col items-center justify-center py-24 gap-4">
              <div style={{ fontSize: 52, opacity: 0.12 }}>👤</div>
              <div className="text-[18px] font-medium" style={{ color: 'rgba(255,255,255,0.25)' }}>
                {hasActiveFilters ? t('No creators match these filters') : t('No creators yet')}
              </div>
              {hasActiveFilters ? (
                <button onClick={resetFilters}
                        className="flex items-center gap-2 text-[15px] font-medium px-5 py-2.5 rounded-full cursor-pointer mt-1"
                        style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                  {t('Reset filters')}
                </button>
              ) : (
                <button onClick={() => setShowModal(true)}
                        className="flex items-center gap-2 text-[15px] font-medium px-5 py-2.5 rounded-full cursor-pointer mt-1"
                        style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 35%, transparent)' }}>
                  <Plus size={15} /> {t('Add your first creator')}
                </button>
              )}
            </div>
          : <div className="grid gap-4 grid-stagger" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))` }}>
              {creators.map(c => (
                <CreatorCard key={c.id} creator={c} avatarBust={avatarBust} cardSize={cardSize}
                             onClick={() => navigate(`/creators/${c.id}`)}
                             onContextMenu={(cr, e) => setCreatorCtxMenu({ creator: cr, x: e.clientX, y: e.clientY })} />
              ))}
            </div>
      }

      {/* Pagination (bottom) */}
      {!isLoading && creators.length > 0 && totalPages > 1 && (
        <div className="mt-8">
          <GalleryPagination page={page} totalPages={totalPages} onChange={setPage} t={t} id="creators-bottom" />
        </div>
      )}

      <AnimatePresence>
        {showModal && (
          <AddCreatorModal
            onClose={() => setShowModal(false)}
            onSuccess={(creator) => { setShowModal(false); navigate(`/creators/${creator.id}`) }}
          />
        )}
      </AnimatePresence>

      {/* Creator right-click context menu */}
      {creatorCtxMenu && (
        <CreatorContextMenu
          creator={creatorCtxMenu.creator}
          position={{ x: creatorCtxMenu.x, y: creatorCtxMenu.y }}
          onClose={() => setCreatorCtxMenu(null)}
          onOpen={() => navigate(`/creators/${creatorCtxMenu.creator.id}`)}
          onToggleFav={async () => {
            try {
              await creatorsApi.update(creatorCtxMenu.creator.id, { is_favorite: !creatorCtxMenu.creator.is_favorite })
              qc.invalidateQueries({ queryKey: ['creators'] })
            } catch { toast.error(t('Could not update favourite')) }
          }}
          onDelete={async () => {
            try {
              await creatorsApi.delete(creatorCtxMenu.creator.id)
              toast.success(`${creatorCtxMenu.creator.name} deleted`)
              qc.invalidateQueries({ queryKey: ['creators'] })
            } catch { toast.error(t('Delete failed')) }
          }}
        />
      )}
    </div>
  )
}

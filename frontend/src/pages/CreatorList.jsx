import React, { useState, useEffect, useRef, useCallback } from 'react'
import { LocalizedText } from '../i18n'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Plus, Star, StarOff, X, User, Loader, CheckSquare, Square, Trash2, AlertCircle, RotateCcw } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { creatorsApi, galleriesApi, apiErrorMessage } from '../lib/api'
import CreatorContextMenu from '../components/CreatorContextMenu'
import { useVaultStore } from '../store/vault'
import toast from 'react-hot-toast'
import { FormDropdown } from '../components/FormDropdown'
import { COUNTRIES, countryIso } from '../lib/countries'
import { SortDropdown } from '../components/SortDropdown'
import BondHearts from '../components/BondHearts'
import FranchiseFilter from '../components/FranchiseFilter'
import PeriodFilter from '../components/PeriodFilter'
import ChipDropdown from '../components/filters/ChipDropdown'
import ViewModeDropdown from '../components/listViews/ViewModeDropdown'
import DetailsTable from '../components/listViews/DetailsTable'
import { CREATOR_VIEW_MODES, useListViewMode } from '../components/listViews/viewModes'
import GalleryPagination from '../components/GalleryPagination'
import { useT } from '../i18n'
import { creatorTypeColors, RARITY_COLORS } from '../lib/entityColors'

import ModalLayer from '../components/ModalLayer'
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

const TYPE_COLORS = creatorTypeColors(15, 25)


const RARITY_LABELS = {
  common:    'Snapshot',
  uncommon:  'Album · 500+',
  rare:      'Big Portfolio · 2.5K+',
  epic:      'Library · 6K+',
  legendary: 'Grand Collection · 15K+',
}

const TYPES = ['cosplayer', 'ethot', 'artist', 'character', 'actress', 'custom']


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

// Shared order with the Galleries, Photos and Videos sorts: common sorts
// first, creator-specific ones next, Random last.
const SORTS = [
  { value: 'date_added',    label: 'Date added' },
  { value: 'date_modified', label: 'Date modified' },
  { value: 'name',          label: 'Name' },
  { value: 'rating',        label: 'Rating' },
  { value: 'view_count',    label: 'Most viewed' },
  { value: 'cum_count',     label: 'Most cummed' },
  { value: 'edge_count',    label: 'Most edged' },
  { value: 'last_viewed',   label: 'Recently viewed' },
  { value: 'image_count',   label: 'Most photos' },
  { value: 'gallery_count', label: 'Most galleries' },
  { value: 'session_count', label: 'Most sessions' },
  { value: 'bond_level',    label: 'Bond level' },
  { value: 'age',           label: 'Age' },
  { value: 'origin',        label: 'Origin' },
  { value: 'rarity',        label: 'Collection size' },
  { value: 'random',        label: 'Random' },
]

const PER_PAGE_OPTIONS = [25, 50, 100, 250]

// ── Creator card — vertical portrait ─────────────────────────────────────────
// React.memo: prevents grid from re-rendering all 50 cards when parent state
// changes (search input, sort, modal open, etc.)
const CreatorCard = React.memo(function CreatorCard({ creator, onClick, onContextMenu, avatarBust, cardSize = 345, bulkMode = false, selected = false, onSelect }) {
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
    <div onClick={(e) => (bulkMode ? onSelect(creator.id, e) : onClick())}
         onContextMenu={(e) => { e.preventDefault(); onContextMenu?.(creator, e) }}
         className="rounded-[12px] overflow-hidden cursor-pointer group relative"
         style={{ background: tc.bg, border: `0.5px solid ${rc}44`, aspectRatio: '2/3' }}>

      {selected && (
        <div className="media-selection-overlay absolute inset-0 pointer-events-none rounded-[12px]"
             style={{ zIndex: 5, border: '2px solid var(--c-accent)', background: 'color-mix(in srgb, var(--c-accent) 15%, transparent)' }} />
      )}

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
      {bulkMode && (
        <div className="absolute top-2.5 left-2.5" style={{ zIndex: 11 }}>
          {selected
            ? <CheckSquare size={18} style={{ color: 'var(--c-accent)' }} />
            : <Square size={18} style={{ color: 'rgba(255,255,255,0.6)', fill: 'rgba(0,0,0,0.4)' }} />}
        </div>
      )}
      {!bulkMode && <div ref={ratingRef} className="absolute top-2.5 left-2.5" style={{ zIndex: 10 }}>
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
      </div>}

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
            <span className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{age}<LocalizedText text={"y"} /></span>
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
  prev.cardSize   === next.cardSize   &&
  prev.bulkMode   === next.bulkMode   &&
  prev.selected   === next.selected
)
// ── Unified anime + game character search ────────────────────────────────────
function CharacterSearch({ onSelect }) {
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
        const r = await creatorsApi.characterSearch(query.trim())
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
      const r = await creatorsApi.characterDetail(picked.provider, picked.external_id)
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
        <span className="text-[18px]">⚡</span> {t('Find a character')}
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
              {picked.source_label && <span className="text-[16px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' }}>{picked.source_label}</span>}
              {picked.gender    && <span className="text-[16px] px-2 py-0.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--c-pink) 20%, transparent)', color: 'var(--c-pink-text)' }}>{picked.gender}</span>}
              {picked.height_cm && <span className="text-[16px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' }}>{picked.height_cm}<LocalizedText text={"cm"} before=" " /></span>}
              {picked.age       && <span className="text-[16px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' }}>{t('Age')} {picked.age}</span>}
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
              placeholder={t('Search anime or game character…')}
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
            <div className="mt-2 text-[16px] px-3 py-2 rounded-[8px]"
                 style={{ background: 'color-mix(in srgb, var(--c-amber) 10%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 30%, transparent)', color: 'var(--c-amber-text)' }}>
              {t('Character search is unavailable right now — try again in a moment.')}
            </div>
          )}

          {results.length > 0 && (
            <div className="mt-2.5 flex flex-col gap-1.5 max-h-60 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
              {results.map(char => (
                <button key={`${char.provider}:${char.external_id}`} onClick={() => handlePick(char)}
                        className="flex items-center gap-3.5 px-3 py-2.5 rounded-[8px] cursor-pointer text-left hover:bg-[rgba(255,255,255,0.06)] transition-colors">
                  {char.image_url && (
                    <img src={char.image_url} alt="" className="rounded-[4px] object-cover flex-shrink-0"
                         style={{ width: 48, height: 68 }} onError={e => { e.target.style.display = 'none' }} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-[18px] font-medium text-white truncate">{char.name}</div>
                    {char.name_kanji && (
                      <div className="text-[16px] truncate mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>{char.name_kanji}</div>
                    )}
                    {char.series?.[0] && (
                      <div className="text-[16px] truncate mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>{char.series[0]}</div>
                    )}
                    <div className="flex gap-1.5 mt-1 flex-wrap">
                      <span className="text-[16px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' }}>{char.source_label}</span>
                      {char.gender    && <span className="text-[16px] px-2 py-0.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--c-pink) 20%, transparent)', color: 'var(--c-pink-text)' }}>{char.gender}</span>}
                      {char.height_cm && <span className="text-[16px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' }}>{char.height_cm}<LocalizedText text={"cm"} before=" " /></span>}
                      {char.age       && <span className="text-[16px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' }}>{t('Age')} {char.age}</span>}
                    </div>
                  </div>
                  {char.favorites > 0 && (
                    <div className="text-[16px] flex-shrink-0 font-medium" style={{ color: 'rgba(255,255,255,0.3)' }}>
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
      toast.success(t('{name} added! +50 XP', { name: data.name }))
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

  const fillFromCharacterSearch = (char) => {
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
    <ModalLayer><motion.div
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

        {/* Unified character import — character type only */}
        {form.creator_type === 'character' && (
          <CharacterSearch onSelect={fillFromCharacterSearch} />
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
              { label: 'Body measurements', key: 'body_measurements', placeholder: '91-61-91' },
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
    </motion.div></ModalLayer>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
const CL_STATE_KEY = 'vault_creator_list_state'

// Same labels as the Types filter on Galleries, Photos and Videos.
const TYPE_FILTER_OPTIONS = [
  { value: '',          label: 'All types' },
  { value: 'cosplayer', label: 'Cosplayer' },
  { value: 'ethot',     label: 'E-girl' },
  { value: 'artist',    label: 'Artist' },
  { value: 'character', label: 'Character' },
  { value: 'actress',   label: 'Actress' },
  { value: 'custom',    label: 'Model / Other' },
].map(o => ({ ...o, dot: o.value ? TYPE_COLORS[o.value]?.text : undefined }))

const STATUS_FILTER_OPTIONS = [
  { value: '',        label: 'Status' },
  { value: 'Active',  label: 'Active' },
  { value: 'Hiatus',  label: 'Hiatus' },
  { value: 'Retired', label: 'Retired' },
]

const flag = (country) => {
  const iso = countryIso(country)
  return iso ? <span className={`fi fi-${iso} flex-shrink-0`} style={{ width: 16, height: 12, borderRadius: 2, display: 'inline-block' }} /> : null
}

function formatListDate(value, locale) {
  if (!value) return '—'
  const text = typeof value === 'string' && !/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? `${value}Z` : value
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Age shown in lists: a birth date gives years, a plain number (characters)
// is the age itself.
function listAge(dob) {
  if (dob && /^\d{1,3}$/.test(String(dob).trim())) return parseInt(dob, 10)
  return calcAge(dob)
}

function CreatorAvatar({ creator, avatarBust, size, round = false }) {
  const [failed, setFailed] = useState(false)
  const tc = TYPE_COLORS[creator.creator_type] || TYPE_COLORS.custom
  const bust = new Date(creator.updated_at || 0).getTime()
  const url = creator.avatar_path && !failed ? `/api/creators/${creator.id}/avatar-thumb?size=256&v=${bust}_${avatarBust}` : null
  const initials = creator.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className={`${round ? 'rounded-full' : 'rounded-[6px]'} overflow-hidden flex-shrink-0 flex items-center justify-center`}
         style={{ width: size, height: size, background: tc.bg }}>
      {url
        ? <img src={url} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" onError={() => setFailed(true)} />
        : <span className="font-semibold select-none" style={{ fontSize: Math.round(size * 0.36), color: tc.text, opacity: 0.6 }}>{initials}</span>}
    </div>
  )
}

// Compact view: small round avatar, name, type and a few numbers per row.
const CreatorCompactItem = React.memo(function CreatorCompactItem({ creator, avatarBust, bulkMode, selected, onClick, onSelect, onContextMenu }) {
  const t = useT()
  const tc = TYPE_COLORS[creator.creator_type] || TYPE_COLORS.custom
  return (
    <div onClick={e => (bulkMode ? onSelect(creator.id, e) : onClick(creator))}
         onContextMenu={e => { e.preventDefault(); onContextMenu?.(creator, e) }}
         className="vault-card relative flex items-center gap-3 p-2.5 pr-3 cursor-pointer group animate-fade-in"
         style={selected ? { outline: '1.5px solid var(--c-accent)', background: 'color-mix(in srgb, var(--c-accent) 10%, transparent)' } : undefined}>
      {bulkMode && (
        <div className="flex-shrink-0">
          {selected ? <CheckSquare size={15} style={{ color: 'var(--c-accent)' }} /> : <Square size={15} style={{ color: 'rgba(255,255,255,0.4)' }} />}
        </div>
      )}
      <CreatorAvatar creator={creator} avatarBust={avatarBust} size={48} round />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[15px] font-medium truncate" style={{ color: 'rgba(255,255,255,0.9)' }}>{creator.title || creator.name}</span>
          {flag(creator.country)}
          {creator.is_favorite && <Star size={11} style={{ color: '#EF9F27', flexShrink: 0 }} fill="#EF9F27" />}
        </div>
        <div className="flex items-center gap-2 text-[12px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
          <span className="px-1.5 rounded-full" style={{ background: tc.bg, color: tc.text }}>{t(TYPE_LABELS[creator.creator_type] || creator.creator_type)}</span>
          <span>{(creator.image_count ?? 0).toLocaleString()} {t('photos')}</span>
          {creator.rating > 0 && <span style={{ color: '#EF9F27' }}>★ {creator.rating % 1 === 0 ? creator.rating.toFixed(0) : creator.rating.toFixed(1)}</span>}
        </div>
      </div>
    </div>
  )
})

function ConfirmDeleteCreators({ creators, busy, onConfirm, onCancel }) {
  const t = useT()
  const one = creators.length === 1
  return (
    <ModalLayer><div className="fixed inset-0 z-[80] flex items-center justify-center animate-fade-in" style={{ background: 'rgba(0,0,0,0.7)' }}
         onMouseDown={e => { if (e.target === e.currentTarget && !busy) onCancel() }}>
      <div className="rounded-[14px] p-5 w-[380px] animate-modal-pop shadow-2xl" style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.15)' }}>
        <div className="flex items-center gap-2 text-[16px] font-medium mb-2" style={{ color: 'rgba(255,255,255,0.9)' }}>
          <Trash2 size={15} style={{ color: '#F09595' }} />
          {one ? t('Delete {name}?', { name: creators[0].name }) : t('Delete {count} creators?', { count: creators.length })}
        </div>
        <div className="text-[13px] leading-5 mb-5" style={{ color: 'rgba(255,255,255,0.5)' }}>
          {t('Their galleries, files, cards, and history stay in the vault, just without this creator. This cannot be undone.')}
        </div>
        <div className="flex gap-2 justify-end">
          <button type="button" disabled={busy} onMouseDown={onCancel}
                  className="px-4 py-2 rounded-[8px] text-[13px] cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
            {t('Cancel')}
          </button>
          <button type="button" disabled={busy} onMouseDown={onConfirm}
                  className="px-4 py-2 rounded-[8px] text-[13px] font-medium cursor-pointer flex items-center gap-1.5"
                  style={{ background: 'color-mix(in srgb, var(--c-red, #E24B4A) 25%, transparent)', color: '#F7C1C1', border: '0.5px solid color-mix(in srgb, var(--c-red, #E24B4A) 45%, transparent)' }}>
            {busy ? <Loader size={13} className="animate-spin" /> : <Trash2 size={13} />}
            {one ? t('Delete creator') : t('Delete {count} creators', { count: creators.length })}
          </button>
        </div>
      </div>
    </div></ModalLayer>
  )
}

// Select-mode actions for the chosen creators.
function CreatorBulkBar({ selectedCreators, onDelete, onDone }) {
  const t = useT()
  const [franchise, setFranchise] = useState('')
  const [busy, setBusy] = useState(false)
  const n = selectedCreators.length

  // One request for the whole selection, so the list refreshes once.
  const apply = async (patch, message) => {
    setBusy(true)
    try {
      await creatorsApi.bulkUpdate(selectedCreators.map(c => c.id), patch)
      toast.success(message)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('Update failed')))
    } finally {
      setBusy(false)
    }
  }
  const chip = (onPress, children, tone) => (
    <button type="button" disabled={busy || !n} onMouseDown={onPress}
            className="flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-full cursor-pointer"
            style={tone === 'danger'
              ? { background: 'color-mix(in srgb, var(--c-red, #E24B4A) 15%, transparent)', color: '#F7C1C1', border: '0.5px solid color-mix(in srgb, var(--c-red, #E24B4A) 35%, transparent)' }
              : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.65)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
      {children}
    </button>
  )

  return (
    <>
      <span className="text-[13px]" style={{ color: 'var(--c-accent-text)' }}>{t('{count} selected', { count: n })}</span>
      {chip(() => apply({ is_favorite: true }, t('Added to favorites')), <><Star size={12} /> {t('Favorite')}</>)}
      {chip(() => apply({ is_favorite: false }, t('Removed from favorites')), <><StarOff size={12} /> {t('Unfavorite')}</>)}
      <ChipDropdown value="" options={[{ value: '', label: 'Set type' }, ...TYPE_FILTER_OPTIONS.slice(1)]}
                    onChange={v => v && apply({ creator_type: v }, t('Type updated'))} />
      <div className="vault-row-control flex items-center gap-1 pl-3 pr-1 py-0.5 rounded-full"
           style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
        <input value={franchise} onChange={e => setFranchise(e.target.value)} placeholder={t('Franchise')}
               onKeyDown={e => { if (e.key === 'Enter' && franchise.trim()) apply({ series: franchise.trim() }, t('Franchise updated')) }}
               className="bg-transparent border-none outline-none text-[13px] w-28" style={{ color: 'rgba(255,255,255,0.8)' }} />
        <button type="button" disabled={busy || !franchise.trim()}
                onMouseDown={() => apply({ series: franchise.trim() }, t('Franchise updated'))}
                className="text-[12px] px-2.5 py-1 rounded-full cursor-pointer"
                style={{ background: 'color-mix(in srgb, var(--c-accent) 18%, transparent)', color: 'var(--c-accent-text)' }}>
          {t('Set')}
        </button>
      </div>
      {chip(onDelete, <><Trash2 size={12} /> {t('Delete')}</>, 'danger')}
      {busy && <Loader size={13} className="animate-spin" style={{ color: 'rgba(255,255,255,0.4)' }} />}
      <button type="button" onMouseDown={onDone} className="text-[13px] cursor-pointer" style={{ color: 'rgba(255,255,255,0.4)' }}>{t('Done')}</button>
    </>
  )
}

function CreatorListView({ mode, creators, cardSize, avatarBust, bulkMode, selected, onSelect, onOpen, onContextMenu, sortBy, sortDir, onSort, onSortDir }) {
  const t = useT()
  const locale = useVaultStore(s => s.locale)

  if (mode === 'details') {
    const columns = [
      { key: 'name', label: 'Name', sort: 'name', primary: true, render: c => <span title={c.name}>{c.title || c.name}</span> },
      { key: 'type', label: 'Type', render: c => t(TYPE_LABELS[c.creator_type] || c.creator_type) },
      { key: 'franchise', label: 'Franchise', render: c => <span title={c.series || ''}>{c.series || '—'}</span> },
      { key: 'country', label: 'Country', render: c => (c.country ? <span className="inline-flex items-center gap-1.5">{flag(c.country)}{c.country}</span> : '—') },
      { key: 'age', label: 'Age', sort: 'age', align: 'right', render: c => listAge(c.date_of_birth) ?? '—' },
      { key: 'photos', label: 'Photos', sort: 'image_count', align: 'right', render: c => (c.image_count ?? 0).toLocaleString() },
      { key: 'sessions', label: 'Sessions', sort: 'session_count', align: 'right', render: c => c.session_count ?? 0 },
      { key: 'views', label: 'Views', sort: 'view_count', align: 'right', render: c => (c.total_views ?? 0).toLocaleString() },
      { key: 'rating', label: 'Rating', sort: 'rating', align: 'right', render: c => (c.rating > 0 ? <span style={{ color: '#EF9F27' }}>★ {c.rating}</span> : '—') },
      { key: 'bond', label: 'Bond', sort: 'bond_level', align: 'right', render: c => (c.bond_excluded ? '—' : `${c.bond_level ?? 0}/5`) },
      { key: 'seen', label: 'Last viewed', sort: 'last_viewed', align: 'right', render: c => formatListDate(c.last_viewed_at, locale) },
      { key: 'added', label: 'Added', sort: 'date_added', align: 'right', render: c => formatListDate(c.created_at, locale) },
    ]
    return (
      <DetailsTable rows={creators} columns={columns}
                    thumb={c => <CreatorAvatar creator={c} avatarBust={avatarBust} size={40} />}
                    thumbWidth={40}
                    sortBy={sortBy} sortDir={sortDir} onSort={onSort} onSortDir={onSortDir}
                    onRowClick={c => onOpen(c)} onContextMenu={onContextMenu}
                    bulkMode={bulkMode} selected={selected} onSelect={onSelect} />
    )
  }
  if (mode === 'avatars') {
    return (
      <div className="grid gap-2 grid-stagger" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {creators.map(c => (
          <CreatorCompactItem key={c.id} creator={c} avatarBust={avatarBust} bulkMode={bulkMode} selected={selected.has(c.id)}
                              onClick={onOpen} onSelect={onSelect} onContextMenu={onContextMenu} />
        ))}
      </div>
    )
  }
  return (
    <div className="grid gap-4 grid-stagger" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))` }}>
      {creators.map(c => (
        <CreatorCard key={c.id} creator={c} avatarBust={avatarBust} cardSize={cardSize}
                     bulkMode={bulkMode} selected={selected.has(c.id)} onSelect={onSelect}
                     onClick={() => onOpen(c)} onContextMenu={onContextMenu} />
      ))}
    </div>
  )
}

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
  const search      = searchParams.get('q') || ''
  const typeFilter  = searchParams.get('ctype') || ''
  const sortBy      = searchParams.get('sort') || 'name'
  const sortDir     = searchParams.get('dir') || (['name', 'age', 'origin'].includes(sortBy) ? 'asc' : 'desc')
  const franchise   = searchParams.get('franchise') || ''
  const favOnly     = searchParams.get('fav') === '1'
  const country     = searchParams.get('country') || ''
  const status      = searchParams.get('status') || ''
  const period      = searchParams.get('period') || ''
  const unratedOnly = searchParams.get('unrated') === '1'
  const incompleteOnly = searchParams.get('incomplete') === '1'
  const page        = parseInt(searchParams.get('page') || '1', 10) || 1

  // Page size: localStorage (not URL) so it can't get stuck via sessionStorage restore
  const [perPage, setPerPageState] = useState(() => {
    try { return parseInt(localStorage.getItem('vault_creator_page_size') || '50', 10) } catch { return 50 }
  })
  const [viewMode, setViewMode] = useListViewMode('vault_view_creators', CREATOR_VIEW_MODES, 'portrait')

  const [showModal, setShowModal] = useState(false)
  const [creatorCtxMenu, setCreatorCtxMenu] = useState(null) // { creator, x, y, bulk }
  const [bulkMode, setBulkMode] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [deleting, setDeleting] = useState(null) // creators awaiting delete confirmation
  const [deleteBusy, setDeleteBusy] = useState(false)
  const lastSelectedIdRef = useRef(null)

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

  const setFilter = useCallback((key, v) => setParams({ [key]: v || null, page: null }), [setParams])
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
  // Name, Age and Origin start ascending (A–Z, youngest first); everything else highest first.
  const handleSortChange = useCallback((val) => {
    setParams({ sort: val !== 'name' ? val : null, dir: val === 'name' ? null : (val === 'age' || val === 'origin') ? 'asc' : 'desc', page: null })
  }, [setParams])

  const filtersOn = search || typeFilter || franchise || favOnly || country || status || period || unratedOnly || incompleteOnly
  const hasActiveFilters = filtersOn || sortBy !== 'name'
  const resetFilters = useCallback(() => setSearchParams({}, { replace: true }), [setSearchParams])

  const skip = (page - 1) * perPage
  const filterKey = `${search}|${typeFilter}|${sortBy}|${sortDir}|${franchise}|${favOnly}|${country}|${status}|${period}|${unratedOnly}|${incompleteOnly}`

  const { data: creatorPage, isLoading } = useQuery({
    queryKey: ['creators', filterKey, page, perPage],
    // avatarBust intentionally excluded — avatar images have their own cache-busting
    // in the URL (v=${updated_at}_${avatarBust}). Including it here caused the ENTIRE
    // creators list to re-fetch from the server whenever any avatar changed.
    queryFn: () => creatorsApi.list({
      search: search || undefined,
      creator_type: typeFilter || undefined,
      series: franchise || undefined,
      favorite: favOnly || undefined,
      country: country || undefined,
      status: status || undefined,
      period: period || undefined,
      unrated: unratedOnly || undefined,
      incomplete: incompleteOnly || undefined,
      sort_by: sortBy,
      sort_dir: sortBy !== 'random' ? sortDir : undefined,
      skip,
      limit: perPage,
    }).then(r => ({
      items: r.data,
      total: parseInt(r.headers['x-total-count'] ?? '0', 10),
    })),
    placeholderData: keepPreviousData,
  })
  const { data: countries = [] } = useQuery({
    queryKey: ['creator-countries'],
    queryFn: () => creatorsApi.countries().then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })
  const { data: periods = [] } = useQuery({
    queryKey: ['gallery-periods', 'creators'],
    queryFn: () => galleriesApi.periods({}).then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })

  const creators   = creatorPage?.items ?? []
  const totalCount = creatorPage?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage))
  const selectedCreators = creators.filter(c => selected.has(c.id))

  // If a filter shrank the list below the current page, go to the real last page.
  useEffect(() => {
    if (!isLoading && totalCount > 0 && page > totalPages) setPage(totalPages)
  }, [isLoading, totalCount, totalPages, page, setPage])

  const countryOptions = [
    { value: '', label: 'Country' },
    ...countries.map(c => ({ value: c.country, label: c.country, raw: true, count: c.count, icon: flag(c.country) })),
  ]

  // Shift-click selects the range from the last clicked creator. The anchor
  // is read before the state update (see GalleryList's toggleSelect).
  const creatorsRef = useRef(creators)
  creatorsRef.current = creators
  const toggleSelect = useCallback((id, event) => {
    const anchor = lastSelectedIdRef.current
    const shift = !!event?.shiftKey
    setSelected(prev => {
      const next = new Set(prev)
      const ids = creatorsRef.current.map(c => c.id)
      const a = ids.indexOf(anchor), b = ids.indexOf(id)
      if (shift && anchor !== null && a !== -1 && b !== -1) {
        const add = !prev.has(id)
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) add ? next.add(ids[i]) : next.delete(ids[i])
      } else if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    lastSelectedIdRef.current = id
  }, [])
  const exitBulk = () => { setBulkMode(false); setSelected(new Set()); lastSelectedIdRef.current = null }
  // Actions apply to creators on screen, so a new filter or page starts a
  // fresh selection instead of keeping hidden ones.
  useEffect(() => { setSelected(new Set()); lastSelectedIdRef.current = null }, [filterKey, page, perPage])
  const selectAll = () => {
    setSelected(prev => {
      const all = creators.every(c => prev.has(c.id))
      const next = new Set(prev)
      for (const c of creators) all ? next.delete(c.id) : next.add(c.id)
      return next
    })
  }
  const openCreator = useCallback(c => navigate(`/creators/${c.id}`), [navigate])
  const openMenu = useCallback((creator, e) => setCreatorCtxMenu({ creator, x: e.clientX, y: e.clientY }), [])

  const confirmDelete = async () => {
    setDeleteBusy(true)
    try {
      if (deleting.length === 1) {
        await creatorsApi.delete(deleting[0].id)
        toast.success(t('{name} deleted', { name: deleting[0].name }))
      } else {
        const { data } = await creatorsApi.bulkDelete(deleting.map(c => c.id))
        toast.success(t('{count} creators deleted', { count: data.deleted }))
      }
      setSelected(prev => { const next = new Set(prev); deleting.forEach(c => next.delete(c.id)); return next })
      setDeleting(null)
      qc.invalidateQueries({ queryKey: ['creator-countries'] })
    } catch (err) {
      toast.error(apiErrorMessage(err, t('Delete failed')))
    } finally {
      setDeleteBusy(false)
    }
  }

  const toggleChip = (active, onPress, children, tone = 'accent') => (
    <button type="button" onMouseDown={onPress}
            className="flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-full cursor-pointer"
            style={{
              background: active ? `color-mix(in srgb, var(--c-${tone}) 20%, transparent)` : 'rgba(255,255,255,0.05)',
              color: active ? `var(--c-${tone}-text)` : 'rgba(255,255,255,0.45)',
              border: `0.5px solid ${active ? `color-mix(in srgb, var(--c-${tone}) 40%, transparent)` : 'rgba(255,255,255,0.08)'}`,
            }}>
      {children}
    </button>
  )

  return (
    <div className="vault-theme-creators-page p-5 pb-16 flex flex-col gap-4">
      {/* Header + controls — same order as the Galleries, Photos and Videos toolbars */}
      <div className="vault-control-row vault-filter-toolbar flex items-center gap-2 flex-wrap">
        <div className="text-[19px] font-medium text-[rgba(255,255,255,0.9)] mr-1">{t('Creators')}</div>

        {/* Search takes what's left instead of a fixed share, so the whole
            toolbar fits on one line at 1920px. */}
        <div className="vault-row-control flex items-center gap-2 px-3 py-1.5 rounded-full min-w-[120px] max-w-[300px]"
             style={{ flex: '1 1 130px', background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
          <Search size={13} className="text-[rgba(255,255,255,0.3)] flex-shrink-0" />
          <input value={search} onChange={e => setFilter('q', e.target.value)}
                 placeholder={t('Search names, titles, aliases…')}
                 className="bg-transparent border-none outline-none text-[14px] text-[rgba(255,255,255,0.8)] placeholder-[rgba(255,255,255,0.25)] w-full" />
          {search && (
            <button type="button" onMouseDown={() => setFilter('q', '')} className="cursor-pointer text-[rgba(255,255,255,0.3)] hover:text-white">
              <X size={12} />
            </button>
          )}
        </div>

        <SortDropdown value={sortBy} onChange={handleSortChange} options={SORTS} sortDir={sortDir} onSortDirChange={setSortDir} />

        <ViewModeDropdown value={viewMode} onChange={setViewMode} modes={CREATOR_VIEW_MODES} />

        <ChipDropdown value={typeFilter} onChange={v => setFilter('ctype', v)} options={TYPE_FILTER_OPTIONS} />

        <FranchiseFilter value={franchise} onChange={v => setFilter('franchise', v)} />

        <PeriodFilter value={period} periods={periods} onChange={v => setFilter('period', v)} />

        <ChipDropdown value={country} onChange={v => setFilter('country', v)} options={countryOptions} searchable />

        <ChipDropdown value={status} onChange={v => setFilter('status', v)} options={STATUS_FILTER_OPTIONS} />

        {toggleChip(favOnly, () => setFilter('fav', favOnly ? null : '1'), <><Star size={11} /> {t('Favorites')}</>, 'amber')}
        {toggleChip(unratedOnly, () => setFilter('unrated', unratedOnly ? null : '1'), <><StarOff size={11} /> {t('Unrated')}</>, 'amber')}
        <span title={t('No avatar, a character without a franchise, or a person without a country')}>
          {toggleChip(incompleteOnly, () => setFilter('incomplete', incompleteOnly ? null : '1'), <><AlertCircle size={11} /> {t('Incomplete')}</>, 'amber')}
        </span>

        {hasActiveFilters && (
          <button type="button" onMouseDown={resetFilters} title={t('Reset')} aria-label={t('Reset')}
                  className="flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-full cursor-pointer transition-colors"
                  style={{ background: 'color-mix(in srgb, var(--c-pink) 12%, transparent)', color: '#F4C0D1', border: '0.5px solid color-mix(in srgb, var(--c-pink) 30%, transparent)' }}>
            <RotateCcw size={13} /> <span className="hidden min-[2000px]:inline">{t('Reset')}</span>
          </button>
        )}

        <button type="button" onMouseDown={() => (bulkMode ? exitBulk() : setBulkMode(true))}
                title={t('Select')} aria-label={t('Select')}
                className="flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-full cursor-pointer ml-auto"
                style={{
                  background: bulkMode ? 'color-mix(in srgb, var(--c-accent) 20%, transparent)' : 'rgba(255,255,255,0.05)',
                  color: bulkMode ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.45)',
                  border: `0.5px solid ${bulkMode ? 'color-mix(in srgb, var(--c-accent) 40%, transparent)' : 'rgba(255,255,255,0.08)'}`,
                }}>
          <CheckSquare size={13} /> <span className="hidden min-[2000px]:inline">{t('Select')}</span>
        </button>
        <button type="button" onMouseDown={() => setShowModal(true)} title={t('Add creator')} aria-label={t('Add creator')}
                className="flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-full cursor-pointer"
                style={{ background: 'color-mix(in srgb, var(--c-accent) 15%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
          <Plus size={13} /> <span className="hidden min-[2000px]:inline">{t('New')}</span>
        </button>
      </div>

      {/* Size controls */}
      <div className="flex items-center gap-3 flex-wrap">
        {viewMode === 'portrait' && (
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[rgba(255,255,255,0.3)]">{t('Size')}</span>
            <input type="range" min={160} max={345} step={5} value={cardSize}
                   onChange={e => setCardSize(Number(e.target.value))}
                   className="w-24 h-1 cursor-pointer accent-[var(--c-accent)]" />
            <span className="text-[12px] text-[rgba(255,255,255,0.3)] w-8">{cardSize}</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <span className="text-[12px] text-[rgba(255,255,255,0.3)] mr-1">{t('Per page')}</span>
          {PER_PAGE_OPTIONS.map(n => (
            <button key={n} type="button" onMouseDown={() => setPerPage(n)}
                    className="text-[12px] px-2 py-0.5 rounded-full cursor-pointer"
                    style={{
                      background: perPage === n ? 'color-mix(in srgb, var(--c-accent) 20%, transparent)' : 'rgba(255,255,255,0.04)',
                      color: perPage === n ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.4)',
                      border: `0.5px solid ${perPage === n ? 'color-mix(in srgb, var(--c-accent) 35%, transparent)' : 'rgba(255,255,255,0.07)'}`,
                    }}>
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk action bar */}
      {bulkMode && (
        <div className="flex items-center gap-2 flex-wrap relative" style={{ zIndex: 40 }}>
          <button type="button" onMouseDown={selectAll}
                  className="text-[13px] px-3 py-1.5 rounded-full cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
            {(creators.length > 0 && creators.every(c => selected.has(c.id))) ? t('Deselect all') : t('Select all')}
          </button>
          {selected.size > 0 && (
            <CreatorBulkBar selectedCreators={selectedCreators}
                            onDelete={() => setDeleting(selectedCreators)} onDone={exitBulk} />
          )}
        </div>
      )}

      {!isLoading && creators.length > 0 && totalPages > 1 && (
        <GalleryPagination page={page} totalPages={totalPages} onChange={setPage} t={t} id="creators-top" />
      )}

      {!isLoading && creators.length > 0 && (
        <div className="text-[13px] text-[rgba(255,255,255,0.3)] -mb-2">
          {t('{start}–{end} shown of {total} · page {page} of {pages}', { start: skip + 1, end: skip + creators.length, total: totalCount, page, pages: totalPages })}
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
                {filtersOn ? t('No creators match these filters') : t('No creators yet')}
              </div>
              {filtersOn ? (
                <button type="button" onMouseDown={resetFilters}
                        className="flex items-center gap-2 text-[15px] font-medium px-5 py-2.5 rounded-full cursor-pointer mt-1"
                        style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                  {t('Reset filters')}
                </button>
              ) : (
                <button type="button" onMouseDown={() => setShowModal(true)}
                        className="flex items-center gap-2 text-[15px] font-medium px-5 py-2.5 rounded-full cursor-pointer mt-1"
                        style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 35%, transparent)' }}>
                  <Plus size={15} /> {t('Add your first creator')}
                </button>
              )}
            </div>
          : <CreatorListView
              mode={viewMode} creators={creators} cardSize={cardSize} avatarBust={avatarBust}
              bulkMode={bulkMode} selected={selected} onSelect={toggleSelect}
              onOpen={openCreator} onContextMenu={openMenu}
              sortBy={sortBy} sortDir={sortDir} onSort={handleSortChange} onSortDir={setSortDir}
            />
      }

      {/* Pagination (bottom) */}
      {!isLoading && creators.length > 0 && totalPages > 1 && (
        <div className="mt-4">
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

      {deleting && (
        <ConfirmDeleteCreators creators={deleting} busy={deleteBusy}
                               onConfirm={confirmDelete} onCancel={() => setDeleting(null)} />
      )}

      {/* Creator right-click context menu. In Select mode, right-clicking a
          selected creator acts on the whole selection for Delete. */}
      {creatorCtxMenu && (
        <CreatorContextMenu
          creator={creatorCtxMenu.creator}
          position={{ x: creatorCtxMenu.x, y: creatorCtxMenu.y }}
          onClose={() => setCreatorCtxMenu(null)}
          onOpen={() => openCreator(creatorCtxMenu.creator)}
          onToggleFav={async () => {
            try {
              await creatorsApi.update(creatorCtxMenu.creator.id, { is_favorite: !creatorCtxMenu.creator.is_favorite })
              qc.invalidateQueries({ queryKey: ['creators'] })
            } catch { toast.error(t('Could not update favourite')) }
          }}
          onDelete={() => setDeleting(
            bulkMode && selected.has(creatorCtxMenu.creator.id) ? selectedCreators : [creatorCtxMenu.creator])}
        />
      )}
    </div>
  )
}

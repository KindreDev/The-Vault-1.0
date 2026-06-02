import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Star, Droplets, Clock, Shuffle, Dice6, Target, CheckCircle2, Circle,
  Plus, Images, Eye, User, HardDrive, Video, Trophy, Flame, X, Play,
  BarChart2, Calendar, Tag as TagIcon, Hash, Activity, Zap, Info, PlayCircle, StarHalf,
  ChevronDown, Heart,
} from 'lucide-react'
import { galleriesApi, creatorsApi, gamiApi, sessionsApi, imagesApi, economyApi, playlistsApi, tagsApi } from '../lib/api'
import { useVaultStore } from '../store/vault'
import RandomMixModal from '../components/RandomMixModal'
import { useCountUp } from '../hooks/useCountUp'
import { useScrollReveal } from '../hooks/useScrollReveal'
import toast from 'react-hot-toast'

// ── Animated numeric stat value ───────────────────────────────────────────────
// Counts up from 0 when the target value first arrives (data load).
// Falls back to raw display for non-numeric or string values.
function AnimatedStatValue({ value, color }) {
  const raw    = String(value ?? '')
  const parsed = Number(raw.replace(/,/g, ''))
  const isNum  = !isNaN(parsed) && raw !== '' && /^[\d,. ]+$/.test(raw.trim())
  const count  = useCountUp(isNum ? parsed : 0, 1000, isNum)
  return (
    <span style={{ color }}>
      {isNum ? count.toLocaleString() : value}
    </span>
  )
}

function fmtMs(ms) {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return '<1m'
}

function timeAgo(ts) {
  // Backend returns naive UTC strings without 'Z' — append it so the browser parses correctly
  const normalized = ts && !String(ts).endsWith('Z') && !String(ts).includes('+') ? ts + 'Z' : ts
  const diff = Date.now() - new Date(normalized).getTime()
  const d = Math.floor(diff / 86400000)
  const h = Math.floor(diff / 3600000)
  const m = Math.floor(diff / 60000)
  if (d > 1) return `${d}d ago`
  if (d === 1) return 'Yesterday'
  if (h >= 1) return `${h}h ago`
  if (m >= 1) return `${m}m ago`
  return 'Just now'
}

const TYPE_COLORS = {
  cosplayer: { bg: 'rgba(29,158,117,0.2)',  text: '#9FE1CB' },
  ethot:     { bg: 'rgba(212,83,126,0.2)',  text: '#ED93B1' },
  artist:    { bg: 'rgba(127,119,221,0.2)', text: '#CECBF6' },
  character: { bg: 'rgba(186,117,23,0.2)',  text: '#FAC775' },
  actress:   { bg: 'rgba(212,83,126,0.2)',  text: '#ED93B1' },
  custom:    { bg: 'rgba(136,135,128,0.2)', text: '#D3D1C7' },
}

// ── Favorite creator card (big circle, no container) ─────────────────────────
function FavCreatorCard({ creator, onClick, avatarBust }) {
  const [imgFailed, setImgFailed] = useState(false)
  const tc = TYPE_COLORS[creator.creator_type] || TYPE_COLORS.custom
  const initials = creator.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const hasAvatar = creator.avatar_path && !imgFailed

  return (
    <div onClick={onClick}
         className="flex flex-col items-center gap-2.5 cursor-pointer flex-shrink-0 group"
         style={{ width: 160 }}>
      {/* Circle avatar — thumbnail for performance */}
      <div className="rounded-full overflow-hidden flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-105"
           style={{ width: 160, height: 160, background: hasAvatar ? '#111' : tc.bg, border: `2px solid ${tc.bg}` }}>
        {hasAvatar
          ? <img src={`/api/creators/${creator.id}/avatar-thumb?size=320&v=${avatarBust}`} alt={creator.name}
                 className="w-full h-full object-cover"
                 onError={() => setImgFailed(true)} />
          : <span className="text-[52px] font-semibold select-none" style={{ color: tc.text }}>{initials}</span>
        }
      </div>
      <div className="text-[17px] font-semibold text-[rgba(255,255,255,0.92)] text-center w-full truncate px-1">
        {creator.display_name || creator.name}
      </div>
      <div className="text-[14px] px-2.5 py-0.5 rounded-full capitalize -mt-1" style={{ background: tc.bg, color: tc.text }}>
        {creator.creator_type}
      </div>
    </div>
  )
}

// ── Image HOF card ────────────────────────────────────────────────────────────
function ImageHofCard({ item, onClick }) {
  return (
    <div onClick={onClick}
         className="rounded-[8px] overflow-hidden cursor-pointer group"
         style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
      <div className="overflow-hidden" style={{ height: 240, background: 'rgba(255,255,255,0.03)' }}>
        <img src={`/api/images/${item.id}/thumb`} alt=""
             className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
             onError={e => { e.target.style.display = 'none' }} />
      </div>
      <div className="p-2">
        <div className="text-[13px] font-medium text-[rgba(255,255,255,0.6)] truncate mb-1">{item.filename}</div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
            <Eye size={10} /> {item.view_count ?? 0}
          </span>
          {(item.cum_count ?? 0) > 0 && (
            <span className="vault-cum-stat flex items-center gap-1 text-[12px]" style={{ color: '#D4537E' }}>
              <Droplets size={10} /> {item.cum_count}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Gallery HOF card ──────────────────────────────────────────────────────────
function GalleryHofCard({ gallery, onClick }) {
  const [failed, setFailed] = useState(false)
  return (
    <div onClick={onClick}
         className="rounded-[8px] overflow-hidden cursor-pointer group"
         style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
      <div className="overflow-hidden" style={{ height: 240, background: 'rgba(255,255,255,0.03)' }}>
        {gallery.cover_thumb && !failed
          ? <img src={gallery.cover_thumb} alt={gallery.name}
                 className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                 onError={() => setFailed(true)} />
          : <div className="w-full h-full flex items-center justify-center opacity-15"><Images size={40} /></div>
        }
      </div>
      <div className="p-2">
        <div className="text-[13px] font-medium text-[rgba(255,255,255,0.75)] truncate mb-1">{gallery.name}</div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
            <Eye size={10} /> {gallery.view_count ?? 0}
          </span>
          {(gallery.cum_count ?? 0) > 0 && (
            <span className="vault-cum-stat flex items-center gap-1 text-[12px]" style={{ color: '#D4537E' }}>
              <Droplets size={10} /> {gallery.cum_count}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

const RARITY_COLORS = {
  common:    '#888780',
  uncommon:  '#1D9E75',
  rare:      '#378ADD',
  epic:      '#7F77DD',
  legendary: '#D4537E',
  relic:     '#BA7517',
  celestial: '#EDD87A',
}

const RARITY_LABELS = {
  common:    'Discovered',
  uncommon:  'Favored',
  rare:      'Devoted',
  epic:      'Obsessed',
  legendary: 'Vault Favorite',
  relic:     'Waifu',
  celestial: 'My Queen',
}

// ── Creator HOF card ──────────────────────────────────────────────────────────
function CreatorHofCard({ creator, onClick, avatarBust }) {
  const [imgFailed, setImgFailed] = useState(false)
  const tc = TYPE_COLORS[creator.creator_type] || TYPE_COLORS.custom
  const rc = RARITY_COLORS[creator.card_rarity] || RARITY_COLORS.common
  const initials = creator.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const hasAvatar = creator.avatar_path && !imgFailed

  return (
    <div onClick={onClick}
         className="rounded-[10px] overflow-hidden cursor-pointer group transition-shadow duration-300"
         style={{
           background: 'rgba(255,255,255,0.04)',
           border: `0.5px solid ${rc}55`,
           boxShadow: `0 0 28px 4px ${rc}22`,
         }}>
      <div className="overflow-hidden flex items-center justify-center" style={{ height: 380, background: hasAvatar ? '#111' : tc.bg }}>
        {hasAvatar
          ? <img src={`/api/creators/${creator.id}/avatar?v=${avatarBust}`} alt={creator.name}
                 className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                 onError={() => setImgFailed(true)} />
          : <span className="text-[80px] font-semibold select-none" style={{ color: tc.text, opacity: 0.6 }}>{initials}</span>
        }
      </div>
      <div className="p-3">
        <div className="flex items-center gap-2 mb-1">
          <div className="text-[14px] font-semibold text-[rgba(255,255,255,0.85)] truncate flex-1">{creator.name}</div>
          {creator.card_rarity && creator.card_rarity !== 'common' && (
            <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: `${rc}22`, color: rc, border: `0.5px solid ${rc}55` }}>
              {RARITY_LABELS[creator.card_rarity] ?? creator.card_rarity}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
            <Eye size={10} /> {creator.total_views ?? 0}
          </span>
          {(creator.total_cum ?? 0) > 0 && (
            <span className="vault-cum-stat flex items-center gap-1 text-[12px]" style={{ color: '#D4537E' }}>
              <Droplets size={10} /> {creator.total_cum}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Portrait card ─────────────────────────────────────────────────────────────
function PortraitCard({ imgSrc, title, sub, onClick, fallbackIcon }) {
  const [failed, setFailed] = useState(false)
  return (
    <div onClick={onClick}
         className="rounded-[10px] overflow-hidden cursor-pointer group flex flex-col"
         style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)', aspectRatio: '2/3' }}>
      <div className="flex-1 overflow-hidden relative" style={{ background: 'rgba(255,255,255,0.05)' }}>
        {imgSrc && !failed
          ? <img src={imgSrc} alt={title}
                 className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                 onError={() => setFailed(true)} />
          : <div className="w-full h-full flex items-center justify-center">
              {fallbackIcon || <Images size={28} style={{ color: 'rgba(255,255,255,0.1)' }} />}
            </div>
        }
      </div>
      <div className="p-2 flex-shrink-0">
        <div className="text-[15px] font-medium text-[rgba(255,255,255,0.85)] truncate">{title}</div>
        {sub && <div className="text-[14px] text-[rgba(255,255,255,0.35)] mt-0.5 truncate">{sub}</div>}
      </div>
    </div>
  )
}

// ── Scroll-reveal wrapper ─────────────────────────────────────────────────────
function RevealSection({ children, delay = 0 }) {
  const [ref, visible] = useScrollReveal()
  return (
    <div ref={ref} style={{
      opacity: visible ? 1 : 0,
      transform: visible ? 'none' : 'translateY(20px)',
      transition: `opacity 0.5s ease ${delay}ms, transform 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms`,
    }}>
      {children}
    </div>
  )
}

// ── HOF section ───────────────────────────────────────────────────────────────
function HofSection({ title, icon: Icon, iconColor, items, emptyMsg, renderCard, onSeeAll, cardMinWidth = 180 }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Icon size={16} style={{ color: iconColor }} />
        <span className="text-[17px] font-medium text-[rgba(255,255,255,0.85)]">{title}</span>
        <span className="text-[13px] text-[rgba(255,255,255,0.25)] ml-0.5">most viewed</span>
        <button onClick={onSeeAll}
                className="ml-auto text-[13px] cursor-pointer hover:opacity-80 transition-opacity"
                style={{ color: '#7F77DD' }}>
          See all →
        </button>
      </div>
      {(items ?? []).length === 0
        ? <div className="rounded-[10px] p-5 text-center text-[16px] text-[rgba(255,255,255,0.2)]"
               style={{ background: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.06)' }}>
            {emptyMsg}
          </div>
        : <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cardMinWidth}px, 1fr))` }}>
            {(items ?? []).map(renderCard)}
          </div>
      }
    </div>
  )
}

// ── Inline tag input for tagging mission ─────────────────────────────────────
function AddTagInline({ item, onTagged }) {
  const [newTag, setNewTag] = useState('')
  const [busy, setBusy] = useState(false)
  const qc = useQueryClient()

  const submit = async () => {
    const t = newTag.trim().toLowerCase()
    if (!t || busy) return
    setBusy(true)
    try {
      // Galleries can't be tagged — only images/videos have the tag endpoint
      if (item.type !== 'gallery') {
        await imagesApi.addTag(item.id, t)
        qc.invalidateQueries({ queryKey: ['images-list'] })
        qc.invalidateQueries({ queryKey: ['gallery-images'] })
      }
      onTagged(item.id)
      setNewTag('')
    } catch {
      toast.error('Failed to add tag')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex gap-1 mt-1.5" onMouseDown={e => e.stopPropagation()}>
      <input value={newTag} onChange={e => setNewTag(e.target.value)}
             onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
             placeholder={item.type === 'gallery' ? 'skip or mark done' : 'add tag + Enter'}
             className="flex-1 px-2 py-1 rounded-[5px] text-[9px] outline-none"
             style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', border: '0.5px solid rgba(255,255,255,0.12)' }} />
      {item.type !== 'gallery' && (
        <button type="button" onMouseDown={submit} disabled={busy}
                className="px-2 py-1 rounded-[5px] text-[9px] cursor-pointer"
                style={{ background: 'rgba(127,119,221,0.2)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.3)' }}>
          +Tag
        </button>
      )}
      <button type="button" onMouseDown={() => onTagged(item.id)}
              className="px-2 py-1 rounded-[5px] text-[9px] cursor-pointer"
              style={{ background: 'rgba(29,158,117,0.2)', color: '#9FE1CB', border: '0.5px solid rgba(29,158,117,0.3)' }}>
        ✓
      </button>
    </div>
  )
}

// ── Daily tagging mission overlay ─────────────────────────────────────────────
function TaggingMission({ onClose, onComplete }) {
  const [items, setItems]       = useState(null)
  const [missionType, setMissionType] = useState(null)
  const [tagged, setTagged]     = useState({})
  const [loading, setLoading]   = useState(true)
  const [completing, setCompleting] = useState(false)
  const addXpToast = useVaultStore(s => s.addXpToast)
  const qc = useQueryClient()

  useEffect(() => {
    gamiApi.taggingMission().then(r => {
      setItems(r.data.items)
      setMissionType(r.data.mission_type)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const markTagged = useCallback((id) => setTagged(t => ({ ...t, [id]: true })), [])
  const taggedCount = Object.keys(tagged).length
  const total = items?.length ?? 0
  const allDone = total > 0 && taggedCount >= total

  const completeMission = () => {
    setCompleting(true)
    gamiApi.completeMission().then(() => {
      addXpToast('+200 XP')
      toast.success('Mission complete! All items tagged! 🎉')
      qc.invalidateQueries({ queryKey: ['profile'] })
      qc.invalidateQueries({ queryKey: ['quests'] })
      onComplete?.()
      onClose()
    }).catch(() => {
      toast.error('Could not complete mission')
      setCompleting(false)
    })
  }

  const typeLabel = { images: 'Photos', videos: 'Videos', galleries: 'Galleries' }[missionType] ?? '…'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in" style={{ background: 'rgba(0,0,0,0.85)' }}>
      <div className="rounded-[16px] flex flex-col shadow-2xl animate-modal-pop" style={{ width: 680, maxHeight: '85vh', background: '#1a1a1a', border: '0.5px solid rgba(127,119,221,0.4)' }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 flex-shrink-0" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
          <Dice6 size={16} style={{ color: '#BA7517' }} />
          <div className="flex-1">
            <div className="text-[14px] font-medium text-[rgba(255,255,255,0.9)]">
              Daily Tagging Mission — {typeLabel}
            </div>
            <div className="text-[11px] text-[rgba(255,255,255,0.35)] mt-0.5">
              Tag or assign all {total} items to earn <span style={{ color: '#BA7517' }}>+200 XP</span>
            </div>
          </div>
          <div className="text-[12px] font-medium px-3 py-1 rounded-full"
               style={{ background: allDone ? 'rgba(29,158,117,0.2)' : 'rgba(255,255,255,0.06)',
                        color: allDone ? '#9FE1CB' : 'rgba(255,255,255,0.4)' }}>
            {taggedCount} / {total}
          </div>
          <button onMouseDown={onClose} className="cursor-pointer text-[rgba(255,255,255,0.3)] hover:text-white"><X size={14} /></button>
        </div>

        {/* Progress bar */}
        <div className="h-[3px] flex-shrink-0" style={{ background: 'rgba(255,255,255,0.07)' }}>
          <div className="h-full transition-all duration-300" style={{ width: `${total ? (taggedCount / total) * 100 : 0}%`, background: '#BA7517' }} />
        </div>

        {/* Items grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center py-10 text-[rgba(255,255,255,0.3)]">Loading mission…</div>
          ) : !items || items.length === 0 ? (
            <div className="text-center py-10 text-[rgba(255,255,255,0.3)]">No untagged items found.</div>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
              {items.map(item => (
                <div key={item.id} className="rounded-[10px] overflow-hidden relative"
                     style={{ background: tagged[item.id] ? 'rgba(29,158,117,0.1)' : 'rgba(255,255,255,0.04)',
                              border: `0.5px solid ${tagged[item.id] ? 'rgba(29,158,117,0.4)' : 'rgba(255,255,255,0.08)'}` }}>
                  {tagged[item.id] && (
                    <div className="absolute top-2 right-2 z-10 w-5 h-5 rounded-full flex items-center justify-center"
                         style={{ background: '#1D9E75' }}>
                      <CheckCircle2 size={12} color="white" />
                    </div>
                  )}
                  <div className="overflow-hidden" style={{ height: 120, background: 'rgba(255,255,255,0.03)' }}>
                    {item.thumb
                      ? <img src={item.thumb} alt={item.name} className="w-full h-full object-cover" onError={e => { e.target.style.display='none' }} />
                      : <div className="w-full h-full flex items-center justify-center opacity-10"><Images size={32} /></div>
                    }
                  </div>
                  <div className="p-2">
                    <div className="text-[10px] text-[rgba(255,255,255,0.6)] truncate mb-1">{item.name}</div>
                    <AddTagInline item={item} onTagged={markTagged} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 flex items-center justify-between flex-shrink-0" style={{ borderTop: '0.5px solid rgba(255,255,255,0.07)' }}>
          <div className="text-[11px] text-[rgba(255,255,255,0.3)]">
            {allDone ? '🎉 All tagged! Claim your reward.' : `Tag or mark done each item to complete the mission.`}
          </div>
          <button
            onMouseDown={allDone ? completeMission : undefined}
            disabled={!allDone || completing}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-[12px] font-medium cursor-pointer disabled:opacity-40"
            style={{ background: allDone ? 'rgba(186,117,23,0.3)' : 'rgba(255,255,255,0.06)',
                     color: allDone ? '#FAC775' : 'rgba(255,255,255,0.3)',
                     border: `0.5px solid ${allDone ? 'rgba(186,117,23,0.5)' : 'rgba(255,255,255,0.1)'}` }}>
            <Trophy size={13} /> {completing ? 'Completing…' : 'Claim +200 XP'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ── Daily Spin Modal (slot machine) ──────────────────────────────────────────
function SpinModal({ onClose }) {
  const [phase, setPhase]       = useState('spinning') // spinning | result
  const [displayNum, setDisplayNum] = useState(Math.floor(Math.random() * 100) + 1)
  const [result, setResult]     = useState(null)
  const intervalRef             = useRef(null)
  const startRef                = useRef(Date.now())
  const addXpToast              = useVaultStore(s => s.addXpToast)
  const qc                      = useQueryClient()

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setDisplayNum(Math.floor(Math.random() * 100) + 1)
    }, 75)

    gamiApi.spin().then(r => r.data).then(data => {
      const elapsed = Date.now() - startRef.current
      const remaining = Math.max(0, 1600 - elapsed)
      setTimeout(() => {
        clearInterval(intervalRef.current)
        setResult(data)
        setPhase('result')
        if (!data.already_spun && data.xp_event) {
          addXpToast(`+${data.xp_event.amount} XP`)
          qc.invalidateQueries({ queryKey: ['profile'] })
          qc.invalidateQueries({ queryKey: ['economy-balance'] })
          qc.invalidateQueries({ queryKey: ['vault-stats'] })
        }
        setTimeout(onClose, 2800)
      }, remaining)
    }).catch(() => {
      clearInterval(intervalRef.current)
      toast.error('Spin failed')
      onClose()
    })

    return () => clearInterval(intervalRef.current)
  }, [])

  const xpAmount = result?.xp_event?.amount ?? 0
  const alreadySpun = result?.already_spun

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in"
         style={{ background: 'rgba(0,0,0,0.75)' }}
         onClick={phase === 'result' ? onClose : undefined}>
      <div className="rounded-[24px] px-12 py-10 flex flex-col items-center gap-5 animate-modal-pop"
           style={{
             background: '#1a1a1a',
             border: `1px solid ${phase === 'result' && !alreadySpun ? 'rgba(186,117,23,0.7)' : 'rgba(255,255,255,0.1)'}`,
             boxShadow: phase === 'result' && !alreadySpun ? '0 0 60px rgba(186,117,23,0.25), 0 0 120px rgba(186,117,23,0.1)' : 'none',
             transition: 'border-color 0.4s ease, box-shadow 0.4s ease',
             minWidth: 280,
           }}>
        <div className="text-[11px] uppercase tracking-[0.2em] font-medium" style={{ color: 'rgba(255,255,255,0.35)' }}>
          🎰 Daily Spin
        </div>

        <div style={{
          fontSize: 96,
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: '-0.04em',
          fontVariantNumeric: 'tabular-nums',
          minWidth: 160,
          textAlign: 'center',
          color: phase === 'spinning' ? 'rgba(255,255,255,0.12)' : alreadySpun ? 'rgba(255,255,255,0.3)' : '#FAC775',
          textShadow: phase === 'result' && !alreadySpun ? '0 0 40px rgba(186,117,23,0.9)' : 'none',
          transition: 'color 0.35s ease, text-shadow 0.35s ease',
        }}>
          {phase === 'spinning' ? displayNum : alreadySpun ? '—' : xpAmount}
        </div>

        <div style={{ textAlign: 'center' }}>
          {phase === 'spinning' ? (
            <div className="text-[13px]" style={{ color: 'rgba(255,255,255,0.25)' }}>Spinning…</div>
          ) : alreadySpun ? (
            <div className="text-[14px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Already spun today!</div>
          ) : (
            <>
              <div className="text-[20px] font-semibold" style={{ color: '#FAC775' }}>XP earned!</div>
              <div className="text-[12px] mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
                {result?.reward?.label ?? 'Bonus awarded'}
              </div>
            </>
          )}
        </div>

        {phase === 'result' && (
          <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.2)' }}>click to close</div>
        )}
      </div>
    </div>
  )
}


// ── More Stats Modal ────────────────────────────────────────────────────────────
function MoreStatsModal({ stats, onClose }) {
  if (!stats) return null
  
  const navigate = useNavigate()
  const StatBox = ({ label, value, sub, icon: Icon, color = '#7F77DD', onClick }) => (
    <div className={`rounded-[10px] p-3 flex flex-col justify-center relative ${onClick ? 'cursor-pointer hover:bg-[rgba(255,255,255,0.08)] transition-colors' : ''}`}
         style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)' }}
         onMouseDown={onClick}>
      <div className="flex items-center gap-1.5 mb-1 text-[11px] text-[rgba(255,255,255,0.4)]">
        <Icon size={12} style={{ color }} /> {label}
      </div>
      <div className="text-[16px] font-medium text-[rgba(255,255,255,0.9)] truncate">{value}</div>
      {sub && <div className="text-[10px] text-[rgba(255,255,255,0.3)] mt-0.5">{sub}</div>}
    </div>
  )

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in backdrop-blur-md" 
         style={{ background: 'rgba(0,0,0,0.6)' }} onMouseDown={onClose}>
      <div className="rounded-[16px] shadow-2xl animate-modal-pop flex flex-col max-h-[85vh] w-full max-w-4xl"
           style={{ background: '#181818', border: '0.5px solid rgba(127,119,221,0.4)' }}
           onMouseDown={e => e.stopPropagation()}>
        
        <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(255,255,255,0.06)] flex-shrink-0">
          <div className="flex items-center gap-2 text-[16px] font-medium text-white">
            <BarChart2 size={18} color="#7F77DD" /> Advanced Statistics
          </div>
          <button onMouseDown={onClose} className="text-[rgba(255,255,255,0.4)] hover:text-white cursor-pointer"><X size={18} /></button>
        </div>

        <div className="p-6 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}>
          
          <div className="mb-6">
            <h3 className="text-[13px] font-medium text-[rgba(255,255,255,0.6)] mb-3 uppercase tracking-wider">Library & Content</h3>
            <div className="grid grid-cols-4 gap-3">
              <StatBox icon={Images} label="Avg files / gallery" value={stats.avg_files_per_gallery} />
              <StatBox icon={Video} color="#ED93B1" label="Total video duration" value={fmtMs(stats.total_video_duration * 1000)} />
              <StatBox icon={PlayCircle} color="#ED93B1" label="Avg video length" value={fmtMs(stats.avg_video_length * 1000)} />
              <StatBox icon={HardDrive} label="Highest file size" value={`${(stats.highest_file_size / (1024*1024)).toFixed(1)} MB`} />
              <StatBox icon={Calendar} label="Last added" value={stats.last_added ? new Date(stats.last_added).toLocaleDateString() : 'Never'} />
              <StatBox icon={User} color="#FAC775" label="New creators (month)" value={stats.new_creators_month} />
              <StatBox icon={TagIcon} color="#9FE1CB" label="Avg tags / file" value={stats.avg_tags_per_file} />
              <StatBox icon={Hash} color="#9FE1CB" label="Most common tag" value={stats.most_common_tag || 'None'} />
              <StatBox icon={StarHalf} color="#BA7517" label="Avg rating given" value={stats.avg_rating} sub="out of 10" />

            </div>
          </div>

          <div>
            <h3 className="text-[13px] font-medium text-[rgba(255,255,255,0.6)] mb-3 uppercase tracking-wider">Most Gooned Hall of Fame</h3>
            <div className="grid grid-cols-4 gap-3">
              <StatBox icon={User} color="#FAC775" label="Most gooned creator" value={stats.most_gooned_creator?.name || 'None'} 
                       onClick={stats.most_gooned_creator ? () => { navigate(`/creators/${stats.most_gooned_creator.id}`); onClose(); } : undefined} />
              <StatBox icon={Images} color="#7F77DD" label="Most gooned gallery" value={stats.most_gooned_gallery?.name || 'None'} 
                       onClick={stats.most_gooned_gallery ? () => { navigate(`/galleries/${stats.most_gooned_gallery.id}`); onClose(); } : undefined} />
              <StatBox icon={Eye} color="#D4537E" label="Most gooned image" value={stats.most_gooned_image?.filename || 'None'} 
                       sub={stats.most_gooned_image ? `Gallery #${stats.most_gooned_image.gallery_id}` : ''}
                       onClick={stats.most_gooned_image ? () => { navigate(`/galleries/${stats.most_gooned_image.gallery_id}?openImage=${stats.most_gooned_image.id}`); onClose(); } : undefined} />
              <StatBox icon={Video} color="#ED93B1" label="Most gooned video" value={stats.most_gooned_video?.filename || 'None'} 
                       sub={stats.most_gooned_video ? `Gallery #${stats.most_gooned_video.gallery_id}` : ''}
                       onClick={stats.most_gooned_video ? () => { navigate(`/galleries/${stats.most_gooned_video.gallery_id}?openImage=${stats.most_gooned_video.id}`); onClose(); } : undefined} />
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}



const CAT_COLORS = {
  body_part:       '#D4537E',
  subject:         '#7F77DD',
  clothing:        '#378ADD',
  physical_feature:'#BA7517',
  sex_act:         '#E24B4A',
  nudity_level:    '#D4537E',
  position:        '#7F77DD',
  pose:            '#1D9E75',
  rating:          '#888780',
  character:       '#FAC775',
  style:           '#9FE1CB',
  general:         '#888780',
}
const catColor = (cat) => CAT_COLORS[cat] || '#7F77DD'

// ── Trending Tags sidebar widget ──────────────────────────────────────────────
function TrendingTagsWidget({ onTagClick }) {
  const { data: trending } = useQuery({
    queryKey: ['trending-tags'],
    queryFn: () => tagsApi.trending(8, 60).then(r => r.data),
    staleTime: 120000,
  })
  if (!trending || trending.length === 0) return null
  return (
    <div className="rounded-[12px] p-4"
         style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center gap-1.5 font-medium uppercase tracking-wider mb-3"
           style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>
        <Activity size={14} style={{ color: '#1D9E75' }} /> Trending Tags
      </div>
      <div className="flex flex-col gap-1.5">
        {trending.map(t => (
          <button key={t.id} onClick={() => onTagClick(t.name)}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded-[7px] w-full text-left cursor-pointer transition-all"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.06)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}>
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: catColor(t.category) }} />
              <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.75)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.name}
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
              <span style={{ fontSize: 14, color: '#1D9E75', fontWeight: 600 }}>+{t.recent_count}</span>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)' }}>{t.use_count}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Top Tags sidebar widget ───────────────────────────────────────────────────
function TopTagsWidget({ onTagClick }) {
  const { data: allTags } = useQuery({
    queryKey: ['top-tags'],
    queryFn: () => tagsApi.list().then(r => r.data?.slice(0, 8) ?? []),
    staleTime: 120000,
  })
  if (!allTags || allTags.length === 0) return null
  const maxUse = Math.max(1, ...allTags.map(t => t.use_count ?? 0))
  return (
    <div className="rounded-[12px] p-4"
         style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center gap-1.5 font-medium uppercase tracking-wider mb-3"
           style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>
        <Hash size={14} style={{ color: '#BA7517' }} /> Top Tags
      </div>
      <div className="flex flex-col gap-1.5">
        {allTags.map(t => (
          <button key={t.id} onClick={() => onTagClick(t.name)}
                  className="flex items-center gap-2 w-full text-left cursor-pointer group/tt"
                  style={{}}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-0.5">
                <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                <span style={{ fontSize: 13, color: '#BA7517', fontWeight: 700, marginLeft: 6, flexShrink: 0 }}>{(t.use_count ?? 0).toLocaleString()}</span>
              </div>
              <div style={{ height: 3, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${((t.use_count ?? 0) / maxUse) * 100}%`, background: catColor(t.category), borderRadius: 99, transition: 'width 0.3s ease' }} />
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Co-occurring Tags sidebar widget ──────────────────────────────────────────
function CoOccurringWidget({ onTagClick, onPairClick }) {
  const { data: pairs } = useQuery({
    queryKey: ['co-occurring-tags'],
    queryFn: () => tagsApi.coOccurring(8).then(r => r.data),
    staleTime: 300000,
  })
  if (!pairs || pairs.length === 0) return null
  return (
    <div className="rounded-[12px] p-4"
         style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center gap-1.5 font-medium uppercase tracking-wider mb-3"
           style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>
        <Hash size={14} style={{ color: '#7F77DD' }} /> Often Together
      </div>
      <div className="flex flex-col gap-1.5">
        {pairs.map((p, i) => (
          <div key={i} className="flex items-center gap-1 px-2 py-1.5 rounded-[7px] group/pair cursor-pointer"
               style={{ background: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.05)' }}
               onClick={() => onPairClick ? onPairClick(p.tag1.name, p.tag2.name) : onTagClick(p.tag1.name)}
               onMouseEnter={e => e.currentTarget.style.background = 'rgba(127,119,221,0.07)'}
               onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}>
            <button onClick={e => { e.stopPropagation(); onTagClick(p.tag1.name) }}
                    className="px-1.5 py-0.5 rounded text-left cursor-pointer transition-colors"
                    style={{ fontSize: 14, color: catColor(p.tag1.category), background: `${catColor(p.tag1.category)}18` }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
              {p.tag1.name}
            </button>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}>+</span>
            <button onClick={e => { e.stopPropagation(); onTagClick(p.tag2.name) }}
                    className="px-1.5 py-0.5 rounded text-left cursor-pointer transition-colors"
                    style={{ fontSize: 14, color: catColor(p.tag2.category), background: `${catColor(p.tag2.category)}18` }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
              {p.tag2.name}
            </button>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.2)', marginLeft: 'auto', flexShrink: 0 }}>{p.co_count}</span>
            <span className="opacity-0 group-hover/pair:opacity-100 ml-1 text-[10px] transition-opacity"
                  style={{ color: 'rgba(127,119,221,0.7)' }}>view →</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── More Like This gallery strip ──────────────────────────────────────────────
function MoreLikeThis({ refGalleryId, refGalleryName, onNavigate }) {
  const navigate = useNavigate()
  const { data: similar } = useQuery({
    queryKey: ['similar-galleries', refGalleryId],
    queryFn: () => galleriesApi.similar(refGalleryId, 6).then(r => r.data),
    enabled: !!refGalleryId,
    staleTime: 120000,
  })
  if (!similar || similar.length === 0) return null
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-[17px] font-medium text-[rgba(255,255,255,0.85)]">
          <Zap size={16} style={{ color: '#7F77DD' }} /> More Like This
          {refGalleryName && (
            <span className="text-[14px] font-normal text-[rgba(255,255,255,0.3)] ml-1">based on {refGalleryName}</span>
          )}
        </div>
        <button onClick={() => onNavigate ? onNavigate() : null}
                className="text-[15px] cursor-pointer" style={{ color: '#7F77DD' }}>browse all</button>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
        {similar.map(g => (
          <PortraitCard key={g.id}
            imgSrc={g.cover_thumb}
            title={g.name}
            sub={`${g.image_count ?? 0} photos · ${g.shared_tags} tags`}
            onClick={() => navigate(`/galleries/${g.id}`)} />
        ))}
      </div>
    </div>
  )
}

// ── Main dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate()
  const addXpToast       = useVaultStore(s => s.addXpToast)
  const avatarBust       = useVaultStore(s => s.avatarBust)
  const sessionActive    = useVaultStore(s => s.sessionActive)
  const sessionTotalMs   = useVaultStore(s => s.sessionTotalMs)
  const startSession     = useVaultStore(s => s.startSession)
  const endSession       = useVaultStore(s => s.endSession)
  const qc = useQueryClient()

  const [showMission, setShowMission] = useState(false)
  const [showMoreStats, setShowMoreStats] = useState(false)
  const [collectionsOpen, setCollectionsOpen] = useState(false)
  const [showSpinModal, setShowSpinModal] = useState(false)
  const [showMixModal, setShowMixModal] = useState(false)

  const handleRandomGallery = async () => {
    try {
      const res = await galleriesApi.randomPicks(1)
      const picks = res.data
      if (picks?.length > 0) navigate(`/galleries/${picks[0].id}`)
      else toast('No galleries in your library yet', { icon: '📁' })
    } catch {
      toast.error('Could not fetch a random gallery')
    }
  }

  // Drag-to-scroll for favorites strip
  const favsRef = useRef(null)
  const onFavsMouseDown = useCallback((e) => {
    const el = favsRef.current
    if (!el || e.button !== 0) return
    const startX      = e.clientX
    const startScroll = el.scrollLeft
    let moved = false
    const onMove = (ev) => {
      const dx = ev.clientX - startX
      if (!moved && Math.abs(dx) > 6) {
        moved = true
        el.style.cursor = 'grabbing'
      }
      if (moved) { el.scrollLeft = startScroll - dx; ev.preventDefault() }
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      el.style.cursor = 'grab'
      if (moved) {
        // Eat the click that fires right after mouseup so card nav doesn't trigger
        window.addEventListener('click', ev => ev.stopPropagation(), { capture: true, once: true })
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const { data: stats, isLoading: statsLoading } = useQuery({ queryKey: ['vault-stats'], queryFn: () => galleriesApi.stats().then(r => r.data) })
  const { data: favorites }      = useQuery({ queryKey: ['favorites'],        queryFn: () => creatorsApi.favorites().then(r => r.data) })
  const { data: imageHof }       = useQuery({ queryKey: ['hof',          4],  queryFn: () => galleriesApi.hof(4).then(r => r.data) })
  const { data: galleryHof }     = useQuery({ queryKey: ['gallery-hof',  4],  queryFn: () => galleriesApi.galleryHof(4).then(r => r.data) })
  const { data: creatorHof }     = useQuery({ queryKey: ['creator-hof',  4],  queryFn: () => creatorsApi.hof(4).then(r => r.data) })
  const { data: quests }         = useQuery({ queryKey: ['quests'],           queryFn: () => gamiApi.quests().then(r => r.data) })
  const { data: recent }         = useQuery({ queryKey: ['recent-galleries'], queryFn: () => galleriesApi.recent(6).then(r => r.data) })
  const { data: sesStats }       = useQuery({ queryKey: ['ses-stats'],        queryFn: () => sessionsApi.stats().then(r => r.data) })
  const { data: randomGalleries} = useQuery({ queryKey: ['random-galleries'], queryFn: () => galleriesApi.randomPicks(8).then(r => r.data) })
  const { data: randomImages }   = useQuery({ queryKey: ['random-images'],    queryFn: () => imagesApi.randomPicks(8).then(r => r.data) })
  const { data: randomVideos }   = useQuery({ queryKey: ['random-videos'],    queryFn: () => imagesApi.randomVideos(8).then(r => r.data) })
  const { data: randomCreators }  = useQuery({ queryKey: ['random-creators'],  queryFn: () => creatorsApi.randomPicks(8).then(r => r.data) })
  const { data: topCollections }  = useQuery({ queryKey: ['top-collections'],  queryFn: () => creatorsApi.topByValue(5).then(r => r.data), enabled: collectionsOpen })
  const { data: recentSessions } = useQuery({ queryKey: ['recent-sessions'], queryFn: () => sessionsApi.list({ limit: 8 }).then(r => r.data) })
  const { data: balance }        = useQuery({ queryKey: ['economy-balance'], queryFn: () => economyApi.balance().then(r => r.data) })

  const sessionMutation = useMutation({
    mutationFn: (data = {}) => sessionsApi.log(data).then(r => r.data),
    onSuccess: (data) => {
      addXpToast(`+${data.xp_earned} XP`)
      toast.success('Session logged ❤️')
      qc.invalidateQueries({ queryKey: ['vault-stats'] })
      qc.invalidateQueries({ queryKey: ['quests'] })
      qc.invalidateQueries({ queryKey: ['ses-stats'] })
    }
  })

  const handleSessionBtn = () => {
    if (!sessionActive) {
      startSession()
      toast('Session started — enjoy! 🔥', { icon: '🎯' })
    } else {

      const elapsed = endSession(); sessionMutation.mutate({ duration_sec: Math.floor(elapsed / 1000) })
    }
  }

  return (
    <div className="p-6 flex flex-col gap-6 w-full">

      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div className="text-[22px] font-medium text-white">Dashboard</div>
        <div className="flex gap-3">
          <button onClick={() => setShowMoreStats(true)}
                  className="flex items-center gap-4 font-medium rounded-full cursor-pointer"
                  style={{ fontSize: 24, padding: '14px 32px', background: 'rgba(127,119,221,0.2)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.4)' }}>
            <BarChart2 size={28} /> More stats
          </button>
          <button onClick={() => setShowMission(true)}
                  className="flex items-center gap-4 font-medium rounded-full cursor-pointer"
                  style={{ fontSize: 24, padding: '14px 32px', background: 'rgba(186,117,23,0.2)', color: '#FAC775', border: '0.5px solid rgba(186,117,23,0.4)' }}>
            <Dice6 size={28} /> Daily Tagging
          </button>
        </div>
      </div>

      {/* ── Vault stats strip ──────────────────────────────────────────────── */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {statsLoading ? (
          // Skeleton placeholders while stats load
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-[10px] p-3 flex flex-col gap-2" style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)', minHeight: 72 }}>
              <div className="skeleton" style={{ height: 12, width: '55%' }} />
              <div className="skeleton" style={{ height: 22, width: '70%' }} />
            </div>
          ))
        ) : [
          { icon: Images,    label: 'Total files',      value: ((stats?.total_images ?? 0) + (stats?.total_videos ?? 0)).toLocaleString(), color: 'rgba(255,255,255,0.9)' },
          { icon: Images,    label: 'Photos',           value: (stats?.total_images    ?? 0).toLocaleString(), color: 'rgba(255,255,255,0.9)' },
          { icon: Video,     label: 'Videos',           value: (stats?.total_videos    ?? 0).toLocaleString(), color: 'rgba(255,255,255,0.9)' },
          { icon: Images,    label: 'Galleries',        value: (stats?.total_galleries ?? 0).toLocaleString(), color: 'rgba(255,255,255,0.9)' },
          { icon: User,      label: 'Creators',         value: (stats?.total_creators  ?? 0).toLocaleString(), color: 'rgba(255,255,255,0.9)' },
          { icon: HardDrive, label: 'Vault size',       value: `${stats?.total_size_gb ?? 0} GB`,             color: 'rgba(255,255,255,0.9)' },
          { icon: TagIcon,   label: 'Untagged',         value: `${stats?.untagged_files ?? 0}`, subValue: `${stats?.untagged_pct ?? 0}%`, color: '#9FE1CB' },
          { icon: User,      label: 'Top creator',      value: stats?.top_creator || 'None', color: '#FAC775' },
        ].map(({ icon: Icon, label, value, subValue, color }) => {
          const valStr = String(value || '');
          const isLong = valStr.length > 7 || label === 'Top creator';
          return (
            <div key={label} className="rounded-[10px] p-3 flex flex-col justify-center relative overflow-hidden"
                 style={{
                   background: 'rgba(255,255,255,0.04)',
                   border: '0.5px solid rgba(255,255,255,0.08)',
                   gridColumn: isLong ? 'span 2' : 'auto',
                 }}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Icon size={13} style={{ color: 'rgba(255,255,255,0.25)' }} />
                <span className="text-[14px] text-[rgba(255,255,255,0.4)] truncate">{label}</span>
              </div>
              <div className="text-[22px] font-medium leading-none truncate">
                <AnimatedStatValue value={value} color={color} />
              </div>
              {subValue && <div className="absolute right-2 bottom-1.5 text-[15px] font-bold" style={{ color }}>{subValue}</div>}
            </div>
          )
        })}

        {/* ── Collection value — expandable ──────────────────────── */}
        {(() => {
          const colValStr = String((stats?.collection_value ?? 0).toLocaleString());
          const isLong = colValStr.length > 6;
          return (
            <div
              onClick={() => setCollectionsOpen(v => !v)}
              className="rounded-[10px] p-3 flex flex-col justify-center relative overflow-hidden cursor-pointer transition-all duration-150"
              style={{
                background: collectionsOpen ? 'rgba(29,158,117,0.1)' : 'rgba(255,255,255,0.04)',
                border: collectionsOpen ? '0.5px solid rgba(29,158,117,0.35)' : '0.5px solid rgba(255,255,255,0.08)',
                gridColumn: isLong ? 'span 2' : 'auto',
              }}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Target size={13} style={{ color: 'rgba(255,255,255,0.25)' }} />
                <span className="text-[14px] text-[rgba(255,255,255,0.4)] truncate flex-1">Collection value</span>
                <ChevronDown size={11} style={{ color: '#1D9E75', flexShrink: 0, transition: 'transform 0.2s', transform: collectionsOpen ? 'rotate(180deg)' : 'none' }} />
              </div>
              <div className="text-[22px] font-medium leading-none truncate" style={{ color: '#1D9E75' }}>
                ${(stats?.collection_value ?? 0).toLocaleString()}
              </div>
              <div className="text-[13px] mt-1" style={{ color: 'rgba(29,158,117,0.6)' }}>top creators ▾</div>
            </div>
          )
        })()}
      </div>

      {/* ── Top collections dropdown ───────────────────────────────────────── */}
      <div style={{
        maxHeight: collectionsOpen ? 400 : 0,
        overflow: 'hidden',
        transition: 'max-height 0.3s cubic-bezier(0.4,0,0.2,1)',
      }}>
        <div className="rounded-[12px] p-4" style={{
          maxWidth: 440,
          background: 'rgba(29,158,117,0.07)',
          border: '0.5px solid rgba(29,158,117,0.25)',
        }}>
          <div className="text-[15px] font-semibold text-[rgba(255,255,255,0.4)] uppercase tracking-wider mb-3">
            Top creators by collection value
          </div>
          {!topCollections ? (
            <div className="text-[17px] text-[rgba(255,255,255,0.2)]">Loading…</div>
          ) : topCollections.length === 0 ? (
            <div className="text-[17px] text-[rgba(255,255,255,0.2)]">No values set yet — add purchase prices to galleries</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {topCollections.map((c, i) => (
                <div key={c.id}
                     onClick={() => navigate(`/creators/${c.id}`)}
                     className="flex items-center gap-3 px-3 py-2.5 rounded-[8px] cursor-pointer"
                     style={{ background: 'rgba(255,255,255,0.03)' }}
                     onMouseEnter={e => e.currentTarget.style.background = 'rgba(29,158,117,0.1)'}
                     onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}>
                  <span className="text-[16px] font-bold w-6 flex-shrink-0" style={{ color: 'rgba(29,158,117,0.5)' }}>#{i + 1}</span>
                  <span className="flex-1 text-[18px] font-medium text-[rgba(255,255,255,0.85)] truncate">{c.name}</span>
                  <span className="text-[19px] font-semibold flex-shrink-0" style={{ color: '#1D9E75' }}>${c.collection_value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 2-column layout ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 284px', gap: 24, alignItems: 'start' }}>

        {/* LEFT: main content */}
        <div className="flex flex-col gap-6 min-w-0">

          {/* Empty state */}
          {!stats?.total_galleries && (
            <div className="rounded-[12px] p-5 flex items-center justify-between"
                 style={{ background: 'rgba(127,119,221,0.08)', border: '0.5px solid rgba(127,119,221,0.2)' }}>
              <div>
                <div className="text-[18px] font-medium text-[rgba(255,255,255,0.85)] mb-1">Your vault is empty</div>
                <div className="text-[16px] text-[rgba(255,255,255,0.4)]">Settings → add library folder → Scan library now</div>
              </div>
              <button onClick={() => navigate('/settings')}
                      className="flex-shrink-0 ml-4 text-[16px] font-medium px-4 py-2 rounded-full cursor-pointer"
                      style={{ background: 'rgba(127,119,221,0.25)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.4)' }}>
                Go to Settings →
              </button>
            </div>
          )}

          {/* ── Favorites ─────────────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-[17px] font-medium text-[rgba(255,255,255,0.85)]">
                <Star size={16} style={{ color: '#BA7517' }} /> Your favorites
              </div>
              <button onClick={() => navigate('/creators')} className="text-[15px] cursor-pointer" style={{ color: '#7F77DD' }}>manage</button>
            </div>
            <div ref={favsRef} onMouseDown={onFavsMouseDown}
                 className="flex gap-3 overflow-x-auto pb-1 select-none"
                 style={{ scrollbarWidth: 'none', cursor: 'grab' }}>
              {(favorites ?? []).length === 0 ? (
                <div className="flex items-center gap-3">
                  <span className="text-[16px] text-[rgba(255,255,255,0.3)]">No favorites yet —</span>
                  <button onClick={() => navigate('/creators')}
                          className="flex items-center gap-1.5 text-[15px] px-3 py-1.5 rounded-full cursor-pointer"
                          style={{ background: 'rgba(127,119,221,0.15)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.3)' }}>
                    <Plus size={13} /> Add a creator
                  </button>
                </div>
              ) : (
                <>
                  {favorites.map(c => <FavCreatorCard key={c.id} creator={c} avatarBust={avatarBust} onClick={() => navigate(`/creators/${c.id}`)} />)}
                  <div onClick={() => navigate('/creators')}
                       className="flex flex-col items-center gap-2.5 cursor-pointer flex-shrink-0"
                       style={{ width: 160 }}>
                    <div className="rounded-full flex items-center justify-center"
                         style={{ width: 160, height: 160, background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.12)' }}>
                      <Plus size={24} style={{ color: 'rgba(255,255,255,0.2)' }} />
                    </div>
                    <div className="text-[16px] text-[rgba(255,255,255,0.25)]">Add more</div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── Creator Hall of Fame ───────────────────────────────────────────── */}
          {(creatorHof ?? []).length > 0 && (
            <HofSection
              title="Creator Hall of Fame"
              icon={Trophy}
              iconColor="#BA7517"
              items={creatorHof}
              cardMinWidth={260}
              emptyMsg="Log sessions to build your creator hall of fame"
              onSeeAll={() => navigate('/hall-of-fame')}
              renderCard={(c) => (
                <CreatorHofCard key={c.id} creator={c} avatarBust={avatarBust} onClick={() => navigate(`/creators/${c.id}`)} />
              )}
            />
          )}

          {/* ── Photo Hall of Fame ─────────────────────────────────────────────── */}
          <RevealSection>
            <HofSection
              title="Photo Hall of Fame"
              icon={Droplets}
              iconColor="#D4537E"
              items={imageHof}
              emptyMsg="Log sessions on images to build your image hall of fame"
              onSeeAll={() => navigate('/hall-of-fame')}
              renderCard={(item) => (
                <ImageHofCard key={item.id} item={item}
                              onClick={() => navigate(`/galleries/${item.gallery_id}?openImage=${item.id}`)} />
              )}
            />
          </RevealSection>

          {/* ── Gallery Hall of Fame ───────────────────────────────────────────── */}
          {(galleryHof ?? []).length > 0 && (
            <RevealSection delay={60}>
              <HofSection
                title="Gallery Hall of Fame"
                icon={Images}
                iconColor="#7F77DD"
                items={galleryHof}
                emptyMsg="Log sessions on galleries to build your gallery hall of fame"
                onSeeAll={() => navigate('/hall-of-fame')}
                renderCard={(g) => (
                  <GalleryHofCard key={g.id} gallery={g} onClick={() => navigate(`/galleries/${g.id}`)} />
                )}
              />
            </RevealSection>
          )}

          {/* ── More Like This ────────────────────────────────────────────────── */}
          {(galleryHof ?? []).length > 0 && (
            <RevealSection delay={80}>
              <MoreLikeThis
                refGalleryId={galleryHof[0].id}
                refGalleryName={galleryHof[0].name}
                onNavigate={() => navigate('/galleries')}
              />
            </RevealSection>
          )}

          {/* ── Random content (full width — daily quests moved to floating panel) ── */}
          <div className="flex flex-col gap-6">
            {(randomGalleries ?? []).length > 0 && (
              <RevealSection><div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-[17px] font-medium text-[rgba(255,255,255,0.85)]">
                    <Shuffle size={16} style={{ color: '#7F77DD' }} /> Random galleries
                  </div>
                  <button onClick={() => navigate('/galleries')} className="text-[15px] cursor-pointer" style={{ color: '#7F77DD' }}>browse all</button>
                </div>
                <div key={randomGalleries ? 1 : 0} className="grid gap-3 grid-stagger" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
                  {randomGalleries.map(g => (
                    <PortraitCard key={g.id}
                      imgSrc={g.cover_thumb}
                      title={g.name}
                      sub={`${g.image_count} photos${g.creator_name ? ' · ' + g.creator_name : ''}`}
                      onClick={() => navigate(`/galleries/${g.id}`)} />
                  ))}
                </div>
              </div></RevealSection>
            )}

            {(randomImages ?? []).length > 0 && (
              <RevealSection delay={40}><div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-[17px] font-medium text-[rgba(255,255,255,0.85)]">
                    <Eye size={16} style={{ color: '#D4537E' }} /> Random Photos
                  </div>
                  <button onClick={() => navigate('/images')} className="text-[15px] cursor-pointer" style={{ color: '#7F77DD' }}>browse all</button>
                </div>
                <div key={randomImages ? 1 : 0} className="grid gap-3 grid-stagger" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
                  {randomImages.map(img => (
                    <PortraitCard key={img.id}
                      imgSrc={`/api/images/${img.id}/thumb`}
                      title={img.filename}
                      sub={img.gallery_name}
                      onClick={() => navigate(`/galleries/${img.gallery_id}?openImage=${img.id}`)} />
                  ))}
                </div>
              </div></RevealSection>
            )}

            {(randomVideos ?? []).length > 0 && (
              <RevealSection delay={40}><div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-[17px] font-medium text-[rgba(255,255,255,0.85)]">
                    <Play size={16} style={{ color: '#7F77DD' }} /> Random videos
                  </div>
                  <button onClick={() => navigate('/videos')} className="text-[15px] cursor-pointer" style={{ color: '#7F77DD' }}>browse all</button>
                </div>
                <div key={randomVideos ? 1 : 0} className="grid gap-3 grid-stagger" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
                  {randomVideos.map(vid => (
                    <PortraitCard key={vid.id}
                      imgSrc={`/api/images/${vid.id}/thumb`}
                      title={vid.filename}
                      sub={vid.gallery_name}
                      onClick={() => navigate(`/galleries/${vid.gallery_id}?openImage=${vid.id}`)}
                      fallbackIcon={<Play size={28} style={{ color: 'rgba(255,255,255,0.1)' }} />} />
                  ))}
                </div>
              </div></RevealSection>
            )}

            {(randomCreators ?? []).length > 0 && (
              <RevealSection delay={40}><div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-[17px] font-medium text-[rgba(255,255,255,0.85)]">
                    <User size={16} style={{ color: '#BA7517' }} /> Discover creators
                  </div>
                  <button onClick={() => navigate('/creators')} className="text-[15px] cursor-pointer" style={{ color: '#7F77DD' }}>view all</button>
                </div>
                <div key={randomCreators ? 1 : 0} className="grid gap-3 grid-stagger" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
                  {randomCreators.map(c => {
                    const tc = TYPE_COLORS[c.creator_type] || TYPE_COLORS.custom
                    const initials = c.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
                    return (
                      <PortraitCard key={c.id}
                        imgSrc={c.avatar_path ? `/api/creators/${c.id}/avatar` : null}
                        title={c.display_name || c.name}
                        sub={c.creator_type}
                        onClick={() => navigate(`/creators/${c.id}`)}
                        fallbackIcon={
                          <span className="text-[40px] font-semibold select-none" style={{ color: tc.text, opacity: 0.7 }}>{initials}</span>
                        } />
                    )
                  })}
                </div>
              </div></RevealSection>
            )}
          </div>

          {/* Recently added */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-[17px] font-medium text-[rgba(255,255,255,0.85)]">
                <Clock size={16} style={{ color: 'rgba(255,255,255,0.4)' }} /> Recently added
              </div>
              <button onClick={() => navigate('/galleries')} className="text-[15px] cursor-pointer" style={{ color: '#7F77DD' }}>view all</button>
            </div>
            {(recent ?? []).length === 0
              ? <div className="rounded-[10px] p-6 text-center text-[16px] text-[rgba(255,255,255,0.2)]"
                     style={{ background: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.06)' }}>
                  No galleries yet — scan your library in Settings
                </div>
              : <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
                  {recent.map(g => (
                    <PortraitCard key={g.id}
                      imgSrc={g.cover_thumb}
                      title={g.name}
                      sub={`${g.image_count} photos${g.creator_name ? ' · ' + g.creator_name : ''}`}
                      onClick={() => navigate(`/galleries/${g.id}`)} />
                  ))}
                </div>
            }
          </div>

          {/* Surprise me */}
          <div className="rounded-[10px] p-4 flex items-center justify-between"
               style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
            <div>
              <div className="text-[17px] font-medium text-[rgba(255,255,255,0.7)] mb-1 flex items-center gap-2">
                <Shuffle size={16} style={{ color: '#BA7517' }} /> Surprise me
              </div>
              <div className="text-[15px] text-[rgba(255,255,255,0.3)]">Open a random gallery from your vault</div>
            </div>
            <button onClick={() => galleriesApi.random().then(r => navigate(`/galleries/${r.data.id}`))}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-full text-[16px] font-medium cursor-pointer flex-shrink-0"
                    style={{ background: 'rgba(127,119,221,0.2)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.3)' }}>
              <Shuffle size={15} /> Random gallery
            </button>
          </div>

        </div>

        {/* RIGHT: sticky sidebar */}
        <div className="flex flex-col gap-4"
             style={{ position: 'sticky', top: 20, maxHeight: 'calc(100vh - 40px)', overflowY: 'auto', scrollbarWidth: 'none' }}>

          {/* ── Discover ─────────────────────────────────────── */}
          <div className="rounded-[12px] p-4"
               style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
            <div className="flex items-center gap-1.5 font-medium uppercase tracking-wider mb-3"
                 style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>
              <Dice6 size={14} style={{ color: '#BA7517' }} /> Discover
            </div>
            <div className="flex flex-col gap-2">
              <button onClick={handleRandomGallery}
                      className="w-full flex items-center gap-2.5 py-2.5 px-3 rounded-[8px] cursor-pointer transition-all"
                      style={{ background: 'rgba(186,117,23,0.12)', color: '#FAC775', border: '0.5px solid rgba(186,117,23,0.25)', fontSize: 15, fontWeight: 500 }}>
                <Dice6 size={15} /> Random Gallery
              </button>
              <button onClick={() => setShowMixModal(true)}
                      className="w-full flex items-center gap-2.5 py-2.5 px-3 rounded-[8px] cursor-pointer transition-all"
                      style={{ background: 'rgba(127,119,221,0.12)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.25)', fontSize: 15, fontWeight: 500 }}>
                <Shuffle size={15} /> Random Mix
              </button>
            </div>
          </div>

          {/* ── Trending Tags ────────────────────────────────── */}
          <TrendingTagsWidget onTagClick={(tag) => navigate(`/galleries?tag=${encodeURIComponent(tag)}`)} />

          {/* ── Top Tags ─────────────────────────────────────── */}
          <TopTagsWidget onTagClick={(tag) => navigate(`/galleries?tag=${encodeURIComponent(tag)}`)} />

          {/* ── Often Together ───────────────────────────────── */}
          <CoOccurringWidget
            onTagClick={(tag) => navigate(`/images?tag=${encodeURIComponent(tag)}`)}
            onPairClick={(t1, t2) => navigate(`/images?tags=${encodeURIComponent(t1)},${encodeURIComponent(t2)}`)}
          />

          {/* ── Recent Sessions ─────────────────────────────── */}
          <div className="rounded-[12px] p-4"
               style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5 font-medium uppercase tracking-wider"
                   style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>
                <Heart size={14} style={{ color: '#D4537E' }} /> Recent Sessions
              </div>
              <button onClick={() => navigate('/sessions')} style={{ fontSize: 15, color: '#7F77DD', cursor: 'pointer' }}>view all</button>
            </div>
            {(!recentSessions || recentSessions.length === 0) ? (
              <div style={{ fontSize: 15, padding: '8px 0', color: 'rgba(255,255,255,0.2)' }}>No sessions yet</div>
            ) : (
              <div className="flex flex-col">
                {recentSessions.slice(0, 6).map(s => (
                  <div key={s.id} className="flex items-center gap-2 py-2 border-b last:border-0"
                       style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="flex-1 min-w-0">
                      <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)' }}>{timeAgo(s.logged_at)}</div>
                      {s.duration_sec > 0 && (
                        <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.28)' }}>{fmtMs(s.duration_sec * 1000)}</div>
                      )}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: '#7F77DD', flexShrink: 0 }}>+{s.xp_earned} XP</div>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={handleSessionBtn}
              className="w-full mt-3 py-2.5 rounded-[8px] font-medium cursor-pointer transition-all"
              style={{
                fontSize: 17,
                ...(sessionActive
                  ? { background: 'rgba(212,83,126,0.3)', color: '#FFD4E2', border: '1px solid rgba(212,83,126,0.6)' }
                  : { background: 'rgba(212,83,126,0.1)', color: '#ED93B1', border: '0.5px solid rgba(212,83,126,0.25)' })
              }}>
              {sessionActive ? '⏹ End session' : '▶ Start session'}
            </button>
          </div>

          {/* ── Vault Health ─────────────────────────────────── */}
          <div className="rounded-[12px] p-4"
               style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
            <div className="flex items-center gap-1.5 font-medium uppercase tracking-wider mb-4"
                 style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>
              <Zap size={14} style={{ color: '#BA7517' }} /> Vault Health
            </div>

            <div className="mb-4">
              <div className="flex justify-between mb-1.5" style={{ fontSize: 15 }}>
                <span style={{ color: 'rgba(255,255,255,0.4)' }}>Tagged files</span>
                <span style={{ color: (stats?.untagged_pct ?? 0) > 30 ? '#E24B4A' : (stats?.untagged_pct ?? 0) > 10 ? '#BA7517' : '#1D9E75' }}>
                  {100 - (stats?.untagged_pct ?? 0)}%
                </span>
              </div>
              <div className="h-[6px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
                <div className="h-full rounded-full transition-all duration-700" style={{
                  width: `${100 - (stats?.untagged_pct ?? 0)}%`,
                  background: (stats?.untagged_pct ?? 0) > 30 ? '#E24B4A' : (stats?.untagged_pct ?? 0) > 10 ? '#BA7517' : '#1D9E75',
                }} />
              </div>
              <div style={{ fontSize: 15, marginTop: 4, color: 'rgba(255,255,255,0.25)' }}>
                {stats?.untagged_files ?? 0} files need tags
              </div>
            </div>

            <div className="flex flex-col gap-2.5 mb-3">
              {(stats?.avg_rating ?? 0) > 0 && (
                <div className="flex justify-between items-center">
                  <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>Avg rating</span>
                  <span style={{ fontSize: 16, fontWeight: 600, color: '#BA7517' }}>★ {stats.avg_rating}</span>
                </div>
              )}
              {stats?.most_common_tag && (
                <div className="flex justify-between items-center">
                  <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>Top tag</span>
                  <span style={{ fontSize: 15, padding: '3px 8px', borderRadius: 20, background: 'rgba(127,119,221,0.15)', color: '#CECBF6' }}>
                    #{stats.most_common_tag}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>Galleries</span>
                <span style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>
                  {(stats?.total_galleries ?? 0).toLocaleString()} total
                </span>
              </div>
            </div>

            {(stats?.untagged_files ?? 0) > 0 && (
              <button onClick={() => setShowMission(true)}
                      className="w-full py-2.5 rounded-[8px] font-medium cursor-pointer"
                      style={{ fontSize: 16, background: 'rgba(186,117,23,0.12)', color: '#FAC775', border: '0.5px solid rgba(186,117,23,0.25)' }}>
                🎯 Tagging mission
              </button>
            )}
          </div>

          {/* ── Economy / Wallet ─────────────────────────────── */}
          {balance && (
            <div className="rounded-[12px] p-4"
                 style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center justify-between mb-4">
                <div style={{ fontSize: 16, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.35)' }}>💰 Wallet</div>
                <button onClick={() => navigate('/collection')} style={{ fontSize: 15, color: '#7F77DD', cursor: 'pointer' }}>open packs →</button>
              </div>
              <div className="flex flex-col gap-3 mb-4">
                <div className="flex justify-between items-center">
                  <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>Vault Credits</span>
                  <span style={{ fontSize: 23, fontWeight: 700, color: '#FAC775' }}>
                    {(balance.vault_credits ?? 0).toLocaleString()}
                  </span>
                </div>
                {(balance.shards ?? 0) > 0 && (
                  <div className="flex justify-between items-center">
                    <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>Shards</span>
                    <span style={{ fontSize: 19, fontWeight: 600, color: '#CECBF6' }}>
                      {(balance.shards ?? 0).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
              <button onClick={() => setShowSpinModal(true)}
                      className="w-full py-2.5 rounded-[8px] font-medium cursor-pointer"
                      style={{ fontSize: 16, background: 'rgba(186,117,23,0.12)', color: '#FAC775', border: '0.5px solid rgba(186,117,23,0.25)' }}>
                🎰 Daily spin
              </button>
            </div>
          )}

        </div>
      </div>

      {/* Daily tagging mission overlay */}
      {showMission && (
        <TaggingMission
          onClose={() => setShowMission(false)}
          onComplete={() => { qc.invalidateQueries({ queryKey: ['profile'] }); qc.invalidateQueries({ queryKey: ['quests'] }) }}
        />
      )}
      {showMoreStats && <MoreStatsModal stats={stats} onClose={() => setShowMoreStats(false)} />}
      {showSpinModal && <SpinModal onClose={() => setShowSpinModal(false)} />}
      {showMixModal && <RandomMixModal onClose={() => setShowMixModal(false)} />}

    </div>
  )
}

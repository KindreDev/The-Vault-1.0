import React, { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Star, Droplets, Clock, Shuffle, Dice6, Target, CheckCircle2, Circle,
  Plus, Images, Eye, User, HardDrive, Video, Trophy, Flame, X, Play,
  BarChart2, Calendar, Tag as TagIcon, Hash, Activity, Zap, Info, PlayCircle, StarHalf,
  ChevronDown, Heart, LayoutTemplate, FolderSearch, Loader2, Check,
} from 'lucide-react'
import { galleriesApi, creatorsApi, gamiApi, sessionsApi, imagesApi, economyApi, playlistsApi, tagsApi, cardsApi, scannerApi } from '../lib/api'
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
        {creator.title || creator.name}
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
  legendary: '#BA7517',
}

const RARITY_LABELS = {
  common:    'Snapshot',
  uncommon:  'Album · 500+',
  rare:      'Big Portfolio · 2.5K+',
  epic:      'Library · 6K+',
  legendary: 'Grand Collection · 15K+',
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
function PortraitCard({ imgSrc, title, sub, onClick, onContextMenu, fallbackIcon }) {
  const [failed, setFailed] = useState(false)
  return (
    <div onClick={onClick} onContextMenu={onContextMenu}
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

// ── Daily greeting (shown once per app launch, not per route visit) ──────────
const GREETINGS = [
  "Welcome back to the Vault, {name}.",
  "Good to have you here, {name}.",
  "The collection awaits, {name}.",
  "Ready when you are, {name}.",
  "Good evening, {name}. The Vault is yours.",
  "You made it, {name}.",
  "Hey {name}. Something good is waiting.",
  "The Vault missed you, {name}.",
  "Settle in, {name}. Let's see what's here.",
  "Back again, {name}. Good taste.",
  "Your collection grows, {name}.",
  "All yours, {name}. Take your time.",
]

function getOrCreateGreeting(name) {
  const existing = sessionStorage.getItem('vault_greeting')
  if (existing) return existing // same greeting all session; new message each app/tab open
  const display = name || 'Collector'
  const text = GREETINGS[Math.floor(Math.random() * GREETINGS.length)].replace('{name}', display)
  sessionStorage.setItem('vault_greeting', text)
  return text
}

// ── Scan Folders Modal ────────────────────────────────────────────────────────
function ScanModal({ onClose }) {
  const [search, setSearch]       = useState('')
  const [scanning, setScanning]   = useState(false)
  const [done, setDone]           = useState(false)
  const [scanningId, setScanningId] = useState(null) // null = full library
  const qc = useQueryClient()

  const { data: roots = [] } = useQuery({
    queryKey: ['library-roots'],
    queryFn: () => scannerApi.roots().then(r => r.data),
  })

  const { data: status } = useQuery({
    queryKey: ['scan-status-modal'],
    queryFn: () => scannerApi.status().then(r => r.data),
    refetchInterval: scanning ? 1500 : false,
  })

  // Watch for scan completion
  useEffect(() => {
    if (scanning && status && !status.running) {
      setScanning(false)
      setDone(true)
      qc.invalidateQueries({ queryKey: ['galleries'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    }
  }, [scanning, status, qc])

  const triggerScan = async (rootId = null) => {
    setDone(false)
    setScanning(true)
    setScanningId(rootId)
    try {
      await scannerApi.scan(rootId)
    } catch {
      setScanning(false)
      toast.error('Failed to start scan')
    }
  }

  const filtered = roots.filter(r =>
    r.label?.toLowerCase().includes(search.toLowerCase()) ||
    r.path?.toLowerCase().includes(search.toLowerCase())
  )

  const progressPct = status?.total > 0 ? Math.round((status.scanned / status.total) * 100) : null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in"
         style={{ background: 'rgba(0,0,0,0.7)' }}
         onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rounded-[16px] shadow-2xl animate-modal-pop w-[420px]"
           style={{ background: '#161616', border: '0.5px solid rgba(255,255,255,0.12)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4"
             style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-2">
            <FolderSearch size={16} style={{ color: '#7F77DD' }} />
            <span style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>Scan Folders</span>
          </div>
          <button onMouseDown={onClose} className="cursor-pointer" style={{ color: 'rgba(255,255,255,0.35)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">

          {/* Scan status bar */}
          {(scanning || done) && (
            <div className="rounded-[10px] px-4 py-3 flex items-center gap-3"
                 style={{ background: done ? 'rgba(29,158,117,0.12)' : 'rgba(127,119,221,0.1)', border: `0.5px solid ${done ? 'rgba(29,158,117,0.3)' : 'rgba(127,119,221,0.25)'}` }}>
              {done
                ? <Check size={15} style={{ color: '#1D9E75', flexShrink: 0 }} />
                : <Loader2 size={15} className="animate-spin" style={{ color: '#7F77DD', flexShrink: 0 }} />}
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 13, color: done ? '#9FE1CB' : '#CECBF6', fontWeight: 500 }}>
                  {done ? 'Scan complete' : status?.current_file
                    ? `Scanning — ${status.current_file.split(/[\\/]/).pop()}`
                    : 'Starting scan…'}
                </div>
                {scanning && progressPct !== null && (
                  <div className="mt-1.5 rounded-full overflow-hidden" style={{ height: 3, background: 'rgba(255,255,255,0.08)' }}>
                    <div className="h-full rounded-full transition-all duration-300" style={{ width: `${progressPct}%`, background: '#7F77DD' }} />
                  </div>
                )}
                {scanning && status?.total > 0 && (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>
                    {status.scanned} / {status.total} folders
                  </div>
                )}
                {done && status?.new_galleries > 0 && (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
                    {status.new_galleries} new {status.new_galleries === 1 ? 'gallery' : 'galleries'} found
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Full library scan */}
          <button
            onMouseDown={() => triggerScan(null)}
            disabled={scanning}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-[10px] cursor-pointer transition-all disabled:opacity-50"
            style={{ background: 'rgba(127,119,221,0.12)', border: '0.5px solid rgba(127,119,221,0.3)', color: '#CECBF6' }}>
            {scanning && scanningId === null
              ? <Loader2 size={16} className="animate-spin" style={{ flexShrink: 0 }} />
              : <Plus size={16} style={{ flexShrink: 0 }} />}
            <div className="text-left">
              <div style={{ fontSize: 15, fontWeight: 600 }}>Scan Entire Library</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>
                {roots.length} root {roots.length === 1 ? 'folder' : 'folders'} configured
              </div>
            </div>
          </button>

          {/* Divider */}
          {roots.length > 0 && (
            <>
              <div className="flex items-center gap-3">
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>or scan one folder</span>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
              </div>

              {/* Search */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-[8px]"
                   style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                <FolderSearch size={13} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
                <input
                  autoFocus
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search folders…"
                  style={{ background: 'transparent', outline: 'none', fontSize: 14, color: 'rgba(255,255,255,0.8)', width: '100%' }}
                />
              </div>

              {/* Root list */}
              <div className="flex flex-col gap-1.5" style={{ maxHeight: 220, overflowY: 'auto', scrollbarWidth: 'thin' }}>
                {filtered.map(root => (
                  <button
                    key={root.id}
                    onMouseDown={() => triggerScan(root.id)}
                    disabled={scanning}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[8px] cursor-pointer text-left transition-all disabled:opacity-50"
                    style={{ background: scanningId === root.id && scanning ? 'rgba(127,119,221,0.12)' : 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}
                    onMouseEnter={e => { if (!scanning) e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = scanningId === root.id && scanning ? 'rgba(127,119,221,0.12)' : 'rgba(255,255,255,0.03)' }}>
                    {scanning && scanningId === root.id
                      ? <Loader2 size={13} className="animate-spin" style={{ color: '#7F77DD', flexShrink: 0 }} />
                      : <FolderSearch size={13} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />}
                    <div className="min-w-0 flex-1">
                      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {root.label || root.path.split(/[\\/]/).pop()}
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {root.path}
                      </div>
                    </div>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)', textAlign: 'center', padding: '12px 0' }}>
                    No folders match
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Minimal dashboard right-click context menu ────────────────────────────────
function DashMenuButton({ icon: Icon, label, onMouseDown }) {
  return (
    <button type="button" onMouseDown={onMouseDown}
      className="w-full text-left cursor-pointer flex items-center gap-2.5 select-none"
      style={{ padding: '7px 12px', fontSize: 13, color: 'rgba(255,255,255,0.82)', background: 'transparent', transition: 'background 0.08s' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
      <Icon size={13} style={{ flexShrink: 0, opacity: 0.8 }} />
      {label}
    </button>
  )
}

function DashboardContextMenu({ item, itemType, position, onClose }) {
  const menuRef = useRef(null)
  const navigate = useNavigate()
  const addToMultiViewer = useVaultStore(s => s.addToMultiViewer)

  useEffect(() => {
    const onKey  = (e) => { if (e.key === 'Escape') onClose() }
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) onClose() }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
  }, [onClose])

  const x = Math.min(position.x, window.innerWidth  - 188 - 8)
  const y = Math.min(position.y, window.innerHeight - 100 - 8)

  const handleOpen = () => {
    if (itemType === 'gallery') navigate(`/galleries/${item.id}`)
    else navigate(`/galleries/${item.gallery_id}?openImage=${item.id}`)
    onClose()
  }

  const handleSendToViewer = async () => {
    onClose()
    if (itemType === 'gallery') {
      try {
        const res = await galleriesApi.images(item.id)
        const added = addToMultiViewer({ id: `gal-${item.id}`, type: 'gallery', media: item, images: res.data })
        if (added) toast.success('Gallery added to multi-viewer')
        else toast('Already in viewer or viewer is full', { icon: '⚠️' })
      } catch {
        toast.error('Failed to load gallery images')
      }
    } else {
      const added = addToMultiViewer({ id: `img-${item.id}`, type: 'image', media: item })
      if (added) toast.success('Added to multi-viewer')
      else toast('Already in viewer or viewer is full', { icon: '⚠️' })
    }
  }

  return createPortal(
    <div ref={menuRef} style={{
      position: 'fixed', left: x, top: y, zIndex: 9999, width: 188,
      background: 'rgba(22,22,26,0.97)', backdropFilter: 'blur(24px)',
      border: '0.5px solid rgba(255,255,255,0.13)', borderRadius: 10,
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)', padding: '4px 0',
    }}>
      <div style={{ padding: '5px 12px 6px', borderBottom: '0.5px solid rgba(255,255,255,0.07)', marginBottom: 2, fontSize: 11, color: 'rgba(255,255,255,0.3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.name || item.filename || 'Item'}
      </div>
      <DashMenuButton icon={Eye}           label="Open"                   onMouseDown={(e) => { e.stopPropagation(); handleOpen() }} />
      <DashMenuButton icon={LayoutTemplate} label="Send to multi-viewer"  onMouseDown={(e) => { e.stopPropagation(); handleSendToViewer() }} />
    </div>,
    document.body
  )
}

// ── Gallery hover preview tile ────────────────────────────────────────────────
function GalleryHoverTile({ gallery, onClick, onContextMenu }) {
  const [hovered, setHovered]   = useState(false)
  const [imgs, setImgs]         = useState([])
  const [mouseX, setMouseX]     = useState(0.5)
  const fetchedRef              = useRef(false)

  const onMouseEnter = async () => {
    setHovered(true)
    if (!fetchedRef.current && gallery?.id) {
      fetchedRef.current = true
      try {
        const r = await imagesApi.list({ gallery_id: gallery.id, limit: 8 })
        const raw = r.data
        setImgs((raw?.images ?? (Array.isArray(raw) ? raw : [])).filter(i => !i.is_video).slice(0, 6))
      } catch {}
    }
  }

  const onMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setMouseX(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)))
  }

  const visCount  = Math.min(imgs.length, 5)
  const activeIdx = imgs.length > 0 ? Math.min(imgs.length - 1, Math.floor(mouseX * imgs.length)) : 0

  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseLeave={() => setHovered(false)}
      onMouseMove={onMouseMove}
      className="group rounded-[12px] cursor-pointer text-left relative flex flex-col"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '0.5px solid rgba(255,255,255,0.1)',
        minHeight: 88,
        overflow: hovered && imgs.length > 0 ? 'visible' : 'hidden',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnterCapture={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
      onMouseLeaveCapture={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
    >
      {/* Blurred cover background */}
      {gallery?.cover_thumb && (
        <div className="absolute inset-0 transition-opacity duration-300"
             style={{ opacity: hovered ? 0.08 : 0.18, overflow: 'hidden', borderRadius: 12 }}>
          <img src={gallery.cover_thumb} className="w-full h-full object-cover" alt="" />
        </div>
      )}

      {/* Floating photo fan on hover */}
      {hovered && imgs.length > 0 && (
        <div className="absolute pointer-events-none"
             style={{ bottom: '100%', left: '50%', transform: 'translateX(-50%)', paddingBottom: 10, zIndex: 50 }}>
          <div className="relative flex items-end justify-center" style={{ width: 320, height: 200 }}>
            {imgs.slice(0, visCount).map((img, i) => {
              const isActive = i === activeIdx % visCount
              const spread   = (i - (visCount - 1) / 2) * 44
              const rot      = (i - (visCount - 1) / 2) * 5
              return (
                <div key={img.id} style={{
                  position: 'absolute',
                  bottom: 0,
                  left: '50%',
                  transform: `translateX(calc(-50% + ${spread}px)) rotate(${rot}deg) translateY(${isActive ? -18 : 0}px)`,
                  transition: 'transform 0.18s ease, box-shadow 0.18s ease, z-index 0s',
                  zIndex: isActive ? 10 : visCount - Math.abs(i - activeIdx % visCount),
                  boxShadow: isActive ? '0 14px 32px rgba(0,0,0,0.8)' : '0 6px 16px rgba(0,0,0,0.6)',
                  borderRadius: 8,
                  overflow: 'hidden',
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
      )}

      {/* Tile content */}
      <div className="relative p-3 flex flex-col justify-between" style={{ minHeight: 88 }}>
        <div className="text-[11px] uppercase tracking-wider font-medium" style={{ color: 'rgba(255,255,255,0.3)' }}>
          Random gallery
        </div>
        <div>
          <div className="text-[15px] font-semibold text-white truncate">{gallery?.name ?? '—'}</div>
          <div className="text-[12px] mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
            {gallery?.image_count ?? 0} photos{gallery?.creator_name ? ` · ${gallery.creator_name}` : ''}
          </div>
        </div>
      </div>
    </button>
  )
}

// ── Tabbed random discovery section ──────────────────────────────────────────
const RAND_TABS = [
  { key: 'galleries', label: 'Galleries', color: '#7F77DD' },
  { key: 'photos',    label: 'Photos',    color: '#D4537E' },
  { key: 'videos',    label: 'Videos',    color: '#7F77DD' },
  { key: 'creators',  label: 'Creators',  color: '#BA7517' },
]

function RandomDiscovery({ galleries, images, videos, creators, onContextMenu }) {
  const [tab, setTab] = useState('galleries')
  const navigate = useNavigate()
  const active = RAND_TABS.find(t => t.key === tab)

  const allData = { galleries, photos: images, videos, creators }
  const items = allData[tab] ?? []

  const browseLinks = { galleries: '/galleries', photos: '/images', videos: '/videos', creators: '/creators' }

  return (
    <div>
      {/* Header row with inline tabs */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center gap-2 text-[17px] font-medium text-[rgba(255,255,255,0.85)]">
          <Shuffle size={16} style={{ color: active.color }} /> Discover
        </div>
        <div className="flex items-center gap-1 ml-1">
          {RAND_TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
                    className="px-2.5 py-0.5 rounded-full text-[13px] cursor-pointer transition-all"
                    style={{
                      background: tab === t.key ? `${t.color}22` : 'transparent',
                      color: tab === t.key ? t.color : 'rgba(255,255,255,0.3)',
                      border: `0.5px solid ${tab === t.key ? `${t.color}55` : 'transparent'}`,
                    }}>
              {t.label}
            </button>
          ))}
        </div>
        <button onClick={() => navigate(browseLinks[tab])} className="ml-auto text-[15px] cursor-pointer" style={{ color: '#7F77DD' }}>
          browse all
        </button>
      </div>

      {/* Card grid */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
        {items.map(item => {
          if (tab === 'galleries') {
            return <PortraitCard key={item.id} imgSrc={item.cover_thumb} title={item.name}
                      sub={`${item.image_count} photos${item.creator_name ? ' · ' + item.creator_name : ''}`}
                      onClick={() => navigate(`/galleries/${item.id}`)}
                      onContextMenu={(e) => onContextMenu?.(e, item, 'gallery')} />
          }
          if (tab === 'photos') {
            return <PortraitCard key={item.id} imgSrc={`/api/images/${item.id}/thumb`} title={item.filename}
                      sub={item.gallery_name} onClick={() => navigate(`/galleries/${item.gallery_id}?openImage=${item.id}`)}
                      onContextMenu={(e) => onContextMenu?.(e, item, 'image')} />
          }
          if (tab === 'videos') {
            return <PortraitCard key={item.id} imgSrc={`/api/images/${item.id}/thumb`} title={item.filename}
                      sub={item.gallery_name} onClick={() => navigate(`/galleries/${item.gallery_id}?openImage=${item.id}`)}
                      onContextMenu={(e) => onContextMenu?.(e, item, 'video')}
                      fallbackIcon={<Play size={28} style={{ color: 'rgba(255,255,255,0.1)' }} />} />
          }
          // creators — no context menu
          const tc = TYPE_COLORS[item.creator_type] || TYPE_COLORS.custom
          const initials = item.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
          return <PortraitCard key={item.id} imgSrc={item.avatar_path ? `/api/creators/${item.id}/avatar` : null}
                    title={item.title || item.name} sub={item.creator_type}
                    onClick={() => navigate(`/creators/${item.id}`)}
                    fallbackIcon={<span className="text-[40px] font-semibold select-none" style={{ color: tc.text, opacity: 0.7 }}>{initials}</span>} />
        })}
      </div>
    </div>
  )
}

// ── DASHBOARD v2 — June 2026 redesign ─────────────────────────────────────────
// To revert: git checkout HEAD -- frontend/src/pages/Dashboard.jsx
// ─────────────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate()
  const addXpToast       = useVaultStore(s => s.addXpToast)
  const avatarBust       = useVaultStore(s => s.avatarBust)
  const sessionActive    = useVaultStore(s => s.sessionActive)
  const sessionStartAt   = useVaultStore(s => s.sessionStartAt)
  const startSession     = useVaultStore(s => s.startSession)
  const endSession       = useVaultStore(s => s.endSession)
  const qc = useQueryClient()

  const profile = useVaultStore(s => s.profile)

  // Live elapsed timer — ticks every second while session is active
  const [tickNow, setTickNow] = useState(Date.now())
  useEffect(() => {
    if (!sessionActive) return
    const id = setInterval(() => setTickNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [sessionActive])
  const sessionElapsedMs = sessionActive && sessionStartAt ? tickNow - sessionStartAt : 0

  // Greeting — pick once per app launch (sessionStorage clears on tab close)
  const [greeting] = useState(() => getOrCreateGreeting(profile?.username || profile?.name))

  const addToMultiViewer = useVaultStore(s => s.addToMultiViewer)

  const [showMission, setShowMission] = useState(false)
  const [showMoreStats, setShowMoreStats] = useState(false)
  const [showScanModal, setShowScanModal] = useState(false)
  const [collectionsOpen, setCollectionsOpen] = useState(false)
  const [showSpinModal, setShowSpinModal] = useState(false)
  const [showMixModal, setShowMixModal] = useState(false)
  const [ctxMenu, setCtxMenu] = useState(null) // { item, itemType, x, y }

  const openCtx = useCallback((e, item, itemType) => {
    e.preventDefault()
    setCtxMenu({ item, itemType, position: { x: e.clientX, y: e.clientY } })
  }, [])

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
  const { data: favorites }      = useQuery({ queryKey: ['favorites',        avatarBust], queryFn: () => creatorsApi.favorites().then(r => r.data) })
  const { data: imageHof }       = useQuery({ queryKey: ['hof',          4],              queryFn: () => galleriesApi.hof(4).then(r => r.data) })
  const { data: galleryHof }     = useQuery({ queryKey: ['gallery-hof',  4],              queryFn: () => galleriesApi.galleryHof(4).then(r => r.data) })
  const { data: creatorHof }     = useQuery({ queryKey: ['creator-hof',  4, avatarBust],  queryFn: () => creatorsApi.hof(4).then(r => r.data) })
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
  const { data: epicCards }      = useQuery({ queryKey: ['epic-cards-strip'], queryFn: () => cardsApi.inventory({ sort: 'rarity_desc', limit: 20 }).then(r => (r.data?.items ?? []).filter(c => ['epic','legendary','relic','celestial'].includes(c.rarity))) })

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
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-[22px] font-medium text-white">Dashboard</div>
          {(profile?.streak_days ?? 0) > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full"
                 style={{ background: 'rgba(186,117,23,0.15)', border: '0.5px solid rgba(186,117,23,0.35)' }}>
              <Flame size={13} style={{ color: '#BA7517' }} />
              <span className="text-[14px] font-semibold" style={{ color: '#FAC775' }}>
                Day {profile.streak_days}
              </span>
            </div>
          )}
          {/* Greeting — shown once per session (fades in slowly) */}
          {greeting && (
            <span className="text-[15px]" style={{
              color: 'rgba(255,255,255,0.35)',
              animation: 'vault-fade-in 1.8s ease forwards',
              fontStyle: 'italic',
            }}>
              {greeting}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={handleRandomGallery}
                  className="flex items-center gap-2 font-medium rounded-full cursor-pointer"
                  style={{ fontSize: 14, padding: '8px 18px', background: 'rgba(186,117,23,0.15)', color: '#FAC775', border: '0.5px solid rgba(186,117,23,0.3)' }}>
            <Dice6 size={15} /> Random Gallery
          </button>
          <button onClick={() => setShowMixModal(true)}
                  className="flex items-center gap-2 font-medium rounded-full cursor-pointer"
                  style={{ fontSize: 14, padding: '8px 18px', background: 'rgba(127,119,221,0.15)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.3)' }}>
            <Shuffle size={15} /> Random Mix
          </button>
        </div>
      </div>

      {/* ── Vault stats strip ──────────────────────────────────────────────── */}
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
        {statsLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-[8px] p-2.5 flex flex-col gap-1.5" style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)', minHeight: 56 }}>
              <div className="skeleton" style={{ height: 10, width: '55%' }} />
              <div className="skeleton" style={{ height: 18, width: '70%' }} />
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
          { icon: Target,    label: 'Collection value', value: `$${(stats?.collection_value ?? 0).toLocaleString()}`, color: '#1D9E75', onClick: () => setCollectionsOpen(v => !v) },
        ].map(({ icon: Icon, label, value, subValue, color, onClick }) => {
          const valStr = String(value || '');
          const isLong = valStr.length > 7;
          return (
            <div key={label}
                 onClick={onClick}
                 className="rounded-[8px] p-2.5 flex flex-col justify-center relative overflow-hidden"
                 style={{
                   background: 'rgba(255,255,255,0.04)',
                   border: `0.5px solid ${onClick && collectionsOpen ? 'rgba(29,158,117,0.4)' : 'rgba(255,255,255,0.08)'}`,
                   gridColumn: isLong ? 'span 2' : 'auto',
                   cursor: onClick ? 'pointer' : 'default',
                 }}>
              <div className="flex items-center gap-1 mb-1">
                <Icon size={11} style={{ color: 'rgba(255,255,255,0.2)' }} />
                <span className="text-[12px] text-[rgba(255,255,255,0.35)] truncate">{label}</span>
              </div>
              <div className="text-[18px] font-medium leading-none truncate">
                <AnimatedStatValue value={value} color={color} />
              </div>
              {subValue && <div className="absolute right-2 bottom-1.5 text-[13px] font-bold" style={{ color }}>{subValue}</div>}
            </div>
          )
        })}

        {/* ── More Stats button tile ─────────────────────────────── */}
        <button
          onClick={() => setShowMoreStats(true)}
          className="rounded-[8px] p-2.5 flex flex-col justify-center cursor-pointer transition-all duration-150"
          style={{ background: 'rgba(127,119,221,0.07)', border: '0.5px solid rgba(127,119,221,0.2)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(127,119,221,0.14)'; e.currentTarget.style.borderColor = 'rgba(127,119,221,0.4)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(127,119,221,0.07)'; e.currentTarget.style.borderColor = 'rgba(127,119,221,0.2)' }}
        >
          <div className="flex items-center gap-1 mb-1">
            <BarChart2 size={11} style={{ color: 'rgba(127,119,221,0.5)' }} />
            <span className="text-[12px] truncate" style={{ color: 'rgba(127,119,221,0.6)' }}>Stats</span>
          </div>
          <div className="text-[14px] font-medium" style={{ color: '#CECBF6' }}>More →</div>
        </button>
      </div>

      {/* ── Top collections dropdown ───────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {collectionsOpen && (
          <motion.div
            key="collections-drop"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
          >
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
          </motion.div>
        )}
      </AnimatePresence>

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

          {/* ── Hero action tiles ─────────────────────────────────────────────── */}
          {(stats?.total_galleries ?? 0) > 0 && (randomGalleries ?? []).length > 0 && (
            <div className="grid gap-3" style={{ gridTemplateColumns: '1.2fr 1fr 1fr' }}>
              {/* Random gallery with hover photo preview */}
              <GalleryHoverTile
                gallery={randomGalleries[0]}
                onClick={() => navigate(`/galleries/${randomGalleries[0].id}`)}
                onContextMenu={(e) => openCtx(e, randomGalleries[0], 'gallery')}
              />

              {/* TCG shortcut — strip of epic+ cards */}
              <button onClick={() => navigate('/collection')}
                      className="rounded-[12px] cursor-pointer text-left flex flex-col p-3 group"
                      style={{ minHeight: 120, background: 'rgba(127,119,221,0.07)', border: '0.5px solid rgba(127,119,221,0.2)', transition: 'background 0.15s, border-color 0.15s', gap: 8 }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(127,119,221,0.13)'; e.currentTarget.style.borderColor = 'rgba(127,119,221,0.45)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(127,119,221,0.07)'; e.currentTarget.style.borderColor = 'rgba(127,119,221,0.2)' }}>
                <div className="text-[11px] uppercase tracking-wider font-medium" style={{ color: 'rgba(127,119,221,0.6)' }}>Card Collection</div>
                {(epicCards ?? []).length > 0 ? (
                  <div className="flex items-end justify-center flex-1" style={{ gap: 0 }}>
                    {epicCards.slice(0, 5).map((c, i, arr) => {
                      const rc = { epic: '#7F77DD', legendary: '#BA7517', relic: '#E24B4A', celestial: '#FAC775' }[c.rarity] ?? '#7F77DD'
                      const isCenter = i === Math.floor(arr.slice(0, 5).length / 2)
                      return (
                        <div key={c.inventory_id} style={{
                          width: isCenter ? 58 : 46,
                          height: isCenter ? 86 : 68,
                          borderRadius: 7,
                          overflow: 'hidden',
                          flexShrink: 0,
                          border: `2px solid ${rc}`,
                          boxShadow: `0 0 16px ${rc}77, 0 4px 12px rgba(0,0,0,0.6)`,
                          marginLeft: i === 0 ? 0 : -12,
                          zIndex: isCenter ? 10 : 5 - Math.abs(i - Math.floor(arr.slice(0, 5).length / 2)),
                          background: '#111',
                          transition: 'transform 0.15s',
                        }}>
                          {c.thumb_url
                            ? <img src={c.thumb_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <div style={{ width: '100%', height: '100%', background: `${rc}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span style={{ fontSize: 11, color: rc, fontWeight: 800 }}>{c.rarity?.[0]?.toUpperCase()}</span>
                              </div>
                          }
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center">
                    <span style={{ fontSize: 13, color: 'rgba(127,119,221,0.35)' }}>No epic+ cards yet</span>
                  </div>
                )}
                <div style={{ fontSize: 12, color: 'rgba(127,119,221,0.5)' }}>
                  {(epicCards ?? []).length > 0 ? `${epicCards.length} epic+ owned →` : 'Open packs →'}
                </div>
              </button>

              {/* Session start/stop — elapsed time from sessionStartAt, not accumulated total */}
              <button onClick={handleSessionBtn}
                      className="rounded-[12px] cursor-pointer text-left flex flex-col justify-between p-3"
                      style={{
                        minHeight: 88,
                        transition: 'background 0.15s, border-color 0.15s',
                        ...(sessionActive
                          ? { background: 'rgba(212,83,126,0.18)', border: '0.5px solid rgba(212,83,126,0.45)' }
                          : { background: 'rgba(212,83,126,0.08)', border: '0.5px solid rgba(212,83,126,0.2)' })
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = sessionActive ? 'rgba(212,83,126,0.28)' : 'rgba(212,83,126,0.14)'
                        e.currentTarget.style.borderColor = 'rgba(212,83,126,0.5)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = sessionActive ? 'rgba(212,83,126,0.18)' : 'rgba(212,83,126,0.08)'
                        e.currentTarget.style.borderColor = sessionActive ? 'rgba(212,83,126,0.45)' : 'rgba(212,83,126,0.2)'
                      }}>
                <div className="text-[11px] uppercase tracking-wider font-medium" style={{ color: 'rgba(212,83,126,0.7)' }}>
                  {sessionActive ? 'Session active' : 'Session'}
                </div>
                <div>
                  <div className="text-[15px] font-semibold" style={{ color: '#ED93B1' }}>
                    {sessionActive ? `⏹ End — ${fmtMs(sessionElapsedMs)}` : '▶ Start session'}
                  </div>
                  <div className="text-[12px] mt-0.5" style={{ color: 'rgba(212,83,126,0.5)' }}>
                    {sessionActive ? 'Log when you finish' : '+25 XP when you finish'}
                  </div>
                </div>
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

          {/* ── Tabbed random discovery ────────────────────────────────────────── */}
          {((randomGalleries?.length ?? 0) + (randomImages?.length ?? 0) + (randomVideos?.length ?? 0) + (randomCreators?.length ?? 0)) > 0 && (
            <RandomDiscovery
              galleries={randomGalleries}
              images={randomImages}
              videos={randomVideos}
              creators={randomCreators}
              onContextMenu={openCtx}
            />
          )}

          {/* ── Recently added ────────────────────────────────────────────────── */}
          {(recent ?? []).length > 0 && (
            <RevealSection>
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-[17px] font-medium text-[rgba(255,255,255,0.85)]">
                    <Clock size={16} style={{ color: 'rgba(255,255,255,0.4)' }} /> Recently added
                  </div>
                  <button onClick={() => navigate('/galleries')} className="text-[15px] cursor-pointer" style={{ color: '#7F77DD' }}>view all</button>
                </div>
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
                  {recent.map(g => (
                    <PortraitCard key={g.id} imgSrc={g.cover_thumb} title={g.name}
                      sub={`${g.image_count} photos${g.creator_name ? ' · ' + g.creator_name : ''}`}
                      onClick={() => navigate(`/galleries/${g.id}`)}
                      onContextMenu={(e) => openCtx(e, g, 'gallery')} />
                  ))}
                </div>
              </div>
            </RevealSection>
          )}

          {/* ── Creator Hall of Fame ───────────────────────────────────────────── */}
          {(creatorHof ?? []).length > 0 && (
            <RevealSection delay={40}>
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
            </RevealSection>
          )}

        </div>

        {/* RIGHT: sticky sidebar */}
        <div className="flex flex-col gap-4"
             style={{ position: 'sticky', top: 20, maxHeight: 'calc(100vh - 40px)', overflowY: 'auto', scrollbarWidth: 'none' }}>

          {/* ── Tools ────────────────────────────────────────── */}
          <div className="rounded-[12px] p-4"
               style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
            <div className="flex items-center gap-1.5 font-medium uppercase tracking-wider mb-3"
                 style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>
              <Zap size={14} style={{ color: '#7F77DD' }} /> Tools
            </div>
            <div className="flex flex-col gap-2">
              <button onClick={() => setShowScanModal(true)}
                      className="w-full flex items-center gap-2.5 py-2.5 px-3 rounded-[8px] cursor-pointer transition-all"
                      style={{ background: 'rgba(29,158,117,0.12)', color: '#9FE1CB', border: '0.5px solid rgba(29,158,117,0.25)', fontSize: 15, fontWeight: 500 }}>
                <Plus size={15} /> Scan Folders
              </button>
              <button onClick={() => setShowMission(true)}
                      className="w-full flex items-center gap-2.5 py-2.5 px-3 rounded-[8px] cursor-pointer transition-all"
                      style={{ background: 'rgba(186,117,23,0.12)', color: '#FAC775', border: '0.5px solid rgba(186,117,23,0.25)', fontSize: 15, fontWeight: 500 }}>
                <Dice6 size={15} /> Daily Tagging
              </button>
            </div>
          </div>

          {/* ── Daily Quests ─────────────────────────────────── */}
          {(quests ?? []).filter(q => q.quest_type === 'daily' && q.status !== 'completed').length > 0 && (
            <div className="rounded-[12px] p-4"
                 style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5 font-medium uppercase tracking-wider"
                     style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>
                  <Calendar size={14} style={{ color: '#BA7517' }} /> Daily Quests
                </div>
                <button onClick={() => navigate('/quests')} style={{ fontSize: 14, color: '#7F77DD', cursor: 'pointer' }}>all →</button>
              </div>
              <div className="flex flex-col gap-3">
                {quests.filter(q => q.quest_type === 'daily' && q.status !== 'completed').map(q => {
                  const pct = q.target > 0 ? Math.min(100, Math.round((q.progress / q.target) * 100)) : 0
                  return (
                    <div key={q.id}>
                      <div className="flex items-center justify-between mb-1">
                        <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.75)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>
                          {q.title || q.key}
                        </span>
                        <span style={{ fontSize: 14, color: '#BA7517', fontWeight: 600, flexShrink: 0 }}>+{q.xp_reward} XP</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div style={{ flex: 1, height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? '#1D9E75' : '#BA7517', borderRadius: 99, transition: 'width 0.4s ease' }} />
                        </div>
                        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>{q.progress}/{q.target}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Weekly Quests ─────────────────────────────────── */}
          {(quests ?? []).filter(q => q.quest_type === 'weekly' && q.status !== 'completed').length > 0 && (
            <div className="rounded-[12px] p-4"
                 style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5 font-medium uppercase tracking-wider"
                     style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>
                  <Target size={14} style={{ color: '#7F77DD' }} /> Weekly Quests
                </div>
                <button onClick={() => navigate('/quests')} style={{ fontSize: 14, color: '#7F77DD', cursor: 'pointer' }}>all →</button>
              </div>
              <div className="flex flex-col gap-3">
                {quests.filter(q => q.quest_type === 'weekly' && q.status !== 'completed').map(q => {
                  const pct = q.target > 0 ? Math.min(100, Math.round((q.progress / q.target) * 100)) : 0
                  return (
                    <div key={q.id}>
                      <div className="flex items-center justify-between mb-1">
                        <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.75)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>
                          {q.title || q.key}
                        </span>
                        <span style={{ fontSize: 14, color: '#7F77DD', fontWeight: 600, flexShrink: 0 }}>+{q.xp_reward} XP</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div style={{ flex: 1, height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? '#1D9E75' : '#7F77DD', borderRadius: 99, transition: 'width 0.4s ease' }} />
                        </div>
                        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>{q.progress}/{q.target}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

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
      {showScanModal && <ScanModal onClose={() => setShowScanModal(false)} />}
      {showSpinModal && <SpinModal onClose={() => setShowSpinModal(false)} />}
      {showMixModal && <RandomMixModal onClose={() => setShowMixModal(false)} />}
      {ctxMenu && (
        <DashboardContextMenu
          item={ctxMenu.item}
          itemType={ctxMenu.itemType}
          position={ctxMenu.position}
          onClose={() => setCtxMenu(null)}
        />
      )}

    </div>
  )
}

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Trophy, Droplets, Images, Eye, Crown, Play, Film, Clock, TrendingUp, ArrowUp, ArrowDown, ChevronDown, X } from 'lucide-react'
import { galleriesApi, creatorsApi, systemApi } from '../lib/api'
import HofPeriodToggle, { HOF_PERIODS, loadHofPeriod, saveHofPeriod } from '../components/HofPeriodToggle'
import CreatorCollageBackground from '../components/CreatorCollageBackground'
import CreatorStatsModal from '../components/CreatorStatsModal'
import HofFullListModal from '../components/HofFullListModal'
import GalleryStatsModal from '../components/stats/GalleryStatsModal'
import MediaStatsModal from '../components/stats/MediaStatsModal'

// ── Color maps ────────────────────────────────────────────────────────────────
const TYPE_COLORS = {
  cosplayer: { bg: 'rgba(29,158,117,0.25)',  text: '#9FE1CB' },
  ethot:     { bg: 'rgba(212,83,126,0.25)',  text: '#ED93B1' },
  artist:    { bg: 'rgba(127,119,221,0.25)', text: '#CECBF6' },
  character: { bg: 'rgba(186,117,23,0.25)',  text: '#FAC775' },
  actress:   { bg: 'rgba(212,83,126,0.25)',  text: '#ED93B1' },
  custom:    { bg: 'rgba(136,135,128,0.25)', text: '#D3D1C7' },
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

const PODIUM_META = [
  { rank: 2, label: 'Silver', color: '#B8C4CC', height: 442, scale: 1 },
  { rank: 1, label: 'Gold',   color: '#FAC775', height: 572, scale: 1.04 },
  { rank: 3, label: 'Bronze', color: '#BA7517', height: 390, scale: 1 },
]

// Cache-busting avatar URL — avatar_path stores a UUID filename that changes on each upload
function creatorAvatarUrl(creator, size = 480) {
  if (!creator.avatar_path) return null
  const bust = encodeURIComponent(creator.avatar_path.split(/[\\/]/).pop() || '')
  return `/api/creators/${creator.id}/avatar-thumb?size=${size}&v=${bust}`
}

// Local-calendar start of a period — mirrors activity.period_start() on the
// backend so the "partial window" warning agrees with what was actually scored.
function periodStartLocal(period) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (period === 'day')   return d
  if (period === 'week')  { const back = (d.getDay() + 6) % 7; d.setDate(d.getDate() - back); return d }  // Monday
  if (period === 'month') { d.setDate(1); return d }
  return null
}

// A window that opened before engagement logging existed can only ever show
// part of itself. Say so, rather than passing four days off as a whole month.
function partialWindowNote(period, trackingSince) {
  const start = periodStartLocal(period)
  if (!start) return null
  // No events recorded yet means tracking effectively begins now — which is the
  // state where this warning matters most, so it must not be the silent case.
  const since = trackingSince ? new Date(trackingSince) : new Date()
  if (since <= start) return null
  return since.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const PERIOD_SUBTITLE = {
  day:   'Who you actually spent today with — resets at midnight',
  week:  'This week so far — resets Monday',
  month: 'This month so far — resets on the 1st',
  all:   'Your most visited content — ranked by views, cum count shown alongside',
}

const PERIOD_EMPTY = {
  day:   'Nothing logged today yet. Open a gallery, and today\'s board starts filling.',
  week:  'Nothing logged this week yet.',
  month: 'Nothing logged this month yet.',
  all:   'Browse your collection to start building this list.',
}

// ── Shared stat row ───────────────────────────────────────────────────────────
// Shows the raw signals that actually drive Hall of Fame ranking (see _score in
// creators.py) — views/cum alone don't explain a creator's rank, watch time and
// session count are weighted far more heavily, so surface watch time here too.
function StatRow({ views, cum, viewSeconds, dwell, engagement, size = 12 }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="flex items-center gap-1" style={{ fontSize: size, color: 'rgba(255,255,255,0.45)' }}
            title="Total views — every gallery open plus every photo and video viewed">
        <Eye size={size - 2} /> {(views ?? 0).toLocaleString()}
      </span>
      {(cum ?? 0) > 0 && (
        <span className="flex items-center gap-1" style={{ fontSize: size, color: '#D4537E' }}>
          <Droplets size={size - 2} /> {cum.toLocaleString()}
        </span>
      )}
      {(viewSeconds ?? 0) > 0 && (
        <span className="flex items-center gap-1" style={{ fontSize: size, color: '#9F99E8' }} title="Time spent viewing — a major factor in Hall of Fame ranking">
          <Clock size={size - 2} /> {formatViewTimeFull(viewSeconds)}
        </span>
      )}
      {(dwell ?? 0) > 0 && (
        <span className="flex items-center gap-1" style={{ fontSize: size, color: '#9FE1CB' }}
              title={`You linger ${dwell}s on each of her photos — attention per photo scales her ranking${engagement ? ` (×${engagement})` : ''}`}>
          <TrendingUp size={size - 2} /> {dwell}s
        </span>
      )}
    </div>
  )
}

// ── Rank movement chip ────────────────────────────────────────────────────────
// League-table style: green up / red down with the number of places moved.
// A movement stays on screen until the next one, so it reads as "change since
// this last moved" rather than blinking away on the next page load.
// Used by creators, galleries and individual files alike, so the wording stays
// neutral rather than saying "her".
function RankChange({ change, size = 12 }) {
  if (!change) return null
  const up = change > 0
  const color = up ? '#1D9E75' : '#D4537E'
  const Icon  = up ? ArrowUp : ArrowDown
  return (
    <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full flex-shrink-0"
          title={`${up ? 'Climbed' : 'Dropped'} ${Math.abs(change)} place${Math.abs(change) === 1 ? '' : 's'} since it last moved`}
          style={{ fontSize: size, fontWeight: 700, color, background: `${color}1F`, border: `0.5px solid ${color}55` }}>
      <Icon size={size} /> {Math.abs(change)}
    </span>
  )
}

// ── "Know more" button ────────────────────────────────────────────────────────
// Each section shows only its top entries; this opens the rest as a full list.
function KnowMoreButton({ onClick, label }) {
  return (
    <div className="flex justify-center mt-8">
      <button onClick={onClick}
              className="flex items-center gap-2 px-5 py-3 rounded-[10px] cursor-pointer transition-all hover:bg-white/[0.08]"
              style={{ fontSize: 17, color: 'rgba(255,255,255,0.6)',
                       background: 'rgba(255,255,255,0.04)',
                       border: '0.5px solid rgba(255,255,255,0.12)' }}>
        {label} <ChevronDown size={16} />
      </button>
    </div>
  )
}

// ── Tier divider ──────────────────────────────────────────────────────────────
function TierLabel({ label, color = 'rgba(255,255,255,0.15)' }) {
  return (
    <div className="flex items-center gap-3 mt-8 mb-4">
      <div className="h-px flex-1" style={{ background: color }} />
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color }}>{label}</span>
      <div className="h-px flex-1" style={{ background: color }} />
    </div>
  )
}

// ── Rarity pill ───────────────────────────────────────────────────────────────
function RarityPill({ rarity }) {
  if (!rarity || rarity === 'common') return null
  const rc = RARITY_COLORS[rarity] || RARITY_COLORS.common
  const label = RARITY_LABELS[rarity] || rarity
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full flex-shrink-0"
          style={{ background: `${rc}22`, color: rc, border: `0.5px solid ${rc}66` }}>
      {label}
    </span>
  )
}

// ── Premium podium rank badge ─────────────────────────────────────────────────
// #1 gold shimmer + heavy glow, #2 silver + moderate glow, #3 bronze + light glow
const PODIUM_BADGE_STYLES = {
  1: {
    gradient:    'linear-gradient(145deg, #FFF4A0 0%, #FAC775 30%, #D48A10 60%, #FFE580 85%, #FAC775 100%)',
    shadow:      '0 0 0 2.5px #FAC77590, 0 0 20px 6px #FAC77558, 0 0 48px 18px #FAC77530',
    color:       '#3A2200',
    size: 58, fontSize: 24,
    // Bright, fast sweep — very premium
    shineColor:  'rgba(255,255,255,0.55)',
    shineDur:    '2.2s',
  },
  2: {
    gradient:    'linear-gradient(145deg, #F4F8FA 0%, #C8D8E8 30%, #8AAABF 60%, #E8F2F8 85%, #B8C4CC 100%)',
    shadow:      '0 0 0 1.5px #B8C4CC70, 0 0 14px 4px #B8C4CC40',
    color:       '#0E1E2A',
    size: 58, fontSize: 24,
    // Softer, slower sweep
    shineColor:  'rgba(255,255,255,0.32)',
    shineDur:    '3.8s',
  },
  3: {
    gradient:    'linear-gradient(145deg, #E8A85A 0%, #BA7517 30%, #7A4A10 60%, #D08A40 85%, #BA7517 100%)',
    shadow:      '0 0 0 1px #BA751750, 0 0 8px 2px #BA751728',
    color:       '#FFF4E8',
    size: 58, fontSize: 24,
    // Very subtle, slow sweep
    shineColor:  'rgba(255,255,255,0.18)',
    shineDur:    '5.5s',
  },
}

function PodiumBadge({ rank }) {
  const b = PODIUM_BADGE_STYLES[rank]
  if (!b) return null
  // Gold uses Tailwind class (forces keyframe into CSS output); silver/bronze reference same keyframe via inline style
  const shineClass = rank === 1 ? 'animate-badge-shine' : ''
  const shineStyle = rank !== 1 ? { animation: `badge-shine ${b.shineDur} ease-in-out infinite` } : {}
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      width: b.size, height: b.size, borderRadius: '50%',
      background: b.gradient, boxShadow: b.shadow,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: b.fontSize, fontWeight: 900, color: b.color,
      flexShrink: 0, letterSpacing: '-0.02em',
    }}>
      {rank}
      {/* Animated shine sweep — clipped to circle by overflow:hidden */}
      <div className={shineClass}
           style={{
             position: 'absolute', top: 0, bottom: 0, width: '35%',
             background: `linear-gradient(90deg, transparent, ${b.shineColor}, transparent)`,
             pointerEvents: 'none',
             ...shineStyle,
           }} />
    </div>
  )
}

function formatViewTime(secs) {
  if (!secs || secs < 60) return null
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

// Always returns a string — shows seconds for small values
function formatViewTimeFull(secs) {
  if (!secs || secs <= 0) return '0s'
  if (secs < 60) return `${secs}s`
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

// ── Rank badge for media/gallery cards ────────────────────────────────────────
const RANK_BADGE_STYLES = {
  1: { bg: 'linear-gradient(145deg, #FFF4A0, #FAC775, #D48A10)', color: '#3A2200', border: 'none', size: 30, fs: 13 },
  2: { bg: 'linear-gradient(145deg, #F4F8FA, #C8D8E8, #8AAABF)',  color: '#0E1E2A', border: 'none', size: 30, fs: 13 },
  3: { bg: 'linear-gradient(145deg, #E8A85A, #BA7517, #7A4A10)',  color: '#FFF4E8', border: 'none', size: 30, fs: 13 },
}

function RankBadge({ rank }) {
  const s = RANK_BADGE_STYLES[rank] ?? {
    bg: 'rgba(0,0,0,0.75)', color: 'rgba(255,255,255,0.65)',
    border: '0.5px solid rgba(255,255,255,0.18)', size: 22, fs: 10,
  }
  return (
    <div style={{
      width: s.size, height: s.size, borderRadius: '50%',
      background: s.bg, color: s.color, border: s.border,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: s.fs, fontWeight: 800, flexShrink: 0,
    }}>
      {rank}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// CREATOR SECTION
// ══════════════════════════════════════════════════════════════════════════════

function CreatorHero({ creator, onClick }) {
  const [imgFailed, setImgFailed] = useState(false)
  const tc  = TYPE_COLORS[creator.creator_type] || TYPE_COLORS.custom
  const rc  = RARITY_COLORS[creator.card_rarity] || RARITY_COLORS.common
  // #1 is the biggest, most prominent portrait — give it near-full resolution so
  // it never looks pixelated. It's a single image, so the cost is negligible.
  const url = creatorAvatarUrl(creator, 1600)
  const initials = creator.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div onClick={onClick}
         className="relative overflow-hidden rounded-[16px] cursor-pointer group"
         style={{ height: 460, boxShadow: `0 0 60px 12px ${rc}28` }}>

      {/* Blurred bg — face anchored to top */}
      {url && !imgFailed
        ? <img src={url} alt="" onError={() => setImgFailed(true)}
               style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
                        objectFit: 'cover', objectPosition: 'top center',
                        filter: 'blur(22px)', transform: 'scale(1.12)', opacity: 0.45 }} />
        : <div style={{ position: 'absolute', inset: 0, background: tc.bg }} />
      }

      {/* Gradient overlays */}
      <div style={{ position: 'absolute', inset: 0,
                    background: 'linear-gradient(to right, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 50%, rgba(0,0,0,0.1) 100%)' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 100,
                    background: 'linear-gradient(to top, rgba(14,14,14,0.9), transparent)' }} />

      {/* Decorative "#1" fills the right void */}
      <div style={{
        position: 'absolute', right: 40, top: '50%', transform: 'translateY(-50%)',
        fontSize: 240, fontWeight: 900, lineHeight: 1,
        color: rc, opacity: 0.07, userSelect: 'none', letterSpacing: '-0.05em',
      }}>
        #1
      </div>
      {/* Crown watermark */}
      <div style={{ position: 'absolute', top: 24, right: 28, opacity: 0.11 }}>
        <Crown size={88} style={{ color: '#FAC775' }} />
      </div>

      {/* Content */}
      <div className="relative h-full flex items-center gap-10 px-10">

        {/* Portrait — tall, face anchored to top so heads are never clipped */}
        <div className="flex-shrink-0 rounded-[14px] overflow-hidden group-hover:scale-[1.02] transition-transform duration-300"
             style={{ width: 230, height: 400,
                      border: `1.5px solid ${rc}99`,
                      boxShadow: `0 0 30px 6px ${rc}44` }}>
          {url && !imgFailed
            ? <img src={url} alt={creator.name} onError={() => setImgFailed(true)}
                   style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }} />
            : <div style={{ width: '100%', height: '100%', background: tc.bg,
                            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 72, fontWeight: 700, color: tc.text, opacity: 0.7 }}>{initials}</span>
              </div>
          }
        </div>

        {/* Text block */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Crown size={16} style={{ color: '#FAC775' }} />
            <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
                           letterSpacing: '0.14em', color: '#FAC775' }}>
              #1 · Most Visited Creator
            </span>
            <RankChange change={creator.rank_change} size={13} />
          </div>
          <h2 style={{ fontSize: 52, fontWeight: 800, color: 'rgba(255,255,255,0.95)',
                       lineHeight: 1.05, textShadow: '0 2px 20px rgba(0,0,0,0.6)' }}>
            {creator.name}
          </h2>
          <div className="flex items-center gap-3">
            <RarityPill rarity={creator.card_rarity} />
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', textTransform: 'capitalize' }}>
              {creator.creator_type}
            </span>
          </div>
          <StatRow views={creator.total_views} cum={creator.total_cum} dwell={creator.avg_dwell_seconds} engagement={creator.engagement_factor} size={15} />
          {(creator.total_view_seconds ?? 0) > 0 ? (
            <div className="flex flex-col gap-1 mt-2"
                 style={{ background: 'rgba(127,119,221,0.08)', border: '0.5px solid rgba(127,119,221,0.2)',
                          borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                            letterSpacing: '0.1em', color: 'rgba(127,119,221,0.6)' }}>
                Time spent with {creator.name}
              </div>
              <div className="flex items-center gap-2">
                <Clock size={14} style={{ color: '#9F99E8' }} />
                <span style={{ fontSize: 22, fontWeight: 700, color: '#CECBF6' }}>
                  {formatViewTimeFull(creator.total_view_seconds)}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 mt-1"
                 style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>
              <Clock size={11} />
              <span>No viewing time tracked yet</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PodiumCard({ creator, rank, meta, onClick }) {
  const [imgFailed, setImgFailed] = useState(false)
  const tc  = TYPE_COLORS[creator.creator_type] || TYPE_COLORS.custom
  const url = creatorAvatarUrl(creator, 640)
  const initials = creator.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div onClick={onClick} className="flex flex-col cursor-pointer group"
         style={{ transform: `scale(${meta.scale})`, transformOrigin: 'bottom center' }}>

      {/* Premium rank badge */}
      <div className="flex items-center justify-center mb-3">
        <PodiumBadge rank={rank} />
      </div>

      {/* Card */}
      <div className="rounded-[12px] overflow-hidden"
           style={{ background: 'rgba(255,255,255,0.04)',
                    border: `0.5px solid ${meta.color}66`,
                    boxShadow: `0 0 32px 6px ${meta.color}1A` }}>
        <div className="overflow-hidden flex items-center justify-center"
             style={{ height: meta.height, background: url && !imgFailed ? '#111' : tc.bg }}>
          {url && !imgFailed
            ? <img src={url} alt={creator.name} onError={() => setImgFailed(true)}
                   className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                   style={{ objectPosition: 'top center' }} />
            : <span style={{ fontSize: 64, fontWeight: 700, color: tc.text, opacity: 0.6, userSelect: 'none' }}>
                {initials}
              </span>
          }
        </div>
        <div className="p-3" style={{ borderTop: `0.5px solid ${meta.color}33` }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[14px] font-semibold text-[rgba(255,255,255,0.85)] truncate flex-1">
              {creator.name}
            </span>
            <RarityPill rarity={creator.card_rarity} />
            <RankChange change={creator.rank_change} />
          </div>
          <StatRow views={creator.total_views} cum={creator.total_cum} viewSeconds={creator.total_view_seconds} dwell={creator.avg_dwell_seconds} engagement={creator.engagement_factor} />
        </div>
      </div>

      {/* Podium base */}
      <div className="mt-2 mx-2 rounded-[4px]"
           style={{ height: rank === 1 ? 28 : rank === 2 ? 20 : 12,
                    background: `linear-gradient(to bottom, ${meta.color}33, ${meta.color}11)`,
                    border: `0.5px solid ${meta.color}44` }} />
    </div>
  )
}

function CreatorGridCard({ creator, rank, onClick }) {
  const [imgFailed, setImgFailed] = useState(false)
  const tc  = TYPE_COLORS[creator.creator_type] || TYPE_COLORS.custom
  const rc  = RARITY_COLORS[creator.card_rarity] || RARITY_COLORS.common
  const url = creatorAvatarUrl(creator, 360)
  const initials = creator.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div onClick={onClick}
         className="rounded-[10px] overflow-hidden cursor-pointer group transition-shadow duration-300"
         style={{ background: 'rgba(255,255,255,0.03)',
                  border: `0.5px solid ${rc}44`,
                  boxShadow: `0 0 18px 2px ${rc}15` }}>
      <div className="relative overflow-hidden flex items-center justify-center"
           style={{ height: 200, background: url && !imgFailed ? '#111' : tc.bg }}>
        {url && !imgFailed
          ? <img src={url} alt={creator.name} onError={() => setImgFailed(true)}
                 className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                 style={{ objectPosition: 'top center' }} />
          : <span style={{ fontSize: 52, fontWeight: 700, color: tc.text, opacity: 0.5, userSelect: 'none' }}>
              {initials}
            </span>
        }
        <div className="absolute top-2 left-2 z-[3]">
          <RankBadge rank={rank} />
        </div>
      </div>
      <div className="p-2.5">
        {/* Name on its own row so a long rarity label can never cover it */}
        <div className="text-[13px] font-medium text-[rgba(255,255,255,0.75)] truncate mb-1">{creator.name}</div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <StatRow views={creator.total_views} cum={creator.total_cum} viewSeconds={creator.total_view_seconds} dwell={creator.avg_dwell_seconds} engagement={creator.engagement_factor} />
          <div className="flex items-center gap-1.5">
            <RankChange change={creator.rank_change} />
            <RarityPill rarity={creator.card_rarity} />
          </div>
        </div>
      </div>
    </div>
  )
}

function CreatorSection({ creators, onCreatorClick, onKnowMore }) {
  if (!creators || creators.length === 0) return null
  const top3 = creators.slice(0, 3)
  const rest = creators.slice(3)

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-[10px]"
             style={{ background: 'rgba(186,117,23,0.15)', border: '0.5px solid rgba(186,117,23,0.35)' }}>
          <Trophy size={17} style={{ color: '#FAC775' }} />
        </div>
        <div>
          <div className="text-[20px] font-bold text-[rgba(255,255,255,0.92)]">Creator Hall of Fame</div>
          <div className="text-[12px] text-[rgba(255,255,255,0.3)]">
            Ranked by overall engagement — views, orgasms, watch time, and logged sessions combined.
            All of that is shown beneath each entry, along with assigned rarity.
          </div>
        </div>
      </div>

      <CreatorHero creator={top3[0]} onClick={() => onCreatorClick(top3[0].id)} />

      {top3.length > 1 && (
        <div className="grid gap-6 mt-4"
             style={{ gridTemplateColumns: top3.length >= 3 ? '1fr 1.15fr 1fr' : '1fr 1.15fr', alignItems: 'end' }}>
          {[top3[1], top3[0], top3[2]].map((c, i) => {
            if (!c) return null
            const rankMap = [2, 1, 3]
            const meta = PODIUM_META.find(m => m.rank === rankMap[i])
            return (
              <PodiumCard key={c.id} creator={c} rank={rankMap[i]} meta={meta}
                          onClick={() => onCreatorClick(c.id)} />
            )
          })}
        </div>
      )}

      {rest.length > 0 && (
        <>
          <TierLabel label="Honourable Mentions" color="rgba(186,117,23,0.35)" />
          <div className="grid gap-3 grid-stagger" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            {rest.map((c, i) => (
              <CreatorGridCard key={c.id} creator={c} rank={i + 4}
                               onClick={() => onCreatorClick(c.id)} />
            ))}
          </div>
        </>
      )}
      {onKnowMore && <KnowMoreButton onClick={onKnowMore} label="See all creators" />}
    </section>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MEDIA CARD — photo or video with hover preview from middle of video
// ══════════════════════════════════════════════════════════════════════════════
function MediaCard({ item, rank, imgHeight = 220, showRank = false, onClick }) {
  const [hoverVideo, setHoverVideo] = useState(false)
  const videoRef = useRef(null)
  const timerRef = useRef(null)

  const handleMouseEnter = useCallback(() => {
    if (!item.is_video) return
    setHoverVideo(true)
    timerRef.current = setTimeout(() => setHoverVideo(false), 15000)
  }, [item.is_video])

  const handleMouseLeave = useCallback(() => {
    if (!item.is_video) return
    clearTimeout(timerRef.current)
    setHoverVideo(false)
  }, [item.is_video])

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
      vid.src = `/api/images/${item.id}/file`
      const seekAndPlay = () => {
        if (vid.duration && !isNaN(vid.duration)) {
          vid.currentTime = vid.duration * 0.5
        }
        vid.play().catch(() => {})
      }
      if (vid.readyState >= 1) {
        seekAndPlay()
      } else {
        vid.load()
        vid.addEventListener('loadedmetadata', seekAndPlay, { once: true })
      }
    } else {
      vid.pause()
      vid.removeAttribute('src')
      vid.load()
    }
    return () => clearTimeout(timerRef.current)
  }, [hoverVideo, item.id])

  const stillSrc = imgHeight >= 300
    ? `/api/images/${item.id}/preview?w=700`
    : `/api/images/${item.id}/thumb`

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
      className="rounded-[10px] overflow-hidden cursor-pointer group"
      style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)' }}
    >
      <div className="relative overflow-hidden" style={{ height: imgHeight, background: 'rgba(255,255,255,0.03)' }}>
        <img
          src={stillSrc} alt=""
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          style={{ transform: hoverVideo ? 'scale(1)' : undefined }}
          onError={e => { e.target.style.display = 'none' }}
        />
        {item.is_video && (
          <video
            ref={videoRef}
            muted playsInline preload="none"
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-200"
            style={{ opacity: hoverVideo ? 1 : 0, zIndex: 2, pointerEvents: 'none' }}
          />
        )}
        {item.is_video && !hoverVideo && (
          <div className="absolute top-1.5 right-1.5 z-[3] flex items-center gap-1 px-1.5 py-0.5 rounded-full"
               style={{ background: 'rgba(0,0,0,0.65)', color: 'rgba(255,255,255,0.85)' }}>
            <Play size={9} fill="currentColor" />
            <Film size={9} />
          </div>
        )}
        {showRank && (
          <div className="absolute top-2 left-2 z-[3]">
            <RankBadge rank={rank} />
          </div>
        )}
      </div>
      <div className="p-2.5">
        <div className="text-[12px] font-medium text-[rgba(255,255,255,0.6)] truncate mb-0.5">{item.filename}</div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <StatRow views={item.view_count} cum={item.cum_count} />
          <RankChange change={item.rank_change} />
        </div>
      </div>
    </div>
  )
}

// ── Gallery card ──────────────────────────────────────────────────────────────
function GalleryCard({ gallery, rank, imgHeight = 220, showRank = false, onClick }) {
  const [failed, setFailed] = useState(false)
  return (
    <div onClick={onClick}
         className="rounded-[10px] overflow-hidden cursor-pointer group"
         style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
      <div className="relative overflow-hidden" style={{ height: imgHeight, background: 'rgba(255,255,255,0.03)' }}>
        {gallery.cover_thumb && !failed
          ? <img src={gallery.cover_thumb} alt={gallery.name}
                 className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                 style={{ objectPosition: 'top center' }}
                 onError={() => setFailed(true)} />
          : <div className="w-full h-full flex items-center justify-center opacity-10"><Images size={48} /></div>
        }
        {showRank && (
          <div className="absolute top-2 left-2 z-[3]">
            <RankBadge rank={rank} />
          </div>
        )}
      </div>
      <div className="p-2.5">
        <div className="text-[12px] font-medium text-[rgba(255,255,255,0.7)] truncate mb-0.5">{gallery.name}</div>
        {gallery.creator_name && (
          <div className="text-[11px] text-[rgba(255,255,255,0.3)] truncate mb-0.5">{gallery.creator_name}</div>
        )}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <StatRow views={gallery.view_count} cum={gallery.cum_count} />
          <RankChange change={gallery.rank_change} />
        </div>
      </div>
    </div>
  )
}

// ── Tiered section ────────────────────────────────────────────────────────────
function TieredSection({ icon: Icon, iconColor, title, subtitle, items, emptyMsg, renderCard, onKnowMore, knowMoreLabel }) {
  if (!items) return null

  const inner    = items.slice(0, 3)
  const devoted  = items.slice(3, 10)
  const mentions = items.slice(10)

  return (
    <section className="flex flex-col">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center justify-center w-9 h-9 rounded-[10px]"
             style={{ background: `${iconColor}18`, border: `0.5px solid ${iconColor}44` }}>
          <Icon size={17} style={{ color: iconColor }} />
        </div>
        <div>
          <div className="text-[20px] font-bold text-[rgba(255,255,255,0.92)]">{title}</div>
          <div className="text-[12px] text-[rgba(255,255,255,0.3)]">{subtitle}</div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-[12px] p-10 text-center text-[15px] text-[rgba(255,255,255,0.2)]"
             style={{ background: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.05)' }}>
          {emptyMsg}
        </div>
      ) : (
        <>
          {inner.length > 0 && (
            <>
              <TierLabel label="Inner Circle" color={`${iconColor}80`} />
              <div className="grid gap-4 grid-stagger" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                {inner.map((item, i) => renderCard(item, i + 1, 390, true))}
              </div>
            </>
          )}
          {devoted.length > 0 && (
            <>
              <TierLabel label="The Devoted" color="rgba(255,255,255,0.2)" />
              <div className="grid gap-3 grid-stagger" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                {devoted.map((item, i) => renderCard(item, i + 4, 200, true))}
              </div>
            </>
          )}
          {mentions.length > 0 && (
            <>
              <TierLabel label="Honourable Mentions" color="rgba(255,255,255,0.12)" />
              <div className="grid gap-2 grid-stagger" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                {mentions.map((item, i) => renderCard(item, i + 11, 160, false))}
              </div>
            </>
          )}
        </>
      )}
      {onKnowMore && items.length > 0 && (
        <KnowMoreButton onClick={onKnowMore} label={knowMoreLabel || 'Know more'} />
      )}
    </section>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE
// ══════════════════════════════════════════════════════════════════════════════
export default function HallOfFame() {
  const navigate = useNavigate()
  const [statsId, setStatsId] = useState(null)
  const [fullList, setFullList] = useState(null)   // which section's full list is open
  const [galleryStatsId, setGalleryStatsId] = useState(null)
  const [mediaStatsId, setMediaStatsId]     = useState(null)

  // Opens on whichever board was last looked at.
  const [period, setPeriod] = useState(loadHofPeriod)
  const selectPeriod = useCallback((p) => { setPeriod(p); saveHofPeriod(p) }, [])

  // Page fetchers for the "know more" list. Wrapped in useCallback so the modal
  // resets its rows when you switch sections rather than appending to them —
  // and so it re-fetches when the period changes underneath it.
  const fetchCreators = useCallback((limit, offset) =>
    creatorsApi.hof(limit, offset, period).then(r => r.data), [period])
  const fetchMedia = useCallback((limit, offset) =>
    galleriesApi.hof(limit, offset, period).then(r => r.data), [period])
  const fetchGalleries = useCallback((limit, offset) =>
    galleriesApi.galleryHof(limit, offset, period).then(r => r.data), [period])

  const LISTS = {
    creators:  { title: 'All creators',  subtitle: 'Ranked by engagement — tap any of them for her full stats', fetch: fetchCreators,
                 onRowClick: (item) => { setFullList(null); setStatsId(item.id) } },
    media:     { title: 'All photos & videos', subtitle: 'Ranked by cum taps, edges, then views', fetch: fetchMedia,
                 onRowClick: (item) => { setFullList(null); setMediaStatsId(item.id) } },
    galleries: { title: 'All galleries', subtitle: 'Ranked by time spent, cum taps, edges and visits', fetch: fetchGalleries,
                 onRowClick: (item) => { setFullList(null); setGalleryStatsId(item.id) } },
  }
  const activeList = fullList ? LISTS[fullList] : null

  const { data: imageHof }   = useQuery({ queryKey: ['hof',         30, period], queryFn: () => galleriesApi.hof(30, 0, period).then(r => r.data),   staleTime: 0 })
  const { data: galleryHof } = useQuery({ queryKey: ['gallery-hof', 30, period], queryFn: () => galleriesApi.galleryHof(30, 0, period).then(r => r.data), staleTime: 0 })
  const { data: creatorHof } = useQuery({ queryKey: ['creator-hof', 30, period], queryFn: () => creatorsApi.hof(30, 0, period).then(r => r.data),   staleTime: 0, refetchInterval: 15000 })

  // When engagement logging started. A window that opened before this date is
  // genuinely partial, so the page says so rather than passing off four days as
  // a whole month.
  const { data: trackingSince } = useQuery({
    queryKey: ['activity-tracking'],
    queryFn:  () => systemApi.activityTracking().then(r => r.data.since),
    staleTime: 60_000,
  })

  const periodLabel = HOF_PERIODS.find(p => p.id === period)?.label ?? 'All time'
  const partialSince = partialWindowNote(period, trackingSince)

  // The backdrop follows whoever leads the board you're looking at, so switching
  // to "This week" swaps the whole page's identity to that week's girl.
  const topCreatorId = creatorHof?.[0]?.id ?? null

  return (
    <div className="flex-1" style={{ background: '#0e0e0e', position: 'relative', minHeight: '100%' }}>
      {/* No own overflow here — Layout's <main> is the scroll container. A local
          overflow-y-auto would trap position:sticky, so the pinned backdrop
          below anchors to <main>, not this div. */}
      {/* Living collage backdrop. A zero-height sticky anchor pins a viewport-tall
          layer that stays put while you scroll — so the blurred tiles never
          repaint on scroll (that was the jank). It drifts via CSS and swaps
          identity when your #1 creator changes. */}
      <div aria-hidden style={{ position: 'sticky', top: 0, height: 0, zIndex: 0 }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '100vh',
                      overflow: 'hidden', pointerEvents: 'none' }}>
          <CreatorCollageBackground creatorId={topCreatorId} />
        </div>
      </div>

      <CreatorStatsModal creatorId={statsId} onClose={() => setStatsId(null)} />

      <HofFullListModal
        open={!!activeList}
        title={activeList?.title}
        subtitle={activeList?.subtitle}
        fetchPage={activeList?.fetch}
        onRowClick={activeList?.onRowClick}
        onClose={() => setFullList(null)}
      />

      <GalleryStatsModal galleryId={galleryStatsId} onClose={() => setGalleryStatsId(null)} />
      <MediaStatsModal   imageId={mediaStatsId}     onClose={() => setMediaStatsId(null)} />

      <div className="max-w-[1400px] mx-auto px-8 py-10" style={{ position: 'relative', zIndex: 1 }}>

        <div className="flex flex-wrap items-center justify-between gap-6 mb-14">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center w-14 h-14 rounded-[14px]"
                 style={{ background: 'rgba(186,117,23,0.15)', border: '0.5px solid rgba(186,117,23,0.35)',
                          boxShadow: '0 0 30px 4px rgba(186,117,23,0.12)' }}>
              <Trophy size={26} style={{ color: '#FAC775' }} />
            </div>
            <div>
              <h1 className="text-[32px] font-bold text-[rgba(255,255,255,0.95)]">
                Hall of Fame
                {period !== 'all' && (
                  <span className="ml-3 text-[20px] font-semibold" style={{ color: '#FAC775' }}>
                    {periodLabel}
                  </span>
                )}
              </h1>
              <p className="text-[16px] text-[rgba(255,255,255,0.35)] mt-0.5">
                {PERIOD_SUBTITLE[period]}
              </p>
              {partialSince && (
                <p className="text-[16px] mt-1" style={{ color: 'rgba(186,117,23,0.75)' }}>
                  Partial — engagement has only been tracked since {partialSince}
                </p>
              )}
            </div>
          </div>

          <HofPeriodToggle value={period} onChange={selectPeriod} />
        </div>

        <div className="flex flex-col gap-20">

          {/* CreatorSection renders nothing when empty, which on a freshly-reset
              board reads as a broken page rather than an empty one. */}
          {(creatorHof ?? []).length === 0 && (imageHof ?? []).length === 0 ? (
            <div className="rounded-[14px] p-16 text-center"
                 style={{ background: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.06)' }}>
              <Trophy size={32} style={{ color: 'rgba(186,117,23,0.35)', margin: '0 auto 16px' }} />
              <p className="text-[18px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                {PERIOD_EMPTY[period]}
              </p>
              {period !== 'all' && (
                <button onClick={() => selectPeriod('all')}
                        className="mt-5 px-4 py-2 rounded-[10px] text-[16px] font-semibold transition-colors"
                        style={{ background: 'rgba(186,117,23,0.15)',
                                 border: '0.5px solid rgba(186,117,23,0.35)', color: '#FAC775' }}>
                  See all time instead
                </button>
              )}
            </div>
          ) : (
          <>
          <CreatorSection creators={creatorHof} onCreatorClick={setStatsId}
                          onKnowMore={() => setFullList('creators')} />

          <TieredSection
            icon={Film}
            iconColor="#D4537E"
            title="Media Hall of Fame"
            subtitle="Individual photos and videos ranked by view count. High-view images with many cum taps earn their place here."
            items={imageHof}
            emptyMsg="Open images and videos in galleries to start building this list"
            renderCard={(item, rank, h, showRank) => (
              <MediaCard key={item.id} item={item} rank={rank} imgHeight={h} showRank={showRank}
                         onClick={() => setMediaStatsId(item.id)} />
            )}
            onKnowMore={() => setFullList('media')}
            knowMoreLabel="See all photos & videos"
          />

          {(galleryHof ?? []).length > 0 && (
            <TieredSection
              icon={Images}
              iconColor="#7F77DD"
              title="Gallery Hall of Fame"
              subtitle="Full galleries ranked by total view count. Reflects which collections you return to most — not just opened once."
              items={galleryHof}
              emptyMsg="Browse galleries to build this list"
              renderCard={(g, rank, h, showRank) => (
                <GalleryCard key={g.id} gallery={g} rank={rank} imgHeight={h} showRank={showRank}
                             onClick={() => setGalleryStatsId(g.id)} />
              )}
              onKnowMore={() => setFullList('galleries')}
              knowMoreLabel="See all galleries"
            />
          )}
          </>
          )}

        </div>
      </div>
    </div>
  )
}

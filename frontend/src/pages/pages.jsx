import React from 'react'
import ReactDOM from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Circle, Lock, Target, Trophy, ChevronDown, Zap, Check, X, ScrollText, AlertCircle, Cpu, Download, RefreshCw, ShieldCheck, HardDrive, Globe, Clock, Sparkles, Type, Gauge, FolderOpen, ScanLine, Archive, SlidersHorizontal, Smartphone, Copy, Keyboard, Pencil, Trash2, Plus, Droplets, Waves } from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'
import { gamiApi, sessionsApi, scannerApi, systemApi, creatorsApi, cardsApi, taggerApi, galleriesApi, tasksApi, companionApi } from '../lib/api'
import { useVaultStore, PALETTES, FONTS } from '../store/vault'
import { useT, LANGUAGES } from '../i18n'
import HotkeySettings from '../components/settings/HotkeySettings'
import Almanac from '../components/stats/Almanac'
import HofFullListModal from '../components/HofFullListModal'
import CreatorStatsModal from '../components/CreatorStatsModal'
import { useSession } from '../hooks/useSession'
import toast from 'react-hot-toast'
import { ComposableMap, Geographies, Geography, ZoomableGroup, Marker } from 'react-simple-maps'

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

// Common country name aliases → canonical map name
const COUNTRY_ALIASES = {
  'usa': 'United States of America',
  'us': 'United States of America',
  'united states': 'United States of America',
  'uk': 'United Kingdom',
  'great britain': 'United Kingdom',
  'england': 'United Kingdom',
  'south korea': 'South Korea',
  'korea': 'South Korea',
  'dprk': 'North Korea',
  'north korea': 'North Korea',
  'russia': 'Russia',
  'czech republic': 'Czechia',
  'taiwan': 'Taiwan',
  'iran': 'Iran',
  'syria': 'Syria',
  'vietnam': 'Vietnam',
  'bolivia': 'Bolivia',
  'tanzania': 'Tanzania',
  'venezuela': 'Venezuela',
}

const normalizeCountry = (s) => {
  if (!s) return null
  const lower = s.toLowerCase().trim()
  return COUNTRY_ALIASES[lower] || s.trim()
}

// Approximate lat/lon centers for placing markers
const COUNTRY_COORDS = {
  'United States of America': [-98, 38],
  'United Kingdom': [-2, 54],
  'Japan': [138, 36],
  'South Korea': [128, 36],
  'France': [2, 46],
  'Germany': [10, 51],
  'Canada': [-95, 55],
  'Australia': [134, -25],
  'Brazil': [-55, -10],
  'China': [105, 35],
  'Russia': [85, 60],
  'Italy': [12, 42],
  'Spain': [-4, 40],
  'Mexico': [-102, 23],
  'India': [78, 20],
  'Philippines': [122, 12],
  'Thailand': [101, 15],
  'Poland': [20, 52],
  'Netherlands': [5, 52],
  'Sweden': [18, 60],
  'Norway': [8, 62],
  'Denmark': [10, 56],
  'Finland': [26, 64],
  'Argentina': [-65, -34],
  'Chile': [-71, -30],
  'Colombia': [-74, 4],
  'Peru': [-76, -10],
  'Venezuela': [-66, 8],
  'Indonesia': [118, -5],
  'Malaysia': [109, 4],
  'Singapore': [104, 1],
  'Vietnam': [108, 16],
  'Taiwan': [121, 24],
  'Hong Kong': [114, 22],
  'Ukraine': [32, 49],
  'Czechia': [15, 50],
  'Hungary': [19, 47],
  'Romania': [25, 46],
  'Turkey': [35, 39],
  'Egypt': [30, 27],
  'South Africa': [25, -29],
  'Nigeria': [8, 10],
  'Israel': [35, 31],
  'Iran': [53, 33],
  'Saudi Arabia': [45, 24],
  'New Zealand': [172, -42],
  'Portugal': [-8, 40],
  'Belgium': [4, 51],
  'Switzerland': [8, 47],
  'Austria': [14, 47],
  'Greece': [22, 39],
}

// ── Country geographic spreads [lon, lat] for scattering creator avatars ──────
const COUNTRY_SPREAD = {
  'United States of America': [24, 12],
  'Russia':                   [40, 15],
  'Canada':                   [28, 12],
  'China':                    [20, 10],
  'Australia':                [22, 12],
  'Brazil':                   [16, 14],
  'India':                    [12, 12],
  'Argentina':                [8,  14],
  'Mexico':                   [12,  8],
  'Indonesia':                [18,  8],
  'Saudi Arabia':             [10,  8],
  'Japan':                    [8,  10],
  'South Korea':              [4,   5],
  'United Kingdom':           [5,   5],
  'France':                   [7,   6],
  'Germany':                  [7,   5],
  'Italy':                    [5,   9],
  'Spain':                    [8,   6],
  'Ukraine':                  [9,   6],
  'Poland':                   [6,   5],
  'Sweden':                   [6,   9],
  'Norway':                   [5,   9],
  'Finland':                  [6,   8],
  'Turkey':                   [10,  5],
  'Iran':                     [10,  7],
  'Egypt':                    [8,   7],
  'South Africa':             [10,  8],
  'Nigeria':                  [6,   6],
  'Philippines':              [6,  10],
  'Vietnam':                  [3,  10],
  'Thailand':                 [5,   8],
  'Malaysia':                 [8,   5],
  'New Zealand':              [6,   8],
}
const _SPREAD_DEFAULT = [8, 5]

// Deterministic LCG random — stable scatter positions keyed to creator ID
const _seededRand = seed => {
  let s = (seed * 1664525 + 1013904223) >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

// ── World Map component ───────────────────────────────────────────────────────
function WorldMap({ byCountry, compact = false, onCountryClick }) {
  const [tooltip,       setTooltip]       = React.useState(null)
  const [zoom,          setZoom]          = React.useState(1)
  const [center,        setCenter]        = React.useState([0, 20])
  const [failedAvatars, setFailedAvatars] = React.useState(() => new Set())
  const accent = useVaultStore(s => s.accent)
  const t = useT()

  const accentRgb = React.useMemo(() => {
    const m = accent?.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
    return m ? `${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)}` : '127,119,221'
  }, [accent])

  const countryMap = React.useMemo(() => {
    const m = {}
    for (const item of (byCountry || [])) {
      const norm = normalizeCountry(item.country)
      if (norm) m[norm] = item
    }
    return m
  }, [byCountry])

  const maxCount = React.useMemo(() =>
    Math.max(1, ...Object.values(countryMap).map(v => v.count)),
  [countryMap])

  const fillColor = count => {
    if (!count) return 'rgba(255,255,255,0.1)'
    const ct = Math.min(1, count / maxCount)
    if (ct < 0.25) return `rgba(${accentRgb},0.3)`
    if (ct < 0.5)  return `rgba(${accentRgb},0.5)`
    if (ct < 0.75) return `rgba(${accentRgb},0.7)`
    return accent
  }

  // Max creators visible per country based on zoom level
  const maxPerCountry = compact ? 1
    : zoom < 1.5 ? 2
    : zoom < 2.5 ? 5
    : zoom < 4   ? 12
    : zoom < 6   ? 25 : 9999

  // Build all creator markers with stable deterministic scatter positions
  const allMarkers = React.useMemo(() => {
    const out = []
    for (const [name, item] of Object.entries(countryMap)) {
      const coords = COUNTRY_COORDS[name]
      if (!coords) continue
      const [lon, lat] = coords
      const [sLon, sLat] = COUNTRY_SPREAD[name] || _SPREAD_DEFAULT
      item.creators.forEach((c, idx) => {
        const rng = _seededRand(c.id * 31 + idx * 7)
        const dx = compact ? 0 : (rng() - 0.5) * sLon
        const dy = compact ? 0 : (rng() - 0.5) * sLat
        out.push({
          key:  `${name}-${c.id}`,
          id:   c.id,
          name: c.name,
          avatar_path: c.avatar_path,
          country: name,
          coords:  [lon + dx, lat + dy],
          idx,
          initial: c.name?.charAt(0)?.toUpperCase() ?? '?',
        })
      })
    }
    return out
  }, [countryMap, compact])

  const visible = React.useMemo(
    () => allMarkers.filter(m => m.idx < maxPerCountry),
    [allMarkers, maxPerCountry]
  )

  const R = compact ? 4 : 9   // marker radius in map-space units (no scale transform)

  const onImgError = React.useCallback((id) => {
    setFailedAvatars(prev => { const s = new Set(prev); s.add(id); return s })
  }, [])

  return (
    <div className="relative w-full h-full" style={{ minHeight: compact ? 180 : 400 }}>
      <ComposableMap
        projection="geoNaturalEarth1"
        projectionConfig={{ scale: compact ? 145 : 165 }}
        style={{ width: '100%', height: '100%', background: 'transparent' }}>

        {/* Single shared clipPath using objectBoundingBox — works at any scale/zoom,
            no coordinate-system mismatch, safe to place outside ZoomableGroup. */}
        <defs>
          <clipPath id="vmap-avatar-clip" clipPathUnits="objectBoundingBox">
            <circle cx="0.5" cy="0.5" r="0.5" />
          </clipPath>
        </defs>

        <ZoomableGroup
          zoom={zoom}
          center={center}
          filterZoomEvent={compact ? () => false : evt => evt.type !== 'dblclick'}
          onMoveEnd={({ zoom: z, coordinates }) => {
            if (compact) return
            setCenter(coordinates)
            setZoom(z)
          }}
        >
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map(geo => {
                const name = geo.properties.name
                const item = countryMap[name]
                return (
                  <Geography key={geo.rsmKey} geography={geo}
                    style={{
                      default: { fill: fillColor(item?.count), stroke: 'rgba(255,255,255,0.07)', strokeWidth: 0.5, outline: 'none' },
                      hover:   { fill: item ? `rgba(${accentRgb},0.85)` : 'rgba(255,255,255,0.15)', stroke: 'rgba(255,255,255,0.18)', strokeWidth: 0.5, outline: 'none', cursor: item ? 'pointer' : 'default' },
                      pressed: { fill: accent, outline: 'none' },
                    }}
                    onMouseEnter={() => item && setTooltip({ name, count: item.count, creators: item.creators })}
                    onMouseLeave={() => setTooltip(null)}
                    onClick={() => item && onCountryClick?.(name, item)}
                  />
                )
              })
            }
          </Geographies>

          {visible.map(m => {
            const showAvatar = !!m.avatar_path && !failedAvatars.has(m.id)
            return (
              <Marker key={m.key} coordinates={m.coords}>
                <g
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => {
                    const item = countryMap[m.country]
                    setTooltip({ name: m.country, count: item?.count ?? 1, creators: item?.creators ?? [m] })
                  }}
                  onMouseLeave={() => setTooltip(null)}
                  onClick={() => onCountryClick?.(m.country, countryMap[m.country])}
                >
                  {/* Accent base circle — always visible, acts as fallback */}
                  <circle cx="0" cy="0" r={R} fill={accent} opacity={0.85} />
                  {/* Avatar image — use the API avatar-thumb endpoint which handles
                      full file paths correctly regardless of where the file lives */}
                  {showAvatar && (
                    <image
                      href={`/api/creators/${m.id}/avatar-thumb?size=120`}
                      x={-R} y={-R} width={R * 2} height={R * 2}
                      clipPath="url(#vmap-avatar-clip)"
                      preserveAspectRatio="xMidYMid slice"
                      onError={() => onImgError(m.id)}
                    />
                  )}
                  {/* Initial letter when no avatar or avatar failed */}
                  {!showAvatar && (
                    <text x="0" y="0" dominantBaseline="central" textAnchor="middle"
                      fontSize={R * 0.9} fontWeight="700" fill="rgba(255,255,255,0.95)"
                      style={{ userSelect: 'none', pointerEvents: 'none' }}>
                      {m.initial}
                    </text>
                  )}
                  {/* Border ring */}
                  <circle cx="0" cy="0" r={R} fill="none"
                    stroke="rgba(255,255,255,0.7)" strokeWidth={compact ? 0.6 : 0.8} />
                </g>
              </Marker>
            )
          })}
        </ZoomableGroup>
      </ComposableMap>

      {tooltip && (
        <div className="absolute top-2 left-2 px-3 py-2 rounded-[8px] pointer-events-none"
             style={{ background: 'rgba(22,22,22,0.95)', border: `0.5px solid rgba(${accentRgb},0.4)`, zIndex: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)', marginBottom: 3 }}>{tooltip.name}</div>
          <div style={{ fontSize: 14, color: accent }}>{tooltip.count} {t('creator')}{tooltip.count !== 1 ? 's' : ''}</div>
          {tooltip.creators?.slice(0, 4).map(c => (
            <div key={c.id} style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>{c.name}</div>
          ))}
          {(tooltip.creators?.length ?? 0) > 4 && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>+{tooltip.creators.length - 4} {t('more')}</div>
          )}
        </div>
      )}

      {!compact && (
        <div className="absolute bottom-3 right-3 flex gap-1.5">
          <button onClick={() => setZoom(z => Math.min(8, z * 1.5))}
                  className="w-7 h-7 rounded-full flex items-center justify-center cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', fontSize: 16 }}>+</button>
          <button onClick={() => setZoom(z => Math.max(1, z / 1.5))}
                  className="w-7 h-7 rounded-full flex items-center justify-center cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', fontSize: 16 }}>−</button>
          <button onClick={() => { setZoom(1); setCenter([0, 20]) }}
                  className="w-7 h-7 rounded-full flex items-center justify-center cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>↺</button>
        </div>
      )}
    </div>
  )
}

// ── World Map modal ───────────────────────────────────────────────────────────
function WorldMapModal({ byCountry, onClose }) {
  const [selected, setSelected] = React.useState(null)
  const accent = useVaultStore(s => s.accent)
  const t = useT()
  const accentRgb = React.useMemo(() => {
    const m = accent?.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
    return m ? `${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)}` : '127,119,221'
  }, [accent])
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center animate-fade-in"
         style={{ background: 'rgba(0,0,0,0.85)' }}
         onClick={onClose}>
      <div className="rounded-[16px] flex flex-col shadow-2xl"
           style={{ width: '72vw', height: '78vh', background: '#141414', border: `0.5px solid rgba(${accentRgb},0.35)` }}
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
             style={{ borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 text-[17px] font-medium" style={{ color: 'rgba(255,255,255,0.85)' }}>
            <Globe size={16} style={{ color: accent }} /> {t('Creator World Map')}
            <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)', fontWeight: 400 }}>
              · {(byCountry || []).reduce((s, c) => s + c.count, 0)} {t('creators across')} {(byCountry || []).length} {t('countries')}
            </span>
          </div>
          <button onClick={onClose} style={{ color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 p-3 min-h-0">
            <WorldMap byCountry={byCountry} compact={false}
                      onCountryClick={(name, item) => setSelected({ name, ...item })} />
          </div>
          {selected && (
            <div className="w-56 flex-shrink-0 p-4 overflow-y-auto"
                 style={{ borderLeft: '0.5px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center justify-between mb-3">
                <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>{selected.name}</div>
                <button onClick={() => setSelected(null)} style={{ color: 'rgba(255,255,255,0.3)', cursor: 'pointer' }}><X size={12} /></button>
              </div>
              <div style={{ fontSize: 14, color: accent, marginBottom: 8 }}>{selected.count} {t('creator')}{selected.count !== 1 ? 's' : ''}</div>
              {(selected.creators || []).map(c => (
                <div key={c.id} style={{ fontSize: 15, color: 'rgba(255,255,255,0.65)', padding: '4px 0', borderBottom: '0.5px solid rgba(255,255,255,0.05)' }}>
                  {c.name}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const TYPE_STYLES = {
  daily:  { label: 'Daily',      color: 'var(--c-accent)', bg: 'color-mix(in srgb, var(--c-accent) 10%, transparent)' },
  weekly: { label: 'Weekly',     color: 'var(--c-amber)', bg: 'color-mix(in srgb, var(--c-amber) 10%, transparent)'  },
  boss:   { label: 'Challenge',  color: 'var(--c-pink)', bg: 'color-mix(in srgb, var(--c-pink) 10%, transparent)'  },
}

function QuestCard({ quest }) {
  const t       = useT()
  const done    = quest.status === 'completed'
  const expired = quest.status === 'expired'
  const ts      = TYPE_STYLES[quest.quest_type] || TYPE_STYLES.daily
  const pct     = Math.min(100, (quest.progress / quest.target) * 100)

  return (
    <div className="vault-card p-3.5" style={{ opacity: expired ? 0.4 : 1 }}>
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-[8px] flex items-center justify-center flex-shrink-0"
             style={{ background: ts.bg }}>
          {done
            ? <CheckCircle2 size={16} style={{ color: ts.color }} />
            : <Target size={14} style={{ color: ts.color }} />
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-[12px] font-medium ${done ? 'line-through text-[rgba(255,255,255,0.3)]' : 'text-[rgba(255,255,255,0.85)]'}`}>
            {quest.title}
          </div>
          <div className="text-[10px] text-[rgba(255,255,255,0.35)] mt-0.5">{quest.description}</div>
          {!done && quest.target > 1 && (
            <>
              <div className="flex justify-between text-[10px] text-[rgba(255,255,255,0.3)] mt-2 mb-1">
                <span>{quest.progress} / {quest.target}</span>
                <span>{Math.round(pct)}%</span>
              </div>
              <div className="h-[3px] rounded-full bg-[rgba(255,255,255,0.07)] overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: ts.color }} />
              </div>
            </>
          )}
        </div>
        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
          <div className="text-[11px] font-medium" style={{ color: ts.color }}>+{quest.xp_reward} {t('XP')}</div>
          {quest.credit_reward > 0 && (
            <div className="text-[10px] font-medium" style={{ color: 'var(--c-amber-text)' }}>+{quest.credit_reward} 💰</div>
          )}
        </div>
      </div>
    </div>
  )
}

function AchievementCard({ ach }) {
  const t = useT()
  return (
    <div className="vault-card p-3 flex items-center gap-3" style={{ opacity: ach.unlocked ? 1 : 0.45 }}>
      <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
           style={{ background: ach.unlocked ? 'color-mix(in srgb, var(--c-accent) 20%, transparent)' : 'rgba(255,255,255,0.05)' }}>
        {ach.unlocked
          ? <Trophy size={16} style={{ color: 'var(--c-accent-text)' }} />
          : <Lock size={14} style={{ color: 'rgba(255,255,255,0.25)' }} />
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-[rgba(255,255,255,0.8)]">{ach.title}</div>
        <div className="text-[10px] text-[rgba(255,255,255,0.35)]">{ach.description}</div>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <div className="text-[11px] font-medium" style={{ color: ach.unlocked ? 'var(--c-accent)' : 'rgba(255,255,255,0.2)' }}>
          +{ach.xp_reward} {t('XP')}
        </div>
        {ach.credit_reward > 0 && (
          <div className="text-[10px] font-medium" style={{ color: ach.unlocked ? 'var(--c-amber-text)' : 'rgba(255,255,255,0.15)' }}>
            +{ach.credit_reward} 💰
          </div>
        )}
      </div>
    </div>
  )
}

function CompletionRewardPanel({ label, accentColor, accentRgb, textColor, progressPct, done, total, packLabel, packNote, claimable, onClaim, claiming }) {
  const t = useT()
  // State: claimable = reward ready to collect | all done & not claimable = already claimed | else in progress
  const alreadyClaimed = done === total && total > 0 && !claimable
  const inProgress     = done < total || total === 0

  return (
    <div
      className="rounded-[10px] p-3 flex flex-col gap-2"
      style={{
        background: claimable ? `rgba(${accentRgb},0.13)` : `rgba(${accentRgb},0.07)`,
        border: claimable ? `1px solid ${accentColor}` : `0.5px solid rgba(${accentRgb},0.2)`,
        transition: 'border 0.2s, background 0.2s',
      }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium" style={{ color: textColor }}>{t(label)}</span>
        {claimable ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium animate-pulse"
                style={{ background: 'color-mix(in srgb, var(--c-amber) 20%, transparent)', color: 'var(--c-amber-text)' }}>
            🎁 {t('Ready!')}
          </span>
        ) : alreadyClaimed ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{ background: 'color-mix(in srgb, var(--c-green) 20%, transparent)', color: 'var(--c-green-text)' }}>
            ✓ {t('Claimed')}
          </span>
        ) : (
          <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{done}/{total}</span>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-[4px] rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
        <div className="h-full rounded-full transition-all"
             style={{ width: `${progressPct}%`, background: accentColor }} />
      </div>

      {/* Pack description */}
      <div className="flex items-center gap-1.5">
        <span style={{ fontSize: 14 }}>🎴</span>
        <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
          {inProgress ? t('Complete all for') : claimable ? t('All done! Collect your') : t('Reward collected:')}
        </span>
        <span className="text-[11px] font-semibold" style={{ color: textColor }}>{t(packLabel)}</span>
      </div>
      <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.28)' }}>{t(packNote)}</div>

      {/* Claim button — only shown when reward is ready */}
      {claimable && (
        <button
          onClick={onClaim}
          disabled={claiming}
          className="mt-1 w-full rounded-[8px] py-2 text-[12px] font-bold transition-all cursor-pointer"
          style={{
            background: accentColor,
            color: '#fff',
            opacity: claiming ? 0.6 : 1,
            boxShadow: `0 0 12px ${accentColor}88`,
          }}
        >
          {claiming ? t('Claiming…') : `🎁 ${t('Claim Packs')}`}
        </button>
      )}
    </div>
  )
}

export function Quests() {
  const t = useT()
  const qc = useQueryClient()
  const { data: quests }       = useQuery({ queryKey: ['quests'],       queryFn: () => gamiApi.quests().then(r => r.data) })
  const { data: achievements } = useQuery({ queryKey: ['achievements'], queryFn: () => gamiApi.achievements().then(r => r.data) })
  const { data: profile }      = useQuery({ queryKey: ['profile'],      queryFn: () => gamiApi.profile().then(r => r.data) })

  const claimMut = useMutation({
    mutationFn: (type) => gamiApi.claimCompletionBonus(type),
    onSuccess: (_, type) => {
      qc.invalidateQueries({ queryKey: ['profile'] })
      toast.success(type === 'daily' ? `🎴 ${t('Claimed 5 Booster Packs!')}` : `🎴 ${t('Claimed 5 Premium Packs!')}`)
    },
    onError: (err) => {
      // Surface what the server actually said — "Could not claim reward" gave
      // no clue why, and the button could sit there saying "Ready!" against a
      // cached profile. Refetch so the board corrects itself either way.
      qc.invalidateQueries({ queryKey: ['profile'] })
      qc.invalidateQueries({ queryKey: ['quests'] })
      toast.error(err?.response?.data?.detail || t('Could not claim reward'))
    },
  })

  const daily  = quests?.filter(q => q.quest_type === 'daily')  ?? []
  const weekly = quests?.filter(q => q.quest_type === 'weekly') ?? []
  const boss   = quests?.filter(q => q.quest_type === 'boss')   ?? []

  const dailyDone  = daily.filter(q => q.status === 'completed').length
  const weeklyDone = weekly.filter(q => q.status === 'completed').length
  const dailyPct   = daily.length  ? Math.round((dailyDone  / daily.length)  * 100) : 0
  const weeklyPct  = weekly.length ? Math.round((weeklyDone / weekly.length) * 100) : 0

  const dailyClaimable  = profile?.daily_bonus_claimable  ?? false
  const weeklyClaimable = profile?.weekly_bonus_claimable ?? false

  return (
    <div className="p-5 flex flex-col gap-6" style={{ zoom: 1.2 }}>
      <div className="text-[16px] font-medium text-[rgba(255,255,255,0.9)]">{t('Quest board')}</div>

      {/* ── Row 1: Daily · Weekly · Rewards ─────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-5 items-start">

        {/* Daily */}
        <div className="vault-card p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="text-[13px] font-semibold" style={{ color: 'var(--c-accent)' }}>{t('Daily')}</div>
              <div className="text-[10px] text-[rgba(255,255,255,0.25)]">{t('resets midnight')}</div>
            </div>
            <div className="text-[11px] font-medium" style={{ color: dailyDone === daily.length && daily.length > 0 ? 'var(--c-green-text)' : 'rgba(255,255,255,0.3)' }}>
              {dailyDone}/{daily.length}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {daily.map(q => <QuestCard key={q.id} quest={q} />)}
          </div>
        </div>

        {/* Weekly */}
        <div className="vault-card p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="text-[13px] font-semibold" style={{ color: 'var(--c-amber)' }}>{t('Weekly')}</div>
              <div className="text-[10px] text-[rgba(255,255,255,0.25)]">{t('resets Monday')}</div>
            </div>
            <div className="text-[11px] font-medium" style={{ color: weeklyDone === weekly.length && weekly.length > 0 ? 'var(--c-green-text)' : 'rgba(255,255,255,0.3)' }}>
              {weeklyDone}/{weekly.length}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {weekly.map(q => <QuestCard key={q.id} quest={q} />)}
          </div>
        </div>

        {/* Rewards */}
        <div className="vault-card p-4 flex flex-col gap-4">
          <div className="text-[13px] font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>🎁 {t('Completion Rewards')}</div>

          {/* Daily bonus */}
          <CompletionRewardPanel
            label="Daily sweep"
            accentColor="var(--c-accent)"
            accentRgb="127,119,221"
            textColor="var(--c-accent-text)"
            progressPct={dailyPct}
            done={dailyDone}
            total={daily.length}
            packLabel="5 booster packs"
            packNote="5 cards per pack · standard drop rates · chance at Epic+"
            claimable={dailyClaimable}
            onClaim={() => claimMut.mutate('daily')}
            claiming={claimMut.isPending && claimMut.variables === 'daily'}
          />

          {/* Weekly bonus */}
          <CompletionRewardPanel
            label="Weekly sweep"
            accentColor="var(--c-amber)"
            accentRgb="186,117,23"
            textColor="var(--c-amber-text)"
            progressPct={weeklyPct}
            done={weeklyDone}
            total={weekly.length}
            packLabel="5 premium packs"
            packNote="5 cards per pack · guaranteed Rare floor · higher Legendary rate"
            claimable={weeklyClaimable}
            onClaim={() => claimMut.mutate('weekly')}
            claiming={claimMut.isPending && claimMut.variables === 'weekly'}
          />

          {/* Bonus notes */}
          <div className="rounded-[10px] p-3 flex flex-col gap-2" style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.06)' }}>
            <div className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>{t('Also earning XP from each quest')}</div>
            <div className="flex flex-col gap-1">
              {[
                { label: 'Daily quest', xp: '+25–100 XP', color: 'var(--c-accent)' },
                { label: 'Weekly quest', xp: '+50–300 XP', color: 'var(--c-amber)' },
                { label: 'Challenge', xp: '+100–500 XP', color: 'var(--c-pink)' },
              ].map(r => (
                <div key={r.label} className="flex items-center justify-between">
                  <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{t(r.label)}</span>
                  <span className="text-[10px] font-semibold" style={{ color: r.color }}>{t(r.xp)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Row 2: Challenges ────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="text-[13px] font-semibold" style={{ color: 'var(--c-pink)' }}>⚔ {t('Challenges')}</div>
          <div className="text-[10px] text-[rgba(255,255,255,0.25)]">{t('permanent · no expiry')}</div>
          <div className="text-[11px] ml-auto" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {boss.filter(q => q.status === 'completed').length}/{boss.length} {t('completed')}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {boss.map(q => <QuestCard key={q.id} quest={q} />)}
        </div>
      </div>

      {/* ── Achievements ─────────────────────────────────────────────────────── */}
      <div>
        <div className="text-[13px] font-medium text-[rgba(255,255,255,0.7)] mb-3">{t('Achievements')}</div>
        <div className="grid grid-cols-2 gap-2">
          {(achievements ?? []).map(a => <AchievementCard key={a.id} ach={a} />)}
        </div>
      </div>
    </div>
  )
}

const PERSONALITY = [
  { test: h => h >= 0  && h < 5,  label: 'Night Owl',         emoji: '🦉', desc: 'You come alive after midnight. Most active in the dead of night.',        color: 'var(--c-accent-text)' },
  { test: h => h >= 5  && h < 9,  label: 'Early Bird',        emoji: '🌅', desc: 'Up with the sun and already deep in the vault.',                           color: 'var(--c-amber)' },
  { test: h => h >= 9  && h < 13, label: 'Morning Lurker',    emoji: '☕', desc: 'Coffee in one hand, the vault in the other.',                              color: 'var(--c-amber-text)' },
  { test: h => h >= 13 && h < 17, label: 'Afternoon Delight', emoji: '☀️', desc: 'Peak hours fall right in the afternoon. Classic.',                         color: 'var(--c-green)' },
  { test: h => h >= 17 && h < 21, label: 'Evening Gooner',    emoji: '🌆', desc: 'After work, the real work begins. You know what you came home for.',       color: 'var(--c-pink)' },
  { test: h => h >= 21,           label: 'Midnight Lurker',   emoji: '🌙', desc: 'Late night sessions are your specialty. The vault never sleeps, and neither do you.', color: 'var(--c-accent)' },
]

function fmtSeconds(sec) {
  if (!sec || sec < 60) return null
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function CreatorBar({ name, value, maxVal, label, color = 'var(--c-pink)', gradientEnd = '#F47AA0', rank }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.3)', width: 28, textAlign: 'right', flexShrink: 0 }}>#{rank}</div>
      <div style={{ fontSize: 19, fontWeight: 600, color: 'rgba(255,255,255,0.8)', width: 180, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
      <div style={{ flex: 1, height: 26, borderRadius: 4, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 4, width: `${(value / maxVal) * 100}%`, background: `linear-gradient(to right, ${color}, ${gradientEnd})`, transition: 'width 0.4s ease' }} />
      </div>
      <div style={{ fontSize: 19, fontWeight: 700, color, width: 72, textAlign: 'right', flexShrink: 0 }}>{label}</div>
    </div>
  )
}

// XP needed to reach a given level: sum(500*i, i=1..lvl-1) = 500*(lvl-1)*lvl/2
const xpForLevel = lvl => lvl <= 1 ? 0 : 500 * (lvl - 1) * lvl / 2

function getLevelColor(lvl) {
  if (lvl >= 96) return '#FFD700'
  if (lvl >= 81) return '#C084FC'
  if (lvl >= 71) return '#FF6B35'
  if (lvl >= 61) return '#E24B4A'
  if (lvl >= 51) return 'var(--c-amber)'
  if (lvl >= 41) return 'var(--c-pink)'
  if (lvl >= 31) return 'var(--c-accent)'
  if (lvl >= 21) return '#378ADD'
  if (lvl >= 11) return 'var(--c-green)'
  return '#888780'
}

// ── Sessions history modal ────────────────────────────────────────────────────
function SessionsModal({ onClose }) {
  const t  = useT()
  const qc = useQueryClient()
  const { data: allSessions } = useQuery({
    queryKey: ['all-sessions'],
    queryFn: () => sessionsApi.list({ limit: 500 }).then(r => r.data),
  })

  // Entrance animation — mount with scale/opacity then transition in
  const [visible, setVisible] = React.useState(false)
  React.useEffect(() => { const id = requestAnimationFrame(() => setVisible(true)); return () => cancelAnimationFrame(id) }, [])

  // Sessions are recorded automatically, so a crash, a forgotten stop or a
  // mis-attributed creator leaves a row only the user can put right. Editing
  // targets the group's first row (the one carrying the duration); deleting
  // takes every row in the group, since one multi-panel session writes several.
  const [editing,  setEditing]  = React.useState(null)   // group object
  const [adding,   setAdding]   = React.useState(false)
  const [busyIds,  setBusyIds]  = React.useState(new Set())

  const refresh = () => {
    for (const key of ['all-sessions', 'recent-sessions', 'ses-stats', 'profile']) {
      qc.invalidateQueries({ queryKey: [key] })
    }
  }

  const deleteGroup = async (g) => {
    if (busyIds.has(g.ids[0])) return
    setBusyIds(prev => new Set([...prev, g.ids[0]]))
    try {
      await sessionsApi.bulkDelete(g.ids)
      toast.success(g.ids.length > 1 ? `${g.ids.length} session rows deleted` : 'Session deleted')
      refresh()
    } catch {
      toast.error('Could not delete that session')
    } finally {
      setBusyIds(prev => { const n = new Set(prev); n.delete(g.ids[0]); return n })
    }
  }

  const groups = React.useMemo(() => {
    if (!allSessions?.length) return []
    const result = []
    let cur = null
    for (const s of allSessions) {
      const tm = new Date(s.logged_at + (s.logged_at.endsWith('Z') ? '' : 'Z')).getTime()
      if (!cur || Math.abs(tm - cur.refTime) > 5000) {
        cur = {
          refTime: tm, logged_at: s.logged_at,
          creators: s.creator_name ? [s.creator_name] : [],
          gallery_name: s.gallery_name, duration_sec: s.duration_sec,
          ids: [s.id],
          // The row that actually carries the duration — not always the first,
          // so an edit has to patch this one or the correction goes nowhere.
          durationId: s.duration_sec ? s.id : null,
        }
        result.push(cur)
      } else {
        if (s.creator_name && !cur.creators.includes(s.creator_name)) cur.creators.push(s.creator_name)
        if (!cur.duration_sec && s.duration_sec) { cur.duration_sec = s.duration_sec; cur.durationId = s.id }
        cur.ids.push(s.id)
      }
    }
    return result
  }, [allSessions])

  const [expanded,    setExpanded]    = React.useState(new Set())
  const [hoveredRow,  setHoveredRow]  = React.useState(null)
  const [hoveredMore, setHoveredMore] = React.useState(null)

  const toggle = (i) => setExpanded(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })

  const relTime = (ts) => {
    const tm = new Date(ts + (ts.endsWith('Z') ? '' : 'Z'))
    const d = Math.floor((Date.now() - tm.getTime()) / 86400000)
    if (d === 0) return t('Today')
    if (d === 1) return t('Yesterday')
    if (d < 7) return tm.toLocaleDateString('en-US', { weekday: 'long' })
    if (d < 30) return `${d} days ago`
    return tm.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const fullDate = (ts) => {
    const tm = new Date(ts + (ts.endsWith('Z') ? '' : 'Z'))
    return tm.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) +
      ` ${t('at')} ` + tm.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  const fmtDur = (sec) => {
    if (!sec) return null
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60)
    if (h > 0) return `${h}h ${m}m`
    return m > 0 ? `${m} minute${m !== 1 ? 's' : ''}` : t('less than a minute')
  }

  const creatorSentence = (creators, idx) => {
    if (creators.length === 0) return <span style={{ color: 'rgba(255,255,255,0.4)' }}>{t('an unknown session')}</span>
    const wrap = (name) => <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>{name}</span>
    if (creators.length === 1) return wrap(creators[0])
    if (creators.length === 2) return <>{wrap(creators[0])} {t('and')} {wrap(creators[1])}</>
    if (creators.length === 3) return <>{wrap(creators[0])}, {wrap(creators[1])} {t('and')} {wrap(creators[2])}</>
    const extra = creators.slice(2)
    return (
      <>{wrap(creators[0])}, {wrap(creators[1])} {t('and')}{' '}
        <span style={{ position: 'relative', display: 'inline-block' }}>
          <span
            style={{
              color: 'var(--c-pink)', fontWeight: 700, cursor: 'default',
              borderBottom: '1px dotted color-mix(in srgb, var(--c-pink) 50%, transparent)',
              transition: 'color 0.15s, border-color 0.15s',
            }}
            onMouseEnter={() => setHoveredMore(idx)}
            onMouseLeave={() => setHoveredMore(null)}
          >{extra.length} {t('more')}</span>
          <div style={{
            position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%',
            transform: `translateX(-50%) scale(${hoveredMore === idx ? 1 : 0.95})`,
            background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.12)',
            borderRadius: 8, padding: '8px 14px', zIndex: 200,
            boxShadow: '0 8px 32px rgba(0,0,0,0.7)', pointerEvents: 'none',
            opacity: hoveredMore === idx ? 1 : 0,
            transition: 'opacity 0.15s ease, transform 0.15s ease',
            whiteSpace: 'nowrap',
          }}>
            {extra.map((n, j) => <div key={j} style={{ fontSize: 16, color: 'rgba(255,255,255,0.85)', lineHeight: 1.7 }}>{n}</div>)}
          </div>
        </span>
      </>
    )
  }

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.75)', padding: 24 }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#161616',
          border: '0.5px solid rgba(255,255,255,0.1)',
          borderRadius: 16,
          width: '100%', maxWidth: 640, maxHeight: '80vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
          // Box entrance: slide up + fade
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.98)',
          transition: 'opacity 0.22s ease, transform 0.22s ease',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '0.5px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>{t('Session History')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* For sessions the app never saw — logged offline, or the start
                button was never pressed. */}
            <button
              onClick={() => setAdding(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 8,
                fontSize: 16, cursor: 'pointer',
                background: 'color-mix(in srgb, var(--c-accent) 16%, transparent)',
                color: 'color-mix(in srgb, var(--c-accent) 82%, white)',
                border: '0.5px solid color-mix(in srgb, var(--c-accent) 38%, transparent)',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--c-accent) 28%, transparent)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--c-accent) 16%, transparent)' }}
            >
              <Plus size={14} /> {t('Add')}
            </button>
            <button
              onClick={onClose}
            style={{ color: 'rgba(255,255,255,0.35)', background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, transition: 'color 0.15s, background 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.8)'; e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.35)'; e.currentTarget.style.background = 'transparent' }}
          ><X size={16} /></button>
          </div>
        </div>

        {/* Scrollable list */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {!allSessions
            ? <div style={{ padding: 24, color: 'rgba(255,255,255,0.3)', fontSize: 16 }}>{t('Loading…')}</div>
            : groups.length === 0
              ? <div style={{ padding: 24, color: 'rgba(255,255,255,0.3)', fontSize: 16 }}>{t('No sessions logged yet.')}</div>
              : groups.map((g, i) => {
                  const isOpen    = expanded.has(i)
                  const isHovered = hoveredRow === i
                  const label = g.creators.length > 0
                    ? g.creators.slice(0, 3).join(', ') + (g.creators.length > 3 ? ` +${g.creators.length - 3}` : '')
                    : (g.gallery_name || t('Unknown'))
                  const dur = fmtDur(g.duration_sec)
                  return (
                    <div key={i} style={{ borderBottom: '0.5px solid rgba(255,255,255,0.05)' }}>
                      {/* Collapsed row */}
                      <div
                        onClick={() => toggle(i)}
                        onMouseEnter={() => setHoveredRow(i)}
                        onMouseLeave={() => setHoveredRow(null)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '13px 24px', cursor: 'pointer',
                          background: isOpen
                            ? 'rgba(255,255,255,0.03)'
                            : isHovered ? 'rgba(255,255,255,0.02)' : 'transparent',
                          transition: 'background 0.15s',
                        }}
                      >
                        <span style={{ fontSize: 14, flexShrink: 0, opacity: isHovered ? 0.65 : 0.35, transition: 'opacity 0.15s' }}>💧</span>
                        <div style={{ flex: 1, fontSize: 16, fontWeight: 600, color: isHovered ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', transition: 'color 0.15s' }}>{label}</div>
                        <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>{relTime(g.logged_at)}</div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', flexShrink: 0, transition: 'transform 0.2s ease', transform: isOpen ? 'rotate(180deg)' : 'none' }}>▾</div>
                      </div>

                      {/* Expanded detail */}
                      <div style={{
                        overflow: 'hidden',
                        maxHeight: isOpen ? 200 : 0,
                        opacity: isOpen ? 1 : 0,
                        transition: 'max-height 0.25s ease, opacity 0.2s ease',
                      }}>
                        <div style={{ padding: '2px 24px 14px 52px', fontSize: 16, color: 'rgba(255,255,255,0.45)', lineHeight: 1.7 }}>
                          {t('You gooned to')} {creatorSentence(g.creators, i)} {t('on')}{' '}
                          <span style={{ color: 'rgba(255,255,255,0.6)' }}>{fullDate(g.logged_at)}</span>
                          {dur && <>{' '}{t('for')} <span style={{ color: 'var(--c-pink)' }}>{dur}</span></>}.

                          {/* Manual correction. Sessions log themselves, so a
                              crash or a forgotten stop can only be fixed here. */}
                          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                            <RowAction
                              icon={Pencil}
                              label={t('Edit')}
                              onClick={(e) => { e.stopPropagation(); setEditing(g) }}
                            />
                            <RowAction
                              icon={Trash2}
                              label={busyIds.has(g.ids[0]) ? t('Deleting…') : t('Delete')}
                              danger
                              onClick={(e) => { e.stopPropagation(); deleteGroup(g) }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })
          }
        </div>
      </div>

      {(editing || adding) && (
        <SessionEditor
          session={editing}
          onClose={() => { setEditing(null); setAdding(false) }}
          onSaved={() => { setEditing(null); setAdding(false); refresh() }}
        />
      )}
    </div>,
    document.body
  )
}

// Small text button used inside an expanded session row.
function RowAction({ icon: Icon, label, danger, onClick }) {
  const base   = danger ? 'var(--c-pink)' : 'var(--c-accent)'
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '5px 11px', borderRadius: 8,
        fontSize: 16, cursor: 'pointer',
        background: `color-mix(in srgb, ${base} 12%, transparent)`,
        color: `color-mix(in srgb, ${base} 80%, white)`,
        border: `0.5px solid color-mix(in srgb, ${base} 32%, transparent)`,
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = `color-mix(in srgb, ${base} 24%, transparent)` }}
      onMouseLeave={e => { e.currentTarget.style.background = `color-mix(in srgb, ${base} 12%, transparent)` }}
    >
      <Icon size={13} /> {label}
    </button>
  )
}

/**
 * Manual create / correct for a session record.
 *
 * `session` null = adding one the app never recorded. Otherwise it is a group
 * from the history list, and the patch goes to the row that actually carries
 * the duration — in a multi-panel session that is not necessarily the first.
 *
 * Manual adds are logged with skip_xp: XP is for gooning, not for typing, and
 * an editable XP source would make the whole progression meaningless. Editing
 * an existing session never re-scores its XP either — the system rewards and
 * never penalises.
 */
function SessionEditor({ session, onClose, onSaved }) {
  const t = useT()
  const isEdit = !!session

  // datetime-local wants local wall-clock; stored timestamps are naive UTC.
  const toLocalInput = (ts) => {
    const d = ts ? new Date(ts + (ts.endsWith('Z') ? '' : 'Z')) : new Date()
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const [when,    setWhen]    = React.useState(() => toLocalInput(session?.logged_at))
  const [minutes, setMinutes] = React.useState(() =>
    String(Math.max(0, Math.round((session?.duration_sec || 0) / 60))))
  const [busy,    setBusy]    = React.useState(false)

  const save = async () => {
    if (busy) return
    const mins = Math.max(0, parseInt(minutes || '0', 10) || 0)
    // The datetime-local value is local time; the API stores naive UTC.
    const loggedAt = new Date(when).toISOString().replace('Z', '')
    setBusy(true)
    try {
      if (isEdit) {
        await sessionsApi.update(session.durationId ?? session.ids[0], {
          duration_sec: mins * 60,
          logged_at: loggedAt,
        })
        // Sibling rows of a multi-panel session share the timestamp — moving
        // only one would split the group into two entries in the history.
        for (const id of session.ids) {
          if (id === (session.durationId ?? session.ids[0])) continue
          await sessionsApi.update(id, { logged_at: loggedAt })
        }
        toast.success(t('Session updated'))
      } else {
        await sessionsApi.log({
          duration_sec: mins * 60,
          logged_at: loggedAt,
          count_orgasm: false,
          skip_xp: true,
        })
        toast.success(t('Session added'))
      }
      onSaved()
    } catch {
      toast.error(isEdit ? t('Could not update that session') : t('Could not add that session'))
      setBusy(false)
    }
  }

  const fieldStyle = {
    width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 16,
    background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.9)',
    border: '0.5px solid rgba(255,255,255,0.12)', outline: 'none',
    colorScheme: 'dark',
  }

  return (
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', padding: 24 }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--c-surface)',
          border: '0.5px solid rgba(255,255,255,0.1)',
          borderRadius: 14, width: '100%', maxWidth: 400,
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)', overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '16px 20px', borderBottom: '0.5px solid rgba(255,255,255,0.07)',
          fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.9)',
        }}>
          {isEdit ? t('Edit session') : t('Add session')}
        </div>

        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label htmlFor="ses-when" style={{ display: 'block', fontSize: 16, marginBottom: 7, color: 'rgba(255,255,255,0.4)' }}>
              {t('When')}
            </label>
            <input id="ses-when" type="datetime-local" value={when}
                   onChange={e => setWhen(e.target.value)} style={fieldStyle} />
          </div>
          <div>
            <label htmlFor="ses-mins" style={{ display: 'block', fontSize: 16, marginBottom: 7, color: 'rgba(255,255,255,0.4)' }}>
              {t('Duration (minutes)')}
            </label>
            <input id="ses-mins" type="number" min="0" value={minutes}
                   onChange={e => setMinutes(e.target.value)} style={fieldStyle} />
          </div>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 10,
          padding: '12px 20px 16px', borderTop: '0.5px solid rgba(255,255,255,0.07)',
        }}>
          <button onClick={onClose} disabled={busy}
                  style={{
                    padding: '8px 15px', borderRadius: 9, fontSize: 16,
                    cursor: busy ? 'default' : 'pointer',
                    background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)',
                    border: '0.5px solid rgba(255,255,255,0.1)',
                  }}>
            {t('Cancel')}
          </button>
          <button onClick={save} disabled={busy}
                  style={{
                    padding: '8px 17px', borderRadius: 9, fontSize: 16, fontWeight: 600,
                    cursor: busy ? 'default' : 'pointer',
                    background: 'color-mix(in srgb, var(--c-accent) 18%, transparent)',
                    color: 'color-mix(in srgb, var(--c-accent) 80%, white)',
                    border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)',
                    opacity: busy ? 0.5 : 1,
                  }}>
            {busy ? t('Saving…') : t('Save')}
          </button>
        </div>
      </div>
    </div>
  )
}

// Opens the full ranked list behind a Top-Creators chart.
function SeeAllCreators({ onClick }) {
  const t = useT()
  return (
    <div className="flex justify-center mt-4">
      <button onClick={onClick}
              className="flex items-center gap-2 px-4 py-2 rounded-[9px] cursor-pointer transition-colors hover:bg-white/10"
              style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)',
                       background: 'rgba(255,255,255,0.04)',
                       border: '0.5px solid rgba(255,255,255,0.12)' }}>
        {t('See all creators')} <ChevronDown size={15} />
      </button>
    </div>
  )
}

export function Stats() {
  // The existing page is all "right now" — last 7 days, 13 weeks, all-time
  // totals. The History tab (components/stats/Almanac.jsx) is the long view. Tabs
  // this component is already ~770 lines.
  const [statsTab, setStatsTab] = React.useState('overview')
  // Each Top-Creators chart shows six; these open the full ranked list behind
  // it, reusing the same infinite-scroll modal the Hall of Fame uses.
  const [leaderboard, setLeaderboard] = React.useState(null)   // metric key
  const [statsCreatorId, setStatsCreatorId] = React.useState(null)
  const fetchLeaderboard = React.useCallback(
    (limit, offset) => creatorsApi.leaderboard(leaderboard, limit, offset).then(r => r.data),
    [leaderboard])
  const LEADERBOARDS = {
    time_spent: { title: 'All creators · time spent', subtitle: 'Ranked by hours you have spent with her' },
    sessions:   { title: 'All creators · session count', subtitle: 'Ranked by sessions logged' },
    edges:      { title: 'All creators · edges', subtitle: 'Ranked by edges held' },
  }
  const addXpToast     = useVaultStore(s => s.addXpToast)
  const sessionActive  = useVaultStore(s => s.sessionActive)
  const { startSession, finishSession } = useSession()
  const sessionTotalMs = useVaultStore(s => s.sessionTotalMs)
  const profile        = useVaultStore(s => s.profile)
  const accent         = useVaultStore(s => s.accent)
  const t = useT()
  const accentRgb      = React.useMemo(() => {
    const m = accent?.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
    return m ? `${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)}` : '127,119,221'
  }, [accent])
  const qc = useQueryClient()

  const { data: stats } = useQuery({
    queryKey: ['ses-stats'],
    queryFn: () => sessionsApi.stats().then(r => r.data),
    refetchInterval: 30000,
  })

  const { data: creatorDist } = useQuery({
    queryKey: ['creator-dist'],
    queryFn: () => creatorsApi.distribution().then(r => r.data),
    staleTime: 60000,
  })

  const { data: vaultStats } = useQuery({
    queryKey: ['vault-stats'],
    queryFn: () => galleriesApi.stats().then(r => r.data),
    staleTime: 60000,
  })

  const { data: cardRarityDist } = useQuery({
    queryKey: ['card-rarity-dist'],
    queryFn: () => cardsApi.rarityDistribution().then(r => r.data),
    staleTime: 60000,
  })

  const { data: byCountry } = useQuery({
    queryKey: ['creators-by-country'],
    queryFn: () => creatorsApi.byCountry().then(r => r.data),
    staleTime: 300000,
  })

  const { data: recentSessions } = useQuery({
    queryKey: ['recent-sessions'],
    queryFn: () => sessionsApi.list({ limit: 20 }).then(r => r.data),
    staleTime: 30000,
  })

  const [showMapModal, setShowMapModal] = React.useState(false)
  const [showSessionsModal, setShowSessionsModal] = React.useState(false)

  const logMutation = useMutation({
    mutationFn: (data = {}) => sessionsApi.log(data).then(r => r.data),
    onSuccess: (data) => {
      addXpToast(`+${data.xp_earned} XP`)
      toast.success(t('Session logged ❤️'))
      qc.invalidateQueries({ queryKey: ['ses-stats'] })
    },
  })

  const handleSession = () => {
    if (!sessionActive) startSession()
    else                finishSession()
  }

  const fmtHour = (h) => {
    if (h === null || h === undefined) return '—'
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 || 12
    return `${h12}:00 ${ampm}`
  }

  const fmtDuration = (sec) => {
    if (!sec) return '—'
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    if (h > 0) return `${h}h ${m}m`
    return m > 0 ? `${m}m` : '<1m'
  }

  const personality = React.useMemo(() => {
    const h = stats?.peak_hour
    if (h === null || h === undefined) return null
    return PERSONALITY.find(p => p.test(h)) ?? null
  }, [stats?.peak_hour])

  const byDay  = stats?.sessions_by_day  ?? []
  const byDate = stats?.sessions_by_date ?? []
  const byHour = stats?.sessions_by_hour ?? []
  const maxDay  = Math.max(1, ...byDay.map(d => d.count))
  const maxHour = Math.max(1, ...byHour.map(d => d.count))

  const heatmapCells = React.useMemo(() => {
    const map = {}
    for (const d of byDate) map[d.date] = d.count
    const cells = []
    const today = new Date()
    for (let i = 90; i >= 0; i--) {
      const dt = new Date(today)
      dt.setDate(today.getDate() - i)
      const key = dt.toISOString().slice(0, 10)
      cells.push({ date: key, count: map[key] ?? 0 })
    }
    return cells
  }, [byDate])
  const maxHeat = Math.max(1, ...heatmapCells.map(c => c.count))

  // Day-of-week totals computed from the 91-day date array (Mon first)
  const byWeekday = React.useMemo(() => {
    const totals = [0, 0, 0, 0, 0, 0, 0]
    for (const d of byDate) totals[new Date(d.date + 'T12:00:00').getDay()] += d.count
    return [1, 2, 3, 4, 5, 6, 0].map((dow, i) => ({
      label: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i],
      count: totals[dow],
      isWeekend: dow === 0 || dow === 6,
    }))
  }, [byDate])
  const maxWeekday = Math.max(1, ...byWeekday.map(d => d.count))

  // Level progress (100-level quadratic curve)
  const lvl       = profile?.level ?? 1
  const totalXp   = profile?.total_xp ?? 0
  const lvlColor  = getLevelColor(lvl)
  const curThresh = xpForLevel(lvl)
  const nextThresh = xpForLevel(lvl + 1)
  const lvlPct    = lvl >= 100 ? 100 : Math.min(100, ((totalXp - curThresh) / (nextThresh - curThresh)) * 100)
  const xpToNext  = Math.max(0, nextThresh - totalXp)

  // Consistency score — how many of the last 91 days had at least one session
  const activeDays     = byDate.filter(d => d.count > 0).length
  const consistencyPct = Math.round((activeDays / 91) * 100)

  // AM vs PM session split
  const amTotal = byHour.filter(d => d.hour < 12).reduce((s, d) => s + d.count, 0)
  const pmTotal = byHour.filter(d => d.hour >= 12).reduce((s, d) => s + d.count, 0)
  const amPmTotal = Math.max(1, amTotal + pmTotal)
  const pmPct = Math.round((pmTotal / amPmTotal) * 100)
  const amPct = 100 - pmPct

  const heatColor = (count) => {
    if (count === 0) return 'rgba(255,255,255,0.05)'
    const intensity = Math.min(1, count / Math.max(maxHeat, 1))
    if (intensity < 0.33) return 'color-mix(in srgb, var(--c-pink) 30%, transparent)'
    if (intensity < 0.66) return 'color-mix(in srgb, var(--c-pink) 60%, transparent)'
    return 'var(--c-pink)'
  }

  const totalViewFmt   = fmtSeconds(stats?.total_view_seconds)
  const totalCount     = stats?.total ?? 0
  const topByTime      = stats?.top_creators_by_time ?? []
  const maxViewSecs    = Math.max(1, ...topByTime.map(c => c.seconds))
  const topBySessions  = stats?.top_creators_chart ?? []
  const maxSessionCount = Math.max(1, ...topBySessions.map(c => c.count))
  const topByEdges     = stats?.top_creators_by_edges ?? []
  const maxEdges       = Math.max(1, ...topByEdges.map(c => c.edges))

  return (
    <div className="p-5 flex flex-col gap-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-[21px] font-medium text-[rgba(255,255,255,0.9)]">{t('Stats')}</div>
        <button onClick={handleSession}
                className="flex items-center gap-1.5 font-medium px-5 py-2.5 rounded-full cursor-pointer transition-all"
                style={{ fontSize: 17, ...(sessionActive
                  ? { background: 'color-mix(in srgb, var(--c-pink) 35%, transparent)', color: '#FFD4E2', border: '1px solid color-mix(in srgb, var(--c-pink) 70%, transparent)', boxShadow: '0 0 12px color-mix(in srgb, var(--c-pink) 40%, transparent)' }
                  : { background: 'color-mix(in srgb, var(--c-pink) 20%, transparent)', color: '#F4C0D1', border: '0.5px solid color-mix(in srgb, var(--c-pink) 35%, transparent)' }) }}>
          ❤️ {sessionActive ? t('End session') : t('Start session')}
        </button>
      </div>

      {/* Tabs — Overview is everything that was here before, untouched */}
      <div className="flex items-center gap-2">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'almanac',  label: 'History' },
        ].map(tab => {
          const active = statsTab === tab.id
          return (
            <button key={tab.id} onClick={() => setStatsTab(tab.id)}
                    className="px-4 py-2 rounded-[9px] cursor-pointer transition-all"
                    style={{ fontSize: 17, fontWeight: 600,
                             background: active ? 'var(--c-accent-fill-2)' : 'rgba(255,255,255,0.04)',
                             color: active ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.45)',
                             border: `0.5px solid ${active ? 'var(--c-accent)' : 'rgba(255,255,255,0.1)'}` }}>
              {t(tab.label)}
            </button>
          )
        })}
      </div>

      <HofFullListModal
        open={!!leaderboard}
        title={LEADERBOARDS[leaderboard]?.title}
        subtitle={LEADERBOARDS[leaderboard]?.subtitle}
        fetchPage={fetchLeaderboard}
        onRowClick={(item) => { setLeaderboard(null); setStatsCreatorId(item.id) }}
        onClose={() => setLeaderboard(null)}
      />
      <CreatorStatsModal creatorId={statsCreatorId} onClose={() => setStatsCreatorId(null)} />

      {statsTab === 'almanac' && <Almanac />}
      {statsTab === 'overview' && (<>

      {/* Wrapped Hero Banner — split with world map */}
      <div className="flex gap-4" style={{ alignItems: 'stretch' }}>
        {/* Left: session stats */}
        {totalCount > 0 && (
          <div className="flex-1 rounded-[14px] relative overflow-hidden"
               style={{ background: `linear-gradient(135deg, rgba(${accentRgb},0.14) 0%, #0e0e0e 55%, rgba(${accentRgb},0.07) 100%)`, border: `0.5px solid rgba(${accentRgb},0.25)`, padding: '28px 32px' }}>
            {/* Decorative glow */}
            <div style={{ position: 'absolute', top: 0, right: 0, width: 320, height: 320, background: `radial-gradient(circle, rgba(${accentRgb},0.12) 0%, transparent 65%)`, transform: 'translate(25%, -25%)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', bottom: 0, left: '30%', width: 200, height: 200, background: 'radial-gradient(circle, color-mix(in srgb, var(--c-pink) 8%, transparent) 0%, transparent 65%)', pointerEvents: 'none' }} />

            <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>{t('Your vault · all time')}</div>
            <div style={{ fontSize: 58, fontWeight: 900, color: '#fff', lineHeight: 1, letterSpacing: '-0.02em' }}>
              {totalCount.toLocaleString()}
            </div>
            <div style={{ fontSize: 22, fontWeight: 500, color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>
              {totalCount === 1 ? t('session logged') : t('sessions logged')}
            </div>
            <div style={{ display: 'flex', gap: 28, marginTop: 18, flexWrap: 'wrap' }}>
              {stats?.total_duration_sec > 0 && (
                <div>
                  <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Session time')}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-pink)' }}>{fmtDuration(stats.total_duration_sec)}</div>
                </div>
              )}
              {totalViewFmt && (
                <div>
                  <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Time spent viewing')}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: accent }}>{totalViewFmt}</div>
                </div>
              )}
              {stats?.total_cum_count > 0 && (
                <div>
                  <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('All-time count')}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#F47AA0' }}>{stats.total_cum_count.toLocaleString()} 💦</div>
                </div>
              )}
              {stats?.total_edge_count > 0 && (
                <div>
                  <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Edges')}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-accent-text)' }}>
                    {stats.total_edge_count.toLocaleString()} 🌊
                  </div>
                </div>
              )}
              {stats?.top_creator_name && (
                <div>
                  <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Goon Queen')}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: accent }}>{stats.top_creator_name}</div>
                </div>
              )}
            </div>

            {/* Recent sessions — fills the empty space below the stat row */}
            {(recentSessions?.length ?? 0) > 0 && (() => {
              const groups = []
              let cur = null
              for (const s of recentSessions) {
                const tm = new Date(s.logged_at + (s.logged_at.endsWith('Z') ? '' : 'Z')).getTime()
                if (!cur || Math.abs(tm - cur.refTime) > 5000) {
                  cur = {
                    refTime: tm, logged_at: s.logged_at,
                    creators: s.creator_name ? [s.creator_name] : [],
                    gallery_name: s.gallery_name,
                    duration_sec: s.duration_sec,
                    xp_earned: s.xp_earned || 0,
                  }
                  groups.push(cur)
                } else {
                  if (s.creator_name && !cur.creators.includes(s.creator_name)) cur.creators.push(s.creator_name)
                  cur.xp_earned += (s.xp_earned || 0)
                  if (!cur.duration_sec && s.duration_sec) cur.duration_sec = s.duration_sec
                }
              }
              const relTime = (ts) => {
                const dt = new Date(ts + (ts.endsWith('Z') ? '' : 'Z'))
                const d = Math.floor((Date.now() - dt.getTime()) / 86400000)
                if (d === 0) return t('Today')
                if (d === 1) return t('Yesterday')
                if (d < 7) return dt.toLocaleDateString('en-US', { weekday: 'short' })
                if (d < 30) return `${d}d ago`
                return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              }
              const visible = groups.slice(0, 6)
              return (
                <div style={{ marginTop: 22, borderTop: '0.5px solid rgba(255,255,255,0.07)', paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>{t('Recent sessions')}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {visible.map((g, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '7px 0',
                        borderBottom: i < visible.length - 1 ? '0.5px solid rgba(255,255,255,0.05)' : 'none',
                      }}>
                        <span style={{ fontSize: 14, flexShrink: 0, opacity: 0.5 }}>💧</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {g.creators.length > 0 ? g.creators.join(' · ') : (g.gallery_name || t('Unknown'))}
                          </div>
                          {g.gallery_name && g.creators.length > 0 && (
                            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {g.gallery_name}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                          {g.duration_sec > 0 && <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>{fmtDuration(g.duration_sec)}</span>}
                          {g.xp_earned > 0 && <span style={{ fontSize: 16, fontWeight: 700, color: accent }}>+{g.xp_earned} XP</span>}
                          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.2)', minWidth: 52, textAlign: 'right' }}>{relTime(g.logged_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {(groups.length >= 6 || totalCount > (recentSessions?.length ?? 0)) && (
                    <button
                      onClick={() => setShowSessionsModal(true)}
                      style={{ marginTop: 12, fontSize: 16, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 500, opacity: 0.7, transition: 'opacity 0.15s' }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '1' }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = '0.7' }}
                    >
                      {t('See more →')}
                    </button>
                  )}
                </div>
              )
            })()}
          </div>
        )}

        {/* Right: world map */}
        <div className="rounded-[14px] flex flex-col overflow-hidden cursor-pointer"
             style={{ width: totalCount > 0 ? '42%' : '100%', flexShrink: 0, background: 'rgba(255,255,255,0.03)', border: `0.5px solid rgba(${accentRgb},0.2)`, minHeight: 220 }}
             onClick={() => setShowMapModal(true)}>
          <div className="flex items-center justify-between px-4 pt-3 flex-shrink-0">
            <div className="flex items-center gap-2" style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
              <Globe size={14} style={{ color: accent }} /> {t('Creator Origins')}
            </div>
            {(byCountry || []).length > 0 && (
              <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)' }}>
                {(byCountry || []).length} {t('countries · click to explore')}
              </span>
            )}
          </div>
          <div className="flex-1" style={{ minHeight: 170 }}>
            {(byCountry || []).length === 0 ? (
              <div className="flex items-center justify-center h-full" style={{ fontSize: 16, color: 'rgba(255,255,255,0.2)' }}>
                {t('No country data yet — add it to creator profiles')}
              </div>
            ) : (
              <WorldMap byCountry={byCountry} compact={true} />
            )}
          </div>
        </div>
      </div>

      {showMapModal && (
        <WorldMapModal byCountry={byCountry || []} onClose={() => setShowMapModal(false)} />
      )}
      {showSessionsModal && (
        <SessionsModal onClose={() => setShowSessionsModal(false)} />
      )}

      {/* Stats grid */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))' }}>
        {[
          { label: 'Sessions total',     value: totalCount,                                       color: 'var(--c-pink)' },
          { label: 'This week',          value: stats?.this_week ?? 0 },
          { label: 'Session time',       value: fmtDuration(stats?.total_duration_sec),            color: 'var(--c-pink)' },
          { label: 'Avg session',        value: fmtDuration(stats?.avg_duration_sec) },
          { label: 'Viewing time',       value: totalViewFmt ?? '—',                              color: 'var(--c-accent)' },
          { label: 'Cummed (all-time)',   value: (stats?.total_cum_count ?? 0).toLocaleString(),   color: '#F47AA0' },
          { label: 'Edges (all-time)',    value: (stats?.total_edge_count ?? 0).toLocaleString(), color: 'var(--c-accent-text)' },
          { label: 'Edges per O',         value: stats?.edges_per_cum ? `${stats.edges_per_cum}×` : '—', color: 'var(--c-accent-text)' },
          { label: 'Peak hour',          value: fmtHour(stats?.peak_hour) },
          { label: 'XP from sessions',   value: `${(totalCount * 25).toLocaleString()} XP` },
        ].map(s => (
          <div key={s.label} className="rounded-[10px] p-4" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <div style={{ fontSize: 24, fontWeight: 600, color: s.color || 'rgba(255,255,255,0.9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.value}</div>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{t(s.label)}</div>
          </div>
        ))}
      </div>

      {/* Personality card */}
      {personality && (
        <div className="vault-card p-5 flex items-center gap-5">
          <div style={{ fontSize: 44, lineHeight: 1, flexShrink: 0 }}>{personality.emoji}</div>
          <div className="flex-1 min-w-0">
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 5 }}>{t('Your gooning style')}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: personality.color, marginBottom: 4 }}>{t(personality.label)}</div>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>{t(personality.desc)}</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{t('Peak hour')}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: personality.color }}>{fmtHour(stats?.peak_hour)}</div>
          </div>
        </div>
      )}

      {/* Session chart + Hourly distribution */}
      <div className="flex gap-4 flex-wrap">
        {byDay.length > 0 && (
          <div className="vault-card p-5 flex-1" style={{ minWidth: 300 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.09em' }}>{t('Sessions · last 7 days')}</div>
            <div className="flex items-end gap-3" style={{ height: 160 }}>
              {byDay.map(d => {
                const pct = d.count / maxDay
                return (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <div style={{ fontSize: 16, fontWeight: 700, color: d.count > 0 ? 'var(--c-pink)' : 'transparent' }}>{d.count}</div>
                    <div className="w-full rounded-t-[4px] transition-all"
                         style={{ height: `${Math.max(4, pct * 110)}px`, background: d.count > 0 ? 'linear-gradient(to top, var(--c-pink), #F47AA0)' : 'rgba(255,255,255,0.07)' }} />
                    <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)', whiteSpace: 'nowrap' }}>{d.date.slice(5)}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {byHour.some(h => h.count > 0) && (
          <div className="vault-card p-5 flex-1" style={{ minWidth: 300 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.09em' }}>{t('Activity by hour')}</div>
            <div className="flex items-end gap-px" style={{ height: 160 }}>
              {byHour.map(d => {
                const pct = d.count / maxHour
                const isAM = d.hour < 12
                return (
                  <div key={d.hour} className="flex-1 flex flex-col items-center min-w-0" style={{ gap: 3 }}>
                    <div className="w-full rounded-t-[2px]"
                         style={{ height: `${Math.max(2, pct * 110)}px`, background: d.count > 0 ? (isAM ? 'color-mix(in srgb, var(--c-amber) 85%, transparent)' : 'color-mix(in srgb, var(--c-accent) 85%, transparent)') : 'rgba(255,255,255,0.06)' }} />
                    {d.hour % 6 === 0 && (
                      <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.28)', whiteSpace: 'nowrap', marginTop: 3 }}>
                        {d.hour === 0 ? '12a' : d.hour === 12 ? '12p' : d.hour < 12 ? `${d.hour}a` : `${d.hour - 12}p`}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
              <span style={{ fontSize: 16, color: 'color-mix(in srgb, var(--c-amber) 80%, transparent)' }}>{t('■ AM')}</span>
              <span style={{ fontSize: 16, color: 'color-mix(in srgb, var(--c-accent) 80%, transparent)' }}>{t('■ PM')}</span>
            </div>
          </div>
        )}
      </div>

      {/* Top creators by time spent */}
      {topByTime.length > 0 && (
        <div className="vault-card p-5">
          <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginBottom: 18, textTransform: 'uppercase', letterSpacing: '0.09em' }}>{t('Top creators · time spent')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {topByTime.map((c, i) => (
              <CreatorBar key={c.name} rank={i + 1} name={c.name}
                value={c.seconds} maxVal={maxViewSecs}
                label={fmtSeconds(c.seconds) ?? '<1m'}
                color="var(--c-accent)" gradientEnd="var(--c-accent-text)" />
            ))}
          </div>
          <SeeAllCreators onClick={() => setLeaderboard('time_spent')} />
        </div>
      )}

      {/* Top creators by sessions */}
      {topBySessions.length > 0 && (
        <div className="vault-card p-5">
          <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginBottom: 18, textTransform: 'uppercase', letterSpacing: '0.09em' }}>{t('Top creators · session count')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {topBySessions.map((c, i) => (
              <CreatorBar key={c.name} rank={i + 1} name={c.name}
                value={c.count} maxVal={maxSessionCount}
                label={String(c.count)}
                color="var(--c-pink)" gradientEnd="#F47AA0" />
            ))}
          </div>
          <SeeAllCreators onClick={() => setLeaderboard('sessions')} />
        </div>
      )}

      {/* Top creators by edges — who you hold back the longest for */}
      {topByEdges.length > 0 && (
        <div className="vault-card p-5">
          <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginBottom: 18, textTransform: 'uppercase', letterSpacing: '0.09em' }}>{t('Top creators · edges')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {topByEdges.map((c, i) => (
              <CreatorBar key={c.name} rank={i + 1} name={c.name}
                value={c.edges} maxVal={maxEdges}
                label={String(c.edges)}
                color="var(--c-accent)" gradientEnd="#A89FE8" />
            ))}
          </div>
          <SeeAllCreators onClick={() => setLeaderboard('edges')} />
        </div>
      )}

      {/* Row: XP chart (left) · 2×2 grid of mini stats (right) */}
      {(stats?.xp_by_day ?? []).some(d => d.xp > 0) && (
        <div className="flex gap-4" style={{ alignItems: 'stretch' }}>

          {/* XP bar chart — flex-col so bars fill the full card height */}
          <div className="vault-card p-5 flex flex-col" style={{ width: '42%', flexShrink: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.09em', flexShrink: 0 }}>{t('XP earned · last 7 days')}</div>
            {(() => {
              const xpDays = stats.xp_by_day
              const maxXp  = Math.max(1, ...xpDays.map(d => d.xp))
              return (
                <div className="flex gap-3 flex-1 min-h-0" style={{ alignItems: 'stretch' }}>
                  {xpDays.map(d => {
                    const pct = d.xp / maxXp
                    return (
                      <div key={d.date} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                        {/* value label — always reserve space so bars align */}
                        <div style={{ fontSize: 13, fontWeight: 700, color: d.xp > 0 ? 'var(--accent, var(--c-accent))' : 'transparent', flexShrink: 0, lineHeight: 1.2 }}>
                          {d.xp > 0 ? d.xp.toLocaleString() : '0'}
                        </div>
                        {/* bar area — grows to fill; bar rises from the bottom */}
                        <div className="flex-1 w-full flex flex-col justify-end min-h-0">
                          <div className="w-full rounded-t-[4px] transition-all"
                               style={{ height: d.xp > 0 ? `${Math.max(2, pct * 100)}%` : '2px',
                                        background: d.xp > 0 ? 'linear-gradient(to top, var(--accent, var(--c-accent)), var(--c-accent-text))' : 'rgba(255,255,255,0.07)' }} />
                        </div>
                        {/* date label */}
                        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap', flexShrink: 0 }}>{d.date.slice(5)}</div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>

          {/* 2×2 grid of mini stat cards */}
          <div className="flex-1 grid gap-4" style={{ gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }}>

            {/* Level Progress */}
            <div className="vault-card p-4 flex flex-col">
              <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.09em' }}>{t('Level')}</div>
              <div className="flex items-center gap-3 flex-1">
                <div style={{ fontSize: 52, fontWeight: 900, lineHeight: 1, color: lvlColor, letterSpacing: '-0.04em', textShadow: `0 0 28px ${lvlColor}44`, flexShrink: 0 }}>{lvl}</div>
                <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                  <div style={{ fontSize: 16, fontWeight: 600, color: lvlColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile?.selected_title || profile?.level_title || '—'}</div>
                  <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 99, width: `${lvlPct}%`, background: `linear-gradient(to right, ${lvlColor}88, ${lvlColor})`, transition: 'width 0.6s ease' }} />
                  </div>
                  <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.22)' }}>
                    {lvl < 100 ? <><span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>{xpToNext.toLocaleString()} XP</span> {t('to next')}</> : t('✓ MAX LEVEL')}
                  </div>
                </div>
              </div>
            </div>

            {/* Photo library — distribution by creator type */}
            {(() => {
              const byType = vaultStats?.images_by_creator_type ?? {}
              const totalPhotos = vaultStats?.total_images ?? 0
              const TYPE_META = [
                { key: 'cosplayer', label: 'Cosplayer', color: 'var(--c-green)' },
                { key: 'ethot',     label: 'E-girl',    color: 'var(--c-pink)' },
                { key: 'artist',    label: 'Artist',    color: 'var(--c-accent)' },
                { key: 'character', label: 'Character', color: 'var(--c-amber)' },
                { key: 'actress',   label: 'Actress',   color: '#378ADD' },
                { key: 'custom',    label: 'Model/Other', color: '#888780' },
              ]
              const entries = TYPE_META.filter(ct => (byType[ct.key] || 0) > 0)
              const unassigned = totalPhotos - entries.reduce((s, ct) => s + (byType[ct.key] || 0), 0)
              return (
                <div className="vault-card p-4 flex flex-col gap-3">
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>{t('Photo library')}</div>
                  <div className="flex items-baseline gap-2">
                    <span style={{ fontSize: 40, fontWeight: 900, lineHeight: 1, color: 'var(--c-accent)', letterSpacing: '-0.03em' }}>{totalPhotos.toLocaleString()}</span>
                    <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>{t('photos')}</span>
                    {(vaultStats?.total_videos ?? 0) > 0 && <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)' }}>· {vaultStats.total_videos.toLocaleString()} {t('videos')}</span>}
                  </div>
                  {entries.length > 0 && (
                    <>
                      {/* Stacked bar */}
                      <div style={{ height: 8, borderRadius: 99, overflow: 'hidden', display: 'flex' }}>
                        {entries.map(ct => (
                          <div key={ct.key} title={`${t(ct.label)}: ${byType[ct.key]}`}
                               style={{ width: `${((byType[ct.key] || 0) / Math.max(1, totalPhotos)) * 100}%`, background: ct.color }} />
                        ))}
                        {unassigned > 0 && (
                          <div style={{ flex: 1, background: 'rgba(255,255,255,0.06)' }} title={`${t('Unassigned')}: ${unassigned}`} />
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {entries.map(ct => (
                          <div key={ct.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 8, height: 8, borderRadius: 2, background: ct.color, flexShrink: 0 }} />
                            <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.55)', flex: 1 }}>{t(ct.label)}</span>
                            <span style={{ fontSize: 15, fontWeight: 700, color: ct.color }}>{(byType[ct.key] || 0).toLocaleString()}</span>
                            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)', width: 38, textAlign: 'right' }}>
                              {Math.round(((byType[ct.key] || 0) / Math.max(1, totalPhotos)) * 100)}%
                            </span>
                          </div>
                        ))}
                        {unassigned > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(255,255,255,0.15)', flexShrink: 0 }} />
                            <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.3)', flex: 1 }}>{t('Unassigned')}</span>
                            <span style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.3)' }}>{unassigned.toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            })()}

            {/* Creator type distribution */}
            {(() => {
              const dist = creatorDist?.by_type ?? {}
              const total = creatorDist?.total || 1
              const TYPE_META = [
                { key: 'cosplayer', label: 'Cosplayer', color: 'var(--c-green)' },
                { key: 'ethot',     label: 'E-girl',    color: 'var(--c-pink)' },
                { key: 'artist',    label: 'Artist',    color: 'var(--c-accent)' },
                { key: 'character', label: 'Character', color: 'var(--c-amber)' },
                { key: 'actress',   label: 'Actress',   color: '#378ADD' },
                { key: 'custom',    label: 'Model/Other', color: '#888780' },
              ]
              const entries = TYPE_META.filter(ct => (dist[ct.key] || 0) > 0)
              return (
                <div className="vault-card p-4 flex flex-col" style={{ gridColumn: 'span 1' }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.09em' }}>{t('Creator types')}</div>
                  {/* Stacked bar */}
                  <div style={{ height: 10, borderRadius: 99, overflow: 'hidden', display: 'flex', marginBottom: 10 }}>
                    {entries.map(ct => (
                      <div key={ct.key} style={{ width: `${((dist[ct.key] || 0) / total) * 100}%`, background: ct.color, transition: 'width 0.4s ease' }} />
                    ))}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {entries.map(ct => (
                      <div key={ct.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: ct.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)', flex: 1 }}>{t(ct.label)}</span>
                        <span style={{ fontSize: 16, fontWeight: 700, color: ct.color }}>{dist[ct.key] || 0}</span>
                        <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)', width: 38, textAlign: 'right' }}>{Math.round(((dist[ct.key] || 0) / total) * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* Rarity breakdown */}
            {(() => {
              const dist = creatorDist?.by_rarity ?? {}
              const total = creatorDist?.total || 1
              const RARITY_META = [
                { key: 'legendary', label: 'Grand Collection', color: 'var(--c-amber)' },
                { key: 'epic',      label: 'Library',          color: 'var(--c-accent)' },
                { key: 'rare',      label: 'Big Portfolio',    color: '#378ADD' },
                { key: 'uncommon',  label: 'Album',            color: 'var(--c-green)' },
                { key: 'common',    label: 'Snapshot',         color: '#888780' },
              ]
              const rareAndAbove = ['legendary','epic','rare'].reduce((s, k) => s + (dist[k] || 0), 0)
              const rareAbovePct = Math.round((rareAndAbove / total) * 100)
              return (
                <div className="vault-card p-4 flex flex-col">
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.09em' }}>{t('Collection rarity')}</div>
                  {/* Stacked bar */}
                  <div style={{ height: 10, borderRadius: 99, overflow: 'hidden', display: 'flex', marginBottom: 8 }}>
                    {RARITY_META.filter(r => (dist[r.key] || 0) > 0).map(r => (
                      <div key={r.key} style={{ width: `${((dist[r.key] || 0) / total) * 100}%`, background: r.color }} />
                    ))}
                  </div>
                  <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)', marginBottom: 8 }}>
                    <span style={{ color: '#378ADD', fontWeight: 700, fontSize: 18 }}>{rareAbovePct}%</span> {t('Big Portfolio or above')}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                    {RARITY_META.filter(r => (dist[r.key] || 0) > 0).map(r => (
                      <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 1, background: r.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>{t(r.label)} <span style={{ color: r.color, fontWeight: 700 }}>{dist[r.key]}</span></span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

          </div>
        </div>
      )}

      {/* Row: Heatmap (left) · 2×2 grid: Day of week · AM/PM · Packs · Card rarity (right) */}
      {heatmapCells.length > 0 && (
        <div className="flex gap-4" style={{ alignItems: 'stretch' }}>

          {/* Heatmap — fixed width so grid can breathe */}
          <div className="vault-card p-5 flex flex-col" style={{ width: '42%', flexShrink: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.09em' }}>{t('Activity · last 13 weeks')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(13, 1fr)', gridTemplateRows: 'repeat(7, 1fr)', gridAutoFlow: 'column', gap: 4, flex: 1 }}>
              {heatmapCells.map((cell) => (
                <div key={cell.date}
                     title={`${cell.date}: ${cell.count} session${cell.count !== 1 ? 's' : ''}`}
                     style={{ borderRadius: 3, background: heatColor(cell.count), cursor: 'default' }} />
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.22)' }}>{t('Less')}</span>
              {[0, 0.3, 0.6, 1].map(v => (
                <div key={v} style={{ width: 16, height: 16, borderRadius: 3, background: heatColor(v * maxHeat) }} />
              ))}
              <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.22)' }}>{t('More')}</span>
            </div>
          </div>

          {/* 2×2 grid */}
          <div className="flex-1 grid gap-4" style={{ gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }}>

            {/* Day of week */}
            <div className="vault-card p-4 flex flex-col">
              <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.09em' }}>{t('By day')}</div>
              <div className="flex items-end gap-1 flex-1" style={{ minHeight: 90 }}>
                {byWeekday.map(d => {
                  const pct = d.count / maxWeekday
                  const color = d.isWeekend ? 'var(--c-pink)' : 'var(--c-accent)'
                  const gradEnd = d.isWeekend ? '#F47AA0' : 'var(--c-accent-text)'
                  return (
                    <div key={d.label} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                      <div className="w-full rounded-t-[3px] transition-all"
                           style={{ height: `${Math.max(3, pct * 70)}px`, background: d.count > 0 ? `linear-gradient(to top, ${color}, ${gradEnd})` : 'rgba(255,255,255,0.07)' }} />
                      <div style={{ fontSize: 16, color: d.isWeekend ? 'var(--c-pink)' : 'rgba(255,255,255,0.3)', fontWeight: d.isWeekend ? 600 : 400 }}>{t(d.label)}</div>
                    </div>
                  )
                })}
              </div>
              {byWeekday.some(d => d.count > 0) && (() => {
                const peak = byWeekday.reduce((a, b) => b.count > a.count ? b : a)
                return <div style={{ marginTop: 10, fontSize: 16, color: 'rgba(255,255,255,0.28)' }}>
                  {t('Peak:')} <span style={{ color: peak.isWeekend ? 'var(--c-pink)' : 'var(--c-accent-text)', fontWeight: 600 }}>{t(peak.label)}s</span>
                </div>
              })()}
            </div>

            {/* AM vs PM */}
            <div className="vault-card p-4 flex flex-col">
              <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.09em' }}>{t('AM vs PM')}</div>
              <div className="flex items-center gap-4 flex-1">
                <div style={{
                  width: 72, height: 72, borderRadius: '50%', flexShrink: 0,
                  background: `conic-gradient(var(--c-amber) ${amPct * 3.6}deg, var(--c-accent) 0deg)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <div style={{ width: 46, height: 46, borderRadius: '50%', background: '#1a1a1a' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 16, color: 'var(--c-amber-text)', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--c-amber)', display: 'inline-block' }} />{t('AM')}
                    </span>
                    <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-amber-text)' }}>{amPct}%</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 16, color: 'var(--c-accent-text)', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--c-accent)', display: 'inline-block' }} />{t('PM')}
                    </span>
                    <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-accent-text)' }}>{pmPct}%</span>
                  </div>
                  <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)' }}>
                    {pmPct >= 70 ? t('Night person') : pmPct >= 55 ? t('Mostly evenings') : amPct >= 70 ? t('Early riser') : t('Balanced')}
                  </div>
                </div>
              </div>
            </div>

            {/* Packs opened */}
            <div className="vault-card p-4 flex flex-col justify-between">
              <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>{t('Packs opened')}</div>
              <div>
                <div style={{ fontSize: 56, fontWeight: 900, lineHeight: 1, color: 'var(--c-amber)', letterSpacing: '-0.03em', textShadow: '0 0 28px color-mix(in srgb, var(--c-amber) 40%, transparent)' }}>
                  {(profile?.total_packs_opened ?? 0).toLocaleString()}
                </div>
                <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>
                  {(profile?.total_packs_opened ?? 0) === 0
                    ? t('No packs yet')
                    : (profile?.total_packs_opened ?? 0) >= 50
                      ? t('🔥 Pack addict')
                      : (profile?.total_packs_opened ?? 0) >= 10
                        ? t('Pack junkie')
                        : t('Building the stash')}
                </div>
              </div>
              <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.2)' }}>
                ≈ {((profile?.total_packs_opened ?? 0) * 5).toLocaleString()} {t('cards drawn')}
              </div>
            </div>

            {/* Card rarity distribution (inventory) */}
            {(() => {
              const dist = cardRarityDist?.by_rarity ?? {}
              const total = cardRarityDist?.total || 1
              const RARITY_META = [
                { key: 'celestial', label: 'Celestial', color: '#EDD87A' },
                { key: 'relic',     label: 'Relic',     color: 'var(--c-amber)' },
                { key: 'legendary', label: 'Legendary', color: 'var(--c-pink)' },
                { key: 'epic',      label: 'Epic',      color: 'var(--c-accent)' },
                { key: 'rare',      label: 'Rare',      color: '#378ADD' },
                { key: 'uncommon',  label: 'Uncommon',  color: 'var(--c-green)' },
                { key: 'common',    label: 'Core',      color: '#888780' },
              ]
              const entries = RARITY_META.filter(r => (dist[r.key] || 0) > 0)
              const totalOwned = cardRarityDist?.total ?? 0
              return (
                <div className="vault-card p-4 flex flex-col">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                    <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>{t('Card collection')}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.6)' }}>{totalOwned.toLocaleString()} {t('cards')}</div>
                  </div>
                  {entries.length > 0 ? (
                    <>
                      <div style={{ height: 10, borderRadius: 99, overflow: 'hidden', display: 'flex', marginBottom: 10 }}>
                        {entries.map(r => (
                          <div key={r.key} style={{ width: `${((dist[r.key] || 0) / total) * 100}%`, background: r.color, transition: 'width 0.4s ease' }} />
                        ))}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, justifyContent: 'center' }}>
                        {entries.map(r => (
                          <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 8, height: 8, borderRadius: 2, background: r.color, flexShrink: 0 }} />
                            <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)', flex: 1 }}>{t(r.label)}</span>
                            <span style={{ fontSize: 16, fontWeight: 700, color: r.color }}>{dist[r.key] || 0}</span>
                            <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)', width: 38, textAlign: 'right' }}>{Math.round(((dist[r.key] || 0) / total) * 100)}%</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 17, color: 'rgba(255,255,255,0.2)', marginTop: 'auto', marginBottom: 'auto' }}>{t('No cards yet — open a pack!')}</div>
                  )}
                </div>
              )
            })()}

          </div>
        </div>
      )}

      {/* Empty state */}
      {totalCount === 0 && !stats && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div style={{ fontSize: 48 }}>📊</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'rgba(255,255,255,0.4)' }}>{t('No sessions yet')}</div>
          <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)' }}>{t('Start a session to begin tracking your stats.')}</div>
        </div>
      )}
      </>)}
    </div>
  )
}

export function XPHistory() {
  const t = useT()
  return (
    <div className="p-5 flex flex-col items-center justify-center" style={{ minHeight: 400 }}>
      <Cpu size={72} style={{ color: 'var(--c-accent-text)', marginBottom: 28 }} />
      <div style={{ fontSize: 56, fontWeight: 900, color: '#ffffff', letterSpacing: '0.04em', textTransform: 'uppercase', opacity: 1 }}>
        {t('Coming Soon')}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#d8d8d8', marginTop: 18, textAlign: 'center', maxWidth: 400, lineHeight: 1.6, opacity: 1 }}>
        {t('Device control via Intiface Central — funscript sync, intensity patterns, and live controls.')}
      </div>
    </div>
  )
}

// ── GPU Status Panel — detects GPU, offers on-demand DLL download ─────────────
function GpuStatusPanel() {
  const qc = useQueryClient()
  const t = useT()
  const { data: gpu, isLoading } = useQuery({
    queryKey: ['gpu-status'],
    queryFn: () => scannerApi.gpuStatus().then(r => r.data),
    // Only keep polling during an active DLL download; otherwise fetch once.
    refetchInterval: (q) => {
      const d = q.state.data
      if (!d) return 2000
      if (d.phase === 'downloading' || d.phase === 'extracting') return 1500
      return false
    },
  })

  const downloadMutation = useMutation({
    mutationFn: () => scannerApi.gpuDownload(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gpu-status'] }),
    onError: (e) => toast.error(e?.response?.data?.detail || t('Download failed')),
  })

  if (isLoading || !gpu) return null

  // GPU ready
  if (gpu.cuda_available) {
    return (
      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium w-fit"
            style={{ background: 'color-mix(in srgb, var(--c-green) 15%, transparent)', color: 'var(--c-green-text)', border: '0.5px solid color-mix(in srgb, var(--c-green) 35%, transparent)' }}>
        {t('⚡ GPU ready (CUDA)')}
      </span>
    )
  }

  // Download in progress
  if (gpu.running) {
    const pct = gpu.bytes_total > 0 ? Math.round((gpu.bytes_done / gpu.bytes_total) * 100) : null
    const doneMB = Math.round(gpu.bytes_done / (1024 * 1024))
    const totalMB = Math.round(gpu.bytes_total / (1024 * 1024))
    return (
      <div className="rounded-[10px] p-3" style={{ background: 'color-mix(in srgb, var(--c-accent) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 25%, transparent)' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-medium" style={{ color: 'var(--c-accent-text)' }}>
            {t('Downloading GPU support')} ({gpu.package_index}/{gpu.package_total}) — {gpu.package}
          </span>
          <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {pct !== null ? `${pct}%` : '…'} · {doneMB} / {totalMB} MB
          </span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
          {pct !== null
            ? <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: 'var(--c-accent)' }} />
            : <div className="h-full rounded-full animate-pulse" style={{ width: '100%', background: 'color-mix(in srgb, var(--c-accent) 50%, transparent)' }} />
          }
        </div>
        {gpu.phase === 'extracting' && (
          <div className="text-[10px] mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>{t('Extracting DLLs…')}</div>
        )}
      </div>
    )
  }

  // Download finished — needs restart to take effect
  if (gpu.phase === 'done' && gpu.dlls_present && !gpu.cuda_available) {
    return (
      <div className="rounded-[10px] p-3 flex items-center justify-between"
           style={{ background: 'color-mix(in srgb, var(--c-green) 10%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-green) 30%, transparent)' }}>
        <span className="text-[11px]" style={{ color: 'var(--c-green-text)' }}>
          {t('✓ GPU DLLs downloaded — restart the backend to activate GPU')}
        </span>
      </div>
    )
  }

  // Download error
  if (gpu.phase === 'error') {
    return (
      <div className="rounded-[10px] p-3" style={{ background: 'color-mix(in srgb, var(--c-pink) 10%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-pink) 30%, transparent)' }}>
        <div className="text-[11px] mb-2" style={{ color: '#F4C0D1' }}>{t('GPU download failed:')} {gpu.error}</div>
        <button onClick={() => downloadMutation.mutate()}
                className="text-[11px] px-3 py-1 rounded-full cursor-pointer"
                style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }}>
          {t('Retry')}
        </button>
      </div>
    )
  }

  // NVIDIA GPU detected but DLLs not present — offer download
  if (gpu.has_nvidia_gpu && !gpu.dlls_present) {
    return (
      <div className="rounded-[10px] p-3" style={{ background: 'color-mix(in srgb, var(--c-accent) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 20%, transparent)' }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[12px] font-medium mb-0.5" style={{ color: 'var(--c-accent-text)' }}>{t('⚡ NVIDIA GPU detected')}</div>
            <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {t('Download GPU acceleration (~1.6 GB, one-time). Tagging will be dramatically faster.')}
            </div>
          </div>
          <button
            onClick={() => downloadMutation.mutate()}
            disabled={downloadMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium cursor-pointer flex-shrink-0"
            style={{ background: 'color-mix(in srgb, var(--c-accent) 30%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 50%, transparent)' }}>
            <Download size={11} /> {t('Download GPU support')}
          </button>
        </div>
      </div>
    )
  }

  // No NVIDIA GPU — CPU only
  return (
    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] w-fit"
          style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
      {t('🖥 CPU only — no NVIDIA GPU detected')}
    </span>
  )
}


// ── Custom root picker ────────────────────────────────────────────────────────
// Portals the list to document.body so backdrop-filter stacking contexts on
// glass/cyberpunk themes can't clip or z-bury the dropdown.
// A capture-phase scroll listener re-measures on every scroll event so the
// list stays anchored to the button even when <main> or any parent scrolls.
function RootDropdown({ roots, value, onChange }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [pos, setPos]   = React.useState(null) // plain { top, left, width }
  const btnRef  = React.useRef(null)
  const listRef = React.useRef(null)

  const measure = React.useCallback(() => {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: r.left, width: r.width })
  }, [])

  React.useEffect(() => {
    if (!open) return
    measure()
    window.addEventListener('scroll', measure, true) // capture catches all scroll containers
    window.addEventListener('resize', measure)
    const close = e => {
      if (btnRef.current?.contains(e.target)) return
      if (listRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
      document.removeEventListener('mousedown', close)
    }
  }, [open, measure])

  const selected = roots.find(r => String(r.id) === String(value))
  const label = selected
    ? (selected.label ? `${selected.label} — ${selected.path}` : selected.path)
    : t('— Select a library root —')

  const list = open && pos && ReactDOM.createPortal(
    <div
      ref={listRef}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: pos.width,
        zIndex: 9999,
        background: 'var(--c-card, #1e1e1e)',
        border: '0.5px solid rgba(255,255,255,0.14)',
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        maxHeight: 220,
        overflowY: 'auto',
      }}>
      <button
        type="button"
        onClick={() => { onChange(''); setOpen(false) }}
        className="w-full text-left px-3 py-2 text-[11px] cursor-pointer hover:bg-[rgba(255,255,255,0.07)]"
        style={{ color: 'rgba(255,255,255,0.35)' }}>
        {t('— Select a library root —')}
      </button>
      {roots.map(r => (
        <button
          key={r.id}
          type="button"
          onClick={() => { onChange(String(r.id)); setOpen(false) }}
          className="w-full text-left px-3 py-2 text-[11px] cursor-pointer hover:bg-[rgba(255,255,255,0.07)]"
          style={{ color: String(r.id) === String(value) ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.75)', background: String(r.id) === String(value) ? 'color-mix(in srgb, var(--c-accent) 12%, transparent)' : 'transparent' }}>
          {r.label ? <><span style={{ color: 'var(--c-accent-text)' }}>{r.label}</span> <span style={{ color: 'rgba(255,255,255,0.35)' }}>— {r.path}</span></> : r.path}
        </button>
      ))}
    </div>,
    document.body
  )

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => { if (open) { setOpen(false) } else { measure(); setOpen(true) } }}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-[8px] text-[12px] text-left cursor-pointer"
        style={{ background: 'rgba(255,255,255,0.06)', color: selected ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)', border: '0.5px solid rgba(255,255,255,0.12)' }}>
        <span className="truncate">{label}</span>
        <ChevronDown size={12} style={{ flexShrink: 0, color: 'rgba(255,255,255,0.3)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>
      {list}
    </div>
  )
}

// ── SettingsSection (accordion — mirrors Help.jsx Section) ───────────────────
function ChangelogBody({ text }) {
  if (!text) return null
  const lines = text.split('\n')
  const blocks = []
  let currentList = null
  for (const raw of lines) {
    const trimmed = raw.trim()
    if (!trimmed) { currentList = null; continue }
    const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/)
    if (bulletMatch) {
      if (!currentList) { currentList = []; blocks.push({ type: 'list', items: currentList }) }
      currentList.push(bulletMatch[1])
      continue
    }
    currentList = null
    if (trimmed.startsWith('>')) continue // skip "reconstructed from git history"-style meta notes
    const headingMatch = trimmed.match(/^#{2,4}\s+(.*)$/) || trimmed.match(/^([A-Za-z][A-Za-z /]{1,40}):$/)
    if (headingMatch) {
      blocks.push({ type: 'heading', text: headingMatch[1] })
      continue
    }
    blocks.push({ type: 'para', text: trimmed })
  }
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          return <div key={i} className="text-[16px] font-semibold text-white/65 mt-3 first:mt-0">{b.text}</div>
        }
        if (b.type === 'list') {
          return (
            <ul key={i} className="space-y-1.5 list-disc list-outside pl-5">
              {b.items.map((it, j) => <li key={j} className="text-[16px] text-white/45 leading-relaxed">{it}</li>)}
            </ul>
          )
        }
        return <div key={i} className="text-[16px] text-white/45 leading-relaxed">{b.text}</div>
      })}
    </div>
  )
}

function ChangelogEntry({ entry }) {
  const [open, setOpen] = React.useState(false)
  return (
    <div className="rounded-[8px] overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.06)' }}>
      <button onClick={() => setOpen(v => !v)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer">
        <span className="text-[17px] font-semibold text-white/75">v{entry.version}</span>
        {entry.date && <span className="text-[15px] text-white/30">{entry.date}</span>}
        <ChevronDown size={14} className="text-white/25 transition-transform duration-200 ml-auto"
                     style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
            <div className="px-4 pb-4" style={{ borderTop: '0.5px solid rgba(255,255,255,0.05)', paddingTop: '12px' }}>
              <ChangelogBody text={entry.changelog} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function SettingsSection({ title, icon: Icon, accentColor = 'var(--c-accent)', children, defaultOpen = true }) {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <div className="mb-3 rounded-[10px] overflow-hidden"
         style={{ background: 'var(--c-card)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
      <button onClick={() => setOpen(v => !v)}
              className="w-full flex items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-[rgba(255,255,255,0.03)]"
              style={{ background: 'transparent' }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
             style={{ background: `${accentColor}20` }}>
          <Icon size={15} style={{ color: accentColor }} />
        </div>
        <span className="flex-1 text-[19px] font-semibold text-white/85">{title}</span>
        <ChevronDown size={16} className="text-white/25 transition-transform duration-200"
                     style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
            <div className="px-5 pb-5 pt-4"
                 style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const SETTINGS_TABS = [
  { id: 'library',    label: 'Library',    icon: FolderOpen     },
  { id: 'scanner',    label: 'Scanner',    icon: ScanLine       },
  { id: 'tagging',    label: 'AI Tagging', icon: Cpu            },
  { id: 'appearance', label: 'Appearance', icon: Sparkles       },
  { id: 'session',    label: 'Session',    icon: Droplets       },
  { id: 'hotkeys',    label: 'Hotkeys',    icon: Keyboard       },
  { id: 'backup',     label: 'Backup',     icon: Archive        },
  { id: 'system',     label: 'System',     icon: ShieldCheck    },
]

export function Settings() {
  const showGoonBorder    = useVaultStore(s => s.showGoonBorder)
  const setShowGoonBorder = useVaultStore(s => s.setShowGoonBorder)
  const sessionEndClimax    = useVaultStore(s => s.sessionEndClimax)
  const setSessionEndClimax = useVaultStore(s => s.setSessionEndClimax)
  const currentPalette    = useVaultStore(s => s.palette)
  const setPalette        = useVaultStore(s => s.setPalette)
  const currentFont         = useVaultStore(s => s.font)
  const setFont             = useVaultStore(s => s.setFont)
  const animSpeed           = useVaultStore(s => s.animSpeed)
  const setAnimSpeed        = useVaultStore(s => s.setAnimSpeed)
  const vaultName           = useVaultStore(s => s.vaultName)
  const setVaultName        = useVaultStore(s => s.setVaultName)
  const confettiEnabled     = useVaultStore(s => s.confettiEnabled)
  const setConfettiEnabled  = useVaultStore(s => s.setConfettiEnabled)
  const sessionGlowColor    = useVaultStore(s => s.sessionGlowColor)
  const setSessionGlowColor = useVaultStore(s => s.setSessionGlowColor)
  const glassBackground     = useVaultStore(s => s.glassBackground)
  const setGlassBackground  = useVaultStore(s => s.setGlassBackground)
  const locale              = useVaultStore(s => s.locale)
  const setLocale           = useVaultStore(s => s.setLocale)
  const t                   = useT()
  const [vaultNameInput, setVaultNameInput] = React.useState(vaultName)
  const [glassBgLabel, setGlassBgLabel]     = React.useState(localStorage.getItem('vault_glass_bg_label') || '')
  const glassBgFileRef = React.useRef(null)
  const [newPath, setNewPath]               = React.useState('')
  const [newLabel, setNewLabel]             = React.useState('')
  const [showAllRoots, setShowAllRoots]     = React.useState(false)
  const [browsing, setBrowsing]             = React.useState(false)
  const [selectedRootId, setSelectedRootId] = React.useState('')
  const [folderScanning, setFolderScanning] = React.useState(false)
  const [regenning, setRegenning]           = React.useState(false)
  const [fsLibPath, setFsLibPath]           = React.useState('')
  const [fsLibDirty, setFsLibDirty]         = React.useState(false)
  const [fsMatching, setFsMatching]         = React.useState(false)
  const [syncing, setSyncing]               = React.useState(false)
  const [restartState, setRestartState]     = React.useState('idle') // idle | restarting | done
  const [updateState, setUpdateState]       = React.useState('idle') // idle | checking | up_to_date | available | downloading | installing | error
  const [updateInfo, setUpdateInfo]         = React.useState(null)
  const [updateProgress, setUpdateProgress] = React.useState(0)
  const [updateError, setUpdateError]       = React.useState('')
  const updatePollRef = React.useRef(null)
  // AI Tagging
  const [tagScope, setTagScope]             = React.useState('library')  // 'library' | 'folder' | 'creator'
  const [tagRootId, setTagRootId]           = React.useState('')
  const [tagCreatorId, setTagCreatorId]     = React.useState('')
  const [tagCreatorSearch, setTagCreatorSearch] = React.useState('')
  const [tagThreshold, setTagThreshold]     = React.useState(0.35)
  const [tagRetag, setTagRetag]             = React.useState(false)
  const [tagStarting, setTagStarting]       = React.useState(false)
  const [tagModelOverride, setTagModelOverride] = React.useState('auto') // 'auto'|'wd14'|'joytag'
  const tagRunStartRef = React.useRef(null)   // { ts, progress } — for ETA calculation
  const tagEtaRef      = React.useRef(null)   // cached ETA string
  const [restoreFile, setRestoreFile]       = React.useState(null)   // File | null
  const [restoreState, setRestoreState]     = React.useState('idle') // idle | confirming | uploading | restarting | done
  const [showResetModal, setShowResetModal] = React.useState(false)
  const [resetState, setResetState]         = React.useState('idle') // idle | resetting | done
  const restoreInputRef                     = React.useRef(null)
  const [storageInput, setStorageInput]     = React.useState('')
  const [storageState, setStorageState]     = React.useState('idle') // idle | saving | saved
  const qc = useQueryClient()
  const [settingsTab, setSettingsTab] = React.useState('library')

  const { data: compConfig, refetch: refetchComp } = useQuery({
    queryKey: ['companion-config'],
    queryFn:  () => companionApi.getConfig().then(r => r?.data ?? null),
  })
  const toggleCompanion = async () => {
    await companionApi.updateConfig({ enabled: !compConfig?.enabled })
    refetchComp()
  }

  const restorePollRef = React.useRef(null)
  const resetPollRef   = React.useRef(null)
  const restartPollRef = React.useRef(null)

  React.useEffect(() => {
    return () => {
      if (restorePollRef.current) clearInterval(restorePollRef.current)
      if (resetPollRef.current) clearInterval(resetPollRef.current)
      if (restartPollRef.current) clearInterval(restartPollRef.current)
      if (updatePollRef.current) clearInterval(updatePollRef.current)
    }
  }, [])

  const { data: configData } = useQuery({
    queryKey: ['system-config'],
    queryFn:  () => systemApi.getConfig().then(r => r.data),
  })

  // React Query v5 removed the useQuery `onSuccess` callback, so the inputs were
  // never populated from the loaded config — that's why the funscript-library
  // folder (and the storage path) appeared to clear on every reload even though
  // the value was saved. Populate them here instead.
  React.useEffect(() => {
    if (!configData) return
    if (!storageInput) setStorageInput(configData.data_dir || configData.effective_data_dir || '')
    if (!fsLibDirty) setFsLibPath(configData.funscript_library_path || '')
  }, [configData]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: mobileLink } = useQuery({
    queryKey: ['mobile-link'],
    queryFn:  () => systemApi.mobileLink().then(r => r.data),
    enabled:  settingsTab === 'system',
  })

  const gpuMutation = useMutation({
    mutationFn: (use_gpu) => systemApi.setGpuMode(use_gpu).then(r => r.data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['system-config'] }),
  })

  const { data: startupData } = useQuery({
    queryKey: ['system-startup'],
    queryFn:  () => systemApi.getStartup().then(r => r.data),
  })

  const { data: versionData } = useQuery({
    queryKey: ['system-version'],
    queryFn:  () => systemApi.getVersion().then(r => r.data),
  })

  const { data: changelogData } = useQuery({
    queryKey: ['system-changelog'],
    queryFn:  () => systemApi.getChangelog(10).then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })
  const startupMutation = useMutation({
    mutationFn: (enabled) => systemApi.setStartup(enabled).then(r => r.data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['system-startup'] }),
    onError:    (e) => toast.error(e?.response?.data?.detail || t('Failed to update startup setting')),
  })

  // Populate input once config loads
  React.useEffect(() => {
    if (configData && !storageInput) setStorageInput(configData.data_dir || configData.effective_data_dir)
  }, [configData])

  const handleStorageSave = async () => {
    if (!storageInput.trim()) return
    setStorageState('saving')
    try {
      await systemApi.setConfig(storageInput.trim())
      setStorageState('saved')
      qc.invalidateQueries(['system-config'])
      // Auto-restart so the new path takes effect immediately
      await systemApi.restart()
    } catch (err) {
      const msg = err?.response?.data?.detail || t('Failed to save storage path.')
      toast.error(msg)
      setStorageState('idle')
    }
  }

  const handleRestoreFileChange = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setRestoreFile(f)
    setRestoreState('confirming')
    e.target.value = ''  // allow re-selecting same file
  }

  const confirmRestore = async () => {
    if (!restoreFile) return
    setRestoreState('uploading')
    try {
      await systemApi.restore(restoreFile)
    } catch (err) {
      const msg = err?.response?.data?.detail || t('Restore failed — file may be invalid.')
      toast.error(msg)
      setRestoreState('idle')
      setRestoreFile(null)
      return
    }
    setRestoreState('restarting')
    setRestoreFile(null)
    // Poll until back online
    if (restorePollRef.current) clearInterval(restorePollRef.current)
    restorePollRef.current = setInterval(async () => {
      try {
        await systemApi.health()
        if (restorePollRef.current) {
          clearInterval(restorePollRef.current)
          restorePollRef.current = null
        }
        setRestoreState('done')
        setTimeout(() => setRestoreState('idle'), 4000)
      } catch { /* still restarting */ }
    }, 800)
    setTimeout(() => {
      if (restorePollRef.current) {
        clearInterval(restorePollRef.current)
        restorePollRef.current = null
      }
      setRestoreState('idle')
    }, 25000)
  }

  const handleReset = async () => {
    setResetState('resetting')
    try {
      await systemApi.reset()
    } catch { /* server dies — expected */ }
    if (resetPollRef.current) clearInterval(resetPollRef.current)
    resetPollRef.current = setInterval(async () => {
      try {
        await systemApi.health()
        if (resetPollRef.current) {
          clearInterval(resetPollRef.current)
          resetPollRef.current = null
        }
        setResetState('done')
        setShowResetModal(false)
        qc.clear()
        setTimeout(() => setResetState('idle'), 3000)
      } catch { /* still restarting */ }
    }, 800)
    setTimeout(() => {
      if (resetPollRef.current) {
        clearInterval(resetPollRef.current)
        resetPollRef.current = null
      }
      setResetState('idle')
    }, 30000)
  }

  const handleSyncFolders = async () => {
    setSyncing(true)
    try {
      const res = await creatorsApi.syncSourceFolders()
      const { synced_creators, newly_assigned } = res.data
      if (newly_assigned > 0) {
        toast.success(`Synced ${synced_creators} creator${synced_creators !== 1 ? 's' : ''} — ${newly_assigned} new gallery assignment${newly_assigned !== 1 ? 's' : ''}`)
      } else {
        toast.success(`All up to date — ${synced_creators} creator folder${synced_creators !== 1 ? 's' : ''} checked, nothing new to assign`)
      }
    } catch {
      toast.error(t('Sync failed'))
    } finally {
      setSyncing(false)
    }
  }

  const handleCheckUpdate = async () => {
    setUpdateState('checking')
    setUpdateInfo(null)
    setUpdateError('')
    try {
      const r = await systemApi.checkUpdate()
      if (r.data.update_available) {
        setUpdateInfo(r.data)
        setUpdateState('available')
      } else {
        setUpdateState('up_to_date')
      }
    } catch (e) {
      setUpdateError(e?.response?.data?.detail || t('Could not reach update server.'))
      setUpdateState('error')
    }
  }

  const handleInstallUpdate = async () => {
    if (!updateInfo?.download_url) return
    setUpdateState('downloading')
    setUpdateProgress(0)
    try {
      await systemApi.installUpdate(updateInfo.download_url)
      if (updatePollRef.current) clearInterval(updatePollRef.current)
      updatePollRef.current = setInterval(async () => {
        try {
          const r = await systemApi.updateStatus()
          const s = r.data
          if (s.status === 'downloading') setUpdateProgress(s.progress || 0)
          if (s.status === 'installing') { setUpdateState('installing'); setUpdateProgress(100) }
          if (s.status === 'error') {
            setUpdateError(s.error || t('Installation failed.'))
            setUpdateState('error')
            clearInterval(updatePollRef.current)
            updatePollRef.current = null
          }
        } catch {}
      }, 500)
    } catch (e) {
      setUpdateError(e?.response?.data?.detail || t('Update failed.'))
      setUpdateState('error')
    }
  }

  const handleRestart = async () => {
    setRestartState('restarting')
    try {
      await systemApi.restart()
    } catch { /* server died mid-response — that's expected */ }
    // Poll until the server is back — use native fetch with a 1.5s abort so the
    // poll fires fast enough that the 25s safety timer can actually clear it.
    if (restartPollRef.current) clearInterval(restartPollRef.current)
    restartPollRef.current = setInterval(async () => {
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 1500)
        await fetch('/api/system/health', { signal: ctrl.signal })
        clearTimeout(t)
        if (restartPollRef.current) {
          clearInterval(restartPollRef.current)
          restartPollRef.current = null
        }
        setRestartState('done')
        setTimeout(() => setRestartState('idle'), 3000)
      } catch { /* still restarting */ }
    }, 800)
    // Safety timeout — give up after 25s
    setTimeout(() => {
      if (restartPollRef.current) {
        clearInterval(restartPollRef.current)
        restartPollRef.current = null
      }
      setRestartState('idle')
    }, 25000)
  }

  const { data: roots } = useQuery({
    queryKey: ['library-roots'],
    queryFn: () => fetch('/api/scanner/roots').then(r => r.json()),
  })

  const { data: scanStatus } = useQuery({
    queryKey: ['scan-status'],
    queryFn: () => fetch('/api/scanner/status').then(r => r.json()),
    refetchInterval: (query) => query.state.data?.running ? 2000 : false,
  })

  const { data: taskQueueState } = useQuery({
    queryKey: ['task-queue'],
    queryFn: () => tasksApi.queue().then(r => r.data),
    refetchInterval: q => {
      const d = q.state.data
      return (d?.current || d?.queued?.length > 0) ? 800 : 8000
    },
  })
  const aiTaskQueued = taskQueueState?.queued?.some(t => t.type === 'ai_tag' || t.type === 'model_download')
  const aiTaskRunning = taskQueueState?.current?.type === 'ai_tag' || taskQueueState?.current?.type === 'model_download'

  const { data: tagStatus } = useQuery({
    queryKey: ['ai-tag-status'],
    queryFn: () => taggerApi.status().then(r => r.data),
    refetchInterval: (query) => (query.state.data?.running || aiTaskQueued) ? 1500 : 8000,
  })

  const { data: tagModels, refetch: refetchTagModels } = useQuery({
    queryKey: ['ai-tag-models'],
    queryFn: () => taggerApi.modelStatus().then(r => r.data),
    refetchInterval: tagStatus?.running ? 3000 : false,
  })

  // Reset ETA tracking when a tagging run finishes
  React.useEffect(() => {
    if (!tagStatus?.running) {
      tagRunStartRef.current = null
      tagEtaRef.current      = null
    }
  }, [tagStatus?.running])

  const { data: allCreators } = useQuery({
    queryKey: ['creators-list-tagger'],
    queryFn: () => creatorsApi.list({ limit: 1000, sort_by: 'name' }).then(r => r.data),
    staleTime: 60000,
  })

  const filteredTagCreators = React.useMemo(() => {
    if (!allCreators) return []
    const q = tagCreatorSearch.toLowerCase().trim()
    if (!q) return allCreators.slice(0, 50)
    return allCreators.filter(c => c.name.toLowerCase().includes(q)).slice(0, 50)
  }, [allCreators, tagCreatorSearch])

  const startTagging = async () => {
    const tagFolderPath = (roots ?? []).find(r => String(r.id) === String(tagRootId))?.path ?? null
    if (tagScope === 'folder' && !tagFolderPath) {
      toast.error(t('Select a library folder to tag'))
      return
    }
    if (tagScope === 'creator' && !tagCreatorId) {
      toast.error(t('Select a creator to tag'))
      return
    }
    setTagStarting(true)
    try {
      await taggerApi.start({
        scope: tagScope,
        folder_path: tagScope === 'folder' ? tagFolderPath : null,
        creator_id: tagScope === 'creator' ? parseInt(tagCreatorId, 10) : null,
        threshold: tagThreshold,
        retag: tagRetag,
        model_override: tagModelOverride === 'auto' ? null : tagModelOverride,
      })
      qc.invalidateQueries({ queryKey: ['ai-tag-status'] })
      qc.invalidateQueries({ queryKey: ['task-queue'] })
    } catch (err) {
      toast.error(err?.response?.data?.detail || t('Failed to start tagging'))
    } finally {
      setTagStarting(false)
    }
  }

  const downloadModel = async (model) => {
    try {
      await taggerApi.downloadModels({ [model]: true })
      toast.success(`Downloading ${model === 'wd14' ? 'WD14' : 'JoyTag'}…`)
      refetchTagModels()
    } catch (err) {
      toast.error(err?.response?.data?.detail || t('Download failed'))
    }
  }

  const addRoot = async () => {
    if (!newPath.trim()) return
    try {
      await fetch('/api/scanner/roots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath.trim(), label: newLabel.trim() || null }),
      })
      setNewPath('')
      setNewLabel('')
      qc.invalidateQueries({ queryKey: ['library-roots'] })
      toast.success(t('Library folder added!'))
    } catch (err) {
      toast.error(t('Failed to add folder'))
    }
  }

  const browseForFolder = async () => {
    try {
      const res = await scannerApi.browseFolder()
      if (res.data?.path) setNewPath(res.data.path)
    } catch (err) {
      toast.error(t('Could not open folder picker'))
    }
  }

  const startScan = async () => {
    try {
      const res = await fetch('/api/scanner/scan', { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.detail || t('Failed to start scan'))
        return
      }
      qc.invalidateQueries({ queryKey: ['scan-status'] })
      qc.invalidateQueries({ queryKey: ['task-queue'] })
      toast.success(t('Scan queued!'))
    } catch (err) {
      toast.error(t('Failed to start scan'))
    }
  }

  const startFolderScan = async () => {
    if (!selectedRootId) return
    const root = (roots ?? []).find(r => String(r.id) === String(selectedRootId))
    if (!root) return
    setFolderScanning(true)
    try {
      await fetch(`/api/scanner/scan?root_id=${root.id}`, { method: 'POST' })
      toast.success(`Scan queued: "${root.label || root.path}"`)
      qc.invalidateQueries({ queryKey: ['scan-status'] })
      qc.invalidateQueries({ queryKey: ['task-queue'] })
    } catch (err) {
      toast.error(err?.response?.data?.detail || t('Failed to start scan'))
    } finally {
      setFolderScanning(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-8 pt-8 pb-5"
           style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)', background: 'var(--c-surface)' }}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
               style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 35%, transparent)' }}>
            <SlidersHorizontal size={18} style={{ color: 'var(--c-accent)' }} />
          </div>
          <div>
            <h1 className="text-[27px] font-bold text-white/90">{t('Settings')}</h1>
            <p className="text-[18px] text-white/40">{t('Configure your Vault experience.')}</p>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {SETTINGS_TABS.map(({ id, label, icon: Icon }) => {
            const active = settingsTab === id
            return (
              <button key={id} onClick={() => setSettingsTab(id)}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-[17px] font-medium whitespace-nowrap transition-all flex-shrink-0"
                      style={active
                        ? { background: 'color-mix(in srgb, var(--c-accent) 18%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }
                        : { background: 'transparent', color: 'rgba(255,255,255,0.45)', border: '0.5px solid transparent' }
                      }>
                <Icon size={14} />
                {t(label)}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Tab content ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={settingsTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="px-8 py-6 max-w-4xl"
          >

            {/* ── Library tab ──────────────────────────── */}
            {settingsTab === 'library' && (
              <div className="space-y-3">
                <SettingsSection title={t('Library folders')} icon={FolderOpen} accentColor="var(--c-amber)">
                  <p className="text-[16px] text-white/45 mb-4">
                    {t('Add folders to scan. Each subfolder becomes a gallery.')}
                  </p>
                  {(() => {
                    const allRoots = roots ?? []
                    const COLLAPSE_AT = 5
                    const visible = (!showAllRoots && allRoots.length > COLLAPSE_AT) ? allRoots.slice(0, COLLAPSE_AT) : allRoots
                    const hidden = allRoots.length - COLLAPSE_AT
                    return (
                      <>
                        {allRoots.length === 0 && (
                          <div className="text-[16px] text-white/25 py-2">{t('No library folders added yet.')}</div>
                        )}
                        {visible.map(r => (
                          <div key={r.id} className="flex items-center gap-3 py-2.5 border-b border-[rgba(255,255,255,0.06)]">
                            <div className="flex-1 min-w-0">
                              <div className="text-[16px] text-white/75 truncate">{r.path}</div>
                              {r.label && <div className="text-[14px] text-white/35">{r.label}</div>}
                            </div>
                            {r.last_scan && (
                              <div className="text-[13px] text-white/30 shrink-0">
                                {t('scanned')} {new Date(r.last_scan).toLocaleDateString()}
                              </div>
                            )}
                            <button onClick={async () => {
                              await fetch(`/api/scanner/roots/${r.id}`, { method: 'DELETE' })
                              qc.invalidateQueries({ queryKey: ['library-roots'] })
                            }} className="text-[13px] px-2.5 py-1 rounded cursor-pointer shrink-0"
                                    style={{ color: 'color-mix(in srgb, var(--c-pink) 70%, transparent)', background: 'color-mix(in srgb, var(--c-pink) 10%, transparent)' }}>
                              {t('Remove')}
                            </button>
                          </div>
                        ))}
                        {allRoots.length > COLLAPSE_AT && (
                          <button onClick={() => setShowAllRoots(v => !v)}
                                  className="mt-1 text-[14px] cursor-pointer"
                                  style={{ color: 'color-mix(in srgb, var(--c-accent) 70%, transparent)' }}>
                            {showAllRoots ? t('▲ Show less') : `▼ Show ${hidden} more folder${hidden !== 1 ? 's' : ''}…`}
                          </button>
                        )}
                      </>
                    )
                  })()}
                  <div className="flex flex-col gap-2 mt-5">
                    <div className="flex gap-2">
                      <input value={newPath} onChange={e => setNewPath(e.target.value)}
                             placeholder="C:\Users\You\Pictures\Collection"
                             className="flex-1 bg-transparent rounded-[8px] px-3 py-2 text-[16px] text-white/80 placeholder-[rgba(255,255,255,0.2)]"
                             style={{ border: '0.5px solid rgba(255,255,255,0.12)' }}
                             onKeyDown={e => e.key === 'Enter' && addRoot()} />
                      <button onClick={browseForFolder}
                              className="px-3 py-2 rounded-[8px] text-[16px] cursor-pointer whitespace-nowrap"
                              style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.65)', border: '0.5px solid rgba(255,255,255,0.12)' }}>
                        {t('📁 Browse')}
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                             placeholder={t('Label (optional — e.g. Cosplayers)')}
                             className="flex-1 bg-transparent rounded-[8px] px-3 py-2 text-[16px] text-white/80 placeholder-[rgba(255,255,255,0.2)]"
                             style={{ border: '0.5px solid rgba(255,255,255,0.12)' }}
                             onKeyDown={e => e.key === 'Enter' && addRoot()} />
                      <button onClick={addRoot} disabled={!newPath.trim()}
                              className="px-4 py-2 rounded-[8px] text-[16px] cursor-pointer disabled:opacity-40"
                              style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
                        {t('Add')}
                      </button>
                    </div>
                  </div>
                </SettingsSection>

                <SettingsSection title={t('Creator folder sync')} icon={RefreshCw} accentColor="var(--c-accent)" defaultOpen={false}>
                  <p className="text-[16px] text-white/45 mb-4">
                    {t("Re-checks every creator's source folder and assigns any galleries added since it was last set. Also runs automatically on each scan — use this if you assigned a source folder after importing.")}
                  </p>
                  <button onClick={handleSyncFolders} disabled={syncing}
                          className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-[16px] font-medium cursor-pointer disabled:opacity-50"
                          style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }}>
                    <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                    {syncing ? t('Syncing…') : t('Sync now')}
                  </button>
                </SettingsSection>
              </div>
            )}

            {/* ── Scanner tab ──────────────────────────── */}
            {settingsTab === 'scanner' && (
              <div className="space-y-3">
                <SettingsSection title={t('Library scan')} icon={ScanLine} accentColor="var(--c-green)">
                  {scanStatus?.running ? (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-[16px] text-white/60">{scanStatus.message}</div>
                        <button onClick={async () => { await scannerApi.cancel(); qc.invalidateQueries({ queryKey: ['scan-status'] }) }}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[14px] cursor-pointer ml-2 flex-shrink-0"
                                style={{ background: 'color-mix(in srgb, var(--c-pink) 15%, transparent)', color: '#F4C0D1', border: '0.5px solid color-mix(in srgb, var(--c-pink) 30%, transparent)' }}>
                          <X size={10} /> {t('Cancel')}
                        </button>
                      </div>
                      <div className="h-1.5 rounded-full bg-[rgba(255,255,255,0.07)] overflow-hidden">
                        <div className="h-full rounded-full bg-[var(--c-accent)] transition-all"
                             style={{ width: `${scanStatus.total ? (scanStatus.progress / scanStatus.total) * 100 : 0}%` }} />
                      </div>
                      <div className="text-[14px] text-white/30 mt-1">
                        {scanStatus.progress} / {scanStatus.total} {t('folders')} · {scanStatus.new_galleries} {t('new galleries')} · {scanStatus.new_images} {t('new images')}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-5">
                      {scanStatus?.message && scanStatus.message !== 'Idle' && (
                        <div className="text-[16px] text-white/45">{scanStatus.message}</div>
                      )}
                      <div>
                        <div className="text-[17px] font-semibold text-white/70 mb-1">{t('Full library scan')}</div>
                        <p className="text-[15px] text-white/40 mb-3">{t('Walks every library folder, creates Gallery records, generates thumbnails, detects funscripts.')}</p>
                        <button onClick={startScan}
                                className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-[16px] cursor-pointer w-fit"
                                style={{ background: 'color-mix(in srgb, var(--c-green) 20%, transparent)', color: 'var(--c-green-text)', border: '0.5px solid color-mix(in srgb, var(--c-green) 30%, transparent)' }}>
                          {t('Scan entire library')}
                        </button>
                      </div>
                      <div className="pt-4" style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
                        <div className="text-[17px] font-semibold text-white/70 mb-1">{t('Rescan a single folder')}</div>
                        {(roots ?? []).length === 0 ? (
                          <div className="text-[16px] text-white/25">{t('No library folders added yet.')}</div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <RootDropdown roots={roots ?? []} value={selectedRootId} onChange={setSelectedRootId} />
                            <button onClick={startFolderScan} disabled={!selectedRootId || folderScanning}
                                    className="px-4 py-2 rounded-[8px] text-[16px] cursor-pointer disabled:opacity-40 w-fit"
                                    style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
                              {folderScanning ? t('Starting…') : t('Scan selected root')}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </SettingsSection>

                <SettingsSection title={t('Thumbnails')} icon={RefreshCw} accentColor="var(--c-amber)" defaultOpen={false}>
                  <p className="text-[16px] text-white/45 mb-4">
                    {t('Purge deletes existing thumbnails; regenerate rebuilds any that are missing. To fully rebuild a type, purge it first, then regenerate. Everything runs in the background.')}
                  </p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {[
                      { label: '🗑️ Purge image thumbnails', fn: () => scannerApi.purgeThumbs('images'), danger: true },
                      { label: '🗑️ Purge video thumbnails', fn: () => scannerApi.purgeThumbs('videos'), danger: true },
                    ].map(b => (
                      <button key={b.label} disabled={regenning}
                              onClick={async () => {
                                setRegenning(true)
                                try { await b.fn(); toast.success(t('Purge started!')) }
                                catch { toast.error(t('Failed to start')) }
                                finally { setTimeout(() => setRegenning(false), 3000) }
                              }}
                              className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-[16px] cursor-pointer w-fit disabled:opacity-40"
                              style={{ background: 'color-mix(in srgb, var(--c-pink) 15%, transparent)', color: 'var(--c-pink-text)', border: '0.5px solid color-mix(in srgb, var(--c-pink) 30%, transparent)' }}>
                        {t(b.label)}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: '🖼️ Regenerate image thumbnails', fn: () => scannerApi.regenThumbs('images') },
                      { label: '🎬 Regenerate video thumbnails', fn: () => scannerApi.regenThumbs('videos') },
                    ].map(b => (
                      <button key={b.label} disabled={regenning}
                              onClick={async () => {
                                setRegenning(true)
                                try { await b.fn(); toast.success(t('Regeneration started!')) }
                                catch { toast.error(t('Failed to start')) }
                                finally { setTimeout(() => setRegenning(false), 3000) }
                              }}
                              className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-[16px] cursor-pointer w-fit disabled:opacity-40"
                              style={{ background: 'color-mix(in srgb, var(--c-amber) 20%, transparent)', color: 'var(--c-amber-text)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 30%, transparent)' }}>
                        {t(b.label)}
                      </button>
                    ))}
                  </div>
                  {/* Video length backfill — videos imported before the duration
                      probe existed have no length on record, and a normal
                      rescan won't fix it because known files are skipped. */}
                  <div className="mt-4 pt-4" style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
                    <div className="text-[16px] text-white/75 mb-1">{t('Read video lengths')}</div>
                    <div className="text-[14px] text-white/30 mb-3">
                      {t('Fills in the length of videos imported before The Vault started reading it. A normal rescan skips them. Safe to cancel and resume.')}
                    </div>
                    <button disabled={regenning}
                            onClick={async () => {
                              setRegenning(true)
                              try {
                                const { data } = await scannerApi.backfillDurations()
                                toast.success(data.queued
                                  ? `${t('Queued')} — ${data.missing} ${t('videos')}`
                                  : t('Every video already has a length'))
                              }
                              catch { toast.error(t('Failed to start')) }
                              finally { setTimeout(() => setRegenning(false), 3000) }
                            }}
                            className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-[16px] cursor-pointer w-fit disabled:opacity-40"
                            style={{ background: 'color-mix(in srgb, var(--c-accent) 18%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 35%, transparent)' }}>
                      {t('⏱️ Read video lengths')}
                    </button>
                  </div>
                </SettingsSection>

                <SettingsSection title={t('Funscript library')} icon={ScanLine} accentColor="var(--c-pink)" defaultOpen={false}>
                  <p className="text-[16px] text-white/45 mb-4">
                    {t('Keep all your .funscript files in one folder. The Vault matches each script to a video with the same filename anywhere in your library — handy when scripts and videos live in different folders.')}
                  </p>
                  <div className="flex gap-2 mb-3">
                    <input value={fsLibPath}
                           onChange={e => { setFsLibPath(e.target.value); setFsLibDirty(true) }}
                           placeholder={t('Path to your funscript folder')}
                           className="flex-1 px-3 py-2 rounded-[8px] text-[16px] bg-white/5 text-white/80 outline-none"
                           style={{ border: '0.5px solid rgba(255,255,255,0.1)' }} />
                    <button onClick={async () => {
                              try {
                                const res = await scannerApi.browseFolder()
                                if (res.data?.path) { setFsLibPath(res.data.path); setFsLibDirty(true) }
                              } catch { toast.error(t('Could not open folder picker')) }
                            }}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-[16px] cursor-pointer flex-shrink-0"
                            style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                      <FolderOpen size={15} /> {t('Browse')}
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={async () => {
                              try {
                                await systemApi.setFunscriptLibrary(fsLibPath.trim())
                                setFsLibDirty(false)
                                qc.invalidateQueries({ queryKey: ['system-config'] })
                                toast.success(t('Funscript folder saved!'))
                              } catch (err) { toast.error(err?.response?.data?.detail || t('Failed to save folder')) }
                            }}
                            className="px-4 py-2 rounded-[8px] text-[16px] cursor-pointer w-fit"
                            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)', border: '0.5px solid rgba(255,255,255,0.12)' }}>
                      {t('Save folder')}
                    </button>
                    <button disabled={fsMatching || !fsLibPath.trim()}
                            onClick={async () => {
                              setFsMatching(true)
                              try {
                                await scannerApi.matchFunscripts(fsLibPath.trim())
                                qc.invalidateQueries({ queryKey: ['scan-status'] })
                                qc.invalidateQueries({ queryKey: ['task-queue'] })
                                toast.success(t('Funscript matching started!'))
                              } catch (err) { toast.error(err?.response?.data?.detail || t('Failed to start matching')) }
                              finally { setTimeout(() => setFsMatching(false), 3000) }
                            }}
                            className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-[16px] cursor-pointer w-fit disabled:opacity-40"
                            style={{ background: 'color-mix(in srgb, var(--c-pink) 20%, transparent)', color: '#F4C0D1', border: '0.5px solid color-mix(in srgb, var(--c-pink) 30%, transparent)' }}>
                      {fsMatching ? t('Starting…') : t('🔗 Match funscripts now')}
                    </button>
                  </div>
                </SettingsSection>
              </div>
            )}

            {/* ── AI Tagging tab ───────────────────────── */}
            {settingsTab === 'tagging' && (
              <div className="space-y-3">
                <SettingsSection title={t('AI models')} icon={Download} accentColor="var(--c-accent)">
                  <p className="text-[16px] text-white/45 mb-4">
                    {t('WD14 for anime/art, JoyTag for cosplay and real photos. Both are local ONNX models — nothing sent to the cloud.')}
                  </p>
                  <div className="mb-4"><GpuStatusPanel /></div>
                  <div className="flex flex-col gap-2">
                    {[
                      { key: 'wd14',   label: 'WD14 v3', desc: 'Anime / art / characters (~200 MB)',       ready: tagModels?.wd14_downloaded,   size: tagModels?.wd14_size_mb },
                      { key: 'joytag', label: 'JoyTag',  desc: 'Cosplay / real photos / ethots (~366 MB)', ready: tagModels?.joytag_downloaded, size: tagModels?.joytag_size_mb },
                    ].map(({ key, label, desc, ready, size }) => (
                      <div key={key} className="flex items-center justify-between py-3 px-4 rounded-[8px]"
                           style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full flex-shrink-0"
                               style={{ background: ready ? 'var(--c-green)' : 'rgba(255,255,255,0.2)' }} />
                          <div>
                            <div className="text-[16px] font-medium text-white/80">{t(label)}</div>
                            <div className="text-[14px] text-white/35">{ready ? `Downloaded · ${size ?? '?'} MB` : t(desc)}</div>
                          </div>
                        </div>
                        {!ready && (
                          <button disabled={tagStatus?.running} onClick={() => downloadModel(key)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-[14px] cursor-pointer disabled:opacity-40"
                                  style={{ background: 'color-mix(in srgb, var(--c-accent) 15%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
                            <Download size={12} /> {t('Download')}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </SettingsSection>

                <SettingsSection title={t('Run tagging')} icon={Cpu} accentColor="var(--c-accent)">
                  {tagStatus?.running ? (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                          {tagStatus.active_model && (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[13px] font-medium flex-shrink-0"
                                  style={{ background: tagStatus.active_model === 'WD14' ? 'rgba(55,138,221,0.2)' : 'color-mix(in srgb, var(--c-pink) 20%, transparent)',
                                           color:      tagStatus.active_model === 'WD14' ? '#7AB8F5' : '#F4C0D1' }}>
                              <Cpu size={9} /> {tagStatus.active_model}
                            </span>
                          )}
                          {tagStatus.device && (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[13px] font-medium flex-shrink-0"
                                  style={{ background: tagStatus.device === 'gpu' ? 'color-mix(in srgb, var(--c-green) 20%, transparent)' : 'rgba(255,255,255,0.07)',
                                           color:      tagStatus.device === 'gpu' ? 'var(--c-green-text)' : 'rgba(255,255,255,0.4)' }}>
                              {tagStatus.device === 'gpu' ? t('⚡ GPU') : t('🖥 CPU')}
                            </span>
                          )}
                          {tagStatus.total === 0 ? (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[13px] font-medium flex-shrink-0"
                                  style={{ background: 'color-mix(in srgb, var(--c-amber) 18%, transparent)', color: 'var(--c-amber-text)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 35%, transparent)' }}>
                              {t('⬇ Downloading model')}
                            </span>
                          ) : (
                            <span className="text-[14px] text-white/55 flex-shrink-0">{tagStatus.progress} / {tagStatus.total}</span>
                          )}
                        </div>
                        <button onClick={async () => { await taggerApi.cancel(); tagRunStartRef.current = null; qc.invalidateQueries({ queryKey: ['ai-tag-status'] }) }}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[13px] cursor-pointer ml-2 flex-shrink-0"
                                style={{ background: 'color-mix(in srgb, var(--c-pink) 15%, transparent)', color: '#F4C0D1', border: '0.5px solid color-mix(in srgb, var(--c-pink) 30%, transparent)' }}>
                          <X size={10} /> {t('Cancel')}
                        </button>
                      </div>
                      <div className="h-1.5 rounded-full bg-[rgba(255,255,255,0.07)] overflow-hidden">
                        {tagStatus.total > 0 ? (() => {
                          if (!tagRunStartRef.current && tagStatus.progress > 0)
                            tagRunStartRef.current = { ts: Date.now(), progress: tagStatus.progress }
                          return <div className="h-full rounded-full transition-all" style={{ width: `${(tagStatus.progress / tagStatus.total) * 100}%`, background: 'var(--c-accent)' }} />
                        })() : (
                          <div className="h-full rounded-full"
                               style={{ width: '100%', background: 'linear-gradient(90deg,color-mix(in srgb, var(--c-amber) 25%, transparent) 0%,color-mix(in srgb, var(--c-amber) 60%, transparent) 50%,color-mix(in srgb, var(--c-amber) 25%, transparent) 100%)', animation: 'pulse 1.5s ease-in-out infinite' }} />
                        )}
                      </div>
                      {tagStatus.total > 0 ? (() => {
                        let etaStr = ''
                        if (tagRunStartRef.current && tagStatus.progress > tagRunStartRef.current.progress) {
                          const elapsed = (Date.now() - tagRunStartRef.current.ts) / 1000
                          const done = tagStatus.progress - tagRunStartRef.current.progress
                          const remaining = (tagStatus.total - tagStatus.progress) / (done / elapsed)
                          if (remaining > 0 && remaining < 86400) {
                            etaStr = remaining >= 3600 ? `~${Math.round(remaining/3600)}h left` : remaining >= 60 ? `~${Math.round(remaining/60)}m left` : `~${Math.round(remaining)}s left`
                            tagEtaRef.current = etaStr
                          } else { etaStr = tagEtaRef.current || '' }
                        } else { etaStr = tagEtaRef.current || '' }
                        return (
                          <div className="mt-1 flex flex-col gap-0.5">
                            <div className="flex items-center justify-between">
                              <div className="text-[13px] text-white/30">
                                {tagStatus.tagged} {t('tagged')} · {tagStatus.skipped} {t('skipped')}
                                {tagStatus.errors > 0 && <span style={{ color: '#F4C0D1' }}> · {tagStatus.errors} {t('errors')}</span>}
                              </div>
                              {etaStr && <div className="text-[13px]" style={{ color: 'color-mix(in srgb, var(--c-accent) 70%, transparent)' }}>{etaStr}</div>}
                            </div>
                            {tagStatus.current_path && (
                              <div className="text-[13px] truncate text-white/20" title={tagStatus.current_path}>
                                {tagStatus.current_path.replace(/.*[\\/]/, '')}
                              </div>
                            )}
                          </div>
                        )
                      })() : (
                        <div className="text-[13px] text-white/35 mt-1">{tagStatus.message}</div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-5">
                      {tagStatus?.message && tagStatus.message !== 'Idle' && (
                        <div className="text-[16px] text-white/45">{tagStatus.message}</div>
                      )}
                      <div>
                        <div className="text-[15px] font-semibold text-white/55 mb-2">{t('Scope')}</div>
                        <div className="flex gap-2 flex-wrap">
                          {[{ key: 'library', label: 'Entire library' }, { key: 'folder', label: 'Specific folder' }, { key: 'creator', label: 'By creator' }].map(({ key, label }) => (
                            <button key={key} onClick={() => setTagScope(key)}
                                    className="px-3 py-1.5 rounded-[6px] text-[15px] cursor-pointer"
                                    style={{ background: tagScope === key ? 'color-mix(in srgb, var(--c-accent) 25%, transparent)' : 'rgba(255,255,255,0.05)', color: tagScope === key ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.5)', border: `0.5px solid ${tagScope === key ? 'color-mix(in srgb, var(--c-accent) 40%, transparent)' : 'rgba(255,255,255,0.07)'}` }}>
                              {t(label)}
                            </button>
                          ))}
                        </div>
                        {tagScope === 'folder' && <div className="mt-2"><RootDropdown roots={roots ?? []} value={tagRootId} onChange={setTagRootId} /></div>}
                        {tagScope === 'creator' && (
                          <div className="mt-2 flex flex-col gap-1.5">
                            <input placeholder={t('Search creators…')} value={tagCreatorSearch}
                                   onChange={e => { setTagCreatorSearch(e.target.value); setTagCreatorId('') }}
                                   className="w-full px-3 py-2 rounded-[8px] text-[15px] outline-none"
                                   style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)' }} />
                            {tagCreatorId && (() => {
                              const sel = filteredTagCreators.find(c => String(c.id) === String(tagCreatorId)) || (allCreators ?? []).find(c => String(c.id) === String(tagCreatorId))
                              return sel ? (
                                <div className="flex items-center justify-between px-3 py-2 rounded-[8px]"
                                     style={{ background: 'color-mix(in srgb, var(--c-accent) 15%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }}>
                                  <span style={{ fontSize: 15, color: 'var(--c-accent-text)', fontWeight: 600 }}>{sel.name}</span>
                                  <button onClick={() => setTagCreatorId('')} className="cursor-pointer" style={{ color: 'rgba(255,255,255,0.35)' }}><X size={12} /></button>
                                </div>
                              ) : null
                            })()}
                            {!tagCreatorId && filteredTagCreators.length > 0 && (
                              <div className="rounded-[8px] overflow-hidden overflow-y-auto"
                                   style={{ background: '#161620', border: '0.5px solid rgba(255,255,255,0.1)', maxHeight: 160 }}>
                                {filteredTagCreators.map(c => (
                                  <button key={c.id} onClick={() => { setTagCreatorId(String(c.id)); setTagCreatorSearch('') }}
                                          className="w-full text-left px-3 py-2 flex items-center gap-2 cursor-pointer transition-colors"
                                          style={{ color: 'rgba(255,255,255,0.75)', fontSize: 15, borderBottom: '0.5px solid rgba(255,255,255,0.05)' }}
                                          onMouseEnter={e => e.currentTarget.style.background = 'color-mix(in srgb, var(--c-accent) 12%, transparent)'}
                                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: {cosplayer:'#1D9E75',ethot:'#D4537E',artist:'#7F77DD',character:'#BA7517',actress:'#378ADD',custom:'#888780'}[c.creator_type] || '#888780', flexShrink: 0, display: 'inline-block' }} />
                                    {c.name}
                                    <span style={{ marginLeft: 'auto', fontSize: 13, color: 'rgba(255,255,255,0.25)', textTransform: 'capitalize' }}>{c.creator_type}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                            {!tagCreatorId && filteredTagCreators.length === 0 && tagCreatorSearch && (
                              <div className="px-3 py-2 rounded-[8px] text-[15px]" style={{ color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.03)' }}>{t('No creators found')}</div>
                            )}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-[15px] font-semibold text-white/55 mb-2">{t('Model')}</div>
                        <div className="flex gap-2">
                          {[{ key: 'auto', label: 'Auto', desc: 'Routes by creator type' }, { key: 'wd14', label: 'WD14', desc: 'Anime / art / characters', disabled: !tagModels?.wd14_downloaded }, { key: 'joytag', label: 'JoyTag', desc: 'Cosplay / real photos', disabled: !tagModels?.joytag_downloaded }].map(({ key, label, desc, disabled }) => (
                            <button key={key} disabled={disabled} onClick={() => !disabled && setTagModelOverride(key)}
                                    className="flex-1 px-2 py-1.5 rounded-[6px] text-[15px] cursor-pointer text-center disabled:opacity-30"
                                    style={{ background: tagModelOverride === key ? 'color-mix(in srgb, var(--c-accent) 25%, transparent)' : 'rgba(255,255,255,0.05)', color: tagModelOverride === key ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.5)', border: `0.5px solid ${tagModelOverride === key ? 'color-mix(in srgb, var(--c-accent) 40%, transparent)' : 'rgba(255,255,255,0.07)'}` }}
                                    title={disabled ? t('Model not downloaded') : t(desc)}>
                              {t(label)}
                            </button>
                          ))}
                        </div>
                        {tagModelOverride === 'auto' && (
                          <div className="text-[14px] text-white/25 mt-1">{t("Galleries with an assigned creator use that creator's type. Unassigned → JoyTag (or WD14 fallback).")}</div>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-[15px] font-semibold text-white/55">{t('Confidence threshold')}</div>
                          <div className="text-[15px] font-mono" style={{ color: 'var(--c-accent-text)' }}>{Math.round(tagThreshold * 100)}%</div>
                        </div>
                        <input type="range" min="10" max="90" step="5" value={Math.round(tagThreshold * 100)}
                               onChange={e => setTagThreshold(Number(e.target.value) / 100)}
                               className="w-full accent-[var(--c-accent)] cursor-pointer" />
                        <div className="flex justify-between text-[13px] text-white/25 mt-0.5">
                          <span>{t('More tags (10%)')}</span><span>{t('Fewer, precise (90%)')}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-[16px] text-white/75">{t('GPU acceleration (NVIDIA CUDA)')}</div>
                          <div className="text-[14px] text-white/30 mt-0.5">{configData?.use_gpu !== false ? t('ON — using CUDA if available, CPU fallback otherwise') : t('OFF — running on CPU only')}</div>
                          {configData?.use_gpu === false && <div className="text-[14px] mt-1" style={{ color: 'var(--c-amber)' }}>{t('⚠ No NVIDIA GPU mode — AI tagging will be slower')}</div>}
                        </div>
                        <button onClick={() => gpuMutation.mutate(configData?.use_gpu === false ? true : false)}
                                disabled={gpuMutation.isPending}
                                className="w-10 h-5 rounded-full relative cursor-pointer flex-shrink-0 transition-colors disabled:opacity-50"
                                style={{ background: configData?.use_gpu !== false ? 'color-mix(in srgb, var(--c-accent) 60%, transparent)' : 'rgba(255,255,255,0.1)' }}>
                          <div className="w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all bg-white"
                               style={{ left: configData?.use_gpu !== false ? 'calc(100% - 17px)' : '3px' }} />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-[16px] text-white/75">{t('Re-tag already tagged images')}</div>
                          <div className="text-[14px] text-white/30 mt-0.5">{t('Off = skip images that already have AI tags')}</div>
                        </div>
                        <button onClick={() => setTagRetag(!tagRetag)}
                                className="w-10 h-5 rounded-full relative cursor-pointer flex-shrink-0 transition-colors"
                                style={{ background: tagRetag ? 'color-mix(in srgb, var(--c-accent) 60%, transparent)' : 'rgba(255,255,255,0.1)' }}>
                          <div className="w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all bg-white"
                               style={{ left: tagRetag ? 'calc(100% - 17px)' : '3px' }} />
                        </button>
                      </div>
                      {aiTaskQueued ? (
                        <div className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-[15px] w-fit"
                             style={{ background: 'color-mix(in srgb, var(--c-accent) 10%, transparent)', color: 'rgba(255,255,255,0.45)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 20%, transparent)' }}>
                          <Clock size={12} style={{ color: 'var(--c-accent)' }} /> {t('Queued in task queue…')}
                        </div>
                      ) : (
                        <button disabled={tagStarting || (!tagModels?.wd14_downloaded && !tagModels?.joytag_downloaded)}
                                onClick={startTagging}
                                className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-[16px] cursor-pointer w-fit disabled:opacity-40"
                                style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
                          <Cpu size={13} /> {tagStarting ? t('Starting…') : t('Start AI Tagging')}
                        </button>
                      )}
                    </div>
                  )}
                </SettingsSection>
              </div>
            )}

            {/* ── Appearance tab ───────────────────────── */}
            {settingsTab === 'appearance' && (
              <div className="space-y-3">
                <SettingsSection title={t('Language')} icon={Globe} accentColor="var(--c-accent)">
                  <div className="text-[14px] text-white/25 mb-3">{t('Display language')}</div>
                  <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
                    {LANGUAGES.map(lang => (
                      <button key={lang.id} onClick={() => setLocale(lang.id)}
                              className="flex items-center gap-3 p-3 rounded-[10px] cursor-pointer text-left transition-all"
                              style={{ background: locale === lang.id ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${locale === lang.id ? 'var(--c-accent)' : 'rgba(255,255,255,0.08)'}` }}>
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="text-[16px] font-medium truncate" style={{ color: locale === lang.id ? 'var(--c-accent)' : 'rgba(255,255,255,0.7)' }}>{lang.native}</span>
                          <span className="text-[13px] text-white/30 truncate">{lang.label}</span>
                        </div>
                        {locale === lang.id && <Check size={14} className="flex-shrink-0" style={{ color: 'var(--c-accent)' }} />}
                      </button>
                    ))}
                  </div>
                </SettingsSection>

                <SettingsSection title={t('Theme')} icon={Sparkles} accentColor="var(--c-accent)">
                  <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
                    {PALETTES.map(p => (
                      <button key={p.id} onClick={() => setPalette(p)}
                              className="flex flex-col gap-2 p-3 rounded-[10px] cursor-pointer text-left transition-all"
                              style={{ background: currentPalette.id === p.id ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${currentPalette.id === p.id ? p.accent : 'rgba(255,255,255,0.08)'}` }}>
                        <div className="flex gap-1 items-center">
                          {[p.accent, p.pink, p.amber, p.green].map((c, i) => (
                            <div key={i} className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: c }} />
                          ))}
                          {currentPalette.id === p.id && <Check size={12} className="ml-auto flex-shrink-0" style={{ color: p.accent }} />}
                        </div>
                        <div className="w-full h-1.5 rounded-full" style={{ background: `linear-gradient(to right, ${p.bg}, ${p.card})` }} />
                        <div className="text-[14px] font-medium" style={{ color: currentPalette.id === p.id ? p.accent : 'rgba(255,255,255,0.55)' }}>{t(p.label)}</div>
                      </button>
                    ))}
                  </div>
                  {currentPalette.id === 'glass' && (
                    <div className="pt-4" style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
                      <div className="text-[16px] font-semibold text-white/55 mb-1">{t('Glass Background Image')}</div>
                      <div className="text-[14px] text-white/25 mb-3">{t('Pick any image from your PC to use as the background behind the glass effect.')}</div>
                      <input ref={glassBgFileRef} type="file" accept="image/*" style={{ display: 'none' }}
                             onChange={e => {
                               const file = e.target.files[0]; if (!file) return
                               const reader = new FileReader()
                               reader.onload = ev => { setGlassBackground(ev.target.result); setGlassBgLabel(file.name); localStorage.setItem('vault_glass_bg_label', file.name) }
                               reader.readAsDataURL(file)
                             }} />
                      <div className="flex items-center gap-2">
                        <button onClick={() => glassBgFileRef.current?.click()}
                                className="px-4 py-2 rounded-[8px] text-[15px] cursor-pointer"
                                style={{ background: 'rgba(160,180,208,0.15)', color: '#A0B4D0', border: '0.5px solid rgba(160,180,208,0.35)' }}>
                          {t('Browse…')}
                        </button>
                        {glassBgLabel ? <span className="text-[14px] text-white/50 truncate flex-1">{glassBgLabel}</span>
                                      : <span className="text-[14px] text-white/20 flex-1">{t('No image selected — using default gradient')}</span>}
                      </div>
                      {glassBackground && (
                        <button onClick={() => { setGlassBackground(''); setGlassBgLabel(''); localStorage.removeItem('vault_glass_bg_label'); if (glassBgFileRef.current) glassBgFileRef.current.value = '' }}
                                className="mt-2 text-[14px] text-white/30 hover:text-white/60 transition-colors">
                          {t('Reset to default')}
                        </button>
                      )}
                    </div>
                  )}
                </SettingsSection>

                <SettingsSection title={t('Typography & Animations')} icon={Type} accentColor="rgba(255,255,255,0.4)" defaultOpen={false}>
                  <div className="mb-5">
                    <div className="text-[16px] font-semibold text-white/55 mb-2">{t('Font')}</div>
                    <div className="flex flex-wrap gap-2">
                      {FONTS.map(f => (
                        <button key={f.id} onClick={() => setFont(f)}
                                className="px-4 py-2 rounded-[8px] cursor-pointer transition-all text-[15px]"
                                style={{ fontFamily: f.family, background: currentFont.id === f.id ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)', border: `1px solid ${currentFont.id === f.id ? 'var(--c-accent)' : 'rgba(255,255,255,0.08)'}`, color: currentFont.id === f.id ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.45)' }}>
                          {t(f.label)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[16px] font-semibold text-white/55 mb-2">{t('Animations')}</div>
                    <div className="flex gap-2">
                      {[['full', 'Full'], ['reduced', 'Reduced'], ['off', 'Off']].map(([val, label]) => (
                        <button key={val} onClick={() => setAnimSpeed(val)}
                                className="flex-1 py-2 rounded-[8px] text-[15px] cursor-pointer transition-all"
                                style={{ background: animSpeed === val ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)', border: `1px solid ${animSpeed === val ? 'var(--c-accent)' : 'rgba(255,255,255,0.08)'}`, color: animSpeed === val ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)' }}>
                          {t(label)}
                        </button>
                      ))}
                    </div>
                    <div className="text-[14px] text-white/20 mt-2">{t('"Off" disables all transitions and animations — useful on low-end hardware.')}</div>
                  </div>
                </SettingsSection>


                <SettingsSection title={t('Vault identity')} icon={Sparkles} accentColor="var(--c-amber)" defaultOpen={false}>
                  <div className="mb-5">
                    <div className="text-[16px] font-semibold text-white/55 mb-2">{t('Vault name')}</div>
                    <div className="flex gap-2">
                      <input value={vaultNameInput} onChange={e => setVaultNameInput(e.target.value)}
                             onKeyDown={e => e.key === 'Enter' && setVaultName(vaultNameInput)}
                             placeholder={t('The Vault')} maxLength={30}
                             className="flex-1 px-3 py-2 rounded-[8px] text-[16px] outline-none"
                             style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)' }} />
                      <button onClick={() => setVaultName(vaultNameInput)}
                              className="px-4 py-2 rounded-[8px] text-[15px] cursor-pointer"
                              style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }}>
                        {t('Save')}
                      </button>
                    </div>
                    <div className="text-[14px] text-white/20 mt-1.5">{t('Shown in the sidebar. Max 30 characters.')}</div>
                  </div>
                  <div>
                    <div className="text-[16px] font-semibold text-white/55 mb-2">{t('Session border glow')}</div>
                    <div className="flex gap-2 flex-wrap">
                      {[
                        { label: 'Pink',   value: 'var(--c-pink)',  swatch: '#D4537E' },
                        { label: 'Red',    value: '#FF3333',         swatch: '#FF3333' },
                        { label: 'Cyan',   value: '#00DDFF',         swatch: '#00DDFF' },
                        { label: 'Violet', value: 'var(--c-accent)', swatch: '#7F77DD' },
                        { label: 'White',  value: '#FFFFFF',         swatch: '#FFFFFF' },
                        { label: 'Green',  value: 'var(--c-green)',  swatch: '#1D9E75' },
                      ].map(opt => (
                        <button key={opt.label} onClick={() => setSessionGlowColor(opt.value)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[15px] cursor-pointer transition-all"
                                style={{ background: sessionGlowColor === opt.value ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)', border: `1px solid ${sessionGlowColor === opt.value ? opt.swatch : 'rgba(255,255,255,0.08)'}`, color: sessionGlowColor === opt.value ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.45)' }}>
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: opt.swatch }} />
                          {t(opt.label)}
                        </button>
                      ))}
                    </div>
                  </div>
                </SettingsSection>

                <SettingsSection title={t('Effects & Companion')} icon={Sparkles} accentColor="var(--c-pink)" defaultOpen={false}>
                  <div className="flex flex-col gap-4 mb-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[16px] text-white/75">{t('🎉 Confetti on level-up')}</div>
                        <div className="text-[14px] text-white/30 mt-0.5">{t('Burst of confetti every time you level up.')}</div>
                      </div>
                      <button onClick={() => setConfettiEnabled(!confettiEnabled)}
                              className="w-10 h-5 rounded-full relative cursor-pointer flex-shrink-0 transition-colors"
                              style={{ background: confettiEnabled ? 'color-mix(in srgb, var(--c-pink) 60%, transparent)' : 'rgba(255,255,255,0.1)' }}>
                        <div className="w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all bg-white"
                             style={{ left: confettiEnabled ? 'calc(100% - 17px)' : '3px' }} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[16px] text-white/75">{t('Neon border effect')}</div>
                        <div className="text-[14px] text-white/30 mt-0.5">{t('Pulsing glow around screen edges during a session.')}</div>
                      </div>
                      <button onClick={() => setShowGoonBorder(!showGoonBorder)}
                              className="w-10 h-5 rounded-full relative cursor-pointer flex-shrink-0 transition-colors"
                              style={{ background: showGoonBorder ? 'color-mix(in srgb, var(--c-pink) 60%, transparent)' : 'rgba(255,255,255,0.1)' }}>
                        <div className="w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all bg-white"
                             style={{ left: showGoonBorder ? 'calc(100% - 17px)' : '3px' }} />
                      </button>
                    </div>
                  </div>
                  <div style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)', paddingTop: 16 }}>
                    <div className="text-[17px] font-semibold text-white/75 mb-1">{t('Vault Companion')}</div>
                    <div className="text-[15px] text-white/35 mb-4">{t('AI companion powered by Ollama (local, private, uncensored). Requires Ollama to be installed.')}</div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[16px] text-white/70">{compConfig?.enabled ? `${compConfig?.name || 'Erika'} is active` : t('Companion disabled')}</div>
                        <div className="text-[14px] text-white/30 mt-0.5">{t('When enabled, she appears in the sidebar and as a floating chat bubble.')}</div>
                      </div>
                      <button onClick={toggleCompanion}
                              className="w-10 h-5 rounded-full relative flex-shrink-0 ml-4 transition-colors"
                              style={{ background: compConfig?.enabled ? 'color-mix(in srgb, var(--c-accent) 60%, transparent)' : 'rgba(255,255,255,0.1)' }}>
                        <div className="w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all bg-white"
                             style={{ left: compConfig?.enabled ? 'calc(100% - 17px)' : '3px' }} />
                      </button>
                    </div>
                    {compConfig?.enabled && (
                      <a href="/erika" className="inline-flex items-center gap-1.5 mt-3 text-[15px] px-3 py-1.5 rounded-lg transition-colors hover:bg-white/10"
                         style={{ color: '#A89FE8', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
                        <Sparkles size={12} /> {t('Open')} {compConfig?.name || 'Erika'} →
                      </a>
                    )}
                  </div>
                </SettingsSection>
              </div>
            )}

            {/* ── Session tab ──────────────────────────── */}
            {settingsTab === 'session' && (
              <div className="space-y-3">
                <SettingsSection title={t('End session behaviour')} icon={Droplets} accentColor="var(--c-pink)">
                  <div className="mb-2">
                    <div className="flex flex-col gap-2">
                      {[
                        { value: 'always', label: 'Always count it',
                          hint: 'Ending a session logs a climax. The original behaviour.' },
                        { value: 'ask',    label: 'Ask me each time',
                          hint: 'Prompts on every finish. Backing out leaves the session running.' },
                        { value: 'never',  label: 'Never count it',
                          hint: 'Logs the time only. Mark climaxes yourself with the 💦 button.' },
                      ].map(opt => {
                        const active = sessionEndClimax === opt.value
                        return (
                          <button key={opt.value} onClick={() => setSessionEndClimax(opt.value)}
                                  className="text-left px-3 py-2.5 rounded-[9px] cursor-pointer transition-all"
                                  style={{
                                    background: active
                                      ? 'color-mix(in srgb, var(--c-pink) 16%, transparent)'
                                      : 'rgba(255,255,255,0.04)',
                                    border: `1px solid ${active
                                      ? 'color-mix(in srgb, var(--c-pink) 45%, transparent)'
                                      : 'rgba(255,255,255,0.08)'}`,
                                  }}>
                            <div className="text-[16px]" style={{
                              color: active ? 'color-mix(in srgb, var(--c-pink) 75%, white)' : 'rgba(255,255,255,0.7)',
                              fontWeight: active ? 600 : 400,
                            }}>{t(opt.label)}</div>
                            <div className="text-[14px] text-white/30 mt-0.5">{t(opt.hint)}</div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </SettingsSection>

                <SettingsSection title={t('Edges')} icon={Waves} accentColor="var(--c-accent)" defaultOpen={false}>
                  <div className="text-[15px] text-white/35">
                    {t('Edge Mode logs an edge whenever the device cuts out. Without a device, log one yourself with the Edge button in any viewer, or the "Log an edge" hotkey.')}
                  </div>
                </SettingsSection>

                <SettingsSection title={t('Session history')} icon={Clock} accentColor="var(--c-amber)" defaultOpen={false}>
                  <div className="text-[15px] text-white/35">
                    {t('Sessions are logged automatically, so a crash or a forgotten stop can leave one that is wrong. Every entry in Session History can be edited or deleted, and you can add sessions the app never saw.')}
                  </div>
                  <a href="/stats" className="inline-flex items-center gap-1.5 mt-3 text-[15px] px-3 py-1.5 rounded-lg transition-colors hover:bg-white/10"
                     style={{ color: 'color-mix(in srgb, var(--c-amber) 80%, white)',
                              border: '0.5px solid color-mix(in srgb, var(--c-amber) 35%, transparent)' }}>
                    <Clock size={12} /> {t('Open Session History')} →
                  </a>
                </SettingsSection>
              </div>
            )}

            {/* ── Hotkeys tab ──────────────────────────── */}
            {settingsTab === 'hotkeys' && (
              <div className="space-y-3">
                <SettingsSection title={t('Hotkeys')} icon={Keyboard} accentColor="var(--c-accent)">
                  <HotkeySettings />
                </SettingsSection>
              </div>
            )}

            {/* ── Backup tab ───────────────────────────── */}
            {settingsTab === 'backup' && (
              <div className="space-y-3">
                <SettingsSection title={t('Backup & Restore')} icon={Archive} accentColor="var(--c-green)">
                  <div className="flex items-center justify-between py-3">
                    <div>
                      <div className="text-[17px] font-semibold text-white/80">{t('Backup database')}</div>
                      <div className="text-[16px] text-white/35 mt-0.5">{t('Downloads a snapshot of')} <code className="text-white/50">vault.db</code> {t('— all galleries, creators, sessions, and cards.')}</div>
                    </div>
                    <button onClick={() => { systemApi.backup(); toast.success(t('Backup download started!')) }}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-[16px] font-medium cursor-pointer flex-shrink-0 ml-4"
                            style={{ background: 'color-mix(in srgb, var(--c-green) 20%, transparent)', color: 'var(--c-green-text)', border: '0.5px solid color-mix(in srgb, var(--c-green) 40%, transparent)' }}>
                      <Download size={14} /> {t('Download backup')}
                    </button>
                  </div>
                  <div style={{ height: '0.5px', background: 'color-mix(in srgb, var(--c-green) 20%, transparent)' }} />
                  <div className="flex items-start justify-between gap-4 pt-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[17px] font-semibold text-white/80">{t('Restore backup')}</div>
                      <div className="text-[16px] text-white/35 mt-0.5">{t('Select a')} <code className="text-white/50">.db</code> {t('backup file. Your current database is saved automatically before overwriting.')}</div>
                      {restoreState === 'confirming' && restoreFile && (
                        <div className="mt-3 p-3 rounded-[8px]"
                             style={{ background: 'color-mix(in srgb, var(--c-pink) 10%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-pink) 35%, transparent)' }}>
                          <div className="text-[15px] font-medium mb-1" style={{ color: '#F4C0D1' }}>{t('⚠️ Replace entire database?')}</div>
                          <div className="text-[14px] mb-3" style={{ color: 'rgba(255,255,255,0.45)' }}>
                            {t('File:')} <span style={{ color: 'rgba(255,255,255,0.7)' }}>{restoreFile.name}</span><br />
                            {t('This will replace all your current data. The app will restart automatically.')}
                          </div>
                          <div className="flex gap-2">
                            <button onClick={confirmRestore}
                                    className="px-4 py-1.5 rounded-[6px] text-[15px] font-medium cursor-pointer"
                                    style={{ background: 'color-mix(in srgb, var(--c-pink) 30%, transparent)', color: '#FFD4E2', border: '0.5px solid color-mix(in srgb, var(--c-pink) 50%, transparent)' }}>
                              {t('Yes, restore')}
                            </button>
                            <button onClick={() => { setRestoreState('idle'); setRestoreFile(null) }}
                                    className="px-4 py-1.5 rounded-[6px] text-[15px] cursor-pointer"
                                    style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
                              {t('Cancel')}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    <input ref={restoreInputRef} type="file" accept=".db" className="hidden" onChange={handleRestoreFileChange} />
                    <button onClick={() => restoreState === 'idle' && restoreInputRef.current?.click()}
                            disabled={restoreState !== 'idle'}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-[16px] font-medium cursor-pointer flex-shrink-0 disabled:opacity-60"
                            style={restoreState === 'done'
                              ? { background: 'color-mix(in srgb, var(--c-green) 20%, transparent)', color: 'var(--c-green-text)', border: '0.5px solid color-mix(in srgb, var(--c-green) 40%, transparent)' }
                              : { background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)', border: '0.5px solid rgba(255,255,255,0.15)' }}>
                      {restoreState === 'uploading' ? <><RefreshCw size={14} className="animate-spin" /> {t('Uploading…')}</>
                       : restoreState === 'restarting' ? <><RefreshCw size={14} className="animate-spin" /> {t('Restarting…')}</>
                       : restoreState === 'done' ? <><Check size={14} /> {t('Restored!')}</>
                       : <><Download size={14} style={{ transform: 'rotate(180deg)' }} /> {t('Restore backup')}</>}
                    </button>
                  </div>
                </SettingsSection>

                <SettingsSection title={t('Storage location')} icon={HardDrive} accentColor="var(--c-accent)" defaultOpen={false}>
                  <p className="text-[16px] text-white/45 mb-4">{t('Where')} <code className="text-white/50">vault.db</code> {t('and the thumbnail cache are stored. Move to a larger drive if C: space is limited. The server restarts automatically when saved.')}</p>
                  {configData && <div className="text-[15px] mb-3" style={{ color: 'rgba(255,255,255,0.3)' }}>{t('Active:')} <span className="font-mono" style={{ color: 'rgba(255,255,255,0.55)' }}>{configData.effective_data_dir}</span></div>}
                  {configData?.data_dir && configData.data_dir !== configData?.effective_data_dir && (
                    <div className="text-[14px] mb-3" style={{ color: 'var(--c-amber)' }}>{t('⚠ Configured path')} <span className="font-mono">{configData.data_dir}</span> {t('was not available at startup.')}</div>
                  )}
                  <div className="flex gap-2">
                    <input value={storageInput} onChange={e => { setStorageInput(e.target.value); setStorageState('idle') }}
                           placeholder="e.g. D:\VaultData"
                           className="flex-1 px-3 py-2 rounded-[7px] text-[15px] font-mono outline-none"
                           style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.8)' }} />
                    <button onClick={storageState === 'idle' ? handleStorageSave : undefined}
                            disabled={storageState === 'saving' || storageState === 'saved'}
                            className="flex items-center gap-2 px-4 py-2 rounded-[7px] text-[15px] font-medium cursor-pointer flex-shrink-0 disabled:opacity-60"
                            style={storageState === 'saved'
                              ? { background: 'color-mix(in srgb, var(--c-green) 20%, transparent)', color: 'var(--c-green-text)', border: '0.5px solid color-mix(in srgb, var(--c-green) 40%, transparent)' }
                              : { background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }}>
                      {storageState === 'saving' ? <><RefreshCw size={12} className="animate-spin" /> {t('Saving…')}</>
                       : storageState === 'saved' ? <><Check size={12} /> {t('Saved — restarting…')}</>
                       : <><Check size={12} /> {t('Save & restart')}</>}
                    </button>
                  </div>
                </SettingsSection>
              </div>
            )}

            {/* ── System tab ───────────────────────────── */}
            {settingsTab === 'system' && (
              <div className="space-y-3">
                <SettingsSection title={t('Connect mobile device')} icon={Smartphone} accentColor="var(--c-accent)">
                  <div className="text-[16px] text-white/45 mb-4 leading-relaxed">
                    {t('Open The Vault on your phone. Put the phone on the')} <strong className="text-white/70">{t('same Wi-Fi')}</strong> {t("as this PC, then scan the code below or type the address into the phone's browser. Tap")} <strong className="text-white/70">{t('Add to Home Screen')}</strong> {t('to get a full-screen app with no browser bars.')}
                  </div>
                  {mobileLink?.found === false && (
                    <div className="flex items-center gap-2 text-[16px] mb-4 p-3 rounded-[8px]"
                         style={{ background: 'color-mix(in srgb, var(--c-amber) 12%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 30%, transparent)', color: 'var(--c-amber-text)' }}>
                      <AlertCircle size={16} /> {t("Could not find this PC's network address. Make sure you're connected to Wi-Fi or a network.")}
                    </div>
                  )}
                  <div className="flex items-center gap-6 flex-wrap">
                    {mobileLink?.url && (
                      <div className="p-3 rounded-[12px] bg-white flex-shrink-0">
                        <QRCodeCanvas value={mobileLink.url} size={168} level="M" includeMargin={false} />
                      </div>
                    )}
                    <div className="flex-1 min-w-[220px]">
                      <div className="text-[15px] text-white/35 mb-1">{t('Address for your phone')}</div>
                      <div className="flex items-center gap-2">
                        <code className="text-[18px] font-mono px-3 py-2 rounded-[8px] flex-1 break-all"
                              style={{ background: 'rgba(255,255,255,0.05)', color: '#D0CEFD', border: '0.5px solid rgba(255,255,255,0.08)' }}>
                          {mobileLink?.url ?? '…'}
                        </code>
                        <button onClick={() => { if (mobileLink?.url) { navigator.clipboard?.writeText(mobileLink.url); toast.success(t('Address copied')) } }}
                                disabled={!mobileLink?.url}
                                className="flex items-center gap-2 px-3 py-2.5 rounded-[8px] text-[16px] font-medium cursor-pointer flex-shrink-0 disabled:opacity-40"
                                style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', color: '#B8B4F0', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }}>
                          <Copy size={15} /> {t('Copy')}
                        </button>
                      </div>
                      <div className="text-[15px] text-white/30 mt-3 leading-relaxed">
                        {t('Keep The Vault running on this PC — your phone reads the library straight from here, so nothing is copied to the phone.')}
                      </div>
                    </div>
                  </div>
                </SettingsSection>

                <SettingsSection title={t('Startup & Updates')} icon={RefreshCw} accentColor="var(--c-accent)">
                  <div className="flex items-center justify-between py-3 mb-4" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
                    <div>
                      <div className="text-[17px] font-semibold text-white/80">{t('Run on startup')}</div>
                      <div className="text-[16px] text-white/35 mt-0.5">{t('Launch The Vault automatically when Windows starts.')}</div>
                      {startupData && !startupData.available && <div className="text-[14px] mt-1 text-white/25">{t('Only available in the installed version')}</div>}
                    </div>
                    <button disabled={!startupData?.available || startupMutation.isPending}
                            onClick={() => startupMutation.mutate(!startupData?.enabled)}
                            className="w-10 h-5 rounded-full relative flex-shrink-0 ml-4 transition-colors disabled:opacity-30"
                            style={{ background: startupData?.enabled ? 'color-mix(in srgb, var(--c-accent) 60%, transparent)' : 'rgba(255,255,255,0.1)', cursor: startupData?.available ? 'pointer' : 'not-allowed' }}>
                      <div className="w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all bg-white"
                           style={{ left: startupData?.enabled ? 'calc(100% - 17px)' : '3px' }} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-[17px] font-semibold text-white/80">{t('App updates')}</div>
                      <div className="text-[16px] text-white/35 mt-0.5">
                        {t('Current version:')} <span className="font-mono text-white/50">v{versionData?.version ?? '…'}</span>
                        {versionData && !versionData.is_installed && <span className="ml-2 text-white/25">{t('(dev mode)')}</span>}
                      </div>
                    </div>
                    <button onClick={handleCheckUpdate}
                            disabled={['checking','downloading','installing'].includes(updateState)}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-[16px] font-medium cursor-pointer flex-shrink-0 ml-4 disabled:opacity-50"
                            style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', color: '#B8B4F0', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }}>
                      {updateState === 'checking' ? <><RefreshCw size={14} className="animate-spin" /> {t('Checking…')}</> : <><RefreshCw size={14} /> {t('Check for updates')}</>}
                    </button>
                  </div>
                  {updateState === 'up_to_date' && <div className="flex items-center gap-2 text-[16px]" style={{ color: 'var(--c-green-text)' }}><CheckCircle2 size={14} /> {t("You're on the latest version.")}</div>}
                  {updateState === 'available' && updateInfo && (
                    <div className="rounded-[8px] p-4 space-y-2" style={{ background: 'color-mix(in srgb, var(--c-accent) 10%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
                      <div className="text-[17px] font-semibold" style={{ color: '#D0CEFD' }}>v{updateInfo.latest_version} {t('available')}</div>
                      {updateInfo.changelog && <div className="text-[16px] whitespace-pre-line text-white/45">{updateInfo.changelog}</div>}
                      <button onClick={handleInstallUpdate}
                              className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-[16px] font-medium cursor-pointer mt-1"
                              style={{ background: 'color-mix(in srgb, var(--c-accent) 30%, transparent)', color: '#D0CEFD', border: '0.5px solid color-mix(in srgb, var(--c-accent) 50%, transparent)' }}>
                        <Download size={14} /> {t('Download & Install')}
                      </button>
                    </div>
                  )}
                  {(updateState === 'downloading' || updateState === 'installing') && (
                    <div className="space-y-2">
                      <div className="text-[16px] text-white/50">{updateState === 'installing' ? t('Launching installer — the app will close and restart…') : `Downloading… ${updateProgress}%`}</div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${updateProgress}%`, background: 'color-mix(in srgb, var(--c-accent) 70%, transparent)' }} />
                      </div>
                    </div>
                  )}
                  {updateState === 'error' && <div className="flex items-center gap-2 text-[16px]" style={{ color: '#F4C0D1' }}><AlertCircle size={13} /> {updateError}</div>}
                </SettingsSection>

                <SettingsSection title={t('Changelog')} icon={ScrollText} accentColor="var(--c-accent)" defaultOpen={false}>
                  {!changelogData?.entries?.length && (
                    <div className="text-[16px] text-white/35">{t('No changelog history yet.')}</div>
                  )}
                  <div className="space-y-2">
                    {changelogData?.entries?.map((entry) => (
                      <ChangelogEntry key={entry.version} entry={entry} />
                    ))}
                  </div>
                </SettingsSection>

                <SettingsSection title={t('Server')} icon={RefreshCw} accentColor="var(--c-amber)" defaultOpen={false}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[17px] font-semibold text-white/80">{t('Restart server')}</div>
                      <div className="text-[16px] text-white/35 mt-0.5">{t('Restarts the Python backend. The page will reconnect automatically — takes about 3–5 seconds.')}</div>
                    </div>
                    <button onClick={restartState === 'idle' ? handleRestart : undefined}
                            disabled={restartState === 'restarting'}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-[16px] font-medium cursor-pointer flex-shrink-0 ml-4 disabled:opacity-60"
                            style={restartState === 'done'
                              ? { background: 'color-mix(in srgb, var(--c-green) 20%, transparent)', color: 'var(--c-green-text)', border: '0.5px solid color-mix(in srgb, var(--c-green) 40%, transparent)' }
                              : { background: 'color-mix(in srgb, var(--c-amber) 20%, transparent)', color: 'var(--c-amber-text)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 40%, transparent)' }}>
                      {restartState === 'restarting' ? <><RefreshCw size={14} className="animate-spin" /> {t('Restarting…')}</>
                       : restartState === 'done' ? <><Check size={14} /> {t('Back online')}</>
                       : <><RefreshCw size={14} /> {t('Restart server')}</>}
                    </button>
                  </div>
                </SettingsSection>

                <SettingsSection title={t('Factory reset')} icon={AlertCircle} accentColor="var(--c-pink)" defaultOpen={false}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[17px] font-semibold" style={{ color: 'rgba(244,192,209,0.9)' }}>{t('Restore defaults')}</div>
                      <div className="text-[16px] text-white/35 mt-0.5">{t('Wipe all galleries, creators, sessions, and cards for a clean start.')}</div>
                    </div>
                    <button onClick={() => setShowResetModal(true)}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-[16px] font-medium cursor-pointer flex-shrink-0 ml-4"
                            style={{ background: 'color-mix(in srgb, var(--c-pink) 15%, transparent)', color: '#F4C0D1', border: '0.5px solid color-mix(in srgb, var(--c-pink) 35%, transparent)' }}>
                      <AlertCircle size={14} /> {t('Reset collection')}
                    </button>
                  </div>
                </SettingsSection>
              </div>
            )}

          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Factory reset confirmation modal ───────────────────────────────── */}
      {showResetModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6"
             style={{ background: 'rgba(0,0,0,0.75)' }}
             onClick={resetState === 'idle' ? () => setShowResetModal(false) : undefined}>
          <div className="rounded-[16px] p-7 max-w-md w-full"
               style={{ background: '#1a1a1a', border: '1px solid color-mix(in srgb, var(--c-pink) 40%, transparent)', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
               onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#F4C0D1', marginBottom: 10 }}>{t('Wipe entire collection?')}</div>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6, marginBottom: 16 }}>{t('This will permanently delete:')}</div>
            <ul style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', lineHeight: 1.8, marginBottom: 20, paddingLeft: 20 }}>
              <li>{t('All galleries and images')}</li>
              <li>{t('All creators and characters')}</li>
              <li>{t('All session history and stats')}</li>
              <li>{t('All cards, packs, and TCG progress')}</li>
              <li>{t('All XP, levels, and achievements')}</li>
            </ul>
            <div className="p-3 rounded-[8px] mb-6" style={{ background: 'color-mix(in srgb, var(--c-pink) 12%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-pink) 30%, transparent)' }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#F4C0D1', marginBottom: 4 }}>{t('This cannot be undone.')}</div>
              <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)' }}>{t('The only way to recover your data is from a backup file. Use')} <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{t('Download backup')}</strong> {t('first if you want to keep a copy.')}</div>
            </div>
            <div className="flex gap-3">
              <button onClick={resetState === 'idle' ? handleReset : undefined} disabled={resetState !== 'idle'}
                      className="flex items-center gap-2 px-5 py-3 rounded-[8px] text-[15px] font-medium cursor-pointer disabled:opacity-50"
                      style={{ background: 'color-mix(in srgb, var(--c-pink) 30%, transparent)', color: '#FFD4E2', border: '0.5px solid color-mix(in srgb, var(--c-pink) 50%, transparent)' }}>
                {resetState === 'resetting' ? <><RefreshCw size={15} className="animate-spin" /> {t('Wiping & restarting…')}</> : t('💣 Yes, wipe everything')}
              </button>
              <button onClick={() => setShowResetModal(false)} disabled={resetState === 'resetting'}
                      className="flex-1 px-4 py-3 rounded-[8px] text-[15px] cursor-pointer disabled:opacity-40"
                      style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
                {t('Cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export function MultiPanel() {
  const t = useT()
  return (
    <div className="p-5 flex items-center justify-center h-full">
      <div className="text-center">
        <div className="text-[rgba(255,255,255,0.3)] text-[14px] mb-2">{t('Multi-panel viewer')}</div>
        <div className="text-[rgba(255,255,255,0.15)] text-[12px]">{t('Coming in Phase 2 — the UI mockup is ready to implement!')}</div>
      </div>
    </div>
  )
}

export function ScanLog() {
  const { data: scanStatus } = useQuery({
    queryKey: ['scan-status'],
    queryFn: () => fetch('/api/scanner/status').then(r => r.json()),
    refetchInterval: (query) => query.state.data?.running ? 2000 : false,
  })

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['scan-log'],
    queryFn: () => scannerApi.log().then(r => r.data),
    refetchInterval: scanStatus?.running ? 1500 : false,
  })
  const qc = useQueryClient()
  const t = useT()

  const log = data?.log ?? []

  return (
    <div className="p-5 flex flex-col gap-4 h-full">
      <div className="flex items-center gap-3">
        <ScrollText size={15} style={{ color: 'var(--c-accent)' }} />
        <div className="text-[16px] font-medium text-[rgba(255,255,255,0.9)]">{t('Scan Log')}</div>
        {scanStatus?.running && (
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px]"
               style={{ background: 'color-mix(in srgb, var(--c-green) 15%, transparent)', color: 'var(--c-green-text)', border: '0.5px solid color-mix(in srgb, var(--c-green) 30%, transparent)' }}>
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--c-green)' }} />
            {t('Scanning…')}
          </div>
        )}
        {scanStatus?.running && (
          <button onClick={async () => { await scannerApi.cancel(); qc.invalidateQueries({ queryKey: ['scan-status'] }) }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] cursor-pointer"
                  style={{ background: 'color-mix(in srgb, var(--c-pink) 15%, transparent)', color: '#F4C0D1', border: '0.5px solid color-mix(in srgb, var(--c-pink) 30%, transparent)' }}>
            <X size={10} /> {t('Cancel scan')}
          </button>
        )}
        <button onClick={() => refetch()} className="ml-auto text-[10px] cursor-pointer text-[rgba(255,255,255,0.3)] hover:text-white">
          {t('Refresh')}
        </button>
      </div>

      {scanStatus?.running && (
        <div className="rounded-[8px] p-3" style={{ background: 'color-mix(in srgb, var(--c-green) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-green) 20%, transparent)' }}>
          <div className="text-[11px] text-[rgba(255,255,255,0.6)] mb-1.5">{scanStatus.message}</div>
          <div className="h-1.5 rounded-full bg-[rgba(255,255,255,0.07)] overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ background: 'var(--c-green)', width: `${scanStatus.total ? (scanStatus.progress / scanStatus.total) * 100 : 0}%` }} />
          </div>
          <div className="text-[9px] text-[rgba(255,255,255,0.3)] mt-1">
            {scanStatus.progress} / {scanStatus.total} {t('folders')}
          </div>
        </div>
      )}

      <div className="flex-1 rounded-[10px] overflow-y-auto font-mono text-[11px]"
           style={{ background: '#0d0d0d', border: '0.5px solid rgba(255,255,255,0.08)', padding: '12px' }}>
        {isLoading ? (
          <div className="text-[rgba(255,255,255,0.2)]">{t('Loading log…')}</div>
        ) : log.length === 0 ? (
          <div className="text-[rgba(255,255,255,0.2)]">{t('No log entries yet. Start a scan to see output here.')}</div>
        ) : (
          [...log].reverse().map((line, i) => (
            <div key={i} className="py-0.5 leading-relaxed"
                 style={{ color: line.startsWith('ERROR') ? '#F4C0D1' : line.startsWith('Scan') || line.startsWith('Folder') ? 'var(--c-green-text)' : 'rgba(255,255,255,0.5)' }}>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

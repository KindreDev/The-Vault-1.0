import React from 'react'
import ReactDOM from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Lock, Target, Trophy, X, ScrollText, Cpu, Globe, Pencil, Trash2, Plus } from 'lucide-react'
import { gamiApi, sessionsApi, scannerApi, creatorsApi, cardsApi, galleriesApi } from '../lib/api'
import { useVaultStore } from '../store/vault'
import { useT } from '../i18n'
import Almanac from '../components/stats/Almanac'
import AnalyticsDashboard from '../components/analytics/AnalyticsDashboard'
import { useSession } from '../hooks/useSession'
import { useAllCreators } from '../hooks/useAllCreators'
import toast from 'react-hot-toast'
import { ComposableMap, Geographies, Geography, ZoomableGroup, Marker } from 'react-simple-maps'
import ModalLayer from '../components/ModalLayer'
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
    <ModalLayer><div className="fixed inset-0 z-[200] flex items-center justify-center animate-fade-in"
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
    </div></ModalLayer>
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
          <div className="text-[16px] text-[rgba(255,255,255,0.35)] mt-0.5">{quest.description}</div>
          {!done && quest.target > 1 && (
            <>
              <div className="flex justify-between text-[16px] text-[rgba(255,255,255,0.3)] mt-2 mb-1">
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
            <div className="text-[16px] font-medium" style={{ color: 'var(--c-amber-text)' }}>+{quest.credit_reward} 💰</div>
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
        <div className="text-[16px] text-[rgba(255,255,255,0.35)]">{ach.description}</div>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <div className="text-[11px] font-medium" style={{ color: ach.unlocked ? 'var(--c-accent)' : 'rgba(255,255,255,0.2)' }}>
          +{ach.xp_reward} {t('XP')}
        </div>
        {ach.credit_reward > 0 && (
          <div className="text-[16px] font-medium" style={{ color: ach.unlocked ? 'var(--c-amber-text)' : 'rgba(255,255,255,0.15)' }}>
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
          <span className="text-[16px] px-2 py-0.5 rounded-full font-medium animate-pulse"
                style={{ background: 'color-mix(in srgb, var(--c-amber) 20%, transparent)', color: 'var(--c-amber-text)' }}>
            🎁 {t('Ready!')}
          </span>
        ) : alreadyClaimed ? (
          <span className="text-[16px] px-2 py-0.5 rounded-full font-medium"
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
      <div className="text-[16px]" style={{ color: 'rgba(255,255,255,0.28)' }}>{t(packNote)}</div>

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
      toast.success(type === 'daily'
        ? `🎴 ${t('Claimed 5 Permanent Vault Boosters!')}`
        : `🎴 ${t('Claimed 1 Weekly Protection Pack!')}`)
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
              <div className="text-[16px] text-[rgba(255,255,255,0.25)]">{t('resets midnight')}</div>
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
              <div className="text-[16px] text-[rgba(255,255,255,0.25)]">{t('resets Monday')}</div>
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
            packLabel="5 Permanent Vault Boosters"
            packNote="10 cards per pack · SR-or-higher guarantee"
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
            packLabel="1 Weekly Protection Pack"
            packNote="4 cards · 3 UR + 1 SPR guaranteed · choose a published release"
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
                  <span className="text-[16px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{t(r.label)}</span>
                  <span className="text-[16px] font-semibold" style={{ color: r.color }}>{t(r.xp)}</span>
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
          <div className="text-[16px] text-[rgba(255,255,255,0.25)]">{t('permanent · no expiry')}</div>
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

// XP needed to reach a given level: sum(500*i, i=1..lvl-1) = 500*(lvl-1)*lvl/2
const xpForLevel = lvl => lvl <= 1 ? 0 : 500 * (lvl - 1) * lvl / 2

function getLevelColor(lvl) {
  if (lvl >= 96) return 'var(--c-amber-text)'
  if (lvl >= 81) return 'var(--c-accent-text)'
  if (lvl >= 71) return 'var(--c-pink-text)'
  if (lvl >= 61) return 'var(--c-pink)'
  if (lvl >= 51) return 'var(--c-amber)'
  if (lvl >= 41) return 'var(--c-pink)'
  if (lvl >= 31) return 'var(--c-accent)'
  if (lvl >= 21) return 'var(--c-accent-text)'
  if (lvl >= 11) return 'var(--c-green)'
  return 'rgba(255,255,255,0.55)'
}

// ── Sessions history modal ────────────────────────────────────────────────────
function SessionsModal({ onClose }) {
  const t  = useT()
  const locale = useVaultStore(s => s.locale)
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
  // takes every row in the group, since one playlist session writes several.
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
      toast.success(g.ids.length > 1 ? t('{count} session rows deleted', { count: g.ids.length }) : t('Session deleted'))
      refresh()
    } catch {
      toast.error(t('Could not delete that session'))
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
            creator_ids: s.creator_id ? [s.creator_id] : [],
            gallery_name: s.gallery_name, duration_sec: s.duration_sec,
          ids: [s.id],
          // The row that actually carries the duration — not always the first,
          // so an edit has to patch this one or the correction goes nowhere.
          durationId: s.duration_sec ? s.id : null,
        }
        result.push(cur)
      } else {
        if (s.creator_name && !cur.creators.includes(s.creator_name)) cur.creators.push(s.creator_name)
        if (s.creator_id && !cur.creator_ids.includes(s.creator_id)) cur.creator_ids.push(s.creator_id)
        if (!cur.duration_sec && s.duration_sec) { cur.duration_sec = s.duration_sec; cur.durationId = s.id }
        cur.ids.push(s.id)
      }
    }
    return result
  }, [allSessions])

  const [expanded,    setExpanded]    = React.useState(new Set())
  const [hoveredRow,  setHoveredRow]  = React.useState(null)
  const [expandedMore, setExpandedMore] = React.useState(null)

  const toggle = (i) => setExpanded(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })

  const relTime = (ts) => {
    const tm = new Date(ts + (ts.endsWith('Z') ? '' : 'Z'))
    const d = Math.floor((Date.now() - tm.getTime()) / 86400000)
    if (d === 0) return t('Today')
    if (d === 1) return t('Yesterday')
    if (d < 7) return tm.toLocaleDateString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', { weekday: 'long' })
    if (d < 30) return t('{count} days ago', { count: d })
    return tm.toLocaleDateString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const fullDate = (ts) => {
    const tm = new Date(ts + (ts.endsWith('Z') ? '' : 'Z'))
    const dateLocale = locale === 'zh-CN' ? 'zh-CN' : 'en-US'
    return tm.toLocaleDateString(dateLocale, { month: 'long', day: 'numeric', year: 'numeric' }) +
      ` ${t('at')} ` + tm.toLocaleTimeString(dateLocale, { hour: 'numeric', minute: '2-digit' })
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
    const isMoreOpen = expandedMore === idx
    return (
      <>{wrap(creators[0])}, {wrap(creators[1])} {t('and')}{' '}
        <button
          type="button"
          style={{
            color: 'var(--c-pink-text)', fontWeight: 700, cursor: 'pointer',
            borderBottom: '1px dotted color-mix(in srgb, var(--c-pink) 50%, transparent)',
            background: 'none', borderTop: 0, borderLeft: 0, borderRight: 0,
            padding: 0, font: 'inherit',
            transition: 'color 0.15s, border-color 0.15s',
          }}
          onClick={(e) => { e.stopPropagation(); setExpandedMore(current => current === idx ? null : idx) }}
          aria-expanded={isMoreOpen}
          aria-controls={`session-more-${idx}`}
        >{extra.length} {t('more')}</button>
      </>
    )
  }

  return ReactDOM.createPortal(
    <ModalLayer><div
      className="fixed inset-0 z-[200] flex items-center justify-center animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.75)', padding: 24 }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--c-surface)',
          border: '0.5px solid var(--c-accent-line)',
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
                        maxHeight: isOpen ? (expandedMore === i ? 460 : 200) : 0,
                        opacity: isOpen ? 1 : 0,
                        transition: 'max-height 0.25s ease, opacity 0.2s ease',
                      }}>
                        <div style={{ padding: '2px 24px 14px 52px', fontSize: 16, color: 'rgba(255,255,255,0.45)', lineHeight: 1.7 }}>
                          {t('You gooned to')} {creatorSentence(g.creators, i)} {t('on')}{' '}
                          <span style={{ color: 'rgba(255,255,255,0.6)' }}>{fullDate(g.logged_at)}</span>
                          {dur && <>{' '}{t('for')} <span style={{ color: 'var(--c-pink)' }}>{dur}</span></>}.

                          {expandedMore === i && g.creators.length > 3 && (
                            <div style={{
                              marginTop: 8, maxHeight: 160, overflowY: 'auto',
                              background: 'var(--c-card)', border: '0.5px solid var(--c-pink-line)',
                              borderRadius: 8, padding: '8px 12px',
                              opacity: 1,
                              transition: 'max-height 0.22s ease, margin 0.22s ease, padding 0.22s ease, opacity 0.16s ease',
                            }}>
                              <div id={`session-more-${i}`} role="list" aria-label={t('Other credited creators')}>
                                {g.creators.slice(2).map((n, j) => (
                                  <div key={j} role="listitem" style={{ fontSize: 16, color: 'rgba(255,255,255,0.85)', lineHeight: 1.55 }}>
                                    {n}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

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
    </div></ModalLayer>,
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
 * the duration — in a playlist session that is not necessarily the first.
 *
 * Manual adds are logged with skip_xp: XP is for gooning, not for typing, and
 * an editable XP source would make the whole progression meaningless. Editing
 * an existing session never re-scores its XP either — the system rewards and
 * never penalises.
 */
function SessionEditor({ session, onClose, onSaved }) {
  const t = useT()
  const isEdit = !!session
  const { data: allCreators = [] } = useAllCreators()

  // datetime-local wants local wall-clock; stored timestamps are naive UTC.
  const toLocalInput = (ts) => {
    const d = ts ? new Date(ts + (ts.endsWith('Z') ? '' : 'Z')) : new Date()
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const [when,    setWhen]    = React.useState(() => toLocalInput(session?.logged_at))
  const [minutes, setMinutes] = React.useState(() =>
    String(Math.max(0, Math.round((session?.duration_sec || 0) / 60))))
  const [creatorIds, setCreatorIds] = React.useState(() => (session?.creator_ids || []).map(Number))
  const [creatorSearch, setCreatorSearch] = React.useState('')
  const [busy,    setBusy]    = React.useState(false)

  const selectedCreators = allCreators.filter(c => creatorIds.includes(Number(c.id)))
  const creatorMatches = allCreators
    .filter(c => !creatorIds.includes(Number(c.id)))
    .filter(c => !creatorSearch.trim() || c.name.toLowerCase().includes(creatorSearch.trim().toLowerCase()))
    .slice(0, 40)

  const save = async () => {
    if (busy) return
    const mins = Math.max(0, parseInt(minutes || '0', 10) || 0)
    // The datetime-local value is local time; the API stores naive UTC.
    const loggedAt = new Date(when).toISOString().replace('Z', '')
    setBusy(true)
    try {
      if (isEdit) {
        // Removing creators can delete sibling rows. Use the IDs returned by
        // the reconciliation endpoint so we never PATCH rows that no longer
        // exist (which used to turn a successful edit into a false error).
        const grouped = await sessionsApi.updateGroup({ session_ids: session.ids, creator_ids: creatorIds })
        const savedIds = grouped.data?.session_ids?.map(Number).filter(Boolean)
          || session.ids
        const durationId = session.durationId && savedIds.includes(session.durationId)
          ? session.durationId
          : savedIds[0]
        await sessionsApi.update(durationId, {
          duration_sec: mins * 60,
          logged_at: loggedAt,
        })
        // Sibling rows of a playlist session share the timestamp — moving
        // only one would split the group into two entries in the history.
        for (const id of savedIds) {
          if (id === durationId) continue
          await sessionsApi.update(id, { logged_at: loggedAt })
        }
        toast.success(t('Session updated'))
      } else {
        await sessionsApi.log({
          duration_sec: mins * 60,
          logged_at: loggedAt,
          creator_ids: creatorIds,
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
    <ModalLayer><div
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
          <div>
            <label htmlFor="ses-creator-search" style={{ display: 'block', fontSize: 16, marginBottom: 7, color: 'rgba(255,255,255,0.4)' }}>
              {t('Credit this session to creator(s)')} <span style={{ color: 'rgba(255,255,255,0.25)' }}>{t('(optional)')}</span>
            </label>
            {selectedCreators.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {selectedCreators.map(creator => (
                  <button
                    key={creator.id}
                    type="button"
                    onClick={() => setCreatorIds(current => current.filter(id => id !== Number(creator.id)))}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '5px 9px', borderRadius: 999, cursor: 'pointer',
                      fontSize: 16, color: 'var(--c-accent-text)',
                      background: 'var(--c-accent-fill)', border: '1px solid var(--c-accent-line)',
                    }}
                    title={t('Remove creator')}
                  >
                    {creator.name} <X size={13} />
                  </button>
                ))}
              </div>
            )}
            <input
              id="ses-creator-search"
              value={creatorSearch}
              onChange={e => setCreatorSearch(e.target.value)}
              placeholder={t('Search creators to add…')}
              style={fieldStyle}
            />
            {creatorSearch.trim() && (
              <div style={{
                marginTop: 6, maxHeight: 168, overflowY: 'auto',
                border: '1px solid var(--c-accent-line)', borderRadius: 9,
                background: 'var(--c-card)', overscrollBehavior: 'contain',
              }}>
                {creatorMatches.length === 0
                  ? <div style={{ padding: '9px 12px', color: 'rgba(255,255,255,0.35)', fontSize: 16 }}>{t('No creators found')}</div>
                  : creatorMatches.map(creator => (
                    <button
                      key={creator.id}
                      type="button"
                      onClick={() => { setCreatorIds(current => [...current, Number(creator.id)]); setCreatorSearch('') }}
                      style={{
                        display: 'flex', width: '100%', alignItems: 'center', gap: 8,
                        padding: '8px 12px', textAlign: 'left', cursor: 'pointer',
                        color: 'rgba(255,255,255,0.8)', background: 'transparent',
                        border: 0, borderBottom: '1px solid rgba(255,255,255,0.06)',
                        fontSize: 16,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--c-accent-fill)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                    >
                      <span style={{ color: 'var(--c-accent-text)' }}>+</span>{creator.name}
                    </button>
                  ))}
              </div>
            )}
            {creatorIds.length === 0 && (
              <div style={{ marginTop: 6, fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>{t('No creator credited')}</div>
            )}
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
    </div></ModalLayer>
  )
}

export function Stats() {
  // Overview owns the current/lifetime snapshot. Analytics owns changes over
  // time, and Collection History owns the archive's long view.
  const [statsTab, setStatsTab] = React.useState('overview')
  const addXpToast     = useVaultStore(s => s.addXpToast)
  const sessionActive  = useVaultStore(s => s.sessionActive)
  const { startSession, finishSession } = useSession()
  const sessionTotalMs = useVaultStore(s => s.sessionTotalMs)
  const profile        = useVaultStore(s => s.profile)
  const locale         = useVaultStore(s => s.locale)
  const accent         = useVaultStore(s => s.accent)
  const t = useT()
  const accentRgb      = React.useMemo(() => {
    const m = accent?.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
    return m ? `${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)}` : '127,119,221'
  }, [accent])
  const qc = useQueryClient()

  const { data: stats } = useQuery({
    queryKey: ['ses-stats', new Date().getTimezoneOffset()],
    queryFn: () => sessionsApi.stats({ timezone_offset: new Date().getTimezoneOffset() }).then(r => r.data),
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

  // Level progress (100-level quadratic curve)
  const lvl       = profile?.level ?? 1
  const totalXp   = profile?.total_xp ?? 0
  const lvlColor  = getLevelColor(lvl)
  const curThresh = xpForLevel(lvl)
  const nextThresh = xpForLevel(lvl + 1)
  const lvlPct    = lvl >= 100 ? 100 : Math.min(100, ((totalXp - curThresh) / (nextThresh - curThresh)) * 100)
  const xpToNext  = Math.max(0, nextThresh - totalXp)

  const totalViewFmt   = fmtSeconds(stats?.total_view_seconds)
  const totalCount     = stats?.total ?? 0

  return (
    <div className="vault-stats-page p-5 flex flex-col gap-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-[21px] font-medium text-[rgba(255,255,255,0.9)]">{t('Stats')}</div>
        <button onClick={handleSession}
                className="flex items-center gap-1.5 font-medium px-5 py-2.5 rounded-full cursor-pointer transition-all"
                style={{ fontSize: 17, ...(sessionActive
                  ? { background: 'var(--c-pink-fill)', color: 'var(--c-pink-text)', border: '1px solid var(--c-pink-line)', boxShadow: '0 0 12px color-mix(in srgb, var(--c-pink) 40%, transparent)' }
                  : { background: 'color-mix(in srgb, var(--c-pink) 20%, transparent)', color: 'var(--c-pink-text)', border: '0.5px solid var(--c-pink-line)' }) }}>
          ❤️ {sessionActive ? t('End session') : t('Start session')}
        </button>
      </div>

      {/* Each tab now has one clear job. */}
      <div className="flex items-center gap-2">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'analytics', label: 'Analytics' },
          { id: 'almanac',  label: 'Collection History' },
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

      {statsTab === 'almanac' && <Almanac />}
      {statsTab === 'analytics' && <AnalyticsDashboard />}
      {statsTab === 'overview' && (<>

      {/* Wrapped Hero Banner — split with world map */}
      <div className="flex gap-4" style={{ alignItems: 'stretch' }}>
        {/* Left: session stats */}
        {totalCount > 0 && (
          <div className="flex-1 rounded-[14px] relative overflow-hidden"
               style={{ background: `linear-gradient(135deg, rgba(${accentRgb},0.14) 0%, var(--c-bg) 55%, rgba(${accentRgb},0.07) 100%)`, border: '0.5px solid color-mix(in srgb, var(--c-accent) 25%, transparent)', padding: '28px 32px' }}>
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
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-pink-text)' }}>{stats.total_cum_count.toLocaleString()} 💦</div>
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
                if (d < 7) return dt.toLocaleDateString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', { weekday: 'short' })
                if (d < 30) return t('{count}d ago', { count: d })
                return dt.toLocaleDateString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })
              }
              const visible = groups.slice(0, 6)
              return (
                <div style={{ marginTop: 22, borderTop: '0.5px solid rgba(255,255,255,0.07)', paddingTop: 16 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>{t('Recent sessions')}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {visible.map((g, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '7px 0',
                        borderBottom: i < visible.length - 1 ? '0.5px solid rgba(255,255,255,0.05)' : 'none',
                      }}>
                        <span style={{ fontSize: 16, flexShrink: 0, opacity: 0.5 }}>💧</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {g.creators.length > 0 ? g.creators.join(' · ') : (g.gallery_name || t('Unknown'))}
                          </div>
                          {g.gallery_name && g.creators.length > 0 && (
                            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {g.gallery_name}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                          {g.duration_sec > 0 && <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>{fmtDuration(g.duration_sec)}</span>}
                          {g.xp_earned > 0 && <span style={{ fontSize: 16, fontWeight: 700, color: accent }}>+{g.xp_earned} XP</span>}
                          <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.2)', minWidth: 52, textAlign: 'right' }}>{relTime(g.logged_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {(groups.length >= 6 || totalCount > (recentSessions?.length ?? 0)) && (
                    <button
                      onClick={() => setShowSessionsModal(true)}
                      style={{ marginTop: 12, fontSize: 16, color: 'var(--c-accent-text)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 500, opacity: 0.7, transition: 'opacity 0.15s' }}
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
             style={{ width: totalCount > 0 ? '42%' : '100%', flexShrink: 0, background: 'color-mix(in srgb, var(--c-card) 88%, transparent)', border: '0.5px solid var(--c-accent-line)', minHeight: 220 }}
             onClick={() => setShowMapModal(true)}>
          <div className="flex items-center justify-between px-4 pt-3 flex-shrink-0">
            <div className="flex items-center gap-2" style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
              <Globe size={14} style={{ color: accent }} /> {t('Creator Origins')}
            </div>
            {(byCountry || []).length > 0 && (
              <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>
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
                        <div style={{ fontSize: 16, fontWeight: 700, color: d.xp > 0 ? 'var(--c-accent-text)' : 'transparent', flexShrink: 0, lineHeight: 1.2 }}>
                          {d.xp > 0 ? d.xp.toLocaleString() : '0'}
                        </div>
                        {/* bar area — grows to fill; bar rises from the bottom */}
                        <div className="flex-1 w-full flex flex-col justify-end min-h-0">
                          <div className="w-full rounded-t-[4px] transition-all"
                               style={{ height: d.xp > 0 ? `${Math.max(2, pct * 100)}%` : '2px',
                                        background: d.xp > 0 ? 'linear-gradient(to top, var(--c-accent), var(--c-accent-text))' : 'rgba(255,255,255,0.07)' }} />
                        </div>
                        {/* date label */}
                        <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap', flexShrink: 0 }}>{d.date.slice(5)}</div>
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
                { key: 'actress',   label: 'Actress',   color: 'var(--c-accent-text)' },
                { key: 'custom',    label: 'Model/Other', color: 'rgba(255,255,255,0.45)' },
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
                            <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)', flex: 1 }}>{t(ct.label)}</span>
                            <span style={{ fontSize: 16, fontWeight: 700, color: ct.color }}>{(byType[ct.key] || 0).toLocaleString()}</span>
                            <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)', width: 38, textAlign: 'right' }}>
                              {Math.round(((byType[ct.key] || 0) / Math.max(1, totalPhotos)) * 100)}%
                            </span>
                          </div>
                        ))}
                        {unassigned > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(255,255,255,0.15)', flexShrink: 0 }} />
                            <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)', flex: 1 }}>{t('Unassigned')}</span>
                            <span style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.3)' }}>{unassigned.toLocaleString()}</span>
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
                { key: 'actress',   label: 'Actress',   color: 'var(--c-accent-text)' },
                { key: 'custom',    label: 'Model/Other', color: 'rgba(255,255,255,0.45)' },
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
                { key: 'rare',      label: 'Big Portfolio',    color: 'var(--c-accent-text)' },
                { key: 'uncommon',  label: 'Album',            color: 'var(--c-green)' },
                { key: 'common',    label: 'Snapshot',         color: 'rgba(255,255,255,0.45)' },
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
                    <span style={{ color: 'var(--c-accent-text)', fontWeight: 700, fontSize: 18 }}>{rareAbovePct}%</span> {t('Big Portfolio or above')}
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

      {/* Gamification snapshot stays in Overview; time patterns live in Analytics. */}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
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
                { key: 'celestial', label: 'Celestial', color: 'var(--c-amber-text)' },
                { key: 'relic',     label: 'Relic',     color: 'var(--c-amber)' },
                { key: 'legendary', label: 'Legendary', color: 'var(--c-pink)' },
                { key: 'epic',      label: 'Epic',      color: 'var(--c-accent)' },
                { key: 'rare',      label: 'Rare',      color: 'var(--c-accent-text)' },
                { key: 'uncommon',  label: 'Uncommon',  color: 'var(--c-green)' },
                { key: 'common',    label: 'Core',      color: 'rgba(255,255,255,0.45)' },
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
export function MultiPanel() {
  const t = useT()
  return (
    <div className="p-5 flex items-center justify-center h-full">
      <div className="text-center">
        <div className="text-[rgba(255,255,255,0.3)] text-[14px] mb-2">{t('Playlists')}</div>
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
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[16px]"
               style={{ background: 'color-mix(in srgb, var(--c-green) 15%, transparent)', color: 'var(--c-green-text)', border: '0.5px solid color-mix(in srgb, var(--c-green) 30%, transparent)' }}>
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--c-green)' }} />
            {t('Scanning…')}
          </div>
        )}
        {scanStatus?.running && (
          <button onClick={async () => { await scannerApi.cancel(); qc.invalidateQueries({ queryKey: ['scan-status'] }) }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[16px] cursor-pointer"
                  style={{ background: 'color-mix(in srgb, var(--c-pink) 15%, transparent)', color: '#F4C0D1', border: '0.5px solid color-mix(in srgb, var(--c-pink) 30%, transparent)' }}>
            <X size={10} /> {t('Cancel scan')}
          </button>
        )}
        <button onClick={() => refetch()} className="ml-auto text-[16px] cursor-pointer text-[rgba(255,255,255,0.3)] hover:text-white">
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

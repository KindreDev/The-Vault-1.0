import React from 'react'
import ReactDOM from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Circle, Lock, Target, Trophy, ChevronDown, Zap, Check, X, ScrollText, AlertCircle, Cpu, Download, RefreshCw, ShieldCheck, HardDrive, Globe, Clock, Sparkles, Type, Gauge } from 'lucide-react'
import { gamiApi, sessionsApi, scannerApi, systemApi, creatorsApi, cardsApi, taggerApi, galleriesApi, tasksApi } from '../lib/api'
import { useVaultStore, PALETTES, FONTS } from '../store/vault'
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

// ── World Map component ───────────────────────────────────────────────────────
function WorldMap({ byCountry, compact = false, onCountryClick }) {
  const [tooltip, setTooltip] = React.useState(null)
  const [zoom, setZoom] = React.useState(1)
  const [center, setCenter] = React.useState([0, 20])

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

  const fillColor = (name, count) => {
    if (!count) return 'rgba(255,255,255,0.06)'
    const intensity = Math.min(1, count / maxCount)
    if (intensity < 0.25) return 'rgba(127,119,221,0.35)'
    if (intensity < 0.5)  return 'rgba(127,119,221,0.55)'
    if (intensity < 0.75) return 'rgba(127,119,221,0.75)'
    return '#7F77DD'
  }

  const markers = React.useMemo(() =>
    Object.entries(countryMap).map(([name, item]) => {
      const norm = normalizeCountry(name) || name
      const coords = COUNTRY_COORDS[norm]
      if (!coords) return null
      return { name: norm, coords, count: item.count, creators: item.creators }
    }).filter(Boolean),
  [countryMap])

  return (
    <div className="relative w-full h-full" style={{ minHeight: compact ? 180 : 400 }}>
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale: compact ? 80 : 130 }}
        style={{ width: '100%', height: '100%', background: 'transparent' }}>
        <ZoomableGroup
          zoom={zoom}
          center={center}
          filterZoomEvent={compact ? () => false : (evt) => evt.type !== 'dblclick'}
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
                      default: { fill: fillColor(name, item?.count), stroke: 'rgba(255,255,255,0.08)', strokeWidth: 0.5, outline: 'none' },
                      hover:   { fill: item ? '#CECBF6' : 'rgba(255,255,255,0.12)', stroke: 'rgba(255,255,255,0.2)', strokeWidth: 0.5, outline: 'none', cursor: item ? 'pointer' : 'default' },
                      pressed: { fill: '#7F77DD', outline: 'none' },
                    }}
                    onMouseEnter={() => item && setTooltip({ name, count: item.count, creators: item.creators })}
                    onMouseLeave={() => setTooltip(null)}
                    onClick={() => item && onCountryClick?.(name, item)}
                  />
                )
              })
            }
          </Geographies>

          {!compact && markers.map(m => (
            <Marker key={m.name} coordinates={m.coords}>
              <circle r={Math.min(8, 3 + m.count * 1.5)} fill="#7F77DD" fillOpacity={0.7}
                      stroke="#CECBF6" strokeWidth={1}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={() => setTooltip({ name: m.name, count: m.count, creators: m.creators })}
                      onMouseLeave={() => setTooltip(null)}
                      onClick={() => onCountryClick?.(m.name, { count: m.count, creators: m.creators })} />
            </Marker>
          ))}
        </ZoomableGroup>
      </ComposableMap>

      {tooltip && (
        <div className="absolute top-2 left-2 px-3 py-2 rounded-[8px] pointer-events-none"
             style={{ background: 'rgba(22,22,22,0.95)', border: '0.5px solid rgba(127,119,221,0.4)', zIndex: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)', marginBottom: 3 }}>{tooltip.name}</div>
          <div style={{ fontSize: 14, color: '#CECBF6' }}>{tooltip.count} creator{tooltip.count !== 1 ? 's' : ''}</div>
          {tooltip.creators?.slice(0, 4).map(c => (
            <div key={c.id} style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>{c.name}</div>
          ))}
          {(tooltip.creators?.length ?? 0) > 4 && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>+{tooltip.creators.length - 4} more</div>
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
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center animate-fade-in"
         style={{ background: 'rgba(0,0,0,0.85)' }}
         onClick={onClose}>
      <div className="rounded-[16px] flex flex-col shadow-2xl"
           style={{ width: '72vw', height: '78vh', background: '#141414', border: '0.5px solid rgba(127,119,221,0.35)' }}
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
             style={{ borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 text-[17px] font-medium" style={{ color: 'rgba(255,255,255,0.85)' }}>
            <Globe size={16} style={{ color: '#7F77DD' }} /> Creator World Map
            <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)', fontWeight: 400 }}>
              · {(byCountry || []).reduce((s, c) => s + c.count, 0)} creators across {(byCountry || []).length} countries
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
              <div style={{ fontSize: 14, color: '#7F77DD', marginBottom: 8 }}>{selected.count} creator{selected.count !== 1 ? 's' : ''}</div>
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
  daily:  { label: 'Daily',      color: '#7F77DD', bg: 'rgba(127,119,221,0.1)' },
  weekly: { label: 'Weekly',     color: '#BA7517', bg: 'rgba(186,117,23,0.1)'  },
  boss:   { label: 'Challenge',  color: '#D4537E', bg: 'rgba(212,83,126,0.1)'  },
}

function QuestCard({ quest }) {
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
          <div className="text-[11px] font-medium" style={{ color: ts.color }}>+{quest.xp_reward} XP</div>
          {quest.credit_reward > 0 && (
            <div className="text-[10px] font-medium" style={{ color: '#FAC775' }}>+{quest.credit_reward} 💰</div>
          )}
        </div>
      </div>
    </div>
  )
}

function AchievementCard({ ach }) {
  return (
    <div className="vault-card p-3 flex items-center gap-3" style={{ opacity: ach.unlocked ? 1 : 0.45 }}>
      <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
           style={{ background: ach.unlocked ? 'rgba(127,119,221,0.2)' : 'rgba(255,255,255,0.05)' }}>
        {ach.unlocked
          ? <Trophy size={16} style={{ color: '#CECBF6' }} />
          : <Lock size={14} style={{ color: 'rgba(255,255,255,0.25)' }} />
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-[rgba(255,255,255,0.8)]">{ach.title}</div>
        <div className="text-[10px] text-[rgba(255,255,255,0.35)]">{ach.description}</div>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <div className="text-[11px] font-medium" style={{ color: ach.unlocked ? '#7F77DD' : 'rgba(255,255,255,0.2)' }}>
          +{ach.xp_reward} XP
        </div>
        {ach.credit_reward > 0 && (
          <div className="text-[10px] font-medium" style={{ color: ach.unlocked ? '#FAC775' : 'rgba(255,255,255,0.15)' }}>
            +{ach.credit_reward} 💰
          </div>
        )}
      </div>
    </div>
  )
}

function CompletionRewardPanel({ label, accentColor, accentRgb, textColor, progressPct, done, total, packLabel, packNote, claimable, onClaim, claiming }) {
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
        <span className="text-[12px] font-medium" style={{ color: textColor }}>{label}</span>
        {claimable ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium animate-pulse"
                style={{ background: 'rgba(250,199,117,0.2)', color: '#FAC775' }}>
            🎁 Ready!
          </span>
        ) : alreadyClaimed ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{ background: 'rgba(29,158,117,0.2)', color: '#9FE1CB' }}>
            ✓ Claimed
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
          {inProgress ? 'Complete all for' : claimable ? 'All done! Collect your' : 'Reward collected:'}
        </span>
        <span className="text-[11px] font-semibold" style={{ color: textColor }}>{packLabel}</span>
      </div>
      <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.28)' }}>{packNote}</div>

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
          {claiming ? 'Claiming…' : '🎁 Claim Packs'}
        </button>
      )}
    </div>
  )
}

export function Quests() {
  const qc = useQueryClient()
  const { data: quests }       = useQuery({ queryKey: ['quests'],       queryFn: () => gamiApi.quests().then(r => r.data) })
  const { data: achievements } = useQuery({ queryKey: ['achievements'], queryFn: () => gamiApi.achievements().then(r => r.data) })
  const { data: profile }      = useQuery({ queryKey: ['profile'],      queryFn: () => gamiApi.profile().then(r => r.data) })

  const claimMut = useMutation({
    mutationFn: (type) => gamiApi.claimCompletionBonus(type),
    onSuccess: (_, type) => {
      qc.invalidateQueries({ queryKey: ['profile'] })
      toast.success(type === 'daily' ? '🎴 Claimed 5 Booster Packs!' : '🎴 Claimed 5 Premium Packs!')
    },
    onError: () => toast.error('Could not claim reward'),
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
      <div className="text-[16px] font-medium text-[rgba(255,255,255,0.9)]">Quest board</div>

      {/* ── Row 1: Daily · Weekly · Rewards ─────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-5 items-start">

        {/* Daily */}
        <div className="vault-card p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="text-[13px] font-semibold" style={{ color: '#7F77DD' }}>Daily</div>
              <div className="text-[10px] text-[rgba(255,255,255,0.25)]">resets midnight</div>
            </div>
            <div className="text-[11px] font-medium" style={{ color: dailyDone === daily.length && daily.length > 0 ? '#9FE1CB' : 'rgba(255,255,255,0.3)' }}>
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
              <div className="text-[13px] font-semibold" style={{ color: '#BA7517' }}>Weekly</div>
              <div className="text-[10px] text-[rgba(255,255,255,0.25)]">resets Monday</div>
            </div>
            <div className="text-[11px] font-medium" style={{ color: weeklyDone === weekly.length && weekly.length > 0 ? '#9FE1CB' : 'rgba(255,255,255,0.3)' }}>
              {weeklyDone}/{weekly.length}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {weekly.map(q => <QuestCard key={q.id} quest={q} />)}
          </div>
        </div>

        {/* Rewards */}
        <div className="vault-card p-4 flex flex-col gap-4">
          <div className="text-[13px] font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>🎁 Completion Rewards</div>

          {/* Daily bonus */}
          <CompletionRewardPanel
            label="Daily sweep"
            accentColor="#7F77DD"
            accentRgb="127,119,221"
            textColor="#CECBF6"
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
            accentColor="#BA7517"
            accentRgb="186,117,23"
            textColor="#FAC775"
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
            <div className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>Also earning XP from each quest</div>
            <div className="flex flex-col gap-1">
              {[
                { label: 'Daily quest', xp: '+25–100 XP', color: '#7F77DD' },
                { label: 'Weekly quest', xp: '+50–300 XP', color: '#BA7517' },
                { label: 'Challenge', xp: '+100–500 XP', color: '#D4537E' },
              ].map(r => (
                <div key={r.label} className="flex items-center justify-between">
                  <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{r.label}</span>
                  <span className="text-[10px] font-semibold" style={{ color: r.color }}>{r.xp}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Row 2: Challenges ────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="text-[13px] font-semibold" style={{ color: '#D4537E' }}>⚔ Challenges</div>
          <div className="text-[10px] text-[rgba(255,255,255,0.25)]">permanent · no expiry</div>
          <div className="text-[11px] ml-auto" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {boss.filter(q => q.status === 'completed').length}/{boss.length} completed
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {boss.map(q => <QuestCard key={q.id} quest={q} />)}
        </div>
      </div>

      {/* ── Achievements ─────────────────────────────────────────────────────── */}
      <div>
        <div className="text-[13px] font-medium text-[rgba(255,255,255,0.7)] mb-3">Achievements</div>
        <div className="grid grid-cols-2 gap-2">
          {(achievements ?? []).map(a => <AchievementCard key={a.id} ach={a} />)}
        </div>
      </div>
    </div>
  )
}

const PERSONALITY = [
  { test: h => h >= 0  && h < 5,  label: 'Night Owl',         emoji: '🦉', desc: 'You come alive after midnight. Most active in the dead of night.',        color: '#9F99E8' },
  { test: h => h >= 5  && h < 9,  label: 'Early Bird',        emoji: '🌅', desc: 'Up with the sun and already deep in the vault.',                           color: '#BA7517' },
  { test: h => h >= 9  && h < 13, label: 'Morning Lurker',    emoji: '☕', desc: 'Coffee in one hand, the vault in the other.',                              color: '#FAC775' },
  { test: h => h >= 13 && h < 17, label: 'Afternoon Delight', emoji: '☀️', desc: 'Peak hours fall right in the afternoon. Classic.',                         color: '#1D9E75' },
  { test: h => h >= 17 && h < 21, label: 'Evening Gooner',    emoji: '🌆', desc: 'After work, the real work begins. You know what you came home for.',       color: '#D4537E' },
  { test: h => h >= 21,           label: 'Midnight Lurker',   emoji: '🌙', desc: 'Late night sessions are your specialty. The vault never sleeps, and neither do you.', color: '#7F77DD' },
]

function fmtSeconds(sec) {
  if (!sec || sec < 60) return null
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function CreatorBar({ name, value, maxVal, label, color = '#D4537E', gradientEnd = '#F47AA0', rank }) {
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
  if (lvl >= 51) return '#BA7517'
  if (lvl >= 41) return '#D4537E'
  if (lvl >= 31) return '#7F77DD'
  if (lvl >= 21) return '#378ADD'
  if (lvl >= 11) return '#1D9E75'
  return '#888780'
}

// ── Sessions history modal ────────────────────────────────────────────────────
function SessionsModal({ onClose }) {
  const { data: allSessions } = useQuery({
    queryKey: ['all-sessions'],
    queryFn: () => sessionsApi.list({ limit: 500 }).then(r => r.data),
  })

  // Entrance animation — mount with scale/opacity then transition in
  const [visible, setVisible] = React.useState(false)
  React.useEffect(() => { const id = requestAnimationFrame(() => setVisible(true)); return () => cancelAnimationFrame(id) }, [])

  const groups = React.useMemo(() => {
    if (!allSessions?.length) return []
    const result = []
    let cur = null
    for (const s of allSessions) {
      const t = new Date(s.logged_at + (s.logged_at.endsWith('Z') ? '' : 'Z')).getTime()
      if (!cur || Math.abs(t - cur.refTime) > 5000) {
        cur = { refTime: t, logged_at: s.logged_at, creators: s.creator_name ? [s.creator_name] : [], gallery_name: s.gallery_name, duration_sec: s.duration_sec }
        result.push(cur)
      } else {
        if (s.creator_name && !cur.creators.includes(s.creator_name)) cur.creators.push(s.creator_name)
        if (!cur.duration_sec && s.duration_sec) cur.duration_sec = s.duration_sec
      }
    }
    return result
  }, [allSessions])

  const [expanded,    setExpanded]    = React.useState(new Set())
  const [hoveredRow,  setHoveredRow]  = React.useState(null)
  const [hoveredMore, setHoveredMore] = React.useState(null)

  const toggle = (i) => setExpanded(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })

  const relTime = (ts) => {
    const t = new Date(ts + (ts.endsWith('Z') ? '' : 'Z'))
    const d = Math.floor((Date.now() - t.getTime()) / 86400000)
    if (d === 0) return 'Today'
    if (d === 1) return 'Yesterday'
    if (d < 7) return t.toLocaleDateString('en-US', { weekday: 'long' })
    if (d < 30) return `${d} days ago`
    return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const fullDate = (ts) => {
    const t = new Date(ts + (ts.endsWith('Z') ? '' : 'Z'))
    return t.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) +
      ' at ' + t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  const fmtDur = (sec) => {
    if (!sec) return null
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60)
    if (h > 0) return `${h}h ${m}m`
    return m > 0 ? `${m} minute${m !== 1 ? 's' : ''}` : 'less than a minute'
  }

  const creatorSentence = (creators, idx) => {
    if (creators.length === 0) return <span style={{ color: 'rgba(255,255,255,0.4)' }}>an unknown session</span>
    const wrap = (name) => <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>{name}</span>
    if (creators.length === 1) return wrap(creators[0])
    if (creators.length === 2) return <>{wrap(creators[0])} and {wrap(creators[1])}</>
    if (creators.length === 3) return <>{wrap(creators[0])}, {wrap(creators[1])} and {wrap(creators[2])}</>
    const extra = creators.slice(2)
    return (
      <>{wrap(creators[0])}, {wrap(creators[1])} and{' '}
        <span style={{ position: 'relative', display: 'inline-block' }}>
          <span
            style={{
              color: '#D4537E', fontWeight: 700, cursor: 'default',
              borderBottom: '1px dotted rgba(212,83,126,0.5)',
              transition: 'color 0.15s, border-color 0.15s',
            }}
            onMouseEnter={() => setHoveredMore(idx)}
            onMouseLeave={() => setHoveredMore(null)}
          >{extra.length} more</span>
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
          <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>Session History</div>
          <button
            onClick={onClose}
            style={{ color: 'rgba(255,255,255,0.35)', background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, transition: 'color 0.15s, background 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.8)'; e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.35)'; e.currentTarget.style.background = 'transparent' }}
          ><X size={16} /></button>
        </div>

        {/* Scrollable list */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {!allSessions
            ? <div style={{ padding: 24, color: 'rgba(255,255,255,0.3)', fontSize: 16 }}>Loading…</div>
            : groups.length === 0
              ? <div style={{ padding: 24, color: 'rgba(255,255,255,0.3)', fontSize: 16 }}>No sessions logged yet.</div>
              : groups.map((g, i) => {
                  const isOpen    = expanded.has(i)
                  const isHovered = hoveredRow === i
                  const label = g.creators.length > 0
                    ? g.creators.slice(0, 3).join(', ') + (g.creators.length > 3 ? ` +${g.creators.length - 3}` : '')
                    : (g.gallery_name || 'Unknown')
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
                        maxHeight: isOpen ? 120 : 0,
                        opacity: isOpen ? 1 : 0,
                        transition: 'max-height 0.25s ease, opacity 0.2s ease',
                      }}>
                        <div style={{ padding: '2px 24px 14px 52px', fontSize: 16, color: 'rgba(255,255,255,0.45)', lineHeight: 1.7 }}>
                          You gooned to {creatorSentence(g.creators, i)} on{' '}
                          <span style={{ color: 'rgba(255,255,255,0.6)' }}>{fullDate(g.logged_at)}</span>
                          {dur && <>{' '}for <span style={{ color: '#D4537E' }}>{dur}</span></>}.
                        </div>
                      </div>
                    </div>
                  )
                })
          }
        </div>
      </div>
    </div>,
    document.body
  )
}

export function Stats() {
  const addXpToast     = useVaultStore(s => s.addXpToast)
  const sessionActive  = useVaultStore(s => s.sessionActive)
  const startSession   = useVaultStore(s => s.startSession)
  const endSession     = useVaultStore(s => s.endSession)
  const sessionTotalMs = useVaultStore(s => s.sessionTotalMs)
  const profile        = useVaultStore(s => s.profile)
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
      toast.success('Session logged ❤️')
      qc.invalidateQueries({ queryKey: ['ses-stats'] })
    },
  })

  const handleSession = () => {
    if (!sessionActive) {
      startSession()
      toast('Session started 🔥', { icon: '🎯' })
    } else {
      const elapsed = endSession()
      logMutation.mutate({ duration_sec: Math.floor(elapsed / 1000) })
    }
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
    if (intensity < 0.33) return 'rgba(212,83,126,0.3)'
    if (intensity < 0.66) return 'rgba(212,83,126,0.6)'
    return '#D4537E'
  }

  const totalViewFmt   = fmtSeconds(stats?.total_view_seconds)
  const totalCount     = stats?.total ?? 0
  const topByTime      = stats?.top_creators_by_time ?? []
  const maxViewSecs    = Math.max(1, ...topByTime.map(c => c.seconds))
  const topBySessions  = stats?.top_creators_chart ?? []
  const maxSessionCount = Math.max(1, ...topBySessions.map(c => c.count))

  return (
    <div className="p-5 flex flex-col gap-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-[21px] font-medium text-[rgba(255,255,255,0.9)]">Stats</div>
        <button onClick={handleSession}
                className="flex items-center gap-1.5 font-medium px-5 py-2.5 rounded-full cursor-pointer transition-all"
                style={{ fontSize: 17, ...(sessionActive
                  ? { background: 'rgba(212,83,126,0.35)', color: '#FFD4E2', border: '1px solid rgba(212,83,126,0.7)', boxShadow: '0 0 12px rgba(212,83,126,0.4)' }
                  : { background: 'rgba(212,83,126,0.2)', color: '#F4C0D1', border: '0.5px solid rgba(212,83,126,0.35)' }) }}>
          ❤️ {sessionActive ? 'End session' : 'Start session'}
        </button>
      </div>

      {/* Wrapped Hero Banner — split with world map */}
      <div className="flex gap-4" style={{ alignItems: 'stretch' }}>
        {/* Left: session stats */}
        {totalCount > 0 && (
          <div className="flex-1 rounded-[14px] relative overflow-hidden"
               style={{ background: 'linear-gradient(135deg, #1a1030 0%, #0e0e1a 55%, #1a0e18 100%)', border: '0.5px solid rgba(127,119,221,0.25)', padding: '28px 32px' }}>
            {/* Decorative glow */}
            <div style={{ position: 'absolute', top: 0, right: 0, width: 320, height: 320, background: 'radial-gradient(circle, rgba(127,119,221,0.12) 0%, transparent 65%)', transform: 'translate(25%, -25%)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', bottom: 0, left: '30%', width: 200, height: 200, background: 'radial-gradient(circle, rgba(212,83,126,0.08) 0%, transparent 65%)', pointerEvents: 'none' }} />

            <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>Your vault · all time</div>
            <div style={{ fontSize: 58, fontWeight: 900, color: '#fff', lineHeight: 1, letterSpacing: '-0.02em' }}>
              {totalCount.toLocaleString()}
            </div>
            <div style={{ fontSize: 22, fontWeight: 500, color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>
              {totalCount === 1 ? 'session logged' : 'sessions logged'}
            </div>
            <div style={{ display: 'flex', gap: 28, marginTop: 18, flexWrap: 'wrap' }}>
              {stats?.total_duration_sec > 0 && (
                <div>
                  <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Session time</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#D4537E' }}>{fmtDuration(stats.total_duration_sec)}</div>
                </div>
              )}
              {totalViewFmt && (
                <div>
                  <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Time spent viewing</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#7F77DD' }}>{totalViewFmt}</div>
                </div>
              )}
              {stats?.total_cum_count > 0 && (
                <div>
                  <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>All-time count</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#F47AA0' }}>{stats.total_cum_count.toLocaleString()} 💦</div>
                </div>
              )}
              {stats?.top_creator_name && (
                <div>
                  <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Goon Queen</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#CECBF6' }}>{stats.top_creator_name}</div>
                </div>
              )}
            </div>

            {/* Recent sessions — fills the empty space below the stat row */}
            {(recentSessions?.length ?? 0) > 0 && (() => {
              const groups = []
              let cur = null
              for (const s of recentSessions) {
                const t = new Date(s.logged_at + (s.logged_at.endsWith('Z') ? '' : 'Z')).getTime()
                if (!cur || Math.abs(t - cur.refTime) > 5000) {
                  cur = {
                    refTime: t, logged_at: s.logged_at,
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
                const t = new Date(ts + (ts.endsWith('Z') ? '' : 'Z'))
                const d = Math.floor((Date.now() - t.getTime()) / 86400000)
                if (d === 0) return 'Today'
                if (d === 1) return 'Yesterday'
                if (d < 7) return t.toLocaleDateString('en-US', { weekday: 'short' })
                if (d < 30) return `${d}d ago`
                return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              }
              const visible = groups.slice(0, 6)
              return (
                <div style={{ marginTop: 22, borderTop: '0.5px solid rgba(255,255,255,0.07)', paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>Recent sessions</div>
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
                            {g.creators.length > 0 ? g.creators.join(' · ') : (g.gallery_name || 'Unknown')}
                          </div>
                          {g.gallery_name && g.creators.length > 0 && (
                            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {g.gallery_name}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                          {g.duration_sec > 0 && <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>{fmtDuration(g.duration_sec)}</span>}
                          {g.xp_earned > 0 && <span style={{ fontSize: 16, fontWeight: 700, color: '#7F77DD' }}>+{g.xp_earned} XP</span>}
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
                      See more →
                    </button>
                  )}
                </div>
              )
            })()}
          </div>
        )}

        {/* Right: world map */}
        <div className="rounded-[14px] flex flex-col overflow-hidden cursor-pointer"
             style={{ width: totalCount > 0 ? '42%' : '100%', flexShrink: 0, background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(127,119,221,0.2)', minHeight: 220 }}
             onClick={() => setShowMapModal(true)}>
          <div className="flex items-center justify-between px-4 pt-3 flex-shrink-0">
            <div className="flex items-center gap-2" style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
              <Globe size={14} style={{ color: '#7F77DD' }} /> Creator Origins
            </div>
            {(byCountry || []).length > 0 && (
              <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)' }}>
                {(byCountry || []).length} countries · click to explore
              </span>
            )}
          </div>
          <div className="flex-1" style={{ minHeight: 170 }}>
            {(byCountry || []).length === 0 ? (
              <div className="flex items-center justify-center h-full" style={{ fontSize: 16, color: 'rgba(255,255,255,0.2)' }}>
                No country data yet — add it to creator profiles
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
          { label: 'Sessions total',     value: totalCount,                                       color: '#D4537E' },
          { label: 'This week',          value: stats?.this_week ?? 0 },
          { label: 'Session time',       value: fmtDuration(stats?.total_duration_sec),            color: '#D4537E' },
          { label: 'Avg session',        value: fmtDuration(stats?.avg_duration_sec) },
          { label: 'Viewing time',       value: totalViewFmt ?? '—',                              color: '#7F77DD' },
          { label: 'Cummed (all-time)',   value: (stats?.total_cum_count ?? 0).toLocaleString(),   color: '#F47AA0' },
          { label: 'Peak hour',          value: fmtHour(stats?.peak_hour) },
          { label: 'XP from sessions',   value: `${(totalCount * 25).toLocaleString()} XP` },
        ].map(s => (
          <div key={s.label} className="rounded-[10px] p-4" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <div style={{ fontSize: 24, fontWeight: 600, color: s.color || 'rgba(255,255,255,0.9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.value}</div>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Personality card */}
      {personality && (
        <div className="vault-card p-5 flex items-center gap-5">
          <div style={{ fontSize: 44, lineHeight: 1, flexShrink: 0 }}>{personality.emoji}</div>
          <div className="flex-1 min-w-0">
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 5 }}>Your gooning style</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: personality.color, marginBottom: 4 }}>{personality.label}</div>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>{personality.desc}</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Peak hour</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: personality.color }}>{fmtHour(stats?.peak_hour)}</div>
          </div>
        </div>
      )}

      {/* Session chart + Hourly distribution */}
      <div className="flex gap-4 flex-wrap">
        {byDay.length > 0 && (
          <div className="vault-card p-5 flex-1" style={{ minWidth: 300 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.09em' }}>Sessions · last 7 days</div>
            <div className="flex items-end gap-3" style={{ height: 160 }}>
              {byDay.map(d => {
                const pct = d.count / maxDay
                return (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <div style={{ fontSize: 16, fontWeight: 700, color: d.count > 0 ? '#D4537E' : 'transparent' }}>{d.count}</div>
                    <div className="w-full rounded-t-[4px] transition-all"
                         style={{ height: `${Math.max(4, pct * 110)}px`, background: d.count > 0 ? 'linear-gradient(to top, #D4537E, #F47AA0)' : 'rgba(255,255,255,0.07)' }} />
                    <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)', whiteSpace: 'nowrap' }}>{d.date.slice(5)}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {byHour.some(h => h.count > 0) && (
          <div className="vault-card p-5 flex-1" style={{ minWidth: 300 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.09em' }}>Activity by hour</div>
            <div className="flex items-end gap-px" style={{ height: 160 }}>
              {byHour.map(d => {
                const pct = d.count / maxHour
                const isAM = d.hour < 12
                return (
                  <div key={d.hour} className="flex-1 flex flex-col items-center min-w-0" style={{ gap: 3 }}>
                    <div className="w-full rounded-t-[2px]"
                         style={{ height: `${Math.max(2, pct * 110)}px`, background: d.count > 0 ? (isAM ? 'rgba(186,117,23,0.85)' : 'rgba(127,119,221,0.85)') : 'rgba(255,255,255,0.06)' }} />
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
              <span style={{ fontSize: 16, color: 'rgba(186,117,23,0.8)' }}>■ AM</span>
              <span style={{ fontSize: 16, color: 'rgba(127,119,221,0.8)' }}>■ PM</span>
            </div>
          </div>
        )}
      </div>

      {/* Top creators by time spent */}
      {topByTime.length > 0 && (
        <div className="vault-card p-5">
          <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginBottom: 18, textTransform: 'uppercase', letterSpacing: '0.09em' }}>Top creators · time spent</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {topByTime.map((c, i) => (
              <CreatorBar key={c.name} rank={i + 1} name={c.name}
                value={c.seconds} maxVal={maxViewSecs}
                label={fmtSeconds(c.seconds) ?? '<1m'}
                color="#7F77DD" gradientEnd="#CECBF6" />
            ))}
          </div>
        </div>
      )}

      {/* Top creators by sessions */}
      {topBySessions.length > 0 && (
        <div className="vault-card p-5">
          <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginBottom: 18, textTransform: 'uppercase', letterSpacing: '0.09em' }}>Top creators · session count</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {topBySessions.map((c, i) => (
              <CreatorBar key={c.name} rank={i + 1} name={c.name}
                value={c.count} maxVal={maxSessionCount}
                label={String(c.count)}
                color="#D4537E" gradientEnd="#F47AA0" />
            ))}
          </div>
        </div>
      )}

      {/* Row: XP chart (left) · 2×2 grid of mini stats (right) */}
      {(stats?.xp_by_day ?? []).some(d => d.xp > 0) && (
        <div className="flex gap-4" style={{ alignItems: 'stretch' }}>

          {/* XP bar chart — flex-col so bars fill the full card height */}
          <div className="vault-card p-5 flex flex-col" style={{ width: '42%', flexShrink: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.09em', flexShrink: 0 }}>XP earned · last 7 days</div>
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
                        <div style={{ fontSize: 13, fontWeight: 700, color: d.xp > 0 ? 'var(--accent, #7F77DD)' : 'transparent', flexShrink: 0, lineHeight: 1.2 }}>
                          {d.xp > 0 ? d.xp.toLocaleString() : '0'}
                        </div>
                        {/* bar area — grows to fill; bar rises from the bottom */}
                        <div className="flex-1 w-full flex flex-col justify-end min-h-0">
                          <div className="w-full rounded-t-[4px] transition-all"
                               style={{ height: d.xp > 0 ? `${Math.max(2, pct * 100)}%` : '2px',
                                        background: d.xp > 0 ? 'linear-gradient(to top, var(--accent, #7F77DD), #CECBF6)' : 'rgba(255,255,255,0.07)' }} />
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
              <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.09em' }}>Level</div>
              <div className="flex items-center gap-3 flex-1">
                <div style={{ fontSize: 52, fontWeight: 900, lineHeight: 1, color: lvlColor, letterSpacing: '-0.04em', textShadow: `0 0 28px ${lvlColor}44`, flexShrink: 0 }}>{lvl}</div>
                <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                  <div style={{ fontSize: 16, fontWeight: 600, color: lvlColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile?.selected_title || profile?.level_title || '—'}</div>
                  <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 99, width: `${lvlPct}%`, background: `linear-gradient(to right, ${lvlColor}88, ${lvlColor})`, transition: 'width 0.6s ease' }} />
                  </div>
                  <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.22)' }}>
                    {lvl < 100 ? <><span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>{xpToNext.toLocaleString()} XP</span> to next</> : '✓ MAX LEVEL'}
                  </div>
                </div>
              </div>
            </div>

            {/* Photo library — distribution by creator type */}
            {(() => {
              const byType = vaultStats?.images_by_creator_type ?? {}
              const totalPhotos = vaultStats?.total_images ?? 0
              const TYPE_META = [
                { key: 'cosplayer', label: 'Cosplayer', color: '#1D9E75' },
                { key: 'ethot',     label: 'E-girl',    color: '#D4537E' },
                { key: 'artist',    label: 'Artist',    color: '#7F77DD' },
                { key: 'character', label: 'Character', color: '#BA7517' },
                { key: 'actress',   label: 'Actress',   color: '#378ADD' },
                { key: 'custom',    label: 'Model/Other', color: '#888780' },
              ]
              const entries = TYPE_META.filter(t => (byType[t.key] || 0) > 0)
              const unassigned = totalPhotos - entries.reduce((s, t) => s + (byType[t.key] || 0), 0)
              return (
                <div className="vault-card p-4 flex flex-col gap-3">
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>Photo library</div>
                  <div className="flex items-baseline gap-2">
                    <span style={{ fontSize: 40, fontWeight: 900, lineHeight: 1, color: '#7F77DD', letterSpacing: '-0.03em' }}>{totalPhotos.toLocaleString()}</span>
                    <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>photos</span>
                    {(vaultStats?.total_videos ?? 0) > 0 && <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)' }}>· {vaultStats.total_videos.toLocaleString()} videos</span>}
                  </div>
                  {entries.length > 0 && (
                    <>
                      {/* Stacked bar */}
                      <div style={{ height: 8, borderRadius: 99, overflow: 'hidden', display: 'flex' }}>
                        {entries.map(t => (
                          <div key={t.key} title={`${t.label}: ${byType[t.key]}`}
                               style={{ width: `${((byType[t.key] || 0) / Math.max(1, totalPhotos)) * 100}%`, background: t.color }} />
                        ))}
                        {unassigned > 0 && (
                          <div style={{ flex: 1, background: 'rgba(255,255,255,0.06)' }} title={`Unassigned: ${unassigned}`} />
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {entries.map(t => (
                          <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 8, height: 8, borderRadius: 2, background: t.color, flexShrink: 0 }} />
                            <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.55)', flex: 1 }}>{t.label}</span>
                            <span style={{ fontSize: 15, fontWeight: 700, color: t.color }}>{(byType[t.key] || 0).toLocaleString()}</span>
                            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)', width: 38, textAlign: 'right' }}>
                              {Math.round(((byType[t.key] || 0) / Math.max(1, totalPhotos)) * 100)}%
                            </span>
                          </div>
                        ))}
                        {unassigned > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(255,255,255,0.15)', flexShrink: 0 }} />
                            <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.3)', flex: 1 }}>Unassigned</span>
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
                { key: 'cosplayer', label: 'Cosplayer', color: '#1D9E75' },
                { key: 'ethot',     label: 'E-girl',    color: '#D4537E' },
                { key: 'artist',    label: 'Artist',    color: '#7F77DD' },
                { key: 'character', label: 'Character', color: '#BA7517' },
                { key: 'actress',   label: 'Actress',   color: '#378ADD' },
                { key: 'custom',    label: 'Model/Other', color: '#888780' },
              ]
              const entries = TYPE_META.filter(t => (dist[t.key] || 0) > 0)
              return (
                <div className="vault-card p-4 flex flex-col" style={{ gridColumn: 'span 1' }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.09em' }}>Creator types</div>
                  {/* Stacked bar */}
                  <div style={{ height: 10, borderRadius: 99, overflow: 'hidden', display: 'flex', marginBottom: 10 }}>
                    {entries.map(t => (
                      <div key={t.key} style={{ width: `${((dist[t.key] || 0) / total) * 100}%`, background: t.color, transition: 'width 0.4s ease' }} />
                    ))}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {entries.map(t => (
                      <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: t.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)', flex: 1 }}>{t.label}</span>
                        <span style={{ fontSize: 16, fontWeight: 700, color: t.color }}>{dist[t.key] || 0}</span>
                        <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)', width: 38, textAlign: 'right' }}>{Math.round(((dist[t.key] || 0) / total) * 100)}%</span>
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
                { key: 'celestial', label: 'Celestial', color: '#EDD87A' },
                { key: 'relic',     label: 'Relic',     color: '#BA7517' },
                { key: 'legendary', label: 'Legendary', color: '#D4537E' },
                { key: 'epic',      label: 'Epic',      color: '#7F77DD' },
                { key: 'rare',      label: 'Rare',      color: '#378ADD' },
                { key: 'uncommon',  label: 'Uncommon',  color: '#1D9E75' },
                { key: 'common',    label: 'Common',    color: '#888780' },
              ]
              const rareAndAbove = ['celestial','relic','legendary','epic'].reduce((s, k) => s + (dist[k] || 0), 0)
              const rareAbovePct = Math.round((rareAndAbove / total) * 100)
              return (
                <div className="vault-card p-4 flex flex-col">
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.09em' }}>Collection rarity</div>
                  {/* Stacked bar */}
                  <div style={{ height: 10, borderRadius: 99, overflow: 'hidden', display: 'flex', marginBottom: 8 }}>
                    {RARITY_META.filter(r => (dist[r.key] || 0) > 0).map(r => (
                      <div key={r.key} style={{ width: `${((dist[r.key] || 0) / total) * 100}%`, background: r.color }} />
                    ))}
                  </div>
                  <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)', marginBottom: 8 }}>
                    <span style={{ color: '#7F77DD', fontWeight: 700, fontSize: 18 }}>{rareAbovePct}%</span> epic or above
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                    {RARITY_META.filter(r => (dist[r.key] || 0) > 0).map(r => (
                      <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 1, background: r.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>{r.label} <span style={{ color: r.color, fontWeight: 700 }}>{dist[r.key]}</span></span>
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
            <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.09em' }}>Activity · last 13 weeks</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(13, 1fr)', gridTemplateRows: 'repeat(7, 1fr)', gridAutoFlow: 'column', gap: 4, flex: 1 }}>
              {heatmapCells.map((cell) => (
                <div key={cell.date}
                     title={`${cell.date}: ${cell.count} session${cell.count !== 1 ? 's' : ''}`}
                     style={{ borderRadius: 3, background: heatColor(cell.count), cursor: 'default' }} />
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.22)' }}>Less</span>
              {[0, 0.3, 0.6, 1].map(v => (
                <div key={v} style={{ width: 16, height: 16, borderRadius: 3, background: heatColor(v * maxHeat) }} />
              ))}
              <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.22)' }}>More</span>
            </div>
          </div>

          {/* 2×2 grid */}
          <div className="flex-1 grid gap-4" style={{ gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }}>

            {/* Day of week */}
            <div className="vault-card p-4 flex flex-col">
              <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.09em' }}>By day</div>
              <div className="flex items-end gap-1 flex-1" style={{ minHeight: 90 }}>
                {byWeekday.map(d => {
                  const pct = d.count / maxWeekday
                  const color = d.isWeekend ? '#D4537E' : '#7F77DD'
                  const gradEnd = d.isWeekend ? '#F47AA0' : '#CECBF6'
                  return (
                    <div key={d.label} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                      <div className="w-full rounded-t-[3px] transition-all"
                           style={{ height: `${Math.max(3, pct * 70)}px`, background: d.count > 0 ? `linear-gradient(to top, ${color}, ${gradEnd})` : 'rgba(255,255,255,0.07)' }} />
                      <div style={{ fontSize: 16, color: d.isWeekend ? '#D4537E' : 'rgba(255,255,255,0.3)', fontWeight: d.isWeekend ? 600 : 400 }}>{d.label}</div>
                    </div>
                  )
                })}
              </div>
              {byWeekday.some(d => d.count > 0) && (() => {
                const peak = byWeekday.reduce((a, b) => b.count > a.count ? b : a)
                return <div style={{ marginTop: 10, fontSize: 16, color: 'rgba(255,255,255,0.28)' }}>
                  Peak: <span style={{ color: peak.isWeekend ? '#D4537E' : '#CECBF6', fontWeight: 600 }}>{peak.label}s</span>
                </div>
              })()}
            </div>

            {/* AM vs PM */}
            <div className="vault-card p-4 flex flex-col">
              <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.09em' }}>AM vs PM</div>
              <div className="flex items-center gap-4 flex-1">
                <div style={{
                  width: 72, height: 72, borderRadius: '50%', flexShrink: 0,
                  background: `conic-gradient(#BA7517 ${amPct * 3.6}deg, #7F77DD 0deg)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <div style={{ width: 46, height: 46, borderRadius: '50%', background: '#1a1a1a' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 16, color: '#FAC775', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: '#BA7517', display: 'inline-block' }} />AM
                    </span>
                    <span style={{ fontSize: 18, fontWeight: 700, color: '#FAC775' }}>{amPct}%</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 16, color: '#CECBF6', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: '#7F77DD', display: 'inline-block' }} />PM
                    </span>
                    <span style={{ fontSize: 18, fontWeight: 700, color: '#CECBF6' }}>{pmPct}%</span>
                  </div>
                  <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)' }}>
                    {pmPct >= 70 ? 'Night person' : pmPct >= 55 ? 'Mostly evenings' : amPct >= 70 ? 'Early riser' : 'Balanced'}
                  </div>
                </div>
              </div>
            </div>

            {/* Packs opened */}
            <div className="vault-card p-4 flex flex-col justify-between">
              <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>Packs opened</div>
              <div>
                <div style={{ fontSize: 56, fontWeight: 900, lineHeight: 1, color: '#BA7517', letterSpacing: '-0.03em', textShadow: '0 0 28px rgba(186,117,23,0.4)' }}>
                  {(profile?.total_packs_opened ?? 0).toLocaleString()}
                </div>
                <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>
                  {(profile?.total_packs_opened ?? 0) === 0
                    ? 'No packs yet'
                    : (profile?.total_packs_opened ?? 0) >= 50
                      ? '🔥 Pack addict'
                      : (profile?.total_packs_opened ?? 0) >= 10
                        ? 'Pack junkie'
                        : 'Building the stash'}
                </div>
              </div>
              <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.2)' }}>
                ≈ {((profile?.total_packs_opened ?? 0) * 5).toLocaleString()} cards drawn
              </div>
            </div>

            {/* Card rarity distribution (inventory) */}
            {(() => {
              const dist = cardRarityDist?.by_rarity ?? {}
              const total = cardRarityDist?.total || 1
              const RARITY_META = [
                { key: 'celestial', label: 'Celestial', color: '#EDD87A' },
                { key: 'relic',     label: 'Relic',     color: '#BA7517' },
                { key: 'legendary', label: 'Legendary', color: '#D4537E' },
                { key: 'epic',      label: 'Epic',      color: '#7F77DD' },
                { key: 'rare',      label: 'Rare',      color: '#378ADD' },
                { key: 'uncommon',  label: 'Uncommon',  color: '#1D9E75' },
                { key: 'common',    label: 'Common',    color: '#888780' },
              ]
              const entries = RARITY_META.filter(r => (dist[r.key] || 0) > 0)
              const totalOwned = cardRarityDist?.total ?? 0
              return (
                <div className="vault-card p-4 flex flex-col">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                    <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>Card collection</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.6)' }}>{totalOwned.toLocaleString()} cards</div>
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
                            <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)', flex: 1 }}>{r.label}</span>
                            <span style={{ fontSize: 16, fontWeight: 700, color: r.color }}>{dist[r.key] || 0}</span>
                            <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)', width: 38, textAlign: 'right' }}>{Math.round(((dist[r.key] || 0) / total) * 100)}%</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 17, color: 'rgba(255,255,255,0.2)', marginTop: 'auto', marginBottom: 'auto' }}>No cards yet — open a pack!</div>
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
          <div style={{ fontSize: 18, fontWeight: 600, color: 'rgba(255,255,255,0.4)' }}>No sessions yet</div>
          <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)' }}>Start a session to begin tracking your stats.</div>
        </div>
      )}
    </div>
  )
}

export function XPHistory() {
  return (
    <div className="p-5 flex flex-col items-center justify-center" style={{ minHeight: 400 }}>
      <Cpu size={72} style={{ color: '#CECBF6', marginBottom: 28 }} />
      <div style={{ fontSize: 56, fontWeight: 900, color: '#ffffff', letterSpacing: '0.04em', textTransform: 'uppercase', opacity: 1 }}>
        Coming Soon
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#d8d8d8', marginTop: 18, textAlign: 'center', maxWidth: 400, lineHeight: 1.6, opacity: 1 }}>
        Device control via Intiface Central — funscript sync, intensity patterns, and live controls.
      </div>
    </div>
  )
}

// ── GPU Status Panel — detects GPU, offers on-demand DLL download ─────────────
function GpuStatusPanel() {
  const qc = useQueryClient()
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
    onError: (e) => toast.error(e?.response?.data?.detail || 'Download failed'),
  })

  if (isLoading || !gpu) return null

  // GPU ready
  if (gpu.cuda_available) {
    return (
      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium w-fit"
            style={{ background: 'rgba(29,158,117,0.15)', color: '#9FE1CB', border: '0.5px solid rgba(29,158,117,0.35)' }}>
        ⚡ GPU ready (CUDA)
      </span>
    )
  }

  // Download in progress
  if (gpu.running) {
    const pct = gpu.bytes_total > 0 ? Math.round((gpu.bytes_done / gpu.bytes_total) * 100) : null
    const doneMB = Math.round(gpu.bytes_done / (1024 * 1024))
    const totalMB = Math.round(gpu.bytes_total / (1024 * 1024))
    return (
      <div className="rounded-[10px] p-3" style={{ background: 'rgba(127,119,221,0.08)', border: '0.5px solid rgba(127,119,221,0.25)' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-medium" style={{ color: '#CECBF6' }}>
            Downloading GPU support ({gpu.package_index}/{gpu.package_total}) — {gpu.package}
          </span>
          <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {pct !== null ? `${pct}%` : '…'} · {doneMB} / {totalMB} MB
          </span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
          {pct !== null
            ? <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: '#7F77DD' }} />
            : <div className="h-full rounded-full animate-pulse" style={{ width: '100%', background: 'rgba(127,119,221,0.5)' }} />
          }
        </div>
        {gpu.phase === 'extracting' && (
          <div className="text-[10px] mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>Extracting DLLs…</div>
        )}
      </div>
    )
  }

  // Download finished — needs restart to take effect
  if (gpu.phase === 'done' && gpu.dlls_present && !gpu.cuda_available) {
    return (
      <div className="rounded-[10px] p-3 flex items-center justify-between"
           style={{ background: 'rgba(29,158,117,0.1)', border: '0.5px solid rgba(29,158,117,0.3)' }}>
        <span className="text-[11px]" style={{ color: '#9FE1CB' }}>
          ✓ GPU DLLs downloaded — restart the backend to activate GPU
        </span>
      </div>
    )
  }

  // Download error
  if (gpu.phase === 'error') {
    return (
      <div className="rounded-[10px] p-3" style={{ background: 'rgba(212,83,126,0.1)', border: '0.5px solid rgba(212,83,126,0.3)' }}>
        <div className="text-[11px] mb-2" style={{ color: '#F4C0D1' }}>GPU download failed: {gpu.error}</div>
        <button onClick={() => downloadMutation.mutate()}
                className="text-[11px] px-3 py-1 rounded-full cursor-pointer"
                style={{ background: 'rgba(127,119,221,0.2)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.4)' }}>
          Retry
        </button>
      </div>
    )
  }

  // NVIDIA GPU detected but DLLs not present — offer download
  if (gpu.has_nvidia_gpu && !gpu.dlls_present) {
    return (
      <div className="rounded-[10px] p-3" style={{ background: 'rgba(127,119,221,0.08)', border: '0.5px solid rgba(127,119,221,0.2)' }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[12px] font-medium mb-0.5" style={{ color: '#CECBF6' }}>⚡ NVIDIA GPU detected</div>
            <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Download GPU acceleration (~1.6 GB, one-time). Tagging will be dramatically faster.
            </div>
          </div>
          <button
            onClick={() => downloadMutation.mutate()}
            disabled={downloadMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium cursor-pointer flex-shrink-0"
            style={{ background: 'rgba(127,119,221,0.3)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.5)' }}>
            <Download size={11} /> Download GPU support
          </button>
        </div>
      </div>
    )
  }

  // No NVIDIA GPU — CPU only
  return (
    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] w-fit"
          style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
      🖥 CPU only — no NVIDIA GPU detected
    </span>
  )
}


// ── Custom root picker ────────────────────────────────────────────────────────
// Portals the list to document.body so backdrop-filter stacking contexts on
// glass/cyberpunk themes can't clip or z-bury the dropdown.
// A capture-phase scroll listener re-measures on every scroll event so the
// list stays anchored to the button even when <main> or any parent scrolls.
function RootDropdown({ roots, value, onChange }) {
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
    : '— Select a library root —'

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
        — Select a library root —
      </button>
      {roots.map(r => (
        <button
          key={r.id}
          type="button"
          onClick={() => { onChange(String(r.id)); setOpen(false) }}
          className="w-full text-left px-3 py-2 text-[11px] cursor-pointer hover:bg-[rgba(255,255,255,0.07)]"
          style={{ color: String(r.id) === String(value) ? '#CECBF6' : 'rgba(255,255,255,0.75)', background: String(r.id) === String(value) ? 'rgba(127,119,221,0.12)' : 'transparent' }}>
          {r.label ? <><span style={{ color: '#CECBF6' }}>{r.label}</span> <span style={{ color: 'rgba(255,255,255,0.35)' }}>— {r.path}</span></> : r.path}
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

export function Settings() {
  const showGoonBorder    = useVaultStore(s => s.showGoonBorder)
  const setShowGoonBorder = useVaultStore(s => s.setShowGoonBorder)
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
  const [restartState, setRestartState]     = React.useState('idle') // idle | restarting | done
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

  const restorePollRef = React.useRef(null)
  const resetPollRef   = React.useRef(null)
  const restartPollRef = React.useRef(null)

  React.useEffect(() => {
    return () => {
      if (restorePollRef.current) clearInterval(restorePollRef.current)
      if (resetPollRef.current) clearInterval(resetPollRef.current)
      if (restartPollRef.current) clearInterval(restartPollRef.current)
    }
  }, [])

  const { data: configData } = useQuery({
    queryKey: ['system-config'],
    queryFn:  () => systemApi.getConfig().then(r => r.data),
    onSuccess: (d) => { if (!storageInput) setStorageInput(d.data_dir || d.effective_data_dir) },
  })

  const gpuMutation = useMutation({
    mutationFn: (use_gpu) => systemApi.setGpuMode(use_gpu).then(r => r.data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['system-config'] }),
  })

  const { data: startupData } = useQuery({
    queryKey: ['system-startup'],
    queryFn:  () => systemApi.getStartup().then(r => r.data),
  })
  const startupMutation = useMutation({
    mutationFn: (enabled) => systemApi.setStartup(enabled).then(r => r.data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['system-startup'] }),
    onError:    (e) => toast.error(e?.response?.data?.detail || 'Failed to update startup setting'),
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
      const msg = err?.response?.data?.detail || 'Failed to save storage path.'
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
      const msg = err?.response?.data?.detail || 'Restore failed — file may be invalid.'
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
      toast.error('Select a library folder to tag')
      return
    }
    if (tagScope === 'creator' && !tagCreatorId) {
      toast.error('Select a creator to tag')
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
      toast.error(err?.response?.data?.detail || 'Failed to start tagging')
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
      toast.error(err?.response?.data?.detail || 'Download failed')
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
      toast.success('Library folder added!')
    } catch (err) {
      toast.error('Failed to add folder')
    }
  }

  const browseForFolder = async () => {
    try {
      const res = await scannerApi.browseFolder()
      if (res.data?.path) setNewPath(res.data.path)
    } catch (err) {
      toast.error('Could not open folder picker')
    }
  }

  const startScan = async () => {
    try {
      const res = await fetch('/api/scanner/scan', { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.detail || 'Failed to start scan')
        return
      }
      qc.invalidateQueries({ queryKey: ['scan-status'] })
      qc.invalidateQueries({ queryKey: ['task-queue'] })
      toast.success('Scan queued!')
    } catch (err) {
      toast.error('Failed to start scan')
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
      toast.error(err?.response?.data?.detail || 'Failed to start scan')
    } finally {
      setFolderScanning(false)
    }
  }

  return (
    <div className="p-5 flex flex-col gap-6 max-w-2xl" style={{ fontSize: '115%' }}>
      <div className="text-[16px] font-medium text-[rgba(255,255,255,0.9)]">Settings</div>

      {/* Library roots */}
      <div className="vault-card p-5">
        <div className="text-[15px] font-medium text-[rgba(255,255,255,0.8)] mb-4">Library folders</div>
        <div className="text-[13px] text-[rgba(255,255,255,0.4)] mb-4">
          Add folders to scan. Each subfolder becomes a gallery. Works like Stash.
        </div>

        {(() => {
          const allRoots = roots ?? []
          const COLLAPSE_AT = 5
          const visible = (!showAllRoots && allRoots.length > COLLAPSE_AT)
            ? allRoots.slice(0, COLLAPSE_AT)
            : allRoots
          const hidden = allRoots.length - COLLAPSE_AT
          return (
            <>
              {visible.map(r => (
                <div key={r.id} className="flex items-center gap-3 py-2.5 border-b border-[rgba(255,255,255,0.06)]">
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-[rgba(255,255,255,0.75)] truncate">{r.path}</div>
                    {r.label && <div className="text-[10px] text-[rgba(255,255,255,0.35)]">{r.label}</div>}
                  </div>
                  {r.last_scan && (
                    <div className="text-[10px] text-[rgba(255,255,255,0.3)] shrink-0">
                      scanned {new Date(r.last_scan).toLocaleDateString()}
                    </div>
                  )}
                  <button onClick={async () => {
                    await fetch(`/api/scanner/roots/${r.id}`, { method: 'DELETE' })
                    qc.invalidateQueries({ queryKey: ['library-roots'] })
                  }} className="text-[10px] px-2 py-1 rounded cursor-pointer shrink-0"
                          style={{ color: 'rgba(212,83,126,0.7)', background: 'rgba(212,83,126,0.1)' }}>
                    Remove
                  </button>
                </div>
              ))}
              {allRoots.length > COLLAPSE_AT && (
                <button onClick={() => setShowAllRoots(v => !v)}
                        className="mt-1 text-[11px] cursor-pointer"
                        style={{ color: 'rgba(127,119,221,0.7)' }}>
                  {showAllRoots ? '▲ Show less' : `▼ Show ${hidden} more folder${hidden !== 1 ? 's' : ''}…`}
                </button>
              )}
            </>
          )
        })()}

        <div className="flex flex-col gap-2 mt-4">
          {/* Path row with Browse button */}
          <div className="flex gap-2">
            <input value={newPath} onChange={e => setNewPath(e.target.value)}
                   placeholder="C:\Users\You\Pictures\Collection"
                   className="flex-1 bg-transparent rounded-[8px] px-3 py-2 text-[12px] text-[rgba(255,255,255,0.8)] placeholder-[rgba(255,255,255,0.2)]"
                   style={{ border: '0.5px solid rgba(255,255,255,0.12)' }}
                   onKeyDown={e => e.key === 'Enter' && addRoot()} />
            <button onClick={browseForFolder}
                    className="px-3 py-2 rounded-[8px] text-[12px] cursor-pointer whitespace-nowrap"
                    style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.65)', border: '0.5px solid rgba(255,255,255,0.12)' }}>
              📁 Browse
            </button>
          </div>
          {/* Optional label + Add button */}
          <div className="flex gap-2">
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                   placeholder="Label (optional, e.g. Cosplayers)"
                   className="flex-1 bg-transparent rounded-[8px] px-3 py-2 text-[12px] text-[rgba(255,255,255,0.8)] placeholder-[rgba(255,255,255,0.2)]"
                   style={{ border: '0.5px solid rgba(255,255,255,0.12)' }}
                   onKeyDown={e => e.key === 'Enter' && addRoot()} />
            <button onClick={addRoot} disabled={!newPath.trim()}
                    className="px-4 py-2 rounded-[8px] text-[12px] cursor-pointer disabled:opacity-40"
                    style={{ background: 'rgba(127,119,221,0.2)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.3)' }}>
              Add
            </button>
          </div>
        </div>
      </div>

      {/* Scanner */}
      <div className="vault-card p-5">
        <div className="text-[15px] font-medium text-[rgba(255,255,255,0.8)] mb-2">Library scanner</div>
        {scanStatus?.running ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[12px] text-[rgba(255,255,255,0.6)]">{scanStatus.message}</div>
              <button onClick={async () => { await scannerApi.cancel(); qc.invalidateQueries({ queryKey: ['scan-status'] }) }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] cursor-pointer ml-2 flex-shrink-0"
                      style={{ background: 'rgba(212,83,126,0.15)', color: '#F4C0D1', border: '0.5px solid rgba(212,83,126,0.3)' }}>
                <X size={10} /> Cancel
              </button>
            </div>
            <div className="h-1.5 rounded-full bg-[rgba(255,255,255,0.07)] overflow-hidden">
              <div className="h-full rounded-full bg-[#7F77DD] transition-all"
                   style={{ width: `${scanStatus.total ? (scanStatus.progress / scanStatus.total) * 100 : 0}%` }} />
            </div>
            <div className="text-[10px] text-[rgba(255,255,255,0.3)] mt-1">
              {scanStatus.progress} / {scanStatus.total} folders · {scanStatus.new_galleries} new galleries · {scanStatus.new_images} new images
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {scanStatus?.message && scanStatus.message !== 'Idle' && (
              <div className="text-[13px] text-[rgba(255,255,255,0.45)]">{scanStatus.message}</div>
            )}
            <button onClick={startScan}
                    className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-[12px] cursor-pointer w-fit"
                    style={{ background: 'rgba(29,158,117,0.2)', color: '#9FE1CB', border: '0.5px solid rgba(29,158,117,0.3)' }}>
              Scan entire library
            </button>

            {/* Scan specific root */}
            <div className="pt-3 border-t border-[rgba(255,255,255,0.06)]">
              <div className="text-[11px] text-[rgba(255,255,255,0.5)] mb-2">
                Or rescan a single library root
              </div>
              {(roots ?? []).length === 0 ? (
                <div className="text-[13px] text-[rgba(255,255,255,0.25)]">No library folders added yet.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {/* Custom dropdown — stays inside card on all platforms */}
                  <RootDropdown
                    roots={roots ?? []}
                    value={selectedRootId}
                    onChange={setSelectedRootId}
                  />
                  <button onClick={startFolderScan}
                          disabled={!selectedRootId || folderScanning}
                          className="px-4 py-2 rounded-[8px] text-[12px] cursor-pointer disabled:opacity-40 w-fit"
                          style={{ background: 'rgba(127,119,221,0.2)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.3)' }}>
                    {folderScanning ? 'Starting…' : 'Scan selected root'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Regenerate thumbnails ───────────────────────────────── */}
      <div className="vault-card p-5">
        <div className="text-[15px] font-medium text-[rgba(255,255,255,0.8)] mb-1">Regenerate thumbnails</div>
        <div className="text-[13px] text-[rgba(255,255,255,0.35)] mb-4">
          Rebuilds any missing or broken thumbnails across your entire library. Runs in the background.
        </div>
        <button
          disabled={regenning}
          onClick={async () => {
            setRegenning(true)
            try {
              await scannerApi.regenThumbs()
              toast.success('Thumbnail regeneration started!')
            } catch {
              toast.error('Failed to start regeneration')
            } finally {
              setTimeout(() => setRegenning(false), 3000)
            }
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-[12px] cursor-pointer w-fit disabled:opacity-40"
          style={{ background: 'rgba(186,117,23,0.2)', color: '#FAC775', border: '0.5px solid rgba(186,117,23,0.3)' }}>
          {regenning ? 'Starting…' : '🖼️ Regenerate missing thumbnails'}
        </button>
      </div>

      {/* ── AI Auto-Tagging ─────────────────────────────────────── */}
      <div className="vault-card p-5">
        <div className="text-[15px] font-medium text-[rgba(255,255,255,0.8)] mb-1">AI Auto-Tagging</div>
        <div className="text-[13px] text-[rgba(255,255,255,0.35)] mb-4">
          Automatically tag images with body parts, nudity level, clothing, pose, and more.
          WD14 is used for anime/art; JoyTag for cosplay and real photos.
        </div>

        {/* GPU acceleration status */}
        <div className="mb-4"><GpuStatusPanel /></div>

        {/* Model status */}
        <div className="flex flex-col gap-2 mb-4">
          {[
            { key: 'wd14',   label: 'WD14 v3',  desc: 'Anime / art / characters (~200 MB)',          ready: tagModels?.wd14_downloaded,   size: tagModels?.wd14_size_mb },
            { key: 'joytag', label: 'JoyTag',   desc: 'Cosplay / real photos / ethots (~366 MB)',    ready: tagModels?.joytag_downloaded, size: tagModels?.joytag_size_mb },
          ].map(({ key, label, desc, ready, size }) => (
            <div key={key} className="flex items-center justify-between py-2 px-3 rounded-[8px]"
                 style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full flex-shrink-0"
                     style={{ background: ready ? '#1D9E75' : 'rgba(255,255,255,0.2)' }} />
                <div>
                  <div className="text-[13px] font-medium text-[rgba(255,255,255,0.8)]">{label}</div>
                  <div className="text-[11px] text-[rgba(255,255,255,0.35)]">
                    {ready ? `Downloaded · ${size ?? '?'} MB` : desc}
                  </div>
                </div>
              </div>
              {!ready && (
                <button
                  disabled={tagStatus?.running}
                  onClick={() => downloadModel(key)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-[11px] cursor-pointer disabled:opacity-40"
                  style={{ background: 'rgba(127,119,221,0.15)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.3)' }}>
                  <Download size={11} /> Download
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Running state */}
        {tagStatus?.running ? (
          <div>
            {/* Top row: badges + cancel */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                {tagStatus.active_model && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0"
                        style={{ background: tagStatus.active_model === 'WD14' ? 'rgba(55,138,221,0.2)' : tagStatus.active_model === 'JoyTag' ? 'rgba(212,83,126,0.2)' : 'rgba(127,119,221,0.2)',
                                 color:      tagStatus.active_model === 'WD14' ? '#7AB8F5' : tagStatus.active_model === 'JoyTag' ? '#F4C0D1' : '#CECBF6',
                                 border:     `0.5px solid ${tagStatus.active_model === 'WD14' ? 'rgba(55,138,221,0.35)' : tagStatus.active_model === 'JoyTag' ? 'rgba(212,83,126,0.35)' : 'rgba(127,119,221,0.35)'}` }}>
                    <Cpu size={9} /> {tagStatus.active_model}
                  </span>
                )}
                {tagStatus.device && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0"
                        style={{ background: tagStatus.device === 'gpu' ? 'rgba(29,158,117,0.2)' : 'rgba(255,255,255,0.07)',
                                 color:      tagStatus.device === 'gpu' ? '#9FE1CB' : 'rgba(255,255,255,0.4)',
                                 border:     `0.5px solid ${tagStatus.device === 'gpu' ? 'rgba(29,158,117,0.4)' : 'rgba(255,255,255,0.12)'}` }}>
                    {tagStatus.device === 'gpu' ? '⚡ GPU' : '🖥 CPU'}
                  </span>
                )}
                {/* Phase label: downloading vs tagging */}
                {tagStatus.total === 0 ? (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0"
                        style={{ background: 'rgba(186,117,23,0.18)', color: '#FAC775', border: '0.5px solid rgba(186,117,23,0.35)' }}>
                    ⬇ Downloading model
                  </span>
                ) : (
                  <span className="text-[12px] text-[rgba(255,255,255,0.55)] flex-shrink-0">
                    {tagStatus.progress} / {tagStatus.total}
                  </span>
                )}
              </div>
              <button
                onClick={async () => {
                  await taggerApi.cancel()
                  tagRunStartRef.current = null
                  qc.invalidateQueries({ queryKey: ['ai-tag-status'] })
                }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] cursor-pointer ml-2 flex-shrink-0"
                style={{ background: 'rgba(212,83,126,0.15)', color: '#F4C0D1', border: '0.5px solid rgba(212,83,126,0.3)' }}>
                <X size={10} /> Cancel
              </button>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 rounded-full bg-[rgba(255,255,255,0.07)] overflow-hidden">
              {tagStatus.total > 0 ? (() => {
                // Seed / update ETA reference point
                if (!tagRunStartRef.current && tagStatus.progress > 0) {
                  tagRunStartRef.current = { ts: Date.now(), progress: tagStatus.progress }
                }
                const pct = (tagStatus.progress / tagStatus.total) * 100
                return (
                  <div className="h-full rounded-full transition-all"
                       style={{ width: `${pct}%`, background: '#7F77DD' }} />
                )
              })() : (
                <div className="h-full rounded-full"
                     style={{ width: '100%', background: 'linear-gradient(90deg, rgba(186,117,23,0.25) 0%, rgba(186,117,23,0.6) 50%, rgba(186,117,23,0.25) 100%)', animation: 'pulse 1.5s ease-in-out infinite' }} />
              )}
            </div>

            {/* Status line */}
            {tagStatus.total > 0 ? (() => {
              // ETA
              let etaStr = ''
              if (tagRunStartRef.current && tagStatus.progress > tagRunStartRef.current.progress) {
                const elapsed = (Date.now() - tagRunStartRef.current.ts) / 1000
                const done    = tagStatus.progress - tagRunStartRef.current.progress
                const rate    = done / elapsed
                const remaining = (tagStatus.total - tagStatus.progress) / rate
                if (remaining > 0 && remaining < 86400) {
                  if (remaining >= 3600) etaStr = `~${Math.round(remaining / 3600)}h left`
                  else if (remaining >= 60) etaStr = `~${Math.round(remaining / 60)}m left`
                  else etaStr = `~${Math.round(remaining)}s left`
                  tagEtaRef.current = etaStr
                } else if (tagEtaRef.current) {
                  etaStr = tagEtaRef.current
                }
              } else if (tagEtaRef.current) {
                etaStr = tagEtaRef.current
              }
              return (
                <div className="mt-1 flex flex-col gap-0.5">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] text-[rgba(255,255,255,0.3)]">
                      {tagStatus.tagged} tagged · {tagStatus.skipped} skipped
                      {tagStatus.errors > 0 && <span style={{ color: '#F4C0D1' }}> · {tagStatus.errors} errors</span>}
                    </div>
                    {etaStr && <div className="text-[10px]" style={{ color: 'rgba(127,119,221,0.7)' }}>{etaStr}</div>}
                  </div>
                  {tagStatus.current_path && (
                    <div className="text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.2)' }}
                         title={tagStatus.current_path}>
                      {tagStatus.current_path.replace(/.*[\\/]/, '')}
                    </div>
                  )}
                </div>
              )
            })() : (
              <div className="text-[10px] text-[rgba(255,255,255,0.35)] mt-1">{tagStatus.message}</div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {tagStatus?.message && tagStatus.message !== 'Idle' && (
              <div className="text-[13px] text-[rgba(255,255,255,0.45)]">{tagStatus.message}</div>
            )}

            {/* Scope */}
            <div>
              <div className="text-[11px] text-[rgba(255,255,255,0.5)] mb-2">Scope</div>
              <div className="flex gap-2 flex-wrap">
                {[
                  { key: 'library', label: 'Entire library' },
                  { key: 'folder',  label: 'Specific folder' },
                  { key: 'creator', label: 'By creator' },
                ].map(({ key, label }) => (
                  <button key={key} onClick={() => setTagScope(key)}
                          className="px-3 py-1.5 rounded-[6px] text-[11px] cursor-pointer"
                          style={{
                            background: tagScope === key ? 'rgba(127,119,221,0.25)' : 'rgba(255,255,255,0.05)',
                            color:      tagScope === key ? '#CECBF6' : 'rgba(255,255,255,0.5)',
                            border:     `0.5px solid ${tagScope === key ? 'rgba(127,119,221,0.4)' : 'rgba(255,255,255,0.07)'}`,
                          }}>
                    {label}
                  </button>
                ))}
              </div>
              {tagScope === 'folder' && (
                <div className="mt-2">
                  <RootDropdown
                    roots={roots ?? []}
                    value={tagRootId}
                    onChange={setTagRootId}
                  />
                </div>
              )}
              {tagScope === 'creator' && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <input
                    placeholder="Search creators…"
                    value={tagCreatorSearch}
                    onChange={e => { setTagCreatorSearch(e.target.value); setTagCreatorId('') }}
                    className="w-full px-3 py-2 rounded-[8px] text-[12px] outline-none"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)' }}
                  />
                  {tagCreatorId && (() => {
                    const sel = filteredTagCreators.find(c => String(c.id) === String(tagCreatorId))
                              || (allCreators ?? []).find(c => String(c.id) === String(tagCreatorId))
                    return sel ? (
                      <div className="flex items-center justify-between px-3 py-2 rounded-[8px]"
                           style={{ background: 'rgba(127,119,221,0.15)', border: '0.5px solid rgba(127,119,221,0.4)' }}>
                        <span style={{ fontSize: 12, color: '#CECBF6', fontWeight: 600 }}>{sel.name}</span>
                        <button onClick={() => setTagCreatorId('')} className="cursor-pointer" style={{ color: 'rgba(255,255,255,0.35)' }}>
                          <X size={12} />
                        </button>
                      </div>
                    ) : null
                  })()}
                  {!tagCreatorId && filteredTagCreators.length > 0 && (
                    <div className="rounded-[8px] overflow-hidden overflow-y-auto"
                         style={{ background: '#161620', border: '0.5px solid rgba(255,255,255,0.1)', maxHeight: 160 }}>
                      {filteredTagCreators.map(c => (
                        <button key={c.id}
                                onClick={() => { setTagCreatorId(String(c.id)); setTagCreatorSearch('') }}
                                className="w-full text-left px-3 py-2 flex items-center gap-2 cursor-pointer transition-colors"
                                style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, borderBottom: '0.5px solid rgba(255,255,255,0.05)' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(127,119,221,0.12)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: {cosplayer:'#1D9E75',ethot:'#D4537E',artist:'#7F77DD',character:'#BA7517',actress:'#378ADD',custom:'#888780'}[c.creator_type] || '#888780', flexShrink: 0, display: 'inline-block' }} />
                          {c.name}
                          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(255,255,255,0.25)', textTransform: 'capitalize' }}>{c.creator_type}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {!tagCreatorId && filteredTagCreators.length === 0 && tagCreatorSearch && (
                    <div className="px-3 py-2 rounded-[8px] text-[12px]" style={{ color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.03)' }}>No creators found</div>
                  )}
                </div>
              )}
            </div>

            {/* Model override */}
            <div>
              <div className="text-[11px] text-[rgba(255,255,255,0.5)] mb-2">Model</div>
              <div className="flex gap-2">
                {[
                  { key: 'auto',   label: 'Auto',   desc: 'Routes by creator type' },
                  { key: 'wd14',   label: 'WD14',   desc: 'Anime / art / characters', disabled: !tagModels?.wd14_downloaded },
                  { key: 'joytag', label: 'JoyTag', desc: 'Cosplay / real photos',    disabled: !tagModels?.joytag_downloaded },
                ].map(({ key, label, desc, disabled }) => (
                  <button key={key}
                          disabled={disabled}
                          onClick={() => !disabled && setTagModelOverride(key)}
                          className="flex-1 px-2 py-1.5 rounded-[6px] text-[11px] cursor-pointer text-center disabled:opacity-30"
                          style={{
                            background: tagModelOverride === key ? 'rgba(127,119,221,0.25)' : 'rgba(255,255,255,0.05)',
                            color:      tagModelOverride === key ? '#CECBF6' : 'rgba(255,255,255,0.5)',
                            border:     `0.5px solid ${tagModelOverride === key ? 'rgba(127,119,221,0.4)' : 'rgba(255,255,255,0.07)'}`,
                          }}
                          title={disabled ? 'Model not downloaded' : desc}>
                    {label}
                  </button>
                ))}
              </div>
              {tagModelOverride === 'auto' && (
                <div className="text-[10px] text-[rgba(255,255,255,0.25)] mt-1">
                  Galleries with an assigned creator use that creator's type to pick the model. Unassigned → JoyTag (or WD14 fallback).
                </div>
              )}
            </div>

            {/* Confidence threshold */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[11px] text-[rgba(255,255,255,0.5)]">Confidence threshold</div>
                <div className="text-[12px] font-mono" style={{ color: '#CECBF6' }}>{Math.round(tagThreshold * 100)}%</div>
              </div>
              <input type="range" min="10" max="90" step="5"
                     value={Math.round(tagThreshold * 100)}
                     onChange={e => setTagThreshold(Number(e.target.value) / 100)}
                     className="w-full accent-[#7F77DD] cursor-pointer" />
              <div className="flex justify-between text-[10px] text-[rgba(255,255,255,0.25)] mt-0.5">
                <span>More tags (10%)</span><span>Fewer, precise (90%)</span>
              </div>
            </div>

            {/* GPU toggle */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12px] text-[rgba(255,255,255,0.75)]">GPU acceleration (NVIDIA CUDA)</div>
                <div className="text-[10px] text-[rgba(255,255,255,0.3)] mt-0.5">
                  {configData?.use_gpu !== false
                    ? 'ON — using CUDA if available, CPU fallback otherwise'
                    : 'OFF — running on CPU only'}
                </div>
                {configData?.use_gpu === false && (
                  <div className="text-[10px] mt-1" style={{ color: '#BA7517' }}>
                    ⚠ No NVIDIA GPU mode — AI tagging will be slower
                  </div>
                )}
              </div>
              <button
                onClick={() => gpuMutation.mutate(configData?.use_gpu === false ? true : false)}
                disabled={gpuMutation.isPending}
                className="w-10 h-5 rounded-full relative cursor-pointer flex-shrink-0 transition-colors disabled:opacity-50"
                style={{ background: configData?.use_gpu !== false ? 'rgba(127,119,221,0.6)' : 'rgba(255,255,255,0.1)' }}>
                <div className="w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all bg-white"
                     style={{ left: configData?.use_gpu !== false ? 'calc(100% - 17px)' : '3px' }} />
              </button>
            </div>

            {/* Re-tag toggle */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12px] text-[rgba(255,255,255,0.75)]">Re-tag already tagged images</div>
                <div className="text-[10px] text-[rgba(255,255,255,0.3)] mt-0.5">Off = skip images that already have AI tags</div>
              </div>
              <button onClick={() => setTagRetag(!tagRetag)}
                      className="w-10 h-5 rounded-full relative cursor-pointer flex-shrink-0 transition-colors"
                      style={{ background: tagRetag ? 'rgba(127,119,221,0.6)' : 'rgba(255,255,255,0.1)' }}>
                <div className="w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all bg-white"
                     style={{ left: tagRetag ? 'calc(100% - 17px)' : '3px' }} />
              </button>
            </div>

            {aiTaskQueued ? (
              <div className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-[12px] w-fit"
                   style={{ background: 'rgba(127,119,221,0.1)', color: 'rgba(255,255,255,0.45)', border: '0.5px solid rgba(127,119,221,0.2)' }}>
                <Clock size={12} style={{ color: '#7F77DD' }} /> Queued in task queue…
              </div>
            ) : (
              <button
                disabled={tagStarting || (!tagModels?.wd14_downloaded && !tagModels?.joytag_downloaded)}
                onClick={startTagging}
                className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-[12px] cursor-pointer w-fit disabled:opacity-40"
                style={{ background: 'rgba(127,119,221,0.2)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.3)' }}>
                <Cpu size={13} /> {tagStarting ? 'Starting…' : 'Start AI Tagging'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Session mode ────────────────────────────────────────── */}
      <div className="vault-card p-5">
        <div className="text-[15px] font-medium text-[rgba(255,255,255,0.8)] mb-1">Session mode</div>
        <div className="text-[13px] text-[rgba(255,255,255,0.35)] mb-4">
          Controls what happens when you click "Start session" on the dashboard.
        </div>
        <div className="flex items-center justify-between py-2">
          <div>
            <div className="text-[12px] text-[rgba(255,255,255,0.75)]">Neon border effect</div>
            <div className="text-[10px] text-[rgba(255,255,255,0.3)] mt-0.5">Pulsing glow around screen edges during a session</div>
          </div>
          <button
            onClick={() => setShowGoonBorder(!showGoonBorder)}
            className="w-10 h-5 rounded-full relative cursor-pointer flex-shrink-0 transition-colors"
            style={{ background: showGoonBorder ? 'rgba(212,83,126,0.6)' : 'rgba(255,255,255,0.1)' }}>
            <div className="w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all"
                 style={{ background: '#fff', left: showGoonBorder ? 'calc(100% - 17px)' : '3px' }} />
          </button>
        </div>
      </div>

      {/* ── Personalization ─────────────────────────────────────── */}
      <div className="vault-card p-5">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={14} style={{ color: 'var(--c-accent)' }} />
          <div className="text-[15px] font-medium text-[rgba(255,255,255,0.8)]">Personalization</div>
        </div>
        <div className="text-[13px] text-[rgba(255,255,255,0.35)] mb-5">
          Themes, fonts, and visual preferences.
        </div>

        {/* ── Themes ── */}
        <div className="mb-6">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.3)] mb-3">Theme</div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
            {PALETTES.map(p => (
              <button
                key={p.id}
                onClick={() => setPalette(p)}
                className="flex flex-col gap-2 p-3 rounded-[10px] cursor-pointer text-left transition-all"
                style={{
                  background: currentPalette.id === p.id ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${currentPalette.id === p.id ? p.accent : 'rgba(255,255,255,0.08)'}`,
                }}>
                <div className="flex gap-1 items-center">
                  {[p.accent, p.pink, p.amber, p.green].map((c, i) => (
                    <div key={i} className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: c }} />
                  ))}
                  {currentPalette.id === p.id && (
                    <Check size={12} className="ml-auto flex-shrink-0" style={{ color: p.accent }} />
                  )}
                </div>
                <div className="w-full h-1.5 rounded-full"
                     style={{ background: `linear-gradient(to right, ${p.bg}, ${p.card})` }} />
                <div className="text-[11px] font-medium" style={{ color: currentPalette.id === p.id ? p.accent : 'rgba(255,255,255,0.55)' }}>
                  {p.label}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Font ── */}
        <div className="mb-6">
          <div className="flex items-center gap-1.5 mb-3">
            <Type size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.3)]">Font</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {FONTS.map(f => (
              <button
                key={f.id}
                onClick={() => setFont(f)}
                className="px-4 py-2 rounded-[8px] cursor-pointer transition-all text-[13px]"
                style={{
                  fontFamily: f.family,
                  background: currentFont.id === f.id ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${currentFont.id === f.id ? 'var(--c-accent)' : 'rgba(255,255,255,0.08)'}`,
                  color: currentFont.id === f.id ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.45)',
                }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Animation speed ── */}
        <div>
          <div className="flex items-center gap-1.5 mb-3">
            <Gauge size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.3)]">Animations</div>
          </div>
          <div className="flex gap-2">
            {[['full', 'Full'], ['reduced', 'Reduced'], ['off', 'Off']].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setAnimSpeed(val)}
                className="flex-1 py-2 rounded-[8px] text-[12px] cursor-pointer transition-all"
                style={{
                  background: animSpeed === val ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${animSpeed === val ? 'var(--c-accent)' : 'rgba(255,255,255,0.08)'}`,
                  color: animSpeed === val ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)',
                }}>
                {label}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-[rgba(255,255,255,0.2)] mt-2">
            "Off" disables all transitions and animations — useful on low-end hardware.
          </div>
        </div>

        {/* ── Custom vault name ── */}
        <div className="mt-6 pt-5" style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.3)] mb-3">Vault Name</div>
          <div className="flex gap-2">
            <input
              value={vaultNameInput}
              onChange={e => setVaultNameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && setVaultName(vaultNameInput)}
              placeholder="The Vault"
              maxLength={30}
              className="flex-1 px-3 py-2 rounded-[8px] text-[13px] outline-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)' }}
            />
            <button
              onClick={() => setVaultName(vaultNameInput)}
              className="px-4 py-2 rounded-[8px] text-[12px] cursor-pointer"
              style={{ background: 'rgba(127,119,221,0.2)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.4)' }}>
              Save
            </button>
          </div>
          <div className="text-[10px] text-[rgba(255,255,255,0.2)] mt-1.5">Shown in the sidebar. Max 30 characters.</div>
        </div>

        {/* ── Session glow color ── */}
        <div className="mt-6 pt-5" style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.3)] mb-3">Session Border Glow</div>
          <div className="flex gap-2 flex-wrap">
            {[
              { label: 'Pink',   value: 'var(--c-pink)',  swatch: '#D4537E' },
              { label: 'Red',    value: '#FF3333',         swatch: '#FF3333' },
              { label: 'Cyan',   value: '#00DDFF',         swatch: '#00DDFF' },
              { label: 'Violet', value: 'var(--c-accent)', swatch: '#7F77DD' },
              { label: 'White',  value: '#FFFFFF',         swatch: '#FFFFFF' },
              { label: 'Green',  value: 'var(--c-green)',  swatch: '#1D9E75' },
            ].map(opt => (
              <button
                key={opt.label}
                onClick={() => setSessionGlowColor(opt.value)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12px] cursor-pointer transition-all"
                style={{
                  background: sessionGlowColor === opt.value ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${sessionGlowColor === opt.value ? opt.swatch : 'rgba(255,255,255,0.08)'}`,
                  color: sessionGlowColor === opt.value ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.45)',
                }}>
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: opt.swatch }} />
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Glass background ── */}
        {currentPalette.id === 'glass' && (
          <div className="mt-6 pt-5" style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.3)] mb-1">Glass Background Image</div>
            <div className="text-[10px] text-[rgba(255,255,255,0.25)] mb-3">Pick any image from your PC to use as the background behind the glass effect.</div>
            <input
              ref={glassBgFileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = ev => {
                  setGlassBackground(ev.target.result)
                  setGlassBgLabel(file.name)
                  localStorage.setItem('vault_glass_bg_label', file.name)
                }
                reader.readAsDataURL(file)
              }}
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => glassBgFileRef.current?.click()}
                className="px-4 py-2 rounded-[8px] text-[13px] cursor-pointer"
                style={{ background: 'rgba(160,180,208,0.15)', color: '#A0B4D0', border: '0.5px solid rgba(160,180,208,0.35)' }}>
                Browse…
              </button>
              {glassBgLabel
                ? <span className="text-[12px] text-[rgba(255,255,255,0.5)] truncate flex-1">{glassBgLabel}</span>
                : <span className="text-[12px] text-[rgba(255,255,255,0.2)] flex-1">No image selected — using default gradient</span>
              }
            </div>
            {glassBackground && (
              <button
                onClick={() => {
                  setGlassBackground('')
                  setGlassBgLabel('')
                  localStorage.removeItem('vault_glass_bg_label')
                  if (glassBgFileRef.current) glassBgFileRef.current.value = ''
                }}
                className="mt-2 text-[11px] text-[rgba(255,255,255,0.3)] hover:text-[rgba(255,255,255,0.6)] transition-colors">
                Reset to default
              </button>
            )}
          </div>
        )}

        {/* ── Toggles ── */}
        <div className="mt-6 pt-5 flex flex-col gap-4" style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
          {[
            {
              label: '🎉 Confetti on level-up',
              sub: 'Burst of confetti every time you level up.',
              val: confettiEnabled, set: setConfettiEnabled, color: '#D4537E',
            },
          ].map(({ label, sub, val, set, color }) => (
            <div key={label} className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[13px] text-[rgba(255,255,255,0.75)]">{label}</div>
                <div className="text-[11px] text-[rgba(255,255,255,0.3)] mt-0.5">{sub}</div>
              </div>
              <button
                onClick={() => set(!val)}
                className="w-10 h-5 rounded-full relative cursor-pointer flex-shrink-0 transition-colors"
                style={{ background: val ? `${color}99` : 'rgba(255,255,255,0.1)' }}>
                <div className="w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all"
                     style={{ background: '#fff', left: val ? 'calc(100% - 17px)' : '3px' }} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Maintenance ─────────────────────────────────────────── */}
      <div className="vault-card p-5">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck size={14} style={{ color: '#1D9E75' }} />
          <div className="text-[15px] font-medium text-[rgba(255,255,255,0.8)]">Maintenance</div>
        </div>
        <div className="text-[13px] text-[rgba(255,255,255,0.35)] mb-5">
          Database backup and server controls.
        </div>

        <div className="flex flex-col gap-3">

          {/* Backup + Restore */}
          <div className="p-4 rounded-[10px] flex flex-col gap-4"
               style={{ background: 'rgba(29,158,117,0.06)', border: '0.5px solid rgba(29,158,117,0.2)' }}>

            {/* Backup row */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[15px] font-medium text-[rgba(255,255,255,0.8)]">Backup database</div>
                <div className="text-[13px] text-[rgba(255,255,255,0.35)] mt-0.5">
                  Downloads a consistent snapshot of <code className="text-[rgba(255,255,255,0.5)]">vault.db</code> — all galleries, creators, sessions, and cards.
                </div>
              </div>
              <button
                onClick={() => { systemApi.backup(); toast.success('Backup download started!') }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-[13px] font-medium cursor-pointer flex-shrink-0 ml-4"
                style={{ background: 'rgba(29,158,117,0.2)', color: '#9FE1CB', border: '0.5px solid rgba(29,158,117,0.4)' }}>
                <Download size={14} /> Download backup
              </button>
            </div>

            <div style={{ height: '0.5px', background: 'rgba(29,158,117,0.2)' }} />

            {/* Restore row */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-medium text-[rgba(255,255,255,0.8)]">Restore backup</div>
                <div className="text-[13px] text-[rgba(255,255,255,0.35)] mt-0.5">
                  Select a <code className="text-[rgba(255,255,255,0.5)]">.db</code> backup file to restore. Your current database is automatically saved before overwriting.
                </div>

                {/* Confirming state — shown inline below the description */}
                {restoreState === 'confirming' && restoreFile && (
                  <div className="mt-3 p-3 rounded-[8px]"
                       style={{ background: 'rgba(212,83,126,0.1)', border: '0.5px solid rgba(212,83,126,0.35)' }}>
                    <div className="text-[12px] font-medium mb-1" style={{ color: '#F4C0D1' }}>
                      ⚠️ Replace entire database?
                    </div>
                    <div className="text-[11px] mb-3" style={{ color: 'rgba(255,255,255,0.45)' }}>
                      File: <span style={{ color: 'rgba(255,255,255,0.7)' }}>{restoreFile.name}</span>
                      <br />This will replace all your current data. The app will restart automatically.
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={confirmRestore}
                        className="px-4 py-1.5 rounded-[6px] text-[12px] font-medium cursor-pointer"
                        style={{ background: 'rgba(212,83,126,0.3)', color: '#FFD4E2', border: '0.5px solid rgba(212,83,126,0.5)' }}>
                        Yes, restore
                      </button>
                      <button
                        onClick={() => { setRestoreState('idle'); setRestoreFile(null) }}
                        className="px-4 py-1.5 rounded-[6px] text-[12px] cursor-pointer"
                        style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Hidden file input */}
              <input
                ref={restoreInputRef}
                type="file"
                accept=".db"
                className="hidden"
                onChange={handleRestoreFileChange}
              />

              {/* Restore button */}
              <button
                onClick={() => restoreState === 'idle' && restoreInputRef.current?.click()}
                disabled={restoreState !== 'idle'}
                className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-[13px] font-medium cursor-pointer flex-shrink-0 disabled:opacity-60"
                style={restoreState === 'done'
                  ? { background: 'rgba(29,158,117,0.2)', color: '#9FE1CB', border: '0.5px solid rgba(29,158,117,0.4)' }
                  : { background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)', border: '0.5px solid rgba(255,255,255,0.15)' }}>
                {restoreState === 'uploading' ? (
                  <><RefreshCw size={14} className="animate-spin" /> Uploading…</>
                ) : restoreState === 'restarting' ? (
                  <><RefreshCw size={14} className="animate-spin" /> Restarting…</>
                ) : restoreState === 'done' ? (
                  <><Check size={14} /> Restored!</>
                ) : (
                  <><Download size={14} style={{ transform: 'rotate(180deg)' }} /> Restore backup</>
                )}
              </button>
            </div>

          </div>

          {/* Storage Location */}
          <div className="p-4 rounded-[10px] flex flex-col gap-3"
               style={{ background: 'rgba(127,119,221,0.06)', border: '0.5px solid rgba(127,119,221,0.2)' }}>
            <div className="flex items-center gap-2">
              <HardDrive size={13} style={{ color: '#9F99E8' }} />
              <div className="text-[15px] font-medium text-[rgba(255,255,255,0.8)]">Storage location</div>
            </div>
            <div className="text-[13px] text-[rgba(255,255,255,0.35)]">
              Where <code className="text-[rgba(255,255,255,0.5)]">vault.db</code> and the thumbnail cache are stored.
              Move this to a larger drive if your C: space is limited. The server will restart automatically when saved.
            </div>
            {configData && (
              <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                Active: <span className="font-mono" style={{ color: 'rgba(255,255,255,0.55)' }}>{configData.effective_data_dir}</span>
              </div>
            )}
            {configData && configData.data_dir && configData.data_dir !== configData.effective_data_dir && (
              <div className="text-[11px]" style={{ color: '#BA7517' }}>
                ⚠ Configured path <span className="font-mono">{configData.data_dir}</span> was not available at startup — drive may not have been mounted. Restart the server once the drive is ready.
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={storageInput}
                onChange={e => { setStorageInput(e.target.value); setStorageState('idle') }}
                placeholder="e.g. D:\VaultData"
                className="flex-1 px-3 py-2 rounded-[7px] text-[12px] font-mono outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.8)' }}
              />
              <button
                onClick={storageState === 'idle' ? handleStorageSave : undefined}
                disabled={storageState === 'saving' || storageState === 'saved'}
                className="flex items-center gap-2 px-4 py-2 rounded-[7px] text-[12px] font-medium cursor-pointer flex-shrink-0 disabled:opacity-60"
                style={storageState === 'saved'
                  ? { background: 'rgba(29,158,117,0.2)', color: '#9FE1CB', border: '0.5px solid rgba(29,158,117,0.4)' }
                  : { background: 'rgba(127,119,221,0.2)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.4)' }}>
                {storageState === 'saving' ? (
                  <><RefreshCw size={12} className="animate-spin" /> Saving…</>
                ) : storageState === 'saved' ? (
                  <><Check size={12} /> Saved — restarting…</>
                ) : (
                  <><Check size={12} /> Save & restart</>
                )}
              </button>
            </div>
          </div>

          {/* Run on startup */}
          <div className="flex items-center justify-between p-4 rounded-[10px]"
               style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
            <div>
              <div className="text-[15px] font-medium text-[rgba(255,255,255,0.8)]">Run on startup</div>
              <div className="text-[13px] text-[rgba(255,255,255,0.35)] mt-0.5">
                Launch The Vault automatically when Windows starts.
              </div>
              {startupData && !startupData.available && (
                <div className="text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.25)' }}>
                  Only available in the installed version
                </div>
              )}
            </div>
            <button
              disabled={!startupData?.available || startupMutation.isPending}
              onClick={() => startupMutation.mutate(!startupData?.enabled)}
              className="w-10 h-5 rounded-full relative flex-shrink-0 ml-4 transition-colors disabled:opacity-30"
              style={{ background: startupData?.enabled ? 'rgba(127,119,221,0.6)' : 'rgba(255,255,255,0.1)',
                       cursor: startupData?.available ? 'pointer' : 'not-allowed' }}>
              <div className="w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all bg-white"
                   style={{ left: startupData?.enabled ? 'calc(100% - 17px)' : '3px' }} />
            </button>
          </div>

          {/* Restart */}
          <div className="flex items-center justify-between p-4 rounded-[10px]"
               style={{ background: 'rgba(186,117,23,0.06)', border: '0.5px solid rgba(186,117,23,0.2)' }}>
            <div>
              <div className="text-[15px] font-medium text-[rgba(255,255,255,0.8)]">Restart server</div>
              <div className="text-[13px] text-[rgba(255,255,255,0.35)] mt-0.5">
                Restarts the Python backend. The page will reconnect automatically — takes about 3–5 seconds.
              </div>
            </div>
            <button
              onClick={restartState === 'idle' ? handleRestart : undefined}
              disabled={restartState === 'restarting'}
              className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-[13px] font-medium cursor-pointer flex-shrink-0 ml-4 disabled:opacity-60"
              style={restartState === 'done'
                ? { background: 'rgba(29,158,117,0.2)', color: '#9FE1CB', border: '0.5px solid rgba(29,158,117,0.4)' }
                : { background: 'rgba(186,117,23,0.2)', color: '#FAC775', border: '0.5px solid rgba(186,117,23,0.4)' }}>
              {restartState === 'restarting' ? (
                <>
                  <RefreshCw size={14} className="animate-spin" /> Restarting…
                </>
              ) : restartState === 'done' ? (
                <>
                  <Check size={14} /> Back online
                </>
              ) : (
                <>
                  <RefreshCw size={14} /> Restart server
                </>
              )}
            </button>
          </div>

          {/* Factory reset */}
          <div className="flex items-center justify-between p-4 rounded-[10px]"
               style={{ background: 'rgba(212,83,126,0.05)', border: '0.5px solid rgba(212,83,126,0.2)' }}>
            <div>
              <div className="text-[15px] font-medium" style={{ color: 'rgba(244,192,209,0.9)' }}>Restore defaults</div>
              <div className="text-[13px] text-[rgba(255,255,255,0.35)] mt-0.5">
                Wipe all galleries, creators, sessions, and cards for a clean start.
              </div>
            </div>
            <button
              onClick={() => setShowResetModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-[13px] font-medium cursor-pointer flex-shrink-0 ml-4"
              style={{ background: 'rgba(212,83,126,0.15)', color: '#F4C0D1', border: '0.5px solid rgba(212,83,126,0.35)' }}>
              <AlertCircle size={14} /> Reset collection
            </button>
          </div>

        </div>
      </div>

      {/* Factory reset confirmation modal */}
      {showResetModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6"
             style={{ background: 'rgba(0,0,0,0.75)' }}
             onClick={resetState === 'idle' ? () => setShowResetModal(false) : undefined}>
          <div className="rounded-[16px] p-7 max-w-md w-full"
               style={{ background: '#1a1a1a', border: '1px solid rgba(212,83,126,0.4)', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
               onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#F4C0D1', marginBottom: 10 }}>
              Wipe entire collection?
            </div>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6, marginBottom: 16 }}>
              This will permanently delete:
            </div>
            <ul style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', lineHeight: 1.8, marginBottom: 20, paddingLeft: 20 }}>
              <li>All galleries and images</li>
              <li>All creators and characters</li>
              <li>All session history and stats</li>
              <li>All cards, packs, and TCG progress</li>
              <li>All XP, levels, and achievements</li>
            </ul>
            <div className="p-3 rounded-[8px] mb-6" style={{ background: 'rgba(212,83,126,0.12)', border: '0.5px solid rgba(212,83,126,0.3)' }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#F4C0D1', marginBottom: 4 }}>
                This cannot be undone.
              </div>
              <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)' }}>
                The only way to recover your data is from a backup file. Use the <strong style={{ color: 'rgba(255,255,255,0.7)' }}>Download backup</strong> button first if you want to keep a copy.
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={resetState === 'idle' ? handleReset : undefined}
                disabled={resetState !== 'idle'}
                className="flex items-center gap-2 px-5 py-3 rounded-[8px] text-[15px] font-medium cursor-pointer disabled:opacity-50"
                style={{ background: 'rgba(212,83,126,0.3)', color: '#FFD4E2', border: '0.5px solid rgba(212,83,126,0.5)' }}>
                {resetState === 'resetting'
                  ? <><RefreshCw size={15} className="animate-spin" /> Wiping & restarting…</>
                  : '💣 Yes, wipe everything'}
              </button>
              <button
                onClick={() => setShowResetModal(false)}
                disabled={resetState === 'resetting'}
                className="flex-1 px-4 py-3 rounded-[8px] text-[15px] cursor-pointer disabled:opacity-40"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export function MultiPanel() {
  return (
    <div className="p-5 flex items-center justify-center h-full">
      <div className="text-center">
        <div className="text-[rgba(255,255,255,0.3)] text-[14px] mb-2">Multi-panel viewer</div>
        <div className="text-[rgba(255,255,255,0.15)] text-[12px]">Coming in Phase 2 — the UI mockup is ready to implement!</div>
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

  const log = data?.log ?? []

  return (
    <div className="p-5 flex flex-col gap-4 h-full">
      <div className="flex items-center gap-3">
        <ScrollText size={15} style={{ color: '#7F77DD' }} />
        <div className="text-[16px] font-medium text-[rgba(255,255,255,0.9)]">Scan Log</div>
        {scanStatus?.running && (
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px]"
               style={{ background: 'rgba(29,158,117,0.15)', color: '#9FE1CB', border: '0.5px solid rgba(29,158,117,0.3)' }}>
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#1D9E75' }} />
            Scanning…
          </div>
        )}
        {scanStatus?.running && (
          <button onClick={async () => { await scannerApi.cancel(); qc.invalidateQueries({ queryKey: ['scan-status'] }) }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] cursor-pointer"
                  style={{ background: 'rgba(212,83,126,0.15)', color: '#F4C0D1', border: '0.5px solid rgba(212,83,126,0.3)' }}>
            <X size={10} /> Cancel scan
          </button>
        )}
        <button onClick={() => refetch()} className="ml-auto text-[10px] cursor-pointer text-[rgba(255,255,255,0.3)] hover:text-white">
          Refresh
        </button>
      </div>

      {scanStatus?.running && (
        <div className="rounded-[8px] p-3" style={{ background: 'rgba(29,158,117,0.08)', border: '0.5px solid rgba(29,158,117,0.2)' }}>
          <div className="text-[11px] text-[rgba(255,255,255,0.6)] mb-1.5">{scanStatus.message}</div>
          <div className="h-1.5 rounded-full bg-[rgba(255,255,255,0.07)] overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ background: '#1D9E75', width: `${scanStatus.total ? (scanStatus.progress / scanStatus.total) * 100 : 0}%` }} />
          </div>
          <div className="text-[9px] text-[rgba(255,255,255,0.3)] mt-1">
            {scanStatus.progress} / {scanStatus.total} folders
          </div>
        </div>
      )}

      <div className="flex-1 rounded-[10px] overflow-y-auto font-mono text-[11px]"
           style={{ background: '#0d0d0d', border: '0.5px solid rgba(255,255,255,0.08)', padding: '12px' }}>
        {isLoading ? (
          <div className="text-[rgba(255,255,255,0.2)]">Loading log…</div>
        ) : log.length === 0 ? (
          <div className="text-[rgba(255,255,255,0.2)]">No log entries yet. Start a scan to see output here.</div>
        ) : (
          [...log].reverse().map((line, i) => (
            <div key={i} className="py-0.5 leading-relaxed"
                 style={{ color: line.startsWith('ERROR') ? '#F4C0D1' : line.startsWith('Scan') || line.startsWith('Folder') ? '#9FE1CB' : 'rgba(255,255,255,0.5)' }}>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

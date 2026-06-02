import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { creatorsApi, imagesApi } from '../lib/api'

const ROTATE_MS = 2800

// ─────────────────────────────────────────────────────────────────────────────
// TiltCard
// ─────────────────────────────────────────────────────────────────────────────
function TiltCard({ children, style }) {
  const ref     = useRef(null)
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const resting = tilt.x === 0 && tilt.y === 0

  const onMove = useCallback((e) => {
    if (!ref.current) return
    const r  = ref.current.getBoundingClientRect()
    const dx = (e.clientX - (r.left + r.width  / 2)) / (r.width  / 2)
    const dy = (e.clientY - (r.top  + r.height / 2)) / (r.height / 2)
    setTilt({ x: -dy * 8, y: dx * 8 })
  }, [])

  const onLeave = useCallback(() => setTilt({ x: 0, y: 0 }), [])

  return (
    <div style={{ perspective: '900px', ...style }}>
      <div
        ref={ref}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        style={{
          transform:      `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
          transition:     resting
            ? 'transform 0.55s cubic-bezier(0.2,0.8,0.3,1)'
            : 'transform 0.08s ease',
          transformStyle: 'preserve-3d',
          willChange:     'transform',
        }}
      >
        {children}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// OrganicCollage — CSS Grid mosaic, zero gaps guaranteed.
// Each cell fills its grid area exactly (objectFit:cover). The slight per-cell
// scale(1.06) ensures pixel-perfect edge coverage with no hairline seams.
// ─────────────────────────────────────────────────────────────────────────────

// Irregular spanning grid: 6 cols × 8 rows, 10 tiles that cover every cell.
// Each tile: [colStart, colEnd, rowStart, rowEnd] (1-based, exclusive end)
const GRID_TILES = [
  [1, 3, 1, 3], // wide top-left
  [3, 5, 1, 4], // tall top-center
  [5, 7, 1, 3], // square top-right
  [1, 3, 3, 5], // square mid-left
  [3, 5, 4, 6], // square mid-center
  [5, 7, 3, 6], // tall mid-right
  [1, 4, 5, 8], // wide bottom-left
  [4, 7, 6, 9], // wide bottom-right
  [1, 3, 8, 9], // thin bottom-left strip
  [3, 5, 8, 9], // thin bottom-center strip
  [5, 7, 8, 9], // thin bottom-right strip (fills row 8 gap)
  [4, 6, 4, 6], // small center fill
]
const GRID_CELL_COUNT = GRID_TILES.length

// Per-tile focal point — each cell crops to a different part of the creator image
const OBJ_POSITIONS = [
  '40% 20%', '60% 50%', '50% 30%', '30% 70%', '70% 40%', '50% 60%',
  '40% 50%', '60% 30%', '50% 80%', '30% 40%', '70% 60%', '50% 50%',
]

// Per-tile rotation — small angles make the collage feel hand-placed, not digital
const TILE_ROTATIONS = [-3, 2, -1.5, 3.5, -2.5, 1.5, -3.5, 2, 1, -2, 3, -1.5]

// Border radius per tile — each piece has its own rounded personality
const TILE_RADII = [
  '12px', '10px 14px 10px 14px', '14px', '10px',
  '12px 10px 14px 10px', '14px 10px', '10px 14px',
  '12px', '14px 10px 12px 10px', '10px 12px', '14px', '10px 14px 10px 12px',
]

// Build a flat URL pool from creators (avatar) + images (thumb).
// Shuffled so tiles get variety. Always at least GRID_CELL_COUNT entries by cycling.
function buildPool(creators, images) {
  const entries = [
    ...creators.map(c => ({ url: creatorsApi.avatarUrl(c.id), id: `c${c.id}` })),
    ...images.map(img => ({ url: `/api/images/${img.id}/thumb`, id: `i${img.id}` })),
  ]
  if (!entries.length) return []
  const shuffled = [...entries].sort(() => Math.random() - 0.5)
  return Array.from({ length: Math.max(GRID_CELL_COUNT * 2, shuffled.length) },
    (_, i) => shuffled[i % shuffled.length])
}

function OrganicCollage({ creators, images }) {
  const [cells,    setCells]    = useState([])   // array of { url, id }
  const [versions, setVersions] = useState(() => new Array(GRID_CELL_COUNT).fill(0))
  const poolRef = useRef([])
  const seeded  = useRef(false)

  // Rebuild pool whenever source data arrives
  useEffect(() => {
    if (creators.length === 0 && images.length === 0) return
    const pool = buildPool(creators, images)
    poolRef.current = pool
    if (!seeded.current) {
      seeded.current = true
      setCells(pool.slice(0, GRID_CELL_COUNT))
    }
  }, [creators.length, images.length])

  useEffect(() => {
    if (cells.length === 0) return
    const id = setInterval(() => {
      const idx  = Math.floor(Math.random() * GRID_CELL_COUNT)
      const pool = poolRef.current
      if (!pool.length) return
      setCells(prev => {
        const usedIds = new Set(prev.map(c => c?.id))
        const fresh   = pool.filter(p => !usedIds.has(p.id))
        const pick    = (fresh.length ? fresh : pool)[Math.floor(Math.random() * (fresh.length || pool.length))]
        const next = [...prev]; next[idx] = pick; return next
      })
      setVersions(prev => { const next = [...prev]; next[idx]++; return next })
    }, ROTATE_MS + Math.random() * 600)
    return () => clearInterval(id)
  }, [cells.length])

  if (cells.length === 0) return null

  return (
    <>
      <style>{`
        @keyframes cell-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
      <div style={{
        position:            'absolute',
        inset:                0,
        display:             'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        gridTemplateRows:    'repeat(8, 1fr)',
        gap:                  0,
        mixBlendMode:        'multiply',
        zIndex:               3,
        // Top & bottom fade: collage dissolves into the texture at both edges.
        // Fade starts at ~15% from top and ~15% from bottom, fully opaque in between.
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 16%, black 84%, transparent 100%)',
        maskImage:        'linear-gradient(to bottom, transparent 0%, black 16%, black 84%, transparent 100%)',
      }}>
        {GRID_TILES.map(([cs, ce, rs, re], i) => {
          const cell = cells[i]
          const rot  = TILE_ROTATIONS[i] ?? 0
          const imgTransform = `rotate(${rot}deg) scale(1.25)`
          return (
            <div
              key={i}
              style={{
                gridColumn:   `${cs} / ${ce}`,
                gridRow:      `${rs} / ${re}`,
                overflow:     'hidden',
                position:     'relative',
                borderRadius:  TILE_RADII[i] ?? '10px',
              }}
            >
              {cell && (
                <img
                  key={`${i}-${versions[i]}`}
                  src={cell.url}
                  alt=""
                  draggable={false}
                  onError={e => {
                    // One retry pulling a different entry from the pool
                    if (e.target.dataset.retried) { e.target.style.visibility = 'hidden'; return }
                    e.target.dataset.retried = '1'
                    const pool = poolRef.current
                    if (pool.length) {
                      const pick = pool[Math.floor(Math.random() * pool.length)]
                      e.target.src = pick.url
                    }
                  }}
                  style={{
                    width:          '100%',
                    height:         '100%',
                    objectFit:      'cover',
                    objectPosition:  OBJ_POSITIONS[i] || 'center',
                    display:        'block',
                    transform:       imgTransform,
                    filter:         'saturate(0.78) brightness(0.88)',
                    animation:      'cell-fade 0.9s ease forwards',
                  }}
                />
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PackVisual — sizes itself to the image's natural pixel dimensions so the
// texture always fills the box exactly, regardless of the PNG's aspect ratio.
// No blurred backdrop, no objectFit tricks — image has no transparent areas.
// ─────────────────────────────────────────────────────────────────────────────
function PackVisual({ imageSrc, title, glowColor, creators, images, shiny = false }) {
  const [size, setSize] = useState({ w: 380, h: 520 })

  const onLoad = useCallback((e) => {
    const { naturalWidth: nw, naturalHeight: nh } = e.currentTarget
    if (!nw || !nh) return
    // Scale so width is always 380px; height follows the natural aspect ratio
    const scale = 380 / nw
    setSize({ w: 380, h: Math.round(nh * scale) })
  }, [])

  return (
    <TiltCard>
      <div style={{
        width:        size.w,
        height:       size.h,
        borderRadius: 18,
        overflow:     'hidden',
        position:     'relative',
        boxShadow:    `0 28px 60px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.07), 0 0 48px ${glowColor}25`,
      }}>

        {/* ── Pack texture: fills container exactly ─────────────────────── */}
        <img
          src={imageSrc}
          alt={title}
          draggable={false}
          onLoad={onLoad}
          style={{
            position:      'absolute',
            inset:          0,
            width:         '100%',
            height:        '100%',
            objectFit:     'fill',
            display:       'block',
            userSelect:    'none',
            pointerEvents: 'none',
            zIndex:         1,
          }}
        />

        {/* ── Organic creator mosaic overlay ────────────────────────────── */}
        <OrganicCollage creators={creators} images={images} />

        {/* ── Foil shine sweep — premium pack only ─────────────────────── */}
        {shiny && (
          <>
            <style>{`
              @keyframes foil-sweep {
                0%   { transform: translateX(-160%) skewX(-18deg); opacity: 0;   }
                8%   { opacity: 1; }
                92%  { opacity: 1; }
                100% { transform: translateX(260%) skewX(-18deg);  opacity: 0;   }
              }
              @keyframes foil-pulse {
                0%, 100% { opacity: 0.06; }
                50%      { opacity: 0.14; }
              }
            `}</style>
            {/* Slow rainbow iridescence layer */}
            <div style={{
              position:   'absolute', inset: 0, zIndex: 5,
              pointerEvents: 'none',
              background: 'linear-gradient(135deg, rgba(255,220,100,0.08) 0%, rgba(255,180,220,0.10) 30%, rgba(160,200,255,0.08) 60%, rgba(200,255,200,0.07) 100%)',
              animation:  'foil-pulse 3.5s ease-in-out infinite',
            }} />
            {/* Diagonal sweep stripe */}
            <div style={{
              position: 'absolute', inset: 0, zIndex: 6,
              pointerEvents: 'none', overflow: 'hidden',
            }}>
              <div style={{
                position:   'absolute',
                top:        '-15%',
                width:      '38%',
                height:     '130%',
                background: 'linear-gradient(to right, transparent 0%, rgba(255,255,200,0.12) 30%, rgba(255,255,255,0.32) 50%, rgba(255,255,200,0.12) 70%, transparent 100%)',
                animation:  'foil-sweep 4.2s ease-in-out infinite',
                animationDelay: '0.8s',
              }} />
            </div>
          </>
        )}

        {/* ── Bottom vignette + pack name ───────────────────────────────── */}
        <div style={{
          position:   'absolute',
          bottom:      0,
          left:        0,
          right:       0,
          zIndex:      7,
          background: 'linear-gradient(to top, rgba(4,4,14,0.88) 0%, rgba(4,4,14,0.50) 45%, transparent 100%)',
          padding:    '32px 18px 14px',
        }}>
          <div style={{
            fontSize:     20,
            fontWeight:   800,
            color:        '#fff',
            letterSpacing: '0.02em',
            textShadow:   '0 2px 12px rgba(0,0,0,0.8)',
          }}>
            {title}
          </div>
        </div>

      </div>
    </TiltCard>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// InfoBlock — description, drop rates, and buy buttons beneath the visual
// ─────────────────────────────────────────────────────────────────────────────
function InfoBlock({ description, dropRates, creditCost, credits, onOpen, isPending, glowColor }) {
  return (
    <div style={{
      marginTop:    12,
      padding:      '14px 16px 16px',
      borderRadius: '0 0 14px 14px',
      background:   'rgba(10,10,22,0.7)',
      backdropFilter: 'blur(10px)',
      border:       '0.5px solid rgba(255,255,255,0.06)',
      borderTop:    'none',
    }}>

      <div style={{
        fontSize:     11,
        color:        'rgba(255,255,255,0.42)',
        marginBottom:  12,
        lineHeight:    1.5,
      }}>
        {description}
      </div>

      {/* Drop-rate badges */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 14 }}>
        {dropRates.map(r => (
          <span key={r.label} style={{
            padding:      '3px 8px',
            borderRadius:  8,
            fontSize:      9,
            fontWeight:    700,
            background:   `${r.color}15`,
            border:       `0.5px solid ${r.color}50`,
            color:         r.color,
          }}>
            {r.label} {r.pct}
          </span>
        ))}
      </div>

      {/* Buy buttons — each in its own container */}
      <div style={{ display: 'flex', gap: 10 }}>
        {[1, 5, 10].map(qty => {
          const cost      = creditCost * qty
          const canAfford = credits >= cost
          const bg        = glowColor.replace(/,\s*[\d.]+\)$/, ', 0.1)')
          const border    = glowColor.replace(/,\s*[\d.]+\)$/, ', 0.4)')
          return (
            <div key={qty} style={{
              flex: 1,
              padding: '10px 8px',
              borderRadius: 14,
              background: canAfford ? bg : 'rgba(255,255,255,0.03)',
              border: `1px solid ${canAfford ? border : 'rgba(255,255,255,0.08)'}`,
            }}>
              <button
                onClick={() => onOpen(qty)}
                disabled={isPending || !canAfford}
                style={{
                  width:         '100%',
                  padding:       '10px 0',
                  borderRadius:   10,
                  fontSize:       16,
                  fontWeight:     800,
                  cursor:         canAfford && !isPending ? 'pointer' : 'not-allowed',
                  background:     canAfford
                    ? `linear-gradient(135deg, ${glowColor.replace(/,\s*[\d.]+\)$/, ', 0.7)')}, ${glowColor.replace(/,\s*[\d.]+\)$/, ', 0.35)')})`
                    : 'rgba(255,255,255,0.04)',
                  color:          canAfford ? '#fff' : 'rgba(255,255,255,0.18)',
                  border:         'none',
                  boxShadow:      canAfford ? `0 0 20px ${glowColor.replace(/,\s*[\d.]+\)$/, ', 0.3)')}` : 'none',
                  transition:    'all 0.15s ease',
                  display:       'flex',
                  flexDirection: 'column',
                  alignItems:    'center',
                  gap:            5,
                  opacity:        isPending ? 0.55 : 1,
                }}
              >
                <span>{qty}x</span>
                <span style={{ fontSize: 13, opacity: 0.8, fontWeight: 600 }}>
                  {cost.toLocaleString()} CR
                </span>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Drop-rate data
// ─────────────────────────────────────────────────────────────────────────────
const STANDARD_DROPS = [
  { label: 'Photo',     pct: '67%', color: '#c0c0c0' },
  { label: 'Gallery',   pct: '19%', color: '#1D9E75' },
  { label: 'Creator',   pct: '7%',  color: '#4682DC' },
  { label: 'Collab ♦',  pct: '5%',  color: '#D4537E' },
  { label: 'Goon ★',    pct: '1%',  color: '#7F77DD' },
  { label: 'Variant ✦', pct: '1%',  color: '#ff8800' },
]
const PREMIUM_DROPS = [
  { label: 'Photo',     pct: '38%', color: '#c0c0c0' },
  { label: 'Gallery',   pct: '27%', color: '#1D9E75' },
  { label: 'Creator',   pct: '17%', color: '#4682DC' },
  { label: 'Collab ♦',  pct: '10%', color: '#D4537E' },
  { label: 'Variant ✦', pct: '5%',  color: '#ff8800' },
  { label: 'Goon ★',    pct: '3%',  color: '#7F77DD' },
]

// ─────────────────────────────────────────────────────────────────────────────
// ShopTab — main export
// ─────────────────────────────────────────────────────────────────────────────
export default function ShopTab({ credits, openPackMutation, openFromInventoryMutation, standardPacks = 0, premiumPacks = 0 }) {
  const { data: rawCreators } = useQuery({
    queryKey: ['creators-collage'],
    queryFn:  () => creatorsApi.list({ limit: 60 })
                      .then(r => r.data?.items ?? (Array.isArray(r.data) ? r.data : [])),
    staleTime: 5 * 60 * 1000,
  })
  const { data: rawImages } = useQuery({
    queryKey: ['images-collage'],
    queryFn:  () => imagesApi.list({ limit: 80, sort_by: 'random', is_video: false })
                      .then(r => r.data?.items ?? (Array.isArray(r.data) ? r.data : [])),
    staleTime: 5 * 60 * 1000,
  })
  const creators = rawCreators ?? []
  const images   = rawImages   ?? []

  const totalInventory = standardPacks + premiumPacks
  const isPendingInventory = openFromInventoryMutation?.isPending

  return (
    <div style={{ padding: '8px 0 32px' }}>

      {/* ── Pack Inventory ── */}
      {totalInventory > 0 && (
        <div style={{
          marginBottom: 28,
          borderRadius: 14,
          background: 'rgba(29,158,117,0.07)',
          border: '1px solid rgba(29,158,117,0.25)',
          padding: '16px 20px',
          display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(29,158,117,0.8)', marginBottom: 4 }}>
              Pack Inventory
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
              Quest rewards — open for free
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginLeft: 'auto' }}>
            {standardPacks > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(127,119,221,0.1)', border: '1px solid rgba(127,119,221,0.25)', borderRadius: 10, padding: '8px 14px' }}>
                <span style={{ fontSize: 22, fontWeight: 800, color: '#CECBF6', lineHeight: 1 }}>{standardPacks}</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.3 }}>Standard<br/>Packs</span>
                <div style={{ display: 'flex', gap: 6, marginLeft: 6 }}>
                  <button
                    disabled={isPendingInventory}
                    onClick={() => openFromInventoryMutation?.mutate({ pack_type: 'standard', quantity: 1 })}
                    style={{ padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'rgba(127,119,221,0.25)', color: '#CECBF6', border: '1px solid rgba(127,119,221,0.4)', opacity: isPendingInventory ? 0.5 : 1 }}>
                    Open 1
                  </button>
                  {standardPacks > 1 && (
                    <button
                      disabled={isPendingInventory}
                      onClick={() => openFromInventoryMutation?.mutate({ pack_type: 'standard', quantity: standardPacks })}
                      style={{ padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'rgba(127,119,221,0.15)', color: '#AFA9EC', border: '1px solid rgba(127,119,221,0.25)', opacity: isPendingInventory ? 0.5 : 1 }}>
                      All
                    </button>
                  )}
                </div>
              </div>
            )}
            {premiumPacks > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,200,30,0.08)', border: '1px solid rgba(255,200,30,0.25)', borderRadius: 10, padding: '8px 14px' }}>
                <span style={{ fontSize: 22, fontWeight: 800, color: '#FAC775', lineHeight: 1 }}>{premiumPacks}</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.3 }}>Premium<br/>Packs</span>
                <div style={{ display: 'flex', gap: 6, marginLeft: 6 }}>
                  <button
                    disabled={isPendingInventory}
                    onClick={() => openFromInventoryMutation?.mutate({ pack_type: 'premium', quantity: 1 })}
                    style={{ padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'rgba(255,200,30,0.2)', color: '#FAC775', border: '1px solid rgba(255,200,30,0.4)', opacity: isPendingInventory ? 0.5 : 1 }}>
                    Open 1
                  </button>
                  {premiumPacks > 1 && (
                    <button
                      disabled={isPendingInventory}
                      onClick={() => openFromInventoryMutation?.mutate({ pack_type: 'premium', quantity: premiumPacks })}
                      style={{ padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'rgba(255,200,30,0.1)', color: '#D4A830', border: '1px solid rgba(255,200,30,0.2)', opacity: isPendingInventory ? 0.5 : 1 }}>
                      All
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start', flexWrap: 'wrap' }}>

        {/* ── Standard Pack ── */}
        <div style={{
          width: 400,
          borderRadius: 18,
          background: 'rgba(127,119,221,0.05)',
          border: '1px solid rgba(127,119,221,0.22)',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}>
          <PackVisual
            imageSrc="/booster-pack.png"
            title="Booster Pack"
            glowColor="rgba(127,119,221,0.85)"
            creators={creators}
            images={images}
          />
          <InfoBlock
            description="5 random cards drawn from your vault library. Chance of Epic, Legendary, Relic, or Celestial drops."
            dropRates={STANDARD_DROPS}
            creditCost={250}
            credits={credits}
            onOpen={(qty) => openPackMutation.mutate({ pack_type: 'standard', quantity: qty })}
            isPending={openPackMutation.isPending}
            glowColor="rgba(127,119,221,0.85)"
          />
        </div>

        {/* ── Premium Pack ── */}
        <div style={{
          width: 400,
          borderRadius: 18,
          background: 'rgba(255,200,30,0.04)',
          border: '1px solid rgba(255,200,30,0.22)',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}>
          <PackVisual
            imageSrc="/booster-pack-premium.png"
            title="Premium Pack"
            glowColor="rgba(255,200,30,0.85)"
            creators={creators}
            images={images}
            shiny
          />
          <InfoBlock
            description="5 premium cards. Massively boosted variant and goon drop rates. Higher relic and celestial chance."
            dropRates={PREMIUM_DROPS}
            creditCost={500}
            credits={credits}
            onOpen={(qty) => openPackMutation.mutate({ pack_type: 'premium', quantity: qty })}
            isPending={openPackMutation.isPending}
            glowColor="rgba(255,200,30,0.85)"
          />
        </div>

        {/* ── Upgrade odds sidebar ── */}
        <div style={{
          flex:           '0 0 220px',
          borderRadius:    14,
          background:     'rgba(8,8,22,0.65)',
          backdropFilter: 'blur(12px)',
          border:         '0.5px solid rgba(255,255,255,0.07)',
          padding:         22,
          alignSelf:      'flex-start',
          marginTop:       6,
        }}>
          <div style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.12em',
            color: 'rgba(255,255,255,0.32)', textTransform: 'uppercase', marginBottom: 14,
          }}>
            Upgrade Lottery
          </div>
          {[
            { label: 'Epic upgrade',      pct: '3%',   color: '#7F77DD' },
            { label: 'Legendary upgrade', pct: '1%',   color: '#ff8800' },
            { label: 'Relic upgrade',     pct: '0.5%', color: '#FFD700' },
            { label: 'Celestial upgrade', pct: '0.1%', color: '#E8E8FF' },
          ].map(u => (
            <div key={u.label} style={{
              display:        'flex',
              justifyContent: 'space-between',
              alignItems:     'center',
              padding:        '7px 0',
              borderBottom:   '0.5px solid rgba(255,255,255,0.04)',
              fontSize:        11,
            }}>
              <span style={{ color: 'rgba(255,255,255,0.38)' }}>{u.label}</span>
              <span style={{ color: u.color, fontWeight: 700 }}>{u.pct}</span>
            </div>
          ))}
          <div style={{
            fontSize: 10, color: 'rgba(255,255,255,0.16)',
            marginTop: 12, lineHeight: 1.55,
          }}>
            Each of the 5 cards rolls its upgrade independently, on top of its base type rarity.
          </div>
        </div>

      </div>
    </div>
  )
}

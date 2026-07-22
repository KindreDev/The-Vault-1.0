import React, { useRef, useEffect, useCallback, useState } from 'react'
import './VaultCard.css'

// ── Rarity constants ──────────────────────────────────────────────────────────
// 2026-07 rework: 4 tiers, fixed at birth. Progression = LEVEL (1-10 via CXP)
// and FOIL (premium holo variant). Legacy tier strings normalise to these.
export const RARITY_ORDER = ['common', 'epic', 'legendary', 'celestial']

const LEGACY_RARITY = { uncommon: 'common', rare: 'epic', relic: 'legendary' }
export const normRarity = (r) => LEGACY_RARITY[r] || r || 'common'

// Frame assets: the four kept borders, in their original ascending order —
// purple (old epic) → orange (old legendary) → gold (old relic) → celestial.
const FRAME_ASSET = {
  common:    '/epic.png',
  epic:      '/legendary.png',
  legendary: '/relic.png',
  celestial: '/celestial.png',
}

export const RARITY_CONFIG = {
  common: {
    border: '#7F77DD',
    glow:   'rgba(127,119,221,0.35)',
    badge:  '#9F8FEF',
    label:  'Core',
    animated: false,
  },
  epic: {
    border: '#cc5500',
    glow:   'rgba(255,100,0,0.6)',
    badge:  '#ff8800',
    label:  'Epic',
    animated: true,
  },
  legendary: {
    border: '#c9a84c',
    glow:   'rgba(255,215,0,0.55)',
    badge:  '#FFD700',
    label:  'Legendary',
    animated: true,
  },
  celestial: {
    border: 'rgba(255,255,255,0.85)',
    glow:   'rgba(200,200,255,0.55)',
    badge:  '#E8E8FF',
    label:  'Celestial',
    animated: true,
  },
}

// ── Flame particle canvas (Legendary) ─────────────────────────────────────────
function FlameCanvas({ width = 220, height = 320 }) {
  const canvasRef = useRef(null)
  const animRef   = useRef(null)
  const particles = useRef([])

  const spawn = useCallback((w, h) => {
    // spawn along all 4 edges
    const edge = Math.floor(Math.random() * 4)
    let x, y
    if (edge === 0) { x = Math.random() * w; y = 0 }          // top
    else if (edge === 1) { x = Math.random() * w; y = h }     // bottom
    else if (edge === 2) { x = 0; y = Math.random() * h }     // left
    else { x = w; y = Math.random() * h }                     // right
    return {
      x, y,
      vx: (Math.random() - 0.5) * 0.8,
      vy: -(Math.random() * 1.5 + 0.4),
      life: 1,
      decay: Math.random() * 0.02 + 0.012,
      size: Math.random() * 3 + 1.5,
      hue: Math.random() * 30, // 0–30 = red–orange
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const w = canvas.width
    const h = canvas.height

    // seed particles
    for (let i = 0; i < 40; i++) particles.current.push(spawn(w, h))

    const frame = () => {
      ctx.clearRect(0, 0, w, h)
      particles.current = particles.current.map(p => {
        p.x += p.vx
        p.y += p.vy
        p.life -= p.decay
        if (p.life <= 0) return spawn(w, h)

        const alpha = Math.max(0, p.life)
        const r = Math.round(255)
        const g = Math.round(80 + p.hue * 4)
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${r},${g},0,${alpha})`
        ctx.fill()
        return p
      })
      animRef.current = requestAnimationFrame(frame)
    }
    animRef.current = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(animRef.current)
  }, [spawn])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: 'absolute', inset: 0,
        width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 8,
      }}
    />
  )
}

// ── Sparkle spans (Relic gold / Cosmic white) ─────────────────────────────────
function Sparkles({ count = 14, color = '#FFD700', size = [6, 16] }) {
  const spans = Array.from({ length: count }, (_, i) => ({
    top:   `${Math.random() * 90}%`,
    left:  `${Math.random() * 90}%`,
    fontSize: `${size[0] + Math.random() * (size[1] - size[0])}px`,
    delay: `${Math.random() * 2}s`,
    duration: `${1 + Math.random() * 1.5}s`,
    char: Math.random() > 0.5 ? '✦' : '✤',
  }))

  return (
    <>
      {spans.map((s, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            top: s.top, left: s.left,
            fontSize: s.fontSize,
            color,
            opacity: 0,
            pointerEvents: 'none',
            zIndex: 8,
            animation: `sparkle-twinkle ${s.duration} ease-in-out ${s.delay} infinite`,
          }}
        >
          {s.char}
        </span>
      ))}
    </>
  )
}

// ── Trophy icons (1 per year collecting creator) ───────────────────────────────
function Trophies({ createdAt }) {
  if (!createdAt) return null
  const years = Math.max(1, new Date().getFullYear() - new Date(createdAt).getFullYear() + 1)
  const count = Math.min(years, 5)
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} style={{ fontSize: 10, color: '#FFD700', lineHeight: 1 }}>🏆</span>
      ))}
    </div>
  )
}


// ── Main VaultCard ─────────────────────────────────────────────────────────────
function VaultCard({
  card,
  width = 220,
  onClick,
  style = {},
  forceEffects,
  disableTilt,
  fullRes = false,
  hideLabel = false,
  cursorTrack = false,   // per-pixel cursor-tracked holo (opened viewer only; grids stay static+tilt for perf)
}) {
  const [isHovered, setIsHovered] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)
  const showEffects = forceEffects !== undefined ? forceEffects : (width > 300 || isHovered)

  const {
    rarity: rawRarity = 'common',
    rarity_class,
    foil: foilFlag,
    prestige: prestigeFlag,
    is_relic = false,
    level = 1,
    card_type = 'image',
    image_url,
    thumb_url,
    creator_name,
    creator_avatar,
    creator_type,
    creator_created_at,
    gallery_name,
    character_name,
    period_month,
    period_year,
    cxp = 0,
    collab_data,
    image_focal_x = 0.5,
    image_focal_y = 0.0,
  } = card || {}

  const rarity = normRarity(rawRarity)
  // Foil: new flag, falling back to the legacy is_relic mirror for old payloads
  const foil = foilFlag !== undefined ? !!foilFlag : !!is_relic
  // Prestige: crafted premium holo treatment, universal across tiers.
  // Older payloads used `foil` for this same concept — treat either as prestige.
  const isPrestige = !!(prestigeFlag || foilFlag)
  // Top class of a tier. UR cards wear the ex-foil webp textures; a UR that's
  // also Prestige gets the golden, denser flower field.
  const isUR = rarity_class === 'UR'
  const cfg = RARITY_CONFIG[rarity] || RARITY_CONFIG.common
  const height = Math.round(width * 1.45)
  const cardRef = useRef(null)
  const rafRef  = useRef(0)

  // ── Off-viewport gating — big grids pay real paint/composite cost for the
  // blend-mode holo layers even when a card is scrolled away. Only cards on
  // screen (plus a preload margin) mount their effect layers; a visible card
  // looks exactly the same.
  const [inViewport, setInViewport] = useState(true)
  useEffect(() => {
    const el = cardRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      ([entry]) => setInViewport(entry.isIntersecting),
      { root: null, rootMargin: '300px', threshold: 0 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // ── Holographic tilt + cursor-tracked holo effects ───────────────────────
  // rAF-throttled: writing 7 CSS vars per raw mousemove forces the whole
  // blend/mask stack to restyle at event rate — one update per frame is plenty.
  const handleMouseMove = useCallback((e) => {
    if (forceEffects === false) return
    const clientX = e.clientX, clientY = e.clientY
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      const el = cardRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top  + rect.height / 2
      const dx = (clientX - cx) / (rect.width / 2)
      const dy = (clientY - cy) / (rect.height / 2)

      // GRID CARDS: tilt ONLY (a GPU transform — no raster). The per-pixel holo
      // vars below force a full CPU re-raster of the blend/filter/mask stack on
      // every frame, which is the hover lag. Grids get the resting holo + a
      // fixed "lit" state (set once on enter) + this smooth tilt. The full
      // cursor-tracked holo runs only in the opened viewer (cursorTrack).
      if (!cursorTrack) {
        if (!disableTilt) {
          el.style.transform = `perspective(800px) rotateY(${dx * 6}deg) rotateX(${-dy * 6}deg) scale(1.03)`
        }
        return
      }

      // Quantised: every var write re-rasters the whole gradient/mask stack, so
      // snap to steps coarse enough that identical-looking frames become no-op
      // writes (2% position, 0.04 intensity, 6° angle — invisible on soft
      // gradients, cuts raster frequency several-fold).
      const px = Math.round(((clientX - rect.left) / rect.width) * 50) * 2
      const py = Math.round(((clientY - rect.top) / rect.height) * 50) * 2
      const fromCenter = Math.round(Math.min(1, Math.sqrt(dx * dx + dy * dy) / Math.SQRT2) * 25) / 25

      const key = `${px}|${py}|${fromCenter}`
      if (el.dataset.holoKey !== key) {
        el.dataset.holoKey = key
        el.style.setProperty('--pointer-x', `${px}%`)
        el.style.setProperty('--pointer-y', `${py}%`)
        el.style.setProperty('--pointer-from-center', fromCenter)
        el.style.setProperty('--pointer-from-left', px / 100)
        el.style.setProperty('--pointer-from-top', py / 100)
        el.style.setProperty('--background-x', `${px}%`)
        el.style.setProperty('--background-y', `${py}%`)

        if (rarity === 'celestial') {
          const angle = Math.round((Math.atan2(dy, dx) * (180 / Math.PI) + 180) / 6) * 6
          el.style.setProperty('--holo-angle', `${angle}deg`)
        }
      }

      if (!disableTilt) {
        el.style.transform = `perspective(800px) rotateY(${dx * 8}deg) rotateX(${-dy * 8}deg) scale(1.03)`
      }
    })
  }, [rarity, disableTilt, forceEffects, cursorTrack])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true)
    // Grid cards: "light up" the cursor-reactive layers (glitter, shimmer flare)
    // to a fixed centred state ONCE on enter — a single raster, then static while
    // hovering (no per-frame cost). The opened viewer (cursorTrack) skips this and
    // drives the vars live instead.
    if (!cursorTrack && forceEffects !== false) {
      const el = cardRef.current
      if (el) {
        el.style.setProperty('--pointer-from-center', '0.62')
        el.style.setProperty('--pointer-x', '50%')
        el.style.setProperty('--pointer-y', '42%')
        el.style.setProperty('--pointer-from-left', '0.5')
        el.style.setProperty('--pointer-from-top', '0.42')
      }
    }
  }, [cursorTrack, forceEffects])

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false)
    if (forceEffects === false) return
    const el = cardRef.current
    if (!el) return
    if (!disableTilt) {
      el.style.transform = 'perspective(800px) rotateY(0deg) rotateX(0deg) scale(1)'
    }
    el.style.setProperty('--holo-angle', '135deg')
    el.style.setProperty('--pointer-x', '50%')
    el.style.setProperty('--pointer-y', '50%')
    el.style.setProperty('--pointer-from-center', '0')
    el.style.setProperty('--pointer-from-left', '0.5')
    el.style.setProperty('--pointer-from-top', '0.5')
    el.style.setProperty('--background-x', '50%')
    el.style.setProperty('--background-y', '50%')
  }, [disableTilt, forceEffects])

  // ── Portrait display name ──────────────────────────────────────────────────
  const displayName = creator_name || gallery_name || 'Unknown'

  const collabSubtype = collab_data?.subtype

  const subLabel = card_type === 'collab'
    ? (collabSubtype === 'variant' ? '✦ Collab Variant'
       : collabSubtype === 'gallery' ? 'Collab Gallery'
       : 'Collab')
    : card_type === 'gallery' ? 'Gallery'
    : card_type === 'creator' ? (creator_type || 'Creator')
    : card_type === 'goon' ? '★ Goon Card'
    : card_type === 'variant' ? 'Variant'
    : card_type === 'hof' ? '🏆 Hall of Fame'
    : 'Photo'

  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  // ── Rarity-aware name styling ──────────────────────────────────────────────
  const nameColor =
    rarity === 'celestial' ? '#E8E8FF' :
    rarity === 'legendary' ? '#FFD700' :
    rarity === 'epic'      ? '#FFB347' :
    '#CECBF6'

  const nameAnim = cfg.animated ? (
    rarity === 'celestial' ? { animation: 'cosmic-name-glow 2s ease-in-out infinite' } :
    rarity === 'legendary' ? { animation: 'relic-name-glow 1.5s ease-in-out infinite' } :
    rarity === 'epic'      ? { animation: 'legendary-name-glow 1.2s ease-in-out infinite' } :
    {}
  ) : {}

  // ── Card border / glow style ───────────────────────────────────────────────
  const borderStyle = (() => {
    if (rarity === 'celestial') {
      return {
        border: '1.5px solid transparent',
        backgroundImage: `
          linear-gradient(#0d0d1a, #0d0d1a),
          conic-gradient(from var(--holo-angle, 135deg),
            #ff0000, #ff7700, #ffff00, #00ff88,
            #0088ff, #aa00ff, #ff0088, #ff0000)
        `,
        backgroundOrigin: 'border-box',
        backgroundClip: 'padding-box, border-box',
        boxShadow: '0 0 20px rgba(255,255,255,0.5), 0 0 40px rgba(200,200,255,0.3)',
      }
    }
    if (rarity === 'legendary') {
      return {
        border: `0.5px solid ${cfg.border}`,
        boxShadow: `0 0 18px ${cfg.glow}, 0 0 36px rgba(186,117,23,0.2)`,
      }
    }
    if (rarity === 'epic') {
      return {
        border: `0.5px solid ${cfg.border}`,
        boxShadow: `0 0 20px ${cfg.glow}, 0 0 40px rgba(180,80,0,0.2)`,
      }
    }
    return {
      border: `0.5px solid ${cfg.border}`,
      boxShadow: `0 0 10px ${cfg.glow}`,
    }
  })()

  // ── Card background ────────────────────────────────────────────────────────
  const cardBg = rarity === 'celestial'
    ? '#0d0d14'
    : rarity === 'legendary'
    ? 'linear-gradient(135deg, #1a1200 0%, #2a1e00 40%, #1a1200 100%)'
    : rarity === 'epic'
    ? '#0d0d14'
    : 'linear-gradient(160deg, #0e0a1e 0%, #1a0a2e 60%, #0e0a1e 100%)'

  return (
    <>

      {/* Backplate Container */}
      <div
        ref={cardRef}
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{
          position: 'relative',
          padding: 3,
          borderRadius: 18,
          background: `${cfg.badge}18`,
          boxShadow: `0 0 22px ${cfg.badge}55, 0 6px 24px rgba(0,0,0,0.7), inset 0 0 0 0.5px ${cfg.badge}44`,
          cursor: onClick ? 'pointer' : 'default',
          flexShrink: 0,
          userSelect: 'none',
          transition: 'transform 0.15s ease, box-shadow 0.15s ease',
          // Prestige cards must let the rainbow halo bleed past the frame —
          // paint containment would clip it flush to the card edge, and a raised
          // z-index keeps the side glow from being painted under the neighbour card.
          contain: isPrestige ? 'none' : 'paint',
          zIndex: isPrestige ? 4 : undefined,
          ...style,
        }}
      >
        {isPrestige && showEffects && <div className="vc-prestige-halo" />}
        <div
          style={{
            position: 'relative',
            width,
            height,
            borderRadius: 18,
            overflow: 'hidden',
            isolation: 'isolate',
            transform: 'translateZ(0)',
            willChange: 'transform',
            ...borderStyle,
            // (legendary flame-flicker removed — using holofoil effect now)
            // Celestial holographic border spin when mouse not hovering
            // Border spin pauses on hover — the cursor drives --holo-angle then,
            // and running both means double conic repaints every frame.
            ...(rarity === 'celestial' && inViewport
              ? { animation: 'holo-border-spin 3s linear infinite',
                  animationPlayState: isHovered ? 'paused' : 'running' }
              : {}),
          }}
        >
          {/* Explicit background layer to prevent isolation bleed */}
          <div style={{ position: 'absolute', inset: 0, background: cardBg, borderRadius: 18, zIndex: 0 }} />
          {/* ── Name at Top Center ───────────────────────────────────────────── */}
          {!hideLabel && <div style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            padding: '12px 12px 20px', zIndex: 10,
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.80) 0%, transparent 100%)',
            textAlign: 'center', pointerEvents: 'none',
            fontFamily: "'Cause', 'Inter', system-ui, sans-serif",
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
          }}>
            {card_type === 'collab' && collab_data ? (
              /* Collab: multiple creators [as multiple characters] */
              (() => {
                const names    = collab_data.creator_names   || []
                const charNames = collab_data.character_names || []
                const joinedCreators   = names.join(' & ')
                const joinedCharacters = charNames.filter(Boolean).join(' & ')
                const isVariant = collabSubtype === 'variant'
                const fs = Math.min(14, Math.max(8, width * 0.042))
                return (
                  <>
                    <div style={{
                      fontSize: fs, fontWeight: 700,
                      color: nameColor, letterSpacing: '0.06em',
                      textTransform: 'uppercase', lineHeight: 1.2,
                      overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                      maxWidth: '92%',
                      ...nameAnim,
                    }}>
                      {joinedCreators}
                    </div>
                    {isVariant && joinedCharacters && (
                      <>
                        <div style={{
                          fontSize: Math.min(10, Math.max(7, width * 0.028)),
                          fontStyle: 'italic',
                          color: 'rgba(255,255,255,0.42)', margin: '1px 0',
                        }}>
                          as
                        </div>
                        <div style={{
                          fontSize: fs, fontWeight: 600,
                          color: nameColor, letterSpacing: '0.05em',
                          textTransform: 'uppercase', lineHeight: 1.2,
                          overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                          maxWidth: '92%',
                          ...nameAnim,
                        }}>
                          {joinedCharacters}
                        </div>
                      </>
                    )}
                  </>
                )
              })()
            ) : card_type === 'variant' && creator_name && character_name ? (
              /* Variant: creator as character */
              <>
                <div style={{
                  fontSize: Math.min(15, Math.max(9, width * 0.045)), fontWeight: 600,
                  color: nameColor, letterSpacing: '0.07em',
                  textTransform: 'uppercase', opacity: 0.85,
                  overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                  ...nameAnim,
                }}>
                  {creator_name}
                </div>
                <div style={{
                  fontSize: Math.min(11, Math.max(8, width * 0.032)), fontStyle: 'italic',
                  color: 'rgba(255,255,255,0.45)', margin: '1px 0',
                }}>
                  as
                </div>
                <div style={{
                  fontSize: Math.min(20, Math.max(11, width * 0.062)), fontWeight: 800,
                  color: nameColor, letterSpacing: '0.04em',
                  textTransform: 'uppercase', lineHeight: 1.1,
                  overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                  ...nameAnim,
                }}>
                  {character_name}
                </div>
              </>
            ) : card_type === 'creator' ? (
              /* Creator card: just big name */
              <div style={{
                fontSize: Math.min(22, Math.max(12, width * 0.068)), fontWeight: 800,
                color: nameColor, letterSpacing: '0.03em', lineHeight: 1.2,
                textTransform: 'uppercase',
                overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                ...(rarity === 'celestial'
                  ? { animation: 'rainbow-text 3s linear infinite' }
                  : nameAnim),
              }}>
                {displayName}
              </div>
            ) : (
              /* Image / Gallery / Goon: Creator → in → Gallery → Date */
              <>
                {creator_name && (
                  <div style={{
                    fontSize: Math.min(18, Math.max(10, width * 0.064)), fontWeight: 800,
                    color: nameColor, letterSpacing: '0.03em', lineHeight: 1.15,
                    textTransform: 'uppercase',
                    overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                    maxWidth: '90%', margin: '0 auto',
                    ...(rarity === 'celestial'
                      ? { animation: 'rainbow-text 3s linear infinite' }
                      : nameAnim),
                  }}>
                    {creator_name}
                  </div>
                )}
                {gallery_name && (
                  <>
                    <div style={{
                      fontSize: Math.min(16, Math.max(9, width * 0.057)), fontStyle: 'italic',
                      color: 'rgba(255,255,255,0.5)', margin: '2px auto',
                    }}>
                      in
                    </div>
                    <div style={{
                      fontSize: Math.min(20, Math.max(11, width * 0.071)), fontWeight: 700,
                      color: 'rgba(255,255,255,0.9)', letterSpacing: '0.02em',
                      lineHeight: 1.15,
                      overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                      maxWidth: '90%', margin: '0 auto',
                    }}>
                      {gallery_name}
                    </div>
                  </>
                )}
                {!creator_name && !gallery_name && (
                  <div style={{
                    fontSize: Math.min(20, Math.max(11, width * 0.071)), fontWeight: 800,
                    color: nameColor, letterSpacing: '0.03em',
                    textTransform: 'uppercase',
                    overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                    maxWidth: '90%', margin: '0 auto',
                  }}>
                    {displayName}
                  </div>
                )}
                {period_month && period_year && (
                  <div style={{
                    fontSize: Math.min(16, Math.max(9, width * 0.057)),
                    color: 'rgba(255,255,255,0.45)', letterSpacing: '0.04em',
                    marginTop: 3,
                  }}>
                    {MONTH_NAMES[period_month - 1]} {period_year}
                  </div>
                )}
              </>
            )}
          </div>}

          {/* epic smoke removed — superseded by holofoil effect */}

          {/* ── Rarity-class badge (R / SR / SSR / UR) ──────────────────────────── */}
          {rarity_class && width > 120 && !hideLabel && (
            <span className={`rc-badge rc-${rarity} rc-${rarity_class}`}
                  style={{ fontSize: Math.min(15, Math.max(10, width * 0.05)),
                           padding: `${Math.max(3, width*0.014)}px ${Math.max(6, width*0.03)}px` }}>
              {rarity_class}{rarity_class === 'UR' && <span className="rc-spk">✦</span>}
            </span>
          )}

          {/* ── Common corner ornaments (purple frame diamonds) ─────────────────── */}
          {rarity === 'common' && ['topLeft','topRight','botLeft','botRight'].filter(pos => !(rarity_class && pos === 'topLeft')).map(pos => (
            <span key={pos} style={{
              position: 'absolute', zIndex: 7,
              color: '#9F8FEF', fontSize: 12, lineHeight: 1,
              ...(pos === 'topLeft'  ? { top: 8, left: 8 }  : {}),
              ...(pos === 'topRight' ? { top: 8, right: 8 } : {}),
              ...(pos === 'botLeft'  ? { bottom: 8, left: 8 }  : {}),
              ...(pos === 'botRight' ? { bottom: 8, right: 8 } : {}),
            }}>◆</span>
          ))}

          {/* legendary flame removed — replaced by holofoil */}

          {/* relic sparkles removed — superseded by holo-rare effect */}

          {/* ── Flower field — base celestial gets the white sparkles; every
              Prestige card wears the same field (golden & denser when it's a UR). ── */}
          {rarity === 'celestial' && !isUR && !isPrestige && showEffects && inViewport && (
            <Sparkles count={24} color="#E8E8FF" size={[6, 20]} />
          )}
          {isPrestige && showEffects && inViewport && (
            <Sparkles count={isUR ? 44 : 26} color={isUR ? '#FFD700' : '#E8E8FF'} size={[6, 20]} />
          )}



          {/* ── Rarity frame border overlay ───────────────────────────────────────── */}
          <img
            src={FRAME_ASSET[rarity] || FRAME_ASSET.common}
            alt=""
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              objectFit: 'fill',
              pointerEvents: 'none',
              zIndex: 5,
              borderRadius: 14,
            }}
          />

          {/* ── Epic warm glow overlay (orange frame, CSS — no external file) ── */}
          {rarity === 'epic' && (
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              height: '58%',
              background: 'radial-gradient(ellipse 120% 80% at 50% 100%, rgba(255,140,0,0.38) 0%, rgba(200,80,0,0.22) 40%, rgba(120,40,0,0.10) 70%, transparent 100%)',
              mixBlendMode: 'screen',
              opacity: 0.85,
              pointerEvents: 'none',
              zIndex: 6,
              borderBottomLeftRadius: 14,
              borderBottomRightRadius: 14,
            }} />
          )}

          {/* ── Portrait image ──────────────────────────────────────────────────── */}
          <div style={{
            position: 'absolute', inset: 0,
            overflow: 'hidden', zIndex: 2,
            borderRadius: 14,
          }}>
            {(image_url || thumb_url || creator_avatar) ? (
              <>
                {/* Instant card-back placeholder — paints immediately, is
                    covered once the real portrait image finishes loading. */}
                <div style={{
                  position: 'absolute', inset: 0,
                  borderRadius: 14,
                  background: `radial-gradient(circle at 50% 40%, ${cfg.badge}22, #12121a 70%)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden',
                }}>
                  <span style={{
                    fontSize: width * 0.4,
                    color: cfg.badge,
                    opacity: 0.18,
                    lineHeight: 1,
                  }}>◆</span>
                </div>
                <img
                  src={fullRes ? (image_url || thumb_url || creator_avatar) : (thumb_url || creator_avatar || image_url)}
                  alt=""
                  style={{
                    position: 'relative',
                    width: '100%', height: '100%',
                    objectFit: 'cover',
                    objectPosition: `${image_focal_x * 100}% ${image_focal_y * 100}%`,
                    display: 'block',
                    borderRadius: 14,
                    opacity: imgLoaded ? 1 : 0,
                    transition: 'opacity .35s ease',
                  }}
                  onLoad={() => setImgLoaded(true)}
                  onError={e => { e.target.style.display = 'none' }}
                />
              </>
            ) : (
              <div style={{
                width: '100%', height: '100%',
                background: 'rgba(255,255,255,0.04)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'rgba(255,255,255,0.1)', fontSize: 32,
                borderRadius: 14,
              }}>🃏</div>
            )}
            {/* Portrait bottom fade */}
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, height: 64,
              background: `linear-gradient(to bottom, transparent, ${
                rarity === 'common' ? 'rgba(14,10,30,0.6)'
                : rarity === 'legendary' ? 'rgba(26,18,0,0.6)'
                : 'rgba(13,13,20,0.6)'
              })`,
              zIndex: 3,
              borderBottomLeftRadius: 14,
              borderBottomRightRadius: 14,
            }} />
          {/* legendary warm glow removed */}
          </div>

          {/* ── Common (purple) FOIL — verbatim CodePen holo (original assets). */}
          {rarity === 'common' && isUR && inViewport && showEffects && (thumb_url || image_url || creator_avatar) && (
            <div className="card-cdp-group" style={{
              position: 'absolute', inset: 0, overflow: 'hidden',
              zIndex: 4, pointerEvents: 'none',
              borderRadius: 14,
              backgroundImage: `url(${fullRes ? (image_url || thumb_url || creator_avatar) : (thumb_url || creator_avatar || image_url)})`,
              backgroundSize: 'cover',
              backgroundPosition: `${image_focal_x * 100}% ${image_focal_y * 100}%`,
            }}>
              <div className="card-cdp-a" style={{ position: 'absolute', inset: 0 }} />
              <div className="card-cdp-b" style={{ position: 'absolute', inset: 0 }} />
            </div>
          )}

          {/* ── Foil Celestial — same CodePen technique but uses its OWN classes
              (card-cdp-cel-a/b) referencing /sparkles-celestial.gif and
              /holo-celestial.png — swap those files freely without touching
              the purple foil assets. */}
          {rarity === 'celestial' && isUR && inViewport && showEffects && (thumb_url || image_url || creator_avatar) && (
            <div className="card-cdp-group" style={{
              position: 'absolute', inset: 0, overflow: 'hidden',
              zIndex: 4, pointerEvents: 'none',
              borderRadius: 14,
              backgroundImage: `url(${fullRes ? (image_url || thumb_url || creator_avatar) : (thumb_url || creator_avatar || image_url)})`,
              backgroundSize: 'cover',
              backgroundPosition: `${image_focal_x * 100}% ${image_focal_y * 100}%`,
            }}>
              <div className="card-cdp-cel-a" style={{ position: 'absolute', inset: 0 }} />
              <div className="card-cdp-cel-b" style={{ position: 'absolute', inset: 0 }} />
            </div>
          )}

          {/* ── Foil Legendary — same CodePen technique, own classes (card-cdp-leg-a/b)
              referencing /sparkles-legendary.gif and /holo-legendary.png — swap
              those files freely without touching any other foil rarity. */}
          {rarity === 'legendary' && isUR && inViewport && showEffects && (thumb_url || image_url || creator_avatar) && (
            <div className="card-cdp-group" style={{
              position: 'absolute', inset: 0, overflow: 'hidden',
              zIndex: 4, pointerEvents: 'none',
              borderRadius: 14,
              backgroundImage: `url(${fullRes ? (image_url || thumb_url || creator_avatar) : (thumb_url || creator_avatar || image_url)})`,
              backgroundSize: 'cover',
              backgroundPosition: `${image_focal_x * 100}% ${image_focal_y * 100}%`,
            }}>
              <div className="card-cdp-leg-a" style={{ position: 'absolute', inset: 0 }} />
              <div className="card-cdp-leg-b" style={{ position: 'absolute', inset: 0 }} />
            </div>
          )}

          {/* ── Bottom info section ──────────────────────────────────────────────── */}
          {!hideLabel && <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            zIndex: 9, pointerEvents: 'none',
            padding: `0 10px ${Math.min(22, Math.max(10, width * 0.05))}px`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
          }}>
            {/* Type label — always above */}
            <div style={{
              fontSize: Math.min(16, Math.max(9, width * 0.038)),
              color: '#ffffff',
              letterSpacing: '0.12em', textTransform: 'uppercase',
              fontFamily: "'Cause', 'Inter', system-ui, sans-serif",
              fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              {isPrestige ? (
                <span className="vc-prestige-label" style={{ fontSize: Math.max(9, width * 0.05) }}>✦ PRESTIGE</span>
              ) : foil && (
                <span style={{
                  animation: 'rainbow-text 3s linear infinite',
                  fontWeight: 800, letterSpacing: '0.14em',
                }}>✨FOIL</span>
              )}
              {subLabel}
            </div>

            {/* Level pips — 10 dots, filled to the card's level */}
            {width > 150 && level > 1 && (
              <div style={{ display: 'flex', gap: 3, alignItems: 'center', marginTop: 1 }}>
                {Array.from({ length: 10 }, (_, i) => (
                  <span key={i} style={{
                    width: Math.max(4, width * 0.018), height: Math.max(4, width * 0.018),
                    borderRadius: '50%',
                    background: i < level ? cfg.badge : 'rgba(255,255,255,0.14)',
                    boxShadow: i < level && level >= 8 ? `0 0 6px ${cfg.badge}` : 'none',
                  }} />
                ))}
              </div>
            )}

            {/* Solid lines + rarity when large enough */}
            {width > 200 && (
              <div style={{ height: '0.5px', width: '80%', background: `${cfg.badge}55`, margin: '3px 0 2px' }} />
            )}
            <div style={{
              fontSize: Math.min(30, Math.max(13, width * 0.065)), fontWeight: 900,
              letterSpacing: '0.13em', textTransform: 'uppercase',
              color: cfg.badge,
              textShadow: cfg.animated ? `0 0 12px ${cfg.badge}` : 'none',
              overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
              maxWidth: '100%',
              fontFamily: "'Cause', 'Inter', system-ui, sans-serif",
              ...(rarity === 'celestial'
                ? { animation: 'rainbow-text 3s linear infinite', textShadow: 'none' }
                : (cfg.animated ? nameAnim : {})),
            }}>
              {rarity === 'celestial' ? '✦ CELESTIAL' : cfg.label.toUpperCase()}
            </div>
            {width > 200 && (
              <div style={{ height: '0.5px', width: '80%', background: `${cfg.badge}55`, margin: '2px 0 0' }} />
            )}
          </div>}
        </div>

        {/* ── Holo effects at backplate level — cover full card including frame ──
            Tier ladder: common = soft glare · epic = metal tilt shimmer ·
            legendary = gold cosmic dust · celestial = sunpillar prism.
            PERF: the layers stay MOUNTED while the card is on screen and only
            their container's opacity toggles on hover. Mounting them on hover
            forced the browser to build + rasterize the whole gradient/blend
            stack at hover-entry — that synchronous raster was the "takes
            forever to start hovering" freeze, paid on every single re-hover.
            Now it's paid once per scroll-into-view; hovers are compositor-only. */}
        {inViewport && forceEffects !== false && (
          <div style={{
            position: 'absolute', inset: 0, borderRadius: 18, zIndex: 2,
            pointerEvents: 'none', overflow: 'hidden',
            willChange: 'transform',
            transform: 'translateZ(0)',
            opacity: showEffects ? 1 : 0,
            // Grid cards (small, not cursorTrack): snap opacity instantly so the
            // 180ms fade never re-rasters the blend stack at 60fps on hover entry.
            // The viewer (cursorTrack / large) keeps the fade for a smooth reveal.
            transition: cursorTrack || width > 300 ? 'opacity 0.18s ease' : 'none',
          }}>
            {/* Common (purple) FOILS use the CodePen holo in a dedicated
                photo-backed group rendered separately (below); plain commons
                keep the light glare. */}
            {rarity === 'common' && !isUR && !isPrestige && (
              <div className="card-holo-trainer" style={{ position: 'absolute', inset: 0, borderRadius: 18 }} />
            )}
            {rarity === 'epic' && !isUR && !isPrestige && (
              <>
                <div className="card-holo-cosmos-a" style={{ position: 'absolute', inset: 0, borderRadius: 18 }} />
                <div className="card-holo-cosmos-b" style={{ position: 'absolute', inset: 0, borderRadius: 18 }} />
                {level >= 5 && (
                  <div className="card-holo-regular-a" style={{ position: 'absolute', inset: 0, borderRadius: 18, opacity: 0.35 }} />
                )}
              </>
            )}
            {/* Legendary relic dust — non-foil only; foil legendaries use CodePen holo */}
            {rarity === 'legendary' && !isUR && !isPrestige && (
              <>
                <div className="card-holo-relic-a" style={{ position: 'absolute', inset: 0, borderRadius: 18 }} />
                <div className="card-holo-relic-b" style={{ position: 'absolute', inset: 0, borderRadius: 18 }} />
                <div className="card-holo-relic-c" style={{ position: 'absolute', inset: 0, borderRadius: 18 }} />
                {level >= 5 && (
                  <div className="card-holo-regular-b" style={{ position: 'absolute', inset: 0, borderRadius: 18 }} />
                )}
              </>
            )}
            {/* Celestial rainbow prism — on base celestial AND on every Prestige
                card (Prestige wears the celestial base treatment). UR celestials
                use the CodePen holo instead. */}
            {((rarity === 'celestial' && !isUR && !isPrestige) || isPrestige) && (
              <>
                <div className="card-holo-v-a" style={{ position: 'absolute', inset: 0, borderRadius: 18 }} />
                <div className="card-holo-v-b" style={{ position: 'absolute', inset: 0, borderRadius: 18 }} />
              </>
            )}
            {/* Foil hover kit — epic foils only now (common/celestial/legendary use CodePen holo) */}
            {isUR && rarity === 'epic' && (
              <>
                <div className="card-foil-iris" style={{ position: 'absolute', inset: 0, borderRadius: 18 }} />
                <div className="card-holo-vmax-b" style={{ position: 'absolute', inset: 0, borderRadius: 18, opacity: 0.18 }} />
              </>
            )}
            {isUR && rarity === 'epic' && (
              <div className="card-foil-glitter" style={{ position: 'absolute', inset: 0, borderRadius: 18 }} />
            )}
          </div>
        )}

        {/* ── FOIL resting sheen — epic foils only now; common/celestial/legendary
            use the CodePen holo instead. */}
        {isUR && rarity === 'epic' && inViewport && (
          <div className="card-foil-sweep" style={{
            position: 'absolute', inset: 0, borderRadius: 18, zIndex: 3, pointerEvents: 'none',
            ...(width < 400 ? { filter: 'saturate(1.9) brightness(1.35)' } : {}),
          }} />
        )}

      </div>
    </>
  )
}

// Memoized: without this, any unrelated re-render of an ancestor (e.g. the
// 30s credits-balance poll on the Collection page) forces every mounted
// VaultCard — including the one in an open CardViewer — to recompute and
// repaint its full holo/foil blend-mode+mask+filter stack, which reads as a
// multi-second freeze. `card`/`style` keep stable references across those
// unrelated re-renders (they only change when the actual card data changes),
// so a shallow prop comparison is sufficient to skip the repaint.
export default React.memo(VaultCard)

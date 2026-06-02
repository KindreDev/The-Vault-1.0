import React, { useRef, useEffect, useCallback, useState } from 'react'

// ── Rarity constants ──────────────────────────────────────────────────────────
export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'relic', 'celestial']

export const RARITY_CONFIG = {
  common: {
    border: 'rgba(150,150,150,0.5)',
    glow:   'rgba(150,150,150,0)',
    badge:  '#888',
    label:  'Common',
    animated: false,
  },
  uncommon: {
    border: 'rgba(29,158,117,0.7)',
    glow:   'rgba(29,158,117,0.15)',
    badge:  '#1D9E75',
    label:  'Uncommon',
    animated: false,
  },
  rare: {
    border: 'rgba(70,130,220,0.8)',
    glow:   'rgba(70,130,220,0.25)',
    badge:  '#4682DC',
    label:  'Rare',
    animated: false,
    shimmer: true,
  },
  epic: {
    border: '#7F77DD',
    glow:   'rgba(127,119,221,0.55)',
    badge:  '#9F8FEF',
    label:  'Epic',
    animated: true,
  },
  legendary: {
    border: '#cc5500',
    glow:   'rgba(255,100,0,0.7)',
    badge:  '#ff8800',
    label:  'Legendary',
    animated: true,
  },
  relic: {
    border: '#c9a84c',
    glow:   'rgba(255,215,0,0.5)',
    badge:  '#FFD700',
    label:  'Relic',
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
export default function VaultCard({
  card,
  width = 220,
  onClick,
  style = {},
  forceEffects,
  disableTilt,
  fullRes = false,
  hideLabel = false,
}) {
  const [isHovered, setIsHovered] = useState(false)
  const showEffects = forceEffects !== undefined ? forceEffects : (width > 300 || isHovered)

  const {
    rarity = 'common',
    is_relic = false,
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

  const cfg = RARITY_CONFIG[rarity] || RARITY_CONFIG.common
  const height = Math.round(width * 1.45)
  const cardRef = useRef(null)

  // ── Holographic tilt + cursor-tracked holo effects ───────────────────────
  const handleMouseMove = useCallback((e) => {
    if (forceEffects === false) return
    const el = cardRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top  + rect.height / 2
    const dx = (e.clientX - cx) / (rect.width / 2)
    const dy = (e.clientY - cy) / (rect.height / 2)

    const px = Math.round(((e.clientX - rect.left) / rect.width) * 100)
    const py = Math.round(((e.clientY - rect.top) / rect.height) * 100)
    const fromCenter = Math.min(1, Math.sqrt(dx * dx + dy * dy) / Math.SQRT2)

    el.style.setProperty('--pointer-x', `${px}%`)
    el.style.setProperty('--pointer-y', `${py}%`)
    el.style.setProperty('--pointer-from-center', fromCenter)
    el.style.setProperty('--pointer-from-left', px / 100)
    el.style.setProperty('--pointer-from-top', py / 100)
    el.style.setProperty('--background-x', `${px}%`)
    el.style.setProperty('--background-y', `${py}%`)

    if (rarity === 'celestial') {
      const angle = Math.atan2(dy, dx) * (180 / Math.PI) + 180
      el.style.setProperty('--holo-angle', `${angle}deg`)
    }

    if (!disableTilt) {
      el.style.transform = `perspective(800px) rotateY(${dx * 8}deg) rotateX(${-dy * 8}deg) scale(1.03)`
    }
  }, [rarity, disableTilt, forceEffects])

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true)
  }, [])

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
    : 'Photo'

  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  // ── Rarity-aware name styling ──────────────────────────────────────────────
  const nameColor =
    rarity === 'celestial' ? '#E8E8FF' :
    rarity === 'legendary' ? '#FFB347' :
    rarity === 'epic'      ? '#CECBF6' :
    rarity === 'relic'     ? '#FFD700' :
    rarity === 'rare'      ? '#7AB8E8' :
    rarity === 'uncommon'  ? '#4FB896' :
    '#fff'

  const nameAnim = cfg.animated ? (
    rarity === 'celestial' ? { animation: 'cosmic-name-glow 2s ease-in-out infinite' } :
    rarity === 'legendary' ? { animation: 'legendary-name-glow 1.2s ease-in-out infinite' } :
    rarity === 'epic'      ? { animation: 'epic-name-glow 1.8s ease-in-out infinite' } :
    rarity === 'relic'     ? { animation: 'relic-name-glow 1.5s ease-in-out infinite' } :
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
    if (rarity === 'relic') {
      return {
        border: `0.5px solid ${cfg.border}`,
        boxShadow: `0 0 18px ${cfg.glow}, 0 0 36px rgba(186,117,23,0.2)`,
      }
    }
    if (rarity === 'legendary') {
      return {
        border: `0.5px solid ${cfg.border}`,
        boxShadow: `0 0 20px ${cfg.glow}, 0 0 40px rgba(180,80,0,0.2)`,
      }
    }
    if (rarity === 'epic') {
      return {
        border: `0.5px solid ${cfg.border}`,
        boxShadow: `0 0 16px ${cfg.glow}, 0 0 32px rgba(80,40,160,0.2)`,
      }
    }
    if (rarity === 'rare') {
      return {
        border: `0.5px solid ${cfg.border}`,
        boxShadow: `0 0 8px ${cfg.glow}`,
      }
    }
    return {
      border: `0.5px solid ${cfg.border}`,
      boxShadow: 'none',
    }
  })()

  // ── Card background ────────────────────────────────────────────────────────
  const cardBg = rarity === 'celestial'
    ? '#0d0d14'
    : rarity === 'relic'
    ? 'linear-gradient(135deg, #1a1200 0%, #2a1e00 40%, #1a1200 100%)'
    : rarity === 'legendary'
    ? '#0d0d14'
    : rarity === 'epic'
    ? 'linear-gradient(160deg, #0e0a1e 0%, #1a0a2e 60%, #0e0a1e 100%)'
    : '#0d0d14'

  return (
    <>
      <style>{`
        @keyframes epic-smoke {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50%       { opacity: 0.85; transform: scale(1.06); }
        }
        @keyframes flame-flicker {
          0%, 100% { box-shadow: 0 0 30px #ff6600, 0 0 60px #ff3300, inset 0 0 20px rgba(255,100,0,0.2); }
          33%  { box-shadow: 0 0 42px #ff8800, 0 0 72px #ff5500, inset 0 0 28px rgba(255,140,0,0.3); }
          66%  { box-shadow: 0 0 22px #ff4400, 0 0 44px #ff2200, inset 0 0 14px rgba(255,80,0,0.15); }
        }
        @keyframes gold-shimmer {
          0%   { background-position: -300% center; }
          100% { background-position: 300% center; }
        }
        @keyframes holo-border-spin {
          from { --holo-angle: 0deg; }
          to   { --holo-angle: 360deg; }
        }
        @keyframes sparkle-twinkle {
          0%, 100% { opacity: 0; transform: scale(0.3) rotate(0deg); }
          50%       { opacity: 1; transform: scale(1) rotate(20deg); }
        }
        @keyframes rare-shimmer {
          0%   { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes cosmic-text-glow {
          0%, 100% { text-shadow: 0 0 6px #fff, 0 0 14px #aaf, 0 0 30px #88f; }
          50%       { text-shadow: 0 0 10px #fff, 0 0 24px #fff, 0 0 50px #ccf; }
        }
        @keyframes cosmic-name-glow {
          0%, 100% { text-shadow: 0 0 6px #E8E8FF, 0 0 14px #aaf, 0 0 28px #88f; }
          50%       { text-shadow: 0 0 12px #fff, 0 0 24px #ccf, 0 0 50px #aaf; }
        }
        @keyframes legendary-name-glow {
          0%, 100% { text-shadow: 0 0 8px rgba(255,140,0,1), 0 0 20px rgba(255,80,0,0.7), 0 0 40px rgba(255,60,0,0.3); }
          50%       { text-shadow: 0 0 16px rgba(255,220,0,1), 0 0 32px rgba(255,140,0,0.9), 0 0 60px rgba(255,60,0,0.5); }
        }
        @keyframes epic-name-glow {
          0%, 100% { text-shadow: 0 0 8px rgba(180,160,255,0.9), 0 0 20px rgba(127,119,221,0.7), 0 0 40px rgba(100,80,200,0.4); }
          50%       { text-shadow: 0 0 16px rgba(220,210,255,1), 0 0 36px rgba(180,160,255,0.9), 0 0 60px rgba(127,119,221,0.6); }
        }
        @keyframes relic-name-glow {
          0%, 100% { text-shadow: 0 0 8px rgba(255,215,0,1), 0 0 20px rgba(200,160,0,0.7), 0 0 40px rgba(180,130,0,0.3); }
          50%       { text-shadow: 0 0 16px rgba(255,245,120,1), 0 0 32px rgba(255,215,0,0.9), 0 0 60px rgba(200,160,0,0.5); }
        }
        @property --holo-angle {
          syntax: '<angle>';
          inherits: false;
          initial-value: 135deg;
        }
        @keyframes rainbow-text {
          0%   { color: hsl(0,100%,70%);   text-shadow: 0 0 10px hsl(0,100%,60%); }
          14%  { color: hsl(40,100%,65%);  text-shadow: 0 0 10px hsl(40,100%,55%); }
          28%  { color: hsl(80,100%,65%);  text-shadow: 0 0 10px hsl(80,100%,55%); }
          42%  { color: hsl(160,100%,65%); text-shadow: 0 0 10px hsl(160,100%,55%); }
          57%  { color: hsl(220,100%,75%); text-shadow: 0 0 10px hsl(220,100%,65%); }
          71%  { color: hsl(270,100%,75%); text-shadow: 0 0 10px hsl(270,100%,65%); }
          85%  { color: hsl(310,100%,70%); text-shadow: 0 0 10px hsl(310,100%,60%); }
          100% { color: hsl(0,100%,70%);   text-shadow: 0 0 10px hsl(0,100%,60%); }
        }

        /* ── Common/Uncommon: glare ──────────────────────────────────── */
        .card-holo-trainer {
          background-image:
            radial-gradient(
              farthest-corner circle at var(--pointer-x, 50%) var(--pointer-y, 50%),
              hsla(0,0%,100%,.38) 5%, hsla(0,0%,100%,.12) 50%, transparent 78%
            );
          mix-blend-mode: overlay;
          filter: brightness(calc(1.0 + var(--pointer-from-center, 0) * .7));
          opacity: 1;
        }

        /* ── Rare: Metal tilt shimmer — two offset layers break the grid ── */
        .card-holo-cosmos-a {
          background-image:
            url('/metal.png'),
            url('/metal.png'),
            radial-gradient(
              ellipse 80% 60% at var(--pointer-x, 50%) var(--pointer-y, 50%),
              hsla(0,0%,100%,.2) 0%, transparent 70%
            );
          background-blend-mode: overlay, screen, normal;
          background-size: 83px 67px, 109px 91px, cover;
          background-position:
            calc(var(--pointer-x, 50%) * 0.3) calc(var(--pointer-y, 50%) * 0.3),
            calc(50% - var(--pointer-x, 50%) * 0.2) calc(50% - var(--pointer-y, 50%) * 0.2),
            center;
          mix-blend-mode: overlay;
          filter: brightness(1.4) contrast(1.1) saturate(0);
          opacity: calc(var(--pointer-from-center, 0) * 0.25);
        }

        /* ── Rare: Metal glint — Layer B ─────────────────────────────── */
        .card-holo-cosmos-b {
          background-image:
            radial-gradient(
              ellipse 70% 55% at var(--pointer-x, 50%) var(--pointer-y, 50%),
              hsla(0,0%,100%,.5) 0%,
              hsla(0,0%,100%,.15) 40%,
              transparent 68%
            );
          mix-blend-mode: overlay;
          opacity: calc(var(--pointer-from-center, 0) * 0.55);
        }

        /* ── Epic: VMAX Holofoil — Layer A (texture + multicolor foil) ── */
        .card-holo-vmax-a {
          background-image:
            url('/vmaxbg.jpg'),
            repeating-linear-gradient(
              -33deg,
              hsl(2,40%,47%) 6%,
              hsl(228,35%,64%) 12%,
              hsl(176,35%,39%) 18%,
              hsl(123,38%,35%) 24%,
              hsl(283,42%,57%) 30%,
              hsl(2,40%,47%) 36%
            ),
            repeating-linear-gradient(
              133deg,
              hsla(227,53%,12%,.5) 0%,
              hsl(180,10%,50%) 2.5%,
              hsl(83,50%,35%) 5%,
              hsl(180,10%,50%) 7.5%,
              hsla(227,53%,12%,.5) 10%,
              hsla(227,53%,12%,.5) 15%
            ),
            radial-gradient(
              farthest-corner circle at var(--pointer-x, 50%) var(--pointer-y, 50%),
              hsla(189,76%,77%,.6) 0%,
              hsla(147,59%,77%,.6) 25%,
              hsla(271,55%,69%,.6) 50%,
              hsla(355,56%,72%,.6) 75%
            );
          background-blend-mode: difference, luminosity, soft-light;
          background-size: 116px 97px, 1100% 1100%, 600% 600%, 200% 200%;
          background-position:
            calc(var(--pointer-x, 50%) * 0.4) calc(var(--pointer-y, 50%) * 0.4),
            var(--background-x, 50%) var(--background-y, 50%),
            var(--background-x, 50%) var(--background-y, 50%),
            var(--background-x, 50%) var(--background-y, 50%);
          filter: brightness(calc(var(--pointer-from-center, 0) * .6 + .3)) contrast(1.4) saturate(.45);
          mix-blend-mode: screen;
          opacity: calc(0.05 + var(--pointer-from-center, 0) * 0.6);
        }

        /* ── Epic: VMAX — Layer B (sunpillar overlay) ─────────────────── */
        .card-holo-vmax-b {
          background-image:
            repeating-linear-gradient(
              0deg,
              hsl(2,85%,55%) 6%,
              hsl(35,90%,55%) 12%,
              hsl(60,100%,55%) 18%,
              hsl(120,80%,45%) 24%,
              hsl(200,90%,55%) 30%,
              hsl(270,80%,60%) 36%,
              hsl(2,85%,55%) 42%
            ),
            repeating-linear-gradient(
              133deg,
              #0e152e 0%,
              hsl(180,10%,60%) 3.8%,
              hsl(180,29%,66%) 4.5%,
              hsl(180,10%,60%) 5.2%,
              #0e152e 10%,
              #0e152e 12%
            );
          background-blend-mode: hue, hard-light;
          background-size: 200% 700%, 300% 100%;
          background-position: 0% var(--background-y, 50%), var(--background-x, 50%) var(--background-y, 50%);
          mix-blend-mode: lighten;
          opacity: calc(.15 + var(--pointer-from-center, 0) * .3);
        }

        /* ── Legendary: Trainer Gallery iridescent foil — Layer A ───── */
        .card-holo-regular-a {
          background-image:
            repeating-linear-gradient(
              -22deg,
              hsla(283,49%,60%,.6) 5%,
              hsla(2,74%,59%,.6) 10%,
              hsla(53,67%,53%,.6) 15%,
              hsla(93,56%,52%,.6) 20%,
              hsla(176,38%,50%,.6) 25%,
              hsla(228,100%,77%,.6) 30%,
              hsla(283,49%,61%,.6) 35%
            );
          background-size: 300% 400%;
          background-position: 0% calc(var(--background-y, 50%) * 1);
          mix-blend-mode: screen;
          filter: brightness(calc(var(--pointer-from-center, 0) * .4 + .25)) contrast(1.4) saturate(.85);
          opacity: .5;
        }

        /* ── Legendary: Trainer Gallery hard-light shimmer — Layer B ── */
        .card-holo-regular-b {
          background-image:
            radial-gradient(
              farthest-corner ellipse
              at calc(var(--pointer-x, 50%) * .5 + 25%) calc(var(--pointer-y, 50%) * .5 + 25%),
              hsl(0,0%,100%) 5%,
              hsla(300,100%,11%,.5) 40%,
              hsl(0,0%,22%) 120%
            );
          background-size: 400% 500%;
          mix-blend-mode: hard-light;
          filter: brightness(calc(var(--pointer-from-center, 0) * .25 + .25)) contrast(.8) saturate(.9);
          opacity: .45;
        }

        /* ── Relic: Cosmic dust specks ────────────────────────────────── */
        /* Layer A: base speck field, invisible at rest */
        .card-holo-relic-a {
          background-image: url('/cosmos-top-trans.png');
          background-size: cover;
          background-position: center;
          mix-blend-mode: screen;
          filter: brightness(1.1) contrast(1.2) saturate(1.0);
          opacity: calc(0.02 + var(--pointer-from-center, 0) * 0.55);
        }

        /* Layer B: 130% scale — different speck positions, breaks duplication */
        .card-holo-relic-b {
          background-image: url('/cosmos-top-trans.png');
          background-size: 130% 130%;
          background-position:
            calc(50% + (var(--pointer-from-left, 0.5) - 0.5) * -50px)
            calc(50% + (var(--pointer-from-top, 0.5) - 0.5) * -50px);
          mix-blend-mode: screen;
          filter: brightness(1.3) contrast(1.2) saturate(1.1) hue-rotate(15deg);
          opacity: calc(0.01 + var(--pointer-from-center, 0) * 0.4);
        }

        /* Layer C: cursor flashlight — specks near cursor flare up */
        .card-holo-relic-c {
          background-image:
            url('/cosmos-top-trans.png'),
            radial-gradient(
              ellipse 40% 40% at var(--pointer-x, 50%) var(--pointer-y, 50%),
              hsla(50,100%,98%,.95) 0%,
              hsla(50,100%,88%,.55) 30%,
              hsla(50,80%,70%,.15) 60%,
              transparent 78%
            );
          background-blend-mode: screen;
          background-size: cover, cover;
          mix-blend-mode: screen;
          filter: brightness(3.5) contrast(1.3) saturate(2.2);
          opacity: calc(var(--pointer-from-center, 0) * 0.72);
        }

        /* ── Celestial: Pokemon V — Layer A (sunpillar bands) ─────────── */
        .card-holo-v-a {
          background-image:
            repeating-linear-gradient(
              0deg,
              hsl(2,85%,55%) 5%,
              hsl(35,90%,55%) 10%,
              hsl(60,100%,55%) 15%,
              hsl(120,80%,45%) 20%,
              hsl(200,90%,55%) 25%,
              hsl(270,80%,60%) 30%,
              hsl(2,85%,55%) 35%
            ),
            repeating-linear-gradient(
              133deg,
              #0e152e 0%,
              hsl(180,10%,60%) 3.8%,
              hsl(180,29%,66%) 4.5%,
              hsl(180,10%,60%) 5.2%,
              #0e152e 10%,
              #0e152e 12%
            ),
            radial-gradient(
              farthest-corner circle at var(--pointer-x, 50%) var(--pointer-y, 50%),
              hsla(0,0%,0%,.1) 12%,
              hsla(0,0%,0%,.15) 20%,
              hsla(0,0%,0%,.25) 120%
            );
          background-blend-mode: screen, hue, hard-light;
          background-size: 200% 700%, 300% 100%, 200% 100%;
          background-position:
            0% var(--background-y, 50%),
            var(--background-x, 50%) var(--background-y, 50%),
            var(--background-x, 50%) var(--background-y, 50%);
          filter: brightness(.55) contrast(1.6) saturate(.4);
          mix-blend-mode: screen;
          opacity: .38;
        }

        /* ── Celestial: Pokemon V — Layer B (soft-light overlay) ──────── */
        .card-holo-v-b {
          background-image:
            repeating-linear-gradient(
              0deg,
              hsl(2,85%,55%) 5%,
              hsl(35,90%,55%) 10%,
              hsl(60,100%,55%) 15%,
              hsl(120,80%,45%) 20%,
              hsl(200,90%,55%) 25%,
              hsl(270,80%,60%) 30%,
              hsl(2,85%,55%) 35%
            ),
            repeating-linear-gradient(
              133deg,
              #0e152e 0%,
              hsl(180,10%,60%) 3.8%,
              hsl(180,29%,66%) 4.5%,
              hsl(180,10%,60%) 5.2%,
              #0e152e 10%,
              #0e152e 12%
            );
          background-blend-mode: hue, hard-light;
          background-size: 200% 200%, 195% 100%;
          background-position:
            var(--background-x, 50%) var(--background-y, 50%),
            calc(var(--background-x, 50%) * -1) calc(var(--background-y, 50%) * -1);
          mix-blend-mode: soft-light;
          filter: brightness(.7) contrast(1.5) saturate(1.0);
          opacity: .32;
        }
      `}</style>

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
          ...style,
        }}
      >
        <div
          style={{
            position: 'relative',
            width,
            height,
            borderRadius: 14,
            overflow: 'hidden',
            background: cardBg,
            ...borderStyle,
            // (legendary flame-flicker removed — using holofoil effect now)
            // Celestial holographic border spin when mouse not hovering
            ...(rarity === 'celestial' ? { animation: 'holo-border-spin 3s linear infinite' } : {}),
          }}
        >
          {/* ── Name at Top Center ───────────────────────────────────────────── */}
          {!hideLabel && <div style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            padding: '12px 12px 20px', zIndex: 10,
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.80) 0%, transparent 100%)',
            textAlign: 'center', pointerEvents: 'none',
            fontFamily: "'Cause', 'Inter', system-ui, sans-serif",
          }}>
            {card_type === 'collab' && collab_data ? (
              /* Collab: multiple creators [as multiple characters] */
              (() => {
                const names    = collab_data.creator_names   || []
                const charNames = collab_data.character_names || []
                const joinedCreators   = names.join(' & ')
                const joinedCharacters = charNames.join(' & ')
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

          {/* ── Epic corner ornaments ──────────────────────────────────────────── */}
          {rarity === 'epic' && ['topLeft','topRight','botLeft','botRight'].map(pos => (
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

          {/* ── Celestial sparkles ─────────────────────────────────────────────── */}
          {rarity === 'celestial' && showEffects && (
            <Sparkles count={24} color="#E8E8FF" size={[6, 20]} />
          )}



          {/* ── Rarity frame border overlay ───────────────────────────────────────── */}
          <img
            src={`/${rarity === 'celestial' ? 'celestial' : rarity}.png`}
            alt=""
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              objectFit: 'fill',
              pointerEvents: 'none',
              zIndex: 5,
            }}
          />

          {/* ── Legendary warm glow overlay (CSS — no external file needed) ──── */}
          {rarity === 'legendary' && (
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              height: '58%',
              background: 'radial-gradient(ellipse 120% 80% at 50% 100%, rgba(255,140,0,0.38) 0%, rgba(200,80,0,0.22) 40%, rgba(120,40,0,0.10) 70%, transparent 100%)',
              mixBlendMode: 'screen',
              opacity: 0.85,
              pointerEvents: 'none',
              zIndex: 6,
            }} />
          )}

          {/* ── Portrait image ──────────────────────────────────────────────────── */}
          <div style={{
            position: 'absolute', inset: 0,
            overflow: 'hidden', zIndex: 2,
            borderRadius: 0,
          }}>
            {(image_url || thumb_url || creator_avatar) ? (
              <img
                src={fullRes ? (image_url || thumb_url || creator_avatar) : (thumb_url || creator_avatar || image_url)}
                alt=""
                style={{
                  width: '100%', height: '100%',
                  objectFit: 'cover',
                  objectPosition: `${image_focal_x * 100}% ${image_focal_y * 100}%`,
                  display: 'block',
                }}
                onError={e => { e.target.style.display = 'none' }}
              />
            ) : (
              <div style={{
                width: '100%', height: '100%',
                background: 'rgba(255,255,255,0.04)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'rgba(255,255,255,0.1)', fontSize: 32,
              }}>🃏</div>
            )}
            {/* Portrait bottom fade */}
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, height: 64,
              background: `linear-gradient(to bottom, transparent, ${
                rarity === 'epic' ? 'rgba(14,10,30,0.6)'
                : rarity === 'relic' ? 'rgba(26,18,0,0.6)'
                : 'rgba(13,13,20,0.6)'
              })`,
              zIndex: 3,
            }} />
          {/* legendary warm glow removed */}
          </div>

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
            }}>
              {subLabel}
            </div>

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

        {/* ── Holo effects at backplate level — cover full card including frame ── */}
        {showEffects && (rarity === 'common' || rarity === 'uncommon') && (
          <div className="card-holo-trainer" style={{ position: 'absolute', inset: 0, borderRadius: 18, zIndex: 2, pointerEvents: 'none' }} />
        )}
        {showEffects && rarity === 'rare' && (
          <>
            <div className="card-holo-cosmos-a" style={{ position: 'absolute', inset: 0, borderRadius: 18, zIndex: 2, pointerEvents: 'none' }} />
            <div className="card-holo-cosmos-b" style={{ position: 'absolute', inset: 0, borderRadius: 18, zIndex: 2, pointerEvents: 'none' }} />
          </>
        )}
        {showEffects && rarity === 'epic' && (
          <>
            <div className="card-holo-vmax-a" style={{ position: 'absolute', inset: 0, borderRadius: 18, zIndex: 2, pointerEvents: 'none' }} />
            <div className="card-holo-vmax-b" style={{ position: 'absolute', inset: 0, borderRadius: 18, zIndex: 2, pointerEvents: 'none' }} />
          </>
        )}
        {showEffects && rarity === 'legendary' && (
          <>
            <div className="card-holo-regular-a" style={{ position: 'absolute', inset: 0, borderRadius: 18, zIndex: 2, pointerEvents: 'none' }} />
            <div className="card-holo-regular-b" style={{ position: 'absolute', inset: 0, borderRadius: 18, zIndex: 2, pointerEvents: 'none' }} />
          </>
        )}
        {showEffects && rarity === 'relic' && (
          <>
            <div className="card-holo-relic-a" style={{ position: 'absolute', inset: 0, borderRadius: 18, zIndex: 2, pointerEvents: 'none' }} />
            <div className="card-holo-relic-b" style={{ position: 'absolute', inset: 0, borderRadius: 18, zIndex: 2, pointerEvents: 'none' }} />
            <div className="card-holo-relic-c" style={{ position: 'absolute', inset: 0, borderRadius: 18, zIndex: 2, pointerEvents: 'none' }} />
          </>
        )}
        {showEffects && rarity === 'celestial' && (
          <>
            <div className="card-holo-v-a" style={{ position: 'absolute', inset: 0, borderRadius: 18, zIndex: 2, pointerEvents: 'none' }} />
            <div className="card-holo-v-b" style={{ position: 'absolute', inset: 0, borderRadius: 18, zIndex: 2, pointerEvents: 'none' }} />
          </>
        )}
      </div>
    </>
  )
}

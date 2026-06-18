import React, { useRef } from 'react'
import { abs } from '../lib/server.js'

// Mobile TCG card — a faithful port of the desktop VaultCard that KEEPS the full
// holographic foil layers, animated rarity glows, sparkles and rarity frames.
// Since touch devices have no cursor, the cursor-tracked holo is driven by an
// optional `pointer` prop ({ x, y } in 0..1) — the CardViewer feeds this from a
// finger drag. The auto animations (glows, sparkles, celestial spin) run on
// their own and need no pointer.

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'relic', 'celestial']

export const RARITY_CONFIG = {
  common:    { border: 'rgba(150,150,150,0.5)', glow: 'rgba(150,150,150,0)',    badge: '#9aa0a6', label: 'Common',    animated: false },
  uncommon:  { border: 'rgba(29,158,117,0.7)',  glow: 'rgba(29,158,117,0.15)',  badge: '#1D9E75', label: 'Uncommon',  animated: false },
  rare:      { border: 'rgba(70,130,220,0.8)',  glow: 'rgba(70,130,220,0.25)',  badge: '#4682DC', label: 'Rare',      animated: false },
  epic:      { border: '#7F77DD',               glow: 'rgba(127,119,221,0.55)', badge: '#9F8FEF', label: 'Epic',      animated: true  },
  legendary: { border: '#cc5500',               glow: 'rgba(255,100,0,0.7)',    badge: '#ff8800', label: 'Legendary', animated: true  },
  relic:     { border: '#c9a84c',               glow: 'rgba(255,215,0,0.5)',    badge: '#FFD700', label: 'Relic',     animated: true  },
  celestial: { border: 'rgba(255,255,255,0.85)',glow: 'rgba(200,200,255,0.55)', badge: '#E8E8FF', label: 'Celestial', animated: true  },
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Twinkling sparkle spans (celestial).
function Sparkles({ count = 18, color = '#E8E8FF', size = [6, 18] }) {
  const spans = Array.from({ length: count }, () => ({
    top: `${Math.random() * 90}%`, left: `${Math.random() * 90}%`,
    fontSize: `${size[0] + Math.random() * (size[1] - size[0])}px`,
    delay: `${Math.random() * 2}s`, duration: `${1 + Math.random() * 1.5}s`,
    char: Math.random() > 0.5 ? '✦' : '✤',
  }))
  return spans.map((s, i) => (
    <span key={i} style={{
      position: 'absolute', top: s.top, left: s.left, fontSize: s.fontSize, color,
      opacity: 0, pointerEvents: 'none', zIndex: 8,
      animation: `sparkle-twinkle ${s.duration} ease-in-out ${s.delay} infinite`,
    }}>{s.char}</span>
  ))
}

function cardArt(card, fullRes) {
  const raw = fullRes
    ? (card?.image_url || card?.thumb_url || card?.creator_avatar || '')
    : (card?.thumb_url || card?.creator_avatar || card?.image_url || '')
  return raw ? abs(raw) : ''
}

export default function VaultCard({
  card, width = 150, onClick, fullRes = false, hideLabel = false,
  forceEffects, pointer = null, style = {},
}) {
  const cardRef = useRef(null)
  const rarity = card?.rarity || 'common'
  const cfg = RARITY_CONFIG[rarity] || RARITY_CONFIG.common
  const height = Math.round(width * 1.45)

  // On touch we cannot hover, so default to showing effects whenever the card is
  // large (detail view) or effects are explicitly forced on.
  const showEffects = forceEffects !== undefined ? forceEffects : width > 220

  const fx = (card?.image_focal_x ?? card?.focal_x ?? 0.5) * 100
  const fy = (card?.image_focal_y ?? card?.focal_y ?? 0) * 100

  // Pointer-driven holo CSS vars (defaults = rest state, centred).
  const px = pointer ? Math.round(pointer.x * 100) : 50
  const py = pointer ? Math.round(pointer.y * 100) : 50
  const dxc = pointer ? (pointer.x - 0.5) * 2 : 0
  const dyc = pointer ? (pointer.y - 0.5) * 2 : 0
  const fromCenter = pointer ? Math.min(1, Math.sqrt(dxc * dxc + dyc * dyc) / Math.SQRT2) : 0
  const angle = pointer ? (Math.atan2(dyc, dxc) * (180 / Math.PI) + 180) : 135
  const holoVars = {
    '--pointer-x': `${px}%`, '--pointer-y': `${py}%`,
    '--pointer-from-center': fromCenter,
    '--pointer-from-left': px / 100, '--pointer-from-top': py / 100,
    '--background-x': `${px}%`, '--background-y': `${py}%`,
    '--holo-angle': `${angle}deg`,
  }

  const nameColor =
    rarity === 'celestial' ? '#E8E8FF' :
    rarity === 'legendary' ? '#FFB347' :
    rarity === 'epic'      ? '#CECBF6' :
    rarity === 'relic'     ? '#FFD700' :
    rarity === 'rare'      ? '#7AB8E8' :
    rarity === 'uncommon'  ? '#4FB896' : '#fff'

  const nameAnim = cfg.animated ? (
    rarity === 'celestial' ? { animation: 'cosmic-name-glow 2s ease-in-out infinite' } :
    rarity === 'legendary' ? { animation: 'legendary-name-glow 1.2s ease-in-out infinite' } :
    rarity === 'epic'      ? { animation: 'epic-name-glow 1.8s ease-in-out infinite' } :
    rarity === 'relic'     ? { animation: 'relic-name-glow 1.5s ease-in-out infinite' } : {}
  ) : {}

  const borderStyle = (() => {
    if (rarity === 'celestial') return {
      border: '1.5px solid transparent',
      backgroundImage: `linear-gradient(#0d0d1a,#0d0d1a),conic-gradient(from var(--holo-angle,135deg),#ff0000,#ff7700,#ffff00,#00ff88,#0088ff,#aa00ff,#ff0088,#ff0000)`,
      backgroundOrigin: 'border-box', backgroundClip: 'padding-box, border-box',
      boxShadow: '0 0 20px rgba(255,255,255,0.5), 0 0 40px rgba(200,200,255,0.3)',
    }
    if (rarity === 'relic')     return { border: `0.5px solid ${cfg.border}`, boxShadow: `0 0 18px ${cfg.glow}, 0 0 36px rgba(186,117,23,0.2)` }
    if (rarity === 'legendary') return { border: `0.5px solid ${cfg.border}`, boxShadow: `0 0 20px ${cfg.glow}, 0 0 40px rgba(180,80,0,0.2)` }
    if (rarity === 'epic')      return { border: `0.5px solid ${cfg.border}`, boxShadow: `0 0 16px ${cfg.glow}, 0 0 32px rgba(80,40,160,0.2)` }
    if (rarity === 'rare')      return { border: `0.5px solid ${cfg.border}`, boxShadow: `0 0 8px ${cfg.glow}` }
    return { border: `0.5px solid ${cfg.border}`, boxShadow: 'none' }
  })()

  const cardBg = rarity === 'relic' ? 'linear-gradient(135deg,#1a1200 0%,#2a1e00 40%,#1a1200 100%)'
    : rarity === 'epic' ? 'linear-gradient(160deg,#0e0a1e 0%,#1a0a2e 60%,#0e0a1e 100%)'
    : '#0d0d14'

  const art = cardArt(card, fullRes)
  const frame = `/${rarity === 'celestial' ? 'celestial' : rarity}.png`

  return (
    <>
      <style>{`
        @keyframes sparkle-twinkle { 0%,100%{opacity:0;transform:scale(0.3) rotate(0)} 50%{opacity:1;transform:scale(1) rotate(20deg)} }
        @keyframes holo-border-spin { from{--holo-angle:0deg} to{--holo-angle:360deg} }
        @keyframes cosmic-name-glow { 0%,100%{text-shadow:0 0 6px #E8E8FF,0 0 14px #aaf,0 0 28px #88f} 50%{text-shadow:0 0 12px #fff,0 0 24px #ccf,0 0 50px #aaf} }
        @keyframes legendary-name-glow { 0%,100%{text-shadow:0 0 8px rgba(255,140,0,1),0 0 20px rgba(255,80,0,.7),0 0 40px rgba(255,60,0,.3)} 50%{text-shadow:0 0 16px rgba(255,220,0,1),0 0 32px rgba(255,140,0,.9),0 0 60px rgba(255,60,0,.5)} }
        @keyframes epic-name-glow { 0%,100%{text-shadow:0 0 8px rgba(180,160,255,.9),0 0 20px rgba(127,119,221,.7),0 0 40px rgba(100,80,200,.4)} 50%{text-shadow:0 0 16px rgba(220,210,255,1),0 0 36px rgba(180,160,255,.9),0 0 60px rgba(127,119,221,.6)} }
        @keyframes relic-name-glow { 0%,100%{text-shadow:0 0 8px rgba(255,215,0,1),0 0 20px rgba(200,160,0,.7),0 0 40px rgba(180,130,0,.3)} 50%{text-shadow:0 0 16px rgba(255,245,120,1),0 0 32px rgba(255,215,0,.9),0 0 60px rgba(200,160,0,.5)} }
        @keyframes rainbow-text { 0%{color:hsl(0,100%,70%)} 25%{color:hsl(80,100%,65%)} 50%{color:hsl(200,100%,75%)} 75%{color:hsl(300,100%,70%)} 100%{color:hsl(0,100%,70%)} }
        @property --holo-angle { syntax:'<angle>'; inherits:false; initial-value:135deg; }
        .mc-holo-trainer { background-image: radial-gradient(farthest-corner circle at var(--pointer-x,50%) var(--pointer-y,50%), hsla(0,0%,100%,.38) 5%, hsla(0,0%,100%,.12) 50%, transparent 78%); mix-blend-mode:overlay; filter:brightness(calc(1.0 + var(--pointer-from-center,0)*.7)); }
        .mc-holo-cosmos-a { background-image:url('/metal.png'),url('/metal.png'),radial-gradient(ellipse 80% 60% at var(--pointer-x,50%) var(--pointer-y,50%),hsla(0,0%,100%,.2) 0%,transparent 70%); background-blend-mode:overlay,screen,normal; background-size:83px 67px,109px 91px,cover; background-position:calc(var(--pointer-x,50%)*0.3) calc(var(--pointer-y,50%)*0.3),calc(50% - var(--pointer-x,50%)*0.2) calc(50% - var(--pointer-y,50%)*0.2),center; mix-blend-mode:overlay; filter:brightness(1.4) contrast(1.1) saturate(0); opacity:calc(var(--pointer-from-center,0)*0.25); }
        .mc-holo-cosmos-b { background-image:radial-gradient(ellipse 70% 55% at var(--pointer-x,50%) var(--pointer-y,50%),hsla(0,0%,100%,.5) 0%,hsla(0,0%,100%,.15) 40%,transparent 68%); mix-blend-mode:overlay; opacity:calc(var(--pointer-from-center,0)*0.55); }
        .mc-holo-vmax-a { background-image:url('/vmaxbg.jpg'),repeating-linear-gradient(-33deg,hsl(2,40%,47%) 6%,hsl(228,35%,64%) 12%,hsl(176,35%,39%) 18%,hsl(123,38%,35%) 24%,hsl(283,42%,57%) 30%,hsl(2,40%,47%) 36%),repeating-linear-gradient(133deg,hsla(227,53%,12%,.5) 0%,hsl(180,10%,50%) 2.5%,hsl(83,50%,35%) 5%,hsl(180,10%,50%) 7.5%,hsla(227,53%,12%,.5) 10%,hsla(227,53%,12%,.5) 15%),radial-gradient(farthest-corner circle at var(--pointer-x,50%) var(--pointer-y,50%),hsla(189,76%,77%,.6) 0%,hsla(147,59%,77%,.6) 25%,hsla(271,55%,69%,.6) 50%,hsla(355,56%,72%,.6) 75%); background-blend-mode:difference,luminosity,soft-light; background-size:116px 97px,1100% 1100%,600% 600%,200% 200%; background-position:calc(var(--pointer-x,50%)*0.4) calc(var(--pointer-y,50%)*0.4),var(--background-x,50%) var(--background-y,50%),var(--background-x,50%) var(--background-y,50%),var(--background-x,50%) var(--background-y,50%); filter:brightness(calc(var(--pointer-from-center,0)*.6 + .3)) contrast(1.4) saturate(.45); mix-blend-mode:screen; opacity:calc(0.05 + var(--pointer-from-center,0)*0.6); }
        .mc-holo-vmax-b { background-image:repeating-linear-gradient(0deg,hsl(2,85%,55%) 6%,hsl(35,90%,55%) 12%,hsl(60,100%,55%) 18%,hsl(120,80%,45%) 24%,hsl(200,90%,55%) 30%,hsl(270,80%,60%) 36%,hsl(2,85%,55%) 42%),repeating-linear-gradient(133deg,#0e152e 0%,hsl(180,10%,60%) 3.8%,hsl(180,29%,66%) 4.5%,hsl(180,10%,60%) 5.2%,#0e152e 10%,#0e152e 12%); background-blend-mode:hue,hard-light; background-size:200% 700%,300% 100%; background-position:0% var(--background-y,50%),var(--background-x,50%) var(--background-y,50%); mix-blend-mode:lighten; opacity:calc(.15 + var(--pointer-from-center,0)*.3); }
        .mc-holo-regular-a { background-image:repeating-linear-gradient(-22deg,hsla(283,49%,60%,.6) 5%,hsla(2,74%,59%,.6) 10%,hsla(53,67%,53%,.6) 15%,hsla(93,56%,52%,.6) 20%,hsla(176,38%,50%,.6) 25%,hsla(228,100%,77%,.6) 30%,hsla(283,49%,61%,.6) 35%); background-size:300% 400%; background-position:0% calc(var(--background-y,50%)*1); mix-blend-mode:screen; filter:brightness(calc(var(--pointer-from-center,0)*.4 + .25)) contrast(1.4) saturate(.85); opacity:.5; }
        .mc-holo-regular-b { background-image:radial-gradient(farthest-corner ellipse at calc(var(--pointer-x,50%)*.5 + 25%) calc(var(--pointer-y,50%)*.5 + 25%),hsl(0,0%,100%) 5%,hsla(300,100%,11%,.5) 40%,hsl(0,0%,22%) 120%); background-size:400% 500%; mix-blend-mode:hard-light; filter:brightness(calc(var(--pointer-from-center,0)*.25 + .25)) contrast(.8) saturate(.9); opacity:.45; }
        .mc-holo-relic-a { background-image:url('/cosmos-top-trans.png'); background-size:cover; background-position:center; mix-blend-mode:screen; filter:brightness(1.1) contrast(1.2) saturate(1.0); opacity:calc(0.02 + var(--pointer-from-center,0)*0.55); }
        .mc-holo-relic-b { background-image:url('/cosmos-top-trans.png'); background-size:130% 130%; background-position:calc(50% + (var(--pointer-from-left,0.5) - 0.5)*-50px) calc(50% + (var(--pointer-from-top,0.5) - 0.5)*-50px); mix-blend-mode:screen; filter:brightness(1.3) contrast(1.2) saturate(1.1) hue-rotate(15deg); opacity:calc(0.01 + var(--pointer-from-center,0)*0.4); }
        .mc-holo-relic-c { background-image:url('/cosmos-top-trans.png'),radial-gradient(ellipse 40% 40% at var(--pointer-x,50%) var(--pointer-y,50%),hsla(50,100%,98%,.95) 0%,hsla(50,100%,88%,.55) 30%,hsla(50,80%,70%,.15) 60%,transparent 78%); background-blend-mode:screen; background-size:cover,cover; mix-blend-mode:screen; filter:brightness(3.5) contrast(1.3) saturate(2.2); opacity:calc(var(--pointer-from-center,0)*0.72); }
        .mc-holo-v-a { background-image:repeating-linear-gradient(0deg,hsl(2,85%,55%) 5%,hsl(35,90%,55%) 10%,hsl(60,100%,55%) 15%,hsl(120,80%,45%) 20%,hsl(200,90%,55%) 25%,hsl(270,80%,60%) 30%,hsl(2,85%,55%) 35%),repeating-linear-gradient(133deg,#0e152e 0%,hsl(180,10%,60%) 3.8%,hsl(180,29%,66%) 4.5%,hsl(180,10%,60%) 5.2%,#0e152e 10%,#0e152e 12%),radial-gradient(farthest-corner circle at var(--pointer-x,50%) var(--pointer-y,50%),hsla(0,0%,0%,.1) 12%,hsla(0,0%,0%,.15) 20%,hsla(0,0%,0%,.25) 120%); background-blend-mode:screen,hue,hard-light; background-size:200% 700%,300% 100%,200% 100%; background-position:0% var(--background-y,50%),var(--background-x,50%) var(--background-y,50%),var(--background-x,50%) var(--background-y,50%); filter:brightness(.55) contrast(1.6) saturate(.4); mix-blend-mode:screen; opacity:.38; }
        .mc-holo-v-b { background-image:repeating-linear-gradient(0deg,hsl(2,85%,55%) 5%,hsl(35,90%,55%) 10%,hsl(60,100%,55%) 15%,hsl(120,80%,45%) 20%,hsl(200,90%,55%) 25%,hsl(270,80%,60%) 30%,hsl(2,85%,55%) 35%),repeating-linear-gradient(133deg,#0e152e 0%,hsl(180,10%,60%) 3.8%,hsl(180,29%,66%) 4.5%,hsl(180,10%,60%) 5.2%,#0e152e 10%,#0e152e 12%); background-blend-mode:hue,hard-light; background-size:200% 200%,195% 100%; background-position:var(--background-x,50%) var(--background-y,50%),calc(var(--background-x,50%)*-1) calc(var(--background-y,50%)*-1); mix-blend-mode:soft-light; filter:brightness(.7) contrast(1.5) saturate(1.0); opacity:.32; }
      `}</style>

      <div
        ref={cardRef}
        onClick={onClick}
        style={{
          position: 'relative', padding: 3, borderRadius: 16, flexShrink: 0,
          background: `${cfg.badge}18`,
          boxShadow: `0 0 18px ${cfg.badge}55, 0 4px 16px rgba(0,0,0,0.6), inset 0 0 0 0.5px ${cfg.badge}44`,
          cursor: onClick ? 'pointer' : 'default', userSelect: 'none',
          ...holoVars, ...style,
        }}
      >
        <div style={{
          position: 'relative', width, height, borderRadius: 12, overflow: 'hidden',
          background: cardBg, ...borderStyle,
          ...(rarity === 'celestial' && !pointer ? { animation: 'holo-border-spin 3s linear infinite' } : {}),
        }}>
          {/* Portrait */}
          <div style={{ position: 'absolute', inset: 0, zIndex: 2, overflow: 'hidden' }}>
            {art ? (
              <img src={art} alt="" loading="lazy"
                   style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${fx}% ${fy}%`, display: 'block' }}
                   onError={e => { e.target.style.display = 'none' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: 'rgba(255,255,255,0.12)' }}>🃏</div>
            )}
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 60, background: 'linear-gradient(to bottom, transparent, rgba(13,13,20,0.6))', zIndex: 3 }} />
          </div>

          {/* Name at top */}
          {!hideLabel && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, padding: '8px 8px 16px',
              background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)', textAlign: 'center', pointerEvents: 'none',
            }}>
              {card?.creator_name && (
                <div style={{
                  fontSize: Math.min(18, Math.max(11, width * 0.085)), fontWeight: 800, color: nameColor,
                  letterSpacing: '0.02em', textTransform: 'uppercase', lineHeight: 1.15,
                  overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                  ...(rarity === 'celestial' ? { animation: 'rainbow-text 3s linear infinite' } : nameAnim),
                }}>{card.creator_name}</div>
              )}
              {card?.character_name && card.character_name !== card?.creator_name && (
                <div style={{ fontSize: Math.max(10, width * 0.058), color: 'rgba(255,255,255,0.55)', lineHeight: 1.2, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {card.character_name}
                </div>
              )}
              {!card?.creator_name && card?.gallery_name && (
                <div style={{ fontSize: Math.max(10, width * 0.07), fontWeight: 700, color: '#fff', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {card.gallery_name}
                </div>
              )}
            </div>
          )}

          {/* Epic corner ornaments */}
          {rarity === 'epic' && ['tl','tr','bl','br'].map(pos => (
            <span key={pos} style={{
              position: 'absolute', zIndex: 7, color: '#9F8FEF', fontSize: 12, lineHeight: 1,
              ...(pos === 'tl' ? { top: 8, left: 8 } : {}), ...(pos === 'tr' ? { top: 8, right: 8 } : {}),
              ...(pos === 'bl' ? { bottom: 8, left: 8 } : {}), ...(pos === 'br' ? { bottom: 8, right: 8 } : {}),
            }}>◆</span>
          ))}

          {/* Celestial sparkles */}
          {rarity === 'celestial' && showEffects && <Sparkles count={20} color="#E8E8FF" size={[6, 18]} />}

          {/* Rarity frame overlay (the actual PNG border) */}
          <img src={frame} alt="" aria-hidden
               style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none', zIndex: 5 }} />

          {/* Legendary warm glow */}
          {rarity === 'legendary' && (
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '55%', zIndex: 6, pointerEvents: 'none',
              background: 'radial-gradient(ellipse 120% 80% at 50% 100%, rgba(255,140,0,0.35), rgba(200,80,0,0.18) 45%, transparent 75%)', mixBlendMode: 'screen' }} />
          )}

          {/* Bottom label */}
          {!hideLabel && (
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 9, pointerEvents: 'none',
              padding: `0 6px ${Math.max(8, width * 0.06)}px`, textAlign: 'center' }}>
              {card?.period_month && card?.period_year && (
                <div style={{ fontSize: Math.max(9, width * 0.05), color: 'rgba(255,255,255,0.5)', marginBottom: 2 }}>
                  {MONTHS[card.period_month - 1]} {card.period_year}
                </div>
              )}
              <div style={{
                fontSize: Math.min(18, Math.max(10, width * 0.085)), fontWeight: 900, letterSpacing: '0.12em',
                textTransform: 'uppercase', color: cfg.badge,
                overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                ...(rarity === 'celestial' ? { animation: 'rainbow-text 3s linear infinite' } : (cfg.animated ? nameAnim : {})),
              }}>
                {rarity === 'celestial' ? '✦ Celestial' : cfg.label}
              </div>
            </div>
          )}

          {/* Quantity badge */}
          {card?.quantity > 1 && !hideLabel && (
            <span style={{ position: 'absolute', top: 6, right: 6, zIndex: 11, fontSize: 12, fontWeight: 800,
              padding: '1px 7px', borderRadius: 999, background: 'rgba(0,0,0,0.72)', color: '#fff' }}>
              ×{card.quantity}
            </span>
          )}
        </div>

        {/* ── Holo foil layers (cover full card incl. frame) ─────────────────── */}
        {showEffects && (rarity === 'common' || rarity === 'uncommon') && (
          <div className="mc-holo-trainer" style={{ position: 'absolute', inset: 0, borderRadius: 16, zIndex: 4, pointerEvents: 'none' }} />
        )}
        {showEffects && rarity === 'rare' && <>
          <div className="mc-holo-cosmos-a" style={{ position: 'absolute', inset: 0, borderRadius: 16, zIndex: 4, pointerEvents: 'none' }} />
          <div className="mc-holo-cosmos-b" style={{ position: 'absolute', inset: 0, borderRadius: 16, zIndex: 4, pointerEvents: 'none' }} />
        </>}
        {showEffects && rarity === 'epic' && <>
          <div className="mc-holo-vmax-a" style={{ position: 'absolute', inset: 0, borderRadius: 16, zIndex: 4, pointerEvents: 'none' }} />
          <div className="mc-holo-vmax-b" style={{ position: 'absolute', inset: 0, borderRadius: 16, zIndex: 4, pointerEvents: 'none' }} />
        </>}
        {showEffects && rarity === 'legendary' && <>
          <div className="mc-holo-regular-a" style={{ position: 'absolute', inset: 0, borderRadius: 16, zIndex: 4, pointerEvents: 'none' }} />
          <div className="mc-holo-regular-b" style={{ position: 'absolute', inset: 0, borderRadius: 16, zIndex: 4, pointerEvents: 'none' }} />
        </>}
        {showEffects && rarity === 'relic' && <>
          <div className="mc-holo-relic-a" style={{ position: 'absolute', inset: 0, borderRadius: 16, zIndex: 4, pointerEvents: 'none' }} />
          <div className="mc-holo-relic-b" style={{ position: 'absolute', inset: 0, borderRadius: 16, zIndex: 4, pointerEvents: 'none' }} />
          <div className="mc-holo-relic-c" style={{ position: 'absolute', inset: 0, borderRadius: 16, zIndex: 4, pointerEvents: 'none' }} />
        </>}
        {showEffects && rarity === 'celestial' && <>
          <div className="mc-holo-v-a" style={{ position: 'absolute', inset: 0, borderRadius: 16, zIndex: 4, pointerEvents: 'none' }} />
          <div className="mc-holo-v-b" style={{ position: 'absolute', inset: 0, borderRadius: 16, zIndex: 4, pointerEvents: 'none' }} />
        </>}
      </div>
    </>
  )
}

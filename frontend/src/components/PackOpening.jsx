import React, { useState, useEffect } from 'react'
import VaultCard from './VaultCard'

const RARITY_DRAMA = {
  celestial: { flash: 'rgba(220,220,255,0.95)', label: '✦ CELESTIAL ✦', delay: 1000 },
  legendary: { flash: 'rgba(255,215,0,0.7)',    label: '✦ LEGENDARY ✦', delay: 800 },
  epic:      { flash: 'rgba(255,140,0,0.5)',    label: '🔥 EPIC',        delay: 500 },
}
// Prestige cards get their own reveal drama regardless of tier (dead path today —
// Prestige is crafted, never pulled from packs — kept in case that ever changes)
const FOIL_DRAMA = { flash: 'rgba(255,255,255,0.85)', label: '✨ PRESTIGE ✨', delay: 900 }

export default function PackOpening({ packs, onCollect, onSkip }) {
  const [packIdx, setPackIdx]   = useState(0)
  const [revealed, setRevealed] = useState([])
  const [flipped, setFlipped]   = useState([])
  const [done, setDone]         = useState(false)
  const [flashing, setFlashing] = useState(null)

  const currentPack = packs[packIdx] || []
  const packsLeft   = packs.length - packIdx - 1

  // Reset state when advancing to next pack
  const advanceToNext = () => {
    setPackIdx(i => i + 1)
    setRevealed([])
    setFlipped([])
    setDone(false)
  }

  const flip = (i) => {
    if (revealed.includes(i) || flipped.includes(i)) return
    setFlipped(f => [...f, i])
    const card  = currentPack[i]
    const drama = (card?.foil && !RARITY_DRAMA[card?.rarity]) ? FOIL_DRAMA : RARITY_DRAMA[card?.rarity]
    setTimeout(() => {
      setRevealed(r => {
        const next = [...r, i]
        if (next.length === currentPack.length) setDone(true)
        return next
      })
      if (drama) {
        setFlashing(drama)
        setTimeout(() => setFlashing(null), 600)
      }
    }, drama?.delay ?? 200)
  }

  const revealAll = () => {
    currentPack.forEach((_, i) => {
      if (!revealed.includes(i)) setTimeout(() => flip(i), i * 120)
    })
  }

  const CARD_W = 260
  const CARD_H = Math.round(260 * 1.45)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      background: 'rgba(0,0,0,0.96)',
      backdropFilter: 'blur(16px)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 32,
    }}>
      {/* Flash overlay */}
      {flashing && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1200,
          background: flashing.flash,
          pointerEvents: 'none',
          animation: 'pack-flash 0.4s ease-out forwards',
        }}>
          <style>{`@keyframes pack-flash { 0% { opacity:1; } 100% { opacity:0; } }`}</style>
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: 28, fontWeight: 800, color: '#fff',
            letterSpacing: '0.15em', textShadow: '0 0 30px #fff',
            animation: 'pack-flash 0.6s ease-out forwards',
          }}>
            {flashing.label}
          </div>
        </div>
      )}

      {/* Pack counter */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
          {done ? 'All cards revealed!' : 'Click each card to reveal'}
        </div>
        {packs.length > 1 && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.22)', letterSpacing: '0.1em' }}>
            Pack {packIdx + 1} of {packs.length}
          </div>
        )}
      </div>

      {/* Card row */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
        {currentPack.map((card, i) => {
          const isRevealed = revealed.includes(i)
          const isFlipping = flipped.includes(i)
          return (
            <div
              key={`${packIdx}-${i}`}
              onClick={() => flip(i)}
              style={{
                perspective: '1200px',
                cursor: isRevealed ? 'default' : 'pointer',
                width: CARD_W, height: CARD_H,
              }}
            >
              <div style={{
                position: 'relative', width: '100%', height: '100%',
                transformStyle: 'preserve-3d',
                transform: isRevealed ? 'rotateY(180deg)' : 'rotateY(0deg)',
                transition: 'transform 0.55s cubic-bezier(0.4,0,0.2,1)',
              }}>
                <div style={{
                  position: 'absolute', inset: 0,
                  backfaceVisibility: 'hidden', borderRadius: 10, overflow: 'hidden',
                  boxShadow: '0 0 20px rgba(127,119,221,0.25)',
                  opacity: isFlipping ? 0.5 : 1, transition: 'opacity 0.2s',
                }}>
                  <img src="/card-back.png" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
                <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                  <VaultCard card={card} width={260} forceEffects={true} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 12 }}>
        {!done && (
          <>
            <button
              onClick={revealAll}
              style={{
                padding: '9px 20px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)',
                border: '0.5px solid rgba(255,255,255,0.12)',
              }}
            >
              Reveal All
            </button>
            <button
              onClick={onSkip}
              style={{
                padding: '9px 20px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                background: 'rgba(255,255,255,0.02)', color: 'rgba(255,255,255,0.25)',
                border: 'none',
              }}
            >
              Skip All
            </button>
          </>
        )}
        {done && packsLeft > 0 && (
          <button
            onClick={advanceToNext}
            style={{
              padding: '10px 28px', borderRadius: 20, fontSize: 13, fontWeight: 600,
              cursor: 'pointer',
              background: 'linear-gradient(135deg, rgba(127,119,221,0.35), rgba(127,119,221,0.2))',
              color: '#CECBF6', border: '1px solid rgba(127,119,221,0.5)',
              boxShadow: '0 0 20px rgba(127,119,221,0.2)',
              letterSpacing: '0.05em',
            }}
          >
            Next Pack ({packsLeft} remaining) ›
          </button>
        )}
        {done && packsLeft === 0 && (
          <button
            onClick={onCollect}
            style={{
              padding: '10px 28px', borderRadius: 20, fontSize: 13, fontWeight: 600,
              cursor: 'pointer',
              background: 'linear-gradient(135deg, rgba(127,119,221,0.4), rgba(212,83,126,0.3))',
              color: '#fff', border: '1px solid rgba(127,119,221,0.5)',
              boxShadow: '0 0 20px rgba(127,119,221,0.3)',
              letterSpacing: '0.05em',
            }}
          >
            ✦ Add to Collection
          </button>
        )}
      </div>
    </div>
  )
}

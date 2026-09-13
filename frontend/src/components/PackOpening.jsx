import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { FastForward, Layers3, PackageOpen, Sparkles } from 'lucide-react'
import VaultCard from './VaultCard'
import TCGV2CardFace from './tcg-v2/TCGV2CardFace'
import { useScrollLock } from '../hooks/useScrollLock'
import './PackOpening.css'

const RARITY_ORDER = Object.freeze({ C: 0, R: 1, SR: 2, UR: 3, SPR: 4 })
const LEGACY_RARITY = Object.freeze({
  common: 'C', rare: 'R', uncommon: 'C', epic: 'SR', legendary: 'UR', celestial: 'UR',
})
const WRAPPER_ASSETS = Object.freeze({
  permanent: '/tcg-booster-permanent-cutout.png',
  release_standard: '/tcg-booster-standard-cutout.png',
  release_premium: '/tcg-booster-premium-cutout.png',
  limited: '/tcg-booster-limited-cutout.png',
  weekly_protection: '/tcg-booster-limited-cutout.png',
})

function printedRarity(card) {
  const raw = card?.print_rarity || card?.printRarity || card?.rarity_class || card?.rarityClass || card?.published_rarity || card?.publishedRarity || card?.rarity
  const normalized = String(raw || '').trim().toUpperCase()
  if (RARITY_ORDER[normalized] !== undefined) return normalized
  return LEGACY_RARITY[String(raw || '').trim().toLowerCase()] || 'C'
}

function orderPack(pack) {
  return (Array.isArray(pack) ? pack : [])
    .map((card, index) => ({ card, index }))
    .sort((left, right) => RARITY_ORDER[printedRarity(left.card)] - RARITY_ORDER[printedRarity(right.card)] || left.index - right.index)
    .map(({ card }) => card)
}

function normalizePackEntry(entry) {
  if (Array.isArray(entry)) return { product: {}, cards: entry }
  return { product: entry?.product || entry || {}, cards: Array.isArray(entry?.cards) ? entry.cards : [] }
}

function cardImage(card) {
  return card?.thumb_url || card?.thumbUrl || card?.image_url || card?.imageUrl || card?.art_url || card?.artUrl || null
}

function cardFace(card, className = '') {
  return <div className={className}>
    <TCGV2CardFace card={card} width="100%" showEffects={true}
      fallback={<VaultCard card={card} width={320} forceEffects={true} />} />
  </div>
}

function PhaseLabel({ phase, currentIndex, cardCount }) {
  if (phase === 'entry' || phase === 'tear') return <><Sparkles size={18} /> Tear the top seam to open</>
  if (phase === 'extract') return <><PackageOpen size={18} /> Cards are coming out</>
  if (phase === 'fade') return <><PackageOpen size={18} /> Finishing the opening</>
  if (phase === 'pile') return <><Layers3 size={18} /> Your pack is ready</>
  if (phase === 'flip') return <><Layers3 size={18} /> Turning the pile</>
  if (phase === 'reveal') return <>Card {currentIndex + 1} of {cardCount}</>
  return <><Sparkles size={18} /> Pack complete</>
}

function TearTrack({ progress, onProgress, onComplete }) {
  const trackRef = useRef(null)
  const latestProgress = useRef(progress)
  const completed = useRef(false)
  const [dragging, setDragging] = useState(false)

  const applyProgress = useCallback(next => {
    latestProgress.current = Math.max(latestProgress.current, next)
    onProgress(current => Math.max(current, next))
    if (next >= 0.94 && !completed.current) {
      completed.current = true
      onComplete()
    }
  }, [onComplete, onProgress])

  const updateProgress = useCallback(event => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const next = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    applyProgress(next)
  }, [applyProgress])

  const handleDown = event => {
    if (event.button !== 0) return
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    updateProgress(event)
  }

  const handleMove = event => updateProgress(event)

  const handleUp = event => {
    if (!dragging) return
    setDragging(false)
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  const handleKeyDown = event => {
    let next = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'PageUp') next = progress + 0.1
    if (event.key === 'End') next = 1
    if ((event.key === 'Enter' || event.key === ' ') && progress >= 0.94) next = 1
    if (next === null) return
    event.preventDefault()
    applyProgress(Math.min(1, next))
  }

  return <div
    ref={trackRef}
    className={`pack-opening__tear-track${dragging ? ' is-dragging' : ''}`}
    role="slider"
    aria-label="Tear across the top seam"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={Math.round(progress * 100)}
    aria-valuetext={`${Math.round(progress * 100)}% torn`}
    tabIndex={0}
    onPointerDown={handleDown}
    onPointerEnter={handleMove}
    onPointerMove={handleMove}
    onPointerUp={handleUp}
    onPointerCancel={handleUp}
    onKeyDown={handleKeyDown}
  >
    <span className="pack-opening__tear-label">Move across the seal</span>
  </div>
}

function BoosterEnvelope({ product, collage, phase, tearProgress, onTearProgress, onTearComplete }) {
  const wrapperSrc = product.wrapper_src || WRAPPER_ASSETS[product.product_kind] || WRAPPER_ASSETS.permanent
  const isTorn = phase !== 'entry'
  const identity = product.wrapper_identity || {}
  return <div className={`pack-opening__envelope pack-opening__envelope--${phase}`} data-wrapper={identity.code || product.code || product.product_kind}>
    {!isTorn && <img className="pack-opening__envelope-whole" src={wrapperSrc} alt={`${product.name || 'Booster'} wrapper`} />}
    {isTorn && <>
      <div className="pack-opening__envelope-piece pack-opening__envelope-body" aria-hidden="true"><img src={wrapperSrc} alt="" /></div>
      <div className="pack-opening__envelope-piece pack-opening__envelope-top" aria-hidden="true"><img src={wrapperSrc} alt="" /></div>
      <div className="pack-opening__pack-opening" aria-hidden="true" />
    </>}
    {!isTorn && tearProgress > 0 && <div className="pack-opening__pack-opening pack-opening__pack-opening--progress" style={{ '--tear-progress': tearProgress }} aria-hidden="true" />}
    {collage.length > 0 && <div className="pack-opening__envelope-collage" aria-hidden="true">
      {collage.map((image, index) => <img key={`${image}-${index}`} src={image} alt="" style={{ '--collage-index': index }} />)}
    </div>}
    {!isTorn && <TearTrack progress={tearProgress} onProgress={onTearProgress} onComplete={onTearComplete} />}
    <div className="pack-opening__envelope-shine" aria-hidden="true" />
  </div>
}

function ExtractionCards({ count, phase }) {
  return <div className={`pack-opening__extraction ${phase === 'extract' ? 'is-active' : ''}`} aria-hidden="true">
    {Array.from({ length: count }, (_, index) => <div className="pack-opening__extraction-card" key={index} style={{ '--card-index': index, '--card-count': count }}>
      <img src="/card-back.png" alt="" />
    </div>)}
  </div>
}

function PackPile({ count, phase, firstCard, onTurn }) {
  return <button type="button" className={`pack-opening__pile pack-opening__pile--${phase}`} onClick={onTurn} aria-label="Turn over the card pile" title="Turn over the card pile">
    <span className="pack-opening__pile-shadow" aria-hidden="true" />
    <div className="pack-opening__pile-shell">
      <div className="pack-opening__pile-back" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => <div className="pack-opening__pile-card" key={index} style={{ '--pile-index': index, '--pile-count': count }}><img src="/card-back.png" alt="" /></div>)}
      </div>
      <div className="pack-opening__pile-front" aria-hidden="true">{firstCard && cardFace(firstCard)}</div>
    </div>
    <span className="pack-opening__pile-caption">Click to turn over</span>
  </button>
}

function RevealStack({ cards, currentIndex, onAdvance }) {
  const throwTop = useCallback(direction => onAdvance(direction), [onAdvance])
  const remaining = cards.slice(currentIndex)
  return (
    <div className="pack-opening__reveal-stack" style={{ '--stack-count': remaining.length }}>
      {remaining.map((card, offset) => {
        const isTop = offset === 0
        const className = `pack-opening__stack-card${isTop ? ' is-top' : ''}`
        if (!isTop) return <div className={className} key={`under-${currentIndex + offset}`} style={{ '--stack-offset': Math.min(offset, 4), '--stack-y': `${Math.min(offset, 4) * 8}px`, '--stack-scale': 1 - Math.min(offset, 4) * .018, zIndex: 100 - offset }}>{cardFace(card)}</div>
        return <motion.div
          className={className}
          key={`top-${currentIndex}`}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.9}
          whileDrag={{ scale: 1.015 }}
          animate={{ x: 0, rotate: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          onDragEnd={(_, info) => {
            if (Math.abs(info.offset.x) > 72 || Math.abs(info.velocity.x) > 450) {
              throwTop(info.offset.x < 0 ? -1 : 1)
            }
          }}
          style={{ touchAction: 'none' }}
        >{cardFace(card)}</motion.div>
      })}
    </div>
  )
}

function GridCard({ card }) {
  return <div className="pack-opening__grid-card">{cardFace(card)}</div>
}

export default function PackOpening({ packs, onCollect, onSkip }) {
  const [packIdx, setPackIdx] = useState(0)
  const [phase, setPhase] = useState('entry')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [tearProgress, setTearProgress] = useState(0)
  const safePacks = Array.isArray(packs) ? packs : []
  const entry = normalizePackEntry(safePacks[packIdx])
  const currentPack = useMemo(() => orderPack(entry.cards), [entry.cards])
  const product = entry.product
  const collage = useMemo(() => {
    const candidates = [
      ...(Array.isArray(product.collage_images) ? product.collage_images : []),
      ...(Array.isArray(product.collageImages) ? product.collageImages : []),
      ...currentPack.map(cardImage),
    ].filter(Boolean)
    return [...new Set(candidates)].slice(0, 5)
  }, [currentPack, product.collage_images, product.collageImages])
  const packsLeft = Math.max(0, safePacks.length - packIdx - 1)

  useEffect(() => {
    setPhase('entry')
    setCurrentIndex(0)
    setTearProgress(0)
    if (!currentPack.length) setPhase('grid')
  }, [packIdx, currentPack.length])

  useEffect(() => {
    if (phase !== 'tear') return undefined
    const extract = window.setTimeout(() => setPhase('extract'), 420)
    return () => window.clearTimeout(extract)
  }, [phase])

  useEffect(() => {
    if (phase !== 'extract') return undefined
    const fade = window.setTimeout(() => setPhase('fade'), Math.max(760, currentPack.length * 125))
    return () => window.clearTimeout(fade)
  }, [phase, currentPack.length])

  useEffect(() => {
    if (phase !== 'fade') return undefined
    const pile = window.setTimeout(() => setPhase('pile'), 470)
    return () => window.clearTimeout(pile)
  }, [phase])

  useEffect(() => {
    if (phase !== 'flip') return undefined
    const timer = window.setTimeout(() => setPhase('reveal'), 520)
    return () => window.clearTimeout(timer)
  }, [phase])

  // Keep the collection page fixed while the portaled opening is active.
  useScrollLock()

  const completeTear = useCallback(() => {
    if (phase !== 'entry') return
    setTearProgress(1)
    setPhase('tear')
  }, [phase])
  const skipAnimation = useCallback(() => { setPhase('grid'); setCurrentIndex(currentPack.length ? currentPack.length - 1 : 0) }, [currentPack.length])
  const turnPile = useCallback(() => { if (phase === 'pile') setPhase('flip') }, [phase])
  const advanceReveal = useCallback(() => {
    if (phase !== 'reveal') return
    if (currentIndex >= currentPack.length - 1) setPhase('grid')
    else setCurrentIndex(index => index + 1)
  }, [currentIndex, currentPack.length, phase])
  const advanceToNext = () => { if (packsLeft) setPackIdx(index => index + 1) }
  const packComplete = phase === 'grid'
  const currentCard = currentPack[currentIndex]
  const sceneClass = `pack-opening__pack-scene pack-opening__pack-scene--${phase}`

  return createPortal(<div className="pack-opening" role="dialog" aria-modal="true" aria-label="Booster pack opening">
    <div className="pack-opening__backdrop" aria-hidden="true" />
    <header className="pack-opening__header">
      <div><span className="pack-opening__eyebrow"><PhaseLabel phase={phase} currentIndex={currentIndex} cardCount={currentPack.length} /></span>{safePacks.length > 1 && <span className="pack-opening__pack-count">Pack {packIdx + 1} of {safePacks.length}</span>}</div>
      {!packComplete && <button type="button" className="pack-opening__skip" onClick={skipAnimation}><FastForward size={18} /> Skip animation</button>}
    </header>
    <main className={`pack-opening__stage pack-opening__stage--${phase}`}>
      {(phase === 'entry' || phase === 'tear' || phase === 'extract' || phase === 'fade') && <div className={sceneClass}>
        <BoosterEnvelope product={product} collage={collage} phase={phase} tearProgress={tearProgress} onTearProgress={setTearProgress} onTearComplete={completeTear} />
        <ExtractionCards count={currentPack.length} phase={phase} />
      </div>}
      {phase === 'pile' && <PackPile count={currentPack.length} firstCard={currentPack[0]} phase={phase} onTurn={turnPile} />}
      {phase === 'flip' && <PackPile count={currentPack.length} firstCard={currentPack[0]} phase={phase} onTurn={() => {}} />}
      {phase === 'reveal' && currentCard && <section className="pack-opening__reveal-stage" aria-label={`Card ${currentIndex + 1} of ${currentPack.length}`}><div className="pack-opening__reveal-hint">Throw the top card left or right to reveal what is underneath</div><div className="pack-opening__reveal-frame"><RevealStack cards={currentPack} currentIndex={currentIndex} onAdvance={advanceReveal} /></div></section>}
      {packComplete && <section className="pack-opening__complete" aria-label="Pack cards"><div className="pack-opening__complete-heading"><div><span className="pack-opening__eyebrow"><Sparkles size={18} /> Pack complete</span><h1>Cards from this pack</h1></div><span>{currentPack.length} cards</span></div><div className="pack-opening__grid">{currentPack.map((card, index) => <GridCard key={`${packIdx}-grid-${index}`} card={card} />)}</div></section>}
    </main>
    <footer className="pack-opening__footer">
      {packComplete && packsLeft > 0 && <button type="button" className="pack-opening__primary" onClick={advanceToNext}><PackageOpen size={19} /> Open next pack <span>({packsLeft} remaining)</span></button>}
      {packComplete && packsLeft === 0 && <button type="button" className="pack-opening__primary pack-opening__primary--collect" onClick={onCollect}><Sparkles size={19} /> Add to Collection</button>}
    </footer>
  </div>, document.body)
}

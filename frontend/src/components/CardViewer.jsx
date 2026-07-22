import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { X, RotateCcw, Crosshair, TrendingUp } from 'lucide-react'
import VaultCard, { RARITY_CONFIG } from './VaultCard'
import CardFeedPanel from './CardFeedPanel'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cardsApi, imagesApi, economyApi } from '../lib/api'
import toast from 'react-hot-toast'

const CARD_W_BASE = 616
const CARD_H_BASE = Math.round(600 * 1.45) + 16  // 886
const DEPTH  = 10

// Reserve space for top controls + CXP bar + bottom buttons + gaps
const NON_CARD_H = 210

// Level steps per rarity (mirrors backend LEVEL_CXP_STEP): level = 1 + cxp // step, max 10
const LEVEL_CXP_STEP = { common: 100, epic: 400, legendary: 1200, celestial: 3000 }
const MAX_LEVEL = 10

export default function CardViewer({ card, inventoryId, onClose, sourceRect }) {
  const [phase, setPhase]           = useState('start')
  const [is3D, setIs3D]             = useState(false)
  const [rotX, setRotX]             = useState(0)
  const [rotY, setRotY]             = useState(0)
  const [dragging, setDragging]     = useState(false)
  const [autoSpin, setAutoSpin]     = useState(false)
  const [cardData, setCardData]     = useState(card)
  const [evolvePhase, setEvolvePhase] = useState(null) // null | 'spinning' | 'flashing' | 'revealed'
  const [focalMode, setFocalMode]   = useState(false)
  const [showFeedPanel, setShowFeedPanel] = useState(false)
  const [lvlUpPopped, setLvlUpPopped]   = useState(false)
  const dragStart  = useRef({ x: 0, y: 0, rotX: 0, rotY: 0 })
  const spinRef    = useRef(null)
  const wrapperRef = useRef(null)
  const qc         = useQueryClient()

  const isEvolving = evolvePhase !== null

  // ── Progressive image load — open on the (already-cached) thumbnail
  // immediately, then swap to the full-res image once it's actually decoded.
  // Avoids the modal opening onto a blank/loading full-res <img>.
  const [fullResReady, setFullResReady] = useState(false)
  const fullResUrl = cardData.image_url || cardData.thumb_url || cardData.creator_avatar
  useEffect(() => {
    setFullResReady(false)
    if (!cardData.image_url) return
    let cancelled = false
    const img = new Image()
    img.src = fullResUrl
    // decode() resolves once the image is fully decoded and paint-ready, not
    // just downloaded — swapping it in only then means the browser doesn't
    // stall recompositing the holo/blend stack against an undecoded bitmap
    // (that stall is what reads as the multi-second freeze right after open).
    const ready = () => { if (!cancelled) setFullResReady(true) }
    if (img.decode) img.decode().then(ready, ready)
    else img.onload = ready
    return () => { cancelled = true }
  }, [fullResUrl, cardData.image_url])

  // ── Responsive card sizing — never exceed the viewport height ─────────────
  const cardScale = Math.min(1, (window.innerHeight - NON_CARD_H) / CARD_H_BASE)
  const CARD_W    = Math.round(CARD_W_BASE * cardScale)
  const CARD_H    = Math.round(CARD_H_BASE * cardScale)
  const vaultW    = CARD_W - 16   // inner VaultCard width (CARD_W includes 8px padding on each side)

  // ── Opening animation
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setPhase('open')))
    return () => cancelAnimationFrame(id)
  }, [])

  // ── Lock page scroll while the viewer is open (it's portaled to <body>, so
  // background scroll would otherwise keep moving the page underneath)
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const handleClose = useCallback(() => {
    setPhase('closing')
    setTimeout(onClose, 320)
  }, [onClose])

  const srcTransform = useMemo(() => {
    if (!sourceRect) return 'scale(0.88)'
    const vpW = window.innerWidth
    const vpH = window.innerHeight
    const srcCx = sourceRect.left + sourceRect.width  / 2
    const srcCy = sourceRect.top  + sourceRect.height / 2
    const tx = srcCx - vpW / 2
    const ty = srcCy - vpH / 2
    const scale = sourceRect.width / CARD_W
    return `translate(${tx}px, ${ty}px) scale(${scale})`
  }, [sourceRect])

  const isOpen    = phase === 'open'
  const isClosing = phase === 'closing'
  const cardTransition = isClosing
    ? 'transform 0.30s cubic-bezier(0.7,0,0.84,0), opacity 0.25s ease'
    : isOpen
    ? 'transform 0.40s cubic-bezier(0.16,1,0.3,1), opacity 0.30s ease'
    : 'none'

  // ── Auto-spin
  useEffect(() => {
    if (autoSpin && is3D) {
      spinRef.current = setInterval(() => setRotY(r => r + 0.5), 16)
    } else {
      clearInterval(spinRef.current)
    }
    return () => clearInterval(spinRef.current)
  }, [autoSpin, is3D])

  // ── 3D drag
  const onMouseDown = (e) => {
    if (!is3D || isEvolving || focalMode) return
    setDragging(true)
    setAutoSpin(false)
    dragStart.current = { x: e.clientX, y: e.clientY, rotX, rotY }
  }
  const onMouseMove = useCallback((e) => {
    if (!dragging) return
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    setRotY(dragStart.current.rotY + dx * 0.4)
    setRotX(dragStart.current.rotX - dy * 0.4)
  }, [dragging])
  const onMouseUp = useCallback(() => setDragging(false), [])

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [onMouseMove, onMouseUp])

  // ── 2D tilt
  const handleStageMouse = useCallback((e) => {
    if (is3D || isEvolving) return
    const el = wrapperRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const dx = (e.clientX - (rect.left + rect.width  / 2)) / (rect.width  / 2)
    const dy = (e.clientY - (rect.top  + rect.height / 2)) / (rect.height / 2)
    el.style.transition = 'none'
    el.style.transform  = `rotateY(${dx * 8}deg) rotateX(${-dy * 8}deg) scale(1.03)`
  }, [is3D, isEvolving])

  const handleStageLeave = useCallback(() => {
    if (is3D || isEvolving) return
    const el = wrapperRef.current
    if (!el) return
    el.style.transition = 'transform 0.4s ease'
    el.style.transform  = 'rotateY(0deg) rotateX(0deg) scale(1)'
  }, [is3D, isEvolving])

  // ── Catalyst mutation — crafts the FOIL version (with the spin+flash drama)
  const catalystApi = useMutation({
    mutationFn: () => cardsApi.applyCatalyst(inventoryId).then(r => r.data),
    onSuccess: () => {
      setCardData(prev => ({ ...prev, foil: true, is_relic: true }))
    },
    onError: (e) => {
      toast.error(e.response?.data?.detail || 'Not enough tokens')
      setEvolvePhase(null)
      setIs3D(false)
    },
  })

  const catalystMutation = {
    isPending: catalystApi.isPending || isEvolving,
    mutate: () => {
      if (isEvolving) return
      setIs3D(true)
      setAutoSpin(false)
      setRotX(0)
      setRotY(0)
      setEvolvePhase('spinning')
      setTimeout(() => {
        setEvolvePhase('flashing')
        catalystApi.mutate()
        setTimeout(() => {
          setEvolvePhase('revealed')
          setTimeout(() => {
            setEvolvePhase(null)
            setIs3D(false)
            qc.invalidateQueries({ queryKey: ['card-inventory'] })
            qc.invalidateQueries({ queryKey: ['forge-materials'] })
            toast.success('Prestige crafted! ✨')
          }, 700)
        }, 500)
      }, 900)
    },
  }

  // ── Craft Prestige mutation — crafts the PRESTIGE version from dupes + credits
  const craftPrestigeMutation = useMutation({
    mutationFn: () => cardsApi.craftPrestige(inventoryId).then(r => r.data),
    onSuccess: () => {
      setCardData(prev => ({ ...prev, prestige: true, foil: true }))
      qc.invalidateQueries({ queryKey: ['card-inventory'] })
      qc.invalidateQueries({ queryKey: ['economy-balance'] })
      qc.invalidateQueries({ queryKey: ['profile'] })
      qc.invalidateQueries({ queryKey: ['forge-materials'] })
      toast.success('✦ Prestige crafted')
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Craft failed'),
  })

  // ── Fuse-all mutation
  const fuseAllMutation = useMutation({
    mutationFn: () => cardsApi.fuseAll(inventoryId).then(r => r.data),
    onSuccess: (data) => {
      toast.success(`Fused ${data.fused_count} dupes → +${data.cxp_gained.toLocaleString()} CXP`)
      setCardData(prev => ({ ...prev, cxp: data.new_cxp }))
      qc.invalidateQueries({ queryKey: ['card-inventory'] })
      qc.invalidateQueries({ queryKey: ['fuseable', inventoryId] })
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Fuse failed'),
  })

  // ── Fuseable query (only when viewer is open and inventoryId known)
  const { data: fuseableItems = [] } = useQuery({
    queryKey: ['fuseable', inventoryId],
    queryFn: () => cardsApi.getFuseable(inventoryId).then(r => r.data),
    enabled: !!inventoryId,
    staleTime: 5000,
  })

  // ── Credit balance (for Craft Prestige affordability check)
  const { data: balance } = useQuery({
    queryKey: ['economy-balance'],
    queryFn: () => economyApi.balance().then(r => r.data),
    staleTime: 10000,
  })
  const credits = balance?.vault_credits ?? 0

  // ── Focal point mutation
  const focalMutation = useMutation({
    mutationFn: ({ x, y }) => imagesApi.focalPoint(cardData.source_image_id, x, y).then(r => r.data),
    onSuccess: (data) => {
      setCardData(prev => ({ ...prev, image_focal_x: data.focal_x, image_focal_y: data.focal_y }))
    },
  })

  const handleFocalClick = useCallback((e) => {
    if (!focalMode || !wrapperRef.current) return
    e.stopPropagation()
    const rect = wrapperRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height))
    setCardData(prev => ({ ...prev, image_focal_x: x, image_focal_y: y }))
    focalMutation.mutate({ x, y })
    setFocalMode(false)
  }, [focalMode, focalMutation])

  const handleFed = useCallback((data) => {
    setCardData(prev => ({ ...prev, cxp: data.new_cxp, level: undefined }))
    if (data.evolution_ready) toast.success('Max level reached! ✨')
    qc.invalidateQueries({ queryKey: ['forge-materials'] })
  }, [qc])

  const totalFuseCxp   = fuseableItems.reduce((s, f) => s + f.total_cxp, 0)
  const totalFuseCount = fuseableItems.reduce((s, f) => s + f.quantity, 0)

  if (!card) return null

  // Portaled to <body>: framer-motion page transitions put a transform on the
  // route wrapper, which breaks position:fixed for anything rendered inside it
  // (the viewer would scroll away with the page).
  const cfg       = RARITY_CONFIG[cardData.rarity] || RARITY_CONFIG.common
  const edgeColor = `linear-gradient(to bottom, ${cfg.badge}33 0%, ${cfg.badge}88 50%, ${cfg.badge}33 100%)`

  const levelStep    = LEVEL_CXP_STEP[cardData.rarity] ?? 100
  const currentCxp   = cardData.cxp ?? 0
  const cardLevel    = cardData.level ?? Math.min(MAX_LEVEL, 1 + Math.floor(currentCxp / levelStep))
  const atMaxCxp     = cardLevel >= MAX_LEVEL
  const cxpThreshold = atMaxCxp ? null : levelStep * cardLevel   // CXP for next level
  const cxpPct       = cxpThreshold ? Math.min(100, (currentCxp / cxpThreshold) * 100) : 100

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        // No backdrop-filter here on purpose: a full-viewport blur has to be
        // recomposited by the browser every time ANYTHING behind it changes
        // (any CSS animation tick, any polling query updating a number) —
        // that's what was causing the periodic multi-hundred-ms freezes while
        // the viewer was open. The backdrop is already 92% opaque black, so
        // the blur was barely visible anyway — this is a no-op visually.
        background: isOpen ? 'rgba(0,0,0,0.92)' : 'rgba(0,0,0,0)',
        transition: isClosing
          ? 'background 0.28s ease'
          : 'background 0.32s ease',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 24,
        pointerEvents: phase === 'start' ? 'none' : 'auto',
      }}
      onMouseDown={e => e.target === e.currentTarget && !isEvolving && handleClose()}
    >
      <style>{`
        @keyframes card-evolve-spin {
          0%   { transform: perspective(800px) rotateY(0deg); }
          100% { transform: perspective(800px) rotateY(1440deg); }
        }
        @keyframes lvl-up-pop {
          0%   { transform: scale(1); }
          35%  { transform: scale(0.88); }
          70%  { transform: scale(1.08); }
          100% { transform: scale(1); }
        }
        .lvl-up-popped {
          animation: lvl-up-pop 0.28s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
      `}</style>

      {/* Controls */}
      <div style={{
        display: 'flex', gap: 10, alignItems: 'center',
        opacity: isOpen && !isEvolving ? 1 : 0,
        transition: 'opacity 0.25s ease',
        pointerEvents: isEvolving ? 'none' : 'auto',
      }}>
        <button onClick={() => { setIs3D(false); setRotX(0); setRotY(0) }} style={{
          padding: '6px 16px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
          background: !is3D ? 'rgba(127,119,221,0.3)' : 'rgba(255,255,255,0.06)',
          color: !is3D ? '#CECBF6' : 'rgba(255,255,255,0.5)',
          border: !is3D ? '1px solid rgba(127,119,221,0.5)' : '0.5px solid rgba(255,255,255,0.1)',
        }}>2D View</button>
        <button onClick={() => setIs3D(true)} style={{
          padding: '6px 16px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
          background: is3D ? 'rgba(127,119,221,0.3)' : 'rgba(255,255,255,0.06)',
          color: is3D ? '#CECBF6' : 'rgba(255,255,255,0.5)',
          border: is3D ? '1px solid rgba(127,119,221,0.5)' : '0.5px solid rgba(255,255,255,0.1)',
        }}>3D View</button>
        {is3D && (
          <button onClick={() => setAutoSpin(s => !s)} style={{
            padding: '6px 16px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
            background: autoSpin ? 'rgba(186,117,23,0.25)' : 'rgba(255,255,255,0.06)',
            color: autoSpin ? '#FAC775' : 'rgba(255,255,255,0.5)',
            border: autoSpin ? '1px solid rgba(186,117,23,0.4)' : '0.5px solid rgba(255,255,255,0.1)',
          }}>↻ Auto-spin</button>
        )}
        <button onClick={handleClose} style={{
          marginLeft: 8, background: 'rgba(255,255,255,0.06)',
          border: '0.5px solid rgba(255,255,255,0.1)',
          color: 'rgba(255,255,255,0.5)', borderRadius: '50%',
          width: 32, height: 32, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <X size={14} />
        </button>
      </div>

      {/* Card stage — FLIP animated wrapper + optional dupe panel */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>

      <div style={{
        transform: isOpen ? 'translate(0,0) scale(1)' : srcTransform,
        opacity:   isOpen ? 1 : sourceRect ? 0.4 : 0,
        transition: cardTransition,
        transformOrigin: 'center center',
        position: 'relative',
      }}>
        <div
          onMouseDown={onMouseDown}
          onMouseMove={handleStageMouse}
          onMouseLeave={handleStageLeave}
          onClick={focalMode ? handleFocalClick : undefined}
          style={{
            perspective: '1200px',
            cursor: focalMode ? 'crosshair' : is3D && !isEvolving ? (dragging ? 'grabbing' : 'grab') : 'default',
            padding: is3D ? `${DEPTH}px` : 0,
            position: 'relative',
          }}
        >
          <div
            ref={wrapperRef}
            style={{
              transformStyle: 'preserve-3d',
              transform: isEvolving
                ? undefined
                : is3D
                ? `rotateY(${rotY}deg) rotateX(${rotX}deg)`
                : 'rotateY(0deg) rotateX(0deg)',
              animation: evolvePhase === 'spinning'
                ? 'card-evolve-spin 0.9s cubic-bezier(0.4,0,0.6,1) forwards'
                : 'none',
              transition: (dragging || autoSpin || isEvolving) ? 'none' : 'transform 0.4s ease',
              position: 'relative',
              width: CARD_W,
              height: CARD_H,
            }}
          >
            {/* Front */}
            <div style={{
              ...(is3D ? { backfaceVisibility: 'hidden', transform: `translateZ(${DEPTH / 2}px)` } : {}),
            }}>
              <VaultCard card={cardData} width={vaultW} forceEffects={true} disableTilt={true} fullRes={fullResReady} cursorTrack={true} />
            </div>

            {/* Back face */}
            <div style={{
              position: 'absolute', top: 0, left: 0,
              backfaceVisibility: 'hidden',
              transform: is3D ? `rotateY(180deg) translateZ(${DEPTH / 2}px)` : 'rotateY(180deg)',
              width: CARD_W, height: CARD_H,
              borderRadius: 22, overflow: 'hidden',
              boxShadow: `0 0 30px ${cfg.glow}, 0 0 60px ${cfg.glow}`,
            }}>
              <img
                src={cardData.rarity === 'celestial' ? '/card-back-celestial.png' : '/card-back.png'}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </div>

            {/* Thickness edges */}
            {is3D && <>
              <div style={{ position: 'absolute', top: 0, left: CARD_W, width: DEPTH, height: CARD_H, background: edgeColor, transformOrigin: '0% 50%', transform: `translateX(${-DEPTH/2}px) rotateY(90deg)`, backfaceVisibility: 'hidden' }} />
              <div style={{ position: 'absolute', top: 0, left: -DEPTH, width: DEPTH, height: CARD_H, background: edgeColor, transformOrigin: '100% 50%', transform: `translateX(${DEPTH/2}px) rotateY(-90deg)`, backfaceVisibility: 'hidden' }} />
              <div style={{ position: 'absolute', top: -DEPTH, left: 0, width: CARD_W, height: DEPTH, background: edgeColor, transformOrigin: '0% 100%', transform: `translateY(${DEPTH/2}px) rotateX(90deg)`, backfaceVisibility: 'hidden' }} />
              <div style={{ position: 'absolute', top: CARD_H, left: 0, width: CARD_W, height: DEPTH, background: edgeColor, transformOrigin: '0% 0%', transform: `translateY(${-DEPTH/2}px) rotateX(-90deg)`, backfaceVisibility: 'hidden' }} />
            </>}

            {/* Evolution white flash overlay */}
            {(evolvePhase === 'flashing' || evolvePhase === 'revealed') && (
              <div style={{
                position: 'absolute', inset: 0, borderRadius: 22, zIndex: 50,
                background: 'white',
                opacity: evolvePhase === 'flashing' ? 1 : 0,
                transition: evolvePhase === 'revealed' ? 'opacity 0.7s ease' : 'opacity 0.15s ease',
                boxShadow: evolvePhase === 'flashing' ? `0 0 80px 40px white` : 'none',
              }} />
            )}
          </div>

          {/* Focal point capture overlay (active when focalMode=true) */}
          {focalMode && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 60,
              cursor: 'crosshair',
              background: 'rgba(0,0,0,0.35)',
              borderRadius: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', textAlign: 'center', pointerEvents: 'none' }}>
                Click to set focal point
              </div>
            </div>
          )}

          {/* Focal point indicator dot */}
          {!focalMode && cardData.source_image_id && (
            <div style={{
              position: 'absolute',
              left: `${(cardData.image_focal_x ?? 0.5) * 100}%`,
              top:  `${(cardData.image_focal_y ?? 0.0) * 100}%`,
              width: 10, height: 10,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.9)',
              border: '1.5px solid rgba(0,0,0,0.5)',
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
              zIndex: 61,
              display: 'none',  /* hidden at rest — shown on hover via CSS */
            }} className="focal-dot" />
          )}
        </div>

        {/* Focal wheel button — bottom-right of card, only when image source exists */}
        {cardData.source_image_id && !is3D && isOpen && !isEvolving && (
          <button
            onClick={() => setFocalMode(m => !m)}
            title={focalMode ? 'Cancel focal point' : 'Set focal point (click image to reposition)'}
            style={{
              position: 'absolute', bottom: 8, right: 8, zIndex: 70,
              width: 28, height: 28, borderRadius: '50%',
              background: focalMode ? 'rgba(127,119,221,0.6)' : 'rgba(0,0,0,0.55)',
              border: focalMode ? '1.5px solid #CECBF6' : '1px solid rgba(255,255,255,0.2)',
              color: focalMode ? '#CECBF6' : 'rgba(255,255,255,0.55)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backdropFilter: 'blur(4px)',
              transition: 'all 0.15s ease',
            }}
          >
            <Crosshair size={13} />
          </button>
        )}
      </div>

      {/* Level Up feed panel */}
      {showFeedPanel && isOpen && !isEvolving && inventoryId && (
        <CardFeedPanel
          targetCard={cardData}
          inventoryId={inventoryId}
          onClose={() => setShowFeedPanel(false)}
          onFed={handleFed}
        />
      )}

      {/* Dupe / lower-rarity fuse panel — hidden when feed panel is open */}
      {!showFeedPanel && fuseableItems.length > 0 && isOpen && !isEvolving && inventoryId && (
        <div style={{
          width: 180,
          opacity: isOpen ? 1 : 0,
          transition: 'opacity 0.3s ease 0.15s',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Fuseable Dupes
          </div>

          {fuseableItems.map(f => (
            <div key={f.inventory_id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 8px', borderRadius: 10,
              background: 'rgba(255,255,255,0.03)',
              border: '0.5px solid rgba(255,255,255,0.06)',
            }}>
              <VaultCard card={f.card} width={54} forceEffects={false} hideLabel={true} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>
                  {f.quantity > 1 ? `×${f.quantity} ` : ''}{f.rarity}
                </div>
                <div style={{ fontSize: 10, color: '#6EE7C3', fontWeight: 700 }}>
                  +{f.total_cxp.toLocaleString()} CXP
                </div>
              </div>
            </div>
          ))}

          <button
            onClick={() => fuseAllMutation.mutate()}
            disabled={fuseAllMutation.isPending}
            style={{
              padding: '8px 10px', borderRadius: 10, fontSize: 11,
              fontWeight: 700, cursor: 'pointer',
              background: 'rgba(29,158,117,0.25)', color: '#6EE7C3',
              border: '1px solid rgba(29,158,117,0.5)',
              boxShadow: '0 0 12px rgba(29,158,117,0.2)',
              opacity: fuseAllMutation.isPending ? 0.5 : 1,
            }}
          >
            {fuseAllMutation.isPending
              ? 'Fusing…'
              : `Fuse ${totalFuseCount} → +${totalFuseCxp.toLocaleString()} CXP`}
          </button>
        </div>
      )}

      </div>{/* end flex row */}

      {/* Level / CXP bar */}
      {isOpen && !isEvolving && (
        <div style={{ width: CARD_W, opacity: isOpen ? 1 : 0, transition: 'opacity 0.25s ease' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
            <span>LV {cardLevel}{atMaxCxp ? ' · MAX' : ` · CXP ${currentCxp.toLocaleString()} / ${(cxpThreshold ?? 0).toLocaleString()}`}</span>
            {atMaxCxp && <span style={{ color: cfg.badge, fontWeight: 700 }}>✨ MAX LEVEL</span>}
          </div>
          <div style={{ height: 4, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 4,
              width: `${cxpPct}%`,
              background: atMaxCxp
                ? `linear-gradient(90deg, ${cfg.badge}, #fff, ${cfg.badge})`
                : cfg.badge,
              backgroundSize: atMaxCxp ? '200% 100%' : 'auto',
              boxShadow: atMaxCxp ? `0 0 8px ${cfg.badge}` : 'none',
              transition: 'width 0.4s ease',
              animation: atMaxCxp ? 'cxp-bar-shine 1.4s ease-in-out infinite' : 'none',
            }} />
          </div>
        </div>
      )}

      {/* Bottom actions */}
      <div style={{
        display: 'flex', gap: 10,
        opacity: isOpen && !isEvolving ? 1 : 0,
        transition: 'opacity 0.25s ease',
        pointerEvents: isEvolving ? 'none' : 'auto',
      }}>
        {is3D && (
          <button onClick={() => { setRotX(0); setRotY(0) }} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
            background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)',
            border: '0.5px solid rgba(255,255,255,0.1)',
          }}>
            <RotateCcw size={11} /> Reset
          </button>
        )}

        {/* Level Up — opens feed panel */}
        {inventoryId && (
          <button
            className={lvlUpPopped ? 'lvl-up-popped' : undefined}
            onClick={() => {
              setLvlUpPopped(true)
              setTimeout(() => setLvlUpPopped(false), 300)
              setShowFeedPanel(p => !p)
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 16px', borderRadius: 20, fontSize: 11, fontWeight: 700,
              cursor: 'pointer',
              background: showFeedPanel ? 'rgba(29,158,117,0.25)' : 'rgba(255,255,255,0.06)',
              color: showFeedPanel ? '#6EE7C3' : 'rgba(255,255,255,0.5)',
              border: showFeedPanel ? '1px solid rgba(29,158,117,0.5)' : '0.5px solid rgba(255,255,255,0.1)',
              transition: 'background 0.15s ease, color 0.15s ease, border 0.15s ease',
            }}
          >
            <TrendingUp size={11} /> Level Up
          </button>
        )}

        {/* Catalyst → craft foil (rarity is fixed; foil is the upgrade now) */}
        {inventoryId && !cardData.foil && !cardData.is_relic && cardData.card_type !== 'hof' && (
          <button
            onClick={() => catalystMutation.mutate()}
            disabled={catalystMutation.isPending}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 18px', borderRadius: 20, fontSize: 11, fontWeight: 700,
              cursor: 'pointer',
              background: 'linear-gradient(135deg, rgba(255,215,0,0.25), rgba(255,140,0,0.15))',
              color: '#FFD700',
              border: '1px solid rgba(255,215,0,0.5)',
              boxShadow: '0 0 16px rgba(255,215,0,0.25)',
              opacity: catalystMutation.isPending ? 0.5 : 1,
            }}
          >
            ✨ Make Prestige <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 400, fontSize: 10 }}>(1 ⚗️)</span>
          </button>
        )}

        {/* Craft Prestige → crafted from dupes + credits, never pulled from packs */}
        {inventoryId && !cardData.prestige && !cardData.foil && (() => {
          const quantity      = cardData.quantity ?? 1
          const dupesNeeded   = cardData.prestige_dupes ?? 6
          const creditsNeeded = cardData.prestige_credits ?? 1000
          const canCraft      = quantity >= dupesNeeded && credits >= creditsNeeded
          return (
            <button
              onClick={() => canCraft && craftPrestigeMutation.mutate()}
              disabled={craftPrestigeMutation.isPending || !canCraft}
              title={!canCraft ? `Needs ${dupesNeeded} copies + ${creditsNeeded} cr (you have ${quantity})` : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 18px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                cursor: canCraft ? 'pointer' : 'not-allowed',
                background: canCraft
                  ? 'linear-gradient(135deg, rgba(255,120,120,0.25), rgba(120,180,255,0.2), rgba(200,120,255,0.25))'
                  : 'rgba(255,255,255,0.05)',
                backgroundSize: '200% 100%',
                color: canCraft ? '#fff' : 'rgba(255,255,255,0.3)',
                border: canCraft ? '1px solid rgba(255,255,255,0.5)' : '0.5px solid rgba(255,255,255,0.1)',
                boxShadow: canCraft ? '0 0 16px rgba(200,120,255,0.3)' : 'none',
                opacity: craftPrestigeMutation.isPending ? 0.5 : 1,
              }}
            >
              ✦ Craft Prestige{' '}
              <span style={{ color: canCraft ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.25)', fontWeight: 400, fontSize: 10 }}>
                {canCraft
                  ? `(${dupesNeeded} copies + ${creditsNeeded} cr)`
                  : `Needs ${dupesNeeded} copies + ${creditsNeeded} cr (you have ${quantity})`}
              </span>
            </button>
          )
        })()}
      </div>

      {is3D && isOpen && !isEvolving && (
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>
          Click &amp; drag to rotate
        </div>
      )}
    </div>,
    document.body
  )
}

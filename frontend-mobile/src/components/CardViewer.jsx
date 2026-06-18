import { useState, useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import VaultCard from './VaultCard.jsx'

// Fullscreen, box-free TCG card viewer for touch.
//   • Card sits front-and-centre over a blurred backdrop — no surrounding frame.
//   • Horizontal swipe moves to the previous / next card in the page.
//   • A finger drag rotates the card in 3D; cross the half-turn and you see its back.
//   • Holo foil follows the finger (pointer prop) and the PC auto-animations stay on.
//
// Props: cards (array), index, onIndexChange(i), onClose()
export default function CardViewer({ cards, index, onClose, onIndexChange }) {
  const [i, setI] = useState(index)
  const card = cards[i]

  // 3D rotation state. rotY 180° (mod 360) shows the back face.
  const [rotX, setRotX] = useState(0)
  const [rotY, setRotY] = useState(0)
  const [pointer, setPointer] = useState(null)   // {x,y} 0..1 for holo
  const [dragX, setDragX] = useState(0)           // horizontal swipe offset (px)
  const drag = useRef(null)

  useEffect(() => { setI(index) }, [index])
  useEffect(() => { onIndexChange?.(i) }, [i])

  // Reset orientation whenever the displayed card changes.
  useEffect(() => { setRotX(0); setRotY(0); setPointer(null); setDragX(0) }, [i])

  const go = useCallback((delta) => {
    setI(prev => Math.min(cards.length - 1, Math.max(0, prev + delta)))
  }, [cards.length])

  function onPointerDown(e) {
    const t = e.touches ? e.touches[0] : e
    drag.current = {
      startX: t.clientX, startY: t.clientY,
      rotX, rotY, lastX: t.clientX, lastY: t.clientY,
      mode: null, moved: 0,
    }
  }
  function onPointerMove(e) {
    if (!drag.current) return
    const t = e.touches ? e.touches[0] : e
    const dx = t.clientX - drag.current.startX
    const dy = t.clientY - drag.current.startY
    drag.current.moved = Math.abs(dx) + Math.abs(dy)

    // Lock into either a horizontal "swipe" gesture or a "rotate" gesture.
    if (!drag.current.mode && drag.current.moved > 10) {
      drag.current.mode = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'swipe' : 'rotate'
    }

    if (drag.current.mode === 'swipe') {
      setDragX(dx)
    } else if (drag.current.mode === 'rotate') {
      setRotY(drag.current.rotY + dx * 0.45)
      setRotX(Math.max(-45, Math.min(45, drag.current.rotX - dy * 0.45)))
      // Feed holo from finger position over the card.
      const rect = e.currentTarget.getBoundingClientRect()
      setPointer({
        x: Math.min(1, Math.max(0, (t.clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (t.clientY - rect.top) / rect.height)),
      })
    }
  }
  function onPointerUp() {
    if (!drag.current) return
    const { mode } = drag.current
    if (mode === 'swipe') {
      if (dragX < -60) go(1)
      else if (dragX > 60) go(-1)
      setDragX(0)
    } else if (mode === 'rotate') {
      // Snap to nearest face (front = 0°, back = 180°).
      const norm = ((rotY % 360) + 360) % 360
      const toBack = norm > 90 && norm < 270
      setRotY(toBack ? 180 : 0)
      setRotX(0)
      setPointer(null)
    }
    drag.current = null
  }

  const cardW = Math.min(340, Math.round(window.innerWidth * 0.82))
  const norm = ((rotY % 360) + 360) % 360
  const showingBack = norm > 90 && norm < 270
  const backImg = (card?.rarity === 'celestial') ? '/card-back-celestial.png' : '/card-back.png'

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ background: 'rgba(6,6,10,0.86)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4"
           style={{ paddingTop: 'calc(var(--sat) + 10px)' }}>
        <button onClick={onClose} className="p-2"><X size={26} color="#fff" /></button>
        <span className="text-[15px]" style={{ color: 'rgba(255,255,255,0.55)' }}>{i + 1} / {cards.length}</span>
        <div className="w-10" />
      </div>

      {/* Card stage */}
      <div
        className="flex-1 flex items-center justify-center overflow-hidden"
        style={{ perspective: 1400, touchAction: 'none' }}
        onTouchStart={onPointerDown}
        onTouchMove={onPointerMove}
        onTouchEnd={onPointerUp}
        onMouseDown={onPointerDown}
        onMouseMove={e => drag.current && onPointerMove(e)}
        onMouseUp={onPointerUp}
        onMouseLeave={onPointerUp}
      >
        <div style={{
          transform: `translateX(${dragX}px) rotateX(${rotX}deg) rotateY(${rotY}deg)`,
          transformStyle: 'preserve-3d',
          transition: drag.current ? 'none' : 'transform 0.45s cubic-bezier(.2,.8,.2,1)',
          position: 'relative',
        }}>
          {/* Front face */}
          <div style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
            <VaultCard card={card} width={cardW} fullRes forceEffects pointer={pointer} />
          </div>
          {/* Back face */}
          <div style={{
            position: 'absolute', inset: 0,
            transform: 'rotateY(180deg)',
            backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <img src={backImg} alt="" draggable={false}
                 style={{ width: cardW, height: Math.round(cardW * 1.45), borderRadius: 16, objectFit: 'cover', boxShadow: '0 8px 30px rgba(0,0,0,0.6)' }} />
          </div>
        </div>
      </div>

      {/* Meta + hint */}
      <div className="px-6 text-center" style={{ paddingBottom: 'calc(var(--sab) + 20px)' }}>
        {!showingBack ? (
          <>
            {card?.creator_name && <div className="text-lg font-bold truncate">{card.creator_name}</div>}
            {card?.character_name && card.character_name !== card?.creator_name && (
              <div className="text-[15px] truncate" style={{ color: 'var(--accent)' }}>{card.character_name}</div>
            )}
            {card?.gallery_name && <div className="text-[14px] truncate" style={{ color: 'rgba(255,255,255,0.5)' }}>{card.gallery_name}</div>}
            {card?.cxp > 0 && <div className="mt-1 text-[14px]" style={{ color: 'rgba(255,255,255,0.45)' }}>CXP {card.cxp}</div>}
          </>
        ) : (
          <div className="text-[15px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Card back</div>
        )}
        <div className="mt-3 text-[13px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
          Swipe to browse · drag to flip
        </div>
      </div>
    </motion.div>
  )
}

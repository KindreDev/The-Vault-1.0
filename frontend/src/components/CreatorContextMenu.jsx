import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ExternalLink, Star, StarOff, Trash2 } from 'lucide-react'

const DIVIDER = '---'

/**
 * Right-click context menu for creator cards.
 *
 * Props
 *   creator      – the creator object
 *   position     – { x, y }
 *   onClose
 *   onOpen       – navigate to creator profile
 *   onToggleFav  – toggle favourite
 *   onDelete     – delete creator
 */
export default function CreatorContextMenu({
  creator, position, onClose,
  onOpen, onToggleFav, onDelete,
}) {
  const menuRef = useRef(null)

  useEffect(() => {
    const onKey  = (e) => { if (e.key === 'Escape') onClose() }
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) onClose() }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const MENU_W = 200
  const MENU_H = 180
  const x = Math.min(position.x, window.innerWidth  - MENU_W - 8)
  const y = Math.min(position.y, window.innerHeight - MENU_H - 8)

  const isFav = creator.is_favorite

  const items = [
    { icon: ExternalLink, label: 'Open profile',              action: onOpen,       style: 'normal' },
    DIVIDER,
    { icon: isFav ? StarOff : Star,
                          label: isFav ? 'Unfavorite' : 'Favorite',
                                                               action: onToggleFav,  style: isFav ? 'normal' : 'amber' },
    DIVIDER,
    { icon: Trash2,       label: 'Delete creator',            action: onDelete,     style: 'danger' },
  ]

  const COLORS = {
    normal: 'rgba(255,255,255,0.82)',
    amber:  '#FAC775',
    danger: '#F4C0D1',
  }

  const wrap = (fn) => (e) => { e.stopPropagation(); fn?.(); onClose() }

  return createPortal(
    <AnimatePresence>
      <motion.div
        ref={menuRef}
        key="creator-ctx"
        initial={{ opacity: 0, scale: 0.94, y: -6 }}
        animate={{ opacity: 1, scale: 1,    y: 0  }}
        exit={{    opacity: 0, scale: 0.94, y: -6 }}
        transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
        style={{
          position: 'fixed', left: x, top: y, zIndex: 9999,
          width: MENU_W,
          background: 'rgba(22,22,26,0.97)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '0.5px solid rgba(255,255,255,0.13)',
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)',
          padding: '5px 0',
          overflow: 'hidden',
        }}
      >
        {/* creator name header */}
        <div style={{ padding: '6px 14px 8px', borderBottom: '0.5px solid rgba(255,255,255,0.07)', marginBottom: 3 }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {creator.name}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 1, textTransform: 'capitalize' }}>
            {creator.creator_type}
          </div>
        </div>

        {items.map((item, i) => {
          if (item === DIVIDER) return <div key={`d${i}`} style={{ height: 1, margin: '4px 0', background: 'rgba(255,255,255,0.07)' }} />
          const Icon = item.icon
          return (
            <button
              key={item.label}
              type="button"
              onMouseDown={wrap(item.action)}
              className="w-full text-left cursor-pointer flex items-center gap-2.5 select-none"
              style={{ padding: '7px 14px', fontSize: 13, color: COLORS[item.style], background: 'transparent', transition: 'background 0.08s' }}
              onMouseEnter={e => { e.currentTarget.style.background = item.style === 'danger' ? 'rgba(212,83,126,0.18)' : 'rgba(255,255,255,0.07)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <Icon size={13} style={{ flexShrink: 0, opacity: 0.8 }} />
              {item.label}
            </button>
          )
        })}
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}

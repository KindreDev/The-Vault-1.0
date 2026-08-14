import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight } from 'lucide-react'

export const DIVIDER = '---'

const COLORS = {
  normal: 'rgba(255,255,255,0.82)',
  amber:  '#FAC775',
  accent: '#A79FF0',
  danger: '#F4C0D1',
}

/**
 * Generic slim right-click menu (Windows 11 style) — same look as the
 * Gallery/Image context menus but driven entirely by an items array.
 *
 * Props
 *   title     – header line (e.g. item name)
 *   subtitle  – optional second header line
 *   position  – { x, y } cursor coords
 *   onClose
 *   items     – array of { icon, label, action, style? } or DIVIDER.
 *               An item may instead carry children: [{ label, action }] — it then
 *               renders as an expandable row (e.g. pick which creator to apply to).
 */
export default function SlimContextMenu({ title, subtitle, position, onClose, items }) {
  const menuRef = useRef(null)
  const [openIdx, setOpenIdx] = useState(null)

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

  const MENU_W = 210
  const MENU_H = 60 + items.length * 30
  const x = Math.min(position.x, window.innerWidth  - MENU_W - 8)
  const y = Math.min(position.y, window.innerHeight - MENU_H - 8)

  const wrap = (fn) => (e) => { e.stopPropagation(); fn?.(); onClose() }

  return createPortal(
    <AnimatePresence>
      <motion.div
        ref={menuRef}
        key="slim-ctx"
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
        <div style={{ padding: '6px 14px 8px', borderBottom: '0.5px solid rgba(255,255,255,0.07)', marginBottom: 3 }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </div>
          {subtitle && (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 1 }}>{subtitle}</div>
          )}
        </div>

        {items.map((item, i) => {
          if (item === DIVIDER) {
            return <div key={`d${i}`} style={{ height: 1, margin: '4px 0', background: 'rgba(255,255,255,0.07)' }} />
          }
          const Icon = item.icon
          const style = item.style || 'normal'
          if (item.children?.length) {
            const open = openIdx === i
            return (
              <React.Fragment key={item.label}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.stopPropagation(); setOpenIdx(open ? null : i) }}
                  className="w-full text-left cursor-pointer flex items-center gap-2.5 select-none"
                  style={{
                    padding: '7px 14px', fontSize: 13, color: 'var(--accent)',
                    background: open ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
                    transition: 'background 0.08s',
                  }}
                  onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = open ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent' }}
                >
                  <Icon size={13} style={{ flexShrink: 0, opacity: 0.8 }} />
                  <span style={{ flex: 1 }}>{item.label}</span>
                  <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                               style={{ display: 'flex', alignItems: 'center' }}>
                    <ChevronRight size={11} style={{ opacity: 0.5 }} />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      key={`sub-${i}`}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      {item.children.map(child => (
                        <button
                          key={child.label}
                          type="button"
                          onMouseDown={wrap(child.action)}
                          className="w-full text-left cursor-pointer flex items-center gap-2 select-none"
                          style={{ padding: '5px 14px 5px 32px', fontSize: 12, color: 'rgba(255,255,255,0.75)', background: 'transparent', transition: 'background 0.08s' }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 16%, transparent)' }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{child.label}</span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </React.Fragment>
            )
          }
          return (
            <button
              key={item.label}
              type="button"
              onMouseDown={wrap(item.action)}
              className="w-full text-left cursor-pointer flex items-center gap-2.5 select-none"
              style={{ padding: '7px 14px', fontSize: 13, color: COLORS[style], background: 'transparent', transition: 'background 0.08s' }}
              onMouseEnter={e => { e.currentTarget.style.background = style === 'danger' ? 'color-mix(in srgb, var(--c-pink) 18%, transparent)' : 'rgba(255,255,255,0.07)' }}
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

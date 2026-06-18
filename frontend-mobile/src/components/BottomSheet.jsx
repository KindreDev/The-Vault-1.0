import { createPortal } from 'react-dom'
import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

// A slide-up action sheet. `actions` is an array of:
//   { label, icon, onClick, danger?, disabled? }
// Pass `title` for an optional header. Rendered in a portal over everything.
// Enter AND exit are animated — the component stays mounted so AnimatePresence
// can play the dismiss animation before the content unmounts.
const EASE = [0.22, 1, 0.36, 1]

export default function BottomSheet({ open, onClose, title, actions = [], children }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <motion.div
            className="absolute inset-0 bg-black/60"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            className="relative rounded-t-2xl border-t border-vault-border safe-bottom"
            style={{ background: 'var(--c-surface)' }}
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ duration: 0.26, ease: EASE }}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1.5 w-10 rounded-full bg-white/20" />
            </div>
            {title && (
              <div className="px-5 py-2 text-base font-medium truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>
                {title}
              </div>
            )}
            {children}
            <div className="pb-2">
              {actions.map((a, i) => (
                <button
                  key={i}
                  disabled={a.disabled}
                  onClick={() => { a.onClick?.(); onClose() }}
                  className="w-full flex items-center gap-4 px-5 py-4 text-left text-[17px] active:bg-white/5 disabled:opacity-40"
                  style={{ color: a.danger ? 'var(--c-pink)' : 'rgba(255,255,255,0.9)' }}
                >
                  {a.icon && <span className="shrink-0">{a.icon}</span>}
                  {a.label}
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}

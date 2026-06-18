import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, Check } from 'lucide-react'

// A searchable single/multi-select sheet. `options` is [{ id, label }].
// `selected` is an id (single) or array of ids (multi). Calls onSelect(id) for
// single, or onToggle(id) for multi. Rendered in a portal with animated dismiss.
const EASE = [0.22, 1, 0.36, 1]

export default function PickerSheet({
  open, onClose, title, options = [], selected, multi = false, onSelect, onToggle, footer,
}) {
  const [q, setQ] = useState('')
  useEffect(() => { if (open) setQ('') }, [open])

  const ql = q.trim().toLowerCase()
  const filtered = ql ? options.filter(o => o.label.toLowerCase().includes(ql)) : options
  const isSel = (id) => multi ? (selected || []).includes(id) : selected === id

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end">
          <motion.div
            className="absolute inset-0 bg-black/60"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            className="relative rounded-t-2xl flex flex-col" style={{ background: 'var(--c-surface)', maxHeight: '80vh' }}
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ duration: 0.26, ease: EASE }}
          >
            <div className="flex justify-center pt-3 pb-1"><div className="h-1.5 w-10 rounded-full bg-white/20" /></div>
            {title && <div className="px-5 py-2 text-base font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>{title}</div>}
            <div className="px-4 pb-2">
              <div className="flex items-center gap-2 px-3 rounded-xl" style={{ background: 'var(--c-card)' }}>
                <Search size={18} style={{ color: 'rgba(255,255,255,0.4)' }} />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search"
                       className="flex-1 py-2.5 bg-transparent outline-none text-[16px]" />
              </div>
            </div>
            <div className="overflow-y-auto pb-2">
              {filtered.map(o => (
                <button key={o.id}
                        onClick={() => { if (multi) onToggle?.(o.id); else { onSelect?.(o.id); onClose() } }}
                        className="w-full flex items-center gap-3 px-5 py-3.5 text-left text-[16px] active:bg-white/5">
                  <span className="flex-1 truncate" style={{ color: isSel(o.id) ? 'var(--accent)' : 'rgba(255,255,255,0.9)' }}>{o.label}</span>
                  {isSel(o.id) && <Check size={20} style={{ color: 'var(--accent)' }} />}
                </button>
              ))}
              {!filtered.length && <div className="px-5 py-6 text-center text-[15px]" style={{ color: 'rgba(255,255,255,0.35)' }}>Nothing found</div>}
            </div>
            {footer && <div className="p-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}

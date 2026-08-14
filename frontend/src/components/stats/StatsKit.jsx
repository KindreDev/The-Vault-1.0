/**
 * Shared building blocks for the gallery and photo stats modals.
 *
 * Mirrors the visual language of CreatorStatsModal (which keeps its own copies
 * — it predates this file and works, so it is left alone rather than being
 * refactored under a shipping deadline).
 */
import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'

export const fmtDuration = (secs) => {
  if (!secs || secs <= 0) return null
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`
  return `${s}s`
}

export const num = (n) => (n ?? 0).toLocaleString()

export const fmtDate = (iso) => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return '—' }
}

export function Stat({ label, value, sub, accent = 'rgba(255,255,255,0.92)', big = false }) {
  return (
    <div className="rounded-[10px] px-4 py-3 flex flex-col gap-0.5"
         style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.06)' }}>
      <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>{label}</div>
      <div style={{ fontSize: big ? 30 : 24, fontWeight: 800, color: accent, lineHeight: 1.1, letterSpacing: '-0.01em' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>{sub}</div>}
    </div>
  )
}

export function Panel({ icon: Icon, title, subtitle, accent = 'var(--c-accent)', children }) {
  return (
    <div className="rounded-[14px] p-5"
         style={{ background: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0"
             style={{ background: `${accent}20`, border: `0.5px solid ${accent}44` }}>
          <Icon size={17} style={{ color: accent }} />
        </div>
        <div>
          <div style={{ fontSize: 19, fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>{subtitle}</div>}
        </div>
      </div>
      {children}
    </div>
  )
}

/** A clickable "best of" row with a thumbnail. */
export function Standout({ label, accent, thumb, title, meta, onClick }) {
  return (
    <button onClick={onClick}
            className="w-full flex items-center gap-3 p-2 rounded-[10px] text-left cursor-pointer transition-colors hover:bg-white/[0.05]"
            style={{ background: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.06)' }}>
      {thumb
        ? <img src={thumb} alt="" className="rounded-[7px] flex-shrink-0"
               style={{ width: 52, height: 52, objectFit: 'cover' }} />
        : <div className="rounded-[7px] flex-shrink-0" style={{ width: 52, height: 52, background: 'rgba(255,255,255,0.05)' }} />}
      <div className="min-w-0 flex-1">
        <div style={{ fontSize: 15, color: accent, fontWeight: 600 }}>{label}</div>
        <div className="truncate" style={{ fontSize: 16, color: 'rgba(255,255,255,0.8)' }}>{title}</div>
        {meta && <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.35)' }}>{meta}</div>}
      </div>
    </button>
  )
}

/** Tag chip — AI tags purple, manual tags white, per the design rules. */
export function TagChip({ name, source, confidence, count }) {
  const ai = source === 'ai'
  return (
    <span className="px-2.5 py-1 rounded-full inline-flex items-center gap-1.5"
          title={confidence != null ? `AI confidence ${Math.round(confidence * 100)}%` : undefined}
          style={{
            fontSize: 16,
            background: ai ? 'color-mix(in srgb, var(--c-accent) 16%, transparent)' : 'rgba(255,255,255,0.07)',
            color:      ai ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.85)',
            border: `0.5px solid ${ai ? 'color-mix(in srgb, var(--c-accent) 35%, transparent)' : 'rgba(255,255,255,0.14)'}`,
          }}>
      {name}
      {count > 1 && <span style={{ opacity: 0.5 }}>×{count}</span>}
    </span>
  )
}

/** Shared modal shell: portal, backdrop, Escape, scroll container. */
export function StatsModalShell({ open, onClose, children, maxWidth = 1080 }) {
  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-[10001] flex items-start justify-center overflow-y-auto p-6"
        style={{ background: 'rgba(0,0,0,0.8)' }}
        onClick={onClose}>
        <motion.div
          initial={{ y: 12 }} animate={{ y: 0 }} exit={{ y: 8 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          onClick={e => e.stopPropagation()}
          className="rounded-[18px] w-full my-auto relative"
          style={{ maxWidth, background: '#141414',
                   border: '0.5px solid rgba(255,255,255,0.1)',
                   boxShadow: '0 30px 90px rgba(0,0,0,0.7)' }}>
          <button onClick={onClose}
                  className="absolute top-4 right-4 z-10 p-2 rounded-full cursor-pointer transition-colors hover:bg-white/10"
                  style={{ background: 'rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.6)' }}>
            <X size={18} />
          </button>
          <div className="p-6">{children}</div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}

export function LoadingBody() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20">
      <div className="skeleton" style={{ width: 160, height: 16, borderRadius: 8 }} />
      <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>Crunching the numbers…</div>
    </div>
  )
}

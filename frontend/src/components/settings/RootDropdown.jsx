import React from 'react'
import ReactDOM from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { useT } from '../../i18n'

// ── Custom library-root picker ───────────────────────────────────────────────
// Portals the list to document.body so backdrop-filter stacking contexts on
// glass/cyberpunk themes (and modals) can't clip or z-bury the dropdown.
// A capture-phase scroll listener re-measures on every scroll event so the
// list stays anchored to the button even when <main> or any parent scrolls.
export default function RootDropdown({ roots, value, onChange }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [pos, setPos]   = React.useState(null) // plain { top, left, width }
  const btnRef  = React.useRef(null)
  const listRef = React.useRef(null)

  const measure = React.useCallback(() => {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: r.left, width: r.width })
  }, [])

  React.useEffect(() => {
    if (!open) return
    measure()
    window.addEventListener('scroll', measure, true) // capture catches all scroll containers
    window.addEventListener('resize', measure)
    const close = e => {
      if (btnRef.current?.contains(e.target)) return
      if (listRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
      document.removeEventListener('mousedown', close)
    }
  }, [open, measure])

  const selected = roots.find(r => String(r.id) === String(value))
  const label = selected
    ? (selected.label ? `${selected.label} — ${selected.path}` : selected.path)
    : t('— Select a library root —')

  const list = open && pos && ReactDOM.createPortal(
    <div
      ref={listRef}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: pos.width,
        zIndex: 9999,
        background: 'var(--c-card, #1e1e1e)',
        border: '0.5px solid rgba(255,255,255,0.14)',
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        maxHeight: 260,
        overflowY: 'auto',
      }}>
      <button
        type="button"
        onClick={() => { onChange(''); setOpen(false) }}
        className="w-full text-left px-3 py-2 text-[16px] cursor-pointer hover:bg-[rgba(255,255,255,0.07)]"
        style={{ color: 'rgba(255,255,255,0.35)' }}>
        {t('— Select a library root —')}
      </button>
      {roots.map(r => (
        <button
          key={r.id}
          type="button"
          onClick={() => { onChange(String(r.id)); setOpen(false) }}
          className="w-full text-left px-3 py-2 text-[16px] cursor-pointer hover:bg-[rgba(255,255,255,0.07)]"
          style={{ color: String(r.id) === String(value) ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.75)', background: String(r.id) === String(value) ? 'color-mix(in srgb, var(--c-accent) 12%, transparent)' : 'transparent' }}>
          {r.label ? <><span style={{ color: 'var(--c-accent-text)' }}>{r.label}</span> <span style={{ color: 'rgba(255,255,255,0.35)' }}>— {r.path}</span></> : r.path}
        </button>
      ))}
    </div>,
    document.body
  )

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => { if (open) { setOpen(false) } else { measure(); setOpen(true) } }}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-[8px] text-[16px] text-left cursor-pointer"
        style={{ background: 'rgba(255,255,255,0.06)', color: selected ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)', border: '0.5px solid rgba(255,255,255,0.12)' }}>
        <span className="truncate">{label}</span>
        <ChevronDown size={14} style={{ flexShrink: 0, color: 'rgba(255,255,255,0.3)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>
      {list}
    </div>
  )
}

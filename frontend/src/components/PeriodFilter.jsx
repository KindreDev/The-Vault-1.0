import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown, X, Check, CalendarDays } from 'lucide-react'
import { useT } from '../i18n'

/**
 * Period (collection term) filter — pill button, dropdown list of distinct
 * periods. `periods` is [{ value, label, count }] sorted newest-first.
 * Mirrors the UX of FranchiseFilter.
 */
export default function PeriodFilter({ value, periods = [], onChange }) {
  const t               = useT()
  const [open, setOpen] = useState(false)
  const ref             = useRef(null)

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const clear = (e) => { e?.stopPropagation(); onChange(null) }

  if (!periods.length) return null

  const selected = periods.find(p => p.value === value)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); setOpen(o => !o) }}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[13px] cursor-pointer"
        style={{
          background: value ? 'color-mix(in srgb, var(--c-accent) 20%, transparent)' : 'rgba(255,255,255,0.05)',
          color: value ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.45)',
          border: `0.5px solid ${value ? 'color-mix(in srgb, var(--c-accent) 40%, transparent)' : 'rgba(255,255,255,0.08)'}`,
        }}>
        <CalendarDays size={11} />
        {selected ? selected.label : t('Period')}
        {value
          ? <X size={11} onMouseDown={clear} className="cursor-pointer" />
          : <ChevronDown size={11} />}
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 rounded-[10px] overflow-hidden shadow-2xl animate-menu-pop"
             style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.15)', minWidth: 200, maxHeight: 320 }}>
          <div className="overflow-y-auto" style={{ maxHeight: 320 }}>
            {value && (
              <button
                type="button"
                onMouseDown={clear}
                className="w-full text-left px-3 py-2 text-[13px] text-[rgba(255,255,255,0.4)] hover:bg-[rgba(255,255,255,0.05)] cursor-pointer">
                {t('Clear selection')}
              </button>
            )}
            {periods.map(p => (
              <button
                key={p.value}
                type="button"
                onMouseDown={() => { onChange(p.value); setOpen(false) }}
                className="w-full text-left px-3 py-2 text-[13px] cursor-pointer flex items-center gap-2 hover:bg-[rgba(255,255,255,0.05)]"
                style={{
                  background: value === p.value ? 'color-mix(in srgb, var(--c-accent) 15%, transparent)' : 'transparent',
                  color: value === p.value ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.7)',
                }}>
                {value === p.value && <Check size={12} style={{ color: 'var(--c-accent)', flexShrink: 0 }} />}
                <span className="flex-1">{p.label}</span>
                <span className="text-[rgba(255,255,255,0.3)]">{p.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

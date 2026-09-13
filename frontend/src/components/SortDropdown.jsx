import React, { useState, useRef, useEffect } from 'react'
import { Check, ChevronDown, SortAsc, SortDesc } from 'lucide-react'
import { useT } from '../i18n'

export function SortDropdown({ value, onChange, options, sortDir, onSortDirChange }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const selected = options.find(o => o.value === value)

  // When selecting the same option again, toggle sort direction (except for random)
  const handleSelect = (optionValue) => {
    if (optionValue === value && optionValue !== 'random' && onSortDirChange) {
      // Toggle direction
      onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      onChange(optionValue)
    }
    setOpen(false)
  }

  // Determine which icon to show based on sort direction
  const SortIcon = sortDir === 'asc' ? SortAsc : SortDesc
  return (
    <div ref={ref} className="relative z-30 flex-shrink-0">
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); setOpen(o => !o) }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[16px] cursor-pointer"
        style={{
          background: 'rgba(255,255,255,0.05)',
          color: 'rgba(255,255,255,0.45)',
          border: '0.5px solid rgba(255,255,255,0.08)',
        }}>
        {selected ? t(selected.label) : null}
        {onSortDirChange && value !== 'random' ? (
          <span
            onMouseDown={e => {
              e.preventDefault()
              e.stopPropagation()
              onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc')
            }}
            title={`${sortDir === 'asc' ? t('Ascending') : t('Descending')} — ${t('click to flip')}`}
            className="cursor-pointer">
            <SortIcon size={11} />
          </span>
        ) : (
          <ChevronDown size={11} />
        )}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 rounded-[10px] shadow-2xl overflow-hidden animate-menu-pop min-w-[160px]"
             style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.15)', minWidth: 220, maxHeight: 300 }}>
          {options.map(o => (
            <button key={o.value} type="button" onMouseDown={() => handleSelect(o.value)}
                    className="w-full text-left px-3 py-2 text-[13px] cursor-pointer hover:bg-[rgba(255,255,255,0.05)] flex items-center gap-2"
                    style={{
                      color: value === o.value ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.75)',
                      background: value === o.value ? 'color-mix(in srgb, var(--c-accent) 15%, transparent)' : 'transparent',
                    }}>
              {value === o.value && <Check size={12} style={{ color: 'var(--c-accent)', flexShrink: 0 }} />}
              <span>{t(o.label)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

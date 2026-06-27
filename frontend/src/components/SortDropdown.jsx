import React, { useState, useRef, useEffect } from 'react'
import { SortAsc, SortDesc, ArrowUpDown } from 'lucide-react'
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
  const isReversed = sortDir === 'asc'

  return (
    <div ref={ref} className="relative z-20 flex-shrink-0">
      {/* Two-zone trigger: label opens dropdown, arrow directly toggles asc/desc */}
      <div className="flex items-center rounded-full overflow-hidden text-[11px]"
           style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.15)' }}>
        <button type="button" onMouseDown={() => setOpen(o => !o)}
                className="flex items-center gap-1.5 pl-3 pr-2 py-1.5 cursor-pointer"
                style={{ color: 'rgba(255,255,255,0.75)' }}>
          {selected ? t(selected.label) : null}
          {isReversed && value !== 'random' && (
            <span className="text-[9px] px-1 py-0 rounded-full"
                  style={{ background: 'rgba(127,119,221,0.25)', color: '#CECBF6' }}>
              ↑
            </span>
          )}
        </button>
        {onSortDirChange && value !== 'random' && (
          <button
            type="button"
            onMouseDown={(e) => { e.stopPropagation(); onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc') }}
            className="px-2 py-1.5 cursor-pointer transition-colors hover:bg-[rgba(255,255,255,0.08)]"
            style={{ borderLeft: '0.5px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.35)' }}
            title={`${sortDir === 'asc' ? t('Ascending') : t('Descending')} — ${t('click to flip')}`}>
            <SortIcon size={11} />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute top-full right-0 mt-1 rounded-[8px] shadow-2xl overflow-hidden animate-menu-pop min-w-[160px]"
             style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.12)' }}>
          {options.map(o => (
            <button key={o.value} type="button" onMouseDown={() => handleSelect(o.value)}
                    className="w-full text-left px-3 py-2 text-[11px] cursor-pointer hover:bg-[rgba(255,255,255,0.05)] flex items-center justify-between gap-2"
                    style={{ color: value === o.value ? '#CECBF6' : 'rgba(255,255,255,0.75)' }}>
              <span>{t(o.label)}</span>
              {value === o.value && o.value !== 'random' && (
                <ArrowUpDown size={10} style={{ color: 'rgba(127,119,221,0.6)' }} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

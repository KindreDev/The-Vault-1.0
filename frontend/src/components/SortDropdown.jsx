import React, { useState, useRef, useEffect } from 'react'
import { SortAsc, SortDesc, ArrowUpDown } from 'lucide-react'

export function SortDropdown({ value, onChange, options, sortDir, onSortDirChange }) {
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
      <button type="button" onMouseDown={() => setOpen(o => !o)}
              className="flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full text-[11px] cursor-pointer"
              style={{ background: '#1e1e1e', color: 'rgba(255,255,255,0.75)', border: '0.5px solid rgba(255,255,255,0.15)' }}>
        {selected?.label}
        {isReversed && value !== 'random' && (
          <span className="text-[9px] px-1 py-0 rounded-full ml-0.5"
                style={{ background: 'rgba(127,119,221,0.25)', color: '#CECBF6' }}>
            REV
          </span>
        )}
        <SortIcon size={11} className="text-[rgba(255,255,255,0.3)] ml-1" />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 rounded-[8px] shadow-2xl overflow-hidden animate-menu-pop min-w-[160px]"
             style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.12)' }}>
          {options.map(o => (
            <button key={o.value} type="button" onMouseDown={() => handleSelect(o.value)}
                    className="w-full text-left px-3 py-2 text-[11px] cursor-pointer hover:bg-[rgba(255,255,255,0.05)] flex items-center justify-between gap-2"
                    style={{ color: value === o.value ? '#CECBF6' : 'rgba(255,255,255,0.75)' }}>
              <span>{o.label}</span>
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

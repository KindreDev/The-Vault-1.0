import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'

export function FormDropdown({ value, onChange, options, placeholder = "Select...", isSearchable = false }) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const ref = useRef(null)
  
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => {
    if (!open) {
      setSearchQuery('')
    }
  }, [open])

  const selected = options.find(o => String(o.value) === String(value))

  const filteredOptions = options.filter(o => 
    String(o.label).toLowerCase().includes(searchQuery.toLowerCase()) ||
    String(o.value).toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div ref={ref} className="relative w-full text-[13px]" style={{ zIndex: open ? 50 : 10 }}>
      <button type="button" onMouseDown={() => setOpen(o => !o)}
              className="w-full flex items-center justify-between rounded-[8px] px-3 py-2 cursor-pointer outline-none text-left"
              style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)', color: selected ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.2)' }}>
        <span className="truncate flex-1">{selected ? selected.label : placeholder}</span>
        <ChevronDown size={14} className="text-[rgba(255,255,255,0.3)] ml-2 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-[8px] shadow-2xl flex flex-col animate-menu-pop max-h-60"
             style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.15)', overflow: 'hidden' }}>
          {isSearchable && (
            <div className="p-2 border-b border-[rgba(255,255,255,0.08)] bg-[#111]">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search..."
                onMouseDown={e => e.stopPropagation()}
                className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-[6px] px-2 py-1 text-[12px] text-white outline-none placeholder-[rgba(255,255,255,0.3)]"
              />
            </div>
          )}
          <div className="overflow-y-auto flex-1" style={{ maxHeight: '180px' }}>
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2.5 text-[11px] text-[rgba(255,255,255,0.3)] text-center">No results found</div>
            ) : (
              filteredOptions.map((o, i) => (
                <button key={i} type="button" onMouseDown={() => { onChange(o.value); setOpen(false) }}
                        className="w-full text-left px-3 py-2.5 cursor-pointer hover:bg-[rgba(255,255,255,0.05)] flex items-center"
                        style={{ color: String(value) === String(o.value) ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.75)' }}>
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

import React, { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { useT } from '../../i18n'

// Toolbar filter chip with a single-choice menu, styled like the Types
// filter on Galleries, Photos and Videos. The first option (value '') means
// "no filter"; picking anything else highlights the chip and shows an X.
//
// options: [{ value, label, dot?, icon?, count?, raw? }]  (raw: don't translate)
export default function ChipDropdown({ value, onChange, options, searchable = false }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef(null)
  const selected = options.find(o => o.value === value) || options[0]
  const active = !!value
  const label = (o) => (o.raw ? o.label : t(o.label))

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  useEffect(() => { if (!open) setQuery('') }, [open])

  const shown = query ? options.filter(o => !o.value || o.label.toLowerCase().includes(query.toLowerCase())) : options
  return (
    <div ref={ref} className="relative vault-row-control">
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); setOpen(o => !o) }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] cursor-pointer"
        style={{
          background: active ? 'color-mix(in srgb, var(--c-accent) 20%, transparent)' : 'rgba(255,255,255,0.05)',
          color: active ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.45)',
          border: `0.5px solid ${active ? 'color-mix(in srgb, var(--c-accent) 40%, transparent)' : 'rgba(255,255,255,0.08)'}`,
        }}>
        {active && selected.dot && <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: selected.dot }} />}
        {active && selected.icon}
        {label(selected)}
        {active
          ? <X size={11} onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onChange('') }} className="cursor-pointer" />
          : <ChevronDown size={11} />}
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 rounded-[10px] shadow-2xl animate-menu-pop overflow-hidden flex flex-col"
             onWheel={e => e.stopPropagation()}
             style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.15)', minWidth: 180, maxHeight: 'min(360px, calc(100dvh - 120px))' }}>
          {searchable && (
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Search...')}
                   onMouseDown={e => e.stopPropagation()}
                   className="m-2 px-2.5 py-1.5 rounded-[6px] text-[13px] outline-none"
                   style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)', border: '0.5px solid rgba(255,255,255,0.1)' }} />
          )}
          <div className="overflow-y-auto" style={{ overscrollBehavior: 'contain', scrollbarWidth: 'thin' }}>
            {shown.map(opt => (
              <button
                key={opt.value || '_all'}
                type="button"
                onMouseDown={() => { onChange(opt.value); setOpen(false) }}
                className="w-full text-left px-3 py-2 text-[13px] cursor-pointer flex items-center gap-2 hover:bg-[rgba(255,255,255,0.05)]"
                style={{
                  background: value === opt.value ? 'color-mix(in srgb, var(--c-accent) 15%, transparent)' : 'transparent',
                  color: value === opt.value ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.7)',
                }}>
                {opt.dot !== undefined
                  ? <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: opt.value ? opt.dot : 'transparent' }} />
                  : null}
                {opt.icon}
                <span className="flex-1 truncate">{label(opt)}</span>
                {opt.count != null && <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{opt.count}</span>}
                {value === opt.value && <Check size={11} style={{ color: 'var(--c-accent)' }} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

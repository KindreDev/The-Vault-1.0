import React, { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, X, Check } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { creatorsApi } from '../lib/api'
import { useT } from '../i18n'

/**
 * Franchise filter — pill button, click to open, search input inside dropdown.
 * Matches the exact UX of CreatorDropdown in GalleryList.
 */
export default function FranchiseFilter({ value, onChange }) {
  const t                   = useT()
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const ref                 = useRef(null)

  const { data: franchises = [] } = useQuery({
    queryKey: ['franchises'],
    queryFn: () => creatorsApi.franchises().then(r => r.data),
    staleTime: 1000 * 60 * 10,
  })

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const filtered = useMemo(() =>
    franchises.filter(f => f.toLowerCase().includes(search.toLowerCase())),
    [franchises, search]
  )

  const clear = (e) => { e?.stopPropagation(); onChange(null); setSearch('') }

  if (!franchises.length) return null

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
        {value || t('Franchise')}
        {value
          ? <X size={11} onMouseDown={clear} className="cursor-pointer" />
          : <ChevronDown size={11} />}
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 rounded-[10px] overflow-hidden shadow-2xl animate-menu-pop"
             style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.15)', minWidth: 220, maxHeight: 300 }}>
          <div className="p-2 border-b border-[rgba(255,255,255,0.07)]">
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('Search franchise...')}
              className="w-full bg-transparent text-[13px] text-[rgba(255,255,255,0.8)] placeholder-[rgba(255,255,255,0.25)] outline-none"
            />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
            {value && (
              <button
                type="button"
                onMouseDown={clear}
                className="w-full text-left px-3 py-2 text-[13px] text-[rgba(255,255,255,0.4)] hover:bg-[rgba(255,255,255,0.05)] cursor-pointer">
                {t('Clear selection')}
              </button>
            )}
            {filtered.map(f => (
              <button
                key={f}
                type="button"
                onMouseDown={() => { onChange(f); setOpen(false); setSearch('') }}
                className="w-full text-left px-3 py-2 text-[13px] cursor-pointer flex items-center gap-2 hover:bg-[rgba(255,255,255,0.05)]"
                style={{
                  background: value === f ? 'color-mix(in srgb, var(--c-accent) 15%, transparent)' : 'transparent',
                  color: value === f ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.7)',
                }}>
                {value === f && <Check size={12} style={{ color: 'var(--c-accent)', flexShrink: 0 }} />}
                {f}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-[13px] text-[rgba(255,255,255,0.25)] text-center">
                {t('No franchises found')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

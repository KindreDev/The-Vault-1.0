import React, { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Tag as TagIcon, X } from 'lucide-react'
import { tagsApi } from '../lib/api'

const CAT_COLORS = {
  sex_act: '#D4537E', body_part: '#E07B54', physical_feature: '#378ADD',
  nudity_level: '#BA7517', position: '#9B59B6', clothing: '#1D9E75',
  pose: '#6B7280', rating: '#9CA3AF', subject: '#9CA3AF',
  character: '#7F77DD', style: '#4B9E6E', general: '#555',
}

/**
 * Shared tag filter input with autocomplete dropdown.
 * Props:
 *   activeTags  string[]         currently active tag filters
 *   onAdd       (name) => void   called when a tag is selected
 *   onRemove    (name) => void   called when a tag pill X is clicked
 *   placeholder string           hint text when empty
 *   rounded     'full' | 'lg'    pill style for the input wrapper (default 'full')
 */
export default function TagFilterInput({
  activeTags,
  onAdd,
  onRemove,
  placeholder = 'Filter by tag…',
  rounded = 'full',
}) {
  const [input, setInput]     = useState('')
  const [open, setOpen]       = useState(false)
  const [cursor, setCursor]   = useState(0)
  const inputRef              = useRef(null)
  const dropRef               = useRef(null)

  const { data: allTags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: () => tagsApi.list().then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })

  const q = input.trim().toLowerCase()
  const suggestions = q.length >= 1
    ? allTags
        .filter(t => !activeTags.includes(t.name) && t.name.includes(q))
        .sort((a, b) => b.use_count - a.use_count)
        .slice(0, 10)
    : []

  useEffect(() => { setCursor(0) }, [q])

  const select = (tag) => {
    onAdd(tag.name)
    setInput('')
    setOpen(false)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e) => {
    if (suggestions.length === 0) {
      if (e.key === 'Enter' && input.trim()) {
        onAdd(input.trim().toLowerCase())
        setInput('')
      }
      if (e.key === 'Escape') { setInput(''); setOpen(false) }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, suggestions.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    if (e.key === 'Enter')     { e.preventDefault(); select(suggestions[cursor]) }
    if (e.key === 'Escape')    { setInput(''); setOpen(false) }
  }

  useEffect(() => {
    const handler = (e) => {
      if (!dropRef.current?.contains(e.target) && !inputRef.current?.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const wrapClass = rounded === 'full'
    ? 'flex items-center gap-1 px-2.5 py-1.5 rounded-full'
    : 'flex items-center gap-1 px-2.5 py-1.5 rounded-[8px]'

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {activeTags.map(t => (
        <span key={t}
          className="flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[13px]"
          style={{ background: 'rgba(127,119,221,0.18)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.35)' }}>
          {t}
          <button type="button" onMouseDown={() => onRemove(t)}
            className="cursor-pointer text-[rgba(255,255,255,0.4)] hover:text-white ml-0.5">
            <X size={9} />
          </button>
        </span>
      ))}

      <div className="relative">
        <div className={wrapClass}
          style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
          <TagIcon size={11} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={input}
            onChange={e => { setInput(e.target.value); setOpen(true) }}
            onFocus={() => { if (input.trim()) setOpen(true) }}
            onKeyDown={handleKeyDown}
            placeholder={activeTags.length > 0 ? 'Add tag…' : placeholder}
            className="bg-transparent border-none outline-none text-[13px] placeholder-[rgba(255,255,255,0.25)] w-28"
            style={{ color: 'rgba(255,255,255,0.7)' }}
          />
          {input && (
            <button type="button" onMouseDown={() => { setInput(''); setOpen(false) }}
              className="cursor-pointer text-[rgba(255,255,255,0.3)] hover:text-white flex-shrink-0">
              <X size={11} />
            </button>
          )}
        </div>

        {open && suggestions.length > 0 && (
          <div ref={dropRef}
            className="absolute top-full left-0 mt-1 z-50 rounded-xl overflow-hidden shadow-2xl"
            style={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.1)', minWidth: 200, maxWidth: 280 }}>
            {suggestions.map((tag, i) => (
              <button key={tag.id}
                onMouseDown={() => select(tag)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
                style={{
                  background: i === cursor ? 'rgba(255,255,255,0.07)' : 'transparent',
                  color: i === cursor ? '#fff' : 'rgba(255,255,255,0.75)',
                }}>
                <span className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: CAT_COLORS[tag.category] ?? '#888' }} />
                <span className="text-[14px] flex-1 truncate">{tag.name}</span>
                <span className="text-[12px] text-[rgba(255,255,255,0.3)] ml-auto flex-shrink-0">{tag.use_count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

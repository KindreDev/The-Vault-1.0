import React, { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Tag as TagIcon, Plus, X } from 'lucide-react'
import { tagsApi } from '../lib/api'

const CAT_COLORS = {
  sex_act: '#D4537E', body_part: '#E07B54', physical_feature: '#378ADD',
  nudity_level: '#BA7517', position: '#9B59B6', clothing: '#1D9E75',
  pose: '#6B7280', rating: '#9CA3AF', subject: '#9CA3AF',
  character: '#7F77DD', style: '#4B9E6E', general: '#555',
}

/**
 * Tag ADDER input with autocomplete — the counterpart to TagFilterInput.
 *
 * The backend silently creates a brand-new tag whenever the typed name doesn't
 * exactly match an existing one, so a typo quietly forks the taxonomy. This
 * surfaces existing tags as you type and marks the create-new case explicitly,
 * so reusing a tag is the path of least resistance.
 *
 * Props:
 *   onAdd       (name) => void   called with a lowercased tag name
 *   exclude     string[]         tag names already applied (hidden from suggestions)
 *   placeholder string
 *   size        'sm' | 'md'      'sm' fits the viewer sidebar, 'md' the bulk panels
 *   autoFocus   boolean
 */
export default function TagAutocompleteInput({
  onAdd,
  exclude = [],
  placeholder = 'Add tag…',
  size = 'md',
  autoFocus = false,
}) {
  const [input, setInput]   = useState('')
  const [open, setOpen]     = useState(false)
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef(null)
  const dropRef  = useRef(null)

  const { data: allTags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: () => tagsApi.list().then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })

  const q = input.trim().toLowerCase()
  const excludeSet = new Set(exclude.map(t => String(t).toLowerCase()))

  const suggestions = q.length >= 1
    ? allTags
        .filter(t => !excludeSet.has(t.name) && t.name.includes(q))
        .sort((a, b) => {
          // Prefix matches first, then by popularity — typing "blo" should surface
          // "blonde" above "hair_blonde" even if the latter is used more.
          const ap = a.name.startsWith(q) ? 0 : 1
          const bp = b.name.startsWith(q) ? 0 : 1
          if (ap !== bp) return ap - bp
          return b.use_count - a.use_count
        })
        .slice(0, 8)
    : []

  // Only offer "create" when the typed name isn't already an exact existing tag
  const isExact    = q.length >= 1 && allTags.some(t => t.name === q)
  const canCreate  = q.length >= 1 && !isExact && !excludeSet.has(q)
  const rows       = canCreate ? [...suggestions, { __create: true, name: q }] : suggestions

  useEffect(() => { setCursor(0) }, [q])

  const commit = (name) => {
    const clean = String(name).trim().toLowerCase()
    if (!clean) return
    onAdd(clean)
    setInput('')
    setOpen(false)
    inputRef.current?.focus()
  }

  const handleChange = (e) => {
    const v = e.target.value
    // Typing a comma commits the tag — supports the "tag1, tag2, tag3" flow
    if (v.includes(',')) {
      const parts = v.split(',')
      const tail  = parts.pop()
      parts.forEach(p => { const c = p.trim().toLowerCase(); if (c) onAdd(c) })
      setInput(tail)
      setOpen(!!tail.trim())
      return
    }
    setInput(v)
    setOpen(true)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { setInput(''); setOpen(false); return }
    if (rows.length === 0) {
      if (e.key === 'Enter' && q) commit(q)
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, rows.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    if (e.key === 'Enter')     { e.preventDefault(); commit(rows[cursor]?.name ?? q) }
    if (e.key === 'Tab' && rows[cursor] && !rows[cursor].__create) {
      // Tab completes to the highlighted existing tag without committing it
      e.preventDefault()
      setInput(rows[cursor].name)
    }
  }

  useEffect(() => {
    const handler = (e) => {
      if (!dropRef.current?.contains(e.target) && !inputRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const sm = size === 'sm'

  return (
    <div className="relative w-full">
      <div className="flex items-center gap-1 w-full"
           style={{
             background: 'rgba(255,255,255,0.05)',
             border: '0.5px solid rgba(255,255,255,0.08)',
             borderRadius: 8,
             padding: sm ? '3px 6px' : '5px 8px',
           }}>
        <TagIcon size={sm ? 10 : 12} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
        <input
          ref={inputRef}
          value={input}
          autoFocus={autoFocus}
          onChange={handleChange}
          onFocus={() => { if (q) setOpen(true) }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="bg-transparent border-none outline-none flex-1 min-w-0 placeholder-[rgba(255,255,255,0.25)]"
          style={{ color: 'rgba(255,255,255,0.8)', fontSize: sm ? 11 : 13 }}
        />
        {input && (
          <button type="button" onMouseDown={() => { setInput(''); setOpen(false) }}
                  className="cursor-pointer text-[rgba(255,255,255,0.3)] hover:text-white flex-shrink-0">
            <X size={sm ? 10 : 12} />
          </button>
        )}
        <button type="button" onMouseDown={() => commit(q)} disabled={!q}
                className="cursor-pointer flex-shrink-0 disabled:opacity-25"
                style={{ color: 'var(--c-accent-text)' }} title="Add tag">
          <Plus size={sm ? 11 : 13} />
        </button>
      </div>

      {open && rows.length > 0 && (
        <div ref={dropRef}
             className="absolute top-full left-0 right-0 mt-1 z-[100] rounded-xl overflow-hidden shadow-2xl"
             style={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.1)', minWidth: 200 }}>
          {rows.map((tag, i) => (
            <button key={tag.__create ? '__create' : tag.id}
                    onMouseDown={() => commit(tag.name)}
                    onMouseEnter={() => setCursor(i)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
                    style={{
                      background: i === cursor ? 'rgba(255,255,255,0.07)' : 'transparent',
                      color: i === cursor ? '#fff' : 'rgba(255,255,255,0.75)',
                    }}>
              {tag.__create ? (
                <>
                  <Plus size={12} style={{ color: 'var(--c-green)', flexShrink: 0 }} />
                  <span style={{ fontSize: 16 }} className="flex-1 truncate">
                    Create <strong>{tag.name}</strong>
                  </span>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }} className="flex-shrink-0">new</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: CAT_COLORS[tag.category] ?? '#888' }} />
                  <span style={{ fontSize: 16 }} className="flex-1 truncate">{tag.name}</span>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }} className="flex-shrink-0">
                    {tag.use_count}
                  </span>
                </>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

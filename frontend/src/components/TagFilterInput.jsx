import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Ban, Check, ChevronDown, Tag as TagIcon, X } from 'lucide-react'
import { tagsApi } from '../lib/api'

const CATEGORY_COLORS = {
  sex_act: '#D4537E', body_part: '#E07B54', physical_feature: '#378ADD',
  nudity_level: '#BA7517', position: '#9B59B6', clothing: '#1D9E75',
  pose: '#6B7280', rating: '#9CA3AF', subject: '#9CA3AF',
  character: '#7F77DD', style: '#4B9E6E', general: '#777',
}

// Fixed semantic colors: intentionally independent from the active Vault theme.
const INCLUDE = { strong: '#378ADD', text: '#B9DCFF', bg: 'rgba(55,138,221,0.18)', border: 'rgba(55,138,221,0.55)' }
const EXCLUDE = { strong: '#D4537E', text: '#FFC2D5', bg: 'rgba(212,83,126,0.18)', border: 'rgba(212,83,126,0.60)' }

const tokenFor = tag => `id:${tag.id}`

function TagGroup({ kind, tokens, mode, onModeChange, onAdd, onRemove, onClear, allTags, rounded }) {
  const semantic = kind === 'include' ? INCLUDE : EXCLUDE
  const isInclude = kind === 'include'
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [category, setCategory] = useState('')
  const inputRef = useRef(null)
  const rootRef = useRef(null)

  const byId = useMemo(() => new Map(allTags.map(t => [String(t.id), t])), [allTags])
  const selectedNames = useMemo(() => new Set(tokens.map(token => {
    if (token.startsWith('id:')) return byId.get(token.slice(3))?.name
    return token.startsWith('name:') ? token.slice(5) : token
  }).filter(Boolean)), [tokens, byId])
  const categories = useMemo(() => [...new Set(allTags.map(t => t.category || 'general'))].sort(), [allTags])

  const q = input.trim().toLowerCase()
  const suggestions = q
    ? allTags.filter(t => !selectedNames.has(t.name) && t.name.includes(q) && (!category || (t.category || 'general') === category))
        .sort((a, b) => b.use_count - a.use_count).slice(0, 12)
    : []

  useEffect(() => setCursor(0), [q, category])
  useEffect(() => {
    const close = e => { if (!rootRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close, true)
    return () => document.removeEventListener('mousedown', close, true)
  }, [])

  const choose = tag => {
    onAdd(tokenFor(tag))
    setInput('')
    setOpen(false)
    inputRef.current?.focus()
  }

  const keyDown = e => {
    if (e.key === 'ArrowDown' && suggestions.length) { e.preventDefault(); setCursor(v => Math.min(v + 1, suggestions.length - 1)) }
    if (e.key === 'ArrowUp' && suggestions.length) { e.preventDefault(); setCursor(v => Math.max(v - 1, 0)) }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (suggestions[cursor]) choose(suggestions[cursor])
    }
    if (e.key === 'Escape') { setInput(''); setOpen(false) }
  }

  const labelFor = token => {
    if (token.startsWith('id:')) return byId.get(token.slice(3))?.name || `tag #${token.slice(3)}`
    return token.startsWith('name:') ? token.slice(5) : token
  }

  return (
    <div ref={rootRef} className="flex items-center gap-2 flex-wrap min-w-0">
      <div className="flex items-center gap-1.5 font-medium" style={{ color: semantic.text, fontSize: 16 }}>
        {isInclude ? <Check size={17} /> : <Ban size={17} />}
        {isInclude ? 'Include' : 'Exclude'}
      </div>

      <div className="flex rounded-full overflow-hidden" style={{ border: `1px solid ${semantic.border}` }}>
        {['all', 'any'].map(value => (
          <button key={value} type="button" onMouseDown={() => onModeChange(value)}
            className="px-2.5 py-1 cursor-pointer"
            style={{
              fontSize: 16,
              background: mode === value ? semantic.strong : 'rgba(0,0,0,0.2)',
              color: mode === value ? '#fff' : semantic.text,
            }}>
            {value === 'all' ? (isInclude ? 'All' : 'All together') : 'Any'}
          </button>
        ))}
      </div>

      {tokens.map(token => (
        <span key={token} className="flex items-center gap-1 px-2.5 py-1 rounded-full"
          style={{ fontSize: 16, background: semantic.bg, color: semantic.text, border: `1px solid ${semantic.border}` }}>
          {labelFor(token)}
          <button type="button" onMouseDown={() => onRemove(token)} className="cursor-pointer" style={{ color: semantic.text }}>
            <X size={15} />
          </button>
        </span>
      ))}

      <div className="relative">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 flex-wrap"
          style={{ borderRadius: rounded === 'full' ? 999 : 8, background: 'rgba(255,255,255,0.05)', border: `1px solid ${semantic.border}` }}>
          <TagIcon size={16} style={{ color: semantic.text }} />
          <select value={category} onChange={e => { setCategory(e.target.value); setOpen(true) }}
            className="bg-transparent outline-none cursor-pointer"
            style={{ color: semantic.text, fontSize: 16 }} title="Limit suggestions to a tag category">
            <option value="" style={{ background: '#1e1e1e' }}>All categories</option>
            {categories.map(cat => <option key={cat} value={cat} style={{ background: '#1e1e1e' }}>{cat}</option>)}
          </select>
          <input ref={inputRef} value={input}
            onChange={e => { setInput(e.target.value); setOpen(true) }}
            onFocus={() => { if (input.trim()) setOpen(true) }}
            onKeyDown={keyDown}
            placeholder={tokens.length ? 'Add another…' : (isInclude ? 'Must have tag…' : 'Must not have tag…')}
            className="bg-transparent border-none outline-none w-40"
            style={{ color: 'rgba(255,255,255,0.85)', fontSize: 16 }} />
        </div>

        {open && q && (
          <div className="absolute top-full left-0 mt-1 z-50 rounded-xl overflow-hidden shadow-2xl"
            style={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.14)', minWidth: 300, maxWidth: 380 }}>
            {suggestions.length ? suggestions.map((tag, i) => (
              <button key={tag.id} type="button" onMouseDown={() => choose(tag)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
                style={{ background: i === cursor ? semantic.bg : 'transparent', color: 'rgba(255,255,255,0.85)' }}>
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: CATEGORY_COLORS[tag.category] || '#888' }} />
                <span className="flex-1 truncate" style={{ fontSize: 16 }}>{tag.name}</span>
                <span className="capitalize truncate" style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)', maxWidth: 110 }}>{tag.category || 'general'}</span>
                <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>{tag.use_count}</span>
              </button>
            )) : (
              <div className="px-3 py-3" style={{ color: 'rgba(255,255,255,0.45)', fontSize: 16 }}>
                No matching tag
              </div>
            )}
          </div>
        )}
      </div>

      {!!tokens.length && (
        <button type="button" onMouseDown={onClear} className="cursor-pointer px-2 py-1"
          style={{ color: semantic.text, fontSize: 16 }}>Clear</button>
      )}
    </div>
  )
}

export default function TagFilterInput({
  includeTags = [], includeMode = 'all', onIncludeModeChange, onAddInclude, onRemoveInclude,
  onClearInclude,
  excludeTags = [], excludeMode = 'any', onExcludeModeChange, onAddExclude, onRemoveExclude,
  onClearExclude,
  rounded = 'full',
}) {
  const [panelOpen, setPanelOpen] = useState(false)
  const panelRef = useRef(null)
  const { data: allTags = [] } = useQuery({
    queryKey: ['tags'], queryFn: () => tagsApi.list().then(r => r.data), staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    const close = e => { if (!panelRef.current?.contains(e.target)) setPanelOpen(false) }
    const escape = e => { if (e.key === 'Escape') setPanelOpen(false) }
    // Capture before a tag selection updates the URL and redraws the menu. In
    // bubble phase the clicked option may already be detached, making a real
    // inside click look like an outside click and closing the whole popover.
    document.addEventListener('mousedown', close, true)
    window.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close, true)
      window.removeEventListener('keydown', escape)
    }
  }, [])

  const active = includeTags.length + excludeTags.length > 0

  return (
    <div ref={panelRef} className="relative flex-shrink-0">
      <button type="button" onMouseDown={() => setPanelOpen(v => !v)}
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer"
        style={{
          borderRadius: rounded === 'full' ? 999 : 8,
          fontSize: 16,
          background: active ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.05)',
          color: active ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.5)',
          border: `1px solid ${active ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.1)'}`,
        }}>
        <TagIcon size={16} />
        Tags
        {!!includeTags.length && (
          <span className="px-1.5 rounded-full" style={{ background: INCLUDE.bg, color: INCLUDE.text, fontSize: 16 }}>+{includeTags.length}</span>
        )}
        {!!excludeTags.length && (
          <span className="px-1.5 rounded-full" style={{ background: EXCLUDE.bg, color: EXCLUDE.text, fontSize: 16 }}>−{excludeTags.length}</span>
        )}
        <ChevronDown size={16} style={{ transform: panelOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {panelOpen && (
        <div className="absolute top-full right-0 mt-2 z-[80] flex flex-col gap-3 rounded-xl p-4 shadow-2xl"
          style={{
            width: 'min(720px, calc(100vw - 48px))',
            background: '#151515',
            border: '1px solid rgba(255,255,255,0.14)',
            boxShadow: '0 18px 50px rgba(0,0,0,0.65)',
          }}>
          <div className="flex items-center justify-between">
            <div style={{ color: 'rgba(255,255,255,0.82)', fontSize: 16, fontWeight: 600 }}>Tag filters</div>
            <button type="button" onMouseDown={() => setPanelOpen(false)} className="cursor-pointer p-1"
              style={{ color: 'rgba(255,255,255,0.45)' }}><X size={17} /></button>
          </div>
          <TagGroup kind="include" tokens={includeTags} mode={includeMode} onModeChange={onIncludeModeChange}
            onAdd={onAddInclude} onRemove={onRemoveInclude} onClear={onClearInclude} allTags={allTags} rounded={rounded} />
          <div style={{ height: 1, background: 'rgba(255,255,255,0.07)' }} />
          <TagGroup kind="exclude" tokens={excludeTags} mode={excludeMode} onModeChange={onExcludeModeChange}
            onAdd={onAddExclude} onRemove={onRemoveExclude} onClear={onClearExclude} allTags={allTags} rounded={rounded} />
        </div>
      )}
    </div>
  )
}

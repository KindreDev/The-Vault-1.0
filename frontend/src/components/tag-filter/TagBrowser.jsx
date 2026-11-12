import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Minus, Plus, Search, X } from 'lucide-react'
import { useT } from '../../i18n'
import { CATEGORIES, CATEGORY_BY_KEY, categoryColor, INCLUDE, EXCLUDE } from './tagFilterMeta'

const MAX_ROWS = 60
// Tags that are useful to filter by but would crowd every list: baseline
// (on most files), people count, framing and medium. They get their own pill.
const COMMON_ROLES = new Set(['baseline', 'people', 'framing', 'medium'])
const COMMON = '__common'

function Pill({ active, color, onClick, children }) {
  return (
    <button type="button" onMouseDown={e => { e.preventDefault(); onClick() }}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[16px] cursor-pointer flex-shrink-0"
            style={{
              background: active ? 'color-mix(in srgb, var(--c-accent) 20%, transparent)' : 'rgba(255,255,255,0.04)',
              color: active ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.6)',
              border: `0.5px solid ${active ? 'color-mix(in srgb, var(--c-accent) 40%, transparent)' : 'rgba(255,255,255,0.08)'}`,
            }}>
      {color && <span className="w-2 h-2 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  )
}

function RowButton({ title, onClick, active, colors, children }) {
  return (
    <button type="button" title={title} aria-label={title}
            onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onClick() }}
            className="w-8 h-8 flex items-center justify-center rounded-full cursor-pointer flex-shrink-0 transition-colors"
            style={{
              background: active ? colors.bg : 'transparent',
              color: active ? colors.text : 'rgba(255,255,255,0.45)',
              border: `0.5px solid ${active ? colors.line : 'rgba(255,255,255,0.1)'}`,
            }}>
      {children}
    </button>
  )
}

// Search or browse every tag, by category. Empty search lists the most used
// tags of the chosen category, so tags can be found without knowing names.
export default function TagBrowser({ allTags, stateOf, onInclude, onExclude, onClear }) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const categories = useMemo(() => {
    // People count and medium live under Common, Spice in its own row.
    const present = new Set(allTags.filter(tag => !['rating', 'subject', 'style'].includes(tag.category)).map(tag => tag.category || 'general'))
    const known = CATEGORIES.filter(c => present.has(c.key))
    const extra = [...present].filter(k => !CATEGORY_BY_KEY[k]).sort().map(k => ({ key: k, label: k, color: categoryColor(k), raw: true }))
    return [...known, ...extra]
  }, [allTags])

  const q = query.trim().toLowerCase()
  const rows = useMemo(() => {
    const isCommon = tag => COMMON_ROLES.has(tag.role)
    const matches = allTags.filter(tag =>
      tag.category !== 'rating' && tag.role !== 'spice'
      && (category === COMMON ? isCommon(tag) : !category || (tag.category || 'general') === category)
      && (!q || tag.name.includes(q)))
    // Names that start with the query rank first, then interesting tags above
    // common ones, then by how often used.
    matches.sort((a, b) => (q ? (b.name.startsWith(q) - a.name.startsWith(q)) : 0)
      || (category === COMMON ? 0 : isCommon(a) - isCommon(b))
      || b.use_count - a.use_count)
    return matches.slice(0, MAX_ROWS)
  }, [allTags, category, q])

  useEffect(() => { setCursor(0); listRef.current?.scrollTo({ top: 0 }) }, [q, category])
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const toggleInclude = tag => (stateOf(tag) === 'include' ? onClear(tag) : onInclude(tag))
  const toggleExclude = tag => (stateOf(tag) === 'exclude' ? onClear(tag) : onExclude(tag))

  const keyDown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(v => Math.min(v + 1, rows.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(v => Math.max(v - 1, 0)) }
    else if (e.key === 'Enter' && rows[cursor]) {
      e.preventDefault()
      e.shiftKey ? toggleExclude(rows[cursor]) : toggleInclude(rows[cursor])
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 px-3 py-2 rounded-[10px]"
           style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.12)' }}>
        <Search size={16} className="text-white/40 flex-shrink-0" />
        <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={keyDown}
               placeholder={t('Search tags…  (Enter to require, Shift+Enter to hide)')}
               className="flex-1 bg-transparent outline-none text-[16px] min-w-0"
               style={{ color: 'rgba(255,255,255,0.88)' }} />
        {query && (
          <button type="button" onMouseDown={e => { e.preventDefault(); setQuery('') }} className="cursor-pointer text-white/40" aria-label={t('Clear')}>
            <X size={16} />
          </button>
        )}
      </div>

      <div className="flex gap-1.5 flex-wrap">
        <Pill active={!category} onClick={() => setCategory('')}>{t('All')}</Pill>
        {categories.map(c => (
          <Pill key={c.key} active={category === c.key} color={c.color} onClick={() => setCategory(category === c.key ? '' : c.key)}>
            {c.raw ? c.label : t(c.label)}
          </Pill>
        ))}
        {allTags.some(tag => COMMON_ROLES.has(tag.role)) && (
          <Pill active={category === COMMON} color="rgba(255,255,255,0.35)" onClick={() => setCategory(category === COMMON ? '' : COMMON)}>
            {t('Common')}
          </Pill>
        )}
      </div>

      <div ref={listRef} className="overflow-y-auto rounded-[10px]" onWheel={e => e.stopPropagation()}
           style={{ maxHeight: 'min(320px, calc(100dvh - 380px))', minHeight: 120, border: '0.5px solid rgba(255,255,255,0.08)', overscrollBehavior: 'contain', scrollbarWidth: 'thin' }}>
        {rows.length ? rows.map((tag, i) => {
          const state = stateOf(tag)
          return (
            <div key={tag.id} data-row={i}
                 onMouseDown={e => { e.preventDefault(); toggleInclude(tag) }}
                 onMouseEnter={() => setCursor(i)}
                 className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer"
                 style={{
                   background: i === cursor ? 'rgba(255,255,255,0.06)' : 'transparent',
                   borderBottom: '0.5px solid rgba(255,255,255,0.04)',
                 }}>
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: categoryColor(tag.category || 'general') }} />
              <span className="flex-1 truncate text-[16px]"
                    style={{ color: state === 'include' ? INCLUDE.text : state === 'exclude' ? EXCLUDE.text : 'rgba(255,255,255,0.85)',
                             textDecoration: state === 'exclude' ? 'line-through' : 'none' }}>
                {tag.name}
              </span>
              {!category && (
                <span className="text-[16px] text-white/35 truncate hidden sm:block" style={{ maxWidth: 120 }}>
                  {CATEGORY_BY_KEY[tag.category] ? t(CATEGORY_BY_KEY[tag.category].label) : (tag.category || t('Other'))}
                </span>
              )}
              <span className="text-[16px] text-white/35 tabular-nums w-16 text-right">{(tag.use_count || 0).toLocaleString()}</span>
              <RowButton title={t('Require this tag')} active={state === 'include'} colors={INCLUDE} onClick={() => toggleInclude(tag)}>
                {state === 'include' ? <Check size={15} /> : <Plus size={15} />}
              </RowButton>
              <RowButton title={t('Hide files with this tag')} active={state === 'exclude'} colors={EXCLUDE} onClick={() => toggleExclude(tag)}>
                <Minus size={15} />
              </RowButton>
            </div>
          )
        }) : (
          <div className="px-3 py-6 text-center text-[16px] text-white/40">{t('No matching tag')}</div>
        )}
      </div>
    </div>
  )
}

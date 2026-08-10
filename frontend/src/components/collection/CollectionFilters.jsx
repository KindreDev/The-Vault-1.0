/**
 * Filter bar for the card collection.
 *
 * Lives outside Collection.jsx because that page is already far past the size
 * limit in CLAUDE.md, and because the filter bar is a self-contained thing:
 * everything here is derived from props and reported back through callbacks.
 *
 * Tier and class are rendered as chips rather than dropdowns. Both are tiny
 * fixed sets, and a dropdown costs two clicks per change and hides the current
 * state until you open it — which is most of what made the collection annoying
 * to move around in. Type and sort stay as dropdowns: too many options to spend
 * a row on, and they are changed far less often.
 */
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { ChevronDown, Check, Search, X, Filter } from 'lucide-react'

// ── Shared dropdown (moved here from Collection.jsx) ─────────────────────────
export function VaultDropdown({ value, onChange, options, colorMap }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const getOpt   = v => options.find(o => (o.value ?? o) === v) ?? options[0]
  const getLabel = v => { const o = getOpt(v); return o?.label ?? o }
  const isDefault = value === (options[0]?.value ?? options[0])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); setOpen(o => !o) }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] cursor-pointer"
        style={{
          background: !isDefault ? 'color-mix(in srgb, var(--c-accent) 20%, transparent)' : 'rgba(255,255,255,0.05)',
          color: !isDefault ? 'color-mix(in srgb, var(--c-accent) 78%, white)' : 'rgba(255,255,255,0.45)',
          border: `0.5px solid ${!isDefault ? 'color-mix(in srgb, var(--c-accent) 40%, transparent)' : 'rgba(255,255,255,0.08)'}`,
          transition: 'all 0.15s ease',
        }}>
        {!isDefault && colorMap?.[value] && (
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: colorMap[value] }} />
        )}
        {getLabel(value)}
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 rounded-[10px] shadow-2xl animate-menu-pop overflow-hidden"
             style={{ background: 'var(--c-card)', border: '0.5px solid rgba(255,255,255,0.15)', minWidth: 140 }}>
          {options.map(opt => {
            const v = opt.value ?? opt
            const l = opt.label ?? opt
            const active = v === value
            return (
              <button key={String(v)} type="button"
                      onMouseDown={() => { onChange(v); setOpen(false) }}
                      className="w-full text-left px-3 py-2 text-[12px] cursor-pointer flex items-center gap-2 hover:bg-[rgba(255,255,255,0.05)]"
                      style={{
                        background: active ? 'color-mix(in srgb, var(--c-accent) 15%, transparent)' : 'transparent',
                        color: active ? 'color-mix(in srgb, var(--c-accent) 80%, white)' : 'rgba(255,255,255,0.7)',
                      }}>
                {colorMap?.[v]
                  ? <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: colorMap[v] }} />
                  : <span className="w-1.5 h-1.5 flex-shrink-0" />}
                {l}
                {active && <Check size={10} className="ml-auto" style={{ color: 'var(--c-accent)' }} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── One filter chip ──────────────────────────────────────────────────────────
function Chip({ label, active, dot, onClick, title }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={e => { e.preventDefault(); onClick() }}
      className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[13px] cursor-pointer whitespace-nowrap"
      style={{
        background: active ? 'color-mix(in srgb, var(--c-accent) 22%, transparent)' : 'rgba(255,255,255,0.04)',
        color: active ? 'color-mix(in srgb, var(--c-accent) 80%, white)' : 'rgba(255,255,255,0.45)',
        border: `0.5px solid ${active ? 'color-mix(in srgb, var(--c-accent) 45%, transparent)' : 'rgba(255,255,255,0.07)'}`,
        transition: 'background 0.15s, color 0.15s, border-color 0.15s',
      }}>
      {dot && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: dot }} />}
      {label}
    </button>
  )
}

// ── Creator picker — searchable, because a collection spans a lot of names ───
function CreatorPicker({ value, creators, onChange }) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setSearch('') } }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const selected = creators.find(c => String(c.id) === String(value))
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? creators.filter(c => c.name.toLowerCase().includes(q)) : creators
  }, [creators, search])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); setOpen(o => !o); setSearch('') }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] cursor-pointer"
        style={{
          background: selected ? 'color-mix(in srgb, var(--c-accent) 20%, transparent)' : 'rgba(255,255,255,0.05)',
          color: selected ? 'color-mix(in srgb, var(--c-accent) 78%, white)' : 'rgba(255,255,255,0.45)',
          border: `0.5px solid ${selected ? 'color-mix(in srgb, var(--c-accent) 40%, transparent)' : 'rgba(255,255,255,0.08)'}`,
          maxWidth: 200,
        }}>
        <span className="truncate">{selected ? selected.name : 'All creators'}</span>
        <ChevronDown size={10} className="flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 rounded-[10px] shadow-2xl animate-menu-pop overflow-hidden"
             style={{ background: 'var(--c-card)', border: '0.5px solid rgba(255,255,255,0.15)', width: 250 }}>
          <div style={{ padding: 6 }}>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search creators…"
              className="w-full px-2 py-1.5 rounded-[6px] text-[12px] outline-none"
              style={{
                background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.85)',
                border: '0.5px solid rgba(255,255,255,0.12)',
              }} />
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            <button type="button"
                    onMouseDown={() => { onChange(''); setOpen(false); setSearch('') }}
                    className="w-full text-left px-3 py-2 text-[12px] cursor-pointer hover:bg-[rgba(255,255,255,0.05)]"
                    style={{ color: !selected ? 'color-mix(in srgb, var(--c-accent) 80%, white)' : 'rgba(255,255,255,0.7)' }}>
              All creators
            </button>
            {filtered.map(c => (
              <button key={c.id} type="button"
                      onMouseDown={() => { onChange(String(c.id)); setOpen(false); setSearch('') }}
                      className="w-full text-left px-3 py-2 text-[12px] cursor-pointer flex items-center gap-2 hover:bg-[rgba(255,255,255,0.05)]"
                      style={{
                        background: String(c.id) === String(value) ? 'color-mix(in srgb, var(--c-accent) 15%, transparent)' : 'transparent',
                        color: String(c.id) === String(value) ? 'color-mix(in srgb, var(--c-accent) 80%, white)' : 'rgba(255,255,255,0.7)',
                      }}>
                <span className="truncate">{c.name}</span>
                {/* The count is the point: it tells you where the collection actually is. */}
                <span className="ml-auto flex-shrink-0" style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>
                  {c.card_count}
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-3 text-[12px] text-center" style={{ color: 'rgba(255,255,255,0.25)' }}>
                No creators found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── The bar ──────────────────────────────────────────────────────────────────
export default function CollectionFilters({
  search, onSearchChange,
  rarity, onRarityChange, rarityOptions, rarityColors,
  rarityClass, onRarityClassChange, classOptions,
  creator, onCreatorChange, creators,
  type, onTypeChange, typeOptions,
  sort, onSortChange, sortOptions,
  hasActiveFilters, onReset,
  trailing,
}) {
  // Typing is local and debounced — pushing every keystroke into the URL would
  // refetch the whole inventory per character.
  const [draft, setDraft] = useState(search ?? '')
  useEffect(() => { setDraft(search ?? '') }, [search])
  useEffect(() => {
    if (draft === (search ?? '')) return
    const id = setTimeout(() => onSearchChange(draft), 300)
    return () => clearTimeout(id)
  }, [draft])   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ marginBottom: 18 }}>
      {/* Row 1 — search, creator, type, sort */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <div className="relative" style={{ minWidth: 210 }}>
          <Search size={12} style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            color: 'rgba(255,255,255,0.3)', pointerEvents: 'none',
          }} />
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setDraft(''); onSearchChange('') } }}
            placeholder="Search cards…"
            className="w-full rounded-full text-[13px] outline-none"
            style={{
              padding: '7px 26px 7px 28px',
              background: 'rgba(255,255,255,0.05)',
              color: 'rgba(255,255,255,0.85)',
              border: `0.5px solid ${draft ? 'color-mix(in srgb, var(--c-accent) 40%, transparent)' : 'rgba(255,255,255,0.08)'}`,
            }} />
          {draft && (
            <button type="button"
                    onMouseDown={e => { e.preventDefault(); setDraft(''); onSearchChange('') }}
                    style={{
                      position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)',
                      color: 'rgba(255,255,255,0.35)', cursor: 'pointer', display: 'flex',
                    }}>
              <X size={11} />
            </button>
          )}
        </div>

        <CreatorPicker value={creator} creators={creators} onChange={onCreatorChange} />
        <VaultDropdown value={type} onChange={onTypeChange} options={typeOptions} />
        <VaultDropdown value={sort} onChange={onSortChange} options={sortOptions} />

        {hasActiveFilters && (
          <button onClick={onReset}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '5px 12px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
                    background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.4)',
                    border: '0.5px solid rgba(255,255,255,0.07)',
                  }}>
            Reset
          </button>
        )}

        {trailing}
      </div>

      {/* Row 2 — tier and class chips, the two axes you sort by most */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Filter size={12} style={{ color: 'rgba(255,255,255,0.25)', marginRight: 2 }} />
        {rarityOptions.map(o => (
          <Chip key={o.value}
                label={o.label}
                dot={rarityColors?.[o.value]}
                active={rarity === o.value}
                onClick={() => onRarityChange(o.value)} />
        ))}

        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', margin: '0 6px' }} />

        {classOptions.map(o => (
          <Chip key={o.value}
                label={o.label}
                active={rarityClass === o.value}
                title={o.value === 'All' ? 'Any scarcity class' : `Scarcity class ${o.value}`}
                onClick={() => onRarityClassChange(o.value)} />
        ))}
      </div>
    </div>
  )
}

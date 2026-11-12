import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Tag as TagIcon, X } from 'lucide-react'
import { tagsApi } from '../lib/api'
import { useT } from '../i18n'
import { INCLUDE, EXCLUDE, RATINGS, tokenFor } from './tag-filter/tagFilterMeta'
import RatingRow from './tag-filter/RatingRow'
import ActiveFilters from './tag-filter/ActiveFilters'
import TagBrowser from './tag-filter/TagBrowser'

const RATING_NAMES = new Set(RATINGS.map(r => r.name))
const PANEL_WIDTH = 680
const GUTTER = 16

// Toolbar "Tags" chip for Galleries, Photos and Videos. One panel holds the
// rating shortcut, the active include/exclude groups and a searchable,
// browsable tag list. Tokens are "id:<tag id>" (legacy "name:<tag>" is read).
export default function TagFilterInput({
  includeTags = [], includeMode = 'all', onIncludeModeChange, onAddInclude, onRemoveInclude,
  onClearInclude,
  excludeTags = [], excludeMode = 'any', onExcludeModeChange, onAddExclude, onRemoveExclude,
  onClearExclude,
  onTagsChange,   // (include, exclude) => void — one combined update, preferred
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const rootRef = useRef(null)
  const panelRef = useRef(null)
  const { data: allTags = [] } = useQuery({
    queryKey: ['tags'], queryFn: () => tagsApi.list().then(r => r.data), staleTime: 5 * 60 * 1000,
  })

  // The panel is portalled to <body> (toolbars sit in transformed, clipped
  // containers) and placed under the chip, kept inside the window.
  const measure = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(PANEL_WIDTH, window.innerWidth - GUTTER * 2)
    const left = Math.max(GUTTER, Math.min(rect.left, window.innerWidth - width - GUTTER))
    setPos({ top: rect.bottom + 8, left, width })
  }, [])
  useLayoutEffect(() => {
    if (!open) return
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, measure])

  useEffect(() => {
    if (!open) return
    const close = e => {
      if (rootRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const escape = e => { if (e.key === 'Escape') setOpen(false) }
    // Capture before a tag selection updates the URL and redraws the panel. In
    // bubble phase the clicked row may already be detached, making a real
    // inside click look like an outside click and closing the whole popover.
    document.addEventListener('mousedown', close, true)
    window.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close, true)
      window.removeEventListener('keydown', escape)
    }
  }, [open])

  const byId = useMemo(() => new Map(allTags.map(tag => [String(tag.id), tag])), [allTags])
  const byName = useMemo(() => new Map(allTags.map(tag => [tag.name, tag])), [allTags])
  const tagOf = token => (token.startsWith('id:') ? byId.get(token.slice(3))
    : byName.get(token.startsWith('name:') ? token.slice(5) : token))
  const labelFor = token => tagOf(token)?.name
    || (token.startsWith('id:') ? `#${token.slice(3)}` : token.replace(/^name:/, ''))

  const findToken = (tokens, tag) => tokens.find(token => tagOf(token)?.id === tag.id)
  const stateOf = tag => (findToken(includeTags, tag) ? 'include' : findToken(excludeTags, tag) ? 'exclude' : null)
  const without = (tokens, tag) => tokens.filter(token => tagOf(token)?.id !== tag.id)

  // Every action computes both final lists and applies them in one update.
  // URL-backed pages can't take two separate updates in the same click (the
  // second would overwrite the first), so onTagsChange is the preferred path.
  const apply = (nextInclude, nextExclude) => {
    if (onTagsChange) return onTagsChange(nextInclude, nextExclude)
    includeTags.filter(token => !nextInclude.includes(token)).forEach(onRemoveInclude)
    nextInclude.filter(token => !includeTags.includes(token)).forEach(onAddInclude)
    excludeTags.filter(token => !nextExclude.includes(token)).forEach(onRemoveExclude)
    nextExclude.filter(token => !excludeTags.includes(token)).forEach(onAddExclude)
  }
  const clear = tag => apply(without(includeTags, tag), without(excludeTags, tag))
  const include = tag => {
    let next = without(includeTags, tag)
    // A file has one rating, so requiring a second rating replaces the first.
    if (RATING_NAMES.has(tag.name)) next = next.filter(token => !RATING_NAMES.has(tagOf(token)?.name))
    apply([...next, tokenFor(tag)], without(excludeTags, tag))
  }
  const exclude = tag => apply(without(includeTags, tag), [...without(excludeTags, tag), tokenFor(tag)])
  const cycleRating = tag => {
    const state = stateOf(tag)
    if (!state) include(tag)
    else if (state === 'include') exclude(tag)
    else clear(tag)
  }
  const removeToken = token => apply(includeTags.filter(x => x !== token), excludeTags.filter(x => x !== token))
  const clearAll = () => apply([], [])

  const active = includeTags.length + excludeTags.length > 0

  return (
    <div ref={rootRef} className="relative flex-shrink-0 vault-row-control">
      <button type="button" onMouseDown={e => { e.preventDefault(); setOpen(v => !v) }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[16px] cursor-pointer"
              style={{
                background: active ? 'color-mix(in srgb, var(--c-accent) 20%, transparent)' : 'rgba(255,255,255,0.05)',
                color: active ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.5)',
                border: `0.5px solid ${active ? 'color-mix(in srgb, var(--c-accent) 40%, transparent)' : 'rgba(255,255,255,0.08)'}`,
              }}>
        <TagIcon size={15} /> {t('Tags')}
        {!!includeTags.length && <span className="px-1.5 rounded-full" style={{ background: INCLUDE.bg, color: INCLUDE.text }}>+{includeTags.length}</span>}
        {!!excludeTags.length && <span className="px-1.5 rounded-full" style={{ background: EXCLUDE.bg, color: EXCLUDE.text }}>−{excludeTags.length}</span>}
        <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {open && pos && createPortal(
        <div className="vault-modal-root" style={{ display: 'contents' }}>
        <div ref={panelRef} className="vault-tag-filter-panel fixed z-[200] flex flex-col gap-4 rounded-[12px] p-4 shadow-2xl animate-menu-pop overflow-y-auto"
             onWheel={e => e.stopPropagation()}
             style={{
               top: pos.top, left: pos.left, width: pos.width,
               maxHeight: `calc(100dvh - ${pos.top + GUTTER}px)`,
               background: '#1e1e1e',
               border: '0.5px solid rgba(255,255,255,0.15)',
               boxShadow: '0 18px 50px rgba(0,0,0,0.6)',
             }}>
          <div className="flex items-center gap-3">
            <div className="flex-1 text-[17px] font-semibold text-white/85">{t('Tag filters')}</div>
            {active && (
              <button type="button" onMouseDown={e => { e.preventDefault(); clearAll() }}
                      className="text-[16px] px-2 py-0.5 rounded-full cursor-pointer text-white/55 hover:text-white/85">
                {t('Clear all')}
              </button>
            )}
            <button type="button" onMouseDown={e => { e.preventDefault(); setOpen(false) }} aria-label={t('Close')}
                    className="p-1 rounded-full cursor-pointer text-white/45 hover:text-white/80">
              <X size={18} />
            </button>
          </div>

          <RatingRow tagsByName={byName} stateOf={stateOf} onCycle={cycleRating} />
          <ActiveFilters includeTags={includeTags} excludeTags={excludeTags} labelFor={labelFor}
                         includeMode={includeMode} excludeMode={excludeMode}
                         onIncludeModeChange={onIncludeModeChange} onExcludeModeChange={onExcludeModeChange}
                         onRemove={removeToken} />
          <div style={{ height: 1, background: 'rgba(255,255,255,0.07)' }} />
          <TagBrowser allTags={allTags} stateOf={stateOf} onInclude={include} onExclude={exclude} onClear={clear} />
        </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

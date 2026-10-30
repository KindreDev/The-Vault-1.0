import { LocalizedText, useT } from '../../i18n'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'
import './collection-controls-premium.css'

// Themed dropdown for the card collection (Vault pill style). The menu is
// portaled to <body> and positioned from the trigger, so it is never clipped
// by modals, scroll panels or transformed containers. Outside clicks check
// both the trigger and the menu.
export default function TCGSelect({ value, onChange, options, label, searchable = false, disabled = false, hideLabel = false }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [rect, setRect] = useState(null)
  const root = useRef(null)
  const trigger = useRef(null)
  const menu = useRef(null)
  const listId = useId()
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value))
  const selected = options[selectedIndex] || options[0]
  const visibleOptions = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return needle ? options.filter(option => String(option.label).toLocaleLowerCase().includes(needle)) : options
  }, [options, search])

  const place = () => {
    const box = trigger.current?.getBoundingClientRect()
    if (box) setRect({ left: box.left, top: box.bottom + 6, width: Math.max(box.width, 220), bottom: box.top })
  }
  useLayoutEffect(() => { if (open) place() }, [open])
  useEffect(() => {
    if (!open) return undefined
    const close = event => {
      if (root.current?.contains(event.target) || menu.current?.contains(event.target)) return
      setOpen(false)
    }
    const reposition = event => {
      if (menu.current?.contains(event.target)) return
      place()
    }
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open])

  const choose = option => { onChange(option.value); setOpen(false); setSearch('') }
  const move = direction => choose(options[(selectedIndex + direction + options.length) % options.length])
  const onKeyDown = event => {
    if (event.key === 'Escape') { if (open) { setOpen(false); event.preventDefault(); event.stopPropagation() } return }
    if (event.key === 'Enter' || event.key === ' ') { setOpen(current => !current); event.preventDefault(); return }
    if (event.key === 'ArrowDown') { move(1); event.preventDefault(); return }
    if (event.key === 'ArrowUp') { move(-1); event.preventDefault(); return }
    if (event.key === 'Home') { choose(options[0]); event.preventDefault(); return }
    if (event.key === 'End') { choose(options[options.length - 1]); event.preventDefault() }
  }

  // Open upward when there is no room below.
  const openUp = rect && window.innerHeight - rect.top < 260 && rect.bottom > 260
  const menuStyle = rect ? {
    position: 'fixed', left: Math.min(rect.left, window.innerWidth - rect.width - 8), width: rect.width, zIndex: 2000,
    ...(openUp ? { bottom: window.innerHeight - rect.bottom + 6 } : { top: rect.top }),
  } : { display: 'none' }

  return <div className="tcgws-filter-control" ref={root}>
    {!hideLabel && <span>{label}</span>}
    <button ref={trigger} type="button" disabled={disabled} className={`tcgws-filter-trigger${open ? ' is-open' : ''}`}
            aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-label={`${label}: ${selected?.label}`}
            onClick={() => setOpen(current => !current)} onKeyDown={onKeyDown}>
      <strong>{selected?.label}</strong><ChevronDown size={17} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={menu} className="vault-modal-root tcgws-shell" style={{ display: 'contents' }}>
      <div className="tcgws-filter-menu tcgws-filter-menu--portal" id={listId} role="listbox" aria-label={label} style={menuStyle}>
        {searchable && <label className="tcgws-filter-search"><Search size={16} aria-hidden="true" /><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder={t('Search {label}', { label: String(label || '').toLocaleLowerCase() })} /></label>}
        {visibleOptions.map(option => <button type="button" role="option" aria-selected={option.value === value} key={option.value} onClick={() => choose(option)}><span>{option.label}</span>{option.value === value && <Check size={16} aria-hidden="true" />}</button>)}
        {!visibleOptions.length && <span className="tcgws-filter-empty"><LocalizedText text={"No matches"} /></span>}
      </div>
    </div>, document.body)}
  </div>
}

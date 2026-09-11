import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CheckSquare2, ChevronDown, ChevronLeft, ChevronRight, Filter, FolderInput, Search, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { tcgV2Api } from '../../lib/api'
import CardTile from './CardTile'
import './collection-controls-premium.css'

const RARITIES = ['All', 'C', 'R', 'SR', 'SPR', 'UR']
const TYPES = ['All', 'scene', 'gallery', 'creator', 'character', 'cosplay', 'collab', 'bond', 'hall-of-fame']
const TYPE_LABELS = { scene: 'Scene', gallery: 'Gallery', creator: 'Creator', character: 'Character', cosplay: 'Cosplay', collab: 'Collab', bond: 'Bond', 'hall-of-fame': 'Hall of Fame' }
const RARITY_ORDER = { C: 0, R: 1, SR: 2, SPR: 3, UR: 4 }
const SORT_OPTIONS = [
  { value: 'collector_number', label: 'Collector number' },
  { value: 'rarity_high', label: 'Rarity, high to low' },
  { value: 'rarity_low', label: 'Rarity, low to high' },
  { value: 'newest_acquired', label: 'Newest acquired' },
  { value: 'newest_published', label: 'Newest published' },
  { value: 'name', label: 'Name' },
  { value: 'quantity', label: 'Quantity owned' },
]
const COLLECTION_SCOPES = [
  ['owned', 'Owned'], ['missing', 'Missing'], ['duplicates', 'Duplicates'],
  ['creators', 'Creators'], ['characters', 'Characters'], ['hof', 'Hall of Fame'], ['bond', 'Bond'],
]

function Select({ value, onChange, options, label, searchable = false }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const root = useRef(null)
  const listId = useId()
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value))
  const selected = options[selectedIndex] || options[0]
  const visibleOptions = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return needle ? options.filter(option => option.label.toLocaleLowerCase().includes(needle)) : options
  }, [options, search])

  useEffect(() => {
    const close = event => { if (!root.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const choose = option => { onChange(option.value); setOpen(false); setSearch('') }
  const move = direction => choose(options[(selectedIndex + direction + options.length) % options.length])
  const onKeyDown = event => {
    if (event.key === 'Escape') { setOpen(false); event.preventDefault(); return }
    if (event.key === 'Enter' || event.key === ' ') { setOpen(current => !current); event.preventDefault(); return }
    if (event.key === 'ArrowDown') { move(1); event.preventDefault(); return }
    if (event.key === 'ArrowUp') { move(-1); event.preventDefault(); return }
    if (event.key === 'Home') { choose(options[0]); event.preventDefault(); return }
    if (event.key === 'End') { choose(options[options.length - 1]); event.preventDefault() }
  }

  return <div className="tcgws-filter-control" ref={root}>
    <span>{label}</span>
    <button type="button" className={`tcgws-filter-trigger${open ? ' is-open' : ''}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-label={`${label}: ${selected?.label}`} onClick={() => setOpen(current => !current)} onKeyDown={onKeyDown}>
      <strong>{selected?.label}</strong><ChevronDown size={17} aria-hidden="true" />
    </button>
    {open && <div className="tcgws-filter-menu" id={listId} role="listbox" aria-label={label}>
      {searchable && <label className="tcgws-filter-search"><Search size={16} aria-hidden="true" /><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder={`Search ${label.toLocaleLowerCase()}`} /></label>}
      {visibleOptions.map(option => <button type="button" role="option" aria-selected={option.value === value} key={option.value} onClick={() => choose(option)}><span>{option.label}</span>{option.value === value && <Check size={16} aria-hidden="true" />}</button>)}
      {!visibleOptions.length && <span className="tcgws-filter-empty">No matches</span>}
    </div>}
  </div>
}

function optionList(values, labels = {}) { return values.map(value => ({ value, label: labels[value] || value })) }

function rowDate(row, field) {
  const value = row[field] || row.card?.[field]
  return value ? Date.parse(value) || 0 : 0
}

function collectorNumber(row) {
  const value = row.identity?.collector_number ?? row.card?.collector_number ?? row.display_number
  const number = Number.parseInt(String(value || '').match(/^\d+/)?.[0] || '', 10)
  return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER
}

function rowName(row) { return String(row.card?.display_name || row.card?.creator_name || row.card?.gallery_name || row.identity?.display_name || '').toLocaleLowerCase() }

function sortRows(rows, sort) {
  return [...rows].sort((left, right) => {
    if (sort === 'rarity_high' || sort === 'rarity_low') {
      const leftRarity = left.rarity || left.card?.print_rarity || left.card?.rarity_class
      const rightRarity = right.rarity || right.card?.print_rarity || right.card?.rarity_class
      const delta = (RARITY_ORDER[rightRarity] ?? -1) - (RARITY_ORDER[leftRarity] ?? -1)
      return sort === 'rarity_high' ? delta : -delta
    }
    if (sort === 'newest_acquired' || sort === 'newest_published') {
      const field = sort === 'newest_acquired' ? 'acquired_at' : 'published_at'
      return rowDate(right, field) - rowDate(left, field)
    }
    if (sort === 'name') return rowName(left).localeCompare(rowName(right))
    if (sort === 'quantity') return Number(right.quantity || 0) - Number(left.quantity || 0) || collectorNumber(left) - collectorNumber(right)
    return collectorNumber(left) - collectorNumber(right)
  })
}

export default function CollectionBrowser({ entries, inventory, view, classifications, values, releases = [], sets = [], filterOptions = {}, onOpen, total, page = 0, pageSize = 100, onPage, onFilters, serverFiltered = false, loading = false }) {
  const [query, setQuery] = useState('')
  const [rarity, setRarity] = useState('All')
  const [type, setType] = useState('All')
  const [exposure, setExposure] = useState('All')
  const [intensity, setIntensity] = useState('All')
  const [release, setRelease] = useState('All')
  const [set, setSet] = useState('All')
  const [creator, setCreator] = useState('All')
  const [character, setCharacter] = useState('All')
  const [binder, setBinder] = useState('All')
  const [sort, setSort] = useState('collector_number')
  const [scope, setScope] = useState(view === 'cards' ? 'owned' : view)
  const [selected, setSelected] = useState(() => new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [menu, setMenu] = useState(null)
  const selectionAnchor = useRef(null)
  const qc = useQueryClient()
  const { data: binders = [] } = useQuery({ queryKey: ['tcg-v2-binders'], queryFn: () => tcgV2Api.binders().then(response => response.data) })
  useEffect(() => {
    const scopeType = scope === 'creators' ? 'creator' : scope === 'characters' ? 'character' : scope === 'hof' ? 'hall-of-fame' : scope === 'bond' ? 'bond' : undefined
    const timer = setTimeout(() => onFilters?.({
      ownership: ['missing', 'duplicates'].includes(scope) ? scope : 'owned',
      search: query || undefined,
      rarity: rarity === 'All' ? undefined : rarity,
      card_type: type === 'All' ? scopeType : type,
      exposure: exposure === 'All' ? undefined : exposure,
      intensity: intensity === 'All' ? undefined : intensity,
      release_id: release === 'All' ? undefined : Number(release),
      set_id: set === 'All' ? undefined : Number(set),
      creator_id: creator === 'All' ? undefined : Number(creator),
      character_id: character === 'All' ? undefined : Number(character),
      binder_id: binder === 'All' ? undefined : binder,
    }), 250)
    return () => clearTimeout(timer)
  }, [query, rarity, type, exposure, intensity, release, set, creator, character, binder, scope, onFilters])
  const rows = entries?.length ? entries : (inventory || []).map(item => ({
    card: item, owned: true, quantity: item.quantity, display_number: item.catalog_code,
  }))
  const sortedRows = useMemo(() => sortRows(rows, sort), [rows, sort])

  const filtered = useMemo(() => serverFiltered ? sortedRows : sortedRows.filter(row => {
    const card = row.card
    const classification = card ? classifications?.[card.id] : null
    if (view === 'missing' && row.owned) return false
    if (view === 'duplicates' && Number(row.quantity || 0) < 2) return false
    if (view === 'hof' && card?.card_type !== 'hof') return false
    if (view === 'bond' && card?.card_type !== 'bond') return false
    if (view === 'creators' && card?.card_type !== 'creator') return false
    if (view === 'characters' && !(card?.card_type === 'creator' && card?.creator_type === 'character')) return false
    if (rarity !== 'All' && (row.rarity || card?.print_rarity || card?.rarity_class) !== rarity) return false
    if (type !== 'All' && card?.card_type !== type && !(type === 'hall-of-fame' && card?.card_type === 'hof')) return false
    if (exposure !== 'All' && classification?.exposure !== exposure) return false
    if (intensity !== 'All' && classification?.intensity !== intensity) return false
    if (query && !`${card?.display_name || ''} ${card?.creator_name || ''} ${card?.gallery_name || ''}`.toLowerCase().includes(query.toLowerCase())) return false
    return true
  }), [sortedRows, view, rarity, type, exposure, intensity, query, classifications, serverFiltered])

  useEffect(() => {
    setSelected(current => new Set([...current].filter(id => filtered.some(row => row.card?.id === id))))
    setMenu(null)
  }, [page, query, rarity, type, exposure, intensity, release, set, creator, character, binder, sort, scope])

  const placeCards = useMutation({
    mutationFn: binderId => tcgV2Api.addBinderCards(binderId, [...selected]),
    onSuccess: (_, binderId) => {
      const binder = binders.find(item => item.id === binderId)
      toast.success(`${selected.size} ${selected.size === 1 ? 'card' : 'cards'} placed in ${binder?.name || 'binder'}`)
      setSelected(new Set())
      setMenu(null)
      qc.invalidateQueries({ queryKey: ['tcg-v2-binders'] })
      qc.invalidateQueries({ queryKey: ['tcg-v2-binder', binderId] })
    },
    onError: error => toast.error(error.response?.data?.detail || 'Could not place cards in binder'),
  })

  const selectCard = (event, cardId, index) => {
    if (!selectionMode && !event.shiftKey && !event.ctrlKey && !event.metaKey && selected.size === 0) {
      onOpen?.(filtered[index].card)
      return
    }
    event.preventDefault()
    const selectRange = event.shiftKey && selectionAnchor.current != null
    const anchorIndex = selectionAnchor.current
    setSelected(current => {
      const next = new Set(current)
      if (selectRange) {
        const start = Math.min(anchorIndex, index)
        const end = Math.max(anchorIndex, index)
        filtered.slice(start, end + 1).forEach(row => row.card?.id && next.add(row.card.id))
      } else if (next.has(cardId)) next.delete(cardId)
      else next.add(cardId)
      return next
    })
    selectionAnchor.current = index
  }

  const openBinderMenu = (event, cardId, index) => {
    event.preventDefault()
    if (!selected.has(cardId)) {
      setSelected(new Set([cardId]))
      selectionAnchor.current = index
    }
    setMenu({ x: Math.min(event.clientX, window.innerWidth - 300), y: Math.min(event.clientY, window.innerHeight - 260) })
  }

  const reset = () => { setQuery(''); setRarity('All'); setType('All'); setExposure('All'); setIntensity('All'); setRelease('All'); setSet('All'); setCreator('All'); setCharacter('All'); setBinder('All'); setSort('collector_number'); setScope('owned') }
  const availableSets = release === 'All' ? sets : sets.filter(item => item.release_id === Number(release))
  const creatorOptions = [{ value: 'All', label: 'All creators' }, ...(filterOptions.creators || []).map(item => ({ value: String(item.id), label: item.name }))]
  const characterOptions = [{ value: 'All', label: 'All characters' }, ...(filterOptions.characters || []).map(item => ({ value: String(item.id), label: item.name }))]
  const binderOptions = [{ value: 'All', label: 'All binders' }, ...(filterOptions.binders || []).map(item => ({ value: String(item.id), label: item.name })), ...(filterOptions.has_unassigned ? [{ value: 'unassigned', label: 'Unassigned' }] : [])]
  const grouped = view === 'creators' || view === 'characters'
    ? Object.entries(filtered.reduce((groups, row) => {
      const name = row.card?.creator_name || row.card?.display_name || (view === 'characters' ? 'Unknown Character' : 'Unknown Creator')
      ;(groups[name] ||= []).push(row)
      return groups
    }, {})).sort(([left], [right]) => left.localeCompare(right))
    : null
  return (
    <section className="tcgws-browser" aria-busy={loading}>
      <div className="tcgws-collection-scopes" role="tablist" aria-label="Collection scope">
        {COLLECTION_SCOPES.map(([id, label]) => <button key={id} role="tab" aria-selected={scope === id} className={scope === id ? 'active' : ''} onClick={() => { setScope(id); onPage?.(0) }}>{label}</button>)}
        <button className={`tcgws-select-mode${selectionMode ? ' active' : ''}`} onClick={() => { setSelectionMode(value => !value); if (selectionMode) setSelected(new Set()) }}><CheckSquare2 size={18} /> Select cards</button>
      </div>
      <div className="tcgws-toolbar">
        <label className="tcgws-search"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search cards" /></label>
        <div className="tcgws-filter-label"><Filter size={17} /> Filters</div>
        <Select label="Rarity" value={rarity} onChange={setRarity} options={optionList(RARITIES)} />
        <Select label="Type" value={type} onChange={setType} options={optionList(TYPES, TYPE_LABELS)} />
        <Select label="Exposure" value={exposure} onChange={setExposure} options={optionList(['All', ...(values?.exposure || [])])} />
        <Select label="Sexual intensity" value={intensity} onChange={setIntensity} options={optionList(['All', ...(values?.intensity || [])])} />
        <Select label="Creator" value={creator} onChange={setCreator} options={creatorOptions} searchable />
        <Select label="Character" value={character} onChange={setCharacter} options={characterOptions} searchable />
        <Select label="Binder" value={binder} onChange={setBinder} options={binderOptions} searchable />
        {/*
        <Select label="Release" value={release} onChange={value => { setRelease(value); setSet('All') }}><option>All</option>{releases.map(item => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</Select>
        <Select label="Set" value={set} onChange={setSet}><option>All</option>{availableSets.map(item => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</Select>
        */}
        <Select label="Release" value={release} onChange={value => { setRelease(value); setSet('All') }} options={[{ value: 'All', label: 'All' }, ...releases.map(item => ({ value: String(item.id), label: `${item.name} - ${item.code}` }))]} />
        <Select label="Set" value={set} onChange={setSet} options={[{ value: 'All', label: 'All' }, ...availableSets.map(item => ({ value: String(item.id), label: `${item.name} - ${item.code}` }))]} />
        <Select label="Sort by (loaded page)" value={sort} onChange={setSort} options={SORT_OPTIONS} />
        <button className="tcgws-icon-btn" onClick={reset} title="Clear filters"><X size={18} /></button>
      </div>
      <div className="tcgws-result-count">{Number(total ?? filtered.length).toLocaleString()} {Number(total ?? filtered.length) === 1 ? 'printing' : 'printings'}</div>
      {selected.size > 0 && <div className="tcgws-selection-bar"><CheckSquare2 size={20} /><strong>{selected.size} selected</strong><span>Shift-click selects a range. Right-click a card to place the selection.</span><button onClick={event => setMenu({ x: event.clientX, y: event.clientY + 12 })}><FolderInput size={18} /> Add to binder</button><button className="tcgws-icon-btn" title="Clear selection" onClick={() => setSelected(new Set())}><X size={18} /></button></div>}
      {loading && <div className="tcgws-collection-loading" role="status"><i aria-hidden="true" /> Updating collection...</div>}
      {loading && filtered.length === 0 ? <div className="tcgws-card-skeletons" aria-label="Loading cards">{Array.from({ length: 10 }, (_, index) => <i key={index} />)}</div> : null}
      {!loading && filtered.length === 0 ? <div className="tcgws-empty-results"><strong>No cards match these filters</strong><span>Try clearing one of the filters to widen the collection.</span></div> : null}
      {grouped ? <div className="tcgws-grouped-collection">{grouped.map(([name, cards]) => <section key={name}><header><h2>{name}</h2><span>{cards.length} {cards.length === 1 ? 'printing' : 'printings'}</span></header><div className="tcgws-card-grid">{cards.map((row, index) => <CardTile key={row.id || row.card?.id || index} card={row.card} missing={!row.owned} quantity={row.quantity} number={row.display_number} identity={row.identity || row} classification={row.card ? classifications?.[row.card.id] : null} onOpen={row.card ? () => onOpen(row.card) : null} />)}</div></section>)}</div> : <div className="tcgws-card-grid">
        {filtered.map((row, index) => <CardTile key={row.id || row.card?.id || index} card={row.card} missing={!row.owned} quantity={row.quantity} number={row.display_number} identity={row.identity || row} classification={row.card ? classifications?.[row.card.id] : null} onOpen={row.card ? () => onOpen(row.card) : null} selected={selected.has(row.card?.id)} onSelect={row.card ? event => selectCard(event, row.card.id, index) : null} onContextMenu={row.card ? event => openBinderMenu(event, row.card.id, index) : null} />)}
      </div>}
      {Number(total || 0) > pageSize && <nav className="tcgws-pagination" aria-label="Collection pages"><button disabled={page === 0} onClick={() => onPage?.(page - 1)}><ChevronLeft size={18} /> Previous</button><span>Page {page + 1} of {Math.ceil(total / pageSize)}</span><button disabled={(page + 1) * pageSize >= total} onClick={() => onPage?.(page + 1)}>Next <ChevronRight size={18} /></button></nav>}
      {menu && <><button className="tcgws-context-dismiss" aria-label="Close binder menu" onClick={() => setMenu(null)} /><div className="tcgws-binder-context" style={{ left: menu.x, top: menu.y }}><header><FolderInput size={18} /><div><strong>Add to binder</strong><span>{selected.size} selected</span></div></header>{binders.length ? binders.map(binder => <button key={binder.id} disabled={placeCards.isPending} onClick={() => placeCards.mutate(binder.id)}><strong>{binder.name}</strong><span>{binder.card_count} cards</span></button>) : <p>Create a binder from the Binders view first.</p>}</div></>}
    </section>
  )
}

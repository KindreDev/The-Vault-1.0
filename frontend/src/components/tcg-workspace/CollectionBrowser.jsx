import { LocalizedText, useT } from '../../i18n'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CheckSquare2, Star, ChevronDown, ChevronLeft, ChevronRight, Filter, FolderInput, Search, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { tcgV2Api } from '../../lib/api'
import CardTile from './CardTile'
import Select from './TCGSelect'
import GalleryPagination from '../GalleryPagination'
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
  { value: 'quantity', label: 'Quantity owned' },
]
const COLLECTION_SCOPES = [['owned', 'Owned'], ['missing', 'Missing'], ['duplicates', 'Duplicates']]

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

export default function CollectionBrowser({ entries, inventory, view, hasLegacyCards = false, classifications, values, releases = [], sets = [], filterOptions = {}, onOpen, total, page = 0, pageSize = 100, onPage, onFilters, serverFiltered = false, loading = false, disableLayoutAnimation = false }) {
  const t = useT()
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
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [menu, setMenu] = useState(null)
  const selectionAnchor = useRef(null)
  const qc = useQueryClient()
  const { data: binders = [] } = useQuery({ queryKey: ['tcg-v2-binders'], queryFn: () => tcgV2Api.binders().then(response => response.data) })
  const legacyScope = scope === 'legacy'
  const defaultScope = view === 'cards' ? 'owned' : view
  useEffect(() => {
    const nextScope = view === 'cards' ? 'owned' : view
    setScope(current => current === nextScope ? current : nextScope)
    setSelected(new Set())
    selectionAnchor.current = null
  }, [view])
  useEffect(() => {
    if (legacyScope && !hasLegacyCards) {
      setScope(defaultScope)
      setSelected(new Set())
      selectionAnchor.current = null
    }
  }, [legacyScope, hasLegacyCards, defaultScope])
  useEffect(() => {
    const scopeType = scope === 'creators' ? 'creator' : scope === 'characters' ? 'character' : scope === 'hof' ? 'hall-of-fame' : scope === 'bond' ? 'bond' : undefined
    const timer = setTimeout(() => onFilters?.({
      ownership: legacyScope ? 'legacy' : ['missing', 'duplicates'].includes(scope) ? scope : 'owned',
      search: query || undefined,
      rarity: legacyScope || rarity === 'All' ? undefined : rarity,
      card_type: legacyScope ? undefined : type === 'All' ? scopeType : type,
      exposure: legacyScope || exposure === 'All' ? undefined : exposure,
      intensity: legacyScope || intensity === 'All' ? undefined : intensity,
      release_id: legacyScope || release === 'All' ? undefined : Number(release),
      set_id: legacyScope || set === 'All' ? undefined : Number(set),
      creator_id: legacyScope || creator === 'All' ? undefined : Number(creator),
      character_id: legacyScope || character === 'All' ? undefined : Number(character),
      binder_id: binder === 'All' ? undefined : binder,
      sort: sort === 'collector_number' ? undefined : sort,
      favorites: favoritesOnly || undefined,
    }), 250)
    return () => clearTimeout(timer)
  }, [query, rarity, type, exposure, intensity, release, set, creator, character, binder, scope, sort, favoritesOnly, onFilters])
  const rows = entries?.length ? entries : (inventory || []).map(item => ({
    card: item, owned: true, quantity: item.quantity, display_number: item.catalog_code,
  }))
  // Server-filtered pages arrive already sorted across the whole collection.
  const sortedRows = useMemo(() => serverFiltered ? rows : sortRows(rows, sort), [rows, sort, serverFiltered])

  const filtered = useMemo(() => serverFiltered ? sortedRows : sortedRows.filter(row => {
    const card = row.card
    const classification = card ? classifications?.[card.id] : null
    if (scope === 'legacy' && !card?.is_legacy) return false
    if (scope !== 'legacy' && card?.is_legacy) return false
    if (scope === 'missing' && row.owned) return false
    if (scope === 'duplicates' && Number(row.quantity || 0) < 2) return false
    if (scope === 'hof' && card?.card_type !== 'hof') return false
    if (scope === 'bond' && card?.card_type !== 'bond') return false
    if (scope === 'creators' && card?.card_type !== 'creator') return false
    if (scope === 'characters' && !(card?.card_type === 'creator' && card?.creator_type === 'character')) return false
    if (scope !== 'legacy' && rarity !== 'All' && (row.rarity || card?.print_rarity || card?.rarity_class) !== rarity) return false
    if (scope !== 'legacy' && type !== 'All' && card?.card_type !== type && !(type === 'hall-of-fame' && card?.card_type === 'hof')) return false
    if (scope !== 'legacy' && exposure !== 'All' && classification?.exposure !== exposure) return false
    if (scope !== 'legacy' && intensity !== 'All' && classification?.intensity !== intensity) return false
    if (query && !`${card?.display_name || ''} ${card?.creator_name || ''} ${card?.gallery_name || ''}`.toLowerCase().includes(query.toLowerCase())) return false
    return true
  }), [sortedRows, scope, rarity, type, exposure, intensity, query, classifications, serverFiltered])

  useEffect(() => {
    setSelected(current => new Set([...current].filter(id => filtered.some(row => row.card?.id === id))))
    setMenu(null)
  }, [page, query, rarity, type, exposure, intensity, release, set, creator, character, binder, sort, scope])

  const placeCards = useMutation({
    mutationFn: binderId => tcgV2Api.addBinderCards(binderId, [...selected]),
    onSuccess: (_, binderId) => {
      const binder = binders.find(item => item.id === binderId)
      toast.success(t('{count} cards placed in {binder}', { count: selected.size, binder: binder?.name || t('binder') }))
      setSelected(new Set())
      setMenu(null)
      qc.invalidateQueries({ queryKey: ['tcg-v2-binders'] })
      qc.invalidateQueries({ queryKey: ['tcg-v2-binder', binderId] })
    },
    onError: error => toast.error(error.response?.data?.detail || t("Could not place cards in binder")),
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

  const reset = () => { setQuery(''); setRarity('All'); setType('All'); setExposure('All'); setIntensity('All'); setRelease('All'); setSet('All'); setCreator('All'); setCharacter('All'); setBinder('All'); setSort('collector_number'); setScope(defaultScope); setFavoritesOnly(false) }
  const searchHelp = t('Search by name, creator, gallery, card ID, printed code or number, rarity, type, exposure, or intensity')
  const availableSets = release === 'All' ? sets : sets.filter(item => item.release_id === Number(release))
  const creatorOptions = [{ value: 'All', label: t('All creators') }, ...(filterOptions.creators || []).map(item => ({ value: String(item.id), label: item.name }))]
  const characterOptions = [{ value: 'All', label: t('All characters') }, ...(filterOptions.characters || []).map(item => ({ value: String(item.id), label: item.name }))]
  const binderOptions = [{ value: 'All', label: t('All binders') }, ...(filterOptions.binders || []).map(item => ({ value: String(item.id), label: item.name })), ...(filterOptions.has_unassigned ? [{ value: 'unassigned', label: t('Unassigned') }] : [])]
  const grouped = scope === 'creators' || scope === 'characters'
    ? Object.entries(filtered.reduce((groups, row) => {
      const name = row.card?.creator_name || row.card?.display_name || t(scope === 'characters' ? 'Unknown Character' : 'Unknown Creator')
      ;(groups[name] ||= []).push(row)
      return groups
    }, {})).sort(([left], [right]) => left.localeCompare(right))
    : null
  return (
    <section className="tcgws-browser" aria-busy={loading}>
      <div className="tcgws-collection-scopes" role="tablist" aria-label={t("Collection scope")}>
        {COLLECTION_SCOPES.map(([id, label]) => <button key={id} role="tab" aria-selected={scope === id} className={scope === id ? 'active' : ''} onClick={() => { setScope(id); onPage?.(0) }}>{t(label)}</button>)}
        {hasLegacyCards && <button type="button" className={`tcgws-legacy-toggle${legacyScope ? ' active' : ''}`} aria-pressed={legacyScope} title={t("Show legacy cards")} onClick={() => { setScope(legacyScope ? defaultScope : 'legacy'); onPage?.(0) }}>
          <span>{t('Legacy cards')}</span><i>{legacyScope ? t('On') : t('Off')}</i>
        </button>}
        <button type="button" aria-pressed={favoritesOnly} className={`tcgws-favorites-scope${favoritesOnly ? ' active' : ''}`} onClick={() => { setFavoritesOnly(value => !value); onPage?.(0) }}><Star size={16} fill={favoritesOnly ? 'currentColor' : 'none'} />{t('Favorites')}</button>
        <button className={`tcgws-select-mode${selectionMode ? ' active' : ''}`} onClick={() => { setSelectionMode(value => !value); if (selectionMode) setSelected(new Set()) }}><CheckSquare2 size={18} /><LocalizedText text={"Select cards"} before={" "} /></button>
      </div>
      <div className="tcgws-toolbar">
        <label className="tcgws-search"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder={t("Search names, IDs, codes…")} aria-label={searchHelp} title={searchHelp} /></label>
        <div className="tcgws-filter-label"><Filter size={17} /><LocalizedText text={"Filters"} before={" "} /></div>
        {!legacyScope && <Select label={t("Rarity")} value={rarity} onChange={setRarity} options={optionList(RARITIES, { All: t('All') })} />}
        {!legacyScope && <Select label={t("Type")} value={type} onChange={setType} options={optionList(TYPES, { All: t('All'), ...Object.fromEntries(Object.entries(TYPE_LABELS).map(([key, label]) => [key, t(label)])) })} />}
        {!legacyScope && <Select label={t("Exposure")} value={exposure} onChange={setExposure} options={optionList(['All', ...(values?.exposure || [])], { All: t('All') })} />}
        {!legacyScope && <Select label={t("Sexual intensity")} value={intensity} onChange={setIntensity} options={optionList(['All', ...(values?.intensity || [])], { All: t('All') })} />}
        {!legacyScope && <Select label={t("Creator")} value={creator} onChange={setCreator} options={creatorOptions} searchable />}
        {!legacyScope && <Select label={t("Character")} value={character} onChange={setCharacter} options={characterOptions} searchable />}
        <Select label={t("Binder")} value={binder} onChange={setBinder} options={binderOptions} searchable />
        {!legacyScope && <Select label={t("Release")} value={release} onChange={value => { setRelease(value); setSet('All') }} options={[{ value: 'All', label: t('All') }, ...releases.map(item => ({ value: String(item.id), label: `${item.name} - ${item.code}` }))]} />}
        {!legacyScope && <Select label={t("Set")} value={set} onChange={setSet} options={[{ value: 'All', label: t('All') }, ...availableSets.map(item => ({ value: String(item.id), label: `${item.name} - ${item.code}` }))]} />}
        <Select label={t("Sort by")} value={sort} onChange={setSort} options={SORT_OPTIONS.map(option => ({ ...option, label: t(option.label) }))} />
        <button className="tcgws-icon-btn" onClick={reset} title={t("Clear filters")}><X size={18} /></button>
      </div>
      <div className="tcgws-result-count">{Number(total ?? filtered.length).toLocaleString()} {t(Number(total ?? filtered.length) === 1 ? 'printing' : 'printings')}</div>
      {selected.size > 0 && <div className="tcgws-selection-bar"><CheckSquare2 size={20} /><strong>{selected.size}<LocalizedText text={"selected"} before={" "} /></strong><span><LocalizedText text={"Shift-click selects a range. Right-click a card to place the selection."} /></span><button onClick={event => setMenu({ x: Math.min(event.clientX, window.innerWidth - 300), y: Math.min(event.clientY + 12, window.innerHeight - 260) })}><FolderInput size={18} /><LocalizedText text={"Add to binder"} before={" "} /></button><button className="tcgws-icon-btn" title={t("Clear selection")} onClick={() => setSelected(new Set())}><X size={18} /></button></div>}
      {loading && <div className="tcgws-collection-loading" role="status"><i aria-hidden="true" /><LocalizedText text={"Updating collection..."} before={" "} /></div>}
      {loading && filtered.length === 0 ? <div className="tcgws-card-skeletons" aria-label={t("Loading cards")}>{Array.from({ length: 10 }, (_, index) => <i key={index} />)}</div> : null}
      {!loading && filtered.length === 0 ? <div className="tcgws-empty-results"><strong><LocalizedText text={"No cards match these filters"} /></strong><span><LocalizedText text={"Try clearing one of the filters to widen the collection."} /></span></div> : null}
      {grouped ? <div className="tcgws-grouped-collection">{grouped.map(([name, cards]) => <section key={name}><header><h2>{name}</h2><span>{cards.length} {t(cards.length === 1 ? 'printing' : 'printings')}</span></header><div className="tcgws-card-grid">{cards.map((row, index) => <CardTile key={row.id || row.card?.id || index} card={row.card} favorite={Boolean(row.favorite)} missing={!row.owned} quantity={row.quantity} number={row.display_number} identity={row.identity || row} classification={row.card ? classifications?.[row.card.id] : null} onOpen={row.card ? () => onOpen(row.card) : null} disableLayoutAnimation={disableLayoutAnimation} />)}</div></section>)}</div> : <div className="tcgws-card-grid">
        {filtered.map((row, index) => <CardTile key={row.id || row.card?.id || index} card={row.card} favorite={Boolean(row.favorite)} missing={!row.owned} quantity={row.quantity} number={row.display_number} identity={row.identity || row} classification={row.card ? classifications?.[row.card.id] : null} onOpen={row.card ? () => onOpen(row.card) : null} selected={selected.has(row.card?.id)} onSelect={row.card ? event => selectCard(event, row.card.id, index) : null} onContextMenu={row.card ? event => openBinderMenu(event, row.card.id, index) : null} disableLayoutAnimation={disableLayoutAnimation} />)}
      </div>}
      <GalleryPagination id="tcg-collection" page={page + 1} totalPages={Math.ceil(Number(total || 0) / pageSize)} onChange={next => onPage?.(next - 1)} t={t} />
      {menu && <><button className="tcgws-context-dismiss" aria-label={t("Close binder menu")} onClick={() => setMenu(null)} /><div className="tcgws-binder-context" style={{ left: menu.x, top: menu.y }}><header><FolderInput size={18} /><div><strong><LocalizedText text={"Add to binder"} /></strong><span>{selected.size}<LocalizedText text={"selected"} before={" "} /></span></div></header>{binders.length ? binders.map(binder => <button key={binder.id} disabled={placeCards.isPending} onClick={() => placeCards.mutate(binder.id)}><strong>{binder.name}</strong><span>{binder.card_count}<LocalizedText text={"cards"} before={" "} /></span></button>) : <p><LocalizedText text={"Create a binder from the Binders view first."} /></p>}</div></>}
    </section>
  )
}

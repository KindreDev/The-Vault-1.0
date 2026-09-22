import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Armchair, Box, Eye, Layers, PackageOpen, Search, Star, X } from 'lucide-react'
import { tcgRoomApi, tcgV2Api } from '../../lib/api'
import PackOpening from '../PackOpening'
import TCGV2CardFace from '../tcg-v2/TCGV2CardFace'
import { BoosterEnvelope } from '../tcg-workspace/PackBrowser'
import '../tcg-workspace/tcg-workspace.css'
import '../tcg-workspace/tcg-workspace-refinements.css'

const PAGE = 48
const RARITIES = ['C', 'R', 'SR', 'SPR', 'UR']
const RARITY_LABEL = { C: 'Common', R: 'Rare', SR: 'Super Rare', SPR: 'Signature', UR: 'Ultra Rare' }
const FURNITURE_GROUPS = {
  card_display_stand_white: 'Display', card_display_stand_black: 'Display', card_display_stand: 'Display',
  graded_card_stand_white: 'Display', graded_card_stand_black: 'Display', graded_card_stand: 'Display',
  glass_display_case: 'Display', glass_display_cabinet: 'Display', floating_glass_cabinet: 'Display',
  poster_frame: 'Decor',
}
const FURNITURE_BLURB = {
  glass_display_cabinet: 'A premium glass display cabinet for your most valued cards and collectibles.',
  glass_display_case: 'A tall glass case for standing displays.',
  floating_glass_cabinet: 'A wall-mounted glass cabinet.',
  card_display_stand_white: 'Holds 1 card. Sits on a table or shelf.',
  card_display_stand_black: 'Holds 1 card. Sits on a table or shelf.',
  graded_card_stand_white: 'Holds 9 cards, 3 per row. Sits on a table or shelf.',
  graded_card_stand_black: 'Holds 9 cards, 3 per row. Sits on a table or shelf.',
  poster_frame: 'A framed print of a photo from your Vault.',
}

function apiError(error, fallback) {
  return error?.response?.data?.detail || fallback
}

function cardCode(item) {
  return item.identity?.stable_card_id || item.card?.catalog_code || item.display_number || (item.card?.id != null ? `CARD-${String(item.card.id).padStart(6, '0')}` : '')
}

function furnitureImage(assetId) {
  return `/tcg-room/shop/${assetId}.png?v=20260913-preview2`
}

function furnitureGroup(assetId) {
  return FURNITURE_GROUPS[assetId] || 'Utility'
}

function boosterWrapper(product = {}) {
  if (product.wrapper_src) return product.wrapper_src
  const kind = String(product.product_kind || '').toLowerCase()
  if (kind.includes('premium')) return '/tcg-booster-premium-cutout.png'
  if (kind.includes('limited') || kind.includes('weekly')) return '/tcg-booster-limited-cutout.png'
  if (kind.includes('release')) return '/tcg-booster-standard-cutout.png'
  return '/tcg-booster-permanent-cutout.png'
}

function openPacksLabel(count) {
  const total = Number(count || 0)
  return total === 1 ? 'Open pack' : `Open all ${total} packs`
}

function sealedPackLabel(count) {
  const total = Number(count || 0)
  return `${total} sealed pack${total === 1 ? '' : 's'} waiting`
}

function readableDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString()
}

function detailValue(value, fallback = 'Unavailable') {
  return value === null || value === undefined || value === '' ? fallback : String(value)
}

function FurniturePreview({ item, className = '' }) {
  const [missing, setMissing] = useState(false)
  const src = furnitureImage(item.asset_id)
  useEffect(() => setMissing(false), [src])
  return <div className={`vault-inv__furniture-preview ${className} ${missing ? 'is-missing' : ''}`}>
    {missing ? <span>Preview unavailable</span> : <img src={src} alt="" onError={() => setMissing(true)} />}
  </div>
}

async function hydratePacks(results, contents = []) {
  const products = new Map(contents.map(line => [line.product_id, line.product || {}]))
  return Promise.all((results || []).map(async result => ({
    product: products.get(result.product_id) || result.product || {},
    cards: await Promise.all((result.cards || []).map(async id => {
      if (id && typeof id === 'object') return id
      const response = await tcgV2Api.cardDetail(id)
      return response.data?.card || response.data
    })),
  })))
}

export default function RoomInventory({ onClose, onPlaceFurniture, initialTab = 'cards', onTabChange }) {
  const qc = useQueryClient()
  const [tab, setTab] = useState(initialTab === 'packs' ? 'packs' : initialTab)
  const [selectedWeeklyReleases, setSelectedWeeklyReleases] = useState({})
  const selectTab = next => { setTab(next); onTabChange?.(next) }
  const [openedPacks, setOpenedPacks] = useState(null)
  const [openingLabel, setOpeningLabel] = useState('')
  const [cardSearch, setCardSearch] = useState('')
  const [cardQuery, setCardQuery] = useState('')
  const [rarity, setRarity] = useState('')
  const [selectedCard, setSelectedCard] = useState(null)
  const [cardDetailsOpen, setCardDetailsOpen] = useState(false)
  const [furnitureFilter, setFurnitureFilter] = useState('All')
  const [selectedFurniture, setSelectedFurniture] = useState(null)
  const [furnitureDetailsOpen, setFurnitureDetailsOpen] = useState(false)
  const inventory = useQuery({
    queryKey: ['tcg-room-inventory'],
    queryFn: () => tcgRoomApi.inventory().then(response => response.data),
    staleTime: 0,
  })
  const releasesQuery = useQuery({
    queryKey: ['tcg-v2-releases'],
    queryFn: () => tcgV2Api.releases().then(response => response.data),
    staleTime: 60_000,
  })
  const publishedReleases = (releasesQuery.data || []).filter(release => release.status === 'published')
  const cardCatalog = useInfiniteQuery({
    queryKey: ['tcg-v2-catalog', 'room-inventory', cardQuery, rarity],
    queryFn: ({ pageParam = 0 }) => tcgV2Api.catalog({
      ownership: 'owned', skip: pageParam, limit: PAGE, search: cardQuery || undefined, rarity: rarity || undefined,
    }).then(r => r.data),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((count, page) => count + (page.items?.length || 0), 0)
      return loaded < (lastPage.total || 0) ? loaded : undefined
    },
    enabled: true,
  })
  const catalogItems = useMemo(
    () => (cardCatalog.data?.pages || []).flatMap(page => page.items || []).filter(item => item.card),
    [cardCatalog.data],
  )
  const cardTotal = cardCatalog.data?.pages?.[0]?.total || catalogItems.length
  const collectionImages = useMemo(() => catalogItems.map(item => item.card?.thumb_url || item.card?.image_url || item.thumb_url || item.image_url).filter(Boolean).slice(0, 30), [catalogItems])
  const packVisual = (product = {}, id = 0) => <BoosterEnvelope pack={{
    ...product,
    id: String(id),
    name: product.name || 'Vault Booster',
    card_count: product.card_count || '?',
    product_kind: product.product_kind || 'permanent',
  }} images={collectionImages} />
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['tcg-room-inventory'] }),
    qc.invalidateQueries({ queryKey: ['tcg-room-bootstrap'] }),
    qc.invalidateQueries({ queryKey: ['tcg-room-furniture'] }),
    qc.invalidateQueries({ queryKey: ['tcg-room-copies'] }),
    qc.invalidateQueries({ queryKey: ['tcg-v2-catalog'] }),
    qc.invalidateQueries({ queryKey: ['profile'] }),
  ])
  const openParcel = useMutation({
    mutationFn: async parcel => {
      setOpeningLabel('Opening booster packs…')
      const response = await tcgRoomApi.openInventoryParcel(parcel.parcel_id)
      return hydratePacks(response.data?.results, response.data?.contents)
    },
    onSuccess: packs => {
      setOpeningLabel('')
      if (!packs?.length || packs.every(pack => !pack.cards?.length)) {
        toast.error('The booster packs opened, but no cards came back to reveal.')
        refresh()
        return
      }
      setOpenedPacks(packs)
      refresh()
    },
    onError: error => { setOpeningLabel(''); toast.error(apiError(error, 'Booster pack opening failed')) },
  })
  const openToken = useMutation({
    mutationFn: async token => {
      setOpeningLabel(`Opening ${token.product?.name || 'booster'}…`)
      const response = await tcgV2Api.openPack(token.product_id, {
        use_token: true,
        selected_release_id: token.selected_release_id || undefined,
      })
      const data = response.data || {}
      const cards = data.cards || []
      const product = { ...(token.product || {}), ...(data.product || {}) }
      if (cards.length && typeof cards[0] !== 'object') {
        return hydratePacks([{ product_id: token.product_id, product, cards }])
      }
      return [{ product, cards }]
    },
    onSuccess: packs => {
      setOpeningLabel('')
      if (!packs?.length || packs.every(pack => !pack.cards?.length)) {
        toast.error('The pack opened, but the reveal did not load.')
        refresh()
        return
      }
      setOpenedPacks(packs)
      refresh()
    },
    onError: error => { setOpeningLabel(''); toast.error(apiError(error, 'Pack opening failed')) },
  })

  const furniture = inventory.data?.furniture || []
  const parcels = inventory.data?.parcels || []
  const tokens = inventory.data?.pack_tokens || []
  const packCount = tokens.reduce((sum, item) => sum + Number(item.token_count || 0), 0) + parcels.reduce((sum, item) => sum + Number(item.pack_count || 0), 0)
  const filteredFurniture = furniture.filter(item => furnitureFilter === 'All' || furnitureGroup(item.asset_id) === furnitureFilter)
  const activeFurniture = filteredFurniture.find(item => item.instance_id === selectedFurniture?.instance_id) || filteredFurniture[0] || null
  const busy = openParcel.isPending || openToken.isPending
  const activeCard = catalogItems.find(item => item.card?.id === selectedCard?.card?.id) || catalogItems[0] || null
  const cardDetailQuery = useQuery({
    queryKey: ['tcg-room-card-detail', activeCard?.card?.id],
    queryFn: () => tcgV2Api.cardDetail(activeCard.card.id).then(response => response.data),
    enabled: cardDetailsOpen && Boolean(activeCard?.card?.id),
    staleTime: 60_000,
  })

  useEffect(() => {
    const timer = window.setTimeout(() => setCardQuery(cardSearch.trim()), 280)
    return () => window.clearTimeout(timer)
  }, [cardSearch])

  if (openedPacks) return <PackOpening packs={openedPacks} onCollect={() => { setOpenedPacks(null); refresh() }} onSkip={() => { setOpenedPacks(null); refresh() }} />

  const rarityClass = String(activeCard?.rarity || activeCard?.card?.rarity_class || 'C').toUpperCase()
  return <section className={`vault-inv vault-inv--${tab}`} role="dialog" aria-modal="true" aria-labelledby="room-inventory-title">
    {tab === 'cards' && <header className="vault-inv__masthead">
      <Box size={22} />
      <div><h1 id="room-inventory-title">Inventory</h1><p>Manage your cards, packs, and room items.</p></div>
      <Star size={18} />
    </header>}
    {tab === 'furniture' && <header className="vault-inv__masthead">
      <Box size={22} />
      <div><h1 id="room-inventory-title">Inventory</h1><p>Manage your cards, packs, and room items.</p></div>
      <Star size={18} />
    </header>}
    <aside className="vault-inv__nav">
      <button type="button" className={tab === 'cards' ? 'active' : ''} onClick={() => selectTab('cards')}><Layers size={18} /> Cards <span>{cardTotal || 0}</span></button>
      <button type="button" className={tab === 'packs' ? 'active' : ''} onClick={() => selectTab('packs')}><PackageOpen size={18} /> Booster Packs <span>{packCount}</span></button>
      <button type="button" className={tab === 'furniture' ? 'active' : ''} onClick={() => selectTab('furniture')}><Armchair size={18} /> Furniture <span>{furniture.length}</span></button>
    </aside>
    <div className="vault-inv__main">
      {tab === 'cards' && <>
        <header className="vault-inv__toolbar">
          <h2>Cards ({cardTotal})</h2>
          <label className="vault-inv__search"><Search size={16} /><input value={cardSearch} onChange={event => setCardSearch(event.target.value)} placeholder="Search cards…" /></label>
          <select className="vault-inv__select" value={rarity} onChange={event => setRarity(event.target.value)} aria-label="Rarity">
            <option value="">Rarity</option>
            {RARITIES.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </header>
        <div className="vault-inv__card-grid">
          {catalogItems.map(item => {
            const klass = String(item.rarity || item.card.rarity_class || 'C').toUpperCase()
            return <button key={item.card.id} type="button" className={`vault-inv__card vault-inv__card--${klass} ${activeCard?.card?.id === item.card.id ? 'selected' : ''}`} onClick={() => setSelectedCard(item)}>
              <span>{klass}</span>
              <TCGV2CardFace card={item.card} width="100%" showEffects={false} />
              <small>{item.identity?.display_name || item.card.display_name || cardCode(item)}</small>
            </button>
          })}
        </div>
        {cardCatalog.hasNextPage && <button type="button" className="vault-inv__more" disabled={cardCatalog.isFetchingNextPage} onClick={() => cardCatalog.fetchNextPage()}>{cardCatalog.isFetchingNextPage ? 'Loading…' : 'Load more'}</button>}
      </>}
      {tab === 'packs' && <>
        <header className="vault-inv__toolbar">
          <div><h2>Booster Packs</h2><p>Open packs, find rare cards, and expand your collection.</p></div>
        </header>
        <div className="vault-inv__pack-grid">
          {tokens.map(token => (
            <article key={`token-${token.product_id}`} className="vault-inv__pack">
              {packVisual(token.product, token.product_id)}
              <div className="vault-inv__pack-meta">
                <h3>{token.product?.name || 'Booster pack'}</h3>
                <p>{token.product?.card_count || '?'} cards each</p>
                <strong>x{token.token_count}</strong>
              </div>
              {token.product?.product_kind === 'weekly_protection' && (
                <label className="vault-inv__release-picker">
                  <span>Choose release</span>
                  <select
                    value={selectedWeeklyReleases[token.product_id] || ''}
                    onChange={event => setSelectedWeeklyReleases(current => ({ ...current, [token.product_id]: Number(event.target.value) }))}
                    disabled={busy || releasesQuery.isLoading}
                  >
                    <option value="">Select a published release</option>
                    {publishedReleases.map(release => <option key={release.id} value={release.id}>{release.name}</option>)}
                  </select>
                </label>
              )}
              <button
                type="button"
                className="vault-inv__cta"
                disabled={busy || (token.product?.product_kind === 'weekly_protection' && !selectedWeeklyReleases[token.product_id])}
                onClick={() => openToken.mutate({
                  ...token,
                  selected_release_id: selectedWeeklyReleases[token.product_id] || undefined,
                })}
              >
                Open
              </button>
            </article>
          ))}
          {parcels.flatMap(parcel => (parcel.contents?.length ? parcel.contents : [{ product: {}, quantity: parcel.pack_count || 0 }])
            .filter(line => !line.product?.product_kind || line.product.card_count || line.product_id)
            .map((line, index) => (
            <article key={`booster-${parcel.parcel_id}-${index}`} className="vault-inv__pack">
              {packVisual(line.product, `${parcel.parcel_id}-${index}`)}
              <div className="vault-inv__pack-meta">
                <h3>{line.product?.name || 'Vault Booster Packs'}</h3>
                <p>{sealedPackLabel(line.quantity || 0)}</p>
              </div>
              <button type="button" className="vault-inv__cta" disabled={busy} onClick={() => openParcel.mutate(parcel)}>{openPacksLabel(parcel.pack_count || parcel.contents?.reduce((sum, line) => sum + Number(line.quantity || 0), 0) || 0)}</button>
            </article>
          )))}
        </div>
        {!tokens.length && !parcels.length && <div className="vault-inv__empty">No booster packs waiting. Order from the computer, then collect them from the crate.</div>}
      </>}
      {tab === 'furniture' && <>
        <header className="vault-inv__toolbar">
          <div><h2>Furniture ({furniture.length})</h2><p>Choose an owned item to inspect or place in your room.</p></div>
        </header>
        <div className="vault-inv__chips">{['All', 'Display', 'Storage', 'Decor', 'Utility'].map(value => (
          <button key={value} type="button" className={furnitureFilter === value ? 'active' : ''} onClick={() => setFurnitureFilter(value)}>{value}</button>
        ))}</div>
        <div className="vault-inv__furn-grid">
          {filteredFurniture.map(item => (
            <button key={item.instance_id} type="button" className={activeFurniture?.instance_id === item.instance_id ? 'selected' : ''} onClick={() => setSelectedFurniture(item)}>
              <FurniturePreview item={item} />
              <span>{item.name}</span>
            </button>
          ))}
          {!filteredFurniture.length && <div className="vault-inv__empty">No furniture in this category.</div>}
        </div>
      </>}
    </div>
    {tab === 'cards' && activeCard?.card && <aside className="vault-inv__detail vault-inv__detail--card">
      <div className={`vault-inv__hero vault-inv__card--${rarityClass}`}>
        <TCGV2CardFace card={activeCard.card} width="100%" showEffects />
      </div>
      <h3>{activeCard.identity?.display_name || activeCard.card.display_title || activeCard.card.display_name || cardCode(activeCard)}</h3>
      <strong>{cardCode(activeCard)}</strong>
      <dl>
        <div><dt>Rarity</dt><dd><b>{rarityClass}</b> {RARITY_LABEL[rarityClass] || ''}</dd></div>
        <div><dt>Type</dt><dd>{detailValue(activeCard.card.card_type)}</dd></div>
      </dl>
      {cardDetailsOpen && <div className="vault-inv__card-details">
        {cardDetailQuery.isLoading && <p className="vault-inv__expanded-detail">Loading card details…</p>}
        {cardDetailQuery.isError && <p className="vault-inv__expanded-detail">Some card details are unavailable right now.</p>}
        {(() => {
          const detail = cardDetailQuery.data || {}
          const card = detail.card || activeCard.card
          const classification = detail.classification || activeCard.classification || {}
          const relationship = detail.relationships?.[0]
          const quantity = detail.quantity_owned ?? activeCard.quantity
          const acquired = detail.dates?.acquired || activeCard.acquired_at
          const published = detail.dates?.card_published || activeCard.published_at || card.generated_at
          const rows = [
            ['Card type', card.card_type],
            ['Release', relationship?.release_name || relationship?.release_code],
            ['Set', relationship?.set_name || relationship?.set_code],
            ['Collector number', relationship?.collector_position != null ? `${relationship.collector_position}${relationship.collector_suffix || ''}` : (activeCard.display_number || card.collector_number)],
            ['Copies owned', quantity != null ? quantity : null],
            ['Acquired', readableDate(acquired)],
            ['Published', readableDate(published)],
            ['User rating', detail.user_rating != null ? (detail.user_rating || 'Unrated') : null],
            ['Exposure', classification.exposure && classification.exposure !== 'Unknown' ? classification.exposure : null],
            ['Sexual intensity', classification.intensity && classification.intensity !== 'Unknown' ? classification.intensity : null],
          ].filter(([, value]) => value !== null && value !== undefined && value !== '')
          return <>
            <dl className="vault-inv__card-detail-grid">
              {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{detailValue(value)}</dd></div>)}
            </dl>
            {!!(card.creator_name || card.character_name || card.gallery_name) && <p className="vault-inv__card-context">{[card.creator_name, card.character_name, card.gallery_name].filter(Boolean).join(' · ')}</p>}
            {!!detail.tags?.length && <div className="vault-inv__detail-links"><dt>Tags</dt><div>{detail.tags.map(tag => <span key={tag.id || tag.normalized || tag.name}>{tag.name || tag.normalized}</span>)}</div></div>}
            {!!detail.source_links?.length && <div className="vault-inv__detail-links"><dt>Sources</dt><div>{detail.source_links.map(link => <a key={`${link.label}-${link.url}`} href={link.url}>{link.label}</a>)}</div></div>}
          </>
        })()}
      </div>}
      <div className="vault-inv__actions">
        <button type="button" className="vault-inv__ghost" onClick={() => setCardDetailsOpen(open => !open)}>{cardDetailsOpen ? 'Hide Details' : 'View Details'}</button>
        <button type="button" className="vault-inv__place" onClick={() => toast('Walk up to a stand and press E to display this card.')}>Place in Room</button>
      </div>
    </aside>}
    {tab === 'furniture' && activeFurniture && <aside className="vault-inv__detail">
      <div className="vault-inv__detail-head"><h3>{activeFurniture.name}</h3><small>#{String(activeFurniture.instance_id).padStart(3, '0')}</small></div>
      <FurniturePreview item={activeFurniture} className="vault-inv__detail-preview" />
      <p>{FURNITURE_BLURB[activeFurniture.asset_id] || 'Owned furniture. Place it in your room when you are ready.'}</p>
      <div className="vault-inv__tags"><span>{furnitureGroup(activeFurniture.asset_id)}</span><span>{activeFurniture.status === 'placed' ? 'Placed' : 'In inventory'}</span></div>
      <p className="vault-inv__own">You own: 1</p>
      <button type="button" className="vault-inv__place" onClick={() => onPlaceFurniture(activeFurniture.instance_id)}>{activeFurniture.status === 'placed' ? 'Adjust in room' : 'Place in Room'}</button>
      <button type="button" className="vault-inv__ghost" onClick={() => setFurnitureDetailsOpen(open => !open)}><Eye size={16} /> {furnitureDetailsOpen ? 'Hide Details' : 'View Details'}</button>
      {furnitureDetailsOpen && <p className="vault-inv__expanded-detail">{furnitureGroup(activeFurniture.asset_id)} item · {activeFurniture.status === 'placed' ? 'Currently placed in your room.' : 'Ready to place in your room.'}</p>}
    </aside>}
    <button type="button" className="vault-inv__close" onClick={onClose} aria-label="Close inventory"><X size={18} /></button>
    <p className="vault-inv__hint"><kbd>Esc</kbd> Close</p>
    {openingLabel && <div className="vault-inv__busy">{openingLabel}</div>}
  </section>
}

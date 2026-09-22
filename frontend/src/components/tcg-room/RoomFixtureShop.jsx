import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { CreditCard, Gem, Search, SlidersHorizontal } from 'lucide-react'
import { imagesApi, tcgRoomApi } from '../../lib/api'

const ASSET_PRESENTATION = {
  card_display_stand_white: 'Stands',
  card_display_stand_black: 'Stands',
  graded_card_stand_white: 'Stands',
  graded_card_stand_black: 'Stands',
  glass_display_case: 'Cabinets',
  glass_display_cabinet: 'Cabinets',
  floating_glass_cabinet: 'Cabinets',
  poster_frame: 'Wall decor',
}

function furnitureDescription(definition) {
  const assetId = definition.asset_id
  if (assetId === 'poster_frame') return 'A framed print of a photo from your Vault.'
  if (assetId?.includes('graded_card_stand')) return 'Holds 9 cards, 3 per row. Sits on a table or shelf.'
  if (assetId?.includes('card_display_stand')) return 'Holds 1 card. Sits on a table or shelf.'
  if (assetId === 'glass_display_case' || assetId === 'glass_display_cabinet') return 'Free-standing shelf. Card stands can sit inside its shelf levels.'
  if (assetId === 'floating_glass_cabinet') return 'Wall-mounted shelf. Card stands can sit inside its shelf levels.'
  return definition.placement_kind === 'wall' ? 'Mounts on a room wall.' : 'Furniture for the Collection Room.'
}

function vaultThumb(img) {
  if (!img) return ''
  if (img.thumb_url) return img.thumb_url
  if (img.thumb_path) return `/thumbs/${String(img.thumb_path).split(/[\\/]/).pop()}`
  return img.id ? `/api/images/${img.id}/file` : ''
}

function ProductVisual({ definition }) {
  const preview = `/tcg-room/shop/${definition.asset_id}.png`
  const { data: photos = [] } = useQuery({
    queryKey: ['room-poster-preview-photos'],
    queryFn: () => imagesApi.list({ is_video: false, sort_by: 'random', limit: 4 }).then(r => {
      const payload = r.data
      return payload?.images ?? (Array.isArray(payload) ? payload : [])
    }),
    enabled: definition.asset_id === 'poster_frame',
    staleTime: 60_000,
  })
  if (definition.asset_id === 'poster_frame') {
    const shots = photos.filter(img => vaultThumb(img)).slice(0, 3)
    return <div className="furniture-store__visual furniture-store__visual--poster_frame">
      <span>Your photos</span>
      <div className="furniture-store__poster-stack">
        {(shots.length ? shots : [null, null, null]).map((img, index) => (
          <figure key={img?.id || index} className="furniture-store__poster" style={{ transform: `rotate(${(index - 1) * 6}deg)` }}>
            {img ? <img src={vaultThumb(img)} alt="" /> : <i />}
          </figure>
        ))}
      </div>
      <small>Vault photo poster</small>
    </div>
  }
  return <div className={`furniture-store__visual furniture-store__visual--${definition.asset_id}`}>
    <img src={preview} alt={definition.name} className="furniture-store__photo" />
  </div>
}

export default function RoomFixtureShop({ bootstrap, wallet }) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState('featured')
  const [variantByDefinition, setVariantByDefinition] = useState({})
  const definitions = useMemo(() => {
    const seen = new Set()
    return (bootstrap?.catalog || []).filter(item => {
      if (!item.asset_id || !['floor', 'wall'].includes(item.placement_kind) || !ASSET_PRESENTATION[item.asset_id] || seen.has(item.asset_id)) return false
      seen.add(item.asset_id)
      return true
    })
  }, [bootstrap?.catalog])
  const definitionAsset = useMemo(() => new Map((bootstrap?.catalog || []).map(item => [item.id, item.asset_id])), [bootstrap?.catalog])
  const ownedCounts = useMemo(() => (bootstrap?.owned_instances || []).reduce((counts, item) => {
    const assetId = definitionAsset.get(item.definition_id)
    if (!assetId) return counts
    return { ...counts, [assetId]: (counts[assetId] || 0) + 1 }
  }, {}), [bootstrap?.owned_instances, definitionAsset])
  const categories = useMemo(() => [...new Set(definitions.map(item => ASSET_PRESENTATION[item.asset_id] || 'Furniture'))], [definitions])
  const products = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = definitions.filter(item => {
      const room = ASSET_PRESENTATION[item.asset_id] || 'Furniture'
      return (category === 'all' || room === category) && (!needle || `${item.name} ${item.asset_id} ${room}`.toLowerCase().includes(needle))
    })
    if (sort === 'price-low') return [...filtered].sort((a, b) => a.unit_cost - b.unit_cost)
    if (sort === 'price-high') return [...filtered].sort((a, b) => b.unit_cost - a.unit_cost)
    if (sort === 'name') return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
    return filtered
  }, [category, definitions, query, sort])
  const purchase = useMutation({
    mutationFn: ({ definition, requestKey }) => tcgRoomApi.purchaseFurniture({ definition_id: definition.id, variant_key: variantByDefinition[definition.id] || definition.variants?.[0] || 'default', request_key: requestKey }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tcg-room-bootstrap'] }); queryClient.invalidateQueries({ queryKey: ['tcg-room-furniture'] }); queryClient.invalidateQueries({ queryKey: ['tcg-v2-summary'] }); toast.success('Added to Furniture Inventory') },
    onError: error => toast.error(error.response?.data?.detail || 'Could not purchase that furniture'),
  })
  return <section className="furniture-store">
    <header><div><span>ROOM MARKET</span><h2>Display furniture</h2><p>Only pieces from your room file, plus posters printed from Vault photos.</p></div><div className="furniture-store__wallet"><span>Available balance</span><strong>{Number(wallet?.vault_credits || 0).toLocaleString()} Credits</strong><small>{Number(wallet?.shards || 0).toLocaleString()} Shards</small></div></header>
    <div className="furniture-store__toolbar"><label><Search size={19} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search furniture and posters" /></label><label className="furniture-store__sort"><SlidersHorizontal size={18} /> Sort<select value={sort} onChange={event => setSort(event.target.value)}><option value="featured">Featured</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="name">Name</option></select></label></div>
    <nav><button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>All products</button>{categories.map(value => <button key={value} className={category === value ? 'active' : ''} onClick={() => setCategory(value)}>{value}</button>)}</nav>
    <div className="furniture-store__results"><strong>{products.length} products</strong><span>Purchased pieces stay in your Inventory until placed.</span></div>
    <div className="furniture-store__grid">{products.map(definition => <article key={definition.id}>
      <ProductVisual definition={definition} />
      <div className="furniture-store__body"><div className="furniture-store__owned">{ownedCounts[definition.asset_id] ? `${ownedCounts[definition.asset_id]} owned` : 'Not owned'}</div><h3>{definition.name}</h3><p>{furnitureDescription(definition)}</p></div>
      <footer><div><span>Price</span><strong>{definition.unit_cost.toLocaleString()} {definition.currency === 'credits' ? 'Credits' : 'Shards'}</strong></div><button disabled={purchase.isPending} onClick={() => purchase.mutate({ definition, requestKey: crypto.randomUUID() })}>{definition.currency === 'credits' ? <CreditCard size={18} /> : <Gem size={18} />} {purchase.isPending && purchase.variables?.definition.id === definition.id ? 'Adding…' : 'Add to inventory'}</button></footer>
    </article>)}</div>
    {!products.length && <div className="furniture-store__empty">No furniture matches those filters.</div>}
  </section>
}

import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { CreditCard, Gem, Search, SlidersHorizontal } from 'lucide-react'
import { tcgRoomApi } from '../../lib/api'

const ASSET_PRESENTATION = {
  bed_frame: 'Bedroom', nightstand: 'Bedroom', wardrobe: 'Storage', office_chair: 'Seating', dining_chair: 'Seating', area_rug: 'Decor',
  display_stand_single: 'Display', display_stand_triple: 'Display', glass_cabinet_tall: 'Display', glass_cabinet_wide: 'Display', bookshelf_wide: 'Storage',
  bookshelf_narrow: 'Storage', binder_shelf_insert: 'Storage', card_drawer_unit: 'Storage', acrylic_card_case: 'Display',
  card_toploader: 'Display', set_storage_box: 'Storage', poster_frame: 'Wall decor', floating_wall_shelf: 'Wall decor', desk_lamp: 'Lighting',
  wall_frame_portrait: 'Wall decor', led_strip: 'Lighting',
}

function ProductVisual({ definition }) {
  const room = ASSET_PRESENTATION[definition.asset_id] || 'Furniture'
  const preview = `/tcg-room/shop/${definition.asset_id}.png`
  return <div className={`furniture-store__visual furniture-store__visual--${definition.asset_id}`}>
    <span>{room}</span>
    <img src={preview} alt="" className="furniture-store__photo" onError={event => { event.currentTarget.style.display = 'none' }} />
    <small>{definition.asset_id.replaceAll('_', ' ')}</small>
  </div>
}

export default function RoomFixtureShop({ bootstrap, wallet }) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState('featured')
  const [variantByDefinition, setVariantByDefinition] = useState({})
  const definitions = (bootstrap?.catalog || []).filter(item => item.asset_id && ['floor', 'wall'].includes(item.placement_kind))
  const ownedCounts = useMemo(() => (bootstrap?.owned_instances || []).reduce((counts, item) => ({ ...counts, [item.definition_id]: (counts[item.definition_id] || 0) + 1 }), {}), [bootstrap?.owned_instances])
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
    <header><div><span>ROOM MARKET</span><h2>Make the room yours</h2><p>Furniture is delivered to Inventory, ready for you to place.</p></div><div className="furniture-store__wallet"><span>Available balance</span><strong>{Number(wallet?.vault_credits || 0).toLocaleString()} Credits</strong><small>{Number(wallet?.shards || 0).toLocaleString()} Shards</small></div></header>
    <div className="furniture-store__toolbar"><label><Search size={19} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search furniture and decor" /></label><label className="furniture-store__sort"><SlidersHorizontal size={18} /> Sort<select value={sort} onChange={event => setSort(event.target.value)}><option value="featured">Featured</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="name">Name</option></select></label></div>
    <nav><button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>All products</button>{categories.map(value => <button key={value} className={category === value ? 'active' : ''} onClick={() => setCategory(value)}>{value}</button>)}</nav>
    <div className="furniture-store__results"><strong>{products.length} products</strong><span>Purchased pieces stay in your Inventory until placed.</span></div>
    <div className="furniture-store__grid">{products.map(definition => <article key={definition.id}>
      <ProductVisual definition={definition} />
      <div className="furniture-store__body"><div className="furniture-store__owned">{ownedCounts[definition.id] ? `${ownedCounts[definition.id]} owned` : 'Not owned'}</div><h3>{definition.name}</h3><p>{definition.placement_kind === 'wall' ? 'Mounts securely on a room wall.' : 'Freestanding piece for manual placement.'}</p>{definition.variants?.length > 1 ? <label>Finish<select value={variantByDefinition[definition.id] || definition.variants[0]} onChange={event => setVariantByDefinition(current => ({ ...current, [definition.id]: event.target.value }))}>{definition.variants.map(variant => <option key={variant} value={variant}>{variant}</option>)}</select></label> : <span>{definition.variants?.[0] || 'Standard finish'}</span>}</div>
      <footer><div><span>Price</span><strong>{definition.unit_cost.toLocaleString()} {definition.currency === 'credits' ? 'Credits' : 'Shards'}</strong></div><button disabled={purchase.isPending} onClick={() => purchase.mutate({ definition, requestKey: crypto.randomUUID() })}>{definition.currency === 'credits' ? <CreditCard size={18} /> : <Gem size={18} />} {purchase.isPending && purchase.variables?.definition.id === definition.id ? 'Adding…' : 'Add to inventory'}</button></footer>
    </article>)}</div>
    {!products.length && <div className="furniture-store__empty">No furniture matches those filters.</div>}
  </section>
}

import { useMemo, useState } from 'react'
import { CheckCircle2, Clock3, PackageOpen, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react'

const WRAPPERS = {
  permanent: '/tcg-booster-permanent-cutout.png',
  release_standard: '/tcg-booster-standard-cutout.png',
  release_premium: '/tcg-booster-premium-cutout.png',
  limited: '/tcg-booster-limited-cutout.png',
  weekly_protection: '/tcg-booster-limited-cutout.png',
}

const LABELS = {
  permanent: 'Permanent range', release_standard: 'Standard release',
  release_premium: 'Premium release', limited: 'Limited edition',
  weekly_protection: 'Weekly reward',
}

function guarantee(pack) {
  const values = (pack.guaranteed_slots || []).map(value => String(value).toUpperCase())
  const rarity = ['SPR', 'UR', 'SR', 'R', 'C'].find(value => values.some(slot => slot === value || slot.startsWith(`${value}_`)))
  if (rarity) return `${values.filter(slot => slot === rarity || slot.startsWith(`${rarity}_`)).length} ${rarity} guaranteed`
  return pack.rarity_floor ? `1 ${pack.rarity_floor} guaranteed` : 'Published odds'
}

export default function RoomOnlineStore({ packs, releases, productImages = [], pending, pendingPackId, onOrder }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState('featured')
  const [releaseByPack, setReleaseByPack] = useState({})
  const categories = useMemo(() => [...new Set(packs.map(pack => pack.product_kind))], [packs])
  const products = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const filtered = packs.filter(pack => (category === 'all' || pack.product_kind === category) && (!normalized || `${pack.name} ${pack.pool_summary || ''}`.toLowerCase().includes(normalized)))
    if (sort === 'price-low') return [...filtered].sort((a, b) => Number(a.price || 0) - Number(b.price || 0))
    if (sort === 'price-high') return [...filtered].sort((a, b) => Number(b.price || 0) - Number(a.price || 0))
    return filtered
  }, [category, packs, query, sort])

  return <section className="room-store">
    <header className="room-store__masthead">
      <div><span>VAULT ONLINE</span><strong>Booster Packs</strong></div>
      <label><Search size={19} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search packs" /></label>
      <div className="room-store__account"><span>Secure delivery</span><strong>To your room</strong></div>
    </header>
    <div className="room-store__controls">
      <div><button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>All packs</button>{categories.map(value => <button key={value} className={category === value ? 'active' : ''} onClick={() => setCategory(value)}>{LABELS[value] || value.replaceAll('_', ' ')}</button>)}</div>
      <label><SlidersHorizontal size={18} /> Sort<select value={sort} onChange={event => setSort(event.target.value)}><option value="featured">Featured</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></select></label>
    </div>
    <div className="room-store__results"><strong>{products.length} booster packs</strong><span>Orders arrive sealed in your inventory</span></div>
    <div className="room-store__grid">{products.map(pack => {
      const weekly = pack.product_kind === 'weekly_protection'
      const available = Boolean(pack.active && (pack.purchasable || pack.tokens > 0))
      const releaseId = releaseByPack[pack.id] || ''
      return <article key={pack.id} className={!available ? 'unavailable' : ''}>
        <div className="room-store__product-image"><span>{LABELS[pack.product_kind] || 'Booster pack'}</span><img src={pack.wrapper_src || WRAPPERS[pack.product_kind] || WRAPPERS.permanent} alt="" />{productImages.length > 0 && <img className="room-store__product-art" src={productImages[pack.id % productImages.length]} alt="" />}</div>
        <div className="room-store__product-body">
          <h2>{pack.name}</h2>
          <p>{pack.pool_summary || pack.release_name || 'Published cards from the Vault catalogue'}</p>
          <ul><li><PackageOpen size={18} /><strong>{pack.card_count} cards</strong></li><li><ShieldCheck size={18} /><strong>{guarantee(pack)}</strong></li><li>{available ? <CheckCircle2 size={18} /> : <Clock3 size={18} />}<strong>{available ? 'Available now' : 'Not currently scheduled'}</strong></li></ul>
          {weekly && pack.tokens > 0 && <label className="room-store__release">Choose release<select value={releaseId} onChange={event => setReleaseByPack(current => ({ ...current, [pack.id]: Number(event.target.value) }))}><option value="">Select a frozen release</option>{releases.filter(item => item.status === 'published').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          <div className="room-store__buy"><div><span>Price</span><strong>{weekly ? 'Quest reward' : `${Number(pack.price || 0).toLocaleString()} Credits`}</strong></div><button disabled={!available || pending || (weekly && !releaseId)} onClick={() => onOrder(pack, releaseId || null)}>{pending && pendingPackId === pack.id ? 'Ordering...' : 'Order online'}</button></div>
        </div>
      </article>
    })}</div>
    {!products.length && <div className="room-store__empty">No packs match these filters.</div>}
  </section>
}

import { LocalizedText, useT } from '../../i18n'
import { useMemo, useState } from 'react'
import { Coins, Gem, Search, SlidersHorizontal } from 'lucide-react'
import RoomFixtureShop, { ASSET_PRESENTATION, getFurnitureDefinitions } from './RoomFixtureShop'
import RoomOnlineStore from './RoomOnlineStore'

const PACK_LABELS = {
  permanent: 'Permanent range',
  release_standard: 'Standard release',
  release_premium: 'Premium release',
  limited: 'Limited edition',
  weekly_protection: 'Weekly reward',
}

export default function RoomShop({ packs, releases, productImages, pending, pendingPackId, onOrder, bootstrap, wallet }) {
  const t = useT()
  const [family, setFamily] = useState('all')
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('featured')
  const definitions = useMemo(() => getFurnitureDefinitions(bootstrap?.catalog || []), [bootstrap?.catalog])
  const packCategories = useMemo(() => [...new Set(packs.map(pack => pack.product_kind))], [packs])
  const furnitureCategories = useMemo(() => [...new Set(definitions.map(item => ASSET_PRESENTATION[item.asset_id]))], [definitions])
  const normalized = query.trim().toLowerCase()
  const visiblePackCount = family === 'furniture' ? 0 : packs.filter(pack =>
    (family !== 'packs' || category === 'all' || pack.product_kind === category) &&
    (!normalized || `${pack.name} ${pack.pool_summary || ''}`.toLowerCase().includes(normalized))
  ).length
  const visibleFurnitureCount = family === 'packs' ? 0 : definitions.filter(item => {
    const room = ASSET_PRESENTATION[item.asset_id] || 'Furniture'
    return (family !== 'furniture' || category === 'all' || room === category) &&
      (!normalized || `${item.name} ${item.asset_id} ${room}`.toLowerCase().includes(normalized))
  }).length
  const visibleCount = visiblePackCount + visibleFurnitureCount
  const changeFamily = value => { setFamily(value); setCategory('all') }
  const subcategories = family === 'packs' ? packCategories : family === 'furniture' ? furnitureCategories : []

  return <section className="room-shop">
    <header className="room-shop__masthead">
      <div><span><LocalizedText text={"ROOM MARKET"} /></span><h1><LocalizedText text={"Shop"} /></h1><p><LocalizedText text={"Booster packs and display furniture for your room."} /></p></div>
      <div className="room-shop__wallet"><span><LocalizedText text={"Available balance"} /></span><strong><Coins size={20} />{Number(wallet?.vault_credits || 0).toLocaleString()}<LocalizedText text={"Credits"} before={" "} /></strong><small><Gem size={17} />{Number(wallet?.shards || 0).toLocaleString()}<LocalizedText text={"Shards"} before={" "} /></small></div>
    </header>
    <div className="room-shop__toolbar">
      <label><Search size={19} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("Search packs, furniture, and posters")} /></label>
      <label className="room-shop__sort"><SlidersHorizontal size={18} /><LocalizedText text={"Sort"} before={" "} /><select value={sort} onChange={event => setSort(event.target.value)}><option value="featured"><LocalizedText text={"Featured"} /></option><option value="price-low"><LocalizedText text={"Price: low to high"} /></option><option value="price-high"><LocalizedText text={"Price: high to low"} /></option><option value="name"><LocalizedText text={"Name"} /></option></select></label>
    </div>
    <nav className="room-shop__families" aria-label={t("Shop product families")}>
      <button className={family === 'all' ? 'active' : ''} onClick={() => changeFamily('all')}><LocalizedText text={"All products"} /></button>
      <button className={family === 'packs' ? 'active' : ''} onClick={() => changeFamily('packs')}><LocalizedText text={"Booster Packs"} /></button>
      <button className={family === 'furniture' ? 'active' : ''} onClick={() => changeFamily('furniture')}><LocalizedText text={"Furniture"} /></button>
    </nav>
    {family !== 'all' && <nav className="room-shop__subcategories" aria-label={t("Shop categories")}>
      <button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}><LocalizedText text={family === 'packs' ? "All packs" : "All furniture"} /></button>
      {subcategories.map(value => <button key={value} className={category === value ? 'active' : ''} onClick={() => setCategory(value)}><LocalizedText text={PACK_LABELS[value] || value} /></button>)}
    </nav>}
    <div className="room-shop__results"><strong>{visibleCount}<LocalizedText text={"products"} before={" "} /></strong><span>{visibleCount ? <LocalizedText text={"Select an item to order it into your room or inventory."} /> : <LocalizedText text={"No products match these filters."} />}</span></div>
    <div hidden={family === 'furniture'} aria-hidden={family === 'furniture'}><RoomOnlineStore packs={packs} releases={releases} productImages={productImages} pending={pending} pendingPackId={pendingPackId} onOrder={onOrder} query={query} category={family === 'packs' ? category : 'all'} sort={sort} /></div>
    <div hidden={family === 'packs'} aria-hidden={family === 'packs'}><RoomFixtureShop bootstrap={bootstrap} query={query} category={family === 'furniture' ? category : 'all'} sort={sort} /></div>
  </section>
}

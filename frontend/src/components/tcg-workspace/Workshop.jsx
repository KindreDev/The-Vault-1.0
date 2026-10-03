import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Coins, Minus, PackageOpen, Plus, ShoppingCart, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { tcgV2Api } from '../../lib/api'
import { pendingPackPurchase } from '../../lib/packPurchase'
import { useT } from '../../i18n'
import { BINDER_PRODUCTS, PACK_WRAPPERS, priceCart } from './shopCatalog'
import { checkoutCart } from './shopCheckout'
import { sampleBoosterArt } from './boosterArt'
import TargetCardTypePicker from './TargetCardTypePicker'
import './collection-shop.css'

function ProductArt({ product }) {
  const candidates = product.preview_art_urls || []
  const [preview, setPreview] = useState(() => sampleBoosterArt(candidates, 1)[0] || null)
  useEffect(() => {
    const rotate = () => setPreview(sampleBoosterArt(candidates, 1)[0] || null)
    rotate()
    const timer = window.setInterval(rotate, 5200)
    return () => window.clearInterval(timer)
  }, [candidates])
  return <div className={`collection-shop-art ${product.kind === 'binders' ? 'is-binder' : 'is-booster'}`}>
    {product.kind === 'binders' ? <div className="collection-shop-book" style={{ backgroundImage: `url(${product.image})` }}><span /><BookOpen size={38} /></div>
      : <div className="collection-shop-wrapper"><img src={product.wrapper_src || PACK_WRAPPERS[product.product_kind] || PACK_WRAPPERS.permanent} alt="" />{preview && <img className="collection-shop-pack-art" src={preview} alt="" />}</div>}
  </div>
}

export default function Workshop({ packs = [], releases = [], onOpenedPacks, onBusyChange, onProgress }) {
  const t = useT()
  const qc = useQueryClient()
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState('featured')
  const [cart, setCart] = useState([])
  const [releaseIds, setReleaseIds] = useState({})
  const [targetTypes, setTargetTypes] = useState({})
  const [pending, setPending] = useState(false)
  const [progress, setProgress] = useState('')
  const [unfinished, setUnfinished] = useState(() => pendingPackPurchase())
  const checkoutLock = useRef(false)
  const { data: shop, isLoading, isError, refetch } = useQuery({ queryKey: ['tcg-v2-workshop'], queryFn: () => tcgV2Api.workshop().then(r => r.data) })
  const { data: binders, isLoading: bindersLoading, isError: bindersError, refetch: retryBinders } = useQuery({ queryKey: ['tcg-v2-binders'], queryFn: () => tcgV2Api.binders().then(r => r.data) })
  const products = [...packs.map(pack => ({ ...pack, key: `pack-${pack.id}`, kind: 'packs' })), ...BINDER_PRODUCTS]
  const visible = products.filter(product => category === 'all' || product.kind === category)
  if (sort === 'price-low') visible.sort((a, b) => a.price - b.price)
  if (sort === 'price-high') visible.sort((a, b) => b.price - a.price)
  if (sort === 'name') visible.sort((a, b) => a.name.localeCompare(b.name))
  const lines = priceCart(cart.map(line => ({ ...line, product: products.find(product => product.key === line.product.key) || line.product })), binders?.length ?? 1)
  const total = lines.reduce((sum, line) => sum + line.total, 0)
  const count = cart.reduce((sum, line) => sum + line.quantity, 0)
  const credits = Number(shop?.vault_credits || 0)
  const ready = !isLoading && !bindersLoading && !isError && !bindersError

  function changeQuantity(key, delta) {
    setCart(current => current.map(line => line.key === key ? { ...line, quantity: Math.max(0, line.quantity + delta) } : line).filter(line => line.quantity > 0))
  }
  function add(product) {
    const releaseId = releaseIds[product.id] || null
    const targetCardType = product.targetable_card_type ? (targetTypes[product.id] || null) : null
    const key = `${product.key}-${releaseId || ''}-${targetCardType || ''}`
    setCart(current => current.some(line => line.key === key) ? current.map(line => line.key === key ? { ...line, quantity: line.quantity + 1 } : line) : [...current, { key, product, releaseId, targetCardType, quantity: 1 }])
  }
  function canAdd(product) {
    if (product.kind === 'binders') return true
    if (!product.active) return false
    const inCart = cart.filter(line => line.product.key === product.key).reduce((sum, line) => sum + line.quantity, 0)
    return (product.purchasable || Number(product.tokens || 0) > inCart) && (product.product_kind !== 'weekly_protection' || releaseIds[product.id])
  }
  async function buyPack(product) {
    if (checkoutLock.current || unfinished || !ready || !canAdd(product)) return
    if (!product.tokens && Number(product.price || 0) > credits) {
      toast.error(t('Not enough Credits'))
      return
    }
    checkoutLock.current = true
    setPending(true)
    onProgress?.(t('Preparing {name}', { name: product.name }))
    onBusyChange?.(true)
    const opened = []
    try {
      await checkoutCart([{ key: product.key, product, releaseId: releaseIds[product.id] || null, targetCardType: product.targetable_card_type ? (targetTypes[product.id] || null) : null, quantity: 1, free: product.tokens > 0 ? 1 : 0 }], tcgV2Api, () => {}, () => {}, opened)
      onOpenedPacks?.(opened)
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || t('Could not open booster'))
    } finally {
      setUnfinished(pendingPackPurchase())
      setPending(false)
      onBusyChange?.(false)
      // Keep the click guard until the refreshed balance and tokens arrive.
      await Promise.allSettled(['tcg-v2-workshop', 'tcg-v2-summary', 'tcg-v2-packs', 'tcg-v2-catalog', 'profile'].map(key => qc.invalidateQueries({ queryKey: [key] })))
      checkoutLock.current = false
    }
  }
  async function checkout() {
    if (checkoutLock.current || unfinished || !ready || !count || total > credits) return
    checkoutLock.current = true
    setPending(true)
    onBusyChange?.(true)
    const opened = []
    let completed = 0
    try {
      await checkoutCart(lines, tcgV2Api, key => {
        completed++
        changeQuantity(key, -1)
      }, (name, current, total) => { const message = t('Preparing {name} ({current}/{total})', { name, current, total }); setProgress(message); onProgress?.(message) }, opened)
      toast.success(t('Purchase complete'))
    } catch (error) {
      toast.error(`${error.response?.data?.detail || error.message || t('Checkout could not finish')}. ${t('{count} items completed; remaining items are in your cart.', { count: completed })}`)
    } finally {
      setUnfinished(pendingPackPurchase())
      await Promise.all(['tcg-v2-binders', 'tcg-v2-workshop', 'tcg-v2-summary', 'tcg-v2-packs', 'tcg-v2-catalog', 'profile'].map(key => qc.invalidateQueries({ queryKey: [key] })))
      setPending(false)
      onBusyChange?.(false)
      checkoutLock.current = false
      setProgress('')
      if (opened.length) onOpenedPacks?.(opened)
    }
  }

  async function resumePurchase() {
    if (checkoutLock.current || !unfinished) return
    checkoutLock.current = true
    setPending(true)
    onBusyChange?.(true)
    onProgress?.(t('Recovering booster purchase…'))
    try {
      const { data } = await tcgV2Api.openPack(unfinished.productId, unfinished.data)
      const product = { ...data.product, wrapper_src: PACK_WRAPPERS[data.product.product_kind] }
      // A recovered cart unit must not be purchased again on the next checkout.
      changeQuantity(`pack-${unfinished.productId}-${unfinished.data.selected_release_id || ''}-${unfinished.data.target_card_type || ''}`, -1)
      onOpenedPacks?.([{ product, cards: data.cards || [] }])
      toast.success(t('Purchase recovered'))
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || t('Could not open booster'))
    } finally {
      setUnfinished(pendingPackPurchase())
      await Promise.allSettled(['tcg-v2-workshop', 'tcg-v2-summary', 'tcg-v2-packs', 'tcg-v2-catalog', 'profile'].map(key => qc.invalidateQueries({ queryKey: [key] })))
      setPending(false)
      onBusyChange?.(false)
      checkoutLock.current = false
    }
  }

  return <section className="collection-shop" aria-label={t('Collection shop')}>
    <div className="collection-shop-catalog">
      {unfinished && <p role="status">{t('A booster purchase needs recovery. Resume it to retrieve the same cards without paying twice.')} <button disabled={pending} onClick={resumePurchase}>{t('Resume purchase')}</button></p>}
      <div className="collection-shop-toolbar">
        <nav aria-label={t('Shop categories')}>{[['all', 'All', ShoppingCart], ['packs', 'Booster Packs', PackageOpen], ['binders', 'Binders', BookOpen]].map(([id, label, Icon]) => <button key={id} aria-pressed={category === id} className={category === id ? 'active' : ''} onClick={() => setCategory(id)}><Icon size={18} />{t(label)}</button>)}</nav>
        <select aria-label={t('Sort products')} value={sort} onChange={event => setSort(event.target.value)}><option value="featured">{t('Featured')}</option><option value="price-low">{t('Price: low to high')}</option><option value="price-high">{t('Price: high to low')}</option><option value="name">{t('Name')}</option></select>
      </div>
      {(isError || bindersError) && <p role="alert">{t('Could not load shop balances.')} <button onClick={() => { refetch(); retryBinders() }}>{t('Retry')}</button></p>}
      <div className="collection-shop-grid">{visible.map(product => {
        const binder = product.kind === 'binders'
        const weekly = product.product_kind === 'weekly_protection'
        const available = binder || (product.active && (product.purchasable || product.tokens > 0))
        return <article className="collection-shop-product" key={product.key}>
          <ProductArt product={product} />
          <div className="collection-shop-product-body">
            <h2>{t(product.name)}</h2>
            <p>{binder ? t(product.description) : `${product.card_count} ${t('cards')} · ${product.pool_summary || t('Published Vault pool')}`}</p>
            {!binder && <details><summary>{t('Pack details & odds')}</summary><p>{(product.guaranteed_slots || []).join(', ').replaceAll('_', ' ') || t('Published odds')}</p><div>{Object.entries(product.odds?.weighted_slots || product.odds || {}).filter(([, value]) => typeof value === 'number').map(([rarity, value], _, odds) => <span key={rarity}>{rarity}: {(value / (odds.reduce((sum, [, weight]) => sum + weight, 0) || 1) * 100).toFixed(1)}% </span>)}</div></details>}
            {product.targetable_card_type && <TargetCardTypePicker value={targetTypes[product.id] || ''} onChange={value => setTargetTypes(current => ({ ...current, [product.id]: value }))} id={`shop-target-${product.id}`} />}
            {weekly && product.tokens > 0 && <select aria-label={t('Choose release')} value={releaseIds[product.id] || ''} onChange={event => setReleaseIds(current => ({ ...current, [product.id]: Number(event.target.value) }))}><option value="">{t('Choose release')}</option>{releases.filter(release => release.status === 'published').map(release => <option value={release.id} key={release.id}>{release.name}</option>)}</select>}
            <div className="collection-shop-price"><Coins size={19} /><strong>{weekly ? t('Quest reward') : Number(product.price || 0).toLocaleString()}</strong>{!weekly && <span>{t('Vault Credits')}</span>}</div>
            {binder && binders?.length === 0 && <span className="collection-shop-note">{t('Your first binder is free')}</span>}
            {!binder && product.tokens > 0 && <span className="collection-shop-note">{t('{count} reward tokens available', { count: product.tokens })}</span>}
            <button className="collection-shop-buy" disabled={pending || Boolean(unfinished) || !ready || !canAdd(product)} onClick={() => binder ? add(product) : buyPack(product)}>{binder ? <ShoppingCart size={18} /> : <PackageOpen size={18} />}{t(available ? binder ? 'Add to Cart' : 'Buy' : weekly ? 'Weekly quest reward' : 'Unavailable')}</button>
          </div>
        </article>
      })}</div>
      {!visible.length && <p>{t('No products available in this category.')}</p>}
    </div>
    <aside className="collection-shop-cart" aria-label={t('Your Cart')}>
      <header><ShoppingCart size={22} /><h2>{t('Your Cart')}</h2><span>{count}</span><button disabled={pending || Boolean(unfinished) || !count} onClick={() => setCart([])}>{t('Clear')}</button></header>
      <div className="collection-shop-cart-lines">{lines.map(line => <article key={line.key}>
        <ProductArt product={line.product} />
        <div><h3>{t(line.product.name)}</h3>{line.releaseId && <p>{releases.find(release => release.id === line.releaseId)?.name}</p>}{line.targetCardType && <p>{t('Target')}: {t(({ image: 'Photo', variant: 'Cosplay' })[line.targetCardType] || line.targetCardType)}</p>}<strong>{line.total.toLocaleString()} {t('Credits')}</strong>
          <div className="collection-shop-quantity"><button disabled={pending} aria-label={t('Decrease {name} quantity', { name: line.product.name })} onClick={() => changeQuantity(line.key, -1)}><Minus size={16} /></button><span>{line.quantity}</span><button disabled={pending || Boolean(unfinished) || (line.product.kind === 'packs' && !line.product.purchasable && cart.filter(item => item.product.key === line.product.key).reduce((sum, item) => sum + item.quantity, 0) >= Number(line.product.tokens || 0))} aria-label={t('Increase {name} quantity', { name: line.product.name })} onClick={() => changeQuantity(line.key, 1)}><Plus size={16} /></button><button disabled={pending} aria-label={t('Remove {name}', { name: line.product.name })} onClick={() => setCart(current => current.filter(item => item.key !== line.key))}><Trash2 size={17} /></button></div>
        </div>
      </article>)}</div>
      {!count && <p className="collection-shop-empty">{t('A new favorite belongs here. Add binders to get started.')}</p>}
      <footer><div><span>{t('Total')}</span><strong>{total.toLocaleString()} {t('Credits')}</strong></div><p>{ready ? `${credits.toLocaleString()} ${t('Credits available')}` : t('Loading balance...')}</p>{lines.some(line => line.free > 0 && line.product.kind === 'binders') && <p>{t('First binder discount applied.')}</p>}{lines.some(line => line.free > 0 && line.product.kind === 'packs') && <p>{t('Reward tokens applied.')}</p>}<button className="collection-shop-buy" disabled={pending || Boolean(unfinished) || !ready || !count || total > credits} onClick={checkout}><ShoppingCart size={20} />{t(pending ? 'Preparing your purchase...' : total > credits ? 'Not enough Credits' : 'Checkout')}</button><p aria-live="polite">{progress}</p></footer>
    </aside>
  </section>
}

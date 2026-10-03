import { LocalizedText } from '../../i18n'
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Clock3, Coins, PackageOpen, ShieldCheck, Sparkles } from 'lucide-react'
import { sampleBoosterArt } from '../tcg-workspace/boosterArt'
import TargetCardTypePicker from '../tcg-workspace/TargetCardTypePicker'

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

const WRAPPER_KIND = {
  permanent: 'permanent',
  release_standard: 'standard',
  release_premium: 'premium',
  limited: 'limited',
  weekly_protection: 'limited',
}

function guarantee(pack) {
  const values = (pack.guaranteed_slots || []).map(value => String(value).toUpperCase())
  const rarity = ['SPR', 'UR', 'SR', 'R', 'C'].find(value => values.some(slot => slot === value || slot.startsWith(`${value}_`)))
  if (rarity) return `${values.filter(slot => slot === rarity || slot.startsWith(`${rarity}_`)).length} ${rarity} guaranteed`
  return pack.rarity_floor ? `1 ${pack.rarity_floor} guaranteed` : 'Published odds'
}

function RotatingProductArt({ candidates }) {
  const [image, setImage] = useState(() => sampleBoosterArt(candidates, 1)[0] || null)
  useEffect(() => {
    const rotate = () => setImage(sampleBoosterArt(candidates, 1)[0] || null)
    rotate()
    const timer = window.setInterval(rotate, 5200)
    return () => window.clearInterval(timer)
  }, [candidates])
  return image ? <img className="room-store__product-art" src={image} alt="" /> : null
}

export default function RoomOnlineStore({ packs, releases, productImages = [], pending, pendingPackId, onOrder, query = '', category = 'all', sort = 'featured' }) {
  const [releaseByPack, setReleaseByPack] = useState({})
  const [targetByPack, setTargetByPack] = useState({})
  const products = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const filtered = packs.filter(pack => (category === 'all' || pack.product_kind === category) && (!normalized || `${pack.name} ${pack.pool_summary || ''}`.toLowerCase().includes(normalized)))
    if (sort === 'price-low') return [...filtered].sort((a, b) => Number(a.price || 0) - Number(b.price || 0))
    if (sort === 'price-high') return [...filtered].sort((a, b) => Number(b.price || 0) - Number(a.price || 0))
    if (sort === 'name') return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
    return filtered
  }, [category, packs, query, sort])

  return <section className="room-store room-store--embedded">
    {products.length > 0 && <h2 className="room-store__section-title"><LocalizedText text={"Booster Packs"} /><span>{products.length}</span></h2>}
    <div className="room-store__grid">{products.map(pack => {
      const weekly = pack.product_kind === 'weekly_protection'
      const available = Boolean(pack.active && (pack.purchasable || pack.tokens > 0))
      const releaseId = releaseByPack[pack.id] || ''
      const selectedPreview = pack.preview_art_urls_by_release?.[String(releaseId)]
      const previewImages = weekly ? (releaseId ? (selectedPreview || []) : []) : (pack.preview_art_urls || [])
      const safePreviewImages = [...new Set((previewImages || []).filter(Boolean))]
      const wrapperKind = WRAPPER_KIND[pack.product_kind] || 'standard'
      return <article key={pack.id} className={!available ? 'unavailable' : ''}>
        <div className={`room-store__product-image room-store__product-image--${wrapperKind}`}><span className={`room-store__product-kind-badge${pack.product_kind === 'release_premium' ? ' room-store__product-kind-badge--premium' : ''}`}>{LABELS[pack.product_kind] || 'Booster pack'}</span><div className="room-store__wrapper-stage"><img className="room-store__wrapper" src={pack.wrapper_src || WRAPPERS[pack.product_kind] || WRAPPERS.permanent} alt="" /><RotatingProductArt candidates={safePreviewImages} /></div></div>
        <div className="room-store__product-body">
          <h2>{pack.name}</h2>
          <ul><li><PackageOpen size={18} /><strong>{pack.card_count}<LocalizedText text={"cards"} before={" "} /></strong></li><li><ShieldCheck size={18} /><strong>{guarantee(pack)}</strong></li></ul>
          <div className={`room-store__availability${available ? ' is-available' : ''}`}>{available ? <CheckCircle2 size={17} /> : <Clock3 size={17} />}<strong>{available ? <LocalizedText text={"Available now"} /> : <LocalizedText text={"Not currently scheduled"} />}</strong></div>
          {weekly && pack.tokens > 0 && <label className="room-store__release"><LocalizedText text={"Choose release"} /><select value={releaseId} onChange={event => setReleaseByPack(current => ({ ...current, [pack.id]: Number(event.target.value) }))}><option value=""><LocalizedText text={"Select a frozen release"} /></option>{releases.filter(item => item.status === 'published').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          {pack.targetable_card_type && <TargetCardTypePicker value={targetByPack[pack.id] || ''} onChange={value => setTargetByPack(current => ({ ...current, [pack.id]: value }))} id={`room-target-${pack.id}`} />}
          <div className="room-store__buy"><span><LocalizedText text={"Price"} /></span><strong>{weekly ? <><Sparkles size={18} /> <LocalizedText text={"Quest reward"} /></> : <><Coins size={19} /> {Number(pack.price || 0).toLocaleString()} <LocalizedText text={"Credits"} before={" "} /></>}</strong><button disabled={!available || pending || (weekly && !releaseId)} onClick={() => onOrder(pack, releaseId || null, pack.targetable_card_type ? targetByPack[pack.id] || null : null)}>{pending && pendingPackId === pack.id ? 'Ordering...' : 'Order online'}</button></div>
        </div>
      </article>
    })}</div>
  </section>
}

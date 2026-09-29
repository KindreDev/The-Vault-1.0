import { LocalizedText, useT } from '../../i18n'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, Frame, Gem, LampDesk, Layers, LockKeyhole, Package, Shield, ShoppingBag } from 'lucide-react'
import toast from 'react-hot-toast'
import { tcgV2Api } from '../../lib/api'
import './tcg-shop-binder.css'

const ICONS = { sleeve: Layers, premium_sleeve: Gem, case: Shield, stand: LampDesk, binder_cover: Box, wall_frame: Frame, room_light: LampDesk }
const MATERIALS = [
  ['obsidian', 'Obsidian leather', '/binder-obsidian-leather.png'],
  ['canvas-violet', 'Violet canvas', '/binder-canvas-violet.png'],
  ['opaline', 'Opaline vinyl', '/binder-opaline.png'],
  ['rose-metal', 'Rose metal', '/binder-rose-metal.png'],
]

export default function Workshop() {
  const t = useT()
  const qc = useQueryClient()
  const [showBinderPurchase, setShowBinderPurchase] = useState(false)
  const [binderName, setBinderName] = useState('')
  const [binderMaterial, setBinderMaterial] = useState('obsidian')
  const { data: shop, isLoading } = useQuery({ queryKey: ['tcg-v2-workshop'], queryFn: () => tcgV2Api.workshop().then(r => r.data) })
  const { data: binders = [] } = useQuery({ queryKey: ['tcg-v2-binders'], queryFn: () => tcgV2Api.binders().then(r => r.data) })
  const unlock = useMutation({ mutationFn: id => tcgV2Api.unlockWorkshopItem(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['tcg-v2-workshop'] }); toast.success(t("Display item unlocked")) }, onError: e => toast.error(e.response?.data?.detail || t("Could not unlock item")) })
  const buyBinder = useMutation({
    mutationFn: () => tcgV2Api.createBinder({ name: binderName.trim(), cover_style: binderMaterial, page_style: 'nine-pocket' }),
    onSuccess: () => { setBinderName(''); setShowBinderPurchase(false); qc.invalidateQueries({ queryKey: ['tcg-v2-binders'] }); qc.invalidateQueries({ queryKey: ['tcg-v2-workshop'] }); qc.invalidateQueries({ queryKey: ['tcg-v2-summary'] }); toast.success(t("Binder added to your shelf")) },
    onError: e => toast.error(e.response?.data?.detail || t("Could not purchase binder")),
  })
  const binderPrice = binders.length ? 1200 : 0
  const credits = Number(shop?.vault_credits || 0)
  return <section className="tcgws-workshop tcgws-shop-page">
    <header><div><span><LocalizedText text={"Physical collection customization"} /></span><h1><LocalizedText text={"Shop"} /></h1><p><LocalizedText text={"Use Shards for display pieces and Vault Credits for new binders. Published cards are never created or upgraded here."} /></p></div><div className="tcgws-shop-balances"><strong><Gem size={19} />{Number(shop?.shards || 0).toLocaleString()}<LocalizedText text={"Shards"} before={" "} /></strong><strong><ShoppingBag size={19} />{credits.toLocaleString()}<LocalizedText text={"Credits"} before={" "} /></strong></div></header>
    <section className="tcgws-shop-binder-row">
      <div className="tcgws-shop-binder-art"><Package size={42} /><span>{binders.length ? `${binders.length} binders on your shelf` : 'One free binder to begin'}</span></div>
      <div className="tcgws-shop-binder-copy"><span><LocalizedText text={"Binder collection"} /></span><h2>{binders.length ? 'Add another binder' : 'Claim your first binder'}</h2><p>{binderPrice ? 'Give another collection its own material cover and shelf space.' : 'Start your physical collection with a free nine-pocket binder.'}</p><strong>{binderPrice ? `${binderPrice.toLocaleString()} Vault Credits` : 'Free'}</strong></div>
      <button className="tcgws-primary" onClick={() => setShowBinderPurchase(value => !value)}><ShoppingBag size={18} />{showBinderPurchase ? 'Close' : binderPrice ? 'Buy binder' : 'Claim binder'}</button>
    </section>
    {showBinderPurchase && <section className="tcgws-binder-purchase"><div><span><LocalizedText text={"Binder order"} /></span><h2><LocalizedText text={"Choose its first look"} /></h2><p>{credits.toLocaleString()}<LocalizedText text={"Vault Credits available"} before={" "} /></p></div><label><span><LocalizedText text={"Binder name"} /></span><input value={binderName} onChange={event => setBinderName(event.target.value)} placeholder={t("My favorites")} /></label><div className="tcgws-shop-materials">{MATERIALS.map(([id, label, url]) => <button key={id} className={binderMaterial === id ? 'active' : ''} onClick={() => setBinderMaterial(id)} style={{ backgroundImage: `url(${url})` }}><span>{label}</span></button>)}</div><button className="tcgws-primary" disabled={!binderName.trim() || buyBinder.isPending || (binderPrice > 0 && credits < binderPrice)} onClick={() => buyBinder.mutate()}>{buyBinder.isPending ? 'Preparing binder...' : binderPrice ? `Purchase for ${binderPrice.toLocaleString()} Credits` : 'Claim free binder'}</button></section>}
    <div className="tcgws-shop-items">{isLoading ? <div className="tcgws-shop-loading"><i /><span><LocalizedText text={"Loading the shop..."} /></span></div> : (shop?.items || []).map(item => { const Icon = ICONS[item.type] || ShoppingBag; return <article key={item.id} data-owned={item.owned}><Icon size={26} /><span>{item.type.replaceAll('_', ' ')}</span><h2>{item.name}</h2><p><LocalizedText text={"A persistent display customization for your physical collection."} /></p><button disabled={item.owned || unlock.isPending} onClick={() => unlock.mutate(item.id)}>{item.owned ? 'Owned' : <><LockKeyhole size={16} />{item.shard_cost}<LocalizedText text={"Shards"} before={" "} /></>}</button></article> })}</div>
  </section>
}

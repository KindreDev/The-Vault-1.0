import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Armchair, Box, ChevronRight, LoaderCircle, PackageOpen, Sparkles, X } from 'lucide-react'
import { tcgRoomApi, tcgV2Api } from '../../lib/api'
import PackOpening from '../PackOpening'

function apiError(error, fallback) {
  return error?.response?.data?.detail || fallback
}

async function hydratePacks(results, contents = []) {
  const products = new Map(contents.map(line => [line.product_id, line.product || {}]))
  return Promise.all((results || []).map(async result => ({
    product: products.get(result.product_id) || result.product || {},
    cards: await Promise.all((result.cards || []).map(async id => {
      const response = await tcgV2Api.cardDetail(id)
      return response.data?.card || response.data
    })),
  })))
}

export default function RoomInventory({ onClose, onPlaceFurniture }) {
  const qc = useQueryClient()
  const [openedPacks, setOpenedPacks] = useState(null)
  const [openingLabel, setOpeningLabel] = useState('')
  const inventory = useQuery({
    queryKey: ['tcg-room-inventory'],
    queryFn: () => tcgRoomApi.inventory().then(response => response.data),
    staleTime: 0,
  })
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
      setOpeningLabel(`Opening parcel ${parcel.parcel_id}…`)
      const response = await tcgRoomApi.openInventoryParcel(parcel.parcel_id)
      const packs = await hydratePacks(response.data?.results, response.data?.contents)
      return packs
    },
    onSuccess: packs => {
      setOpeningLabel('')
      setOpenedPacks(packs)
      refresh()
      toast.success('Parcel opened. Tear the first pack to reveal your cards.')
    },
    onError: error => { setOpeningLabel(''); toast.error(apiError(error, 'Parcel opening failed')) },
  })
  const openToken = useMutation({
    mutationFn: async token => {
      setOpeningLabel(`Opening ${token.product?.name || 'booster'}…`)
      const response = await tcgV2Api.openPack(token.product_id, { use_token: true })
      const data = response.data || {}
      return [{ product: data.product || token.product || {}, cards: data.cards || [] }]
    },
    onSuccess: packs => {
      setOpeningLabel('')
      setOpenedPacks(packs)
      refresh()
      toast.success('Pack token used. Tear the pack to reveal your cards.')
    },
    onError: error => { setOpeningLabel(''); toast.error(apiError(error, 'Pack token opening failed')) },
  })
  const furniture = inventory.data?.furniture || []
  const parcels = inventory.data?.parcels || []
  const tokens = inventory.data?.pack_tokens || []
  const total = useMemo(() => furniture.length + parcels.length + tokens.reduce((sum, item) => sum + Number(item.token_count || 0), 0), [furniture, parcels, tokens])
  const busy = openParcel.isPending || openToken.isPending

  if (openedPacks) return <PackOpening packs={openedPacks} onCollect={() => { setOpenedPacks(null); refresh() }} onSkip={() => { setOpenedPacks(null); refresh() }} />

  return <section className="tcg-room__inventory" role="dialog" aria-modal="true" aria-labelledby="room-inventory-title">
    <header className="tcg-room__inventory-header">
      <div><span>ROOM INVENTORY</span><h2 id="room-inventory-title">Things waiting for you</h2><p>Furniture keeps its exact size. Sealed parcels and earned tokens open through the same collection systems as the rest of The Vault.</p></div>
      <button className="close" onClick={onClose} aria-label="Close room inventory"><X size={22} /> Close</button>
    </header>
    {inventory.isLoading && <div className="tcg-room__inventory-empty"><LoaderCircle className="spin" size={28} /> Loading your room inventory…</div>}
    {inventory.isError && <div className="tcg-room__inventory-empty"><strong>Inventory unavailable</strong><span>{apiError(inventory.error, 'Could not load room inventory.')}</span><button className="secondary" onClick={() => inventory.refetch()}>Retry</button></div>}
    {!inventory.isLoading && !inventory.isError && <>
      <div className="tcg-room__inventory-summary"><strong>{total} {total === 1 ? 'item' : 'items'}</strong><span>Owned here, never purchased from this screen.</span></div>
      <div className="tcg-room__inventory-grid">
        <section className="tcg-room__inventory-group"><header><Armchair size={20} /><div><h3>Furniture</h3><span>{furniture.length} individual {furniture.length === 1 ? 'instance' : 'instances'}</span></div></header>{furniture.length ? furniture.map(item => <article key={`furniture-${item.instance_id}`}><div className="tcg-room__inventory-icon"><Armchair size={30} /></div><div><h4>{item.name}</h4><p>{item.variant_key || 'Default'} · copy #{item.instance_id}</p><span>{item.status === 'placed' ? 'Already placed' : 'Ready to place'}</span></div><button className="secondary" onClick={() => onPlaceFurniture(item.instance_id)}><ChevronRight size={18} /> {item.status === 'placed' ? 'Adjust layout' : 'Place'} </button></article>) : <p className="tcg-room__inventory-muted">No owned furniture yet. Furniture bought in Shop appears here.</p>}</section>
        <section className="tcg-room__inventory-group"><header><Box size={20} /><div><h3>Collected parcels</h3><span>{parcels.length} sealed {parcels.length === 1 ? 'parcel' : 'parcels'}</span></div></header>{parcels.length ? parcels.map(parcel => <article key={`parcel-${parcel.parcel_id}`}><div className="tcg-room__inventory-icon tcg-room__inventory-icon--parcel"><Box size={30} /></div><div><h4>Parcel {parcel.parcel_id}</h4><p>{parcel.pack_count || parcel.contents?.length || 0} sealed packs</p><span>Collected · ready to open</span></div><button className="primary" disabled={busy} onClick={() => openParcel.mutate(parcel)}><PackageOpen size={18} /> Open parcel</button></article>) : <p className="tcg-room__inventory-muted">No collected parcels are waiting. New deliveries still arrive at the mail slot.</p>}</section>
        <section className="tcg-room__inventory-group"><header><Sparkles size={20} /><div><h3>Earned pack tokens</h3><span>{tokens.reduce((sum, item) => sum + Number(item.token_count || 0), 0)} available</span></div></header>{tokens.length ? tokens.map(token => <article key={`token-${token.product_id}`}><div className="tcg-room__inventory-icon tcg-room__inventory-icon--token"><Sparkles size={30} /></div><div><h4>{token.product?.name || 'Booster token'}</h4><p>{token.token_count} {Number(token.token_count) === 1 ? 'token' : 'tokens'} · {token.product?.card_count || '?'} cards each</p><span>Earned reward · no credits charged</span></div><button className="primary" disabled={busy} onClick={() => openToken.mutate(token)}><PackageOpen size={18} /> Open token</button></article>) : <p className="tcg-room__inventory-muted">No earned tokens are waiting right now.</p>}</section>
      </div>
    </>}
    {openingLabel && <div className="tcg-room__inventory-busy"><LoaderCircle className="spin" size={22} /> {openingLabel}</div>}
  </section>
}

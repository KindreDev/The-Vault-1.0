import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Boxes, Moon, PackageOpen, ShoppingBag, Sun } from 'lucide-react'
import { cardsApi, gamiApi, tcgRoomApi, tcgV2Api } from '../../lib/api'
import CollectionBrowser from '../tcg-workspace/CollectionBrowser'
import CardInspector from '../tcg-workspace/CardInspector'
import RoomFixtureShop from './RoomFixtureShop'
import RoomOnlineStore from './RoomOnlineStore'
import { resolveRoomWallet } from './roomWallet'
import '../tcg-workspace/tcg-workspace.css'
import '../tcg-workspace/tcg-workspace-premium.css'
import './room-device.css'

export default function RoomDeviceSurface({ initialTab = 'packs', roomBootstrap }) {
  const qc = useQueryClient()
  const [tab, setTab] = useState(initialTab)
  const [page, setPage] = useState(0)
  const [filters, setFilters] = useState({})
  const [selectedCard, setSelectedCard] = useState(null)
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('vault.room.computer.theme') === 'light' ? 'light' : 'dark' } catch { return 'dark' }
  })
  useEffect(() => { setTab(initialTab === 'binders' ? 'collection' : initialTab) }, [initialTab])
  useEffect(() => {
    try { localStorage.setItem('vault.room.computer.theme', theme) } catch { /* Browser privacy settings can disable storage. */ }
  }, [theme])
  const { data: summary } = useQuery({ queryKey: ['tcg-v2-summary'], queryFn: () => tcgV2Api.summary().then(r => r.data) })
  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: () => gamiApi.profile().then(r => r.data), staleTime: 5 * 60 * 1000 })
  const { data: materials } = useQuery({ queryKey: ['forge-materials'], queryFn: () => cardsApi.materials().then(r => r.data), staleTime: 60 * 1000 })
  const { data: packs = [] } = useQuery({ queryKey: ['tcg-v2-packs'], queryFn: () => tcgV2Api.packs().then(r => r.data) })
  const { data: releases = [] } = useQuery({ queryKey: ['tcg-v2-releases'], queryFn: () => tcgV2Api.releases().then(r => r.data) })
  const { data: catalog = { items: [], total: 0 }, isFetching } = useQuery({
    queryKey: ['tcg-v2-catalog', 'room', page, filters],
    queryFn: () => tcgV2Api.catalog({ ownership: 'owned', ...filters, skip: page * 30, limit: 30 }).then(r => r.data),
  })
  const inventory = useMemo(() => catalog.items.filter(item => item.card).map(item => ({ ...item.card, quantity: item.quantity })), [catalog])
  const wallet = useMemo(() => resolveRoomWallet({ profile, materials, fallback: summary }), [materials, profile, summary])
  const order = useMutation({
    mutationFn: ({ pack, selectedReleaseId }) => tcgRoomApi.order([{ product_id: pack.id, quantity: 1, selected_release_id: selectedReleaseId }]),
    onSuccess: response => { toast.success(`Order placed. Booster packs are on their way.`); qc.invalidateQueries({ queryKey: ['tcg-room-bootstrap'] }); qc.invalidateQueries({ queryKey: ['tcg-v2-summary'] }) },
    onError: error => toast.error(error.response?.data?.detail || 'Could not place the online order'),
  })

  return <div className="tcg-room-device tcg-room-device--computer" data-computer-theme={theme}>
    <header><div><span>VAULT OS</span><strong>Collection computer</strong></div><nav aria-label="VAULT OS sections" role="tablist"><button type="button" role="tab" aria-selected={tab === 'packs'} className={tab === 'packs' ? 'active' : ''} onClick={() => setTab('packs')}><PackageOpen size={18} /> Booster Packs</button><button type="button" role="tab" aria-selected={tab === 'collection'} className={tab === 'collection' ? 'active' : ''} onClick={() => setTab('collection')}><Boxes size={18} /> Collection</button><button type="button" role="tab" aria-selected={tab === 'shop'} className={tab === 'shop' ? 'active' : ''} onClick={() => setTab('shop')}><ShoppingBag size={18} /> Shop</button></nav><button className="tcg-room-device__theme" type="button" onClick={() => setTheme(value => value === 'dark' ? 'light' : 'dark')} aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? <><Sun size={18} /> Light</> : <><Moon size={18} /> Dark</>}</button></header>
    <div className="tcg-room-device__screen">
      {tab === 'packs' && <RoomOnlineStore packs={packs.filter(pack => pack.purchasable)} releases={releases} productImages={inventory.map(card => card.thumb_url || card.image_url).filter(Boolean).slice(0, 24)} pending={order.isPending} pendingPackId={order.variables?.pack?.id} onOrder={(pack, selectedReleaseId) => order.mutate({ pack, selectedReleaseId })} />}
      {tab === 'collection' && <CollectionBrowser entries={catalog.items} view="cards" values={summary?.classification_values} total={catalog.total} page={page} pageSize={30} onPage={setPage} onFilters={value => { setFilters(value); setPage(0) }} onOpen={setSelectedCard} serverFiltered loading={isFetching} disableLayoutAnimation />}
      {tab === 'shop' && <RoomFixtureShop bootstrap={roomBootstrap} wallet={wallet} />}
    </div>
    {selectedCard && <CardInspector card={selectedCard} onClose={() => setSelectedCard(null)} advanced={summary?.settings?.advanced_mode} classificationValues={summary?.classification_values} disableLayoutAnimation />}
  </div>
}

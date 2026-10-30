import { LocalizedText, useT } from '../../i18n'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Boxes, Moon, ShoppingBag, Sun } from 'lucide-react'
import { tcgV2Api } from '../../lib/api'
import CollectionBrowser from '../tcg-workspace/CollectionBrowser'
import CardInspector from '../tcg-workspace/CardInspector'
import Workshop from '../tcg-workspace/Workshop'
import RoomFixtureShop from './RoomFixtureShop'
import '../tcg-workspace/tcg-workspace.css'
import './room-device.css'

export default function RoomDeviceSurface({ initialTab = 'packs', roomBootstrap }) {
  const t = useT()
  const normalizeTab = value => value === 'collection' || value === 'binders' ? 'collection' : 'shop'
  const [tab, setTab] = useState(() => normalizeTab(initialTab))
  const [page, setPage] = useState(0)
  const [filters, setFilters] = useState({})
  const [selectedCard, setSelectedCard] = useState(null)
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('vault.room.computer.theme') === 'light' ? 'light' : 'dark' } catch { return 'dark' }
  })
  useEffect(() => { setTab(normalizeTab(initialTab)) }, [initialTab])
  useEffect(() => {
    try { localStorage.setItem('vault.room.computer.theme', theme) } catch { /* Browser privacy settings can disable storage. */ }
  }, [theme])
  const { data: summary } = useQuery({ queryKey: ['tcg-v2-summary'], queryFn: () => tcgV2Api.summary().then(r => r.data) })
  const { data: packs = [] } = useQuery({ queryKey: ['tcg-v2-packs'], queryFn: () => tcgV2Api.packs().then(r => r.data) })
  const { data: releases = [] } = useQuery({ queryKey: ['tcg-v2-releases'], queryFn: () => tcgV2Api.releases().then(r => r.data) })
  const { data: catalog = { items: [], total: 0 }, isFetching } = useQuery({
    queryKey: ['tcg-v2-catalog', 'room', page, filters],
    queryFn: () => tcgV2Api.catalog({ ownership: 'owned', ...filters, skip: page * 30, limit: 30 }).then(r => r.data),
  })

  return <div className="tcg-room-device tcg-room-device--computer" data-computer-theme={theme}>
    <header><div><span><LocalizedText text={"VAULT OS"} /></span><strong><LocalizedText text={"Collection computer"} /></strong></div><nav aria-label={t("VAULT OS sections")} role="tablist"><button type="button" role="tab" aria-selected={tab === 'collection'} className={tab === 'collection' ? 'active' : ''} onClick={() => setTab('collection')}><Boxes size={18} /><LocalizedText text={"Collection"} before={" "} /></button><button type="button" role="tab" aria-selected={tab === 'shop'} className={tab === 'shop' ? 'active' : ''} onClick={() => setTab('shop')}><ShoppingBag size={18} /><LocalizedText text={"Shop"} before={" "} /></button></nav><button className="tcg-room-device__theme" type="button" onClick={() => setTheme(value => value === 'dark' ? 'light' : 'dark')} aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? <><Sun size={18} /><LocalizedText text={"Light"} before={" "} /></> : <><Moon size={18} /><LocalizedText text={"Dark"} before={" "} /></>}</button></header>
    <div className="tcg-room-device__screen">
      {tab === 'collection' && <CollectionBrowser entries={catalog.items} view="cards" values={summary?.classification_values} total={catalog.total} page={page} pageSize={30} onPage={setPage} onFilters={value => { setFilters(value); setPage(0) }} onOpen={setSelectedCard} serverFiltered loading={isFetching} disableLayoutAnimation />}
      {tab === 'shop' && <Workshop mode="parcel" packs={packs} releases={releases} furniture={<RoomFixtureShop bootstrap={roomBootstrap} query="" category="all" sort="featured" />} />}
    </div>
    {selectedCard && <CardInspector card={selectedCard} onClose={() => setSelectedCard(null)} advanced={summary?.settings?.advanced_mode} classificationValues={summary?.classification_values} disableLayoutAnimation />}
  </div>
}

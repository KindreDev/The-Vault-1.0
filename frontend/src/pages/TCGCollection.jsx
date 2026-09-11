import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AnimatePresence } from 'framer-motion'
import { LoaderCircle, PackageOpen, Sparkles } from 'lucide-react'
import { tcgV2Api } from '../lib/api'
import PackOpening from '../components/PackOpening'
import AdvancedSettings from '../components/tcg-workspace/AdvancedSettings'
import BinderWorkspace from '../components/tcg-workspace/BinderWorkspace'
import CardInspector from '../components/tcg-workspace/CardInspector'
import CollectionBrowser from '../components/tcg-workspace/CollectionBrowser'
import PackBrowser from '../components/tcg-workspace/PackBrowser'
import ReleaseBrowser from '../components/tcg-workspace/ReleaseBrowser'
import TCGNavigation, { TCG_VIEWS } from '../components/tcg-workspace/TCGNavigation'
import TCGSummaryBar from '../components/tcg-workspace/TCGSummaryBar'
import Workshop from '../components/tcg-workspace/Workshop'
import '../components/tcg-workspace/tcg-workspace.css'
import '../components/tcg-workspace/tcg-workspace-refinements.css'
import '../components/tcg-workspace/tcg-workspace-premium.css'

const COLLECTION_VIEWS = new Set(['cards', 'missing', 'duplicates', 'creators', 'characters', 'hof', 'bond'])

function PackPreparingOverlay() {
  const [stage, setStage] = useState(0)
  const stages = ['Preparing cards', 'Building foil masks', 'Sealing your pack']

  useEffect(() => {
    const timer = window.setInterval(() => setStage(current => (current + 1) % stages.length), 1800)
    return () => window.clearInterval(timer)
  }, [stages.length])

  return <div className="tcgws-pack-preparing" role="status" aria-live="polite">
    <div className="tcgws-pack-preparing__panel">
      <div className="tcgws-pack-preparing__icon"><LoaderCircle size={34} /></div>
      <span className="tcgws-pack-preparing__eyebrow"><Sparkles size={17} /> Opening a booster</span>
      <h2>{stages[stage]}</h2>
      <p>Your cards are being prepared. This can take a moment for foil masks.</p>
      <div className="tcgws-pack-preparing__progress" aria-label="Preparing booster" role="progressbar"><i /></div>
      <span className="tcgws-pack-preparing__note"><PackageOpen size={16} /> Please keep this window open</span>
    </div>
  </div>
}

export default function TCGCollection() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const qc = useQueryClient()
  const view = params.get('view') || 'cards'
  const releaseId = Number(params.get('release')) || null
  const setId = Number(params.get('set')) || null
  const [selectedCard, setSelectedCard] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [openedPacks, setOpenedPacks] = useState(null)
  const [catalogPage, setCatalogPage] = useState(0)
  const [catalogFilters, setCatalogFilters] = useState({})
  const catalogPageSize = 100

  const setView = next => {
    const updated = new URLSearchParams(params)
    updated.set('view', next)
    updated.delete('release')
    updated.delete('set')
    setParams(updated, { replace: true })
    setCatalogPage(0)
  }
  const setRelease = id => {
    const updated = new URLSearchParams(params)
    if (id) updated.set('release', id); else { updated.delete('release'); updated.delete('set') }
    setParams(updated, { replace: true })
  }
  const setSelectedSet = (id, parentReleaseId = null) => {
    const updated = new URLSearchParams(params)
    if (parentReleaseId) updated.set('release', parentReleaseId)
    if (id) updated.set('set', id); else updated.delete('set')
    setParams(updated, { replace: true })
  }

  const { data: summary, isLoading, isError: summaryError, error: summaryFailure, refetch: retrySummary } = useQuery({ queryKey: ['tcg-v2-summary'], queryFn: () => tcgV2Api.summary().then(r => r.data), staleTime: 30_000 })
  const { data: releases = [] } = useQuery({ queryKey: ['tcg-v2-releases'], queryFn: () => tcgV2Api.releases().then(r => r.data) })
  const { data: sets = [] } = useQuery({ queryKey: ['tcg-v2-sets'], queryFn: () => tcgV2Api.sets().then(r => r.data) })
  const { data: catalogFilterOptions = {} } = useQuery({ queryKey: ['tcg-v2-catalog-filter-options'], queryFn: () => tcgV2Api.catalogFilterOptions().then(r => r.data), staleTime: 30_000 })
  const { data: packs = [] } = useQuery({ queryKey: ['tcg-v2-packs'], queryFn: () => tcgV2Api.packs().then(r => r.data) })
  const ownership = view === 'missing' ? 'missing' : view === 'duplicates' ? 'duplicates' : 'owned'
  const viewType = view === 'creators' ? 'creator' : view === 'characters' ? 'character' : view === 'hof' ? 'hall-of-fame' : view === 'bond' ? 'bond' : undefined
  const { data: catalog, isFetching: catalogLoading } = useQuery({
    queryKey: ['tcg-v2-catalog', ownership, view, catalogPage, catalogFilters],
    queryFn: () => tcgV2Api.catalog({ ownership, card_type: viewType, ...catalogFilters, skip: catalogPage * catalogPageSize, limit: catalogPageSize }).then(r => r.data),
    enabled: COLLECTION_VIEWS.has(view) || view === 'binders' || view === 'packs',
  })
  const inventory = useMemo(() => (catalog?.items || []).filter(item => item.card).map(item => ({ ...item.card, quantity: item.quantity })), [catalog])
  const classifications = useMemo(() => Object.fromEntries((catalog?.items || []).filter(item => item.card && item.classification).map(item => [item.card.id, item.classification])), [catalog])
  const updateCatalogFilters = useCallback(filters => { setCatalogFilters(filters); setCatalogPage(0) }, [])

  const settingsMutation = useMutation({
    mutationFn: value => tcgV2Api.updateSettings({ advanced_mode: value }),
    onSuccess: response => { qc.setQueryData(['tcg-v2-summary'], old => ({ ...old, settings: response.data })); if (response.data.advanced_mode) setShowSettings(true) },
    onError: error => toast.error(error.response?.data?.detail || 'Could not update Advanced Mode'),
  })
  const openPack = useMutation({
    mutationFn: ({ pack, selectedReleaseId }) => tcgV2Api.openPack(pack.id, { selected_release_id: selectedReleaseId, use_token: pack.tokens > 0 }),
    onSuccess: response => {
      const cards = response.data.cards || []
      const size = response.data.product?.card_count || cards.length
      const requestedProduct = openPack.variables?.pack || {}
      const responseProduct = response.data.product || {}
      const product = {
        ...requestedProduct,
        ...responseProduct,
        wrapper_src: responseProduct.wrapper_src || requestedProduct.wrapper_src,
        wrapper_identity: responseProduct.wrapper_identity || requestedProduct.wrapper_identity,
        collage_images: responseProduct.collage_images?.length ? responseProduct.collage_images : requestedProduct.collage_images || [],
      }
      setOpenedPacks(Array.from({ length: Math.ceil(cards.length / size) }, (_, index) => ({
        product,
        cards: cards.slice(index * size, (index + 1) * size),
      })))
      qc.invalidateQueries({ queryKey: ['tcg-v2-catalog'] }); qc.invalidateQueries({ queryKey: ['tcg-v2-summary'] }); qc.invalidateQueries({ queryKey: ['tcg-v2-packs'] })
    },
    onError: error => toast.error(error.response?.data?.detail || 'Could not open booster'),
  })

  useEffect(() => {
    if (!openPack.isPending) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [openPack.isPending])

  if (isLoading) return <div className="tcgws-loading"><i /><strong>Opening the card vault</strong><span>Loading releases, sets, and your collection...</span></div>
  if (summaryError || !summary) return <div className="tcgws-loading tcgws-load-error"><strong>TCG workspace unavailable</strong><span>{summaryFailure?.response?.data?.detail || 'The collection service did not return a valid workspace summary.'}</span><button onClick={() => retrySummary()}>Retry</button></div>
  const title = TCG_VIEWS.find(item => item.id === view)?.label || 'Card Collection'
  return <div className="tcgws-root">
    <main className="tcgws-main">
      <header className="tcgws-topbar"><div><span>THE VAULT / CARD COLLECTION</span><h1>{title}</h1></div><TCGSummaryBar summary={summary} /></header>
      <TCGNavigation view={view} onView={next => next === 'room' ? navigate('/collection/room') : setView(next)} advanced={summary?.settings.advanced_mode} onAdvanced={() => settingsMutation.mutate(!summary?.settings.advanced_mode)} />
      <div className="tcgws-content">
        {(view === 'releases' || view === 'sets') && <ReleaseBrowser releases={releases} sets={sets} releaseId={releaseId} setId={setId} onRelease={setRelease} onSet={setSelectedSet} onOpenCard={setSelectedCard} setsOnly={view === 'sets'} advanced={summary.settings.advanced_mode} generationMode={summary.settings.release_generation_mode} />}
        {COLLECTION_VIEWS.has(view) && <CollectionBrowser entries={catalog?.items || []} view={view} classifications={classifications} values={summary.classification_values} releases={releases} sets={sets} filterOptions={catalogFilterOptions} total={catalog?.total || 0} page={catalogPage} pageSize={catalogPageSize} onPage={setCatalogPage} onFilters={updateCatalogFilters} onOpen={setSelectedCard} serverFiltered loading={catalogLoading} />}
        {view === 'packs' && <PackBrowser packs={packs} inventory={inventory} releases={releases} pending={openPack.isPending} pendingPackId={openPack.variables?.pack?.id || null} onOpenPack={(pack, selectedReleaseId) => openPack.mutate({ pack, selectedReleaseId })} />}
        {view === 'binders' && <BinderWorkspace inventory={inventory} onOpenCard={setSelectedCard} />}
        {view === 'workshop' && <Workshop />}
      </div>
    </main>
    <AnimatePresence initial={false} mode="wait">
      {selectedCard && <CardInspector key={selectedCard.id} card={selectedCard} onClose={() => setSelectedCard(null)} advanced={summary.settings.advanced_mode} classificationValues={summary.classification_values} />}
    </AnimatePresence>
    {showSettings && summary.settings.advanced_mode && <AdvancedSettings settings={summary.settings} onClose={() => setShowSettings(false)} />}
    {openPack.isPending && <PackPreparingOverlay />}
    {openedPacks && <PackOpening packs={openedPacks} onCollect={() => setOpenedPacks(null)} onSkip={() => setOpenedPacks(null)} />}
  </div>
}

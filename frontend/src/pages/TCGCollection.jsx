import { LocalizedText, useT } from '../i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AnimatePresence } from 'framer-motion'
import { LoaderCircle, PackageOpen, Sparkles } from 'lucide-react'
import { cardsApi, tasksApi, tcgV2Api } from '../lib/api'
import PackOpening from '../components/PackOpening'
import TCGSetupFlow from '../components/collection/TCGSetupFlow'
import AdvancedSettings from '../components/tcg-workspace/AdvancedSettings'
import BinderWorkspace from '../components/tcg-workspace/BinderWorkspace'
import CardInspector from '../components/tcg-workspace/CardInspector'
import CollectionBrowser from '../components/tcg-workspace/CollectionBrowser'
import CollectionsBoard from '../components/tcg-workspace/CollectionsBoard'

import ReleaseBrowser from '../components/tcg-workspace/ReleaseBrowser'
import TCGNavigation, { TCG_VIEWS } from '../components/tcg-workspace/TCGNavigation'
import TCGSummaryBar from '../components/tcg-workspace/TCGSummaryBar'
import Workshop from '../components/tcg-workspace/Workshop'
import { useScrollLock } from '../hooks/useScrollLock'
import '../components/tcg-workspace/tcg-workspace.css'

const COLLECTION_VIEWS = new Set(['cards', 'missing', 'duplicates', 'creators', 'characters', 'hof', 'bond'])

function PackPreparingOverlay({ progress }) {
  const t = useT()
  return <div className="tcgws-pack-preparing" role="status" aria-live="polite">
    <div className="tcgws-pack-preparing__panel">
      <div className="tcgws-pack-preparing__icon"><LoaderCircle size={34} /></div>
      <span className="tcgws-pack-preparing__eyebrow"><Sparkles size={17} /><LocalizedText text={"Checking out"} before={" "} /></span>
      <h2>{t("Preparing your purchase")}</h2><p>{progress}</p>
      <p><LocalizedText text={"Your items are being prepared. Boosters can take a moment while card artwork is processed."} /></p>
      <div className="tcgws-pack-preparing__progress" aria-label={t("Preparing purchase")} role="progressbar"><i /></div>
      <span className="tcgws-pack-preparing__note"><PackageOpen size={16} /><LocalizedText text={"Please keep this window open"} before={" "} /></span>
    </div>
  </div>
}

export default function TCGCollection() {
  return <TCGSetupFlow><TCGWorkspace /></TCGSetupFlow>
}

function TCGWorkspace() {
  const t = useT()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const qc = useQueryClient()
  const requestedView = params.get('view') || 'cards'
  const view = requestedView === 'packs' ? 'workshop' : requestedView
  const releaseId = Number(params.get('release')) || null
  const setId = Number(params.get('set')) || null
  const [selectedCard, setSelectedCard] = useState(null)
  const [inspectList, setInspectList] = useState([])
  const [showSettings, setShowSettings] = useState(false)
  const [openedPacks, setOpenedPacks] = useState(null)
  const [shopBusy, setShopBusy] = useState(false)
  const [shopProgress, setShopProgress] = useState('')
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
    // The collection browser remounts with default filters, so drop the old
    // ones too. Otherwise the first request would use stale scope filters.
    setCatalogFilters({})
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
  const { data: queueState } = useQuery({
    queryKey: ['task-queue'], queryFn: () => tasksApi.queue().then(r => r.data),
    refetchInterval: q => (q.state.data?.current?.type === 'foundation_refresh'
      || q.state.data?.queued?.some(task => task.type === 'foundation_refresh')) ? 1200 : 8000,
  })
  const refreshMutation = useMutation({
    mutationFn: () => cardsApi.refreshFoundation().then(r => r.data),
    onSuccess: data => {
      qc.invalidateQueries({ queryKey: ['task-queue'] })
      toast.success(data.existing ? t('A catalogue refresh is already in Task Q') : t('Catalogue refresh added to Task Q'))
    },
    onError: error => toast.error(error.response?.data?.detail || t('Could not queue catalogue refresh')),
  })
  const wipeMutation = useMutation({
    mutationFn: confirmation => cardsApi.wipeOwnedCards(confirmation).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ predicate: query => {
        const key = String(query.queryKey[0] || '')
        return key.startsWith('tcg-') || key === 'cards' || key === 'creator-showcase'
      } })
      toast.success(t('Owned card collection cleared'))
    },
    onError: error => toast.error(error.response?.data?.detail || t('Could not wipe owned cards')),
  })
  const refreshTask = queueState?.current?.type === 'foundation_refresh'
    ? queueState.current
    : queueState?.queued?.find(task => task.type === 'foundation_refresh')
      || queueState?.history?.find(task => task.type === 'foundation_refresh')
  const refreshActive = refreshTask && ['queued', 'running'].includes(refreshTask.status)
  // Only refetch when a refresh finishes while this page is open. A finished
  // task stays in history, so reacting to "done" alone refetched on every visit.
  const lastRefreshState = useRef(null)
  useEffect(() => {
    const previous = lastRefreshState.current
    lastRefreshState.current = refreshTask ? { id: refreshTask.id, status: refreshTask.status } : null
    if (refreshTask?.status === 'done' && previous?.id === refreshTask.id && previous.status !== 'done') {
      qc.invalidateQueries({ predicate: query => String(query.queryKey[0] || '').startsWith('tcg-v2-') })
    }
  }, [refreshTask?.id, refreshTask?.status, qc])
  const ownership = view === 'missing' ? 'missing' : view === 'duplicates' ? 'duplicates' : 'owned'
  const viewType = view === 'creators' ? 'creator' : view === 'characters' ? 'character' : view === 'hof' ? 'hall-of-fame' : view === 'bond' ? 'bond' : undefined
  const catalogParams = useMemo(() => Object.fromEntries(Object.entries({ ownership, card_type: viewType, ...catalogFilters })
    .filter(([, value]) => value !== undefined && value !== null && value !== '')), [ownership, viewType, catalogFilters])
  const { data: catalog, isFetching: catalogLoading } = useQuery({
    queryKey: ['tcg-v2-catalog', catalogParams, catalogPage],
    queryFn: () => tcgV2Api.catalog({ ...catalogParams, skip: catalogPage * catalogPageSize, limit: catalogPageSize }).then(r => r.data),
    enabled: COLLECTION_VIEWS.has(view),
  })
  const classifications = useMemo(() => Object.fromEntries((catalog?.items || []).filter(item => item.card && item.classification).map(item => [item.card.id, item.classification])), [catalog])
  const updateCatalogFilters = useCallback(filters => { setCatalogFilters(filters); setCatalogPage(0) }, [])

  const settingsMutation = useMutation({
    mutationFn: value => tcgV2Api.updateSettings({ advanced_mode: value }),
    onSuccess: response => { qc.setQueryData(['tcg-v2-summary'], old => ({ ...old, settings: response.data })) },
    onError: error => toast.error(error.response?.data?.detail || t("Could not update Advanced Mode")),
  })

  useScrollLock(shopBusy)

  // The summary awards newly completed sets; celebrate each one once.
  const celebrated = useRef(new Set())
  useEffect(() => {
    const awards = summary?.new_completion_awards || []
    if (!awards.length) return
    for (const award of awards) {
      const key = `${award.set_id}:${award.kind}`
      if (celebrated.current.has(key)) continue
      celebrated.current.add(key)
      toast.success(t(award.kind === 'master' ? 'Master set complete: {name} · +{xp} XP · +{credits} Credits' : 'Set complete: {name} · +{xp} XP · +{credits} Credits', {
        name: award.set_name || t('Set'), xp: award.xp, credits: award.credits,
      }), { duration: 6000, icon: '🏆' })
    }
    qc.invalidateQueries({ queryKey: ['profile'] })
    qc.invalidateQueries({ queryKey: ['tcg-v2-sets'] })
    qc.invalidateQueries({ queryKey: ['tcg-v2-release'] })
  }, [summary?.new_completion_awards, qc, t])

  if (isLoading) return <div className="tcgws-loading"><i /><strong><LocalizedText text={"Opening the card vault"} /></strong><span><LocalizedText text={"Loading releases, sets, and your collection..."} /></span></div>
  if (summaryError || !summary) return <div className="tcgws-loading tcgws-load-error"><strong><LocalizedText text={"TCG workspace unavailable"} /></strong><span>{summaryFailure?.response?.data?.detail || t('The collection service did not return a valid workspace summary.')}</span><button onClick={() => retrySummary()}><LocalizedText text={"Retry"} /></button></div>
  const title = t(TCG_VIEWS.find(item => item.id === view)?.label || 'Card Collection')
  // Open a card with the list it came from, so the window can step through it.
  const openCard = (card, list) => {
    const source = list || (COLLECTION_VIEWS.has(view) ? (catalog?.items || []).map(item => item.card).filter(Boolean) : [])
    setInspectList(source)
    setSelectedCard(card)
  }
  const inspectIndex = selectedCard ? inspectList.findIndex(item => item.id === selectedCard.id) : -1
  const stepCard = offset => { const next = inspectList[inspectIndex + offset]; if (next) setSelectedCard(next) }
  return <div className="tcgws-shell flex flex-col">
    <TCGNavigation view={view} onView={next => next === 'room' ? navigate('/collection/room') : setView(next)} advanced={summary?.settings.advanced_mode} onAdvanced={() => setShowSettings(true)} />
    <div className="tcgws-root p-5 flex flex-col gap-4">
      <header className="tcgws-page-header">
        <h1 className="text-[19px] font-medium text-[rgba(255,255,255,0.9)]">{title}</h1>
        <TCGSummaryBar summary={summary}
                       onOpenRelease={id => { const updated = new URLSearchParams({ view: 'releases', release: String(id) }); setParams(updated, { replace: true }) }}
                       onOpenSet={(id, releaseId) => { const updated = new URLSearchParams({ view: 'releases', release: String(releaseId), set: String(id) }); setParams(updated, { replace: true }) }} />
      </header>
      <div className="tcgws-content">
        {(view === 'releases' || view === 'sets') && <ReleaseBrowser releases={releases} sets={sets} releaseId={releaseId} setId={setId} onRelease={setRelease} onSet={setSelectedSet} onOpenCard={openCard} setsOnly={view === 'sets'} advanced={summary.settings.advanced_mode} generationMode={summary.settings.release_generation_mode} />}
        {COLLECTION_VIEWS.has(view) && <CollectionBrowser entries={catalog?.items || []} view={view} hasLegacyCards={summary.has_legacy_cards} classifications={classifications} values={summary.classification_values} releases={releases} sets={sets} filterOptions={catalogFilterOptions} total={catalog?.total || 0} page={catalogPage} pageSize={catalogPageSize} onPage={setCatalogPage} onFilters={updateCatalogFilters} onOpen={card => openCard(card)} serverFiltered loading={catalogLoading} />}
        {view === 'collections' && <CollectionsBoard />}
        {view === 'binders' && <BinderWorkspace onOpenCard={openCard} />}
        {view === 'workshop' && <Workshop packs={packs} releases={releases} onOpenedPacks={setOpenedPacks} onBusyChange={setShopBusy} onProgress={setShopProgress} />}
      </div>
    </div>
    <AnimatePresence initial={false} mode="wait">
      {selectedCard && <CardInspector key="tcg-card-inspector" card={selectedCard} onClose={() => setSelectedCard(null)} onPrev={inspectIndex > 0 ? () => stepCard(-1) : null} onNext={inspectIndex >= 0 && inspectIndex < inspectList.length - 1 ? () => stepCard(1) : null} advanced={summary.settings.advanced_mode} classificationValues={summary.classification_values} />}
    </AnimatePresence>
    {showSettings && <AdvancedSettings
      settings={summary.settings}
      onClose={() => setShowSettings(false)}
      onToggleAdvanced={value => settingsMutation.mutate(value)}
      refreshTask={refreshTask}
      refreshActive={refreshActive}
      refreshPending={refreshMutation.isPending}
      onRestore={() => refreshMutation.mutate()}
      wipePending={wipeMutation.isPending}
      onWipe={confirmation => wipeMutation.mutate(confirmation)}
    />}
    {shopBusy && <PackPreparingOverlay progress={shopProgress} />}
    {openedPacks && <PackOpening packs={openedPacks} onCollect={() => setOpenedPacks(null)} onSkip={() => setOpenedPacks(null)} />}
  </div>
}

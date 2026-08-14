import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Layers, ShoppingBag, Hammer, Filter, ChevronDown, Check, Loader, Sparkles, BarChart2, Search, X } from 'lucide-react'
import { cardsApi, economyApi, gamiApi } from '../lib/api'
import VaultCard, { RARITY_ORDER, RARITY_CONFIG } from '../components/VaultCard'
import CardViewer from '../components/CardViewer'
import PackOpening from '../components/PackOpening'
import ShopTab from '../components/ShopTab'
import DismantleEffect from '../components/DismantleEffect'
import GalleryPagination from '../components/GalleryPagination'
import CollectionFilters, { VaultDropdown } from '../components/collection/CollectionFilters'
import toast from 'react-hot-toast'

const PAGE_SIZE_OPTIONS = [10, 20, 30, 50]

const CARD_WIDTH_FOR_PAGE_SIZE = { 10: 370, 20: 300, 30: 250, 50: 200 }

const TABS = [
  { id: 'collection', label: 'My Cards', icon: Layers },
  { id: 'shop',       label: 'The Shop', icon: ShoppingBag },
  { id: 'forge',      label: 'The Forge', icon: Hammer },
]

// Filter *values* must be the real Card.rarity enum keys ('common'…), never the
// display rebrand ('Core') — VaultCard.jsx's RARITY_CONFIG.common.label is "Core"
// but the DB/API only ever know "common". Using the label as the value meant the
// "Core" filter could never match anything. Build options from the single source
// of truth (RARITY_ORDER/RARITY_CONFIG) so label and wire-value can't drift again.
const RARITY_OPTIONS = [
  { value: 'All', label: 'All' },
  ...RARITY_ORDER.map(r => ({ value: r, label: RARITY_CONFIG[r]?.label ?? r })),
]
// Scarcity class (the R / SR / SSR / UR badge on the card face). Separate axis
// from the tier above: the class is a card's percentile *within* its own tier,
// so a Core card can be UR. Filtering the two independently is the point.
const CLASS_OPTIONS = [
  { value: 'All', label: 'All' },
  { value: 'UR',  label: 'UR' },
  { value: 'SSR', label: 'SSR' },
  { value: 'SR',  label: 'SR' },
  { value: 'R',   label: 'R' },
]
const TYPE_OPTIONS = [
  'All', 'Photo', 'Gallery', 'Creator', 'Goon', 'Variant', 'Collab', 'HOF',
].map(t => ({ value: t, label: t }))
const TYPE_API_MAP  = { 'Photo': 'image', 'HOF': 'hof' }
const SORT_OPTIONS  = [
  { value: 'rarity_desc', label: 'Rarity ↓' },
  { value: 'rarity_asc',  label: 'Rarity ↑' },
  { value: 'recent',      label: 'Newest' },
  { value: 'cxp',         label: 'CXP' },
]

// ── Rarity color dots (4-tier rework: purple → orange → gold → cosmic) ────────
const RARITY_COLORS = {
  common: '#9F8FEF', epic: '#ff8800', legendary: '#FFD700', celestial: '#E8E8FF',
}

const CO_STATE_KEY = 'vault_collection_state'

export default function Collection() {
  const [tab, setTab]                   = useState('collection')
  const [searchParams, setSearchParams] = useSearchParams()

  // ── Persist filter state so back-navigation restores it — same pattern as
  // CreatorList/GalleryList: URL params are the source of truth, sessionStorage
  // is only a restore-on-mount convenience for when the URL itself is bare.
  const _coRestoredRef = useRef(false)
  useEffect(() => {
    if (_coRestoredRef.current) return
    _coRestoredRef.current = true
    if (searchParams.toString() === '') {
      try {
        const saved = sessionStorage.getItem(CO_STATE_KEY)
        if (saved) setSearchParams(new URLSearchParams(saved), { replace: true })
      } catch {}
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try { sessionStorage.setItem(CO_STATE_KEY, searchParams.toString()) } catch {}
  }, [searchParams])

  // ── Derive filter state from URL search params ───────────────────────────────
  const rarityFilter = searchParams.get('rarity') || 'All'
  const classFilter   = searchParams.get('class') || 'All'
  const typeFilter    = searchParams.get('type') || 'All'
  const creatorFilter = searchParams.get('creator') || ''
  const searchQuery   = searchParams.get('q') || ''
  const sort           = searchParams.get('sort') || 'rarity_desc'
  const page            = parseInt(searchParams.get('page') || '1', 10) || 1

  const setParam = useCallback((key, value) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (value === null || value === undefined || value === '' || value === false) next.delete(key)
      else next.set(key, String(value))
      return next
    }, { replace: true })
  }, [setSearchParams])

  const setParams = useCallback((updates) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined || value === '' || value === false) next.delete(key)
        else next.set(key, String(value))
      }
      return next
    }, { replace: true })
  }, [setSearchParams])

  const setRarityFilter = useCallback(v => setParams({ rarity: v !== 'All' ? v : null, page: null }), [setParams])
  const setClassFilter   = useCallback(v => setParams({ class: v !== 'All' ? v : null, page: null }), [setParams])
  const setTypeFilter    = useCallback(v => setParams({ type: v !== 'All' ? v : null, page: null }), [setParams])
  const setCreatorFilter = useCallback(v => setParams({ creator: v || null, page: null }), [setParams])
  const setSearchQuery   = useCallback(v => setParams({ q: v || null, page: null }), [setParams])
  const setSort           = useCallback(v => setParams({ sort: v !== 'rarity_desc' ? v : null, page: null }), [setParams])
  const setPage = useCallback((v) => {
    const p = typeof v === 'function' ? v(page) : v
    setParam('page', p > 1 ? p : null)
  }, [setParam, page])

  const hasActiveFilters = rarityFilter !== 'All' || classFilter !== 'All' || typeFilter !== 'All'
    || creatorFilter !== '' || searchQuery !== '' || sort !== 'rarity_desc'
  const resetFilters = useCallback(() => setSearchParams({}, { replace: true }), [setSearchParams])

  const [selected, setSelected]         = useState([])
  const [viewCard, setViewCard]         = useState(null)  // { card, inventoryId, sourceRect }
  const [packBatches, setPackBatches]   = useState(null)  // array of 5-card arrays
  const [pageSize, setPageSize]         = useState(() => Number(localStorage.getItem('vault-collection-page-size')) || 50)
  const [forgePage, setForgePage]       = useState(1)
  const [showCxpBar, setShowCxpBar]     = useState(() => localStorage.getItem('vault-show-cxp') === 'true')
  const [showEffects, setShowEffects]   = useState(() => localStorage.getItem('vault-show-effects') === 'true')
  const [dismantleAnim, setDismantleAnim]     = useState(null)
  const [shardsFlash, setShardsFlash]         = useState(false)
  const [animShards, setAnimShards]           = useState(null)
  const [confirmDismantleAll, setConfirmDismantleAll] = useState(false)
  const [isSelectAll, setIsSelectAll]         = useState(false)
  const cardEls     = useRef(new Map())
  const forgeCardEls = useRef(new Map())
  const shardsRef   = useRef(null)
  const qc = useQueryClient()

  const FORGE_PAGE_SIZE = 30

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: invData, isLoading: invLoading } = useQuery({
    queryKey: ['card-inventory', rarityFilter, classFilter, typeFilter, creatorFilter, searchQuery, sort],
    queryFn: () => cardsApi.inventory({
      rarity:       rarityFilter !== 'All' ? rarityFilter : undefined,
      rarity_class: classFilter  !== 'All' ? classFilter  : undefined,
      card_type:    typeFilter   !== 'All' ? (TYPE_API_MAP[typeFilter] ?? typeFilter.toLowerCase()) : undefined,
      creator_id:   creatorFilter || undefined,
      search:       searchQuery || undefined,
      sort,
    }).then(r => r.data),
    enabled: tab === 'collection' || tab === 'forge',
  })

  // Only creators you own cards of — a filter listing every creator in the vault
  // would be the same navigation problem in a different shape.
  const { data: collectionCreators = [] } = useQuery({
    queryKey: ['collection-creators'],
    queryFn: () => cardsApi.collectionCreators().then(r => r.data),
    enabled: tab === 'collection',
    staleTime: 60_000,
  })

  const { data: balance } = useQuery({
    queryKey: ['economy-balance'],
    queryFn: () => economyApi.balance().then(r => r.data),
    refetchInterval: 30000,
  })

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => gamiApi.profile().then(r => r.data),
    staleTime: 10000,
  })

  const { data: materials } = useQuery({
    queryKey: ['forge-materials'],
    queryFn: () => cardsApi.materials().then(r => r.data),
  })

  const handlePackSuccess = (data) => {
    const allCards = data.cards ?? []
    const batches = []
    for (let i = 0; i < allCards.length; i += 5) batches.push(allCards.slice(i, i + 5))
    setPackBatches(batches.length ? batches : null)
    qc.invalidateQueries({ queryKey: ['economy-balance'] })
    qc.invalidateQueries({ queryKey: ['profile'] })
  }

  const openPackMutation = useMutation({
    mutationFn: (data) => cardsApi.openPack(data).then(r => r.data),
    onSuccess: handlePackSuccess,
    onError: (e) => toast.error(e.response?.data?.detail || 'Not enough credits'),
  })

  const openFromInventoryMutation = useMutation({
    mutationFn: (data) => cardsApi.openPackFromInventory(data).then(r => r.data),
    onSuccess: handlePackSuccess,
    onError: (e) => toast.error(e.response?.data?.detail || 'No packs available'),
  })

  const dismantleBatchMutation = useMutation({
    mutationFn: (ids) => cardsApi.dismantleBatch(ids).then(r => r.data),
    onSuccess: (data) => {
      toast.success(`Dismantled ${data.dismantled}  +${data.shards_earned} shards`)
      setAnimShards(s => s ? { ...s, gained: data.shards_earned } : null)
      qc.invalidateQueries({ queryKey: ['card-inventory'] })
      qc.invalidateQueries({ queryKey: ['forge-materials'] })
    },
    onError: () => toast.error('Dismantle failed'),
  })

  const dismantleDuplicatesMutation = useMutation({
    mutationFn: () => cardsApi.dismantleDuplicates().then(r => r.data),
    onSuccess: (data) => {
      if (data.dismantled === 0) { toast('No duplicates found'); return }
      toast.success(`Dismantled ${data.dismantled} dupes · +${data.shards_earned} shards`)
      qc.invalidateQueries({ queryKey: ['card-inventory'] })
      qc.invalidateQueries({ queryKey: ['forge-materials'] })
    },
    onError: () => toast.error('Failed to dismantle duplicates'),
  })

const feedDuplicateMutation = useMutation({
    mutationFn: (invId) => cardsApi.feedDuplicate(invId).then(r => r.data),
    onSuccess: (data) => {
      toast.success(`+${data.cxp_gained} CXP (×${data.quantity} remaining)`)
      qc.invalidateQueries({ queryKey: ['card-inventory'] })
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Feed failed'),
  })

  const craftMutation = useMutation({
    mutationFn: () => cardsApi.craftCatalyst().then(r => r.data),
    onSuccess: () => {
      toast.success('⚗️ Catalyst Token crafted!')
      qc.invalidateQueries({ queryKey: ['forge-materials'] })
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Need 150 shards'),
  })

  // ── Forge Variant ─────────────────────────────────────────────────────────
  const { data: variantPairs, refetch: refetchVariantPairs } = useQuery({
    queryKey: ['variant-pairs'],
    queryFn: () => cardsApi.variantPairs().then(r => r.data),
    enabled: tab === 'forge',
    staleTime: 0,
  })

  const forgeVariantMutation = useMutation({
    mutationFn: ({ creator_id, character_id }) =>
      cardsApi.forgeVariant(creator_id, character_id).then(r => r.data),
    onSuccess: (data) => {
      toast.success(`✦ ${data.card.creator_name} × ${data.card.character_name} variant forged! +${data.xp_earned} XP`)
      qc.invalidateQueries({ queryKey: ['card-inventory'] })
      qc.invalidateQueries({ queryKey: ['forge-materials'] })
      refetchVariantPairs()
      if (data.card) {
        setViewCard({ card: data.card, inventoryId: null, sourceRect: null })
      }
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Forge failed'),
  })

  const [variantSearch, setVariantSearch] = useState('')
  const [variantPage, setVariantPage]     = useState(1)

  const VARIANT_PAGE_SIZE = 12
  const visiblePairs = useMemo(() => {
    const q = variantSearch.trim().toLowerCase()
    return (Array.isArray(variantPairs) ? variantPairs : [])
      .filter(p => !q || p.creator_name?.toLowerCase().includes(q) || p.character_name?.toLowerCase().includes(q))
      .sort((a, b) => (a.at_cap === b.at_cap) ? 0 : (a.at_cap ? 1 : -1)) // not-at-cap first
  }, [variantPairs, variantSearch])
  const variantTotalPages = Math.max(1, Math.ceil(visiblePairs.length / VARIANT_PAGE_SIZE))
  const shownPairs = visiblePairs.slice((variantPage - 1) * VARIANT_PAGE_SIZE, variantPage * VARIANT_PAGE_SIZE)

  const [exchangeAmount, setExchangeAmount] = useState(25)
  const exchangeMutation = useMutation({
    mutationFn: () => cardsApi.shardsToCredits(exchangeAmount).then(r => r.data),
    onSuccess: (data) => {
      toast.success(`🔷 ${data.shards_spent} shards → 💰 ${data.credits_earned} credits`)
      qc.invalidateQueries({ queryKey: ['forge-materials'] })
      qc.invalidateQueries({ queryKey: ['economy-balance'] })
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Exchange failed'),
  })

  // ── Forge: multi-select dismantle ─────────────────────────────────────────
  const toggleSelect = (invId) => {
    setIsSelectAll(false)
    setSelected(s => s.includes(invId) ? s.filter(x => x !== invId) : [...s, invId])
  }

  const executeDismantleSelected = () => {
    const cardRects = selected
      .map(id => forgeCardEls.current.get(id)?.getBoundingClientRect())
      .filter(Boolean)
    const targetRect = shardsRef.current?.getBoundingClientRect() ?? null

    if (cardRects.length && targetRect) {
      setDismantleAnim({ cardRects, targetRect })
      setAnimShards({ base: materials?.shards ?? 0, gained: 0, progress: 0 })
    }

    dismantleBatchMutation.mutate(selected)
    setSelected([])
    setIsSelectAll(false)
    setConfirmDismantleAll(false)
  }

  const dismantleSelected = () => {
    if (isSelectAll) {
      setConfirmDismantleAll(true)
    } else {
      executeDismantleSelected()
    }
  }

  const selectAll = () => {
    setSelected(items.map(inv => inv.inventory_id))
    setIsSelectAll(true)
  }

  const selectRareOrBelow = () => {
    // "Epic & below" under the 4-tier system (keeps legendary/celestial safe)
    const threshold = RARITY_ORDER.indexOf('epic')
    setIsSelectAll(false)
    setSelected(items
      .filter(inv => !inv.foil && RARITY_ORDER.indexOf(inv.rarity) <= threshold)
      .map(inv => inv.inventory_id))
  }

  const selectUncommonOrBelow = () => {
    // "Commons" under the 4-tier system (foils are never bulk-selected)
    setIsSelectAll(false)
    setSelected(items
      .filter(inv => !inv.foil && inv.rarity === 'common')
      .map(inv => inv.inventory_id))
  }

  // ── Pack opening ─────────────────────────────────────────────────────────
  const handleCollect = () => {
    setPackBatches(null)
    qc.invalidateQueries({ queryKey: ['card-inventory'] })
    toast.success('Cards added to collection!')
  }
  const handleSkip = () => {
    setPackBatches(null)
    qc.invalidateQueries({ queryKey: ['card-inventory'] })
  }

  const items = invData?.items ?? []
  const total = invData?.total ?? 0
  const totalPages       = Math.max(1, Math.ceil(items.length / pageSize))
  const pagedItems       = items.slice((page - 1) * pageSize, page * pageSize)
  const cardWidth        = CARD_WIDTH_FOR_PAGE_SIZE[pageSize] ?? 200
  const forgeTotalPages  = Math.max(1, Math.ceil(items.length / FORGE_PAGE_SIZE))
  const forgePagedItems  = items.slice((forgePage - 1) * FORGE_PAGE_SIZE, forgePage * FORGE_PAGE_SIZE)
  const gridStyle   = {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, ${cardWidth}px)`,
    justifyContent: 'center',
    gap: 14,
  }

  // ── Credit display ─────────────────────────────────────────────────────────
  const credits = balance?.vault_credits ?? 0
  const displayedShards = animShards
    ? animShards.base + Math.round(animShards.progress * animShards.gained)
    : (materials?.shards ?? 0)

  return (
    <div style={{ minHeight: '100vh', background: '#080810', padding: '24px 28px' }}>
      {/* Pack opening overlay */}
      {packBatches && (
        <PackOpening
          packs={packBatches}
          onCollect={handleCollect}
          onSkip={handleSkip}
        />
      )}

      {/* Dismantle particle effect */}
      {dismantleAnim && (
        <DismantleEffect
          cardRects={dismantleAnim.cardRects}
          targetRect={dismantleAnim.targetRect}
          onProgress={(fraction) =>
            setAnimShards(s => s ? { ...s, progress: fraction } : null)
          }
          onComplete={() => {
            setDismantleAnim(null)
            setAnimShards(null)
            setShardsFlash(true)
            setTimeout(() => setShardsFlash(false), 800)
          }}
        />
      )}

      {/* Dismantle-all confirmation */}
      {confirmDismantleAll && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1500,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setConfirmDismantleAll(false)}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#141420', border: '1px solid color-mix(in srgb, var(--c-pink) 35%, transparent)',
              borderRadius: 16, padding: '32px 36px', maxWidth: 400, width: '90%',
              boxShadow: '0 0 40px color-mix(in srgb, var(--c-pink) 15%, transparent)',
            }}
          >
            <div style={{ fontSize: 28, textAlign: 'center', marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', textAlign: 'center', marginBottom: 8 }}>
              Dismantle ALL Cards?
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', textAlign: 'center', lineHeight: 1.6, marginBottom: 24 }}>
              You are about to dismantle all <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{selected.length}</strong> cards
              in your collection. This cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setConfirmDismantleAll(false)}
                style={{
                  flex: 1, padding: '10px', borderRadius: 10, fontSize: 12,
                  cursor: 'pointer', fontWeight: 600,
                  background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)',
                  border: '0.5px solid rgba(255,255,255,0.1)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={executeDismantleSelected}
                style={{
                  flex: 1, padding: '10px', borderRadius: 10, fontSize: 12,
                  cursor: 'pointer', fontWeight: 700,
                  background: 'color-mix(in srgb, var(--c-pink) 30%, transparent)', color: '#F4C0D1',
                  border: '1px solid color-mix(in srgb, var(--c-pink) 50%, transparent)',
                  boxShadow: '0 0 16px color-mix(in srgb, var(--c-pink) 20%, transparent)',
                }}
              >
                Yes, Dismantle All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Card viewer overlay */}
      {viewCard && (
        <CardViewer
          card={viewCard.card}
          inventoryId={viewCard.inventoryId}
          sourceRect={viewCard.sourceRect}
          onClose={() => setViewCard(null)}
        />
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fff', margin: 0 }}>Card Collection</h1>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
            {total} card{total !== 1 ? 's' : ''} owned
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', borderRadius: 20,
            background: 'color-mix(in srgb, var(--c-amber) 15%, transparent)',
            border: '0.5px solid color-mix(in srgb, var(--c-amber) 40%, transparent)',
            color: 'var(--c-amber-text)', fontSize: 13, fontWeight: 600,
          }}>
            💰 {credits.toLocaleString()} Credits
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '8px 18px', borderRadius: 20, fontSize: 12,
              fontWeight: tab === t.id ? 600 : 400, cursor: 'pointer',
              background: tab === t.id ? 'color-mix(in srgb, var(--c-accent) 25%, transparent)' : 'rgba(255,255,255,0.04)',
              color: tab === t.id ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.4)',
              border: tab === t.id ? '1px solid color-mix(in srgb, var(--c-accent) 45%, transparent)' : '0.5px solid rgba(255,255,255,0.08)',
              transition: 'all 0.15s ease',
            }}
          >
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {/* ── COLLECTION TAB ──────────────────────────────────────────────────── */}
      {tab === 'collection' && (
        <div>
          <CollectionFilters
            search={searchQuery}          onSearchChange={v => { setSearchQuery(v); setForgePage(1) }}
            rarity={rarityFilter}         onRarityChange={v => { setRarityFilter(v); setForgePage(1) }}
            rarityOptions={RARITY_OPTIONS} rarityColors={RARITY_COLORS}
            rarityClass={classFilter}     onRarityClassChange={v => { setClassFilter(v); setForgePage(1) }}
            classOptions={CLASS_OPTIONS}
            creator={creatorFilter}       onCreatorChange={v => { setCreatorFilter(v); setForgePage(1) }}
            creators={collectionCreators}
            type={typeFilter}             onTypeChange={v => { setTypeFilter(v); setForgePage(1) }}
            typeOptions={TYPE_OPTIONS}
            sort={sort}                   onSortChange={setSort}
            sortOptions={SORT_OPTIONS}
            hasActiveFilters={hasActiveFilters}
            onReset={resetFilters}
            trailing={<>
            {/* Divider */}
            <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.08)', margin: '0 2px' }} />

            {/* Per-page */}
            <VaultDropdown
              value={pageSize}
              onChange={v => { setPageSize(v); localStorage.setItem('vault-collection-page-size', v); setPage(1) }}
              options={PAGE_SIZE_OPTIONS.map(n => ({ value: n, label: `${n} per page` }))}
            />

            {/* Effects toggle */}
            <button onClick={() => setShowEffects(v => { const n = !v; localStorage.setItem('vault-show-effects', n); return n })} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 12px', borderRadius: 8, fontSize: 11, cursor: 'pointer',
              background: showEffects ? 'color-mix(in srgb, var(--c-accent) 20%, transparent)' : 'rgba(255,255,255,0.04)',
              color: showEffects ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.35)',
              border: showEffects ? '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' : '0.5px solid rgba(255,255,255,0.08)',
            }}>
              <Sparkles size={11} /> Effects
            </button>

            {/* CXP bar toggle */}
            <button onClick={() => setShowCxpBar(v => { const n = !v; localStorage.setItem('vault-show-cxp', n); return n })} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 12px', borderRadius: 8, fontSize: 11, cursor: 'pointer',
              background: showCxpBar ? 'color-mix(in srgb, var(--c-accent) 20%, transparent)' : 'rgba(255,255,255,0.04)',
              color: showCxpBar ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.35)',
              border: showCxpBar ? '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' : '0.5px solid rgba(255,255,255,0.08)',
            }}>
              <BarChart2 size={11} /> CXP
            </button>
            </>}
          />

          {/* The old "active filters" summary row is gone: the chips above show
              every active tier/class at a glance, and the search box and creator
              picker carry their own state, so it was restating what is visible. */}

          {invLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
              <Loader size={24} style={{ color: 'rgba(255,255,255,0.2)', animation: 'spin 1s linear infinite' }} />
            </div>
          ) : items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 80, color: 'rgba(255,255,255,0.2)' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🃏</div>
              <div style={{ fontSize: 14 }}>No cards yet — open a pack in The Shop!</div>
            </div>
          ) : (
            <>
              <div key={invLoading ? 0 : 1} className="grid-stagger" style={gridStyle}>
                {pagedItems.map(inv => {
                  const cfg = RARITY_CONFIG[inv.rarity] || RARITY_CONFIG.common
                  return (
                    <div
                      key={inv.inventory_id}
                      ref={(el) => { if (el) cardEls.current.set(inv.inventory_id, el) }}
                      style={{
                        position: 'relative',
                        borderRadius: 18,
                        // Off-screen rows skip layout+paint entirely (perf). Prestige
                        // cards opt out: content-visibility's paint containment would
                        // clip the rainbow halo on every side but the bottom, and a
                        // raised z-index keeps the side glow above the neighbour cell.
                        contentVisibility: (inv.prestige || inv.foil) ? 'visible' : 'auto',
                        containIntrinsicSize: `${cardWidth}px ${Math.round(cardWidth * 1.45) + 40}px`,
                        zIndex: (inv.prestige || inv.foil) ? 3 : undefined,
                      }}
                    >
                      <VaultCard
                        card={inv}
                        width={cardWidth}
                        forceEffects={showEffects}
                        onClick={() => {
                          const el = cardEls.current.get(inv.inventory_id)
                          setViewCard({ card: inv, inventoryId: inv.inventory_id, sourceRect: el?.getBoundingClientRect() ?? null })
                        }}
                      />
                      {inv.quantity > 1 && (
                        <div style={{
                          position: 'absolute', top: 6, right: 6,
                          background: 'rgba(0,0,0,0.75)', borderRadius: 10,
                          padding: '2px 6px', fontSize: 10, color: 'var(--c-amber-text)', fontWeight: 700,
                        }}>
                          ×{inv.quantity}
                        </div>
                      )}
                      {showCxpBar && (() => {
                        // Level progress within the tier (rarity never changes now)
                        const cxp       = inv.cxp ?? 0
                        const level     = inv.level ?? 1
                        const threshold = inv.cxp_for_next   // null at max level
                        const isFull    = level >= (inv.level_max ?? 10)
                        const pct       = threshold ? Math.min(100, (cxp / threshold) * 100) : 100
                        return (
                          <div style={{ marginTop: 5, padding: '0 4px' }}>
                            <div style={{ height: 7, borderRadius: 4, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                              <div style={{
                                height: '100%', borderRadius: 4,
                                width: `${isFull ? 100 : pct}%`,
                                background: isFull
                                  ? `linear-gradient(90deg, ${cfg.badge}, #fff, ${cfg.badge})`
                                  : cfg.badge,
                                backgroundSize: isFull ? '200% 100%' : 'auto',
                                boxShadow: isFull
                                  ? `0 0 10px ${cfg.badge}, 0 0 20px ${cfg.badge}88`
                                  : `0 0 6px ${cfg.badge}88`,
                                transition: 'width 0.4s ease',
                                animation: isFull ? 'cxp-bar-shine 1.4s ease-in-out infinite' : 'none',
                              }} />
                            </div>
                            <div style={{ fontSize: 9, color: isFull ? cfg.badge : 'rgba(255,255,255,0.2)', textAlign: 'right', marginTop: 2 }}>
                              {isFull ? '✨ LV MAX' : `LV ${level} · ${cxp} / ${threshold ?? '—'}`}
                            </div>
                            <style>{`
                              @keyframes cxp-bar-shine {
                                0%,100% { background-position: 0% 0%; }
                                50%      { background-position: 100% 0%; }
                              }
                            `}</style>
                          </div>
                        )
                      })()}
                    </div>
                  )
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{ marginTop: 32, paddingBottom: 16 }}>
                  <GalleryPagination page={page} totalPages={totalPages} onChange={setPage} id="collection" />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── SHOP TAB ────────────────────────────────────────────────────────── */}
      {tab === 'shop' && (
        <ShopTab
          credits={credits}
          openPackMutation={openPackMutation}
          openFromInventoryMutation={openFromInventoryMutation}
          standardPacks={profile?.standard_packs ?? 0}
          premiumPacks={profile?.premium_packs ?? 0}
        />
      )}


      {/* ── FORGE TAB ───────────────────────────────────────────────────────── */}
      {tab === 'forge' && (
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* Dismantle panel */}
          <div style={{ flex: '1 1 400px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Hammer size={14} style={{ color: 'var(--c-amber-text)' }} /> Dismantle Cards
              </div>
              <button
                onClick={() => dismantleDuplicatesMutation.mutate()}
                disabled={dismantleDuplicatesMutation.isPending}
                style={{
                  marginLeft: 'auto', padding: '5px 12px', borderRadius: 8, fontSize: 11,
                  cursor: 'pointer', fontWeight: 600,
                  background: 'color-mix(in srgb, var(--c-amber) 12%, transparent)', color: 'var(--c-amber-text)',
                  border: '0.5px solid color-mix(in srgb, var(--c-amber) 30%, transparent)',
                  opacity: dismantleDuplicatesMutation.isPending ? 0.5 : 1,
                }}
              >
                Dismantle Dupes
              </button>
            </div>

            {/* Selection helpers */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              <button
                onClick={selectUncommonOrBelow}
                style={{
                  padding: '5px 12px', borderRadius: 8, fontSize: 11, cursor: 'pointer',
                  background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)',
                  border: '0.5px solid rgba(255,255,255,0.1)',
                }}
              >
                Select Commons
              </button>
              <button
                onClick={selectRareOrBelow}
                style={{
                  padding: '5px 12px', borderRadius: 8, fontSize: 11, cursor: 'pointer',
                  background: 'rgba(70,130,220,0.1)', color: '#7AB8E8',
                  border: '0.5px solid rgba(70,130,220,0.3)',
                }}
              >
                Select Epic &amp; Below
              </button>
              <button
                onClick={selectAll}
                style={{
                  padding: '5px 12px', borderRadius: 8, fontSize: 11, cursor: 'pointer',
                  background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)',
                  border: '0.5px solid rgba(255,255,255,0.08)',
                }}
              >
                Select All
              </button>
              {selected.length > 0 && (
                <button
                  onClick={() => { setSelected([]); setIsSelectAll(false) }}
                  style={{
                    padding: '5px 10px', borderRadius: 8, fontSize: 11, cursor: 'pointer',
                    background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.3)',
                    border: 'none',
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            {/* Action bar — shown when cards are selected */}
            {selected.length > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12,
                padding: '10px 16px', borderRadius: 10,
                background: 'color-mix(in srgb, var(--c-pink) 10%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-pink) 25%, transparent)',
              }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                  {selected.length} card{selected.length > 1 ? 's' : ''} selected
                </span>
                <button
                  onClick={dismantleSelected}
                  style={{
                    marginLeft: 'auto', padding: '6px 14px', borderRadius: 8,
                    fontSize: 11, cursor: 'pointer', fontWeight: 600,
                    background: 'color-mix(in srgb, var(--c-pink) 30%, transparent)', color: '#F4C0D1',
                    border: '0.5px solid color-mix(in srgb, var(--c-pink) 50%, transparent)',
                  }}
                >
                  Dismantle Selected
                </button>
              </div>
            )}

            {invLoading ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>Loading cards…</div>
            ) : (
              <>
                <div className="forge-no-anim" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {forgePagedItems.map(inv => {
                    const isSel = selected.includes(inv.inventory_id)
                    return (
                      <div
                        key={inv.inventory_id}
                        ref={el => { if (el) forgeCardEls.current.set(inv.inventory_id, el); else forgeCardEls.current.delete(inv.inventory_id) }}
                        onClick={() => toggleSelect(inv.inventory_id)}
                        style={{
                          position: 'relative', cursor: 'pointer',
                          outline: isSel ? '2px solid #F4C0D1' : '2px solid transparent',
                          borderRadius: 14, transition: 'outline 0.15s',
                          opacity: isSel ? 0.75 : 1,
                          contentVisibility: 'auto',
                          containIntrinsicSize: `140px ${Math.round(140 * 1.45) + 20}px`,
                        }}
                      >
                        <VaultCard card={inv} width={140} forceEffects={false} />
                        {/* Feed-duplicate button — only on cards with extras */}
                        {inv.quantity > 1 && !isSel && (
                          <button
                            onClick={(e) => { e.stopPropagation(); feedDuplicateMutation.mutate(inv.inventory_id) }}
                            disabled={feedDuplicateMutation.isPending}
                            title={`Feed 1 duplicate for CXP`}
                            style={{
                              position: 'absolute', bottom: 6, right: 6, zIndex: 10,
                              padding: '3px 7px', borderRadius: 8, fontSize: 9, cursor: 'pointer',
                              background: 'color-mix(in srgb, var(--c-green) 30%, transparent)', color: '#6EE7C3',
                              border: '0.5px solid color-mix(in srgb, var(--c-green) 50%, transparent)',
                            }}
                          >
                            +CXP
                          </button>
                        )}
                        {isSel && (
                          <div style={{
                            position: 'absolute', inset: 0, borderRadius: 14,
                            background: 'color-mix(in srgb, var(--c-pink) 25%, transparent)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 22, zIndex: 10, pointerEvents: 'none',
                          }}>✓</div>
                        )}
                      </div>
                    )
                  })}
                  {items.length === 0 && (
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', padding: 20 }}>
                      No cards to dismantle. Open packs first!
                    </div>
                  )}
                </div>

                {/* Forge pagination */}
                {forgeTotalPages > 1 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6, marginTop: 20, flexWrap: 'wrap',
                  }}>
                    <button
                      onClick={() => setForgePage(p => Math.max(1, p - 1))}
                      disabled={forgePage === 1}
                      style={{
                        padding: '5px 12px', borderRadius: 8, fontSize: 11,
                        cursor: forgePage === 1 ? 'not-allowed' : 'pointer',
                        background: 'rgba(255,255,255,0.04)',
                        color: forgePage === 1 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.6)',
                        border: '0.5px solid rgba(255,255,255,0.08)',
                      }}
                    >‹ Prev</button>

                    {Array.from({ length: forgeTotalPages }, (_, i) => i + 1)
                      .filter(p => p === 1 || p === forgeTotalPages || Math.abs(p - forgePage) <= 2)
                      .reduce((acc, p, i, arr) => {
                        if (i > 0 && p - arr[i - 1] > 1) acc.push('…')
                        acc.push(p)
                        return acc
                      }, [])
                      .map((p, i) => p === '…' ? (
                        <span key={`fe-${i}`} style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, padding: '0 2px' }}>…</span>
                      ) : (
                        <button
                          key={p}
                          onClick={() => setForgePage(p)}
                          style={{
                            padding: '5px 10px', borderRadius: 8, fontSize: 11, cursor: 'pointer', minWidth: 32,
                            background: p === forgePage ? 'color-mix(in srgb, var(--c-accent) 30%, transparent)' : 'rgba(255,255,255,0.04)',
                            color: p === forgePage ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.4)',
                            border: p === forgePage ? '0.5px solid color-mix(in srgb, var(--c-accent) 50%, transparent)' : '0.5px solid rgba(255,255,255,0.08)',
                            fontWeight: p === forgePage ? 700 : 400,
                          }}
                        >{p}</button>
                      ))
                    }

                    <button
                      onClick={() => setForgePage(p => Math.min(forgeTotalPages, p + 1))}
                      disabled={forgePage === forgeTotalPages}
                      style={{
                        padding: '5px 12px', borderRadius: 8, fontSize: 11,
                        cursor: forgePage === forgeTotalPages ? 'not-allowed' : 'pointer',
                        background: 'rgba(255,255,255,0.04)',
                        color: forgePage === forgeTotalPages ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.6)',
                        border: '0.5px solid rgba(255,255,255,0.08)',
                      }}
                    >Next ›</button>

                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginLeft: 4 }}>
                      {items.length} total
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Craft panel */}
          <div style={{ flex: '0 0 240px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.6)', marginBottom: 16 }}>
              ⚗️ Craft Materials
            </div>
            <div style={{
              borderRadius: 12,
              background: 'rgba(255,255,255,0.02)',
              border: '0.5px solid rgba(255,255,255,0.06)',
              padding: 20, marginBottom: 16,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, fontSize: 13 }}>
                <span style={{ color: 'rgba(255,255,255,0.45)' }}>🔷 Shards</span>
                <span
                  ref={shardsRef}
                  style={{
                    color: 'var(--c-accent-text)', fontWeight: 700,
                    transition: 'text-shadow 0.15s',
                    textShadow: shardsFlash ? '0 0 12px var(--c-accent-text), 0 0 24px var(--c-accent)' : 'none',
                    animation: shardsFlash ? 'shards-pop 0.6s ease-out' : 'none',
                  }}
                >
                  {displayedShards}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'rgba(255,255,255,0.45)' }}>⚗️ Catalyst Tokens</span>
                <span style={{ color: 'var(--c-amber-text)', fontWeight: 700 }}>{materials?.catalyst_tokens ?? 0}</span>
              </div>
            </div>
            <button
              onClick={() => craftMutation.mutate()}
              disabled={craftMutation.isPending || (materials?.shards ?? 0) < 150}
              style={{
                width: '100%', padding: '11px', borderRadius: 10, fontSize: 12,
                fontWeight: 600, cursor: (materials?.shards ?? 0) >= 150 ? 'pointer' : 'not-allowed',
                background: (materials?.shards ?? 0) >= 150
                  ? 'color-mix(in srgb, var(--c-amber) 25%, transparent)' : 'rgba(255,255,255,0.04)',
                color: (materials?.shards ?? 0) >= 150 ? 'var(--c-amber-text)' : 'rgba(255,255,255,0.2)',
                border: (materials?.shards ?? 0) >= 150
                  ? '0.5px solid color-mix(in srgb, var(--c-amber) 40%, transparent)' : '0.5px solid rgba(255,255,255,0.06)',
              }}
            >
              {craftMutation.isPending ? 'Crafting…' : '⚗️ Craft Token (150 shards)'}
            </button>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 10, lineHeight: 1.5 }}>
              Use Catalyst Tokens on any card to instantly evolve it one rarity tier up.
              Tokens are also deposited when you level up.
            </div>

            {/* ── Shards → Credits exchange ─────────────────────────── */}
            <div style={{ marginTop: 24, paddingTop: 18, borderTop: '0.5px solid rgba(255,255,255,0.07)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 12 }}>
                💱 Exchange Shards
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
                fontSize: 11, color: 'rgba(255,255,255,0.3)',
              }}>
                <span>🔷 1 shard</span>
                <span style={{ color: 'rgba(255,255,255,0.15)' }}>→</span>
                <span style={{ color: 'var(--c-green-text)' }}>💰 3 credits</span>
              </div>

              {/* Amount picker */}
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
                {[25, 50, 100, 250].map(n => (
                  <button
                    key={n}
                    onClick={() => setExchangeAmount(n)}
                    style={{
                      padding: '4px 10px', borderRadius: 7, fontSize: 11, cursor: 'pointer',
                      background: exchangeAmount === n ? 'color-mix(in srgb, var(--c-accent) 25%, transparent)' : 'rgba(255,255,255,0.04)',
                      color: exchangeAmount === n ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.4)',
                      border: exchangeAmount === n ? '0.5px solid color-mix(in srgb, var(--c-accent) 50%, transparent)' : '0.5px solid rgba(255,255,255,0.08)',
                      fontWeight: exchangeAmount === n ? 700 : 400,
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>

              {/* Preview */}
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 10 }}>
                {exchangeAmount} shards → <span style={{ color: 'var(--c-green-text)', fontWeight: 700 }}>{exchangeAmount * 3} credits</span>
              </div>

              <button
                onClick={() => !exchangeMutation.isPending && exchangeMutation.mutate()}
                disabled={exchangeMutation.isPending || (materials?.shards ?? 0) < exchangeAmount}
                style={{
                  width: '100%', padding: '10px', borderRadius: 10, fontSize: 12,
                  fontWeight: 600,
                  cursor: (materials?.shards ?? 0) >= exchangeAmount ? 'pointer' : 'not-allowed',
                  background: (materials?.shards ?? 0) >= exchangeAmount
                    ? 'color-mix(in srgb, var(--c-green) 20%, transparent)' : 'rgba(255,255,255,0.04)',
                  color: (materials?.shards ?? 0) >= exchangeAmount ? 'var(--c-green-text)' : 'rgba(255,255,255,0.2)',
                  border: (materials?.shards ?? 0) >= exchangeAmount
                    ? '0.5px solid color-mix(in srgb, var(--c-green) 35%, transparent)' : '0.5px solid rgba(255,255,255,0.06)',
                  opacity: exchangeMutation.isPending ? 0.6 : 1,
                }}
              >
                {exchangeMutation.isPending ? 'Converting…' : `Convert ${exchangeAmount} shards`}
              </button>
            </div>
          </div>

          {/* ── Forge Variant panel ─────────────────────────────────────── */}
          <div style={{ width: '100%', marginTop: 8 }}>
            <div style={{
              borderTop: '0.5px solid color-mix(in srgb, var(--c-accent) 15%, transparent)',
              paddingTop: 20,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>
                  ✦ Forge a Variant Card
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '3px 10px', borderRadius: 20, fontSize: 14,
                  background: 'color-mix(in srgb, var(--c-accent) 12%, transparent)',
                  border: '0.5px solid color-mix(in srgb, var(--c-accent) 25%, transparent)',
                  color: 'var(--c-accent)',
                }}>
                  500 🔷 + 1 ⚗️
                </div>
                <div style={{ marginLeft: 'auto', fontSize: 14, color: 'rgba(255,255,255,0.25)' }}>
                  Legendary baseline · max 3 per pair
                </div>
              </div>
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)', marginBottom: 16, lineHeight: 1.5 }}>
                Pairs shown below are backed by real galleries where both the creator and character are linked.
                Link a gallery to a creator <em>and</em> set its character to unlock new pairs.
              </div>

              {!Array.isArray(variantPairs) || variantPairs.length === 0 ? (
                <div style={{
                  padding: '20px 24px', borderRadius: 12, fontSize: 14,
                  background: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.06)',
                  color: 'rgba(255,255,255,0.25)', textAlign: 'center',
                }}>
                  No eligible pairs yet. Open a gallery, assign it to a creator, and set a linked character.
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
                    background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)',
                    borderRadius: 8, padding: '8px 12px', maxWidth: 420 }}>
                    <Search size={16} color="rgba(255,255,255,0.4)" style={{ flexShrink: 0 }} />
                    <input
                      type="text"
                      value={variantSearch}
                      onChange={e => { setVariantSearch(e.target.value); setVariantPage(1) }}
                      placeholder="Search creator or character…"
                      style={{
                        flex: 1, background: 'transparent', border: 'none', outline: 'none',
                        fontSize: 15, color: 'rgba(255,255,255,0.85)',
                      }}
                    />
                  </div>
                  <div className="forge-no-anim" style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
                    gap: 14,
                  }}>
                  {shownPairs.map(pair => {
                    const canAfford = (materials?.shards ?? 0) >= 500 && (materials?.catalyst_tokens ?? 0) >= 1
                    const disabled  = pair.at_cap || !canAfford || forgeVariantMutation.isPending
                    return (
                      <div
                        key={`${pair.creator_id}-${pair.character_id}`}
                        style={{
                          borderRadius: 14,
                          border: pair.at_cap
                            ? '0.5px solid rgba(255,255,255,0.07)'
                            : '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)',
                          background: pair.at_cap
                            ? 'rgba(255,255,255,0.02)'
                            : 'color-mix(in srgb, var(--c-accent) 6%, transparent)',
                          padding: '18px 16px',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                          opacity: pair.at_cap ? 0.5 : 1,
                        }}
                      >
                        {/* Creator avatar */}
                        {pair.creator_avatar ? (
                          <img src={pair.creator_avatar} alt={pair.creator_name}
                            style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover',
                              border: '2px solid color-mix(in srgb, var(--c-accent) 40%, transparent)', flexShrink: 0 }} />
                        ) : (
                          <div style={{ width: 56, height: 56, borderRadius: '50%', flexShrink: 0,
                            background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', display: 'flex', alignItems: 'center',
                            justifyContent: 'center', fontSize: 22 }}>
                            {pair.creator_name[0]}
                          </div>
                        )}
                        <div style={{ textAlign: 'center', width: '100%' }}>
                          <div style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.9)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {pair.creator_name}
                          </div>
                          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', textTransform: 'capitalize' }}>
                            {pair.creator_type}
                          </div>
                        </div>

                        {/* "×" divider */}
                        <div style={{ fontSize: 18, color: 'var(--c-accent)', fontWeight: 700, flexShrink: 0 }}>
                          ×
                        </div>

                        {/* Character avatar */}
                        {pair.character_avatar ? (
                          <img src={pair.character_avatar} alt={pair.character_name}
                            style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover',
                              border: '2px solid color-mix(in srgb, var(--c-pink) 40%, transparent)', flexShrink: 0 }} />
                        ) : (
                          <div style={{ width: 56, height: 56, borderRadius: '50%', flexShrink: 0,
                            background: 'color-mix(in srgb, var(--c-pink) 20%, transparent)', display: 'flex', alignItems: 'center',
                            justifyContent: 'center', fontSize: 22 }}>
                            {pair.character_name[0]}
                          </div>
                        )}
                        <div style={{ textAlign: 'center', width: '100%' }}>
                          <div style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.9)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {pair.character_name}
                          </div>
                          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>
                            {pair.existing_variants} / {pair.cap} forged
                          </div>
                        </div>

                        {/* Result label */}
                        <div style={{
                          width: '100%', textAlign: 'center',
                          fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.4,
                          marginTop: 4,
                        }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {pair.creator_name} × {pair.character_name}
                          </div>
                          <div style={{ fontWeight: 700, color: 'var(--c-accent)', fontSize: 14 }}>→ Variant Card</div>
                          <div style={{ marginTop: 4, color: 'rgba(255,255,255,0.3)' }}>
                            Cost: 500 🔷 + 1 ⚗️
                          </div>
                        </div>

                        {/* Forge button */}
                        <button
                          onClick={() => forgeVariantMutation.mutate({
                            creator_id: pair.creator_id,
                            character_id: pair.character_id,
                          })}
                          disabled={disabled}
                          style={{
                            width: '100%', marginTop: 8,
                            padding: '12px 22px', borderRadius: 10, fontSize: 15, cursor: disabled ? 'not-allowed' : 'pointer',
                            fontWeight: 700,
                            background: pair.at_cap
                              ? 'rgba(255,255,255,0.04)'
                              : canAfford
                              ? 'color-mix(in srgb, var(--c-accent) 30%, transparent)'
                              : 'rgba(255,255,255,0.05)',
                            color: pair.at_cap
                              ? 'rgba(255,255,255,0.2)'
                              : canAfford
                              ? 'var(--c-accent)'
                              : 'rgba(255,255,255,0.2)',
                            border: pair.at_cap
                              ? '0.5px solid rgba(255,255,255,0.06)'
                              : canAfford
                              ? '0.5px solid color-mix(in srgb, var(--c-accent) 50%, transparent)'
                              : '0.5px solid rgba(255,255,255,0.08)',
                          }}
                        >
                          {pair.at_cap ? 'Capped' : forgeVariantMutation.isPending ? '…' : 'Forge ✦'}
                        </button>
                      </div>
                    )
                  })}
                  </div>

                  {/* Variant pairs pagination */}
                  {variantTotalPages > 1 && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap',
                    }}>
                      <button
                        onClick={() => setVariantPage(p => Math.max(1, p - 1))}
                        disabled={variantPage === 1}
                        style={{
                          padding: '6px 14px', borderRadius: 8, fontSize: 13,
                          cursor: variantPage === 1 ? 'not-allowed' : 'pointer',
                          background: 'rgba(255,255,255,0.04)',
                          color: variantPage === 1 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.6)',
                          border: '0.5px solid rgba(255,255,255,0.08)',
                        }}
                      >‹ Prev</button>

                      {Array.from({ length: variantTotalPages }, (_, i) => i + 1)
                        .filter(p => p === 1 || p === variantTotalPages || Math.abs(p - variantPage) <= 2)
                        .reduce((acc, p, i, arr) => {
                          if (i > 0 && p - arr[i - 1] > 1) acc.push('…')
                          acc.push(p)
                          return acc
                        }, [])
                        .map((p, i) => p === '…' ? (
                          <span key={`vp-${i}`} style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13, padding: '0 2px' }}>…</span>
                        ) : (
                          <button
                            key={p}
                            onClick={() => setVariantPage(p)}
                            style={{
                              padding: '6px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer', minWidth: 34,
                              background: p === variantPage ? 'color-mix(in srgb, var(--c-accent) 30%, transparent)' : 'rgba(255,255,255,0.04)',
                              color: p === variantPage ? 'var(--c-accent)' : 'rgba(255,255,255,0.4)',
                              border: p === variantPage ? '0.5px solid color-mix(in srgb, var(--c-accent) 50%, transparent)' : '0.5px solid rgba(255,255,255,0.08)',
                              fontWeight: p === variantPage ? 700 : 400,
                            }}
                          >{p}</button>
                        ))
                      }

                      <button
                        onClick={() => setVariantPage(p => Math.min(variantTotalPages, p + 1))}
                        disabled={variantPage === variantTotalPages}
                        style={{
                          padding: '6px 14px', borderRadius: 8, fontSize: 13,
                          cursor: variantPage === variantTotalPages ? 'not-allowed' : 'pointer',
                          background: 'rgba(255,255,255,0.04)',
                          color: variantPage === variantTotalPages ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.6)',
                          border: '0.5px solid rgba(255,255,255,0.08)',
                        }}
                      >Next ›</button>

                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', marginLeft: 4 }}>
                        {visiblePairs.length} pair{visiblePairs.length !== 1 ? 's' : ''} total
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes shards-pop {
          0%   { transform: scale(1); }
          30%  { transform: scale(1.4); color: #fff; }
          60%  { transform: scale(1.1); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  )
}
